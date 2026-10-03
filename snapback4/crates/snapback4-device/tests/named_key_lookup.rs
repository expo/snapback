//! Full named keys and positional keys share the point read, including nulls.
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

fn source(arity: usize, optional: usize) -> String {
    let columns = &COLUMNS[..arity];
    let mut source = schema(arity, optional);
    let signature = signature(arity);
    let mut keys = vec![columns.join(", ")];
    keys.extend(orders(arity).iter().map(|order| order.iter().map(|&i| format!("{} = {}", columns[i], columns[i])).collect::<Vec<_>>().join(", ")));
    for (i, key) in keys.iter().enumerate() {
        source += &format!("query point{i}({signature}):\n  return conversations[{key}]\nquery exists{i}({signature}):\n  return exists conversations[{key}]\n");
    }
    let predicate = columns.iter().map(|column| format!(".{column} = {column}")).collect::<Vec<_>>().join(" and ");
    source + &format!("query matches({signature}):\n  return conversations where {predicate} first 50 by .id\n")
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
            let (mut server, backend) = compile(&source(arity, optional));
            // Reverse insertion order makes the null tie's id ordering observable.
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
                    let present = !missing && nulls & !optional == 0;
                    let expected = if !present { Value::Null }
                        else if nulls == 0 { row("present", &values) }
                        else { row(&format!("null-{nulls}-a"), &values) };
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
                    let count = if !present { 0 } else if nulls == 0 { 1 } else { 2 };
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
fn both_spellings_lower_to_the_same_point() {
    for arity in [2, 3] {
        for optional in 0..1 << arity {
            let bound = snapback4_lang::compile(&[("schema.q".into(), source(arity, optional))]);
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
