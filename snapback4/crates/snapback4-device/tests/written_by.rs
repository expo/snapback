//! One authority/projection scenario on both persistent device stores, plus
//! the same engine assertions on in-memory and on-disk SQLite servers.
mod common;
use common::*;
use serde_json::{json, Value as Json};
use snapback4_core::{Context, Engine, MutationOutcome, Value, WriteState, wire};
use snapback4_device::device::Queued;
const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/written-by.q");
const ADMIN: &str = "update <- exists members[conversationId = .conversationId, principal = viewer, role = 'admin']";
const SECRET: i64 = 8247913;
fn seed(engine: &mut Engine) {
    let rows=[("conversations",json!({"id":"c","creator":"admin"})),
        ("members",json!({"id":"a","conversationId":"c","principal":"admin","role":"admin","readUpTo":0})),
        ("members",json!({"id":"b","conversationId":"c","principal":"bob","role":"member","readUpTo":SECRET}))];
    let rows=rows.into_iter().map(|(table,row)|(table.into(),wire::row_from_json(&engine.schema().tables[table],&row).unwrap())).collect::<Vec<_>>();
    engine.seed(rows).unwrap();
}
fn inputs(engine: &Engine, op: &str, input: Json) -> std::collections::BTreeMap<String,Value> {
    let program=engine.programs().find(|p|p.name==op).unwrap();
    input.as_object().unwrap().iter().map(|(key,value)|(key.clone(),wire::from_json(&program.args[key],value).unwrap())).collect()
}
fn call(engine: &mut Engine, op: &str, viewer: &str, input: Json, write: &str) -> MutationOutcome {
    let args=inputs(engine,op,input);
    engine.mutate(op,Some(write),Context::new(viewer,args).at(1000).with_ids([write.into()])).unwrap()
}
fn sent(out: &MutationOutcome) -> u64 {
    match &out.state { WriteState::Sent { seq, .. } => *seq, _ => panic!("{out:?}") }
}
fn refused(out: &MutationOutcome, code: &str) { assert_eq!(out.receipt(None)["why"]["code"],code,"{out:?}"); }
fn query(engine: &mut Engine, op: &str, viewer: &str, input: Json) -> Json {
    let args=inputs(engine,op,input);
    wire::to_json(&engine.query(op,Context::new(viewer,args).at(1000)).unwrap().data)
}
#[test]
fn engine_authority_and_transition_on_memory_and_sqlite() {
    for disk in [false,true] { for transition in [false,true] {
        let source=if transition { SOURCE.replace(ADMIN,"update (old, next) <- next.readUpTo >= old.readUpTo") } else { SOURCE.into() };
        let (memory,backend)=compile(&source);
        let host=Sqlite::new("field-engine");
        let mut e=if disk { Engine::new(snapback4_core::store::Store::open(&host.path("server")).unwrap(),backend.schema,backend.programs).unwrap() } else { memory };
        seed(&mut e);
        refused(&call(&mut e,"addMark","admin",json!({"conversationId":"c","principal":"charlie","readUpTo":99}),"bad-insert"),"E_FIELD_AUTHORITY");
        let supplied=call(&mut e,"createOwn","dora",json!({"conversationId":"d","readUpTo":99}),"owner-insert");
        sent(&supplied);
        assert_eq!(query(&mut e,"one","dora",json!({"memberId":"owner-insert"}))["readUpTo"],99);
        sent(&call(&mut e,"add","admin",json!({"conversationId":"c","principal":"charlie"}),"charlie"));
        assert_eq!(query(&mut e,"one","charlie",json!({"memberId":"charlie"}))["readUpTo"],0);
        sent(&call(&mut e,"admin","admin",json!({"memberId":"b"}),"admin-other"));
        refused(&call(&mut e,"markRead","admin",json!({"memberId":"b","readUpTo":SECRET+1}),"bad-mark"),"E_FIELD_AUTHORITY");
        refused(&call(&mut e,"mixed","admin",json!({"memberId":"b","readUpTo":SECRET}),"bad-mixed"),"E_FIELD_AUTHORITY");
        sent(&call(&mut e,"markRead","bob",json!({"memberId":"b","readUpTo":SECRET+1}),"own"));
        if transition { refused(&call(&mut e,"markRead","bob",json!({"memberId":"b","readUpTo":0}),"decrease"),"E_RULE"); }
        else { refused(&call(&mut e,"mixed","bob",json!({"memberId":"b","readUpTo":SECRET+1}),"own-mixed"),"E_RULE"); }
        for op in ["add","addIfAbsent","put"] {
            let out=call(&mut e,op,"admin",json!({"conversationId":"c","principal":op}),op);
            sent(&out);
            assert!(!serde_json::to_string(&out.reply(None)).unwrap().contains("readUpTo"),"{out:?}");
        }
        assert_eq!(query(&mut e,"mark","admin",json!({"memberId":"b"})),Json::Null);
        assert_eq!(query(&mut e,"mark","bob",json!({"memberId":"b"})),SECRET+1);
        refused(&call(&mut e,"checked","admin",json!({"memberId":"b","expected":SECRET+1}),"conflict"),"E_CONFLICT");
    }}
    for disk in [false,true] {
        let (memory,backend)=compile(&SOURCE.replace(ADMIN,""));
        let host=Sqlite::new("no-update-rule");
        let mut e=if disk { Engine::new(snapback4_core::store::Store::open(&host.path("server")).unwrap(),backend.schema,backend.programs).unwrap() } else { memory };
        seed(&mut e);
        sent(&call(&mut e,"markRead","bob",json!({"memberId":"b","readUpTo":SECRET+1}),"no-update-rule"));
    }
}
fn devices<H:Host>(host:&mut H, audience:bool, offline:bool) {
    let source=SOURCE.replace(ADMIN,"update (old, next) <- next.readUpTo >= old.readUpTo").replace("written by .principal", if audience { "written by .principal readable by audience" } else { "written by .principal" });
    let (mut e,backend)=compile(&source);seed(&mut e);
    let mut bob=host.open("bob",Some(backend.clone())).unwrap();
    let mut second=host.open("second",Some(backend.clone())).unwrap();
    let mut admin=host.open("admin",Some(backend)).unwrap();
    let admin_pages=snapshot_pages(&mut e,"admin",1);
    for (n,p) in admin_pages.iter().enumerate() {
        if !audience { assert!(!page_json(p).to_string().contains(&SECRET.to_string())); }
        admin.apply(p,n==0).unwrap();
    }
    for (n,p) in snapshot_pages(&mut e,"bob",1).iter().enumerate() { bob.apply(p,n==0).unwrap();second.apply(p,n==0).unwrap(); }
    let read=|device:&mut snapback4_device::device::Device<H::Store>,viewer:&str|wire::to_json(&device.query("one",viewer,&json!({"memberId":"b"}),1000).unwrap().data);
    assert_eq!(read(&mut bob,"bob")["readUpTo"],SECRET);
    assert_eq!(read(&mut admin,"admin").get("readUpTo").cloned(), audience.then_some(json!(SECRET)));
    let input=json!({"memberId":"b","readUpTo":SECRET+10});
    let q=Queued { id:"mark".into(),seq:1,op:"markRead".into(),args:input.clone(),viewer:"bob".into(),now:1000,new_ids:vec![],predicted:vec![],predictable:true,sent_seq:None,receipt_store:None,observed_seq:None };
    let admitted=bob.admit(q).unwrap(); assert!(admitted.predictable,"{admitted:?}");assert_eq!(admitted.predicted.len(),1);
    assert_eq!(read(&mut bob,"bob")["readUpTo"],SECRET+10);
    assert_eq!(read(&mut bob,"bob")["pending"],true);
    if offline {
        host.close("bob",bob);bob=host.open("bob",None).unwrap();
        assert_eq!(read(&mut bob,"bob")["readUpTo"],SECRET+10);
        assert_eq!(read(&mut second,"bob")["readUpTo"],SECRET);
    }
    let out=call(&mut e,"markRead","bob",input,"mark");let seq=sent(&out);
    bob.settle("mark",Some(seq)).unwrap();
    for (viewer,device) in [("bob",&mut bob),("bob",&mut second),("admin",&mut admin)] {
        let page=stream_page(&mut e,viewer,device.state().unwrap().0);
        if viewer=="admin" && !audience { assert!(!page_json(&page).to_string().contains(&(SECRET+10).to_string())); }
        device.apply(&page,false).unwrap();
    }
    assert!(bob.queued().unwrap().is_empty());
    assert_eq!(read(&mut second,"bob")["readUpTo"],SECRET+10);
    assert_eq!(read(&mut admin,"admin").get("readUpTo").cloned(),audience.then_some(json!(SECRET+10)));
    assert_eq!(query(&mut e,"one","admin",json!({"memberId":"b"})).get("readUpTo").cloned(),audience.then_some(json!(SECRET+10)));
    let shaped=query(&mut e,"shaped","admin",json!({"conversationId":"c"}));
    if !audience { assert!(!shaped.to_string().contains(&(SECRET+10).to_string())); }
    let page=query(&mut e,"page","admin",json!({"conversationId":"c","c":null}));
    if !audience { assert!(!page.to_string().contains(&(SECRET+10).to_string())); }
    let tx=e.store_mut().read_transaction().unwrap();
    let group=snapback4_core::partition::group_partition("members",&[id("c")]);
    let images=tx.read_log(&group,0,1000).unwrap();
    assert!(images.iter().any(|event|event.id=="b"));
    if !audience { for event in &images { if let Some(row)=&event.data { assert!(row.field("readUpTo").is_err(),"{event:?}"); } } }
    let own=tx.read_log(&snapback4_core::partition::partition_of("bob"),0,1000).unwrap();
    assert!(audience || own.iter().any(|event|event.data.as_ref().is_some_and(|row|row.field("readUpTo")==Ok(&Value::Int(SECRET+10)))));
    tx.rollback().unwrap();
    host.close("bob",bob);host.close("second",second);host.close("admin",admin);
}
#[test]
fn private_wire_and_prediction_on_both_stores_online_and_offline() {
    for audience in [false,true] { for offline in [false,true] {
        devices(&mut Memory::new(),audience,offline);
        devices(&mut Sqlite::new("written-by"),audience,offline);
    }}
}

