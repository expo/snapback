//! Storage-owned derived-fork contracts and durable operations.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Context as _;
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

/// Kernel-validated private fork staging target. It is minted only while the
/// target database is absent beneath a real staging directory carrying the
/// sentinel, then consumed by kernel-owned clone and mint operations.
pub struct StagedForkDatabase {
    staging_directory: PathBuf,
    database_path: PathBuf,
    cloned: bool,
}

impl StagedForkDatabase {
    pub fn prepare(staging_directory: &Path, database_file: &str) -> SnapbackResult<Self> {
        if database_file.is_empty()
            || Path::new(database_file).components().count() != 1
            || Path::new(database_file)
                .file_name()
                .and_then(|v| v.to_str())
                != Some(database_file)
        {
            return Err(fork_error(
                "SNAPBACK_FORK_PATH_INVALID",
                "staged fork database must be one direct UTF-8 child",
            ));
        }
        let staging_directory = fs::canonicalize(staging_directory)
            .map_err(|error| io_error("resolve fork staging directory", error))?;
        let metadata = fs::symlink_metadata(staging_directory.join(STAGING_SENTINEL))
            .map_err(|error| io_error("inspect fork staging sentinel", error))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(fork_error(
                "SNAPBACK_FORK_STAGING_INVALID",
                "fork staging sentinel must be a real direct-child file",
            ));
        }
        let database_path = staging_directory.join(database_file);
        if database_path.exists() {
            return Err(fork_error(
                "SNAPBACK_FORK_STAGING_INVALID",
                "staged fork database must not exist when its handle is minted",
            ));
        }
        Ok(Self {
            staging_directory,
            database_path,
            cloned: false,
        })
    }

    pub fn database_path(&self) -> &Path {
        &self.database_path
    }

    fn validate(&self) -> SnapbackResult<()> {
        let parent = self.database_path.parent().ok_or_else(|| {
            fork_error(
                "SNAPBACK_FORK_STAGING_INVALID",
                "staged database has no parent",
            )
        })?;
        let canonical_parent = fs::canonicalize(parent)
            .map_err(|error| io_error("revalidate fork staging directory", error))?;
        if canonical_parent != self.staging_directory {
            return Err(fork_error(
                "SNAPBACK_FORK_STAGING_INVALID",
                "staged fork directory identity changed",
            ));
        }
        let sentinel = fs::symlink_metadata(parent.join(STAGING_SENTINEL))
            .map_err(|error| io_error("revalidate fork staging sentinel", error))?;
        if sentinel.file_type().is_symlink() || !sentinel.is_file() {
            return Err(fork_error(
                "SNAPBACK_FORK_STAGING_INVALID",
                "fork staging sentinel is no longer a real file",
            ));
        }
        Ok(())
    }
}

pub fn stored_app_id(database: &Path) -> anyhow::Result<String> {
    let conn = open_fork_connection(database)?;
    let stored: Option<String> = conn
        .query_row(
            "SELECT value
               FROM _snapback_meta
              WHERE key IN (?1, ?2)
              ORDER BY CASE key WHEN ?1 THEN 0 ELSE 1 END
              LIMIT 1",
            params![
                crate::storage::auth_mode::META_CAPABILITY_AWARE_SCHEMA_MANIFEST,
                crate::storage::auth_mode::META_LEGACY_SCHEMA_MANIFEST,
            ],
            |row| row.get(0),
        )
        .optional()?;
    let stored = stored.context("SNAPBACK_FORK_APP_ID_REQUIRED: source has no stored schema")?;
    // @ref LLP 0058#the-four-keys — Sessions permanently poisons
    // the predecessor manifest slot. The capability-aware slot is the active
    // schema for both modes; legacy databases fall back to the old slot.
    let schema: crate::manifest::SchemaManifest =
        serde_json::from_str(&stored).context("source active schema is malformed")?;
    Ok(schema.app_id)
}

pub fn source_parent_instance_id(database: &Path) -> anyhow::Result<String> {
    let conn = open_fork_connection(database)?;
    Ok(conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key='auth_invalidation_data_version_stream_v1'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .unwrap_or_else(|| format!("sqlite:{}", database.display())))
}

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
    // Authority product projection rows are application history and delivery
    // facts. Derived forks copy them with the product rows they describe.
    CustodyRule {
        name: "_snapback_authority_projection_horizons",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_authority_projection_events",
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
        name: "_snapback_auth_invalidation_boot_reservation_v1",
        // Preserve the last authentic reservation beside the copied epoch.
        // The fork's first issuer advances both under its newly installed
        // connection authority and rotated authorization incarnation.
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_auth_invalidation_boot_epoch_v1",
        // Preserve the non-decreasing high-water. Fork activation rotates the
        // authorization incarnation, and the first fork issuer advances this
        // copied epoch exactly once to name that successor incarnation.
        disposition: CustodyDisposition::Copy,
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

fn custody_map() -> BTreeMap<&'static str, CustodyDisposition> {
    TABLE_CUSTODY
        .iter()
        .map(|rule| (rule.name, rule.disposition))
        .collect()
}

