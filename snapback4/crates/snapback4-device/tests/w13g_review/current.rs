//! Ruling 36: the acquired image and boundary are selected when served.
use super::*;

fn wire(engine: &mut Engine, from: u64, limit: usize, now: i64) -> snapback4_device::device::StreamPage {
    let page = engine.stream_at("dev:bob", from, limit, now).unwrap();
    serde_json::from_value(serde_json::json!({"snapshot":false,"generation":engine.generation(),"acquisitions":page.acquisitions,"joined":page.joined,
        "events":page.events.iter().map(|e| serde_json::json!({"table":e.table,"kind":e.kind,"id":e.id,"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),
        "watermark":page.watermark,"more":page.more})).unwrap()
}

fn paged<H: Host>(host: &mut H) {
    for staged in [false, true] { for change in ["below", "delete", "group", "expiry"] {
        let source = source().replace("last 5 by", "last 2 by")
            .replace("  at: time", "  at: time\n  until: time ?\n  expire at .until\n  by byExpiry: until")
            + "\nmutation expire(p: posts):\n  update posts[p] {until: 10}\n";
        let (mut engine, backend) = compile(&source);
        engine.seed_at([group_post(1), group_post(2), group_post(3)], 1).unwrap();
        let mut device = host.open(&format!("paged-{staged}-{change}"), Some(backend)).unwrap();
        let mut before = snapshots_at(&mut engine, 1, 100).remove(0); before.stage_snapshot = staged;
        device.apply(&before, true).unwrap();
        engine.seed_at([member("dev:bob")], 2).unwrap();
        engine.seed_at([group_post(4)], 3).unwrap();
        let mut page = wire(&mut engine, before.watermark, 1, 4);
        assert!(page.more); assert_eq!(page.events.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), ["p4", "p3"]);
        let floor = page.acquisitions.last().unwrap().floor.clone();
        page.snapshot_catchup = staged; device.apply(&page, false).unwrap();
        let mut duplicate = wire(&mut engine, page.watermark, 1, 4);
        assert_eq!(duplicate.events.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), ["p4"]);
        duplicate.snapshot_catchup = staged; device.apply(&duplicate, false).unwrap();
        assert_eq!(group_page(&mut device).0["data"], serde_json::json!([{"id":"p4","at":4000},{"id":"p3","at":3000}]));
        let op = match change { "below" => "move", "delete" => "remove", "group" => "hide", _ => "expire" };
        let mut values = vec![("p", id("p4"))]; if change == "below" { values.push(("at", Value::Int(500))); }
        engine.mutate(op, Some("change"), context("dev:alice", &values).at(5)).unwrap();
        let changed = wire(&mut engine, duplicate.watermark, 1, 10); device.apply(&changed, false).unwrap();
        let one = device.query("one", "dev:bob", &serde_json::json!({"p":"p4"}), 10).unwrap();
        if change == "below" { assert_eq!(one.data.field("at").unwrap(), &Value::Int(500)); }
        else { assert_eq!(one.data, Value::Null); }
        let values = boundaries(&mut device).unwrap(); assert!(values.contains(floor.as_ref().unwrap()), "ordinary updates keep the floor");
        assert_eq!(group_page(&mut device).0["data"], serde_json::json!([{"id":"p3","at":3000}]));
        println!("{} paged duplicate: staged={staged} change={change} acquisition=2 later-put=1 final-suffix=1", host.label());
    } }
}
#[test]
fn current_join_paged_duplicates_moves_expiry_and_below_floor_sqlite() { paged(&mut Sqlite::new("w13k-current")); }
#[test]
fn current_join_paged_duplicates_moves_expiry_and_below_floor_memory() { paged(&mut Memory::new()); }

#[test]
fn stable_group_snapshot_and_stream_have_identical_rows_and_floor() {
    let (mut engine, _) = compile(GROUP);
    engine.seed_at((1..=12).map(group_post), 1).unwrap();
    let from = engine.seq().unwrap(); engine.seed_at([member("dev:bob")], 2).unwrap();
    let stream = stream_at(&mut engine, from, 3);
    let snapshot = snapshots_at(&mut engine, 3, 1);
    let events: Vec<_> = snapshot.iter().flat_map(|p| p.events.iter().map(|e| (&e.id, &e.data))).collect();
    assert_eq!(events, stream.events.iter().map(|e| (&e.id, &e.data)).collect::<Vec<_>>());
    let floors: Vec<_> = snapshot.iter().flat_map(|p| p.acquisitions.iter().filter_map(|a| a.floor.clone())).collect();
    assert_eq!(floors, stream.acquisitions.iter().filter_map(|a| a.floor.clone()).collect::<Vec<_>>());
}

#[test]
fn group_acquisition_stops_at_n_readable_rows_without_lookahead() {
    let (mut engine, backend) = compile(GROUP);
    engine.seed_at((1..=100).map(group_post), 1).unwrap();
    let from = engine.seq().unwrap(); engine.seed_at([member("dev:bob")], 2).unwrap();
    let tx = engine.store_mut().transaction().unwrap();
    let counted = counting::Partition::new(&tx);
    // One unchanged membership witness serves both readable candidates.
    let stream = snapback4_core::partition::stream(&counted, &backend.schema, "dev:bob", from, 1, 3).unwrap();
    assert_eq!((stream.events.len(), counted.selected_rows.get(), counted.probes.get(), counted.content_scans.get()), (2, 2, 1, 1));
    println!("GROUP stream: stored=100 horizon=2 delivered=2 physical-rows={} read-rule-probes={} content-scans={}", counted.selected_rows.get(), counted.probes.get(), counted.content_scans.get());
    let counted = counting::Partition::new(&tx);
    let snapshot = snapback4_core::partition::snapshot_page(&counted, &backend.schema, "dev:bob", None, 100, 3).unwrap();
    assert_eq!(snapshot.acquisitions, stream.acquisitions);
    assert_eq!((counted.selected_rows.get(), counted.probes.get(), counted.content_scans.get()), (2, 1, 1));
    println!("GROUP snapshot: delivered={} physical-rows={} read-rule-probes={} content-scans={}", snapshot.events.len(), counted.selected_rows.get(), counted.probes.get(), counted.content_scans.get());
}

#[test]
fn ordinary_stream_delivers_current_readable_images() {
    let (mut engine, backend) = compile(&source());
    engine.seed_at([member("dev:bob")], 1).unwrap();
    let from = engine.seq().unwrap();
    engine.seed_at((1..=100).map(group_post), 2).unwrap();
    engine.mutate("move", Some("move"), context("dev:alice", &[("p", id("p1")), ("at", Value::Int(7777))]).at(3)).unwrap();
    engine.mutate("hide", Some("hide"), context("dev:alice", &[("p", id("p2"))]).at(4)).unwrap();
    let tx = engine.store_mut().transaction().unwrap();
    let counted = counting::Partition::new(&tx);
    let page = snapback4_core::partition::stream(&counted, &backend.schema, "dev:bob", from, 1, 5).unwrap();
    assert_eq!(page.events.len(), 99, "the indivisible commit includes every current readable row");
    assert_eq!(page.events.iter().take(2).map(|event| event.id.as_str()).collect::<Vec<_>>(), ["p1", "p3"]);
    assert!(!page.events.iter().any(|event| event.id == "p2"), "hidden images never reach the wire");
    assert_eq!(page.events[0].data.as_ref().unwrap().field("at").unwrap(), &Value::Int(7777));
    assert_eq!(counted.content_gets.get(), 100, "each current image is fetched once, including the hidden row");
}
