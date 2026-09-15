use super::*;
use snapback4_core::rows::Rows;
use snapback4_device::store::{DeviceStore, DeviceTx};
#[path = "../../../snapback4-sim/tests/common/point_read_cut.rs"]
mod case;
#[path = "../../../snapback4-sim/tests/common/rule_probe_cut.rs"]
mod rule_case;

fn check_rule_probes<S: DeviceStore>(mut store: S, host: &str, negated: bool) {
    for twice in [false, true] {
        let (_, backend) = compile(&rule_case::source(negated, twice));
        store.install(&backend.schema, &Default::default(), false).unwrap();
        let mut observations = Vec::new();
        for world in ["hidden", "absent", "visible"] {
            let tx = store.transaction().unwrap();
            // Adversarial stored online-only rows exercise authorization in
            // the shared interpreter; their coverage still requires a server.
            for (table, row) in rule_case::seed(world, negated) {
                tx.put(&table, &backend.schema.tables[&table], &row, None).unwrap();
            }
            observations.push(rule_case::check(host, world, twice, |name, ceilings| {
                let program = backend.programs.iter().find(|p| p.name == name).unwrap();
                snapback4_core::engine::local::query(&tx, &backend.schema, program, rule_case::context(name), ceilings)
            }));
            tx.rollback().unwrap();
        }
        assert_eq!(observations[0], observations[1], "hidden/absent: responses, meters, completeness, next and errors");
    }
}

#[test]
fn positive_rule_probe_cuts_memory() { check_rule_probes(snapback4_device::memory::MemoryStore::new(), "memory", false); }
#[test]
fn positive_rule_probe_cuts_sqlite() { check_rule_probes(snapback4_core::Store::memory().unwrap(), "sqlite", false); }
#[test]
fn negated_rule_probe_cuts_memory() { check_rule_probes(snapback4_device::memory::MemoryStore::new(), "memory", true); }
#[test]
fn negated_rule_probe_cuts_sqlite() { check_rule_probes(snapback4_core::Store::memory().unwrap(), "sqlite", true); }

fn check<S: DeviceStore>(mut store: S, host: &str) {
    let (_, backend) = compile(case::SOURCE);
    store.install(&backend.schema, &Default::default(), false).unwrap();
    let mut observations = Vec::new();
    for world in ["absent", "hidden", "visible"] {
        let tx = store.transaction().unwrap();
        for (table, row) in case::seed(world) {
            // Only rows in this viewer's partition reach either device.
            if row.field("owner").unwrap() == &Value::Id("dev:alice".into()) {
                tx.put(&table, &backend.schema.tables[&table], &row, None).unwrap();
            }
        }
        observations.push(case::check(host, world, |name, ceilings| {
            let program = backend.programs.iter().find(|p| p.name == name).unwrap();
            snapback4_core::engine::local::query(&tx, &backend.schema, program, case::context(name), ceilings).unwrap()
        }));
        tx.rollback().unwrap();
    }
    assert_eq!(observations[0], observations[1], "all response fields and all seven meter fields match");
}

#[test]
fn point_read_cuts_memory() { check(snapback4_device::memory::MemoryStore::new(), "memory"); }

#[test]
fn point_read_cuts_sqlite() { check(snapback4_core::Store::memory().unwrap(), "sqlite"); }

#[path = "../../../snapback4-core/tests/common/meter.rs"]
mod heap_case;

fn check_heap_cut<S: DeviceStore>(mut store: S, host: &str) {
    use snapback4_core::ir::{Expr, ProgramKind, Stmt};
    let schema = heap_case::schema();
    let program = heap_case::program("page", ProgramKind::Query, vec![Stmt::Return(Expr::Scan(heap_case::scan(2)))]);
    store.install(&schema, &Default::default(), false).unwrap();
    let tx = store.transaction().unwrap();
    for (table, row) in heap_case::rows(2) { tx.put(&table, &schema.tables[&table], &row, None).unwrap(); }
    let control = snapback4_core::engine::local::query(&tx, &schema, &program, heap_case::context(), Default::default()).unwrap();
    assert!(control.complete);
    assert_eq!(control.data.as_array().unwrap().len(), 2);
    let cut = snapback4_core::engine::local::query(&tx, &schema, &program, heap_case::context(), snapback4_core::Ceilings { examined: 1, heap_bytes: 100, ..Default::default() });
    println!("HEAP_AFTER_EXAMINED host={host} rows=2 body_bytes=4000 examined=1 heap_bytes=100 result={cut:?}");
    let cut = cut.unwrap();
    assert_eq!(cut.data, Value::Null);
    assert!(!cut.complete);
    assert!(cut.next.is_none());
    assert_eq!(cut.capped_at.as_ref().map(|cut| cut.0), Some(snapback4_core::error::MeterKind::Examined));
    assert_eq!(cut.metered.examined, 2);
    assert!(cut.metered.heap_bytes > 100);
    tx.rollback().unwrap();
}

#[test]
fn heap_cut_after_examined_cut_memory() { check_heap_cut(snapback4_device::memory::MemoryStore::new(), "memory"); }
#[test]
fn heap_cut_after_examined_cut_sqlite() { check_heap_cut(snapback4_core::Store::memory().unwrap(), "sqlite"); }
