//! Generation history and catalog installation belongs to fenced attach.
// @ref LLP 3000.009.001.000#9.1 — no relation DDL in an activation writer.
use super::{shape, store::Tx};
use crate::RuntimeError;

pub(super) fn initialize(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    for (table, columns, primary) in [
        (
            "_generations",
            &[
                ("generation", "bigint", true, false),
                ("schema", "text", true, false),
                ("programs", "text", true, false),
                ("at", "bigint", true, false),
            ][..],
            &["generation"][..],
        ),
        (
            "_catalog",
            &[("name", "text", true, true), ("num", "bigint", true, false)][..],
            &["name"][..],
        ),
    ] {
        let unique: &[&[&str]] = if table == "_catalog" {
            &[&["num"]]
        } else {
            &[]
        };
        shape::verify_unique(
            tx,
            table,
            columns,
            primary,
            unique,
            "SNAPBACK_ACTIVATION_SCHEMA",
        )?;
    }
    tx.batch(r#"
        CREATE TABLE IF NOT EXISTS _generations (generation BIGINT PRIMARY KEY, schema TEXT NOT NULL, programs TEXT NOT NULL, at BIGINT NOT NULL);
        CREATE TABLE IF NOT EXISTS _catalog (name TEXT COLLATE "C" PRIMARY KEY, num BIGINT NOT NULL UNIQUE);
    "#)
}

/// These core relations are touched by opening upgrades or their rebuilds.
/// Other durable families validate their relations in their attach installers.
pub(super) fn verify_core(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    // Preserve the foundation family's refusal when its commit ledger and the
    // referencing log are both unsafe: a logged log cannot reference unlogged commits.
    super::ledger_schema::verify_relation(tx, "_commits", |table, detail| {
        RuntimeError::Store(format!("SNAPBACK_FOUNDATION_SCHEMA: {table}: {detail}"))
    })?;
    for table in [
        "_backend",
        "_head",
        "r",
        "i",
        "_log",
        "_sequences",
        "_cap_counts",
    ] {
        super::ledger_schema::verify_relation(tx, table, |table, detail| {
            RuntimeError::Store(format!("SNAPBACK_ACTIVATION_SCHEMA: {table}: {detail}"))
        })?;
    }
    Ok(())
}

/// Recheck ledgers under the activation's head fence: owner DDL may have
/// changed them since open. This checks catalogs without installing any DDL.
// @ref LLP 3000.009.001.000#3.3 — activation re-verifies its ledgers before preparation writes.
pub(super) fn verify_activation(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    verify_core(tx)?;
    for table in [
        "_meta",
        "_generations",
        "_catalog",
        "_release_events",
        "_release_event_items",
    ] {
        super::ledger_schema::verify_relation(tx, table, |table, detail| {
            RuntimeError::Store(format!("SNAPBACK_ACTIVATION_SCHEMA: {table}: {detail}"))
        })?;
    }
    Ok(())
}
