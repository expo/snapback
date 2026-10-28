//! Focused continuations: repeat a creator, or change an ancestor then create.
// @ref LLP 3000.036.004.000#10-sec10-approvals-and-deterministic-exploration — actual authored replay, never a synthetic reachability assumption.
use super::*;
fn reference(kind:&ir::ArgType)->Option<&String>{match kind{ir::ArgType::Ref{table}=>Some(table),ir::ArgType::Optional(inner)=>reference(inner),_=>None}}
fn closure(bound:&Bound,rows:&BTreeMap<String,Vec<Value>>,table:&str,id:&Value,out:&mut BTreeMap<String,Vec<Value>>,depth:usize){
    if depth>4||out.get(table).is_some_and(|ids|ids.contains(id)){return;}
    out.entry(table.into()).or_default().push(id.clone());
    if let Some(row)=rows.get(table).into_iter().flatten().find(|r|r.field("id").ok()==Some(id)){
        for (c,k) in &bound.schema.tables[table].columns{if let C::Ref{table}=k.required()&&let Ok(id)=row.field(c)&&*id!=Value::Null{closure(bound,rows,table,id,out,depth+1);}}
    }
}
fn actors_for(bound:&Bound,p:&Program,rows:&BTreeMap<String,Vec<Value>>,engine:&Engine,campaign:&mut Campaign)->Vec<String>{
    let mut out=Vec::new();let mut classes=BTreeSet::new();
    let Ok(mut judge)=engine.fork_fixture()else{return out;};
    for actor in histories::actors(bound,rows){
        let eligible=ir::write_tables(p).iter().any(|(t,kind)|{
            if !bound.schema.tables[t].written_by.is_empty(){return true;}
            let gate=if *kind=="insert"{&bound.schema.tables[t].rules.insert}else{&bound.schema.tables[t].rules.update};
            if !gate.any_term(&|term|!matches!(term,RuleTerm::Viewer|RuleTerm::Literal(_))){return !matches!(judge.fixture_policy(gate,&actor,None,&Value::Null,NOW),Ok(rules::Verdict::Denied));}
            true
        });if !eligible{continue;}
        let mut class=Vec::new();
        for (table,rs) in rows {for row in rs {
            if !bound.schema.tables[table].columns.iter().any(|(c,k)|matches!(k.required(),C::Principal)&&row.field(c).ok()==Some(&Value::Id(actor.clone()))){continue;}
            for column in super::super::privilege::role_columns(bound,table){if let Ok(value)=row.field(&column){class.push(format!("{table}.{column}={value:?}"));}}
        }}
        if classes.insert((class,actor.starts_with("service:"))){out.push(actor);}else{campaign.unsupported.insert(format!("{}: focused workflow actor classes merge same-role candidates; actor-specific continuations remain uncovered",p.name));}
        if out.len()==8{campaign.unsupported.insert(format!("{}: focused workflow actor candidates capped at eight; remaining actors uncovered",p.name));break;}
    }out
}
fn attempt(bound:&Bound,base:&Engine,p:&Program,args:&BTreeMap<String,Value>,viewer:&str,initial:&BTreeMap<String,Vec<Value>>,steps:&[histories::Step],out:&mut Campaign)->Option<(Engine,Vec<histories::Step>)>{
    if out.workflow_attempts>=out.workflow_base.saturating_add(512){out.unsupported.insert("focused workflow continuations capped at 512 calls; remaining repeated/dependency histories uncovered".into());return None;}if !out.reserve(1){return None;}out.workflow_attempts+=1;
    let mut engine=base.fork_fixture().ok()?;
    let args=materialize_arguments(&mut engine,&p.args,args,viewer).ok()?;
    let trace=executed::trace(bound,p,&engine);out.attempted+=1;*out.operations.entry(p.name.clone()).or_default()+=1;
    let result=engine.mutate(&p.name,None,replay_ids::context(viewer,args.clone()).at(histories::history_clock(steps)).with_fixture_trace(trace.clone())).ok()?;
    if !matches!(result.state,snapback4_core::WriteState::Sent{..}){out.refused+=1;return None;}
    let mut history=steps.to_vec();history.push(histories::Step{observed_data:None,clock:Some(histories::history_clock(steps)),operation:p.name.clone(),viewer:viewer.into(),args,result:serde_json::to_value(&result.state).ok()?});
    let before=readback(base).ok()?;let after=readback(&engine).ok()?;histories::assertions(bound,&before,&after,initial,viewer,&history,&mut None,&mut engine,out);executed::record(bound,p,&trace,&result.state,&after,initial,viewer,&history,&mut engine,out);
    Some((engine,history))
}
// Try each candidate-producing operation before prerequisite expansion.
// Every failure below still comes from the normal committed trace observer.
pub(super) fn direct(bound:&Bound,base:&Engine,initial:&BTreeMap<String,Vec<Value>>,out:&mut Campaign){
 let actors=histories::actors(bound,initial);
 for p in bound.programs.iter().map(|b|&b.program).filter(|p|p.kind==ProgramKind::Mutation&&!p.native){
  let targets=ir::write_tables(p);
  if !bound.invariants.iter().any(|i|targets.iter().any(|(table,kind)|table==&i.table&&(i.target=="always"||i.target=="write"||i.operation.as_deref()==Some(p.name.as_str())||i.target==*kind||i.target=="update"&&*kind=="upsert"))){continue;}
  let candidates=histories::fixture_cases(bound,p,initial,&actors,out);
  let eligible=actors_for(bound,p,initial,base,out);
  if candidates.len()>8{out.unsupported.insert(format!("{}: direct derived tuples capped at eight; remaining combinations uncovered",p.name));}
  for args in candidates.into_iter().take(8){for viewer in &eligible{
   let _=attempt(bound,base,p,&args,viewer,initial,&[],out);
   if out.exhausted(){return;}
  }}
 }
}
pub(super) fn run(bound:&Bound,base:&Engine,initial:&BTreeMap<String,Vec<Value>>,steps:&[histories::Step],changed:&BTreeSet<String>,out:&mut Campaign){
    if out.workflow_attempts>=out.workflow_base.saturating_add(512){out.unsupported.insert("focused workflow continuations capped at 512 calls; remaining repeated/dependency histories uncovered".into());return;}if out.exhausted(){return;}
    let Ok(rows)=readback(base)else{return;};
    let goals=bound.invariants.iter().filter(|i|super::super::derived::is_derived(i)&&i.target=="insert").map(|i|i.table.clone()).collect::<BTreeSet<_>>();
    let mut predicate_columns=BTreeSet::new();
    for inv in bound.invariants.iter().filter(|i|goals.contains(&i.table)){if let Some(mut syntax)=inv.syntax.clone(){crate::bind::intent_walk::expression(&mut syntax,&mut |e|if let ast::Expr::Member{name,..}=e{predicate_columns.insert(name.clone());});}}
    'producers: for p in bound.programs.iter().map(|b|&b.program).filter(|p|p.kind==ProgramKind::Mutation&&!p.native&&ir::write_tables(p).iter().any(|(t,k)|goals.contains(t)&&matches!(*k,"insert"|"upsert"))){
        let reads_approval=ir::read_sites(p).iter().any(|read|["approv","authoriz"].iter().any(|part|read.table.to_lowercase().contains(part)));
        let retry=ir::write_tables(p).iter().any(|(table,_)|bound.invariants.iter().any(|i|i.table==*table&&i.site.file.contains("repeat-create")));
        let approval_question=bound.invariants.iter().any(|i|i.site.file.contains("/sec11-approval-")&&i.operation.as_deref()==Some(p.name.as_str()));
        if reads_approval&&!retry&&!approval_question{out.unsupported.insert(format!("{}: focused continuations defer approval-reading origins to the general campaign",p.name));continue;}
        let principal_history=bound.invariants.iter().any(|inv|inv.site.file.contains("approval-history")&&goals.contains(&inv.table)&&changed.contains(&inv.table)&&p.args.iter().any(|(name,kind)|matches!(kind,ir::ArgType::Principal)&&matches!(bound.schema.tables[&inv.table].columns.get(name).map(C::required),Some(C::Principal))));
        if !principal_history&&!p.args.values().any(|k|reference(k).is_some_and(|table|changed.contains(table)))&&!approval_question{continue;}
        let actors=actors_for(bound,p,&rows,base,out);
        let mut cases=histories::fixture_cases(bound,p,&rows,&actors,out);
        if principal_history{let mut focused=Vec::new();for table in goals.iter().filter(|table|changed.contains(*table)){for row in rows.get(table).into_iter().flatten(){if let Some(base)=cases.first(){let mut args=base.clone();for (name,kind) in &p.args{if matches!(kind,ir::ArgType::Principal)&&matches!(bound.schema.tables[table].columns.get(name).map(C::required),Some(C::Principal))&&let Ok(value)=row.field(name){args.insert(name.clone(),value.clone());}}if !focused.contains(&args){focused.push(args);}}}}for args in cases{if !focused.contains(&args){focused.push(args);}}cases=focused;}
        if cases.len()>8{out.unsupported.insert(format!("{}: focused creator tuples capped at eight; remaining combinations uncovered",p.name));}
        for args in cases.into_iter().take(8){
            let mut relatives=BTreeMap::new();for (name,k) in &p.args{if let Some(table)=reference(k)&&let Some(id)=args.get(name)&&*id!=Value::Null{closure(bound,&rows,table,id,&mut relatives,0);}}
            if principal_history{for (name,kind) in &p.args{if !matches!(kind,ir::ArgType::Principal){continue;}for table in goals.iter().filter(|table|changed.contains(*table)){if !matches!(bound.schema.tables[table].columns.get(name).map(C::required),Some(C::Principal)){continue;}for row in rows.get(table).into_iter().flatten().filter(|row|row.field(name).ok()==args.get(name)){if let Ok(id)=row.field("id"){closure(bound,&rows,table,id,&mut relatives,0);}}}}}
            if relatives.is_empty(){continue;}
            let remaining=bound.invariants.iter().filter(|i|i.target=="insert"&&super::super::derived::is_derived(i)&&goals.contains(&i.table)&&(i.operation.as_ref().is_none_or(|op|op==&p.name))&&(!i.site.file.contains("repeat-create")||p.args.values().any(|kind|matches!(kind,ir::ArgType::Ref{table} if table==&i.table))||ir::read_sites(p).iter().any(|read|read.table==i.table))&&!out.violations.iter().any(|v|v.invariant_site==i.site.to_string()&&v.operation==p.name&&v.reachability.is_reachable())).collect::<Vec<_>>();
            if remaining.is_empty(){continue 'producers;}
            if remaining.iter().all(|inv|inv.site.file.contains("approval-history")){
                let prospective=remaining.iter().any(|inv|{
                    let mut fields=BTreeMap::new();for (name,kind) in &p.args{if matches!(kind,ir::ArgType::Ref{table} if table==&inv.table)&&let Some(old)=rows.get(&inv.table).into_iter().flatten().find(|row|row.field("id").ok()==args.get(name)){for column in bound.schema.tables[&inv.table].columns.keys(){if let Ok(value)=old.field(column){fields.insert(column.clone(),value.clone());}}}}
                    for (name,value) in &args{if bound.schema.tables[&inv.table].columns.contains_key(name){fields.insert(name.clone(),value.clone());}}
                    inv.syntax.as_ref().is_some_and(|predicate|super::super::concrete::evaluate(predicate,&Value::Row(fields.into()),&rows,&bound.schema,"service:security",&inv.table,histories::history_clock(steps))==Some(false))
                });
                if !prospective{out.unsupported.insert(format!("{}: focused approval-history proposals defer unresolved or currently satisfied identity tuples to general histories",p.name));continue;}
            }
            for viewer in &actors{
                // Re-upload raw media markers on each actual create. Reusing
                // a placed upload would test asset custody instead of consent.
                if let Some((once,history))=attempt(bound,base,p,&args,viewer,initial,steps,out){
                    let _=attempt(bound,&once,p,&args,viewer,initial,&history,out);
                }
            }
            // A self-referencing retry needs the same admitted creator twice;
            // ordinary lifecycle exploration supplies its source stage. Do not
            // spend its pair budget preparing unrelated stages of that row.
            if p.args.values().any(|kind|matches!(kind,ir::ArgType::Ref{table} if ir::write_tables(p).iter().any(|(target,effect)|target==table&&matches!(*effect,"insert"|"upsert")))){out.unsupported.insert(format!("{}: focused self-retries defer other dependency-change combinations to the general campaign",p.name));continue;}
            // The origin already reads the approval. Give sibling creators
            // without that prerequisite the dependency-change pair budget.
            if ir::read_sites(p).iter().any(|read|["approv","authoriz"].iter().any(|part|read.table.to_lowercase().contains(part))){out.unsupported.insert(format!("{}: focused dependency pairs defer approval-reading origins to the general campaign",p.name));continue;}
            for q in bound.programs.iter().map(|b|&b.program).filter(|q|q.kind==ProgramKind::Mutation&&!q.native&&ir::write_tables(q).iter().any(|(t,k)|relatives.contains_key(t)&&matches!(*k,"update"|"upsert"))&&predicate_columns.iter().any(|c|serde_json::to_string(q).unwrap().contains(&format!("\"{c}\":")))){
                let candidates=actors_for(bound,q,&rows,base,out);let cases=histories::fixture_cases(bound,q,&rows,&candidates,out);
                if cases.len()>4{out.unsupported.insert(format!("{}: focused dependency tuples capped at four; remaining combinations uncovered",q.name));}
                for mut setup in cases.into_iter().take(4){
                    for (name,k) in &q.args{if let ir::ArgType::Ref{table}=k&&let Some(id)=relatives.get(table).and_then(|ids|ids.first()){setup.insert(name.clone(),id.clone());}}
                    for actor in &candidates{if let Some((prepared,history))=attempt(bound,base,q,&setup,actor,initial,steps,out){
                        for viewer in &actors{let _=attempt(bound,&prepared,p,&args,viewer,initial,&history,out);}
                    }}
                }
            }
            if out.workflow_attempts>=out.workflow_base.saturating_add(512)||out.exhausted(){out.unsupported.insert("focused workflow continuations capped at 512 calls; remaining repeated/dependency histories uncovered".into());return;}
        }
    }
}

