use super::*;
#[path = "../../../snapback4-sim/tests/common/following_app.rs"]
mod app;
use snapback4_device::device::Backend;

#[test]
fn w10b_wired_repost_predicts_on_both_stores() {
    fn run<H: crate::common::Host>(mut host: H) {
        let mut engine = app::repost_helper_engine();
        let bound = app::built();
        let backend = Backend { generation: engine.generation(), schema: bound.schema, programs: bound.programs.into_iter().map(|p| p.program).collect() };
        let mut device = host.open("reader", Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut engine, "reader", 100).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
        let predicted = device.predict("social.repost", "reader", &serde_json::json!({"postId":"app-post"}), 3, vec![], 99).unwrap();
        assert_eq!(predicted.predicted.len(), 3, "{predicted:?}");
        let local = device.query("social.following", "reader", &serde_json::json!({}), 3).unwrap();
        assert!(local.complete);
        assert_eq!(local.data.as_array().unwrap().len(), 1);
        assert_eq!(local.data.as_array().unwrap()[0].field("postId").unwrap(), &app::id("app-post"));
        assert_eq!(local.data.as_array().unwrap()[0].field("repost").unwrap(), &Value::Bool(true));
    }
    run(Memory::new());
    run(Sqlite::new("w10b-repost"));
}

fn wired<H: crate::common::Host>(mut host: H) {
    let label = host.label();
    let bound = app::built();
    let mut engine = snapback4_core::Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    app::seed(&mut engine);
    let backend = Backend { generation: engine.generation(), schema: bound.schema, programs: bound.programs.into_iter().map(|p| p.program).collect() };
    let mut devices = Vec::new();
    let mut measured = Vec::new();
    for (viewer, count) in app::READERS {
        let pages = snapshot_pages(&mut engine, viewer, 1_000);
        let cold = pages.iter().map(|p| p.events.len()).sum::<usize>();
        let cold_bytes = pages.iter().flat_map(|p| &p.events).filter_map(|e| e.data.as_ref()).map(|row| serde_json::to_vec(row).unwrap().len()).sum::<usize>();
        let mut device = host.open(viewer, Some(backend.clone())).unwrap();
        for (n, page) in pages.iter().enumerate() { device.apply(page, n == 0).unwrap(); }
        let (first, p95) = app::measure(label, count, || device.query("social.following", viewer, &serde_json::json!({}), 100_000).unwrap());
        let server = app::query(&mut engine, viewer);
        assert_eq!(first.data, server.data);
        assert_eq!(first.next, server.next);
        let next_args = serde_json::json!({"c":first.next});
        let next = device.query("social.following", viewer, &next_args, 100_000).unwrap();
        let online = engine.query("social.following", app::context(viewer, &[("c", Value::String(next_args["c"].as_str().unwrap().into()))])).unwrap();
        assert_eq!((next.data, next.complete, next.next), (online.data, online.complete, online.next));
        println!("W6a host={label} follows={count} cold_rows={cold} cold_bytes={cold_bytes}");
        measured.push((first.metered.examined, p95));
        devices.push((viewer, device));
    }
    assert_eq!(measured[0].0, measured[1].0);
    println!("W6a host={label} following500/following5={:.3}", measured[1].1 / measured[0].1);
    let before = engine.seq().unwrap();
    app::remove(&mut engine);
    for (viewer, mut device) in devices {
        device.apply(&stream_page(&mut engine, viewer, before), false).unwrap();
        let local = device.query("social.following", viewer, &serde_json::json!({}), 100_000).unwrap();
        app::check_removed(&local);
        assert_eq!(local.data, app::query(&mut engine, viewer).data);
        let before = engine.seq().unwrap();
        app::mutate(&mut engine, "unfollow", viewer, &[("authorId", app::id(&app::author(0)))], 4_000);
        device.apply(&stream_page(&mut engine, viewer, before), false).unwrap();
        let local = device.query("social.following", viewer, &serde_json::json!({}), 100_000).unwrap();
        assert_eq!(local.data, app::query(&mut engine, viewer).data);
        assert!(local.data.as_array().unwrap().iter().all(|r| r.field("actorId") != Ok(&app::id(&app::author(0)))));
    }
    println!("W6a host={label}: removal and unfollow streamed to both readers before purge");
}

#[test]
fn w6a_wired_following_memory() { wired(Memory::new()); }
#[test]
fn w6a_wired_following_sqlite() { wired(Sqlite::new("w6a")); }

