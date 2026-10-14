//! Timing-critical maintenance and bulk catch-up share bounded engine slices.
use super::{Shared, lock, refusal_json, respond};
use serde_json::json;
use snapback4_core::RuntimeError;
use std::{sync::Arc, time::{Duration, Instant}};
use tiny_http::Request;

#[derive(Default, serde::Serialize)]
struct Work { delivery_chunks: usize, expired: u64, schedules: usize, chunks: usize, parked: usize, #[serde(skip)] fired: Vec<String> }

const WORK_TIME: Duration = Duration::from_millis(2);
const CONTENDED_TIME: Duration = Duration::from_micros(250);

// Charge consumed CPU for pacing, not time the OS already kept this thread off
// CPU. The cooperative chunk deadline still uses wall time. A failed clock
// sample falls back to the more conservative wall-time pause.
struct SliceClock { wall: Instant, cpu: Option<Duration> }
impl SliceClock {
    fn start() -> Self { Self { wall: Instant::now(), cpu: Self::cpu_time() } }
    fn cpu_time() -> Option<Duration> {
        let mut at = libc::timespec { tv_sec: 0, tv_nsec: 0 };
        if unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut at) } != 0 { return None; }
        Some(Duration::new(at.tv_sec.try_into().ok()?, at.tv_nsec.try_into().ok()?))
    }
    fn consumed(&self) -> Duration {
        self.cpu.zip(Self::cpu_time()).and_then(|(start, end)| end.checked_sub(start)).unwrap_or_else(|| self.wall.elapsed())
    }
}

// Detached readers do not take engine tickets. Sample OS load as well as the
// round-3 engine contention signal; cache the syscall for 100 ms. Load includes
// other tenants and trails short bursts, so this is a pacing hint, not admission.
fn host_contended() -> bool {
    use std::sync::{Mutex, OnceLock};
    static SAMPLE: Mutex<(Option<Instant>, bool)> = Mutex::new((None, false));
    static CPUS: OnceLock<usize> = OnceLock::new();
    let mut sample = lock(&SAMPLE);
    if sample.0.is_none_or(|at| at.elapsed() >= Duration::from_millis(100)) {
        let mut load = 0.0;
        let cpus = *CPUS.get_or_init(|| std::thread::available_parallelism().map_or(1, |n| n.get()));
        sample.1 = unsafe { libc::getloadavg(&mut load, 1) } == 1 && load >= cpus as f64;
        sample.0 = Some(Instant::now());
    }
    sample.1
}

