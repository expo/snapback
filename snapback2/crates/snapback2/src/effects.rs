//! The owner-side effects runner. Every durable operation crosses the writer
//! channel; the Hermes host remains owned by this one runner thread.
// @ref LLP 1003#4-in-the-owner — one runner wakes on emitted commits and a one-second timer.

use crate::protocol::{Refusal, value_to_json};
use crate::writer::{Action, OwnerHandle};
use serde::Deserialize;
use serde_json::{Value as Json, json};
use snapback2_core::{EffectDecl, OutboxRow, Runtime};
use snapback2_effects::{
    EffectDeclarations, EffectLog, OutboxAccess, OutboxError, OutboxSettlement, PendingThen,
    Runner, ThenOutcome,
};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender, sync_channel};
use std::sync::{Arc, Mutex, atomic};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

struct WriterAccess {
    handle: OwnerHandle,
    running: Arc<Mutex<Vec<String>>>,
}

impl WriterAccess {
    // @ref LLP 1021#5-a-running-effect-can-be-stopped — `running` names every row the thread may still be inside at detachment: claimed, or in a `then`, until the writer settles it terminally.
    fn track(&self, id: &str) {
        let mut running = self.running.lock().unwrap_or_else(|e| e.into_inner());
        if !running.iter().any(|running| running == id) {
            running.push(id.to_owned());
        }
    }

    fn untrack(&self, id: &str) {
        self.running
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|running| running != id);
    }

    fn write_logs(&self, logs: Vec<EffectLog>) {
        if !logs.is_empty() {
            let _ = self.handle.call(Action::EffectsLog {
                lines: logs
                    .into_iter()
                    .map(|line| {
                        json!({
                            "outboxId": line.outbox_id,
                            "level": line.level,
                            "message": line.message,
                        })
                    })
                    .collect(),
            });
        }
    }
}

trait RunnerAccess: OutboxAccess {
    fn logs(&mut self, logs: Vec<EffectLog>);
}

impl RunnerAccess for WriterAccess {
    fn logs(&mut self, logs: Vec<EffectLog>) {
        self.write_logs(logs);
    }
}

impl OutboxAccess for WriterAccess {
    fn now(&mut self) -> Result<i64, OutboxError> {
        self.handle
            .call(Action::EffectsNow)
            .map_err(outbox_error)?
            .get("now")
            .and_then(Json::as_i64)
            .ok_or_else(|| OutboxError("writer omitted effects clock".to_owned()))
    }

    fn claim_next(
        &mut self,
        now: i64,
    ) -> Result<Option<snapback2_effects::EffectJob>, OutboxError> {
        let row: Option<OutboxRow> = decode(self.handle.call(Action::OutboxClaim { now }))?;
        if let Some(row) = &row {
            self.track(&row.id);
        }
        Ok(row.map(|row| snapback2_effects::EffectJob {
            id: row.id,
            effect: row.effect,
            payload: value_to_json(&row.payload),
            attempt: row.attempts,
            generation: row.generation,
        }))
    }

