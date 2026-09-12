//! The deadline in the effect host: one per job, armed before the first
//! authored code the runtime runs, held at every entrance after, reported as
//! `E_EFFECT_TIMEOUT` with `retry: true`.
//!
//! Its own file for the reason `ibex_tests.rs` is one: the 1,500-line cap.
//! Every test here is wall-clock — the deadline is one — with a firm lower
//! bound (the engine never fires early) and a loose upper bound for a loaded
//! machine, wide enough to hold there and narrow enough to tell a stop from
//! a hang. Where the bound is the point, a calm job builds the runtime first,
//! so the clock measures the stopped job alone and a slow construction cannot
//! stand in for the stop.

use super::*;
use crate::{
    EffectDeclarations, OutboxAccess, OutboxError, OutboxSettlement, PendingThen, Runner,
    ThenOutcome,
};
use serde_json::Value;
use std::cell::Cell;
use std::io::Read;
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;

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
        bindings: None,
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

/// A host whose runtime for `decl` is already built: one calm job ran on it
/// and kept it, so a clock started after this measures the next job alone.
fn warmed(decl: &EffectDecl, calm: Value) -> Ibex2Host {
    let mut host = Ibex2Host::new().unwrap();
    assert_eq!(
        host.run(decl, &job("warm-up", calm), Duration::from_secs(10)),
        sent(json!("calm"))
    );
    assert_eq!(
        host.cached_runtime_count(),
        1,
        "the warm-up keeps its runtime"
    );
    host
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
    let decl = declaration(
        "async (payload) => { while (payload.spin) {} return 'calm'; }",
        unreachable_grant(),
    );
    let mut host = warmed(&decl, json!({ "spin": false }));
    let started = Instant::now();
    let outcome = host.run(&decl, &job("spin-1", json!({ "spin": true })), BUDGET);
    assert_timed_out(&outcome, BUDGET);
    assert_stopped_at(started, BUDGET);
    assert_eq!(
        host.cached_runtime_count(),
        0,
        "a runtime the deadline stopped is not reused"
    );
    // The host is unharmed: the next job builds a fresh runtime and completes.
    assert_eq!(
        host.run(&decl, &job("calm-1", json!({ "spin": false })), BUDGET),
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
        r#"async (payload) => {
              if (!payload.chain) return 'calm';
              const again = () => { Promise.resolve().then(again); };
              again();
              return 'settled behind the chain';
            }"#,
        unreachable_grant(),
    );
    let mut host = warmed(&decl, json!({ "chain": false }));
    let started = Instant::now();
    let outcome = host.run(&decl, &job("chain-1", json!({ "chain": true })), BUDGET);
    assert_timed_out(&outcome, BUDGET);
    assert_stopped_at(started, BUDGET);
    assert_eq!(host.cached_runtime_count(), 0);
}

/// The module's top level is the first authored code the runtime runs — the
/// compiler's IIFE around `run`, or any expression there — and it runs
/// before any host call. It is held to the same budget: a spin there is
/// stopped, reported as the timeout, and no runtime is kept. This one cannot
/// be warmed — the build is what spins — so the deadline's own clock, which
/// starts before the build, is the bound.
#[test]
fn a_spin_at_the_module_top_level_is_stopped_at_the_budget() {
    let decl = declaration("(() => { while (true) {} })()", unreachable_grant());
    let mut host = Ibex2Host::new().unwrap();
    let started = Instant::now();
    let outcome = host.run(&decl, &job("top-1", Value::Null), BUDGET);
    assert_timed_out(&outcome, BUDGET);
    assert_stopped_at(started, BUDGET);
    assert_eq!(
        host.cached_runtime_count(),
        0,
        "a build the deadline ended leaves no runtime"
    );
    let calm = declaration(
        "(() => { return async () => 'calm'; })()",
        unreachable_grant(),
    );
    assert_eq!(
        host.run(&calm, &job("calm-1", Value::Null), BUDGET),
        sent(json!("calm"))
    );
    assert_eq!(host.cached_runtime_count(), 1);
}

