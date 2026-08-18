//! Local SQLite write authority for LLP 0162's covered application tables.
//!
//! The facade is deliberately crate-private. A caller cannot construct a
//! [`GeneratedWriterTokenV1`]; it can only enter one of the closed physical
//! writer adapters below. Once any coverage manifest is active, SQLite itself
//! refuses application-table DML and schema changes prepared without a live
//! token. This turns the Rust inventory into an enforceable boundary rather
//! than a list that a later raw-SQL path can bypass.
//!
//! @ref LLP 0162#4-journal-diff-instead-of-maintained-merkle-state — complete
//!   covered-lane journals require an unforgeable writer token plus a SQLite
//!   authorizer, not test-only enumeration.

use super::{LocalDatabase, SchemaManifest};
use crate::commit_envelope::OperationCoverageManifestV1;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use rusqlite::Connection;
use rusqlite::config::DbConfig;
use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use serde::Serialize;
use std::collections::BTreeSet;
use std::sync::{Arc, Mutex, MutexGuard};

pub(super) const LOCAL_TARGET_PROFILE_V1: &str = "local-dev-sqlite-ibex";

/// The complete local-target durable application-writer inventory at this
/// revision. Adding a physical writer requires adding a variant and an entry;
/// exhaustive matches below make an unclassified writer a compile failure.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum LocalWriterLaneV1 {
    OrdinaryHostPlan,
    OrdinaryIbexBuffered,
    HostChildHostPlan,
    HostChildIbexBuffered,
    SchemaActivation,
    MigrationExecutor,
    ResetAndSeed,
    StandaloneSeed,
    MembershipTransition,
    ProjectionRebuild,
    ProjectionMaintenance,
    AuthCatalog,
    AdminControl,
    AssetCatalog,
    SearchIndex,
    VectorIndex,
    PushRegistry,
    JobAndCronState,
    JournalMaintenance,
    OperationLedger,
    HistoryAndCheckpoint,
    BranchRegistry,
    StrictPromotionReexecution,
    DryRun,
}

impl LocalWriterLaneV1 {
    pub(super) const ALL: [Self; 24] = [
        Self::OrdinaryHostPlan,
        Self::OrdinaryIbexBuffered,
        Self::HostChildHostPlan,
        Self::HostChildIbexBuffered,
        Self::SchemaActivation,
        Self::MigrationExecutor,
        Self::ResetAndSeed,
        Self::StandaloneSeed,
        Self::MembershipTransition,
        Self::ProjectionRebuild,
        Self::ProjectionMaintenance,
        Self::AuthCatalog,
        Self::AdminControl,
        Self::AssetCatalog,
        Self::SearchIndex,
        Self::VectorIndex,
        Self::PushRegistry,
        Self::JobAndCronState,
        Self::JournalMaintenance,
        Self::OperationLedger,
        Self::HistoryAndCheckpoint,
        Self::BranchRegistry,
        Self::StrictPromotionReexecution,
        Self::DryRun,
    ];

