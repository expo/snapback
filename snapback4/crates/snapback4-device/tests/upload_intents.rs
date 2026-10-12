//! One custody suite on both real device stores.
mod common;
use common::{Host, Memory, Sqlite, compile, page_json, snapshot_pages};
use serde_json::{Value as Json, json};
use snapback4_device::call::call;
const SOURCE: &str = "table docs:\n  owner: principal\n  doc: file <=100000 ('application/pdf') ?\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  sync to .owner\nmutation attach(doc: file <=100000 ('application/pdf')):\n  return insert docs { owner: viewer, doc }\n";
fn custody<H: Host>(host: &mut H) {
    let (mut engine, backend) = compile(SOURCE);
    let mut device = host.open("upload", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "dev:alice", 10).iter().enumerate() {
        let mut page = page_json(page); page["store_id"] = json!("asset-store");
        let reply = call(&mut device, json!({"op":"apply","first":n==0,"page":page}));
        assert!(reply.get("denied").is_none(), "{reply}");
    }
    let store = call(&mut device, json!({"op":"sync_state","capture":false}))["ok"]["store_id"].clone();
    let entry = json!({"id":"upload1","seq":1,"op":"attach","args":{},"viewer":"dev:alice","now":20,"predictable":true,
        "upload":{"bytes":"255044462d312e370a","argument":"doc","file":{"type":"application/pdf","name":"a.pdf"},"store_id":store}});
    let admitted = call(&mut device, json!({"op":"admit_upload","entry":entry}));
    assert_eq!(admitted["ok"]["upload"]["state"], "queued", "{admitted}");
    assert_eq!(admitted["ok"]["predictable"], false);
    assert_eq!(call(&mut device,json!({"op":"begin_send","id":"upload1"}))["denied"]["code"],"E_UPLOAD_PENDING");
    assert_eq!(call(&mut device,json!({"op":"admit_upload","entry":entry})), admitted);
    let mut other = entry.clone(); other["upload"]["bytes"] = json!("ff");
    assert_eq!(call(&mut device,json!({"op":"admit_upload","entry":other}))["denied"]["code"],"E_WRITE_ID_REUSE");
    host.close("upload", device);
    let mut device = host.open("upload", None).unwrap();
    let queued = call(&mut device,json!({"op":"queued"}));
    assert_eq!(queued["ok"][0]["upload"]["bytes"],entry["upload"]["bytes"]);
    let why = json!({"code":"E_ASSET_TYPE","family":"asset","message":"wrong bytes"});
    let blocked = call(&mut device,json!({"op":"upload_state","id":"upload1","viewer":"dev:alice","state":"blocked","why":why}));
    assert_eq!(blocked["ok"]["upload"]["why"],why);
    let retry = call(&mut device,json!({"op":"upload_state","id":"upload1","viewer":"dev:alice","state":"queued"}));
    assert_eq!(retry["ok"]["upload"]["bytes"],entry["upload"]["bytes"]);
    let pdf = engine.store_file("dev:alice", b"%PDF-1.7\n", Some("application/pdf"), "a.pdf", 25).unwrap();
    let asset = snapback4_core::wire::to_json(&pdf.column_value());
    let ready = |viewer: &str, store: Json| json!({"op":"upload_ready","id":"upload1","viewer":viewer,"store_id":store,"asset":asset});
    assert_eq!(call(&mut device,ready("dev:bob",store.clone()))["denied"]["code"],"E_AUTH");
    assert_eq!(call(&mut device,ready("dev:alice",json!("different")))["denied"]["code"],"E_STORE_REPLACED");
    let prepared = call(&mut device,ready("dev:alice",store.clone()));
    assert_eq!(prepared["ok"]["upload"]["state"],"placing", "{prepared}");
    assert_eq!(prepared["ok"]["args"]["doc"],asset);
    assert!(prepared["ok"]["upload"]["bytes"].is_null());
    host.close("upload", device);
    let mut device = host.open("upload",None).unwrap();
    assert_eq!(call(&mut device,ready("dev:alice",store)),prepared);
    assert_eq!(call(&mut device,json!({"op":"admit_upload","entry":entry})),prepared);
    assert!(call(&mut device,json!({"op":"begin_send","id":"upload1"})).get("denied").is_none());
    assert_eq!(call(&mut device,json!({"op":"upload_state","id":"upload1","viewer":"dev:alice","state":"cancelling"}))["denied"]["code"],"E_UPLOAD_DISPATCHED");
    host.close("upload",device);
}
#[test] fn memory_custody() { custody(&mut Memory::new()); }
#[test] fn sqlite_custody() { custody(&mut Sqlite::new("uploads")); }
fn terminal_identity<H:Host>(host:&mut H) {
    let (_,backend)=compile(SOURCE);let mut d=host.open("identity",Some(backend)).unwrap();
    call(&mut d,json!({"op":"apply","first":true,"page":{"snapshot":true,"store_id":"A","generation":1,"events":[],"watermark":0,"more":false}}));
    let entry=json!({"id":"terminal","seq":1,"op":"attach","args":{},"viewer":"dev:alice","now":20,"upload":{"bytes":"ff","argument":"doc","file":{"type":"application/pdf","name":"a.pdf"},"store_id":"A"}});
    assert!(call(&mut d,json!({"op":"admit_upload","entry":entry})).get("denied").is_none());
    let write=json!({"id":"terminal","state":"failed","why":{"code":"E_UPLOAD_CANCELLED","family":"asset","message":"cancelled"}});
    call(&mut d,json!({"op":"keep_write","value":write.to_string()}));
    call(&mut d,json!({"op":"settle","id":"terminal"}));host.close("identity",d);
    let mut d=host.open("identity",None).unwrap();
    assert_eq!(call(&mut d,json!({"op":"admit_upload","entry":entry}))["ok"]["write"],write);
    assert_eq!(call(&mut d,json!({"op":"queued"}))["ok"],json!([]));
    let mut changed=entry.clone();changed["upload"]["bytes"]=json!("ee");
    assert_eq!(call(&mut d,json!({"op":"admit_upload","entry":changed}))["denied"]["code"],"E_WRITE_ID_REUSE");
    let ordinary=json!({"id":"ordinary","state":"sent","seq":1,"result":null});
    call(&mut d,json!({"op":"keep_write","value":ordinary.to_string()}));
    changed=entry;changed["id"]=json!("ordinary");
    assert_eq!(call(&mut d,json!({"op":"admit_upload","entry":changed}))["denied"]["code"],"E_WRITE_ID_REUSE");host.close("identity",d);
}
#[test] fn memory_terminal_identity(){terminal_identity(&mut Memory::new());}
#[test] fn sqlite_terminal_identity(){terminal_identity(&mut Sqlite::new("terminal"));}
