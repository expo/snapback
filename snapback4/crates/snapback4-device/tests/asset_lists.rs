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
            if nested {
                let items = flat.as_array().unwrap();
                if items.len() == 2 { json!([[items[0]], [items[1]]]) } else { json!([[], items]) }
            } else { flat }
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
        h.close(kind,d);
        let mut d=h.open(kind,None).unwrap();
        for id in ["a","b"] { assert_eq!(home(&mut d,id,1)["row"],"post","moved between inner lists across reopen {kind}"); }
        apply(&mut d,"put",row(cell(&["b"])),false);
        h.close(kind,d);
        let mut d=h.open(kind,None).unwrap();
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

fn upgrade<H: Host>(h: &mut H) {
    for (kind, cell) in [("image <=100 ?", facts("a")), ("[image <=100] <=4 ?", json!([facts("a")]))] {
        for left in [false, true] {
            let name = format!("upgrade-{kind}-{left}");
            let (_, backend) = compile(&(source(kind) + "table notes:\n  owner: principal\n  body: text\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  sync to .owner\nmutation note(body: text):\n  return insert notes { owner: viewer, body }\n"));
            let mut d = h.open(&name, Some(backend)).unwrap();
            apply(&mut d, "put", row(cell.clone()), true);
            if left { apply(&mut d, "scope", json!(["alice"]), false); }
            let queued = d.admit(serde_json::from_value(json!({"id":"queued", "seq":0, "op":"note", "args":{"body":"offline"}, "viewer":"alice", "now":1, "predictable":true, "new_ids":["note"]})).unwrap()).unwrap();
            let before = d.sync_state_read().unwrap();
            assert!(before.acquired);
            // Exact legacy media metadata shape; keep rows, acquisition, watermark
            // and a live predicted outbox entry intact in the persisted device.
            h.close(&name, d);
            let old_home = (!left && !kind.starts_with('[')).then(|| json!({"table":"posts","row":"post","column":"photos","generation":before.generation}).to_string());
            h.patch_meta(&name, &[("device:media-index-format", None), ("device:media-row:[\"posts\",\"post\"]", None), ("device:media:a", old_home)]);
            let mut d = h.open(&name, None).unwrap();
            let upgraded = d.sync_state_read().unwrap();
            assert!(!upgraded.acquired);
            assert_eq!(upgraded.watermark, before.watermark, "retain the restore floor");
            assert_eq!(upgraded.restore_watermark, before.watermark);
            assert_eq!(upgraded.transfer_watermark, 0, "request a normal snapshot");
            assert_eq!(d.queued().unwrap(), vec![queued.clone()]);
            assert_eq!(home(&mut d, "a", 1), Json::Null, "retained rows cannot fabricate acquisition");
            let events = if left { json!([]) } else { json!([{"table":"posts","id":"post","kind":"put","data":row(cell.clone())}]) };
            let first: StreamPage = serde_json::from_value(json!({"snapshot":true,"store_id":"media-store","generation":before.generation,"watermark":before.watermark,"more":true,"next":"next","events":events})).unwrap();
            d.apply(&first, true).unwrap();
            assert_eq!(home(&mut d, "a", 1), Json::Null, "a private page grants no home");
            h.close(&name, d);
            let mut d = h.open(&name, None).unwrap();
            assert_eq!(d.sync_state_read().unwrap().transfer_watermark, 0, "restart interrupted upgrade");
            d.apply(&first, true).unwrap();
            let terminal: StreamPage = serde_json::from_value(json!({"snapshot":true,"store_id":"media-store","generation":before.generation,"watermark":before.watermark,"after":"next","more":false,"stage_snapshot":true,"events":[]})).unwrap();
            d.apply(&terminal, false).unwrap();
            assert_eq!(home(&mut d, "a", 1), Json::Null, "wait for normal catch-up publication");
            assert!(!d.sync_state_read().unwrap().acquired, "terminal snapshot is not publication");
            assert_eq!(d.store().meta("device:media-index-format").unwrap(), None);
            h.close(&name, d);
            let mut d = h.open(&name, None).unwrap();
            let interrupted = d.sync_state_read().unwrap();
            assert!(!interrupted.acquired);
            assert_eq!(interrupted.transfer_watermark, 0, "restart after terminal snapshot");
            assert_eq!(d.store().meta("device:media-index-format").unwrap(), None);
            assert_eq!(d.queued().unwrap(), vec![queued.clone()]);
            d.apply(&first, true).unwrap();
            d.apply(&terminal, false).unwrap();
            let catchup: StreamPage = serde_json::from_value(json!({"snapshot":false,"snapshot_catchup":true,"store_id":"media-store","generation":before.generation,"watermark":before.watermark,"requested_watermark":before.watermark,"more":false,"events":[]})).unwrap();
            d.apply(&catchup, false).unwrap();
            assert_eq!(d.queued().unwrap(), vec![queued]);
            assert_eq!(home(&mut d, "a", 1).is_null(), left, "only reacquired rows get markers");
            if left { assert_eq!(d.query("post", "alice", &json!({"id":"post"}), 1).unwrap().data.field("id").unwrap().as_str().unwrap(), "post"); }
            h.close(&name, d);
            let mut d = h.open(&name, None).unwrap();
            let state = d.sync_state_read().unwrap();
            assert!(state.acquired);
            assert_eq!(d.store().meta("device:media-index-format").unwrap().as_deref(), Some("1"));
            assert_eq!(state.watermark, before.watermark);
            assert_eq!(state.transfer_watermark, before.watermark, "upgrade runs once");
            assert_eq!(home(&mut d, "a", 1).is_null(), left);
            h.close(&name, d);
        }
    }
}
#[test] fn media_upgrade_memory() { upgrade(&mut Memory::new()); }
#[test] fn media_upgrade_sqlite() { upgrade(&mut Sqlite::new("media-upgrade")); }

