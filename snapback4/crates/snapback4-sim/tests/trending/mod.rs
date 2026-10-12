use super::{args, id, row};
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_core::engine::job::JobState;

const DAY: i64 = 86_400_000;
const PERIOD: i64 = 60_000;

fn recipe() -> String {
    snapback4_lang::guide::quarry(include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../snapback4-lang/tests/fixtures/legacy-feed-recipes.md"))).into_iter()
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

fn live_engine() -> Engine {
    let source = snapback4_lang::guide::quarry(include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../snapback4-lang/tests/fixtures/legacy-feed-recipes.md"))).into_iter()
        .find(|source| source.contains("query rollingLikes():")).expect("the feeds card needs the fresh bounded ranking recipe");
    // Retain W12's bounded-sort engine coverage after the post-window card moves to lanes.
    let source = source + "\nquery trending():\n  candidates = posts[at > now - 86400000, at <= now] first 4095 by byTime { postId: .id, at, score: likeCounts[.id] }\n  return slice(sort(candidates, '-score', '-at', '-postId'), 0, 10)\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    assert!(!bound.schema.tables.contains_key("ranked"));
    assert!(bound.schema.schedules.is_empty());
    let horizon = bound.schema.tables["posts"].sync.as_ref().unwrap().horizon.as_ref().unwrap();
    assert_eq!((horizon.last, horizon.by.as_str()), (2000, "byTime"));
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}

fn live_rank(engine: &mut Engine, now: i64) -> Vec<Value> {
    let page = engine.query("trending", Context::new("bob", args(&[])).at(now)).unwrap();
    assert!(page.complete, "{page:?}");
    page.data.as_array().unwrap().to_vec()
}

#[test]
fn w12a_fresh_ranking_changes_in_the_source_transaction_without_a_schedule() {
    let mut engine = live_engine();
    let now = 2 * DAY;
    for (name, at) in [("older", now - 1), ("newer", now)] {
        let write = engine.mutate("create", Some(name), Context::new("alice", args(&[("body", Value::String(name.into()))])).at(at).with_ids([name.into()])).unwrap();
        assert!(matches!(write.state, WriteState::Sent { .. }), "{write:?}");
        assert_eq!(live_rank(&mut engine, now).len(), if name == "older" { 1 } else { 2 });
    }
    for (i, (who, liked, score)) in [("bob", false, 0), ("bob", true, 1), ("bob", true, 1), ("carol", true, 2), ("bob", false, 1), ("bob", false, 1), ("carol", false, 0)].into_iter().enumerate() {
        let write = engine.mutate("setLike", Some(&format!("set-{i}")), Context::new(who, args(&[("postId", id("older")), ("liked", Value::Bool(liked))])).at(now).with_ids([format!("like-{i}")])).unwrap();
        assert!(matches!(write.state, WriteState::Sent { .. }), "{write:?}");
        let rows = live_rank(&mut engine, now);
        let older = rows.iter().find(|row| row.field("postId").unwrap() == &id("older")).unwrap();
        assert_eq!(older.field("score").unwrap(), &Value::Int(score));
        assert_eq!(rows[0].field("postId").unwrap(), &id(if score > 0 { "older" } else { "newer" }));
    }
    assert!(engine.store().rows("likes").unwrap().is_empty());
    println!("W12a fresh Trending: 2 creates; 7 set/clear writes; immediate scores=0,1,1,2,1,1,0; schedule runs=0; lag=0 ms");
}

#[test]
fn w12a_fresh_ranking_seed_ties_boundaries_and_meter() {
    let mut engine = live_engine();
    let now = 2 * DAY;
    engine.seed((0..4094).map(|n| post(&format!("p{n:05}"), now))).unwrap();
    engine.seed([post("expired", now - DAY), post("edge", now - DAY + 1), post("future", now + 1)]).unwrap();
    engine.seed([("likes".into(), row(&[("id", id("seed-like")), ("postId", id("p00000")), ("principal", id("bob")), ("at", Value::Int(now)), ("expiresAt", Value::Int(now + DAY))]))]).unwrap();
    let read = engine.query("trending", Context::new("bob", args(&[])).at(now)).unwrap();
    assert!(read.complete, "{read:?}");
    let expected = std::iter::once(id("p00000")).chain((4085..4094).rev().map(|n| id(&format!("p{n:05}")))).collect::<Vec<_>>();
    assert_eq!(read.data.as_array().unwrap().iter().map(|r| r.field("postId").unwrap().clone()).collect::<Vec<_>>(), expected);
    println!("W12a complete ranking: candidates=4095; likes=1; examined={}; index_entries={}; heap_bytes={}; returned=10", read.metered.examined, read.metered.index_entries, read.metered.heap_bytes);
    engine.seed((4094..4095).map(|n| post(&format!("p{n:05}"), now))).unwrap();
    let cut = engine.query("trending", Context::new("bob", args(&[])).at(now)).unwrap();
    assert!(cut.complete && cut.capped_at.is_none(), "the declared candidate window is complete: {cut:?}");
    assert_eq!(cut.data.as_array().unwrap().len(), 10);
    for ranked in cut.data.as_array().unwrap() {
        let expected_score = i64::from(ranked.field("postId").unwrap() == &id("p00000"));
        assert_eq!(ranked.field("score").unwrap(), &Value::Int(expected_score), "a cut must not invent a score");
    }
    assert_eq!(cut.data.as_array().unwrap()[0].field("postId").unwrap(), &id("p00000"));
    assert_eq!(cut.data.as_array().unwrap()[0].field("score").unwrap(), &Value::Int(1));
    assert_eq!(read.metered.examined, 8191);
    println!("W12a bounded ranking: candidates=4096; likes=1; examined={}; heap_bytes={}; returned=10; complete={}", cut.metered.examined, cut.metered.heap_bytes, cut.complete);
    engine.seed((4095..8193).map(|n| post(&format!("p{n:05}"), now))).unwrap();
    let large = engine.query("trending", Context::new("bob", args(&[])).at(now)).unwrap();
    assert!(large.complete && large.capped_at.is_none());
    assert_eq!(large.data, cut.data, "more candidates beyond the page cannot change the scored prefix");
}

#[test]
fn w12r1a_exhausted_count_projection_is_unavailable() {
    let mut engine = live_engine();
    let now = 2 * DAY;
    engine.seed([post("winner", now)]).unwrap();
    engine.seed((0..8192).map(|n| ("likes".into(), row(&[
        ("id", id(&format!("like-{n}"))), ("postId", id("winner")), ("principal", id(&format!("viewer-{n}"))),
        ("at", Value::Int(now)), ("expiresAt", Value::Int(now + 1)),
    ])))).unwrap();
    for op in ["trending", "rollingLikes"] {
        let live = engine.query(op, Context::new("bob", args(&[])).at(now)).unwrap();
        assert!(live.complete, "live population does not spend backlog examinations: {live:?}");
        assert_eq!(live.data.as_array().unwrap()[0].field("score").unwrap(), &Value::Int(8192));
        // @ref LLP 3000.007#20.24.6 — once every like expires, the unswept backlog is
        // store work: the count completes over the live (empty) population.
        let expired = engine.query(op, Context::new("bob", args(&[])).at(now + 1)).unwrap();
        assert!(expired.complete, "{expired:?}");
        assert!(expired.metered.examined < 8, "{expired:?}");
        assert!(expired.data.as_array().unwrap().iter().all(|row| row.field("score").unwrap() == &Value::Int(0)), "{expired:?}");
        println!("W12R1a {op}: candidates=1; expired_backlog=8192; examined={}; complete=true", expired.metered.examined);
    }
    // The scan fits, but even the first count lookup has no examined unit left.
    engine.set_ceilings(snapback4_core::meter::Ceilings { examined: 1, ..engine.ceilings() });
    let cut = engine.query("trending", Context::new("bob", args(&[])).at(now)).unwrap();
    assert!(!cut.complete);
    assert_eq!(cut.data, Value::Null, "a lookup cut must not be coerced to an absent-group zero");
    assert_eq!(cut.metered.examined, 2);
}

#[test]
fn w12r1a_fresh_ranking_heap_cut_with_full_size_bodies() {
    let mut engine = live_engine();
    let now = 2 * DAY;
    for (start, end) in [(0, 1000), (1000, 2700)] {
        engine.seed((start..end).map(|n| ("posts".into(), row(&[
            ("id", id(&format!("p{n:05}"))), ("authorId", id("alice")),
            ("body", Value::String("x".repeat(6000))), ("at", Value::Int(now)),
        ])))).unwrap();
        let read = engine.query("trending", Context::new("bob", args(&[])).at(now)).unwrap();
        assert_eq!(read.complete, end == 1000);
        if end == 1000 { assert_eq!(read.data.as_array().unwrap().len(), 10); }
        else {
            assert_eq!(read.data, Value::Null);
            assert_eq!(read.next, None);
            assert_eq!(read.capped_at.as_ref().map(|cut| cut.0), Some(snapback4_core::error::MeterKind::HeapBytes));
        }
        println!("W12R1a body=6000 B; candidates={end}; examined={}; heap_bytes={}; complete={}; null={}", read.metered.examined, read.metered.heap_bytes, read.complete, read.data == Value::Null);
    }
    // Heap still unwinds to null if an earlier scan already recorded another cut.
    engine.set_ceilings(snapback4_core::meter::Ceilings { examined: 2650, ..engine.ceilings() });
    let cut = engine.query("trending", Context::new("bob", args(&[])).at(now)).unwrap();
    assert!(!cut.complete);
    assert_eq!(cut.data, Value::Null);
    assert_eq!(cut.capped_at.as_ref().map(|cut| cut.0), Some(snapback4_core::error::MeterKind::Examined));
    assert!(cut.metered.heap_bytes > engine.ceilings().heap_bytes);
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

// @ref LLP 3000.007#18.5 — scheduled and immediate Trending share the post-id tie-breaker after scoring converges.
#[test]
fn trending_equal_score_equal_time_pages_match_immediate() {
    let mut engine = engine();
    let now = 2 * DAY;
    // A ranked row has its own id. Reverse those ids to make the tie-break
    // independent of random mint order; the real scoring job refreshes them.
    for n in 0..11 {
        engine.seed([post(&format!("p{n:03}"), now), ("ranked".into(), row(&[
            ("id", id(&format!("r{:03}", 10 - n))), ("postId", id(&format!("p{n:03}"))),
            ("score", Value::Int(-1)), ("at", Value::Int(now - 1)), ("expiresAt", Value::Int(now + DAY)),
        ]))]).unwrap();
    }
    assert_eq!(engine.run_job("scoreTrending", args(&[]), now).unwrap().state, JobState::Done);
    let immediate = engine.query("trendingNow", Context::new("bob", args(&[])).at(now)).unwrap();
    assert!(immediate.complete);
    let expected = (0..11).rev().map(|n| id(&format!("p{n:03}"))).collect::<Vec<_>>();
    let top = immediate.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().clone()).collect::<Vec<_>>();
    assert_eq!(top, expected[..10]);
    let rows = rank(&mut engine, now);
    assert_eq!(rows.len(), 11);
    assert!(rows.iter().all(|r| r.field("score").unwrap() == &Value::Int(0) && r.field("at").unwrap() == &Value::Int(now)));
    let actual = rows.iter().map(|r| r.field("postId").unwrap().clone()).collect::<Vec<_>>();
    assert_eq!(actual[..10], top, "converged scheduled top ten must equal the immediate top ten");
    assert_eq!(actual, expected, "continuation loses or duplicates no tied post");
    println!("Trending server ties: 11 candidates; 2 pages; 10/10 immediate matches; 11 unique posts; score=0; one timestamp");
}

mod lanes;
