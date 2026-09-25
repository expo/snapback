//! Raw witnesses, three-way verdicts and the authorization meter boundary.
use super::*;
use snapback4_core::{Value, Ceilings, engine::local, ir::{Stmt, Program}, rows::Rows};
use snapback4_device::store::DeviceTx;

fn service_disjunct<H:Host>(mut h:H) {
    let (mut e,b)=compile(include_str!("service.q"));
    let mut d=h.open("service",Some(b)).unwrap();
    for (n,p) in snapshot_pages(&mut e,"alice",100).iter().enumerate() {d.apply(p,n==0).unwrap();}
    let q=regressions::enqueue(&mut d,"publish");
    assert!(q.predictable && q.predicted.len()==4,"{q:?}");
    let check=|d:&mut Device<H::Store>| {
        regressions::reads(d,true,false);
        let (row,unknown,_)=d.query_with_coverage("member","alice",&json!({}),100);
        let row=row.unwrap();
        assert_eq!(row.data.field("id"),Ok(&id("grant")));
        assert!(row.complete && !unknown && row.cut.is_none(),"{row:?}");
        // Missing service membership is unknown; the service disjunct is
        // nevertheless decisive, with no leaked unknown bit from that arm.
        let (row,unknown,_)=d.query_with_coverage("member","service:admin",&json!({}),100);
        let row=row.unwrap();
        assert_eq!(row.data.field("id"),Ok(&id("grant")));
        assert!(row.complete && !unknown && row.cut.is_none(),"{row:?}");
    };
    check(&mut d);
    h.close("service",d);let mut d=h.open("service",None).unwrap();check(&mut d);
    let from=d.state().unwrap().0;
    sent(&mut e,"tick",json!({}),vec![]);
    let p=stream_page(&mut e,"alice",from);assert!(!p.events.is_empty() && p.watermark>from);
    d.apply(&p,false).unwrap();check(&mut d);
    assert_eq!(d.queued().unwrap()[0].id,"publish");
}
#[test] fn service_disjunct_memory(){service_disjunct(Memory::new());}
#[test] fn service_disjunct_sqlite(){service_disjunct(Sqlite::new("service"));}

fn ladder_program(b:&snapback4_device::device::Backend,n:usize)->Program {
    let mut p=b.programs.iter().find(|p|p.name=="point").unwrap().clone();
    let note=p.body.last().unwrap().clone();
    let Stmt::Return(member)=b.programs.iter().find(|p|p.name=="member").unwrap().body.last().unwrap() else {panic!()};
    p.name=format!("ladder{n}");
    p.body=vec![Stmt::Let{name:"precharge".into(),value:member.clone()}];
    let Stmt::Return(expr)=&note else {panic!()};
    p.body.extend((1..n).map(|_|Stmt::Let{name:"ignore".into(),value:expr.clone()}));
    p.body.push(note);p
}

