//! Durable SQLite storage and engine-owned system tables.
// @ref LLP 1001#1-store-storers — the store owns SQLite setup, system tables, and snapshots.

use crate::engine::RuntimeError;
use crate::value::Value;
use rusqlite::backup::Backup;
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[cfg(unix)]
use std::ffi::CStr;
#[cfg(unix)]
use std::os::raw::{c_char, c_int};
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

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxCounts {
    pub queued: u64,
    pub running: u64,
    pub then_pending: u64,
    pub sent: u64,
    pub failed: u64,
    pub sent_unknown: u64,
}

pub struct Store {
    pub(crate) conn: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, RuntimeError> {
        let connection = Connection::open(path)?;
        let owner = owner_stamp();
        let acquired = (|| -> rusqlite::Result<()> {
            connection.busy_timeout(Duration::from_millis(500))?;
            connection.pragma_update(None, "foreign_keys", "OFF")?;
            connection.pragma_update(None, "journal_mode", "WAL")?;
            connection.pragma_update(None, "locking_mode", "EXCLUSIVE")?;
            connection.execute_batch("BEGIN IMMEDIATE")?;
            Self::initialize_schema(&connection)?;
            connection.execute(
                "INSERT INTO _meta(key, value) VALUES ('owner', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [&owner],
            )?;
            connection.execute_batch("COMMIT")?;
            // Keep the owner readable from the main database file even while
            // EXCLUSIVE mode prevents a competing connection from reading WAL.
            connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
            connection.busy_timeout(Duration::from_secs(5))?;
            Ok(())
        })();
        match acquired {
            Ok(()) => Ok(Self { conn: connection }),
            Err(error) if sqlite_is_locked(&error) => Err(RuntimeError::StoreOwned {
                holder: persisted_owner(path).unwrap_or_else(|| "unknown".to_owned()),
            }),
            Err(error) => Err(error.into()),
        }
    }

    pub fn memory() -> Result<Self, RuntimeError> {
        let connection = Connection::open_in_memory()?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "OFF")?;
        Self::initialize_schema(&connection)?;
        Ok(Self { conn: connection })
    }

    fn initialize_schema(connection: &Connection) -> rusqlite::Result<()> {
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
        Ok(())
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

    pub fn outbox_counts(&self) -> Result<OutboxCounts, RuntimeError> {
        let counts = self.conn.query_row(
            "SELECT
                COALESCE(SUM(CASE WHEN state = 'queued' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN state = 'running' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN state = 'then_pending' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN state = 'sent' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN state = 'sent_unknown' THEN 1 ELSE 0 END), 0)
             FROM _outbox",
            [],
            |row| {
                Ok(OutboxCounts {
                    queued: row.get::<_, i64>(0)?.max(0) as u64,
                    running: row.get::<_, i64>(1)?.max(0) as u64,
                    then_pending: row.get::<_, i64>(2)?.max(0) as u64,
                    sent: row.get::<_, i64>(3)?.max(0) as u64,
                    failed: row.get::<_, i64>(4)?.max(0) as u64,
                    sent_unknown: row.get::<_, i64>(5)?.max(0) as u64,
                })
            },
        )?;
        Ok(counts)
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

fn sqlite_is_locked(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(sqlite, _)
            if matches!(
                sqlite.code,
                rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
            )
    )
}

fn persisted_owner(path: &Path) -> Option<String> {
    let uri = format!("file:{}?immutable=1", sqlite_uri_path(path));
    let connection = Connection::open_with_flags(
        uri,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    connection
        .query_row("SELECT value FROM _meta WHERE key = 'owner'", [], |row| {
            row.get(0)
        })
        .optional()
        .ok()?
}

fn sqlite_uri_path(path: &Path) -> String {
    let mut encoded = String::new();
    for byte in path.to_string_lossy().bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn owner_stamp() -> String {
    format!("{}@{}:{}", std::process::id(), hostname(), unix_millis())
}

#[cfg(unix)]
fn hostname() -> String {
    unsafe extern "C" {
        fn gethostname(name: *mut c_char, len: usize) -> c_int;
    }

    let mut buffer = [0_u8; 256];
    // SAFETY: `buffer` is writable for its full declared length. A successful
    // gethostname call leaves a C string because the zeroed buffer has spare room.
    let result = unsafe { gethostname(buffer.as_mut_ptr().cast(), buffer.len() - 1) };
    if result == 0 {
        // SAFETY: the buffer began zeroed and gethostname received one byte less
        // than its capacity, so a trailing NUL remains in bounds.
        let hostname = unsafe { CStr::from_ptr(buffer.as_ptr().cast()) };
        hostname.to_string_lossy().into_owned()
    } else {
        "unknown-host".to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outbox_counts_reads_each_durable_lifecycle_state() {
        let store = Store::memory().unwrap();
        for (index, state) in [
            "queued",
            "running",
            "then_pending",
            "sent",
            "failed",
            "sent_unknown",
        ]
        .into_iter()
        .enumerate()
        {
            store
                .conn
                .execute(
                    "INSERT INTO _outbox(
                        id, seq, effect, payload, state, attempts, next_at,
                        last_error, result, created_at, updated_at
                     ) VALUES (?1, 1, 'test', 'Null', ?2, 0, 0, NULL, NULL, 0, 0)",
                    params![format!("outbox-{index}"), state],
                )
                .unwrap();
        }
        assert_eq!(
            store.outbox_counts().unwrap(),
            OutboxCounts {
                queued: 1,
                running: 1,
                then_pending: 1,
                sent: 1,
                failed: 1,
                sent_unknown: 1,
            }
        );
    }
}

#[cfg(not(unix))]
fn hostname() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown-host".to_owned())
}
