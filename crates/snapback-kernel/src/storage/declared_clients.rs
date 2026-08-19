//! Bounded pre-authentication attribution for LLP 0204 declared callers.
//!
//! A declared client id is not an account or an authority fact. This exact,
//! manifest-activated companion catalog retains only the bounded usage and
//! operator-treatment facts needed by the external API admission ladder.

use super::{LocalDatabase, SnapbackResult};
use crate::diagnostic::SnapbackError;
use crate::manifest::SchemaManifest;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::Serialize;

pub const DECLARED_CLIENT_TABLE: &str = "_snapback_declared_clients";

/// @ref LLP 0071#bounded-pre-auth-ledger — idle declared rows expire instead
/// of accumulating identity-like history; later reuse starts fresh.
pub const DECLARED_CLIENT_IDLE_TTL_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
/// @ref LLP 0071#bounded-pre-auth-ledger — a fixed per-app cap refuses a new
/// declared allocation without evicting a live row chosen by an attacker.
pub const DECLARED_CLIENT_ROW_CAP: u64 = 10_000;
/// @ref LLP 0071#declared-tier — continued cooperative use ages through a
/// small closed schedule; string possession and contact spelling never do.
pub const DECLARED_CLIENT_AGE_STEP_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
pub const DECLARED_CLIENT_MAX_AGE_POLICY_GENERATION: u64 = 4;
/// @ref LLP 0071#declared-tier — caller-chosen ids remain free-form, but the
/// durable pre-authentication shape must have a hard byte bound.
pub const DECLARED_CLIENT_MAX_ID_BYTES: usize = 512;
const MAX_SAFE_COUNTER: u64 = 9_007_199_254_740_991;

const TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS _snapback_declared_clients (
  normalized_id TEXT NOT NULL PRIMARY KEY
    CHECK(length(normalized_id) >= 16
      AND length(CAST(normalized_id AS BLOB)) <= 512),
  first_seen_ms INTEGER NOT NULL
    CHECK(first_seen_ms BETWEEN 0 AND 9007199254740991),
  last_seen_ms INTEGER NOT NULL
    CHECK(last_seen_ms BETWEEN first_seen_ms AND 9007199254740991),
  request_count INTEGER NOT NULL
    CHECK(request_count BETWEEN 1 AND 9007199254740991),
  refusal_count INTEGER NOT NULL DEFAULT 0
    CHECK(refusal_count BETWEEN 0 AND request_count),
  status TEXT NOT NULL CHECK(status IN ('active', 'blessed', 'suspended')),
  age_policy_generation INTEGER NOT NULL DEFAULT 1
    CHECK(age_policy_generation BETWEEN 1 AND 4),
  network_evidence_generation INTEGER NOT NULL
    CHECK(network_evidence_generation BETWEEN 0 AND 9007199254740991)
);
"#;

const IDLE_INDEX_SQL: &str = r#"
CREATE INDEX IF NOT EXISTS _snapback_declared_clients_idle
  ON _snapback_declared_clients(last_seen_ms, normalized_id);
"#;

const STATUS_INDEX_SQL: &str = r#"
CREATE INDEX IF NOT EXISTS _snapback_declared_clients_status
  ON _snapback_declared_clients(status, last_seen_ms, normalized_id);
"#;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DeclaredClientStatus {
    Active,
    Blessed,
    Suspended,
}

