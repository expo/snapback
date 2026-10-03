//! Full named and positional unique keys require replica-independent points.
mod common;
use common::*;
use snapback4_core::{Value, ir::Expr, ir::Stmt, value::object};

const COLUMNS: [&str; 3] = ["low", "high", "third"];

fn orders(arity: usize) -> Vec<Vec<usize>> {
    if arity == 2 { vec![vec![0, 1], vec![1, 0]] }
    else { vec![vec![0, 1, 2], vec![0, 2, 1], vec![1, 0, 2], vec![1, 2, 0], vec![2, 0, 1], vec![2, 1, 0]] }
}

fn schema(arity: usize, optional: usize) -> String {
    let columns = &COLUMNS[..arity];
    let mut source = "table conversations:\n".to_owned();
    for (i, column) in columns.iter().enumerate() {
        source += &format!("  {column}: principal{}\n", if optional & (1 << i) != 0 { " ?" } else { "" });
    }
    source + &format!("  unique {}\n  public 'conversations'\n  sync public\n", columns.join(", "))
}

fn signature(arity: usize) -> String {
    COLUMNS[..arity].iter().map(|column| format!("{column}: principal ?")).collect::<Vec<_>>().join(", ")
}

fn source(arity: usize, optional: usize, guarded: bool) -> String {
    let columns = &COLUMNS[..arity];
    let mut source = schema(arity, optional);
    let signature = if guarded { signature(arity) } else { signature(arity).replace(" ?", "") };
    let mut keys = vec![columns.join(", ")];
    keys.extend(orders(arity).iter().map(|order| order.iter().map(|&i| format!("{} = {}", columns[i], columns[i])).collect::<Vec<_>>().join(", ")));
    for (i, key) in keys.iter().enumerate() {
        let guard = columns.iter().enumerate().filter(|(i, _)| optional & (1 << i) != 0)
            .map(|(_, column)| format!("{column} != null")).collect::<Vec<_>>().join(" and ");
        for (op, probe, empty) in [("point", "", "null"), ("exists", "exists ", "false")] {
            source += &format!("query {op}{i}({signature}):\n");
            if guarded && !guard.is_empty() {
                source += &format!("  if {guard}:\n    return {probe}conversations[{key}]\n  return {empty}\n");
            } else { source += &format!("  return {probe}conversations[{key}]\n"); }
        }
    }
    let predicate = columns.iter().map(|column| format!(".{column} = {column}")).collect::<Vec<_>>().join(" and ");
    source + &format!("query matches({}):\n  return conversations where {predicate} first 50 by .id\n", self::signature(arity))
}

fn key(arity: usize, nulls: usize) -> Vec<Value> {
    (0..arity).map(|i| if nulls & (1 << i) != 0 { Value::Null } else { id(COLUMNS[i]) }).collect()
}

fn row(name: &str, values: &[Value]) -> Value {
    object(std::iter::once(("id", id(name))).chain(COLUMNS.iter().copied().zip(values.iter().cloned())))
}

fn lookup_semantics<H: Host>(host: &mut H) {
    for arity in [2, 3] {
        for optional in 0..1 << arity {
            let (mut server, backend) = compile(&source(arity, optional, true));
            // Null ties remain legal storage and population-read data.
            let mut rows = vec![("conversations".into(), row("present", &key(arity, 0)))];
            for nulls in 1..1 << arity {
                if nulls & !optional == 0 {
                    for suffix in ["z", "a"] {
                        rows.push(("conversations".into(), row(&format!("null-{nulls}-{suffix}"), &key(arity, nulls))));
                    }
                }
            }
            server.seed(rows).unwrap();
            // Null-bearing duplicates above are legal; the fully present key is not.
            assert!(server.seed([("conversations".into(), row("duplicate", &key(arity, 0)))]).is_err());
            let name = format!("keys-{arity}-{optional}");
            let mut device = host.open(&name, Some(backend)).unwrap();
            for (i, page) in snapshot_pages(&mut server, "alice", 2).iter().enumerate() {
                device.apply(page, i == 0).unwrap();
            }
            host.close(&name, device);
            let mut device = host.open(&name, None).unwrap();
            for nulls in 0..1 << arity {
                for missing in [false, true] {
                    let mut values = key(arity, nulls);
                    if missing { values[0] = id("missing"); }
                    let present = !missing && nulls == 0;
                    let expected = if !present { Value::Null }
                        else { row("present", &values) };
                    let input: Vec<_> = COLUMNS.iter().copied().zip(values.iter().cloned()).take(arity).collect();
                    let json = snapback4_core::wire::to_json(&object(input.clone()));
                    for i in 0..=orders(arity).len() {
                        for (op, expected) in [(format!("point{i}"), expected.clone()), (format!("exists{i}"), Value::Bool(present))] {
                            let server_read = server.query(&op, context("alice", &input)).unwrap();
                            let device_read = device.query(&op, "alice", &json, 10).unwrap();
                            for (host, data, complete) in [("server", &server_read.data, server_read.complete), (host.label(), &device_read.data, device_read.complete)] {
                                assert!(complete, "{host} {arity}/{optional}/{nulls}/{missing} {op}");
                                assert_eq!(data, &expected, "{host} {arity}/{optional}/{nulls}/{missing} {op}");
                            }
                        }
                    }
                    let server_matches = server.query("matches", context("alice", &input)).unwrap();
                    let device_matches = device.query("matches", "alice", &json, 10).unwrap();
                    let count = if missing || nulls & !optional != 0 { 0 } else if nulls == 0 { 1 } else { 2 };
                    assert!(server_matches.complete && device_matches.complete);
                    assert_eq!(server_matches.data.as_array().unwrap().len(), count);
                    assert_eq!(device_matches.data, server_matches.data);
                }
            }
        }
    }
}

