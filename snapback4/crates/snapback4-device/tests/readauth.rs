//! A provisional row must earn read authority; delivered rows keep theirs.
mod common;
#[path = "readauth/census.rs"]
mod census;
#[path = "readauth/outcomes.rs"]
mod outcomes;
#[path = "readauth/timing.rs"]
mod timing;
use common::*;
use serde_json::{Value as Json, json};
use snapback4_core::{Engine, WriteState, wire};
use snapback4_device::{device::{Device, Queued}, store::DeviceStore};

const SOURCE: &str = r#"
table reports:
  writer: principal
  reader: principal
  body: text <=100
  by byReader: reader, id
  read <- .reader = viewer
  insert <- .writer = viewer
  update <- .writer = viewer
  sync to .reader

table ticks:
  public 'reconnect witness'
  insert <- allow
  sync public

mutation tick():
  insert ticks {}
mutation submit(reader: principal):
  insert reports { id: 'report', writer: viewer, reader, body: 'private' }
mutation hide():
  update reports['report'] { reader: 'moderator', body: 'changed' }
mutation upsertHide():
  upsert reports['report'] { reader: 'moderator', body: 'changed' }
mutation mixed():
  insert reports { id: 'own', writer: viewer, reader: viewer, body: 'own' }
  insert reports { id: 'report', writer: viewer, reader: 'moderator', body: 'private' }
query point(id: reports):
  return reports[id]
query scan(reader: principal):
  return reports[reader] first 100 by byReader
query merged():
  return merge reports first 100 by byReader:
    ['alice']
    ['moderator']
query probe(id: reports):
  return exists reports[id]
query total(reader: principal):
  rows = reports[reader] first 100 by byReader
  return count(rows)
"#;

