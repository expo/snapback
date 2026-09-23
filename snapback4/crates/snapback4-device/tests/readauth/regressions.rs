//! Astra's three counterexamples, plus changing authority and prediction reads.
use super::*;
use snapback4_core::{Value, rows::Rows};
use snapback4_device::store::DeviceTx;

pub(super) const SOURCE: &str = include_str!("authority.q");

pub(super) fn enqueue<S: DeviceStore>(d: &mut Device<S>, op: &str) -> Queued {
    d.admit(serde_json::from_value(json!({"id":op,"seq":1,"op":op,"viewer":"alice","args":{},"now":100,"predictable":true})).unwrap()).unwrap()
}
fn start<H:Host>(h:&mut H, e:&mut Engine, b:snapback4_device::device::Backend) -> Device<H::Store> {
    let mut d=h.open("astra",Some(b)).unwrap();
    for (n,p) in snapshot_pages(e,"alice",100).iter().enumerate() { d.apply(p,n==0).unwrap(); }
    d
}
pub(super) fn reads<S:DeviceStore>(d:&mut Device<S>, visible:bool) {
    for (op,empty) in [("point",json!(null)),("scan",json!([])),("merged",json!([])),("page",json!([])),("total",json!(0)),("probe",json!(false)),("ruleProbe",json!(null))] {
        let out=d.query(op,"alice",&if op=="page" {json!({"c":null})} else {json!({})},100).unwrap();
        let data=wire::to_json(&out.data);
        if visible {
            assert_ne!(data,empty,"{op}: {out:?}");
        } else {
            assert_eq!(data,empty,"{op}: hidden overlay is absent");
            assert!(!out.complete,"{op}: hidden overlay must not certify absence");
        }
    }
}
fn replay<S:DeviceStore>(e:&mut Engine,d:&mut Device<S>) {
    let from=d.state().unwrap().0;
    let n=e.store().rows("ticks").unwrap().len();
    let out=e.mutate("tick",Some(&format!("tick-{n}")),context("alice",&[]).at(100)).unwrap();
    assert!(matches!(out.state,WriteState::Sent{..}));
    let p=stream_page(e,"alice",from);
    assert!(!p.events.is_empty() && p.watermark>from);
    d.apply(&p,false).unwrap();
    assert_eq!(d.query("ticksRead","alice",&json!({}),100).unwrap().data.as_array().unwrap().len(),n+1);
}
fn two_mutation<H:Host>(mut h:H) {
    let (mut e,b)=compile(SOURCE);
    let mut d=start(&mut h,&mut e,b);
    assert!(enqueue(&mut d,"publish").predictable);
    reads(&mut d,true);
    assert!(enqueue(&mut d,"revoke").predictable);
    assert_eq!(d.query("grantRow","alice",&json!({}),100).unwrap().data,Value::Null);
    reads(&mut d,false);
    h.close("astra",d); let mut d=h.open("astra",None).unwrap();
    assert_eq!(d.queued().unwrap().len(),2);
    reads(&mut d,false);
    replay(&mut e,&mut d);
    assert!(d.queued().unwrap().iter().all(|q|q.predictable));
    reads(&mut d,false);
}
#[test] fn two_mutation_revocation_memory() {two_mutation(Memory::new());}
#[test] fn two_mutation_revocation_sqlite() {two_mutation(Sqlite::new("two-mutation"));}

fn later_grant<H:Host>(mut h:H) {
    let (mut e,b)=compile(SOURCE);
    e.seed([("seats".into(),wire::row_from_json(&b.schema.tables["seats"],&json!({"id":"seat","groupId":"group","principal":"alice"})).unwrap())]).unwrap();
    seed_group(&mut e,&b);
    let mut d=start(&mut h,&mut e,b);
    assert!(enqueue(&mut d,"noteOnly").predictable);
    reads(&mut d,false);
    assert!(enqueue(&mut d,"grant").predictable);
    reads(&mut d,true);
    h.close("astra",d); let mut d=h.open("astra",None).unwrap();
    reads(&mut d,true); replay(&mut e,&mut d); reads(&mut d,true);
}
#[test] fn later_grant_memory() {later_grant(Memory::new());}
#[test] fn later_grant_sqlite() {later_grant(Sqlite::new("later-grant"));}

