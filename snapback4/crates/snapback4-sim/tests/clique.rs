//! What the Clique lane and its day-two session attributed to Snapback 4,
//! each as the case they hit, against the fix (benchmarks/runs/2026-09-12-
//! snapback4-clique-0002).

mod following;
mod merge_cursor;
mod trending;

use snapback4_core::engine::{Context, Engine, WriteState};
use snapback4_core::partition::holdings;
use snapback4_core::value::Value;
use snapback4_core::rows::Rows as _;
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
        .replace("mutation edit(", "mutation sendClip(conversationId: conversations, clip: video <=52428800):\n  require exists memberships[conversationId, viewer] else NOT_MEMBER\n  duration = clip.duration\n  require duration != null else DURATION_UNKNOWN\n  require duration <= 60000 else TOO_LONG\n  row = insert messages { conversationId, authorId: viewer, clip, at: now }\n  return { id: row.id, seconds: duration }\n\nmutation edit(");
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
    assert!(engine.asset_access("dev:bob", &asset.id, 1_005).is_ok(), "authorization alone does not spend a view");
    engine.record_asset_view("dev:bob", &asset.id, 1_005).unwrap();
    assert_eq!(engine.asset_access("dev:bob", &asset.id, 1_006).unwrap_err().code(), "E_ASSET_VIEWED");
    assert_eq!(engine.asset_access("dev:mallory", &asset.id, 1_006).unwrap_err().code(), "E_ASSET_UNKNOWN");
    assert!(engine.asset_access("dev:alice", &asset.id, 1_007).unwrap().once, "a placed upload also limits its owner to one completed view");
    engine.record_asset_view("dev:alice", &asset.id, 1_007).unwrap();
    assert_eq!(
        engine
            .asset_access("dev:alice", &asset.id, 1_008)
            .unwrap_err()
            .code(),
        "E_ASSET_VIEWED"
    );
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
    // Unknown duration is rejected at upload admission, before clients decode.
    assert_eq!(
        engine.store_asset("dev:alice", &boxed(b"ftyp", b"isom\x00\x00\x02\x00isomiso2"), 1_007).unwrap_err().code(),
        "E_ASSET_BOUNDS"
    );
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
    // A synced table whose groups can grow, with no horizon, is noted with
    // the index a horizon would name; a group of one row (conversations, by
    // its own id) or a group a cap bounds (memberships) is not.
    let bound = compile(CHAT.to_owned());
    assert!(!bound.notes.iter().any(|n| n.code == "N_NO_HORIZON"), "{:?}", bound.notes);
    let uncapped = compile(CHAT.replace("  cap 50 by conversationId\n", ""));
    let horizons: Vec<&str> = uncapped.notes.iter().filter(|n| n.code == "N_NO_HORIZON").map(|n| n.message.as_str()).collect();
    // Membership guards and insert-rule probes need the whole partition;
    // recommending a horizon here would remove their absence proof.
    assert!(!horizons.iter().any(|m| m.starts_with("table memberships:")), "{horizons:?}");
    assert!(!horizons.iter().any(|m| m.starts_with("table conversations:") || m.starts_with("table messages:") || m.starts_with("table messageCounts:")), "{horizons:?}");
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

/// The `feeds` card's recipe, as the card prints it.
fn feed() -> String {
    snapback4_lang::guide::quarry(snapback4_lang::guide::card("feeds").expect("the feeds card")).remove(0)
}

/// The card's small-account write reaches all five followers and its author.
#[test]
fn a_feed_fans_out_on_write() {
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), feed())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.mutate("register", None, Context::new("dev:alice", BTreeMap::new()).at(1)).unwrap();
    for n in 0..5 {
        let follow = engine.mutate("follow", None, Context::new(format!("dev:u{n}"), args(&[("authorId", id("dev:alice"))])).at(2)).unwrap();
        assert!(matches!(follow.state, WriteState::Sent { .. }), "{:?}", follow.state);
    }
    let posted = engine.mutate("createPost", Some("p1"), Context::new("dev:alice", args(&[("postId", id("post1"))])).at(1_000)).unwrap();
    assert!(matches!(posted.state, WriteState::Sent { .. }), "{:?}", posted.state);
    assert_eq!(engine.store().rows("feed").unwrap().len(), 6);
    let (events, _) = engine.snapshot("dev:u4").unwrap();
    assert_eq!(holdings(&events)["feed"].len(), 1);
    let read = engine.query("following", Context::new("dev:u4", BTreeMap::new()).at(3_000)).unwrap();
    assert!(read.complete);
    assert_eq!(read.data.as_array().unwrap()[0].field("postId").unwrap(), &id("post1"));
}

const SEARCH: &str = r#"
use identity
use personas alice, bob, carol

table profiles:
  principal: principal
  displayName: text <=50
  handle: text <=30 format handle
  unique byPrincipal: principal
  unique byHandle: handle
  by byNameWords: words(displayName, handle), id
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer

table conversations:
  title: text <=120
  read <- exists memberships[.id, viewer]
  insert <- allow
  sync to memberships[.id]

table memberships:
  conversationId: conversations
  principal: principal
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId, id
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[.conversationId, viewer] or created conversations[.conversationId]
  sync to memberships[.conversationId]

table messages:
  conversationId: conversations
  authorId: principal
  body: text <=4000 ?
  caption: text <=200 ?
  at: time
  expiresAt: time ?
  by byConvTime: conversationId, at, id
  by byExpiresAt: expiresAt
  by byConvWords: conversationId, words(body, caption), at, id
  by byWords: words(body, caption), at, id
  expire at .expiresAt
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]
  update <- .authorId = viewer
  sync to memberships[.conversationId] last 500 by byConvTime

query people(q: text <=100):
  return profiles matching q first 20 by byNameWords

query inChat(conversationId: conversations, q: text <=100, c: cursor ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return messages[conversationId] matching q after c last 2 by byConvWords

query everywhere(q: text <=100, c: cursor ?):
  return messages matching q after c last 50 by byWords { *, conversation: conversations[.conversationId] }

mutation send(conversationId: conversations, body: text <=4000, ttl: int ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return insert messages { conversationId, authorId: viewer, body, at: now, expiresAt: now + ttl if ttl != null else null }

mutation edit(messageId: messages, body: text <=4000):
  msg = messages[messageId] ! else NOT_FOUND
  update messages[msg] { body }
"#;

fn search_engine() -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), SEARCH.to_owned())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    let mut rows = vec![
        ("conversations".to_owned(), snapback4_core::value::object([("id", id("c1")), ("title", Value::String("General".into()))])),
        ("conversations".to_owned(), snapback4_core::value::object([("id", id("c2")), ("title", Value::String("Side".into()))])),
        ("memberships".to_owned(), snapback4_core::value::object([("id", id("m1")), ("conversationId", id("c1")), ("principal", id("dev:alice"))])),
        ("memberships".to_owned(), snapback4_core::value::object([("id", id("m2")), ("conversationId", id("c1")), ("principal", id("dev:bob"))])),
        ("memberships".to_owned(), snapback4_core::value::object([("id", id("m3")), ("conversationId", id("c2")), ("principal", id("dev:carol"))])),
    ];
    for (n, (name, handle)) in [("Carol Danvers", "carol"), ("Carl Sagan", "carl"), ("Bob Ross", "bob_ross"), ("Alice", "alice")].iter().enumerate() {
        rows.push(("profiles".to_owned(), snapback4_core::value::object([("id", id(&format!("p{n}"))), ("principal", id(&format!("dev:{handle}"))), ("displayName", Value::String((*name).into())), ("handle", Value::String((*handle).into()))])));
    }
    engine.seed(rows).unwrap();
    engine
}

fn bodies(read: &snapback4_core::QueryOutcome) -> Vec<String> {
    read.data.as_array().unwrap().iter().map(|m| m.field("body").unwrap().as_str().unwrap_or("").to_owned()).collect()
}

