//! Seeded admission differential, plus the reviewers' exact boundary shapes.
use super::*;
use snapback4_core::error::RuntimeError;
use snapback4_device::device::Backend;

#[derive(Clone, Debug)]
struct Case { label: String, source: String, receipts: bool, writes: usize,
    seeds: Vec<(String,Value)>, keys: Vec<Value> }
#[path = "prediction_round4.rs"]
mod round4;
impl Case {
    fn values(&self) -> Vec<(&str,Value)> {
        let mut values = if self.receipts {vec![("conversation",id("c"))]}else{vec![]};
        if !self.keys.is_empty() { values.push(("keys",Value::Array(self.keys.clone()))); }
        values
    }
    fn args(&self) -> serde_json::Value {
        let mut args = if self.receipts {json!({"conversation":"c"})}else{json!({})};
        if !self.keys.is_empty() {args["keys"]=json!(self.keys.iter().map(|v|v.as_str().unwrap()).collect::<Vec<_>>());}
        args
    }
}
fn plain() -> String { r#"
table rooms:
  public
  insert <- allow
  sync public
table notes:
  room: rooms
  shelf: shelves ?
  mark: int default 0
  shots: [image <=1000] <=0 ?
  public
  insert <- allow
  sync public
table readers:
  room: rooms
  watermark: int default 0
  cap 50 by room
  public
  insert <- allow
  sync public
query rows():
  return notes first 100 by byId
"#.into() }
fn make(label: String, receipts: bool, private: usize, sum: bool, public: usize, online: bool, row: bool, slots: usize, burst: usize, notes: usize) -> Case {
    let mut src = if receipts { source().replace("  text: text <=2000", &format!("  shelf: shelves ?\n  shots: [image <=1000] <={slots} ?\n  text: text <=2000")) }
        else { plain().replace("<=0 ?", &format!("<={slots} ?")) };
    let (table, group, member, mark) = if receipts { ("messages","conversation","members","ordinal") } else { ("notes","room","readers","mark") };
    src += "\ntable shelves:\n";
    for n in 0..private {
        src += &format!("  total{n}: {} {table}{} by .shelf\n", if sum {"sum"} else {"count"}, if sum {format!(" of .{mark}")} else {String::new()});
    }
    src += if online { "  public\n  insert <- allow\n  online only\n" } else { "  public\n  insert <- allow\n  sync public\n" };
    for n in 0..public {
        src += &if row { format!("\nview bucket{n}: count {table} by {member} m where .{group} = m.{group} and .{mark} > m.{}\n", if receipts {"seenOrdinal"} else {"watermark"}) }
            else { format!("\nview bucket{n}: {} {table}{} where .{mark} != -{n} by .{group}\n",if sum {"sum"}else{"count"},if sum {format!(" of .{mark}")}else{String::new()}) };
        if online { src += "  online only\n"; }
    }
    if receipts {
        src += "\ntable notes:\n  public\n  insert <- allow\n  sync public\nmutation burst(conversation: conversations):\n";
        src += &format!("  for n in range(0, {burst}):\n    insert messages {{ conversation, shelf: 's', sender: viewer, text: 'burst', photo: null, shots: null, at: now }}\n");
        if notes != 0 { src += &format!("  for n in range(0, {notes}):\n    insert notes {{}}\n"); }
    } else {
        src += &format!("\nmutation burst():\n  for n in range(0, {burst}):\n    insert notes {{ room: 'c', shelf: 's', mark: 0, shots: null }}\n");
        if notes != 0 { src += &format!("  for n in range(0, {notes}):\n    insert rooms {{}}\n"); }
    }
    Case { label, source: src, receipts, writes: burst+notes, seeds: vec![], keys: vec![] }
}
fn setup(case: &Case) -> (Engine, Backend) {
    let compiled = snapback4_lang::compile(&[("schema.q".into(),case.source.clone())]);
    assert!(compiled.diagnostics.is_empty(),"{}: {:?}\n{}",case.label,compiled.diagnostics,case.source);
    assert_receipt_notes(&compiled);
    let mut e=Engine::memory(compiled.schema.clone(),compiled.programs.iter().map(|p|p.program.clone())).unwrap();
    let mut b=Backend {generation:e.generation(),schema:compiled.schema,programs:compiled.programs.into_iter().map(|p|p.program).collect()};
    let decoded: Backend=snapback4_core::json_codec::from_text(&serde_json::to_string(&b).unwrap()).unwrap();
    assert_eq!(serde_json::to_value(&b).unwrap(),serde_json::to_value(decoded).unwrap());
    if case.receipts { seed(&mut e); }
    else if e.schema().tables.contains_key("rooms") { e.seed_at([
        ("rooms".into(),object([("id",id("c"))])),
        ("readers".into(),object([("id",id("a")),("room",id("c")),("watermark",Value::Int(-1))])),
    ],NOW).unwrap(); }
    if e.schema().tables.contains_key("shelves") {e.seed_at([("shelves".into(),object([("id",id("s"))]))],NOW).unwrap();}
    e.seed_at(case.seeds.clone(),NOW).unwrap();
    if b.programs.iter().any(|p|p.name=="registerReservation") {
        let out=e.mutate("registerReservation",None,ctx("alice",&[],NOW).with_ids(["fixture-profile".into()])).unwrap();
        assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");
    }
    for name in b.schema.tables.keys() {
        assert_eq!(b.schema.write_reservation(name),snapback4_core::schema::reservations::reservation(e.schema(),name),"{}: {name}",case.label);
    }
    b.schema=b.schema.public_projection();
    (e,b)
}
fn run<H: Host>(host: &mut H, case: &Case, must_queue: bool) -> (bool,bool) {
    let (mut e,b)=setup(case);
    let mut d=host.open(&case.label,Some(b)).unwrap();
    publish(&mut e,&mut d,"alice");
    let args=case.args();
    let before: Vec<_> = e.schema().tables.keys().map(|t|(t.clone(),d.store().raw_rows(t))).collect();
    let admission=d.admit(request("burst",args,1));
    let predictable=admission.as_ref().is_ok_and(|q| q.predictable);
    let values=case.values();
    let outcome=e.mutate("burst",None,ctx("alice",&values,NOW)).unwrap();
    let success=matches!(outcome.state,WriteState::Sent {..});
    assert!(!predictable || success,"{}: predicted/server refusal {outcome:?}\n{}",case.label,case.source);
    if !predictable && success { assert!(admission.is_ok(),"{}: a conservative refusal must retain custody: {admission:?}",case.label); }
    if !predictable { for (table,rows) in before {assert_eq!(d.store().raw_rows(&table),rows,"{}: rollback {table}",case.label);} }
    if must_queue {
        let q=admission.as_ref().unwrap();
        assert!(!q.predictable && q.predicted.is_empty(),"{}: {q:?}\n{}",case.label,case.source);
        assert_eq!(d.queued().unwrap().len(),1);
        assert!(!success && format!("{outcome:?}").contains("E_BOUND"),"{}: {outcome:?}",case.label);
    }
    if let Err(error)=&admission { assert!(matches!(error,RuntimeError::Bound {..}),"{}: {error:?}",case.label); }
    if predictable { assert!(admission.as_ref().unwrap().predicted.len()>=case.writes); }
    eprintln!("RP differential {} predicted={predictable} server={success} meter={:?}",case.label,outcome.metered);
    (predictable,success)
}
fn concrete() -> Vec<Case> { vec![
    make("r3-private-five".into(),true,1,false,1,false,true,0,5,0),
    make("r3-counter-mixed".into(),true,0,false,1,false,true,0,5,15),
    make("r3-private-slots-receipts".into(),true,1,false,0,false,false,510,1,0),
    make("r3-private-slots-plain".into(),false,1,false,0,false,false,510,1,0),
    make("r3-private-ten".into(),false,10,false,0,false,false,0,26,0),
    // mark != 1 matches the inserted zero.
    {let mut c=make("r3-online-aggregate".into(),false,0,false,1,true,false,0,600,0);c.source=c.source.replace(".mark != -0",".mark != 1");c},
] }
fn regressions<H: Host>(host: &mut H) {for c in concrete() {run(host,&c,true);}}
both!(reservation_round3_regressions_memory,reservation_round3_regressions_sqlite,regressions);

fn generated() -> Vec<Case> {
    const SEED:u64=0x5250_2026_1003;
    let mut rng=SEED;
    let mut next=|n:usize| {rng=rng.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);((rng>>32) as usize)%n};
    let mut cases = Vec::new();
    for case in 0..256 {
        let receipts=next(2)==0;
        let private=[0,1,2,10][next(4)];let sum=next(4)==0;
        let public=[0,1,2,6][next(4)];let online=next(2)==0;let row=next(2)==0;
        let slots=[0,1,8,32,64,480,508,510,512][next(9)];
        let burst=[1,2,5,16,26,50,150,600][next(8)];let notes=[0,1,15,30][next(4)];
        let c=make(format!("seed-{SEED:x}-case-{case}-r{receipts}-p{private}-sum{sum}-v{public}-online{online}-row{row}-slots{slots}-n{burst}-other{notes}"),receipts,private,sum,public,online,row,slots,burst,notes);
        cases.push(c);
    }
    cases
}
fn differential<H: Host>(host: &mut H) {
    let mut predicted=0;let mut conservative=0;let mut refused=0;
    let mut cases=generated();
    cases.extend(round4::generated());
    let total=cases.len();
    for c in cases {
        let (p,s)=run(host,&c,false);predicted+=usize::from(p);conservative+=usize::from(!p&&s);refused+=usize::from(!s);
    }
    assert!(predicted>0 && conservative>0 && refused>0);
    eprintln!("RP DIFFERENTIAL seed=525020261003 cases={total} predicted={predicted} conservative={conservative} server_refused={refused}");
}
both!(reservation_differential_memory,reservation_differential_sqlite,differential);

