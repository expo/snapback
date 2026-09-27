//! Lane ER research instrument; no product claim or default-suite burden.
//! Run: cargo test -p snapback4-lang --test er_expiry_research -- --ignored --nocapture --test-threads=1
use snapback4_core::{Context, Engine, Value, WriteState, RuntimeError};
use snapback4_core::engine::runner::Runner;
use snapback4_core::ir::{Program, Stmt, Expr};
use snapback4_core::meter::{Ceilings, Cut, Meter};
use snapback4_core::rows::{Rows, MemoryRows, Bounds, Dir};
use snapback4_core::schema::{Schema, Table, Index};
use snapback4_core::value::object;
use std::{cell::Cell, collections::BTreeMap, time::Instant};

const MODEL: &str = include_str!("../../../experiments/er-expiring-pages/model.q");
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn args() -> BTreeMap<String,Value> { [("conversation".into(), id("alice")), ("low".into(), Value::Int(1)), ("high".into(),Value::Int(10002)), ("ordinal".into(),Value::Int(1))].into() }
fn context() -> Context { Context::new("alice", args()).at(2000) }
fn natural_context() -> Context { let mut a=args();a.remove("ordinal");Context::new("alice",a).at(2000) }
fn compiled(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}

const ACK: &str = "\ntable acknowledgements:\n  owner: principal\n  ordinal: int\n  unique owner\n  read <- .owner = viewer\n  update <- .owner = viewer\n  sync to .owner\n\nmutation natural(conversation: principal, low: int, high: int): server\n  blocker = first(messages where .conversation = conversation and .ordinal >= low and .ordinal <= high first 1 by .ordinal)\n  prefix = blocker.ordinal - 1 if blocker != null else high\n  update acknowledgements[owner = viewer] { ordinal: prefix }\n  return prefix\n";

#[test]
#[ignore = "lane ER prototype, explicit only"]
fn prototype_admits_natural_program_and_preserves_receipts() {
    let b=compiled(&format!("{MODEL}{ACK}"));
    assert_eq!(b.schema.operations["natural"].predicts.as_deref(),Some("never"));
    let mut e=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
    e.load_trusted((1..=10000).map(|n|("messages".into(),row(n,1000)))
        .chain([10001,10002].map(|n|("messages".into(),row(n,9000))))).unwrap();
    e.load_trusted([("acknowledgements".into(),object([("id",id("ack")),("owner",id("alice")),("ordinal",Value::Int(0))]))]).unwrap();
    let failed=e.mutate("natural",Some("failed-id"),natural_context()).unwrap();
    assert!(matches!(&failed.state,WriteState::Failed{why,..} if why.code=="E_BOUND"),"{:?}",failed);
    assert_eq!(failed.metered.rows_written,0);
    let receipt=failed.receipt(Some("failed-id"));
    let mut swept=0;
    while swept<10000 { swept+=e.sweep_expired(2000,1024).unwrap(); }
    let replay=e.mutate("natural",Some("failed-id"),natural_context()).unwrap();
    assert!(replay.replayed);
    assert_eq!(receipt,replay.receipt(Some("failed-id")));
    let sent=e.mutate("natural",Some("fresh-id"),natural_context()).unwrap();
    assert!(matches!(sent.state,WriteState::Sent{result:Value::Int(10000),..}),"{:?}",sent);
    let held=e.store_mut().transaction().unwrap().get("acknowledgements","ack").unwrap().unwrap();
    assert_eq!(held.field("ordinal").unwrap(),&Value::Int(10000));
    println!("ER_PROTOTYPE {}",serde_json::json!({"failure":failed.reply(Some("failed-id")),"failed_meter":failed.metered,"replay":replay.reply(Some("failed-id")),"fresh":sent.reply(Some("fresh-id")),"fresh_meter":sent.metered}));

    // Normal mutation prediction never reaches even the first data fetch.
    let p=&b.programs.iter().find(|p|p.program.name=="natural").unwrap().program;
    let memory=MemoryRows::new(); fill(&memory,&b.schema,0);
    let tx=e.store_mut().transaction().unwrap();
    for rows in [&memory as &dyn Rows,&tx as &dyn Rows] {
        let counted=Counted::new(rows);
        let result=snapback4_core::engine::local::predict(&counted,&b.schema,p,natural_context(),Ceilings::default());
        assert!(matches!(result,Err(RuntimeError::Prediction(_))));
        assert_eq!(counted.calls.get(),0,"server-only body was executed");
    }
}

