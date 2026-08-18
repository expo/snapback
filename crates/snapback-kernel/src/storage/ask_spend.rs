//! Durable reserve/settle ledger for the LLP 0204 read-only `ask` surface.
//!
//! Admission reserves the complete per-request token and result-byte maxima
//! in one SQLite transaction. Completion subtracts that reservation and adds
//! actual usage in one transaction. A crash can strand a reservation only in
//! the conservative direction: it reduces future capacity and never permits
//! overspend.
//!
//! @ref LLP 0204#d5--surface-4-the-near-data-ai-interface — token budgets are
//! layered and host-enforced; telemetry attribution is not the billing carrier.
//! @ref LLP 0204#open-questions — OQ7 adds a per-request and per-principal-day
//! result-volume ceiling, including caller-key billing.

use super::{LocalDatabase, SnapbackResult};
use crate::contract_types::ApiAskBudgets;
use crate::diagnostic::SnapbackError;
use crate::manifest::SchemaManifest;
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::Serialize;
use serde_json::json;

pub const ASK_SPEND_TABLE: &str = "_snapback_ask_spend";
const MAX_COUNTER: u64 = 9_007_199_254_740_991;

const TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS _snapback_ask_spend (
  day TEXT NOT NULL CHECK(length(day) BETWEEN 7 AND 10),
  lane TEXT NOT NULL CHECK(lane IN ('principal-day','integration-day','app-month')),
  caller_key TEXT NOT NULL CHECK(length(caller_key) BETWEEN 1 AND 1024),
  reserved_tokens INTEGER NOT NULL DEFAULT 0 CHECK(reserved_tokens BETWEEN 0 AND 9007199254740991),
  spent_tokens INTEGER NOT NULL DEFAULT 0 CHECK(spent_tokens BETWEEN 0 AND 9007199254740991),
  reserved_result_bytes INTEGER NOT NULL DEFAULT 0 CHECK(reserved_result_bytes BETWEEN 0 AND 9007199254740991),
  spent_result_bytes INTEGER NOT NULL DEFAULT 0 CHECK(spent_result_bytes BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY(day, lane, caller_key)
);
CREATE INDEX IF NOT EXISTS _snapback_ask_spend_lane_day
  ON _snapback_ask_spend(lane, day, caller_key);
"#;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AskSpendSubject {
    pub principal_key: String,
    pub integration_key: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AskSpendReservation {
    day: String,
    month: String,
    subject: AskSpendSubject,
    reserved_tokens: u64,
    reserved_result_bytes: u64,
    integration_reserved: bool,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskSpendFacts {
    pub principal_day_tokens: u64,
    pub principal_day_result_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub integration_day_tokens: Option<u64>,
    pub app_month_tokens: u64,
}

#[derive(Clone, Copy, Debug, Default)]
struct Counters {
    reserved_tokens: u64,
    spent_tokens: u64,
    reserved_result_bytes: u64,
    spent_result_bytes: u64,
}

pub fn manifest_enabled(manifest: &SchemaManifest) -> bool {
    manifest.ask_manifest().is_some()
}

pub fn activate_manifest_in(
    tx: &Transaction<'_>,
    manifest: &SchemaManifest,
) -> SnapbackResult<()> {
    if !manifest_enabled(manifest) {
        tx.execute_batch(
            "DROP INDEX IF EXISTS _snapback_ask_spend_lane_day;
             DROP TABLE IF EXISTS _snapback_ask_spend;",
        )?;
        return Ok(());
    }
    tx.execute_batch(TABLE_SQL)?;
    validate_exact_schema(tx)
}

pub(super) fn validate_exact_schema(conn: &Connection) -> SnapbackResult<()> {
    let reference = Connection::open_in_memory()?;
    reference.execute_batch(TABLE_SQL)?;
    if catalog_objects(conn)? != catalog_objects(&reference)? {
        return Err(catalog_corrupt());
    }
    Ok(())
}

fn catalog_objects(conn: &Connection) -> SnapbackResult<Vec<(String, String, String, String)>> {
    let mut statement = conn.prepare(
        "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_schema
         WHERE name = '_snapback_ask_spend' OR tbl_name = '_snapback_ask_spend'
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
            "SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1",
            params![ASK_SPEND_TABLE],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn ensure_row(tx: &Transaction<'_>, day: &str, lane: &str, caller_key: &str) -> SnapbackResult<()> {
    if caller_key.is_empty() || caller_key.len() > 1_024 {
        return Err(catalog_corrupt());
    }
    tx.execute(
        "INSERT INTO _snapback_ask_spend(day,lane,caller_key) VALUES(?1,?2,?3)
         ON CONFLICT(day,lane,caller_key) DO NOTHING",
        params![day, lane, caller_key],
    )?;
    Ok(())
}

fn counters_on(
    conn: &Connection,
    day: &str,
    lane: &str,
    caller_key: &str,
) -> SnapbackResult<Counters> {
    conn.query_row(
        "SELECT reserved_tokens,spent_tokens,reserved_result_bytes,spent_result_bytes
         FROM _snapback_ask_spend WHERE day=?1 AND lane=?2 AND caller_key=?3",
        params![day, lane, caller_key],
        |row| {
            Ok(Counters {
                reserved_tokens: row.get(0)?,
                spent_tokens: row.get(1)?,
                reserved_result_bytes: row.get(2)?,
                spent_result_bytes: row.get(3)?,
            })
        },
    )
    .optional()?
    .ok_or_else(catalog_corrupt)
}

fn checked_total(left: u64, right: u64) -> SnapbackResult<u64> {
    left.checked_add(right)
        .filter(|value| *value <= MAX_COUNTER)
        .ok_or_else(catalog_corrupt)
}

fn budget_refusal(dimension: &str, facts: &AskSpendFacts, limit: u64) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_API_ASK_BUDGET_EXHAUSTED",
        "api",
        "the declared ask budget is exhausted",
    )
    .with_details(json!({
        "dimension": dimension,
        "limit": limit,
        "spendSoFar": facts,
        "escalation": {
            "action": "request a larger ask budget or wait for the named period to roll over",
            "declaration": "api.budgets.ask"
        }
    }))
}

fn spend_facts_on(
    tx: &Transaction<'_>,
    day: &str,
    month: &str,
    subject: &AskSpendSubject,
    include_integration: bool,
) -> SnapbackResult<AskSpendFacts> {
    let principal = counters_on(tx, day, "principal-day", &subject.principal_key)?;
    let app = counters_on(tx, month, "app-month", "app")?;
    let integration_day_tokens = if include_integration {
        let key = subject
            .integration_key
            .as_deref()
            .ok_or_else(catalog_corrupt)?;
        let row = counters_on(tx, day, "integration-day", key)?;
        Some(checked_total(row.spent_tokens, row.reserved_tokens)?)
    } else {
        None
    };
    Ok(AskSpendFacts {
        principal_day_tokens: checked_total(principal.spent_tokens, principal.reserved_tokens)?,
        principal_day_result_bytes: checked_total(
            principal.spent_result_bytes,
            principal.reserved_result_bytes,
        )?,
        integration_day_tokens,
        app_month_tokens: checked_total(app.spent_tokens, app.reserved_tokens)?,
    })
}

impl LocalDatabase {
    pub fn reserve_ask_spend(
        &mut self,
        now_ms: u64,
        subject: AskSpendSubject,
        budgets: &ApiAskBudgets,
    ) -> SnapbackResult<(AskSpendReservation, AskSpendFacts)> {
        if !table_exists(&self.conn)? {
            return Err(SnapbackError::error(
                "SNAPBACK_API_ASK_DISABLED",
                "api",
                "ask is disabled because api.ask.enabled and its complete api.budgets.ask declaration are not active",
            )
            .with_details(json!({
                "missingDeclaration": ["api.ask.enabled", "api.budgets.ask"],
                "escalation": { "action": "ask the app operator to enable the read-only v1 ask surface with complete budgets" }
            })));
        }
        let (day, month) = utc_period_keys(now_ms);
        self.with_auth_transaction(|tx| {
            ensure_row(tx, &day, "principal-day", &subject.principal_key)?;
            ensure_row(tx, &month, "app-month", "app")?;
            let integration_reserved =
                budgets.per_integration_day.is_some() && subject.integration_key.is_some();
            if integration_reserved {
                ensure_row(
                    tx,
                    &day,
                    "integration-day",
                    subject
                        .integration_key
                        .as_deref()
                        .expect("checked integration key"),
                )?;
            }
            let before = spend_facts_on(tx, &day, &month, &subject, integration_reserved)?;
            let request_tokens = budgets.per_request.max_tokens;
            let request_bytes = budgets.result_volume.max_bytes;
            if checked_total(before.principal_day_tokens, request_tokens)?
                > budgets.per_principal_day.max_tokens
            {
                return Err(budget_refusal(
                    "perPrincipalDay.maxTokens",
                    &before,
                    budgets.per_principal_day.max_tokens,
                ));
            }
            if checked_total(before.principal_day_result_bytes, request_bytes)?
                > budgets.result_volume.per_principal_day_bytes
            {
                return Err(budget_refusal(
                    "resultVolume.perPrincipalDayBytes",
                    &before,
                    budgets.result_volume.per_principal_day_bytes,
                ));
            }
            if checked_total(before.app_month_tokens, request_tokens)?
                > budgets.app_monthly.max_tokens
            {
                return Err(budget_refusal(
                    "appMonthly.maxTokens",
                    &before,
                    budgets.app_monthly.max_tokens,
                ));
            }
            if let (Some(limit), Some(spent)) = (
                budgets
                    .per_integration_day
                    .as_ref()
                    .map(|budget| budget.max_tokens),
                before.integration_day_tokens,
            ) && checked_total(spent, request_tokens)? > limit
            {
                return Err(budget_refusal(
                    "perIntegrationDay.maxTokens",
                    &before,
                    limit,
                ));
            }
            tx.execute(
                "UPDATE _snapback_ask_spend
                 SET reserved_tokens=reserved_tokens+?1,
                     reserved_result_bytes=reserved_result_bytes+?2
                 WHERE day=?3 AND lane='principal-day' AND caller_key=?4",
                params![
                    request_tokens as i64,
                    request_bytes as i64,
                    day,
                    subject.principal_key
                ],
            )?;
            tx.execute(
                "UPDATE _snapback_ask_spend SET reserved_tokens=reserved_tokens+?1
                 WHERE day=?2 AND lane='app-month' AND caller_key='app'",
                params![request_tokens as i64, month],
            )?;
            if integration_reserved {
                tx.execute(
                    "UPDATE _snapback_ask_spend SET reserved_tokens=reserved_tokens+?1
                     WHERE day=?2 AND lane='integration-day' AND caller_key=?3",
                    params![request_tokens as i64, day, subject.integration_key],
                )?;
            }
            let facts = spend_facts_on(tx, &day, &month, &subject, integration_reserved)?;
            Ok((
                AskSpendReservation {
                    day,
                    month,
                    subject,
                    reserved_tokens: request_tokens,
                    reserved_result_bytes: request_bytes,
                    integration_reserved,
                },
                facts,
            ))
        })
    }

    pub fn settle_ask_spend(
        &mut self,
        reservation: &AskSpendReservation,
        actual_tokens: u64,
        actual_result_bytes: u64,
    ) -> SnapbackResult<AskSpendFacts> {
        if actual_tokens > reservation.reserved_tokens
            || actual_result_bytes > reservation.reserved_result_bytes
        {
            return Err(catalog_corrupt());
        }
        self.with_auth_transaction(|tx| {
            let changed = tx.execute(
                "UPDATE _snapback_ask_spend
                 SET reserved_tokens=reserved_tokens-?1,
                     spent_tokens=spent_tokens+?2,
                     reserved_result_bytes=reserved_result_bytes-?3,
                     spent_result_bytes=spent_result_bytes+?4
                 WHERE day=?5 AND lane='principal-day' AND caller_key=?6
                   AND reserved_tokens>=?1 AND reserved_result_bytes>=?3",
                params![
                    reservation.reserved_tokens as i64,
                    actual_tokens as i64,
                    reservation.reserved_result_bytes as i64,
                    actual_result_bytes as i64,
                    reservation.day,
                    reservation.subject.principal_key,
                ],
            )?;
            if changed != 1 {
                return Err(catalog_corrupt());
            }
            let changed = tx.execute(
                "UPDATE _snapback_ask_spend
                 SET reserved_tokens=reserved_tokens-?1, spent_tokens=spent_tokens+?2
                 WHERE day=?3 AND lane='app-month' AND caller_key='app' AND reserved_tokens>=?1",
                params![reservation.reserved_tokens as i64, actual_tokens as i64, reservation.month],
            )?;
            if changed != 1 {
                return Err(catalog_corrupt());
            }
            if reservation.integration_reserved {
                let changed = tx.execute(
                    "UPDATE _snapback_ask_spend
                     SET reserved_tokens=reserved_tokens-?1, spent_tokens=spent_tokens+?2
                     WHERE day=?3 AND lane='integration-day' AND caller_key=?4 AND reserved_tokens>=?1",
                    params![
                        reservation.reserved_tokens as i64,
                        actual_tokens as i64,
                        reservation.day,
                        reservation.subject.integration_key,
                    ],
                )?;
                if changed != 1 {
                    return Err(catalog_corrupt());
                }
            }
            spend_facts_on(
                tx,
                &reservation.day,
                &reservation.month,
                &reservation.subject,
                reservation.integration_reserved,
            )
        })
    }
}

pub fn utc_period_keys(now_ms: u64) -> (String, String) {
    let days = (now_ms / 1_000 / 86_400) as i64;
    let (year, month, day) = civil_from_days(days);
    (
        format!("{year:04}-{month:02}-{day:02}"),
        format!("{year:04}-{month:02}"),
    )
}

// Howard Hinnant's civil-from-days transform, with day zero = 1970-01-01.
fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}

fn catalog_corrupt() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_API_ASK_SPEND_CATALOG_CORRUPT",
        "storage",
        "ask spend ledger differs from its exact protected shape or reservation arithmetic",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract_types::{
        ApiAskPerPrincipalDayBudget, ApiAskPerRequestBudget, ApiAskResultVolumeBudget,
        ApiAskTokenBudget,
    };

    fn budgets() -> ApiAskBudgets {
        ApiAskBudgets {
            per_request: ApiAskPerRequestBudget {
                max_tokens: 10,
                max_steps: 3,
                max_wall_ms: 1_000,
            },
            per_principal_day: ApiAskPerPrincipalDayBudget { max_tokens: 20 },
            per_integration_day: Some(ApiAskTokenBudget { max_tokens: 15 }),
            app_monthly: ApiAskTokenBudget { max_tokens: 30 },
            result_volume: ApiAskResultVolumeBudget {
                max_bytes: 100,
                max_rows: 5,
                per_principal_day_bytes: 150,
            },
        }
    }

    #[test]
    fn utc_keys_roll_day_and_month() {
        assert_eq!(
            utc_period_keys(0),
            ("1970-01-01".to_owned(), "1970-01".to_owned())
        );
        assert_eq!(
            utc_period_keys(86_400_000),
            ("1970-01-02".to_owned(), "1970-01".to_owned())
        );
        assert_eq!(
            utc_period_keys(2_678_400_000),
            ("1970-02-01".to_owned(), "1970-02".to_owned())
        );
    }

    #[test]
    fn reserve_and_settle_are_layered_and_conservative() {
        let mut db = LocalDatabase::memory().unwrap();
        db.activate_current_auth_catalog().unwrap();
        db.conn.execute_batch(TABLE_SQL).unwrap();
        let subject = AskSpendSubject {
            principal_key: "user-1".to_owned(),
            integration_key: Some("integration-1".to_owned()),
        };
        let (first, admitted) = db
            .reserve_ask_spend(0, subject.clone(), &budgets())
            .unwrap();
        assert_eq!(admitted.principal_day_tokens, 10);
        let settled = db.settle_ask_spend(&first, 4, 25).unwrap();
        assert_eq!(settled.principal_day_tokens, 4);
        assert_eq!(settled.principal_day_result_bytes, 25);
        let (_second, admitted) = db
            .reserve_ask_spend(0, subject.clone(), &budgets())
            .unwrap();
        assert_eq!(admitted.integration_day_tokens, Some(14));
        let error = db.reserve_ask_spend(0, subject, &budgets()).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_API_ASK_BUDGET_EXHAUSTED");
        assert_eq!(
            error.diagnostic.details["dimension"],
            "perPrincipalDay.maxTokens"
        );
        assert!(error.diagnostic.details["spendSoFar"].is_object());
    }

    #[test]
    fn app_month_is_shared_while_principal_day_rolls_over() {
        let mut db = LocalDatabase::memory().unwrap();
        db.activate_current_auth_catalog().unwrap();
        db.conn.execute_batch(TABLE_SQL).unwrap();
        let mut limits = budgets();
        limits.app_monthly.max_tokens = 15;
        let first_subject = AskSpendSubject {
            principal_key: "user-1".to_owned(),
            integration_key: None,
        };
        let (first, _) = db
            .reserve_ask_spend(0, first_subject.clone(), &limits)
            .unwrap();
        db.settle_ask_spend(&first, 7, 0).unwrap();
        let next_day = 86_400_000;
        let error = db
            .reserve_ask_spend(
                next_day,
                AskSpendSubject {
                    principal_key: "user-2".to_owned(),
                    integration_key: None,
                },
                &limits,
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_API_ASK_BUDGET_EXHAUSTED");
        assert_eq!(
            error.diagnostic.details["dimension"],
            "appMonthly.maxTokens"
        );
        assert_eq!(error.diagnostic.details["spendSoFar"]["appMonthTokens"], 7);

        limits.app_monthly.max_tokens = 100;
        let (_, facts) = db
            .reserve_ask_spend(next_day, first_subject, &limits)
            .unwrap();
        assert_eq!(facts.principal_day_tokens, limits.per_request.max_tokens);
    }
}
