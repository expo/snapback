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
pub(super) fn reads<S:BoundaryMetadata>(d:&mut Device<S>, visible:bool, unknown:bool) {
    let note=d.store().raw_rows("notes").into_iter().find(|row|row.field("id")==Ok(&id("note"))).expect("hidden is not discarded");
    assert_eq!(note.field("pending"),Ok(&Value::Bool(true)));
    let note=wire::to_json(&note);
    let check=json!({"id":"check","groupId":"group","pending":true});
    for (op,wanted) in [("point",if visible {note.clone()} else {json!(null)}),
        ("scan",if visible {json!([note])} else {json!([])}),
        ("merged",if visible {json!([note])} else {json!([])}),
        ("page",if visible {json!([note])} else {json!([])}),
        ("total",json!(usize::from(visible))), ("probe",json!(visible)),
        // The pending note is a raw witness even when its own rule denies.
        ("ruleProbe",check)] {
        let (out,missing,_)=d.query_with_coverage(op,"alice",&if op=="page" {json!({"c":null})} else {json!({})},100);
        let out=out.unwrap();
        assert_eq!(wire::to_json(&out.data),wanted,"{op}: {out:?}");
        assert_eq!(missing,unknown && op!="ruleProbe","{op}: {out:?}");
        assert_eq!(out.complete,!(unknown && op!="ruleProbe"),"{op}: {out:?}");
        assert!(out.cut.is_none());
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
    reads(&mut d,true,false);
    assert!(enqueue(&mut d,"revoke").predictable);
    assert_eq!(d.query("grantRow","alice",&json!({}),100).unwrap().data,Value::Null);
    reads(&mut d,false,false);
    let error=d.admit(serde_json::from_value(json!({"id":"read-later","seq":3,"op":"readLater","viewer":"alice","args":{},"now":100,"predictable":true})).unwrap()).unwrap_err();
    assert_eq!(error.code(),"HIDDEN");
    assert!(d.store().raw_rows("ticks").is_empty());
    h.close("astra",d); let mut d=h.open("astra",None).unwrap();
    assert_eq!(d.queued().unwrap().len(),2);
    reads(&mut d,false,false);
    replay(&mut e,&mut d);
    assert!(d.queued().unwrap().iter().all(|q|q.predictable));
    reads(&mut d,false,false);
}
#[test] fn two_mutation_revocation_memory() {two_mutation(Memory::new());}
#[test] fn two_mutation_revocation_sqlite() {two_mutation(Sqlite::new("two-mutation"));}

fn later_grant<H:Host>(mut h:H) {
    let (mut e,b)=compile(SOURCE);
    e.seed([("seats".into(),wire::row_from_json(&b.schema.tables["seats"],&json!({"id":"seat","groupId":"group","principal":"alice"})).unwrap())]).unwrap();
    seed_group(&mut e,&b);
    let mut d=start(&mut h,&mut e,b);
    assert!(enqueue(&mut d,"noteOnly").predictable);
    reads(&mut d,false,false);
    assert!(enqueue(&mut d,"grant").predictable);
    reads(&mut d,true,false);
    h.close("astra",d); let mut d=h.open("astra",None).unwrap();
    reads(&mut d,true,false); replay(&mut e,&mut d); reads(&mut d,true,false);
}
#[test] fn later_grant_memory() {later_grant(Memory::new());}
#[test] fn later_grant_sqlite() {later_grant(Sqlite::new("later-grant"));}

fn retained_grant<H:Host>(mut h:H) {
    let source=include_str!("retained.q");
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
    assert_eq!(d.store().raw_rows("grants").len(),1,"group replacement never cascades the retained witness"); reads(&mut d,false,true);
    h.close("astra",d); let mut d=h.open("astra",None).unwrap();
    assert_eq!(d.store().raw_rows("grants").len(),1,"group replacement never cascades the retained witness"); reads(&mut d,false,true); replay(&mut e,&mut d); assert_eq!(d.store().raw_rows("grants").len(),1,"group replacement never cascades the retained witness"); reads(&mut d,false,true);
}
#[test] fn retained_grant_memory() {retained_grant(Memory::new());}
#[test] fn retained_grant_sqlite() {retained_grant(Sqlite::new("retained-grant"));}

fn own_read<H:Host>(mut h:H) {
    let (mut e,b)=compile(SOURCE);
    let mut d=start(&mut h,&mut e,b);
    // @ref LLP 3000.007#20.5 — the HIDDEN refusal follows an insert whose supplied id
    // 'note' this device cannot prove absent, so the server's verdict is the one reported.
    let queued=d.admit(serde_json::from_value(json!({"id":"own-read","seq":1,"op":"readOwnHidden","viewer":"alice","args":{},"now":100,"predictable":true})).unwrap()).unwrap();
    assert!(!queued.predictable && queued.predicted.is_empty(),"{queued:?}");
    assert_eq!(d.queued().unwrap().len(),1);
    assert!(d.store().raw_rows("notes").is_empty());
    assert!(d.store().raw_rows("groups").is_empty());
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
    assert_eq!(d.queued().unwrap()[0].id,"legacy"); reads(&mut d,false,false);
    h.close("astra",d); let mut d=h.open("astra",None).unwrap(); reads(&mut d,false,false);
    replay(&mut e,&mut d); reads(&mut d,false,false);
}
#[test] fn offline_upgrade_sqlite() {
    let (mut e,b)=compile(SOURCE); let mut h=Sqlite::new("upgrade");
    seed_group(&mut e,&b);
    let d=start(&mut h,&mut e,b.clone()); h.close("astra",d);
    let mut d=legacy(snapback4_core::Store::open(&h.path("astra")).unwrap(),&b);
    assert_eq!(d.queued().unwrap()[0].id,"legacy"); reads(&mut d,false,false);
    h.close("astra",d); let mut d=h.open("astra",None).unwrap(); reads(&mut d,false,false);
    replay(&mut e,&mut d); reads(&mut d,false,false);
}

