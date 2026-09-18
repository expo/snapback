use crate::common::*;
use snapback4_core::{Context, Value, engine::QueryOutcome, error::Refusal};
use snapback4_device::device::Backend;

type Query<'a> = dyn FnMut(&str, Context) -> Result<QueryOutcome, Refusal> + 'a;

fn fixture<H: Host>(host: &mut H, source: &str, rows: Vec<(String, Value)>, check: impl Fn(&mut Query<'_>)) {
    let bound = memory::cases::compile(source);
    let mut engine = snapback4_core::Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    engine.seed(rows).unwrap();
    let backend = Backend { generation: engine.generation(), schema: bound.schema, programs: bound.programs.into_iter().map(|p| p.program).collect() };
    let mut device = host.open("row-preserving", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "dev:alice", 1000).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    check(&mut |name, context| {
        let args = context.args.iter().map(|(key, value)| (key.clone(), snapback4_core::wire::to_json(value))).collect::<serde_json::Map<_, _>>();
        device.query(name, "dev:alice", &serde_json::Value::Object(args), context.now.unwrap())
    });
    host.close("row-preserving", device);
}

mod memory {
    use super::*;
    const DEVICE: bool = true;
    fn with_fixture(source: &str, rows: Vec<(String, Value)>, check: impl Fn(&mut Query<'_>)) { fixture(&mut Memory::new(), source, rows, check); }
    pub(super) mod cases { include!("../../../snapback4-sim/tests/common/row_preserving_pages.rs"); }
}

mod sqlite {
    use super::*;
    const DEVICE: bool = true;
    fn with_fixture(source: &str, rows: Vec<(String, Value)>, check: impl Fn(&mut Query<'_>)) { fixture(&mut Sqlite::new("row-preserving"), source, rows, check); }
    mod cases { include!("../../../snapback4-sim/tests/common/row_preserving_pages.rs"); }
}
