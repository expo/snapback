//! One maintenance path for the periodic tick and a development clock advance.
use super::{Shared, lock, refusal_json, respond};
use serde_json::json;
use snapback4_core::RuntimeError;
use std::{sync::Arc, time::Duration};
use tiny_http::Request;

#[derive(Default, serde::Serialize)]
struct Work { delivery_chunks: usize, expired: u64, schedules: usize, chunks: usize, parked: usize }

const WORK_TIME: Duration = Duration::from_millis(2);
const CONTENDED_TIME: Duration = Duration::from_micros(250);

fn engine_work<T>(shared: &Shared, run: impl FnOnce(&mut snapback4_core::Engine, Duration) -> T) -> T {
    let mut engine = shared.engine.background();
    let budget = if engine.contended() { CONTENDED_TIME } else { WORK_TIME };
    let result = run(&mut engine, budget);
    // Publish from this guard: a second ordinary admission would both delay
    // notification and mistake maintenance for a newly arrived request.
    if let Ok(seq) = engine.seq() {
        let mut current = lock(&shared.seq);
        if seq > *current { *current = seq; shared.committed.notify_all(); }
    }
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
    work.delivery_chunks = delivery(shared, drain)?;
    loop {
        let swept = phase(shared, engine_work(shared, |engine, budget| engine.sweep_expired_for(shared.now(), 2_000, budget)), drain, "the expiry sweep")?;
        work.expired += swept;
        if !drain || swept == 0 { break; }
    }
    // @ref LLP 3000.007#20.2 — advancing a replay clock does not release its schedule hold.
    if !shared.hold_schedules {
        let fired = phase(shared, engine_work(shared, |engine, _| engine.fire_schedules(shared.now())), drain, "schedules")?;
        work.schedules = fired.len();
        for name in fired { eprintln!("snapback4: schedule {name} fired"); }
    }
    while drain || work.chunks < 500 {
        if crate::lifecycle::stopping() { break; }
        let (run, logs) = engine_work(shared, |engine, budget| {
            let run = engine.run_job_chunk_for(shared.now(), budget);
            (run, engine.take_native_logs())
        });
        for line in logs { eprintln!("snapback4: native {line}"); }
        let Some(run) = phase(shared, run, drain, "job")? else { break; };
        work.chunks += 1;
        match run.state {
            snapback4_core::JobState::Done => eprintln!("snapback4: job {} done: {} chunk{}, {} row{} written", run.name, run.chunks, if run.chunks == 1 { "" } else { "s" }, run.rows_written, if run.rows_written == 1 { "" } else { "s" }),
            snapback4_core::JobState::Parked => {
                work.parked += 1;
                eprintln!("snapback4: job {} parked after {} chunks: {}", run.name, run.chunks, run.error.as_deref().unwrap_or(""));
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
            if actions + effects > 0 { shared.committed.notify_all(); }
            if effects > 0 { eprintln!("snapback4: {effects} effect lease{} expired; queued again", if effects == 1 { "" } else { "s" }); }
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

pub(super) fn maintain(shared: Arc<Shared>) {
    let mut tick: u64 = 0;
    let mut last_tick = std::time::Instant::now();
    loop {
        if crate::lifecycle::stopping() { return; }
        let observed = *lock(&shared.seq);
        {
            let _maintenance = lock(&shared.maintenance);
            let result = if last_tick.elapsed() >= Duration::from_secs(1) {
                tick += 1; last_tick = std::time::Instant::now();
                work(&shared, false, tick).map(|_| ())
            } else { delivery(&shared, false).map(|_| ()) };
            if let Err(error) = result { eprintln!("snapback4: maintenance failed: {error}"); }
        }
        // Mutation, action and adoption commits already notify this condition.
        // Startup/recovery also runs immediately; replay holds only schedules.
        let seq = lock(&shared.seq);
        if *seq == observed {
            drop(shared.committed.wait_timeout(seq, Duration::from_millis(100)).unwrap_or_else(|e| e.into_inner()));
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
    match work(shared, true, 0) {
        Ok(work) => respond(request, 200, json!({"now":now, "advancedMs":milliseconds, "work":work})),
        // Time remains advanced if maintenance fails; callers must not
        // retry the advance blindly. The normal tick retries pending work.
        Err(error) => respond(request, 500, json!({"now":now, "advancedMs":milliseconds, "denied":refusal_json(&error.refusal())})),
    }
}
