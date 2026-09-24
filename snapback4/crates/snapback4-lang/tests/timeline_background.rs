use snapback4_core::{Context, Engine, Store, Value, WriteState, MutationOutcome};
use std::collections::BTreeMap;
const SOURCE: &str = include_str!("fixtures/timeline-v2.q");
fn bound() -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert!(b.notes.is_empty(), "{:?}", b.notes);
    b
}
fn engine() -> Engine { let b=bound(); Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap() }
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn run(e: &mut Engine, op: &str, who: &str, args: &[(&str,Value)], at: i64) -> MutationOutcome {
    let out=e.mutate(op,None,Context::new(who,args.iter().map(|(k,v)|(k.to_string(),v.clone())).collect()).at(at)).unwrap();
    assert!(matches!(out.state,WriteState::Sent{..}), "{op}: {out:?}"); out
}
fn post(e:&mut Engine, who:&str, name:&str, at:i64)->MutationOutcome { run(e,"post",who,&[("postId",id(name)),("parentId",Value::Null)],at) }
fn drain(e:&mut Engine)->usize { let mut n=0; while e.run_timeline_chunk(5000).unwrap().is_some(){ n+=1; assert!(n<20000); } n }
fn home(e:&mut Engine,who:&str)->snapback4_core::QueryOutcome { e.query("home",Context::new(who,BTreeMap::new()).at(6000)).unwrap() }
fn ids(e:&mut Engine,who:&str)->Vec<String>{ home(e,who).data.as_array().unwrap().iter().map(|r|r.field("id").unwrap().as_str().unwrap().to_owned()).collect() }

