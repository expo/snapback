//! Source operation reads differ from physical policy probes.
// @ref LLP 3000.036.004.002#s2-release-narrowing — unknown predecessor admission never establishes narrowing.
use super::*;
fn simplify(rule:RuleExpr)->RuleExpr{match rule{
 RuleExpr::Eq(a,b) if a==b&&matches!(a,RuleTerm::Viewer|RuleTerm::Literal(_))=>RuleExpr::Allow,
 RuleExpr::Ne(a,b) if a==b&&matches!(a,RuleTerm::Viewer|RuleTerm::Literal(_))=>RuleExpr::Deny,
 RuleExpr::Eq(RuleTerm::Literal(a),RuleTerm::Literal(b))=>if a==b{RuleExpr::Allow}else{RuleExpr::Deny},
 RuleExpr::Ne(RuleTerm::Literal(a),RuleTerm::Literal(b))=>if a!=b{RuleExpr::Allow}else{RuleExpr::Deny},
 RuleExpr::And(parts)=>{let parts=parts.into_iter().map(simplify).collect::<Vec<_>>();if parts.contains(&RuleExpr::Deny){RuleExpr::Deny}else{RuleExpr::And(parts.into_iter().filter(|p|*p!=RuleExpr::Allow).collect())}},
 RuleExpr::Or(parts)=>{let parts=parts.into_iter().map(simplify).collect::<Vec<_>>();if parts.contains(&RuleExpr::Allow){RuleExpr::Allow}else{RuleExpr::Or(parts.into_iter().filter(|p|*p!=RuleExpr::Deny).collect())}},
 RuleExpr::Not(inner)=>match simplify(*inner){RuleExpr::Allow=>RuleExpr::Deny,RuleExpr::Deny=>RuleExpr::Allow,other=>RuleExpr::Not(Box::new(other))},other=>other,
}}
/// The snapshot's physical existence is equivalent to an operation read only
/// when its pinned row is provably readable. Private/temporal/derived probes
/// stay unknown, rather than silently dropping their admission requirements.
pub(super) fn public_probes(bound:&Bound,rule:&RuleExpr)->bool{match rule{
 RuleExpr::And(parts)|RuleExpr::Or(parts)=>parts.iter().all(|p|public_probes(bound,p)),RuleExpr::Not(inner)=>public_probes(bound,inner),
 RuleExpr::Exists{table,index,key,equalities,..}=>{
  let Some(t)=bound.schema.table(table)else{return false;};
  if t.through.is_some()||t.expire.is_some()||t.not_before.is_some()||!t.column_reads.is_empty()||!t.written_by.is_empty()||bound.schema.maintain_for(table).is_some(){return false;}
  let pairs=super::privilege::probe_pairs(bound,table,index,key,equalities);
  fn substitute(rule:&RuleExpr,pairs:&[(String,RuleTerm)])->RuleExpr{
   let term=|term:&RuleTerm|if let RuleTerm::Field(column)=term{pairs.iter().find(|(name,_)|name==column).map(|(_,value)|value.clone()).unwrap_or_else(||term.clone())}else{term.clone()};
   match rule{
    RuleExpr::Eq(a,b)=>RuleExpr::Eq(term(a),term(b)),RuleExpr::Ne(a,b)=>RuleExpr::Ne(term(a),term(b)),RuleExpr::Compare(op,a,b)=>RuleExpr::Compare(*op,term(a),term(b)),
    RuleExpr::And(parts)=>RuleExpr::And(parts.iter().map(|p|substitute(p,pairs)).collect()),RuleExpr::Or(parts)=>RuleExpr::Or(parts.iter().map(|p|substitute(p,pairs)).collect()),RuleExpr::Not(inner)=>RuleExpr::Not(Box::new(substitute(inner,pairs))),
    RuleExpr::Exists{table,index,key,equalities,provenance}=>RuleExpr::Exists{table:table.clone(),index:index.clone(),key:key.iter().map(term).collect(),equalities:equalities.iter().map(|(name,value)|(name.clone(),term(value))).collect(),provenance:*provenance},other=>other.clone(),
   }
  }
  kernel::implies(&RuleExpr::Allow,&simplify(substitute(&t.rules.read,&pairs)))==Ok(true)
 },_=>true,
}}
/// Required reads and helper assertions are admission, including before writes.
/// Their source identity is retained for creator equivalence; prior setters
/// carrying them remain outside the exact leading-require fragment.
pub(super) fn opaque_inputs(decl:&ast::ProgramDecl,program:&snapback4_core::ir::Program)->Vec<String>{
 let mut statements=decl.prelude.iter().chain(&decl.body).cloned().collect::<Vec<_>>();let mut assertions=0;let mut out=Vec::new();
 fn names(e:&ast::Expr,out:&mut BTreeSet<String>){let mut e=e.clone();crate::bind::intent_walk::expression(&mut e,&mut |e|if let ast::Expr::Name{name,..}=e{out.insert(name.clone());});}
 fn admission(body:&[ast::Stmt],out:&mut BTreeSet<String>){for stmt in body{match stmt{
  ast::Stmt::Require{condition,..}=>names(condition,out),ast::Stmt::Bind{value,..}=>names(value,out),
  ast::Stmt::If{condition,then_body,else_body,..}=>{names(condition,out);admission(then_body,out);admission(else_body,out);},
  ast::Stmt::For{domain,body,..}=>{names(domain,out);admission(body,out);},ast::Stmt::As{principal,body,..}=>{names(principal,out);admission(body,out);},_=>{}
 }}}
 let mut inputs=BTreeSet::new();admission(&statements,&mut inputs);

 crate::bind::intent_walk::statements(&mut statements,&mut |e|if matches!(e,ast::Expr::Assert{..}){
  assertions+=1;names(e,&mut inputs);let mut e=e.clone();crate::bind::intent_walk::expression(&mut e,&mut |e|if let ast::Expr::Name{name,..}=e&&let Some(index)=decl.args.iter().position(|arg|arg.name==*name){*name=format!("$argument{index}");});out.push(format!("required operation input: {}",crate::print::expression(&e)));
 });
 for (index,arg) in decl.args.iter().enumerate(){if inputs.contains(&arg.name){out.push(format!("required argument {index}: {:?}",program.args.get(&arg.name)));}}
 fn binds(body:&[ast::Stmt])->bool{body.iter().any(|s|match s{ast::Stmt::Bind{..}=>true,ast::Stmt::If{then_body,else_body,..}=>binds(then_body)||binds(else_body),ast::Stmt::For{body,..}|ast::Stmt::As{body,..}=>binds(body),_=>false})}
 fn count(body:&[ast::Stmt])->usize{body.iter().map(|s|match s{ast::Stmt::Require{..}=>1,ast::Stmt::If{then_body,else_body,..}=>count(then_body)+count(else_body),ast::Stmt::For{body,..}|ast::Stmt::As{body,..}=>count(body),_=>0}).sum()}
 fn requires(value:&serde_json::Value)->usize{match value{serde_json::Value::Object(fields)=>usize::from(fields.contains_key("Require"))+fields.values().map(requires).sum::<usize>(),serde_json::Value::Array(values)=>values.iter().map(requires).sum(),_=>0}}
 let mut body=serde_json::to_value(&program.body).unwrap();
 if assertions>0||binds(&statements)||requires(&body)>count(&statements)+assertions{
  fn strip(value:&mut serde_json::Value){match value{serde_json::Value::Object(fields)=>{if fields.contains_key("Literal"){return;}if let Some(require)=fields.get_mut("Require").and_then(|v|v.as_object_mut()){for key in ["site","code","message"]{require.remove(key);}}for value in fields.values_mut(){strip(value)}},serde_json::Value::Array(values)=>for value in values{strip(value)},_=>{}}}
  strip(&mut body);out.push(format!("unmodeled required operation input: {body}"));
 }out
}

