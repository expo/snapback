//! Stable participant ledgers retain value across removal.
// @ref LLP 3000.036.004.000#11-wave-27-precision-and-workflow-conservation — source-linked charge/refund contracts are replayed on committed deletes.
use super::*;
use ast::{Expr,WriteOp};
use snapback4_core::{Value,schema::ColumnType as C};
#[derive(Clone,Debug)]pub(crate) struct Conservation{
 pub ledger:String,pub refund_ledger:Option<String>,pub keys:Vec<(String,String)>,pub kind:String,pub charge:String,pub refund:String,pub amount:Option<String>
}
impl Conservation{
 pub(crate) fn judge(&self,old:&Value,after:&BTreeMap<String,Vec<Value>>)->Option<bool>{
  let mut charge=0i128;let mut refund=0i128;
  for (ledger,refund_side) in std::iter::once((&self.ledger,false)).chain(self.refund_ledger.iter().map(|table|(table,true))){
   for row in after.get(ledger).into_iter().flatten(){
    if !self.keys.iter().all(|(participant,ledger)|old.field(participant).ok().is_some_and(|value|*value!=Value::Null&&row.field(ledger).ok()==Some(value))){continue;}
    let amount=if let Some(column)=&self.amount{let Value::Int(amount)=row.field(column).ok()? else{return None;};if *amount<0{return None;}i128::from(*amount)}else{1};
    let (is_charge,is_refund)=if self.refund_ledger.is_some(){(!refund_side,refund_side)}else{let Value::String(kind)=row.field(&self.kind).ok()? else{return None;};(kind==&self.charge,kind==&self.refund)};
    if is_charge{charge=charge.checked_add(amount)?;}else if is_refund{refund=refund.checked_add(amount)?;}
   }
  }Some(refund>=charge)
 }
}
fn literal<'a>(fields:&'a [ast::ObjectField],column:&str)->Option<&'a str>{
 match fields.iter().find(|field|field.name==column)?.value.as_ref()?{Expr::Literal{value:ast::Literal::Str(value),..}=>Some(value),_=>None}
}
fn coexecuted(p:&ast::ProgramDecl,a:&Site,b:&Site)->bool{
 let mut sites=BTreeSet::new();
 for stmt in p.prelude.iter().chain(&p.body){match stmt{
  ast::Stmt::Expr{value,..}|ast::Stmt::Bind{value,..}|ast::Stmt::Return{value,..}=>{
   if let Expr::Write{site,condition:None,if_absent:false,..}=value{sites.insert(site.to_string());}
   if sites.contains(&a.to_string())&&sites.contains(&b.to_string()){return true;}
   if matches!(stmt,ast::Stmt::Return{..}){return false;}
  },
  ast::Stmt::If{..}|ast::Stmt::For{..}|ast::Stmt::As{..}|ast::Stmt::Break{..}|ast::Stmt::Continue{..}=>return false,
  _=>{}
 }}false
}
fn shared_value(a:&Expr,b:&Expr)->bool{
 if crate::print::expression(a)!=crate::print::expression(b){return false;}
 fn custody(value:&Expr)->Vec<Site>{
  let mut value=value.clone();let mut sites=Vec::new();
  super::super::super::intent_walk::expression(&mut value,&mut |e|if matches!(e,Expr::Read(_)|Expr::Call{..}|Expr::Write{..}){sites.push(e.site().clone());});sites
 }
 custody(a)==custody(b)
}
pub(super) fn contracts(docs:&[ast::Document],catalog:&Catalog,bound:&Bound)->Vec<(Invariant,Conservation)>{
 let writes=docs.iter().flat_map(|doc|&doc.programs).filter(|p|p.kind==ast::ProgramKind::Mutation).flat_map(|p|authority_walk::writes(catalog,p).into_iter().map(move |(w,_)|(p,w))).collect::<Vec<_>>();
 let mut result=Vec::new();
 for (producer,write) in &writes{
  let Expr::Write{op:WriteOp::Insert|WriteOp::Upsert,table:ledger,fields:charged,..}=write else{continue;};
  let Some(l)=bound.schema.tables.get(ledger)else{continue;};
  if l.is_expiring()||l.through.is_some()||l.rules.delete!=RuleExpr::Deny||l.update_rule_judged().as_ref()!=&RuleExpr::Deny{continue;}
  let mut directions=Vec::new();
  for (kind,ty) in &l.columns{if let C::Enum{variants}=ty.required()&&let Some(charge)=literal(charged,kind).filter(|value|matches!(*value,"charge"|"debit")){
   let refund=if charge=="charge"{"refund"}else{"credit"};
   if variants.iter().any(|v|v==refund)&&writes.iter().any(|(_,w)|matches!(w,Expr::Write{op:WriteOp::Insert|WriteOp::Upsert,table,fields,..} if table==ledger&&literal(fields,kind)==Some(refund))){directions.push((kind.clone(),charge.to_owned(),refund.to_owned(),None));}
  }}
  if directions.is_empty()&&["charge","payment"].iter().any(|part|ledger.to_lowercase().contains(part)){
   for (refund,r) in bound.schema.visible_tables().filter(|(name,_)|name.to_lowercase().contains("refund")){
    if !r.is_expiring()&&r.through.is_none()&&r.rules.delete==RuleExpr::Deny&&r.update_rule_judged().as_ref()==&RuleExpr::Deny&&writes.iter().any(|(_,w)|matches!(w,Expr::Write{op:WriteOp::Insert|WriteOp::Upsert,table,..} if table==refund)){
     directions.push((String::new(),"charge".into(),"refund".into(),Some(refund.clone())));
    }
   }
  }
  if directions.iter().filter(|(_,_,_,refund)|refund.is_some()).count()>1{continue;}
  for (kind,charge,refund,refund_ledger) in directions{
   let amounts=l.columns.iter().filter(|(_,kind)|matches!(kind.required(),C::Money{..})).map(|(column,_)|column.clone()).collect::<Vec<_>>();
   let numeric=l.columns.iter().filter(|(_,kind)|matches!(kind.required(),C::Int|C::IntRange{..}|C::Decimal{..})).map(|(column,_)|column.clone()).collect::<Vec<_>>();
   let amount=if amounts.len()==1{Some(amounts[0].clone())}else if amounts.len()>1{continue;}else if numeric.len()==1{Some(numeric[0].clone())}else if numeric.is_empty(){None}else{continue;};
   for (other,participant) in &writes{
    if !std::ptr::eq(*producer,*other){continue;}
    let Expr::Write{op:WriteOp::Insert|WriteOp::Upsert,table,fields,site,..}=participant else{continue;};
    if table==ledger||!coexecuted(producer,write.site(),site){continue;}
    let Some(t)=bound.schema.tables.get(table)else{continue;};
    if !writes.iter().any(|(_,w)|matches!(w,Expr::Write{op:WriteOp::Delete,table:target,..} if target==table)){continue;}
    let keys=fields.iter().filter_map(|f|{
     let kind=t.columns.get(&f.name)?;
     if !matches!(kind.required(),C::Principal|C::Ref{..})||kind.is_optional()||!t.immutable_fields().any(|c|c==f.name){return None;}
     let value=f.value.as_ref()?;let matches=charged.iter().filter(|g|l.columns.get(&g.name)==Some(kind)&&g.value.as_ref().is_some_and(|v|shared_value(v,value))).collect::<Vec<_>>();
     if matches.len()==1{Some((f.name.clone(),matches[0].name.clone()))}else{None}
    }).collect::<Vec<_>>();
    if keys.len()<2||!keys.iter().any(|(c,_)|matches!(t.columns[c].required(),C::Principal))||!t.indexes.values().any(|index|index.unique&&index.columns().iter().all(|c|keys.iter().any(|(k,_)|k==c))){continue;}
    if keys.iter().any(|(_,c)|!l.immutable_fields().any(|f|f==c))||!kind.is_empty()&&!l.immutable_fields().any(|c|c==kind)||amount.as_ref().is_some_and(|c|!l.immutable_fields().any(|f|f==c)){continue;}
    // A ledger identity must survive its parent's removal as well.
    if l.columns.keys().any(|c|l.on_delete.get(c).is_some_and(|action|!matches!(action,snapback4_core::schema::references::OnDelete::Restrict|snapback4_core::schema::references::OnDelete::Keep))){continue;}
    if let Some(refund)=&refund_ledger{
     let r=&bound.schema.tables[refund];let Some(amount)=&amount else{continue;};
     if !matches!(l.columns[amount].required(),C::Money{..})||r.columns.get(amount)!=l.columns.get(amount)||!r.immutable_fields().any(|c|c==amount)||r.on_delete.values().any(|action|!matches!(action,snapback4_core::schema::references::OnDelete::Restrict|snapback4_core::schema::references::OnDelete::Keep))||keys.iter().any(|(_,c)|r.columns.get(c)!=l.columns.get(c)||!r.immutable_fields().any(|field|field==c)||r.on_delete.get(c).is_some_and(|action|!matches!(action,snapback4_core::schema::references::OnDelete::Restrict|snapback4_core::schema::references::OnDelete::Keep))){continue;}
    }
    let contract=Conservation{ledger:ledger.clone(),refund_ledger:refund_ledger.clone(),keys,kind:kind.clone(),charge:charge.clone(),refund:refund.clone(),amount:amount.clone()};
    let predicate=format!("participant removal conserves {ledger}: {refund} covers {charge} for {:?}",contract.keys);
    use sha2::{Digest,Sha256};let hash=format!("{:x}",Sha256::digest(format!("{table}/{predicate}/{contract:?}")));
    let site=Site::new(&format!("$derived/participant-conservation/{hash}/{}",site.file),site.line,site.col);
    let inv=Invariant{table:table.clone(),column:None,target:"delete".into(),predicate,policy:None,site,operation:None,requirements:Vec::new(),syntax:None,unsupported:Some("conservation requires a committed participant removal and stable typed ledger; no static proof".into())};
    if !result.iter().any(|(i,_):&(Invariant,Conservation)|i.site==inv.site){result.push((inv,contract));}
   }
  }
 }result
}