fn nested_ladder<H:Host>(mut h:H,mut store:H::Store) {
    let (mut e,mut b)=compile(include_str!("service.q"));
    let programs:Vec<_>=[4094,4095,4096,8192].into_iter().map(|n|ladder_program(&b,n)).collect();
    b.programs.extend(programs.clone());
    sent(&mut e,"publish",json!({}),vec![]);
    let mut d=h.open("ladder",Some(b.clone())).unwrap();
    for (n,p) in snapshot_pages(&mut e,"alice",100).iter().enumerate(){d.apply(p,n==0).unwrap();}
    assert!(regressions::enqueue(&mut d,"renew").predictable);
    for p in &programs {
        let (out,unknown,_)=d.query_with_coverage(&p.name,"alice",&json!({}),100);
        let out=out.unwrap();
        assert!(!unknown,"{}: {out:?}",p.name);
        // Removing recursive ACLs removes their probe charges too. The
        // original default-budget ladder now cuts at 8192, not 4095.
        if p.name=="ladder8192" {assert!(!out.complete && out.cut==Some(snapback4_core::engine::ReadCut::Meter));}
        else {assert!(out.complete && out.cut.is_none());assert_eq!(out.data.field("id"),Ok(&id("note")));}
    }
    store.install(&b.schema,&Default::default(),false).unwrap();
    let tx=store.transaction().unwrap();
    for table in ["groups","members","notes","checks"] {
        for row in d.store().raw_rows(table) {tx.put(table,&b.schema.tables[table],&row,None).unwrap();}
    }
    // Exercise the exact 4094/4095/4096 cut ladder at its new raw-probe cost.
    // Mark only the renewed membership provisional; the note is delivered.
    struct Renewed<'a>(&'a dyn Rows);
    impl Rows for Renewed<'_> {
        fn provisional_row(&self,t:&str,_:&Value)->Result<bool,snapback4_core::RuntimeError>{Ok(t=="members")}
        fn get(&self,t:&str,id:&str)->Result<Option<Value>,snapback4_core::RuntimeError>{self.0.get(t,id)}
        fn lookup(&self,t:&str,n:&str,i:&snapback4_core::schema::Index,k:&[Value])->Result<Option<Value>,snapback4_core::RuntimeError>{self.0.lookup(t,n,i,k)}
        fn scan(&self,t:&str,n:&str,k:&[Value],b:&snapback4_core::rows::Bounds,d:snapback4_core::rows::Dir,l:usize)->Result<Vec<(Value,Vec<u8>)>,snapback4_core::RuntimeError>{self.0.scan(t,n,k,b,d,l)}
        fn scan_metered(&self,t:&str,n:&str,k:&[Value],b:&snapback4_core::rows::Bounds,d:snapback4_core::rows::Dir,l:usize,m:&mut snapback4_core::meter::Meter)->Result<Vec<(Value,Vec<u8>)>,snapback4_core::RuntimeError>{self.0.scan_metered(t,n,k,b,d,l,m)}
        fn count_prefix(&self,t:&str,n:&str,k:&[Value],l:u64)->Result<u64,snapback4_core::RuntimeError>{self.0.count_prefix(t,n,k,l)}
        fn put(&self,t:&str,d:&snapback4_core::schema::Table,r:&Value,o:Option<&Value>)->Result<u64,snapback4_core::RuntimeError>{self.0.put(t,d,r,o)}
        fn delete(&self,t:&str,d:&snapback4_core::schema::Table,r:&Value)->Result<u64,snapback4_core::RuntimeError>{self.0.delete(t,d,r)}
    }
    for (n,p) in programs[..3].iter().enumerate() {
        let (out,unknown,_)=local::query_with_coverage(&Renewed(&tx),&b.schema,p,context("alice",&[]).at(100),Ceilings{rule_probes:4095,..Default::default()});
        let out=out.unwrap();assert!(!unknown,"{}: {out:?}",p.name);
        if n==0 {assert!(out.complete && out.cut.is_none());assert_eq!(out.data.field("id"),Ok(&id("note")));assert_eq!(out.metered.rule_probes,4095);}
        else {assert!(!out.complete);assert_eq!(out.cut,Some(snapback4_core::engine::ReadCut::Meter));assert_eq!(out.data,Value::Null);assert_eq!(out.metered.rule_probes,4095+n as u64);}
    }
    let mut prediction=programs[1].clone();
    prediction.kind=snapback4_core::ir::ProgramKind::Mutation;
    let error=local::predict(&Renewed(&tx),&b.schema,&prediction,context("alice",&[]).at(100),Ceilings{rule_probes:4095,..Default::default()}).unwrap_err();
    assert!(matches!(error,snapback4_core::RuntimeError::Bound{kind:snapback4_core::error::MeterKind::RuleProbes,..}),"{error:?}");
    // Even a trusted audience reserves the server's point-read probe on the
    // mutation meter; only the physical provisional witness uses its allowance.
    let mut schema = b.schema.clone();
    schema.tables.get_mut("members").unwrap().expire = None;
    prediction.body = vec![prediction.body[0].clone()];
    local::predict(&Renewed(&tx),&schema,&prediction,context("alice",&[]).at(100),Ceilings{rule_probes:1,..Default::default()}).unwrap();
    let error=local::predict(&Renewed(&tx),&schema,&prediction,context("alice",&[]).at(100),Ceilings{rule_probes:0,..Default::default()}).unwrap_err();
    assert!(matches!(error,snapback4_core::RuntimeError::Bound{kind:snapback4_core::error::MeterKind::RuleProbes,..}),"{error:?}");
    tx.rollback().unwrap();
}
#[test] fn nested_read_ladder_memory(){nested_ladder(Memory::new(),snapback4_device::memory::MemoryStore::new());}
#[test] fn nested_read_ladder_sqlite(){let h=Sqlite::new("ladder");let store=snapback4_core::Store::open(&h.path("raw")).unwrap();nested_ladder(h,store);}

