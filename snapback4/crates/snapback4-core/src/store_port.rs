//! Server store handles. The device continues to use the concrete SQLite API.
// @ref LLP 3000.009.001.000#3.4 — one concrete engine, explicit enum dispatch; Postgres admitted profile in S10c.
use crate::{Value, store as sqlite};

pub enum AnyStore {
    Sqlite(sqlite::Store),
    #[cfg(feature = "postgres")]
    Postgres(crate::engine::postgres::Handle),
}

pub enum AnyTx<'store> {
    Sqlite(sqlite::Tx<'store>),
    #[cfg(feature = "postgres")]
    Postgres(crate::engine::postgres::store::Tx<'store>),
}

/// A read snapshot retains its physical transaction until closed: SQLite
/// DEFERRED or Postgres REPEATABLE READ, pinning head and generation together.
pub struct ReadSnapshot<'store> {
    tx: AnyTx<'store>,
}

pub(crate) enum AnyPreparation<'tx, 'store> {
    Sqlite(sqlite::release::ReleaseCheck<'tx>),
    #[cfg(feature = "postgres")]
    Postgres(crate::engine::postgres::activation::Preparation<'tx, 'store>),
    #[cfg(not(feature = "postgres"))]
    Lifetime(std::convert::Infallible, std::marker::PhantomData<&'store ()>),
}

pub enum AnyInspection {
    Sqlite(sqlite::inspect::Inspection),
    #[cfg(feature = "postgres")]
    Postgres,
}

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

#[cfg(test)]
mod tests;