#[test]
#[ignore = "lane ER prototype, explicit only"]
fn prototype_refuses_effects_including_serialized_ir_and_site_aliases() {
    let b=compiled(&format!("{MODEL}{ACK}"));
    let p=b.programs.iter().find(|p|p.program.name=="natural").unwrap().program.clone();
    let write=p.body.iter().find(|s|matches!(s,Stmt::WriteTarget{..})).unwrap().clone();
    let scan_pos=p.body.iter().position(|stmt| {let mut single=p.clone();single.body=vec![stmt.clone()];!snapback4_core::ir::scans(&single).is_empty()}).unwrap();
    let write_pos=p.body.iter().position(|s|matches!(s,Stmt::WriteTarget{..})).unwrap();
    let check=|program:&Program|snapback4_core::engine::admission::check(&b.schema,program);
    assert!(check(&p).is_ok());
    let mut before=p.clone(); before.body.insert(0,write.clone());
    assert!(check(&before).is_err());
    let mut within=p.clone();
    if let Stmt::Let{value,..}|Stmt::Const{value,..}=&mut within.body[scan_pos] {
        *value=Expr::Block{body:vec![write.clone()],value:Box::new(value.clone())};
    } else {panic!("expected binding")}
    assert!(check(&within).is_err());
    // Two structurally identical pages with the same diagnostic site: only
    // the first belongs to the prefix. A site-name allowlist would be unsound.
    let mut alias=p.clone(); alias.body.insert(write_pos+1,p.body[scan_pos].clone());
    assert!(check(&alias).is_err());
    // The second evaluation of an effectful loop cannot reuse first-iteration authority.
    let mut repeated=p.clone();
    repeated.body=vec![Stmt::For{binding:"i".into(),domain:snapback4_core::ir::LoopDomain::LiteralRange{start:0,end_exclusive:2},body:p.body.clone()}];
    assert!(check(&repeated).is_err());
    // A nested filter write is an effect even without an explicit for.
    let mut filtered=p.clone();
    fn dirty(e:&mut Expr,write:&Stmt)->bool {
        match e {
            Expr::Scan(s)=>{s.filter=Some(Box::new(Expr::Block{body:vec![write.clone()],value:Box::new(Expr::Literal(Value::Bool(true)))}));true},
            Expr::Builtin{args,..}=>args.iter_mut().any(|e|dirty(e,write)),
            _=>false,
        }
    }
    if let Stmt::Let{value,..}|Stmt::Const{value,..}=&mut filtered.body[scan_pos] {assert!(dirty(value,&write));}
    assert!(check(&filtered).is_err());
    println!("ER_PROTOTYPE_GUARDS before-write, expression-write, repeated-loop, filter-write, duplicate-site all refused");
}

