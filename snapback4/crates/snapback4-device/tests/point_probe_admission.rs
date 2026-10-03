//! Point probes cannot select one of several replica-dependent candidates.
mod common;
use common::*;
use snapback4_core::{Value, value::object};

fn schema(optional: bool, unique: bool) -> String {
    let optional = if optional { " ?" } else { "" };
    let unique = if unique { "  unique pair: low, high\n" } else { "" };
    format!("table conversations:\n  low: principal{optional}\n  high: principal{optional}\n  owner: principal\n{unique}  by inverse: high, low\n  read <- .owner = viewer\n  sync to .owner\n")
}

#[test]
fn nonunique_points_refuse_in_code_and_rules_in_every_order() {
    for optional in [false, true] {
        for unique in [false, true] {
            if unique && !optional { continue; }
            let signature = if optional { "low: principal ?, high: principal ?" } else { "low: principal, high: principal" };
            for keys in ["high, low", "low = low, high = high", "high = high, low = low"] {
                for guard in ["", "low != null and high != null and "] {
                    let source = schema(optional, unique) + &format!("query q({signature}):\n  return {guard}exists conversations[{keys}] by inverse\n");
                    refused(&source, "E_QUARRY_POINT_KEY");
                }
                let keys = keys.replace("= low", "= .low").replace("= high", "= .high");
                let keys = if keys == "high, low" { ".high, .low" } else { &keys };
                for probe in ["exists", "created"] {
                    let rule = if probe == "created" { "insert" } else { "read" };
                    let source = schema(optional, unique) + &format!("table messages:\n  low: principal\n  high: principal\n  {rule} <- {probe} conversations[{keys}] by inverse\n");
                    refused(&source, "E_QUARRY_POINT_KEY");
                }
            }
        }
    }
}

fn refused(source: &str, code: &str) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    let diagnostic = bound.diagnostics.iter().find(|d| d.code == code)
        .unwrap_or_else(|| panic!("{source}\n{:?}", bound.diagnostics));
    assert!(diagnostic.message.contains("replicas"), "{diagnostic:?}");
    assert!(diagnostic.message.contains("population"), "{diagnostic:?}");
    assert!(diagnostic.rewrite.is_empty(), "do not offer an unverified edit: {diagnostic:?}");
}

fn tied_populations<H: Host>(host: &mut H) {
    for optional in [false, true] {
        // Non-null ties require a genuinely non-unique key. Null ties also
        // cover an explicit inverse beside the nullable unique pair.
        for unique in [false, true] {
            if unique && !optional { continue; }
            let source = schema(optional, unique) + "query rows(low: principal ?, high: principal ?):\n  return conversations where .low = low and .high = high first 10 by .id\nquery mine(low: principal ?, high: principal ?):\n  return exists conversations where .low = low and .high = high and .owner = viewer\nquery any(low: principal ?, high: principal ?):\n  return exists conversations where .low = low and .high = high\n";
            let (mut server, backend) = compile(&source);
            let key = if optional { Value::Null } else { id("key") };
            server.seed([("a", "alice"), ("m", "bob"), ("z", "carol")].map(|(name, owner)| ("conversations".into(), object([
                ("id", id(name)), ("owner", id(owner)), ("low", key.clone()), ("high", key.clone()),
            ])))).unwrap();
            let mut device = host.open(&format!("ties-{optional}-{unique}"), Some(backend)).unwrap();
            for (i, page) in snapshot_pages(&mut server, "bob", 10).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
            let input = [("low", key.clone()), ("high", key)];
            let json = snapback4_core::wire::to_json(&object(input.clone()));
            let s = server.query("mine", context("bob", &input)).unwrap();
            let d = device.query("mine", "bob", &json, 10).unwrap();
            assert_eq!(s.data, Value::Bool(true));
            assert_eq!(s.data, d.data);
            assert!(s.complete && d.complete, "{}", host.label());
            let s = server.query("rows", context("bob", &input)).unwrap();
            let d = device.query("rows", "bob", &json, 10).unwrap();
            assert_eq!(s.data, d.data);
            assert_eq!(s.data.as_array().unwrap().len(), 1);
            assert_eq!(s.data.as_array().unwrap()[0].field("id"), Ok(&id("m")));
            // Hidden candidates prevent a complete global population claim.
            // Its scalar consumer refuses rather than producing false.
            assert!(!s.complete);
            let any = server.query("any", context("bob", &input)).unwrap();
            assert!(any.unavailable && !any.complete);
            assert_eq!(any.data, Value::Null);
            let local = device.query("any", "bob", &json, 10).unwrap();
            // A local answer is allowed only when it does not contradict a
            // complete server answer; the server exposed no false claim.
            if local.complete { assert_eq!(local.data, Value::Bool(true)); }
        }
    }
}

#[test] fn null_and_nonnull_ties_memory() { tied_populations(&mut Memory::new()); }
#[test] fn null_and_nonnull_ties_sqlite() { tied_populations(&mut Sqlite::new("point-probe-admission")); }

fn public_schema() -> String {
    "table conversations:\n  low: principal ?\n  high: principal ?\n  unique pair: low, high\n  public 'conversations'\n  sync public\ntable messages:\n  low: principal ?\n  high: principal ?\n  public 'messages'\n  sync public\n".into()
}

