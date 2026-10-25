//! Empty approval initialization is not an authored column authority event.
// @ref LLP 3000.036.004.000#9-integration-24-wave-26-precision — insert initialization and actual changed edits are separate boundaries.
use super::*;
use snapback4_core::{Value,schema::ColumnDefault};

fn unapproved_default(bound:&Bound,inv:&Invariant)->bool {
    inv.column.as_ref().is_some_and(|column|
        matches!(bound.schema.tables[&inv.table].defaults.get(column),Some(ColumnDefault::Literal(Value::Bool(false)))))
}
pub(super) fn empty_creation(bound:&Bound,inv:&Invariant,old:Option<&Value>,row:&Value)->bool {
    inv.target=="write" && old.is_none() && inv.column.as_ref().is_some_and(|column|
        matches!(row.field(column),Ok(Value::Null)) || unapproved_default(bound,inv)&&matches!(row.field(column),Ok(Value::Bool(false))))
}
pub(super) fn policy(bound:&Bound,inv:&Invariant,effect:&str)->Option<RuleExpr> {
    let policy=inv.policy.clone()?;
    if effect!="insert"||inv.target!="write" {return Some(policy);}
    let Some(column)=&inv.column else{return Some(policy);};
    let mut alternatives=vec![RuleExpr::Eq(RuleTerm::Field(column.clone()),RuleTerm::Literal(Value::Null)),policy];
    if unapproved_default(bound,inv){alternatives.push(RuleExpr::Eq(RuleTerm::Field(column.clone()),RuleTerm::Literal(Value::Bool(false))));}
    Some(RuleExpr::Or(alternatives))
}

#[cfg(test)]mod tests {
 use super::*;
 #[test]fn clearing_or_initializing_a_sibling_does_not_exempt_an_edit(){
  let b=crate::compile(&[("schema.q".into(),"table docs:\n  approved: bool default false\n  reason: text ?\n  read <- allow\n  insert <- allow\n  online only\ninvariant docs.approved write only deny\ninvariant docs.reason write only deny\n".into())]);
  assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
  let row=Value::Row(std::collections::BTreeMap::from([("approved".into(),Value::Bool(false)),("reason".into(),Value::Null)]).into());
  for inv in &b.invariants {assert!(empty_creation(&b,inv,None,&row));assert!(!empty_creation(&b,inv,Some(&row),&row));assert_eq!(policy(&b,inv,"update"),inv.policy);}
 }
}


