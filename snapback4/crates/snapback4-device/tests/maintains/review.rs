use super::super::common::*;
use serde_json::json;
use snapback4_core::{Context, Value, WriteState};
use snapback4_core::value::object;
use snapback4_device::device::{Backend, Queued, StreamPage};

const HISTORY: &str = r#"
table posts:
  owner: principal
  selected: bool
  score: int
  at: time
  until: time
  by byOwner: owner, at, id
  by byUntil: until
  expire at .until
  read <- .owner = viewer
  delete <- .owner = viewer
  sync last 1 by byOwner
maintain totals: sum posts of score where .selected by owner, day(.at)
  read <- .owner = viewer
mutation remove(row: posts):
  delete posts[row]
query total(owner: principal):
  return totals[owner, 0]
query groups(owner: principal, c: cursor ?):
  return totals[owner] after c first 10 by byGroup
"#;
fn history_row(name: &str, score: i64, at: i64, until: i64) -> (String, Value) {
    ("posts".into(), object([("id",id(name)),("owner",id("alice")),("selected",Value::Bool(true)),("score",Value::Int(score)),("at",Value::Int(at)),("until",Value::Int(until))]))
}
fn snapshot_at(server: &mut snapback4_core::Engine, now: i64) -> StreamPage {
    let (events, watermark, next, held) = server.snapshot_page_with_groups_at("alice",None,100,now).unwrap();
    serde_json::from_value(json!({"snapshot":true,"events":events.iter().map(|e| json!({"table":e.table,"kind":e.kind,"id":e.id,"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),"watermark":watermark,"next":next,"held":held,"more":false,"generation":server.generation()})).unwrap()
}
fn queued(op: &str, input: serde_json::Value, seq: u64, now: i64) -> Queued {
    Queued {id:format!("q{seq}"),seq,op:op.into(),args:input,viewer:"alice".into(),now,new_ids:vec![],predicted:vec![],predictable:true,sent_seq: None, receipt_store: None,observed_seq:None, dispatch: None}
}
fn history<H: Host>(host: &mut H) {
    for mode in ["partial", "witness", "whole"] {
        let text = if mode == "whole" { HISTORY.replace("sync last 1 by byOwner","sync") } else { HISTORY.to_owned() };
        let (mut server, backend) = compile(&text);
        server.seed([history_row("a",1,1,3000),history_row("b",-1,2,1000),history_row("c",2,3,3000)]).unwrap();
        let mut device = host.open(mode,Some(backend)).unwrap();
        device.apply(&snapshot_at(&mut server,500),true).unwrap();
        if mode == "witness" {
            // A delivered positive witness is enough even with a horizon.
            let event = json!({"snapshot":false,"events":[{"table":"posts","kind":"put","id":"a","data":snapback4_core::wire::to_json(&history_row("a",1,1,3000).1)}],"watermark":server.seq().unwrap(),"more":false,"generation":server.generation()});
            device.apply(&serde_json::from_value(event).unwrap(),false).unwrap();
        }
        let entry = device.admit(queued("remove",json!({"row":"c"}),1,600)).unwrap();
        let result = server.mutate("remove",None,Context::new("alice",args(&[("row",id("c"))])).at(600)).unwrap();
        assert!(matches!(result.state,WriteState::Sent {..}));
        assert_eq!(server.store().rows("totals").unwrap()[0].field("value").unwrap(),&Value::Int(0));
        let read = server.query("total",Context::new("alice",args(&[("owner",id("alice"))])).at(1000)).unwrap();
        assert_eq!(read.data,Value::Int(1)); assert!(read.complete);
        let scalar = device.query("total","alice",&json!({"owner":"alice"}),1000).unwrap();
        let page = device.query("groups","alice",&json!({"owner":"alice","c":null}),1000).unwrap();
        if mode == "whole" { assert!(entry.predictable); assert_eq!(scalar.data,Value::Int(1)); assert!(scalar.complete && page.complete); }
        else {
            assert!(!scalar.complete && !page.complete,"{mode}: scalar={scalar:?}; page={page:?}");
            assert_eq!(entry.predictable,mode == "witness","{entry:?}");
            if mode == "partial" { assert!(entry.predicted.is_empty()); }
        }
        host.close(mode,device);
    }
}
#[test] fn review1_history_sqlite() { history(&mut Sqlite::new("review1")); }
#[test] fn review1_history_memory() { history(&mut Memory::new()); }

const SUBSET: &str = r#"
table posts:
  owner: principal
  selected: bool
  by byOwner: owner, id
  public 'public posts, subset delivery'
  sync to .owner
maintain totals: count posts where .selected by owner, selected
  read <- allow
query total(owner: principal):
  return totals[owner, true]
query groups(c: cursor ?):
  return totals after c first 10 by byGroup
query ownerGroups(owner: principal, c: cursor ?):
  return totals[owner] after c first 10 by byGroup
"#;
fn subset<H: Host>(host: &mut H) {
    // The base binder refuses public subset syntax; raw schema admission allows it.
    let (_,mut backend) = compile(&SUBSET.replace("sync to .owner","sync"));
    for table in ["posts","totals"] { backend.schema.tables.get_mut(table).unwrap().sync.as_mut().unwrap().audience = snapback4_core::schema::Audience::Column("owner".into()); }
    backend.schema.operations = backend.programs.iter().map(|p| (p.name.clone(),snapback4_lang::bind::residency::execution(&backend.schema,p))).collect();
    let mut server = snapback4_core::Engine::memory(backend.schema.clone(),backend.programs.clone()).unwrap();
    server.seed(["alice","bob"].map(|owner| ("posts".into(),object([("id",id(owner)),("owner",id(owner)),("selected",Value::Bool(true))])))).unwrap();
    let mut device = host.open("subset",Some(backend)).unwrap();
    for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    for (op,input) in [("total",json!({"owner":"bob"})),("total",json!({"owner":"alice"})),("ownerGroups",json!({"owner":"alice","c":null})),("ownerGroups",json!({"owner":"bob","c":null})),("groups",json!({"c":null}))] {
        let context = Context::new("alice",input.as_object().unwrap().iter().map(|(k,v)| (k.clone(), if k == "owner" { id(v.as_str().unwrap()) } else { Value::Null })).collect());
        let online = server.query(op,context).unwrap(); assert!(online.complete);
        let local = device.query(op,"alice",&input,0).unwrap();
        assert!(!local.complete,"{op} {input}: {local:?}");
        assert_eq!(server.schema().operations[op].runs.as_deref(),Some("server"));
    }
    host.close("subset",device);
}
#[test] fn review3_subset_sqlite() { subset(&mut Sqlite::new("review3")); }
#[test] fn review3_subset_memory() { subset(&mut Memory::new()); }

const RANK: &str = r#"
table posts:
  owner: principal
  at: time
  score: int
  by byOwner: owner, at, id
  read <- allow
  update <- allow
  delete <- allow
  sync
maintain totals: sum posts of score by owner, bucket(.at, 2m)
  read <- allow
  by byScore: owner, value, id
query groups(owner: principal, c: cursor ?):
  return totals[owner] after c first 1 by byGroup
query ranks(owner: principal, c: cursor ?):
  return totals[owner] after c last 1 by byScore
query sourcePage(owner: principal, c: cursor ?):
  return posts[owner] after c first 1 by byOwner
mutation continuePage(owner: principal, c: cursor ?):
  return count(totals[owner] after c first 1 by byGroup)
mutation change(row: posts, score: int):
  update posts[row] {score}
mutation remove(row: posts):
  delete posts[row]
"#;
fn ranked() -> (snapback4_core::Engine, Backend) {
    let (mut server,backend) = compile(RANK);
    server.seed(["alice","bob"].into_iter().flat_map(|owner| (0..3).map(move |n| ("posts".into(),object([("id",id(&format!("{owner}{n}"))),("owner",id(owner)),("at",Value::Int(n*120_000)),("score",Value::Int(n+1))]))))).unwrap();
    (server,backend)
}
fn cursors<H: Host>(host: &mut H, generation: bool) {
    cursor_case(host,generation,"groups");
}
fn cursor_case<H: Host>(host: &mut H, generation: bool, op: &str) {
    let (mut server,backend) = ranked();
    let mut device = host.open("cursor",Some(backend)).unwrap();
    for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
    let input = json!({"owner":"alice","c":null});
    let token = device.query(op,"alice",&input,0).unwrap().next.unwrap();
    let online = server.query(op,Context::new("alice",args(&[("owner",id("alice")),("c",Value::Null)]))).unwrap().next.unwrap();
    assert_eq!(token,online);
    let owner = if generation {
        let (_,mut next) = compile(&RANK.replace("bucket(.at, 2m)","bucket(.at, 1m)"));
        next.generation = server.adopt(next.schema.clone(),next.programs.clone()).unwrap();
        device.adopt(next).unwrap();
        for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate() { device.apply(page,i==0).unwrap(); }
        "alice"
    } else { "bob" };
    let input = json!({"owner":owner,"c":token});
    let remote = server.query(op,Context::new("alice",args(&[("owner",id(owner)),("c",Value::String(online))])));
    let local = device.query(op,"alice",&input,0);
    assert!(remote.is_err() && local.is_err(),"server={remote:?}; {}={local:?}",host.label());
    assert_eq!(remote.unwrap_err().code,"E_INPUT"); assert_eq!(local.unwrap_err().code,"E_INPUT");
    host.close("cursor",device);
}
#[test] fn review5_prefix_sqlite() { cursors(&mut Sqlite::new("review5p"),false); }
#[test] fn review5_prefix_memory() { cursors(&mut Memory::new(),false); }
#[test] fn review5_generation_sqlite() { cursors(&mut Sqlite::new("review5g"),true); }
#[test] fn review5_generation_memory() { cursors(&mut Memory::new(),true); }

#[test]
fn review4_raw_creation() {
    let (server,mut backend) = ranked();
    backend.schema.tables.get_mut("posts").unwrap().expire = Some("at".into());
    backend.schema.tables.get_mut("posts").unwrap().indexes.insert("byAt".into(),snapback4_core::schema::Index::of(&["at"],false));
    assert!(snapback4_core::Engine::memory(backend.schema,backend.programs).is_err(),"raw expiring rank must refuse; generation {}",server.generation());
}
#[test]
fn review4_raw_adoption() {
    let (mut server,mut backend) = ranked();
    backend.schema.tables.get_mut("posts").unwrap().expire = Some("at".into());
    backend.schema.tables.get_mut("posts").unwrap().indexes.insert("byAt".into(),snapback4_core::schema::Index::of(&["at"],false));
    let generation=server.generation();
    let result=server.adopt(backend.schema,backend.programs);
    assert!(result.is_err(),"raw expiring rank must refuse"); assert_eq!(server.generation(),generation);
}

#[test] fn review5_table_prefix_sqlite() { cursor_case(&mut Sqlite::new("review5tp"),false,"sourcePage"); }
#[test] fn review5_table_prefix_memory() { cursor_case(&mut Memory::new(),false,"sourcePage"); }
#[test] fn review5_table_generation_sqlite() { cursor_case(&mut Sqlite::new("review5tg"),true,"sourcePage"); }
#[test] fn review5_table_generation_memory() { cursor_case(&mut Memory::new(),true,"sourcePage"); }

fn cursor_changes<H: Host>(host: &mut H) {
    for deletion in [false,true] {
        let (mut server,backend)=ranked();
        let name=if deletion {"deleted"} else {"decreased"};
        let mut device=host.open(name,Some(backend)).unwrap();
        for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate() {device.apply(page,i==0).unwrap();}
        let first=device.query("ranks","alice",&json!({"owner":"alice","c":null}),0).unwrap();
        assert_eq!(first.data.as_array().unwrap()[0].field("value").unwrap(),&Value::Int(3));
        let token=first.next.unwrap(); let from=server.seq().unwrap();
        let op=if deletion {"remove"} else {"change"};
        let input=if deletion {args(&[("row",id("alice2"))])} else {args(&[("row",id("alice2")),("score",Value::Int(1))])};
        assert!(matches!(server.mutate(op,None,Context::new("alice",input)).unwrap().state,WriteState::Sent {..}));
        device.apply(&stream_page(&mut server,"alice",from),false).unwrap();
        let next=device.query("ranks","alice",&json!({"owner":"alice","c":token}),0).unwrap();
        let online=server.query("ranks",Context::new("alice",args(&[("owner",id("alice")),("c",Value::String(token))]))).unwrap();
        assert_eq!(next.data,online.data); assert!(next.complete && online.complete);
        // Independently fold the source, then seek below the old winning key.
        let mut expected=rank_oracle(&server,"totals");
        expected.retain(|row| row.field("owner").unwrap()==&id("alice") && row.field("value").unwrap().as_int().unwrap()<3);
        expected.truncate(1); assert_eq!(next.data,Value::Array(expected));
        host.close(name,device);
    }
}
#[test] fn review5_old_cursor_after_value_change_sqlite() {cursor_changes(&mut Sqlite::new("review5live"));}
#[test] fn review5_old_cursor_after_value_change_memory() {cursor_changes(&mut Memory::new());}

fn rank_oracle(server: &snapback4_core::Engine, target: &str) -> Vec<Value> {
    use std::collections::BTreeMap;
    let m=server.schema().maintain_for(target).unwrap();
    let mut totals=BTreeMap::<(String,i64),i128>::new();
    for row in server.store().rows("posts").unwrap() {
        if row.field("selected").is_ok_and(|v|v==&Value::Bool(false)) {continue;}
        let group=(row.field("owner").unwrap().as_str().unwrap().to_owned(),row.field("at").unwrap().as_int().unwrap().div_euclid(120_000));
        *totals.entry(group).or_default()+=if target=="counts" {1} else {i128::from(row.field("score").unwrap().as_int().unwrap())};
    }
    let mut rows:Vec<_>=totals.into_iter().filter(|(_,value)|*value!=0).map(|((owner,bucket),value)| {
        let key=vec![id(&owner),Value::Int(bucket)];
        object([("id",id(&snapback4_core::schema::maintained_id(&key))),("owner",id(&owner)),("bucket",Value::Int(bucket)),("value",Value::Int(value.try_into().unwrap()))])
    }).collect();
    assert_eq!(m.by,vec!["owner","bucket"]);
    rows.sort_by(|a,b|b.field("value").unwrap().total_cmp(a.field("value").unwrap()).then_with(||b.field("id").unwrap().total_cmp(a.field("id").unwrap()))); rows
}

const FOLD: &str = r#"
table posts:
  owner: principal
  slot: int
  at: time default 0
  score: int default 0
  selected: bool default true
  unique bySlot: slot
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync
maintain totals: sum posts of score where .selected by owner, bucket(.at, 2m)
  read <- allow
  by byScore: value, id
maintain counts: count posts where .selected by owner, bucket(.at, 2m)
  read <- allow
  by byScore: value, id
mutation save(slot: int, owner: principal, at: time, score: int, selected: bool):
  upsert posts[slot = slot] {owner, at, score, selected}
mutation edit(slot: int, owner: principal, at: time, score: int, selected: bool):
  update posts[slot = slot] {owner, at, score, selected}
mutation remove(slot: int):
  delete posts[slot = slot]
query ranks(c: cursor ?):
  return totals after c last 100 by byScore
query countsPage(c: cursor ?):
  return counts after c last 100 by byScore
query sources(c: cursor ?):
  return posts after c first 100 by byId
"#;
fn fold_commits<H: Host>(host:&mut H) {
    use std::collections::BTreeMap;
    let (mut server,backend)=compile(FOLD);
    let mut device=host.open("fold",Some(backend)).unwrap();
    for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate() {device.apply(page,i==0).unwrap();}
    let max=snapback4_core::value::I53_MAX;
    let mut edits=Vec::new();
    for n in 0..15 {edits.push(("save",n,"alice",n*120_000,n/2+1,true,false));}
    edits.extend([
        ("edit",14,"alice",14*120_000,1,true,false), // winner decrease
        ("edit",13,"bob",0,4,true,false), // key move
        ("edit",12,"alice",0,6,false,false), // true -> false
        ("edit",12,"bob",120_000,8,false,false), // false -> false
        ("save",12,"bob",120_000,8,true,false), // false -> true upsert hit
        ("edit",12,"bob",120_000,8,true,false), // no target event
        ("save",15,"bob",120_000,-8,true,false), // sum cancellation, count remains
        ("remove",15,"bob",0,0,false,false),
        ("remove",11,"alice",0,0,false,false),
        ("save",16,"limit",0,max,true,false),
        ("save",17,"limit",0,1,true,true), // overflow insert rollback
        ("edit",12,"limit",0,1,true,true), // overflow move rollback
        ("remove",16,"limit",0,0,false,false),
    ]);
    for (n,(op,slot,owner,at,score,selected,overflow)) in edits.into_iter().enumerate() {
        let input=if op=="remove" {json!({"slot":slot})} else {json!({"slot":slot,"owner":owner,"at":at,"score":score,"selected":selected})};
        let before:BTreeMap<_,_>=["totals","counts"].into_iter().map(|t|(t,server.store().rows(t).unwrap())).collect();
        let source_before=server.store().rows("posts").unwrap();
        let mut entry=queued(op,input.clone(),n as u64+1,1); entry.new_ids=vec![format!("row{slot}")]; let write_id=entry.id.clone();
        let local=device.admit(entry);
        if overflow {assert!(local.is_err(),"{local:?}");} else {assert!(local.unwrap().predictable);}
        let program=server.program(op).unwrap();
        let typed=program.args.iter().map(|(name,kind)|(name.clone(),snapback4_core::wire::from_json(kind,&input[name]).unwrap())).collect();
        let from=server.seq().unwrap();
        let out=server.mutate(op,Some(&write_id),Context::new("alice",typed).at(1).with_ids([format!("row{slot}")])).unwrap();
        assert_eq!(matches!(out.state,WriteState::Failed {..}),overflow,"{out:?}");
        if overflow {assert_eq!(server.store().rows("posts").unwrap(),source_before);}
        let events=server.stream("alice",from,100).unwrap().events;
        for (table,query) in [("totals","ranks"),("counts","countsPage")] {
            let expected=rank_oracle(&server,table);
            let read=device.query(query,"alice",&json!({"c":null}),1).unwrap();
            let strip=|row:&Value| {let mut fields=row.as_object().unwrap().clone();fields.remove("pending");Value::Row(fields.into())};
            assert_eq!(read.data.as_array().unwrap().iter().map(strip).collect::<Vec<_>>(),expected,"{op} {slot} {table}"); assert!(read.complete);
            let mut actual=server.store().rows(table).unwrap();actual.sort_by_key(|r|r.field("id").unwrap().as_str().unwrap().to_owned());
            let mut canonical=expected;canonical.sort_by_key(|r|r.field("id").unwrap().as_str().unwrap().to_owned());assert_eq!(actual,canonical);
            let map=|rows:&[Value]|rows.iter().map(|r|(r.field("id").unwrap().as_str().unwrap().to_owned(),r.clone())).collect::<BTreeMap<_,_>>();
            let (old,new)=(map(&before[table]),map(&actual));
            let expected_events:BTreeMap<_,_>=old.keys().chain(new.keys()).filter(|id|old.get(*id)!=new.get(*id)).map(|id|(id.clone(),new.get(id).cloned())).collect();
            let actual_events:BTreeMap<_,_>=events.iter().filter(|e|e.table==table).map(|e|(e.id.clone(),e.data.clone())).collect();
            assert_eq!(actual_events,expected_events,"partition events {op} {slot} {table}");
            if overflow {assert_eq!(actual,before[table]);}
        }
        // No receipt retry can apply the contribution twice.
        assert!(server.replay("alice",&write_id).unwrap().unwrap().replayed);
        if !overflow {device.settle(&write_id,Some(server.seq().unwrap())).unwrap();}
        device.apply(&stream_page(&mut server,"alice",from),false).unwrap();
    }
    println!("FOLD store={} attempts=28 commits=26 overflow_rollbacks=2 groups_ranked_from_sources=true",host.label());
    host.close("fold",device);
}
#[test] fn review6_fold_sqlite() {fold_commits(&mut Sqlite::new("review6"));}
#[test] fn review6_fold_memory() {fold_commits(&mut Memory::new());}

fn cursor_mutation<H: Host>(host:&mut H) {
    let (mut server,backend)=ranked();
    let mut device=host.open("mutation-cursor",Some(backend)).unwrap();
    for (i,page) in snapshot_pages(&mut server,"alice",100).iter().enumerate() {device.apply(page,i==0).unwrap();}
    let first=device.query("groups","alice",&json!({"owner":"alice","c":null}),0).unwrap();
    let token=first.next.unwrap();
    let entry=device.admit(queued("continuePage",json!({"owner":"alice","c":token}),1,0)).unwrap();assert!(entry.predictable);
    let out=server.mutate("continuePage",None,Context::new("alice",args(&[("owner",id("alice")),("c",Value::String(token))]))).unwrap();
    assert!(matches!(out.state,WriteState::Sent {..}),"{out:?}");
    host.close("mutation-cursor",device);
}
#[test] fn review5_query_cursor_in_mutation_sqlite() {cursor_mutation(&mut Sqlite::new("review5mut"));}
#[test] fn review5_query_cursor_in_mutation_memory() {cursor_mutation(&mut Memory::new());}
