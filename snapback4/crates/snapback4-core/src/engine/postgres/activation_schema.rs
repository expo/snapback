//! Generation history and catalog installation belongs to fenced attach.
// @ref LLP 3000.009.001.000#9.1 — no relation DDL in an activation writer.
use super::{shape, store::Tx};
use crate::RuntimeError;

pub(super) fn initialize(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    for (table, columns, primary) in [
        ("_meta", &[("key", "text", true, true), ("value", "text", true, false)][..], &["key"][..]),
        ("_generations", &[("generation", "bigint", true, false), ("schema", "text", true, false), ("programs", "text", true, false), ("at", "bigint", true, false)][..], &["generation"][..]),
        ("_catalog", &[("name", "text", true, true), ("num", "bigint", true, false)][..], &["name"][..]),
    ] {
        shape::verify(tx, table, columns, primary, "SNAPBACK_ACTIVATION_SCHEMA")?;
    }
    tx.batch(r#"
        CREATE TABLE IF NOT EXISTS _generations (generation BIGINT PRIMARY KEY, schema TEXT NOT NULL, programs TEXT NOT NULL, at BIGINT NOT NULL);
        CREATE TABLE IF NOT EXISTS _catalog (name TEXT COLLATE "C" PRIMARY KEY, num BIGINT NOT NULL);
    "#)
}
