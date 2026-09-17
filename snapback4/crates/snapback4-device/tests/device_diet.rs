//! Admission policy witness on both device stores, plus retained partition accounting.
mod common;
use common::*;
use serde_json::{json, Value as Json};
use snapback4_core::{Ceilings, Context, Value};
use snapback4_core::ir::{Expr, Stmt};
use snapback4_device::{device::{Backend, Device}, memory::MemoryStore};
use std::collections::BTreeMap;

#[test]
fn structural_admission_stays_on_the_server_and_native_device() {
    let source = "query answer():\n  return 7\n";
    let (_, mut backend) = compile(source);
    let scan = snapback4_core::ir::Scan { site: "missing".into(), table: "missing".into(), index: "byId".into(), prefix: vec![], order: snapback4_core::ir::Order::Asc, take: snapback4_core::ir::Bound::Literal(1), after: None, before: None, range: None, filter: None, opaque_cursor: false, merge_site: None, provenance: snapback4_core::ir::KeyProvenance::Const };
    backend.programs[0].body.insert(0, Stmt::If { condition: Expr::Literal(Value::Bool(false)), then_body: vec![Stmt::Return(Expr::Scan(scan))], else_body: vec![] });
    let program = &backend.programs[0];
    assert_eq!(snapback4_core::engine::admission::check(&backend.schema, program).unwrap_err().code(), "E_UNBOUND_SCAN");
    assert_eq!(snapback4_core::engine::validate::validate_inputs(&backend.schema, program, &mut BTreeMap::new()).unwrap_err().code(), "E_UNBOUND_SCAN");
    for host in ["memory", "sqlite"] {
        let sqlite = Sqlite::new("diet-admission");
        let request = json!({"op":"query","name":"answer","viewer":"A","now":1});
        let reply = if host == "memory" {
            let mut device = Device::open_store(MemoryStore::new(), Some(backend.clone())).unwrap();
            snapback4_device::call::call(&mut device, request)
        } else {
            let mut device = Device::open(&sqlite.path("device"), Some(backend.clone())).unwrap();
            snapback4_device::call::call(&mut device, request)
        };
        // Restoring device admission under the check feature must fail this positive witness.
        if cfg!(feature = "web-device-check") { assert_eq!(reply["ok"]["data"], 7, "{reply}"); }
        else { assert_eq!(reply["ok"]["denied"]["code"], "E_UNBOUND_SCAN", "{reply}"); }
    }
}

#[test]
fn partition_accounting_keeps_the_step_refusal_boundary() {
    use snapback4_device::store::{DeviceStore, DeviceTx};
    let (_, backend) = compile("table notes:\n  n: int\n  public 'notes'\n  sync public\n  insert <- allow\nmutation add():\n  insert notes { n: 1 }\n");
    fn boundaries<S: DeviceStore>(mut store: S, backend: &Backend) -> Vec<Result<Json, snapback4_core::error::Refusal>> {
        store.install(&backend.schema, &BTreeMap::new(), false).unwrap();
        let mut records = Vec::new();
        for steps in 0..24 {
            let tx = store.transaction().unwrap();
            let outcome = snapback4_core::engine::local::predict(&tx, &backend.schema, &backend.programs[0], Context::new("A", BTreeMap::new()).at(1000).with_ids(["new-row".into()]), Ceilings { steps, ..Ceilings::default() });
            records.push(outcome.map(|prediction| json!({"result":prediction.result,"written":prediction.written,"read":prediction.read})).map_err(|error| error.refusal()));
            tx.rollback().unwrap();
        }
        records
    }
    let records = boundaries(snapback4_core::store::Store::memory().unwrap(), &backend);
    assert_eq!(records, boundaries(MemoryStore::new(), &backend));
    assert_eq!(records.iter().position(Result::is_ok), Some(11), "the discarded partition event still costs one step");
    assert!(records.iter().any(|outcome| outcome.as_ref().is_err_and(|why| why.code == "E_BOUND")), "{records:?}");
}