#[cfg(test)]mod tests{
 use super::*;
 fn row(fields:Vec<(&str,Value)>)->Value{Value::Row(fields.into_iter().map(|(k,v)|(k.into(),v)).collect())}
 #[test]fn amount_balance_keeps_composite_identity_and_requires_full_refund(){
  let c=Conservation{ledger:"ledger".into(),refund_ledger:None,keys:vec![("event".into(),"event".into()),("person".into(),"person".into())],kind:"kind".into(),charge:"charge".into(),refund:"refund".into(),amount:Some("amount".into())};
  let old=row(vec![("event",Value::Id("e".into())),("person",Value::Id("p".into()))]);
  let record=|kind:&str,amount:i64,event:&str,person:&str|row(vec![("event",Value::Id(event.into())),("person",Value::Id(person.into())),("kind",Value::String(kind.into())),("amount",Value::Int(amount))]);
  let check=|rows|c.judge(&old,&BTreeMap::from([("ledger".into(),rows)]));
  assert_eq!(check(vec![]),Some(true));
  assert_eq!(check(vec![record("charge",100,"e","p")]),Some(false));
  for (event,person) in [("other","p"),("e","other")]{assert_eq!(check(vec![record("charge",100,"e","p"),record("refund",100,event,person)]),Some(false));}
  assert_eq!(check(vec![record("charge",100,"e","p"),record("refund",99,"e","p")]),Some(false));
  assert_eq!(check(vec![record("charge",100,"e","p"),record("refund",100,"e","p")]),Some(true));
  assert_eq!(check(vec![record("charge",100,"e","p"),record("refund",-1,"e","p")]),None);
 }
}


