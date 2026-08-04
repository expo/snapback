//! Non-promotable, same-app derived deployment forks.
//!
//! This module is intentionally separate from `branches`: LLP 0097 branches
//! are promotable command logs, while these instances are independently
//! bootable deployments that can never promote into their parent.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub const STAGING_SENTINEL: &str = ".snapback-fork-staging.v1";
pub const MINT_RECEIPT_FILE: &str = "fork-mint-receipt.json";
const REGISTRY_DIRECTORY: &str = ".snapback-fork-registry";
const LINEAGE_META_KEY: &str = "instance_fork_lineage_v1";
const QUARANTINE_META_KEY: &str = "instance_fork_quarantine_v1";
const EGRESS_TABLE: &str = "_snapback_fork_egress_attempts_v1";

fn fork_error(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "instanceFork", message)
}

fn io_error(context: &'static str, error: std::io::Error) -> SnapbackError {
    fork_error("SNAPBACK_FORK_IO_FAILED", format!("{context}: {error}"))
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
        name: "_snapback_record_history_v1",
        disposition: CustodyDisposition::Copy,
    },
    CustodyRule {
        name: "_snapback_checkpoint_registry_v1",
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
        name: "_snapback_asset_records_v1",
        disposition: CustodyDisposition::Refuse,
    },
    CustodyRule {
        name: "_snapback_asset_attempts_v1",
        disposition: CustodyDisposition::Refuse,
    },
    CustodyRule {
        name: "_snapback_asset_blobs_v1",
        disposition: CustodyDisposition::Refuse,
    },
    CustodyRule {
        name: "_snapback_asset_renditions_v1",
        disposition: CustodyDisposition::Refuse,
    },
    CustodyRule {
        name: "_snapback_asset_reference_edges_v1",
        disposition: CustodyDisposition::Refuse,
    },
    CustodyRule {
        name: "_snapback_asset_publications_v1",
        disposition: CustodyDisposition::Refuse,
    },
    CustodyRule {
        name: "_snapback_asset_work_ledger_v1",
        disposition: CustodyDisposition::Refuse,
    },
    CustodyRule {
        name: "_snapback_asset_receipts_v1",
        disposition: CustodyDisposition::Refuse,
    },
    CustodyRule {
        name: "_snapback_asset_intent_generations_v1",
        disposition: CustodyDisposition::Refuse,
    },
    CustodyRule {
        name: "_snapback_asset_intent_artifacts_v1",
        disposition: CustodyDisposition::Refuse,
    },
    CustodyRule {
        name: "_snapback_asset_signing_keys_v1",
        disposition: CustodyDisposition::Rotate,
    },
    CustodyRule {
        name: "_snapback_asset_seed_fixtures_v1",
        disposition: CustodyDisposition::Refuse,
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
        name: "target reservations and ready capability siblings",
        disposition: CustodyDisposition::Scrub,
    },
];

fn custody_map() -> BTreeMap<&'static str, CustodyDisposition> {
    TABLE_CUSTODY
        .iter()
        .map(|rule| (rule.name, rule.disposition))
        .collect()
}

pub fn audit_connection(conn: &Connection) -> SnapbackResult<Vec<(String, CustodyDisposition)>> {
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DerivedForkLineageV1 {
    pub format_version: u32,
    pub fork_id: String,
    pub parent_instance_id: String,
    pub app_id: String,
    pub created_at_ms: u64,
    pub promotable: bool,
}

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

#[derive(Clone, Debug)]
pub struct DerivedForkRuntime {
    pub database_path: PathBuf,
    pub lineage: DerivedForkLineageV1,
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

fn write_json_sync(path: &Path, value: &impl Serialize) -> SnapbackResult<()> {
    let bytes = serde_json::to_vec(value).map_err(|error| {
        fork_error(
            "SNAPBACK_FORK_RECEIPT_INVALID",
            format!("fork evidence could not be encoded: {error}"),
        )
    })?;
    let mut file = File::create(path).map_err(|error| io_error("create fork evidence", error))?;
    file.write_all(&bytes)
        .map_err(|error| io_error("write fork evidence", error))?;
    file.sync_all()
        .map_err(|error| io_error("sync fork evidence", error))
}

fn sync_directory(path: &Path) -> SnapbackResult<()> {
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| io_error("sync fork directory", error))
}

fn sync_file(path: &Path, context: &'static str) -> SnapbackResult<()> {
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|error| io_error(context, error))
}

fn sync_sqlite_set(
    database_path: &Path,
    conn: &Connection,
    cut_at: Option<PublicationCut>,
) -> SnapbackResult<()> {
    conn.execute_batch("PRAGMA wal_checkpoint(FULL);")?;
    for (path, cut) in [
        (
            database_path.to_path_buf(),
            PublicationCut::AfterSqliteDatabaseSync,
        ),
        (
            PathBuf::from(format!("{}-wal", database_path.display())),
            PublicationCut::AfterSqliteWalSync,
        ),
        (
            PathBuf::from(format!("{}-shm", database_path.display())),
            PublicationCut::AfterSqliteShmSync,
        ),
        (
            PathBuf::from(format!("{}-journal", database_path.display())),
            PublicationCut::AfterSqliteJournalSync,
        ),
    ] {
        match File::open(&path).and_then(|file| file.sync_all()) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(io_error("sync fork SQLite durability set", error)),
        }
        maybe_cut(cut_at, cut)?;
    }
    sync_directory(database_path.parent().unwrap_or_else(|| Path::new(".")))
}

