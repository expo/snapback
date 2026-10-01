use snapback4_core::{value::Value, rows::MemoryRows, schema::Schema, engine::{local, Context}, ir::*, meter::Ceilings};
use std::{hint::black_box,time::Instant,collections::BTreeMap};
fn main() {
 for size in [0, 100, 500, 1000] {
 let values=Value::Array((0..size).map(Value::Int).collect());
 let program=Program { name: "countLoop".into(),kind: ProgramKind::Query,args: [("xs".into(),ArgType::List{of:Some(Box::new(ArgType::Int)),max:1000})].into(),read_time_granularity_ms:None,returned_shapes:BTreeMap::new(),native:false,body:vec![Stmt::Let{name:"n".into(),value:Expr::Literal(Value::Int(0))},Stmt::For{binding:"i".into(),domain:LoopDomain::LiteralRange{start:0,end_exclusive:2000},body:vec![Stmt::Assign{name:"n".into(),value:Expr::Builtin{builtin:Builtin::Count,args:vec![Expr::Variable("xs".into())]}}]},Stmt::Return(Expr::Variable("n".into()))]};
 let rows=MemoryRows::default(); let schema=Schema::default();
 assert!(schema.receipts.is_empty());
 let mut times=vec![]; let mut used=None;
 for _ in 0..15 {
 let context=Context::new("a",[("xs".into(),values.clone())].into());
 let t=Instant::now(); let outcome=local::query(&rows,&schema,&program,context,Ceilings::default()).unwrap();
 black_box(&outcome); times.push(t.elapsed().as_nanos());used=Some(outcome.metered);
 }
 times.sort();println!("countLoop size={size} median_ns={} metered={:?}",times[7],used.unwrap());
 let t=Instant::now();for _ in 0..200000 {black_box(black_box(&values).as_array().unwrap().len());}println!("as_array size={size} total_ns={}",t.elapsed().as_nanos());
 }
}
