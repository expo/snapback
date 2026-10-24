//! Owning server handle operations; each operation dispatches inside the port.
// @ref LLP 3000.009.001.000#3.4 — explicit semantic dispatch, no backend dereference.
use super::handles::{SqliteStore, SqliteTx};
#[cfg(feature = "postgres")]
use super::handles::{PostgresStore, PostgresTx};
use crate::{RuntimeError, Schema, Program, store as sqlite};
use crate::store_port::{AnyStore, AnyTx, ReadSnapshot, AnyPreparation, AnyInspection, OpeningMetadata};
use std::collections::BTreeMap;
use crate::engine::committer::Committed;
use crate::store_port::report::AdoptionReport;
use std::{path::Path, time::Duration};

impl From<sqlite::Store> for AnyStore {
    fn from(store: sqlite::Store) -> Self { Self::Sqlite(SqliteStore(store)) }
}




impl AnyStore {
    #[cfg(feature="postgres")]
    pub(crate) fn result_validation_snapshot(&mut self,digest:&str)->Result<Option<ReadSnapshot<'_>>,RuntimeError> {
        if digest.contains('\0') { return Ok(None); }
        if let Self::Postgres(PostgresStore(handle))=self {
            let (tx,facts)=handle.store.get_mut().planned_authority_transaction(digest,Some(crate::engine::postgres::read_plan::Plan::Validation))?;
            return Ok(Some(ReadSnapshot {tx:AnyTx::Postgres(PostgresTx(tx)),authority:Some((digest.into(),facts))}));
        }
        Ok(None)
    }
    pub fn memory() -> Result<Self, RuntimeError> { sqlite::Store::memory().map(|inner| Self::Sqlite(SqliteStore(inner))) }
    pub fn open(path: &Path) -> Result<Self, RuntimeError> { sqlite::Store::open(path).map(|inner| Self::Sqlite(SqliteStore(inner))) }
    pub fn open_read_only(path: &Path) -> Result<Self, RuntimeError> { sqlite::Store::open_read_only(path).map(|inner| Self::Sqlite(SqliteStore(inner))) }
    pub fn open_with_busy_timeout(path: &Path, timeout: Duration) -> Result<Self, RuntimeError> {
        sqlite::Store::open_with_busy_timeout(path, timeout).map(|inner| Self::Sqlite(SqliteStore(inner)))
    }
    pub(crate) fn program_transaction_until(&mut self, digest: Option<&str>, principal: &str, id: Option<&str>, deadline: std::time::Instant) -> Result<AnyTx<'_>, RuntimeError> {
        #[cfg(not(feature="postgres"))]
        let _=(digest,principal,id);
        match self {
            Self::Sqlite(SqliteStore(store)) => store.program_transaction_until(deadline).map(|tx|AnyTx::Sqlite(SqliteTx(tx))),
            #[cfg(feature="postgres")]
            Self::Postgres(PostgresStore(handle)) => {
                let store=handle.store.get_mut(); store.next_program_deadline=Some(deadline);
                match digest { Some(digest)=>store.request_transaction(digest,principal,id), None=>store.transaction(Some(crate::engine::postgres::WriteMode::Serialized)) }.map(|tx|AnyTx::Postgres(PostgresTx(tx)))
            }
        }
    }
    pub fn transaction(&mut self) -> Result<AnyTx<'_>, RuntimeError> {
        match self { Self::Sqlite(SqliteStore(store)) => store.transaction().map(|inner| AnyTx::Sqlite(SqliteTx(inner))), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(handle)) => handle.store.get_mut().transaction(Some(crate::engine::postgres::WriteMode::Serialized)).map(|inner| AnyTx::Postgres(PostgresTx(inner))) }
    }
    pub(crate) fn request_write_transaction(&mut self, digest: &str, principal: &str, id: Option<&str>) -> Result<AnyTx<'_>,RuntimeError> {
        #[cfg(feature="postgres")]
        if let Self::Postgres(PostgresStore(handle)) = self {
            return handle.store.get_mut().request_transaction(digest,principal,id).map(|tx|AnyTx::Postgres(PostgresTx(tx)));
        }
        let _ = (digest,principal,id);
        self.transaction()
    }
    pub fn read_transaction(&mut self) -> Result<ReadSnapshot<'_>, RuntimeError> {
        match self { Self::Sqlite(SqliteStore(store)) => store.read_transaction().map(|tx| ReadSnapshot { tx: AnyTx::Sqlite(SqliteTx(tx)), authority: None }), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(handle)) => handle.store.get_mut().transaction(None).map(|tx| ReadSnapshot { tx: AnyTx::Postgres(PostgresTx(tx)), authority: None }) }
    }
    pub(crate) fn planned_request_read_transaction(&mut self, digest: &str, schema: &Schema, program: Option<&Program>, context: &crate::engine::Context) -> Result<Option<ReadSnapshot<'_>>, RuntimeError> {
        #[cfg(feature = "postgres")]
        if let Self::Postgres(PostgresStore(handle)) = self {
            if digest.contains('\0') { return Ok(None); }
            let plan = program.and_then(|p| crate::engine::postgres::read_plan::Plan::new(schema,p,context));
            let (tx,facts) = handle.store.get_mut().planned_authority_transaction(digest,plan)?;
            return Ok(Some(ReadSnapshot { tx: AnyTx::Postgres(PostgresTx(tx)), authority:Some((digest.into(),facts)) }));
        }
        let _ = (schema,program,context);
        self.request_read_transaction(digest)
    }
    // @ref LLP 3000.009.001.000.001#33-borrow-the-snapshot-never-open-another — the facts SELECT pins and validates the query's generation, identity and head.
    pub(crate) fn request_read_transaction(&mut self, digest: &str) -> Result<Option<ReadSnapshot<'_>>, RuntimeError> {
        if digest.contains('\0') { return Ok(None); }
        let (tx, facts) = match self {
            Self::Sqlite(SqliteStore(store)) => {
                let (tx, facts) = store.session_authority_transaction(digest, true)?;
                (AnyTx::Sqlite(SqliteTx(tx)), facts)
            }
            #[cfg(feature = "postgres")]
            Self::Postgres(PostgresStore(handle)) => {
                let (tx, facts) = handle.store.get_mut().session_authority_transaction(digest)?;
                (AnyTx::Postgres(PostgresTx(tx)), facts)
            }
        };
        Ok(Some(ReadSnapshot { tx, authority: Some((digest.into(), facts)) }))
    }
    pub(crate) fn opening_transaction(&mut self) -> Result<AnyTx<'_>, RuntimeError> {
        match self { Self::Sqlite(SqliteStore(store)) => store.opening_transaction().map(|inner| AnyTx::Sqlite(SqliteTx(inner))), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(handle)) => { let store = handle.store.get_mut(); let mode = if store.read_only { None } else { Some(crate::engine::postgres::WriteMode::Serialized) }; store.attach_transaction(mode).map(|inner| AnyTx::Postgres(PostgresTx(inner))) } }
    }
    pub(crate) fn finish_open(tx: AnyTx<'_>) -> Result<OpeningMetadata, RuntimeError> {
        match tx { AnyTx::Sqlite(SqliteTx(tx)) => sqlite::Store::finish_open(tx), #[cfg(feature = "postgres")] AnyTx::Postgres(PostgresTx(tx)) => tx.finish_open() }
    }
    pub(crate) fn with_session_authority_snapshot<T>(&self, digest: &str, run: impl FnOnce(&AnyTx<'_>, crate::identity::facts::SessionFacts) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        match self {
            Self::Sqlite(SqliteStore(store)) => {
                let (tx, facts) = store.session_authority_transaction(digest, true)?;
                let tx = AnyTx::Sqlite(SqliteTx(tx));
                let result = run(&tx, facts)?;
                tx.rollback()?;
                Ok(result)
            }
            #[cfg(feature = "postgres")]
            Self::Postgres(PostgresStore(handle)) => {
                let mut store = handle.borrow()?;
                let (tx, facts) = store.session_authority_transaction(digest)?;
                let tx = AnyTx::Postgres(PostgresTx(tx));
                let result = run(&tx, facts)?;
                tx.rollback()?;
                Ok(result)
            }
        }
    }
    pub(crate) fn with_preflight_snapshot<T>(&self, digest: &str, receipt: Option<(&str,&str)>, ordinary: bool, run: impl FnOnce(&AnyTx<'_>,crate::identity::facts::SessionFacts)->Result<T,RuntimeError>) -> Result<T,RuntimeError> {
        #[cfg(feature="postgres")]
        if ordinary && let Self::Postgres(PostgresStore(handle)) = self {
            let mut store = handle.borrow()?;
            let (tx,facts) = store.preflight_transaction(digest,receipt)?;
            let tx = AnyTx::Postgres(PostgresTx(tx));
            let result = run(&tx,facts)?;
            tx.rollback()?;
            return Ok(result);
        }
        let _ = (receipt,ordinary);
        self.with_session_authority_snapshot(digest,run)
    }
    pub(crate) fn with_authority_snapshot<T>(&self, run: impl FnOnce(&AnyTx<'_>) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        match self { Self::Sqlite(SqliteStore(store)) => {
            let tx = AnyTx::Sqlite(SqliteTx(store.authority_transaction()?));
            let result = run(&tx)?;
            tx.rollback()?;
            Ok(result)
        }, #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(handle)) => {
            let mut store = handle.borrow()?;
            let tx = AnyTx::Postgres(PostgresTx(store.transaction(None)?));
            let result = run(&tx)?;
            tx.rollback()?;
            Ok(result)
        } }
    }
    pub fn reader(&self) -> Result<Self, RuntimeError> {
        match self { Self::Sqlite(SqliteStore(store)) => store.reader().map(|inner| Self::Sqlite(SqliteStore(inner))), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(handle)) => handle.reader().map(|inner| Self::Postgres(PostgresStore(inner))) }
    }
    pub fn fork_memory(&self) -> Result<Self, RuntimeError> {
        match self { Self::Sqlite(SqliteStore(store)) => store.fork_memory().map(|inner| Self::Sqlite(SqliteStore(inner))), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "memory-fork" }) }
    }
}
impl AnyTx<'_> {
    pub fn commit(self) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(tx)) => tx.commit(), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(tx)) => tx.commit() } }
    pub fn rollback(self) -> Result<(), RuntimeError> { match self { Self::Sqlite(SqliteTx(tx)) => tx.rollback(), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(tx)) => tx.rollback() } }
    pub(crate) fn begin_member_evidence(&self) { match self { Self::Sqlite(SqliteTx(tx)) => tx.begin_member_evidence(), #[cfg(feature = "postgres")] Self::Postgres(PostgresTx(tx)) => tx.begin_member_evidence() } }
}
impl ReadSnapshot<'_> {
    #[cfg(feature="postgres")]
    pub(crate) fn result_cache_facts(&self)->Option<&crate::identity::facts::SessionFacts> {
        self.authority.as_ref().map(|(_,facts)|facts)
    }
    pub(crate) fn finish_planned_reads(&self) -> Result<(),RuntimeError> {
        #[cfg(feature="postgres")]
        if let AnyTx::Postgres(PostgresTx(tx)) = &self.tx { tx.finish_planned_reads()?; }
        Ok(())
    }
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
        check: impl Fn(&AnyPreparation<'_, '_>) -> Result<(), RuntimeError>,
        build: impl FnMut(&AnyTx<'_>, bool, &mut AdoptionReport) -> Result<(), RuntimeError>,
        finish: impl Fn(&AnyTx<'_>) -> Result<R, RuntimeError>,
    ) -> Result<Committed<(u64, R)>, RuntimeError> {
        match self { Self::Sqlite(SqliteStore(store)) => store.activate_at_with_launch(
            schema, programs, reset, now, allow_launch,
            |preparation| check(&AnyPreparation::from(preparation)),
            build, finish,
        ), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(handle)) => handle.activate(schema, programs, reset, now, check, build, finish) }
    }
}



