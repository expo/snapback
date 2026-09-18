//! W13g acquisition boundaries on both persistent device stores.
mod common;
use common::*;
use snapback4_core::Engine;
use snapback4_core::value::{Value, object};
use snapback4_device::device::{Backend, Device};
use snapback4_device::store::DeviceStore;

const PROBE: &str = include_str!("../../../../benchmarks/runs/2026-09-17-snapback4-derived-probes/horizon-gap/snapback/schema.q");
const GROUP: &str = r#"
table members:
  group: text <=10
  person: principal
  unique byGroupPerson: group, person
  by byPerson: person, group
  immutable group, person
  read <- .person = viewer
  insert <- deny
  update <- deny
  online only
table posts:
  group: text <=10
  at: time
  by byTime: group, at, id
  read <- exists members[.group, viewer]
  insert <- deny
  update <- allow
  sync to members[.group] last 2 by byTime
query timeline(g: text <=10, c: cursor ?):
  return posts[g] after c last 2 by byTime { id, at }
mutation move(p: posts, at: time):
  update posts[p] {at}
"#;

fn setup() -> (Engine, Backend) {
    let (mut engine, backend) = compile(&format!("{PROBE}\nquery one(p: posts):\n  return posts[p]\n"));
    engine.seed((1..=12).map(|n| ("posts".into(), object([
        ("id", id(&format!("p{n:02}"))), ("authorId", id("dev:alice")),
        ("body", Value::String(format!("post {n}"))), ("at", Value::Int(n * 1_000)), ("score", Value::Int(0)),
    ])))).unwrap();
    (engine, backend)
}

fn page<S: DeviceStore>(device: &mut Device<S>, cursor: Option<String>) -> (serde_json::Value, bool) {
    let (result, unknown, _) = device.query_with_coverage("timeline", "dev:bob", &serde_json::json!({"c":cursor}), 20_000);
    let result = result.unwrap();
    (serde_json::json!({"data":snapback4_core::wire::to_json(&result.data), "complete":result.complete, "cut":result.cut, "next":result.next}), unknown)
}

fn scenario<H: Host>(host: &mut H) -> (bool, usize) {
    let (mut engine, backend) = setup();
    let mut device = host.open("probe", Some(backend)).unwrap();
    for (i, page) in snapshot_pages(&mut engine, "dev:bob", 2).into_iter().enumerate() { device.apply(&page, i == 0).unwrap(); }
    let (first, _) = page(&mut device, None);
    let cursor = first["next"].as_str().map(str::to_owned);
    let control = page(&mut device, cursor.clone());
    assert_eq!(first["data"], serde_json::json!([{"id":"p12","score":0},{"id":"p11","score":0},{"id":"p10","score":0}]));
    assert_eq!(first["complete"], true);
    assert_eq!(control.0["data"], serde_json::json!([{"id":"p09","score":0},{"id":"p08","score":0}]));
    assert_eq!(control.0["complete"], false);
    assert!(control.1);
    println!("{} control 1={} control 2={:?}", host.label(), first, control);
    let server_before = engine.query("timeline", context("dev:bob", &[("c", Value::String(cursor.clone().unwrap()))]).at(20_000)).unwrap();
    for p in ["p02", "p04"] {
        let result = engine.mutate("like", Some(p), context("dev:alice", &[("postId", id(p))]).at(20_000)).unwrap();
        assert!(matches!(result.state, snapback4_core::engine::WriteState::Sent {..}));
    }
    let watermark = device.store().meta("device:watermark").unwrap().unwrap().parse().unwrap();
    let stream = stream_page(&mut engine, "dev:bob", watermark);
    device.apply(&stream, false).unwrap();
    let first = page(&mut device, None);
    let second = page(&mut device, cursor.clone());
    println!("{} after 1={:?} after 2={:?}", host.label(), first, second);
    let server = engine.query("timeline", context("dev:bob", &[("c", Value::String(cursor.unwrap()))]).at(20_000)).unwrap();
    let server_ids: Vec<_> = server.data.as_array().unwrap().iter().map(|v| v.field("id").unwrap().as_str().unwrap()).collect();
    assert_eq!(server_ids, ["p09", "p08", "p07"]);
    assert_eq!((&server.data, server.complete, &server.cut, &server.next), (&server_before.data, server_before.complete, &server_before.cut, &server_before.next), "the server page is pinned unchanged");
    let mut extra = 0;
    for p in ["p02", "p04"] {
        let read = device.query("one", "dev:bob", &serde_json::json!({"p":p}), 20_000).unwrap();
        extra += usize::from(read.data != Value::Null);
    }
    println!("{} unheld-old-puts-stored={extra}", host.label());
    let correct = second.0["complete"] == false && second.1;
    host.close("probe", device);
    (correct, extra)
}

