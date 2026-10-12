// @ref LLP 3000.007#20.24.1 — an interrupted predicate has no verdict; never skip its candidate.
mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Ceilings, Value, engine::QueryOutcome, value::object};
use snapback4_device::{call::call, device::Device, store::DeviceStore};

fn query<S: DeviceStore>(device: &mut Device<S>, op: &str, cursor: serde_json::Value, ceilings: Ceilings) -> serde_json::Value {
    let mut spent = serde_json::to_value(Ceilings::default()).unwrap();
    let limits = serde_json::to_value(ceilings).unwrap();
    for (key, value) in spent.as_object_mut().unwrap() { *value = json!(value.as_u64().unwrap() - limits[key].as_u64().unwrap()); }
    let result = call(device, json!({"op":"query", "name":op, "viewer":"alice", "args":{"c":cursor}, "now":0, "spent":spent}));
    let mut out = result["ok"].clone();
    assert!(out.is_object(), "{result}");
    if let Some(meter) = out.get_mut("metered").and_then(serde_json::Value::as_object_mut) {
        for (key, value) in meter { *value = json!(value.as_u64().unwrap() - spent[key].as_u64().unwrap()); }
    }
    out
}

const SOURCE: &str = include_str!("cut/predicates.q");
fn ids(out: &QueryOutcome) -> Vec<String> {
    out.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap().into()).collect()
}
fn predicates<H: Host>(host: &mut H) {
    let (mut engine, backend) = compile(SOURCE);
    engine.seed(vec![
        ("metas".into(), object([("id", id("m1")), ("ok", Value::Bool(true))])),
        ("tasks".into(), object([("id", id("t1")), ("owner", id("alice")), ("meta", id("m1")), ("at", Value::Int(10))])),
        ("tasks".into(), object([("id", id("t2")), ("owner", id("alice")), ("meta", id("m1")), ("at", Value::Int(5))])),
    ]).unwrap();
    let mut device = host.open("cut", Some(backend.clone())).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "alice", 2).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    for (op, expected) in [("flagged", vec!["t1", "t2"]), ("ascending", vec!["t2", "t1"]), ("single", vec!["t1", "t2"])] {
        for budget in 1..=5 {
            let args = [("c", Value::Null)];
            let ceilings = Ceilings { examined: budget, ..Default::default() };
            engine.set_ceilings(ceilings);
            let server = engine.query(op, context("alice", &args)).unwrap();
            let held = query(&mut device, op, json!(null), ceilings);
            assert_eq!(held["unknown"], false, "{} {op}/{budget}", host.label());
            assert_eq!(held["data"], snapback4_core::wire::to_json(&server.data));
            assert_eq!(held["next"], json!(server.next));
            let mut held_rows: Vec<String> = held["data"].as_array().unwrap().iter().map(|r| r["id"].as_str().unwrap().into()).collect();
            let mut next = held["next"].clone();
            for _ in 0..4 {
                if next.is_null() { break; }
                let out = query(&mut device, op, next, Ceilings::default());
                held_rows.extend(out["data"].as_array().unwrap().iter().map(|r| r["id"].as_str().unwrap().to_owned()));
                next = out["next"].clone();
            }
            assert!(next.is_null());
            assert_eq!(held_rows, expected);
            for first in [server] {
                let mut rows = ids(&first);
                let mut next = first.next;
                engine.set_ceilings(Ceilings::unbounded());
                for _ in 0..4 {
                    let Some(cursor) = next.take() else { break; };
                    let out = engine.query(op, context("alice", &[("c", Value::String(cursor))])).unwrap();
                    rows.extend(ids(&out)); next = out.next;
                }
                assert!(next.is_none());
                assert_eq!(rows, expected, "{} {op}/{budget}: interrupted predicates must not skip or duplicate a match", host.label());
            }
        }
    }
    // Repeating a starved inclusive follow must terminate, never mint a loop.
    engine.set_ceilings(Ceilings { examined: 1, ..Default::default() });
    let first = engine.query("flagged", context("alice", &[("c", Value::Null)])).unwrap();
    let cursor = first.next.unwrap();
    let again = engine.query("flagged", context("alice", &[("c", Value::String(cursor))])).unwrap();
    assert!(ids(&again).is_empty() && !again.complete && again.next.is_none());
}
#[test] fn memory_predicate_read_cut_never_loses_a_row() { predicates(&mut Memory::new()); }
#[test] fn sqlite_predicate_read_cut_never_loses_a_row() { predicates(&mut Sqlite::new("predicate-cut")); }

