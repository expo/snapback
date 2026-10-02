//! Timing-critical maintenance and bulk catch-up share bounded engine slices.
use super::{Shared, lock, refusal_json, respond};
use serde_json::json;
use snapback4_core::RuntimeError;
use std::{sync::Arc, time::{Duration, Instant}};
use tiny_http::Request;

#[derive(Default, serde::Serialize)]
struct Work { delivery_chunks: usize, expired: u64, schedules: usize, chunks: usize, parked: usize }

const WORK_TIME: Duration = Duration::from_millis(2);
const CONTENDED_TIME: Duration = Duration::from_micros(250);

fn engine_work<T>(shared: &Shared, run: impl FnOnce(&mut snapback4_core::Engine, Duration) -> T) -> T {
    let mut engine = shared.engine.background();
    lock(&shared.readers).retry_missing(&engine);
    let budget = if engine.contended() { CONTENDED_TIME } else { WORK_TIME };
    let result = run(&mut engine, budget);
    // Publish from this guard: a second ordinary admission would both delay
    // notification and mistake maintenance for a newly arrived request.
    shared.publish_engine(&engine);
    result
}

fn phase<T: Default>(shared: &Shared, result: Result<T, RuntimeError>, drain: bool, name: &str) -> Result<T, RuntimeError> {
    match result {
        Err(error) if !drain => { super::adoption::background_failure(shared, name, &error); Ok(T::default()) }
        other => other,
    }
}

// @ref LLP 3000#7-decisions-during-execution — lifetimes are swept into the partition log; missed schedule boundaries fire once.
fn work(shared: &Shared, drain: bool, tick: u64) -> Result<Work, RuntimeError> {
    let mut work = Work::default();
    shared.ephemeral.sweep(shared.now())?;
    work.delivery_chunks = delivery(shared, drain)?;
    loop {
        if phase(shared, engine_work(shared, |engine, budget| engine.run_view_chunk_for(shared.now(), budget)), drain, "view recount")?.is_none() {break;}
        work.chunks += 1;
        if !drain && work.chunks >= 500 {break;}
        std::thread::yield_now();
    }
    loop {
        let swept = phase(shared, engine_work(shared, |engine, budget| engine.sweep_expired_for(shared.now(), 2_000, budget)), drain, "the expiry sweep")?;
        work.expired += swept;
        if !drain || swept == 0 { break; }
    }
    // @ref LLP 3000.007#20.2 — advancing a replay clock does not release its schedule hold.
    if !shared.hold_schedules {
        let fired = phase(shared, engine_work(shared, |engine, _| engine.fire_schedules(shared.now())), drain, "schedules")?;
        work.schedules = fired.len();
        for name in fired { snapback4_core::diagnostic!("snapback4: schedule {name} fired"); }
    }
    while drain || work.chunks < 500 {
        if crate::lifecycle::stopping() { break; }
        let (run, logs) = engine_work(shared, |engine, budget| {
            let run = engine.run_job_chunk_for(shared.now(), budget);
            (run, engine.take_native_logs())
        });
        for line in logs { snapback4_core::diagnostic!("snapback4: native {line}"); }
        let Some(run) = phase(shared, run, drain, "job")? else { break; };
        work.chunks += 1;
        match run.state {
            snapback4_core::JobState::Done => snapback4_core::diagnostic!("snapback4: job {} done: {} chunk{}, {} row{} written", run.name, run.chunks, if run.chunks == 1 { "" } else { "s" }, run.rows_written, if run.rows_written == 1 { "" } else { "s" }),
            snapback4_core::JobState::Parked => {
                work.parked += 1;
                if shared.personas { shared.refusals.job(&run); }
                snapback4_core::diagnostic!("snapback4: job {} parked after {} chunks: {}", run.name, run.chunks, run.error.as_deref().unwrap_or(""));
            }
            _ => {}
        }
        // FIFO engine admission hands waiting requests their turn before the
        // next chunk; yield_now alone cannot make that promise for a mutex.
    }
    if drain || tick % 5 == 0 {
        loop {
            let actions = phase(shared, engine_work(shared, |engine, budget| engine.requeue_expired_actions_for(shared.now(), budget)), drain, "the action lease sweep")?;
            let effects = phase(shared, engine_work(shared, |engine, budget| engine.requeue_expired_effects_for(shared.now(), budget)), drain, "the effect lease sweep")?;
            if actions + effects > 0 { shared.durable_committed(&lock(&shared.engine)); }
            if effects > 0 { snapback4_core::diagnostic!("snapback4: {effects} effect lease{} expired; queued again", if effects == 1 { "" } else { "s" }); }
            if !drain || actions + effects == 0 { break; }
        }
    }
    if drain || tick % 60 == 0 {
        phase(shared, (|| {
            let mut sweep = engine_work(shared, |engine, budget| engine.prepare_asset_sweep_for(shared.now(), budget))?;
            sweep.remove_files()?;
            while !sweep.is_empty() { engine_work(shared, |engine, budget| engine.finish_asset_sweep_for(&mut sweep, budget))?; }
            Ok(())
        })(), drain, "the asset sweep")?;
    }
    Ok(work)
}

