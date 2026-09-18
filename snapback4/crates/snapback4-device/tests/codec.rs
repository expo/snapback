//! The derive remains the codec definition. Compare against the old direct
//! serde entry points, including old durable texts and host-minted cursors.
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value as Json, json};
use snapback4_core::{json_codec as codec, Schema, Program, Value};
use snapback4_device::{device::{Backend, Device, Queued, StreamPage}, memory::{Change, MemoryStore}};
use std::path::Path;

// Each adapter is compared with the entry point it replaced, not another funnel.
fn same_decode<T: std::fmt::Debug>(old: Result<T, serde_json::Error>, new: Result<T, serde_json::Error>, positions: bool) {
    match (old, new) {
        (Ok(old), Ok(new)) => assert_eq!(format!("{old:?}"), format!("{new:?}")),
        (Err(old), Err(new)) => {
            assert_eq!(old.to_string(), new.to_string());
            if positions { assert_eq!((old.line(), old.column()), (new.line(), new.column())); }
        }
        (old, new) => panic!("baseline/funnel disagree: {old:?} / {new:?}"),
    }
}

fn decode<T: DeserializeOwned + std::fmt::Debug>(text: &str) {
    same_decode(serde_json::from_str::<T>(text), codec::from_text::<T>(text), true);
    same_decode(serde_json::from_slice::<T>(text.as_bytes()), codec::from_slice::<T>(text.as_bytes()), true);
    if let Ok(tree) = serde_json::from_str::<Json>(text) {
        same_decode(serde_json::from_value::<T>(tree.clone()), codec::from_value::<T>(tree), true);
    }
}

fn encode<T: Serialize>(value: &T) {
    same_decode(serde_json::to_string(value), codec::to_text(value), true);
    same_decode(serde_json::to_value(value), codec::to_value(value), true);
    same_decode(serde_json::to_vec(value), codec::to_vec(value), true);
}

fn differential<T: Serialize + DeserializeOwned + std::fmt::Debug>(text: &str) {
    decode::<T>(text);
    if let Ok(value) = serde_json::from_str::<T>(text) { encode(&value); }
    if let Ok(tree) = serde_json::from_str::<Json>(text) {
        if let Ok(value) = serde_json::from_value::<T>(tree) { encode(&value); }
    }
}

fn backend(source: &str) -> Backend {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Backend { generation: 1, schema: bound.schema, programs: bound.programs.into_iter().map(|p| p.program).collect() }
}

fn walk(dir: &Path, extension: &str, paths: &mut Vec<std::path::PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() { if !["node_modules", "target", ".snapback4", ".git"].contains(&path.file_name().unwrap().to_str().unwrap()) { walk(&path, extension, paths); } }
        else if path.extension().and_then(|s| s.to_str()) == Some(extension) { paths.push(path); }
    }
}

#[test]
fn reference_backends_and_loadable_corpus_keep_their_derive() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut sources = Vec::new();
    walk(&root.join("apps"), "q", &mut sources);
    for dir in ["snapback4-device/tests/fixtures", "snapback4-sim/tests/fixtures", "snapback4-lang/tests/fixtures"] {
        walk(&root.join("crates").join(dir), "q", &mut sources);
    }
    let mut compiled = 0;
    for source in sources {
        let source = std::fs::read_to_string(source).unwrap();
        let bound = snapback4_lang::compile(&[("fixture.q".into(), source)]);
        if !bound.diagnostics.is_empty() { continue; } // Refusal fixtures are not backends.
        let backend = Backend { generation: 7, schema: bound.schema, programs: bound.programs.into_iter().map(|p| p.program).collect() };
        differential::<Backend>(&serde_json::to_string(&backend).unwrap());
        assert_eq!(backend.schema.hash(), snapback4_core::value::digest(&backend.schema));
        compiled += 1;
    }
    assert!(compiled > 1);
    let mut cases = Vec::new(); walk(&root.join("corpus"), "json", &mut cases);
    let mut programs = 0;
    for path in cases {
        let case: Json = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        for value in std::iter::once(&case["program"]).chain(case["prelude"].as_array().into_iter().flatten().map(|p| &p["program"])) {
            let text = value.to_string();
            if serde_json::from_str::<Program>(&text).is_ok() { differential::<Program>(&text); programs += 1; }
        }
        let text = case["schema"].to_string();
        if serde_json::from_str::<Schema>(&text).is_ok() { differential::<Schema>(&text); }
    }
    assert!(programs > 100);
    println!("differential: {compiled} compiled backends, {programs} loadable corpus programs");
}

