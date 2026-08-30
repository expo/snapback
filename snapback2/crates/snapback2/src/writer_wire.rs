//! Typed execution and live-delivery shapes for the HTTP/SSE wire.

use crate::protocol::{Refusal, value_to_json};
use crate::writer_util::rejection_family;
use serde_json::{Value as Json, json};
use snapback2_core::{Execution, ExecutionState};

pub fn execution_json(execution: &Execution) -> Json {
    match &execution.state {
        ExecutionState::Complete => {
            json!({ "state": "complete", "data": value_to_json(&execution.result), "seq": execution.seq })
        }
        ExecutionState::Capped { site, take } => {
            json!({ "state": "capped", "data": value_to_json(&execution.result), "seq": execution.seq, "site": site, "take": take })
        }
        ExecutionState::Partial { reason } => {
            json!({ "state": "partial", "data": value_to_json(&execution.result), "seq": execution.seq, "reason": reason })
        }
        ExecutionState::Denied { rule } => {
            json!({ "state": "denied", "data": value_to_json(&execution.result), "seq": execution.seq, "rule": rule })
        }
        ExecutionState::Committed { seq } => {
            json!({ "state": "committed", "seq": seq, "data": value_to_json(&execution.result) })
        }
        ExecutionState::Rejected { code, message } => json!({
            "state": "rejected",
            "code": code,
            "family": rejection_family(code),
            "message": message,
            "rewrite": "fix the rejected mutation input and retry",
        }),
    }
}

pub fn live_json(execution: Result<&Execution, Refusal>, refused_seq: u64) -> Json {
    match execution {
        Ok(execution) => match &execution.state {
            ExecutionState::Complete => {
                json!({ "state": "live", "seq": execution.seq, "data": value_to_json(&execution.result) })
            }
            ExecutionState::Capped { take, .. } => {
                json!({ "state": "live", "seq": execution.seq, "data": value_to_json(&execution.result), "take": take })
            }
            ExecutionState::Partial { reason } => {
                json!({ "state": "partial", "seq": execution.seq, "data": value_to_json(&execution.result), "reason": reason })
            }
            ExecutionState::Denied { rule } => {
                json!({ "state": "refused", "seq": execution.seq, "code": "E_RULE", "rule": rule })
            }
            ExecutionState::Committed { .. } | ExecutionState::Rejected { .. } => {
                json!({ "state": "refused", "seq": execution.seq, "code": "E_OP_KIND" })
            }
        },
        Err(refusal) => {
            json!({ "state": "refused", "seq": refused_seq, "code": refusal.code, "family": refusal.family, "message": refusal.message })
        }
    }
}