fn column_home<H: Host>(h: &mut H) {
    let (_, backend) = compile(&source("image <=100 ?").replace("  secrets:", "  refs: [image <=100] <=4 ?\n  secrets:"));
    let mut d = h.open("column-home", Some(backend)).unwrap();
    let mut data = row(facts("a"));
    data["refs"] = json!([facts("a")]);
    apply(&mut d, "put", data.clone(), true);
    assert_eq!(home(&mut d, "a", 1)["column"], "photos");
    // The HTTP test proves this update releases the server ledger, although
    // the same row still carries a legacy copy in another ordinary column.
    data["photos"] = Json::Null;
    apply(&mut d, "put", data, false);
    assert_eq!(home(&mut d, "a", 1), Json::Null);
    h.close("column-home", d);
    let mut d = h.open("column-home", None).unwrap();
    assert_eq!(home(&mut d, "a", 1), Json::Null);
    h.close("column-home", d);
}
#[test] fn exact_media_column_memory() { column_home(&mut Memory::new()); }
#[test] fn exact_media_column_sqlite() { column_home(&mut Sqlite::new("column-home")); }

fn upgrade_restore<H: Host>(h: &mut H) {
    for (published, restored_head, events) in [(5000, 100, json!([])), (12, 7, json!([{ "table":"posts", "id":"post", "kind":"put", "data":row(json!([facts("a")])) }]))] {
        let name = format!("upgrade-restore-{published}");
        let (_, backend) = compile(&source("[image <=100] <=4 ?"));
        let mut d = h.open(&name, Some(backend)).unwrap();
        let initial: StreamPage = serde_json::from_value(json!({"snapshot":true,"store_id":"media-store","generation":d.backend().generation,"watermark":published,"more":false,"events":[]})).unwrap();
        d.observe_store(&initial).unwrap();
        d.apply(&initial, true).unwrap();
        h.close(&name, d);
        h.patch_meta(&name, &[("device:media-index-format", None)]);
        let mut d = h.open(&name, None).unwrap();
        let state = d.sync_state_read().unwrap();
        assert_eq!(state.transfer_watermark, 0);
        assert!(!state.acquired);
        // Grok's first page has neither terminality nor images_at as a head proof.
        let restored: StreamPage = serde_json::from_value(json!({"snapshot":true,"store_id":"media-store","generation":state.generation,"watermark":restored_head,"more":true,"next":"next","events":events,"requested_watermark":0,"captured_restore_watermark":published,"captured_watermark":published})).unwrap();
        assert_eq!(d.observe_store(&restored).unwrap_err().refusal().code, "E_STORE_RESTORE");
        assert_eq!(d.sync_state_read().unwrap().restore_refusal.unwrap().code, "E_STORE_RESTORE");
        h.close(&name, d);
        let mut d = h.open(&name, None).unwrap();
        let state = d.sync_state_read().unwrap();
        assert_eq!(state.watermark, published);
        assert_eq!(state.restore_refusal.unwrap().code, "E_STORE_RESTORE", "halt survives reopen");
        h.close(&name, d);
    }
}
#[test] fn media_upgrade_restore_memory() { upgrade_restore(&mut Memory::new()); }
#[test] fn media_upgrade_restore_sqlite() { upgrade_restore(&mut Sqlite::new("media-upgrade-restore")); }

