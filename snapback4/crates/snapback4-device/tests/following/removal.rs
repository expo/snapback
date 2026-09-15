use super::*;
#[path = "../../../snapback4-sim/tests/common/following_removal.rs"]
mod case;

fn removal_cut<S: snapback4_device::store::DeviceStore>(mut store: S, host: &str) {
    use snapback4_core::rows::Rows;
    let (mut engine, backend) = compile(&world::source());
    case::seed_cut_page(&mut engine);
    store.install(&backend.schema, &Default::default(), false).unwrap();
    let tx = store.transaction().unwrap();
    // Use the reader's actual snapshot, then the device interpreter's
    // metered entry point: the public dispatcher keeps default ceilings.
    for page in snapshot_pages(&mut engine, &case::reader(0), 1000) {
        for event in page.events {
            if let Some(data) = event.data {
                let table = &backend.schema.tables[&event.table];
                tx.put(&event.table, table, &snapback4_core::wire::row_from_json(table, &data).unwrap(), None).unwrap();
            }
        }
    }
    let program = backend.programs.iter().find(|p| p.name == "following").unwrap();
    case::check_cut_page(host, |ceilings| snapback4_core::engine::local::query(&tx, &backend.schema, program, context(&case::reader(0), &[]).at(300), ceilings).unwrap());
}

#[test]
fn following_removal_cut_memory() { removal_cut(snapback4_device::memory::MemoryStore::new(), "memory"); }

#[test]
fn following_removal_cut_sqlite() { removal_cut(snapback4_core::Store::memory().unwrap(), "sqlite"); }

#[test]
fn following_removal_reaches_every_reader_before_purge_on_both_stores() {
    for followers in [5, 900] {
        let (mut engine, backend) = compile(&world::source());
        assert!(backend.schema.operations.contains_key("unrepost"), "feeds must publish removal");
        case::seed(&mut engine, followers);
        let viewers: Vec<_> = std::iter::once(case::AUTHOR.to_owned()).chain((0..followers).map(case::reader)).collect();
        let snapshots: Vec<_> = viewers.iter().map(|viewer| snapshot_pages(&mut engine, viewer, 1000)).collect();
        let before = engine.seq().unwrap();
        let events = case::remove(&mut engine);
        assert_eq!(case::event_rows(&engine, "old-pushed"), followers + 1);
        let removal: Vec<_> = viewers.iter().map(|viewer| stream_page(&mut engine, viewer, before)).collect();
        let before = engine.seq().unwrap();
        world::mutate(&mut engine, "repost", case::AUTHOR, &[("postId", world::id(case::ORIGINAL))], 7);
        let fresh = case::repost_id(&engine);
        let repost: Vec<_> = viewers.iter().map(|viewer| stream_page(&mut engine, viewer, before)).collect();
        let before = engine.seq().unwrap();
        case::purge(&mut engine);
        for event in &events { assert_eq!(case::event_rows(&engine, event), 0); }
        let purged: Vec<_> = viewers.iter().map(|viewer| stream_page(&mut engine, viewer, before)).collect();
        on_both(|host| {
            let label = host.label();
            for (n, viewer) in viewers.iter().enumerate() {
                let mut device = host.open(viewer, Some(backend.clone())).unwrap();
                for (i, page) in snapshots[n].iter().enumerate() { ok(apply(&mut *device, page, i == 0)); }
                let local = query(&mut *device, "following", viewer, serde_json::json!({}), 10);
                assert_eq!(local["complete"], true);
                assert_eq!(rows(&local).len(), 3, "{label} {viewer}");
                if viewer == case::AUTHOR {
                    for (seq, op, post) in [(1, "deletePost", "new-post"), (2, "unrepost", case::ORIGINAL)] {
                        let admitted = ok(device.call(serde_json::json!({ "op":"admit", "entry": {
                            "id":op, "seq":seq, "op":op, "args":{"postId":post}, "viewer":viewer, "now":4, "predictable":true
                        }})));
                        assert_eq!(admitted["predictable"], false, "online-only sources queue without a row");
                    }
                    let pending = query(&mut *device, "following", viewer, serde_json::json!({}), 10);
                    assert_eq!(pending["data"], local["data"]);
                }
                ok(apply(&mut *device, &removal[n], false));
                let local = query(&mut *device, "following", viewer, serde_json::json!({}), 10);
                assert_eq!(local["complete"], true);
                assert!(rows(&local).iter().all(serde_json::Value::is_null), "{label} {viewer}: {local}");
                for page in [&repost[n], &purged[n]] {
                    assert!(!page.more);
                    ok(apply(&mut *device, page, false));
                    let local = query(&mut *device, "following", viewer, serde_json::json!({}), 10);
                    assert_eq!(local["complete"], true);
                    let visible: Vec<_> = rows(&local).iter().filter(|row| !row.is_null()).collect();
                    assert_eq!(visible.len(), 1);
                    assert_eq!(visible[0]["eventId"], fresh);
                }
                device.close();
            }
            println!("REMOVAL host={label} followers={followers} readers={} immediate=all purge=all rerepost=all", viewers.len());
        });
    }
}

#[test]
fn following_removal_empty_slots_keep_pagination_on_both_stores() {
    on_both(|host| {
        let (mut engine, backend) = compile(&world::source());
        case::seed(&mut engine, 5);
        for n in 0..25 {
            world::mutate(&mut engine, "createPost", case::AUTHOR, &[("postId", world::id(&format!("page-{n:02}"))), ("body", Value::String("page".into()))], 100 + n);
        }
        let viewer = case::reader(0);
        let mut device = host.open("removal-page", Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut engine, &viewer, 1000).iter().enumerate() { ok(apply(&mut *device, page, i == 0)); }
        let first = query(&mut *device, "following", &viewer, serde_json::json!({}), 200);
        assert_eq!(first["complete"], true);
        assert!(first["next"].is_string());
        let before = engine.seq().unwrap();
        for n in 5..25 { world::mutate(&mut engine, "deletePost", case::AUTHOR, &[("postId", world::id(&format!("page-{n:02}")))], 200 + n); }
        ok(apply(&mut *device, &stream_page(&mut engine, &viewer, before), false));
        let removed = query(&mut *device, "following", &viewer, serde_json::json!({}), 300);
        assert_eq!(removed["complete"], true);
        assert_eq!(removed["next"], first["next"]);
        assert!(rows(&removed).iter().all(serde_json::Value::is_null));
        let next = query(&mut *device, "following", &viewer, serde_json::json!({"c":removed["next"]}), 300);
        assert_eq!(next["complete"], true);
        assert_eq!(rows(&next).len(), 8);
        assert!(next["next"].is_null());
        let online = engine.query("following", context(&viewer, &[("c", Value::String(removed["next"].as_str().unwrap().into()))])).unwrap();
        assert_eq!(next["data"], snapback4_core::wire::to_json(&online.data));
        device.close();
    });
}
