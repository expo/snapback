//! Durable SQLite storage and engine-owned system tables.
// @ref LLP 1001#1-store-storers — the store owns SQLite setup, system tables, and snapshots.

use crate::engine::RuntimeError;
use crate::registry::EffectDecl;
use crate::value::Value;
use rusqlite::backup::Backup;
use rusqlite::{Connection, OpenFlags, OptionalExtension, params, params_from_iter};
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxRow {
    pub id: String,
    pub seq: u64,
    pub effect: String,
    pub payload: Value,
    pub state: String,
    pub attempts: u32,
    pub next_at: i64,
    pub last_error: Option<String>,
    pub result: Option<serde_json::Value>,
    pub then_op: Option<String>,
    /// Project generation active when this row was claimed. The retained
    /// declaration metadata for that generation binds restart replay.
    pub generation: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
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
                then_op TEXT,
                generation TEXT,
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
        ensure_column(connection, "_outbox", "then_op", "TEXT")?;
        ensure_column(connection, "_outbox", "generation", "TEXT")?;
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

    /// Fail queued rows outside `declared_names`, then claim the oldest ready
    /// declared row and bind it to the current effect declaration. Unknown
    /// settlement, selection, `running`, the attempt increment, and the binding
    /// are committed together before any row leaves the writer.
    // @ref LLP 1003#2-the-outbox-lifecycle — a claim is atomic and binds restart replay to its declaration.
    pub fn outbox_claim_next(
        &self,
        now: i64,
        declared_names: &[String],
    ) -> Result<Option<OutboxRow>, RuntimeError> {
        let transaction = self.conn.unchecked_transaction()?;
        let placeholders = (0..declared_names.len())
            .map(|index| format!("?{}", index + 2))
            .collect::<Vec<_>>()
            .join(", ");
        let unknown_predicate = if declared_names.is_empty() {
            String::new()
        } else {
            format!(" AND effect NOT IN ({placeholders})")
        };
        let unknown_sql = format!(
            "UPDATE _outbox
             SET state = 'failed', last_error = 'E_EFFECT_UNKNOWN', updated_at = ?1
             WHERE state = 'queued'{unknown_predicate}"
        );
        transaction.execute(
            &unknown_sql,
            params_from_iter(
                std::iter::once(&now as &dyn rusqlite::ToSql).chain(
                    declared_names
                        .iter()
                        .map(|name| name as &dyn rusqlite::ToSql),
                ),
            ),
        )?;
        if declared_names.is_empty() {
            transaction.commit()?;
            return Ok(None);
        }
        let candidate_sql = format!(
            "SELECT id, effect FROM _outbox
             WHERE state = 'queued' AND next_at <= ?1 AND effect IN ({placeholders})
             ORDER BY next_at ASC, created_at ASC, id ASC LIMIT 1"
        );
        let candidate = transaction
            .query_row(
                &candidate_sql,
                params_from_iter(
                    std::iter::once(&now as &dyn rusqlite::ToSql).chain(
                        declared_names
                            .iter()
                            .map(|name| name as &dyn rusqlite::ToSql),
                    ),
                ),
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let Some((id, effect)) = candidate else {
            transaction.commit()?;
            return Ok(None);
        };
        let effects = transaction
            .query_row(
                "SELECT value FROM _meta WHERE key = 'effects_json'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .map(|json| {
                serde_json::from_str::<BTreeMap<String, EffectDecl>>(&json)
                    .map_err(|error| RuntimeError::Serialization(error.to_string()))
            })
            .transpose()?
            .unwrap_or_default();
        let declaration = effects.get(&effect).ok_or_else(|| {
            RuntimeError::Serialization(format!(
                "declared effect {effect} is missing from current store metadata"
            ))
        })?;
        let then_op = declaration.then.as_deref();
        let generation = transaction
            .query_row(
                "SELECT value FROM _meta WHERE key = 'generation'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let changed = transaction.execute(
            "UPDATE _outbox
             SET state = 'running', attempts = attempts + 1,
                 then_op = ?1, generation = ?2, updated_at = ?3
             WHERE id = ?4 AND state = 'queued' AND next_at <= ?3",
            params![then_op, generation, now, id],
        )?;
        if changed != 1 {
            transaction.commit()?;
            return Ok(None);
        }
        let claimed = outbox_get_connection(&transaction, &id)?;
        transaction.commit()?;
        Ok(claimed)
    }

    pub fn outbox_settle(
        &self,
        id: &str,
        state: &str,
        result: Option<&serde_json::Value>,
        last_error: Option<&str>,
        next_at: Option<i64>,
    ) -> Result<(), RuntimeError> {
        if !matches!(state, "queued" | "then_pending" | "sent" | "failed") {
            return Err(RuntimeError::Input(format!(
                "invalid outbox settlement state {state}"
            )));
        }
        let now = unix_millis();
        let result = result
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| RuntimeError::Serialization(error.to_string()))?;
        let changed = self.conn.execute(
            "UPDATE _outbox SET
                state = ?1,
                result = ?2,
                last_error = ?3,
                next_at = COALESCE(?4, next_at),
                attempts = CASE
                    WHEN ?1 = 'queued' AND ?4 IS NULL THEN MAX(attempts - 1, 0)
                    ELSE attempts
                END,
                then_op = CASE WHEN ?1 = 'queued' THEN NULL ELSE then_op END,
                generation = CASE WHEN ?1 = 'queued' THEN NULL ELSE generation END,
                updated_at = ?5
             WHERE id = ?6 AND (
                state = 'running' OR (?1 = 'failed' AND state = 'then_pending')
             )",
            params![state, result, last_error, next_at, now, id],
        )?;
        if changed == 1 {
            Ok(())
        } else {
            Err(RuntimeError::Input(format!(
                "outbox row {id} is not running"
            )))
        }
    }

    pub(crate) fn settle_then_transaction(
        transaction: &rusqlite::Transaction<'_>,
        id: &str,
        last_error: Option<&str>,
        updated_at: i64,
    ) -> Result<(), RuntimeError> {
        let changed = transaction.execute(
            "UPDATE _outbox SET state = 'sent', last_error = ?1, updated_at = ?2
             WHERE id = ?3 AND state = 'then_pending'",
            params![last_error, updated_at, id],
        )?;
        if changed == 1 {
            Ok(())
        } else {
            Err(RuntimeError::Input(format!(
                "outbox row {id} is not then_pending"
            )))
        }
    }

    pub fn outbox_mark_queued_error(&self, error: &str) -> Result<u64, RuntimeError> {
        let changed = self.conn.execute(
            "UPDATE _outbox SET last_error = ?1, updated_at = ?2
             WHERE state = 'queued' AND last_error IS NOT ?1",
            params![error, unix_millis()],
        )?;
        Ok(changed as u64)
    }

    pub fn outbox_get(&self, id: &str) -> Result<Option<OutboxRow>, RuntimeError> {
        outbox_get_connection(&self.conn, id)
    }

    pub fn outbox_for_seq(&self, seq: u64) -> Result<Vec<OutboxRow>, RuntimeError> {
        let mut statement = self.conn.prepare(
            "SELECT id, seq, effect, payload, state, attempts, next_at,
                    last_error, result, then_op, generation, created_at, updated_at
             FROM _outbox WHERE seq = ?1 ORDER BY created_at ASC, id ASC",
        )?;
        let rows = statement.query_map([seq as i64], raw_outbox_row)?;
        rows.map(|row| decode_outbox_row(row?)).collect()
    }

    pub fn outbox_mark_unknown_running(&self) -> Result<u64, RuntimeError> {
        let changed = self.conn.execute(
            "UPDATE _outbox SET state = 'sent_unknown', updated_at = ?1
             WHERE state = 'running'",
            [unix_millis()],
        )?;
        Ok(changed as u64)
    }

    pub fn outbox_then_pending(&self, limit: usize) -> Result<Vec<OutboxRow>, RuntimeError> {
        let mut statement = self.conn.prepare(
            "SELECT id, seq, effect, payload, state, attempts, next_at,
                    last_error, result, then_op, generation, created_at, updated_at
             FROM _outbox WHERE state = 'then_pending'
             ORDER BY created_at ASC, id ASC LIMIT ?1",
        )?;
        let rows =
            statement.query_map([i64::try_from(limit).unwrap_or(i64::MAX)], raw_outbox_row)?;
        rows.map(|row| decode_outbox_row(row?)).collect()
    }

    pub fn outbox_requeue(&self, id: &str) -> Result<bool, RuntimeError> {
        let now = unix_millis();
        let changed = self.conn.execute(
            "UPDATE _outbox SET state = 'queued', attempts = 0, next_at = ?1,
                    last_error = NULL, result = NULL, then_op = NULL,
                    generation = NULL, updated_at = ?1
             WHERE id = ?2 AND state IN ('sent_unknown', 'failed')",
            params![now, id],
        )?;
        Ok(changed == 1)
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

type RawOutboxRow = (
    String,
    i64,
    String,
    String,
    String,
    i64,
    i64,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    i64,
    i64,
);

fn raw_outbox_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawOutboxRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
        row.get(10)?,
        row.get(11)?,
        row.get(12)?,
    ))
}

