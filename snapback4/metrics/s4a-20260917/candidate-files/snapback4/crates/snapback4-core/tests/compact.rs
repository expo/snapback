use serde::{Serialize, Deserialize, de::DeserializeOwned};
use snapback4_core::{compact, ir::{ArgType, Expr, LaneSource}, schema::{IndexComponent, TextFormat}, Value};
use std::fmt::Debug;

fn round<T: Serialize + DeserializeOwned + PartialEq + Debug>(value: &T) {
    let bytes = compact::to_vec(value).unwrap();
    assert_eq!(&compact::from_slice::<T>(&bytes).unwrap_or_else(|e| panic!("{}: {e}: {value:?}", std::any::type_name::<T>())), value);
    let text = snapback4_core::json_codec::to_text(value).unwrap();
    assert_eq!(&snapback4_core::json_codec::from_text::<T>(&text).unwrap(), value);
}
fn seven() -> u32 { 7 }
fn is_seven(n: &u32) -> bool { *n == 7 }
#[derive(Debug, PartialEq, Serialize, Deserialize)]
struct Defaults {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    first: Vec<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    optional: Option<u32>,
    #[serde(default = "seven", skip_serializing_if = "is_seven")]
    nonempty: u32,
    last: u32,
}
#[test]
fn derived_sequence_continues_after_absent_and_uses_declared_defaults() {
    for value in [Defaults { first: vec![], optional: None, nonempty: 7, last: 91 }, Defaults { first: vec![2], optional: Some(8), nonempty: 6, last: 92 }] { round(&value); }
    #[derive(Serialize, Deserialize)]
    struct Required { #[serde(skip_serializing_if = "Vec::is_empty")] missing: Vec<u8>, last: u8 }
    let error = compact::from_slice::<Required>(&compact::to_vec(&Required { missing: vec![], last: 9 }).unwrap()).err().unwrap();
    assert!(error.to_string().contains("invalid length"), "{error}");
}
#[test]
fn format_sensitive_types_keep_json_and_compact_equal() {
    for value in [LaneSource::Range { start: Expr::Literal(Value::Int(-2)), end_exclusive: Expr::Literal(Value::Int(7)), max: None }, LaneSource::List { value: Expr::Array(vec![]), max: 2 }] { round(&value); }
    for format in [None, Some(TextFormat::Handle), Some(TextFormat::Url)] { round(&ArgType::Text { min: 0, max: 30, format }); }
    round(&IndexComponent::WordPrefixes { fields: vec!["body".into()], contract: serde_json::json!({"nested":[null,true,{"x":"é"}],"count":123}) });
}
#[test]
fn generated_values_and_integer_extremes() {
    for n in [i64::MIN, -8192, -128, -1, 0, 1, 127, 128, i64::MAX] { round(&n); }
    for n in [0, 127, 128, u64::MAX] { round(&n); }
    for n in [i128::MIN, -1, 0, i128::MAX] { assert_eq!(compact::from_slice::<i128>(&compact::to_vec(&n).unwrap()).unwrap(), n); }
    for n in [0, u128::MAX] { assert_eq!(compact::from_slice::<u128>(&compact::to_vec(&n).unwrap()).unwrap(), n); }
    let mut values = vec![Value::Null, Value::Bool(true), Value::Int(37), Value::String("é\0🦀".into()), Value::Id("id".into()), Value::Bytes((0..=255).collect())];
    for i in 0..24 { let value = Value::Array(values.clone()); round(&value); values = vec![Value::Row([("k".into(), value)].into_iter().collect()), Value::Int(i)]; }
    round(&Value::Map([("k".into(), Value::Bool(false))].into_iter().collect()));
}
#[test]
fn malformed_lengths_varints_tags_utf8_depth_and_tails_refuse() {
    for bytes in [&[128][..], &[128,0], &[255; 20]] { assert!(compact::from_slice::<u64>(bytes).is_err()); }
    assert!(compact::from_slice::<Vec<u8>>(&[255,255,255,127]).is_err());
    assert!(compact::from_slice::<Value>(&[127]).is_err());
    assert!(compact::from_slice::<String>(&[1,255]).is_err());
    assert!(compact::from_slice::<bool>(&[2]).is_err());
    assert!(compact::from_slice::<Option<u8>>(&[2]).is_err());
    assert!(compact::from_slice::<u8>(&[0,0]).is_err());
    let mut value = Value::Null;
    for _ in 0..150 { value = Value::Array(vec![value]); }
    assert!(compact::from_slice::<Value>(&compact::to_vec(&value).unwrap()).unwrap_err().to_string().contains("nesting"));
}

#[test]
fn every_corpus_program_and_schema() {
    let (mut schemas, mut programs) = (0, 0);
    fn walk(value: &serde_json::Value, schemas: &mut usize, programs: &mut usize) {
        match value {
            serde_json::Value::Object(map) => {
                for (key, value) in map {
                    if key == "schema" && value.get("tables").is_some() {
                        let schema: snapback4_core::Schema = snapback4_core::json_codec::from_value(value.clone()).unwrap(); round(&schema); *schemas += 1;
                    } else if key == "program" && value.get("body").is_some() {
                        match snapback4_core::json_codec::from_value::<snapback4_core::Program>(value.clone()) {
                            Ok(program) => { round(&program); *programs += 1; }
                            Err(error) => println!("corpus unsupported program {}: {error}", value["name"]),
                        }
                    } else { walk(value, schemas, programs); }
                }
            }
            serde_json::Value::Array(array) => for value in array { walk(value, schemas, programs); },
            _ => {}
        }
    }
    for path in std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/../../corpus")).unwrap() {
        let path = path.unwrap().path();
        if path.extension().is_some_and(|e| e == "json") {
            let value = snapback4_core::json_codec::from_text(&std::fs::read_to_string(path).unwrap()).unwrap();
            walk(&value, &mut schemas, &mut programs);
        }
    }
    assert!(schemas > 100 && programs > 100);
    println!("compact corpus: {schemas} schemas, {programs} programs");
}

#[test]
fn every_published_quarry_backend_and_chat() {
    use snapback4_lang::guide::{KEYWORDS, LANGUAGE, card, language, quarry};
    let readme = concat!(include_str!("../../../packages/snapback4/README.md"), "\n", include_str!("../../../packages/snapback4/CLIENT-AND-OPERATIONS.md"), "\n", include_str!("../../../packages/snapback4/SERVER.md"));
    let mut docs: Vec<(&str, &str)> = KEYWORDS.iter().map(|k| (*k, card(k).unwrap())).collect();
    docs.extend([("language", LANGUAGE), ("README", readme)]);
    let mut count = 0;
    let check = |bound: snapback4_lang::Bound| {
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        round(&bound.schema);
        for p in bound.programs { round(&p.program); }
    };
    for (_name, doc) in docs {
        for block in quarry(doc) {
            let source = if block.starts_with("-- After: snapback4 init --recipe feeds --prefix feed\n") {
                format!("{}\n{block}", snapback4_lang::recipe::following("feed", "").unwrap())
            } else if block.lines().any(|line| line.starts_with("table ")) { block } else { format!("{}\n{block}", language()) };
            let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
            check(bound); count += 1;
        }
    }
    let mut sources = Vec::new();
    for path in std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/chat/snapback")).unwrap() {
        let path = path.unwrap().path();
        if path.extension().is_some_and(|e| e == "q") { sources.push((path.to_string_lossy().into_owned(), std::fs::read_to_string(path).unwrap())); }
    }
    check(snapback4_lang::compile(&sources));
    println!("compact published Quarry: {count} blocks; apps/chat: {} sources", sources.len());
}
