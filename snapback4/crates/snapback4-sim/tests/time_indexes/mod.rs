use super::*;
mod fixture;
use fixture::{SOURCE, TIMES};
fn checked(source: &str) -> snapback4_lang::Bound {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}
fn engine(source: &str) -> Engine {
    let bound = checked(source);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}
fn ids(value: &Value) -> Vec<String> { value.as_array().unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap().to_owned()).collect() }
fn cx(input: &[(&str, Value)], now: i64) -> Context { Context::new("dev:alice", args(input)).at(now) }

#[test]
fn w13c2_bucket_order_seeks_and_cursor_cross_boundaries() {
    let mut engine = engine(SOURCE);
    engine.seed(fixture::seed()).unwrap();
    for (start, end) in [(-3, 4), (-1, 2)] {
        let mut cursor = Value::Null;
        let mut found = Vec::new();
        for _ in 0..10 {
            let page = engine.query("buckets", cx(&[("start", Value::Int(start)), ("end", Value::Int(end)), ("c", cursor)], 0)).unwrap();
            assert!(page.complete, "{page:?}");
            found.extend(ids(&page.data));
            match page.next { Some(next) => cursor = Value::String(next), None => break }
        }
        assert_eq!(found, fixture::oracle(start, end));
    }
    let hours = engine.query("hourPage", cx(&[("h", Value::Int(-1))], 0)).unwrap();
    assert_eq!(ids(&hours.data), ["e1", "e2", "e3"]);
    let merged = engine.query("ordinalMerge", cx(&[], 0)).unwrap();
    assert_eq!(ids(&merged.data), (0..TIMES.len()).map(|n| format!("e{n}")).collect::<Vec<_>>());
}

#[test]
fn w13c2_moving_time_reindexes_and_daily_unique_uses_the_named_refusal() {
    let mut engine = engine(SOURCE);
    engine.seed(fixture::seed()).unwrap();
    let moved = engine.mutate("move", Some("move"), cx(&[("eventId", id("e1")), ("at", Value::Int(1_800_001))], 0)).unwrap();
    assert!(matches!(moved.state, WriteState::Sent { .. }), "{moved:?}");
    assert_eq!(ids(&engine.query("hourPage", cx(&[("h", Value::Int(-1))], 0)).unwrap().data), ["e2", "e3"]);
    assert_eq!(ids(&engine.query("hourPage", cx(&[("h", Value::Int(0))], 0)).unwrap().data), ["e4", "e1"]);
    let first = engine.mutate("checkin", Some("day-one"), cx(&[], 86_399_999)).unwrap();
    assert!(matches!(first.state, WriteState::Sent { .. }));
    let second = engine.mutate("checkin", Some("day-one-again"), cx(&[], 86_399_999)).unwrap();
    assert!(matches!(&second.state, WriteState::Failed { why: refusal, .. } if refusal.code == "ALREADY_HERE" && refusal.message == "Already checked in."), "{second:?}");
    let next = engine.mutate("checkin", Some("day-two"), cx(&[], 86_400_000)).unwrap();
    assert!(matches!(next.state, WriteState::Sent { .. }));
}

#[test]
fn w13c2_adoption_builds_time_keys_and_rebuilds_changed_period_and_offset() {
    let base = SOURCE.split("query buckets").next().unwrap().lines().filter(|line| !line.contains("by byBucket:")).collect::<Vec<_>>().join("\n");
    let mut engine = engine(&(base + "\n"));
    engine.seed(fixture::seed()).unwrap();
    for (source, expected) in [(SOURCE.to_owned(), vec!["e4", "e5", "e6"]), (SOURCE.replace("bucket(at, 2h, 30m)", "bucket(at, 1h, 0ms)"), vec!["e2", "e3", "e4"])] {
        let bound = checked(&source);
        engine.adopt(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        let result = engine.query("buckets", cx(&[("start", Value::Int(0)), ("end", Value::Int(1))], 0)).unwrap();
        assert_eq!(ids(&result.data), expected);
    }
}
