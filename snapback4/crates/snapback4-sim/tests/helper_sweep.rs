//! A helper's recipient-local loops must stay inside the outer durable sweep.
use snapback4_core::{Engine, JobState, Value, value::object};
use std::collections::BTreeMap;

const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/qe/helper-sweep.q");

#[test]
fn helper_and_inline_digest_emit_the_same_effects_across_chunks() {
    let inline = SOURCE.replace("    n = unreadFor(p)", "    n = 0\n    for m in members where .principal = p.principal:\n      n = n + m.unread");
    let mut results = Vec::new();
    for source in [SOURCE, &inline] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        let mut seed = Vec::new();
        let mut expected = BTreeMap::new();
        for i in 0..130 {
            let principal = Value::Id(format!("reader{i:03}"));
            seed.push(("profiles".into(), object([("id", Value::Id(format!("p{i:03}"))), ("principal", principal.clone())])));
            let total = if i % 5 == 0 { 0 } else { 3 * (i + 1) };
            if total > 0 { expected.insert(format!("reader{i:03}"), Value::Int(total)); }
            for j in 0..3 {
                seed.push(("members".into(), object([
                    ("id", Value::Id(format!("m{i:03}-{j}"))), ("principal", principal.clone()),
                    ("chat", Value::String(format!("chat{j}"))), ("unread", Value::Int(total / 3)),
                ])));
            }
        }
        engine.seed(seed).unwrap();
        let id = engine.enqueue_job("digest", Default::default(), 1).unwrap();
        let first = engine.run_job_chunk(1).unwrap().unwrap();
        assert_eq!(first.state, JobState::Running, "{first:?}");
        assert_eq!(first.chunks, 1);
        let initial_effects = engine.effects(None, 200).unwrap().len();
        assert!(initial_effects > 0 && initial_effects < expected.len());
        while engine.run_job_chunk(2).unwrap().is_some() {}
        let run = engine.jobs(10).unwrap().into_iter().find(|run| run.id == id).unwrap();
        assert_eq!(run.state, JobState::Done, "{run:?}");
        assert!(run.chunks > 1, "{run:?}");
        let effects = engine.effects(None, 200).unwrap();
        assert_eq!(effects.len(), expected.len());
        let actual: BTreeMap<_, _> = effects.iter().map(|effect| {
            assert_eq!(effect.effect, "notify");
            let Value::Id(target) = effect.payload.field("target").unwrap() else { panic!("{effect:?}") };
            (target.clone(), effect.payload.field("unread").unwrap().clone())
        }).collect();
        assert_eq!(actual, expected);
        results.push(effects.into_iter().map(|e| e.payload).collect::<Vec<_>>());
    }
    assert_eq!(results[0], results[1]);
}
