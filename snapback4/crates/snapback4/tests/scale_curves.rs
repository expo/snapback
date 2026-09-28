//! Calibration #25: increasing postings/contributors must not increase read work.
//! These are complexity assertions, independent of the host's wall clock.
use rusqlite::{
    StatementStatus,
    trace::{TraceEvent, TraceEventCodes},
};
use snapback4_core::{Context, Engine, Value, value::object};
use std::{cell::RefCell, collections::BTreeMap};

const NOW: i64 = 20 * 86_400_000;
const SOURCE: &str = r#"
table members:
  room: id
  principal: principal
  unique room, principal
  read <- exists members[.room, viewer]
  sync to members[.room]
table messages:
  immutable room, at
  room: id
  body: text <=2000
  at: time
  expiresAt: time ?
  expire at .expiresAt
  search body
  read <- exists members[.room, viewer]
  retain delivered-history
  sync to members[.room] last 500 by .at
query search(q: text <=100, room: id ?, c: cursor ?):
  if room != null:
    require exists members[room, viewer] else NOT_MEMBER
    return messages[room = room] matching q last 20 by .at after c
  return messages matching q where exists members[.room, viewer] last 20 by .at after c
query ordinary(q: text <=100, c: cursor ?):
  return messages matching q last 20 by .at after c
table posts:
  immutable author, parent
  author: principal
  at: time
  parent: posts ?
  removed: bool
  public 'public posts'
table likes:
  immutable post
  post: posts
  at: time
  public 'public likes'
table reposts:
  immutable post
  post: posts
  public 'public reposts'
table follows:
  follower: principal
  followed: principal
  public 'public follows'
view originalPosts: count posts where .parent = null and not .removed by .author
  online only
view receivedLikes: count likes by .post.author
  online only
view receivedReposts: count reposts by .post.author
  online only
view receivedReplies: count posts where .parent != null and not .removed by .parent.author
  online only
view dailyPosts: count posts where .parent = null and not .removed by .author, day(.at)
  online only
view dailyLikes: count likes by .post.author, day(.at)
  online only
view followerCounts: count follows by .followed
  online only
view followingCounts: count follows by .follower
  online only
fn activityDay(d: int):
  return { day: d, posts: dailyPosts[viewer, d], likesReceived: dailyLikes[viewer, d] }
query summary():
  d = day(now)
  return { posts: originalPosts[viewer], likesReceived: receivedLikes[viewer], repostsReceived: receivedReposts[viewer], repliesReceived: receivedReplies[viewer], followers: followerCounts[viewer], following: followingCounts[viewer], days: [activityDay(d - 6), activityDay(d - 5), activityDay(d - 4), activityDay(d - 3), activityDay(d - 2), activityDay(d - 1), activityDay(d)] }
"#;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Work {
    calls: u64,
    preflights: u64,
    payloads: u64,
    steps: i64,
    fullscan: i64,
    sort: i64,
}
thread_local! {
    static WORK: RefCell<Work> = RefCell::default();
    static BEFORE: RefCell<[i32;3]> = const { RefCell::new([0;3]) };
}
fn trace(event: TraceEvent<'_>) {
    let counters = |stmt: &rusqlite::trace::StmtRef<'_>| {
        [
            stmt.get_status(StatementStatus::VmStep),
            stmt.get_status(StatementStatus::FullscanStep),
            stmt.get_status(StatementStatus::Sort),
        ]
    };
    match event {
        TraceEvent::Stmt(stmt, _) => BEFORE.with(|b| *b.borrow_mut() = counters(&stmt)),
        TraceEvent::Profile(stmt, _) => {
            let after = counters(&stmt);
            let delta = BEFORE
                .with(|b| std::array::from_fn::<_, 3, _>(|i| i64::from(after[i] - b.borrow()[i])));
            WORK.with(|w| {
                let mut w = w.borrow_mut();
                w.calls += 1;
                w.preflights += u64::from(stmt.sql().starts_with("SELECT octet_length(r.data)"));
                w.payloads += u64::from(stmt.sql().starts_with("SELECT r.data, i.k"));
                w.steps += delta[0];
                w.fullscan += delta[1];
                w.sort += delta[2];
            });
        }
        _ => {}
    }
}
fn id(s: impl Into<String>) -> Value {
    Value::Id(s.into())
}
fn setup() -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine =
        Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine
        .seed_at(
            (0..101).map(|room| {
                (
                    "members".into(),
                    object([
                        ("id", id(format!("r{room:03}"))),
                        ("room", id(format!("r{room:03}"))),
                        ("principal", id(if room == 100 { "bob" } else { "alice" })),
                    ]),
                )
            }),
            NOW,
        )
        .unwrap();
    engine
}
fn measured<T>(engine: &mut Engine, run: impl FnOnce(&mut Engine) -> T) -> (T, Work) {
    WORK.with(|w| *w.borrow_mut() = Work::default());
    engine.store().conn().trace_v2(
        TraceEventCodes::SQLITE_TRACE_STMT | TraceEventCodes::SQLITE_TRACE_PROFILE,
        Some(trace),
    );
    let result = run(engine);
    engine
        .store()
        .conn()
        .trace_v2(TraceEventCodes::empty(), None);
    (result, WORK.with(|w| w.borrow().clone()))
}
fn search_context(ordinary: bool) -> Context {
    let mut args = BTreeMap::from([
        ("q".into(), Value::String("coffee".into())),
        ("c".into(), Value::Null),
    ]);
    if !ordinary {
        args.insert("room".into(), Value::Null);
    }
    Context::new("alice", args).at(NOW)
}

