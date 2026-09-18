use super::*;

fn program() -> String {
    source().replace("last 5 by", "last 2 by") + r#"
query newest(c: cursor ?):
  return posts['g'] after c last 1 by byTime { id, at }
query above(c: cursor ?):
  return posts['g', at >= 2500] after c last 2 by byTime { id, at }
"#
}

fn seed(times: [i64; 3]) -> Vec<(String, Value)> {
    times.into_iter().enumerate().map(|(i, at)| ("posts".into(), object([
        ("id", id(&format!("p{}", i + 1))), ("group", Value::String("g".into())), ("at", Value::Int(at)),
    ]))).collect()
}

fn moved_survivor<H: Host>(host: &mut H, hidden: bool) {
    let mut payloads = Vec::new();
    let mut completions = Vec::new();
    for at in [800, 2000] {
        let (mut engine, backend) = compile(&program());
        engine.seed_at(seed([100, at, 3000]), 1).unwrap();
        let mut device = acquire(host, &mut engine, backend, &format!("moved-survivor-{at}"));
        let from = device.sync_state().unwrap().watermark;
        engine.seed_at([member("dev:bob")], 2).unwrap();
        engine.mutate(if hidden { "hide" } else { "remove" }, Some("withhold"), context("dev:alice", &[("p", id("p2"))]).at(3)).unwrap();
        engine.mutate("move", Some("move"), context("dev:alice", &[("p", id("p3")), ("at", Value::Int(1000))]).at(4)).unwrap();
        let stream = stream_at(&mut engine, from, 5);
        payloads.push(serde_json::to_string(&page_json(&stream)).unwrap());
        completions.push(stream.acquisitions.iter().filter_map(|a| a.floor.clone()).collect::<Vec<_>>());
        device.apply(&stream, false).unwrap();
        let local = group_page(&mut device);
        assert_eq!(local.0["data"], serde_json::json!([{"id":"p3","at":1000},{"id":"p1","at":100}]));
        assert!(!local.1 && local.0["complete"] == true);
    }
    assert_eq!(payloads[0], payloads[1], "completion presence must not reveal the withheld historical key");
    assert_eq!(completions[0].len(), 1, "the current top two are acquired in both histories");
    println!("{} moved survivor hidden={hidden}: payload-bytes={} identical-worlds=2 completions=1 key-at=100", host.label(), payloads[0].len());
}

#[test]
fn moved_survivor_deleted_floor_sqlite() { moved_survivor(&mut Sqlite::new("recheck-del"), false); }
#[test]
fn moved_survivor_deleted_floor_memory() { moved_survivor(&mut Memory::new(), false); }
#[test]
fn moved_survivor_hidden_floor_sqlite() { moved_survivor(&mut Sqlite::new("recheck-hide"), true); }
#[test]
fn moved_survivor_hidden_floor_memory() { moved_survivor(&mut Memory::new(), true); }

fn unselected_control<H: Host>(host: &mut H, remove_selected: bool) {
    let (mut engine, backend) = compile(&program());
    engine.seed_at(seed([1500, 2000, 3000]), 1).unwrap();
    let mut device = acquire(host, &mut engine, backend, "unselected");
    let from = device.sync_state().unwrap().watermark;
    engine.seed_at([member("dev:bob")], 2).unwrap();

    engine.mutate("move", Some("move"), context("dev:alice", &[("p", id("p3")), ("at", Value::Int(1000))]).at(3)).unwrap();
    if remove_selected { engine.mutate("remove", Some("remove"), context("dev:alice", &[("p", id("p2"))]).at(4)).unwrap(); }
    let stream = stream_at(&mut engine, from, 5);
    let floors = stream.acquisitions.iter().filter_map(|a| a.floor.clone()).collect::<Vec<_>>();
    assert_eq!(floors.len(), 1);
    let key = snapback4_core::key::decode(&snapback4_core::value::decode_bytes_hex(&floors[0]).unwrap()).unwrap();
    assert_eq!(key[1], Value::Int(if remove_selected { 1000 } else { 1500 }));
    device.apply(&stream, false).unwrap();
    for name in ["newest", "above"] {
        let (read, unknown, _) = device.query_with_coverage(name, "dev:bob", &serde_json::json!({"c":null}), 5);
        assert!(read.unwrap().complete, "{name}: exact/above the published key");
        assert!(!unknown);
    }
    let local = group_page(&mut device);
    assert!(!local.1 && local.0["complete"] == true, "the current top two form a complete page");
    assert_eq!(local.0["data"], if remove_selected { serde_json::json!([{"id":"p1","at":1500},{"id":"p3","at":1000}]) } else { serde_json::json!([{"id":"p2","at":2000},{"id":"p1","at":1500}]) });
    println!("{} unselected control removed={remove_selected}: completions={} key-at={} page-complete=true", host.label(), floors.len(), if remove_selected { "1000" } else { "1500" });
}

