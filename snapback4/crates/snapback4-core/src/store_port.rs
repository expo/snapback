//! Server store handles. The device continues to use the concrete SQLite API.
// @ref LLP 3000.009.001.000#3.4 — one concrete engine, explicit enum dispatch; SQLite-only S10b.
use crate::{Value, store as sqlite};

pub enum AnyStore {
    Sqlite(sqlite::Store),
}

pub enum AnyTx<'store> {
    Sqlite(sqlite::Tx<'store>),
}

/// A deferred read snapshot retains its physical transaction until closed.
pub struct ReadSnapshot<'store> {
    tx: AnyTx<'store>,
}

pub(crate) enum AnyPreparation<'store> {
    Sqlite(sqlite::release::ReleaseCheck<'store>),
}

pub enum AnyInspection {
    Sqlite(sqlite::inspect::Inspection),
}

pub(crate) struct OpeningMetadata {
    pub store_id: String,
    pub dev_effects: bool,
}

#[path = "store/port/lifecycle.rs"]
mod lifecycle;
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

impl AnyTx<'_> {
    pub(crate) fn action_steps(&self) -> ActionStepTransaction<'_, '_> { ActionStepTransaction { tx: self } }
    pub(crate) fn effect_steps(&self) -> EffectStepTransaction<'_, '_> { EffectStepTransaction { tx: self } }
}

#[cfg(test)]
mod tests;
