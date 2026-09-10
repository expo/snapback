//! Typed execution and live-delivery shapes for the HTTP/SSE wire.

use crate::protocol::{Refusal, refusal_json, refusal_message, value_to_json};
use crate::writer_util::rejection_family;
use serde_json::{Value as Json, json};
use snapback2_core::{Execution, ExecutionState};

pub fn execution_json(execution: &Execution) -> Json {
    match &execution.state {
        ExecutionState::Complete => {
            json!({ "state": "complete", "data": value_to_json(&execution.result), "seq": execution.seq, "next": execution.next })
        }
        ExecutionState::Capped => {
            json!({ "state": "capped", "data": value_to_json(&execution.result), "seq": execution.seq, "next": execution.next })
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
        ExecutionState::Rejected { code, site, .. } if code == "E_CONFLICT" => json!({
            "state": "rejected", "reason": "conflict", "current": value_to_json(&execution.result),
            "code": code, "family": "input", "message": "the row no longer matches the update condition",
            "site": site, "rewrite": "review current, then submit a new conditional update", "guide": "quarry"
        }),
        ExecutionState::Rejected { code, message, rule, site, rewrite } => {
            let family = if rule.is_some() { "rule" } else { rejection_family(code) };
            let mut response = json!({
                "state": "rejected",
                "code": code,
                "family": family,
                "message": refusal_message(code, message),
                "rewrite": "fix the rejected mutation input and retry",
                "guide": format!("{family}/runtime"),
            });
            if code == snapback2_core::delivery::INCARNATION {
                response["guide"] = json!("offline");
            }
            if let Some(rewrite) = rewrite {
                response["rewrite"] = json!(rewrite);
                if code == "E_BOUND" { response["guide"] = json!("bound/ceiling"); }
            }
            if let Some(rule) = rule { response["rule"] = json!(rule); }
            if let Some(site) = site { response["site"] = json!(site); }
            response
        }
    }
}

pub fn live_frame(execution: Result<&Execution, Refusal>, refused_seq: u64) -> (Json, bool) {
    match execution {
        Ok(execution) => match &execution.state {
            ExecutionState::Complete
            | ExecutionState::Capped
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

pub fn refusal_frame(refusal: Refusal, seq: u64) -> (Json, bool) {
    let mut frame = refusal_json(&refusal);
    if let Some(object) = frame.as_object_mut() {
        object.insert("state".to_owned(), Json::String("refused".to_owned()));
        object.insert("seq".to_owned(), Json::from(seq));
    }
    (frame, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use snapback2_core::engine::ClosureReceipt;
    use snapback2_core::{AuthoritativeTrace, Value};

    fn execution(state: ExecutionState) -> Execution {
        Execution {
            result: Value::String("result".to_owned()),
            result_provenance: Default::default(),
            trace: AuthoritativeTrace::default(),
            receipt: ClosureReceipt::default(),
            state,
            seq: 41,
            next: None,
        }
    }

    #[test]
    fn subscription_frames_preserve_query_states_and_terminal_refusals() {
        for state in [
            ExecutionState::Complete,
            ExecutionState::Capped,
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
            if frame["state"] == "capped" {
                assert_eq!(frame.as_object().unwrap().len(), 4);
                assert!(frame.get("site").is_none());
                assert!(frame.get("take").is_none());
                assert!(frame.get("reason").is_none());
            }
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
            rewrite: None,
            site: None,
            rule: None,
            code: "E_RULE".to_owned(),
            message: "denied".to_owned(),
        }));
        assert_eq!(rejected["state"], "rejected");
        assert_eq!(rejected["code"], "E_RULE");
        assert_eq!(rejected["family"], "rule");
        assert_eq!(rejected["guide"], "rule/runtime");
        for field in ["code", "family", "message", "guide"] {
            assert!(
                rejected[field]
                    .as_str()
                    .is_some_and(|value| !value.is_empty())
            );
        }

        let (refused, terminal) = refusal_frame(
            Refusal::new(
                "E_RULE_CHANNEL_SUBSCRIBE",
                "rule",
                "membership was revoked",
                "join the channel before subscribing",
                "rule/channels",
            ),
            42,
        );
        assert!(terminal);
        assert_eq!(refused["seq"], 42);
        assert_eq!(refused["state"], "refused");
        for field in ["code", "family", "message", "guide"] {
            assert!(
                refused[field]
                    .as_str()
                    .is_some_and(|value| !value.is_empty())
            );
        }
    }

    #[test]
    fn rejected_mutation_messages_keep_codes_in_the_code_field() {
        for (code, before, after) in [
            ("E_INPUT", "E_INPUT: invalid cursor", "invalid cursor"),
            (
                "MEMBERSHIP_REQUIRED",
                "E_REQUIRE:MEMBERSHIP_REQUIRED: program requirement failed",
                "program requirement failed",
            ),
        ] {
            let result = execution_json(&execution(ExecutionState::Rejected {
                rewrite: None,
                code: code.to_owned(),
                message: before.to_owned(),
                site: None,
                rule: None,
            }));
            assert_eq!(result["code"], code);
            assert_eq!(result["message"], after);
        }
    }

    #[test]
    fn capped_state_is_opaque() {
        let opaque = execution_json(&execution(ExecutionState::Capped));
        assert!(opaque.get("site").is_none());
        assert!(opaque.get("take").is_none());
        assert!(opaque.get("reason").is_none());
    }

    #[test]
    fn require_meaning_is_structured_in_live_and_replayed_writes() {
        for code in ["NOT_MEMBER", "E_INPUT", "conflict"] {
            let value = execution(ExecutionState::Rejected {
                rewrite: None,
                code: code.into(), message: "program requirement failed".into(), rule: Some(code.into()),
                site: Some("snapback/rules.q:8:3".into()),
            });
            let replayed = snapback2_core::offline::replay_mutation_response(&value, "intent", None);
            for result in [execution_json(&value), replayed] {
                assert_eq!(result["family"], "rule");
                assert_eq!(result["code"], code);
                assert_eq!(result["rule"], code);
                assert_eq!(result["message"], "program requirement failed");
                assert_eq!(result["site"], "snapback/rules.q:8:3");
            }
        }
        let occ = snapback2_core::offline::replay_mutation_response(&execution(ExecutionState::Rejected {
            rewrite: None,
            code: "conflict".into(), message: "messages.byId".into(), rule: None, site: None,
        }), "occ-intent", None);
        assert_eq!(occ["reason"], "conflict");
        assert_eq!(occ["site"], "messages.byId");
        assert!(occ.get("rule").is_none());
        assert!(occ.get("code").is_none());
        let input = execution_json(&execution(ExecutionState::Rejected {
            rewrite: None,
            code: "E_INPUT".into(), message: "invalid input".into(), rule: None, site: None,
        }));
        assert_eq!(input["family"], "input");
        assert!(input.get("rule").is_none());
    }

}