#[test]
#[ignore = "lane ER counterexample, explicit only"]
fn removing_only_the_expiry_guard_discloses_a_retained_ordinal() {
    let body="\nmutation attack(): server\n  update messages['target'] { conversation: viewer, expiresAt: now - 1 }\n  p = first(messages where .conversation = viewer and .ordinal >= 1 and .ordinal <= 1 first 1 by .ordinal)\n  require false else STOP\n  return null\n";
    // Deliberately compile under the non-expiring schema, then use the real
    // expiring schema directly with Runner. This bypass is an attack witness,
    // never a claim that the product admits the program.
    let bound=compiled(&format!("{}{body}",MODEL.replace("  expire at .expiresAt\n","")));
    let actual=compiled(MODEL);
    let p=&bound.programs.iter().find(|p|p.program.name=="attack").unwrap().program;
    assert!(snapback4_core::engine::admission::check(&actual.schema,p).is_err());
    let mut pair=Vec::new();
    for ordinal in [1,2] {
        let rows=MemoryRows::new();
        let hidden=object([("id",id("target")),("conversation",id("alice")),("ordinal",Value::Int(ordinal)),("expiresAt",Value::Int(9000)),("body",Value::String("secret".into()))]);
        rows.put("messages",&actual.schema.tables["messages"],&hidden,None).unwrap();
        let mut runner=Runner::new(&rows,&actual.schema,Context::new("bob",BTreeMap::new()).at(2000),Meter::new(Ceilings{examined:1,..Default::default()},Cut::Abort),0);
        let error=runner.run(p).unwrap_err();
        pair.push(serde_json::json!({"retained_ordinal":ordinal,"code":error.code(),"meter":runner.metered()}));
    }
    assert_ne!(pair[0]["code"],pair[1]["code"],"counterexample stopped distinguishing the worlds: {pair:?}");
    println!("ER_COUNTEREXAMPLE {}",serde_json::json!(pair));
}
fn row(n: usize, expires: i64) -> Value {
    object([("id",id(&format!("m{n}"))), ("conversation",id("alice")),
        ("ordinal",Value::Int(n as i64)), ("expiresAt",Value::Int(expires)),
        ("body",Value::String("x".repeat(160)))])
}
fn fill(rows: &dyn Rows, schema: &Schema, backlog: usize) {
    for n in 1..=backlog { rows.put("messages", &schema.tables["messages"], &row(n,1000), None).unwrap(); }
    for n in [10001,10002] { rows.put("messages", &schema.tables["messages"], &row(n,9000), None).unwrap(); }
}

