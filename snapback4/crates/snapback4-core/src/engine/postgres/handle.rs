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
        let mut reader = Self::connect_owned(self.connection.0.clone(), &self.connection.1, self.borrow()?.fence.clone())?;
        let after = reader.read(|tx| Ok((crate::metadata::MetadataReader::store_identity(tx)?, crate::activation::ActivationReader::opening_backend(tx)?)))?;
        if before != after { return Err(RuntimeError::Generation("reader store identity or generation changed; reopen".into())); }
        reader.store.get_mut().read_only = true;
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
