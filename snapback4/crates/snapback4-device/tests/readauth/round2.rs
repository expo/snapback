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
