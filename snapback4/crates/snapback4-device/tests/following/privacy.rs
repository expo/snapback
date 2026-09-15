use crate::common::*;
use snapback4_core::{Value, value::object};

fn audience<H: Host>(mut host: H) {
    let source = format!("{}\nquery routes(readerId: principal):\n  return pulls[readerId] first 32 by byReaderAuthor\n", super::world::source());
    let (mut engine, backend) = compile(&source);
    let route = |reader: &str, author: &str| ("pulls".into(), object([
        ("id", id(&format!("{reader}-{author}"))), ("readerId", id(reader)), ("authorId", id(author)),
    ]));
    engine.seed([route("alice", "shared-a"), route("bob", "shared-b")]).unwrap();
    for (viewer, expected) in [("alice", 1), ("bob", 1), ("unrelated", 0)] {
        let mut device = host.open(viewer, Some(backend.clone())).unwrap();
        let pages = snapshot_pages(&mut engine, viewer, 1);
        let routes = pages.iter().flat_map(|p| &p.events).filter(|e| e.table == "pulls").collect::<Vec<_>>();
        assert_eq!(routes.len(), expected, "{}: {viewer} cold pull rows", host.label());
        assert!(routes.iter().all(|e| e.data.as_ref().unwrap()["readerId"] == viewer));
        for (n, page) in pages.iter().enumerate() { device.apply(page, n == 0).unwrap(); }
        let before = engine.seq().unwrap();
        engine.seed([route("alice", &format!("shared-{viewer}"))]).unwrap();
        let stream = stream_page(&mut engine, viewer, before);
        assert!(stream.events.iter().filter(|e| e.table == "pulls").all(|e| e.data.as_ref().unwrap()["readerId"] == viewer));
        device.apply(&stream, false).unwrap();
        host.close(viewer, device);
        let mut device = host.open(viewer, None).unwrap();
        for reader in ["alice", "bob"] {
            let local = device.query("routes", viewer, &serde_json::json!({"readerId":reader}), 100).unwrap();
            let online = engine.query("routes", context(viewer, &[("readerId", id(reader))])).unwrap();
            assert_eq!(local.data, online.data);
            if reader != viewer { assert_eq!(local.data, Value::Array(vec![])); }
        }
        println!("W7R1b audience store={} viewer={viewer} cold_pulls={expected} foreign_pulls=0 after_stream_and_reopen=true", host.label());
        host.close(viewer, device);
    }
}

#[test]
fn w7r1b_pull_audience_memory() { audience(Memory::new()); }
#[test]
fn w7r1b_pull_audience_sqlite() { audience(Sqlite::new("w7r1b-audience")); }
