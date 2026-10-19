//! Deterministic role populations validated by the ordinary seed boundary.
// @ref LLP 3000.036.004#132-generated-initial-worlds-and-password-only-test — generated initialization is explicit.
use super::*;
/// No network, credentials, development doors, durable store or scratch files.
pub fn fixture(bound:&Bound,out:&mut Campaign)->Result<Engine,String>{
    if !out.reserve(1){return Err("generated fixture world not reserved; remaining initialization uncovered".into());}
    let mut people=Vec::new();
    for (table,t) in bound.schema.visible_tables(){
        let mut role_columns=super::super::privilege::role_columns(bound,table);
        role_columns.extend(["role","kind"].into_iter().filter(|c|t.columns.contains_key(*c)).map(str::to_owned));
        for column in role_columns{
            {
                for role in super::super::privilege::role_values(bound,table,&column) {for n in 0..2 {people.push((table.clone(),column.clone(),role.clone(),format!("account:security-{table}-{role}-{n}")));}}
            }
        }
    }
    for seat in histories::viewers(bound).into_iter().filter(|p|p.starts_with("service:")) {for n in 0..2{people.push((String::new(),String::new(),String::new(),format!("account:security-{}-{n}",seat.replace(':',"-"))));}}
    if people.is_empty(){for n in 0..2{people.push((String::new(),String::new(),String::new(),format!("account:security-owner-{n}")));}}
    if people.len()>64{people.truncate(64);out.unsupported.insert("generated roster capped at 64 principals; additional roles remain uncovered".into());}
    let mut grant_tables=BTreeSet::new();
    fn grants(rule:&RuleExpr,out:&mut BTreeSet<String>){match rule{
        RuleExpr::Exists{table,key,equalities,..} if key.iter().chain(equalities.iter().map(|(_,v)|v)).any(|v|matches!(v,RuleTerm::Viewer))=>{out.insert(table.clone());},
        RuleExpr::And(xs)|RuleExpr::Or(xs)=>for r in xs{grants(r,out)},RuleExpr::Not(r)=>grants(r,out),_=>{}
    }}
    for t in bound.schema.tables.values(){grants(&t.rules.read,&mut grant_tables);}
    let counts=bound.schema.visible_tables().filter(|(table,_)|bound.schema.maintain_for(table).is_none()).map(|(table,t)|{
        let own=people.iter().filter(|(roster,_,_,_)|roster==table).count();(table.clone(),if own>0{own}else if grant_tables.contains(table)||t.rules.read.any_term(&|term|matches!(term,RuleTerm::Field(c) if t.columns.get(c).is_some_and(|k|matches!(k.required(),C::Principal)))){people.len().max(1usize<<t.columns.values().filter(|k|matches!(k.required(),C::Principal)).count().min(3))}else{t.columns.values().filter_map(|k|if let C::Enum{variants}=k.required(){Some(variants.len())}else{None}).max().unwrap_or(2).max(1usize<<t.columns.values().filter(|k|matches!(k.required(),C::Principal)).count().min(3)).clamp(2,8)})
    }).collect::<BTreeMap<_,_>>();
    let mut rows=BTreeMap::new();
    for (table,t) in bound.schema.visible_tables(){
        if !counts.contains_key(table){continue;}
        let own=people.iter().filter(|(roster,_,_,_)|roster==table).collect::<Vec<_>>();
        let mut population=Vec::new();
        for n in 0..counts[table]{
            let person=if own.is_empty(){&people[n%people.len()]}else{own[n]};
            let mut fields=BTreeMap::from([("id".into(),Value::Id(format!("security-{table}-{n}")))]);
            let mut principal=0;
            for (column,kind) in &t.columns {
                if column=="id"||t.engine_field(column)||t.recorded.contains_key(column)||t.maintained.contains_key(column){continue;}
                let mut value=if kind.is_optional()&&n%2==0{Value::Null}else{match sample(kind.required(),4+n){Some(value)=>value,None=>{out.unsupported.insert(format!("generated fixture {table}.{column}: unsupported typed sample"));continue;}}};
                if value==Value::Null&&kind.is_optional(){fields.insert(column.clone(),value);continue;}
                match kind.required(){
                    C::Principal=>{
                        let linked=!own.is_empty()||grant_tables.contains(table)||t.constraints.iter().any(|constraint|matches!(constraint,Constraint::FinalExistsOnInsert{key,..} if key.iter().any(|term|matches!(term,RuleTerm::Field(c) if c==column))));
                        value=Value::Id(if linked{if principal==0{person.3.clone()}else{people[(n+principal)%people.len()].3.clone()}}else{if (n>>principal.min(5))&1==0{VIEWER}else{OTHER}.into()});principal+=1;
                    },
                    C::Ref{table:target}=>{value=Value::Id(format!("security-{target}-{}",n%counts.get(target).copied().unwrap_or(1)));},
                    C::Enum{..}|C::Text{..} if person.0==*table&&person.1==*column=>value=Value::String(person.2.clone()),
                    C::Text{max}=>{let minimum=t.constraints.iter().filter_map(|c|if let Constraint::Text{field,min,..}=c{(field==column).then_some(*min as usize)}else{None}).max().unwrap_or(1);let suffix=format!("sample{n}");value=Value::String(format!("{suffix}{}","x".repeat(minimum.saturating_sub(suffix.len()))).chars().take(*max as usize).collect());},
                    C::Time=>value=Value::Int(NOW+if t.expire.as_deref()==Some(column){86_400_000}else{-1000}),
                    _=>{},
                }
                fields.insert(column.clone(),value);
            }
            population.push(Value::Row(fields.into()));
        }
        rows.insert(table.clone(),population);
    }
    // Batch validation preserves final-exists, parent ordering and maintains.
    if let Ok(engine)=engine_with(bound,&rows,Vec::new()){return Ok(engine);}
    if !out.reserve(1){return Err("generated fallback world not reserved; initialization uncovered".into());}
    let mut engine=engine_with(bound,&BTreeMap::new(),Vec::new())?;
    let mut pending=rows.into_iter().flat_map(|(table,rows)|rows.into_iter().map(move|row|(table.clone(),row))).collect::<Vec<_>>();
    let mut reasons=BTreeMap::new();
    for _ in 0..=bound.schema.tables.len(){
        let before=pending.len();let mut retry=Vec::new();
        for (table,mut row) in pending {
            if !out.reserve(1){validate_fixture(bound,&mut engine)?;return Ok(engine);}
            let attempt=(||{
                for (column,kind) in &bound.schema.tables[&table].columns {if let Ok(value)=row.field(column){let value=hydrate(&mut engine,kind,value)?;if let Value::Row(fields)=&mut row{fields.insert(column.clone(),value);}}}
                engine.seed_at([(table.clone(),row.clone())],NOW).map_err(|e|e.to_string())?;Ok::<_,String>(())
            })();
            if let Err(why)=attempt{reasons.insert(table.clone(),why);retry.push((table,row));}
        }
        pending=retry;if pending.len()==before{break;}
    }
    for (table,why) in reasons{if pending.iter().any(|(name,_)|name==&table){out.unsupported.insert(format!("generated fixture {table}: some related rows declined by ordinary validation: {why}"));}}
    validate_fixture(bound,&mut engine)?;
    Ok(engine)
}