/// Counts fetched row images separately from the interpreter's logical meter.
struct Counted<'a> { inner: &'a dyn Rows, fetched: Cell<u64>, calls: Cell<u64> }
impl<'a> Counted<'a> { fn new(inner: &'a dyn Rows) -> Self { Self {inner, fetched:Cell::new(0), calls:Cell::new(0)} } fn seen(&self,n:usize) {self.fetched.set(self.fetched.get()+n as u64); self.calls.set(self.calls.get()+1);} }
impl Rows for Counted<'_> {
    fn get(&self,t:&str,id:&str)->Result<Option<Value>,RuntimeError> {let r=self.inner.get(t,id)?; self.seen(usize::from(r.is_some())); Ok(r)}
    fn lookup(&self,t:&str,n:&str,i:&Index,k:&[Value])->Result<Option<Value>,RuntimeError> {let r=self.inner.lookup(t,n,i,k)?; self.seen(usize::from(r.is_some())); Ok(r)}
    fn scan(&self,t:&str,n:&str,p:&[Value],b:&Bounds,d:Dir,l:usize)->Result<Vec<(Value,Vec<u8>)>,RuntimeError> {let r=self.inner.scan(t,n,p,b,d,l)?; self.seen(r.len()); Ok(r)}
    fn count_prefix(&self,t:&str,n:&str,p:&[Value],l:u64)->Result<u64,RuntimeError> {self.inner.count_prefix(t,n,p,l)}
    fn put(&self,t:&str,d:&Table,r:&Value,o:Option<&Value>)->Result<u64,RuntimeError> {self.inner.put(t,d,r,o)}
    fn delete(&self,t:&str,d:&Table,r:&Value)->Result<u64,RuntimeError> {self.inner.delete(t,d,r)}
}
fn measure(store:&str, rows:&dyn Rows, schema:&Schema, program:&Program, backlog:usize, cut:Cut, ceiling:u64) {
    let mut samples=Vec::new();
    let mut observation=None;
    for _ in 0..31 {
        let counted=Counted::new(rows);
        let mut runner=Runner::new(&counted,schema,context(),Meter::new(Ceilings {examined:ceiling,..Default::default()},cut),0);
        let start=Instant::now();
        let result=runner.run(program);
        let micros=start.elapsed().as_secs_f64()*1e6;
        let result=match result {Ok(v)=>serde_json::to_value(v).unwrap(),Err(e)=>serde_json::json!({"code":e.code()})};
        let item=serde_json::json!({"result":result,"meter":runner.metered(),"fetched":counted.fetched.get(),"store_calls":counted.calls.get()});
        if let Some(prior)=&observation {assert_eq!(prior,&item);} else {observation=Some(item);}
        samples.push(micros);
    }
    samples.sort_by(f64::total_cmp);
    println!("ER_MEASURE {}",serde_json::json!({"store":store,"op":program.name,"backlog":backlog,"cut":format!("{cut:?}"),"examined_ceiling":ceiling,"samples":31,"median_us":samples[15],"p95_us":samples[29],"observation":observation}));
}

#[test]
#[ignore = "lane ER instrument, explicit only"]
fn backlog_measurements() {
    let b=compiled(MODEL);
    for backlog in [0,1000,10000] {
        let memory=MemoryRows::new(); fill(&memory,&b.schema,backlog);
        let mut e=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
        let tx=e.store_mut().transaction().unwrap(); fill(&tx,&b.schema,backlog);
        for (name,rows) in [("sqlite",&tx as &dyn Rows),("memory",&memory as &dyn Rows)] {
            for op in ["page","has","total","point","probes"] {
                let p=&b.programs.iter().find(|p|p.program.name==op).unwrap().program;
                measure(name,rows,&b.schema,p,backlog,Cut::Abort,8192);
            }
            let p=&b.programs.iter().find(|p|p.program.name=="page").unwrap().program;
            measure(name,rows,&b.schema,p,backlog,Cut::Abort,4096);
        }
        // Sweep is the actual engine path including index and partition maintenance.
        drop(tx);
        e.load_trusted((1..=backlog).map(|n|("messages".into(),row(n,1000))).chain([10001,10002].map(|n|("messages".into(),row(n,9000))))).unwrap();
        let start=Instant::now(); let mut removed=0; let mut commits=0;
        loop {let n=e.sweep_expired(2000,1024).unwrap(); removed+=n; commits+=1; if n<1024 {break;}}
        println!("ER_SWEEP {}",serde_json::json!({"backlog":backlog,"removed":removed,"calls":commits,"elapsed_us":start.elapsed().as_secs_f64()*1e6}));
    }
}

#[test]
#[ignore = "lane ER instrument, explicit only"]
fn current_admission_matrix_and_live_cap() {
    for cap in [false,true] {
        let model=MODEL.replace("  read <- .conversation = viewer", &format!("{}  read <- .conversation = viewer",if cap {"  cap 4 by conversation\n"} else {""}));
        for server in [false,true] {
            for (shape,body) in [
                ("bound","  p = first(messages where .conversation = viewer first 1 by .ordinal)\n  return p"),
                ("loop","  for m in messages where .conversation = viewer first 4 by .ordinal:\n    x = m.ordinal\n  return null"),
                ("whole","  for m in messages where .conversation = viewer:\n    x = m.ordinal\n  return null"),
                ("exists","  return exists messages where .conversation = viewer"),
                ("count","  return count(messages where .conversation = viewer)"),
                ("point","  return exists messages[viewer, 1]"),
            ] {
                let source=format!("{model}\nmutation subject(){}\n{body}\n",if server {": server"} else {":"});
                let b=snapback4_lang::compile(&[("schema.q".into(),source)]);
                println!("ER_ADMISSION {}",serde_json::json!({"cap":cap,"server":server,"shape":shape,"codes":b.diagnostics.iter().map(|d|d.code.clone()).collect::<Vec<_>>() }));
            }
        }
    }
    let b=compiled(&MODEL.replace("  read <- .conversation = viewer","  cap 4 by conversation\n  read <- .conversation = viewer"));
    let mut e=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
    for n in 1..=12 {
        let epoch=((n-1)/4) as i64;
        let context=Context::new("alice",[("id".into(),id(&format!("cap{n}"))),("ordinal".into(),Value::Int(n)),("expiresAt".into(),Value::Int((epoch+1)*1000))].into()).at(epoch*1000+1);
        let r=e.mutate("add",None,context).unwrap(); assert!(matches!(r.state,WriteState::Sent{..}),"{:?}",r.state);
    }
    let physical=e.store_mut().transaction().unwrap().scan("messages","byOrdinal",&[id("alice")],&Default::default(),Dir::Asc,100).unwrap().len();
    assert_eq!(physical,12);
    println!("ER_CAP {{\"live_cap\":4,\"physical_rows\":{physical},\"sweeps\":0}}");
}

#[test]
#[ignore = "lane ER semantic witnesses, explicit only"]
fn expired_is_absent_and_denied_prefix_cost_is_population_independent() {
    let b=compiled(&format!("{MODEL}\nmutation one():\n  return exists messages[viewer, 1]\n"));
    let p=&b.programs.iter().find(|p|p.program.name=="one").unwrap().program;
    assert_eq!(b.schema.operations["one"].predicts.as_deref(),Some("eligible"));
    let rows=MemoryRows::new(); rows.put("messages",&b.schema.tables["messages"],&row(1,1000),None).unwrap();
    for (time,expected) in [(999,true),(1000,false)] {
        let prediction=snapback4_core::engine::local::predict(&rows,&b.schema,p,Context::new("alice",BTreeMap::new()).at(time),Ceilings::default()).unwrap();
        assert_eq!(prediction.result,Value::Bool(expected));
    }
    let mut denied=Vec::new();
    for backlog in [0,10000] {
        let rows=MemoryRows::new();fill(&rows,&b.schema,backlog);
        let counted=Counted::new(&rows);
        let p=&b.programs.iter().find(|p|p.program.name=="page").unwrap().program;
        let mut r=Runner::new(&counted,&b.schema,Context::new("bob",args()).at(2000),Meter::new(Ceilings::default(),Cut::Abort),0);
        assert_eq!(r.run(p).unwrap(),Value::Array(vec![]));
        denied.push(serde_json::to_value(r.metered()).unwrap());
        assert_eq!(counted.fetched.get(),0);
    }
    assert_eq!(denied[0],denied[1]);
    for (op,expected) in [("page",Value::Array(vec![])),("has",Value::Bool(false)),("total",Value::Int(0)),("point",Value::Bool(false))] {
        let p=&b.programs.iter().find(|p|p.program.name==op).unwrap().program;
        let mut r=Runner::new(&rows,&b.schema,context(),Meter::new(Ceilings::default(),Cut::Abort),0);
        assert_eq!(r.run(p).unwrap(),expected);
    }
    println!("ER_SEMANTICS expired page=[] exists=false count=0 point=false; existing point prediction true@999 false@1000; denied 0/10000 pair identical and fetches=0");
}

#[test]
#[ignore = "lane ER calibration rewrite, explicit only"]
fn calibration_delivered_rewrite_compiles_and_advances_over_expired_messages() {
    let b=compiled(include_str!("../../../experiments/er-expiring-pages/delivered.q"));
    assert_eq!(b.schema.operations["delivered"].predicts.as_deref(),Some("never"));
    let mut e=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
    let member=object([("id",id("me")),("conversation",id("c")),("principal",id("alice")),("role",Value::String("member".into())),("joinedOrdinal",Value::Int(0)),("deliveredOrdinal",Value::Int(0)),("seenOrdinal",Value::Int(0))]);
    let chat=object([("id",id("c")),("title",Value::Null),("description",Value::String("".into())),("color",Value::String("blue".into())),("background",Value::Null),("disappearing",Value::String("off".into())),("kind",Value::String("group".into())),("creatorId",id("alice")),("lastOrdinal",Value::Int(1002))]);
    let messages=(1..=1000).map(|n|("messages".into(),object([
        ("id",id(&format!("m{n}"))),("conversation",id("c")),("sender",id("alice")),("ordinal",Value::Int(n)),("recipients",Value::Int(1)),("text",Value::String("gone".into())),("expiresAt",Value::Int(1000)),("at",Value::Int(0)),("oncePhoto",Value::Null),("photo",Value::Null),("video",Value::Null),("quote",Value::Null),("edited",Value::Bool(false)),("tombstone",Value::Bool(false))])));
    e.load_trusted([("members".into(),member),("conversations".into(),chat)].into_iter().chain(messages)).unwrap();
    let a=[("conversation".into(),id("c")),("from".into(),Value::Int(1001)),("through".into(),Value::Int(1002))].into();
    let result=e.mutate("delivered",Some("delivered-1"),Context::new("alice",a).at(2000)).unwrap();
    assert!(matches!(result.state,WriteState::Sent{..}),"{:?}",result);
    let member=e.store_mut().transaction().unwrap().get("members","me").unwrap().unwrap();
    assert_eq!(member.field("deliveredOrdinal").unwrap(),&Value::Int(1002));
    println!("ER_CALIBRATION {}",serde_json::json!({"state":result.reply(Some("delivered-1")),"meter":result.metered,"deliveredOrdinal":1002}));
}