#[test]
fn current_selection_includes_previously_unselected_row_sqlite() { unselected_control(&mut Sqlite::new("recheck-control"), false); }
#[test]
fn current_selection_includes_previously_unselected_row_memory() { unselected_control(&mut Memory::new(), false); }
#[test]
fn current_selection_replaces_deleted_selected_row_sqlite() { unselected_control(&mut Sqlite::new("recheck-block"), true); }
#[test]
fn current_selection_replaces_deleted_selected_row_memory() { unselected_control(&mut Memory::new(), true); }

fn changed_unselected<H: Host>(host: &mut H) {
    for action in ["move-up", "move-down", "remove", "hide"] {
        let (mut engine, backend) = compile(&program());
        engine.seed_at(seed([1500, 2000, 3000]), 1).unwrap();
        let index = backend.schema.tables["posts"].index("byTime").unwrap();
        let (floor_id, floor_at) = if action == "move-down" { ("p1", 500) } else { ("p3", 1000) };
        let row = object([("id", id(floor_id)), ("group", Value::String("g".into())), ("at", Value::Int(floor_at))]);
        let expected = if action.starts_with("move") { snapback4_core::value::encode_bytes_hex(&snapback4_core::rows::index_key(index, &row, floor_id)) } else { "whole".into() };
        let mut device = acquire(host, &mut engine, backend, action);
        let from = device.sync_state().unwrap().watermark;
        engine.seed_at([member("dev:bob")], 2).unwrap();
        engine.mutate("remove", Some("remove-p2"), context("dev:alice", &[("p", id("p2"))]).at(3)).unwrap();
        engine.mutate("move", Some("move-p3"), context("dev:alice", &[("p", id("p3")), ("at", Value::Int(1000))]).at(4)).unwrap();
        let args = if action.starts_with("move") { vec![("p", id("p1")), ("at", Value::Int(if action == "move-up" { 2500 } else { 500 }))] } else { vec![("p", id("p1"))] };
        engine.mutate(if action.starts_with("move") { "move" } else { action }, Some("change-p1"), context("dev:alice", &args).at(5)).unwrap();
        // The acquisition already selects current images when their own
        // writes are delivered on a later raw-log page.
        let first = engine.stream_at("dev:bob", from, 1, 6).unwrap();
        assert!(first.more);
        assert_eq!(first.acquisitions.last().unwrap().floor.as_deref(), Some(expected.as_str()), "{action}");
        let stream = stream_at(&mut engine, from, 6);
        assert_eq!(stream.acquisitions.last().unwrap().floor.as_deref(), Some(expected.as_str()), "{action}");
        device.apply(&stream, false).unwrap();
        let (read, unknown, _) = device.query_with_coverage("newest", "dev:bob", &serde_json::json!({"c":null}), 6);
        let read = read.unwrap(); assert!(read.complete && !unknown);
        assert_eq!(read.data.as_array().unwrap()[0].field("id").unwrap(), &id(if action == "move-up" { "p1" } else { "p3" }));
    }
}
#[test]
fn changed_unselected_images_do_not_block_sqlite() { changed_unselected(&mut Sqlite::new("recheck-changed")); }
#[test]
fn changed_unselected_images_do_not_block_memory() { changed_unselected(&mut Memory::new()); }

fn whole_withheld<H: Host>(host: &mut H) {
    for hidden in [false, true] {
        let (mut engine, backend) = compile(&program());
        engine.seed_at([group_post(1)], 1).unwrap();
        let mut device = acquire(host, &mut engine, backend, &format!("whole-{hidden}"));
        let from = device.sync_state().unwrap().watermark;
        engine.seed_at([member("dev:bob")], 2).unwrap();
        engine.mutate(if hidden { "hide" } else { "remove" }, Some("withhold"), context("dev:alice", &[("p", id("p1"))]).at(3)).unwrap();
        let stream = stream_at(&mut engine, from, 4);
        assert_eq!(stream.acquisitions.last().unwrap().floor.as_deref(), Some("whole"));
        device.apply(&stream, false).unwrap();
        let local = group_page(&mut device);
        assert_eq!(local.0["data"], serde_json::json!([])); assert_eq!(local.0["complete"], true); assert!(!local.1);
    }
}
#[test]
fn whole_selection_with_no_current_rows_sqlite() { whole_withheld(&mut Sqlite::new("recheck-whole")); }
#[test]
fn whole_selection_with_no_current_rows_memory() { whole_withheld(&mut Memory::new()); }

