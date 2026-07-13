//! Durable server-side authorization-invalidation control state.
//!
//! @ref LLP 0053#invalidation-is-an-obligation-not-a-message — boot issuers
//! are reserved transactionally and retry episodes survive restart, refire,
//! scope replacement, and obligation revision changes.

use super::auth_stream::ensure_authorization_version_in;
use super::{LocalDatabase, MAX_AUTHORIZATION_EPOCH};
use crate::auth::invalidation::{RetryEpisode, RetryEpisodeKey, RetryEpisodeRegistry};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use std::collections::BTreeMap;
use uuid::Uuid;

const BOOT_SEQUENCE_META_KEY: &str = "auth_invalidation_boot_sequence_v1";
const DATA_VERSION_STREAM_META_KEY: &str = "auth_invalidation_data_version_stream_v1";
pub(super) const AUTH_CLOCK_META_KEY: &str = "auth_invalidation_clock_high_water_ms_v1";
const RETRY_GLOBAL_COUNT_META_KEY: &str = "auth_invalidation_retry_records_v1";

fn corrupt(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_INVALIDATION_CORRUPT", "auth", message.into())
}

fn exhausted() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_INVALIDATION_ISSUER_EXHAUSTED",
        "auth",
        "authorization invalidation boot sequence exhausted the JavaScript-safe range",
    )
}

impl LocalDatabase {
    /// Reserve one never-reused boot sequence in the same transaction that
    /// reads the authorization incarnation it names. A crash consumes the
    /// reservation; rollback makes it available because no issuer escaped.
    pub(crate) fn reserve_invalidation_boot_issuer(
        &mut self,
    ) -> SnapbackResult<(crate::storage::AuthorizationVersion, String, u64)> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let authorization = ensure_authorization_version_in(&tx)?;
        let version_stream = ensure_data_version_stream_in(&tx)?;
        let previous = strict_meta_u64(&tx, BOOT_SEQUENCE_META_KEY)?.unwrap_or(0);
        let sequence = previous
            .checked_add(1)
            .filter(|value| *value <= MAX_AUTHORIZATION_EPOCH)
            .ok_or_else(exhausted)?;
        write_meta_u64(&tx, BOOT_SEQUENCE_META_KEY, sequence)?;
        tx.commit()?;
        Ok((authorization, version_stream, sequence))
    }

    /// Load, mutate, and repersist the bounded retry registry under one
    /// IMMEDIATE auth-control transaction. Counters are derived from the table
    /// on every entry and rewritten in that same transaction; missing or
    /// malformed counters therefore repair without resetting an episode.
    pub(crate) fn with_invalidation_retry_registry<T>(
        &mut self,
        operation: impl FnOnce(&mut RetryEpisodeRegistry) -> SnapbackResult<T>,
    ) -> SnapbackResult<T> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let episodes = load_retry_episodes(&tx)?;
        let clock_high_water_ms = strict_meta_u64(&tx, AUTH_CLOCK_META_KEY)?.unwrap_or(0);
        let mut registry = RetryEpisodeRegistry::from_persisted(episodes, clock_high_water_ms)?;

        // Repair before invoking the caller so an over-cap/corrupt counter can
        // never turn into implicit admission. The episode table remains the
        // authority and is itself bounded by the registry's fail-closed gate.
        persist_retry_counters(&tx, registry.episodes())?;
        let output = operation(&mut registry)?;
        replace_retry_episodes(&tx, &registry)?;
        tx.commit()?;
        Ok(output)
    }

    #[cfg(test)]
    pub(crate) fn invalidation_retry_episode_count(&self) -> SnapbackResult<u64> {
        let count = self.conn.query_row(
            "SELECT COUNT(*) FROM _snapback_auth_retry_episodes",
            [],
            |row| row.get::<_, i64>(0),
        )?;
        u64::try_from(count).map_err(|_| corrupt("retry episode count is negative"))
    }
}

fn load_retry_episodes(
    tx: &Transaction<'_>,
) -> SnapbackResult<BTreeMap<RetryEpisodeKey, RetryEpisode>> {
    let mut statement = tx.prepare(
        "SELECT authority_subject, client_store_id, query_key, episode_json
         FROM _snapback_auth_retry_episodes
         ORDER BY authority_subject, client_store_id, query_key",
    )?;
    let mut rows = statement.query([])?;
    let mut episodes = BTreeMap::new();
    while let Some(row) = rows.next()? {
        let key = RetryEpisodeKey {
            authority_subject: row.get(0)?,
            client_store_id: row.get(1)?,
            query_key: row.get(2)?,
        };
        let storage_class: String = row.get_ref(3)?.data_type().to_string();
        if storage_class != "Text" {
            return Err(corrupt("retry episode JSON is not SQLite text"));
        }
        let encoded: String = row.get(3)?;
        let episode: RetryEpisode = serde_json::from_str(&encoded)
            .map_err(|_| corrupt("retry episode JSON is malformed or non-canonical"))?;
        if episode.key != key {
            return Err(corrupt(
                "retry episode primary key does not match its payload",
            ));
        }
        let canonical = serde_json::to_string(&episode)
            .map_err(|_| corrupt("retry episode could not be canonically encoded"))?;
        if canonical != encoded {
            return Err(corrupt("retry episode JSON is not canonically encoded"));
        }
        if episodes.insert(key, episode).is_some() {
            return Err(corrupt("retry episode key is duplicated"));
        }
    }
    Ok(episodes)
}

