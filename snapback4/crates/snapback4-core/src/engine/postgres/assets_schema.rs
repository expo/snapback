//! Attach-only installation and shape checks for the asset ledger.
// @ref LLP 3000.009.001.000#9.1 — no DDL in writers; incompatible existing storage refuses by name.
use super::store::Tx;
use crate::RuntimeError;

// name, type, NOT NULL, C collation. SQLite's nullable rowid TEXT primary
// key on _assets is never written NULL by the typed port; Postgres keys aren't nullable.
type Column = (&'static str, &'static str, bool, bool);
const TABLES: &[(&str, &[Column], &[&str])] = &[
    (
        "_assets",
        &[
            ("id", "text", true, true),
            ("owner", "text", true, true),
            ("kind", "text", true, false),
            ("content_type", "text", true, false),
            ("bytes", "bigint", true, false),
            ("width", "bigint", false, false),
            ("height", "bigint", false, false),
            ("duration", "bigint", false, false),
            ("created_at", "bigint", true, false),
            ("home_table", "text", false, true),
            ("home_id", "text", false, true),
            ("home_column", "text", false, true),
            ("released_at", "bigint", false, false),
            ("name", "text", false, false),
        ],
        &["id"],
    ),
    (
        "_asset_intents",
        &[
            ("owner", "text", true, true),
            ("intent", "text", true, true),
            ("fingerprint", "text", false, false),
            ("asset", "text", false, true),
            ("facts", "text", false, false),
            ("placement", "text", false, false),
            ("state", "text", true, false),
        ],
        &["owner", "intent"],
    ),
    (
        "_asset_views",
        &[
            ("asset", "text", true, true),
            ("principal", "text", true, true),
            ("at", "bigint", true, false),
        ],
        &["asset", "principal"],
    ),
    ("_asset_gc", &[("asset", "text", true, true)], &["asset"]),
];
const DDL: &str = r#"
CREATE TABLE IF NOT EXISTS _assets (
    id TEXT COLLATE "C" PRIMARY KEY, owner TEXT COLLATE "C" NOT NULL,
    kind TEXT NOT NULL, content_type TEXT NOT NULL, bytes BIGINT NOT NULL,
    width BIGINT, height BIGINT, duration BIGINT, created_at BIGINT NOT NULL,
    home_table TEXT COLLATE "C", home_id TEXT COLLATE "C", home_column TEXT COLLATE "C",
    released_at BIGINT, name TEXT
);
CREATE TABLE IF NOT EXISTS _asset_intents (
    owner TEXT COLLATE "C" NOT NULL, intent TEXT COLLATE "C" NOT NULL,
    fingerprint TEXT, asset TEXT COLLATE "C", facts TEXT, placement TEXT, state TEXT NOT NULL,
    PRIMARY KEY(owner,intent)
);
CREATE TABLE IF NOT EXISTS _asset_views (
    asset TEXT COLLATE "C" NOT NULL, principal TEXT COLLATE "C" NOT NULL, at BIGINT NOT NULL,
    PRIMARY KEY(asset,principal)
);
CREATE TABLE IF NOT EXISTS _asset_gc (asset TEXT COLLATE "C" PRIMARY KEY);
"#;

fn incompatible(table: &str, detail: &str) -> RuntimeError {
    RuntimeError::Store(format!("SNAPBACK_ASSET_SCHEMA: {table}: {detail}"))
}

pub(super) fn initialize(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    for &(table, columns, primary) in TABLES {
        verify(tx, table, columns, primary)?;
    }
    tx.batch(DDL)
}

fn verify(
    tx: &Tx<'_>,
    table: &str,
    columns: &[Column],
    primary: &[&str],
) -> Result<(), RuntimeError> {
    if !super::ledger_schema::verify_relation(tx, table, incompatible)? {
        return Ok(());
    }
    let actual = tx.query("SELECT a.attname::text,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attcollation='pg_catalog.\"C\"'::regcollation,a.atthasdef,a.attgenerated::text,a.attidentity::text FROM pg_attribute a WHERE a.attrelid=to_regclass($1) AND a.attnum>0 AND NOT a.attisdropped", &[&table])?;
    if actual.len() != columns.len() {
        return Err(incompatible(table, "unexpected column set"));
    }
    for &(name, kind, not_null, byte_exact) in columns {
        let Some(column) = actual.iter().find(|r| r.get::<_, &str>(0) == name) else {
            return Err(incompatible(table, &format!("missing column {name}")));
        };
        if column.get::<_, &str>(1) != kind
            || column.get::<_, bool>(2) != not_null
            || (byte_exact && !column.get::<_, bool>(3))
            || column.get::<_, bool>(4)
            || !column.get::<_, &str>(5).is_empty()
            || !column.get::<_, &str>(6).is_empty()
        {
            return Err(incompatible(
                table,
                &format!("incompatible type, nullability, collation or default for {name}"),
            ));
        }
    }
    let keys = tx.query("SELECT c.contype::text,c.condeferrable,ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord) FROM pg_constraint c WHERE c.conrelid=to_regclass($1) AND c.contype<>'n'", &[&table])?;
    if keys.len() != 1
        || keys[0].get::<_, &str>(0) != "p"
        || keys[0].get::<_, bool>(1)
        || keys[0].get::<_, Vec<String>>(2) != primary
    {
        return Err(incompatible(
            table,
            "expected only the immediate primary key",
        ));
    }
    let indexes = tx.query("SELECT i.indisprimary,i.indisvalid AND i.indisready,i.indpred IS NULL AND i.indexprs IS NULL AND i.indnatts=i.indnkeyatts,am.amname::text,NOT EXISTS(SELECT 1 FROM unnest(i.indkey,i.indcollation,i.indoption) k(attnum,coll,opts) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE k.coll<>a.attcollation OR k.opts<>0) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam WHERE i.indrelid=to_regclass($1) AND i.indisunique", &[&table])?;
    if indexes.len() != 1
        || !indexes[0].get::<_, bool>(0)
        || !indexes[0].get::<_, bool>(1)
        || !indexes[0].get::<_, bool>(2)
        || indexes[0].get::<_, &str>(3) != "btree"
        || !indexes[0].get::<_, bool>(4)
    {
        return Err(incompatible(
            table,
            "incompatible primary or extra unique index",
        ));
    }
    Ok(())
}
