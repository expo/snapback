#[path = "lanes_fixture.rs"]
mod f;
use f::*;
use snapback4_core::{Context, Engine, Value, WriteState};

fn engine(extra: &str) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source(false) + extra)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}

#[test]
fn w14a_oracle_clock_and_zero_fill() {
    let mut engine = engine(""); fixture(&mut engine);
    let original = ranking(&mut engine, NOW);
    assert_eq!(scored(&original), oracle(&engine, NOW));
    let later = ranking(&mut engine, NOW + HOUR);
    let expected = original.into_iter().filter(|r| r.field("postId").unwrap() != &id("edge")).collect::<Vec<_>>();
    assert_eq!(later, expected, "only the 23.5h-old post leaves when the clock advances one hour");
    seed_post(&mut engine, "future-current-hour", NOW + 1, 50);
    assert!(!names(&ranking(&mut engine, NOW)).contains(&"future-current-hour".to_string()));
    let fill = engine.query("trendingWithZeros", Context::new("bob", args(&[("c", Value::Null)])).at(NOW)).unwrap();
    assert!(fill.complete); let out = rows(&fill.data);
    assert_eq!(out.len(), 10);
    assert_eq!(names(&out), ["mid", "fresh", "edge", "quiet-00", "quiet-01", "quiet-02", "quiet-03", "quiet-04", "quiet-05", "quiet-06"]);
    for n in 0..10 { seed_post(&mut engine, &format!("extra-{n}"), NOW - HOUR, 4); }
    set_like(&mut engine, "reader-2", "mid", false, NOW, "tie-mid");
    set_like(&mut engine, "alice", "edge", true, NOW, "tie-edge");
    let tied = ranking(&mut engine, NOW).into_iter().filter(|r| ["fresh", "mid", "edge"].contains(&r.field("postId").unwrap().as_str().unwrap())).collect::<Vec<_>>();
    assert_eq!(scored(&tied), [("fresh".into(), 2), ("mid".into(), 2), ("edge".into(), 2)]);
    let full = engine.query("trendingWithZeros", Context::new("bob", args(&[("c", Value::Null)])).at(NOW)).unwrap();
    assert!(full.complete && rows(&full.data).iter().all(|r| r.field("score").unwrap() != &Value::Int(0)));
    println!("W14a server fill: rows=10 examined={}; full liked page has zero fill rows", fill.metered.examined);
}

#[test]
fn w14a_declared_forgery_refuses_false_time_and_accepts_true_time() {
    let mut engine = engine("\nmutation forgeLike(postId: posts, postAt: time):\n  insert likes { postId, principal: viewer, postAt } if absent\nmutation forgePrincipal(postId: posts, principal: principal):\n  insert likes { postId, principal, postAt: (posts[postId] ! else POST_NOT_FOUND).at }\nmutation foreignUnlike(postId: posts, principal: principal):\n  delete likes[postId, principal]\n");
    seed_post(&mut engine, "edge", NOW - 47 * HOUR / 2, 0);
    for (write, time, accepted) in [("false", NOW, false), ("true", NOW - 47 * HOUR / 2, true)] {
        let reply = engine.mutate("forgeLike", Some(write), Context::new("alice", args(&[("postId", id("edge")), ("postAt", Value::Int(time))]))
            .at(NOW).with_ids([write.into()])).unwrap();
        if accepted { assert!(matches!(reply.state, WriteState::Sent { .. })); }
        else { assert!(matches!(&reply.state, WriteState::Failed { why, .. } if why.code == "E_RULE"), "{reply:?}"); }
    }
    for op in ["forgePrincipal", "foreignUnlike"] {
        let reply = engine.mutate(op, Some(op), Context::new("attacker", args(&[("postId", id("edge")), ("principal", id("alice"))]))
            .at(NOW).with_ids([op.into()])).unwrap();
        assert!(matches!(&reply.state, WriteState::Failed { why, .. } if why.code == "E_RULE"), "{reply:?}");
    }
    for (n, liked) in [true, true, false, false].into_iter().enumerate() {
        set_like(&mut engine, "alice", "edge", liked, NOW, &format!("set{n}"));
        assert_eq!(ranking(&mut engine, NOW).len(), usize::from(liked));
    }
}

