//! Owner-clock schedules and their certified row bindings.
use crate::{
    Ceilings, Certificate, CheckError, Checker, ColumnType, Program, ProgramKind, Schema, WriteSite,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Schedule {
    pub name: String,
    pub trigger: Trigger,
    pub target: String,
    /// The qualified name of the binding program the compiler emits beside the target:
    /// a pure query over the row's referenced fields returning `{ enabled, args }`.
    pub binding: String,
    pub site: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Trigger {
    Row {
        table: String,
        column: String,
    },
    Every {
        #[serde(rename = "durationMs")]
        duration_ms: i64,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timer {
    pub id: String,
    pub schedule: String,
    pub row_id: Option<String>,
    pub at: i64,
    pub period_start: Option<i64>,
    pub generation: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Firing {
    pub timer: String,
    pub schedule: String,
    pub target: String,
    pub occurrence: serde_json::Value,
    pub row_id: Option<String>,
    pub period_start: Option<i64>,
    pub scheduled_at: i64,
    pub fired_at: i64,
    pub lateness_ms: i64,
    pub skipped: u64,
    pub outcome: serde_json::Value,
}
#[derive(Clone, Debug)]
pub struct TimerOutcome {
    pub firing: Firing,
    pub seq: u64,
}

pub(crate) fn write_bound(schema: &Schema, writes: &[WriteSite]) -> u64 {
    writes.iter().fold(0_u64, |total, write| {
        let count = schema
            .schedules
            .iter()
            .filter(|s| matches!(&s.trigger, Trigger::Row {table, ..} if table == &write.table))
            .count() as u64;
        total.saturating_add(write.max_rows.saturating_mul(count))
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TimerCertificates {
    pub binding: Program,
    pub binding_certificate: Certificate,
    pub target: Certificate,
}

pub(crate) fn certify(
    schema: &Schema,
    programs: &[(String, Program)],
    ceilings: &Ceilings,
) -> Result<BTreeMap<String, TimerCertificates>, Vec<(String, CheckError)>> {
    let mut errors = vec![];
    let mut bindings = BTreeMap::new();
    let mut seen = BTreeSet::new();
    for schedule in &schema.schedules {
        let mut fail = |code: &str, message: String, rewrite: &str| {
            errors.push((
                schedule.site.clone(),
                CheckError {
                    site: None,
                    code: code.into(),
                    message,
                    rewrite: rewrite.into(),
                },
            ))
        };
        if !seen.insert(&schedule.name) {
            fail(
                "E_SCHEDULE_TARGET",
                format!("duplicate schedule {}", schedule.name),
                "give each schedule a unique name",
            );
        }
        let target = programs
            .iter()
            .find(|(name, _)| name == &schedule.target)
            .map(|(_, p)| p);
        let Some(binding) = programs
            .iter()
            .find(|(name, _)| name == &schedule.binding)
            .map(|(_, p)| p)
        else {
            fail(
                "E_SCHEDULE_TARGET",
                format!(
                    "{} has no binding program {}",
                    schedule.name, schedule.binding
                ),
                "recompile the project; the compiler emits the binding beside the target",
            );
            continue;
        };
        if target.is_none_or(|p| !matches!(p.kind, ProgramKind::Mutation | ProgramKind::Job)) {
            fail(
                "E_SCHEDULE_TARGET",
                format!("{} must target a declared mutation or job", schedule.name),
                "target a mutation or job of this project with matching arguments",
            );
        }
        match &schedule.trigger {
            Trigger::Row { table, column } => {
                if schema.tables.get(table).and_then(|t| t.columns.get(column))
                    != Some(&ColumnType::Optional(Box::new(ColumnType::Time)))
                {
                    fail(
                        "E_SCHEDULE_COLUMN",
                        format!("{table}.{column} must be time ?"),
                        "declare the schedule column as time ?",
                    );
                }
            }
            Trigger::Every { duration_ms } => {
                if *duration_ms < 60_000
                    || duration_ms % 60_000 != 0
                    || *duration_ms > crate::value::I53_MAX
                {
                    fail(
                        "E_SCHEDULE_DURATION",
                        "a period is a positive whole minute duration".into(),
                        "schedule dailyDigest every 24h: digestSweep",
                    );
                }
                if target.is_some_and(|p| !p.args.is_empty()) || !binding.args.is_empty() {
                    fail(
                        "E_SCHEDULE_TARGET",
                        "every targets take no arguments".into(),
                        "declare a no-argument mutation or job",
                    );
                }
            }
        }
        match Checker::new(schema, ceilings.clone()).check_all(binding) {
            Ok(cert)
                if binding.kind == ProgramKind::Query
                    && cert.read_sites.is_empty()
                    && cert.write_sites.is_empty() =>
            {
                if let Some(target) = target {
                    let mut target_ceilings = ceilings.clone();
                    target_ceilings.write_rows = target_ceilings.write_rows.saturating_sub(1);
                    match Checker::new(schema, target_ceilings).check_all(target) {
                        Ok(mut target_cert) => {
                            target_cert.write_sites.push(crate::WriteSite {
                                table: "_timers".into(),
                                kind: crate::WriteKind::Update,
                                max_rows: 1,
                            });
                            if !target_cert.engine_writes.iter().any(|s| s == "_timers") {
                                target_cert.engine_writes.push("_timers".into());
                            }
                            bindings.insert(
                                schedule.name.clone(),
                                TimerCertificates {
                                    binding: binding.clone(),
                                    binding_certificate: cert,
                                    target: target_cert,
                                },
                            );
                        }
                        Err(mut refused) => {
                            errors.extend(refused.drain(..).map(|e| (schedule.site.clone(), e)))
                        }
                    }
                }
            }
            _ => fail(
                "E_SCHEDULE_TARGET",
                "schedule bindings must be bounded pure row expressions".into(),
                "pass matching row fields or bounded pure expressions to the target",
            ),
        }
    }
    if errors.is_empty() {
        Ok(bindings)
    } else {
        Err(errors)
    }
}
