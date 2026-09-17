use super::*;

const SELF_WITNESS: &str = r#"
table messages:
  roomId: id
  principal: principal
  body: text <=100
  unique byRoomPrincipal: roomId, principal
  by byRoom: roomId, id
  by byWords: roomId, words(body), id
  read <- exists messages[.roomId, .principal] and .body = 'coffee'
query plain():
  return messages['r'] first 10 by byRoom
query matching():
  return messages['r'] matching 'cof' first 10 by byWords
"#;

fn self_witness_store<S: snapback4_device::store::DeviceStore>(mut store: S) {
    use snapback4_core::{engine::{local, runner::Runner}, meter::{Ceilings, Cut, Meter}, rows::Rows};
    let (mut engine, backend) = compile(SELF_WITNESS);
    let seed = [("coffee", "alice", "coffee"), ("other", "bob", "coffers")].map(|(name, viewer, body)| ("messages".into(), snapback4_core::value::object([
        ("id", id(name)), ("roomId", id("r")), ("principal", id(viewer)), ("body", Value::String(body.into()))])));
    engine.seed(seed.clone()).unwrap();
    store.install(&backend.schema, &Default::default(), true).unwrap();
    let tx = store.transaction().unwrap();
    // As in the membership suite, install online-only candidates to exercise
    // real rule evaluation, including the refused candidate, on each store.
    for (name, row) in &seed { tx.put(name, &backend.schema.tables[name], row, None).unwrap(); }
    for program in &backend.programs {
        let context = || context("alice", &[]).at(100);
        let server = engine.query(&program.name, context()).unwrap();
        let expected = serde_json::json!([{"id":"coffee","roomId":"r","principal":"alice","body":"coffee"}]);
        let local = local::query(&tx, &backend.schema, program, context(), Ceilings::default()).unwrap();
        assert_eq!(snapback4_core::wire::to_json(&local.data), expected);
        assert_eq!(snapback4_core::wire::to_json(&server.data), expected);
        assert!(!local.complete, "online-only coverage remains unknown");
        // The public device query always caps; exercise both engine cuts on
        // the same device transaction without changing mutation admission.
        for cut in [Cut::Cap, Cut::Abort] {
            let mut runner = Runner::new(&tx, &backend.schema, context(), Meter::new(Ceilings::default(), cut), 0);
            let result = runner.run(program).unwrap();
            assert_eq!(snapback4_core::wire::to_json(&result), expected, "{} {cut:?}", program.name);
        }
    }
}

#[test]
fn r2_n2_self_witness_plain_and_matching_sqlite_both_cuts() {
    let host = Sqlite::new("r2-self-witness");
    let path = host.path("self-witness");
    let (_, backend) = compile(SELF_WITNESS);
    drop(snapback4_device::device::Device::open(&path, Some(backend)).unwrap());
    self_witness_store(snapback4_core::Store::open(&path).unwrap());
}

#[test]
fn r2_n2_self_witness_plain_and_matching_memory_both_cuts() {
    self_witness_store(snapback4_device::memory::MemoryStore::new());
}

#[test]
fn r2_n3_mixed_returned_history_exposes_independent_components() {
    on_both(|host| history_device(host, |device, engine| {
        let local = query(device, "both", "dev:bob", serde_json::json!({}), 100);
        assert_eq!(local["data"]["left"].as_array().unwrap().len(), 25);
        assert_eq!(local["data"]["held"].as_array().unwrap().len(), 25);
        assert_eq!(local["complete"], false);
        assert_eq!(local["unknown"], true);
        assert_eq!(local["retained"], false, "unknown held coverage selects whole-query server fallback online");
        assert_eq!(local["components"], serde_json::json!({
            "left": {"complete": false, "unknown": false, "retained": true},
            "held": {"complete": false, "unknown": true, "retained": false}
        }));
        let expected = |room: &str, start| serde_json::Value::Array((start..26).rev().map(|at| serde_json::json!({"id": format!("{room}-{at}"), "room": room, "at": at, "body": if at == 0 {"needle"} else {"coffee car"}})).collect());
        assert_eq!(local["data"], serde_json::json!({"left": expected("left", 1), "held": expected("held", 1)}));
        let server = engine.query("both", context("dev:bob", &[]).at(100)).unwrap();
        assert!(serde_json::to_value(&server).unwrap().get("components").is_none(), "the server sends no component map");
        let server = snapback4_core::wire::to_json(&server.data);
        assert_eq!(server["left"], serde_json::json!([]));
        assert_eq!(server["held"].as_array().unwrap().len(), 26);
        // The independent left query stays on the device even when online.
        let left = query(device, "left", "dev:bob", serde_json::json!({}), 100);
        assert_eq!(rows(&left).len(), 25);
        assert_eq!(left["retained"], true);
    }));
}

#[test]
fn retained_point_hits_and_misses_on_both_stores() {
    on_both(|host| history_device(host, |device, _| {
        for name in ["pointMiss", "pointIndex", "pointId", "pointExists"] {
            let local = query(device, name, "dev:bob", serde_json::json!({}), 100);
            let hit = name != "pointMiss";
            assert_eq!(local["components"]["left"], serde_json::json!({"complete": hit, "unknown": !hit, "retained": hit}), "{name}");
            assert_eq!(local["retained"], false, "whole query words do not change");
            assert_eq!(local["unknown"], true);
            assert_eq!(local["complete"], false);
            assert_eq!(local["data"]["held"].as_array().unwrap().len(), 25);
            if name == "pointExists" { assert_eq!(local["data"]["left"], true); }
            else if hit { assert_eq!(local["data"]["left"]["id"], "left-25"); }
            else { assert!(local["data"]["left"].is_null()); }
        }
    }));
}

#[test]
fn compatible_adoption_keeps_retained_components_on_both_stores() {
    on_both(|host| history_device(host, |device, engine| {
        let before = query(device, "both", "dev:bob", serde_json::json!({}), 100);
        assert_eq!(before["data"]["left"].as_array().unwrap().len(), 25);
        let (_, mut backend) = compile(&format!("{HISTORY}\nquery adoptionMarker():\n  return true\n"));
        backend.generation = engine.adopt(backend.schema.clone(), backend.programs.clone()).unwrap();
        ok(device.call(serde_json::json!({"op": "adopt", "backend": backend})));
        let unacquired = query(device, "both", "dev:bob", serde_json::json!({}), 100);
        assert_eq!(unacquired["denied"]["code"], "E_PREDICT", "program adoption still requires acquisition");
        for (n, page) in snapshot_pages(engine, "dev:bob", 100).iter().enumerate() { ok(apply(device, page, n == 0)); }
        let after = query(device, "both", "dev:bob", serde_json::json!({}), 100);
        assert_eq!(after["data"], before["data"]);
        assert_eq!(after["components"], before["components"]);
    }));
}
