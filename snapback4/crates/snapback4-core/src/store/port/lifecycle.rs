//! Owning server handle operations; each operation dispatches inside the port.
// @ref LLP 3000.009.001.000#3.4 — explicit semantic dispatch, no backend dereference.
use crate::{RuntimeError, Schema, Program, store as sqlite};
use crate::store_port::{AnyStore, AnyTx, ReadSnapshot, AnyPreparation, AnyInspection, OpeningMetadata};
use std::collections::BTreeMap;
use crate::engine::committer::Committed;
use crate::store_port::report::AdoptionReport;
use std::{path::Path, time::Duration};

impl From<sqlite::Store> for AnyStore {
    fn from(store: sqlite::Store) -> Self { Self::Sqlite(store) }
}




impl AnyStore {
    pub fn memory() -> Result<Self, RuntimeError> { sqlite::Store::memory().map(Self::Sqlite) }
    pub fn open(path: &Path) -> Result<Self, RuntimeError> { sqlite::Store::open(path).map(Self::Sqlite) }
    pub fn open_read_only(path: &Path) -> Result<Self, RuntimeError> { sqlite::Store::open_read_only(path).map(Self::Sqlite) }
    pub fn open_with_busy_timeout(path: &Path, timeout: Duration) -> Result<Self, RuntimeError> {
        sqlite::Store::open_with_busy_timeout(path, timeout).map(Self::Sqlite)
    }
    pub fn transaction(&mut self) -> Result<AnyTx<'_>, RuntimeError> {
        match self { Self::Sqlite(store) => store.transaction().map(AnyTx::Sqlite) }
    }
    pub fn read_transaction(&mut self) -> Result<ReadSnapshot<'_>, RuntimeError> {
        match self { Self::Sqlite(store) => store.read_transaction().map(|tx| ReadSnapshot { tx: AnyTx::Sqlite(tx) }) }
    }
    pub(crate) fn opening_transaction(&mut self) -> Result<AnyTx<'_>, RuntimeError> {
        match self { Self::Sqlite(store) => store.opening_transaction().map(AnyTx::Sqlite) }
    }
    pub(crate) fn finish_open(tx: AnyTx<'_>) -> Result<OpeningMetadata, RuntimeError> {
        match tx { AnyTx::Sqlite(tx) => sqlite::Store::finish_open(tx) }
    }
    pub(crate) fn with_authority_snapshot<T>(&self, run: impl FnOnce(&AnyTx<'_>) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        match self { Self::Sqlite(store) => {
            let tx = AnyTx::Sqlite(store.authority_transaction()?);
            let result = run(&tx)?;
            tx.rollback()?;
            Ok(result)
        } }
    }
    pub fn reader(&self) -> Result<Self, RuntimeError> {
        match self { Self::Sqlite(store) => store.reader().map(Self::Sqlite) }
    }
    pub fn fork_memory(&self) -> Result<Self, RuntimeError> {
        match self { Self::Sqlite(store) => store.fork_memory().map(Self::Sqlite) }
    }
}
impl AnyTx<'_> {
    pub fn commit(self) -> Result<(), RuntimeError> { match self { Self::Sqlite(tx) => tx.commit() } }
    pub fn rollback(self) -> Result<(), RuntimeError> { match self { Self::Sqlite(tx) => tx.rollback() } }
    pub(crate) fn begin_member_evidence(&self) { match self { Self::Sqlite(tx) => tx.begin_member_evidence() } }
}
impl ReadSnapshot<'_> {
    pub fn commit(self) -> Result<(), RuntimeError> { self.tx.commit() }
    pub fn rollback(self) -> Result<(), RuntimeError> { self.tx.rollback() }
}

impl crate::engine::committer::CommitTransaction for AnyTx<'_> {
    fn commit_transaction(self) -> Result<(), RuntimeError> { self.commit() }
}

impl AnyInspection {
    pub fn open(path: &Path) -> crate::inspection::InspectionResult<Self> { sqlite::inspect::Inspection::open(path).map(Self::Sqlite) }
    pub fn open_uri(uri: &str) -> crate::inspection::InspectionResult<Self> { sqlite::inspect::Inspection::open_uri(uri).map(Self::Sqlite) }
}


impl AnyStore {
    pub(crate) fn activate_at_with_launch<R>(
        &mut self, schema: &Schema, programs: Option<&BTreeMap<String, Program>>,
        reset: bool, now: i64, allow_launch: bool,
        check: impl Fn(&AnyPreparation<'_>) -> Result<(), RuntimeError>,
        build: impl FnMut(&AnyTx<'_>, bool, &mut AdoptionReport) -> Result<(), RuntimeError>,
        finish: impl Fn(&AnyTx<'_>) -> Result<R, RuntimeError>,
    ) -> Result<Committed<(u64, R)>, RuntimeError> {
        match self { Self::Sqlite(store) => store.activate_at_with_launch(
            schema, programs, reset, now, allow_launch,
            |preparation| check(&AnyPreparation::from(preparation)),
            build, finish,
        ) }
    }
}



impl AnyStore {
    // Scoped reads preserve the shared receiver and original SQLite snapshot boundaries.
    pub fn job(&self, id: &str) -> Result<Option<crate::engine::job::JobRun>, RuntimeError> { match self { Self::Sqlite(store) => store.job(id) } }
    pub fn jobs(&self, limit: usize) -> Result<Vec<crate::engine::job::JobRun>, RuntimeError> { match self { Self::Sqlite(store) => store.jobs(limit) } }
}
impl AnyStore {
    pub fn request_counts(&self) -> Result<BTreeMap<String, u64>, RuntimeError> {
        match self { Self::Sqlite(store) => crate::engine::actions::requests::RequestsStore::request_counts(&mut &*store) }
    }
}

impl AnyTx<'_> {
    pub(crate) fn prepare_seed_inputs(&self, schema: &Schema) -> Result<(), RuntimeError> {
        match self { Self::Sqlite(tx) => {
            if sqlite::backfills::has_evidence(tx)? { sqlite::backfills::prepare_inputs(tx, schema, None)?; }
            Ok(())
        } }
    }
    pub(crate) fn rewrite_legacy_maintained_references(&self, ids: &BTreeMap<String, BTreeMap<String, String>>) -> Result<u64, RuntimeError> {
        match self { Self::Sqlite(tx) => sqlite::dormant::rewrite_legacy_maintained_references(tx, ids) }
    }
}
