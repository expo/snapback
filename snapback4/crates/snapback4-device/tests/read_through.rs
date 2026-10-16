//! The same read-through scenarios on native SQLite and the wasm memory adapter.
mod common;
use common::*;
use snapback4_core::{Context, Engine};
use snapback4_device::{device::{Backend, Device, StreamPage}, store::DeviceStore};
use serde_json::{Value as Json, json};
const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/read-through-device.q");
// These runtime scenarios retain the old externally supplied upsert arm;
// Quarry source now refuses an unproved write to its immutable task column.
fn compile_external_fixture(source: &str) -> (Engine, Backend) {
    use snapback4_core::ir::{Expr, Stmt};
    let (_, mut backend) = compile(source);
    for program in &mut backend.programs {
        if program.name != "put" { continue; }
        for statement in &mut program.body {
            if let Stmt::WriteTarget { patch: Expr::Object(fields), .. } = statement {
                fields.insert("task".into(), Expr::Variable("task".into()));
            }
        }
    }
    let engine = Engine::memory(backend.schema.clone(),backend.programs.clone()).unwrap();
    backend.generation = engine.generation();
    (engine,backend)
}
fn setup(source: &str) -> (Engine, Backend) {
    let (mut engine, backend) = compile_external_fixture(source);
    let sent = engine.mutate("setup", None, Context::new("alice", args(&[("org",id("o")),("project",id("p")),("task",id("t")),("until",snapback4_core::value::Value::Null)])).at(100));
    assert!(sent.is_ok(), "{sent:?}");
    (engine,backend)
}
fn acquire<S: DeviceStore>(engine: &mut Engine, device: &mut Device<S>, now:i64) {
    let mut after = None;
    let mut first = true;
    loop {
        let page = engine.snapshot_acquisition_page_at("alice", after.as_deref(), 100, now).unwrap();
        let next=page.next.map(|n|n.encode());
        let page:StreamPage=serde_json::from_value(json!({"snapshot":true,"after":after,"held":page.held,"acquisitions":page.acquisitions,"events":page.events.iter().map(|e|json!({"table":e.table,"kind":e.kind.word(),"id":e.id,"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),"watermark":page.watermark,"more":next.is_some(),"next":next,"generation":engine.generation()})).unwrap();
        device.apply(&page,first).unwrap();
        if next.is_none(){break;} after=next;first=false;
    }
}
fn query<S:DeviceStore>(device:&mut Device<S>,name:&str,task:&str,now:i64)->Json {
    snapback4_device::call::call(device,json!({"op":"query","name":name,"viewer":"alice","args":{"task":task},"now":now}))["ok"].clone()
}
fn run<H:Host>(host:&mut H) {
    let (mut engine,backend)=setup(SOURCE);
    for name in ["orgs","projects","tasks","comments"] {assert!(backend.schema.tables[name].sync.is_some(),"{name}");}
    let mut device=host.open("through",Some(backend)).unwrap();
    acquire(&mut engine,&mut device,100);
    let predicted=device.predict("post","alice",&json!({"id":"c","task":"t","body":"hello"}),100,vec![],1).unwrap();
    assert_eq!(predicted.predicted,vec!["comments/c"]);
    let page=query(&mut device,"page","t",100);
    assert_eq!(page["complete"],true,"{page}");assert_eq!(page["unknown"],false,"{page}");
    assert_eq!(page["data"][0]["id"],"c","{page}");
    assert!(!page.to_string().contains("$task"));
    let unknown=query(&mut device,"page","unheld",100);
    assert_eq!(unknown["complete"],false,"{unknown}");assert_eq!(unknown["unknown"],true,"{unknown}");
    assert!(device.predict("post","alice",&json!({"id":"miss","task":"unheld","body":"hello"}),100,vec![],1).unwrap_err().code()=="E_PREDICT");
    assert!(device.predict("put","alice",&json!({"id":"c","task":"t"}),100,vec![],1).is_ok(), "an already held child predicts its update");
    assert_eq!(device.predict("maybe","alice",&json!({"id":"c","task":"t"}),100,vec![],1).unwrap_err().code(),"E_PREDICT");
    let count=query(&mut device,"countFor","t",100);
    assert_eq!(count["data"],1,"{count}");assert_eq!(count["complete"],true,"{count}");
    let unknown=query(&mut device,"countFor","unheld",100);
    assert_ne!(unknown["data"],json!(0),"{unknown}");assert_eq!(unknown["unknown"],true,"{unknown}");
    host.close("through",device);
}
#[test]fn chain_memory(){run(&mut Memory::new());}
#[test]fn chain_sqlite(){run(&mut Sqlite::new("through"));}

fn write(e:&mut Engine,op:&str,values:&[(&str,snapback4_core::Value)]) {
    let outcome=e.mutate(op,None,Context::new("alice",args(values)).at(100)).unwrap();
    assert!(matches!(outcome.state,snapback4_core::engine::WriteState::Sent{..}),"{outcome:?}");
}
fn queued<S:DeviceStore>(d:&mut Device<S>,op:&str,input:Json,key:&str)->snapback4_device::device::Queued {
    d.admit(serde_json::from_value(json!({"id":key,"seq":0,"op":op,"args":input,"viewer":"alice","now":100,"predictable":true})).unwrap()).unwrap()
}
fn prediction<H:Host>(host:&mut H) {
    let source=format!("{SOURCE}\nmutation mintTask(project: projects):\n  insert tasks {{id: new, project}}\n");
    let (mut e,b)=setup(&source);
    let mut d=host.open("predict",Some(b)).unwrap();acquire(&mut e,&mut d,100);
    let miss=queued(&mut d,"post",json!({"id":"miss","task":"unheld","body":"pending"}),"w0");
    assert!(!miss.predictable && miss.predicted.is_empty());
    let supplied=queued(&mut d,"newTask",json!({"id":"supplied","project":"p"}),"w1");
    assert!(!supplied.predictable && supplied.predicted.is_empty(),"an arbitrary id cannot prove the absence of a hidden expired predecessor: {supplied:?}");
    let mut minted: snapback4_device::device::Queued=serde_json::from_value(json!({"id":"w2","seq":0,"op":"mintTask","args":{"project":"p"},"viewer":"alice","now":100,"predictable":true})).unwrap();
    minted.new_ids=vec!["new".into()];
    let parent=d.admit(minted).unwrap();
    assert!(parent.predictable,"{parent:?}");
    assert_eq!(parent.predicted,["tasks/new"]);
    let child=queued(&mut d,"post",json!({"id":"new-comment","task":"new","body":"pending"}),"w3");
    assert!(child.predictable,"{child:?}");
    let page=query(&mut d,"page","new",100);
    assert_eq!(page["data"][0]["id"],"new-comment","{page}");
    assert_eq!(page["complete"],false,"predicted parent grants no child coverage: {page}");
    assert_eq!(page["unknown"],true,"{page}");
    d.settle("w2",None).unwrap();
    let page=query(&mut d,"page","new",100);
    assert_eq!(page["data"],json!([]),"refused parent replays child: {page}");
    assert!(d.queued().unwrap().iter().find(|q|q.id=="w3").unwrap().predicted.is_empty());
    host.close("predict",d);
}
fn deletes<H:Host>(host:&mut H) {
    for horizon in [false,true] {
        let source=if horizon { SOURCE.replace("  update <- allow\n  delete <- allow\n  sync","  update <- allow\n  delete <- allow\n  sync last 2 by .at") }else{ SOURCE.into() };
        let(mut e,b)=setup(&source);let mut d=host.open(if horizon{"horizon"}else{"whole"},Some(b)).unwrap();acquire(&mut e,&mut d,100);
        let result=d.predict("dropTask","alice",&json!({"id":"t"}),100,vec![],1);
        if horizon {assert!(matches!(result,Err(snapback4_core::error::RuntimeError::Prediction(_))),"{result:?}");
            let count=query(&mut d,"countFor","t",100);assert_eq!(count["data"],Json::Null,"unknown child coverage cannot become zero: {count}");assert_eq!(count["unknown"],true,"{count}");
        }
        else {assert!(result.is_ok(),"{result:?}");}
    }
    let(mut e,b)=setup(SOURCE);write(&mut e,"post",&[("id",id("c")),("task",id("t")),("body",snapback4_core::Value::String("held".into()))]);
    let mut d=host.open("occupied",Some(b)).unwrap();acquire(&mut e,&mut d,100);
    assert_eq!(d.predict("dropTask","alice",&json!({"id":"t"}),100,vec![],1).unwrap_err().code(),"E_PARENT_HAS_CHILDREN");
}
fn expiry<H:Host>(host:&mut H) {
    let (mut e,b)=compile_external_fixture(SOURCE);
    write(&mut e,"setup",&[("org",id("o")),("project",id("p")),("task",id("t")),("until",snapback4_core::Value::Int(300))]);
    write(&mut e,"post",&[("id",id("c")),("task",id("t")),("body",snapback4_core::Value::String("expires".into()))]);
    assert!(b.schema.tables["projects"].expire.is_none() && b.schema.tables["projects"].is_expiring());
    let mut d=host.open("expiry",Some(b)).unwrap();acquire(&mut e,&mut d,100);
    let before=query(&mut d,"page","t",200);assert_eq!(before["data"][0]["id"],"c","{before}");assert_eq!(before["nextExpiry"],300,"{before}");
    assert_eq!(query(&mut d,"countFor","t",200)["data"],1);
    let (watermark,generation)=d.state().unwrap();
    let page:StreamPage=serde_json::from_value(json!({"snapshot":false,"events":[],"watermark":watermark,"more":false,"generation":generation,"now":400})).unwrap();
    let touched=d.apply(&page,false).unwrap();assert!(touched.contains(&"comments".into()));
    let after=query(&mut d,"page","t",200);assert_eq!(after["data"],json!([]),"{after}");assert_eq!(after["complete"],true,"{after}");assert_eq!(after["nextExpiry"],Json::Null,"{after}");
    assert_eq!(query(&mut d,"countFor","t",200)["data"],Json::Null);
    assert!(queued(&mut d,"post",json!({"id":"late","task":"t","body":"late"}),"late").predicted.is_empty());
    let mut older=page.clone();older.now=Some(150);d.apply(&older,false).unwrap();
    host.close("expiry",d);let mut reopened=host.open("expiry",None).unwrap();
    assert_eq!(query(&mut reopened,"page","t",100)["data"],json!([]));
}
fn reused<H:Host>(host:&mut H) {
    for retained in [false,true] {
        let source=if retained{SOURCE.replace("table comments:","table comments:\n  retain delivered-history")}else{SOURCE.into()};
        let source=format!("{source}\nmutation dropComment(id: comments):\n  delete comments[id]\nquery shaped(task: tasks):\n  comments where .task = task first 10 by .at {{id, body}}\nquery spread(task: tasks):\n  rows = comments where .task = task first 10 by .at\n  result = []\n  for c in rows:\n    result = result + [{{ ...c, ...(c {{ body }}) }}]\n  return result\n");
        let(mut e,b)=setup(&source);
        write(&mut e,"post",&[("id",id("c")),("task",id("t")),("body",snapback4_core::Value::String("old".into()))]);
        let mut d=host.open(if retained{"history"}else{"reuse"},Some(b)).unwrap();acquire(&mut e,&mut d,100);
        write(&mut e,"dropComment",&[("id",id("c"))]);write(&mut e,"dropTask",&[("id",id("t"))]);
        write(&mut e,"setup",&[("org",id("o2")),("project",id("p2")),("task",id("other")),("until",snapback4_core::Value::Null)]);
        write(&mut e,"newTask",&[("id",id("t")),("project",id("p2"))]);
        let page=e.snapshot_acquisition_page_at("alice",None,100,100).unwrap();
        let mut events:Vec<_>=page.events.iter().filter(|row| row.table!="comments" && row.table!="totals").map(|row|json!({"table":row.table,"kind":"put","id":row.id,"data":row.data.as_ref().map(snapback4_core::wire::to_json)})).collect();
        if retained {events.push(json!({"table":"comments","kind":"scope","id":"scope","data":["o"]}));}
        let page:StreamPage=serde_json::from_value(json!({"snapshot":false,"events":events,"watermark":page.watermark,"more":false,"generation":e.generation()})).unwrap();
        d.apply(&page,false).unwrap();
        for name in ["page","search","shaped","spread"] {
        let answer=query(&mut d,name,"t",100);
        assert_eq!(answer["unknown"],true,"{answer}");assert_eq!(answer["complete"],false,"{answer}");
        if retained {assert_eq!(answer["data"][0]["id"],"c","{answer}");assert_eq!(answer["data"][0]["retained"],true,"{answer}");assert_eq!(answer["retainedRows"][0]["retained"],true,"{answer}");assert_eq!(answer["retainedRows"][0]["source"],json!(["comments","c"]),"{answer}");}
        else {assert_eq!(answer["data"],json!([]),"mismatched current child stays out: {answer}");assert!(answer.get("retainedRows").is_none(),"{answer}");}
        }
        let count=query(&mut d,"countFor","t",100);assert_eq!(count["data"],Json::Null,"{count}");assert_eq!(count["unknown"],true,"{count}");
    }
}
macro_rules! both {($name:ident,$case:ident)=>{#[test]fn $name(){ $case(&mut Memory::new());$case(&mut Sqlite::new(stringify!($name))); }};}
both!(pending_chain_and_queue,prediction);
both!(parent_delete_coverage,deletes);
both!(inherited_expiry_and_monotone_clock,expiry);
both!(reused_parent_capture_and_retained_history,reused);

fn staged_clock<H:Host>(host:&mut H) {
    let (mut e,b)=compile_external_fixture(SOURCE);
    write(&mut e,"setup",&[("org",id("o")),("project",id("p")),("task",id("t")),("until",snapback4_core::Value::Int(300))]);
    let mut d=host.open("staged-clock",Some(b)).unwrap();acquire(&mut e,&mut d,100);
    assert!(queued(&mut d,"post",json!({"id":"pending","task":"t","body":"pending"}),"queued").predictable);
    let page=e.snapshot_acquisition_page_at("alice",None,100,100).unwrap();
    let mut page:StreamPage=serde_json::from_value(json!({"snapshot":true,"held":page.held,"acquisitions":page.acquisitions,"events":page.events.iter().map(|e|json!({"table":e.table,"kind":e.kind.word(),"id":e.id,"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),"watermark":page.watermark,"more":false,"generation":e.generation(),"stage_snapshot":true,"now":400})).unwrap();
    d.apply(&page,true).unwrap();
    assert_eq!(query(&mut d,"page","t",200)["data"][0]["id"],"pending","staged clock must not expire the visible prediction");
    page.snapshot=false;page.snapshot_catchup=true;page.events.clear();page.acquisitions.clear();page.held=None;
    d.apply(&page,false).unwrap();
    assert_eq!(query(&mut d,"page","t",200)["data"],json!([]),"publication advances the clock before prediction replay");
    let queued=d.queued().unwrap();assert_eq!(queued.len(),1);assert!(queued[0].predicted.is_empty(),"{queued:?}");
    let mut invalid=page.clone();invalid.snapshot_catchup=false;invalid.now=Some(9007199254740992);
    assert!(d.apply(&invalid,false).is_err());
    assert_eq!(d.store().meta("device:expiry-clock").unwrap().as_deref(),Some("400"),"invalid changes roll back their clock");
}
both!(clock_publication_and_replay_are_atomic,staged_clock);

fn retained_parent<H:Host>(host:&mut H) {
    let source=SOURCE.replace("table tasks:","table tasks:\n  retain delivered-history");
    let(mut e,b)=setup(&source);let mut d=host.open("retained-parent",Some(b)).unwrap();acquire(&mut e,&mut d,100);
    let(watermark,generation)=d.state().unwrap();
    let page=serde_json::from_value(json!({"snapshot":false,"events":[{"table":"tasks","kind":"scope","id":"left","data":["o"]}],"watermark":watermark,"generation":generation,"more":false})).unwrap();
    d.apply(&page,false).unwrap();
    let entry=queued(&mut d,"post",json!({"id":"queued","task":"t","body":"retained parent"}),"retained");
    assert!(!entry.predictable && entry.predicted.is_empty(),"{entry:?}");
    let page=query(&mut d,"page","t",100);assert_eq!(page["unknown"],true,"{page}");assert_eq!(page["data"],json!([]),"{page}");
}
both!(retained_parent_queues_without_a_row,retained_parent);

fn nonexpiring_scratch<H:Host>(host:&mut H) {
    let source=SOURCE.replace("  expire at .until\n", "").replace("text <= 40", "text <= 200000");
    let mut replies=Vec::new();
    for occupied in [false,true] {
        let(mut e,b)=setup(&source);assert!(!b.schema.tables["comments"].is_expiring());
        if occupied {write(&mut e,"post",&[("id",id("c")),("task",id("t")),("body",snapback4_core::Value::String("small actual row".into()))]);}
        let mut d=host.open(if occupied {"scratch-live"}else{"scratch-empty"},Some(b)).unwrap();acquire(&mut e,&mut d,100);
        let result=d.query("countFor","alice",&json!({"task":"t"}),100).unwrap();
        assert!(result.unavailable && !result.complete,"recount reserves its source batch before discovering occupancy: {result:?}");
        assert!(matches!(result.capped_at.as_ref(),Some((snapback4_core::error::MeterKind::HeapBytes,_))),"{result:?}");
        assert_eq!(result.metered.examined,0,"{result:?}");
        replies.push(result);
    }
    assert_eq!(replies[0],replies[1]);
}
both!(nonexpiring_parent_counts_reserve_source_scratch,nonexpiring_scratch);