// A small cross-runtime corpus contains schemas and authoritative initial
// snapshots only. The server results are regenerated here on every suite run.
// UPDATE_RP_WASM_CASES writes the fixture; it never disables its verification.
#[test]
fn reservation_wasm_corpus_matches_engine() {
    let mut cases = concrete();
    cases.extend(generated().into_iter().take(16));
    let mut corpus = Vec::new();
    for (i, c) in cases.into_iter().enumerate() {
        let (mut e,b) = setup(&c);
        let pages = snapshot_pages(&mut e,"alice",1000);
        let mut d = Device::open_store(snapback4_device::memory::MemoryStore::new(),Some(b)).unwrap();
        for (i,p) in pages.iter().enumerate() { d.apply(p,i==0).unwrap(); }
        let args=c.args();
        let q=d.admit(request("burst",args.clone(),1));
        let values=c.values();
        let outcome=e.mutate("burst",None,ctx("alice",&values,NOW)).unwrap();
        let committed=matches!(outcome.state,WriteState::Sent {..});
        let predicted=q.as_ref().is_ok_and(|q|q.predictable);
        assert!(!predicted || committed,"{}: {outcome:?}",c.label);
        corpus.push(json!({"label":c.label,"source":c.source,"pages":pages,"args":args,
            "serverCommitted":committed,"predicted":predicted,"denied":q.is_err(),"mustQueue":i<6}));
    }
    let actual=serde_json::to_string(&corpus).unwrap()+"\n";
    let path=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/rp-reservation-cases.json");
    if std::env::var_os("UPDATE_RP_WASM_CASES").is_some() { std::fs::write(&path,&actual).unwrap(); }
    let expected=std::fs::read_to_string(&path).unwrap();
    assert_eq!(serde_json::from_str::<serde_json::Value>(&expected).unwrap(),serde_json::from_str::<serde_json::Value>(&actual).unwrap());
}

