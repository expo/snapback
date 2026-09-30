#[path = "../../snapback4-lang/tests/guide/context.rs"]
mod guide_context;
use serde::{Deserialize, Serialize};
use serde_json::{Value as Json, json};
use snapback4_core::{ir::{Expr, LaneSource, Scan}, json_codec::{from_text, to_text}};

// Kept only in this test target: production must never instantiate this reader.
#[cfg(test)]
mod oracle {
    use super::*;
    #[derive(Debug, Serialize, Deserialize)]
    #[serde(untagged)]
    pub enum Old { Scan(Scan), Range { start: Expr, end_exclusive: Expr, max: Option<u64> }, List { value: Expr, max: u32 } }
    impl Old {
        pub fn current(self) -> LaneSource {
            match self { Self::Scan(s) => LaneSource::Scan(s), Self::Range { start, end_exclusive, max } => LaneSource::Range { start, end_exclusive, max }, Self::List { value, max } => LaneSource::List { value, max } }
        }
    }
}

struct Compared {
    old: Result<Option<LaneSource>, serde_json::Error>,
    new: Result<Option<LaneSource>, serde_json::Error>,
}
impl Compared {
    fn same(self) -> bool {
        match (self.old, self.new) {
            (Ok(old), Ok(new)) => { assert_eq!(old, new); true }
            (Err(_), Err(error)) => { assert!(error.line() > 0, "{error}"); false }
            pair => panic!("unlisted difference: {pair:?}"),
        }
    }
    fn refused(self, expected: LaneSource, message: &str) {
        assert_eq!(self.old.unwrap(), Some(expected));
        let error = self.new.unwrap_err();
        assert!(error.to_string().contains(message), "{error}");
    }
}
fn compare(text: &str) -> Compared {
    Compared {
        old: from_text::<Option<oracle::Old>>(text).map(|x| x.map(oracle::Old::current)),
        new: from_text::<Option<LaneSource>>(text),
    }
}

fn object(fields: &[(String, String)]) -> String {
    format!("{{{}}}", fields.iter().map(|(k,v)| format!("{}:{v}", to_text(k).unwrap())).collect::<Vec<_>>().join(","))
}
fn fields(text: &str) -> Vec<(String, String)> {
    let Json::Object(map) = from_text::<Json>(text).unwrap() else { panic!("object") };
    map.into_iter().map(|(k,v)| (k, to_text(&v).unwrap())).collect()
}
fn permutations<T: Clone>(items: &[T]) -> Vec<Vec<T>> {
    if items.is_empty() { return vec![vec![]]; }
    let mut out = Vec::new();
    for i in 0..items.len() {
        let mut rest = items.to_vec(); let first = rest.remove(i);
        for mut tail in permutations(&rest) { tail.insert(0, first.clone()); out.push(tail); }
    }
    out
}
fn source_texts(value: &Json, out: &mut Vec<String>) {
    match value {
        Json::Object(map) => {
            if let Some(Json::Array(lanes)) = map.get("lanes") {
                for lane in lanes { out.push(to_text(&lane["source"]).unwrap()); }
            }
            for v in map.values() { source_texts(v, out); }
        }
        Json::Array(array) => for v in array { source_texts(v, out); },
        _ => {}
    }
}
fn canonical_round_trip(text: &str) {
    assert!(compare(text).same());
    let old: Option<oracle::Old> = from_text(text).unwrap();
    let bytes = to_text(&old).unwrap();
    let decoded: Option<LaneSource> = from_text(&bytes).unwrap();
    assert_eq!(to_text(&decoded).unwrap(), bytes, "canonical source changed: {text}");
}
fn corpus_sources() -> Vec<String> {
    let mut sources = Vec::new();
    for path in std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/../../corpus")).unwrap() {
        let path = path.unwrap().path();
        if path.extension().is_some_and(|e| e == "json") {
            let value: Json = from_text(&std::fs::read_to_string(path).unwrap()).unwrap();
            source_texts(&value, &mut sources);
        }
    }
    sources
}

#[test]
fn every_corpus_lane_source_matches_and_keeps_canonical_bytes() {
    let sources = corpus_sources();
    assert_eq!(sources.iter().filter(|s| *s == "null").count(), 60);
    assert_eq!(sources.iter().filter(|s| *s != "null").count(), 60);
    for text in &sources { canonical_round_trip(text); }
    println!("corpus lane sources: {} (60 null, 60 Scan)", sources.len());
}

