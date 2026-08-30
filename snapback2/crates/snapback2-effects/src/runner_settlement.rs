use super::{Drained, OutboxAccess, OutboxError, OutboxSettlement, PendingThen, ThenOutcome};
use crate::EffectLog;
use serde_json::json;
use std::any::Any;
use std::panic::{AssertUnwindSafe, catch_unwind};

pub(super) fn drain_pending<A: OutboxAccess>(
    access: &mut A,
    limit: usize,
    drained: &mut Drained,
) -> Result<usize, OutboxError> {
    let pending = access.pending_then(limit)?;
    let count = pending.len();
    for pending in pending {
        let id = pending.id.clone();
        let result = catch_unwind(AssertUnwindSafe(|| run_pending_then(access, &pending)));
        match result {
            Ok(Ok(outcome)) => record_then(outcome, &id, drained),
            Ok(Err(error)) => drained.logs.push(EffectLog {
                outbox_id: id,
                level: "error".to_owned(),
                message: error.0,
            }),
            Err(payload) => {
                let message = format!(
                    "E_EFFECT_RUNNER_PANIC: pending then panicked: {}",
                    panic_message(payload)
                );
                if let Err(error) = access.settle(
                    &id,
                    OutboxSettlement::Failed {
                        error: "E_EFFECT_RUNNER_PANIC".to_owned(),
                    },
                ) {
                    drained.logs.push(EffectLog {
                        outbox_id: id.clone(),
                        level: "error".to_owned(),
                        message: format!("{message}; settlement failed: {}", error.0),
                    });
                } else {
                    drained.failed += 1;
                    drained.then_failed += 1;
                    drained.logs.push(EffectLog {
                        outbox_id: id,
                        level: "error".to_owned(),
                        message,
                    });
                }
            }
        }
    }
    Ok(count)
}

pub(super) fn run_pending_then<A: OutboxAccess>(
    access: &mut A,
    pending: &PendingThen,
) -> Result<ThenOutcome, OutboxError> {
    let (Some(then), Some(result)) = (pending.then_op.as_deref(), pending.result.as_ref()) else {
        access.settle(
            &pending.id,
            OutboxSettlement::Failed {
                error: "E_EFFECT_THEN_CHANGED".to_owned(),
            },
        )?;
        return Ok(ThenOutcome::Failed("E_EFFECT_THEN_CHANGED".to_owned()));
    };
    access.execute_then(
        then,
        json!({
            "outboxId": pending.id,
            "effect": pending.effect,
            "result": result,
        }),
        &pending.id,
    )
}

pub(super) fn record_then(outcome: ThenOutcome, outbox_id: &str, drained: &mut Drained) {
    match outcome {
        ThenOutcome::Sent => drained.sent += 1,
        ThenOutcome::Rejected(_) => {
            drained.sent += 1;
            drained.then_failed += 1;
        }
        ThenOutcome::Failed(error) => {
            drained.failed += 1;
            drained.then_failed += 1;
            drained.logs.push(EffectLog {
                outbox_id: outbox_id.to_owned(),
                level: "error".to_owned(),
                message: error,
            });
        }
    }
}

pub(super) fn merge_drained(total: &mut Drained, mut next: Drained) {
    total.unknown_at_start += next.unknown_at_start;
    total.sent += next.sent;
    total.failed += next.failed;
    total.requeued += next.requeued;
    total.then_failed += next.then_failed;
    total.unavailable.append(&mut next.unavailable);
    total.logs.append(&mut next.logs);
}

pub(super) fn panic_message(payload: Box<dyn Any + Send>) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|message| (*message).to_owned())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "non-string panic payload".to_owned())
}

pub(super) fn retry_delay_ms(attempt: u32) -> i64 {
    let exponent = attempt.saturating_sub(1).min(30);
    1_000_i64.saturating_mul(1_i64.checked_shl(exponent).unwrap_or(i64::MAX))
}
