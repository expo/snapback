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
    assert_eq!(follow.metered.rows_written,52);
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
    let first_epoch=e.store().rows("follows").unwrap()[0].field("id").unwrap().clone();
    assert!(!home(&mut e,"reader").complete,"backfill is pending");
    drain(&mut e);
    assert!(home(&mut e,"reader").complete);
    let copies=|e:&Engine|e.store().rows("feedFeed").unwrap().into_iter().filter(|r|r.field("readerId").unwrap()==&id("reader")).collect::<Vec<_>>();
    assert_eq!(copies(&e).len(),1000);
    assert!(copies(&e).iter().all(|r|r.field("eventId").unwrap().as_str().unwrap()>="p0100"));
    let unfollow=run(&mut e,"unfollow","reader",&[("actor",id("a"))],1201);
    assert_eq!(unfollow.metered.rows_written,258);
    assert_eq!(copies(&e).len(),744,"256 stale copies disappear synchronously");
    let page=home(&mut e,"reader");assert!(page.data.as_array().unwrap().is_empty());assert!(!page.complete);
    run(&mut e,"follow","reader",&[("actor",id("a"))],1202);
    let second_epoch=e.store().rows("follows").unwrap()[0].field("id").unwrap().clone();
    assert_ne!(first_epoch,second_epoch);
    assert_eq!(ids(&mut e,"reader")[0],"p1099");
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
