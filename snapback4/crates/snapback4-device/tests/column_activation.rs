//! Adoption must discard snapshot-acquired images, even if no later write
//! ever touches the parent. Run on SQLite and the web's memory store.
mod common;
use common::*;
use snapback4_core::{Value, successor::keeps_literal_default_images};
use snapback4_device::device::Backend;
use serde_json::json;

const SOURCE: &str = "table posts:\n  at: time\n  public\n  sync public\ntable likes:\n  postId: posts ?\n  other: posts ?\n  selected: bool\n  amount: int\n  public\n  online only\ntable votes:\n  postId: posts ?\n  public\n  online only\nquery one(id: posts):\n  return posts[id]\n";
fn schema(form: &str) -> String { SOURCE.replacen("  at: time", &format!("  at: time\n  likes: {form}"), 1) }
fn run<H: Host>(host: &mut H, edit: &str, reopen: bool) {
    let before = if edit == "add" {SOURCE.to_owned()} else {schema("count likes by postId")};
    let (mut server, mut backend) = compile(&before);
    server.seed([
        ("posts".into(), snapback4_core::value::object([("id",id("p")),("at",Value::Int(1))])),
        ("likes".into(), snapback4_core::value::object([("id",id("l")),("postId",id("p")),("other",id("missing")),("selected",Value::Bool(false)),("amount",Value::Int(7))])),
    ]).unwrap();
    backend.schema = backend.schema.public_projection();
    let mut device = host.open("adoption", Some(backend.clone())).unwrap();
    let old_pages = snapshot_pages(&mut server, "alice", 1);
    for (i,page) in old_pages.iter().enumerate() { device.apply(page,i==0).unwrap(); }
    let old = device.query("one","alice",&json!({"id":"p"}),1000).unwrap().data;
    assert_ne!(old,Value::Null);
    let (form, expected) = match edit {
        "kind" => ("sum likes of amount by postId",7),
        "source" => ("count votes by postId",0),
        "predicate" => ("count likes where .selected by postId",0),
        "by" => ("count likes by other",0),
        _ => ("count likes by postId",1),
    };
    // A literal addition alongside a redefinition must not activate retention.
    let (_, mut next) = compile(&schema(form).replace("  at: time", "  at: time\n  title: text <=10 default 'old'"));
    server.adopt(next.schema.clone(),next.programs.clone()).unwrap();
    next.schema = next.schema.public_projection();
    next.generation = server.generation();
    assert!(!keeps_literal_default_images(&backend.schema,&next.schema), "{edit}");
    if reopen { host.close("adoption",device); device=host.open("adoption",Some(next)).unwrap(); }
    else { device.adopt(Backend { ..next }).unwrap(); }
    assert_eq!(device.state().unwrap().0,0);
    // Before the replacement snapshot, the old image must not read implicit 0
    // (or the old nonzero value). It is no longer a readable confirmed row.
    let refusal = device.query("one","alice",&json!({"id":"p"}),1000).unwrap_err();
    assert_eq!(refusal.code,"E_PREDICT","{} {edit}",host.label());
    assert!(device.apply(&old_pages[0],false).is_err(),"reject old-generation pages");
    for (i,page) in snapshot_pages(&mut server,"alice",1).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    let row=device.query("one","alice",&json!({"id":"p"}),1000).unwrap().data;
    assert_eq!(row.field("likes").unwrap(),&Value::Int(expected),"{edit}");
    host.close("adoption",device);
    let mut device=host.open("adoption",None).unwrap();
    assert_eq!(device.query("one","alice",&json!({"id":"p"}),1000).unwrap().data,row);
    host.close("adoption",device);
}

#[test]
fn additions_and_all_redefinitions_reacquire_on_both_stores() {
    for edit in ["add","kind","source","predicate","by"] {
        for reopen in [false,true] {
            run(&mut Sqlite::new("column-adoption"),edit,reopen);
            run(&mut Memory::new(),edit,reopen);
        }
    }
}