fn replace_retry_episodes(
    tx: &Transaction<'_>,
    registry: &RetryEpisodeRegistry,
) -> SnapbackResult<()> {
    tx.execute("DELETE FROM _snapback_auth_retry_episodes", [])?;
    {
        let mut insert = tx.prepare(
            "INSERT INTO _snapback_auth_retry_episodes(
                 authority_subject, client_store_id, query_key, episode_json
             ) VALUES(?1, ?2, ?3, ?4)",
        )?;
        for (key, episode) in registry.episodes() {
            let encoded = serde_json::to_string(episode)
                .map_err(|_| corrupt("retry episode could not be encoded"))?;
            insert.execute(params![
                key.authority_subject,
                key.client_store_id,
                key.query_key,
                encoded
            ])?;
        }
    }
    write_meta_u64(tx, AUTH_CLOCK_META_KEY, registry.clock_high_water_ms())?;
    persist_retry_counters(tx, registry.episodes())?;
    Ok(())
}

fn persist_retry_counters(
    tx: &Transaction<'_>,
    episodes: &BTreeMap<RetryEpisodeKey, RetryEpisode>,
) -> SnapbackResult<()> {
    let global = u64::try_from(episodes.len())
        .map_err(|_| corrupt("retry episode count is not representable"))?;
    write_meta_u64(tx, RETRY_GLOBAL_COUNT_META_KEY, global)?;
    let mut per_store: BTreeMap<(&str, &str), u64> = BTreeMap::new();
    for key in episodes.keys() {
        let count = per_store
            .entry((&key.authority_subject, &key.client_store_id))
            .or_default();
        *count = count
            .checked_add(1)
            .ok_or_else(|| corrupt("retry per-store count overflowed"))?;
    }
    tx.execute("DELETE FROM _snapback_auth_retry_counters", [])?;
    let mut insert = tx.prepare(
        "INSERT INTO _snapback_auth_retry_counters(
             authority_subject, client_store_id, records
         ) VALUES(?1, ?2, ?3)",
    )?;
    for ((authority_subject, client_store_id), records) in per_store {
        insert.execute(params![authority_subject, client_store_id, records])?;
    }
    Ok(())
}

/// A destructive incarnation rotation makes every old retry witness
/// permanently non-current. Remove episodes and both counter projections in
/// the same transaction as that rotation; ordinary restart never calls this.
pub(super) fn clear_retry_episodes_in(tx: &Transaction<'_>) -> SnapbackResult<()> {
    tx.execute("DELETE FROM _snapback_auth_retry_episodes", [])?;
    tx.execute("DELETE FROM _snapback_auth_retry_counters", [])?;
    write_meta_u64(tx, RETRY_GLOBAL_COUNT_META_KEY, 0)?;
    Ok(())
}

pub(super) fn rotate_data_version_stream_in(tx: &Transaction<'_>) -> SnapbackResult<String> {
    let stream = Uuid::now_v7().hyphenated().to_string();
    write_text_meta(tx, DATA_VERSION_STREAM_META_KEY, &stream)?;
    Ok(stream)
}

