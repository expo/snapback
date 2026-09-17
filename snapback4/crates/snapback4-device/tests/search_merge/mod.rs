use super::*;

mod round2;
mod round3;

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

const HISTORY: &str = r#"
table directory:
  read <- allow
  sync public
table members:
  room: text <=40
  principal: principal
  unique byRoomPrincipal: room, principal
  by byPrincipal: principal, room
  immutable room, principal
  read <- exists members[.room, viewer]
  delete <- exists members[.room, viewer]
  sync to members[.room]
table messages:
  room: text <=40
  at: time
  body: text <=40
  unique byRoomAt: room, at
  by byTime: room, at, id
  by byWords: room, words(body), at, id
  read <- exists members[.room, viewer]
  retain delivered-history
  sync to members[.room] last 25 by byTime
query search(room: text <=40, q: text <=40, c: cursor ?):
  return merge messages matching q after c last 50 by byWords:
    [room]
query mixed():
  ignored = messages['left'] last 1 by byTime
  return messages['held'] last 50 by byTime
query pointIndex():
  return {left: messages[room = 'left', at = 25], held: messages['held'] last 50 by byTime}
query pointId():
  return {left: messages['left-25'], held: messages['held'] last 50 by byTime}
query pointMiss():
  return {left: messages['left-0'], held: messages['held'] last 50 by byTime}
query pointExists():
  return {left: exists messages['left-25'], held: messages['held'] last 50 by byTime}
query both():
  leftRows = messages['left'] last 50 by byTime
  heldRows = messages['held'] last 50 by byTime
  return {left: leftRows, held: heldRows}
query mixed_complete(c: cursor ?):
  ignored = messages['left'] last 50 by byTime
  return messages['held'] after c last 10 by byTime
query mixed_incomplete():
  ignored = messages['left'] last 50 by byTime
  return directory[] first 1 by byId
query mixed_presence():
  ignored = messages['left'] last 50 by byTime
  return connected[viewer]
query reverse():
  result = messages['held'] last 50 by byTime
  ignored = messages['left'] last 1 by byTime
  return result
query left():
  return messages['left'] last 50 by byTime
mutation leave():
  delete members[room = 'left', principal = 'dev:bob']
"#;

fn history_device(host: &mut dyn HostDyn, scenario: impl FnOnce(&mut dyn AnyDevice, &mut snapback4_core::Engine)) {
    let (mut engine, backend) = compile(HISTORY);
    let mut seed = vec![("directory".into(), snapback4_core::value::object([("id", id("a"))])), ("directory".into(), snapback4_core::value::object([("id", id("b"))]))];
    for room in ["held", "left"] {
        for viewer in ["dev:alice", "dev:bob"] {
            seed.push(("members".into(), snapback4_core::value::object([("id", id(&format!("{room}-{viewer}"))), ("room", Value::String(room.into())), ("principal", id(viewer))])));
        }
        for at in 0..26 {
            seed.push(("messages".into(), snapback4_core::value::object([("id", id(&format!("{room}-{at}"))), ("room", Value::String(room.into())), ("at", Value::Int(at)), ("body", Value::String(if at == 0 { "needle" } else { "coffee car" }.into()))])));
        }
    }
    engine.seed(seed).unwrap();
    let mut device = host.open("history-search", Some(backend)).unwrap();
    let pages = snapshot_pages(&mut engine, "dev:bob", 100);
    let watermark = pages.last().unwrap().watermark;
    for (n, page) in pages.iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
    assert!(matches!(engine.mutate("leave", Some("leave"), context("dev:alice", &[]).at(100)).unwrap().state, WriteState::Sent { .. }));
    ok(apply(&mut *device, &stream_page(&mut engine, "dev:bob", watermark), false));
    scenario(&mut *device, &mut engine);
    device.close();
}

#[test]
fn r1a_empty_matching_horizon_is_unknown_held_and_retained_left() {
    on_both(|host| history_device(host, |device, engine| {
        for room in ["held", "left"] {
            let local = query(device, "search", "dev:bob", serde_json::json!({"room":room,"q":"needle"}), 100);
            assert_eq!(rows(&local).len(), 0);
            assert_eq!(local["complete"], false, "{room}: {local}");
            assert_eq!(local["unknown"], room == "held", "{room}: {local}");
            assert_eq!(local["retained"], room == "left", "{room}: {local}");
            assert_eq!(local["next"], serde_json::Value::Null);
            let server = engine.query("search", context("dev:bob", &[("room", Value::String(room.into())), ("q", Value::String("needle".into()))]).at(100)).unwrap();
            assert_eq!(server.data.as_array().unwrap().len(), usize::from(room == "held"));
            let found = query(device, "search", "dev:bob", serde_json::json!({"room":room,"q":"cof car"}), 100);
            assert_eq!(rows(&found).len(), 25);
        }
    }));
}