    pub(super) const fn logical_lane(self) -> &'static str {
        match self {
            Self::OrdinaryHostPlan | Self::OrdinaryIbexBuffered => {
                crate::operation_ledger::ORDINARY_MUTATION_LANE_V1
            }
            Self::HostChildHostPlan | Self::HostChildIbexBuffered => {
                crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1
            }
            Self::SchemaActivation => "schemaActivation",
            Self::MigrationExecutor => "migration",
            Self::ResetAndSeed => "resetAndSeed",
            Self::StandaloneSeed => "standaloneSeed",
            Self::MembershipTransition => "membershipTransition",
            Self::ProjectionRebuild => "projectionRebuild",
            Self::ProjectionMaintenance => "projectionMaintenance",
            Self::AuthCatalog => "authCatalog",
            Self::AdminControl => "adminControl",
            Self::AssetCatalog => "assetCatalog",
            Self::SearchIndex => "searchIndex",
            Self::VectorIndex => "vectorIndex",
            Self::PushRegistry => "pushRegistry",
            Self::JobAndCronState => "jobAndCronState",
            Self::JournalMaintenance => "journalMaintenance",
            Self::OperationLedger => "operationLedger",
            Self::HistoryAndCheckpoint => "historyAndCheckpoint",
            Self::BranchRegistry => "branchRegistry",
            Self::StrictPromotionReexecution => "strictPromotionReexecution",
            Self::DryRun => "dryRun",
        }
    }

    pub(super) const fn choke_point(self) -> &'static str {
        match self {
            Self::OrdinaryHostPlan => {
                "LocalDatabase::execute_mutation_idempotent_guarded_with_settlement_time"
            }
            Self::OrdinaryIbexBuffered => {
                "LocalDatabase::commit_buffered_writes_idempotent_guarded"
            }
            Self::HostChildHostPlan => {
                "LocalDatabase::execute_host_mutation_guarded_with_settlement_time"
            }
            Self::HostChildIbexBuffered => "LocalDatabase::commit_buffered_host_writes_guarded",
            Self::SchemaActivation => "storage::auth_mode schema publication",
            Self::MigrationExecutor => "LocalDatabase::migrate_apply/migrate_rollback",
            Self::ResetAndSeed => "LocalDatabase::reset_and_seed",
            Self::StandaloneSeed => "LocalDatabase::ensure_versioned_seed/seed_with_authorization",
            Self::MembershipTransition => "LocalDatabase::commit_membership_plan",
            Self::ProjectionRebuild => "LocalDatabase::rebuild_projection",
            Self::ProjectionMaintenance => "storage::maintain_projections_in_tx",
            Self::AuthCatalog => "LocalDatabase::with_auth_transaction/attempt_auth_transaction",
            Self::AdminControl => "admin/local control-state transactions",
            Self::AssetCatalog => "storage asset kernel typed operations",
            Self::SearchIndex => "search::sqlite",
            Self::VectorIndex => "vector::sqlite/vector::rebuild",
            Self::PushRegistry => "push registry/queue transactions",
            Self::JobAndCronState => "jobs/cron durable state transactions",
            Self::JournalMaintenance => "LocalDatabase::prune_change_journal",
            Self::OperationLedger => "operation_ledger lifecycle transactions",
            Self::HistoryAndCheckpoint => "proof_checkpoint/history transactions",
            Self::BranchRegistry => "instance_fork/fork_promotion registry transactions",
            Self::StrictPromotionReexecution => "fork_promotion::promote_by_reexecution",
            Self::DryRun => "storage::preview/execute_and_discard",
        }
    }

    const fn declared_lane_aliases(self) -> [&'static str; 2] {
        match self {
            Self::OrdinaryHostPlan | Self::OrdinaryIbexBuffered => [
                crate::operation_ledger::ORDINARY_MUTATION_LANE_V1,
                crate::operation_ledger::DERIVED_FORK_ORDINARY_APP_ROW_JOURNAL_LANE_V1,
            ],
            Self::HostChildHostPlan | Self::HostChildIbexBuffered => [
                crate::operation_ledger::HOST_CHILD_MUTATION_LANE_V1,
                crate::operation_ledger::DERIVED_FORK_HOST_CHILD_APP_ROW_JOURNAL_LANE_V1,
            ],
            _ => [self.logical_lane(), self.logical_lane()],
        }
    }

    const fn schema_authority(self) -> bool {
        matches!(self, Self::SchemaActivation | Self::MigrationExecutor)
    }

    pub(super) const fn envelope_mapped(self) -> bool {
        matches!(
            self,
            Self::OrdinaryHostPlan
                | Self::OrdinaryIbexBuffered
                | Self::HostChildHostPlan
                | Self::HostChildIbexBuffered
        )
    }

    const fn permits_covered_app_write(self) -> bool {
        matches!(
            self,
            Self::OrdinaryHostPlan
                | Self::OrdinaryIbexBuffered
                | Self::HostChildHostPlan
                | Self::HostChildIbexBuffered
                // Planning executes the same generated DML against a
                // transaction that is structurally rolled back. It still
                // needs the registered connection/token seam to prepare the
                // write, but cannot contribute a durable uncovered row.
                | Self::DryRun
        )
    }

    /// A stable, executable explanation for every inventory row that is not
    /// itself an envelope-mapped physical application writer. Returning
    /// `None` is reserved to the four closed adapters above; tests reject any
    /// future unclassified row.
    pub(super) const fn exclusion_reason(self) -> Option<&'static str> {
        match self {
            Self::OrdinaryHostPlan
            | Self::OrdinaryIbexBuffered
            | Self::HostChildHostPlan
            | Self::HostChildIbexBuffered => None,
            Self::SchemaActivation => Some("schema-publication-has-no-ordinary-operation-envelope"),
            Self::MigrationExecutor => Some("migration-aggregate-envelope-is-not-target-coverage"),
            Self::ResetAndSeed => Some("destructive-stream-rotation-has-separate-seed-identity"),
            Self::StandaloneSeed => Some("seed-receipt-is-not-operation-envelope-v1"),
            Self::MembershipTransition => {
                Some("membership-writer-has-no-authenticated-operation-issuance")
            }
            Self::ProjectionRebuild => {
                Some("projection-rebuild-receipt-is-not-operation-envelope-v1")
            }
            Self::ProjectionMaintenance => {
                Some("derived-write-runs-inside-its-parent-writer-transaction")
            }
            Self::AuthCatalog => Some("system-catalog-only-no-application-table-dml"),
            Self::AdminControl => Some("system-control-only-no-application-table-dml"),
            Self::AssetCatalog => Some("system-catalog-only-app-references-use-parent-writer"),
            Self::SearchIndex => Some("derived-index-only-app-writes-use-parent-writer"),
            Self::VectorIndex => Some("derived-index-only-app-writes-use-parent-writer"),
            Self::PushRegistry => Some("system-custody-only-app-writes-use-parent-writer"),
            Self::JobAndCronState => {
                Some("system-scheduler-only-child-app-writes-use-host-adapter")
            }
            Self::JournalMaintenance => {
                Some("retention-only-delete-never-originates-application-dml")
            }
            Self::OperationLedger => {
                Some("envelope-metadata-writer-never-writes-application-tables")
            }
            Self::HistoryAndCheckpoint => {
                Some("evidence-copy-writer-never-originates-application-dml")
            }
            Self::BranchRegistry => Some("registry-only-branch-app-writes-use-ordinary-adapters"),
            Self::StrictPromotionReexecution => {
                Some("production-route-not-published-and-no-generated-writer-token")
            }
            Self::DryRun => Some("transaction-is-always-rolled-back"),
        }
    }

    /// App-table writers without the v1 authenticated envelope seam are not
    /// merely omitted from the manifest: once coverage is armed they cannot
    /// run. This is the executable half of the exclusion inventory.
    const fn blocked_when_coverage_armed(self) -> bool {
        matches!(
            self,
            Self::SchemaActivation
                | Self::MigrationExecutor
                | Self::ResetAndSeed
                | Self::StandaloneSeed
                | Self::MembershipTransition
                | Self::ProjectionRebuild
                | Self::StrictPromotionReexecution
        )
    }
}

