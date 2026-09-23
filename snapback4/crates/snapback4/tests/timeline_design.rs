//! Revision 5: the declared timeline has one write of promotion headroom.
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_lang::recipe::{self, bridge::Mapping};

pub const APP: &str = include_str!("timeline/app.q");

fn engine(duplicate_edge: bool) -> Engine {
    let app = snapback4_lang::compile(&[("schema.q".into(), APP.into())]);
    assert!(app.diagnostics.is_empty(), "{:?}", app.diagnostics);
    let mapping = Mapping::parse(
        "profiles:principal", "posts:authorId:at",
        "follows:followerId:followedId", "reposts:actorId:postId:at",
    ).unwrap();
    let bridge = mapping.render(&app.schema, "feed").unwrap();
    let mut source = recipe::following("feed", "feed").unwrap();
    let follow = if duplicate_edge { "feedAppFollow(authorId)" } else { "insert follows { followerId: viewer, followedId: authorId } if absent" };
    let unfollow = if duplicate_edge { "feedAppUnfollow(authorId)" } else { "delete follows[viewer, authorId]" };
    let register = if duplicate_edge { "feedAppRegister(p.id)" } else { "return p.id" };
    let publish = if duplicate_edge { "feedAppPublish(p.id)" } else { "return p.id" };
    if !duplicate_edge { source.clear(); }
    let operations = format!(r#"
mutation register():
  p = insert profiles {{ principal: viewer }}
  {register}
mutation publish(postId: id):
  p = insert posts {{ id: postId, authorId: viewer, at: now }}
  {publish}
mutation unfollow(authorId: principal):
  {unfollow}
mutation follow(authorId: principal, extra: int):
  {follow}
  if extra > 0:
    insert notes {{ owner: viewer }}
  if extra > 1:
    insert notes {{ owner: viewer }}
"#);
    let declaration = if duplicate_edge { "" } else { DECLARATION };
    let sources = vec![
        ("feed.q".into(), source),
        ("schema.q".into(), format!("{APP}{declaration}{operations}")),
        ("feed_bridge.q".into(), if duplicate_edge { bridge } else { String::new() }),
    ];
    let bound = snapback4_lang::compile(&sources);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    // Reach this state through real mutations, never load/seed, starting from
    // an empty store. All calls use ordinary principals and default ceilings.
    for principal in ["author".to_owned(), "reader".to_owned()]
        .into_iter().chain((0..50).map(|n| format!("f{n}")))
    {
        sent(&mut engine, "register", &principal, [], 0);
    }
    let author_arg = || ("authorId".into(), Value::Id("author".into()));
    // Reader has previously followed/unfollowed: even lazy registration
    // leaves its mode row in place before the measured promotion.
    sent(&mut engine, "follow", "reader", [author_arg(), ("extra".into(), Value::Int(0))], 0);
    sent(&mut engine, "unfollow", "reader", [author_arg()], 0);
    for n in 0..1000 {
        sent(&mut engine, "publish", "author", [("postId".into(), Value::Id(format!("event-{n:04}")))], n);
    }
    for n in 0..50 {
        sent(&mut engine, "follow", &format!("f{n}"), [author_arg(), ("extra".into(), Value::Int(0))], 1000);
    }
    assert_eq!(rows(&engine, "feedFeed"), 1000 + 50 * 865);
    engine
}

fn sent<const N: usize>(engine: &mut Engine, op: &str, viewer: &str, args: [(String, Value); N], at: i64) {
    let outcome = engine.mutate(op, None, Context::new(viewer, args.into()).at(at)).unwrap();
    assert!(matches!(outcome.state, WriteState::Sent { .. }), "setup {op} for {viewer}: {outcome:?}");
}

fn run(engine: &mut Engine, extra: i64) -> snapback4_core::MutationOutcome {
    engine.mutate("follow", None, Context::new("reader", [
        ("authorId".into(), Value::Id("author".into())),
        ("extra".into(), Value::Int(extra)),
    ].into()).at(2000)).unwrap()
}

fn rows(engine: &Engine, table: &str) -> usize { engine.store().rows(table).unwrap().len() }

#[test]
fn ruled_promotion_write_headroom_and_atomic_overflow() {
    let mut recipe = engine(true);
    let overflow = run(&mut recipe, 1);
    println!("installed recipe + app edge + extra: state={:?}, written={}", overflow.state, overflow.metered.rows_written);
    assert!(matches!(&overflow.state, WriteState::Failed { why, .. } if why.code == "E_BOUND"));
    assert_eq!(rows(&recipe, "notes"), 0);
    assert_eq!(rows(&recipe, "follows"), 50);
    assert_eq!(rows(&recipe, "feedFollows"), 50);
    assert_eq!(rows(&recipe, "feedFeed"), 1000 + 50 * 865);
    for table in ["feedPulls", "feedPullCounts", "feedPullTotals"] {
        assert_eq!(rows(&recipe, table), 0, "refusal rolls back {table}");
    }
    let full = run(&mut recipe, 0);
    println!("installed recipe + app edge: state={:?}, written={}", full.state, full.metered.rows_written);
    assert!(matches!(full.state, WriteState::Sent { .. }));
    assert_eq!(full.metered.rows_written, 1024);
    assert_eq!(rows(&recipe, "follows"), 51);
    assert_eq!(rows(&recipe, "feedFollows"), 51);
    assert_eq!(rows(&recipe, "feedFeed"), 1000 + 51 * 865);
    for table in ["feedPulls", "feedPullCounts", "feedPullTotals"] {
        assert_eq!(rows(&recipe, table), 52);
    }

    let mut single = engine(false);
    let mut full_single = engine(false);
    let full = run(&mut full_single,0);
    assert!(matches!(full.state,WriteState::Sent{..}));
    assert_eq!(full.metered.rows_written,1023);
    assert_eq!(rows(&full_single,"follows"),51);assert_eq!(rows(&full_single,"notes"),0);
    assert_eq!(rows(&full_single,"feedFeed"),1000+51*865);
    for table in ["feedPulls","feedPullCounts","feedPullTotals"] {assert_eq!(rows(&full_single,table),52);}
    let mut events=full_single.store().rows("feedFeed").unwrap().into_iter().filter(|r|r.field("readerId").unwrap()==&Value::Id("reader".into())).map(|r|r.field("eventId").unwrap().as_str().unwrap().to_string()).collect::<Vec<_>>();events.sort();
    assert_eq!(events,(135..1000).map(|n|format!("event-{n:04}")).collect::<Vec<_>>());
    println!("one mapped edge: state={:?}, written={}, metered={:?}",full.state,full.metered.rows_written,full.metered);
    let before = rows(&single, "feedFeed");
    let snapshot=|e:&Engine|e.schema().tables.keys().map(|t|(t.clone(),e.store().rows(t).unwrap())).collect::<std::collections::BTreeMap<_,_>>();
    let before_all=snapshot(&single);
    let overflow = run(&mut single, 2);
    assert_eq!(snapshot(&single),before_all);
    assert!(matches!(&overflow.state, WriteState::Failed { why, .. } if why.code == "E_BOUND"), "{overflow:?}");
    assert_eq!(rows(&single, "feedFeed"), before, "overflow must not shorten history");
    assert_eq!(rows(&single, "follows"), 50);
    assert_eq!(rows(&single, "notes"), 0);
    for table in ["feedPulls", "feedPullCounts", "feedPullTotals"] { assert_eq!(rows(&single, table), 0); }
    let admitted = run(&mut single, 1);
    println!("one mapped edge + extra: state={:?}, written={}", admitted.state, admitted.metered.rows_written);
    assert!(matches!(admitted.state, WriteState::Sent { .. }));
    assert_eq!(admitted.metered.rows_written, 1024);
    assert_eq!(rows(&single, "notes"), 1, "the one extra app write fits");
    assert_eq!(rows(&single, "follows"), 51);
    assert_eq!(rows(&single, "feedFeed"), 1000 + 51 * 865);
    for table in ["feedPulls", "feedPullCounts", "feedPullTotals"] {
        assert_eq!(rows(&single, table), 52);
    }
    assert!(!single.schema().tables.contains_key("feedFollows"));
}


pub const DECLARATION: &str = include_str!("timeline/declaration.q");

/// Revision 6: registration pays for the mode during profile creation.
#[test]
fn eager_registration_preserves_recipe_admitted_posting_ceiling() {
    let mut outcomes = Vec::new();
    for declared in [false, true] {
        let plain = snapback4_lang::compile(&[("schema.q".into(), APP.into())]);
        assert!(plain.diagnostics.is_empty(), "{:?}", plain.diagnostics);
        let mapping = Mapping::parse("profiles:principal", "posts:authorId:at", "follows:followerId:followedId", "reposts:actorId:postId:at").unwrap();
        let register = if declared { "return p.id" } else { "feedAppRegister(p.id)" };
        let publish = if declared { "return p.id" } else { "feedAppPublish(p.id)" };
        let read=if declared {"feed[viewer] last 20"} else {"merge feedFeed last 20 by byReaderTime where not exists feedRemovedEvents[eventId = .eventId]:\n    [viewer]\n    feedBroadcast[p.authorId] for p in feedPulls[viewer] by byReaderAuthor"};
        let identity=if declared {".id"} else {".eventId"};
        // Literal bounded application work: exactly 1,021 ordinary notes.
        let operations = format!(r#"
mutation register():
  p = insert profiles {{ principal: viewer }}
  {register}
mutation firstPost():
  for i in range(0, 1021):
    insert notes {{ owner: viewer }}
  p = insert posts {{ id: 'first', authorId: viewer, at: now }}
  {publish}
mutation firstPostOverflow():
  for i in range(0, 1022):
    insert notes {{ owner: viewer }}
  p = insert posts {{ id: 'first', authorId: viewer, at: now }}
  {publish}
query following():
  events = {read}
  return events {{ id: {identity} }}
"#);
        let mut sources = vec![("schema.q".into(), format!("{APP}{}{operations}", if declared { DECLARATION } else { "" }))];
        if !declared {
            sources.push(("feed.q".into(), recipe::following("feed", "feed").unwrap()));
            sources.push(("bridge.q".into(), mapping.render(&plain.schema, "feed").unwrap()));
        }
        let bound = snapback4_lang::compile(&sources);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        sent(&mut engine, "register", "author", [], 0);
        assert_eq!(rows(&engine,"feedAuthors"),1);assert_eq!(rows(&engine,"feedPosts"),0);
        let before=engine.schema().tables.keys().map(|t|(t.clone(),engine.store().rows(t).unwrap())).collect::<std::collections::BTreeMap<_,_>>();
        let overflow=engine.mutate("firstPostOverflow",None,Context::new("author",Default::default()).at(1)).unwrap();
        assert!(matches!(&overflow.state,WriteState::Failed{why,..} if why.code=="E_BOUND"),"{overflow:?}");assert_eq!(overflow.metered.rows_written,1025);
        assert_eq!(engine.schema().tables.keys().map(|t|(t.clone(),engine.store().rows(t).unwrap())).collect::<std::collections::BTreeMap<_,_>>(),before);
        let outcome = engine.mutate("firstPost", None, Context::new("author", Default::default()).at(1)).unwrap();
        println!("first post declared={declared}: state={:?}, rows_written={}, notes={}, posts={}, modes={}",
            outcome.state, outcome.metered.rows_written, rows(&engine, "notes"), rows(&engine, "posts"), rows(&engine, "feedAuthors"));
        assert_eq!(rows(&engine, "notes"), 1021);
        assert_eq!(rows(&engine, "posts"), 1);
        assert_eq!(rows(&engine, "feedAuthors"), 1);
        assert_eq!(rows(&engine,"feedPosts"),1);assert_eq!(rows(&engine,"feedFeed"),1);
        assert_eq!(engine.store().rows("feedFeed").unwrap()[0].field("readerId").unwrap(),&Value::Id("author".into()));
        assert_eq!(engine.store().rows("feedFeed").unwrap()[0].field("eventId").unwrap(),&Value::Id("first".into()));
        assert_eq!(rows(&engine,"feedBroadcast"),0);assert_eq!(rows(&engine,"feedRemovedEvents"),0);
        let page=engine.query("following",Context::new("author",Default::default()).at(2)).unwrap();
        assert_eq!(page.data.as_array().unwrap(),&[snapback4_core::value::object([("id",Value::Id("first".into()))])]);
        outcomes.push(outcome);
    }
    assert!(matches!(outcomes[0].state, WriteState::Sent { .. }));
    assert_eq!(outcomes[0].metered.rows_written, 1024);
    assert!(matches!(outcomes[1].state, WriteState::Sent { .. }));
    assert_eq!(outcomes[1].metered.rows_written, 1024);
}
