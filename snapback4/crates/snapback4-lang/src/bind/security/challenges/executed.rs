//! Authored write boundaries and compiler-typed committed mutation payloads.
// @ref LLP 3000.036.004#151-every-executed-write — no net-image inference for intermediate writes.
use super::*;
use snapback4_core::engine::fixture_trace::{Trace,Intent};
fn provisioning(p:&Program)->bool {p.name.rsplit('.').next()==Some("provision")}
// @ref LLP 3000.036.004.000#9-integration-24-wave-26-precision — exempt only an exact executed provision image, never a returned preimage.
const PROVISION_RESULT:&str="$security.provision-result/";
type ApprovedInputs=BTreeMap<(String,String),BTreeSet<String>>;
fn approved_inputs(bound:&Bound)->ApprovedInputs{
    let mut inputs=bound.security_approval_inputs.clone();
    for (table,t) in bound.schema.visible_tables(){for (column,kind) in &t.columns{if ["approv","authoriz"].iter().any(|part|column.to_lowercase().contains(part))&&matches!(kind.required(),C::Bool|C::Time){inputs.entry((table.clone(),column.clone())).or_default();}}}inputs
}
fn cell(row:&Value,column:&str)->Value{row.field(column).cloned().unwrap_or(Value::Null)}
fn put(row:&mut Value,column:&str,value:Value){match row{Value::Row(fields)=>{fields.insert(column.into(),value);},Value::Map(fields)=>{fields.insert(column.into(),value);},_=>{}}}
fn prerequisite_image(old:&Value,next:&Value,schema:&Schema,table:&str,inputs:&ApprovedInputs)->Value{
    let mut image=old.clone();
    for (column,kind) in &schema.tables[table].columns{if matches!(kind.required(),C::Ref{..}|C::Principal){put(&mut image,column,cell(next,column));}}
    for ((owner,approval),columns) in inputs{if owner==table&&columns.iter().any(|column|cell(old,column)!=cell(next,column)){put(&mut image,approval,cell(next,approval));}}
    image
}
// @ref LLP 3000.036.004.000#10-sec10-approvals-and-deterministic-exploration — reconstruct only actual valid consumed stamps; retain the original prerequisite.
type ReceiptKey=(String,String,String);
#[derive(Clone)]struct Receipt{stamp:Value,inputs:BTreeMap<String,Value>}
type Receipts=BTreeMap<ReceiptKey,Receipt>;
fn positive(value:&Value)->bool{matches!(value,Value::Bool(true)|Value::Int(_))}
fn receipt(table:&str,row:&Value,stamp:&str,columns:&BTreeSet<String>)->Option<(ReceiptKey,Receipt)>{
    let Value::Id(id)=row.field("id").ok()? else{return None;};let value=cell(row,stamp);if !positive(&value){return None;}
    Some(((table.into(),id.clone(),stamp.into()),Receipt{stamp:value,inputs:columns.iter().map(|column|(column.clone(),cell(row,column))).collect()}))
}
fn consumed(predicate:&ast::Expr,row:&Value,effective:&Value,rows:&BTreeMap<String,Vec<Value>>,entry:&BTreeMap<String,Vec<Value>>,schema:&Schema,viewer:&str,table:&str,now:i64,receipts:&Receipts)->Option<bool>{
    let actual=|owner:&str,id:&str|{
        if owner==table&&effective.field("id").ok()==Some(&Value::Id(id.into())){Some(effective)}else{rows.get(owner).into_iter().flatten().find(|r|r.field("id").ok()==Some(&Value::Id(id.into())))}
    };
    // Restore consumed stamps only. Ordinary predicates and complete lookup /
    // filter trees run unchanged on their actual pre-effect data. Dependencies
    // between consumed stamps are validated together; one invalidated receipt
    // removes every receipt that depended on it.
    let mut valid=receipts.iter().filter(|((owner,id,stamp),_)|actual(owner,id).is_some_and(|r|matches!(cell(r,stamp),Value::Null|Value::Bool(false)))).map(|(key,_)|key.clone()).collect::<BTreeSet<_>>();
    loop{
        let invalid=valid.iter().filter(|(owner,id,stamp)|{
            let current=actual(owner,id).unwrap();receipts[&(owner.clone(),id.clone(),stamp.clone())].inputs.iter().any(|(column,before)|{
                let key=(owner.clone(),id.clone(),column.clone());let after=if valid.contains(&key){receipts[&key].stamp.clone()}else{cell(current,column)};*before!=after
            })
        }).cloned().collect::<Vec<_>>();
        if invalid.is_empty(){break;}for key in invalid{valid.remove(&key);}
    }
    let mut shadow=rows.clone();let mut image=row.clone();
    if let Some(current)=shadow.get_mut(table).into_iter().flatten().find(|r|r.field("id").ok()==image.field("id").ok()){*current=image.clone();}
    for key in valid{let (owner,id,stamp)=&key;let value=receipts[&key].stamp.clone();
        if let Some(current)=shadow.get_mut(owner).into_iter().flatten().find(|r|r.field("id").ok()==Some(&Value::Id(id.clone()))){put(current,stamp,value.clone());}
        if owner==table&&image.field("id").ok()==Some(&Value::Id(id.clone())){put(&mut image,stamp,value);}
    }
    let verdict=super::super::concrete::evaluate(predicate,&image,&shadow,schema,viewer,table,now);
    if verdict==Some(false){
        // A deleted approval record has no current input image with which to
        // establish consumption. Keep that existing ambiguity explicit.
        for receipt in super::super::derived::approval_receipts(predicate){if let ast::Expr::Exists{read,..}=receipt{
            if super::super::concrete::evaluate(&ast::Expr::Exists{read:read.clone(),site:Site::default()},row,entry,schema,viewer,table,now)!=Some(true){continue;}
            if let Some(Value::Array(prior))=super::super::concrete::value(&ast::Expr::Read(read.clone()),row,entry,schema,viewer,table,now)&&prior.iter().any(|old|!rows.get(&read.table).into_iter().flatten().any(|current|current.field("id").ok()==old.field("id").ok())){return None;}
        }}
    }verdict
}
pub(super) fn trace(bound:&Bound,p:&Program,entry:&Engine)->Trace {
    let entry=if bound.invariants.iter().any(|i|i.site.file.contains("/sibling-approval/")){readback(entry).ok().map(std::sync::Arc::new)}else{None};
    let inputs=std::sync::Arc::new(approved_inputs(bound));
    let mut initial=Receipts::new();if let Some(entry)=&entry{for ((owner,stamp),columns) in inputs.iter(){for row in entry.get(owner).into_iter().flatten(){if let Some((key,value))=receipt(owner,row,stamp,columns){initial.insert(key,value);}}}}
    let receipts=std::sync::Arc::new(std::sync::Mutex::new(initial));
    let mut intents=Vec::new();
    if entry.is_some(){for ((owner,stamp),columns) in inputs.iter(){let owner=owner.clone();let stamp=stamp.clone();let columns=columns.clone();let receipts=receipts.clone();let target=owner.clone();let column=stamp.clone();
        intents.push(Intent{paired:false,concrete:None,site:"$security.approval-receipt".into(),table:target,effects:vec![Effect::Insert,Effect::Update],column:Some(column),policy:RuleExpr::Allow,
            boundary:Some(snapback4_core::engine::fixture_trace::BoundaryPredicate(std::sync::Arc::new(move |_,_,next,_,_|{if let Some(next)=next&&let Some((key,value))=receipt(&owner,next,&stamp,&columns){receipts.lock().expect("approval receipt lock").insert(key,value);}Some(true)})))});
    }}
    for inv in bound.invariants.iter().filter(|inv|!matches!(inv.target.as_str(),"read"|"always")&&inv.operation.as_ref().is_none_or(|op|op==&p.name)) {
        for word in super::super::effects(inv) {
            let transition=super::super::derived::transition(inv);
            let boundary=transition.map(|(bypass,prerequisite)|{
                let bypass=bypass.clone();let prerequisite=prerequisite.clone();let schema=bound.schema.clone();let table=inv.table.clone();let entry=if inv.site.file.contains("/sibling-approval/"){entry.clone()}else{None};let inputs=inputs.clone();let receipts=receipts.clone();let sibling=inv.site.file.contains("/sibling-approval/");
                snapback4_core::engine::fixture_trace::BoundaryPredicate(std::sync::Arc::new(move |rows,old,next,viewer,now|{
                    let (Some(old),Some(next))=(old,next)else{return None;};
                    match super::super::concrete::evaluate(&bypass,next,rows,&schema,viewer,&table,now){
                        Some(true)=>Some(true),Some(false)=>{
                            let image=if sibling{prerequisite_image(old,next,&schema,&table,&inputs)}else{old.clone()};
                            let current=super::super::concrete::evaluate(&prerequisite,&image,rows,&schema,viewer,&table,now);
                            if current==Some(true){return current;}
                            let prior=entry.as_ref().map(|entry|consumed(&prerequisite,&image,next,rows,entry,&schema,viewer,&table,now,&receipts.lock().expect("approval receipt lock")));
                            match prior{Some(Some(true))=>Some(true),Some(None)=>None,_=>current}
                        },None=>None,
                    }
                }))
            }).or_else(||if inv.site.file.contains("/sibling-approval/")&&word=="insert"{
                let predicate=inv.syntax.clone()?;let schema=bound.schema.clone();let table=inv.table.clone();let entry=entry.clone();let receipts=receipts.clone();
                Some(snapback4_core::engine::fixture_trace::BoundaryPredicate(std::sync::Arc::new(move |rows,_old,next,viewer,now|{
                    let row=next?;let current=super::super::concrete::evaluate(&predicate,row,rows,&schema,viewer,&table,now);
                    if current==Some(true){return current;}
                    let prior=entry.as_ref().map(|entry|consumed(&predicate,row,row,rows,entry,&schema,viewer,&table,now,&receipts.lock().expect("approval receipt lock")));
                    match prior{Some(Some(true))=>Some(true),Some(None)=>None,_=>current}
                })))
            }else if inv.site.file.contains("/parent-state/"){
                let predicate=inv.syntax.clone()?;let schema=bound.schema.clone();let table=inv.table.clone();
                let mut references=BTreeSet::new();let mut probe=predicate.clone();crate::bind::intent_walk::expression(&mut probe,&mut |e|if let ast::Expr::Member{base,name,..}=e&&matches!(base.as_ref(),ast::Expr::Focal{..})&&matches!(schema.tables[&table].columns.get(name).map(C::required),Some(C::Ref{..})){references.insert(name.clone());});
                Some(snapback4_core::engine::fixture_trace::BoundaryPredicate(std::sync::Arc::new(move |rows,old,next,viewer,now|{
                    let old=old?;let row=if let Some(next)=next&&references.iter().any(|reference|next.field(reference).ok().is_some_and(|id|*id!=Value::Null&&old.field(reference).ok()!=Some(id))){next}else{old};
                    super::super::concrete::evaluate(&predicate,row,rows,&schema,viewer,&table,now)
                })))
            }else{None});
            let concrete=if boundary.is_none()&&inv.policy.is_none(){inv.syntax.clone().map(|syntax|{
                let bound=bound.clone();let inv=inv.clone();let insert=word=="insert";
                snapback4_core::engine::fixture_trace::ConcretePredicate(std::sync::Arc::new(move |rows,row,viewer,now|{
                    if insert&&super::super::write_intent::empty_creation(&bound,&inv,None,row){return Some(true);}
                    super::super::concrete::evaluate(&syntax,row,rows,&bound.schema,viewer,&inv.table,now)
                }))
            })}else{None};
            intents.push(Intent {
                paired:super::super::derived::is_derived(inv)&&inv.policy.as_ref().is_some_and(|r|r.any_term(&|t|matches!(t,RuleTerm::OldField(_)|RuleTerm::NextField(_)))),
                boundary,concrete,site:inv.site.to_string(),table:inv.table.clone(),column:inv.column.clone(),
                policy:super::super::write_intent::policy(bound,inv,word).unwrap_or(RuleExpr::Allow),
                effects:vec![super::super::effect(word)],
            });
        }
    }
    // A private executed-write witness exempts only the operator provisioner's
    // own roster result. It never exempts an ordinary query or a different row.
    if provisioning(p){for table in ir::write_tables(p).into_iter().map(|(table,_)|table).collect::<BTreeSet<_>>() {
        if super::super::privilege::role_columns(bound,&table).is_empty(){continue;}
        intents.push(Intent{paired:false,boundary:None,concrete:None,site:format!("{PROVISION_RESULT}{table}"),table,column:None,
            policy:RuleExpr::Allow,effects:vec![Effect::Insert,Effect::Update]});
    }}
    Trace::new(intents)
}
pub(super) fn record(bound:&Bound,p:&Program,trace:&Trace,result:&snapback4_core::WriteState,after:&BTreeMap<String,Vec<Value>>,initial:&BTreeMap<String,Vec<Value>>,viewer:&str,steps:&[histories::Step],engine:&mut Engine,out:&mut Campaign){
    let observations=trace.take();
    let provisioned=observations.iter().filter(|o|o.site.starts_with(PROVISION_RESULT)).filter_map(|o|
        o.next.as_ref().map(|row|(o.table.as_str(),row))).collect::<Vec<_>>();
    for observation in &observations{
        let Some(inv)=bound.invariants.iter().find(|inv|inv.site.to_string()==observation.site)else{continue;};
        match observation.allowed{
            Some(false)=>if let Some(row)=observation.next.as_ref().or(observation.old.as_ref()){
                if histories::violation(out,inv,steps,viewer,row,observation.old.as_ref(),initial,match observation.effect{Effect::Insert=>"insert",Effect::Update=>"update",Effect::Delete=>"delete",Effect::Read=>"read"}){
                    out.violations.last_mut().unwrap().rule_path="actual executed write boundary; independent policy false in the provisional transaction; enclosing authored mutation committed".into();
                }
            },
            None=>{out.unsupported.insert(format!("{} / {}: executed policy unknown; no refutation",p.name,inv.target_label()));},_=>{},
        }
    }
    let snapback4_core::WriteState::Sent{result:data,..}=result else{return;};
    let Some(bp)=bound.programs.iter().find(|bp|bp.program.name==p.name)else{return;};
    for inv in bound.invariants.iter().filter(|inv|inv.target=="read"){
        let Some(policy)=inv.policy.as_ref()else{continue;};
        let deps=stability::dependencies(bound,policy);
        let implicit=stability::implicit(bound,p);
        if implicit.contains(&inv.table)||implicit.iter().any(|t|deps.contains(t))||ir::write_tables(p).iter().any(|(t,_)|deps.contains(t)){
            out.unsupported.insert(format!("{} / {}: mutation-result policy changes require a disclosure-boundary reduction",p.name,inv.target_label()));continue;
        }
        for row in after.get(&inv.table).into_iter().flatten(){
            let Ok(key)=row.field("id")else{continue;};
            if !histories::typed_disclosure(&bp.result,data,&inv.table,key,inv.column.as_deref(),row){continue;}
            if viewer=="service:operator"&&provisioning(p)&&provisioned.iter().any(|(table,image)|*table==inv.table&&*image==row&&histories::exact_written_payload(&bp.result,data,&inv.table,key,image)){
                out.unsupported.insert(format!("{}: operator provisioning result excludes only its own executed roster write from authored read intent; later queries remain checked",p.name));
                continue;
            }
            if !histories::typed_disclosure_image(&bp.result,data,&inv.table,key,inv.column.as_deref(),row,Some(policy)){
                out.unsupported.insert(format!("{} / {}: returned policy image differs from committed image; disclosure boundary uncovered",p.name,inv.target_label()));continue;
            }
            if !out.reserve(1){return;}
            if judged(inv,policy_in_at(bound,inv,after,viewer,None,row,engine,histories::history_clock(steps)),out)!=Ok(false){continue;}
            if histories::violation(out,inv,steps,viewer,row,None,initial,"mutation result"){
                let v=out.violations.last_mut().unwrap();v.operation=p.name.clone();v.args=steps.last().map(|s|s.args.clone()).unwrap_or_default();v.rule_path="authored mutation returned a compiler-typed protected row/column payload; stable current policy false".into();
            }
        }
    }
}

