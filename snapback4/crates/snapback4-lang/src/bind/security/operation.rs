//! Narrow stable leading-require reduction for operation-specific authority.
// @ref LLP 3000.036.004#81-exact-conservative-boundary-review-clarification — unknown write sets never establish stability.
use super::*;
use crate::ast::{Stmt,ProgramDecl,ProgramKind,InvariantDecl,RuleDecl};
use super::super::catalog::TableInfo;
pub(super) fn resolve<'a>(catalog:&'a Catalog,decl:&InvariantDecl)->Option<(String,&'a ProgramDecl)>{
    if matches!(decl.target.as_str(),"read"|"insert"|"update"|"delete"|"always"|"write"){return None;}
    let matches=catalog.documents.iter().flat_map(|d|{let module=std::path::Path::new(&d.file).file_stem().unwrap().to_string_lossy();d.programs.iter().map(move|p|(super::super::operation_name(&module,&p.name),p))})
        .filter(|(name,p)|p.kind==ProgramKind::Mutation&&(name==&decl.target||p.name==decl.target)).collect::<Vec<_>>();
    if matches.len()==1 {matches.into_iter().next()}else{None}
}
pub(super) fn safe(rule:&RuleExpr)->bool {match rule{
    RuleExpr::Exists{key,equalities,..}=>key.iter().chain(equalities.iter().map(|(_,t)|t)).all(|t|matches!(t,RuleTerm::Viewer|RuleTerm::Literal(_))),
    RuleExpr::And(xs)|RuleExpr::Or(xs)=>xs.iter().all(safe),
    RuleExpr::Eq(a,b)|RuleExpr::Ne(a,b)=>[a,b].iter().all(|t|matches!(t,RuleTerm::Viewer|RuleTerm::Literal(_))),
    RuleExpr::Allow|RuleExpr::Deny|RuleExpr::Public{..}=>true,_=>false,
}}
pub(super) fn requirements(catalog:&Catalog,info:&TableInfo,p:&ProgramDecl)->Vec<RuleExpr>{
    let mut out=Vec::new();
    for s in p.prelude.iter().chain(&p.body){let Stmt::Require{condition,site,..}=s else{break};
        let decl=RuleDecl{effect:ast::Effect::Read,bindings:Vec::new(),value:condition.clone(),site:site.clone()};
        if let Ok(rule)=super::super::schema::bind_rule(catalog,info,&decl)&&safe(&rule){out.push(rule);}
    }out
}
pub(super) fn prove(bound:&Bound,inv:&Invariant)->Result<bool,String>{
    let p=bound.programs.iter().find(|p|Some(&p.program.name)==inv.operation.as_ref()).ok_or("operation did not bind")?;
    if !safe(inv.policy.as_ref().ok_or("unsupported policy")?){return Err("operation policy needs unsupported target-image, negative-probe or live-reference bindings".into());}
    let writes=snapback4_core::ir::write_tables(&p.program);
    if !writes.iter().any(|(t,_)|t==&inv.table){return Err("operation has no direct write to the named table; implicit effects require a reduction".into());}
    let dependencies=inv.requirements.iter().flat_map(kernel::dependencies).collect::<BTreeSet<_>>();
    if writes.iter().any(|(t,_)|dependencies.contains(t)) {return Err("require dependency can be changed by this operation, including its target write".into());}
    if bound.schema.tables.values().any(|t|!t.maintained.is_empty()||!t.sequences.is_empty()||t.on_delete.values().any(|a|a.writes())) || !bound.schema.maintains.is_empty(){return Err("implicit maintain/sequence/referential writes require dependency stability reduction".into());}
    // Source helpers/control flow may hide write sets or viewer changes.
    let json=serde_json::to_value(&p.program).unwrap();
    fn opaque(v:&serde_json::Value)->bool{match v{serde_json::Value::Object(m)=>m.keys().any(|k|matches!(k.as_str(),"For"|"If"|"JobAs"|"JobQuery"|"Emit"))||m.values().any(opaque),serde_json::Value::Array(xs)=>xs.iter().any(opaque),_=>false}}
    if opaque(&json){return Err("operation control flow or opaque effects are outside stable leading-require reduction".into());}
    let admission=RuleExpr::And(inv.requirements.clone());
    // Table-rule gates can only further restrict a dominating stable require;
    // using the require alone overapproximates effective owner-field gates.
    kernel::implies(&admission,inv.policy.as_ref().unwrap())
}
