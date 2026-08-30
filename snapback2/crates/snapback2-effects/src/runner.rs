use crate::{EffectHost, EffectJob, EffectLog, Outcome};
use serde_json::{Value, json};
use snapback2_core::EffectDecl;
use std::collections::BTreeMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use thiserror::Error;

pub const DEFAULT_BUDGET: Duration = Duration::from_secs(30);
pub const DEFAULT_DRAIN_LIMIT: usize = 16;
const MAX_ATTEMPTS: u32 = 5;

#[derive(Clone, Debug, Error, PartialEq, Eq)]
#[error("{0}")]
pub struct OutboxError(pub String);

impl From<String> for OutboxError {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for OutboxError {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

/// A complete writer-thread update for one claimed row.
#[derive(Clone, Debug, PartialEq)]
pub enum OutboxSettlement {
    Sent {
        result: Value,
        /// A failed `then` is recorded while the row honestly remains sent.
        last_error: Option<String>,
    },
    Retry {
        error: String,
        next_at: i64,
    },
    Failed {
        error: String,
    },
}

/// The short request/reply seam between the effects runner and the sole store
/// writer. A binary implementation can send one request to the writer thread
/// in each method and wait for its reply; no method spans the host call.
// @ref LLP 1002#5-the-owner — only the writer thread owns Runtime and SQLite.
// @ref LLP 1003#2-the-outbox-lifecycle — claiming, settling, restart honesty, and `then` all cross this seam.
pub trait OutboxAccess {
    /// Atomically select the oldest eligible queued row and transition it to
    /// `running`, incrementing `attempts` before returning it.
    fn claim_next(&mut self, now: i64) -> Result<Option<EffectJob>, OutboxError>;

    fn settle(&mut self, id: &str, settlement: OutboxSettlement) -> Result<(), OutboxError>;

    /// Explicitly return a row to `queued`. Attempts are preserved so a human
    /// retry of `sent_unknown` remains visible in its history.
    fn requeue(&mut self, id: &str, now: i64) -> Result<(), OutboxError>;

    /// On owner startup, atomically mark every lingering `running` row as
    /// `sent_unknown`. Such rows are never claimed automatically.
    fn mark_unknown_running_at_start(&mut self, now: i64) -> Result<u64, OutboxError>;

    /// Execute a named mutation as `Context::system()` on the writer thread.
    fn execute_system(&mut self, op: &str, args: Value) -> Result<(), OutboxError>;
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Drained {
    pub claimed: u64,
    pub sent: u64,
    pub failed: u64,
    pub requeued: u64,
    pub unavailable: u64,
    pub then_failed: u64,
    pub logs: Vec<EffectLog>,
}

pub struct Runner<H: EffectHost> {
    host: H,
    budget: Duration,
}

impl<H: EffectHost> Runner<H> {
    pub fn new(host: H) -> Self {
        Self {
            host,
            budget: DEFAULT_BUDGET,
        }
    }

    pub fn with_budget(host: H, budget: Duration) -> Self {
        Self { host, budget }
    }

    pub fn host(&self) -> &H {
        &self.host
    }

    pub fn host_mut(&mut self) -> &mut H {
        &mut self.host
    }

    pub fn describe(&self) -> &'static str {
        self.host.describe()
    }

    pub fn initialize<A: OutboxAccess>(&mut self, access: &mut A) -> Result<u64, OutboxError> {
        access.mark_unknown_running_at_start(unix_millis())
    }

    pub fn drain<A: OutboxAccess>(
        &mut self,
        access: &mut A,
        declarations: &BTreeMap<String, EffectDecl>,
    ) -> Result<Drained, OutboxError> {
        self.drain_at(access, declarations, unix_millis(), DEFAULT_DRAIN_LIMIT)
    }