#[test]
fn every_published_quarry_lane_source_matches_and_keeps_canonical_bytes() {
    use snapback4_lang::guide::{KEYWORDS, LANGUAGE, card, quarry};
    let readme = concat!(include_str!("../../../packages/snapback4/README.md"), "\n", include_str!("../../../packages/snapback4/CLIENT-AND-OPERATIONS.md"), "\n", include_str!("../../../packages/snapback4/SERVER.md"));
    let mut docs: Vec<(&str, &str)> = KEYWORDS.iter().map(|k| (*k, card(k).unwrap())).collect();
    docs.extend([("language", LANGUAGE), ("README", readme)]);
    let (mut blocks, mut sources, mut variants) = (0, Vec::new(), [0usize; 4]);
    for (name, doc) in docs {
        for block in quarry(doc) {
            let source = guide_context::source(&block);
            let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
            assert!(bound.diagnostics.is_empty(), "{name}: {:?}", bound.diagnostics);
            blocks += 1;
            for p in bound.programs {
                let bytes = to_text(&p.program).unwrap();
                let decoded: snapback4_core::ir::Program = from_text(&bytes).unwrap();
                assert_eq!(to_text(&decoded).unwrap(), bytes, "{name}: program bytes changed");
                source_texts(&from_text::<Json>(&bytes).unwrap(), &mut sources);
            }
        }
    }
    for text in &sources {
        canonical_round_trip(text);
        let source: Option<LaneSource> = from_text(text).unwrap();
        variants[match source { None => 0, Some(LaneSource::Scan(_)) => 1, Some(LaneSource::Range { .. }) => 2, Some(LaneSource::List { .. }) => 3 }] += 1;
    }
    assert!(variants[..3].iter().all(|n| *n > 0), "{variants:?}");
    // At this base, published blocks exercise Range but no List lane; the
    // generated List objects and the compiler fixture below cover that variant.
    println!("published Quarry: {blocks} blocks, {} lane sources; null/Scan/Range/List = {variants:?}", sources.len());
}