/// M5: word-prefix search — case-insensitive over NFC text, newest first,
/// paginated, scoped to a chat or across every chat the viewer may read;
/// people by display name or handle; an empty search finds nothing; an
/// expired row is gone from the results at once.
#[test]
fn a_search_matches_word_prefixes_newest_first() {
    let mut engine = search_engine();
    let send = |engine: &mut Engine, who: &str, conv: &str, body: &str, at: i64, ttl: Option<i64>| {
        let mut a = args(&[("conversationId", id(conv)), ("body", Value::String(body.into()))]);
        if let Some(ttl) = ttl { a.insert("ttl".into(), Value::Int(ttl)); }
        let outcome = engine.mutate("send", Some(&format!("s{at}")), Context::new(who, a).at(at).with_ids([format!("m{at}")])).unwrap();
        assert!(matches!(outcome.state, WriteState::Sent { .. }), "{:?}", outcome.state);
    };
    send(&mut engine, "dev:alice", "c1", "Coffee time at nine", 1_000, None);
    send(&mut engine, "dev:bob", "c1", "the coffers are empty", 1_001, None);
    send(&mut engine, "dev:alice", "c1", "tea instead", 1_002, None);
    send(&mut engine, "dev:bob", "c1", "COFFEE for Carol", 1_003, None);
    send(&mut engine, "dev:carol", "c2", "coffee in the side room", 1_004, None);
    send(&mut engine, "dev:alice", "c1", "brief coffee", 1_005, Some(100));
    let search = |engine: &mut Engine, who: &str, q: &str, cursor: Option<String>, now: i64| {
        let mut a = args(&[("conversationId", id("c1")), ("q", Value::String(q.into()))]);
        if let Some(c) = cursor { a.insert("c".into(), Value::String(c)); }
        engine.query("inChat", Context::new(who, a).at(now)).unwrap()
    };
    // Newest first across every word "cof" is a prefix of, two a page, a cursor to the rest.
    let page = search(&mut engine, "dev:bob", "cof", None, 1_050);
    assert_eq!(bodies(&page), vec!["brief coffee", "COFFEE for Carol"]);
    assert!(page.complete && page.next.is_some(), "{page:?}");
    let page = search(&mut engine, "dev:bob", "cof", page.next.clone(), 1_050);
    assert_eq!(bodies(&page), vec!["the coffers are empty", "Coffee time at nine"]);
    assert!(page.complete && page.next.is_none(), "the last page ends: {page:?}");
    // Case-insensitive; a second term filters the page; an empty search is empty.
    assert_eq!(bodies(&search(&mut engine, "dev:bob", "COF car", None, 1_050)), vec!["COFFEE for Carol"]);
    assert_eq!(bodies(&search(&mut engine, "dev:bob", "coffee nine", None, 1_050)), vec!["Coffee time at nine"]);
    assert!(bodies(&search(&mut engine, "dev:bob", "", None, 1_050)).is_empty());
    assert!(bodies(&search(&mut engine, "dev:bob", "offee", None, 1_050)).is_empty(), "mid-word is not a match");
    // The expired row is gone at once, before the sweep.
    assert_eq!(bodies(&search(&mut engine, "dev:bob", "cof", None, 1_200)), vec!["COFFEE for Carol", "the coffers are empty"]);
    // A non-member is refused; carol's chat never leaks into bob's search.
    assert!(engine.query("inChat", Context::new("dev:carol", args(&[("conversationId", id("c1")), ("q", Value::String("cof".into()))])).at(1_050)).is_err());
    // Everywhere: the unscoped index, the rule checked per row, grouped by the app.
    let everywhere = engine.query("everywhere", Context::new("dev:bob", args(&[("q", Value::String("coffee".into()))])).at(1_050)).unwrap();
    assert_eq!(bodies(&everywhere), vec!["brief coffee", "COFFEE for Carol", "Coffee time at nine"]);
    assert_eq!(everywhere.data.as_array().unwrap()[0].field("conversation").unwrap().field("title").unwrap(), &Value::String("General".into()));
    let everywhere = engine.query("everywhere", Context::new("dev:carol", args(&[("q", Value::String("coffee".into()))])).at(1_050)).unwrap();
    assert_eq!(bodies(&everywhere), vec!["coffee in the side room"]);
    // People: by display name or handle, either word.
    let names = |read: snapback4_core::QueryOutcome| read.data.as_array().unwrap().iter().map(|p| p.field("handle").unwrap().as_str().unwrap().to_owned()).collect::<Vec<_>>();
    assert_eq!(names(engine.query("people", Context::new("dev:alice", args(&[("q", Value::String("car".into()))])).at(1_050)).unwrap()), vec!["carol", "carl"]);
    assert_eq!(names(engine.query("people", Context::new("dev:alice", args(&[("q", Value::String("ross".into()))])).at(1_050)).unwrap()), vec!["bob_ross"]);
    assert_eq!(names(engine.query("people", Context::new("dev:alice", args(&[("q", Value::String("Danv".into()))])).at(1_050)).unwrap()), vec!["carol"]);
    // An edit re-tokenizes: the old words leave the index, the new ones enter.
    let edited = engine.mutate("edit", Some("e1"), Context::new("dev:alice", args(&[("messageId", id("m1000")), ("body", Value::String("Tea time at nine".into()))])).at(1_060)).unwrap();
    assert!(matches!(edited.state, WriteState::Sent { .. }), "{:?}", edited.state);
    assert_eq!(bodies(&search(&mut engine, "dev:bob", "coffee nine", None, 1_070)), Vec::<String>::new());
    assert_eq!(bodies(&search(&mut engine, "dev:bob", "tea", None, 1_070)), vec!["tea instead", "Tea time at nine"]);
    // The same query on a device at the same virtual time as the server.
    let (events, _) = engine.snapshot_at("dev:bob", 1_070).unwrap();
    let device = snapback4_core::rows::MemoryRows::new();
    for event in &events {
        if let Some(row) = &event.data {
            device.put(&event.table, engine.schema().table(&event.table).unwrap(), row, None).unwrap();
        }
    }
    let program = engine.program("inChat").unwrap().clone();
    let local = snapback4_core::engine::local::query(&device, engine.schema(), &program, Context::new("dev:bob", args(&[("conversationId", id("c1")), ("q", Value::String("cof".into()))])).at(1_070), snapback4_core::Ceilings::default()).unwrap();
    assert_eq!(bodies(&local), vec!["brief coffee", "COFFEE for Carol"], "the device page at 1070, before the brief message expires");
}

/// The compiler holds the search to its index: a words index is read with
/// `matching` and nothing else; `matching` needs a words index after exactly
/// its keys; the text is present; a merge stays on plain indexes.
#[test]
fn search_reads_are_checked() {
    let compile = |source: String| snapback4_lang::compile(&[("schema.q".to_owned(), source)]);
    let codes = |bound: &snapback4_lang::Bound| bound.diagnostics.iter().map(|d| d.code.clone()).collect::<Vec<_>>();
    assert!(compile(SEARCH.to_owned()).diagnostics.is_empty());
    let plain_read_of_words = compile(SEARCH.replace("query people(q: text <=100):\n  return profiles matching q first 20 by byNameWords", "query people(q: text <=100):\n  return profiles first 20 by byNameWords"));
    assert_eq!(codes(&plain_read_of_words), vec!["E_QUARRY_UNKNOWN"], "{:?}", plain_read_of_words.diagnostics);
    assert!(plain_read_of_words.diagnostics[0].rewrite.contains("matching q"));
    let no_words_index = compile(SEARCH.replace("query people(q: text <=100):\n  return profiles matching q first 20 by byNameWords", "query people(q: text <=100):\n  return profiles matching q first 20 by byHandle"));
    assert_eq!(codes(&no_words_index), vec!["E_QUARRY_UNKNOWN"], "{:?}", no_words_index.diagnostics);
    let wrong_scope = compile(SEARCH.replace("return messages[conversationId] matching q after c last 2 by byConvWords", "return messages matching q after c last 2 by byConvWords"));
    assert_eq!(codes(&wrong_scope), vec!["E_QUARRY_UNKNOWN"], "{:?}", wrong_scope.diagnostics);
    let optional_text = compile(SEARCH.replace("query people(q: text <=100):", "query people(q: text <=100 ?):"));
    assert_eq!(codes(&optional_text), vec!["E_QUARRY_TYPE"], "{:?}", optional_text.diagnostics);
    assert!(optional_text.diagnostics[0].rewrite.contains("q ?? ''"));
    let unique_words = compile(SEARCH.replace("by byNameWords: words(displayName, handle), id", "unique byNameWords: words(displayName, handle), id"));
    assert_eq!(codes(&unique_words), vec!["E_QUARRY_SYNTAX"], "{:?}", unique_words.diagnostics);
    let words_last = compile(SEARCH.replace("by byNameWords: words(displayName, handle), id", "by byNameWords: words(displayName, handle)"));
    assert_eq!(codes(&words_last), vec!["E_QUARRY_SYNTAX"], "{:?}", words_last.diagnostics);
    let not_text = compile(SEARCH.replace("by byNameWords: words(displayName, handle), id", "by byNameWords: words(principal), id"));
    assert_eq!(codes(&not_text), vec!["E_QUARRY_TYPE"], "{:?}", not_text.diagnostics);
    let merged = compile(SEARCH.replace("query people(q: text <=100):\n  return profiles matching q first 20 by byNameWords", "query people(q: text <=100):\n  return merge messages last 20 by byConvWords:\n    ['c1']"));
    assert_eq!(codes(&merged), vec!["E_QUARRY_UNSUPPORTED"], "{:?}", merged.diagnostics);
}

