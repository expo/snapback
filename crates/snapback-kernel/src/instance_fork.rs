//! Storage-owned derived-fork contracts and durable operations.

use std::collections::BTreeMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rusqlite::{Connection, OpenFlags, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::auth::crypto::{OsRandom, RandomSource, ResumeKeyId};
use crate::diagnostic::{SnapbackError, SnapbackResult};
pub use snapback_types::instance_fork::*;

pub const STAGING_SENTINEL: &str = ".snapback-fork-staging.v1";
pub const MINT_RECEIPT_FILE: &str = "fork-mint-receipt.json";
const LINEAGE_META_KEY: &str = "instance_fork_lineage_v1";
const QUARANTINE_META_KEY: &str = "instance_fork_quarantine_v1";
const EGRESS_TABLE: &str = "_snapback_fork_egress_attempts_v1";
pub const SERVER_EXPIRED_CODE: &str = "SNAPBACK_FORK_SERVER_EXPIRED";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CustodyDisposition {
    Copy,
    Scrub,
    Rotate,
    Share,
    Refuse,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CustodyRule {
    pub name: &'static str,
    pub disposition: CustodyDisposition,
}

// @ref LLP 0158#design-sketch — the manifest is a closed custody authority;
// an app-reset deletion list or name prefix is not sufficient fork policy.
pub const TABLE_CUSTODY: &[CustodyRule] = &[
    CustodyRule {
        name: "_snapback_meta",
        disposition: CustodyDisposition::Rotate,
    },
    CustodyRule {
        name: "_snapback_version",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_changes",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_history_policies_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_history_policies_v2",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_record_history_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_checkpoint_registry_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_protected_checkpoint_erasure_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_protected_record_erasure_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_protected_erasure_generation_v1",
        disposition: CustodyDisposition::Rotate,
    },
    // LLP 0163 identities and receipts belong to the parent stream. A derived
    // deployment mints a new stream/authority and must never replay inherited
    // suppression or envelope state as if it originated there.
    CustodyRule {
        name: "_snapback_operation_epochs_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_operation_ranges_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_operation_protected_detail_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_operation_floors_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_operation_pending_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_operation_purges_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_operation_terminal_supplements_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_commit_envelopes_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_operation_suppression_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_operation_tombstones_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_operation_coverage_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_operation_coverage_continuity_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_host_identity_leases_v1",
        disposition: CustodyDisposition::Scrub,
    },
    // In-app branch and promotion registries are canonical coordination state,
    // not application data. Derived deployments start without live tickets,
    // retained branch operations, or canonical promotion receipts.
    CustodyRule {
        name: "_snapback_in_app_branch_profiles",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_in_app_branch_custody_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_branch_operations",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_branch_operation_reservations",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_branch_egress_attempts",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_branch_effect_intents_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_promotion_admission",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_promotion_receipts",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_promotion_source_joins",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_promotion_envelopes",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_promotion_effect_intents_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_promotion_provisional_dependencies_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_membership_transitions",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_relation_incarnations_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_sequence_scope_enrollments_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_sequence_counters_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_client_mutations",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_client_mutation_auth_retention",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_stream_attempts",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_auth_retry_episodes",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_auth_retry_counters",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_authorized_lease_reservations",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_auth_throttle",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_auth_throttle_retention",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_sender_family_binding",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_sender_proof_replay",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_sender_nonce",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_sender_replay_epoch",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_hosted_admission_watermark",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_search_generations",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_search_sources",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_search_terms",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_search_frontiers",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_search_builds",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_search_journal_leases",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_vector_generations",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_vector_sources",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_vector_frontiers",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_vector_builds",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_vector_build_snapshot",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_vector_journal_leases",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_jobs_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_job_attempts_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_job_push_grants_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_job_idempotency_tombstones_v1",
        disposition: CustodyDisposition::Copy,
    },
    // @ref LLP 0213#durable-deferred-intent-provenance — copied jobs retain
    // their protected rehearsal mark so a fork cannot replay marked work as
    // clean work and bypass the external-egress gate.
    CustodyRule {
        name: "_snapback_job_rehearsal_provenance_v1",
        disposition: CustodyDisposition::Copy,
    },
    // Asset custody (LLP 0185 Phase 5, implementing LLP 0158 OQ5's decided
    // posture): durable asset metadata copies together with a digest-verified
    // fork-private blob-tree copy taken from the same consistent cut;
    // in-flight upload attempts and work-ledger claims are parent-operational
    // state and scrub; signing keys rotate so parent-signed URLs never
    // validate in the fork.
    CustodyRule {
        name: "_snapback_asset_records_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_asset_attempts_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_asset_blobs_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_asset_renditions_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_asset_reference_edges_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_asset_grants_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_asset_publications_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_asset_work_ledger_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_asset_receipts_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_asset_intent_generations_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_asset_intent_artifacts_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_asset_signing_keys_v1",
        disposition: CustodyDisposition::Rotate,
    },
    CustodyRule {
        name: "_snapback_asset_seed_fixtures_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_seed_installations_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_seed_operations_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_push_tokens_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_push_intents_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_push_batches_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_push_messages_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_push_ledger_v1",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_migration_journal",
        disposition: CustodyDisposition::Refuse,
    },
    CustodyRule {
        name: "_snapback_migration_ops",
        disposition: CustodyDisposition::Refuse,
    },
    CustodyRule {
        name: "_snapback_migration_checkpoint",
        disposition: CustodyDisposition::Refuse,
    },
    CustodyRule {
        name: "_snapback_branches",
        disposition: CustodyDisposition::Refuse,
    },
    CustodyRule {
        name: "_snapback_branch_versions",
        disposition: CustodyDisposition::Refuse,
    },
    CustodyRule {
        name: "_snapback_branch_overlay",
        disposition: CustodyDisposition::Refuse,
    },
    CustodyRule {
        name: "_snapback_captured_effects",
        disposition: CustodyDisposition::Refuse,
    },
    CustodyRule {
        name: "_snapback_promotion_pending",
        disposition: CustodyDisposition::Refuse,
    },
    CustodyRule {
        name: EGRESS_TABLE,
        disposition: CustodyDisposition::Refuse,
    },
    CustodyRule {
        name: "_auth_users",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_auth_identities",
        disposition: CustodyDisposition::Copy,
    },
    // @ref LLP 0214#3-catalog-version-3 — credentials, recovery state,
    // assurances, provisioning receipts, and the redacted security journal
    // are durable account state, not live bearer authority.
    CustodyRule {
        name: "_auth_credentials",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_auth_password_credentials",
        disposition: CustodyDisposition::Copy,
    },
    // @ref LLP 0214#20-amendment-2026-08-10-reconciliation-with-llp-0227 — physical
    // owner custody preserves lockout state with its protected identifiers;
    // logical auth export excludes this relation separately.
    CustodyRule {
        name: "_auth_password_attempts",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_auth_passkey_credentials",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_auth_recovery_code_sets",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_auth_recovery_codes",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_auth_assurances",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_auth_provisioning_receipts",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_auth_security_events",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_auth_scope_bases",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_auth_sessions",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_auth_session_tokens",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_auth_verification_codes",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_auth_agent_credentials",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_auth_grants",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_auth_grant_tokens",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_auth_agent_invitations",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_auth_pairing_requests",
        disposition: CustodyDisposition::Scrub,
    },
    // @ref LLP 0213#security-boundaries-and-invariants — rehearsal grants,
    // derived authority, windows, accounting, and store-local admission state
    // are bound to the source instance and boot and are never live in a fork.
    CustodyRule {
        name: "_snapback_auth_rehearsal_grants",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_auth_rehearsal_idempotency",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_auth_rehearsal_mint_idempotency",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_auth_rehearsal_audit",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_auth_rehearsal_store_markers",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_auth_rehearsal_identities",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_auth_rehearsal_sessions",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_auth_rehearsal_window_reservations",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_auth_rehearsal_windows",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "_snapback_auth_rehearsal_window_challenges",
        disposition: CustodyDisposition::Scrub,
    },
];

pub const SIDECAR_CUSTODY: &[CustodyRule] = &[
    CustodyRule {
        name: "*.config.json",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "*.admin-token",
        disposition: CustodyDisposition::Rotate,
    },
    CustodyRule {
        name: "*.auth-keyring.json",
        disposition: CustodyDisposition::Rotate,
    },
    CustodyRule {
        name: "resume-keyring.json",
        disposition: CustodyDisposition::Rotate,
    },
    CustodyRule {
        name: "*.operation-detail-keyring.json",
        disposition: CustodyDisposition::Rotate,
    },
    CustodyRule {
        name: "ready files and siblings",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "*.snapback.lock",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "*.telemetry and SQLite companions",
        disposition: CustodyDisposition::Scrub,
    },
    CustodyRule {
        name: "assets/blobs tree",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "target reservations and ready capability siblings",
        disposition: CustodyDisposition::Scrub,
    },
];

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForkMintReceiptV1 {
    pub format_version: u32,
    pub lineage: DerivedForkLineageV1,
    pub database_file: String,
    pub authorization_stream_incarnation: String,
    pub data_version_stream: String,
    pub custody: BTreeMap<String, CustodyDisposition>,
}

fn fork_error(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "instanceFork", message)
}

fn io_error(context: &'static str, error: std::io::Error) -> SnapbackError {
    fork_error("SNAPBACK_FORK_IO_FAILED", format!("{context}: {error}"))
}

fn wall_clock_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| {
            elapsed
                .as_millis()
                .min(crate::manifest::PORTABLE_TIMESTAMP_MAX_MS.into()) as u64
        })
        .unwrap_or(0)
}