#[test]
fn generated_field_orders_missing_duplicates_unknowns_and_mixed_domains() {
    let scan = corpus_sources().into_iter().find(|s| s != "null").unwrap();
    let range = r#"{"start":{"Literal":{"Int":0}},"end_exclusive":{"Literal":{"Int":8}},"max":8}"#;
    let list = r#"{"value":{"Array":[]},"max":8}"#;
    let mut cases = 0;
    for text in [&scan, range, list] {
        let f = fields(text);
        // All small-domain permutations; every Scan field in every position,
        // with both remaining orders (a factorial full Scan sweep is enormous).
        let orders = if f.len() <= 3 { permutations(&f) } else {
            let mut orders = Vec::new();
            for i in 0..f.len() {
                let mut rest = f.clone(); let field = rest.remove(i);
                for reverse in [false, true] {
                    let mut rest = rest.clone(); if reverse { rest.reverse(); }
                    for at in 0..=rest.len() { let mut order = rest.clone(); order.insert(at, field.clone()); orders.push(order); }
                }
            }
            orders
        };
        // Branch coverage, not exhaustive Scan permutations: every recognized
        // first key, with representative forward/reverse remaining orders.
        let first_keys: std::collections::BTreeSet<_> = orders.iter().map(|o| &o[0].0).collect();
        assert_eq!(first_keys, f.iter().map(|(k,_)| k).collect());
        for order in orders {
            assert!(compare(&object(&order)).same()); cases += 1;
            for at in 0..=order.len() {
                let mut unknown = order.clone(); unknown.insert(at, ("future".into(), r#"{"nested":[null,true,"x",3]}"#.into()));
                assert!(compare(&object(&unknown)).same()); cases += 1;
            }
        }
        for i in 0..f.len() {
            let mut missing = f.clone(); missing.remove(i); compare(&object(&missing)).same(); cases += 1;
            let mut duplicate = f.clone(); duplicate.insert(i, f[i].clone());
            assert!(!compare(&object(&duplicate)).same()); cases += 1;
        }
    }
    for max in ["null", "0", "4294967295", "4294967296", "18446744073709551615", "-1", "1.5", "\"8\"", "[]", "{}"] {
        for base in [range, list] {
            let mut f = fields(base); f.iter_mut().find(|(k,_)| k == "max").unwrap().1 = max.into();
            for order in permutations(&f) { compare(&object(&order)).same(); cases += 1; }
        }
    }
    let mut mixed = fields(range); mixed.extend(fields(list).into_iter().filter(|(k,_)| k != "max"));
    for subset in 0..(1 << mixed.len()) {
        let f: Vec<_> = mixed.iter().enumerate().filter(|(i,_)| subset & (1 << i) != 0).map(|(_,f)| f.clone()).collect();
        let has = |name| f.iter().any(|(k,_)| k == name);
        let both = has("value") && (has("start") || has("end_exclusive"));
        let complete_range = has("start") && has("end_exclusive");
        for order in permutations(&f) {
            let text = object(&order);
            if both && (has("max") || complete_range) {
                let mut expected = from_text::<LaneSource>(if complete_range { range } else { list }).unwrap();
                if !has("max") { if let LaneSource::Range { max, .. } = &mut expected { *max = None; } }
                compare(&text).refused(expected, "mixed range and list lane source fields");
            } else { compare(&text).same(); }
            cases += 1;
        }
    }
    for text in ["null", "false", "1", "\"source\"", "[]", "[1,2]", "{}", "{\"future\":0}"] { compare(text).same(); cases += 1; }
    println!("generated lane source cases: {cases}");
}

#[test]
fn typed_errors_keep_text_positions_and_nested_sources_use_the_same_decoder() {
    let bad = "{\n\"start\": {\"Literal\":{\"Int\":\"wrong\"}},\n\"end_exclusive\":{\"Literal\":{\"Int\":8}}}";
    compare(bad).same();
    let error = from_text::<LaneSource>(bad).unwrap_err();
    assert_eq!(error.line(), 2); assert!(error.column() > 20, "{error}");
    let scan: Scan = from_text(&corpus_sources().into_iter().find(|s| s != "null").unwrap()).unwrap();
    let scan_error = to_text(&scan).unwrap().replacen("{", "{\n", 1);
    let scan_error = scan_error.replace("\"site\":\"", "\"site\":false,\"future\":\"");
    let direct = from_text::<Scan>(&scan_error).unwrap_err();
    let replay = from_text::<LaneSource>(&scan_error).unwrap_err();
    assert_eq!((replay.line(), replay.column()), (direct.line(), direct.column()));
    assert_eq!(replay.line(), 2);
    let nested = LaneSource::List { value: Expr::Merge(snapback4_core::ir::Merge { variant: None, position: None, view: None, order_keys: Vec::new(), site: "nested".into(), lanes: vec![snapback4_core::ir::MergeLane {
        guard: None,
        distinct: None, branch: None, project: None,
        setup: vec![], scan, source: Some(LaneSource::Range { start: Expr::Literal(snapback4_core::Value::Int(0)), end_exclusive: Expr::Literal(snapback4_core::Value::Int(8)), max: Some(8) }), binding: "i".into(),
    }] }), max: 8 };
    canonical_round_trip(&to_text(&nested).unwrap());
    // Non-object refusal is deliberate even though a derived Scan accepts its
    // positional sequence form. The object forms above are the durable shape.
    let positional = json!(["s","t","i",[],"Asc",{"Literal":1},false,null,null,null,null,false,null,"Const"]);
    let expected: Scan = from_text(&to_text(&positional).unwrap()).unwrap();
    compare(&to_text(&positional).unwrap()).refused(LaneSource::Scan(expected), "a scan, range or list lane source object");
}

#[test]
fn compiler_emitted_list_sources_match_and_keep_bytes() {
    let source = "table posts:\n  author: principal\n  at: time\n  by byAuthorTime: author, at, id\n  public 'posts'\nquery page(authors: [principal] <=50, c: cursor ?):\n  return merge posts after c first 10 by byAuthorTime:\n    [a] for a in authors\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut sources = Vec::new();
    for p in bound.programs { source_texts(&from_text::<Json>(&to_text(&p.program).unwrap()).unwrap(), &mut sources); }
    assert_eq!(sources.len(), 1);
    assert!(matches!(from_text::<LaneSource>(&sources[0]).unwrap(), LaneSource::List { .. }));
    canonical_round_trip(&sources[0]);
}

// The corpus has seven pretty-printed source objects. Ignore only JSON trivia;
// preserve field order, number spelling, escapes, and all bytes inside strings.
fn compact(text: &str) -> String {
    let (mut string, mut escape) = (false, false);
    text.chars().filter(|c| {
        let keep = string || !c.is_ascii_whitespace();
        if escape { escape = false; }
        else if string && *c == '\\' { escape = true; }
        else if *c == '"' { string = !string; }
        keep
    }).collect()
}

#[test]
fn original_corpus_source_bytes_survive_except_pretty_printing() {
    let (mut count, mut pretty) = (0, 0);
    for path in std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/../../corpus")).unwrap() {
        let path = path.unwrap().path();
        if !path.extension().is_some_and(|e| e == "json") { continue; }
        let text = std::fs::read_to_string(path).unwrap();
        for (offset, _) in text.match_indices("\"source\"") {
            let rest = text[offset + "\"source\"".len()..].trim_start();
            let Some(rest) = rest.strip_prefix(':') else { continue };
            let rest = rest.trim_start();
            let mut reader = serde_json::Deserializer::from_str(rest).into_iter::<Json>();
            let value = reader.next().unwrap().unwrap();
            if !value.is_null() && !(value.get("site").is_some() && value.get("table").is_some()) { continue; }
            let original = &rest[..reader.byte_offset()];
            let decoded: Option<LaneSource> = from_text(original).unwrap();
            let bytes = to_text(&decoded).unwrap();
            assert_eq!(bytes, compact(original), "source field bytes/order changed: {original}");
            if original != bytes { pretty += 1; }
            count += 1;
        }
    }
    assert_eq!((count, pretty), (120, 7));
    println!("original corpus sources: {count}; byte-exact compact sources: {}; pretty-printed: {pretty}", count - pretty);
}


#[test]
fn newly_added_scan_fields_and_nullable_max_keep_the_derive_contract() {
    let mut scan: Scan = from_text(&corpus_sources().into_iter().find(|s| s != "null").unwrap()).unwrap();
    scan.existence = true;
    let mut f = fields(&to_text(&scan).unwrap());
    let at = f.iter().position(|(k,_)| k == "existence").unwrap();
    let existence = f.remove(at); f.insert(0, existence);
    canonical_round_trip(&object(&f));
    f.insert(0, ("future".into(), "null".into()));
    assert!(compare(&object(&f)).same());
    for max in ["null", "8"] {
        let duplicate = format!(r#"{{"max":null,"max":{max},"start":{{"Literal":{{"Int":0}}}},"end_exclusive":{{"Literal":{{"Int":8}}}}}}"#);
        assert!(!compare(&duplicate).same());
    }
}


#[test]
fn mixed_scan_and_domain_fields_refuse_in_both_orders() {
    let scan = corpus_sources().into_iter().find(|s| s != "null").unwrap();
    for small in [r#"{"start":{"Literal":{"Int":0}},"end_exclusive":{"Literal":{"Int":8}},"max":8}"#, r#"{"value":{"Array":[]},"max":8}"#] {
        let mut mixed = fields(&scan); mixed.extend(fields(small));
        for first in 0..mixed.len() {
            let mut f = mixed.clone(); f.rotate_left(first);
            compare(&object(&f)).refused(LaneSource::Scan(from_text(&scan).unwrap()), "mixed scan and range/list lane source fields");
        }
    }
}

#[test]
fn skipped_unknown_syntax_keeps_the_existing_web_validation_boundary() {
    let scan = corpus_sources().into_iter().find(|s| s != "null").unwrap();
    let range = r#"{"start":{"Literal":{"Int":0}},"end_exclusive":{"Literal":{"Int":8}},"max":8}"#;
    for source in [&scan, range] {
        for unknown in ["1e999".to_owned(), r#""\ud800""#.to_owned(), format!("{}0{}", "[".repeat(150), "]".repeat(150))] {
            let mut f = fields(source); f.push(("future".into(), unknown));
            let text = object(&f);
            let outcome = compare(&text);
            assert!(outcome.old.is_err(), "old buffer must refuse {text}");
            assert_eq!(outcome.new.unwrap(), Some(from_text::<LaneSource>(source).unwrap()));
            assert!(snapback4_core::json_codec::validate_text(&text).is_err(), "text validation must refuse {text}");
        }
    }
}

#[test]
fn ordinary_ir_structs_already_skip_unknown_subtrees_without_validation() {
    let scan = corpus_sources().into_iter().find(|s| s != "null").unwrap();
    let expected: Scan = from_text(&scan).unwrap();
    for unknown in ["1e999".to_owned(), r#""\ud800""#.to_owned(), format!("{}0{}", "[".repeat(150), "]".repeat(150))] {
        let mut f = fields(&scan); f.push(("future".into(), unknown));
        let text = object(&f);
        assert_eq!(from_text::<Scan>(&text).unwrap(), expected);
        assert!(snapback4_core::json_codec::validate_text(&text).is_err());
    }
}
