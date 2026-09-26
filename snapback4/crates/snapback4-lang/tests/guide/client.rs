//! The published receipt policy runs against the engine, not a prose-only model.
use super::{args, card, clean, id, quarry, sent, text, Context, Engine, Value};

#[test]
fn client_aliases_keep_typing_on_ephemeral() {
    let client = card("client").unwrap();
    assert!(client.lines().count() <= 130);
    for alias in ["client", "react", "hooks", "composer", "receipts", "unread"] {
        assert_eq!(card(alias), Some(client));
        assert!(snapback4_lang::guide::listing().contains(alias));
    }
    assert_eq!(card("typing"), card("ephemeral"));
}

fn write(engine: &mut Engine, who: &str, name: &str, key: &str, input: &[(&str, Value)]) -> Value {
    sent(&engine.mutate(name, Some(key), Context::new(who, args(input)).with_ids([key.into(), format!("{key}-member")])).unwrap()).clone()
}
fn receipt(engine: &mut Engine, message: &Value) -> i64 {
    let result = engine.query("messageReceipt", Context::new("alice", args(&[("id", message.clone())]))).unwrap();
    assert!(result.complete);
    match result.data.field("receipt").unwrap() { Value::Int(n) => *n, other => panic!("{other:?}") }
}

#[test]
fn client_receipts_exclude_late_joins_drop_leavers_and_never_regress_progress() {
    let recipe = quarry(card("client").unwrap()).remove(0);
    let source = format!("{recipe}\n{}", r#"
mutation createRoom():
  room = insert rooms { creator: viewer }
  insert members { room: room.id, principal: viewer }
  return room.id
mutation addMember(room: rooms, principal: principal):
  insert members { room, principal } if absent
mutation removeMember(room: rooms, principal: principal):
  delete members[room, principal]
mutation send(room: rooms, body: text <=2000):
  m = insert messages { room, sender: viewer, body }
  return m.id
query progress(room: rooms):
  return members[room, viewer]
"#);
    let bound = clean("client receipt recipe", &source);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let room = write(&mut engine, "alice", "createRoom", "room", &[]);
    for who in ["bob", "carol"] {
        write(&mut engine, "alice", "addMember", who, &[("room", room.clone()), ("principal", id(who))]);
    }
    let first = write(&mut engine, "alice", "send", "first", &[("room", room.clone()), ("body", text("hello"))]);
    assert_eq!(receipt(&mut engine, &first), 0);
    write(&mut engine, "bob", "acknowledge", "bob-read", &[("id", first.clone()), ("kind", text("read"))]);
    assert_eq!(receipt(&mut engine, &first), 0, "carol still blocks");
    write(&mut engine, "carol", "acknowledge", "carol-delivered", &[("id", first.clone()), ("kind", text("delivered"))]);
    assert_eq!(receipt(&mut engine, &first), 1);
    write(&mut engine, "alice", "addMember", "dave", &[("room", room.clone()), ("principal", id("dave"))]);
    assert_eq!(receipt(&mut engine, &first), 1, "later joins never count");
    write(&mut engine, "alice", "removeMember", "remove-carol", &[("room", room.clone()), ("principal", id("carol"))]);
    assert_eq!(receipt(&mut engine, &first), 2, "removed recipient drops out");
    write(&mut engine, "alice", "addMember", "carol-again", &[("room", room.clone()), ("principal", id("carol"))]);
    assert_eq!(receipt(&mut engine, &first), 2, "rejoin cannot reenter an old recipient set");
    let second = write(&mut engine, "alice", "send", "second", &[("room", room.clone()), ("body", text("next"))]);
    write(&mut engine, "bob", "acknowledge", "bob-read-next", &[("id", second.clone()), ("kind", text("read"))]);
    let before = engine.query("progress", Context::new("bob", args(&[("room", room.clone())]))).unwrap().data;
    write(&mut engine, "bob", "acknowledge", "bob-old-delivery", &[("id", first.clone()), ("kind", text("delivered"))]);
    let after = engine.query("progress", Context::new("bob", args(&[("room", room.clone())]))).unwrap().data;
    assert_eq!(before, after, "late older acknowledgements cannot regress either watermark");
    assert_eq!(receipt(&mut engine, &second), 0);
    write(&mut engine, "mallory", "acknowledge", "outsider", &[("id", second.clone()), ("kind", text("read"))]);
    assert_eq!(receipt(&mut engine, &second), 0, "an outsider cannot acknowledge for a recipient");
    for who in ["bob", "carol", "dave"] {
        write(&mut engine, who, "removeMember", &format!("leave-{who}"), &[("room", room.clone()), ("principal", id(who))]);
    }
    assert_eq!(receipt(&mut engine, &second), 2, "no remaining recipients means no remaining requirement");
    println!("client receipts: sent=0, delivered=1, read=2; late join/rejoin excluded; removal/leave drop out; old progress and outsider ack unchanged");
}
