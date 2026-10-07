//! FH design evidence, not a new supported history reader.
//! @ref LLP 3000.026#9-exact-on-demand-history-design-handoff — measure the existing merge and its opening boundary.
use snapback4_core::{Context, Engine, Value, value::object};
use std::{collections::BTreeSet, time::Instant};

const BASE: &str = include_str!("fixtures/following-view.q");
const HISTORY: &str = "\nquery history(c: cursor ?):\n  return activity where .actor = viewer or exists follows[viewer, .actor] last 20 by .at after c\n";
// Research control using existing IR and owned indexes. The discovery bound is
// deliberately above the read meter: it is NOT a supported maximum follows.
const INDEXED: &str = "\nquery indexed(c: cursor ?):\n  return merge feedPosts after c last 20 by byActorTime:\n    [viewer]\n    [f.actorId] for f in feedEdges[viewer] first 100000 by byPair\n";

fn id(s: impl Into<String>) -> Value { Value::Id(s.into()) }
fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn source(materialized: bool) -> String {
    if materialized { format!("{BASE}{HISTORY}{INDEXED}") }
    else {
        format!("{}{HISTORY}", BASE.replace("view feed: activity where .actor = viewer or exists follows[viewer, .actor]\n", "")
            .replace("return feed last", "return activity last"))
    }
}
fn bare() -> Engine {
    let b = bound(&source(false));
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn adopt(e: &mut Engine) {
    let b = bound(&source(true));
    e.adopt_at(b.schema, b.programs.into_iter().map(|p| p.program), 1_000_000).unwrap();
}
fn post(name: &str, actor: &str, at: i64) -> (String, Value) {
    ("posts".into(), object([("id", id(name)), ("authorId", id(actor)),
        ("parentId", Value::Null), ("at", Value::Int(at)), ("removed", Value::Bool(false))]))
}
fn follow(actor: &str) -> (String, Value) {
    ("follows".into(), object([("id", id(format!("f-{actor}"))),
        ("followerId", id("reader")), ("followedId", id(actor))]))
}
fn query(e: &mut Engine, op: &str, cursor: Option<String>) -> snapback4_core::QueryOutcome {
    e.query(op, Context::new("reader", [("c".into(), cursor.map(Value::String).unwrap_or(Value::Null))].into()).at(1_000_000)).unwrap()
}
fn row_ids(p: &snapback4_core::QueryOutcome) -> Vec<String> {
    p.data.as_array().map(|rs| rs.iter().map(|r| r.field("id").unwrap().as_str().unwrap().into()).collect()).unwrap_or_default()
}
fn all(e: &mut Engine, op: &str) -> Vec<String> {
    let mut cursor = None; let mut ids = Vec::new();
    for _ in 0..10_000 {
        let p = query(e, op, cursor);
        assert!(p.complete, "{op}: {p:?}");
        assert!(p.metered.examined <= 8192 && p.metered.index_entries <= 16384);
        ids.extend(row_ids(&p)); cursor = p.next;
        if cursor.is_none() { return ids; }
    }
    panic!("history did not terminate");
}
fn measure(e: &mut Engine, op: &str, label: &str, complete: bool) {
    let _ = query(e, op, None);
    let mut samples = Vec::new();
    for _ in 0..11 {
        let t = Instant::now(); let p = query(e, op, None);
        samples.push(t.elapsed().as_micros());
        assert_eq!(p.complete, complete);
    }
    samples.sort(); let p = query(e, op, None);
    println!("FH {}", serde_json::json!({"label":label,"op":op,"samples_us":samples,
        "median_us":samples[5],"data_rows":row_ids(&p).len(),"complete":p.complete,
        "unavailable":p.unavailable,"has_next":p.next.is_some(),"metered":p.metered,
        "capped_at":format!("{:?}",p.capped_at)}));
}

#[test]
#[ignore = "FH scale evidence; run explicitly with --ignored --nocapture --test-threads=1"]
fn sparse_history_and_existing_indexed_control() {
    let mut small = bare();
    small.seed_at((0..1100).map(|n| post(&format!("p{n:05}"), "quiet", n)), 1_000_000).unwrap();
    let edge_and_repost = || [follow("quiet"), ("reposts".into(), object([
        ("id",id("r-quiet")),("actorId",id("quiet")),("postId",id("p00000")),("at",Value::Int(1100))]))];
    small.seed_at(edge_and_repost(), 1_000_000).unwrap();
    adopt(&mut small);
    measure(&mut small, "history", "1100-no-noise", true);
    measure(&mut small, "indexed", "1100-no-noise", true);
    let control_meter = query(&mut small, "indexed", None).metered;
    let mut e = bare();
    // 1,000 principals: reader, quiet and 998 unrelated authors. The reader
    // follows quiet only. Its 1,100 originals and one repost precede all noise.
    for start in (0..50_000).step_by(256) {
        e.seed_at((start..(start+256).min(50_000)).map(|n| {
            let actor = if n < 1100 { "quiet".into() } else { format!("u{:04}", n % 998) };
            post(&format!("p{n:05}"), &actor, n as i64)
        }), 1_000_000).unwrap();
    }
    e.seed_at(edge_and_repost(), 1_000_000).unwrap();
    adopt(&mut e);
    let sparse = query(&mut e, "history", None);
    assert!(!sparse.complete && sparse.next.is_none());
    assert!(row_ids(&sparse).is_empty());
    measure(&mut e, "history", "50k-sparse", false);
    measure(&mut e, "indexed", "50k-sparse", true);
    assert_eq!(query(&mut e, "indexed", None).metered, control_meter,
        "adding 48,900 unrelated posts must not change the merge's work");
    let indexed = all(&mut e, "indexed");
    assert_eq!(indexed.len(), 1101);
    assert_eq!(indexed.iter().collect::<BTreeSet<_>>().len(), 1101);
    assert_eq!(all(&mut e, "home").len(), 1000);
    // Full-scan oracle is operator inspection, never the metered reader.
    let mut oracle: Vec<_> = e.store().rows("feedPosts").unwrap().into_iter()
        .filter(|r| r.field("actorId").unwrap() == &id("quiet")).collect();
    oracle.sort_by_key(|r| std::cmp::Reverse((r.field("at").unwrap().as_int().unwrap(), r.field("id").unwrap().as_str().unwrap().to_owned())));
    assert_eq!(indexed, oracle.iter().map(|r|r.field("id").unwrap().as_str().unwrap().to_owned()).collect::<Vec<_>>());
}

#[test]
fn one_global_tail_cannot_join_per_actor_windows() {
    let mut e = bare();
    // quiet's one very old event makes the inbox tail older than hot's 101
    // uncopied events. Starting history below that tail skips those 101 forever.
    let mut rows = vec![post("ancient", "quiet", 0), follow("quiet"), follow("hot")];
    rows.extend((1..=1101).map(|n|post(&format!("hot-{n:04}"), "hot", n)));
    e.seed_at(rows, 2000).unwrap(); adopt(&mut e);
    let home = all(&mut e, "home"); let indexed = all(&mut e, "indexed");
    assert_eq!(home.len(), 1001); assert_eq!(home.last().unwrap(), "ancient");
    assert_eq!(indexed.len(), 1102);
    assert!(!home.contains(&"hot-0101".to_owned()));
    assert!(indexed.contains(&"hot-0101".to_owned()));
}

#[test]
#[ignore = "FH scale evidence; run explicitly with --ignored --nocapture --test-threads=1"]
fn unbounded_follows_exhaust_existing_merge_discovery() {
    let mut e = bare();
    for start in (0..8200).step_by(256) {
        e.seed_at((start..(start+256).min(8200)).flat_map(|n| {
            let actor = format!("a{n:05}");
            [post(&format!("p{n:05}"), &actor, n as i64), follow(&actor)]
        }), 1_000_000).unwrap();
    }
    adopt(&mut e);
    let p = query(&mut e, "indexed", None);
    println!("FH opening {}", serde_json::json!({"follows":8200,"complete":p.complete,
        "unavailable":p.unavailable,"has_next":p.next.is_some(),"metered":p.metered,
        "capped_at":format!("{:?}", p.capped_at)}));
    assert!(!p.complete && p.next.is_none(), "a plain merge cannot continue discovery");
}