fn retained_grant<H:Host>(mut h:H) {
    let source=SOURCE.replacen("read <- .principal = viewer\n  insert", "read <- exists seats[.groupId, viewer]\n  insert",1)
        .replace("  sync to .principal\ntable notes", "  sync to seats[.groupId] by .principal\n  retain delivered-history\ntable notes")+"\nmutation leave():\n  delete seats['seat']\n";
    let (mut e,b)=compile(&source);
    for (table,row) in [("groups",json!({"id":"group"})),("seats",json!({"id":"seat","groupId":"group","principal":"alice"})),("grants",json!({"id":"grant","groupId":"group","principal":"alice"}))] {
        e.seed([(table.into(),wire::row_from_json(&b.schema.tables[table],&row).unwrap())]).unwrap();
    }
    let mut d=start(&mut h,&mut e,b);
    let from=d.state().unwrap().0;
    sent(&mut e,"leave",json!({}),vec![]);
    let p=stream_page(&mut e,"alice",from);
    assert!(p.events.iter().any(|event|event.table=="grants" && event.kind=="scope"));
    d.apply(&p,false).unwrap();
    assert!(d.store().meta("device:history:groups").unwrap().unwrap().contains("Left"));
    assert_ne!(d.query("grantRow","alice",&json!({}),100).unwrap().data,Value::Null,"delivered retained control");
    assert!(enqueue(&mut d,"noteOnly").predictable);
    reads(&mut d,false);
    h.close("astra",d); let mut d=h.open("astra",None).unwrap();
    reads(&mut d,false); replay(&mut e,&mut d); reads(&mut d,false);
}
#[test] fn retained_grant_memory() {retained_grant(Memory::new());}
#[test] fn retained_grant_sqlite() {retained_grant(Sqlite::new("retained-grant"));}

fn own_read<H:Host>(mut h:H) {
    let (mut e,b)=compile(SOURCE);
    let mut d=start(&mut h,&mut e,b);
    let q=enqueue(&mut d,"readOwnHidden");
    assert!(!q.predictable && q.predicted.is_empty(),"an unknown input queues, unlike an unreadable output");
    assert_eq!(d.query("point","alice",&json!({}),100).unwrap().data,Value::Null);
}
#[test] fn hidden_inside_prediction_memory() {own_read(Memory::new());}
#[test] fn hidden_inside_prediction_sqlite() {own_read(Sqlite::new("own-read"));}

