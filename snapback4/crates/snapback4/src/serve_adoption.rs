//! Keep a refused dev adoption pending until the writer can adopt it.
use super::{Shared, lock};
use crate::project::Project;
use snapback4_core::RuntimeError;
use std::{sync::Arc, time::{Duration, Instant}};

fn locked(error: &RuntimeError) -> bool {
    matches!(error,
        RuntimeError::Sql(sql) if matches!(sql.sqlite_error_code(), Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked)))
}

fn retryable(error: &RuntimeError) -> bool { locked(error) || matches!(error, RuntimeError::Generation(_)) }

pub(super) fn open(project: &Project, bound: &snapback4_lang::Bound, clock: &crate::dev_clock::Clock) -> Result<snapback4_core::Engine, RuntimeError> {
    let mut reported = None;
    loop {
        match project.open_engine_at(bound, clock.now()) {
            Ok(engine) => return Ok(engine),
            Err(error) if locked(&error) && !crate::lifecycle::stopping() => {
                let reason = error.to_string();
                if reported.as_ref() != Some(&reason) {
                    eprintln!("snapback4 dev: startup schema adoption failed: {reason}; no requests, jobs or sweeps are running; retrying automatically");
                    reported = Some(reason);
                }
                std::thread::sleep(Duration::from_millis(400));
            }
            Err(error) => return Err(error),
        }
    }
}

const BACKGROUND_WINDOW: Duration = Duration::from_secs(60);
const BACKGROUND_BURST: u8 = 2;

struct Background {
    message: String,
    window: Instant,
    emitted: u8,
}

pub(super) struct Status {
    pub store_id: String,
    pub failure: Option<String>,
    background: [Option<Background>; 2],
    suppressed: u64,
    retrying: bool,
}
impl Status {
    pub fn new(store_id: String) -> Self { Self { store_id, failure: None, background: [None, None], suppressed: 0, retrying: false } }
    fn recovery(&self) -> &str { if self.retrying { "retrying automatically" } else { "fix the schema and save again" } }
    pub(super) fn refused(&mut self, error: &RuntimeError, generation: u64) {
        let reason = error.to_string();
        self.retrying = retryable(error);
        if self.failure.as_ref() != Some(&reason) {
            if let Some(line) = self.reset_background("adoption failure changed") { eprintln!("{line}"); }
            eprintln!("snapback4 dev: the new schema was not adopted: {reason}; serving generation {generation}; jobs and sweeps may fail until adoption succeeds; {}", self.recovery());
            self.failure = Some(reason);
        }
    }
    pub(super) fn background_failure(&mut self, name: &str, error: &RuntimeError) -> Option<String> {
        self.background_failure_at(name, error, Instant::now())
    }
    pub(super) fn background_failure_at(&mut self, name: &str, error: &RuntimeError, now: Instant) -> Option<String> {
        let slot = match error.code().as_str() { "E_STORE" => Some(0), "E_GENERATION" => Some(1), _ => None };
        if let Some(slot) = slot && let Some(reason) = &self.failure {
            // @ref LLP 3000#7 — keep adoption consequences visible without flooding background logs.
            // Two changed reasons per code per minute; identical repeats stay quiet
            // even after the window expires. Suppressed calls never extend the window.
            let error = error.to_string();
            if let Some(background) = &mut self.background[slot] {
                if background.message == error || (now.duration_since(background.window) < BACKGROUND_WINDOW && background.emitted >= BACKGROUND_BURST) {
                    self.suppressed = self.suppressed.saturating_add(1);
                    return None;
                }
                if now.duration_since(background.window) >= BACKGROUND_WINDOW {
                    background.window = now;
                    background.emitted = 0;
                }
                background.message = error.clone();
                background.emitted += 1;
            } else {
                self.background[slot] = Some(Background { message: error.clone(), window: now, emitted: 1 });
            }
            let line = format!("snapback4: {name} failed: {error}; adoption still pending: {reason}; jobs and sweeps may fail until adoption succeeds; {}", self.recovery());
            Some(line)
        } else { Some(format!("snapback4: {name} failed: {error}")) }
    }

    pub(super) fn recovered(&mut self) -> Option<String> {
        self.failure = None;
        self.retrying = false;
        self.reset_background("adoption recovered")
    }

    fn reset_background(&mut self, reason: &str) -> Option<String> {
        self.background = [None, None];
        let count = std::mem::take(&mut self.suppressed);
        (count > 0).then(|| format!("snapback4 dev: {reason}; suppressed {count} repeated background failures"))
    }
}

pub(super) fn background_failure(shared: &Shared, name: &str, error: &RuntimeError) {
    if let Some(line) = lock(&shared.adoption).background_failure(name, error) { eprintln!("{line}"); }
}

