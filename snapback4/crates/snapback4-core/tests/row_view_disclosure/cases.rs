#![allow(dead_code)]
use super::*;
pub const SOURCE: &str = include_str!("../../../snapback4-lang/tests/fixtures/row-keyed-view.q");
pub fn member(id: &str, principal: &str, mark: i64) -> (String, Json) {
    (
        "members".into(),
        json!({"id":id,"principal":principal,"conversationId":"c","readUpTo":mark,"joinedAt":0}),
    )
}
pub fn message(id: &str, ordinal: i64, tombstone: bool) -> (String, Json) {
    (
        "messages".into(),
        json!({"id":id,"conversationId":"c","senderId":"bob","ordinal":ordinal,"tombstone":tombstone,"until":null}),
    )
}
pub fn private_members() -> String {
    SOURCE.replacen("  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync public", "  read <- .principal = viewer\n  insert <- allow\n  update <- allow\n  delete <- allow\n  sync to .principal", 1)
}
pub fn old_mark() -> Pair {
    let seeds = [0, 1200].map(|mark| {
        let mut seed = vec![member("b", "bob", mark)];
        seed.extend((1..=1200).map(|n| {
            let mut row = message(&format!("m{n:04}"), n, false);
            row.1["senderId"] = json!("alice");
            row
        }));
        seed
    });
    Pair::new(
        private_members(),
        seeds,
        "alice",
        Operation::new("mark", json!({"member":"b","readUpTo":1200}), "alice"),
    )
    .query("unreadFor", json!({"member":"b"}))
}
pub fn hidden_source(op: &str) -> Pair {
    let source = SOURCE
        .replace(
            "  sync public\nview unread",
            "  sync to .senderId\nview unread",
        )
        .replace(
            "  expire at .until\n  read <- allow",
            "  expire at .until\n  read <- .senderId = viewer",
        )
        + "\nmutation insertRow():\n  insert messages { id: 'new', conversationId: 'c', ordinal: 7, senderId: viewer, until: null }\nmutation insertAbsent():\n  insert messages { id: 'new', conversationId: 'c', ordinal: 7, senderId: viewer, until: null } if absent\nmutation upsertRow():\n  upsert messages['new'] { conversationId: 'c', ordinal: 7, senderId: viewer, until: null }\nmutation updateRow():\n  update messages['hidden'] { ordinal: 7 }\nmutation deleteRow():\n  delete messages['hidden']\nquery page(c: cursor ?):\n  return unread after c first 1 by .id\n";
    let mut pair = Pair::new(
        source,
        [false, true].map(|t| vec![member("a", "alice", 0), message("hidden", 5, t)]),
        "alice",
        Operation::new(op, json!({}), "alice"),
    )
    .query("unreadFor", json!({"member":"a"}))
    .query("page", json!({"c":null}))
    .then(Operation::new(
        "send",
        json!({"id":"bob-new","conversationId":"c","ordinal":9,"senderId":"bob","until":null}),
        "bob",
    ))
    .then(Operation::new(
        "mark",
        json!({"member":"a","readUpTo":8}),
        "alice",
    ));
    pair.refused = true;
    pair
}
pub fn hidden_conversation() -> Pair {
    let source = private_members().replacen(
        "  read <- allow\n  insert <- allow\n  sync public",
        "  read <- deny\n  insert <- allow\n  online only",
        1,
    );
    Pair::new(
        source,
        [
            vec![member("a", "alice", 0)],
            vec![
                member("a", "alice", 0),
                (
                    "conversations".into(),
                    json!({"id":"secret","title":"private"}),
                ),
            ],
        ],
        "alice",
        Operation::new(
            "send",
            json!({"id":"new","conversationId":"c","ordinal":1,"senderId":"bob","until":null}),
            "alice",
        ),
    )
    .query("unreadFor", json!({"member":"a"}))
}
pub fn unreadable_key() -> Pair {
    Pair::new(
        private_members(),
        [vec![], vec![member("b", "bob", 0)]],
        "alice",
        Operation::new(
            "send",
            json!({"id":"new","conversationId":"c","ordinal":1,"senderId":"bob","until":null}),
            "alice",
        ),
    )
    .query("unreadFor", json!({"member":"b"}))
}

pub fn refused_source(op: &str) -> Pair {
    let mut pair = hidden_source(op);
    let start = pair.source.find("table messages:").unwrap();
    let end = pair.source.find("view unread:").unwrap();
    let restricted = pair.source[start..end]
        .replace("insert <- allow", "insert <- viewer = 'bob'")
        .replace("update <- allow", "update <- viewer = 'bob'")
        .replace("delete <- allow", "delete <- viewer = 'bob'");
    pair.source.replace_range(start..end, &restricted);
    pair
}

pub fn hidden_interval() -> Pair {
    let mut pair = hidden_source("insertRow");
    pair.seeds = [1, 2001].map(|ordinal| {
        let mut seed = vec![member("a", "alice", 0)];
        seed.extend((0..1200).map(|n| message(&format!("hidden{n:04}"), ordinal, false)));
        seed
    });
    pair.operations = vec![Operation::new(
        "mark",
        json!({"member":"a","readUpTo":1500}),
        "alice",
    )];
    pair
}

pub fn hidden_expiry() -> Pair {
    let mut pair = hidden_source("insertRow");
    pair.seeds = [NOW - 1, NOW + 1].map(|expiry| {
        let mut row = message("hidden", 5, false);
        row.1["until"] = json!(expiry);
        vec![member("a", "alice", 0), row]
    });
    pair
}

pub fn digit_boundary() -> Pair {
    let mut pair = hidden_source("insertRow");
    for seed in &mut pair.seeds {
        seed.extend((0..9).map(|n| message(&format!("padding{n}"), 5, false)));
    }
    pair.source.push_str("\nquery foldedCount():\n  rows = unread first 100\n  return count(rows)\n");
    pair
}
