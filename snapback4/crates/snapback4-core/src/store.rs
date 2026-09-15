//! The SQLite store. Two generic tables carry every application table: `r`
//! holds row images by (table number, id) and `i` holds every index entry as
//! one order-preserving key (`key.rs`) so a prefix scan, a point lookup and
//! a cursor position are all one B-tree range. The rest is the engine's own
//! bookkeeping: the catalog of table and index numbers, commits, the
//! partition log, applied operation ids, principals, sessions, generations.

use crate::error::RuntimeError;
use crate::key;
pub use crate::rows::{Bounds, Dir, index_key, index_keys, index_values};
use crate::rows::stored_index_keys;
use crate::schema::{Index, Schema, Table};
use crate::value::{Value, canonical_json};
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

mod activation;
mod successor;

const STORE_VERSION: &str = "snapback4-store-1";

pub struct Store {
    conn: Connection,
    catalog: BTreeMap<String, i64>,
    /// Where uploaded bytes live: `assets/` beside the database file, or a
    /// directory that dies with the process for a store in memory.
    assets_dir: PathBuf,
    identity: activation::Identity,
}

/// One transaction over the store, with the catalog in reach.
pub struct Tx<'a> {
    tx: rusqlite::Transaction<'a>,
    catalog: &'a BTreeMap<String, i64>,
}

fn scan_sql(dir: Dir) -> &'static str {
    match dir {
        Dir::Asc => "SELECT r.data, i.k FROM i JOIN r ON r.t = ?1 AND r.id = i.id WHERE i.ti = ?2 AND i.k >= ?3 AND i.k < ?4 ORDER BY i.k ASC LIMIT ?5",
        Dir::Desc => "SELECT r.data, i.k FROM i JOIN r ON r.t = ?1 AND r.id = i.id WHERE i.ti = ?2 AND i.k >= ?3 AND i.k < ?4 ORDER BY i.k DESC LIMIT ?5",
    }
}

impl Store {
    /// Inspect a dev store without creating a database, changing permissions, or
    /// running the writable store's initialization and upgrade path.
    pub fn open_read_only(path: &Path) -> Result<Self, RuntimeError> {
        let mut conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        let tx = conn.transaction()?;
        let version: String = tx.query_row("SELECT value FROM _meta WHERE key = 'version'", [], |row| row.get(0))?;
        if version != STORE_VERSION { return Err(RuntimeError::Store(format!("store version {version} is not {STORE_VERSION}"))); }
        let catalog = tx.prepare("SELECT name, num FROM _catalog")?.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?.collect::<Result<_, _>>()?;
        let identity = activation::identity(&tx)?;
        tx.rollback()?;
        let real = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let assets_dir = real.parent().unwrap_or(Path::new(".")).join("assets");
        Ok(Self { conn, catalog, identity, assets_dir })
    }

    /// Classify against one read snapshot of the active generation and rows.
    pub fn successor(&mut self, schema: &Schema) -> Result<Vec<crate::successor::Step>, RuntimeError> {
        let tx = self.read_transaction()?;
        let steps = successor::assess(&tx, schema)?;
        tx.rollback()?;
        Ok(steps)
    }

    pub fn open(path: &Path) -> Result<Self, RuntimeError> {
        let io = |e: std::io::Error| RuntimeError::Store(format!("private store: {e}"));
        // Release links intentionally point at the one shared database.
        let real = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        if let Some(parent) = real.parent().filter(|p| !p.as_os_str().is_empty()) {
            // A store's parent is its data root (assets live beside it), so
            // opening an existing store tightens that root as well.
            crate::private_fs::directory(parent).map_err(io)?;
        }
        // SQLite's Unix VFS copies the database mode when creating WAL,
        // journal and shared-memory files. Set it before opening SQLite;
        // chmod only after preparation would leave a disclosure window.
        crate::private_fs::database_file(&real).map_err(io)?;
        for suffix in ["-wal", "-shm", "-journal"] {
            crate::private_fs::existing_file(&PathBuf::from(format!("{}{suffix}", real.display())))
                .map_err(io)?;
        }
        let conn = Connection::open(&real)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 5000;")?;
        // A release serves the shared store through a link; the assets sit
        // beside the file itself, so every release serves the same bytes.
        let real = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let assets_dir = real.parent().map(|dir| dir.join("assets")).unwrap_or_else(|| PathBuf::from("assets"));
        let store = Self::prepare(conn, assets_dir)?;
        for suffix in ["-wal", "-shm", "-journal"] {
            crate::private_fs::existing_file(&PathBuf::from(format!("{}{suffix}", real.display())))
                .map_err(io)?;
        }
        Ok(store)
    }