#[cfg(test)]mod tests{use super::*;
fn row(b:&Bound,table:&str,json:serde_json::Value)->Value{snapback4_core::wire::row_from_json(&b.schema.tables[table],&json).unwrap()}
#[test]fn retry_same_failed_parent_observes_the_second_create(){
    let source=include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/wave26/025.q"));let sources=vec![("schema.q".into(),source.into())];let b=crate::compile(&sources);let mut b=super::super::super::derived::augmented(&sources,&b);b.invariants.retain(|i|i.site.file.contains("repeat-create"));
    let mut e=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
    let photo=e.store_asset("service:registrar",&PNG,NOW).unwrap().column_value();
    let mut exam=match row(&b,"exams",serde_json::json!({"id":"exam","candidate":"account:student","status":"failed","feeCents":8000,"attemptNo":1,"createdAt":NOW,"failedAt":NOW})){Value::Map(m)=>Value::Row(m.into()),v=>v};
    if let Value::Row(fields)=&mut exam{fields.insert("photo".into(),photo);}
    e.seed_at([("roles".into(),row(&b,"roles",serde_json::json!({"id":"role","principal":"service:registrar","role":"registrar"}))),("exams".into(),exam)],NOW).unwrap();
    let initial=readback(&e).unwrap();let p=&b.programs.iter().find(|p|p.program.name=="retest").unwrap().program;
    let args=BTreeMap::from([("priorExam".into(),Value::Id("exam".into())),("feeCents".into(),Value::Int(4000)),("photo".into(),Value::String("$security:image".into()))]);let mut out=Campaign::default();
    let (once,history)=attempt(&b,&e,p,&args,"service:registrar",&initial,&[],&mut out).expect("first retry admitted");
    let _=attempt(&b,&once,p,&args,"service:registrar",&initial,&history,&mut out).expect("second retry admitted");
    assert!(!out.violations.is_empty(),"{out:?}");
}
#[test]fn approval_history_is_judged_on_the_actual_new_attempt(){
    let source=include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/wave26/025.q"));let sources=vec![("schema.q".into(),source.into())];let b=crate::compile(&sources);let b=super::super::super::derived::augmented(&sources,&b);
    let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
    let role=row(&b,"roles",serde_json::json!({"id":"role","principal":"service:registrar","role":"registrar"}));engine.seed_at([("roles".into(),role)],NOW).unwrap();
    for (id,number) in [("older",2),("prior",1)]{let photo=engine.store_asset("service:registrar",&PNG,NOW).unwrap().column_value();let mut exam=match row(&b,"exams",serde_json::json!({"id":id,"candidate":"account:student","status":"failed","feeCents":8000,"attemptNo":number,"createdAt":NOW,"failedAt":NOW})){Value::Map(m)=>Value::Row(m.into()),v=>v};if let Value::Row(fields)=&mut exam{fields.insert("photo".into(),photo.clone());}engine.seed_at([("exams".into(),exam)],NOW).unwrap();}
    let initial=readback(&engine).unwrap();let p=&b.programs.iter().find(|p|p.program.name=="retest").unwrap().program;let args=BTreeMap::from([("priorExam".into(),Value::Id("prior".into())),("feeCents".into(),Value::Int(4000)),("photo".into(),Value::String("$security:image".into()))]);let mut campaign=Campaign::default();let _=attempt(&b,&engine,p,&args,"service:registrar",&initial,&[],&mut campaign).expect("authored retry committed");assert!(campaign.violations.iter().any(|v|v.invariant_site.contains("approval-history")),"{:?}",campaign.unsupported);run(&b,&engine,&initial,&[],&BTreeSet::from(["exams".into()]),&mut campaign);assert!(campaign.violations.iter().any(|v|v.operation=="logExam"&&v.invariant_site.contains("approval-history")),"sibling producer was pruned: {:?}",campaign.unsupported);let p=&b.programs.iter().find(|p|p.program.name=="logExam").unwrap().program;let args=BTreeMap::from([("candidate".into(),Value::Id("account:student".into())),("feeCents".into(),Value::Int(8000)),("photo".into(),Value::String("$security:image".into()))]);let mut campaign=Campaign::default();let _=attempt(&b,&engine,p,&args,"service:registrar",&initial,&[],&mut campaign).expect("authored fresh attempt committed");assert!(campaign.violations.iter().any(|v|v.operation=="logExam"&&v.invariant_site.contains("approval-history")),"{:?}",campaign.unsupported);
}

}
