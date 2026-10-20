//! @ref LLP 3000.000.000.000#11-old-client-operation-contracts-rel5 — compare old callers with the candidate, separately from data adoption.
use crate::{Bound, BoundProgram, types::Ty};
use snapback4_core::ir::{ArgType as A, ProgramKind};
use std::collections::BTreeMap;

/// Conservative input-domain inclusion: every value accepted by old is accepted by new.
pub fn accepts(old: &A, new: &A) -> bool {
    if old==new {return true;}
    match (old,new) {
        (A::Optional(a),A::Optional(b))=>accepts(a,b),
        (A::Optional(_),_)=>false,
        (a,A::Optional(b))=>accepts(a,b),
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
            c<=a && d>=b && match(at,bt){(_,None)=>true,(Some(a),Some(b))=>accepts(&a,&b),_=>false}
        }
        _=>false,
    }
}

fn result(ty: &Ty, bound: &Bound) -> String {
    match ty {
        Ty::Row(name)|Ty::WriteRow(name)|Ty::Page(name,_)=> {
            let schema=bound.schema.public_projection();
            if let Some(table)=schema.tables.get(name) {
                let fields: BTreeMap<_,_>=table.columns.iter().filter(|(n,_)|!table.engine_field(n)).map(|(n,t)|(n,format!("{t:?};private={};constraints={:?}",table.read_optional(n),table.constraints.iter().filter(|c|matches!(c,snapback4_core::schema::Constraint::Text{field,..} if field==n)).collect::<Vec<_>>()))).collect();
                format!("{}:{name}:{fields:?}",if matches!(ty,Ty::Page(..)){"page"}else{"row"})
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
        let compatible_rename = |new_name: &str, new_kind: &A| before.program.args.iter().find(|(old_name, old_kind)|
            !after.program.args.contains_key(*old_name) && accepts(old_kind,new_kind) &&
            after.program.arg_aliases.get(*old_name).is_none_or(|canonical|canonical==new_name));
        for (arg,kind) in &after.program.args {
            if before.program.args.contains_key(arg) { continue; }
            if let Some((old,old_kind))=before.program.args.iter().find(|(old,_)|after.program.arg_aliases.get(*old)==Some(arg)) {
                if !accepts(old_kind,kind) {lines.push(format!("{prefix}: INPUT BREAK: aliased argument {old} → {arg} narrows the old input domain ({old_kind:?} → {kind:?}); retain the old input domain or a compatible wrapper"));}
            } else if !matches!(kind,A::Optional(_)) {
                if let Some((old,_))=compatible_rename(arg,kind) {
                    lines.push(format!("{prefix}: INPUT BREAK: required argument {old} appears renamed to {arg}; old calls get E_INPUT; declare `{arg}: <new type> alias {old}` if it is the same value, or retain a compatible wrapper"));
                } else {
                    lines.push(format!("{prefix}: INPUT BREAK: clients calling without new required argument {arg} get E_INPUT; give {arg} a fitting `default <literal>` or retain a compatible wrapper"));
                }
            }
        }
        for (arg,kind) in &before.program.args {
            match after.program.args.get(arg) {
                None if after.program.arg_aliases.contains_key(arg)=>{
                    let next=&after.program.args[&after.program.arg_aliases[arg]];
                    if !accepts(kind,next){lines.push(format!("{prefix}: INPUT BREAK: aliased argument {arg} retyped or narrowed ({kind:?} → {next:?}); retain its old input domain"));}
                },
                None if after.program.args.iter().any(|(new,next)|compatible_rename(new,next).is_some_and(|(old,_)|old==arg))=>{},
                None=>lines.push(format!("{prefix}: INPUT BREAK: removed argument {arg}; old calls sending it get E_INPUT; retain `{arg}: <old type> deprecated` on a query/mutation")),
                Some(next) if !accepts(kind,next)=>lines.push(format!("{prefix}: INPUT BREAK: argument {arg} retyped or narrowed ({kind:?} → {next:?}); old values may get E_INPUT; retain the old input domain or a compatible wrapper")),
                _=>{}
            }
        }
        for (alias,canonical) in &before.program.arg_aliases {
            let old_kind=&before.program.args[canonical];
            let next=after.program.args.get(alias).or_else(||after.program.arg_aliases.get(alias).and_then(|name|after.program.args.get(name)));
            match next {
                None=>lines.push(format!("{prefix}: INPUT BREAK: removed argument alias {alias}; old calls sending it get E_INPUT; retain its alias or a compatible wrapper")),
                Some(kind) if !accepts(old_kind,kind)=>lines.push(format!("{prefix}: INPUT BREAK: argument alias {alias} retyped or narrowed ({old_kind:?} → {kind:?}); retain its old input domain")),
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
        let action_result_changed=old.schema.action_specs.get(name).map(|s|&s.returns)!=new.schema.action_specs.get(name).map(|s|&s.returns);
        if action_result_changed || result(&before.result,old)!=result(&after.result,new) {lines.push(format!("{prefix}: RESULT REVIEW: result shape/value domain changed; preserve the old projection/domain or introduce a new operation before retiring old clients"));}
        let old_domains=crate::result_domains::signature(before,old);
        let new_domains=crate::result_domains::signature(after,new);
        let changed:Vec<_>=old_domains.keys().chain(new_domains.keys()).collect::<std::collections::BTreeSet<_>>().into_iter().filter(|key|old_domains.get(*key)!=new_domains.get(*key)).cloned().collect();
        if !changed.is_empty() {lines.push(format!("{prefix}: RESULT REVIEW: declared source domains consumed by this operation changed: {}; results or refusals may change even when the TypeScript type stays number/string; preserve the old domains or verify old-client handling",changed.join(", ")));}
        if refusals(before)!=refusals(after) {lines.push(format!("{prefix}: BEHAVIOR REVIEW: refusal codes/messages changed ({:?} → {:?}); verify intended denials separately from input breaks",refusals(before),refusals(after)));}
    }
    lines
}
