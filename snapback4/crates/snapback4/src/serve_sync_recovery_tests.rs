//! Exercise the actual discovery handler and device transaction, on both stores.
use super::*;
use snapback4_core::value::{object, Value};
use snapback4_device::{device::{Backend, Device}, store::DeviceStore};

const SOURCE: &str = "table posts:\n  body: text <=400000\n  read <- allow\n  sync public last 2 by byId\nquery posts():\n  return posts last 10 by byId\n";

fn fixture<S: DeviceStore>(open: impl FnOnce(Backend) -> Device<S>) -> (Engine, Device<S>) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let backend = Backend { generation: 1, schema: bound.schema.clone(), programs: bound.programs.into_iter().map(|p| p.program).collect() };
    let mut engine = Engine::memory(backend.schema.clone(), backend.programs.clone()).unwrap();
    seed(&mut engine, "p1", "small");
    seed(&mut engine, "p2", "small");
    let mut device = open(backend.clone());
    let page = snapshot(&mut engine);
    command(&mut device, json!({"op":"observe_store", "page":page}));
    device.adopt(backend).unwrap();
    command(&mut device, json!({"op":"apply", "page":page, "first":true}));
    (engine, device)
}

fn seed(engine: &mut Engine, id: &str, body: &str) {
    engine.seed([("posts".into(), object([("id", Value::Id(id.into())), ("body", Value::String(body.into()))]))]).unwrap();
}

fn command<S: DeviceStore>(device: &mut Device<S>, input: Json) -> Json {
    let result = snapback4_device::call::call(device, input);
    assert!(result.get("denied").is_none(), "{result}");
    result["ok"].clone()
}

fn snapshot(engine: &mut Engine) -> Json {
    let page = engine.snapshot_acquisition_page_at("alice", None, 100, 0).unwrap();
    serde_json::to_value(SnapshotReply { acquisitions: page.acquisitions, acknowledged: BTreeMap::new(), after: None,
        events: SyncEvents::Snapshot(page.events), generation: engine.generation(), held: page.held,
        more: false, next: None, snapshot: true, store_id: engine.store().meta("store_id").unwrap().unwrap(), watermark: page.watermark }).unwrap()
}

fn capture(state: &Json, from: u64, stream: bool) -> Json {
    json!({"store_id":state["store_id"], "generation":state["generation"], "send_revision":state["send_revision"],
        "captured_watermark":state["watermark"], "from":from, "stream":stream, "recover":true, "limit":1})
}

fn c1<S: DeviceStore>(open: impl FnOnce(Backend) -> Device<S>) {
    let (mut engine, mut device) = fixture(open);
    seed(&mut engine, "p3", "small");
    let state = command(&mut device, json!({"op":"sync_state"}));
    let input = serde_json::from_value(json!({"metadata":true,"recover":true,"store_id":state["store_id"],
        "generation":state["generation"],"send_revision":state["send_revision"],"from":2,"limit":1})).unwrap();
    // Fault at the inspection seam: the page is incomplete, but its tiny
    // event did not exceed the ordinary serializer's ceiling.
    ABORT_INSPECTION.with(|abort| abort.set(true));
    let metadata = inspect_engine(&mut engine, "alice", &input, 0);
    ABORT_INSPECTION.with(|abort| abort.set(false));
    if let Ok(metadata) = metadata {
        let wire = serde_json::to_value(&metadata).unwrap();
        assert_ne!(wire["recovery"]["snapshot"], true, "C1: the server itself must never grant an unmeasured abort");
        let _ = snapback4_device::call::call(&mut device, json!({"op":"sync_metadata","metadata":metadata,"capture":capture(&state, 2, false)}));
    }
    assert_eq!(command(&mut device, json!({"op":"sync_state"})), state, "C1: an incomplete unmeasured page must preserve acquisition and send revision");
}