    pub fn memory() -> Result<Self, RuntimeError> {
        let assets_dir = std::env::temp_dir().join(format!(
            "snapback4-{}-{}", std::process::id(), crate::ids::mint(crate::now_ms(), &mut 0)?
        ));
        Self::prepare(Connection::open_in_memory()?, assets_dir)
    }

    /// Where this store keeps uploaded bytes (`assets/<id>`).
    pub fn assets_dir(&self) -> &Path {
        &self.assets_dir
    }

    fn prepare(mut conn: Connection, assets_dir: PathBuf) -> Result<Self, RuntimeError> {
        // Our fixed indexed SQL should reuse its plan when keys or limits
        // change. Set this before caching statements: an existing VDBE
        // retains its parameter-expiry mask even after automatic reprepare.
        // @ref LLP 3000#7-decisions-during-execution — reuse SQLite plans across bound inputs
        conn.set_db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_ENABLE_QPSG, true)?;
        let io = |e: std::io::Error| RuntimeError::Store(format!("private assets: {e}"));
        crate::private_fs::directory(&assets_dir).map_err(io)?;
        for entry in std::fs::read_dir(&assets_dir).map_err(io)? {
            crate::private_fs::existing_file(&entry.map_err(io)?.path()).map_err(io)?;
        }
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
             CREATE TABLE IF NOT EXISTS _outbox (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, effect TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL, at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS _effect_presence (principal TEXT NOT NULL, id TEXT NOT NULL, deadline INTEGER NOT NULL, reconnected INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (principal, id)) WITHOUT ROWID;
             CREATE INDEX IF NOT EXISTS _effect_presence_id ON _effect_presence(id);
             CREATE TABLE IF NOT EXISTS _assets (id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, content_type TEXT NOT NULL, bytes INTEGER NOT NULL, width INTEGER, height INTEGER, duration INTEGER, created_at INTEGER NOT NULL, home_table TEXT, home_id TEXT, home_column TEXT, released_at INTEGER);
             CREATE TABLE IF NOT EXISTS _asset_views (asset TEXT NOT NULL, principal TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (asset, principal)) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS _asset_gc (asset TEXT PRIMARY KEY) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS _jobs (id TEXT PRIMARY KEY, name TEXT NOT NULL, args TEXT NOT NULL, program_hash TEXT NOT NULL, state TEXT NOT NULL, sweep INTEGER NOT NULL, cursor TEXT, upper TEXT, chunks INTEGER NOT NULL, rows_written INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error TEXT);",
        )?;
        conn.execute_batch("CREATE INDEX IF NOT EXISTS _sessions_expiry ON _sessions(expires_at);")?;
        crate::engine::actions::initialize(&conn)?;
        // The outbox grew a worker protocol (leases, backoff, results); a
        // store from before it gains the columns in place, once.
        let outbox_columns: Vec<String> = conn.prepare("SELECT name FROM pragma_table_info('_outbox')")?.query_map([], |row| row.get(0))?.collect::<Result<_, _>>()?;
        for (column, kind) in [("lease_until", "INTEGER"), ("claimed_by", "TEXT"), ("next_at", "INTEGER"), ("result", "TEXT"), ("error", "TEXT")] {
            if !outbox_columns.iter().any(|name| name == column) {
                conn.execute_batch(&format!("ALTER TABLE _outbox ADD COLUMN {column} {kind};"))?;
            }
        }
        conn.execute_batch("CREATE INDEX IF NOT EXISTS _outbox_due ON _outbox(state, effect, seq);")?;
        // Catalog numbers and ownership must come from the same snapshot.
        // An activation between separate reads must never attach new IR to
        // the previous catalog, even when every number is monotone.
        let opened = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        opened.execute("INSERT OR IGNORE INTO _meta(key, value) VALUES ('version', ?1)", [STORE_VERSION])?;
        // @ref LLP 3000.007#18.2 — a database incarnation survives reopen, independently of schema generation.
        opened.execute("INSERT OR IGNORE INTO _meta(key, value) VALUES ('store_id', lower(hex(randomblob(16))))", [])?;
        let version: String = opened.query_row("SELECT value FROM _meta WHERE key = 'version'", [], |row| row.get(0))?;
        if version != STORE_VERSION { return Err(RuntimeError::Store(format!("store version {version} is not {STORE_VERSION}; this data directory belongs to another Snapback"))); }
        let catalog = opened.prepare("SELECT name, num FROM _catalog")?.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))?.collect::<Result<BTreeMap<_, _>, _>>()?;
        let identity = activation::identity(&opened)?;
        opened.commit()?;
        Ok(Self { conn, catalog, assets_dir, identity })
    }

    pub fn transaction(&mut self) -> Result<Tx<'_>, RuntimeError> {
        // The write lock and identity check are one boundary: an engine
        // opened before another process activated a successor cannot write
        // or read with its stale schema/catalog.
        let tx = self.conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if activation::identity(&tx)? != self.identity {
            return Err(RuntimeError::Generation("the store adopted another backend; reopen this engine".into()));
        }
        Ok(Tx { tx, catalog: &self.catalog })
    }

    /// A consistent read snapshot does not reserve SQLite's writer lock.
    pub fn read_transaction(&mut self) -> Result<Tx<'_>, RuntimeError> {
        let tx = self.conn.transaction_with_behavior(rusqlite::TransactionBehavior::Deferred)?;
        if activation::identity(&tx)? != self.identity {
            return Err(RuntimeError::Generation("the store adopted another backend; reopen this engine".into()));
        }
        Ok(Tx { tx, catalog: &self.catalog })
    }

    /// An independent read connection, bound to this catalog and identity.
    pub fn reader(&self) -> Result<Self, RuntimeError> {
        let path = self.conn.path().filter(|path| !path.is_empty())
            .ok_or_else(|| RuntimeError::Store("an in-memory store has no independent reader".into()))?;
        let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        // This connection skips prepare's schema writes but needs the same
        // planning policy before any statements are cached.
        // @ref LLP 3000#7-decisions-during-execution — reuse SQLite plans across bound inputs
        conn.set_db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_ENABLE_QPSG, true)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(Self { conn, catalog: self.catalog.clone(), assets_dir: self.assets_dir.clone(), identity: self.identity.clone() })
    }

    pub fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        Ok(self.conn.prepare_cached("SELECT value FROM _meta WHERE key = ?1")?.query_row([key], |row| row.get(0)).optional()?)
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
        Ok(self.conn.prepare_cached("SELECT COALESCE(MAX(seq), 0) FROM _commits")?.query_row([], |row| row.get::<_, i64>(0))? as u64)
    }

    /// Every row of a table, for fixtures, `data`, and tests.
    pub fn rows(&self, table: &str) -> Result<Vec<Value>, RuntimeError> {
        let Some(t) = self.catalog.get(table) else { return Ok(Vec::new()) };
        let mut statement = self.conn.prepare("SELECT data FROM r WHERE t = ?1 ORDER BY id")?;
        let rows = statement.query_map([t], |row| row.get::<_, String>(0))?;
        rows.map(|data| serde_json::from_str(&data?).map_err(|e| RuntimeError::Store(e.to_string()))).collect()
    }

    /// A bounded administrative table listing, including whether another row exists.
    pub fn rows_limited(&self, table: &str, limit: usize) -> Result<(Vec<Value>, bool), RuntimeError> {
        let t = self.catalog.get(table).ok_or_else(|| RuntimeError::Schema(format!("no table {table}")))?;
        let mut statement = self.conn.prepare_cached("SELECT data FROM r WHERE t = ?1 ORDER BY id LIMIT ?2")?;
        let rows = statement.query_map(params![t, limit.saturating_add(1).min(i64::MAX as usize) as i64], |row| row.get::<_, String>(0))?;
        let mut rows = rows.map(|data| serde_json::from_str(&data?).map_err(|e| RuntimeError::Store(e.to_string()))).collect::<Result<Vec<Value>, _>>()?;
        let more = rows.len() > limit;
        rows.truncate(limit);
        Ok((rows, more))
    }

    /// How many client-minted operation ids have been applied (sent or failed).
    /// The recorded outcome of a client-minted op, if it applied.
    pub fn applied_outcome(&self, principal: &str, id: &str) -> Result<Option<String>, RuntimeError> {
        Ok(self.conn.prepare_cached("SELECT outcome FROM _ops WHERE principal = ?1 AND id = ?2")?.query_row(params![principal, id], |row| row.get::<_, String>(0)).optional()?)
    }

    pub fn applied_ops(&self) -> Result<u64, RuntimeError> {
        Ok(self.conn.prepare_cached("SELECT COUNT(*) FROM _ops WHERE outcome LIKE '%\"state\":\"sent\"%'")?.query_row([], |row| row.get::<_, i64>(0))? as u64)
    }

    pub fn count(&self, table: &str) -> Result<u64, RuntimeError> {
        let Some(t) = self.catalog.get(table) else { return Ok(0) };
        Ok(self.conn.prepare_cached("SELECT COUNT(*) FROM r WHERE t = ?1")?.query_row([t], |row| row.get::<_, i64>(0))? as u64)
    }

    /// What the store weighs, by part: the rows, their index entries, the
    /// partition log (one row per recipient per event), the op records,
    /// and the file. `doctor` prints it; the log's ratio to the rows is the
    /// amplification the per-recipient log costs.
    pub fn sizes(&self) -> Result<Sizes, RuntimeError> {
        let sum = |sql: &str| -> Result<u64, RuntimeError> { Ok(self.conn.query_row(sql, [], |row| row.get::<_, Option<i64>>(0))?.unwrap_or(0).max(0) as u64) };
        Ok(Sizes {
            rows: sum("SELECT SUM(LENGTH(data) + LENGTH(id)) FROM r")?,
            row_count: sum("SELECT COUNT(*) FROM r")?,
            indexes: sum("SELECT SUM(LENGTH(k) + LENGTH(id)) FROM i")?,
            log: sum("SELECT SUM(COALESCE(LENGTH(data), 0) + LENGTH(id) + LENGTH(partition) + LENGTH(t)) FROM _log")?,
            log_events: sum("SELECT COUNT(*) FROM _log")?,
            ops: sum("SELECT SUM(LENGTH(outcome) + LENGTH(id) + LENGTH(principal)) FROM _ops")?,
            file: sum("SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()")?,
        })
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct Sizes {
    pub rows: u64,
    pub row_count: u64,
    pub indexes: u64,
    pub log: u64,
    pub log_events: u64,
    pub ops: u64,
    pub file: u64,
}

impl Sizes {
    /// The log's bytes per byte of rows.
    pub fn amplification(&self) -> f64 {
        if self.rows == 0 { 0.0 } else { self.log as f64 / self.rows as f64 }
    }
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

    /// Roll back the named savepoint and release it in the same operation.
    pub fn rollback_to(&self, name: &str) -> Result<(), RuntimeError> {
        self.tx.execute_batch(&format!("ROLLBACK TO {name}; RELEASE {name}"))?;
        Ok(())
    }

    fn num(&self, name: &str) -> Result<i64, RuntimeError> {
        self.catalog.get(name).copied().ok_or_else(|| RuntimeError::Schema(format!("{name} is not installed in this store")))
    }

    pub fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        let t = self.num(table)?;
        let data: Option<String> = self.tx.prepare_cached("SELECT data FROM r WHERE t = ?1 AND id = ?2")?.query_row(params![t, id], |row| row.get(0)).optional()?;
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
        let Some((lo, hi)) = crate::rows::scan_range(prefix, bounds, dir) else { return Ok(Vec::new()) };
        self.scan_keys(table, index_name, &lo, &hi, dir, limit)
    }

    fn scan_keys(&self, table: &str, index_name: &str, lo: &[u8], hi: &[u8], dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        let t = self.num(table)?;
        let ti = self.num(&format!("{table}.{index_name}"))?;
        let mut statement = self.tx.prepare_cached(scan_sql(dir))?;
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
        let count: i64 = self.tx.prepare_cached("SELECT COUNT(*) FROM (SELECT 1 FROM i WHERE ti = ?1 AND k >= ?2 AND k < ?3 LIMIT ?4)")?.query_row(params![ti, base, hi, limit as i64], |row| row.get(0))?;
        Ok(count as u64)
    }

    /// Write a row image: a fresh insert when `old` is none, else a replace
    /// that touches only the index entries whose keys changed (a `words`
    /// index has one per token). Returns the number of entries written.
    pub fn put(&self, table_name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> {
        let t = self.num(table_name)?;
        let id = row.field("id")?.as_str()?.to_owned();
        let data = canonical_json(row);
        let mut entries = 0;
        match old {
            None => {
                self.tx.prepare_cached("INSERT INTO r(t, id, data) VALUES (?1, ?2, ?3)")?.execute(params![t, id, data])?;
                for (index_name, index) in &table.indexes {
                    let ti = self.num(&format!("{table_name}.{index_name}"))?;
                    for key in stored_index_keys(table, index, row, &id) {
                        self.tx.prepare_cached("INSERT INTO i(ti, k, id) VALUES (?1, ?2, ?3)")?.execute(params![ti, key, id])?;
                        entries += 1;
                    }
                }
            }
            Some(old) => {
                self.tx.prepare_cached("UPDATE r SET data = ?3 WHERE t = ?1 AND id = ?2")?.execute(params![t, id, data])?;
                for (index_name, index) in &table.indexes {
                    let before = stored_index_keys(table, index, old, &id);
                    let after = stored_index_keys(table, index, row, &id);
                    if before == after {
                        continue;
                    }
                    let ti = self.num(&format!("{table_name}.{index_name}"))?;
                    for key in before.iter().filter(|key| !after.contains(key)) {
                        self.tx.prepare_cached("DELETE FROM i WHERE ti = ?1 AND k = ?2")?.execute(params![ti, key])?;
                        entries += 1;
                    }
                    for key in after.iter().filter(|key| !before.contains(key)) {
                        self.tx.prepare_cached("INSERT INTO i(ti, k, id) VALUES (?1, ?2, ?3)")?.execute(params![ti, key, id])?;
                        entries += 1;
                    }
                }
            }
        }
        Ok(entries)
    }

    pub fn delete(&self, table_name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> {
        let t = self.num(table_name)?;
        let id = old.field("id")?.as_str()?.to_owned();
        self.tx.prepare_cached("DELETE FROM r WHERE t = ?1 AND id = ?2")?.execute(params![t, id])?;
        let mut entries = 0;
        for (index_name, index) in &table.indexes {
            let ti = self.num(&format!("{table_name}.{index_name}"))?;
            for key in stored_index_keys(table, index, old, &id) {
                self.tx.prepare_cached("DELETE FROM i WHERE ti = ?1 AND k = ?2")?.execute(params![ti, key])?;
                entries += 1;
            }
        }
        Ok(entries)
    }

    pub fn next_seq(&self) -> Result<u64, RuntimeError> {
        Ok(self.tx.prepare_cached("SELECT COALESCE(MAX(seq), 0) + 1 FROM _commits")?.query_row([], |row| row.get::<_, i64>(0))? as u64)
    }

    /// A meta key written with the transaction (a device's watermark lands
    /// with the rows it covers).
    pub fn set_meta(&self, key: &str, value: &str) -> Result<(), RuntimeError> {
        self.tx.execute("INSERT INTO _meta(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, value])?;
        Ok(())
    }

    pub fn record_commit(&self, seq: u64, at: i64, program: &str, principal: &str, kind: &str, touched: &[String], writes: u64) -> Result<(), RuntimeError> {
        self.tx.prepare_cached("INSERT INTO _commits(seq, at, program, principal, kind, touched, writes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")?.execute(params![seq as i64, at, program, principal, kind, canonical_json(&touched), writes as i64],
        )?;
        Ok(())
    }

    /// The outcome recorded for a client-minted operation id, if it applied.
    pub fn applied(&self, principal: &str, id: &str) -> Result<Option<(u64, String)>, RuntimeError> {
        Ok(self.tx.prepare_cached("SELECT seq, outcome FROM _ops WHERE principal = ?1 AND id = ?2")?.query_row(params![principal, id], |row| Ok((row.get::<_, i64>(0)? as u64, row.get::<_, String>(1)?))).optional()?)
    }

    pub fn record_applied(&self, principal: &str, id: &str, seq: u64, outcome: &str) -> Result<(), RuntimeError> {
        self.tx.prepare_cached("INSERT INTO _ops(principal, id, seq, outcome) VALUES (?1, ?2, ?3, ?4)")?.execute(params![principal, id, seq as i64, outcome])?;
        Ok(())
    }

    pub fn append_log(&self, partition: &str, seq: u64, ord: u32, table: &str, kind: &str, id: &str, data: Option<&str>) -> Result<(), RuntimeError> {
        self.tx.prepare_cached("INSERT INTO _log(partition, seq, ord, t, kind, id, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")?.execute(params![partition, seq as i64, ord as i64, table, kind, id, data],
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
        self.log_rows("SELECT seq, ord, t, kind, id, data FROM _log WHERE partition = ?1 AND seq > ?2 ORDER BY seq, ord LIMIT ?3", params![partition, after as i64, limit as i64])
    }

    /// Every event of one commit in a partition, however many.
    pub fn read_log_seq(&self, partition: &str, seq: u64) -> Result<Vec<LogEvent>, RuntimeError> {
        self.log_rows("SELECT seq, ord, t, kind, id, data FROM _log WHERE partition = ?1 AND seq = ?2 ORDER BY ord", params![partition, seq as i64])
    }

    /// All membership transitions through the transaction head, independently
    /// of the bounded content page whose visibility they establish.
    pub fn membership_transitions(&self, partition: &str, after: u64) -> Result<Vec<LogEvent>, RuntimeError> {
        self.log_rows("SELECT seq, ord, t, kind, id, data FROM _log WHERE partition = ?1 AND seq > ?2 AND kind IN ('join', 'scope') ORDER BY seq, ord", &[&partition, &(after.min(i64::MAX as u64) as i64)])
    }

    /// One last transition per group establishes the state at the watermark.
    pub fn memberships_before(&self, partition: &str, watermark: u64) -> Result<Vec<LogEvent>, RuntimeError> {
        self.log_rows("SELECT seq, ord, t, kind, id, data FROM (SELECT seq, ord, t, kind, id, data, ROW_NUMBER() OVER (PARTITION BY t, id ORDER BY seq DESC, ord DESC) AS position FROM _log WHERE partition = ?1 AND seq <= ?2 AND kind IN ('join', 'scope')) WHERE position = 1", &[&partition, &(watermark.min(i64::MAX as u64) as i64)])
    }

    pub fn commit_times(&self, sequences: &[u64]) -> Result<BTreeMap<u64, i64>, RuntimeError> {
        let sequences = serde_json::to_string(sequences).map_err(|e| RuntimeError::Store(e.to_string()))?;
        let mut query = self.tx.prepare_cached("SELECT seq, at FROM _commits WHERE seq IN (SELECT value FROM json_each(?1))")?;
        let rows = query.query_map([sequences], |row| Ok((row.get::<_, i64>(0)? as u64, row.get(1)?)))?;
        rows.collect::<Result<_, _>>().map_err(Into::into)
    }

    /// Merge every authorized interval with one SQLite statement. The JSON
    /// parameter is a relation of (partition, inclusive start, exclusive end, expiry),
    /// so query count is independent of the number of held groups.
    pub fn read_log_spans(&self, spans: &[(String, u64, Option<u64>, Option<i64>)], after: u64, only_seq: Option<u64>, limit: usize) -> Result<Vec<LogEvent>, RuntimeError> {
        let spans = serde_json::to_string(spans).map_err(|e| RuntimeError::Store(e.to_string()))?;
        self.log_rows(
            "SELECT l.seq, l.ord, l.t, l.kind, l.id, l.data FROM json_each(?1) AS span JOIN _log AS l
             ON l.partition = json_extract(span.value, '$[0]')
             AND l.seq >= json_extract(span.value, '$[1]')
             AND (json_extract(span.value, '$[2]') IS NULL OR l.seq < json_extract(span.value, '$[2]'))
             JOIN _commits c ON c.seq = l.seq
             WHERE (json_extract(span.value, '$[3]') IS NULL OR c.at < json_extract(span.value, '$[3]')) AND l.seq > ?2 AND (?3 IS NULL OR l.seq = ?3) ORDER BY l.seq, l.ord LIMIT ?4",
            &[&spans, &(after.min(i64::MAX as u64) as i64), &only_seq.map(|s| s.min(i64::MAX as u64) as i64), &(limit.min(i64::MAX as usize) as i64)])
    }

    /// The row images that existed when a membership began, excluding later
    /// updates and rows created after the member had already left.
    pub fn group_at(&self, partition: &str, seq: u64) -> Result<Vec<LogEvent>, RuntimeError> {
        self.log_rows(
            "SELECT seq, ord, t, kind, id, data FROM (
               SELECT seq, ord, t, kind, id, data, ROW_NUMBER() OVER (PARTITION BY t, id ORDER BY seq DESC, ord DESC) AS position
               FROM _log WHERE partition = ?1 AND seq <= ?2 AND kind IN ('put', 'del')
             ) WHERE position = 1 AND kind = 'put'", &[&partition, &(seq.min(i64::MAX as u64) as i64)])
    }

    fn log_rows(&self, sql: &str, params: &[&dyn rusqlite::ToSql]) -> Result<Vec<LogEvent>, RuntimeError> {
        let mut statement = self.tx.prepare_cached(sql)?;
        let rows = statement.query_map(params, |row| {
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

    #[test]
    fn cached_scan_plans_rebind_and_still_refresh_after_schema_changes() {
        use rusqlite::StatementStatus::{RePrepare, Run};
        let path = std::env::temp_dir().join(format!("snapback4-plans-{}-{:x}", std::process::id(), crate::ids::seed()));
        std::fs::create_dir(&path).unwrap();
        for mut store in [Store::memory().unwrap(), Store::open(&path.join("store.sqlite")).unwrap()] {
            // Check the linked dependency under the publication's exact C input.
            // Ordinary source builds retain their own bundled build policy.
            if option_env!("LIBSQLITE3_FLAGS") == Some("-USQLITE_ENABLE_MEMORY_MANAGEMENT") {
                let options: Vec<String> = store.conn().prepare("PRAGMA compile_options").unwrap()
                    .query_map([], |row| row.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
                assert!(!options.iter().any(|s| s == "ENABLE_MEMORY_MANAGEMENT"));
                assert!(options.iter().any(|s| s == "THREADSAFE=1"));
                assert_eq!(store.conn().query_row("PRAGMA cache_size", [], |row| row.get::<_, i64>(0)).unwrap(), -2000);
            }
            let schema = schema();
            store.install(&schema).unwrap();
            let table = &schema.tables["m"];
            let tx = store.transaction().unwrap();
            for n in 0..10 {
                tx.put("m", table, &row(&format!("m{n}"), if n % 2 == 0 { "a" } else { "b" }, n), None).unwrap();
            }
            let bounds = Bounds { gte: Some(Value::Int(2)), lt: Some(Value::Int(9)), ..Bounds::default() };
            for dir in [Dir::Asc, Dir::Desc] {
                tx.scan("m", "byConvAt", &[Value::Id("a".into())], &Bounds::default(), dir, 1).unwrap();
                {
                    let statement = tx.conn().prepare_cached(scan_sql(dir)).unwrap();
                    statement.reset_status(RePrepare);
                    statement.reset_status(Run);
                }
                for group in ["a", "b", "missing"] {
                    for limit in [0, 1, 3, 100] {
                        let mut numbers: Vec<_> = (2..9).filter(|n| group == if n % 2 == 0 { "a" } else { "b" }).collect();
                        if dir == Dir::Desc { numbers.reverse(); }
                        let expected: Vec<_> = numbers.into_iter().take(limit).map(|n| {
                            let id = format!("m{n}");
                            let row = row(&id, group, n);
                            let key = crate::rows::index_key(&table.indexes["byConvAt"], &row, &id);
                            (row, key)
                        }).collect();
                        assert_eq!(tx.scan("m", "byConvAt", &[Value::Id(group.into())], &bounds, dir, limit).unwrap(), expected);
                    }
                }
                let statement = tx.conn().prepare_cached(scan_sql(dir)).unwrap();
                assert_eq!(statement.get_status(Run), 12);
                assert_eq!(statement.get_status(RePrepare), 0, "rebinding an indexed scan must reuse its plan");
            }
            // Plan reuse must still read changes in this transaction.
            tx.put("m", table, &row("m5", "a", 5), Some(&row("m5", "b", 5))).unwrap();
            tx.delete("m", table, &row("m6", "a", 6)).unwrap();
            let read = || tx.scan("m", "byConvAt", &[Value::Id("a".into())], &bounds, Dir::Asc, 100).unwrap();
            let changed = read();
            let ids: Vec<_> = changed.iter().map(|(r, _)| r.field("id").unwrap().as_str().unwrap()).collect();
            assert_eq!(ids, ["m2", "m4", "m5", "m8"]);
            assert_eq!(tx.conn().prepare_cached(scan_sql(Dir::Asc)).unwrap().get_status(RePrepare), 0);
            // QPSG must not suppress invalidation when SQLite's schema changes.
            tx.conn().execute_batch("CREATE TABLE _plan_change (value INTEGER)").unwrap();
            assert_eq!(read(), changed);
            let refreshed = tx.conn().prepare_cached(scan_sql(Dir::Asc)).unwrap().get_status(RePrepare);
            assert!(refreshed > 0);
            assert_eq!(read(), changed);
            assert_eq!(tx.conn().prepare_cached(scan_sql(Dir::Asc)).unwrap().get_status(RePrepare), refreshed);
            tx.rollback().unwrap();
        }
        std::fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn independent_readers_reuse_plans_and_refresh_snapshots() {
        use rusqlite::StatementStatus::{RePrepare, Run};
        let path = std::env::temp_dir().join(format!("snapback4-reader-plans-{}-{:x}", std::process::id(), crate::ids::seed()));
        std::fs::create_dir(&path).unwrap();
        let schema = schema();
        let table = &schema.tables["m"];
        let mut writer = Store::open(&path.join("store.sqlite")).unwrap();
        writer.install(&schema).unwrap();
        let write = writer.transaction().unwrap();
        for n in 0..10 {
            write.put("m", table, &row(&format!("m{n}"), if n % 2 == 0 { "a" } else { "b" }, n), None).unwrap();
        }
        write.commit().unwrap();
        let mut reader = writer.reader().unwrap();
        let bounds = Bounds { gte: Some(Value::Int(2)), lt: Some(Value::Int(9)), ..Bounds::default() };
        let tx = reader.read_transaction().unwrap();
        for dir in [Dir::Asc, Dir::Desc] {
            tx.scan("m", "byConvAt", &[Value::Id("a".into())], &Bounds::default(), dir, 1).unwrap();
            {
                let statement = tx.conn().prepare_cached(scan_sql(dir)).unwrap();
                statement.reset_status(RePrepare);
                statement.reset_status(Run);
            }
            for group in ["a", "b", "missing"] {
                for limit in [0, 1, 3, 100] {
                    let mut numbers: Vec<_> = (2..9).filter(|n| group == if n % 2 == 0 { "a" } else { "b" }).collect();
                    if dir == Dir::Desc { numbers.reverse(); }
                    let expected: Vec<_> = numbers.into_iter().take(limit).map(|n| {
                        let id = format!("m{n}");
                        let row = row(&id, group, n);
                        let key = crate::rows::index_key(&table.indexes["byConvAt"], &row, &id);
                        (row, key)
                    }).collect();
                    assert_eq!(tx.scan("m", "byConvAt", &[Value::Id(group.into())], &bounds, dir, limit).unwrap(), expected);
                }
            }
            let statement = tx.conn().prepare_cached(scan_sql(dir)).unwrap();
            assert_eq!(statement.get_status(Run), 12);
            assert_eq!(statement.get_status(RePrepare), 0, "independent readers must reuse bound scan plans");
        }
        let read = |tx: &Tx<'_>| tx.scan("m", "byConvAt", &[Value::Id("a".into())], &bounds, Dir::Asc, 100).unwrap();
        let original = read(&tx);
        // A concurrent commit changes the next snapshot, not this one.
        let write = writer.transaction().unwrap();
        write.put("m", table, &row("m5", "a", 5), Some(&row("m5", "b", 5))).unwrap();
        write.delete("m", table, &row("m6", "a", 6)).unwrap();
        write.commit().unwrap();
        assert_eq!(read(&tx), original);
        tx.commit().unwrap();
        let tx = reader.read_transaction().unwrap();
        let changed = read(&tx);
        let ids: Vec<_> = changed.iter().map(|(r, _)| r.field("id").unwrap().as_str().unwrap()).collect();
        assert_eq!(ids, ["m2", "m4", "m5", "m8"]);
        assert_eq!(tx.conn().prepare_cached(scan_sql(Dir::Asc)).unwrap().get_status(RePrepare), 0);
        tx.commit().unwrap();
        writer.conn().execute_batch("CREATE TABLE _reader_plan_change (value INTEGER)").unwrap();
        let tx = reader.read_transaction().unwrap();
        assert_eq!(read(&tx), changed);
        let refreshed = tx.conn().prepare_cached(scan_sql(Dir::Asc)).unwrap().get_status(RePrepare);
        assert!(refreshed > 0, "schema changes still invalidate a reader's plan");
        assert_eq!(read(&tx), changed);
        assert_eq!(tx.conn().prepare_cached(scan_sql(Dir::Asc)).unwrap().get_status(RePrepare), refreshed);
        tx.commit().unwrap();
        drop(reader);
        drop(writer);
        std::fs::remove_dir_all(path).unwrap();
    }
}

impl crate::rows::Rows for Tx<'_> {
    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        Tx::get(self, table, id)
    }
    fn lookup(&self, table: &str, index_name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> {
        Tx::lookup(self, table, index_name, index, key)
    }
    fn scan(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        Tx::scan(self, table, index_name, prefix, bounds, dir, limit)
    }
    fn count_prefix(&self, table: &str, index_name: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> {
        Tx::count_prefix(self, table, index_name, prefix, limit)
    }
    fn put(&self, table_name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> {
        Tx::put(self, table_name, table, row, old)
    }
    fn delete(&self, table_name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> {
        Tx::delete(self, table_name, table, old)
    }
    fn holds_assets(&self) -> bool {
        true
    }
    fn asset(&self, id: &str) -> Result<Option<crate::assets::Asset>, RuntimeError> {
        Tx::asset(self, id)
    }
    fn claim_asset(&self, id: &str, by: &str, table: &str, row_id: &str, column: &str) -> Result<crate::assets::Asset, RuntimeError> {
        Tx::claim_asset(self, id, by, table, row_id, column)
    }
    fn release_asset(&self, id: &str, now: i64) -> Result<(), RuntimeError> {
        Tx::release_asset(self, id, now)
    }
}
