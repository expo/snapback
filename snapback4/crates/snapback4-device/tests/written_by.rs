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
    let q=Queued { upload: None, id:"mark".into(),seq:1,op:"markRead".into(),args:input.clone(),viewer:"bob".into(),now:1000,new_ids:vec![],predicted:vec![],predictable:true,sent_seq:None,receipt_store:None,observed_seq:None, dispatch: None };
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
            let outcome=call(&mut e,op,"alice",input,op);
            if transition { refused(&outcome,"E_FIELD_AUTHORITY"); }
            else { sent(&outcome); }
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

#[test]
fn unreadable_field_owner_receives_no_images_or_tombstones() {
    fn run<H: Host>(host: &mut H) {
        let source = TRANSFER.replace("  owner: principal", "  owner: principal\n  reader: principal default viewer")
            .replace("read <- .owner = viewer", "read <- .reader = viewer")
            .replace("sync to .owner", "sync to .reader");
        let source = format!("{source}\nmutation readership(id: records, reader: principal):\n  update records[id] {{ reader }}\nmutation remove(id: records):\n  delete records[id]\n").replace("  update <- allow", "  update <- allow\n  delete <- .reader = viewer");
        let (mut e, backend) = compile(&source);
        let mut bob = host.open("bob", Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut e, "bob", 100).iter().enumerate() { bob.apply(page, n == 0).unwrap(); }
        // System seeding must not grant its own read bypass to Bob.
        for id in ["never-readable", "revoked"] {
            let row = json!({"id":id,"owner":"bob","reader":"alice","secret":73,"label":0});
            e.seed([("records".into(), wire::row_from_json(&e.schema().tables["records"], &row).unwrap())]).unwrap();
        }
        assert_eq!(query(&mut e, "one", "bob", json!({"id":"never-readable"})), Json::Null);
        let page = stream_page(&mut e, "bob", bob.state().unwrap().0);
        assert!(page.events.is_empty(), "{}", page_json(&page));
        bob.apply(&page, false).unwrap();
        for page in snapshot_pages(&mut e, "bob", 100) { assert!(page.events.is_empty()); }
        sent(&call(&mut e, "edit", "alice", json!({"id":"never-readable","label":1}), "edit"));
        sent(&call(&mut e, "remove", "alice", json!({"id":"never-readable"}), "delete"));
        let page = stream_page(&mut e, "bob", bob.state().unwrap().0);
        assert!(page.events.is_empty(), "{}", page_json(&page));
        bob.apply(&page, false).unwrap();
        sent(&call(&mut e, "readership", "alice", json!({"id":"revoked","reader":"bob"}), "grant"));
        let page = stream_page(&mut e, "bob", bob.state().unwrap().0);
        bob.apply(&page, false).unwrap();
        assert_eq!(wire::to_json(&bob.query("one", "bob", &json!({"id":"revoked"}), 1000).unwrap().data)["secret"], 73);
        sent(&call(&mut e, "readership", "bob", json!({"id":"revoked","reader":"alice"}), "revoke"));
        let page = stream_page(&mut e, "bob", bob.state().unwrap().0);
        assert!(page_json(&page)["events"].as_array().unwrap().iter().any(|event| event["kind"] == "del" && event["id"] == "revoked"));
        bob.apply(&page, false).unwrap();
        assert_eq!(wire::to_json(&bob.query("one", "bob", &json!({"id":"revoked"}), 1000).unwrap().data), Json::Null);
        sent(&call(&mut e, "remove", "alice", json!({"id":"revoked"}), "delete-revoked"));
        assert!(stream_page(&mut e, "bob", bob.state().unwrap().0).events.is_empty());
        let tx = e.store_mut().read_transaction().unwrap();
        assert!(tx.read_log("p:bob", 0, 1000).unwrap().iter().all(|event| event.id != "never-readable"));
        tx.rollback().unwrap();
        host.close("bob", bob);
    }
    run(&mut Memory::new()); run(&mut Sqlite::new("unreadable-owner"));
}

