//! Opt-in research prototype; ordinary schemas keep the v2 contract.
// @ref LLP 3000.016.000#5-measurement-and-regressions — history, epochs, fairness and fixed-domain witnesses.
use snapback4_core::{Context, Engine, Store, Value, WriteState, meter::Metered};
use snapback4_core::value::object;
use std::{collections::BTreeSet, time::{Duration, Instant}};
const SOURCE: &str = include_str!("fixtures/timeline-v2.q");
fn source(all: bool) -> String { if all { SOURCE.replace("maintain feed: timeline", "maintain feed: timeline experimental history all") } else { SOURCE.into() } }
fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics); b
}
fn temp_path(name: &str) -> std::path::PathBuf {
    let dir=std::env::temp_dir().join(format!("history-{name}-{}",std::process::id()));
    std::fs::create_dir_all(&dir).unwrap(); dir.join("store.sqlite")
}
fn engine(all: bool) -> Engine { let b=bound(&source(all)); Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap() }
fn id(s: &str)->Value { Value::Id(s.into()) }
fn run(e:&mut Engine,op:&str,who:&str,args:Vec<(&str,Value)>,at:i64)->Metered {
    let o=e.mutate(op,None,Context::new(who,args.into_iter().map(|(k,v)|(k.into(),v)).collect()).at(at)).unwrap();
    assert!(matches!(o.state,WriteState::Sent{..}),"{op}: {o:?}");o.metered
}
fn post(e:&mut Engine,actor:&str,n:&str,at:i64) { run(e,"post",actor,vec![("postId",id(n)),("parentId",Value::Null)],at); }
fn follow(e:&mut Engine,reader:&str,actor:&str) { run(e,"follow",reader,vec![("actor",id(actor))],1); }
fn chunk(e:&mut Engine)->Option<Metered> { e.run_timeline_chunk_for(2,Duration::from_secs(1)).unwrap() }
fn drain(e:&mut Engine)->usize { let mut n=0;while chunk(e).is_some(){n+=1;assert!(n<200_000);}n }
fn copies(e:&Engine,reader:&str)->BTreeSet<String> {e.store().rows("feedFeed").unwrap().iter().filter(|r|r.field("readerId").unwrap()==&id(reader)).map(|r|r.field("eventId").unwrap().as_str().unwrap().to_owned()).collect()}
fn home(e:&mut Engine,reader:&str)->snapback4_core::QueryOutcome { e.query("home",Context::new(reader,Default::default())).unwrap() }
fn pending(e:&Engine)->usize { e.store().rows("feedWork").unwrap().iter().filter(|r| r.field("kind").unwrap().as_str().unwrap()=="backfill").count() }

#[test]
fn opt_in_fences_versions_and_redefinition() {
    let ordinary=bound(SOURCE);let experimental=bound(&source(true));
    assert_eq!(ordinary.schema.timelines[0].version,2);assert_eq!(experimental.schema.timelines[0].version,3);
    assert!(!ordinary.schema.tables["feedWork"].indexes.contains_key("byActorBirth"));
    assert!(experimental.schema.tables["feedWork"].indexes.contains_key("byActorBirth"));
    let mut e=engine(false);post(&mut e,"a","p",1);follow(&mut e,"r","a");
    assert!(e.adopt(experimental.schema,experimental.programs.into_iter().map(|p|p.program)).unwrap_err().to_string().contains("E_TIMELINE_REDEFINE"));
    assert_eq!(copies(&e,"r"),BTreeSet::from(["p".into()]));
    let aggregate = source(true) + "\nmaintain totals: count feedFeed by readerId\n";
    let invalid = bound(&aggregate);
    let error = Engine::memory(invalid.schema,invalid.programs.into_iter().map(|p|p.program)).err().expect("refuse maintained partial history");
    assert!(error.to_string().contains("maintained aggregates"), "{error}");
}

