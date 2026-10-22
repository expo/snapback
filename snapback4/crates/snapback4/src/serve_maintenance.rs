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
    work_at(shared, drain, tick, None)
}

fn work_at(shared: &Shared, drain: bool, tick: u64, schedule_sample: Option<i64>) -> Result<Work, RuntimeError> {
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
        let fired = phase(shared, engine_work(shared, |engine, _| {
            // @ref LLP 3000.007#20.12.2 — select advance windows before draining; admission deadlines still use the live advanced clock.
            if let Some(sample) = schedule_sample {
                let windows = engine.schema().schedules.iter().enumerate().map(|(index, schedule)| (index, schedule.boundary(sample))).collect::<Vec<_>>();
                let mut fired = Vec::new();
                for (index, boundary) in windows { fired.extend(engine.fire_schedule_boundary_at(shared.now(), index, boundary)?); }
                Ok(fired)
            } else { engine.fire_schedules(shared.now()) }
        }), drain, "schedules")?;
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
    // Explicit mutation-boundary tests pause all background maintenance until drain.
    paused: bool,
    // Separate clock callers (and a dev reset) may wait here; maintenance never takes this lock.
    pub(super) advance: Arc<std::sync::Mutex<()>>,
}
impl Default for State {
    fn default() -> Self {
        let now = Instant::now();
        Self { next: BulkKind::Delivery, serviced: now, resume_at: now, empty_pause: Duration::ZERO,
            advancing: false, paused: false, advance: Arc::new(std::sync::Mutex::new(())) }
    }
}
impl State {
    fn aged(&self, now: Instant) -> bool { now.saturating_duration_since(self.serviced) >= BULK_AGE }
    fn eligible(&self, now: Instant, aged_only: bool) -> bool {
        !self.advancing && !self.paused && if aged_only { self.aged(now) } else { now >= self.resume_at }
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
        if { let state = lock(&shared.maintenance); state.advancing || state.paused } { return Ok(T::default()); }
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
            if !state.advancing && !state.paused && let Err(error) = shared.ephemeral.sweep(shared.now()) { snapback4_core::diagnostic!("snapback4: ephemeral sweep: {error}"); }
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

fn completed_drain(work: Work, stopping: bool) -> Result<Work, snapback4_core::Refusal> {
    if stopping {
        return Err(snapback4_core::Refusal::new("E_CLOCK_INTERRUPTED", "clock", "clock advanced, but host shutdown interrupted the drain; inspect queued work instead of repeating the advance").guide("clock"));
    }
    Ok(work)
}

// @ref LLP 3000.000.000.002#4-staging-clock — staging grants clock control, never fixture or persona authority.
pub(super) fn staging(shared: &Shared) -> bool {
    lock(&shared.engine).store().deployment_environment().ok().flatten().as_deref() == Some("staging")
}
fn clock_service(request: &Request, shared: &Shared) -> Result<Option<String>, snapback4_core::Refusal> {
    if shared.personas { return Ok(None); }
    if !staging(shared) { return Err(crate::dev_clock::release()); }
    match super::session_identity::principal_of(request,shared) {
        Ok((principal,kind,snapback4_core::identity::SessionScope::Full)) if kind == "service" && principal.starts_with("service:") => Ok(Some(principal)),
        _ => Err(snapback4_core::Refusal::new("E_AUTH", "auth", "staging clock control requires a full service token").guide("clock")),
    }
}
pub(super) fn advance(request: Request, shared: &Shared, body: &str) {
    let service = match clock_service(&request, shared) {
        Ok(service) => service,
        Err(why) => return respond(request,403,json!({"denied":refusal_json(&why)})),
    };
    let payload = match serde_json::from_str::<serde_json::Value>(body) {
        Ok(payload) => payload,
        Err(_) => return respond(request, 400, json!({"denied":refusal_json(&crate::dev_clock::input("clock advance takes {\"duration\":\"+2m\"}"))})),
    };
    let each_boundary = match payload.get("eachBoundary") {
        None => false,
        Some(serde_json::Value::Bool(value)) => *value,
        Some(_) => return respond(request, 400, json!({"denied":refusal_json(&crate::dev_clock::input("eachBoundary must be a boolean"))})),
    };
    let boolean = |key: &str, default: bool| -> Result<bool, snapback4_core::Refusal> {
        match payload.get(key) {
            None => Ok(default), Some(serde_json::Value::Bool(value)) => Ok(*value),
            Some(_) => Err(crate::dev_clock::input(format!("{key} must be a boolean"))),
        }
    };
    let (drain, allow_held) = match boolean("drain", true).and_then(|drain| Ok((drain, boolean("allowHeld", false)?))) {
        Ok(options) => options,
        Err(error) => return respond(request, 400, json!({"denied":refusal_json(&error)})),
    };
    if each_boundary && !drain { return respond(request, 400, json!({"denied":refusal_json(&crate::dev_clock::input("eachBoundary requires drain:true"))})); }
    let preserve_sessions = match payload.get("sessions").and_then(|s| s.as_str()) {
        None if payload.get("sessions").is_none() => !shared.personas,
        Some("preserve") if !shared.personas => true,
        Some("expire") => false,
        _ => return respond(request, 400, json!({"denied":refusal_json(&crate::dev_clock::input("sessions must be preserve (staging only) or expire"))})),
    };
    let duration = payload.get("duration").and_then(|value| value.as_str());
    let milliseconds = match duration.ok_or_else(|| crate::dev_clock::input("clock advance takes {\"duration\":\"+2m\"}"))
        .and_then(|duration| if duration == "0ms" && drain { Ok(0) } else { crate::dev_clock::duration(duration) }) {
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
        if let Some(principal) = &service {
            if engine.store().deployment_environment().map_err(|e|e.refusal())?.as_deref() != Some("staging") { return Err(crate::dev_clock::release()); }
            super::session_identity::mutation_authority(&request,shared,&engine,principal)?;
        } else { shared.dev_authority(&engine)?; }
        let mut clock = lock(&shared.clock);
        let floor = shared.time_audience_clock.load(std::sync::atomic::Ordering::Acquire);
        let effective_before = clock.now().max(floor);
        let mut next = clock.clone();
        let now = (if milliseconds == 0 { next.now() } else { next.advance(milliseconds)? }).max(floor);
        // @ref LLP 3000.000.000.001#11-wave-22-loop-repairs-dx6 — refuse a saved boundary before any clock/session effect.
        if drain && !allow_held && !shared.hold_schedules {
            crate::dev_clock_store::refuse_held(&engine, &before, now)?;
        }
        let boundaries = crate::dev_clock_store::crossed_boundaries(&engine, &before, now, shared.hold_schedules || !drain, each_boundary)?;
        lock(&shared.maintenance).advancing = true;
        if !shared.personas {
            // @ref LLP 3000.000.000.001#11-wave-22-loop-repairs-dx6 — a retained disclosure floor is also the credential authority clock.
            // A raw jump below that floor advances no business time and cannot
            // extend credentials or leases. Selection must never see an older
            // raw process time and revive an already expired family.
            let effective_delta = now.checked_sub(effective_before)
                .ok_or_else(|| crate::dev_clock::input("effective clock advance overflow"))?;
            if milliseconds > 0 && effective_delta > 0 { engine.advance_staging_clock_at(effective_delta, effective_before, preserve_sessions).map_err(|e|e.refusal())?; }
        } else if milliseconds > 0 {
            engine.advance_worker_leases_at(milliseconds, clock.now()).map_err(|e|e.refusal())?;
        }
        lock(&shared.maintenance).paused = true;
        *clock = next;
        let offset = clock.offset();
        let skew = now - snapback4_core::now_ms();
        let isolated = if crate::dev_clock_store::has_data(&engine) {
            format!("; use {} for isolated time tests; clock advance --port N targets its printed port (guide jobs)", crate::dev_clock::isolated_command())
        } else { String::new() };
        let message = format!("cumulative offset {offset:+}ms (requested process offset; now includes the authoritative floor); process offset lasts until restart{isolated}");
        Ok((now, offset, skew, message, before, boundaries))
    })();
    let (now, offset, skew, message, before, boundaries) = match advanced {
        Ok(result) => result,
        Err(error) => return respond(request, 400, json!({"denied":refusal_json(&error)})),
    };
    // @ref LLP 3000#contended-read-serving — a developer is awaiting this
    // request; synchronous clock-advance work intentionally keeps request QoS.
    let drained = (|| {
        if !drain { return Ok(Work::default()); }
        let mut crossed = Vec::new();
        if each_boundary {
            for (index, at) in boundaries {
                crossed.extend(engine_work(shared, |engine, _| engine.fire_schedule_boundary_at(shared.now(), index, at))?);
            }
        }
        let mut work = work_at(shared, true, 0, Some(now))?;
        work.schedules += crossed.len();
        work.fired.extend(crossed);
        Ok::<_, RuntimeError>(work)
    })();
    match drained.map_err(|error| error.refusal()).and_then(|work| completed_drain(work, crate::lifecycle::stopping())) {
        Ok(work) => {
            lock(&shared.maintenance).paused = !drain;
            let schedules = crate::dev_clock_store::schedule_report(&lock(&shared.engine), &before, &work.fired, now, shared.hold_schedules || !drain, each_boundary, shared.dev_identity.as_ref().map(|i| i.address.port()));
            let (fired, held) = crate::dev_clock_store::outcomes(&schedules);
            respond(request, 200, json!({"now":now, "advancedMs":milliseconds, "sessionNotice":if preserve_sessions { crate::dev_clock::PRESERVED_SESSION_NOTICE } else { crate::dev_clock::SESSION_NOTICE }, "maintenancePaused":!drain, "sessionsPreserved":preserve_sessions, "offsetMs":offset, "skewMs":skew, "eachBoundary":each_boundary, "message":message, "work":work, "schedules":schedules, "fired":fired, "held":held}))
        }
        // Time remains advanced on failure. Stay paused until an explicit drain;
        // never retry an ambiguous advance to resume pending work.
        Err(error) => {
            let engine = lock(&shared.engine);
            let after = crate::dev_clock_store::saved_boundaries(&engine);
            let fired: Vec<_> = engine.schema().schedules.iter().enumerate().filter(|(i, _)| {
                matches!((before.get(*i).copied().flatten(), after.get(*i).copied().flatten()), (Some(old), Some(new)) if new > old)
            }).map(|(_, schedule)| schedule.name.clone()).collect();
            let mut schedules = crate::dev_clock_store::schedule_report(&engine, &before, &fired, now, shared.hold_schedules || !drain, each_boundary, shared.dev_identity.as_ref().map(|i| i.address.port()));
            for (index, schedule) in schedules.iter_mut().enumerate() {
                if schedule["fired"] != true && !shared.hold_schedules && before.get(index).copied().flatten().is_some_and(|old| old < engine.schema().schedules[index].boundary(now)) {
                    schedule["holdCode"] = "maintenance-failed".into();
                    schedule["reason"] = "clock advanced but maintenance stopped before this due boundary was queued; inspect clock and queued jobs before continuing; do not replay the advance".into();
                }
            }
            let (fired, held) = crate::dev_clock_store::outcomes(&schedules);
            respond(request, 500, json!({"now":now, "advancedMs":milliseconds, "sessionNotice":if preserve_sessions { crate::dev_clock::PRESERVED_SESSION_NOTICE } else { crate::dev_clock::SESSION_NOTICE }, "maintenancePaused":true, "sessionsPreserved":preserve_sessions, "offsetMs":offset, "skewMs":skew, "eachBoundary":each_boundary, "message":message, "schedules":schedules, "fired":fired, "held":held, "reportIncomplete":true, "denied":refusal_json(&error)}))
        },
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
    if !service_route && let Err(why) = shared.dev_authority(&admitted) { drop(admitted); return refuse(request,403,why); }
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
    if let Err(why) = clock_service(&request, shared) { return respond(request,403,json!({"denied":refusal_json(&why)})); }
    let result = (|| {
        let (epoch, reader) = shared.reader()?;
        let note = crate::dev_clock_store::ahead(&reader, shared.now());
        lock(&shared.readers).put(&epoch, reader.into_inner());
        note
    })();
    match result {
        Ok(note) => { let now = shared.now(); respond(request, 200, json!({"storeAhead":note,"now":now,"skewMs":now - snapback4_core::now_ms()})) },
        Err(error) => respond(request, 500, json!({"denied":refusal_json(&error.refusal())})),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::tests::Host;

    #[test]
    fn dx6_staging_preservation_uses_effective_time_above_the_disclosure_floor() {
        let store = snapback4_core::store_port::AnyStore::memory().unwrap();
        store.set_deployment_environment("staging").unwrap();
        let host = Host::with_store(false, store, "use identity\ntable timed:\n  opens: time\n  not before .opens\n  public 'fixture'\n  online only\nquery clock():\n  return now\neffect notify\nmutation queue():\n  emit notify {}\n");
        let store_id = lock(&host.shared.engine).store().store_identity().unwrap().unwrap();
        let raw = snapback4_core::now_ms() + 1_000;
        let floor = raw + 10_000;
        lock(&host.shared.clock).freeze(raw);
        host.shared.time_audience_clock.store(floor, std::sync::atomic::Ordering::Release);
        let (service, live, expired) = {
            let mut engine = lock(&host.shared.engine);
            let service = snapback4_core::identity::service_session(engine.store(), "clock", floor, 1).unwrap();
            // Construct boundary credentials through the existing identity port;
            // backdating their one-day mint gives exact expiry without raw SQL.
            let day = 86_400_000;
            let live = snapback4_core::identity::custom_session(engine.store(), "member:live", "member", floor + 500 - day, 1).unwrap();
            let expired = snapback4_core::identity::custom_session(engine.store(), "member:expired", "member", floor - 500 - day, 1).unwrap();
            let queued = engine.mutate("queue", None, snapback4_core::Context::new("member:live", Default::default()).at(floor)).unwrap();
            assert!(matches!(queued.state, snapback4_core::WriteState::Sent { .. }));
            let claimed = engine.claim_effects("service:worker", None, 1, 3_000, floor).unwrap();
            assert_eq!(claimed.len(), 1);
            assert_eq!(claimed[0].lease_until, Some(floor + 3_000));
            (service, live, expired)
        };
        let headers = format!("Authorization: Bearer {}\r\n", service.token);
        let advance = |duration: &str| {
            let payload = json!({"duration":duration,"drain":false}).to_string();
            let reply = super::super::tests::exchange(host.address, &format!("POST /dev/clock/advance HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n{payload}", payload.len()));
            assert_eq!(super::super::tests::status(&reply), 200, "{reply}");
            super::super::tests::body(&reply)
        };
        for _ in 0..2 {
            assert_eq!(advance("4s")["now"], floor);
            let engine = lock(&host.shared.engine);
            assert!(snapback4_core::identity::resolve_read_only(engine.store(), &expired.token, floor, Some(&store_id)).unwrap().is_none());
            let timing = engine.staging_session_timing(&live.token, floor, &store_id).unwrap().unwrap();
            assert_eq!(timing.expires_at, floor + 500, "below-floor jumps preserve the exact remaining time");
            let held = engine.effects(Some("running"), 1).unwrap();
            assert_eq!(held.len(), 1);
            assert_eq!(held[0].lease_until, Some(floor + 3_000));
        }
        // Raw time has advanced eight seconds. Crossing the ten-second floor
        // with three more seconds advances effective authority by only one.
        assert_eq!(advance("3s")["now"],floor+1_000);
        let engine = lock(&host.shared.engine);
        assert!(snapback4_core::identity::resolve_read_only(engine.store(), &expired.token, floor+1_000, Some(&store_id)).unwrap().is_none());
        assert!(snapback4_core::identity::resolve_read_only(engine.store(), &live.token, floor+1_000, Some(&store_id)).unwrap().is_some());
        let timing = engine.staging_session_timing(&live.token, floor + 1_000, &store_id).unwrap().unwrap();
        assert_eq!(timing.expires_at, floor + 1_500, "exactly the original 500ms remains");
        assert!(engine.staging_session_timing(&expired.token, floor + 1_000, &store_id).unwrap().is_none(), "an expired token never shifts back to life");
        let held = engine.effects(Some("running"), 1).unwrap();
        assert_eq!(held.len(), 1);
        assert_eq!(held[0].lease_until, Some(floor + 4_000), "leases shift by effective elapsed time once");
    }

    #[test]
    fn kit4_slow_advance_reports_only_windows_it_actually_admitted() {
        for each_boundary in [false, true] {
            let host = Host::with_store(true, snapback4_core::store_port::AnyStore::memory().unwrap(),
                "table rows:\n  n: int\n  cap 1\n  public 'fixture'\njob tick():\n  for row in rows:\n    update rows[row.id] {n:1}\nschedule pulse every 1m: tick\n");
            let shared = host.shared.clone();
            let initial = (snapback4_core::now_ms().div_euclid(60_000) + 2) * 60_000 - 100;
            lock(&shared.clock).freeze(initial);
            lock(&shared.engine).fire_schedules(shared.now()).unwrap();
            let (entered, resume) = shared.engine.pause_next_background(false);
            let address = host.address;
            let client = std::thread::spawn(move || {
                let payload = json!({"duration":"100ms", "eachBoundary":each_boundary}).to_string();
                super::super::tests::exchange(address, &format!("POST /dev/clock/advance HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{payload}", payload.len()))
            });
            entered.recv_timeout(Duration::from_secs(5)).unwrap();
            // Model two minutes elapsing during the paused drain, without a real sleep.
            let later = shared.now() + 120_000;
            lock(&shared.clock).freeze(later);
            resume.send(()).unwrap();
            let response = client.join().unwrap();
            assert_eq!(super::super::tests::status(&response), 200, "{response}");
            let reply = super::super::tests::body(&response);
            let windows = reply["schedules"][0]["firedWindows"].as_array().unwrap();
            assert!(windows.iter().all(|window| window["periodEnd"].as_i64().unwrap() <= reply["now"].as_i64().unwrap()), "{reply}");
            let jobs: i64 = (match lock(&shared.engine).store() { snapback4_core::store_port::AnyStore::Sqlite(inner) => inner }).job_count().unwrap();
            assert_eq!(windows.len() as i64, jobs, "the report must not invent coalesced intermediate windows: {reply}");
            assert_eq!(reply["work"]["schedules"], json!(jobs));
            if !each_boundary { assert_eq!(jobs, 1); }
        }
    }

    #[test]
    fn kit4_clock_reply_samples_skew_before_a_delayed_drain() {
        let host = Host::with_store(true, snapback4_core::store_port::AnyStore::memory().unwrap(),
            "use personas alice\nquery time():\n  return now\n");
        let shared = host.shared.clone();
        let (entered, resume) = shared.engine.pause_next_background(false);
        let address = host.address;
        let client = std::thread::spawn(move || {
            let payload = r#"{"duration":"1m"}"#;
            super::super::tests::exchange(address, &format!("POST /dev/clock/advance HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{payload}", payload.len()))
        });
        entered.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(lock(&shared.clock).offset(), 60_000);
        std::thread::sleep(Duration::from_millis(500));
        resume.send(()).unwrap();
        let response = client.join().unwrap();
        assert_eq!(super::super::tests::status(&response), 200, "{response}");
        let reply = super::super::tests::body(&response);
        assert_eq!(reply["offsetMs"], 60_000);
        assert!((reply["skewMs"].as_i64().unwrap() - 60_000).abs() < 200, "{reply}");
    }

    #[test]
    fn kit3_interrupted_clock_drain_refuses_with_clock_evidence_and_queued_work() {
        const CHILD: &str = "SNAPBACK4_KIT3_DRAIN_CHILD";
        if std::env::var_os(CHILD).is_none() {
            let result = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "serve::maintenance::tests::kit3_interrupted_clock_drain_refuses_with_clock_evidence_and_queued_work", "--nocapture"])
                .env(CHILD, "1").output().unwrap();
            assert!(result.status.success(), "{}{}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));
            return;
        }
        // Signal state is isolated in this one-test child, never the suite.
        crate::lifecycle::install("dev").unwrap(); crate::lifecycle::managed_cleanup();
        let host = Host::with_store(true, snapback4_core::store_port::AnyStore::memory().unwrap(),
            "use personas alice\ntable rows:\n  n: int\n  public 'fixture'\njob tick():\n  for row in rows:\n    update rows[row.id] {n:1}\n");
        let shared = host.shared.clone();
        let before = shared.now();
        let id = lock(&shared.engine).enqueue_job("tick", Default::default(), before).unwrap();
        let (entered, resume) = shared.engine.pause_next_background(false);
        let address = host.address;
        let client = std::thread::spawn(move || {
            let payload = r#"{"duration":"1m"}"#;
            super::super::tests::exchange(address, &format!("POST /dev/clock/advance HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{payload}", payload.len()))
        });
        entered.recv_timeout(Duration::from_secs(5)).unwrap();
        unsafe { libc::raise(libc::SIGTERM); }
        resume.send(()).unwrap();
        let response = client.join().unwrap();
        assert_eq!(super::super::tests::status(&response), 500, "{response}");
        let reply = super::super::tests::body(&response);
        assert_eq!(reply["denied"]["code"], "E_CLOCK_INTERRUPTED", "{reply}");
        assert_eq!(reply["maintenancePaused"], true, "failed drains stay paused");
        assert!(lock(&shared.maintenance).paused);
        timely(&shared, 0).unwrap();
        assert!(!lock(&shared.maintenance).eligible(Instant::now() + BULK_AGE, false));
        assert!(reply["now"].as_i64().unwrap() >= before+60_000 && reply["skewMs"].is_i64());
        assert_eq!(lock(&shared.engine).job(&id).unwrap().unwrap().state, snapback4_core::JobState::Queued);
    }

    #[test]
    fn aged_bulk_progresses_when_the_bulk_thread_never_runs() {
        let host = Host::with_store(true, snapback4_core::store_port::AnyStore::memory().unwrap(),
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
        let host = Host::with_store(true, snapback4_core::store_port::AnyStore::memory().unwrap(),
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
        let host = Host::with_store(true, snapback4_core::store_port::AnyStore::memory().unwrap(), "table rows:\n  n: int\n  public\n");
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
