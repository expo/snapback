use serde::Deserialize;
use serde_json::json;
use snapback4_core::{schema::Schema, ir::Program, Engine, Context, store::Store, Value};

// Emitted by the unmodified pre-FENCE compiler at e91f60c7f8 from the
// adjacent .q source, not made by stripping a modern capability carrier.
const LEGACY: &str = include_str!("fixtures/legacy-recorded-timeline-backend.json");
#[derive(Deserialize)]
struct Backend { schema: Schema, programs: Vec<Program> }

#[test]
fn genuine_legacy_recorded_and_timeline_infers_both_and_emits_one_carrier() {
    let wire: serde_json::Value = serde_json::from_str(LEGACY).unwrap();
    assert_eq!(wire["schema"]["tables"]["likes"]["constraints"][0], "Recorded");
    assert!(!LEGACY.contains("Capabilities"));
    assert_eq!(wire["schema"]["timelines"].as_array().unwrap().len(), 1);
    let backend: Backend = serde_json::from_str(LEGACY).unwrap();
    let bound = snapback4_lang::compile(&[("schema.q".into(), include_str!("fixtures/legacy-recorded-timeline.q").into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert_eq!(backend.schema, bound.schema);
    assert_eq!(backend.schema.required_capabilities(), ["recorded-attribution".into(), "timeline".into()].into());
    let encoded = serde_json::to_string(&backend.schema).unwrap();
    assert!(!encoded.contains("Recorded"));
    assert_eq!(encoded.matches("Capabilities").count(), 1);
    let modern: serde_json::Value = serde_json::from_str(&encoded).unwrap();
    let constraints = modern["tables"][backend.schema.tables.keys().next().unwrap()]["constraints"].as_array().unwrap();
    assert_eq!(constraints.last().unwrap(), &json!({"Capabilities":["recorded-attribution", "timeline"]}));
    assert_eq!(serde_json::from_str::<Schema>(&encoded).unwrap(), backend.schema);
}

#[test]
fn legacy_inference_cannot_repair_a_modern_carrier() {
    let backend: Backend = serde_json::from_str(LEGACY).unwrap();
    for mode in ["missing-timeline", "missing-recorded", "unknown", "mixed-legacy", "duplicate", "missing", "empty"] {
        let mut wire = serde_json::to_value(&backend.schema).unwrap();
        let constraints = wire["tables"][backend.schema.tables.keys().next().unwrap()]["constraints"].as_array_mut().unwrap();
        let at = constraints.iter().position(|c| c.get("Capabilities").is_some()).unwrap();
        match mode {
            "missing-timeline" => constraints[at] = json!({"Capabilities":["recorded-attribution"]}),
            "missing-recorded" => constraints[at] = json!({"Capabilities":["timeline"]}),
            "unknown" => constraints[at] = json!({"Capabilities":["recorded-attribution", "timeline", "future-derivation"]}),
            "duplicate" => constraints.push(constraints[at].clone()),
            "missing" => { constraints.remove(at); }
            "empty" => constraints[at] = json!({"Capabilities":[]}),
            _ => wire["tables"]["likes"]["constraints"].as_array_mut().unwrap().push(json!("Recorded")),
        }
        let error = serde_json::from_value::<Schema>(wire).unwrap_err();
        assert!(error.to_string().starts_with("E_SCHEMA_CAPABILITY:"), "{mode}: {error}");
    }
}

#[test]
fn engine_reopens_legacy_recorded_and_timeline_schema() {
    let backend: Backend = serde_json::from_str(LEGACY).unwrap();
    let directory = std::env::temp_dir().join(format!("sb4-legacy-f2-f3-{}-{}", std::process::id(), snapback4_core::now_ms()));
    std::fs::create_dir(&directory).unwrap();
    let path = directory.join("store.sqlite");
    let engine = Engine::new(Store::open(&path).unwrap(), backend.schema, backend.programs).unwrap();
    // Install the exact pre-FENCE stored-schema representation, leaving the
    // engine's real tables, indexes, programs and metadata in place for reopen.
    let wire: serde_json::Value = serde_json::from_str(LEGACY).unwrap();
    engine.store().conn().execute("UPDATE _generations SET schema = ?1", [wire["schema"].to_string()]).unwrap();
    let expected = engine.schema().required_capabilities();
    drop(engine);
    let mut reopened = Engine::open(Store::open(&path).unwrap()).unwrap();
    assert_eq!(reopened.schema().required_capabilities(), expected);
    for (name, args) in [("following", [("c".into(), Value::Null)]), ("received", [("authorId".into(), Value::Id("dev:alice".into()))])] {
        let args = args.into();
        assert!(reopened.query(name, Context::new("dev:alice", args).at(1000)).unwrap().complete);
    }
    drop(reopened);
    std::fs::remove_dir_all(directory).unwrap();
}
