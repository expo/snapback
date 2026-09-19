//! Round-three server boundary tests. These exercise the real typed handler,
//! not a JSON recovery flag assembled by the test.
use super::*;
use snapback4_core::value::{object, Value};

fn engine(file: bool) -> (Engine, Option<std::path::PathBuf>) {
    let source = "table items:\n  body: text <=400000\n  read <- allow\n  sync public\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let path = file.then(|| std::env::temp_dir().join(format!("sb4-round3-grant-{}-{:?}.sqlite", std::process::id(), std::thread::current().id())).join("store.sqlite"));
    if let Some(path) = &path { std::fs::create_dir_all(path.parent().unwrap()).unwrap(); }
    let store = path.as_ref().map_or_else(snapback4_core::Store::memory, |path| snapback4_core::Store::open(path)).unwrap();
    let engine = Engine::new(store, bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    (engine, path)
}
fn request(engine: &Engine, from: u64) -> SyncRequest {
    serde_json::from_value(json!({"metadata":true,"recover":true,"store_id":engine.store().meta("store_id").unwrap(),
        "generation":engine.generation(),"send_revision":7,"from":from,"limit":1})).unwrap()
}
fn reply(engine: &mut Engine, input: &SyncRequest) -> Json {
    serde_json::to_value(metadata(engine, "alice", input, 0).unwrap()).unwrap()
}
fn seed(engine: &mut Engine, start: usize, count: usize, body: &str) {
    engine.seed((start..start+count).map(|i| ("items".into(), object([("id",Value::Id(format!("row-{i:03}"))), ("body",Value::String(body.into()))])))).unwrap();
}
#[test]
fn round3_metadata_requires_identity_and_never_measures_tip_or_snapshot_cursor() {
    let (mut engine, _) = engine(false);
    seed(&mut engine, 0, 1, "small");
    let mut input = request(&engine, 1);
    for id in [None, Some(String::new())] {
        input.store_id = id;
        assert!(matches!(metadata(&mut engine, "alice", &input, 0), Err(RuntimeError::Input(_))));
    }
    input = request(&engine, 1);
    ABORT_INSPECTION.with(|abort| abort.set(true));
    let tip = metadata(&mut engine, "alice", &input, 0);
    ABORT_INSPECTION.with(|abort| abort.set(false));
    assert!(serde_json::to_value(tip.unwrap()).unwrap().get("recovery").is_none());
    seed(&mut engine, 1, 1, "small");
    input.after = Some("snapshot-cursor".into());
    ABORT_INSPECTION.with(|abort| abort.set(true));
    let continuation = metadata(&mut engine, "alice", &input, 0);
    ABORT_INSPECTION.with(|abort| abort.set(false));
    assert!(serde_json::to_value(continuation.unwrap()).unwrap().get("recovery").is_none());
    input.after = None;
    input.store_id = Some("other-store".into());
    let foreign = reply(&mut engine, &input);
    assert_ne!(foreign["store_id"], "other-store");
    assert!(foreign.get("recovery").is_none());
}

fn measured(file: bool) {
    let (mut engine, path) = engine(file);
    seed(&mut engine, 0, 1, "small");
    let input = request(&engine, 1);
    seed(&mut engine, 1, 48, "small");
    let fit = reply(&mut engine, &input);
    assert!(fit.get("recovery").is_none());
    assert!(serde_json::to_vec(&stream(&mut engine, "alice", &input, 0).unwrap()).unwrap().len() < JSON_RESPONSE_CEILING);
    // Existing log puts acquire larger current images without changing the
    // request position; the measurement must use the ordinary stream's view.
    for i in (1..49).step_by(4) { seed(&mut engine, i, 4, &"x".repeat(400000)); }
    let mut reader = if file { Some(engine.reader().unwrap()) } else { None };
    let engine = reader.as_mut().unwrap_or(&mut engine);
    let measured = reply(engine, &input);
    assert_eq!(measured["recovery"], json!({"from":1,"limit":1,"stream":false,"send_revision":7,"single_commit":true,"commit":2,"measured_head":measured["watermark"],"snapshot":true,"store_id":measured["store_id"],"generation":measured["generation"]}));
    let ordinary = stream(engine, "alice", &input, 0).unwrap();
    assert!(serde_json::to_vec(&ordinary).unwrap().len() > JSON_RESPONSE_CEILING);
    assert_eq!(ordinary.store_id, measured["store_id"]);
    assert_eq!(ordinary.generation, measured["generation"]);
    if let Some(path) = path { std::fs::remove_dir_all(path.parent().unwrap()).unwrap(); }
}
#[test] fn round3_measurement_matches_ordinary_memory() { measured(false); }
#[test] fn round3_measurement_matches_ordinary_file_reader() { measured(true); }

#[test]
fn round3_full_reply_overflow_grants_when_the_event_prefix_fits() {
    let (mut engine, _) = engine(false);
    seed(&mut engine, 0, 1, "small");
    let input = request(&engine, 1);
    seed(&mut engine, 1, 42, "");
    for i in (1..41).step_by(4) { seed(&mut engine, i, 4, &"x".repeat(400000)); }
    seed(&mut engine, 41, 1, &"x".repeat(400000));
    let ordinary = stream(&mut engine, "alice", &input, 0).unwrap();
    let current = serde_json::to_vec(&ordinary).unwrap().len();
    let body_size = JSON_RESPONSE_CEILING + 1 - current;
    assert!(body_size < 400000);
    seed(&mut engine, 42, 1, &"x".repeat(body_size));
    let ordinary = stream(&mut engine, "alice", &input, 0).unwrap();
    assert_eq!(serde_json::to_vec(&ordinary).unwrap().len(), JSON_RESPONSE_CEILING + 1);
    let mut prefix = ResponseSize::new(&input, &envelope(&engine)).unwrap();
    let tx = engine.store_mut().read_transaction().unwrap();
    let schema = snapback4_lang::compile(&[("schema.q".into(), "table items:\n  body: text <=400000\n  read <- allow\n  sync public\n".into())]).schema;
    let page = snapback4_core::partition::stream_inspected(&tx, &schema, "alice", 1, 1, 0, |event| {
        prefix.event(event)?;
        Ok(!prefix.counter.overflow)
    }).unwrap();
    assert!(page.is_some());
    assert!(!prefix.counter.overflow, "the full-reply counter, not the prefix, must grant");
    tx.rollback().unwrap();
    assert_eq!(reply(&mut engine, &input)["recovery"]["snapshot"], true);
}

#[test]
fn round3_non_overflow_serialization_error_has_no_grant() {
    let (mut engine, _) = engine(false);
    seed(&mut engine, 0, 1, "small");
    let mut size = ResponseSize::new(&request(&engine, 0), &envelope(&engine)).unwrap();
    let error = <serde_json::Error as serde::ser::Error>::custom("injected unrelated serializer failure");
    assert!(size.checked(Err(error)).is_err());
    assert!(size.into_grant().is_none());
}

fn round5_mint(file: bool, wrong_position: bool) {
    let (mut engine, path) = engine(file);
    seed(&mut engine, 0, 1, "small");
    if wrong_position {
        seed(&mut engine, 1, 1, "small");
        seed(&mut engine, 2, 44, &"x".repeat(400000));
    } else {
        seed(&mut engine, 1, 22, &"x".repeat(400000));
        seed(&mut engine, 23, 22, &"x".repeat(400000));
    }
    let mut input = request(&engine, 1);
    input.limit = if wrong_position { 1 } else { 100 };
    let schema = engine.schema().clone();
    let metadata = envelope(&engine);
    let tx = engine.store_mut().read_transaction().unwrap();
    // The measurement API owns its walk: a caller cannot feed the later
    // overflowing commit at position 2 into evidence labeled position 1.
    let measured = measure(&tx, &schema, "alice", &input, 0, &metadata).unwrap();
    assert!(measured.is_none(), "S1: mint authorized an overflow measured at a different limit/position");
    if wrong_position {
        input.from = 2;
        let valid = measure(&tx, &schema, "alice", &input, 0, &metadata).unwrap().unwrap();
        assert_eq!(valid.measurement.from, 2);
        assert_eq!(valid.measurement.commit, 3);
    }
    tx.rollback().unwrap();
    if let Some(path) = path { std::fs::remove_dir_all(path.parent().unwrap()).unwrap(); }
}
#[test] fn round5_mint_multicommit_memory() { round5_mint(false, false); }
#[test] fn round5_mint_multicommit_file() { round5_mint(true, false); }
#[test] fn round5_mint_wrong_position_memory() { round5_mint(false, true); }
#[test] fn round5_mint_wrong_position_file() { round5_mint(true, true); }

fn envelope(engine: &Engine) -> MetadataReply {
    MetadataReply { metadata: true, store_id: engine.store().meta("store_id").unwrap().unwrap(),
        generation: engine.generation(), watermark: engine.seq().unwrap(), recovery: None }
}

#[test]
fn round5_unrelated_encode_error_after_overflow_invalidates_the_mint() {
    let (mut engine, _) = engine(false);
    seed(&mut engine, 0, 44, &"x".repeat(400000));
    let input = request(&engine, 0);
    let mut size = ResponseSize::new(&input, &envelope(&engine)).unwrap();
    let ordinary = stream(&mut engine, "alice", &input, 0).unwrap();
    let SyncEvents::Stream(events) = ordinary.events else { unreachable!() };
    for event in &events {
        size.event(event).unwrap();
        if size.counter.overflow { break; }
    }
    assert!(size.counter.overflow);
    let error = <serde_json::Error as serde::ser::Error>::custom("unrelated failure after size overflow");
    assert!(size.checked(Err(error)).is_err());
    assert!(size.into_grant().is_none());
}
#[test]
fn oversized_current_images_stop_materializing_at_the_wire_ceiling() {
    use snapback4_core::value::{object, Value};
    let source = "table items:\n  body: text <=400000\n  read <- allow\n  sync public\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema.clone(), vec![]).unwrap();
    engine.seed([("items".into(), object([("id", Value::Id("before".into())), ("body", Value::String("small".into()))]))]).unwrap();
    let from = engine.seq().unwrap();
    engine.seed((0..192).map(|i| ("items".into(), object([("id", Value::Id(format!("item-{i}"))), ("body", Value::String("small".into()))])))).unwrap();
    for n in (0..192).step_by(4) {
        engine.seed((n..n+4).map(|i| ("items".into(), object([("id", Value::Id(format!("item-{i}"))), ("body", Value::String("x".repeat(400000)))])))).unwrap();
    }
    let mut size = ResponseSize::new(&request(&engine, from), &envelope(&engine)).unwrap();
    let mut fetched = 0;
    let tx = engine.store_mut().read_transaction().unwrap();
    let page = snapback4_core::partition::stream_inspected(&tx, &bound.schema, "alice", from, 1, 0, |event| {
        fetched += 1;
        let result = size.event(event);
        assert!(result.is_ok() || size.counter.overflow);
        Ok(!size.counter.overflow)
    }).unwrap();
    assert!(page.is_none(), "no partial commit can be returned");
    assert!(size.counter.overflow);
    assert!(size.into_grant().is_some(), "the overflowing prefix mints a single-commit grant");
    assert_eq!(fetched, 42, "stop current-image fetches at the first overflowing prefix, not after all 192 rows");
}