impl DeclaredClientStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Blessed => "blessed",
            Self::Suspended => "suspended",
        }
    }

    fn parse(value: &str) -> SnapbackResult<Self> {
        match value {
            "active" => Ok(Self::Active),
            "blessed" => Ok(Self::Blessed),
            "suspended" => Ok(Self::Suspended),
            _ => Err(catalog_corrupt()),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeclaredClientRecord {
    pub normalized_id: String,
    pub first_seen_ms: u64,
    pub last_seen_ms: u64,
    pub request_count: u64,
    pub refusal_count: u64,
    pub status: DeclaredClientStatus,
    pub age_policy_generation: u64,
    pub network_evidence_generation: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DeclaredClientObservation {
    Observed(DeclaredClientRecord),
    Capacity,
}

pub fn manifest_enabled(manifest: &SchemaManifest) -> bool {
    manifest.api.as_ref().is_some_and(|api| api.enabled)
}

/// Install or remove the declared-client ledger in the same schema activation
/// transaction as the integration companion. Apps without `api.enabled`
/// retain neither a table nor maintenance work.
///
/// @ref LLP 0071#bounded-pre-auth-ledger — pre-authentication attribution
/// exists only behind the declared external surface and remains exact/bounded.
pub(crate) fn activate_manifest_in(
    tx: &Transaction<'_>,
    manifest: &SchemaManifest,
) -> SnapbackResult<()> {
    if !manifest_enabled(manifest) {
        tx.execute_batch("DROP TABLE IF EXISTS _snapback_declared_clients;")?;
        return Ok(());
    }
    tx.execute_batch(TABLE_SQL)?;
    tx.execute_batch(IDLE_INDEX_SQL)?;
    tx.execute_batch(STATUS_INDEX_SQL)?;
    validate_exact_schema(tx)
}

pub(super) fn validate_exact_schema(conn: &Connection) -> SnapbackResult<()> {
    let reference = Connection::open_in_memory()?;
    reference.execute_batch(TABLE_SQL)?;
    reference.execute_batch(IDLE_INDEX_SQL)?;
    reference.execute_batch(STATUS_INDEX_SQL)?;
    if catalog_objects(conn)? != catalog_objects(&reference)? {
        return Err(catalog_corrupt());
    }
    Ok(())
}

fn catalog_objects(conn: &Connection) -> SnapbackResult<Vec<(String, String, String, String)>> {
    let mut statement = conn.prepare(
        "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_schema
         WHERE name = '_snapback_declared_clients'
            OR tbl_name = '_snapback_declared_clients'
         ORDER BY type, name",
    )?;
    Ok(statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn table_exists(conn: &Connection) -> SnapbackResult<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1",
            params![DECLARED_CLIENT_TABLE],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn validate_id(normalized_id: &str) -> SnapbackResult<()> {
    if normalized_id.chars().count() >= 16 && normalized_id.len() <= DECLARED_CLIENT_MAX_ID_BYTES {
        Ok(())
    } else {
        Err(SnapbackError::error(
            "SNAPBACK_API_DECLARED_CLIENT_INVALID",
            "api",
            "declared client id is outside the bounded normalized profile",
        ))
    }
}

fn sweep_expired_on(tx: &Transaction<'_>, now_ms: u64) -> SnapbackResult<u64> {
    let Some(cutoff) = now_ms.checked_sub(DECLARED_CLIENT_IDLE_TTL_MS) else {
        return Ok(0);
    };
    Ok(tx.execute(
        "DELETE FROM _snapback_declared_clients WHERE last_seen_ms <= ?1",
        params![cutoff as i64],
    )? as u64)
}

fn record_on(
    conn: &Connection,
    normalized_id: &str,
) -> SnapbackResult<Option<DeclaredClientRecord>> {
    conn.query_row(
        "SELECT normalized_id, first_seen_ms, last_seen_ms, request_count,
                refusal_count, status, age_policy_generation,
                network_evidence_generation
         FROM _snapback_declared_clients WHERE normalized_id = ?1",
        params![normalized_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)? as u64,
                row.get::<_, i64>(2)? as u64,
                row.get::<_, i64>(3)? as u64,
                row.get::<_, i64>(4)? as u64,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)? as u64,
                row.get::<_, i64>(7)? as u64,
            ))
        },
    )
    .optional()?
    .map(
        |(
            normalized_id,
            first_seen_ms,
            last_seen_ms,
            request_count,
            refusal_count,
            status,
            age_policy_generation,
            network_evidence_generation,
        )| {
            Ok(DeclaredClientRecord {
                normalized_id,
                first_seen_ms,
                last_seen_ms,
                request_count,
                refusal_count,
                status: DeclaredClientStatus::parse(&status)?,
                age_policy_generation,
                network_evidence_generation,
            })
        },
    )
    .transpose()
}

fn observe_on(
    tx: &Transaction<'_>,
    normalized_id: &str,
    now_ms: u64,
    network_evidence_generation: u64,
    row_cap: u64,
) -> SnapbackResult<DeclaredClientObservation> {
    validate_id(normalized_id)?;
    sweep_expired_on(tx, now_ms)?;
    if record_on(tx, normalized_id)?.is_some() {
        tx.execute(
            "UPDATE _snapback_declared_clients
             SET last_seen_ms = MAX(last_seen_ms, ?1),
                 request_count = CASE
                   WHEN request_count < ?2 THEN request_count + 1
                   ELSE request_count END,
                 age_policy_generation = MIN(
                   ?3,
                   MAX(
                     age_policy_generation,
                     1 + ((MAX(?1, first_seen_ms) - first_seen_ms) / ?4)
                   )
                 ),
                 network_evidence_generation = ?5
             WHERE normalized_id = ?6",
            params![
                now_ms as i64,
                MAX_SAFE_COUNTER as i64,
                DECLARED_CLIENT_MAX_AGE_POLICY_GENERATION as i64,
                DECLARED_CLIENT_AGE_STEP_MS as i64,
                network_evidence_generation as i64,
                normalized_id,
            ],
        )?;
        return Ok(DeclaredClientObservation::Observed(
            record_on(tx, normalized_id)?.expect("updated declared row exists"),
        ));
    }
    let live_count: u64 = tx.query_row(
        "SELECT COUNT(*) FROM _snapback_declared_clients",
        [],
        |row| row.get(0),
    )?;
    if live_count >= row_cap {
        return Ok(DeclaredClientObservation::Capacity);
    }
    tx.execute(
        "INSERT INTO _snapback_declared_clients(
           normalized_id, first_seen_ms, last_seen_ms, request_count,
           refusal_count, status, age_policy_generation,
           network_evidence_generation
         ) VALUES(?1, ?2, ?2, 1, 0, 'active', 1, ?3)",
        params![
            normalized_id,
            now_ms as i64,
            network_evidence_generation as i64,
        ],
    )?;
    Ok(DeclaredClientObservation::Observed(
        record_on(tx, normalized_id)?.expect("inserted declared row exists"),
    ))
}

