//! LLP 3000.025: device custody without body execution and guarded query entries.
mod common;
use common::*;
use serde_json::json;
use snapback4_core::ir::ProgramKind;

fn refuses_before_body<H: Host>(host: &mut H) {
    let source = "table messages:\n  owner: principal\n  expiresAt: time ?\n  read <- .owner = viewer\n  expire at .expiresAt\n  sync to .owner\nmutation natural(): server\n  page = messages where .owner = viewer first 1 by .id\n  require false else BODY_RAN\n  return page\n";
    let (_, backend) = compile(source);
    for kind in [ProgramKind::Mutation, ProgramKind::Job] {
        for native in [false,true] {
            let mut backend=backend.clone();
            backend.programs[0].kind=kind;
            backend.programs[0].native=native;
            let mut device=host.open("entry",Some(backend)).unwrap();
            let result=device.query("natural","alice",&json!({}),2000);
            assert_eq!(result.unwrap_err().code,"E_OP","{kind:?} native={native}");
            // Runs before acquisition/coverage and before native dispatch too.
            host.close("entry",device);
        }
    }
}

#[test]
fn query_refuses_mutation_and_job_memory() { refuses_before_body(&mut Memory::new()); }
#[test]
fn query_refuses_mutation_and_job_native_store() { refuses_before_body(&mut Sqlite::new("er-query-entry")); }

#[path = "expiring_mutations/counted.rs"]
mod counted;
use counted::Counted;
use snapback4_core::{Schema, error::RuntimeError};
use snapback4_device::{device::{Device, Queued}, store::DeviceStore, memory::MemoryStore};
use std::{collections::BTreeMap, cell::RefCell, rc::Rc};

struct Borrowed<'a, S>(&'a mut S);
impl<S: DeviceStore> DeviceStore for Borrowed<'_, S> {
    type Tx<'a> = S::Tx<'a> where Self: 'a;
    fn install(&mut self, s: &Schema, m: &BTreeMap<String,String>, reset: bool) -> Result<(),RuntimeError> { self.0.install(s,m,reset) }
    fn install_checked(&mut self, s: &Schema, m: &BTreeMap<String,String>, reset: bool, expected: &BTreeMap<String,Option<String>>) -> Result<(),RuntimeError> { self.0.install_checked(s,m,reset,expected) }
    fn meta(&self, key: &str) -> Result<Option<String>,RuntimeError> { self.0.meta(key) }
    fn set_meta(&mut self, key: &str, value: &str) -> Result<(),RuntimeError> { self.0.set_meta(key,value) }
    fn transaction(&mut self) -> Result<Self::Tx<'_>,RuntimeError> { self.0.transaction() }
}

const SOURCE: &str = "table messages:\n  owner: principal\n  expiresAt: time ?\n  read <- .owner = viewer\n  expire at .expiresAt\n  sync to .owner\ntable marks:\n  value: int\n  read <- allow\n  insert <- allow\n  sync public\nmutation natural(): server\n  page = messages where .owner = viewer first 1 by .id\n  insert marks { value: count(page) }\n  return count(page)\n";

// A real admit must enter the predictor even when the caller claims eligibility.
// Count every store read/write attempt, including a scan that returns no rows.
fn admit_without_body<S: DeviceStore>(store: S, reopen: impl FnOnce(S) -> S) {
    let (mut server, backend) = compile(SOURCE);
    let visits = Rc::new(RefCell::new(BTreeMap::new()));
    let mut store = Counted { inner: store, visits: visits.clone() };
    let original;
    {
        let mut device = Device::open_store(Borrowed(&mut store), Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut server, "alice", 500).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        visits.borrow_mut().clear();
        let entry: Queued = serde_json::from_value(json!({"id":"expiry-intent","seq":1,"op":"natural","args":{},"viewer":"alice","now":2000,"predictable":true,"new_ids":["fixed-row"]})).unwrap();
        let queued = device.admit(entry).unwrap();
        assert!(!queued.predictable);
        assert!(queued.predicted.is_empty());
        assert!(queued.sent_seq.is_none());
        assert!(visits.borrow().is_empty(), "body accessed rows: {:?}", visits.borrow());
        original = serde_json::to_value(&queued).unwrap();
        assert_eq!(serde_json::to_value(device.queued().unwrap()).unwrap(), json!([original]));
    }
    // Memory serializes and reloads actual host commits; SQLite closes and reopens its file.
    store.inner = reopen(store.inner);
    {
        let mut device = Device::open_store(Borrowed(&mut store), None).unwrap();
        assert_eq!(serde_json::to_value(device.queued().unwrap()).unwrap(), json!([original]));
        for source in [format!("{SOURCE}\nquery added():\n  return 1\n"), SOURCE.replace("  read <- .owner = viewer", "  read <- deny").replace("  sync to .owner\n", "")] {
            let (_, mut next) = compile(&source);
            let before = device.state().unwrap().1;
            next.generation = server.adopt(next.schema.clone(), next.programs.clone()).unwrap();
            assert!(next.generation > before);
            let generation = next.generation;
            device.adopt(next).unwrap();
            assert_eq!(device.state().unwrap().1, generation);
            assert_eq!(serde_json::to_value(device.queued().unwrap()).unwrap(), json!([original]), "generation adoption changed pending identity");
        }
        device.withdraw(&[]).unwrap();
        assert_eq!(serde_json::to_value(device.queued().unwrap()).unwrap(), json!([original]));
        assert!(visits.borrow().is_empty(), "reopen/adoption/replay ran the body: {:?}", visits.borrow());
    }
}

#[test]
fn server_expiring_mutation_custody_memory() {
    admit_without_body(MemoryStore::new(), |store| {
        let mut reopened = MemoryStore::new();
        reopened.load(store.drain()).unwrap();
        reopened
    });
}
#[test]
fn server_expiring_mutation_custody_native() {
    let host = Sqlite::new("expiring-custody");
    let path = host.path("custody");
    drop(Device::open(&path, Some(compile(SOURCE).1)).unwrap());
    admit_without_body(snapback4_core::Store::open_shared(&path).unwrap(), |store| {
        drop(store);
        snapback4_core::Store::open_shared(&path).unwrap()
    });
}
