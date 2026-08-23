use crate::diagnostic::{SnapbackError, SnapbackResult};
use hmac::{Hmac, Mac as _};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::Sha256;
use std::collections::BTreeMap;
use zeroize::Zeroizing;

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

type StreamAttemptPersistenceHmac = Hmac<Sha256>;

const STREAM_ATTEMPT_PERSISTENCE_KEY_BYTES: usize = 32;
const STREAM_ATTEMPT_PERSISTENCE_ISSUER_DOMAIN: &[u8] =
    b"snapback.stream-attempt-persistence.issuer.hmac-sha256.v1\0";
const STREAM_ATTEMPT_PERSISTENCE_MAC_DOMAIN: &[u8] =
    b"snapback.stream-attempt-persistence.mac.hmac-sha256.v1\0";

fn stream_attempt_persistence_hmac(key: &[u8], message: &[u8]) -> [u8; 32] {
    let mut mac = StreamAttemptPersistenceHmac::new_from_slice(key)
        .expect("HMAC-SHA256 accepts stream-attempt key material");
    mac.update(message);
    let bytes = mac.finalize().into_bytes();
    let mut tag = [0; 32];
    tag.copy_from_slice(&bytes);
    tag
}

/// Process-local HMAC-SHA256 authority held only by the stream-attempt
/// registry. Its verification half can cross the adopt-time crate boundary
/// without exposing an API that authenticates caller-selected rows.
///
/// @ref LLP 0076#settlement-and-retry — persistence binds the exact registry
/// bytes while keeping raw kernel writes available for startup reconciliation.
#[doc(hidden)]
pub struct StreamAttemptPersistenceMacKey {
    material: Zeroizing<[u8; STREAM_ATTEMPT_PERSISTENCE_KEY_BYTES]>,
    issuer: [u8; 32],
}

impl StreamAttemptPersistenceMacKey {
    pub fn generate() -> Result<Self, ()> {
        let mut material = [0; STREAM_ATTEMPT_PERSISTENCE_KEY_BYTES];
        getrandom::fill(&mut material).map_err(|_| ())?;
        let issuer =
            stream_attempt_persistence_hmac(&material, STREAM_ATTEMPT_PERSISTENCE_ISSUER_DOMAIN);
        Ok(Self {
            material: Zeroizing::new(material),
            issuer,
        })
    }

    pub fn verifier(&self) -> StreamAttemptPersistenceVerifier {
        StreamAttemptPersistenceVerifier {
            material: self.material.clone(),
            issuer: self.issuer,
        }
    }

    pub fn authenticate(
        &self,
        rows: Vec<(String, String, String)>,
    ) -> StreamAttemptPersistenceBatch {
        let message = stream_attempt_persistence_authentication_message(&rows);
        let authentication_tag =
            stream_attempt_persistence_hmac(self.material.as_slice(), &message).to_vec();
        StreamAttemptPersistenceBatch {
            rows,
            issuer: self.issuer.to_vec(),
            authentication_tag,
        }
    }
}

/// Verify-only projection of the process-local persistence MAC key. The key
/// material remains opaque even though this carrier crosses crate boundaries.
#[doc(hidden)]
pub struct StreamAttemptPersistenceVerifier {
    material: Zeroizing<[u8; STREAM_ATTEMPT_PERSISTENCE_KEY_BYTES]>,
    issuer: [u8; 32],
}

impl StreamAttemptPersistenceVerifier {
    pub fn issuer(&self) -> &[u8] {
        &self.issuer
    }

    pub fn verify(&self, message: &[u8], authentication_tag: &[u8]) -> bool {
        let Ok(mut mac) = StreamAttemptPersistenceHmac::new_from_slice(self.material.as_slice())
        else {
            return false;
        };
        mac.update(message);
        mac.verify_slice(authentication_tag).is_ok()
    }
}

