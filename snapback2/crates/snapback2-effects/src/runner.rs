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
    ThenPending {
        result: Value,
    },
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

/// A resolved effect whose `then` mutation still needs restart-safe delivery.
#[derive(Clone, Debug, PartialEq)]
pub struct PendingThen {
    pub id: String,
    pub effect: String,
    pub result: Value,
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

    /// Return every durable `then_pending` row in stable outbox order.
    fn pending_then(&mut self) -> Result<Vec<PendingThen>, OutboxError>;

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
    pub unavailable: Vec<String>,
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

    pub fn initialize<A: OutboxAccess>(
        &mut self,
        access: &mut A,
        declarations: &BTreeMap<String, EffectDecl>,
    ) -> Result<u64, OutboxError> {
        let unknown = access.mark_unknown_running_at_start(unix_millis())?;
        for pending in access.pending_then()? {
            let last_error = match declarations
                .get(&pending.effect)
                .and_then(|decl| decl.then.as_deref())
            {
                Some(then) => execute_then(access, then, &pending)
                    .err()
                    .map(|error| error.0),
                None => Some("E_EFFECT_THEN_UNKNOWN".to_owned()),
            };
            access.settle(
                &pending.id,
                OutboxSettlement::Sent {
                    result: pending.result,
                    last_error,
                },
            )?;
        }
        Ok(unknown)
    }

    pub fn drain<A: OutboxAccess>(
        &mut self,
        access: &mut A,
        declarations: &BTreeMap<String, EffectDecl>,
    ) -> Result<Drained, OutboxError> {
        self.drain_with_clock(access, declarations, DEFAULT_DRAIN_LIMIT, unix_millis)
    }

    /// Clock-injected form used by the owner and seam tests. The clock is
    /// sampled for each claim and again after every host failure, so retry
    /// backoff starts at the failure instant rather than the drain's start.
    /// No writer borrow is held while `host.run` executes.
    pub fn drain_with_clock<A: OutboxAccess, F: FnMut() -> i64>(
        &mut self,
        access: &mut A,
        declarations: &BTreeMap<String, EffectDecl>,
        limit: usize,
        mut now: F,
    ) -> Result<Drained, OutboxError> {
        let mut drained = Drained::default();
        if self.host.describe() == "none" {
            // An engine-less owner leaves queued rows entirely untouched.
            drained
                .unavailable
                .push("no engine in this build".to_owned());
            return Ok(drained);
        }
        for _ in 0..limit {
            let Some(job) = access.claim_next(now())? else {
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
                Outcome::Sent { result, leftover } => {
                    if leftover {
                        drained.logs.push(EffectLog {
                            outbox_id: job.id.clone(),
                            level: "warn".to_owned(),
                            message:
                                "effect resolved with leftover asynchronous work; runtime discarded"
                                    .to_owned(),
                        });
                    }
                    if let Some(then) = &decl.then {
                        access.settle(
                            &job.id,
                            OutboxSettlement::ThenPending {
                                result: result.clone(),
                            },
                        )?;
                        let pending = PendingThen {
                            id: job.id,
                            effect: job.effect,
                            result,
                        };
                        let last_error = execute_then(access, then, &pending)
                            .err()
                            .map(|error| error.0);
                        if last_error.is_some() {
                            drained.then_failed += 1;
                        }
                        access.settle(
                            &pending.id,
                            OutboxSettlement::Sent {
                                result: pending.result,
                                last_error,
                            },
                        )?;
                    } else {
                        access.settle(
                            &job.id,
                            OutboxSettlement::Sent {
                                result,
                                last_error: None,
                            },
                        )?;
                    }
                    drained.sent += 1;
                }
                Outcome::Failed { error, retry } if retry && job.attempt < MAX_ATTEMPTS => {
                    let failed_at = now();
                    access.settle(
                        &job.id,
                        OutboxSettlement::Retry {
                            error,
                            next_at: failed_at.saturating_add(retry_delay_ms(job.attempt)),
                        },
                    )?;
                    drained.requeued += 1;
                }
                Outcome::Failed { error, .. } => {
                    access.settle(&job.id, OutboxSettlement::Failed { error })?;
                    drained.failed += 1;
                }
                Outcome::Unavailable(message) => {
                    let failed_at = now();
                    access.settle(
                        &job.id,
                        OutboxSettlement::Retry {
                            error: message.to_owned(),
                            next_at: failed_at.saturating_add(retry_delay_ms(job.attempt)),
                        },
                    )?;
                    drained.requeued += 1;
                    drained.unavailable.push(message.to_owned());
                    break;
                }
            }
        }
        Ok(drained)
    }
}

