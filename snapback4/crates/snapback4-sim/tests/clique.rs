//! What the Clique lane and its day-two session attributed to Snapback 4,
//! each as the case they hit, against the fix (benchmarks/runs/2026-09-12-
//! snapback4-clique-0002).

use snapback4_core::engine::{Context, Engine, WriteState};
use snapback4_core::partition::holdings;
use snapback4_core::value::Value;
use snapback4_sim::chat::{CHAT, chat_engine_from};
use std::collections::BTreeMap;

fn id(s: &str) -> Value {
    Value::Id(s.into())
}

fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect()
}

/// M7: a `maintain` added on day two counts the rows that already exist,
/// and the built rows reach every member's partition.
#[test]
fn an_added_aggregate_is_built_from_existing_rows() {
    let without = CHAT.replace("maintain messageCounts: count messages by conversationId\n  read <- exists memberships[.conversationId, viewer]\n", "").replace(", count: messageCounts[.conversationId]", "");
    let mut engine = chat_engine_from(&without, &["dev:alice", "dev:bob"]);
    for n in 0..3 {
        let outcome = engine.mutate("send", Some(&format!("s{n}")), Context::new("dev:alice", args(&[("conversationId", id("c1")), ("body", Value::String(format!("m{n}")))])).at(1_000 + n).with_ids([format!("m{n}")])).unwrap();
        assert!(matches!(outcome.state, WriteState::Sent { .. }));
    }
    let before = engine.seq().unwrap();
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), CHAT.to_owned())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    engine.adopt(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    let counts = engine.store().rows("messageCounts").unwrap();
    assert_eq!(counts.len(), 1, "{counts:?}");
    assert_eq!(counts[0].field("value").unwrap(), &Value::Int(3));
    // The built row streams to an established member.
    let page = engine.stream("dev:bob", before, 100).unwrap();
    assert!(page.events.iter().any(|e| e.table == "messageCounts" && e.kind == "put"), "{:?}", page.events);
    let (events, _) = engine.snapshot("dev:bob").unwrap();
    assert_eq!(holdings(&events)["messageCounts"].len(), 1);
    // And a further send counts on top of the backfill.
    engine.mutate("send", Some("s9"), Context::new("dev:bob", args(&[("conversationId", id("c1")), ("body", Value::String("four".into()))])).at(2_000).with_ids(["m9".to_owned()])).unwrap();
    assert_eq!(engine.store().rows("messageCounts").unwrap()[0].field("value").unwrap(), &Value::Int(4));
}

