//! File assets (LLP 3000.038): a third kind beside image and video, with a
//! per-column allow-list, the same one-home and read-rule contract, and
//! declared-plus-sniffed verification.
use snapback4_core::assets::AssetKind;
use snapback4_core::{Context, Engine, Value, WriteState};
use std::collections::BTreeMap;

const SOURCE: &str = r#"
use server
table receipts:
  owner: principal
  scan: file <=1000 ('application/pdf', 'image/png') ?
  notes: file <=100 ?
  attachments: [file <=1000] <=3 ?
  photo: image <=1000 ?
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
mutation file(scan: file <=1000 ('application/pdf', 'image/png')):
  require scan.bytes > 0 and scan.name != '' else EMPTY
  return insert receipts { owner: viewer, scan }
mutation note(notes: file <=100):
  return insert receipts { owner: viewer, notes }
mutation attach(attachments: [file <=1000] <=3):
  return insert receipts { owner: viewer, attachments }
mutation photo(photo: image <=1000):
  return insert receipts { owner: viewer, photo }
mutation clear(receipt: receipts):
  update receipts[receipt] { scan: null }
mutation remove(receipt: receipts):
  delete receipts[receipt]
query mine():
  receipts where .owner = viewer first 10 by .id { id, scanName: .scan.name, scanType: .scan.type, scanBytes: .scan.bytes }
"#;

const PDF: &[u8] = b"%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF\n";
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01";

fn engine() -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}
fn handle(id: &str) -> Value { Value::Map(BTreeMap::from([("id".into(), Value::Id(id.into()))]).into()) }
fn mutate(e: &mut Engine, op: &str, args: Vec<(&str, Value)>, at: i64) -> WriteState {
    let args: BTreeMap<String, Value> = args.into_iter().map(|(k, v)| (k.into(), v)).collect();
    e.mutate(op, None, Context::new("alice", args).with_ids([format!("{op}-{at}")]).at(at)).unwrap().state
}
fn sent(state: &WriteState) -> Value {
    match state { WriteState::Sent { result, .. } => result.clone(), other => panic!("{other:?}") }
}
fn refused(state: &WriteState) -> String {
    match state { WriteState::Failed { why, .. } => why.code.clone(), other => panic!("expected a refusal, got {other:?}") }
}

#[test]
fn a_placed_file_carries_the_servers_facts_and_name() {
    let mut e = engine();
    let asset = e.store_file("alice", PDF, Some("application/pdf"), "../Receipts/March\u{202E}fdp.exe", 0).unwrap();
    assert_eq!((asset.kind, asset.content_type.as_str(), asset.name.as_deref()), (AssetKind::File, "application/pdf", Some("Marchfdp.exe")));
    // Client-supplied facts never survive placement.
    let mut forged = BTreeMap::from([("id".to_owned(), Value::Id(asset.id.clone()))]);
    forged.insert("name".into(), Value::String("evil.html".into()));
    forged.insert("type".into(), Value::String("text/html".into()));
    let state = mutate(&mut e, "file", vec![("scan", Value::Map(forged.into()))], 1);
    let row = sent(&state);
    let scan = row.field("scan").unwrap();
    assert_eq!(scan.field("name").unwrap(), &Value::String("Marchfdp.exe".into()));
    assert_eq!(scan.field("type").unwrap(), &Value::String("application/pdf".into()));
    assert_eq!(scan.field("bytes").unwrap(), &Value::Int(PDF.len() as i64));
    assert!(scan.field("width").is_err(), "a file has no media facts: {scan:?}");
    let read = e.query("mine", Context::new("alice", BTreeMap::new()).at(2)).unwrap();
    let first = &read.data.as_array().unwrap()[0];
    assert_eq!(first.field("scanName").unwrap(), &Value::String("Marchfdp.exe".into()));
    // Served to the home row's readers only, as an attachment-kind grant.
    let grant = e.asset_access("alice", &asset.id, 3).unwrap();
    assert_eq!((grant.kind, grant.name.as_deref(), grant.once), (AssetKind::File, Some("Marchfdp.exe"), false));
    assert_eq!(e.asset_access("bob", &asset.id, 3).unwrap_err().code(), "E_ASSET_UNKNOWN");
}

