// @ref LLP 3000.009.001.000#3.4 — concrete backend payloads belong inside the port adapter.
use crate::store as sqlite;

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
    pub(super) tx: AnyTx<'store>,
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
