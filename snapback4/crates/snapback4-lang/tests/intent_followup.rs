//! Followup review: exact final probes, aggregate seeks and literal id ordering.
use snapback4_core::{Context, Engine, Value, WriteState, value::object};
use snapback4_lang::compile;
use std::collections::BTreeMap;

fn bound(source: &str) -> snapback4_lang::Bound {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}

#[test]
fn final_insert_probe_keeps_role_in_its_exact_synthesized_key() {
    for keys in ["roomId = .id, principal = .ownerId, role = 'admin'", "role = 'admin', roomId = .id, principal = .ownerId"] {
        let source = format!("table rooms:\n  ownerId: principal\n  public 'rooms'\n  insert <- allow\n  after insert <- exists members[{keys}]\ntable members:\n  roomId: rooms\n  principal: principal\n  role: enum('admin', 'member')\n  unique roomId, principal\n  public 'members'\n  insert <- allow\nmutation create(role: enum('admin', 'member')):\n  room = insert rooms {{ ownerId: viewer }}\n  insert members {{ roomId: room.id, principal: viewer, role }}\n  return room\nquery rooms():\n  return rooms first 10\n");
        let b = bound(&source);
        let constraint = b.schema.tables["rooms"].constraints.iter().find_map(|c| match c {
            snapback4_core::schema::Constraint::FinalExistsOnInsert { index, key, .. } => Some((index, key)), _ => None,
        }).unwrap();
        assert!(constraint.0.starts_with("$intent:"));
        assert_eq!(constraint.1.len(), 3);
        let columns = b.schema.tables["members"].indexes[constraint.0].columns();
        assert_eq!(columns, keys.split(", ").map(|key| key.split(' ').next().unwrap()).collect::<Vec<_>>());
        let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        let input = |role: &str| Context::new("alice", BTreeMap::from([("role".into(), Value::String(role.into()))]));
        let denied = engine.mutate("create", Some("member"), input("member")).unwrap();
        assert!(matches!(denied.state, WriteState::Failed { ref why, .. } if why.code == "E_CONSTRAINT"), "{denied:?}");
        assert!(engine.query("rooms", Context::new("alice", BTreeMap::new())).unwrap().data.as_array().unwrap().is_empty());
        let allowed = engine.mutate("create", Some("admin"), input("admin")).unwrap();
        assert!(matches!(allowed.state, WriteState::Sent { .. }), "{allowed:?}");
        assert_eq!(engine.query("rooms", Context::new("alice", BTreeMap::new())).unwrap().data.as_array().unwrap().len(), 1);
    }
}

const DIGEST: &str = "table messages:\n  conversationId: id\n  at: time\n  tombstone: bool\n  score: int\n  public 'messages'\n  cap 50 by conversationId\nquery digest(c: id, s: time, e: time):\n  return count(messages where .conversationId = c and .at >= s and .at < e and not .tombstone)\nquery total(c: id, s: time, e: time):\n  return sum(messages where .conversationId = c and .at >= s and .at < e and not .tombstone, .score)\nquery any(c: id, s: time, e: time):\n  return exists messages where .conversationId = c and .at >= s and .at < e and not .tombstone\n";

#[test]
fn finite_digest_aggregates_seek_without_authored_order() {
    digest_aggregates_seek(DIGEST);
}

#[test]
fn uncapped_digest_aggregates_seek_and_stream_without_authored_order() {
    digest_aggregates_seek(&DIGEST.replace("  cap 50 by conversationId\n", ""));
}

fn digest_aggregates_seek(source: &str) {
    let b = bound(source);
    for program in &b.programs {
        let scans = snapback4_core::ir::scans(&program.program);
        assert_eq!(scans.len(), 1);
        assert!(scans[0].range.is_some());
        assert_eq!(b.schema.tables["messages"].indexes[&scans[0].index].columns(), ["conversationId", "tombstone", "at", "id"]);
    }
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed((0..30).map(|n| ("messages".into(), object([("id", Value::Id(format!("m{n}"))), ("conversationId", Value::Id("room".into())),
        ("at", Value::Int(n)), ("tombstone", Value::Bool(n == 11)), ("score", Value::Int(n))])))).unwrap();
    for (query, expected) in [("digest", Value::Int(2)), ("total", Value::Int(22)), ("any", Value::Bool(true))] {
        let page = engine.query(query, Context::new("alice", BTreeMap::from([("c".into(), Value::Id("room".into())), ("s".into(), Value::Int(10)), ("e".into(), Value::Int(13))]))).unwrap();
        assert!(page.complete, "{query}: {page:?}");
        assert_eq!(page.data, expected);
        assert!(page.metered.examined <= 2, "range must seek, not examine out-of-window rows: {page:?}");
    }
}

#[test]
fn aggregate_planning_does_not_admit_an_unbounded_returned_page() {
    let source = DIGEST.split("query digest").next().unwrap().replace("  cap 50 by conversationId\n", "")
        + "query page(c: id, s: time, e: time):\n  return messages where .conversationId = c and .at >= s and .at < e and not .tombstone\n";
    let b = compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_BOUND"), "{:?}", b.diagnostics);
}

#[test]
fn literal_id_keeps_its_position_in_view_cursors() {
    for (direction, expected) in [("first", ["a", "b", "c"]), ("last", ["c", "b", "a"])] {
        let b = bound(&format!("table t:\n  at: time\n  public 't'\nview v:\n  t {{ id, at }}\nquery page(c: cursor ?):\n  return v {direction} 1 by .id, .at after c\n"));
        let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        engine.seed([("a", 3), ("b", 2), ("c", 1)].map(|(key, at)| ("t".into(), object([("id", Value::Id(key.into())), ("at", Value::Int(at))])))).unwrap();
        let mut cursor = None;
        for key in expected {
            let page = engine.query("page", Context::new("alice", BTreeMap::from([("c".into(), cursor.map(Value::String).unwrap_or(Value::Null))]))).unwrap();
            assert!(page.complete, "{direction}: {page:?}");
            assert_eq!(page.data.as_array().unwrap().len(), 1);
            assert_eq!(page.data.as_array().unwrap()[0].field("id").unwrap(), &Value::Id(key.into()));
            cursor = page.next;
        }
        assert!(cursor.is_none());
    }
}
