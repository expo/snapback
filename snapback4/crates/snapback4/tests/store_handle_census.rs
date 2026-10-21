//! Concrete SQLite Store/Tx tokens in production engine/host code, per the S10
//! census. The reviewed baseline is 123 (79 engine, 44 host); S10a's target is
//! zero. This has no raise override: allowances may only fall.
use std::{collections::BTreeMap, fs, path::{Path, PathBuf}};

#[path = "support/rust_tokens.rs"]
mod rust_tokens;
use rust_tokens::{starts, tokens};

fn in_scope(path: &Path) -> bool {
    (path.starts_with("crates/snapback4-core/src/engine")
        || path.starts_with("crates/snapback4/src"))
        && !path.starts_with("crates/snapback4-core/src/engine/postgres")
        && !path.components().any(|p| matches!(p.as_os_str().to_str(), Some("tests" | "test_cases")))
        && !path.file_name().unwrap().to_string_lossy().contains("tests")
        && path.file_name().unwrap() != "test_cases.rs"
}

fn concrete_tokens(source: &str) -> usize {
    let tokens = tokens(source);
    let (mut i, mut count) = (0, 0);
    while i < tokens.len() {
        // Skip any cfg(test) item, including imports/functions, not just modules.
        if starts(&tokens[i..], &["#", "[", "cfg", "(", "test", ")", "]"])
            || starts(&tokens[i..], &["#", "[", "cfg", "(", "all", "(", "test", ","])
        {
            while i < tokens.len() && !matches!(tokens[i].text, ";" | "{") { i += 1; }
            if i < tokens.len() && tokens[i].text == "{" {
                let mut depth = 1;
                i += 1;
                while i < tokens.len() && depth != 0 {
                    match tokens[i].text { "{" => depth += 1, "}" => depth -= 1, _ => {} }
                    i += 1;
                }
            } else { i += 1; }
            continue;
        }
        let previous = i.checked_sub(3).map(|start| &tokens[start..i]);
        let variant_or_wasm = previous.is_some_and(|before| {
            ["RuntimeError", "Error", "Self", "wasmi"].iter()
                .any(|owner| starts(before, &[owner, ":", ":"]))
        });
        // The host's run-admission error variant is not a store handle.
        let error_variant = starts(&tokens[i..], &["Store", "(", "RuntimeError", ")"]);
        if matches!(tokens[i].text, "Store" | "Tx") && !variant_or_wasm && !error_variant { count += 1; }
        i += 1;
    }
    count
}

fn walk(root: &Path, dir: &Path, counts: &mut BTreeMap<PathBuf, usize>) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() { walk(root, &path, counts); }
        else if path.extension().is_some_and(|ext| ext == "rs") {
            let relative = path.strip_prefix(root).unwrap();
            if in_scope(relative) {
                let count = concrete_tokens(&fs::read_to_string(&path).unwrap());
                if count != 0 { counts.insert(relative.into(), count); }
            }
        }
    }
}

#[test]
fn engine_and_host_use_neutral_handles() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let root = manifest.parent().unwrap().parent().unwrap();
    let mut counts = BTreeMap::new();
    for dir in ["crates/snapback4-core/src/engine", "crates/snapback4/src"] {
        walk(root, &root.join(dir), &mut counts);
    }
    println!("S10a concrete SQLite Store/Tx census: {} tokens in {} files (baseline 123/37; target 0)", counts.values().sum::<usize>(), counts.len());
    assert!(counts.is_empty(), "LLP 3000.009.001.000 §3.4: concrete SQLite type tokens above the port: {counts:?}");
}

#[test]
fn matcher_keeps_types_and_excludes_tests_errors_and_wasm() {
    assert_eq!(concrete_tokens("use crate::store::{Store, Tx}; fn f(tx: &Tx<'_>) -> Store {}"), 4);
    assert_eq!(concrete_tokens("use snapback4_core::Store as Backend; type T = crate::store::Tx<'static>;"), 2);
    assert_eq!(concrete_tokens("r#Store::memory(); r#Tx<'_>;"), 2);
    assert_eq!(concrete_tokens("// Store\nlet a = \"Tx\"; let b = r###\"Store\"###; RuntimeError::Store(e); Error::Store(e); Self::Store(e); wasmi::Store::new(); enum Error { Store(RuntimeError) }"), 0);
    assert_eq!(concrete_tokens("#[cfg(test)] mod fixtures { fn f(tx: Tx) { Store::memory(); } } type T = Tx<'static>;"), 1);
    assert_eq!(concrete_tokens("#[cfg(test)] use crate::Store; #[cfg(all(test, feature = \"sqlite\"))] fn f(tx: Tx) {} type T = Store;"), 1);
    assert_eq!(concrete_tokens("AnyStore::memory(); fn f(tx: &AnyTx<'_>) {}"), 0);
    for path in ["crates/snapback4-core/src/engine/postgres/store.rs", "crates/snapback4-core/src/store.rs", "crates/snapback4-device/src/sqlite.rs", "crates/snapback4/src/serve_tests.rs", "crates/snapback4-core/src/engine/job/test_cases.rs"] {
        assert!(!in_scope(Path::new(path)), "{path}");
    }
    assert!(in_scope(Path::new("crates/snapback4-core/src/engine/committer/member_store.rs")));
}
