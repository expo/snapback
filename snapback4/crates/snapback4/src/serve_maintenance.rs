//! One maintenance path for the periodic tick and a development clock advance.
use super::{Shared, bump_seq, lock, refusal_json, respond};
use serde_json::json;
use snapback4_core::RuntimeError;
use std::{sync::Arc, time::Duration};
use tiny_http::Request;

#[derive(Default, serde::Serialize)]
struct Work { expired: u64, schedules: usize, chunks: usize, parked: usize }

fn phase<T: Default>(shared: &Shared, result: Result<T, RuntimeError>, drain: bool, name: &str) -> Result<T, RuntimeError> {
    match result {
        Err(error) if !drain => { super::adoption::background_failure(shared, name, &error); Ok(T::default()) }
        other => other,
    }
}

// @ref LLP 3000#7-decisions-during-execution — lifetimes are swept into the partition log; missed schedule boundaries fire once.
fn work(shared: &Shared, drain: bool, tick: u64) -> Result<Work, RuntimeError> {
    let mut work = Work::default();
    loop {
        let swept = phase(shared, lock(&shared.engine).sweep_expired(shared.now(), 2_000), drain, "the expiry sweep")?;
        work.expired += swept;
        if swept > 0 { bump_seq(shared); }
        if !drain || swept < 2_000 { break; }
        std::thread::yield_now();
    }
    // @ref LLP 3000.007#20.2 — advancing a replay clock does not release its schedule hold.
    if !shared.hold_schedules {
        let fired = phase(shared, lock(&shared.engine).fire_schedules(shared.now()), drain, "schedules")?;
        work.schedules = fired.len();
        for name in fired { eprintln!("snapback4: schedule {name} fired"); }
    }
    while drain || work.chunks < 500 {
        if crate::lifecycle::stopping() { break; }
        let Some(run) = phase(shared, lock(&shared.engine).run_job_chunk(shared.now()), drain, "job")? else { break; };
        work.chunks += 1;
        bump_seq(shared);
        for line in lock(&shared.engine).take_native_logs() { eprintln!("snapback4: native {line}"); }
        match run.state {
            snapback4_core::JobState::Done => eprintln!("snapback4: job {} done: {} chunk{}, {} row{} written", run.name, run.chunks, if run.chunks == 1 { "" } else { "s" }, run.rows_written, if run.rows_written == 1 { "" } else { "s" }),
            snapback4_core::JobState::Parked => {
                work.parked += 1;
                eprintln!("snapback4: job {} parked after {} chunks: {}", run.name, run.chunks, run.error.as_deref().unwrap_or(""));
            }
            _ => {}
        }
        // The engine is available to requests between each bounded chunk.
        std::thread::yield_now();
    }
    if drain || tick % 5 == 0 {
        let actions = phase(shared, lock(&shared.engine).requeue_expired_actions(shared.now()), drain, "the action lease sweep")?;
        let effects = phase(shared, lock(&shared.engine).requeue_expired_effects(shared.now()), drain, "the effect lease sweep")?;
        if actions + effects > 0 { shared.committed.notify_all(); }
        if effects > 0 { eprintln!("snapback4: {effects} effect lease{} expired; queued again", if effects == 1 { "" } else { "s" }); }
    }
    if drain || tick % 60 == 0 {
        phase(shared, (|| {
            let sweep = lock(&shared.engine).prepare_asset_sweep(shared.now())?;
            sweep.remove_files()?;
            lock(&shared.engine).finish_asset_sweep(&sweep)
        })(), drain, "the asset sweep")?;
    }
    Ok(work)
}

pub(super) fn maintain(shared: Arc<Shared>) {
    let mut tick: u64 = 0;
    loop {
        std::thread::sleep(Duration::from_secs(1));
        if crate::lifecycle::stopping() { return; }
        tick += 1;
        let _maintenance = lock(&shared.maintenance);
        if let Err(error) = work(&shared, false, tick) { eprintln!("snapback4: maintenance failed: {error}"); }
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
