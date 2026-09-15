use super::*;
#[path = "../../../snapback4-sim/tests/common/following.rs"]
mod world;
mod removal;
mod app;
mod privacy;
mod saturation;

#[test]
fn following_scale_pages_match_on_both_device_stores() {
    let (mut engine, mut backend) = compile(&world::source());
    world::seed(&mut engine, "hybrid");
    backend.generation = engine.generation();
    let mut cases = Vec::new();
    for n in [0, 1, 2, 3, 4, 1000] {
        let viewer = world::who(n);
        let start = std::time::Instant::now();
        let snapshot = snapshot_pages(&mut engine, &viewer, 1000);
        let cold = snapshot.iter().map(|p| p.events.len()).sum::<usize>();
        assert_eq!(cold, match n { 0 => 52665, 1 => 52715, 2 => 52915, 3 => 77665, 4 => 52866, _ => 52615 });
        assert!(snapshot.iter().flat_map(|p| &p.events).filter(|e| e.table == "pulls").all(|e| e.data.as_ref().unwrap()["readerId"] == viewer));
        println!("DEVICE cold reader={n} rows={cold} snapshot_ms={:.3}", start.elapsed().as_secs_f64() * 1000.0);
        let mut expected = Vec::new();
        let mut cursor = None;
        for _ in 0..3 {
            let page = engine.query("following", context(&viewer, &[("c", cursor.clone().map(Value::String).unwrap_or(Value::Null))])).unwrap();
            assert!(page.complete);
            let ids: Vec<_> = page.data.as_array().unwrap().iter().map(|r| r.field("eventId").unwrap().as_str().unwrap().to_owned()).collect();
            expected.push((cursor.clone(), ids, page.next.clone()));
            cursor = page.next;
            if cursor.is_none() { break; }
        }
        cases.push((viewer, snapshot, expected));
    }
    on_both(|host| {
        let label = host.label();
        for (viewer, snapshot, expected) in &cases {
            let start = std::time::Instant::now();
            let mut device = host.open(viewer, Some(backend.clone())).unwrap();
            for (n, page) in snapshot.iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
            println!("DEVICE acquired host={} viewer={viewer} ms={:.3}", label, start.elapsed().as_secs_f64() * 1000.0);
            for (cursor, ids, next) in expected {
                let local = query(&mut *device, "following", viewer, serde_json::json!({"c":cursor}), 300_000);
                assert_eq!(local["complete"], true, "{viewer}: {local}");
                assert_eq!(local["next"], serde_json::json!(next));
                let actual: Vec<_> = local["data"].as_array().unwrap().iter().map(|r| r["eventId"].as_str().unwrap()).collect();
                assert_eq!(actual, ids.iter().map(String::as_str).collect::<Vec<_>>());
            }
            device.close();
        }
    });
}

#[test]
fn following_streams_backfill_purge_own_posts_and_reposts() {
    on_both(|host| {
        let (mut engine, backend) = compile(&world::source());
        for viewer in ["dev:alice", "dev:bob"] { world::mutate(&mut engine, "register", viewer, &[], 1); }
        for n in 0..25 { world::mutate(&mut engine, "createPost", "dev:alice", &[("postId", world::id(&format!("p{n}")))], 10 + n); }
        world::mutate(&mut engine, "createPost", "dev:bob", &[("postId", world::id("own"))], 50);
        let mut device = host.open("following-lifecycle", Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut engine, "dev:bob", 100).iter().enumerate() { ok(apply(&mut *device, page, n == 0)); }
        let before = engine.seq().unwrap();
        world::mutate(&mut engine, "follow", "dev:bob", &[("authorId", world::id("dev:alice"))], 60);
        ok(apply(&mut *device, &stream_page(&mut engine, "dev:bob", before), false));
        let local = query(&mut *device, "following", "dev:bob", serde_json::json!({}), 65);
        assert_eq!(local["complete"], true);
        assert_eq!(local["data"].as_array().unwrap().len(), 20);
        let before = engine.seq().unwrap();
        world::mutate(&mut engine, "repost", "dev:bob", &[("postId", world::id("p24"))], 70);
        world::mutate(&mut engine, "repost", "dev:bob", &[("postId", world::id("p24"))], 71);
        world::mutate(&mut engine, "unfollow", "dev:bob", &[("authorId", world::id("dev:alice"))], 72);
        ok(apply(&mut *device, &stream_page(&mut engine, "dev:bob", before), false));
        let local = query(&mut *device, "following", "dev:bob", serde_json::json!({}), 75);
        assert_eq!(local["complete"], true);
        assert_eq!(local["data"].as_array().unwrap().len(), 2);
        assert_eq!(local["data"][0]["repost"], true);
        assert_eq!(local["data"][0]["authorId"], "dev:alice");
        assert_eq!(local["data"][0]["actorId"], "dev:bob");
        assert_eq!(local["data"][1]["postId"], "own");
        device.close();
    });
}