// @ref LLP 3000.007#20.24.7 — delivered uniform pages pay the server's logical prefix verdict.
fn group_meter<H: Host>(host: &mut H) {
    let source = include_str!("cut/groups.q");
    let (mut engine, backend) = compile(source);
    let mut rows = vec![("access".into(), object([("id", id("a")), ("bucket", Value::Int(1)), ("principal", id("alice"))]))];
    for n in 0..3 { rows.push(("items".into(), object([("id", id(&format!("r{n}"))), ("bucket", Value::Int(1)), ("score", Value::Int(n))]))); }
    engine.seed(rows).unwrap();
    let mut device = host.open("groups", Some(backend.clone())).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "alice", 2).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    for op in ["one", "two"] {
        // Sweep all public meter boundaries, including prefix admission at zero probes.
        engine.set_ceilings(Ceilings::default());
        let baseline = engine.query(op, context("alice", &[("c", Value::Null)])).unwrap();
        assert!(baseline.metered.rule_probes > 0);
        for dimension in ["examined", "index_entries", "rule_probes", "steps", "heap_bytes", "output_bytes"] {
            let value = serde_json::to_value(&baseline.metered).unwrap()[dimension].as_u64().unwrap();
            let mut boundaries = vec![0, 1, value.saturating_sub(1), value, value + 1];
            // Low-heap probes retained from the group-page campaign's shrunk
            // seed 2670: test scratch admission beyond retained-output costs.
            if dimension == "heap_bytes" { boundaries.extend([18032, 18194]); }
            for n in boundaries {
                let mut limits = serde_json::to_value(Ceilings::default()).unwrap(); limits[dimension] = json!(n);
                let ceilings: Ceilings = serde_json::from_value(limits).unwrap();
                engine.set_ceilings(ceilings);
                let server = engine.query(op, context("alice", &[("c", Value::Null)]));
                let held = query(&mut device, op, json!(null), ceilings);
                assert_eq!(held["unknown"], false, "{} {op}/{dimension}/{n}", host.label());
                let server = match server {
                    Ok(out) => out,
                    Err(error) => {
                        assert_eq!(held["denied"]["code"], error.code);
                        assert_eq!(held["denied"]["site"], json!(error.site));
                        continue;
                    }
                };
                for (key, expected) in [("data", snapback4_core::wire::to_json(&server.data)),
                    ("complete", json!(server.complete)), ("cut", json!(server.cut)), ("next", json!(server.next)),
                    ("metered", json!(server.metered)), ("nextExpiry", json!(server.next_expiry))] {
                    assert_eq!(held[key], expected, "{} {op}/{dimension}/{n}/{key}", host.label());
                }
            }
        }
    }
}
#[test] fn memory_group_prefix_meter_matches_server() { group_meter(&mut Memory::new()); }
#[test] fn sqlite_group_prefix_meter_matches_server() { group_meter(&mut Sqlite::new("group-meter")); }

// @ref LLP 3000.007#5.6 — later non-uniform reads keep inherited cuts private.
#[test]
fn an_inherited_cut_still_classifies_the_later_private_scan() {
    let source = "table padding:\n  public\n  online only\ntable tasks:\n  owner: principal\n  read <- .owner = viewer\n  online only\nquery later():\n  spent = padding first 2 by .id\n  return tasks first 1 by .id\n";
    let (mut engine, _) = compile(source);
    engine.seed(["p1", "p2"].map(|key| ("padding".into(), object([("id", id(key))])))).unwrap();
    engine.set_ceilings(Ceilings { examined: 1, ..Default::default() });
    let out = engine.query("later", context("alice", &[])).unwrap();
    assert!(!out.complete && out.data.as_array().unwrap().is_empty());
    assert_eq!(out.cut, None, "non-uniform classification must precede public cut reporting");
}
