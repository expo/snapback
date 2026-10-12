//! @ref LLP 3000.039#9 — cascades retire every union copy, including a concurrent membership scope.
use super::*;
use super::epochs::snapshot_trace_at;

const SOURCE: &str = r#"
table boards:
  owner: principal
  public 'boards are listed'
  delete <- .owner = viewer
  sync public
table members:
  board: boards on delete cascade
  principal: principal
  unique board, principal
  immutable board, principal
  cap 8 by board
  read <- exists members[.board, viewer]
  insert <- exists members[.board, viewer]
  sync
table tasks:
  board: boards on delete cascade
  owner: principal
  reviewer: principal
  agent: principal
  cap 8 by board
  read <- .owner = viewer or .reviewer = viewer or .agent = viewer or exists members[.board, viewer]
  sync
query mine():
  return tasks first 50 by .id
mutation drop(board: boards):
  delete boards[board]
  return null
"#;

fn verify<S: snapback4_device::store::DeviceStore>(store: S, viewer: &str, limit: usize) {
    let (schema, programs) = compiled(SOURCE);
    assert!(schema.tables["tasks"].sync.as_ref().unwrap().is_union());
    let mut engine = Engine::memory(schema.clone(), programs.clone()).unwrap();
    let mut rows = Vec::new();
    for board in ["drop", "keep"] {
        rows.push(("boards".into(), object([("id", id(board)), ("owner", id(ALICE))])));
        rows.push(("members".into(), object([("id", id(&format!("m-{board}"))), ("board", id(board)), ("principal", id(BOB))])));
        // Alice sees it by three column arms; Bob by the group arm; Mallory
        // reads neither the row nor the membership. No delete may name it to her.
        rows.push(("tasks".into(), object([("id", id(&format!("t-{board}"))), ("board", id(board)), ("owner", id(ALICE)), ("reviewer", id(ALICE)), ("agent", id(ALICE))])));
    }
    engine.seed(rows).unwrap();
    let backend = snapback4_device::device::Backend { generation: engine.generation(), schema, programs };
    let mut device = snapback4_device::device::Device::open_store(store, Some(backend)).unwrap();
    let trace = snapshot_trace_at(&mut engine, viewer, limit);
    for (n, page) in trace.iter().enumerate() {
        device.apply(&serde_json::from_value(page.clone()).unwrap(), n == 0).unwrap();
    }
    let before = device.query("mine", viewer, &json!({}), NOW + 10).unwrap();
    assert!(before.complete);
    assert_eq!(before.data.as_array().unwrap().len(), if viewer == MALLORY { 0 } else { 2 });
    let from = trace.last().unwrap()["watermark"].as_u64().unwrap();
    mutate(&mut engine, ALICE, "drop", &[("board", id("drop"))], 1);
    let mut watermark = from;
    let mut retired = false;
    loop {
        let page = engine.stream_at(viewer, watermark, limit, NOW + 10).unwrap();
        for event in &page.events {
            if viewer == MALLORY { assert!(!matches!(event.table.as_str(), "members" | "tasks"), "a cascade disclosed a private row or scope"); }
            if event.table == "tasks" {
                assert_ne!(viewer, MALLORY, "a cascade disclosed a hidden task id");
                if event.kind == "scope" {
                    assert_eq!(viewer, BOB);
                    assert_eq!(event.data.as_ref().unwrap().as_array().unwrap(), &[id("drop"), id(BOB)]);
                } else {
                    assert_eq!(event.id, "t-drop");
                    assert_eq!(event.kind, "del", "a deleted row must not be converted to a put by another union arm");
                }
                retired = true;
            }
        }
        let events: Vec<_> = page.events.iter().map(|e| json!({"table":e.table,"kind":e.kind,"id":e.id,"data":e.data.as_ref().map(wire::to_json)})).collect();
        device.apply(&serde_json::from_value(json!({"snapshot":false,"watermark":page.watermark,"more":page.more,"now":NOW+10,"generation":engine.generation(),"events":events,"acquisitions":page.acquisitions,"images_at":page.images_at,"joined":page.joined})).unwrap(), false).unwrap();
        watermark = page.watermark;
        if !page.more { break; }
    }
    assert_eq!(retired, viewer != MALLORY);
    let local = device.query("mine", viewer, &json!({}), NOW + 10).unwrap();
    let server = engine.query("mine", Context::new(viewer, BTreeMap::new()).at(NOW + 10)).unwrap();
    assert!(local.complete);
    assert_eq!(local.data, server.data);
    assert_eq!(local.data.as_array().unwrap().len(), if viewer == MALLORY { 0 } else { 1 });
}

#[test]
fn cascade_retires_union_rows_and_scopes_on_both_stores() {
    for viewer in PRINCIPALS {
        for limit in [1, 1000] {
            verify(snapback4_device::memory::MemoryStore::new(), viewer, limit);
            verify(snapback4_core::store::Store::memory().unwrap(), viewer, limit);
        }
    }
}

#[test]
fn retained_action_event_price_counts_every_union_arm() {
    let (schema, _) = compiled(SOURCE);
    let union = schema.write_reservation("tasks").unwrap().action_events.unwrap();
    let (single, _) = compiled(&SOURCE.replace(".owner = viewer or .reviewer = viewer or .agent = viewer or exists members[.board, viewer]", ".owner = viewer"));
    let single_price = single.write_reservation("tasks").unwrap().action_events.unwrap();
    assert!(union.heap_per_write >= single_price.heap_per_write * 4, "four distinct arm events need a schema-fixed four-arm allowance");
    assert!(schema.delete_reservation("boards").unwrap()[4] > single.delete_reservation("boards").unwrap()[4]);
    let projected = schema.public_projection();
    assert_eq!(projected.write_reservation("tasks").unwrap().action_events.unwrap(), union);
    assert_eq!(snapback4_core::schema::reservations::reservation(&projected, "tasks").unwrap().action_events.unwrap(), union);
    assert_eq!(projected.delete_reservation("boards"), schema.delete_reservation("boards"));
}
