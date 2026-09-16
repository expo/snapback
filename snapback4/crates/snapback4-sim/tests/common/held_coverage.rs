//! Small Clique-shaped coverage witnesses, shared with both device stores.
#![allow(dead_code)]
use snapback4_core::{Value, value::object};

pub const LINE: &str = "    horizon-free source coverage — all sources sync without a horizon; answer completeness still depends on runtime authorization, limits and continuation";

pub fn source(case: &str) -> String {
    let source = r#"table members:
  conversationId: id
  principal: principal
  until: time ?
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId, id
  by byExpiry: until, id
  read <- exists members[.conversationId, viewer]
  sync to members[.conversationId]
table messages:
  conversationId: id
  body: text <=100
  at: time
  by byConversationTime: conversationId, at, id
  by byWords: words(body), at, id
  read <- exists members[.conversationId, viewer]
  sync to members[.conversationId]
query searchHeld(q: text <=100, c: cursor ?) held:
  return messages matching q after c first 10 by byWords
query firstHeld() held:
  return messages first 1 by byId
query constantHeld() held:
  return 7
"#;
    match case {
        "temporary" => source.replace("  by byExpiry: until, id", "  by byExpiry: until, id\n  expire at .until"),
        "horizon" => source.replace("  sync to members[.conversationId]\nquery searchHeld", "  sync to members[.conversationId] last 1 by byConversationTime\nquery searchHeld"),
        "online" => source.replace("  sync to members[.conversationId]\nquery searchHeld", "  online only\nquery searchHeld"),
        "full" => source.into(),
        _ => panic!("unknown coverage case: {case}"),
    }
}

pub fn seed() -> Vec<(String, Value)> {
    let id = |value: &str| Value::Id(value.into());
    vec![
        ("members".into(), object([("id", id("member")), ("conversationId", id("chat")), ("principal", id("alice")), ("until", Value::Int(10_000))])),
        ("messages".into(), object([("id", id("m1")), ("conversationId", id("chat")), ("body", Value::String("coffee".into())), ("at", Value::Int(1))])),
        ("messages".into(), object([("id", id("m2")), ("conversationId", id("chat")), ("body", Value::String("coffee".into())), ("at", Value::Int(2))])),
    ]
}

pub fn assert_line(schema: &snapback4_core::schema::Schema, op: &str, covered: bool) {
    let line = snapback4_lang::bind::residency::operation_lines(op, &schema.operations[op]);
    assert!(!line.contains("complete over held rows"), "{line}");
    assert_eq!(line.lines().any(|line| line == LINE), covered, "{line}");
}
