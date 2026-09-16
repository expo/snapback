use super::*;
use serde_json::json;
#[path = "../../../snapback4-sim/tests/papercuts/cases.rs"]
mod cases;
use cases::*;

#[test]
fn w9c_emit_only_lists_predict_and_replay_on_both_stores() {
    on_both(|host| {
        for (name, body, count) in LOOPS {
            let (mut engine, backend) = compile(&loop_source(body));
            engine.seed([("batches".into(), snapback4_core::wire::row_from_json(&backend.schema.tables["batches"], &json!({"id":"batch", "recipients":["bob","carol"], "numbers":[1,2,3]})).unwrap())].into_iter().chain(
                ["alice", "bob", "carol"].map(|p| ("members".into(), snapback4_core::value::object([("id", id(p)), ("principal", id(p))]))))).unwrap();
            let label = host.label();
            let mut device = host.open(name, Some(backend)).unwrap();
            for (n, page) in snapshot_pages(&mut engine, "alice", 10).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
            let prediction = ok(device.call(json!({"op":"predict", "name":"send", "viewer":"alice", "args":{"batchId":"batch"}, "now":100, "newIds":[]})));
            assert_eq!(prediction["result"], true, "{label}/{name}: {prediction}");
            assert_eq!(prediction["predicted"], json!([]));
            assert!(engine.effects(None, 10).unwrap().is_empty());
            let sent = engine.mutate("send", Some(name), context("alice", &[("batchId", id("batch"))]).at(100)).unwrap();
            assert!(matches!(sent.state, WriteState::Sent { result: Value::Bool(true), .. }));
            let effects = engine.effects(None, 10).unwrap();
            assert_eq!(effects.len(), *count);
            println!("{label} {name}: prediction succeeded, {count} authoritative emissions");
            device.close();
        }
    });
}

#[test]
fn w9c_unique_hook_and_legacy_refusals_on_both_stores() {
    on_both(|host| {
        for (n, (hook, code, message)) in [
            (" else HANDLE_TAKEN 'That handle is taken.'", "HANDLE_TAKEN", "That handle is taken."),
            (" else HANDLE_TAKEN", "HANDLE_TAKEN", "the program refused with HANDLE_TAKEN"),
            ("", "E_CONSTRAINT", "profiles.byHandle already has a row where handle = 'alice'"),
        ].into_iter().enumerate() {
            let (mut engine, backend) = compile(&profiles(hook));
            engine.seed([("profiles".into(), snapback4_core::wire::row_from_json(&backend.schema.tables["profiles"], &json!({"id":"p1", "handle":"alice"})).unwrap())]).unwrap();
            let label = host.label();
            let mut device = host.open(&format!("unique-{n}"), Some(backend)).unwrap();
            for (n, page) in snapshot_pages(&mut engine, "alice", 10).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
            let predicted = ok(device.call(json!({"op":"predict", "name":"create", "viewer":"alice", "args":{"handle":"alice"}, "newIds":["p2"], "now":100})));
            assert_eq!(predicted["denied"]["code"], code, "{label}: {predicted}");
            assert_eq!(predicted["denied"]["message"], message);
            if !hook.is_empty() { assert_eq!(predicted["denied"]["detail"], "profiles.byHandle already has a row where handle = 'alice'"); }
            assert_eq!(rows(&query(&mut *device, "all", "alice", json!({}), 100)).len(), 1);
            let positive = ok(device.call(json!({"op":"predict", "name":"create", "viewer":"alice", "args":{"handle":"bob"}, "newIds":["p3"], "now":100})));
            assert_eq!(positive["result"]["handle"], "bob");
            println!("{label} refusal: {}: {}; distinct handle predicts", predicted["denied"]["code"].as_str().unwrap(), message);
            device.close();
        }
    });
}
