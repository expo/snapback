//! Manifest-activated protected webhook delivery and attempt ledger.

use super::{LocalDatabase, SnapbackResult};
use crate::diagnostic::SnapbackError;
use crate::manifest::SchemaManifest;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::Serialize;

const TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS _snapback_webhook_deliveries (
  id TEXT NOT NULL PRIMARY KEY,
  consumer_kind TEXT NOT NULL CHECK(consumer_kind IN ('watch')),
  consumer_id TEXT NOT NULL,
  event_ordinal INTEGER NOT NULL CHECK(event_ordinal BETWEEN 1 AND 9007199254740991),
  owner_principal_id TEXT NOT NULL,
  target_url TEXT NOT NULL CHECK(length(CAST(target_url AS BLOB)) <= 2048),
  payload_json TEXT NOT NULL CHECK(length(CAST(payload_json AS BLOB)) <= 262144),
  payload_digest TEXT NOT NULL,
  secret_ref TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK(length(CAST(idempotency_key AS BLOB)) BETWEEN 1 AND 256),
  state TEXT NOT NULL CHECK(state IN ('pending', 'succeeded', 'dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 8),
  max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 8),
  last_http_status INTEGER,
  last_diagnostic_code TEXT,
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms BETWEEN created_at_ms AND 9007199254740991),
  dead_at_ms INTEGER,
  UNIQUE(consumer_kind, consumer_id, event_ordinal)
);
CREATE INDEX IF NOT EXISTS _snapback_webhook_deliveries_state
  ON _snapback_webhook_deliveries(state, updated_at_ms, id);
CREATE TABLE IF NOT EXISTS _snapback_webhook_attempts (
  delivery_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 8),
  attempted_at_ms INTEGER NOT NULL CHECK(attempted_at_ms BETWEEN 0 AND 9007199254740991),
  outcome TEXT NOT NULL CHECK(outcome IN ('succeeded', 'retryable', 'dead')),
  http_status INTEGER,
  diagnostic_code TEXT,
  PRIMARY KEY(delivery_id, attempt),
  FOREIGN KEY(delivery_id) REFERENCES _snapback_webhook_deliveries(id) ON DELETE CASCADE
);
"#;