pub(super) fn local_target_app_effective_uncovered_lanes_v1() -> Vec<String> {
    LocalWriterLaneV1::ALL
        .into_iter()
        .filter(|writer| writer.blocked_when_coverage_armed())
        .map(|writer| writer.logical_lane().to_owned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LocalWriterCoverageEntryV1 {
    pub lane: &'static str,
    pub choke_point: &'static str,
    pub target_supported: bool,
    pub app_effective: bool,
    pub declared_covered: bool,
    pub envelope_mapped: bool,
    /// Every row is one named physical writer family. Grouped catch-alls are
    /// forbidden because they could hide a newly app-effective adapter.
    pub physically_enumerated: bool,
    pub exclusion_reason: Option<&'static str>,
    pub write_authority_enforced: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LocalWriterCoverageInventoryV1 {
    pub schema_version: u32,
    pub target_profile: &'static str,
    pub manifest_version: Option<u64>,
    pub entries: Vec<LocalWriterCoverageEntryV1>,
    pub all_physical_writers_enumerated: bool,
    pub all_app_effective_writers_accounted: bool,
    pub all_app_effective_writers_covered: bool,
}

#[derive(Debug, Default)]
struct WriterAuthorityState {
    covered_tables: BTreeSet<String>,
    manifest: Option<OperationCoverageManifestV1>,
    active_writer: Option<LocalWriterLaneV1>,
    active_depth: usize,
    internal_schema_maintenance: bool,
    shutdown_maintenance: bool,
}

impl WriterAuthorityState {
    fn armed(&self) -> bool {
        self.manifest.is_some()
    }

    fn permits_app_write(&self) -> bool {
        !self.armed()
            || self
                .active_writer
                .is_some_and(LocalWriterLaneV1::permits_covered_app_write)
    }

    fn permits_schema_change(&self, internal_target: bool) -> bool {
        !self.armed()
            || self
                .active_writer
                .is_some_and(LocalWriterLaneV1::schema_authority)
            || (self.internal_schema_maintenance && internal_target)
    }

    fn permits_schema_catalog_write(&self) -> bool {
        !self.armed()
            || self
                .active_writer
                .is_some_and(LocalWriterLaneV1::schema_authority)
            || self.internal_schema_maintenance
    }

    fn permits_coverage_carrier_write(&self) -> bool {
        !self.armed() || self.active_writer == Some(LocalWriterLaneV1::OperationLedger)
    }

    fn permits_journal_prune(&self) -> bool {
        self.active_writer == Some(LocalWriterLaneV1::JournalMaintenance)
    }

    fn permits_maintenance_pragma(&self, pragma_name: &str, pragma_value: Option<&str>) -> bool {
        (pragma_name.eq_ignore_ascii_case("shrink_memory") && pragma_value.is_none())
            || (pragma_name.eq_ignore_ascii_case("wal_checkpoint")
                && pragma_value.is_some_and(|value| value.eq_ignore_ascii_case("FULL"))
                && self.active_writer == Some(LocalWriterLaneV1::BranchRegistry))
            || (self.shutdown_maintenance
                && ((pragma_name.eq_ignore_ascii_case("wal_checkpoint")
                    && pragma_value.is_some_and(|value| {
                        ["PASSIVE", "FULL", "RESTART", "TRUNCATE"]
                            .iter()
                            .any(|allowed| value.eq_ignore_ascii_case(allowed))
                    }))
                    || (pragma_name.eq_ignore_ascii_case("journal_mode")
                        && pragma_value.is_some_and(|value| {
                            ["DELETE", "WAL"]
                                .iter()
                                .any(|allowed| value.eq_ignore_ascii_case(allowed))
                        }))))
    }
}

#[derive(Clone, Debug, Default)]
pub(super) struct WriterAuthorityV1 {
    state: Arc<Mutex<WriterAuthorityState>>,
}

impl WriterAuthorityV1 {
    /// @ref LLP 0162#measurement-gate — dormant profile-bearing reads retain
    ///   the baseline path; SQLite authorization begins at the active cut.
    pub(super) fn install(&self, conn: &Connection) -> SnapbackResult<()> {
        // A dormant database has no coverage boundary to enforce. Installing
        // SQLite's authorizer anyway makes every ordinary statement prepare
        // enter this mutex-backed callback, which is observable read-path
        // overhead before the capability is active. Activation installs the
        // callback below; reopen reaches this branch only when the durable
        // manifest was reconstructed successfully.
        match self.state.lock() {
            Ok(state) if !state.armed() => return Ok(()),
            Ok(_) | Err(_) => {}
        }
        enable_and_verify_defensive(conn)?;
        self.install_authorizer(conn);
        Ok(())
    }

    fn install_authorizer(&self, conn: &Connection) {
        // SQLite authorization happens while a statement is prepared. A
        // statement cached while a token is live must not be reusable after
        // the token drops, so the covered writer connection has no prepared
        // statement cache. The facade's transactions also never return a raw
        // Statement, closing the non-cache escape structurally.
        conn.set_prepared_statement_cache_capacity(0);
        let state = Arc::clone(&self.state);
        conn.authorizer(Some(move |context: AuthContext<'_>| {
            authorize(&state, context)
        }));
    }

    pub(super) fn set_schema(&self, schema: &SchemaManifest) -> SnapbackResult<()> {
        let mut state = self.lock()?;
        state.covered_tables = schema
            .tables
            .iter()
            .map(|table| table.name.clone())
            .collect();
        Ok(())
    }

    pub(super) fn set_manifest(
        &self,
        manifest: Option<OperationCoverageManifestV1>,
    ) -> SnapbackResult<()> {
        let mut state = self.lock()?;
        if state.active_writer.is_some() {
            return Err(authority_invalid(
                "coverage cannot change while a generated writer token is active",
            ));
        }
        state.manifest = manifest;
        Ok(())
    }

    pub(super) fn arm_manifest(
        &self,
        conn: &Connection,
        manifest: OperationCoverageManifestV1,
    ) -> SnapbackResult<()> {
        // Defensive mode is connection-local. Establish and verify it before
        // making the manifest visible so no armed prepare can observe a
        // permissive writable-schema surface, even if activation later fails.
        enable_and_verify_defensive(conn)?;
        // Disable reuse before making the manifest visible to the authorizer;
        // an unarmed connection keeps its normal cache and pays no dormant
        // coverage cost.
        conn.set_prepared_statement_cache_capacity(0);
        let was_armed = self.lock()?.armed();
        let armed = self.set_manifest(Some(manifest));
        // The initial activation is a rare control-plane cut. Ask SQLite to
        // release unused connection memory after publishing and validating the
        // manifest. Re-arming skips the PRAGMA because the installed
        // authorizer deliberately refuses maintenance PRAGMAs; the live
        // manifest, connection-local authorizer, and issued identities remain
        // intact either way.
        //
        // @ref LLP 0162#measurement-gate — idle RSS measures the active
        //   steady connection, not one-time activation cache residency.
        let cache_release = if was_armed {
            Ok(())
        } else {
            conn.execute_batch("PRAGMA shrink_memory;")
        };
        // Install even when the state mutex is poisoned: the callback then
        // denies every prepare instead of leaving a durable active manifest
        // on a permissive connection after activation reports its error.
        self.install_authorizer(conn);
        armed?;
        cache_release?;
        release_activation_allocator_slack();
        Ok(())
    }

    pub(super) fn enter(
        &self,
        writer: LocalWriterLaneV1,
    ) -> SnapbackResult<GeneratedWriterTokenV1> {
        let mut state = self.lock()?;
        if state.armed() && writer.blocked_when_coverage_armed() {
            return Err(SnapbackError::error(
                "SNAPBACK_OPERATION_WRITER_EXCLUDED",
                "storage",
                format!(
                    "writer {} is explicitly excluded from the active coverage manifest ({})",
                    writer.choke_point(),
                    writer
                        .exclusion_reason()
                        .unwrap_or("missing-exclusion-reason")
                ),
            ));
        }
        match state.active_writer {
            None => state.active_writer = Some(writer),
            Some(active) if active == writer => {}
            Some(active) => {
                return Err(authority_invalid(format!(
                    "writer {} cannot nest inside active writer {}",
                    writer.choke_point(),
                    active.choke_point()
                )));
            }
        }
        state.active_depth = state
            .active_depth
            .checked_add(1)
            .ok_or_else(|| authority_invalid("generated writer-token nesting depth overflowed"))?;
        drop(state);
        Ok(GeneratedWriterTokenV1 {
            state: Arc::clone(&self.state),
            writer,
        })
    }

    /// Admit only in-crate, system-table DDL needed by a pay-for-play
    /// subsystem. This is intentionally distinct from a generated writer
    /// token: it cannot authorize application DML, and it cannot overlap a
    /// writer transaction.
    ///
    /// @ref LLP 0162#coverage — optional internal schema initialization does
    /// not widen the closed application-writer surface.
    pub(super) fn enter_internal_schema_maintenance(
        &self,
    ) -> SnapbackResult<InternalSchemaMaintenanceTokenV1> {
        let mut state = self.lock()?;
        if state.internal_schema_maintenance || state.active_writer.is_some() {
            return Err(authority_invalid(
                "internal schema maintenance cannot overlap another writer",
            ));
        }
        state.internal_schema_maintenance = true;
        drop(state);
        Ok(InternalSchemaMaintenanceTokenV1 {
            state: Arc::clone(&self.state),
        })
    }

    /// Admit only the LLP 0003 graceful-shutdown checkpoint pragmas. This
    /// maintenance token can never authorize application DML.
    pub(super) fn enter_shutdown_maintenance(&self) -> SnapbackResult<ShutdownMaintenanceTokenV1> {
        let mut state = self.lock()?;
        if state.shutdown_maintenance || state.active_writer.is_some() {
            return Err(authority_invalid(
                "shutdown maintenance cannot overlap another writer",
            ));
        }
        state.shutdown_maintenance = true;
        drop(state);
        Ok(ShutdownMaintenanceTokenV1 {
            state: Arc::clone(&self.state),
        })
    }

    pub(super) fn inventory(
        &self,
        database: &LocalDatabase,
    ) -> SnapbackResult<LocalWriterCoverageInventoryV1> {
        let state = self.lock()?;
        let manifest = state.manifest.as_ref();
        let has_tables = !database.schema.tables.is_empty();
        let has_membership = database
            .schema
            .tables
            .iter()
            .any(|table| table.membership.is_some());
        let has_projection = !database.projections.is_empty();
        let entries = LocalWriterLaneV1::ALL
            .into_iter()
            .map(|writer| {
                let app_effective = match writer {
                    LocalWriterLaneV1::OrdinaryHostPlan
                    | LocalWriterLaneV1::OrdinaryIbexBuffered
                    | LocalWriterLaneV1::HostChildHostPlan
                    | LocalWriterLaneV1::HostChildIbexBuffered
                    | LocalWriterLaneV1::MigrationExecutor
                    | LocalWriterLaneV1::ResetAndSeed
                    | LocalWriterLaneV1::StandaloneSeed => has_tables,
                    // Schema publication can create the first application
                    // table, so it remains app-effective even on an empty
                    // predecessor. This prevents a fresh target from being
                    // incorrectly called completely covered.
                    LocalWriterLaneV1::SchemaActivation => true,
                    LocalWriterLaneV1::MembershipTransition => has_membership,
                    LocalWriterLaneV1::ProjectionRebuild
                    | LocalWriterLaneV1::ProjectionMaintenance => has_projection,
                    // Strict promotion owns direct canonical app DML. The
                    // product route is still unpublished, but the physical
                    // implementation exists and therefore remains visible as
                    // app-effective instead of disappearing from inventory.
                    LocalWriterLaneV1::StrictPromotionReexecution => true,
                    LocalWriterLaneV1::AuthCatalog
                    | LocalWriterLaneV1::AdminControl
                    | LocalWriterLaneV1::AssetCatalog
                    | LocalWriterLaneV1::SearchIndex
                    | LocalWriterLaneV1::VectorIndex
                    | LocalWriterLaneV1::PushRegistry
                    | LocalWriterLaneV1::JobAndCronState
                    | LocalWriterLaneV1::OperationLedger
                    | LocalWriterLaneV1::HistoryAndCheckpoint
                    | LocalWriterLaneV1::JournalMaintenance
                    | LocalWriterLaneV1::BranchRegistry => false,
                    LocalWriterLaneV1::DryRun => false,
                };
                let declared_covered = manifest.is_some_and(|manifest| {
                    manifest
                        .covered_lanes
                        .iter()
                        .any(|lane| writer.declared_lane_aliases().contains(&lane.as_str()))
                        && manifest
                            .writer_choke_points
                            .iter()
                            .any(|choke| choke == writer.choke_point())
                });
                LocalWriterCoverageEntryV1 {
                    lane: writer.logical_lane(),
                    choke_point: writer.choke_point(),
                    target_supported: true,
                    app_effective,
                    declared_covered,
                    envelope_mapped: writer.envelope_mapped(),
                    physically_enumerated: true,
                    exclusion_reason: writer.exclusion_reason(),
                    write_authority_enforced: state.armed(),
                }
            })
            .collect::<Vec<_>>();
        let all_physical_writers_enumerated = entries.len() == LocalWriterLaneV1::ALL.len()
            && entries.iter().all(|entry| entry.physically_enumerated)
            && entries
                .iter()
                .all(|entry| entry.envelope_mapped != entry.exclusion_reason.is_some());
        let all_app_effective_writers_accounted = entries
            .iter()
            .filter(|entry| entry.app_effective)
            .all(|entry| entry.envelope_mapped || entry.exclusion_reason.is_some());
        let all_app_effective_writers_covered = entries
            .iter()
            .filter(|entry| entry.app_effective)
            .all(|entry| {
                entry.declared_covered && entry.envelope_mapped && entry.physically_enumerated
            });
        Ok(LocalWriterCoverageInventoryV1 {
            schema_version: 1,
            target_profile: LOCAL_TARGET_PROFILE_V1,
            manifest_version: manifest.map(|manifest| manifest.manifest_version),
            entries,
            all_physical_writers_enumerated,
            all_app_effective_writers_accounted,
            all_app_effective_writers_covered,
        })
    }

    fn lock(&self) -> SnapbackResult<MutexGuard<'_, WriterAuthorityState>> {
        self.state
            .lock()
            .map_err(|_| authority_invalid("generated writer authority state is poisoned"))
    }
}

/// Return allocator pages made unused by the one-time activation work.
///
/// SQLite's `shrink_memory` releases its caches, but Darwin's allocator may
/// otherwise retain the newly-free pages in process RSS. Coverage activation
/// is a rare control-plane cut, so paying pressure-relief latency here keeps
/// that transient setup memory out of the active steady state without changing
/// the live manifest, issued identities, connection, or authorizer. Other
/// platforms retain their allocator's normal policy.
///
/// @ref LLP 0162#measurement-gate — active-covered idle RSS includes live
///   authority state, not allocator slack left by activation setup.
#[cfg(target_os = "macos")]
fn release_activation_allocator_slack() {
    unsafe extern "C" {
        fn malloc_zone_pressure_relief(
            zone: *mut libc::malloc_zone_t,
            goal: libc::size_t,
        ) -> libc::size_t;
    }

    // SAFETY: This is macOS's process-wide, thread-safe allocator pressure
    // advisory. A null zone requests all zones and a zero goal requests the
    // allocator's maximal best effort; only unused allocator pages may be
    // unmapped, so live Rust and SQLite allocations remain valid.
    unsafe {
        let _ = malloc_zone_pressure_relief(std::ptr::null_mut(), 0);
    }
}

#[cfg(not(target_os = "macos"))]
fn release_activation_allocator_slack() {}

/// Possession is the authority. Its fields and constructor are private to this
/// module, and dropping the final nested token revokes authority before the
/// caller can prepare another statement.
pub(super) struct GeneratedWriterTokenV1 {
    state: Arc<Mutex<WriterAuthorityState>>,
    writer: LocalWriterLaneV1,
}

pub(super) struct InternalSchemaMaintenanceTokenV1 {
    state: Arc<Mutex<WriterAuthorityState>>,
}

pub(super) struct ShutdownMaintenanceTokenV1 {
    state: Arc<Mutex<WriterAuthorityState>>,
}

impl Drop for InternalSchemaMaintenanceTokenV1 {
    fn drop(&mut self) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        debug_assert!(state.internal_schema_maintenance);
        state.internal_schema_maintenance = false;
    }
}

