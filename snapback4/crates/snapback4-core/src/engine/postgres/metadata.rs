//! Typed metadata over the caller's Postgres snapshot or serialized writer.
// @ref LLP 3000.009.001.000#3.1 — shared keys and raw values; interpretation belongs to callers.
use super::store::{Store, Tx, WriteMode, absent_text_key};
use crate::{
    RuntimeError,
    metadata::{
        DevMetadata, MetadataReader, MetadataWriter, SchemaMarker, dev_key, schema_key,
        validate_new_key, validate_value, worker_status_key,
    },
};
use std::cell::RefCell;

pub(super) fn initialize(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    super::foundation_schema::verify(
        tx,
        "_meta",
        &[("key", "text", true, true), ("value", "text", true, false)],
        &["key"],
    )?;
    if !tx.query("SELECT to_regclass('_meta') IS NOT NULL", &[])?[0].get::<_, bool>(0) {
        tx.batch("CREATE TABLE _meta (key TEXT COLLATE \"C\" PRIMARY KEY, value TEXT NOT NULL)")?;
    }
    Ok(())
}
fn read(tx: &Tx<'_>, key: &str) -> Result<Option<String>, RuntimeError> {
    // A NUL metadata key cannot exist on Postgres: absent without querying.
    if absent_text_key(&[key]) {
        return Ok(None);
    }
    Ok(tx
        .query("SELECT value FROM _meta WHERE key=$1", &[&key])?
        .first()
        .map(|r| r.get(0)))
}
fn write(tx: &Tx<'_>, key: &str, value: &str) -> Result<(), RuntimeError> {
    validate_new_key(key)?;
    validate_value(value)?;
    tx.require_serialized_head_fence("write metadata")?;
    tx.execute_one("INSERT INTO _meta(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", &[&key, &value])
}
macro_rules! readers {
    ($($name:ident($($arg:ident: $kind:ty),*) => $key:expr;)*) => {
        impl MetadataReader for Tx<'_> {
            $(fn $name(&self, $($arg: $kind),*) -> Result<Option<String>, RuntimeError> { read(self, &$key) })*
        }
        impl MetadataReader for RefCell<&mut Store> {
            $(fn $name(&self, $($arg: $kind),*) -> Result<Option<String>, RuntimeError> {
                let key = $key;
                if absent_text_key(&[&key]) { return Ok(None); }
                let mut store = self.borrow_mut();
                let tx = store.transaction(None)?;
                let value = read(&tx, &key)?;
                tx.rollback()?;
                Ok(value)
            })*
        }
    };
}
readers! {
    store_identity() => "store_id";
    generation_value() => "generation";
    release_value() => "release";
    release_revision_value() => "release_revision";
    release_native_digest() => "release_native_digest";
    time_audience_clock_value() => "time_audience_clock";
    schema_marker(marker: SchemaMarker) => schema_key(marker);
    worker_session_family() => "worker:session-family";
    worker_session_revision() => "worker:session-revision";
    worker_family_revision(family: &str) => format!("worker:family:{family}");
    worker_status(worker: Option<&str>) => worker_status_key(worker);
    deployment_environment() => "deployment_environment";
    dev_value(key: DevMetadata) => dev_key(key);
}
macro_rules! writers {
    ($($name:ident($($arg:ident: $kind:ty),*) => $key:expr;)*) => {
        impl MetadataWriter for Tx<'_> {
            $(fn $name(&self, $($arg: $kind,)* value: &str) -> Result<(), RuntimeError> { write(self, &$key, value) })*
        }
        impl MetadataWriter for RefCell<&mut Store> {
            $(fn $name(&self, $($arg: $kind,)* value: &str) -> Result<(), RuntimeError> {
                let key = $key;
                validate_new_key(&key)?;
                validate_value(value)?;
                let mut store = self.borrow_mut();
                let tx = store.transaction(Some(WriteMode::Serialized))?;
                write(&tx, &key, value)?;
                tx.commit()
            })*
        }
    };
}
writers! {
    set_dev_value(key: DevMetadata) => dev_key(key);
    set_deployment_environment() => "deployment_environment";
    set_worker_status(worker: Option<&str>) => worker_status_key(worker);
}
