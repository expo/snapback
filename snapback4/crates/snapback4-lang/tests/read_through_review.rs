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
            assert!(o.complete && !o.unavailable, "{op}: {o:?}");
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
    fn query(
        &mut self,
        op: &str,
        context: Context,
        ceilings: Ceilings,
    ) -> Option<snapback4_core::engine::QueryOutcome> {
        self.0.set_ceilings(ceilings);
        Some(self.0.query(op, context).unwrap())
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

scenario!(aggregate_denial_work);
scenario!(aggregate_denial_dependencies);

#[test]
fn aggregate_authorization_requires_a_physical_recount_bound() {
    let model = include_str!("read_through/lifetime.q");
    let tail = "\nview totals: count children by .parent\n  read <- .value = 2\nquery total(p: parents):\n  return totals[p]\n";
    for cap in ["", "\n  cap 4 by body"] {
        let source = format!(
            "{}{tail}",
            model.replace("immutable parent", &format!("immutable parent{cap}"))
        );
        let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
        let d = b
            .diagnostics
            .iter()
            .find(|d| d.code == "E_MAINTAIN_READ_BOUND")
            .expect("an unpinned source cap cannot bound the recount");
        assert!(d.message.contains("cap 100 by parent"), "{d:?}");
    }
    let source = format!(
        "{}{tail}",
        model.replace("immutable parent", "immutable parent\n  cap 4 by parent")
    );
    let mut b = cases::bound(&source);
    b.schema
        .tables
        .get_mut("children")
        .unwrap()
        .constraints
        .retain(|c| !matches!(c, snapback4_core::schema::Constraint::Cap { .. }));
    assert!(
        snapback4_core::schema::validate(&b.schema)
            .iter()
            .any(|issue| issue
                .message
                .contains("value-dependent aggregate authorization")),
        "raw schema callers cannot bypass the bound"
    );
    cases::bound(&format!(
        "{model}{}",
        tail.replace(".value = 2", ".parent = .parent")
    ));
}

#[test]
fn a_non_expiring_aggregate_needs_no_recount_cap() {
    let source = include_str!("read_through/lifetime.q").replace("  expire at .until\n", "");
    cases::bound(&format!(
        "{source}\nview totals: count children by .parent\n  read <- .value = 2\nquery total(p: parents):\n  return totals[p]\n"
    ));
}
