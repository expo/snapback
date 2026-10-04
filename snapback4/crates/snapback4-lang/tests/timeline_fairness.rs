//! A live arrival every turn must not buy priority ahead of unfinished work.
// @ref LLP 3000#contended-read-serving — P declaration visits / D*P delivery turns.
use snapback4_core::{Context, Engine, Store, Value, WriteState};
use std::time::Duration;
const SOURCE: &str = include_str!("fixtures/timeline-v2.q");
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn engine() -> Engine {
    compile(SOURCE)
}
fn compile(source: &str) -> Engine {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn write(e: &mut Engine, op: &str, who: &str, args: &[(&str, Value)], at: i64) {
    let out=e.mutate(op,None,Context::new(who,args.iter().map(|(k,v)|(k.to_string(),v.clone())).collect()).at(at)).unwrap();
    assert!(matches!(out.state,WriteState::Sent {..}),"{out:?}");
}
fn post(e: &mut Engine, who: &str, name: &str, at: i64) {
    write(e,"post",who,&[("postId",id(name)),("parentId",Value::Null)],at);
}
fn follow(e: &mut Engine, who: &str, actor: &str) { write(e,"follow",who,&[("actor",id(actor))],0); }
fn drain(e: &mut Engine) {
    for _ in 0..20_000 { if e.run_timeline_chunk_for(0,Duration::ZERO).unwrap().is_none() {return;} }
    panic!("finite queue did not drain");
}
fn pending(e: &Engine) -> usize { e.timeline_work_counts().unwrap()[0].1 as usize }
fn work(e: &Engine, kind: &str) -> Vec<String> {
    e.store().rows("feedWork").unwrap().iter().filter(|r|r.field("kind").unwrap().as_str().unwrap()==kind && r.field("status").unwrap().as_str().unwrap()=="pending")
        .map(|r|r.field("id").unwrap().as_str().unwrap().to_owned()).collect()
}
fn cursor(e: &Engine, key: &str) -> Option<Value> {
    table_cursor(e,"feedWork",key)
}
fn table_cursor(e: &Engine, table: &str, key: &str) -> Option<Value> {
    let mut stmt=e.store().conn().prepare_cached("SELECT data FROM r WHERE t=(SELECT num FROM _catalog WHERE name=?1) AND id=?2").unwrap();
    let row=stmt.query_map([table,key],|r|r.get::<_,String>(0)).unwrap().next().map(|r|serde_json::from_str::<Value>(&r.unwrap()).unwrap());
    row.filter(|r|r.field("status").unwrap().as_str().unwrap()=="pending")
        .map(|r|r.field("cursor").unwrap().clone())
}
fn copies(e: &Engine, viewer: &str) -> usize {
    e.store().rows("feedFeed").unwrap().iter().filter(|r|r.field("readerId").unwrap()==&id(viewer)).count()
}
fn backfill_fixture() -> Engine {
    let mut e=engine();follow(&mut e,"eve","dave");
    for n in 0..120 {post(&mut e,"alice",&format!("old{n:03}"),n+1);}
    drain(&mut e);e
}

// Each finite prefix tests the invariant used for an unending stream. A new
// one-recipient delivery arrives before EVERY turn, even when others remain.
// P is frozen when each obligation is created, never increased by new arrivals.
fn stream(e: &mut Engine, targets: &[String], turns: usize) {
    let mut states:Vec<_>=targets.iter().map(|key|(cursor(e,key),pending(e),0usize)).collect();
    let mut services=vec![0;targets.len()];
    for turn in 1..=turns {
        // Equal and backwards clocks must not insert ahead of the obligation.
        let at=if turn%2==0 {0} else {-(turn as i64)};
        post(e,"dave",&format!("tiny{turn:04}"),at);
        let metered=e.run_timeline_turn_for(at,Duration::ZERO).unwrap().unwrap();
        assert!(metered.rows_written<=2,"one copy/delete and its cursor: {metered:?}");
        for (n,key) in targets.iter().enumerate() {
            let (previous,deadline,last)=&mut states[n];
            if previous.is_none() {continue;}
            let next=cursor(e,key);
            if next!=*previous {
                assert!(turn<=*deadline,"{key}: service at {turn} missed frozen bound {deadline}");
                services[n]+=1;*last=turn;*previous=next;*deadline=turn+pending(e);
            } else {assert!(turn<*deadline,"{key}: no progress since {last}, bound {deadline}, turn {turn}");}
        }
    }
    assert!(services.iter().all(|n|*n>=5),"cursor service counts: {services:?}");
    eprintln!("{turns} continuing arrivals; cursor service counts {services:?}; pending {}",pending(e));
}

#[test]
fn every_backfill_advances_within_its_frozen_pending_count_under_continuing_arrivals() {
    let mut e=backfill_fixture();
    for who in ["bob","carol","dan","erin","fred"] {follow(&mut e,who,"alice");}
    let targets=work(&e,"backfill");assert_eq!(targets.len(),5);
    stream(&mut e,&targets,400);
    for who in ["bob","carol","dan","erin","fred"] {assert!(copies(&e,who)>50);}
    drain(&mut e);
    for who in ["bob","carol","dan","erin","fred"] {assert_eq!(copies(&e,who),120);}
    assert_eq!(copies(&e,"eve"),400);
}

#[test]
fn cleanup_advances_within_its_frozen_pending_count_under_continuing_arrivals() {
    let mut e=backfill_fixture();
    for n in 120..600 {post(&mut e,"alice",&format!("old{n:03}"),n+1);}
    drain(&mut e);follow(&mut e,"bob","alice");drain(&mut e);
    write(&mut e,"unfollow","bob",&[("actor",id("alice"))],0);
    let targets=work(&e,"cleanup");assert_eq!(targets.len(),1);
    let initial=copies(&e,"bob");stream(&mut e,&targets,400);assert!(copies(&e,"bob")<initial);
    assert!(e.query("home",Context::new("bob",Default::default())).unwrap().data.as_array().unwrap().is_empty());
    drain(&mut e);assert_eq!(copies(&e,"bob"),0);assert_eq!(copies(&e,"eve"),400);
}

#[test]
fn multi_slice_fanout_advances_within_its_frozen_pending_count_under_continuing_arrivals() {
    let mut e=engine();follow(&mut e,"eve","dave");
    for n in 0..40 {follow(&mut e,&format!("reader{n:02}"),"alice");}
    drain(&mut e);post(&mut e,"alice","fanout",0);
    let targets=work(&e,"delivery");assert_eq!(targets.len(),1);
    stream(&mut e,&targets,400);drain(&mut e);
    for n in 0..40 {assert_eq!(copies(&e,&format!("reader{n:02}")),1);}
    assert_eq!(copies(&e,"eve"),400);
}

#[test]
fn fifo_control_also_services_backfill_during_the_same_arrival_stream() {
    let mut e=backfill_fixture();follow(&mut e,"bob","alice");
    for n in 0..200 {post(&mut e,"dave",&format!("tiny{n}"),300+n);e.run_timeline_chunk_for(0,Duration::ZERO).unwrap();}
    assert_eq!(copies(&e,"bob"),120);
}

#[test]
fn declaration_rotation_preserves_d_times_p_bound_with_arrivals_every_turn() {
    let source=SOURCE.replace("mutation post(postId:","maintain second: timeline\n  events posts where .parentId = null and not .removed by authorId, at removed by removed\n  reposts reposts by actorId, postId, at\n  edges follows by followerId, followedId\n\nmutation post(postId:");
    let mut e=compile(&source);follow(&mut e,"eve","dave");
    for n in 0..120 {post(&mut e,"alice",&format!("old{n}"),n);}
    drain(&mut e);follow(&mut e,"bob","alice");
    let mut targets:Vec<_>=["feedWork","secondWork"].into_iter().map(|table| {
        let row=e.store().rows(table).unwrap().into_iter().find(|r|r.field("kind").unwrap().as_str().unwrap()=="backfill").unwrap();
        let key=row.field("id").unwrap().as_str().unwrap().to_owned();
        (table,key.clone(),table_cursor(&e,table,&key),2usize,0)
    }).collect();
    for turn in 1..=400 {
        post(&mut e,"dave",&format!("tiny{turn}"),-1);
        e.run_timeline_turn_for(0,Duration::ZERO).unwrap();
        for (n,(table,key,previous,deadline,services)) in targets.iter_mut().enumerate() {
            if previous.is_none() {continue;}
            let next=table_cursor(&e,table,key);
            if next!=*previous {
                assert!(turn<=*deadline,"{table} missed D*P at {turn}/{deadline}");
                *previous=next;*services+=1;*deadline=turn+2*e.timeline_work_counts().unwrap()[n].1 as usize;
            } else {assert!(turn<*deadline,"{table} starved at {turn}/{deadline}");}
        }
    }
    assert!(targets.iter().all(|(_,_,_,_,n)|*n>=5));drain(&mut e);
    for table in ["feedFeed","secondFeed"] {
        assert_eq!(e.store().rows(table).unwrap().iter().filter(|r|r.field("readerId").unwrap()==&id("bob")).count(),120);
    }
}

#[test]
fn tail_position_rolls_back_with_copies_cursor_epochs_and_sequence() {
    let mut e=backfill_fixture();follow(&mut e,"bob","alice");post(&mut e,"dave","queued",0);
    let tables=["feedFeed","feedWork","feedEdges"];
    let before:Vec<_>=tables.iter().map(|t|e.store().rows(t).unwrap()).collect();let seq=e.store().seq().unwrap();
    e.store().conn().execute_batch("CREATE TRIGGER lu_abort BEFORE INSERT ON _log BEGIN SELECT RAISE(ABORT, 'LU late transaction fault'); END;").unwrap();
    assert!(e.run_timeline_turn_for(0,Duration::ZERO).is_err());
    for (table,rows) in tables.iter().zip(before) {assert_eq!(e.store().rows(table).unwrap(),rows);}
    assert_eq!(e.store().seq().unwrap(),seq);
    e.store().conn().execute_batch("DROP TRIGGER lu_abort;").unwrap();
    e.run_timeline_turn_for(0,Duration::ZERO).unwrap();assert_eq!(copies(&e,"bob"),51);
}

#[test]
fn restart_and_adoption_every_turn_preserve_item_share_during_arrivals() {
    let mut e=backfill_fixture();follow(&mut e,"bob","alice");
    let dir=std::env::temp_dir().join(format!("lu-fair-restart-{}",std::process::id()));std::fs::create_dir(&dir).unwrap();
    let target=work(&e,"backfill").pop().unwrap();let mut previous=cursor(&e,&target);let mut deadline=pending(&e);
    for turn in 1..=40 {
        post(&mut e,"dave",&format!("tiny{turn}"),-1);
        e.run_timeline_turn_for(0,Duration::ZERO).unwrap();
        let next=cursor(&e,&target);
        if next!=previous {assert!(turn<=deadline);previous=next;deadline=turn+pending(&e);}
        else {assert!(turn<deadline);}
        let path=dir.join(format!("{turn}.sqlite"));
        e.store().conn().execute("VACUUM INTO ?1",[path.to_str().unwrap()]).unwrap();drop(e);
        e=Engine::open(Store::open(&path).unwrap()).unwrap();
        let b=snapback4_lang::compile(&[("schema.q".into(),SOURCE.into())]);e.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    }
    assert!(copies(&e,"bob")>55);drain(&mut e);assert_eq!(copies(&e,"bob"),120);
    drop(e);std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn later_delivery_can_arrive_first_but_pages_remain_event_ordered_and_unique() {
    let mut e=engine();for who in ["bob","carol"] {follow(&mut e,who,"alice");}drain(&mut e);
    post(&mut e,"alice","earlier",1);post(&mut e,"alice","later",3);
    e.run_timeline_turn_for(0,Duration::ZERO).unwrap();
    e.run_timeline_turn_for(0,Duration::MAX).unwrap();
    let ids=|e:&mut Engine|e.query("home",Context::new("carol",Default::default())).unwrap().data.as_array().unwrap().iter().map(|r|r.field("id").unwrap().as_str().unwrap().to_owned()).collect::<Vec<_>>();
    assert_eq!(ids(&mut e),["later"]);drain(&mut e);assert_eq!(ids(&mut e),["later","earlier"]);
    assert_eq!(copies(&e,"carol"),2);
}
