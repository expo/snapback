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
        "generation":engine.generation(),"from":from,"limit":1})).unwrap()
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
    assert_eq!(measured["recovery"], json!({"from":1,"snapshot":true,"store_id":measured["store_id"],"generation":measured["generation"]}));
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
    let mut prefix = ResponseSize::new(1, "test", 1);
    let tx = engine.store_mut().read_transaction().unwrap();
    let schema = snapback4_lang::compile(&[("schema.q".into(), "table items:\n  body: text <=400000\n  read <- allow\n  sync public\n".into())]).schema;
    let page = snapback4_core::partition::stream_inspected(&tx, &schema, "alice", 1, 1, 0, |event| {
        prefix.event(event)?;
        Ok(!prefix.overflowed())
    }).unwrap();
    assert!(page.is_some());
    assert!(!prefix.overflowed(), "the full-reply counter, not the prefix, must grant");
    tx.rollback().unwrap();
    assert_eq!(reply(&mut engine, &input)["recovery"]["snapshot"], true);
}

#[test]
fn round3_non_overflow_serialization_error_has_no_grant() {
    let size = ResponseSize::new(1, "test", 1);
    let error = <serde_json::Error as serde::ser::Error>::custom("injected unrelated serializer failure");
    assert!(size.checked(Err(error)).is_err());
    assert!(size.into_grant().is_none());
}
