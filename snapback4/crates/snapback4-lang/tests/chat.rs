//! The chat schema, compiled and run end to end: parse, bind, install, seed,
//! send, read, and the partition events a send produces.

use snapback4_core::partition::EventKind;
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_lang::compile;
use std::collections::BTreeMap;

const CHAT: &str = include_str!("../../../apps/chat/snapback/schema.q");

fn id(s: &str) -> Value {
    Value::Id(s.into())
}

fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect()
}

#[test]
fn the_chat_schema_compiles_and_runs() {
    let bound = compile(&[("schema.q".to_owned(), CHAT.to_owned())]);
    for diagnostic in &bound.diagnostics {
        eprintln!("{diagnostic}");
    }
    assert!(bound.diagnostics.is_empty(), "the chat schema binds without diagnostics");
    let names: Vec<&str> = bound.programs.iter().map(|p| p.program.name.as_str()).collect();
    assert_eq!(names, ["thread", "inbox", "addMember", "leave", "send", "sendPhoto", "edit", "unsend", "myMembership", "room", "markRead", "invite"]);
    let messages = &bound.schema.tables["messages"];
    assert!(messages.sync.is_some(), "messages sync to memberships");
    assert!(bound.schema.tables["messageCounts"].sync.is_some(), "the count inherits the audience");
    assert!(bound.schema.tables["readMarkers"].sync.is_none(), "read markers remain server-only");
    assert_eq!(bound.schema.operations["markRead"].predicts.as_deref(), Some("never"), "markRead demonstrates a write without a predicted row");

    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    let alice = "dev:alice";
    let bob = "dev:bob";
    engine
        .seed([
            ("conversations".to_owned(), snapback4_core::value::object([("id", id("c1")), ("title", Value::String("General".into())), ("creatorId", id(alice))])),
            ("memberships".to_owned(), snapback4_core::value::object([("id", id("m1")), ("conversationId", id("c1")), ("principal", id(alice)), ("role", Value::String("admin".into())), ("joinedAt", Value::Int(1))])),
            ("memberships".to_owned(), snapback4_core::value::object([("id", id("m2")), ("conversationId", id("c1")), ("principal", id(bob)), ("role", Value::String("member".into())), ("joinedAt", Value::Int(2))])),
        ])
        .unwrap();

    // Alice sends; the write is sent, applied once, and logged once for the group.
    let context = Context::new(alice, args(&[("conversationId", id("c1")), ("body", Value::String("hello bob".into()))])).at(1_000).with_ids(["msg1".to_owned()]);
    let sent = engine.mutate("send", Some("op-1"), context.clone()).unwrap();
    let WriteState::Sent { seq, result } = &sent.state else { panic!("send failed: {:?}", sent.state) };
    assert_eq!(result.field("id").unwrap(), &id("msg1"));
    assert_eq!(sent.events, 2, "one message put and one count put, under the group, however many members");
    let replay = engine.mutate("send", Some("op-1"), context).unwrap();
    assert!(replay.replayed);
    assert!(matches!(replay.state, WriteState::Sent { seq: replayed, .. } if replayed == *seq));

    // Bob reads the thread and the inbox with its count.
    let thread = engine.query("thread", Context::new(bob, args(&[("conversationId", id("c1")), ("c", Value::Null)]))).unwrap();
    assert!(thread.complete);
    assert_eq!(thread.data.as_array().unwrap().len(), 1);
    assert_eq!(thread.next, None);
    let inbox = engine.query("inbox", Context::new(bob, args(&[]))).unwrap();
    let rows = inbox.data.as_array().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].field("count").unwrap(), &Value::Int(1));
    assert_eq!(rows[0].field("conversation").unwrap().field("title").unwrap(), &Value::String("General".into()));
    let room = engine.query("room", Context::new(bob, args(&[("conversationId", id("c1"))]))).unwrap();
    assert_eq!(room.data.field("conversation").unwrap().field("id").unwrap(), &id("c1"));
    assert_eq!(room.data.field("membership").unwrap().field("id").unwrap(), &id("m2"));
    let membership = engine.query("myMembership", Context::new(bob, args(&[("conversationId", id("c1"))]))).unwrap();
    assert!(membership.complete);
    assert_eq!(membership.data.field("id").unwrap(), &id("m2"));
    let absent = engine.query("myMembership", Context::new("dev:mallory", args(&[("conversationId", id("c1"))]))).unwrap();
    assert!(absent.complete);
    assert_eq!(absent.data, Value::Null);

    // A stranger is refused by the require, with the author's code.
    let denied = engine.query("thread", Context::new("dev:mallory", args(&[("conversationId", id("c1")), ("c", Value::Null)]))).unwrap_err();
    assert_eq!(denied.code, "MEMBERSHIP_REQUIRED");
    assert_eq!(denied.family, "rule");

    // Bob's partition: the snapshot and the stream agree.
    let (snapshot, watermark) = engine.snapshot(bob).unwrap();
    let held = snapback4_core::partition::holdings(&snapshot);
    assert!(held["messages"].contains("msg1"));
    assert!(held["conversations"].contains("c1"));
    assert_eq!(held["memberships"].len(), 2);
    assert_eq!(watermark, *seq);
    let page = engine.stream(bob, 0, 100).unwrap();
    assert!(page.events.iter().any(|e| e.table == "messages" && e.id == "msg1" && e.kind == "put"));

    // Marking read is authorized for a member but never adds a replica row.
    let marked = engine.mutate("markRead", Some("read-1"), Context::new(bob, args(&[("conversationId", id("c1"))])).at(1_500).with_ids(["marker1".to_owned()])).unwrap();
    assert!(matches!(marked.state, WriteState::Sent { result: Value::Null, .. }), "{:?}", marked.state);
    let (snapshot, _) = engine.snapshot(bob).unwrap();
    assert!(!snapback4_core::partition::holdings(&snapshot).contains_key("readMarkers"));
    let refused = engine.mutate("markRead", Some("read-stranger"), Context::new("dev:mallory", args(&[("conversationId", id("c1"))])).at(1_600)).unwrap();
    assert!(matches!(refused.state, WriteState::Failed { ref why, .. } if why.code == "NOT_MEMBER"), "{:?}", refused.state);

    // Bob leaves: a scope tombstone reaches him and nothing new does.
    engine.mutate("unsend", None, Context::new(bob, args(&[("messageId", id("msg1"))])).at(2_000)).map(|o| assert!(matches!(o.state, WriteState::Failed { .. }), "bob is not the author")).unwrap();
    let before = engine.seq().unwrap();
    let tx_events = {
        let mut store = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
        let _ = &mut store;
        0
    };
    let _ = tx_events;
    let removed = engine.seed_delete("memberships", "m2").unwrap();
    assert_eq!(removed, 1);
    let page = engine.stream(bob, before, 100).unwrap();
    assert!(page.events.iter().any(|e| e.kind == EventKind::Scope.word() && e.table == "messages"), "{:?}", page.events);
}