#[test]
fn repost_birth_slots_and_tombstones_do_not_refill_the_frozen_domain() {
    let mut e=engine(true);
    post(&mut e,"original","original",0);
    for n in 0..60 {post(&mut e,"a",&format!("p{n:03}"),n);}
    run(&mut e,"repost","a",vec![("postId",id("original"))],-1000);drain(&mut e);
    let old=e.store().rows("reposts").unwrap()[0].field("$timeline:feed:repost").unwrap().clone();
    follow(&mut e,"r","a");
    run(&mut e,"unrepost","a",vec![("postId",id("original"))],100);
    assert!(e.store().rows("feedRemovedEvents").unwrap().iter().any(|r|r.field("eventId").unwrap()==&old));
    run(&mut e,"repost","a",vec![("postId",id("original"))],-2000);
    let new=e.store().rows("reposts").unwrap()[0].field("$timeline:feed:repost").unwrap().clone();
    assert_ne!(old,new);drain(&mut e);
    let rows=copies(&e,"r");assert!(!rows.contains(old.as_str().unwrap()));assert!(rows.contains(new.as_str().unwrap()));assert_eq!(rows.len(),61);
    assert!(e.store().rows("posts").unwrap().iter().all(|r|r.field("$timeline:feed:post").unwrap()==&Value::Bool(true)));
    assert!(e.store().rows("feedRemovedEvents").unwrap().is_empty());
}