/// M5: a row past its `expire` column is absent to every reader from that
/// moment, and the sweep's deletion streams to every device holding it.
#[test]
fn an_expired_row_is_absent_then_swept() {
    let with = CHAT
        .replace("  editedAt: time ?\n  at: time\n  by byConvTime: conversationId, at, id\n", "  editedAt: time ?\n  at: time\n  expiresAt: time ?\n  by byConvTime: conversationId, at, id\n  by byExpiresAt: expiresAt\n  expire at .expiresAt\n")
        .replace("mutation edit(messageId: messages, body: text <=4000):", "mutation sendBrief(conversationId: conversations, body: text <=4000, ttl: int ?):\n  require exists memberships[conversationId, viewer] else NOT_MEMBER\n  row = insert messages { conversationId, authorId: viewer, body, at: now, expiresAt: now + ttl if ttl != null else null }\n  return { id: row.id, brief: ttl != null }\n\nmutation edit(messageId: messages, body: text <=4000):");
    let mut engine = chat_engine_from(&with, &["dev:alice", "dev:bob"]);
    let send = |engine: &mut Engine, op: &str, body: &str, ttl: Option<i64>, at: i64| {
        let mut a = args(&[("conversationId", id("c1")), ("body", Value::String(body.into()))]);
        if let Some(ttl) = ttl {
            a.insert("ttl".into(), Value::Int(ttl));
        }
        let outcome = engine.mutate("sendBrief", Some(op), Context::new("dev:alice", a).at(at).with_ids([op.to_owned()])).unwrap();
        assert!(matches!(outcome.state, WriteState::Sent { .. }), "{:?}", outcome.state);
    };
    send(&mut engine, "keep", "forever", None, 1_000);
    send(&mut engine, "brief", "a while", Some(500), 1_000);
    let thread = |engine: &mut Engine, viewer: &str, now: i64| -> Vec<String> {
        let read = engine.query("thread", Context::new(viewer, args(&[("conversationId", id("c1"))])).at(now)).unwrap();
        read.data.as_array().unwrap().iter().map(|m| m.field("body").unwrap().as_str().unwrap().to_owned()).collect()
    };
    assert_eq!(thread(&mut engine, "dev:bob", 1_400), vec!["forever", "a while"]);
    // At the instant of expiry the row is gone to readers, the sweep not yet run.
    assert_eq!(thread(&mut engine, "dev:bob", 1_500), vec!["forever"]);
    assert_eq!(engine.store().rows("messages").unwrap().len(), 2);
    // The author cannot edit what expired: it is not found.
    let edited = engine.mutate("edit", Some("e1"), Context::new("dev:alice", args(&[("messageId", id("brief")), ("body", Value::String("late".into()))])).at(1_600)).unwrap();
    assert!(matches!(edited.state, WriteState::Failed { .. }), "{:?}", edited.state);
    // The sweep deletes it, once, and the deletion streams to bob's device.
    let before = engine.seq().unwrap();
    assert_eq!(engine.sweep_expired(1_600, 100).unwrap(), 1);
    assert_eq!(engine.sweep_expired(1_600, 100).unwrap(), 0);
    assert_eq!(engine.store().rows("messages").unwrap().len(), 1);
    let page = engine.stream("dev:bob", before, 100).unwrap();
    assert!(page.events.iter().any(|e| e.table == "messages" && e.kind == "del" && e.id == "brief"), "{:?}", page.events);
    let (events, _) = engine.snapshot("dev:bob").unwrap();
    assert_eq!(holdings(&events)["messages"].len(), 1);
    // A null time never expires.
    assert_eq!(thread(&mut engine, "dev:bob", i64::MAX / 2), vec!["forever"]);
}

fn boxed(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
    let mut out = ((payload.len() + 8) as u32).to_be_bytes().to_vec();
    out.extend_from_slice(kind);
    out.extend_from_slice(payload);
    out
}

/// The smallest MP4: an `ftyp` and a `moov` with an `mvhd` of `ms` milliseconds.
fn boxed_ftyp_with(ms: u32) -> Vec<u8> {
    let mut mvhd = vec![0u8; 20];
    mvhd[12..16].copy_from_slice(&1000u32.to_be_bytes());
    mvhd[16..20].copy_from_slice(&ms.to_be_bytes());
    let mut mp4 = boxed(b"ftyp", b"isom\x00\x00\x02\x00isomiso2");
    mp4.extend(boxed(b"moov", &boxed(b"mvhd", &mvhd)));
    mp4
}

fn boxed_ftyp() -> Vec<u8> {
    boxed_ftyp_with(4_500)
}

fn png(width: u32, height: u32) -> Vec<u8> {
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    png.extend_from_slice(&13u32.to_be_bytes());
    png.extend_from_slice(b"IHDR");
    png.extend_from_slice(&width.to_be_bytes());
    png.extend_from_slice(&height.to_be_bytes());
    png.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
    png
}