pub(super) fn ensure_data_version_stream_in(tx: &Transaction<'_>) -> SnapbackResult<String> {
    let value: Option<(String, Vec<u8>)> = tx
        .query_row(
            "SELECT typeof(value), CAST(value AS BLOB)
             FROM _snapback_meta WHERE key = ?1",
            params![DATA_VERSION_STREAM_META_KEY],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    match value {
        None => rotate_data_version_stream_in(tx),
        Some((storage_class, bytes)) if storage_class == "text" => {
            let stream = std::str::from_utf8(&bytes)
                .map_err(|_| corrupt("data version stream is not UTF-8"))?;
            let parsed = Uuid::parse_str(stream)
                .map_err(|_| corrupt("data version stream is not a canonical UUIDv7"))?;
            if parsed.get_version_num() != 7 || parsed.hyphenated().to_string() != stream {
                return Err(corrupt("data version stream is not a canonical UUIDv7"));
            }
            Ok(stream.to_owned())
        }
        Some(_) => Err(corrupt("data version stream is not SQLite text")),
    }
}

pub(super) fn strict_meta_u64(tx: &Transaction<'_>, key: &str) -> SnapbackResult<Option<u64>> {
    let value: Option<(String, Vec<u8>)> = tx
        .query_row(
            "SELECT typeof(value), CAST(value AS BLOB)
             FROM _snapback_meta WHERE key = ?1",
            params![key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((storage_class, bytes)) = value else {
        return Ok(None);
    };
    if storage_class != "text" {
        return Err(corrupt(format!("{key} is not SQLite text")));
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| corrupt(format!("{key} is not UTF-8")))?;
    if text.is_empty()
        || (text.len() > 1 && text.starts_with('0'))
        || !text.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(corrupt(format!("{key} is not a canonical counter")));
    }
    let value = text
        .parse::<u64>()
        .map_err(|_| corrupt(format!("{key} is not a canonical counter")))?;
    if value > MAX_AUTHORIZATION_EPOCH {
        return Err(corrupt(format!("{key} exceeds the JavaScript-safe range")));
    }
    Ok(Some(value))
}

pub(super) fn write_meta_u64(tx: &Transaction<'_>, key: &str, value: u64) -> SnapbackResult<()> {
    if value > MAX_AUTHORIZATION_EPOCH {
        return Err(corrupt(format!("{key} exceeds the JavaScript-safe range")));
    }
    tx.execute(
        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value.to_string()],
    )?;
    Ok(())
}

fn write_text_meta(tx: &Transaction<'_>, key: &str, value: &str) -> SnapbackResult<()> {
    tx.execute(
        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::invalidation::{
        CompositeWitness, DataWitness, RetryReservation, RetryReservationKind,
    };
    use crate::storage::AuthorizationVersion;
    use tempfile::tempdir;

    const INCARNATION: &str = "018f0d90-7b11-7a22-8c33-445566778899";

    fn witness(version: u64) -> CompositeWitness {
        CompositeWitness {
            authorization: AuthorizationVersion {
                incarnation: INCARNATION.to_owned(),
                epoch: 0,
            },
            data: Some(DataWitness {
                version_stream: "stream-A".to_owned(),
                min_commit_version: version,
            }),
        }
    }

    fn key() -> RetryEpisodeKey {
        RetryEpisodeKey {
            authority_subject: "user-A".to_owned(),
            client_store_id: "store-A".to_owned(),
            query_key: "todos:{}".to_owned(),
        }
    }

    #[test]
    fn boot_sequence_is_consumed_before_restart_and_names_current_incarnation() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("app.sqlite3");
        let mut first = LocalDatabase::open(&path).unwrap();
        let (authorization, stream, sequence) = first.reserve_invalidation_boot_issuer().unwrap();
        assert_eq!(sequence, 1);
        drop(first);

        let mut second = LocalDatabase::open(&path).unwrap();
        let (reopened, reopened_stream, next) = second.reserve_invalidation_boot_issuer().unwrap();
        assert_eq!(reopened, authorization);
        assert_eq!(reopened_stream, stream);
        assert_eq!(next, 2);
    }

    #[test]
    fn retry_attempt_and_deadline_survive_restart_and_counter_repair() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("app.sqlite3");
        let mut first = LocalDatabase::open(&path).unwrap();
        first
            .with_invalidation_retry_registry(|registry| {
                assert!(matches!(
                    registry.reserve(key(), witness(10), 1_000, RetryReservationKind::Initial)?,
                    RetryReservation::Reserved(_)
                ));
                registry.record_failure(&key(), 1_100)
            })
            .unwrap();
        drop(first);

        let mut second = LocalDatabase::open(&path).unwrap();
        second
            .conn
            .execute("DELETE FROM _snapback_auth_retry_counters", [])
            .unwrap();
        second
            .conn
            .execute(
                "DELETE FROM _snapback_meta WHERE key = ?1",
                params![RETRY_GLOBAL_COUNT_META_KEY],
            )
            .unwrap();
        second
            .with_invalidation_retry_registry(|registry| {
                let episode = registry.episodes().get(&key()).unwrap();
                assert_eq!(episode.attempts_reserved, 1);
                assert_eq!(episode.deadline_ms, Some(16_100));
                assert!(matches!(
                    registry.reserve(key(), witness(12), 1_200, RetryReservationKind::Initial)?,
                    RetryReservation::Attached(_)
                ));
                Ok(())
            })
            .unwrap();
        assert_eq!(second.invalidation_retry_episode_count().unwrap(), 1);
        let counter: i64 = second
            .conn
            .query_row(
                "SELECT records FROM _snapback_auth_retry_counters
                 WHERE authority_subject = 'user-A' AND client_store_id = 'store-A'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(counter, 1);
    }
}