fn live_maintain<H:Host>(mut h:H) {
    let (mut e,b)=compile(include_str!("aggregate.q"));
    sent(&mut e,"publish",json!({}),vec![]);
    let mut d=h.open("aggregate",Some(b)).unwrap();
    for (n,p) in snapshot_pages(&mut e,"alice",100).iter().enumerate(){d.apply(p,n==0).unwrap();}
    assert!(regressions::enqueue(&mut d,"editNote").predictable);
    for visible in [true,false] {
        if !visible {assert!(regressions::enqueue(&mut d,"revoke").predictable);}
        for op in ["scan","aggregateRow","aggregateScan"] {
            let (out,unknown,_)=d.query_with_coverage(op,"alice",&json!({}),100);
            let out=out.unwrap();
            assert!(out.complete && !unknown && out.cut.is_none(),"{op}: {out:?}");
            if op=="aggregateRow" {
                assert_eq!(out.data,Value::Int(i64::from(visible)));
            } else {
                assert_eq!(out.data.as_array().unwrap().len(),usize::from(visible),"{op}: {out:?}");
                if visible && op=="aggregateScan" {assert_eq!(out.data.as_array().unwrap()[0].field("value"),Ok(&Value::Int(1)));}
            }
        }
        assert_eq!(d.store().raw_rows("notes").len(),1,"hidden source still stored");
    }
}
#[test] fn live_maintain_memory(){live_maintain(Memory::new());}
#[test] fn live_maintain_sqlite(){live_maintain(Sqlite::new("live-maintain"));}

fn hidden_before_visible<H:Host>(mut h:H) {
    let (mut e,b)=compile(super::SOURCE);
    let mut d=h.open("siblings",Some(b)).unwrap();
    for (n,p) in snapshot_pages(&mut e,"alice",100).iter().enumerate(){d.apply(p,n==0).unwrap();}
    let q=admit(&mut d,"mixedAhead",json!({}));assert!(q.predictable && q.predicted.len()==2);
    for reopen in [false,true] {
        if reopen {h.close("siblings",d);d=h.open("siblings",None).unwrap();}
        assert_eq!(d.store().raw_rows("reports").len(),2);
        for op in ["wide","widePage","wideMerge","wideCount"] {
            let (out,unknown,_)=d.query_with_coverage(op,"alice",&if op=="widePage" {json!({"c":null})}else{json!({})},100);
            let out=out.unwrap();assert!(out.complete && !unknown && out.cut.is_none(),"{op}: {out:?}");
            if op=="wideCount" {assert_eq!(out.data,Value::Int(1));}
            else {assert_eq!(wire::to_json(&out.data),json!([{"id":"z-visible","writer":"alice","reader":"alice","body":"visible","pending":true}]));}
        }
    }
}
#[test] fn hidden_before_visible_memory(){hidden_before_visible(Memory::new());}
#[test] fn hidden_before_visible_sqlite(){hidden_before_visible(Sqlite::new("siblings"));}

