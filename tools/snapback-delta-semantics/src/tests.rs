//! Focused evaluator unit tests; the external corpus carries conformance breadth.

use std::collections::BTreeSet;

use serde_json::{Value, json};

use super::*;

fn app_change(row_key: &str, op: ChangeOp, pre: Value, post: Value) -> AppChange {
    AppChange {
        row_key: row_key.to_owned(),
        op,
        pre_image: serde_json::from_value(pre).ok(),
        post_image: serde_json::from_value(post).ok(),
        changed_fields: BTreeSet::new(),
    }
}

#[test]
fn app_batch_folding_uses_first_pre_and_last_post() {
    let batch = AppBatch {
        changes: vec![
            app_change(
                "a",
                ChangeOp::Update,
                json!({"_id":"a","rank":1}),
                json!({"_id":"a","rank":2}),
            ),
            app_change(
                "a",
                ChangeOp::Delete,
                json!({"_id":"a","rank":2}),
                Value::Null,
            ),
            app_change(
                "b",
                ChangeOp::Insert,
                Value::Null,
                json!({"_id":"b","rank":1}),
            ),
            app_change("b", ChangeOp::Delete, Value::Null, Value::Null),
        ],
    };
    let folded = fold_app_batch(&batch);
    assert_eq!(folded.len(), 1);
    assert_eq!(folded[0].row_key, "a");
    assert_eq!(folded[0].op, ChangeOp::Delete);
    assert_eq!(folded[0].pre_image.as_ref().unwrap()["rank"], 1);
    assert!(folded[0].post_image.is_none());
}

#[test]
fn delete_then_reinsert_nets_to_update_with_unknown_fields() {
    let batch = AppBatch {
        changes: vec![
            app_change(
                "a",
                ChangeOp::Delete,
                json!({"_id":"a","rank":1}),
                Value::Null,
            ),
            app_change(
                "a",
                ChangeOp::Insert,
                Value::Null,
                json!({"_id":"a","rank":3}),
            ),
        ],
    };
    let folded = fold_app_batch(&batch);
    assert_eq!(folded[0].op, ChangeOp::Update);
    assert_eq!(folded[0].pre_image.as_ref().unwrap()["rank"], 1);
    assert_eq!(folded[0].post_image.as_ref().unwrap()["rank"], 3);
    assert!(folded[0].changed_fields.is_empty());
}

#[test]
fn owner_missing_and_sql_null_actual_stay_out() {
    let operator: Operator = serde_json::from_value(json!({
        "form":"admit",
        "config":{
            "visibility":{"kind":"owner","field":"ownerId","userId":"u1"},
            "filters":[{"field":"rank","op":"Eq","literal":null}],
            "grain":"complete-scope"
        }
    }))
    .unwrap();
    let outcome = evaluate_operator(
        &operator,
        json!({"retained":{}}),
        json!({
            "changes":{"changes":[{
                "rowKey":"a","op":"insert","postImage":{"_id":"a","rank":null}
            }]}
        }),
        &ReadTranscript::default(),
    );
    assert_eq!(outcome["verdict"], "Maintain");
    assert_eq!(outcome["deltaOut"]["entries"][0]["admit"], "stay-out");
}

#[test]
fn window_two_enters_displace_two_rows_once() {
    let operator: Operator = serde_json::from_value(json!({
        "form":"window",
        "config":{
            "windowId":"w","order":[{"field":"rank","direction":"asc"}],
            "take":2,"projectionFields":["rank"]
        }
    }))
    .unwrap();
    let outcome = evaluate_operator(
        &operator,
        json!({
            "rows":[
                {"rowKey":"c","rankKeys":{"values":[3],"rowKey":"c"},"row":{"_id":"c","rank":3}},
                {"rowKey":"d","rankKeys":{"values":[4],"rowKey":"d"},"row":{"_id":"d","rank":4}}
            ],
            "boundary":{"values":[4],"rowKey":"d"},"resultCount":2,
            "complete":true,"label":"complete",
            "continuation":{"values":[4],"rowKey":"d"}
        }),
        json!({"entries":[
            {"rowKey":"a","op":"insert","postImage":{"_id":"a","rank":1},"admit":"enter","rankKeys":[1]},
            {"rowKey":"b","op":"insert","postImage":{"_id":"b","rank":2},"admit":"enter","rankKeys":[2]}
        ]}),
        &ReadTranscript::default(),
    );
    assert_eq!(outcome["verdict"], "Maintain");
    let ops = outcome["deltaOut"]["ops"].as_array().unwrap();
    assert_eq!(ops.iter().filter(|op| op["op"] == "splice-out").count(), 2);
    assert_eq!(ops.iter().filter(|op| op["op"] == "splice-in").count(), 2);
}

#[test]
fn fallback_reason_set_is_exact_and_closed() {
    let reasons = [
        FallbackReason::MissingImage,
        FallbackReason::PredicateUnanalyzable,
        FallbackReason::RankUndecidable,
        FallbackReason::BoundaryDisplacement,
        FallbackReason::CompletenessIndeterminate,
        FallbackReason::RekeyUnread,
        FallbackReason::ScopeUnfilled,
        FallbackReason::DemandIdentityTransition,
        FallbackReason::RefusalTransition,
        FallbackReason::SupportUnproved,
        FallbackReason::ScopeUnresolved,
        FallbackReason::UniqueViolation,
        FallbackReason::WireUnaddressable,
    ];
    assert_eq!(reasons.len(), 13);
    assert_eq!(serde_json::to_value(reasons).unwrap()[0], "missing-image");
    assert_eq!(
        serde_json::to_value(reasons).unwrap()[12],
        "wire-unaddressable"
    );
}

#[test]
#[should_panic(expected = "malformed E3 state in delta-semantics case")]
fn malformed_carrier_is_a_runner_error_not_a_semantics_verdict() {
    let operator: Operator = serde_json::from_value(json!({
        "form":"window",
        "config":{
            "windowId":"w","order":[{"field":"rank","direction":"asc"}],
            "take":1,"projectionFields":["rank"]
        }
    }))
    .unwrap();
    let _ = evaluate_operator(
        &operator,
        json!({"notAWindowState": true}),
        json!({"entries": []}),
        &ReadTranscript::default(),
    );
}

#[test]
#[should_panic(expected = "malformed E8 completeness carrier")]
fn assemble_completeness_set_mismatch_is_a_runner_error() {
    let operator: Operator = serde_json::from_value(json!({
        "form":"assemble",
        "config":{
            "rootNodeId":"root",
            "nodes":[{
                "nodeId":"root","parent":null,"kind":"root",
                "projection":{
                    "_id":{"kind":"field","sourceNode":"root","sourceField":"_id"}
                }
            }]
        }
    }))
    .unwrap();
    let _ = evaluate_operator(
        &operator,
        json!({"result":[{"_id":"p1"}],"orderedRootKeys":["p1"]}),
        json!({
            "events":[],
            "nextNodeOutputs":{"root":{"$root":[{"_id":"p1"}]}},
            "orderedRootKeys":["p1"],
            "nodeCompleteness":[],
            "proofTuple":{}
        }),
        &ReadTranscript::default(),
    );
}
