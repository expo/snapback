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
    Migration,
    SeedAndReset,
    MembershipAdmin,
    ProjectionRebuild,
    SpecializedSystem,
    DryRun,
}

impl LocalWriterLaneV1 {
    pub(super) const ALL: [Self; 10] = [
        Self::OrdinaryHostPlan,
        Self::OrdinaryIbexBuffered,
        Self::HostChildHostPlan,
        Self::HostChildIbexBuffered,
        Self::Migration,
        Self::SeedAndReset,
        Self::MembershipAdmin,
        Self::ProjectionRebuild,
        Self::SpecializedSystem,
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
            Self::Migration => "migration",
            Self::SeedAndReset => "seedAndReset",
            Self::MembershipAdmin => "membershipAdmin",
            Self::ProjectionRebuild => "projectionRebuild",
            Self::SpecializedSystem => "specializedSystem",
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
            Self::Migration => "storage::migration_executor",
            Self::SeedAndReset => "storage::seed_and_reset",
            Self::MembershipAdmin => "storage::commit_membership_plan",
            Self::ProjectionRebuild => "storage::rebuild_projection",
            Self::SpecializedSystem => "storage::specialized_system_writers",
            Self::DryRun => "storage::execute_and_discard",
        }
    }

    const fn schema_authority(self) -> bool {
        matches!(self, Self::Migration)
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
    /// False for a deliberately grouped inventory row. A grouped family is a
    /// useful Missing marker, never evidence of physical-writer completeness.
    pub physically_enumerated: bool,
    pub write_authority_enforced: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LocalWriterCoverageInventoryV1 {
    pub schema_version: u32,
    pub target_profile: &'static str,
    pub manifest_version: Option<u64>,
    pub entries: Vec<LocalWriterCoverageEntryV1>,
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
    pub(super) fn install(&self, conn: &Connection) {
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

    pub(super) fn enter(
        &self,
        writer: LocalWriterLaneV1,
    ) -> SnapbackResult<GeneratedWriterTokenV1> {
        let mut state = self.lock()?;
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
        let has_specialized =
            database.schema.assets.is_some()
                || database.schema.push_seam.is_some()
                || database.schema.tables.iter().any(|table| {
                    !table.search_indexes.is_empty() || !table.vector_indexes.is_empty()
                });
        let entries = LocalWriterLaneV1::ALL
            .into_iter()
            .map(|writer| {
                let app_effective = match writer {
                    LocalWriterLaneV1::OrdinaryHostPlan
                    | LocalWriterLaneV1::OrdinaryIbexBuffered
                    | LocalWriterLaneV1::HostChildHostPlan
                    | LocalWriterLaneV1::HostChildIbexBuffered
                    | LocalWriterLaneV1::Migration
                    | LocalWriterLaneV1::SeedAndReset => has_tables,
                    LocalWriterLaneV1::MembershipAdmin => has_membership,
                    LocalWriterLaneV1::ProjectionRebuild => has_projection,
                    LocalWriterLaneV1::SpecializedSystem => has_specialized,
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
                    physically_enumerated: writer != LocalWriterLaneV1::SpecializedSystem,
                    write_authority_enforced: state.armed(),
                }
            })
            .collect::<Vec<_>>();
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
            all_app_effective_writers_covered,
        })
    }

    fn lock(&self) -> SnapbackResult<MutexGuard<'_, WriterAuthorityState>> {
        self.state
            .lock()
            .map_err(|_| authority_invalid("generated writer authority state is poisoned"))
    }
}

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