// Construct old-client disk state directly: no admission or replay by this code.
fn seed_group(e:&mut Engine,b:&snapback4_device::device::Backend) {
    e.seed([("groups".into(),wire::row_from_json(&b.schema.tables["groups"],&json!({"id":"group"})).unwrap())]).unwrap();
}
fn legacy<S:DeviceStore>(mut store:S,b:&snapback4_device::device::Backend) -> Device<S> {
    let tx=store.transaction().unwrap();
    for (table,row) in [("notes",json!({"id":"note","groupId":"group","owner":"alice","body":"private"})),("checks",json!({"id":"check","groupId":"group"}))] {
        let mut image=wire::row_from_json(&b.schema.tables[table],&row).unwrap();
        if let Value::Row(fields)=&mut image {fields.insert("pending".into(),Value::Bool(true));}
        tx.base_remember(table,row["id"].as_str().unwrap(),None).unwrap();
        tx.put(table,&b.schema.tables[table],&image,None).unwrap();
    }
    let q:Queued=serde_json::from_value(json!({"id":"legacy","seq":1,"op":"noteOnly","viewer":"alice","args":{},"now":100,"predictable":true,"predicted":["notes/note","checks/check"]})).unwrap();
    tx.outbox_insert(1,"legacy",&serde_json::to_string(&q).unwrap()).unwrap();
    tx.commit().unwrap();
    Device::open_store(store,None).unwrap()
}
#[test] fn offline_upgrade_memory() {
    let (mut e,b)=compile(SOURCE); let mut h=Memory::new();
    seed_group(&mut e,&b);
    let d=start(&mut h,&mut e,b.clone()); h.close("astra",d);
    let mut store=snapback4_device::memory::MemoryStore::new();
    store.load(h.held("astra").into_iter().map(|((s,k),v)|snapback4_device::memory::Change{s,k,v})).unwrap();
    let mut d=legacy(store,&b);
    assert_eq!(d.queued().unwrap()[0].id,"legacy"); reads(&mut d,false);
    h.close("astra",d); let mut d=h.open("astra",None).unwrap(); reads(&mut d,false);
    replay(&mut e,&mut d); reads(&mut d,false);
}
#[test] fn offline_upgrade_sqlite() {
    let (mut e,b)=compile(SOURCE); let mut h=Sqlite::new("upgrade");
    seed_group(&mut e,&b);
    let d=start(&mut h,&mut e,b.clone()); h.close("astra",d);
    let mut d=legacy(snapback4_core::Store::open(&h.path("astra")).unwrap(),&b);
    assert_eq!(d.queued().unwrap()[0].id,"legacy"); reads(&mut d,false);
    h.close("astra",d); let mut d=h.open("astra",None).unwrap(); reads(&mut d,false);
    replay(&mut e,&mut d); reads(&mut d,false);
}

fn old_report<S:DeviceStore>(mut store:S,b:&snapback4_device::device::Backend) -> Device<S> {
    let tx=store.transaction().unwrap();
    let mut row=wire::row_from_json(&b.schema.tables["reports"],&json!({"id":"report","writer":"alice","reader":"moderator","body":"old client"})).unwrap();
    if let Value::Row(fields)=&mut row {fields.insert("pending".into(),Value::Bool(true));}
    tx.put("reports",&b.schema.tables["reports"],&row,None).unwrap();
    tx.base_remember("reports","report",None).unwrap();
    let q:Queued=serde_json::from_value(json!({"id":"old-report","seq":1,"op":"submit","viewer":"alice","args":{"reader":"moderator"},"now":100,"predictable":true,"predicted":["reports/report"]})).unwrap();
    tx.outbox_insert(1,"old-report",&serde_json::to_string(&q).unwrap()).unwrap();
    tx.commit().unwrap();
    Device::open_store(store,None).unwrap()
}
fn check_old_report<S:DeviceStore>(d:&mut Device<S>) {
    assert_eq!(d.queued().unwrap()[0].id,"old-report");
    assert_eq!(observations(d),vec![json!(null),json!(null),json!([]),json!([]),json!([]),json!(false),json!(false),json!(0),json!(0),json!([]),json!([])]);
    assert!(!d.query("point","alice",&json!({"id":"report"}),100).unwrap().complete);
}
#[test] fn offline_moderation_upgrade_memory() {
    let (mut e,b)=compile(super::SOURCE); let mut h=Memory::new();
    let d=start(&mut h,&mut e,b.clone()); h.close("astra",d);
    let mut store=snapback4_device::memory::MemoryStore::new();
    store.load(h.held("astra").into_iter().map(|((s,k),v)|snapback4_device::memory::Change{s,k,v})).unwrap();
    let mut d=old_report(store,&b); check_old_report(&mut d);
    h.close("astra",d); let mut d=h.open("astra",None).unwrap(); check_old_report(&mut d);
}
#[test] fn offline_moderation_upgrade_sqlite() {
    let (mut e,b)=compile(super::SOURCE); let mut h=Sqlite::new("old-report");
    let d=start(&mut h,&mut e,b.clone()); h.close("astra",d);
    let mut d=old_report(snapback4_core::Store::open(&h.path("astra")).unwrap(),&b); check_old_report(&mut d);
    h.close("astra",d); let mut d=h.open("astra",None).unwrap(); check_old_report(&mut d);
}