// Follow an actually admitted state change with payload-bearing operations on
// the same referenced row. This finds lifecycle-to-mutation observations without
// spending pair slots on unrelated roster and creation combinations.
pub(super) fn pairs(bound:&Bound,candidates:&[(&Program,String,BTreeMap<String,Value>)],committed:&[usize])->Vec<(usize,usize)>{
    let protected=bound.invariants.iter().filter(|i|i.target=="read").map(|i|i.table.clone()).collect::<BTreeSet<_>>();
    let mut groups:BTreeMap<(String,String),Vec<(usize,usize)>>=BTreeMap::new();let mut seen=BTreeSet::new();
    for (second,(p,actor,args)) in candidates.iter().enumerate(){
        let Some(bp)=bound.programs.iter().find(|bp|bp.program.name==p.name)else{continue;};
        for &first in committed{
            let (before,who,inputs)=&candidates[first];if before.name==p.name{continue;}
            let shared=protected.iter().any(|table|histories::typed_source(&bp.result,table)&&ir::write_tables(before).iter().any(|(t,_)|t==table)&&before.args.iter().any(|(a,k)|matches!(k,ir::ArgType::Ref{table:t} if t==table)&&p.args.iter().any(|(b,k)|matches!(k,ir::ArgType::Ref{table:t} if t==table)&&inputs.get(a)==args.get(b))));
            if shared&&seen.insert((before.name.clone(),who.clone(),p.name.clone(),actor.clone())){groups.entry((p.name.clone(),actor.clone())).or_default().push((first,second));}
        }
    }
    let mut out=Vec::new();for n in 0..groups.values().map(Vec::len).max().unwrap_or(0){for group in groups.values(){if let Some(pair)=group.get(n){out.push(*pair);if out.len()==256{return out;}}}}out
}