/// M4/M5: an upload is the uploader's until a row claims it; the row's read
/// rule then decides who is served; a deleted row stops the bytes; a
/// one-view image is served once per principal.
#[test]
fn an_asset_is_served_by_its_home_rows_read_rule() {
    let once = CHAT
        .replace("photo: image <=5000000 ?", "photo: image <=5000000 once ?\n  clip: video <=52428800 ?")
        .replace("mutation edit(", "mutation sendClip(conversationId: conversations, clip: video <=52428800):\n  require exists memberships[conversationId, viewer] else NOT_MEMBER\n  require clip.duration <= 60000 else TOO_LONG\n  row = insert messages { conversationId, authorId: viewer, clip, at: now }\n  return { id: row.id, seconds: clip.duration }\n\nmutation edit(");
    let mut engine = chat_engine_from(&once, &["dev:alice", "dev:bob"]);
    // Bytes that are not an image, and an image larger than the column, are refused.
    assert_eq!(engine.store_asset("dev:alice", b"not an image", 1_000).unwrap_err().code(), "E_ASSET_TYPE");
    let mut big = png(1, 1);
    big.resize(5_000_001, 0);
    assert_eq!(engine.store_asset("dev:alice", &big, 1_000).unwrap_err().code(), "E_ASSET_TOO_LARGE");
    let asset = engine.store_asset("dev:alice", &png(640, 480), 1_000).unwrap();
    assert_eq!((asset.content_type.as_str(), asset.width, asset.height, asset.bytes), ("image/png", Some(640), Some(480), 33));
    // Unclaimed: the uploader sees it, nobody else does.
    assert!(engine.asset_access("dev:alice", &asset.id, 1_001).is_ok());
    assert_eq!(engine.asset_access("dev:bob", &asset.id, 1_001).unwrap_err().code(), "E_ASSET_UNKNOWN");
    // Bob cannot place alice's upload.
    let photo = |id: &str| Value::Map(BTreeMap::from([("id".to_owned(), Value::Id(id.to_owned()))]).into());
    let stolen = engine.mutate("sendPhoto", Some("p0"), Context::new("dev:bob", args(&[("conversationId", id("c1")), ("photo", photo(&asset.id))])).at(1_002).with_ids(["x0".to_owned()])).unwrap();
    assert!(matches!(&stolen.state, WriteState::Failed { why, .. } if why.code == "E_ASSET_UNKNOWN"), "{:?}", stolen.state);
    // Alice sends it: the row carries the server's facts, not the client's.
    let sent = engine.mutate("sendPhoto", Some("p1"), Context::new("dev:alice", args(&[("conversationId", id("c1")), ("photo", photo(&asset.id))])).at(1_003).with_ids(["msg1".to_owned()])).unwrap();
    assert!(matches!(sent.state, WriteState::Sent { .. }), "{:?}", sent.state);
    let row = engine.store().rows("messages").unwrap().remove(0);
    assert_eq!(row.field("photo").unwrap().field("width").unwrap(), &Value::Int(640));
    assert_eq!(row.field("photo").unwrap().field("type").unwrap(), &Value::String("image/png".into()));
    // A second home for the same upload is refused.
    let twice = engine.mutate("sendPhoto", Some("p2"), Context::new("dev:alice", args(&[("conversationId", id("c1")), ("photo", photo(&asset.id))])).at(1_004).with_ids(["msg2".to_owned()])).unwrap();
    assert!(matches!(&twice.state, WriteState::Failed { why, .. } if why.code == "E_ASSET_PLACED"), "{:?}", twice.state);
    // A member is served once; the second view is refused; a stranger never.
    let grant = engine.asset_access("dev:bob", &asset.id, 1_005).unwrap();
    assert!(grant.once && grant.content_type == "image/png" && grant.path.is_file());
    assert_eq!(engine.asset_access("dev:bob", &asset.id, 1_006).unwrap_err().code(), "E_ASSET_VIEWED");
    assert_eq!(engine.asset_access("dev:mallory", &asset.id, 1_006).unwrap_err().code(), "E_ASSET_UNKNOWN");
    assert!(engine.asset_access("dev:alice", &asset.id, 1_007).is_ok(), "the uploader is never counted");
    // A video: the mutation reads the server's facts from an argument that
    // carried only the id, and the row keeps every fact key.
    let mut mp4 = boxed_ftyp();
    assert_eq!(engine.store_asset("dev:alice", &mp4, 1_007).unwrap().duration, Some(4_500));
    mp4.push(0);
    let clip = engine.store_asset("dev:alice", &mp4, 1_007).unwrap();
    let sent = engine.mutate("sendClip", Some("v1"), Context::new("dev:alice", args(&[("conversationId", id("c1")), ("clip", photo(&clip.id))])).at(1_007).with_ids(["clip1".to_owned()])).unwrap();
    match &sent.state {
        WriteState::Sent { result, .. } => assert_eq!(result.field("seconds").unwrap(), &Value::Int(4_500)),
        other => panic!("{other:?}"),
    }
    let long = engine.store_asset("dev:alice", &boxed_ftyp_with(120_000), 1_007).unwrap();
    let refused = engine.mutate("sendClip", Some("v2"), Context::new("dev:alice", args(&[("conversationId", id("c1")), ("clip", photo(&long.id))])).at(1_007).with_ids(["clip2".to_owned()])).unwrap();
    assert!(matches!(&refused.state, WriteState::Failed { why, .. } if why.code == "TOO_LONG"), "{:?}", refused.state);
    let stored = engine.store().rows("messages").unwrap().into_iter().find(|m| m.field("id").unwrap() == &id("clip1")).unwrap();
    assert_eq!(stored.field("clip").unwrap().field("duration").unwrap(), &Value::Int(4_500));
    assert_eq!(stored.field("clip").unwrap().field("width").unwrap(), &Value::Null);
    // Deleting the message releases the asset: served to nobody, then unlinked.
    let gone = engine.mutate("unsend", Some("u1"), Context::new("dev:alice", args(&[("messageId", id("msg1"))])).at(1_008)).unwrap();
    assert!(matches!(gone.state, WriteState::Sent { .. }));
    assert_eq!(engine.asset_access("dev:alice", &asset.id, 1_009).unwrap_err().code(), "E_ASSET_UNKNOWN");
    assert_eq!(engine.sweep_assets(1_010).unwrap(), 1);
    assert!(!grant.path.exists());
    assert!(engine.store().asset(&asset.id).unwrap().is_none());
}

