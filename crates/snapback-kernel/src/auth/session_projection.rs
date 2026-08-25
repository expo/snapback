use crate::contract_types::AuthorizationStreamIncarnation;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use serde::{Deserialize, Serialize};
use std::fmt;

const AUTHORIZATION_STREAM_FORMAT_VERSION: u32 = 1;
pub const AUTHORIZATION_STREAM_META_KEY: &str = "auth_stream_incarnation_v1";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizationStreamRecord {
    format_version: u32,
    incarnation: String,
}

impl AuthorizationStreamRecord {
    pub fn new(incarnation: AuthorizationStreamIncarnation) -> Self {
        Self {
            format_version: AUTHORIZATION_STREAM_FORMAT_VERSION,
            incarnation: incarnation.0,
        }
    }

    /// Parse the closed record and require byte-for-byte canonical encoding.
    /// This rejects whitespace, reordered fields, duplicate fields, unknown
    /// fields, non-UTF-8 input, and non-canonical UUID spellings alike.
    pub fn parse_exact(bytes: &[u8]) -> SnapbackResult<Self> {
        let record: Self = serde_json::from_slice(bytes).map_err(|_| {
            stream_corrupt("authorization-stream metadata is not a closed format-1 record")
        })?;
        record.validate()?;
        let canonical = record.encode_bytes()?;
        if canonical != bytes {
            return Err(stream_corrupt(
                "authorization-stream metadata is not canonically encoded",
            ));
        }
        Ok(record)
    }

    pub fn encode_bytes(&self) -> SnapbackResult<Vec<u8>> {
        self.validate()?;
        serde_json::to_vec(self)
            .map_err(|_| stream_corrupt("authorization-stream metadata could not be encoded"))
    }

    pub fn encode_string(&self) -> SnapbackResult<String> {
        String::from_utf8(self.encode_bytes()?)
            .map_err(|_| stream_corrupt("authorization-stream metadata could not be encoded"))
    }

    pub fn incarnation(&self) -> AuthorizationStreamIncarnation {
        AuthorizationStreamIncarnation(self.incarnation.clone())
    }

    fn validate(&self) -> SnapbackResult<()> {
        if self.format_version != AUTHORIZATION_STREAM_FORMAT_VERSION {
            return Err(stream_corrupt(
                "authorization-stream metadata has an unsupported format",
            ));
        }
        AuthorizationStreamIncarnation::parse(&self.incarnation)?;
        Ok(())
    }
}

/// Raw rows copied from one SQLite read transaction. Numeric fields remain
/// signed and digests remain variable-length until detached validation so a
/// malformed database cannot be normalized accidentally while reading it.
#[derive(Clone, Eq, PartialEq)]
pub struct ProjectionSource {
    pub authorization_stream_value: Vec<u8>,
    pub restore_declaration_id: Option<Vec<u8>>,
    pub users: Vec<ProjectionUserRow>,
    pub identities: Vec<ProjectionIdentityRow>,
    pub sessions: Vec<ProjectionSessionRow>,
    pub superseded_tokens: Vec<ProjectionTokenRow>,
}

impl fmt::Debug for ProjectionSource {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ProjectionSource([REDACTED])")
    }
}

#[derive(Clone, Eq, PartialEq)]
pub struct ProjectionUserRow {
    pub id: String,
    pub created_at_ms: i64,
}

#[derive(Clone, Eq, PartialEq)]
pub struct ProjectionIdentityRow {
    pub id: String,
    pub user_id: String,
    pub provider: String,
    pub verified_at_ms: i64,
}

#[derive(Clone, Eq, PartialEq)]
pub struct ProjectionSessionRow {
    pub id: String,
    pub user_id: String,
    pub identity_id: String,
    pub authority_instance_id: String,
    pub token_hash: Vec<u8>,
    pub generation: i64,
    pub created_at_ms: i64,
    pub last_used_at_ms: i64,
    pub expires_at_ms: i64,
    pub absolute_expires_at_ms: i64,
    pub revoked_at_ms: Option<i64>,
    pub terminal_cause: Option<Vec<u8>>,
    pub rehearsal_provenance: Option<crate::auth::rehearsal::AuthRehearsalProvenanceV1>,
}

#[derive(Clone, Eq, PartialEq)]
pub struct ProjectionTokenRow {
    pub token_hash: Vec<u8>,
    pub session_id: String,
    pub superseded_at_ms: i64,
}

fn stream_corrupt(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT", "auth", message)
}
