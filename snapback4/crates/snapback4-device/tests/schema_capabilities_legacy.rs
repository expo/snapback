mod common;
use serde_json::json;
use snapback4_device::{call, device::{Backend, Device}, store::DeviceStore, memory::MemoryStore};
use snapback4_core::{schema::Schema, error::RuntimeError};
use std::{cell::Cell, collections::BTreeMap};

const LEGACY: &str = include_str!("../../snapback4-core/tests/fixtures/legacy-recorded-timeline-backend.json");

struct Borrowed<'a, S>(&'a mut S, &'a Cell<usize>);
impl<S: DeviceStore> DeviceStore for Borrowed<'_, S> {
    type Tx<'a> = S::Tx<'a> where Self: 'a;
    fn install(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool) -> Result<(), RuntimeError> {
        self.0.install(schema, metadata, reset)
    }
    fn install_checked(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool, expected: &BTreeMap<String, Option<String>>) -> Result<(), RuntimeError> {
        self.0.install_checked(schema, metadata, reset, expected)
    }
    fn meta(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        if key == "device:backend" { self.1.set(self.1.get() + 1); }
        self.0.meta(key)
    }
    fn set_meta(&mut self, key: &str, value: &str) -> Result<(), RuntimeError> { self.0.set_meta(key, value) }
    fn transaction(&mut self) -> Result<Self::Tx<'_>, RuntimeError> { self.0.transaction() }
}

fn reopen<S: DeviceStore>(mut store: S, reload: impl Fn(S) -> S) {
    let backend: Backend = serde_json::from_str(LEGACY).unwrap();
    let reads = Cell::new(0);
    for (seq, mode) in ["kept", "explicit", "initial"].into_iter().enumerate() {
        let mut device = Device::open_store(Borrowed(&mut store, &reads), Some(backend.clone())).unwrap();
        // Keep a row and a queued write across the opening so accepting a
        // schema by silently resetting its replica cannot satisfy this test.
        let reply = call::call(&mut device, json!({"op":"apply", "first":true, "page": {
            "snapshot":true, "watermark":7, "more":false, "generation":1,
            "events":[{"kind":"put", "table":"posts", "id":"post", "data":{
                "id":"post", "authorId":"dev:alice", "at":1000, "removed":false
            }}]
        }}));
        assert!(reply.get("ok").is_some(), "{reply}");
        let reply = call::call(&mut device, json!({"op":"enqueue", "entry": {
            "id":mode, "seq":seq + 1, "op":"like", "args":{"postId":"post"}, "new_ids":[format!("like-{mode}")]
        }}));
        assert!(reply.get("ok").is_some(), "{reply}");
        // The bytes were emitted by e91f60c7f8, before Capabilities existed.
        let queue = call::call(&mut device, json!({"op":"queued"}));
        drop(device);
        store.set_meta("device:backend", LEGACY).unwrap();
        store = reload(store);
        reads.set(0);
        let borrowed = Borrowed(&mut store, &reads);
        let mut device = match mode {
            "explicit" => Device::open_store(borrowed, Some(backend.clone())).unwrap(),
            "initial" => {
                let mut replacement = backend.clone(); replacement.generation = 2;
                Device::open_store_initial(borrowed, replacement).unwrap()
            }
            _ => Device::open_store(borrowed, None).unwrap(),
        };
        assert_eq!(reads.get(), 1, "{mode}: capability validation reuses the opening's backend read");
        assert_eq!(device.state().unwrap(), (7, 1));
        assert_eq!(call::call(&mut device, json!({"op":"queued"})), queue);
        let rows = device.query("posts", "dev:alice", &json!({}), 2000).unwrap();
        assert_eq!(rows.data.as_array().unwrap().len(), 1);
        assert_eq!(rows.data.as_array().unwrap()[0].field("id").unwrap().as_str().unwrap(), "post");
        let emitted = device.store().meta("device:backend").unwrap().unwrap();
        assert!(!emitted.contains("Recorded"));
        assert_eq!(emitted.matches("Capabilities").count(), 1);
        let canonical: Backend = serde_json::from_str(&emitted).unwrap();
        assert_eq!(canonical.schema.required_capabilities(), ["recorded-attribution".into(), "timeline".into()].into());
    }
}

#[test]
fn legacy_recorded_and_timeline_reopens_memory() {
    reopen(MemoryStore::new(), |store| {
        let mut reopened = MemoryStore::new();
        reopened.load(store.export()).unwrap();
        reopened
    });
}

#[test]
fn legacy_recorded_and_timeline_reopens_sqlite() {
    let host = common::Sqlite::new("legacy-f2-f3");
    let path = host.path("device");
    let backend: Backend = serde_json::from_str(LEGACY).unwrap();
    drop(snapback4_device::native::Device::open(&path, Some(backend)).unwrap());
    reopen(snapback4_core::store::Store::open(&path).unwrap(), |store| {
        drop(store);
        snapback4_core::store::Store::open(&path).unwrap()
    });
}