// The unknown check selects an expensive arm that the server can skip.
fn counterfactual_branch<H: Host>(mut h: H) {
    let source = regressions::SOURCE.replace("sync to grants[.groupId] by .principal", "sync to grants[.groupId] by .principal\n  retain delivered-history") + r#"
mutation counterfactual(work: int):
  insert checks { id: 'probe', groupId: 'group' }
  if not exists checks['probe']:
    for i in range(0, work):
      ignored = groups['group']
  return null
"#;
    for state in ["held", "unknown", "absent"] {
        for work in [0, 8192] {
            let (mut e, b) = compile(&source);
            sent(&mut e, "publish", json!({}), vec![]);
            let mut d = h.open(&format!("branch-{state}-{work}"), Some(b)).unwrap();
            for (n, p) in snapshot_pages(&mut e, "alice", 100).iter().enumerate() { d.apply(p, n == 0).unwrap(); }
            let from = d.state().unwrap().0;
            if state == "unknown" { sent(&mut e, "revoke", json!({}), vec![]); }
            if state == "absent" { e.seed_delete("notes", "note").unwrap(); }
            if state != "held" { d.apply(&stream_page(&mut e, "alice", from), false).unwrap(); }
            if state == "unknown" {
                assert_eq!(d.store().raw_rows("notes").len(), 1);
                assert!(d.store().meta("device:history:groups").unwrap().unwrap().contains("Left"));
            }
            let reply = snapback4_device::call::call(&mut d, json!({"op":"admit", "entry":{
                "id":"branch", "seq":1, "op":"counterfactual", "args":{"work":work},
                "viewer":"alice", "now":100, "predictable":true
            }}));
            if state == "absent" && work == 8192 {
                assert_eq!(reply["denied"]["code"], "E_BOUND", "{state}/{work}: {reply}");
                assert!(d.queued().unwrap().is_empty());
            } else {
                let queued: Queued = serde_json::from_value(reply["ok"].clone()).expect(&reply.to_string());
                assert_eq!(queued.predictable, state != "unknown", "{state}/{work}: {reply}");
                assert_eq!(queued.predicted.is_empty(), state == "unknown");
                assert_eq!(d.queued().unwrap().len(), 1);
            }
            if state == "unknown" {
                let authoritative = e.mutate("counterfactual", Some("branch"), context("alice", &[("work", Value::Int(work))]).at(100)).unwrap();
                assert!(matches!(authoritative.state, WriteState::Sent { .. }), "server skips the counterfactual arm: {authoritative:?}");
            }
            assert_eq!(d.store().raw_rows("checks").iter().any(|row| row.field("id") == Ok(&id("probe"))),
                state == "held" || (state == "absent" && work == 0), "failed/unknown prediction rolls back its insert");
        }
    }
}
#[test] fn counterfactual_branch_memory() { counterfactual_branch(Memory::new()); }
#[test] fn counterfactual_branch_sqlite() { counterfactual_branch(Sqlite::new("counterfactual")); }

fn existential_aggregate<H: Host>(mut h: H) {
    let source = r#"table groups:
  public 'groups'
  sync public
table notes:
  groupId: groups
  owner: principal
  until: time ?
  by byExpiry: until, id
  by byOwner: owner, id
  expire at .until
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
  retain delivered-history
maintain counts: count notes by groupId, owner
  read <- .owner = viewer
  by byOwner: owner, groupId
table checks:
  groupId: groups
  by byGroup: groupId, id
  read <- exists counts[.groupId, viewer]
  insert <- allow
  sync to counts[.groupId] by .owner
mutation check():
  insert checks { id: 'check', groupId: 'group' }
mutation add(noteId: id):
  insert notes { id: noteId, groupId: 'group', owner: viewer, until: null }
query checkRow():
  return checks['check']
"#;
    for (retained, pending) in [("a", "z"), ("z", "a")] {
        let (mut e, b) = compile(source);
        e.seed([("groups".into(), snapback4_core::value::object([("id", id("group"))])),
            ("notes".into(), snapback4_core::value::object([("id", id(retained)), ("groupId", id("group")), ("owner", id("alice")), ("until", Value::Null)]))]).unwrap();
        let mut d = h.open(retained, Some(b)).unwrap();
        for (n, p) in snapshot_pages(&mut e, "alice", 100).iter().enumerate() { d.apply(p, n == 0).unwrap(); }
        let from = d.state().unwrap().0;
        let left = serde_json::from_value(json!({"snapshot":false,"requested_watermark":from,"images_at":from+1,
            "watermark":from+1,"more":false,"events":[{"table":"notes","kind":"scope","id":"scope","data":["alice"]}]})).unwrap();
        d.apply(&left, false).unwrap();
        assert!(d.store().meta("device:history:groups").unwrap().unwrap().contains("Left"));
        assert!(regressions::enqueue(&mut d, "check").predictable);
        let (out, unknown, _) = d.query_with_coverage("checkRow", "alice", &json!({}), 100);
        let out = out.unwrap();
        assert!(unknown && !out.complete && out.data == Value::Null, "retained witness alone: {out:?}");
        let queued = admit(&mut d, "add", json!({"noteId":pending}));
        assert!(queued.predictable, "{queued:?}");
        let reply = snapback4_device::call::call(&mut d, json!({"op":"query", "name":"checkRow", "viewer":"alice", "now":100}));
        assert_eq!(reply["ok"]["data"]["id"], "check", "{retained}/{pending}: {reply}");
        assert_eq!(reply["ok"]["complete"], true, "{reply}");
        assert_eq!(reply["ok"]["unknown"], false, "{reply}");
    }
}
#[test] fn existential_aggregate_memory() { existential_aggregate(Memory::new()); }
#[test] fn existential_aggregate_sqlite() { existential_aggregate(Sqlite::new("existential")); }

