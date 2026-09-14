use super::*;

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
            for (n, page) in snapshot_pages(&mut engine, "dev:alice", 10).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
            let online = query(&mut *device, "online", "dev:alice", serde_json::json!({"p":"dev:bob"}), 1000);
            assert_eq!(online["complete"], false, "presence queries remain unknown on {label}");
            ok(device.call(serde_json::json!({ "op": "admit", "entry": Queued { id: "send-write".into(), seq: 1, op: "send".into(), args: serde_json::json!({"roomId":"room", "body":"offline hello"}), new_ids: vec!["msg".into()], predicted: vec![], viewer: "dev:alice".into(), now: 1234, predictable: true, sent_seq: None, observed_seq: None } })));
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
            assert_eq!(effects.len(), 2 - connected.len());
            let mut actual: Vec<_> = effects.iter().map(|e| { assert_eq!(e.effect, "notify"); e.payload.field("targetUserId").unwrap().as_str().unwrap() }).collect();
            actual.sort();
            assert_eq!(actual, ["dev:bob", "dev:carol"].into_iter().filter(|p| !connected.contains(p)).collect::<Vec<_>>());
            ok(device.call(serde_json::json!({"op":"settle", "id":"send-write", "seq":seq})));
            ok(apply(&mut *device, &stream_page(&mut engine, "dev:alice", 0), false));
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
            let predicted = ok(device.call(serde_json::json!({"op":"predict", "name":"probe", "viewer":"alice", "args":{"p":"bob"}, "now":1, "newIds":["A","B","C","D","E"]})));
            ok(device.call(serde_json::json!({"op":"withdraw", "predicted":predicted["predicted"]})));
            let admitted = ok(device.call(serde_json::json!({"op":"admit", "entry":Queued { id:"write".into(), seq:1, op:"probe".into(), args:serde_json::json!({"p":"bob"}), new_ids:vec!["A".into(), "B".into()], predicted:vec![], viewer:"alice".into(), now:1, predictable:true, sent_seq:None, observed_seq:None }})));
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
            let replay = engine.mutate("probe", Some("write"), context("alice", &[]).at(2)).unwrap();
            assert!(replay.replayed);
            assert!(matches!(replay.state, WriteState::Sent { .. }));
            assert_eq!(effects, engine.effects(None, 10).unwrap());
            let ids: std::collections::BTreeSet<_> = effects.iter().map(|e| &e.id).collect();
            assert_eq!(ids.len(), effects.len());
            if !ids.iter().all(|id| id.starts_with("effect-")) { mismatches.borrow_mut().push(format!("{label}/{count}: shared effect id supply {ids:?}")); }
            let claimed = engine.claim_effects("worker", None, 10, 1000, 2).unwrap();
            assert_eq!(claimed.len(), effects.len());
            for effect in &claimed { engine.settle_effect(&effect.id, "worker", snapback4_core::engine::effects::Settled::Done { result: None }, 3).unwrap(); }
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
        let source = format!("{NOTES}\nmutation probe(p: principal):\n  insert notes {{ n: 1 }}\n  if not exists connected[p]:\n    emit notify {{ count: connected[p] }}\n");
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
        for write in ["write", "only1", "only2"] { assert!(engine.mutate("notifyOnly", Some(write), context("alice", &[]).at(2)).unwrap().replayed); }
        assert_eq!(effects, engine.effects(None, 10).unwrap());
        device.close();
    });
    assert!(mismatches.borrow().is_empty(), "{}", mismatches.borrow().join("\n"));
}
