//! Ordinary dormant ledgers are installed at attach, never in a row writer.
// @ref LLP 3000.009.001.000#3.5 — EV-1 retains ordinary definitions, cells and parent lifetimes.
use super::{shape, store::Tx};
use crate::RuntimeError;

pub(super) fn verify(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    for (name, keys, payload) in [
        ("_dormant_tables", &["table_name"][..], &["definition"][..]),
        (
            "_dormant_columns",
            &["table_name", "column_name"][..],
            &["definition"][..],
        ),
        (
            "_dormant_indexes",
            &["table_name", "index_name"][..],
            &["definition"][..],
        ),
        ("_dormant_rows", &["t", "id"][..], &["data"][..]),
        (
            "_dormant_values",
            &["t", "id", "column_name"][..],
            &["data"][..],
        ),
        (
            "_dormant_refs",
            &["t", "id", "column_name", "parent_t", "parent_id"][..],
            &[][..],
        ),
    ] {
        let mut columns: Vec<shape::Column> =
            keys.iter().map(|&k| (k, "text", true, true)).collect();
        columns.extend(payload.iter().map(|&k| (k, "text", true, false)));
        if name == "_dormant_refs" {
            columns.push(("invalid", "bigint", true, false));
        }
        shape::verify(tx, name, &columns, keys, "SNAPBACK_EVOLUTION_SCHEMA")?;
    }
    Ok(())
}
pub(super) fn initialize(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    verify(tx)?;
    tx.batch(r#"
        CREATE TABLE IF NOT EXISTS _dormant_tables(table_name TEXT COLLATE "C" PRIMARY KEY,definition TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS _dormant_columns(table_name TEXT COLLATE "C" NOT NULL,column_name TEXT COLLATE "C" NOT NULL,definition TEXT NOT NULL,PRIMARY KEY(table_name,column_name));
        CREATE TABLE IF NOT EXISTS _dormant_indexes(table_name TEXT COLLATE "C" NOT NULL,index_name TEXT COLLATE "C" NOT NULL,definition TEXT NOT NULL,PRIMARY KEY(table_name,index_name));
        CREATE TABLE IF NOT EXISTS _dormant_rows(t TEXT COLLATE "C" NOT NULL,id TEXT COLLATE "C" NOT NULL,data TEXT NOT NULL,PRIMARY KEY(t,id));
        CREATE TABLE IF NOT EXISTS _dormant_values(t TEXT COLLATE "C" NOT NULL,id TEXT COLLATE "C" NOT NULL,column_name TEXT COLLATE "C" NOT NULL,data TEXT NOT NULL,PRIMARY KEY(t,id,column_name));
        CREATE TABLE IF NOT EXISTS _dormant_refs(t TEXT COLLATE "C" NOT NULL,id TEXT COLLATE "C" NOT NULL,column_name TEXT COLLATE "C" NOT NULL,parent_t TEXT COLLATE "C" NOT NULL,parent_id TEXT COLLATE "C" NOT NULL,invalid BIGINT NOT NULL,PRIMARY KEY(t,id,column_name,parent_t,parent_id));
        CREATE INDEX IF NOT EXISTS _dormant_parent ON _dormant_refs(parent_t,parent_id);
    "#)
}
