//! Server store handles. The device continues to use the concrete SQLite API.
// @ref LLP 3000.009.001.000#3.4 — one concrete engine, explicit enum dispatch; Postgres admitted profile in S10c.
use crate::Value;

#[path = "store/port/handles.rs"]
mod handles;
pub use handles::{AnyStore, AnyTx, AnyInspection, ReadSnapshot};
pub(crate) use handles::AnyPreparation;

/// A local byte location, available only after the store admits asset storage.
/// A store without blob storage must return `StoreUnsupported { family: "assets" }`
/// from `asset_location`, before callers stage bytes or prepare file cleanup.
// @ref LLP 3000.009.001.000#3.4 — asset bytes wait for P1b; no dummy filesystem paths.
#[derive(Clone, Copy, Debug)]
pub struct AssetLocation<'store> {
    directory: &'store std::path::Path,
    ephemeral: bool,
}

impl<'store> AssetLocation<'store> {
    pub fn directory(&self) -> &'store std::path::Path { self.directory }
    pub fn path(&self, id: &str) -> std::path::PathBuf { self.directory.join(id) }
    pub fn ephemeral(&self) -> bool { self.ephemeral }
}

pub(crate) struct OpeningMetadata {
    pub store_id: String,
    pub dev_effects: bool,
}

#[path = "store/port/lifecycle.rs"]
mod lifecycle;
pub(crate) use lifecycle::IdentitySource;
#[path = "store/port/identity_members.rs"]
mod identity_members;
pub(crate) use identity_members::SessionEdit;
#[path = "store/port/worker_ledger.rs"]
mod worker_ledger;
#[cfg(feature = "postgres")]
#[path = "store/port/ownership.rs"]
mod ownership;
#[cfg(feature = "postgres")]
pub use ownership::{StoreLease, LeasePolicy, LeaseAcquisition, LeaseDeadline};

/// Read-only deployment facts; no connection or secret leaves an adapter.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DeploymentState {
    pub store_id: String,
    pub release: Option<u64>,
    pub revision: u64,
    pub generation: u64,
    pub holder: String,
    pub token: i64,
    pub lease_until: String,
    pub expired: bool,
}
#[path = "store/port/operations.rs"]
mod operations;
pub(crate) use operations::FollowingHistoryReader;
#[path = "store/port/tooling.rs"]
mod tooling;
#[path = "store/port/families.rs"]
mod families;
pub mod report;

// Owned records and presentation policy have neutral homes.
pub mod adoption_estimate;
pub mod timeline_launch;
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct Sizes {
    pub rows: u64,
    pub row_count: u64,
    pub indexes: u64,
    pub log: u64,
    pub log_events: u64,
    pub ops: u64,
    pub file: u64,
}

impl Sizes {
    /// The log's bytes per byte of rows.
    pub fn amplification(&self) -> f64 {
        if self.rows == 0 { 0.0 } else { self.log as f64 / self.rows as f64 }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct LogEvent {
    pub seq: u64,
    pub ord: u32,
    pub table: String,
    /// `put` (a row image), `del` (a row id), or `scope` (a group the
    /// recipient left: `data` carries the group prefix values).
    pub kind: String,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}


pub use crate::release_history::DormantItem;
pub use crate::inspection::InspectionRows;
pub use crate::receipts::{id_reused, payload_digest, canonical_payload};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TimeOpening {
    pub at: i64,
    pub table: String,
    pub id: String,
}


pub(crate) struct ActionStepTransaction<'tx, 'store> { tx: &'tx AnyTx<'store> }
pub(crate) struct EffectStepTransaction<'tx, 'store> { tx: &'tx AnyTx<'store> }
#[path = "store/port/steps.rs"]
mod steps;

impl<'store> AnyTx<'store> {
    pub(crate) fn action_steps(&self) -> ActionStepTransaction<'_, 'store> { ActionStepTransaction { tx: self } }
    pub(crate) fn effect_steps(&self) -> EffectStepTransaction<'_, 'store> { EffectStepTransaction { tx: self } }
}

#[cfg(feature = "test-support")]
#[path = "store/port/fixtures.rs"]
mod fixtures;

#[cfg(test)]
mod tests;
