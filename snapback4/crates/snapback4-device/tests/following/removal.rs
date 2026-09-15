use super::*;
#[path = "../../../snapback4-sim/tests/common/following_removal.rs"]
mod case;
#[path = "../../../snapback4-sim/tests/common/nonuniform_probe.rs"]
mod nonuniform;

fn n1_probe_sweep<S: snapback4_device::store::DeviceStore>(mut store: S, label: &str) {
    use snapback4_core::rows::Rows;
    use snapback4_device::store::DeviceTx;
    let cost = nonuniform::EXAMINED_SWEEP;
    let (_, backend) = compile(nonuniform::SOURCE);
    store.install(&backend.schema, &Default::default(), false).unwrap();
    let mut worlds = Vec::new();
    for hidden in [false, true] {
        let tx = store.transaction().unwrap();
        // Adversarial online-only rows exercise the non-uniform rule path;
        // this is an interpreter/store regression, not a delivery claim.
        for (table, row) in nonuniform::rows(hidden) { tx.put(&table, &backend.schema.tables[&table], &row, None).unwrap(); }
        worlds.push(nonuniform::sweep(cost, |name, ceilings| {
            let program = backend.programs.iter().find(|p| p.name == name).unwrap();
            snapback4_core::engine::local::query(&tx, &backend.schema, program, nonuniform::context(), ceilings)
        }));
        let (table, row) = nonuniform::visible();
        tx.put(&table, &backend.schema.tables[&table], &row, None).unwrap();
        for name in ["page", "merged"] {
            let program = backend.programs.iter().find(|p| p.name == name).unwrap();
            nonuniform::positive(snapback4_core::engine::local::query(&tx, &backend.schema, program, nonuniform::context(), Default::default()).unwrap(), name);
        }
        tx.rollback().unwrap();
    }
    assert_eq!(worlds[0], worlds[1]);
    println!("N1 host={label} ceilings=1..={cost} probe_limits=2 forms=4 identical_pairs={} positive_controls=4", worlds[0].len());
}

#[test]
fn following_removal_n1_memory() { n1_probe_sweep(snapback4_device::memory::MemoryStore::new(), "memory"); }

#[test]
fn following_removal_n1_sqlite() { n1_probe_sweep(snapback4_core::Store::memory().unwrap(), "sqlite"); }

fn removal_cut<S: snapback4_device::store::DeviceStore>(mut store: S, label: &str, followers: usize) {
    use snapback4_core::rows::Rows;
    let (mut engine, backend) = compile(&world::source());
    case::seed_cut(&mut engine, followers);
    store.install(&backend.schema, &Default::default(), false).unwrap();
    let tx = store.transaction().unwrap();
    // Public dispatch fixes the ceilings. Install exactly this reader's real
    // snapshot on each device store and use the shared metered interpreter.
    for page in snapshot_pages(&mut engine, &case::reader(0), 1000) {
        for event in page.events {
            if let Some(data) = event.data {
                let table = &backend.schema.tables[&event.table];
                let row = snapback4_core::wire::row_from_json(table, &data).unwrap();
                tx.put(&event.table, table, &row, None).unwrap();
            }
        }
    }
    let program = backend.programs.iter().find(|p| p.name == "following").unwrap();
    assert!(!snapback4_core::engine::rules::lazy_merge(&backend.schema, predicate::merge(program)));
    println!("MERGE_PATH host={label} followers={followers} shape=following_inbox_broadcast lazy=false");
    case::check_cut(label, followers, |ceilings| snapback4_core::engine::local::query(&tx, &backend.schema, program, context(&case::reader(0), &[]).at(300), ceilings).unwrap());
    if followers == 5 {
        case::check_heap_cut(label, |ceilings| snapback4_core::engine::local::query(&tx, &backend.schema, program, context(&case::reader(0), &[]).at(300), ceilings).unwrap());
    }
}

#[test]
fn following_removal_cut_memory() { for followers in [5, 51] { removal_cut(snapback4_device::memory::MemoryStore::new(), "memory", followers); } }

