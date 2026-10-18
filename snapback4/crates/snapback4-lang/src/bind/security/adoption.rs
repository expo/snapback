//! Author-owned intent starts with a reviewable draft, never inferred policy.
// @ref LLP 3000.036.004#103-adoption — syntactic coverage is distinct from a proved invariant.
use super::*;

pub(super) fn missing(bound:&Bound)->Vec<String>{
    bound.schema.visible_tables().filter(|(name,t)| {
        ([&t.rules.read,&t.rules.insert,&t.rules.update,&t.rules.delete].iter().any(|r|!matches!(r,RuleExpr::Deny)) || !t.written_by.is_empty())
            && !bound.invariants.iter().any(|i| &i.table==*name)
    }).map(|(name,_)|name.clone()).collect()
}

/// Suggested declarations mirror enforcement, not the product specification.
/// The caller must keep this outside the compiled .q source set.
pub fn draft(bound:&Bound)->String{
    let mut out=String::from("-- DRAFT: NOT ACCEPTED. Generated from access rules, not the app specification.\n-- Confirm or correct each policy against the spec, then copy chosen declarations\n-- into an authored snapback/*.q file. This .q.draft file is never compiled.\n-- Check current roles, grant revocation, count/existence privacy, deadlines and\n-- required evidence separately. A copied wrong rule cannot catch itself.\n-- snapback4 guide security\n\n");
    for (name,t) in bound.schema.visible_tables(){
        for (effect,rule) in [("read",&t.rules.read),("insert",&t.rules.insert),("update",&t.rules.update),("delete",&t.rules.delete)] {
            if matches!(rule,RuleExpr::Deny)||covered(bound,name,effect){continue;}
            let predicate=if matches!(rule,RuleExpr::Public{..}){"allow".into()}else{rule.quarry()};
            if predicate.contains('$') || effect=="update" && t.update_transition {
                out.push_str(&format!("-- {name}.{effect}: write intent explicitly; captured/transition rule: {predicate}\n"));
            }else {out.push_str(&format!("-- Candidate from {name} {effect} rule; AUTHOR MUST CONFIRM.\ninvariant {name}.{effect} only {predicate}\n"));}
        }
        for (column,authority) in &t.written_by {
            out.push_str(&format!("-- {name}.{column}: effective field-owner patch authority .{} = viewer bypasses the table update rule; declare column-write intent from the spec.\n",authority.owner));
        }
    }
    out
}
fn covered(bound:&Bound,table:&str,effect:&str)->bool{
    bound.invariants.iter().any(|i|i.table==table && i.operation.is_none() && i.column.is_none()
        && (i.target==effect || i.target=="write" && matches!(effect,"insert"|"update")))
}
#[derive(Clone,Debug,Serialize)]
pub struct UncoveredExposure {pub table:String,pub effect:String,pub audience:String,pub row_predicate:String,pub column:Option<String>}
pub(super) fn uncovered(bound:&Bound,exposures:&[Exposure])->Vec<UncoveredExposure>{
    let mut out=exposures.iter().flat_map(|x|x.effects.iter().filter(|(effect,rule)|rule.as_str()!="deny"&&!covered(bound,&x.table,effect)).map(|(effect,predicate)|UncoveredExposure{
        table:x.table.clone(),effect:effect.clone(),audience:if predicate=="allow"||predicate.starts_with("public"){"every signed-in user".into()}else{format!("caller satisfying {predicate}")},row_predicate:predicate.clone(),column:None,
    })).collect::<Vec<_>>();
    for (name,t) in bound.schema.visible_tables(){for (column,authority) in &t.written_by{
        if covered(bound,name,"update")||bound.invariants.iter().any(|i|i.table==*name&&i.operation.is_none()&&i.column.as_ref()==Some(column)&&i.target=="write"){continue;}
        out.push(UncoveredExposure{table:name.clone(),effect:"update".into(),column:Some(column.clone()),audience:format!("owner .{} = viewer",authority.owner),row_predicate:format!("field-owner patch authority for {column}; table update rule may deny")});
    }}out
}
