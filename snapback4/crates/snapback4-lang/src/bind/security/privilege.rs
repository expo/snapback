//! Role authority is compared by effective gates, never by names like 'admin'.
// @ref LLP 3000.036.004#123-actionable-authority-advice — advisory grant-edge analysis, not a security proof or implicit exemption.
use super::*;
pub(super) fn probe_pairs(bound:&Bound,table:&str,index:&str,key:&[RuleTerm],equalities:&[(String,RuleTerm)])->Vec<(String,RuleTerm)>{
    let mut pairs=equalities.to_vec();
    if let Some(idx)=bound.schema.table(table).and_then(|t|t.index(index)){for (component,term) in idx.components.iter().zip(key){if let Some(column)=component.column(){pairs.push((column.into(),term.clone()));}}}
    pairs
}
pub(super) fn global_principal(bound:&Bound,table:&str)->Option<String>{
    let t=bound.schema.table(table)?;
    t.indexes.values().find_map(|index|{
        if !index.unique||index.components.len()!=1{return None;}
        let column=index.components[0].column()?;
        matches!(t.columns.get(column),Some(snapback4_core::schema::ColumnType::Principal)).then(||column.to_string())
    })
}
pub(super) fn membership_probe(bound:&Bound,rule:&RuleExpr,roster:&str)->bool{
    let RuleExpr::Exists{table,index,key,equalities,..}=rule else{return false;};
    if table!=roster{return false;}
    let Some(principal)=global_principal(bound,table)else{return false;};
    let pairs=probe_pairs(bound,table,index,key,equalities);
    pairs.len()==1&&pairs[0].0==principal&&pairs[0].1==RuleTerm::Viewer
}
// @ref LLP 3000.015#1 — ownership is required for every supplied owned field;
// only an exclusively owned patch bypasses an unnamed row update gate.
fn write_admission(table:&snapback4_core::schema::Table,op:ast::WriteOp,fields:&[ast::ObjectField])->RuleExpr{
    let touched=fields.iter().filter(|f|!f.spread&&f.name!="id").map(|f|f.name.as_str()).collect::<BTreeSet<_>>();
    let owned_only=!touched.is_empty()&&!fields.iter().any(|f|f.spread)&&touched.iter().all(|f|table.written_by.contains_key(*f));
    let gate=match op{
        ast::WriteOp::Insert=>table.rules.insert.clone(),
        ast::WriteOp::Update if owned_only&&!table.update_transition=>RuleExpr::Allow,
        ast::WriteOp::Update=>table.update_rule_judged().into_owned(),
        _=>RuleExpr::Deny,
    };
    let mut owners=table.written_by.iter().filter(|(field,authority)|touched.contains(field.as_str())||op==ast::WriteOp::Update&&!authority.audience&&table.rules.update.needs_field_value(field,&table.columns[*field])).map(|(_,authority)|RuleExpr::Eq(if op==ast::WriteOp::Insert{RuleTerm::Field(authority.owner.clone())}else{RuleTerm::OldField(authority.owner.clone())},RuleTerm::Viewer)).collect::<Vec<_>>();
    owners.push(RuleExpr::Or(gate.disjuncts().iter().filter(|r|r.service_grant().is_none()).map(|r|(*r).clone()).collect()));
    RuleExpr::And(owners)
}
pub(super) fn membership_grant_risk(bound:&Bound,roster:&str,operation:&str,requirements:&[RuleExpr],op:ast::WriteOp,fields:&[ast::ObjectField])->bool{
    if op==ast::WriteOp::Upsert{return membership_grant_risk(bound,roster,operation,requirements,ast::WriteOp::Insert,fields)||membership_grant_risk(bound,roster,operation,requirements,ast::WriteOp::Update,fields);}
    fn honors(bound:&Bound,rule:&RuleExpr,roster:&str)->bool{match rule{
        RuleExpr::And(xs)|RuleExpr::Or(xs)=>xs.iter().any(|r|honors(bound,r,roster)),
        r=>membership_probe(bound,r,roster),
    }}
    if global_principal(bound,roster).is_none()||!bound.schema.tables.values().any(|t|[&t.rules.read,&t.rules.insert,&t.rules.update,&t.rules.delete].iter().any(|r|honors(bound,r,roster))){return false;}
    let table=&bound.schema.tables[roster];
    let admission=RuleExpr::And(std::iter::once(write_admission(table,op,fields)).chain(requirements.iter().cloned()).collect());
    if op==ast::WriteOp::Update&&global_principal(bound,roster).is_some_and(|column|kernel::implies(&admission,&RuleExpr::Eq(RuleTerm::OldField(column.clone()),RuleTerm::Field(column)))==Ok(true)){return false;}
    let ordinary=substitute(bound,&admission,"$no-roster","$membership",None,None);
    bound.invariants.iter().filter(|i|i.table==roster&&i.column.is_none()&&(i.operation.as_deref()==Some(operation)||i.operation.is_none()&&(i.target=="write"||i.target==if op==ast::WriteOp::Insert{"insert"}else{"update"}))).filter_map(|i|i.policy.as_ref()).any(|p|super::operation::safe(p)&&kernel::implies(&ordinary,p)==Ok(false))
}
fn substitute(bound:&Bound,rule:&RuleExpr,roster:&str,column:&str,role:Option<&str>,target:Option<&str>)->RuleExpr{
    let known=|t:&RuleTerm|match t{RuleTerm::Field(c)|RuleTerm::NextField(c) if c==column=>target.map(|s|snapback4_core::Value::String(s.into())),RuleTerm::Literal(v)=>Some(v.clone()),_=>None};
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
pub(super) fn risk(bound:&Bound,roster:&str,column:&str,operation:&str,targets:&[String],op:ast::WriteOp,requirements:&[RuleExpr],dynamic:bool,fields:&[ast::ObjectField])->Option<String>{
    if op==ast::WriteOp::Upsert{return risk(bound,roster,column,operation,targets,ast::WriteOp::Insert,requirements,dynamic,fields).or_else(||risk(bound,roster,column,operation,targets,ast::WriteOp::Update,requirements,dynamic,fields));}
    let table=bound.schema.table(roster)?;
    if requirements.iter().any(|r|!r.disjuncts().is_empty()&&r.disjuncts().iter().all(|b|b.service_grant().is_some())){return None;}
    let roles=role_values(bound,roster,column);
    let intents=bound.invariants.iter().filter(|i|i.table==roster&&i.column.as_deref().is_none_or(|c|c==column)&&(i.operation.as_deref()==Some(operation)||i.operation.is_none()&&(i.target=="write"||i.target==if op==ast::WriteOp::Insert{"insert"}else{"update"}))).filter_map(|i|i.policy.as_ref()).collect::<Vec<_>>();
    fn role_guards(bound:&Bound,rule:&RuleExpr,out:&mut Vec<RuleExpr>){match rule{
        RuleExpr::Exists{table,index,key,equalities,..} if key.iter().chain(equalities.iter().map(|(_,v)|v)).any(|k|matches!(k,RuleTerm::Viewer))&&probe_pairs(bound,table,index,key,equalities).iter().any(|(c,v)|role_columns(bound,table).contains(c)&&matches!(v,RuleTerm::Literal(snapback4_core::Value::String(_))))=>out.push(rule.clone()),
        RuleExpr::And(xs)|RuleExpr::Or(xs)=>for r in xs{role_guards(bound,r,out)},_=>{}
    }}
    let admission=RuleExpr::And(std::iter::once(write_admission(table,op,fields)).chain(requirements.iter().cloned()).collect());
    if op==ast::WriteOp::Update&&kernel::implies(&admission,&RuleExpr::Eq(RuleTerm::OldField(column.into()),RuleTerm::Field(column.into())))==Ok(true){return None;}
    let mut guards=Vec::new();role_guards(bound,&admission,&mut guards);
    let independent=kernel::implies(&substitute(bound,&admission,"$no-roster",column,None,None),&RuleExpr::Or(guards))==Ok(true);
    let mut ranked=roles.iter().filter(|r|targets.is_empty()||targets.contains(r)).collect::<Vec<_>>();
    let score=|role:&&String|bound.schema.visible_tables().flat_map(|(_,t)|[&t.rules.read,&t.rules.insert,&t.rules.update,&t.rules.delete]).filter(|rule|kernel::implies(&RuleExpr::Allow,&substitute(bound,rule,roster,column,Some(role.as_str()),None))==Ok(true)).count();
    ranked.sort_by_key(|role|(std::cmp::Reverse(score(role)),role.as_str()));
    for target in ranked{
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

pub(super) fn role_values(bound:&Bound,roster:&str,column:&str)->Vec<String>{
    let Some(table)=bound.schema.table(roster)else{return Vec::new();};
    let Some(kind)=table.columns.get(column)else{return Vec::new();};
    match kind.required(){snapback4_core::schema::ColumnType::Enum{variants}=>variants.clone(),snapback4_core::schema::ColumnType::Text{..}=>{
        let mut roles=BTreeSet::new();
        fn collect(bound:&Bound,rule:&RuleExpr,roster:&str,column:&str,roles:&mut BTreeSet<String>){match rule{
            RuleExpr::Exists{table,index,key,equalities,..} if table==roster=>for (c,t) in &probe_pairs(bound,table,index,key,equalities){if c==column&&let RuleTerm::Literal(snapback4_core::Value::String(s))=t{roles.insert(s.clone());}},
            RuleExpr::And(xs)|RuleExpr::Or(xs)=>for r in xs{collect(bound,r,roster,column,roles)},RuleExpr::Not(r)=>collect(bound,r,roster,column,roles),_=>{}
        }}
        for t in bound.schema.tables.values(){for r in [&t.rules.read,&t.rules.insert,&t.rules.update,&t.rules.delete]{collect(bound,r,roster,column,&mut roles);}}roles.into_iter().collect()
    },_=>Vec::new()}
}
