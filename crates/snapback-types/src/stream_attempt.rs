use crate::diagnostic::{SnapbackError, SnapbackResult};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeMap;

/// Stable privacy identity for a streaming action. Session reconnects compare
/// the user id, service reconnects the credential id, while anonymous access
/// remains connection-bound.
///
/// @ref LLP 0204#d91--streaming-conversations — possession of a
/// room key is never stream read authority.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(tag = "kind", content = "key", rename_all = "snake_case")]
pub enum StreamInitiator {
    SessionUser(String),
    ServiceCredential(String),
    AnonymousConnection(String),
}

/// The five frozen terminal settlement kinds (LLP 0075
/// `requiredSettlementKinds`); the certainty axis is orthogonal, never a
/// sixth kind.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum StreamAttemptCause {
    Complete,
    Failed,
    Cancelled,
    TimedOut,
    Ambiguous,
}

impl StreamAttemptCause {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "complete" => Some(Self::Complete),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            "timed_out" => Some(Self::TimedOut),
            "ambiguous" => Some(Self::Ambiguous),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::TimedOut => "timed_out",
            Self::Ambiguous => "ambiguous",
        }
    }
}

/// The crash-safe effect-certainty axis (LLP 0076 §Settlement and retry).
/// This module holds the process-live state machine; the durable write-ahead
/// pre-mark substrate is tracked by the initiation-state ticket.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamInitiationState {
    DefinitelyNotInitiated,
    InitiationPossible,
    ResponseObserved,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamAttemptSettledBy {
    Authored,
    Terminalizer,
}

/// The committed terminal fact. Once written it never changes; later settle
/// calls receive this exact record verbatim ("the durable winner is
/// authoritative").
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamAttemptTerminal {
    pub cause: StreamAttemptCause,
    /// True when any child cursor's `initiationState` is not
    /// `definitely_not_initiated` — the pessimistic parent fold of
    /// decision 3.
    pub effect_may_have_executed: bool,
    pub settled_by: StreamAttemptSettledBy,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamAttemptStart {
    pub attempt_token: String,
    pub runner_generation: u64,
    /// Whether THIS invocation holds the single-runner lease. A concurrent
    /// caller receives the same attempt without the lease and cannot commit
    /// progress or settle.
    pub lease_held: bool,
    pub progress_commits: u64,
    pub terminal: Option<StreamAttemptTerminal>,
}

/// The durable shape of one attempt row (`_snapback_stream_attempts.record_json`).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedStreamCursor {
    pub initiation_state: StreamInitiationState,
    pub open: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedStreamAttempt {
    pub token: String,
    pub client_key: String,
    pub runner_generation: u64,
    pub progress_commits: u64,
    pub cursors_opened: u64,
    #[serde(default)]
    pub cursors: BTreeMap<String, PersistedStreamCursor>,
    #[serde(default)]
    pub terminal: Option<StreamAttemptTerminal>,
    #[serde(default)]
    pub function_id: Option<String>,
    #[serde(default)]
    pub initiator: Option<StreamInitiator>,
    #[serde(default)]
    pub started_at_ms: u64,
    #[serde(default)]
    pub settled_at_ms: Option<u64>,
    #[serde(default)]
    pub emitted_bytes: u64,
    #[serde(default)]
    pub chunk_count: u64,
}

impl PersistedStreamAttempt {
    pub fn to_row(&self) -> SnapbackResult<(String, String, String)> {
        let json = serde_json::to_string(self).map_err(|error| {
            SnapbackError::error(
                "SNAPBACK_ACTION_STREAM_INVALID",
                "runtime",
                "the stream attempt record could not be serialized",
            )
            .with_details(json!({ "operation": "persist", "error": error.to_string() }))
        })?;
        Ok((self.token.clone(), self.client_key.clone(), json))
    }
}

/// Startup reconciliation for a persisted attempt row whose runner died with
/// the process: a non-terminal row gains a `failed` terminal from the
/// terminalizer, with the effect fact folded conservatively from the
/// write-ahead cursor states (`initiation_possible` reads as
/// effect-may-have-executed). Returns the updated JSON, or None when the row
/// already carries its durable winner.
// @ref LLP 0076#settlement-and-retry — a crash after the pre-mark leaves
//   `initiation_possible`, which is the conservative reading; resolution of
//   the uncertainty is LLP 0070's lookup path, never a silent retry.
pub fn reconcile_orphaned_record_host(record_json: &str) -> Option<String> {
    let mut persisted: PersistedStreamAttempt = serde_json::from_str(record_json).ok()?;
    if persisted.terminal.is_some() {
        return None;
    }
    let effect = persisted
        .cursors
        .values()
        .any(|cursor| cursor.initiation_state != StreamInitiationState::DefinitelyNotInitiated);
    persisted.terminal = Some(StreamAttemptTerminal {
        cause: StreamAttemptCause::Failed,
        effect_may_have_executed: effect,
        settled_by: StreamAttemptSettledBy::Terminalizer,
    });
    persisted.settled_at_ms = Some(unix_time_millis());
    for cursor in persisted.cursors.values_mut() {
        cursor.open = false;
    }
    serde_json::to_string(&persisted).ok()
}

fn unix_time_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}