    /// Deterministic form used by the owner and seam tests. The writer owns
    /// claim ordering and compare-and-set behavior; this method never holds a
    /// writer borrow while `host.run` executes.
    pub fn drain_at<A: OutboxAccess>(
        &mut self,
        access: &mut A,
        declarations: &BTreeMap<String, EffectDecl>,
        now: i64,
        limit: usize,
    ) -> Result<Drained, OutboxError> {
        let mut drained = Drained::default();
        if self.host.describe() == "none" {
            // An engine-less owner leaves queued rows entirely untouched.
            drained.unavailable = 1;
            return Ok(drained);
        }
        for _ in 0..limit {
            let Some(job) = access.claim_next(now)? else {
                break;
            };
            drained.claimed += 1;

            let Some(decl) = declarations.get(&job.effect) else {
                access.settle(
                    &job.id,
                    OutboxSettlement::Failed {
                        error: "E_EFFECT_UNKNOWN".to_owned(),
                    },
                )?;
                drained.failed += 1;
                continue;
            };

            let outcome = self.host.run(decl, &job, self.budget);
            drained.logs.extend(self.host.take_logs());
            match outcome {
                Outcome::Sent(result) => {
                    access.settle(
                        &job.id,
                        OutboxSettlement::Sent {
                            result: result.clone(),
                            last_error: None,
                        },
                    )?;
                    drained.sent += 1;
                    if let Some(then) = &decl.then {
                        let args = json!({
                            "outboxId": job.id,
                            "effect": job.effect,
                            "result": result,
                        });
                        if let Err(error) = access.execute_system(then, args) {
                            access.settle(
                                &job.id,
                                OutboxSettlement::Sent {
                                    result,
                                    last_error: Some(error.to_string()),
                                },
                            )?;
                            drained.then_failed += 1;
                        }
                    }
                }
                Outcome::Failed { error, retry } if retry && job.attempt < MAX_ATTEMPTS => {
                    access.settle(
                        &job.id,
                        OutboxSettlement::Retry {
                            error,
                            next_at: now.saturating_add(retry_delay_ms(job.attempt)),
                        },
                    )?;
                    drained.requeued += 1;
                }
                Outcome::Failed { error, .. } => {
                    access.settle(&job.id, OutboxSettlement::Failed { error })?;
                    drained.failed += 1;
                }
                Outcome::Unavailable(_) => {
                    access.requeue(&job.id, now)?;
                    drained.requeued += 1;
                    drained.unavailable += 1;
                    // The same oldest row is immediately eligible again. Stop
                    // this wake rather than spinning.
                    break;
                }
            }
        }
        Ok(drained)
    }
}

fn retry_delay_ms(attempt: u32) -> i64 {
    1_000_i64.saturating_mul(1_i64.checked_shl(attempt.min(30)).unwrap_or(i64::MAX))
}

fn unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    #[derive(Clone, Debug)]
    struct Row {
        job: EffectJob,
        state: &'static str,
        next_at: i64,
        created_at: i64,
        last_error: Option<String>,
        result: Option<Value>,
    }

    #[derive(Default)]
    struct MemoryOutbox {
        rows: Vec<Row>,
        system_calls: Vec<(String, Value)>,
        system_error: Option<String>,
    }

    impl MemoryOutbox {
        fn push(&mut self, id: &str, effect: &str, state: &'static str, attempts: u32) {
            self.rows.push(Row {
                job: EffectJob {
                    id: id.to_owned(),
                    effect: effect.to_owned(),
                    payload: json!({ "id": id }),
                    attempt: attempts,
                },
                state,
                next_at: 0,
                created_at: self.rows.len() as i64,
                last_error: None,
                result: None,
            });
        }

        fn row(&self, id: &str) -> &Row {
            self.rows.iter().find(|row| row.job.id == id).unwrap()
        }

        fn row_mut(&mut self, id: &str) -> Result<&mut Row, OutboxError> {
            self.rows
                .iter_mut()
                .find(|row| row.job.id == id)
                .ok_or_else(|| OutboxError(format!("unknown outbox row {id}")))
        }
    }

