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
            writes.push((p,p.name.clone(),op,table,fields,site,admission));
        }
    }}
    fn necessary(rule:&RuleExpr)->RuleExpr{match rule{
        RuleExpr::And(xs)=>RuleExpr::And(xs.iter().map(necessary).collect()),
        _ if super::operation::safe(rule)=>rule.clone(),_=>RuleExpr::Allow,
    }}
    // Recover only column-specific conditional guards; ordinary table-wide
    // differences keep their existing inventory code and priority.
    let mut specific=BTreeMap::<(String,String,String,String),(bool,Vec<RuleExpr>)>::new();
    for doc in &documents{for p in &doc.programs{if p.kind!=ast::ProgramKind::Mutation{continue;}
        let plain=super::authority_walk::writes(&catalog,p);
        let columns=plain.iter().filter_map(|(e,_)|if let ast::Expr::Write{op:ast::WriteOp::Update,fields,..}=e{Some(fields.iter().map(|f|f.name.clone()).collect::<Vec<_>>())}else{None}).flatten().collect::<BTreeSet<_>>();
        for column in columns{for ((write,context),(_,base)) in super::authority_walk::column_writes(&catalog,p,&column).into_iter().zip(&plain){
            let ast::Expr::Write{op:ast::WriteOp::Update,table,fields,..}=write else{continue;};
            if !fields.iter().any(|f|f.name==column){continue;}
            if plain.iter().filter(|(e,_)|matches!(e,ast::Expr::Write{table:t,..} if t==&table)).count()!=1{continue;}
            let Some(info)=catalog.tables.get(&table)else{continue;};
            let requirements=super::operation::requirements(&catalog,info,&context);
            let restriction=RuleExpr::And(requirements.into_iter().chain([bound.schema.tables[&table].update_rule_judged().into_owned()]).collect());
            let entry=specific.entry((p.site.file.clone(),p.name.clone(),table,column.clone())).or_default();entry.0|=context.body.len()>base.body.len();entry.1.push(necessary(&restriction));
        }}
    }}
    let mut out=Vec::new();
    for (creator,name,op,table,fields,site,admission) in &writes {
        if !matches!(op,ast::WriteOp::Insert|ast::WriteOp::Upsert){continue;}
        for (column,guard) in table_guards(&bound.schema.tables[table].rules.update) {
            let t=&bound.schema.tables[table];
            if t.column_writes.contains_key(&column) || update_only(bound,table,&column,&guard) || !fields.iter().any(|f|f.name==column&&supplied(f,creator)){continue;}
            if kernel::implies(admission,&guard)==Ok(false) {
                out.push(Diagnostic::new(site,"N_CREATE_EDIT_ASYMMETRY",format!("{name}: {table}.{column} is supplied at create/upsert without its table update change guard {}",guard.quarry()),format!("enforce `{column}: <type> write <- {}` or declare deliberate creation asymmetry with `invariant {table}.{column} update only {}`; run test with non-null input",guard.quarry(),guard.quarry())).guide("security"));
            }
        }
    }
    let mut seen=BTreeSet::new();let mut replaced=BTreeSet::new();
    for (creator,name,op,table,fields,site,admission) in &writes{
        if !matches!(op,ast::WriteOp::Insert|ast::WriteOp::Upsert){continue;}
        for ((file,editor,target,column),(conditional,guards)) in &specific{
            if !conditional{continue;}
            if bound.schema.tables[table].column_writes.contains_key(column) || update_only(bound,table,column,&RuleExpr::Or(guards.clone())) {continue;}
            let guard=RuleExpr::Or(guards.clone());
            if target!=table||!fields.iter().any(|f|&f.name==column&&supplied(f,creator)){continue;}
            let guard=necessary(&guard);
            let module=std::path::Path::new(file).file_stem().and_then(|s|s.to_str()).unwrap_or("");
            let operation=super::super::operation_name(module,editor);
            let Some(program)=bound.programs.iter().find(|p|p.program.name==operation)else{continue;};
            let dependencies=kernel::dependencies(&guard);
            if snapback4_core::ir::write_tables(&program.program).iter().any(|(table,_)|dependencies.contains(table)){continue;}
            if kernel::implies(admission,&guard)!=Ok(false)||!seen.insert((creator.site.file.clone(),name.clone(),table.clone(),BTreeSet::from([column.clone()]),guard.quarry())){continue;}
            let audience=bound.schema.tables[table].column_reads.get(column);
            let private=audience.is_some_and(|r|kernel::implies(admission,r)==Ok(false));
            let code=if private{"N_PRIVATE_CREATE_EDIT_ASYMMETRY"}else{"N_CREATE_EDIT_ASYMMETRY"};
            let detail=if private{format!("; write-only private payload: creator admission does not imply column read audience {}",audience.unwrap().quarry())}else{String::new()};
            out.push(Diagnostic::new(site,code,format!("{name}: argument-supplied {table}.{column} is open at create/upsert, but {operation} requires {} when this column changes{detail}",guard.quarry()),"confirm this column's creation authority against the specification; apply its change guard at creation too when required, declare independent column write intent, then run test with a non-null value").guide("security"));
            replaced.insert((creator.site.file.clone(),name.clone(),table.clone(),column.clone()));
        }
    }
    seen.clear();
    for (creator,name,op,table,fields,site,admission) in &writes{
        if !matches!(op,ast::WriteOp::Insert|ast::WriteOp::Upsert){continue;}
        for (_,editor,edit,other,patch,_,restricted) in &writes{
            if *edit!=ast::WriteOp::Update||other!=table{continue;}
            let restriction=necessary(restricted);
            if kernel::implies(&RuleExpr::Allow,&restriction)==Ok(true)||kernel::implies(admission,&restriction)!=Ok(false){continue;}
            let columns=patch.iter().filter(|f|!replaced.contains(&(creator.site.file.clone(),name.clone(),table.clone(),f.name.clone()))&&fields.iter().any(|insert|insert.name==f.name&&supplied(insert,creator))).map(|f|f.name.clone()).collect::<BTreeSet<_>>();
            if columns.is_empty()||!seen.insert((creator.site.file.clone(),name.clone(),table.clone(),columns.clone(),restriction.quarry())){continue;}
            out.push(Diagnostic::new(site,"N_INSERT_WRITE_INTENT",format!("{name}: {table}.{} can be supplied at insert/upsert without the edit restriction of {editor}: {}; creation admission: {}",columns.into_iter().collect::<Vec<_>>().join(","),restriction.quarry(),admission.quarry()),"confirm whether the spec permits different creation authority; otherwise guard every insert/upsert arm too and declare column write only intent, then run snapback4 test").guide("security"));
        }
    }out
}

