//! The SQLite store. Two generic tables carry every application table: `r`
//! holds row images by (table number, id) and `i` holds every index entry as
//! one order-preserving key (`key.rs`) so a prefix scan, a point lookup and
//! a cursor position are all one B-tree range. The rest is the engine's own
//! bookkeeping: the catalog of table and index numbers, commits, the
//! partition log, applied operation ids, principals, sessions, generations.

#[cfg(feature = "server-search")]
#[path = "store/selected.rs"]
mod selected;

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
mod activation_cache;
mod activation_index;
mod activation_scan;
pub mod adoption_report;
pub mod adoption_estimate;
mod activation_walk;
mod activation_plan;
#[cfg(test)]
mod adoption_tests;
mod event_slots;
pub mod timeline_launch;
mod caps;
mod authority;
mod successor;
mod sequences;
mod ownership;
pub(crate) mod opening;

const STORE_VERSION: &str = "snapback4-store-1";

#[cfg(unix)]
fn file_identity(conn: &Connection) -> Result<Option<(u64, u64)>, RuntimeError> {
    use std::os::unix::fs::MetadataExt;
    conn.path().filter(|path| !path.is_empty()).map(|path| {
        std::fs::metadata(path).map(|m| (m.dev(), m.ino()))
            .map_err(|e| RuntimeError::Store(format!("database identity at {path}: {e}")))
    }).transpose()
}

pub struct Store {
    conn: Connection,
    // Fields drop in declaration order: retain the sidecar ownership lock until
    // SQLite has closed. No raw descriptor to the database is held here.
    ownership: Option<std::sync::Arc<std::fs::File>>,
    #[cfg(unix)]
    file_identity: Option<(u64, u64)>,
    page_size: u64,
    catalog: BTreeMap<String, i64>,
    /// Where uploaded bytes live: `assets/` beside the database file, or a
    /// directory that dies with the store for a store in memory.
    assets_dir: PathBuf,
    /// A store in memory owns its assets directory: nothing creates it until
    /// the first upload, and dropping the store removes it. Before this, every
    /// `Store::memory()` created one and nothing removed it — one empty
    /// directory per in-memory engine, four million of them in a week of test
    /// runs on one machine, until listing the temp directory took minutes.
    ephemeral_assets: bool,
    identity: activation::Identity,
    #[cfg(test)]
    full_adoption: bool,
    pub adoption_report: adoption_report::AdoptionReport,
}

impl Drop for Store {
    fn drop(&mut self) {
        if self.ephemeral_assets {
            let _ = std::fs::remove_dir_all(&self.assets_dir);
        }
    }
}

