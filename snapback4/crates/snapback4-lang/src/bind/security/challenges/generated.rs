//! Deterministic role populations validated by the ordinary seed boundary.
// @ref LLP 3000.036.004#132-generated-initial-worlds-and-password-only-test — generated initialization is explicit.
use super::*;
/// No network, credentials, development doors, durable store or scratch files.
fn proposals(bound:&Bound,out:&mut Campaign)->Result<Engine,String>{
    if !out.reserve(1){return Err("generated fixture world not reserved; remaining initialization uncovered".into());}
    let mut people=Vec::new();
    for (table,_) in bound.schema.visible_tables(){
        let role_columns=super::super::privilege::role_columns(bound,table).into_iter().filter(|c|c=="role"||super::super::privilege::global_principal(bound,table).is_some()).collect::<BTreeSet<_>>();
        for column in role_columns{
            {
                for role in super::super::privilege::role_values(bound,table,&column) {for n in 0..2 {people.push((table.clone(),column.clone(),role.clone(),format!("account:security-{table}-{role}-{n}")));}}
            }
        }
    }
    for seat in histories::viewers(bound).into_iter().filter(|p|p.starts_with("service:")&&p!="service:security") {for n in 0..2{people.push((String::new(),String::new(),String::new(),format!("account:security-{}-{n}",seat.replace(':',"-"))));}}
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
        if t.columns.values().filter(|k|matches!(k.required(),C::Principal)).count()>3 {out.unsupported.insert(format!("generated fixture {table}: full Cartesian combinations above three principal columns remain uncovered"));}
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

// @ref LLP 3000.036.004#137-wave-19-correction-admissible-starts-and-persistent-refutations — creator guards/copies are part of generated initialization.
pub fn fixture(bound:&Bound,out:&mut Campaign)->Result<Engine,String>{
    let proposed=proposals(bound,out)?;
    let rows=readback(&proposed)?;
    let actors=histories::actors(bound,&rows);
    let rosters=bound.schema.visible_tables().filter(|(name,t)|t.columns.contains_key("role")||super::super::privilege::global_principal(bound,name).is_some()&&!super::super::privilege::role_columns(bound,name).is_empty()).map(|(name,_)|name.clone()).collect::<BTreeSet<_>>();
    let creators=bound.programs.iter().filter(|p|p.program.kind==ProgramKind::Mutation&&!p.program.native&&ir::write_tables(&p.program).iter().any(|(_,kind)|matches!(*kind,"insert"|"upsert"))).collect::<Vec<_>>();
    let created=creators.iter().flat_map(|p|ir::write_tables(&p.program)).filter(|(_,kind)|matches!(*kind,"insert"|"upsert")).map(|(t,_)|t).collect::<BTreeSet<_>>();
    let mut engine=engine_on_store(bound,&BTreeMap::new(),Vec::new(),proposed.store().empty_with_asset_ledger().map_err(|e|e.to_string())?)?;
    let mut pending=rows.iter().filter(|(t,_)|rosters.contains(*t)||!created.contains(*t)).flat_map(|(t,rs)|rs.iter().map(move|r|(t.clone(),r.clone()))).collect::<Vec<_>>();
    // Bootstrap proposals require an actor admitted by the insert rule in the
    // previous world. Never let a proposed role authorize its own insertion.
    for _ in 0..=bound.schema.tables.len(){
        let before=pending.len();let mut retry=Vec::new();
        for (table,row) in pending{
            if !out.reserve(1){out.unsupported.insert("generated initialization work exhausted; remaining populations uncovered".into());validate_fixture(bound,&mut engine)?;return Ok(engine);}
            let gate=&bound.schema.tables[&table].rules.insert;
            if !actors.iter().any(|actor|matches!(engine.fixture_policy(gate,actor,None,&row,NOW),Ok(rules::Verdict::Readable))) {retry.push((table,row));continue;}
            let mut candidate=engine.fork_fixture().map_err(|e|e.to_string())?;
            let seeded=clean_row(bound,&table,&row);
            if candidate.seed_at([(table.clone(),seeded)],NOW).is_ok(){engine=candidate;}else{retry.push((table,row));}
        }
        pending=retry;if pending.len()==before{break;}
    }
    for (table,_) in pending{out.unsupported.insert(format!("generated fixture {table}: no admitted insert/bootstrap; population uncovered"));}
    // Authored insertion bodies preserve requires, immutable copies, defaults,
    // role checks on principal arguments and multi-table creation invariants.
    let mut attempts=0usize;
    for _ in 0..=bound.schema.tables.len().min(12){
        let before=readback(&engine)?;
        for bp in &creators{
            let p=&bp.program;let writes=ir::write_tables(p);
            if writes.iter().all(|(t,_)|rosters.contains(t)){continue;}
            let current=readback(&engine)?;
            let targets=writes.iter().filter(|(_,kind)|matches!(*kind,"insert"|"upsert")).map(|(t,_)|t).collect::<Vec<_>>();
            if targets.iter().all(|t|current.get(*t).map_or(0,Vec::len)>=2){continue;}
            let cases=histories::fixture_cases(p,&current,&actors,out);
            'cases:for args in cases.into_iter().take(16){for actor in &actors{
                if attempts>=2048||!out.reserve(1){out.unsupported.insert("generated authored initialization capped at 2048 calls; remaining creators uncovered".into());validate_fixture(bound,&mut engine)?;return Ok(engine);}
                attempts+=1;
                let mut candidate=engine.fork_fixture().map_err(|e|e.to_string())?;
                let args=match materialize_arguments(&mut candidate,&p.args,&args,actor){Ok(a)=>a,Err(_)=>continue};
                let result=candidate.mutate(&p.name,None,Context::new(actor,args).at(NOW));
                if matches!(result,Ok(r) if matches!(r.state,snapback4_core::WriteState::Sent{..})) {
                    let after=readback(&candidate)?;
                    if targets.iter().any(|t|after.get(*t).map_or(0,Vec::len)>current.get(*t).map_or(0,Vec::len)) {engine=candidate;}
                    let after=readback(&engine)?;
                    if targets.iter().all(|t|after.get(*t).map_or(0,Vec::len)>=2){break 'cases;}
                }
            }}
        }
        if readback(&engine)?==before{break;}
    }
    for table in created.difference(&rosters){if engine.store().rows(table).map_err(|e|e.to_string())?.is_empty(){out.unsupported.insert(format!("generated fixture {table}: authored creator did not populate this table"));}}
    validate_fixture(bound,&mut engine)?;Ok(engine)
}
fn clean_row(bound:&Bound,table:&str,row:&Value)->Value{
    let t=&bound.schema.tables[table];
    match row{Value::Row(fields)=>Value::Row(fields.iter().filter(|(c,_)|!t.engine_field(c)&&!t.recorded.contains_key(*c)&&!t.maintained.contains_key(*c)).map(|(c,v)|(c.clone(),v.clone())).collect()),_=>row.clone()}
}