const PROBE_BOUNDARY: &str = r#"table members:
  groupId: id
  principal: principal
  unique byGroupPrincipal: groupId, principal
  by byPrincipal: principal, groupId
  read <- allow
  sync public
table notes:
  groupId: id
  by byGroup: groupId, id
  read <- exists members[.groupId, viewer]
  insert <- exists members[.groupId, viewer]
  sync to members[.groupId] by .principal
mutation mixed(work: int):
  insert notes { id: 'note', groupId: 'group' }
  for i in range(0, work):
    ignored = notes['note']
  return null
query note():
  return notes['note']
"#;

fn mixed_probe_boundary<H: Host>(mut host: H) {
    for reads in [8188, 8189, 8190] {
        let (mut engine, backend) = compile(PROBE_BOUNDARY);
        engine.seed([("members".into(), snapback4_core::value::object([
            ("id", id("member")), ("groupId", id("group")), ("principal", id("alice")),
        ]))]).unwrap();
        let mut device = host.open(&format!("mixed-{reads}"), Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut engine, "alice", 100).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
        let server = engine.mutate("mixed", Some("mixed"), context("alice", &[("work", Value::Int(reads))]).at(100)).unwrap();
        assert_eq!(server.metered.rule_probes, reads as u64 + 3);
        let reply = snapback4_device::call::call_text(&mut device, &json!({"op":"admit", "entry":{
            "id":"mixed", "seq":1, "op":"mixed", "args":{"work":reads}, "viewer":"alice", "now":100, "predictable":true
        }}).to_string());
        if reads < 8190 {
            assert!(matches!(server.state, WriteState::Sent { .. }), "{server:?}");
            let queued: Queued = serde_json::from_value(reply["ok"].clone()).expect(&reply.to_string());
            assert!(queued.predictable, "{reads}: {queued:?}");
            assert_eq!(queued.predicted, ["notes/note"]);
            assert_eq!(device.queued().unwrap().len(), 1);
        } else {
            let WriteState::Failed { why, .. } = server.state else { panic!("{server:?}") };
            assert_eq!(why.code, "E_BOUND");
            assert_eq!(reply["denied"]["code"], "E_BOUND", "{reply}");
            assert_eq!(reply["denied"]["message"], why.message);
            assert!(device.queued().unwrap().is_empty());
            assert!(device.store().raw_rows("notes").is_empty());
        }
    }
}
#[test] fn mixed_probe_boundary_memory() { mixed_probe_boundary(Memory::new()); }
#[test] fn mixed_probe_boundary_sqlite() { mixed_probe_boundary(Sqlite::new("mixed-probes")); }

