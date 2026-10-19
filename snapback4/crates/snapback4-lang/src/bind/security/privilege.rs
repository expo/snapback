//! Role authority is compared by effective gates, never by names like 'admin'.
// @ref LLP 3000.036.004#123-actionable-authority-advice — advisory grant-edge analysis, not a security proof or implicit exemption.
use super::*;
pub(super) fn probe_pairs(bound:&Bound,table:&str,index:&str,key:&[RuleTerm],equalities:&[(String,RuleTerm)])->Vec<(String,RuleTerm)>{
    let mut pairs=equalities.to_vec();
    if let Some(idx)=bound.schema.table(table).and_then(|t|t.index(index)){for (component,term) in idx.components.iter().zip(key){if let Some(column)=component.column(){pairs.push((column.into(),term.clone()));}}}
    pairs
}
fn substitute(bound:&Bound,rule:&RuleExpr,roster:&str,column:&str,role:Option<&str>,target:Option<&str>)->RuleExpr{
    let known=|t:&RuleTerm|match t{RuleTerm::Field(c) if c==column=>target.map(|s|snapback4_core::Value::String(s.into())),RuleTerm::Literal(v)=>Some(v.clone()),_=>None};
    match rule{
        RuleExpr::Exists{table,key,index,equalities,..} if table==roster&&key.iter().chain(equalities.iter().map(|(_,t)|t)).any(|k|matches!(k,RuleTerm::Viewer))=>{
            let pairs=probe_pairs(bound,table,index,key,equalities);
            let requested=pairs.iter().find(|(c,_)|c==column).and_then(|(_,t)|if let RuleTerm::Literal(snapback4_core::Value::String(s))=t{Some(s.as_str())}else{None});
            if requested.is_none(){rule.clone()}else if requested==role{
                if pairs.iter().all(|(c,t)|c==column||matches!(t,RuleTerm::Viewer)){RuleExpr::Allow}else{rule.clone()}
            }else{RuleExpr::Deny}
        },
        RuleExpr::Eq(RuleTerm::Viewer,RuleTerm::Literal(snapback4_core::Value::Id(seat)))|RuleExpr::Eq(RuleTerm::Literal(snapback4_core::Value::Id(seat)),RuleTerm::Viewer) if seat.starts_with("service:")=>RuleExpr::Deny,
        RuleExpr::Eq(a,b)|RuleExpr::Ne(a,b)=>if let (Some(a),Some(b))=(known(a),known(b)){if (a==b)==matches!(rule,RuleExpr::Eq(..)){RuleExpr::Allow}else{RuleExpr::Deny}}else{rule.clone()},
        RuleExpr::And(xs)=>RuleExpr::And(xs.iter().map(|r|substitute(bound,r,roster,column,role,target)).collect()),
        RuleExpr::Or(xs)=>RuleExpr::Or(xs.iter().map(|r|substitute(bound,r,roster,column,role,target)).collect()),
        RuleExpr::Not(r)=>RuleExpr::Not(Box::new(substitute(bound,r,roster,column,role,target))),
        _=>rule.clone(),
    }
}
pub(super) fn risk(bound:&Bound,roster:&str,column:&str,operation:&str,targets:&[String],op:ast::WriteOp,requirements:&[RuleExpr],dynamic:bool)->Option<String>{
    if op==ast::WriteOp::Upsert{return risk(bound,roster,column,operation,targets,ast::WriteOp::Insert,requirements,dynamic).or_else(||risk(bound,roster,column,operation,targets,ast::WriteOp::Update,requirements,dynamic));}
    let table=bound.schema.table(roster)?;
    if requirements.iter().any(|r|!r.disjuncts().is_empty()&&r.disjuncts().iter().all(|b|b.service_grant().is_some())){return None;}
    let gates=match op{ast::WriteOp::Insert=>vec![&table.rules.insert],ast::WriteOp::Update=>vec![&table.rules.update],ast::WriteOp::Upsert=>vec![&table.rules.insert,&table.rules.update],ast::WriteOp::Delete=>return None};
    let roles=match table.columns.get(column)?.required(){snapback4_core::schema::ColumnType::Enum{variants}=>variants.clone(),snapback4_core::schema::ColumnType::Text{..}=>{
        let mut roles=BTreeSet::new();
        fn collect(bound:&Bound,rule:&RuleExpr,roster:&str,column:&str,roles:&mut BTreeSet<String>){match rule{
            RuleExpr::Exists{table,index,key,equalities,..} if table==roster=>for (c,t) in &probe_pairs(bound,table,index,key,equalities){if c==column&&let RuleTerm::Literal(snapback4_core::Value::String(s))=t{roles.insert(s.clone());}},
            RuleExpr::And(xs)|RuleExpr::Or(xs)=>for r in xs{collect(bound,r,roster,column,roles)},RuleExpr::Not(r)=>collect(bound,r,roster,column,roles),_=>{}
        }}
        for t in bound.schema.tables.values(){for r in [&t.rules.read,&t.rules.insert,&t.rules.update,&t.rules.delete]{collect(bound,r,roster,column,&mut roles);}}roles.into_iter().collect()
    },_=>return None};
    let intents=bound.invariants.iter().filter(|i|i.table==roster&&i.column.as_deref().is_none_or(|c|c==column)&&(i.operation.as_deref()==Some(operation)||i.operation.is_none()&&(i.target=="write"||i.target==if op==ast::WriteOp::Insert{"insert"}else{"update"}))).filter_map(|i|i.policy.as_ref()).collect::<Vec<_>>();
    fn role_guards(bound:&Bound,rule:&RuleExpr,roster:&str,column:&str,out:&mut Vec<RuleExpr>){match rule{
        RuleExpr::Exists{table,index,key,equalities,..} if key.iter().chain(equalities.iter().map(|(_,v)|v)).any(|k|matches!(k,RuleTerm::Viewer))&&table==roster&&probe_pairs(bound,table,index,key,equalities).iter().any(|(c,v)|c==column&&matches!(v,RuleTerm::Literal(snapback4_core::Value::String(_))))=>out.push(rule.clone()),
        RuleExpr::And(xs)|RuleExpr::Or(xs)=>for r in xs{role_guards(bound,r,roster,column,out)},_=>{}
    }}
    let mut all_branches=gates.iter().flat_map(|r|r.disjuncts()).filter(|b|b.service_grant().is_none()).cloned().collect::<Vec<_>>();
    if op!=ast::WriteOp::Insert&&let Some(owner)=table.written_by.get(column){all_branches.push(RuleExpr::Eq(RuleTerm::Field(owner.owner.clone()),RuleTerm::Viewer));}
    let admission=RuleExpr::And(std::iter::once(RuleExpr::Or(all_branches)).chain(requirements.iter().cloned()).collect());
    let mut guards=Vec::new();role_guards(bound,&admission,roster,column,&mut guards);
    let independent=kernel::implies(&substitute(bound,&admission,"$no-roster",column,None,None),&RuleExpr::Or(guards))==Ok(true);
    for target in roles.iter().filter(|r|targets.is_empty()||targets.contains(r)){
        for caller in std::iter::once(None).chain(roles.iter().map(|s|Some(s.as_str()))){
            if caller==Some(target.as_str()){continue;}
            let admitted=substitute(bound,&admission,roster,column,caller,Some(target));
            let admits=kernel::implies(&admitted,&RuleExpr::Deny)!=Ok(true);
            if !admits{continue;}
            let violates_intent=intents.iter().any(|p|kernel::implies(&admitted,&substitute(bound,p,roster,column,caller,Some(target)))==Ok(false));
            // Existing independently gated appointers may delegate different
            // roles. Independent intent can restrict a particular target role.
            if independent&&!violates_intent{continue;}
            if violates_intent{return Some(format!("{roster}.{column} assignment to '{target}' is not established by the independent delegation intent for {}",caller.unwrap_or("a caller without a role")));}
            for (name,t) in bound.schema.visible_tables(){for (effect,rule) in [("read",&t.rules.read),("insert",&t.rules.insert),("update",&t.rules.update),("delete",&t.rules.delete)]{
                let granted=substitute(bound,rule,roster,column,Some(target),None);let previous=substitute(bound,rule,roster,column,caller,None);
                if kernel::implies(&RuleExpr::Allow,&granted)!=Ok(true){continue;}
                if !dynamic&&!(matches!(effect,"read"|"delete")||!role_columns(bound,name).is_empty()){continue;}
                if kernel::implies(&granted,&previous)==Ok(false){return Some(format!("{} can confer '{target}', which adds {name}.{effect} authority not held by {}",roster,caller.unwrap_or("a caller without a role")));}
            }}
        }
    }None
}