#[test]
fn r1a_left_read_cannot_mask_an_unknown_held_read_in_either_order() {
    on_both(|host| history_device(host, |device, engine| {
        let left = query(device, "left", "dev:bob", serde_json::json!({}), 100);
        assert_eq!(rows(&left).len(), 25);
        assert_eq!((left["retained"].clone(), left["unknown"].clone()), (serde_json::json!(true), serde_json::json!(false)));
        let complete = query(device, "mixed_complete", "dev:bob", serde_json::json!({}), 100);
        assert_eq!(rows(&complete).len(), 10);
        assert_eq!((complete["retained"].clone(), complete["unknown"].clone()), (serde_json::json!(true), serde_json::json!(false)), "a complete held site cannot invalidate retained history");
        for name in ["mixed_incomplete", "mixed_presence"] {
            let local = query(device, name, "dev:bob", serde_json::json!({}), 100);
            assert_eq!(local["complete"], false);
            assert_eq!(local["retained"], false, "a non-horizon incomplete site also wins: {local}");
        }
        for name in ["mixed", "reverse"] {
            let local = query(device, name, "dev:bob", serde_json::json!({}), 100);
            assert_eq!(rows(&local).len(), 25);
            assert_eq!(local["unknown"], true);
            assert_eq!(local["retained"], false, "held coverage wins: {local}");
            assert_eq!(engine.query(name, context("dev:bob", &[]).at(100)).unwrap().data.as_array().unwrap().len(), 26);
        }
    }));
}

#[test]
fn r1a_nested_search_filter_does_not_filter_members_on_either_store() {
    on_both(|host| {
        let source = include_str!("../../../snapback4-sim/tests/search_merge/schema.q");
        let source = format!("{source}\nquery filtered(q: text <=100, c: cursor ?):\n  return messages['r1'] matching q after c last 50 by byRoomWords where count(members['r1'] first 50 by byRoomPrincipal) > 0\n");
        let (mut engine, backend) = compile(&source);
        let mut seed = vec![("members".into(), snapback4_core::value::object([("id", id("member")), ("roomId", id("r1")), ("principal", id("dev:alice"))]))];
        for n in 0..12 { seed.push(("messages".into(), snapback4_core::value::object([("id", id(&format!("m{n}"))), ("roomId", id("r1")), ("at", Value::Int(n)), ("body", Value::String(format!("cof{n:02} car")))]))); }
        engine.seed(seed).unwrap();
        let mut device = host.open("nested", Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut engine, "dev:alice", 100).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        assert_eq!(rows(&query(&mut *device, "filtered", "dev:alice", serde_json::json!({"q":"cof car"}), 100)).len(), 12);
        assert_eq!(rows(&query(&mut *device, "filtered", "dev:alice", serde_json::json!({"q":"cof boat"}), 100)).len(), 0);
        device.close();
    });
}

#[test]
fn r1a_repeated_site_still_rechecks_an_expired_audience_on_both_stores() {
    use snapback4_core::ir::{Expr, Stmt};
    on_both(|host| {
        let source = include_str!("../../../snapback4-sim/tests/search_merge/schema.q");
        let source = format!("{source}\ntable grants:\n  roomId: id\n  principal: principal\n  until: time ?\n  unique byRoomPrincipal: roomId, principal\n  by byPrincipal: principal, roomId, id\n  by byExpiry: until\n  expire at .until\n  read <- exists grants[.roomId, viewer]\n  sync to grants[.roomId]\ntable secrets:\n  roomId: id\n  by byRoom: roomId, id\n  read <- exists grants[.roomId, viewer]\n  sync to grants[.roomId]\nquery filtered(q: text <=100, c: cursor ?):\n  return messages['r1'] matching q after c last 50 by byRoomWords where count(secrets['r1'] first 50 by byRoom) > 0\n");
        let (mut engine, mut backend) = compile(&source);
        fn repeat_sites(value: &mut serde_json::Value) {
            match value {
                serde_json::Value::Object(fields) => { for (key, value) in fields { if key == "site" { *value = serde_json::json!("same"); } else { repeat_sites(value); } } }
                serde_json::Value::Array(items) => items.iter_mut().for_each(repeat_sites),
                _ => {}
            }
        }
        let program = backend.programs.iter_mut().find(|p| p.name == "filtered").unwrap();
        assert!(matches!(program.body.last(), Some(Stmt::Return(Expr::Scan(_)))));
        let mut ir = serde_json::to_value(&*program).unwrap();
        repeat_sites(&mut ir);
        *program = serde_json::from_value(ir).unwrap();
        let mut seed = vec![
            ("members".into(), snapback4_core::value::object([("id", id("member")), ("roomId", id("r1")), ("principal", id("dev:alice"))])),
            ("grants".into(), snapback4_core::value::object([("id", id("grant")), ("roomId", id("r1")), ("principal", id("dev:alice")), ("until", Value::Int(200))])),
            ("secrets".into(), snapback4_core::value::object([("id", id("secret")), ("roomId", id("r1"))])),
        ];
        for n in 0..12 { seed.push(("messages".into(), snapback4_core::value::object([("id", id(&format!("m{n}"))), ("roomId", id("r1")), ("at", Value::Int(n)), ("body", Value::String(format!("cof{n:02}")))]))); }
        engine.seed(seed).unwrap();
        let mut device = host.open("repeated-site", Some(backend)).unwrap();
        for (n, page) in snapshot_pages_at(&mut engine, "dev:alice", 100, 100).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        assert_eq!(rows(&query(&mut *device, "filtered", "dev:alice", serde_json::json!({"q":"cof"}), 100)).len(), 12, "live audience admits the nested page");
        assert_eq!(rows(&query(&mut *device, "filtered", "dev:alice", serde_json::json!({"q":"cof"}), 300)).len(), 0, "the matching verdict cannot bypass expired membership");
        device.close();
    });
}