fn written_unselected<H: Host>(host: &mut H, round_trip: bool) {
    let mut payloads = Vec::new();
    let mut floors = Vec::new();
    let mut reads = Vec::new();
    let mut expected = String::new();
    for at in if round_trip { vec![1500, 1200] } else { vec![1500] } {
        let (mut engine, backend) = compile(&program());
        engine.seed_at(seed([at, 2000, 3000]), 1).unwrap();
        let index = backend.schema.tables["posts"].index("byTime").unwrap();
        let row = object([("id", id("p3")), ("group", Value::String("g".into())), ("at", Value::Int(1000))]);
        expected = snapback4_core::value::encode_bytes_hex(&snapback4_core::rows::index_key(index, &row, "p3"));
        let mut device = acquire(host, &mut engine, backend, &format!("written-{round_trip}-{at}"));
        let from = device.sync_state().unwrap().watermark;
        engine.seed_at([member("dev:bob")], 2).unwrap();
        engine.mutate("remove", Some("remove-p2"), context("dev:alice", &[("p", id("p2"))]).at(3)).unwrap();
        engine.mutate("move", Some("move-p3"), context("dev:alice", &[("p", id("p3")), ("at", Value::Int(1000))]).at(4)).unwrap();
        if round_trip { engine.mutate("move", Some("move-p1-away"), context("dev:alice", &[("p", id("p1")), ("at", Value::Int(1700))]).at(5)).unwrap(); }
        engine.mutate("move", Some("write-p1"), context("dev:alice", &[("p", id("p1")), ("at", Value::Int(1500))]).at(6)).unwrap();
        let stream = stream_at(&mut engine, from, 7);
        let puts = stream.events.iter().filter(|e| e.id == "p1" && e.kind == "put").collect::<Vec<_>>();
        assert_eq!(puts.len(), if round_trip { 3 } else { 2 }, "acquisition plus each later put");
        assert!(puts.iter().all(|e| e.data.as_ref().unwrap()["at"] == 1500), "every put substitutes the current image");
        payloads.push(serde_json::to_string(&page_json(&stream)).unwrap());
        floors.push(stream.acquisitions.iter().filter_map(|a| a.floor.clone()).collect::<Vec<_>>());
        device.apply(&stream, false).unwrap();
        reads.push(group_page(&mut device));
    }
    if round_trip { assert_eq!(payloads[0], payloads[1], "all payload bytes, including completion presence, must ignore the withheld pre-join key"); }
    for floor in floors { assert_eq!(floor, vec![expected.clone()], "the current top two define the floor"); }
    for (read, unknown) in reads {
        assert_eq!(read["data"], serde_json::json!([{"id":"p1","at":1500},{"id":"p3","at":1000}]));
        assert_eq!(read["complete"], true); assert!(!unknown);
    }
    println!("{} written unselected round-trip={round_trip}: payload-bytes={} worlds={} p1-puts={} completions=1 key-at=1000", host.label(), payloads[0].len(), payloads.len(), if round_trip { 3 } else { 2 });
}
#[test]
fn written_unselected_round_trip_sqlite() { written_unselected(&mut Sqlite::new("written-round-trip"), true); }
#[test]
fn written_unselected_round_trip_memory() { written_unselected(&mut Memory::new(), true); }
#[test]
fn written_unselected_same_key_sqlite() { written_unselected(&mut Sqlite::new("written-same-key"), false); }
#[test]
fn written_unselected_same_key_memory() { written_unselected(&mut Memory::new(), false); }

