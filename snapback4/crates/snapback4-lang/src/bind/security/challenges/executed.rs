//! Authored write boundaries and compiler-typed committed mutation payloads.
// @ref LLP 3000.036.004#151-every-executed-write — no net-image inference for intermediate writes.
use super::*;
use snapback4_core::engine::fixture_trace::{Trace,Intent};
pub(super) fn trace(bound:&Bound,p:&Program)->Trace {
    Trace::new(bound.invariants.iter().filter(|inv|!matches!(inv.target.as_str(),"read"|"always")&&inv.operation.as_ref().is_none_or(|op|op==&p.name)).filter_map(|inv|Some(Intent{
        site:inv.site.to_string(),table:inv.table.clone(),column:inv.column.clone(),policy:inv.policy.clone()?,
        effects:super::super::effects(inv).iter().map(|word|super::super::effect(word)).collect(),
    })).collect())
}
pub(super) fn record(bound:&Bound,p:&Program,trace:&Trace,result:&snapback4_core::WriteState,after:&BTreeMap<String,Vec<Value>>,initial:&BTreeMap<String,Vec<Value>>,viewer:&str,steps:&[histories::Step],engine:&mut Engine,out:&mut Campaign){
    for observation in trace.take(){
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
            if !histories::typed_disclosure_image(&bp.result,data,&inv.table,key,inv.column.as_deref(),row,Some(policy)){
                out.unsupported.insert(format!("{} / {}: returned policy image differs from committed image; disclosure boundary uncovered",p.name,inv.target_label()));continue;
            }
            if !out.reserve(1){return;}
            if policy_in(bound,inv,after,viewer,None,row,engine)!=Ok(false){continue;}
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
