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
fn expiring_aggregate_authorization_is_key_determined() {
    let model = include_str!("read_through/lifetime.q");
    for model in [
        model.to_owned(),
        model.replace("read through .parent", "read <- allow"),
        model.replacen("  expire at .until\n  read through", "  read through", 1),
    ] {
        for cap in ["", "\n  cap 4 by parent"] {
            for rule in [".value = 2", ".value != 1", ".value = .value"] {
                let source = format!(
                    "{}\nview totals: count children by .parent\n  read <- {rule}\nquery total(p: parents):\n  return totals[p]\n",
                    model.replace("immutable parent", &format!("immutable parent{cap}"))
                );
                assert_expiring_rule_refused(&source, rule);
                assert_expiring_rule_refused(
                    &source.replace(
                        &format!("  read <- {rule}\nquery"),
                        &format!("  online only\n  read <- {rule}\nquery"),
                    ),
                    rule,
                );
            }
        }
    }
    let source = format!(
        "{model}\nview totals: count children by .parent\n  read <- .parent = .parent\nquery total(p: parents):\n  return totals[p]\n"
    );
    let mut b = cases::bound(&source);
    b.schema.tables.get_mut("totals").unwrap().rules.read = snapback4_core::schema::RuleExpr::Eq(
        snapback4_core::schema::RuleTerm::Field("value".into()),
        snapback4_core::schema::RuleTerm::Literal(snapback4_core::Value::Int(2)),
    );
    assert!(
        snapback4_core::schema::validate(&b.schema)
            .iter()
            .any(|issue| issue.message.contains("expiring aggregate authorization")),
        "raw schema callers obey the same restriction"
    );
}

fn assert_expiring_rule_refused(source: &str, rule: &str) {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    let d = b
        .diagnostics
        .iter()
        .find(|d| d.code == "E_MAINTAIN_READ_EXPIRE")
        .expect("expiring value authorization must refuse regardless of caps");
    assert!(d.site.line > 1 && d.message.contains("group keys"), "{d:?}");
    cases::bound(&source.replace(&format!("read <- {rule}"), &d.rewrite));
}

#[test]
fn stored_total_page_authorization_is_refused() {
    let source = format!(
        "{}\nview totals: count children by .parent\n  read <- .value = 2\nmutation setup():\n  insert parents {{ id: 'p', owner: viewer, until: null }}\n  insert children {{ id: 'a', parent: 'p', body: 'one', until: null }}\n  insert children {{ id: 'b', parent: 'p', body: 'two', until: 150 }}\nquery pageTotals(p: parents):\n  return totals where .parent = p first 10\n",
        include_str!("read_through/lifetime.q")
            .replace("immutable parent", "immutable parent\n  cap 4 by parent")
    );
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(
        b.diagnostics
            .iter()
            .any(|d| d.code == "E_MAINTAIN_READ_EXPIRE"),
        "{:?}",
        b.diagnostics
    );
}

#[test]
fn signed_sum_overflow_before_authorization_is_refused() {
    let model = include_str!("read_through/lifetime.q").replace(
        "  body: text <=100",
        "  n: int default 0\n  cap 4 by parent\n  body: text <=100",
    );
    let source = format!(
        "{model}\nview totals: sum children of .n by .parent\n  read <- .value = 2\nmutation setup():\n  insert parents {{ id: 'p', owner: viewer, until: null }}\n  insert children {{ id: 'a', parent: 'p', body: '', n: 9007199254740991, until: null }}\n  insert children {{ id: 'b', parent: 'p', body: '', n: -9007199254740991, until: 150 }}\n  insert children {{ id: 'c', parent: 'p', body: '', n: 9007199254740991, until: null }}\nquery total(p: parents):\n  return totals[p]\n"
    );
    assert_expiring_rule_refused(&source, ".value = 2");
}

#[test]
fn explicit_parent_key_aggregate_scans_are_refused() {
    let source = format!(
        "{}\nview totals: count children by .parent\n  read <- .parent = .parent\nquery totalsPage(p: parents):\n  return totals where .parent = p first 10\n",
        include_str!("read_through/lifetime.q")
    );
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(
        b.diagnostics
            .iter()
            .any(|d| d.code == "E_READ_THROUGH_SCAN"),
        "{:?}",
        b.diagnostics
    );
}

#[test]
fn a_non_expiring_aggregate_needs_no_recount_cap() {
    let source = include_str!("read_through/lifetime.q").replace("  expire at .until\n", "");
    cases::bound(&format!(
        "{source}\nview totals: count children by .parent\n  read <- .value = 2\nquery total(p: parents):\n  return totals[p]\n"
    ));
}

scenario!(aggregate_sequential_reads);
scenario!(aggregate_multi_batch);