/// An exact registry snapshot authenticated for one storage write. The row
/// bytes remain inspectable for persistence, but altering any byte invalidates
/// the HMAC-SHA256 tag. Storage additionally requires the issuer registered
/// when its serving graph was constructed.
pub struct StreamAttemptPersistenceBatch {
    rows: Vec<(String, String, String)>,
    issuer: Vec<u8>,
    authentication_tag: Vec<u8>,
}

impl StreamAttemptPersistenceBatch {
    #[doc(hidden)]
    pub fn from_authenticated_parts(
        rows: Vec<(String, String, String)>,
        issuer: Vec<u8>,
        authentication_tag: Vec<u8>,
    ) -> Self {
        Self {
            rows,
            issuer,
            authentication_tag,
        }
    }

    pub fn rows(&self) -> &[(String, String, String)] {
        &self.rows
    }

    #[doc(hidden)]
    pub fn issuer(&self) -> &[u8] {
        &self.issuer
    }

    #[doc(hidden)]
    pub fn authentication_tag(&self) -> &[u8] {
        &self.authentication_tag
    }

    #[doc(hidden)]
    pub fn authentication_message(&self) -> Vec<u8> {
        stream_attempt_persistence_authentication_message(&self.rows)
    }
}

/// Canonical, length-delimited bytes authenticated by the stream-attempt
/// registry. Length prefixes prevent tuple or field-boundary ambiguity.
#[doc(hidden)]
pub fn stream_attempt_persistence_authentication_message(
    rows: &[(String, String, String)],
) -> Vec<u8> {
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
        STREAM_ATTEMPT_PERSISTENCE_MAC_DOMAIN
            .len()
            .saturating_add(8)
            .saturating_add(payload_len),
    );
    message.extend_from_slice(STREAM_ATTEMPT_PERSISTENCE_MAC_DOMAIN);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_attempt_persistence_uses_hmac_sha256() {
        // RFC 4231 test case 1 pins the primitive independently of the batch
        // framing and issuer-domain separation around it.
        assert_eq!(
            stream_attempt_persistence_hmac(&[0x0b; 20], b"Hi There"),
            [
                0xb0, 0x34, 0x4c, 0x61, 0xd8, 0xdb, 0x38, 0x53, 0x5c, 0xa8, 0xaf, 0xce, 0xaf, 0x0b,
                0xf1, 0x2b, 0x88, 0x1d, 0xc2, 0x00, 0xc9, 0x83, 0x3d, 0xa7, 0x26, 0xe9, 0x37, 0x6c,
                0x2e, 0x32, 0xcf, 0xf7,
            ]
        );
    }

    #[test]
    fn stream_attempt_persistence_framing_disambiguates_row_sets() {
        let rows_a = vec![
            ("a".to_owned(), "b".to_owned(), "c".to_owned()),
            ("d".to_owned(), "e".to_owned(), "f".to_owned()),
        ];
        let rows_b = vec![
            ("ab".to_owned(), "c".to_owned(), "d".to_owned()),
            (String::new(), "e".to_owned(), "f".to_owned()),
        ];
        let concatenate_without_lengths = |rows: &[(String, String, String)]| {
            let mut bytes = Vec::new();
            for (token, client_key, record_json) in rows {
                bytes.extend_from_slice(token.as_bytes());
                bytes.extend_from_slice(client_key.as_bytes());
                bytes.extend_from_slice(record_json.as_bytes());
            }
            bytes
        };

        assert_ne!(rows_a, rows_b);
        assert_eq!(
            concatenate_without_lengths(&rows_a),
            concatenate_without_lengths(&rows_b)
        );

        let key = [0x42; STREAM_ATTEMPT_PERSISTENCE_KEY_BYTES];
        assert_ne!(
            stream_attempt_persistence_hmac(
                &key,
                &stream_attempt_persistence_authentication_message(&rows_a),
            ),
            stream_attempt_persistence_hmac(
                &key,
                &stream_attempt_persistence_authentication_message(&rows_b),
            )
        );
    }
}