fn audit_connection(conn: &Connection) -> SnapbackResult<Vec<(String, CustodyDisposition)>> {
    let manifest = custody_map();
    let mut statement = conn.prepare(
        "SELECT name FROM sqlite_schema
         WHERE type = 'table'
           AND (name GLOB '_snapback_*' OR name GLOB '_auth_*')
         ORDER BY name",
    )?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut classified = Vec::with_capacity(names.len());
    for name in names {
        let Some(disposition) = manifest.get(name.as_str()).copied() else {
            return Err(fork_error(
                "SNAPBACK_FORK_CUSTODY_UNCLASSIFIED",
                "a Snapback-owned table has no declared fork custody",
            )
            .with_details(json!({ "table": name })));
        };
        if disposition == CustodyDisposition::Refuse {
            let sql = format!(
                "SELECT EXISTS(SELECT 1 FROM \"{}\" LIMIT 1)",
                name.replace('"', "\"\"")
            );
            let occupied: bool = conn.query_row(&sql, [], |row| row.get(0))?;
            if occupied {
                return Err(fork_error(
                    "SNAPBACK_FORK_CUSTODY_REFUSED",
                    "source state belongs to a fork-incompatible subsystem",
                )
                .with_details(json!({ "table": name })));
            }
        }
        classified.push((name, disposition));
    }
    Ok(classified)
}

pub fn clone_database_into_staging(
    source_database: &Path,
    staged: &mut StagedForkDatabase,
) -> SnapbackResult<()> {
    staged.validate()?;
    if staged.cloned || staged.database_path.exists() {
        return Err(fork_error(
            "SNAPBACK_FORK_STAGING_INVALID",
            "staged fork database clone is one-shot",
        ));
    }
    let source =
        open_fork_connection_with_flags(source_database, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    audit_connection(&source)?;
    let mut target = open_fork_connection(&staged.database_path)?;
    {
        let backup = rusqlite::backup::Backup::new(&source, &mut target)?;
        backup.run_to_completion(128, std::time::Duration::from_millis(1), None)?;
    }
    drop(target);
    staged.cloned = true;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn scrub_and_mint_staged_database(
    staged: &StagedForkDatabase,
    app_id: &str,
    parent_instance_id: &str,
    now_ms: u64,
    with_secrets: bool,
    expires_at_ms: Option<u64>,
) -> SnapbackResult<ForkMintReceiptV1> {
    staged.validate()?;
    if !staged.cloned || !staged.database_path.is_file() {
        return Err(fork_error(
            "SNAPBACK_FORK_STAGING_INVALID",
            "fork mint requires the exact kernel-cloned staged database",
        ));
    }
    let mut conn = open_fork_connection(&staged.database_path)?;
    let classified = audit_connection(&conn)?;
    let fork_point_version = conn.query_row(
        "SELECT version FROM _snapback_version WHERE id=1",
        [],
        |row| row.get::<_, u64>(0),
    )?;
    if conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key=?1",
            [LINEAGE_META_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .is_some()
    {
        return Err(fork_error(
            "SNAPBACK_FORK_NESTED_REFUSED",
            "v1 does not fork an already-derived deployment",
        ));
    }
    let lineage = DerivedForkLineageV1 {
        format_version: 1,
        fork_id: uuid::Uuid::now_v7().to_string(),
        parent_instance_id: parent_instance_id.to_owned(),
        app_id: app_id.to_owned(),
        created_at_ms: now_ms,
        fork_point_version,
        expires_at_ms,
        promotable: false,
    };
    let database_file = staged
        .database_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            fork_error(
                "SNAPBACK_FORK_PATH_INVALID",
                "fork database needs a UTF-8 file name",
            )
        })?
        .to_owned();
    let mut custody = classified.into_iter().collect::<BTreeMap<_, _>>();
    custody.extend(
        SIDECAR_CUSTODY
            .iter()
            .map(|rule| (format!("sidecar:{}", rule.name), rule.disposition)),
    );
    if with_secrets {
        custody.insert("sidecar:*.config.json".to_owned(), CustodyDisposition::Copy);
    }
    let tx = conn.transaction()?;
    let quarantine = serde_json::to_string(&lineage)
        .map_err(|error| fork_error("SNAPBACK_FORK_LINEAGE_INVALID", error.to_string()))?;
    tx.execute(
        "INSERT INTO _snapback_meta(key,value) VALUES(?1,?2)",
        params![QUARANTINE_META_KEY, quarantine],
    )?;
    for rule in TABLE_CUSTODY {
        if rule.disposition == CustodyDisposition::Scrub && table_exists(&tx, rule.name)? {
            delete_table(&tx, rule.name)?;
        }
    }
    rotate_protected_erasure_generation(&tx)?;
    if table_exists(&tx, "_snapback_record_history_v1")? {
        tx.execute(
            "UPDATE _snapback_record_history_v1 SET operation_id=NULL WHERE operation_id IS NOT NULL",
            [],
        )?;
    }
    let authorization = crate::storage::auth_stream::rotate_authorization_version_in(&tx)?;
    crate::storage::auth_invalidation::clear_retry_episodes_in(&tx)?;
    let data_version_stream =
        crate::storage::auth_invalidation::rotate_data_version_stream_in(&tx)?;
    if table_exists(&tx, "_snapback_asset_signing_keys_v1")? {
        crate::assets::rotate_signing_key(&tx, now_ms)?;
    }
    tx.execute(
        "CREATE TABLE IF NOT EXISTS _snapback_fork_egress_attempts_v1 (
           family TEXT PRIMARY KEY,
           attempts INTEGER NOT NULL CHECK(attempts >= 1),
           first_attempt_at_ms INTEGER NOT NULL,
           last_attempt_at_ms INTEGER NOT NULL
         )",
        [],
    )?;
    let lineage_json = serde_json::to_string(&lineage)
        .map_err(|error| fork_error("SNAPBACK_FORK_LINEAGE_INVALID", error.to_string()))?;
    tx.execute(
        "DELETE FROM _snapback_meta WHERE key=?1",
        [QUARANTINE_META_KEY],
    )?;
    tx.execute(
        "INSERT INTO _snapback_meta(key,value) VALUES(?1,?2)",
        params![LINEAGE_META_KEY, lineage_json],
    )?;
    tx.commit()?;
    checkpoint_when_fork_owns_wal(&conn)?;
    Ok(ForkMintReceiptV1 {
        format_version: 1,
        lineage,
        database_file,
        authorization_stream_incarnation: authorization.incarnation,
        data_version_stream,
        custody,
    })
}

