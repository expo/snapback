use super::world;
use snapback4_core::{Context, Engine, Value};
use std::collections::BTreeMap;
#[path = "../common/following_removal.rs"]
mod case;
#[path = "../common/write_observation.rs"]
mod observation;
#[path = "../common/nonuniform_probe.rs"]
mod nonuniform;

fn engine() -> Engine {
    let bound = world::compiled(&world::source());
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    assert!(bound.schema.operations.contains_key("unrepost"), "feeds must publish removal");
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}

#[test]
fn following_removal_cut_never_returns_unchecked_events() {
    let mut e = engine();
    case::seed_cut(&mut e);
    case::check_cut("server", |ceilings| {
        e.set_ceilings(ceilings);
        e.query("following", Context::new(case::reader(0), BTreeMap::new()).at(300)).unwrap()
    });
}

#[test]
fn following_removal_n1_hidden_absent_probe_sweep() {
    let cost = nonuniform::EXAMINED_SWEEP;
    let mut worlds = Vec::new();
    for hidden in [false, true] {
        let bound = world::compiled(nonuniform::SOURCE);
        let mut e = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        e.seed(nonuniform::rows(hidden)).unwrap();
        worlds.push(nonuniform::sweep(cost, |name, ceilings| { e.set_ceilings(ceilings); e.query(name, nonuniform::context()) }));
        e.set_ceilings(Default::default());
        e.seed([nonuniform::visible()]).unwrap();
        nonuniform::positive(e.query("page", nonuniform::context()).unwrap());
    }
    assert_eq!(worlds[0], worlds[1]);
    println!("N1 host=server ceilings=1..={cost} probe_limits=2 forms=3 identical_pairs={} positive_controls=2", worlds[0].len());
}

// @ref LLP 3000.007#20.3 — source removal preserves private inboxes; the system purges bounded copies.
#[test]
fn following_removal_purges_promoted_pushes_and_allows_fresh_reposts() {
    for followers in [5, 900] {
        let mut e = engine();
        case::seed(&mut e, followers);
        assert_eq!(case::event_rows(&e, "old-pushed"), followers + 1);
        for viewer in std::iter::once(case::AUTHOR.to_owned()).chain((0..followers).map(case::reader)) {
            assert_eq!(case::page(&mut e, &viewer).data.as_array().unwrap().len(), 3);
        }
        let events = case::remove(&mut e);
        assert_eq!(case::event_rows(&e, "old-pushed"), followers + 1, "author does not touch private copies");
        for viewer in std::iter::once(case::AUTHOR.to_owned()).chain((0..followers).map(case::reader)) {
            let page = case::page(&mut e, &viewer);
            assert!(page.data.as_array().unwrap().is_empty(), "removed events vanished before purge");
            assert!(page.next.is_none());
        }
        world::mutate(&mut e, "repost", case::AUTHOR, &[("postId", world::id(case::ORIGINAL))], 7);
        let fresh = case::repost_id(&e);
        assert!(!events.contains(&fresh));
        for viewer in std::iter::once(case::AUTHOR.to_owned()).chain((0..followers).map(case::reader)) {
            assert_eq!(case::all(&mut e, &viewer), vec![fresh.clone()]);
        }
        let run = case::purge(&mut e);
        println!("PURGE followers={followers} events=3 chunks={} written={}", run.chunks, run.rows_written);
        assert_eq!(run.chunks, 3, "one event per chunk, ending at the captured upper key");
        assert_eq!(run.rows_written, if followers == 5 { 21 } else { 904 });
        for event in &events { assert_eq!(case::event_rows(&e, event), 0); }
        assert!(e.store().rows("removedEvents").unwrap().is_empty());
        for viewer in std::iter::once(case::AUTHOR.to_owned()).chain((0..followers).map(case::reader)) {
            assert_eq!(case::all(&mut e, &viewer), vec![fresh.clone()]);
        }
        world::mutate(&mut e, "unrepost", case::AUTHOR, &[("postId", world::id(case::ORIGINAL))], 8);
        e.run_job("purgeRemoved", BTreeMap::new(), 60_003).unwrap();
        world::mutate(&mut e, "repost", case::AUTHOR, &[("postId", world::id(case::ORIGINAL))], 9);
        assert_ne!(case::repost_id(&e), fresh, "re-repost also works after purge");
    }
}