fn old_report<S:DeviceStore>(mut store:S,b:&snapback4_device::device::Backend) -> Device<S> {
    let tx=store.transaction().unwrap();
    let mut row=wire::row_from_json(&b.schema.tables["reports"],&json!({"id":"report","writer":"alice","reader":"moderator","body":"old client"})).unwrap();
    if let Value::Row(fields)=&mut row {fields.insert("pending".into(),Value::Bool(true));}
    tx.put("reports",&b.schema.tables["reports"],&row,None).unwrap();
    tx.base_remember("reports","report",None).unwrap();
    let mut own=wire::row_from_json(&b.schema.tables["reports"],&json!({"id":"own","writer":"alice","reader":"alice","body":"own"})).unwrap();
    if let Value::Row(fields)=&mut own {fields.insert("pending".into(),Value::Bool(true));}
    tx.put("reports",&b.schema.tables["reports"],&own,None).unwrap();
    tx.base_remember("reports","own",None).unwrap();
    let q:Queued=serde_json::from_value(json!({"id":"old-report","seq":1,"op":"mixed","viewer":"alice","args":{},"now":100,"predictable":true,"predicted":["reports/report","reports/own"]})).unwrap();
    tx.outbox_insert(1,"old-report",&serde_json::to_string(&q).unwrap()).unwrap();
    tx.commit().unwrap();
    Device::open_store(store,None).unwrap()
}
fn check_old_report<S:BoundaryMetadata>(d:&mut Device<S>) {
    assert_eq!(d.queued().unwrap()[0].id,"old-report");
    assert_eq!(d.store().raw_rows("reports").len(),2);
    let own=json!({"id":"own","writer":"alice","reader":"alice","body":"own","pending":true});
    assert_eq!(observations(d),vec![json!(null),own.clone(),json!([own]),json!([]),json!([own]),json!(false),json!(true),json!(1),json!(0),json!([own]),json!([])]);
    assert!(d.query("point","alice",&json!({"id":"report"}),100).unwrap().complete);
}
#[test] fn offline_moderation_upgrade_memory() {
    let (mut e,b)=compile(super::SOURCE); let mut h=Memory::new();
    let d=start(&mut h,&mut e,b.clone()); h.close("astra",d);
    let mut store=snapback4_device::memory::MemoryStore::new();
    store.load(h.held("astra").into_iter().map(|((s,k),v)|snapback4_device::memory::Change{s,k,v})).unwrap();
    let mut d=old_report(store,&b); check_old_report(&mut d);
    h.close("astra",d); let mut d=h.open("astra",None).unwrap(); check_old_report(&mut d);
    replay(&mut e,&mut d); check_old_report(&mut d);
}
#[test] fn offline_moderation_upgrade_sqlite() {
    let (mut e,b)=compile(super::SOURCE); let mut h=Sqlite::new("old-report");
    let d=start(&mut h,&mut e,b.clone()); h.close("astra",d);
    let mut d=old_report(snapback4_core::Store::open(&h.path("astra")).unwrap(),&b); check_old_report(&mut d);
    h.close("astra",d); let mut d=h.open("astra",None).unwrap(); check_old_report(&mut d);
    replay(&mut e,&mut d); check_old_report(&mut d);
}