// Only the authored literal at this exact insert site receives this exemption.
// Caller values equal to the default and later edits still require authority.
// @ref LLP 3000.036.004.000#11-wave-27-precision-and-workflow-conservation — default initialization has source custody.
pub(super) fn capture(catalog:&Catalog,bound:&mut Bound){
 fn authority_fields(bound:&Bound,table:&str)->BTreeSet<String>{
  let mut out=privilege::role_columns(bound,table);
  if let Some(t)=bound.schema.tables.get(table)&&t.indexes.values().any(|index|index.unique&&index.columns().iter().any(|column|matches!(t.columns.get(column).map(snapback4_core::schema::ColumnType::required),Some(snapback4_core::schema::ColumnType::Principal)))){
   for column in ["role","kind"]{if t.columns.contains_key(column){out.insert(column.into());}}
  }
  fn visit(bound:&Bound,rule:&RuleExpr,table:&str,out:&mut BTreeSet<String>){match rule{
   RuleExpr::Exists{table:t,index,key,equalities,..} if t==table=>for (column,term) in privilege::probe_pairs(bound,t,index,key,equalities){if matches!(term,RuleTerm::Literal(Value::String(_)|Value::Bool(true))){out.insert(column);}},
   RuleExpr::And(xs)|RuleExpr::Or(xs)=>for rule in xs{visit(bound,rule,table,out)},RuleExpr::Not(rule)=>visit(bound,rule,table,out),_=>{}
  }}
  for t in bound.schema.tables.values(){for rule in super::columns::rules(t){visit(bound,rule,table,&mut out);}}out
 }
 let mut authority_cache=BTreeMap::new();
 let mut candidates:BTreeMap<(String,String,String,String),bool>=BTreeMap::new();
 for doc in &catalog.documents{for p in doc.programs.iter().filter(|p|p.kind==ast::ProgramKind::Mutation){
  let operation=super::super::operation_name(std::path::Path::new(&doc.file).file_stem().and_then(|s|s.to_str()).unwrap_or(&doc.file),&p.name);
  for (write,_) in authority_walk::writes(catalog,p){
   let ast::Expr::Write{op:ast::WriteOp::Insert|ast::WriteOp::Upsert,table,fields,site,..}=write else{continue;};
   let Some(t)=bound.schema.tables.get(&table)else{continue;};
   let roles=authority_cache.entry(table.clone()).or_insert_with(||{
   let mut roles=authority_fields(bound,&table);
   for program in catalog.documents.iter().flat_map(|doc|&doc.programs){
    for (_,context) in authority_walk::writes(catalog,program){for statement in &context.body{
     if let ast::Stmt::Require{condition,..}=statement{let mut condition=condition.clone();super::super::intent_walk::expression(&mut condition,&mut |e|if let ast::Expr::Read(read)|ast::Expr::Exists{read,..}=e&&read.table==table{
      for key in &read.keys{if let Some(column)=&key.column&&matches!(key.value,ast::Expr::Literal{..}){roles.insert(column.clone());}}
     });}
    }}
   }
   roles
   });
   for (column,default) in &t.defaults{
    let ColumnDefault::Literal(default)=default else{continue;};
    if roles.contains(column)||["approv","authoriz"].iter().any(|part|column.to_lowercase().contains(part))||matches!(default,Value::Bool(true)){continue;}
    let literal=fields.iter().find(|field|&field.name==column).and_then(|field|field.value.as_ref()).and_then(|value|match value{
     ast::Expr::Literal{value:ast::Literal::Str(value),..}=>Some(Value::String(value.clone())),
     ast::Expr::Literal{value:ast::Literal::Bool(value),..}=>Some(Value::Bool(*value)),
     ast::Expr::Literal{value:ast::Literal::Null,..}=>Some(Value::Null),
     ast::Expr::Literal{value:ast::Literal::Number(_),..}=>creation_advice::duration_number(value).map(Value::Int),
     _=>None
    });
    let eligible=literal.as_ref()==Some(default);
    candidates.entry((operation.clone(),table.clone(),column.clone(),site.to_string())).and_modify(|all|*all&=eligible).or_insert(eligible);
   }
  }
 }}
 for ((operation,table,column,site),eligible) in candidates{if eligible{bound.security_literal_defaults.entry((operation,table,column)).or_default().insert(site);}}
}


#[cfg(test)]mod wave27_default_tests{
 use super::*;
 #[test]fn scoped_membership_authority_is_not_default_initialization(){
  let b=crate::compile(&[("schema.q".into(),"table teams:\n  name: text\n  read <- allow\n  online only\ntable members:\n  team: teams\n  principal: principal\n  role: enum('member','admin') default 'admin'\n  unique team, principal\n  read <- allow\n  insert <- allow\n  online only\ntable docs:\n  team: teams\n  read <- exists members[team=.team,principal=viewer,role='admin']\n  online only\ninvariant members.role write only viewer = 'service:operator'\nmutation join(team: teams):\n  return insert members {team,principal:viewer,role:'admin'}\n".into())]);
  assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
  assert!(b.security_literal_defaults.keys().all(|(_,t,c)|t!="members"||c!="role"));
 }
}


#[cfg(test)]mod wave27_scoped_authority_tests{
 use super::*;
 const BASE:&str="table teams:\n  name: text\n  read <- allow\n  online only\ntable members:\n  team: teams\n  principal: principal\n  role: enum('member','admin') default 'admin'\n  unique team, principal\n  read <- allow\n  insert <- allow\n  online only\nmutation join(team: teams):\n  return insert members {team,principal:viewer,role:'admin'}\n";
 #[test]fn unprobed_scoped_role_default_is_a_grant(){
  let b=crate::compile(&[("schema.q".into(),BASE.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
  assert!(b.security_literal_defaults.keys().all(|(_,table,column)|table!="members"||column!="role"));
 }
 #[test]fn mutation_require_only_custom_authority_is_a_grant(){
  let source=BASE.replace("role","power")+"table docs:\n  team: teams\n  title: text\n  read <- allow\n  update <- allow\n  online only\nmutation edit(doc: docs,title: text):\n  d = docs[doc] ! else MISSING\n  require exists members[team=d.team,principal=viewer,power='admin'] else NOT_ADMIN\n  update docs[doc] {title}\n";
  let b=crate::compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
  assert!(b.security_literal_defaults.keys().all(|(_,table,column)|table!="members"||column!="power"));
 }
}