const TRANSFER: &str = r#"
table records:
  owner: principal
  secret: int default 0 written by .owner
  label: int default 0
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- allow
  sync to .owner
mutation make():
  return insert records { owner: viewer, secret: 73 }
mutation transfer(id: records, owner: principal):
  update records[id] { owner }
mutation edit(id: records, label: int):
  update records[id] { label }
mutation secret(id: records):
  update records[id] { secret: 7 }
mutation put(id: records):
  upsert records[id] { owner: 'bob', secret: 7 }
query one(id: records):
  return records[id]
"#;
#[test]
fn owner_transfer_revokes_or_redacts_on_both_stores() {
    fn run<H:Host>(host:&mut H, public:bool) {
        let source=if public { TRANSFER.replace("read <- .owner = viewer","public 'shared rows'").replace("sync to .owner","sync public") } else { TRANSFER.into() };
        let (mut e,backend)=compile(&source);
        sent(&call(&mut e,"make","alice",json!({}),"row"));
        let mut a=host.open("a",Some(backend.clone())).unwrap();let mut b=host.open("b",Some(backend)).unwrap();
        for (viewer,device) in [("alice",&mut a),("bob",&mut b)] { for (n,p) in snapshot_pages(&mut e,viewer,100).iter().enumerate() { device.apply(p,n==0).unwrap(); } }
        sent(&call(&mut e,"transfer","alice",json!({"id":"row","owner":"bob"}),"transfer"));
        for (viewer,device) in [("alice",&mut a),("bob",&mut b)] {
            let page=stream_page(&mut e,viewer,device.state().unwrap().0);
            if viewer=="alice" { assert!(!page_json(&page).to_string().contains("73")); }
            device.apply(&page,false).unwrap();
        }
        let old=wire::to_json(&a.query("one","alice",&json!({"id":"row"}),1000).unwrap().data);
        if public { assert!(old.is_object() && old.get("secret").is_none(),"{old}"); } else { assert_eq!(old,Json::Null); }
        assert_eq!(wire::to_json(&b.query("one","bob",&json!({"id":"row"}),1000).unwrap().data)["secret"],73);
        if !public {
            let hidden=call(&mut e,"secret","alice",json!({"id":"row"}),"hidden");
            let absent=call(&mut e,"secret","alice",json!({"id":"absent"}),"absent");
            refused(&hidden,"NOT_FOUND");refused(&absent,"NOT_FOUND");
            for id in ["row", "absent"] {
                refused(&call(&mut e,"put","alice",json!({"id":id}),&format!("upsert-{id}")),"NOT_FOUND");
            }
        }
        host.close("a",a);host.close("b",b);
    }
    for public in [false,true] {run(&mut Memory::new(),public);run(&mut Sqlite::new("transfer"),public);}
}
#[test]
fn projection_omissions_are_unknown_only_when_the_transition_needs_them() {
    fn run<H:Host>(host:&mut H, transition:bool) {
        let source=TRANSFER.replace("read <- .owner = viewer","public 'shared rows'").replace("sync to .owner","sync public")
            .replace("  label: int default 0", "  label: int default 0\n  other: principal default viewer\n  ownMark: int default 0 written by .other\n  stamp: time default now written by .owner");
        let source=if transition { source.replace("update <- allow","update (old, next) <- next.label <= old.secret") } else { source };
        let source=format!("{source}\nmutation own(id: records):\n  update records[id] {{ ownMark: 9 }}\n");
        let (mut e,backend)=compile(&source);
        let row=json!({"id":"row","owner":"bob","secret":73,"label":0,"other":"alice","ownMark":0,"stamp":1000});
        e.seed([("records".into(),wire::row_from_json(&e.schema().tables["records"],&row).unwrap())]).unwrap();
        let mut device=host.open("a",Some(backend)).unwrap();
        for (n,p) in snapshot_pages(&mut e,"alice",100).iter().enumerate() {device.apply(p,n==0).unwrap();}
        for (op,input) in [("edit",json!({"id":"row","label":5})),("own",json!({"id":"row"}))] {
            let predicted=device.predict(op,"alice",&input,1000,vec![],1);
            if transition {assert_eq!(predicted.unwrap_err().code(),"E_PREDICT");}
            else {assert_eq!(predicted.unwrap().predicted.len(),1);}
            sent(&call(&mut e,op,"alice",input,op));
        }
        host.close("a",device);
    }
    for transition in [false,true] {run(&mut Memory::new(),transition);run(&mut Sqlite::new("unknown"),transition);}
}
#[test]
fn private_asset_bytes_require_field_visibility() {
    let source=TRANSFER.replace("secret: int default 0 written by .owner","secret: int default 0 written by .owner\n  photo: image <=1000 ? default null written by .owner")
        .replace("read <- .owner = viewer","public 'shared rows'").replace("sync to .owner","sync public");
    let source=format!("{source}\nmutation place(photo: image <=1000 ?):\n  return insert records {{ owner: viewer, photo }}\n");
    for audience in [false,true] {
        let source=if audience {source.replace("photo: image <=1000 ? default null written by .owner","photo: image <=1000 ? default null written by .owner readable by audience")} else {source.clone()};
        let (mut e,_)=compile(&source);
        let mut png=b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();png.extend(1u32.to_be_bytes());png.extend(1u32.to_be_bytes());
        let asset=e.store_asset("alice",&png,1000).unwrap();
        sent(&call(&mut e,"place","alice",json!({"photo":{"id":asset.id}}),"photo"));
        assert!(e.asset_access("alice",&asset.id,1000).is_ok());
        assert!(e.asset_access(snapback4_core::SYSTEM_PRINCIPAL,&asset.id,1000).is_ok());
        assert_eq!(e.asset_access("bob",&asset.id,1000).is_ok(),audience);
        sent(&call(&mut e,"transfer","alice",json!({"id":"photo","owner":"bob"}),"transfer"));
        assert!(e.asset_access("bob",&asset.id,1000).is_ok());
        assert_eq!(e.asset_access("alice",&asset.id,1000).is_ok(),audience);
    }
}