/// M8: a job sweeps a table a chunk per commit as the system principal;
/// the rows it writes reach every partition; a changed program parks it.
#[test]
fn a_job_sweeps_in_chunks_and_its_rows_reach_the_partition() {
    let with = CHAT.replace("mutation edit(messageId: messages, body: text <=4000):", "job stamp(stampedAt: time):\n  chunk m in messages first 2 by byId:\n    update messages[m.id] { editedAt: stampedAt }\n  chunk c in conversations first 10 by byId:\n    update conversations[c.id] { title: 'swept' }\n\nmutation edit(messageId: messages, body: text <=4000):");
    let mut engine = chat_engine_from(&with, &["dev:alice", "dev:bob"]);
    for n in 0..5 {
        engine.mutate("send", Some(&format!("s{n}")), Context::new("dev:alice", args(&[("conversationId", id("c1")), ("body", Value::String(format!("m{n}")))])).at(1_000 + n).with_ids([format!("m{n}")])).unwrap();
    }
    // A job is not a mutation: no caller runs it.
    assert!(engine.mutate("stamp", None, Context::new("dev:alice", args(&[("stampedAt", Value::Int(7))])).at(2_000)).is_err());
    let before = engine.seq().unwrap();
    let run = engine.run_job("stamp", args(&[("stampedAt", Value::Int(7))]), 2_000).unwrap();
    assert_eq!(run.state, snapback4_core::JobState::Done, "{run:?}");
    // Five messages two at a time: 2 + 2 + 1 (which ends the sweep), then one chunk of conversations.
    assert_eq!((run.chunks, run.rows_written), (4, 6), "{run:?}");
    assert!(engine.store().rows("messages").unwrap().iter().all(|m| m.field("editedAt").unwrap() == &Value::Int(7)));
    assert_eq!(engine.store().rows("conversations").unwrap()[0].field("title").unwrap(), &Value::String("swept".into()));
    let page = engine.stream("dev:bob", before, 100).unwrap();
    assert_eq!(page.events.iter().filter(|e| e.table == "messages" && e.kind == "put").count(), 5, "{:?}", page.events);
    assert!(engine.run_job_chunk(2_001).unwrap().is_none(), "nothing left to run");
    // A run queued under one program parks when the program changes.
    let queued = engine.enqueue_job("stamp", args(&[("stampedAt", Value::Int(8))]), 2_002).unwrap();
    let changed = with.replace("{ title: 'swept' }", "{ title: 'swept twice' }");
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), changed)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    engine.adopt(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    let parked = engine.run_job_chunk(2_003).unwrap().unwrap();
    assert_eq!((parked.id.as_str(), parked.state), (queued.as_str(), snapback4_core::JobState::Parked));
    assert!(parked.error.unwrap().starts_with("E_JOB_GENERATION"));
}

