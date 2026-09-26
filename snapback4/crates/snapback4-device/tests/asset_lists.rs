//! The receipt's column home survives order changes, never authority changes.
// @ref LLP 3000.019#3.5 — the same offline media lifecycle on both durable device hosts.
mod common;
use common::*;
use serde_json::{Value as Json, json};
use snapback4_device::{device::{Device, StreamPage}, store::DeviceStore};

fn source(kind: &str) -> String {
    format!("table posts:\n  owner: principal\n  photos: {kind}\n  secrets: [image <=100 once] <=4 ?\n  until: time ?\n  by byOwner: owner, id\n  expire at .until\n  read <- .owner = viewer\n  retain delivered-history\n  sync to .owner\nquery post(id: posts):\n  return posts[id]\n")
}
fn facts(id: &str) -> Json {
    json!({"id":id,"type":"image/png","bytes":26,"width":2,"height":3,"duration":null})
}
fn row(photos: Json) -> Json {
    json!({"id":"post","owner":"alice","photos":photos,"secrets":[facts("secret")],"until":100})
}
fn apply<S: DeviceStore>(d: &mut Device<S>, kind: &str, data: Json, first: bool) {
    let state = d.sync_state_read().unwrap();
    let page: StreamPage = serde_json::from_value(json!({
        "snapshot":first,"store_id":"media-store","generation":d.backend().generation,
        "requested_watermark":state.transfer_watermark,"watermark":state.watermark+1,"more":false,
        "events":[{"table":"posts","id":"post","kind":kind,"data":data}]
    })).unwrap();
    d.apply(&page, first).unwrap();
}
fn home<S: DeviceStore>(d: &mut Device<S>, id: &str, now: i64) -> Json {
    d.asset_home(id,"alice",now,&json!({"store_id":"media-store","table":"posts","row":"post","column":if id=="secret" {"secrets"} else {"photos"}})).unwrap()
}
fn lifecycle<H: Host>(h: &mut H) {
    for (kind, nested) in [("[image <=100] <=4", false), ("[video <=100] <=4 ?", false), ("[[image <=100] <=2] <=2 ?", true)] {
        let (_, backend) = compile(&source(kind));
        let mut d = h.open(kind, Some(backend)).unwrap();
        let cell = |ids: &[&str]| {
            let flat = Json::Array(ids.iter().map(|id| {
                let mut value = facts(id);
                if kind.contains("video") {
                    value["type"] = json!("video/mp4");
                    value["width"] = Json::Null;
                    value["height"] = Json::Null;
                    value["duration"] = json!(10);
                }
                value
            }).collect());
            if nested { json!([flat]) } else { flat }
        };
        apply(&mut d,"put",row(cell(&["a","b"])),true);
        for id in ["a","b"] { assert_eq!(home(&mut d,id,1)["row"],"post"); }
        assert_eq!(home(&mut d,"secret",1),Json::Null);
        h.close(kind,d);
        let mut d = h.open(kind,None).unwrap();
        for id in ["a","b"] { assert_eq!(home(&mut d,id,1)["row"],"post","reopen {kind}"); }
        apply(&mut d,"put",row(cell(&["b","a"])),false);
        let read = d.query("post","alice",&json!({"id":"post"}),1).unwrap();
        assert_eq!(snapback4_core::wire::to_json(&read.data)["photos"],cell(&["b","a"]));
        for id in ["a","b"] { assert_eq!(home(&mut d,id,1)["row"],"post","reorder {kind}"); }
        apply(&mut d,"put",row(cell(&["b"])),false);
        assert_eq!(home(&mut d,"a",1),Json::Null);
        assert_eq!(home(&mut d,"b",1)["row"],"post");
        assert_eq!(home(&mut d,"b",100),Json::Null,"offline expiry");
        apply(&mut d,"put",row(cell(&[])),false);
        assert_eq!(home(&mut d,"b",1),Json::Null,"clear");
        apply(&mut d,"put",row(cell(&["b"])),false);
        apply(&mut d,"del",Json::Null,false);
        assert_eq!(home(&mut d,"b",1),Json::Null,"delete");
        apply(&mut d,"put",row(cell(&["b"])),false);
        apply(&mut d,"scope",json!(["alice"]),false);
        assert_eq!(home(&mut d,"b",1),Json::Null,"partition leave retires media");
        assert_eq!(d.query("post","alice",&json!({"id":"post"}),1).unwrap().data.field("id").unwrap().as_str().unwrap(),"post","text history remains");
        h.close(kind,d);
        let mut d=h.open(kind,None).unwrap();
        assert_eq!(home(&mut d,"b",1),Json::Null,"reopen cannot restore retired custody");
        h.close(kind,d);
    }
}
#[test] fn list_lifecycle_memory() { lifecycle(&mut Memory::new()); }
#[test] fn list_lifecycle_sqlite() { lifecycle(&mut Sqlite::new("list-lifecycle")); }

fn generation<H: Host>(h: &mut H) {
    let (_, mut backend)=compile(&source("[image <=100] <=4 ?"));
    let mut d=h.open("generation",Some(backend.clone())).unwrap();
    apply(&mut d,"put",row(json!([facts("a")])),true);
    assert_eq!(home(&mut d,"a",1)["row"],"post");
    backend.generation+=1;
    d.adopt(backend).unwrap();
    assert_eq!(home(&mut d,"a",1),Json::Null,"old acquisition cannot authorize a new generation");
    h.close("generation",d);
    let mut d=h.open("generation",None).unwrap();
    assert_eq!(home(&mut d,"a",1),Json::Null);
    apply(&mut d,"put",row(json!([facts("a")])),true);
    assert_eq!(home(&mut d,"a",1)["generation"],d.backend().generation);
    d.clear_rows().unwrap();
    assert_eq!(home(&mut d,"a",1),Json::Null,"reset");
    h.close("generation",d);
}
#[test] fn list_generation_memory() { generation(&mut Memory::new()); }
#[test] fn list_generation_sqlite() { generation(&mut Sqlite::new("list-generation")); }