const EFFECTS: &str = r#"
use personas alice, bob, carol

effect notify

table conversations:
  title: text <=120
  read <- exists memberships[.id, viewer]
  insert <- allow
  sync to memberships[.id]

table memberships:
  conversationId: conversations
  principal: principal
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[.conversationId, viewer] or created conversations[.conversationId]
  sync to memberships[.conversationId]

table messages:
  conversationId: conversations
  authorId: principal
  body: text <=4000
  at: time
  by byConvTime: conversationId, at, id
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]
  sync to memberships[.conversationId] last 500 by byConvTime

table rankings:
  postId: id
  score: int
  unique byPost: postId
  read <- allow
  insert <- viewer = 'service:ranker'
  update <- viewer = 'service:ranker'

mutation send(conversationId: conversations, body: text <=4000):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  msg = insert messages { conversationId, authorId: viewer, body, at: now }
  for m in memberships[conversationId] first 50 by byConversationPrincipal:
    if m.principal != viewer and not exists connected[m.principal]:
      emit notify { targetUserId: m.principal, chatId: conversationId, messageId: msg.id, preview: slice(body, 0, 80) }
  return { id: msg.id }

query online(p: principal):
  return connected[p]

mutation rank(postId: id, score: int):
  upsert rankings[postId] { postId, score }
"#;

#[derive(Debug)]
struct Online(Vec<String>);
impl snapback4_core::Presence for Online {
    fn connections(&self, principal: &str) -> u64 {
        self.0.iter().filter(|p| p.as_str() == principal).count() as u64
    }
}

fn effects_engine() -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), EFFECTS.to_owned())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert_eq!(bound.schema.operations["send"].predicts.as_deref(), Some("eligible"));
    assert_eq!(bound.schema.operations["online"].runs.as_deref(), Some("server"));
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    engine.seed(vec![
        ("conversations".to_owned(), snapback4_core::value::object([("id", id("c1")), ("title", Value::String("General".into()))])),
        ("memberships".to_owned(), snapback4_core::value::object([("id", id("m1")), ("conversationId", id("c1")), ("principal", id("dev:alice"))])),
        ("memberships".to_owned(), snapback4_core::value::object([("id", id("m2")), ("conversationId", id("c1")), ("principal", id("dev:bob"))])),
        ("memberships".to_owned(), snapback4_core::value::object([("id", id("m3")), ("conversationId", id("c1")), ("principal", id("dev:carol"))])),
    ]).unwrap();
    engine
}

/// M6: the push seam. A send emits a notification for every member with no
/// connected client, in the same commit as the message; a worker with a
/// service seat claims it under a lease, settles it, and a failure retries
/// with backoff until the attempts run out; an expired lease goes back to
/// the queue; a stranger's token claims nothing.
#[test]
fn an_emit_is_claimed_and_settled_by_a_worker() {
    let mut engine = effects_engine();
    // bob holds a poll open; carol does not.
    engine.set_presence(Some(std::sync::Arc::new(Online(vec!["dev:bob".into()]))));
    let sent = engine.mutate("send", Some("s1"), Context::new("dev:alice", args(&[("conversationId", id("c1")), ("body", Value::String("Coffee? ".repeat(20)))])).at(1_000).with_ids(["msg1".to_owned()])).unwrap();
    assert!(matches!(sent.state, WriteState::Sent { .. }), "{:?}", sent.state);
    let queued = engine.effects(Some("queued"), 10).unwrap();
    assert_eq!(queued.len(), 1, "{queued:?}");
    assert_eq!(queued[0].payload.field("targetUserId").unwrap(), &id("dev:carol"));
    assert_eq!(queued[0].payload.field("preview").unwrap().as_str().unwrap().chars().count(), 80);
    assert_eq!(engine.query("online", Context::new("dev:alice", args(&[("p", id("dev:bob"))])).at(1_000)).unwrap().data, Value::Int(1));
    assert_eq!(engine.query("online", Context::new("dev:alice", args(&[("p", id("dev:carol"))])).at(1_000)).unwrap().data, Value::Int(0));
    // A worker claims it: one attempt, a lease; a second worker gets nothing.
    let claimed = engine.claim_effects("service:pusher", Some("notify"), 10, 60_000, 2_000).unwrap();
    assert_eq!(claimed.len(), 1);
    let run = &claimed[0];
    assert_eq!((run.state.as_str(), run.attempts, run.claimed_by.as_deref(), run.lease_until), ("running", 1, Some("service:pusher"), Some(62_000)));
    assert!(engine.claim_effects("service:other", None, 10, 60_000, 2_001).unwrap().is_empty());
    // The other worker cannot settle what it does not hold.
    assert_eq!(engine.settle_effect(&run.id, "service:other", snapback4_core::Settled::Done { result: None }, 2_002).unwrap_err().code(), "E_EFFECT_LEASE");
    // A failure retries after a backoff; before it, nothing is due.
    let failed = engine.settle_effect(&run.id, "service:pusher", snapback4_core::Settled::Failed { error: "provider 503".into(), retry: true }, 2_003).unwrap();
    assert_eq!((failed.state.as_str(), failed.next_at, failed.error.as_deref()), ("queued", Some(2_003 + 4_000), Some("provider 503")));
    assert!(engine.claim_effects("service:pusher", None, 10, 60_000, 3_000).unwrap().is_empty(), "not due yet");
    assert!(!engine.effects_due(None, 3_000).unwrap());
    assert!(engine.effects_due(None, 7_000).unwrap());
    let again = engine.claim_effects("service:pusher", None, 10, 60_000, 7_000).unwrap();
    assert_eq!((again.len(), again[0].attempts), (1, 2));
    // The lease expires: the effect is queued again, the attempt kept.
    assert_eq!(engine.requeue_expired_effects(60_000).unwrap(), 0, "the lease still stands");
    assert_eq!(engine.requeue_expired_effects(70_000).unwrap(), 1);
    let requeued = engine.effects(Some("queued"), 10).unwrap();
    assert_eq!((requeued.len(), requeued[0].attempts, requeued[0].claimed_by.as_deref()), (1, 2, None));
    // Settled: sent, with the worker's result kept beside it.
    let third = engine.claim_effects("service:pusher", None, 10, 60_000, 70_001).unwrap();
    let done = engine.settle_effect(&third[0].id, "service:pusher", snapback4_core::Settled::Done { result: Some(snapback4_core::value::object([("providerId", Value::String("apns-1".into()))])) }, 70_002).unwrap();
    assert_eq!(done.state, "sent");
    assert_eq!(done.result.unwrap().field("providerId").unwrap(), &Value::String("apns-1".into()));
    assert_eq!(engine.effect_counts().unwrap().get("sent"), Some(&1));
    assert_eq!(engine.settle_effect("nope", "service:pusher", snapback4_core::Settled::Done { result: None }, 70_003).unwrap_err().code(), "E_EFFECT_UNKNOWN");
    // A worker that gives up, or runs out of attempts, leaves the effect failed.
    engine.set_presence(None);
    engine.mutate("send", Some("s2"), Context::new("dev:alice", args(&[("conversationId", id("c1")), ("body", Value::String("again".into()))])).at(80_000).with_ids(["msg2".to_owned()])).unwrap();
    let both = engine.claim_effects("service:pusher", None, 10, 60_000, 80_001).unwrap();
    assert_eq!(both.len(), 2, "nobody connected without a registry: bob and carol");
    let gave_up = engine.settle_effect(&both[0].id, "service:pusher", snapback4_core::Settled::Failed { error: "no such device".into(), retry: false }, 80_002).unwrap();
    assert_eq!(gave_up.state, "failed");
    let mut id_of = both[1].id.clone();
    let mut at = 80_003;
    for attempt in 1..=snapback4_core::engine::effects::MAX_ATTEMPTS {
        let failed = engine.settle_effect(&id_of, "service:pusher", snapback4_core::Settled::Failed { error: "flaky".into(), retry: true }, at).unwrap();
        if attempt == snapback4_core::engine::effects::MAX_ATTEMPTS {
            assert_eq!(failed.state, "failed", "attempt {attempt}");
            break;
        }
        assert_eq!(failed.state, "queued", "attempt {attempt}");
        at = failed.next_at.unwrap() + 1;
        let next = engine.claim_effects("service:pusher", None, 10, 60_000, at).unwrap();
        assert_eq!(next.len(), 1, "attempt {attempt}");
        id_of = next[0].id.clone();
    }
    assert_eq!(engine.effect_counts().unwrap().get("failed"), Some(&2));
}

