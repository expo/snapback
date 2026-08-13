//! Commit-ordered authorization-lease reservation and service admission.
//!
//! @ref LLP 0053#the-lease-the-only-mechanism-for-the-unreachable-client — a
//! full-query capture may mint a lease only after one IMMEDIATE transaction
//! proves the exact app head, authority pair, version stream, activation, empty
//! obligation state, and durable server clock high-water.

use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};

use super::auth_invalidation::{
    AUTH_CLOCK_META_KEY, ensure_data_version_stream_in, strict_meta_u64, write_meta_u64,
};
use super::auth_mode::{OpenAuthModeInspection, inspect_for_open};
use super::auth_stream::ensure_authorization_version_in;
use super::{LocalDatabase, MAX_AUTHORIZATION_EPOCH, current_version_on};
use crate::auth::invalidation::IssuerId;
use crate::auth::lease::{
    AuthorizedLease, AuthorizedLeaseConfig, VerifiedAuthorizedLease,
    authorized_lease_activation_hash,
};
use crate::auth::mode::{AppDataAvailability, AuthModeStatus};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::AuthMode;

fn lease_storage_error(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "auth", message.into())
}

fn stale(message: impl Into<String>) -> SnapbackError {
    lease_storage_error("SNAPBACK_AUTHORIZED_LEASE_STALE", message)
}

fn unavailable(message: impl Into<String>) -> SnapbackError {
    lease_storage_error("SNAPBACK_AUTHORIZED_LEASE_UNAVAILABLE", message)
}