pub fn server_expired_error(lineage: &DerivedForkLineageV1, observed_at_ms: u64) -> SnapbackError {
    fork_error(
        SERVER_EXPIRED_CODE,
        "derived-fork server is past its finite expiry; shutting down and refusing new work",
    )
    .with_details(json!({
        "forkId": lineage.fork_id,
        "expiresAtMs": lineage.expires_at_ms,
        "observedAtMs": observed_at_ms,
        "disposition": "shutting-down"
    }))
}

fn open_fork_connection_with_flags(path: &Path, flags: OpenFlags) -> SnapbackResult<Connection> {
    let conn = Connection::open_with_flags(path, flags)?;
    if crate::replication::configured_from_env() {
        crate::replication::configure_connection_wal_lifetime(&conn)?;
        conn.execute_batch("PRAGMA wal_autocheckpoint = 0;")?;
    }
    Ok(conn)
}

fn table_exists(conn: &Connection, name: &str) -> SnapbackResult<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1",
            [name],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn delete_table(tx: &Transaction<'_>, name: &str) -> SnapbackResult<()> {
    let sql = format!("DELETE FROM \"{}\"", name.replace('"', "\"\""));
    tx.execute(&sql, [])?;
    Ok(())
}

fn rotate_protected_erasure_generation(tx: &Transaction<'_>) -> SnapbackResult<()> {
    const TABLE: &str = "_snapback_protected_erasure_generation_v1";
    if table_exists(tx, TABLE)? {
        delete_table(tx, TABLE)?;
        tx.execute(
            "INSERT INTO _snapback_protected_erasure_generation_v1(id,generation) VALUES(1,0)",
            [],
        )?;
    }
    Ok(())
}