/// One transaction over the store, with the catalog in reach.
pub struct Tx<'a> {
    activation_scan: Option<activation_scan::Buffer>,
    pub changes: std::cell::RefCell<crate::revocation::Recorder>,
    sequence_table: std::cell::Cell<Option<bool>>,
    tx: rusqlite::Transaction<'a>,
    page_size: u64,
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
        #[cfg(unix)]
        let file_identity = file_identity(&conn)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        let tx = conn.transaction()?;
        let version: String = tx.query_row("SELECT value FROM _meta WHERE key = 'version'", [], |row| row.get(0))?;
        if version != STORE_VERSION { return Err(RuntimeError::Store(format!("store version {version} is not {STORE_VERSION}"))); }
        let catalog = tx.prepare("SELECT name, num FROM _catalog")?.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?.collect::<Result<_, _>>()?;
        let identity = activation::identity(&tx)?;
        tx.rollback()?;
        let real = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let assets_dir = real.parent().unwrap_or(Path::new(".")).join("assets");
        let page_size = conn.query_row("PRAGMA page_size", [], |row| row.get::<_, i64>(0))? as u64;
        Ok(Self { #[cfg(test)] full_adoption: false, adoption_report: Default::default(), conn, ownership: None, #[cfg(unix)] file_identity, page_size, catalog, identity, assets_dir, ephemeral_assets: false })
    }

    /// Classify against one read snapshot of the active generation and rows.
    pub fn successor(&mut self, schema: &Schema) -> Result<Vec<crate::successor::Step>, RuntimeError> {
        let tx = self.read_transaction()?;
        let steps = successor::assess(&tx, schema)?;
        tx.rollback()?;
        Ok(steps)
    }

    /// Preview the same atomic launch admitted by dev, without changing the store.
    pub fn check_timeline_activation(&mut self, schema: &Schema) -> Result<Vec<timeline_launch::Estimate>, RuntimeError> {
        self.check_timeline_activation_at(schema, crate::now_ms(), true)
    }

    pub fn check_timeline_activation_at(&mut self, schema: &Schema, now: i64, allow_launch: bool) -> Result<Vec<timeline_launch::Estimate>, RuntimeError> {
        let tx = self.read_transaction()?;
        let estimates = timeline_launch::preflight(&tx, schema, now, allow_launch)?;
        tx.rollback()?;
        Ok(estimates)
    }

    pub fn open(path: &Path) -> Result<Self, RuntimeError> {
        Self::open_with_busy_timeout(path, std::time::Duration::from_secs(5))
    }

    /// A caller with its own pre-admission deadline can own the lock wait.
    // @ref LLP 3000.011.004.000#2 — only open/adoption retries use a caller-owned deadline.
    pub fn open_with_busy_timeout(path: &Path, timeout: std::time::Duration) -> Result<Self, RuntimeError> {
        Self::open_base(path, timeout, true)
    }

    // Shared server/device initialization; server evidence is added only by
    // the server entry points, never when opening an older native device.
    fn open_base(path: &Path, timeout: std::time::Duration, server: bool) -> Result<Self, RuntimeError> {
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
        // @ref LLP 3000.033#1.3 — even dropping a refused writable connection
        // must preserve committed WAL frames instead of checkpointing them.
        conn.set_db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, true)?;
        conn.busy_timeout(timeout)?;
        // @ref LLP 3000.013#4-following-without-caps — published watermarks must survive a power loss.
        // Delivery publishes partition watermarks as well as replayable copies.
        // Losing an acknowledged background commit could rewind a device's
        // watermark, so requests and maintenance share the durable policy.
        // A refused open must preserve even a legacy rollback-journal file's
        // header. New stores choose WAL; existing stores retain their mode.
        if conn.query_row("PRAGMA page_count", [], |r| r.get::<_, i64>(0))? == 0 {
            conn.execute_batch("PRAGMA journal_mode = WAL;")?;
        }
        conn.execute_batch("PRAGMA synchronous = FULL; PRAGMA foreign_keys = OFF;")?;
        // A release serves the shared store through a link; the assets sit
        // beside the file itself, so every release serves the same bytes.
        let real = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let assets_dir = real.parent().map(|dir| dir.join("assets")).unwrap_or_else(|| PathBuf::from("assets"));
        let store = Self::prepare(conn, assets_dir, false, server)?;
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
        Self::prepare(Connection::open_in_memory()?, assets_dir, true, true)
    }

    // @ref LLP 3000.023#12 — create server metadata at open, before reads can
    // cache plans. DDL during a commit would invalidate those prepared reads.
    fn initialize_change_evidence(conn: &Connection) -> Result<(), RuntimeError> {
        conn.execute_batch("CREATE TABLE IF NOT EXISTS _change_evidence (seq INTEGER PRIMARY KEY, footprint TEXT NOT NULL)")?;
        Ok(())
    }

    /// Where this store keeps uploaded bytes (`assets/<id>`).
    pub fn assets_dir(&self) -> &Path {
        &self.assets_dir
    }

    /// Whether the assets directory belongs to this store alone (a store in
    /// memory) rather than to the project beside the database.
    pub fn ephemeral_assets(&self) -> bool {
        self.ephemeral_assets
    }

    fn prepare(mut conn: Connection, assets_dir: PathBuf, ephemeral_assets: bool, server: bool) -> Result<Self, RuntimeError> {
        #[cfg(unix)]
        let file_identity = file_identity(&conn)?;
        // Our fixed indexed SQL should reuse its plan when keys or limits
        // change. Set this before caching statements: an existing VDBE
        // retains its parameter-expiry mask even after automatic reprepare.
        // @ref LLP 3000#7-decisions-during-execution — reuse SQLite plans across bound inputs
        conn.set_db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_ENABLE_QPSG, true)?;
        // An ephemeral directory is created by the first upload (`Upload::write`)
        // and has no earlier contents to make private.
        if !ephemeral_assets {
            let io = |e: std::io::Error| RuntimeError::Store(format!("private assets: {e}"));
            crate::private_fs::directory(&assets_dir).map_err(io)?;
            for entry in std::fs::read_dir(&assets_dir).map_err(io)? {
                crate::private_fs::existing_file(&entry.map_err(io)?.path()).map_err(io)?;
            }
        }
        // Catalog numbers and ownership must come from the same snapshot.
        // An activation between separate reads must never attach new IR to
        // the previous catalog, even when every number is monotone.
        let opened = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        // @ref LLP 3000.033#1.3 — inspect existing stores without upgrading
        // them. All upgrades join successful activation, never a refused open.
        let fresh: bool = opened.query_row("SELECT NOT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table')", [], |r| r.get(0))?;
        if fresh {
            Self::initialize_schema(&opened)?;
            if server { Self::initialize_change_evidence(&opened)?; }
        }
        let version: String = opened.query_row("SELECT value FROM _meta WHERE key = 'version'", [], |row| row.get(0))?;
        if version != STORE_VERSION { return Err(RuntimeError::Store(format!("store version {version} is not {STORE_VERSION}; this data directory belongs to another Snapback"))); }
        let catalog = opened.prepare("SELECT name, num FROM _catalog")?.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))?.collect::<Result<BTreeMap<_, _>, _>>()?;
        let identity = activation::identity(&opened)?;
        opened.commit()?;
        let page_size = conn.query_row("PRAGMA page_size", [], |row| row.get::<_, i64>(0))? as u64;
        Ok(Self { #[cfg(test)] full_adoption: false, adoption_report: Default::default(), conn, ownership: None, #[cfg(unix)] file_identity, page_size, catalog, assets_dir, ephemeral_assets, identity })
    }

    pub(super) fn initialize_schema(conn: &Connection) -> Result<(), RuntimeError> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS _catalog (name TEXT PRIMARY KEY, num INTEGER NOT NULL UNIQUE);
             CREATE TABLE IF NOT EXISTS r (t INTEGER NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (t, id)) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS i (ti INTEGER NOT NULL, k BLOB NOT NULL, id TEXT NOT NULL, PRIMARY KEY (ti, k)) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS _commits (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, program TEXT NOT NULL, principal TEXT NOT NULL, kind TEXT NOT NULL, touched TEXT NOT NULL, writes INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS _log (partition TEXT NOT NULL, seq INTEGER NOT NULL, ord INTEGER NOT NULL, t TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT, PRIMARY KEY (partition, seq, ord)) WITHOUT ROWID;
             DROP INDEX IF EXISTS _log_row_seq;
             DROP INDEX IF EXISTS _log_row_seq_kind;
             CREATE TABLE IF NOT EXISTS _ops (principal TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, outcome TEXT NOT NULL, PRIMARY KEY (principal, id)) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS _principals (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT, created_at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS _sessions (token_digest TEXT PRIMARY KEY, principal TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS _credentials (principal TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, hash TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS _generations (generation INTEGER PRIMARY KEY, schema TEXT NOT NULL, programs TEXT NOT NULL, at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS _outbox (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, effect TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL, at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS _effect_steps (
                 effect_id TEXT NOT NULL, name TEXT NOT NULL, input_digest TEXT NOT NULL,
                 provider_key TEXT NOT NULL, state TEXT NOT NULL, claim_digest TEXT NOT NULL,
                 result TEXT, at INTEGER NOT NULL, settled_at INTEGER, error TEXT,
                 PRIMARY KEY(effect_id, name));
             CREATE TABLE IF NOT EXISTS _effect_presence (principal TEXT NOT NULL, id TEXT NOT NULL, deadline INTEGER NOT NULL, reconnected INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (principal, id)) WITHOUT ROWID;
             CREATE INDEX IF NOT EXISTS _effect_presence_id ON _effect_presence(id);
             CREATE TABLE IF NOT EXISTS _assets (id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, content_type TEXT NOT NULL, bytes INTEGER NOT NULL, width INTEGER, height INTEGER, duration INTEGER, created_at INTEGER NOT NULL, home_table TEXT, home_id TEXT, home_column TEXT, released_at INTEGER, name TEXT);
             CREATE TABLE IF NOT EXISTS _asset_views (asset TEXT NOT NULL, principal TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (asset, principal)) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS _asset_gc (asset TEXT PRIMARY KEY) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS _jobs (id TEXT PRIMARY KEY, name TEXT NOT NULL, args TEXT NOT NULL, program_hash TEXT NOT NULL, state TEXT NOT NULL, sweep INTEGER NOT NULL, cursor TEXT, upper TEXT, chunks INTEGER NOT NULL, rows_written INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error TEXT);",
        )?;
        conn.execute_batch("CREATE INDEX IF NOT EXISTS _sessions_expiry ON _sessions(expires_at);")?;
        crate::identity::initialize(&conn)?;
        let job_columns: Vec<String> = conn.prepare("SELECT name FROM pragma_table_info('_jobs')")?.query_map([], |row| row.get(0))?.collect::<Result<_, _>>()?;
        for column in ["chunk_size", "retries", "heap_peak"] {
            if !job_columns.contains(&column.to_owned()) { conn.execute_batch(&format!("ALTER TABLE _jobs ADD COLUMN {column} INTEGER NOT NULL DEFAULT 0;"))?; }
        }
        if !job_columns.iter().any(|column| column == "domain") { conn.execute_batch("ALTER TABLE _jobs ADD COLUMN domain TEXT;")?; }
        // @ref LLP 3000.038#4 — a file's sanitized name rides the ledger; older stores gain the column in place.
        let asset_columns: Vec<String> = conn.prepare("SELECT name FROM pragma_table_info('_assets')")?.query_map([], |row| row.get(0))?.collect::<Result<_, _>>()?;
        if !asset_columns.iter().any(|column| column == "name") { conn.execute_batch("ALTER TABLE _assets ADD COLUMN name TEXT;")?; }
        let op_columns: Vec<String> = conn.prepare("SELECT name FROM pragma_table_info('_ops')")?.query_map([], |row| row.get(0))?.collect::<Result<_, _>>()?;
        for (column, kind) in [("name", "TEXT"), ("args_digest", "TEXT"), ("at", "INTEGER")] {
            if !op_columns.iter().any(|name| name == column) {
                conn.execute_batch(&format!("ALTER TABLE _ops ADD COLUMN {column} {kind};"))?;
            }
        }
        // Discard payload columns from the pre-release binding implementation.
        for column in ["args", "result"] {
            if op_columns.iter().any(|name| name == column) {
                conn.execute_batch(&format!("ALTER TABLE _ops DROP COLUMN {column};"))?;
            }
        }
        crate::engine::actions::initialize(&conn)?;
        // The outbox grew a worker protocol (leases, backoff, results); a
        // store from before it gains the columns in place, once.
        let outbox_columns: Vec<String> = conn.prepare("SELECT name FROM pragma_table_info('_outbox')")?.query_map([], |row| row.get(0))?.collect::<Result<_, _>>()?;
        for (column, kind) in [("lease_until", "INTEGER"), ("claimed_by", "TEXT"), ("next_at", "INTEGER"), ("result", "TEXT"), ("error", "TEXT"), ("settled_at", "INTEGER"), ("work_spec", "TEXT"), ("deadline", "INTEGER"), ("release", "TEXT"), ("error_code", "TEXT"), ("lease_digest", "TEXT"), ("cancelled", "INTEGER NOT NULL DEFAULT 0"), ("contract", "TEXT")] {
            if !outbox_columns.iter().any(|name| name == column) {
                conn.execute_batch(&format!("ALTER TABLE _outbox ADD COLUMN {column} {kind};"))?;
            }
        }
        conn.execute_batch("CREATE INDEX IF NOT EXISTS _outbox_due ON _outbox(state, effect, seq);")?;
        conn.execute("INSERT OR IGNORE INTO _meta(key, value) VALUES ('version', ?1)", [STORE_VERSION])?;
        // @ref LLP 3000.007#18.2 — a database incarnation survives reopen, independently of schema generation.
        conn.execute("INSERT OR IGNORE INTO _meta(key, value) VALUES ('store_id', lower(hex(randomblob(16))))", [])?;
        Ok(())
    }

    pub(crate) fn check_selected_release(conn: &Connection, expected: Option<u64>) -> Result<(), RuntimeError> {
        if let Some(expected) = expected {
            let release: Option<String> = conn.query_row("SELECT value FROM _meta WHERE key = 'release'", [], |r| r.get(0)).optional()?;
            if release.as_deref().and_then(|s| s.parse::<u64>().ok()) != Some(expected) {
                return Err(RuntimeError::Generation("the current release changed while starting; retry serve".into()));
            }
        }
        Ok(())
    }

    // Closing an accepted backend may checkpoint normally. Failure to restore
    // this optional close-time optimization leaves the conservative setting;
    // it must not turn a committed acceptance into a returned refusal.
    pub(crate) fn accept_open(&self) {
        let _ = self.conn.set_db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, false);
    }

    pub fn transaction(&mut self) -> Result<Tx<'_>, RuntimeError> {
        self.check_ownership()?;
        // The write lock and identity check are one boundary: an engine
        // opened before another process activated a successor cannot write
        // or read with its stale schema/catalog.
        let tx = self.conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if activation::identity(&tx)? != self.identity {
            return Err(RuntimeError::Generation("the store adopted another backend; reopen this engine".into()));
        }
        Ok(Tx { activation_scan: None, changes: Default::default(), sequence_table: Default::default(), tx, page_size: self.page_size, catalog: &self.catalog })
    }

    /// A consistent read snapshot does not reserve SQLite's writer lock.
    pub fn read_transaction(&mut self) -> Result<Tx<'_>, RuntimeError> {
        self.check_ownership()?;
        let tx = self.conn.transaction_with_behavior(rusqlite::TransactionBehavior::Deferred)?;
        if activation::identity(&tx)? != self.identity {
            return Err(RuntimeError::Generation("the store adopted another backend; reopen this engine".into()));
        }
        Ok(Tx { activation_scan: None, changes: Default::default(), sequence_table: Default::default(), tx, page_size: self.page_size, catalog: &self.catalog })
    }

    /// One deferred snapshot for an authority walk from an API that only
    /// borrows the engine. Writer operations pass their existing `Tx` instead.
    pub(crate) fn authority_transaction(&self) -> Result<Tx<'_>, RuntimeError> {
        self.check_ownership()?;
        let tx = self.conn.unchecked_transaction()?;
        if activation::identity(&tx)? != self.identity {
            return Err(RuntimeError::Generation("the store adopted another backend; reopen this engine".into()));
        }
        Ok(Tx { activation_scan: None, changes: Default::default(), sequence_table: Default::default(), tx, page_size: self.page_size, catalog: &self.catalog })
    }

    /// An independent read connection, bound to this catalog and identity.
    pub fn reader(&self) -> Result<Self, RuntimeError> {
        self.check_ownership()?;
        let path = self.conn.path().filter(|path| !path.is_empty())
            .ok_or_else(|| RuntimeError::Store("an in-memory store has no independent reader".into()))?;
        let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        // @ref LLP 3000.019#3.4 — detached readers must answer from the owned database, not a replacement at its path.
        // Compare after opening, before reading. Stat only: closing another raw
        // database descriptor would discard this process's SQLite POSIX locks.
        #[cfg(unix)]
        if file_identity(&conn).ok().flatten() != self.file_identity {
            return Err(RuntimeError::Store(format!("owned database at {path} moved or was replaced; stop and reopen its current path")));
        }
        // This connection skips prepare's schema writes but needs the same
        // planning policy before any statements are cached.
        // @ref LLP 3000#7-decisions-during-execution — reuse SQLite plans across bound inputs
        conn.set_db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_ENABLE_QPSG, true)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        // A reader never owns the directory; only the store that made it removes it.
        let page_size = conn.query_row("PRAGMA page_size", [], |row| row.get::<_, i64>(0))? as u64;
        Ok(Self { #[cfg(test)] full_adoption: false, adoption_report: Default::default(), conn, ownership: self.ownership.clone(), #[cfg(unix)] file_identity: self.file_identity, page_size, catalog: self.catalog.clone(), assets_dir: self.assets_dir.clone(), ephemeral_assets: false, identity: self.identity.clone() })
    }

    pub(crate) fn exclude_ephemeral(&mut self, schema: &Schema) {
        self.catalog.retain(|name,_| !schema.tables.iter().any(|(table,t)| t.ephemeral.is_some() && (name == table || name.starts_with(&format!("{table}.")))));
    }
    pub fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        self.check_ownership()?;
        Ok(self.conn.prepare_cached("SELECT value FROM _meta WHERE key = ?1")?.query_row([key], |row| row.get(0)).optional()?)
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<(), RuntimeError> {
        self.check_ownership()?;
        self.conn.execute("INSERT INTO _meta(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, value])?;
        Ok(())
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    /// The last committed sequence number.
    pub fn seq(&self) -> Result<u64, RuntimeError> {
        self.check_ownership()?;
        Ok(self.conn.prepare_cached("SELECT COALESCE(MAX(seq), 0) FROM _commits")?.query_row([], |row| row.get::<_, i64>(0))? as u64)
    }

    /// Every row of a table, for fixtures, `data`, and tests.
    pub fn rows(&self, table: &str) -> Result<Vec<Value>, RuntimeError> {
        self.check_ownership()?;
        let Some(t) = self.catalog.get(table) else { return Ok(Vec::new()) };
        let mut statement = self.conn.prepare("SELECT data FROM r WHERE t = ?1 ORDER BY id")?;
        let rows = statement.query_map([t], |row| row.get::<_, String>(0))?;
        rows.map(|data| serde_json::from_str(&data?).map_err(|e| RuntimeError::Store(e.to_string()))).collect()
    }

    /// A bounded administrative table listing, including whether another row exists.
    pub fn rows_limited(&self, table: &str, limit: usize) -> Result<(Vec<Value>, bool), RuntimeError> {
        self.check_ownership()?;
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
        self.check_ownership()?;
        Ok(self.conn.prepare_cached("SELECT outcome FROM _ops WHERE principal = ?1 AND id = ?2")?.query_row(params![principal, id], |row| row.get::<_, String>(0)).optional()?)
    }

    pub fn applied_ops(&self) -> Result<u64, RuntimeError> {
        self.check_ownership()?;
        Ok(self.conn.prepare_cached("SELECT COUNT(*) FROM _ops WHERE outcome LIKE '%\"state\":\"sent\"%'")?.query_row([], |row| row.get::<_, i64>(0))? as u64)
    }

    pub fn count(&self, table: &str) -> Result<u64, RuntimeError> {
        self.check_ownership()?;
        let Some(t) = self.catalog.get(table) else { return Ok(0) };
        Ok(self.conn.prepare_cached("SELECT COUNT(*) FROM r WHERE t = ?1")?.query_row([t], |row| row.get::<_, i64>(0))? as u64)
    }

    /// What the store weighs, by part: the rows, their index entries, the
    /// partition log (one row per recipient per event), the op records,
    /// and the file. `doctor` prints it; the log's ratio to the rows is the
    /// amplification the per-recipient log costs.
    pub fn sizes(&self) -> Result<Sizes, RuntimeError> {
        self.check_ownership()?;
        let sum = |sql: &str| -> Result<u64, RuntimeError> { Ok(self.conn.query_row(sql, [], |row| row.get::<_, Option<i64>>(0))?.unwrap_or(0).max(0) as u64) };
        // Read-only inspection also works before the next writer migrates _ops.
        let columns: Vec<String> = self.conn.prepare("SELECT name FROM pragma_table_info('_ops')")?
            .query_map([], |row| row.get(0))?.collect::<Result<_, _>>()?;
        let binding_sizes = ["name", "args_digest", "at"].into_iter().filter(|name| columns.iter().any(|column| column == name))
            .map(|name| format!(" + COALESCE(LENGTH({name}), 0)")).collect::<String>();
        Ok(Sizes {
            rows: sum("SELECT SUM(LENGTH(data) + LENGTH(id)) FROM r")?,
            row_count: sum("SELECT COUNT(*) FROM r")?,
            indexes: sum("SELECT SUM(LENGTH(k) + LENGTH(id)) FROM i")?,
            log: sum("SELECT SUM(COALESCE(LENGTH(data), 0) + LENGTH(id) + LENGTH(partition) + LENGTH(t)) FROM _log")?,
            log_events: sum("SELECT COUNT(*) FROM _log")?,
            ops: sum(&format!("SELECT SUM(LENGTH(outcome) + LENGTH(id) + LENGTH(principal) + LENGTH(seq){binding_sizes}) FROM _ops"))?,
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
        self.clear_activation_scan();
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
        self.conn().execute_batch(&format!("SAVEPOINT {name}"))?;
        Ok(())
    }

    pub fn release(&self, name: &str) -> Result<(), RuntimeError> {
        self.conn().execute_batch(&format!("RELEASE {name}"))?;
        Ok(())
    }

    /// Roll back the named savepoint and release it in the same operation.
    pub fn rollback_to(&self, name: &str) -> Result<(), RuntimeError> {
        self.clear_activation_scan();
        self.changes.borrow_mut().widen();
        self.conn().execute_batch(&format!("ROLLBACK TO {name}; RELEASE {name}"))?;
        // Lazy sequence-table creation may have belonged to this savepoint.
        self.sequence_table.set(None);
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
        let mut rows = statement.query(params![t, ti, lo, hi, limit as i64])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let data = row.get_ref(0)?.as_str().map_err(|e| RuntimeError::Store(e.to_string()))?;
            out.push((serde_json::from_str(data).map_err(|e| RuntimeError::Store(e.to_string()))?, row.get(1)?));
        }
        Ok(out)
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
        self.put_indexed(table_name, table, row, old, "INSERT INTO i(ti, k, id) VALUES (?1, ?2, ?3)")
    }

    /// A replacement loader has already cleared the rows and created its
    /// temporary index heap. It must install those indexes before any read.
    // @ref LLP 3000.007#20.4 — native replacement sorts complete indexes inside the publication transaction.
    pub fn put_loading_indexes(&self, table_name: &str, table: &Table, row: &Value) -> Result<u64, RuntimeError> {
        self.put_indexed(table_name, table, row, None, "INSERT INTO temp._device_index_load(ti, k, id) VALUES (?1, ?2, ?3)")
    }

    fn put_indexed(&self, table_name: &str, table: &Table, row: &Value, old: Option<&Value>, insert_index: &str) -> Result<u64, RuntimeError> {
        self.clear_activation_scan();
        if table.ephemeral.is_some() { return Err(RuntimeError::Store("durable transaction cannot write an ephemeral table".into())); }
        let t = self.num(table_name)?;
        let id = row.field("id")?.as_str()?;
        let keys = crate::rows::index_write(table_name, table, row, old, id)?;
        self.changes.borrow_mut().record(table_name, table, old, Some(row));
        let data = canonical_json(row);
        let sql = if old.is_some() { "UPDATE r SET data = ?3 WHERE t = ?1 AND id = ?2" } else { "INSERT INTO r(t, id, data) VALUES (?1, ?2, ?3)" };
        self.tx.prepare_cached(sql)?.execute(params![t, id, data])?;
        let mut insert = self.tx.prepare_cached(insert_index)?;
        let mut entries = 0;
        for crate::rows::IndexWrite { name, before, after } in keys {
            if before == after { continue; }
            let ti = self.num(&format!("{table_name}.{name}"))?;
            for key in before.iter().filter(|key| !after.contains(key)) {
                self.conn().prepare_cached("DELETE FROM i WHERE ti = ?1 AND k = ?2")?.execute(params![ti, key])?;
                entries += 1;
            }
            for key in after.iter().filter(|key| !before.contains(key)) {
                insert.execute(params![ti, key, id])?;
                entries += 1;
            }
        }
        entries += self.update_cap_counts(table_name, table, old, Some(row))?;
        Ok(entries)
    }

    pub fn delete(&self, table_name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> {
        self.clear_activation_scan();
        if table.ephemeral.is_some() { return Err(RuntimeError::Store("durable transaction cannot write an ephemeral table".into())); }
        let t = self.num(table_name)?;
        self.changes.borrow_mut().record(table_name, table, Some(old), None);
        let id = old.field("id")?.as_str()?.to_owned();
        self.conn().prepare_cached("DELETE FROM r WHERE t = ?1 AND id = ?2")?.execute(params![t, id])?;
        let mut entries = 0;
        for (index_name, index) in &table.indexes {
            let ti = self.num(&format!("{table_name}.{index_name}"))?;
            for key in stored_index_keys(table, index, old, &id) {
                self.conn().prepare_cached("DELETE FROM i WHERE ti = ?1 AND k = ?2")?.execute(params![ti, key])?;
                entries += 1;
            }
        }
        entries += self.update_cap_counts(table_name, table, Some(old), None)?;
        Ok(entries)
    }

    pub fn next_seq(&self) -> Result<u64, RuntimeError> {
        Ok(self.tx.prepare_cached("SELECT COALESCE(MAX(seq), 0) + 1 FROM _commits")?.query_row([], |row| row.get::<_, i64>(0))? as u64)
    }

    /// A meta key written with the transaction (a device's watermark lands
    /// with the rows it covers).
    pub fn set_meta(&self, key: &str, value: &str) -> Result<(), RuntimeError> {
        self.conn().execute("INSERT INTO _meta(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![key, value])?;
        Ok(())
    }

    pub(crate) fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        Ok(self.tx.prepare_cached("SELECT value FROM _meta WHERE key = ?1")?.query_row([key], |row| row.get(0)).optional()?)
    }

    pub fn record_commit(&self, seq: u64, at: i64, program: &str, principal: &str, kind: &str, touched: &[String], writes: u64) -> Result<(), RuntimeError> {
        if !self.changes.borrow().covers(touched) { self.changes.borrow_mut().widen(); }
        self.conn().execute("INSERT INTO _change_evidence(seq, footprint) VALUES (?1, ?2)", params![seq as i64, canonical_json(&self.changes.borrow().footprint())])?;
        // @ref LLP 3000.023#12 — retain twice the 500-commit certification
        // window. Pruning rolls back with the commit; older intervals widen.
        self.conn().prepare_cached("DELETE FROM _change_evidence WHERE seq <= ?1")?.execute([seq.saturating_sub(1000) as i64])?;
        self.conn().prepare_cached("INSERT INTO _commits(seq, at, program, principal, kind, touched, writes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")?.execute(params![seq as i64, at, program, principal, kind, canonical_json(&touched), writes as i64],
        )?;
        Ok(())
    }

    /// The outcome recorded for a client-minted operation id, if it applied.
    pub fn applied(&self, principal: &str, id: &str) -> Result<Option<(u64, String)>, RuntimeError> {
        Ok(self.tx.prepare_cached("SELECT seq, outcome FROM _ops WHERE principal = ?1 AND id = ?2")?.query_row(params![principal, id], |row| Ok((row.get::<_, i64>(0)? as u64, row.get::<_, String>(1)?))).optional()?)
    }

    pub fn record_applied(&self, principal: &str, id: &str, seq: u64, outcome: &str) -> Result<(), RuntimeError> {
        self.conn().prepare_cached("INSERT INTO _ops(principal, id, seq, outcome) VALUES (?1, ?2, ?3, ?4)")?.execute(params![principal, id, seq as i64, outcome])?;
        Ok(())
    }

    pub fn bind_applied(&self, principal: &str, id: &str, name: &str, args: &serde_json::Value, at: i64) -> Result<(), RuntimeError> {
        self.conn().execute("UPDATE _ops SET name = ?3, args_digest = ?4, at = ?5 WHERE principal = ?1 AND id = ?2",
            params![principal, id, name, payload_digest(args), at])?;
        Ok(())
    }

    pub fn append_log(&self, partition: &str, seq: u64, ord: u32, table: &str, kind: &str, id: &str, data: Option<&str>) -> Result<(), RuntimeError> {
        self.conn().prepare_cached("INSERT INTO _log(partition, seq, ord, t, kind, id, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")?.execute(params![partition, seq as i64, ord as i64, table, kind, id, data],
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
    // @ref LLP 3000.007#20.24.4 — SQ measurements retain the native server policy.
    #[test]
    fn sqlite_openers_keep_the_measured_cache_mmap_and_durability_policy() {
        let path = std::env::temp_dir().join(format!("snapback4-pragmas-{}-{:x}", std::process::id(), crate::ids::seed()));
        std::fs::create_dir(&path).unwrap();
        {
            let writer = Store::open(&path.join("store.sqlite")).unwrap();
            let reader = writer.reader().unwrap();
            let inspection = Store::open_read_only(&path.join("store.sqlite")).unwrap();
            for (store, foreign_keys) in [(&writer, 0), (&reader, 1), (&inspection, 1)] {
                let conn = store.conn();
                let mode: String = conn.query_row("PRAGMA journal_mode", [], |row| row.get(0)).unwrap();
                assert_eq!(mode, "wal");
                for (pragma, expected) in [
                    ("synchronous", 2), ("foreign_keys", foreign_keys), ("cache_size", -2000),
                    ("mmap_size", 0), ("wal_autocheckpoint", 1000), ("journal_size_limit", -1),
                ] {
                    let actual: i64 = conn.query_row(&format!("PRAGMA {pragma}"), [], |row| row.get(0)).unwrap();
                    assert_eq!(actual, expected, "{pragma}");
                }
            }
            for store in [&reader, &inspection] {
                let error = store.conn().execute("UPDATE _meta SET value = 'not-written' WHERE key = 'version'", []).unwrap_err();
                assert_eq!(error.sqlite_error_code(), Some(rusqlite::ErrorCode::ReadOnly));
            }
            assert_eq!(writer.meta("version").unwrap().as_deref(), Some(STORE_VERSION));
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

/// One SQLite scan's physical memory guard (word_heap::StoreGuard): sixteen
/// times the default 16 MiB heap ceiling. A scan within any ordinary ceiling
/// reserves at most about twice its public charge plus two pages.
pub const SCAN_MEMORY_GUARD: u64 = 256 << 20;

impl crate::rows::Rows for Tx<'_> {
    fn change_footprint(&self) -> crate::revocation::Footprint { self.changes.borrow().footprint() }
    fn widen_change_evidence(&self) { self.changes.borrow_mut().widen(); }
    fn sequence_value(&self, parent: &str, id: &str) -> Result<i64, RuntimeError> {
        if !self.has_sequence_table()? { return Ok(0); }
        Ok(self.conn().query_row("SELECT value FROM _sequences WHERE parent = ?1 AND id = ?2", params![parent, id], |r| r.get(0)).optional()?.unwrap_or(0))
    }
    fn set_sequence(&self, parent: &str, id: &str, value: i64) -> Result<(), RuntimeError> {
        self.ensure_sequence_table()?;
        self.conn().execute("INSERT INTO _sequences VALUES (?1, ?2, ?3) ON CONFLICT(parent, id) DO UPDATE SET value = excluded.value", params![parent, id, value])?;
        Ok(())
    }

    fn effect_once(&self, effect: &str, key: &str) -> Result<bool, RuntimeError> {
        // Opening an old store must not change it before a backend can refuse.
        // @ref LLP 3000.013#5.3 — table and key commit with the emission; existing keys survive reopen.
        self.conn().execute_batch("CREATE TABLE IF NOT EXISTS _effect_keys (effect TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY(effect, key)) WITHOUT ROWID;")?;
        Ok(self.conn().execute("INSERT OR IGNORE INTO _effect_keys(effect, key) VALUES (?1, ?2)", params![effect, key])? != 0)
    }

    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        Tx::get(self, table, id)
    }
    fn lookup(&self, table: &str, index_name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> {
        Tx::lookup(self, table, index_name, index, key)
    }
    fn scan(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        Tx::scan(self, table, index_name, prefix, bounds, dir, limit)
    }
    fn index_head(&self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir) -> Result<Option<Vec<Value>>, RuntimeError> {
        let Some((lo,hi)) = crate::rows::scan_range(prefix,bounds,dir) else { return Ok(None); };
        let ti = self.num(&format!("{table}.{index}"))?;
        let key: Option<Vec<u8>> = self.tx.prepare_cached(if dir == Dir::Asc { "SELECT k FROM i WHERE ti = ?1 AND k >= ?2 AND k < ?3 ORDER BY k LIMIT 1" } else { "SELECT k FROM i WHERE ti = ?1 AND k >= ?2 AND k < ?3 ORDER BY k DESC LIMIT 1" })?.query_row(params![ti,lo,hi], |row|row.get(0)).optional()?;
        Ok(key.and_then(|key|crate::key::decode(&key)))
    }
    #[cfg(feature = "server-search")]
    fn scan_selected(&self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, fields: &[String]) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        let Some((lo,hi)) = crate::rows::scan_range(prefix,bounds,dir) else { return Ok(Vec::new()) };
        let mut statement = self.tx.prepare_cached(scan_sql(dir))?;
        let mut rows = statement.query(params![self.num(table)?, self.num(&format!("{table}.{index}"))?, lo, hi, 1])?;
        let Some(row) = rows.next()? else { return Ok(Vec::new()) };
        let data = row.get_ref(0)?.as_str().map_err(|e|RuntimeError::Store(e.to_string()))?;
        Ok(vec![(selected::decode(data, fields)?, row.get(1)?)])
    }
    fn scan_metered(&self, table: &str, index_name: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize, scope: &crate::engine::Authorization, meter: &mut crate::engine::InternalMeter<'_>) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
        use crate::rows::word_heap as heap;
        // @ref LLP 3000.007#20.24.5 — the public charge is the shared logical one; SQLite's own scratch is guarded.
        heap::scan_open(meter, table, index_name, prefix, bounds, scope)?;
        let mut guard = heap::StoreGuard::open(meter, SCAN_MEMORY_GUARD);
        let Some((lo, hi)) = crate::rows::scan_range(prefix, bounds, dir) else { return Ok(Vec::new()) };
        let t = self.num(table)?;
        let ti = self.num(&format!("{table}.{index_name}"))?;
        // @ref LLP 3000.007#20.24.1 — stream preflight allowances before stepping to the next row.
        // Per-execution statement storage and the page cache are shared images outside this ledger, as for every store scan; engine/word_heap/tests.rs::sqlite_empty_scan_statement_storage_is_pinned_and_transient pins the excluded execution storage.
        // Within one preflight execution the first row's resident copy (one
        // page_size buffer per column, two registers) precedes its guard
        // reservation; every later row's copy follows the previous row's.
        // The guard prepays that first copy. BYTELENARG / LENGTHARG never read
        // overflow payloads; Rust borrows the payload statement's JSON.
        guard.reserve(meter, 2 * self.page_size)?;
        if limit == 1 && dir == Dir::Asc
            && let Some(head) = self.activation_head(t, ti, &lo, &hi)? {
            let Some((data, key)) = head else { return Ok(Vec::new()); };
            let mut preflight = heap::Preflight::new();
            preflight.entry(meter, &mut guard, data.len() as u64, key.len() as u64, 64)?;
            let additional = heap::scan_entry(meter, &mut guard, 0, 0, &data, &key)?;
            let mut out = Vec::with_capacity(additional);
            out.push((serde_json::from_str(&data).map_err(|e| RuntimeError::Store(e.to_string()))?, key));
            return Ok(out);
        }
        let sizes = match dir {
            Dir::Asc => "SELECT octet_length(r.data), length(i.k) FROM i JOIN r ON r.t = ?1 AND r.id = i.id WHERE i.ti = ?2 AND i.k >= ?3 AND i.k < ?4 ORDER BY i.k ASC LIMIT ?5",
            Dir::Desc => "SELECT octet_length(r.data), length(i.k) FROM i JOIN r ON r.t = ?1 AND r.id = i.id WHERE i.ti = ?2 AND i.k >= ?3 AND i.k < ?4 ORDER BY i.k DESC LIMIT ?5",
        };
        let mut preflight = heap::Preflight::new();
        {
            let mut statement = self.tx.prepare_cached(sizes)?;
            let mut rows = statement.query(params![t, ti, lo, hi, limit as i64])?;
            // Refusal drops/resets this statement without stepping again.
            while let Some(row) = rows.next()? {
                // Two payload copies and two allocation headers/alignment per row.
                if !preflight.entry(meter, &mut guard, row.get::<_, i64>(0)? as u64, row.get::<_, i64>(1)? as u64, 64)? { break; }
            }
        }
        // The preflight and payload read share this transaction's snapshot.
        // An empty preflight already proves the result; avoid seeking the same
        // absent range again.
        // @ref LLP 3000.007#20.24.1 — empty preflights need no payload statement.
        if preflight.entries == 0 { return Ok(Vec::new()); }
        let mut statement = self.tx.prepare_cached(scan_sql(dir))?;
        let mut rows = statement.query(params![t, ti, lo, hi, preflight.entries as i64])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            // SQLite lends these bytes; no JSON String, Value or key Vec exists
            // until this allowance succeeds. Nominal IDs have no schema max.
            let data = row.get_ref(0)?.as_str().map_err(|e| RuntimeError::Store(e.to_string()))?;
            let key = row.get_ref(1)?.as_blob().map_err(|e| RuntimeError::Store(e.to_string()))?;
            let additional = heap::scan_entry(meter, &mut guard, out.len(), out.capacity(), data, key)?;
            if additional != 0 { out.reserve_exact(additional); }
            out.push((serde_json::from_str(data).map_err(|e| RuntimeError::Store(e.to_string()))?, key.to_vec()));
        }
        preflight.check()?;
        Ok(out)
    }
    fn cap_count(&self, table: &str, by: &[String], group: &[Value]) -> Result<u64, RuntimeError> {
        self.physical_cap_count(table, by, group)
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
    fn release_asset(&self, id: &str, table: &str, row_id: &str, column: &str, now: i64) -> Result<(), RuntimeError> {
        Tx::release_asset(self, id, table, row_id, column, now)
    }
}

/// Canonical plain JSON, including recursively sorted object keys.
pub fn canonical_payload(value: &serde_json::Value) -> String {
    let mut value = value.clone();
    value.sort_all_objects();
    value.to_string()
}

pub fn payload_digest(value: &serde_json::Value) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(canonical_payload(value).as_bytes()))
}

pub fn id_reused() -> RuntimeError {
    RuntimeError::Structural { code: "E_ID_REUSED", message: "this id already admitted another operation or different arguments; use the original operation and arguments, or mint a new id".into() }
}

pub(crate) fn replay_bound(conn: &Connection, principal: &str, id: &str, name: &str, args: &serde_json::Value) -> Result<Option<String>, RuntimeError> {
    let recorded: Option<(String, Option<String>, Option<String>)> = conn.query_row(
        "SELECT outcome, name, args_digest FROM _ops WHERE principal = ?1 AND id = ?2", params![principal, id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).optional()?;
    let Some((outcome, recorded_name, recorded_digest)) = recorded else { return Ok(None); };
    // NULL is an old receipt with no binding, never a mismatch.
    if recorded_name.as_deref().is_some_and(|old| old != name)
        || recorded_digest.is_some_and(|old| old != payload_digest(args)) { return Err(id_reused()); }
    Ok(Some(outcome))
}

// Server-only volatile history reads; no persisted catalog or device change.
mod following_history;