fn expired_authority_witnesses<H: Host>(mut host: H, aggregate: bool) {
    let mut source = PROBE_BOUNDARY.replace("  read <- allow\n  sync public", "  until: time ?\n  by byExpiry: until, id\n  expire at .until\n  read <- allow\n  sync public")
        .replace("  insert <- exists members[.groupId, viewer]", "  insert <- allow");
    if aggregate {
        source = source.replace("read <- exists members[.groupId, viewer]", "read <- exists counts[.groupId, viewer]")
            .replace("sync to members[.groupId] by .principal", "sync to counts[.groupId] by .principal");
        source.push_str("\nmaintain counts: count members by groupId, principal\n  read <- allow\n  by byPrincipal: principal, groupId\n");
    }
    for expired in [34, 9000] {
        let (mut engine, backend) = compile(&source);
        engine.seed([("members".into(), snapback4_core::value::object([
            ("id", id("z-live")), ("groupId", id("group")), ("principal", id("alice")), ("until", Value::Null),
        ]))]).unwrap();
        let mut device = host.open(&format!("witness-{aggregate}-{expired}"), Some(backend)).unwrap();
        for (n, page) in snapshot_pages(&mut engine, "alice", 100).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
        let from = device.state().unwrap().0;
        let events: Vec<_> = (0..expired).map(|n| json!({"table":"members", "kind":"put", "id":format!("m{n:05}"),
            "data":{"id":format!("m{n:05}"), "groupId":"group", "principal":"alice", "until":200}})).collect();
        let page = serde_json::from_value(json!({"snapshot":false, "requested_watermark":from, "images_at":from+1,
            "watermark":from+1, "more":false, "generation":engine.generation(), "events":events})).unwrap();
        device.apply(&page, false).unwrap();
        let members = device.store().raw_rows("members");
        assert_eq!(members.len(), expired + 1);
        // Inspect the actual admission outcome and full rollback after the
        // insert precedes a witness walk that cannot fit the device allowance.
        let reply = snapback4_device::call::call_text(&mut device, &json!({"op":"admit", "entry":{
            "id":"mixed", "seq":1, "op":"mixed", "args":{"work":1}, "viewer":"alice", "now":300, "predictable":true
        }}).to_string());
        let queued: Queued = serde_json::from_value(reply["ok"].clone()).expect(&reply.to_string());
        assert_eq!(queued.predictable, expired == 34, "aggregate={aggregate}, expired={expired}: {queued:?}");
        assert_eq!(queued.predicted.is_empty(), expired == 9000);
        assert_eq!(device.store().raw_rows("notes").is_empty(), expired == 9000);
        assert_eq!(device.queued().unwrap().len(), 1);
        assert_eq!(device.store().raw_rows("members"), members, "witness reads never sweep");
        // A zero-read insert still predicts, and its later query keeps the
        // existing one-probe contract even through all 9,000 expired siblings.
        if expired == 9000 {
            let mut entry = queued;
            entry.id = "query-control".into(); entry.seq = 2; entry.predictable = true; entry.args = json!({"work":0});
            assert!(device.admit(entry).unwrap().predictable);
        }
        let out = device.query("note", "alice", &json!({}), 300).unwrap();
        assert_eq!(out.data.field("id"), Ok(&id("note")));
        assert!(out.complete && out.cut.is_none(), "{out:?}");
        assert_eq!(out.metered.rule_probes, 1);
    }
}
#[test] fn expired_authority_witnesses_memory() { expired_authority_witnesses(Memory::new(), false); }
#[test] fn expired_authority_witnesses_sqlite() { expired_authority_witnesses(Sqlite::new("expired-witness"), false); }
#[test] fn aggregate_authority_witnesses_memory() { expired_authority_witnesses(Memory::new(), true); }
#[test] fn aggregate_authority_witnesses_sqlite() { expired_authority_witnesses(Sqlite::new("aggregate-witness"), true); }