impl LocalDatabase {
    /// Read the current row after applying the idle TTL. A miss is the only
    /// state for which the process-local low-cardinality creation gate may be
    /// consulted; rejected creation attempts never refresh an expired row.
    pub fn declared_client_for_admission(
        &mut self,
        normalized_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<Option<DeclaredClientRecord>> {
        validate_id(normalized_id)?;
        if !table_exists(&self.conn)? {
            return Ok(None);
        }
        self.with_auth_transaction(|tx| {
            sweep_expired_on(tx, now_ms)?;
            record_on(tx, normalized_id)
        })
    }

    /// Create or cheaply advance one attribution row. Exact counters are not
    /// billing facts; they saturate rather than growing the row or overflowing.
    pub fn observe_declared_client(
        &mut self,
        normalized_id: &str,
        now_ms: u64,
        network_evidence_generation: u64,
    ) -> SnapbackResult<DeclaredClientObservation> {
        if !table_exists(&self.conn)? {
            return Err(declared_clients_unavailable());
        }
        self.with_auth_transaction(|tx| {
            observe_on(
                tx,
                normalized_id,
                now_ms,
                network_evidence_generation,
                DECLARED_CLIENT_ROW_CAP,
            )
        })
    }

    pub fn mark_declared_client_refusal(&mut self, normalized_id: &str) -> SnapbackResult<()> {
        if !table_exists(&self.conn)? {
            return Ok(());
        }
        self.with_auth_transaction(|tx| {
            tx.execute(
                "UPDATE _snapback_declared_clients
                 SET refusal_count = CASE
                   WHEN refusal_count < request_count THEN refusal_count + 1
                   ELSE refusal_count END
                 WHERE normalized_id = ?1",
                params![normalized_id],
            )?;
            Ok(())
        })
    }

    pub fn set_declared_client_status(
        &mut self,
        normalized_id: &str,
        status: DeclaredClientStatus,
    ) -> SnapbackResult<DeclaredClientRecord> {
        validate_id(normalized_id)?;
        if !table_exists(&self.conn)? {
            return Err(declared_clients_unavailable());
        }
        self.with_auth_transaction(|tx| {
            let changed = tx.execute(
                "UPDATE _snapback_declared_clients SET status = ?1
                 WHERE normalized_id = ?2",
                params![status.as_str(), normalized_id],
            )?;
            if changed == 0 {
                return Err(declared_client_unknown());
            }
            record_on(tx, normalized_id)?.ok_or_else(declared_client_unknown)
        })
    }

    pub fn delete_declared_client(&mut self, normalized_id: &str) -> SnapbackResult<()> {
        validate_id(normalized_id)?;
        if !table_exists(&self.conn)? {
            return Err(declared_clients_unavailable());
        }
        let changed = self.with_auth_transaction(|tx| {
            Ok(tx.execute(
                "DELETE FROM _snapback_declared_clients WHERE normalized_id = ?1",
                params![normalized_id],
            )?)
        })?;
        if changed == 0 {
            return Err(declared_client_unknown());
        }
        Ok(())
    }

    pub fn list_declared_clients(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<Vec<DeclaredClientRecord>> {
        if !table_exists(&self.conn)? {
            return Ok(Vec::new());
        }
        self.with_auth_transaction(|tx| {
            sweep_expired_on(tx, now_ms)?;
            let mut statement = tx.prepare(
                "SELECT normalized_id FROM _snapback_declared_clients
                 ORDER BY last_seen_ms DESC, normalized_id",
            )?;
            let ids = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            ids.into_iter()
                .map(|id| record_on(tx, &id)?.ok_or_else(catalog_corrupt))
                .collect()
        })
    }
}

fn catalog_corrupt() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_API_DECLARED_CLIENT_CATALOG_CORRUPT",
        "api",
        "declared-client catalog differs from the exact protected shape",
    )
}