#[test]
fn crossing_page_red() {
    let sqlite = scenario(&mut Sqlite::new("w13g-crossing"));
    let memory = scenario(&mut Memory::new());
    assert!(sqlite.0 && memory.0, "crossing pages must be incomplete and unknown on both stores");
}

#[test]
fn growth_red() {
    let sqlite = scenario(&mut Sqlite::new("w13g-growth"));
    let memory = scenario(&mut Memory::new());
    assert_eq!((sqlite.1, memory.1), (0, 0), "unheld puts below the boundary must not be stored");
}

fn member(person: &str) -> (String, Value) {
    ("members".into(), object([("id", id("m")), ("group", Value::String("g".into())), ("person", id(person))]))
}

fn stream_at(engine: &mut Engine, from: u64, now: i64) -> snapback4_device::device::StreamPage {
    let stream = engine.stream_at("dev:bob", from, 1_000, now).unwrap();
    serde_json::from_value(serde_json::json!({
        "snapshot":false, "requested_watermark":from, "events":stream.events.iter().map(|e| serde_json::json!({"table":e.table,"kind":e.kind,"id":e.id,"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),
        "acquisitions":stream.acquisitions,"joined":stream.joined,"watermark":stream.watermark,"more":stream.more,"generation":engine.generation()
    })).unwrap()
}

fn group_page<S: DeviceStore>(device: &mut Device<S>) -> (serde_json::Value, bool) {
    let (result, unknown, _) = device.query_with_coverage("timeline", "dev:bob", &serde_json::json!({"g":"g","c":null}), 4);
    let result = result.unwrap();
    (serde_json::json!({"data":snapback4_core::wire::to_json(&result.data),"complete":result.complete,"cut":result.cut,"next":result.next}), unknown)
}

fn empty<H: Host>(host: &mut H) {
    let snapshots = ["dev:bob", "dev:alice"].map(|member_person| {
        let (mut engine, backend) = compile(GROUP);
        engine.seed_at([member(member_person)], 1).unwrap();
        let pages = snapshot_pages(&mut engine, "dev:bob", 100);
        let mut device = host.open(member_person, Some(backend)).unwrap();
        device.apply(&pages[0], true).unwrap();
        let (page, unknown) = group_page(&mut device);
        assert_eq!(page["data"], serde_json::json!([]));
        assert_eq!(page["complete"], member_person == "dev:bob");
        assert_eq!(unknown, member_person != "dev:bob");
        page_json(&pages[0])
    });
    assert_ne!(snapshots[0], snapshots[1]);
    assert_eq!(snapshots[0]["acquisitions"][1]["floor"], "whole");
    assert_eq!(snapshots[1]["acquisitions"], serde_json::json!([]));
}

#[test]
fn empty_acquired_is_whole_and_never_acquired_is_unknown() {
    empty(&mut Sqlite::new("w13g-empty")); empty(&mut Memory::new());
}

fn wire_witness<H: Host>(host: &mut H) {
    let source = GROUP.replace("  sync to members", "  retain delivered-history\n  sync to members");
    let payloads = [[1_000, 2_000, 3_000], [700, 800, 3_000]].map(|times| {
        let (mut engine, backend) = compile(&source);
        engine.seed_at(times.iter().enumerate().map(|(n, at)| ("posts".into(), object([
            ("id", id(&format!("p{}", n + 1))), ("group", Value::String("g".into())), ("at", Value::Int(*at)),
        ]))), 1).unwrap();
        let snapshot = snapshot_pages(&mut engine, "dev:bob", 100);
        let mut device = host.open(&format!("floor-{}", times[1]), Some(backend.clone())).unwrap();
        device.apply(&snapshot[0], true).unwrap();
        let before = snapshot[0].watermark;
        engine.seed_at([member("dev:bob")], 2).unwrap();
        engine.mutate("move", Some("move"), context("dev:bob", &[("p", id("p2")), ("at", Value::Int(500))]).at(3)).unwrap();
        let stream = stream_at(&mut engine, before, 4);
        let floor = stream.acquisitions.last().unwrap().floor.as_ref().unwrap();
        let expected = snapback4_core::rows::index_key(backend.schema.tables["posts"].index("byTime").unwrap(), &object([
            ("id", id("p3")), ("group", Value::String("g".into())), ("at", Value::Int(3000)),
        ]), "p3");
        assert_eq!(*floor, snapback4_core::value::encode_bytes_hex(&expected));
        assert_eq!(stream.acquisitions.last().unwrap().at, 2, "floor precedes the later put");
        device.apply(&stream, false).unwrap();
        let page = group_page(&mut device);
        assert_eq!(page.0["data"], serde_json::json!([{"id":"p3","at":3000}]));
        assert!(page.1);
        // Both worlds narrow to p3's delivered current key.
        engine.mutate("move", Some("move-p1"), context("dev:bob", &[("p", id("p1")), ("at", Value::Int(1_000))]).at(4)).unwrap();
        device.apply(&stream_at(&mut engine, stream.watermark, 4), false).unwrap();
        let page = group_page(&mut device);
        assert_eq!(page.0["complete"], false);
        assert_eq!(page.0["data"].as_array().unwrap().len(), 1);
        let payload = page_json(&stream);
        println!("{} acquired boundary at={} wire={payload}", host.label(), times[1]);
        payload
    });
    assert_eq!(payloads[0]["events"], payloads[1]["events"], "current images still coincide");
    assert_eq!(payloads[0], payloads[1]);
}

#[test]
fn join_selection_narrows_to_identical_delivered_current_keys() {
    wire_witness(&mut Sqlite::new("w13g-wire")); wire_witness(&mut Memory::new());
}

#[test]
fn raw_boundary_keys_at_the_thousand_group_envelope() {
    let (_, backend) = compile(CHAT);
    let index = backend.schema.tables["messages"].index("byConvTime").unwrap();
    let mut total = 0;
    for group in 0..1_000 {
        let row_id = format!("{:032x}", group * 500 + 1);
        let row = object([("id", id(&row_id)), ("conversationId", id(&format!("{group:032x}"))), ("at", Value::Int(1_000))]);
        let key = snapback4_core::rows::index_key(index, &row, &row_id);
        assert_eq!(key.len(), 114);
        total += key.len();
    }
    assert_eq!(total, 114_000);
    println!("raw boundary encoding: groups=1000 horizon=500 keys=1000 group-id-bytes=32 row-id-bytes=32 bytes-per-key=114 total-key-bytes={total}; metadata framing and storage overhead unmeasured");
}

const BOUNDARIES: &str = "device:acquisition-boundaries:";
fn boundaries<S: BoundaryMetadata>(device: &mut Device<S>) -> Option<String> {
    let entries = device.store().boundary_entries();
    if entries.is_empty() { None } else { Some(serde_json::to_string(&entries).unwrap()) }
}
fn public_source() -> String {
    PROBE.replace("immutable authorId, at", "immutable authorId").replace("  update <- allow", "  update <- allow\n  delete <- allow") + r#"
query one(p: posts):
  return posts[p]
query exact(c: cursor ?):
  return posts after c last 5 by byTime { id, score }
query ascending():
  return posts first 1 by byTime
query alternate():
  return posts last 1 by byId
mutation move(p: posts, at: time):
  update posts[p] {at}
mutation remove(p: posts):
  delete posts[p]
"#
}
fn post(n: i64) -> (String, Value) {
    ("posts".into(), object([("id",id(&format!("p{n:02}"))),("authorId",id("dev:alice")),("body",Value::String("post".into())),("at",Value::Int(n*1000)),("score",Value::Int(0))]))
}
fn acquire<H: Host>(host: &mut H, engine: &mut Engine, backend: Backend, name: &str) -> Device<H::Store> {
    let mut device = host.open(name, Some(backend)).unwrap();
    for (i, page) in snapshot_pages(engine, "dev:bob", 2).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    device
}
fn catchup<S: DeviceStore>(device: &mut Device<S>, engine: &mut Engine) {
    let from = device.sync_state().unwrap().watermark;
    device.apply(&stream_at(engine, from, 20_000), false).unwrap();
}
fn evolution<H: Host>(host: &mut H) {
    let (mut engine, backend) = compile(&public_source());
    engine.seed_at((1..=12).map(post), 1).unwrap();
    let mut device = acquire(host, &mut engine, backend, "evolution");
    let before = boundaries(&mut device);
    let exact = device.query("exact", "dev:bob", &serde_json::json!({"c":null}), 20_000).unwrap();
    assert!(exact.complete, "stopping exactly at the boundary is complete");
    assert!(exact.next.is_some(), "end below the boundary is still unknown");
    for name in ["ascending", "alternate"] {
        assert!(device.query_with_coverage(name, "dev:bob", &serde_json::json!({}), 20_000).1);
    }
    engine.mutate("move", Some("below"), context("dev:alice", &[("p",id("p10")),("at",Value::Int(500))]).at(2)).unwrap();
    catchup(&mut device, &mut engine);
    let held = device.query("one", "dev:bob", &serde_json::json!({"p":"p10"}), 20_000).unwrap();
    assert_eq!(held.data.field("at").unwrap(), &Value::Int(500));
    let rows = device.query("exact", "dev:bob", &serde_json::json!({"c":null}), 20_000).unwrap();
    assert_eq!(rows.data.as_array().unwrap().len(), 4); assert!(!rows.complete);
    engine.mutate("move", Some("above"), context("dev:alice", &[("p",id("p02")),("at",Value::Int(15_000))]).at(3)).unwrap();
    catchup(&mut device, &mut engine);
    let rows = device.query("exact", "dev:bob", &serde_json::json!({"c":null}), 20_000).unwrap();
    assert!(rows.complete); assert_eq!(rows.data.as_array().unwrap()[0].field("id").unwrap(), &id("p02"));
    engine.mutate("like", Some("held-update"), context("dev:alice", &[("postId",id("p10"))]).at(4)).unwrap();
    catchup(&mut device, &mut engine);
    assert_eq!(device.query("one", "dev:bob", &serde_json::json!({"p":"p10"}), 20_000).unwrap().data.field("score").unwrap(), &Value::Int(1));
    engine.mutate("remove", Some("del"), context("dev:alice", &[("p",id("p10"))]).at(5)).unwrap();
    catchup(&mut device, &mut engine);
    assert_eq!(device.query("one", "dev:bob", &serde_json::json!({"p":"p10"}), 20_000).unwrap().data, Value::Null);
    assert_eq!(before, boundaries(&mut device), "puts/deletes never move the floor");
    host.close("evolution", device);
    let mut device = host.open("evolution", None).unwrap();
    assert_eq!(before, boundaries(&mut device));
    assert!(device.query("exact", "dev:bob", &serde_json::json!({"c":null}), 20_000).unwrap().complete);
    device.clear_rows().unwrap();
    assert_eq!(boundaries(&mut device), None);
}
#[test]
fn mutable_keys_held_updates_deletes_and_reopen() {
    evolution(&mut Sqlite::new("w13g-evolution")); evolution(&mut Memory::new());
}

fn whole<H: Host>(host: &mut H) {
    let (mut engine, backend) = compile(&public_source());
    engine.seed_at((1..=2).map(post), 1).unwrap();
    let mut device = acquire(host, &mut engine, backend, "whole");
    let (page, unknown) = page(&mut device, None);
    assert_eq!(page["complete"], true); assert!(!unknown); assert_eq!(page["next"], serde_json::Value::Null);
    engine.seed_at([post(3)], 2).unwrap(); catchup(&mut device, &mut engine);
    assert!(device.query("exact", "dev:bob", &serde_json::json!({"c":null}), 20_000).unwrap().complete);
    assert!(boundaries(&mut device).unwrap().contains("whole"));
}
#[test]
fn whole_group_stays_complete_to_its_end() { whole(&mut Sqlite::new("w13g-whole")); whole(&mut Memory::new()); }

fn snapshots_at(engine: &mut Engine, now: i64, limit: usize) -> Vec<snapback4_device::device::StreamPage> {
    let mut after = None;
    let mut out = Vec::new();
    loop {
        let page = engine.snapshot_acquisition_page_at("dev:bob", after.as_deref(), limit, now).unwrap();
        let requested_after = after.clone();
        after = page.next.map(|next| next.encode());
        out.push(serde_json::from_value(serde_json::json!({"after":requested_after,"snapshot":true,"acquisitions":page.acquisitions,"held":page.held,"events":page.events.iter().map(|e| serde_json::json!({"table":e.table,"kind":e.kind.word(),"id":e.id,"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),"watermark":page.watermark,"more":after.is_some(),"next":after,"generation":engine.generation()})).unwrap());
        if after.is_none() { return out; }
    }
}
fn group_post(n: i64) -> (String, Value) {
    ("posts".into(), object([("id",id(&format!("p{n}"))),("group",Value::String("g".into())),("at",Value::Int(n*1000))]))
}
fn renewal<H: Host>(host: &mut H) {
    let source = GROUP.replace("  person: principal", "  person: principal\n  until: time\n  expire at .until\n  by byExpiry: until")
        .replace("  update <- deny", "  update <- allow")
        .replace("  sync to members", "  retain delivered-history\n  sync to members")
        .replace("after c last 2", "after c last 4") + "\nmutation renew(t: time):\n  update members['m'] {until: t}\nquery one(p: posts):\n  return posts[p]\nquery lower(c: cursor ?):\n  return posts['g', at < 4000] after c last 4 by byTime { id, at }\n";
    let (mut engine, backend) = compile(&source);
    let membership = object([("id",id("m")),("group",Value::String("g".into())),("person",id("dev:bob")),("until",Value::Int(1000))]);
    engine.seed_at([("members".into(), membership), group_post(1), group_post(2), group_post(3)], 1).unwrap();
    let mut device = host.open("renewal", Some(backend)).unwrap();
    for (i, page) in snapshots_at(&mut engine, 100, 1).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    let original = boundaries(&mut device);
    engine.seed_at([group_post(4), group_post(5)], 200).unwrap();
    let from = device.sync_state().unwrap().watermark;
    engine.mutate("renew", Some("continuous"), context("dev:bob", &[("t",Value::Int(2000))]).at(500)).unwrap();
    let page = stream_at(&mut engine, from, 500);
    assert!(page.acquisitions.is_empty(), "a continuous renewal does not reset the floor");
    device.apply(&page, false).unwrap();
    assert_eq!(boundaries(&mut device), original);
    assert!(group_page(&mut device).0["complete"].as_bool().unwrap());
    engine.seed_at([("members".into(), object([("id",id("replacement")),("group",Value::String("g".into())),("person",id("dev:bob")),("until",Value::Int(4000))]))], 3000).unwrap();
    let page = stream_at(&mut engine, page.watermark, 3000);
    assert_eq!(page.events[0].kind, "scope");
    assert_eq!(page.acquisitions[0].at, 1, "reacquisition begins after revocation");
    device.apply(&page, false).unwrap();
    assert_ne!(boundaries(&mut device), original);
    let page = group_page(&mut device);
    assert_eq!(page.0["data"], serde_json::json!([{"id":"p5","at":5000},{"id":"p4","at":4000},{"id":"p3","at":3000},{"id":"p2","at":2000}]));
    assert_eq!(page.0["complete"], false); assert!(page.1);
    assert_ne!(device.query("one", "dev:bob", &serde_json::json!({"p":"p2"}), 4).unwrap().data, Value::Null, "reacquisition does not evict retained rows");
    let (lower, unknown, _) = device.query_with_coverage("lower", "dev:bob", &serde_json::json!({"c":null}), 4000);
    let lower = lower.unwrap(); assert!(unknown && !lower.complete);
    assert_eq!(snapback4_core::wire::to_json(&lower.data), serde_json::json!([{"id":"p3","at":3000},{"id":"p2","at":2000}]));
}
#[test]
fn continuous_renewal_keeps_and_gap_reacquisition_replaces() { renewal(&mut Sqlite::new("w13g-renewal")); renewal(&mut Memory::new()); }

fn staged<H: Host>(host: &mut H) {
    let (mut engine, backend) = setup();
    let mut device = host.open("stage", Some(backend)).unwrap();
    let pages = snapshot_pages(&mut engine, "dev:bob", 2);
    for (i, original) in pages.iter().enumerate() {
        let mut page = original.clone(); page.stage_snapshot = true;
        device.apply(&page, i == 0).unwrap();
        assert_eq!(boundaries(&mut device), None, "even completed groups stay private until catch-up");
    }
    let mut catchup = stream_at(&mut engine, pages[0].watermark, 20_000); catchup.snapshot_catchup = true;
    device.apply(&catchup, false).unwrap();
    let original = boundaries(&mut device); assert!(original.is_some());
    let mut forged = stream_at(&mut engine, catchup.watermark, 20_000);
    forged.acquisitions = vec![snapback4_core::wire::Acquisition { at:0, table:"posts".into(), index:"byTime".into(), group:vec![], floor:Some("whole".into()) }];
    device.apply(&forged, false).unwrap();
    assert_eq!(boundaries(&mut device), original);
    assert_eq!(device.store().meta("device:acquisition-report").unwrap().unwrap(), "ignored acquisition boundary for posts.byTime: group is not acquiring or boundary is invalid");
    assert!(page(&mut device, None).0["complete"].as_bool().unwrap());
    // A legacy wire reply still deserializes; it acquires rows but no floor.
    let mut legacy = snapshot_pages(&mut engine, "dev:bob", 100).remove(0);
    legacy.acquisitions.clear(); device.apply(&legacy, true).unwrap();
    assert!(page(&mut device, None).1);
}
#[test]
fn staged_completion_and_unsolicited_boundary_and_legacy_wire() { staged(&mut Sqlite::new("w13g-stage")); staged(&mut Memory::new()); }

fn paired<H: Host>(host: &mut H) {
    let mut observations = Vec::new();
    for world in 0..2 {
        let (mut engine, backend) = compile(GROUP);
        let mut rows = vec![member("dev:bob"), group_post(1), group_post(2), group_post(3)];
        if world == 1 {
            rows.extend((0..20).map(|n| ("posts".into(), object([("id",id(&format!("hidden-{n}"))),("group",Value::String("secret".into())),("at",Value::Int(n))]))));
        }
        engine.seed_at(rows, 1).unwrap();
        let pages = snapshot_pages(&mut engine, "dev:bob", 1);
        let wire: Vec<_> = pages.iter().map(page_json).collect();
        let mut device = host.open(&format!("world-{world}"), Some(backend)).unwrap();
        for (i, page) in pages.iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        observations.push(serde_json::to_string(&(wire, group_page(&mut device))).unwrap());
    }
    assert_eq!(observations[0], observations[1], "hidden rows do not change wire, rows, complete, cut, next or coverage");
}
#[test]
fn paired_hidden_worlds_have_identical_observations() { paired(&mut Sqlite::new("w13g-worlds")); paired(&mut Memory::new()); }

#[test]
fn persisted_boundary_bytes_at_one_thousand_groups() {
    let (_, backend) = compile(CHAT);
    let index = backend.schema.tables["messages"].index("byConvTime").unwrap();
    let mut markers = Vec::new();
    for group in 0..1000 {
        let row_id = format!("{:032x}", group*500+1);
        let group_id = format!("{group:032x}");
        let row = object([("id",id(&row_id)),("conversationId",id(&group_id)),("at",Value::Int(1000))]);
        let floor = snapback4_core::value::encode_bytes_hex(&snapback4_core::rows::index_key(index, &row, &row_id));
        let start = snapback4_core::wire::Acquisition {at:0,table:"messages".into(),index:"byConvTime".into(),group:vec![serde_json::json!(group_id)],floor:None};
        markers.push(start.clone()); markers.push(snapback4_core::wire::Acquisition {floor:Some(floor), ..start});
    }
    // Measure the metadata alone: 1,000 valid receipts, without allocating 500,000 images.
    let page = serde_json::from_value(serde_json::json!({"snapshot":true,"events":[],"watermark":1,"more":false,"generation":1,"acquisitions":markers})).unwrap();
    let mut memory = Memory::new(); let mut sqlite = Sqlite::new("w13g-bytes");
    let mut mem = memory.open("bytes", Some(backend.clone())).unwrap();
    let mut sql = sqlite.open("bytes", Some(backend)).unwrap();
    mem.apply(&page, true).unwrap(); sql.apply(&page, true).unwrap();
    let text = boundaries(&mut mem).unwrap();
    assert_eq!(Some(text.clone()), boundaries(&mut sql));
    let entries: Vec<(String, String)> = serde_json::from_str(&text).unwrap();
    assert_eq!(entries.len(), 1000);
    let bytes: usize = entries.iter().map(|(k, v)| k.len() + v.len()).sum();
    let floor_bytes: usize = entries.iter().map(|(_, v)| v.len()).sum();
    println!("persisted boundaries: groups=1000 horizon=500 raw-keys=114000 hex-floors={floor_bytes} total-metadata-bytes={bytes}; sqlite and memory have identical values");

}

const GROUP_CHAT: &str = r#"
table members:
  conversation: text <=10
  person: principal
  unique byConversationPerson: conversation, person
  by byPerson: person, conversation
  immutable conversation, person
  read <- .person = viewer
  insert <- deny
  online only
table messages:
  conversation: text <=10
  ordinal: int
  body: text <=40
  by byConversationOrdinal: conversation, ordinal, id
  immutable conversation, ordinal
  read <- exists members[.conversation, viewer]
  update <- allow
  sync to members[.conversation] last 5 by byConversationOrdinal
query timeline(c: cursor ?):
  return messages['g'] after c last 3 by byConversationOrdinal { id, body }
mutation edit(p: messages):
  update messages[p] {body: 'edited'}
"#;
fn group_probe<H: Host>(host: &mut H) {
    let (mut engine, backend) = compile(GROUP_CHAT);
    let mut rows = vec![("members".into(), object([("id",id("m")),("conversation",Value::String("g".into())),("person",id("dev:bob"))]))];
    rows.extend((1..=12).map(|n| ("messages".into(),object([("id",id(&format!("m{n:02}"))),("conversation",Value::String("g".into())),("ordinal",Value::Int(n)),("body",Value::String("original".into()))]))));
    engine.seed_at(rows,1).unwrap();
    let mut device = acquire(host, &mut engine, backend,"group");
    let (first, _) = page(&mut device,None);
    let cursor = first["next"].as_str().unwrap().to_owned();
    let control = page(&mut device,Some(cursor.clone()));
    for p in ["m02","m04"] { engine.mutate("edit",Some(p),context("dev:bob",&[("p",id(p))]).at(2)).unwrap(); }
    catchup(&mut device,&mut engine);
    assert_eq!(page(&mut device,None).0,first);
    let after = page(&mut device,Some(cursor.clone()));
    assert_eq!(after,control); assert!(after.1); assert_eq!(after.0["complete"],false);
    let server = engine.query("timeline",context("dev:bob",&[("c",Value::String(cursor))]).at(3)).unwrap();
    assert!(server.complete);
    assert_eq!(server.data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap()).collect::<Vec<_>>(),["m09","m08","m07"]);
}
#[test]
fn conversation_ordinal_probe_preserves_the_crossing_page() { group_probe(&mut Sqlite::new("w13g-group")); group_probe(&mut Memory::new()); }

fn refresh<H: Host>(host: &mut H) {
    let (mut engine, backend) = compile(&public_source());
    engine.seed_at((1..=12).map(post), 1).unwrap();
    let mut device = acquire(host, &mut engine, backend.clone(), "refresh");
    let original = boundaries(&mut device);
    engine.seed_at([post(13)], 2).unwrap();
    let pages = snapshot_pages(&mut engine, "dev:bob", 2);
    for (i, mut page) in pages.into_iter().enumerate() {
        page.stage_snapshot = true;
        device.apply(&page, i == 0).unwrap();
        assert_eq!(boundaries(&mut device), original);
    }
    let mut catchup = stream_at(&mut engine, engine_head(&device), 20_000);
    catchup.snapshot_catchup = true;
    device.apply(&catchup, false).unwrap();
    assert_ne!(boundaries(&mut device), original, "refresh replaces the boundary at publication");
    let (_, mut successor) = compile(&public_source().replace("last 5 by byTime", "last 6 by byTime"));
    successor.generation = engine.adopt(successor.schema.clone(), successor.programs.clone()).unwrap();
    device.adopt(successor).unwrap();
    assert_eq!(boundaries(&mut device).as_deref(), None);
    assert!(!device.sync_state().unwrap().acquired);
    for (i, page) in snapshot_pages(&mut engine, "dev:bob", 2).into_iter().enumerate() { device.apply(&page, i == 0).unwrap(); }
    assert_eq!(boundaries(&mut device), original, "six selected rows restore the p08 floor");
}
fn engine_head<S: DeviceStore>(device: &Device<S>) -> u64 {
    device.store().meta("device:snapshot:through").unwrap().unwrap().parse().unwrap()
}
#[test]
fn refresh_publishes_new_floor_and_schema_reacquisition_clears_it() { refresh(&mut Sqlite::new("w13g-refresh")); refresh(&mut Memory::new()); }

fn empty_join<H: Host>(host: &mut H) {
    let (mut engine, backend) = compile(GROUP);
    let mut device = acquire(host, &mut engine, backend, "empty-join");
    assert!(group_page(&mut device).1);
    engine.seed_at([member("dev:bob")], 1).unwrap();
    let stream = stream_at(&mut engine, 0, 1);
    assert!(stream.events.is_empty());
    let touched = device.apply(&stream, false).unwrap();
    assert!(touched.iter().any(|table| table == "posts"), "empty-group acquisition invalidates the table's coverage");
    assert_eq!(group_page(&mut device).0["complete"], true);
}
#[test]
fn empty_join_publishes_whole_and_invalidates_coverage() { empty_join(&mut Sqlite::new("w13g-empty-join")); empty_join(&mut Memory::new()); }

#[path = "w13g_review/mod.rs"]
mod review;