    fn effect_declarations(
        &mut self,
        job: &snapback2_effects::EffectJob,
    ) -> Result<EffectDeclarations, OutboxError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Resolved {
            current_generation: String,
            bound: Option<EffectDecl>,
            current: Option<EffectDecl>,
        }
        let resolved: Resolved = decode(self.handle.call(Action::EffectsResolve {
            effect: job.effect.clone(),
            generation: job.generation.clone(),
        }))?;
        Ok(EffectDeclarations {
            current_generation: resolved.current_generation,
            bound: resolved.bound,
            current: resolved.current,
        })
    }

    fn settle(&mut self, id: &str, settlement: OutboxSettlement) -> Result<(), OutboxError> {
        let terminal = !matches!(settlement, OutboxSettlement::ThenPending { .. });
        let (state, result, last_error, next_at) = match settlement {
            OutboxSettlement::ThenPending { result, .. } => {
                ("then_pending", Some(result), None, None)
            }
            OutboxSettlement::Sent { result, last_error } => {
                ("sent", Some(result), last_error, None)
            }
            OutboxSettlement::Retry { error, next_at } => {
                ("queued", None, Some(error), Some(next_at))
            }
            OutboxSettlement::Unavailable { error } => ("queued", None, Some(error), None),
            OutboxSettlement::Failed { error } => ("failed", None, Some(error), None),
        };
        self.handle
            .call(Action::OutboxSettle {
                id: id.to_owned(),
                state: state.to_owned(),
                result,
                last_error,
                next_at,
            })
            .map_err(outbox_error)?;
        if terminal {
            self.untrack(id);
        }
        Ok(())
    }

    fn pending_then(&mut self, limit: usize) -> Result<Vec<PendingThen>, OutboxError> {
        let rows: Vec<OutboxRow> = decode(self.handle.call(Action::OutboxThenPending { limit }))?;
        Ok(rows
            .into_iter()
            .map(|row| PendingThen {
                id: row.id,
                effect: row.effect,
                result: row.result,
                then_op: row.then_op,
            })
            .collect())
    }

    fn requeue(&mut self, id: &str, _now: i64) -> Result<(), OutboxError> {
        self.handle
            .call(Action::OutboxRequeue { id: id.to_owned() })
            .map(|_| ())
            .map_err(outbox_error)
    }

    fn mark_unknown_running_at_start(&mut self, _now: i64) -> Result<u64, OutboxError> {
        self.handle
            .call(Action::OutboxMarkUnknown)
            .map_err(outbox_error)?
            .get("changed")
            .and_then(Json::as_u64)
            .ok_or_else(|| OutboxError("writer omitted marked-running count".to_owned()))
    }

    fn mark_queued_unavailable(&mut self, error: &str) -> Result<u64, OutboxError> {
        self.handle
            .call(Action::OutboxMarkQueuedUnavailable {
                error: error.to_owned(),
            })
            .map_err(outbox_error)?
            .get("changed")
            .and_then(Json::as_u64)
            .ok_or_else(|| OutboxError("writer omitted queued-unavailable count".to_owned()))
    }

    fn execute_then(
        &mut self,
        op: &str,
        args: Json,
        outbox_id: &str,
    ) -> Result<ThenOutcome, OutboxError> {
        self.track(outbox_id);
        let execution = self
            .handle
            .call(Action::OutboxExecuteThen {
                op: op.to_owned(),
                args,
                outbox_id: outbox_id.to_owned(),
            })
            .map_err(outbox_error)?;
        // The writer settled the row inside that call; a protocol error above keeps it listed.
        self.untrack(outbox_id);
        if execution.get("state") != Some(&Json::String("rejected".to_owned())) {
            return Ok(ThenOutcome::Sent);
        }
        let code = execution
            .get("code")
            .and_then(Json::as_str)
            .unwrap_or("E_EFFECT_THEN");
        let error = format!(
            "{code}: {}",
            execution
                .get("message")
                .and_then(Json::as_str)
                .unwrap_or("then mutation rejected")
        );
        if code == "E_EFFECT_THEN_CHANGED" {
            Ok(ThenOutcome::Failed(error))
        } else {
            Ok(ThenOutcome::Rejected(error))
        }
    }
}

pub(crate) fn claim_outbox(runtime: &Runtime, root: &Path, now: i64) -> Result<Json, Refusal> {
    let declared_names = runtime
        .generation()
        .effects()
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    // Claims also atomically fail declarations removed by a successor; the
    // claim transaction reports the rows it failed, logged only after it commits.
    let snapback2_core::OutboxClaim { failed, claimed } = runtime
        .store()
        .outbox_claim_next(now, &declared_names)
        .map_err(|error| Refusal::from_runtime(&error))?;
    for row in failed {
        crate::writer::transition(
            root,
            &row,
            Some("queued"),
            "failed",
            json!({"error":"E_EFFECT_UNKNOWN"}),
        );
    }
    if let Some(row) = &claimed {
        crate::writer::transition(
            root,
            row,
            Some("queued"),
            "running",
            json!({"attempt":row.attempts}),
        );
    }
    serialize_claimed_outbox(
        runtime,
        claimed,
        |row| serde_json::to_value(row).map_err(|error| error.to_string()),
        |outbox_id, message| {
            if let Ok(Some(row)) = runtime.store().outbox_get(outbox_id) {
                crate::writer::transition(
                    root,
                    &row,
                    Some("running"),
                    "queued",
                    json!({"error":message}),
                );
            }
            crate::watch::log(
                root,
                json!({
                    "effect": {
                        "outboxId": outbox_id,
                        "level": "error",
                        "message": message,
                    }
                }),
            );
        },
    )
}