/// M8: a schedule fires its job once per period boundary from the server's
/// clock, with the period it covers, and never twice for one boundary.
#[test]
fn a_schedule_fires_once_per_boundary() {
    let with = CHAT.replace("mutation edit(messageId: messages, body: text <=4000):", "job tick(periodStart: time, periodEnd: time):\n  chunk m in messages first 10 by byId:\n    update messages[m.id] { editedAt: periodEnd, body: 'ticked' }\n\nschedule ticking every 2m: tick\n\nmutation edit(messageId: messages, body: text <=4000):");
    let mut engine = chat_engine_from(&with, &["dev:alice"]);
    assert_eq!(engine.schema().schedules.len(), 1);
    engine.mutate("send", Some("s0"), Context::new("dev:alice", args(&[("conversationId", id("c1")), ("body", Value::String("m".into()))])).at(1_000).with_ids(["m0".to_owned()])).unwrap();
    let minute = 60_000;
    // First sight of the schedule: it starts from its next boundary.
    assert!(engine.fire_schedules(10 * minute + 5_000).unwrap().is_empty());
    assert!(engine.fire_schedules(11 * minute).unwrap().is_empty());
    // The boundary at 12 minutes passes: one run, covering [10m, 12m).
    assert_eq!(engine.fire_schedules(12 * minute + 1).unwrap(), vec!["ticking".to_owned()]);
    assert!(engine.fire_schedules(12 * minute + 30_000).unwrap().is_empty(), "the same boundary never fires twice");
    let run = engine.run_job_chunk(12 * minute + 2).unwrap().unwrap();
    assert_eq!(run.state, snapback4_core::JobState::Done);
    let stamped = engine.store().rows("messages").unwrap().remove(0);
    assert_eq!((stamped.field("editedAt").unwrap(), stamped.field("body").unwrap()), (&Value::Int(12 * minute), &Value::String("ticked".into())));
    // A boundary crossed while the server was down fires once on return.
    assert_eq!(engine.fire_schedules(20 * minute).unwrap().len(), 1);
    assert_eq!(engine.jobs(10).unwrap().len(), 2);
}

