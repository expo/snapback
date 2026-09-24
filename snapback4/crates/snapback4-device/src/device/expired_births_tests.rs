//! Born-expired writes release server capacity without manufacturing device
//! occupancy. Both adapters keep deferral through settlement and reopening.
use super::*;
use snapback4_core::{Engine, WriteState};
use serde_json::json;

fn counts<S: DeviceStore>(device: &mut Device<S>, all: u64, a: u64, b: u64) {
    let tx = device.store.transaction().unwrap();
    assert_eq!(tx.cap_count("items", &[], &[]).unwrap(), all);
    for (group, n) in [("a", a), ("b", b), ("c", 0)] {
        assert_eq!(tx.cap_count("items", &["group".into()], &[Value::String(group.into())]).unwrap(), n);
    }
    assert!(tx.get("items", "born").unwrap().is_none());
    tx.rollback().unwrap();
}

fn retired_birth<S: DeviceStore>(store: S) {
    let source = include_str!("../../../snapback4-core/tests/fixtures/expired-birth-cap.q");
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut server = Engine::memory(b.schema.clone(), b.programs.iter().map(|p| p.program.clone())).unwrap();
    let backend = Backend { generation: server.generation(), schema: b.schema, programs: b.programs.into_iter().map(|p| p.program).collect() };
    let mut device = Device::open_store(store, Some(backend)).unwrap();
    let snapshot = server.snapshot_acquisition_page_at("alice", None, 100, 100).unwrap();
    let page = decoded(&json!({"snapshot":true, "watermark":snapshot.watermark, "more":false,
        "generation":server.generation(), "held":snapshot.held, "acquisitions":snapshot.acquisitions, "events":[]}).to_string()).unwrap();
    device.apply(&page, true).unwrap();
    let mut previous = (0, 0, 0);
    for (id, group, until, all, a, b, succeeds) in [
        ("born", "a", Value::Int(0), 0, 0, 0, true),
        ("live", "a", Value::Null, 1, 1, 0, true),
        ("group-full", "a", Value::Null, 1, 1, 0, false),
        ("other", "b", Value::Null, 2, 1, 1, true),
        ("table-full", "c", Value::Null, 2, 1, 1, false),
    ] {
        let args = json!({"id":id, "group":group, "until":wire::to_json(&until)});
        let entry: Queued = decoded(&json!({"id":id,"seq":0,"op":"add","args":args,
            "viewer":"alice","now":100,"predictable":true}).to_string()).unwrap();
        let admitted = device.admit(entry).unwrap();
        assert!(!admitted.predictable && admitted.predicted.is_empty(), "{admitted:?}");
        counts(&mut device, previous.0, previous.1, previous.2);
        device = Device::open_store(device.store, None).unwrap();
        assert_eq!(device.queued().unwrap(), [admitted]);
        let out = server.mutate("add", Some(id), Context::new("alice", BTreeMap::from([
            ("id".into(), Value::Id(id.into())), ("group".into(), Value::String(group.into())), ("until".into(), until),
        ])).at(100)).unwrap();
        let seq = if succeeds {
            let WriteState::Sent { seq, .. } = out.state else { panic!("{out:?}") };
            Some(seq)
        } else {
            assert!(matches!(out.state, WriteState::Failed { ref why, .. } if why.code == "E_CONSTRAINT"), "{out:?}");
            None
        };
        let tx = server.store_mut().transaction().unwrap();
        assert_eq!(tx.cap_count("items", &[], &[]).unwrap(), all);
        assert!(tx.get("items", "born").unwrap().is_none());
        tx.rollback().unwrap();
        device.settle(id, seq).unwrap();
        let from = device.state().unwrap().0;
        let page = server.stream_at("alice", from, 100, 100).unwrap();
        assert!(page.events.iter().all(|e| e.id != "born"), "retirement withdraws all born-row events");
        let page: StreamPage = decoded(&json!({"snapshot":false,"requested_watermark":from,
            "images_at":page.images_at,"joined":page.joined,"acquisitions":page.acquisitions,
            "watermark":page.watermark,"more":page.more,"generation":server.generation(),
            "events":page.events.iter().map(|e| json!({"table":e.table,"kind":e.kind,"id":e.id,
                "data":e.data.as_ref().map(wire::to_json)})).collect::<Vec<_>>()}).to_string()).unwrap();
        device.apply(&page, false).unwrap();
        counts(&mut device, all, a, b);
        device = Device::open_store(device.store, None).unwrap();
        counts(&mut device, all, a, b);
        assert!(device.queued().unwrap().is_empty());
        previous = (all, a, b);
    }
    assert_eq!(server.sweep_expired(100, 2_000).unwrap(), 0);
}

#[test]
fn retired_birth_keeps_memory_device_caps_exact() {
    retired_birth(crate::memory::MemoryStore::new());
}

#[test]
fn retired_birth_keeps_sqlite_device_caps_exact() {
    publication_tests::with_sqlite(retired_birth);
}