pub(crate) fn serialize_claimed_outbox(
    runtime: &Runtime,
    claimed: Option<OutboxRow>,
    serialize: impl FnOnce(&Option<OutboxRow>) -> Result<Json, String>,
    mut log: impl FnMut(&str, &str),
) -> Result<Json, Refusal> {
    match serialize(&claimed) {
        Ok(value) => Ok(value),
        Err(error) => {
            let message = format!("E_EFFECT_CLAIM_SERIALIZATION: {error}");
            if let Some(row) = &claimed {
                runtime
                    .store()
                    .outbox_settle(&row.id, "queued", None, Some(&message), None)
                    .map_err(|settle| Refusal::from_runtime(&settle))?;
                log(&row.id, &message);
            }
            Err(Refusal::new(
                "E_EFFECT_CLAIM_SERIALIZATION",
                "effect",
                message,
                "inspect the outbox row and retry after correcting its data",
                "effects/runner",
            ))
        }
    }
}

pub struct EffectsStatus {
    wake: SyncSender<()>,
    stop: Arc<atomic::AtomicBool>,
    thread: Option<JoinHandle<()>>,
    root: PathBuf,
    running: Arc<Mutex<Vec<String>>>,
    budget: Duration,
}

impl Drop for EffectsStatus {
    fn drop(&mut self) {
        self.stop.store(true, atomic::Ordering::SeqCst);
        let _ = self.wake.try_send(());
        if let Some(thread) = self.thread.take() {
            // @ref LLP 1021#5-a-running-effect-can-be-stopped — detachment reports uncertainty; only the host deadline stops execution.
            let deadline = Instant::now() + self.budget + Duration::from_secs(1);
            while !thread.is_finished() && Instant::now() < deadline {
                thread::sleep(
                    Duration::from_millis(5)
                        .min(deadline.saturating_duration_since(Instant::now())),
                );
            }
            if thread.is_finished() {
                let _ = thread.join();
            } else {
                let running = self
                    .running
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                crate::watch::log(
                    &self.root,
                    json!({"outbox":{"engine":"detached", "running":running}}),
                );
            }
        }
    }
}

pub fn spawn(handle: OwnerHandle, root: &Path, stop: Arc<atomic::AtomicBool>) -> EffectsStatus {
    let (wake, receiver) = sync_channel(1);
    let running = Arc::new(Mutex::new(Vec::new()));
    handle
        .call(Action::InstallEffectsWake { wake: wake.clone() })
        .expect("effects runner must install its writer wake channel");
    let thread = thread::Builder::new()
        .name("snapback2-effects".to_owned())
        .spawn({
            let stop = stop.clone();
            let running = running.clone();
            move || run(handle, receiver, stop, running)
        })
        .expect("effects runner thread must start");
    EffectsStatus {
        wake,
        stop,
        thread: Some(thread),
        root: root.to_owned(),
        running,
        budget: snapback2_effects::DEFAULT_BUDGET,
    }
}

fn run(
    handle: OwnerHandle,
    receiver: Receiver<()>,
    stop: Arc<atomic::AtomicBool>,
    running: Arc<Mutex<Vec<String>>>,
) {
    #[cfg(feature = "hermes")]
    let runner = Runner::new(
        snapback2_effects::Ibex2Host::new().expect("Hermes effect host must initialize"),
    );
    #[cfg(not(feature = "hermes"))]
    let runner = Runner::new(snapback2_effects::NoEngine);
    run_with(runner, WriterAccess { handle, running }, receiver, stop);
}

