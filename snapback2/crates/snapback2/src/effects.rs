//! The owner-side effects runner. Every durable operation crosses the writer
//! channel; the Hermes host remains owned by this one runner thread.
// @ref LLP 1003#4-in-the-owner — one runner wakes on emitted commits and a one-second timer.

use crate::protocol::value_to_json;
use crate::writer::{Action, OwnerHandle};
use serde::Deserialize;
use serde_json::{Value as Json, json};
use snapback2_core::{EffectDecl, OutboxRow};
use snapback2_effects::{
    EffectDeclarations, EffectLog, OutboxAccess, OutboxError, OutboxSettlement, PendingThen,
    Runner, ThenOutcome,
};
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender, sync_channel};
use std::sync::{Arc, atomic};
use std::thread::{self, JoinHandle};
use std::time::Duration;

struct WriterAccess {
    handle: OwnerHandle,
}

impl WriterAccess {
    fn logs(&self, logs: Vec<EffectLog>) {
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

impl OutboxAccess for WriterAccess {
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

    fn pending_then(&mut self) -> Result<Vec<PendingThen>, OutboxError> {
        let rows: Vec<OutboxRow> = decode(self.handle.call(Action::OutboxThenPending))?;
        rows.into_iter()
            .map(|row| {
                Ok(PendingThen {
                    id: row.id,
                    effect: row.effect,
                    result: row
                        .result
                        .ok_or_else(|| OutboxError("then_pending row has no result".to_owned()))?,
                    then_op: row.then_op,
                })
            })
            .collect()
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

fn run_with<H: snapback2_effects::EffectHost>(
    mut runner: Runner<H>,
    mut access: WriterAccess,
    receiver: Receiver<()>,
    stop: Arc<atomic::AtomicBool>,
) {
    if let Err(error) = runner.initialize(&mut access) {
        access.logs(vec![EffectLog {
            outbox_id: "runner".to_owned(),
            level: "error".to_owned(),
            message: error.0,
        }]);
        return;
    }
    loop {
        if stop.load(atomic::Ordering::SeqCst) {
            return;
        }
        match runner.drain(&mut access) {
            Ok(drained) => access.logs(drained.logs),
            Err(error) => access.logs(vec![EffectLog {
                outbox_id: "runner".to_owned(),
                level: "error".to_owned(),
                message: error.0,
            }]),
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
