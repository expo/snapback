use crate::common::*;
use snapback4_core::Engine;
use snapback4_device::device::Backend;
#[path = "../../../snapback4-sim/tests/common/following_promotion.rs"]
mod case;

fn scenario<H: Host>(mut host: H, reader: &str, slots: usize) {
    let bound = case::app::built();
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    case::seed(&mut engine, reader, slots);
    let backend = Backend { generation: engine.generation(), schema: bound.schema, programs: bound.programs.into_iter().map(|p| p.program).collect() };
    let mut devices = Vec::new();
    for viewer in ["reader00", "reader01", "reader49", case::TRIGGER, case::AUTHOR, "unrelated"] {
        let mut device = host.open(viewer, Some(backend.clone())).unwrap();
        for (n, page) in snapshot_pages(&mut engine, viewer, 100).iter().enumerate() {
            assert!(page.events.iter().all(|e| e.table != "feedPullCounts"));
            device.apply(page, n == 0).unwrap();
        }
        devices.push((viewer, device));
    }
    let before = engine.seq().unwrap();
    if slots == 32 { case::refused(&mut engine); }
    else { case::promoted(&mut engine); }
    for (viewer, device) in &mut devices {
        let stream = stream_page(&mut engine, viewer, before);
        if slots == 32 { assert!(stream.events.is_empty(), "a refused promotion streams no partial routes or mode"); }
        device.apply(&stream, false).unwrap();
        let local = device.query("social.following", viewer, &serde_json::json!({}), 100).unwrap();
        assert!(local.complete);
        assert_eq!(local.data, case::app::query(&mut engine, viewer).data);
    }
    let before = engine.seq().unwrap();
    case::post(&mut engine, "new-post", 6);
    case::check_deliveries(&mut engine, slots < 32);
    for (viewer, device) in &mut devices {
        device.apply(&stream_page(&mut engine, viewer, before), false).unwrap();
        let local = device.query("social.following", viewer, &serde_json::json!({}), 100).unwrap();
        assert_eq!(case::posts(&local), if *viewer == "unrelated" || (*viewer == case::TRIGGER && slots == 32) { vec![] } else { vec!["new-post", "old-push"] });
        assert_eq!(local.data, case::app::query(&mut engine, viewer).data);
    }
    let before = engine.seq().unwrap();
    if slots == 32 {
        case::free_slot(&mut engine, reader);
        case::promoted(&mut engine);
        case::shared_follow_still_refuses(&mut engine, reader);
    }
    case::post(&mut engine, "after-retry", 8);
    for (viewer, mut device) in devices {
        let stream = stream_page(&mut engine, viewer, before);
        assert!(stream.events.iter().all(|e| e.table != "feedPullCounts"));
        assert!(stream.events.iter().filter(|e| e.table == "feedPulls" && e.data.is_some()).all(|e| e.data.as_ref().unwrap()["readerId"] == viewer));
        device.apply(&stream, false).unwrap();
        host.close(viewer, device);
        let mut device = host.open(viewer, None).unwrap();
        let local = device.query("social.following", viewer, &serde_json::json!({}), 100).unwrap();
        assert_eq!(case::posts(&local), if viewer == "unrelated" { vec![] } else { vec!["after-retry", "new-post", "old-push"] });
        assert_eq!(local.data, case::app::query(&mut engine, viewer).data);
        host.close(viewer, device);
    }
    println!("W11a store={} reader={reader} slots={slots} existing_followers=50 preserved_deliveries=50 partial_routes=0 recovered_posts=3", host.label());
}

#[test]
fn w11a_promotion_refusal_memory() { scenario(Memory::new(), "reader00", 32); }
#[test]
fn w11a_promotion_refusal_sqlite() { scenario(Sqlite::new("w11a-refusal"), "reader00", 32); }
#[test]
fn w11a_promotion_partial_routes_memory() { scenario(Memory::new(), "reader49", 32); }
#[test]
fn w11a_promotion_partial_routes_sqlite() { scenario(Sqlite::new("w11a-partial"), "reader49", 32); }
#[test]
fn w11a_promotion_free_slot_memory() { scenario(Memory::new(), "reader00", 31); }
#[test]
fn w11a_promotion_free_slot_sqlite() { scenario(Sqlite::new("w11a-free"), "reader00", 31); }
