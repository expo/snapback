//! The measured 1,000-person / 50,000-event feed world, shared with both device stores.
#![allow(dead_code)]
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_core::value::object;
use std::collections::{BTreeMap, BTreeSet};

pub fn id(s: &str) -> Value { Value::Id(s.into()) }
pub fn who(n: usize) -> String { format!("dev:u{n:04}") }
pub fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> { pairs.iter().map(|(k, v)| ((*k).into(), v.clone())).collect() }
pub fn source() -> String { snapback4_lang::guide::quarry(snapback4_lang::guide::card("feeds").unwrap()).remove(0) }

pub fn compiled(source: &str) -> snapback4_lang::Bound {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}

pub fn graph() -> BTreeSet<(usize, usize)> {
    let mut edges = BTreeSet::new();
    for r in 910..915 { edges.insert((r, 700)); }
    edges.insert((1, 11));
    for a in 11..16 { edges.insert((2, a)); }
    for a in 10..510 { edges.insert((3, a)); }
    for a in 11..15 { edges.insert((4, a)); }
    // Exactly 900 celebrity followers, preserving the named 0/1/5/500 readers.
    edges.insert((4, 999));
    for r in 5..904 { edges.insert((r, 999)); }
    assert_eq!(edges.iter().filter(|(_, a)| *a == 999).count(), 900);
    edges
}

pub fn seed(engine: &mut Engine, mode: &str) {
    let edges = graph();
    let mut rows = Vec::new();
    for n in 0..1000 {
        rows.push(("authors".into(), object([("id", id(&format!("a{n}"))), ("principal", id(&who(n))), ("shared", Value::Bool(mode == "hybrid" && n == 999))])));
    }
    for (r, a) in &edges {
        rows.push(("follows".into(), object([("id", id(&format!("f{r}-{a}"))), ("followerId", id(&who(*r))), ("followedId", id(&who(*a)))])));
        if mode == "hybrid" && *a == 999 {
            rows.push(("pulls".into(), object([("id", id(&format!("c{r}"))), ("readerId", id(&who(*r))), ("authorId", id(&who(*a)))])));
        }
    }
    if mode == "hybrid" { rows.push(("pulls".into(), object([("id", id("c999")), ("readerId", id(&who(999))), ("authorId", id(&who(999)))]))); }
    let mut events = 0;
    for a in 0..1000 {
        let count = if a == 999 { 200 } else { 49 + usize::from(a < 849) };
        for n in 0..count {
            events += 1;
            let eid = format!("p{a:04}-{n:04}");
            let at = (n * 1000 + a) as i64;
            let shared = mode == "hybrid" && a == 999;
            rows.push(("posts".into(), object([("id", id(&eid)), ("postId", id(&eid)), ("actorId", id(&who(a))), ("authorId", id(&who(a))), ("repost", Value::Bool(false)), ("at", Value::Int(at)), ("shared", Value::Bool(shared))])));
            if mode != "merge" {
                let readers: Vec<_> = if shared { vec![a] } else { std::iter::once(a).chain(edges.iter().filter(|(_, author)| *author == a).map(|(r, _)| *r)).collect() };
                for r in readers {
                    rows.push((if shared { "broadcast" } else { "feed" }.into(), object([("id", id(&format!("e{r}-{eid}"))), ("eventId", id(&eid)), ("readerId", id(&who(r))), ("actorId", id(&who(a))), ("authorId", id(&who(a))), ("postId", id(&eid)), ("repost", Value::Bool(false)), ("at", Value::Int(at))])));
                }
            }
        }
    }
    assert_eq!(events, 50_000);
    // Bulk fixture acquisition: validate caps once by adoption, instead of
    // recounting a growing 50,000-row group for every seed insert. Measured
    // mutations run only after the original schema's complete validation.
    let schema = engine.schema().clone();
    let programs: Vec<_> = engine.programs().cloned().collect();
    let mut loading = schema.clone();
    for table in loading.tables.values_mut() { table.constraints.retain(|c| !matches!(c, snapback4_core::schema::Constraint::Cap { .. })); }
    engine.adopt(loading, programs.clone()).unwrap();
    engine.seed(rows).unwrap();
    engine.adopt(schema, programs).unwrap();
}

pub fn mutate(engine: &mut Engine, op: &str, viewer: &str, values: &[(&str, Value)], now: i64) -> snapback4_core::MutationOutcome {
    let outcome = engine.mutate(op, None, Context::new(viewer, args(values)).at(now)).unwrap();
    assert!(matches!(outcome.state, WriteState::Sent { .. }), "{op}: {:?}", outcome.state);
    outcome
}

pub fn candidate(mode: &str) -> String {
    let mut text = source();
    if mode == "fanout" {
        text = text.replace("first 50 by byFollowed", "first 1000 by byFollowed").replace("count(near) > 50", "count(near) > 1000");
        text.truncate(text.find("query following").unwrap());
        text.push_str("query following(c: cursor ?):\n  return feed[viewer] after c last 20 by byReaderTime\n");
    } else if mode == "merge" {
        text = text.replace("  cap 1000 by actorId", "  cap 60000\n  cap 1000 by actorId");
        text = text.replace("  public 'original posts and attributed reposts are public'\n  insert <- .actorId = viewer\n  delete <- .actorId = viewer\n  online only", "  public 'original posts and attributed reposts are public'\n  insert <- .actorId = viewer\n  delete <- .actorId = viewer\n  sync public");
        text = text.replace("  cap 1000 by followedId", "  cap 1000 by followedId\n  cap 100000").replace("  delete <- .followerId = viewer\n  online only", "  delete <- .followerId = viewer\n  sync public");
        text = text.replace("  deliver(p)", "  copyUnused = null");
        text.truncate(text.find("query following").unwrap());
        text.push_str("query following(c: cursor ?):\n  return merge posts after c last 20 by byActorTime:\n    [viewer]\n    [f.followedId] for f in follows[viewer] first 500 by byPair\n");
        text.push_str("query sparse(c: cursor ?):\n  return posts after c last 20 by byTime where .actorId = viewer or exists follows[followerId = viewer, followedId = .actorId]\n");
    }
    text
}
