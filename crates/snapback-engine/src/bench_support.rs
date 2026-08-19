//! Engine-owned support for the agent-safe fork/promotion benchmark.

use std::path::Path;

use serde_json::json;
use snapback_types::bench_fixture::{args, functions, schema};
use snapback_types::commit_envelope::ClientIdentityRangeV1;

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::local::LocalSnapback;

/// File-backed acceptance twin for the agent-safe active-lane byte and idle
/// observations. Unlike the feature-gated telemetry fixture (which lives with
/// the phase-1 evidence harness), this is compiled only as a private input to
/// the dated paired recorder.
#[doc(hidden)]
pub fn configured_file_agent_safe(path: impl AsRef<Path>) -> SnapbackResult<LocalSnapback> {
    let mut snapback = LocalSnapback::open(path)?;
    snapback.apply_schema(schema())?;
    snapback.load_functions(functions());
    Ok(snapback)
}

fn open_configured_file_agent_safe(path: impl AsRef<Path>) -> SnapbackResult<LocalSnapback> {
    let mut snapback = LocalSnapback::open(path)?;
    snapback.load_functions(functions());
    Ok(snapback)
}

/// One real file-backed ordinary-mutation writer for the dated LLP 0162
/// contention recorder. Construction installs a distinct server-issued range;
/// every timed call runs the same issuance-bearing carrier as the paired
/// active-lane fixture and returns only after its storage transaction commits.
///
/// @ref LLP 0162#measurement-gate — contention p99 measures the covered writer,
///   not a raw SQL stand-in that bypasses envelope and write-authority costs.
#[doc(hidden)]
pub struct AgentSafeActiveContentionWriter {
    snapback: LocalSnapback,
    range: ClientIdentityRangeV1,
    next_counter: u64,
}

/// Create the shared production-shaped database and return its server-owned
/// canonical stream. Reservation admission and the writer transaction compare
/// this exact durable identity; the recorder never substitutes `"canonical"`.
#[doc(hidden)]
pub fn prepare_agent_safe_active_contention_database(
    path: impl AsRef<Path>,
) -> SnapbackResult<String> {
    let mut snapback = configured_file_agent_safe(path)?;
    let (stream_id, _) = snapback.prepare_agent_safe_active_lane_benchmark_for_client(
        &args(json!({ "title": "contention setup" })),
        "agent-safe-contention-setup",
    )?;
    Ok(stream_id)
}

impl AgentSafeActiveContentionWriter {
    pub fn open(
        path: impl AsRef<Path>,
        worker: usize,
        expected_stream_id: &str,
    ) -> SnapbackResult<Self> {
        let mut snapback = open_configured_file_agent_safe(path)?;
        let client_audience_id = format!("agent-safe-contention-worker-{worker}");
        let (stream_id, range) = snapback.prepare_agent_safe_active_lane_benchmark_for_client(
            &args(json!({ "title": "contention writer setup" })),
            &client_audience_id,
        )?;
        if stream_id != expected_stream_id {
            return Err(SnapbackError::error(
                "SNAPBACK_BENCH_STREAM_DIVERGED",
                "bench",
                "concurrent ordinary writer reopened on a different canonical stream",
            ));
        }
        let next_counter = range.range_start;
        Ok(Self {
            snapback,
            range,
            next_counter,
        })
    }

    pub fn commit_next(&mut self, worker: usize, ordinal: usize) -> SnapbackResult<()> {
        let counter = self.next_counter;
        self.snapback
            .invoke_agent_safe_active_lane_benchmark_mutation(
                "createTodo",
                args(json!({
                    "title": format!("contention-{worker}-{ordinal}")
                })),
                &self.range,
                counter,
            )?;
        self.next_counter = self.next_counter.checked_add(1).ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_BENCH_RANGE_EXHAUSTED",
                "bench",
                "contention benchmark counter overflowed",
            )
        })?;
        Ok(())
    }
}
