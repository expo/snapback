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
    assert_eq!(recorded.required_capabilities(), ["recorded-attribution".into()].into());
    assert_eq!(timeline.required_capabilities(), ["timeline".into()].into());
    let mut both = timeline;
    both.tables.get_mut("posts").unwrap().recorded = recorded.tables["likes"].recorded.clone();
    assert_eq!(both.required_capabilities(), ["recorded-attribution".into(), "timeline".into()].into());
    for schema in [recorded, both] {
        let bytes = serde_json::to_string(&schema).unwrap();
        assert_eq!(bytes.matches("Capabilities").count(), 1);
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
}

#[test]
fn unknown_missing_and_duplicate_capabilities_refuse_decode() {
    let schema = compile(include_str!("../../snapback4-lang/tests/fixtures/timeline-capability.q"));
    let wire = serde_json::to_value(&schema).unwrap();
    let table = schema.tables.keys().next().unwrap();
    for mode in ["unknown", "missing", "duplicate", "empty"] {
        let mut bad = wire.clone();
        let constraints = bad["tables"][table]["constraints"].as_array_mut().unwrap();
        let at = constraints.iter().position(|c| c.get("Capabilities").is_some()).unwrap();
        match mode {
            "unknown" => constraints[at] = json!({"Capabilities":["timeline", "future-derivation"]}),
            "missing" => { constraints.remove(at); }
            "duplicate" => constraints.push(constraints[at].clone()),
            _ => constraints[at] = json!({"Capabilities":[]}),
        }
        let text = bad.to_string();
        let error = serde_json::from_str::<Schema>(&text).unwrap_err();
        assert!(error.to_string().starts_with("E_SCHEMA_CAPABILITY:"), "{mode}: {error}");
    }
}