pub(super) fn opaque_program(program:&snapback4_core::ir::Program)->bool{
 fn opaque(value:&serde_json::Value)->bool{
  if let Some(function)=value.get("Builtin").and_then(|v|v.get("builtin"))&& (function.as_str()==Some("JobAs")||function.get("JobQuery").is_some()){return true;}
  match value{serde_json::Value::Object(fields)=>fields.values().any(opaque),serde_json::Value::Array(values)=>values.iter().any(opaque),_=>false}
 }
 program.native||opaque(&serde_json::to_value(&program.body).unwrap())
}
/// Creation continuity includes every companion payload, not merely guards.
/// Optionality may differ only for a direct, exclusively reviewed-field input:
/// the witnessed non-null write still belongs to both validation contracts.
pub(super) fn body_identity(decl:&ast::ProgramDecl,program:&snapback4_core::ir::Program,column:&str)->String{
 fn occurrences(value:&serde_json::Value,name:&str)->usize{match value{serde_json::Value::Object(fields)if fields.contains_key("Literal")=>0,serde_json::Value::Object(fields)=>usize::from(fields.get("Variable").and_then(|v|v.as_str())==Some(name))+fields.values().map(|v|occurrences(v,name)).sum::<usize>(),serde_json::Value::Array(values)=>values.iter().map(|v|occurrences(v,name)).sum(),_=>0}}
 fn constant<'a>(value:&'a serde_json::Value,name:&str)->Option<&'a serde_json::Value>{
  if value.get("Literal").is_some(){return None;}
  if let Some(v)=value.get("Const").filter(|v|v.get("name").and_then(|v|v.as_str())==Some(name)){return v.get("value");}
  match value{serde_json::Value::Object(fields)=>fields.values().find_map(|v|constant(v,name)),serde_json::Value::Array(values)=>values.iter().find_map(|v|constant(v,name)),_=>None}
 }
 fn field_input(value:&serde_json::Value,body:&serde_json::Value,column:&str,name:&str)->bool{
  if value.get("Literal").is_some(){return false;}
  let direct=|row:&serde_json::Value|{let row=row.get("Variable").and_then(|v|v.as_str()).and_then(|var|constant(body,var)).unwrap_or(row);row.get("Object").and_then(|v|v.get(column)).and_then(|v|v.get("Variable")).and_then(|v|v.as_str())==Some(name)};
  ["Insert","InsertIfAbsent","Upsert"].iter().any(|tag|value.get(tag).and_then(|v|v.get("row")).is_some_and(direct))||value.get("WriteTarget").filter(|v|v.get("upsert").and_then(|v|v.as_bool())==Some(true)).and_then(|v|v.get("patch")).is_some_and(direct)||match value{serde_json::Value::Object(fields)=>fields.values().any(|v|field_input(v,body,column,name)),serde_json::Value::Array(values)=>values.iter().any(|v|field_input(v,body,column,name)),_=>false}
 }
 fn normalize(value:&mut serde_json::Value,args:&[ast::ArgDecl]){match value{
  serde_json::Value::Object(fields)=>{if fields.contains_key("Literal"){return;}if let Some(require)=fields.get_mut("Require").and_then(|v|v.as_object_mut()){for key in ["site","code","message"]{require.remove(key);}}if let Some(v)=fields.get_mut("Variable")&&let Some(index)=v.as_str().and_then(|n|args.iter().position(|a|a.name==n)){*v=format!("$argument{index}").into();}for value in fields.values_mut(){normalize(value,args);}},
  serde_json::Value::Array(values)=>for value in values{normalize(value,args)},_=>{}
 }}
 let mut body=serde_json::to_value(&program.body).unwrap();
 let args=decl.args.iter().map(|arg|{let mut kind=program.args[&arg.name].clone();if occurrences(&body,&arg.name)==1&&field_input(&body,&body,column,&arg.name){if let snapback4_core::ir::ArgType::Optional(inner)=kind{kind=*inner;}}kind}).collect::<Vec<_>>();
 normalize(&mut body,&decl.args);serde_json::json!({"body":body,"args":args}).to_string()
}
