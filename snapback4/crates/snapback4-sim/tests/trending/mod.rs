use super::{args, id, row};
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_core::engine::job::JobState;

const DAY: i64 = 86_400_000;
const PERIOD: i64 = 60_000;

fn recipe() -> String {
    snapback4_lang::guide::quarry(snapback4_lang::guide::card("feeds").unwrap()).into_iter()
        .find(|source| source.contains("job scoreTrending():")).expect("the feeds card needs the scheduled Trending recipe")
}

fn engine() -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), recipe())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    for op in ["create", "like", "unlike"] { assert_eq!(bound.schema.operations[op].predicts.as_deref(), Some("eligible")); }
    assert!(!recipe().contains("update <- allow"));
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}

fn post(name: &str, at: i64) -> (String, Value) {
    ("posts".into(), row(&[("id", id(name)), ("authorId", id("alice")), ("body", Value::String(name.into())), ("at", Value::Int(at))]))
}

fn rank(engine: &mut Engine, now: i64) -> Vec<Value> {
    let mut rows = Vec::new();
    let mut cursor = Value::Null;
    loop {
        let page = engine.query("trending", Context::new("bob", args(&[("c", cursor)])).at(now)).unwrap();
        assert!(page.complete, "{page:?}");
        rows.extend(page.data.as_array().unwrap().iter().cloned());
        match page.next { Some(next) => cursor = Value::String(next), None => return rows }
    }
}

fn drain(engine: &mut Engine, now: i64) -> u64 {
    let mut chunks = 0;
    while let Some(run) = engine.run_job_chunk(now).unwrap() {
        assert_ne!(run.state, JobState::Parked, "{run:?}");
        chunks += 1;
    }
    chunks
}

// @ref LLP 3000.007#20.9 — the scheduled alternative keeps source writes predictable and gives score freshness an explicit cadence.
#[test]
fn trending_recipe_schedule_converges_without_widening_write_rules() {
    let mut engine = engine();
    let now = 2 * DAY;
    engine.seed((0..105).map(|n| post(&format!("p{n:03}"), now - 1000 + n))).unwrap();
    assert!(engine.fire_schedules(now).unwrap().is_empty());
    assert!(rank(&mut engine, now).is_empty(), "new candidates wait for the schedule");
    let before = engine.store().rows("posts").unwrap();
    for (who, p) in [("bob", "p000"), ("carol", "p000"), ("bob", "p001")] {
        let outcome = engine.mutate("like", Some(&format!("{who}-{p}")), Context::new(who, args(&[("postId", id(p))])).at(now + 1).with_ids([format!("{who}-{p}")])).unwrap();
        assert!(matches!(outcome.state, WriteState::Sent { .. }), "{outcome:?}");
        assert_eq!(outcome.metered.rows_written, 2, "only the like and its maintained count change");
    }
    assert_eq!(engine.store().rows("posts").unwrap(), before);
    assert!(engine.store().rows("ranked").unwrap().is_empty());
    assert!(engine.fire_schedules(now + PERIOD - 1).unwrap().is_empty());
    assert_eq!(engine.fire_schedules(now + PERIOD).unwrap(), ["trendingEvery"]);
    let chunks = drain(&mut engine, now + PERIOD);
    assert_eq!(chunks, 2);
    let rows = rank(&mut engine, now + PERIOD);
    assert_eq!(rows.len(), 105, "zero-like candidates survive, and tied pages lose no rows");
    let expected = std::iter::once("p000".to_owned()).chain(std::iter::once("p001".to_owned()))
        .chain((2..105).rev().map(|n| format!("p{n:03}"))).collect::<Vec<_>>();
    assert_eq!(rows.iter().map(|r| r.field("postId").unwrap().as_str().unwrap().to_owned()).collect::<Vec<_>>(), expected);
    assert_eq!(rows[0].field("score").unwrap(), &Value::Int(2));
    let outcome = engine.mutate("unlike", Some("unlike"), Context::new("carol", args(&[("postId", id("p000"))])).at(now + PERIOD + 1)).unwrap();
    assert!(matches!(outcome.state, WriteState::Sent { .. }));
    assert_eq!(rank(&mut engine, now + 2 * PERIOD - 1)[0].field("score").unwrap(), &Value::Int(2));
    assert_eq!(engine.fire_schedules(now + 2 * PERIOD).unwrap(), ["trendingEvery"]);
    assert_eq!(drain(&mut engine, now + 2 * PERIOD), 2);
    let rows = rank(&mut engine, now + 2 * PERIOD);
    assert_eq!(rows[0].field("postId").unwrap(), &id("p001"), "equal counts rank newer posts first");
    assert_eq!(rows[1].field("score").unwrap(), &Value::Int(1));
    println!("Trending: 105 candidates; 11 pages; {chunks} chunks/pass; period={PERIOD} ms; observed like lag={} ms; rows written/like=2; ranked writes on like=0", PERIOD - 1);
}

#[test]
fn trending_recipe_candidate_expiry_is_live_before_and_after_sweep() {
    let mut engine = engine();
    let now = 2 * DAY;
    engine.seed([post("expired", now - DAY), post("edge", now - DAY + 1), post("young", now), post("future", now + 1)]).unwrap();
    let run = engine.run_job("scoreTrending", args(&[]), now).unwrap();
    assert_eq!(run.state, JobState::Done);
    assert_eq!(rank(&mut engine, now).iter().map(|r| r.field("postId").unwrap().clone()).collect::<Vec<_>>(), [id("young"), id("edge")]);
    let before = rank(&mut engine, now + 1);
    assert_eq!(before.len(), 1);
    assert_eq!(engine.store().rows("ranked").unwrap().len(), 2, "the expired candidate is still physical");
    assert_eq!(engine.sweep_expired(now + 1, 100).unwrap(), 1);
    assert_eq!(rank(&mut engine, now + 1), before);
    assert_eq!(engine.run_job("scoreTrending", args(&[]), now + PERIOD).unwrap().state, JobState::Done);
    assert_eq!(rank(&mut engine, now + PERIOD).len(), 2, "the future post enters on the next pass");
}