fn delivery(shared: &Shared, drain: bool) -> Result<usize, RuntimeError> {
    let mut chunks = 0;
    while drain || chunks < 500 {
        if crate::lifecycle::stopping() { break; }
        if phase(shared, engine_work(shared, |engine, budget| engine.run_timeline_chunk_for(shared.now(), budget)), drain, "timeline delivery")?.is_none() { break; }
        chunks += 1;
    }
    Ok(chunks)
}

// @ref LLP 3000#contended-read-serving — one aged bulk slice gets ordinary
// priority without trying to undo Linux nice. The shared cursor also prevents
// a busy delivery queue from starving recounts or jobs.
const BULK_AGE: Duration = Duration::from_secs(1);
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BulkKind { Delivery, Recount, Job }
pub(super) struct State { next: BulkKind, serviced: Instant }
impl Default for State {
    fn default() -> Self { Self { next: BulkKind::Delivery, serviced: Instant::now() } }
}
impl State {
    fn aged(&self, now: Instant) -> bool { now.saturating_duration_since(self.serviced) >= BULK_AGE }
    fn completed(&mut self, now: Instant) {
        self.next = match self.next { BulkKind::Delivery => BulkKind::Recount, BulkKind::Recount => BulkKind::Job, BulkKind::Job => BulkKind::Delivery };
        self.serviced = now;
    }
}

// Exactly one engine slice, under the same FIFO maintenance gate as clock
// advancement. Both threads advance this cursor, including on an empty/error
// slice. No bulk phase can monopolize another phase's turn.
fn bulk_slice(shared: &Shared, state: &mut State) -> bool {
    let result = match state.next {
        BulkKind::Delivery => engine_work(shared, |engine, budget| engine.run_timeline_chunk_for(shared.now(), budget)).map(|r| r.is_some()),
        BulkKind::Recount => engine_work(shared, |engine, budget| engine.run_view_chunk_for(shared.now(), budget)).map(|r| r.is_some()),
        BulkKind::Job => {
            let (run, logs) = engine_work(shared, |engine, budget| {
                let run = engine.run_job_chunk_for(shared.now(), budget);
                (run, engine.take_native_logs())
            });
            for line in logs { snapback4_core::diagnostic!("snapback4: native {line}"); }
            run.map(|run| {
            if let Some(run) = &run {
                match run.state {
                    snapback4_core::JobState::Done => snapback4_core::diagnostic!("snapback4: job {} done: {} chunks, {} rows written", run.name, run.chunks, run.rows_written),
                    snapback4_core::JobState::Parked => {
                        if shared.personas { shared.refusals.job(run); }
                        snapback4_core::diagnostic!("snapback4: job {} parked after {} chunks: {}", run.name, run.chunks, run.error.as_deref().unwrap_or(""));
                    }
                    _ => {}
                }
            }
                run.is_some()
            })
        }
    };
    state.completed(Instant::now());
    phase(shared, result, false, "bulk maintenance").unwrap_or(false)
}

