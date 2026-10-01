// Reproduce Astra's count workload and a compiled ordinary 100-row query.
// Identical source is built against the pinned main and candidate repositories.
use snapback4_core::{value::{Value, object}, rows::{MemoryRows, Rows}, engine::{local, Context}, ir::*, meter::Ceilings, Engine};
use std::{hint::black_box,time::Instant,collections::BTreeMap};
fn count_program() -> Program {
 Program { name:"countLoop".into(),kind:ProgramKind::Query,args:[("xs".into(),ArgType::List{of:Some(Box::new(ArgType::Int)),max:1000})].into(),read_time_granularity_ms:None,returned_shapes:BTreeMap::new(),native:false,body:vec![Stmt::Let{name:"n".into(),value:Expr::Literal(Value::Int(0))},Stmt::For{binding:"i".into(),domain:LoopDomain::LiteralRange{start:0,end_exclusive:2000},body:vec![Stmt::Assign{name:"n".into(),value:Expr::Builtin{builtin:Builtin::Count,args:vec![Expr::Variable("xs".into())]}}]},Stmt::Return(Expr::Variable("n".into()))]}
}
fn main() {
 ordinary_sequence_refusal();
 let compiled=snapback4_lang::compile(&[("schema.q".into(),snapback4_lang::guide::TEMPLATE.to_owned())]);
 assert!(compiled.diagnostics.is_empty(),"{:?}",compiled.diagnostics);
 assert!(compiled.schema.receipts.is_empty());
 let programs:Vec<_>=compiled.programs.iter().map(|p|p.program.clone()).chain([count_program()]).collect();
 let rows=MemoryRows::default();
 let mut engine=Engine::memory(compiled.schema.clone(),programs.clone()).unwrap();
 let data:Vec<_>=(0..100).map(|i| ("todos".to_owned(),object([("id",Value::Id(format!("t{i:03}"))),("title",Value::String(format!("Task {i}"))),("done",Value::Bool(i%2==0)),("ownerId",Value::Id("alice".into()))]))).collect();
 for (name,row) in &data {rows.put(name,&compiled.schema.tables[name],row,None).unwrap();}
 engine.seed(data).unwrap();
 if let Some(path)=std::env::args().nth(1) {
   let page=engine.snapshot_acquisition_page_at("alice",None,1000,0).unwrap();
   let backend=serde_json::json!({"generation":engine.generation(),"schema":compiled.schema,"programs":programs});
   let page=serde_json::json!({"snapshot":true,"after":null,"held":page.held,"acquisitions":page.acquisitions,"events":page.events.iter().map(|e|serde_json::json!({"table":e.table,"kind":e.kind.word(),"id":e.id,"data":e.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),"watermark":page.watermark,"more":false,"next":null,"generation":engine.generation()});
   std::fs::write(path,serde_json::to_vec_pretty(&serde_json::json!({"backend":backend,"page":page,"notes":compiled.notes.iter().map(|n|n.to_string()).collect::<Vec<_>>()})).unwrap()).unwrap();
 }
 let mut cases:Vec<(String, &str, BTreeMap<String, Value>)>=Vec::new();
 for size in [0,100,500,1000] { cases.push((format!("count-{size}"),"countLoop",[("xs".into(),Value::Array((0..size).map(Value::Int).collect()))].into())); }
 cases.push(("ordinary-100".into(),"list",[("c".into(),Value::Null)].into()));
 for (name,operation,args) in cases {
   let p=programs.iter().find(|p|p.name==operation).unwrap();
   let mut times=Vec::new();let mut last=None;
   for i in 0..81 {
     let context=Context::new("alice",args.clone());
     let t=Instant::now();let outcome=local::query(&rows,&compiled.schema,p,context,Ceilings::default()).unwrap();black_box(&outcome);
     if i>=20 {times.push(t.elapsed().as_nanos());} last=Some(outcome);
   }
   times.sort(); let last=last.unwrap();
   println!("{}",serde_json::json!({"case":name,"median_ns":times[30],"p10_ns":times[6],"p90_ns":times[54],"metered":last.metered,"data":snapback4_core::wire::to_json(&last.data)}));
 }
}

fn ordinary_sequence_refusal() {
 let source=r#"table parents:
  title: text <=40
  public 'benchmark'
  insert <- allow
  sync public

table children:
  parent: parents
  position: sequence by parent
  public 'benchmark'
  insert <- allow
  sync public

mutation send(parent: parents):
  m = insert children { parent }
  require m.position > 0 else POSITION
  return m.id
"#;
 let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
 assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);assert!(b.schema.receipts.is_empty());
 let rows=MemoryRows::default();rows.put("parents",&b.schema.tables["parents"],&object([("id",Value::Id("p".into())),("title",Value::String("parent".into()))]),None).unwrap();
 let context=Context::new("alice",[("parent".into(),Value::Id("p".into()))].into()).with_ids(["child".into()]);
 let result=local::predict(&rows,&b.schema,&b.programs[0].program,context,Ceilings{output_bytes:1,..Default::default()});
 let error=result.unwrap_err().refusal();assert_eq!(error.code,"E_BOUND","{error:?}");
 println!("{}",serde_json::json!({"behavior":"ordinary-sequence-output-refusal","refusal":error}));
}
