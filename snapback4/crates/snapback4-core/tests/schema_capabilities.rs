use snapback4_core::schema::{Schema, public_table};
use serde_json::json;
use std::collections::BTreeMap;

fn compile(source: &str) -> Schema {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound.schema
}

#[test]
fn capabilities_are_derived_independently_and_together() {
    let recorded = compile(include_str!("../../snapback4-lang/tests/fixtures/recorded-attribution.q"));
    let timeline = compile(include_str!("../../snapback4-lang/tests/fixtures/timeline-capability.q"));
    let columns = compile(include_str!("../../snapback4-lang/tests/fixtures/maintained-columns.q"));
    let projection = columns.public_projection();
    assert!(projection.maintains.is_empty());
    let mut private_only = columns.clone();
    for table in private_only.tables.values_mut() { table.maintained.clear(); }
    assert!(private_only.maintains.iter().any(|m| m.private.is_some()));
    for schema in [&columns, &projection, &private_only] {
        assert_eq!(schema.required_capabilities(), ["maintained-column".into(), "source-write-reservations-v1".into()].into());
    }
    assert_eq!(recorded.required_capabilities(), ["recorded-attribution".into(), "source-write-reservations-v1".into()].into());
    assert_eq!(timeline.required_capabilities(), ["timeline-event-slots".into(), "timeline-v2".into()].into());
    let mut both = timeline.clone();
    both.tables.get_mut("posts").unwrap().recorded = recorded.tables["likes"].recorded.clone();
    assert_eq!(both.required_capabilities(), ["recorded-attribution".into(), "timeline-event-slots".into(), "timeline-v2".into()].into());
    let mut all = both.clone();
    all.tables.get_mut("posts").unwrap().maintained = columns.tables["posts"].maintained.clone();
    assert_eq!(all.required_capabilities(), ["maintained-column".into(), "recorded-attribution".into(), "timeline-event-slots".into(), "timeline-v2".into()].into());
    for schema in [recorded, timeline, both, columns, projection, private_only, all] {
        let bytes = serde_json::to_string(&schema).unwrap();
        assert_eq!(bytes.matches("Capabilities").count(), 1);
        let wire: serde_json::Value = serde_json::from_str(&bytes).unwrap();
        assert_eq!(wire["tables"][schema.tables.keys().next().unwrap()]["constraints"].as_array().unwrap().last().unwrap(),
            &json!({"Capabilities":schema.required_capabilities()}));
        let decoded: Schema = serde_json::from_str(&bytes).unwrap();
        assert_eq!(schema, decoded, "wire carrier must not become a physical constraint");
        assert_eq!(serde_json::to_string(&decoded).unwrap(), bytes);
    }
}