#[test]
fn named_keys_server_and_memory() { lookup_semantics(&mut Memory::new()); }

#[test]
fn named_keys_server_and_sqlite() { lookup_semantics(&mut Sqlite::new("named-keys")); }

fn nullable_unique_writes<H: Host>(host: &mut H) {
    for arity in [2, 3] {
        let fields = COLUMNS[..arity].iter().map(|c| format!("{c}: {c}")).collect::<Vec<_>>().join(", ");
        let source = schema(arity, (1 << arity) - 1)
            + &format!("  insert <- allow\nmutation add({}):\n  return insert conversations {{ {fields} }}\n", signature(arity));
        let (mut server, backend) = compile(&source);
        server.seed([("conversations".into(), row("present", &key(arity, 0)))]).unwrap();
        let name = format!("writes-{arity}");
        let mut device = host.open(&name, Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut server, "alice", 2).iter().enumerate() {
            device.apply(page, i == 0).unwrap();
        }
        for nulls in 0..1 << arity {
            let values = key(arity, nulls);
            let input = object(COLUMNS.iter().copied().zip(values));
            for n in 0..2 {
                let prediction = device.predict("add", "alice", &snapback4_core::wire::to_json(&input), 10,
                    vec![format!("write-{nulls}-{n}")], 1);
                if nulls == 0 {
                    assert_eq!(prediction.unwrap_err().code(), "E_CONSTRAINT");
                } else {
                    assert_eq!(prediction.unwrap().written.len(), 1);
                }
            }
        }
    }
}

#[test]
fn nullable_unique_writes_memory() { nullable_unique_writes(&mut Memory::new()); }

#[test]
fn nullable_unique_writes_sqlite() { nullable_unique_writes(&mut Sqlite::new("nullable-unique")); }

#[test]
fn both_spellings_lower_to_the_same_point_without_a_shorter_total_key() {
    for arity in [2, 3] {
        for optional in 0..1 << arity {
            let bound = snapback4_lang::compile(&[("schema.q".into(), source(arity, optional, false))]);
            assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
            let mut first = None;
            for program in bound.programs.iter().filter(|p| p.program.name.starts_with("point")) {
                let [Stmt::Return(Expr::Get(read))] = program.program.body.as_slice() else {
                    panic!("not a point: {:?}", program.program);
                };
                let plan = serde_json::to_value((&read.table, &read.index, &read.key, &read.provenance)).unwrap();
                if let Some(first) = &first { assert_eq!(&plan, first); } else { first = Some(plan); }
            }
        }
    }
}

#[test]
fn partial_named_keys_still_need_a_bound() {
    for arity in [2, 3] {
        for optional in 0..1 << arity {
            for width in 1..arity {
                for order in orders(arity) {
                    let keys = order[..width].iter().map(|&i| format!("{} = {}", COLUMNS[i], COLUMNS[i])).collect::<Vec<_>>().join(", ");
                    let source = schema(arity, optional) + &format!("query partial({}):\n  return conversations[{keys}]\n", signature(arity));
                    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
                    assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_BOUND"), "{:?}", bound.diagnostics);
                }
            }
        }
    }
}