pub fn retain_staged_base_snapshot(
    staged: &StagedForkDatabase,
    base_file: &str,
) -> SnapbackResult<PathBuf> {
    staged.validate()?;
    if !staged.cloned || Path::new(base_file).components().count() != 1 {
        return Err(fork_error(
            "SNAPBACK_FORK_STAGING_INVALID",
            "retained base must be one direct child of a cloned staging directory",
        ));
    }
    let base_path = staged.staging_directory.join(base_file);
    if base_path.exists() {
        return Err(fork_error(
            "SNAPBACK_FORK_STAGING_INVALID",
            "retained base snapshot target already exists",
        ));
    }
    let source =
        open_fork_connection_with_flags(&staged.database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let mut target = open_fork_connection(&base_path)?;
    {
        let backup = rusqlite::backup::Backup::new(&source, &mut target)?;
        backup.run_to_completion(128, std::time::Duration::from_millis(1), None)?;
    }
    Ok(base_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custody_sweep_fails_for_unknown_owned_table() {
        let conn = Connection::open_in_memory().expect("memory database");
        conn.execute("CREATE TABLE _snapback_future_authority(id TEXT)", [])
            .expect("create unknown authority table");
        let error = audit_connection(&conn).expect_err("unknown table must fail closed");
        assert_eq!(error.diagnostic.code, "SNAPBACK_FORK_CUSTODY_UNCLASSIFIED");
        assert_eq!(
            error.diagnostic.details["table"],
            "_snapback_future_authority"
        );
    }

    #[test]
    fn fresh_runtime_schema_is_fully_classified() {
        let directory = tempfile::tempdir().expect("fork custody tempdir");
        let path = directory.path().join("app.sqlite3");
        drop(crate::storage::LocalDatabase::open(&path).expect("create runtime database"));
        let conn = Connection::open(path).expect("open runtime schema");
        let classified = audit_connection(&conn).expect("classify runtime schema");
        assert!(!classified.is_empty());
        assert_eq!(
            TABLE_CUSTODY
                .iter()
                .map(|rule| rule.name)
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            TABLE_CUSTODY.len(),
            "table custody entries are unique"
        );
        assert_eq!(SIDECAR_CUSTODY.len(), 10);
        assert!(SIDECAR_CUSTODY.iter().any(|rule| {
            rule.name == "*.operation-detail-keyring.json"
                && rule.disposition == CustodyDisposition::Rotate
        }));
        assert_eq!(
            SIDECAR_CUSTODY
                .iter()
                .map(|rule| rule.name)
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            SIDECAR_CUSTODY.len(),
            "sidecar custody conventions are unique"
        );
    }

    #[test]
    fn fork_mint_preserves_authority_product_projection_rows() {
        let directory = tempfile::tempdir().expect("fork projection tempdir");
        let source_path = directory.path().join("source.sqlite3");
        let mut source =
            crate::storage::LocalDatabase::open(&source_path).expect("create source database");
        source
            .activate_current_auth_catalog()
            .expect("auth catalog");
        let schema =
            crate::storage::tests::membership_write_tests::authority_product_projection_schema(8);
        assert!(schema.tables.iter().any(|table| {
            table
                .authority_profile
                .as_ref()
                .is_some_and(|profile| profile.projection.is_some())
        }));
        source
            .schema_seed()
            .apply_schema(schema)
            .expect("activate projection-bearing schema");
        source
            .schema_seed()
            .seed(crate::manifest::SeedData {
                tables: BTreeMap::from([
                    (
                        "events".to_owned(),
                        vec![serde_json::Map::from_iter([
                            ("_id".to_owned(), json!("scope-1")),
                            ("title".to_owned(), json!("Projection fork")),
                        ])],
                    ),
                    (
                        "event_members".to_owned(),
                        vec![serde_json::Map::from_iter([
                            ("_id".to_owned(), json!("inc-1")),
                            ("eventId".to_owned(), json!("scope-1")),
                            ("userId".to_owned(), json!("alice")),
                            ("role".to_owned(), json!("owner")),
                        ])],
                    ),
                ]),
            })
            .expect("seed projection-bearing source");
        drop(source);

        let staging = directory.path().join("staging");
        fs::create_dir(&staging).expect("create staging directory");
        fs::write(staging.join(STAGING_SENTINEL), b"fork staging\n")
            .expect("write staging sentinel");
        let mut staged = StagedForkDatabase::prepare(&staging, "derived.sqlite3")
            .expect("prepare staged database");
        clone_database_into_staging(&source_path, &mut staged).expect("clone source database");
        scrub_and_mint_staged_database(&staged, "app-test", "parent-test", 20, false, None)
            .expect("mint derived database");

        let derived = Connection::open(staged.database_path()).expect("open derived database");
        for table in [
            "_snapback_authority_projection_horizons",
            "_snapback_authority_projection_events",
        ] {
            let sql = format!("SELECT count(*) FROM {table}");
            let count: u64 = derived
                .query_row(&sql, [], |row| row.get(0))
                .expect("count copied projection rows");
            assert_eq!(count, 1, "{table} is copied across fork mint");
        }
    }
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
    // diagnostics-registry: emission SNAPBACK_FORK_SERVER_EXPIRED
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

// @ref LLP 0188#2-integration-point-the-whole-instance-database — persistent
// WAL is connection-local, so every kernel fork backup, scrub, and lifecycle
// handle preserves the replication owner's journal before touching SQLite.
fn configure_fork_connection_wal_lifetime(conn: &Connection) -> SnapbackResult<()> {
    if crate::replication::configured_from_env() {
        crate::replication::configure_connection_wal_lifetime(conn)?;
        conn.execute_batch("PRAGMA wal_autocheckpoint = 0;")?;
    }
    Ok(())
}

fn open_fork_connection(path: &Path) -> SnapbackResult<Connection> {
    let conn = Connection::open(path)?;
    configure_fork_connection_wal_lifetime(&conn)?;
    Ok(conn)
}

fn open_fork_connection_with_flags(path: &Path, flags: OpenFlags) -> SnapbackResult<Connection> {
    let conn = Connection::open_with_flags(path, flags)?;
    configure_fork_connection_wal_lifetime(&conn)?;
    Ok(conn)
}

fn checkpoint_when_fork_owns_wal(conn: &Connection) -> SnapbackResult<()> {
    if !crate::replication::configured_from_env() {
        conn.execute_batch("PRAGMA wal_checkpoint(FULL);")?;
    }
    Ok(())
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
pub(crate) fn scrub_copied_authority_for_in_app_branch(
    conn: &mut Connection,
) -> SnapbackResult<()> {
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
