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
    assert_eq!(names, ["thread", "inbox", "invite", "leave", "send", "edit", "unsend"]);
    let messages = &bound.schema.tables["messages"];
    assert!(messages.sync.is_some(), "messages sync to memberships");
    assert!(bound.schema.tables["messageCounts"].sync.is_some(), "the count inherits the audience");

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
    assert!(ts.contains("inbox: Query<Record<string, never>, { conversation: Rows[\"conversations\"] | null; conversationId: string; count: number }[]>;"), "{ts}");
    assert!(ts.contains("role: \"member\" | \"admin\";"));
    assert!(ts.contains("send: Mutation<{ conversationId: string; body: string }, { id: string }>;"), "{ts}");
    assert!(ts.contains("unsend: Mutation<{ messageId: string }, null>;"), "{ts}");
    assert!(ts.contains("export const api: Ops = {"));
}
