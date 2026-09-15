use crate::common::*;
use snapback4_core::{Engine, Value, WriteState, value::object};
use snapback4_device::device::Backend;
#[path = "../../../snapback4-sim/tests/common/following_app.rs"]
mod app;

fn saturated<H: Host>(mut host: H) {
    let bound = app::built();
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    engine.seed((0..32).map(|n| ("feedAuthors".into(), object([
        ("id", id(&format!("a{n}"))), ("principal", id(&format!("shared{n}"))), ("shared", Value::Bool(true)),
    ])))).unwrap();
    app::mutate(&mut engine, "register", "author", &[], 1);
    // Saturate both an existing follower and the author. These are real app
    // edges, so unfollow can later free a route through the published bridge.
    for viewer in ["reader00", "author"] {
        for n in 0..32 { app::mutate(&mut engine, "follow", viewer, &[("authorId", id(&format!("shared{n}")))], 2); }
    }
    app::mutate(&mut engine, "createPost", "author", &[("postId", id("old-push")), ("body", Value::String("old".into()))], 3);
    for n in 0..50 { app::mutate(&mut engine, "follow", &format!("reader{n:02}"), &[("authorId", id("author"))], 4); }
    let backend = Backend { generation: engine.generation(), schema: bound.schema, programs: bound.programs.into_iter().map(|p| p.program).collect() };
    let mut devices = Vec::new();
    for viewer in ["reader00", "reader01", "author", "unrelated"] {
        let mut device = host.open(viewer, Some(backend.clone())).unwrap();
        for (n, page) in snapshot_pages(&mut engine, viewer, 100).iter().enumerate() {
            assert!(page.events.iter().all(|e| e.table != "feedPullCounts"), "online slot counts must not sync");
            device.apply(page, n == 0).unwrap();
        }
        devices.push((viewer, device));
    }
    let before = engine.seq().unwrap();
    app::mutate(&mut engine, "follow", "reader50", &[("authorId", id("author"))], 5);
    app::mutate(&mut engine, "createPost", "author", &[("postId", id("new-broadcast")), ("body", Value::String("new".into()))], 6);
    let pulls = engine.store().rows("feedPulls").unwrap();
    for viewer in ["reader00", "author"] {
        assert_eq!(pulls.iter().filter(|r| r.field("readerId") == Ok(&id(viewer))).count(), 32);
        assert!(!pulls.iter().any(|r| r.field("readerId") == Ok(&id(viewer)) && r.field("authorId") == Ok(&id("author"))));
    }
    let posts = |page: &snapback4_core::QueryOutcome| page.data.as_array().unwrap().iter().map(|r| r.field("postId").unwrap().as_str().unwrap().to_owned()).collect::<Vec<_>>();
    for (viewer, device) in &mut devices {
        device.apply(&stream_page(&mut engine, viewer, before), false).unwrap();
        let page = device.query("social.following", viewer, &serde_json::json!({}), 100).unwrap();
        assert!(page.complete);
        assert_eq!(posts(&page), match *viewer { "reader00" => vec!["old-push"], "unrelated" => vec![], _ => vec!["new-broadcast", "old-push"] });
        assert_eq!(page.data, app::query(&mut engine, viewer).data);
    }
    let before = engine.seq().unwrap();
    app::mutate(&mut engine, "unfollow", "reader00", &[("authorId", id("author"))], 7);
    let refused = engine.mutate("social.follow", None, app::context("reader00", &[("authorId", id("author"))])).unwrap();
    let WriteState::Failed { why, .. } = refused.state else { panic!("saturated follow must refuse"); };
    assert_eq!(why.code, "FEED_PULL_CAP");
    for table in ["follows", "feedFollows"] {
        assert!(!engine.store().rows(table).unwrap().iter().any(|r| r.field("followerId") == Ok(&id("reader00")) && r.field("followedId") == Ok(&id("author"))));
    }
    app::mutate(&mut engine, "unfollow", "reader00", &[("authorId", id("shared0"))], 8);
    app::mutate(&mut engine, "follow", "reader00", &[("authorId", id("author"))], 9);
    app::mutate(&mut engine, "follow", "reader00", &[("authorId", id("author"))], 10);
    for (viewer, mut device) in devices {
        let stream = stream_page(&mut engine, viewer, before);
        assert!(stream.events.iter().filter(|e| e.table == "feedPulls" && e.data.is_some()).all(|e| e.data.as_ref().unwrap()["readerId"] == viewer));
        device.apply(&stream, false).unwrap();
        host.close(viewer, device);
        let mut device = host.open(viewer, None).unwrap();
        let page = device.query("social.following", viewer, &serde_json::json!({}), 100).unwrap();
        assert!(page.complete);
        assert_eq!(posts(&page), if viewer == "unrelated" { vec![] } else { vec!["new-broadcast", "old-push"] });
        assert_eq!(page.data, app::query(&mut engine, viewer).data);
        host.close(viewer, device);
    }
    let routes = engine.store().rows("feedPulls").unwrap();
    assert_eq!(routes.iter().filter(|r| r.field("readerId") == Ok(&id("reader00"))).count(), 32);
    for count in engine.store().rows("feedPullCounts").unwrap() {
        let reader = count.field("readerId").unwrap();
        assert_eq!(count.field("used").unwrap().as_int().unwrap() as usize, routes.iter().filter(|r| r.field("readerId") == Ok(reader)).count());
    }
    println!("W7R1b saturation store={} followers=51 skipped=2 reader_pulls=32 recovered_posts=2 duplicates=0 refused={}: {}", host.label(), why.code, why.message);
}

#[test]
fn w7r1b_saturation_memory() { saturated(Memory::new()); }
#[test]
fn w7r1b_saturation_sqlite() { saturated(Sqlite::new("w7r1b-saturation")); }