// @ref LLP 3000.019#3.5 — B's publication can overtake A's pinned continuation.
fn overtaken_snapshot<H: Host>(h: &mut H) {
    for terminal in [false, true] {
        let name = format!("overtaken-{terminal}");
        let schema = "table notes:\n  body: text\n  public 'snapshot owners'\n  sync\nquery all():\n  return notes first 10 by byId\n";
        let (mut engine, backend) = compile(schema);
        engine.seed((0..4).map(|n| ("notes".into(), snapback4_core::value::object([
            ("id", id(&format!("n{n}"))), ("body", snapback4_core::value::Value::String("before".into()))
        ])))).unwrap();
        let store_id = engine.store().meta("store_id").unwrap().unwrap();
        let pages = snapshot_pages(&mut engine, "alice", 1);
        let mut first = pages[0].clone();
        first.store_id = Some(store_id.clone());
        assert_eq!(first.watermark, 1);
        assert!(first.more);
        let after = first.next.clone().unwrap();
        let mut a = h.open(&name, Some(backend.clone())).unwrap();
        a.apply(&first, true).unwrap();
        assert!(!a.sync_state_read().unwrap().acquired);
        // Persist A's staging, then let B publish to the same named device.
        // Memory owners exchange commits through their persistence host.
        h.close(&name, a);
        engine.seed([("notes".into(), snapback4_core::value::object([
            ("id", id("new")), ("body", snapback4_core::value::Value::String("after".into()))
        ]))]).unwrap();
        let mut b = h.open(&name, None).unwrap();
        for (n, mut page) in snapshot_pages(&mut engine, "alice", 100).into_iter().enumerate() {
            page.store_id = Some(store_id.clone());
            b.apply(&page, n == 0).unwrap();
        }
        assert_eq!(b.sync_state_read().unwrap().watermark, 2);
        assert!(b.sync_state_read().unwrap().acquired);
        h.close(&name, b);
        let mut a = h.open(&name, None).unwrap();
        let capture = a.sync_state().unwrap();
        assert_eq!(capture.watermark, 2, "capture happens AFTER B published");
        let page = engine.snapshot_acquisition_page_at("alice", Some(&after), if terminal { 100 } else { 1 }, 1).unwrap();
        assert_eq!(page.watermark, 1, "the real server continuation pins A's first cut");
        assert_eq!(page.next.is_none(), terminal);
        let continuation: StreamPage = serde_json::from_value(json!({
            "snapshot":true, "after":after, "store_id":store_id, "generation":backend.generation,
            "watermark":page.watermark, "more":page.next.is_some(), "next":page.next.map(|c| c.encode()),
            "events":page.events.iter().map(|e| json!({"table":e.table,"id":e.id,"kind":e.kind.word(),"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),
            "requested_watermark":0, "captured_watermark":capture.watermark,
            "captured_restore_watermark":capture.restore_watermark, "captured_restore_images_at":capture.restore_images_at,
            "send_revision":capture.send_revision
        })).unwrap();
        assert_eq!(a.observe_store(&continuation).unwrap_err().refusal().code, "E_GENERATION");
        assert_eq!(a.apply(&continuation, false).unwrap_err().refusal().code, "E_GENERATION");
        let state = a.sync_state_read().unwrap();
        assert_eq!(state.watermark, 2);
        assert!(state.restore_refusal.is_none());
        assert!(state.acquired);
        assert_eq!(a.query("all", "alice", &json!({}), 1).unwrap().data.as_array().unwrap().len(), 5);
        h.close(&name, a);
        let mut reopened = h.open(&name, None).unwrap();
        assert!(reopened.sync_state_read().unwrap().restore_refusal.is_none(), "no durable halt");
        assert_eq!(reopened.query("all", "alice", &json!({}), 1).unwrap().data.as_array().unwrap().len(), 5);
        let healthy = stream_page(&mut engine, "alice", 2);
        reopened.apply(&healthy, false).unwrap();
        h.close(&name, reopened);
    }
}
#[test] fn overtaken_snapshot_memory() { overtaken_snapshot(&mut Memory::new()); }
#[test] fn overtaken_snapshot_sqlite() { overtaken_snapshot(&mut Sqlite::new("overtaken-snapshot")); }
