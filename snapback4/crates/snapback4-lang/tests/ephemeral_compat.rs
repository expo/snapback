//! Frozen before LLP 3000.017 at 59dc258fe5e06cec28ee65da5bfe1bae3f3c7509.
//! Durable schemas must retain their exact serialized and emitted bytes.
use std::collections::BTreeMap;
#[test]
fn durable_schema_and_types_keep_base_bytes() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let path = root.join("ephemeral-compat.json");
    let mut actual = BTreeMap::new();
    for entry in std::fs::read_dir(&root).unwrap() {
        let file = entry.unwrap().path();
        if file.extension().is_none_or(|e| e != "q") { continue; }
        let source = std::fs::read_to_string(&file).unwrap();
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        if !bound.diagnostics.is_empty() { continue; } // Repair fixtures deliberately refuse.
        actual.insert(file.file_name().unwrap().to_str().unwrap().to_owned(), (
            serde_json::to_string(&bound.schema).unwrap(), snapback4_lang::emit::typescript(&bound)));
    }
    assert!(actual.len() >= 20, "only {} compilable fixtures", actual.len());
    let mut expected: BTreeMap<String, (String, String)> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    // Main added these after E1's original capture. Their independent bytes
    // were captured at 0badac987; the original 26 expectations stay untouched.
    let main: BTreeMap<String, (String, String)> = serde_json::from_str(include_str!("fixtures/ephemeral-compat-main.json")).unwrap();
    for (name, bytes) in main { assert!(expected.insert(name, bytes).is_none()); }
    // P1 added this fixture after E1's capture. Capture its independent bytes
    // with the round-0 compiler at e1d84ebe7, before merging ephemeral tables.
    let p1: BTreeMap<String, (String, String)> = serde_json::from_str(include_str!("fixtures/ephemeral-compat-p1.json")).unwrap();
    for (name, bytes) in p1 { assert!(expected.insert(name, bytes).is_none()); }
    // QX extends prediction to read-through upserts (LLP 3000.007 §20.5).
    // Preserve every frozen byte except the removed blanket server site and
    // its operation verdict; the byId insert limitation remains unchanged.
    let record = &mut expected.get_mut("read-through-device.q").unwrap().0;
    let mut schema: serde_json::Value = serde_json::from_str(record).unwrap();
    let put = &mut schema["operations"]["put"];
    assert_eq!(put["predicts"], "never");
    let sites = put["sites"].as_array_mut().unwrap();
    let at = sites.iter().position(|s| s["kind"] == "upsert" && s["class"] == "server").unwrap();
    assert_eq!(sites[at]["reason"], "upsert on a read-through child queues without a row");
    sites.remove(at);
    put["predicts"] = serde_json::json!("eligible");
    // Schema structs retain their established serialization order.
    *record = serde_json::to_string(&serde_json::from_value::<snapback4_core::Schema>(schema).unwrap()).unwrap();
    let types = &mut expected.get_mut("read-through-device.q").unwrap().1;
    for (old, new) in [
        ("Result: Rows[\"comments\"] | null. predicts: never.", "Result: Rows[\"comments\"] | null. predicts: eligible."),
        ("name: \"put\", predicts: \"never\"", "name: \"put\", predicts: \"eligible\"")
    ] { assert_eq!(types.matches(old).count(), 1); *types = types.replace(old, new); }
    // @ref LLP 3000.015#3 — BG's durable numerical certificate adds exactly
    // these private fields. Keep all other schema and emitted bytes frozen;
    // the legacy-basis test separately proves atomic adoption of old rows.
    for name in ["row-keyed-view.q", "row-view-inherited-member.q", "row-view-inherited-source.q"] {
        let record = &mut expected.get_mut(name).unwrap().0;
        let mut schema: serde_json::Value = serde_json::from_str(record).unwrap();
        let columns = &mut schema["tables"]["$basis:unread"]["columns"];
        assert_eq!(*columns, serde_json::json!({"at": "Time", "id": "Id"}));
        columns["deadline"] = serde_json::json!({"Optional": "Time"});
        columns["version"] = serde_json::json!({"Optional": {"Text": {"max": 64}}});
        schema["tables"]["$recount:unread"]["columns"]["version"] = serde_json::json!({"Optional": {"Text": {"max": 64}}});
        *record = serde_json::to_string(&serde_json::from_value::<snapback4_core::Schema>(schema).unwrap()).unwrap();
    }
    // NL refuses this formerly accepted nonunique rule probe. Pin that
    // intentional admission change; every still-admitted byte stays frozen.
    let refused = snapback4_lang::compile(&[("schema.q".into(), include_str!("fixtures/repair-probe.q").into())]);
    assert!(refused.diagnostics.iter().any(|d| d.code == "E_QUARRY_POINT_KEY"));
    assert!(expected.remove("repair-probe.q").is_some());
    assert_eq!(actual.keys().collect::<Vec<_>>(), expected.keys().collect::<Vec<_>>());
    for (name, (schema, types)) in actual {
        assert_eq!(strip_update_explanations(&schema), expected[&name].0, "schema bytes: {name}");
        assert_eq!(strip_following(&strip_row_keys(&types), &schema), expected[&name].1, "TypeScript bytes: {name}");
    }
}