    impl OutboxAccess for MemoryOutbox {
        fn claim_next(&mut self, now: i64) -> Result<Option<EffectJob>, OutboxError> {
            let selected = self
                .rows
                .iter()
                .enumerate()
                .filter(|(_, row)| row.state == "queued" && row.next_at <= now)
                .min_by_key(|(_, row)| (row.next_at, row.created_at))
                .map(|(index, _)| index);
            let Some(index) = selected else {
                return Ok(None);
            };
            let row = &mut self.rows[index];
            row.state = "running";
            row.job.attempt += 1;
            Ok(Some(row.job.clone()))
        }

        fn settle(&mut self, id: &str, settlement: OutboxSettlement) -> Result<(), OutboxError> {
            let row = self.row_mut(id)?;
            match settlement {
                OutboxSettlement::Sent { result, last_error } => {
                    row.state = "sent";
                    row.result = Some(result);
                    row.last_error = last_error;
                }
                OutboxSettlement::Retry { error, next_at } => {
                    row.state = "queued";
                    row.next_at = next_at;
                    row.last_error = Some(error);
                }
                OutboxSettlement::Failed { error } => {
                    row.state = "failed";
                    row.last_error = Some(error);
                }
            }
            Ok(())
        }

        fn requeue(&mut self, id: &str, now: i64) -> Result<(), OutboxError> {
            let row = self.row_mut(id)?;
            row.state = "queued";
            row.next_at = now;
            row.last_error = None;
            Ok(())
        }

        fn mark_unknown_running_at_start(&mut self, _now: i64) -> Result<u64, OutboxError> {
            let mut changed = 0;
            for row in &mut self.rows {
                if row.state == "running" {
                    row.state = "sent_unknown";
                    changed += 1;
                }
            }
            Ok(changed)
        }

        fn execute_system(&mut self, op: &str, args: Value) -> Result<(), OutboxError> {
            if let Some(error) = &self.system_error {
                return Err(OutboxError(error.clone()));
            }
            self.system_calls.push((op.to_owned(), args));
            Ok(())
        }
    }

    struct StubHost {
        outcomes: VecDeque<Outcome>,
        logs: Vec<EffectLog>,
        calls: Vec<(EffectDecl, EffectJob)>,
    }

    impl StubHost {
        fn new(outcomes: impl IntoIterator<Item = Outcome>) -> Self {
            Self {
                outcomes: outcomes.into_iter().collect(),
                logs: Vec::new(),
                calls: Vec::new(),
            }
        }
    }

    impl EffectHost for StubHost {
        fn run(&mut self, decl: &EffectDecl, job: &EffectJob, _budget: Duration) -> Outcome {
            self.calls.push((decl.clone(), job.clone()));
            self.outcomes.pop_front().expect("stub outcome")
        }

        fn describe(&self) -> &'static str {
            "stub"
        }

        fn take_logs(&mut self) -> Vec<EffectLog> {
            std::mem::take(&mut self.logs)
        }
    }

    fn declaration(then: Option<&str>) -> EffectDecl {
        EffectDecl {
            name: "notifications.notify".to_owned(),
            grants: vec!["https://api.example.com".to_owned()],
            source: "async () => true".to_owned(),
            then: then.map(str::to_owned),
        }
    }

    fn declarations(decl: EffectDecl) -> BTreeMap<String, EffectDecl> {
        BTreeMap::from([(decl.name.clone(), decl)])
    }