fn engine_work<T>(shared: &Shared, run: impl FnOnce(&mut snapback4_core::Engine, Duration) -> T) -> T {
    let mut engine = shared.engine.background();
    lock(&shared.readers).retry_missing(&engine);
    let budget = if engine.contended() || host_contended() { CONTENDED_TIME } else { WORK_TIME };
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
        for name in &fired { snapback4_core::diagnostic!("snapback4: schedule {name} fired"); }
        work.fired = fired;
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

// @ref LLP 3000#contended-read-serving — ordinary-priority bulk work yields
// outside every shared lock. Aged service protects finite backlogs from traffic.
const BULK_AGE: Duration = Duration::from_secs(1);
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BulkKind { Delivery, Recount, Job }
pub(super) struct State {
    next: BulkKind,
    serviced: Instant,
    resume_at: Instant,
    empty_pause: Duration,
    advancing: bool,
    // Separate clock callers (and a dev reset) may wait here; maintenance never takes this lock.
    pub(super) advance: Arc<std::sync::Mutex<()>>,
}
impl Default for State {
    fn default() -> Self {
        let now = Instant::now();
        Self { next: BulkKind::Delivery, serviced: now, resume_at: now, empty_pause: Duration::ZERO,
            advancing: false, advance: Arc::new(std::sync::Mutex::new(())) }
    }
}
impl State {
    fn aged(&self, now: Instant) -> bool { now.saturating_duration_since(self.serviced) >= BULK_AGE }
    fn eligible(&self, now: Instant, aged_only: bool) -> bool {
        !self.advancing && if aged_only { self.aged(now) } else { now >= self.resume_at }
    }
    fn completed(&mut self, now: Instant, elapsed: Duration, contended: bool, worked: bool) {
        self.next = match self.next { BulkKind::Delivery => BulkKind::Recount, BulkKind::Recount => BulkKind::Job, BulkKind::Job => BulkKind::Delivery };
        self.serviced = now;
        // Target 1/8 CPU duty under contention, charging consumed thread CPU,
        // including atomic overruns. Cap at 100 ms; aged service is independent.
        let cap = Duration::from_millis(100);
        let charged = if contended { (elapsed * 7).min(cap) } else { Duration::ZERO };
        self.empty_pause += charged;
        // @ref LLP 3000#contended-read-serving — empty kinds keep their CPU
        // charge, but repay it with the next useful slice or the empty cycle.
        // Avoid two extra scheduler wakeups for every single delivery slice.
        let pause = if worked || self.empty_pause >= cap { self.empty_pause.min(cap) } else { Duration::ZERO };
        self.empty_pause -= pause;
        // An aged slice can finish after bulk flushes empty-cycle debt. Append
        // this charge without discarding repayment still owed in that ordering.
        self.resume_at = self.resume_at.max(now) + pause;
    }

    fn empty_cycle(&mut self, now: Instant) -> Duration {
        let pause = std::mem::take(&mut self.empty_pause);
        // A timed worker may just have scheduled repayment. Append remaining
        // debt rather than overlapping (and losing) either charge.
        self.resume_at = self.resume_at.max(now) + pause;
        self.resume_at.saturating_duration_since(now)
    }
}

// Admission owns no maintenance gate. Once admitted, the engine serializes the
// cursor's read -> chunk commit -> advance; the gate only protects small state
// accesses. Ordinary work never waits for a bulk thread to enter the engine.
fn bulk_slice(shared: &Shared, aged_only: bool) -> bool {
    if !lock(&shared.maintenance).eligible(Instant::now(), aged_only) { return false; }
    engine_work(shared, |engine, budget| {
        let kind = {
            let state = lock(&shared.maintenance);
            if !state.eligible(Instant::now(), aged_only) { return false; }
            state.next
        };
        let started = SliceClock::start();
        let result = match kind {
            BulkKind::Delivery => engine.run_timeline_turn_for(shared.now(), budget).map(|r| r.is_some()),
            BulkKind::Recount => engine.run_view_chunk_for(shared.now(), budget).map(|r| r.is_some()),
            BulkKind::Job => {
                let run = engine.run_job_chunk_for(shared.now(), budget);
                for line in engine.take_native_logs() { snapback4_core::diagnostic!("snapback4: native {line}"); }
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
        lock(&shared.maintenance).completed(Instant::now(), started.consumed(), budget == CONTENDED_TIME || shared.engine.has_waiters(), result.as_ref().map_or(true, |worked| *worked));
        phase(shared, result, false, "bulk maintenance").unwrap_or(false)
    })
}

fn timely_engine_work<T: Default>(shared: &Shared, run: impl FnOnce(&mut snapback4_core::Engine, Duration) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
    let result = engine_work(shared, |engine, budget| {
        if lock(&shared.maintenance).advancing { return Ok(T::default()); }
        run(engine, budget)
    });
    promote_aged(shared, Instant::now());
    result
}

fn timely(shared: &Shared, tick: u64) -> Result<(), RuntimeError> {
    phase(shared, timely_engine_work(shared, |engine, budget| engine.sweep_expired_for(shared.now(), 2_000, budget)), false, "the expiry sweep")?;
    if !shared.hold_schedules {
        let count = timely_engine_work(shared, |engine, _| Ok(engine.schema().schedules.len()))?;
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
            let Some(mut sweep) = timely_engine_work(shared, |engine, budget| engine.prepare_asset_sweep_for(shared.now(), budget).map(Some))? else { return Ok(()); };
            // Bounded stale batch; filesystem work owns no engine lock.
            sweep.remove_files()?;
            while !sweep.is_empty() {
                // A clock drain that began between file removal and retirement
                // owns the sweep now. Its durable metadata also permits retry
                // on the next asset tick; do not spin on skipped slices.
                if timely_engine_work(shared, |engine, budget| engine.finish_asset_sweep_for(&mut sweep, budget))? == 0 { break; }
            }
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
            let state = lock(&shared.maintenance);
            if !state.advancing && let Err(error) = shared.ephemeral.sweep(shared.now()) { snapback4_core::diagnostic!("snapback4: ephemeral sweep: {error}"); }
        }
        if last_tick.elapsed() >= Duration::from_secs(1) {
            tick += 1; last_tick = Instant::now();
            // One bounded reclamation slice; abandoned bytes remain charged
            // until their actual records are dropped. No engine lock is held.
            lock(&shared.following).reclaim(shared.now(), snapback4_core::Ceilings { heap_bytes: 1 << 20, ..Default::default() });
            if let Err(error) = timely(&shared, tick) { snapback4_core::diagnostic!("snapback4: maintenance failed: {error}"); }
        }
        promote_aged(&shared, Instant::now());
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn promote_aged(shared: &Shared, now: Instant) {
    if lock(&shared.maintenance).eligible(now, true) { bulk_slice(shared, true); }
}

pub(super) fn bulk(shared: Arc<Shared>) {
    loop {
        if crate::lifecycle::stopping() { return; }
        let observed = *lock(&shared.seq);
        let mut did_work = false;
        for _ in 0..3 {
            if crate::lifecycle::stopping() { return; }
            did_work |= bulk_slice(&shared, false);
            let pause = lock(&shared.maintenance).resume_at.saturating_duration_since(Instant::now());
            if !pause.is_zero() {
                // No shared lock survives this pause. Request commits do not
                // cancel repayment; empty kinds do not idle an active cycle.
                std::thread::sleep(pause.min(Duration::from_millis(100)));
            }
        }
        if !did_work {
            loop {
                let pause = lock(&shared.maintenance).empty_cycle(Instant::now());
                if pause.is_zero() { break; }
                std::thread::sleep(pause.min(Duration::from_millis(100)));
            }
            let seq = lock(&shared.seq);
            if *seq == observed {
                drop(shared.committed.wait_timeout(seq, Duration::from_millis(100)).unwrap_or_else(|e| e.into_inner()));
            }
        }
    }
}

// Reset even when a debug/unwind request panics mid-drain. Engine poison
// recovery and durable work cursors retain the normal retry semantics.
struct Advancing<'a>(&'a Shared);
impl Drop for Advancing<'_> {
    fn drop(&mut self) {
        let mut state = lock(&self.0.maintenance);
        state.advancing = false;
        state.next = BulkKind::Delivery;
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
    // Serialize clock callers only. Background slices check advancing after
    // engine admission and skip during this synchronous drain.
    let advance = lock(&shared.maintenance).advance.clone();
    let _advance = lock(&advance);
    let _advancing = Advancing(shared);
    // @ref LLP 3000.007#20.12 — simulated time makes retries due without stealing a live worker's claim or viewer session.
    let advanced = (|| {
        // Match claims' engine-then-clock lock order: no claim can land
        // between shifting its lease and publishing the advanced clock.
        let mut engine = lock(&shared.engine);
        let before = crate::dev_clock_store::saved_boundaries(&engine);
        lock(&shared.maintenance).advancing = true;
        let mut clock = lock(&shared.clock);
        let mut next = clock.clone();
        let now = next.advance(milliseconds)?;
        engine.advance_worker_leases_at(milliseconds, clock.now()).map_err(|e| e.refusal())?;
        *clock = next;
        let offset = now - snapback4_core::now_ms();
        let message = format!("cumulative offset {offset:+}ms; lasts until restart{}", if crate::dev_clock_store::has_data(&engine) { "; use dev --fresh --port 4401 for isolated time tests (guide jobs)" } else { "" });
        Ok((now, offset, message, before))
    })();
    let (now, offset, message, before) = match advanced {
        Ok(result) => result,
        Err(error) => return respond(request, 400, json!({"denied":refusal_json(&error)})),
    };
    // @ref LLP 3000#contended-read-serving — a developer is awaiting this
    // request; synchronous clock-advance work intentionally keeps request QoS.
    match work(shared, true, 0) {
        Ok(work) => {
            let schedules = crate::dev_clock_store::schedule_report(&lock(&shared.engine), &before, &work.fired, now, shared.hold_schedules);
            respond(request, 200, json!({"now":now, "advancedMs":milliseconds, "offsetMs":offset, "message":message, "work":work, "schedules":schedules}))
        }
        // Time remains advanced if maintenance fails; callers must not
        // retry the advance blindly. The normal tick retries pending work.
        Err(error) => respond(request, 500, json!({"now":now, "advancedMs":milliseconds, "offsetMs":offset, "message":message, "denied":refusal_json(&error.refusal())})),
    }
}

/// `POST /dev/jobs/<job>` with `{"args":{..}}`: queue one run of a job as the
/// system on the dev clock and drive chunks until it is done or parked. This is
/// what `snapback4 run <job>` forwards to while dev owns the store.
pub(super) fn run_job(request: Request, shared: &Shared, name: &str, body: &str) {
    use snapback4_core::{JobState, error::Refusal, ir::ProgramKind, wire};
    let service_route=request.url().starts_with("/jobs/");
    let service=if service_route {
        match super::session_identity::principal_of(&request,shared) {
            Ok((principal,kind,snapback4_core::identity::SessionScope::Full)) if kind=="service" && principal.starts_with("service:") => Some(principal),
            _ => return respond(request,403,json!({"denied":refusal_json(&Refusal::new("E_AUTH","auth","triggering a deployed system job requires a full service token").guide("jobs"))})),
        }
    } else {
        if !shared.personas {return respond(request,403,json!({"denied":refusal_json(&Refusal::new("E_AUTH","auth","/dev/jobs is a development door; use run <job> --release <dir> with a service token").guide("jobs"))}));}
        None
    };
    let refuse = |request, status, refusal: Refusal| respond(request, status, json!({"denied":refusal_json(&refusal.guide("jobs"))}));
    let payload: serde_json::Value = match serde_json::from_str(if body.trim().is_empty() { "{}" } else { body }) {
        Ok(payload) => payload,
        Err(error) => return refuse(request, 400, Refusal::new("E_INPUT", "input", format!("the request body is not JSON: {error}; send {{\"args\":{{..}}}}"))),
    };
    if service_route && !shared.personas {crate::release_requests::Scope::admit(&shared.release_requests,||*lock(&shared.generation));}
    let program = lock(&shared.bound).programs.iter().find(|p| p.program.name == name).map(|p| p.program.clone());
    let program = match program {
        Some(program) if program.kind == ProgramKind::Job => program,
        Some(other) => return refuse(request, 404, Refusal::new("E_OP", "op", format!("{name} is a {}, not a job; queries are POST /q/<op>, mutations POST /m/<op>", other.kind.word()))),
        None => return respond(request, 404, json!({"denied":refusal_json(&super::dev_doors::stale(shared, Refusal::new("E_OP", "op", format!("unknown job {name}")).guide("jobs")))})),
    };
    if let Some(raw)=payload.get("args") && let Some(why)=super::dev_doors::persona_argument(shared,&program.args,raw) {return refuse(request,400,why);}
    let mut args = std::collections::BTreeMap::new();
    if let Some(fields) = payload.get("args").and_then(serde_json::Value::as_object) {
        for (field, value) in fields {
            let Some(kind) = program.args.get(field) else { return refuse(request, 400, Refusal::new("E_INPUT", "input", format!("{name} takes no argument {field}"))); };
            match wire::from_json(kind, value) {
                Ok(typed) => { args.insert(field.clone(), typed); }
                Err(why) => return refuse(request, 400, Refusal::new("E_INPUT", "input", format!("argument {field}: {why}"))),
            }
        }
    }
    let mut admitted=lock(&shared.engine);
    crate::release_requests::stamp(admitted.generation());
    if let Some(service)=&service {
        if let Err(why)=super::session_identity::mutation_authority(&request,shared,&admitted,service) {drop(admitted);return refuse(request,403,why);}
    }
    let queued=admitted.enqueue_job(name,args,shared.now());
    drop(admitted);
    crate::release_requests::executed();
    let id = match queued {
        Ok(id) => id,
        Err(error) => return respond(request, 400, json!({"denied":refusal_json(&error.refusal())})),
    };
    // FIFO: earlier queued runs finish first, as with `run` on a stopped store;
    // the background tick may run some chunks too, through the same engine.
    let run = loop {
        let current = {let engine=lock(&shared.engine);crate::release_requests::stamp(engine.generation());engine.job(&id)};
        match current {
            Ok(Some(run)) if matches!(run.state, JobState::Done | JobState::Parked) || crate::lifecycle::stopping() => break run,
            Ok(Some(_)) => {}
            Ok(None) => return respond(request, 500, json!({"denied":refusal_json(&RuntimeError::Store(format!("job {id} vanished")).refusal())})),
            Err(error) => return respond(request, 500, json!({"denied":refusal_json(&error.refusal())})),
        }
        let (chunk, logs) = engine_work(shared, |engine, budget| (engine.run_job_chunk_for(shared.now(), budget), engine.take_native_logs()));
        for line in logs { snapback4_core::diagnostic!("snapback4: native {line}"); }
        match chunk {
            Ok(Some(chunk)) if chunk.state == JobState::Parked && shared.personas => shared.refusals.job(&chunk),
            Ok(_) => {}
            Err(error) => return respond(request, 500, json!({"denied":refusal_json(&error.refusal())})),
        }
    };
    snapback4_core::diagnostic!("snapback4: job {} {} on request: {} chunk{}, {} row{} written", run.name, if run.state == JobState::Done { "done" } else { "parked" },
        run.chunks, if run.chunks == 1 { "" } else { "s" }, run.rows_written, if run.rows_written == 1 { "" } else { "s" });
    respond(request, 200, json!({ "job": run.name, "id": run.id, "state": run.state, "chunks": run.chunks, "chunkSize": run.chunk_size, "retries": run.retries, "heapPeak": run.heap_peak, "rowsWritten": run.rows_written, "error": run.error }));
}

pub(super) fn clock_status(request: Request, shared: &Shared) {
    if !shared.personas { return respond(request, 403, json!({"denied":refusal_json(&crate::dev_clock::release())})); }
    let result = (|| {
        let (epoch, reader) = shared.reader()?;
        let note = crate::dev_clock_store::ahead(&reader, shared.now());
        lock(&shared.readers).put(&epoch, reader.into_inner());
        note
    })();
    match result {
        Ok(note) => respond(request, 200, json!({"storeAhead":note})),
        Err(error) => respond(request, 500, json!({"denied":refusal_json(&error.refusal())})),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::tests::Host;

    #[test]
    fn aged_bulk_progresses_when_the_bulk_thread_never_runs() {
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
        // No bulk thread exists. Three aged ordinary opportunities
        // still visit every bulk class, including the queued job.
        for kind in [BulkKind::Delivery, BulkKind::Recount, BulkKind::Job] {
            assert_eq!(lock(&shared.maintenance).next, kind);
            let due = lock(&shared.maintenance).serviced + BULK_AGE;
            lock(&shared.maintenance).serviced = Instant::now() - BULK_AGE;
            promote_aged(shared, due);
        }
        assert_eq!(lock(&shared.maintenance).next, BulkKind::Delivery);
        assert_eq!(lock(&shared.engine).job(&job).unwrap().unwrap().state, snapback4_core::JobState::Done);
    }

    #[test]
    fn stalled_bulk_admission_does_not_stop_an_ordinary_expiry_slice() {
        stalled_bulk(false);
    }

    #[test]
    fn stalled_bulk_engine_owner_leaves_the_gate_free_and_ordinary_admission_queued() {
        stalled_bulk(true);
    }

    fn stalled_bulk(holding: bool) {
        let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(),
            "table rows:\n  until: time\n  expire at .until\n  public\n");
        let shared = host.shared.clone();
        lock(&shared.engine).seed_at([("rows".into(), snapback4_core::value::object([
            ("id", snapback4_core::Value::Id("expired".into())),
            ("until", snapback4_core::Value::Int(1)),
        ]))], 0).unwrap();
        // A real bulk slice is stopped inside engine.background(), either
        // before admission (engine free) or immediately after owning it.
        let (entered, resume) = shared.engine.pause_next_background(holding);
        let worker = shared.clone();
        let bulk = std::thread::Builder::new().name("bulk-maintenance".into()).spawn(move || {
            crate::thread_priority::maintenance();
            bulk_slice(&worker, false);
        }).unwrap();
        entered.recv_timeout(Duration::from_secs(5)).unwrap();
        let (sent, observed) = std::sync::mpsc::channel();
        let ordinary = shared.clone();
        let timely = std::thread::spawn(move || {
            // Ordinary can enter its coordination slice while bulk is stopped.
            drop(lock(&ordinary.maintenance));
            sent.send(None).unwrap();
            let expired = timely_engine_work(&ordinary, |engine, budget| engine.sweep_expired_for(ordinary.now(), 2_000, budget)).unwrap();
            sent.send(Some(expired)).unwrap();
        });
        observed.recv_timeout(Duration::from_secs(5)).expect("ordinary slice blocked on the bulk gate");
        if holding {
            let until = Instant::now() + Duration::from_secs(5);
            while !shared.engine.has_waiters() { assert!(Instant::now() < until, "ordinary did not reach engine admission"); std::thread::yield_now(); }
            assert!(observed.try_recv().is_err(), "an exclusive engine cannot run two chunks at once");
            resume.send(()).unwrap();
            assert_eq!(observed.recv_timeout(Duration::from_secs(5)).unwrap(), Some(1));
        } else {
            // The regression: complete real expiry before bulk can run again.
            assert_eq!(observed.recv_timeout(Duration::from_secs(5)).unwrap(), Some(1));
            resume.send(()).unwrap();
        }
        timely.join().unwrap(); bulk.join().unwrap();
        assert!(lock(&shared.engine).store().rows("rows").unwrap().is_empty());
    }

    #[test]
    fn pacing_does_not_charge_time_already_spent_off_cpu() {
        let clock = SliceClock::start();
        assert!(clock.cpu.is_some(), "supported hosts provide a thread CPU clock");
        std::thread::sleep(Duration::from_millis(30));
        assert!(clock.consumed() < clock.wall.elapsed() / 2, "pacing charged the sleep as CPU work");
    }

    #[test]
    fn pacing_charges_atomic_overruns_but_cannot_suppress_aged_service() {
        for (elapsed, expected) in [(Duration::from_micros(10), Duration::from_micros(70)),
            (Duration::from_micros(250), Duration::from_micros(1750)),
            (Duration::from_millis(50), Duration::from_millis(100))] {
            let mut state = State::default();
            let now = state.resume_at;
            state.completed(now, elapsed, true, true);
            assert_eq!(state.resume_at - now, expected);
            assert!(!state.eligible(now, false));
            assert!(state.eligible(now + BULK_AGE, true));
        }
        let mut state = State::default();
        let now = state.resume_at;
        state.completed(now, WORK_TIME, false, true);
        assert!(state.eligible(now, false));
    }

    #[test]
    fn empty_kinds_repay_cpu_with_useful_work_or_before_idle_wait() {
        let mut state = State::default();
        let now = state.resume_at;
        state.completed(now, Duration::from_micros(10), true, false);
        state.completed(now, Duration::from_micros(20), true, false);
        assert!(state.eligible(now, false));
        state.completed(now, Duration::from_micros(250), true, true);
        assert_eq!(state.resume_at - now, Duration::from_micros(1960));
        assert_eq!(state.empty_pause, Duration::ZERO);
        assert!(state.eligible(now + BULK_AGE, true));

        let now = now + BULK_AGE;
        for _ in 0..3 { state.completed(now, Duration::from_micros(10), true, false); }
        assert_eq!(state.empty_cycle(now), Duration::from_micros(210));
        assert!(!state.eligible(now, false));
        assert_eq!(state.empty_pause, Duration::ZERO);
        assert!(state.eligible(now + BULK_AGE, true));
    }

    #[test]
    fn deferred_empty_cpu_keeps_each_capped_charge_without_longer_pauses() {
        let mut state = State::default();
        let now = state.resume_at;
        state.completed(now, Duration::from_millis(10), true, false);
        assert_eq!(state.empty_pause, Duration::from_millis(70));
        state.completed(now, Duration::from_millis(10), true, false);
        assert_eq!(state.resume_at - now, Duration::from_millis(100));
        assert_eq!(state.empty_pause, Duration::from_millis(40));
        let now = now + Duration::from_millis(100);
        state.completed(now, Duration::from_millis(50), true, true);
        assert_eq!(state.resume_at - now, Duration::from_millis(100));
        assert_eq!(state.empty_pause, Duration::from_millis(40));
        // 70 + 70 + capped(350) = 240 ms, paid as 100 + 100 + 40.
        assert_eq!(state.empty_cycle(now + Duration::from_millis(100)), Duration::from_millis(40));
        assert_eq!(state.empty_pause, Duration::ZERO);

        let now = now + BULK_AGE;
        state.completed(now, Duration::from_millis(10), true, false);
        state.completed(now, Duration::from_millis(50), true, true);
        // An empty-cycle check can race a timed worker's new 100 ms pause.
        // After 40 ms, 60 ms scheduled + 70 ms deferred must still be paid.
        assert_eq!(state.empty_cycle(now + Duration::from_millis(40)), Duration::from_millis(130));
        assert_eq!(state.empty_cycle(now + Duration::from_millis(140)), Duration::from_millis(30));
        assert_eq!(state.empty_cycle(now + Duration::from_millis(170)), Duration::ZERO);
    }

    #[test]
    fn slice_completion_preserves_an_empty_cycles_outstanding_repayment() {
        for worked in [true, false] {
            let mut state = State::default();
            let now = state.resume_at;
            state.completed(now, Duration::from_millis(10), true, false);
            // The aged worker starts a slice, then bulk flushes deferred debt.
            assert_eq!(state.empty_cycle(now), Duration::from_millis(70));
            let completed = now + Duration::from_millis(10);
            state.completed(completed, Duration::from_millis(10), true, worked);
            // Useful work repays immediately; empty work defers its charge.
            // Neither ordering can discard the 60 ms already outstanding.
            assert_eq!(state.resume_at - completed,
                Duration::from_millis(if worked { 130 } else { 60 }));
            assert_eq!(state.empty_cycle(completed), Duration::from_millis(130));
            assert!(!state.eligible(now + Duration::from_millis(139), false));
            assert!(state.eligible(now + Duration::from_millis(140), false));
            assert!(state.eligible(completed + BULK_AGE, true));
        }
    }

    #[test]
    fn clock_drain_unwind_releases_background_work() {
        let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), "table rows:\n  n: int\n  public\n");
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _advancing = Advancing(&host.shared);
            lock(&host.shared.maintenance).advancing = true;
            assert_eq!(timely_engine_work(&host.shared, |_, _| -> Result<u64, RuntimeError> { panic!("ordinary slice ran during drain") }).unwrap(), 0);
            assert!(!bulk_slice(&host.shared, false));
            panic!("clock drain");
        }));
        assert!(result.is_err());
        assert!(lock(&host.shared.maintenance).eligible(Instant::now(), false));
    }
}
