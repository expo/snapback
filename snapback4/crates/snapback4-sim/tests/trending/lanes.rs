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
fn column_oracle_clock_and_zeros_in_one_merge() {
    let mut engine = engine(""); fixture(&mut engine);
    let original = ranking(&mut engine, NOW);
    assert_eq!(scored(&original), oracle(&engine, NOW));
    let later = ranking(&mut engine, NOW + HOUR);
    let expected = original.into_iter().filter(|r| r.field("id").unwrap() != &id("edge")).collect::<Vec<_>>();
    assert_eq!(later, expected, "only the 23.5h-old post leaves when the clock advances one hour");
    seed_post(&mut engine, "future-current-hour", NOW + 1, 50);
    assert!(!names(&ranking(&mut engine, NOW)).contains(&"future-current-hour".to_string()));
    let fill = engine.query("trending", Context::new("bob", args(&[("c", Value::Null)])).at(NOW)).unwrap();
    assert!(fill.complete); let out = rows(&fill.data);
    assert_eq!(out.len(), 10);
    assert_eq!(names(&out), ["mid", "fresh", "edge", "quiet-00", "quiet-01", "quiet-02", "quiet-03", "quiet-04", "quiet-05", "quiet-06"]);
    for row in out.iter().filter(|r| r.field("id").unwrap().as_str().unwrap().starts_with("quiet-")) {
        assert_eq!(row.field("likeCount").unwrap(), &Value::Int(0));
    }
    for (step, liked) in [false, true, false].into_iter().enumerate() {
        set_like(&mut engine, "bob", "quiet-00", liked, NOW, &format!("quiet-{step}"));
        let stored = engine.store().rows("posts").unwrap();
        let row = stored.iter().find(|r| r.field("id").unwrap() == &id("quiet-00")).unwrap();
        assert_eq!(row.field("likeCount").unwrap(), &Value::Int(i64::from(liked)));
        let ranked = ranking(&mut engine, NOW);
        assert_eq!(names(&ranked).iter().position(|id| id == "quiet-00"), Some(if liked { 2 } else { 3 }));
        assert_eq!(ranked[if liked { 2 } else { 3 }].field("likeCount").unwrap(), &Value::Int(i64::from(liked)));
    }
    for n in 0..10 { seed_post(&mut engine, &format!("extra-{n}"), NOW - HOUR, 4); }
    set_like(&mut engine, "reader-2", "mid", false, NOW, "tie-mid");
    set_like(&mut engine, "alice", "edge", true, NOW, "tie-edge");
    let tied = ranking(&mut engine, NOW).into_iter().filter(|r| ["fresh", "mid", "edge"].contains(&r.field("id").unwrap().as_str().unwrap())).collect::<Vec<_>>();
    assert_eq!(scored(&tied), [("fresh".into(), 2), ("mid".into(), 2), ("edge".into(), 2)]);
    let full = engine.query("trending", Context::new("bob", args(&[("c", Value::Null)])).at(NOW)).unwrap();
    assert!(full.complete && rows(&full.data).iter().all(|r| r.field("likeCount").unwrap() != &Value::Int(0)));
    println!("column ranking: rows=10 examined={}; zeros share one merge", fill.metered.examined);
}

