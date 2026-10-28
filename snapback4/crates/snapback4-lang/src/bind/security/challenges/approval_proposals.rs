//! Correlated literal premises for receipt-question replay, never admission.
// @ref LLP 3000.036.004.006#approval-questions — source premises only order actual engine calls within the existing work budget.
use super::*;
pub(super) fn prioritize(bound:&Bound,p:&Program,cases:Vec<BTreeMap<String,Value>>)->Vec<BTreeMap<String,Value>>{
    if !bound.invariants.iter().any(|i|i.site.file.contains("/sec11-approval-")&&i.operation.as_deref()==Some(p.name.as_str())){return cases;}
    fn equal(e:&ir::Expr,values:&mut BTreeMap<String,Value>){
        use ir::{Expr as E,BinaryOp as B};
        match e{E::Binary{op:B::And,left,right}=>{equal(left,values);equal(right,values);},E::Binary{op:B::Eq|B::Gte|B::Lte,left,right}=>for (a,b) in [(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())]{if let (E::Variable(name),E::Literal(value))=(a,b){values.insert(name.clone(),value.clone());}},_=>{}}
    }
    fn paths(body:&[ir::Stmt],mut states:Vec<BTreeMap<String,Value>>)->Vec<BTreeMap<String,Value>>{
        use ir::Stmt as S;
        for stmt in body{match stmt{
            S::Require{condition,..}=>for state in &mut states{equal(condition,state)},
            S::If{condition,then_body,else_body}=>{
                let mut yes=states.clone();for state in &mut yes{equal(condition,state);}
                states=paths(then_body,yes).into_iter().chain(paths(else_body,states)).take(16).collect();
            },_=>{},
        }}states
    }
    let premises=paths(&p.body,vec![BTreeMap::new()]);let mut out=Vec::new();
    // Preserve all sampled identities. New combinations change literal scalar
    // premises only; engine argument validation and every guard still run.
    for base in cases.iter().take(8){for premise in &premises{
        let mut args=base.clone();for (name,value) in premise{if p.args.contains_key(name){args.insert(name.clone(),value.clone());}}
        if !out.contains(&args){out.push(args);}if out.len()==32{break;}
    }if out.len()==32{break;}}
    for args in cases{if !out.contains(&args){out.push(args);}}
    out.truncate(512);out
}