#[test]
fn w14a_one_cursor_with_a_concurrent_like_and_score_crossing_limit() {
    let mut engine = engine(""); paging_fixture(&mut engine);
    let expected = names(&ranking(&mut engine, NOW));
    let first = engine.query("trending", Context::new("bob", args(&[("c", Value::Null)])).at(NOW)).unwrap();
    let mut result = names(&rows(&first.data));
    // This already-returned winner increases, without crossing behind the cursor.
    set_like(&mut engine, "concurrent", &result[0], true, NOW, "concurrent");
    let mut cursor = first.next.clone();
    while let Some(next) = cursor {
        let page = engine.query("trending", Context::new("bob", args(&[("c", Value::String(next))])).at(NOW)).unwrap();
        assert!(page.complete); result.extend(names(&rows(&page.data))); cursor = page.next;
    }
    assert_eq!(result, expected); assert_eq!(result.len(), 37);
    // An unread row moved ahead of the saved cursor can be omitted: no snapshot claim.
    for n in 0..45 { set_like(&mut engine, &format!("cross-{n}"), "p00", true, NOW, &format!("cross-{n}")); }
    let mut cursor = first.next;
    let mut remaining = Vec::new();
    while let Some(next) = cursor {
        let page = engine.query("trending", Context::new("bob", args(&[("c", Value::String(next))])).at(NOW)).unwrap();
        assert!(page.complete); remaining.extend(names(&rows(&page.data))); cursor = page.next;
    }
    assert!(!remaining.contains(&"p00".to_string()), "a row that crossed ahead of the token is omitted");
    assert_eq!(names(&ranking(&mut engine, NOW))[0], "p00");
    println!("W14a server paging: 37 liked posts, each once across concurrent winner increment; cursor is not a snapshot");
}

#[test]
fn w14a_population_and_group_lifetime() {
    let mut engine = engine("");
    for n in 0..48_200 { seed_post(&mut engine, &format!("p{n:05}"), NOW - (n % 24) * HOUR - 1, 1); }
    let page = engine.query("trending", Context::new("bob", args(&[("c", Value::Null)])).at(NOW)).unwrap();
    assert!(page.complete && page.next.is_some()); assert_eq!(rows(&page.data).len(), 10); assert!(page.metered.examined < 400);
    let before = engine.store().rows("trend").unwrap();
    let bytes: usize = before.iter().map(|r| serde_json::to_vec(&snapback4_core::wire::to_json(r)).unwrap().len()).sum();
    assert!(ranking(&mut engine, NOW + 2 * DAY).is_empty());
    assert_eq!(engine.store().rows("trend").unwrap(), before);
    set_like(&mut engine, "reader-0", "p00000", false, NOW + 2 * DAY, "last-unlike");
    assert_eq!(engine.store().rows("trend").unwrap().len(), 48_199);
    println!("W14a population: in-window=48200; liked=48200; examined={}; complete=true; next=true; groups after 48h=48200; target row JSON bytes={bytes}; groups after last unlike=48199", page.metered.examined);
}

#[test]
fn w14a_partial_boundary_hour_is_charged_and_can_cut() {
    let mut engine = engine("");
    seed_post(&mut engine, "live", NOW - HOUR, 1);
    for n in 0..8_300 { seed_post(&mut engine, &format!("old-{n}"), NOW - DAY - 1, 1); }
    let read = engine.query("trending", Context::new("bob", args(&[("c", Value::Null)])).at(NOW)).unwrap();
    assert!(!read.complete, "an oldest-hour predicate is not an index bound");
    println!("W14a boundary: stale same-hour groups=8300; examined={}; complete={}", read.metered.examined, read.complete);
}

// @ref LLP 3000.007#20.21 — the post window seeks maintained hour lanes without examining unliked candidates.
#[test]
fn w12int_one_liked_post_cost_is_independent_of_unliked_population() {
    let mut engine = engine("");
    seed_post(&mut engine, "winner", NOW - HOUR, 1);
    let mut previous = 1;
    for population in [1, 4_096, 48_200] {
        engine.seed((previous..population).map(|n| post(&format!("quiet-{n:05}"), NOW - HOUR))).unwrap();
        let read = engine.query("trending", Context::new("bob", args(&[("c", Value::Null)])).at(NOW)).unwrap();
        assert!(read.complete);
        assert_eq!(scored(&rows(&read.data)), [("winner".into(), 1)]);
        assert_eq!(read.metered.examined, 1);
        println!("W12INT sparse population: posts={population}; likes=1; examined={}; complete={}", read.metered.examined, read.complete);
        previous = population;
    }
}