/// A service is a principal a rule can name; `connected` on a device reads
/// everyone as connected and says so on the card.
#[test]
fn a_service_is_admitted_by_its_name_and_a_device_defers_presence() {
    let mut engine = effects_engine();
    let stranger = engine.mutate("rank", Some("r1"), Context::new("dev:alice", args(&[("postId", id("p1")), ("score", Value::Int(3))])).at(1_000)).unwrap();
    assert!(matches!(&stranger.state, WriteState::Failed { why, .. } if why.code == "NOT_FOUND"), "{:?}", stranger.state);
    let ranked = engine.mutate("rank", Some("r2"), Context::new("service:ranker", args(&[("postId", id("p1")), ("score", Value::Int(3))])).at(1_000)).unwrap();
    assert!(matches!(ranked.state, WriteState::Sent { .. }), "{:?}", ranked.state);
    assert_eq!(engine.store().rows("rankings").unwrap().len(), 1);
    let program = engine.program("online").unwrap().clone();
    let device = snapback4_core::rows::MemoryRows::new();
    let local = snapback4_core::engine::local::query(&device, engine.schema(), &program, Context::new("dev:bob", args(&[("p", id("dev:carol"))])).at(1_000), snapback4_core::Ceilings::default()).unwrap();
    assert_eq!((local.data, local.complete), (Value::Int(1), false), "a device does not know; the server does");
    // The compiler holds the word to one principal.
    let bad = snapback4_lang::compile(&[("schema.q".to_owned(), EFFECTS.replace("return connected[p]", "return connected[p, 'x']"))]);
    assert_eq!(bad.diagnostics.iter().map(|d| d.code.as_str()).collect::<Vec<_>>(), vec!["E_QUARRY_UNKNOWN"]);
    let bad = snapback4_lang::compile(&[("schema.q".to_owned(), EFFECTS.replace("return connected[p]", "return connected[1]"))]);
    assert_eq!(bad.diagnostics.iter().map(|d| d.code.as_str()).collect::<Vec<_>>(), vec!["E_QUARRY_TYPE"]);
    let unknown_effect = snapback4_lang::compile(&[("schema.q".to_owned(), EFFECTS.replace("effect notify\n", ""))]);
    assert_eq!(unknown_effect.diagnostics.iter().map(|d| d.code.as_str()).collect::<Vec<_>>(), vec!["E_QUARRY_UNKNOWN"]);
}

/// O5: the following feed at 500 follows costs what it costs at 5 — the
/// fan-out-on-write shape reads one prefix of the reader's own entries, so
/// the page's examined rows do not grow with the follow count (the brief's
/// bar is 3×; this is 1×), and the read is complete on a synced device.
#[test]
fn a_feed_read_costs_the_same_at_five_and_five_hundred_follows() {
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), feed())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    // wide follows 500 authors, narrow follows 5; every author has posted 20 times.
    let mut rows = Vec::new();
    for a in 0..500 {
        rows.push(("authors".to_owned(), snapback4_core::value::object([("id", id(&format!("author{a}"))), ("principal", id(&format!("dev:a{a:03}"))), ("shared", Value::Bool(false))])));
        rows.push(("follows".to_owned(), snapback4_core::value::object([("id", id(&format!("fw{a:03}"))), ("followerId", id("dev:wide")), ("followedId", id(&format!("dev:a{a:03}")))])));
        if a < 5 {
            rows.push(("follows".to_owned(), snapback4_core::value::object([("id", id(&format!("fn{a:03}"))), ("followerId", id("dev:narrow")), ("followedId", id(&format!("dev:a{a:03}")))])));
        }
    }
    engine.seed(rows).unwrap();
    let mut n = 0;
    for a in 0..500 {
        for _ in 0..20 {
            n += 1;
            let posted = engine.mutate("createPost", Some(&format!("p{n}")), Context::new(&format!("dev:a{a:03}"), args(&[("postId", id(&format!("post{n}")))])).at(1_000 + n).with_ids([format!("post{n}")])).unwrap();
            assert!(matches!(posted.state, WriteState::Sent { .. }), "{:?}", posted.state);
        }
    }
    let read = |engine: &mut Engine, who: &str| engine.query("following", Context::new(who, BTreeMap::new()).at(100_000)).unwrap();
    let wide = read(&mut engine, "dev:wide");
    let narrow = read(&mut engine, "dev:narrow");
    assert!(wide.complete && narrow.complete);
    assert_eq!((wide.data.as_array().unwrap().len(), narrow.data.as_array().unwrap().len()), (20, 20));
    assert_eq!(wide.metered.examined, narrow.metered.examined, "a page of the reader's own lane: the same rows examined at 500 follows as at 5 ({} vs {})", wide.metered.examined, narrow.metered.examined);
    assert_eq!(wide.metered.rule_probes, narrow.metered.rule_probes);
    // 22 merge examinations plus one compact removal lookup per returned slot.
    assert_eq!(wide.metered.examined, 42, "{:?}", wide.metered);
    // The newest post first, whoever wrote it; the wide reader's page is
    // from many authors, the narrow reader's from five.
    let authors = |read: &snapback4_core::QueryOutcome| read.data.as_array().unwrap().iter().map(|e| e.field("authorId").unwrap().as_str().unwrap().to_owned()).collect::<std::collections::BTreeSet<_>>();
    assert_eq!(wide.data.as_array().unwrap()[0].field("postId").unwrap(), &id("post10000"));
    assert!(authors(&narrow).len() <= 5 && authors(&narrow).iter().all(|a| a < &"dev:a005".to_owned()), "{:?}", authors(&narrow));
    // Each reader's device holds its complete, schema-capped private feed.
    let (events, _) = engine.snapshot("dev:wide").unwrap();
    assert_eq!(holdings(&events)["feed"].len(), 10_000, "all 10,000 entries fit the declared private cap");
    let (events, _) = engine.snapshot("dev:narrow").unwrap();
    assert_eq!(holdings(&events)["feed"].len(), 100);
}

const RANKED: &str = r#"
use identity
use personas alice, bob, marc

table posts:
  authorId: principal
  body: text <=6000
  at: time
  by byTime: at, id
  immutable authorId, at
  public 'posts are public'
  insert <- .authorId = viewer
  sync public last 2000 by byTime

table votes:
  postId: posts
  principal: principal
  direction: int
  unique byPostPrincipal: postId, principal
  by byPrincipal: principal, id
  read <- .principal = viewer
  insert <- .principal = viewer
  update (old, next) <- old.principal = viewer and next.principal = viewer
  sync to .principal last 1000 by byPrincipal

maintain postScore: sum votes of direction by postId
  read <- allow

-- Layer 1: one shared candidate set, scored on the server by a job, on every device.
table ranked:
  postId: posts
  score: int
  at: time
  unique byPost: postId
  by byScore: score, id
  public 'the ranking is one shared page'
  insert <- deny
  update <- deny
  sync public last 500 by byScore

-- Layer 2: the viewer's own signals, on the viewer's device.
table seen:
  readerId: principal
  postId: posts
  at: time
  unique byReaderPost: readerId, postId
  by byReaderTime: readerId, at, id
  read <- .readerId = viewer
  insert <- .readerId = viewer
  sync to .readerId last 1000 by byReaderTime

-- The external ranker's word, per reader: written by a service, read by the reader.
table affinity:
  readerId: principal
  postId: posts
  score: int
  at: time
  unique byReaderPost: readerId, postId
  by byReaderScore: readerId, score, id
  read <- .readerId = viewer
  insert <- viewer = 'service:ranker'
  update <- viewer = 'service:ranker'
  sync to .readerId last 200 by byReaderScore

job rescore():
  chunk p in posts first 100 by byId:
    (ageHours, rem) = divmod(now - p.at, 3600000)
    upsert ranked[p.id] { postId: p.id, score: postScore[p.id] * 10 - ageHours, at: p.at }

schedule rescoreEvery every 5m: rescore

query home(c: cursor ?):
  return ranked after c last 50 by byScore { *, post: posts[.postId], seen: exists seen[viewer, .postId], mine: votes[.postId, viewer], lift: affinity[viewer, .postId] }

mutation writePost(body: text <=6000):
  return insert posts { authorId: viewer, body, at: now }

mutation vote(postId: posts, direction: int):
  require exists posts[postId] else POST_NOT_FOUND
  require direction = -1 or direction = 0 or direction = 1 else INVALID_VOTE
  upsert votes[postId, viewer] { postId, principal: viewer, direction }

mutation markSeen(postId: posts):
  require exists posts[postId] else POST_NOT_FOUND
  return insert seen { readerId: viewer, postId, at: now } if absent

