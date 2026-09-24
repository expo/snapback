//! Execute the published intent forms, including their delivery and count semantics.
use super::{args, clean, id, quarry, text, Context, Engine, JobState, Value, LANGUAGE};
use serde_json::{json, Value as Json};
use snapback4_core::{wire, Store};

fn load(engine: &mut Engine, rows: Vec<(&str, Json)>) {
    let rows = rows.into_iter().map(|(table, row)| (table.into(), wire::row_from_json(engine.schema().table(table).unwrap(), &row).unwrap())).collect::<Vec<_>>();
    engine.seed_at(rows, 100).unwrap();
}

#[test]
fn language_intent_views_predicates_search_and_durations_run() {
    let bound = clean("language intent", &quarry(LANGUAGE)[0]);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    load(&mut engine, vec![
        ("intentPosts", json!({"id":"shared", "author":"alice", "handle":"a", "body":"hello quarry", "at":10})),
        ("intentPosts", json!({"id":"removed", "author":"alice", "handle":"b", "body":"old", "at":30, "removed":true})),
        ("intentReposts", json!({"id":"shared", "actor":"bob", "at":20})),
        ("subjects", json!({"id":"subject", "at":10})),
        ("votes", json!({"id":"v1", "subjectId":"subject", "amount":3})),
        ("votes", json!({"id":"v2", "subjectId":"subject", "amount":5})),
    ]);
    load(&mut engine, vec![
        ("recipients", json!({"id":"recipient", "principal":"alice"})),
        ("events", json!({"id":"e0", "recipient":"alice", "at":0, "amount":7})),
        ("events", json!({"id":"e1", "recipient":"alice", "at":19, "amount":9})),
        ("events", json!({"id":"e2", "recipient":"alice", "at":20, "amount":100})),
    ]);
    let run = engine.run_job("intentDaily", args(&[("periodStart", Value::Int(0)), ("periodEnd", Value::Int(20))]), 100).unwrap();
    assert_eq!(run.state, JobState::Done);
    let effects = engine.effects(None, 10).unwrap();
    assert_eq!(effects.len(), 1);
    assert_eq!(effects[0].payload.field("n").unwrap(), &Value::Int(2));
    assert_eq!(effects[0].payload.field("amount").unwrap(), &Value::Int(16));
    let context = || Context::new("alice", args(&[])).at(100);
    let global = engine.query("intentGlobal", context()).unwrap();
    let rows = global.data.as_array().unwrap();
    assert!(global.complete && global.cut.is_none());
    assert_eq!(rows.len(), 2, "a removed source row is filtered before the union");
    assert_eq!(rows[0].field("actor").unwrap(), &id("bob"));
    assert_eq!(rows[1].field("actor").unwrap(), &id("alice"));
    assert_eq!(rows[0].field("id").unwrap(), rows[1].field("id").unwrap(), "equal source ids remain two events; the exposed id is the source id");
    let own = engine.query("intentPage", Context::new("alice", args(&[("owner", id("alice"))]))).unwrap();
    assert_eq!(own.data.as_array().unwrap().len(), 1);
    let found = engine.query("intentSearch", Context::new("alice", args(&[("q", text("QUA"))]))).unwrap();
    assert_eq!(found.data, own.data);
    assert_eq!(engine.query("intentCount", Context::new("alice", args(&[("owner", id("alice"))]))).unwrap().data, Value::Int(2), "the aggregate has no removal filter");
    let subject = engine.query("intentSubject", Context::new("alice", args(&[("subjectId", id("subject"))]))).unwrap();
    assert_eq!(subject.data.field("voteCount").unwrap(), &Value::Int(2));
    assert_eq!(engine.query("intentDurations", context()).unwrap().data, Value::Array([500,30_000,900_000,86_400_000,604_800_000,0].into_iter().map(Value::Int).collect()));
}

#[test]
fn published_digest_streams_past_the_old_limit_and_once_survives_reopen() {
    let source = quarry(snapback4_lang::guide::card("jobs").unwrap()).into_iter().find(|source| source.contains("fn unreadIn(")).unwrap();
    let bound = clean("published digest", &source);
    let path = std::env::temp_dir().join(format!("sb4-guide-digest-{}-{}", std::process::id(), snapback4_core::now_ms())).join("store.sqlite");
    let mut engine = Engine::new(Store::open(&path).unwrap(), bound.schema, bound.programs.into_iter().map(|p|p.program)).unwrap();
    load(&mut engine, vec![
        ("profiles", json!({"id":"pa", "principal":"alice"})),
        ("profiles", json!({"id":"pb", "principal":"bob"})),
        ("conversations", json!({"id":"chat", "title":"A chat"})),
        ("members", json!({"id":"member", "conversationId":"chat", "principal":"alice", "readOrdinal":1})),
    ]);
    load(&mut engine, (0..130).map(|n| ("messages", json!({"id":format!("m{n:03}"), "conversationId":"chat", "senderId":if n == 2 { "alice" } else { "bob" }, "ordinal":n+1, "body":"message", "at":if n == 3 {100} else {10}, "tombstone":n == 4, "expiresAt":if n == 5 {json!(50)} else {Json::Null}}))).collect());
    let period = || args(&[("periodStart", Value::Int(0)), ("periodEnd", Value::Int(100))]);
    let inbox = engine.query("inbox", Context::new("alice", period()).at(100)).unwrap();
    assert!(inbox.complete);
    assert_eq!(inbox.data.as_array().unwrap()[0].field("unread").unwrap(), &Value::Int(125));
    let run = engine.run_job("digest", period(), 100).unwrap();
    assert_eq!(run.state, JobState::Done, "{run:?}");
    let effects = engine.effects(None, 10).unwrap();
    assert_eq!(effects.len(), 1, "a profile without membership receives no private digest");
    assert_eq!(effects[0].payload.field("targetUserId").unwrap(), &id("alice"));
    assert_eq!(effects[0].payload.field("unread").unwrap(), &Value::Int(125));
    println!("guide digest: unread=125 heap={} writes={}", run.heap_peak, run.rows_written);
    drop(engine);
    let mut engine = Engine::open(Store::open(&path).unwrap()).unwrap();
    let repeat = engine.run_job("digest", period(), 100).unwrap();
    assert_eq!(repeat.state, JobState::Done);
    assert_eq!(repeat.rows_written, 0);
    assert_eq!(engine.effects(None, 10).unwrap().len(), 1, "a new run of the period cannot duplicate the effect");
    drop(engine);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
