//! Real operation histories from a complete trusted fixture, including assets.
// @ref LLP 3000.036.004#122-reproducible-campaigns-and-reachability — only actual fixture traces establish application reachability.
use super::*;
const LIMIT:usize=512;
#[derive(Clone,Debug,Serialize)]
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
fn actors(bound:&Bound,rows:&BTreeMap<String,Vec<Value>>)->Vec<String>{
    let mut out=viewers(bound);
    for (table,rs) in rows{for row in rs{for (c,k) in &bound.schema.tables[table].columns{
        if matches!(k.required(),C::Principal)&&let Ok(Value::Id(p))=row.field(c)&&!out.contains(p){out.push(p.clone());}
    }}}
    out
}
pub(super) fn fixture_cases(args:&BTreeMap<String,ir::ArgType>,rows:&BTreeMap<String,Vec<Value>>,actors:&[String],out:&mut Campaign)->Vec<BTreeMap<String,Value>>{
    fn values(name:&str,k:&ir::ArgType,rows:&BTreeMap<String,Vec<Value>>,actors:&[String])->Option<Vec<Value>>{
        Some(match k{
            ir::ArgType::Enum{variants}=>variants.iter().map(|s|Value::String(s.clone())).collect(),
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
        let Some(vals)=values(name,k,rows,actors)else{out.unsupported.insert(format!("{name}: history needs a typed asset argument"));return Vec::new();};
        let mut next=Vec::new();
        for n in 0..vals.len() {for c in &cases{
            let mut case=c.clone();case.insert(name.clone(),vals[n%vals.len()].clone());
            if !next.contains(&case){next.push(case);}if next.len()==LIMIT{break;}
        }if next.len()==LIMIT{out.unsupported.insert("history arguments capped at 512 combinations".into());break;}}
        cases=next;
    }cases
}
fn violation(out:&mut Campaign,inv:&Invariant,steps:&[Step],viewer:&str,row:&Value,old:Option<&Value>,initial:&BTreeMap<String,Vec<Value>>,effect:&str){
    let committed=|steps:&[Step]|steps.iter().filter(|s|s.result.get("state").and_then(serde_json::Value::as_str)==Some("sent")).count();
    if out.violations.iter().any(|v|v.invariant_site==inv.site.to_string()&&v.viewer==viewer&&v.reachability==Reachability::AuthoredFixtureTrace&&committed(&v.history)==committed(steps)){return;}
    out.violations.push(Counterexample{reachability:Reachability::AuthoredFixtureTrace,observations:None,history:steps.to_vec(),invariant_site:inv.site.to_string(),args:BTreeMap::new(),viewer:viewer.into(),operation:steps.last().map(|s|s.operation.clone()).unwrap_or("$fixture.read".into()),effect:effect.into(),row:row.clone(),old:old.cloned(),supporting_rows:initial.clone(),rule_path:"actual authored operation/read from the trusted fixture".into(),scope:"reachable from recorded trusted fixture; finite trace, not an all-history proof".into()});
}
fn typed_disclosure(ty:&crate::types::Ty,data:&Value,table:&str,key:&Value,column:Option<&str>,physical:&Value)->bool{
    use crate::types::Ty;
    let payload=|data:&Value|matches!(data,Value::Row(_))&&data.field("id").ok()==Some(key)&&column.is_none_or(|c|data.field(c).ok().is_some_and(|v|physical.field(c).ok()==Some(v)));
    match ty{
        Ty::Row(t)|Ty::WriteRow(t) if t==table=>payload(data),
        Ty::Optional(inner)=>typed_disclosure(inner,data,table,key,column,physical),
        Ty::Page(t,_) if t==table=>matches!(data,Value::Array(xs) if xs.iter().any(payload)),
        Ty::List(inner,_)|Ty::Collection(inner,_)=>matches!(data,Value::Array(xs) if xs.iter().any(|r|typed_disclosure(inner,r,table,key,column,physical))),
        Ty::Object(fields)|Ty::RowShape(fields)|Ty::RowObject(fields)=>fields.iter().any(|(name,ty)|data.field(name).ok().is_some_and(|v|typed_disclosure(ty,v,table,key,column,physical))),
        _=>false,
    }
}
fn typed_source(ty:&crate::types::Ty,table:&str)->bool{
    use crate::types::Ty;
    match ty{Ty::Row(t)|Ty::WriteRow(t)|Ty::Page(t,_)=>t==table,Ty::Optional(inner)|Ty::List(inner,_)|Ty::Collection(inner,_)=>typed_source(inner,table),Ty::Object(fields)|Ty::RowShape(fields)|Ty::RowObject(fields)=>fields.values().any(|ty|typed_source(ty,table)),_=>false}
}
fn observer_tables(bound:&Bound,table:&str)->BTreeSet<String>{
    let mut out=BTreeSet::from([table.into()]);
    loop{let before=out.len();
        for m in &bound.schema.maintains{if out.contains(&m.source){out.insert(m.target.clone());if let Some(owner)=&m.private{out.insert(owner.table.clone());}}}
        for (name,t) in &bound.schema.tables{if t.through.as_ref().is_some_and(|edge|out.contains(&edge.parent))||[&t.rules.read,&t.rules.insert,&t.rules.update,&t.rules.delete].iter().any(|r|kernel::dependencies(r).iter().any(|t|out.contains(t))){out.insert(name.clone());}}
        if out.len()==before{return out;}
    }
}
fn reserve_observers(out:&mut Campaign,calls:usize)->bool{
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
    for inv in bound.invariants.iter().filter(|i|i.target=="read"){
        let direct=inv.policy.as_ref().is_some_and(|p|kernel::implies(&super::super::columns::admission(&bound.schema.tables[&inv.table],inv.column.as_deref()),p)==Ok(true));
        let indirect=bound.schema.maintains.iter().any(|m|m.source==inv.table)||bound.schema.tables.values().any(|t|[&t.rules.read,&t.rules.insert,&t.rules.update,&t.rules.delete].iter().any(|r|kernel::dependencies(r).contains(&inv.table)));
        if direct&&!indirect{continue;}

        let observing=observer_tables(bound,&inv.table);
        for row in rows.get(&inv.table).into_iter().flatten(){'actors:for viewer in actors{
            let committed=steps.iter().filter(|s|s.result.get("state").and_then(serde_json::Value::as_str)==Some("sent")).count();
            if out.violations.iter().any(|v|v.invariant_site==inv.site.to_string()&&v.viewer==*viewer&&v.reachability==Reachability::AuthoredFixtureTrace&&v.history.iter().filter(|s|s.result.get("state").and_then(serde_json::Value::as_str)==Some("sent")).count()==committed){continue;}
            match policy_in(bound,inv,rows,viewer,None,row,e){Ok(false)=>{},Ok(true)=>continue,Err(why)=>{out.unsupported.insert(format!("{}: {why}",inv.target_label()));continue;}}
            let Ok(key)=row.field("id")else{continue;};
            if inv.column.as_ref().and_then(|c|bound.schema.tables[&inv.table].written_by.get(c)).is_some_and(|gate|!gate.audience&&row.field(&gate.owner).ok()!=Some(&Value::Id(viewer.clone()))){continue 'actors;}

            // A typed authored row return is already a payload witness. It does
            // not require an invalid absent world that deletes referenced data.
            for bp in queries.iter().copied().filter(|p|typed_source(&p.result,&inv.table)){
                let cases=fixture_cases(&bp.program.args,rows,actors,out);
                if cases.len()>32{out.unsupported.insert(format!("{}: typed read-observer arguments capped at 32",bp.program.name));}
                for args in cases.into_iter().take(32){
                    if !reserve_observers(out,2){return;}
                    let args=match materialize_arguments(e,&bp.program.args,&args,viewer){Ok(a)=>a,Err(why)=>{out.unsupported.insert(format!("{}: typed history observer asset/input preparation: {why}",bp.program.name));continue;}};
                    out.attempted+=1;
                    if let Ok(q)=e.query(&bp.program.name,Context::new(viewer,args.clone()).at(NOW))&&q.complete&&!q.unavailable&&typed_disclosure(&bp.result,&q.data,&inv.table,key,inv.column.as_deref(),row){
                        out.attempted+=1;
                        if !matches!(e.query(&bp.program.name,Context::new(viewer,args.clone()).at(NOW)),Ok(again) if again.complete&&!again.unavailable&&again.data==q.data){
                            out.unsupported.insert(format!("{}: typed read payload is not repeatable on the committed image",bp.program.name));continue;
                        }
                        violation(out,inv,steps,viewer,row,None,initial,if inv.column.is_some(){"column read observation"}else{"read"});
                        if let Some(v)=out.violations.last_mut(){v.operation=bp.program.name.clone();v.args=args;v.rule_path="authored query repeatably returned a compiler-typed row/column payload of the protected table while current policy is false".into();}
                        continue 'actors;
                    }
                }
            }
            if inv.column.as_deref().is_some_and(|c|c!="id"){continue 'actors;}
            if bound.schema.tables.values().any(|t|t.columns.values().any(|k|matches!(k.required(),C::Ref{table} if table==&inv.table))){out.unsupported.insert(format!("{}: history paired absence needs a referentially valid closure",inv.table));continue;}
            let Ok(id)=key.as_str()else{continue;};
            let mut absent=match fork(bound,e,Vec::new()){Ok(e)=>e,Err(why)=>{out.unsupported.insert(format!("{}: absent world fork: {why}",inv.table));continue;}};
            if let Err(why)=absent.seed_delete_at(&inv.table,id,NOW){out.unsupported.insert(format!("{}: absent world refused: {why}",inv.table));continue;}
            let absent_rows=match readback(&absent){Ok(r)=>r,Err(why)=>{out.unsupported.insert(format!("{}: absent world readback: {why}",inv.table));continue;}};
            if policy_in(bound,inv,&absent_rows,viewer,None,row,&mut absent)!=Ok(false){continue;}
            for bp in queries.iter().copied().filter(|p|observing.iter().any(|t|super::super::audit::mentions(&serde_json::to_value(&p.program).unwrap(),t))){
                let p=&bp.program;
                let cases=fixture_cases(&p.args,rows,actors,out);
                if cases.len()>32{out.unsupported.insert(format!("{}: read-observer arguments capped at 32; remaining combinations not covered",p.name));}
                for args in cases.into_iter().take(32){
                    if !reserve_observers(out,4){return;}
                    let raw_args=args;
                    let args=match materialize_arguments(e,&p.args,&raw_args,viewer){Ok(a)=>a,Err(why)=>{out.unsupported.insert(format!("{}: paired history observer asset/input preparation: {why}",p.name));continue;}};
                    if args!=raw_args{
                        absent=match fork(bound,e,Vec::new()){Ok(e)=>e,Err(why)=>{out.unsupported.insert(format!("{}: paired history argument ledger fork: {why}",p.name));continue;}};
                        if let Err(why)=absent.seed_delete_at(&inv.table,id,NOW){out.unsupported.insert(format!("{}: paired history argument ledger absence: {why}",p.name));continue;}
                        if readback(&absent)!=Ok(absent_rows.clone()){out.unsupported.insert(format!("{}: paired argument ledger changes the absent base world",p.name));continue;}
                    }
                    out.attempted+=2;
                    let (Ok(a),Ok(b))=(paired::observe(e,p,viewer,args.clone()),paired::observe(&mut absent,p,viewer,args.clone()))else{continue;};
                    if a==b{continue;}
                    if !matches!((paired::observe(e,p,viewer,args.clone()),paired::observe(&mut absent,p,viewer,args.clone())),(Ok(aa),Ok(bb)) if a==aa&&b==bb){out.unsupported.insert(format!("{} / {}: paired history observation is unstable or unavailable on repeat",p.name,inv.target_label()));continue;}
                    violation(out,inv,steps,viewer,row,None,initial,"read");
                    if let Some(v)=out.violations.last_mut(){v.operation=p.name.clone();v.args=args;v.observations=Some(paired::Observations{present:a,absent:b,absent_rows:absent_rows.clone()});}
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
fn changed(bound:&Bound,p:&Program,before:&BTreeMap<String,Vec<Value>>,after:&BTreeMap<String,Vec<Value>>,initial:&BTreeMap<String,Vec<Value>>,viewer:&str,steps:&[Step],prior:&mut Option<Engine>,current:&mut Engine,out:&mut Campaign){
    assertions(bound,before,after,initial,viewer,steps,prior,current,out);
    if !super::super::census::body(&p.body){out.unsupported.insert(format!("{}: loop/opaque write boundary requires executed-effect tracing",p.name));return;}
    for inv in &bound.invariants{
        if matches!(inv.target.as_str(),"read"|"always")||inv.operation.as_ref().is_some_and(|op|op!=&p.name){continue;}
        let judged;
        let inv=if inv.target=="always"{inv}else{
            let Some(stable)=stability::necessary(bound,p,inv)else{out.unsupported.insert(format!("{} / {}: unknown/implicit policy changes need executed-effect tracing",p.name,inv.target_label()));continue;};
            judged=stable;&judged
        };
        // A net image cannot identify an intermediate write or implicit effect.
        let writes=ir::write_tables(p).into_iter().filter(|(t,_)|t==&inv.table).collect::<Vec<_>>();
        if writes.len()!=1 {out.unsupported.insert(format!("{} / {}.{}: multiple or implicit writes require executed-effect tracing",p.name,inv.table,inv.target));continue;}
        if (inv.target=="delete"||inv.operation.is_some())&&writes[0].1!="delete"&&before.get(&inv.table).into_iter().flatten().any(|old|!after.get(&inv.table).into_iter().flatten().any(|r|r.field("id").ok()==old.field("id").ok())){out.unsupported.insert(format!("{}: commit-end/implicit retirement is not an executed delete",p.name));}
        if (inv.target=="delete"||inv.operation.is_some())&&writes[0].1=="delete"{
            for old in before.get(&inv.table).into_iter().flatten().filter(|old|!bound.schema.tables[&inv.table].expired(old,NOW)&&!after.get(&inv.table).into_iter().flatten().any(|r|r.field("id").ok()==old.field("id").ok())){
                let deps=inv.policy.as_ref().map(kernel::dependencies).unwrap_or_default();
                if ir::write_tables(p).iter().any(|(t,_)|deps.contains(t)&&t!=&inv.table){out.unsupported.insert(format!("{}: delete policy dependency changes before disclosure",p.name));continue;}
                if prior_policy(bound,inv,before,viewer,Some(old),old,prior)==Ok(false){violation(out,inv,steps,viewer,old,Some(old),initial,"delete");}
            }
        }
        for row in after.get(&inv.table).into_iter().flatten(){
            let old=before.get(&inv.table).into_iter().flatten().find(|r|r.field("id").ok()==row.field("id").ok()&&!bound.schema.tables[&inv.table].expired(r,NOW));
            if old==Some(row){continue;}
            let effect=if old.is_some(){"update"}else{"insert"};
            if !super::super::effects(inv).contains(&effect){continue;}
            if inv.column.as_ref().is_some_and(|c|old.is_some_and(|o|o.field(c).ok()==row.field(c).ok())){continue;}
            if inv.target=="always" {
                if policy_in(bound,inv,after,viewer,old,row,current)==Ok(false){violation(out,inv,steps,viewer,row,old,initial,effect);}
            }else{
                let deps=inv.policy.as_ref().map(kernel::dependencies).unwrap_or_default();
                if ir::write_tables(p).iter().any(|(t,_)|deps.contains(t)&&t!=&inv.table) {out.unsupported.insert(format!("{}: write policy dependency changes within the operation; tracing required",p.name));continue;}
                if prior_policy(bound,inv,before,viewer,old,row,prior)==Ok(false)||old.is_some_and(|old|prior_policy(bound,inv,before,viewer,Some(old),old,prior)==Ok(false)){
                    violation(out,inv,steps,viewer,row,old,initial,effect);
                }
            }
        }
    }
}
fn role_candidates<'a>(bound:&Bound,p:&'a Program,initial:&BTreeMap<String,Vec<Value>>,actors:&[String],cases:&[BTreeMap<String,Value>],fixture:&Engine)->Vec<(&'a Program,String,BTreeMap<String,Value>)>{
    let mut out=Vec::new();let mut groups=Vec::new();
    let json=serde_json::to_string(p).unwrap();
    let Ok(mut judge)=fork(bound,fixture,Vec::new())else{return out;};
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
                if !targets.contains(&args){targets.push(args);}
            }
            let mut row_cases=Vec::new();
            for actor in actors{
                let owner=columns.iter().filter_map(|c|t.written_by.get(c)).any(|a|row.field(&a.owner).ok()==Some(&Value::Id(actor.clone())));
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
pub(super) fn run(bound:&Bound,fixture:&Engine,out:&mut Campaign){
    if bound.invariants.is_empty(){return;}
    let initial=match readback(fixture){Ok(r)=>r,Err(e)=>{out.unsupported.insert(e);return;}};
    if initial.values().all(Vec::is_empty){out.unsupported.insert("history needs a trusted fixture; generated snapshots have separate reachability labels".into());return;}
    if initial.values().map(Vec::len).sum::<usize>()>1000{out.unsupported.insert("history fixture exceeds 1000 rows".into());return;}
    let actors=actors(bound,&initial);
    let probes=Vec::new();
    let mut groups=Vec::new();
    for bp in bound.programs.iter().filter(|p|p.program.kind==ProgramKind::Mutation&&!p.program.native){
        let cases=fixture_cases(&bp.program.args,&initial,&actors,out);
        let mut group=role_candidates(bound,&bp.program,&initial,&actors,&cases,fixture);
        // Diagonal order gives both actors and argument values an early turn.
        for shift in 0..actors.len(){for n in 0..cases.len().max(actors.len()){
            if cases.is_empty(){break;}
            group.push((&bp.program,actors[(n+shift)%actors.len()].clone(),cases[n%cases.len()].clone()));
        }}
        if !group.is_empty(){groups.push(group);}
    }
    let mut candidates=Vec::new();
    for n in 0..groups.iter().map(Vec::len).max().unwrap_or(0){for g in &groups{if let Some(c)=g.get(n){candidates.push(c.clone());}}}
    let mut base=match fork(bound,fixture,probes.clone()){Ok(e)=>e,Err(e)=>{out.unsupported.insert(e);return;}};
    for inv in bound.invariants.iter().filter(|i|i.target=="always"){
        for row in initial.get(&inv.table).into_iter().flatten(){for viewer in &actors{
            if policy_in(bound,inv,&initial,viewer,None,row,&mut base)!=Ok(false){continue;}
            let mut witness=Campaign::default();violation(&mut witness,inv,&[],viewer,row,None,&initial,"always");
            if let Some(mut v)=witness.violations.pop(){v.reachability=Reachability::TrustedSeedOnly;v.operation="$fixture.assertion".into();v.rule_path="initial trusted fixture assertion; no authored mutation".into();v.scope="definite violation in trusted seed; no authored transition claimed; non-failing supplemental evidence".into();out.violations.push(v);}break;
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
    let singles=candidates.len().min(LIMIT);
    let mut setups=Vec::new();let mut role_changes=Vec::new();
    let mut setup_seen=BTreeSet::new();let mut role_seen=BTreeSet::new();let mut pair_plan=Vec::new();
    for n in 0..singles+LIMIT {
        if n==singles&&!candidates.is_empty(){
            let mut seen=BTreeSet::new();
            'setup:for &second in &role_changes{for &first in &setups{if seen.insert((first,second)){pair_plan.push((first,second));if pair_plan.len()==LIMIT/2{break 'setup;}}}}
            for &(first,second) in &role_pairs{if pair_plan.len()==LIMIT{break;}if seen.insert((first,second)){pair_plan.push((first,second));}}
            let mut k=0;
            while pair_plan.len()<LIMIT{pair_plan.push((k%candidates.len(),(k/candidates.len()+k+1)%candidates.len()));k+=1;}
        }
        let indices=if n<singles{vec![n]}else if candidates.is_empty(){break;}else{let (first,second)=pair_plan[n-singles];vec![first,second]};
        let mut engine=match fork(bound,fixture,probes.clone()){Ok(e)=>e,Err(e)=>{out.unsupported.insert(e);break;}};
        out.sequences+=1;let mut steps=Vec::new();
        for i in indices{
            let (p,viewer,args)=&candidates[i];let before=match readback(&engine){Ok(r)=>r,Err(e)=>{out.unsupported.insert(e);break;}};
            let args=match materialize_arguments(&mut engine,&p.args,args,viewer){Ok(a)=>a,Err(why)=>{out.unsupported.insert(format!("{}: history asset arguments: {why}",p.name));break;}};
            let mut prior=if bound.invariants.iter().any(|i|i.target!="read"&&i.policy.as_ref().is_some_and(RuleExpr::has_reference)){match fork(bound,&engine,Vec::new()){Ok(e)=>Some(e),Err(why)=>{out.unsupported.insert(why);None}}}else{None};
            out.attempted+=1;*out.operations.entry(p.name.clone()).or_default()+=1;
            match engine.mutate(&p.name,None,Context::new(viewer,args.clone()).at(NOW)){
                Ok(result)=>{
                    let sent=matches!(result.state,snapback4_core::WriteState::Sent{..});
                    steps.push(Step{operation:p.name.clone(),viewer:viewer.clone(),args:args.clone(),result:serde_json::to_value(&result.state).unwrap()});
                    let after=match readback(&engine){Ok(r)=>r,Err(e)=>{out.unsupported.insert(e);break;}};
                    if sent&&n<singles{
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
                    if sent{changed(bound,p,&before,&after,&initial,viewer,&steps,&mut prior,&mut engine,out);}else{out.refused+=1;}
                    if sent&&before!=after{observe(bound,&mut engine,&after,&initial,&actors,&steps,out);column_reads::after_history(bound,&engine,&initial,&steps,out);}
                },Err(e)=>{out.unsupported.insert(format!("{}: history engine error {e}",p.name));break;}
            }
        }
    }
    out.unsupported.insert("history breadth/pairs bounded to 512; unvisited and longer traces remain uncovered".into());
}