fn execute_then<A: OutboxAccess>(
    access: &mut A,
    then: &str,
    pending: &PendingThen,
) -> Result<(), OutboxError> {
    access.execute_system(
        then,
        json!({
            "outboxId": pending.id,
            "effect": pending.effect,
            "result": pending.result,
        }),
    )
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
        system_errors: VecDeque<Option<String>>,
        fail_sent_once: bool,
        settlements: Vec<&'static str>,
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
            if matches!(settlement, OutboxSettlement::Sent { .. }) && self.fail_sent_once {
                self.fail_sent_once = false;
                return Err(OutboxError(
                    "simulated crash before sent settlement".to_owned(),
                ));
            }
            self.settlements.push(match &settlement {
                OutboxSettlement::ThenPending { .. } => "then_pending",
                OutboxSettlement::Sent { .. } => "sent",
                OutboxSettlement::Retry { .. } => "queued",
                OutboxSettlement::Failed { .. } => "failed",
            });
            let row = self.row_mut(id)?;
            match settlement {
                OutboxSettlement::ThenPending { result } => {
                    row.state = "then_pending";
                    row.result = Some(result);
                    row.last_error = None;
                }
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

        fn pending_then(&mut self) -> Result<Vec<PendingThen>, OutboxError> {
            Ok(self
                .rows
                .iter()
                .filter(|row| row.state == "then_pending")
                .map(|row| PendingThen {
                    id: row.job.id.clone(),
                    effect: row.job.effect.clone(),
                    result: row.result.clone().expect("then_pending result"),
                })
                .collect())
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
            self.system_calls.push((op.to_owned(), args));
            if let Some(Some(error)) = self.system_errors.pop_front() {
                return Err(OutboxError(error));
            }
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

    fn sent(result: Value) -> Outcome {
        Outcome::Sent {
            result,
            leftover: false,
        }
    }

    #[test]
    fn success_is_then_pending_until_then_finishes() {
        let host = StubHost::new([sent(json!({ "providerId": "p1" }))]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox::default();
        outbox.push("o1", "notifications.notify", "queued", 0);

        let drained = runner
            .drain_with_clock(
                &mut outbox,
                &declarations(declaration(Some("notifications.recordNotified"))),
                16,
                || 10,
            )
            .unwrap();

        assert_eq!(drained.sent, 1);
        assert_eq!(outbox.row("o1").state, "sent");
        assert_eq!(outbox.row("o1").job.attempt, 1);
        assert_eq!(outbox.settlements, vec!["then_pending", "sent"]);
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
            .drain_with_clock(&mut outbox, &declarations(declaration(None)), 16, || 1_000)
            .unwrap();

        assert_eq!(drained.requeued, 1);
        assert_eq!(drained.failed, 1);
        assert_eq!(outbox.row("retry").state, "queued");
        assert_eq!(outbox.row("retry").next_at, 3_000);
        assert_eq!(outbox.row("last").state, "failed");
        assert_eq!(outbox.row("last").job.attempt, 5);
    }

    #[test]
    fn retry_backoff_starts_at_the_failure_instant() {
        let host = StubHost::new([Outcome::Failed {
            error: "temporary".to_owned(),
            retry: true,
        }]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox::default();
        outbox.push("retry", "notifications.notify", "queued", 0);
        let mut times = VecDeque::from([1_000, 1_750]);

        let drained = runner
            .drain_with_clock(&mut outbox, &declarations(declaration(None)), 1, || {
                times.pop_front().expect("scripted clock instant")
            })
            .unwrap();

        assert_eq!(drained.requeued, 1);
        assert_eq!(outbox.row("retry").next_at, 3_750);
    }

    #[test]
    fn unavailable_requeues_with_message_and_backoff() {
        let host = StubHost::new([Outcome::Unavailable("provider unavailable")]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox::default();
        outbox.push("offline", "notifications.notify", "queued", 0);
        let mut times = VecDeque::from([2_000, 2_500]);

        let drained = runner
            .drain_with_clock(&mut outbox, &declarations(declaration(None)), 1, || {
                times.pop_front().expect("scripted clock instant")
            })
            .unwrap();

        assert_eq!(drained.unavailable, vec!["provider unavailable"]);
        assert_eq!(drained.requeued, 1);
        assert_eq!(outbox.row("offline").state, "queued");
        assert_eq!(outbox.row("offline").next_at, 4_500);
        assert_eq!(
            outbox.row("offline").last_error.as_deref(),
            Some("provider unavailable")
        );
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
            .drain_with_clock(&mut outbox, &declarations(declaration(None)), 16, || 0)
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
        let host = StubHost::new([sent(json!(true))]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox {
            system_errors: VecDeque::from([Some("E_INPUT: then rejected".to_owned())]),
            ..MemoryOutbox::default()
        };
        outbox.push("o1", "notifications.notify", "queued", 0);

        let drained = runner
            .drain_with_clock(
                &mut outbox,
                &declarations(declaration(Some("notifications.recordNotified"))),
                16,
                || 0,
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
    fn restart_replays_then_pending_after_crash_before_sent_settlement() {
        let declarations = declarations(declaration(Some("notifications.recordNotified")));
        let host = StubHost::new([sent(json!({ "providerId": "p1" }))]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox {
            fail_sent_once: true,
            ..MemoryOutbox::default()
        };
        outbox.push("o1", "notifications.notify", "queued", 0);

        let error = runner
            .drain_with_clock(&mut outbox, &declarations, 16, || 0)
            .expect_err("the test double kills the runner before sent");
        assert!(error.0.contains("simulated crash"));
        assert_eq!(outbox.row("o1").state, "then_pending");
        assert_eq!(outbox.system_calls.len(), 1);
        assert_eq!(outbox.settlements, vec!["then_pending"]);

        outbox.system_errors.push_back(Some(
            "E_CONSTRAINT: duplicate outboxId on unique index".to_owned(),
        ));
        let mut restarted = Runner::new(StubHost::new(Vec::<Outcome>::new()));
        assert_eq!(restarted.initialize(&mut outbox, &declarations).unwrap(), 0);

        assert_eq!(outbox.system_calls.len(), 2, "then runs exactly once more");
        assert_eq!(outbox.row("o1").state, "sent");
        assert_eq!(
            outbox.row("o1").last_error.as_deref(),
            Some("E_CONSTRAINT: duplicate outboxId on unique index")
        );
        assert_eq!(outbox.settlements, vec!["then_pending", "sent"]);
    }

    #[test]
    fn effects_without_then_settle_running_directly_to_sent() {
        let host = StubHost::new([sent(json!(true))]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox::default();
        outbox.push("o1", "notifications.notify", "queued", 0);

        runner
            .drain_with_clock(&mut outbox, &declarations(declaration(None)), 16, || 0)
            .unwrap();

        assert_eq!(outbox.row("o1").state, "sent");
        assert!(outbox.system_calls.is_empty());
        assert_eq!(outbox.settlements, vec!["sent"]);
    }

    #[test]
    fn leftover_sent_outcome_is_logged_with_the_outbox_id() {
        let host = StubHost::new([Outcome::Sent {
            result: json!(true),
            leftover: true,
        }]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox::default();
        outbox.push("o1", "notifications.notify", "queued", 0);

        let drained = runner
            .drain_with_clock(&mut outbox, &declarations(declaration(None)), 16, || 0)
            .unwrap();

        assert_eq!(outbox.row("o1").state, "sent");
        assert_eq!(drained.sent, 1);
        assert_eq!(
            drained.logs,
            vec![EffectLog {
                outbox_id: "o1".to_owned(),
                level: "warn".to_owned(),
                message: "effect resolved with leftover asynchronous work; runtime discarded"
                    .to_owned(),
            }]
        );
    }

    #[test]
    fn startup_marks_running_unknown_and_no_engine_keeps_work_queued() {
        let mut outbox = MemoryOutbox::default();
        outbox.push("maybe-sent", "notifications.notify", "running", 1);
        outbox.push("waiting", "notifications.notify", "queued", 0);
        let mut runner = Runner::new(crate::NoEngine);

        assert_eq!(
            runner
                .initialize(&mut outbox, &declarations(declaration(None)))
                .unwrap(),
            1
        );
        let drained = runner
            .drain_with_clock(&mut outbox, &declarations(declaration(None)), 16, || 0)
            .unwrap();

        assert_eq!(outbox.row("maybe-sent").state, "sent_unknown");
        assert_eq!(outbox.row("waiting").state, "queued");
        assert_eq!(outbox.row("waiting").job.attempt, 0);
        assert_eq!(drained.unavailable, vec!["no engine in this build"]);
    }
}