#[test]
fn the_chat_api_types_are_inferred() {
    let bound = compile(&[("schema.q".to_owned(), CHAT.to_owned())]);
    assert!(bound.diagnostics.is_empty());
    let ts = snapback4_lang::emit::typescript(&bound);
    assert!(ts.contains("thread: Query<{ conversationId: string; c?: Cursor | null }, Rows[\"messages\"][]>;"), "{ts}");
    assert!(ts.contains("inbox: Query<Record<string, never>, { conversation: Rows[\"conversations\"] | null; conversationId: string; count: number; pending?: boolean; retained?: boolean }[]>;"), "{ts}");
    assert!(ts.contains("role: \"member\" | \"admin\";"));
    assert!(ts.contains("send: Mutation<{ conversationId: string; body: string }, { id: string }>;"), "{ts}");
    assert!(ts.contains("unsend: Mutation<{ messageId: string }, null>;"), "{ts}");
    assert!(ts.contains("export const api: Ops = {"));
}

fn page_notes(program: &str) -> Vec<snapback4_lang::Diagnostic> {
    let schema = "table items:\n  group: int\n  n: int\n  by byGroup: group, id\n  cap 8 by group\n  read <- allow\n  update <- allow\n";
    let bound = compile(&[("schema.q".into(), format!("{schema}\n{program}"))]);
    assert!(bound.diagnostics.is_empty(), "{program}\n{:?}", bound.diagnostics);
    bound.notes
}

