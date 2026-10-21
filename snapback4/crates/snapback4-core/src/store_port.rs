//! Server store handles. The device continues to use the concrete SQLite API.
// @ref LLP 3000.009.001.000#3.4 — one concrete engine, enum dispatch; SQLite-only S10a.
use crate::store as sqlite;

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

#[path = "store/port/bridges.rs"]
mod bridges;
#[path = "store/port/families.rs"]
mod families;
pub mod report;
pub(crate) use bridges::WriteStore;

// Temporary record/helper bridges; S10b completes semantic extraction.
pub use sqlite::{adoption_estimate, timeline_launch, Sizes, LogEvent};
pub use crate::release_history::DormantItem;
pub use crate::inspection::InspectionRows;
pub use sqlite::{id_reused, payload_digest, canonical_payload};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TimeOpening {
    pub at: i64,
    pub table: String,
    pub id: String,
}


pub(crate) struct ActionStepTransaction<'tx, 'store> { pub(crate) tx: &'tx AnyTx<'store> }
pub(crate) struct EffectStepTransaction<'tx, 'store> { pub(crate) tx: &'tx AnyTx<'store> }
#[path = "store/port/steps.rs"]
mod steps;
