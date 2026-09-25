use super::*;
mod unconfirmed;
mod review;
mod effect_reads;

#[path = "../../../snapback4-sim/tests/common/presence_meter.rs"]
mod presence_meter;
use presence_meter::{assert_i1, prediction_meter as w15a_prediction_meter};

#[test]
fn w15a_guarded_send_held_matches_grace_and_prediction_is_unchanged_on_both_stores() {
    use snapback4_device::store::DeviceStore;
    use snapback4_core::{Context, Presence};
    #[derive(Debug)]
    struct Poll(u64, Option<i64>);
    impl Presence for Poll {
        fn connections(&self, _: &str) -> u64 { self.0 }
        fn effect_presence(&self, _: &str) -> (u64, Option<i64>) { (self.0, self.1) }
    }
    fn scenario<S: DeviceStore>(mut store: S, label: &str, failures: &mut Vec<String>) {
        let source = "effect notify\nmutation push(p: principal):\n  if not exists connected[p]:\n    emit notify {recipient: p}\n";
        let (_, backend) = compile(source);
        assert_eq!(backend.schema.operations["push"].predicts.as_deref(), Some("eligible"));
        let ctx = || Context::new("alice", [("p".into(), id("bob"))].into()).at(11_000);
        store.install(&backend.schema, &Default::default(), false).unwrap();
        let program = backend.programs.iter().find(|p| p.name == "push").unwrap();
        let measured = w15a_prediction_meter(&mut store, &backend.schema, program, ctx());
        println!("w15a {label} device: {measured:?}");
        assert_eq!(measured.iter().map(|(_, count)| *count).collect::<Vec<_>>(), [0, 0, 0, 9, 513, 6, 0]);
        let mut meters = Vec::new();
        for (state, live, deadline) in [("held", 1, Some(16_000)), ("absent", 0, None), ("graced", 0, Some(36_000))] {
            let (mut engine, _) = compile(source);
            engine.set_presence(Some(std::sync::Arc::new(Poll(live, deadline))));
            let sent = engine.mutate("push", None, ctx()).unwrap();
            assert!(matches!(sent.state, WriteState::Sent { .. }));
            let effects = engine.effects(None, 10).unwrap();
            println!("w15a {label} server {state}: {:?}; effects={}", sent.metered, effects.len());
            let counters = w15a_meter_fields(sent.metered);
            // The base absent AND graced meters are [0, 0, 0, 9, 513, 6, 0].
            // Held must now take that same arm, without changing prediction.
            if counters != [0, 0, 0, 9, 513, 6, 0] { failures.push(format!("{label}/{state}: {counters:?}")); }
            meters.push(counters);
            if effects.len() != 1 { failures.push(format!("{label}/{state}: {} effects, expected 1", effects.len())); }
            else { assert_eq!(effects[0].next_at, deadline); }
        }
        assert_i1(&format!("minimal/{label}"), meters[0], meters[2], std::array::from_fn(|i| measured[i].1));
    }
    let mut failures = Vec::new();
    scenario(snapback4_core::Store::memory().unwrap(), "sqlite", &mut failures);
    scenario(snapback4_device::memory::MemoryStore::new(), "memory", &mut failures);
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

fn w15a_meter_fields(m: snapback4_core::meter::Metered) -> [u64; 7] {
    [m.examined, m.index_entries, m.rule_probes, m.steps, m.heap_bytes, m.output_bytes, m.rows_written]
}

const NOTES: &str = "effect notify\ntable notes:\n  n: int\n  unique byN: n\n  public 'notes'\n  sync public\n  insert <- allow\nquery notes():\n  return notes first 10 by byN\n";

#[derive(Debug)]
struct Online(Vec<String>);
impl snapback4_core::Presence for Online {
    fn connections(&self, principal: &str) -> u64 { self.0.iter().filter(|p| p.as_str() == principal).count() as u64 }
}

#[test]
fn presence_effects_send_predicts_identical_rows_on_both_stores() {
    on_both(|host| {
        for connected in [vec![], vec!["dev:bob"], vec!["dev:bob", "dev:carol"]] {
            let source = format!("{}\nquery message(id: messages):\n  return messages[id]\nquery online(p: principal):\n  return connected[p]\n", snapback4_lang::guide::quarry(snapback4_lang::guide::card("effects").unwrap())[0]);
            let (mut engine, mut backend) = compile(&source);
            engine.set_presence(Some(std::sync::Arc::new(Online(connected.iter().map(|p| (*p).into()).collect()))));
            engine.seed(["dev:alice", "dev:bob", "dev:carol"].iter().enumerate().map(|(n, p)| ("members".into(), snapback4_core::value::object([("id", id(&format!("m{n}"))), ("roomId", id("room")), ("principal", id(p))])))).unwrap();
            backend.generation = engine.generation();
            let label = host.label();
            let mut device = host.open(&format!("presence-{}", connected.len()), Some(backend)).unwrap();
            let pages = snapshot_pages(&mut engine, "dev:alice", 10);
            let from = pages.last().unwrap().watermark;
            for (n, page) in pages.iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
            let online = query(&mut *device, "online", "dev:alice", serde_json::json!({"p":"dev:bob"}), 1000);
            assert_eq!(online["complete"], false, "presence queries remain unknown on {label}");
            ok(device.call(serde_json::json!({ "op": "admit", "entry": Queued { id: "send-write".into(), seq: 1, op: "send".into(), args: serde_json::json!({"roomId":"room", "body":"offline hello"}), new_ids: vec!["msg".into()], predicted: vec![], viewer: "dev:alice".into(), now: 1234, predictable: true, sent_seq: None, receipt_store: None, observed_seq: None } })));
            let predicted = query(&mut *device, "message", "dev:alice", serde_json::json!({"id":"msg"}), 2000);
            assert_eq!(predicted["data"]["pending"], true, "{label}, connected={connected:?}: {predicted}");
            assert!(engine.store().rows("messages").unwrap().is_empty(), "the device admitted the row offline");
            assert!(engine.effects(None, 10).unwrap().is_empty());
            let sent = engine.mutate("send", Some("send-write"), context("dev:alice", &[("roomId", id("room")), ("body", Value::String("offline hello".into()))]).at(1234).with_ids(["msg".into()])).unwrap();
            let WriteState::Sent { seq, .. } = sent.state else { panic!("{:?}", sent.state) };
            let mut expected = predicted["data"].clone();
            expected.as_object_mut().unwrap().remove("pending");
            assert_eq!(expected, snapback4_core::wire::to_json(&engine.store().rows("messages").unwrap()[0]), "{label}, connected={connected:?}");
            let effects = engine.effects(Some("queued"), 10).unwrap();
            assert_eq!(effects.len(), 2);
            for effect in &effects {
                let target = effect.payload.field("targetUserId").unwrap().as_str().unwrap();
                assert_eq!(effect.next_at, connected.contains(&target).then_some(6_234));
            }
            let mut actual: Vec<_> = effects.iter().map(|e| { assert_eq!(e.effect, "notify"); e.payload.field("targetUserId").unwrap().as_str().unwrap() }).collect();
            actual.sort();
            assert_eq!(actual, ["dev:bob", "dev:carol"]);
            ok(device.call(serde_json::json!({"op":"settle", "id":"send-write", "seq":seq})));
            ok(apply(&mut *device, &stream_page(&mut engine, "dev:alice", from), false));
            let confirmed = query(&mut *device, "message", "dev:alice", serde_json::json!({"id":"msg"}), 2000);
            assert_ne!(confirmed["data"]["pending"], true);
            println!("{label}, connected={}: predicted rows=1, identical server rows=1, notify={}", connected.len(), effects.len());
            device.close();
        }
    });
}

#[test]
fn r1p_effect_ids_do_not_displace_rows_or_replay_ids_on_both_stores() {
    let mismatches = std::cell::RefCell::new(Vec::new());
    on_both(|host| {
        for count in 0..=2 {
            let source = format!("{NOTES}\nmutation probe(p: principal):\n  if not exists connected[p]:\n    emit notify {{ ordinal: 0 }}\n  a = insert notes {{ n: 1 }}\n  if connected[p] != 1:\n    emit notify {{ ordinal: 1 }}\n  b = insert notes {{ n: 2 }}\n  if connected[p] > 1:\n    emit notify {{ ordinal: 2 }}\n  return [a.id, b.id]\n");
            let (mut engine, backend) = compile(&source);
            engine.set_presence(Some(std::sync::Arc::new(Online(vec!["bob".into(); count]))));
            let label = host.label();
            let mut device = host.open(&format!("r1p-ids-{count}"), Some(backend)).unwrap();
            // A device predicts only after acquiring its generation's partition.
            for (n, page) in snapshot_pages(&mut engine, "alice", 10).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
            let predicted = ok(device.call(serde_json::json!({"op":"predict", "name":"probe", "viewer":"alice", "args":{"p":"bob"}, "now":1, "newIds":["A","B","C","D","E"]})));
            ok(device.call(serde_json::json!({"op":"withdraw", "predicted":predicted["predicted"]})));
            let admitted = ok(device.call(serde_json::json!({"op":"admit", "entry":Queued { id:"write".into(), seq:1, op:"probe".into(), args:serde_json::json!({"p":"bob"}), new_ids:vec!["A".into(), "B".into()], predicted:vec![], viewer:"alice".into(), now:1, predictable:true, sent_seq: None, receipt_store: None, observed_seq:None }})));
            assert_eq!(admitted["new_ids"], serde_json::json!(["A", "B"]));
            // Replaying over a stream page and reopening must keep precisely
            // the row supply, without any dropped effect ids in the queue.
            ok(apply(&mut *device, &stream_page(&mut engine, "alice", 0), false));
            device.close();
            let mut device = host.open(&format!("r1p-ids-{count}"), None).unwrap();
            assert_eq!(ok(device.call(serde_json::json!({"op":"queued"})))[0]["new_ids"], serde_json::json!(["A", "B"]));
            let sent = engine.mutate("probe", Some("write"), context("alice", &[("p", id("bob"))]).at(1).with_ids(["A","B","C","D","E"].map(str::to_owned))).unwrap();
            let WriteState::Sent { result, .. } = &sent.state else { panic!("{sent:?}") };
            let server_result = snapback4_core::wire::to_json(result);
            println!("{label} connected={count}: device result={}, server result={server_result}, new_ids={}", predicted["result"], predicted["new_ids"]);
            if predicted["result"] != server_result || predicted["new_ids"] != serde_json::json!(["A", "B"]) { mismatches.borrow_mut().push(format!("{label}/{count}: {} != {server_result}", predicted["result"])); }
            let mut local = query(&mut *device, "notes", "alice", serde_json::json!({}), 1)["data"].clone();
            for row in local.as_array_mut().unwrap() { row.as_object_mut().unwrap().remove("pending"); }
            let server = snapback4_core::wire::to_json(&Value::Array(engine.store().rows("notes").unwrap()));
            if local != server { mismatches.borrow_mut().push(format!("{label}/{count}: rows {local} != {server}")); }
            let effects = engine.effects(None, 10).unwrap();
            let replay = engine.mutate("probe", Some("write"), context("alice", &[("p", id("bob"))]).at(2)).unwrap();
            assert!(replay.replayed);
            assert!(matches!(replay.state, WriteState::Sent { .. }));
            assert_eq!(effects, engine.effects(None, 10).unwrap());
            let ids: std::collections::BTreeSet<_> = effects.iter().map(|e| &e.id).collect();
            assert_eq!(ids.len(), effects.len());
            if !ids.iter().all(|id| id.starts_with("effect-")) { mismatches.borrow_mut().push(format!("{label}/{count}: shared effect id supply {ids:?}")); }
            let claimed = engine.claim_effects("worker", None, 10, 1000, 2).unwrap();
            assert_eq!(claimed.len(), effects.iter().filter(|e| e.next_at.is_none()).count());
            engine.presence_reconnected("bob", 2).unwrap();
            for effect in &claimed { engine.settle_effect(&effect.id, "worker", snapback4_core::engine::effects::Settled::Done { result: None }, 3).unwrap(); }
            assert!(engine.claim_effects("worker", None, 10, 1000, 6_000).unwrap().is_empty());
            assert_eq!(engine.effects(Some("satisfied"), 10).unwrap().len(), usize::from(count > 0));
            device.close();
        }
    });
    assert!(mismatches.borrow().is_empty(), "{}", mismatches.borrow().join("\n"));
}

#[test]
fn r1p_presence_division_never_predicts_rolled_back_rows_on_both_stores() {
    let mismatches = std::cell::RefCell::new(Vec::new());
    on_both(|host| {
        for count in 0..=2 {
            let (mut engine, backend) = compile(&format!("{NOTES}\nmutation probe(p: principal):\n  insert notes {{ n: 1 }}\n  emit notify {{ ratio: 1 / connected[p] }}\n"));
            engine.set_presence(Some(std::sync::Arc::new(Online(vec!["bob".into(); count]))));
            let label = host.label();
            let mut device = host.open(&format!("r1p-div-{count}"), Some(backend)).unwrap();
            // A device predicts only after acquiring its generation's partition.
            for (n, page) in snapshot_pages(&mut engine, "alice", 10).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
            let predicted = ok(device.call(serde_json::json!({"op":"predict", "name":"probe", "viewer":"alice", "args":{"p":"bob"}, "now":1, "newIds":["A"]})));
            let sent = engine.mutate("probe", Some("write"), context("alice", &[("p", id("bob"))]).at(1).with_ids(["A".into()])).unwrap();
            println!("{label} division connected={count}: device={predicted}, server={:?}", sent.state);
            if predicted["denied"]["code"] != "E_PREDICT" { mismatches.borrow_mut().push(format!("{label}/{count}: {predicted}")); }
            if count == 0 { assert!(matches!(sent.state, WriteState::Failed { ref why, .. } if why.code == "E_DIV_ZERO")); assert!(engine.store().rows("notes").unwrap().is_empty()); }
            else { assert!(matches!(sent.state, WriteState::Sent { .. })); }
            device.close();
        }
    });
    assert!(mismatches.borrow().is_empty(), "{}", mismatches.borrow().join("\n"));
}

#[test]
fn r1p_presence_guard_pays_server_cost_on_both_stores() {
    use snapback4_device::store::{DeviceStore, DeviceTx};
    use snapback4_core::{Ceilings, engine::local};
    let mut mismatches = Vec::new();
    fn scenario<S: DeviceStore>(mut store: S, label: &str, mismatches: &mut Vec<String>) {
        let source = format!("{NOTES}\nmutation probe(p: principal):\n  insert notes {{ n: 1 }}\n  if not exists connected[p]:\n    emit notify {{ count: connected[p] }}\n");
        let (_, backend) = compile(&source);
        let program = backend.programs.iter().find(|p| p.name == "probe").unwrap();
        store.install(&backend.schema, &Default::default(), false).unwrap();
        let ctx = || context("alice", &[("p", id("bob"))]).at(1).with_ids(["A".into()]);
        let (mut full, _) = compile(&source);
        let maximum = full.mutate("probe", None, ctx()).unwrap().metered.steps;
        for ceiling in [maximum - 1, maximum] {
            let limits = Ceilings { steps: ceiling, ..Ceilings::default() };
            let tx = store.transaction().unwrap();
            let predicted = local::predict(&tx, &backend.schema, program, ctx(), limits);
            tx.rollback().unwrap();
            let (mut engine, _) = compile(&source);
            engine.set_ceilings(limits);
            let server = engine.mutate("probe", None, ctx()).unwrap();
            let accepted = matches!(server.state, WriteState::Sent { .. });
            println!("{label} ceiling={ceiling}: device success={}, server success={accepted}, server steps={}", predicted.is_ok(), server.metered.steps);
            if predicted.is_ok() != accepted { mismatches.push(format!("{label} ceiling={ceiling}: device={predicted:?}, server={server:?}")); }
        }
    }
    scenario(snapback4_core::Store::memory().unwrap(), "sqlite", &mut mismatches);
    scenario(snapback4_device::memory::MemoryStore::new(), "memory", &mut mismatches);
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
}

#[test]
fn a_meter_cut_after_an_untaken_presence_arm_queues_instead_of_refusing_on_both_stores() {
    use snapback4_device::store::{DeviceStore, DeviceTx};
    use snapback4_core::{Ceilings, RuntimeError, engine::local};
    fn scenario<S: DeviceStore>(mut store: S, label: &str) {
        let source = format!("{NOTES}\nmutation probe(p: principal):\n  insert notes {{ n: 1 }}\n  if connected[p] > 1:\n    emit notify {{ count: connected[p] }}\n");
        let (_, backend) = compile(&source);
        let program = backend.programs.iter().find(|p| p.name == "probe").unwrap();
        store.install(&backend.schema, &Default::default(), false).unwrap();
        let ctx = || context("alice", &[("p", id("bob"))]).at(1).with_ids(["A".into()]);
        // Bob is connected: the server skips the arm and needs fewer steps than the prediction pays.
        let (mut connected, _) = compile(&source);
        connected.set_presence(Some(std::sync::Arc::new(Online(vec!["bob".into()]))));
        let skipped = connected.mutate("probe", None, ctx()).unwrap().metered.steps;
        let limits = Ceilings { steps: skipped, ..Ceilings::default() };
        let (mut engine, _) = compile(&source);
        engine.set_presence(Some(std::sync::Arc::new(Online(vec!["bob".into()]))));
        engine.set_ceilings(limits);
        assert!(matches!(engine.mutate("probe", None, ctx()).unwrap().state, WriteState::Sent { .. }), "{label}: the server accepts at its own cost");
        let tx = store.transaction().unwrap();
        let predicted = local::predict(&tx, &backend.schema, program, ctx(), limits);
        tx.rollback().unwrap();
        match predicted {
            Ok(_) => {}
            Err(RuntimeError::Prediction(why)) => assert!(why.contains("queued without a predicted row"), "{label}: {why}"),
            Err(other) => panic!("{label}: the device must not refuse a write the server accepts: {other:?}"),
        }
    }
    scenario(snapback4_core::Store::memory().unwrap(), "sqlite");
    scenario(snapback4_device::memory::MemoryStore::new(), "memory");
}

#[test]
fn r1p_counterfactual_refinement_queues_and_separate_data_guard_predicts() {
    let mismatches = std::cell::RefCell::new(Vec::new());
    on_both(|host| {
        for separate in [false, true] {
            let guard = if separate { "  if text != null:\n    if not exists connected[p]:\n      emit notify { preview: slice(text, 0, 8) }" }
                else { "  if not exists connected[p] and text != null:\n    emit notify { preview: slice(text, 0, 8) }" };
            let (mut engine, backend) = compile(&format!("{NOTES}\nmutation probe(p: principal, text: text <=20 ?):\n  insert notes {{ n: 1 }}\n{guard}\n"));
            let label = host.label();
            let mut device = host.open(&format!("r1p-refinement-{separate}"), Some(backend)).unwrap();
            // A device predicts only after acquiring its generation's partition.
            for (n, page) in snapshot_pages(&mut engine, "alice", 10).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
            let prediction = ok(device.call(serde_json::json!({"op":"predict", "name":"probe", "viewer":"alice", "args":{"p":"bob","text":null}, "now":1, "newIds":["A"]})));
            if separate { assert!(prediction.get("denied").is_none(), "{prediction}"); }
            else if prediction["denied"]["code"] != "E_PREDICT" { mismatches.borrow_mut().push(format!("{label}: {prediction}")); }
            let sent = engine.mutate("probe", None, context("alice", &[("p", id("bob")), ("text", Value::Null)]).at(1).with_ids(["A".into()])).unwrap();
            assert!(matches!(sent.state, WriteState::Sent { .. }));
            assert!(engine.effects(None, 10).unwrap().is_empty());
            device.close();
        }
    });
    assert!(mismatches.borrow().is_empty(), "{}", mismatches.borrow().join("\n"));
}

#[test]
fn r1p_unconditional_payload_new_and_effect_only_commits_have_separate_ids() {
    let mismatches = std::cell::RefCell::new(Vec::new());
    on_both(|host| {
        let source = format!("{NOTES}\nmutation probe():\n  emit notify {{ key: new }}\n  a = insert notes {{ n: 1 }}\n  emit notify {{ key: new }}\n  b = insert notes {{ n: 2 }}\n  emit notify {{ key: new }}\n  return [a.id, b.id]\nmutation notifyOnly():\n  emit notify {{ ok: true }}\n");
        let (mut engine, backend) = compile(&source);
        let label = host.label();
        let mut device = host.open("r1p-new", Some(backend)).unwrap();
        // A device predicts only after acquiring its generation's partition.
        for (n, page) in snapshot_pages(&mut engine, "alice", 10).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        let ids = ["E0", "A", "E1", "B", "E2"];
        let prediction = ok(device.call(serde_json::json!({"op":"predict", "name":"probe", "viewer":"alice", "args":{}, "now":1, "newIds":ids})));
        let sent = engine.mutate("probe", Some("write"), context("alice", &[]).at(1).with_ids(ids.map(str::to_owned))).unwrap();
        println!("{label} payload new: prediction={prediction}, server={:?}", sent.state);
        if prediction["result"] != serde_json::json!(["A", "B"]) || prediction["new_ids"] != serde_json::json!(ids) { mismatches.borrow_mut().push(format!("{label}: {prediction}")); }
        if !matches!(sent.state, WriteState::Sent { ref result, .. } if snapback4_core::wire::to_json(result) == serde_json::json!(["A", "B"])) { mismatches.borrow_mut().push(format!("{label}: {:?}", sent.state)); }
        for write in ["only1", "only2"] { engine.mutate("notifyOnly", Some(write), context("alice", &[]).at(1)).unwrap(); }
        let effects = engine.effects(None, 10).unwrap();
        assert_eq!(effects.len(), 5);
        assert_eq!(effects.iter().map(|e| &e.id).collect::<std::collections::BTreeSet<_>>().len(), 5);
        for (write, name) in [("write", "probe"), ("only1", "notifyOnly"), ("only2", "notifyOnly")] { assert!(engine.mutate(name, Some(write), context("alice", &[]).at(2)).unwrap().replayed); }
        assert_eq!(effects, engine.effects(None, 10).unwrap());
        device.close();
    });
    assert!(mismatches.borrow().is_empty(), "{}", mismatches.borrow().join("\n"));
}


#[test]
fn grace_push_prediction_remains_identical_on_both_stores() {
    #[derive(Debug)]
    struct Grace;
    impl snapback4_core::Presence for Grace {
        fn connections(&self, _: &str) -> u64 { 1 }
        fn effect_presence(&self, _: &str) -> (u64, Option<i64>) { (0, Some(36_000)) }
    }
    on_both(|host| {
        let (mut engine, backend) = compile(&format!("{NOTES}\nmutation post(p: principal):\n  insert notes {{ n: 1 }}\n  if not exists connected[p]:\n    emit notify {{recipient: p}}\n"));
        assert_eq!(backend.schema.operations["post"].predicts.as_deref(), Some("eligible"));
        engine.set_presence(Some(std::sync::Arc::new(Grace)));
        let label = host.label();
        let mut device = host.open("grace-prediction", Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut engine, "alice", 10).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        let predicted = ok(device.call(serde_json::json!({"op":"predict", "name":"post", "viewer":"alice", "args":{"p":"bob"}, "now":11_000, "newIds":["message"]})));
        assert!(predicted.get("denied").is_none(), "{predicted}");
        let sent = engine.mutate("post", Some("write"), context("alice", &[("p", id("bob"))]).at(11_000).with_ids(["message".into()])).unwrap();
        assert!(matches!(sent.state, WriteState::Sent { .. }), "{sent:?}");
        let mut local = query(&mut *device, "notes", "alice", serde_json::json!({}), 11_000)["data"].clone();
        for row in local.as_array_mut().unwrap() { assert_eq!(row["pending"], true); row.as_object_mut().unwrap().remove("pending"); }
        assert_eq!(local, snapback4_core::wire::to_json(&Value::Array(engine.store().rows("notes").unwrap())));
        assert_eq!(engine.effects(None, 10).unwrap()[0].next_at, Some(36_000));
        engine.set_presence(None);
        assert_eq!(engine.claim_effects("worker", None, 10, 60_000, 36_000).unwrap().len(), 1);
        println!("grace prediction: store={} predicted_rows=1 identical_server_rows=1 deferred_effects=1", label);
        device.close();
    });
}

#[test]
fn w7r1_grace_bookkeeping_reservation_matches_both_device_stores() {
    use snapback4_device::store::{DeviceStore, DeviceTx};
    use snapback4_core::{Ceilings, engine::local};
    #[derive(Debug)]
    struct Grace(bool);
    impl snapback4_core::Presence for Grace {
        fn connections(&self, _: &str) -> u64 { u64::from(self.0) }
        fn effect_presence(&self, _: &str) -> (u64, Option<i64>) { (0, self.0.then_some(36_000)) }
    }
    fn scenario<S: DeviceStore>(mut store: S, label: &str, failures: &mut Vec<String>) {
        let source = format!("{NOTES}\nmutation probe(p: principal):\n  insert notes {{n: 1}}\n  online = exists connected[p]\n  if not online:\n    emit notify {{recipient: p, online}}\n");
        let (_, backend) = compile(&source);
        let program = backend.programs.iter().find(|p| p.name == "probe").unwrap();
        store.install(&backend.schema, &Default::default(), false).unwrap();
        let ctx = || context("alice", &[("p", id("bob"))]).at(11_000).with_ids(["note".into()]);
        let server = |grace, ceiling| {
            let (mut engine, _) = compile(&source);
            engine.set_presence(Some(std::sync::Arc::new(Grace(grace))));
            engine.set_ceilings(Ceilings { heap_bytes: ceiling, ..Default::default() });
            let sent = engine.mutate("probe", None, ctx()).unwrap();
            (sent, engine.store().rows("notes").unwrap())
        };
        let absent = server(false, 16 << 20).0.metered.heap_bytes;
        let grace = server(true, 16 << 20).0.metered.heap_bytes;
        for ceiling in [absent - 1, absent, grace - 1, grace] {
            let tx = store.transaction().unwrap();
            let predicted = local::predict(&tx, &backend.schema, program, ctx(), Ceilings { heap_bytes: ceiling, ..Default::default() });
            tx.rollback().unwrap();
            let (a, ar) = server(false, ceiling);
            let (b, br) = server(true, ceiling);
            let accepted = matches!(a.state, WriteState::Sent { .. });
            println!("w7r1 {label}: ceiling={ceiling} device={} absent={accepted} grace={} heap_absent={absent} heap_grace={grace}", predicted.is_ok(), matches!(b.state, WriteState::Sent { .. }));
            if a.state != b.state || ar != br || predicted.is_ok() != accepted { failures.push(format!("{label}/{ceiling}: device={predicted:?}, absent={a:?}, grace={b:?}")); }
            if ceiling >= absent.max(grace) { assert!(predicted.is_ok()); assert_eq!(ar.len(), 1); }
        }
    }
    let mut failures = Vec::new();
    scenario(snapback4_core::Store::memory().unwrap(), "sqlite", &mut failures);
    scenario(snapback4_device::memory::MemoryStore::new(), "memory", &mut failures);
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn w13b_unknown_presence_crosses_both_device_wires() {
    on_both(|host| {
        let (mut engine, backend) = compile("query online():\n  return connected[viewer]\nquery known():\n  return 42\n");
        let label = host.label();
        let mut device = host.open("presence-coverage", Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut engine, "alice", 10).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        let read = query(&mut *device, "online", "alice", serde_json::json!({}), 1);
        assert_eq!(read["complete"], false, "{label}: {read}");
        assert_eq!(read["unknown"], true, "{label}: presence is a fact only the server knows");
        assert_eq!(read["retained"], false);
        let known = query(&mut *device, "known", "alice", serde_json::json!({}), 1);
        assert_eq!(known["data"], 42); assert_eq!(known["complete"], true); assert_eq!(known["unknown"], false);
    });
}

#[test]
#[ignore = "pre-existing: issues/20260917-snapback4-presence-conjunction-server-charges-more-heap-than-prediction-reserves.md"]
fn w15a_necessary_absence_server_fits_prediction_reservation_on_both_stores() {
    use snapback4_device::store::{DeviceStore, DeviceTx};
    use snapback4_core::{Ceilings, engine::local};
    #[derive(Debug)]
    struct Grace;
    impl snapback4_core::Presence for Grace {
        fn connections(&self, _: &str) -> u64 { 1 }
        fn effect_presence(&self, _: &str) -> (u64, Option<i64>) { (0, Some(36_000)) }
    }
    fn scenario<S: DeviceStore>(mut store: S, label: &str, failures: &mut Vec<String>) {
        let source = "effect notify\nmutation push(p: principal, q: principal):\n  if not exists connected[p] and not exists connected[q]:\n    emit notify {}\n";
        let (_, backend) = compile(source);
        assert_eq!(backend.schema.operations["push"].predicts.as_deref(), Some("eligible"));
        store.install(&backend.schema, &Default::default(), false).unwrap();
        let program = backend.programs.iter().find(|p| p.name == "push").unwrap();
        let ctx = context("alice", &[("p", id("bob")), ("q", id("carol"))]).at(11_000);
        let predicted = w15a_prediction_meter(&mut store, &backend.schema, program, ctx.clone());
        let reserved_heap = predicted.iter().find(|(field, _)| *field == "heap_bytes").unwrap().1;
        for graced in [false, true] {
            let (mut engine, _) = compile(source);
            if graced { engine.set_presence(Some(std::sync::Arc::new(Grace))); }
            let sent = engine.mutate("push", None, ctx.clone()).unwrap();
            assert!(matches!(sent.state, WriteState::Sent { .. }), "{sent:?}");
            assert_eq!(engine.effects(None, 10).unwrap().len(), 1);
            let server = w15a_meter_fields(sent.metered);
            println!("w15a reservation {label} graced={graced}: device={predicted:?}; server={server:?}");
            // Positive boundary: both hosts admit at the server's measured heap.
            let limits = Ceilings { heap_bytes: sent.metered.heap_bytes, ..Default::default() };
            let tx = store.transaction().unwrap();
            let prediction = local::predict(&tx, &backend.schema, program, ctx.clone(), limits);
            tx.rollback().unwrap();
            assert!(prediction.is_ok(), "{prediction:?}");
            engine.set_ceilings(limits);
            assert!(matches!(engine.mutate("push", None, ctx.clone()).unwrap().state, WriteState::Sent { .. }));
            // The actual prediction entry point admits at its smaller boundary.
            let limits = Ceilings { heap_bytes: reserved_heap, ..Default::default() };
            let tx = store.transaction().unwrap();
            let prediction = local::predict(&tx, &backend.schema, program, ctx.clone(), limits);
            tx.rollback().unwrap();
            assert!(prediction.is_ok(), "{prediction:?}");
            engine.set_ceilings(limits);
            let boundary = engine.mutate("push", None, ctx.clone()).unwrap();
            println!("w15a boundary {label} graced={graced} heap={reserved_heap}: prediction=accepted server={:?}", boundary.state);
            if !matches!(boundary.state, WriteState::Sent { .. }) { failures.push(format!("{label} graced={graced}: prediction accepted but server {:?}", boundary.state)); }
            for ((field, reserved), used) in predicted.iter().zip(server) {
                if used > *reserved { failures.push(format!("{label} graced={graced}: {field} server={used} > prediction={reserved}")); }
            }
        }
    }
    let mut failures = Vec::new();
    scenario(snapback4_core::Store::memory().unwrap(), "sqlite", &mut failures);
    scenario(snapback4_device::memory::MemoryStore::new(), "memory", &mut failures);
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
