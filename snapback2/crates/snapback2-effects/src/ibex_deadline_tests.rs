//! The deadline in the effect host: one per job, armed before the first
//! entrance into authored code, held at every entrance after, reported as
//! `E_EFFECT_TIMEOUT` with `retry: true`.
//!
//! Its own file for the reason `ibex_tests.rs` is one: the 1,500-line cap.
//! Every test here is wall-clock — the deadline is one — with a firm lower
//! bound (the engine never fires early) and a loose upper bound for a loaded
//! machine, wide enough to hold there and narrow enough to tell a stop from
//! a hang.

use super::*;
use crate::{
    EffectDeclarations, OutboxAccess, OutboxError, OutboxSettlement, PendingThen, Runner,
    ThenOutcome,
};
use serde_json::Value;
use std::cell::Cell;
use std::io::Read;
use std::net::TcpListener;
use std::sync::{Arc, Condvar, Mutex};

const BUDGET: Duration = Duration::from_millis(300);
/// Past this a stopped program is indistinguishable from a hung one.
const LATE: Duration = Duration::from_secs(10);

fn declaration(source: &str, grants: Vec<String>) -> EffectDecl {
    EffectDecl {
        name: "delivery.notify".to_owned(),
        grants,
        source: source.to_owned(),
        then: None,
    }
}

fn job(id: &str, payload: Value) -> EffectJob {
    EffectJob {
        id: id.to_owned(),
        effect: "delivery.notify".to_owned(),
        payload,
        attempt: 1,
        generation: Some("generation-1".to_owned()),
    }
}

fn sent(result: Value) -> Outcome {
    Outcome::Sent {
        result,
        leftover: false,
    }
}

fn unreachable_grant() -> Vec<String> {
    vec!["http://127.0.0.1:1".to_owned()]
}

fn assert_timed_out(outcome: &Outcome, budget: Duration) {
    let expected = format!("E_EFFECT_TIMEOUT: budget {} ms", budget.as_millis());
    assert!(
        matches!(outcome, Outcome::Failed { retry: true, error } if error == &expected),
        "expected {expected:?} with retry: true, got {outcome:?}"
    );
}

fn assert_stopped_at(started: Instant, budget: Duration) {
    let elapsed = started.elapsed();
    assert!(elapsed >= budget, "stopped early: {elapsed:?}");
    assert!(elapsed < LATE, "stopped late: {elapsed:?}");
}

/// The ticket's first case: `while (true) {}` in the effect's synchronous
/// part. It spins inside the `run` entrance, so only a deadline armed before
/// that entrance can stop it; the host used to start its clock after.
#[test]
fn a_synchronous_loop_is_stopped_at_the_budget_and_its_runtime_is_discarded() {
    let decl = declaration("async () => { while (true) {} }", unreachable_grant());
    let mut host = Ibex2Host::new().unwrap();
    let started = Instant::now();
    let outcome = host.run(&decl, &job("spin-1", Value::Null), BUDGET);
    assert_timed_out(&outcome, BUDGET);
    assert_stopped_at(started, BUDGET);
    assert_eq!(
        host.cached_runtime_count(),
        0,
        "a runtime the deadline stopped is not reused"
    );
    // The host is unharmed: the next job builds a fresh runtime and completes.
    let calm = declaration("async () => 'calm'", unreachable_grant());
    assert_eq!(
        host.run(&calm, &job("calm-1", Value::Null), BUDGET),
        sent(json!("calm"))
    );
    assert_eq!(host.cached_runtime_count(), 1);
}

/// The ticket's second case: a microtask that schedules itself forever. The
/// effect's own promise settles — the queue is FIFO — but the drain behind it
/// never ends, and before the deadline neither did the host.
#[test]
fn a_recursive_microtask_chain_is_stopped_at_the_budget() {
    let decl = declaration(
        "async () => { const again = () => { Promise.resolve().then(again); }; again(); return 'settled behind the chain'; }",
        unreachable_grant(),
    );
    let mut host = Ibex2Host::new().unwrap();
    let started = Instant::now();
    let outcome = host.run(&decl, &job("chain-1", Value::Null), BUDGET);
    assert_timed_out(&outcome, BUDGET);
    assert_stopped_at(started, BUDGET);
    assert_eq!(host.cached_runtime_count(), 0);
}

/// A loopback provider that reads each request and then holds the connection
/// open, never writing a byte, until it is dropped.
struct HoldingProvider {
    port: u16,
    requests: Arc<Mutex<usize>>,
    release: Arc<(Mutex<bool>, Condvar)>,
}

