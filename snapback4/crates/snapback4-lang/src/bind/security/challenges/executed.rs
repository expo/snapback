//! Authored write boundaries and compiler-typed committed mutation payloads.
// @ref LLP 3000.036.004#151-every-executed-write — no net-image inference for intermediate writes.
use super::*;
use snapback4_core::engine::fixture_trace::{Trace,Intent};
fn provisioning(p:&Program)->bool {p.name.rsplit('.').next()==Some("provision")}
// @ref LLP 3000.036.004.000#9-integration-24-wave-26-precision — exempt only an exact executed provision image, never a returned preimage.
const PROVISION_RESULT:&str="$security.provision-result/";
pub(super) fn trace(bound:&Bound,p:&Program)->Trace {
    let mut intents=Vec::new();
    for inv in bound.invariants.iter().filter(|inv|!matches!(inv.target.as_str(),"read"|"always")&&inv.operation.as_ref().is_none_or(|op|op==&p.name)) {
        for word in super::super::effects(inv) {
            let concrete=if inv.policy.is_none(){inv.syntax.clone().map(|syntax|{
                let bound=bound.clone();let inv=inv.clone();let insert=word=="insert";
                snapback4_core::engine::fixture_trace::ConcretePredicate(std::sync::Arc::new(move |rows,row,viewer,now|{
                    if insert&&super::super::write_intent::empty_creation(&bound,&inv,None,row){return Some(true);}
                    super::super::concrete::evaluate(&syntax,row,rows,&bound.schema,viewer,&inv.table,now)
                }))
            })}else{None};
            intents.push(Intent {
                paired:super::super::derived::is_derived(inv)&&inv.policy.as_ref().is_some_and(|r|r.any_term(&|t|matches!(t,RuleTerm::OldField(_)|RuleTerm::NextField(_)))),
                concrete,site:inv.site.to_string(),table:inv.table.clone(),column:inv.column.clone(),
                policy:super::super::write_intent::policy(bound,inv,word).unwrap_or(RuleExpr::Allow),
                effects:vec![super::super::effect(word)],
            });
        }
    }
    // A private executed-write witness exempts only the operator provisioner's
    // own roster result. It never exempts an ordinary query or a different row.
    if provisioning(p){for table in ir::write_tables(p).into_iter().map(|(table,_)|table).collect::<BTreeSet<_>>() {
        if super::super::privilege::role_columns(bound,&table).is_empty(){continue;}
        intents.push(Intent{paired:false,concrete:None,site:format!("{PROVISION_RESULT}{table}"),table,column:None,
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