#[test]
fn lane_planning_cannot_drop_point_admission() {
    for key in [".low, null", "low = .low, high = null", "high = null, low = .low",
        ".low, x", "low = .low, high = x", "high = x, low = .low"] {
        for wrapper in ["query", "view"] {
            let tail = if wrapper == "query" {
                format!("query q(x: principal ?):\n  return messages where exists conversations[{key}] first 20 by .id\n")
            } else {
                // The synthetic view query must validate even unused views.
                format!("view v:\n  messages where exists conversations[{}] {{ low }}\n", key.replace('x', "null"))
            };
            refused(&(public_schema() + &tail), "E_QUARRY_NULL_KEY");
        }
    }
    let source = public_schema().replace("  unique pair: low, high\n", "  by inverse: high, low\n")
        + "query q(x: principal):\n  return messages where exists (conversations[low = .low, high = x] by inverse) first 20 by .id\n";
    refused(&source, "E_QUARRY_POINT_KEY");
}

#[test]
fn guards_narrow_scan_and_view_predicates_without_leaking() {
    for keys in [".low, .high", "low = .low, high = .high", "high = .high, low = .low"] {
        for predicate in [
            format!(".low != null and .high != null and exists conversations[{keys}]"),
            format!("not (.low = null or .high = null) and exists conversations[{keys}]"),
            // OR's false edge also establishes presence in both columns.
            format!(".low = null or .high = null or exists conversations[{keys}]"),
        ] {
            let source = public_schema() + &format!("view v:\n  messages where {predicate} {{ low, high }}\nquery page():\n  return messages where {predicate} first 10 by .id\nquery planned():\n  return v first 10\n");
            compile(&source);
            compile(&(public_schema() + &format!("view v:\n  messages {{ low, high }}\nquery q():\n  return v where {predicate} first 10\n")));
        }
        for predicate in [
            format!("(.low != null or .high != null) and exists conversations[{keys}]"),
            format!("exists conversations[{keys}] and .low != null and .high != null"),
        ] {
            refused(&(public_schema() + &format!("query q():\n  return messages where {predicate} first 10 by .id\n")), "E_QUARRY_NULL_KEY");
        }
        refused(&(public_schema() + &format!("query q():\n  a = messages where .low != null and .high != null first 10 by .id\n  return messages where exists conversations[{keys}] first 10 by .id\n")), "E_QUARRY_NULL_KEY");
    }
}

fn guarded_predicates<H: Host>(host: &mut H) {
    let source = public_schema() + "view v:\n  messages where .low != null and .high != null and exists conversations[high = .high, low = .low] { low, high }\nquery page():\n  return messages where .low != null and .high != null and exists conversations[.low, .high] first 10 by .id\nquery planned():\n  return v first 10\nquery lanes(x: principal ?):\n  return messages where .low != null and x != null and exists conversations[low = .low, high = x] first 10 by .id\n";
    let (mut server, backend) = compile(&source);
    let row = |name: &str, low, high| object([("id", id(name)), ("low", low), ("high", high)]);
    server.seed([
        ("conversations".into(), row("c-null-a", Value::Null, Value::Null)),
        ("conversations".into(), row("c-null-z", Value::Null, Value::Null)),
        ("conversations".into(), row("c-present", id("low"), id("high"))),
        ("messages".into(), row("m-null", Value::Null, Value::Null)),
        ("messages".into(), row("m-present", id("low"), id("high"))),
        ("messages".into(), row("m-missing", id("missing"), id("high"))),
    ]).unwrap();
    let mut device = host.open("guards", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "bob", 10).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    for (query, input, count) in [("page", vec![], 1), ("planned", vec![], 1), ("lanes", vec![("x", id("high"))], 1), ("lanes", vec![("x", Value::Null)], 0)] {
        let s = server.query(query, context("bob", &input)).unwrap();
        let d = device.query(query, "bob", &snapback4_core::wire::to_json(&object(input)), 10).unwrap();
        assert!(s.complete && d.complete, "{query} {}", host.label());
        assert_eq!(s.data, d.data);
        assert_eq!(s.data.as_array().unwrap().len(), count, "{query}");
    }
}

#[test] fn predicate_guards_memory() { guarded_predicates(&mut Memory::new()); }
#[test] fn predicate_guards_sqlite() { guarded_predicates(&mut Sqlite::new("predicate-guards")); }

#[test]
fn required_unique_superkeys_remain_points_but_caps_do_not_prove_uniqueness() {
    for index in ["low", "high, low", "high, low, owner"] {
        let source = schema(true, false).replace("  low: principal ?", "  low: principal")
            .replace("  by inverse: high, low", &format!("  unique single: low\n  by inverse: {index}"));
        let keys = index.split(", ").map(|c| format!("{c} = viewer")).collect::<Vec<_>>().join(", ");
        compile(&(source + &format!("query q():\n  return exists conversations[{keys}] by inverse\n")));
    }
    // A product population cap is not a change to point semantics.
    let source = schema(false, false).replace("  by inverse:", "  cap 3 by low, high\n  by inverse:")
        + "query q():\n  return exists conversations[high = viewer, low = viewer] by inverse\n";
    refused(&source, "E_QUARRY_POINT_KEY");
    let source = schema(false, false)
        + "table messages:\n  low: principal\n  high: principal\n  public 'messages'\n  after insert <- exists conversations[low = .low, high = .high] by inverse\n";
    refused(&source, "E_QUARRY_POINT_KEY");
}
