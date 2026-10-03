//! Real acquisition/stream fences over unfinished opt-in history.
// @ref LLP 3000.016.000#4-publication-and-devices — work cannot retire ahead of above-floor copies.
mod common;
use common::{Host, Memory, Sqlite, BoundaryMetadata, snapshot_pages};
use snapback4_core::{Context, Engine, Store, Value, WriteState};
use snapback4_device::device::{Backend, StreamPage};
use serde_json::{json, Value as Json};
use std::time::Duration;
fn write(e:&mut Engine,op:&str,actor:&str,args:Vec<(&str,Value)>,time:i64){
 let r=e.mutate(op,None,Context::new(actor,args.into_iter().map(|(k,v)|(k.into(),v)).collect()).at(time)).unwrap();assert!(matches!(r.state,WriteState::Sent{..}),"{r:?}");
}
fn post(e:&mut Engine,name:&str,time:i64){write(e,"post","hot",vec![("postId",common::id(name)),("parentId",Value::Null)],time);}
fn chunk(e:&mut Engine)->bool {e.run_timeline_chunk_for(10000,Duration::from_secs(1)).unwrap().is_some()}
fn drain(e:&mut Engine){while chunk(e){}}
fn stream(e:&mut Engine,watermark:u64)->StreamPage {
 let p=e.stream("reader",watermark,1).unwrap();
 serde_json::from_value(json!({"snapshot":false,"requested_watermark":watermark,"images_at":p.images_at,"joined":p.joined,"acquisitions":p.acquisitions,"events":p.events.iter().map(|ev|json!({"table":ev.table,"kind":ev.kind,"id":ev.id,"data":ev.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),"watermark":p.watermark,"more":p.more,"generation":e.generation()})).unwrap()
}
fn witness<H:Host>(mut host:H,export:bool){
 let source=include_str!("../../snapback4-lang/tests/fixtures/timeline-v2.q")
    .replace("maintain feed: timeline","maintain feed: timeline experimental history all")
    .replacen("sync public","sync public last 100 by .at",2)
    .replace("sync public\n\nmaintain feed", "online only\n\nmaintain feed");
 let b=snapback4_lang::compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let server_host=Sqlite::new("history-server");let path=server_host.path("server");
 let mut e=Engine::new(Store::open(&path).unwrap(),b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
 let backend=Backend{generation:e.generation(),schema:b.schema,programs:b.programs.into_iter().map(|p|p.program).collect()};
 // Birth and timestamp order differ, with ties and a quiet actor.
 for n in 0..2500 {post(&mut e,&format!("p{n:04}"),(n*73%2500) / 2);}
 write(&mut e,"post","quiet",vec![("postId",common::id("quiet")),("parentId",Value::Null)],1);
 drain(&mut e);
 for actor in ["hot","quiet"] {write(&mut e,"follow","reader",vec![("actor",common::id(actor))],3000);}
 for _ in 0..6 {assert!(chunk(&mut e));}
 let mut d=host.open("reader",Some(backend.clone())).unwrap();let mut steps=Vec::<Json>::new();let mut wire_bytes=0;
 for (n,p) in snapshot_pages(&mut e,"reader",137).iter().enumerate(){
   d.apply(p,n==0).unwrap();let action=json!({"op":"apply","page":p,"first":n==0});wire_bytes+=serde_json::to_vec(&action).unwrap().len();steps.push(action);
 }
 assert!(d.query("home","reader",&json!({"c":null}),4000).unwrap().unavailable);
 steps.push(json!({"check":"pending"}));
 assert_eq!(d.store().raw_rows("feedFeed").len(),1000);
 // Cancellation, old cleanup and fresh epochs overlap the acquired floor.
 write(&mut e,"unfollow","reader",vec![("actor",common::id("hot"))],4001);
 write(&mut e,"follow","reader",vec![("actor",common::id("hot"))],4002);
 write(&mut e,"remove","hot",vec![("postId",common::id("p2499"))],4003);
 for n in 0..8 {post(&mut e,&format!("late{n}"),-1000-n);assert!(chunk(&mut e));}
 drop(e);let mut e=Engine::open(Store::open(&path).unwrap()).unwrap();drain(&mut e);
 let server=e.query("home",Context::new("reader",Default::default()).at(5000)).unwrap();assert!(server.complete);
 let expected=snapback4_core::wire::to_json(&server.data);
 let mut pages=0;
 loop {
   let p=stream(&mut e,d.sync_state().unwrap().transfer_watermark);let more=p.more;
   d.apply(&p,false).unwrap();steps.push(json!({"op":"apply","page":p,"first":false}));
   let q=d.query("home","reader",&json!({"c":null}),5000).unwrap();
   let must_withhold=p.images_at.is_some_and(|head|head>p.watermark);
   if must_withhold {assert!(q.unavailable,"normalized retirement cannot publish before its image fence");}
   if q.complete && !q.unavailable {assert_eq!(snapback4_core::wire::to_json(&q.data),expected,"premature complete page at {pages}");}
   steps.push(json!({"check":"honest","mustWithhold":must_withhold}));pages+=1;
   if pages==2 {host.close("reader",d);d=host.open("reader",None).unwrap();steps.push(json!({"reopen":true}));}
   if !more {break;}assert!(pages<200);
 }
 let q=d.query("home","reader",&json!({"c":null}),5000).unwrap();assert!(q.complete&&!q.unavailable,"{q:?}");
 assert_eq!(snapback4_core::wire::to_json(&q.data),expected);
 assert!(!d.store().raw_rows("feedFeed").iter().any(|r|r.field("eventId").unwrap()==&common::id("p2499")));
 // The fixed acquisition floor was not silently expanded to the whole archive.
 let mut cursor=q.next;let mut withheld=false;
 while let Some(c)=cursor {let q=d.query("home","reader",&json!({"c":c}),5000).unwrap();if q.unavailable {withheld=true;break;}cursor=q.next;}
 assert!(withheld,"old archive pages must cross the fixed floor");
 steps.push(json!({"check":"complete"}));
 if export {
   let out=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/following-history-device.json");
   std::fs::write(out,serde_json::to_vec(&json!({"backend":backend,"steps":steps,"expected":expected,"snapshotWireBytes":wire_bytes})).unwrap()).unwrap();
 }
}
#[test] fn memory_history_halfway_with_refollow_removal_restart(){witness(Memory::new(),true);}
#[test] fn sqlite_history_halfway_with_refollow_removal_restart(){witness(Sqlite::new("history-device"),false);}