#[test]
fn w6r1_wired_cards_respect_rules_and_horizons_on_both_stores() {
    fn run<H: crate::common::Host>(host: &mut H) {
        for mode in ["public", "private", "horizon"] {
            for celebrity in [false, true] {
                let bound = app::review_built(mode);
                let mut engine = snapback4_core::Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
                app::review_seed(&mut engine, celebrity);
                let backend = Backend { generation: engine.generation(), schema: bound.schema, programs: bound.programs.into_iter().map(|p| p.program).collect() };
                for viewer in ["reader", "author"] {
                    let name = format!("{mode}-{celebrity}-{viewer}");
                    let mut device = host.open(&name, Some(backend.clone())).unwrap();
                    for (n, page) in snapshot_pages(&mut engine, viewer, 100).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
                    let local = device.query("social.following", viewer, &serde_json::json!({}), 100_000).unwrap();
                    app::review_cards(&local, mode == "private" && viewer == "reader", mode == "horizon");
                    if mode != "horizon" { assert_eq!(local.data, app::query(&mut engine, viewer).data); }
                    println!("W6R1 host={} mode={mode} celebrity={celebrity} viewer={viewer}: entries=2 complete={} examined={}", host.label(), local.complete, local.metered.examined);
                    host.close(&name, device);
                }
            }
        }
    }
    run(&mut Sqlite::new("w6r1-cards")); run(&mut Memory::new());
}

#[test]
fn w7a_wired_mutations_predict_or_queue_offline_on_both_stores() {
    fn run<H: crate::common::Host>(mut host: H) {
        let bound = app::built();
        let mut engine = snapback4_core::Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
        app::mutate(&mut engine, "register", "alice", &[], 1);
        app::mutate(&mut engine, "createPost", "alice", &[("postId", app::id("held-post")), ("body", Value::String("held card".into()))], 2);
        let backend = Backend { generation: engine.generation(), schema: bound.schema, programs: bound.programs.into_iter().map(|p| p.program).collect() };
        let mut device = host.open_as("w7a-predict", Some(backend.clone()), "bob").unwrap();
        for (n, page) in snapshot_pages(&mut engine, "bob", 100).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
        for (n, (op, args, table)) in [
            ("saveProfile", serde_json::json!({"name":"Bob"}), "profiles"),
            ("createPost", serde_json::json!({"postId":"offline-post", "body":"offline card"}), "posts"),
            ("follow", serde_json::json!({"authorId":"alice"}), "follows"),
        ].into_iter().enumerate() {
            let now = 10 + n as i64;
            let prediction = device.admit(serde_json::from_value(serde_json::json!({
                "id":format!("offline-{op}"), "seq":10 + n, "op":format!("social.{op}"),
                "viewer":"bob", "args":args, "now":now, "predictable":true,
            })).unwrap()).unwrap();
            if op == "follow" {
                assert!(prediction.predicted.is_empty() && !prediction.predictable, "{prediction:?}");
            } else {
                assert!(prediction.predicted.iter().any(|key| key.starts_with(&format!("{table}/"))), "{op}: {prediction:?}");
            }
            println!("W7a host={} op={op} predicted_rows={}", host.label(), prediction.predicted.len());
            let input = args.as_object().unwrap().iter().map(|(k, v)| (k.as_str(), if k == "body" || k == "name" { Value::String(v.as_str().unwrap().into()) } else { app::id(v.as_str().unwrap()) })).collect::<Vec<_>>();
            let before = engine.seq().unwrap();
            app::mutate(&mut engine, op, "bob", &input, now);
            device.settle(&prediction.id, Some(engine.seq().unwrap())).unwrap();
            device.apply(&stream_page(&mut engine, "bob", before), false).unwrap();
        }
        let local = device.query("social.following", "bob", &serde_json::json!({}), 100).unwrap();
        assert!(local.complete, "{local:?}");
        let post_ids = |page: &snapback4_core::QueryOutcome| page.data.as_array().unwrap().iter().map(|r| r.field("postId").unwrap().clone()).collect::<Vec<_>>();
        assert_eq!(post_ids(&local), post_ids(&app::query(&mut engine, "bob")));
        assert_eq!(post_ids(&local), vec![app::id("offline-post"), app::id("held-post")]);
        let mut author = host.open("w7a-fanout", Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut engine, "alice", 100).iter().enumerate() { author.apply(page, n == 0).unwrap(); }
        let prediction = author.predict("social.createPost", "alice", &serde_json::json!({"postId":"fanout-post", "body":"fanout"}), 20, vec![], 99).unwrap();
        assert_eq!(prediction.predicted.len(), 4, "app post, event, own inbox and another reader's inbox");
        println!("W7a host={} offline_fanout_predicted_rows=4", host.label());
    }
    run(Memory::new()); run(Sqlite::new("w7a-predict"));
}