/// Scrub copied authority and mint all replacement identity inside the clone.
/// The caller must point this at a private staging directory.
///
/// @ref LLP 0158#design-sketch — parent credentials are deleted (hash lookup
/// makes rotation insufficient), while both stream identities and signing
/// authority rotate before the lineage stamp becomes permanent.
pub fn scrub_and_mint(
    database_path: &Path,
    app_id: &str,
    parent_instance_id: &str,
    now_ms: u64,
) -> SnapbackResult<ForkMintReceiptV1> {
    scrub_and_mint_with_cut(database_path, app_id, parent_instance_id, now_ms, None)
}

fn scrub_and_mint_with_cut(
    database_path: &Path,
    app_id: &str,
    parent_instance_id: &str,
    now_ms: u64,
    cut_at: Option<PublicationCut>,
) -> SnapbackResult<ForkMintReceiptV1> {
    let mut conn = Connection::open(database_path)?;
    let classified = audit_connection(&conn)?;
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

    let fork_id = Uuid::now_v7().to_string();
    let lineage = DerivedForkLineageV1 {
        format_version: 1,
        fork_id,
        parent_instance_id: parent_instance_id.to_owned(),
        app_id: app_id.to_owned(),
        created_at_ms: now_ms,
        promotable: false,
    };
    let database_file = database_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            fork_error(
                "SNAPBACK_FORK_PATH_INVALID",
                "fork database needs a UTF-8 file name",
            )
        })?
        .to_owned();

    let admin_path = crate::admin::admin_token_sibling(database_path);
    let auth_keyring_path = crate::auth::keyring::AuthKeyringStore::keyring_path(database_path);
    let resume_path = database_path.with_file_name(crate::rqs::RESUME_KEYRING_FILE_NAME);
    if admin_path.exists() || auth_keyring_path.exists() || resume_path.exists() {
        return Err(fork_error(
            "SNAPBACK_FORK_SIDECAR_COLLISION",
            "fork replacement sidecars must be minted into an empty staging namespace",
        ));
    }
    let admin_token = crate::admin::mint_admin_token();
    crate::secure_file::write_new_owner_only(&admin_path, format!("{admin_token}\n").as_bytes())
        .map_err(|error| io_error("mint fork admin token", error))?;
    sync_file(&admin_path, "sync fork admin token")?;
    maybe_cut(cut_at, PublicationCut::AfterAdminSidecar)?;
    crate::auth::keyring::AuthKeyringStore::file_for_database(database_path)
        .load_or_mint_initial(now_ms, &crate::auth::crypto::OsRandom)
        .map_err(|error| fork_error("SNAPBACK_FORK_KEYRING_MINT_FAILED", error.to_string()))?;
    sync_file(&auth_keyring_path, "sync fork auth keyring")?;
    maybe_cut(cut_at, PublicationCut::AfterAuthSidecar)?;
    let _resume = crate::rqs::ResumeKeyring::load_or_create(resume_path.clone(), now_ms);
    if !crate::rqs::ResumeKeyring::persisted_file_has_active_key(&resume_path) {
        return Err(fork_error(
            "SNAPBACK_FORK_KEYRING_MINT_FAILED",
            "fork resume keyring was not durably minted",
        ));
    }
    sync_file(&resume_path, "sync fork resume keyring")?;
    maybe_cut(cut_at, PublicationCut::AfterResumeSidecar)?;

    let mut custody = classified.into_iter().collect::<BTreeMap<_, _>>();
    custody.extend(
        SIDECAR_CUSTODY
            .iter()
            .map(|rule| (format!("sidecar:{}", rule.name), rule.disposition)),
    );
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
    // Quarantine disappears only in the same transaction that publishes the
    // permanent, explicitly non-promotable lineage.
    tx.execute(
        "DELETE FROM _snapback_meta WHERE key=?1",
        [QUARANTINE_META_KEY],
    )?;
    tx.execute(
        "INSERT INTO _snapback_meta(key,value) VALUES(?1,?2)",
        params![LINEAGE_META_KEY, lineage_json],
    )?;
    tx.commit()?;
    maybe_cut(cut_at, PublicationCut::AfterDatabaseMint)?;

    let receipt = ForkMintReceiptV1 {
        format_version: 1,
        lineage,
        database_file,
        authorization_stream_incarnation: authorization.incarnation,
        data_version_stream,
        custody,
    };
    let receipt_path = database_path.with_file_name(MINT_RECEIPT_FILE);
    write_json_sync(&receipt_path, &receipt)?;
    maybe_cut(cut_at, PublicationCut::AfterMintReceipt)?;
    sync_sqlite_set(database_path, &conn, cut_at)?;
    maybe_cut(cut_at, PublicationCut::AfterSqliteSync)?;
    sync_directory(database_path.parent().unwrap_or_else(|| Path::new(".")))?;
    Ok(receipt)
}

