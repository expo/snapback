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
use std::path::Path;
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender, sync_channel};
use std::sync::{Arc, atomic};
use std::thread::{self, JoinHandle};
use std::time::Duration;

struct WriterAccess {
    handle: OwnerHandle,
}

impl WriterAccess {
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
            .map(|_| ())
            .map_err(outbox_error)
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
        let execution = self
            .handle
            .call(Action::OutboxExecuteThen {
                op: op.to_owned(),
                args,
                outbox_id: outbox_id.to_owned(),
            })
            .map_err(outbox_error)?;
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
    // Claims also atomically fail declarations removed by a successor. Capture
    // their identities before that transaction; report only after it commits.
    let removed = runtime
        .store()
        .outbox_undeclared(&declared_names)
        .map_err(|e| Refusal::from_runtime(&e))?;
    let claimed = runtime
        .store()
        .outbox_claim_next(now, &declared_names)
        .map_err(|error| Refusal::from_runtime(&error))?;
    for row in removed {
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
}

impl Drop for EffectsStatus {
    fn drop(&mut self) {
        self.stop.store(true, atomic::Ordering::SeqCst);
        let _ = self.wake.try_send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

pub fn spawn(handle: OwnerHandle) -> EffectsStatus {
    let (wake, receiver) = sync_channel(1);
    let stop = Arc::new(atomic::AtomicBool::new(false));
    handle
        .call(Action::InstallEffectsWake { wake: wake.clone() })
        .expect("effects runner must install its writer wake channel");
    let thread = thread::Builder::new()
        .name("snapback2-effects".to_owned())
        .spawn({
            let stop = stop.clone();
            move || run(handle, receiver, stop)
        })
        .expect("effects runner thread must start");
    EffectsStatus {
        wake,
        stop,
        thread: Some(thread),
    }
}

fn run(handle: OwnerHandle, receiver: Receiver<()>, stop: Arc<atomic::AtomicBool>) {
    #[cfg(feature = "hermes")]
    let runner = Runner::new(
        snapback2_effects::Ibex2Host::new().expect("Hermes effect host must initialize"),
    );
    #[cfg(not(feature = "hermes"))]
    let runner = Runner::new(snapback2_effects::NoEngine);
    run_with(runner, WriterAccess { handle }, receiver, stop);
}

fn run_with<H: snapback2_effects::EffectHost, A: RunnerAccess>(
    mut runner: Runner<H>,
    mut access: A,
    receiver: Receiver<()>,
    stop: Arc<atomic::AtomicBool>,
) {
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