/// A loopback provider that reads each request and then holds its connection
/// open, never writing a byte, until the provider is dropped — which also
/// closes the listener, so the port does not outlive the test. Each
/// connection is held on its own thread, so a second request is read too.
struct HoldingProvider {
    port: u16,
    requests: Arc<Mutex<usize>>,
    release: Arc<(Mutex<bool>, Condvar)>,
    closing: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl HoldingProvider {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback provider");
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(Mutex::new(0));
        let release = Arc::new((Mutex::new(false), Condvar::new()));
        let closing = Arc::new(AtomicBool::new(false));
        let counted = Arc::clone(&requests);
        let gate = Arc::clone(&release);
        let closed = Arc::clone(&closing);
        let thread = std::thread::spawn(move || {
            for stream in listener.incoming() {
                if closed.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(stream) = stream else { break };
                let counted = Arc::clone(&counted);
                let gate = Arc::clone(&gate);
                std::thread::spawn(move || hold(stream, &counted, &gate));
            }
            // The listener goes with the thread.
        });
        Self {
            port,
            requests,
            release,
            closing,
            thread: Some(thread),
        }
    }

    fn origin(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    fn requests(&self) -> usize {
        *self.requests.lock().unwrap()
    }
}

/// Read one request's headers, count it, and hold the connection until the
/// provider releases it; dropping the stream then closes it, unanswered.
fn hold(mut stream: TcpStream, counted: &Mutex<usize>, gate: &(Mutex<bool>, Condvar)) {
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
    let (released, wake) = gate;
    let mut released = released.lock().unwrap();
    while !*released {
        released = wake.wait(released).unwrap();
    }
}

impl Drop for HoldingProvider {
    fn drop(&mut self) {
        let (released, wake) = &*self.release;
        *released.lock().unwrap() = true;
        wake.notify_all();
        self.closing.store(true, Ordering::SeqCst);
        // One more connection wakes the accept loop so it can see `closing`.
        let _ = TcpStream::connect(("127.0.0.1", self.port));
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// A provider that accepts the request and never answers: the fetch stays
/// pending, every pump delivers nothing, and the deadline ends the job. The
/// runtime, and its in-flight request, are discarded with it.
#[test]
fn a_provider_that_never_answers_is_stopped_at_the_budget() {
    let provider = HoldingProvider::start();
    let decl = declaration(
        "async (payload, { fetch }) => payload.url === null ? 'calm' : (await fetch(payload.url, { method: 'POST', body: 'hello' })).text()",
        vec![provider.origin()],
    );
    let mut host = warmed(&decl, json!({ "url": null }));
    let started = Instant::now();
    let outcome = host.run(
        &decl,
        &job("hold-1", json!({ "url": provider.origin() + "/hold" })),
        BUDGET,
    );
    assert_timed_out(&outcome, BUDGET);
    assert_stopped_at(started, BUDGET);
    assert_eq!(
        provider.requests(),
        1,
        "the request reached the provider once"
    );
    assert_eq!(host.cached_runtime_count(), 0);
}

/// A job that settled before the deadline keeps its settlement when the
/// deadline ends leftover I/O it abandoned: a failure keeps the
/// classification made when it settled — a grant denial is not turned into
/// a retryable timeout — and a result stands. The timeout is for a job still
/// running. The held request is what carries the job to the deadline.
#[test]
fn a_job_settled_before_the_deadline_keeps_its_settlement_when_leftover_io_reaches_it() {
    let provider = HoldingProvider::start();
    let decl = declaration(
        r#"async (payload, { fetch }) => {
              fetch(payload.hold, { method: 'POST', body: 'abandoned' }).catch(function () {});
              if (payload.deny) return fetch('http://undeclared.invalid/');
              return 'sent beside a held request';
            }"#,
        vec![provider.origin()],
    );
    let hold = provider.origin() + "/hold";
    let mut host = Ibex2Host::new().unwrap();
    let started = Instant::now();
    let outcome = host.run(
        &decl,
        &job("deny-1", json!({ "hold": hold, "deny": true })),
        BUDGET,
    );
    assert!(
        matches!(&outcome, Outcome::Failed { retry: false, error }
            if error.contains("denied: net.fetch http://undeclared.invalid")),
        "a grant denial at the deadline stays non-retryable: {outcome:?}"
    );
    assert_stopped_at(started, BUDGET);
    assert_eq!(
        host.cached_runtime_count(),
        0,
        "the held request goes with the runtime"
    );

    let started = Instant::now();
    assert_eq!(
        host.run(
            &decl,
            &job("sent-1", json!({ "hold": hold, "deny": false })),
            BUDGET
        ),
        Outcome::Sent {
            result: json!("sent beside a held request"),
            leftover: true,
        }
    );
    assert_stopped_at(started, BUDGET);
    assert_eq!(host.cached_runtime_count(), 0);
    assert_eq!(provider.requests(), 2);
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
/// falls. A budget renewed per pump would let all three finish. The same
/// program spinning for a tenth of the budget each time completes — and runs
/// first, so it is also what builds the runtime the stopped job runs on.
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
    assert_eq!(
        host.run(&decl, &job("spins-1", json!({ "spin": 10 })), BUDGET),
        sent(json!("three spins"))
    );
    assert_eq!(host.cached_runtime_count(), 1);
    let started = Instant::now();
    let outcome = host.run(&decl, &job("spins-2", json!({ "spin": 150 })), BUDGET);
    assert_timed_out(&outcome, BUDGET);
    assert_stopped_at(started, BUDGET);
    assert_eq!(host.cached_runtime_count(), 0);
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
                bindings: None,
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
            assert_eq!(
                (drained.requeued, drained.failed),
                (1, 0),
                "attempt {attempt}"
            );
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

#[test]
fn held_fetch_drive_measurement() {
    let provider = HoldingProvider::start();
    let decl = declaration(
        "async (payload, { fetch }) => { if (!payload.wait) return 'calm'; return await fetch(payload.url); }",
        vec![provider.origin()],
    );
    let mut host = warmed(&decl, json!({"wait":false}));
    DRIVE_TURNS.with(|turns| turns.set(0));
    let started = Instant::now();
    let budget = Duration::from_secs(2);
    let outcome = host.run(
        &decl,
        &job("held-measure", json!({"wait":true,"url":provider.origin()})),
        budget,
    );
    assert_timed_out(&outcome, budget);
    assert_eq!(provider.requests(), 1);
    let turns = DRIVE_TURNS.with(|turns| turns.get());
    assert!(turns <= 100, "blocked fetch hot-looped: {turns} turns");
    eprintln!(
        "held_fetch_drive turns={turns} elapsed_ms={}",
        started.elapsed().as_millis()
    );
}

#[test]
fn trusted_setup_obeys_an_expired_deadline_and_host_tokens_are_os_random() {
    let decl = declaration("async () => true", vec![]);
    assert!(matches!(
        build_runtime(&decl, None, Instant::now()),
        Err(BuildFailure::Deadline)
    ));
    let first = host_channel_token().unwrap();
    let second = host_channel_token().unwrap();
    assert_eq!(first.len(), 64);
    assert!(first.bytes().all(|byte| byte.is_ascii_hexdigit()));
    assert_ne!(first, second);
}

#[test]
fn host_channel_failure_discards_the_cached_runtime() {
    let decl = declaration("async () => 'calm'", vec![]);
    let mut host = warmed(&decl, json!(null));
    host.runtimes.values_mut().next().unwrap().host_token = "wrong-token".into();
    assert!(matches!(
        host.run(&decl, &job("broken-host", json!(null)), BUDGET),
        Outcome::Failed { .. }
    ));
    assert_eq!(host.cached_runtime_count(), 0);
}