#[test]
fn parked_history_stays_withheld_and_records_the_scheduled_turn() {
    let mut e=engine(true);
    for n in 0..60 {post(&mut e,"a",&format!("p{n:03}"),n);}
    drain(&mut e);follow(&mut e,"r","a");
    // Fault injection: corrupt only the unindexed task cursor. The normal
    // recovery path must park atomically, not publish the fifty-copy prefix.
    e.store().conn().execute("UPDATE r SET data=json_set(data,'$.Row.cursor',json(?1)) WHERE t=(SELECT num FROM _catalog WHERE name='feedWork') AND json_extract(data,'$.Row.kind.String')='backfill'",[r#"{"String":"not-hex"}"#]).unwrap();
    assert!(chunk(&mut e).is_some());
    assert_eq!(e.timeline_work_counts().unwrap(),vec![("feed".into(),0,1)]);
    assert_eq!(e.store().meta("experimental-history-last").unwrap().as_deref(),Some("feed"));
    assert!(chunk(&mut e).is_none());
    let q=home(&mut e,"r");assert!(q.unavailable&&!q.complete);assert_eq!(q.data,Value::Null);assert!(q.next.is_none());
}

#[test]
fn full_history_is_finite_under_backdated_births_and_deletions() {
    let mut e=engine(true);
    for n in 0..1200 {post(&mut e,"a",&format!("p{n:04}"),n);}
    drain(&mut e);follow(&mut e,"r","a");
    let p=home(&mut e,"r");assert!(!p.complete);assert!(p.unavailable);
    run(&mut e,"remove","a",vec![("postId",id("p0001"))],2000);
    let mut turns=0;
    while pending(&e)>0 {
        post(&mut e,"a",&format!("late{turns:04}"),-10000-turns as i64);
        let m=chunk(&mut e).unwrap();assert!(m.examined<=16384);assert!(m.index_entries<=16384);
        turns+=1;assert!(turns<40,"new backdated births extended the frozen range");
    }
    drain(&mut e);
    let all=copies(&e,"r");assert!(!all.contains("p0001"));
    assert_eq!(all.iter().filter(|s|s.starts_with('p')).count(),1199);
    assert_eq!(all.iter().filter(|s|s.starts_with("late")).count(),turns);
    let p=home(&mut e,"r");assert!(p.complete && !p.unavailable);
}

#[test]
fn refollow_cleanup_and_restart_keep_new_epoch() {
    let b=bound(&source(true));let path=temp_path("restart");
    let mut e=Engine::new(Store::open(&path).unwrap(),b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    for n in 0..1100 {post(&mut e,"a",&format!("p{n:04}"),n);}
    drain(&mut e);follow(&mut e,"r","a");drain(&mut e);
    let old=e.store().rows("feedEdges").unwrap()[0].field("epoch").unwrap().clone();
    run(&mut e,"unfollow","r",vec![("actor",id("a"))],2);follow(&mut e,"r","a");
    assert!(chunk(&mut e).is_some());drop(e);
    let mut e=Engine::open(Store::open(&path).unwrap()).unwrap();
    assert!(home(&mut e,"r").unavailable);drain(&mut e);assert_eq!(copies(&e,"r").len(),1100);
    assert!(e.store().rows("feedFeed").unwrap().iter().filter(|r|r.field("readerId").unwrap()==&id("r")).all(|r|r.field("epoch").unwrap()!=&old));
}

#[test]
fn scheduler_rotates_declarations_and_readers_under_hot_arrivals() {
    let src=source(true).replace("mutation post(","maintain other: timeline experimental history all\n  events posts where .parentId = null and not .removed by authorId, at removed by removed\n  reposts reposts by actorId, postId, at\n  edges follows by followerId, followedId\n\nmutation post(");
    let b=bound(&src);let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    for n in 0..600 {post(&mut e,"hot",&format!("p{n:04}"),n);}
    drain(&mut e);follow(&mut e,"r1","hot");follow(&mut e,"r2","hot");
    let mut selected=Vec::new();
    for n in 0..128 {
        post(&mut e,"hot",&format!("late{n:03}"),-n);
        chunk(&mut e).unwrap();selected.push(e.store().meta("experimental-history-last").unwrap().unwrap());
    }
    assert!(selected.windows(2).all(|p|p[0]!=p[1]),"{selected:?}");
    assert_eq!(pending(&e),0);assert_eq!(copies(&e,"r1").iter().filter(|s|s.starts_with('p')).count(),600);
    assert_eq!(copies(&e,"r2").iter().filter(|s|s.starts_with('p')).count(),600);
    drain(&mut e);
}

/// Seed ordinary source rows, then use the real atomic first-use launch. This
/// preserves event slots and real indexes without replaying 100k HTTP requests.
fn seeded(path: &std::path::Path, all: bool, hot:usize, quiet:usize) -> Engine {
    let src=source(all);let start=src.find("maintain feed:").unwrap();let end=src.find("mutation post(").unwrap();
    let before=format!("{}{}",&src[..start],&src[end..src.find("query home(").unwrap()]);
    let b=bound(&before);let mut e=Engine::new(Store::open(path).unwrap(),b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let rows=(0..hot).map(|n|("posts".into(),object([("id",id(&format!("p{n:06}"))),("authorId",id("hot")),("parentId",Value::Null),("at",Value::Int(n as i64)),("removed",Value::Bool(false))])))
        .chain((0..quiet).map(|n|("posts".into(),object([("id",id(&format!("q{n:06}"))),("authorId",id(&format!("a{n:06}"))),("parentId",Value::Null),("at",Value::Int(-1)),("removed",Value::Bool(false))]))));
    e.load(rows).unwrap();let b=bound(&src);e.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();e
}

#[test]
fn first_use_upgrade_copies_all_retained_under_existing_ceiling() {
    let mut e=seeded(&temp_path("launch"),true,1100,0);
    follow(&mut e,"r","hot");drain(&mut e);assert_eq!(copies(&e,"r").len(),1100);
    assert!(e.store().rows("posts").unwrap().iter().all(|r|r.field("$timeline:feed:post").unwrap()==&Value::Bool(true)));
    // The supported upgrade of a live v2 declaration is a fresh name. Its
    // existing slots and delivered history survive the all-history launch.
    let mut previous=seeded(&temp_path("side-by-side"),false,1200,0);
    follow(&mut previous,"r","hot");drain(&mut previous);
    let old=previous.store().rows("feedFeed").unwrap();assert_eq!(copies(&previous,"r").len(),1000);
    let all=source(true);let start=all.find("maintain feed:").unwrap();let end=all.find("mutation post(").unwrap();
    let src=source(false)+&all[start..end].replace("maintain feed:","maintain archive:");let b=bound(&src);
    previous.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    assert_eq!(previous.store().rows("feedFeed").unwrap(),old);
    assert_eq!(previous.store().rows("archiveFeed").unwrap().iter().filter(|r|r.field("readerId").unwrap()==&id("r")).count(),1200);
    assert!(previous.store().rows("posts").unwrap().iter().all(|r|r.field("$timeline:feed:post").unwrap()==&Value::Bool(true)&&r.field("$timeline:archive:post").unwrap()==&Value::Bool(true)));
}

#[test]
#[ignore = "scale measurement: 100k hot events and 16,385 quiet actors"]
fn measure_skew_and_more_than_16384_heads() {
    let out=std::env::var("FOLLOW_HISTORY_OUT").expect("FOLLOW_HISTORY_OUT");std::fs::create_dir_all(&out).unwrap();
    for all in [false,true] {
        let path=std::path::Path::new(&out).join(if all {"all.sqlite"} else {"window.sqlite"});
        let started=Instant::now();let mut e=seeded(&path,all,100_000,16_385);let seed_ms=started.elapsed().as_millis();
        e.store().conn().execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
        let bytes_before=std::fs::metadata(&path).unwrap().len();
        let start=Instant::now();follow(&mut e,"reader","hot");
        for n in 0..16_385 {follow(&mut e,"reader",&format!("a{n:06}"));}
        let admit_ms=start.elapsed().as_millis();let mut chunks=0;let mut examined=0;let mut writes=0;let mut max_examined=0;let mut max_heap=0;
        let start=Instant::now();
        while let Some(m)=chunk(&mut e) {
            chunks+=1;examined+=m.examined;writes+=m.rows_written;max_examined=max_examined.max(m.examined);max_heap=max_heap.max(m.heap_bytes);
            if chunks==10 {drop(e);e=Engine::open(Store::open(&path).unwrap()).unwrap();}
        }
        let complete_ms=start.elapsed().as_millis();assert!(home(&mut e,"reader").complete);
        let count=copies(&e,"reader").len();assert_eq!(count,if all {116_385}else{17_385});
        e.store().conn().execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
        let row_bytes:i64=e.store().conn().query_row("SELECT sum(length(data)) FROM r",[],|r|r.get(0)).unwrap();
        let feed_bytes:i64=e.store().conn().query_row("SELECT sum(length(data)) FROM r WHERE t=(SELECT num FROM _catalog WHERE name='feedFeed') AND json_extract(data,'$.Row.readerId.Id')='reader'",[],|r|r.get(0)).unwrap();
        let result=serde_json::json!({"all":all,"seed_ms":seed_ms,"admit_ms":admit_ms,"complete_ms":complete_ms,"chunks":chunks,"examined":examined,"writes":writes,"max_examined":max_examined,"max_heap":max_heap,"copies":count,"bytes_before":bytes_before,"database_bytes":std::fs::metadata(&path).unwrap().len(),"row_bytes":row_bytes,"reader_feed_bytes":feed_bytes});
        println!("MEASURE {result}");std::fs::write(std::path::Path::new(&out).join(if all {"all.json"} else {"window.json"}),serde_json::to_vec_pretty(&result).unwrap()).unwrap();
    }
}

#[test]
#[ignore = "read alternatives and cold device wire capture from the measured scale stores"]
fn measure_read_alternatives_and_device_pages() {
 use std::io::Write;
 let out=std::env::var("FOLLOW_HISTORY_OUT").expect("FOLLOW_HISTORY_OUT");
 if std::env::var_os("FOLLOW_HISTORY_ORACLE_ONLY").is_some() {
  let mut e=Engine::open(Store::open(&std::path::Path::new(&out).join("all.sqlite")).unwrap()).unwrap();
  let mut pages=Vec::new();let mut c=Value::Null;
  for _ in 0..200 {
   let q=e.query("home",Context::new("reader",[("c".into(),c)].into()).at(10010)).unwrap();assert!(q.complete&&!q.unavailable);
   pages.push(snapback4_core::wire::to_json(&q.data));match q.next {Some(next)=>c=Value::String(next),None=>break,}
  }
  std::fs::write(std::path::Path::new(&out).join("stress-pages.json"),serde_json::to_vec(&pages).unwrap()).unwrap();return;
 }
 for all in [false,true] {
  let name=if all {"all"}else{"window"};let path=std::path::Path::new(&out).join(format!("{name}.sqlite"));
  let mut e=Engine::open(Store::open(&path).unwrap()).unwrap();
  let source=source(all).replacen("sync public","sync public last 1000 by .at",2).replace("sync public\n\nmaintain feed","online only\n\nmaintain feed")+r#"
view activity:
  posts where not .removed { post: .id, actor: .authorId, at, repost: false }
  reposts { post: .postId, actor: .actorId, at, repost: true }
query planned(c: cursor ?):
  return activity where .actor = viewer or exists follows[viewer, .actor] last 20 by .at after c
query profile(actor: principal, c: cursor ?):
  return posts where .authorId = actor and not .removed last 20 by .at after c
"#;
  let b=bound(&source);e.adopt(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
  follow(&mut e,"sparse","a000000");drain(&mut e);
  let mut reads=Vec::new();
  for (op,who,args) in [("home","reader",vec![]),("planned","reader",vec![]),("planned","sparse",vec![]),("profile","reader",vec![("actor",id("a000000"))])] {
   let now=Instant::now();let q=e.query(op,Context::new(who,args.into_iter().map(|(k,v)|(k.into(),v)).collect())).unwrap();
   reads.push(serde_json::json!({"op":op,"viewer":who,"wall_us":now.elapsed().as_micros(),"rows":q.data.as_array().map_or(0,|r|r.len()),"unavailable":q.unavailable,"complete":q.complete,"continuation":q.next.is_some(),"metered":q.metered}));
  }
  // Traversal costs on a quiet store, without claiming a frozen current-membership domain.
  for op in ["home","planned"] {
   let now=Instant::now();let mut c=Value::Null;let mut rows=0;let mut examined=0;let mut complete=true;let mut pages=0;
   loop {let q=e.query(op,Context::new("reader",[("c".into(),c)].into())).unwrap();rows+=q.data.as_array().map_or(0,|r|r.len());examined+=q.metered.examined;pages+=1;
    if !q.complete || q.unavailable {complete=false;break;}match q.next {Some(next)=>c=Value::String(next),None=>break,}
   }
   reads.push(serde_json::json!({"traverse":op,"wall_ms":now.elapsed().as_millis(),"rows":rows,"examined":examined,"pages":pages,"complete":complete}));
  }
  std::fs::write(std::path::Path::new(&out).join(format!("{name}-reads.json")),serde_json::to_vec_pretty(&reads).unwrap()).unwrap();
  let mut writer=std::io::BufWriter::new(std::fs::File::create(std::path::Path::new(&out).join(format!("{name}-cold.ndjson"))).unwrap());
  let backend=snapback4_device::device::Backend{generation:e.generation(),schema:b.schema,programs:b.programs.into_iter().map(|p|p.program).collect()};
  writeln!(writer,"{}",serde_json::json!({"backend":backend})).unwrap();
  let mut after:Option<String>=None;let mut wire_bytes=0;let now=Instant::now();let mut pages=0;
  loop {
   let p=e.snapshot_acquisition_page_at("reader",after.as_deref(),500,10000).unwrap();let next=p.next.map(|n|n.encode());
   let page=serde_json::json!({"snapshot":true,"after":after,"held":p.held,"acquisitions":p.acquisitions,"events":p.events.iter().map(|ev|serde_json::json!({"table":ev.table,"kind":ev.kind.word(),"id":ev.id,"data":ev.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),"watermark":p.watermark,"more":next.is_some(),"next":next,"generation":e.generation()});
   let line=serde_json::to_string(&page).unwrap();wire_bytes+=line.len();writeln!(writer,"{line}").unwrap();pages+=1;
   match next {Some(n)=>after=Some(n),None=>break,}
  }
  let result=serde_json::json!({"pages":pages,"wire_bytes":wire_bytes,"server_ms":now.elapsed().as_millis()});
  println!("COLD {name} {result}");std::fs::write(std::path::Path::new(&out).join(format!("{name}-cold.json")),serde_json::to_vec_pretty(&result).unwrap()).unwrap();
 }
}

#[test]
#[ignore = "100k stress: serving-sized slices, births, deletion, repeated edge epochs, restart and halfway wire capture"]
fn stress_scale_with_short_slices() {
 use std::io::Write;
 let out=std::env::var("FOLLOW_HISTORY_OUT").expect("FOLLOW_HISTORY_OUT");let path=std::path::Path::new(&out).join("all.sqlite");
 let mut e=Engine::open(Store::open(&path).unwrap()).unwrap();
 run(&mut e,"unfollow","reader",vec![("actor",id("hot"))],10000);follow(&mut e,"reader","hot");
 let mut capture=std::io::BufWriter::new(std::fs::File::create(std::path::Path::new(&out).join("stress-device.ndjson")).unwrap());
 let mut halfway=false;let mut watermark=0;let mut turns=0;let mut births=0;let mut examined=0;let mut writes=0;let started=Instant::now();let mut half_ms=0;
 while let Some(m)=e.run_timeline_chunk_for(10001,Duration::from_millis(2)).unwrap() {
  turns+=1;examined+=m.examined;writes+=m.rows_written;
  assert!(m.examined<=16384 && m.index_entries<=16384);
  if turns%64==0 && pending(&e)>0 {post(&mut e,"hot",&format!("stress{births:05}"),-10000-births);births+=1;}
  if !halfway && turns%128==0 {
   let epoch=e.store().rows("feedEdges").unwrap().into_iter().find(|r|r.field("readerId").unwrap()==&id("reader")&&r.field("actorId").unwrap()==&id("hot")).unwrap().field("epoch").unwrap().clone();
   let prefix=snapback4_core::key::encode(&[id("reader"),id("hot"),epoch]);let upper=snapback4_core::key::upper_bound(&prefix);
   let count:i64=e.store().conn().query_row("SELECT count(*) FROM i WHERE ti=(SELECT num FROM _catalog WHERE name='feedFeed.byReaderActor') AND k>=?1 AND k<?2",rusqlite::params![prefix,upper],|r|r.get(0)).unwrap();
   if count>=50_000 {
    half_ms=started.elapsed().as_millis();halfway=true;
    let backend=snapback4_device::device::Backend{generation:e.generation(),schema:e.schema().clone(),programs:e.programs().cloned().collect()};
    writeln!(capture,"{}",serde_json::json!({"backend":backend})).unwrap();let mut after:Option<String>=None;
    loop {let p=e.snapshot_acquisition_page_at("reader",after.as_deref(),500,10001).unwrap();let next=p.next.map(|n|n.encode());watermark=p.watermark;
     writeln!(capture,"{}",serde_json::json!({"snapshot":true,"after":after,"held":p.held,"acquisitions":p.acquisitions,"events":p.events.iter().map(|ev|serde_json::json!({"table":ev.table,"kind":ev.kind.word(),"id":ev.id,"data":ev.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),"watermark":p.watermark,"more":next.is_some(),"next":next,"generation":e.generation()})).unwrap();match next {Some(n)=>after=Some(n),None=>break,}
    }
    writeln!(capture,"{}",serde_json::json!({"check":"pending"})).unwrap();
    for event in ["p000007","p050500"] {run(&mut e,"remove","hot",vec![("postId",id(event))],10002);}
    run(&mut e,"unfollow","reader",vec![("actor",id("hot"))],10003);follow(&mut e,"reader","hot");
    drop(e);e=Engine::open(Store::open(&path).unwrap()).unwrap();
   }
  }
  assert!(turns<300_000);
 }
 assert!(halfway);assert_eq!(copies(&e,"reader").len(),116385-2+births as usize);
 assert!(home(&mut e,"reader").complete);let drain_ms=started.elapsed().as_millis();let mut stream_bytes=0;let mut pages=0;
 loop {let p=e.stream("reader",watermark,1000).unwrap();let next=p.watermark;
  let line=serde_json::to_string(&serde_json::json!({"snapshot":false,"requested_watermark":watermark,"images_at":p.images_at,"joined":p.joined,"acquisitions":p.acquisitions,"events":p.events.iter().map(|ev|serde_json::json!({"table":ev.table,"kind":ev.kind,"id":ev.id,"data":ev.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),"watermark":p.watermark,"more":p.more,"generation":e.generation()})).unwrap();stream_bytes+=line.len();writeln!(capture,"{line}").unwrap();watermark=next;pages+=1;if !p.more {break;}}
 let expected=snapback4_core::wire::to_json(&home(&mut e,"reader").data);writeln!(capture,"{}",serde_json::json!({"check":"complete","expected":expected})).unwrap();
 let result=serde_json::json!({"turns":turns,"births":births,"examined":examined,"writes":writes,"half_ms":half_ms,"drain_ms":drain_ms,"stream_bytes":stream_bytes,"stream_pages":pages});
 println!("STRESS {result}");std::fs::write(std::path::Path::new(&out).join("stress.json"),serde_json::to_vec_pretty(&result).unwrap()).unwrap();
}

#[test]
fn prototype_raw_reads_withhold_and_cannot_supply_write_authority() {
 let src=source(true)+r#"
query point(copy: id):
  return feedFeed[copy]
query required(copy: id):
  return feedFeed[copy] ! else MISSING
query byActor(actor: principal):
  return feedFeed[readerId = viewer, actorId = actor] first 20 by byReaderActor
mutation depends(copy: id):
  require not exists feedFeed[copy] else PRESENT
  return true
"#;
 let b=bound(&src);let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
 for n in 0..60 {post(&mut e,"a",&format!("p{n:03}"),n);}drain(&mut e);follow(&mut e,"r","a");
 for op in ["point","required"] {let q=e.query(op,Context::new("r",[("copy".into(),id("missing"))].into())).unwrap();assert!(q.unavailable&&!q.complete);assert_eq!(q.data,Value::Null);assert!(q.next.is_none());}
 let q=e.query("byActor",Context::new("r",[("actor".into(),id("a"))].into())).unwrap();assert!(q.unavailable&&!q.complete);assert!(q.next.is_none());
 let o=e.mutate("depends",None,Context::new("r",[("copy".into(),id("missing"))].into())).unwrap();assert!(matches!(o.state,WriteState::Failed{..}));
}

#[test]
fn first_use_with_existing_follows_and_all_history_ceiling() {
 let src=source(true);let start=src.find("maintain feed:").unwrap();let end=src.find("mutation post(").unwrap();
 let bare=format!("{}{}",&src[..start],&src[end..src.find("query home(").unwrap()]);
 for edges in [1,4200] {
  let b=bound(&bare);let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
  let rows=(0..1200).map(|n|("posts".into(),object([("id",id(&format!("p{n}"))),("authorId",id("a")),("parentId",Value::Null),("at",Value::Int(n)),("removed",Value::Bool(false))])))
   .chain((0..edges).map(|n|("follows".into(),object([("id",id(&format!("f{n}"))),("followerId",id(&format!("r{n}"))),("followedId",id("a"))]))));
  e.load(rows).unwrap();let before=e.store().rows("posts").unwrap();let b=bound(&src);
  let result=e.adopt(b.schema,b.programs.into_iter().map(|p|p.program));
  if edges==1 {result.unwrap();assert_eq!(copies(&e,"r0").len(),1200);assert!(home(&mut e,"r0").complete);}
  else {let error=result.unwrap_err().to_string();assert!(error.contains("5041200")&&error.contains("5000000"),"{error}");assert_eq!(before,e.store().rows("posts").unwrap());assert!(e.schema().timelines.is_empty());}
 }
}
