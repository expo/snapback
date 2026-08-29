//! Durable SQLite storage and engine-owned system tables.
// @ref LLP 1001#1-store-storers — the store owns SQLite setup, system tables, and snapshots.

use crate::engine::RuntimeError;
use crate::value::Value;
use rusqlite::backup::Backup;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const STORE_VERSION: &str = "1";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TouchedKey {
    pub table: String,
    pub index: String,
    pub key: Vec<Value>,
    pub row_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRecord {
    pub seq: u64,
    pub at: i64,
    pub program: String,
    pub principal: String,
    pub kind: String,
    pub touched: Vec<TouchedKey>,
    pub writes: BTreeMap<String, u64>,
    pub emits: u64,
}

pub struct Store {
    pub(crate) conn: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, RuntimeError> {
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "OFF")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        Self::initialize(connection)
    }

    pub fn memory() -> Result<Self, RuntimeError> {
        let connection = Connection::open_in_memory()?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "OFF")?;
        Self::initialize(connection)
    }

    fn initialize(connection: Connection) -> Result<Self, RuntimeError> {
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS rows (
                table_name TEXT NOT NULL,
                row_id TEXT NOT NULL,
                data TEXT NOT NULL,
                PRIMARY KEY (table_name, row_id)
             );
             CREATE TABLE IF NOT EXISTS index_entries (
                table_name TEXT NOT NULL,
                index_name TEXT NOT NULL,
                row_id TEXT NOT NULL,
                c0 TEXT, c1 TEXT, c2 TEXT, c3 TEXT,
                c4 TEXT, c5 TEXT, c6 TEXT, c7 TEXT,
                PRIMARY KEY (table_name, index_name, row_id)
             );
             CREATE INDEX IF NOT EXISTS index_entries_lookup ON index_entries(
                table_name, index_name, c0, c1, c2, c3, c4, c5, c6, c7, row_id
             );
             CREATE TABLE IF NOT EXISTS _meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS _commits (
                seq INTEGER PRIMARY KEY,
                at INTEGER NOT NULL,
                program TEXT NOT NULL,
                principal TEXT NOT NULL,
                kind TEXT NOT NULL,
                touched TEXT NOT NULL,
                writes TEXT NOT NULL,
                emits INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS _outbox (
                id TEXT PRIMARY KEY,
                seq INTEGER NOT NULL,
                effect TEXT NOT NULL,
                payload TEXT NOT NULL,
                state TEXT NOT NULL,
                attempts INTEGER NOT NULL,
                next_at INTEGER NOT NULL,
                last_error TEXT,
                result TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS _outbox_state_next_at
                ON _outbox(state, next_at);
             CREATE TABLE IF NOT EXISTS _principals (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                name TEXT,
                created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS _credentials (
                principal TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                hash TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS _sessions (
                token TEXT PRIMARY KEY,
                principal TEXT NOT NULL,
                kind TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
             );",
        )?;
        let now = unix_millis();
        connection.execute(
            "INSERT OR IGNORE INTO _meta(key, value) VALUES ('created_at', ?1)",
            [now.to_string()],
        )?;
        connection.execute(
            "INSERT OR IGNORE INTO _meta(key, value) VALUES ('store_version', ?1)",
            [STORE_VERSION],
        )?;
        connection.execute(
            "INSERT OR IGNORE INTO _principals(id, kind, name, created_at)
             VALUES ('system', 'system', 'system', ?1)",
            [now],
        )?;
        Ok(Self { conn: connection })
    }

    pub fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        self.conn
            .query_row("SELECT value FROM _meta WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(Into::into)
    }

    pub fn set_meta(&mut self, key: &str, value: &str) -> Result<(), RuntimeError> {
        self.conn.execute(
            "INSERT INTO _meta(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn commit_seq(&self) -> Result<u64, RuntimeError> {
        let sequence: Option<i64> =
            self.conn
                .query_row("SELECT MAX(seq) FROM _commits", [], |row| row.get(0))?;
        Ok(sequence.unwrap_or(0).max(0) as u64)
    }

    pub fn commits_since(&self, seq: u64, limit: usize) -> Result<Vec<CommitRecord>, RuntimeError> {
        let mut statement = self.conn.prepare(
            "SELECT seq, at, program, principal, kind, touched, writes, emits
             FROM _commits WHERE seq > ?1 ORDER BY seq ASC LIMIT ?2",
        )?;
        let rows = statement.query_map(params![seq as i64, limit as i64], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, i64>(7)?,
            ))
        })?;
        rows.map(|row| {
            let (seq, at, program, principal, kind, touched, writes, emits) = row?;
            Ok(CommitRecord {
                seq: seq.max(0) as u64,
                at,
                program,
                principal,
                kind,
                touched: serde_json::from_str(&touched)
                    .map_err(|error| RuntimeError::Serialization(error.to_string()))?,
                writes: serde_json::from_str(&writes)
                    .map_err(|error| RuntimeError::Serialization(error.to_string()))?,
                emits: emits.max(0) as u64,
            })
        })
        .collect()
    }

    pub fn snapshot_to(&self, path: &Path) -> Result<(), RuntimeError> {
        let mut destination = Connection::open(path)?;
        let backup = Backup::new(&self.conn, &mut destination)?;
        backup.run_to_completion(64, Duration::from_millis(5), None)?;
        Ok(())
    }

    pub fn reset_data(&mut self) -> Result<(), RuntimeError> {
        let transaction = self.conn.transaction()?;
        transaction.execute_batch(
            "DELETE FROM index_entries;
             DELETE FROM rows;
             DELETE FROM _commits;
             DELETE FROM _outbox;",
        )?;
        transaction.commit()?;
        Ok(())
    }
}

pub(crate) fn unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
