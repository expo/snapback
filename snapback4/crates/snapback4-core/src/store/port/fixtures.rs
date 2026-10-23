//! Debug-only corruption hooks; no backend owning handle is exposed.
// @ref LLP 3000.009.001.000#3.4 — explicit fixture connections stay debug-only; owning payloads remain opaque.
use super::handles::{AnyStore, AnyTx, SqliteStore, SqliteTx};
use crate::RuntimeError;
macro_rules! fixture_access {
    ($handle:ty, $wrapper:ident) => {
        impl $handle {
            pub fn test_support_conn(&self) -> &rusqlite::Connection {
                match self { Self::Sqlite($wrapper(inner)) => inner.test_support_conn(), #[cfg(feature = "postgres")] Self::Postgres(_) => panic!("SQLite fixture") }
            }
            pub fn test_support_meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
                match self { Self::Sqlite($wrapper(inner)) => inner.test_support_meta(key), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "sqlite-fixture" }) }
            }
            pub fn test_support_set_meta(&self, key: &str, value: &str) -> Result<(), RuntimeError> {
                match self { Self::Sqlite($wrapper(inner)) => inner.test_support_set_meta(key, value), #[cfg(feature = "postgres")] Self::Postgres(_) => Err(RuntimeError::StoreUnsupported { family: "sqlite-fixture" }) }
            }
        }
    };
}
fixture_access!(AnyStore, SqliteStore);
fixture_access!(AnyTx<'_>, SqliteTx);

#[cfg(all(test, feature = "postgres"))]
impl AnyStore {
    pub(crate) fn test_postgres_handle(&self) -> &crate::engine::postgres::Handle {
        match self { Self::Postgres(super::handles::PostgresStore(h)) => h, _ => panic!("Postgres fixture") }
    }
    pub(crate) fn test_postgres_handle_mut(&mut self) -> &mut crate::engine::postgres::Handle {
        match self { Self::Postgres(super::handles::PostgresStore(h)) => h, _ => panic!("Postgres fixture") }
    }
}
#[cfg(all(test, feature = "postgres"))]
impl<'store> AnyTx<'store> {
    pub(crate) fn test_postgres_tx(&self) -> &crate::engine::postgres::store::Tx<'store> {
        match self { Self::Postgres(super::handles::PostgresTx(tx)) => tx, _ => panic!("Postgres fixture") }
    }
}

impl<'store> super::handles::ReadSnapshot<'store> {
    pub fn test_support_conn(&self) -> &rusqlite::Connection { self.tx.test_support_conn() }
    #[cfg(all(test, feature = "postgres"))]
    pub(crate) fn test_postgres_tx(&self) -> &crate::engine::postgres::store::Tx<'store> {
        self.tx.test_postgres_tx()
    }
}

#[cfg(test)]
impl AnyStore {
    pub(crate) fn test_with_sqlite<T>(&self, run: impl FnOnce(&crate::store::Store) -> T) -> T {
        match self { Self::Sqlite(SqliteStore(store)) => run(store), #[cfg(feature = "postgres")] Self::Postgres(_) => panic!("SQLite fixture") }
    }
    pub(crate) fn test_with_sqlite_mut<T>(&mut self, run: impl FnOnce(&mut crate::store::Store) -> T) -> T {
        match self { Self::Sqlite(SqliteStore(store)) => run(store), #[cfg(feature = "postgres")] Self::Postgres(_) => panic!("SQLite fixture") }
    }
}
