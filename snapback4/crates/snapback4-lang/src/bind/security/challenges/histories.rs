//! Real operation histories from a complete trusted fixture, including assets.
// @ref LLP 3000.036.004#122-reproducible-campaigns-and-reachability — only actual fixture traces establish application reachability.
use super::*;
const LIMIT:usize=512;
#[derive(Clone,Debug,Serialize,serde::Deserialize)]
pub struct Step {pub operation:String,pub viewer:String,pub args:BTreeMap<String,Value>,pub result:serde_json::Value}

pub(super) fn viewers(bound:&Bound)->Vec<String>{
    let mut out=BTreeSet::from([VIEWER.into(),OTHER.into(),"account:security-no-role".into(),"service:security".into()]);
    out.extend(bound.personas.iter().map(|p|if p.contains(':'){p.clone()}else{format!("dev:{p}")}));
    fn seats(value:&serde_json::Value,out:&mut BTreeSet<String>){match value{
        serde_json::Value::String(s) if s.starts_with("service:")&&s.len()>8=>{out.insert(s.clone());},
        serde_json::Value::Array(xs)=>for x in xs{seats(x,out)},
        serde_json::Value::Object(xs)=>for x in xs.values(){seats(x,out)},_=>{}
    }}
    seats(&serde_json::to_value(&bound.schema).unwrap(),&mut out);
    for p in &bound.programs{seats(&serde_json::to_value(&p.program).unwrap(),&mut out);}
    seats(&serde_json::to_value(&bound.invariants).unwrap(),&mut out);
    out.into_iter().collect()
}
pub(super) fn actors(bound:&Bound,rows:&BTreeMap<String,Vec<Value>>)->Vec<String>{
    let mut out=viewers(bound);
    for (table,rs) in rows{for row in rs{for (c,k) in &bound.schema.tables[table].columns{
        if matches!(k.required(),C::Principal)&&let Ok(Value::Id(p))=row.field(c)&&!out.contains(p){out.push(p.clone());}
    }}}
    out
}
pub(super) fn fixture_cases(bound:&Bound,p:&Program,rows:&BTreeMap<String,Vec<Value>>,actors:&[String],out:&mut Campaign)->Vec<BTreeMap<String,Value>>{
    let args=&p.args;
    let mut literals=BTreeMap::<String,Vec<Value>>::new();
    fn collect(value:&serde_json::Value,out:&mut BTreeMap<String,Vec<Value>>){
        if let Some(binary)=value.get("Binary") {for (a,b) in [("left","right"),("right","left")] {
            if let (Some(name),Some(literal))=(binary.get(a).and_then(|v|v.get("Variable")).and_then(serde_json::Value::as_str),binary.get(b).and_then(|v|v.get("Literal"))) {
                if let Ok(value)=serde_json::from_value::<Value>(literal.clone()){out.entry(name.into()).or_default().push(value);}
            }
        }}
        match value{serde_json::Value::Object(xs)=>for v in xs.values(){collect(v,out)},serde_json::Value::Array(xs)=>for v in xs{collect(v,out)},_=>{}}
    }
    collect(&serde_json::to_value(p).unwrap(),&mut literals);
    fn values(name:&str,k:&ir::ArgType,rows:&BTreeMap<String,Vec<Value>>,actors:&[String])->Option<Vec<Value>>{
        Some(match k{
            ir::ArgType::Enum{variants}=>variants.iter().map(|s|Value::String(s.clone())).collect(),
            ir::ArgType::Text{min,max,..}=>['z','y'].into_iter().map(|c|Value::String(c.to_string().repeat((*min).max(1).min(*max) as usize))).collect(),
            ir::ArgType::Int=>vec![Value::Int(0),Value::Int(1),Value::Int(2)],
            ir::ArgType::IntRange{min,max}=>{let mut xs=vec![*min,1i64.clamp(*min,*max),*max];xs.sort();xs.dedup();xs.into_iter().map(Value::Int).collect()},
            ir::ArgType::Bool=>vec![Value::Bool(false),Value::Bool(true)],
            ir::ArgType::Time=>vec![Value::Int(NOW-86_400_000),Value::Int(NOW),Value::Int(NOW+86_400_000)],
            ir::ArgType::Principal=>actors.iter().map(|s|Value::Id(s.clone())).collect(),
            ir::ArgType::Ref{table} if rows.get(table).is_some_and(|rs|!rs.is_empty())=>rows[table].iter().filter_map(|r|r.field("id").ok().cloned()).collect(),
            ir::ArgType::Optional(inner)=>{let mut v=vec![Value::Null];v.extend(values(name,inner,rows,actors)?);v},
            _=>vec![arguments(&BTreeMap::from([(name.into(),k.clone())]),0)?.remove(name)?],
        })
    }
    let mut cases=vec![BTreeMap::new()];
    for (name,k) in args{
        let Some(mut vals)=values(name,k,rows,actors)else{out.unsupported.insert(format!("{name}: history needs a typed asset argument"));return Vec::new();};
        for literal in literals.get(name).into_iter().flatten() {
            let valid=match (k,literal){
                (ir::ArgType::Text{min,max,..},Value::String(s))=>s.chars().filter(|c|!c.is_whitespace()).count()>=*min as usize&&s.chars().count()<=*max as usize,
                (ir::ArgType::Int,Value::Int(_))=>true,
                (ir::ArgType::IntRange{min,max},Value::Int(n))=>(*min..=*max).contains(n),_=>false,
            };
            if valid&&!vals.contains(literal){vals.insert(0,literal.clone());}
        }
        let mut next=Vec::new();
        'product:for offset in 0..vals.len(){for n in 0..cases.len().max(vals.len()){
            if out.exhausted(){return next;}
            let mut case=cases[n%cases.len()].clone();case.insert(name.clone(),vals[(n+offset)%vals.len()].clone());
            if !next.contains(&case){next.push(case);}if next.len()==LIMIT{out.unsupported.insert("history arguments capped at 512 combinations".into());break 'product;}
        }}
        cases=next;
    }
    let focused=super::executed::write_arguments(bound,p).into_iter().filter(|a|matches!(p.args.get(a),Some(ir::ArgType::Optional(inner)) if !matches!(inner.as_ref(),ir::ArgType::Ref{..}|ir::ArgType::Principal))).collect::<Vec<_>>();
    if focused.is_empty(){return cases;}
    let mut prioritized=Vec::new();
    for case in cases{
        for name in &focused{if let Some(value)=arguments(&BTreeMap::from([(name.clone(),p.args[name].clone())]),4).and_then(|mut a|a.remove(name))&&value!=Value::Null{
            let mut alternate=case.clone();alternate.insert(name.clone(),value);if !prioritized.contains(&alternate){prioritized.push(alternate);}
        }}
        if !prioritized.contains(&case){prioritized.push(case.clone());}
        if prioritized.len()>=LIMIT{prioritized.truncate(LIMIT);out.unsupported.insert("column-write argument frontier capped at 512; remaining combinations uncovered".into());break;}
    }prioritized
}
// Preserve status/decision alternatives on each resource tuple before the
// small directed cap; text/noise arguments must not correlate bools with ids.
fn directed_cases(p:&Program,cases:Vec<BTreeMap<String,Value>>,campaign:&mut Campaign)->Vec<BTreeMap<String,Value>>{
    let identities=p.args.iter().filter(|(_,k)|matches!(k,ir::ArgType::Ref{..}|ir::ArgType::Principal)).map(|(n,_)|n).collect::<Vec<_>>();
    let original=cases.clone();
    let mut seen=BTreeSet::new();let mut groups=Vec::new();
    for base in cases{let key=serde_json::to_string(&identities.iter().map(|n|(*n,base.get(*n))).collect::<Vec<_>>()).unwrap();if !seen.insert(key){continue;}
        let mut group=vec![base.clone()];
        for (name,kind) in &p.args{let values=match kind{ir::ArgType::Bool=>vec![Value::Bool(false),Value::Bool(true)],ir::ArgType::Enum{variants}=>variants.iter().cloned().map(Value::String).collect(),_=>Vec::new()};
            for value in values{let mut candidate=base.clone();candidate.insert(name.clone(),value);if !group.contains(&candidate){group.push(candidate);}}
        }groups.push(group);
    }
    let mut out=Vec::new();for n in 0..groups.iter().map(Vec::len).max().unwrap_or(0){for group in &groups{if let Some(args)=group.get(n){out.push(args.clone());}}}
    if original.iter().any(|case|!out.contains(case)){campaign.unsupported.insert(format!("{}: directed argument grouping omits correlated/non-status alternatives; remaining combinations uncovered",p.name));}
    out
}
pub(super) fn trace_key(steps:&[Step])->Vec<(&str,&str)>{steps.iter().map(|s|(s.operation.as_str(),s.viewer.as_str())).collect()}
pub(super) fn violation(out:&mut Campaign,inv:&Invariant,steps:&[Step],viewer:&str,row:&Value,old:Option<&Value>,initial:&BTreeMap<String,Vec<Value>>,effect:&str)->bool{
    if out.violations.iter().any(|v|v.invariant_site==inv.site.to_string()&&v.viewer==viewer&&v.reachability==Reachability::AuthoredFixtureTrace&&trace_key(&v.history)==trace_key(steps)){return false;}
    out.violations.push(Counterexample{reachability:Reachability::AuthoredFixtureTrace,observations:None,history:steps.to_vec(),invariant_site:inv.site.to_string(),args:BTreeMap::new(),viewer:viewer.into(),operation:steps.last().map(|s|s.operation.clone()).unwrap_or("$fixture.read".into()),effect:effect.into(),row:row.clone(),old:old.cloned(),supporting_rows:initial.clone(),rule_path:"actual authored operation/read from the trusted fixture".into(),scope:"reachable from recorded trusted fixture; finite trace, not an all-history proof".into()});true
}
pub(super) fn typed_disclosure(ty:&crate::types::Ty,data:&Value,table:&str,key:&Value,column:Option<&str>,physical:&Value)->bool{
    typed_disclosure_image(ty,data,table,key,column,physical,None)
}
pub(super) fn typed_disclosure_image(ty:&crate::types::Ty,data:&Value,table:&str,key:&Value,column:Option<&str>,physical:&Value,policy:Option<&RuleExpr>)->bool{
    use crate::types::Ty;
    let payload=|data:&Value|matches!(data,Value::Row(_))&&data.field("id").ok()==Some(key)&&column.is_none_or(|c|data.field(c).ok().is_some_and(|v|physical.field(c).ok()==Some(v)))&&policy.is_none_or(|p|!p.any_term(&|term|{
        let column=match term{RuleTerm::Field(c)|RuleTerm::OldField(c)|RuleTerm::NextField(c)=>Some(c.as_str()),RuleTerm::Reference{column,..}|RuleTerm::ReferenceChain{column,..}=>Some(column.as_str()),_=>None};
        column.filter(|c|*c!="$security:server-clock").is_some_and(|c|data.field(c).is_err()||data.field(c).ok()!=physical.field(c).ok())
    }));
    match ty{
        Ty::Row(t)|Ty::WriteRow(t) if t==table=>payload(data),
        Ty::Optional(inner)|Ty::Omittable(inner)=>typed_disclosure_image(inner,data,table,key,column,physical,policy),
        Ty::Page(t,_) if t==table=>matches!(data,Value::Array(xs) if xs.iter().any(payload)),
        Ty::List(inner,_)|Ty::Collection(inner,_)=>matches!(data,Value::Array(xs) if xs.iter().any(|r|typed_disclosure_image(inner,r,table,key,column,physical,policy))),
        Ty::Object(fields)|Ty::RowShape(fields)|Ty::RowObject(fields)=>fields.iter().any(|(name,ty)|data.field(name).ok().is_some_and(|v|typed_disclosure_image(ty,v,table,key,column,physical,policy))),
        _=>false,
    }
}
pub(super) fn typed_source(ty:&crate::types::Ty,table:&str)->bool{
    use crate::types::Ty;
    match ty{Ty::Row(t)|Ty::WriteRow(t)|Ty::Page(t,_)=>t==table,Ty::Optional(inner)|Ty::Omittable(inner)|Ty::List(inner,_)|Ty::Collection(inner,_)=>typed_source(inner,table),Ty::Object(fields)|Ty::RowShape(fields)|Ty::RowObject(fields)=>fields.values().any(|ty|typed_source(ty,table)),_=>false}
}
pub(super) fn observer_tables(bound:&Bound,table:&str)->BTreeSet<String>{
    let mut out=BTreeSet::from([table.into()]);
    loop{let before=out.len();
        for m in &bound.schema.maintains{if out.contains(&m.source){out.insert(m.target.clone());if let Some(owner)=&m.private{out.insert(owner.table.clone());}}}
        for (name,t) in &bound.schema.tables{if t.through.as_ref().is_some_and(|edge|out.contains(&edge.parent))||super::super::columns::rules(t).any(|r|kernel::dependencies(r).iter().any(|t|out.contains(t))){out.insert(name.clone());}}
        if out.len()==before{return out;}
    }
}
fn reserve_observers(out:&mut Campaign,calls:usize)->bool{
    if !out.reserve(calls){return false;}
    if out.history_observer_calls+calls>32768{out.unsupported.insert("history read observers capped at 32768 calls; remaining disclosure combinations not covered".into());false}else{out.history_observer_calls+=calls;true}
}
fn observe(bound:&Bound,e:&mut Engine,rows:&BTreeMap<String,Vec<Value>>,initial:&BTreeMap<String,Vec<Value>>,actors:&[String],steps:&[Step],out:&mut Campaign){
    if !reserve_observers(out,0)||out.history_observer_calls>=32768{return;}
    let queries=bound.programs.iter().filter(|bp|bp.program.kind==ProgramKind::Query&&!bp.program.native).filter(|bp|{
        let json=serde_json::to_string(&bp.program).unwrap();
        if ["NewId","Emit","JobAs","JobQuery"].iter().any(|tag|json.contains(tag)){
            out.unsupported.insert(format!("{}: generated-id/opaque history observer needs disclosure provenance",bp.program.name));false
        }else{true}
    }).collect::<Vec<_>>();
    if queries.is_empty(){return;}
    for inv in bound.invariants.iter().filter(|i|i.target=="read"){
        let direct=inv.policy.as_ref().is_some_and(|p|kernel::implies(&super::super::columns::admission(&bound.schema.tables[&inv.table],inv.column.as_deref()),p)==Ok(true));
        let indirect=bound.schema.maintains.iter().any(|m|m.source==inv.table)||bound.schema.tables.values().any(|t|super::super::columns::rules(t).any(|r|kernel::dependencies(r).contains(&inv.table)));
        if direct&&!indirect{continue;}

        let observing=observer_tables(bound,&inv.table);
        for row in rows.get(&inv.table).into_iter().flatten(){'actors:for viewer in actors{
            if out.exhausted(){return;}
            if out.violations.iter().any(|v|v.invariant_site==inv.site.to_string()&&v.viewer==*viewer&&v.reachability==Reachability::AuthoredFixtureTrace&&trace_key(&v.history)==trace_key(steps)){continue;}
            if !reserve_observers(out,1){return;}
            match policy_in(bound,inv,rows,viewer,None,row,e){Ok(false)=>{},Ok(true)=>continue,Err(why)=>{out.unsupported.insert(format!("{}: {why}",inv.target_label()));continue;}}
            let Ok(key)=row.field("id")else{continue;};
            if inv.column.as_ref().and_then(|c|bound.schema.tables[&inv.table].written_by.get(c)).is_some_and(|gate|!gate.audience&&row.field(&gate.owner).ok()!=Some(&Value::Id(viewer.clone()))){continue 'actors;}

            // A typed authored row return is already a payload witness. It does
            // not require an invalid absent world that deletes referenced data.
            for bp in queries.iter().copied().filter(|p|typed_source(&p.result,&inv.table)){
                let cases=fixture_cases(bound,&bp.program,rows,actors,out);
                if cases.len()>32{out.unsupported.insert(format!("{}: typed read-observer arguments capped at 32",bp.program.name));}
                for args in cases.into_iter().take(32){
                    if !reserve_observers(out,2){return;}
                    let args=match materialize_arguments(e,&bp.program.args,&args,viewer){Ok(a)=>a,Err(why)=>{out.unsupported.insert(format!("{}: typed history observer asset/input preparation: {why}",bp.program.name));continue;}};
                    out.attempted+=1;
                    if let Ok(q)=e.query(&bp.program.name,Context::new(viewer,args.clone()).at(NOW))&&!q.unavailable&&typed_disclosure(&bp.result,&q.data,&inv.table,key,inv.column.as_deref(),row){
                        out.attempted+=1;
                        if !matches!(e.query(&bp.program.name,Context::new(viewer,args.clone()).at(NOW)),Ok(again) if !again.unavailable&&again.data==q.data){
                            out.unsupported.insert(format!("{}: typed read payload is not repeatable on the committed image",bp.program.name));continue;
                        }
                        let added=violation(out,inv,steps,viewer,row,None,initial,if inv.column.is_some(){"column read observation"}else{"read"});
                        if added&&let Some(v)=out.violations.last_mut(){v.operation=bp.program.name.clone();v.args=args;v.rule_path="authored query repeatably returned a compiler-typed row/column payload of the protected table while current policy is false".into();}
                        continue 'actors;
                    }
                }
            }
            if inv.column.as_deref().is_some_and(|c|c!="id"){continue 'actors;}
            if bound.schema.tables.values().any(|t|t.columns.values().any(|k|matches!(k.required(),C::Ref{table} if table==&inv.table))){out.unsupported.insert(format!("{}: history paired absence needs a referentially valid closure",inv.table));continue;}
            let Ok(id)=key.as_str()else{continue;};
            if !reserve_observers(out,3){return;}
            let mut absent=match fork(bound,e,Vec::new()){Ok(e)=>e,Err(why)=>{out.unsupported.insert(format!("{}: absent world fork: {why}",inv.table));continue;}};
            if let Err(why)=absent.seed_delete_at(&inv.table,id,NOW){out.unsupported.insert(format!("{}: absent world refused: {why}",inv.table));continue;}
            if let Err(why)=validate_fixture(bound,&mut absent){out.unsupported.insert(format!("{}: absent world invalid: {why}",inv.table));continue;}
            let absent_rows=match readback(&absent){Ok(r)=>r,Err(why)=>{out.unsupported.insert(format!("{}: absent world readback: {why}",inv.table));continue;}};
            if policy_in(bound,inv,&absent_rows,viewer,None,row,&mut absent)!=Ok(false){continue;}
            for bp in queries.iter().copied().filter(|p|observing.iter().any(|t|super::super::audit::mentions(&serde_json::to_value(&p.program).unwrap(),t))){
                let p=&bp.program;
                let cases=fixture_cases(bound,p,rows,actors,out);
                if cases.len()>32{out.unsupported.insert(format!("{}: read-observer arguments capped at 32; remaining combinations not covered",p.name));}
                for args in cases.into_iter().take(32){
                    if !reserve_observers(out,4){return;}
                    let raw_args=args;
                    let args=match materialize_arguments(e,&p.args,&raw_args,viewer){Ok(a)=>a,Err(why)=>{out.unsupported.insert(format!("{}: paired history observer asset/input preparation: {why}",p.name));continue;}};
                    if args!=raw_args{
                        if !reserve_observers(out,2){return;}
                        absent=match fork(bound,e,Vec::new()){Ok(e)=>e,Err(why)=>{out.unsupported.insert(format!("{}: paired history argument ledger fork: {why}",p.name));continue;}};
                        if let Err(why)=absent.seed_delete_at(&inv.table,id,NOW){out.unsupported.insert(format!("{}: paired history argument ledger absence: {why}",p.name));continue;}
                        if let Err(why)=validate_fixture(bound,&mut absent){out.unsupported.insert(format!("{}: ledger absence world invalid: {why}",p.name));continue;}
                        if readback(&absent)!=Ok(absent_rows.clone()){out.unsupported.insert(format!("{}: paired argument ledger changes the absent base world",p.name));continue;}
                    }
                    out.attempted+=2;
                    let (Ok(a),Ok(b))=(paired::observe(e,p,viewer,args.clone()),paired::observe(&mut absent,p,viewer,args.clone()))else{continue;};
                    if a==b{continue;}
                    if !matches!((paired::observe(e,p,viewer,args.clone()),paired::observe(&mut absent,p,viewer,args.clone())),(Ok(aa),Ok(bb)) if a==aa&&b==bb){out.unsupported.insert(format!("{} / {}: paired history observation is unstable or unavailable on repeat",p.name,inv.target_label()));continue;}
                    let added=violation(out,inv,steps,viewer,row,None,initial,"read");
                    if added&&let Some(v)=out.violations.last_mut(){v.operation=p.name.clone();v.args=args;v.observations=Some(paired::Observations{present:a,absent:b,absent_rows:absent_rows.clone()});}
                    continue 'actors;
                }
            }
        }}
    }
}
fn prior_policy(bound:&Bound,inv:&Invariant,rows:&BTreeMap<String,Vec<Value>>,viewer:&str,old:Option<&Value>,row:&Value,prior:&mut Option<Engine>)->Result<bool,String>{
    match prior.as_mut(){Some(e)=>policy_in(bound,inv,rows,viewer,old,row,e),None=>policy(bound,inv,rows,viewer,old,row)}
}
fn assertions(bound:&Bound,before:&BTreeMap<String,Vec<Value>>,after:&BTreeMap<String,Vec<Value>>,initial:&BTreeMap<String,Vec<Value>>,viewer:&str,steps:&[Step],prior:&mut Option<Engine>,current:&mut Engine,out:&mut Campaign){
    for inv in bound.invariants.iter().filter(|i|i.target=="always"){
        for row in after.get(&inv.table).into_iter().flatten(){
            let old=before.get(&inv.table).into_iter().flatten().find(|r|r.field("id").ok()==row.field("id").ok());
            if policy_in(bound,inv,after,viewer,old,row,current)!=Ok(false){continue;}
            // A pre-existing seed defect is supplemental; a newly violated
            // assertion or changed image is an authored committed observation.
            if old!=Some(row)||old.is_some_and(|r|prior_policy(bound,inv,before,viewer,Some(r),r,prior)==Ok(true)){
                violation(out,inv,steps,viewer,row,old,initial,"always");
            }
        }
    }
}
fn changed(bound:&Bound,_p:&Program,before:&BTreeMap<String,Vec<Value>>,after:&BTreeMap<String,Vec<Value>>,initial:&BTreeMap<String,Vec<Value>>,viewer:&str,steps:&[Step],prior:&mut Option<Engine>,current:&mut Engine,out:&mut Campaign){
    assertions(bound,before,after,initial,viewer,steps,prior,current,out);
    // Disappearance is coverage evidence only. Actual delete authority is
    // judged by the executed-write trace, never by a commit-end image diff.
    for inv in bound.invariants.iter().filter(|i|matches!(i.target.as_str(),"delete"|"write")){
        if bound.schema.tables[&inv.table].is_expiring()&&before.get(&inv.table).into_iter().flatten().any(|old|!after.get(&inv.table).into_iter().flatten().any(|new|new.field("id").ok()==old.field("id").ok())){
            out.unsupported.insert(format!("{}: implicit retirement is not an executed delete; delete intent requires an authored write boundary",inv.target_label()));
        }
    }
}

fn role_candidates<'a>(bound:&Bound,p:&'a Program,initial:&BTreeMap<String,Vec<Value>>,actors:&[String],cases:&[BTreeMap<String,Value>],fixture:&Engine,campaign:&mut Campaign)->Vec<(&'a Program,String,BTreeMap<String,Value>)>{
    let mut out=Vec::new();let mut groups=Vec::new();
    let json=serde_json::to_string(p).unwrap();
    if !ir::write_tables(p).iter().any(|(table,_)|!super::super::privilege::role_columns(bound,table).is_empty()){return out;}
    if !campaign.reserve(1){return Vec::new();}
    let Ok(mut judge)=fork(bound,fixture,Vec::new())else{return Vec::new();};
    for (table,_) in ir::write_tables(p){
        let columns=super::super::privilege::role_columns(bound,&table);
        if !columns.iter().any(|c|json.contains(&format!("\"{c}\":"))){continue;}
        let t=&bound.schema.tables[&table];
        for row in initial.get(&table).into_iter().flatten(){
            let principal=t.columns.iter().find_map(|(c,k)|matches!(k.required(),C::Principal).then(||row.field(c).ok()).flatten());
            let Some(principal)=principal else{continue;};
            let mut targets=Vec::new();
            for case in cases{
                let mut args=case.clone();
                for (name,kind) in &p.args{match kind{
                    ir::ArgType::Principal=>{args.insert(name.clone(),principal.clone());},
                    ir::ArgType::Ref{table:target} if target==&table=>{if let Ok(id)=row.field("id"){args.insert(name.clone(),id.clone());}},_=>{}
                }}
                if columns.iter().any(|c|args.get(c).is_some_and(|v|row.field(c).ok()==Some(v))){continue;}
                if !targets.contains(&args){targets.push(args);}
            }
            let mut row_cases=Vec::new();
            for actor in actors{
                let owner=columns.iter().filter_map(|c|t.written_by.get(c)).any(|a|row.field(&a.owner).ok()==Some(&Value::Id(actor.clone())));
                if !campaign.reserve(1){return out;}
                let gate=judge.fixture_policy(&t.update_rule_judged(),actor,Some(row),row,NOW).ok();
                if !owner&&gate!=Some(rules::Verdict::Readable){continue;}
                for args in &targets{row_cases.push((p,actor.clone(),args.clone()));}
            }
            groups.push(row_cases);
        }
    }
    for n in 0..groups.iter().map(Vec::len).max().unwrap_or(0){for g in &groups{if let Some(case)=g.get(n){out.push(case.clone());}}}
    out
}
// Prioritize actually admitted relationship changes rather than filling the
// history cap with cross-products rejected by a recipient-role require.
fn relationship_candidates<'a>(bound:&Bound,p:&'a Program,initial:&BTreeMap<String,Vec<Value>>,actors:&[String],cases:&[BTreeMap<String,Value>],fixture:&Engine,out:&mut Campaign)->Vec<(&'a Program,String,BTreeMap<String,Value>)>{
    let writes=ir::write_tables(p);
    if !p.args.values().any(|k|matches!(k,ir::ArgType::Principal))||!writes.iter().any(|(t,_)|super::super::privilege::role_columns(bound,t).is_empty()&&bound.schema.tables[t].columns.values().any(|k|matches!(k.required(),C::Principal))){return Vec::new();}
    let mut candidates=Vec::new();let mut attempts=0;
    let Ok(mut judge)=fixture.fork_fixture()else{return candidates;};
    for actor in actors{
        let allowed=writes.iter().any(|(t,kind)|super::super::privilege::role_columns(bound,t).is_empty()&&initial.get(t).into_iter().flatten().any(|row|{
            let table=&bound.schema.tables[t];let gates=if *kind=="insert"{vec![&table.rules.insert]}else{vec![&table.rules.insert,&table.rules.update]};
            gates.into_iter().any(|gate|matches!(judge.fixture_policy(gate,actor,Some(row),row,NOW),Ok(rules::Verdict::Readable)))
        }));
        if !allowed{continue;}
        for args in cases{
            if attempts>=128||candidates.len()>=16||!out.reserve(1){return candidates;}attempts+=1;
            let Ok(mut e)=fixture.fork_fixture()else{continue;};
            let Ok(materialized)=materialize_arguments(&mut e,&p.args,args,actor)else{continue;};
            if !matches!(e.mutate(&p.name,None,Context::new(actor,materialized).at(NOW)),Ok(r) if matches!(r.state,snapback4_core::WriteState::Sent{..})){continue;}
            let Ok(after)=readback(&e)else{continue;};
            if writes.iter().any(|(t,_)|initial.get(t).into_iter().flatten().any(|old|after.get(t).into_iter().flatten().find(|r|r.field("id").ok()==old.field("id").ok()).is_some_and(|new|bound.schema.tables[t].columns.iter().any(|(c,k)|matches!(k.required(),C::Principal)&&old.field(c).ok()!=new.field(c).ok())))){
                candidates.push((p,actor.clone(),args.clone()));
            }
        }
    }candidates
}
pub(super) fn initial_observers(bound:&Bound,fixture:&Engine,out:&mut Campaign){
    if bound.invariants.is_empty()||out.exhausted(){return;}
    let Ok(initial)=readback(fixture)else{return;};
    let actors=actors(bound,&initial);
    if !out.reserve(1){return;}
    let Ok(mut engine)=fork(bound,fixture,Vec::new())else{return;};
    observe(bound,&mut engine,&initial,&initial,&actors,&[],out);
}
// Prefer real lifecycle successors before the general diagonal history matrix.
// @ref LLP 3000.036.004#163-directed-finite-histories — pruning orders finite replay, never proves safety.
pub(super) fn lifecycle_observers(bound:&Bound,fixture:&Engine,out:&mut Campaign){
    if bound.invariants.is_empty()||out.exhausted()||bound.invariants.iter().all(|i|out.violations.iter().any(|v|v.invariant_site==i.site.to_string()&&v.reachability.is_reachable())){return;}
    let interesting=bound.invariants.iter().filter(|i|{
        if out.violations.iter().any(|v|v.invariant_site==i.site.to_string()&&v.reachability.is_reachable()){return false;}
        let t=&bound.schema.tables[&i.table];let gate=match i.target.as_str(){"read"=>super::super::columns::admission(t,i.column.as_deref()),"insert"=>t.rules.insert.clone(),"update"=>t.update_rule_judged().into_owned(),_=>RuleExpr::Allow};
        i.policy.as_ref().is_none_or(|policy|kernel::implies(&gate,policy)!=Ok(true))
    }).collect::<Vec<_>>();
    if interesting.is_empty(){return;}
    let selected_sites=interesting.iter().map(|i|i.site.to_string()).collect::<BTreeSet<_>>();
    let mut relevant=interesting.into_iter().flat_map(|i|std::iter::once(i.table.clone()).chain(i.policy.iter().flat_map(kernel::dependencies))).collect::<BTreeSet<_>>();
    for _ in 0..bound.schema.tables.len(){let old=relevant.clone();for name in &old{for kind in bound.schema.tables[name].columns.values(){if let C::Ref{table}=kind.required(){relevant.insert(table.clone());}}}if old==relevant{break;}}
    let has_lifecycle=relevant.iter().any(|name|bound.schema.tables[name].columns.values().any(|k|matches!(k.required(),C::Enum{..}|C::Bool|C::Principal|C::Ref{..})));
    if !has_lifecycle{return;}
    let transitions=bound.programs.iter().filter(|bp|bp.program.kind==ProgramKind::Mutation&&!bp.program.native&&!bound.schema.operations.get(&bp.program.name).is_some_and(|f|f.ephemeral)).filter(|bp|{
        ir::write_tables(&bp.program).iter().any(|(name,kind)|relevant.contains(name)&&(*kind!="insert"||bound.invariants.iter().any(|i|&i.table==name)))
    }).collect::<Vec<_>>();
    if transitions.is_empty(){return;}
    let Ok(initial)=readback(fixture)else{return;};
    if !relevant.iter().any(|name|super::super::privilege::role_columns(bound,name).is_empty()&&initial.get(name).is_some_and(|rs|!rs.is_empty())){
        out.unsupported.insert("directed lifecycle needs a populated resource root; generated initialization and breadth retain bootstraps, longer empty-start histories remain uncovered".into());return;
    }
    let actors=actors(bound,&initial);
    if !out.reserve(1){return;}
    let Ok(root)=fixture.fork_fixture()else{return;};
    let mut frontier=vec![(root,Vec::<Step>::new())];
    fn signature(bound:&Bound,rows:&BTreeMap<String,Vec<Value>>)->String{
        // Equality of this projection is only an exploration heuristic. Missing
        // worlds are explicitly uncovered; it never discharges an obligation.
        let projected=rows.iter().map(|(name,rs)|{let t=&bound.schema.tables[name];let mut images=rs.iter().map(|r|t.columns.iter().filter(|(c,k)|c.as_str()!="id"&&matches!(k.required(),C::Enum{..}|C::Bool|C::Principal|C::Ref{..})).filter_map(|(c,_)|r.field(c).ok().map(|v|(c.clone(),v.clone()))).collect::<BTreeMap<_,_>>()).collect::<Vec<_>>();images.sort_by_key(|r|serde_json::to_string(r).unwrap());(name.clone(),images)}).collect::<BTreeMap<_,_>>();serde_json::to_string(&projected).unwrap()
    }
    let mut seen=BTreeSet::from([signature(bound,&initial)]);
    for _ in 0..8{
        let mut next=Vec::new();let frontier_count=frontier.len();
        for (base,steps) in frontier{
            let Ok(before)=readback(&base)else{continue;};
            for bp in &transitions{
                let p=&bp.program;
                let targets=ir::write_tables(p);

                if targets.iter().all(|(t,kind)|*kind=="insert"&&before.get(t).is_some_and(|rs|rs.len()>=2)){out.unsupported.insert("directed lifecycle omits further insert-only expansion of populated tables; additional populations uncovered".into());continue;}
                let ordinary=fixture_cases(bound,p,&before,&actors,out);
                let mut cases=role_candidates(bound,p,&before,&actors,&ordinary,&base,out).into_iter().map(|(_,_,args)|args).collect::<Vec<_>>();
                cases.extend(ordinary);let mut argument_keys=BTreeSet::new();cases.retain(|args|argument_keys.insert(serde_json::to_string(args).unwrap()));
                let cases=directed_cases(p,cases,out);
                if cases.len()>4{out.unsupported.insert(format!("{}: directed lifecycle arguments capped at 4",p.name));}
                let mut successors=Vec::<(Engine,Vec<Step>,usize,String)>::new();
                let program_json=serde_json::to_string(p).unwrap();
                for args in cases.into_iter().take(4){
                    let mut ordered=actors.iter().map(|actor|{
                        let mut score=0;let mut class=BTreeSet::new();
                        for (table,rs) in &before{let roles=super::super::privilege::role_columns(bound,table);for row in rs{
                            if !bound.schema.tables[table].columns.iter().any(|(c,k)|matches!(k.required(),C::Principal)&&row.field(c).ok()==Some(&Value::Id(actor.clone()))){continue;}
                            for c in &roles{if let Ok(value)=row.field(c){class.insert(format!("{table}.{c}={value:?}"));}}
                            if !roles.is_empty()&&roles.iter().any(|c|row.field(c).is_ok_and(|v|matches!(v,Value::String(role) if program_json.contains(&format!("\"String\":\"{role}\""))))){score+=4;}
                            if p.args.iter().any(|(name,k)|matches!(k,ir::ArgType::Ref{table:t} if t==table)&&args.get(name)==row.field("id").ok()){score+=2;class.insert(format!("owns target {table}"));}
                        }}
                        if program_json.contains(&format!("\"{}\"",actor)){score+=8;}
                        (actor,score,class)
                    }).collect::<Vec<_>>();ordered.sort_by_key(|(_,score,_)|std::cmp::Reverse(*score));
                    // Two principals of one privileged role must not consume
                    // both slots and hide a different admitted role's witness.
                    let actor_count=ordered.len();let mut actor_classes=BTreeSet::new();ordered.retain(|(_,_,class)|actor_classes.insert(class.clone()));
                    if ordered.len()<actor_count{out.unsupported.insert(format!("{}: directed role-class deduplication omits actors with matching role/target projections; actor-specific histories uncovered",p.name));}
                    if ordered.len()>2{out.unsupported.insert(format!("{}: directed actor ordering keeps two candidates per argument tuple; other actors remain in breadth campaign",p.name));}
                    for (viewer,_,_) in ordered.into_iter().take(2){
                    if out.directed_attempts>=2048||!out.reserve(1){out.unsupported.insert("directed lifecycle successors capped at 2048 attempts/shared campaign budget; remaining histories uncovered".into());return;}out.directed_attempts+=1;
                    let Ok(mut engine)=base.fork_fixture()else{continue;};
                    let Ok(args)=materialize_arguments(&mut engine,&p.args,&args,viewer)else{continue;};
                    let mut prior=None;
                    if bound.invariants.iter().any(|i|i.target!="read"&&i.policy.as_ref().is_some_and(RuleExpr::has_reference)){if !out.reserve(1){return;}prior=base.fork_fixture().ok();}
                    out.attempted+=1;*out.operations.entry(p.name.clone()).or_default()+=1;
                    let trace=super::executed::trace(bound,p);
                    let Ok(result)=engine.mutate(&p.name,None,Context::new(viewer,args.clone()).at(NOW).with_fixture_trace(trace.clone()))else{continue;};
                    if !matches!(result.state,snapback4_core::WriteState::Sent{..}){out.refused+=1;continue;}
                    let Ok(after)=readback(&engine)else{continue;};
                    let mut history=steps.clone();history.push(Step{operation:p.name.clone(),viewer:viewer.clone(),args:args.clone(),result:serde_json::to_value(&result.state).unwrap()});
                    super::executed::record(bound,p,&trace,&result.state,&after,&initial,viewer,&history,&mut engine,out);
                    changed(bound,p,&before,&after,&initial,viewer,&history,&mut prior,&mut engine,out);
                    if selected_sites.iter().all(|site|out.violations.iter().any(|v|&v.invariant_site==site&&v.reachability.is_reachable())){
                        out.unsupported.insert("directed lifecycle stopped after every selected independent intent had a replayed violation; additional histories uncovered".into());return;
                    }
                    if before==after{continue;}
                    out.sequences+=1;
                    if !seen.insert(signature(bound,&after)){out.unsupported.insert("directed lifecycle signature merges worlds differing in non-status payload; remaining worlds uncovered".into());continue;}
                    observe(bound,&mut engine,&after,&initial,&actors,&history,out);
                    column_reads::after_history(bound,&engine,&initial,&history,out);
                    if selected_sites.iter().all(|site|out.violations.iter().any(|v|&v.invariant_site==site&&v.reachability.is_reachable())){
                        out.unsupported.insert("directed lifecycle stopped after every selected independent intent had a replayed violation; additional histories uncovered".into());return;
                    }
                    let progress=after.iter().filter(|(name,_)|relevant.contains(*name)).map(|(name,rs)|{let t=&bound.schema.tables[name];rs.iter().map(|r|t.columns.iter().map(|(c,k)|match k.required(){C::Enum{..} if !super::super::privilege::role_columns(bound,name).contains(c)=>before.get(name).into_iter().flatten().find(|old|old.field("id").ok()==r.field("id").ok()).is_some_and(|old|old.field(c).ok()!=r.field(c).ok()) as usize*4,C::Bool=>matches!(r.field(c),Ok(Value::Bool(true))) as usize,_=>0}).sum::<usize>()).sum::<usize>()}).sum::<usize>();
                    let state_key=signature(bound,&after.iter().filter(|(name,_)|relevant.contains(*name)).map(|(name,rs)|(name.clone(),rs.clone())).collect());
                    if successors.iter().any(|(_,_,_,key)|key==&state_key){out.unsupported.insert("directed successor diversity merges audit-only attribution variants; additional histories uncovered".into());continue;}
                    successors.push((engine,history,progress,state_key));
                    out.directed_peak_worlds=out.directed_peak_worlds.max(frontier_count+next.len()+successors.len()+1);
                    successors.sort_by_key(|(_,_,priority,_)|std::cmp::Reverse(*priority));
                    if successors.len()>2{successors.truncate(2);out.unsupported.insert(format!("{}: directed successor selection keeps two priority resource states per operation/world; other states uncovered",p.name));}
                }}
                for (engine,history,priority,_) in successors{
                    next.push((engine,history,priority));
                    out.directed_peak_worlds=out.directed_peak_worlds.max(frontier_count+next.len()+1);
                    next.sort_by_key(|(_,_,priority)|std::cmp::Reverse(*priority));
                    if next.len()>4{next.truncate(4);out.unsupported.insert("directed lifecycle beam keeps four priority worlds; displaced worlds dropped immediately and remain uncovered".into());}
                }
            }
        }
        if next.is_empty(){return;}
        frontier=next.into_iter().map(|(e,h,_)|(e,h)).collect();
    }
    out.unsupported.insert("directed lifecycle traces bounded to eight authored mutations; longer traces uncovered".into());
}
pub(super) fn run(bound:&Bound,fixture:&Engine,out:&mut Campaign){
    if bound.invariants.is_empty()||out.exhausted(){return;}
    let initial=match readback(fixture){Ok(r)=>r,Err(e)=>{out.unsupported.insert(e);return;}};
    if initial.values().map(Vec::len).sum::<usize>()>1000{out.unsupported.insert("history fixture exceeds 1000 rows".into());return;}
    let actors=actors(bound,&initial);
    let probes=Vec::new();
    let mut groups=Vec::new();
    for bp in bound.programs.iter().filter(|p|p.program.kind==ProgramKind::Mutation&&!p.program.native&&!bound.schema.operations.get(&p.program.name).is_some_and(|f|f.ephemeral)){
        let cases=fixture_cases(bound,&bp.program,&initial,&actors,out);
        let mut group=relationship_candidates(bound,&bp.program,&initial,&actors,&cases,fixture,out);
        group.extend(role_candidates(bound,&bp.program,&initial,&actors,&cases,fixture,out));
        // Diagonal order gives both actors and argument values an early turn.
        let mut seen=group.iter().map(|(_,viewer,args)|serde_json::to_string(&(viewer,args)).unwrap()).collect::<BTreeSet<_>>();
        // Give every actor the same first argument tuple before diagonal
        // variation; a referee must not see only the overturned bout by chance.
        if let Some(args)=cases.first(){for actor in &actors{
            if group.len()>=LIMIT||out.exhausted(){break;}
            if seen.insert(serde_json::to_string(&(actor,args)).unwrap()){group.push((&bp.program,actor.clone(),args.clone()));}
        }}
        'diagonal:for shift in 0..actors.len(){for n in 0..cases.len().max(actors.len()){
            if cases.is_empty()||out.exhausted(){break 'diagonal;}
            if group.len()>=LIMIT{out.unsupported.insert(format!("{}: history candidate actors/arguments capped at 512",bp.program.name));break 'diagonal;}
            let actor=&actors[(n+shift)%actors.len()];let args=&cases[n%cases.len()];
            if seen.insert(serde_json::to_string(&(actor,args)).unwrap()){group.push((&bp.program,actor.clone(),args.clone()));}
        }}
        if !group.is_empty(){groups.push(group);}
    }
    let mut candidates=Vec::new();let mut candidate_keys=BTreeSet::new();
    // Front-load a small fair frontier of role and relationship changes so
    // ordinary no-op/rejected mutations cannot consume all observer work first.
    for group in &groups {
        let p=group[0].0;
        let priority=ir::write_tables(p).iter().any(|(t,kind)|*kind!="insert"&&(!super::super::privilege::role_columns(bound,t).is_empty()||p.args.values().any(|k|matches!(k,ir::ArgType::Principal))));
        if priority{for c in group.iter().take(8){if candidate_keys.insert(serde_json::to_string(&(&c.0.name,&c.1,&c.2)).unwrap()){candidates.push(c.clone());if candidates.len()>=LIMIT/4{break;}}}}
        if candidates.len()>=LIMIT/4{break;}
    }
    'candidates:for n in 0..groups.iter().map(Vec::len).max().unwrap_or(0){for g in &groups{if let Some(c)=g.get(n){if candidate_keys.insert(serde_json::to_string(&(&c.0.name,&c.1,&c.2)).unwrap()){candidates.push(c.clone());}if candidates.len()==LIMIT{break 'candidates;}}}}
    if !out.reserve(1){return;}
    let mut base=match fork(bound,fixture,probes.clone()){Ok(e)=>e,Err(e)=>{out.unsupported.insert(e);return;}};
    for inv in bound.invariants.iter().filter(|i|i.target=="always"){
        for row in initial.get(&inv.table).into_iter().flatten(){for viewer in &actors{
            if !out.reserve(1){return;}
            if policy_in(bound,inv,&initial,viewer,None,row,&mut base)!=Ok(false){continue;}
            let mut witness=Campaign::default();violation(&mut witness,inv,&[],viewer,row,None,&initial,"always");
            if let Some(mut v)=witness.violations.pop(){v.reachability=Reachability::AuthoredFixtureTrace;v.operation="$fixture.assertion".into();v.rule_path="initial trusted fixture assertion; no authored mutation".into();v.scope="definite violation in authored fixture; initialization trusted, no authored transition claimed".into();out.violations.push(v);}break;
        }}
    }
    observe(bound,&mut base,&initial,&initial,&actors,&[],out);
    // Spend half the pair budget on grant changes followed by an operation
    // as the affected principal; interleave first steps and successor names.
    let mut role_groups=Vec::new();
    for (i,(p,_,args)) in candidates.iter().enumerate().take(LIMIT){
        let json=serde_json::to_string(p).unwrap();
        let rosters=ir::write_tables(p).into_iter().filter_map(|(t,_)|{
            let roles=super::super::privilege::role_columns(bound,&t);
            roles.iter().any(|c|json.contains(&format!("\"{c}\":"))).then_some(t)
        }).collect::<BTreeSet<_>>();
        if rosters.is_empty(){continue;}
        let mut recipients=BTreeSet::new();
        for (name,kind) in &p.args {if let Some(value)=args.get(name){match kind {
            ir::ArgType::Principal=>{if let Value::Id(actor)=value{recipients.insert(actor.clone());}},
            ir::ArgType::Ref{table} if rosters.contains(table)=>{
                if let Some(row)=initial.get(table).into_iter().flatten().find(|r|r.field("id").ok()==Some(value)){
                    for (column,kind) in &bound.schema.tables[table].columns{if matches!(kind.required(),C::Principal)&&let Ok(Value::Id(actor))=row.field(column){recipients.insert(actor.clone());}}
                }
            },_=>{}
        }}}
        let mut seen=BTreeSet::new();
        let successors=candidates.iter().enumerate().filter_map(|(j,(next,actor,_))|(next.name!=p.name&&recipients.contains(actor)&&seen.insert((next.name.clone(),actor.clone()))).then_some((i,j))).collect::<Vec<_>>();
        if !successors.is_empty(){role_groups.push(successors);}
    }
    let mut role_pairs=Vec::new();
    'pairs:for n in 0..role_groups.iter().map(Vec::len).max().unwrap_or(0){for group in &role_groups{if let Some(pair)=group.get(n){role_pairs.push(*pair);if role_pairs.len()==LIMIT/2{break 'pairs;}}}}
    // Breadth first, then targeted and diagonal pairs: no first step owns the cap.
    let history_limit=if out.history_limit==0{LIMIT}else{out.history_limit.min(LIMIT)};
    let singles=candidates.len().min(history_limit);
    let mut setups=Vec::new();let mut role_changes=Vec::new();let mut committed=Vec::new();
    let mut setup_seen=BTreeSet::new();let mut role_seen=BTreeSet::new();let mut pair_plan=Vec::new();
    for n in 0..singles+history_limit {
        if !out.reserve(1){break;}
        if n==singles&&!candidates.is_empty(){
            let disclosures=super::executed::pairs(bound,&candidates,&committed);
            let mut seen=BTreeSet::new();
            for pair in disclosures.into_iter().take(LIMIT/2){if seen.insert(pair){pair_plan.push(pair);}}
            'setup:for &second in &role_changes{for &first in &setups{if seen.insert((first,second)){pair_plan.push((first,second));if pair_plan.len()==LIMIT/2{break 'setup;}}}}
            for &(first,second) in &role_pairs{if pair_plan.len()==LIMIT{break;}if seen.insert((first,second)){pair_plan.push((first,second));}}
            let mut k=0;
            while pair_plan.len()<LIMIT{pair_plan.push((k%candidates.len(),(k/candidates.len()+k+1)%candidates.len()));k+=1;}
        }
        let indices=if n<singles{vec![n]}else if candidates.is_empty(){break;}else{let (first,second)=pair_plan[n-singles];vec![first,second]};
        let mut engine=match fork(bound,fixture,probes.clone()){Ok(e)=>e,Err(e)=>{out.unsupported.insert(e);break;}};
        out.sequences+=1;let mut steps=Vec::new();
        for i in indices{
            if !out.reserve(1){break;}
            let (p,viewer,args)=&candidates[i];let before=match readback(&engine){Ok(r)=>r,Err(e)=>{out.unsupported.insert(e);break;}};
            let args=match materialize_arguments(&mut engine,&p.args,args,viewer){Ok(a)=>a,Err(why)=>{out.unsupported.insert(format!("{}: history asset arguments: {why}",p.name));break;}};
            let mut prior=if bound.invariants.iter().any(|i|i.target!="read"&&i.policy.as_ref().is_some_and(RuleExpr::has_reference)){if !out.reserve(1){break;}match fork(bound,&engine,Vec::new()){Ok(e)=>Some(e),Err(why)=>{out.unsupported.insert(why);None}}}else{None};
            out.attempted+=1;*out.operations.entry(p.name.clone()).or_default()+=1;
            let trace=super::executed::trace(bound,p);
            match engine.mutate(&p.name,None,Context::new(viewer,args.clone()).at(NOW).with_fixture_trace(trace.clone())){
                Ok(result)=>{
                    let sent=matches!(result.state,snapback4_core::WriteState::Sent{..});
                    steps.push(Step{operation:p.name.clone(),viewer:viewer.clone(),args:args.clone(),result:serde_json::to_value(&result.state).unwrap()});
                    let after=match readback(&engine){Ok(r)=>r,Err(e)=>{out.unsupported.insert(e);break;}};
                    if sent&&n<singles{
                        if before!=after{
                            let transition=bound.schema.tables.iter().any(|(name,t)|before.get(name).into_iter().flatten().any(|old|after.get(name).into_iter().flatten().find(|r|r.field("id").ok()==old.field("id").ok()).is_some_and(|new|t.columns.iter().any(|(c,k)|matches!(k.required(),C::Enum{..})&&old.field(c).ok()!=new.field(c).ok()))));
                            if transition{committed.insert(0,i);}else{committed.push(i);}
                        }
                        let signature=serde_json::to_string(&(&p.name,viewer,&candidates[i].2)).unwrap();
                        let new_media=bound.invariants.iter().filter(|inv|inv.target=="read"&&initial.get(&inv.table).is_none_or(Vec::is_empty)).any(|inv|{
                            let table=&bound.schema.tables[&inv.table];
                            after.get(&inv.table).into_iter().flatten().any(|row|table.columns.iter().any(|(column,kind)|kind.contains_asset()&&row.field(column).is_ok_and(|v|*v!=Value::Null&&!matches!(v,Value::Array(xs) if xs.is_empty()))))
                        });
                        if new_media&&setup_seen.insert(signature.clone()){setups.push(i);}
                        let changed_role=bound.schema.tables.iter().any(|(table,_)|{
                            let columns=super::super::privilege::role_columns(bound,table);
                            !columns.is_empty()&&before.get(table).into_iter().flatten().any(|old|after.get(table).into_iter().flatten().find(|r|r.field("id").ok()==old.field("id").ok()).is_some_and(|new|columns.iter().any(|c|old.field(c).ok()!=new.field(c).ok())))
                        });
                        if changed_role&&role_seen.insert(signature){role_changes.push(i);}
                    }
                    if sent{super::executed::record(bound,p,&trace,&result.state,&after,&initial,viewer,&steps,&mut engine,out);changed(bound,p,&before,&after,&initial,viewer,&steps,&mut prior,&mut engine,out);}else{out.refused+=1;}
                    if sent&&before!=after{observe(bound,&mut engine,&after,&initial,&actors,&steps,out);column_reads::after_history(bound,&engine,&initial,&steps,out);}
                },Err(e)=>{out.unsupported.insert(format!("{}: history engine error {e}",p.name));break;}
            }
        }
    }
    out.unsupported.insert("history breadth/pairs bounded to 512; unvisited and longer traces remain uncovered".into());
}

#[cfg(test)] mod directed_pruning_tests{use super::*;
#[test] fn correlated_boolean_arguments_are_explicitly_uncovered(){
 let bound=crate::compile(&[("schema.q".into(),"table docs:\n  x: bool\n  read <- allow\n  insert <- allow\n  online only\nmutation add(a: bool,b: bool):\n  return insert docs {x:a and b}\n".into())]);
 assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);let p=&bound.programs[0].program;
 let cases=[(false,false),(false,true),(true,false),(true,true)].into_iter().map(|(a,b)|BTreeMap::from([("a".into(),Value::Bool(a)),("b".into(),Value::Bool(b))])).collect();
 let mut out=Campaign::default();let selected=directed_cases(p,cases,&mut out);assert_eq!(selected.len(),3);assert!(out.unsupported.iter().any(|s|s.contains("argument grouping")));
}}
