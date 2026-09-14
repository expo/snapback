use snapback4_core::{Ceilings, Context, Engine, Value, WriteState};
use super::cases::PICK;

#[test]
fn early_helper_return_preserves_baseline_guards_and_charges() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), PICK.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let program = &bound.programs[0].program;
    let golden = include_str!("pick.json").trim();
    let actual = serde_json::to_string(program).unwrap();
    let mut measurements = Vec::new();
    for stop in [false, true] {
        for steps in [28, 34, 100] {
            let mut engine = Engine::memory(bound.schema.clone(), [program.clone()]).unwrap();
            engine.set_ceilings(Ceilings { steps, ..Ceilings::default() });
            let outcome = engine.mutate("probe", None, Context::new("A", [("stop".into(), Value::Bool(stop))].into()).at(1000)).unwrap();
            println!("pick stop={stop} ceiling={steps}: {}", serde_json::to_string(&outcome).unwrap());
            if steps == 100 { assert!(matches!(outcome.state, WriteState::Sent { .. })); }
            measurements.push(outcome);
        }
    }
    assert_eq!(actual, golden, "helper-return lowering must see separate setup statements");
    assert_eq!(measurements[2].metered.steps, 34);
}

#[test]
fn helper_setup_ownership_survives_early_return_guards() {
    for call in ["  ignored = ping(p, stop)", "  emit notify { sent: ping(p, stop) }", "  if ping(p, stop):\n    emit notify { sent: true }"] {
        let source = format!("effect notify\nfn ping(p: principal, stop: bool):\n  if stop:\n    return true\n  if p != viewer and not exists connected[p]:\n    emit notify {{ absent: not exists connected[p] or false }}\n  return true\nmutation probe(p: principal, stop: bool):\n{call}\n  return null\n");
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let fact = &bound.schema.operations["probe"];
        assert_eq!(fact.predicts.as_deref(), Some("eligible"), "{call}: {fact:?}");
        assert!(fact.connected_effects_only);
        assert!(!fact.prediction_guards.is_empty());
        // A prediction plan always names an actual baseline If, including
        // guards below the extra :then introduced by helper-return lowering.
        for site in &fact.prediction_guards {
            let mut parts = site.split(':');
            assert_eq!(parts.next(), Some("probe"));
            let mut body = &bound.programs[0].program.body;
            let mut statement: Option<&snapback4_core::ir::Stmt> = None;
            for part in parts {
                match part {
                    "then" | "else" => {
                        let Some(snapback4_core::ir::Stmt::If { then_body, else_body, .. }) = statement else { panic!("{site}") };
                        body = if part == "then" { then_body } else { else_body };
                    }
                    index => { statement = body.get(index.parse::<usize>().unwrap() - 1); }
                }
            }
            assert!(matches!(statement, Some(snapback4_core::ir::Stmt::If { .. })), "{site}");
        }
    }
}