fn legacy_unrelated<H: Host>(host: &mut H) {
    for nested in [false,true] {
    let name=if nested {"legacy-nested"}else{"legacy-clean"};
    let src = fixture(false)+"\nmutation plainPost():\n  insert ordinary { text: 'post' }\ntable ordinary:\n  text: text <=20\n  public\n  insert <- allow\n  sync public\n";
    let (mut e,mut b)=compile(&src);
    seed(&mut e);
    if nested {
        use snapback4_core::ir::{Expr,Stmt};
        let p=b.programs.iter_mut().find(|p|p.name=="send").unwrap();
        let body=std::mem::take(&mut p.body);
        p.body=vec![Stmt::Return(Expr::Block {body,value:Box::new(Expr::Literal(Value::Null))})];
    }
    let mut d=host.open(name,Some(b.clone())).unwrap();
    publish(&mut e,&mut d,"alice");
    host.close(name,d);
    let mut wire=serde_json::to_value(&b).unwrap();
    wire["schema"].as_object_mut().unwrap().remove("source_reservations");
    for table in wire["schema"]["tables"].as_object_mut().unwrap().values_mut() {
        for c in table["constraints"].as_array_mut().unwrap() {
            if let Some(caps)=c.get_mut("Capabilities").and_then(|v|v.as_array_mut()) {
                caps.retain(|v|v!="receipt-derived-prediction-v1"&&v!="source-write-reservations-v1");
            }
        }
    }
    host.patch_meta(name,&[("device:backend",Some(wire.to_string()))]);
    let decoded: Backend=serde_json::from_value(wire).unwrap();
    for op in ["close","plainPost"] {assert_eq!(decoded.schema.operations[op].predicts.as_deref(),Some("eligible"),"{op}");}
    for op in ["send","countWriter"] {assert_eq!(decoded.schema.operations[op].predicts.as_deref(),Some("never"),"{op}");}
    // Kept decodes the stored program even when the app has a fresh backend.
    let mut d=host.open(name,None).unwrap();
    assert!(d.admit(request("plainPost",json!({}),1)).unwrap().predictable);
    assert!(d.admit(request("close",json!({"conversation":"c"}),2)).unwrap().predictable);
    let q=d.admit(queued("alice",3)).unwrap();
    assert!(!q.predictable && q.predicted.is_empty());
    assert!(history_pending(&mut d).is_empty());
    }
}
both!(reservation_legacy_unrelated_memory,reservation_legacy_unrelated_sqlite,legacy_unrelated);
