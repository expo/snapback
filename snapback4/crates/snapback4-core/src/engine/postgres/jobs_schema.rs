//! Refuse incompatible jobs tables at attach, while holding the shared head.
// @ref LLP 3000.009.001.000#9.1 — installation happens once; prepared readers tolerate additive columns.
use super::store::Tx;
use crate::RuntimeError;

pub(super) fn verify_existing(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    if !super::ledger_schema::verify_relation(tx, "_jobs", |_, detail| incompatible(detail))? {
        return Ok(());
    }
    let actual = tx.query(
        "SELECT a.attname::text,format_type(a.atttypid,a.atttypmod),a.attnotnull,
         a.attcollation='pg_catalog.\"C\"'::regcollation,a.attidentity::text,
         pg_get_expr(d.adbin,d.adrelid)
         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
         WHERE a.attrelid=to_regclass('_jobs') AND a.attnum>0 AND NOT a.attisdropped",
        &[],
    )?;
    for (name, sql_type, not_null) in [
        ("id", "text", true),
        ("name", "text", true),
        ("args", "text", true),
        ("program_hash", "text", true),
        ("state", "text", true),
        ("sweep", "bigint", true),
        ("cursor", "bytea", false),
        ("upper", "bytea", false),
        ("chunks", "bigint", true),
        ("rows_written", "bigint", true),
        ("created_at", "bigint", true),
        ("updated_at", "bigint", true),
        ("error", "bytea", false),
        ("chunk_size", "bigint", true),
        ("retries", "bigint", true),
        ("heap_peak", "bigint", true),
        ("domain", "text", false),
        ("insertion_order", "bigint", true),
    ] {
        let Some(column) = actual.iter().find(|r| r.get::<_, &str>(0) == name) else {
            return Err(incompatible(&format!("missing column {name}")));
        };
        if column.get::<_, &str>(1) != sql_type
            || column.get::<_, bool>(2) != not_null
            || (name == "id" && !column.get::<_, bool>(3))
            || (name == "insertion_order" && column.get::<_, &str>(4) != "a")
            || (["chunk_size", "retries", "heap_peak"].contains(&name)
                && column.get::<_, Option<&str>>(5) != Some("0"))
        {
            return Err(incompatible(&format!(
                "incompatible column {name}: expected {sql_type}"
            )));
        }
    }
    let keys = tx.query(
        "SELECT c.contype::text,c.condeferrable,ARRAY(SELECT a.attname::text
         FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
         JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord)
         FROM pg_constraint c WHERE c.conrelid=to_regclass('_jobs') AND c.contype IN ('p','u')",
        &[],
    )?;
    if keys.len() != 1
        || keys[0].get::<_, &str>(0) != "p"
        || keys[0].get::<_, bool>(1)
        || keys[0].get::<_, Vec<String>>(2) != ["id"]
    {
        return Err(incompatible("expected nondeferrable id primary key"));
    }
    Ok(())
}
fn incompatible(detail: &str) -> RuntimeError {
    RuntimeError::Store(format!("SNAPBACK_JOBS_SCHEMA: _jobs: {detail}"))
}