// Recognized charge/removal shapes must not silently lose their inference.
pub(super) fn source_gaps(docs:&[ast::Document],catalog:&Catalog,bound:&Bound)->BTreeSet<String>{
 let supported=contracts(docs,catalog,bound);let mut gaps=BTreeSet::new();
 let writes=docs.iter().flat_map(|d|&d.programs).filter(|p|p.kind==ast::ProgramKind::Mutation).flat_map(|p|authority_walk::writes(catalog,p).into_iter().map(move |(w,_)|(p,w))).collect::<Vec<_>>();
 for (p,write) in &writes{
  let Expr::Write{op:WriteOp::Insert|WriteOp::Upsert,table:ledger,fields,site,..}=write else{continue;};
  let Some(l)=bound.schema.tables.get(ledger)else{continue;};
  let charge=l.columns.iter().any(|(c,k)|matches!(k.required(),C::Enum{..})&&literal(fields,c).is_some_and(|value|matches!(value,"charge"|"debit")))||
   l.columns.values().any(|k|matches!(k.required(),C::Money{..}));
  if !charge{continue;}
  for (other,participant) in &writes{
   if !std::ptr::eq(*p,*other){continue;}
   let Expr::Write{op:WriteOp::Insert|WriteOp::Upsert,table,..}=participant else{continue;};
   if table==ledger||!writes.iter().any(|(_,w)|matches!(w,Expr::Write{op:WriteOp::Delete,table:t,..} if t==table))||
      supported.iter().any(|(inv,c)|inv.table==*table&&c.ledger==*ledger){continue;}
   if !bound.schema.tables.get(table).is_some_and(|t|t.columns.values().any(|kind|matches!(kind.required(),C::Principal))){continue;}
   gaps.insert(format!("participant conservation not covered for {table} and {ledger} at {site}: coexecuted births, exact captured identity, one stable amount/refund association and non-disappearing ledgers could not all be established; capture shared identity once, retain an immutable non-expiring ledger, declare explicit delete intent and rerun check -> test; no inferred FIX"));
  }
 }gaps
}
