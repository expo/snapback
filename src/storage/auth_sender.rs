//! Storage-owned sender-proof replay and nonce admission.
//!
//! The server layer never receives a raw SQLite connection. Hosted preflight
//! initializes this authority once; each protected request then borrows it
//! through the existing serialized app-instance lane before body ingestion.

use super::LocalDatabase;
use crate::auth::sender_proof::{
    ReplayConsumeError, SenderAdmission, SenderAdmissionRejection, SenderCoverNonceKey,
    admit_sender_constrained_bound_request, admit_sender_constrained_request,
    initialize_sender_proof_replay_after_hosted_preflight,
    rotate_sender_replay_epoch_for_stream_reset, sender_replay_epoch,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use rusqlite::Transaction;

fn sender_authority_error(reason: &'static str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_SENDER_PROOF_AUTHORITY_UNAVAILABLE",
        "auth",
        "sender proof authority is unavailable",
    )
    .with_details(serde_json::json!({ "reason": reason }))
}

pub(super) fn rotate_sender_authority_for_stream_reset(
    transaction: &Transaction<'_>,
) -> SnapbackResult<()> {
    rotate_sender_replay_epoch_for_stream_reset(transaction)
        .map_err(|_| sender_authority_error("epoch-rotation"))
}

impl LocalDatabase {
    /// DDL authority retained exclusively by authenticated hosted preflight.
    ///
    /// @ref LLP 0077#http-binding — request verification cannot create or
    /// repair its replay/nonce tables.
    #[allow(dead_code)] // Invoked when a concrete hosted adapter installs authority.
    pub(crate) fn initialize_sender_proof_after_hosted_preflight(&self) -> SnapbackResult<()> {
        initialize_sender_proof_replay_after_hosted_preflight(&self.conn).map_err(|error| {
            let reason = match error {
                ReplayConsumeError::Capacity => "capacity",
                ReplayConsumeError::Replay => "replay",
                ReplayConsumeError::Unavailable => "unavailable",
                ReplayConsumeError::Invalid => "invalid",
            };
            SnapbackError::error(
                "SNAPBACK_AUTH_SENDER_PROOF_AUTHORITY_UNAVAILABLE",
                "auth",
                "sender proof authority could not be initialized",
            )
            .with_details(serde_json::json!({ "reason": reason }))
        })
    }

    #[cfg(test)]
    pub(crate) fn make_sender_proof_replay_unavailable_for_test(&self) -> SnapbackResult<()> {
        self.conn
            .execute_batch("DROP TABLE _snapback_sender_proof_replay;")
            .map_err(Into::into)
    }

    /// Exact pre-body admission through the storage-owned SQLite authority.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn admit_sender_constrained_http_request(
        &mut self,
        method: &str,
        canonical_external_uri: &str,
        access_token: &str,
        compact_proof: Option<&str>,
        now_seconds: u64,
        nonce_ttl_seconds: u64,
        allow_superseded_grace: bool,
        cover_key: Option<&SenderCoverNonceKey>,
    ) -> Result<SenderAdmission, SenderAdmissionRejection> {
        let sender_replay_epoch = sender_replay_epoch(&self.conn)
            .map_err(|_| SenderAdmissionRejection::authority_unavailable())?;
        admit_sender_constrained_request(
            &mut self.conn,
            sender_replay_epoch,
            method,
            canonical_external_uri,
            access_token,
            compact_proof,
            now_seconds,
            nonce_ttl_seconds,
            allow_superseded_grace,
            None,
            None,
            cover_key,
        )
    }

    /// Exact pre-body admission for a grant already bound to one session
    /// family by the protected connection-open request.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn admit_sender_constrained_grant_request(
        &mut self,
        method: &str,
        canonical_external_uri: &str,
        connection_token: &str,
        compact_proof: Option<&str>,
        family_jwk_thumbprint: &str,
        now_seconds: u64,
        nonce_ttl_seconds: u64,
    ) -> Result<SenderAdmission, SenderAdmissionRejection> {
        let sender_replay_epoch = sender_replay_epoch(&self.conn)
            .map_err(|_| SenderAdmissionRejection::authority_unavailable())?;
        admit_sender_constrained_bound_request(
            &mut self.conn,
            sender_replay_epoch,
            method,
            canonical_external_uri,
            connection_token,
            compact_proof,
            family_jwk_thumbprint,
            now_seconds,
            nonce_ttl_seconds,
            None,
            None,
        )
    }
}