mutation setAffinity(readerId: principal, postId: posts, score: int):
  require exists posts[postId] else POST_NOT_FOUND
  upsert affinity[readerId, postId] { readerId, postId, score, at: now }
"#;

/// The ranked feed of LLP 3000.004 §4.2 on the `feeds` card: one shared
/// candidate set scored by a job on a cadence from a maintain, every
/// device holding it; the viewer's own signals synced to the viewer; the
/// external ranker admitted by its service name and nobody else.
#[test]
fn a_ranked_feed_is_scored_by_a_job_and_composed_on_the_device() {
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), RANKED.to_owned())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    let post = |engine: &mut Engine, who: &str, body: &str, n: i64| {
        let outcome = engine.mutate("writePost", Some(&format!("w{n}")), Context::new(who, args(&[("body", Value::String(body.into()))])).at(n).with_ids([format!("post{n}")])).unwrap();
        assert!(matches!(outcome.state, WriteState::Sent { .. }), "{:?}", outcome.state);
    };
    post(&mut engine, "dev:bob", "bob's", 1);
    post(&mut engine, "dev:marc", "marc's", 2);
    post(&mut engine, "dev:alice", "alice's", 3);
    let vote = |engine: &mut Engine, who: &str, post: &str, direction: i64, n: i64| {
        let outcome = engine.mutate("vote", Some(&format!("v{n}")), Context::new(who, args(&[("postId", id(post)), ("direction", Value::Int(direction))])).at(n)).unwrap();
        assert!(matches!(outcome.state, WriteState::Sent { .. }), "{:?}", outcome.state);
    };
    vote(&mut engine, "dev:alice", "post2", 1, 10);
    vote(&mut engine, "dev:bob", "post2", 1, 11);
    vote(&mut engine, "dev:marc", "post1", -1, 12);
    let run = engine.run_job("rescore", BTreeMap::new(), 100).unwrap();
    assert_eq!((run.state, run.rows_written), (snapback4_core::JobState::Done, 3), "{run:?}");
    let home = |engine: &mut Engine, who: &str| engine.query("home", Context::new(who, BTreeMap::new()).at(200)).unwrap();
    let page = home(&mut engine, "dev:bob");
    assert!(page.complete);
    let order: Vec<(String, i64, bool)> = page.data.as_array().unwrap().iter().map(|r| (r.field("postId").unwrap().as_str().unwrap().to_owned(), r.field("score").unwrap().as_int().unwrap(), r.field("seen").unwrap().as_bool().unwrap())).collect();
    assert_eq!(order, vec![("post2".into(), 20, false), ("post3".into(), 0, false), ("post1".into(), -10, false)]);
    assert_eq!(page.data.as_array().unwrap()[0].field("mine").unwrap().field("direction").unwrap(), &Value::Int(1), "bob's own vote beside the row");
    assert_eq!(page.data.as_array().unwrap()[1].field("mine").unwrap(), &Value::Null);
    // The viewer's signals move on the device alone; the ranker's lift is its seat's to write.
    engine.mutate("markSeen", Some("seen1"), Context::new("dev:bob", args(&[("postId", id("post2"))])).at(201).with_ids(["seen1".to_owned()])).unwrap();
    let refused = engine.mutate("setAffinity", Some("aff0"), Context::new("dev:bob", args(&[("readerId", id("dev:bob")), ("postId", id("post3")), ("score", Value::Int(9))])).at(202).with_ids(["aff0".to_owned()])).unwrap();
    assert!(matches!(&refused.state, WriteState::Failed { why, .. } if why.code == "NOT_FOUND"), "{:?}", refused.state);
    let lifted = engine.mutate("setAffinity", Some("aff1"), Context::new("service:ranker", args(&[("readerId", id("dev:bob")), ("postId", id("post3")), ("score", Value::Int(9))])).at(203).with_ids(["aff1".to_owned()])).unwrap();
    assert!(matches!(lifted.state, WriteState::Sent { .. }), "{:?}", lifted.state);
    let page = home(&mut engine, "dev:bob");
    let rows = page.data.as_array().unwrap();
    assert_eq!(rows[0].field("seen").unwrap(), &Value::Bool(true));
    assert_eq!(rows[1].field("lift").unwrap().field("score").unwrap(), &Value::Int(9));
    assert_eq!(rows[2].field("lift").unwrap(), &Value::Null);
    // Votes move the order on the cadence: the next rescore re-ranks.
    vote(&mut engine, "dev:alice", "post1", 1, 300);
    vote(&mut engine, "dev:bob", "post1", 1, 301);
    vote(&mut engine, "dev:marc", "post1", 1, 302);
    engine.run_job("rescore", BTreeMap::new(), 400).unwrap();
    let page = home(&mut engine, "dev:bob");
    assert_eq!(page.data.as_array().unwrap()[0].field("postId").unwrap(), &id("post1"));
    assert_eq!(page.data.as_array().unwrap()[0].field("score").unwrap(), &Value::Int(30));
    // Every device holds the shared ranking and its own signals, nothing else's.
    let (events, _) = engine.snapshot("dev:bob").unwrap();
    let held = holdings(&events);
    assert_eq!((held["ranked"].len(), held["seen"].len(), held["affinity"].len(), held["votes"].len()), (3, 1, 1, 2));
    let (events, _) = engine.snapshot("dev:marc").unwrap();
    let held = holdings(&events);
    assert_eq!((held["ranked"].len(), held.get("seen").map_or(0, |s| s.len()), held.get("affinity").map_or(0, |s| s.len())), (3, 0, 0));
    // The schedule fires the job from the server's clock.
    engine.fire_schedules(300_000).unwrap();
    assert_eq!(engine.fire_schedules(600_000).unwrap(), vec!["rescoreEvery".to_owned()]);
}


const ACTIONS: &str = r#"
action invite(email: text <=200, label: text <=20 ?)
action rank() <- viewer = 'service:ranker'
action paused() <- deny
table privateNotes:
  owner: principal
  body: text <=200
  read <- .owner = viewer
  insert <- .owner = viewer
query note(id: privateNotes):
  return privateNotes[id]
mutation save(body: text <=200):
  return insert privateNotes { owner: viewer, body }
"#;

fn action_engine() -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), ACTIONS.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}
fn action_context(principal: &str, at: i64) -> Context {
    Context::new(principal, args(&[("email", Value::String("bob@example.com".into()))])).at(at)
}

#[test]
fn actions_queue_once_check_rules_and_validate_inputs() {
    let mut engine = action_engine();
    let (run, replayed) = engine.request_action("invite", "request1", action_context("dev:alice", 1_000)).unwrap();
    assert_eq!((run.state.as_str(), run.principal.as_str(), run.at, replayed), ("queued", "dev:alice", 1_000, false));
    assert_eq!(run.args["label"], Value::Null);
    assert!(engine.request_action("invite", "request1", Context::new("dev:alice", BTreeMap::new()).at(2_000)).unwrap().1);
    assert_eq!(engine.action_counts().unwrap()["queued"], 1);
    assert_eq!(engine.request_action("invite", "request1", action_context("dev:bob", 1_000)).unwrap_err().code(), "E_ACTION_UNKNOWN");
    assert_eq!(engine.request_action("rank", "r2", Context::new("dev:alice", BTreeMap::new())).unwrap_err().code(), "E_RULE");
    assert!(engine.request_action("rank", "r3", Context::new("service:ranker", BTreeMap::new())).is_ok());
    assert_eq!(engine.request_action("paused", "r4", Context::new("service:ranker", BTreeMap::new())).unwrap_err().code(), "E_RULE");
    assert_eq!(engine.request_action("invite", "r5", Context::new("dev:alice", BTreeMap::new())).unwrap_err().code(), "E_INPUT");
    let long = Context::new("dev:alice", args(&[("email", Value::String("x".repeat(201)))]));
    assert_eq!(engine.request_action("invite", "r6", long).unwrap_err().code(), "E_INPUT");
    assert_eq!(engine.request_action("save", "r7", Context::new("dev:alice", args(&[("body", Value::String("x".into()))]))).unwrap_err().code(), "E_ACTION_UNKNOWN");
    assert_eq!(engine.mutate("invite", None, action_context("dev:alice", 1_000)).unwrap_err().code(), "E_OP");
    assert_eq!(engine.request_action("invite", "r8", action_context("system", 1_000)).unwrap_err().code(), "E_AUTH");
    assert_eq!(engine.claim_actions("dev:alice", None, 1, 60_000, 60, 2_000).unwrap_err().code(), "E_AUTH");
    assert!(engine.store().rows("privateNotes").unwrap().is_empty(), "admission does not execute the action");
}