// QX round 1 appends per-constraint update explanations to existing upsert
// insert sites. Only that appended prose is new; the CLI snapshots bind it.
fn strip_update_explanations(text: &str) -> String {
    let mut schema: snapback4_core::Schema = serde_json::from_str(text).unwrap();
    // @ref LLP 3000.022#14.3 — the versioned source prices are the only RP
    // wire addition here. Verify the complete price before comparing every
    // original durable byte; genuine old fixture files remain untouched.
    if !schema.source_reservations.is_empty() {
        for name in schema.tables.keys() {
            assert_eq!(schema.source_reservations.get(name), snapback4_core::schema::reservations::reservation(&schema,name).as_ref());
        }
        schema.source_reservations.clear();
    }
    for op in schema.operations.values_mut() {
        for site in &mut op.sites {
            if matches!(site.kind.as_str(), "upsert insert" | "upsert insert blocked")
                && let Some(at) = site.reason.find("; held updates — ") { site.reason.truncate(at); }
        }
    }
    serde_json::to_string(&schema).unwrap()
}

/// LLP 3000.028 §3.3 (lane OS) adds `rowKey` to generated query entries in `api`,
/// so the SDK accumulates pages by source-row identity. Strip only that key, so
/// every other emitted byte stays frozen.
fn strip_row_keys(types: &str) -> String {
    const KEY: &str = ", rowKey: \"";
    let (mut out, mut rest) = (String::with_capacity(types.len()), types);
    while let Some(at) = rest.find(KEY) {
        out.push_str(&rest[..at]);
        let after = &rest[at + KEY.len()..];
        rest = &after[after.find('"').expect("rowKey closing quote") + 1..];
    }
    out.push_str(rest);
    out
}

// @ref LLP 3000.026#9.10 — the exact-history binding is an additive SDK
// descriptor. Validate and remove only that addition; all stored schema and
// every preceding emitted byte continue to match the original frozen files.
fn strip_following(types: &str, schema: &str) -> String {
    let schema: snapback4_core::Schema=serde_json::from_str(schema).unwrap();
    let mut types=types.replace(", FollowingQuery", "").replace(": FollowingQuery<", ": Query<");
    const PREFIX: &str=", following: ";
    while let Some(start)=types.find(PREFIX) {
        let value=start+PREFIX.len();let end=value+types[value..].find('}').unwrap()+1;
        let binding:serde_json::Value=serde_json::from_str(&types[value..end]).unwrap();
        assert_eq!(binding.as_object().unwrap().len(),3);
        assert!(schema.timelines.iter().any(|t|Some(t.name.as_str())==binding["declaration"].as_str()));
        assert!((1..=100).contains(&binding["pageSize"].as_u64().unwrap()));
        assert!(binding["cursor"].is_null()||binding["cursor"].as_str()==Some("c"));
        types.replace_range(start..end, "");
    }
    types
}
