//! Column worlds execute authored observers, including derived/count/refusal paths.
// @ref LLP 3000.036.004#121-column-read-intent — excluding a field from a projection must not produce a synthetic whole-row refutation.
use super::*;
fn reserve(out:&mut Campaign,cost:usize)->bool{
    if out.column_observer_calls+cost>16384{out.unsupported.insert("column observers capped at 16384 call/world reservations; remaining value worlds not covered".into());return false;}
    out.column_observer_calls+=cost;true
}
fn discharged(bound:&Bound,inv:&Invariant)->bool{
    inv.policy.as_ref().is_some_and(|p|kernel::implies(&super::super::columns::admission(&bound.schema.tables[&inv.table],inv.column.as_deref()),p)==Ok(true))
        &&!bound.schema.maintains.iter().any(|m|m.source==inv.table)
        &&!bound.schema.tables.values().any(|t|[&t.rules.read,&t.rules.insert,&t.rules.update,&t.rules.delete].iter().any(|r|kernel::dependencies(r).contains(&inv.table)))
        &&!bound.programs.iter().any(|p|ir::write_tables(&p.program).iter().any(|(t,_)|t!=&inv.table)&&super::super::audit::mentions(&serde_json::to_value(&p.program).unwrap(),&inv.table))
}
fn alternative(kind:&C,old:&Value)->Option<Value>{Some(match (kind.required(),old){
    (C::Text{max},Value::String(s)) if s.is_empty()=>if *max>0{Value::String("x".into())}else{return None},
    (C::Text{..},Value::String(s))=>Value::String(s.chars().map(|c|if c=='y'{'x'}else{'y'}).collect()),
    (C::Enum{variants},_)=>Value::String(variants.iter().find(|s|Value::String((*s).clone())!=*old)?.clone()),
    (C::Principal,Value::Id(s))=>Value::Id(if s==VIEWER{OTHER}else{VIEWER}.into()),
    (C::Int|C::Time,Value::Int(n))=>Value::Int(n.checked_add(1)?),
    (C::IntRange{min,max},Value::Int(n))=>Value::Int(if n<max{n+1}else if n>min{n-1}else{return None}),
    (C::Bool,Value::Bool(v))=>Value::Bool(!v),
    _=>return None,
})}
fn sample_rows(bound:&Bound,rows:&BTreeMap<String,Vec<Value>>,inv:&Invariant,row:&Value,presence:bool)->Option<BTreeMap<String,Vec<Value>>>{
    let column=inv.column.as_ref()?;let kind=bound.schema.tables[&inv.table].columns.get(column)?;
    let old=match row.field(column){
        Ok(value)=>value.clone(),
        Err(_) if kind.is_optional()&&bound.schema.tables[&inv.table].defaults.get(column).is_none_or(|d|matches!(d,snapback4_core::schema::ColumnDefault::Literal(Value::Null)))=>Value::Null,
        Err(_)=>return None,
    };
    let alt=if presence&&kind.is_optional(){if old==Value::Null{sample(kind.required(),0)?}else{Value::Null}}else{alternative(kind,&old)?};
    let mut out=rows.clone();
    let selected=out.get_mut(&inv.table)?.iter_mut().find(|r|r.field("id").ok()==row.field("id").ok())?;
    if let Value::Row(fields)=selected{fields.insert(column.clone(),alt);}else{return None;}
    Some(out)
}
fn same_base_world(bound:&Bound,inv:&Invariant,primary:&BTreeMap<String,Vec<Value>>,alternate:&BTreeMap<String,Vec<Value>>,key:&Value)->bool{
    bound.schema.tables.iter().filter(|(table,_)|bound.schema.maintain_for(table).is_none()).all(|(table,definition)|{
        let empty=Vec::new();let rows=primary.get(table).unwrap_or(&empty);let other=alternate.get(table).unwrap_or(&empty);
        rows.len()==other.len()&&rows.iter().all(|old|other.iter().find(|r|r.field("id").ok()==old.field("id").ok()).is_some_and(|new|{
            let (Value::Row(a),Value::Row(b))=(old,new)else{return false;};
            a.keys().chain(b.keys()).filter(|c|!definition.maintained.contains_key(*c)&&!(table==&inv.table&&inv.column.as_ref()==Some(*c)&&old.field("id").ok()==Some(key))).all(|c|old.field(c).ok()==new.field(c).ok())
        }))
    })
}
fn run_pair_variant(bound:&Bound,inv:&Invariant,rows:&BTreeMap<String,Vec<Value>>,row:&Value,fixture:Option<&Engine>,trace:Option<(&BTreeMap<String,Vec<Value>>,&[histories::Step])>,presence:bool,out:&mut Campaign){
    if discharged(bound,inv){return;}
    if !reserve(out,1){return;}
    let Some(other)=sample_rows(bound,rows,inv,row,presence)else{out.unsupported.insert(format!("{}.{}: column pair needs a second typed non-asset value",inv.table,inv.column.as_deref().unwrap_or("")));return;};
    let altrow=other[&inv.table].iter().find(|r|r.field("id").ok()==row.field("id").ok()).unwrap();
    let mut actors=histories::viewers(bound);
    for (table,rs) in rows{for r in rs{for (c,k) in &bound.schema.tables[table].columns{if matches!(k.required(),C::Principal)&&let Ok(Value::Id(p))=r.field(c)&&!actors.contains(p){actors.push(p.clone());}}}}
    'actors: for viewer in &actors{
        let committed=trace.map(|(_,steps)|steps.iter().filter(|s|s.result.get("state").and_then(serde_json::Value::as_str)==Some("sent")).count()).unwrap_or(0);
        if fixture.is_some()&&out.violations.iter().any(|v|v.invariant_site==inv.site.to_string()&&v.viewer==*viewer&&v.reachability==Reachability::AuthoredFixtureTrace&&v.history.iter().filter(|s|s.result.get("state").and_then(serde_json::Value::as_str)==Some("sent")).count()<=committed){continue;}

        {
            if !reserve(out,1){return;}
            let judge=if let Some(fixture)=fixture{fork(bound,fixture,Vec::new())}else{engine(bound,rows,program("$column.intent",ProgramKind::Query,vec![Stmt::Return(Expr::Literal(Value::Null))]))};
            let Ok(mut judge)=judge else{out.unsupported.insert(format!("{}: primary column intent world unavailable",inv.target_label()));continue;};
            let actual=match readback(&judge){Ok(rows)=>rows,Err(why)=>{out.unsupported.insert(why);continue;}};
            let Some(primary)=actual.get(&inv.table).into_iter().flatten().find(|r|r.field("id").ok()==row.field("id").ok())else{continue;};
            if policy_in(bound,inv,&actual,viewer,None,primary,&mut judge)!=Ok(false){continue;}
        }
        for bp in &bound.programs{
            if !reserve(out,1){return;}
            let p=&bp.program;
            if !matches!(p.kind,ProgramKind::Query|ProgramKind::Mutation)||p.native{continue;}
            let json=serde_json::to_string(p).unwrap();
            if ["NewId","Emit","JobAs","JobQuery"].iter().any(|s|json.contains(s)){out.unsupported.insert(format!("{}: generated-id/opaque column observer declined",p.name));continue;}
            if p.kind==ProgramKind::Mutation {
                if inv.policy.is_none(){out.unsupported.insert(format!("{}: column mutation has unknown policy dependencies; disclosure-boundary tracing required",p.name));continue;}
                let writes=ir::write_tables(p);
                let deps=inv.policy.as_ref().map(|r|stability::dependencies(bound,r)).unwrap_or_default();
                if writes.iter().any(|(t,_)|t==&inv.table||deps.contains(t)){
                    out.unsupported.insert(format!("{}: column mutation can change protected row/policy before disclosure; boundary tracing required",p.name));continue;
                }
                if stability::implicit(bound,p).iter().any(|t|t==&inv.table||deps.contains(t)){out.unsupported.insert(format!("{}: implicit writes can change column policy before disclosure",p.name));continue;}
            }
            let args_list=histories::fixture_cases(&p.args,rows,&actors,out);
            for args in args_list{
                if !reserve(out,4){return;}
                let execute=|alternate:bool|->Result<(serde_json::Value,BTreeMap<String,Vec<Value>>,BTreeMap<String,Value>),String>{
                    let seeds=if alternate{&other}else{rows};
                    let mut e=if let Some(fixture)=fixture{
                        let mut e=fork(bound,fixture,Vec::new())?;
                        if alternate{
                            let t=&bound.schema.tables[&inv.table];
                            let Value::Row(fields)=altrow else{return Err("not a row".into());};
                            let clean=Value::Row(fields.iter().filter(|(c,_)|!t.engine_field(c)&&!t.recorded.contains_key(*c)&&!t.maintained.contains_key(*c)).map(|(c,v)|(c.clone(),v.clone())).collect());
                            if let Err(why)=e.seed_at([(inv.table.clone(),clean.clone())],NOW){
                                let immutable=t.constraints.iter().any(|c|matches!(c,Constraint::Immutable{fields} if inv.column.as_ref().is_some_and(|c|fields.contains(c)))||matches!(c,Constraint::AppendOnly));
                                if !immutable{return Err(why.to_string());}
                                e=engine_on_store(bound,&other,Vec::new(),fixture.store().empty_with_asset_ledger().map_err(|e|e.to_string())?)?;
                            }
                        }e
                    }else{engine(bound,seeds,program("$column.pair",ProgramKind::Query,vec![Stmt::Return(Expr::Literal(Value::Null))]))?};
                    let actual=readback(&e)?;
                    let current=actual.get(&inv.table).into_iter().flatten().find(|r|r.field("id").ok()==row.field("id").ok()).ok_or("column target is absent after validation")?;
                    if policy_in(bound,inv,&actual,viewer,None,current,&mut e)!=Ok(false){return Err("validated column-world policy is not false".into());}
                    let actual_args=materialize_arguments(&mut e,&p.args,&args,viewer)?;
                    let observed=paired::observe(&mut e,p,viewer,actual_args.clone())?;
                    Ok((observed,actual,actual_args))
                };
                let (a,primary_rows,primary_args,b,alternate_rows,alternate_args)=match (execute(false),execute(true)){
                    (Ok((a,primary,aa)),Ok((b,alternate,ba)))=>(a,primary,aa,b,alternate,ba),
                    (Err(why),_)|(_,Err(why))=>{out.unsupported.insert(format!("{}.{} / {}: declined column world: {why}",inv.table,inv.column.as_deref().unwrap_or(""),p.name));continue;}
                };
                out.attempted+=2;*out.operations.entry(p.name.clone()).or_default()+=2;
                if primary_args!=alternate_args{out.unsupported.insert(format!("{}: paired column arguments require a coupled asset ledger; differing materialized inputs declined",p.name));continue;}
                let Ok(key)=row.field("id")else{continue;};
                if !same_base_world(bound,inv,&primary_rows,&alternate_rows,key){out.unsupported.insert(format!("{}.{}: committed worlds change non-protected base fields/captures or populations; reduction unavailable",inv.table,inv.column.as_deref().unwrap()));continue;}
                if a==b{continue;}
                if !matches!((execute(false),execute(true)),(Ok((aa,pa,aa_args)),Ok((bb,pb,bb_args))) if aa==a&&bb==b&&pa==primary_rows&&pb==alternate_rows&&aa_args==primary_args&&bb_args==alternate_args){out.unsupported.insert(format!("{} / {}: repeated column inputs/worlds/output are unstable or unavailable",p.name,inv.target_label()));continue;}
                let actual_row=primary_rows[&inv.table].iter().find(|r|r.field("id").ok()==Some(key)).unwrap();
                let actual_alternate=alternate_rows[&inv.table].iter().find(|r|r.field("id").ok()==Some(key)).unwrap();
                out.violations.push(Counterexample{reachability:if fixture.is_some(){Reachability::AuthoredFixtureTrace}else{Reachability::SyntheticOperation},invariant_site:inv.site.to_string(),args:primary_args,viewer:viewer.clone(),operation:p.name.clone(),effect:"column read observation".into(),row:actual_row.clone(),old:Some(actual_alternate.clone()),supporting_rows:trace.map(|(initial,_)|initial.clone()).unwrap_or_else(||primary_rows.clone()),history:trace.map(|(_,steps)|steps.to_vec()).unwrap_or_default(),rule_path:format!("authored observer depends on {}.{} while policy is false in both typed worlds",inv.table,inv.column.as_deref().unwrap()),scope:if fixture.is_some(){"primary observation executes on trusted fixture; alternate column is a dependency test, not an authored alternate-history claim"}else{"schema-valid synthetic worlds; authored observer, no application reachability claim"}.into(),observations:Some(paired::Observations{present:a,absent:b,absent_rows:alternate_rows})});
                continue 'actors;
            }
        }
    }
}
fn run_pair(bound:&Bound,inv:&Invariant,rows:&BTreeMap<String,Vec<Value>>,row:&Value,fixture:Option<&Engine>,trace:Option<(&BTreeMap<String,Vec<Value>>,&[histories::Step])>,out:&mut Campaign){
    run_pair_variant(bound,inv,rows,row,fixture,trace,false,out);
    if inv.column.as_ref().and_then(|c|bound.schema.tables[&inv.table].columns.get(c)).is_some_and(C::is_optional){run_pair_variant(bound,inv,rows,row,fixture,trace,true,out);}
}
pub(super) fn generated(bound:&Bound,out:&mut Campaign,sites:Option<&BTreeSet<String>>){
    for inv in bound.invariants.iter().filter(|i|i.target=="read"&&i.column.as_deref().is_some_and(|c|c!="id")&&sites.is_none_or(|s|s.contains(&i.site.to_string()))){
        if inv.policy.as_ref().is_some_and(super::super::temporal::has_clock){out.unsupported.insert(format!("{}.{}: column clock pairs use the campaign clock only; other temporal ticks not covered",inv.table,inv.column.as_deref().unwrap()));}
        for variant in 0..16{
            if !reserve(out,1){return;}
            let rows=match snapshot(bound,inv,variant){Ok(r)=>r,Err(why)=>{out.unsupported.insert(format!("{}: column snapshot: {why}",inv.table));continue;}};
            let e=match engine(bound,&rows,program("$column.seed",ProgramKind::Query,vec![Stmt::Return(Expr::Literal(Value::Null))])){Ok(e)=>e,Err(why)=>{out.unsupported.insert(format!("{}: column seed: {why}",inv.table));continue;}};
            let Ok(rows)=readback(&e)else{continue;};
            for row in rows.get(&inv.table).into_iter().flatten(){run_pair(bound,inv,&rows,row,None,None,out);}
            if out.violations.iter().any(|v|v.invariant_site==inv.site.to_string()){break;}
        }
    }
}
pub(super) fn fixture(bound:&Bound,fixture:&Engine,out:&mut Campaign){
    let Ok(rows)=readback(fixture)else{return;};
    for inv in bound.invariants.iter().filter(|i|i.target=="read"&&i.column.as_deref().is_some_and(|c|c!="id")){
        for row in rows.get(&inv.table).into_iter().flatten(){run_pair(bound,inv,&rows,row,Some(fixture),None,out);}
    }
}

pub(super) fn after_history(bound:&Bound,fixture:&Engine,initial:&BTreeMap<String,Vec<Value>>,steps:&[histories::Step],out:&mut Campaign){
    let rows=match readback(fixture){Ok(r)=>r,Err(why)=>{out.unsupported.insert(why);return;}};
    for inv in bound.invariants.iter().filter(|i|i.target=="read"&&i.column.as_deref().is_some_and(|c|c!="id")){

        for row in rows.get(&inv.table).into_iter().flatten(){run_pair(bound,inv,&rows,row,Some(fixture),Some((initial,steps)),out);}
    }
}
