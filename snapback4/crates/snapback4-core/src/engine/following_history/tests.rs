use super::*;
use crate::{WriteState, value::object};

const SOURCE: &str = include_str!("../../../../snapback4-lang/tests/fixtures/following-view.q");
fn id(s: impl Into<String>) -> Value {
    Value::Id(s.into())
}
fn compile(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn compiled(source: &str) -> (crate::schema::Schema, Vec<crate::ir::Program>) {
    let b = compile(source);
    // The compiler's dev dependency sees the non-test core crate. Cross that
    // boundary through the real persisted codec, not a second implementation.
    let schema = serde_json::from_value(serde_json::to_value(b.schema).unwrap()).unwrap();
    let programs: Vec<crate::ir::Program> = b
        .programs
        .into_iter()
        .map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap())
        .collect();
    (schema, programs)
}
fn engine() -> Engine {
    let source = SOURCE
        .replace(
            "view feed: activity where .actor = viewer or exists follows[viewer, .actor]\n",
            "",
        )
        .replace("return feed last", "return activity last");
    let (schema, programs) = compiled(&source);
    Engine::memory(schema, programs).unwrap()
}
fn adopt(e: &mut Engine) {
    let (schema, programs) = compiled(SOURCE);
    e.adopt_at(schema, programs, 1_000_000).unwrap();
}
fn post(name: &str, actor: &str, at: i64) -> (String, Value) {
    (
        "posts".into(),
        object([
            ("id", id(name)),
            ("authorId", id(actor)),
            ("parentId", Value::Null),
            ("at", Value::Int(at)),
            ("removed", Value::Bool(false)),
        ]),
    )
}
fn edge(actor: &str) -> (String, Value) {
    (
        "follows".into(),
        object([
            ("id", id(format!("edge-{actor}"))),
            ("followerId", id("reader")),
            ("followedId", id(actor)),
        ]),
    )
}
fn request(r: &mut Reader, n: usize) -> Request {
    let o = r
        .opening("reader", "feed", n, 1_000_000, Ceilings::default())
        .unwrap();
    assert!(budget::fits(Ceilings::default(), o.metered));
    o.request
}
fn step(r: &mut Reader, e: &mut Engine, q: &Request) -> Outcome {
    let out = r
        .request(
            e,
            q.clone(),
            Context::new("reader", BTreeMap::new()).at(1_000_000),
        )
        .unwrap();
    assert!(budget::fits(e.ceilings(), out.metered), "{:?}", out.metered);
    let wire: serde_json::Value = serde_json::from_str(out.answer.bytes()).unwrap();
    for field in [
        "metered", "examined", "lanes", "admitted", "epoch", "bound", "heads",
    ] {
        assert!(wire.get(field).is_none());
    }
    out
}
fn mutation(
    e: &mut Engine,
    name: &str,
    viewer: &str,
    args: impl IntoIterator<Item = (&'static str, Value)>,
    at: i64,
) {
    let result = e
        .mutate(
            name,
            None,
            Context::new(
                viewer,
                args.into_iter().map(|(k, v)| (k.into(), v)).collect(),
            )
            .at(at),
        )
        .unwrap();
    assert!(
        matches!(result.state, WriteState::Sent { .. }),
        "{name}: {result:?}"
    );
}

/// Independent full scan: no production traversal helpers, indexes, lane heads,
/// cursor decoder or planned activity reader are used by the oracle.
struct Oracle {
    bound: String,
    edges: BTreeMap<String, String>,
}
impl Oracle {
    fn freeze(e: &Engine) -> Self {
        let seq: i64 = e
            .store()
            .conn()
            .query_row("SELECT COALESCE(MAX(seq),0) FROM _commits", [], |r| {
                r.get(0)
            })
            .unwrap();
        let edges = e
            .store()
            .rows("feedEdges")
            .unwrap()
            .into_iter()
            .filter(|r| r.field("readerId").unwrap() == &id("reader"))
            .map(|r| {
                (
                    r.field("actorId").unwrap().as_str().unwrap().into(),
                    r.field("epoch").unwrap().as_str().unwrap().into(),
                )
            })
            .collect();
        Self {
            bound: format!("{seq:016x}ffffffffffffffff"),
            edges,
        }
    }
    fn rows(&self, e: &Engine) -> Vec<((i64, String), String)> {
        let current: BTreeMap<String, String> = e
            .store()
            .rows("feedEdges")
            .unwrap()
            .into_iter()
            .filter(|r| r.field("readerId").unwrap() == &id("reader"))
            .map(|r| {
                (
                    r.field("actorId").unwrap().as_str().unwrap().into(),
                    r.field("epoch").unwrap().as_str().unwrap().into(),
                )
            })
            .collect();
        let dead: BTreeSet<String> = e
            .store()
            .rows("feedRemovedEvents")
            .unwrap()
            .into_iter()
            .map(|r| r.field("eventId").unwrap().as_str().unwrap().into())
            .collect();
        let births: BTreeMap<String, String> = e
            .store()
            .rows("feedWork")
            .unwrap()
            .into_iter()
            .filter(|r| r.field("kind").unwrap().as_str().unwrap() == "delivery")
            .map(|r| {
                (
                    r.field("eventId").unwrap().as_str().unwrap().into(),
                    r.field("admitted").unwrap().as_str().unwrap().into(),
                )
            })
            .collect();
        let mut rows: Vec<_> = e
            .store()
            .rows("feedPosts")
            .unwrap()
            .into_iter()
            .filter_map(|r| {
                let actor = r.field("actorId").unwrap().as_str().unwrap();
                let id = r.field("id").unwrap().as_str().unwrap();
                if actor != "reader"
                    && (!self.edges.contains_key(actor)
                        || self.edges.get(actor) != current.get(actor))
                {
                    return None;
                }
                if dead.contains(id) || !births.get(id).is_some_and(|b| b <= &self.bound) {
                    return None;
                }
                Some((
                    (r.field("at").unwrap().as_int().unwrap(), id.to_owned()),
                    id.into(),
                ))
            })
            .collect();
        rows.sort_by(|a, b| b.0.cmp(&a.0));
        rows
    }
    fn page(
        &self,
        e: &Engine,
        items: &[Item],
        after: Option<&(i64, String)>,
    ) -> Option<(i64, String)> {
        let rows: Vec<_> = self
            .rows(e)
            .into_iter()
            .filter(|(p, _)| after.is_none_or(|a| p < a))
            .collect();
        assert_eq!(
            items.iter().map(|i| i.id()).collect::<Vec<_>>(),
            rows.iter()
                .take(items.len())
                .map(|(_, id)| id.as_str())
                .collect::<Vec<_>>()
        );
        if items.is_empty() {
            assert!(rows.is_empty());
            after.cloned()
        } else {
            Some(rows[items.len() - 1].0.clone())
        }
    }
}
fn drain(r: &mut Reader, e: &mut Engine, q: &mut Request, oracle: &Oracle) -> (Vec<String>, usize) {
    let mut ids = Vec::new();
    let mut after = None;
    let mut preparing = 0;
    for _ in 0..100_000 {
        let o = step(r, e, q);
        match &o.answer.response {
            Response::Page { items, next } => {
                after = oracle.page(e, items, after.as_ref());
                ids.extend(items.iter().map(|i| i.id().to_owned()));
                if next.is_none() {
                    return (ids, preparing);
                }
            }
            Response::Preparing { .. } | Response::Stalled { .. } => preparing += 1,
            other => panic!("unexpected {other:?}"),
        }
        q.token = o.answer.response.next().map(str::to_owned);
    }
    panic!("settled history failed to finish");
}

#[test]
fn exact_first_page_ties_reposts_and_no_persisted_changes() {
    let mut e = engine();
    e.seed_at(
        [
            post("own", "reader", 1),
            post("old", "quiet", 0),
            post("p", "hot", 1),
            post("tie", "hot", 1),
            edge("quiet"),
            edge("hot"),
        ],
        100,
    )
    .unwrap();
    adopt(&mut e);
    mutation(&mut e, "repost", "quiet", [("postId", id("p"))], 1);
    let oracle = Oracle::freeze(&e);
    let expected = oracle
        .rows(&e)
        .into_iter()
        .map(|(_, id)| id)
        .collect::<Vec<_>>();
    let changes = e.store().conn().total_changes();
    let schema = serde_json::to_string(e.schema()).unwrap();
    let mut r = Reader::new().unwrap();
    let mut q = request(&mut r, 2);
    let first = step(&mut r, &mut e, &q);
    assert!(matches!(first.answer.response, Response::Page { .. }));
    assert_eq!(first.frontier_writes, 0);
    let replay = step(&mut r, &mut e, &q);
    assert_eq!(first.answer.bytes(), replay.answer.bytes());
    let (ids, preparing) = drain(&mut r, &mut e, &mut q, &oracle);
    assert_eq!(ids, expected);
    assert_eq!(preparing, 0);
    assert_eq!(e.store().conn().total_changes(), changes);
    assert_eq!(serde_json::to_string(e.schema()).unwrap(), schema);
}

#[test]
fn resumed_discovery_proves_every_prefix_and_has_no_second_wave_of_charges() {
    let mut e = engine();
    let mut rows = Vec::new();
    for n in 0..120 {
        let actor = format!("a{n:03}");
        rows.push(edge(&actor));
        rows.push(post(&format!("p{n:03}"), &actor, (n % 7) as i64));
    }
    e.seed_at(rows, 100).unwrap();
    adopt(&mut e);
    e.set_ceilings(Ceilings {
        examined: 64,
        ..Default::default()
    });
    let oracle = Oracle::freeze(&e);
    let mut r = Reader::new().unwrap();
    let mut q = request(&mut r, 3);
    let first = step(&mut r, &mut e, &q);
    assert!(matches!(first.answer.response, Response::Preparing { .. }));
    assert_eq!(first.metered.examined, first.metered.examined.min(64));
    assert!(first.frontier_writes > 0);
    let (ids, preparing) = drain(&mut r, &mut e, &mut q, &oracle);
    assert_eq!(ids.len(), 120);
    assert!(preparing > 1);
}

#[test]
fn tokens_replay_expire_restart_after_crash_and_do_not_cross_bindings() {
    let mut e = engine();
    e.seed_at((0..12).map(|n| post(&format!("p{n}"), "reader", n)), 100)
        .unwrap();
    adopt(&mut e);
    let mut r = Reader::new().unwrap();
    let q = request(&mut r, 2);
    let first = step(&mut r, &mut e, &q);
    let mut next = q.clone();
    next.token = first.answer.response.next().map(str::to_owned);
    let second = step(&mut r, &mut e, &next);
    assert_eq!(
        step(&mut r, &mut e, &next).answer.bytes(),
        second.answer.bytes()
    );
    let mut wrong = next.clone();
    wrong.page_size = 3;
    assert!(matches!(
        step(&mut r, &mut e, &wrong).answer.response,
        Response::Restart
    ));
    let out = r
        .request(
            &mut e,
            next.clone(),
            Context::new("other", BTreeMap::new()).at(1_000_000),
        )
        .unwrap();
    assert!(matches!(out.answer.response, Response::Restart));
    let out = r
        .request(
            &mut e,
            next.clone(),
            Context::new(
                "reader",
                BTreeMap::from([("changed".into(), Value::Bool(true))]),
            )
            .at(1_000_000),
        )
        .unwrap();
    assert!(matches!(out.answer.response, Response::Restart));
    let mut wrong = next.clone();
    wrong.token = Some("0".repeat(64));
    assert!(matches!(
        step(&mut r, &mut e, &wrong).answer.response,
        Response::Restart
    ));
    assert_eq!(
        step(&mut r, &mut e, &next).answer.bytes(),
        second.answer.bytes(),
        "forgery must not evict the valid session"
    );
    let out = r
        .request(
            &mut e,
            next.clone(),
            Context::new("reader", BTreeMap::new()).at(1_300_001),
        )
        .unwrap();
    assert!(matches!(out.answer.response, Response::Restart));
    let mut crashed = Reader::new().unwrap();
    assert!(matches!(
        step(&mut crashed, &mut e, &next).answer.response,
        Response::Restart
    ));
    assert!(
        matches!(
            step(&mut crashed, &mut e, &q).answer.response,
            Response::Restart
        ),
        "lost opening response also restarts after crash"
    );
}

#[test]
fn four_consumers_never_evict_or_consume_each_other_and_reclaim_is_bounded() {
    let mut e = engine();
    e.seed_at((0..10).map(|n| post(&format!("p{n}"), "reader", n)), 100)
        .unwrap();
    adopt(&mut e);
    let mut r = Reader::new().unwrap();
    let mut consumers = Vec::new();
    for _ in 0..4 {
        let q = request(&mut r, 2);
        let o = step(&mut r, &mut e, &q);
        consumers.push((q, o));
    }
    assert!(matches!(
        r.opening("reader", "feed", 2, 1_000_000, Ceilings::default()),
        Err(RuntimeError::Structural {
            code: "E_FOLLOWING_QUOTA",
            ..
        })
    ));
    for (q, o) in &consumers {
        assert_eq!(step(&mut r, &mut e, q).answer.bytes(), o.answer.bytes());
    }
    let before = r.accounted_bytes();
    r.cancel("reader", &consumers[0].0.opening, Ceilings::default());
    assert_eq!(r.accounted_bytes(), before);
    let used = r.reclaim(
        1_000_000,
        Ceilings {
            rows_written: 1,
            ..Default::default()
        },
    );
    assert_eq!(used.rows_written, 1);
    assert!(r.accounted_bytes() > 0);
    for _ in 0..10 {
        r.reclaim(
            1_400_000,
            Ceilings {
                rows_written: 1,
                ..Default::default()
            },
        );
    }
    while r.accounted_bytes() > 0 {
        assert!(r.reclaim(1_400_000, Ceilings::default()).rows_written > 0);
    }
}

#[test]
fn original_removal_keeps_repost_but_revoked_replay_restarts() {
    let mut e = engine();
    e.seed_at(
        [
            post("p", "a", 1),
            post("older", "a", 0),
            edge("a"),
            edge("b"),
        ],
        100,
    )
    .unwrap();
    adopt(&mut e);
    mutation(&mut e, "repost", "b", [("postId", id("p"))], 2);
    let mut r = Reader::new().unwrap();
    let q = request(&mut r, 3);
    let first = step(&mut r, &mut e, &q);
    assert!(matches!(first.answer.response, Response::Page { .. }));
    mutation(&mut e, "remove", "a", [("postId", id("p"))], 3);
    assert!(matches!(
        step(&mut r, &mut e, &q).answer.response,
        Response::Restart
    ));
    let oracle = Oracle::freeze(&e);
    let mut q = request(&mut r, 3);
    let (ids, _) = drain(&mut r, &mut e, &mut q, &oracle);
    assert_eq!(ids.len(), 2);
    assert!(!ids.contains(&"p".into()));
}

#[path = "tests/matrix.rs"]
mod matrix;
#[path = "tests/scale.rs"]
mod scale;

mod scale_projection;
