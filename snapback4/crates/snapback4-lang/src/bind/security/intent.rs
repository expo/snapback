//! Review questions describe enforcement; they never infer specification intent.
// @ref LLP 3000.036.004#131-intent-and-diagnostics — advisory comparisons do not change proof statuses or authority.
use super::*;
use snapback4_core::{schema::{ColumnType,Table},Value};

pub(super) fn roles(bound:&Bound)->Vec<String>{
    let mut roles=BTreeSet::new();
    for (name,table) in bound.schema.visible_tables(){
        let mut columns=super::privilege::role_columns(bound,name);
        // Scoped memberships have the same questionnaire need as global roles.
        if table.columns.values().any(|c|matches!(c.required(),ColumnType::Principal)) {
            columns.extend(["role","kind"].into_iter().filter(|c|table.columns.contains_key(*c)).map(str::to_owned));
        }
        for column in columns {for value in super::privilege::role_values(bound,name,&column){
            roles.insert(format!("{name}.{column} = '{value}'"));
        }}
    }
    roles.into_iter().collect()
}

pub(super) fn row_context(table:&Table)->String{
    let mut relationships=Vec::new();let mut states=Vec::new();
    for (column,kind) in &table.columns {
        match kind.required(){
            ColumnType::Principal=>relationships.push(format!(".{column} (principal)")),
            ColumnType::Ref{table}=>relationships.push(format!(".{column} ({table})")),
            ColumnType::Enum{variants}=>states.push(format!(".{column}: {}",variants.join(" / "))),
            _=>{},
        }
    }
    format!("relationships: {}; state/category values: {}. Confirm their meaning from the spec.",
        if relationships.is_empty(){"none declared".into()}else{relationships.join(", ")},
        if states.is_empty(){"none declared".into()}else{states.join(", ")})
}

/// Bounded distribution retains each AND condition when showing OR audiences.
/// Oversized formulas stay whole; no branch or condition is silently dropped.
fn alternatives(rule:&RuleExpr)->Vec<RuleExpr>{
    match rule {
        RuleExpr::Or(xs)=>{
            let out=xs.iter().flat_map(alternatives).collect::<Vec<_>>();
            if out.len()>32{vec![rule.clone()]}else{out}
        },
        RuleExpr::And(xs)=>{
            let mut out=vec![Vec::new()];
            for x in xs {
                let next=alternatives(x);
                if out.len().saturating_mul(next.len())>32{return vec![rule.clone()];}
                out=out.into_iter().flat_map(|prefix|next.iter().map(move |part|{
                    let mut parts=prefix.clone();parts.push(part.clone());parts
                })).collect();
            }
            out.into_iter().map(RuleExpr::And).collect()
        },
        other=>vec![other.clone()],
    }
}
fn leaves<'a>(rule:&'a RuleExpr,out:&mut Vec<&'a RuleExpr>){match rule{
    RuleExpr::And(xs)|RuleExpr::Or(xs)=>for x in xs{leaves(x,out)},
    RuleExpr::Not(x)=>leaves(x,out),r=>out.push(r),
}}
fn audience(bound:&Bound,rule:&RuleExpr)->String{
    let mut actors=BTreeSet::new();
    fn collect(bound:&Bound,rule:&RuleExpr,actors:&mut BTreeSet<String>){match rule{
        // Negated role tests are conditions, not an admitted role.
        RuleExpr::And(xs)=>for x in xs{collect(bound,x,actors)},
        RuleExpr::Exists{table,index,key,equalities,..}=>{
            let pairs=super::privilege::probe_pairs(bound,table,index,key,equalities);
            if !pairs.iter().any(|(_,v)|matches!(v,RuleTerm::Viewer)){return;}
            let columns=super::privilege::role_columns(bound,table);
            let mut named=false;
            for (c,v) in &pairs{if columns.contains(c)||matches!(c.as_str(),"role"|"kind"){
                if let RuleTerm::Literal(Value::String(value))=v{actors.insert(format!("{table}.{c} = '{value}'"));named=true;}
            }}
            if !named{actors.insert(format!("a caller with a matching {table} relationship"));}
        },
        RuleExpr::Eq(RuleTerm::Viewer,term)|RuleExpr::Eq(term,RuleTerm::Viewer)=>{
            actors.insert(format!("a caller satisfying {}",RuleExpr::Eq(RuleTerm::Viewer,term.clone()).quarry()));
        },_=>{},
    }}
    collect(bound,rule,&mut actors);
    if actors.is_empty(){"a signed-in caller satisfying this branch".into()}else{actors.into_iter().collect::<Vec<_>>().join(" and ")}
}

