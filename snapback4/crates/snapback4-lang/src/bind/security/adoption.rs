//! Author-owned intent starts with a reviewable draft, never inferred policy.
// @ref LLP 3000.036.004#103-adoption — syntactic coverage is distinct from a proved invariant.
use super::*;

pub(super) fn missing(bound:&Bound)->Vec<String>{
    bound.schema.visible_tables().filter(|(name,t)| {
        ([&t.rules.read,&t.rules.insert,&t.rules.update,&t.rules.delete].iter().any(|r|!matches!(r,RuleExpr::Deny)) || !t.written_by.is_empty())
            && !bound.invariants.iter().any(|i| &i.table==*name)
    }).map(|(name,_)|name.clone()).collect()
}

/// Questions and independent role/column candidates, never copies of a gate.
/// The caller must keep this outside the compiled .q source set.
pub fn draft(bound:&Bound)->String{
    let mut out=String::from("-- DRAFT: NOT ACCEPTED. Confirm intent against the APP SPECIFICATION.\n-- These role/column alternatives are questions, not inferred policy.\n-- Select intended audiences, resource relationships and lifecycle conditions.\n-- Copy confirmed declarations into authored snapback/*.q; this draft is never compiled.\n-- snapback4 guide security\n\n");
    let mut roles=Vec::new();
    for (roster,t) in bound.schema.visible_tables(){
        let Some(principal)=super::privilege::global_principal(bound,roster)else{continue;};
        let Some((index,_))=t.indexes.iter().find(|(_,idx)|idx.unique&&idx.components.len()==1&&idx.components[0].column()==Some(&principal))else{continue;};
        for column in super::privilege::role_columns(bound,roster){
            for role in super::privilege::role_values(bound,roster,&column) {
                let policy=RuleExpr::Exists{table:roster.clone(),index:index.clone(),key:vec![RuleTerm::Viewer],provenance:snapback4_core::ir::KeyProvenance::Computed,equalities:vec![(column.clone(),RuleTerm::Literal(snapback4_core::Value::String(role)))]};
                roles.push(policy);
            }
        }
    }
    for (name,t) in bound.schema.visible_tables(){
        out.push_str(&format!("-- {name}: who may read each field, create, edit, delete? Which current relationship must still hold?\n"));
        for (column,kind) in &t.columns {
            if column=="id"||t.engine_field(column){continue;}
            out.push_str(&format!("-- {name}.{column} ({kind}): which roles may see this value? May outsiders see its existence?\n"));
            for candidate in &roles {
                // Keep candidates commented: mutually exclusive roles cannot all be requirements.
                let gate=super::columns::admission(t,Some(column));
                if !(kernel::implies(&gate,candidate)==Ok(true)&&kernel::implies(candidate,&gate)==Ok(true)) {out.push_str(&format!("-- Confirm/combine audience alternative: invariant {name}.{column} read only {}\n",candidate.quarry()));}
            }
        }
        for effect in ["insert","update","delete"] {
            if covered(bound,name,effect){continue;}
            out.push_str(&format!("-- {name}.{effect}: name the permitted appointer/owner and lifecycle condition from the spec.\n"));
        }
        for (column,authority) in &t.written_by {out.push_str(&format!("-- {name}.{column}: is .{} still the intended editor? Use column update intent for edits only; write also includes creation.\n",authority.owner));}
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
