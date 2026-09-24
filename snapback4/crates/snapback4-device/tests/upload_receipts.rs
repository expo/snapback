mod common;
use common::{Host, Memory, Sqlite, compile, page_json, snapshot_pages};
use serde_json::json;
use snapback4_device::{call::call, store::DeviceStore};

fn forgetting_receipts<H: Host>(host: &mut H) {
    let (mut engine, backend) = compile("table photos:\n  photo: image <=100000\n  read <- allow\n  insert <- allow\n  sync public\nmutation photo(photo: image <=100000):\n  return insert photos { photo }\n");
    let mut device = host.open("receipts", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "alice", 10).iter().enumerate() {
        let applied = call(&mut device, json!({"op":"apply", "first":n == 0, "page":page_json(page)}));
        assert!(applied.get("denied").is_none(), "{applied}");
    }
    let facts = json!({"id":"image", "type":"image/png", "bytes":3, "width":1, "height":1, "duration":null});
    let key = |viewer: &str, id: &str| format!("device:upload:{}", json!([viewer, id]));
    for (viewer, id) in [("alice", "image"), ("bob", "image"), ("alice", "other")] {
        let mut receipt = facts.clone();
        receipt["id"] = json!(id);
        assert_eq!(call(&mut device, json!({"op":"upload_facts", "viewer":viewer, "asset":receipt})), json!({"ok":null}));
    }
    assert_eq!(device.store().meta(&key("alice", "image")).unwrap(), Some(facts.to_string()));
    let admit = |id: &str, seq| json!({"op":"admit", "entry":{"id":id, "seq":seq, "op":"photo", "args":{"photo":{"id":"image"}}, "viewer":"alice", "now":2, "predictable":true}});
    assert_eq!(call(&mut device, admit("before", 1))["ok"]["predictable"], true);
    assert_eq!(call(&mut device, json!({"op":"forget_upload_facts", "viewer":"alice", "id":"image"})), json!({"ok":null}));
    assert_eq!(device.store().meta(&key("alice", "image")).unwrap(), None);
    assert!(device.store().meta(&key("bob", "image")).unwrap().is_some());
    assert!(device.store().meta(&key("alice", "other")).unwrap().is_some());
    assert_eq!(call(&mut device, admit("after", 2))["ok"]["predictable"], false);
    host.close("receipts", device);
    let device = host.open("receipts", None).unwrap();
    assert_eq!(device.store().meta(&key("alice", "image")).unwrap(), None, "cleanup survives reopening");
    host.close("receipts", device);
}

#[test]
fn forgotten_upload_receipt_is_absent_and_cannot_predict_in_memory() {
    forgetting_receipts(&mut Memory::new());
}

#[test]
fn forgotten_upload_receipt_is_absent_and_cannot_predict_in_sqlite() {
    forgetting_receipts(&mut Sqlite::new("upload-receipts"));
}