#[test]
fn column_ranking_keeps_source_write_authority() {
    let mut engine = engine("\nmutation forgePrincipal(postId: posts, principal: principal):\n  post = posts[postId] ! else NOT_FOUND\n  insert likes { postId: post.id, principal }\nmutation foreignUnlike(postId: posts, principal: principal):\n  delete likes[postId, principal]\n");
    seed_post(&mut engine,"edge",NOW-HOUR,0);
    set_like(&mut engine,"alice","edge",true,NOW,"initial");
    for op in ["forgePrincipal","foreignUnlike"] {
        let reply=engine.mutate(op,Some(op),Context::new("attacker",args(&[("postId",id("edge")),("principal",id("alice"))])).at(NOW).with_ids([op.into()])).unwrap();
        assert!(matches!(&reply.state,WriteState::Failed {why,..} if why.code == "E_RULE"),"{reply:?}");
    }
    for (n,liked) in [true,true,false,false].into_iter().enumerate() {
        set_like(&mut engine,"alice","edge",liked,NOW,&format!("set{n}"));
        assert_eq!(scored(&ranking(&mut engine,NOW)),vec![("edge".into(),i64::from(liked))]);
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
    assert!(page.complete && page.next.is_some()); assert_eq!(rows(&page.data).len(), 10); assert_eq!(page.metered.examined, 34);
    let second = engine.query("trending", Context::new("bob", args(&[("c", Value::String(page.next.clone().unwrap()))])).at(NOW)).unwrap();
    assert!(second.complete && second.next.is_some());
    assert_eq!(rows(&second.data).len(), 10);
    let first_ids = names(&rows(&page.data));
    assert!(names(&rows(&second.data)).iter().all(|id| !first_ids.contains(id)));
    let before = engine.store().rows("posts").unwrap();
    let bytes: usize = before.iter().map(|r| serde_json::to_vec(&snapback4_core::wire::to_json(r)).unwrap().len()).sum();
    assert!(ranking(&mut engine, NOW + 2 * DAY).is_empty());
    assert_eq!(engine.store().rows("posts").unwrap(), before);
    set_like(&mut engine, "reader-0", "p00000", false, NOW + 2 * DAY, "last-unlike");
    assert_eq!(engine.store().rows("posts").unwrap().len(), 48_200);
    assert_eq!(engine.store().rows("posts").unwrap().iter().find(|r|r.field("id").unwrap() == &id("p00000")).unwrap().field("likeCount").unwrap(), &Value::Int(0));
    println!("W14a population: in-window=48200; liked=48200; examined={}; complete=true; next=true; parents after 48h=48200; parent row JSON bytes={bytes}; parents after last unlike=48200", page.metered.examined);
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

// @ref LLP 3000.007.001#4 — the same merge includes zero-like posts.
#[test]
fn column_first_page_includes_unliked_posts_without_scanning_the_population() {
    let mut engine = engine("");
    seed_post(&mut engine, "winner", NOW - HOUR, 1);
    let mut previous = 1;
    for population in [1, 10, 11, 4_096, 48_200] {
        engine.seed((previous..population).map(|n| post(&format!("quiet-{n:05}"), NOW - HOUR))).unwrap();
        let read = engine.query("trending", Context::new("bob", args(&[("c", Value::Null)])).at(NOW)).unwrap();
        assert!(read.complete);
        let got=scored(&rows(&read.data));
        assert_eq!(got[0],("winner".into(),1));
        assert!(got[1..].iter().all(|(_,n)|*n==0));
        assert_eq!(got.len(),population.min(10));
        assert_eq!(read.next.is_some(), population > 10);
        // One occupied lane: ten results plus the cursor's lookahead, regardless
        // of how many zero-like parents remain behind that boundary.
        assert_eq!(read.metered.examined,population.min(11) as u64);
        println!("W12INT sparse population: posts={population}; likes=1; examined={}; complete={}", read.metered.examined, read.complete);
        previous = population;
    }
}

#[test]
fn column_lane_ties_rewrite_and_zero_stays_indexed() {
    let mut engine = engine("\nquery lane(h: int, c: cursor ?):\n  return posts[h] after c last 10 by byHourLikes\n");
    for (name, at) in [("older", 9_999_999), ("newer", 10_000_000), ("same-time-z", 10_000_000)] {
        seed_post(&mut engine, name, at, 2);
    }
    let lane = |engine: &mut Engine| engine.query("lane", Context::new("bob", args(&[("h", Value::Int(2)), ("c", Value::Null)])).at(NOW)).unwrap();
    let entries = |engine: &Engine| engine.store().conn().query_row(
        "SELECT COUNT(*) FROM i WHERE ti = (SELECT num FROM _catalog WHERE name = 'posts.byHourLikes')", [], |row| row.get::<_, i64>(0)).unwrap();
    assert_eq!(names(&rows(&lane(&mut engine).data)), ["same-time-z", "newer", "older"]);
    assert_eq!(entries(&engine), 3);
    set_like(&mut engine, "bob", "older", true, NOW, "up");
    assert_eq!(scored(&rows(&lane(&mut engine).data)), [("older".into(), 3), ("same-time-z".into(), 2), ("newer".into(), 2)]);
    assert_eq!(entries(&engine), 3, "the old score key was removed");
    set_like(&mut engine, "bob", "older", false, NOW, "down");
    assert_eq!(names(&rows(&lane(&mut engine).data)), ["same-time-z", "newer", "older"]);
    for n in 0..2 { set_like(&mut engine, &format!("reader-{n}"), "same-time-z", false, NOW, &format!("zero-{n}")); }
    assert_eq!(names(&rows(&lane(&mut engine).data)), ["newer", "older", "same-time-z"]);
    assert_eq!(engine.store().rows("posts").unwrap().len(), 3);
    assert_eq!(entries(&engine), 3, "zero-like parent remains indexed");
    println!("column lane: 3 tied parents; 2 score rewrites; zero retains all 3 entries");
}

#[test]
fn w15c_equal_scores_continue_across_page_and_drain_cuts_in_both_directions() {
    for drain_cut in [false, true] {
        let mut engine = engine(&tie_queries(if drain_cut { 100 } else { 7 })); tie_fixture(&mut engine);
        let expected = oracle(&engine, TIE_NOW).into_iter().map(|r| r.0).collect::<Vec<_>>();
        // Twelve filtered heads cost twelve examinations; a 16-examination budget
        // then cuts a refill inside the equal-score run. Never raise a ceiling.
        if drain_cut { engine.set_ceilings(snapback4_core::meter::Ceilings { examined: 16, ..engine.ceilings() }); }
        for op in ["tieFirst", "tieLast"] {
            let mut expected = expected.clone(); if op == "tieFirst" { expected.reverse(); }
            let mut actual = Vec::new(); let mut cursor = Value::Null; let mut cuts = 0; let mut pages = 0;
            for _ in 0..60 {
                let page = engine.query(op, Context::new("bob", args(&[("c", cursor)])).at(TIE_NOW)).unwrap();
                if !page.complete { assert_eq!(page.cut, Some(snapback4_core::engine::ReadCut::Meter)); assert!(page.next.is_some()); cuts += 1; }
                actual.extend(names(&rows(&page.data))); pages += 1;
                match page.next { Some(next) => cursor = Value::String(next), None => break }
            }
            assert_eq!(actual, expected, "{op}, drain={drain_cut}");
            assert_eq!(actual.len(), 48); assert_eq!(cuts > 0, drain_cut);
            println!("W15c {op}: rows={} pages={pages} meter_cuts={cuts}", actual.len());
        }
    }
}
