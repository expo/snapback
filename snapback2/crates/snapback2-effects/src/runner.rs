use crate::{EffectHost, EffectJob, EffectLog, Outcome};
use serde_json::Value;
use snapback2_core::EffectDecl;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;
use thiserror::Error;

#[path = "runner_settlement.rs"]
mod runner_settlement;

use runner_settlement::{
    drain_pending, merge_drained, panic_message, record_then, retry_delay_ms, run_pending_then,
};

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
        then_op: String,
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
    /// The host could not run the claimed job. Settlement atomically restores
    /// `queued` and the pre-claim attempt count, recording only `last_error`.
    Unavailable {
        error: String,
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
    pub result: Option<Value>,
    pub then_op: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EffectDeclarations {
    pub current_generation: String,
    pub bound: Option<EffectDecl>,
    pub current: Option<EffectDecl>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ThenOutcome {
    Sent,
    Rejected(String),
    Failed(String),
}

/// The short request/reply seam between the effects runner and the sole store
/// writer. A binary implementation can send one request to the writer thread
/// in each method and wait for its reply; no method spans the host call.
// @ref LLP 1002#5-the-owner — only the writer thread owns Runtime and SQLite.
// @ref LLP 1003#2-the-outbox-lifecycle — claiming, settling, restart honesty, and `then` all cross this seam.
pub trait OutboxAccess {
    /// The owner's effective clock, including any development offset.
    fn now(&mut self) -> Result<i64, OutboxError>;

    /// Atomically fail effects absent from the writer's current declarations,
    /// then select the oldest eligible declared row using `state = 'queued'
    /// AND next_at <= ?`, transition it to `running`, and increment `attempts`.
    /// No other state, especially `sent_unknown`, is eligible.
    fn claim_next(&mut self, now: i64) -> Result<Option<EffectJob>, OutboxError>;

    /// Resolve the declaration retained for the generation this row bound,
    /// together with the writer's current declaration at lookup time.
    fn effect_declarations(&mut self, job: &EffectJob) -> Result<EffectDeclarations, OutboxError>;

    /// Atomically apply the complete settlement. `Unavailable` must restore
    /// the pre-claim attempt count while returning the row to `queued` and
    /// recording its error.
    fn settle(&mut self, id: &str, settlement: OutboxSettlement) -> Result<(), OutboxError>;

    /// Attach framework-owned provider evidence to this attempt's settlement.
    fn observe_provider(&mut self, _id: &str, _provider: Value) -> Result<(), OutboxError> {
        Ok(())
    }

    /// Return at most `limit` durable `then_pending` rows in stable outbox order.
    fn pending_then(&mut self, limit: usize) -> Result<Vec<PendingThen>, OutboxError>;

    /// Explicitly return a `sent_unknown` or `failed` row to `queued` and
    /// reset attempts for the new operator-authorized run.
    fn requeue(&mut self, id: &str, now: i64) -> Result<(), OutboxError>;

    /// On owner startup, atomically mark every lingering `running` row as
    /// `sent_unknown`. Such rows are never claimed automatically.
    fn mark_unknown_running_at_start(&mut self, now: i64) -> Result<u64, OutboxError>;

    /// Record why queued work cannot run without claiming it or spending an
    /// attempt. Returns the number of queued rows updated.
    fn mark_queued_unavailable(&mut self, error: &str) -> Result<u64, OutboxError>;

    /// Execute the mutation bound to a durable `then_pending` row through the
    /// core's engine-private system capability, and atomically report whether
    /// the row settled `sent` or `failed`.
    fn execute_then(
        &mut self,
        op: &str,
        args: Value,
        outbox_id: &str,
    ) -> Result<ThenOutcome, OutboxError>;
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Drained {
    pub unknown_at_start: u64,
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
    generation: Option<String>,
    stop: Option<Arc<AtomicBool>>,
}

impl<H: EffectHost> Runner<H> {
    pub fn new(host: H) -> Self {
        Self {
            host,
            budget: DEFAULT_BUDGET,
            generation: None,
            stop: None,
        }
    }

    pub fn with_budget(host: H, budget: Duration) -> Self {
        Self {
            host,
            budget,
            generation: None,
            stop: None,
        }
    }

    pub fn set_stop_flag(&mut self, stop: Arc<AtomicBool>) {
        self.stop = Some(stop);
    }

    fn stopping(&self) -> bool {
        self.stop
            .as_ref()
            .is_some_and(|stop| stop.load(Ordering::SeqCst))
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

    pub fn generation_changed(&mut self) {
        self.generation = None;
        self.host.generation_changed();
    }

    pub fn initialize<A: OutboxAccess>(&mut self, access: &mut A) -> Result<Drained, OutboxError> {
        let now = access.now()?;
        let mut drained = Drained {
            unknown_at_start: access.mark_unknown_running_at_start(now)?,
            ..Drained::default()
        };
        drain_pending(access, DEFAULT_DRAIN_LIMIT, &mut drained, || {
            self.stopping()
        })?;
        Ok(drained)
    }

    pub fn drain<A: OutboxAccess>(&mut self, access: &mut A) -> Result<Drained, OutboxError> {
        self.drain_inner(access, DEFAULT_DRAIN_LIMIT, |access| access.now())
    }

    /// Clock-injected form used by the owner and seam tests. The clock is
    /// sampled for each claim and again after every host failure, so retry
    /// backoff starts at the failure instant rather than the drain's start.
    /// No writer borrow is held while `host.run` executes.
    pub fn drain_with_clock<A: OutboxAccess, F: FnMut() -> i64>(
        &mut self,
        access: &mut A,
        limit: usize,
        mut now: F,
    ) -> Result<Drained, OutboxError> {
        self.drain_inner(access, limit, |_| Ok(now()))
    }

    fn drain_inner<A: OutboxAccess, F: FnMut(&mut A) -> Result<i64, OutboxError>>(
        &mut self,
        access: &mut A,
        limit: usize,
        mut now: F,
    ) -> Result<Drained, OutboxError> {
        let mut drained = Drained::default();
        if self.stopping() {
            return Ok(drained);
        }
        let pending = drain_pending(access, limit, &mut drained, || self.stopping())?;
        let remaining = limit.saturating_sub(pending);
        if self.host.describe() == "none" {
            access.mark_queued_unavailable("no engine in this build")?;
            drained
                .unavailable
                .push("no engine in this build".to_owned());
            return Ok(drained);
        }
        for _ in 0..remaining {
            let claim_at = now(access)?;
            // @ref LLP 1021#5-a-running-effect-can-be-stopped — shutdown cannot start another job in this drain.
            if self.stopping() {
                break;
            }
            let Some(job) = access.claim_next(claim_at)? else {
                break;
            };
            drained.claimed += 1;
            let result = catch_unwind(AssertUnwindSafe(|| {
                self.run_claimed(access, &job, claim_at, &mut now)
            }));
            match result {
                Ok(Ok(job_drained)) => {
                    let unavailable = !job_drained.unavailable.is_empty();
                    merge_drained(&mut drained, job_drained);
                    if unavailable {
                        break;
                    }
                }
                Ok(Err(error)) => {
                    self.recover_claimed_job(access, &job, error.0, &mut drained);
                }
                Err(payload) => {
                    self.generation_changed();
                    self.recover_claimed_job(
                        access,
                        &job,
                        format!("E_EFFECT_RUNNER_PANIC: {}", panic_message(payload)),
                        &mut drained,
                    );
                }
            }
        }
        Ok(drained)
    }

    fn run_claimed<A: OutboxAccess, F: FnMut(&mut A) -> Result<i64, OutboxError>>(
        &mut self,
        access: &mut A,
        job: &EffectJob,
        claim_at: i64,
        now: &mut F,
    ) -> Result<Drained, OutboxError> {
        let mut drained = Drained::default();
        let resolved = access.effect_declarations(job)?;
        let Some(decl) = resolved.bound else {
            access.settle(
                &job.id,
                OutboxSettlement::Failed {
                    error: "E_EFFECT_UNKNOWN".to_owned(),
                },
            )?;
            drained.failed += 1;
            return Ok(drained);
        };
        if job.generation.as_deref() != Some(resolved.current_generation.as_str()) {
            let error = match resolved.current {
                None => "E_EFFECT_UNKNOWN",
                Some(current)
                    if current.then == decl.then
                        && snapback2_core::digest(&current.source)
                            == snapback2_core::digest(&decl.source) =>
                {
                    ""
                }
                Some(_) => "E_EFFECT_THEN_CHANGED",
            };
            if !error.is_empty() {
                access.settle(
                    &job.id,
                    OutboxSettlement::Failed {
                        error: error.to_owned(),
                    },
                )?;
                drained.failed += 1;
                return Ok(drained);
            }
        }
        if self.generation.as_deref() != job.generation.as_deref() {
            self.host.generation_changed();
            self.generation = job.generation.clone();
        }
        let outcome = self.host.run(&decl, job, self.budget);
        drained.logs.extend(self.host.take_logs());
        if let Some(provider) = self.host.take_provider() {
            access.observe_provider(&job.id, provider)?;
        }
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
                            then_op: then.clone(),
                        },
                    )?;
                    let pending = PendingThen {
                        id: job.id.clone(),
                        effect: job.effect.clone(),
                        result: Some(result),
                        then_op: Some(then.clone()),
                    };
                    match catch_unwind(AssertUnwindSafe(|| run_pending_then(access, &pending))) {
                        Ok(Ok(outcome)) => record_then(outcome, &job.id, &mut drained),
                        Ok(Err(error)) => drained.logs.push(EffectLog {
                            outbox_id: job.id.clone(),
                            level: "error".to_owned(),
                            message: error.0,
                        }),
                        Err(payload) => {
                            let message = format!(
                                "E_EFFECT_RUNNER_PANIC: pending then panicked: {}",
                                panic_message(payload)
                            );
                            access.settle(
                                &job.id,
                                OutboxSettlement::Failed {
                                    error: "E_EFFECT_RUNNER_PANIC".to_owned(),
                                },
                            )?;
                            drained.failed += 1;
                            drained.then_failed += 1;
                            drained.logs.push(EffectLog {
                                outbox_id: job.id.clone(),
                                level: "error".to_owned(),
                                message,
                            });
                        }
                    }
                } else {
                    access.settle(
                        &job.id,
                        OutboxSettlement::Sent {
                            result,
                            last_error: None,
                        },
                    )?;
                    drained.sent += 1;
                }
            }
            Outcome::Failed { error, retry } if retry && job.attempt < MAX_ATTEMPTS => {
                // A broken clock must not erase the provider's retryable error.
                // The claim instant is a conservative fallback from the same clock.
                let failed_at = now(access).unwrap_or_else(|clock_error| {
                    drained.logs.push(EffectLog {
                        outbox_id: job.id.clone(),
                        level: "error".to_owned(),
                        message: format!(
                            "retry clock unavailable: {}; using claim instant",
                            clock_error.0
                        ),
                    });
                    claim_at
                });
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
                access.settle(
                    &job.id,
                    OutboxSettlement::Unavailable {
                        error: message.to_owned(),
                    },
                )?;
                drained.requeued += 1;
                drained.unavailable.push(message.to_owned());
            }
        }
        Ok(drained)
    }

    fn recover_claimed_job<A: OutboxAccess>(
        &mut self,
        access: &mut A,
        job: &EffectJob,
        message: String,
        drained: &mut Drained,
    ) {
        let settlement = access.settle(
            &job.id,
            OutboxSettlement::Failed {
                error: message.clone(),
            },
        );
        if settlement.is_ok() {
            drained.failed += 1;
        }
        drained.logs.push(EffectLog {
            outbox_id: job.id.clone(),
            level: "error".to_owned(),
            message: match settlement {
                Ok(()) => message,
                Err(error) => format!("{message}; recovery settlement failed: {}", error.0),
            },
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::{BTreeMap, VecDeque};

    #[derive(Clone, Debug)]
    struct Row {
        job: EffectJob,
        state: &'static str,
        next_at: i64,
        created_at: i64,
        last_error: Option<String>,
        result: Option<Value>,
        then_op: Option<String>,
    }

    #[derive(Default)]
    struct MemoryOutbox {
        rows: Vec<Row>,
        system_calls: Vec<(String, Value)>,
        system_errors: VecDeque<Option<String>>,
        system_outcomes: VecDeque<ThenOutcome>,
        fail_sent_once: bool,
        panic_then_once: bool,
        settlements: Vec<&'static str>,
        generations: BTreeMap<String, BTreeMap<String, EffectDecl>>,
        current_generation: String,
        claims: usize,
        switch_before_claim: Option<(usize, String)>,
        switch_after_claim: Option<(usize, String)>,
        now: i64,
    }

    impl MemoryOutbox {
        fn push(&mut self, id: &str, effect: &str, state: &'static str, attempts: u32) {
            self.rows.push(Row {
                job: EffectJob {
                    id: id.to_owned(),
                    effect: effect.to_owned(),
                    payload: json!({ "id": id }),
                    attempt: attempts,
                    generation: None,
                    bindings: None,
                },
                state,
                next_at: 0,
                created_at: self.rows.len() as i64,
                last_error: None,
                result: None,
                then_op: None,
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

        fn install(&mut self, generation: &str, declarations: BTreeMap<String, EffectDecl>) {
            self.generations.insert(generation.to_owned(), declarations);
            self.current_generation = generation.to_owned();
        }
    }

    impl OutboxAccess for MemoryOutbox {
        fn now(&mut self) -> Result<i64, OutboxError> {
            Ok(self.now)
        }

        fn claim_next(&mut self, now: i64) -> Result<Option<EffectJob>, OutboxError> {
            let claim = self.claims + 1;
            if self
                .switch_before_claim
                .as_ref()
                .is_some_and(|(at, _)| *at == claim)
            {
                self.current_generation =
                    self.switch_before_claim.take().expect("matched switch").1;
            }
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
            let effect = self.rows[index].job.effect.clone();
            let generation = self
                .generations
                .get(&self.current_generation)
                .is_some_and(|declarations| declarations.contains_key(&effect))
                .then(|| self.current_generation.clone());
            let row = &mut self.rows[index];
            row.state = "running";
            row.job.attempt += 1;
            row.job.generation = generation;
            let job = row.job.clone();
            self.claims = claim;
            if self
                .switch_after_claim
                .as_ref()
                .is_some_and(|(at, _)| *at == claim)
            {
                self.current_generation = self.switch_after_claim.take().expect("matched switch").1;
            }
            Ok(Some(job))
        }

        fn effect_declarations(
            &mut self,
            job: &EffectJob,
        ) -> Result<EffectDeclarations, OutboxError> {
            let bound = job
                .generation
                .as_ref()
                .and_then(|generation| self.generations.get(generation))
                .and_then(|declarations| declarations.get(&job.effect))
                .cloned();
            let current = self
                .generations
                .get(&self.current_generation)
                .and_then(|declarations| declarations.get(&job.effect))
                .cloned();
            Ok(EffectDeclarations {
                current_generation: self.current_generation.clone(),
                bound,
                current,
            })
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
                OutboxSettlement::Unavailable { .. } => "queued",
                OutboxSettlement::Failed { .. } => "failed",
            });
            let row = self.row_mut(id)?;
            match settlement {
                OutboxSettlement::ThenPending { result, then_op } => {
                    row.state = "then_pending";
                    row.result = Some(result);
                    row.last_error = None;
                    row.then_op = Some(then_op);
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
                OutboxSettlement::Unavailable { error } => {
                    row.state = "queued";
                    row.job.attempt = row.job.attempt.saturating_sub(1);
                    row.last_error = Some(error);
                }
                OutboxSettlement::Failed { error } => {
                    row.state = "failed";
                    row.last_error = Some(error);
                }
            }
            Ok(())
        }

        fn pending_then(&mut self, limit: usize) -> Result<Vec<PendingThen>, OutboxError> {
            Ok(self
                .rows
                .iter()
                .filter(|row| row.state == "then_pending")
                .take(limit)
                .map(|row| PendingThen {
                    id: row.job.id.clone(),
                    effect: row.job.effect.clone(),
                    result: row.result.clone(),
                    then_op: row.then_op.clone(),
                })
                .collect())
        }

        fn requeue(&mut self, id: &str, now: i64) -> Result<(), OutboxError> {
            let row = self.row_mut(id)?;
            row.state = "queued";
            row.job.attempt = 0;
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

        fn mark_queued_unavailable(&mut self, error: &str) -> Result<u64, OutboxError> {
            let mut changed = 0;
            for row in &mut self.rows {
                if row.state == "queued" {
                    row.last_error = Some(error.to_owned());
                    changed += 1;
                }
            }
            Ok(changed)
        }

        fn execute_then(
            &mut self,
            op: &str,
            args: Value,
            outbox_id: &str,
        ) -> Result<ThenOutcome, OutboxError> {
            if std::mem::take(&mut self.panic_then_once) {
                panic!("malformed then row panicked the test access");
            }
            if self.fail_sent_once {
                self.fail_sent_once = false;
                return Err(OutboxError(
                    "simulated crash before atomic then commit".to_owned(),
                ));
            }
            let outcome = self.system_outcomes.pop_front().or_else(|| {
                self.system_errors
                    .pop_front()
                    .flatten()
                    .map(ThenOutcome::Rejected)
            });
            if !matches!(outcome, Some(ThenOutcome::Failed(_))) {
                self.system_calls.push((op.to_owned(), args));
            }
            let row = self.row_mut(outbox_id)?;
            match outcome.unwrap_or(ThenOutcome::Sent) {
                ThenOutcome::Sent => {
                    row.state = "sent";
                    row.last_error = None;
                    Ok(ThenOutcome::Sent)
                }
                ThenOutcome::Rejected(error) => {
                    row.state = "sent";
                    row.last_error = Some(error.clone());
                    Ok(ThenOutcome::Rejected(error))
                }
                ThenOutcome::Failed(error) => {
                    row.state = "failed";
                    row.last_error = Some(error.clone());
                    Ok(ThenOutcome::Failed(error))
                }
            }
        }
    }

    struct StubHost {
        outcomes: VecDeque<Outcome>,
        logs: Vec<EffectLog>,
        calls: Vec<(EffectDecl, EffectJob)>,
        panic_once: bool,
        discards: usize,
    }

    impl StubHost {
        fn new(outcomes: impl IntoIterator<Item = Outcome>) -> Self {
            Self {
                outcomes: outcomes.into_iter().collect(),
                logs: Vec::new(),
                calls: Vec::new(),
                panic_once: false,
                discards: 0,
            }
        }
    }

    impl EffectHost for StubHost {
        fn generation_changed(&mut self) {
            self.discards += 1;
        }
        fn run(&mut self, decl: &EffectDecl, job: &EffectJob, _budget: Duration) -> Outcome {
            if std::mem::take(&mut self.panic_once) {
                panic!("malformed claimed row panicked the host");
            }
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

    fn install(outbox: &mut MemoryOutbox, decl: EffectDecl) {
        outbox.install("generation-1", declarations(decl));
    }

    fn sent(result: Value) -> Outcome {
        Outcome::Sent {
            result,
            leftover: false,
        }
    }

    #[test]
    fn stopping_during_a_host_call_prevents_the_next_claim() {
        struct StopHost {
            stop: Arc<AtomicBool>,
            calls: usize,
        }
        impl EffectHost for StopHost {
            fn run(&mut self, _: &EffectDecl, _: &EffectJob, _: Duration) -> Outcome {
                self.calls += 1;
                self.stop.store(true, Ordering::SeqCst);
                sent(json!(true))
            }
            fn describe(&self) -> &'static str {
                "stop-test"
            }
        }
        let stop = Arc::new(AtomicBool::new(false));
        let mut runner = Runner::new(StopHost {
            stop: stop.clone(),
            calls: 0,
        });
        runner.set_stop_flag(stop.clone());
        let mut outbox = MemoryOutbox::default();
        install(&mut outbox, declaration(None));
        for id in ["o1", "o2", "o3"] {
            outbox.push(id, "notifications.notify", "queued", 0);
        }
        let drained = runner.drain(&mut outbox).unwrap();
        assert_eq!(drained.claimed, 1);
        assert_eq!(outbox.row("o1").state, "sent");
        assert_eq!(outbox.row("o2").state, "queued");
        assert_eq!(outbox.row("o3").job.attempt, 0);
        assert_eq!(runner.drain(&mut outbox).unwrap().claimed, 0);
        assert_eq!(runner.host().calls, 1);
    }

    #[test]
    fn success_is_then_pending_until_then_finishes() {
        let host = StubHost::new([sent(json!({ "providerId": "p1" }))]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox::default();
        outbox.push("o1", "notifications.notify", "queued", 0);
        install(
            &mut outbox,
            declaration(Some("notifications.recordNotified")),
        );

        let drained = runner.drain_with_clock(&mut outbox, 16, || 10).unwrap();

        assert_eq!(drained.sent, 1);
        assert_eq!(outbox.row("o1").state, "sent");
        assert_eq!(outbox.row("o1").job.attempt, 1);
        assert_eq!(outbox.settlements, vec!["then_pending"]);
        assert_eq!(outbox.system_calls[0].0, "notifications.recordNotified");
        assert_eq!(outbox.system_calls[0].1["outboxId"], "o1");
        assert_eq!(outbox.system_calls[0].1["effect"], "notifications.notify");
        assert_eq!(outbox.system_calls[0].1["result"]["providerId"], "p1");
    }

    #[test]
    fn retry_uses_post_claim_attempt_and_stops_at_five() {
        assert_eq!(
            (1..=5).map(retry_delay_ms).collect::<Vec<_>>(),
            vec![1_000, 2_000, 4_000, 8_000, 16_000]
        );
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
        install(&mut outbox, declaration(None));

        let drained = runner.drain_with_clock(&mut outbox, 16, || 1_000).unwrap();

        assert_eq!(drained.requeued, 1);
        assert_eq!(drained.failed, 1);
        assert_eq!(outbox.row("retry").state, "queued");
        assert_eq!(outbox.row("retry").next_at, 2_000);
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
        install(&mut outbox, declaration(None));
        let mut times = VecDeque::from([1_000, 1_750]);

        let drained = runner
            .drain_with_clock(&mut outbox, 1, || {
                times.pop_front().expect("scripted clock instant")
            })
            .unwrap();

        assert_eq!(drained.requeued, 1);
        assert_eq!(outbox.row("retry").next_at, 2_750);
    }

    #[test]
    fn production_drain_uses_the_owner_clock_for_retry_next_at() {
        let host = StubHost::new([Outcome::Failed {
            error: "temporary".to_owned(),
            retry: true,
        }]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox {
            now: 120_000,
            ..MemoryOutbox::default()
        };
        outbox.push("retry", "notifications.notify", "queued", 0);
        install(&mut outbox, declaration(None));

        let drained = runner.drain(&mut outbox).unwrap();

        assert_eq!(drained.requeued, 1);
        assert_eq!(outbox.row("retry").next_at, 121_000);
    }

    #[test]
    fn unavailable_requeues_with_message_without_spending_an_attempt() {
        let host = StubHost::new([Outcome::Unavailable("provider unavailable")]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox::default();
        outbox.push("offline", "notifications.notify", "queued", 3);
        outbox.row_mut("offline").unwrap().next_at = 1_500;
        install(&mut outbox, declaration(None));
        let mut times = VecDeque::from([2_000]);

        let drained = runner
            .drain_with_clock(&mut outbox, 1, || {
                times.pop_front().expect("scripted clock instant")
            })
            .unwrap();

        assert_eq!(drained.unavailable, vec!["provider unavailable"]);
        assert_eq!(drained.requeued, 1);
        assert_eq!(outbox.row("offline").state, "queued");
        assert_eq!(outbox.row("offline").job.attempt, 3);
        assert_eq!(outbox.row("offline").next_at, 1_500);
        assert_eq!(
            outbox.row("offline").last_error.as_deref(),
            Some("provider unavailable")
        );
    }

    #[cfg(feature = "hermes")]
    #[test]
    fn engine_claims_queued_but_never_sent_unknown() {
        let mut outbox = MemoryOutbox::default();
        outbox.push("maybe-sent", "notifications.notify", "sent_unknown", 1);
        outbox.push("waiting", "notifications.notify", "queued", 0);
        install(&mut outbox, declaration(None));
        let mut runner = Runner::new(crate::ibex::Ibex2Host::new().unwrap());

        let drained = runner.drain_with_clock(&mut outbox, 16, || 0).unwrap();

        assert_eq!(drained.claimed, 1);
        assert_eq!(drained.sent, 1);
        assert_eq!(outbox.row("maybe-sent").state, "sent_unknown");
        assert_eq!(outbox.row("maybe-sent").job.attempt, 1);
        assert_eq!(outbox.row("waiting").state, "sent");
        assert_eq!(outbox.row("waiting").job.attempt, 1);
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
        install(&mut outbox, declaration(None));

        let drained = runner.drain_with_clock(&mut outbox, 16, || 0).unwrap();

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
        install(
            &mut outbox,
            declaration(Some("notifications.recordNotified")),
        );

        let drained = runner.drain_with_clock(&mut outbox, 16, || 0).unwrap();

        assert_eq!(drained.sent, 1);
        assert_eq!(drained.then_failed, 1);
        assert_eq!(outbox.row("o1").state, "sent");
        assert_eq!(
            outbox.row("o1").last_error.as_deref(),
            Some("E_INPUT: then rejected")
        );
    }

    #[test]
    fn crash_between_then_pending_and_execute_then_restarts_to_exactly_one_commit() {
        let declarations = declarations(declaration(Some("notifications.recordNotified")));
        let host = StubHost::new([sent(json!({ "providerId": "p1" }))]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox {
            fail_sent_once: true,
            ..MemoryOutbox::default()
        };
        outbox.push("o1", "notifications.notify", "queued", 0);
        outbox.install("generation-1", declarations.clone());

        let drained = runner.drain_with_clock(&mut outbox, 16, || 0).unwrap();
        assert!(
            drained
                .logs
                .iter()
                .any(|line| line.outbox_id == "o1" && line.message.contains("atomic then commit"))
        );
        assert_eq!(outbox.row("o1").state, "then_pending");
        assert_eq!(outbox.system_calls.len(), 0);
        assert_eq!(outbox.settlements, vec!["then_pending"]);

        let mut restarted = Runner::new(StubHost::new(Vec::<Outcome>::new()));
        assert_eq!(
            restarted.initialize(&mut outbox).unwrap().unknown_at_start,
            0
        );

        assert_eq!(outbox.system_calls.len(), 1, "then commits exactly once");
        assert_eq!(outbox.row("o1").state, "sent");
        assert_eq!(outbox.row("o1").last_error, None);
        assert_eq!(outbox.settlements, vec!["then_pending"]);
    }

    #[test]
    fn execute_then_error_is_retried_by_the_next_live_drain() {
        let mut runner = Runner::new(StubHost::new([sent(json!(true))]));
        let mut outbox = MemoryOutbox {
            fail_sent_once: true,
            ..MemoryOutbox::default()
        };
        outbox.push("pending", "notifications.notify", "queued", 0);
        install(
            &mut outbox,
            declaration(Some("notifications.recordNotified")),
        );

        let first = runner.drain_with_clock(&mut outbox, 16, || 0).unwrap();
        assert_eq!(outbox.row("pending").state, "then_pending");
        assert!(first.logs.iter().any(|line| line.outbox_id == "pending"));

        let second = runner.drain_with_clock(&mut outbox, 16, || 0).unwrap();
        assert_eq!(second.sent, 1);
        assert_eq!(outbox.row("pending").state, "sent");
        assert_eq!(outbox.system_calls.len(), 1);
    }

    #[test]
    fn every_drain_replays_pending_then_before_claiming_new_work() {
        let mut outbox = MemoryOutbox::default();
        outbox.push("pending", "notifications.notify", "then_pending", 1);
        outbox.row_mut("pending").unwrap().result = Some(json!({ "providerId": "p1" }));
        outbox.row_mut("pending").unwrap().then_op =
            Some("notifications.recordNotified".to_owned());
        outbox.push("queued", "notifications.notify", "queued", 0);
        install(
            &mut outbox,
            declaration(Some("notifications.recordNotified")),
        );
        let host = StubHost::new([sent(json!({ "providerId": "p2" }))]);
        let mut runner = Runner::new(host);

        let first = runner.drain_with_clock(&mut outbox, 1, || 0).unwrap();
        assert_eq!(first.sent, 1);
        assert_eq!(outbox.row("pending").state, "sent");
        assert_eq!(outbox.row("queued").state, "queued");
        assert!(runner.host().calls.is_empty());

        let second = runner.drain_with_clock(&mut outbox, 1, || 0).unwrap();
        assert_eq!(second.sent, 1);
        assert_eq!(outbox.row("queued").state, "sent");
        assert_eq!(runner.host().calls.len(), 1);
    }

    #[test]
    fn malformed_pending_then_is_failed_and_cannot_stop_the_next_row() {
        let mut outbox = MemoryOutbox::default();
        outbox.push("missing-target", "notifications.notify", "then_pending", 1);
        outbox.row_mut("missing-target").unwrap().result = Some(json!(true));
        outbox.push("valid", "notifications.notify", "then_pending", 1);
        outbox.row_mut("valid").unwrap().result = Some(json!(true));
        outbox.row_mut("valid").unwrap().then_op = Some("notifications.recordNotified".to_owned());
        install(
            &mut outbox,
            declaration(Some("notifications.recordNotified")),
        );
        let mut runner = Runner::new(StubHost::new(Vec::<Outcome>::new()));

        let drained = runner.drain_with_clock(&mut outbox, 2, || 0).unwrap();

        assert_eq!(drained.failed, 1);
        assert_eq!(drained.sent, 1);
        assert_eq!(outbox.row("missing-target").state, "failed");
        assert_eq!(
            outbox.row("missing-target").last_error.as_deref(),
            Some("E_EFFECT_THEN_CHANGED")
        );
        assert_eq!(outbox.row("valid").state, "sent");
    }

    #[test]
    fn panic_in_one_pending_job_is_caught_logged_and_does_not_stop_the_runner() {
        let mut outbox = MemoryOutbox {
            panic_then_once: true,
            ..MemoryOutbox::default()
        };
        for id in ["bad", "good"] {
            outbox.push(id, "notifications.notify", "then_pending", 1);
            outbox.row_mut(id).unwrap().result = Some(json!(true));
            outbox.row_mut(id).unwrap().then_op = Some("notifications.recordNotified".to_owned());
        }
        install(
            &mut outbox,
            declaration(Some("notifications.recordNotified")),
        );
        let mut runner = Runner::new(StubHost::new(Vec::<Outcome>::new()));

        let drained = runner.drain_with_clock(&mut outbox, 2, || 0).unwrap();

        assert_eq!(outbox.row("bad").state, "failed");
        assert_eq!(outbox.row("good").state, "sent");
        assert!(
            drained
                .logs
                .iter()
                .any(|line| { line.outbox_id == "bad" && line.message.contains("panicked") })
        );
    }

    #[test]
    fn panic_in_one_claimed_job_is_failed_and_the_next_job_still_runs() {
        let mut host = StubHost::new([sent(json!(true))]);
        host.panic_once = true;
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox::default();
        outbox.push("bad", "notifications.notify", "queued", 0);
        outbox.push("good", "notifications.notify", "queued", 0);
        install(&mut outbox, declaration(None));

        let drained = runner.drain_with_clock(&mut outbox, 2, || 0).unwrap();

        assert_eq!(outbox.row("bad").state, "failed");
        assert_eq!(outbox.row("good").state, "sent");
        assert!(runner.host().discards >= 2);
        assert!(
            drained
                .logs
                .iter()
                .any(|line| line.outbox_id == "bad" && line.message.contains("panicked"))
        );
    }

    #[test]
    fn restart_refuses_a_changed_then_binding() {
        let old = declarations(declaration(Some("notifications.recordNotified")));
        let host = StubHost::new([sent(json!({ "providerId": "p1" }))]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox {
            fail_sent_once: true,
            ..MemoryOutbox::default()
        };
        outbox.push("o1", "notifications.notify", "queued", 0);
        outbox.install("generation-1", old.clone());
        let drained = runner.drain_with_clock(&mut outbox, 16, || 0).unwrap();
        assert!(
            drained
                .logs
                .iter()
                .any(|line| line.outbox_id == "o1" && line.message.contains("atomic then commit"))
        );

        outbox
            .system_outcomes
            .push_back(ThenOutcome::Failed("E_EFFECT_THEN_CHANGED".to_owned()));
        let mut restarted = Runner::new(StubHost::new(Vec::<Outcome>::new()));
        restarted.initialize(&mut outbox).unwrap();

        assert_eq!(outbox.row("o1").state, "failed");
        assert_eq!(
            outbox.row("o1").last_error.as_deref(),
            Some("E_EFFECT_THEN_CHANGED")
        );
        assert!(outbox.system_calls.is_empty());
    }

    #[test]
    fn effects_without_then_settle_running_directly_to_sent() {
        let host = StubHost::new([sent(json!(true))]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox::default();
        outbox.push("o1", "notifications.notify", "queued", 0);
        install(&mut outbox, declaration(None));

        runner.drain_with_clock(&mut outbox, 16, || 0).unwrap();

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
        install(&mut outbox, declaration(None));

        let drained = runner.drain_with_clock(&mut outbox, 16, || 0).unwrap();

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
        install(&mut outbox, declaration(None));
        let mut runner = Runner::new(crate::NoEngine);

        assert_eq!(runner.initialize(&mut outbox).unwrap().unknown_at_start, 1);
        let drained = runner.drain_with_clock(&mut outbox, 16, || 0).unwrap();

        assert_eq!(outbox.row("maybe-sent").state, "sent_unknown");
        assert_eq!(outbox.row("waiting").state, "queued");
        assert_eq!(outbox.row("waiting").job.attempt, 0);
        assert_eq!(
            outbox.row("waiting").last_error.as_deref(),
            Some("no engine in this build")
        );
        assert_eq!(drained.unavailable, vec!["no engine in this build"]);
    }

    #[test]
    fn each_claim_uses_its_bound_generation_during_one_drain() {
        let mut old = declaration(None);
        old.source = "async () => 'old'".to_owned();
        let mut new = old.clone();
        new.source = "async () => 'new'".to_owned();
        let mut removed = old.clone();
        removed.name = "removed.effect".to_owned();
        let host = StubHost::new([sent(json!("old")), sent(json!("new"))]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox::default();
        outbox.push("old", "notifications.notify", "queued", 0);
        outbox.push("new", "notifications.notify", "queued", 0);
        outbox.push("removed", "removed.effect", "queued", 0);
        let mut old_declarations = declarations(old);
        old_declarations.insert(removed.name.clone(), removed);
        outbox.install("generation-1", old_declarations);
        outbox
            .generations
            .insert("generation-2".to_owned(), declarations(new));
        outbox.switch_before_claim = Some((2, "generation-2".to_owned()));

        let drained = runner.drain_with_clock(&mut outbox, 16, || 0).unwrap();

        assert_eq!(drained.sent, 2);
        assert_eq!(drained.failed, 1);
        assert_eq!(runner.host().calls.len(), 2);
        assert!(runner.host().calls[0].0.source.contains("old"));
        assert!(runner.host().calls[1].0.source.contains("new"));
        assert_eq!(
            runner.host().calls[0].1.generation.as_deref(),
            Some("generation-1")
        );
        assert_eq!(
            runner.host().calls[1].1.generation.as_deref(),
            Some("generation-2")
        );
        assert_eq!(
            outbox.row("removed").last_error.as_deref(),
            Some("E_EFFECT_UNKNOWN")
        );
    }

    #[test]
    fn successor_after_claim_allows_identical_then_and_source() {
        let old = declaration(Some("notifications.recordNotified"));
        let mut current = old.clone();
        current.grants = vec!["https://api.other.example".to_owned()];
        let host = StubHost::new([sent(json!(true))]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox::default();
        outbox.push("compatible", "notifications.notify", "queued", 0);
        outbox.install("generation-1", declarations(old));
        outbox
            .generations
            .insert("generation-2".to_owned(), declarations(current));
        outbox.switch_after_claim = Some((1, "generation-2".to_owned()));

        let drained = runner.drain_with_clock(&mut outbox, 16, || 0).unwrap();

        assert_eq!(drained.sent, 1);
        assert_eq!(drained.failed, 0);
        assert_eq!(runner.host().calls.len(), 1);
        assert_eq!(outbox.row("compatible").state, "sent");
    }

    #[test]
    fn successor_after_claim_fails_changed_source_and_counter_is_failed() {
        let mut old = declaration(Some("notifications.recordNotified"));
        old.source = "async () => 'old'".to_owned();
        let mut changed = old.clone();
        changed.source = "async () => 'changed'".to_owned();
        let host = StubHost::new([sent(json!("first"))]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox::default();
        outbox.push("first", "notifications.notify", "queued", 0);
        outbox.push("stale", "notifications.notify", "queued", 0);
        outbox.install("generation-1", declarations(old));
        outbox
            .generations
            .insert("generation-2".to_owned(), declarations(changed));
        outbox.switch_after_claim = Some((2, "generation-2".to_owned()));

        let drained = runner.drain_with_clock(&mut outbox, 16, || 0).unwrap();

        assert_eq!(drained.sent, 1);
        assert_eq!(drained.failed, 1);
        assert_eq!(
            runner.host().calls.len(),
            1,
            "stale source never reaches host"
        );
        assert_eq!(outbox.row("stale").state, "failed");
        assert_eq!(
            outbox.row("stale").last_error.as_deref(),
            Some("E_EFFECT_THEN_CHANGED")
        );
    }

    #[test]
    fn changed_then_settlement_counts_failed_not_sent() {
        let host = StubHost::new([sent(json!(true))]);
        let mut runner = Runner::new(host);
        let mut outbox = MemoryOutbox {
            system_outcomes: VecDeque::from([ThenOutcome::Failed(
                "E_EFFECT_THEN_CHANGED".to_owned(),
            )]),
            ..MemoryOutbox::default()
        };
        outbox.push("changed", "notifications.notify", "queued", 0);
        install(
            &mut outbox,
            declaration(Some("notifications.recordNotified")),
        );

        let drained = runner.drain_with_clock(&mut outbox, 16, || 0).unwrap();

        assert_eq!(drained.sent, 0);
        assert_eq!(drained.failed, 1);
        assert_eq!(drained.then_failed, 1);
        assert_eq!(outbox.row("changed").state, "failed");
    }
    #[test]
    fn retryable_host_failure_survives_a_clock_failure() {
        let mut runner = Runner::new(StubHost::new([Outcome::Failed {
            error: "provider temporary".into(),
            retry: true,
        }]));
        let mut outbox = MemoryOutbox::default();
        outbox.push("retry", "notifications.notify", "queued", 0);
        install(&mut outbox, declaration(None));
        let mut times = VecDeque::from([Ok(1000), Err(OutboxError("clock down".into()))]);
        let drained = runner
            .drain_inner(&mut outbox, 1, |_| times.pop_front().unwrap())
            .unwrap();
        assert_eq!(drained.requeued, 1);
        assert_eq!(
            outbox.row("retry").last_error.as_deref(),
            Some("provider temporary")
        );
        assert_eq!(outbox.row("retry").next_at, 2000);
    }

    #[test]
    fn stopped_initialize_does_not_replay_pending_then() {
        let mut runner = Runner::new(StubHost::new([]));
        runner.set_stop_flag(Arc::new(AtomicBool::new(true)));
        let mut outbox = MemoryOutbox::default();
        outbox.push("pending", "notifications.notify", "then_pending", 1);
        outbox.row_mut("pending").unwrap().result = Some(json!(true));
        outbox.row_mut("pending").unwrap().then_op = Some("notifications.recordNotified".into());
        let drained = runner.initialize(&mut outbox).unwrap();
        assert_eq!(drained.sent, 0);
        assert!(outbox.system_calls.is_empty());
        assert_eq!(outbox.row("pending").state, "then_pending");
    }
}