impl HoldingProvider {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback provider");
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(Mutex::new(0));
        let release = Arc::new((Mutex::new(false), Condvar::new()));
        let counted = Arc::clone(&requests);
        let gate = Arc::clone(&release);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut raw = Vec::new();
                let mut buffer = [0_u8; 4096];
                while let Ok(read) = stream.read(&mut buffer) {
                    if read == 0 {
                        break;
                    }
                    raw.extend_from_slice(&buffer[..read]);
                    if raw.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }
                *counted.lock().unwrap() += 1;
                let (released, wake) = &*gate;
                let mut released = released.lock().unwrap();
                while !*released {
                    released = wake.wait(released).unwrap();
                }
                // Dropping the stream closes the connection, still unanswered.
            }
        });
        Self {
            port,
            requests,
            release,
        }
    }

    fn origin(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    fn requests(&self) -> usize {
        *self.requests.lock().unwrap()
    }
}

impl Drop for HoldingProvider {
    fn drop(&mut self) {
        let (released, wake) = &*self.release;
        *released.lock().unwrap() = true;
        wake.notify_all();
    }
}

/// A provider that accepts the request and never answers: the fetch stays
/// pending, every pump delivers nothing, and the deadline ends the job. The
/// runtime, and its in-flight request, are discarded with it.
#[test]
fn a_provider_that_never_answers_is_stopped_at_the_budget() {
    let provider = HoldingProvider::start();
    let decl = declaration(
        "async (payload, { fetch }) => (await fetch(payload.url, { method: 'POST', body: 'hello' })).text()",
        vec![provider.origin()],
    );
    let mut host = Ibex2Host::new().unwrap();
    let started = Instant::now();
    let outcome = host.run(
        &decl,
        &job("hold-1", json!({ "url": provider.origin() + "/hold" })),
        BUDGET,
    );
    assert_timed_out(&outcome, BUDGET);
    assert_stopped_at(started, BUDGET);
    assert_eq!(provider.requests(), 1, "the request reached the provider once");
    assert_eq!(host.cached_runtime_count(), 0);
}

/// The control: an effect that awaits a chain of microtasks, a timer, and
/// then spins for a while completes under the same deadline, keeps its
/// runtime, and the next job on that runtime completes too.
#[test]
fn a_well_behaved_effect_completes_under_the_deadline_and_keeps_its_runtime() {
    let decl = declaration(
        r#"async (payload) => {
              let steps = 0;
              const step = () => { if (++steps < 500) return Promise.resolve().then(step); };
              await step();
              await new Promise((resolve) => setTimeout(resolve, 5));
              const end = Date.now() + payload.spin;
              while (Date.now() < end) {}
              return { steps, id: meta.id };
            }"#,
        unreachable_grant(),
    );
    let mut host = Ibex2Host::new().unwrap();
    let budget = Duration::from_secs(5);
    let started = Instant::now();
    assert_eq!(
        host.run(&decl, &job("calm-1", json!({ "spin": 20 })), budget),
        sent(json!({ "steps": 500, "id": "calm-1" }))
    );
    assert!(started.elapsed() < budget);
    assert_eq!(
        host.cached_runtime_count(),
        1,
        "a job that completes keeps its runtime"
    );
    assert_eq!(
        host.run(&decl, &job("calm-2", json!({ "spin": 20 })), budget),
        sent(json!({ "steps": 500, "id": "calm-2" }))
    );
    assert_eq!(host.cached_runtime_count(), 1);
}

/// The budget is one deadline, not one renewed at each entrance: three timer
/// callbacks that each spin for half the budget are stopped where the deadline
/// falls. A budget renewed per pump would let all three finish.
#[test]
fn the_budget_is_one_deadline_not_renewed_at_each_entrance() {
    let decl = declaration(
        r#"async (payload) => {
              for (let i = 0; i < 3; i++) {
                await new Promise((resolve) => setTimeout(resolve, 1));
                const end = Date.now() + payload.spin;
                while (Date.now() < end) {}
              }
              return 'three spins';
            }"#,
        unreachable_grant(),
    );
    let mut host = Ibex2Host::new().unwrap();
    let started = Instant::now();
    let outcome = host.run(&decl, &job("spins-1", json!({ "spin": 150 })), BUDGET);
    assert_timed_out(&outcome, BUDGET);
    assert_stopped_at(started, BUDGET);
    // The same program, spinning for a tenth of the budget each time, completes.
    assert_eq!(
        host.run(&decl, &job("spins-2", json!({ "spin": 10 })), BUDGET),
        sent(json!("three spins"))
    );
}

/// The smallest durable outbox: one row, claimed by the clock, settled by the
/// runner. Enough to drive the attempt and backoff machinery against a real
/// engine; `runner.rs` keeps its own richer double for the seam's own tests.
struct OneRowOutbox {
    job: EffectJob,
    decl: EffectDecl,
    state: &'static str,
    next_at: i64,
    last_error: Option<String>,
}

