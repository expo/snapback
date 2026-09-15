use snapback4_core::{Value, engine::postgres::PostgresEngine, wire};
use snapback4_device::{
    device::{Backend, Device, StreamPage},
    memory::MemoryStore,
};
use snapback4_postgres_evaluation::*;

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn postgres_snapshot_offline_queue_reopen_retry_stream_and_revocation_on_existing_device() {
    let (schema, programs) = compiled();
    let name = namespace("device");
    let mut pg = PostgresEngine::create(connect(), &name, schema.clone(), programs.clone()).unwrap();
    pg.seed_at(fixture(1, 25), 10).unwrap();
    let backend = Backend { schema, programs, generation: pg.generation() };
    let mut device = Device::open_store(MemoryStore::new(), Some(backend.clone())).unwrap();
    let mut cursor = None;
    let mut first = true;
    loop {
        let page = pg.snapshot_page("bob", cursor, 7, 1_000).unwrap();
        let wire: StreamPage = serde_json::from_value(serde_json::json!({
            "snapshot": true, "held": page.held, "watermark": page.watermark,
            "more": page.next.is_some(), "next": page.next.as_ref().map(|c| c.encode()), "generation": 1,
            "events": page.events.iter().map(|e| serde_json::json!({"table":e.table,"kind":e.kind.word(),"id":e.id,"data":e.data.as_ref().map(wire::to_json)})).collect::<Vec<_>>()
        })).unwrap();
        device.apply(&wire, first).unwrap();
        first = false;
        cursor = page.next;
        if cursor.is_none() {
            break;
        }
    }
    let server = pg.query("page", context("bob", &[("room", id("r000")), ("c", Value::Null)])).unwrap();
    let local = device.query("page", "bob", &serde_json::json!({"room":"r000"}), 1_000).unwrap();
    assert_eq!(local.data, server.data);
    assert!(local.complete);
    // The real durable device outbox predicts without contacting Postgres.
    let queued = device
        .admit(
            serde_json::from_value(serde_json::json!({
                "id":"offline-op", "seq":1, "op":"increment", "args":{"slot":"c0"}, "viewer":"bob", "now":1_000, "predictable":true
            }))
            .unwrap(),
        )
        .unwrap();
    assert!(queued.predictable);
    assert_eq!(
        device.query("counter", "bob", &serde_json::json!({"slot":"c0"}), 1_000).unwrap().data.field("value").unwrap(),
        &Value::Int(1)
    );
    // Simulate host persistence/restart with the memory host's actual changes.
    let changes = device.store().drain();
    drop(device);
    let mut store = MemoryStore::new();
    store.load(changes).unwrap();
    let mut device = Device::open_store(store, None).unwrap();
    assert_eq!(device.queued().unwrap().len(), 1);
    let result = pg.mutate("increment", Some("offline-op"), context("bob", &[("slot", id("c0"))])).unwrap();
    let seq = sent(&result);
    drop(pg); // response loss and a new server connection
    let mut pg = PostgresEngine::open(connect(), &name).unwrap();
    let replay = pg.mutate("increment", Some("offline-op"), context("bob", &[("slot", id("c0"))])).unwrap();
    assert!(replay.replayed);
    assert_eq!(sent(&replay), seq);
    device.settle("offline-op", Some(seq)).unwrap();
    let apply = |device: &mut Device<MemoryStore>, pg: &mut PostgresEngine| {
        let page = pg.stream("bob", device.state().unwrap().0, 1_000, 1_000).unwrap();
        let wire: StreamPage = serde_json::from_value(serde_json::json!({
            "snapshot":false,"watermark":page.watermark,"more":page.more,"joined":page.joined,"generation":1,
            "events":page.events.iter().map(|e|serde_json::json!({"table":e.table,"kind":e.kind,"id":e.id,"data":e.data.as_ref().map(wire::to_json)})).collect::<Vec<_>>()
        })).unwrap();
        device.apply(&wire, false).unwrap();
    };
    apply(&mut device, &mut pg);
    assert!(device.queued().unwrap().is_empty());
    let local = device.query("counter", "bob", &serde_json::json!({"slot":"c0"}), 1_000).unwrap();
    assert_eq!(local.data, pg.query("counter", context("bob", &[("slot", id("c0"))])).unwrap().data);
    sent(&pg.mutate("leave", None, context("bob", &[("room", id("r000"))])).unwrap());
    apply(&mut device, &mut pg);
    let local = device.query("page", "bob", &serde_json::json!({"room":"r000"}), 1_000).unwrap();
    assert!(local.data.as_array().unwrap().is_empty(), "until-revoked rows leave the device");
}