impl LocalDatabase {
    /// Reserve a freshly signed lease after the full query has completed.
    ///
    /// The caller owns the app-instance write lane while this runs. Therefore
    /// its process-local `no_pending_obligation` observation cannot change
    /// between this check and the SQLite transaction; every app-data,
    /// authorization, and activation writer is rechecked durably below.
    pub(crate) fn reserve_authorized_lease(
        &mut self,
        lease: &AuthorizedLease,
        config: AuthorizedLeaseConfig,
        now_ms: u64,
        no_pending_obligation: bool,
        current_issuer_id: &IssuerId,
    ) -> SnapbackResult<()> {
        lease.validate_shape(config)?;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        advance_auth_clock_in(&tx, now_ms)?;

        let semantic_error = if lease.issued_at_server_ms != now_ms {
            Some(stale(
                "lease issuance sample differs from the reservation clock sample",
            ))
        } else if !no_pending_obligation {
            Some(stale(
                "an authorization/query/connection obligation is pending",
            ))
        } else if lease.issuer_id != *current_issuer_id {
            Some(stale(
                "authorized lease issuer is not the current process issuer",
            ))
        } else {
            lease_state_error(&tx, lease, now_ms)?
        };
        if let Some(error) = semantic_error {
            // Persist the observed clock even though this snapshot lost its
            // comparison. A later rollback cannot exploit a failed issuance.
            tx.commit()?;
            return Err(error);
        }

        let duplicate: Option<String> = tx
            .query_row(
                "SELECT lease_id FROM _snapback_authorized_lease_reservations
                 WHERE lease_request_id = ?1 OR lease_id = ?2
                 LIMIT 1",
                params![lease.lease_request_id, lease.lease_id],
                |row| row.get(0),
            )
            .optional()?;
        if duplicate.is_some() {
            tx.commit()?;
            return Err(lease_storage_error(
                "SNAPBACK_AUTHORIZED_LEASE_REQUEST_REUSED",
                "lease request or lease identity was already reserved",
            ));
        }

        tx.execute(
            "DELETE FROM _snapback_authorized_lease_reservations
             WHERE authorized_until_server_ms <= ?1",
            params![as_i64(now_ms, "server clock")?],
        )?;
        let lease_json = serde_json::to_string(lease).map_err(|_| {
            lease_storage_error(
                "SNAPBACK_AUTHORIZED_LEASE_INVALID",
                "authorized lease could not be encoded canonically",
            )
        })?;
        tx.execute(
            "INSERT INTO _snapback_authorized_lease_reservations(
                lease_request_id, lease_id, client_store_id, query_key,
                query_instance_id, principal_id, authorization_incarnation,
                authorization_epoch, version_stream, snapshot_commit_version,
                activation_hash, issued_at_server_ms,
                authorized_until_server_ms, lease_json
             ) VALUES(
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14
             )",
            params![
                lease.lease_request_id,
                lease.lease_id,
                lease.client_store_id,
                lease.query_key,
                as_i64(lease.query_instance_id, "query instance")?,
                lease.principal_id,
                lease.authorization.incarnation,
                as_i64(lease.authorization.epoch, "authorization epoch")?,
                lease.data.version_stream,
                as_i64(
                    lease.data.snapshot_commit_version,
                    "snapshot commit version"
                )?,
                lease.activation_hash,
                as_i64(lease.issued_at_server_ms, "issued-at time")?,
                as_i64(lease.authorized_until_server_ms, "authorized-until time")?,
                lease_json,
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Gate every service that would otherwise trust a retained snapshot
    /// without a fresh query. Keyring verification happens before the app lock
    /// and produces the non-forgeable token accepted here; this transaction
    /// then checks current mutable state and advances the durable clock.
    // Staged with the presented-lease service boundary; issuance must not call
    // this path merely to make the verifier appear production-reachable.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn authorize_revalidation_free_lease(
        &mut self,
        verified: &VerifiedAuthorizedLease,
        config: AuthorizedLeaseConfig,
        now_ms: u64,
        no_pending_obligation: bool,
    ) -> SnapbackResult<()> {
        let lease = verified.lease();
        lease.validate_shape(config)?;
        if now_ms < verified.verified_at_server_ms() {
            return Err(lease_storage_error(
                "SNAPBACK_AUTH_CLOCK_ROLLBACK",
                "service time is behind the verified lease sample",
            ));
        }
        if now_ms >= lease.authorized_until_server_ms {
            return Err(lease_storage_error(
                "SNAPBACK_AUTHORIZED_LEASE_EXPIRED",
                "authorized lease is expired",
            ));
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        advance_auth_clock_in(&tx, now_ms)?;

        let semantic_error = if !no_pending_obligation {
            Some(stale(
                "a revalidation-free service cannot bypass a pending obligation",
            ))
        } else {
            lease_state_error(&tx, lease, now_ms)?
        };
        tx.commit()?;
        if let Some(error) = semantic_error {
            return Err(error);
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn authorized_lease_reservation_count(&self) -> SnapbackResult<u64> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM _snapback_authorized_lease_reservations",
            [],
            |row| row.get(0),
        )?;
        u64::try_from(count).map_err(|_| {
            lease_storage_error(
                "SNAPBACK_AUTHORIZED_LEASE_STATE_CORRUPT",
                "authorized lease reservation count is negative",
            )
        })
    }
}

/// Destructive reset/restore rotates the authority/data streams and destroys
/// every outstanding server reservation in that same transaction. No old
/// request identity can remain the server-side half of a retained result.
pub(super) fn clear_authorized_lease_reservations_in(tx: &Transaction<'_>) -> SnapbackResult<()> {
    tx.execute("DELETE FROM _snapback_authorized_lease_reservations", [])?;
    Ok(())
}

fn advance_auth_clock_in(tx: &Transaction<'_>, now_ms: u64) -> SnapbackResult<()> {
    if now_ms > MAX_AUTHORIZATION_EPOCH {
        return Err(lease_storage_error(
            "SNAPBACK_AUTH_CLOCK_ROLLBACK",
            "server auth clock is outside the canonical JavaScript-safe range",
        ));
    }
    let high_water = strict_meta_u64(tx, AUTH_CLOCK_META_KEY)?.unwrap_or(0);
    if now_ms < high_water {
        return Err(lease_storage_error(
            "SNAPBACK_AUTH_CLOCK_ROLLBACK",
            "server auth clock moved behind its durable high-water",
        ));
    }
    write_meta_u64(tx, AUTH_CLOCK_META_KEY, now_ms)
}

/// `None` means the exact captured lease state remains current.
fn lease_state_error(
    tx: &Transaction<'_>,
    lease: &AuthorizedLease,
    now_ms: u64,
) -> SnapbackResult<Option<SnapbackError>> {
    let deployment = match inspect_for_open(tx)? {
        OpenAuthModeInspection::Managed(snapshot)
            if snapshot.state.active == AuthMode::Sessions
                && snapshot.state.desired == AuthMode::Sessions
                && snapshot.state.mode_state == AuthModeStatus::Settled
                && snapshot.state.app_data_availability == AppDataAvailability::Available =>
        {
            snapshot.state.active_deployment.ok_or_else(|| {
                unavailable("settled sessions mode lacks an active deployment identity")
            })?
        }
        _ => {
            return Ok(Some(unavailable(
                "authorized leases require settled available sessions mode",
            )));
        }
    };
    let authorization = ensure_authorization_version_in(tx)?;
    let version_stream = ensure_data_version_stream_in(tx)?;
    let head = current_version_on(tx)?;
    if lease.authorization != authorization {
        return Ok(Some(stale(
            "authorized lease authorization pair is no longer current",
        )));
    }
    if lease.data.version_stream != version_stream {
        return Ok(Some(stale(
            "authorized lease data version stream is no longer current",
        )));
    }
    if lease.data.snapshot_commit_version != head {
        return Ok(Some(stale(
            "authorized lease snapshot is not at the exact current app-data head",
        )));
    }
    if lease.activation_hash != authorized_lease_activation_hash(&deployment) {
        return Ok(Some(stale(
            "authorized lease activation identity is no longer current",
        )));
    }
    if lease.issuer_id.authorization_incarnation != authorization.incarnation {
        return Ok(Some(stale(
            "authorized lease issuer is from another authorization incarnation",
        )));
    }
    if let Some(error) = lease_session_state_error(tx, lease, now_ms)? {
        return Ok(Some(error));
    }
    Ok(None)
}

fn lease_session_state_error(
    tx: &Transaction<'_>,
    lease: &AuthorizedLease,
    now_ms: u64,
) -> SnapbackResult<Option<SnapbackError>> {
    let Some(session_id) = lease.session_id_at_issue.as_deref() else {
        return Ok(None);
    };
    if lease.session_not_after_ms.is_none() {
        return Ok(Some(stale(
            "session-bound authorized lease lacks its captured expiry",
        )));
    }
    let current = tx
        .query_row(
            "SELECT s.user_id, i.provider, s.authority_instance_id,
                    s.expires_at_ms, s.absolute_expires_at_ms,
                    s.revoked_at_ms IS NOT NULL
               FROM _auth_sessions AS s
               JOIN _auth_identities AS i
                 ON i.id = s.identity_id AND i.user_id = s.user_id
              WHERE s.id = ?1",
            params![session_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, bool>(5)?,
                ))
            },
        )
        .optional()?;
    let Some((user_id, provider, authority_instance_id, expires_at, absolute_expires_at, revoked)) =
        current
    else {
        return Ok(Some(stale("authorized lease session is no longer present")));
    };
    let expires_at = u64::try_from(expires_at).map_err(|_| {
        unavailable("authorized lease session expiry is outside the canonical range")
    })?;
    let absolute_expires_at = u64::try_from(absolute_expires_at).map_err(|_| {
        unavailable("authorized lease absolute session expiry is outside the canonical range")
    })?;
    let current_not_after = expires_at.min(absolute_expires_at);
    let identity_matches = user_id == lease.principal_id
        && lease.provider_key.as_deref() == Some(provider.as_str())
        && lease
            .authority_instance_id
            .as_deref()
            .is_none_or(|expected| expected == authority_instance_id);
    // Authenticated-use coalescing can publish a newer in-memory session
    // deadline before its durable write. The signed lease is still safe when
    // its effective deadline, rather than that captured projection, fits
    // entirely beneath durable session truth.
    if revoked
        || now_ms >= current_not_after
        || lease.authorized_until_server_ms > current_not_after
        || !identity_matches
    {
        return Ok(Some(stale(
            "authorized lease session authority is no longer current",
        )));
    }
    Ok(None)
}

