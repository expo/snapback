//! Key sugar survives backend serialization and the real acquisition path.
mod common;
use common::*;
use snapback4_core::{Value, value::object};
use serde_json::json;

const SOURCE: &str = r#"table members:
  org: id
  principal: principal
  role: enum('admin', 'member')
  unique org, principal
  read <- .principal = viewer
  sync
query probe(org: id):
  return exists members[org, viewer, role = 'admin']
query point(org: id):
  return members[org, viewer, role = 'admin']
"#;

fn exercise<H: Host>(host: &mut H) {
    let named = SOURCE.replace("members[org, viewer,", "members[org = org, principal = viewer,");
    let (mut mixed, backend) = compile(SOURCE);
    let (mut explicit, named_backend) = compile(&named);
    assert_eq!(backend.schema.tables["members"].sync, named_backend.schema.tables["members"].sync);
    for server in [&mut mixed, &mut explicit] {
        server.seed([
            ("members".into(), object([("id", id("a")), ("org", id("admin")), ("principal", id("alice")), ("role", Value::String("admin".into()))])),
            ("members".into(), object([("id", id("m")), ("org", id("member")), ("principal", id("alice")), ("role", Value::String("member".into()))])),
            ("members".into(), object([("id", id("b")), ("org", id("private")), ("principal", id("bob")), ("role", Value::String("admin".into()))])),
        ]).unwrap();
    }
    for viewer in ["alice", "bob"] {
        let mut device = host.open(viewer, Some(backend.clone())).unwrap();
        let mixed_pages = snapshot_pages(&mut mixed, viewer, 20);
        let named_pages = snapshot_pages(&mut explicit, viewer, 20);
        let events = |pages: &[snapback4_device::device::StreamPage]| pages.iter().flat_map(|page| page.events.iter()).map(|event| serde_json::to_value(event).unwrap()).collect::<Vec<_>>();
        assert_eq!(events(&mixed_pages), events(&named_pages), "same delivered audience for {viewer}");
        for (n, page) in mixed_pages.iter().enumerate() { device.apply(page, n == 0).unwrap(); }
        for org in ["admin", "member", "private", "missing"] {
            for op in ["probe", "point"] {
                let args = [("org", id(org))];
                let a = mixed.query(op, context(viewer, &args).at(10)).unwrap();
                let b = explicit.query(op, context(viewer, &args).at(10)).unwrap();
                let local = device.query(op, viewer, &json!({"org":org}), 10).unwrap();
                assert_eq!(a.data, b.data);
                assert_eq!(a.data, local.data, "{viewer} {op} {org}");
                assert_eq!(a.metered, b.metered);
            }
        }
        host.close(viewer, device);
    }
}

#[test] fn mixed_keys_match_named_on_memory_device() { exercise(&mut Memory::new()); }
#[test] fn mixed_keys_match_named_on_sqlite_device() { exercise(&mut Sqlite::new("mixed-keys")); }
