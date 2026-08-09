//! Env-gated JSONL instrumentation for the OQ4 coalescing measurement spike.
//!
//! @ref LLP 0191#1-the-live-query-evaluation-model — the spike records the
//! missing matcher, evaluation, frame, and settlement units at their source.

use crate::live_coalesce::LiveCoalesceStats;
use crate::manifest::HandlerInput;
use crate::storage::{AuthorizationVersion, ClientMutationIdentity};
use serde_json::{Value, json};
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

const TRACE_ENV: &str = "SNAPBACK_SPIKE_TRACE";

struct SpikeTrace {
    started: Instant,
    writer: Mutex<BufWriter<File>>,
}

static TRACE: OnceLock<Option<SpikeTrace>> = OnceLock::new();

fn trace() -> Option<&'static SpikeTrace> {
    TRACE
        .get_or_init(|| {
            let path = std::env::var_os(TRACE_ENV).filter(|value| !value.is_empty())?;
            let path = PathBuf::from(path);
            match OpenOptions::new().create(true).append(true).open(&path) {
                Ok(file) => Some(SpikeTrace {
                    started: Instant::now(),
                    writer: Mutex::new(BufWriter::new(file)),
                }),
                Err(error) => {
                    eprintln!(
                        "SNAPBACK_SPIKE_TRACE_OPEN_FAILED: could not append {}: {error}",
                        path.display()
                    );
                    None
                }
            }
        })
        .as_ref()
}

/// A process-monotonic timestamp in milliseconds. When tracing is disabled,
/// this is only the cached `OnceLock<Option<_>>` check and returns `None`.
pub(crate) fn timestamp_ms() -> Option<f64> {
    trace().map(|trace| trace.started.elapsed().as_secs_f64() * 1_000.0)
}

pub(crate) fn enabled() -> bool {
    trace().is_some()
}