#[test]
fn placement_checks_the_allow_list_kind_and_bound() {
    let mut e = engine();
    // A text file is admitted (the default-list column takes text) but the pdf/png column refuses it.
    let text = e.store_file("alice", b"plain words", Some("text/plain"), "notes.txt", 0).unwrap();
    assert_eq!(refused(&mutate(&mut e, "file", vec![("scan", handle(&text.id))], 1)), "E_ASSET_TYPE");
    sent(&mutate(&mut e, "note", vec![("notes", handle(&text.id))], 2));
    // An image upload is not a file, and a file is not an image.
    let image = e.store_asset("alice", PNG, 3).unwrap();
    assert_eq!(refused(&mutate(&mut e, "file", vec![("scan", handle(&image.id))], 4)), "E_ASSET_TYPE");
    let png_file = e.store_file("alice", PNG, Some("image/png"), "scan.png", 5).unwrap();
    assert_eq!(refused(&mutate(&mut e, "photo", vec![("photo", handle(&png_file.id))], 6)), "E_ASSET_TYPE");
    sent(&mutate(&mut e, "file", vec![("scan", handle(&png_file.id))], 7));
    // A file over the column's bound but within another column's.
    let big = e.store_file("alice", &[b"a".repeat(500), b"\n".to_vec()].concat(), Some("text/plain"), "big.txt", 8).unwrap();
    assert_eq!(refused(&mutate(&mut e, "note", vec![("notes", handle(&big.id))], 9)), "E_ASSET_TOO_LARGE");
    sent(&mutate(&mut e, "attach", vec![("attachments", Value::Array(vec![handle(&big.id)]))], 10));
}

#[test]
fn admission_refuses_types_no_column_accepts_spoofs_and_oversize() {
    let mut e = engine();
    let code = |result: Result<snapback4_core::assets::Asset, snapback4_core::RuntimeError>| result.unwrap_err().refusal().code;
    assert_eq!(code(e.store_file("alice", b"<html><script>alert(1)</script></html>", Some("text/html"), "x.html", 0)), "E_ASSET_TYPE");
    assert_eq!(code(e.store_file("alice", b"<svg onload=alert(1)/>", Some("image/svg+xml"), "x.svg", 0)), "E_ASSET_TYPE");
    // A spoofed PDF: declared application/pdf, the bytes are HTML.
    assert_eq!(code(e.store_file("alice", b"<html></html>", Some("application/pdf"), "x.pdf", 0)), "E_ASSET_TYPE");
    // GIF is verifiable, but no column here accepts it... except the default-list columns, which do.
    assert!(e.store_file("alice", b"GIF89a....", Some("image/gif"), "a.gif", 0).is_ok());
    assert_eq!(code(e.store_file("alice", &vec![b'a'; 1001], Some("text/plain"), "x.txt", 0)), "E_ASSET_TOO_LARGE");
    // Without a declaration a PDF is named by its magic number; text is never guessed.
    assert_eq!(e.store_file("alice", PDF, None, "", 0).unwrap().name.as_deref(), Some("file"));
    assert_eq!(code(e.store_file("alice", b"words", None, "w.txt", 0)), "E_ASSET_TYPE");
}

#[test]
fn a_narrow_schema_refuses_types_outside_every_list() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), "use server\ntable docs:\n  doc: file <=1000 ('application/pdf')\n  read <- allow\n  insert <- allow\n".into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut e = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(e.file_upload_ceiling(), Some(1000));
    let error = e.store_file("alice", b"a,b\n", Some("text/csv"), "t.csv", 0).unwrap_err().refusal();
    assert_eq!(error.code, "E_ASSET_TYPE");
    assert!(error.message.contains("application/pdf"), "{}", error.message);
}

#[test]
fn clearing_or_deleting_the_home_stops_serving_and_the_sweep_removes_bytes() {
    let mut e = engine();
    let a = e.store_file("alice", PDF, Some("application/pdf"), "a.pdf", 0).unwrap();
    let row = sent(&mutate(&mut e, "file", vec![("scan", handle(&a.id))], 1));
    let id = row.field("id").unwrap().clone();
    assert!(e.asset_access("alice", &a.id, 2).is_ok());
    sent(&mutate(&mut e, "clear", vec![("receipt", id.clone())], 3));
    assert_eq!(e.asset_access("alice", &a.id, 4).unwrap_err().code(), "E_ASSET_UNKNOWN");
    let path = e.store().asset_path(&a.id);
    assert!(e.sweep_assets(5).unwrap() >= 1);
    assert!(!path.exists(), "released file bytes are swept");
    let b = e.store_file("alice", PDF, Some("application/pdf"), "b.pdf", 6).unwrap();
    let row = sent(&mutate(&mut e, "file", vec![("scan", handle(&b.id))], 7));
    sent(&mutate(&mut e, "remove", vec![("receipt", row.field("id").unwrap().clone())], 8));
    assert_eq!(e.asset_access("alice", &b.id, 9).unwrap_err().code(), "E_ASSET_UNKNOWN");
    // An unplaced upload is the uploader's preview, then swept after the grace period.
    let c = e.store_file("alice", PDF, Some("application/pdf"), "c.pdf", 10).unwrap();
    assert_eq!(e.asset_access("alice", &c.id, 11).unwrap().name.as_deref(), Some("c.pdf"));
    assert_eq!(e.asset_access("bob", &c.id, 11).unwrap_err().code(), "E_ASSET_UNKNOWN");
    let path = e.store().asset_path(&c.id);
    e.sweep_assets(10 + snapback4_core::assets::UNCLAIMED_TTL_MS + 1).unwrap();
    assert!(!path.exists());
}

