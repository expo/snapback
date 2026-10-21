//! Column worlds execute authored observers, including derived/count/refusal paths.
// @ref LLP 3000.036.004#121-column-read-intent — excluding a field from a projection must not produce a synthetic whole-row refutation.
use super::*;
fn reserve(out:&mut Campaign,cost:usize)->bool{
    if !out.reserve(cost){return false;}
    if out.column_observer_calls+cost>16384{out.unsupported.insert("column observers capped at 16384 call/world reservations; remaining value worlds not covered".into());return false;}
    out.column_observer_calls+=cost;true
}
fn discharged(bound:&Bound,inv:&Invariant)->bool{
    inv.policy.as_ref().is_some_and(|p|kernel::implies(&super::super::columns::admission(&bound.schema.tables[&inv.table],inv.column.as_deref()),p)==Ok(true))
        &&!bound.schema.maintains.iter().any(|m|m.source==inv.table)
        &&!bound.schema.tables.values().any(|t|super::super::columns::rules(t).any(|r|kernel::dependencies(r).contains(&inv.table)))
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
            // Ordinary reads materialize sparse optional/literal-default
            // fields. Compare that same logical image: an import may fill an
            // absent optional with null without changing any observed value.
            let old=snapback4_core::schema::row_image(old,definition);
            let new=snapback4_core::schema::row_image(new,definition);
            let (Value::Row(a),Value::Row(b))=(old.as_ref(),new.as_ref())else{return false;};
            a.keys().chain(b.keys()).filter(|c|!definition.maintained.contains_key(*c)&&!(table==&inv.table&&inv.column.as_ref()==Some(*c)&&old.field("id").ok()==Some(key))).all(|c|old.field(c).ok()==new.field(c).ok())
        }))
    })
}
// Counterfactual field mutation must not break an authored creator's copies
// or recipient guards. Direct typed payload observations run independently.
fn coupled(bound:&Bound,inv:&Invariant)->bool{
    let column=inv.column.as_deref().unwrap();
    let table=&bound.schema.tables[&inv.table];
    if table.rules.insert.needs_field_value(column,&table.columns[column])||table.update_rule_judged().needs_field_value(column,&table.columns[column]){return true;}
    fn definitions(value:&serde_json::Value,out:&mut BTreeMap<String,serde_json::Value>){
        if let Some(object)=value.as_object(){
            for tag in ["Const","Let","Assign"]{if let Some(binding)=object.get(tag)&&let (Some(name),Some(value))=(binding.get("name").and_then(serde_json::Value::as_str),binding.get("value")){
                if tag=="Assign"||out.contains_key(name){out.insert(name.into(),serde_json::Value::Null);}else{out.insert(name.into(),value.clone());}
            }}
            for child in object.values(){definitions(child,out);}
        }else if let Some(xs)=value.as_array(){for child in xs{definitions(child,out);}}
    }
    fn fields<'a>(expression:&'a serde_json::Value,bindings:&'a BTreeMap<String,serde_json::Value>,depth:usize)->Option<&'a serde_json::Map<String,serde_json::Value>>{
        if depth>32{return None;}
        if let Some(map)=expression.get("Object").and_then(serde_json::Value::as_object){return Some(map);}
        if let Some(projection)=expression.get("Builtin")&&projection.get("builtin").is_some_and(|b|b.get("ProjectFields").is_some()){
            return fields(projection.get("args")?.as_array()?.first()?,bindings,depth+1);
        }
        if let Some(name)=expression.get("Variable").and_then(serde_json::Value::as_str){return fields(bindings.get(name)?,bindings,depth+1);}
        None
    }
    fn dependency(value:&serde_json::Value,arg:&str,table:&str,args:&BTreeMap<String,ir::ArgType>,bindings:&BTreeMap<String,serde_json::Value>,depth:usize)->bool{
        if depth>32{return true;}
        if let Some(field)=value.get("Field")&&let (Some(base),Some(name))=(field.get("base"),field.get("name").and_then(serde_json::Value::as_str))&&let Some(map)=fields(base,bindings,depth+1){
            return map.get(name).is_none_or(|expression|dependency(expression,arg,table,args,bindings,depth+1));
        }
        if let Some(name)=value.get("Variable").and_then(serde_json::Value::as_str){
            if name==arg{return true;}
            if let Some(bound)=bindings.get(name){return bound.is_null()||dependency(bound,arg,table,args,bindings,depth+1);}
            return !args.contains_key(name);
        }
        // A guard re-reading the written table may inspect the supplied field
        // through a row alias even when the argument itself occurs only once.
        for tag in ["Get","Exists"]{if value.get(tag).and_then(|v|v.get("table")).and_then(serde_json::Value::as_str)==Some(table){return true;}}
        match value{serde_json::Value::Object(xs)=>xs.values().any(|v|dependency(v,arg,table,args,bindings,depth+1)),serde_json::Value::Array(xs)=>xs.iter().any(|v|dependency(v,arg,table,args,bindings,depth+1)),_=>false}
    }
    fn guarded(value:&serde_json::Value,arg:&str,table:&str,args:&BTreeMap<String,ir::ArgType>,bindings:&BTreeMap<String,serde_json::Value>)->bool{
        for tag in ["Require","Check","If"]{if let Some(condition)=value.get(tag).and_then(|v|v.get("condition"))&&dependency(condition,arg,table,args,bindings,0){return true;}}
        for tag in ["Binary","Unary","Builtin","Emit","JobAs","JobQuery"]{if let Some(expression)=value.get(tag){
            if tag=="Builtin"&&expression.get("builtin").is_some_and(|b|b.get("ProjectFields").is_some()){continue;}
            if dependency(expression,arg,table,args,bindings,0){return true;}
        }}
        match value{serde_json::Value::Object(xs)=>xs.values().any(|v|guarded(v,arg,table,args,bindings)),serde_json::Value::Array(xs)=>xs.iter().any(|v|guarded(v,arg,table,args,bindings)),_=>false}
    }
    fn related_write(value:&serde_json::Value,arg:&str,table:&str,column:&str,args:&BTreeMap<String,ir::ArgType>,bindings:&BTreeMap<String,serde_json::Value>)->bool{
        for tag in ["Insert","InsertIfAbsent","Upsert","Update","WriteTarget"]{
            let Some(write)=value.get(tag)else{continue;};
            let name=write.get("table").or_else(||write.get("target").and_then(|t|t.get("table"))).and_then(serde_json::Value::as_str);
            if let Some(row)=write.get("row").or_else(||write.get("patch")){
                if let Some(map)=fields(row,bindings,0){
                    if map.iter().any(|(field,expression)|(name!=Some(table)||field!=column)&&dependency(expression,arg,table,args,bindings,0)){return true;}
                }else if dependency(row,arg,table,args,bindings,0){return true;}
            }
            if write.get("key").or_else(||write.get("target").and_then(|target|target.get("key"))).is_some_and(|key|dependency(key,arg,table,args,bindings,0))||write.get("condition").is_some_and(|condition|dependency(condition,arg,table,args,bindings,0)){return true;}
        }
        match value{serde_json::Value::Object(xs)=>xs.values().any(|v|related_write(v,arg,table,column,args,bindings)),serde_json::Value::Array(xs)=>xs.iter().any(|v|related_write(v,arg,table,column,args,bindings)),_=>false}
    }
    fn writes(value:&serde_json::Value,table:&str,column:&str,args:&BTreeMap<String,ir::ArgType>,program:&str,bindings:&BTreeMap<String,serde_json::Value>,guards:&BTreeSet<String>,found:&mut bool,coupled:&mut bool){
        if let Some(object)=value.as_object(){
            for tag in ["Insert","InsertIfAbsent","Upsert","Update","WriteTarget"]{
                let Some(write)=object.get(tag)else{continue;};
                let name=write.get("table").or_else(||write.get("target").and_then(|t|t.get("table"))).and_then(serde_json::Value::as_str);
                if name!=Some(table){continue;}
                let map=write.get("row").or_else(||write.get("patch")).and_then(|e|fields(e,bindings,0));
                let Some(map)=map else{*found=true;*coupled=true;continue;};
                if let Some(expression)=map.get(column){
                    *found=true;
                    if let Some(name)=expression.get("Variable").and_then(serde_json::Value::as_str)&&args.contains_key(name){
                        let occurrence=serde_json::to_string(&Expr::Variable(name.into())).unwrap();
                        if program.matches(&occurrence).count()!=1||guards.contains(name){*coupled=true;}
                    }else{*coupled=true;}
                }else if matches!(tag,"Insert"|"InsertIfAbsent"|"Upsert")||tag=="WriteTarget"&&write.get("upsert").and_then(serde_json::Value::as_bool)==Some(true){*found=true;*coupled=true;}
            }
            for child in object.values(){writes(child,table,column,args,program,bindings,guards,found,coupled);}
        }else if let Some(xs)=value.as_array(){for child in xs{writes(child,table,column,args,program,bindings,guards,found,coupled);}}
    }
    let(mut found,mut unsafe_writer)=(false,false);
    for p in &bound.programs{
        let json=serde_json::to_value(&p.program).unwrap();let text=serde_json::to_string(&p.program).unwrap();let mut bindings=BTreeMap::new();definitions(&json,&mut bindings);
        let guards=p.program.args.keys().filter(|arg|guarded(&json,arg,&inv.table,&p.program.args,&bindings)||related_write(&json,arg,&inv.table,column,&p.program.args,&bindings)).cloned().collect();
        let mut source_found=false;writes(&json,&inv.table,column,&p.program.args,&text,&bindings,&guards,&mut source_found,&mut unsafe_writer);
        // A new compiler insertion form cannot silently become an independent
        // source merely because this reduction did not recognize its payload.
        if !source_found&&ir::write_tables(&p.program).iter().any(|(t,k)|t==&inv.table&&matches!(*k,"insert"|"upsert")){source_found=true;unsafe_writer=true;}
        found|=source_found;
    }
    found&&unsafe_writer
}
fn run_pair_variant(bound:&Bound,inv:&Invariant,rows:&BTreeMap<String,Vec<Value>>,row:&Value,fixture:Option<&Engine>,trace:Option<(&BTreeMap<String,Vec<Value>>,&[histories::Step])>,presence:bool,direct:bool,out:&mut Campaign){
    if discharged(bound,inv){return;}
    if coupled(bound,inv){out.unsupported.insert(format!("{}: alternate value may break authored creator/guard coupling; only actual typed payloads and committed histories count",inv.target_label()));return;}
    if !reserve(out,1){return;}
    let column=inv.column.as_deref().unwrap();
    let kind=&bound.schema.tables[&inv.table].columns[column];
    let mut other=match sample_rows(bound,rows,inv,row,presence){
        Some(other)=>other,
        None if kind.contains_asset()&&fixture.is_some()=>{
            let mut other=rows.clone();
            let Some(value)=sample(kind.required(),4)else{out.unsupported.insert(format!("{}.{}: alternate media type unsupported",inv.table,column));return;};
            if let Some(Value::Row(fields))=other.get_mut(&inv.table).and_then(|rs|rs.iter_mut().find(|r|r.field("id").ok()==row.field("id").ok())){fields.insert(column.into(),value);}other
        },
        None=>{out.unsupported.insert(format!("{}.{}: column pair needs a second typed value and, for media, a coupled verified fixture ledger",inv.table,column));return;},
    };
    // Both worlds receive the same verified ledger, including the alternate
    // upload. Only the protected row value changes; no fabricated media ids.
    let ledger;
    let fixture=if kind.contains_asset(){
        let Some(base)=fixture else{out.unsupported.insert(format!("{}.{}: media column pair requires the fixture ledger",inv.table,column));return;};
        let mut prepared=match fork(bound,base,Vec::new()){Ok(e)=>e,Err(why)=>{out.unsupported.insert(why);return;}};
        let target=other.get_mut(&inv.table).unwrap().iter_mut().find(|r|r.field("id").ok()==row.field("id").ok()).unwrap();
        if let Value::Row(fields)=target {
            let value=match hydrate(&mut prepared,kind,&fields[column]){Ok(v)=>v,Err(why)=>{out.unsupported.insert(format!("{}.{}: alternate media upload: {why}",inv.table,column));return;}};
            fields.insert(column.into(),value);
        }
        ledger=prepared;Some(&ledger)
    }else{fixture};
    let altrow=other[&inv.table].iter().find(|r|r.field("id").ok()==row.field("id").ok()).unwrap();
    let observing=histories::observer_tables(bound,&inv.table);
    let mut actors=histories::viewers(bound);
    for (table,rs) in rows{for r in rs{for (c,k) in &bound.schema.tables[table].columns{if matches!(k.required(),C::Principal)&&let Ok(Value::Id(p))=r.field(c)&&!actors.contains(p){actors.push(p.clone());}}}}
    'actors: for viewer in &actors{
        if fixture.is_some()&&out.violations.iter().any(|v|v.invariant_site==inv.site.to_string()&&v.viewer==*viewer&&v.reachability==Reachability::AuthoredFixtureTrace&&histories::trace_key(&v.history)==histories::trace_key(trace.map(|(_,s)|s).unwrap_or(&[]))){continue;}

        {
            if !reserve(out,2){return;}
            let judge=if let Some(fixture)=fixture{fork(bound,fixture,Vec::new())}else{engine(bound,rows,program("$column.intent",ProgramKind::Query,vec![Stmt::Return(Expr::Literal(Value::Null))]))};
            let Ok(mut judge)=judge else{out.unsupported.insert(format!("{}: primary column intent world unavailable",inv.target_label()));continue;};
            let actual=match readback(&judge){Ok(rows)=>rows,Err(why)=>{out.unsupported.insert(why);continue;}};
            let Some(primary)=actual.get(&inv.table).into_iter().flatten().find(|r|r.field("id").ok()==row.field("id").ok())else{continue;};
            if direct&&!matches!(judge.fixture_policy(&super::super::columns::admission(&bound.schema.tables[&inv.table],inv.column.as_deref()),viewer,None,primary,NOW),Ok(rules::Verdict::Readable)){continue;}
            if policy_in(bound,inv,&actual,viewer,None,primary,&mut judge)!=Ok(false){continue;}
        }
        for bp in &bound.programs{
            if !reserve(out,1){return;}
            let p=&bp.program;
            if direct&&p.kind!=ProgramKind::Query{continue;}
            if ephemeral_operation(bound,p,out){continue;}
            let json=serde_json::to_value(p).unwrap();
            if !observing.iter().any(|table|super::super::audit::mentions(&json,table)){continue;}
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
            let args_list=histories::fixture_cases(bound,p,rows,&actors,out);
            for args in args_list{
                if !reserve(out,12){return;}
                let execute=|alternate:bool|->Result<(serde_json::Value,BTreeMap<String,Vec<Value>>,BTreeMap<String,Value>),String>{
                    let seeds=if alternate{&other}else{rows};
                    let mut e=if let Some(fixture)=fixture{
                        let mut e=fork(bound,fixture,Vec::new())?;
                        if alternate{
                            let t=&bound.schema.tables[&inv.table];
                            let Value::Row(fields)=altrow else{return Err("not a row".into());};
                            let clean=Value::Row(fields.iter().filter(|(c,_)|!t.engine_field(c)&&!t.recorded.contains_key(*c)&&!t.maintained.contains_key(*c)).map(|(c,v)|(c.clone(),v.clone())).collect());
                            if let Err(why)=e.seed_at([(inv.table.clone(),clean.clone())],NOW){
                                let immutable=t.constraints.iter().any(|c|matches!(c,Constraint::Immutable{fields} if inv.column.as_ref().is_some_and(|c|fields.contains(c)))||matches!(c,Constraint::AppendOnly))||matches!(t.columns[column].required(),C::Image{once:true,..});
                                if !immutable{return Err(why.to_string());}
                                if fixture.ephemeral_hub().snapshot().map_err(|e|e.to_string())?.version.epoch!=0{return Err("immutable column alternate would drop existing ephemeral state; reduction uncovered".into());}
                                e=engine_on_store(bound,&other,Vec::new(),fixture.store().empty_with_asset_ledger().map_err(|e|e.to_string())?)?;
                            }
                        }e
                    }else{engine(bound,seeds,program("$column.pair",ProgramKind::Query,vec![Stmt::Return(Expr::Literal(Value::Null))]))?};
                    validate_fixture(bound,&mut e)?;
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
                if !same_base_world(bound,inv,&primary_rows,&alternate_rows,key){
                    let mut changes=BTreeSet::new();
                    for (t,rs) in &primary_rows{for r in rs{
                        let other=alternate_rows.get(t).into_iter().flatten().find(|n|n.field("id").ok()==r.field("id").ok());
                        let Ok(fields)=r.as_object()else{continue;};
                        for c in fields.keys(){
                            if !(t==&inv.table&&inv.column.as_ref()==Some(c))&&other.and_then(|n|n.field(c).ok())!=r.field(c).ok(){changes.insert(format!("{t}.{c}"));}
                        }
                    }}
                    out.unsupported.insert(format!("{}.{}: committed worlds change non-protected base fields/captures or populations ({}); reduction unavailable",inv.table,inv.column.as_deref().unwrap(),changes.into_iter().collect::<Vec<_>>().join(", ")));continue;
                }
                if a==b{continue;}
                if !matches!((execute(false),execute(true)),(Ok((aa,pa,aa_args)),Ok((bb,pb,bb_args))) if aa==a&&bb==b&&pa==primary_rows&&pb==alternate_rows&&aa_args==primary_args&&bb_args==alternate_args){out.unsupported.insert(format!("{} / {}: repeated column inputs/worlds/output are unstable or unavailable",p.name,inv.target_label()));continue;}
                let actual_row=primary_rows[&inv.table].iter().find(|r|r.field("id").ok()==Some(key)).unwrap();
                let actual_alternate=alternate_rows[&inv.table].iter().find(|r|r.field("id").ok()==Some(key)).unwrap();
                out.violations.push(Counterexample{reachability:if fixture.is_some(){Reachability::AuthoredFixtureTrace}else{Reachability::SyntheticOperation},invariant_site:inv.site.to_string(),args:primary_args,viewer:viewer.clone(),operation:p.name.clone(),effect:"column read observation".into(),row:actual_row.clone(),old:Some(actual_alternate.clone()),supporting_rows:trace.map(|(initial,_)|initial.clone()).unwrap_or_else(||primary_rows.clone()),history:trace.map(|(_,steps)|steps.to_vec()).unwrap_or_default(),rule_path:format!("authored observer depends on {}.{} while policy is false in both typed worlds",inv.table,inv.column.as_deref().unwrap()),scope:if fixture.is_some(){"primary observation executes on trusted fixture; alternate column is a dependency test, not an authored alternate-history claim"}else{"schema-valid synthetic worlds; authored observer, no application reachability claim"}.into(),observations:Some(paired::Observations{present:a,absent:b,absent_rows:alternate_rows})});
                if direct{return;}
                continue 'actors;
            }
        }
    }
}
fn run_pair(bound:&Bound,inv:&Invariant,rows:&BTreeMap<String,Vec<Value>>,row:&Value,fixture:Option<&Engine>,trace:Option<(&BTreeMap<String,Vec<Value>>,&[histories::Step])>,out:&mut Campaign){
    run_pair_variant(bound,inv,rows,row,fixture,trace,false,false,out);
    if inv.column.as_ref().and_then(|c|bound.schema.tables[&inv.table].columns.get(c)).is_some_and(C::is_optional){run_pair_variant(bound,inv,rows,row,fixture,trace,true,false,out);}
}
/// Prefer a rule-admitted, policy-denied actor before exploring indirect paths.
/// This is candidate ordering only; both worlds still execute authored queries.
pub(super) fn direct_fixture(bound:&Bound,fixture:&Engine,out:&mut Campaign){
    let Ok(rows)=readback(fixture)else{return;};
    for inv in bound.invariants.iter().filter(|i|i.target=="read"&&i.column.as_deref().is_some_and(|c|c!="id")){
        for row in rows.get(&inv.table).into_iter().flatten(){
            if out.exhausted(){return;}
            if out.violations.iter().any(|v|v.invariant_site==inv.site.to_string()&&v.reachability.is_reachable()){break;}
            run_pair_variant(bound,inv,&rows,row,Some(fixture),None,false,true,out);
        }
    }
}
pub(super) fn generated(bound:&Bound,out:&mut Campaign,sites:Option<&BTreeSet<String>>){
    for inv in bound.invariants.iter().filter(|i|i.target=="read"&&i.column.as_deref().is_some_and(|c|c!="id")&&sites.is_none_or(|s|s.contains(&i.site.to_string()))){
        if inv.policy.as_ref().is_some_and(super::super::temporal::has_clock){out.unsupported.insert(format!("{}.{}: column clock pairs use the campaign clock only; other temporal ticks not covered",inv.table,inv.column.as_deref().unwrap()));}
        for variant in 0..16{
            if !reserve(out,1){return;}
            let rows=match snapshot(bound,inv,variant){Ok(r)=>r,Err(why)=>{out.unsupported.insert(format!("{}: column snapshot: {why}",inv.table));continue;}};
            let e=match engine(bound,&rows,program("$column.seed",ProgramKind::Query,vec![Stmt::Return(Expr::Literal(Value::Null))])){Ok(e)=>e,Err(why)=>{out.unsupported.insert(format!("{}: column seed: {why}",inv.table));continue;}};
            let Ok(rows)=readback(&e)else{continue;};
            let first=out.violations.len();
            for row in rows.get(&inv.table).into_iter().flatten(){if out.exhausted(){break;}run_pair(bound,inv,&rows,row,Some(&e),None,out);}
            // These are schema-valid samples, not authored fixture histories.
            // Keeping their ledger does not strengthen their provenance.
            for v in &mut out.violations[first..]{v.reachability=Reachability::SyntheticOperation;v.scope="schema-valid synthetic column worlds with one verified asset ledger; no application reachability claim".into();}
            if out.violations.iter().any(|v|v.invariant_site==inv.site.to_string()){break;}
        }
    }
}
pub(super) fn fixture(bound:&Bound,fixture:&Engine,out:&mut Campaign){
    let Ok(rows)=readback(fixture)else{return;};
    for inv in bound.invariants.iter().filter(|i|i.target=="read"&&i.column.as_deref().is_some_and(|c|c!="id")){
        for row in rows.get(&inv.table).into_iter().flatten(){if out.exhausted(){return;}run_pair(bound,inv,&rows,row,Some(fixture),None,out);}
    }
}

pub(super) fn after_history(bound:&Bound,fixture:&Engine,initial:&BTreeMap<String,Vec<Value>>,steps:&[histories::Step],out:&mut Campaign){
    let rows=match readback(fixture){Ok(r)=>r,Err(why)=>{out.unsupported.insert(why);return;}};
    for inv in bound.invariants.iter().filter(|i|i.target=="read"&&i.column.as_deref().is_some_and(|c|c!="id")){

        for row in rows.get(&inv.table).into_iter().flatten(){if out.exhausted(){return;}run_pair(bound,inv,&rows,row,Some(fixture),Some((initial,steps)),out);}
    }
}
