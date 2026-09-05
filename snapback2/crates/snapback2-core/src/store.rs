//! Durable SQLite storage and engine-owned system tables.
// @ref LLP 1001#1-store-storers — the store owns SQLite setup, system tables, and snapshots.

use crate::engine::RuntimeError;
use crate::identity::SYSTEM_PRINCIPAL_ID;
use crate::offline::{
    REPLAY_GRANT_COUNT, REPLAY_GRANT_LIFETIME_MS, ReplayCommit, ReplayGrant, StoredClientIntent,
};
use crate::registry::EffectDecl;
use crate::value::Value;
use rusqlite::backup::Backup;
use rusqlite::{Connection, OpenFlags, OptionalExtension, params, params_from_iter};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};
#[cfg(unix)]
use std::ffi::CStr;
#[cfg(unix)]
use std::os::raw::{c_char, c_int};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const STORE_VERSION: &str = "2";
const ID_NAMESPACE_KEY: &str = "id_namespace";
const ID_HIGH_WATER_KEY: &str = "id_high_water";
const NEW_ID_BLOCK_SIZE: u64 = 1_024;

#[derive(Debug, PartialEq, Eq)]
enum ExistingStoreFormat {
    Fresh,
    Canonical,
    Incompatible(String),
}

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
        let acquired = (|| -> Result<(), RuntimeError> {
            connection.busy_timeout(Duration::from_millis(500))?;
            reject_incompatible_store(inspect_store_format(&connection)?)?;
            connection.pragma_update(None, "foreign_keys", "OFF")?;
            connection.pragma_update(None, "journal_mode", "WAL")?;
            connection.pragma_update(None, "locking_mode", "EXCLUSIVE")?;
            connection.execute_batch("BEGIN IMMEDIATE")?;
            reject_incompatible_store(inspect_store_format(&connection)?)?;
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
            Err(error) => {
                if matches!(&error, RuntimeError::Sql(sqlite) if sqlite_is_locked(sqlite)) {
                    Err(RuntimeError::StoreOwned {
                        holder: persisted_owner(path).unwrap_or_else(|| "unknown".to_owned()),
                    })
                } else {
                    Err(error)
                }
            }
        }
    }

    pub fn memory() -> Result<Self, RuntimeError> {
        let connection = Connection::open_in_memory()?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "OFF")?;
        Self::initialize_schema(&connection)?;
        Ok(Self { conn: connection })
    }

    pub(crate) fn memory_copy(&self) -> Result<Self, RuntimeError> {
        let mut copy = Self::memory()?;
        let backup = Backup::new(&self.conn, &mut copy.conn)?;
        backup.run_to_completion(64, Duration::from_millis(5), None)?;
        drop(backup);
        Ok(copy)
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
             -- Row replacement/deletion spans all indexes. The primary key's
             -- intervening index_name otherwise makes each cleanup scan the table.
             CREATE INDEX IF NOT EXISTS index_entries_by_row ON index_entries(table_name, row_id);
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
                auth_epoch INTEGER PRIMARY KEY AUTOINCREMENT,
                token_digest BLOB NOT NULL UNIQUE
                    CHECK(typeof(token_digest) = 'blob' AND length(token_digest) = 32),
                principal TEXT NOT NULL,
                kind TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS _grants (
                id TEXT PRIMARY KEY,
                principal TEXT NOT NULL,
                [from] TEXT NOT NULL,
                count INTEGER NOT NULL CHECK(count > 0),
                minted_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS _grants_principal_expiry
                ON _grants(principal, expires_at);
             CREATE TABLE IF NOT EXISTS _client_intents (
                principal TEXT NOT NULL,
                intent TEXT NOT NULL,
                request_digest TEXT NOT NULL,
                response TEXT NOT NULL,
                seq INTEGER NOT NULL,
                at INTEGER NOT NULL,
                PRIMARY KEY (principal, intent)
             );
             CREATE INDEX IF NOT EXISTS _client_intents_at ON _client_intents(at);
             CREATE TABLE IF NOT EXISTS _grant_slices (
                grant_id TEXT NOT NULL,
                principal TEXT NOT NULL,
                intent TEXT NOT NULL,
                offset INTEGER NOT NULL,
                count INTEGER NOT NULL CHECK(count > 0),
                PRIMARY KEY (grant_id, intent)
             );
             CREATE INDEX IF NOT EXISTS _grant_slices_extent
                ON _grant_slices(grant_id, offset, count);
             CREATE TABLE IF NOT EXISTS _assets (
                id TEXT PRIMARY KEY,
                state TEXT NOT NULL CHECK(state IN ('receiving', 'ready', 'failed')),
                kind TEXT NOT NULL CHECK(kind IN ('image', 'video')),
                type TEXT,
                bytes INTEGER CHECK(bytes IS NULL OR bytes >= 0),
                width INTEGER CHECK(width IS NULL OR width > 0),
                height INTEGER CHECK(height IS NULL OR height > 0),
                duration INTEGER CHECK(duration IS NULL OR duration > 0),
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                released_at INTEGER,
                staged_bytes INTEGER NOT NULL DEFAULT 0 CHECK(staged_bytes >= 0),
                reclaiming INTEGER NOT NULL DEFAULT 0 CHECK(reclaiming IN (0, 1)),
                locator_table TEXT,
                locator_row TEXT,
                locator_column TEXT,
                CHECK(
                    (locator_table IS NULL AND locator_row IS NULL AND locator_column IS NULL) OR
                    (locator_table IS NOT NULL AND locator_row IS NOT NULL AND locator_column IS NOT NULL)
                )
             );",
        )?;
        ensure_column(connection, "_outbox", "then_op", "TEXT")?;
        ensure_column(connection, "_outbox", "generation", "TEXT")?;
        ensure_column(connection, "_assets", "released_at", "INTEGER")?;
        ensure_column(
            connection,
            "_assets",
            "staged_bytes",
            "INTEGER NOT NULL DEFAULT 0 CHECK(staged_bytes >= 0)",
        )?;
        ensure_column(
            connection,
            "_assets",
            "reclaiming",
            "INTEGER NOT NULL DEFAULT 0 CHECK(reclaiming IN (0, 1))",
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
             VALUES (?1, ?1, ?1, ?2)",
            params![SYSTEM_PRINCIPAL_ID.as_str(), now],
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

    // @ref LLP 1001#1-store-storers — reserve before execution so rollback or
    // process death can create gaps but can never make an exposed id reusable.
    pub(crate) fn reserve_new_ids(&mut self) -> Result<VecDeque<String>, RuntimeError> {
        let transaction = self.conn.transaction()?;
        let ids = reserve_id_range(&transaction, NEW_ID_BLOCK_SIZE)?;
        transaction.commit()?;
        Ok(ids)
    }

    /// Mint one principal-bound replay grant from the same durable allocator
    /// ordinary mutations use. The allocator reservation and grant row commit
    /// together, so no granted id can later be reserved by the owner.
    // @ref LLP 1012#7-writes-offline — replay grants reserve engine-format ids
    // before a client may expose them.
    pub(crate) fn mint_replay_grant(
        &mut self,
        principal: &str,
        now: i64,
    ) -> Result<ReplayGrant, RuntimeError> {
        let transaction = self.conn.transaction()?;
        let ids = reserve_id_range(&transaction, u64::from(REPLAY_GRANT_COUNT))?;
        let from_id = ids.front().cloned().expect("grant count is positive");
        let grant = ReplayGrant {
            id: from_id.clone(),
            from_id,
            count: REPLAY_GRANT_COUNT,
            minted_at: now,
            expires_at: now.saturating_add(REPLAY_GRANT_LIFETIME_MS),
        };
        transaction.execute(
            "INSERT INTO _grants(id, principal, \"from\", count, minted_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                grant.id,
                principal,
                grant.from_id,
                i64::from(grant.count),
                grant.minted_at,
                grant.expires_at,
            ],
        )?;
        transaction.commit()?;
        Ok(grant)
    }

    pub fn replay_grant(&self, id: &str) -> Result<Option<(String, ReplayGrant)>, RuntimeError> {
        self.conn
            .query_row(
                "SELECT principal, id, \"from\", count, minted_at, expires_at
                 FROM _grants WHERE id = ?1",
                [id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        ReplayGrant {
                            id: row.get(1)?,
                            from_id: row.get(2)?,
                            count: row.get::<_, i64>(3)?.max(0) as u32,
                            minted_at: row.get(4)?,
                            expires_at: row.get(5)?,
                        },
                    ))
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn stored_client_intent(
        &self,
        principal: &str,
        intent: &str,
    ) -> Result<Option<StoredClientIntent>, RuntimeError> {
        self.conn
            .query_row(
                "SELECT request_digest, response, seq, at
                 FROM _client_intents WHERE principal = ?1 AND intent = ?2",
                params![principal, intent],
                |row| {
                    let response = row.get::<_, String>(1)?;
                    Ok((
                        row.get::<_, String>(0)?,
                        response,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .optional()?
            .map(|(request_digest, response, seq, at)| {
                Ok(StoredClientIntent {
                    request_digest,
                    response: serde_json::from_str(&response).map_err(|error| {
                        RuntimeError::Serialization(error.to_string())
                    })?,
                    seq: seq.max(0) as u64,
                    at,
                })
            })
            .transpose()
    }

    pub fn replay_slice_is_unused(
        &self,
        grant: &str,
        intent: &str,
        offset: u32,
        count: u32,
    ) -> Result<bool, RuntimeError> {
        let end = u64::from(offset) + u64::from(count);
        let overlaps: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM _grant_slices
             WHERE grant_id = ?1 AND intent <> ?2
               AND offset < ?4 AND ?3 < offset + count",
            params![grant, intent, i64::from(offset), end as i64],
            |row| row.get(0),
        )?;
        Ok(overlaps == 0)
    }

    pub fn replay_slice_ids(
        grant: &ReplayGrant,
        offset: u32,
        count: u32,
    ) -> Option<VecDeque<String>> {
        let end = offset.checked_add(count)?;
        if count == 0 || end > grant.count {
            return None;
        }
        let (namespace, first) = parse_engine_id(&grant.from_id)?;
        let start = first.checked_add(u64::from(offset))?;
        let through = start.checked_add(u64::from(count) - 1)?;
        Some(
            (start..=through)
                .map(|sequence| format!("s2id-{namespace}-{sequence:016x}"))
                .collect(),
        )
    }

    pub(crate) fn record_replay_terminal(
        transaction: &rusqlite::Transaction<'_>,
        principal: &str,
        replay: &ReplayCommit,
        response: &serde_json::Value,
        seq: u64,
    ) -> Result<(), RuntimeError> {
        transaction.execute(
            "INSERT INTO _grant_slices(grant_id, principal, intent, offset, count)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                replay.grant,
                principal,
                replay.intent,
                i64::from(replay.offset),
                i64::from(replay.count),
            ],
        )?;
        transaction.execute(
            "INSERT INTO _client_intents(principal, intent, request_digest, response, seq, at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                principal,
                replay.intent,
                replay.request_digest,
                serde_json::to_string(response)
                    .map_err(|error| RuntimeError::Serialization(error.to_string()))?,
                seq as i64,
                replay.at,
            ],
        )?;
        Ok(())
    }

    pub(crate) fn sweep_offline(&self, now: i64) -> Result<(), RuntimeError> {
        let cutoff = now.saturating_sub(REPLAY_GRANT_LIFETIME_MS);
        let transaction = self.conn.unchecked_transaction()?;
        transaction.execute(
            "DELETE FROM _grant_slices WHERE grant_id IN
                (SELECT id FROM _grants WHERE expires_at <= ?1)",
            [now],
        )?;
        transaction.execute("DELETE FROM _grants WHERE expires_at <= ?1", [now])?;
        transaction.execute("DELETE FROM _client_intents WHERE at <= ?1", [cutoff])?;
        transaction.commit()?;
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
                "SELECT value FROM _meta WHERE key = 'effects_generation'",
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

    // @ref LLP 1002#8-why-trace-guide — trace reads the durable rows emitted by this commit, never program syntax.
    pub fn outbox_rows_for_seq(&self, seq: u64) -> Result<Vec<OutboxRow>, RuntimeError> {
        self.outbox_for_seq(seq)
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

    pub fn reset_data(&mut self) -> Result<Vec<String>, RuntimeError> {
        let transaction = self.conn.transaction()?;
        let asset_ids = crate::assets_ledger::clear_assets(&transaction)?;
        transaction.execute_batch(
            "DELETE FROM index_entries;
             DELETE FROM rows;
             DELETE FROM _commits;
             DELETE FROM _outbox;
             DELETE FROM _grant_slices;
             DELETE FROM _client_intents;
             DELETE FROM _grants;",
        )?;
        transaction.commit()?;
        Ok(asset_ids)
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

fn reject_incompatible_store(format: ExistingStoreFormat) -> Result<(), RuntimeError> {
    match format {
        ExistingStoreFormat::Fresh | ExistingStoreFormat::Canonical => Ok(()),
        ExistingStoreFormat::Incompatible(detail) => Err(RuntimeError::StoreVersion { detail }),
    }
}

fn inspect_store_format(connection: &Connection) -> rusqlite::Result<ExistingStoreFormat> {
    // @ref LLP 1001#6-identity-identityrs — the plaintext-token format is
    // deliberately not migrated; refusal occurs before publishing an owner.
    let table_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;
    if table_count == 0 {
        return Ok(ExistingStoreFormat::Fresh);
    }
    if !table_exists(connection, "_sessions")? {
        return Ok(ExistingStoreFormat::Incompatible(
            "existing store has no canonical _sessions table".to_owned(),
        ));
    }

    let expected_sessions = [
        ("auth_epoch", "INTEGER", false, 1),
        ("token_digest", "BLOB", true, 0),
        ("principal", "TEXT", true, 0),
        ("kind", "TEXT", true, 0),
        ("created_at", "INTEGER", true, 0),
        ("expires_at", "INTEGER", true, 0),
    ];
    if !columns_match(connection, "_sessions", &expected_sessions)? {
        return Ok(ExistingStoreFormat::Incompatible(
            "_sessions is plaintext, legacy, or has an unknown shape".to_owned(),
        ));
    }
    let sessions_sql = table_sql(connection, "_sessions")?
        .unwrap_or_default()
        .chars()
        .filter(|character| !character.is_ascii_whitespace())
        .collect::<String>()
        .to_ascii_uppercase();
    if !sessions_sql.contains("AUTOINCREMENT")
        || !sessions_sql.contains("TYPEOF(TOKEN_DIGEST)='BLOB'")
        || !sessions_sql.contains("LENGTH(TOKEN_DIGEST)=32")
        || !has_unique_single_column_index(connection, "_sessions", "token_digest")?
    {
        return Ok(ExistingStoreFormat::Incompatible(
            "_sessions lacks the canonical epoch or digest constraints".to_owned(),
        ));
    }

    let expected_meta = [("key", "TEXT", false, 1), ("value", "TEXT", true, 0)];
    if !columns_match(connection, "_meta", &expected_meta)? {
        return Ok(ExistingStoreFormat::Incompatible(
            "existing store has no canonical version metadata".to_owned(),
        ));
    }
    let version = connection
        .query_row(
            "SELECT value FROM _meta WHERE key = 'store_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if version.as_deref() != Some(STORE_VERSION) {
        return Ok(ExistingStoreFormat::Incompatible(format!(
            "store version {} is not {STORE_VERSION}",
            version.as_deref().unwrap_or("missing")
        )));
    }

    Ok(ExistingStoreFormat::Canonical)
}

fn table_exists(connection: &Connection, table: &str) -> rusqlite::Result<bool> {
    connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [table],
        |row| row.get(0),
    )
}

fn table_sql(connection: &Connection, table: &str) -> rusqlite::Result<Option<String>> {
    connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table],
            |row| row.get(0),
        )
        .optional()
}

fn columns_match(
    connection: &Connection,
    table: &str,
    expected: &[(&str, &str, bool, i64)],
) -> rusqlite::Result<bool> {
    if !table_exists(connection, table)? {
        return Ok(false);
    }
    let escaped = table.replace('"', "\"\"");
    let mut statement = connection.prepare(&format!("PRAGMA table_info(\"{escaped}\")"))?;
    let actual = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?.to_ascii_uppercase(),
                row.get::<_, i64>(3)? != 0,
                row.get::<_, i64>(5)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(actual
        == expected
            .iter()
            .map(|(name, kind, not_null, primary_key)| {
                (
                    (*name).to_owned(),
                    (*kind).to_owned(),
                    *not_null,
                    *primary_key,
                )
            })
            .collect::<Vec<_>>())
}

fn has_unique_single_column_index(
    connection: &Connection,
    table: &str,
    column: &str,
) -> rusqlite::Result<bool> {
    let escaped = table.replace('"', "\"\"");
    let mut statement = connection.prepare(&format!("PRAGMA index_list(\"{escaped}\")"))?;
    let indexes = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(1)?, row.get::<_, i64>(2)? != 0))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (index, unique) in indexes {
        if !unique {
            continue;
        }
        let escaped = index.replace('"', "\"\"");
        let mut statement = connection.prepare(&format!("PRAGMA index_info(\"{escaped}\")"))?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(2))?
            .collect::<Result<Vec<_>, _>>()?;
        if columns == [column] {
            return Ok(true);
        }
    }
    Ok(false)
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

fn reserve_id_range(
    transaction: &rusqlite::Transaction<'_>,
    count: u64,
) -> Result<VecDeque<String>, RuntimeError> {
    let namespace = transaction
        .query_row(
            "SELECT value FROM _meta WHERE key = ?1",
            [ID_NAMESPACE_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let encoded_high_water = transaction
        .query_row(
            "SELECT value FROM _meta WHERE key = ?1",
            [ID_HIGH_WATER_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let (namespace, high_water) = match (namespace, encoded_high_water) {
        (None, None) => {
            transaction.execute(
                "INSERT INTO _meta(key, value) VALUES (?1, lower(hex(randomblob(16))))",
                [ID_NAMESPACE_KEY],
            )?;
            transaction.execute(
                "INSERT INTO _meta(key, value) VALUES (?1, '0')",
                [ID_HIGH_WATER_KEY],
            )?;
            let namespace = transaction.query_row(
                "SELECT value FROM _meta WHERE key = ?1",
                [ID_NAMESPACE_KEY],
                |row| row.get::<_, String>(0),
            )?;
            (namespace, 0)
        }
        (Some(namespace), Some(encoded)) => {
            let high_water = encoded
                .parse::<u64>()
                .map_err(|_| RuntimeError::StoreVersion {
                    detail: "id allocator high-water is not an unsigned integer".to_owned(),
                })?;
            (namespace, high_water)
        }
        _ => {
            return Err(RuntimeError::StoreVersion {
                detail: "id allocator namespace/high-water metadata is incomplete".to_owned(),
            });
        }
    };
    if !valid_id_namespace(&namespace) {
        return Err(RuntimeError::StoreVersion {
            detail: "id allocator namespace is malformed".to_owned(),
        });
    }
    let reserved_through = high_water
        .checked_add(count)
        .ok_or_else(|| RuntimeError::StoreVersion {
            detail: "id allocator high-water is exhausted".to_owned(),
        })?;
    if transaction.execute(
        "UPDATE _meta SET value = ?2 WHERE key = ?1",
        params![ID_HIGH_WATER_KEY, reserved_through.to_string()],
    )? != 1
    {
        return Err(RuntimeError::StoreVersion {
            detail: "id allocator high-water disappeared during reservation".to_owned(),
        });
    }
    Ok(((high_water + 1)..=reserved_through)
        .map(|sequence| format!("s2id-{namespace}-{sequence:016x}"))
        .collect())
}

fn parse_engine_id(id: &str) -> Option<(&str, u64)> {
    let (namespace, sequence) = id.strip_prefix("s2id-")?.rsplit_once('-')?;
    valid_id_namespace(namespace)
        .then(|| u64::from_str_radix(sequence, 16).ok())
        .flatten()
        .filter(|_| sequence.len() == 16)
        .map(|sequence| (namespace, sequence))
}

fn valid_id_namespace(namespace: &str) -> bool {
    namespace.len() == 32
        && namespace
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
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

    #[test]
    fn outbox_rows_for_seq_returns_only_real_rows_with_durable_states() {
        let store = Store::memory().unwrap();
        for (id, seq, state) in [
            ("queued", 7_i64, "queued"),
            ("running", 7_i64, "running"),
            ("then-pending", 7_i64, "then_pending"),
            ("sent", 7_i64, "sent"),
            ("failed", 7_i64, "failed"),
            ("sent-unknown", 7_i64, "sent_unknown"),
            ("other-commit", 8_i64, "failed"),
        ] {
            store
                .conn
                .execute(
                    "INSERT INTO _outbox(
                        id, seq, effect, payload, state, attempts, next_at,
                        last_error, result, created_at, updated_at
                     ) VALUES (?1, ?2, 'notify', ?3, ?4, 2, 10, 'detail', ?5, 6, 9)",
                    params![
                        id,
                        seq,
                        serde_json::to_string(&Value::String(id.to_owned())).unwrap(),
                        state,
                        serde_json::to_string(&serde_json::json!(true)).unwrap(),
                    ],
                )
                .unwrap();
        }

        let rows = store.outbox_rows_for_seq(7).unwrap();
        let states = rows
            .iter()
            .map(|row| (row.id.as_str(), row.state.as_str()))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            states,
            BTreeMap::from([
                ("failed", "failed"),
                ("queued", "queued"),
                ("running", "running"),
                ("sent", "sent"),
                ("sent-unknown", "sent_unknown"),
                ("then-pending", "then_pending"),
            ])
        );
        let queued = rows.iter().find(|row| row.id == "queued").unwrap();
        assert_eq!(queued.payload, Value::String("queued".to_owned()));
        assert_eq!(queued.result, Some(serde_json::json!(true)));
    }
}

#[cfg(not(unix))]
fn hostname() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown-host".to_owned())
}
