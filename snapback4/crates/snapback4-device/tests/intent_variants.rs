mod common;
use common::*;
use snapback4_core::{Value, value::object};
use serde_json::json;
const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/intent-variants.q");

fn variants<H: Host>(host: &mut H) {
    let (mut server, backend) = compile(SOURCE);
    server.seed([("orgs".into(), object([("id", id("org"))])), ("members".into(), object([("id", id("m")), ("org", id("org")), ("principal", id("alice"))]))]).unwrap();
    server.seed([("a", "todo", Some("x"), 1), ("b", "doing", Some("x"), 2), ("c", "todo", None, 3), ("d", "done", Some("y"), 4), ("e", "todo", Some("x"), 5)]
        .map(|(key, status, assignee, at)| ("issues".into(), object([("id", id(key)), ("org", id("org")), ("status", Value::String(status.into())), ("assignee", assignee.map(id).unwrap_or(Value::Null)), ("at", Value::Int(at))])))).unwrap();
    server.seed([("a", "alice", "able"), ("b", "bob", "baker"), ("c", "alice", "charlie"), ("d", "alice", "delta")].map(|(key, owner, handle)| ("profiles".into(), object([("id", id(key)), ("owner", id(owner)), ("handle", Value::String(handle.into())), ("bio", Value::String("common".into()))])))).unwrap();
    let mut device = host.open("variants", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut server, "alice", 2).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    host.close("variants", device);
    let mut device = host.open("variants", None).unwrap();
    for (status, assignee, expected) in [(None, None, vec!["e", "d", "c", "b", "a"]), (Some("todo"), None, vec!["e", "c", "a"]), (None, Some("x"), vec!["e", "b", "a"]), (Some("todo"), Some("x"), vec!["e", "a"])] {
        let mut cursor = None;
        let mut actual = Vec::new();
        for _ in 0..8 {
            let page = device.query("board", "alice", &json!({"org":"org", "status":status, "assignee":assignee, "c":cursor}), 10).unwrap();
            assert!(page.complete, "{page:?}");
            actual.extend(page.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap().to_owned()));
            cursor = page.next;
            if let Some(cursor) = &cursor {
                let position = snapback4_core::cursor::decode_cursor(server.schema(), cursor).unwrap();
                let columns = server.schema().tables["issues"].indexes[&position.index].columns();
                assert_eq!(columns.contains(&"status".into()), status.is_some());
                assert_eq!(columns.contains(&"assignee".into()), assignee.is_some());
            } else { break; }
        }
        assert!(cursor.is_none()); assert_eq!(actual, expected);
    }
    for query in ["board", "window"] {
        let mut args = if query == "board" { json!({"org":"org", "status":null, "assignee":null, "c":null}) } else { json!({"org":"org", "start":null, "c":null}) };
        let page = device.query(query, "alice", &args, 10).unwrap();
        args["c"] = json!(page.next.unwrap());
        if query == "board" { args["status"] = json!("todo"); } else { args["start"] = json!(1); }
        let error = device.query(query, "alice", &args, 10).unwrap_err();
        assert_eq!(error.code, "E_CURSOR_INDEX");
    }
    for q in ["", " \t", "...", "common"] {
        let mut cursor = None;
        let mut actual = Vec::new();
        for _ in 0..5 {
            let page = device.query("people", "alice", &json!({"q":q,"c":cursor}), 10).unwrap();
            assert!(page.complete, "{page:?}");
            actual.extend(page.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap().to_owned()));
            cursor = page.next;
            if cursor.is_none() { break; }
        }
        assert!(cursor.is_none()); assert_eq!(actual, ["a", "c", "d"]);
    }
    for (status, count) in [(None, 5), (Some("todo"), 3)] {
        let result = device.query("total", "alice", &json!({"org":"org", "status":status}), 10).unwrap();
        assert!(result.complete); assert_eq!(result.data, Value::Int(count));
    }
}
#[test] fn presence_and_search_variants_memory() { variants(&mut Memory::new()); }
#[test] fn presence_and_search_variants_sqlite() { variants(&mut Sqlite::new("presence-variants")); }