fn declared_clients_unavailable() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_API_DECLARED_CLIENTS_UNAVAILABLE",
        "api",
        "declared-client attribution is unavailable until api.enabled is activated",
    )
}

fn declared_client_unknown() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_API_DECLARED_CLIENT_UNKNOWN",
        "api",
        "declared client id is not present in the live attribution ledger",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ledger() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(TABLE_SQL).unwrap();
        conn.execute_batch(IDLE_INDEX_SQL).unwrap();
        conn.execute_batch(STATUS_INDEX_SQL).unwrap();
        conn
    }

    #[test]
    fn exact_ledger_advances_counters_and_preserves_existing_rows_at_cap() {
        let mut conn = ledger();
        let tx = conn.transaction().unwrap();
        let first = observe_on(&tx, "crawler-a/ops@example.test", 1_000, 7, 1).unwrap();
        assert!(matches!(first, DeclaredClientObservation::Observed(_)));
        assert_eq!(
            observe_on(&tx, "crawler-b/ops@example.test", 1_001, 7, 1).unwrap(),
            DeclaredClientObservation::Capacity
        );
        let existing = observe_on(&tx, "crawler-a/ops@example.test", 1_002, 8, 1).unwrap();
        let DeclaredClientObservation::Observed(existing) = existing else {
            panic!("existing row remains serviceable at cap")
        };
        assert_eq!(existing.request_count, 2);
        assert_eq!(existing.network_evidence_generation, 8);
        tx.commit().unwrap();
    }

    #[test]
    fn idle_expiry_evicts_and_reuse_starts_fresh() {
        let mut conn = ledger();
        let tx = conn.transaction().unwrap();
        observe_on(&tx, "crawler-a/ops@example.test", 1_000, 3, 10).unwrap();
        let reused_at = 1_000 + DECLARED_CLIENT_IDLE_TTL_MS;
        let reused = observe_on(&tx, "crawler-a/ops@example.test", reused_at, 4, 10).unwrap();
        let DeclaredClientObservation::Observed(reused) = reused else {
            panic!("expired row can be allocated fresh")
        };
        assert_eq!(reused.first_seen_ms, reused_at);
        assert_eq!(reused.request_count, 1);
        assert_eq!(reused.age_policy_generation, 1);
        tx.commit().unwrap();
    }

    #[test]
    fn continued_use_ages_only_through_the_bounded_schedule() {
        let mut conn = ledger();
        let tx = conn.transaction().unwrap();
        let id = "crawler-aged/ops@example.test";
        let start = 1_000;
        observe_on(&tx, id, start, 1, 10).unwrap();
        for expected in 2..=DECLARED_CLIENT_MAX_AGE_POLICY_GENERATION {
            let at = start + (expected - 1) * DECLARED_CLIENT_AGE_STEP_MS;
            let DeclaredClientObservation::Observed(record) =
                observe_on(&tx, id, at, expected, 10).unwrap()
            else {
                panic!("continued caller remains in the declared lane")
            };
            assert_eq!(record.age_policy_generation, expected);
        }
        let DeclaredClientObservation::Observed(capped) = observe_on(
            &tx,
            id,
            start + DECLARED_CLIENT_MAX_AGE_POLICY_GENERATION * DECLARED_CLIENT_AGE_STEP_MS,
            9,
            10,
        )
        .unwrap() else {
            panic!("aged caller remains in the declared lane")
        };
        assert_eq!(
            capped.age_policy_generation,
            DECLARED_CLIENT_MAX_AGE_POLICY_GENERATION
        );
        tx.commit().unwrap();
    }

    #[test]
    fn operator_status_projection_and_delete_are_exact() {
        let mut db = LocalDatabase::memory().unwrap();
        db.activate_current_auth_catalog().unwrap();
        db.with_auth_transaction(|tx| {
            tx.execute_batch(TABLE_SQL)?;
            tx.execute_batch(IDLE_INDEX_SQL)?;
            tx.execute_batch(STATUS_INDEX_SQL)
                .map_err(SnapbackError::from)
        })
        .unwrap();
        let id = "crawler-operator/ops@example.test";
        db.observe_declared_client(id, 1_000, 1).unwrap();
        assert_eq!(
            db.set_declared_client_status(id, DeclaredClientStatus::Blessed)
                .unwrap()
                .status,
            DeclaredClientStatus::Blessed
        );
        assert_eq!(
            db.set_declared_client_status(id, DeclaredClientStatus::Suspended)
                .unwrap()
                .status,
            DeclaredClientStatus::Suspended
        );
        assert_eq!(
            db.set_declared_client_status(id, DeclaredClientStatus::Active)
                .unwrap()
                .status,
            DeclaredClientStatus::Active
        );
        let listed = db.list_declared_clients(1_001).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].normalized_id, id);
        db.delete_declared_client(id).unwrap();
        assert!(db.list_declared_clients(1_002).unwrap().is_empty());
        assert_eq!(
            db.delete_declared_client(id).unwrap_err().diagnostic.code,
            "SNAPBACK_API_DECLARED_CLIENT_UNKNOWN"
        );
    }

    #[test]
    fn exact_shape_rejects_tampering() {
        let conn = ledger();
        validate_exact_schema(&conn).unwrap();
        conn.execute_batch("DROP INDEX _snapback_declared_clients_idle;")
            .unwrap();
        assert_eq!(
            validate_exact_schema(&conn).unwrap_err().diagnostic.code,
            "SNAPBACK_API_DECLARED_CLIENT_CATALOG_CORRUPT"
        );
    }
}
