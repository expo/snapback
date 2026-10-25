//! Connection custody for the neutral server handle. No driver borrow escapes a
//! shared-receiver composite; conflicting borrows are typed store errors.
// @ref LLP 3000.009.001.000#3.4 — scoped family access and a same-store reader factory.
use super::store::{Store, Tx};
use crate::{RuntimeError, store_port::report::AdoptionReport};
use std::cell::{RefCell, RefMut};

pub struct Handle {
    pub(crate) store: RefCell<Store>,
    pub(crate) report: AdoptionReport,
    pub(super) connection: (postgres::Config, String),
    pub(super) fresh: bool,
    pub(super) readers: RefCell<Option<std::sync::Arc<super::pipeline::Pool>>>,
    pub(super) bootstrap_id: Option<String>,
}
impl Handle {
    pub(crate) fn borrow(&self) -> Result<RefMut<'_, Store>, RuntimeError> {
        self.store.try_borrow_mut().map_err(|_| RuntimeError::Store("Postgres store already borrowed".into()))
    }
    pub(crate) fn scoped<T>(&self, run: impl FnOnce(RefCell<&mut Store>) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        run(RefCell::new(&mut *self.borrow()?))
    }
    pub(crate) fn read<T>(&self, run: impl FnOnce(&Tx<'_>) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        let mut store = self.borrow()?;
        let tx = store.transaction(None)?;
        let result = run(&tx)?;
        tx.rollback()?;
        Ok(result)
    }
    pub(crate) fn reader(&self) -> Result<Self, RuntimeError> {
        if self.fresh { return Err(RuntimeError::StoreUnsupported { family: "opening" }); }
        let before = self.read(|tx| Ok((crate::metadata::MetadataReader::store_identity(tx)?, crate::activation::ActivationReader::opening_backend(tx)?)))?;
        let existing = self.readers.borrow().clone();
        let pool = if let Some(pool) = existing { pool } else {
            let pool = super::pipeline::Pool::new(&self.connection.0, &self.connection.1, self.borrow()?.fence.as_ref().map(|f| f.tag()).transpose()?)?;
            pool.reserve_writer()?;
            *self.readers.borrow_mut() = Some(pool.clone()); pool
        };
        let reader = Self::connect_reader(self.connection.0.clone(), &self.connection.1, self.borrow()?.fence.clone(), pool)?;
        reader.store.borrow_mut().read_grant=self.borrow()?.read_grant.clone();
        let after = reader.read(|tx| Ok((crate::metadata::MetadataReader::store_identity(tx)?, crate::activation::ActivationReader::opening_backend(tx)?)))?;
        if before != after { return Err(RuntimeError::Generation("reader store identity or generation changed; reopen".into())); }
        Ok(reader)
    }
    pub(crate) fn write<T>(&self, run: impl FnOnce(&Tx<'_>) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        let mut store = self.borrow()?;
        let tx = store.transaction(Some(super::WriteMode::Serialized))?;
        let result = run(&tx)?;
        tx.commit()?;
        Ok(result)
    }
}

impl Handle {
    pub(crate) fn writer_slot(&self) -> Result<Self, RuntimeError> {
        let existing=self.readers.borrow().clone();
        let pool = if let Some(pool) = existing { pool } else {
            let pool = super::pipeline::Pool::new(&self.connection.0, &self.connection.1, self.borrow()?.fence.as_ref().map(|f| f.tag()).transpose()?)?;
            *self.readers.borrow_mut() = Some(pool.clone()); pool
        };
        pool.reserve_writer()?;
        let mut slot = Self::connect_owned(self.connection.0.clone(), &self.connection.1, self.borrow()?.fence.clone())?;
        slot.store.get_mut().read_grant = self.borrow()?.read_grant.clone();
        slot.store.get_mut().batch_ordinal = self.borrow()?.batch_ordinal.clone();
        slot.store.get_mut().client.writer_thread();
        self.borrow()?.client.writer_thread();
        *slot.readers.borrow_mut() = Some(pool);
        Ok(slot)
    }
}

impl Handle {
    // Reconnect only a lost slot, without reading/reseeding the head. Recovery
    // must take the owner fence and probe every unresolved ticket first.
    pub(crate) fn reconnect_pipeline_writer(&mut self) -> Result<(),RuntimeError> {
        let old=self.store.get_mut();
        if !old.client.is_closed() {return Ok(());}
        old.client.close_writer();
        let (mut client,warning)=super::ownership::connect(self.connection.0.clone())?;
        let namespace=super::store::namespace(&self.connection.1)?;
        let tag=old.fence.as_ref().ok_or_else(||RuntimeError::StoreOwnership("missing recovery fence".into()))?.tag()?;
        client.batch_execute(&format!("SET search_path={namespace},pg_catalog;SET statement_timeout='5s';SET lock_timeout='5s'"))?;
        client.execute("SELECT set_config('application_name',$1,false)",&[&tag])?;
        let mut replacement=Store::new(client);
        replacement.fence=old.fence.clone();replacement.unified=true;replacement.generation=old.generation;
        replacement.read_sessions.set(old.read_sessions.get());replacement.read_grant=old.read_grant.clone();replacement.commit_warning=warning;replacement.batch_ordinal=old.batch_ordinal.clone();
        replacement.client.writer_thread();*old=replacement;Ok(())
    }
}

impl Handle {
    pub(crate) fn sync_pipeline_slot(&mut self,other:&Self) {
        let dst=self.store.get_mut();let src=other.store.borrow();dst.generation=src.generation;dst.read_sessions.set(src.read_sessions.get());dst.fence=src.fence.clone();
    }
}
