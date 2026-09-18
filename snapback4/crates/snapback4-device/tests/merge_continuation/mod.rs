use snapback4_core::{Context, Value, engine::{QueryOutcome, local}, error::Refusal, rows::Rows};
use snapback4_device::store::{DeviceStore, DeviceTx};

type Query<'a> = dyn FnMut(&str, Context) -> Result<QueryOutcome, Refusal> + 'a;

fn fixture<S: DeviceStore>(mut store: S, source: &str, rows: Vec<(String, Value)>, check: impl Fn(&mut Query<'_>)) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    store.install(&bound.schema, &Default::default(), false).unwrap();
    let tx = store.transaction().unwrap();
    for (table, row) in rows { tx.put(&table, &bound.schema.tables[&table], &row, None).unwrap(); }
    check(&mut |name, context| {
        let program = &bound.programs.iter().find(|p| p.program.name == name).unwrap().program;
        local::query(&tx, &bound.schema, program, context, Default::default())
    });
    tx.rollback().unwrap();
}

mod memory {
    use super::*;
    const DEVICE: bool = true;
    fn with_fixture(source: &str, rows: Vec<(String, Value)>, check: impl Fn(&mut Query<'_>)) {
        fixture(snapback4_device::memory::MemoryStore::new(), source, rows, check);
    }
    mod cases { include!("../../../snapback4-sim/tests/common/merge_continuation.rs"); }
    mod shape_pages { include!("../../../snapback4-sim/tests/common/shape_pages.rs"); }
}

mod sqlite {
    use super::*;
    const DEVICE: bool = true;
    fn with_fixture(source: &str, rows: Vec<(String, Value)>, check: impl Fn(&mut Query<'_>)) {
        fixture(snapback4_core::Store::memory().unwrap(), source, rows, check);
    }
    mod cases { include!("../../../snapback4-sim/tests/common/merge_continuation.rs"); }
    mod shape_pages { include!("../../../snapback4-sim/tests/common/shape_pages.rs"); }
}
