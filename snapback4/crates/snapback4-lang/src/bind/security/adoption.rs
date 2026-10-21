//! Author-owned intent starts with a reviewable draft, never inferred policy.
// @ref LLP 3000.036.004#103-adoption — syntactic coverage is distinct from a proved invariant.
use super::*;

pub(super) fn missing(bound:&Bound)->Vec<String>{
    bound.schema.visible_tables().filter(|(name,t)| {
        ([&t.rules.read,&t.rules.insert,&t.rules.update,&t.rules.delete].iter().any(|r|!matches!(r,RuleExpr::Deny)) || !t.written_by.is_empty())
            && !bound.invariants.iter().any(|i| &i.table==*name)
    }).map(|(name,_)|name.clone()).collect()
}

/// Specification questions, never proposed enforcement or accepted policy.
/// The caller must keep this outside the compiled .q source set.
pub fn draft(bound:&Bound)->String{
    let mut out=String::from("-- DRAFT: NOT ACCEPTED. Answer from the APP SPECIFICATION, not from the rules.\n-- Each answer needs an audience, a resource relationship and lifecycle/consent conditions.\n-- Use table-read intent for a shared row audience; add column-read intent for distinct privacy boundaries.\n-- Assess every role and column, without automatically declaring one invariant for each question.\n-- Identify each role's positive product/workflow grant before retaining access to other people's private data.\n-- Write confirmed declarations in authored snapback/*.q, then run check -> test -> audit.\n-- This questionnaire is never compiled and does not propose policy.\n-- snapback4 guide security\n\n");
    let roles=super::intent::roles(bound);
    for (name,t) in bound.schema.visible_tables(){
        out.push_str(&format!("-- {name}: {}\n",super::intent::row_context(t)));
        let audiences=std::iter::once("a signed-in user without a roster role (check own rows and unrelated rows separately)".to_owned())
            .chain(roles.iter().cloned()).collect::<Vec<_>>();
        for audience in &audiences {
            out.push_str(&format!("-- Q {name}.read / {audience}: which rows may this audience see according to the spec? Own, assigned, team-wide, or none? Which state/consent conditions must hold now?\n"));
        }
        for (column,kind) in &t.columns {
            if column=="id"||t.engine_field(column){continue;}
            for audience in &audiences {
                out.push_str(&format!("-- Q {name}.{column} ({kind}) / {audience}: may this audience read this value, including downloads and derived values? On which related rows and in which states? If not, which independently confirmed column-read invariant excludes it?\n"));
            }
        }
        for effect in ["insert","update","delete"] {
            if covered(bound,name,effect){continue;}
            out.push_str(&format!("-- Q {name}.{effect}: who may {effect}, who appoints that authority, and which relationship/state must hold? Can callers claim the relationship themselves?\n"));
        }
        for (column,authority) in &t.written_by {out.push_str(&format!("-- Q {name}.{column}: may .{} edit this value in every state? Column update intent covers edits; write also covers creation.\n",authority.owner));}
        out.push('\n');
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
        if covered(bound,name,"update")||bound.invariants.iter().any(|i|i.table==*name&&i.operation.is_none()&&i.column.as_ref()==Some(column)&&matches!(i.target.as_str(),"write"|"update")){continue;}
        out.push(UncoveredExposure{table:name.clone(),effect:"update".into(),column:Some(column.clone()),audience:format!("owner .{} = viewer",authority.owner),row_predicate:format!("field-owner patch authority for {column}; table update rule may deny")});
    }}out
}
