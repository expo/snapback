use snapback4_core::{Ceilings, Context, Engine, Value, ir, value::object};
use snapback4_lang::{Bound, compile, types::Ty};
use std::collections::BTreeMap;

const SOURCE: &str = r#"
table receipts:
  message: id
  owner: principal
  state: int ?
  active: bool
  by byState: message, owner, state, id
  by byMessage: message, owner, id
  read <- .owner = viewer
  sync to .owner
query slowest(message: id):
  return min(receipts where .message = message and .owner = viewer, .state)
query fastest(message: id):
  return max(receipts where .message = message and .owner = viewer, .state)
query scanned(message: id):
  return min(receipts[message, viewer] by byMessage, .state)
query scannedMax(message: id):
  return max(receipts[message, viewer] by byMessage, .state)
query filtered(message: id):
  return min(receipts where .message = message and .owner = viewer and .state != 1, .state)
query denied(message: id, owner: principal):
  return min(receipts where .message = message and .owner = owner, .state)
query page(message: id):
  page = receipts where .message = message and .owner = viewer first 2 by .id
  return { min: min(page, .state), max: max(page, .state) }
query directPage(message: id):
  return max((receipts where .message = message and .owner = viewer first 2 by .id), .state)
query list():
  values = [{ n: null }, { n: 8 }, null, { n: -2 }, { n: 3 }]
  return { min: min(values, .n), max: max(values, .n), text: min([{ n: 'z' }, { n: 'a' }], .n) }
query binary():
  return { min: min(4, 2), max: max(4, 2), strings: min('b', 'a'), lists: max([1], [2]), shape: [{ n: 8 }] { n: min(5, .n) } }
query emptyList(values: [int] <=10):
  rows = values { n: . }
  return min(rows, .n)
mutation readState(message: id):
  return min(receipts where .message = message and .owner = viewer, .state)
"#;