#[test]
fn actions_claim_viewer_sessions_expire_fence_and_revoke_on_settlement() {
    use snapback4_core::{identity, engine::actions::ActionSettled};
    let mut engine = action_engine();
    engine.request_action("invite", "r1", action_context("dev:alice", 1_000)).unwrap();
    let first = engine.claim_actions("service:worker", Some("invite"), 1, 900_000, 60, 2_000).unwrap().remove(0);
    assert_eq!(first.session.principal, "dev:alice");
    assert_eq!(first.session.expires_at, 62_000);
    assert_eq!(first.request.attempt, 1);
    assert!(engine.claim_actions("service:other", None, 1, 60_000, 60, 2_001).unwrap().is_empty());
    assert_eq!(identity::resolve(engine.store(), &first.session.token, 2_001).unwrap().unwrap().0, "dev:alice");
    assert_eq!(identity::rotate_session(engine.store(), &first.session.token, 2_001).unwrap_err().code(), "E_AUTH");
    // A claimed handler's data work obeys the caller's rule, never the worker's.
    let saved = engine.mutate("save", Some("handler-r1"), Context::new(&first.session.principal, args(&[("body", Value::String("private".into()))])).at(2_001)).unwrap();
    let WriteState::Sent { result, .. } = saved.state else { panic!("save refused") };
    let row = result.field("id").unwrap().clone();
    assert_eq!(engine.query("note", Context::new("service:worker", args(&[("id", row.clone())]))).unwrap().data, Value::Null);
    assert_ne!(engine.query("note", Context::new(&first.session.principal, args(&[("id", row)]))).unwrap().data, Value::Null);
    assert!(identity::resolve(engine.store(), &first.session.token, 62_000).unwrap().is_none());
    assert_eq!(engine.settle_action("r1", "service:worker", &first.session.token, ActionSettled::Done(serde_json::json!(1)), 62_000).unwrap_err().code(), "E_ACTION_LEASE");
    // Claim itself requeues an expired lease without waiting for maintenance.
    let second = engine.claim_actions("service:worker", None, 1, 120_000, 120, 62_000).unwrap().remove(0);
    assert_eq!(second.request.attempt, 2);
    assert_eq!(second.session.expires_at, 182_000);
    assert_ne!(second.session.token, first.session.token);
    assert_eq!(engine.settle_action("r1", "service:worker", &first.session.token, ActionSettled::Done(serde_json::json!(1)), 62_001).unwrap_err().code(), "E_ACTION_LEASE");
    assert_eq!(engine.settle_action("r1", "service:other", &second.session.token, ActionSettled::Done(serde_json::json!(1)), 62_001).unwrap_err().code(), "E_ACTION_LEASE");
    let run = engine.settle_action("r1", "service:worker", &second.session.token, ActionSettled::Done(serde_json::json!({ "score": 1.25 })), 62_001).unwrap();
    assert_eq!(run.state, "done");
    assert_eq!(run.result.unwrap()["score"], 1.25, "action JSON does not change Quarry's integer value model");
    assert!(identity::resolve(engine.store(), &second.session.token, 62_002).unwrap().is_none());
    assert_eq!(engine.request_action("invite", "r1", action_context("dev:alice", 63_000)).unwrap().0.state, "done");
    assert!(engine.claim_actions("service:worker", None, 1, 60_000, 60, 200_000).unwrap().is_empty());
}

#[test]
fn actions_retry_backoff_give_up_and_the_eighth_expired_lease_are_terminal() {
    use snapback4_core::engine::actions::ActionSettled;
    let mut engine = action_engine();
    engine.request_action("invite", "retry", action_context("dev:alice", 0)).unwrap();
    let first = engine.claim_actions("service:worker", None, 1, 60_000, 60, 1).unwrap().remove(0);
    let run = engine.settle_action("retry", "service:worker", &first.session.token, ActionSettled::Failed { error: "provider down".into(), retry: true }, 2).unwrap();
    assert_eq!(run.state, "queued");
    assert!(engine.claim_actions("service:worker", None, 1, 60_000, 60, 2_001).unwrap().is_empty());
    let next = engine.claim_actions("service:worker", None, 1, 60_000, 60, 2_002).unwrap().remove(0);
    assert_eq!(next.request.attempt, 2);
    let run = engine.settle_action("retry", "service:worker", &next.session.token, ActionSettled::Failed { error: "bad address".into(), retry: false }, 2_003).unwrap();
    assert_eq!(run.state, "failed");
    assert_eq!(engine.request_action("invite", "retry", action_context("dev:alice", 3_000)).unwrap().0.error.as_deref(), Some("bad address"));
    engine.request_action("invite", "crash", action_context("dev:alice", 0)).unwrap();
    for attempt in 1..=8 {
        let claim = engine.claim_actions("service:worker", None, 1, 1_000, 1, attempt * 1_000).unwrap().remove(0);
        assert_eq!(claim.request.attempt, attempt as u32);
    }
    assert_eq!(engine.requeue_expired_actions(9_000).unwrap(), 1);
    assert_eq!(engine.action_request("crash", "dev:alice").unwrap().state, "failed");
    assert!(engine.claim_actions("service:worker", None, 1, 60_000, 60, 20_000).unwrap().is_empty());
}

#[test]
fn actions_durable_replay_survives_reopen_and_result_bounds_keep_the_lease() {
    use snapback4_core::{Store, engine::actions::ActionSettled};
    let path = std::env::temp_dir().join(format!("sb4-action-{}-{}", std::process::id(), snapback4_core::now_ms()));
    std::fs::create_dir_all(&path).unwrap();
    let file = path.join("store.sqlite");
    let bound = snapback4_lang::compile(&[("schema.q".into(), ACTIONS.into())]);
    let mut engine = Engine::new(Store::open(&file).unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.request_action("invite", "durable", action_context("dev:alice", 0)).unwrap();
    drop(engine);
    let mut engine = Engine::open(Store::open(&file).unwrap()).unwrap();
    let claim = engine.claim_actions("service:worker", None, 1, 60_000, 60, 1).unwrap().remove(0);
    let huge = serde_json::json!("x".repeat(snapback4_core::Ceilings::default().output_bytes as usize));
    assert_eq!(engine.settle_action("durable", "service:worker", &claim.session.token, ActionSettled::Done(huge), 2).unwrap_err().code(), "E_BOUND");
    engine.settle_action("durable", "service:worker", &claim.session.token, ActionSettled::Done(serde_json::json!({ "ok": true })), 3).unwrap();
    drop(engine);
    let mut engine = Engine::open(Store::open(&file).unwrap()).unwrap();
    let (run, replayed) = engine.request_action("invite", "durable", action_context("dev:alice", 4)).unwrap();
    assert!(replayed);
    assert_eq!(run.result.unwrap(), serde_json::json!({ "ok": true }));
    assert_eq!(run.attempt, 1);
    drop(engine);
    std::fs::remove_dir_all(path).unwrap();
}
#[test]
fn column_defaults_fill_inserts_and_upserts_but_do_not_replace_explicit_values() {
    let source = r#"table notes:
  owner: principal default viewer
  at: time default now
  score: int default -2
  role: enum('member', 'admin') default 'member'
  label: text 1..10 default 'hello'
  optional: bool ? default true
  by byOwner: owner, id
  required: bool
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  sync to .owner
mutation add():
  return insert notes { required: true }
mutation put(note: notes):
  return upsert notes[note] { required: false }
mutation explicit():
  return insert notes { required: true, score: 8, optional: null }
query get(note: notes):
  return notes[note]
"#;
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let encoded = serde_json::to_value(&bound.schema).unwrap();
    let decoded = serde_json::from_value(encoded.clone()).unwrap();
    assert_eq!(bound.schema, decoded);
    let mut old = encoded;
    old["tables"]["notes"].as_object_mut().unwrap().remove("defaults");
    let old: snapback4_core::schema::Schema = serde_json::from_value(old).unwrap();
    assert!(old.tables["notes"].defaults.is_empty());
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    for (op, key, at) in [("add", "a", 100), ("put", "b", 200), ("explicit", "c", 300)] {
        let input = if op == "put" { args(&[("note", id(key))]) } else { args(&[]) };
        let sent = engine.mutate(op, None, Context::new("dev:alice", input).at(at).with_ids([key.into()])).unwrap();
        let WriteState::Sent { result, .. } = sent.state else { panic!("{:?}", sent.state) };
        assert_eq!(result.field("at").unwrap(), &Value::Int(at));
        assert_eq!(result.field("owner").unwrap(), &id("dev:alice"));
        assert_eq!(result.field("role").unwrap(), &Value::String("member".into()));
        assert_eq!(result.field("score").unwrap(), &Value::Int(if op == "explicit" { 8 } else { -2 }));
        assert_eq!(result.field("optional").unwrap(), if op == "explicit" { &Value::Null } else { &Value::Bool(true) });
    }
    let patched = engine.mutate("put", None, Context::new("dev:alice", args(&[("note", id("a"))])).at(400)).unwrap();
    let WriteState::Sent { result, .. } = patched.state else { panic!("{:?}", patched.state) };
    assert_eq!(result.field("at").unwrap(), &Value::Int(100));
    assert_eq!(result.field("required").unwrap(), &Value::Bool(false));
    for (from, to) in [("default -2", "default 'wrong'"), ("default now", "default viewer"), ("default 'member'", "default 'other'"), ("default 'hello'", "default ''"), ("default -2", "default 1 + 2")] {
        let bad = snapback4_lang::compile(&[("schema.q".into(), source.replace(from, to))]);
        assert!(bad.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"), "{to}: {:?}", bad.diagnostics);
    }
    let missing = snapback4_lang::compile(&[("schema.q".into(), source.replace("{ required: true }", "{}"))]);
    assert!(!missing.diagnostics.is_empty());
}

const RELAXED: &str = include_str!("fixtures/clique-relaxed.q");
fn relaxed_engine() -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), RELAXED.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}
fn row(fields: &[(&str, Value)]) -> Value { snapback4_core::value::object(fields.iter().cloned()) }

