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
        fingerprint: format!("fixture:{table}"),
        table:table.into(), group:"room".into(),position:"ordinal".into(),mutation:format!("delivered_{table}"), compact:None, semantics:None, args:vec!["conversation".into(),"from".into(),"through".into()]
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
    d.apply(&page(false,vec![event(2),event(5),json!({"table":"messages","kind":"del","id":"m5"}),expired,event(9_007_199_254_740_993)],2),false).unwrap();
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
    let q=snapback4_device::device::Queued { upload: None,id:"q".into(),seq:0,op:"edit".into(),args:json!({"id":"m1"}),new_ids:vec![],predicted:vec![],viewer:"dev:alice".into(),now:2,predictable:true,sent_seq:None,receipt_store:None,observed_seq:None,dispatch:None};
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
    let q=snapback4_device::device::Queued { upload: None,id:"q".into(),seq:0,op:"editSelected".into(),args:json!({}),new_ids:vec![],predicted:vec![],viewer:"dev:alice".into(),now:2,predictable:true,sent_seq:None,receipt_store:None,observed_seq:None,dispatch:None};
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

fn fingerprint_reconcile<H:Host>(h:&mut H) {
    let mut d=h.open("fingerprints",Some(backend())).unwrap();request(&mut d,"read");
    let photo=json!({"table":"photos","kind":"put","id":"p","data":{"id":"p","room":"r","ordinal":9,"text":"photo"}});
    d.apply(&page(true,vec![event(1),photo],1),true).unwrap();
    while request(&mut d,"enumerate")["more"]==true {}
    let before=state(&mut d);
    assert!(before["groups"].as_object().unwrap().values().all(|g|g["binding"]["fingerprint"].as_str().unwrap().starts_with("fixture:")));
    d.adopt(backend()).unwrap();assert_eq!(state(&mut d),before,"unchanged bindings survive adoption");
    let mut changed=backend();changed.schema.delivery[0].fingerprint="changed".into();d.adopt(changed).unwrap();
    let after=state(&mut d);assert_eq!(owed(&after,"messages"),json!([]));assert_eq!(owed(&after,"photos"),json!([[9,9]]));
    assert!(after["cursors"].get("[\"messages\",\"delivered_messages\"]").is_none());
    assert!(after["cursors"]["[\"photos\",\"delivered_photos\"]"]["done"]==true);
}
#[test]fn fingerprints_memory(){fingerprint_reconcile(&mut Memory::new())}
#[test]fn fingerprints_sqlite(){fingerprint_reconcile(&mut Sqlite::new("delivery-fingerprints"))}