impl AnyStore {
    // Scoped reads preserve the shared receiver and original SQLite snapshot boundaries.
    pub fn job(&self, id: &str) -> Result<Option<crate::engine::job::JobRun>, RuntimeError> { match self { Self::Sqlite(SqliteStore(store)) => store.job(id), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(handle)) => crate::engine::job::JobStore::job(&mut *handle.borrow()?, id) } }
    pub fn jobs(&self, limit: usize) -> Result<Vec<crate::engine::job::JobRun>, RuntimeError> { match self { Self::Sqlite(SqliteStore(store)) => store.jobs(limit), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(handle)) => crate::engine::job::JobStore::jobs(&mut *handle.borrow()?, limit) } }
    pub fn job_count(&self) -> Result<i64, RuntimeError> { match self { Self::Sqlite(SqliteStore(store)) => store.job_count(), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(handle)) => crate::engine::job::JobStore::job_count(&mut *handle.borrow()?) } }
}
impl AnyStore {
    pub fn request_counts(&self) -> Result<BTreeMap<String, u64>, RuntimeError> {
        match self { Self::Sqlite(SqliteStore(store)) => crate::engine::actions::requests::RequestsStore::request_counts(&mut &*store), #[cfg(feature = "postgres")] Self::Postgres(PostgresStore(handle)) => crate::engine::actions::requests::RequestsStore::request_counts(&mut *handle.borrow()?) }
    }
}

impl AnyTx<'_> {
    pub(crate) fn prepare_seed_inputs(&self, schema: &Schema) -> Result<(), RuntimeError> {
        match self { Self::Sqlite(SqliteTx(tx)) => {
            if sqlite::backfills::has_evidence(tx)? { sqlite::backfills::prepare_inputs(tx, schema, None)?; }
            Ok(())
        }, #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "seed-evolution" }) }
    }
    pub(crate) fn rewrite_legacy_maintained_references(&self, ids: &BTreeMap<String, BTreeMap<String, String>>) -> Result<u64, RuntimeError> {
        match self { Self::Sqlite(SqliteTx(tx)) => sqlite::dormant::rewrite_legacy_maintained_references(tx, ids), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "retained-authority" }) }
    }
}

