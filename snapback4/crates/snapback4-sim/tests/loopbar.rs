//! What the loop bar's fresh agents attributed to Snapback 4 (`loopbar/`,
//! `metrics/loopbar.jsonl`), each as the case they hit, against the fix.

use snapback4_core::engine::{Context, Engine};
use snapback4_core::value::{Value, object};
use std::collections::BTreeMap;

const FEED: &str = "use personas alice, bob, carol

table follows:
  follower: principal
  followed: principal
  unique byPair: follower, followed
  by byFollower: follower, followed, id
  read <- allow
  insert <- .follower = viewer
  update <- deny
  delete <- .follower = viewer
  sync public

table posts:
  authorId: principal
  text: text <=500
  at: time
  by byAuthorTime: authorId, at, id
  read <- allow
  insert <- .authorId = viewer
  update <- deny
  delete <- deny
  sync public last 500 by byAuthorTime

table conversations:
  title: text <=120
  read <- allow
  insert <- allow
  update <- deny
  delete <- deny
  sync public

query followingFeed(c: cursor ?):
  return merge posts after c last 20 by byAuthorTime:
    [f.followed] for f in follows[viewer] first 500 by byFollower

query global():
  return posts[] first 20 by byId

query thread(conversationId: conversations ?):
  convId = conversationId ?? 'dm1'
  return conversations[convId]
";

fn id(s: &str) -> Value {
    Value::Id(s.into())
}

fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect()
}

fn engine(posts_by_bob: usize) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), FEED.to_owned())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    let mut rows = vec![
        ("follows".to_owned(), object([("id", id("f1")), ("follower", id("dev:alice")), ("followed", id("dev:bob"))])),
        ("follows".to_owned(), object([("id", id("f2")), ("follower", id("dev:alice")), ("followed", id("dev:carol"))])),
        ("conversations".to_owned(), object([("id", id("dm1")), ("title", Value::String("DM".into()))])),
    ];
    for n in 0..posts_by_bob {
        rows.push(("posts".to_owned(), object([("id", id(&format!("p{n:03}"))), ("authorId", id("dev:bob")), ("text", Value::String(format!("post {n}"))), ("at", Value::Int(1_000 + n as i64))])));
    }
    rows.push(("posts".to_owned(), object([("id", id("c-1")), ("authorId", id("dev:carol")), ("text", Value::String("carol".into())), ("at", Value::Int(1))])));
    engine.seed(rows).unwrap();
    engine
}

/// Set B, run 1: a merged feed with a cursor answered `next: null` with more
/// than twenty rows when one lane alone filled the page.
#[test]
fn a_merged_feed_continues_when_one_lane_fills_the_page() {
    let mut engine = engine(28);
    let first = engine.query("followingFeed", Context::new("dev:alice", args(&[("c", Value::Null)]))).unwrap();
    assert_eq!(first.data.as_array().unwrap().len(), 20);
    assert!(first.complete);
    let next = first.next.clone().expect("a continuation");
    let second = engine.query("followingFeed", Context::new("dev:alice", args(&[("c", Value::String(next))]))).unwrap();
    assert_eq!(second.data.as_array().unwrap().len(), 9, "the other eight of bob's and carol's one");
    assert_eq!(second.next, None);
    assert!(second.complete);
}

/// Set A, runs 2 and 3: a page declared without a cursor said `complete:
/// true, next: null` over more rows than it held.
#[test]
fn a_cursorless_page_with_more_rows_is_not_complete() {
    let mut engine = engine(28);
    let page = engine.query("global", Context::new("dev:alice", args(&[]))).unwrap();
    assert_eq!(page.data.as_array().unwrap().len(), 20);
    assert!(!page.complete, "more rows exist and there is no cursor to continue on");
    assert_eq!(page.next, None);
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), FEED.to_owned())]);
    assert!(bound.notes.iter().any(|n| n.code == "N_NO_CURSOR" && n.message.contains("query global")), "{:?}", bound.notes.iter().map(|n| n.message.clone()).collect::<Vec<_>>());
}

/// Set A, every run: `conversationId ?? 'dm1'` after an optional reference
/// left the literal a string and matched no id.
#[test]
fn a_literal_after_an_optional_identity_is_an_id() {
    let mut engine = engine(1);
    let omitted = engine.query("thread", Context::new("dev:alice", args(&[("conversationId", Value::Null)]))).unwrap();
    assert_eq!(omitted.data.field("title").unwrap(), &Value::String("DM".into()));
}