#[test]
fn owned_point_prediction_does_not_need_the_ordinary_server_grant() {
    fn run<H:Host>(host:&mut H) {
        let source=TRANSFER.replace("update <- allow", "update <- exists admins[principal = viewer]")
            .replace("mutation secret(id: records):", "mutation secret(id: records) predicts:");
        let source=format!("table admins:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\n{source}");
        let (mut e,backend)=compile(&source);
        sent(&call(&mut e,"make","alice",json!({}),"row"));
        let mut device=host.open("a",Some(backend)).unwrap();
        for (n,p) in snapshot_pages(&mut e,"alice",100).iter().enumerate() {device.apply(p,n==0).unwrap();}
        assert_eq!(device.predict("secret","alice",&json!({"id":"row"}),1000,vec![],1).unwrap().predicted.len(),1);
        sent(&call(&mut e,"secret","alice",json!({"id":"row"}),"mark"));
        host.close("a",device);
    }
    run(&mut Memory::new());run(&mut Sqlite::new("server-grant"));
}

#[test]
fn private_write_row_selection_with_a_maintained_column_is_optional() {
    let source=r#"
table marks:
  owner: principal
  mark: int default 0 written by .owner
  replies: count replies by markId
  public
  insert <- allow
  online only
table replies:
  markId: marks
  public
  online only
mutation add(owner: principal):
  row = insert marks { owner }
  return row.mark
"#;
    let (mut e,_)=compile(source);
    for (owner,expected) in [("alice",json!(0)),("bob",Json::Null)] {
        let out=call(&mut e,"add","alice",json!({"owner":owner}),owner);
        sent(&out);
        let WriteState::Sent { result,.. }=out.state else {unreachable!()};
        assert_eq!(wire::to_json(&result),expected);
    }
}

#[test]
fn audience_readable_fields_keep_the_ordinary_projection_heap_cost() {
    let mut costs=Vec::new();
    for modifier in ["", " written by .principal readable by audience"] {
        let (mut e,_)=compile(&SOURCE.replace(" written by .principal",modifier));seed(&mut e);
        let args=inputs(&e,"one",json!({"memberId":"b"}));
        let out=e.query("one",Context::new("admin",args).at(1000)).unwrap();
        assert_eq!(out.data.field("readUpTo").unwrap(),&Value::Int(SECRET));
        costs.push(out.metered.heap_bytes);
    }
    assert_eq!(costs[0],costs[1]);
}
