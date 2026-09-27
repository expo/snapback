//! Client-half fixtures for LLP 3000.022, independent of the delivery parser.
mod common;
use common::*;
use serde_json::{Value as Json, json};
use snapback4_core::schema::DeliveryBinding;
use snapback4_device::device::{Backend, Device, StreamPage};
use snapback4_device::store::DeviceStore;

const SOURCE: &str = r#"
table rooms:
  title: text
  read <- allow
  sync public
table messages:
  room: rooms
  ordinal: int
  text: text
  expires: time
  unique room, ordinal
  immutable room, ordinal
  read <- allow
  update <- allow
  delete <- allow
  expire at .expires
  sync public
table photos:
  room: rooms
  ordinal: int
  text: text
  unique room, ordinal
  immutable room, ordinal
  read <- allow
  sync public
table selectors:
  target: messages
  read <- allow
  update <- allow
  sync public
mutation editSelected():
  s = selectors['s'] ! else NOT_FOUND
  update messages[s.target] { text: 'pending' }
  return null
query message(id: messages):
  return messages[id]
mutation edit(id: messages):
  update messages[id] { text: 'pending' }
  return null
"#;
fn backend() -> Backend {
    let (_,mut b) = compile(SOURCE);
    b.schema.delivery = ["messages","photos"].into_iter().map(|table| DeliveryBinding {
        table:table.into(), group:"room".into(),position:"ordinal".into(),mutation:format!("delivered_{table}"),args:["conversation".into(),"from".into(),"through".into()]
    }).collect(); b
}
fn event(n:i64) -> Json { json!({"table":"messages","kind":"put","id":format!("m{n}"),"data":{"id":format!("m{n}"),"room":"r","ordinal":n,"text":"confirmed","expires":10000}}) }
fn page(snapshot: bool, events:Vec<Json>, seq:u64) -> StreamPage {
    serde_json::from_value(json!({"snapshot":snapshot,"events":events,"watermark":seq,"images_at":seq,"more":false,"now":1})).unwrap()
}
fn request<S:DeviceStore>(d:&mut Device<S>, action:&str) -> Json { d.delivery(&json!({"viewer":"dev:alice","action":action,"now":20})).unwrap() }
fn state<S:DeviceStore>(d:&mut Device<S>) -> Json { serde_json::from_str(request(d,"read")["value"].as_str().unwrap()).unwrap() }
fn owed(s:&Json, table:&str) -> Json { s["groups"].as_object().unwrap().values().find(|g|g["binding"]["table"]==table).map(|g|g["owed"].clone()).unwrap_or(json!([])) }
fn reset_debt<S:DeviceStore>(d:&mut Device<S>) {
    let read=request(d,"read"); let mut s:Json=serde_json::from_str(read["value"].as_str().unwrap()).unwrap();
    for g in s["groups"].as_object_mut().unwrap().values_mut() { g["owed"]=json!([]); }
    assert_eq!(d.delivery(&json!({"viewer":"dev:alice","action":"write","expected":read["value"],"value":s.to_string()})).unwrap(),json!(true));
}
fn publication<H:Host>(h:&mut H) {
    let mut d=h.open("delivery",Some(backend())).unwrap();request(&mut d,"read");
    let mut staged=page(true,vec![event(1)],1);staged.more=true;staged.next=Some("cursor".into());
    d.apply(&staged,true).unwrap();assert_eq!(owed(&state(&mut d),"messages"),json!([]));
    let mut last=page(true,vec![event(3)],1);last.after=Some("cursor".into());
    d.apply(&last,false).unwrap();assert_eq!(owed(&state(&mut d),"messages"),json!([[1,1],[3,3]]));
    let captured=request(&mut d,"read");
    let mut expired=event(4);expired["data"]["expires"]=json!(1);
    d.apply(&page(false,vec![event(2),event(5),json!({"table":"messages","kind":"del","id":"m5"}),expired],2),false).unwrap();
    assert_eq!(owed(&state(&mut d),"messages"),json!([[1,3]]));
    assert_eq!(d.delivery(&json!({"viewer":"dev:alice","action":"write","expected":captured["value"],"value":captured["value"]})).unwrap(),json!(false),"a queue callback cannot overwrite published debt");
    h.close("delivery",d);let mut d=h.open("delivery",None).unwrap();assert_eq!(owed(&state(&mut d),"messages"),json!([[1,3]]));
    d.apply(&page(false,vec![json!({"table":"messages","kind":"scope","id":"scope","data":[]})],3),false).unwrap();
    assert_eq!(owed(&state(&mut d),"messages"),json!([]));
}
fn activation<H:Host>(h:&mut H) {
    let mut d=h.open("activation",Some(backend())).unwrap();
    let mut rows:Vec<_>=(1..=501).map(event).collect();for row in &mut rows[..500] { row["data"]["expires"]=json!(10); }
    rows.push(json!({"table":"photos","kind":"put","id":"p1","data":{"id":"p1","room":"r","ordinal":9,"text":"photo"}}));
    d.apply(&page(true,rows,1),true).unwrap();
    assert_eq!(request(&mut d,"enumerate")["more"],true);assert_eq!(owed(&state(&mut d),"messages"),json!([]),"raw expired page advances despite yielding nothing");
    h.close("activation",d);let mut d=h.open("activation",None).unwrap();request(&mut d,"enumerate");
    assert_eq!(owed(&state(&mut d),"messages"),json!([[501,501]]));request(&mut d,"enumerate");assert_eq!(owed(&state(&mut d),"photos"),json!([[9,9]]));
    assert_eq!(request(&mut d,"enumerate")["more"],false);reset_debt(&mut d);request(&mut d,"enumerate");assert_eq!(owed(&state(&mut d),"messages"),json!([]),"done never rescans");
}
fn settlement<H:Host>(h:&mut H) {
    let mut d=h.open("settlement",Some(backend())).unwrap();d.apply(&page(true,vec![event(1),event(2)],1),true).unwrap();
    // Upgrade while an edit covers the first row. Enumeration sees only row two.
    let prediction=d.predict("edit","dev:alice",&json!({"id":"m1"}),2,vec![],1).unwrap();
    request(&mut d,"enumerate");assert_eq!(owed(&state(&mut d),"messages"),json!([[2,2]]));
    d.withdraw(&prediction.predicted).unwrap();assert_eq!(owed(&state(&mut d),"messages"),json!([[1,2]]));
    reset_debt(&mut d);
    let q=snapback4_device::device::Queued {id:"q".into(),seq:0,op:"edit".into(),args:json!({"id":"m1"}),new_ids:vec![],predicted:vec![],viewer:"dev:alice".into(),now:2,predictable:true,sent_seq:None,receipt_store:None,observed_seq:None,dispatch:None};
    d.admit(q.clone()).unwrap();d.settle("q",None).unwrap();assert_eq!(owed(&state(&mut d),"messages"),json!([[1,1]]),"settlement visits only its predicted ids");
    reset_debt(&mut d);d.admit(snapback4_device::device::Queued{id:"q2".into(),..q}).unwrap();d.dequeue("q2").unwrap();assert_eq!(owed(&state(&mut d),"messages"),json!([[1,1]]));
}
fn saturation<H:Host>(h:&mut H) {
    let mut d=h.open("saturation",Some(backend())).unwrap();request(&mut d,"read");d.apply(&page(true,vec![event(1)],1),true).unwrap();
    let raw=request(&mut d,"read");let mut s:Json=serde_json::from_str(raw["value"].as_str().unwrap()).unwrap();let g=s["groups"].as_object_mut().unwrap().values_mut().next().unwrap();g["saturated"]=json!(true);g["owed"]=json!([]);g["refused"]=json!([[1,1]]);
    d.delivery(&json!({"viewer":"dev:alice","action":"write","expected":raw["value"],"value":s.to_string()})).unwrap();h.close("saturation",d);let mut d=h.open("saturation",None).unwrap();d.apply(&page(false,vec![event(2)],2),false).unwrap();assert_eq!(owed(&state(&mut d),"messages"),json!([]));
}
#[test]fn publication_memory(){publication(&mut Memory::new())}
#[test]fn publication_sqlite(){publication(&mut Sqlite::new("delivery-publication"))}
#[test]fn activation_memory(){activation(&mut Memory::new())}
#[test]fn activation_sqlite(){activation(&mut Sqlite::new("delivery-activation"))}
#[test]fn settlement_memory(){settlement(&mut Memory::new())}
#[test]fn settlement_sqlite(){settlement(&mut Sqlite::new("delivery-settlement"))}
#[test]fn saturation_memory(){saturation(&mut Memory::new())}
#[test]fn saturation_sqlite(){saturation(&mut Sqlite::new("delivery-saturation"))}

