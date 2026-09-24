//! Pending is the union of spread row metadata, regardless of replaced fields.
mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Value, WriteState, value::object};
use snapback4_device::device::Device;

const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/spread-metadata.q");
const CONFIRMED: [&str; 3] = ["confirmed-first", "confirmed-tag", "confirmed-third"];
const PREDICTED_VALUES: [&str; 3] = ["pending first", "pending tag", "pending third"];

fn inspect<S: BoundaryMetadata>(device: &mut Device<S>, predicted: &[String], pending_mask: u8) {
    for selection in 0..8_u8 {
        let keys: Vec<_> = (0..3).map(|n| if selection & (1 << n) == 0 { CONFIRMED[n] } else { &predicted[n] }).collect();
        let args = json!({"first":keys[0], "tag":keys[1], "third":keys[2]});
        let flattened = device.query("flattened", "alice", &args, 100).unwrap();
        assert!(flattened.complete);
        assert_eq!(flattened.metered.examined, 3);
        assert_eq!(flattened.data.field("id").unwrap(), &id(keys[2]));
        assert_eq!(flattened.data.field("title").unwrap(), &Value::String(if selection & 4 == 0 { "confirmed third" } else { PREDICTED_VALUES[2] }.into()));
        assert_eq!(flattened.data.field("label").unwrap(), &Value::String(if selection & 2 == 0 { "confirmed tag" } else { PREDICTED_VALUES[1] }.into()));
        // The first note's fields are all replaced by the third note. Its
        // pending flag must still agree through either nesting direction.
        for name in ["composed", "composedRight"] {
            let nested = device.query(name, "alice", &args, 100).unwrap();
            assert!(nested.complete);
            assert_eq!(nested.metered.examined, 3);
            assert_eq!(nested.data, flattened.data, "{name}, selection={selection}, pending={pending_mask}");
        }
        let marked = selection & pending_mask != 0;
        assert_eq!(flattened.data.as_object().unwrap().get("pending"), marked.then_some(&Value::Bool(true)), "selection={selection}, pending={pending_mask}");
        for name in ["tagged", "taggedReverse"] {
            let pair = device.query(name, "alice", &json!({"key":keys[0], "tag":keys[1]}), 100).unwrap();
            assert!(pair.complete);
            assert_eq!(pair.metered.examined, 2);
            assert_eq!(pair.data.field("id").unwrap(), &id(if name == "tagged" { keys[1] } else { keys[0] }));
            assert_eq!(pair.data.field("title").unwrap(), &Value::String(if selection & 1 == 0 { "confirmed first" } else { PREDICTED_VALUES[0] }.into()));
            assert_eq!(pair.data.field("label").unwrap(), flattened.data.field("label").unwrap());
            assert_eq!(pair.data.as_object().unwrap().get("pending"), (selection & pending_mask & 3 != 0).then_some(&Value::Bool(true)), "{name}, selection={selection}, pending={pending_mask}");
        }
    }
}

fn lifecycle<H: Host>(host: &mut H) {
    let (mut server, backend) = compile(SOURCE);
    server.seed([
        ("notes".into(), object([("id", id(CONFIRMED[0])), ("owner", id("alice")), ("title", Value::String("confirmed first".into()))])),
        ("tags".into(), object([("id", id(CONFIRMED[1])), ("owner", id("alice")), ("label", Value::String("confirmed tag".into()))])),
        ("notes".into(), object([("id", id(CONFIRMED[2])), ("owner", id("alice")), ("title", Value::String("confirmed third".into()))])),
    ]).unwrap();
    let mut device = host.open("spread-union", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut server, "alice", 10).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let mut queued = Vec::new();
    for (n, (op, field)) in [("add", "title"), ("addTag", "label"), ("add", "title")].into_iter().enumerate() {
        let entry = device.admit(serde_json::from_value(json!({
            "id":format!("spread-{n}"), "seq":n + 1, "op":op,
            "args":{field:PREDICTED_VALUES[n]}, "new_ids":[format!("predicted-{n}")],
            "viewer":"alice", "now":100, "predictable":true,
        })).unwrap()).unwrap();
        assert!(entry.predictable);
        queued.push((entry, field));
    }
    let predicted: Vec<_> = queued.iter().map(|(entry, _)| entry.new_ids[0].clone()).collect();
    let mut pending_mask = 7;
    inspect(&mut device, &predicted, pending_mask);
    host.close("spread-union", device);
    let mut device = host.open("spread-union", None).unwrap();
    assert_eq!(device.queued().unwrap().len(), 3);
    inspect(&mut device, &predicted, pending_mask);
    // Inspect after each settlement, including a confirmed first operand with
    // a still-pending second operand, then reopen that exact outbox state.
    for (n, (entry, field)) in queued.iter().enumerate() {
        let result = server.mutate(&entry.op, Some(&entry.id), context("alice", &[(field, Value::String(PREDICTED_VALUES[n].into()))]).at(100).with_ids(entry.new_ids.clone())).unwrap();
        let WriteState::Sent { seq, .. } = result.state else { panic!("{:?}", result.state) };
        device.settle(&entry.id, Some(seq)).unwrap();
        let from = device.state().unwrap().0;
        device.apply(&stream_page(&mut server, "alice", from), false).unwrap();
        pending_mask &= !(1 << n);
        assert_eq!(device.queued().unwrap().len(), 2 - n);
        inspect(&mut device, &predicted, pending_mask);
        host.close("spread-union", device);
        device = host.open("spread-union", None).unwrap();
        inspect(&mut device, &predicted, pending_mask);
    }
    let ctx = context("alice", &[("first", id(&predicted[0])), ("tag", id(&predicted[1])), ("third", id(&predicted[2]))]).at(100);
    let args = json!({"first":predicted[0], "tag":predicted[1], "third":predicted[2]});
    for name in ["flattened", "composed", "composedRight"] {
        let remote = server.query(name, ctx.clone()).unwrap();
        assert_eq!(device.query(name, "alice", &args, 100).unwrap().data, remote.data);
        assert!(!remote.data.as_object().unwrap().contains_key("pending"));
    }
}

#[test] fn every_pending_combination_composes_on_memory_across_reopen_and_settlement() { lifecycle(&mut Memory::new()); }
#[test] fn every_pending_combination_composes_on_sqlite_across_reopen_and_settlement() { lifecycle(&mut Sqlite::new("spread-union")); }
