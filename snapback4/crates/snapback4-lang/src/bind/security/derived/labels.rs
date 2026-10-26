//! Current-input backfills specify a candidate derived label, subject to replay.
// @ref LLP 3000.036.004.000#11-wave-27-precision-and-workflow-conservation — predecessor migrations do not establish current label equations.
use super::*;
use ast::{Expr,WriteOp};
pub(super) fn invariants(docs:&[ast::Document],catalog:&Catalog,bound:&Bound,out:&mut Vec<Invariant>){
 for backfill in docs.iter().flat_map(|doc|&doc.backfills){
  let Some(table)=bound.schema.tables.get(&backfill.table)else{continue;};
  let Some(info)=catalog.tables.get(&backfill.table)else{continue;};
  if backfill.args.is_empty()||backfill.args.iter().any(|arg|info.columns.get(&arg.name)!=Some(&arg.type_)){continue;}
  let Expr::Object{fields,..}=&backfill.value else{continue;};
  for field in fields {
   if backfill.args.iter().any(|arg|arg.name==field.name)||!table.columns.contains_key(&field.name){continue;}
   let Some(value)=&field.value else{continue;};
   let setter=docs.iter().flat_map(|doc|&doc.programs).filter(|p|p.kind==ast::ProgramKind::Mutation).any(|p|
    authority_walk::writes(catalog,p).iter().any(|(write,_)|matches!(write,Expr::Write{op:WriteOp::Update|WriteOp::Upsert,table,fields,..} if table==&backfill.table&&fields.iter().any(|f|f.name==field.name&&f.value.as_ref().is_some_and(|v|stored_argument(v,p).is_some())))));
   if !setter{continue;}
   let args=backfill.args.iter().map(|arg|(arg.name.clone(),workflow::member(workflow::focal(),&arg.name))).collect();
   let Some(value)=workflow::normalize(value,&bound.schema,&backfill.table,&args)else{continue;};
   let mut probe=value.clone();let mut dependent=false;super::super::super::intent_walk::expression(&mut probe,&mut |e|if matches!(e,Expr::Focal{..}){dependent=true;});
   if !dependent{continue;}
   workflow::add_syntax(out,&backfill.table,None,"always",workflow::binary("=",workflow::member(workflow::focal(),&field.name),value),&backfill.site,"label-consistency",None);
  }
 }
}