fn emit_at(timestamp_ms: f64, mut event: Value) {
    let Some(trace) = trace() else {
        return;
    };
    let Some(object) = event.as_object_mut() else {
        return;
    };
    object.insert("timestamp_ms".to_owned(), json!(timestamp_ms));
    let Ok(mut line) = serde_json::to_vec(&event) else {
        return;
    };
    line.push(b'\n');
    let mut writer = trace
        .writer
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if writer.write_all(&line).is_ok() {
        // The measurement trace is intentionally kill-tolerant. Its event
        // rate is tiny compared with the evaluations being measured.
        let _ = writer.flush();
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct MutationTraceIdentity {
    pub client_mutation_id: Option<String>,
    pub receipt_mutation_id: Option<String>,
    pub composition_client_id: Option<String>,
    pub composition_mutation_id: Option<String>,
    pub operation_issuance: Option<Value>,
}

impl MutationTraceIdentity {
    pub(crate) fn capture(
        input: &HandlerInput,
        identity: Option<&ClientMutationIdentity>,
        receipt_mutation_id: Option<&str>,
    ) -> Self {
        if !enabled() {
            return Self::default();
        }
        let string_arg = |name: &str| {
            input
                .args
                .get(name)
                .and_then(Value::as_str)
                .map(str::to_owned)
        };
        Self {
            client_mutation_id: identity.map(|identity| identity.id.clone()),
            receipt_mutation_id: receipt_mutation_id.map(str::to_owned),
            composition_client_id: string_arg("compositionClientID"),
            composition_mutation_id: string_arg("compositionMutationID"),
            operation_issuance: identity
                .and_then(|identity| identity.operation_issuance.as_ref())
                .and_then(|issuance| serde_json::to_value(issuance).ok()),
        }
    }
}

pub(crate) fn commit(
    timestamp_ms: Option<f64>,
    mutation: &str,
    version: u64,
    changed_row_count: usize,
    identity: &MutationTraceIdentity,
) {
    let Some(timestamp_ms) = timestamp_ms else {
        return;
    };
    emit_at(
        timestamp_ms,
        json!({
            "event": "commit",
            "mutation": mutation,
            "commit_version": version,
            "changed_row_count": changed_row_count,
            "client_mutation_id": identity.client_mutation_id,
            "receipt_mutation_id": identity.receipt_mutation_id,
            "composition_client_id": identity.composition_client_id,
            "composition_mutation_id": identity.composition_mutation_id,
            "operation_issuance": identity.operation_issuance,
            "commit_durable_ms": timestamp_ms,
            "commit_ack_ms": timestamp_ms,
        }),
    );
}

pub(crate) fn fanout_dispatch(
    commit_versions: &[u64],
    decision: &str,
    changed_row_count: usize,
    pending_merged_frames: u64,
    pending_changed_row_count: usize,
) {
    let Some(timestamp_ms) = timestamp_ms() else {
        return;
    };
    emit_at(
        timestamp_ms,
        json!({
            "event": "fanout_dispatch",
            "commit_versions": commit_versions,
            "decision": decision,
            "changed_row_count": changed_row_count,
            "pending_merged_frames": pending_merged_frames,
            "pending_changed_row_count": pending_changed_row_count,
        }),
    );
}

pub(crate) fn matcher_decision(
    subscription_id: &str,
    connection_id: &str,
    commit_versions: &[u64],
    decision: &str,
    lane: Option<&str>,
    reason: &str,
) {
    let Some(timestamp_ms) = timestamp_ms() else {
        return;
    };
    emit_at(
        timestamp_ms,
        json!({
            "event": "matcher_decision",
            "subscription_id": subscription_id,
            "connection_id": connection_id,
            "commit_versions": commit_versions,
            "decision": decision,
            "lane": lane,
            "reason": reason,
        }),
    );
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn eval(
    subscription_id: &str,
    connection_id: &str,
    commit_versions: &[u64],
    queue_ms: Option<f64>,
    start_ms: Option<f64>,
    finish_ms: Option<f64>,
    delivered_frame_bytes: usize,
    frame_kind: Option<&str>,
    version: u64,
    outcome: &str,
    diagnostic_code: Option<&str>,
) {
    let Some(finish_ms) = finish_ms else {
        return;
    };
    let start_ms = start_ms.unwrap_or(finish_ms);
    let queue_ms = queue_ms.unwrap_or(start_ms);
    emit_at(
        finish_ms,
        json!({
            "event": "eval",
            "subscription_id": subscription_id,
            "connection_id": connection_id,
            "commit_versions": commit_versions,
            "queue_ms": queue_ms,
            "start_ms": start_ms,
            "finish_ms": finish_ms,
            "duration_ms": (finish_ms - start_ms).max(0.0),
            "delivered_frame_bytes": delivered_frame_bytes,
            "frame_kind": frame_kind,
            "version": version,
            "outcome": outcome,
            "diagnostic_code": diagnostic_code,
        }),
    );
}

/// Record a queued evaluation that latest-value replacement made obsolete
/// before it started. This retains the evaluation event shape used by the OQ4
/// trace while leaving `connection_id` null because the scheduler queue is
/// keyed only by subscription.
///
/// @ref LLP 0200#4-acceptance-instruments-and-predeclared-hypotheses — H-4
/// requires superseded queued evaluations to be observable.
pub(crate) fn eval_superseded(
    subscription_id: &str,
    commit_versions: &[u64],
    queue_ms: Option<f64>,
    version: u64,
) {
    let Some(finish_ms) = timestamp_ms() else {
        return;
    };
    let queue_ms = queue_ms.unwrap_or(finish_ms);
    emit_at(
        finish_ms,
        json!({
            "event": "eval",
            "subscription_id": subscription_id,
            "connection_id": Option::<&str>::None,
            "commit_versions": commit_versions,
            "queue_ms": queue_ms,
            "start_ms": finish_ms,
            "finish_ms": finish_ms,
            "duration_ms": 0.0,
            "delivered_frame_bytes": 0,
            "frame_kind": Option::<&str>::None,
            "version": version,
            "outcome": "superseded",
            "diagnostic_code": Option::<&str>::None,
        }),
    );
}

pub(crate) fn coalesce(
    action: &str,
    commit_versions: &[u64],
    merged_frame_count: u64,
    changed_row_count: usize,
    flush_path: Option<&str>,
    stats: &LiveCoalesceStats,
) {
    let Some(timestamp_ms) = timestamp_ms() else {
        return;
    };
    emit_at(
        timestamp_ms,
        json!({
            "event": "coalesce",
            "action": action,
            "commit_versions": commit_versions,
            "merged_frame_count": merged_frame_count,
            "changed_row_count": changed_row_count,
            "flush_path": flush_path,
            "stats": {
                "deferred_commits": stats.deferred_commits,
                "coalesced_flushes": stats.coalesced_flushes,
                "backstop_flushes": stats.backstop_flushes,
                "last_flush_merged_frames": stats.last_flush_merged_frames,
            },
        }),
    );
}

pub(crate) fn mutate_settle(
    timestamp_ms: Option<f64>,
    phase: &str,
    mutation: &str,
    client_mutation_id: Option<&str>,
    status: Option<u16>,
) {
    let Some(timestamp_ms) = timestamp_ms else {
        return;
    };
    emit_at(
        timestamp_ms,
        json!({
            "event": "mutate_settle",
            "phase": phase,
            "mutation": mutation,
            "client_mutation_id": client_mutation_id,
            "status": status,
            "phase_timestamp_ms": timestamp_ms,
        }),
    );
}

pub(crate) fn fence(
    subscription_id: &str,
    action: &str,
    authorization: &AuthorizationVersion,
    latency_ms: Option<f64>,
) {
    let Some(timestamp_ms) = timestamp_ms() else {
        return;
    };
    emit_at(
        timestamp_ms,
        json!({
            "event": "fence",
            "subscription_id": subscription_id,
            "action": action,
            "authorization_incarnation": authorization.incarnation,
            "authorization_epoch": authorization.epoch,
            "latency_ms": latency_ms,
        }),
    );
}

pub(crate) fn watermark(
    subscription_id: &str,
    connection_id: &str,
    version: u64,
    action: &str,
    coalesced_count: u64,
) {
    let Some(timestamp_ms) = timestamp_ms() else {
        return;
    };
    emit_at(
        timestamp_ms,
        json!({
            "event": "watermark",
            "subscription_id": subscription_id,
            "connection_id": connection_id,
            "version": version,
            "action": action,
            "coalesced_count": coalesced_count,
        }),
    );
}
