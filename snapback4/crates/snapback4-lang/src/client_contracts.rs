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
                let fields: BTreeMap<_,_>=table.columns.iter().filter(|(n,_)|!table.engine_field(n)).map(|(n,t)|(n,format!("{t:?};private={}",table.private_field(n)))).collect();
                format!("{}:{name}:{fields:?}",if matches!(ty,Ty::Page(..)){"page"}else{"row"})
            } else {format!("{ty:?}")}
        }
        Ty::Optional(t)=>format!("optional {}",result(t,bound)),
        Ty::List(t,_)|Ty::Collection(t,_)=>format!("list {}",result(t,bound)),
        Ty::Object(fields)|Ty::RowShape(fields)|Ty::RowObject(fields)=>format!("object {:?}",fields.iter().map(|(n,t)|(n,result(t,bound))).collect::<BTreeMap<_,_>>()),
        // Runtime string/number bounds do not change their TypeScript representation.
        Ty::Text(_)=>"string".into(),
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
        for (arg,kind) in &after.program.args {
            if !before.program.args.contains_key(arg) && !matches!(kind,A::Optional(_)) {
                lines.push(format!("{prefix}: INPUT BREAK: clients calling without new required argument {arg} get E_INPUT; give {arg} a fitting `default <literal>` or retain a compatible wrapper"));
            }
        }
        for (arg,kind) in &before.program.args {
            match after.program.args.get(arg) {
                None=>lines.push(format!("{prefix}: INPUT BREAK: removed argument {arg}; old calls sending it get E_INPUT; retain `{arg}: <old type> deprecated` on a query/mutation")),
                Some(next) if !accepts(kind,next)=>lines.push(format!("{prefix}: INPUT BREAK: argument {arg} retyped or narrowed ({kind:?} → {next:?}); old values may get E_INPUT; retain the old input domain or a compatible wrapper")),
                _=>{}
            }
        }
        if result(&before.result,old)!=result(&after.result,new) {lines.push(format!("{prefix}: RESULT REVIEW: result shape/value domain changed; preserve the old projection/domain or introduce a new operation before retiring old clients"));}
        if refusals(before)!=refusals(after) {lines.push(format!("{prefix}: BEHAVIOR REVIEW: refusal codes/messages changed ({:?} → {:?}); verify intended denials separately from input breaks",refusals(before),refusals(after)));}
    }
    lines
}
