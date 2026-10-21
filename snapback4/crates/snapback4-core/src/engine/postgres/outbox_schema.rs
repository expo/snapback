//! Guarded attach-time upgrade of the evaluation outbox; no writer runs DDL.
// @ref LLP 3000.009.001.000#91-adapter-parity-rules — verify existing storage before upgrading under the head fence.
use super::store::Tx;
use crate::RuntimeError;

type Column = (&'static str, &'static str, bool);
const BASE: &[Column] = &[
    ("id", "text", true), ("seq", "bigint", true), ("effect", "text", true),
    ("payload", "text", true), ("state", "text", true), ("attempts", "bigint", true), ("at", "bigint", true),
];
const ADDED: &[Column] = &[
    ("lease_until", "bigint", false), ("claimed_by", "text", false), ("next_at", "bigint", false),
    ("result", "text", false), ("error", "text", false), ("settled_at", "bigint", false),
    ("work_spec", "text", false), ("deadline", "bigint", false), ("release", "text", false),
    ("error_code", "text", false), ("lease_digest", "text", false), ("cancelled", "boolean", true),
    ("contract", "text", false),
];
const PRESENCE: &[Column] = &[
    ("principal", "text", true), ("id", "text", true), ("deadline", "bigint", true), ("reconnected", "boolean", true),
];
const CREATE: &str = r#"
CREATE TABLE IF NOT EXISTS _outbox (
    id TEXT COLLATE "C" PRIMARY KEY, seq BIGINT NOT NULL, effect TEXT COLLATE "C" NOT NULL,
    payload TEXT NOT NULL, state TEXT NOT NULL, attempts BIGINT NOT NULL, at BIGINT NOT NULL,
    lease_until BIGINT, claimed_by TEXT COLLATE "C", next_at BIGINT, result TEXT, error TEXT,
    settled_at BIGINT, work_spec TEXT, deadline BIGINT, release TEXT, error_code TEXT,
    lease_digest TEXT, cancelled BOOLEAN NOT NULL DEFAULT FALSE, contract TEXT
);
CREATE TABLE IF NOT EXISTS _effect_presence (
    principal TEXT COLLATE "C" NOT NULL, id TEXT COLLATE "C" NOT NULL, deadline BIGINT NOT NULL,
    reconnected BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY(principal,id)
);
CREATE INDEX IF NOT EXISTS _outbox_due ON _outbox(state,effect,seq);
CREATE INDEX IF NOT EXISTS _effect_presence_id ON _effect_presence(id);
"#;

fn incompatible(table: &str, reason: &str) -> RuntimeError {
    RuntimeError::Store(format!("SNAPBACK_OUTBOX_SCHEMA: {table}: {reason}"))
}

// Return columns only after validating every existing constraint/default. Missing
// lifecycle columns are allowed, but the seven original columns are mandatory.
fn verify(tx: &Tx<'_>, table: &str, required: &[Column], optional: &[Column], primary: &[&str]) -> Result<Vec<String>, RuntimeError> {
    if !super::ledger_schema::verify_relation(tx, table, incompatible)? {
        return Ok(Vec::new());
    }
    let columns = tx.query("SELECT a.attname::text,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid),a.attgenerated::text,a.attidentity::text FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped", &[&table])?;
    for column in &columns {
        let name: &str = column.get(0);
        let Some(&(_, sql_type, not_null)) = required.iter().chain(optional).find(|c| c.0 == name) else { return Err(incompatible(table, "unexpected column")); };
        if column.get::<_, &str>(1) != sql_type || column.get::<_, bool>(2) != not_null || !column.get::<_, &str>(4).is_empty() || !column.get::<_, &str>(5).is_empty() {
            return Err(incompatible(table, &format!("incompatible column {name}")));
        }
        let default: Option<&str> = column.get(3);
        let expected = if matches!(name, "cancelled" | "reconnected") { Some("false") } else { None };
        if default != expected { return Err(incompatible(table, &format!("incompatible default for {name}"))); }
    }
    for &(name, _, _) in required {
        if !columns.iter().any(|c| c.get::<_, &str>(0) == name) { return Err(incompatible(table, &format!("missing column {name}"))); }
    }
    let keys = tx.query("SELECT c.contype::text,c.condeferrable,ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num ORDER BY k.ord),c.confrelid = to_regclass('_commits'),ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.num ORDER BY k.ord),NOT c.condeferrable AND c.convalidated AND c.confupdtype = 'a' AND c.confdeltype = 'a' AND c.confmatchtype = 's' FROM pg_constraint c WHERE c.conrelid = to_regclass($1) AND c.contype<>'n'", &[&table])?;
    let mut primaries = 0;
    for key in keys {
        let kind: &str = key.get(0);
        let columns: Vec<String> = key.get(2);
        if kind == "p" && !key.get::<_, bool>(1) && columns == primary { primaries += 1; }
        else if !(table == "_outbox" && kind == "f" && columns == ["seq"] && key.get::<_, bool>(3) && key.get::<_, Vec<String>>(4) == ["seq"] && key.get::<_, bool>(5)) {
            return Err(incompatible(table, "unexpected constraint"));
        }
    }
    if primaries != 1 { return Err(incompatible(table, "missing immediate primary key")); }
    if tx.query("SELECT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid = to_regclass($1) AND i.indisunique AND NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid AND c.contype = 'p'))", &[&table])?[0].get::<_, bool>(0) {
        return Err(incompatible(table, "unexpected unique index"));
    }
    Ok(columns.iter().map(|c| c.get(0)).collect())
}

