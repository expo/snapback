use super::*;

#[test]
fn matching_merges_page_the_same_rows_on_both_device_stores() {
    on_both(|host| {
        let source = include_str!("../../../snapback4-sim/tests/search_merge/schema.q");
        let (mut engine, backend) = compile(source);
        for (room, viewer) in [("r1", "dev:alice"), ("r2", "dev:alice"), ("r3", "dev:bob")] {
            engine.seed([("members".into(), snapback4_core::value::object([("id", id(&format!("{room}-{viewer}"))), ("roomId", id(room)), ("principal", id(viewer))]))]).unwrap();
        }
        for (room, name, body, at) in [("r1", "a", "coffee carol", 10), ("r2", "b", "coffers", 20), ("r1", "c", "cofounder car", 30), ("r2", "d", "coffee coffers car", 30), ("r3", "hidden", "coffee car", 99)] {
            engine.seed([("messages".into(), snapback4_core::value::object([("id", id(name)), ("roomId", id(room)), ("body", Value::String(body.into())), ("at", Value::Int(at))]))]).unwrap();
        }
        let label = host.label();
        let mut device = host.open("matching", Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut engine, "dev:alice", 100).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        for term in ["cof", "cof car"] {
            let mut cursor: Option<String> = None;
            let mut all_ids = Vec::new();
            loop {
                let mut args = args(&[("q", Value::String(term.into()))]);
                if let Some(cursor) = &cursor { args.insert("c".into(), Value::String(cursor.clone())); }
                let server = engine.query("everywhere", snapback4_core::Context::new("dev:alice", args).at(100)).unwrap();
                let local = query(&mut *device, "everywhere", "dev:alice", serde_json::json!({"q":term,"c":cursor}), 100);
                assert_eq!(local["data"], snapback4_core::wire::to_json(&server.data), "{label}: {term}");
                assert!(server.complete && local["complete"] == true, "{label}: {local}");
                assert_eq!(local["next"], serde_json::to_value(&server.next).unwrap(), "{label}: cursors continue across hosts");
                all_ids.extend(rows(&local).iter().map(|row| row["id"].as_str().unwrap().to_owned()));
                cursor = server.next;
                if cursor.is_none() { break; }
            }
            assert_eq!(all_ids, if term == "cof" { vec!["d", "c", "b", "a"] } else { vec!["d", "c", "a"] });
        }
        device.close();
    });
}