fn deferred_and_retarget<H:Host>(h:&mut H) {
    let mut d=h.open("deferred",Some(backend())).unwrap();
    d.apply(&page(true,vec![event(1),event(2),json!({"table":"selectors","kind":"put","id":"s","data":{"id":"s","target":"m1"}})],1),true).unwrap();
    let q=snapback4_device::device::Queued {id:"q".into(),seq:0,op:"editSelected".into(),args:json!({}),new_ids:vec![],predicted:vec![],viewer:"dev:alice".into(),now:2,predictable:true,sent_seq:None,receipt_store:None,observed_seq:None,dispatch:None};
    d.admit(q).unwrap();request(&mut d,"read");
    // Publication retargets the pending write. Only its old base becomes visible.
    d.apply(&page(false,vec![json!({"table":"selectors","kind":"put","id":"s","data":{"id":"s","target":"m2"}})],2),false).unwrap();
    assert_eq!(owed(&state(&mut d),"messages"),json!([[1,1]]));
    reset_debt(&mut d);d.sync_state().unwrap();
    let mut private=page(false,vec![event(3),event(4)],3);private.more=true;private.images_at=Some(4);private.committed_above.insert("q".into(),4);
    d.apply(&private,false).unwrap();assert_eq!(d.state().unwrap().0,2);assert_eq!(owed(&state(&mut d),"messages"),json!([]));
    d.settle("q",None).unwrap();reset_debt(&mut d);
    let mut finish=page(false,vec![json!({"table":"messages","kind":"del","id":"m3"})],4);finish.requested_watermark=Some(3);
    d.apply(&finish,false).unwrap();assert_eq!(owed(&state(&mut d),"messages"),json!([[4,4]]),"private images collect only at install, after terminal deletions");
}
fn retained<H:Host>(h:&mut H) {
    let mut b=backend();b.schema.tables.get_mut("messages").unwrap().leave=snapback4_core::schema::LeavePolicy::DeliveredHistory;
    let mut d=h.open("retained",Some(b)).unwrap();request(&mut d,"read");
    let mut first=page(true,vec![event(1)],1);first.held=Some(serde_json::from_value(json!({"messages":[[]]})).unwrap());d.apply(&first,true).unwrap();
    reset_debt(&mut d);
    let mut replacement=page(true,vec![event(2)],2);replacement.held=first.held.clone();replacement.stage_snapshot=true;
    d.apply(&replacement,true).unwrap();assert_eq!(owed(&state(&mut d),"messages"),json!([]));
    let mut catchup=page(false,vec![json!({"table":"messages","kind":"scope","id":"left","data":[]})],3);catchup.snapshot_catchup=true;catchup.requested_watermark=Some(2);
    d.apply(&catchup,false).unwrap();assert_eq!(owed(&state(&mut d),"messages"),json!([]),"text-only acquired=true staged row is retained, not Held");
    // Replacing again retains old local copies (acquired=false), never collects them.
    let mut replacement=page(true,vec![],4);replacement.held=Some(serde_json::from_value(json!({"messages":[]})).unwrap());d.apply(&replacement,true).unwrap();assert_eq!(owed(&state(&mut d),"messages"),json!([]));
}
#[test]fn deferred_retarget_memory(){deferred_and_retarget(&mut Memory::new())}
#[test]fn deferred_retarget_sqlite(){deferred_and_retarget(&mut Sqlite::new("delivery-deferred"))}
#[test]fn retained_memory(){retained(&mut Memory::new())}
#[test]fn retained_sqlite(){retained(&mut Sqlite::new("delivery-retained"))}