#[test]
fn no_capabilities_keeps_the_exact_legacy_bytes() {
    let empty = Schema::default();
    assert!(empty.required_capabilities().is_empty());
    assert_eq!(serde_json::to_string(&empty).unwrap(), r#"{"tables":{},"maintains":[]}"#);
    let schema = Schema { tables: BTreeMap::from([("t".into(), public_table(BTreeMap::new(), BTreeMap::new()))]), ..empty };
    assert_eq!(serde_json::to_string(&schema).unwrap(), r#"{"tables":{"t":{"columns":{},"indexes":{},"rules":{"read":{"Public":{"reason":"fixture"}},"insert":{"Public":{"reason":"fixture"}},"update":{"Public":{"reason":"fixture"}},"delete":{"Public":{"reason":"fixture"}}},"constraints":[],"leave":"until-revoked"}},"maintains":[]}"#);
    for schema in [Schema::default(), schema] {
        assert_eq!(serde_json::from_str::<Schema>(&serde_json::to_string(&schema).unwrap()).unwrap(), schema);
    }
    assert_eq!(serde_json::from_str::<Schema>(r#"{"tables":{},"future_ignorable":true}"#).unwrap(), Schema::default());
}

#[test]
fn legacy_recorded_fixture_decodes_and_emits_only_capabilities() {
    let text = include_str!("fixtures/legacy-recorded-schema.json");
    let schema: Schema = serde_json::from_str(text).unwrap();
    assert_eq!(schema.tables["likes"].recorded.len(), 3);
    assert_eq!(schema.tables["posts"].recorded.len(), 1);
    assert!(schema.tables.values().all(|t| !t.constraints.iter().any(|c|
        matches!(c, snapback4_core::schema::Constraint::Recorded | snapback4_core::schema::Constraint::Capabilities(_)))));
    assert_eq!(schema.required_capabilities(), ["recorded-attribution".into()].into());
    let encoded = serde_json::to_string(&schema).unwrap();
    assert!(!encoded.contains("Recorded"));
    assert_eq!(encoded.matches("Capabilities").count(), 1);
    assert_eq!(serde_json::from_str::<Schema>(&encoded).unwrap(), schema);
}

#[test]
fn legacy_recorded_marker_cannot_substitute_for_sequence_capability() {
    let original = include_str!("../../snapback4-lang/tests/fixtures/recorded-attribution.q");
    for sequences in [false, true] {
        let source = if sequences { original.replace("  postId: posts", "  postId: posts\n  ordinal: sequence by postId") } else { original.into() };
        let schema = compile(&source);
        let mut wire = serde_json::to_value(&schema).unwrap();
        assert_eq!(serde_json::from_value::<Schema>(wire.clone()).unwrap(), schema);
        for table in wire["tables"].as_object_mut().unwrap().values_mut() {
            let recorded = table.get("recorded").is_some_and(|r| !r.as_object().unwrap().is_empty());
            let constraints = table["constraints"].as_array_mut().unwrap();
            constraints.retain(|c| c.get("Capabilities").is_none());
            if recorded { constraints.push(json!("Recorded")); }
        }
        let decoded = serde_json::from_value::<Schema>(wire);
        if sequences { assert!(decoded.unwrap_err().to_string().starts_with("E_SCHEMA_CAPABILITY:")); }
        else { assert_eq!(decoded.unwrap(), schema); }
    }
}

#[test]
fn unknown_missing_and_duplicate_capabilities_refuse_decode() {
    for schema in [
        compile(include_str!("../../snapback4-lang/tests/fixtures/timeline-capability.q")),
        compile(include_str!("../../snapback4-lang/tests/fixtures/maintained-columns.q")),
    ] {
        let wire = serde_json::to_value(&schema).unwrap();
        let table = schema.tables.keys().next().unwrap();
        for mode in ["unknown", "missing", "duplicate", "empty"] {
            let mut bad = wire.clone();
            let constraints = bad["tables"][table]["constraints"].as_array_mut().unwrap();
            let at = constraints.iter().position(|c| c.get("Capabilities").is_some()).unwrap();
            match mode {
                "unknown" => constraints[at]["Capabilities"].as_array_mut().unwrap().push(json!("future-derivation")),
                "missing" => { constraints.remove(at); }
                "duplicate" => constraints.push(constraints[at].clone()),
                _ => constraints[at] = json!({"Capabilities":[]}),
            }
            let text = bad.to_string();
            let error = serde_json::from_str::<Schema>(&text).unwrap_err();
            assert!(error.to_string().starts_with("E_SCHEMA_CAPABILITY:"), "{mode}: {error}");
        }
    }
}

#[test]
fn event_slots_fence_projection_and_standalone_columns_but_not_legacy_timelines() {
    let slots=compile(include_str!("../../snapback4-lang/tests/fixtures/following-view.q"));
    assert!(slots.public_projection().required_capabilities().contains("timeline-event-slots"));
    let mut columns=slots.clone(); columns.timelines.clear();
    assert_eq!(columns.required_capabilities(),["timeline-event-slots".into()].into());
    let legacy:serde_json::Value=serde_json::from_str(include_str!("../../../packages/snapback4/test/fixtures/event-slots-pre-slot/backend.json")).unwrap();
    let legacy:Schema=serde_json::from_value(legacy["schema"].clone()).unwrap();
    assert_eq!(legacy.required_capabilities(),["timeline-v2".into()].into());
    let mut wire=serde_json::to_value(slots).unwrap();
    for table in wire["tables"].as_object_mut().unwrap().values_mut() {
        for constraint in table["constraints"].as_array_mut().unwrap() {
            if let Some(names)=constraint.get_mut("Capabilities").and_then(|v|v.as_array_mut()) {
                names.retain(|v|v!="timeline-event-slots");
            }
        }
    }
    assert!(serde_json::from_value::<Schema>(wire).unwrap_err().to_string().contains("E_SCHEMA_CAPABILITY"));
}