#[test]
fn calibration_29_named_direct_lookup_compiles() {
    const SCHEMA: &str = include_str!("../../../../benchmarks/runs/2026-10-02-snapback4-clique-astra-0.4.11/astra/source/snapback/schema.q");
    const WINDOWS: &str = include_str!("../../../../benchmarks/runs/2026-10-02-snapback4-clique-astra-0.4.11/astra/source/snapback/windows.q");
    assert!(SCHEMA.contains("return conversations[low, high]"));
    for key in ["low, high", "low = low, high = high", "high = high, low = low"] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), SCHEMA.replace("return conversations[low, high]", &format!("return conversations[{key}]"))), ("windows.q".into(), WINDOWS.into())]);
        assert!(bound.diagnostics.is_empty(), "{key}: {:?}", bound.diagnostics);
        let direct = bound.programs.iter().find(|p| p.program.name == "direct").unwrap();
        assert!(snapback4_core::ir::scans(&direct.program).is_empty());
    }
}

fn key_spellings(arity: usize, prefix: &str) -> Vec<String> {
    let mut keys = vec![COLUMNS[..arity].iter().map(|c| format!("{prefix}{c}")).collect::<Vec<_>>().join(", ")];
    keys.extend(orders(arity).iter().map(|order| order.iter().map(|&i| format!("{} = {prefix}{}", COLUMNS[i], COLUMNS[i])).collect::<Vec<_>>().join(", ")));
    keys
}

#[test]
fn nullable_point_arguments_require_presence_for_every_spelling() {
    for arity in [2, 3] {
        for optional in 0..1 << arity {
            for arguments in 0..1 << arity {
                let signature = COLUMNS[..arity].iter().enumerate().map(|(i, c)| format!("{c}: principal{}", if arguments & (1 << i) != 0 { " ?" } else { "" })).collect::<Vec<_>>().join(", ");
                for key in key_spellings(arity, "") {
                    for probe in ["", "exists "] {
                        let source = schema(arity, optional) + &format!("query q({signature}):\n  return {probe}conversations[{key}]\n");
                        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
                        if optional & arguments == 0 { assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics); }
                        else {
                            assert_eq!(bound.diagnostics.len(), 1, "{:?}", bound.diagnostics);
                            let d = &bound.diagnostics[0];
                            assert_eq!(d.code, "E_QUARRY_NULL_KEY", "{d:?}");
                            assert!(d.message.contains("ambiguous across replicas"), "{d:?}");
                            for text in ["non-null arguments", "presence guards", "bounded population", "key the row by id"] { assert!(d.message.contains(text), "{d:?}"); }
                            assert!(d.rewrite.is_empty(), "no unverified source edit: {d:?}");
                        }
                    }
                }
            }
            // Literal null cannot hide behind an optional type or key ordering.
            for position in 0..arity {
                for key in key_spellings(arity, "") {
                    let key = key.split(", ").map(|part| match part.split_once(" = ") {
                        Some((column, value)) => format!("{column} = {}", if value == COLUMNS[position] { "null" } else { "viewer" }),
                        None => if part == COLUMNS[position] { "null".into() } else { "viewer".into() },
                    }).collect::<Vec<_>>().join(", ");
                    let bound = snapback4_lang::compile(&[("schema.q".into(), schema(arity, optional) + &format!("query q():\n  return conversations[{key}]\n"))]);
                    assert_eq!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_NULL_KEY"), optional & (1 << position) != 0, "{:?}", bound.diagnostics);
                    if let Some(d) = bound.diagnostics.iter().find(|d| d.code == "E_QUARRY_NULL_KEY") {
                        assert!(d.message.contains("replace literal null with a non-null value"), "{d:?}");
                        assert!(!d.message.contains("if null"), "{d:?}");
                    }
                }
            }
        }
    }
}