fn horizon<H:Host>(h:&mut H) {
    let source=SOURCE.replace("expire at .expires\n  sync public", "expire at .expires\n  by byOrdinal: ordinal\n  sync public last 2 by byOrdinal");
    let (_,mut b)=compile(&source);b.schema.delivery=backend().schema.delivery;
    let mut d=h.open("horizon",Some(b)).unwrap();request(&mut d,"read");
    let floor=snapback4_core::value::encode_bytes_hex(&snapback4_core::key::encode(&[snapback4_core::value::Value::Int(10),id("m10")]));
    let mut first=page(true,vec![event(10),event(11)],1);
    first.acquisitions=serde_json::from_value(json!([
        {"at":0,"table":"messages","index":"byOrdinal","group":[],"floor":null},
        {"at":2,"table":"messages","index":"byOrdinal","group":[],"floor":floor}
    ])).unwrap();
    d.apply(&first,true).unwrap();reset_debt(&mut d);
    d.apply(&page(false,vec![event(1),event(12)],2),false).unwrap();
    assert_eq!(owed(&state(&mut d),"messages"),json!([[12,12]]),"horizon rejects never become candidates");
    assert_eq!(d.query("message","dev:alice",&json!({"id":"m1"}),20).unwrap().data,snapback4_core::value::Value::Null);
}
fn bounded_attempt<H:Host>(h:&mut H) {
    let mut d=h.open("bounded",Some(backend())).unwrap();request(&mut d,"read");
    d.apply(&page(true,vec![event(1)],1),true).unwrap();
    let raw=request(&mut d,"read");let mut s:Json=serde_json::from_str(raw["value"].as_str().unwrap()).unwrap();
    let g=s["groups"].as_object_mut().unwrap().values_mut().next().unwrap();
    g["attempt"]=json!({"id":"attempt","run":[1,1],"retries":2,"readyAt":0});
    d.delivery(&json!({"viewer":"dev:alice","action":"write","expected":raw["value"],"value":s.to_string()})).unwrap();
    d.apply(&page(false,(0..256).map(|n|event(10+n*2)).collect(),2),false).unwrap();
    let s=state(&mut d);let g=s["groups"].as_object().unwrap().values().next().unwrap();
    assert_eq!(g["owed"].as_array().unwrap().len(),256);assert!(g.get("attempt").is_none(),"evicted debt cannot survive in an uncertain attempt");
}
#[test]fn horizon_memory(){horizon(&mut Memory::new())}
#[test]fn horizon_sqlite(){horizon(&mut Sqlite::new("delivery-horizon"))}
#[test]fn bounded_attempt_memory(){bounded_attempt(&mut Memory::new())}
#[test]fn bounded_attempt_sqlite(){bounded_attempt(&mut Sqlite::new("delivery-bound"))}