/// The compiler refuses a schedule that names a mutation, or a job whose
/// arguments the clock cannot supply, and a chunk over a movable index.
#[test]
fn jobs_and_schedules_are_checked() {
    let compile = |source: String| snapback4_lang::compile(&[("schema.q".to_owned(), source)]);
    let names = |bound: &snapback4_lang::Bound| bound.diagnostics.iter().map(|d| d.code.clone()).collect::<Vec<_>>();
    assert_eq!(names(&compile(CHAT.replace("mutation edit(", "schedule s every 2m: send\n\nmutation edit("))), vec!["E_SCHEDULE"]);
    assert_eq!(names(&compile(CHAT.replace("mutation edit(", "job j(who: principal):\n  chunk c in conversations first 10 by byId:\n    update conversations[c.id] { title: 'x' }\n\nschedule s every 1d at 08:00: j\n\nmutation edit("))), vec!["E_SCHEDULE"]);
    assert_eq!(names(&compile(CHAT.replace("mutation edit(", "job j():\n  chunk m in messages first 10 by byConvTime:\n    update messages[m.id] { editedAt: now }\n\nmutation edit("))), vec!["E_JOB_CURSOR_INDEX"]);
    assert_eq!(names(&compile(CHAT.replace("mutation edit(", "schedule s every 30s: send\n\nmutation edit("))), vec!["E_QUARRY_SYNTAX"]);
    let ok = compile(CHAT.replace("mutation edit(", "job j(periodEnd: time):\n  chunk c in conversations first 10 by byId:\n    update conversations[c.id] { title: 'x' }\n\nschedule daily every 1d at 08:00: j\n\nmutation edit("));
    assert!(ok.diagnostics.is_empty(), "{:?}", ok.diagnostics);
    assert_eq!((ok.schema.schedules[0].every_ms, ok.schema.schedules[0].offset_ms), (86_400_000, 8 * 3_600_000));
    // A synced table without a horizon is noted, with the index a horizon would name.
    let bound = compile(CHAT.to_owned());
    let horizons: Vec<&str> = bound.notes.iter().filter(|n| n.code == "N_NO_HORIZON").map(|n| n.message.as_str()).collect();
    assert!(horizons.iter().any(|m| m.starts_with("table conversations:")) && horizons.iter().any(|m| m.starts_with("table memberships:")), "{horizons:?}");
    assert!(!horizons.iter().any(|m| m.starts_with("table messages:") || m.starts_with("table messageCounts:")), "{horizons:?}");
    // A merge over hundreds of lanes is noted with its row count.
    let wide = compile(CHAT.replace("mutation edit(", "query everything(c: cursor ?):\n  return merge messages after c last 20 by byConvTime:\n    [m.conversationId] for m in memberships[viewer] first 500 by byPrincipalConversation\n\nmutation edit("));
    assert!(wide.diagnostics.is_empty(), "{:?}", wide.diagnostics);
    let note = wide.notes.iter().find(|n| n.code == "N_WIDE_MERGE").expect("a wide merge is noted");
    assert!(note.message.contains("500 lanes") && note.message.contains("one head per lane") && !note.message.contains("10500 rows"), "{}", note.message);
}

/// M8: `sum(page, .x)` as the README spells it, on both hosts' IR; a bare
/// `return` is `return null`.
#[test]
fn sum_over_a_page_and_a_bare_return() {
    let with = CHAT.replace("mutation edit(", "query joined():\n  return sum(memberships[viewer] first 50 by byPrincipalConversation, .joinedAt)\n\nquery nothing():\n  require exists memberships['c1', viewer] else NOT_MEMBER\n  return\n\nmutation edit(");
    let mut engine = chat_engine_from(&with, &["dev:alice", "dev:bob", "dev:carol"]);
    let read = engine.query("joined", Context::new("dev:bob", BTreeMap::new()).at(1_000)).unwrap();
    assert_eq!(read.data, Value::Int(1), "{read:?}");
    let read = engine.query("nothing", Context::new("dev:bob", BTreeMap::new()).at(1_000)).unwrap();
    assert_eq!(read.data, Value::Null);
    let bad = snapback4_lang::compile(&[("schema.q".to_owned(), CHAT.replace("mutation edit(", "query names():\n  return sum(memberships[viewer] first 50 by byPrincipalConversation, .role)\n\nmutation edit("))]);
    assert_eq!(bad.diagnostics.iter().map(|d| d.code.as_str()).collect::<Vec<_>>(), vec!["E_QUARRY_TYPE"]);
}