/// Remove copied bearer and operation authority from an in-app branch head.
pub fn scrub_copied_authority_for_in_app_branch(conn: &mut Connection) -> SnapbackResult<()> {
    let tx = conn.transaction()?;
    for rule in TABLE_CUSTODY {
        if rule.disposition == CustodyDisposition::Scrub && table_exists(&tx, rule.name)? {
            delete_table(&tx, rule.name)?;
        }
    }
    rotate_protected_erasure_generation(&tx)?;
    if table_exists(&tx, "_snapback_record_history_v1")? {
        tx.execute(
            "UPDATE _snapback_record_history_v1 SET operation_id=NULL
              WHERE operation_id IS NOT NULL",
            [],
        )?;
    }
    crate::storage::auth_stream::rotate_authorization_version_in(&tx)?;
    crate::storage::auth_invalidation::clear_retry_episodes_in(&tx)?;
    crate::storage::auth_invalidation::rotate_data_version_stream_in(&tx)?;
    tx.commit()?;
    Ok(())
}

fn admin_token_sibling(path: &Path) -> std::path::PathBuf {
    let mut name = path
        .file_name()
        .map(|name| name.to_os_string())
        .unwrap_or_default();
    name.push(".admin-token");
    path.with_file_name(name)
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedResumeKeyring {
    format_version: u32,
    keys: Vec<PersistedResumeKey>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedResumeKey {
    key_id: String,
    secret: String,
    #[allow(dead_code)]
    created_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    retired_at_ms: Option<u64>,
}

pub fn persisted_resume_file_has_active_key(path: &Path) -> bool {
    const RESUME_KEYRING_FORMAT_VERSION: u32 = 1;
    const RESUME_KEYRING_MAX_BYTES: usize = 64 * 1024;

    let Ok(bytes) = crate::secure_file::read_owner_only(path) else {
        return false;
    };
    if bytes.len() > RESUME_KEYRING_MAX_BYTES {
        return false;
    }
    let Ok(persisted) = serde_json::from_slice::<PersistedResumeKeyring>(&bytes) else {
        return false;
    };
    if persisted.format_version != RESUME_KEYRING_FORMAT_VERSION {
        return false;
    }
    let mut active = 0_usize;
    for key in persisted.keys {
        if ResumeKeyId::parse(&key.key_id).is_err() {
            return false;
        }
        let Ok(bytes) = URL_SAFE_NO_PAD.decode(&key.secret) else {
            return false;
        };
        if <[u8; 32]>::try_from(bytes).is_err() {
            return false;
        }
        if key.retired_at_ms.is_none() {
            active += 1;
        }
    }
    active == 1
}

/// Mint the exact resume-keyring artifact required by a staged derived fork.
/// The caller already proved the staging namespace empty; failure remains an
/// availability-only false result, matching `ResumeKeyring::load_or_create`.
pub fn mint_resume_keyring_for_fork(path: &Path, now_ms: u64) -> bool {
    let random = OsRandom;
    let Ok(key_id) = ResumeKeyId::generate(&random) else {
        return false;
    };
    let mut secret = zeroize::Zeroizing::new([0_u8; 32]);
    if random.fill(secret.as_mut()).is_err() {
        return false;
    }
    let persisted = PersistedResumeKeyring {
        format_version: 1,
        keys: vec![PersistedResumeKey {
            key_id: key_id.as_str().to_owned(),
            secret: URL_SAFE_NO_PAD.encode(secret.as_ref()),
            created_at_ms: now_ms,
            retired_at_ms: None,
        }],
    };
    let Ok(bytes) = serde_json::to_vec(&persisted) else {
        return false;
    };
    if crate::secure_file::write_owner_only(path, &bytes).is_err() {
        return false;
    }
    persisted_resume_file_has_active_key(path)
}

fn validate_minted_sidecars(database_path: &Path) -> SnapbackResult<()> {
    fn require_regular(path: &Path, sidecar: &'static str) -> SnapbackResult<()> {
        let metadata = std::fs::symlink_metadata(path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                fork_error(
                    "SNAPBACK_FORK_SIDECAR_MISSING",
                    format!("required minted {sidecar} sidecar is missing"),
                )
                .with_details(json!({ "sidecar": sidecar }))
            } else {
                io_error("inspect minted fork sidecar", error)
            }
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(fork_error(
                "SNAPBACK_FORK_SIDECAR_MALFORMED",
                format!("minted {sidecar} sidecar is not a regular file"),
            )
            .with_details(json!({ "sidecar": sidecar })));
        }
        Ok(())
    }

    let admin_path = admin_token_sibling(database_path);
    require_regular(&admin_path, "admin-token")?;
    let admin = crate::secure_file::read_owner_only(&admin_path).map_err(|_| {
        fork_error(
            "SNAPBACK_FORK_SIDECAR_MALFORMED",
            "minted admin-token sidecar cannot be read with owner-only custody",
        )
        .with_details(json!({ "sidecar": "admin-token" }))
    })?;
    let admin = std::str::from_utf8(&admin)
        .map_err(|_| {
            fork_error(
                "SNAPBACK_FORK_SIDECAR_MALFORMED",
                "minted admin-token sidecar is not UTF-8",
            )
            .with_details(json!({ "sidecar": "admin-token" }))
        })?
        .trim();
    if admin.len() != 37 || !admin.starts_with("sbat_") {
        return Err(fork_error(
            "SNAPBACK_FORK_SIDECAR_MALFORMED",
            "minted admin-token sidecar does not contain a Snapback admin token",
        )
        .with_details(json!({ "sidecar": "admin-token" })));
    }
    let auth_path = crate::auth::keyring::AuthKeyringStore::keyring_path(database_path);
    require_regular(&auth_path, "auth-keyring")?;
    crate::auth::keyring::AuthKeyringStore::file_for_database(database_path)
        .load_existing()
        .map_err(|_| {
            fork_error(
                "SNAPBACK_FORK_SIDECAR_MALFORMED",
                "minted auth-keyring sidecar is malformed",
            )
            .with_details(json!({ "sidecar": "auth-keyring" }))
        })?;
    let resume_path = database_path.with_file_name(crate::rqs_contract::RESUME_KEYRING_FILE_NAME);
    require_regular(&resume_path, "resume-keyring")?;
    if !persisted_resume_file_has_active_key(&resume_path) {
        return Err(fork_error(
            "SNAPBACK_FORK_SIDECAR_MALFORMED",
            "minted resume-keyring sidecar has no active key",
        )
        .with_details(json!({ "sidecar": "resume-keyring" })));
    }
    let operation_detail_path = crate::operation_detail::keyring_path(database_path);
    require_regular(&operation_detail_path, "operation-detail-keyring")?;
    if !crate::operation_detail::persisted_file_has_key(database_path) {
        return Err(fork_error(
            "SNAPBACK_FORK_SIDECAR_MALFORMED",
            "minted operation-detail-keyring sidecar has no valid key",
        )
        .with_details(json!({ "sidecar": "operation-detail-keyring" })));
    }
    Ok(())
}

fn inspect_published_evidence(database_path: &Path) -> SnapbackResult<Option<DerivedForkRuntime>> {
    let directory = database_path.parent().unwrap_or_else(|| Path::new("."));
    if directory.join(STAGING_SENTINEL).exists() {
        return Err(fork_error(
            "SNAPBACK_FORK_PUBLICATION_PARTIAL",
            "fork publication is incomplete; run `snapback fork recover` for the exact destination",
        ));
    }
    inspect_evidence(database_path)
}

fn inspect_evidence(database_path: &Path) -> SnapbackResult<Option<DerivedForkRuntime>> {
    let directory = database_path.parent().unwrap_or_else(|| Path::new("."));
    if !database_path.exists() {
        return Ok(None);
    }
    let conn = open_fork_connection_with_flags(database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    if !table_exists(&conn, "_snapback_meta")? {
        return Ok(None);
    }
    let quarantine = conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key=?1",
            [QUARANTINE_META_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if quarantine.is_some() {
        return Err(fork_error(
            "SNAPBACK_FORK_QUARANTINED",
            "fork mint quarantine is still present",
        ));
    }
    let lineage = conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key=?1",
            [LINEAGE_META_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let receipt_path = directory.join(MINT_RECEIPT_FILE);
    match (lineage, receipt_path.exists()) {
        (None, false) => Ok(None),
        (Some(lineage), true) => {
            let lineage: DerivedForkLineageV1 = serde_json::from_str(&lineage).map_err(|_| {
                fork_error("SNAPBACK_FORK_LINEAGE_INVALID", "fork lineage is malformed")
            })?;
            if lineage.format_version != 1
                || lineage.promotable
                || lineage
                    .expires_at_ms
                    .is_some_and(|expires_at_ms| expires_at_ms <= lineage.created_at_ms)
            {
                return Err(fork_error(
                    "SNAPBACK_FORK_LINEAGE_INVALID",
                    "fork lineage version, class, or finite expiry is invalid",
                ));
            }
            let receipt: ForkMintReceiptV1 = serde_json::from_slice(
                &std::fs::read(&receipt_path)
                    .map_err(|error| io_error("read fork receipt", error))?,
            )
            .map_err(|_| {
                fork_error(
                    "SNAPBACK_FORK_RECEIPT_INVALID",
                    "fork mint receipt is malformed",
                )
            })?;
            if receipt.lineage != lineage
                || receipt.database_file
                    != database_path
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or_default()
                || lineage.promotable
            {
                return Err(fork_error(
                    "SNAPBACK_FORK_EVIDENCE_MISMATCH",
                    "fork lineage and mint receipt do not identify the same non-promotable instance",
                ));
            }
            validate_minted_sidecars(database_path)?;
            Ok(Some(DerivedForkRuntime {
                database_path: database_path.to_path_buf(),
                lineage,
            }))
        }
        _ => Err(fork_error(
            "SNAPBACK_FORK_EVIDENCE_INCOMPLETE",
            "fork lineage and mint receipt must either both be present or both be absent",
        )),
    }
}

pub fn inspect_boot(database_path: &Path) -> SnapbackResult<Option<DerivedForkRuntime>> {
    inspect_boot_at(database_path, wall_clock_now_ms())
}

pub fn inspect_boot_at(
    database_path: &Path,
    now_ms: u64,
) -> SnapbackResult<Option<DerivedForkRuntime>> {
    let runtime = inspect_published_evidence(database_path)?;
    if let Some(runtime) = runtime.as_ref()
        && let Some(expires_at_ms) = runtime.lineage.expires_at_ms
        && expires_at_ms <= now_ms
    {
        return Err(server_expired_error(&runtime.lineage, now_ms));
    }
    Ok(runtime)
}

pub trait DerivedForkRuntimeExt {
    fn deny(&self, family: EgressFamily, now_ms: u64) -> SnapbackError;
}

impl DerivedForkRuntimeExt for DerivedForkRuntime {
    /// Persist a bounded, payload-free marker before returning the refusal.
    // @ref LLP 0162#acceptance — DenyAll records only the closed effect family.
    fn deny(&self, family: EgressFamily, now_ms: u64) -> SnapbackError {
        let recorded = (|| -> SnapbackResult<()> {
            crate::storage::record_derived_fork_egress_attempt_v1(
                &self.database_path,
                family.as_str(),
                now_ms,
            )?;
            Ok(())
        })();
        if recorded.is_err() {
            return fork_error(
                "SNAPBACK_FORK_EGRESS_MARKER_FAILED",
                "derived-fork egress was refused but its durable marker could not be recorded",
            )
            .with_details(json!({ "family": family.as_str() }));
        }
        fork_error(
            "SNAPBACK_FORK_EGRESS_DENIED",
            "derived deployments deny outbound initiation",
        )
        .with_details(json!({ "family": family.as_str() }))
    }
}
