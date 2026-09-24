//! SQLite WAL recovery at atomic commit cuts, plus the device counterexample
//! to NORMAL delivery. These model persisted bytes, not a process kill (which
//! leaves the kernel's dirty page cache intact and cannot model power loss).
mod common;
use common::{BoundaryMetadata, Host, Memory, Sqlite, id, snapshot_pages, stream_page};
use snapback4_core::{Context, Engine, Store, Value, WriteState};
use snapback4_device::device::Backend;
use std::{fs, path::Path, time::Duration};

const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/following-view.q");

fn write(engine: &mut Engine, op: &str, who: &str, args: &[(&str, Value)]) {
    let out = engine.mutate(op, None, Context::new(who, common::args(args)).at(100)).unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
}

fn server(path: &Path) -> (Engine, Backend) {
    let (_, mut backend) = common::compile(SOURCE);
    let mut engine = Engine::new(Store::open(path).unwrap(), backend.schema.clone(), backend.programs.clone()).unwrap();
    backend.generation = engine.generation();
    assert_eq!(engine.store().conn().query_row("PRAGMA synchronous", [], |r| r.get::<_, i64>(0)).unwrap(), 2, "all disk commits must use FULL");
    for n in 0..10 { write(&mut engine, "follow", &format!("reader{n}"), &[("actor", id("author"))]); }
    write(&mut engine, "post", "author", &[("postId", id("event")), ("parentId", Value::Null)]);
    // Freeze the database base; every subsequent write stays in the WAL.
    engine.store().conn().execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA wal_autocheckpoint=0;").unwrap();
    (engine, backend)
}

fn image(source: &Path, target: &Path, wal: &[u8]) {
    fs::copy(source, target).unwrap();
    if !wal.is_empty() { fs::write(format!("{}-wal", target.display()), wal).unwrap(); }
}

fn page(engine: &mut Engine, from: u64) -> snapback4_device::device::StreamPage {
    let mut page = stream_page(engine, "reader0", from);
    page.store_id = engine.store().meta("store_id").unwrap();
    page
}

fn delivered(engine: &mut Engine, backend: &Backend) {
    while engine.run_timeline_chunk_for(200, Duration::ZERO).unwrap().is_some() {}
    assert_eq!(engine.timeline_work_counts().unwrap()[0].1, 0);
    for n in 0..10 {
        let reader = format!("reader{n}");
        let mut device = Memory::new().open(&reader, Some(backend.clone())).unwrap();
        for (i, page) in snapshot_pages(engine, &reader, 1000).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        let rows = device.store().raw_rows("feedFeed");
        assert_eq!(rows.len(), 1, "one copy per reader/event, without a gap or duplicate");
        assert_eq!(rows[0].field("eventId").unwrap(), &id("event"));
        let edges = device.store().raw_rows("feedEdges");
        assert_eq!(rows[0].field("epoch").unwrap(), edges[0].field("epoch").unwrap());
        assert_eq!(device.query("home", &reader, &serde_json::json!({"c":null}), 200).unwrap().data.as_array().unwrap().len(), 1);
    }
}

#[test]
fn delivery_wal_cuts_recover_copies_cursor_and_log_together() {
    let files = Sqlite::new("delivery-cuts");
    let path = files.path("live");
    let (mut engine, backend) = server(&path);
    let before = engine.seq().unwrap();
    let mut device = Memory::new().open("reader0", Some(backend.clone())).unwrap();
    for (i, mut page) in snapshot_pages(&mut engine, "reader0", 1000).into_iter().enumerate() {
        page.store_id = engine.store().meta("store_id").unwrap();
        device.apply(&page, i == 0).unwrap();
    }
    engine.run_timeline_chunk_for(200, Duration::ZERO).unwrap().unwrap();
    assert_eq!(engine.seq().unwrap(), before + 1);
    device.apply(&page(&mut engine, before), false).unwrap();
    let wal = fs::read(format!("{}-wal", path.display())).unwrap();
    // Before commit, a torn final frame is ignored along with the whole chunk.
    // After FULL returns, the complete image is durable without another request.
    for (name, bytes, seq) in [("before", &[][..], before), ("torn", &wal[..wal.len()-1], before), ("committed", &wal[..], before+1)] {
        let recovered_path = files.path(name);
        image(&path, &recovered_path, bytes);
        let mut recovered = Engine::open(Store::open(&recovered_path).unwrap()).unwrap();
        assert_eq!(recovered.seq().unwrap(), seq, "{name}");
        // Copy, private cursor, and public partition log agree at the boundary.
        let changes = page(&mut recovered, before);
        assert_eq!(changes.watermark, seq);
        assert_eq!(changes.events.iter().filter(|e| e.table == "feedFeed").count(), usize::from(seq > before));
        if name == "committed" {
            device.apply(&page(&mut recovered, before + 1), false).unwrap();
            assert_eq!(device.query("home", "reader0", &serde_json::json!({"c":null}), 200).unwrap().data.as_array().unwrap().len(), 1);
        }
        delivered(&mut recovered, &backend);
    }
}

#[test]
fn normal_replay_repairs_copies_but_cannot_repair_an_observed_watermark() {
    let files = Sqlite::new("normal-counterexample");
    let path = files.path("live");
    let (mut engine, backend) = server(&path);
    let durable = files.path("last-full");
    image(&path, &durable, &[]);
    let before = engine.seq().unwrap();
    let mut device = Memory::new().open("reader0", Some(backend.clone())).unwrap();
    for (i, mut page) in snapshot_pages(&mut engine, "reader0", 1000).into_iter().enumerate() {
        page.store_id = engine.store().meta("store_id").unwrap();
        device.apply(&page, i == 0).unwrap();
    }
    // This is an explicit rejected policy, not the production configuration.
    engine.store().conn().execute_batch("PRAGMA synchronous=NORMAL;").unwrap();
    engine.run_timeline_chunk_for(200, Duration::ZERO).unwrap().unwrap();
    device.apply(&page(&mut engine, before), false).unwrap();
    let observed = engine.seq().unwrap();
    assert_eq!(observed, before + 1);
    // Power loss may retain only the last FULL image, although NORMAL returned.
    let mut recovered = Engine::open(Store::open(&durable).unwrap()).unwrap();
    assert_eq!(recovered.seq().unwrap(), before);
    let refusal = device.apply(&page(&mut recovered, observed), false).unwrap_err();
    assert!(refusal.to_string().contains("E_STORE_RESTORE"), "{refusal}");
    delivered(&mut recovered, &backend);
    // Rerunning work gives the right server contents but does not unhalt a device.
    let refusal = device.query("home", "reader0", &serde_json::json!({"c":null}), 200).unwrap_err();
    assert!(refusal.to_string().contains("E_STORE_RESTORE"), "{refusal}");
}
