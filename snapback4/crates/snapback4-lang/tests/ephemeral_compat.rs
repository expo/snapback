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
    // LLP 3000.007 §23 repairs human advice, not schema/runtime semantics.
    // Pin the exact old and new strings; retain all other historical bytes.
    let record = &mut expected.get_mut("read-through-device.q").unwrap().0;
    let old_reason = "upsert on a read-through child queues without a row";
    let new_reason = format!("{old_reason}; no branch rewrite: an expiring target can read back as null after insertion; keep the upsert and observe its queued/sent/failed state");
    let old_rewrite = "use a plain insert with a new id when prediction is needed";
    let new_rewrite = "";
    for (old, new) in [(old_reason, new_reason.as_str()), (old_rewrite, new_rewrite)] {
        let old = serde_json::to_string(old).unwrap();
        assert_eq!(record.matches(&old).count(), 1);
        *record = record.replace(&old, &serde_json::to_string(new).unwrap());
    }
    assert_eq!(actual.keys().collect::<Vec<_>>(), expected.keys().collect::<Vec<_>>());
    for (name, (schema, types)) in actual {
        assert_eq!(schema, expected[&name].0, "schema bytes: {name}");
        assert_eq!(strip_row_keys(&types), expected[&name].1, "TypeScript bytes: {name}");
    }
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
