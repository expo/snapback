//! The SQLite store. Two generic tables carry every application table: `r`
//! holds row images by (table number, id) and `i` holds every index entry as
//! one order-preserving key (`key.rs`) so a prefix scan, a point lookup and
//! a cursor position are all one B-tree range. The rest is the engine's own
//! bookkeeping: the catalog of table and index numbers, commits, the
//! partition log, applied operation ids, principals, sessions, generations.

use crate::error::RuntimeError;
use crate::key;
use crate::schema::{Index, Schema, Table};
use crate::value::{Value, canonical_json};
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::BTreeMap;
use std::path::Path;

const STORE_VERSION: &str = "snapback4-store-1";

pub struct Store {
    conn: Connection,
    catalog: BTreeMap<String, i64>,
}

/// One transaction over the store, with the catalog in reach.
pub struct Tx<'a> {
    tx: rusqlite::Transaction<'a>,
    catalog: &'a BTreeMap<String, i64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dir {
    Asc,
    Desc,
}

/// Bounds on the components after a scan prefix (`after` a cursor position,
/// or a value range on the first free component).
#[derive(Clone, Debug, Default)]
pub struct Bounds {
    /// Resume strictly after this suffix position.
    pub after: Option<Vec<Value>>,
    /// Stop strictly before this suffix position.
    pub before: Option<Vec<Value>>,
    pub gt: Option<Value>,
    pub gte: Option<Value>,
    pub lt: Option<Value>,
    pub lte: Option<Value>,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, RuntimeError> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;")?;
        Self::prepare(conn)
    }

    pub fn memory() -> Result<Self, RuntimeError> {
        Self::prepare(Connection::open_in_memory()?)
    }

    fn prepare(conn: Connection) -> Result<Self, RuntimeError> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS _catalog (name TEXT PRIMARY KEY, num INTEGER NOT NULL UNIQUE);
             CREATE TABLE IF NOT EXISTS r (t INTEGER NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (t, id)) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS i (ti INTEGER NOT NULL, k BLOB NOT NULL, id TEXT NOT NULL, PRIMARY KEY (ti, k)) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS _commits (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, program TEXT NOT NULL, principal TEXT NOT NULL, kind TEXT NOT NULL, touched TEXT NOT NULL, writes INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS _log (partition TEXT NOT NULL, seq INTEGER NOT NULL, ord INTEGER NOT NULL, t TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT, PRIMARY KEY (partition, seq, ord)) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS _ops (principal TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, outcome TEXT NOT NULL, PRIMARY KEY (principal, id)) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS _principals (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT, created_at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS _sessions (token_digest TEXT PRIMARY KEY, principal TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS _credentials (principal TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, hash TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS _generations (generation INTEGER PRIMARY KEY, schema TEXT NOT NULL, programs TEXT NOT NULL, at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS _outbox (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, effect TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL, at INTEGER NOT NULL);",
        )?;
        let version: Option<String> = conn.query_row("SELECT value FROM _meta WHERE key = 'version'", [], |row| row.get(0)).optional()?;
        match version.as_deref() {
            None => {
                conn.execute("INSERT INTO _meta(key, value) VALUES ('version', ?1)", [STORE_VERSION])?;
            }
            Some(STORE_VERSION) => {}
            Some(other) => return Err(RuntimeError::Store(format!("store version {other} is not {STORE_VERSION}; this data directory belongs to another Snapback"))),
        }
        let mut catalog = BTreeMap::new();
        let mut statement = conn.prepare("SELECT name, num FROM _catalog")?;
        for row in statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))? {
            let (name, num) = row?;
            catalog.insert(name, num);
        }
        drop(statement);
        Ok(Self { conn, catalog })
    }

    /// Give every table and index a number; build the entries of any index
    /// that is new or whose definition changed. Idempotent.
    pub fn install(&mut self, schema: &Schema) -> Result<(), RuntimeError> {
        let tx = self.conn.transaction()?;
        let mut next: i64 = tx.query_row("SELECT COALESCE(MAX(num), 0) + 1 FROM _catalog", [], |row| row.get(0))?;
        let mut rebuild = Vec::new();
        for (table_name, table) in &schema.tables {
            if !self.catalog.contains_key(table_name) {
                tx.execute("INSERT INTO _catalog(name, num) VALUES (?1, ?2)", params![table_name, next])?;
                self.catalog.insert(table_name.clone(), next);
                next += 1;
            }
            for (index_name, index) in &table.indexes {
                let full = format!("{table_name}.{index_name}");
                let definition = canonical_json(&index.columns());
                let meta_key = format!("index:{full}");
                let stored: Option<String> = tx.query_row("SELECT value FROM _meta WHERE key = ?1", [&meta_key], |row| row.get(0)).optional()?;
                if !self.catalog.contains_key(&full) {
                    tx.execute("INSERT INTO _catalog(name, num) VALUES (?1, ?2)", params![full, next])?;
                    self.catalog.insert(full.clone(), next);
                    next += 1;
                }
                if stored.as_deref() != Some(definition.as_str()) {
                    tx.execute("INSERT INTO _meta(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![meta_key, definition])?;
                    rebuild.push((table_name.clone(), index_name.clone(), index.clone()));
                }
            }
        }
        for (table_name, index_name, index) in rebuild {
            let t = self.catalog[&table_name];
            let ti = self.catalog[&format!("{table_name}.{index_name}")];
            tx.execute("DELETE FROM i WHERE ti = ?1", [ti])?;
            let mut rows = tx.prepare("SELECT id, data FROM r WHERE t = ?1")?;
            let entries: Vec<(String, String)> = rows.query_map([t], |row| Ok((row.get(0)?, row.get(1)?)))?.collect::<Result<_, _>>()?;
            drop(rows);
            for (id, data) in entries {
                let row: Value = serde_json::from_str(&data).map_err(|e| RuntimeError::Store(e.to_string()))?;
                tx.execute("INSERT INTO i(ti, k, id) VALUES (?1, ?2, ?3)", params![ti, index_key(&index, &row, &id), id])?;
            }
        }
        tx.execute("INSERT INTO _meta(key, value) VALUES ('schema_hash', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [schema.hash()])?;
        tx.commit()?;
        Ok(())
    }

    pub fn transaction(&mut self) -> Result<Tx<'_>, RuntimeError> {
        Ok(Tx { tx: self.conn.transaction()?, catalog: &self.catalog })
    }

    pub fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        Ok(self.conn.query_row("SELECT value FROM _meta WHERE key = ?1", [key], |row| row.get(0)).optional()?)
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<(), RuntimeError> {
        self.conn.execute("INSERT INTO _meta(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, value])?;
        Ok(())
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    /// The last committed sequence number.
    pub fn seq(&self) -> Result<u64, RuntimeError> {
        Ok(self.conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM _commits", [], |row| row.get::<_, i64>(0))? as u64)
    }

    /// Every row of a table, for fixtures, `data`, and tests.
    pub fn rows(&self, table: &str) -> Result<Vec<Value>, RuntimeError> {
        let Some(t) = self.catalog.get(table) else { return Ok(Vec::new()) };
        let mut statement = self.conn.prepare("SELECT data FROM r WHERE t = ?1 ORDER BY id")?;
        let rows = statement.query_map([t], |row| row.get::<_, String>(0))?;
        rows.map(|data| serde_json::from_str(&data?).map_err(|e| RuntimeError::Store(e.to_string()))).collect()
    }

    /// How many client-minted operation ids have been applied (sent or failed).
    pub fn applied_ops(&self) -> Result<u64, RuntimeError> {
        Ok(self.conn.query_row("SELECT COUNT(*) FROM _ops WHERE outcome LIKE '%\"state\":\"sent\"%'", [], |row| row.get::<_, i64>(0))? as u64)
    }

    pub fn count(&self, table: &str) -> Result<u64, RuntimeError> {
        let Some(t) = self.catalog.get(table) else { return Ok(0) };
        Ok(self.conn.query_row("SELECT COUNT(*) FROM r WHERE t = ?1", [t], |row| row.get::<_, i64>(0))? as u64)
    }
}

/// The stored key of one index entry: the components, then the id.
pub fn index_key(index: &Index, row: &Value, id: &str) -> Vec<u8> {
    let mut components = index_values(index, row);
    components.push(Value::Id(id.to_owned()));
    key::encode(&components)
}

/// The index's component values from a row image; absent optionals are null.
pub fn index_values(index: &Index, row: &Value) -> Vec<Value> {
    index.columns().iter().map(|column| row.field(column).cloned().unwrap_or(Value::Null)).collect()
}

impl<'a> Tx<'a> {
    pub fn conn(&self) -> &Connection {
        &self.tx
    }

    pub fn commit(self) -> Result<(), RuntimeError> {
        self.tx.commit()?;
        Ok(())
    }

    pub fn rollback(self) -> Result<(), RuntimeError> {
        self.tx.rollback()?;
        Ok(())
    }

    /// A savepoint, so a program can roll back its own writes and keep the
    /// enclosing bookkeeping (a refused mutation still records its outcome).
    pub fn savepoint(&self, name: &str) -> Result<(), RuntimeError> {
        self.tx.execute_batch(&format!("SAVEPOINT {name}"))?;
        Ok(())
    }

    pub fn release(&self, name: &str) -> Result<(), RuntimeError> {
        self.tx.execute_batch(&format!("RELEASE {name}"))?;
        Ok(())
    }

    pub fn rollback_to(&self, name: &str) -> Result<(), RuntimeError> {
        self.tx.execute_batch(&format!("ROLLBACK TO {name}; RELEASE {name}"))?;
        Ok(())
    }

    fn num(&self, name: &str) -> Result<i64, RuntimeError> {
        self.catalog.get(name).copied().ok_or_else(|| RuntimeError::Schema(format!("{name} is not installed in this store")))
    }

    pub fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        let t = self.num(table)?;
        let data: Option<String> = self.tx.query_row("SELECT data FROM r WHERE t = ?1 AND id = ?2", params![t, id], |row| row.get(0)).optional()?;
        data.map(|data| serde_json::from_str(&data).map_err(|e| RuntimeError::Store(e.to_string()))).transpose()
    }

    /// The first row whose index components equal `key` exactly, with the
    /// number of entries examined (one, or zero).
    pub fn lookup(&self, table: &str, index_name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> {
        if key.len() != index.components.len() {
            return Err(RuntimeError::Schema(format!("point read {table}.{index_name} supplied {} of {} key columns", key.len(), index.components.len())));
        }
        let prefix = key::encode(key);
        let rows = self.scan_keys(table, index_name, &prefix, &key::upper_bound(&prefix), Dir::Asc, 1)?;
        Ok(rows.into_iter().next().map(|(row, _)| row))
    }

    /// Rows under `prefix` in index order, bounded, at most `limit`. Each row
    /// comes with its stored key so a cursor can be minted from the last.
    pub fn scan(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        let base = key::encode(prefix);
        let mut lo = base.clone();
        let mut hi = key::upper_bound(&base);
        let with = |value: &Value| {
            let mut extended = prefix.to_vec();
            extended.push(value.clone());
            key::encode(&extended)
        };
        if let Some(value) = &bounds.gte {
            lo = lo.max(with(value));
        }
        if let Some(value) = &bounds.gt {
            lo = lo.max(key::upper_bound(&with(value)));
        }
        if let Some(value) = &bounds.lte {
            hi = hi.min(key::upper_bound(&with(value)));
        }
        if let Some(value) = &bounds.lt {
            hi = hi.min(with(value));
        }
        if let Some(after) = &bounds.after {
            let mut position = prefix.to_vec();
            position.extend(after.iter().cloned());
            let position = key::encode(&position);
            match dir {
                Dir::Asc => lo = lo.max(key::upper_bound(&position)),
                Dir::Desc => hi = hi.min(position),
            }
        }
        if let Some(before) = &bounds.before {
            let mut position = prefix.to_vec();
            position.extend(before.iter().cloned());
            let position = key::encode(&position);
            match dir {
                Dir::Asc => hi = hi.min(position),
                Dir::Desc => lo = lo.max(key::upper_bound(&position)),
            }
        }
        if lo >= hi {
            return Ok(Vec::new());
        }
        self.scan_keys(table, index_name, &lo, &hi, dir, limit)
    }

    fn scan_keys(&self, table: &str, index_name: &str, lo: &[u8], hi: &[u8], dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        let t = self.num(table)?;
        let ti = self.num(&format!("{table}.{index_name}"))?;
        let sql = match dir {
            Dir::Asc => "SELECT r.data, i.k FROM i JOIN r ON r.t = ?1 AND r.id = i.id WHERE i.ti = ?2 AND i.k >= ?3 AND i.k < ?4 ORDER BY i.k ASC LIMIT ?5",
            Dir::Desc => "SELECT r.data, i.k FROM i JOIN r ON r.t = ?1 AND r.id = i.id WHERE i.ti = ?2 AND i.k >= ?3 AND i.k < ?4 ORDER BY i.k DESC LIMIT ?5",
        };
        let mut statement = self.tx.prepare_cached(sql)?;
        let rows = statement.query_map(params![t, ti, lo, hi, limit as i64], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?)))?;
        rows.map(|row| {
            let (data, k) = row?;
            Ok((serde_json::from_str(&data).map_err(|e| RuntimeError::Store(e.to_string()))?, k))
        })
        .collect()
    }

    /// How many entries sit under `prefix`, counting at most `limit`.
    pub fn count_prefix(&self, table: &str, index_name: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> {
        let ti = self.num(&format!("{table}.{index_name}"))?;
        let base = key::encode(prefix);
        let hi = key::upper_bound(&base);
        let count: i64 = self.tx.query_row("SELECT COUNT(*) FROM (SELECT 1 FROM i WHERE ti = ?1 AND k >= ?2 AND k < ?3 LIMIT ?4)", params![ti, base, hi, limit as i64], |row| row.get(0))?;
        Ok(count as u64)
    }

    /// Write a row image: a fresh insert when `old` is none, else a replace
    /// that touches only the indexes whose keys changed. Returns the number
    /// of index entries written.
    pub fn put(&self, table_name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> {
        let t = self.num(table_name)?;
        let id = row.field("id")?.as_str()?.to_owned();
        let data = canonical_json(row);
        let mut entries = 0;
        match old {
            None => {
                self.tx.execute("INSERT INTO r(t, id, data) VALUES (?1, ?2, ?3)", params![t, id, data])?;
                for (index_name, index) in &table.indexes {
                    let ti = self.num(&format!("{table_name}.{index_name}"))?;
                    self.tx.execute("INSERT INTO i(ti, k, id) VALUES (?1, ?2, ?3)", params![ti, index_key(index, row, &id), id])?;
                    entries += 1;
                }
            }
            Some(old) => {
                self.tx.execute("UPDATE r SET data = ?3 WHERE t = ?1 AND id = ?2", params![t, id, data])?;
                for (index_name, index) in &table.indexes {
                    let before = index_key(index, old, &id);
                    let after = index_key(index, row, &id);
                    if before == after {
                        continue;
                    }
                    let ti = self.num(&format!("{table_name}.{index_name}"))?;
                    self.tx.execute("DELETE FROM i WHERE ti = ?1 AND k = ?2", params![ti, before])?;
                    self.tx.execute("INSERT INTO i(ti, k, id) VALUES (?1, ?2, ?3)", params![ti, after, id])?;
                    entries += 2;
                }
            }
        }
        Ok(entries)
    }

    pub fn delete(&self, table_name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> {
        let t = self.num(table_name)?;
        let id = old.field("id")?.as_str()?.to_owned();
        self.tx.execute("DELETE FROM r WHERE t = ?1 AND id = ?2", params![t, id])?;
        let mut entries = 0;
        for (index_name, index) in &table.indexes {
            let ti = self.num(&format!("{table_name}.{index_name}"))?;
            self.tx.execute("DELETE FROM i WHERE ti = ?1 AND k = ?2", params![ti, index_key(index, old, &id)])?;
            entries += 1;
        }
        Ok(entries)
    }

    pub fn next_seq(&self) -> Result<u64, RuntimeError> {
        Ok(self.tx.query_row("SELECT COALESCE(MAX(seq), 0) + 1 FROM _commits", [], |row| row.get::<_, i64>(0))? as u64)
    }

    pub fn record_commit(&self, seq: u64, at: i64, program: &str, principal: &str, kind: &str, touched: &[String], writes: u64) -> Result<(), RuntimeError> {
        self.tx.execute(
            "INSERT INTO _commits(seq, at, program, principal, kind, touched, writes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![seq as i64, at, program, principal, kind, canonical_json(&touched), writes as i64],
        )?;
        Ok(())
    }

    /// The outcome recorded for a client-minted operation id, if it applied.
    pub fn applied(&self, principal: &str, id: &str) -> Result<Option<(u64, String)>, RuntimeError> {
        Ok(self.tx.query_row("SELECT seq, outcome FROM _ops WHERE principal = ?1 AND id = ?2", params![principal, id], |row| Ok((row.get::<_, i64>(0)? as u64, row.get::<_, String>(1)?))).optional()?)
    }

    pub fn record_applied(&self, principal: &str, id: &str, seq: u64, outcome: &str) -> Result<(), RuntimeError> {
        self.tx.execute("INSERT INTO _ops(principal, id, seq, outcome) VALUES (?1, ?2, ?3, ?4)", params![principal, id, seq as i64, outcome])?;
        Ok(())
    }

    pub fn append_log(&self, partition: &str, seq: u64, ord: u32, table: &str, kind: &str, id: &str, data: Option<&str>) -> Result<(), RuntimeError> {
        self.tx.execute(
            "INSERT INTO _log(partition, seq, ord, t, kind, id, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![partition, seq as i64, ord as i64, table, kind, id, data],
        )?;
        Ok(())
    }

    /// Commits since `after`, as `(seq, touched tables)`.
    pub fn commits_after(&self, after: u64, limit: usize) -> Result<Vec<(u64, Vec<String>)>, RuntimeError> {
        let mut statement = self.tx.prepare_cached("SELECT seq, touched FROM _commits WHERE seq > ?1 ORDER BY seq LIMIT ?2")?;
        let rows = statement.query_map(params![after as i64, limit as i64], |row| Ok((row.get::<_, i64>(0)? as u64, row.get::<_, String>(1)?)))?;
        rows.map(|row| {
            let (seq, touched) = row?;
            Ok((seq, serde_json::from_str(&touched).unwrap_or_default()))
        })
        .collect()
    }
}

/// Log events after a watermark, oldest first.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct LogEvent {
    pub seq: u64,
    pub ord: u32,
    pub table: String,
    /// `put` (a row image), `del` (a row id), or `scope` (a group the
    /// recipient left: `data` carries the group prefix values).
    pub kind: String,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl Tx<'_> {
    pub fn read_log(&self, partition: &str, after: u64, limit: usize) -> Result<Vec<LogEvent>, RuntimeError> {
        let mut statement = self.tx.prepare_cached("SELECT seq, ord, t, kind, id, data FROM _log WHERE partition = ?1 AND seq > ?2 ORDER BY seq, ord LIMIT ?3")?;
        let rows = statement.query_map(params![partition, after as i64, limit as i64], |row| {
            Ok((row.get::<_, i64>(0)? as u64, row.get::<_, i64>(1)? as u32, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, Option<String>>(5)?))
        })?;
        rows.map(|row| {
            let (seq, ord, table, kind, id, data) = row?;
            let data = data.map(|data| serde_json::from_str(&data)).transpose().map_err(|e| RuntimeError::Store(e.to_string()))?;
            Ok(LogEvent { seq, ord, table, kind, id, data })
        })
        .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{ColumnType, public_table};

    fn schema() -> Schema {
        let mut columns = BTreeMap::new();
        columns.insert("id".to_owned(), ColumnType::Id);
        columns.insert("conv".to_owned(), ColumnType::Id);
        columns.insert("at".to_owned(), ColumnType::Int);
        let mut indexes = BTreeMap::new();
        indexes.insert("byId".to_owned(), Index::of(&["id"], true));
        indexes.insert("byConvAt".to_owned(), Index::of(&["conv", "at", "id"], false));
        let mut schema = Schema::default();
        schema.tables.insert("m".to_owned(), public_table(columns, indexes));
        schema
    }

    fn row(id: &str, conv: &str, at: i64) -> Value {
        crate::value::object([("id", Value::Id(id.into())), ("conv", Value::Id(conv.into())), ("at", Value::Int(at))])
    }

    #[test]
    fn scans_pages_and_cursors() {
        let schema = schema();
        let mut store = Store::memory().unwrap();
        store.install(&schema).unwrap();
        let table = &schema.tables["m"];
        let tx = store.transaction().unwrap();
        for n in 0..10 {
            tx.put("m", table, &row(&format!("m{n}"), if n % 2 == 0 { "a" } else { "b" }, n), None).unwrap();
        }
        let a = tx.scan("m", "byConvAt", &[Value::Id("a".into())], &Bounds::default(), Dir::Desc, 3).unwrap();
        let ids: Vec<_> = a.iter().map(|(r, _)| r.field("id").unwrap().as_str().unwrap().to_owned()).collect();
        assert_eq!(ids, ["m8", "m6", "m4"]);
        let after = Bounds { after: Some(vec![Value::Int(4), Value::Id("m4".into())]), ..Bounds::default() };
        let next = tx.scan("m", "byConvAt", &[Value::Id("a".into())], &after, Dir::Desc, 3).unwrap();
        let ids: Vec<_> = next.iter().map(|(r, _)| r.field("id").unwrap().as_str().unwrap().to_owned()).collect();
        assert_eq!(ids, ["m2", "m0"]);
        let ranged = Bounds { gte: Some(Value::Int(3)), lt: Some(Value::Int(9)), ..Bounds::default() };
        let mid = tx.scan("m", "byConvAt", &[Value::Id("b".into())], &ranged, Dir::Asc, 10).unwrap();
        let ids: Vec<_> = mid.iter().map(|(r, _)| r.field("id").unwrap().as_str().unwrap().to_owned()).collect();
        assert_eq!(ids, ["m3", "m5", "m7"]);
        assert_eq!(tx.lookup("m", "byId", &table.indexes["byId"], &[Value::Id("m5".into())]).unwrap(), Some(row("m5", "b", 5)));
        assert_eq!(tx.count_prefix("m", "byConvAt", &[Value::Id("a".into())], 100).unwrap(), 5);
        tx.put("m", table, &row("m5", "a", 5), Some(&row("m5", "b", 5))).unwrap();
        assert_eq!(tx.count_prefix("m", "byConvAt", &[Value::Id("a".into())], 100).unwrap(), 6);
        tx.delete("m", table, &row("m5", "a", 5)).unwrap();
        assert_eq!(tx.count_prefix("m", "byConvAt", &[Value::Id("a".into())], 100).unwrap(), 5);
        assert_eq!(tx.get("m", "m5").unwrap(), None);
    }
}
