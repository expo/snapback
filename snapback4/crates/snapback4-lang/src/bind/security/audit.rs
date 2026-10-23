//! Conservative permission map; conditional predicates are never universal grants.
// @ref LLP 3000.036.004#5-exposure-report — include grant writers and implicit effects.
use super::*;
use snapback4_core::ir;
#[derive(Clone,Debug,Serialize)]
pub struct Grant {pub table:String,pub predicate:String,pub writers:Vec<String>}
#[derive(Clone,Debug,Serialize)]
pub struct Exposure {pub table:String,pub columns:BTreeMap<String,String>,pub column_audiences:BTreeMap<String,String>,pub effects:BTreeMap<String,String>,pub operations:Vec<String>,pub paths:Vec<String>,pub grants:Vec<Grant>}
pub(super) fn mentions(json:&serde_json::Value,table:&str)->bool {
    match json {serde_json::Value::Object(fields)=>fields.iter().any(|(k,v)| k=="table"&&v.as_str()==Some(table)||mentions(v,table)),serde_json::Value::Array(xs)=>xs.iter().any(|x|mentions(x,table)),_=>false}
}
pub(super) fn authored_refusal(json:&serde_json::Value)->bool {
    match json {serde_json::Value::Object(fields)=>fields.get("Require").is_some()||fields.values().any(authored_refusal),serde_json::Value::Array(xs)=>xs.iter().any(authored_refusal),_=>false}
}
fn writers(bound:&Bound,name:&str)->Vec<String> {
    let mut out=Vec::new();let t=&bound.schema.tables[name];
    for effect in [Effect::Insert,Effect::Update] {out.push(format!("{effect} rule: {}",t.rules.for_effect(effect).quarry()));}
    for p in &bound.programs {for (table,kind) in ir::write_tables(&p.program) {if table==name {out.push(format!("{} ({kind}, {}; {})",p.program.name,p.program.kind.word(),if p.program.kind==ir::ProgramKind::Job {"system boundary"}else{"caller rules/field authority"}));}}}
    for (column,authority) in &t.written_by {out.push(format!("column {column}: owner .{} can patch under field authority",authority.owner));}
    for m in &bound.schema.maintains {if m.target==name||m.private.as_ref().is_some_and(|p|p.table==name){out.push(format!("system maintain {} from {}",m.target,m.source));}}
    if !t.on_delete.is_empty(){out.push(format!("referential actions: {:?}",t.on_delete));}
    if bound.programs.iter().any(|p|p.program.native)||!bound.schema.action_specs.is_empty()||!bound.schema.effects.is_empty(){out.push("native/worker/external paths: opaque trusted writers (not an absence claim)".into());}
    out.push("operator/system seed, import, restore and activation (trusted boundary)".into());out.sort();out.dedup();out
}
pub(super) fn exposures(bound:&Bound)->Vec<Exposure> {
    bound.schema.visible_tables().map(|(name,t)| {
        let columns=t.columns.iter().filter(|(c,_)|!t.engine_field(c)).map(|(c,k)| {
            let authority=t.written_by.get(c).map(|a|format!("; written by .{}; {}",a.owner,if a.audience{"audience readable"}else{"private to owner"})).unwrap_or_default();
            (c.clone(),format!("{k}{authority}{}",t.column_reads.get(c).map_or(String::new(),|r|format!("; read <- {}; {}",r.quarry(),if r.column_row_local(){"row-local replica projection"}else{"server witnesses; online reads"}))))
        }).collect();
        let mut effects:BTreeMap<String,String>=[("read",t.rules.read.quarry()),("insert",t.rules.insert.quarry()),("update",t.update_rule_judged().quarry()),("delete",t.rules.delete.quarry())].into_iter().map(|(k,v)|(k.into(),v)).collect();
        for (column,rule) in &t.column_writes {effects.insert(format!("{column} write"),rule.quarry());}
        for (column,rule) in &t.frozen_columns {effects.insert(format!("{column} immutable when"),rule.quarry());}
        let operations=bound.programs.iter().filter(|p|mentions(&serde_json::to_value(&p.program).unwrap(),name)).map(|p|format!("{} ({})",p.program.name,p.program.kind.word())).collect::<Vec<_>>();
        let mut paths=vec!["server point/list/filter/view/search/count/exists/live-refetch: ordinary ruled reads".into(),"mutation valued write images: authorized final reread; logical refusals separately unproved".into()];
        if t.is_expiring()||t.not_before.is_some(){paths.push(format!("live rows only: not before {:?}, expire {:?}; server clock gates delivery",t.not_before,t.expire));}
        if let Some(sync)=&t.sync {paths.push(format!("sync/device envelope: {}; device access uses delivered snapshot; leave {:?}",sync.line(),t.leave));}
        if t.columns.values().any(|k|k.contains_asset()){paths.push("asset read: owning-row read rule AND column read rule AND applicable owner-private column authority; upload placement: insert/update authority".into());}
        if let Some(through)=&t.through {paths.push(format!("read through {}.{} -> {} (capture/live reduction unproved)",name,through.reference,through.parent));}
        for m in &bound.schema.maintains {if m.source==*name||m.target==*name {paths.push(format!("derived {} -> {} (independent aggregate audience)",m.source,if m.target.starts_with("$column:"){ "maintained column" }else{&m.target}));}}
        if !t.on_delete.is_empty(){paths.push(format!("incoming referential actions bypass child rules: {:?}",t.on_delete));}
        let mut grants=Vec::new();let mut pending=Vec::new();let mut visited=BTreeSet::new();
        for r in super::columns::rules(t) {for dep in kernel::dependencies(r){pending.push((dep,r.quarry()));}}
        while let Some((dep,predicate))=pending.pop(){if !visited.insert(dep.clone()){continue;}let Some(g)=bound.schema.table(&dep)else{continue};
            grants.push(Grant{table:dep.clone(),predicate,writers:writers(bound,&dep)});
            for r in super::columns::rules(g){for next in kernel::dependencies(r){pending.push((next,r.quarry()));}}
        }
        let column_audiences=t.columns.keys().filter(|c|!t.engine_field(c)).map(|c|(c.clone(),super::columns::admission(t,Some(c)).quarry())).collect();
        Exposure{table:name.clone(),columns,column_audiences,effects,operations,paths,grants}
    }).collect()
}
/// Role labels retain complete predicates, including relationships. Every
/// entry is conditional; a roster's existence is never assumed for all users.
pub(super) fn roles(exposures:&[Exposure])->BTreeMap<String,Vec<String>> {
    let mut out:BTreeMap<String,Vec<String>>=BTreeMap::new();
    for x in exposures {for (effect,predicate) in &x.effects {
        if predicate=="deny"{continue;}
        let label=if predicate=="allow"||predicate=="public"||predicate.starts_with("public "){"every signed-in user".into()}else{format!("caller satisfying {predicate}")};
        out.entry(label).or_default().push(format!("{} {effect}: {predicate}; operations: {}",x.table,x.operations.join(", ")));
    }}out
}