    #[test]
    fn success_settles_sent_before_running_then() {
        let host = StubHost::new([Outcome::Sent(json!({ "providerId": "p1" }))]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox::default();
        outbox.push("o1", "notifications.notify", "queued", 0);

        let drained = runner
            .drain_at(
                &mut outbox,
                &declarations(declaration(Some("notifications.recordNotified"))),
                10,
                16,
            )
            .unwrap();

        assert_eq!(drained.sent, 1);
        assert_eq!(outbox.row("o1").state, "sent");
        assert_eq!(outbox.row("o1").job.attempt, 1);
        assert_eq!(outbox.system_calls[0].0, "notifications.recordNotified");
        assert_eq!(outbox.system_calls[0].1["outboxId"], "o1");
        assert_eq!(outbox.system_calls[0].1["effect"], "notifications.notify");
        assert_eq!(outbox.system_calls[0].1["result"]["providerId"], "p1");
    }

    #[test]
    fn retry_uses_post_claim_attempt_and_stops_at_five() {
        let host = StubHost::new([
            Outcome::Failed {
                error: "temporary".to_owned(),
                retry: true,
            },
            Outcome::Failed {
                error: "still broken".to_owned(),
                retry: true,
            },
        ]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox::default();
        outbox.push("retry", "notifications.notify", "queued", 0);
        outbox.push("last", "notifications.notify", "queued", 4);

        let drained = runner
            .drain_at(&mut outbox, &declarations(declaration(None)), 1_000, 16)
            .unwrap();

        assert_eq!(drained.requeued, 1);
        assert_eq!(drained.failed, 1);
        assert_eq!(outbox.row("retry").state, "queued");
        assert_eq!(outbox.row("retry").next_at, 3_000);
        assert_eq!(outbox.row("last").state, "failed");
        assert_eq!(outbox.row("last").job.attempt, 5);
    }

    #[test]
    fn non_retryable_and_removed_effects_fail_immediately() {
        let host = StubHost::new([Outcome::Failed {
            error: "denied: net.fetch http://127.0.0.1:9".to_owned(),
            retry: false,
        }]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox::default();
        outbox.push("denied", "notifications.notify", "queued", 0);
        outbox.push("removed", "removed.effect", "queued", 0);

        let drained = runner
            .drain_at(&mut outbox, &declarations(declaration(None)), 0, 16)
            .unwrap();

        assert_eq!(drained.failed, 2);
        assert!(
            outbox
                .row("denied")
                .last_error
                .as_deref()
                .unwrap()
                .contains("denied")
        );
        assert_eq!(
            outbox.row("removed").last_error.as_deref(),
            Some("E_EFFECT_UNKNOWN")
        );
    }

    #[test]
    fn failed_then_leaves_effect_sent_with_the_error() {
        let host = StubHost::new([Outcome::Sent(json!(true))]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox {
            system_error: Some("E_INPUT: then rejected".to_owned()),
            ..MemoryOutbox::default()
        };
        outbox.push("o1", "notifications.notify", "queued", 0);

        let drained = runner
            .drain_at(
                &mut outbox,
                &declarations(declaration(Some("notifications.recordNotified"))),
                0,
                16,
            )
            .unwrap();

        assert_eq!(drained.sent, 1);
        assert_eq!(drained.then_failed, 1);
        assert_eq!(outbox.row("o1").state, "sent");
        assert_eq!(
            outbox.row("o1").last_error.as_deref(),
            Some("E_INPUT: then rejected")
        );
    }

    #[test]
    fn startup_marks_running_unknown_and_no_engine_keeps_work_queued() {
        let mut outbox = MemoryOutbox::default();
        outbox.push("maybe-sent", "notifications.notify", "running", 1);
        outbox.push("waiting", "notifications.notify", "queued", 0);
        let mut runner = Runner::new(crate::NoEngine);

        assert_eq!(runner.initialize(&mut outbox).unwrap(), 1);
        let drained = runner
            .drain_at(&mut outbox, &declarations(declaration(None)), 0, 16)
            .unwrap();

        assert_eq!(outbox.row("maybe-sent").state, "sent_unknown");
        assert_eq!(outbox.row("waiting").state, "queued");
        assert_eq!(outbox.row("waiting").job.attempt, 0);
        assert_eq!(drained.unavailable, 1);
    }
}
