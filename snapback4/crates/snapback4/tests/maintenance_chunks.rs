//! Zero-time slices deterministically exercise cursor continuation at every row.
use snapback4_core::{Context, Engine, Value, WriteState};
use std::{collections::BTreeMap, time::Duration};

fn engine(source: &str) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}
fn run(e: &mut Engine, who: &str, op: &str, args: &[(&str, Value)]) {
    let result = e.mutate(op, None, Context::new(who, args.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()).at(1)).unwrap();
    assert!(matches!(result.state, WriteState::Sent { .. }), "{result:?}");
}
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn feed() -> Engine {
    let card = include_str!("../../snapback4-lang/src/guide/feeds.md");
    let source = snapback4_lang::guide::quarry(card).into_iter()
        .find(|source| source.contains("view following:")).expect("published Following example");
    engine(&source)
}
fn post(e: &mut Engine, name: &str) { run(e, "author", "post", &[("postId", id(name)), ("parentId", Value::Null)]); }
fn drain(e: &mut Engine) {
    let mut chunks = 0;
    while e.run_timeline_chunk_for(2, Duration::ZERO).unwrap().is_some() {
        chunks += 1; assert!(chunks < 5000);
    }
    assert_eq!(e.timeline_work_counts().unwrap(), [("following".into(), 0, 0)]);
}

#[test]
fn time_slice_commits_only_processed_delivery_and_purge_cursors() {
    let mut e = feed();
    for n in 0..5 { run(&mut e, &format!("r{n}"), "follow", &[("actor", id("author"))]); }
    post(&mut e, "p");
    for n in 1..=5 {
        assert_eq!(e.run_timeline_chunk_for(2, Duration::ZERO).unwrap().unwrap().rows_written, 2);
        assert_eq!(e.store().rows("followingFeed").unwrap().len(), n + 1);
    }
    drain(&mut e);
    run(&mut e, "author", "remove", &[("postId", id("p"))]);
    for remaining in (1..6).rev() {
        e.run_timeline_chunk_for(2, Duration::ZERO).unwrap().unwrap();
        assert_eq!(e.store().rows("followingFeed").unwrap().len(), remaining);
        assert_eq!(e.store().rows("followingRemovedEvents").unwrap().len(), 1, "tombstone survives every unfinished purge");
    }
    drain(&mut e);
    assert!(e.store().rows("followingFeed").unwrap().is_empty());
    assert!(e.store().rows("followingWork").unwrap().is_empty());
    assert!(e.store().rows("followingRemovedEvents").unwrap().is_empty());
}

#[test]
fn time_sliced_backfill_and_cleanup_preserve_the_refollow_epoch() {
    let mut e = feed();
    for n in 0..260 { post(&mut e, &format!("p{n:03}")); }
    drain(&mut e);
    run(&mut e, "reader", "follow", &[("actor", id("author"))]);
    assert_eq!(e.store().rows("followingFeed").unwrap().len(), 310);
    e.run_timeline_chunk_for(2, Duration::ZERO).unwrap().unwrap();
    assert_eq!(e.store().rows("followingFeed").unwrap().len(), 311);
    drain(&mut e);
    assert_eq!(e.store().rows("followingFeed").unwrap().len(), 520);
    run(&mut e, "reader", "unfollow", &[("actor", id("author"))]);
    e.run_timeline_chunk_for(2, Duration::ZERO).unwrap().unwrap();
    assert_eq!(e.store().rows("followingFeed").unwrap().len(), 263);
    run(&mut e, "reader", "follow", &[("actor", id("author"))]);
    let epoch = e.store().rows("followingEdges").unwrap()[0].field("epoch").unwrap().clone();
    drain(&mut e);
    let copies = e.store().rows("followingFeed").unwrap();
    let reader: Vec<_> = copies.iter().filter(|r| r.field("readerId").unwrap() == &id("reader")).collect();
    assert_eq!(reader.len(), 260);
    assert!(reader.iter().all(|r| r.field("epoch").unwrap() == &epoch));
}

const JOBS: &str = "table counters:\n  n: int\n  expiresAt: time ?\n  expire at .expiresAt\n  public 'maintenance test'\n  insert <- allow\n  update <- allow\n  sync public last 500 by .id\nmutation add():\n  insert counters {n: 0, expiresAt: 10}\njob adaptive():\n  for c in counters:\n    update counters[c.id] {n: c.n + 1}\njob explicit():\n  chunk c in counters first 20 by byId:\n    update counters[c.id] {n: c.n + 1}\n";

