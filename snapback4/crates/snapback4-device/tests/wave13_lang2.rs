mod common;
use common::*;
use snapback4_core::{Value, value::object};
use serde_json::json;

#[test]
fn new_private_exhaustion_interpretations_require_v5_before_device_execution() {
    let source = "table entries:\n  a: int\n  b: int\n  cap 2\n  read <- .a = .b\n  online only\nquery list(c: cursor ?):\n  return entries first 2 by .id after c\n";
    let (_, backend) = compile(source);
    let required = snapback4_core::device_protocol::compatibility(&backend.schema.public_projection());
    let mut old = snapback4_core::device_protocol::DeviceEngine::current();
    old.capabilities.retain(|capability| capability != "branch-pages-v5");
    let error = snapback4_core::device_protocol::check(Some(&old), &required).unwrap_err();
    assert_eq!(error.code,"E_DEVICE_VERSION");
    assert!(error.message.contains("branch-pages-v5"));
}

fn filtered(host: &mut impl Host) {
    let source = "table entries:\n  x: int ?\n  cap 4\n  public\n  sync public\nquery filtered():\n  return entries where .x != null first 4 by .id { value: .x + 1 }\n";
    let (mut server, backend) = compile(source);
    server.seed([("entries".into(),object([("id",id("a")),("x",Value::Int(2))])),
        ("entries".into(),object([("id",id("b")),("x",Value::Null)]))]).unwrap();
    let mut device = host.open("filtered",Some(backend)).unwrap();
    for (at,page) in snapshot_pages(&mut server,"alice",10).iter().enumerate() {
        let answer = snapback4_device::call::call_text(&mut device,&json!({"op":"apply","page":page_json(page),"first":at==0}).to_string());
        assert!(answer.get("denied").is_none(),"{answer}");
    }
    let answer = snapback4_device::call::call(&mut device,json!({"op":"query","name":"filtered","viewer":"alice","args":{},"now":0}));
    assert_eq!(answer["ok"]["data"],json!([{"value":3}]),"{answer}");
    assert_eq!(answer["ok"]["complete"],true,"{answer}");
    host.close("filtered",device);
}
#[test]
fn filtered_snapshot_refinement_runs_on_memory_and_native_sqlite() {
    filtered(&mut Memory::new());
    filtered(&mut Sqlite::new("lang2-filter"));
}

fn immutable_equality(host: &mut impl Host) {
    let source = "table entries:\n  owner: principal\n  body: text\n  immutable owner\n  public\n  insert <- allow\n  update <- allow\n  sync public\nmutation save(e: entries):\n  upsert entries[e] { owner: viewer, body: 'saved' }\n  return null\n";
    let (mut server, backend) = compile(source);
    server.seed([("entries".into(),object([("id",id("e")),("owner",id("alice")),("body",Value::String("old".into()))]))]).unwrap();
    let mut device = host.open("immutable",Some(backend)).unwrap();
    for (at,page) in snapshot_pages(&mut server,"alice",10).iter().enumerate() { device.apply(page,at==0).unwrap(); }
    let same = device.predict("save","alice",&json!({"e":"e"}),100,vec![],1).unwrap();
    assert_eq!(same.predicted,vec!["entries/e"]);
    let different = device.predict("save","bob",&json!({"e":"e"}),100,vec![],2).unwrap_err();
    assert_eq!(different.code(),"E_CONSTRAINT");
    host.close("immutable",device);
}

#[test]
fn immutable_notes_preserve_equality_on_memory_and_native_sqlite() {
    immutable_equality(&mut Memory::new());
    immutable_equality(&mut Sqlite::new("immutable-equality"));
}

fn hidden_immutable_mismatch(host: &mut impl Host) {
    let source = "table entries:\n  owner: principal\n  body: text\n  unique owner\n  immutable owner\n  read <- .owner = viewer\n  update <- allow\n  sync to .owner\nmutation change():\n  update entries[owner = 'bob'] { owner: 'alice', body: 'saved' }\n  return null\nquery row():\n  return entries[owner = 'bob']\n";
    let (mut server, backend) = compile(source);
    server.seed([("entries".into(),object([("id",id("e")),("owner",id("bob")),("body",Value::String("old".into()))]))]).unwrap();
    let mut device = host.open("hidden-immutable",Some(backend)).unwrap();
    for (at,page) in snapshot_pages(&mut server,"alice",10).iter().enumerate() { device.apply(page,at==0).unwrap(); }
    let unknown = device.predict("change","alice",&json!({}),100,vec![],1).unwrap_err();
    assert_eq!(unknown.code(),"E_PREDICT","a hidden unheld target queues for the server: {unknown}");
    let out = server.mutate("change",Some("hidden"),context("alice",&[])).unwrap();
    assert!(matches!(out.state,snapback4_core::WriteState::Sent { .. }),"{out:?}");
    let row = server.query("row",context("bob",&[])).unwrap().data;
    assert_eq!(row.field("owner").unwrap(),&id("bob"));
    assert_eq!(row.field("body").unwrap(),&Value::String("saved".into()));
    host.close("hidden-immutable",device);
}

#[test]
fn hidden_immutable_key_mismatch_queues_and_succeeds_on_both_stores() {
    hidden_immutable_mismatch(&mut Memory::new());
    hidden_immutable_mismatch(&mut Sqlite::new("hidden-immutable-mismatch"));
}
