//! Acquisition/stream/reopen interleavings against the full-snapshot oracle.
use serde_json::json;
use snapback4_core::{Context, Engine, Value, value::object};
use snapback4_device::{device::{Backend, Device, StreamPage}, memory::MemoryStore};
use std::collections::BTreeMap;

const SOURCE: &str = r#"
table inbox:
  label: text <=20
  public 'simulation'
  sync public
table messages:
  n: int
  public 'simulation'
  insert <- allow
  update <- allow
  delete <- allow
  sync public last 10 by .n, .id
query inbox():
  return inbox first 10 by .id
query history():
  return messages last 10 by .n, .id
mutation move(m: messages):
  update messages[m] {n: 9}
mutation remove(m: messages):
  delete messages[m]
mutation add():
  insert messages {n: 12}
"#;
fn setup() -> (Engine, Backend) {
    let b = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    let mut e = Engine::memory(b.schema.clone(), b.programs.iter().map(|p|p.program.clone())).unwrap();
    let b = Backend { generation: e.generation(), schema:b.schema, programs:b.programs.into_iter().map(|p|p.program).collect() };
    e.seed_at([("inbox".into(), object([("id",Value::Id("box".into())),("label",Value::String("box".into()))]))],100).unwrap();
    for n in 0..3 { e.seed_at([("messages".into(),object([("id",Value::Id(format!("m{n}"))),("n",Value::Int(n))]))],100).unwrap(); }
    (e,b)
}
fn wire(p: snapback4_core::partition::StreamPage) -> serde_json::Value {
    json!({"snapshot":false,"watermark":p.watermark,"images_at":p.images_at,"more":p.more,"acquisitions":p.acquisitions,"joined":p.joined,
        "events":p.events.iter().map(|e|json!({"table":e.table,"kind":e.kind,"id":e.id,"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>()})
}
fn acquisition(e: &mut Engine, d: &mut Device<MemoryStore>) -> StreamPage {
    let s=d.sync_state().unwrap();
    let p=e.acquisition_page_at("alice",s.acquisition_cursor.as_deref(),None,&[],s.transfer_watermark,1,100,&s.pending_ids).unwrap();
    let mut w=wire(p.page); w["acquire"]=serde_json::to_value(p.acquire).unwrap(); w["requested_watermark"]=json!(s.transfer_watermark);
    serde_json::from_value(w).unwrap()
}
fn catchup(e: &mut Engine,d: &mut Device<MemoryStore>) {
    loop {
        let s=d.sync_state().unwrap();let p=e.certified_stream_at("alice",s.transfer_watermark,1,100,&s.pending_ids).unwrap();
        let mut w=wire(p.page);w["requested_watermark"]=json!(s.transfer_watermark);
        let p:StreamPage=serde_json::from_value(w).unwrap(); d.apply(&p,false).unwrap();
        if !p.more {check(e,d);break;}
    }
}
fn check(e:&mut Engine,d:&mut Device<MemoryStore>) {
    for op in ["inbox","history"] {
        let (answer,unknown,_)=d.query_with_coverage(op,"alice",&json!({}),100);
        if let Ok(answer)=answer && answer.complete && !unknown {
            let truth=e.query(op,Context::new("alice",BTreeMap::new()).at(100)).unwrap();
            assert_eq!(answer.data,truth.data,"a complete local answer differs at a publication boundary");
        }
    }
}
fn reopen(d:Device<MemoryStore>)->Device<MemoryStore> {
    let mut store=MemoryStore::new();store.load(d.store().export()).unwrap();Device::open_store(store,None).unwrap()
}
fn facts(d:&Device<MemoryStore>)->BTreeMap<(char,String),String> {
    d.store().export().into_iter().filter(|c|c.s=='r'||c.k.starts_with("device:acquisition-boundaries:")||c.k.starts_with("device:acquired-table:"))
        .filter_map(|c|c.v.map(|v|((c.s,c.k),v))).collect()
}

#[test]
fn bounded_schedules_converge_through_inflight_changes_and_crash_reopen() {
    // Three independent changes can happen before/after the unit; the response
    // can arrive before/after catch-up, and every boundary can reopen.
    for schedule in 0..32 {
        let (mut e,b)=setup();let mut d=Device::open_store(MemoryStore::new(),Some(b.clone())).unwrap();
        let p=acquisition(&mut e,&mut d);d.apply(&p,false).unwrap();check(&mut e,&mut d);
        assert!(!d.sync_state_read().unwrap().acquired);
        let p=acquisition(&mut e,&mut d);
        for (bit,op,id) in [(1,"move","m0"),(2,"remove","m1"),(4,"add","")] {
            if schedule&bit!=0 { let args=if id.is_empty(){BTreeMap::new()}else{BTreeMap::from([("m".into(),Value::Id(id.into()))])};
                e.mutate(op,None,Context::new("alice",args).at(100)).unwrap(); }
        }
        if schedule&8!=0 { catchup(&mut e,&mut d);
            if schedule&7!=0 { assert!(d.apply(&p,false).is_err());
                let p=acquisition(&mut e,&mut d);d.apply(&p,false).unwrap(); }
            else { d.apply(&p,false).unwrap(); } // At the unchanged pin, re-serving is idempotent.
        } else { d.apply(&p,false).unwrap(); }
        // The old in-flight image may legitimately lag until catch-up. Check
        // the current server oracle only after the stream repairs that image.
        if schedule&16!=0 { d=reopen(d); }
        catchup(&mut e,&mut d);d=reopen(d);check(&mut e,&mut d);
        assert!(d.sync_state_read().unwrap().acquired);
        let mut oracle=Device::open_store(MemoryStore::new(),Some(b)).unwrap();
        let snap=e.snapshot_acquisition_page_at("alice",None,100,100).unwrap();
        let p:StreamPage=serde_json::from_value(json!({"snapshot":true,"stage_snapshot":true,"held":snap.held,"acquisitions":snap.acquisitions,
            "watermark":snap.watermark,"more":false,"events":snap.events.iter().map(|e|json!({"table":e.table,"kind":e.kind.word(),"id":e.id,"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>()})).unwrap();
        oracle.apply(&p,true).unwrap();
        let p:StreamPage=serde_json::from_value(json!({"snapshot":false,"snapshot_catchup":true,"requested_watermark":snap.watermark,"watermark":snap.watermark,"images_at":snap.watermark,"more":false,"events":[]})).unwrap();
        oracle.apply(&p,false).unwrap();
        // Whole fact values name their actual publication watermark. Compare
        // presence (the coverage claim), not differing acquisition timestamps.
        let normalize=|facts:BTreeMap<(char,String),String>|facts.into_iter().map(|(k,v)|{let v=if k.1.starts_with("device:acquired-table:"){String::new()}else{v};(k,v)}).collect::<BTreeMap<_,_>>();
        assert_eq!(normalize(facts(&d)),normalize(facts(&oracle)),"schedule {schedule}");
    }
}