fn membership_collision<H: Host>(host: &mut H, kind: &str, row_event: Option<&str>) {
    let collision = snapback4_core::value::canonical_json(&vec![Value::String("g".into())]);
    assert_eq!(collision, r#"[{"String":"g"}]"#);
    let mut payloads = Vec::new();
    let mut floors = Vec::new();
    let mut reads = Vec::new();
    let mut expected = String::new();
    for group in ["g", "h"] {
        let source = program() + "\nmutation leaveCharlie():\n  delete members['mc']\n";
        let (mut engine, backend) = compile(&source);
        let charlie = ("members".into(), object([("id", id("mc")), ("group", Value::String(group.into())), ("person", id("dev:charlie"))]));
        let mut rows = seed([1500, 2000, 3000]);
        rows[0].1 = object([("id", id(&collision)), ("group", Value::String("g".into())), ("at", Value::Int(1500))]);
        if kind == "scope" { rows.push(charlie.clone()); }
        engine.seed_at(rows, 1).unwrap();
        let index = backend.schema.tables["posts"].index("byTime").unwrap();
        let (boundary_id, at) = if row_event == Some("del") { ("p3", 1000) } else { (collision.as_str(), 1500) };
        let boundary = object([("id", id(boundary_id)), ("group", Value::String("g".into())), ("at", Value::Int(at))]);
        expected = snapback4_core::value::encode_bytes_hex(&snapback4_core::rows::index_key(index, &boundary, boundary_id));
        let mut device = acquire(host, &mut engine, backend, &format!("collision-{kind}-{row_event:?}-{group}"));
        let from = device.sync_state().unwrap().watermark;
        engine.seed_at([member("dev:bob")], 2).unwrap();
        let join_seq = engine.store().seq().unwrap();
        engine.mutate("move", Some("move-p3"), context("dev:bob", &[("p", id("p3")), ("at", Value::Int(1000))]).at(3)).unwrap();
        if kind == "scope" {
            engine.mutate("leaveCharlie", Some("leave-charlie"), context("dev:charlie", &[]).at(4)).unwrap();
        } else { engine.seed_at([charlie], 4).unwrap(); }
        // Pin the actual namespace collision in Charlie's private ledger.
        let tx = engine.store_mut().transaction().unwrap();
        let private = tx.membership_transitions(&snapback4_core::partition::partition_of("dev:charlie"), join_seq).unwrap();
        assert_eq!(private.len(), 1); assert_eq!(private[0].table, "posts"); assert_eq!(private[0].kind, kind);
        assert_eq!(private[0].id, snapback4_core::value::canonical_json(&vec![Value::String(group.into())]));
        drop(tx);
        if let Some(event) = row_event {
            let args = if event == "put" { vec![("p", id(&collision)), ("at", Value::Int(1500))] } else { vec![("p", id(&collision))] };
            engine.mutate(if event == "put" { "move" } else { "remove" }, Some("write-collision"), context("dev:bob", &args).at(5)).unwrap();
        }
        let stream = stream_at(&mut engine, from, 6);
        assert!(stream.events.iter().all(|e| e.table == "posts" && matches!(e.kind.as_str(), "put" | "del")), "private membership events never reach Bob");
        let colliding: Vec<_> = stream.events.iter().filter(|e| e.id == collision).collect();
        assert_eq!(colliding.len(), if row_event == Some("put") { 2 } else { 1 });
        assert_eq!(colliding.last().unwrap().kind, row_event.unwrap_or("put"));
        assert_eq!(stream.events.iter().filter(|e| e.kind == "put" && e.id != collision).map(|e| e.id.as_str()).collect::<Vec<_>>(), if row_event == Some("del") { vec!["p2", "p3", "p3"] } else { vec!["p2", "p3"] });
        payloads.push(serde_json::to_string(&page_json(&stream)).unwrap());
        floors.push(stream.acquisitions.iter().filter_map(|a| a.floor.clone()).collect::<Vec<_>>());
        let truth = engine.query("timeline", context("dev:bob", &[("g", Value::String("g".into())), ("c", Value::Null)]).at(6)).unwrap();
        assert_eq!(snapback4_core::wire::to_json(&truth.data), if row_event == Some("del") {
            serde_json::json!([{"id":"p2","at":2000},{"id":"p3","at":1000}])
        } else { serde_json::json!([{"id":"p2","at":2000},{"id":collision,"at":1500}]) });
        device.apply(&stream, false).unwrap(); reads.push(group_page(&mut device));
    }
    assert_eq!(payloads[0], payloads[1], "hidden membership must not change any payload byte, markers included");
    for floor in floors { assert_eq!(floor, vec![expected.clone()]); }
    for (read, unknown) in reads {
        let second = if row_event != Some("del") { serde_json::json!({"id":collision,"at":1500}) } else { serde_json::json!({"id":"p3","at":1000}) };
        assert_eq!(read["data"], serde_json::json!([{"id":"p2","at":2000},second]));
        assert_eq!(read["complete"], true); assert!(!unknown);
    }
    println!("{} membership collision kind={kind} row-event={row_event:?}: payload-bytes={} identical-worlds=2 completions=1 key-at={}", host.label(), payloads[0].len(), if row_event == Some("del") { 1000 } else { 1500 });
}
#[test]
fn membership_collision_scope_sqlite() { membership_collision(&mut Sqlite::new("collision-scope"), "scope", None); }
#[test]
fn membership_collision_scope_memory() { membership_collision(&mut Memory::new(), "scope", None); }
#[test]
fn membership_collision_join_sqlite() { membership_collision(&mut Sqlite::new("collision-join"), "join", None); }
#[test]
fn membership_collision_join_memory() { membership_collision(&mut Memory::new(), "join", None); }
#[test]
fn membership_collision_row_controls_sqlite() {
    for kind in ["join", "scope"] { for event in ["put", "del"] { membership_collision(&mut Sqlite::new("collision-row"), kind, Some(event)); } }
}
#[test]
fn membership_collision_row_controls_memory() {
    for kind in ["join", "scope"] { for event in ["put", "del"] { membership_collision(&mut Memory::new(), kind, Some(event)); } }
}