impl Drop for ShutdownMaintenanceTokenV1 {
    fn drop(&mut self) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        debug_assert!(state.shutdown_maintenance);
        state.shutdown_maintenance = false;
    }
}

impl Drop for GeneratedWriterTokenV1 {
    fn drop(&mut self) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        debug_assert_eq!(state.active_writer, Some(self.writer));
        state.active_depth = state.active_depth.saturating_sub(1);
        if state.active_depth == 0 {
            state.active_writer = None;
        }
    }
}

fn authorize(state: &Arc<Mutex<WriterAuthorityState>>, context: AuthContext<'_>) -> Authorization {
    let Ok(state) = state.lock() else {
        return Authorization::Deny;
    };
    let protected = |table: &str| state.covered_tables.contains(table);
    let integrity_table = |table: &str| {
        table.eq_ignore_ascii_case("_snapback_changes")
            || table.eq_ignore_ascii_case("_snapback_version")
    };
    let coverage_carrier = |table: &str| {
        table.eq_ignore_ascii_case("_snapback_operation_coverage_v1")
            || table.eq_ignore_ascii_case("_snapback_operation_coverage_continuity_v1")
    };
    let system_table = |table: &str| {
        table.starts_with("_snapback_")
            || table.starts_with("_auth_")
            || table.eq_ignore_ascii_case("sqlite_sequence")
    };
    let schema_alias = |table: &str| {
        [
            "sqlite_schema",
            "sqlite_master",
            "sqlite_temp_schema",
            "sqlite_temp_master",
        ]
        .iter()
        .any(|alias| table.eq_ignore_ascii_case(alias))
    };
    let internal_schema_target = internal_schema_maintenance_target(&context.action);
    match context.action {
        AuthAction::Insert { table_name }
        | AuthAction::Delete { table_name }
        | AuthAction::Update { table_name, .. }
            if protected(table_name) =>
        {
            // Trigger/view-mediated application writes are not represented by
            // the generated writer's ChangedRow set. Refuse them even inside
            // a token until a future generated trigger adapter journals their
            // exact effects.
            if !state.armed() || (context.accessor.is_none() && state.permits_app_write()) {
                Authorization::Allow
            } else {
                Authorization::Deny
            }
        }
        AuthAction::Insert { table_name }
        | AuthAction::Delete { table_name }
        | AuthAction::Update { table_name, .. }
            if coverage_carrier(table_name) =>
        {
            if context.accessor.is_none() && state.permits_coverage_carrier_write() {
                Authorization::Allow
            } else {
                Authorization::Deny
            }
        }
        AuthAction::Insert { table_name }
        | AuthAction::Delete { table_name }
        | AuthAction::Update { table_name, .. }
            if schema_alias(table_name) =>
        {
            if context.accessor.is_none() && state.permits_schema_catalog_write() {
                Authorization::Allow
            } else {
                Authorization::Deny
            }
        }
        AuthAction::Delete { table_name }
            if table_name.eq_ignore_ascii_case("_snapback_changes") =>
        {
            if context.accessor.is_none()
                && (state.permits_app_write() || state.permits_journal_prune())
            {
                Authorization::Allow
            } else {
                Authorization::Deny
            }
        }
        AuthAction::Insert { table_name }
        | AuthAction::Delete { table_name }
        | AuthAction::Update { table_name, .. }
            if integrity_table(table_name) =>
        {
            if context.accessor.is_none() && state.permits_app_write() {
                Authorization::Allow
            } else {
                Authorization::Deny
            }
        }
        AuthAction::Insert { table_name }
        | AuthAction::Delete { table_name }
        | AuthAction::Update { table_name, .. } => {
            if !state.armed() || (context.accessor.is_none() && system_table(table_name)) {
                Authorization::Allow
            } else {
                Authorization::Deny
            }
        }
        AuthAction::CreateIndex { .. }
        | AuthAction::CreateTable { .. }
        | AuthAction::CreateTrigger { .. }
        | AuthAction::CreateView { .. }
        | AuthAction::DropIndex { .. }
        | AuthAction::DropTable { .. }
        | AuthAction::DropTrigger { .. }
        | AuthAction::DropView { .. }
        | AuthAction::AlterTable { .. } => {
            if state.permits_schema_change(internal_schema_target) {
                Authorization::Allow
            } else {
                Authorization::Deny
            }
        }
        AuthAction::CreateTempIndex { .. }
        | AuthAction::CreateTempTable { .. }
        | AuthAction::CreateTempTrigger { .. }
        | AuthAction::CreateTempView { .. }
        | AuthAction::DropTempIndex { .. }
        | AuthAction::DropTempTable { .. }
        | AuthAction::DropTempTrigger { .. }
        | AuthAction::DropTempView { .. }
        | AuthAction::CreateVtable { .. }
        | AuthAction::DropVtable { .. }
        | AuthAction::Reindex { .. }
        | AuthAction::Analyze { .. }
        | AuthAction::Attach { .. }
        | AuthAction::Detach { .. }
        | AuthAction::Unknown { .. } => Authorization::Deny,
        AuthAction::Pragma {
            pragma_name,
            pragma_value,
        } => {
            let argument_read_only = [
                "foreign_key_list",
                "index_info",
                "index_list",
                "index_xinfo",
                "table_info",
                "table_xinfo",
            ]
            .iter()
            .any(|allowed| pragma_name.eq_ignore_ascii_case(allowed));
            let scalar_read_only = pragma_value.is_none()
                && [
                    "application_id",
                    "collation_list",
                    "compile_options",
                    "data_version",
                    "database_list",
                    "foreign_keys",
                    "freelist_count",
                    "journal_mode",
                    "page_count",
                    "page_size",
                    "query_only",
                    "schema_version",
                    "table_list",
                    "user_version",
                ]
                .iter()
                .any(|allowed| pragma_name.eq_ignore_ascii_case(allowed));
            let read_only = argument_read_only || scalar_read_only;
            if state.permits_maintenance_pragma(pragma_name, pragma_value)
                || (!pragma_name.eq_ignore_ascii_case("writable_schema") && read_only)
            {
                Authorization::Allow
            } else {
                Authorization::Deny
            }
        }
        AuthAction::Read { .. }
        | AuthAction::Select
        | AuthAction::Function { .. }
        | AuthAction::Transaction { .. }
        | AuthAction::Savepoint { .. }
        | AuthAction::Recursive => Authorization::Allow,
        _ => Authorization::Deny,
    }
}

fn enable_and_verify_defensive(conn: &Connection) -> SnapbackResult<()> {
    let enabled = conn.set_db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)?;
    if !enabled || !conn.db_config(DbConfig::SQLITE_DBCONFIG_DEFENSIVE)? {
        return Err(authority_invalid(
            "SQLite defensive mode did not remain enabled on an armed writable connection",
        ));
    }
    Ok(())
}

fn internal_schema_maintenance_target(action: &AuthAction<'_>) -> bool {
    let owned = |name: &str| name.starts_with("_snapback_");
    match action {
        AuthAction::CreateTable { table_name } => owned(table_name),
        AuthAction::CreateIndex {
            index_name,
            table_name,
        } => {
            owned(table_name) && (owned(index_name) || index_name.starts_with("sqlite_autoindex_"))
        }
        AuthAction::AlterTable { table_name, .. } => owned(table_name),
        _ => false,
    }
}

fn authority_invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_OPERATION_WRITE_AUTHORITY_INVALID",
        "storage",
        message,
    )
}