pub(super) fn role_columns(bound:&Bound,table:&str)->BTreeSet<String>{
    let mut columns=BTreeSet::new();
    if let Some(t)=bound.schema.table(table){for c in ["role","kind"]{if t.columns.contains_key(c){columns.insert(c.into());}}}
    fn collect(bound:&Bound,rule:&RuleExpr,table:&str,columns:&mut BTreeSet<String>){match rule{
        RuleExpr::Exists{table:t,index,key,equalities,..} if t==table&&key.iter().chain(equalities.iter().map(|(_,v)|v)).any(|k|matches!(k,RuleTerm::Viewer))=>for (c,v) in &probe_pairs(bound,t,index,key,equalities){if matches!(v,RuleTerm::Literal(snapback4_core::Value::String(_))){columns.insert(c.clone());}},
        RuleExpr::And(xs)|RuleExpr::Or(xs)=>for r in xs{collect(bound,r,table,columns)},RuleExpr::Not(r)=>collect(bound,r,table,columns),_=>{}
    }}
    let named=columns.clone();let mut observed=BTreeSet::new();
    for t in bound.schema.tables.values(){for r in [&t.rules.read,&t.rules.insert,&t.rules.update,&t.rules.delete]{collect(bound,r,table,&mut observed);}}
    let global=bound.schema.table(table).is_some_and(|t|t.indexes.values().any(|index|{
        if !index.unique{return false;}
        let Some(parts)=index.components.iter().map(|p|p.column()).collect::<Option<Vec<_>>>()else{return false;};
        let principals=parts.iter().filter(|c|matches!(t.columns.get(**c).map(|k|k.required()),Some(snapback4_core::schema::ColumnType::Principal))).count();
        if principals!=1{return false;}
        parts.iter().all(|c|matches!(t.columns.get(*c).map(|k|k.required()),Some(snapback4_core::schema::ColumnType::Principal))||named.contains(*c))
            ||named.is_empty()&&observed.len()==1&&parts.len()==2&&parts.iter().all(|c|observed.contains(*c)||matches!(t.columns.get(*c).map(|k|k.required()),Some(snapback4_core::schema::ColumnType::Principal)))
    }));
    if global{for t in bound.schema.tables.values(){for r in [&t.rules.read,&t.rules.insert,&t.rules.update,&t.rules.delete]{collect(bound,r,table,&mut columns);}}}else{columns.clear();}
    columns
}
