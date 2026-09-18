use super::*;
fn source() -> String {
    GROUP.replace("last 2 by", "last 5 by").replace("  sync to members", "  retain delivered-history\n  sync to members")
        .replace("  update <- deny", "  update <- allow\n  delete <- allow")
        .replace("  update <- allow\n  retain", "  update <- allow\n  delete <- allow\n  retain") + r#"
mutation leave():
  delete members['m']
mutation remove(p: posts):
  delete posts[p]
mutation hide(p: posts):
  update posts[p] {group: 'secret'}
query one(p: posts):
  return posts[p]
"#
}
fn reacquire<H: Host>(host: &mut H, moved: bool) {
    let (mut engine, backend) = compile(&source());
    engine.seed_at([member("dev:bob"), group_post(1), group_post(2)], 1).unwrap();
    let mut device = acquire(host, &mut engine, backend, "gap");
    assert_eq!(group_page(&mut device).0["complete"], true);
    engine.mutate("leave", Some("leave"), context("dev:bob", &[]).at(2)).unwrap();
    catchup(&mut device, &mut engine);
    if moved {
        engine.mutate("move", Some("move"), context("dev:alice", &[("p",id("p2")),("at",Value::Int(-1))]).at(3)).unwrap();
        engine.seed_at((3..=6).map(group_post), 3).unwrap();
    } else { engine.mutate("remove", Some("remove"), context("dev:alice", &[("p",id("p2"))]).at(3)).unwrap(); }
    engine.seed_at([member("dev:bob")], 4).unwrap(); catchup(&mut device, &mut engine);
    let observed = group_page(&mut device);
    assert!(observed.1 && observed.0["complete"] == false, "retained gap must be unknown: {observed:?}");
    assert_ne!(device.query("one", "dev:bob", &serde_json::json!({"p":"p2"}), 20_000).unwrap().data, Value::Null);
    host.close("gap", device); let mut device = host.open("gap", None).unwrap();
    assert!(group_page(&mut device).1);
    for (i, p) in snapshot_pages(&mut engine, "dev:bob", 2).iter().enumerate() { device.apply(p, i == 0).unwrap(); }
    let expected = engine.query("timeline", context("dev:bob", &[("g",Value::String("g".into())),("c",Value::Null)]).at(20_000)).unwrap();
    assert_eq!(group_page(&mut device).0["data"], snapback4_core::wire::to_json(&expected.data));
    assert!(!group_page(&mut device).1);
}
#[test]
fn gap_deletion_stays_unknown_until_snapshot() { reacquire(&mut Sqlite::new("gap-del"), false); reacquire(&mut Memory::new(), false); }
#[test]
fn gap_key_below_new_floor_stays_unknown_until_snapshot() { reacquire(&mut Sqlite::new("gap-move"), true); reacquire(&mut Memory::new(), true); }
fn withheld<H: Host>(host: &mut H, hidden: bool) {
    let mut payloads = Vec::new();
    for at in [800, 2000] {
        let (mut engine, backend) = compile(&source().replace("last 5 by", "last 2 by"));
        // p2 is the oldest selected row in both histories.
        engine.seed_at([("posts".into(), object([("id",id("p1")),("group",Value::String("g".into())),("at",Value::Int(100))])), ("posts".into(), object([("id",id("p2")),("group",Value::String("g".into())),("at",Value::Int(at))])), group_post(3)], 1).unwrap();
        let mut device = acquire(host, &mut engine, backend.clone(), &format!("withheld-{at}"));
        let from = device.sync_state().unwrap().watermark;
        engine.seed_at([member("dev:bob")], 2).unwrap();
        engine.mutate(if hidden {"hide"} else {"remove"}, Some("withhold"), context("dev:alice", &[("p",id("p2"))]).at(3)).unwrap();
        let page = stream_at(&mut engine, from, 4);
        let floor = page.acquisitions.last().unwrap().floor.as_ref().unwrap();
        let key = snapback4_core::value::decode_bytes_hex(floor).unwrap();
        let table = &backend.schema.tables["posts"];
        assert!(page.events.iter().any(|event| event.kind == "put" && event.data.as_ref().is_some_and(|row| {
            let row = snapback4_core::wire::row_from_json(table, row).unwrap();
            snapback4_core::rows::index_key(table.index("byTime").unwrap(), &row, &event.id) == key
        })), "the floor must be a delivered current key");
        device.apply(&page, false).unwrap();
        let local = group_page(&mut device);
        assert_eq!(local.0["data"], serde_json::json!([{"id":"p3","at":3000}])); assert!(local.1);
        payloads.push(serde_json::to_string(&(page_json(&page), local)).unwrap());
    }
    assert_eq!(payloads[0], payloads[1]);
}
#[test]
fn deleted_floor_is_not_disclosed() { withheld(&mut Sqlite::new("del-floor"), false); withheld(&mut Memory::new(), false); }
#[test]
fn unreadable_floor_is_not_disclosed() { withheld(&mut Sqlite::new("hidden-floor"), true); withheld(&mut Memory::new(), true); }
fn skipped<H: Host>(host: &mut H) {
    let (mut engine, backend) = setup(); let pages = snapshot_pages(&mut engine, "dev:bob", 2); assert_eq!(pages.len(), 3);
    let mut device = host.open("skip", Some(backend)).unwrap();
    let mut first = pages[0].clone(); first.stage_snapshot = true; device.apply(&first, true).unwrap();
    let mut last = pages[2].clone(); last.stage_snapshot = true;
    let refused = device.apply(&last, false); assert!(refused.is_err(), "skipped middle snapshot page must be refused");
    println!("skipped snapshot refusal: {}", refused.unwrap_err());
    let mut catchup = stream_at(&mut engine, pages[0].watermark, 20_000); catchup.snapshot_catchup = true;
    assert!(device.apply(&catchup, false).is_err(), "no terminal page has arrived");
    for p in &pages[1..] { let mut p = p.clone(); p.stage_snapshot = true; device.apply(&p, false).unwrap(); }
    device.apply(&catchup, false).unwrap(); assert_eq!(page(&mut device, None).0["complete"], true);
}
#[test]
fn skipped_snapshot_page_is_refused_before_publication() { skipped(&mut Sqlite::new("skip")); skipped(&mut Memory::new()); }
#[test]
fn five_thousand_empty_groups_make_bounded_progress() {
    let (mut engine, _) = compile(&GROUP.replace("text <=10", "text <=440"));
    engine.seed_at((0..5000).map(|n| ("members".into(), object([("id",id(&format!("m{n}"))),("person",id("dev:bob")),("group",Value::String(format!("{n:04}{}", "😀".repeat(430))))]))), 1).unwrap();
    let mut cursor = None; let mut groups = 0; let mut pages = 0; let mut max_bytes = 0;
    loop {
        let p = engine.snapshot_acquisition_page_at("dev:bob", cursor.as_deref(), if pages == 0 { 1 } else { 32 }, 2).unwrap();
        max_bytes = max_bytes.max(serde_json::to_vec(&p.acquisitions).unwrap().len());
        assert!(p.events.is_empty()); assert!(p.acquisitions.len() <= if pages == 0 { 2 } else { 64 }, "limit 1 emitted {} group markers", p.acquisitions.len());
        groups += p.acquisitions.iter().filter(|a| a.floor.as_deref() == Some("whole")).count();
        pages += 1; cursor = p.next.map(|c| c.encode()); if cursor.is_none() { break; } assert!(pages <= 5000);
    }
    assert_eq!(groups, 5000); println!("empty groups: groups={groups} first-limit=1 subsequent-limit=32 pages={pages} max-acquisition-bytes={max_bytes}");
}
#[test]
fn ordinary_stream_does_not_rewrite_boundaries() {
    let (mut engine, backend) = setup(); let mut host = Memory::new(); let mut device = acquire(&mut host, &mut engine, backend, "writes");
    device.store().drain(); catchup(&mut device, &mut engine);
    assert!(device.store().drain().iter().all(|c| !c.k.starts_with(BOUNDARIES)), "unchanged boundaries must not be persisted");
}

