//! Relation-level attach checks shared by the durable ledger families.
// @ref LLP 3000.009.001.000#9.1 — inherited rows bypass parent keys; attach refuses the whole hierarchy.
use super::store::Tx;
use crate::RuntimeError;

/// Return whether the relation exists, after refusing unsafe table shapes.
pub(super) fn verify_relation(
    tx: &Tx<'_>,
    table: &str,
    incompatible: impl Fn(&str, &str) -> RuntimeError,
) -> Result<bool, RuntimeError> {
    let rows = tx.query(
        "SELECT relkind::text, relpersistence::text,
         relrowsecurity OR relforcerowsecurity,
         EXISTS(SELECT 1 FROM pg_rewrite WHERE ev_class=pg_class.oid AND rulename<>'_RETURN'),
         EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=pg_class.oid AND NOT tgisinternal),
         EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid=pg_class.oid OR inhparent=pg_class.oid)
         FROM pg_class WHERE oid=to_regclass($1)",
        &[&table],
    )?;
    let Some(row) = rows.first() else {
        return Ok(false);
    };
    if row.get::<_, &str>(0) != "r" || row.get::<_, bool>(5) {
        return Err(incompatible(
            table,
            "expected an ordinary table without inheritance or partitioning",
        ));
    }
    if row.get::<_, &str>(1) != "p" || (2..=4).any(|i| row.get::<_, bool>(i)) {
        return Err(incompatible(
            table,
            "expected a persistent table without row security, rules or triggers",
        ));
    }
    Ok(true)
}
