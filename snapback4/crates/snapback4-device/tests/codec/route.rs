//! Included only in the library's cfg(test) build; no route hook ships.
use super::*;

fn routes<S: DeviceStore>(store: S) {
    let backend = Backend { generation: 1, schema: Default::default(), programs: vec![] };
    let mut device = Device::open_store(store, Some(backend)).unwrap();
    for op in ["apply", "observe_store"] {
        for (fields, expected) in [("", 0), ("\"watermark\":99,", 1)] {
            let request = format!(r#"{{"op":"{op}","first":true,"page":{{{fields}"snapshot":true,"events":[],"watermark":1,"more":false,"generation":1}}}}"#);
            PAGE_CALLS.set(0); OWNED_FALLBACKS.set(0); OWNED_CONVERSIONS.set(0);
            let answer = call_text(&mut device, &request);
            assert!(answer.get("ok").is_some(), "{answer}");
            assert_eq!(PAGE_CALLS.get(), 1, "page_call must execute: {request}");
            assert_eq!(OWNED_FALLBACKS.get(), expected, "{request}");
            assert_eq!(OWNED_CONVERSIONS.get(), expected, "owned-value conversion cost: {request}");
        }
    }
    assert_eq!(device.state().unwrap().0, 1);
}

#[test]
fn page_route_and_duplicate_fallback_on_memory() { routes(crate::memory::MemoryStore::new()); }

#[cfg(feature = "native")]
#[test]
fn page_route_and_duplicate_fallback_on_sqlite() {
    let dir = std::env::temp_dir().join(format!("sb4-codec-route-{}-{}", std::process::id(), snapback4_core::now_ms()));
    std::fs::create_dir(&dir).unwrap();
    routes(crate::sqlite::open(&dir.join("route.sqlite")).unwrap());
    std::fs::remove_dir_all(dir).unwrap();
}