#[test]
fn following_removal_cut_sqlite() { for followers in [5, 51] { removal_cut(snapback4_core::Store::memory().unwrap(), "sqlite", followers); } }

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
                        assert_eq!(admitted["predictable"], true, "public source ownership is held, so removal predicts");
                    }
                    let pending = query(&mut *device, "following", viewer, serde_json::json!({}), 10);
                    assert_eq!(rows(&pending).len(), 1, "only the old pushed event remains before server removal");
                }
                ok(apply(&mut *device, &removal[n], false));
                if viewer == case::AUTHOR {
                    for op in ["deletePost", "unrepost"] { ok(device.call(serde_json::json!({"op":"settle", "id":op, "seq":removal[n].watermark}))); }
                }
                let local = query(&mut *device, "following", viewer, serde_json::json!({}), 10);
                assert_eq!(local["complete"], true);
                assert!(rows(&local).is_empty(), "{label} {viewer}: {local}");
                for page in [&repost[n], &purged[n]] {
                    assert!(!page.more);
                    ok(apply(&mut *device, page, false));
                    let local = query(&mut *device, "following", viewer, serde_json::json!({}), 10);
                    assert_eq!(local["complete"], true);
                    let visible = rows(&local);
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
fn following_removal_fills_live_pages_on_both_stores() {
    on_both(|host| {
        let (mut engine, backend) = compile(&world::source());
        case::seed(&mut engine, 5);
        for n in 0..40 {
            world::mutate(&mut engine, "createPost", case::AUTHOR, &[("postId", world::id(&format!("page-{n:02}")))], 100 + n);
        }
        let viewer = case::reader(0);
        let mut device = host.open("removal-page", Some(backend)).unwrap();
        for (i, page) in snapshot_pages(&mut engine, &viewer, 1000).iter().enumerate() { ok(apply(&mut *device, page, i == 0)); }
        let first = query(&mut *device, "following", &viewer, serde_json::json!({}), 200);
        assert_eq!(first["complete"], true);
        assert!(first["next"].is_string());
        let before = engine.seq().unwrap();
        for n in 20..40 { world::mutate(&mut engine, "deletePost", case::AUTHOR, &[("postId", world::id(&format!("page-{n:02}")))], 200 + n); }
        ok(apply(&mut *device, &stream_page(&mut engine, &viewer, before), false));
        let removed = query(&mut *device, "following", &viewer, serde_json::json!({}), 300);
        assert_eq!(removed["complete"], true);
        assert_ne!(removed["next"], first["next"]);
        assert_eq!(rows(&removed).len(), 20);
        assert!(rows(&removed).iter().all(|r| !r.is_null()));
        let continued = query(&mut *device, "following", &viewer, serde_json::json!({"c":first["next"]}), 300);
        assert_eq!(continued["complete"], true);
        assert_eq!(continued["data"], removed["data"]);
        let next = query(&mut *device, "following", &viewer, serde_json::json!({"c":removed["next"]}), 300);
        assert_eq!(next["complete"], true);
        assert_eq!(rows(&next).len(), 3);
        assert!(next["next"].is_null());
        let online = engine.query("following", context(&viewer, &[("c", Value::String(removed["next"].as_str().unwrap().into()))])).unwrap();
        assert_eq!(next["data"], snapback4_core::wire::to_json(&online.data));
        device.close();
    });
}

fn removal_authority<H: crate::common::Host>(mut host: H) {
    use snapback4_core::wire;
    let mut paired = Vec::new();
    for hidden in [true, false] {
        let (mut engine, backend) = compile(&case::authority_source());
        case::seed_authority(&mut engine, hidden);
        let attacker_store = format!("attacker-{hidden}");
        let victim_store = format!("victim-{hidden}");
        let mut attacker = host.open(&attacker_store, Some(backend.clone())).unwrap();
        let mut victim = host.open(&victim_store, Some(backend)).unwrap();
        for (viewer, device) in [(case::INTRUDER, &mut attacker), (case::PRIVATE, &mut victim)] {
            for (i, page) in snapshot_pages(&mut engine, viewer, 1000).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
        }
        let before = victim.query("following", case::PRIVATE, &serde_json::json!({}), 10).unwrap();
        let input = serde_json::json!({"eventId":"new-post", "markerId":"new-post", "actorId":case::INTRUDER});
        let entry: snapback4_device::device::Queued = serde_json::from_value(serde_json::json!({
            "id":"forge", "seq":1, "op":"forgeRemoval", "args":input, "viewer":case::INTRUDER, "now":10, "predictable":true
        })).unwrap();
        let refused = attacker.admit(entry).unwrap_err().refusal();
        assert_eq!(refused.code, "E_RULE", "a held source proves the attacker is not its author");
        host.close(&attacker_store, attacker);
        let mut attacker = host.open(&attacker_store, None).unwrap();
        let seq = engine.seq().unwrap();
        let result = engine.mutate("forgeRemoval", Some("forge"), context(case::INTRUDER, &[("eventId", world::id("new-post")), ("markerId", world::id("new-post")), ("actorId", world::id(case::INTRUDER))]).at(10)).unwrap();
        victim.apply(&stream_page(&mut engine, case::PRIVATE, seq), false).unwrap();
        let after = victim.query("following", case::PRIVATE, &serde_json::json!({}), 10).unwrap();
        println!("REMOVAL_AUTHORITY host={} hidden={hidden} state={} victim_unchanged={} local_refusal={}", host.label(), result.reply(Some("forge"))["state"], before.data == after.data, refused.code);
        assert_eq!(result.reply(Some("forge"))["why"]["code"], "E_RULE");
        assert_eq!(serde_json::to_value(&before).unwrap(), serde_json::to_value(&after).unwrap());
        attacker.apply(&stream_page(&mut engine, case::INTRUDER, seq), false).unwrap();
        assert!(attacker.queued().unwrap().is_empty());
        let no_purge = engine.run_job("purgeRemoved", Default::default(), 11).unwrap();
        assert_eq!(no_purge.rows_written, 0);
        victim.apply(&stream_page(&mut engine, case::PRIVATE, seq), false).unwrap();
        assert_eq!(victim.query("following", case::PRIVATE, &serde_json::json!({}), 10).unwrap().data, before.data);
        paired.push((serde_json::to_value(refused).unwrap(), result.reply(Some("forge")), result.metered));
        // Positive control: the actual owner removes, then purges, the event.
        let seq = engine.seq().unwrap();
        world::mutate(&mut engine, "deletePost", case::AUTHOR, &[("postId", world::id("new-post"))], 12);
        victim.apply(&stream_page(&mut engine, case::PRIVATE, seq), false).unwrap();
        let removed = victim.query("following", case::PRIVATE, &serde_json::json!({}), 13).unwrap();
        assert!(removed.complete);
        assert_eq!(removed.data.as_array().unwrap().is_empty(), hidden);
        let seq = engine.seq().unwrap();
        engine.run_job("purgeRemoved", Default::default(), 14).unwrap();
        victim.apply(&stream_page(&mut engine, case::PRIVATE, seq), false).unwrap();
        let local = victim.query("following", case::PRIVATE, &serde_json::json!({}), 15).unwrap();
        assert!(local.complete);
        assert_eq!(wire::to_json(&local.data), wire::to_json(&case::page(&mut engine, case::PRIVATE).data));
        assert_eq!(local.data.as_array().unwrap().len(), usize::from(!hidden));
        host.close(&attacker_store, attacker);
        host.close(&victim_store, victim);
    }
    assert_eq!(paired[0], paired[1], "hidden/absent private copy cannot affect the attacker");
}

#[test]
fn following_removal_foreign_tombstone_memory() { removal_authority(crate::common::Memory::new()); }

#[test]
fn following_removal_foreign_tombstone_sqlite() { removal_authority(crate::common::Sqlite::new("removal-authority")); }

#[path = "../../../snapback4-sim/tests/common/merge_predicate.rs"]
mod predicate;

fn merge_predicate<H: crate::common::Host>(mut host: H) {
    let (mut engine, backend) = compile(predicate::SOURCE);
    engine.seed(predicate::rows()).unwrap();
    predicate::paths(&backend.schema, &backend.programs);
    let mut eager_backend = backend.clone();
    eager_backend.programs = predicate::eager(&backend.programs);
    let mut natural = host.open("natural", Some(backend)).unwrap();
    let mut eager = host.open("eager", Some(eager_backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "dev:reader", 1000).iter().enumerate() {
        natural.apply(page, n == 0).unwrap();
        eager.apply(page, n == 0).unwrap();
    }
    predicate::check(host.label(), |force_eager, name, cursor| {
        let device = if force_eager { &mut eager } else { &mut natural };
        device.query(name, "dev:reader", &serde_json::json!({"c":cursor}), 300).unwrap()
    });
    host.close("natural", natural);
    host.close("eager", eager);
}

#[test]
fn following_merge_predicate_memory() { merge_predicate(crate::common::Memory::new()); }

#[test]
fn following_merge_predicate_sqlite() { merge_predicate(crate::common::Sqlite::new("merge-predicate")); }