/// M6 at scale: a snapshot is paged; the pages' union is the whole
/// partition, no row twice, the watermark pinned by the first page; a
/// group joined between pages arrives through the log.
#[test]
fn a_snapshot_is_paged() {
    let with = CHAT.replace("last 500 by byConvTime", "last 5000 by byConvTime");
    let mut engine = chat_engine_from(&with, &["dev:alice", "dev:bob"]);
    let mut rows = Vec::new();
    for n in 0..4_500 {
        rows.push(("messages".to_owned(), snapback4_core::value::object([("id", id(&format!("m{n:05}"))), ("conversationId", id("c1")), ("authorId", id("dev:alice")), ("body", Value::String(format!("{n}"))), ("at", Value::Int(1_000 + n))])));
    }
    engine.seed(rows).unwrap();
    let (whole, watermark) = engine.snapshot("dev:bob").unwrap();
    let mut paged = Vec::new();
    let mut after: Option<String> = None;
    let mut pages = 0;
    loop {
        let (events, w, next) = engine.snapshot_page("dev:bob", after.as_deref(), 2_000).unwrap();
        assert_eq!(w, watermark);
        assert!(events.len() <= 2_000);
        pages += 1;
        paged.extend(events);
        if pages == 2 {
            // Between pages, the world moves: a new conversation for bob.
            engine.seed([("conversations".to_owned(), snapback4_core::value::object([("id", id("c2")), ("title", Value::String("Side".into())), ("creatorId", id("dev:alice"))])), ("memberships".to_owned(), snapback4_core::value::object([("id", id("mb2")), ("conversationId", id("c2")), ("principal", id("dev:bob")), ("role", Value::String("member".into())), ("joinedAt", Value::Int(9))]))]).unwrap();
        }
        match next {
            Some(next) => after = Some(next),
            None => break,
        }
    }
    assert!(pages >= 3, "{pages} pages");
    let ids = |events: &[snapback4_core::partition::Event]| events.iter().filter(|e| e.table == "messages").map(|e| e.id.clone()).collect::<std::collections::BTreeSet<_>>();
    assert_eq!(ids(&paged).len(), 4_500);
    assert_eq!(ids(&paged), ids(&whole));
    assert_eq!(paged.iter().filter(|e| e.table == "messages").count(), 4_500, "no row twice");
    // The conversation that appeared between pages reaches bob through the log from the pinned watermark.
    let stream = engine.stream("dev:bob", watermark, 100).unwrap();
    assert!(stream.events.iter().any(|e| e.table == "conversations" && e.id == "c2"), "{:?}", stream.events.iter().map(|e| (&e.table, &e.id)).collect::<Vec<_>>());
    assert!(engine.snapshot_page("dev:bob", Some("not-a-token"), 10).is_err());
}

/// The loop bar's one docs loop on 0.1.9: a bare `t first N by index` is
/// the empty prefix, as `chunk` already took it.
#[test]
fn a_bare_table_read_is_the_empty_prefix() {
    let with = CHAT.replace("mutation edit(", "query everyone(c: cursor ?):\n  return profiles after c last 20 by byHandle\n\nquery handles():\n  return profiles first 5 by byHandle\n\nmutation edit(");
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), with.clone())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = chat_engine_from(&with, &["dev:alice"]);
    engine.seed((0..7).map(|n| ("profiles".to_owned(), snapback4_core::value::object([("id", id(&format!("p{n}"))), ("principal", id(&format!("dev:u{n}"))), ("displayName", Value::String(format!("U{n}"))), ("handle", Value::String(format!("user{n}")))])))).unwrap();
    let read = engine.query("handles", Context::new("dev:alice", BTreeMap::new()).at(1_000)).unwrap();
    assert_eq!(read.data.as_array().unwrap().len(), 5);
    let read = engine.query("everyone", Context::new("dev:alice", BTreeMap::new()).at(1_000)).unwrap();
    assert_eq!(read.data.as_array().unwrap().len(), 7);
}

/// M7: adding an optional column with its own constraint is additive; the
/// day-two classifier said Narrowing for a constraint no existing row meets.
#[test]
fn a_new_optional_column_with_a_constraint_is_additive() {
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), CHAT.to_owned())]);
    let with = CHAT.replace("  editedAt: time ?\n", "  editedAt: time ?\n  mood: text 1..8 ?\n");
    let next = snapback4_lang::compile(&[("schema.q".to_owned(), with)]);
    assert!(next.diagnostics.is_empty(), "{:?}", next.diagnostics);
    let steps = snapback4_core::successor::classify(&bound.schema, &next.schema);
    assert_eq!(snapback4_core::successor::worst(&steps), snapback4_core::successor::Change::Additive, "{steps:?}");
}

