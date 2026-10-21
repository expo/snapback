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
    for (name,t) in bound.schema.visible_tables(){
        let roles=role_candidates(bound,name,t);
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
        for inv in bound.invariants.iter().filter(|i|i.table==*name&&i.column.is_some()&&i.target=="update"){
            out.push_str(&format!("-- {}: update-only intent excludes creation. Does the specification allow callers to supply this column at insert/upsert too? Use write only if creation shares the restriction.\n",inv.target_label()));
        }
        for effect in ["insert","update","delete"] {
            if covered(bound,name,effect){continue;}
            out.push_str(&format!("-- {name}.{effect}: name the permitted appointer/owner and lifecycle condition from the spec.\n"));
        }
        for (column,authority) in &t.written_by {out.push_str(&format!("-- {name}.{column}: is .{} still the intended editor? Use column update intent for edits only; write also includes creation.\n",authority.owner));}
    }
    out
}

fn role_candidates(bound:&Bound,target:&str,row:&snapback4_core::schema::Table)->Vec<RuleExpr>{
    use snapback4_core::{schema::ColumnType as C,Value};
    let mut out=Vec::new();
    for (roster,t) in bound.schema.visible_tables(){
        let mut columns=super::privilege::role_columns(bound,roster);
        columns.extend(["role","kind"].into_iter().filter(|c|t.columns.contains_key(*c)).map(str::to_owned));
        for column in columns {for role in super::privilege::role_values(bound,roster,&column) {
            for (index,idx) in t.indexes.iter().filter(|(_,idx)|idx.unique){
                let mut key=Vec::new();let mut principals=0;
                for component in &idx.components {
                    let Some(c)=component.column()else{break;};
                    let term=if c==&column{RuleTerm::Literal(Value::String(role.clone()))}else{match t.columns.get(c).map(C::required){
                        Some(C::Principal)=>{principals+=1;RuleTerm::Viewer},
                        Some(C::Ref{table}) if table==target=>RuleTerm::Field("id".into()),
                        Some(C::Ref{table})=>{
                            let refs=row.columns.iter().filter(|(_,k)|matches!(k.required(),C::Ref{table:parent} if parent==table)).collect::<Vec<_>>();
                            if refs.len()!=1{break;}RuleTerm::Field(refs[0].0.clone())
                        },_=>break,
                    }};key.push(term);
                }
                if principals!=1||key.len()!=idx.components.len(){continue;}
                let equalities=if idx.components.iter().any(|c|c.column()==Some(&column)){Vec::new()}else{vec![(column.clone(),RuleTerm::Literal(Value::String(role.clone())))]};
                let policy=RuleExpr::Exists{table:roster.clone(),index:index.clone(),key,provenance:snapback4_core::ir::KeyProvenance::Computed,equalities};
                if !out.contains(&policy){out.push(policy);}break;
            }
        }}
    }out
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
