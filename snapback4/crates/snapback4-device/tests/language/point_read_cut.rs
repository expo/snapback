use super::*;
use snapback4_core::rows::Rows;
use snapback4_device::store::{DeviceStore, DeviceTx};
#[path = "../../../snapback4-sim/tests/common/point_read_cut.rs"]
mod case;

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
