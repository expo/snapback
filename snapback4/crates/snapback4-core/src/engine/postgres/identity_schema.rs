//! Attach refuses incompatible identity storage before issuing installation DDL.
// @ref LLP 3000.009.001.000#33-extraction-first-with-no-behavior-change — identity keys retain byte-exact comparison.
use super::store::Tx;
use crate::RuntimeError;

// (name, SQL type, NOT NULL, byte-exact collation). Column order is immaterial.
type Column = (&'static str, &'static str, bool, bool);

pub(super) fn verify_existing(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    for (table, columns, primary) in [
        (
            "_principals",
            &[
                ("id", "text", true, true),
                ("kind", "text", true, false),
                ("name", "text", false, false),
                ("created_at", "bigint", true, false),
            ][..],
            &["id"][..],
        ),
        (
            "_credentials",
            &[
                ("principal", "text", true, true),
                ("email", "text", true, true),
                ("hash", "text", true, false),
            ][..],
            &["principal"][..],
        ),
        (
            "_session_mint_bindings",
            &[
                ("invocation", "text", true, true),
                ("intent", "text", true, true),
                ("input_digest", "text", true, false),
                ("principal", "text", true, true),
                ("kind", "text", true, false),
                ("days", "bigint", true, false),
                ("expires_at", "bigint", true, false),
                ("family", "text", true, true),
                ("principal_generation", "bigint", true, false),
                ("scope", "text", true, false),
            ][..],
            &["invocation", "intent"][..],
        ),
        (
            "_read_sessions",
            &[
                ("token_digest", "text", true, true),
                ("principal", "text", true, true),
                ("kind", "text", true, false),
                ("family", "text", true, true),
                ("created_at", "bigint", true, false),
                ("expires_at", "bigint", true, false),
                ("cap_expires_at", "bigint", true, false),
                ("principal_generation", "bigint", true, false),
            ][..],
            &["token_digest"][..],
        ),
        (
            "_sessions",
            &[
                ("token_digest", "text", true, true),
                ("principal", "text", true, true),
                ("kind", "text", true, false),
                ("created_at", "bigint", true, false),
                ("expires_at", "bigint", true, false),
                ("family", "text", false, true),
            ][..],
            &["token_digest"][..],
        ),
        (
            "_principal_generations",
            &[
                ("principal", "text", true, true),
                ("generation", "bigint", true, false),
            ][..],
            &["principal"][..],
        ),
        (
            "_meta",
            &[("key", "text", true, true), ("value", "text", true, false)][..],
            &["key"][..],
        ),
    ] {
        verify_table(tx, table, columns, primary)?;
    }
    Ok(())
}

fn incompatible(table: &str, detail: &str) -> RuntimeError {
    RuntimeError::Store(format!("SNAPBACK_IDENTITY_SCHEMA: {table}: {detail}"))
}

fn verify_table(
    tx: &Tx<'_>,
    table: &str,
    columns: &[Column],
    primary: &[&str],
) -> Result<(), RuntimeError> {
    let relation = tx.query(
        "SELECT relkind::text FROM pg_class WHERE oid = to_regclass($1)",
        &[&table],
    )?;
    let Some(relation) = relation.first() else {
        return Ok(());
    };
    if relation.get::<_, &str>(0) != "r" {
        return Err(incompatible(table, "expected an ordinary table"));
    }
    let actual = tx.query(
        "SELECT a.attname::text, format_type(a.atttypid,a.atttypmod), a.attnotnull,
         a.attcollation = 'pg_catalog.\"C\"'::regcollation FROM pg_attribute a
         WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped",
        &[&table],
    )?;
    if actual.len() != columns.len() {
        return Err(incompatible(table, "unexpected column set"));
    }
    for &(name, sql_type, not_null, byte_exact) in columns {
        let Some(column) = actual.iter().find(|r| r.get::<_, &str>(0) == name) else {
            return Err(incompatible(table, &format!("missing column {name}")));
        };
        if column.get::<_, &str>(1) != sql_type
            || column.get::<_, bool>(2) != not_null
            || (byte_exact && !column.get::<_, bool>(3))
        {
            return Err(incompatible(
                table,
                &format!("incompatible type, nullability or collation for {name}"),
            ));
        }
    }
    let keys = tx.query(
        "SELECT c.contype::text, ARRAY(SELECT a.attname::text
         FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.ord)
         FROM pg_constraint c WHERE c.conrelid = to_regclass($1) AND c.contype IN ('p','u')",
        &[&table],
    )?;
    if !keys
        .iter()
        .any(|r| r.get::<_, &str>(0) == "p" && r.get::<_, Vec<String>>(1) == primary)
    {
        return Err(incompatible(table, "incompatible primary key"));
    }
    if table == "_credentials"
        && !keys
            .iter()
            .any(|r| r.get::<_, &str>(0) == "u" && r.get::<_, Vec<String>>(1) == ["email"])
    {
        return Err(incompatible(table, "missing unique email constraint"));
    }
    Ok(())
}
