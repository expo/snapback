//! A provisional row must earn read authority; delivered rows keep theirs.
mod common;
#[path = "readauth/census.rs"]
mod census;
#[path = "readauth/outcomes.rs"]
mod outcomes;
#[path = "readauth/timing.rs"]
mod timing;
#[path = "readauth/regressions.rs"]
mod regressions;
#[path = "readauth/round2.rs"]
mod round2;
use common::*;
use serde_json::{Value as Json, json};
use snapback4_core::{Engine, WriteState, wire};
use snapback4_device::{device::{Device, Queued}, store::DeviceStore};

const SOURCE: &str = include_str!("readauth/reports.q");

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
    observations_with_coverage(device, false)
}
fn observations_with_coverage<S: DeviceStore>(device: &mut Device<S>, unknown: bool) -> Vec<Json> {
    [
        ("point",json!({"id":"report"})), ("point",json!({"id":"own"})),
        ("scan",json!({"reader":"alice"})), ("scan",json!({"reader":"moderator"})),
        ("merged",json!({})), ("probe",json!({"id":"report"})),
        ("probe",json!({"id":"own"})), ("total",json!({"reader":"alice"})),
        ("total",json!({"reader":"moderator"})),
        ("page",json!({"reader":"alice","c":null})), ("page",json!({"reader":"moderator","c":null})),
    ].into_iter().map(|(op,args)| {
        let (result, missing, _) = device.query_with_coverage(op,"alice",&args,100);
        let result = result.unwrap();
        let affected = !matches!(op,"point"|"probe") || args["id"] == "report";
        // Empty scans of a different reader never encounter the candidate.
        let affected = affected && args.get("reader").is_none_or(|reader| reader == "moderator");
        assert_eq!(missing, unknown && affected, "{op}/{args}: {result:?}");
        assert_eq!(result.complete, !(unknown && affected), "{op}/{args}: {result:?}");
        assert!(result.cut.is_none(), "{op}: {result:?}");
        wire::to_json(&result.data)
    }).collect()
}
fn lifecycle<H: Host>(mut host: H, op: &str, input: Json, readable: bool, existing: bool) {
    let (mut engine, backend) = compile(SOURCE);
    assert_eq!(backend.schema.operations[op].predicts.as_deref(), Some("eligible"));
    if existing { sent(&mut engine,"submit",json!({"reader":"alice"}),vec![]); }
    let mut device = host.open("read-auth",Some(backend)).unwrap();
    for (i,page) in snapshot_pages(&mut engine,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    let queued = admit(&mut device,op,input.clone());
    assert!(queued.predictable,"{} {op}: {queued:?}",host.label());
    assert_eq!(queued.predicted.len(),if op=="mixed" {2} else {1});
    let pending = observations(&mut device);
    let body=if op=="change" || op=="upsertChange" {"changed"} else {"private"};
    let row=json!({"id":"report","writer":"alice","reader":"alice","body":body,"pending":true});
    let own=json!({"id":"own","writer":"alice","reader":"alice","body":"own","pending":true});
    let visible=if readable {vec![row.clone()]} else if op=="mixed" {vec![own.clone()]} else {vec![]};
    assert_eq!(pending,vec![if readable {row} else {Json::Null},if op=="mixed" {own} else {Json::Null},
        json!(visible),json!([]),json!(visible),json!(readable),json!(op=="mixed"),json!(visible.len()),json!(0),json!(visible),json!([])]);
    host.close("read-auth",device);
    let mut device = host.open("read-auth",None).unwrap();
    assert_eq!(observations(&mut device),pending,"persisted reopen before settlement");
    assert!(device.queued().unwrap()[0].predictable);
    let watermark = device.state().unwrap().0;
    sent(&mut engine,"tick",json!({}),vec![]);
    let page=stream_page(&mut engine,"alice",watermark);
    assert!(!page.events.is_empty() && page.watermark>watermark);
    device.apply(&page,false).unwrap();
    assert_eq!(device.query("ticksRead","alice",&json!({}),100).unwrap().data.as_array().unwrap().len(),1);
    assert_eq!(observations(&mut device),pending,"restore/replay on reconnect before settlement");
    let watermark = device.state().unwrap().0;
    let seq = sent(&mut engine,op,input,queued.new_ids);
    device.settle(&queued.id,Some(seq)).unwrap();
    device.apply(&stream_page(&mut engine,"alice",watermark),false).unwrap();
    assert!(device.queued().unwrap().is_empty());
    let settled = observations(&mut device);
    let expected:Vec<_>=pending.iter().map(|value| {
        fn confirmed(mut value:Json)->Json {
            match &mut value { Json::Object(row)=>{row.remove("pending");},Json::Array(rows)=>{for row in rows { *row=confirmed(row.take()); }},_=>{} }
            value
        }
        confirmed(value.clone())
    }).collect();
    assert_eq!(settled,expected,"all settled read paths");
    let moderator=engine.query("scan",context("moderator",&[("reader",id("moderator"))]).at(100)).unwrap();
    assert_eq!(moderator.data.as_array().unwrap().len(),usize::from(!readable));
    assert!(engine.store().rows("reports").unwrap().iter().any(|row|row.field("id")==Ok(&id("report"))));
    if op=="mixed" { assert_eq!(engine.store().rows("reports").unwrap().len(),2); }

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
stores!(readable_update_memory,readable_update_sqlite,"change",json!({}),true,true);
stores!(readable_upsert_memory,readable_upsert_sqlite,"upsertChange",json!({}),true,true);
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
query grantAt():
  return grants['a']
"#;
    assert_eq!(SOURCE.matches("read <- .reader = viewer").count(),1);
    assert_eq!(SOURCE.matches("sync to .reader").count(),1);
    let (mut engine,backend) = compile(&source);
    assert!(matches!(&backend.schema.tables["reports"].rules.read, snapback4_core::schema::RuleExpr::Exists{table,..} if table=="grants"));
    for (key, group) in [("a","moderator"),("z","other")] {
        let row = json!({"id":key,"group":group,"principal":"alice"});
        engine.seed([("grants".into(),wire::row_from_json(&engine.schema().tables["grants"],&row).unwrap())]).unwrap();
    }
    let mut device = host.open("unknown",Some(backend)).unwrap();
    for (i,page) in snapshot_pages(&mut engine,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    let grant=device.query("grantAt","alice",&json!({}),100).unwrap();
    assert_eq!(grant.data,snapback4_core::Value::Null);
    assert!(!grant.complete,"the positive server grant is outside the acquired horizon");
    let queued = admit(&mut device,"submit",json!({"reader":"moderator"}));
    assert!(queued.predictable && queued.predicted.len()==1);
    let pending = observations_with_coverage(&mut device,true);
    assert_eq!(pending,vec![json!(null),json!(null),json!([]),json!([]),json!([]),json!(false),json!(false),json!(0),json!(0),json!([]),json!([])]);
    host.close("unknown",device);
    let mut device = host.open("unknown",None).unwrap();
    assert_eq!(observations_with_coverage(&mut device,true),pending);
    let from = device.state().unwrap().0;
    sent(&mut engine,"tick",json!({}),vec![]);
    device.apply(&stream_page(&mut engine,"alice",from),false).unwrap();
    assert_eq!(observations_with_coverage(&mut device,true),pending);
    let from = device.state().unwrap().0;
    let seq = sent(&mut engine,"submit",json!({"reader":"moderator"}),queued.new_ids);
    device.settle(&queued.id,Some(seq)).unwrap();
    device.apply(&stream_page(&mut engine,"alice",from),false).unwrap();
    assert!(device.queued().unwrap().is_empty());
    // The server can authorize this row although the authorizing grant is
    // outside the device horizon. Delivered reads retain that authorization.
    let row=json!({"id":"report","writer":"alice","reader":"moderator","body":"private"});
    assert_eq!(observations(&mut device),vec![row.clone(),json!(null),json!([]),json!([row]),json!([row]),json!(true),json!(false),json!(0),json!(1),json!([]),json!([row])]);
}
#[test] fn unevaluable_rule_memory() { unknown_rule(Memory::new()); }
#[test] fn unevaluable_rule_sqlite() { unknown_rule(Sqlite::new("unknown-rule")); }