#[test]
fn clique_insights_builds_seven_days_with_one_loop() {
    let mut engine = relaxed_engine();
    let day = 10 * 86400000;
    engine.seed([
        ("activities".into(), row(&[("id", id("p1")), ("principal", id("dev:alice")), ("day", Value::Int(day)), ("kind", Value::String("post".into()))])),
        ("activities".into(), row(&[("id", id("p2")), ("principal", id("dev:alice")), ("day", Value::Int(day)), ("kind", Value::String("post".into()))])),
        ("activities".into(), row(&[("id", id("l1")), ("principal", id("dev:alice")), ("day", Value::Int(day - 86400000)), ("kind", Value::String("like".into()))])),
        ("follows".into(), row(&[("id", id("f1")), ("follower", id("dev:alice")), ("followed", id("dev:bob"))])),
        ("follows".into(), row(&[("id", id("f2")), ("follower", id("dev:bob")), ("followed", id("dev:alice"))])),
    ]).unwrap();
    let outcome = engine.query("insights", Context::new("dev:alice", args(&[])).at(day + 1234)).unwrap();
    assert!(outcome.complete);
    assert_eq!(outcome.data.field("posts").unwrap(), &Value::Int(2));
    assert_eq!(outcome.data.field("followers").unwrap(), &Value::Int(1));
    assert_eq!(outcome.data.field("following").unwrap(), &Value::Int(1));
    let days = outcome.data.field("days").unwrap().as_array().unwrap();
    assert_eq!(days.len(), 7);
    for (i, record) in days.iter().enumerate() {
        assert_eq!(record.field("day").unwrap(), &Value::Int(day - i as i64 * 86400000));
        assert_eq!(record.field("posts").unwrap(), &Value::Int(if i == 0 { 2 } else { 0 }));
        assert_eq!(record.field("likesReceived").unwrap(), &Value::Int(if i == 1 { 1 } else { 0 }));
    }
}

fn membership(key: &str, cid: &str, principal: &str, joined: i64, read: i64, delivered: i64) -> (String, Value) {
    ("memberships".into(), row(&[("id", id(key)), ("conversationId", id(cid)), ("principal", id(principal)), ("joinedSequence", Value::Int(joined)), ("readSequence", Value::Int(read)), ("deliveredSequence", Value::Int(delivered))]))
}

#[test]
fn clique_receipt_helper_skips_sender_and_late_joiners() {
    for (read, delivered, expected) in [(10, 10, "read"), (9, 10, "delivered"), (8, 9, "sent")] {
        let mut engine = relaxed_engine();
        engine.seed([
            membership("a", "c", "dev:alice", 0, 0, 0),
            membership("b", "c", "dev:bob", 0, read, delivered),
            membership("later", "c", "dev:carol", 10, 0, 0),
        ]).unwrap();
        let outcome = engine.query("receipt", Context::new("dev:alice", args(&[("cid", id("c")), ("sender", id("dev:alice")), ("seq", Value::Int(10))])).at(100)).unwrap();
        assert_eq!(outcome.data, Value::String(expected.into()));
        assert!(outcome.complete);
    }
}

#[test]
fn clique_digest_uses_two_counters_and_push_preview_concatenates_text() {
    let mut engine = relaxed_engine();
    engine.seed([
        ("profiles".into(), row(&[("id", id("alice")), ("principal", id("dev:alice")), ("displayName", Value::String("Alice".into()))])),
        ("profiles".into(), row(&[("id", id("bob")), ("principal", id("dev:bob")), ("displayName", Value::String("Bob".into()))])),
        membership("a1", "c1", "dev:alice", 0, 0, 0), membership("a2", "c2", "dev:alice", 0, 0, 0), membership("b1", "c1", "dev:bob", 0, 0, 0),
    ]).unwrap();
    for (who, cid, n) in [("dev:alice", "c1", 3), ("dev:alice", "c2", 2), ("dev:bob", "c1", 1)] {
        engine.seed((0..n).map(|i| ("unreadEvents".into(), row(&[("id", id(&format!("{who}-{cid}-{i}"))), ("conversationId", id(cid)), ("principal", id(who)), ("periodStart", Value::Int(100)), ("bucket", Value::Int(0))])))).unwrap();
    }
    let run = engine.run_job("digest", args(&[("periodStart", Value::Int(100)), ("periodEnd", Value::Int(200))]), 200).unwrap();
    assert_eq!(run.state, snapback4_core::JobState::Done, "{run:?}");
    let effects = engine.effects(Some("queued"), 10).unwrap();
    assert_eq!(effects.len(), 2);
    for effect in effects {
        let payload = &effect.payload;
        let alice = payload.field("targetUserId").unwrap() == &id("dev:alice");
        assert_eq!(payload.field("unreadMessages").unwrap(), &Value::Int(if alice { 5 } else { 1 }));
        assert_eq!(payload.field("unreadChats").unwrap(), &Value::Int(if alice { 2 } else { 1 }));
    }
    let sent = engine.mutate("push", None, Context::new("dev:alice", args(&[("cid", id("c1")), ("body", Value::String("é".repeat(90)))])).at(300)).unwrap();
    assert!(matches!(sent.state, WriteState::Sent { .. }), "{:?}", sent.state);
    let effects = engine.effects(Some("queued"), 10).unwrap();
    let preview = effects.iter().find(|effect| effect.payload.field("preview").is_ok()).unwrap();
    assert_eq!(preview.payload.field("preview").unwrap(), &Value::String(format!("Alice: {}", "é".repeat(80))));
    assert_eq!(preview.payload.field("targetUserId").unwrap(), &id("dev:bob"));
}

#[test]
fn clique_around_seeks_to_the_quote_and_groups_reactions() {
    let mut engine = relaxed_engine();
    engine.seed((0..60).map(|n| ("messages".into(), row(&[("id", id(&format!("m{n:02}"))), ("conversationId", id("c")), ("authorId", id("dev:alice")), ("body", Value::String(format!("message {n}"))), ("at", Value::Int(n))])))).unwrap();
    let around = engine.query("around", Context::new("dev:alice", args(&[("conversationId", id("c")), ("messageId", id("m30"))])).at(100)).unwrap();
    let times = |field| around.data.field(field).unwrap().as_array().unwrap().iter().map(|r| r.field("at").unwrap().as_int().unwrap()).collect::<Vec<_>>();
    assert_eq!(times("before"), (10..30).rev().collect::<Vec<_>>());
    assert_eq!(times("after"), (30..51).collect::<Vec<_>>());
    engine.seed([(0, "dev:alice", "👍"), (1, "dev:bob", "❤️"), (2, "dev:carol", "👍")].map(|(n, who, emoji)| ("reactions".into(), row(&[("id", id(&format!("r{n}"))), ("conversationId", id("c")), ("messageId", id("m30")), ("principal", id(who)), ("emoji", Value::String(emoji.into()))])))).unwrap();
    let groups = engine.query("reactionCounts", Context::new("dev:alice", args(&[("messageId", id("m30"))])).at(100)).unwrap();
    let groups = groups.data.as_array().unwrap();
    assert_eq!(groups.len(), 2);
    assert_eq!(groups[0].field("emoji").unwrap(), &Value::String("👍".into()));
    assert_eq!(groups[0].field("count").unwrap(), &Value::Int(2));
    assert_eq!(groups[1].field("count").unwrap(), &Value::Int(1));
    assert!(groups.iter().all(|g| g.field("mine").unwrap() == &Value::Bool(true)));
}

