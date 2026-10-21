//! Structured, locale-independent attach checks for exact family relations.
// @ref LLP 3000.009.001.000#9.1 — durable relations cannot hide writes or defer key conflicts.
use super::store::Tx;
use crate::RuntimeError;
pub(super) type Column = (&'static str, &'static str, bool, bool);
fn incompatible(code: &str, table: &str, detail: &str) -> RuntimeError {
    RuntimeError::Store(format!("{code}: {table}: {detail}"))
}

pub(super) fn verify(
    tx: &Tx<'_>,
    table: &str,
    columns: &[Column],
    primary: &[&str],
    code: &str,
) -> Result<(), RuntimeError> {
    verify_unique(tx, table, columns, primary, &[], code)
}

pub(super) fn verify_unique(
    tx: &Tx<'_>,
    table: &str,
    columns: &[Column],
    primary: &[&str],
    unique: &[&[&str]],
    code: &str,
) -> Result<(), RuntimeError> {
    let relation = tx.query("SELECT relkind::text, relpersistence::text, relrowsecurity OR relforcerowsecurity, EXISTS(SELECT 1 FROM pg_rewrite WHERE ev_class=pg_class.oid AND rulename<>'_RETURN'), EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=pg_class.oid AND NOT tgisinternal), EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid=pg_class.oid OR inhparent=pg_class.oid) FROM pg_class WHERE oid=to_regclass($1)", &[&table])?;
    let Some(relation) = relation.first() else {
        return Ok(());
    };
    if relation.get::<_, &str>(0) != "r"
        || relation.get::<_, &str>(1) != "p"
        || (2..=5).any(|i| relation.get::<_, bool>(i))
    {
        return Err(incompatible(
            code,
            table,
            "expected a persistent ordinary table without row security, rules, triggers or inheritance",
        ));
    }
    let actual = tx.query("SELECT a.attname::text,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attcollation='pg_catalog.\"C\"'::regcollation,a.atthasdef,a.attgenerated::text,a.attidentity::text FROM pg_attribute a WHERE a.attrelid=to_regclass($1) AND a.attnum>0 AND NOT a.attisdropped", &[&table])?;
    if actual.len() != columns.len() {
        return Err(incompatible(code, table, "unexpected column set"));
    }
    for &(name, kind, not_null, byte_exact) in columns {
        let Some(column) = actual.iter().find(|r| r.get::<_, &str>(0) == name) else {
            return Err(incompatible(code, table, &format!("missing column {name}")));
        };
        if column.get::<_, &str>(1) != kind
            || column.get::<_, bool>(2) != not_null
            || (byte_exact && !column.get::<_, bool>(3))
            || column.get::<_, bool>(4)
            || !column.get::<_, &str>(5).is_empty()
            || !column.get::<_, &str>(6).is_empty()
        {
            return Err(incompatible(
                code,
                table,
                &format!("incompatible type, nullability, collation or default for {name}"),
            ));
        }
    }
    let keys = tx.query("SELECT c.contype::text,c.condeferrable,ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord) FROM pg_constraint c WHERE c.conrelid=to_regclass($1) AND c.contype<>'n'", &[&table])?;
    if keys.len() != 1 + unique.len()
        || keys.iter().any(|r| r.get::<_, bool>(1))
        || keys
            .iter()
            .filter(|r| r.get::<_, &str>(0) == "p" && r.get::<_, Vec<String>>(2) == primary)
            .count()
            != 1
        || unique.iter().any(|columns| {
            keys.iter()
                .filter(|r| r.get::<_, &str>(0) == "u" && r.get::<_, Vec<String>>(2) == *columns)
                .count()
                != 1
        })
    {
        return Err(incompatible(
            code,
            table,
            "expected only the declared immediate primary/unique keys",
        ));
    }
    let indexes = tx.query("SELECT i.indisprimary,i.indisvalid AND i.indisready,i.indpred IS NULL AND i.indexprs IS NULL AND i.indnatts=i.indnkeyatts,am.amname::text,NOT EXISTS(SELECT 1 FROM unnest(i.indkey,i.indcollation,i.indoption) k(attnum,coll,opts) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE k.coll<>a.attcollation OR k.opts<>0) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam WHERE i.indrelid=to_regclass($1) AND i.indisunique", &[&table])?;
    if indexes.len() != 1 + unique.len()
        || indexes.iter().filter(|r| r.get::<_, bool>(0)).count() != 1
        || indexes.iter().any(|r| {
            !r.get::<_, bool>(1)
                || !r.get::<_, bool>(2)
                || r.get::<_, &str>(3) != "btree"
                || !r.get::<_, bool>(4)
        })
    {
        return Err(incompatible(
            code,
            table,
            "incompatible primary or extra unique index",
        ));
    }
    Ok(())
}