#[test]
fn competing_index_keeps_unique_points_and_rule_probes() {
    for arity in [2, 3] {
        let columns = COLUMNS[..arity].join(", ");
        let inverse = COLUMNS[..arity].iter().rev().copied().collect::<Vec<_>>().join(", ");
        let model = schema(arity, (1 << arity) - 1).replace(&format!("unique {columns}"), &format!("unique pair: {columns}\n  by inverse: {inverse}"));
        for key in key_spellings(arity, "") {
            for probe in ["", "exists "] {
                let source = format!("{model}query q({}):\n  return {probe}conversations[{key}]\n", signature(arity).replace(" ?", ""));
                let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
                assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
                let [Stmt::Return(Expr::Get(read) | Expr::Exists(read))] = bound.programs[0].program.body.as_slice() else { panic!("{:?}", bound.programs); };
                assert_eq!(read.index, "pair");
            }
        }
        let fields = COLUMNS[..arity].iter().map(|c| format!("  {c}: principal ?\n")).collect::<String>();
        let guard = COLUMNS[..arity].iter().map(|c| format!(".{c} != null")).collect::<Vec<_>>().join(" and ");
        for key in key_spellings(arity, ".") {
            for (effect, probe) in [("read", "exists"), ("insert", "created")] {
                for (fields, guard, accepted) in [(fields.clone(), String::new(), false), (fields.clone(), format!("{guard} and "), true), (fields.replace(" ?", ""), String::new(), true)] {
                    let source = format!("{model}table messages:\n{fields}  {effect} <- {guard}{probe} conversations[{key}]\n");
                    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
                    if accepted {
                        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
                        let rules = serde_json::to_string(&bound.schema.tables["messages"].rules).unwrap();
                        assert!(rules.contains("\"index\":\"pair\""), "{rules}");
                        assert!(!rules.contains("\"index\":\"inverse\""), "{rules}");
                    } else {
                        assert_eq!(bound.diagnostics.len(), 1, "{:?}", bound.diagnostics);
                        assert_eq!(bound.diagnostics[0].code, "E_QUARRY_NULL_KEY");
                    }
                }
            }
        }
    }
}

#[test]
fn guards_follow_control_flow_without_leaking_across_rule_branches() {
    let model = schema(2, 3);
    for body in [
        "if low = null or high = null:\n    return null\n  return conversations[high = high, low = low]",
        "return low != null and high != null and exists conversations[low, high]",
    ] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), format!("{model}query q({}):\n  {body}\n", signature(2)))]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    }
    for (guard, accepted) in [
        (".low != null and .high != null and", true),
        (".low = null or .high = null or", true),
        ("not (.low = null or .high = null) and", true),
        ("(.low != null or .high != null) and", false),
        (".low != null and", false),
        (".low != null or .high != null or", false),
    ] {
        let source = format!("{model}table messages:\n  low: principal ?\n  high: principal ?\n  read <- {guard} exists conversations[high = .high, low = .low]\n");
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert_eq!(bound.diagnostics.is_empty(), accepted, "{guard}: {:?}", bound.diagnostics);
        if !accepted { assert_eq!(bound.diagnostics[0].code, "E_QUARRY_NULL_KEY"); }
    }
}

fn private_null_population<H: Host>(host: &mut H) {
    let source = source(2, 3, true).replace("  unique low, high\n  public 'conversations'\n  sync public", "  owner: principal\n  unique low, high\n  read <- .owner = viewer\n  sync to .owner")
        .replace(".high = high first 50", ".high = high and .owner = viewer first 50");
    let (mut server, backend) = compile(&source);
    server.seed([("a-alice", "alice"), ("m-bob", "bob"), ("z-carol", "carol")].map(|(name, owner)| ("conversations".into(), object([
        ("id", id(name)), ("low", Value::Null), ("high", Value::Null), ("owner", id(owner)),
    ])))).unwrap();
    let mut device = host.open("private-null", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "bob", 2).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    let input = [("low", Value::Null), ("high", Value::Null)];
    let json = snapback4_core::wire::to_json(&object(input.clone()));
    for i in 0..3 {
        for (op, expected) in [(format!("point{i}"), Value::Null), (format!("exists{i}"), Value::Bool(false))] {
            let sr = server.query(&op, context("bob", &input)).unwrap();
            let dr = device.query(&op, "bob", &json, 10).unwrap();
            assert!(sr.complete && dr.complete);
            assert_eq!(sr.data, expected);
            assert_eq!(dr.data, expected);
        }
    }
    let sr = server.query("matches", context("bob", &input)).unwrap();
    let dr = device.query("matches", "bob", &json, 10).unwrap();
    assert!(sr.complete && dr.complete);
    assert_eq!(sr.data, dr.data);
    let rows = sr.data.as_array().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].field("id").unwrap(), &id("m-bob"));
}

#[test]
fn private_null_population_memory() { private_null_population(&mut Memory::new()); }
#[test]
fn private_null_population_sqlite() { private_null_population(&mut Sqlite::new("private-null")); }

