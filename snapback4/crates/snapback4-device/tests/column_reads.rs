//! Snapshot, stream and prediction witnesses on both production device stores.
mod common;
use common::*;
use serde_json::json;
use snapback4_core::{Value, WriteState, value::object};

const SOURCE: &str = r#"
table records:
  owner: principal
  title: text <= 80
  secret: text <= 80 default 'default is not a hidden value' read <- .owner = viewer
  public 'identities are public'
  insert <- allow
  update <- allow
  sync public
query one(id: records):
  return records[id]
query page():
  return records first 20 by .id
mutation move(id: records, owner: principal):
  return update records[id] { owner }
mutation title(id: records, title: text <= 80):
  return update records[id] { title }
"#;

fn cells<H: Host>(host: &mut H) {
    let (mut server, backend) = compile(SOURCE);
    server
        .seed([(
            "records".into(),
            object([
                ("id", id("r")),
                ("owner", id("alice")),
                ("title", Value::String("public".into())),
                ("secret", Value::String("actual secret".into())),
            ]),
        )])
        .unwrap();
    let mut alice = host.open("alice", Some(backend.clone())).unwrap();
    let mut bob = host.open("bob", Some(backend)).unwrap();
    let mut watermark = 0;
    for (viewer, device) in [("alice", &mut alice), ("bob", &mut bob)] {
        let pages = snapshot_pages(&mut server, viewer, 10);
        for (n, page) in pages.iter().enumerate() {
            let bytes = serde_json::to_string(page).unwrap();
            if viewer == "bob" {
                assert!(!bytes.contains("actual secret"), "{bytes}");
                assert!(!bytes.contains("default is not"), "{bytes}");
            }
            device.apply(page, n == 0).unwrap();
            watermark = page.watermark;
        }
        let read = device.query("one", viewer, &json!({"id":"r"}), 10).unwrap();
        assert!(read.complete, "{read:?}");
        assert_eq!(
            read.data.field("secret").is_ok(),
            viewer == "alice",
            "{read:?}"
        );
        let page = device.query("page", viewer, &json!({}), 10).unwrap();
        assert!(page.complete, "{page:?}");
        assert_eq!(
            page.data.as_array().unwrap()[0].field("secret").is_ok(),
            viewer == "alice"
        );
    }
    // Bob cannot make an omitted server cell appear from its declared default.
    let queued=bob.admit(serde_json::from_value(json!({"id":"move","seq":0,"op":"move","args":{"id":"r","owner":"bob"},"viewer":"bob","now":10,"predictable":true,"new_ids":[]})).unwrap()).unwrap();
    assert!(!queued.predictable, "{queued:?}");
    assert!(queued.predicted.is_empty());
    assert!(
        bob.query("one", "bob", &json!({"id":"r"}), 10)
            .unwrap()
            .data
            .field("secret")
            .is_err()
    );
    let outcome = server
        .mutate(
            "move",
            None,
            context("bob", &[("id", id("r")), ("owner", id("bob"))]).at(10),
        )
        .unwrap();
    assert!(
        matches!(outcome.state, WriteState::Sent { .. }),
        "{outcome:?}"
    );
    for (viewer, device) in [("alice", &mut alice), ("bob", &mut bob)] {
        let page = stream_page(&mut server, viewer, watermark);
        let bytes = serde_json::to_string(&page).unwrap();
        if viewer == "alice" {
            assert!(!bytes.contains("actual secret"));
        }
        device.apply(&page, false).unwrap();
        if viewer == "bob" {
            device.settle("move", Some(page.watermark)).unwrap();
        }
        let read = device.query("one", viewer, &json!({"id":"r"}), 10).unwrap();
        assert_eq!(
            read.data.field("secret").is_ok(),
            viewer == "bob",
            "{read:?}"
        );
    }
    host.close("alice", alice);
    host.close("bob", bob);
    let mut reopened = host.open("alice", None).unwrap();
    assert!(
        reopened
            .query("one", "alice", &json!({"id":"r"}), 10)
            .unwrap()
            .data
            .field("secret")
            .is_err()
    );
}

#[test]
fn cells_on_memory() {
    cells(&mut Memory::new());
}
#[test]
fn cells_on_sqlite() {
    cells(&mut Sqlite::new("column-read"));
}

fn witnesses<H: Host>(host: &mut H) {
    let source = SOURCE.replace(".owner = viewer", "exists roles[viewer]")
        + r#"
table roles:
  principal: principal
  unique principal
  read <- .principal = viewer
  sync to .principal
"#;
    let (mut server, backend) = compile(&source);
    server
        .seed([
            (
                "records".into(),
                object([
                    ("id", id("r")),
                    ("owner", id("alice")),
                    ("title", Value::String("shared".into())),
                    ("secret", Value::String("never delivered".into())),
                ]),
            ),
            (
                "roles".into(),
                object([("id", id("grant")), ("principal", id("alice"))]),
            ),
        ])
        .unwrap();
    let mut d = host.open("witness", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut server, "alice", 10).iter().enumerate() {
        assert!(
            !serde_json::to_string(page)
                .unwrap()
                .contains("never delivered")
        );
        d.apply(page, n == 0).unwrap();
    }
    let server_read = server
        .query("one", context("alice", &[("id", id("r"))]))
        .unwrap();
    assert_eq!(
        server_read.data.field("secret").unwrap(),
        &Value::String("never delivered".into())
    );
    let local = d.query("one", "alice", &json!({"id":"r"}), 10).unwrap();
    assert!(!local.complete, "{local:?}");
    assert!(local.data.field("secret").is_err());
}
#[test]
fn witness_cells_stay_off_memory() {
    witnesses(&mut Memory::new());
}
#[test]
fn witness_cells_stay_off_sqlite() {
    witnesses(&mut Sqlite::new("column-witness"));
}