fn timely_engine_work<T>(shared: &Shared, run: impl FnOnce(&mut snapback4_core::Engine, Duration) -> T) -> T {
    let mut state = lock(&shared.maintenance);
    let result = engine_work(shared, run);
    if state.aged(Instant::now()) { bulk_slice(shared, &mut state); }
    result
}

fn timely(shared: &Shared, tick: u64) -> Result<(), RuntimeError> {
    phase(shared, timely_engine_work(shared, |engine, budget| engine.sweep_expired_for(shared.now(), 2_000, budget)), false, "the expiry sweep")?;
    if !shared.hold_schedules {
        let count = timely_engine_work(shared, |engine, _| engine.schema().schedules.len());
        for index in 0..count {
            // One atomic boundary per admission, never the entire schedule set.
            // Adoption between slices is harmless: the next tick visits its set.
            let fired = phase(shared, timely_engine_work(shared, |engine, _| engine.fire_schedule_at(shared.now(), index)), false, "schedules")?;
            for name in fired { snapback4_core::diagnostic!("snapback4: schedule {name} fired"); }
        }
    }
    if tick % 5 == 0 {
        phase(shared, timely_engine_work(shared, |engine, budget| {
            let result = engine.requeue_expired_actions_for(shared.now(), budget);
            if result.as_ref().is_ok_and(|n| *n > 0) { shared.durable_committed(engine); }
            result
        }), false, "the action lease sweep")?;
        let effects = phase(shared, timely_engine_work(shared, |engine, budget| {
            let result = engine.requeue_expired_effects_for(shared.now(), budget);
            if result.as_ref().is_ok_and(|n| *n > 0) { shared.durable_committed(engine); }
            result
        }), false, "the effect lease sweep")?;
        if effects > 0 { snapback4_core::diagnostic!("snapback4: {effects} effect leases expired; queued again"); }
    }
    if tick % 60 == 0 {
        phase(shared, (|| {
            let mut sweep = timely_engine_work(shared, |engine, budget| engine.prepare_asset_sweep_for(shared.now(), budget))?;
            // Bounded stale batch; filesystem work owns no engine lock.
            sweep.remove_files()?;
            while !sweep.is_empty() { timely_engine_work(shared, |engine, budget| engine.finish_asset_sweep_for(&mut sweep, budget))?; }
            Ok(())
        })(), false, "the asset sweep")?;
    }
    Ok(())
}