#[test]
fn combined_transfer_and_private_patch_uses_the_old_owner() {
    let source = TRANSFER.replace("read <- .owner = viewer", "public 'shared rows'").replace("sync to .owner", "sync public");
    let source = format!("{source}\nmutation transferSecret(id: records, owner: principal, secret: int):\n  update records[id] {{ owner, secret }}\n");
    for disk in [false, true] {
        let (memory, backend) = compile(&source);
        let host = Sqlite::new("combined-transfer");
        let mut e = if disk { Engine::new(snapback4_core::store::Store::open(&host.path("server")).unwrap(), backend.schema, backend.programs).unwrap() } else { memory };
        sent(&call(&mut e, "make", "alice", json!({}), "row"));
        refused(&call(&mut e, "transferSecret", "bob", json!({"id":"row","owner":"bob","secret":19}), "steal"), "E_FIELD_AUTHORITY");
        assert_eq!(query(&mut e, "one", "alice", json!({"id":"row"}))["secret"], 73);
        assert_eq!(query(&mut e, "one", "alice", json!({"id":"row"}))["owner"], "alice");
        sent(&call(&mut e, "transferSecret", "alice", json!({"id":"row","owner":"bob","secret":29}), "give"));
        assert_eq!(query(&mut e, "one", "bob", json!({"id":"row"}))["secret"], 29);
        assert!(query(&mut e, "one", "alice", json!({"id":"row"})).get("secret").is_none());
    }
}

#[test]
fn absent_upsert_and_hidden_target_have_indistinguishable_refusals() {
    for disk in [false, true] { for insert in [".owner = viewer", "allow"] {
        let mut outcomes = Vec::new();
        for exists in [false, true] {
            let (memory, backend) = compile(&TRANSFER.replace("insert <- .owner = viewer", &format!("insert <- {insert}")));
            let host = Sqlite::new("upsert-authority");
            let mut e = if disk { Engine::new(snapback4_core::store::Store::open(&host.path("server")).unwrap(), backend.schema, backend.programs).unwrap() } else { memory };
            if exists { sent(&call(&mut e, "make", "bob", json!({}), "target")); }
            let out = call(&mut e, "put", "alice", json!({"id":"target"}), "put");
            refused(&out, "NOT_FOUND");
            assert_eq!(query(&mut e, "one", "bob", json!({"id":"target"}))["secret"], if exists { json!(73) } else { Json::Null });
            outcomes.push(out);
        }
        // Compare the original refusal (including detail), not the sanitized receipt.
        assert_eq!(outcomes[0].state, outcomes[1].state);
        assert_eq!(outcomes[0].metered, outcomes[1].metered);
    }}
}