fn bound(source: &str) -> Bound {
    let result = compile(&[("schema.q".into(), source.into())]);
    assert!(result.diagnostics.is_empty(), "{:#?}", result.diagnostics);
    result
}
fn engine(source: &str) -> Engine {
    let b = bound(source);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn ctx(message: &str) -> Context {
    Context::new("alice", BTreeMap::from([("message".into(), Value::Id(message.into()))])).at(100)
}
fn row(key: &str, owner: &str, message: &str, state: Option<i64>) -> (String, Value) {
    ("receipts".into(), object([("id", Value::Id(key.into())), ("message", Value::Id(message.into())),
        ("owner", Value::Id(owner.into())), ("state", state.map(Value::Int).unwrap_or(Value::Null)), ("active", Value::Bool(true))]))
}

#[test]
fn domain_extrema_skip_nulls_and_hidden_rows_and_preserve_empty_null() {
    let mut e = engine(SOURCE);
    e.seed([row("a", "alice", "m", None), row("b", "alice", "m", Some(8)),
        row("c", "alice", "m", Some(1)), row("d", "alice", "m", Some(3)),
        row("hiddenLow", "bob", "m", Some(-100)), row("hiddenHigh", "bob", "m", Some(100)),
        row("null", "alice", "onlyNull", None)]).unwrap();
    for (op, expected) in [("slowest", 1), ("fastest", 8), ("scanned", 1), ("scannedMax", 8), ("filtered", 3)] {
        let result = e.query(op, ctx("m")).unwrap();
        assert!(result.complete, "{op}: {result:?}");
        assert_eq!(result.data, Value::Int(expected), "{op}");
        for message in ["empty", "onlyNull"] {
            let result = e.query(op, ctx(message)).unwrap();
            assert!(result.complete, "{op}: {result:?}");
            assert_eq!(result.data, Value::Null);
        }
    }
    let denied = e.query("denied", Context::new("alice", BTreeMap::from([
        ("message".into(), Value::Id("m".into())), ("owner".into(), Value::Id("bob".into()))])).at(100)).unwrap();
    assert!(denied.complete);
    assert_eq!(denied.data, Value::Null);
    assert_eq!(denied.metered.examined, 0, "a prefix-denied domain never compares hidden rows");
    let page = e.query("page", ctx("m")).unwrap();
    assert_eq!(page.data, object([("min", Value::Int(8)), ("max", Value::Int(8))]));
    assert_eq!(e.query("directPage", ctx("m")).unwrap().data, Value::Int(8));
}

#[test]
fn list_and_binary_overloads_keep_types_and_meaning() {
    let mut e = engine(SOURCE);
    assert_eq!(e.query("list", Context::new("alice", BTreeMap::new())).unwrap().data, object([
        ("min", Value::Int(-2)), ("max", Value::Int(8)), ("text", Value::String("a".into()))]));
    let result = e.query("binary", Context::new("alice", BTreeMap::new())).unwrap();
    assert_eq!(result.data.field("min").unwrap(), &Value::Int(2));
    assert_eq!(result.data.field("max").unwrap(), &Value::Int(4));
    assert_eq!(result.data.field("strings").unwrap(), &Value::String("a".into()));
    assert_eq!(result.data.field("lists").unwrap(), &Value::Array(vec![Value::Int(2)]));
    assert_eq!(result.data.field("shape").unwrap(), &Value::Array(vec![object([("n", Value::Int(5))])]));
    assert_eq!(e.query("emptyList", Context::new("alice", BTreeMap::from([("values".into(), Value::Array(vec![]))]))).unwrap().data, Value::Null);
    let b = bound(SOURCE);
    let program = b.programs.iter().find(|p| p.program.name == "slowest").unwrap();
    assert_eq!(program.result, Ty::Int.optional());
}

#[test]
fn binary_calls_over_cap_bounded_reads_keep_their_row_order() {
    for builtin in ["min", "max"] {
        let source = format!("table t:\n  n: int\n  cap 10\n  public\n  online only\nquery direct():\n  return {builtin}(t where .n >= 0, t where .n >= 0)\nquery bound():\n  rows = t where .n >= 0\n  return {builtin}(rows, rows)\nquery focal():\n  rows = t where .n >= 0\n  return [{{ peers: rows }}] {{ answer: {builtin}(t where .n >= 0, .peers) }}\n");
        let mut e = engine(&source);
        e.seed([("a", 8), ("b", 1)].map(|(key, n)| ("t".into(), object([
            ("id", Value::Id(key.into())), ("n", Value::Int(n))])))).unwrap();
        let ctx = || Context::new("alice", BTreeMap::new());
        let expected = e.query("bound", ctx()).unwrap();
        assert_eq!(expected.data.as_array().unwrap()[0].field("id").unwrap(), &Value::Id("a".into()));
        assert_eq!(e.query("direct", ctx()).unwrap().data, expected.data);
        assert_eq!(e.query("focal", ctx()).unwrap().data.as_array().unwrap()[0].field("answer").unwrap(), &expected.data);
    }
}

#[test]
fn binary_maintained_point_extrema_keep_their_scalar_overload() {
    for builtin in ["min", "max"] {
        for (groups, positional, named) in [(".owner", "viewer", "owner = viewer"),
            (".owner, .bucket", "viewer, 1", "owner = viewer, bucket = 1")] {
            let source = format!("table t:\n  owner: principal\n  bucket: int\n  public\n  online only\nview totals: count t by {groups}\n  by byValue: value, id\n  online only\nquery direct():\n  return [{{ value: 5 }}] {{ n: {builtin}(totals[{positional}], .value) }}\nquery named():\n  return [{{ value: 5 }}] {{ n: {builtin}(totals[{named}], .value) }}\nquery explicit():\n  return [{{ value: 5 }}] {{ n: {builtin}(totals[{positional}] by byGroup, .value) }}\nquery bound():\n  total = totals[{positional}]\n  return [{{ value: 5 }}] {{ n: {builtin}(total, .value) }}\n");
            let b = bound(&source);
            for program in &b.programs { assert!(ir::scans(&program.program).is_empty()); }
            let mut e = engine(&source);
            for count in [0, 3, 7] {
                e.seed((0..count).map(|i| ("t".into(), object([
                    ("id", Value::Id(format!("r{i}"))), ("owner", Value::Id("alice".into())), ("bucket", Value::Int(1))])))).unwrap();
                for op in ["direct", "named", "explicit", "bound"] {
                    let result = e.query(op, Context::new("alice", BTreeMap::new())).unwrap();
                    assert!(result.complete, "{builtin} {op}: {result:?}");
                    let expected = if builtin == "min" { count.min(5) } else { count.max(5) };
                    assert_eq!(result.data.as_array().unwrap()[0].field("n").unwrap(), &Value::Int(expected), "{builtin} {op}");
                }
            }
        }
    }
}

#[test]
fn one_large_json_winner_fits_the_default_heap() {
    let source = "table witness:\n  payload: json <=3000000\n  public\n  online only\nquery low():\n  return min(witness, .payload) != null\nquery high():\n  return max(witness, .payload) != null\n";
    let mut e = engine(source);
    let payload = object([("big", Value::String(format!("a{}", "x".repeat(2_500_000))))]);
    e.seed([("witness".into(), object([("id", Value::Id("a".into())), ("payload", payload.clone())]))]).unwrap();
    for op in ["low", "high"] {
        let result = e.query(op, Context::new("alice", BTreeMap::new())).unwrap();
        assert!(result.complete, "{op}: {result:?}");
        assert_eq!(result.data, Value::Bool(true));
        assert_eq!(result.metered.examined, 1);
        assert!(result.metered.heap_bytes >= retained_heap(&payload));
        assert!(result.metered.heap_bytes < Ceilings::default().heap_bytes);
        eprintln!("one 2.5 MB JSON {op}: examined={}, heap={}", result.metered.examined, result.metered.heap_bytes);
    }
}

#[test]
fn replacing_a_large_json_winner_fits_eighteen_mib() {
    let source = "table witness:\n  payload: json <=3000000\n  public\n  online only\nquery high():\n  return max(witness, .payload) != null\n";
    let mut e = engine(source);
    let payload = |prefix| object([("big", Value::String(format!("{prefix}{}", "x".repeat(2_500_000))))]);
    e.seed(["a", "b"].map(|id| ("witness".into(), object([("id", Value::Id(id.into())), ("payload", payload(id))])))).unwrap();
    e.set_ceilings(Ceilings { heap_bytes: 18 << 20, ..Ceilings::default() });
    let result = e.query("high", Context::new("alice", BTreeMap::new())).unwrap();
    assert!(result.complete, "{result:?}");
    assert_eq!(result.data, Value::Bool(true));
    assert_eq!(result.metered.examined, 2);
    assert!(result.metered.heap_bytes >= retained_heap(&payload("b")));
    assert!(result.metered.heap_bytes < 18 << 20);
    eprintln!("two 2.5 MB JSON max with replacement: examined={}, heap={}", result.metered.examined, result.metered.heap_bytes);
}

#[test]
fn streamed_json_winners_exhaust_the_retained_heap() {
    let source = "table witness:\n  payload: json <=3000000\n  public\n  online only\nquery q():\n  return min(witness, .payload) = max(witness, .payload)\nquery low():\n  return min(witness, .payload) != null\nquery high():\n  return max(witness, .payload) != null\n";
    let mut e = engine(source);
    e.seed(["a", "b"].map(|id| ("witness".into(), object([
        ("id", Value::Id(id.into())), ("payload", object([("big", Value::String("x".repeat(2_500_000)))]))])))).unwrap();
    // Each fold fits alone. The second fold cannot fit while the first
    // winner remains live as the left operand of the equality expression.
    // The ceiling sits between one fold's peak (a transient 10 MB row image
    // plus its 2.5 MB winner) and both folds'; it was the default 16 MiB while
    // SQLite also charged its own 5 MB preflight copies (LLP 3000.007 §20.24.5).
    // At the default 16 MiB ceiling both winners now fit beside one transient image.
    let result = e.query("q", Context::new("alice", BTreeMap::new())).unwrap();
    assert!(result.complete, "both retained winners fit the default ceiling: {result:?}");
    assert_eq!(result.data, Value::Bool(true));
    assert!(result.metered.heap_bytes >= 2 * 2_500_000 && result.metered.heap_bytes < Ceilings::default().heap_bytes, "{:?}", result.metered);
    e.set_ceilings(Ceilings { heap_bytes: 14 << 20, ..Ceilings::default() });
    for op in ["low", "high"] {
        let result = e.query(op, Context::new("alice", BTreeMap::new())).unwrap();
        assert!(result.complete, "{op}: {result:?}");
        assert_eq!(result.data, Value::Bool(true));
    }
    let result = e.query("q", Context::new("alice", BTreeMap::new())).unwrap();
    assert!(!result.complete, "{result:?}");
    assert_eq!(result.data, Value::Null);
    assert!(result.metered.examined >= 3, "the first winner is already live: {result:?}");
    assert_eq!(result.capped_at.as_ref().map(|(kind, _)| *kind), Some(snapback4_core::error::MeterKind::HeapBytes));
}

#[test]
fn replacing_a_json_winner_releases_its_full_retained_charge() {
    let source = "table t:\n  payload: json <=10000\n  public\n  online only\nquery low():\n  return min(t, .payload)\nquery high():\n  return max(t, .payload)\n";
    for op in ["low", "high"] {
        for growing in [true, false] {
            let mut e = engine(source);
            let payload = |i: usize| {
                let order = if op == "high" { i } else { 127 - i };
                let size = 200 + 64 * if growing { i } else { 127 - i };
                Value::Array(vec![object([("big", Value::String(format!("{order:04}{}", "x".repeat(size))))])])
            };
            e.seed((0..128).map(|i| ("t".into(), object([("id", Value::Id(format!("r{i:04}"))), ("payload", payload(i))])))).unwrap();
            e.set_ceilings(Ceilings { heap_bytes: 128 * 1024, ..Ceilings::default() });
            let result = e.query(op, Context::new("alice", BTreeMap::new())).unwrap();
            assert!(result.complete, "{op}, growing={growing}: {result:?}");
            assert_eq!(result.data, payload(127));
            assert_eq!(result.metered.examined, 128);
            let retained = retained_heap(&result.data);
            assert!(result.metered.heap_bytes >= retained, "{op}, growing={growing}: winner undercharged");
            assert!(result.metered.heap_bytes < retained + 4096, "{op}, growing={growing}: old reservation leaked");
            assert!(result.metered.heap_bytes < 128 * 1024);
            eprintln!("varying JSON {op}, growing={growing}: payload={retained}, heap={}", result.metered.heap_bytes);
        }
    }
}

#[test]
fn ordered_index_seeks_one_row_among_ten_thousand_and_fallback_scans() {
    let source = SOURCE.replace("state: int ?", "state: int");
    let mut e = engine(&source);
    e.seed((0..10_000).map(|i| row(&format!("r{i:05}"), "alice", "m", Some(i)))).unwrap();
    for (op, expected) in [("slowest", 0), ("fastest", 9999)] {
        let result = e.query(op, ctx("m")).unwrap();
        assert!(result.complete, "{result:?}");
        assert_eq!(result.data, Value::Int(expected));
        assert_eq!(result.metered.examined, 1, "{op}: {result:?}");
    }
    for op in ["scanned", "scannedMax"] {
        let result = e.query(op, ctx("m")).unwrap();
        assert!(!result.complete);
        assert_eq!(result.data, Value::Null, "cut domains never return a partial extremum");
        assert!(result.capped_at.is_some());
    }
    let b = bound(&source);
    for (op, order) in [("slowest", ir::Order::Asc), ("fastest", ir::Order::Desc)] {
        let scans = ir::scans(&b.programs.iter().find(|p| p.program.name == op).unwrap().program);
        assert_eq!(scans[0].index, "byState");
        assert_eq!(scans[0].order, order);
    }
}

#[test]
fn examined_steps_and_heap_cuts_are_unavailable_even_with_a_default() {
    let source = format!("{SOURCE}\nquery defaulted(message: id):\n  return min(receipts[message, viewer] by byMessage, .state) ?? 2\n");
    for ceilings in [Ceilings { examined: 1, ..Ceilings::default() }, Ceilings { steps: 5, ..Ceilings::default() }, Ceilings { heap_bytes: 64, ..Ceilings::default() }] {
        let mut e = engine(&source);
        e.seed([row("a", "alice", "m", Some(8)), row("b", "alice", "m", Some(1))]).unwrap();
        e.set_ceilings(ceilings);
        for op in ["scanned", "scannedMax", "defaulted"] {
            let result = e.query(op, ctx("m")).unwrap();
            assert!(!result.complete, "{op}: {result:?}");
            assert_eq!(result.data, Value::Null, "{op}: {result:?}");
        }
    }
}

#[test]
fn optional_variants_remain_streaming_and_do_not_change_null_semantics() {
    let source = format!("{SOURCE}\nquery optional(message: id, threshold: int ?):\n  return max(receipts where .message = message and .owner = viewer and (threshold = null or .state >= threshold), .state)\n");
    let mut e = engine(&source);
    e.seed([row("a", "alice", "m", None), row("b", "alice", "m", Some(2)), row("c", "alice", "m", Some(8))]).unwrap();
    for (threshold, expected) in [(Value::Null, Value::Int(8)), (Value::Int(5), Value::Int(8)), (Value::Int(9), Value::Null)] {
        let result = e.query("optional", Context::new("alice", BTreeMap::from([("message".into(), Value::Id("m".into())), ("threshold".into(), threshold)])).at(100)).unwrap();
        assert!(result.complete, "{result:?}");
        assert_eq!(result.data, expected);
    }
}

#[test]
fn ambiguous_order_comma_has_a_compiling_rewrite() {
    let bad = SOURCE.replace("max((receipts where .message = message and .owner = viewer first 2 by .id), .state)",
        "max(receipts where .message = message and .owner = viewer first 2 by .id, .state)");
    let b = compile(&[("schema.q".into(), bad.clone())]);
    let diagnostic = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_AMBIGUOUS").unwrap_or_else(|| panic!("ambiguity diagnostic: {:?}", b.diagnostics));
    assert!(diagnostic.message.contains("comma"), "{diagnostic:?}");
    assert!(diagnostic.rewrite.contains("max((receipts"), "{diagnostic:?}");
    bound(&bad.replace("max(receipts where .message = message and .owner = viewer first 2 by .id, .state)", &diagnostic.rewrite));
}

#[test]
fn bare_table_and_typed_nullable_columns() {
    let source = "table values:\n  at: time ?\n  price: money USD ?\n  label: text <=20 ?\n  by byAt: at, id\n  public\n  sync public\nquery low():\n  return min(values, .at)\nquery high():\n  return max(values, .at)\nquery price():\n  return min(values, .price)\nquery label():\n  return max(values, .label)\n";
    let b = bound(source);
    for (op, ty) in [("low", Ty::Time.optional()), ("high", Ty::Time.optional()), ("label", Ty::Text(20).optional())] {
        assert_eq!(b.programs.iter().find(|p| p.program.name == op).unwrap().result, ty);
    }
    let mut e = engine(source);
    e.seed([("a", 10, 100, "a"), ("b", 20, 200, "b")].map(|(key, at, price, label)| ("values".into(), object([
        ("id", Value::Id(key.into())), ("at", Value::Int(at)), ("price", Value::Int(price)), ("label", Value::String(label.into()))])))).unwrap();
    for (op, expected) in [("low", Value::Int(10)), ("high", Value::Int(20)), ("price", Value::Int(100)), ("label", Value::String("b".into()))] {
        let result = e.query(op, Context::new("alice", BTreeMap::new())).unwrap();
        assert!(result.complete, "{result:?}");
        assert_eq!(result.data, expected);
        if op == "low" || op == "high" { assert_eq!(result.metered.examined, 1); }
    }
}

#[test]
fn extrema_seek_skips_expired_rows_and_respects_filter_cuts() {
    let source = SOURCE.replace("  state: int ?", "  expiresAt: time ?\n  expire at .expiresAt\n  state: int ?")
        .replace("mutation readState(message: id):\n  return min(receipts where .message = message and .owner = viewer, .state)\n", "");
    let mut e = engine(&source);
    let mut expired = row("old", "alice", "m", Some(-100));
    let mut fields = expired.1.as_object().unwrap().clone();
    fields.insert("expiresAt".into(), Value::Int(50));
    expired.1 = Value::Row(fields.into());
    e.seed([expired, row("a", "alice", "m", None), row("b", "alice", "m", Some(1)), row("c", "alice", "m", Some(8))]).unwrap();
    assert_eq!(e.query("slowest", ctx("m")).unwrap().data, Value::Int(1));
    e.set_ceilings(Ceilings { examined: 2, ..Ceilings::default() });
    let cut = e.query("filtered", ctx("m")).unwrap();
    assert!(!cut.complete);
    assert_eq!(cut.data, Value::Null);
}

#[test]
fn streaming_text_keeps_only_one_selected_value_charged() {
    let source = "table t:\n  value: text <=1024\n  public\n  online only\nquery low():\n  return min(t, .value)\nquery high():\n  return max(t, .value)\n";
    let mut e = engine(source);
    e.seed((0..4096).map(|i| ("t".into(), object([("id", Value::Id(format!("r{i:04}"))), ("value", Value::String(format!("{i:04}{}", "x".repeat(1000))))])))).unwrap();
    e.set_ceilings(Ceilings { heap_bytes: 128 * 1024, ..Ceilings::default() });
    for (op, prefix) in [("low", "0000"), ("high", "4095")] {
        let result = e.query(op, Context::new("alice", BTreeMap::new())).unwrap();
        assert!(result.complete, "{op}: {result:?}");
        assert!(result.data.as_str().unwrap().starts_with(prefix));
        assert_eq!(result.metered.examined, 4096);
        assert!(result.metered.heap_bytes < 128 * 1024);
    }
}

#[test]
fn ordered_index_reuses_permuted_pins_and_extra_tie_columns() {
    let source = SOURCE.replace("by byState: message, owner, state, id", "by byState: owner, message, state, active, id");
    let mut e = engine(&source);
    e.seed((0..10_000).map(|i| row(&format!("r{i:05}"), "alice", "m", Some(i)))).unwrap();
    for (op, expected) in [("slowest", 0), ("fastest", 9999)] {
        let result = e.query(op, ctx("m")).unwrap();
        assert!(result.complete, "{op}: {result:?}");
        assert_eq!(result.data, Value::Int(expected));
        assert_eq!(result.metered.examined, 1);
        let b = bound(&source);
        assert_eq!(ir::scans(&b.programs.iter().find(|p| p.program.name == op).unwrap().program)[0].index, "byState");
    }
}

#[test]
fn nonuniform_rule_runs_before_the_residual_predicate() {
    let source = "table t:\n  owner: principal\n  n: int\n  by byN: n, id\n  cap 10\n  read <- .owner = viewer\n  online only\nquery q():\n  return min(t where 10 / .n > 1, .n)\n";
    let mut e = engine(source);
    e.seed([("hidden", "bob", 0), ("visible", "alice", 2)].map(|(key, owner, n)| ("t".into(), object([
        ("id", Value::Id(key.into())), ("owner", Value::Id(owner.into())), ("n", Value::Int(n))])))).unwrap();
    // As with sum, a non-uniform domain retains its incomplete contract.
    // Evaluating the hidden row's predicate would instead refuse E_DIV_ZERO.
    let result = e.query("q", Context::new("alice", BTreeMap::new())).unwrap();
    assert!(!result.complete);
    assert_eq!(result.data, Value::Null);
}

#[test]
fn seek_skips_ten_thousand_null_keys_without_spending_the_scan_meter() {
    let mut e = engine(SOURCE);
    e.seed((0..10_000).map(|i| row(&format!("r{i:05}"), "alice", "m", None))).unwrap();
    for op in ["slowest", "fastest"] {
        let result = e.query(op, ctx("m")).unwrap();
        assert!(result.complete, "{result:?}");
        assert_eq!(result.data, Value::Null);
        assert_eq!(result.metered.examined, 0);
    }
    e.seed([row("present", "alice", "m", Some(4))]).unwrap();
    for op in ["slowest", "fastest"] {
        let result = e.query(op, ctx("m")).unwrap();
        assert!(result.complete, "{result:?}");
        assert_eq!(result.data, Value::Int(4));
        assert_eq!(result.metered.examined, 1);
    }
}

#[test]
fn competing_focal_scopes_are_refused_and_binary_collection_members_survive() {
    let source = "query q():\n  rows = [{ n: [{ n: 1 }] }]\n  return [{ n: rows }] { value: min(rows, .n) }\n";
    let b = compile(&[("schema.q".into(), source.into())]);
    let d = b.diagnostics.iter().find(|d| d.code == "E_QUARRY_AMBIGUOUS").unwrap_or_else(|| panic!("{:?}", b.diagnostics));
    assert!(d.rewrite.contains("other = .n"));
    let source = "query q():\n  rows = [{ n: 1 }]\n  return [{ other: rows }] { value: min(rows, .other) }\n";
    let result = engine(source).query("q", Context::new("alice", BTreeMap::new())).unwrap();
    assert_eq!(result.data.as_array().unwrap()[0].field("value").unwrap(), &Value::Array(vec![object([("n", Value::Int(1))])]));
}

#[test]
fn direct_and_bound_authorized_pages_agree_and_neither_masks_a_cut() {
    let source = "table t:\n  owner: principal\n  n: int\n  by byN: n, id\n  read <- .owner = viewer\n  online only\nquery direct():\n  return min((t first 2 by .n), .n)\nquery bound():\n  page = t first 2 by .n\n  return min(page, .n)\n";
    let mut e = engine(source);
    e.seed([("hidden", "bob", 0), ("a", "alice", 2), ("b", "alice", 4), ("c", "alice", 8)].map(|(key, owner, n)| ("t".into(), object([
        ("id", Value::Id(key.into())), ("owner", Value::Id(owner.into())), ("n", Value::Int(n))])))).unwrap();
    for op in ["direct", "bound"] {
        let result = e.query(op, Context::new("alice", BTreeMap::new())).unwrap();
        assert_eq!(result.data, Value::Int(2));
        assert!(!result.complete, "the ordinary page's non-uniform flag remains");
    }
    e.set_ceilings(Ceilings { examined: 1, ..Ceilings::default() });
    for op in ["direct", "bound"] {
        let result = e.query(op, Context::new("alice", BTreeMap::new())).unwrap();
        assert!(!result.complete);
        assert_eq!(result.data, Value::Null);
    }
}

#[test]
fn expiring_maintained_values_scan_live_totals_and_refuse_stale_order() {
    let source = "table receipts:\n  owner: principal\n  state: int\n  expiresAt: time ?\n  expire at .expiresAt\n  public\n  online only\nview totals: sum receipts of .state by .owner\n  by byValue: value, id\n  online only\nquery low():\n  return min(totals, .value)\nquery high():\n  return max(totals, .value)\n";
    let refused = compile(&[("schema.q".into(), source.into())]);
    assert!(refused.diagnostics.iter().any(|d| d.code == "E_QUARRY_MAINTAIN_EXPIRE"));
    let source = source.replace("  by byValue: value, id\n", "");
    let mut e = engine(&source);
    e.seed([("a", "alice", 100, Value::Int(50)), ("b", "alice", 0, Value::Null), ("c", "bob", 50, Value::Null)]
        .map(|(key, owner, n, expiry)| ("receipts".into(), object([("id", Value::Id(key.into())), ("owner", Value::Id(owner.into())), ("state", Value::Int(n)), ("expiresAt", expiry)])))).unwrap();
    for (op, expected) in [("low", 0), ("high", 50)] {
        let result = e.query(op, Context::new("alice", BTreeMap::new()).at(100)).unwrap();
        assert!(result.complete, "{op}: {result:?}");
        assert_eq!(result.data, Value::Int(expected));
        let b = bound(&source);
        let scans = ir::scans(&b.programs.iter().find(|p| p.program.name == op).unwrap().program);
        assert_eq!(scans[0].index, "byId");
        assert!(!scans[0].orders_field(&b.schema, "value"));
    }
}

// Independent lower bound on the caller-owned result's retained payload.
// This test deliberately has no raw-ledger counter access.
fn retained_heap(value: &Value) -> u64 {
    match value {
        Value::String(s) | Value::Id(s) => s.len() as u64,
        Value::Bytes(b) => b.len() as u64,
        Value::Array(a) => (a.len() * std::mem::size_of::<Value>()) as u64 + a.iter().map(retained_heap).sum::<u64>(),
        Value::Row(m) | Value::Map(m) => m.iter().map(|(k, v)| k.len() as u64 + retained_heap(v)).sum(),
        _ => 0,
    }
}
