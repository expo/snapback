//! Execute the published intent forms, including their delivery and count semantics.
use super::{args, clean, id, quarry, text, Context, Engine, JobState, Value};
use serde_json::{json, Value as Json};
use snapback4_core::{wire, Store};
use snapback4_device::{device::{Backend, Device, StreamPage}, memory::MemoryStore};
#[allow(dead_code)]
#[path = "../../../snapback4/src/sync_wire.rs"]
mod sync_wire;

fn load(engine: &mut Engine, rows: Vec<(&str, Json)>) {
    let rows = rows.into_iter().map(|(table, row)| (table.into(), wire::row_from_json(engine.schema().table(table).unwrap(), &row).unwrap())).collect::<Vec<_>>();
    engine.seed_at(rows, 100).unwrap();
}

#[test]
fn rules_opening_inherits_message_authority_lifetime_and_sync() {
    let opening = quarry(snapback4_lang::guide::card("rules").unwrap()).remove(0);
    let source = super::in_context(&opening);
    assert!(source.contains(opening.trim()), "compile the published excerpt verbatim");
    let source = format!("{source}\nmutation react(message: messages):\n  return insert reactions {{ message, principal: viewer, emoji: 'hi' }}\n");
    let bound = clean("rules opening", &source);
    let canonical = clean("rules opening without sugar", &source
        .replace("read <- exists members[.message.conversation, viewer]", "read through .message")
        .replace("sync to members[.message.conversation]", "sync"));
    assert_eq!(serde_json::to_value(&bound.schema).unwrap(), serde_json::to_value(&canonical.schema).unwrap());
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    load(&mut engine, vec![
        ("conversations", json!({"id":"room"})),
        ("members", json!({"id":"alice-member", "conversation":"room", "principal":"alice"})),
        ("members", json!({"id":"bob-member", "conversation":"room", "principal":"bob"})),
        ("messages", json!({"id":"message", "conversation":"room", "sender":"alice", "body":"hello", "until":200})),
    ]);
    let reaction = engine.mutate("react", None, Context::new("bob", args(&[("message", id("message"))])).at(100)).unwrap();
    assert!(matches!(reaction.state, snapback4_core::WriteState::Sent { .. }), "{reaction:?}");
    let page = |engine: &mut Engine, viewer, now| engine.query("reacted", Context::new(viewer,
        args(&[("message", id("message")), ("c", Value::Null)])).at(now)).unwrap();
    assert_eq!(page(&mut engine, "alice", 100).data.as_array().unwrap().len(), 1);
    assert!(page(&mut engine, "mallory", 100).data.as_array().unwrap().is_empty());
    let denied = engine.mutate("react", None, Context::new("mallory", args(&[("message", id("message"))])).at(100)).unwrap();
    assert!(matches!(denied.state, snapback4_core::WriteState::Failed { .. }), "{denied:?}");
    for (viewer, expected) in [("alice", true), ("mallory", false)] {
        let snapshot = engine.snapshot_acquisition_page_at(viewer, None, 1000, 100).unwrap();
        let images = serde_json::to_value(&snapshot.events).unwrap();
        assert_eq!(images.to_string().contains("reactions"), expected, "{viewer}: {images}");
    }
    assert!(page(&mut engine, "alice", 200).data.as_array().unwrap().is_empty(), "child expires with its parent");
}

#[test]
fn language_intent_views_predicates_search_and_durations_run() {
    let bound = clean("language intent", &snapback4_lang::guide::language());
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
    let inbox = engine.query("inbox", Context::new("alice", args(&[])).at(100)).unwrap();
    assert!(inbox.complete);
    let conversation = &inbox.data.as_array().unwrap()[0];
    assert_eq!(conversation.field("conversationId").unwrap(), &id("chat"));
    assert!(conversation.field("unread").is_err(), "unread totals cannot withhold the inbox");
    let mut total_args = period();
    total_args.insert("conversationId".into(), id("chat"));
    total_args.insert("readOrdinal".into(), Value::Int(1));
    let totals = engine.query("unreadTotal", Context::new("alice", total_args).at(100)).unwrap();
    assert!(totals.complete);
    assert_eq!(totals.data, Value::Int(125));
    let snapshot = engine.snapshot_acquisition_page_at("alice", None, 1000, 100).unwrap();
    assert!(snapshot.next.is_none());
    let page: StreamPage = serde_json::from_slice(&serde_json::to_vec(&sync_wire::SnapshotReply {
        now: 100, sent: Default::default(), acknowledged: engine.acknowledged("alice", &[], snapshot.watermark).unwrap(),
        acquisitions: snapshot.acquisitions, events: sync_wire::SyncEvents::Snapshot(snapshot.events),
        generation: engine.generation(), store_id: engine.store().meta("store_id").unwrap().unwrap(),
        held: snapshot.held, more: false, next: None, after: None, snapshot: true, watermark: snapshot.watermark,
    }).unwrap()).unwrap();
    let backend = Backend { generation: engine.generation(), schema: engine.schema().public_projection(),
        programs: clean("device digest", &source).programs.into_iter().map(|p| p.program).collect() };
    let mut device = Device::open_store(MemoryStore::new(), Some(backend)).unwrap();
    device.apply(&page, true).unwrap();
    let local_inbox = device.query("inbox", "alice", &json!({}), 100).unwrap();
    assert!(local_inbox.complete && !local_inbox.unavailable, "{local_inbox:?}");
    assert_eq!(local_inbox.data, inbox.data);
    let local_totals = device.query("unreadTotal", "alice", &json!({"conversationId":"chat", "readOrdinal":1, "periodStart":0, "periodEnd":100}), 100).unwrap();
    assert!(local_totals.unavailable, "horizon totals withhold only the decoration: {local_totals:?}");
    println!("guide inbox: device complete=true, rows=1; separate unreadTotal unavailable=true; server unread=125");
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
