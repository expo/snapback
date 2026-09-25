#[path = "read_through/review_cases.rs"]
mod cases;
use cases::{Backend, Outcome};
use snapback4_core::{
    Context, Engine, Program, Schema,
    engine::{WriteState, runner::Runner},
    meter::{Ceilings, Cut, Meter},
};
use snapback4_device::{
    memory::MemoryStore,
    store::{DeviceStore, DeviceTx},
};

struct Sqlite(Engine);
impl Backend for Sqlite {
    fn run(&mut self, op: &str, context: Context, ceilings: Ceilings) -> Outcome {
        self.0.set_ceilings(ceilings);
        if self.0.program(op).unwrap().kind == snapback4_core::ir::ProgramKind::Query {
            let o = self.0.query(op, context).unwrap();
            (Ok(o.data), o.metered)
        } else {
            let o = self.0.mutate(op, None, context).unwrap();
            (
                match o.state {
                    WriteState::Sent { result, .. } => Ok(result),
                    WriteState::Failed { why, .. } => Err(why),
                },
                o.metered,
            )
        }
    }
    fn adopt(&mut self, source: &str, now: i64) {
        let b = cases::bound(source);
        self.0
            .adopt_at(b.schema, b.programs.into_iter().map(|p| p.program), now)
            .unwrap();
    }
}
struct Memory {
    store: MemoryStore,
    schema: Schema,
    programs: std::collections::BTreeMap<String, Program>,
}
impl Backend for Memory {
    fn run(&mut self, op: &str, context: Context, ceilings: Ceilings) -> Outcome {
        let tx = self.store.transaction().unwrap();
        let mut runner = Runner::new(
            &tx,
            &self.schema,
            context,
            Meter::new(ceilings, Cut::Abort),
            0,
        );
        let result = runner.run(&self.programs[op]).map_err(|e| e.refusal());
        let metered = runner.metered();
        drop(runner);
        if result.is_ok() {
            tx.commit().unwrap();
        } else {
            tx.rollback().unwrap();
        }
        (result, metered)
    }
    fn adopt(&mut self, source: &str, now: i64) {
        let b = cases::bound(source);
        self.store
            .activate_server_at(b.schema.clone(), now)
            .unwrap();
        self.schema = b.schema;
        self.programs = b
            .programs
            .into_iter()
            .map(|p| (p.program.name.clone(), p.program))
            .collect();
    }
}
fn sqlite(source: &str) -> Box<dyn Backend> {
    let b = cases::bound(source);
    Box::new(Sqlite(
        Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap(),
    ))
}
fn memory(source: &str) -> Box<dyn Backend> {
    let mut m = Memory {
        store: MemoryStore::new(),
        schema: Schema::default(),
        programs: Default::default(),
    };
    m.adopt(source, 0);
    Box::new(m)
}
macro_rules! scenario {
    ($name:ident) => {
        #[test]
        fn $name() {
            for factory in [sqlite, memory] {
                cases::$name(factory);
            }
        }
    };
}
scenario!(aggregate_actual_row);
scenario!(aggregate_existence);
scenario!(expiry_default);
scenario!(reuse_refusal);
scenario!(delete_refusal);
scenario!(probe_meter_equivalence);
