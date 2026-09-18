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
            let before = rows(&query(&mut *device, "all", "alice", json!({}), 100)).clone();
            let rename = ok(device.call(json!({"op":"predict", "name":"rename", "viewer":"alice", "args":{"profile":"p3", "handle":"alice"}, "newIds":[], "now":100})));
            assert_eq!(rename["denied"], predicted["denied"], "{label}: update keeps the insert collision's code, message and detail");
            assert_eq!(rows(&query(&mut *device, "all", "alice", json!({}), 100)), &before, "{label}: a refused update rolls back");
            let absent = ok(device.call(json!({"op":"predict", "name":"tryCreate", "viewer":"alice", "args":{"handle":"alice"}, "newIds":["p4"], "now":100})));
            assert!(absent.get("denied").is_none(), "{label}: {absent}");
            assert_eq!(absent.get("result"), Some(&json!(null)));
            assert_eq!(absent["predicted"], json!([]));
            assert_eq!(rows(&query(&mut *device, "all", "alice", json!({}), 100)), &before);
            let renamed = ok(device.call(json!({"op":"predict", "name":"rename", "viewer":"alice", "args":{"profile":"p3", "handle":"carol"}, "newIds":[], "now":100})));
            assert!(renamed.get("denied").is_none(), "{label}: {renamed}");
            assert_eq!(renamed["predicted"], json!(["profiles/p3"]));
            assert!(rows(&query(&mut *device, "all", "alice", json!({}), 100)).iter().any(|row| row["id"] == "p3" && row["handle"] == "carol"));
            let created = ok(device.call(json!({"op":"predict", "name":"tryCreate", "viewer":"alice", "args":{"handle":"dave"}, "newIds":["p5"], "now":100})));
            assert_eq!(created["result"]["handle"], "dave");
            assert_eq!(created["predicted"], json!(["profiles/p5"]));
            assert_eq!(rows(&query(&mut *device, "all", "alice", json!({}), 100)).len(), 3);
            println!("{label} refusal: {}: {}; create and update collisions agree; if absent returns null; all 3 distinct writes predict", predicted["denied"]["code"].as_str().unwrap(), message);
            device.close();
        }
    });
}

#[test]
fn w9r1b_hidden_unique_collisions_queue_and_settle_on_both_stores() {
    let source = profiles(" else HANDLE_TAKEN 'That handle is taken.'").replace("  public 'profiles'", "  owner: principal default viewer\n  read <- .owner = viewer").replace("  sync\n", "  by byOwner: owner, id\n  sync to .owner\n");
    on_both(|host| {
        for name in ["create", "rename", "tryCreate"] {
            for handle in ["alice", "available"] {
                let (mut engine, backend) = compile(&source);
                engine.seed([json!({"id":"p1", "handle":"alice", "owner":"alice"}), json!({"id":"p3", "handle":"bob", "owner":"bob"})].into_iter().map(|row| {
                    ("profiles".into(), snapback4_core::wire::row_from_json(&backend.schema.tables["profiles"], &row).unwrap())
                })).unwrap();
                let label = host.label();
                let mut device = host.open_as(&format!("hidden-{name}-{handle}"), Some(backend), "bob").unwrap();
                for (n, page) in snapshot_pages(&mut engine, "bob", 10).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
                let input = if name == "rename" { json!({"profile":"p3", "handle":handle}) } else { json!({"handle":handle}) };
                let entry = Queued { id: "write".into(), seq: 1, op: name.into(), args: input, viewer: "bob".into(), now: 100, new_ids: vec!["p2".into()], predicted: vec![], predictable: true, sent_seq: None, observed_seq: None };
                let queued = ok(device.call(json!({"op":"admit", "entry":entry})));
                let pending = query(&mut *device, "all", "bob", json!({}), 100);
                assert!(rows(&pending).iter().all(|row| row["owner"] == "bob"), "{label}/{name}: predictions cannot reveal the hidden row");
                let args = if name == "rename" { vec![("profile", id("p3")), ("handle", Value::String(handle.into()))] } else { vec![("handle", Value::String(handle.into()))] };
                let result = engine.mutate(name, Some("write"), context("bob", &args).at(100).with_ids(["p2".into()])).unwrap();
                let seq = match result.state {
                    WriteState::Failed { why, .. } => {
                        assert_eq!(handle, "alice");
                        assert_eq!(why.code, "E_RULE");
                        assert!(why.detail.is_none());
                        assert!(!why.message.contains("byHandle"));
                        None
                    }
                    WriteState::Sent { seq, .. } => { assert_eq!(handle, "available"); Some(seq) }
                };
                ok(device.call(json!({"op":"settle", "id":"write", "seq":seq})));
                for (n, page) in snapshot_pages(&mut engine, "bob", 10).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
                let read = query(&mut *device, "all", "bob", json!({}), 100);
                assert!(rows(&read).iter().all(|row| row["owner"] == "bob"));
                assert_eq!(rows(&read).iter().any(|row| row["handle"] == "available"), handle == "available");
                if seq.is_none() { assert_eq!(rows(&read).iter().map(|row| row["handle"].as_str().unwrap()).collect::<Vec<_>>(), ["bob"]); }
                println!("{label} {name}/{handle}: predictable={}, settled {}", queued["predictable"], if seq.is_some() { "sent" } else { "E_RULE without detail" });
                device.close();
            }
        }
    });
}