#[test]
fn following_removal_fills_live_pages_and_continues_through_removed_entries() {
    let mut e = engine();
    case::seed(&mut e, 5);
    for n in 0..40 {
        world::mutate(&mut e, "createPost", case::AUTHOR, &[("postId", world::id(&format!("page-{n:02}"))), ("body", Value::String("page".into()))], 100 + n);
    }
    let before = case::page(&mut e, &case::reader(0));
    assert_eq!(before.data.as_array().unwrap().len(), 20);
    for n in 20..40 { world::mutate(&mut e, "deletePost", case::AUTHOR, &[("postId", world::id(&format!("page-{n:02}")))], 200 + n); }
    let after = case::page(&mut e, &case::reader(0));
    assert_eq!(after.data.as_array().unwrap().len(), 20);
    assert_ne!(after.next, before.next, "the page fills past tombstones and positions after its last live result");
    let continued = e.query("following", Context::new(case::reader(0), world::args(&[("c", Value::String(before.next.unwrap()))])).at(300)).unwrap();
    assert!(continued.complete);
    assert_eq!(continued.data, after.data, "a cursor acquired before removal still reaches the live suffix");
    let tail = e.query("following", Context::new(case::reader(0), world::args(&[("c", Value::String(after.next.clone().unwrap()))])).at(300)).unwrap();
    assert!(tail.complete);
    assert_eq!(tail.data.as_array().unwrap().len(), 3);
    assert!(tail.next.is_none());
    let ids = case::all(&mut e, &case::reader(0));
    assert_eq!(ids.len(), 23);
    assert_eq!(ids.iter().collect::<std::collections::BTreeSet<_>>().len(), 23);
    println!("REMOVAL page examined={} index={} probes={} steps={} heap={} output={} written={}", after.metered.examined, after.metered.index_entries, after.metered.rule_probes, after.metered.steps, after.metered.heap_bytes, after.metered.output_bytes, after.metered.rows_written);
    let mut limits = e.ceilings();
    limits.examined = 25;
    e.set_ceilings(limits);
    let cut = e.query("following", Context::new(case::reader(0), BTreeMap::new()).at(300)).unwrap();
    assert!(!cut.complete, "a cut while probing tombstones is incomplete");
}

#[test]
fn following_removal_does_not_observe_or_delete_another_readers_private_rows() {
    use serde_json::json;
    use snapback4_core::value::object;
    let source = format!("{}\nmutation privateDelete(readerId: principal, eventId: posts):\n  delete feed[readerId, eventId]\n", world::source());
    for op in ["deletePost", "privateDelete"] {
        let mut observations = Vec::new();
        for hidden in [false, true] {
            let bound = world::compiled(&source);
            assert!(bound.schema.operations.contains_key("deletePost"));
            let mut e = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
            case::seed(&mut e, 5);
            // Same public state, sequence and author holdings; only an
            // unreadable inbox's event identity and contents differ.
            e.seed(vec![("feed".into(), object([
                ("id", world::id("hidden")), ("readerId", world::id("dev:private")),
                ("eventId", world::id(if hidden { "new-post" } else { case::ORIGINAL })),
                ("actorId", world::id(case::AUTHOR)), ("authorId", world::id(case::AUTHOR)),
                ("postId", world::id("new-post")), ("repost", Value::Bool(false)),
                ("body", Value::String(if hidden { "SECRET" } else { "OTHER" }.into())), ("at", Value::Int(1)),
            ]))]).unwrap();
            let input = if op == "deletePost" { json!({"postId":"new-post"}) } else { json!({"readerId":"dev:private","eventId":"new-post"}) };
            let (_, observed) = observation::observe(&mut e, op, case::AUTHOR, input, "remove-pair", ("following", json!({"c":null})));
            if op == "privateDelete" {
                observed.assert_unchanged();
                assert_eq!(observed.body()["why"]["code"], "NOT_FOUND");
            } else {
                assert_eq!(observed.body()["state"], "sent");
            }
            let before = observed.before["feed"].iter().find(|r| r.field("id") == Ok(&world::id("hidden"))).unwrap();
            assert!(observed.committed["feed"].contains(before), "the author never deletes the private copy");
            observations.push(observed);
        }
        observations[0].assert_same(&observations[1]);
        println!("REMOVAL paired op={op} worlds=2 stores=2 meters=7 identical");
    }
}