pub fn inspect_boot(database_path: &Path) -> SnapbackResult<Option<DerivedForkRuntime>> {
    let directory = database_path.parent().unwrap_or_else(|| Path::new("."));
    if directory.join(STAGING_SENTINEL).exists() {
        return Err(fork_error(
            "SNAPBACK_FORK_QUARANTINED",
            "a staging sentinel prevents this derived deployment from serving",
        ));
    }
    inspect_evidence(database_path)
}

fn inspect_evidence(database_path: &Path) -> SnapbackResult<Option<DerivedForkRuntime>> {
    let directory = database_path.parent().unwrap_or_else(|| Path::new("."));
    if !database_path.exists() {
        return Ok(None);
    }
    let conn = Connection::open(database_path)?;
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
            let receipt: ForkMintReceiptV1 = serde_json::from_slice(
                &fs::read(&receipt_path).map_err(|error| io_error("read fork receipt", error))?,
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

fn validate_minted_sidecars(database_path: &Path) -> SnapbackResult<()> {
    let invalid = || {
        fork_error(
            "SNAPBACK_FORK_EVIDENCE_INCOMPLETE",
            "fork mint sidecars are missing or invalid",
        )
    };
    let admin =
        crate::secure_file::read_owner_only(&crate::admin::admin_token_sibling(database_path))
            .map_err(|_| invalid())?;
    let admin = std::str::from_utf8(&admin).map_err(|_| invalid())?.trim();
    if admin.len() != 37 || !admin.starts_with("sbat_") {
        return Err(invalid());
    }
    crate::auth::keyring::AuthKeyringStore::file_for_database(database_path)
        .load_existing()
        .map_err(|_| invalid())?;
    let resume_path = database_path.with_file_name(crate::rqs::RESUME_KEYRING_FILE_NAME);
    if !crate::rqs::ResumeKeyring::persisted_file_has_active_key(&resume_path) {
        return Err(invalid());
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EgressFamily {
    Fetch,
    PushSend,
    PushReceipt,
    StreamOpen,
    StreamRead,
    StreamCancel,
    JobsEnqueue,
    JobsDrain,
    CronTick,
    AssetProvider,
    TelemetryExport,
    UnclassifiedHostOperation,
}

impl EgressFamily {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Fetch => "fetch",
            Self::PushSend => "push_send",
            Self::PushReceipt => "push_receipt",
            Self::StreamOpen => "stream_open",
            Self::StreamRead => "stream_read",
            Self::StreamCancel => "stream_cancel",
            Self::JobsEnqueue => "jobs_enqueue",
            Self::JobsDrain => "jobs_drain",
            Self::CronTick => "cron_tick",
            Self::AssetProvider => "asset_provider",
            Self::TelemetryExport => "telemetry_export",
            Self::UnclassifiedHostOperation => "unclassified_host_operation",
        }
    }

    /// Classify the complete current Ibex host-op vocabulary. Unknown future
    /// operations deny on a fork until deliberately classified as local.
    pub fn for_derived_host_op(op: &str) -> Option<Self> {
        match op {
            "host.fetch" | "action.externalEffectBegin" => Some(Self::Fetch),
            "push.send" => Some(Self::PushSend),
            "action.streamOpen" => Some(Self::StreamOpen),
            "action.streamRead" => Some(Self::StreamRead),
            "action.streamCancel" => Some(Self::StreamCancel),
            "jobs.enqueue" => Some(Self::JobsEnqueue),
            "db.query"
            | "db.get"
            | "db.insert"
            | "db.patch"
            | "db.delete"
            | "sequence.allocate"
            | "assets.attach"
            | "membership.write"
            | "runtime.now"
            | "runtime.log"
            | "runtime.id"
            | "action.metadata"
            | "action.externalEffectInitiated"
            | "action.runMutation"
            | "action.streamAttemptStart"
            | "action.streamAttemptSettle"
            | "permissions.requireRole" => None,
            _ => Some(Self::UnclassifiedHostOperation),
        }
    }
}

impl DerivedForkRuntime {
    /// Persist a bounded, payload-free marker before returning the refusal.
    ///
    /// @ref LLP 0162#acceptance — DenyAll still leaves durable proof by
    /// closed effect family; no request URL/body/token enters this table.
    pub fn deny(&self, family: EgressFamily, now_ms: u64) -> SnapbackError {
        let recorded = (|| -> SnapbackResult<()> {
            let conn = Connection::open(&self.database_path)?;
            conn.execute(
                "INSERT INTO _snapback_fork_egress_attempts_v1(
                   family,attempts,first_attempt_at_ms,last_attempt_at_ms
                 ) VALUES(?1,1,?2,?2)
                 ON CONFLICT(family) DO UPDATE SET
                   attempts=MIN(attempts + 1, 9223372036854775807),
                   last_attempt_at_ms=excluded.last_attempt_at_ms",
                params![family.as_str(), now_ms],
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PublicationCut {
    AfterSentinelWrite,
    AfterSentinelDirectorySync,
    AfterClone,
    AfterAdminSidecar,
    AfterAuthSidecar,
    AfterResumeSidecar,
    AfterDatabaseMint,
    AfterMintReceipt,
    AfterSqliteDatabaseSync,
    AfterSqliteWalSync,
    AfterSqliteShmSync,
    AfterSqliteJournalSync,
    AfterSqliteSync,
    AfterStagingDirectorySync,
    AfterRegistryIntent,
    AfterRename,
    AfterParentDirectorySync,
    AfterRegistryFinalize,
    AfterSentinelUnlink,
    AfterPublishedDirectorySync,
}

fn crash(cut: PublicationCut) -> SnapbackError {
    fork_error(
        "SNAPBACK_FORK_TEST_CRASH_CUT",
        format!("injected crash after {cut:?}"),
    )
}

fn maybe_cut(cut_at: Option<PublicationCut>, point: PublicationCut) -> SnapbackResult<()> {
    if cut_at == Some(point) {
        Err(crash(point))
    } else {
        Ok(())
    }
}

fn registry_path(parent: &Path, fork_id: &str) -> PathBuf {
    parent
        .join(REGISTRY_DIRECTORY)
        .join(format!("{fork_id}.json"))
}

fn reconcile_registry(parent: &Path, destination: &Path, receipt: &ForkMintReceiptV1) {
    // Advisory bookkeeping must never become recovery authority. Reconcile
    // when reachable and deliberately discard every registry error.
    let _ = (|| -> SnapbackResult<()> {
        let directory = parent.join(REGISTRY_DIRECTORY);
        fs::create_dir_all(&directory)
            .map_err(|error| io_error("create fork registry during recovery", error))?;
        write_json_sync(
            &registry_path(parent, &receipt.lineage.fork_id),
            &json!({
                "state": "published",
                "destination": destination.file_name().and_then(|value| value.to_str()),
                "lineage": receipt.lineage,
            }),
        )?;
        sync_directory(&directory)
    })();
}

/// Publish a derived deployment using rename as the sole authoritative commit.
/// `cut_at` exists only for the exhaustive crash matrix.
///
/// @ref LLP 0158#design-sketch — S0-S5 local evidence is authoritative;
/// registry state is reconciled bookkeeping and never boot authority.
pub fn publish(
    source_database: &Path,
    destination: &Path,
    app_id: &str,
    parent_instance_id: &str,
    now_ms: u64,
    cut_at: Option<PublicationCut>,
) -> SnapbackResult<ForkMintReceiptV1> {
    if destination.exists() {
        return Err(fork_error(
            "SNAPBACK_FORK_DESTINATION_EXISTS",
            "fork destination already exists",
        ));
    }
    if inspect_boot(source_database)?.is_some() {
        return Err(fork_error(
            "SNAPBACK_FORK_NESTED_REFUSED",
            "v1 does not fork a derived deployment",
        ));
    }
    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|error| io_error("create fork parent", error))?;
    let destination_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            fork_error(
                "SNAPBACK_FORK_PATH_INVALID",
                "fork destination needs a UTF-8 name",
            )
        })?;
    let staging = parent.join(format!(".{destination_name}.staging-{}", Uuid::now_v7()));
    fs::create_dir(&staging).map_err(|error| io_error("create fork staging directory", error))?;
    let sentinel = staging.join(STAGING_SENTINEL);
    File::create(&sentinel)
        .and_then(|file| file.sync_all())
        .map_err(|error| io_error("write fork staging sentinel", error))?;
    maybe_cut(cut_at, PublicationCut::AfterSentinelWrite)?;
    sync_directory(&staging)?;
    maybe_cut(cut_at, PublicationCut::AfterSentinelDirectorySync)?;

    let database_file = source_database
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            fork_error(
                "SNAPBACK_FORK_PATH_INVALID",
                "source database needs a UTF-8 file name",
            )
        })?;
    let staging_database = staging.join(database_file);
    let source = Connection::open(source_database)?;
    audit_connection(&source)?;
    let mut target = Connection::open(&staging_database)?;
    {
        let backup = rusqlite::backup::Backup::new(&source, &mut target)?;
        backup.run_to_completion(128, std::time::Duration::from_millis(1), None)?;
    }
    drop(target);
    maybe_cut(cut_at, PublicationCut::AfterClone)?;

    let receipt = scrub_and_mint_with_cut(
        &staging_database,
        app_id,
        parent_instance_id,
        now_ms,
        cut_at,
    )?;
    sync_directory(&staging)?;
    maybe_cut(cut_at, PublicationCut::AfterStagingDirectorySync)?;

    let registry_directory = parent.join(REGISTRY_DIRECTORY);
    fs::create_dir_all(&registry_directory)
        .map_err(|error| io_error("create fork registry", error))?;
    let registry = registry_path(parent, &receipt.lineage.fork_id);
    write_json_sync(
        &registry,
        &json!({ "state": "intent", "lineage": receipt.lineage }),
    )?;
    sync_directory(&registry_directory)?;
    maybe_cut(cut_at, PublicationCut::AfterRegistryIntent)?;

    fs::rename(&staging, destination)
        .map_err(|error| io_error("commit fork directory rename", error))?;
    maybe_cut(cut_at, PublicationCut::AfterRename)?;
    sync_directory(parent)?;
    maybe_cut(cut_at, PublicationCut::AfterParentDirectorySync)?;
    let registry_result = write_json_sync(
        &registry,
        &json!({
            "state": "published",
            "destination": destination.file_name().and_then(|value| value.to_str()),
            "lineage": receipt.lineage,
        }),
    );
    if registry_result.is_ok() {
        let _ = sync_directory(&registry_directory);
    }
    maybe_cut(cut_at, PublicationCut::AfterRegistryFinalize)?;
    fs::remove_file(destination.join(STAGING_SENTINEL))
        .map_err(|error| io_error("remove published fork sentinel", error))?;
    maybe_cut(cut_at, PublicationCut::AfterSentinelUnlink)?;
    sync_directory(destination)?;
    maybe_cut(cut_at, PublicationCut::AfterPublishedDirectorySync)?;
    Ok(receipt)
}

/// Recover solely from local staging/published evidence. A missing or corrupt
/// advisory registry is deliberately ignored.
pub fn recover(parent: &Path, destination: &Path) -> SnapbackResult<()> {
    if destination.exists() && destination.join(STAGING_SENTINEL).exists() {
        let receipt_path = destination.join(MINT_RECEIPT_FILE);
        let receipt: ForkMintReceiptV1 = serde_json::from_slice(
            &fs::read(&receipt_path)
                .map_err(|error| io_error("read recovered fork receipt", error))?,
        )
        .map_err(|_| {
            fork_error(
                "SNAPBACK_FORK_RECEIPT_INVALID",
                "recovered fork mint receipt is malformed",
            )
        })?;
        let database = destination.join(&receipt.database_file);
        if !database.is_file() {
            return Err(fork_error(
                "SNAPBACK_FORK_EVIDENCE_INCOMPLETE",
                "published fork database is missing",
            ));
        }
        // @ref LLP 0158#design-sketch — keep quarantine
        // present through the complete local-evidence check; a recovery crash
        // must never expose a bootable derived deployment.
        let sentinel = destination.join(STAGING_SENTINEL);
        match inspect_evidence(&database) {
            Ok(Some(_)) => {
                reconcile_registry(parent, destination, &receipt);
                fs::remove_file(&sentinel)
                    .map_err(|error| io_error("clear recovered sentinel", error))?;
                sync_directory(destination)?;
                sync_directory(parent)?;
                return Ok(());
            }
            other => {
                other?;
            }
        }
    }
    let prefix = destination
        .file_name()
        .and_then(|value| value.to_str())
        .map(|name| format!(".{name}.staging-"));
    if let Some(prefix) = prefix {
        for entry in fs::read_dir(parent)
            .map_err(|error| io_error("scan fork staging directories", error))?
        {
            let entry = entry.map_err(|error| io_error("read fork staging entry", error))?;
            if entry.file_name().to_string_lossy().starts_with(&prefix) {
                fs::remove_dir_all(entry.path())
                    .map_err(|error| io_error("reap unpublished fork staging", error))?;
            }
        }
        sync_directory(parent)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source_database(directory: &Path) -> PathBuf {
        let path = directory.join("app.sqlite3");
        let db = crate::storage::LocalDatabase::open(&path).unwrap();
        drop(db);
        path
    }

    #[test]
    fn custody_sweep_fails_for_unknown_owned_table() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE _snapback_future_authority(id TEXT)", [])
            .unwrap();
        let error = audit_connection(&conn).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_FORK_CUSTODY_UNCLASSIFIED");
        assert_eq!(
            error.diagnostic.details["table"],
            "_snapback_future_authority"
        );
    }

    #[test]
    fn fresh_runtime_schema_is_fully_classified() {
        let directory = tempfile::tempdir().unwrap();
        let path = source_database(directory.path());
        let conn = Connection::open(path).unwrap();
        let classified = audit_connection(&conn).unwrap();
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
        assert_eq!(SIDECAR_CUSTODY.len(), 8);
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
    fn asset_bearing_source_refuses_until_private_tree_copy_exists() {
        let directory = tempfile::tempdir().unwrap();
        let source = source_database(directory.path());
        let conn = Connection::open(&source).unwrap();
        conn.execute(
            "INSERT INTO _snapback_asset_records_v1(
               asset_id,app_id,intent_id,owner_principal,availability,
               lifecycle_generation,record_json,updated_at_ms
             ) VALUES('asset-a','app-a','intent-a','user-a','ready',1,'{}',1)",
            [],
        )
        .unwrap();
        let error = publish(
            &source,
            &directory.path().join("fork"),
            "app-a",
            "parent-a",
            42,
            None,
        )
        .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_FORK_CUSTODY_REFUSED");
        assert_eq!(
            error.diagnostic.details["table"],
            "_snapback_asset_records_v1"
        );
    }

    #[test]
    fn scrub_mints_non_promotable_identity_and_payload_free_marker() {
        let directory = tempfile::tempdir().unwrap();
        let source = source_database(directory.path());
        let destination = directory.path().join("fork");
        let receipt = publish(&source, &destination, "app-a", "parent-a", 42, None).unwrap();
        assert!(!receipt.lineage.promotable);
        for rule in SIDECAR_CUSTODY {
            assert_eq!(
                receipt.custody[&format!("sidecar:{}", rule.name)],
                rule.disposition
            );
        }
        let database = destination.join("app.sqlite3");
        let runtime = inspect_boot(&database).unwrap().unwrap();
        let error = runtime.deny(EgressFamily::Fetch, 43);
        assert_eq!(error.diagnostic.code, "SNAPBACK_FORK_EGRESS_DENIED");
        let conn = Connection::open(&database).unwrap();
        let row: (String, u64) = conn
            .query_row(
                "SELECT family,attempts FROM _snapback_fork_egress_attempts_v1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(row, ("fetch".to_owned(), 1));
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM pragma_table_info('_snapback_fork_egress_attempts_v1')",
                [],
                |row| row.get::<_, u64>(0)
            )
            .unwrap(),
            4
        );
        drop(conn);
        let mut served = crate::local::LocalSnapback::open(&database).unwrap();
        assert!(served.is_derived_fork());
        assert_eq!(
            served
                .claim_due_cron_runs(44)
                .err()
                .unwrap()
                .diagnostic
                .code,
            "SNAPBACK_FORK_EGRESS_DENIED"
        );
        assert_eq!(
            served
                .claim_due_jobs(
                    45,
                    1,
                    "fork-test",
                    crate::local::DiagnosticBoundary::Standalone,
                )
                .err()
                .unwrap()
                .diagnostic
                .code,
            "SNAPBACK_FORK_EGRESS_DENIED"
        );
    }

    #[test]
    fn parent_credential_and_cursor_corpus_is_refused_by_minted_fork() {
        let directory = tempfile::tempdir().unwrap();
        let source = source_database(directory.path());
        let parent_admin = "sbat_parent_must_not_survive";
        crate::secure_file::write_owner_only(
            &crate::admin::admin_token_sibling(&source),
            format!("{parent_admin}\n").as_bytes(),
        )
        .unwrap();
        let parent_auth_keyring =
            crate::auth::keyring::AuthKeyringStore::file_for_database(&source);
        parent_auth_keyring
            .load_or_mint_initial(1_000, &crate::auth::crypto::OsRandom)
            .unwrap();
        let parent_auth_bytes = fs::read(crate::auth::keyring::AuthKeyringStore::keyring_path(
            &source,
        ))
        .unwrap();

        let parent_resume_path = directory.path().join(crate::rqs::RESUME_KEYRING_FILE_NAME);
        let mut parent_resume =
            crate::rqs::ResumeKeyring::load_or_create(parent_resume_path, 1_000);
        let (parent_resume_key_id, parent_resume_key) = parent_resume.active(1_000).unwrap();
        let parent_resume_body = crate::rqs::ResumeTokenBody {
            app: "app-a".to_owned(),
            generation: "generation-a".to_owned(),
            version_stream: "parent-stream".to_owned(),
            version: 1,
            query_artifact: "query-a".to_owned(),
            args_hash: "sha256:args".to_owned(),
            digest_kind: "rows".to_owned(),
            content_digest: "sha256:rows".to_owned(),
            issued_at: 1_000,
            auth_partition: None,
        };
        let parent_resume_token = crate::rqs::mint_token_wire(
            parent_resume_key.as_ref(),
            &parent_resume_key_id,
            &parent_resume_body,
        );
        let (search_generation, search_root) = parent_resume
            .search_cursor_materials(1_000)
            .into_iter()
            .next()
            .unwrap();
        let parent_search_cursor = crate::search::cursor::mint(
            &search_root,
            &crate::search::types::SearchCursorV1 {
                format_version: 1,
                app_id: "app-a".to_owned(),
                database_id: "parent-a".to_owned(),
                target_profile_id: "local-dev-sqlite-ibex".to_owned(),
                stream_epoch: "parent-stream".to_owned(),
                semantic_version: "v1".to_owned(),
                physical_generation: 1,
                query_core_hash: "sha256:q".to_owned(),
                limit: 10,
                authority_instance: "parent-auth".to_owned(),
                owner_subject: None,
                release_policy_digest: "sha256:p".to_owned(),
                score: 100,
                row_id: "row-a".to_owned(),
                row_id_direction: "asc".to_owned(),
                key_generation: search_generation,
                issued_at: 1_000,
                expires_at: 121_000,
                membership_resource: None,
                membership_declaration: None,
                membership_roles: None,
                authorization_incarnation: None,
                authorization_epoch: None,
            },
        )
        .unwrap();

        let parent_asset_token;
        let parent_authorization;
        let parent_data_stream;
        {
            let mut conn = Connection::open(&source).unwrap();
            conn.execute_batch(
                "CREATE TABLE _auth_sessions(id TEXT PRIMARY KEY, token_hash TEXT);
                 CREATE TABLE _auth_agent_credentials(id TEXT PRIMARY KEY, token_hash TEXT);
                 INSERT INTO _auth_sessions VALUES('session-a','parent-session-token-hash');
                 INSERT INTO _auth_agent_credentials VALUES('agent-a','parent-agent-token-hash');",
            )
            .unwrap();
            let tx = conn.transaction().unwrap();
            crate::assets::create_infra(&tx).unwrap();
            let key = crate::assets::active_signing_key(&tx, 1_000).unwrap();
            parent_asset_token = crate::assets::mint_signed_url_token(
                &key, "asset-a", "original", "user-a", 1, 10_000,
            );
            parent_authorization =
                crate::storage::auth_stream::rotate_authorization_version_in(&tx)
                    .unwrap()
                    .incarnation;
            parent_data_stream =
                crate::storage::auth_invalidation::rotate_data_version_stream_in(&tx).unwrap();
            tx.commit().unwrap();
        }

        let destination = directory.path().join("fork");
        let receipt = publish(&source, &destination, "app-a", "parent-a", 2_000, None).unwrap();
        assert_ne!(
            receipt.authorization_stream_incarnation,
            parent_authorization
        );
        assert_ne!(receipt.data_version_stream, parent_data_stream);
        let database = destination.join("app.sqlite3");
        let conn = Connection::open(&database).unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM _auth_sessions", [], |row| row
                .get::<_, u64>(0))
                .unwrap(),
            0,
            "parent session bearer hash is absent"
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM _auth_agent_credentials", [], |row| {
                row.get::<_, u64>(0)
            })
            .unwrap(),
            0,
            "parent agent credential hash is absent"
        );
        let child_admin = fs::read_to_string(crate::admin::admin_token_sibling(&database)).unwrap();
        assert_ne!(child_admin.trim(), parent_admin);
        let child_auth_bytes = fs::read(crate::auth::keyring::AuthKeyringStore::keyring_path(
            &database,
        ))
        .unwrap();
        assert_ne!(child_auth_bytes, parent_auth_bytes);
        let child_resume = crate::rqs::ResumeKeyring::load_or_create(
            destination.join(crate::rqs::RESUME_KEYRING_FILE_NAME),
            2_000,
        );
        assert!(
            crate::rqs::decode_and_verify(
                &parent_resume_token,
                &child_resume,
                2_000,
                crate::rqs::RESUME_TOKEN_MAX_AGE_MS,
            )
            .is_err(),
            "parent resume token must not verify under the fork keyring"
        );
        assert!(
            crate::search::cursor::decode(
                &parent_search_cursor,
                &child_resume.search_cursor_materials(2_000),
                "app-a",
                "local-dev-sqlite-ibex",
                2_000,
            )
            .is_err(),
            "parent search cursor must not decrypt under the fork keyring"
        );
        let tx = conn.unchecked_transaction().unwrap();
        assert!(matches!(
            crate::assets::validate_signed_url_token(
                &tx,
                &parent_asset_token,
                "asset-a",
                "original",
                1,
                2_000,
            )
            .unwrap(),
            crate::assets::SignedTokenOutcome::Invalid
        ));
    }

    #[test]
    fn every_deny_all_family_has_one_bounded_payload_free_row() {
        let directory = tempfile::tempdir().unwrap();
        let source = source_database(directory.path());
        let destination = directory.path().join("fork");
        publish(&source, &destination, "app-a", "parent-a", 42, None).unwrap();
        let runtime = inspect_boot(&destination.join("app.sqlite3"))
            .unwrap()
            .unwrap();
        let families = [
            EgressFamily::Fetch,
            EgressFamily::PushSend,
            EgressFamily::PushReceipt,
            EgressFamily::StreamOpen,
            EgressFamily::StreamRead,
            EgressFamily::StreamCancel,
            EgressFamily::JobsEnqueue,
            EgressFamily::JobsDrain,
            EgressFamily::CronTick,
            EgressFamily::AssetProvider,
            EgressFamily::TelemetryExport,
            EgressFamily::UnclassifiedHostOperation,
        ];
        for family in families {
            assert_eq!(
                runtime.deny(family, 43).diagnostic.code,
                "SNAPBACK_FORK_EGRESS_DENIED"
            );
        }
        let conn = Connection::open(&runtime.database_path).unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM _snapback_fork_egress_attempts_v1",
                [],
                |row| row.get::<_, usize>(0),
            )
            .unwrap(),
            families.len()
        );
        let total: u64 = conn
            .query_row(
                "SELECT SUM(attempts) FROM _snapback_fork_egress_attempts_v1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(total, families.len() as u64);
        assert_eq!(
            EgressFamily::for_derived_host_op("future.networkDial"),
            Some(EgressFamily::UnclassifiedHostOperation)
        );
        assert_eq!(EgressFamily::for_derived_host_op("db.query"), None);
    }

    #[tokio::test]
    async fn direct_telemetry_export_route_refuses_before_export_read() {
        use axum::body::{Body, to_bytes};
        use axum::http::Request;
        use std::collections::BTreeSet;
        use std::time::Duration;
        use tower::ServiceExt as _;

        let directory = tempfile::tempdir().unwrap();
        let source = source_database(directory.path());
        let destination = directory.path().join("fork");
        publish(&source, &destination, "app-a", "parent-a", 42, None).unwrap();
        let database = destination.join("app.sqlite3");
        let snapback = crate::local::LocalSnapback::open(&database).unwrap();
        let (state, operator) = crate::admin::AppState::from_snapback_with_secret_read_operator(
            snapback,
            crate::admin::ServerContext::detached(),
        );
        let lease = operator
            .mint(crate::admin_secret_read::SecretReadLeaseRequest {
                scopes: BTreeSet::from([
                    crate::admin_secret_read::SecretReadScope::TelemetryExport,
                ]),
                ttl: Duration::from_secs(60),
                row_budget: 100,
                byte_budget: 1024 * 1024,
            })
            .unwrap();
        let response = crate::server::app(state)
            .oneshot(
                Request::builder()
                    .uri("/_snapback/api/telemetry/export?kind=log")
                    .header(
                        crate::admin_secret_read::SECRET_READ_LEASE_HEADER,
                        lease.bearer(),
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), axum::http::StatusCode::FORBIDDEN);
        let body = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["diagnostic"]["code"], "SNAPBACK_FORK_EGRESS_DENIED");
    }

    #[test]
    fn boot_refuses_staging_and_incomplete_local_evidence() {
        let directory = tempfile::tempdir().unwrap();
        let source = source_database(directory.path());
        File::create(directory.path().join(STAGING_SENTINEL)).unwrap();
        assert_eq!(
            inspect_boot(&source).unwrap_err().diagnostic.code,
            "SNAPBACK_FORK_QUARANTINED"
        );
        fs::remove_file(directory.path().join(STAGING_SENTINEL)).unwrap();
        let conn = Connection::open(&source).unwrap();
        conn.execute(
            "INSERT INTO _snapback_meta(key,value) VALUES(?1,?2)",
            params![
                LINEAGE_META_KEY,
                serde_json::to_string(&DerivedForkLineageV1 {
                    format_version: 1,
                    fork_id: Uuid::now_v7().to_string(),
                    parent_instance_id: "parent-a".to_owned(),
                    app_id: "app-a".to_owned(),
                    created_at_ms: 1,
                    promotable: false,
                })
                .unwrap()
            ],
        )
        .unwrap();
        assert_eq!(
            inspect_boot(&source).unwrap_err().diagnostic.code,
            "SNAPBACK_FORK_EVIDENCE_INCOMPLETE"
        );
    }

    #[test]
    fn boot_refuses_each_missing_minted_sidecar() {
        for sidecar in ["admin", "auth", "resume"] {
            let directory = tempfile::tempdir().unwrap();
            let source = source_database(directory.path());
            let destination = directory.path().join("fork");
            publish(&source, &destination, "app-a", "parent-a", 42, None).unwrap();
            let database = destination.join("app.sqlite3");
            let path = match sidecar {
                "admin" => crate::admin::admin_token_sibling(&database),
                "auth" => crate::auth::keyring::AuthKeyringStore::keyring_path(&database),
                "resume" => destination.join(crate::rqs::RESUME_KEYRING_FILE_NAME),
                _ => unreachable!(),
            };
            fs::remove_file(path).unwrap();
            assert_eq!(
                inspect_boot(&database).unwrap_err().diagnostic.code,
                "SNAPBACK_FORK_EVIDENCE_INCOMPLETE",
                "{sidecar}"
            );
        }
    }

    #[test]
    fn publication_crash_matrix_recovers_to_absent_or_bootable_without_registry() {
        let cuts = [
            PublicationCut::AfterSentinelWrite,
            PublicationCut::AfterSentinelDirectorySync,
            PublicationCut::AfterClone,
            PublicationCut::AfterAdminSidecar,
            PublicationCut::AfterAuthSidecar,
            PublicationCut::AfterResumeSidecar,
            PublicationCut::AfterDatabaseMint,
            PublicationCut::AfterMintReceipt,
            PublicationCut::AfterSqliteDatabaseSync,
            PublicationCut::AfterSqliteWalSync,
            PublicationCut::AfterSqliteShmSync,
            PublicationCut::AfterSqliteJournalSync,
            PublicationCut::AfterSqliteSync,
            PublicationCut::AfterStagingDirectorySync,
            PublicationCut::AfterRegistryIntent,
            PublicationCut::AfterRename,
            PublicationCut::AfterParentDirectorySync,
            PublicationCut::AfterRegistryFinalize,
            PublicationCut::AfterSentinelUnlink,
            PublicationCut::AfterPublishedDirectorySync,
        ];
        for (index, cut) in cuts.into_iter().enumerate() {
            let directory = tempfile::tempdir().unwrap();
            let source = source_database(directory.path());
            let destination = directory.path().join("fork");
            let error =
                publish(&source, &destination, "app-a", "parent-a", 42, Some(cut)).unwrap_err();
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_FORK_TEST_CRASH_CUT",
                "{cut:?}"
            );
            let registry = directory.path().join(REGISTRY_DIRECTORY);
            let _ = fs::remove_dir_all(&registry);
            let _ = fs::remove_file(&registry);
            match index % 3 {
                0 => {} // absent
                1 => {
                    fs::create_dir(&registry).unwrap();
                    fs::write(registry.join("stale.json"), b"not registry json").unwrap();
                }
                _ => {
                    File::create(&registry).unwrap(); // unavailable as a directory
                }
            }
            recover(directory.path(), &destination).unwrap();
            if destination.exists() {
                assert!(
                    inspect_boot(&destination.join("app.sqlite3"))
                        .unwrap()
                        .is_some(),
                    "{cut:?}"
                );
            }
        }
    }
}
