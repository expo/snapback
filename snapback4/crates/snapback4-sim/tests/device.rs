//! The interpreter on a device (`engine::local`) over rows in memory: the
//! same programs the server runs, with the device's three words.

use snapback4_core::engine::local;
use snapback4_core::meter::Ceilings;
use snapback4_core::rows::{MemoryRows, Rows};
use snapback4_core::value::{Value, object};
use snapback4_core::{Context, Schema};
use std::collections::BTreeMap;

use snapback4_sim::chat::CHAT;

fn id(s: &str) -> Value {
    Value::Id(s.into())
}

fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect()
}

fn backend() -> (Schema, BTreeMap<String, snapback4_core::Program>) {
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), CHAT.to_owned())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    (bound.schema.clone(), bound.programs.iter().map(|p| (p.program.name.clone(), p.program.clone())).collect())
}

/// Bob's partition: the conversation, its two memberships, 120 messages.
fn held(schema: &Schema) -> MemoryRows {
    let rows = MemoryRows::new();
    let put = |table: &str, row: Value| rows.put(table, schema.table(table).unwrap(), &row, None).unwrap();
    put("conversations", object([("id", id("c1")), ("title", Value::String("General".into())), ("creatorId", id("dev:alice"))]));
    put("memberships", object([("id", id("m1")), ("conversationId", id("c1")), ("principal", id("dev:alice")), ("role", Value::String("admin".into())), ("joinedAt", Value::Int(1))]));
    put("memberships", object([("id", id("m2")), ("conversationId", id("c1")), ("principal", id("dev:bob")), ("role", Value::String("member".into())), ("joinedAt", Value::Int(2))]));
    for n in 0..120 {
        put("messages", object([("id", id(&format!("msg{n:03}"))), ("conversationId", id("c1")), ("authorId", id(if n % 2 == 1 { "dev:alice" } else { "dev:bob" })), ("body", Value::String(format!("m{n}"))), ("at", Value::Int(1_000 + n))]));
    }
    rows
}

#[test]
fn a_thread_pages_locally_with_the_servers_cursors() {
    let (schema, programs) = backend();
    let rows = held(&schema);
    let first = local::query(&rows, &schema, &programs["thread"], Context::new("dev:bob", args(&[("conversationId", id("c1"))])).at(2_000), Ceilings::default()).unwrap();
    assert_eq!(first.data.as_array().unwrap().len(), 50);
    assert_eq!(first.data.as_array().unwrap()[0].field("id").unwrap(), &id("msg119"));
    assert!(first.complete && first.next.is_some());
    let second = local::query(&rows, &schema, &programs["thread"], Context::new("dev:bob", args(&[("conversationId", id("c1")), ("c", Value::String(first.next.clone().unwrap()))])).at(2_000), Ceilings::default()).unwrap();
    assert_eq!(second.data.as_array().unwrap()[0].field("id").unwrap(), &id("msg069"));
    let third = local::query(&rows, &schema, &programs["thread"], Context::new("dev:bob", args(&[("conversationId", id("c1")), ("c", Value::String(second.next.clone().unwrap()))])).at(2_000), Ceilings::default()).unwrap();
    assert_eq!(third.data.as_array().unwrap().len(), 20);
    assert!(third.next.is_none());
}

#[test]
fn the_devices_words_hold() {
    let (schema, programs) = backend();
    let rows = held(&schema);
    // A stranger is refused with the author's code, as on the server.
    let refused = local::query(&rows, &schema, &programs["thread"], Context::new("dev:mallory", args(&[("conversationId", id("c1"))])).at(2_000), Ceilings::default()).unwrap_err();
    assert_eq!(refused.code, "MEMBERSHIP_REQUIRED");
    // Delivered history stays readable here after a leave: the row the
    // server withdrew from the rule is still the device's to read.
    let table = schema.table("memberships").unwrap();
    let bob = rows.get("memberships", "m2").unwrap().unwrap();
    rows.delete("memberships", table, &bob).unwrap();
    let inbox = local::query(&rows, &schema, &programs["inbox"], Context::new("dev:bob", BTreeMap::new()).at(2_000), Ceilings::default()).unwrap();
    assert_eq!(inbox.data.as_array().unwrap().len(), 0);
    // A page at the horizon (500 per conversation) is complete when the
    // device holds fewer; holding the horizon's worth says it may go on.
    let rows = held(&schema);
    for n in 120..500 {
        rows.put("messages", schema.table("messages").unwrap(), &object([("id", id(&format!("msg{n:03}"))), ("conversationId", id("c1")), ("authorId", id("dev:bob")), ("body", Value::String(format!("m{n}"))), ("at", Value::Int(1_000 + n))]), None).unwrap();
    }
    let mut page = local::query(&rows, &schema, &programs["thread"], Context::new("dev:bob", args(&[("conversationId", id("c1"))])).at(2_000), Ceilings::default()).unwrap();
    let mut pages = 1;
    while let Some(next) = page.next.clone() {
        page = local::query(&rows, &schema, &programs["thread"], Context::new("dev:bob", args(&[("conversationId", id("c1")), ("c", Value::String(next))])).at(2_000), Ceilings::default()).unwrap();
        pages += 1;
    }
    assert_eq!(pages, 10);
    assert!(!page.complete, "the last page at the horizon may continue on the server");
}

#[test]
fn a_send_is_predicted_and_counts() {
    let (schema, programs) = backend();
    let rows = held(&schema);
    let prediction = local::predict(&rows, &schema, &programs["send"], Context::new("dev:bob", args(&[("conversationId", id("c1")), ("body", Value::String("hello".into()))])).at(2_000).with_ids(["msgNEW".to_owned()]).with_entropy(7), Ceilings::default()).unwrap();
    assert_eq!(prediction.result.field("id").unwrap(), &id("msgNEW"));
    assert!(prediction.written.contains(&"messages".to_owned()) && prediction.written.contains(&"messageCounts".to_owned()));
    assert_eq!(rows.rows("messages").len(), 121);
    let inbox = local::query(&rows, &schema, &programs["inbox"], Context::new("dev:bob", BTreeMap::new()).at(2_000), Ceilings::default()).unwrap();
    assert_eq!(inbox.data.as_array().unwrap()[0].field("count").unwrap(), &Value::Int(1), "the count the device maintains from nothing");
    // A refusal leaves nothing behind for the host to keep: the host rolls back.
    let refused = local::predict(&rows, &schema, &programs["send"], Context::new("dev:mallory", args(&[("conversationId", id("c1")), ("body", Value::String("hi".into()))])).at(2_000).with_entropy(7), Ceilings::default()).unwrap_err();
    assert_eq!(refused.code(), "NOT_MEMBER");
}
