#![allow(dead_code)]

use snapback4_core::value::{Value, object};

pub const SOURCE: &str = include_str!("../fixtures/membership.q");
pub const RULE: &str = ".principal = viewer or exists memberships[.chatKey, viewer]";

pub fn literal_source() -> String {
    SOURCE.replace("  by byPrincipalChat:", "  unique byChatPrincipalRole: chatKey, principal, role\n  by byPrincipalChat:")
        .replace(RULE, ".principal = viewer or exists memberships[.chatKey, viewer, 'admin']")
}

pub fn other_table_source() -> String {
    format!("table chats:\n  chatKey: text 1..40\n  unique byChat: chatKey\n  read <- allow\n\n{}", SOURCE.replace(RULE, ".principal = viewer or exists chats[chatKey = .chatKey]"))
}

pub fn id(value: &str) -> Value { Value::Id(value.into()) }
pub fn text(value: &str) -> Value { Value::String(value.into()) }

pub fn rows() -> Vec<(String, Value)> {
    let mut rows = Vec::new();
    for (chat, people) in [("alpha", vec!["dev:alice", "dev:bob", "dev:carol"]), ("beta", vec!["dev:bob"]), ("gamma", vec!["dev:mallory"])] {
        for person in people {
            rows.push(("memberships".into(), object([
                ("id", id(&format!("{chat}-{person}"))), ("chatKey", text(chat)), ("principal", id(person)),
                ("role", text(if person == "dev:alice" { "admin" } else { "member" })),
            ])));
        }
    }
    rows.push(("messages".into(), object([("id", id("msg")), ("chatKey", text("alpha")), ("sender", id("dev:alice"))])));
    rows
}

pub fn acknowledgment(person: &str, state: &str) -> (String, Value) {
    ("acknowledgments".into(), object([
        ("id", id(&format!("ack-{person}"))), ("messageId", id("msg")), ("chatKey", text("alpha")),
        ("principal", id(person)), ("state", text(state)),
    ]))
}