fn verify_index(tx: &Tx<'_>, table: &str, index: &str, columns: &[&str]) -> Result<(), RuntimeError> {
    let rows = tx.query("SELECT COALESCE(i.indrelid = to_regclass($1),false),am.amname::text,i.indisunique,i.indisvalid AND i.indisready,i.indpred IS NULL AND i.indexprs IS NULL AND i.indnatts = i.indnkeyatts,ARRAY(SELECT pg_get_indexdef(i.indexrelid,k,true) FROM generate_series(1,i.indnkeyatts) k),NOT EXISTS(SELECT 1 FROM unnest(i.indkey,i.indcollation,i.indoption) k(num,coll,opts) JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.num WHERE k.coll <> a.attcollation OR k.opts <> 0) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_am am ON am.oid = c.relam WHERE i.indexrelid = to_regclass($2)", &[&table, &index])?;
    if let Some(row) = rows.first() {
        if !row.get::<_, bool>(0) || row.get::<_, &str>(1) != "btree" || row.get::<_, bool>(2) || !row.get::<_, bool>(3) || !row.get::<_, bool>(4) || row.get::<_, Vec<String>>(5) != columns || !row.get::<_, bool>(6) {
            return Err(incompatible(table, &format!("incompatible index {index}")));
        }
    } else if tx.query("SELECT to_regclass($1) IS NOT NULL", &[&index])?[0].get::<_, bool>(0) {
        return Err(incompatible(table, &format!("{index} is not an index")));
    }
    Ok(())
}

pub(super) fn install(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    let columns = verify(tx, "_outbox", BASE, ADDED, &["id"])?;
    verify(tx, "_effect_presence", PRESENCE, &[], &["principal", "id"])?;
    verify_index(tx, "_outbox", "_outbox_due", &["state", "effect", "seq"])?;
    verify_index(tx, "_effect_presence", "_effect_presence_id", &["id"])?;
    if !columns.is_empty() {
        for &(name, kind, _) in ADDED {
            if !columns.iter().any(|c| c == name) {
                let definition = match name {
                    "cancelled" => "boolean NOT NULL DEFAULT FALSE",
                    "claimed_by" => "text COLLATE \"C\"",
                    _ => kind,
                };
                tx.batch(&format!("ALTER TABLE _outbox ADD COLUMN {name} {definition}"))?;
            }
        }
        // The evaluation-only commit FK is stricter than SQLite's port. Remove
        // only the recognized seq -> _commits(seq) constraint, after validation.
        for row in tx.query("SELECT conname::text FROM pg_constraint WHERE conrelid = '_outbox'::regclass AND contype = 'f'", &[])? {
            let name: &str = row.get(0);
            tx.batch(&format!("ALTER TABLE _outbox DROP CONSTRAINT \"{}\"", name.replace('"', "\"\"")))?;
        }
    }
    // Legacy evaluation keys used the database collation. Normalize only on
    // upgrade; a reopen of the installed shape performs no ALTER statements.
    for (table, column) in [("_outbox", "id"), ("_outbox", "effect"), ("_outbox", "claimed_by"), ("_effect_presence", "principal"), ("_effect_presence", "id")] {
        let rows = tx.query("SELECT attcollation = 'pg_catalog.\"C\"'::regcollation FROM pg_attribute WHERE attrelid = to_regclass($1) AND attname = $2 AND NOT attisdropped", &[&table, &column])?;
        if rows.first().is_some_and(|r| !r.get::<_, bool>(0)) {
            if table != "_outbox" || columns.len() == BASE.len() + ADDED.len() {
                return Err(incompatible(table, &format!("incompatible collation for {column}")));
            }
            tx.batch(&format!("ALTER TABLE {table} ALTER COLUMN {column} TYPE text COLLATE \"C\""))?;
        }
    }
    tx.batch(CREATE)?;
    Ok(())
}