pub(super) fn watch_sources(project: Project, shared: Arc<Shared>, mut stamp: crate::project::SourceStamp, verbose: bool) {
    let mut retry = false;
    let mut seen_generation = *lock(&shared.generation);
    loop {
        std::thread::sleep(Duration::from_millis(400));
        if crate::lifecycle::stopping() { return; }
        let now = project.sources_stamp();
        let stored_generation = {
            let engine = lock(&shared.engine);
            engine.store().meta("generation").ok().flatten().and_then(|s| s.parse::<u64>().ok()).unwrap_or(seen_generation)
        };
        if now == stamp && !retry && stored_generation == seen_generation {
            continue;
        }
        stamp = now;
        seen_generation = stored_generation;
        retry = false;
        let started = Instant::now();
        match project.compile() {
            Ok(bound) if bound.diagnostics.is_empty() => {
                let rebuilt = match crate::native::build(&project, &bound) {
                    Ok(built) => built,
                    Err(problem) => {
                        eprintln!("snapback4 dev: {problem}\nsnapback4 dev: serving the previous generation");
                        continue;
                    }
                };
                let residency_notes = snapback4_lang::bind::residency::change_notes(&bound, &lock(&shared.bound).schema.operations);
                let steps = snapback4_core::successor::classify(&lock(&shared.bound).schema, &bound.schema);
                let worst = snapback4_core::successor::worst(&steps);
                let generated = match project.write_generated(&bound) {
                    Ok(generated) => generated,
                    Err(error) => {
                        eprintln!("snapback4 dev: cannot write generated types: {error}\nsnapback4 dev: serving the previous generation");
                        continue;
                    }
                };
                if let Err(error) = project.check_server_at(&mut stamp) {
                    eprintln!("snapback4 dev: {error}\nsnapback4 dev: serving the previous generation");
                    continue;
                }
                if crate::dev_worker::source(&project).is_some() {
                    if let Err(error) = crate::dev_worker::validate_environment(&bound.schema) {
                        eprintln!("snapback4 dev: {error}\nsnapback4 dev: serving the previous generation");
                        continue;
                    }
                }
                let mut engine = lock(&shared.engine);
                // @ref LLP 3000.007#18.3 — retries judge the persisted successor, retaining the generation lock.
                // Reopen only after the generation guard refuses this owner. Adoption
                // still judges the latest stored successor in its own transaction.
                let adopted = engine.adopt_at(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone()), shared.now());
                let mut reopened = false;
                let adopted = match adopted {
                    Err(RuntimeError::Generation(_)) => project.open_engine_at(&bound, shared.now()).and_then(|mut next| {
                        next.share_ephemeral_hub(shared.ephemeral.clone())?;
                        next.set_presence(Some(shared.presence.clone()));
                        *engine = next;
                        reopened = true;
                        Ok(engine.generation())
                    }),
                    other => other,
                };
                match adopted {
                    Ok(next) => {
                        seen_generation = next;
                        if let Some(line) = lock(&shared.adoption).recovered() { eprintln!("{line}"); }
                        crate::lifecycle::generation(next);
                        lock(&shared.readers).invalidate();
                        if reopened || rebuilt.is_some() {
                            match crate::native::install(&mut engine, &project) {
                                Ok(installed) => {
                                    *lock(&shared.native) = installed;
                                    if let Some(built) = &rebuilt { eprintln!("snapback4 dev: native module rebuilt ({} B, {} ms): {}", built.bytes, built.ms, built.jobs.join(", ")); }
                                }
                                Err(problem) => eprintln!("snapback4 dev: {problem}"),
                            }
                        }
                        // Publish the advertised backend and identity together:
                        // /schema takes these guards in the same order.
                        let mut active = lock(&shared.bound);
                        let mut generation = lock(&shared.generation);
                        for note in &residency_notes { eprintln!("note: {note}"); }
                        for note in &bound.notes { eprintln!("note: {note}"); }
                        *active = bound;
                        *generation = next;
                        // Claims authenticate their supervisor revision while
                        // holding this engine guard: the old child cannot
                        // claim new work during the supervisor's stop delay.
                        shared.worker_revision.fetch_add(1, std::sync::atomic::Ordering::Release);
                        eprintln!("snapback4 dev: schema adopted as generation {} ({:?}) in {} ms; types: {}", *generation, worst, started.elapsed().as_millis(), generated.display());
                        for step in steps {
                            eprintln!("  {:?}: {}", step.change, step.message);
                        }
                        // Adoption can itself commit a populated maintain rebuild.
                        shared.publish_engine(&engine);
                    }
                    Err(error) => {
                        retry = retryable(&error);
                        lock(&shared.adoption).refused(&error, engine.generation());
                    }
                }
            }
            Ok(bound) => {
                crate::verbs::report_problems(&bound, "snapback4 dev", " in snapback/; serving the previous generation", true, verbose);
            }
            Err(error) => eprintln!("snapback4 dev: cannot read snapback/: {error}"),
        }
    }
}