pub(super) fn maintain(shared: Arc<Shared>) {
    let mut tick = 0;
    let mut last_tick = Instant::now();
    loop {
        if crate::lifecycle::stopping() { return; }
        {
            let _maintenance = lock(&shared.maintenance);
            if let Err(error) = shared.ephemeral.sweep(shared.now()) { snapback4_core::diagnostic!("snapback4: ephemeral sweep: {error}"); }
        }
        if last_tick.elapsed() >= Duration::from_secs(1) {
            tick += 1; last_tick = Instant::now();
            if let Err(error) = timely(&shared, tick) { snapback4_core::diagnostic!("snapback4: maintenance failed: {error}"); }
        }
        promote_aged(&shared, Instant::now());
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn promote_aged(shared: &Shared, now: Instant) {
    let mut state = lock(&shared.maintenance);
    if state.aged(now) { bulk_slice(shared, &mut state); }
}

pub(super) fn bulk(shared: Arc<Shared>) {
    loop {
        if crate::lifecycle::stopping() { return; }
        let observed = *lock(&shared.seq);
        let mut did_work = false;
        for _ in 0..3 {
            if crate::lifecycle::stopping() { return; }
            did_work |= bulk_slice(&shared, &mut lock(&shared.maintenance));
        }
        if !did_work {
            let seq = lock(&shared.seq);
            if *seq == observed {
                drop(shared.committed.wait_timeout(seq, Duration::from_millis(100)).unwrap_or_else(|e| e.into_inner()));
            }
        }
    }
}

pub(super) fn advance(request: Request, shared: &Shared, body: &str) {
    if !shared.personas { return respond(request, 403, json!({"denied":refusal_json(&crate::dev_clock::release())})); }
    let duration = serde_json::from_str::<serde_json::Value>(body).ok()
        .and_then(|body| body.get("duration").and_then(|value| value.as_str()).map(str::to_owned));
    let milliseconds = match duration.as_deref().ok_or_else(|| crate::dev_clock::input("clock advance takes {\"duration\":\"+2m\"}"))
        .and_then(crate::dev_clock::duration) {
        Ok(milliseconds) => milliseconds,
        Err(error) => return respond(request, 400, json!({"denied":refusal_json(&error)})),
    };
    // Serialize advances with each other and the periodic tick, without
    // holding the engine or clock lock during maintenance or response I/O.
    let _maintenance = lock(&shared.maintenance);
    // @ref LLP 3000.007#20.12 — simulated time makes retries due without stealing a live worker's claim or viewer session.
    let advanced = (|| {
        // Match claims' engine-then-clock lock order: no claim can land
        // between shifting its lease and publishing the advanced clock.
        let mut engine = lock(&shared.engine);
        let mut clock = lock(&shared.clock);
        let mut next = clock.clone();
        let now = next.advance(milliseconds)?;
        engine.advance_worker_leases(milliseconds).map_err(|e| e.refusal())?;
        *clock = next;
        Ok(now)
    })();
    let now = match advanced {
        Ok(now) => now,
        Err(error) => return respond(request, 400, json!({"denied":refusal_json(&error)})),
    };
    // @ref LLP 3000#contended-read-serving — a developer is awaiting this
    // request; synchronous clock-advance work intentionally keeps request QoS.
    match work(shared, true, 0) {
        Ok(work) => respond(request, 200, json!({"now":now, "advancedMs":milliseconds, "work":work})),
        // Time remains advanced if maintenance fails; callers must not
        // retry the advance blindly. The normal tick retries pending work.
        Err(error) => respond(request, 500, json!({"now":now, "advancedMs":milliseconds, "denied":refusal_json(&error.refusal())})),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::tests::Host;

    #[test]
    fn aged_bulk_progresses_when_the_lower_priority_thread_never_runs() {
        let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(),
            "table rows:\n  n: int\n  public\njob catchup():\n  for row in rows:\n    update rows[row.id] { n: 1 }\n");
        let shared = &host.shared;
        let job = lock(&shared.engine).enqueue_job("catchup", Default::default(), shared.now()).unwrap();
        // Healthy bulk gets no extra ordinary turn before its age threshold.
        let now = Instant::now();
        lock(&shared.maintenance).serviced = now;
        promote_aged(shared, now + BULK_AGE - Duration::from_nanos(1));
        assert_eq!(lock(&shared.maintenance).next, BulkKind::Delivery);
        assert_eq!(lock(&shared.engine).job(&job).unwrap().unwrap().chunks, 0);
        // No utility/nice-5 thread exists. Three aged ordinary opportunities
        // still visit every bulk class, including the queued job.
        for kind in [BulkKind::Delivery, BulkKind::Recount, BulkKind::Job] {
            assert_eq!(lock(&shared.maintenance).next, kind);
            let due = lock(&shared.maintenance).serviced + BULK_AGE;
            promote_aged(shared, due);
        }
        assert_eq!(lock(&shared.maintenance).next, BulkKind::Delivery);
        assert_eq!(lock(&shared.engine).job(&job).unwrap().unwrap().state, snapback4_core::JobState::Done);
    }

    #[test]
    fn each_bulk_slice_releases_the_maintenance_gate_to_an_existing_waiter() {
        // This gate also serializes clock advancement; a bulk loop must not
        // reacquire it ahead of an ordinary/advance waiter.
        let gate = Arc::new(super::super::FairMutex::gate(State::default()));
        let first = lock(&gate);
        let waiter = gate.clone();
        let (sent, received) = std::sync::mpsc::channel();
        let thread = std::thread::spawn(move || { let _turn = lock(&waiter); sent.send(()).unwrap(); });
        let timeout = Instant::now() + Duration::from_secs(5);
        while gate.waiting() == 0 { assert!(Instant::now() < timeout); std::thread::yield_now(); }
        drop(first);
        let _next_bulk = lock(&gate);
        received.try_recv().expect("bulk overtook the waiting ordinary turn");
        thread.join().unwrap();
    }
}