#[test]
fn jobs_resume_after_time_slices_and_expiry_drains_short_batches() {
    let mut e = engine(JOBS);
    for _ in 0..7 { run(&mut e, "reader", "add", &[]); }
    for job in ["adaptive", "explicit"] {
        let id = e.enqueue_job(job, BTreeMap::new(), 2).unwrap();
        for n in 1..=7 {
            let chunk = e.run_job_chunk_for(2, Duration::ZERO).unwrap().unwrap();
            assert_eq!(chunk.rows_written, n, "each slice commits one entire iteration");
        }
        assert_eq!(e.job(&id).unwrap().unwrap().state, snapback4_core::JobState::Done);
    }
    assert!(e.store().rows("counters").unwrap().iter().all(|r| r.field("n").unwrap() == &Value::Int(2)));
    for remaining in (0..7).rev() {
        assert_eq!(e.sweep_expired_for(10, 2000, Duration::ZERO).unwrap(), 1);
        assert_eq!(e.store().rows("counters").unwrap().len(), remaining);
    }
    assert_eq!(e.sweep_expired_for(10, 2000, Duration::ZERO).unwrap(), 0);
}

#[test]
fn lease_sweeps_yield_between_runs_and_requeue_every_expired_claim() {
    let mut e = engine("use server\naction invite()\neffect notify\nmutation send():\n  emit notify {n: 1}\n");
    for n in 0..7 {
        e.request_action("invite", &format!("a{n}"), Context::new("reader", BTreeMap::new()).at(0)).unwrap();
        run(&mut e, "reader", "send", &[]);
    }
    assert_eq!(e.claim_actions("service:worker", None, 7, 1000, 60, 1).unwrap().len(), 7);
    assert_eq!(e.claim_effects("service:worker", None, 7, 1000, 1).unwrap().len(), 7);
    for count in 1..=7 {
        assert_eq!(e.requeue_expired_actions_for(2000, Duration::ZERO).unwrap(), 1);
        assert_eq!(e.requeue_expired_effects_for(2000, Duration::ZERO).unwrap(), 1);
        assert_eq!(e.action_counts().unwrap()["queued"], count);
        assert_eq!(e.effects(Some("queued"), 20).unwrap().len(), count as usize);
    }
    assert_eq!(e.requeue_expired_actions_for(2000, Duration::ZERO).unwrap(), 0);
    assert_eq!(e.requeue_expired_effects_for(2000, Duration::ZERO).unwrap(), 0);
}

#[test]
fn asset_slices_reserve_only_their_prefix_and_forget_every_reserved_asset() {
    use snapback4_core::assets::{Asset, AssetKind};
    let mut e = engine("query one():\n  return 1\n");
    for n in 0..5 {
        e.store().record_asset(&Asset { id: format!("a{n}"), owner: "reader".into(), kind: AssetKind::Image,
            content_type: "image/png".into(), bytes: 1, width: Some(1), height: Some(1), duration: None,
            created_at: 0, home: None, released_at: None, name: None }).unwrap();
    }
    let mut first = e.prepare_asset_sweep_for(86_400_000, Duration::ZERO).unwrap();
    assert_eq!(first.len(), 1);
    assert_eq!(e.store().conn().query_row("SELECT count(*) FROM _asset_gc", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    first.remove_files().unwrap();
    assert_eq!(e.finish_asset_sweep_for(&mut first, Duration::ZERO).unwrap(), 1);
    assert!(first.is_empty());
    let mut rest = e.prepare_asset_sweep(86_400_000).unwrap();
    assert_eq!(rest.len(), 4);
    rest.remove_files().unwrap();
    for remaining in (0..4).rev() {
        assert_eq!(e.finish_asset_sweep_for(&mut rest, Duration::ZERO).unwrap(), 1);
        assert_eq!(rest.len(), remaining);
    }
    assert!(e.prepare_asset_sweep(86_400_000).unwrap().is_empty());
    assert_eq!(e.store().conn().query_row("SELECT count(*) FROM _asset_gc", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
}
