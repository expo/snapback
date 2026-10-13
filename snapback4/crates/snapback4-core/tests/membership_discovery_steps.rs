use snapback4_core::{Ceilings, Context, Engine, Value, value::object};
use std::collections::BTreeMap;

const SOURCE: &str = "table page_members:
  parent: text <=40
  principal: principal
  unique parent, principal
  read <- .principal = viewer
  online only
table page_docs:
  owner: principal
  parent: text <=40
  at: int
  read <- .owner = viewer or exists page_members[.parent, viewer]
  online only
query page_docs(c: cursor ?):
  return page_docs last 10 by .at after c
";

fn value(value: &str) -> Value {
    Value::String(value.into())
}

fn id(value: &str) -> Value {
    Value::Id(value.into())
}

fn context() -> Context {
    Context::new("alice", BTreeMap::from([("c".into(), Value::Null)])).at(1)
}

fn engine(discovery_filter: bool) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:#?}", bound.diagnostics);
    let mut programs: Vec<_> = bound.programs.into_iter().map(|program| program.program).collect();
    let program = programs.iter_mut().find(|program| program.name == "page_docs").unwrap();
    if discovery_filter {
        let snapback4_core::ir::Stmt::Return(snapback4_core::ir::Expr::Merge(merge)) = &mut program.body[0] else { panic!("compiled membership merge") };
        let lane = merge.lanes.iter_mut().find(|lane| lane.membership()).unwrap();
        let snapback4_core::ir::LaneSource::Scan(source) = lane.source.as_mut().unwrap() else { panic!("scan discovery") };
        // The binder currently folds this plan's author equalities into the
        // source prefix. Keep a semantics-neutral residual filter here so the
        // executor regression independently crosses its expression boundary.
        source.filter = Some(Box::new(snapback4_core::ir::Expr::Literal(Value::Bool(true))));
    }
    assert!(snapback4_core::ir::body_merges(&program.body).iter().any(|merge| merge.lanes.iter().any(|lane| lane.membership())));
    let mut engine = Engine::memory(bound.schema, programs).unwrap();
    engine.seed_at([
        ("page_members".into(), object([("id", id("member")), ("parent", value("shared")), ("principal", id("alice"))])),
        ("page_docs".into(), object([("id", id("shared")), ("owner", id("bob")), ("parent", value("shared")), ("at", Value::Int(1))])),
    ], 1).unwrap();
    engine
}

// @ref LLP 3000.036.001#15 — membership discovery is all-or-nothing under every step cut.
#[test]
fn membership_discovery_step_sweep_never_refuses_or_publishes_a_partial_source() {
    let complete = engine(true).query("page_docs", context()).unwrap();
    assert!(complete.complete, "{complete:?}");
    assert_eq!(complete.data.as_array().unwrap().len(), 1);

    // 2..=3 crosses initial evaluated lane/source prefixes. After the
    // ordinary cursor expression at step 4, 5..=18 crosses source scan and
    // filter work, distinct evaluation, and the dynamic target prefix.
    for steps in (2..=3).chain(5..=18) {
        let mut engine = engine(true);
        engine.set_ceilings(Ceilings { steps, ..Ceilings::default() });
        let answer = engine.query("page_docs", context()).unwrap_or_else(|refusal| {
            panic!("step ceiling {steps} escaped the discovery fence: {refusal:?}")
        });
        assert!(!answer.complete && !answer.unavailable, "step ceiling {steps}: {answer:?}");
        assert_eq!(answer.data, Value::Array(Vec::new()), "step ceiling {steps}: {answer:?}");
        assert!(answer.next.is_none(), "step ceiling {steps}: {answer:?}");
        assert_eq!(answer.capped_at.as_ref().map(|cut| cut.0), Some(snapback4_core::MeterKind::Steps));
    }
}