#[test]
fn clique_trending_ranks_the_whole_day_and_marks_a_day_past_the_ceiling_incomplete() {
    let now = 2 * 86400000;
    let mut engine = relaxed_engine();
    engine.seed((0..250).map(|n| ("posts".into(), row(&[("id", id(&format!("p{n:04}"))), ("at", Value::Int(now - 1000 + n))])))).unwrap();
    let likes = |n: i64| if n == 0 { 50 } else { n % 13 };
    engine.seed((0..250).flat_map(|n| (0..likes(n)).map(move |k| ("likes".into(), row(&[("id", id(&format!("l{n}-{k}"))), ("postId", id(&format!("p{n:04}"))), ("principal", id(&format!("user{k}")))]))))).unwrap();
    let page = engine.query("trending", Context::new("dev:alice", args(&[])).at(now)).unwrap();
    assert!(page.complete, "{page:?}");
    let mut expected: Vec<i64> = (0..250).collect();
    expected.sort_by_key(|n| (-likes(*n), -*n));
    let ids = page.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().clone()).collect::<Vec<_>>();
    assert_eq!(ids, expected[..10].iter().map(|n| id(&format!("p{n:04}"))).collect::<Vec<_>>());
    assert_eq!(ids[0], id("p0000"), "the oldest post wins; last 200 would have lost it");
    let mut large = relaxed_engine();
    large.seed((0..8193).map(|n| ("posts".into(), row(&[("id", id(&format!("p{n:05}"))), ("at", Value::Int(now - 10000 + n))])))).unwrap();
    let cut = large.query("trending", Context::new("dev:alice", args(&[])).at(now)).unwrap();
    assert!(!cut.complete, "an incomplete population cannot claim the true top ten");
    assert_eq!(cut.capped_at.as_ref().map(|(kind, _)| *kind), Some(snapback4_core::error::MeterKind::Examined));
    assert_eq!(cut.data.as_array().unwrap().len(), 10);
}

const PROBE_EQUALITIES: &str = include_str!("fixtures/probe-equalities.q");

#[test]
fn ceremony_run_two_probes_one_row_with_or_without_the_second_index() {
    for extra in ["", "  by byKeyAdmin: key, admin\n"] {
        let source = PROBE_EQUALITIES.replace("  unique byKey: key\n", &format!("  unique byKey: key\n{extra}"));
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        engine.seed((0..100).map(|i| ("chats".into(), row(&[("id", id(&format!("c{i}"))), ("key", Value::String(format!("c{i}"))), ("admin", id(if i == 0 { "dev:alice" } else { "dev:bob" }))])))).unwrap();
        let added = engine.mutate("add", None, Context::new("dev:alice", args(&[("chatKey", Value::String("c0".into())), ("principal", id("dev:carol"))])).with_ids(["member".into()])).unwrap();
        assert!(matches!(added.state, WriteState::Sent { .. }), "{added:?}");
        assert_eq!(added.metered.rule_probes, 1);
        println!("run-2 second_index={} rule_probes={}", !extra.is_empty(), added.metered.rule_probes);
        for (viewer, key, allowed) in [("dev:alice", "c0", true), ("dev:bob", "c0", false), ("dev:alice", "missing", false)] {
            for name in ["get", "probe"] {
                let result = engine.query(name, Context::new(viewer, args(&[("chatKey", Value::String(key.into())), ("admin", id(viewer))]))).unwrap();
                assert_eq!(result.metered.examined, 1, "{name}: {result:?}");
                assert!(result.complete);
                assert_eq!(if name == "get" { result.data != Value::Null } else { result.data == Value::Bool(true) }, allowed);
            }
        }
        let denied = engine.mutate("add", None, Context::new("dev:bob", args(&[("chatKey", Value::String("c0".into())), ("principal", id("dev:mallory"))]))).unwrap();
        assert!(matches!(denied.state, WriteState::Failed { .. }));
        assert_eq!(denied.metered.rule_probes, 1);
        let bootstrapped = engine.mutate("bootstrap", None, Context::new("dev:carol", args(&[("chatKey", Value::String("new".into()))]))).unwrap();
        assert!(matches!(bootstrapped.state, WriteState::Sent { .. }));
        assert_eq!(bootstrapped.metered.rule_probes, 0, "created's key fact short-circuits the exists");
    }
}

#[test]
fn created_equalities_check_the_current_created_row_and_program_reads_stay_authorized() {
    let source = PROBE_EQUALITIES.replace("created chats[key = .chatKey] or exists chats[key = .chatKey, admin = viewer]", "created chats[key = .chatKey, admin = viewer]")
        .replace("  read <- allow\n  insert <- allow", "  read <- .admin = viewer\n  insert <- allow");
    let source = format!("{source}\nmutation changed(chatKey: text 1..64):\n  insert chats {{ key: chatKey, admin: viewer }}\n  update chats[chatKey] {{ admin: 'dev:bob' }}\n  insert members {{ chatKey, principal: viewer }}\n");
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let input = || args(&[("chatKey", Value::String("new".into()))]);
    let created = engine.mutate("bootstrap", None, Context::new("dev:alice", input())).unwrap();
    assert!(matches!(created.state, WriteState::Sent { .. }), "{created:?}");
    assert_eq!(created.metered.rule_probes, 1);
    let existing = engine.mutate("add", None, Context::new("dev:alice", args(&[("chatKey", Value::String("new".into())), ("principal", id("dev:bob"))]))).unwrap();
    assert!(matches!(existing.state, WriteState::Failed { .. }));
    let changed = engine.mutate("changed", None, Context::new("dev:alice", args(&[("chatKey", Value::String("other".into()))]))).unwrap();
    assert!(matches!(changed.state, WriteState::Failed { .. }), "{changed:?}");
    for name in ["get", "probe"] {
        let hidden = engine.query(name, Context::new("dev:bob", args(&[("chatKey", Value::String("new".into())), ("admin", id("dev:alice"))]))).unwrap();
        assert_eq!(hidden.data, if name == "get" { Value::Null } else { Value::Bool(false) });
    }
}

#[path = "common/following_app.rs"]
mod following_app;

#[test]
fn w6a_wired_following_is_bounded_and_removes_app_events() { following_app::server_scenario(); }

#[test]
fn development_advances_preserve_remaining_effect_lease_time_and_overdue_claims() {
    let mut engine = effects_engine();
    engine.mutate("send", Some("advance"), Context::new("dev:alice", args(&[("conversationId", id("c1")), ("body", Value::String("advance".into()))])).at(1_000).with_ids(["msg-advance".to_owned()])).unwrap();
    let short = engine.claim_effects("service:short", None, 1, 1_000, 2_000).unwrap().remove(0);
    let long = engine.claim_effects("service:long", None, 1, 60_000, 2_000).unwrap().remove(0);
    // At time 4,000 the short claim is already overdue. Advancing 120 s
    // must neither revive that claim nor steal the other one's 58 s left.
    engine.advance_effect_leases(120_000).unwrap();
    assert_eq!(engine.requeue_expired_effects(124_000).unwrap(), 1);
    let queued = engine.effects(Some("queued"), 10).unwrap();
    assert_eq!(queued[0].id, short.id);
    assert_eq!(queued[0].next_at, Some(124_000));
    let running = engine.effects(Some("running"), 10).unwrap();
    assert_eq!(running[0].id, long.id);
    assert_eq!(running[0].lease_until, Some(182_000));
    // Another advance moves only the held lease, never the queued retry.
    engine.advance_effect_leases(120_000).unwrap();
    assert_eq!(engine.effects(Some("queued"), 10).unwrap(), queued);
    assert!(engine.effects_due(None, 244_000).unwrap());
    assert_eq!(engine.requeue_expired_effects(301_999).unwrap(), 0);
    assert_eq!(engine.requeue_expired_effects(302_001).unwrap(), 1);
    assert_eq!(engine.settle_effect(&long.id, "service:long", snapback4_core::Settled::Done { result: None }, 302_001).unwrap_err().code(), "E_EFFECT_LEASE");
    let retry = engine.claim_effects("service:new", None, 10, 60_000, 302_002).unwrap();
    assert_eq!(retry.len(), 2);
    for effect in retry {
        assert_eq!(effect.attempts, 2);
        assert_eq!(engine.settle_effect(&effect.id, "service:new", snapback4_core::Settled::Done { result: None }, 302_003).unwrap().state, "sent");
    }
}