#[test]
fn cursor_notes_follow_returned_query_pages_through_aliases_and_shapes() {
    let cases = [
        ("direct", "query q():\n  return items[] first 3 by byId\n"),
        ("implicit return", "query q():\n  items[] first 3 by byId\n"),
        ("alias", "query q():\n  rows = items[] first 3 by byId\n  alias = rows\n  return alias\n"),
        ("shape", "query q():\n  return items[] first 3 by byId { n }\n"),
        ("aliased shape", "query q():\n  rows = items[] first 3 by byId\n  shaped = rows { n }\n  return shaped\n"),
        ("helper", "fn page(): items[] first 3 by byId { n }\nquery q():\n  return page()\n"),
        ("record field", "query q():\n  holder = { rows: items[] first 3 by byId }\n  return holder.rows\n"),
        ("same page on both branches", "query q(choice: bool):\n  rows = items[] first 3 by byId\n  if choice:\n    return rows\n  return rows\n"),
        ("merge", "query q():\n  return merge items first 3 by byGroup:\n    [0]\n    [1]\n"),
        ("shaped merge", "query q():\n  rows = merge items first 3 by byGroup:\n    [0]\n    [1]\n  return rows { n }\n"),
    ];
    for (case, program) in cases {
        let notes = page_notes(program);
        assert_eq!(notes.len(), 1, "{case}: {notes:?}");
        assert_eq!(notes[0].code, "N_NO_CURSOR", "{case}");
        assert!(notes[0].message.contains("query q returns a page of 3 items rows"), "{case}: {:?}", notes[0]);
        assert!(notes[0].rewrite.contains("c: cursor ?"), "{case}");
        assert_eq!(notes[0].guide, "reads", "{case}");
    }
    assert!(page_notes("query q():\n  rows = items[] first 3 by byId\n  return { rows }\n").is_empty(), "a composed bound is its whole intent");
    let notes = page_notes("query q(choice: bool):\n  if choice:\n    return items[] first 3 by byId\n  return items[] first 4 by byId\n");
    assert_eq!(notes.len(), 2, "both distinct returned pages are diagnosed: {notes:?}");
    assert!(notes.iter().any(|note| note.message.contains("page of 3 items")));
    assert!(notes.iter().any(|note| note.message.contains("page of 4 items")));
}

#[test]
fn consumed_pages_and_engine_owned_loops_do_not_need_caller_cursors() {
    let cases = [
        ("scalar aggregate", "query q():\n  return count(items[] first 3 by byId)\n"),
        ("unused page", "query q():\n  unused = items[] first 3 by byId\n  return 0\n"),
        ("consumed shape", "query q():\n  rows = items[] first 3 by byId { n }\n  return count(rows)\n"),
        ("auxiliary loop", "query q():\n  for row in items[] first 3 by byId:\n    unused = row.n\n  return 0\n"),
        ("cursor page with an auxiliary loop", "query q(c: cursor ?):\n  for row in items[] first 3 by byId:\n    unused = row.n\n  return items[] after c first 3 by byId\n"),
        ("cursor alias", "query q(c: cursor ?):\n  rows = items[] after c first 3 by byId\n  return rows\n"),
        ("cursor shape", "query q(c: cursor ?):\n  return items[] after c first 3 by byId { n }\n"),
        ("cursor merge", "query q(c: cursor ?):\n  return merge items after c first 3 by byGroup:\n    [0]\n    [1]\n"),
        ("unselected record page", "query q(c: cursor ?):\n  holder = { unused: items[] first 3 by byId, rows: items[] after c first 3 by byId }\n  return holder.rows\n"),
        ("mutation loop", "mutation q():\n  for row in items[0] first 8 by byGroup:\n    update items[row.id] { n: row.n + 1 }\n  return 0\n"),
        ("mutation return", "mutation q():\n  return items[0] first 8 by byGroup\n"),
        ("job chunk", "job q():\n  chunk row in items first 3 by byId:\n    update items[row.id] { n: row.n + 1 }\n"),
        ("job inner loop", "job q():\n  chunk row in items first 3 by byId:\n    for member in items[row.group] first 8 by byGroup:\n      update items[member.id] { n: member.n + 1 }\n"),
    ];
    for (case, program) in cases {
        let notes = page_notes(program);
        assert!(notes.iter().all(|note| note.code == "N_PUBLIC_AGGREGATE_COPY"), "{case}: {notes:?}");
    }
}