fn shorter_total_key<H: Host>(host: &mut H) {
    let source = source(2, 2, false).replace("unique low, high", "unique pair: low, high\n  unique single: low")
        + "query residual(low: principal, high: principal ?):\n  return conversations[high = high, low = low]\n";
    let (mut server, backend) = compile(&source);
    let positional = backend.programs.iter().find(|p| p.name == "point0").unwrap();
    let [Stmt::Return(Expr::Get(read))] = positional.body.as_slice() else { panic!("{positional:?}"); };
    assert_eq!(read.index, "pair");
    for name in ["point1", "point2", "exists1", "exists2", "residual"] {
        let program = backend.programs.iter().find(|p| p.name == name).unwrap();
        let [Stmt::Let { value: Expr::Get(read), .. }, ..] = program.body.as_slice() else { panic!("{program:?}"); };
        assert_eq!(read.index, "single");
    }
    server.seed([("conversations".into(), row("present", &key(2, 0))), ("conversations".into(), row("null", &[id("other"), Value::Null]))]).unwrap();
    let mut device = host.open("shorter", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "bob", 2).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    for matches in [true, false] {
        let input = [("low", id("low")), ("high", id(if matches { "high" } else { "mismatch" }))];
        for i in 0..3 {
            for (op, expected) in [(format!("point{i}"), if matches { row("present", &key(2, 0)) } else { Value::Null }), (format!("exists{i}"), Value::Bool(matches))] {
                let sr = server.query(&op, context("bob", &input)).unwrap();
                let dr = device.query(&op, "bob", &snapback4_core::wire::to_json(&object(input.clone())), 10).unwrap();
                assert!(sr.complete && dr.complete);
                assert_eq!(sr.data, expected);
                assert_eq!(dr.data, expected);
            }
        }
    }
    // An optional residual is safe: the chosen point key itself is total.
    let input = [("low", id("other")), ("high", Value::Null)];
    let sr = server.query("residual", context("bob", &input)).unwrap();
    let dr = device.query("residual", "bob", &snapback4_core::wire::to_json(&object(input.clone())), 10).unwrap();
    assert_eq!(sr.data, row("null", &[id("other"), Value::Null]));
    assert_eq!(sr.data, dr.data);
}

#[test]
fn shorter_total_key_memory() { shorter_total_key(&mut Memory::new()); }
#[test]
fn shorter_total_key_sqlite() { shorter_total_key(&mut Sqlite::new("shorter-key")); }

fn maintained_null_groups<H: Host>(host: &mut H) {
    let source = schema(2, 3) + "view totals: count conversations by .low, .high\nquery pos(low: principal ?, high: principal ?):\n  return totals[low, high]\nquery named(low: principal ?, high: principal ?):\n  return totals[high = high, low = low]\n";
    let (mut server, backend) = compile(&source);
    server.seed(["a", "m"].map(|name| ("conversations".into(), row(name, &key(2, 3))))).unwrap();
    let mut device = host.open("null-groups", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "bob", 2).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    let input = [("low", Value::Null), ("high", Value::Null)];
    for op in ["pos", "named"] {
        let sr = server.query(op, context("bob", &input)).unwrap();
        let dr = device.query(op, "bob", &snapback4_core::wire::to_json(&object(input.clone())), 10).unwrap();
        assert!(sr.complete && dr.complete);
        assert_eq!(sr.data, Value::Int(2));
        assert_eq!(sr.data, dr.data);
    }
}

#[test]
fn maintained_null_groups_memory() { maintained_null_groups(&mut Memory::new()); }
#[test]
fn maintained_null_groups_sqlite() { maintained_null_groups(&mut Sqlite::new("null-groups")); }

#[test]
fn nullable_key_write_targets_and_transition_probes_require_guards() {
    for key in key_spellings(2, "") {
        let source = schema(2, 3) + &format!("mutation remove({}):\n  delete conversations[{key}]\n", signature(2));
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert_eq!(bound.diagnostics[0].code, "E_QUARRY_NULL_KEY", "{:?}", bound.diagnostics);
    }
    for guard in ["", "old.low != null and next.high != null and "] {
        let source = schema(2, 3) + &format!("table messages:\n  low: principal ?\n  high: principal ?\n  update (old, next) <- {guard}exists conversations[high = next.high, low = old.low]\n");
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert_eq!(bound.diagnostics.is_empty(), !guard.is_empty(), "{:?}", bound.diagnostics);
        if guard.is_empty() { assert_eq!(bound.diagnostics[0].code, "E_QUARRY_NULL_KEY"); }
    }
}
