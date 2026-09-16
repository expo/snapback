use crate::common::*;
use super::world;
#[path = "../../../snapback4-sim/tests/common/following_slots.rs"]
mod case;

fn scenario<H: Host>(mut host: H) {
    for at_cap in [true, false] {
        let (mut engine, mut backend) = compile(&world::source());
        case::seed(&mut engine, at_cap);
        backend.generation = engine.generation();
        let mut devices = Vec::new();
        for viewer in [case::READER, case::NEW_READER] {
            let name = format!("{at_cap}-{viewer}");
            let mut device = host.open(&name, Some(backend.clone())).unwrap();
            for (n, page) in snapshot_pages(&mut engine, viewer, 1000).iter().enumerate() {
                assert!(page.events.iter().all(|e| e.table != "pullCounts"));
                assert!(page.events.iter().filter(|e| e.table == "pulls").all(|e| e.data.as_ref().unwrap()["readerId"] == viewer));
                device.apply(page, n == 0).unwrap();
            }
            devices.push((viewer, name, device));
        }
        for (n, (op, viewer, author, used, total)) in case::steps(at_cap).into_iter().enumerate() {
            let device = &mut devices.iter_mut().find(|(who, _, _)| *who == viewer).unwrap().2;
            let queued = device.admit(serde_json::from_value(serde_json::json!({
                "id":format!("write-{at_cap}-{n}"), "seq":n + 1, "op":op, "viewer":viewer,
                "args":{"authorId":author}, "now":10, "predictable":true,
            })).unwrap()).unwrap();
            assert!(!queued.predictable && queued.predicted.is_empty());
            let before = engine.seq().unwrap();
            world::mutate(&mut engine, op, viewer, &[("authorId", id(author))], 10);
            case::counts(&engine, viewer, used, total);
            device.settle(&queued.id, Some(engine.seq().unwrap())).unwrap();
            for (who, _, device) in &mut devices {
                let stream = stream_page(&mut engine, who, before);
                assert!(stream.events.iter().all(|e| e.table != "pullCounts"));
                assert!(stream.events.iter().filter(|e| e.table == "pulls" && e.data.is_some()).all(|e| e.data.as_ref().unwrap()["readerId"] == *who));
                device.apply(&stream, false).unwrap();
                let local = device.query("following", who, &serde_json::json!({}), 10).unwrap();
                let online = engine.query("following", context(who, &[]).at(10)).unwrap();
                assert!(local.complete && online.complete);
                assert_eq!(local.data, online.data);
                if *who == viewer { assert_eq!(local.data.as_array().unwrap().len(), used.unwrap_or(0) as usize); }
            }
            println!("W7R2 host={} cap={at_cap} op={op} reader={viewer} routes={} count_rows={total} predicted_rows=0", host.label(), used.unwrap_or(0));
        }
        for (viewer, name, device) in devices {
            host.close(&name, device);
            let mut device = host.open(&name, None).unwrap();
            let local = device.query("following", viewer, &serde_json::json!({}), 10).unwrap();
            assert!(local.complete);
            assert_eq!(local.data, engine.query("following", context(viewer, &[]).at(10)).unwrap().data);
            host.close(&name, device);
        }
    }
}

#[test]
fn following_w7r2_slots_memory() { scenario(Memory::new()); }
#[test]
fn following_w7r2_slots_sqlite() { scenario(Sqlite::new("w7r2-slots")); }