#[test]fn binding_decoder_requires_fingerprint_and_exactly_three_arguments(){
    let value=json!({"table":"t","group":"g","position":"p","mutation":"m","fingerprint":"f","args":["g","a","b"]});
    let decoded:DeliveryBinding=serde_json::from_value(value.clone()).unwrap();assert_eq!(decoded.fingerprint,"f");
    let mut missing=value.clone();missing.as_object_mut().unwrap().remove("fingerprint");assert!(serde_json::from_value::<DeliveryBinding>(missing).is_err());
    let mut extra=value.clone();extra["args"]=json!(["g","a","b","c"]);assert!(serde_json::from_value::<DeliveryBinding>(extra).is_err());
    assert!(serde_json::from_str::<DeliveryBinding>(r#"{"table":"t","table":"u","group":"g","position":"p","mutation":"m","fingerprint":"f","args":["g","a","b"]}"#).is_err());
}

fn manifest_adoption<H:Host>(h:&mut H, older:bool) {
    let mut initial=backend();
    if older { initial.schema.delivery[0].fingerprint="older".into(); } else { initial.schema.delivery.clear(); }
    let mut d=h.open("manifest-adoption",Some(initial)).unwrap();
    let raw=request(&mut d,"read");let mut s:Json=serde_json::from_str(raw["value"].as_str().unwrap()).unwrap();
    let binding=json!({"table":"messages","mutation":"delivered_messages","fingerprint":"fixture:messages","args":["conversation","from","through"]});
    s["bindings"]=json!([binding]);
    s["groups"]["[\"messages\",\"delivered_messages\",\"r\"]"]=json!({"binding":binding,"group":"r","incarnation":1,"owed":[[41,41]],"reported":[[3,3]],"refused":[[5,5]],"parked":[],"recent":[],"saturated":false});
    let groups=s["groups"].clone();
    d.delivery(&json!({"viewer":"dev:alice","action":"write","expected":raw["value"],"value":s.to_string()})).unwrap();
    assert_eq!(state(&mut d)["groups"],groups,"older-schema reads keep unresolved manifest debt");
    h.close("manifest-adoption",d);let mut d=h.open("manifest-adoption",None).unwrap();
    assert_eq!(state(&mut d)["groups"],groups,"unresolved descriptors survive restart too");
    d.apply(&page(true,vec![event(43)],1),true).unwrap();
    assert_eq!(state(&mut d)["groups"],groups,"an older compiled fingerprint cannot collect into new manifest debt");
    d.adopt(backend()).unwrap();
    let adopted=state(&mut d);assert_eq!(adopted["groups"],groups,"manifest-only rows survive compiled binding adoption");
    assert_eq!(adopted["bindings"][0]["group"],"room");
    d.apply(&page(true,vec![],1),true).unwrap();
    assert_eq!(state(&mut d)["groups"],groups,"later publications keep the adopted debt");
    let mut removed=backend();removed.schema.delivery.clear();d.adopt(removed).unwrap();
    assert_eq!(state(&mut d)["groups"],json!({}),"removing a previously compiled binding drops its debt");
}
#[test]fn manifest_adoption_memory(){manifest_adoption(&mut Memory::new(),false)}
#[test]fn manifest_rebinding_memory(){manifest_adoption(&mut Memory::new(),true)}
#[test]fn manifest_rebinding_sqlite(){manifest_adoption(&mut Sqlite::new("delivery-manifest-rebinding"),true)}
#[test]fn manifest_adoption_sqlite(){manifest_adoption(&mut Sqlite::new("delivery-manifest-adoption"),false)}

fn activation_room<H:Host>(h:&mut H) {
    let mut d=h.open("activation-room",Some(backend())).unwrap();
    d.apply(&page(true,(1..=300).map(|n|event(n*2)).collect(),1),true).unwrap();
    let first=request(&mut d,"enumerate");
    let before=state(&mut d);let runs=owed(&before,"messages");
    assert_eq!(runs.as_array().unwrap().len(),256);
    assert_eq!(runs[0],json!([2,2]),"an activation page never evicts its earlier debt");
    assert_eq!(first["blocked"],true);
    request(&mut d,"enumerate");assert_eq!(state(&mut d),before,"no room leaves both debt and cursor unchanged");
    reset_debt(&mut d);request(&mut d,"enumerate");
    let rest=owed(&state(&mut d),"messages");assert_eq!(rest.as_array().unwrap().len(),44);assert_eq!(rest[0],json!([514,514]));
}
#[test]fn activation_room_memory(){activation_room(&mut Memory::new())}
#[test]fn activation_room_sqlite(){activation_room(&mut Sqlite::new("delivery-activation-room"))}

#[test]fn activation_sqlite_error_after_cursor_advance_retries_the_same_rows(){
    let mut h=Sqlite::new("delivery-cursor-error");let mut d=h.open("cursor-error",Some(backend())).unwrap();
    d.apply(&page(true,(1..=501).map(event).collect(),1),true).unwrap();request(&mut d,"read");
    d.store().conn().execute_batch(r#"CREATE TRIGGER delivery_fail BEFORE INSERT ON _meta
      WHEN NEW.key LIKE 'device:delivery:%' AND instr(NEW.value, '"after"') > 0
      BEGIN SELECT RAISE(ABORT, 'failed after delivery cursor advanced'); END;"#).unwrap();
    let error=d.delivery(&json!({"viewer":"dev:alice","action":"enumerate","now":20})).unwrap_err();
    assert!(error.to_string().contains("failed after delivery cursor advanced"));
    let rolled_back=state(&mut d);assert_eq!(rolled_back["cursors"],json!({}));assert_eq!(owed(&rolled_back,"messages"),json!([]));
    d.store().conn().execute_batch("DROP TRIGGER delivery_fail").unwrap();
    request(&mut d,"enumerate");assert_eq!(owed(&state(&mut d),"messages"),json!([[1,500]]));
    request(&mut d,"enumerate");assert_eq!(owed(&state(&mut d),"messages"),json!([[1,501]]));
}

fn edit_state<S:DeviceStore>(d:&mut Device<S>, edit:impl FnOnce(&mut Json)) {
    let raw=request(d,"read");let mut s:Json=serde_json::from_str(raw["value"].as_str().unwrap()).unwrap();edit(&mut s);
    assert_eq!(d.delivery(&json!({"viewer":"dev:alice","action":"write","expected":raw["value"],"value":s.to_string()})).unwrap(),json!(true));
}
// Range-refusal tombstones remain durable; E_BOUND no longer uses them.
fn refused_eviction<H:Host>(h:&mut H) {
    let key="[\"messages\",\"delivered_messages\",\"r\"]";
    for whole_group in [false,true] {
        let name=format!("refused-{whole_group}");
        let mut d=h.open(&name,Some(backend())).unwrap();request(&mut d,"read");
        d.apply(&page(true,vec![event(41)],1),true).unwrap();
        edit_state(&mut d,|s|{
            let g=&mut s["groups"][key];g["owed"]=json!([]);g["refused"]=json!([[41,41]]);
            if whole_group {
                let mut other=g.clone();other["refused"]=json!([]);
                for n in 0..4095 { let group=format!("other{n}");other["group"]=json!(group);other["collected"]=json!(10000+n);
                    s["groups"][json!(["messages","delivered_messages",group]).to_string()]=other.clone(); }
            }
        });
        if whole_group {
            let mut row=event(1000);row["data"]["room"]=json!("new");
            d.apply(&page(false,vec![row],2),false).unwrap();let s=state(&mut d);
            assert!(s["groups"].get(key).is_none());
            assert_eq!(s["retired"][key]["fingerprint"],"fixture:messages");
            assert_eq!(s["retired"][key]["refused"],json!([[41,41]]));
        } else {
            d.apply(&page(false,(0..256).map(|n|event(100+n*2)).collect(),2),false).unwrap();
            assert_eq!(state(&mut d)["groups"][key]["refused"],json!([[41,41]]));reset_debt(&mut d);
        }
        h.close(&name,d);let mut d=h.open(&name,None).unwrap();
        d.apply(&page(false,vec![event(41)],3),false).unwrap();let s=state(&mut d);
        assert_eq!(s["groups"][key]["refused"],json!([[41,41]]));assert_eq!(s["groups"][key]["owed"],json!([]));
    }
}
#[test]fn refused_eviction_memory(){refused_eviction(&mut Memory::new())}
#[test]fn refused_eviction_sqlite(){refused_eviction(&mut Sqlite::new("delivery-refused-eviction"))}

fn retired_adoption<H:Host>(h:&mut H) {
    let mut initial=backend();initial.schema.delivery[0].fingerprint="older".into();
    let mut d=h.open("retired-adoption",Some(initial)).unwrap();
    let key="[\"messages\",\"delivered_messages\",\"r\"]";
    let old_key="[\"messages\",\"delivered_messages\",\"old\"]";
    let cursor="[\"messages\",\"delivered_messages\"]";
    edit_state(&mut d,|s|{
        s["bindings"].as_array_mut().unwrap().push(json!({"table":"messages","mutation":"delivered_messages","fingerprint":"fixture:messages","args":["conversation","from","through"]}));
        s["retired"][key]=json!({"fingerprint":"fixture:messages","refused":[[41,41]],"saturated":true});
        s["retired"][old_key]=json!({"fingerprint":"older","refused":[[9,9]],"saturated":true});
        s["cursors"][cursor]=json!({"done":true});
    });
    d.adopt(backend()).unwrap();let s=state(&mut d);
    assert_eq!(s["retired"][key]["saturated"],true,"adopting a fingerprint keeps its retired refusal memory");
    assert!(s["retired"].get(old_key).is_none(),"the removed fingerprint is retired");
    assert!(s["cursors"].get(cursor).is_none(),"the shared enumeration cursor still resets");
    d.apply(&page(true,vec![event(41)],1),true).unwrap();let s=state(&mut d);
    assert_eq!(s["groups"][key]["refused"],json!([[41,41]]));assert_eq!(s["groups"][key]["saturated"],true);
    // A retained record from a different fingerprint can never suppress the
    // newly compiled binding, even if it shares the table/mutation/group key.
    edit_state(&mut d,|s|{s["groups"]=json!({});s["retired"][key]["fingerprint"]=json!("unrelated");});
    d.apply(&page(false,vec![event(43)],2),false).unwrap();let s=state(&mut d);
    assert_eq!(s["groups"][key]["refused"],json!([]));assert_eq!(s["groups"][key]["saturated"],false);assert_eq!(s["groups"][key]["owed"],json!([[43,43]]));
}
#[test]fn retired_adoption_memory(){retired_adoption(&mut Memory::new())}
#[test]fn retired_adoption_sqlite(){retired_adoption(&mut Sqlite::new("delivery-retired-adoption"))}
