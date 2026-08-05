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
    OperationLedger,
    HistoryAndCheckpoint,
    BranchRegistry,
    StrictPromotionReexecution,
    DryRun,
}

impl LocalWriterLaneV1 {
    pub(super) const ALL: [Self; 23] = [
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
            Self::AssetCatalog => "LocalDatabase::asset_transaction",
            Self::SearchIndex => "search::sqlite",
            Self::VectorIndex => "vector::sqlite/vector::rebuild",
            Self::PushRegistry => "push registry/queue transactions",
            Self::JobAndCronState => "jobs/cron durable state transactions",
            Self::OperationLedger => "operation_ledger lifecycle transactions",
            Self::HistoryAndCheckpoint => "proof_checkpoint/history transactions",
            Self::BranchRegistry => "instance_fork/fork_promotion registry transactions",
            Self::StrictPromotionReexecution => "fork_promotion::promote_by_reexecution",
            Self::DryRun => "storage::preview/execute_and_discard",
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
}

impl WriterAuthorityState {
    fn armed(&self) -> bool {
        self.manifest.is_some()
    }

    fn permits_app_write(&self) -> bool {
        !self.armed() || self.active_writer.is_some()
    }

    fn permits_schema_change(&self) -> bool {
        !self.armed()
            || self
                .active_writer
                .is_some_and(LocalWriterLaneV1::schema_authority)
    }
}

#[derive(Clone, Debug, Default)]
pub(super) struct WriterAuthorityV1 {
    state: Arc<Mutex<WriterAuthorityState>>,
}

impl WriterAuthorityV1 {
    /// @ref LLP 0162#measurement-gate — dormant profile-bearing reads retain
    ///   the baseline path; SQLite authorization begins at the active cut.
    pub(super) fn install(&self, conn: &Connection) {
        // A dormant database has no coverage boundary to enforce. Installing
        // SQLite's authorizer anyway makes every ordinary statement prepare
        // enter this mutex-backed callback, which is observable read-path
        // overhead before the capability is active. Activation installs the
        // callback below; reopen reaches this branch only when the durable
        // manifest was reconstructed successfully.
        match self.state.lock() {
            Ok(state) if !state.armed() => return,
            Ok(_) | Err(_) => {}
        }
        self.install_authorizer(conn);
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
        // Disable reuse before making the manifest visible to the authorizer;
        // an unarmed connection keeps its normal cache and pays no dormant
        // coverage cost.
        conn.set_prepared_statement_cache_capacity(0);
        let armed = self.set_manifest(Some(manifest));
        // Activation is a rare control-plane cut. Ask SQLite to release unused
        // connection memory after publishing and validating the manifest. This
        // is the shared product seam used by both local publication and the
        // evidence fixture; the live manifest, connection-local authorizer,
        // and issued identities remain intact.
        //
        // @ref LLP 0162#measurement-gate — idle RSS measures the active
        //   steady connection, not one-time activation cache residency.
        let cache_release = conn.execute_batch("PRAGMA shrink_memory;");
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
                    | LocalWriterLaneV1::BranchRegistry => false,
                    LocalWriterLaneV1::DryRun => false,
                };
                let declared_covered = manifest.is_some_and(|manifest| {
                    manifest
                        .covered_lanes
                        .iter()
                        .any(|lane| lane == writer.logical_lane())
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
        AuthAction::CreateIndex { .. }
        | AuthAction::CreateTable { .. }
        | AuthAction::CreateTrigger { .. }
        | AuthAction::CreateView { .. }
        | AuthAction::DropIndex { .. }
        | AuthAction::DropTable { .. }
        | AuthAction::DropTrigger { .. }
        | AuthAction::DropView { .. }
        | AuthAction::AlterTable { .. } => {
            if state.permits_schema_change() {
                Authorization::Allow
            } else {
                Authorization::Deny
            }
        }
        _ => Authorization::Allow,
    }
}

fn authority_invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_OPERATION_WRITE_AUTHORITY_INVALID",
        "storage",
        message,
    )
}
