#![allow(dead_code)]
use snapback4_core::{Value, value::object};

pub const SOURCE: &str = r#"table members:
  roomId: id
  principal: principal
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  read <- .principal = viewer
  sync

table messages:
  roomId: id
  body: text <=100
  at: time
  by byTime: roomId, at, id
  by byWords: words(body), at, id
  by byRoomWords: roomId, words(body), at, id
  read <- exists members[.roomId, viewer]
  sync to members[.roomId]

query all(q: text <=100, c: cursor ?):
  return messages matching q after c last 10 by byWords
query scoped(roomId: id, q: text <=100, c: cursor ?):
  return messages[roomId = roomId] matching q after c last 10 by byRoomWords
query filtered(roomId: id, c: cursor ?):
  return messages[roomId = roomId] after c last 10 by byTime where .body = 'missing'
"#;

pub fn seed(visible: usize, hidden: usize) -> Vec<(String, Value)> {
    let mut rows = vec![];
    for room in ["readable", "words"] {
        rows.push(("members".into(), object([("id", Value::Id(format!("m-{room}"))), ("roomId", Value::Id(room.into())), ("principal", Value::Id("dev:alice".into()))])));
    }
    for (room, count, offset) in [("readable", visible, 0), ("hidden", hidden, visible), ("words", 33, 0)] {
        for n in 0..count {
            rows.push(("messages".into(), object([("id", Value::Id(format!("{room}-{n:06}"))), ("roomId", Value::Id(room.into())),
                ("body", Value::String(if room == "words" { format!("cof{n:02}") } else { "coffee".into() })), ("at", Value::Int((offset + n) as i64))])));
        }
    }
    rows
}
