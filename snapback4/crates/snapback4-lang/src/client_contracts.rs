//! @ref LLP 3000.000.000.000#11-old-client-operation-contracts-rel5 — compare old callers with the candidate, separately from data adoption.
// @ref LLP 3000.000.000.002#10-wave-25-day-two-friction-dx8 — declared table renames preserve Ref inputs; additive result fields are notes.
use crate::{Bound, BoundProgram, types::Ty};
use snapback4_core::ir::{ArgType as A, ProgramKind};
use std::collections::{BTreeMap, BTreeSet};

/// Conservative input-domain inclusion: every value accepted by old is accepted by new.
pub fn accepts(old: &A, new: &A) -> bool {
    accepts_in(old,new,None,None)
}

fn accepts_in(old: &A, new: &A, old_bound: Option<&Bound>, new_bound: Option<&Bound>) -> bool {
    if old==new {return true;}
    match (old,new) {
        (A::Optional(a),A::Optional(b))=>accepts_in(a,b,old_bound,new_bound),
        (A::Optional(_),_)=>false,
        (a,A::Optional(b))=>accepts_in(a,b,old_bound,new_bound),
        (A::Ref{table:old},A::Ref{table:new})=>new_bound.is_some_and(|bound|bound.schema.table_renames.get(new)==Some(old))
            && old_bound.is_some_and(|bound|bound.schema.table(old).is_some()),
        (A::Text{min:a,max:b,format:af},A::Text{min:c,max:d,format:bf})=>c<=a && d>=b && (bf.is_none() || af==bf),
        (A::IntRange{..},A::Int)=>true,
        (A::IntRange{min:a,max:b},A::IntRange{min:c,max:d})=>c<=a && d>=b,
        (A::Enum{variants:a},A::Enum{variants:b})=>a.iter().all(|v|b.contains(v)),
        (A::Bytes{max:a},A::Bytes{max:b}) | (A::Image{max:a},A::Image{max:b}) |
        (A::Video{max:a},A::Video{max:b})=>b>=a,
        (A::Json{max_bytes:a},A::Json{max_bytes:b})=>b>=a,
        (A::File{max:a,types:at},A::File{max:b,types:bt})=>b>=a && snapback4_core::assets::FILE_TYPES.iter().all(|t|!snapback4_core::assets::file_accepts(at,t)||snapback4_core::assets::file_accepts(bt,t)),
        (A::List{..}|A::ListRange{..},A::List{..}|A::ListRange{..})=> {
            let parts=|t:&A|match t {A::List{of,max}=>(0,*max,of.clone()),A::ListRange{of,min,max}=>(*min,*max,of.clone()),_=>unreachable!()};
            let (a,b,at)=parts(old);let(c,d,bt)=parts(new);
            c<=a && d>=b && match(at,bt){(_,None)=>true,(Some(a),Some(b))=>accepts_in(&a,&b,old_bound,new_bound),_=>false}
        }
        _=>false,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ResultChange { Same, Additive, Changed }

fn combine(fields: impl IntoIterator<Item=ResultChange>, extra: bool) -> ResultChange {
    let mut additive=extra;
    for field in fields {
        match field {ResultChange::Changed=>return ResultChange::Changed,ResultChange::Additive=>additive=true,ResultChange::Same=>{}}
    }
    if additive {ResultChange::Additive} else {ResultChange::Same}
}

fn table_fields(name: &str, bound: &Bound) -> Option<BTreeMap<String,String>> {
    let schema=bound.schema.public_projection();
    let table=schema.tables.get(name)?;
    Some(table.columns.iter().filter(|(n,_)|!table.engine_field(n)).map(|(n,t)|(n.clone(),format!("{t:?};private={};constraints={:?}",table.read_optional(n),table.constraints.iter().filter(|c|matches!(c,snapback4_core::schema::Constraint::Text{field,..} if field==n)).collect::<Vec<_>>()))).collect())
}

fn map_change<T>(old: &BTreeMap<String,T>, new: &BTreeMap<String,T>, compare: impl Fn(&T,&T)->ResultChange) -> ResultChange {
    combine(old.iter().map(|(name,old)|new.get(name).map(|new|compare(old,new)).unwrap_or(ResultChange::Changed)),new.len()>old.len())
}

fn result_change(old: &Ty, new: &Ty, old_bound: &Bound, new_bound: &Bound) -> ResultChange {
    if result(old,old_bound)==result(new,new_bound) {return ResultChange::Same;}
    match (old,new) {
        (Ty::Optional(a),Ty::Optional(b))|(Ty::Omittable(a),Ty::Omittable(b))
        |(Ty::List(a,_),Ty::List(b,_))|(Ty::Collection(a,_),Ty::Collection(b,_))=>result_change(a,b,old_bound,new_bound),
        (Ty::Object(a)|Ty::RowShape(a)|Ty::RowObject(a),Ty::Object(b)|Ty::RowShape(b)|Ty::RowObject(b))=>map_change(a,b,|a,b|result_change(a,b,old_bound,new_bound)),
        (Ty::Row(a),Ty::Row(b)) | (Ty::WriteRow(a),Ty::WriteRow(b)) | (Ty::Page(a,_),Ty::Page(b,_)) if a==b=>{
            let (Some(a),Some(b))=(table_fields(a,old_bound),table_fields(b,new_bound)) else{return ResultChange::Changed;};
            combine(a.iter().map(|(name,kind)|if b.get(name)==Some(kind){ResultChange::Same}else{ResultChange::Changed}),b.len()>a.len())
        }
        _=>ResultChange::Changed,
    }
}

fn action_result_change(old: Option<&BTreeMap<String,A>>, new: Option<&BTreeMap<String,A>>) -> ResultChange {
    match (old,new) {
        (None,None)=>ResultChange::Same,
        (Some(old),Some(new))=>combine(old.iter().map(|(name,kind)|if new.get(name)==Some(kind){ResultChange::Same}else{ResultChange::Changed}),new.len()>old.len()),
        _=>ResultChange::Changed,
    }
}

pub fn is_note(line: &str) -> bool { line.contains(": RESULT NOTE:") }

fn result(ty: &Ty, bound: &Bound) -> String {
    match ty {
        Ty::Row(name)|Ty::WriteRow(name)|Ty::Page(name,_)=> {
            let schema=bound.schema.public_projection();
            if let Some(table)=schema.tables.get(name) {
                let fields: BTreeMap<_,_>=table.columns.iter().filter(|(n,_)|!table.engine_field(n)).map(|(n,t)|(n,format!("{t:?};private={};constraints={:?}",table.read_optional(n),table.constraints.iter().filter(|c|matches!(c,snapback4_core::schema::Constraint::Text{field,..} if field==n)).collect::<Vec<_>>()))).collect();
                let kind=match ty {Ty::Row(..)=>"row",Ty::WriteRow(..)=>"write-row",Ty::Page(..)=>"page",_=>unreachable!()};
                format!("{kind}:{name}:{fields:?}")
            } else {format!("{ty:?}")}
        }
        Ty::Optional(t)=>format!("optional {}",result(t,bound)),
        Ty::Omittable(t)=>format!("omittable {}",result(t,bound)),
        Ty::List(t,_)|Ty::Collection(t,_)=>format!("list {}",result(t,bound)),
        Ty::Object(fields)|Ty::RowShape(fields)|Ty::RowObject(fields)=>format!("object {:?}",fields.iter().map(|(n,t)|(n,result(t,bound))).collect::<BTreeMap<_,_>>()),
        Ty::Text(max)=>format!("text<={max}"),
        _=>format!("{ty:?}"),
    }
}

fn refusals(p: &BoundProgram) -> Vec<String> {
    fn walk(v: &serde_json::Value, out: &mut Vec<String>) {
        match v {
            serde_json::Value::Object(o)=> {
                if let Some(r)=o.get("Require") {out.push(format!("{}:{}",r["code"],r["message"]));}
                for v in o.values(){walk(v,out);}
            }
            serde_json::Value::Array(a)=>for v in a{walk(v,out);},
            _=>{}
        }
    }
    let mut out=Vec::new();walk(&serde_json::to_value(&p.program.body).unwrap(),&mut out);out
}

/// Reports are advisory: compatibility cannot license calls or prove unchanged behavior.
pub fn compare(old: &Bound, new: &Bound, label: &str) -> Vec<String> {
    let mut lines=Vec::new();
    for before in old.programs.iter().filter(|p|p.program.kind!=ProgramKind::Job) {
        let name=&before.program.name;
        let prefix=format!("old-client compatibility ({label}), operation {name}");
        let Some(after)=new.programs.iter().find(|p|p.program.name==*name) else {
            lines.push(format!("{prefix}: INPUT BREAK: removed operation; old calls get E_OP; keep `alias {name} = replacement` for a same-module query/mutation, or retain a wrapper"));continue;
        };
        if before.program.kind!=after.program.kind {lines.push(format!("{prefix}: INPUT BREAK: operation kind changed; retain the old endpoint kind"));continue;}
        let rename_candidate = |new_kind: &A| before.program.args.iter().find(|(old_name, old_kind)|
            !after.program.args.contains_key(*old_name) && !after.program.arg_aliases.contains_key(*old_name)
                && accepts_in(old_kind,new_kind,Some(old),Some(new)));
        let mut warned_renames=BTreeSet::new();
        for (arg,kind) in &after.program.args {
            if before.program.args.contains_key(arg) { continue; }
            if let Some((old_arg,old_kind))=before.program.args.iter().find(|(old,_)|after.program.arg_aliases.get(*old)==Some(arg)) {
                if !accepts_in(old_kind,kind,Some(old),Some(new)) {lines.push(format!("{prefix}: INPUT BREAK: aliased argument {old_arg} → {arg} narrows the old input domain ({old_kind:?} → {kind:?}); retain the old input domain or a compatible wrapper"));}
            } else if !matches!(kind,A::Optional(_)) {
                if let Some((old,_))=rename_candidate(kind) {
                    lines.push(format!("{prefix}: INPUT BREAK: required argument {old} appears renamed to {arg}; old calls get E_INPUT; declare `{arg}: <new type> alias {old}` if it is the same value, or retain a compatible wrapper"));
                    warned_renames.insert(old.clone());
                } else {
                    lines.push(format!("{prefix}: INPUT BREAK: clients calling without new required argument {arg} get E_INPUT; give {arg} a fitting `default <literal>` or retain a compatible wrapper"));
                }
            }
        }
        for (arg,kind) in &before.program.args {
            match after.program.args.get(arg) {
                None if after.program.arg_aliases.contains_key(arg)=>{
                    let next=&after.program.args[&after.program.arg_aliases[arg]];
                    if !accepts_in(kind,next,Some(old),Some(new)){lines.push(format!("{prefix}: INPUT BREAK: aliased argument {arg} retyped or narrowed ({kind:?} → {next:?}); retain its old input domain"));}
                },
                None if warned_renames.contains(arg)=>{},
                None=>lines.push(format!("{prefix}: INPUT BREAK: removed argument {arg}; old calls sending it get E_INPUT; retain `{arg}: <old type> deprecated` on a query/mutation")),
                Some(next) if !accepts_in(kind,next,Some(old),Some(new))=>lines.push(format!("{prefix}: INPUT BREAK: argument {arg} retyped or narrowed ({kind:?} → {next:?}); old values may get E_INPUT; retain the old input domain or a compatible wrapper")),
                _=>{}
            }
        }
        for (alias,canonical) in &before.program.arg_aliases {
            let old_kind=&before.program.args[canonical];
            let next=after.program.args.get(alias).or_else(||after.program.arg_aliases.get(alias).and_then(|name|after.program.args.get(name)));
            match next {
                None=>lines.push(format!("{prefix}: INPUT BREAK: removed argument alias {alias}; old calls sending it get E_INPUT; retain its alias or a compatible wrapper")),
                Some(kind) if !accepts_in(old_kind,kind,Some(old),Some(new))=>lines.push(format!("{prefix}: INPUT BREAK: argument alias {alias} retyped or narrowed ({old_kind:?} → {kind:?}); retain its old input domain")),
                _=>{}
            }
        }
        let mut positions:BTreeMap<String,String>=BTreeMap::new();
        for canonical in before.program.args.keys() {
            for spelling in std::iter::once(canonical).chain(before.program.arg_aliases.iter().filter_map(|(alias,target)|(target==canonical).then_some(alias))) {
                let target=after.program.args.contains_key(spelling).then_some(spelling).or_else(||after.program.arg_aliases.get(spelling));
                if let Some(target)=target {
                    if let Some(prior)=positions.insert(target.clone(),canonical.clone())&&prior!=*canonical {
                        lines.push(format!("{prefix}: INPUT BREAK: independent arguments {prior} and {canonical} now share {target}; old calls containing both positions get E_INPUT; retain separate arguments or a compatible wrapper"));
                    }
                }
            }
        }
        for (table,before_table) in old.schema.visible_tables() {
            let Some(after_table)=new.schema.table(table) else { continue; };
            if !snapback4_core::ir::read_sites(&before.program).iter().any(|site|site.table==*table)
                && !snapback4_core::ir::write_tables(&before.program).iter().any(|(name,_)|name==table) { continue; }
            for field in before_table.columns.keys().filter(|f|!before_table.read_optional(f)&&after_table.read_optional(f)) {
                lines.push(format!("{prefix}: RESULT REVIEW: {table}.{field} is now audience-optional; handle an omitted row property or a null explicit scalar before adopting the new column read rule"));
            }
        }
        let action_change=action_result_change(old.schema.action_specs.get(name).and_then(|s|s.returns.as_ref()),new.schema.action_specs.get(name).and_then(|s|s.returns.as_ref()));
        let typed_change=result_change(&before.result,&after.result,old,new);
        let change=combine([action_change,typed_change],false);
        match change {
            ResultChange::Additive=>lines.push(format!("{prefix}: RESULT NOTE: result shape added fields while preserving prior fields and domains; old clients may ignore the additions")),
            ResultChange::Changed=>lines.push(format!("{prefix}: RESULT REVIEW: result shape/value domain changed; preserve the old projection/domain or introduce a new operation before retiring old clients")),
            ResultChange::Same=>{},
        }
        let old_domains=crate::result_domains::signature(before,old);
        let new_domains=crate::result_domains::signature(after,new);
        // A domain introduced only for a newly returned field is covered by
        // the additive result note. Existing or removed domains still need review.
        let changed:Vec<_>=old_domains.keys().collect::<std::collections::BTreeSet<_>>().into_iter().filter(|key|old_domains.get(*key)!=new_domains.get(*key)).cloned().collect();
        if !changed.is_empty() {lines.push(format!("{prefix}: RESULT REVIEW: declared source domains consumed by this operation changed: {}; results or refusals may change even when the TypeScript type stays number/string; preserve the old domains or verify old-client handling",changed.join(", ")));}
        if refusals(before)!=refusals(after) {lines.push(format!("{prefix}: BEHAVIOR REVIEW: refusal codes/messages changed ({:?} → {:?}); verify intended denials separately from input breaks",refusals(before),refusals(after)));}
    }
    lines
}

/// Human result advice groups source columns across operations. JSON keeps compare().
pub fn compact(lines:&[String])->Vec<String>{
    use std::collections::BTreeSet;
    let mut out=Vec::new();let mut groups=BTreeMap::<String,BTreeSet<String>>::new();
    for line in lines {
        let Some((prefix,detail))=line.split_once(": RESULT REVIEW: ") else {out.push(line.clone());continue};
        let operation=prefix.rsplit_once("operation ").map(|(_,name)|name).unwrap_or("unknown");
        if let Some((_,columns))=detail.split_once("declared source domains consumed by this operation changed: ") {
            for column in columns.split(';').next().unwrap_or(columns).split(", "){groups.entry(column.into()).or_default().insert(operation.into());}
        }else{groups.entry(detail.into()).or_default().insert(operation.into());}
    }
    for(detail,ops)in groups{out.push(format!("old-client compatibility: RESULT REVIEW: {detail}; operations [{}]; verify old-client handling (full per-operation evidence in --json)",ops.into_iter().collect::<Vec<_>>().join(", ")));}
    out
}