const FEED: &str = r#"
use identity
use personas alice, bob

table posts:
  authorId: principal
  body: text <=500
  at: time
  by byAuthorTime: authorId, at, id
  public 'posts are public'
  insert <- .authorId = viewer

table follows:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  by byFollowed: followedId, followerId
  public 'follows are public'
  insert <- .followerId = viewer
  delete <- .followerId = viewer

table feed:
  readerId: principal
  postId: posts
  authorId: principal
  at: time
  unique byReaderPost: readerId, postId
  by byReaderTime: readerId, at, id
  read <- .readerId = viewer
  insert <- .authorId = viewer
  sync to .readerId last 200 by byReaderTime

table fanouts:
  postId: posts
  authorId: principal
  at: time
  read <- deny
  insert <- .authorId = viewer

mutation createPost(body: text <=500):
  p = insert posts { authorId: viewer, body, at: now }
  insert feed { readerId: viewer, postId: p.id, authorId: viewer, at: now }
  for f in follows[viewer] first 200 by byFollowed:
    insert feed { readerId: f.followerId, postId: p.id, authorId: viewer, at: now }
  insert fanouts { postId: p.id, authorId: viewer, at: now }
  return { id: p.id }

job fanOut():
  chunk w in fanouts first 5 by byId:
    for f in follows[w.authorId] first 1000 by byFollowed:
      insert feed { readerId: f.followerId, postId: w.postId, authorId: w.authorId, at: w.at } if absent
    delete fanouts[w.id]

schedule fanOutEveryMinute every 1m: fanOut

query following(c: cursor ?):
  return feed[viewer] after c last 20 by byReaderTime { *, post: posts[.postId] }
"#;

/// The `feeds` card, compiled and run: the near followers' entries are
/// written by the mutation, the far ones by the job, once each; a
/// follower's device holds its own entries; the feed is one local page.
#[test]
fn a_feed_fans_out_on_write() {
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), FEED.to_owned())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(!bound.notes.iter().any(|n| n.code == "N_WIDE_MERGE"), "{:?}", bound.notes);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    // 250 followers of alice: 200 near, 50 far.
    engine.seed((0..250).map(|n| ("follows".to_owned(), snapback4_core::value::object([("id", id(&format!("f{n:03}"))), ("followerId", id(&format!("dev:u{n:03}"))), ("followedId", id("dev:alice"))])))).unwrap();
    let posted = engine.mutate("createPost", Some("p1"), Context::new("dev:alice", args(&[("body", Value::String("hello".into()))])).at(1_000).with_ids(["post1".to_owned()])).unwrap();
    assert!(matches!(posted.state, WriteState::Sent { .. }), "{:?}", posted.state);
    assert_eq!(engine.store().rows("feed").unwrap().len(), 201, "the author and the near 200");
    assert_eq!(engine.store().rows("fanouts").unwrap().len(), 1);
    let run = engine.run_job("fanOut", BTreeMap::new(), 2_000).unwrap();
    assert_eq!(run.state, snapback4_core::JobState::Done, "{run:?}");
    assert_eq!(engine.store().rows("feed").unwrap().len(), 251, "the far 50, none twice");
    assert_eq!(engine.store().rows("fanouts").unwrap().len(), 0);
    // A far follower's device holds exactly its own entry; the feed is one page.
    let (events, _) = engine.snapshot("dev:u249").unwrap();
    assert_eq!(holdings(&events)["feed"].len(), 1);
    let read = engine.query("following", Context::new("dev:u249", BTreeMap::new()).at(3_000)).unwrap();
    assert!(read.complete);
    assert_eq!(read.data.as_array().unwrap()[0].field("post").unwrap().field("body").unwrap(), &Value::String("hello".into()));
    // The schedule fires the job from the server's clock.
    engine.fire_schedules(60_000).unwrap();
    assert_eq!(engine.fire_schedules(120_000).unwrap(), vec!["fanOutEveryMinute".to_owned()]);
}