pub(super) fn questions(bound:&Bound,target:&str,effect:&str,gate:&RuleExpr)->String{
    alternatives(gate).iter().filter(|branch|kernel::implies(branch,&RuleExpr::Deny)!=Ok(true)).map(|branch|{
        let actor=audience(bound,branch);
        let mut fields=BTreeSet::new();branch.fields(&mut fields);
        let scope=if fields.is_empty(){"no row relationship or lifecycle condition in this branch".to_owned()}
            else{format!("row conditions on {}",fields.iter().map(|f|format!(".{f}")).collect::<Vec<_>>().join(", "))};
        format!("Rule {target}.{effect} admits {actor} under `{}` ({scope}). Should the spec allow this audience on these rows and columns, including other people's rows and every lifecycle state?",branch.quarry())
    }).collect::<Vec<_>>().join(" ")
}

/// Lint-only normalization. It is never used by the proof or a counterexample.
/// Named-key probes with extra equalities imply the same probe with fewer
/// equalities; an existing row's self-id probe repeats its own current fields.
fn normalized(bound:&Bound,target:&str,current_read:bool,rule:&RuleExpr)->RuleExpr{
    match rule{
        RuleExpr::And(xs)=>RuleExpr::And(xs.iter().map(|r|normalized(bound,target,current_read,r)).collect()),
        RuleExpr::Or(xs)=>RuleExpr::Or(xs.iter().map(|r|normalized(bound,target,current_read,r)).collect()),
        RuleExpr::Not(x)=>RuleExpr::Not(Box::new(normalized(bound,target,current_read,x))),
        RuleExpr::Exists{table,index,key,equalities,..}=>{
            let mut pairs=super::privilege::probe_pairs(bound,table,index,key,equalities);
            pairs.sort_by_key(|(c,t)|(c.clone(),serde_json::to_string(t).unwrap()));pairs.dedup();
            if current_read&&table==target&&pairs.contains(&("id".into(),RuleTerm::Field("id".into()))) {
                RuleExpr::And(pairs.into_iter().filter(|(c,t)|c!="id"||t!=&RuleTerm::Field("id".into()))
                    .map(|(c,t)|RuleExpr::Eq(RuleTerm::Field(c),t)).collect())
            }else{
                RuleExpr::Exists{table:table.clone(),index:"$advisory-named-pairs".into(),key:Vec::new(),equalities:pairs,provenance:snapback4_core::ir::KeyProvenance::Computed}
            }
        },_=>rule.clone(),
    }
}
fn probe_implies(a:&RuleExpr,b:&RuleExpr)->bool{match(a,b){
    (RuleExpr::Exists{table:a,equalities:ap,..},RuleExpr::Exists{table:b,equalities:bp,..})=>a==b&&bp.iter().all(|p|ap.contains(p)),_=>false,
}}
fn enrich(rule:&RuleExpr,candidates:&[&RuleExpr])->RuleExpr{match rule{
    RuleExpr::And(xs)=>RuleExpr::And(xs.iter().map(|r|enrich(r,candidates)).collect()),
    RuleExpr::Or(xs)=>RuleExpr::Or(xs.iter().map(|r|enrich(r,candidates)).collect()),
    RuleExpr::Not(x)=>RuleExpr::Not(Box::new(enrich(x,candidates))),
    RuleExpr::Exists{..}=>RuleExpr::And(std::iter::once(rule.clone()).chain(candidates.iter().filter(|p|probe_implies(rule,p)).map(|p|(*p).clone())).collect()),
    r=>r.clone(),
}}
pub(super) fn restates(bound:&Bound,target:&str,effect:&str,gate:&RuleExpr,policy:&RuleExpr)->bool{
    // Do not diagnose an unreachable/denied gate merely by vacuous implication.
    if kernel::implies(gate,&RuleExpr::Deny)==Ok(true){return false;}
    let gate=normalized(bound,target,effect=="read",gate);
    let policy=normalized(bound,target,effect=="read",policy);
    let mut gates=Vec::new();let mut policies=Vec::new();leaves(&gate,&mut gates);leaves(&policy,&mut policies);
    // A broader assertion with independent alternatives is still useful intent;
    // the weaker-copy note only covers atoms already present in enforcement.
    if !policies.iter().all(|p|matches!(p,RuleExpr::Allow|RuleExpr::Public{..}|RuleExpr::Deny)||gates.iter().any(|g|kernel::implies(g,p)==Ok(true)||probe_implies(g,p))){return false;}
    kernel::implies(&enrich(&gate,&policies),&policy)==Ok(true)
}
