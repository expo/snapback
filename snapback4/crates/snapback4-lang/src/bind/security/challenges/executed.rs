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
    for (table,t) in bound.schema.visible_tables(){for (column,kind) in &t.columns{if super::super::derived::named_approval(column,kind){inputs.entry((table.clone(),column.clone())).or_default();}}}
    for key in super::super::derived::principal_receipt_columns(bound){inputs.entry(key).or_default();}inputs
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
#[derive(Clone)]struct Receipt{trusted:bool,stamp:Value,inputs:BTreeMap<String,Value>}
type Receipts=BTreeMap<ReceiptKey,Receipt>;
fn positive(value:&Value)->bool{matches!(value,Value::Bool(true)|Value::Int(_)|Value::Id(_))}
fn receipt(table:&str,row:&Value,stamp:&str,columns:&BTreeSet<String>)->Option<(ReceiptKey,Receipt)>{
    let Value::Id(id)=row.field("id").ok()? else{return None;};let value=cell(row,stamp);if !positive(&value){return None;}
    Some(((table.into(),id.clone(),stamp.into()),Receipt{trusted:true,stamp:value,inputs:columns.iter().map(|column|(column.clone(),cell(row,column))).collect()}))
}
fn consumed(predicate:&ast::Expr,row:&Value,effective:&Value,rows:&BTreeMap<String,Vec<Value>>,entry:&BTreeMap<String,Vec<Value>>,schema:&Schema,viewer:&str,table:&str,now:i64,inputs:&ApprovedInputs,receipts:&Receipts,history:&super::deleted_approvals::History)->Option<bool>{
    let actual=|owner:&str,id:&str|{
        if owner==table&&effective.field("id").ok()==Some(&Value::Id(id.into())){Some(effective)}else{rows.get(owner).into_iter().flatten().find(|r|r.field("id").ok()==Some(&Value::Id(id.into())))}
    };
    // Restore consumed stamps only. Ordinary predicates and complete lookup /
    // filter trees run unchanged on their actual pre-effect data. Dependencies
    // between consumed stamps are validated together; one invalidated receipt
    // removes every receipt that depended on it.
    let approval=|owner:&str,column:&str|inputs.contains_key(&(owner.into(),column.into()));
    let eligible=receipts.iter().filter(|((owner,id,stamp),receipt)|actual(owner,id).is_some_and(|row|{let value=cell(row,stamp);value==receipt.stamp||matches!(value,Value::Null|Value::Bool(false))})).map(|(key,_)|key.clone()).collect::<BTreeSet<_>>();
    let validate=|trusted:bool|{
        let mut valid=eligible.iter().filter(|key|!trusted||receipts[*key].trusted).cloned().collect::<BTreeSet<_>>();
        loop{
            let invalid=valid.iter().filter(|(owner,id,stamp)|{
                let current=actual(owner,id).unwrap();receipts[&(owner.clone(),id.clone(),stamp.clone())].inputs.iter().any(|(column,before)|{
                    let key=(owner.clone(),id.clone(),column.clone());
                    if positive(before)&&approval(owner,column){return !valid.contains(&key)||receipts.get(&key).is_none_or(|receipt|receipt.stamp!=*before);}
                    *before!=cell(current,column)
                })
            }).cloned().collect::<Vec<_>>();
            if invalid.is_empty(){break;}for key in invalid{valid.remove(&key);}
        }valid
    };
    let certain=validate(true);let possible=validate(false);
    let evaluate=|valid:&BTreeSet<ReceiptKey>,restored:&BTreeSet<ReceiptKey>|{
        let mut shadow=rows.clone();let mut image=row.clone();
        if let Some(current)=shadow.get_mut(table).into_iter().flatten().find(|r|r.field("id").ok()==image.field("id").ok()){*current=image.clone();}
        for (owner,rs) in shadow.iter_mut(){for target in rs{
            let Some(Value::Id(id))=target.field("id").ok().cloned()else{continue;};
            for (stamp,kind) in &schema.tables[owner].columns{if !approval(owner,stamp){continue;}
                let key=(owner.clone(),id.clone(),stamp.clone());let value=if valid.contains(&key){Some(if restored.contains(&key)||actual(owner,&id).is_some_and(|current|positive(&cell(current,stamp))){receipts[&key].stamp.clone()}else{actual(owner,&id).map(|row|cell(row,stamp)).unwrap_or(Value::Null)})}else if actual(owner,&id).is_some_and(|current|positive(&cell(current,stamp))){Some(if matches!(kind.required(),C::Bool){Value::Bool(false)}else{Value::Null})}else{None};
                if let Some(value)=value{put(target,stamp,value.clone());if owner==table&&image.field("id").ok()==Some(&Value::Id(id.clone())){put(&mut image,stamp,value);}}
            }
        }}
        super::super::concrete::evaluate(predicate,&image,&shadow,schema,viewer,table,now)
    };
    let search=|valid:&BTreeSet<ReceiptKey>|{
        let baseline=evaluate(valid,&BTreeSet::new());if baseline==Some(true){return baseline;}
        let consumed=valid.iter().filter(|(owner,id,stamp)|actual(owner,id).is_some_and(|row|!positive(&cell(row,stamp)))).cloned().collect::<Vec<_>>();
        // Each choice is shared by every occurrence of that typed stamp in
        // the complete predicate. Negated and positive uses cannot disagree.
        if consumed.len()>8{return None;}let mut unknown=baseline.is_none();
        for mask in 1usize..(1usize<<consumed.len()){
            let restored=consumed.iter().enumerate().filter(|(bit,_)|mask&(1<<bit)!=0).map(|(_,key)|key.clone()).collect();
            match evaluate(valid,&restored){Some(true)=>return Some(true),None=>unknown=true,_=>{}}
        }if unknown{None}else{Some(false)}
    };
    let verdict=search(&certain);
    if verdict!=Some(true)&&certain!=possible&&search(&possible)!=Some(false){return None;}
    if verdict==Some(false)&&super::deleted_approvals::uncertain(predicate,row,effective,rows,entry,schema,viewer,table,now,history){return None;}
    verdict
}
pub(super) fn trace(bound:&Bound,p:&Program,entry:&Engine)->Trace {
    let entry=if bound.invariants.iter().any(|i|i.site.file.contains("/sibling-approval/")){readback(entry).ok().map(std::sync::Arc::new)}else{None};
    let inputs=std::sync::Arc::new(approved_inputs(bound));
    let mut initial=Receipts::new();if let Some(entry)=&entry{for ((owner,stamp),columns) in inputs.iter(){for row in entry.get(owner).into_iter().flatten(){if let Some((key,value))=receipt(owner,row,stamp,columns){initial.insert(key,value);}}}}
    let receipts=std::sync::Arc::new(std::sync::Mutex::new(initial));
    let mut intents=Vec::new();
    let history=std::sync::Arc::new(std::sync::Mutex::new(super::deleted_approvals::History::default()));
    let deleting=ir::write_tables(p).iter().any(|(_,kind)|*kind=="delete")||!super::stability::implicit(bound,p).is_empty();
    if entry.is_some()&&deleting{for (table,_) in bound.schema.visible_tables(){let history=history.clone();intents.push(Intent{source:Default::default(),paired:false,concrete:None,site:"$security.population-history".into(),table:table.clone(),effects:vec![Effect::Insert,Effect::Update,Effect::Delete],column:None,policy:RuleExpr::Allow,boundary:Some(snapback4_core::engine::fixture_trace::BoundaryPredicate(std::sync::Arc::new(move |rows,old,next,_,_,_,_|{history.lock().expect("population history lock").record(rows,old.is_some()&&next.is_none());Some(true)})))});}}

    if entry.is_some(){for ((owner,stamp),columns) in inputs.iter(){
        for trusted in [true,false]{
            let principal=matches!(bound.schema.tables[owner].columns[stamp].required(),C::Principal);
            if principal&&!trusted{continue;}
            let key=(p.name.clone(),owner.clone(),stamp.clone());
            let sites:Vec<String>=if trusted{bound.security_approval_reissues.get(&key)}else{bound.security_approval_uncertain_writes.get(&key)}.map(|sites|sites.iter().cloned().collect()).unwrap_or_default();
            if !trusted&&sites.is_empty(){continue;}
            let owner=owner.clone();let stamp=stamp.clone();let columns=columns.clone();let receipts=receipts.clone();let target=owner.clone();let column=stamp.clone();let bound=bound.clone();let program=p.name.clone();let entry=entry.clone();
            intents.push(Intent{source:snapback4_core::engine::fixture_trace::SourceFilter{inserts_at:if trusted{None}else{Some(sites.clone())},unchanged_at:sites.clone(),updates_at:if principal{None}else{Some(sites)},..Default::default()},paired:false,concrete:None,site:"$security.approval-receipt".into(),table:target,effects:vec![Effect::Insert,Effect::Update],column:Some(column),policy:RuleExpr::Allow,
                boundary:Some(snapback4_core::engine::fixture_trace::BoundaryPredicate(std::sync::Arc::new(move |rows,old,next,viewer,now,args,site|{if let Some(next)=next&&let Some((key,mut value))=receipt(&owner,next,&stamp,&columns){
                    let baseline=entry.as_ref().and_then(|entry|entry.get(&owner)).into_iter().flatten().find(|row|row.field("id").ok()==next.field("id").ok()).or(old);
                    let checked=if principal{Some(true)}else if trusted{baseline.map(|old|super::super::derived::revalidated(&bound,&program,&owner,&stamp,site,old,next,&columns,rows,viewer,now,args)).unwrap_or(Some(true))}else{None};
                    if checked!=Some(false){value.trusted=trusted&&checked==Some(true);receipts.lock().expect("approval receipt lock").insert(key,value);}
                }Some(true)})))});
        }
    }}
    for inv in bound.invariants.iter().filter(|inv|!matches!(inv.target.as_str(),"read"|"always")&&inv.operation.as_ref().is_none_or(|op|op==&p.name)) {
        for word in super::super::effects(inv) {
            let transition=super::super::derived::transition(inv);
            let mut boundary=transition.map(|(bypass,prerequisite)|{
                let bypass=bypass.clone();let prerequisite=prerequisite.clone();let schema=bound.schema.clone();let table=inv.table.clone();let entry=if inv.site.file.contains("/sibling-approval/"){entry.clone()}else{None};let inputs=inputs.clone();let receipts=receipts.clone();let history=history.clone();let sibling=inv.site.file.contains("/sibling-approval/");
                snapback4_core::engine::fixture_trace::BoundaryPredicate(std::sync::Arc::new(move |rows,old,next,viewer,now,_,_|{
                    let (Some(old),Some(next))=(old,next)else{return None;};
                    match super::super::concrete::evaluate(&bypass,next,rows,&schema,viewer,&table,now){
                        Some(true)=>Some(true),Some(false)=>{
                            let image=if sibling{prerequisite_image(old,next,&schema,&table,&inputs)}else{old.clone()};
                            let current=super::super::concrete::evaluate(&prerequisite,&image,rows,&schema,viewer,&table,now);
                            let prior=entry.as_ref().map(|entry|consumed(&prerequisite,&image,next,rows,entry,&schema,viewer,&table,now,&inputs,&receipts.lock().expect("approval receipt lock"),&history.lock().expect("population history lock")));
                            match prior{Some(result)=>result,None=>if sibling{None}else{current}}
                        },None=>None,
                    }
                }))
            }).or_else(||if inv.site.file.contains("/sibling-approval/")&&word=="insert"{
                let predicate=inv.syntax.clone()?;let schema=bound.schema.clone();let table=inv.table.clone();let entry=entry.clone();let receipts=receipts.clone();let inputs=inputs.clone();let history=history.clone();
                Some(snapback4_core::engine::fixture_trace::BoundaryPredicate(std::sync::Arc::new(move |rows,_old,next,viewer,now,_,_|{
                    let row=next?;
                    let prior=entry.as_ref().map(|entry|consumed(&predicate,row,row,rows,entry,&schema,viewer,&table,now,&inputs,&receipts.lock().expect("approval receipt lock"),&history.lock().expect("population history lock")));
                    match prior{Some(result)=>result,None=>None}
                })))
            }else if inv.site.file.contains("/parent-state/"){
                let predicate=inv.syntax.clone()?;let schema=bound.schema.clone();let table=inv.table.clone();
                let mut references=BTreeSet::new();let mut probe=predicate.clone();crate::bind::intent_walk::expression(&mut probe,&mut |e|if let ast::Expr::Member{base,name,..}=e&&matches!(base.as_ref(),ast::Expr::Focal{..})&&matches!(schema.tables[&table].columns.get(name).map(C::required),Some(C::Ref{..})){references.insert(name.clone());});
                Some(snapback4_core::engine::fixture_trace::BoundaryPredicate(std::sync::Arc::new(move |rows,old,next,viewer,now,_,_|{
                    let old=old?;let row=if let Some(next)=next&&references.iter().any(|reference|next.field(reference).ok().is_some_and(|id|*id!=Value::Null&&old.field(reference).ok()!=Some(id))){next}else{old};
                    super::super::concrete::evaluate(&predicate,row,rows,&schema,viewer,&table,now)
                })))
            }else if inv.site.file.contains("/sec11-approval-latest/")||inv.site.file.contains("/sec11-approval-path/"){
                let inv=inv.clone();let schema=bound.schema.clone();
                Some(snapback4_core::engine::fixture_trace::BoundaryPredicate(std::sync::Arc::new(move |rows,old,next,viewer,now,args,site|{
                    super::super::derived::approval_question_judgment(&inv,old,next?,rows,&schema,args,viewer,now,site)
                })))
            }else{None});
            let mut concrete=if boundary.is_none()&&inv.policy.is_none(){inv.syntax.clone().map(|syntax|{
                let bound=bound.clone();let inv=inv.clone();let insert=word=="insert";
                snapback4_core::engine::fixture_trace::ConcretePredicate(std::sync::Arc::new(move |rows,row,viewer,now|{
                    if insert&&super::super::write_intent::empty_creation(&bound,&inv,None,row){return Some(true);}
                    super::super::concrete::evaluate(&syntax,row,rows,&bound.schema,viewer,&inv.table,now)
                }))
            })}else{None};
            let mut source=snapback4_core::engine::fixture_trace::SourceFilter::default();
            if super::super::derived::is_derived(inv)&&let Some(policy)=&inv.policy{
                let mut stamps=BTreeSet::new();
                for ((table,stamp),_) in bound.security_approval_inputs.iter().filter(|((table,_),_)|table==&inv.table){
                    if policy.any_term(&|term|matches!(term,RuleTerm::OldField(column)|RuleTerm::NextField(column) if column==stamp)){stamps.insert((table.clone(),stamp.clone()));}
                }
                if stamps.len()==1{
                    let (table,stamp)=stamps.into_iter().next().unwrap();let key=(p.name.clone(),table.clone(),stamp.clone());
                    let sites=bound.security_approval_reissues.get(&key).cloned().unwrap_or_default();
                    source.unknown_at=bound.security_approval_uncertain_writes.get(&key).map(|s|s.iter().cloned().collect()).unwrap_or_default();
                    let columns=inv.column.iter().cloned().collect();let bound=bound.clone();let program=p.name.clone();concrete=None;
                    boundary=Some(snapback4_core::engine::fixture_trace::BoundaryPredicate(std::sync::Arc::new(move |rows,old,next,viewer,now,args,site|{
                        let (Some(old),Some(next))=(old,next)else{return None;};
                        if !positive(&cell(old,&stamp))||!positive(&cell(next,&stamp)){return Some(true);}
                        if site.is_some_and(|site|sites.contains(site)){super::super::derived::revalidated(&bound,&program,&table,&stamp,site,old,next,&columns,rows,viewer,now,args)}else{Some(false)}
                    })));
                }
            }
            if word=="insert"&&inv.target=="write"&&!super::super::derived::is_derived(inv)&&let Some(column)=&inv.column&&
                let Some(sites)=bound.security_literal_defaults.get(&(p.name.clone(),inv.table.clone(),column.clone()))&&
                let Some(snapback4_core::schema::ColumnDefault::Literal(default))=bound.schema.tables[&inv.table].defaults.get(column){
                source.insert_initializers_at=sites.iter().map(|site|(site.clone(),default.clone())).collect();
            }
            intents.push(Intent {
                source,paired:super::super::derived::is_derived(inv)&&inv.policy.as_ref().is_some_and(|r|r.any_term(&|t|matches!(t,RuleTerm::OldField(_)|RuleTerm::NextField(_)))),
                boundary,concrete,site:inv.site.to_string(),table:inv.table.clone(),column:inv.column.clone(),
                policy:super::super::write_intent::policy(bound,inv,word).unwrap_or(RuleExpr::Allow),
                effects:vec![super::super::effect(word)],
            });
        }
    }
    // Record actual phase changes for inferred atomic lifecycle coupling.
    // These private always-true observations confer no admission authority.
    for (table,column) in super::super::derived::lifecycle_columns(bound){
        intents.push(Intent{source:Default::default(),paired:false,boundary:None,concrete:None,site:format!("$security.lifecycle-change/{table}/{column}"),table,column:Some(column),policy:RuleExpr::Allow,effects:vec![Effect::Update]});
    }
    // A private executed-write witness exempts only the operator provisioner's
    // own roster result. It never exempts an ordinary query or a different row.
    if provisioning(p){for table in ir::write_tables(p).into_iter().map(|(table,_)|table).collect::<BTreeSet<_>>() {
        if super::super::privilege::role_columns(bound,&table).is_empty(){continue;}
        intents.push(Intent{source:Default::default(),paired:false,boundary:None,concrete:None,site:format!("{PROVISION_RESULT}{table}"),table,column:None,
            policy:RuleExpr::Allow,effects:vec![Effect::Insert,Effect::Update]});
    }}
    Trace::new(intents).with_insert_sites(bound.programs.iter().find(|program|program.program.name==p.name).map(|program|program.fixture_insert_sites.iter().map(|(name,site)|(name.clone(),site.to_string())).collect()).unwrap_or_default())
}
fn lifecycle_judgment(bound:&Bound,inv:&super::super::Invariant,observation:&snapback4_core::engine::fixture_trace::Observation,all:&[snapback4_core::engine::fixture_trace::Observation],after:&BTreeMap<String,Vec<Value>>,viewer:&str,now:i64)->Option<bool>{
    if let Some(contract)=bound.security_conservation.get(&inv.site.to_string()){return contract.judge(observation.old.as_ref()?,after);}
    let Some(predicate)=&inv.syntax else{return observation.allowed;};
    // @ref LLP 3000.036.004.001#question-candidates — absence questions require the observed image and predicate to survive commit.
    if inv.site.file.starts_with("$derived/sec11-absence/") {
        let observed=observation.next.as_ref()?;
        let row=after.get(&inv.table)?.iter().find(|row|row.field("id").ok()==observed.field("id").ok())?;
        if row!=observed||bound.schema.tables[&inv.table].expired(row,now){return None;}
        return super::super::concrete::evaluate(predicate,row,after,&bound.schema,viewer,&inv.table,now);
    }
    if inv.site.file.contains("/child-stage/"){
        let row=observation.next.as_ref()?;
        if !after.get(&inv.table).into_iter().flatten().any(|r|r.field("id").ok()==row.field("id").ok()){return None;}
        return super::super::concrete::evaluate(predicate,row,after,&bound.schema,viewer,&inv.table,now);
    }
    if observation.allowed!=Some(false)||!inv.site.file.contains("/parent-state/"){return observation.allowed;}
    let mut references=BTreeSet::new();let mut syntax=predicate.clone();crate::bind::intent_walk::expression(&mut syntax,&mut |e|if let ast::Expr::Member{base,name,..}=e&&let ast::Expr::Member{base:root,name:reference,..}=base.as_ref()&&matches!(root.as_ref(),ast::Expr::Focal{..}){references.insert((reference.clone(),name.clone()));});
    if references.len()!=1{return observation.allowed;}let (reference,state)=references.iter().next().unwrap();
    let Some(C::Ref{table:parent})=bound.schema.tables[&inv.table].columns.get(reference).map(C::required)else{return observation.allowed;};
    let old=observation.old.as_ref()?;let row=if let Some(next)=&observation.next&&next.field(reference).ok().is_some_and(|value|*value!=Value::Null&&old.field(reference).ok()!=Some(value)){next}else{old};
    let id=row.field(reference).ok()?;
    // A named old-image rule is a matching explicit parent policy only if
    // this execution kept that association. Retargeting cannot borrow it.
    if old.field(reference).ok()==Some(id){let child=&bound.schema.tables[&inv.table];if [&child.rules.update].into_iter().chain(inv.column.as_ref().and_then(|column|child.column_writes.get(column))).any(|rule|rule.any_term(&|term|matches!(term,RuleTerm::Reference{table,column,field,old:true} if table==parent&&column==reference&&field==state))){return Some(true);}}
    for change in all.iter().filter(|change|change.site==format!("$security.lifecycle-change/{parent}/{state}")&&change.table==*parent){
        for image in change.old.iter().chain(change.next.iter()).filter(|image|image.field("id").ok()==Some(id)){
            let mut coupled=after.clone();let rows=coupled.entry(parent.clone()).or_default();rows.retain(|row|row.field("id").ok()!=Some(id));rows.push(image.clone());
            if super::super::concrete::evaluate(predicate,row,&coupled,&bound.schema,viewer,&inv.table,now)==Some(true){return Some(true);}
        }
    }observation.allowed
}
pub(super) fn record(bound:&Bound,p:&Program,trace:&Trace,result:&snapback4_core::WriteState,after:&BTreeMap<String,Vec<Value>>,initial:&BTreeMap<String,Vec<Value>>,viewer:&str,steps:&[histories::Step],engine:&mut Engine,out:&mut Campaign){
    let observations=trace.take();
    let snapback4_core::WriteState::Sent{result:data,..}=result else{return;};
    let provisioned=observations.iter().filter(|o|o.site.starts_with(PROVISION_RESULT)).filter_map(|o|
        o.next.as_ref().map(|row|(o.table.as_str(),row))).collect::<Vec<_>>();
    for observation in &observations{
        let Some(inv)=bound.invariants.iter().find(|inv|inv.site.to_string()==observation.site)else{continue;};
        match lifecycle_judgment(bound,inv,observation,&observations,after,viewer,histories::history_clock(steps)){
            Some(false)=>if let Some(row)=observation.next.as_ref().or(observation.old.as_ref()){
                if histories::violation(out,inv,steps,viewer,row,observation.old.as_ref(),initial,match observation.effect{Effect::Insert=>"insert",Effect::Update=>"update",Effect::Delete=>"delete",Effect::Read=>"read"}){
                    let witness=out.violations.last_mut().unwrap();
                    witness.rule_path="actual executed write boundary; independent policy false in the provisional transaction; enclosing authored mutation committed".into();
                    if super::super::derived::is_derived(inv){
                        let mut dependencies=inv.dependencies();
                        if let Some(contract)=bound.security_conservation.get(&inv.site.to_string()){dependencies.insert(contract.ledger.clone());dependencies.extend(contract.refund_ledger.iter().cloned());}
                        let committed=after.iter().filter(|(table,_)|dependencies.contains(*table)).collect::<BTreeMap<_,_>>();
                        if let Some(last)=witness.history.last_mut(){last.result["committedRows"]=serde_json::to_value(committed).unwrap();}
                    }
                }
            },
            None=>{out.unsupported.insert(format!("{} / {}: executed policy unknown; no refutation",p.name,inv.target_label()));},_=>{},
        }
    }
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
            if let Some(value)=fields.get(inv.column.as_ref().unwrap()){walk(resolve(value,&bindings,0),&mut |part|if let Some(arg)=part.get("Variable").and_then(|v|v.as_str())&&p.args.contains_key(arg){out.insert(arg.into());});}
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
    let result=engine.mutate("bypass",None,replay_ids::context("dev:crew",BTreeMap::from([("task".into(),Value::Id("t".into())),("job".into(),Value::Id("b".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();
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
    let result=engine.mutate("move",None,replay_ids::context("dev:crew",BTreeMap::from([("task".into(),Value::Id("t".into())),("job".into(),Value::Id("b".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();
    assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));assert!(trace.take().iter().any(|o|o.allowed==Some(false)));
}

#[test]fn clearing_approval_cannot_finish_with_changed_approved_inputs(){
    let source="table docs:\n  consent: bool\n  mode: enum('yes','no')\n  party: principal\n  approved: bool default false\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.consent and d.mode = 'yes' and d.party = viewer else NO_CONSENT\n  update docs[doc] {approved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approved else NO_APPROVAL\n  update docs[doc] {status:'done'}\nmutation bypass(doc: docs):\n  update docs[doc] {consent:false,mode:'no',party:viewer,approved:false,status:'done'}\n";
    for (source,expect) in [(source.to_string(),false),(source.replace("consent:false,mode:'no',party:viewer,",""),true)]{
        let sources=vec![("schema.q".into(),source)];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d","consent":true,"mode":"yes","party":"dev:a","approved":true,"status":"draft"})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();
        let p=&b.programs.iter().find(|p|p.program.name=="bypass").unwrap().program;let trace=trace(&b,p,&engine);
        let result=engine.mutate("bypass",None,replay_ids::context("dev:b",BTreeMap::from([("doc".into(),Value::Id("d".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
        let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(expect)),"{observations:?}");
    }
}

#[test]fn existence_receipts_keep_the_selected_approvals_inspected_inputs(){
    let source="table approvals:\n  subject: principal\n  unique subject\n  consent: bool\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  approval: approvals\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(approval: approvals):\n  a = approvals[approval] ! else MISSING\n  require a.consent else NO_CONSENT\n  update approvals[approval] {approved:true}\nmutation finish(approval: approvals):\n  require exists approvals[subject = viewer] where .approved else NO_APPROVAL\n  return insert effects {approval}\nmutation bypass(approval: approvals):\n  update approvals[approval] {consent:false,approved:false}\n  return insert effects {approval}\n";
    for (source,expected) in [(source.to_string(),false),(source.replace("consent:false,", ""),true)]{
        let sources=vec![("schema.q".into(),source)];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["approvals"],&serde_json::json!({"id":"a","subject":"dev:clerk","consent":true,"approved":true})).unwrap();engine.seed_at([("approvals".into(),row)],NOW).unwrap();
        let p=&b.programs.iter().find(|p|p.program.name=="bypass").unwrap().program;let trace=trace(&b,p,&engine);
        let result=engine.mutate("bypass",None,replay_ids::context("dev:clerk",BTreeMap::from([("approval".into(),Value::Id("a".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
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
        let result=engine.mutate("bypass",None,replay_ids::context("dev:clerk",BTreeMap::from([("doc".into(),Value::Id("d".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
        let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(expected)),"{observations:?}");
    }
}
#[test]fn multiple_consumptions_preserve_conjunction_and_alternative_structure(){
    let source="table docs:\n  aConsent: bool\n  bConsent: bool\n  aApproved: bool default false\n  bApproved: bool default false\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation approveA(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.aConsent else NO_CONSENT\n  update docs[doc] {aApproved:true}\nmutation approveB(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.bConsent else NO_CONSENT\n  update docs[doc] {bApproved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.aApproved and d.bApproved else NO_APPROVAL\n  update docs[doc] {status:'done'}\nmutation bypass(doc: docs):\n  update docs[doc] {aApproved:false,bApproved:false}\n  update docs[doc] {bConsent:false}\n  update docs[doc] {status:'done'}\n";
    for (source,expected) in [(source.to_string(),false),(source.replace("d.aApproved and d.bApproved", "d.aApproved or d.bApproved"),true),(source.replace("  update docs[doc] {bConsent:false}\n", ""),true),(source.replace("require d.aConsent else", "require d.aConsent and d.bApproved else"),false),(source.replace("require d.aConsent else", "require d.aConsent and d.bApproved else").replace("  update docs[doc] {bConsent:false}\n", ""),true),(source.replace("d.aApproved and d.bApproved","not d.aApproved and d.bApproved").replace("  update docs[doc] {bConsent:false}\n", ""),true)]{
        let sources=vec![("schema.q".into(),source)];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d","aConsent":true,"bConsent":true,"aApproved":true,"bApproved":true,"status":"draft"})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();
        let p=&b.programs.iter().find(|p|p.program.name=="bypass").unwrap().program;let trace=trace(&b,p,&engine);
        let result=engine.mutate("bypass",None,replay_ids::context("dev:clerk",BTreeMap::from([("doc".into(),Value::Id("d".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
        let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(expected)),"{observations:?}");
    }
}
#[test]fn a_filtered_receipt_does_not_freeze_an_unrelated_approvals_inputs(){
    let source="table approvals:\n  subject: principal\n  unique subject\n  consent: bool\n  otherConsent: bool\n  approved: bool default false\n  otherApproved: bool default false\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  approval: approvals\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(approval: approvals):\n  a = approvals[approval] ! else MISSING\n  require a.consent else NO_CONSENT\n  update approvals[approval] {approved:true}\nmutation approveOther(approval: approvals):\n  a = approvals[approval] ! else MISSING\n  require a.otherConsent else NO_CONSENT\n  update approvals[approval] {otherApproved:true}\nmutation finish(approval: approvals):\n  require exists approvals[subject = viewer] where .approved else NO_APPROVAL\n  return insert effects {approval}\nmutation consume(approval: approvals):\n  update approvals[approval] {approved:false,otherApproved:false,otherConsent:false}\n  return insert effects {approval}\n";
    for (source,expected) in [(source.to_string(),true),(source.replace("otherConsent:false", "otherConsent:false,consent:false"),false)]{
        let sources=vec![("schema.q".into(),source)];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["approvals"],&serde_json::json!({"id":"a","subject":"dev:clerk","consent":true,"otherConsent":true,"approved":true,"otherApproved":true})).unwrap();engine.seed_at([("approvals".into(),row)],NOW).unwrap();
        let p=&b.programs.iter().find(|p|p.program.name=="consume").unwrap().program;let trace=trace(&b,p,&engine);
        let result=engine.mutate("consume",None,replay_ids::context("dev:clerk",BTreeMap::from([("approval".into(),Value::Id("a".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
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
        let result=engine.mutate("consume",None,replay_ids::context("dev:clerk",BTreeMap::from([("approval".into(),Value::Id("a".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
        let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(expected)),"{filter} / {changes}: {observations:?}");
    }
}

#[test]fn newly_issued_approval_can_be_consumed_but_not_refreshed_by_ordinary_edits(){
    let source="table docs:\n  consent: bool\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.consent else NO_CONSENT\n  update docs[doc] {approved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approved else NO_APPROVAL\n  return insert effects {doc}\nmutation atomic(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.consent else NO_CONSENT\n  update docs[doc] {approved:true}\n  update docs[doc] {approved:false}\n  return insert effects {doc}\n";
    for (source,expected) in [(source.to_string(),true),(source.replace("{approved:false}","{approved:false,consent:false}"),false),(source.replace("  update docs[doc] {approved:false}","  update docs[doc] {consent:false}\n  update docs[doc] {approved:false}"),false)]{
        let sources=vec![("schema.q".into(),source)];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d","consent":true,"approved":false})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();
        let p=&b.programs.iter().find(|p|p.program.name=="atomic").unwrap().program;let trace=trace(&b,p,&engine);
        let result=engine.mutate("atomic",None,replay_ids::context("dev:clerk",BTreeMap::from([("doc".into(),Value::Id("d".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
        let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(expected)),"{observations:?}");
    }
}

#[test]fn timestamp_receipts_preserve_exact_named_key_conditions(){
    let source="table approvals:\n  subject: principal\n  unique subject\n  consent: bool\n  approvedAt: time ?\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  approval: approvals\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(approval: approvals):\n  a = approvals[approval] ! else MISSING\n  require a.consent else NO_CONSENT\n  update approvals[approval] {approvedAt:now}\nmutation finish(approval: approvals):\n  require exists approvals[subject = viewer, approvedAt = now] else NO_APPROVAL\n  return insert effects {approval}\nmutation consume(approval: approvals):\n  update approvals[approval] {approvedAt:null}\n  return insert effects {approval}\n";
    for (source,expected) in [(source.to_string(),true),(source.replace("{approvedAt:null}","{approvedAt:null,consent:false}"),false)]{
        let sources=vec![("schema.q".into(),source)];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["approvals"],&serde_json::json!({"id":"a","subject":"dev:clerk","consent":true,"approvedAt":NOW})).unwrap();engine.seed_at([("approvals".into(),row)],NOW).unwrap();
        let p=&b.programs.iter().find(|p|p.program.name=="consume").unwrap().program;let trace=trace(&b,p,&engine);
        let result=engine.mutate("consume",None,replay_ids::context("dev:clerk",BTreeMap::from([("approval".into(),Value::Id("a".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
        let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(expected)),"{observations:?}");
    }
}

#[test]fn upsert_issued_approvals_keep_their_inspected_inputs(){
    let source="table docs:\n  consent: bool\n  approved: bool default false\n  read <- allow\n  update <- allow\n  insert <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.consent else NO_CONSENT\n  return upsert docs[doc] {consent:d.consent,approved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approved else NO_APPROVAL\n  return insert effects {doc}\nmutation atomic(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.consent else NO_CONSENT\n  upsert docs[doc] {consent:d.consent,approved:true}\n  update docs[doc] {approved:false}\n  return insert effects {doc}\n";
    for (source,expected) in [(source.to_string(),true),(source.replace("{approved:false}","{approved:false,consent:false}"),false)]{
        let sources=vec![("schema.q".into(),source)];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);assert!(b.security_approval_inputs[&("docs".into(),"approved".into())].contains("consent"));
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d","consent":true,"approved":false})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();
        let p=&b.programs.iter().find(|p|p.program.name=="atomic").unwrap().program;let trace=trace(&b,p,&engine);
        let result=engine.mutate("atomic",None,replay_ids::context("dev:clerk",BTreeMap::from([("doc".into(),Value::Id("d".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
        let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(expected)),"{observations:?}");
    }
}
fn lifecycle_source(complete:&str,advance:&str)->String{
    format!("table roles:\n  principal: principal\n  role: enum('crew','owner')\n  unique principal\n  read <- allow\n  online only\ntable jobs:\n  status: enum('estimate','accepted','active','finished') default 'estimate'\n  data: int default 0\n  read <- allow\n  update <- allow\n  cap 10\n  online only\ntable tasks:\n  job: jobs\n  stage: enum('raw','done') default 'raw'\n  read <- allow\n  update <- allow\n  cap 10\n  online only\nmutation start(job: jobs):\n  require exists roles[principal = viewer,role = 'crew'] else DENIED\n  j = jobs[job] ! else MISSING\n  require j.status = 'accepted' else BAD_STAGE\n  update jobs[job] {{status:'active'}}\nmutation forward(task: tasks):\n  require exists roles[principal = viewer,role = 'crew'] else DENIED\n  t = tasks[task] ! else MISSING\n  require t.stage = 'raw' else BAD_STAGE\n  update tasks[task] {{stage:'done'}}\nmutation finish(job: jobs,otherTask: tasks,touch: bool):\n  require exists roles[principal = viewer,role = 'crew'] else DENIED\n  j = jobs[job] ! else MISSING\n  require j.status = 'active' else BAD_STAGE\n{complete}\nmutation advance(task: tasks,otherJob: jobs,touch: bool):\n  require exists roles[principal = viewer,role = 'crew'] else DENIED\n  t = tasks[task] ! else MISSING\n  require t.stage = 'raw' else BAD_STAGE\n{advance}\n")
}
#[test]fn existing_row_upserts_keep_parent_completion_and_child_window_contracts(){
    for parent_upsert in [false,true]{for child_upsert in [false,true]{if !parent_upsert&&!child_upsert{continue;}
        let mut source=lifecycle_source("  update jobs[job] {status:'finished'}","  update tasks[task] {stage:'done'}").replace("  read <- allow\n  update <- allow\n  cap 10", "  read <- allow\n  insert <- allow\n  update <- allow\n  cap 10");
        if parent_upsert{source=source.replace("update jobs[job] {status:'finished'}", "upsert jobs[job] {status:'finished'}");}
        if child_upsert{source=source.replace("update tasks[task] {stage:'done'}", "upsert tasks[task] {job:t.job,stage:'done'}");}
        let parent=lifecycle_observations(source.clone(),"finish",BTreeMap::from([("job".into(),Value::Id("a".into())),("otherTask".into(),Value::Id("u".into())),("touch".into(),Value::Bool(false))]),"active","accepted");assert!(parent.iter().any(|(site,result)|site.contains("child-stage")&&*result==Some(false)),"{parent_upsert}/{child_upsert}: {parent:?}");
        let child=lifecycle_observations(source,"advance",BTreeMap::from([("task".into(),Value::Id("t1".into())),("otherJob".into(),Value::Id("b".into())),("touch".into(),Value::Bool(false))]),"finished","accepted");assert!(child.iter().any(|(site,result)|site.contains("parent-state")&&*result==Some(false)),"{parent_upsert}/{child_upsert}: {child:?}");
    }}
}
fn lifecycle_observations(source:String,operation:&str,args:BTreeMap<String,Value>,a:&str,b:&str)->Vec<(String,Option<bool>)>{
    let sources=vec![("schema.q".into(),source)];let bound=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let mut engine=Engine::memory(bound.schema.clone(),bound.programs.iter().map(|p|p.program.clone())).unwrap();
    let parent_state=bound.schema.tables["jobs"].columns.iter().find(|(_,kind)|matches!(kind.required(),C::Enum{..})).unwrap().0;
    for (table,mut json) in [("roles",serde_json::json!({"id":"role","principal":"dev:crew","role":"crew"})),("jobs",serde_json::json!({"id":"a","status":a})),("jobs",serde_json::json!({"id":"b","status":b})),("tasks",serde_json::json!({"id":"t1","job":"a"})),("tasks",serde_json::json!({"id":"t2","job":"a"})),("tasks",serde_json::json!({"id":"u","job":"b"}))]{if table=="jobs"&&parent_state!="status"{let fields=json.as_object_mut().unwrap();let value=fields.remove("status").unwrap();fields.insert(parent_state.clone(),value);}let row=snapback4_core::wire::row_from_json(&bound.schema.tables[table],&json).unwrap();engine.seed_at([(table.into(),row)],NOW).unwrap();}
    let p=&bound.programs.iter().find(|p|p.program.name==operation).unwrap().program;let trace=trace(&bound,p,&engine);
    let result=engine.mutate(operation,None,replay_ids::context("dev:crew",args).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}),"{result:?}");
    let after=readback(&engine).unwrap();let observations=trace.take();
    observations.iter().filter_map(|observation|bound.invariants.iter().find(|i|i.site.to_string()==observation.site).map(|inv|(inv.site.file.clone(),lifecycle_judgment(&bound,inv,observation,&observations,&after,"dev:crew",NOW)))).collect()
}
#[test]fn completion_coupling_uses_all_actual_children_not_incidental_writes(){
    for (body,touch,expected) in [
        ("  update jobs[job] {status:'finished'}\n  if touch:\n    update tasks[otherTask] {stage:'raw'}",false,false),
        ("  update jobs[job] {status:'finished'}\n  if touch:\n    update tasks[otherTask] {stage:'done'}",true,false),
        ("  update jobs[job] {status:'finished'}\n  update tasks[otherTask] {stage:'raw'}",true,false),
        ("  update jobs[job] {status:'finished'}\n  for t in tasks where .job = job:\n    update tasks[t.id] {stage:'done'}",true,true),
        ("  update jobs[job] {status:'finished'}\n  for t in tasks where .job = job and .id = otherTask:\n    update tasks[t.id] {stage:'done'}",true,false),
    ]{
        let source=lifecycle_source(body,"  update tasks[task] {stage:'done'}");
        let args=BTreeMap::from([("job".into(),Value::Id("a".into())),("otherTask".into(),Value::Id(if body.contains(".id = otherTask"){"t1"}else{"u"}.into())),("touch".into(),Value::Bool(touch))]);
        let observations=lifecycle_observations(source,"finish",args,"active","active");
        assert!(observations.iter().any(|(site,allowed)|site.contains("child-stage")&&*allowed==Some(expected)),"{body}: {observations:?}");
    }
}
#[test]fn parent_window_coupling_requires_the_exact_changed_parent(){
    for column in ["status","workflow"]{for (body,touch,parent,astate,bstate,expected) in [
        ("  if touch:\n    update jobs[otherJob] {data:1}\n  update tasks[task] {stage:'done'}",false,"b","estimate","active",false),
        ("  if touch:\n    update jobs[otherJob] {status:'finished'}\n  update tasks[task] {stage:'done'}",true,"b","estimate","active",false),
        ("  update jobs[otherJob] {status:'finished'}\n  update tasks[task] {stage:'done'}",true,"a","finished","active",false),
        ("  update jobs[otherJob] {status:'finished'}\n  update tasks[task] {stage:'done'}",true,"a","active","active",true),
        ("  other = jobs[otherJob] ! else MISSING\n  require other.status = 'active' else BAD_STAGE\n  update tasks[task] {stage:'done'}",false,"b","estimate","active",false),
    ]{
        let source=lifecycle_source("  update jobs[job] {status:'finished'}",body).replace("status",column);
        let args=BTreeMap::from([("task".into(),Value::Id("t1".into())),("otherJob".into(),Value::Id(parent.into())),("touch".into(),Value::Bool(touch))]);
        let observations=lifecycle_observations(source,"advance",args,astate,bstate);
        assert!(observations.iter().any(|(site,allowed)|site.contains("parent-state")&&*allowed==Some(expected)),"{body}: {observations:?}");
    }
}
}

#[test]fn an_old_parent_schema_gate_cannot_authorize_retargeted_work(){
    for (old_phase,target,expected) in [("active","b",false),("finished","b",false),("finished","a",true)]{
        let source=lifecycle_source("  update jobs[job] {status:'finished'}","  update tasks[task] {job:otherJob,stage:'done'}").replace("  stage: enum('raw','done') default 'raw'\n  read <- allow\n  update <- allow", &format!("  stage: enum('raw','done') default 'raw'\n  read <- allow\n  update (old,next) <- old.job.status = '{old_phase}'"));
        let args=BTreeMap::from([("task".into(),Value::Id("t1".into())),("otherJob".into(),Value::Id(target.into())),("touch".into(),Value::Bool(false))]);
        let observations=lifecycle_observations(source,"advance",args,old_phase,"estimate");
        assert!(observations.iter().any(|(site,allowed)|site.contains("parent-state")&&*allowed==Some(expected)),"{old_phase}/{target}: {observations:?}");
    }
}

#[test]fn creating_approvals_bind_checked_arguments_and_positive_defaults(){
    let source="table docs:\n  consent: bool\n  mode: enum('safe','unsafe')\n  party: principal\n  approved: bool default true\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation create(consent: bool,mode: enum('safe','unsafe'),party: principal):\n  require consent and mode = 'safe' and party = viewer else NO_CONSENT\n  return insert docs {consent,mode,party}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approved else NO_APPROVAL\n  return insert effects {doc}\nmutation consume(doc: docs):\n  update docs[doc] {approved:false}\nCHANGES  return insert effects {doc}\n";
    for variant in [source.to_string(),source.replace("{consent,mode,party}","{consent:consent and true,mode,party}"),source.replace("{consent,mode,party}","{consent:not not consent,mode,party}"),source.replace("approved: bool default true","approved: bool default false").replace("insert docs {consent,mode,party}","insert docs {consent,mode,party,approved:true}"),source.replace("approved: bool default true","approvedAt: time ? default now").replace("require d.approved else","require d.approvedAt != null else").replace("{approved:false}","{approvedAt:null}")]{
        for changes in ["","consent:false","mode:'unsafe'","party:viewer"]{
            let expected=changes.is_empty();let source=variant.replace("CHANGES",&if expected{String::new()}else{format!("  update docs[doc] {{{changes}}}\n")});let sources=vec![("schema.q".into(),source)];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
            let stamp=if b.schema.tables["docs"].columns.contains_key("approved"){"approved"}else{"approvedAt"};for column in ["consent","mode","party"]{assert!(b.security_approval_inputs[&("docs".into(),stamp.into())].contains(column));}
            let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let created=engine.mutate("create",None,replay_ids::context("dev:a",BTreeMap::from([("consent".into(),Value::Bool(true)),("mode".into(),Value::String("safe".into())),("party".into(),Value::Id("dev:a".into()))])).at(NOW)).unwrap();let snapback4_core::WriteState::Sent{result:row,..}=created.state else{panic!("create refused");};let id=row.field("id").unwrap().clone();
            let p=&b.programs.iter().find(|p|p.program.name=="consume").unwrap().program;let trace=trace(&b,p,&engine);let result=engine.mutate("consume",None,replay_ids::context("dev:b",BTreeMap::from([("doc".into(),id)])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(expected)),"{stamp}/{changes}: {observations:?}");
        }
    }
}

#[test]fn retained_creation_approval_requires_invalidation_or_exact_reapproval(){
    let source="table docs:\n  consent: bool\n  approved: bool default true\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create(consent: bool):\n  require consent else NO_CONSENT\n  return insert docs {consent}\nmutation edit(doc: docs,reapprove: bool):\n  d = docs[doc] ! else MISSING\nBODY";
    for (body,allowed) in [
        ("  update docs[doc] {consent:false}\n",false),
        ("  require d.consent else NO_CONSENT\n  update docs[doc] {consent:false,approved:true}\n",false),
        ("  saved = d.consent\n  require saved else NO_CONSENT\n  update docs[doc] {consent:false,approved:true}\n",false),
        ("  update docs[doc] {consent:false,approved:d.approved}\n",false),
        ("  update docs[doc] {consent:false,approved:false}\n",true),
        ("  require reapprove else NO_CONSENT\n  update docs[doc] {consent:reapprove,approved:true}\n",true),
        ("  if reapprove:\n    require reapprove else NO_CONSENT\n    update docs[doc] {consent:reapprove,approved:true}\n  else:\n    update docs[doc] {consent:false,approved:d.approved}\n",false),
    ]{
        let sources=vec![("schema.q".into(),source.replace("BODY",body))];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d","consent":!(body.contains("consent:reapprove")&&!body.contains("if reapprove")),"approved":true})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();
        let p=&b.programs.iter().find(|p|p.program.name=="edit").unwrap().program;let trace=trace(&b,p,&engine);let result=engine.mutate("edit",None,replay_ids::context("dev:a",BTreeMap::from([("doc".into(),Value::Id("d".into())),("reapprove".into(),Value::Bool(!body.contains("if reapprove")))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));let observations=trace.take();assert_eq!(!observations.iter().any(|o|o.site.starts_with("$derived/")&&o.allowed==Some(false)),allowed,"{body}: {observations:?}");
    }
}

#[test]fn copied_positive_stamp_cannot_refresh_a_consumed_receipt(){
    let source="table docs:\n  consent: bool\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.consent else NO_CONSENT\n  update docs[d.id] {approved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approved else NO_APPROVAL\n  return insert effects {doc}\nmutation copyAndConsume(doc: docs):\n  saved = docs[doc] ! else MISSING\n  update docs[doc] {approved:false}\n  update docs[doc] {consent:false}\n  update docs[doc] {approved:saved.approved}\n  update docs[doc] {approved:false}\n  return insert effects {doc}\n";
    let sources=vec![("schema.q".into(),source.into())];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);assert!(b.security_approval_inputs[&("docs".into(),"approved".into())].contains("consent"));
    let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d","consent":true,"approved":true})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();
    let p=&b.programs.iter().find(|p|p.program.name=="copyAndConsume").unwrap().program;let trace=trace(&b,p,&engine);let result=engine.mutate("copyAndConsume",None,replay_ids::context("dev:a",BTreeMap::from([("doc".into(),Value::Id("d".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(false)),"{observations:?}");
}
#[test]fn a_child_terminal_self_loop_cannot_hide_unfinished_children(){
    let mut source=lifecycle_source("  update jobs[job] {status:'finished'}","  update tasks[task] {stage:'done'}");
    source.push_str("mutation noop(task: tasks):\n  t = tasks[task] ! else MISSING\n  require t.stage = 'done' else BAD_STAGE\n  update tasks[task] {stage:'done'}\n");
    let observations=lifecycle_observations(source,"finish",BTreeMap::from([("job".into(),Value::Id("a".into())),("otherTask".into(),Value::Id("u".into())),("touch".into(),Value::Bool(false))]),"active","accepted");assert!(observations.iter().any(|(site,result)|site.contains("child-stage")&&*result==Some(false)),"{observations:?}");
}

#[test]fn retained_positive_dependencies_cannot_hide_invalidated_upstream_inputs(){
    let source="table docs:\n  consent: bool\n  aApproved: bool default false\n  bApproved: bool default false\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation approveA(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.consent else NO_CONSENT\n  update docs[doc] {aApproved:true}\nmutation approveB(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.aApproved else NO_APPROVAL\n  update docs[doc] {bApproved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.bApproved else NO_APPROVAL\n  return insert effects {doc}\nmutation bypass(doc: docs):\n  saved = docs[doc] ! else MISSING\n  update docs[doc] {aApproved:false,bApproved:false}\nCHANGES  update docs[doc] {aApproved:saved.aApproved}\n  return insert effects {doc}\n";
    for (changes,expected) in [("",true),("  update docs[doc] {consent:false}\n",false)]{
        let sources=vec![("schema.q".into(),source.replace("CHANGES",changes))];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d","consent":true,"aApproved":true,"bApproved":true})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();let p=&b.programs.iter().find(|p|p.program.name=="bypass").unwrap().program;let trace=trace(&b,p,&engine);let result=engine.mutate("bypass",None,replay_ids::context("dev:a",BTreeMap::from([("doc".into(),Value::Id("d".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(expected)),"{observations:?}");
    }
}
#[test]fn wrapped_old_timestamps_do_not_gain_recording_custody(){
    let source="table docs:\n  consent: bool\n  approvedAt: time ?\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.consent else NO_CONSENT\n  update docs[doc] {approvedAt:now + 0ms}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approvedAt != null else NO_APPROVAL\n  return insert effects {doc}\nmutation bypass(doc: docs,stamp: time):\n  saved = docs[doc] ! else MISSING\n  update docs[doc] {approvedAt:null}\n  update docs[doc] {consent:false}\n  update docs[doc] {approvedAt:STAMP}\n  update docs[doc] {approvedAt:null}\n  return insert effects {doc}\n";
    for (stamp,expected) in [("saved.approvedAt + 0ms",Some(false)),("(saved.approvedAt ?? now) + 0ms",None),("stamp",None),("copy + 0ms",Some(false))]{
        let sources=vec![("schema.q".into(),source.replace("STAMP",stamp).replace("saved = docs[doc] ! else MISSING\n", "saved = docs[doc] ! else MISSING\n  require saved.approvedAt != null else NO_APPROVAL\n  copy = saved.approvedAt\n"))];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d","consent":true,"approvedAt":NOW})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();let p=&b.programs.iter().find(|p|p.program.name=="bypass").unwrap().program;let trace=trace(&b,p,&engine);let result=engine.mutate("bypass",None,replay_ids::context("dev:a",BTreeMap::from([("doc".into(),Value::Id("d".into())),("stamp".into(),Value::Int(NOW))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==expected),"{stamp}: {observations:?}");
    }
}
#[test]fn a_note_policy_does_not_authorize_unchecked_stage_work(){
    let source=lifecycle_source("  update jobs[job] {status:'finished'}","  update tasks[task] {stage:'done'}").replace("  stage: enum('raw','done') default 'raw'","  stage: enum('raw','done') default 'raw'\n  note: text ? write <- exists jobs[.job, status = 'active']");
    let observations=lifecycle_observations(source,"advance",BTreeMap::from([("task".into(),Value::Id("t1".into())),("otherJob".into(),Value::Id("b".into())),("touch".into(),Value::Bool(false))]),"estimate","active");assert!(observations.iter().any(|(site,result)|site.contains("parent-state")&&*result==Some(false)),"{observations:?}");
}

#[test]fn uncertain_receipt_cuts_do_not_fall_back_to_a_raw_positive_flag(){
    let mut source="table docs:\n  consent: bool\n  approved: bool default false\nEXTRAS  read <- allow\n  update <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.consent else NO_CONSENT\n  update docs[doc] {approved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approved else NO_APPROVAL\n  return insert effects {doc}\nmutation bypass(doc: docs):\n  update docs[doc] {consent:false,CLEARED}\n  return insert effects {doc}\n".to_string();source=source.replace("EXTRAS",&(0..9).map(|n|format!("  extra{n}Approved: bool default true\n")).collect::<String>()).replace("CLEARED",&(0..9).map(|n|format!("extra{n}Approved:false")).collect::<Vec<_>>().join(","));let sources=vec![("schema.q".into(),source)];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d","consent":true,"approved":true})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();let p=&b.programs.iter().find(|p|p.program.name=="bypass").unwrap().program;let trace=trace(&b,p,&engine);let result=engine.mutate("bypass",None,replay_ids::context("dev:a",BTreeMap::from([("doc".into(),Value::Id("d".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed.is_none()),"{observations:?}");assert!(!observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(true)),"{observations:?}");
}

#[test]fn positive_approval_counts_govern_sibling_effects(){
    let source="table docs:\n  read <- allow\n  online only\ntable approvals:\n  doc: docs\n  cap 10\n  read <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation guarded(doc: docs):\n  require count(approvals[doc = doc]) > 0 else NO_APPROVAL\n  return insert effects {doc}\nmutation bypass(doc: docs):\n  return insert effects {doc}\n";
    let sources=vec![("schema.q".into(),source.into())];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d"})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();let p=&b.programs.iter().find(|p|p.program.name=="bypass").unwrap().program;let trace=trace(&b,p,&engine);let result=engine.mutate("bypass",None,replay_ids::context("dev:a",BTreeMap::from([("doc".into(),Value::Id("d".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));assert!(trace.take().iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(false)));
}

#[test]fn unchecked_reapproval_does_not_refresh_the_effect_receipt(){
    let source="table docs:\n  consent: bool\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.consent else NO_CONSENT\n  update docs[doc] {approved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approved else NO_APPROVAL\n  return insert effects {doc}\nmutation bypass(doc: docs,replacement: bool):\n  d = docs[doc] ! else MISSING\nBODY  return insert effects {doc}\n";
    for (body,expected) in [
        ("  require d.consent else NO_CONSENT\n  update docs[doc] {consent:false,approved:true}\n",Some(false)),
        ("  require replacement else NO_CONSENT\n  update docs[doc] {consent:replacement,approved:true}\n",Some(true)),
        ("  require d.consent or replacement else NO_CONSENT\n  update docs[doc] {consent:false,approved:true}\n",Some(true)),
        ("  require d.consent else NO_CONSENT\n  update docs[doc] {approved:false,consent:false}\n  update docs[doc] {approved:true}\n",Some(false)),
    ]{
        let sources=vec![("schema.q".into(),source.replace("BODY",body))];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d","consent":true,"approved":true})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();
        let p=&b.programs.iter().find(|p|p.program.name=="bypass").unwrap().program;let trace=trace(&b,p,&engine);let result=engine.mutate("bypass",None,replay_ids::context("dev:a",BTreeMap::from([("doc".into(),Value::Id("d".into())),("replacement".into(),Value::Bool(true))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==expected),"{body}: {observations:?}");
    }
}

#[test]fn shared_reapproval_helper_selects_the_executed_invocation(){
    let source="table docs:\n  score: int\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\nfn checked(doc: docs,score: int):\n  require score > 0 else BAD_SCORE\n  update docs[doc] {score,approved:true}\n  return null\nmutation edit(doc: docs,first: int,second: int,choice: bool):\n  if choice:\n    checked(doc,first)\n  else:\n    checked(doc,second)\n";
    let sources=vec![("schema.q".into(),source.into())];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    for choice in [true,false]{let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d","score":1,"approved":true})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();let p=&b.programs.iter().find(|p|p.program.name=="edit").unwrap().program;let trace=trace(&b,p,&engine);let result=engine.mutate("edit",None,replay_ids::context("dev:a",BTreeMap::from([("doc".into(),Value::Id("d".into())),("first".into(),Value::Int(if choice{2}else{-1})),("second".into(),Value::Int(if choice{-1}else{2})),("choice".into(),Value::Bool(choice))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));let observations=trace.take();assert!(observations.iter().any(|o|o.site.starts_with("$derived/")&&o.allowed==Some(true)),"{observations:?}");assert!(!observations.iter().any(|o|o.allowed==Some(false)),"{observations:?}");}
}

#[test]fn ambiguous_bool_and_time_births_and_reissues_remain_unknown(){
    let base="table docs:\n  consent: bool\n  approved: bool default false\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.consent else CONSENT\n  update docs[doc] {approved:true}\nmutation guarded(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approved else APPROVAL\n  return insert effects {doc}\nmutation bypass(doc: docs,flag: bool):\nBODY";
    for time in [false,true]{for creating in [false,true]{
        let body=if creating{"  born = insert docs {consent:false,approved:flag}\n  return insert effects {doc:born.id}\n"}else{"  update docs[doc] {consent:false,approved:flag}\n  return insert effects {doc}\n"};
        let mut source=base.replace("BODY",body);if time{source=source.replace("approved: bool default false","approvedAt: time ?").replace("flag: bool","flag: time").replace("approved:true","approvedAt:now").replace("approved:flag","approvedAt:flag").replace("require d.approved else","require d.approvedAt != null else");}
        let sources=vec![("schema.q".into(),source)];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let mut data=serde_json::json!({"id":"d","consent":true,"approved":false});if time{data.as_object_mut().unwrap().remove("approved");data["approvedAt"]=serde_json::Value::Null;}let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&data).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();let p=&b.programs.iter().find(|p|p.program.name=="bypass").unwrap().program;let trace=trace(&b,p,&engine);let result=engine.mutate("bypass",None,replay_ids::context("dev:a",BTreeMap::from([("doc".into(),Value::Id("d".into())),("flag".into(),if time{Value::Int(NOW)}else{Value::Bool(true)})])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed.is_none()),"{time}/{creating}: {observations:?}");assert!(!observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(false)),"{observations:?}");
    }}
}

}

#[cfg(test)]mod sec10_conditional_contracts{use super::*;
#[test]fn sibling_scope_keeps_the_unrestricted_branch_and_copied_inputs(){
    let source="table docs:\n  restricted: bool default false\n  consent: bool\n  approved: bool default false\n  stage: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.consent else CONSENT\n  update docs[doc] {consent:not not d.consent,approved:true}\nmutation guarded(doc: docs):\n  d = docs[doc] ! else MISSING\n  if d.restricted:\n    require d.approved else APPROVAL\n    update docs[doc] {stage:'done'}\n  else:\n    update docs[doc] {stage:'done'}\nmutation bypass(doc: docs,change: bool):\n  update docs[doc] {approved:false}\n  if change:\n    update docs[doc] {consent:false}\n  update docs[doc] {stage:'done'}\n";
    let sources=vec![("schema.q".into(),source.into())];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);assert!(b.security_approval_inputs[&("docs".into(),"approved".into())].contains("consent"));
    for (restricted,approved,change,expected) in [(false,false,false,true),(true,false,false,false),(true,true,false,true),(true,true,true,false)]{
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d","restricted":restricted,"consent":true,"approved":approved,"stage":"draft"})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();let p=&b.programs.iter().find(|p|p.program.name=="bypass").unwrap().program;let trace=trace(&b,p,&engine);let result=engine.mutate("bypass",None,replay_ids::context("dev:a",BTreeMap::from([("doc".into(),Value::Id("d".into())),("change".into(),Value::Bool(change))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(expected)),"{restricted}/{approved}/{change}: {observations:?}");
    }
}
}

#[cfg(test)]mod sec10_dynamic_recordings{use super::*;
#[test]fn dynamic_positive_recordings_retain_dependencies_across_transactions(){
    let source="table docs:\n  consent: bool\n  approved: bool default false\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nISSUE\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approved else APPROVAL\n  return insert effects {doc}\nmutation consume(doc: docs,change: bool):\n  update docs[doc] {approved:false}\n  if change:\n    update docs[doc] {consent:false}\n  return insert effects {doc}\n";
    for (issue,has_doc,has_consent,seed) in [("mutation issue(consent: bool,decision: bool):\n  require consent else CONSENT\n  return insert docs {consent,approved:decision}",false,true,false),("mutation issue(doc: docs,decision: bool):\n  d = docs[doc] ! else MISSING\n  require d.consent else CONSENT\n  return update docs[doc] {approved:decision}",true,false,true),("mutation issue(doc: docs,consent: bool,decision: bool):\n  require consent else CONSENT\n  return upsert docs[doc] {consent,approved:decision}",true,true,true),("mutation issue(doc: docs,consent: bool,decision: bool):\n  require consent else CONSENT\n  return upsert docs[doc] {consent,approved:decision}",true,true,false)]{
        let sources=vec![("schema.q".into(),source.replace("ISSUE",issue))];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);assert!(b.security_approval_inputs[&("docs".into(),"approved".into())].contains("consent"));
        for change in [false,true]{let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();if seed{let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d","consent":true,"approved":false})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();}let mut args=BTreeMap::from([("decision".into(),Value::Bool(true))]);if has_doc{args.insert("doc".into(),Value::Id("d".into()));}if has_consent{args.insert("consent".into(),Value::Bool(true));}let result=engine.mutate("issue",None,replay_ids::context("dev:a",args).at(NOW)).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}),"{issue}: {result:?}");let rows=readback(&engine).unwrap();let id=rows["docs"][0].field("id").unwrap().clone();let p=&b.programs.iter().find(|p|p.program.name=="consume").unwrap().program;let trace=trace(&b,p,&engine);let result=engine.mutate("consume",None,replay_ids::context("dev:a",BTreeMap::from([("doc".into(),id),("change".into(),Value::Bool(change))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(!change)),"{issue}/{seed}/{change}: {observations:?}");}
    }
}
}

#[cfg(test)]mod sec10_snapshot_identity{use super::*;
#[test]fn changed_same_table_dereferences_cannot_refresh_trusted_receipts(){
    let source="table docs:\n  peer: docs\n  score: int\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.score = d.peer.score else INVALID\n  update docs[doc] {approved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approved else APPROVAL\n  return insert effects {doc}\nmutation replace(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.score = d.peer.score else INVALID\n  update docs[d.peer] {score:2}\n  update docs[doc] {score:2,approved:true}\n  update docs[doc] {approved:false}\n  return insert effects {doc}\n";
    let sources=vec![("schema.q".into(),source.into())];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let rows=[serde_json::json!({"id":"d","peer":"p","score":1,"approved":true}),serde_json::json!({"id":"p","peer":"p","score":1,"approved":false})].into_iter().map(|row|("docs".into(),snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&row).unwrap())).collect::<Vec<_>>();engine.seed_at(rows,NOW).unwrap();let p=&b.programs.iter().find(|p|p.program.name=="replace").unwrap().program;let trace=trace(&b,p,&engine);let result=engine.mutate("replace",None,replay_ids::context("dev:a",BTreeMap::from([("doc".into(),Value::Id("d".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed.is_none()),"{observations:?}");assert!(!observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed.is_some()),"{observations:?}");
}
}

#[cfg(test)]mod sec10_metadata_receipts{use super::*;
#[test]fn consumed_approval_keeps_checked_edit_metadata_as_data(){
    let source="table docs:\n  authorizationRouteUpdatedAt: time ?\n  approved: bool default false\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.authorizationRouteUpdatedAt != null else NO_ROUTE\n  update docs[doc] {approved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approved else NO_APPROVAL\n  update docs[doc] {status:'done'}\nmutation bypass(doc: docs):\n  update docs[doc] {approved:false,authorizationRouteUpdatedAt:null}\n  update docs[doc] {status:'done'}\n";
    for (source,expected) in [(source.to_string(),false),(source.replace(",authorizationRouteUpdatedAt:null",""),true)]{
        let sources=vec![("schema.q".into(),source)];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        assert!(b.security_approval_inputs[&("docs".into(),"approved".into())].contains("authorizationRouteUpdatedAt"));
        assert!(!b.security_approval_inputs.contains_key(&("docs".into(),"authorizationRouteUpdatedAt".into())));
        let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d","authorizationRouteUpdatedAt":1700000000000i64,"approved":true,"status":"draft"})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();
        let p=&b.programs.iter().find(|p|p.program.name=="bypass").unwrap().program;let trace=trace(&b,p,&engine);
        let result=engine.mutate("bypass",None,replay_ids::context("dev:clerk",BTreeMap::from([("doc".into(),Value::Id("d".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
        let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(expected)),"{observations:?}");
    }
}}

#[cfg(test)]mod sec10_deleted_population_receipts{use super::*;
#[test]fn deleted_count_and_exists_approvals_without_current_images_stay_unknown(){
    let source="table docs:\n  read <- allow\n  online only\ntable approvals:\n  doc: docs\n  read <- allow\n  delete <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation consume(doc: docs,approval: approvals):\n  require CONTRACT else NO_APPROVAL\n  delete approvals[approval]\n  return insert effects {doc}\nmutation bypass(doc: docs):\n  return insert effects {doc}\n";
    for contract in ["count(approvals[doc = doc]) > 0","not (count(approvals[doc = doc]) = 0)","(count(approvals[doc = doc]) > 0) = true","exists approvals[doc = doc]","exists docs[id = doc] where (exists approvals[doc = .id])","exists docs[id = doc] where (count(approvals[doc = .id]) > 0)"]{
        let sources=vec![("schema.q".into(),source.replace("CONTRACT",contract))];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        for (operation,seed_approval,expected) in [("consume",true,None),("bypass",false,Some(false))]{
            let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=|table:&str,value:serde_json::Value|snapback4_core::wire::row_from_json(&b.schema.tables[table],&value).unwrap();let mut rows=vec![("docs".into(),row("docs",serde_json::json!({"id":"d"})))];if seed_approval{rows.push(("approvals".into(),row("approvals",serde_json::json!({"id":"a","doc":"d"}))));}engine.seed_at(rows,NOW).unwrap();
            let p=&b.programs.iter().find(|p|p.program.name==operation).unwrap().program;let trace=trace(&b,p,&engine);let mut args=BTreeMap::from([("doc".into(),Value::Id("d".into()))]);if operation=="consume"{args.insert("approval".into(),Value::Id("a".into()));}
            let result=engine.mutate(operation,None,replay_ids::context("dev:a",args).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));let observations=trace.take();let sibling=observations.iter().filter(|o|o.site.contains("sibling-approval")).collect::<Vec<_>>();assert!(!sibling.is_empty(),"{contract}: {observations:?}");assert!(sibling.iter().all(|o|o.allowed==expected),"{contract}/{operation}: {observations:?}");
        }
    }
}}

#[cfg(test)]mod sec10_born_deleted_receipts{use super::*;
#[test]fn transaction_local_approval_birth_and_consumption_keep_uncertainty(){
    let source="table docs:\n  read <- allow\n  online only\ntable approvals:\n  doc: docs\n  approved: bool default true\n  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation consume(doc: docs):\n  a = insert approvals {doc}\n  require CONTRACT else NO_APPROVAL\n  CLEAR\n  delete approvals[a.id]\n  return insert effects {doc}\nmutation guarded(doc: docs):\n  require CONTRACT else NO_APPROVAL\n  return insert effects {doc}\nmutation bypass(doc: docs):\n  return insert effects {doc}\n";
    for contract in ["count(approvals[doc = doc] where .approved) > 0","exists approvals[doc = doc] where .approved","exists docs[id = doc] where (exists approvals[doc = .id] where .approved)"]{for clear in ["","update approvals[a.id] {approved:false}"]{
        let sources=vec![("schema.q".into(),source.replace("CONTRACT",contract).replace("CLEAR",clear))];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        for (operation,expected) in [("consume",None),("bypass",Some(false))]{
            let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=snapback4_core::wire::row_from_json(&b.schema.tables["docs"],&serde_json::json!({"id":"d"})).unwrap();engine.seed_at([("docs".into(),row)],NOW).unwrap();let p=&b.programs.iter().find(|p|p.program.name==operation).unwrap().program;let trace=trace(&b,p,&engine);let result=engine.mutate(operation,None,replay_ids::context("dev:a",BTreeMap::from([("doc".into(),Value::Id("d".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));let observations=trace.take();let siblings=observations.iter().filter(|o|o.site.contains("sibling-approval")).collect::<Vec<_>>();assert!(!siblings.is_empty(),"{contract}/{clear}/{operation}: {observations:?}");assert!(siblings.iter().all(|o|o.allowed==expected),"{contract}/{clear}/{operation}: {observations:?}");
        }
    }}
}}

#[cfg(test)]mod sec10_deleted_metadata{use super::*;
#[test]fn deleting_ordinary_metadata_cannot_consume_a_complete_approval_prerequisite(){
    let source="table docs:\n  approved: bool default true\n  read <- allow\n  online only\ntable routeLogs:\n  doc: docs\n  authorizationRouteUpdatedAt: time ?\n  read <- allow\n  delete <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation guarded(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approved and exists routeLogs[doc = doc] where .authorizationRouteUpdatedAt != null else NO_APPROVAL\n  return insert effects {doc}\nmutation bypass(doc: docs,route: routeLogs):\n  delete routeLogs[route]\n  return insert effects {doc}\n";
    let sources=vec![("schema.q".into(),source.into())];let b=super::super::super::derived::augmented(&sources,&crate::compile(&sources));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=|table:&str,value:serde_json::Value|snapback4_core::wire::row_from_json(&b.schema.tables[table],&value).unwrap();engine.seed_at([("docs".into(),row("docs",serde_json::json!({"id":"d","approved":true}))),("routeLogs".into(),row("routeLogs",serde_json::json!({"id":"r","doc":"d","authorizationRouteUpdatedAt":123})))],NOW).unwrap();let p=&b.programs.iter().find(|p|p.program.name=="bypass").unwrap().program;let trace=trace(&b,p,&engine);let result=engine.mutate("bypass",None,replay_ids::context("dev:a",BTreeMap::from([("doc".into(),Value::Id("d".into())),("route".into(),Value::Id("r".into()))])).at(NOW).with_fixture_trace(trace.clone())).unwrap();assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));let observations=trace.take();assert!(observations.iter().any(|o|o.site.contains("sibling-approval")&&o.allowed==Some(false)),"{observations:?}");
}}