// Identify direct argument supplies to declared column-write intent. This only
// prioritizes proposals; actual interpreter admission still decides every case.
pub(super) fn write_arguments(bound:&Bound,p:&Program)->BTreeSet<String>{
    fn walk(v:&serde_json::Value,f:&mut impl FnMut(&serde_json::Value)){
        f(v);match v{serde_json::Value::Object(xs)=>for x in xs.values(){walk(x,f)},serde_json::Value::Array(xs)=>for x in xs{walk(x,f)},_=>{}}
    }
    let json=serde_json::to_value(p).unwrap();let mut bindings=BTreeMap::new();
    walk(&json,&mut |v|for tag in ["Const","Let"]{if let Some(b)=v.get(tag)&&let(Some(n),Some(e))=(b.get("name").and_then(|v|v.as_str()),b.get("value")){bindings.insert(n.to_string(),e.clone());}});
    fn resolve<'a>(v:&'a serde_json::Value,bindings:&'a BTreeMap<String,serde_json::Value>,depth:usize)->&'a serde_json::Value{
        if depth>32{return v;}if let Some(n)=v.get("Variable").and_then(|v|v.as_str())&&let Some(e)=bindings.get(n){resolve(e,bindings,depth+1)}else{v}
    }
    let mut out=BTreeSet::new();
    walk(&json,&mut |v|for tag in ["Insert","InsertIfAbsent","Upsert","Update","WriteTarget"]{
        let Some(w)=v.get(tag)else{continue;};let table=w.get("table").or_else(||w.get("target").and_then(|t|t.get("table"))).and_then(|v|v.as_str());
        let Some(payload)=w.get("row").or_else(||w.get("patch"))else{continue;};let payload=resolve(payload,&bindings,0);
        let Some(fields)=payload.get("Object").and_then(|v|v.as_object())else{continue;};
        for inv in bound.invariants.iter().filter(|i|Some(i.table.as_str())==table&&i.column.is_some()&&!matches!(i.target.as_str(),"read"|"always")&&i.operation.as_ref().is_none_or(|op|op==&p.name)){
            if let Some(value)=fields.get(inv.column.as_ref().unwrap())&&let Some(arg)=resolve(value,&bindings,0).get("Variable").and_then(|v|v.as_str())&&p.args.contains_key(arg){out.insert(arg.into());}
        }
    });out
}

