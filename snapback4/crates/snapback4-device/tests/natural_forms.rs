//! The new forms on the server and the two production device stores.
mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Value, WriteState, value::object};

const SOURCE: &str = r#"table profiles:
  principal: principal
  handle: text 3..20
  bio: text
  unique principal
  unique handle
  public
  sync public
table follows:
  follower: principal
  followed: principal
  unique follower, followed
  public
  sync public
table notes:
  owner: principal
  title: text
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  sync to .owner
query spread(h: text 3..20):
  p = profiles[handle = h] ! else NOT_FOUND
  return { ...p, following: exists follows[viewer, p.principal] }
query shaped(h: text 3..20):
  p = profiles[handle = h] ! else NOT_FOUND
  return p { *, following: exists follows[viewer, .principal] }
query inline(h: text 3..20):
  return { ...profiles[handle = h] ! else NOT_FOUND, extra: true }
query note(key: notes):
  p = notes[key] ! else NOT_FOUND
  return { ...p, extra: true }
query row(key: notes):
  return notes[key]
query echo(title: text):
  return title
mutation add(title: text):
  return insert notes { owner: viewer, title }
mutation pieces(parts: [text] <=2):
  title = ''
  for part in parts:
    title = title + part
  return insert notes { owner: viewer, title }
mutation spreadWrite(title: text):
  base = { owner: viewer, title: 'overridden' }
  return insert notes { ...base, title }
mutation patch(key: notes, title: text):
  base = { title: 'overridden' }
  return update notes[key] { ...base, title }
"#;

fn rows_and_objects<H: Host>(host: &mut H) {
    let (mut server, backend) = compile(SOURCE);
    server.seed([
        ("profiles".into(), object([("id", id("bob-profile")), ("principal", id("bob")), ("handle", Value::String("bob".into())), ("bio", Value::String("hello".into()))])),
        ("follows".into(), object([("id", id("edge")), ("follower", id("alice")), ("followed", id("bob"))])),
        ("notes".into(), object([("id", id("hidden")), ("owner", id("bob")), ("title", Value::String("secret".into()))])),
    ]).unwrap();
    let mut device = host.open("natural-spread", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut server, "alice", 10).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let args = [("h", Value::String("bob".into()))];
    let spread = server.query("spread", context("alice", &args).at(10)).unwrap();
    let shaped = server.query("shaped", context("alice", &args).at(10)).unwrap();
    assert!(spread.complete && shaped.complete);
    assert_eq!(spread.data, shaped.data);
    assert_eq!(spread.metered.examined, shaped.metered.examined);
    assert_eq!(spread.data.field("following").unwrap(), &Value::Bool(true));
    for name in ["spread", "shaped"] {
        let local = device.query(name, "alice", &json!({"h":"bob"}), 10).unwrap();
        assert!(local.complete);
        assert_eq!(local.data, spread.data);
    }
    let inline = server.query("inline", context("alice", &args).at(10)).unwrap();
    assert_eq!(inline.metered.examined, 1, "a spread reads its operand once, regardless of field count");
    assert_eq!(device.query("inline", "alice", &json!({"h":"bob"}), 10).unwrap().metered.examined, 1);
    for key in ["hidden", "missing"] {
        assert_eq!(server.query("note", context("alice", &[("key", id(key))]).at(10)).unwrap_err().code, "NOT_FOUND");
        assert_eq!(device.query("note", "alice", &json!({"key":key}), 10).unwrap_err().code, "NOT_FOUND");
    }
    host.close("natural-spread", device);
    let mut reopened = host.open("natural-spread", None).unwrap();
    assert_eq!(reopened.query("spread", "alice", &json!({"h":"bob"}), 10).unwrap().data, spread.data);
}

#[test] fn spread_server_and_memory_device() { rows_and_objects(&mut Memory::new()); }
#[test] fn spread_server_and_sqlite_device() { rows_and_objects(&mut Sqlite::new("natural-spread")); }

fn text_bounds<H: Host>(host: &mut H) {
    for character in ["x", "🪨"] {
        let (mut server, backend) = compile(SOURCE);
        let mut device = host.open(&format!("natural-text-{character}"), Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut server, "alice", 10).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
        let fit = character.repeat(10_000);
        let too_long = character.repeat(10_001);
        for name in ["add", "spreadWrite"] {
            let input = [("title", Value::String(fit.clone()))];
            let sent = server.mutate(name, None, context("alice", &input).at(10).with_ids([format!("{name}-server")])).unwrap();
            assert!(matches!(sent.state, WriteState::Sent { .. }), "{:?}", sent.state);
            let predicted = device.predict(name, "alice", &json!({"title":fit}), 10, vec![format!("{name}-device")], 1).unwrap();
            assert_eq!(predicted.result["title"], json!(fit));
            let invalid = server.mutate(name, None, context("alice", &[("title", Value::String(too_long.clone()))]).at(10));
            let WriteState::Failed { why, .. } = invalid.unwrap().state else { panic!("oversized argument was accepted") };
            assert_eq!(why.code, "E_INPUT");
            assert_eq!(device.predict(name, "alice", &json!({"title":too_long}), 10, vec!["invalid".into()], 1).unwrap_err().code(), "E_INPUT");
        }
        assert_eq!(server.query("echo", context("alice", &[("title", Value::String(fit.clone()))])).unwrap().data, Value::String(fit.clone()));
        assert_eq!(device.query("echo", "alice", &json!({"title":fit}), 10).unwrap().data, Value::String(fit.clone()));
        assert_eq!(device.query("echo", "alice", &json!({"title":too_long}), 10).unwrap_err().code, "E_INPUT");
        // Each part fits its argument bound. Only the stored column can reject
        // the combined value, independently of argument validation.
        for extra in ["", character] {
            let input = [("parts", Value::Array(vec![Value::String(fit.clone()), Value::String(extra.into())]))];
            let written = server.mutate("pieces", None, context("alice", &input).at(10).with_ids([format!("pieces-{}", extra.len())])).unwrap();
            let predicted = device.predict("pieces", "alice", &json!({"parts":[fit, extra]}), 10, vec![format!("pieces-{}", extra.len())], 1);
            if extra.is_empty() {
                assert!(matches!(written.state, WriteState::Sent { .. }));
                assert_eq!(predicted.unwrap().result["title"], json!(fit));
            } else {
                let WriteState::Failed { why, .. } = written.state else { panic!("oversized column was written") };
                assert_eq!(why.code, "E_INPUT");
                assert_eq!(predicted.unwrap_err().code(), "E_INPUT");
                assert_eq!(device.query("row", "alice", &json!({"key":format!("pieces-{}", extra.len())}), 10).unwrap().data, Value::Null);
            }
        }
    }
}

#[test] fn default_text_server_and_memory_device() { text_bounds(&mut Memory::new()); }
#[test] fn default_text_server_and_sqlite_device() { text_bounds(&mut Sqlite::new("natural-text")); }