/// A reader following 500 busy authors gets the actual newest page under
/// the ordinary meter. The old lanes-times-page read was cut before it
/// reached the newest authors at the end of the discovery index.
#[test]
fn a_wide_feed_reads_heads_and_returns_the_complete_newest_page() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), FEED.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    let mut rows = Vec::new();
    for lane in 0..500 {
        let author = id(&format!("dev:u{lane:03}"));
        rows.push(("follows".into(), object([("id", id(&format!("f{lane:03}"))), ("follower", id("dev:alice")), ("followed", author.clone())])));
        for n in 0..25 {
            rows.push(("posts".into(), object([("id", id(&format!("p{lane:03}-{n:02}"))), ("authorId", author.clone()), ("text", Value::String("post".into())), ("at", Value::Int(lane * 100 + n))])));
        }
    }
    engine.seed(rows).unwrap();
    let first = engine.query("followingFeed", Context::new("dev:alice", args(&[("c", Value::Null)]))).unwrap();
    assert!(first.complete, "{first:?}");
    assert!(first.metered.examined < 2_000, "{:?}", first.metered);
    let got: Vec<_> = first.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().clone()).collect();
    assert_eq!(got, (5..25).rev().map(|n| id(&format!("p499-{n:02}"))).collect::<Vec<_>>());
    let second = engine.query("followingFeed", Context::new("dev:alice", args(&[("c", Value::String(first.next.unwrap()))]))).unwrap();
    assert!(second.complete);
    assert_eq!(second.data.as_array().unwrap()[0].field("id").unwrap(), &id("p499-04"));
}

/// Ordered seeking must agree with a full union over duplicates and tied
/// timestamps, in either direction and on every page. A non-seekable index
/// keeps the eager path so equal index keys never disappear on refill.
#[test]
fn lazy_merge_matches_the_eager_union_on_every_page() {
    use snapback4_core::ir::{Expr, Stmt};
    for asc in [false, true] {
        for stable in [false, true] {
            let mut source = FEED.replace("    [f.followed] for f in follows[viewer] first 500 by byFollower", "    [f.followed] for f in follows[viewer] first 500 by byFollower\n    ['dev:bob']\n    ['dev:nobody']");
            if asc { source = source.replace("after c last 20", "after c first 20"); }
            if !stable { source = source.replace("by byAuthorTime: authorId, at, id", "by byAuthorTime: authorId, at").replace("merge posts after c", "merge posts"); }
            let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
            assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
            let mut programs: Vec<_> = bound.programs.iter().map(|p| p.program.clone()).collect();
            let mut fast = Engine::memory(bound.schema.clone(), programs.clone()).unwrap();
            for program in &mut programs {
                for stmt in &mut program.body {
                    if let Stmt::Return(Expr::Merge(merge)) = stmt {
                        for lane in &mut merge.lanes { lane.setup.push(Stmt::Let { name: "eager_only".into(), value: Expr::Literal(Value::Null) }); }
                    }
                }
            }
            let mut eager = Engine::memory(bound.schema.clone(), programs).unwrap();
            let fixture = engine(31);
            let mut rows = Vec::new();
            for name in ["follows", "posts", "conversations"] {
                for mut row in fixture.store().rows(name).unwrap() {
                    if name == "posts" { if let Value::Row(fields) = &mut row { fields.insert("at".into(), Value::Int(1)); } }
                    rows.push((name.to_owned(), row));
                }
            }
            fast.seed(rows.clone()).unwrap(); eager.seed(rows).unwrap();
            let mut cursor = Value::Null;
            for _ in 0..4 {
                let a = fast.query("followingFeed", Context::new("dev:alice", args(&[("c", cursor.clone())]))).unwrap();
                let b = eager.query("followingFeed", Context::new("dev:alice", args(&[("c", cursor.clone())]))).unwrap();
                assert_eq!((&a.data, &a.next, a.complete), (&b.data, &b.next, b.complete), "asc={asc}, stable={stable}");
                let Some(next) = a.next else { break };
                cursor = Value::String(next);
            }
        }
    }
}

#[test]
fn a_nullable_unique_merge_does_not_skip_equal_null_keys() {
    let source = FEED.replace("  at: time", "  at: time ?").replace("by byAuthorTime: authorId, at, id", "unique byAuthorTime: authorId, at").replace("merge posts after c", "merge posts");
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    let mut rows = vec![("follows".into(), object([("id", id("f")), ("follower", id("dev:alice")), ("followed", id("dev:bob"))]))];
    for n in 0..10 { rows.push(("posts".into(), object([("id", id(&format!("p{n:02}"))), ("authorId", id("dev:bob")), ("text", Value::String("post".into())), ("at", Value::Null)]))); }
    engine.seed(rows).unwrap();
    let page = engine.query("followingFeed", Context::new("dev:alice", args(&[("c", Value::Null)]))).unwrap();
    assert_eq!(page.data.as_array().unwrap().len(), 10);
}