fn c2<S: DeviceStore>(open: impl FnOnce(Backend) -> Device<S>) {
    let (mut engine, mut device) = fixture(open);
    let mut staged = snapshot(&mut engine);
    staged["stage_snapshot"] = json!(true);
    command(&mut device, json!({"op":"apply","page":staged,"first":true}));
    // One small commit is confirmed normally while the old lease stays at 2.
    // Later current-image growth makes that same commit genuinely oversized
    // for a request from 2, although the device has already confirmed it at 3.
    engine.seed((0..48).map(|i| ("posts".into(), object([("id", Value::Id(format!("p3-{i:02}"))), ("body", Value::String("small".into()))])))).unwrap();
    let page = engine.stream_at("alice", 2, 100, 0).unwrap();
    let page = serde_json::to_value(StreamReply { images_at: page.images_at, committed_above: BTreeMap::new(), acquisitions: page.acquisitions, acknowledged: BTreeMap::new(),
        events: SyncEvents::Stream(page.events), generation: engine.generation(), joined: page.joined,
        more: page.more, snapshot: false, store_id: engine.store().meta("store_id").unwrap().unwrap(), watermark: page.watermark }).unwrap();
    command(&mut device, json!({"op":"apply","page":page}));
    let state = command(&mut device, json!({"op":"sync_state"}));
    assert_eq!(state["watermark"], 3);
    let held_before = command(&mut device, json!({"op":"query","name":"posts","viewer":"alice","args":{},"now":0}));
    let lease_before = device.store().meta("device:snapshot:owner").unwrap();
    assert!(lease_before.is_some());
    for n in (0..48).step_by(4) {
        engine.seed((n..n+4).map(|i| ("posts".into(), object([("id", Value::Id(format!("p3-{i:02}"))), ("body", Value::String("x".repeat(400000)))])))).unwrap();
    }
    let input = serde_json::from_value(json!({"metadata":true,"recover":true,"stream":true,"store_id":state["store_id"],
        "generation":state["generation"],"send_revision":state["send_revision"],"from":2,"limit":1})).unwrap();
    let metadata = serde_json::to_value(inspect_engine(&mut engine, "alice", &input, 0).unwrap()).unwrap();
    assert_eq!(metadata["recovery"]["snapshot"], true, "the real server measured an overflow at the obsolete position");
    let result = snapback4_device::call::call(&mut device, json!({"op":"sync_metadata","metadata":metadata,"capture":capture(&state, 2, true)}));
    assert_eq!(result["denied"]["code"], "E_GENERATION", "C2: a live matching lease below the captured watermark has no reset authority: {result}");
    assert_eq!(command(&mut device, json!({"op":"sync_state"})), state);
    assert_eq!(device.store().meta("device:snapshot:owner").unwrap(), lease_before);
    assert_eq!(command(&mut device, json!({"op":"query","name":"posts","viewer":"alice","args":{},"now":0})), held_before);
}

fn memory(backend: Backend) -> Device<snapback4_device::memory::MemoryStore> {
    Device::open_store(snapback4_device::memory::MemoryStore::new(), Some(backend)).unwrap()
}
#[test] fn round3_c1_memory() { c1(memory); }
#[test] fn round3_c1_sqlite() { with_device_file(|path| c1(|b| Device::open(path, Some(b)).unwrap())); }
#[test] fn round3_c2_memory() { c2(memory); }
#[test] fn round3_c2_sqlite() { with_device_file(|path| c2(|b| Device::open(path, Some(b)).unwrap())); }