#[cfg(test)]mod sec10_resource_tests{use super::*;
#[test]fn retargeting_is_not_consuming_the_original_approval(){
    let source="table jobs:\n  approved: bool default false\n  read <- allow\n  online only\ntable tasks:\n  job: jobs\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation guarded(task: tasks):\n  t = tasks[task] ! else MISSING\n  require t.job.approved = true else NO_APPROVAL\n  update tasks[task] {status:'done'}\nmutation bypass(task: tasks,job: jobs):\n  update tasks[task] {job}\n  update tasks[task] {status:'done'}\n";
    for source in [source.to_string(),source.replace("  update tasks[task] {job}\n  update tasks[task] {status:'done'}","  update tasks[task] {job,status:'done'}")]{
    let sources=vec![("schema.q".into(),source.into())];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
    let row=|table:&str,value:serde_json::Value|snapback4_core::wire::row_from_json(&b.schema.tables[table],&value).unwrap();
    engine.seed_at([("jobs".into(),row("jobs",serde_json::json!({"id":"a","approved":true}))),("jobs".into(),row("jobs",serde_json::json!({"id":"b","approved":false}))),("tasks".into(),row("tasks",serde_json::json!({"id":"t","job":"a","status":"draft"})))],NOW).unwrap();
    let p=&b.programs.iter().find(|p|p.program.name=="bypass").unwrap().program;let trace=trace(&b,p,&engine);
    let result=engine.mutate("bypass",None,Context::new("dev:crew",BTreeMap::from([("task".into(),Value::Id("t".into())),("job".into(),Value::Id("b".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();
    assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
    assert!(trace.take().iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(false)));
    }
}
#[test]fn reparented_stage_work_checks_the_new_parents_window(){
    let source="table jobs:\n  status: enum('estimate','active')\n  read <- allow\n  online only\ntable tasks:\n  job: jobs\n  stage: enum('raw','handoff')\n  read <- allow\n  update <- allow\n  online only\nmutation move(task: tasks,job: jobs):\n  update tasks[task] {job,stage:'handoff'}\ninvariant tasks.stage update only .job.status = 'active'\n";
    let mut b=crate::compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b.invariants[0].site.file="$derived/parent-state/control".into();
    let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
    let row=|table:&str,value:serde_json::Value|snapback4_core::wire::row_from_json(&b.schema.tables[table],&value).unwrap();
    engine.seed_at([("jobs".into(),row("jobs",serde_json::json!({"id":"a","status":"active"}))),("jobs".into(),row("jobs",serde_json::json!({"id":"b","status":"estimate"}))),("tasks".into(),row("tasks",serde_json::json!({"id":"t","job":"a","stage":"raw"})))],NOW).unwrap();
    let p=&b.programs.iter().find(|p|p.program.name=="move").unwrap().program;let trace=trace(&b,p,&engine);
    let result=engine.mutate("move",None,Context::new("dev:crew",BTreeMap::from([("task".into(),Value::Id("t".into())),("job".into(),Value::Id("b".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();
    assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));assert!(trace.take().iter().any(|o|o.allowed==Some(false)));
}

#[test]fn clearing_approval_cannot_finish_with_changed_approved_inputs(){
    let source="table docs:\n  consent: bool\n  mode: enum('yes','no')\n  party: principal\n  approved: bool default false\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.consent and d.mode = 'yes' and d.party = viewer else NO_CONSENT\n  update docs[doc] {approved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approved else NO_APPROVAL\n  update docs[doc] {status:'done'}\nmutation bypass(doc: docs):\n  update docs[doc] {consent:false,mode:'no',party:viewer,approved:false,status:'done'}\n";
    for (source,expect) in [(source.to_string(),false),(source.replace("consent:false,mode:'no',party:viewer,",""),true)]{
        let sources=vec![("schema.q".into(),source)];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d","consent":true,"mode":"yes","party":"dev:a","approved":true,"status":"draft"})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();
        let p=&b.programs.iter().find(|p|p.program.name=="bypass").unwrap().program;let trace=trace(&b,p,&engine);
        let result=engine.mutate("bypass",None,Context::new("dev:b",BTreeMap::from([("doc".into(),Value::Id("d".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
        let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(expect)),"{observations:?}");
    }
}

#[test]fn existence_receipts_keep_the_selected_approvals_inspected_inputs(){
    let source="table approvals:\n  subject: principal\n  unique subject\n  consent: bool\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  approval: approvals\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(approval: approvals):\n  a = approvals[approval] ! else MISSING\n  require a.consent else NO_CONSENT\n  update approvals[approval] {approved:true}\nmutation finish(approval: approvals):\n  require exists approvals[subject = viewer] where .approved else NO_APPROVAL\n  return insert effects {approval}\nmutation bypass(approval: approvals):\n  update approvals[approval] {consent:false,approved:false}\n  return insert effects {approval}\n";
    for (source,expected) in [(source.to_string(),false),(source.replace("consent:false,", ""),true)]{
        let sources=vec![("schema.q".into(),source)];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["approvals"],&serde_json::json!({"id":"a","subject":"dev:clerk","consent":true,"approved":true})).unwrap();engine.seed_at([("approvals".into(),row)],NOW).unwrap();
        let p=&b.programs.iter().find(|p|p.program.name=="bypass").unwrap().program;let trace=trace(&b,p,&engine);
        let result=engine.mutate("bypass",None,Context::new("dev:clerk",BTreeMap::from([("approval".into(),Value::Id("a".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
        let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(expected)),"{observations:?}");
    }
}

#[test]fn conditional_freezes_do_not_erase_consumption_dependencies(){
    let source="table docs:\n  consent: bool\n  approved: bool default false\n  status: enum('draft','done') default 'draft'\n  immutable consent when .approved = true\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.consent else NO_CONSENT\n  update docs[doc] {approved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approved else NO_APPROVAL\n  update docs[doc] {status:'done'}\nmutation bypass(doc: docs):\n  update docs[doc] {approved:false}\n  update docs[doc] {consent:false}\n  update docs[doc] {status:'done'}\n";
    for (source,expected) in [(source.to_string(),false),(source.replace("  update docs[doc] {consent:false}\n", ""),true)]{
        let sources=vec![("schema.q".into(),source)];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        assert!(b.security_approval_inputs[&("docs".into(),"approved".into())].contains("consent"));
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d","consent":true,"approved":true,"status":"draft"})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();
        let p=&b.programs.iter().find(|p|p.program.name=="bypass").unwrap().program;let trace=trace(&b,p,&engine);
        let result=engine.mutate("bypass",None,Context::new("dev:clerk",BTreeMap::from([("doc".into(),Value::Id("d".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
        let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(expected)),"{observations:?}");
    }
}
#[test]fn multiple_consumptions_preserve_conjunction_and_alternative_structure(){
    let source="table docs:\n  aConsent: bool\n  bConsent: bool\n  aApproved: bool default false\n  bApproved: bool default false\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation approveA(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.aConsent else NO_CONSENT\n  update docs[doc] {aApproved:true}\nmutation approveB(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.bConsent else NO_CONSENT\n  update docs[doc] {bApproved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.aApproved and d.bApproved else NO_APPROVAL\n  update docs[doc] {status:'done'}\nmutation bypass(doc: docs):\n  update docs[doc] {aApproved:false,bApproved:false}\n  update docs[doc] {bConsent:false}\n  update docs[doc] {status:'done'}\n";
    for (source,expected) in [(source.to_string(),false),(source.replace("d.aApproved and d.bApproved", "d.aApproved or d.bApproved"),true),(source.replace("  update docs[doc] {bConsent:false}\n", ""),true),(source.replace("require d.aConsent else", "require d.aConsent and d.bApproved else"),false),(source.replace("require d.aConsent else", "require d.aConsent and d.bApproved else").replace("  update docs[doc] {bConsent:false}\n", ""),true)]{
        let sources=vec![("schema.q".into(),source)];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d","aConsent":true,"bConsent":true,"aApproved":true,"bApproved":true,"status":"draft"})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();
        let p=&b.programs.iter().find(|p|p.program.name=="bypass").unwrap().program;let trace=trace(&b,p,&engine);
        let result=engine.mutate("bypass",None,Context::new("dev:clerk",BTreeMap::from([("doc".into(),Value::Id("d".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
        let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(expected)),"{observations:?}");
    }
}
#[test]fn a_filtered_receipt_does_not_freeze_an_unrelated_approvals_inputs(){
    let source="table approvals:\n  subject: principal\n  unique subject\n  consent: bool\n  otherConsent: bool\n  approved: bool default false\n  otherApproved: bool default false\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  approval: approvals\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(approval: approvals):\n  a = approvals[approval] ! else MISSING\n  require a.consent else NO_CONSENT\n  update approvals[approval] {approved:true}\nmutation approveOther(approval: approvals):\n  a = approvals[approval] ! else MISSING\n  require a.otherConsent else NO_CONSENT\n  update approvals[approval] {otherApproved:true}\nmutation finish(approval: approvals):\n  require exists approvals[subject = viewer] where .approved else NO_APPROVAL\n  return insert effects {approval}\nmutation consume(approval: approvals):\n  update approvals[approval] {approved:false,otherApproved:false,otherConsent:false}\n  return insert effects {approval}\n";
    for (source,expected) in [(source.to_string(),true),(source.replace("otherConsent:false", "otherConsent:false,consent:false"),false)]{
        let sources=vec![("schema.q".into(),source)];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["approvals"],&serde_json::json!({"id":"a","subject":"dev:clerk","consent":true,"otherConsent":true,"approved":true,"otherApproved":true})).unwrap();engine.seed_at([("approvals".into(),row)],NOW).unwrap();
        let p=&b.programs.iter().find(|p|p.program.name=="consume").unwrap().program;let trace=trace(&b,p,&engine);
        let result=engine.mutate("consume",None,Context::new("dev:clerk",BTreeMap::from([("approval".into(),Value::Id("a".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
        let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(expected)),"{observations:?}");
    }
}

#[test]fn filtered_consumption_preserves_nonapproval_conjuncts_and_alternatives(){
    let source="table approvals:\n  subject: principal\n  unique subject\n  aConsent: bool\n  bConsent: bool\n  aApproved: bool default false\n  bApproved: bool default false\n  available: bool default true\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  approval: approvals\n  read <- allow\n  insert <- allow\n  online only\nmutation approveA(approval: approvals):\n  a = approvals[approval] ! else MISSING\n  require a.aConsent else NO_CONSENT\n  update approvals[approval] {aApproved:true}\nmutation approveB(approval: approvals):\n  a = approvals[approval] ! else MISSING\n  require a.bConsent else NO_CONSENT\n  update approvals[approval] {bApproved:true}\nmutation finish(approval: approvals):\n  require exists approvals[subject = viewer] where FILTER else NO_APPROVAL\n  return insert effects {approval}\nmutation consume(approval: approvals):\n  update approvals[approval] {CHANGES}\n  return insert effects {approval}\n";
    for (filter,changes,expected) in [
        (".aApproved and .available","aApproved:false,available:false",false),
        (".aApproved and .available","aApproved:false",true),
        (".aApproved or .bApproved","aApproved:false,bApproved:false,bConsent:false",true),
        (".aApproved and .bApproved","aApproved:false,bApproved:false,bConsent:false",false),
        (".aApproved and .bApproved","aApproved:false,bApproved:false",true),
        ("KEYED","aApproved:false,available:false",false),
        ("KEYED","aApproved:false",true),
    ]{
        let source=source.replace("FILTER",if filter=="KEYED"{".aApproved and .available"}else{filter}).replace("CHANGES",changes);
        let source=if filter=="KEYED"{source.replace("approvals[subject = viewer] where .aApproved and .available","approvals[subject = viewer, aApproved = true, available = true]")}else{source};let sources=vec![("schema.q".into(),source)];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["approvals"],&serde_json::json!({"id":"a","subject":"dev:clerk","aConsent":true,"bConsent":true,"aApproved":true,"bApproved":true,"available":true})).unwrap();engine.seed_at([("approvals".into(),row)],NOW).unwrap();
        let p=&b.programs.iter().find(|p|p.program.name=="consume").unwrap().program;let trace=trace(&b,p,&engine);
        let result=engine.mutate("consume",None,Context::new("dev:clerk",BTreeMap::from([("approval".into(),Value::Id("a".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
        let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(expected)),"{filter} / {changes}: {observations:?}");
    }
}

#[test]fn newly_issued_approval_can_be_consumed_but_not_refreshed_by_ordinary_edits(){
    let source="table docs:\n  consent: bool\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.consent else NO_CONSENT\n  update docs[doc] {approved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approved else NO_APPROVAL\n  return insert effects {doc}\nmutation atomic(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.consent else NO_CONSENT\n  update docs[doc] {approved:true}\n  update docs[doc] {approved:false}\n  return insert effects {doc}\n";
    for (source,expected) in [(source.to_string(),true),(source.replace("{approved:false}","{approved:false,consent:false}"),false),(source.replace("  update docs[doc] {approved:false}","  update docs[doc] {consent:false}\n  update docs[doc] {approved:false}"),false)]{
        let sources=vec![("schema.q".into(),source)];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d","consent":true,"approved":false})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();
        let p=&b.programs.iter().find(|p|p.program.name=="atomic").unwrap().program;let trace=trace(&b,p,&engine);
        let result=engine.mutate("atomic",None,Context::new("dev:clerk",BTreeMap::from([("doc".into(),Value::Id("d".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
        let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(expected)),"{observations:?}");
    }
}

#[test]fn timestamp_receipts_preserve_exact_named_key_conditions(){
    let source="table approvals:\n  subject: principal\n  unique subject\n  consent: bool\n  approvedAt: time ?\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  approval: approvals\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(approval: approvals):\n  a = approvals[approval] ! else MISSING\n  require a.consent else NO_CONSENT\n  update approvals[approval] {approvedAt:now}\nmutation finish(approval: approvals):\n  require exists approvals[subject = viewer, approvedAt = now] else NO_APPROVAL\n  return insert effects {approval}\nmutation consume(approval: approvals):\n  update approvals[approval] {approvedAt:null}\n  return insert effects {approval}\n";
    for (source,expected) in [(source.to_string(),true),(source.replace("{approvedAt:null}","{approvedAt:null,consent:false}"),false)]{
        let sources=vec![("schema.q".into(),source)];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["approvals"],&serde_json::json!({"id":"a","subject":"dev:clerk","consent":true,"approvedAt":NOW})).unwrap();engine.seed_at([("approvals".into(),row)],NOW).unwrap();
        let p=&b.programs.iter().find(|p|p.program.name=="consume").unwrap().program;let trace=trace(&b,p,&engine);
        let result=engine.mutate("consume",None,Context::new("dev:clerk",BTreeMap::from([("approval".into(),Value::Id("a".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
        let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(expected)),"{observations:?}");
    }
}

}