fn run_with<H: snapback2_effects::EffectHost, A: RunnerAccess>(
    mut runner: Runner<H>,
    mut access: A,
    receiver: Receiver<()>,
    stop: Arc<atomic::AtomicBool>,
) {
    runner.set_stop_flag(stop.clone());
    let mut initialized = false;
    loop {
        if stop.load(atomic::Ordering::SeqCst) {
            return;
        }
        if !initialized {
            match runner.initialize(&mut access) {
                Ok(drained) => {
                    access.logs(drained.logs);
                    initialized = true;
                }
                Err(error) => {
                    access.logs(vec![EffectLog {
                        outbox_id: "runner".to_owned(),
                        level: "error".to_owned(),
                        message: error.0,
                    }]);
                    match receiver.recv_timeout(Duration::from_secs(1)) {
                        Ok(()) | Err(RecvTimeoutError::Timeout) => continue,
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
            }
        }
        match runner.drain(&mut access) {
            Ok(drained) => access.logs(drained.logs),
            Err(error) => access.logs(vec![EffectLog {
                outbox_id: "runner".to_owned(),
                level: "error".to_owned(),
                message: error.0,
            }]),
        }
        if stop.load(atomic::Ordering::SeqCst) {
            return;
        }
        match receiver.recv_timeout(Duration::from_secs(1)) {
            Ok(()) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

fn decode<T: serde::de::DeserializeOwned>(
    result: Result<Json, crate::protocol::Refusal>,
) -> Result<T, OutboxError> {
    serde_json::from_value(result.map_err(outbox_error)?)
        .map_err(|error| OutboxError(format!("writer protocol: {error}")))
}

fn outbox_error(error: crate::protocol::Refusal) -> OutboxError {
    OutboxError(format!("{}: {}", error.code, error.message))
}

#[cfg(test)]
mod tests {
    use super::*;
    use snapback2_effects::EffectJob;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct RetryInitializationAccess {
        now_calls: Arc<AtomicUsize>,
        logs: Arc<Mutex<Vec<EffectLog>>>,
        stop: Arc<atomic::AtomicBool>,
    }

    impl RunnerAccess for RetryInitializationAccess {
        fn logs(&mut self, logs: Vec<EffectLog>) {
            self.logs.lock().unwrap().extend(logs);
        }
    }

    impl OutboxAccess for RetryInitializationAccess {
        fn now(&mut self) -> Result<i64, OutboxError> {
            let call = self.now_calls.fetch_add(1, Ordering::SeqCst);
            if call == 0 {
                Err(OutboxError("simulated initialization error".to_owned()))
            } else {
                Ok(42)
            }
        }

        fn claim_next(&mut self, _now: i64) -> Result<Option<EffectJob>, OutboxError> {
            Ok(None)
        }

        fn effect_declarations(
            &mut self,
            _job: &EffectJob,
        ) -> Result<EffectDeclarations, OutboxError> {
            unreachable!("no rows are claimed")
        }

        fn settle(&mut self, _id: &str, _settlement: OutboxSettlement) -> Result<(), OutboxError> {
            Ok(())
        }

        fn pending_then(&mut self, _limit: usize) -> Result<Vec<PendingThen>, OutboxError> {
            Ok(Vec::new())
        }

        fn requeue(&mut self, _id: &str, _now: i64) -> Result<(), OutboxError> {
            Ok(())
        }

        fn mark_unknown_running_at_start(&mut self, _now: i64) -> Result<u64, OutboxError> {
            self.stop.store(true, atomic::Ordering::SeqCst);
            Ok(0)
        }

        fn mark_queued_unavailable(&mut self, _error: &str) -> Result<u64, OutboxError> {
            Ok(0)
        }

        fn execute_then(
            &mut self,
            _op: &str,
            _args: Json,
            _outbox_id: &str,
        ) -> Result<ThenOutcome, OutboxError> {
            unreachable!("there are no pending rows")
        }
    }

    fn detach_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "snapback2-detach-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join(".snapback")).unwrap();
        root
    }

    fn running_ids(running: &Arc<Mutex<Vec<String>>>) -> Vec<String> {
        running.lock().unwrap().clone()
    }

    #[test]
    fn shutdown_detaches_with_a_durable_running_id_after_budget_plus_one_second() {
        let root = detach_root("running");
        let (release, wait) = std::sync::mpsc::channel::<()>();
        let (wake, _) = sync_channel(1);
        let stop = Arc::new(atomic::AtomicBool::new(false));
        let budget = Duration::from_millis(25);
        let started = Instant::now();
        drop(EffectsStatus {
            wake,
            stop: stop.clone(),
            root: root.clone(),
            budget,
            running: Arc::new(Mutex::new(vec!["running-1".into()])),
            thread: Some(thread::spawn(move || {
                let _ = wait.recv();
            })),
        });
        assert!(stop.load(atomic::Ordering::SeqCst));
        assert!(started.elapsed() >= budget + Duration::from_secs(1));
        assert!(started.elapsed() < budget + Duration::from_millis(1_200));
        let log = std::fs::read_to_string(root.join(".snapback/log.jsonl")).unwrap();
        let line: Json = serde_json::from_str(log.trim()).unwrap();
        assert_eq!(
            line["outbox"],
            json!({"engine":"detached","running":["running-1"]})
        );
        release.send(()).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_thread_that_stops_in_time_writes_no_detach_line() {
        let root = detach_root("clean");
        let (wake, _) = sync_channel(1);
        let stop = Arc::new(atomic::AtomicBool::new(false));
        let started = Instant::now();
        drop(EffectsStatus {
            wake,
            stop: stop.clone(),
            root: root.clone(),
            budget: Duration::from_millis(25),
            running: Arc::new(Mutex::new(vec!["idle-1".into()])),
            thread: Some(thread::spawn({
                let stop = stop.clone();
                move || {
                    while !stop.load(atomic::Ordering::SeqCst) {
                        thread::sleep(Duration::from_millis(1));
                    }
                }
            })),
        });
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "{:?}",
            started.elapsed()
        );
        assert!(!root.join(".snapback/log.jsonl").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn claims_track_running_ids_until_a_terminal_settlement() {
        let running = Arc::new(Mutex::new(Vec::new()));
        let mut access = WriterAccess {
            handle: crate::writer::effects_tests::spawn_effects_writer("running-ids", 3),
            running: running.clone(),
        };
        let first = access.claim_next(1).unwrap().unwrap();
        let second = access.claim_next(1).unwrap().unwrap();
        let third = access.claim_next(1).unwrap().unwrap();
        let all = vec![first.id.clone(), second.id.clone(), third.id.clone()];
        assert_eq!(running_ids(&running), all);
        access
            .settle(
                &first.id,
                OutboxSettlement::ThenPending {
                    result: json!(true),
                    then_op: "effects.then".to_owned(),
                },
            )
            .unwrap();
        assert_eq!(running_ids(&running), all, "then_pending keeps the slot");
        access
            .settle(
                &second.id,
                OutboxSettlement::Sent {
                    result: json!(true),
                    last_error: None,
                },
            )
            .unwrap();
        assert_eq!(
            running_ids(&running),
            vec![first.id.clone(), third.id.clone()]
        );
        access
            .settle(
                &third.id,
                OutboxSettlement::Failed {
                    error: "E_TEST".to_owned(),
                },
            )
            .unwrap();
        assert_eq!(running_ids(&running), vec![first.id.clone()]);
        // The writer settles the row inside `execute_then`; its return is terminal.
        let outcome = access
            .execute_then(
                "effects.then",
                json!({"outboxId": first.id, "effect": "effects.run", "result": true}),
                &first.id,
            )
            .unwrap();
        assert!(
            matches!(outcome, ThenOutcome::Rejected(_) | ThenOutcome::Failed(_)),
            "{outcome:?}"
        );
        assert!(running_ids(&running).is_empty());
        assert!(access.claim_next(2).unwrap().is_none());
    }

    #[test]
    fn detach_while_a_job_is_inside_then_logs_its_outbox_id() {
        let root = detach_root("then");
        let running = Arc::new(Mutex::new(Vec::new()));
        let mut access = WriterAccess {
            handle: crate::writer::effects_tests::spawn_effects_writer("detach-then", 1),
            running: running.clone(),
        };
        let job = access.claim_next(1).unwrap().unwrap();
        access
            .settle(
                &job.id,
                OutboxSettlement::ThenPending {
                    result: json!(true),
                    then_op: "effects.then".to_owned(),
                },
            )
            .unwrap();
        // The parked thread stands in for the runner still inside `execute_then`.
        let (release, wait) = std::sync::mpsc::channel::<()>();
        let (wake, _) = sync_channel(1);
        drop(EffectsStatus {
            wake,
            stop: Arc::new(atomic::AtomicBool::new(false)),
            root: root.clone(),
            budget: Duration::from_millis(25),
            running: running.clone(),
            thread: Some(thread::spawn(move || {
                let _ = wait.recv();
            })),
        });
        let log = std::fs::read_to_string(root.join(".snapback/log.jsonl")).unwrap();
        let line: Json = serde_json::from_str(log.trim()).unwrap();
        assert_eq!(
            line["outbox"],
            json!({"engine":"detached","running":[job.id]})
        );
        release.send(()).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn initialization_error_is_logged_and_retried_on_the_next_wake() {
        let now_calls = Arc::new(AtomicUsize::new(0));
        let logs = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(atomic::AtomicBool::new(false));
        let (wake, receiver) = sync_channel(2);
        wake.send(()).unwrap();
        run_with(
            Runner::new(snapback2_effects::NoEngine),
            RetryInitializationAccess {
                now_calls: now_calls.clone(),
                logs: logs.clone(),
                stop: stop.clone(),
            },
            receiver,
            stop,
        );

        assert_eq!(now_calls.load(Ordering::SeqCst), 2);
        assert!(
            logs.lock()
                .unwrap()
                .iter()
                .any(|line| line.message.contains("simulated initialization error"))
        );
    }
}
