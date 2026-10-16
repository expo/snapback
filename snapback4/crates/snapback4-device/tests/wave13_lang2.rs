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
