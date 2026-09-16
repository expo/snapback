//! Promotion through the published app bridge, shared with both device stores.
#![allow(dead_code)]
use snapback4_core::{Engine, MutationOutcome, QueryOutcome, Value, WriteState, value::object};
use std::collections::BTreeMap;
#[path = "following_app.rs"]
pub mod app;

pub const CODE: &str = "FEED_PROMOTION_PULL_CAP";
pub const AUTHOR: &str = "author";
pub const TRIGGER: &str = "reader50";

pub fn seed(engine: &mut Engine, reader: &str, slots: usize) {
    engine.seed((0..32).map(|n| ("feedAuthors".into(), object([
        ("id", app::id(&format!("a{n}"))), ("principal", app::id(&format!("shared{n}"))), ("shared", Value::Bool(true)),
    ])))).unwrap();
    app::mutate(engine, "register", AUTHOR, &[], 1);
    for n in 0..slots { app::mutate(engine, "follow", reader, &[("authorId", app::id(&format!("shared{n}")))], 2); }
    post(engine, "old-push", 3);
    // The reader follows Q while Q is unshared; 49 further follows succeed,
    // and the 50th further follow is the transaction under test.
    app::mutate(engine, "follow", reader, &[("authorId", app::id(AUTHOR))], 4);
    for n in 0..50 {
        let who = format!("reader{n:02}");
        if who != reader { app::mutate(engine, "follow", &who, &[("authorId", app::id(AUTHOR))], 4); }
    }
    assert!(!shared(engine));
    assert_eq!(posts(&app::query(engine, reader)), ["old-push"]);
}

pub fn post(engine: &mut Engine, post: &str, now: i64) {
    app::mutate(engine, "createPost", AUTHOR, &[("postId", app::id(post)), ("body", Value::String(post.into()))], now);
}

pub fn shared(engine: &Engine) -> bool {
    engine.store().rows("feedAuthors").unwrap().iter().find(|r| r.field("principal") == Ok(&app::id(AUTHOR))).unwrap()
        .field("shared").unwrap() == &Value::Bool(true)
}

pub fn rows(engine: &Engine) -> BTreeMap<String, Vec<Value>> {
    engine.schema().tables.keys().map(|table| (table.clone(), engine.store().rows(table).unwrap())).collect()
}

pub fn promote(engine: &mut Engine) -> MutationOutcome {
    engine.mutate("social.follow", None, app::context(TRIGGER, &[("authorId", app::id(AUTHOR))]).at(5)).unwrap()
}

pub fn refused(engine: &mut Engine) {
    let before = rows(engine);
    let seq = engine.seq().unwrap();
    let result = promote(engine);
    let WriteState::Failed { why, .. } = &result.state else { panic!("promotion must refuse atomically: {:?}", result.state); };
    assert_eq!(why.code, CODE);
    assert_eq!(why.message, "the program refused with FEED_PROMOTION_PULL_CAP");
    assert_eq!(rows(engine), before, "app edge, recipe edge, mode, routes, counts and deliveries all roll back");
    assert_eq!(engine.seq().unwrap(), seq, "no partial promotion reaches sync");
    assert_eq!(result.events, 0);
    assert!(result.tables.is_empty());
    assert!(result.metered.rows_written <= 107);
    println!("W11a refused: examined={} index={} written={} committed_events=0 code={} message={}",
        result.metered.examined, result.metered.index_entries, result.metered.rows_written, why.code, why.message);
}

pub fn promoted(engine: &mut Engine) {
    let result = promote(engine);
    assert!(matches!(result.state, WriteState::Sent { .. }), "{:?}", result.state);
    assert!(shared(engine));
    let routes = engine.store().rows("feedPulls").unwrap();
    assert_eq!(routes.iter().filter(|r| r.field("authorId") == Ok(&app::id(AUTHOR))).count(), 52);
    for count in engine.store().rows("feedPullCounts").unwrap() {
        assert_eq!(count.field("used").unwrap().as_int().unwrap() as usize,
            routes.iter().filter(|r| r.field("readerId") == count.field("readerId")).count());
    }
    println!("W11a promoted: examined={} index={} written={} followers=51 routes=52",
        result.metered.examined, result.metered.index_entries, result.metered.rows_written);
}

pub fn posts(page: &QueryOutcome) -> Vec<String> {
    assert!(page.complete);
    page.data.as_array().unwrap().iter().map(|r| r.field("postId").unwrap().as_str().unwrap().to_owned()).collect()
}

pub fn free_slot(engine: &mut Engine, reader: &str) {
    app::mutate(engine, "unfollow", reader, &[("authorId", app::id("shared0"))], 7);
}

pub fn shared_follow_still_refuses(engine: &mut Engine, reader: &str) {
    let before = rows(engine);
    let result = engine.mutate("social.follow", None, app::context(reader, &[("authorId", app::id("shared0"))])).unwrap();
    let WriteState::Failed { why, .. } = result.state else { panic!("the reader's own full slots must refuse a new shared follow"); };
    assert_eq!(why.code, "FEED_PULL_CAP");
    assert_eq!(rows(engine), before, "the app edge rolls back with the recipe edge");
}

pub fn check_deliveries(engine: &mut Engine, promoted: bool) {
    for n in 0..51 {
        let page = app::query(engine, &format!("reader{n:02}"));
        assert_eq!(posts(&page), if n == 50 && !promoted { vec![] } else { vec!["new-post", "old-push"] });
    }
    assert_eq!(posts(&app::query(engine, AUTHOR)), ["new-post", "old-push"]);
    assert_eq!(engine.store().rows("feedBroadcast").unwrap().len(), usize::from(promoted));
}
