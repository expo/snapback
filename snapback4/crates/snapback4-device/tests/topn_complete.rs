mod common;
#[path = "../../snapback4-sim/tests/common/topn.rs"]
mod fixture;
#[path = "../../snapback4-sim/tests/common/topn_boundaries.rs"]
mod boundaries;
use common::*;
use serde_json::json;
use snapback4_core::engine::ReadCut;

fn acquired<H: Host>(host: &mut H, horizon: bool) {
    let source = if horizon { fixture::SOURCE.replace("sync public", "sync public last 5 by byAt") } else { fixture::SOURCE.into() };
    let (mut engine, backend) = compile(&source);
    engine.seed(fixture::rows()).unwrap();
    let mut device = host.open("topn", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "alice", 250).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    // Cross persistence as real clients do before observing coverage.
    host.close("topn", device);
    let mut device = host.open("topn", None).unwrap();
    if horizon {
        let (read, unknown, _) = device.query_with_coverage("plain", "alice", &json!({}), 2000);
        let read = read.unwrap();
        assert!(!read.complete && unknown && read.cut.is_none() && read.next.is_none(), "{read:?}");
        assert_eq!(read.data.as_array().unwrap().len(), 5);
        fixture::check("plain", engine.query("plain", context("alice", &[])).unwrap());
        let preview = device.query("preview", "alice", &json!({}), 2000).unwrap();
        fixture::check("preview", preview);
    } else {
        for op in fixture::OPS { fixture::check(op, device.query(op, "alice", &json!({}), 2000).unwrap()); }
        let (read, unknown, _) = device.query_with_coverage("top", "alice", &json!({"slow": false}), 2000);
        fixture::check("top", read.unwrap());
        assert!(!unknown, "a top-N answer needs no fallback");
        let (read, unknown, _) = device.query_with_coverage("top", "alice", &json!({"slow": true}), 2000);
        let read = read.unwrap();
        assert!(!read.complete && read.next.is_none() && !unknown, "{read:?}");
        assert_eq!(read.cut, Some(ReadCut::Meter));
        let (read, unknown, _, components) = device.query_with_components("preview", "alice", &json!({}), 2000);
        fixture::check("preview", read.unwrap());
        assert!(!unknown);
        assert!(components["latest"].complete, "{components:?}");
    }
}

#[test]
fn sqlite_top_n_and_preview() { acquired(&mut Sqlite::new("topn"), false); }
#[test]
fn memory_top_n_and_preview() { acquired(&mut Memory::new(), false); }
#[test]
fn sqlite_horizon_remains_incomplete() { acquired(&mut Sqlite::new("topn-horizon"), true); }
#[test]
fn memory_horizon_remains_incomplete() { acquired(&mut Memory::new(), true); }

// A temporary audience must still be checked at read time on the device.
// Its unpinned room makes the prefix undecided even if every candidate is visible.
fn undecided<H: Host>(host: &mut H) {
    let source = r#"
table members:
  room: id
  principal: principal
  until: time ?
  expire at .until
  unique room, principal
  read <- exists members[.room, viewer]
  sync to members[.room]
table messages:
  room: id
  at: time
  body: text <=30
  search body
  read <- exists members[.room, viewer]
  sync to members[.room]
query top():
  return messages matching 'cof' last 10 by .at
"#;
    let (mut engine, backend) = compile(source);
    let row = |table: &str, value: serde_json::Value| (table.to_owned(), snapback4_core::wire::row_from_json(&backend.schema.tables[table], &value).unwrap());
    let mut seeds = vec![row("members", json!({"id":"member", "room":"room", "principal":"alice", "until":snapback4_core::now_ms() + 600_000}))];
    seeds.extend((0..1000).map(|n| row("messages", json!({"id":format!("m{n:04}"),"room":"room","at":n,"body":"coffee"}))));
    // Newer hidden rows must never win either host's top-N.
    seeds.push(row("messages", json!({"id":"hidden", "room":"secret", "at":2000,"body":"coffee"})));
    engine.seed(seeds).unwrap();
    let server = engine.query("top", context("alice", &[]).at(1000)).unwrap();
    assert!(!server.complete && server.cut.is_none() && server.next.is_none(), "{server:?}");
    assert_eq!(server.data.as_array().unwrap().len(), 10);
    assert_eq!(server.data.as_array().unwrap()[0].field("id").unwrap().as_str().unwrap(), "m0999");
    let mut device = host.open("undecided", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "alice", 250).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let local = device.query("top", "alice", &json!({}), 1000).unwrap();
    assert_eq!(local.data, server.data);
    assert!(!local.complete && local.cut.is_none() && local.next.is_none(), "{local:?}");
}
#[test]
fn sqlite_and_server_undecided_prefix_stays_incomplete() { undecided(&mut Sqlite::new("topn-prefix")); }
#[test]
fn memory_and_server_undecided_prefix_stays_incomplete() { undecided(&mut Memory::new()); }

fn boundaries_on_store<S: snapback4_device::store::DeviceStore>(mut store: S) {
    use snapback4_core::{engine::local, rows::Rows};
    let (_, mut backend) = compile(boundaries::SOURCE);
    for program in &mut backend.programs { boundaries::distinct_discovery(program); }
    store.install(&backend.schema, &Default::default(), false).unwrap();
    let tx = store.transaction().unwrap();
    for (table, row) in boundaries::rows() {
        tx.put(&table, &backend.schema.tables[&table], &row, None).unwrap();
    }
    let query = |op: &str, ceilings| {
        let program = backend.programs.iter().find(|p| p.name == op).unwrap();
        let (read, unknown, _) = local::query_with_coverage(&tx, &backend.schema, program, context("alice", &[]), ceilings);
        assert!(!unknown, "{op}: neither a meter cut nor lane discovery requests fallback");
        read.unwrap()
    };
    boundaries::check_collectors(|op| query(op, Default::default()));
    boundaries::check_discovery(|op| query(op, Default::default()));
    boundaries::check_meter(query);
}

#[test]
fn sqlite_bound_meter_collectors_and_lane_discovery() { boundaries_on_store(snapback4_core::Store::memory().unwrap()); }
#[test]
fn memory_bound_meter_collectors_and_lane_discovery() { boundaries_on_store(snapback4_device::memory::MemoryStore::new()); }