fn measured<S: DeviceStore>(open: impl FnOnce(Backend) -> Device<S>) {
    let (mut engine, mut device) = fixture(open);
    let state = command(&mut device, json!({"op":"sync_state"}));
    let rows = (0..48).map(|i| ("posts".into(), object([("id", Value::Id(format!("wide-{i:02}"))), ("body", Value::String("small".into()))])));
    engine.seed(rows).unwrap();
    for i in 0..48 { seed(&mut engine, &format!("wide-{i:02}"), &"x".repeat(400000)); }
    let input: SyncRequest = serde_json::from_value(json!({"metadata":true,"recover":true,"store_id":state["store_id"],
        "generation":state["generation"],"send_revision":state["send_revision"],"from":2,"limit":1})).unwrap();
    let ordinary = sync_stream::stream(&mut engine, "alice", &input, 0).unwrap();
    assert!(serde_json::to_writer(&mut JsonBuffer(Vec::new()), &ordinary).is_err(), "ordinary StreamReply must really exceed the unchanged ceiling");
    let metadata = serde_json::to_value(inspect_engine(&mut engine, "alice", &input, 0).unwrap()).unwrap();
    assert_eq!(metadata["recovery"]["snapshot"], true);
    assert_eq!(metadata["recovery"]["store_id"], state["store_id"]);
    assert_eq!(metadata["recovery"]["generation"], state["generation"]);
    assert!(metadata.get("events").is_none());
    for limit in [json!(0), json!(2), Json::Null] {
        let mut incorrect = capture(&state, 2, false);
        if limit.is_null() { incorrect.as_object_mut().unwrap().remove("limit"); }
        else { incorrect["limit"] = limit; }
        let result = snapback4_device::call::call(&mut device, json!({"op":"sync_metadata","metadata":metadata,"capture":incorrect}));
        assert_eq!(result["denied"]["code"], "E_GENERATION", "a derived recover flag cannot replace the actual limit: {result}");
        assert_eq!(command(&mut device, json!({"op":"sync_state"})), state);
    }
    for field in ["from", "store_id", "generation"] {
        let mut mismatched = metadata.clone();
        mismatched["recovery"][field] = if field == "store_id" { json!("foreign") } else { json!(999) };
        let result = snapback4_device::call::call(&mut device, json!({"op":"sync_metadata","metadata":mismatched,"capture":capture(&state, 2, false)}));
        assert_eq!(result["denied"]["code"], "E_GENERATION", "{field}: {result}");
        assert_eq!(command(&mut device, json!({"op":"sync_state"})), state);
    }
    let mut continuation = capture(&state, 2, false);
    continuation["after"] = json!("snapshot-position");
    assert_eq!(snapback4_device::call::call(&mut device, json!({"op":"sync_metadata","metadata":metadata,"capture":continuation}))["denied"]["code"], "E_GENERATION");
    // A successor generation takes precedence over even a supplied grant.
    let mut successor = metadata.clone();
    successor["generation"] = json!(state["generation"].as_u64().unwrap() + 1);
    let observed = command(&mut device, json!({"op":"sync_metadata","metadata":successor,"capture":capture(&state, 2, false)}));
    assert_eq!(observed["snapshot"], false);
    assert_eq!(observed["backend_required"], true);
    assert_eq!(command(&mut device, json!({"op":"sync_state"})), state);
    let result = command(&mut device, json!({"op":"sync_metadata","metadata":metadata,"capture":capture(&state, 2, false)}));
    assert_eq!(result["snapshot"], true);
    assert_eq!(command(&mut device, json!({"op":"sync_state"}))["snapshot_required"], true);
    // Establish the real backend-required marker via identity observation;
    // public set_meta writes only client metadata and cannot emulate it.
    command(&mut device, json!({"op":"observe_store", "page":{
        "store_id":"replacement", "watermark":0, "snapshot":false, "events":[], "more":false}}));
    let waiting = command(&mut device, json!({"op":"sync_state"}));
    let mut pending = metadata.clone();
    pending["store_id"] = json!("replacement");
    let observed = command(&mut device, json!({"op":"sync_metadata","metadata":pending,"capture":capture(&waiting, 0, true)}));
    assert_eq!(observed["snapshot"], false);
    assert_eq!(observed["backend_required"], true);
    assert_eq!(command(&mut device, json!({"op":"sync_state"})), waiting);
}

#[test] fn measured_inspect_engine_grants_memory() { measured(|b| Device::open_store(snapback4_device::memory::MemoryStore::new(), Some(b)).unwrap()); }
#[test] fn measured_inspect_engine_grants_sqlite() { with_device_file(|path| measured(|b| Device::open(path, Some(b)).unwrap())); }

#[test]
fn discovery_requires_identity_and_does_not_measure_the_tip_or_a_snapshot_cursor() {
    let (mut engine, mut device) = fixture(|b| Device::open_store(snapback4_device::memory::MemoryStore::new(), Some(b)).unwrap());
    let state = command(&mut device, json!({"op":"sync_state"}));
    for store_id in [json!(null), json!("")] {
        let input = serde_json::from_value(json!({"metadata":true,"store_id":store_id})).unwrap();
        assert!(matches!(inspect_engine(&mut engine, "alice", &input, 0), Err(RuntimeError::Input(_))));
    }
    for (from, after) in [(2, None), (1, Some("snapshot-position"))] {
        let input = serde_json::from_value(json!({"metadata":true,"recover":true,"store_id":state["store_id"],
            "generation":state["generation"],"send_revision":state["send_revision"],"from":from,"after":after,"limit":1})).unwrap();
        ABORT_INSPECTION.with(|abort| abort.set(true));
        let result = inspect_engine(&mut engine, "alice", &input, 0);
        ABORT_INSPECTION.with(|abort| abort.set(false));
        assert!(serde_json::to_value(result.unwrap()).unwrap().get("recovery").is_none());
    }
}

fn with_device_file(run: impl FnOnce(&std::path::Path)) {
    let dir = std::env::temp_dir().join(format!("sb4-recovery-device-{}-{:?}", std::process::id(), std::thread::current().id()));
    std::fs::create_dir_all(&dir).unwrap();
    run(&dir.join("device.sqlite"));
    std::fs::remove_dir_all(dir).unwrap();
}
