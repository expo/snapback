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
    for (table, index, columns) in [
        ("_sessions", "_sessions_expiry", &["expires_at"][..]),
        (
            "_sessions",
            "_sessions_family",
            &["principal", "family", "expires_at"][..],
        ),
        (
            "_read_sessions",
            "_read_sessions_family",
            &["principal", "family", "expires_at"][..],
        ),
    ] {
        verify_index(tx, table, index, columns)?;
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
    if !super::ledger_schema::verify_relation(tx, table, incompatible)? {
        return Ok(());
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
         , c.condeferrable FROM pg_constraint c WHERE c.conrelid = to_regclass($1) AND c.contype IN ('p','u')",
        &[&table],
    )?;
    // ON CONFLICT cannot arbitrate a deferrable constraint, even INITIALLY
    // IMMEDIATE. Extra uniqueness also changes insert-ignore/conflict outcomes.
    if keys.iter().any(|r| r.get::<_, bool>(2)) {
        return Err(incompatible(table, "deferrable primary/unique constraint"));
    }
    if keys.len() != if table == "_credentials" { 2 } else { 1 } {
        return Err(incompatible(table, "unexpected primary/unique constraints"));
    }
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
    let extra_unique = tx.query(
        "SELECT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid = to_regclass($1)
         AND i.indisunique AND NOT EXISTS(SELECT 1 FROM pg_constraint c
         WHERE c.conindid = i.indexrelid AND c.contype IN ('p','u')))",
        &[&table],
    )?[0]
        .get::<_, bool>(0);
    if extra_unique {
        return Err(incompatible(table, "unexpected unique index"));
    }
    if table == "_session_mint_bindings" {
        let default = tx.query(
            "SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attrdef d
             JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
             WHERE d.adrelid = to_regclass($1) AND a.attname = 'scope'",
            &[&table],
        )?;
        if default.first().map(|r| r.get::<_, String>(0)).as_deref() != Some("'full'::text") {
            return Err(incompatible(table, "scope must default to 'full'"));
        }
    }
    Ok(())
}

fn verify_index(
    tx: &Tx<'_>,
    table: &str,
    index: &str,
    columns: &[&str],
) -> Result<(), RuntimeError> {
    let rows = tx.query(
        "SELECT i.indrelid = to_regclass($1), am.amname::text,
         i.indisunique, i.indisvalid AND i.indisready,
         i.indpred IS NULL AND i.indexprs IS NULL AND i.indnatts = i.indnkeyatts,
         ARRAY(SELECT pg_get_indexdef(i.indexrelid,k,true) FROM generate_series(1,i.indnkeyatts) k),
         NOT EXISTS(SELECT 1 FROM unnest(i.indkey,i.indcollation,i.indoption) k(attnum,coll,opts)
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
             WHERE k.coll <> a.attcollation OR k.opts <> 0)
         FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
         JOIN pg_am am ON am.oid = c.relam WHERE i.indexrelid = to_regclass($2)",
        &[&table, &index],
    )?;
    let Some(row) = rows.first() else {
        // Missing indexes are installed at attach; a same-name non-index must
        // not survive CREATE INDEX IF NOT EXISTS either.
        if tx.query("SELECT to_regclass($1) IS NOT NULL", &[&index])?[0].get::<_, bool>(0) {
            return Err(incompatible(table, &format!("{index} is not an index")));
        }
        return Ok(());
    };
    if !row.get::<_, bool>(0)
        || row.get::<_, &str>(1) != "btree"
        || row.get::<_, bool>(2)
        || !row.get::<_, bool>(3)
        || !row.get::<_, bool>(4)
        || row.get::<_, Vec<String>>(5) != columns
        || !row.get::<_, bool>(6)
    {
        return Err(incompatible(table, &format!("incompatible index {index}")));
    }
    Ok(())
}