fn decode_outbox_row(raw: RawOutboxRow) -> Result<OutboxRow, RuntimeError> {
    let (
        id,
        seq,
        effect,
        payload,
        state,
        attempts,
        next_at,
        last_error,
        result,
        then_op,
        generation,
        created_at,
        updated_at,
    ) = raw;
    Ok(OutboxRow {
        id,
        seq: seq.max(0) as u64,
        effect,
        payload: serde_json::from_str(&payload)
            .map_err(|error| RuntimeError::Serialization(error.to_string()))?,
        state,
        attempts: attempts.max(0) as u32,
        next_at,
        last_error,
        result: result
            .map(|value| {
                serde_json::from_str(&value)
                    .map_err(|error| RuntimeError::Serialization(error.to_string()))
            })
            .transpose()?,
        then_op,
        generation,
        created_at,
        updated_at,
    })
}

fn outbox_get_connection(
    connection: &Connection,
    id: &str,
) -> Result<Option<OutboxRow>, RuntimeError> {
    connection
        .query_row(
            "SELECT id, seq, effect, payload, state, attempts, next_at,
                    last_error, result, then_op, generation, created_at, updated_at
             FROM _outbox WHERE id = ?1",
            [id],
            raw_outbox_row,
        )
        .optional()?
        .map(decode_outbox_row)
        .transpose()
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    declaration: &str,
) -> rusqlite::Result<()> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    if !columns.iter().any(|existing| existing == column) {
        connection.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {declaration}"
        ))?;
    }
    Ok(())
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