#[derive(Clone, Debug)]
pub struct ReserveDelivery {
    pub id: String,
    pub consumer_id: String,
    pub event_ordinal: u64,
    pub owner_principal_id: String,
    pub target_url: String,
    pub payload_json: String,
    pub payload_digest: String,
    pub secret_ref: String,
    pub idempotency_key: String,
    pub max_attempts: u32,
    pub now_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryRecord {
    pub id: String,
    pub consumer_id: String,
    pub event_ordinal: u64,
    pub owner_principal_id: String,
    pub target_url: String,
    pub payload_json: String,
    pub payload_digest: String,
    pub secret_ref: String,
    pub idempotency_key: String,
    pub state: String,
    pub attempt_count: u32,
    pub max_attempts: u32,
}

pub fn activate_manifest_in(
    tx: &Transaction<'_>,
    manifest: &SchemaManifest,
) -> SnapbackResult<()> {
    if !super::watches::manifest_enabled(manifest) {
        tx.execute_batch(
            "DROP TABLE IF EXISTS _snapback_webhook_attempts;
             DROP TABLE IF EXISTS _snapback_webhook_deliveries;",
        )?;
        return Ok(());
    }
    tx.execute_batch(TABLE_SQL)?;
    validate_exact_schema(tx)
}

fn validate_exact_schema(conn: &Connection) -> SnapbackResult<()> {
    let reference = Connection::open_in_memory()?;
    reference.execute_batch("PRAGMA foreign_keys = ON;")?;
    reference.execute_batch(TABLE_SQL)?;
    if catalog_objects(conn)? != catalog_objects(&reference)? {
        return Err(catalog_corrupt());
    }
    Ok(())
}

fn catalog_objects(conn: &Connection) -> SnapbackResult<Vec<(String, String, String, String)>> {
    let mut statement = conn.prepare(
        "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_schema
         WHERE name IN ('_snapback_webhook_deliveries', '_snapback_webhook_attempts')
            OR tbl_name IN ('_snapback_webhook_deliveries', '_snapback_webhook_attempts')
         ORDER BY type, name",
    )?;
    Ok(statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

impl LocalDatabase {
    pub fn reserve_webhook_delivery(
        &mut self,
        request: ReserveDelivery,
    ) -> SnapbackResult<DeliveryRecord> {
        self.conn.execute(
            "INSERT OR IGNORE INTO _snapback_webhook_deliveries(
               id, consumer_kind, consumer_id, event_ordinal, owner_principal_id,
               target_url, payload_json, payload_digest, secret_ref, idempotency_key,
               state, attempt_count, max_attempts, last_http_status,
               last_diagnostic_code, created_at_ms, updated_at_ms, dead_at_ms
             ) VALUES(?1, 'watch', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
               'pending', 0, ?10, NULL, NULL, ?11, ?11, NULL)",
            params![
                request.id,
                request.consumer_id,
                request.event_ordinal,
                request.owner_principal_id,
                request.target_url,
                request.payload_json,
                request.payload_digest,
                request.secret_ref,
                request.idempotency_key,
                request.max_attempts,
                request.now_ms,
            ],
        )?;
        let record =
            delivery_for_event_on(&self.conn, &request.consumer_id, request.event_ordinal)?
                .ok_or_else(catalog_corrupt)?;
        if record.id != request.id
            || record.owner_principal_id != request.owner_principal_id
            || record.target_url != request.target_url
            || record.payload_json != request.payload_json
            || record.payload_digest != request.payload_digest
            || record.secret_ref != request.secret_ref
            || record.idempotency_key != request.idempotency_key
            || record.max_attempts != request.max_attempts
        {
            return Err(catalog_corrupt());
        }
        Ok(record)
    }

    pub fn settle_webhook_attempt(
        &mut self,
        delivery_id: &str,
        attempt: u32,
        outcome: &str,
        http_status: Option<u16>,
        diagnostic_code: Option<&str>,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        if !matches!(outcome, "succeeded" | "retryable" | "dead") {
            return Err(catalog_corrupt());
        }
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO _snapback_webhook_attempts(
               delivery_id, attempt, attempted_at_ms, outcome, http_status, diagnostic_code
             ) VALUES(?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(delivery_id, attempt) DO UPDATE SET
               attempted_at_ms = excluded.attempted_at_ms,
               outcome = excluded.outcome,
               http_status = excluded.http_status,
               diagnostic_code = excluded.diagnostic_code",
            params![
                delivery_id,
                attempt,
                now_ms,
                outcome,
                http_status,
                diagnostic_code
            ],
        )?;
        let state = if outcome == "succeeded" {
            "succeeded"
        } else if outcome == "dead" {
            "dead"
        } else {
            "pending"
        };
        tx.execute(
            "UPDATE _snapback_webhook_deliveries SET state = ?1,
             attempt_count = MAX(attempt_count, ?2), last_http_status = ?3,
             last_diagnostic_code = ?4, updated_at_ms = ?5,
             dead_at_ms = CASE WHEN ?1 = 'dead' THEN ?5 ELSE dead_at_ms END
             WHERE id = ?6",
            params![
                state,
                attempt,
                http_status,
                diagnostic_code,
                now_ms,
                delivery_id
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn webhook_delivery_for_test(
        &self,
        consumer_id: &str,
        ordinal: u64,
    ) -> SnapbackResult<Option<DeliveryRecord>> {
        delivery_for_event_on(&self.conn, consumer_id, ordinal)
    }
}

fn delivery_for_event_on(
    conn: &Connection,
    consumer_id: &str,
    ordinal: u64,
) -> SnapbackResult<Option<DeliveryRecord>> {
    conn.query_row(
        "SELECT id, consumer_id, event_ordinal, owner_principal_id, target_url,
                payload_json, payload_digest, secret_ref, idempotency_key,
                state, attempt_count, max_attempts
         FROM _snapback_webhook_deliveries
         WHERE consumer_kind = 'watch' AND consumer_id = ?1 AND event_ordinal = ?2",
        params![consumer_id, ordinal],
        |row| {
            Ok(DeliveryRecord {
                id: row.get(0)?,
                consumer_id: row.get(1)?,
                event_ordinal: row.get(2)?,
                owner_principal_id: row.get(3)?,
                target_url: row.get(4)?,
                payload_json: row.get(5)?,
                payload_digest: row.get(6)?,
                secret_ref: row.get(7)?,
                idempotency_key: row.get(8)?,
                state: row.get(9)?,
                attempt_count: row.get(10)?,
                max_attempts: row.get(11)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

fn catalog_corrupt() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_WEBHOOK_CATALOG_CORRUPT",
        "webhooks",
        "the webhook delivery ledger does not match its closed schema",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activation_and_stable_logical_delivery_are_exact() {
        let mut db = LocalDatabase::memory().unwrap();
        db.activate_current_auth_catalog().unwrap();
        let manifest = SchemaManifest {
            api: Some(crate::manifest::ApiManifest {
                enabled: true,
                ..Default::default()
            }),
            ..Default::default()
        };
        db.with_auth_transaction(|tx| activate_manifest_in(tx, &manifest))
            .unwrap();
        let reserve = || ReserveDelivery {
            id: "delivery-1".to_owned(),
            consumer_id: "watch-1".to_owned(),
            event_ordinal: 1,
            owner_principal_id: "integration-1".to_owned(),
            target_url: "https://example.com/hook".to_owned(),
            payload_json: r#"{"ordinal":1}"#.to_owned(),
            payload_digest: "sha256:one".to_owned(),
            secret_ref: "webhook:watch-1".to_owned(),
            idempotency_key: "watch:watch-1:1".to_owned(),
            max_attempts: 8,
            now_ms: 10,
        };
        let first = db.reserve_webhook_delivery(reserve()).unwrap();
        let second = db.reserve_webhook_delivery(reserve()).unwrap();
        assert_eq!(first.idempotency_key, second.idempotency_key);
        db.settle_webhook_attempt(
            &first.id,
            1,
            "retryable",
            None,
            Some("SNAPBACK_WEBHOOK_DELIVERY_RETRYABLE"),
            11,
        )
        .unwrap();
        db.settle_webhook_attempt(
            &first.id,
            8,
            "dead",
            Some(503),
            Some("SNAPBACK_WEBHOOK_DEAD_LETTERED"),
            12,
        )
        .unwrap();
        let dead = db.webhook_delivery_for_test("watch-1", 1).unwrap().unwrap();
        assert_eq!(dead.state, "dead");
        assert_eq!(dead.attempt_count, 8);
    }
}