fn held_owned_patch_without_delivery_witness<H: Host>(host: &mut H, online_access: bool) {
    let access_sync = if online_access { "online only" } else { "sync to .principal last 1 by byPrincipal" };
    let second_owner = if online_access { "" } else { "  other: principal\n  otherSecret: int default 0 written by .other\n" };
    let source = format!(r#"
table access:
  room: text <=20
  principal: principal
  unique room, principal
  by byPrincipal: principal, id
  read <- .principal = viewer
  {access_sync}
table notes:
  room: text <=20
  owner: principal
  secret: int default 0 written by .owner
{second_owner}  read <- exists access[.room, viewer]
  sync to access[.room]
mutation mark(id: notes) predicts:
  update notes[id] {{ secret: 9 }}
  return true
query one(id: notes):
  return notes[id]
"#);
    let (mut e, backend) = compile(&source);
    let mut row = json!({"id":"note","room":"room","owner":"alice","secret":1});
    if !online_access { row["other"] = json!("bob"); row["otherSecret"] = json!(73); }
    let rows = [("access", json!({"id":"a","room":"room","principal":"alice"})),
        ("access", json!({"id":"b","room":"room","principal":"bob"})), ("notes", row)];
    e.seed(rows.into_iter().map(|(table, row)| (table.into(), wire::row_from_json(&e.schema().tables[table], &row).unwrap())).collect::<Vec<_>>()).unwrap();
    let mut device = host.open("alice", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut e, "alice", 100).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let access = device.store().raw_rows("access");
    assert_eq!(access.len(), usize::from(!online_access));
    assert!(access.iter().all(|row| row.field("principal") == Ok(&id("alice"))));
    let held = device.store().raw_rows("notes");
    assert_eq!(held.len(), 1);
    assert_eq!(held[0].field("secret"), Ok(&Value::Int(1)));
    assert!(held[0].field("otherSecret").is_err());
    let prediction = device.predict("mark", "alice", &json!({"id":"note"}), 1000, vec![], 1).unwrap();
    assert_eq!(prediction.predicted.len(), 1);
    let seq = sent(&call(&mut e, "mark", "alice", json!({"id":"note"}), "mark"));
    device.apply(&stream_page(&mut e, "alice", device.state().unwrap().0), false).unwrap();
    assert_eq!(wire::to_json(&device.query("one", "alice", &json!({"id":"note"}), 1000).unwrap().data)["secret"], 9);
    // Server recipient probes remain exact, including Bob's locally absent membership.
    let tx = e.store_mut().read_transaction().unwrap();
    let owner = if online_access { "p:alice" } else { "p:bob" };
    assert!(tx.read_log(owner, seq - 1, 100).unwrap().iter().any(|event| event.id == "note"
        && event.data.as_ref().is_some_and(|row| row.field(if online_access { "secret" } else { "otherSecret" }) == Ok(&Value::Int(if online_access { 9 } else { 73 })))));
    tx.rollback().unwrap();
    host.close("alice", device);
}

#[test]
fn held_owned_patch_predicts_with_online_only_access() {
    held_owned_patch_without_delivery_witness(&mut Memory::new(), true);
    held_owned_patch_without_delivery_witness(&mut Sqlite::new("online-access"), true);
}

#[test]
fn held_owned_patch_predicts_without_the_other_owners_membership() {
    held_owned_patch_without_delivery_witness(&mut Memory::new(), false);
    held_owned_patch_without_delivery_witness(&mut Sqlite::new("other-membership"), false);
}

#[test]
fn group_and_sort_use_null_for_projected_private_keys() {
    fn run<H: Host>(host: &mut H) {
        let source = TRANSFER.replace("read <- .owner = viewer", "public 'shared rows'").replace("sync to .owner", "sync public");
        let source = format!("{source}\nquery grouped():\n  rows = records first 10\n  return group(rows, 'secret')\nquery sorted():\n  rows = records first 10\n  return sort(rows, 'secret', '-id')\nquery missing():\n  rows = records first 10\n  return sort(rows, 'nonexistent')\n");
        let (mut e, backend) = compile(&source);
        // The owner's secret order differs from the non-owner's null-key
        // tie-break order, so ignoring the private sort key cannot pass.
        for (id, secret) in [("a", 3), ("b", 7)] {
            let row = json!({"id":id,"owner":"bob","secret":secret,"label":0});
            e.seed([("records".into(), wire::row_from_json(&e.schema().tables["records"], &row).unwrap())]).unwrap();
        }
        for viewer in ["alice", "bob"] {
            let mut device = host.open(viewer, Some(backend.clone())).unwrap();
            for (n, page) in snapshot_pages(&mut e, viewer, 100).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
            for op in ["grouped", "sorted"] {
                let result = query(&mut e, op, viewer, json!({}));
                assert_eq!(wire::to_json(&device.query(op, viewer, &json!({}), 1000).unwrap().data), result);
                if op == "grouped" {
                    assert_eq!(result.as_array().unwrap().len(), if viewer == "bob" { 2 } else { 1 });
                    assert_eq!(result[0]["key"], if viewer == "bob" { json!(3) } else { Json::Null });
                } else {
                    assert_eq!(result[0]["id"], if viewer == "bob" { "a" } else { "b" });
                    assert_eq!(result[1]["id"], if viewer == "bob" { "b" } else { "a" });
                    assert_eq!(result[0].get("secret").cloned(), (viewer == "bob").then_some(json!(3)));
                }
            }
            assert_eq!(e.query("missing", context(viewer, &[])).unwrap_err().code, "E_FIELD");
            assert_eq!(device.query("missing", viewer, &json!({}), 1000).unwrap_err().code, "E_FIELD");
            host.close(viewer, device);
        }
        let bad = source.replace("group(rows, 'secret')", "group(rows, 'nonexistent')");
        let b = snapback4_lang::compile(&[("bad.q".into(), bad)]);
        assert!(b.diagnostics.iter().any(|d| d.message.contains("no column nonexistent")));
    }
    run(&mut Memory::new()); run(&mut Sqlite::new("private-operators"));
}

#[test]
fn projection_heap_does_not_charge_omitted_private_payload() {
    let source = "table records:\n  owner: principal\n  secret: text <=1000000 default '' written by .owner\n  public\n  sync public\nquery existsRow(id: records):\n  return exists records[id]\n";
    let mut costs = Vec::new();
    for bytes in [0, 1_000_000] {
        let (mut e, _) = compile(source);
        let row = json!({"id":"row","owner":"bob","secret":"s".repeat(bytes)});
        e.seed([("records".into(), wire::row_from_json(&e.schema().tables["records"], &row).unwrap())]).unwrap();
        let ctx = || context("alice", &[("id", id("row"))]);
        let out = e.query("existsRow", ctx()).unwrap();
        assert_eq!(out.data, Value::Bool(true));
        costs.push(out.metered.heap_bytes);
        // The declared decoder reservation applies even to the empty world.
        // Removing the reservation makes this control spuriously complete.
        let reserved = snapback4_core::rows::disclosed::decode_reservation(&e.schema().tables["records"]);
        e.set_ceilings(snapback4_core::meter::Ceilings { heap_bytes: reserved - 1, ..Default::default() });
        let cut = e.query("existsRow", ctx()).unwrap();
        assert!(!cut.complete);
        assert_eq!(cut.data, Value::Null);
        costs.push(cut.metered.heap_bytes);
    }
    assert_eq!(&costs[..2], &costs[2..], "private size is hidden before and after exhaustion");
}

#[test]
fn projecting_an_already_absent_field_keeps_the_shared_map() {
    let (_, backend) = compile(TRANSFER);
    for row in [Value::Row, Value::Map] {
        let fields = std::collections::BTreeMap::from([
            ("id".into(), id("row")), ("owner".into(), id("bob")), ("label".into(), Value::String("x".repeat(100_000)))
        ]).into();
        let value = row(fields);
        let projected = backend.schema.tables["records"].project_fields(value.clone(), Some("alice")).into_value();
        let (Value::Row(original) | Value::Map(original), Value::Row(projected) | Value::Map(projected)) = (&value, &projected) else { panic!() };
        assert!(original.shares_image(projected));
    }
}

#[test]
fn device_projection_hides_physical_private_field_presence() {
    use snapback4_core::{Ceilings, engine::local, rows::Rows};
    use snapback4_device::store::{DeviceStore, DeviceTx};
    fn run<S: DeviceStore>(mut store: S) {
        let source = "table records:\n  owner: principal\n  secret: time default now written by .owner\n  body: text <=200000\n  public\n  sync public\nquery existsRow(id: records):\n  return exists records[id]\n";
        let (_, backend) = compile(source);
        store.install(&backend.schema, &Default::default(), false).unwrap();
        let tx = store.transaction().unwrap();
        let ctx = || context("alice", &[("id", id("row"))]);
        let mut costs = Vec::new();
        for present in [false, true] {
            let mut row = json!({"id":"row","owner":"bob","body":"x".repeat(100_000)});
            if present { row["secret"] = json!(1000); }
            let row = wire::row_from_json(&backend.schema.tables["records"], &row).unwrap();
            let old = tx.get("records", "row").unwrap();
            tx.put("records", &backend.schema.tables["records"], &row, old.as_ref()).unwrap();
            let out = local::query(&tx, &backend.schema, &backend.programs[0], ctx(), Ceilings::default()).unwrap();
            assert_eq!(out.data, Value::Bool(true));
            costs.push(out.metered.heap_bytes);
            let limited = local::query(&tx, &backend.schema, &backend.programs[0], ctx(), Ceilings { heap_bytes: 2048, ..Default::default() });
            let cut = limited.unwrap();
            assert!(!cut.complete && cut.data == Value::Null);
            assert_eq!(cut.capped_at.unwrap().0, snapback4_core::error::MeterKind::HeapBytes);
        }
        assert_eq!(costs[0],costs[1],"physical presence of an omitted private field is hidden");
        tx.rollback().unwrap();
    }
    run(snapback4_device::memory::MemoryStore::new());
    run(snapback4_core::store::Store::memory().unwrap());
}