mod counting;
mod recheck;
#[test]
fn thousand_lane_merge_loads_boundaries_once() {
    use std::rc::Rc;
    let mut source = GROUP.replace("text <=10", "text <=40");
    source.push_str("\nquery merged(c: cursor ?):\n  return merge posts after c last 1 by byTime:\n");
    for g in 0..1000 { source.push_str(&format!("    ['{g:032x}']\n")); }
    let (mut engine, backend) = compile(&source);
    let mut seed = Vec::new();
    for g in 0..1000 {
        let group = Value::String(format!("{g:032x}"));
        seed.push(("members".into(), object([("id",id(&format!("m{g}"))),("person",id("dev:bob")),("group",group.clone())])));
        seed.push(("posts".into(), object([("id",id(&format!("{g:032x}"))),("at",Value::Int(g)),("group",group)])));
    }
    engine.seed_at(seed, 1).unwrap();
    let counts = Rc::new(counting::Counts::default());
    let store = counting::Counted { store: snapback4_device::memory::MemoryStore::new(), counts: counts.clone() };
    let mut device = Device::open_store(store, Some(backend)).unwrap();
    for (i, p) in snapshot_pages(&mut engine, "dev:bob", 10000).iter().enumerate() { device.apply(p, i == 0).unwrap(); }
    counts.legacy.set(0); counts.boundary_loads.set(0); counts.lanes.set(0);
    let read = device.query("merged", "dev:bob", &serde_json::json!({"c":null}), 20_000).unwrap();
    println!("1000-lane merge: lanes={} whole-map-parses={} boundary-namespace-loads={}", counts.lanes.get(), counts.legacy.get(), counts.boundary_loads.get());
    assert!(read.complete); assert_eq!(read.data.as_array().unwrap().len(), 1);
    assert_eq!(counts.lanes.get(), 1001); assert_eq!(counts.legacy.get(), 0); assert_eq!(counts.boundary_loads.get(), 1);
    counts.boundary_loads.set(0); device.store().store.drain();
    let watermark = device.sync_state().unwrap().watermark;
    let empty = stream_at(&mut engine, watermark, 20_000);
    device.apply(&empty, false).unwrap();
    assert_eq!(counts.boundary_loads.get(), 0, "ordinary pages do not load the namespace");
    assert!(device.store().store.drain().iter().all(|c| !c.k.starts_with(BOUNDARIES)));
    let group = format!("{:032x}", 0);
    let table = &device.schema().tables["posts"];
    let row = object([("id",id(&group)),("group",Value::String(group.clone())),("at",Value::Int(0))]);
    let floor = snapback4_core::value::encode_bytes_hex(&snapback4_core::rows::index_key(table.index("byTime").unwrap(), &row, &group));
    let mut changed = empty;
    let begin = snapback4_core::wire::Acquisition {at:0,table:"posts".into(),index:"byTime".into(),group:vec![serde_json::json!(group)],floor:None};
    changed.acquisitions = vec![begin.clone(), snapback4_core::wire::Acquisition {floor:Some(floor),..begin}];
    device.apply(&changed, false).unwrap();
    let writes = device.store().store.drain().into_iter().filter(|c| c.k.starts_with(BOUNDARIES)).count();
    assert_eq!(writes, 1); assert_eq!(counts.boundary_loads.get(), 0);
    println!("ordinary stream: namespace-loads=0 boundary-writes=0; one changed group: namespace-loads=0 boundary-writes={writes}");
}

#[test]
fn no_delivered_selected_key_leaves_acquisition_unknown() {
    let (mut engine, backend) = compile(&source().replace("last 5 by", "last 2 by"));
    engine.seed_at([group_post(1), group_post(2), group_post(3)], 1).unwrap();
    let mut host = Memory::new(); let mut device = acquire(&mut host, &mut engine, backend, "none-delivered");
    let from = device.sync_state().unwrap().watermark;
    engine.seed_at([member("dev:bob")], 2).unwrap();
    for p in ["p2", "p3"] { engine.mutate("remove", Some(p), context("dev:alice", &[("p",id(p))]).at(3)).unwrap(); }
    let stream = stream_at(&mut engine, from, 4);
    assert_eq!(stream.acquisitions.len(), 1); assert!(stream.acquisitions[0].floor.is_none());
    device.apply(&stream, false).unwrap(); assert!(group_page(&mut device).1);
}