fn as_i64(value: u64, field: &str) -> SnapbackResult<i64> {
    i64::try_from(value).map_err(|_| {
        lease_storage_error(
            "SNAPBACK_AUTHORIZED_LEASE_INVALID",
            format!("{field} is not representable by the local target"),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::invalidation::IssuerId;
    use crate::auth::lease::{
        AUTHORIZED_LEASE_HARD_MAX_MS, AuthorizedLeaseAuthenticator, AuthorizedLeaseData,
        AuthorizedLeaseExpectation, AuthorizedLeaseIssue,
    };
    use crate::auth::mode::{
        AuthProgramReadiness, DeploymentIdentity, FUNCTION_V1_PREFIX, INPUTS_V1_PREFIX,
        SCHEMA_V1_PREFIX,
    };
    use crate::manifest::{
        AuthManifest, FieldManifest, FieldType, SchemaManifest, SeedData, TableManifest,
    };
    use serde_json::Map;
    use sha2::{Digest as _, Sha256};
    use std::collections::BTreeMap;
    use tempfile::tempdir;

    const NOW: u64 = 1_800_000_000_000;
    const INCARNATION: &str = "01890f3c-9d5b-7000-8000-000000000001";
    const SESSION_ID: &str = "01890f3c-9d5b-7000-8000-000000000006";

    fn digest(prefix: &str, byte: u8) -> String {
        format!("{prefix}{:x}", Sha256::digest([byte; 32]))
    }

    fn sessions_pair() -> (DeploymentIdentity, SchemaManifest) {
        let schema_hash = digest(SCHEMA_V1_PREFIX, 1);
        let bundle_hash = digest(FUNCTION_V1_PREFIX, 2);
        let inputs_hash = digest(INPUTS_V1_PREFIX, 3);
        let manifest = SchemaManifest {
            schema_version: "snapback.v1".to_owned(),
            app_id: "lease-test".to_owned(),
            auth: Some(AuthManifest {
                mode: AuthMode::Sessions,
                agents: None,
                password_identifier_mode: None,
            }),
            schema_hash: Some(schema_hash.clone()),
            inputs_hash: Some(inputs_hash.clone()),
            tables: vec![TableManifest {
                name: "items".to_owned(),
                fields: vec![FieldManifest {
                    name: "owner".to_owned(),
                    field_type: FieldType::String,
                    optional: false,
                }],
                indexes: Vec::new(),
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: None,
                history: None,
            }],
            ..SchemaManifest::default()
        };
        (
            DeploymentIdentity {
                schema_version: "snapback.v1".to_owned(),
                auth_mode: AuthMode::Sessions,
                app_id: "lease-test".to_owned(),
                schema_hash,
                bundle_hash,
                inputs_hash,
            },
            manifest,
        )
    }

    fn sessions_database(path: Option<&std::path::Path>) -> LocalDatabase {
        let mut db = match path {
            Some(path) => LocalDatabase::open(path).unwrap(),
            None => LocalDatabase::memory().unwrap(),
        };
        let (identity, manifest) = sessions_pair();
        db.stage_auth_mode(identity, manifest, None).unwrap();
        db.consume_sessions_auth_mode(&AuthProgramReadiness::new(
            true, true, true, true, true, true, true,
        ))
        .unwrap();
        db.activate_current_auth_catalog().unwrap();
        db.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES(?1, ?2)",
                params!["user_1", NOW as i64 - 1],
            )?;
            crate::storage::insert_test_email_identity(
                tx,
                "identity_1",
                "user_1",
                "lease@example.test",
                NOW - 1,
                false,
            )?;
            crate::storage::insert_test_identity_session(
                tx,
                SESSION_ID,
                "user_1",
                "identity_1",
                "01890f3c-9d5b-7000-8000-000000000004",
                &[0x71_u8; 32],
                NOW - 1,
                NOW - 1,
                NOW + AUTHORIZED_LEASE_HARD_MAX_MS,
                NOW + AUTHORIZED_LEASE_HARD_MAX_MS * 2,
            )?;
            Ok(())
        })
        .unwrap();
        db
    }

    fn signer() -> AuthorizedLeaseAuthenticator {
        AuthorizedLeaseAuthenticator::from_test_key("sbak_AQEBAQEBAQEBAQEBAQEBAQ", [0x51; 32])
    }

    fn lease_with_session_not_after(
        db: &mut LocalDatabase,
        request: &str,
        now_ms: u64,
        session_not_after_ms: u64,
    ) -> AuthorizedLease {
        let (authorization, version_stream, boot_sequence) =
            db.reserve_invalidation_boot_issuer().unwrap();
        let deployment = db
            .auth_mode_snapshot()
            .unwrap()
            .state
            .active_deployment
            .unwrap();
        signer()
            .issue(
                AuthorizedLeaseIssue {
                    lease_id: format!("lease_{request}"),
                    lease_request_id: request.to_owned(),
                    issuer_id: IssuerId {
                        authorization_incarnation: authorization.incarnation.clone(),
                        boot_sequence,
                        boot_nonce: "AQEBAQEBAQEBAQEBAQEBAQ".to_owned(),
                    },
                    client_store_id: "store_1".to_owned(),
                    query_key: "items:{owner=me}".to_owned(),
                    query_instance_id: 1,
                    principal_id: "user_1".to_owned(),
                    session_id_at_issue: Some(SESSION_ID.to_owned()),
                    provider_key: Some("email-code".to_owned()),
                    authorization,
                    data: AuthorizedLeaseData {
                        version_stream,
                        snapshot_commit_version: db.current_version().unwrap(),
                    },
                    activation_hash: authorized_lease_activation_hash(&deployment),
                    session_not_after_ms: Some(session_not_after_ms),
                    provider_not_after_ms: None,
                    authority_instance_id: Some("01890f3c-9d5b-7000-8000-000000000004".to_owned()),
                },
                AuthorizedLeaseConfig::default(),
                now_ms,
                "local-dev-sqlite-ibex",
                "lease-test",
            )
            .unwrap()
    }

    fn current_lease(db: &mut LocalDatabase, request: &str, now_ms: u64) -> AuthorizedLease {
        lease_with_session_not_after(db, request, now_ms, NOW + AUTHORIZED_LEASE_HARD_MAX_MS)
    }

    #[test]
    fn reservation_is_one_atomic_exact_head_auth_activation_and_empty_obligation_proof() {
        let mut db = sessions_database(None);
        let valid = current_lease(&mut db, "request_valid", NOW);
        db.reserve_authorized_lease(
            &valid,
            AuthorizedLeaseConfig::default(),
            NOW,
            true,
            &valid.issuer_id,
        )
        .unwrap();
        assert_eq!(db.authorized_lease_reservation_count().unwrap(), 1);

        let pending = current_lease(&mut db, "request_pending", NOW + 1);
        let error = db
            .reserve_authorized_lease(
                &pending,
                AuthorizedLeaseConfig::default(),
                NOW + 1,
                false,
                &pending.issuer_id,
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTHORIZED_LEASE_STALE");

        let mut wrong_activation = current_lease(&mut db, "request_activation", NOW + 2);
        wrong_activation.activation_hash = format!(
            "snapback.authorized-lease.activation.v1:sha256:{}",
            "f".repeat(64)
        );
        wrong_activation = signer()
            .issue(
                AuthorizedLeaseIssue {
                    lease_id: wrong_activation.lease_id,
                    lease_request_id: wrong_activation.lease_request_id,
                    issuer_id: wrong_activation.issuer_id,
                    client_store_id: wrong_activation.client_store_id,
                    query_key: wrong_activation.query_key,
                    query_instance_id: wrong_activation.query_instance_id,
                    principal_id: wrong_activation.principal_id,
                    session_id_at_issue: wrong_activation.session_id_at_issue,
                    provider_key: wrong_activation.provider_key,
                    authorization: wrong_activation.authorization,
                    data: wrong_activation.data,
                    activation_hash: wrong_activation.activation_hash,
                    session_not_after_ms: Some(NOW + 2 + 86_400_000),
                    provider_not_after_ms: None,
                    authority_instance_id: wrong_activation.authority_instance_id,
                },
                AuthorizedLeaseConfig::default(),
                NOW + 2,
                "local-dev-sqlite-ibex",
                "lease-test",
            )
            .unwrap();
        let error = db
            .reserve_authorized_lease(
                &wrong_activation,
                AuthorizedLeaseConfig::default(),
                NOW + 2,
                true,
                &wrong_activation.issuer_id,
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTHORIZED_LEASE_STALE");
    }

    #[test]
    fn coalesced_session_projection_is_safe_only_within_durable_session_truth() {
        let mut db = sessions_database(None);
        let projected_not_after = NOW + AUTHORIZED_LEASE_HARD_MAX_MS * 2;
        let safe = lease_with_session_not_after(
            &mut db,
            "request_coalesced_safe",
            NOW,
            projected_not_after,
        );
        assert_eq!(
            safe.authorized_until_server_ms,
            NOW + AUTHORIZED_LEASE_HARD_MAX_MS
        );
        db.reserve_authorized_lease(
            &safe,
            AuthorizedLeaseConfig::default(),
            NOW,
            true,
            &safe.issuer_id,
        )
        .unwrap();

        let unsafe_lease = lease_with_session_not_after(
            &mut db,
            "request_coalesced_unsafe",
            NOW + 1,
            projected_not_after,
        );
        assert_eq!(
            unsafe_lease.authorized_until_server_ms,
            NOW + AUTHORIZED_LEASE_HARD_MAX_MS + 1
        );
        let error = db
            .reserve_authorized_lease(
                &unsafe_lease,
                AuthorizedLeaseConfig::default(),
                NOW + 1,
                true,
                &unsafe_lease.issuer_id,
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTHORIZED_LEASE_STALE");
    }

    #[test]
    fn ordinary_write_head_race_discards_the_captured_snapshot_without_epoch_help() {
        let mut db = sessions_database(None);
        let captured = current_lease(&mut db, "request_head_race", NOW);
        let epoch = captured.authorization.clone();
        let mut row = Map::new();
        row.insert("_id".to_owned(), serde_json::json!("item_1"));
        row.insert("owner".to_owned(), serde_json::json!("user_2"));
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([("items".to_owned(), vec![row])]),
            })
            .unwrap();
        assert_eq!(db.authorization_version().unwrap(), epoch);
        assert_eq!(db.current_version().unwrap(), 1);
        let error = db
            .reserve_authorized_lease(
                &captured,
                AuthorizedLeaseConfig::default(),
                NOW,
                true,
                &captured.issuer_id,
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTHORIZED_LEASE_STALE");
        assert_eq!(db.authorized_lease_reservation_count().unwrap(), 0);
    }

    #[test]
    fn same_mode_activation_revokes_a_predecessor_retained_lease() {
        let mut db = sessions_database(None);
        let lease = current_lease(&mut db, "request_pre_activation", NOW);
        db.reserve_authorized_lease(
            &lease,
            AuthorizedLeaseConfig::default(),
            NOW,
            true,
            &lease.issuer_id,
        )
        .unwrap();
        let expectation = AuthorizedLeaseExpectation::from(&lease);
        let verified = signer()
            .verify_for_service(
                &lease,
                &expectation,
                AuthorizedLeaseConfig::default(),
                NOW + 1,
                "local-dev-sqlite-ibex",
                "lease-test",
            )
            .unwrap();

        let (mut deployment, manifest) = sessions_pair();
        deployment.bundle_hash = format!(
            "{}{}",
            crate::auth::mode::FUNCTION_V1_PREFIX,
            "d".repeat(64)
        );
        db.apply_same_mode_deployment(deployment, manifest, None)
            .expect("activate successor deployment");

        let error = db
            .authorize_revalidation_free_lease(
                &verified,
                AuthorizedLeaseConfig::default(),
                NOW + 1,
                true,
            )
            .expect_err("predecessor lease must not survive activation");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTHORIZED_LEASE_STALE");
    }

    #[test]
    fn request_ids_are_one_shot_and_server_clock_rollback_survives_restart() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("app.sqlite3");
        let mut first = sessions_database(Some(&path));
        let lease = current_lease(&mut first, "request_once", NOW);
        first
            .reserve_authorized_lease(
                &lease,
                AuthorizedLeaseConfig::default(),
                NOW,
                true,
                &lease.issuer_id,
            )
            .unwrap();
        let mut duplicate = current_lease(&mut first, "request_once", NOW + 1);
        duplicate.lease_id = "lease_different".to_owned();
        // Re-sign the altered lease so the failure is the durable request
        // reservation rather than an invalid MAC.
        let duplicate = signer()
            .issue(
                AuthorizedLeaseIssue {
                    lease_id: duplicate.lease_id,
                    lease_request_id: duplicate.lease_request_id,
                    issuer_id: duplicate.issuer_id,
                    client_store_id: duplicate.client_store_id,
                    query_key: duplicate.query_key,
                    query_instance_id: duplicate.query_instance_id,
                    principal_id: duplicate.principal_id,
                    session_id_at_issue: duplicate.session_id_at_issue,
                    provider_key: duplicate.provider_key,
                    authorization: duplicate.authorization,
                    data: duplicate.data,
                    activation_hash: duplicate.activation_hash,
                    session_not_after_ms: duplicate.session_not_after_ms,
                    provider_not_after_ms: duplicate.provider_not_after_ms,
                    authority_instance_id: duplicate.authority_instance_id,
                },
                AuthorizedLeaseConfig::default(),
                NOW + 1,
                "local-dev-sqlite-ibex",
                "lease-test",
            )
            .unwrap();
        let error = first
            .reserve_authorized_lease(
                &duplicate,
                AuthorizedLeaseConfig::default(),
                NOW + 1,
                true,
                &duplicate.issuer_id,
            )
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTHORIZED_LEASE_REQUEST_REUSED"
        );
        drop(first);

        let mut reopened = LocalDatabase::open(&path).unwrap();
        let expectation = AuthorizedLeaseExpectation::from(&lease);
        let verified = signer()
            .verify_for_service(
                &lease,
                &expectation,
                AuthorizedLeaseConfig::default(),
                NOW + 1,
                "local-dev-sqlite-ibex",
                "lease-test",
            )
            .unwrap();
        reopened
            .authorize_revalidation_free_lease(
                &verified,
                AuthorizedLeaseConfig::default(),
                NOW + 1,
                true,
            )
            .unwrap();
        // Equality with the durable high-water remains valid after restart.
        let error = reopened
            .authorize_revalidation_free_lease(
                &verified,
                AuthorizedLeaseConfig::default(),
                NOW,
                true,
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_CLOCK_ROLLBACK");
    }

    #[test]
    fn valid_service_requires_exact_current_state_and_does_not_renew_lease() {
        let mut db = sessions_database(None);
        let lease = current_lease(&mut db, "request_service", NOW);
        db.reserve_authorized_lease(
            &lease,
            AuthorizedLeaseConfig::default(),
            NOW,
            true,
            &lease.issuer_id,
        )
        .unwrap();
        let expectation = AuthorizedLeaseExpectation::from(&lease);
        let verified = signer()
            .verify_for_service(
                &lease,
                &expectation,
                AuthorizedLeaseConfig::default(),
                NOW + 1,
                "local-dev-sqlite-ibex",
                "lease-test",
            )
            .unwrap();
        db.authorize_revalidation_free_lease(
            &verified,
            AuthorizedLeaseConfig::default(),
            NOW + 1,
            true,
        )
        .unwrap();
        assert_eq!(
            lease.authorized_until_server_ms,
            NOW + AUTHORIZED_LEASE_HARD_MAX_MS
        );
        assert_eq!(db.authorized_lease_reservation_count().unwrap(), 1);
    }

    #[test]
    fn revoked_session_cannot_reserve_or_obtain_revalidation_free_service() {
        let mut db = sessions_database(None);
        let captured = current_lease(&mut db, "request_revoked_before_reserve", NOW);
        db.with_auth_transaction(|tx| {
            tx.execute(
                "UPDATE _auth_sessions
                    SET revoked_at_ms = ?1, generation = generation + 1
                  WHERE id = ?2",
                params![NOW as i64, SESSION_ID],
            )?;
            Ok(())
        })
        .unwrap();
        let error = db
            .reserve_authorized_lease(
                &captured,
                AuthorizedLeaseConfig::default(),
                NOW,
                true,
                &captured.issuer_id,
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTHORIZED_LEASE_STALE");
        assert_eq!(db.authorized_lease_reservation_count().unwrap(), 0);

        let service = current_lease(&mut db, "request_revoked_service", NOW + 1);
        let expected = AuthorizedLeaseExpectation::from(&service);
        let verified = signer()
            .verify_for_service(
                &service,
                &expected,
                AuthorizedLeaseConfig::default(),
                NOW + 1,
                "local-dev-sqlite-ibex",
                "lease-test",
            )
            .unwrap();
        let error = db
            .authorize_revalidation_free_lease(
                &verified,
                AuthorizedLeaseConfig::default(),
                NOW + 1,
                true,
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTHORIZED_LEASE_STALE");
    }

    #[test]
    fn issuer_mismatch_and_clock_rollback_mint_no_reservation() {
        let mut db = sessions_database(None);
        let lease = current_lease(&mut db, "request_issuer", NOW);
        let mut another_issuer = lease.issuer_id.clone();
        another_issuer.boot_sequence += 1;
        let error = db
            .reserve_authorized_lease(
                &lease,
                AuthorizedLeaseConfig::default(),
                NOW,
                true,
                &another_issuer,
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTHORIZED_LEASE_STALE");
        assert_eq!(db.authorized_lease_reservation_count().unwrap(), 0);

        let rollback = current_lease(&mut db, "request_rollback", NOW - 1);
        let error = db
            .reserve_authorized_lease(
                &rollback,
                AuthorizedLeaseConfig::default(),
                NOW - 1,
                true,
                &rollback.issuer_id,
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_CLOCK_ROLLBACK");
        assert_eq!(db.authorized_lease_reservation_count().unwrap(), 0);
    }

    #[test]
    fn destructive_reset_and_restore_clear_all_server_lease_reservations() {
        let mut db = sessions_database(None);
        let lease = current_lease(&mut db, "request_reset", NOW);
        db.reserve_authorized_lease(
            &lease,
            AuthorizedLeaseConfig::default(),
            NOW,
            true,
            &lease.issuer_id,
        )
        .unwrap();
        assert_eq!(db.authorized_lease_reservation_count().unwrap(), 1);
        db.schema_seed().reset().unwrap();
        assert_eq!(db.authorized_lease_reservation_count().unwrap(), 0);

        let mut db = sessions_database(None);
        let lease = current_lease(&mut db, "request_restore", NOW);
        db.reserve_authorized_lease(
            &lease,
            AuthorizedLeaseConfig::default(),
            NOW,
            true,
            &lease.issuer_id,
        )
        .unwrap();
        assert_eq!(db.authorized_lease_reservation_count().unwrap(), 1);
        db.apply_auth_restore_declaration("01890f3c-9d5b-7000-8000-000000000005", NOW + 1)
            .unwrap();
        assert_eq!(db.authorized_lease_reservation_count().unwrap(), 0);
    }

    #[test]
    fn test_fixture_incarnation_is_canonical() {
        // Keeps this module's static sentinel from silently becoming a loose
        // UUID spelling in future refactors.
        assert_eq!(
            uuid::Uuid::parse_str(INCARNATION)
                .unwrap()
                .get_version_num(),
            7
        );
    }
}