#[test]
fn search_heads_and_overlap_ignore_posting_population() {
    let mut engine = setup();
    let mut previous = 0;
    let mut baseline = None;
    for population in [10, 50, 100] {
        let mut rows = Vec::new();
        for room in 0..101 {
            for n in previous..population {
                rows.push((
                    "messages".into(),
                    object([
                        ("id", id(format!("r{room:03}-{n:04}"))),
                        ("room", id(format!("r{room:03}"))),
                        ("body", Value::String("coffee coffeepot".into())),
                        (
                            "at",
                            Value::Int(n + if room == 100 { 1_000_000 } else { 0 }),
                        ),
                        ("expiresAt", Value::Null),
                    ]),
                ));
            }
        }
        engine.seed_at(rows, NOW).unwrap();
        previous = population;
        let (explicit, work) = measured(&mut engine, |e| {
            e.query("search", search_context(false)).unwrap()
        });
        assert!(explicit.complete);
        assert_eq!(explicit.data.as_array().unwrap().len(), 20);
        assert!(
            explicit
                .data
                .as_array()
                .unwrap()
                .iter()
                .all(|r| r.field("room").unwrap() != &id("r100"))
        );
        let retained = (0..20)
            .map(|n| format!("r{n:03}-0000"))
            .chain(std::iter::once("r100-0000".into()))
            .collect::<Vec<_>>();
        let ((ordinary, _, current), overlap_work) = measured(&mut engine, |e| {
            e.query_search_at("ordinary", search_context(true), Some(&retained))
        });
        let ordinary = ordinary.unwrap();
        assert_eq!(ordinary.data, explicit.data);
        assert_eq!(current.unwrap(), retained[..20]);
        assert!(ordinary.complete);
        assert_eq!(
            (
                work.fullscan,
                work.sort,
                overlap_work.fullscan,
                overlap_work.sort
            ),
            (0, 0, 0, 0)
        );
        let observed = (
            explicit.metered.examined,
            explicit.metered.index_entries,
            explicit.metered.rule_probes,
            explicit.metered.steps,
            explicit.metered.heap_bytes,
            ordinary.metered.examined,
            ordinary.metered.steps,
            work,
            overlap_work,
        );
        if let Some(baseline) = &baseline {
            assert_eq!(&observed, baseline, "posting population {population}");
        } else {
            baseline = Some(observed);
        }
    }
}

#[test]
fn insights_twenty_points_ignore_contributor_population() {
    let mut engine = setup();
    let mut previous = 0;
    let mut baseline = None;
    for population in [10, 50, 100] {
        for n in previous..population {
            let post = id(format!("p{n:04}"));
            engine
                .seed_at(
                    vec![(
                        "posts".into(),
                        object([
                            ("id", post.clone()),
                            ("author", id("alice")),
                            ("at", Value::Int(NOW)),
                            ("parent", Value::Null),
                            ("removed", Value::Bool(false)),
                        ]),
                    )],
                    NOW,
                )
                .unwrap();
            engine
                .seed_at(
                    vec![(
                        "likes".into(),
                        object([
                            ("id", id(format!("l{n:04}"))),
                            ("post", post),
                            ("at", Value::Int(NOW)),
                        ]),
                    )],
                    NOW,
                )
                .unwrap();
        }
        previous = population;
        let (result, work) = measured(&mut engine, |e| {
            e.query("summary", Context::new("alice", BTreeMap::new()).at(NOW))
                .unwrap()
        });
        assert!(result.complete);
        assert_eq!(result.data.field("posts").unwrap(), &Value::Int(population));
        assert_eq!(
            result.data.field("likesReceived").unwrap(),
            &Value::Int(population)
        );
        assert_eq!(
            result.metered.examined, 20,
            "six totals plus seven pairs of daily points"
        );
        assert_eq!((work.fullscan, work.sort), (0, 0));
        assert_eq!(
            work.preflights, 20,
            "all twenty keys still take the ordinary metered read path"
        );
        assert_eq!(
            work.payloads, 4,
            "only four populated groups need a second storage seek; sixteen empty preflights prove absence"
        );
        let observed = (
            result.metered.examined,
            result.metered.index_entries,
            result.metered.steps,
            result.metered.heap_bytes,
            work,
        );
        if let Some(baseline) = &baseline {
            assert_eq!(&observed, baseline, "contributors {population}");
        } else {
            baseline = Some(observed);
        }
    }
}
