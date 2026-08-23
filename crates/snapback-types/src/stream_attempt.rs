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

const STREAM_ATTEMPT_PERSISTENCE_SIGNATURE_DOMAIN: &[u8] =
    b"snapback.stream-attempt-persistence.v1\0";

/// An exact registry snapshot authorized for one storage write. The row bytes
/// remain inspectable for persistence, but altering any byte invalidates the
/// signature. Storage additionally requires the issuer key registered when
/// its serving graph was constructed.
pub struct StreamAttemptPersistenceBatch {
    rows: Vec<(String, String, String)>,
    issuer_public_key: Vec<u8>,
    signature: Vec<u8>,
}

impl StreamAttemptPersistenceBatch {
    #[doc(hidden)]
    pub fn from_signed_parts(
        rows: Vec<(String, String, String)>,
        issuer_public_key: Vec<u8>,
        signature: Vec<u8>,
    ) -> Self {
        Self {
            rows,
            issuer_public_key,
            signature,
        }
    }

    pub fn rows(&self) -> &[(String, String, String)] {
        &self.rows
    }

    #[doc(hidden)]
    pub fn issuer_public_key(&self) -> &[u8] {
        &self.issuer_public_key
    }

    #[doc(hidden)]
    pub fn signature(&self) -> &[u8] {
        &self.signature
    }

    #[doc(hidden)]
    pub fn signing_message(&self) -> Vec<u8> {
        stream_attempt_persistence_signing_message(&self.rows)
    }
}

/// Canonical, length-delimited bytes signed by the stream-attempt registry.
/// Length prefixes prevent tuple or field-boundary ambiguity.
#[doc(hidden)]
pub fn stream_attempt_persistence_signing_message(rows: &[(String, String, String)]) -> Vec<u8> {
    let payload_len = rows.iter().fold(0usize, |total, row| {
        total
            .saturating_add(8)
            .saturating_add(row.0.len())
            .saturating_add(8)
            .saturating_add(row.1.len())
            .saturating_add(8)
            .saturating_add(row.2.len())
    });
    let mut message = Vec::with_capacity(
        STREAM_ATTEMPT_PERSISTENCE_SIGNATURE_DOMAIN
            .len()
            .saturating_add(8)
            .saturating_add(payload_len),
    );
    message.extend_from_slice(STREAM_ATTEMPT_PERSISTENCE_SIGNATURE_DOMAIN);
    message.extend_from_slice(&(rows.len() as u64).to_be_bytes());
    for (token, client_key, record_json) in rows {
        for field in [
            token.as_bytes(),
            client_key.as_bytes(),
            record_json.as_bytes(),
        ] {
            message.extend_from_slice(&(field.len() as u64).to_be_bytes());
            message.extend_from_slice(field);
        }
    }
    message
}
