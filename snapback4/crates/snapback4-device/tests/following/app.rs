use super::*;
#[path = "../../../snapback4-sim/tests/common/following_app.rs"]
mod app;
use snapback4_device::device::Backend;

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
        println!("W6a host={label} follows={count} cold_rows={cold}");
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
