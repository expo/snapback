//! File assets on the device (LLP 3000.038): an upload receipt predicts an
//! id-only `file` argument with the server's facts, a receipt of another
//! kind never predicts, and retained files keep their filename on the home.
mod common;
use common::{Host, Memory, Sqlite, compile, page_json, snapshot_pages};
use serde_json::{Value as Json, json};
use snapback4_device::call::call;

const SOURCE: &str = "table docs:\n  owner: principal\n  doc: file <=100000 ('application/pdf', 'text/plain') ?\n  photo: image <=100000 ?\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  sync to .owner\nmutation attach(doc: file <=100000 ('application/pdf', 'text/plain')):\n  require doc.name != '' else UNNAMED\n  return insert docs { owner: viewer, doc }\n";

fn receipts<H: Host>(host: &mut H) {
    let (mut engine, backend) = compile(SOURCE);
    let mut device = host.open("files", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "dev:alice", 10).iter().enumerate() {
        let applied = call(&mut device, json!({"op":"apply", "first":n == 0, "page":page_json(page)}));
        assert!(applied.get("denied").is_none(), "{applied}");
    }
    let pdf = engine.store_file("dev:alice", b"%PDF-1.7\n%%EOF\n", Some("application/pdf"), "lab results.pdf", 1).unwrap();
    let facts = snapback4_core::wire::to_json(&pdf.column_value());
    assert_eq!(facts, json!({"id":pdf.id, "type":"application/pdf", "bytes":15, "name":"lab results.pdf"}));
    assert_eq!(call(&mut device, json!({"op":"upload_facts", "viewer":"dev:alice", "asset":facts})), json!({"ok":null}));
    host.close("files", device);
    let mut device = host.open("files", None).unwrap();
    // Forged facts are replaced by the receipt's.
    let forged = call(&mut device, json!({"op":"predict", "name":"attach", "viewer":"dev:alice", "args":{"doc":{"id":pdf.id, "name":"evil.html", "type":"text/html"}}, "now":2, "entropy":41}));
    assert_eq!(forged["ok"]["result"]["doc"]["name"], "lab results.pdf", "{forged}");
    assert_eq!(forged["ok"]["result"]["doc"]["type"], "application/pdf");
    call(&mut device, json!({"op":"withdraw", "predicted":forged["ok"]["predicted"]}));
    let admit = |id: &str, seq: u64, asset: &str| json!({"op":"admit", "entry":{"id":id, "seq":seq, "op":"attach", "args":{"doc":{"id":asset}}, "viewer":"dev:alice", "now":2, "predictable":true}});
    assert_eq!(call(&mut device, admit("file", 1, &pdf.id))["ok"]["predictable"], true);
    // An image receipt never predicts a file argument: the server refuses the kind.
    let png = engine.store_asset("dev:alice", b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01", 3).unwrap();
    call(&mut device, json!({"op":"upload_facts", "viewer":"dev:alice", "asset":snapback4_core::wire::to_json(&png.column_value())}));
    assert_eq!(call(&mut device, admit("image", 2, &png.id))["ok"]["predictable"], false);
    host.close("files", device);
}

#[test]
fn file_receipts_predict_with_server_facts_in_memory() { receipts(&mut Memory::new()); }
#[test]
fn file_receipts_predict_with_server_facts_in_sqlite() { receipts(&mut Sqlite::new("file-receipts")); }

fn homes<H: Host>(host: &mut H) {
    let (_, backend) = compile(SOURCE);
    let generation = backend.generation;
    let mut device = host.open("file-homes", Some(backend)).unwrap();
    let doc = json!({"id":"doc", "type":"application/pdf", "bytes":15, "name":"contract.pdf"});
    let put = |data: Json, watermark: u64, first: bool| json!({"op":"apply", "first":first, "page":{"snapshot":first, "store_id":"file-store", "events":[{"table":"docs", "id":"home", "kind":"put", "data":data}], "watermark":watermark, "more":false, "generation":generation}});
    assert!(call(&mut device, put(json!({"id":"home", "owner":"dev:alice", "doc":doc}), 1, true)).get("denied").is_none());
    let home = json!({"op":"asset_home", "home":{"store_id":"file-store", "table":"docs", "row":"home", "column":"doc"}, "id":"doc", "viewer":"dev:alice", "now":1});
    let retained = call(&mut device, home.clone());
    assert_eq!((retained["ok"]["row"].clone(), retained["ok"]["type"].clone(), retained["ok"]["name"].clone()), (json!("home"), json!("application/pdf"), json!("contract.pdf")), "{retained}");
    // Clearing the cell retires the retained file, as for an image.
    call(&mut device, put(json!({"id":"home", "owner":"dev:alice", "doc":null}), 2, false));
    assert_eq!(call(&mut device, home)["ok"], Json::Null);
    host.close("file-homes", device);
}

#[test]
fn retained_file_homes_carry_the_name_in_memory() { homes(&mut Memory::new()); }
#[test]
fn retained_file_homes_carry_the_name_in_sqlite() { homes(&mut Sqlite::new("file-homes")); }