fn admit<S: DeviceStore>(device: &mut Device<S>, op: &str, args: Json) -> Queued {
    device.admit(serde_json::from_value(json!({
        "id":"queued", "seq":1, "op":op, "viewer":"alice", "args":args,
        "now":100, "predictable":true,
    })).unwrap()).unwrap()
}
fn sent(engine: &mut Engine, op: &str, args: Json, ids: Vec<String>) -> u64 {
    let args = args.as_object().unwrap().iter().map(|(k,v)| (k.clone(), id(v.as_str().unwrap()))).collect();
    let outcome = engine.mutate(op, Some(op), snapback4_core::Context::new("alice", args).at(100).with_ids(ids)).unwrap();
    match outcome.state { WriteState::Sent { seq, .. } => seq, _ => panic!("{outcome:?}") }
}
fn observations<S: DeviceStore>(device: &mut Device<S>) -> Vec<Json> {
    [
        ("point",json!({"id":"report"})), ("point",json!({"id":"own"})),
        ("scan",json!({"reader":"alice"})), ("scan",json!({"reader":"moderator"})),
        ("merged",json!({})), ("probe",json!({"id":"report"})),
        ("probe",json!({"id":"own"})), ("total",json!({"reader":"alice"})),
        ("total",json!({"reader":"moderator"})),
    ].into_iter().map(|(op,args)| {
        let result = device.query(op,"alice",&args,100).unwrap();
        wire::to_json(&result.data)
    }).collect()
}
fn lifecycle<H: Host>(mut host: H, op: &str, input: Json, readable: bool, existing: bool) {
    let (mut engine, backend) = compile(SOURCE);
    assert_eq!(backend.schema.operations[op].predicts.as_deref(), Some("eligible"));
    if existing { sent(&mut engine,"submit",json!({"reader":"alice"}),vec![]); }
    let mut device = host.open("read-auth",Some(backend)).unwrap();
    for (i,page) in snapshot_pages(&mut engine,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    let before = observations(&mut device);
    let queued = admit(&mut device,op,input.clone());
    assert_eq!(queued.predictable,readable,"{} {op}: {queued:?}",host.label());
    assert_eq!(queued.predicted.len(),usize::from(readable));
    let pending = observations(&mut device);
    if !readable { assert_eq!(pending,before,"no provisional image escapes via any read surface"); }
    else { assert_eq!(pending[0]["body"],"private"); assert_eq!(pending[5],true); assert_eq!(pending[7],1); }
    if !existing && !readable { assert_eq!(pending,vec![json!(null),json!(null),json!([]),json!([]),json!([]),json!(false),json!(false),json!(0),json!(0)]); }
    host.close("read-auth",device);
    let mut device = host.open("read-auth",None).unwrap();
    assert_eq!(observations(&mut device),pending,"persisted reopen before settlement");
    assert_eq!(device.queued().unwrap()[0].predictable,readable);
    let watermark = device.state().unwrap().0;
    sent(&mut engine,"tick",json!({}),vec![]);
    device.apply(&stream_page(&mut engine,"alice",watermark),false).unwrap();
    assert_eq!(observations(&mut device),pending,"restore/replay on reconnect before settlement");
    let watermark = device.state().unwrap().0;
    let seq = sent(&mut engine,op,input,queued.new_ids);
    device.settle(&queued.id,Some(seq)).unwrap();
    device.apply(&stream_page(&mut engine,"alice",watermark),false).unwrap();
    assert!(device.queued().unwrap().is_empty());
    let settled = observations(&mut device);
    if readable { assert_eq!(settled[0]["body"],"private"); }
    else { assert_eq!(settled[0],Json::Null); assert_eq!(settled[5],false); }
    // The authoritative row really exists and is delivered to its reader.
    assert!(engine.store().rows("reports").unwrap().iter().any(|row| row.field("id")==Ok(&id("report"))));
    for reader in ["alice","moderator"] {
        let expected = engine.query("scan",context("alice",&[("reader",id(reader))]).at(100)).unwrap();
        let actual = device.query("scan","alice",&json!({"reader":reader}),100).unwrap();
        assert_eq!(actual.data,expected.data);
    }
}
macro_rules! stores {
    ($memory:ident,$sqlite:ident,$op:expr,$args:expr,$readable:expr,$existing:expr) => {
        #[test] fn $memory() { lifecycle(Memory::new(),$op,$args,$readable,$existing); }
        #[test] fn $sqlite() { lifecycle(Sqlite::new(stringify!($sqlite)),$op,$args,$readable,$existing); }
    }
}
stores!(unreadable_insert_memory,unreadable_insert_sqlite,"submit",json!({"reader":"moderator"}),false,false);
stores!(readable_insert_memory,readable_insert_sqlite,"submit",json!({"reader":"alice"}),true,false);
stores!(unreadable_update_memory,unreadable_update_sqlite,"hide",json!({}),false,true);
stores!(unreadable_upsert_memory,unreadable_upsert_sqlite,"upsertHide",json!({}),false,true);
stores!(mixed_memory,mixed_sqlite,"mixed",json!({}),false,false);

fn unknown_rule<H: Host>(mut host: H) {
    let source = SOURCE.replace("read <- .reader = viewer", "read <- exists grants[.reader, viewer]")
        .replace("sync to .reader", "sync to grants[.reader] by .principal") + r#"
table grants:
  group: principal
  principal: principal
  unique byGroupPrincipal: group, principal
  by byPrincipalGroup: principal, group, id
  by byPrincipal: principal, id
  read <- .principal = viewer
  sync to .principal last 1 by byPrincipal
"#;
    let (mut engine,backend) = compile(&source);
    for (key, group) in [("a","moderator"),("z","other")] {
        let row = json!({"id":key,"group":group,"principal":"alice"});
        engine.seed([("grants".into(),wire::row_from_json(&engine.schema().tables["grants"],&row).unwrap())]).unwrap();
    }
    let mut device = host.open("unknown",Some(backend)).unwrap();
    for (i,page) in snapshot_pages(&mut engine,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    let queued = admit(&mut device,"submit",json!({"reader":"moderator"}));
    assert!(!queued.predictable && queued.predicted.is_empty());
    let pending = observations(&mut device);
    assert_eq!(pending[0],Json::Null);
    host.close("unknown",device);
    let mut device = host.open("unknown",None).unwrap();
    assert_eq!(observations(&mut device),pending);
    let from = device.state().unwrap().0;
    sent(&mut engine,"tick",json!({}),vec![]);
    device.apply(&stream_page(&mut engine,"alice",from),false).unwrap();
    assert_eq!(observations(&mut device),pending);
    let from = device.state().unwrap().0;
    let seq = sent(&mut engine,"submit",json!({"reader":"moderator"}),queued.new_ids);
    device.settle(&queued.id,Some(seq)).unwrap();
    device.apply(&stream_page(&mut engine,"alice",from),false).unwrap();
    assert!(device.queued().unwrap().is_empty());
    // The server can authorize this row although the authorizing grant is
    // outside the device horizon. Delivered reads retain that authorization.
    assert_eq!(observations(&mut device)[0]["body"],"private");
}
#[test] fn unevaluable_rule_memory() { unknown_rule(Memory::new()); }
#[test] fn unevaluable_rule_sqlite() { unknown_rule(Sqlite::new("unknown-rule")); }