fn supplied(field:&ast::ObjectField,program:&ast::ProgramDecl)->bool{
    let Some(value)=&field.value else{return true;};let mut value=value.clone();let mut supplied=false;
    super::super::intent_walk::expression(&mut value,&mut |e|if let ast::Expr::Name{name,..}=e{supplied|=program.args.iter().any(|a|a.name==*name);});
    supplied
}

// Exact syntactic changed-column implication; the remainder is the authored policy.
pub(super) fn table_guards(rule:&RuleExpr)->BTreeMap<String,RuleExpr>{
    fn same(rule:&RuleExpr)->Option<String>{
        let RuleExpr::Eq(a,b)=rule else{return None;};
        [(a,b),(b,a)].iter().find_map(|(a,b)|if let RuleTerm::OldField(c)=a {
            matches!(b,RuleTerm::NextField(d)|RuleTerm::Field(d) if d==c).then(||c.clone())
        }else{None})
    }
    let mut out=BTreeMap::new();
    match rule {
        RuleExpr::And(xs)=>for r in xs {out.extend(table_guards(r));},
        RuleExpr::Or(xs)=>for (n,r) in xs.iter().enumerate(){if let Some(column)=same(r){
            let policy=RuleExpr::Or(xs.iter().enumerate().filter(|(i,_)|*i!=n).map(|(_,r)|r.clone()).collect());
            if super::operation::safe(&policy){out.insert(column,policy);}
        }},_=>{}
    }
    out
}
pub(super) fn update_only(bound:&Bound,table:&str,column:&str,guard:&RuleExpr)->bool{
    bound.invariants.iter().any(|i|i.table==table&&i.column.as_deref()==Some(column)&&i.target=="update"&&i.policy.as_ref().is_some_and(|p|kernel::implies(p,guard)==Ok(true)&&kernel::implies(guard,p)==Ok(true)))
}
