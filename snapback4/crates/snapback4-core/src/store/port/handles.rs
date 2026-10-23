// @ref LLP 3000.009.001.000#3.4 — concrete backend payloads belong inside the port adapter.
use crate::store as sqlite;

/// A neutral store. Backend payloads are opaque even after variant matching.
///
/// ```compile_fail,E0308
/// use snapback4_core::{store, store_port::AnyStore};
/// fn extract(owner: AnyStore) -> store::Store {
///     match owner { AnyStore::Sqlite(payload) => payload, _ => panic!() }
/// }
/// ```
///
/// ```compile_fail,E0616
/// use snapback4_core::store_port::AnyStore;
/// fn extract(store: &AnyStore) {
///     if let AnyStore::Sqlite(payload) = store { let _ = &payload.0; }
/// }
/// ```
/// ```compile_fail,E0599
/// use snapback4_core::store_port::AnyStore;
/// fn raw(store: &mut AnyStore) {
///     if let AnyStore::Sqlite(payload) = store { payload.transaction().unwrap(); }
/// }
/// ```
/// ```compile_fail,E0277
/// use snapback4_core::store_port::AnyStore;
/// fn extract(owner: &AnyStore) {
///     if let AnyStore::Sqlite(payload) = owner { let _ = std::ops::Deref::deref(payload); }
/// }
/// ```
#[cfg_attr(feature = "postgres", doc = r#"
```compile_fail,E0308
use snapback4_core::{engine::postgres::Handle, store_port::AnyStore};
fn extract(owner: AnyStore) -> Handle {
    match owner { AnyStore::Postgres(payload) => payload, _ => panic!() }
}
```
```compile_fail,E0616
use snapback4_core::store_port::AnyStore;
fn extract(store: &AnyStore) {
    if let AnyStore::Postgres(payload) = store { let _ = &payload.0; }
}
```
```compile_fail,E0599
use snapback4_core::store_port::AnyStore;
fn raw(store: &mut AnyStore) {
    if let AnyStore::Postgres(payload) = store { payload.transaction(None).unwrap(); }
}
```
```compile_fail,E0277
use snapback4_core::store_port::AnyStore;
fn extract(owner: &AnyStore) {
    if let AnyStore::Postgres(payload) = owner { let _ = std::ops::Deref::deref(payload); }
}
```
"#)]
pub enum AnyStore {
    Sqlite(SqliteStore),
    #[cfg(feature = "postgres")]
    Postgres(PostgresStore),
}

/// A neutral transaction. Matching never exposes backend methods or defaults.
///
/// ```compile_fail,E0308
/// use snapback4_core::{store, store_port::AnyTx};
/// fn extract<'s>(owner: AnyTx<'s>) -> store::Tx<'s> {
///     match owner { AnyTx::Sqlite(payload) => payload, _ => panic!() }
/// }
/// ```
///
/// ```compile_fail,E0616
/// use snapback4_core::store_port::AnyTx;
/// fn extract(tx: &AnyTx<'_>) {
///     if let AnyTx::Sqlite(payload) = tx { let _ = &payload.0; }
/// }
/// ```
/// ```compile_fail,E0599
/// use snapback4_core::store_port::AnyTx;
/// fn raw(tx: &AnyTx<'_>) {
///     if let AnyTx::Sqlite(payload) = tx { payload.conn().execute_batch("COMMIT").unwrap(); }
/// }
/// ```
/// ```compile_fail,E0277
/// use snapback4_core::{rows::Rows, store_port::AnyTx};
/// fn require_rows<T: Rows>(_: &T) {}
/// fn bypass(tx: &AnyTx<'_>) {
///     if let AnyTx::Sqlite(payload) = tx { require_rows(payload); }
/// }
/// ```
/// ```compile_fail,E0277
/// use snapback4_core::store_port::AnyTx;
/// fn extract(owner: &AnyTx<'_>) {
///     if let AnyTx::Sqlite(payload) = owner { let _ = std::ops::Deref::deref(payload); }
/// }
/// ```
#[cfg_attr(feature = "postgres", doc = r#"
```compile_fail,E0603
use snapback4_core::engine::postgres::store::{Store, Tx};
```
```compile_fail,E0616
use snapback4_core::store_port::AnyTx;
fn extract(tx: &AnyTx<'_>) {
    if let AnyTx::Postgres(payload) = tx { let _ = &payload.0; }
}
```
```compile_fail,E0599
use snapback4_core::store_port::AnyTx;
fn raw(tx: &AnyTx<'_>) {
    if let AnyTx::Postgres(payload) = tx { payload.batch("COMMIT").unwrap(); }
}
```
```compile_fail,E0599
use snapback4_core::store_port::AnyTx;
fn raw(tx: &AnyTx<'_>) {
    if let AnyTx::Postgres(payload) = tx { payload.execute("DELETE FROM _meta", &[]).unwrap(); }
}
```
```compile_fail,E0599
use snapback4_core::store_port::AnyTx;
fn raw(tx: &AnyTx<'_>) {
    if let AnyTx::Postgres(payload) = tx { payload.query("SELECT 1", &[]).unwrap(); }
}
```
```compile_fail,E0277
use snapback4_core::{rows::Rows, store_port::AnyTx};
fn require_rows<T: Rows>(_: &T) {}
fn bypass(tx: &AnyTx<'_>) {
    if let AnyTx::Postgres(payload) = tx { require_rows(payload); }
}
```
```compile_fail,E0277
use snapback4_core::store_port::AnyTx;
fn extract(owner: &AnyTx<'_>) {
    if let AnyTx::Postgres(payload) = owner { let _ = std::ops::Deref::deref(payload); }
}
```
"#)]
pub enum AnyTx<'store> {
    Sqlite(SqliteTx<'store>),
    #[cfg(feature = "postgres")]
    Postgres(PostgresTx<'store>),
}

/// A read snapshot retains its physical transaction until closed: SQLite
/// DEFERRED or Postgres REPEATABLE READ, pinning head and generation together.
pub struct ReadSnapshot<'store> {
    pub(super) tx: AnyTx<'store>,
    // Only this transaction owns these facts; they never survive its rollback.
    pub(super) authority: Option<(String, crate::identity::facts::SessionFacts)>,
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

// Private fields are visible only inside the port. These payloads have no
// Deref, backend traits or public extraction/conversion methods.
#[non_exhaustive]
pub struct SqliteStore(pub(super) sqlite::Store);
#[non_exhaustive]
pub struct SqliteTx<'store>(pub(super) sqlite::Tx<'store>);
#[cfg(feature = "postgres")]
#[non_exhaustive]
pub struct PostgresStore(pub(super) crate::engine::postgres::Handle);
#[cfg(feature = "postgres")]
#[non_exhaustive]
pub struct PostgresTx<'store>(pub(super) crate::engine::postgres::store::Tx<'store>);