#[test]
fn following_removal_measures_the_purge_body_under_unchanged_default_meters() {
    // JobRun exposes chunks and rows, not meters. Execute the same compiled
    // job IR through the local interpreter's metered harness over a real
    // transaction, as the system with all rows held and no horizons. The
    // ordinary ceilings are stricter than the job's; assert no cap. These
    // are sweep-body meters, including the harness's null result encoding,
    // not scheduler bookkeeping. Real scheduled chunks are tested above.
    for followers in [5, 900, 1000] {
        let bound = world::compiled(&world::source());
        let programs: Vec<_> = bound.programs.into_iter().map(|p| p.program).collect();
        let measured = programs.iter().find(|p| p.name == "purgeRemoved").unwrap().clone();
        let mut e = Engine::memory(bound.schema, programs).unwrap();
        case::seed(&mut e, followers);
        case::remove(&mut e);
        for _ in 0..3 {
            let event = e.store().rows("removedEvents").unwrap().iter().map(|r| r.field("eventId").unwrap().as_str().unwrap().to_owned()).min().unwrap();
            let copies = case::event_rows(&e, &event);
            let schema = e.schema().clone();
            let tx = e.store_mut().transaction().unwrap();
            let result = snapback4_core::engine::local::query(&tx, &schema, &measured, Context::system().at(60_000), snapback4_core::meter::Ceilings::default()).unwrap();
            assert!(result.capped_at.is_none(), "{result:?}");
            tx.commit().unwrap();
            let m = result.metered;
            assert_eq!(m.rows_written as usize, copies + 1);
            assert_eq!(case::event_rows(&e, &event), 0);
            println!("PURGE_BODY followers={followers} copies={copies} examined={} index={} probes={} steps={} heap={} output={} written={}", m.examined, m.index_entries, m.rule_probes, m.steps, m.heap_bytes, m.output_bytes, m.rows_written);
        }
        assert!(e.store().rows("removedEvents").unwrap().is_empty());
    }
}

// @ref LLP 3000.007#20.3 — removal authority belongs to the source actor, without widening private inbox rules.
#[test]
fn following_removal_foreign_tombstone_preserves_private_worlds() {
    use serde_json::json;
    for (op, viewer, input) in [
        ("forgeImplicit", case::INTRUDER, json!({"eventId":"new-post"})),
        ("forgeRemoval", case::INTRUDER, json!({"eventId":"new-post", "markerId":"new-post", "actorId":case::INTRUDER})),
        ("forgeRemoval", case::INTRUDER, json!({"eventId":"new-post", "markerId":"new-post", "actorId":case::AUTHOR})),
        ("forgeRemoval", case::AUTHOR, json!({"eventId":"new-post", "markerId":"wrong-id", "actorId":case::AUTHOR})),
        ("forgeRemoval", case::AUTHOR, json!({"eventId":"missing", "markerId":"missing", "actorId":case::AUTHOR})),
    ] {
        let mut paired = Vec::new();
        for hidden in [true, false] {
            let bound = world::compiled(&case::authority_source());
            let mut e = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
            case::seed_authority(&mut e, hidden);
            let before = case::page(&mut e, case::PRIVATE);
            let (_, observed) = observation::observe(&mut e, op, viewer, input.clone(), "forge", ("following", json!({"c":null})));
            let after = case::page(&mut e, case::PRIVATE);
            println!("REMOVAL_AUTHORITY server op={op} viewer={viewer} hidden={hidden} state={} victim_unchanged={}", observed.body()["state"], before.data == after.data);
            assert_eq!(observed.body()["state"], "failed");
            assert_eq!(observed.body()["why"]["code"], "E_RULE");
            observed.assert_unchanged();
            assert_eq!(serde_json::to_value(&before).unwrap(), serde_json::to_value(&after).unwrap());
            let inbox = e.store().rows("feed").unwrap();
            assert_eq!(e.run_job("purgeRemoved", BTreeMap::new(), 1001).unwrap().rows_written, 0);
            assert_eq!(e.store().rows("feed").unwrap(), inbox);
            // The failed foreign claim cannot occupy byEvent or block its owner.
            world::mutate(&mut e, "deletePost", case::AUTHOR, &[("postId", world::id("new-post"))], 1002);
            assert_eq!(e.store().rows("removedEvents").unwrap().len(), 1);
            let removed = case::page(&mut e, case::PRIVATE);
            assert_eq!(removed.data.as_array().unwrap().is_empty(), hidden);
            assert_eq!(e.store().rows("feed").unwrap(), inbox, "only the system cleans private copies");
            e.run_job("purgeRemoved", BTreeMap::new(), 1003).unwrap();
            assert_eq!(case::event_rows(&e, "new-post"), 0);
            paired.push(observed);
        }
        paired[0].assert_same(&paired[1]);
    }
}
