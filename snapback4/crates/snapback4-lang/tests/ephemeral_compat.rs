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
    let expected: BTreeMap<String, (String, String)> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(actual.keys().collect::<Vec<_>>(), expected.keys().collect::<Vec<_>>());
    for (name, (schema, types)) in actual {
        assert_eq!(schema, expected[&name].0, "schema bytes: {name}");
        assert_eq!(types, expected[&name].1, "TypeScript bytes: {name}");
    }
}
