//! Typed execution and live-delivery shapes for the HTTP/SSE wire.

use crate::protocol::{Refusal, refusal_json, value_to_json};
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
        ExecutionState::Rejected { code, message } => {
            let family = rejection_family(code);
            json!({
                "state": "rejected",
                "code": code,
                "family": family,
                "message": message,
                "rewrite": "fix the rejected mutation input and retry",
                "guide": format!("{family}/runtime"),
            })
        }
    }
}

pub fn live_frame(execution: Result<&Execution, Refusal>, refused_seq: u64) -> (Json, bool) {
    match execution {
        Ok(execution) => match &execution.state {
            ExecutionState::Complete
            | ExecutionState::Capped { .. }
            | ExecutionState::Partial { .. }
            | ExecutionState::Denied { .. } => (execution_json(execution), false),
            ExecutionState::Committed { .. } | ExecutionState::Rejected { .. } => refusal_frame(
                Refusal::new(
                    "E_OP_KIND",
                    "op",
                    "a subscription query produced a mutation state",
                    "subscribe only to query operations",
                    "op/kind",
                ),
                execution.seq,
            ),
        },
        Err(refusal) => refusal_frame(refusal, refused_seq),
    }
}

fn refusal_frame(refusal: Refusal, seq: u64) -> (Json, bool) {
    let mut frame = refusal_json(&refusal);
    if let Some(object) = frame.as_object_mut() {
        object.insert("state".to_owned(), Json::String("refused".to_owned()));
        object.insert("seq".to_owned(), Json::from(seq));
    }
    (frame, true)
}

pub fn channel_refusal_frame(refusal: Refusal) -> Json {
    let mut frame = refusal_json(&refusal);
    if let Some(object) = frame.as_object_mut() {
        object.insert("state".to_owned(), Json::String("refused".to_owned()));
    }
    frame
}

#[cfg(test)]
mod tests {
    use super::*;
    use snapback2_core::engine::ClosureReceipt;
    use snapback2_core::{AuthoritativeTrace, Value};

    fn execution(state: ExecutionState) -> Execution {
        Execution {
            result: Value::String("result".to_owned()),
            trace: AuthoritativeTrace::default(),
            receipt: ClosureReceipt::default(),
            state,
            seq: 41,
        }
    }

    #[test]
    fn subscription_frames_preserve_query_states_and_terminal_refusals() {
        for state in [
            ExecutionState::Complete,
            ExecutionState::Capped {
                site: "items.page".to_owned(),
                take: 10,
            },
            ExecutionState::Partial {
                reason: "coverage".to_owned(),
            },
            ExecutionState::Denied {
                rule: "items.Read".to_owned(),
            },
        ] {
            let execution = execution(state);
            let (frame, terminal) = live_frame(Ok(&execution), execution.seq);
            assert_eq!(frame, execution_json(&execution));
            assert!(!terminal);
            assert!(!matches!(frame["state"].as_str(), Some("live" | "stale")));
        }

        let refusal = Refusal::new(
            "E_DIV_ZERO",
            "input",
            "division by zero",
            "guard the divisor",
            "input/arithmetic",
        );
        let (frame, terminal) = live_frame(Err(refusal), 42);
        assert!(terminal);
        assert_eq!(frame["state"], "refused");
        assert_eq!(frame["seq"], 42);
        assert_eq!(frame["code"], "E_DIV_ZERO");
        assert_eq!(frame["family"], "input");
        assert_eq!(frame["message"], "division by zero");
        assert_eq!(frame["guide"], "input/arithmetic");
    }

    #[test]
    fn rejected_mutations_and_channel_refusals_carry_complete_envelopes() {
        let rejected = execution_json(&execution(ExecutionState::Rejected {
            code: "E_REQUIRE:DENIED".to_owned(),
            message: "denied".to_owned(),
        }));
        assert_eq!(rejected["state"], "rejected");
        for field in ["code", "family", "message", "guide"] {
            assert!(
                rejected[field]
                    .as_str()
                    .is_some_and(|value| !value.is_empty())
            );
        }

        let refused = channel_refusal_frame(Refusal::new(
            "E_RULE_CHANNEL_SUBSCRIBE",
            "rule",
            "membership was revoked",
            "join the channel before subscribing",
            "rule/channels",
        ));
        assert_eq!(refused["state"], "refused");
        for field in ["code", "family", "message", "guide"] {
            assert!(
                refused[field]
                    .as_str()
                    .is_some_and(|value| !value.is_empty())
            );
        }
    }
}