#[test]
fn constant_writer_cost_and_crash_resumption_to_900_followers() {
    let b=bound(); let dir=std::env::temp_dir().join(format!("timeline-v2-{}",std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path=dir.join("store.sqlite");
    let _=std::fs::remove_file(&path);
    let mut e=Engine::new(Store::open(&path).unwrap(),b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    for n in 0..900 { run(&mut e,"follow",&format!("r{n:04}"),&[("actor",id("a"))],1); }
    drain(&mut e);
    let large=post(&mut e,"a","large",2);
    assert_eq!(large.metered.rows_written,4);
    assert!(ids(&mut e,"r0899").is_empty());
    let start=std::time::Instant::now();
    let first=e.run_timeline_chunk(3).unwrap().unwrap();
    assert_eq!(first.rows_written,257);
    assert_eq!(e.store().rows("feedFeed").unwrap().len(),257);
    drop(e); // Reopen only committed store state, including the delivery cursor.
    let mut e=Engine::open(Store::open(&path).unwrap()).unwrap();
    // Adopting an unrelated followed-leading index must not reinterpret the
    // committed follower cursor (the delivery ordering stays followerId).
    let changed=SOURCE.replace("  unique byPair: followerId, followedId", "  unique byPair: followerId, followedId\n  by aOtherOrder: followedId, id");
    let b=snapback4_lang::compile(&[("schema.q".into(),changed)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    e.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let rest=drain(&mut e); assert_eq!(rest,3);
    assert_eq!(e.store().rows("feedFeed").unwrap().len(),901);
    assert_eq!(ids(&mut e,"r0899"),["large"]);
    let mut small=engine();
    for n in 0..5 { run(&mut small,"follow",&format!("r{n}"),&[("actor",id("a"))],1); }
    drain(&mut small); let small=post(&mut small,"a","small",2);
    assert_eq!(large.metered.rows_written,small.metered.rows_written);
    eprintln!("MEASURE write followers=5:{} followers=900:{}; recovery chunks=4 copies=901 elapsed_ms={}",small.metered.rows_written,large.metered.rows_written,start.elapsed().as_millis());
    assert_eq!(e.timeline_work_counts().unwrap(),[("feed".into(),0,0)]);
    drop(e); let _=std::fs::remove_file(&path);
}

#[test]
fn read_cost_is_independent_of_follow_count() {
    let mut measurements=Vec::new();
    for count in [5,500] {
        let mut e=engine();
        for n in 0..count { run(&mut e,"follow","reader",&[("actor",id(&format!("a{n}")))],1); }
        for n in 0..30 { post(&mut e,"a0",&format!("p{n:03}"),n+2); }
        drain(&mut e);
        let page=home(&mut e,"reader");assert!(page.complete);assert_eq!(page.data.as_array().unwrap().len(),20);
        measurements.push(page.metered.examined);
    }
    assert_eq!(measurements[0],measurements[1]);
    eprintln!("MEASURE read follows=5:{} follows=500:{}",measurements[0],measurements[1]);
}

#[test]
fn follow_preview_unfollow_removal_and_refollow_are_immediate() {
    let mut e=engine();
    for n in 0..80 { post(&mut e,"a",&format!("p{n:03}"),n+1); }
    drain(&mut e);
    let follow=run(&mut e,"follow","reader",&[("actor",id("a"))],100);
    assert_eq!(follow.metered.rows_written,53);
    assert_eq!(ids(&mut e,"reader")[0],"p079");
    assert_eq!(e.store().rows("feedFeed").unwrap().iter().filter(|r|r.field("readerId").unwrap()==&id("reader")).count(),50);
    assert_eq!(e.timeline_work_counts().unwrap()[0].1,1);
    run(&mut e,"unfollow","reader",&[("actor",id("a"))],101);
    assert!(ids(&mut e,"reader").is_empty());
    assert!(!e.store().rows("feedFeed").unwrap().is_empty());
    run(&mut e,"follow","reader",&[("actor",id("a"))],102);
    drain(&mut e);
    assert_eq!(e.store().rows("feedFeed").unwrap().len(),160);
    run(&mut e,"remove","a",&[("postId",id("p079"))],103);
    assert!(!ids(&mut e,"reader").contains(&"p079".into()));
    assert_eq!(e.store().rows("feedRemovedEvents").unwrap().len(),1);
    assert_eq!(e.store().rows("feedFeed").unwrap().len(),160);
    drain(&mut e);
    assert!(e.store().rows("feedRemovedEvents").unwrap().is_empty());
    assert_eq!(e.store().rows("feedFeed").unwrap().len(),158);
    run(&mut e,"unfollow","reader",&[("actor",id("a"))],104);drain(&mut e);
    assert_eq!(e.store().rows("feedFeed").unwrap().len(),79);
}

#[test]
fn originals_filter_reposts_and_source_authority() {
    let mut e=engine();post(&mut e,"a","p",1);
    run(&mut e,"post","a",&[("postId",id("reply")),("parentId",id("p"))],2);
    assert_eq!(e.store().rows("feedPosts").unwrap().len(),1);
    run(&mut e,"follow","reader",&[("actor",id("b"))],3);
    run(&mut e,"repost","b",&[("postId",id("p"))],4);drain(&mut e);
    assert_eq!(ids(&mut e,"reader").len(),1);
    let bad=e.mutate("remove",None,Context::new("b",[("postId".into(),id("p"))].into()).at(5)).unwrap();
    assert!(matches!(bad.state,WriteState::Failed{..}));
    run(&mut e,"remove","a",&[("postId",id("p"))],6);
    assert_eq!(ids(&mut e,"reader").len(),1,"independent repost survives");
    let bad=e.mutate("repost",None,Context::new("c",[("postId".into(),id("p"))].into()).at(7)).unwrap();
    assert!(matches!(bad.state,WriteState::Failed{..}));
    run(&mut e,"unrepost","b",&[("postId",id("p"))],8);
    assert!(ids(&mut e,"reader").is_empty());drain(&mut e);
    for source in [SOURCE.replace("immutable authorId, parentId, at","immutable authorId, at"), SOURCE.replace(".parentId = null and not .removed","viewer = .authorId")] {
        let b=snapback4_lang::compile(&[("schema.q".into(),source)]);
        assert!(b.diagnostics.iter().any(|d|d.code=="E_TIMELINE_FILTER"),"{:?}",b.diagnostics);
    }
}

#[test]
fn history_window_epochs_and_pending_completeness() {
    let mut e=engine();
    for n in 0..1100 { post(&mut e,"a",&format!("p{n:04}"),n+1); }
    drain(&mut e);
    run(&mut e,"follow","reader",&[("actor",id("a"))],1200);
    let first_epoch=e.store().rows("feedEdges").unwrap()[0].field("epoch").unwrap().clone();
    assert!(!home(&mut e,"reader").complete,"backfill is pending");
    drain(&mut e);
    assert!(home(&mut e,"reader").complete);
    let copies=|e:&Engine|e.store().rows("feedFeed").unwrap().into_iter().filter(|r|r.field("readerId").unwrap()==&id("reader")).collect::<Vec<_>>();
    assert_eq!(copies(&e).len(),1000);
    assert!(copies(&e).iter().all(|r|r.field("eventId").unwrap().as_str().unwrap()>="p0100"));
    let unfollow=run(&mut e,"unfollow","reader",&[("actor",id("a"))],1201);
    assert_eq!(unfollow.metered.rows_written,259);
    assert_eq!(copies(&e).len(),744,"256 stale copies disappear synchronously");
    let page=home(&mut e,"reader");assert!(page.data.as_array().unwrap().is_empty());assert!(!page.complete);
    run(&mut e,"follow","reader",&[("actor",id("a"))],1202);
    let second_epoch=e.store().rows("feedEdges").unwrap()[0].field("epoch").unwrap().clone();
    assert_ne!(first_epoch,second_epoch);
    let first_page = ids(&mut e, "reader");
    assert_eq!(first_page.len(), 20);
    assert_eq!(first_page.iter().collect::<std::collections::BTreeSet<_>>().len(), 20);
    let current = copies(&e).into_iter().filter(|r|r.field("epoch").unwrap() == &second_epoch).collect::<Vec<_>>();
    assert_eq!(current.len(), 50, "only the new epoch's preview has been delivered");
    for event in &first_page {
        assert_eq!(current.iter().filter(|r|r.field("eventId").unwrap() == &id(event)).count(), 1);
    }
    let before_cleanup = page_all(&mut e, "reader", false);
    assert_eq!(before_cleanup, (1050..1100).rev().map(|n|format!("p{n:04}")).collect::<Vec<_>>());
    assert_eq!(before_cleanup.iter().collect::<std::collections::BTreeSet<_>>().len(), before_cleanup.len());
    drain(&mut e);
    let copies=copies(&e);assert_eq!(copies.len(),1000);
    assert!(copies.iter().all(|r|r.field("epoch").unwrap()==&second_epoch));
    assert!(home(&mut e,"reader").complete);
    eprintln!("MEASURE history window=1000 preview=50 unfollow_writes={} stale_after_unfollow=744; refollow leaves 1000 copies in new epoch",unfollow.metered.rows_written);
}

#[test]
fn stale_meter_cut_has_a_continuation_and_never_claims_complete() {
    let mut e=engine();
    for n in 0..600 { post(&mut e,"a",&format!("p{n:04}"),n+1); }
    drain(&mut e);run(&mut e,"follow","reader",&[("actor",id("a"))],700);drain(&mut e);
    run(&mut e,"unfollow","reader",&[("actor",id("a"))],701);
    e.set_ceilings(snapback4_core::Ceilings{examined:101,..Default::default()});
    let mut cursor=Value::Null;let mut pages=0;
    loop {
        let page=e.query("home",Context::new("reader",[("c".into(),cursor.clone())].into()).at(702)).unwrap();
        assert!(!page.complete);assert!(page.data.as_array().unwrap().is_empty());
        pages+=1;
        let Some(next)=page.next else {break};
        assert_ne!(cursor,Value::String(next.clone()),"continuation must advance through stale rows");
        cursor=Value::String(next);assert!(pages<20);
    }
    assert!(pages>1);drain(&mut e);assert!(home(&mut e,"reader").complete);
}

#[test]
fn overlapping_delivery_backfill_and_removal_never_duplicate_or_resurrect() {
    let mut e=engine();
    for n in 0..100 { post(&mut e,"a",&format!("p{n:03}"),n+1); }
    // Event fan-out is still pending when follow copies its preview.
    run(&mut e,"follow","reader",&[("actor",id("a"))],101);
    run(&mut e,"remove","a",&[("postId",id("p099"))],102);
    assert!(!ids(&mut e,"reader").contains(&"p099".to_string()));
    drain(&mut e);
    let copies=e.store().rows("feedFeed").unwrap();
    assert_eq!(copies.len(),198);assert_eq!(e.timeline_work_counts().unwrap()[0].2,0);
    assert!(copies.iter().all(|r|r.field("eventId").unwrap()!=&id("p099")));
    assert!(e.store().rows("feedRemovedEvents").unwrap().is_empty());
    assert!(e.run_timeline_chunk(999).unwrap().is_none());
}

#[test]
fn last_purge_chunk_cancels_an_older_delivery_before_retiring_tombstone() {
    let mut e=engine();
    for n in 0..900 {run(&mut e,"follow",&format!("r{n:04}"),&[("actor",id("a"))],1);}
    post(&mut e,"a","gone",100);e.run_timeline_chunk(100).unwrap();
    assert_eq!(e.store().rows("feedFeed").unwrap().len(),257);
    // Rewind only this supplied test clock to make purge win the queue order.
    // Correctness cannot depend on the worker observing delivery first.
    run(&mut e,"remove","a",&[("postId",id("gone"))],2);
    e.run_timeline_chunk(101).unwrap();
    assert_eq!(e.store().rows("feedFeed").unwrap().len(),1);
    assert_eq!(e.store().rows("feedRemovedEvents").unwrap().len(),1);
    e.run_timeline_chunk(102).unwrap();
    assert!(e.store().rows("feedFeed").unwrap().is_empty());
    assert!(e.store().rows("feedRemovedEvents").unwrap().is_empty());
    assert!(e.store().rows("feedWork").unwrap().is_empty());
    assert!(e.run_timeline_chunk(103).unwrap().is_none());
}

#[test]
fn equal_times_order_by_event_id_and_removal_fills_the_page() {
    let mut e=engine();run(&mut e,"follow","reader",&[("actor",id("a"))],1);
    for n in 0..40 {post(&mut e,"a",&format!("p{n:03}"),2);}
    drain(&mut e);
    assert_eq!(ids(&mut e,"reader"),(20..40).rev().map(|n|format!("p{n:03}")).collect::<Vec<_>>());
    for n in 20..40 {run(&mut e,"remove","a",&[("postId",id(&format!("p{n:03}")))],3);}
    let page=home(&mut e,"reader");assert!(page.complete);
    assert_eq!(ids(&mut e,"reader"),(0..20).rev().map(|n|format!("p{n:03}")).collect::<Vec<_>>());
    assert_eq!(e.store().rows("feedRemovedEvents").unwrap().len(),20,"hides before purge");
}

/// Check every delivered page while cleanup is still pending, including stale
/// copies interleaved at identical event times. Do not let drain mask duplicates.
fn page_all(e: &mut Engine, reader: &str, complete: bool) -> Vec<String> {
    let mut cursor = Value::Null;
    let mut out = Vec::new();
    for _ in 0..200 {
        let page = e.query("home", Context::new(reader, [("c".into(), cursor.clone())].into()).at(9999)).unwrap();
        assert_eq!(page.complete, complete);
        out.extend(page.data.as_array().unwrap().iter().map(|r|r.field("id").unwrap().as_str().unwrap().to_owned()));
        let Some(next) = page.next else { return out; };
        assert_ne!(cursor, Value::String(next.clone()));
        cursor = Value::String(next);
    }
    panic!("pagination failed to advance")
}

#[test]
fn application_edge_id_reuse_cannot_reuse_an_engine_epoch() {
    let source = format!("{SOURCE}\nmutation fixedFollow(actor: principal):\n  insert follows {{ id: 'fixed-edge', followerId: viewer, followedId: actor }}\nmutation cycle(actor: principal):\n  delete follows[viewer, actor]\n  insert follows {{ id: 'fixed-edge', followerId: viewer, followedId: actor }}\n  delete follows[viewer, actor]\n  insert follows {{ id: 'fixed-edge', followerId: viewer, followedId: actor }}\n");
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
    for n in 0..600 { post(&mut e, "a", &format!("p{n:04}"), n + 1); }
    drain(&mut e);
    run(&mut e, "fixedFollow", "reader", &[("actor", id("a"))], 700);
    drain(&mut e);
    let epoch = e.store().rows("feedEdges").unwrap()[0].field("epoch").unwrap().clone();
    run(&mut e, "unfollow", "reader", &[("actor", id("a"))], 701);
    run(&mut e, "fixedFollow", "reader", &[("actor", id("a"))], 700); // Clock also repeats.
    assert_ne!(epoch, e.store().rows("feedEdges").unwrap()[0].field("epoch").unwrap().clone());
    assert_eq!(page_all(&mut e, "reader", false), (550..600).rev().map(|n|format!("p{n:04}")).collect::<Vec<_>>());
    drain(&mut e);
    let expected = (0..600).rev().map(|n|format!("p{n:04}")).collect::<Vec<_>>();
    assert_eq!(page_all(&mut e, "reader", true), expected);
    // Two replacement edges in one transaction need distinct ordinals too.
    run(&mut e, "cycle", "reader", &[("actor", id("a"))], 700);
    assert_eq!(page_all(&mut e, "reader", false), (550..600).rev().map(|n|format!("p{n:04}")).collect::<Vec<_>>());
    drain(&mut e);
    assert_eq!(page_all(&mut e, "reader", true), expected);
    assert_eq!(e.timeline_work_counts().unwrap(), [("feed".into(), 0, 0)]);
}

#[test]
fn late_follow_history_is_independent_of_delivery_drain_order() {
    let mut histories = Vec::new();
    for drain_before_follow in [false, true] {
        let mut e = engine();
        for n in 0..1100 { post(&mut e, "a", &format!("p{n:04}"), n + 1); }
        if drain_before_follow { drain(&mut e); }
        run(&mut e, "follow", "reader", &[("actor", id("a"))], -100); // Not wall-clock order.
        // This new, backdated event sorts inside the pending history scan. It
        // belongs to delivery, and must not consume a slot in the old window.
        post(&mut e, "a", "new-backdated", 200);
        drain(&mut e);
        let history = page_all(&mut e, "reader", true);
        assert_eq!(history.len(), 1001);
        let set: std::collections::BTreeSet<_> = history.iter().cloned().collect();
        assert_eq!(set, (100..1100).map(|n|format!("p{n:04}")).chain(["new-backdated".into()]).collect());
        assert_eq!(e.timeline_work_counts().unwrap(), [("feed".into(), 0, 0)]);
        histories.push(history);
    }
    assert_eq!(histories[0], histories[1]);
}

#[test]
fn authored_follower_index_name_cannot_replace_the_engine_index() {
    let source = SOURCE.replace("  unique byPair: followerId, followedId", "  unique byPair: followerId, followedId\n  by byTimelinefeedFollowers: followerId, followedId");
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert_eq!(b.schema.timelines[0].followed_index, "$timeline:feed:followers");
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
    run(&mut e, "follow", "reader", &[("actor", id("a"))], 1);
    post(&mut e, "a", "p", 2);
    drain(&mut e);
    assert_eq!(ids(&mut e, "reader"), ["p"]);
}

#[test]
fn delivery_charges_large_edge_payloads_before_materializing_them() {
    let source = SOURCE.replace("table follows:\n", "table follows:\n  payload: text <=100000\n")
        .replace("mutation follow(actor: principal):", "mutation follow(actor: principal, payload: text <=100000):")
        .replace("insert follows { followerId: viewer, followedId: actor }", "insert follows { followerId: viewer, followedId: actor, payload }");
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
    for n in 0..256 {
        run(&mut e, "follow", &format!("r{n:04}"), &[("actor", id("a")), ("payload", Value::String("x".repeat(100000)))], 1);
    }
    post(&mut e, "a", "p", 2);
    let chunk = e.run_timeline_chunk(3).unwrap().unwrap();
    assert_eq!(chunk.rows_written, 1, "only the refusal/park record commits");
    assert_eq!(e.store().rows("feedFeed").unwrap().len(), 1, "no unmetered recipient copies commit");
    assert_eq!(e.timeline_work_counts().unwrap(), [("feed".into(), 0, 1)]);
    let work = e.store().rows("feedWork").unwrap();
    let error = work[0].field("error").unwrap().as_str().unwrap();
    assert!(error.contains("HeapBytes") && error.contains("16777216"), "{error}");
    assert_eq!(work[0].field("cursor").unwrap(), &Value::Null);
    eprintln!("MEASURE 256 x 100000-byte edges: chunk refused before allocation; {error}");
}

#[test]
fn admission_order_distinguishes_event_and_edge_inside_one_transaction() {
    let source = format!("{SOURCE}\nmutation mixed():\n  insert posts {{ id: 'before', authorId: 'a', parentId: null, at: 999 }}\n  insert follows {{ id: 'fixed', followerId: 'reader', followedId: 'a' }}\n  insert posts {{ id: 'after', authorId: 'a', parentId: null, at: -999 }}\n");
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p|p.program)).unwrap();
    let result = e.mutate("mixed", None, Context::system().at(1)).unwrap();
    assert!(matches!(result.state, WriteState::Sent { .. }), "{result:?}");
    assert_eq!(ids(&mut e, "reader"), ["before"]);
    let edge = e.store().rows("feedEdges").unwrap()[0].field("epoch").unwrap().as_str().unwrap().to_owned();
    let admissions = e.store().rows("feedWork").unwrap();
    for task in &admissions {
        let order = task.field("admitted").unwrap().as_str().unwrap();
        assert_eq!(&order[..16], &edge[..16], "same transaction sequence");
        assert_eq!(order < edge.as_str(), task.field("eventId").unwrap() == &id("before"));
    }
    drain(&mut e);
    assert_eq!(page_all(&mut e, "reader", true), ["before", "after"]);
}

#[test]
fn trusted_restore_preserves_the_admission_order_floor() {
    let mut original = engine();
    for n in 0..60 { post(&mut original, "a", &format!("p{n:03}"), n); }
    run(&mut original, "follow", "reader", &[("actor", id("a"))], 70);
    let old_epoch = original.store().rows("feedEdges").unwrap()[0].field("epoch").unwrap().clone();
    let rows = original.schema().tables.keys().flat_map(|table|original.store().rows(table).unwrap().into_iter().map(move |row|(table.clone(), row))).collect::<Vec<_>>();
    let mut restored = engine();
    restored.load_trusted(rows).unwrap();
    post(&mut restored, "a", "new-after-restore", -1);
    drain(&mut restored);
    assert_eq!(page_all(&mut restored, "reader", true).len(), 61);
    run(&mut restored, "unfollow", "reader", &[("actor", id("a"))], 71);
    run(&mut restored, "follow", "reader", &[("actor", id("a"))], 72);
    let new_epoch = restored.store().rows("feedEdges").unwrap()[0].field("epoch").unwrap().clone();
    assert!(new_epoch.as_str().unwrap() > old_epoch.as_str().unwrap());
    drain(&mut restored);
    assert_eq!(page_all(&mut restored, "reader", true).len(), 61);
}

#[test]
fn followers_on_both_sides_of_a_saved_cursor_receive_identical_history() {
    let mut e = engine();
    for n in 0..256 { run(&mut e, "follow", &format!("m{n:04}"), &[("actor", id("a"))], 1); }
    run(&mut e, "follow", "zz-original", &[("actor", id("a"))], 1);
    post(&mut e, "a", "p0000", 2);
    e.run_timeline_chunk(3).unwrap().unwrap();
    let task = &e.store().rows("feedWork").unwrap()[0];
    assert_eq!(task.field("status").unwrap().as_str().unwrap(), "pending");
    assert_ne!(task.field("cursor").unwrap(), &Value::Null);
    // Retire the first chunk's edges so this test need not deliver the newer
    // 1,099 posts to 256 unrelated recipients. Keep the later eligible edge.
    for n in 0..256 { run(&mut e, "unfollow", &format!("m{n:04}"), &[("actor", id("a"))], 4); }
    for n in 1..1100 { post(&mut e, "a", &format!("p{n:04}"), n + 10); }
    // These edges sort before and after the committed m0255 cursor. Their
    // application ids and clocks are deliberately older-looking than the event.
    for (reader, edge) in [("a-late", "000-old-looking"), ("z-late", "001-old-looking")] {
        let out = e.mutate("follow", None, Context::new(reader, [("actor".into(), id("a"))].into()).at(-100).with_ids([edge.into()])).unwrap();
        assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
    }
    drain(&mut e);
    let expected = (100..1100).rev().map(|n|format!("p{n:04}")).collect::<Vec<_>>();
    assert_eq!(page_all(&mut e, "a-late", true), expected);
    assert_eq!(page_all(&mut e, "z-late", true), expected);
    assert_eq!(page_all(&mut e, "zz-original", true).len(), 1100);
    assert_eq!(e.timeline_work_counts().unwrap(), [("feed".into(), 0, 0)]);
}

#[test]
fn a_full_chunk_of_skipped_edges_keeps_the_delivery_cursor_live() {
    let mut e = engine();
    for n in 0..256 { run(&mut e, "follow", &format!("m{n:04}"), &[("actor", id("a"))], 1); }
    run(&mut e, "follow", "zz-original", &[("actor", id("a"))], 1);
    post(&mut e, "a", "p", 2);
    e.run_timeline_chunk(3).unwrap().unwrap();
    let first = e.store().rows("feedWork").unwrap()[0].field("cursor").unwrap().clone();
    for n in 0..256 { run(&mut e, "follow", &format!("n{n:04}"), &[("actor", id("a"))], -100); }
    let skipped = e.run_timeline_chunk(4).unwrap().unwrap();
    assert_eq!(skipped.rows_written, 1, "only the cursor changes");
    let work = e.store().rows("feedWork").unwrap();
    assert_eq!(work[0].field("status").unwrap().as_str().unwrap(), "pending");
    assert_ne!(work[0].field("cursor").unwrap(), &first);
    assert!(ids(&mut e, "zz-original").is_empty());
    assert_eq!(e.run_timeline_chunk(5).unwrap().unwrap().rows_written, 2);
    assert_eq!(ids(&mut e, "zz-original"), ["p"]);
    assert_eq!(e.timeline_work_counts().unwrap(), [("feed".into(), 0, 0)]);
}