// Observe the physical adapter boundary as well as the admission outcome:
// the interpreter must stop fetching at its remaining device allowance.
fn witness_fetch_budget<S: DeviceStore>(mut store: S) {
    use std::cell::Cell;
    use snapback4_core::{RuntimeError, rows::{Bounds, Dir}, schema::{Index, Table}, meter::Meter};
    struct Counted<'a> { rows: &'a dyn Rows, fetched: Cell<usize> }
    impl Rows for Counted<'_> {
        fn get(&self,t:&str,id:&str)->Result<Option<Value>,RuntimeError>{self.rows.get(t,id)}
        fn lookup(&self,t:&str,n:&str,i:&Index,k:&[Value])->Result<Option<Value>,RuntimeError>{self.rows.lookup(t,n,i,k)}
        fn scan(&self,t:&str,n:&str,k:&[Value],b:&Bounds,d:Dir,l:usize)->Result<Vec<(Value,Vec<u8>)>,RuntimeError>{self.rows.scan(t,n,k,b,d,l)}
        fn scan_metered(&self,t:&str,n:&str,k:&[Value],b:&Bounds,d:Dir,l:usize,m:&mut Meter)->Result<Vec<(Value,Vec<u8>)>,RuntimeError>{
            assert!(l as u64 <= m.ceilings.examined.saturating_sub(m.used.examined));
            let result=self.rows.scan_metered(t,n,k,b,d,l,m)?;
            self.fetched.set(self.fetched.get()+result.len()); Ok(result)
        }
        fn count_prefix(&self,t:&str,n:&str,k:&[Value],l:u64)->Result<u64,RuntimeError>{self.rows.count_prefix(t,n,k,l)}
        fn put(&self,t:&str,d:&Table,r:&Value,o:Option<&Value>)->Result<u64,RuntimeError>{self.rows.put(t,d,r,o)}
        fn delete(&self,t:&str,d:&Table,r:&Value)->Result<u64,RuntimeError>{self.rows.delete(t,d,r)}
    }
    for aggregate in [false, true] {
        let mut source = PROBE_BOUNDARY.replace("  read <- allow\n  sync public", "  until: time ?\n  payload: text <=40000 ?\n  extra: text <=1 ?\n  by byExpiry: until, id\n  expire at .until\n  read <- allow\n  sync public")
            .replace("  insert <- exists members[.groupId, viewer]", "  insert <- allow");
        if aggregate {
            source = source.replace("read <- exists members[.groupId, viewer]", "read <- exists counts[.groupId, viewer]")
                .replace("sync to members[.groupId] by .principal", "sync to counts[.groupId] by .principal");
            source.push_str("\nmaintain counts: count members by groupId, principal\n  read <- allow\n  by byPrincipal: principal, groupId\n");
        }
        let (_, backend) = compile(&source);
        store.install(&backend.schema, &Default::default(), false).unwrap();
        let tx = store.transaction().unwrap();
        for n in 0..9001 {
            let row = snapback4_core::value::object([
                ("id", id(&format!("m{n:05}"))), ("groupId", id("group")), ("principal", id("alice")),
                ("until", Value::Int(if n == 9000 { 500 } else { 200 })),
            ]);
            tx.put("members", &backend.schema.tables["members"], &row, None).unwrap();
        }
        if aggregate {
            let row = snapback4_core::value::object([
                ("id", id("[\"group\",\"alice\"]")), ("groupId", id("group")), ("principal", id("alice")), ("value", Value::Int(9001)),
            ]);
            tx.put("counts", &backend.schema.tables["counts"], &row, None).unwrap();
        }
        let counted = Counted { rows: &tx, fetched: Cell::new(0) };
        let program = backend.programs.iter().find(|p| p.name == "mixed").unwrap();
        for budget in [1, 33, 8192, 9002] {
            tx.savepoint("attempt").unwrap(); counted.fetched.set(0);
            let result = local::predict(&counted, &backend.schema, program, context("alice", &[("work", Value::Int(1))]).at(300),
                Ceilings { examined: budget, ..Ceilings::unbounded() });
            if budget == 9002 { assert!(result.is_ok(), "aggregate={aggregate}: {result:?}"); }
            else { assert!(matches!(result, Err(RuntimeError::Prediction(_))), "aggregate={aggregate}, budget={budget}: {result:?}"); }
            assert_eq!(counted.fetched.get(), if budget == 9002 {9001 + usize::from(aggregate)} else {budget as usize});
            tx.rollback_to("attempt").unwrap();
        }
        // An early live witness with an oversized, unindexed payload must
        // exhaust allocation before authorizing; a small image still fits.
        let old = tx.get("members", "m00000").unwrap().unwrap();
        for payload in [Value::Null, Value::String("x".repeat(40000))] {
            tx.savepoint("heap").unwrap();
            let mut row = old.clone();
            if let Value::Row(fields) = &mut row { fields.insert("until".into(), Value::Null); fields.insert("payload".into(), payload.clone()); }
            tx.put("members", &backend.schema.tables["members"], &row, Some(&old)).unwrap();
            let result = local::predict(&counted, &backend.schema, program, context("alice", &[("work", Value::Int(1))]).at(300),
                Ceilings { examined: 1 + u64::from(aggregate), heap_bytes: 32768, ..Ceilings::unbounded() });
            if payload == Value::Null { assert!(result.is_ok(), "aggregate={aggregate}: {result:?}"); }
            else { assert!(matches!(result, Err(RuntimeError::Prediction(_))), "aggregate={aggregate}: {result:?}"); }
            tx.rollback_to("heap").unwrap();
        }
        tx.rollback().unwrap();
    }
}
#[test] fn witness_fetch_budget_memory() { witness_fetch_budget(snapback4_device::memory::MemoryStore::new()); }
#[test] fn witness_fetch_budget_sqlite() { let h = Sqlite::new("witness-fetch"); witness_fetch_budget(snapback4_core::Store::open(&h.path("raw")).unwrap()); }