#[cfg(not(feature = "postgres"))]
impl AnyStore {
    pub fn admit(&self, _: &Schema, _: &BTreeMap<String, Program>) -> Result<(), RuntimeError> { Ok(()) }
}
#[cfg(not(feature = "postgres"))]
impl AnyTx<'_> {
    pub(crate) fn admit(&self, _: &Schema, _: &BTreeMap<String, Program>) -> Result<(), RuntimeError> { Ok(()) }
}

impl<'store> AnyTx<'store> {
    pub(crate) fn bound_program_attempt(&self, deadline: std::time::Instant) -> Result<AttemptBudget<'_>, RuntimeError> {
        let _remaining = deadline.checked_duration_since(std::time::Instant::now()).filter(|r|!r.is_zero())
            .ok_or_else(||RuntimeError::Store("program invocation's remaining deadline elapsed".into()))?;
        match self {
            Self::Sqlite(SqliteTx(tx)) => {
                let busy=sqlite::program_deadline::Budget::begin(tx.conn(),deadline)?;
                tx.conn().progress_handler(1000, Some(move || std::time::Instant::now() >= deadline))?;
                Ok(AttemptBudget(Some(Box::new(move || { let _ = tx.conn().progress_handler(0,None::<fn()->bool>); drop(busy); }))))
            }
            #[cfg(feature="postgres")]
            Self::Postgres(PostgresTx(tx)) => { tx.bound_program_attempt(deadline)?; Ok(AttemptBudget(None)) }
        }
    }
    pub(crate) fn enable_group_tail(&self) -> Result<(), RuntimeError> {
        match self { Self::Sqlite(_) => Ok(()), #[cfg(feature="postgres")] Self::Postgres(PostgresTx(tx)) => tx.enable_group_tail() }
    }
    pub(crate) fn prepare_program_commit(&self) -> Result<(), RuntimeError> {
        match self {
            Self::Sqlite(_) => Ok::<(), RuntimeError>(()),
            #[cfg(feature = "postgres")]
            Self::Postgres(PostgresTx(tx)) => tx.flush_tail(),
        }?;
        #[cfg(test)]
        crate::engine::program_tail_prepared();
        Ok(())
    }
    pub(crate) fn commit_program(self) -> Result<(), crate::engine::committer::outcome::Failure> {
        #[cfg(any(test,feature="test-support"))]
        let started=std::time::Instant::now();
        let result=match self {
            Self::Sqlite(SqliteTx(tx)) => tx.commit_program(),
            #[cfg(feature = "postgres")]
            Self::Postgres(PostgresTx(tx)) => tx.commit_program(),
        };
        #[cfg(any(test,feature="test-support"))]
        crate::round_trips::committed_in(started.elapsed());
        result
    }
    pub(crate) fn from_sqlite(tx: sqlite::Tx<'store>) -> Self { Self::Sqlite(SqliteTx(tx)) }
    // Adapter-only activation callbacks keep backend borrows scoped to the port.
    pub(crate) fn with_sqlite<T>(&self, run: impl FnOnce(&sqlite::Tx<'store>) -> T) -> T {
        match self { Self::Sqlite(SqliteTx(tx)) => run(tx), #[cfg(feature = "postgres")] Self::Postgres(_) => unreachable!("SQLite adapter transaction") }
    }
    #[cfg(feature = "postgres")]
    pub(crate) fn from_postgres(tx: crate::engine::postgres::store::Tx<'store>) -> Self { Self::Postgres(PostgresTx(tx)) }
    #[cfg(feature = "postgres")]
    pub(crate) fn with_postgres<T>(&self, run: impl FnOnce(&crate::engine::postgres::store::Tx<'store>) -> T) -> T {
        match self { Self::Postgres(PostgresTx(tx)) => run(tx), Self::Sqlite(_) => unreachable!("Postgres adapter transaction") }
    }
}

pub(crate) struct AttemptBudget<'a>(Option<Box<dyn FnOnce() + 'a>>);
impl Drop for AttemptBudget<'_> {
    fn drop(&mut self) { if let Some(clear) = self.0.take() { clear(); } }
}
#[cfg(feature = "postgres")]
impl AnyStore {
    pub(crate) fn from_postgres(handle: crate::engine::postgres::Handle) -> Self { Self::Postgres(PostgresStore(handle)) }
}

// @ref LLP 3000.009.001.000.000#3.7 — the committer alone owns identity COMMIT; the port preserves the original opener.
pub(crate) struct IdentitySource<'a>(pub &'a AnyStore, pub bool);
impl crate::engine::committer::TransactionSource for IdentitySource<'_> {
    fn with_transaction<T>(self, run: impl FnOnce(AnyTx<'_>) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        match self.0 {
            AnyStore::Sqlite(SqliteStore(store)) => run(AnyTx::from_sqlite(store.identity_member_transaction(self.1)?)),
            #[cfg(feature = "postgres")]
            AnyStore::Postgres(PostgresStore(handle)) => {
                let mut store = handle.borrow()?;
                run(AnyTx::Postgres(PostgresTx(store.transaction(Some(crate::engine::postgres::WriteMode::Serialized))?)))
            }
        }
    }
}
