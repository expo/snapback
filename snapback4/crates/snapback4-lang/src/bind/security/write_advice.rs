//! Creation is a write even when an edit operation has the stronger guard.
// @ref LLP 3000.036.004#151-every-executed-write — conditional advice never infers creation policy.
use super::*;
pub(super) fn notes(sources:&[(String,String)],bound:&Bound)->Vec<Diagnostic>{
    let documents=sources.iter().map(|(file,text)|crate::parse_document(file,text).0).collect::<Vec<_>>();
    let catalog=Catalog::build(documents.clone(),&mut Vec::new());
    let mut writes=Vec::new();
    for doc in &documents{for p in &doc.programs{if p.kind!=ast::ProgramKind::Mutation{continue;}
        for (write,context) in super::authority_walk::writes(&catalog,p){
            let ast::Expr::Write{op,table,fields,site,..}=write else{continue;};
            let Some(info)=catalog.tables.get(&table)else{continue;};
            let requirements=super::operation::requirements(&catalog,info,&context);
            let t=&bound.schema.tables[&table];
            let gate=if op==ast::WriteOp::Update{t.update_rule_judged().into_owned()}else{t.rules.insert.clone()};
            let admission=RuleExpr::And(requirements.into_iter().chain([gate]).collect());
            writes.push((p.name.clone(),op,table,fields,site,admission));
        }
    }}
    fn necessary(rule:&RuleExpr)->RuleExpr{match rule{
        RuleExpr::And(xs)=>RuleExpr::And(xs.iter().map(necessary).collect()),
        _ if super::operation::safe(rule)=>rule.clone(),_=>RuleExpr::Allow,
    }}
    let mut out=Vec::new();let mut seen=BTreeSet::new();
    for (name,op,table,fields,site,admission) in &writes{
        if !matches!(op,ast::WriteOp::Insert|ast::WriteOp::Upsert){continue;}
        for (editor,edit,other,patch,_,restricted) in &writes{
            if *edit!=ast::WriteOp::Update||other!=table{continue;}
            let restriction=necessary(restricted);
            if kernel::implies(&RuleExpr::Allow,&restriction)==Ok(true)||kernel::implies(admission,&restriction)!=Ok(false){continue;}
            let columns=patch.iter().filter(|f|fields.iter().any(|insert|insert.name==f.name)||bound.schema.tables[table].defaults.contains_key(&f.name)).map(|f|f.name.clone()).collect::<BTreeSet<_>>();
            if columns.is_empty()||!seen.insert((name.clone(),table.clone(),columns.clone(),restriction.quarry())){continue;}
            out.push(Diagnostic::new(site,"N_INSERT_WRITE_INTENT",format!("{name}: {table}.{} can be supplied at insert/upsert without the edit restriction of {editor}: {}; creation admission: {}",columns.into_iter().collect::<Vec<_>>().join(","),restriction.quarry(),admission.quarry()),"confirm whether the spec permits different creation authority; otherwise guard every insert/upsert arm too and declare column write only intent, then run snapback4 test").guide("security"));
        }
    }out
}