#[test]
fn the_ledger_keeps_the_name_across_reopen_and_older_stores_gain_the_column() {
    use snapback4_core::Store;
    let dir = std::env::temp_dir().join(format!("sb4-file-assets-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("store.db");
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    {
        // A store from before file assets has no `name` column on its ledger.
        let e = Engine::new(Store::open(&path).unwrap(), bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
        e.store().conn().execute_batch("ALTER TABLE _assets DROP COLUMN name;").unwrap();
    }
    let id = {
        let mut e = Engine::open(Store::open(&path).unwrap()).unwrap();
        e.store_file("alice", PDF, Some("application/pdf"), "kept.pdf", 0).unwrap().id
    };
    let e = Engine::open(Store::open(&path).unwrap()).unwrap();
    let asset = e.store().asset(&id).unwrap().unwrap();
    assert_eq!((asset.kind, asset.name.as_deref()), (AssetKind::File, Some("kept.pdf")));
    drop(e);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn shared_immutable_evidence_refs_preserve_home_authorization_and_lifetime() {
    // Execute the actual published recipe; snapshots carry row refs, not second asset placements.
    let guide = include_str!("../../snapback4-lang/src/guide/asset_sharing.md");
    let source = guide.split("```quarry\n").nth(1).unwrap().split("```").next().unwrap();
    let source = source.replace("  update <- viewer = 'service:scanner'", "  update <- viewer = 'service:scanner'\n  delete <- viewer = 'service:scanner'") + "\nmutation removeSnapshot(snapshot: snapshots):\n  delete snapshots[snapshot]\nmutation removeEvidence(source: evidence):\n  delete evidence[source]\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut e = Engine::memory(bound.schema, bound.programs.into_iter().map(|p|p.program)).unwrap();
    let upload = e.store_file("alice", PDF, Some("application/pdf"), "evidence.pdf", 0).unwrap();
    let write = |e: &mut Engine, viewer: &str, op: &str, arg: &str, value: Value, id: &str, at: i64| {
        e.mutate(op, None, Context::new(viewer, BTreeMap::from([(arg.into(), value)])).with_ids([id.to_owned()]).at(at)).unwrap().state
    };
    let home = sent(&write(&mut e, "alice", "captureEvidence", "document", handle(&upload.id), "home", 1));
    let id = home.field("id").unwrap().clone();
    assert!(e.asset_access("alice", &upload.id, 2).is_ok());
    assert!(e.asset_access("service:scanner", &upload.id, 2).is_ok());
    assert_eq!(e.asset_access("bob", &upload.id, 2).unwrap_err().code(), "E_ASSET_UNKNOWN");
    assert_eq!(refused(&write(&mut e,"alice","shareSnapshot","source",id.clone(),"pending",3)),"NOT_SCANNED");
    assert_eq!(refused(&write(&mut e,"bob","approveScan","source",id.clone(),"forged",4)),"NOT_SCANNER");
    sent(&write(&mut e,"service:scanner","approveScan","source",id.clone(),"clean",5));
    assert!(e.asset_access("bob", &upload.id, 6).is_ok());
    let snapshot = sent(&write(&mut e,"alice","shareSnapshot","source",id.clone(),"snapshot-a",7));
    sent(&write(&mut e,"bob","shareSnapshot","source",id.clone(),"snapshot-b",8));
    sent(&write(&mut e,"alice","removeSnapshot","snapshot",snapshot.field("id").unwrap().clone(),"remove-ref",9));
    assert!(e.asset_access("bob", &upload.id, 10).is_ok(), "deleting a ref cannot release its home");
    assert_eq!(refused(&write(&mut e,"alice","captureEvidence","document",handle(&upload.id),"duplicate",11)),"E_ASSET_PLACED");
    sent(&write(&mut e,"service:scanner","removeEvidence","source",id,"remove-home",12));
    assert_eq!(e.asset_access("bob", &upload.id, 13).unwrap_err().code(), "E_ASSET_UNKNOWN", "remaining refs cannot grant bytes after home deletion");
}