#[test]
fn defaults_custom_formats_variants_and_tagged_values() {
    for kind in ["Query", "Mutation", "job", "action"] {
        differential::<Program>(&json!({"name":"p","kind":kind,"body":[],"args":{"handle":{"Text":{"max":32,"format":"handle"}},"url":{"Text":{"max":100,"format":"url"}},"plain":{"Text":{"max":100}}}}).to_string());
    }
    for text in [r#"{"Int":9007199254740991}"#, r#"{"Int":-9007199254740991}"#, r#"{"Bytes":"00ff80"}"#, r#"{"Row":{"a":"Null","b":{"Array":[{"Bool":true},{"String":"\u0000\n☃"}]}}}"#] { differential::<Value>(text); }
    differential::<Queued>(r#"{"id":"q","seq":1,"op":"add","args":{}}"#);
    differential::<Change>(r#"{"s":"m","k":"meta","v":null}"#);
    differential::<Change>(r#"{"s":"m","k":"meta","v":"{\"a\":1}"}"#);
    for text in [r#"{"snapshot":true,"events":[],"watermark":1,"more":false}"#, r#"{"snapshot":false,"events":[{"table":"t","kind":"delete","id":"a"}],"watermark":2,"more":false,"next":null,"generation":1}"#,
        r#"{"snapshot":true,"events":[{"table":"t","kind":"put","id":"a","data":{"x":1,"x":2,"u":18446744073709551615,"float":1.25,"exp":1e2}}],"watermark":9223372036854775808,"more":false}"#,
        r#"{"snapshot":true,"events":[],"watermark":0,"watermark":1,"more":false}"#,
        r#"{"snapshot":true,"events":[],"watermark":"wrong","more":false}"#] { decode::<StreamPage>(text); }
    for text in [r#"{"Bytes":"FF"}"#, r#"{"Bytes":"ff"}"#, r#"{"Int":1,"Int":2}"#, r#"{"Int":"oops"}"#, r#"{"Int":9223372036854775808}"#,
        r#"{"Int":9007199254740992}"#, r#"{"Int":-9007199254740992}"#] { differential::<Value>(text); }
    differential::<Backend>("{\n\"generation\":1,\"generation\":2,\"schema\":{\"tables\":{}},\"programs\":[]}");
    differential::<Queued>(r#"{"id":"q","seq":9223372036854775808,"op":"add","args":{"x":1,"x":2,"nested":{"a":1,"a":2},"float":1.25,"exp":1e2,"edge":9007199254740991,"over":9007199254740992,"u":18446744073709551615}}"#);
    for depth in [120, 127, 128, 130] {
        let nested = format!("{}0{}", "[".repeat(depth), "]".repeat(depth));
        differential::<Queued>(&format!(r#"{{"id":"q","seq":1,"op":"add","args":{{"deep":{nested}}}}}"#));
    }
    // Non-UTF-8 is refused by both slice APIs; the funnel reports the UTF-8
    // decoder's error, not serde_json's positioned string error.
    for bytes in [b"\"\xff\"".as_slice(), b"\xff".as_slice()] {
        assert!(serde_json::from_slice::<Json>(bytes).is_err());
        assert!(codec::from_slice::<Json>(bytes).is_err());
    }
    encode(&std::collections::BTreeMap::from([(vec![1u8, 2], true)]));

}

#[path = "codec/old_store.rs"]
mod old_store;

#[test]
fn cursor_tokens_keep_the_old_bytes_in_both_directions() {
    use snapback4_core::{cursor::*, ir::Order, schema::ColumnType};
    let schema = Schema::default();
    let position = CursorPosition { table: "t".into(), index: "byId".into(), order: Order::Asc, suffix: vec![CursorColumn { name:"id".into(), kind:ColumnType::Id }], values:vec![Value::Id("id".into())], scope:None };
    for scope in [None, Some(CursorScope { generation: 3, prefix: vec![Value::Bytes(vec![0,255])] })] {
        let p = CursorPosition { scope, ..position.clone() };
        let bytes = match &p.scope {
            None => serde_json::to_vec(&(1u8, &p.table, &p.index, p.order, &p.suffix, &p.values)).unwrap(),
            Some(scope) => serde_json::to_vec(&(2u8, &p.table, &p.index, p.order, &p.suffix, &p.values, scope)).unwrap(),
        };
        let token = base64(&bytes);
        assert_eq!(encode_cursor(&schema, &p).unwrap(), token);
        assert_eq!(decode_cursor(&schema, &token).unwrap(), p);
    }
}

fn base64(bytes: &[u8]) -> String {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new(); let mut bits = 0u32; let mut count = 0;
    for &byte in bytes { bits = (bits << 8) | u32::from(byte); count += 8; while count >= 6 { count -= 6; out.push(alphabet[((bits >> count) & 63) as usize] as char); } }
    if count > 0 { out.push(alphabet[((bits << (6-count)) & 63) as usize] as char); } out
}

#[test]
fn counting_writer_keeps_exact_meter_bytes() {
    for value in [Value::Null, Value::Int(snapback4_core::value::I53_MIN), Value::Bytes(vec![0, 255, 128]), snapback4_core::value::object([("z", Value::String("\0\n\t\\\"☃".into())), ("a", Value::Array(vec![Value::Bool(true); 4000]))])] {
        assert_eq!(codec::value_bytes(&value).unwrap(), serde_json::to_vec(&value).unwrap().len() as u64);
    }
}

#[test]
fn text_page_and_baseline_dispatch_agree_including_duplicate_keys_and_refusals() {
    let backend = backend("table notes:\n  body: text <=100\n  public 'fixture'\n  sync public\nquery all():\n  return notes first 10 by byId\n");
    for text in [
        r#"{"op":"apply","first":true,"page":{"snapshot":true,"events":[{"table":"notes","kind":"put","id":"n1","data":{"id":"n1","body":"kept"}}],"watermark":1,"more":false,"generation":1}}"#,
        r#"{"op":"ignored","op":"apply","first":true,"page":{"snapshot":true,"events":[{"table":"old","table":"notes","kind":"put","id":"n1","data":{"id":"n1","body":"old","body":"kept"}}],"watermark":0,"watermark":1,"more":false,"generation":1}}"#,
        r#"{"op":"apply","page":{"snapshot":false,"events":[],"watermark":"wrong","more":false}}"#,
        r#"{"op":"observe_store","page":{"snapshot":false,"events":[],"watermark":0,"more":false}}"#,
        r#"{"op":"apply"}"#, r#"{"op":"unknown"}"#, r#"[]"#,
    ] {
        let mut direct = Device::open_store(MemoryStore::new(), Some(backend.clone()), "dev:bob").unwrap();
        let mut owned = Device::open_store(MemoryStore::new(), Some(backend.clone()), "dev:bob").unwrap();
        let mut owned_current = Device::open_store(MemoryStore::new(), Some(backend.clone()), "dev:bob").unwrap();
        let expected = baseline_page_call(&mut owned, serde_json::from_str(text).unwrap());
        let actual = snapback4_device::call::call_text(&mut direct, text);
        assert_eq!(actual, expected, "{text}");
        assert_eq!(snapback4_device::call::call(&mut owned_current, serde_json::from_str(text).unwrap()), expected, "owned: {text}");
        assert_eq!(direct.state().unwrap(), owned.state().unwrap());
        let rows = |device: &Device<MemoryStore>| device.store().export().into_iter().filter(|c| c.s == 'r').collect::<Vec<_>>();
        assert_eq!(rows(&direct), rows(&owned));
        if text.contains("kept") { assert_eq!(actual["ok"]["touched"], json!(["notes"])); assert_eq!(rows(&direct).len(), 1); }
    }
}

#[test]
fn owned_argument_errors_do_not_claim_positions_in_synthetic_text() {
    for (value, expected) in [
        (json!({"generation":"wrong", "schema":{"tables":{}}, "programs":[]}), "invalid type: string \"wrong\", expected u64"),
        (json!({"generation":1, "schema":{"tables":{}}, "programs":[{"name":"x","kind":"wrong","body":[]}]}), "unknown variant `wrong`, expected one of `Query`, `Mutation`, `job`, `action`"),
    ] {
        let old = serde_json::from_value::<Backend>(value.clone()).unwrap_err();
        let new = codec::from_value::<Backend>(value.clone()).unwrap_err();
        assert_eq!(old.to_string(), expected);
        assert_eq!(new.to_string(), expected);
        let text_error = serde_json::from_str::<Backend>(&value.to_string()).unwrap_err();
        assert_eq!(text_error.to_string(), format!("{expected} at line {} column {}", text_error.line(), text_error.column()));
        assert_eq!((new.line(), new.column()), (old.line(), old.column()));
    }
}

#[test]
fn page_fast_path_keeps_json_validation_inside_unknown_fields() {
    let backend = backend("table notes:\n  body: text <=100\n  public 'fixture'\n  sync public\nquery all():\n  return notes first 10 by byId\n");
    let page = r#"{"snapshot":true,"events":[],"watermark":1,"more":false,"generation":1}"#;
    for unknown in ["1e400".to_owned(), r#""\ud800""#.to_owned(), format!("{}0{}", "[".repeat(130), "]".repeat(130))] {
        for text in [format!(r#"{{"op":"apply","page":{page},"unknown":{unknown}}}"#), format!(r#"{{"op":"apply","page":{{"unknown":{unknown},{}}}}}"#, &page[1..page.len()-1])] {
            let old = serde_json::from_str::<Json>(&text).unwrap_err();
            let checked = codec::validate_text(&text).unwrap_err();
            assert_eq!(checked.to_string(), old.to_string());
            assert_eq!((checked.line(), checked.column()), (old.line(), old.column()));
            let mut device = Device::open_store(MemoryStore::new(), Some(backend.clone()), "dev:bob").unwrap();
            assert_eq!(snapback4_device::call::call_text(&mut device, &text)["denied"]["code"], "E_INPUT", "{text}");
            assert_eq!(device.state().unwrap().0, 0);
        }
    }
    let text = format!(r#"{{"op":"apply","first":true,"page":{page},"unknown":[null,true,1.25,{{"text":"\u2603"}}]}}"#);
    let mut device = Device::open_store(MemoryStore::new(), Some(backend), "dev:bob").unwrap();
    assert_eq!(snapback4_device::call::call_text(&mut device, &text)["ok"]["touched"], json!(["notes"]));
    assert_eq!(device.state().unwrap().0, 1);
}

fn baseline_page_call<S: snapback4_device::store::DeviceStore>(device: &mut Device<S>, request: Json) -> Json {
    use snapback4_core::error::RuntimeError;
    let result = (|| {
        let op = request.get("op").and_then(Json::as_str).ok_or_else(|| RuntimeError::Input("the call needs op".into()))?;
        if !matches!(op, "apply" | "observe_store") { return Err(RuntimeError::UnknownOp(op.into())); }
        let value = request.get("page").ok_or_else(|| RuntimeError::Input("the call needs page".into()))?;
        let page: StreamPage = serde_json::from_value(value.clone()).map_err(|e| RuntimeError::Input(e.to_string()))?;
        if op == "observe_store" { return Ok(serde_json::to_value(device.observe_store(&page)?).unwrap()); }
        Ok(json!({ "touched": device.apply(&page, request.get("first").and_then(Json::as_bool).unwrap_or(false))? }))
    })();
    match result { Ok(value) => json!({"ok":value}), Err(error) => json!({"denied": serde_json::to_value(error.refusal()).unwrap()}) }
}

#[test]
fn owned_adapters_keep_programmatically_built_deep_trees() {
    let mut tree = Json::Null;
    for _ in 0..160 { tree = Json::Array(vec![tree]); }
    let baseline: Json = serde_json::from_value(tree.clone()).unwrap();
    let decoded = codec::from_value::<Json>(tree.clone());
    let encoded = codec::to_value(&tree);
    assert!(decoded.is_ok() && encoded.is_ok(), "deep owned decode: {decoded:?}; encode: {encoded:?}");
    assert_eq!(decoded.unwrap(), baseline);
    assert_eq!(encoded.unwrap(), serde_json::to_value(&tree).unwrap());
    assert!(codec::from_text::<Json>(&tree.to_string()).is_err(), "text hosts retain their recursion limit");
}
