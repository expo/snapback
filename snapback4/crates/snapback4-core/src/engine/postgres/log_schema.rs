//! Managed log integrity belongs to the tail, without a cached RI trigger plan.
// @ref LLP 3000.009.001.000.002#3.4 — remove only the recognized legacy FK inside fenced attach.
use super::{shape, store::Tx};
use crate::RuntimeError;

const LEGACY_KEYS: &str = "SELECT c.conname::text,COALESCE((c.contype = 'f' AND c.convalidated
    AND NOT c.condeferrable AND NOT c.condeferred
    AND c.confrelid = to_regclass('_commits')
    AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='seq' AND NOT attisdropped)]
    AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='seq' AND NOT attisdropped)]
    AND c.confupdtype = 'a' AND c.confdeltype = 'a' AND c.confmatchtype = 's'), false) FROM pg_constraint c WHERE c.conrelid=to_regclass('_log') AND c.contype='f'";

pub(super) fn legacy_keys(tx: &Tx<'_>) -> Result<Vec<postgres::Row>, RuntimeError> {
    tx.query(LEGACY_KEYS, &[])
}

pub(super) fn install(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    if !super::ledger_schema::verify_relation(tx, "_log", |table, detail| {
        RuntimeError::Store(format!("SNAPBACK_LOG_SCHEMA: {table}: {detail}"))
    })? {
        return Err(RuntimeError::Store(
            "SNAPBACK_LOG_SCHEMA: missing _log".into(),
        ));
    }
    let keys = legacy_keys(tx)?;
    if keys.len() > 1 || keys.iter().any(|r| !r.get::<_, bool>(1)) {
        return Err(RuntimeError::Store(
            "SNAPBACK_LOG_SCHEMA: unexpected foreign key".into(),
        ));
    }
    for key in keys {
        let name: &str = key.get(0);
        tx.batch(&format!(
            "ALTER TABLE _log DROP CONSTRAINT \"{}\"",
            name.replace('"', "\"\"")
        ))?;
    }
    // All validation and DDL roll back together on any later attach refusal.
    // An installed shape performs no ALTER, so held readers do not block reopen.
    shape::verify(
        tx,
        "_log",
        &[
            ("partition", "text", true, true),
            ("seq", "bigint", true, false),
            ("ord", "bigint", true, false),
            ("t", "text", true, false),
            ("kind", "text", true, false),
            ("id", "text", true, false),
            ("data", "text", false, false),
        ],
        &["partition", "seq", "ord"],
        "SNAPBACK_LOG_SCHEMA",
    )
}
