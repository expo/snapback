//! Projection replacement leaves ruled source rows and cursor keys intact.
mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Value, value::object};

const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/shape-overrides.q");

fn replacements<H: Host>(host: &mut H) {
    let (mut server, backend) = compile(SOURCE);
    let mut rows = vec![];
    for (key, owner) in [("visible", "alice"), ("hidden", "bob")] {
        rows.push(("listings".into(), object([
            ("id", id(key)), ("owner", id(owner)),
            ("title", Value::String(key.into())), ("city", Value::String("Berlin".into())),
        ])));
    }
    for n in 0..26 {
        rows.push(("bookings".into(), object([
            ("id", id(&format!("b{n:02}"))), ("guest", id(if n == 25 { "bob" } else { "alice" })),
            ("listing", id(match n { 1 => "hidden", 2 => "missing", _ => "visible" })),
            // Ties also prove the original id remains the cursor tiebreaker.
            ("start", Value::Int(n / 2)),
        ])));
    }
    server.seed(rows).unwrap();
    let mut device = host.open("shape-overrides", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut server, "alice", 4).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    host.close("shape-overrides", device);
    let mut device = host.open("shape-overrides", None).unwrap();

    for name in ["page", "named", "spreadShape", "replaced"] {
        let mut cursor: Option<String> = None;
        let mut explicit_cursor: Option<String> = None;
        let mut seen = vec![];
        let take = if name == "replaced" { 2 } else { 20 };
        for page_number in 0..13 {
            // Each server cursor is honored by the device and vice versa.
            let input = cursor.clone().map(Value::String).unwrap_or(Value::Null);
            let remote = server.query(name, context("alice", &[("c", input)]).at(100)).unwrap();
            let local = device.query(name, "alice", &json!({"c":cursor}), 100).unwrap();
            let explicit = if name == "replaced" { "explicitReplaced" } else { "explicit" };
            let old = device.query(explicit, "alice", &json!({"c":explicit_cursor}), 100).unwrap();
            assert!(remote.complete, "{name}: {remote:?}");
            // A negative parent lookup beyond known device coverage remains
            // incomplete, just as with the equivalent explicit projection.
            assert_eq!(local.complete, old.complete, "{name}: {local:?}\n{old:?}");
            assert_eq!(local.data, old.data);
            assert_eq!(local.metered.examined, old.metered.examined, "replacement does the same source reads");
            assert_eq!(local.metered, remote.metered, "server and device charge the same work");
            explicit_cursor = old.next;
            assert_eq!(remote.data, local.data, "{name}: {}", host.label());
            assert_eq!(remote.next, local.next, "continuations use source keys");
            let page = remote.data.as_array().unwrap();
            assert_eq!(page.len(), take.min(25 - seen.len()));
            for row in page {
                let key = if name == "replaced" {
                    assert_eq!(row.field("start").unwrap(), &Value::String("display".into()));
                    assert_eq!(row.field("guest").unwrap(), &Value::String("display".into()));
                    row.field("id").unwrap().field("value").unwrap().as_str().unwrap()
                } else { row.field("id").unwrap().as_str().unwrap() };
                assert_ne!(key, "b25", "replacing guest never authorizes Bob's row");
                let listing = snapback4_core::wire::to_json(row.field("listing").unwrap());
                if ["b01", "b02"].contains(&key) {
                    assert_eq!(listing, serde_json::Value::Null, "hidden and missing listings both stay null");
                } else { assert_eq!(listing, json!({"title":"visible", "city":"Berlin"})); }
                seen.push(key.to_owned());
            }
            cursor = if page_number % 2 == 0 { remote.next } else { local.next };
            if cursor.is_none() { break; }
        }
        assert!(cursor.is_none(), "all pages must terminate");
        assert!(explicit_cursor.is_none());
        let mut expected = (0..25).map(|n| format!("b{n:02}")).collect::<Vec<_>>();
        if name != "replaced" { expected.reverse(); }
        assert_eq!(seen, expected, "each ruled row appears once, in source order");
    }
}

#[test] fn shape_replacements_server_and_memory() { replacements(&mut Memory::new()); }
#[test] fn shape_replacements_server_and_sqlite() { replacements(&mut Sqlite::new("shape-overrides")); }
