//! Shared session-projection carriers consumed below the sync engine.

use crate::contract_types::TokenDigest;
use std::time::Duration;

pub const TERMINAL_CLOSE_GRACE: Duration = Duration::from_millis(5_000);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectedSessionInsert {
    pub session_id: String,
    pub user_id: String,
    pub provider: String,
    pub authority_instance_id: String,
    pub generation: u64,
    pub token_digest: TokenDigest,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
    pub absolute_expires_at_ms: u64,
    pub rehearsal_provenance: Option<crate::auth::rehearsal::AuthRehearsalProvenanceV1>,
}