impl OneRowOutbox {
    fn new(id: &str, decl: &EffectDecl) -> Self {
        Self {
            job: EffectJob {
                id: id.to_owned(),
                effect: decl.name.clone(),
                payload: Value::Null,
                attempt: 0,
                generation: None,
            },
            decl: decl.clone(),
            state: "queued",
            next_at: 0,
            last_error: None,
        }
    }
}

impl OutboxAccess for OneRowOutbox {
    fn now(&mut self) -> Result<i64, OutboxError> {
        Ok(self.next_at)
    }

    fn claim_next(&mut self, now: i64) -> Result<Option<EffectJob>, OutboxError> {
        if self.state != "queued" || self.next_at > now {
            return Ok(None);
        }
        self.state = "running";
        self.job.attempt += 1;
        self.job.generation = Some("generation-1".to_owned());
        Ok(Some(self.job.clone()))
    }

    fn effect_declarations(&mut self, _job: &EffectJob) -> Result<EffectDeclarations, OutboxError> {
        Ok(EffectDeclarations {
            current_generation: "generation-1".to_owned(),
            bound: Some(self.decl.clone()),
            current: Some(self.decl.clone()),
        })
    }

    fn settle(&mut self, id: &str, settlement: OutboxSettlement) -> Result<(), OutboxError> {
        assert_eq!(id, self.job.id);
        match settlement {
            OutboxSettlement::Retry { error, next_at } => {
                self.state = "queued";
                self.next_at = next_at;
                self.last_error = Some(error);
            }
            OutboxSettlement::Failed { error } => {
                self.state = "failed";
                self.last_error = Some(error);
            }
            other => panic!("a spinning effect settled {other:?}"),
        }
        Ok(())
    }

    fn pending_then(&mut self, _limit: usize) -> Result<Vec<PendingThen>, OutboxError> {
        Ok(Vec::new())
    }

    fn requeue(&mut self, _id: &str, _now: i64) -> Result<(), OutboxError> {
        Err(OutboxError::from("the runner never requeues on its own"))
    }

    fn mark_unknown_running_at_start(&mut self, _now: i64) -> Result<u64, OutboxError> {
        Ok(0)
    }

    fn mark_queued_unavailable(&mut self, _error: &str) -> Result<u64, OutboxError> {
        Ok(0)
    }

    fn execute_then(
        &mut self,
        _op: &str,
        _args: Value,
        _outbox_id: &str,
    ) -> Result<ThenOutcome, OutboxError> {
        Err(OutboxError::from("a spinning effect has no then"))
    }
}

/// A program that spins exhausts its five attempts across the backoff
/// schedule and then reads `failed` (LLP 1021 §5): the engine stops each
/// attempt at the budget, the host reports `E_EFFECT_TIMEOUT` with
/// `retry: true`, and the runner requeues at the failure instant plus
/// 1 s · 2ⁿ until the fifth attempt, which fails the row. The clock is the
/// runner's injected one, advanced to each retry instant as the dev clock is.
#[test]
fn a_spinning_effect_fails_after_five_attempts_across_the_backoff_schedule() {
    let budget = Duration::from_millis(150);
    let decl = declaration("async () => { while (true) {} }", unreachable_grant());
    let mut outbox = OneRowOutbox::new("spin-row", &decl);
    let mut runner = Runner::with_budget(Ibex2Host::new().unwrap(), budget);
    let clock = Cell::new(10_000_i64);
    let mut schedule = Vec::new();
    for attempt in 1..=5_u32 {
        let started = Instant::now();
        let drained = runner
            .drain_with_clock(&mut outbox, 16, || clock.get())
            .unwrap();
        assert!(
            started.elapsed() >= budget,
            "attempt {attempt} was not held to the budget"
        );
        assert_eq!(drained.claimed, 1, "attempt {attempt}");
        assert_eq!(outbox.job.attempt, attempt);
        assert_eq!(
            outbox.last_error.as_deref(),
            Some("E_EFFECT_TIMEOUT: budget 150 ms"),
            "attempt {attempt}"
        );
        if attempt < 5 {
            assert_eq!((drained.requeued, drained.failed), (1, 0), "attempt {attempt}");
            assert_eq!(outbox.state, "queued");
            schedule.push(outbox.next_at - clock.get());
            clock.set(outbox.next_at);
        } else {
            assert_eq!((drained.requeued, drained.failed), (0, 1));
            assert_eq!(outbox.state, "failed");
        }
    }
    assert_eq!(schedule, vec![1_000, 2_000, 4_000, 8_000]);
    let after = runner
        .drain_with_clock(&mut outbox, 16, || clock.get() + 100_000)
        .unwrap();
    assert_eq!(after.claimed, 0, "a failed row is never claimed again");
}
