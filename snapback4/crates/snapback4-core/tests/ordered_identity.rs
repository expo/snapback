//! Every subject is independently rebuilt with BTreeMap and SmallMap maps.
//! Pins are a second guard, captured from the BTreeMap serialization with:
//! D2_IDENTITY_CAPTURE=$PWD/crates/snapback4-core/tests/ordered_identity.json cargo test -p snapback4-core --test ordered_identity -- --nocapture
#[path = "support/identity_maps.rs"]
mod identity_maps;
use snapback4_core::{Program, Schema, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path};

fn hash(bytes: impl AsRef<[u8]>) -> String { format!("{:x}", Sha256::digest(bytes.as_ref())) }

fn typed<T: serde::de::DeserializeOwned + serde::Serialize>(json: &serde_json::Value) -> String {
    match serde_json::from_value::<T>(json.clone()) {
        Ok(value) => String::from_utf8(identity_maps::bytes(&value)).unwrap(),
        Err(error) => {
            // A few S2 legacy programs already fail to decode at the pinned base.
            // Include that exact failure in the digest and report it, never skip it.
            eprintln!("pinned legacy decode refusal ({}): {error}", std::any::type_name::<T>());
            format!("BASELINE REFUSAL {}: {error}\n{}", std::any::type_name::<T>(), String::from_utf8(identity_maps::bytes(json)).unwrap())
        },
    }
}

#[test]
fn corpus_and_reference_backends_keep_ordered_bytes() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut actual = BTreeMap::new();
    for path in std::fs::read_dir(root.join("corpus")).unwrap().map(|entry| entry.unwrap().path()) {
        if path.extension().is_none_or(|extension| extension != "json") { continue; }
        let case: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        if matches!(path.file_name().unwrap().to_str().unwrap(), "manifest.json" | "ir-contract.json") { continue; }
        let mut bytes = vec![typed::<Schema>(&case["schema"]), typed::<Program>(&case["program"])];
        let tree_args = typed::<BTreeMap<String, Value>>(&case["context"]["args"]);
        assert_eq!(tree_args, typed::<snapback4_core::smallmap::SmallMap<String, Value>>(&case["context"]["args"]));
        bytes.push(tree_args);
        for row in case["receipt"]["rows"].as_array().unwrap() { bytes.push(typed::<Value>(&row["row"])); }
        if let Some(prelude) = case["prelude"].as_array() {
            for step in prelude { bytes.push(typed::<Program>(&step["program"])); }
        }
        actual.insert(format!("corpus/{}", path.file_name().unwrap().to_str().unwrap()), hash(bytes.join("\n")));
    }
    // Interview sources are a frozen copy of the external reference app at pin capture.
    for (app, sources) in [
        ("chat", vec![("schema.q".into(), std::fs::read_to_string(root.join("apps/chat/snapback/schema.q")).unwrap())]),
        ("interview", ["schema.q", "interview.q", "welcome.q"].into_iter().map(|name| (name.into(), std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/interview").join(name)).unwrap())).collect()),
    ] {
        let bound = snapback4_lang::compile(&sources);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let programs: Vec<_> = bound.programs.iter().map(|program| &program.program).collect();
        if let Ok(directory) = std::env::var("D2_BACKEND_IMAGES") {
            let image = format!(r#"{{"generation":1,"schema":{},"programs":{}}}"#, serde_json::to_string(&bound.schema).unwrap(), serde_json::to_string(&programs).unwrap());
            std::fs::write(Path::new(&directory).join(format!("{app}.json")), image).unwrap();
        }
        actual.insert(format!("apps/{app}/backend"), hash(identity_maps::bytes(&(&bound.schema, programs))));
        actual.insert(format!("apps/{app}/schema-hash"), { let hash = hash(identity_maps::bytes(&bound.schema)); assert_eq!(hash, bound.schema.hash()); hash });
        actual.insert(format!("apps/{app}/api.ts"), { let api = snapback4_lang::emit::typescript(&bound); identity_maps::bytes(&api); hash(api) });
        actual.insert(format!("apps/{app}/wire-programs"), hash(identity_maps::bytes(&snapback4_lang::emit::backend_programs(&bound))));
    }
    let mut expected: BTreeMap<String, String> = serde_json::from_str(include_str!("ordered_identity.json")).unwrap();
    let comment = expected.remove("$comment").expect("pin capture command");
    if let Ok(path) = std::env::var("D2_IDENTITY_CAPTURE") {
        let mut captured = actual.clone(); captured.insert("$comment".into(), comment);
        std::fs::write(path, serde_json::to_string_pretty(&captured).unwrap() + "\n").unwrap();
    }
    assert_eq!(actual, expected);
}
