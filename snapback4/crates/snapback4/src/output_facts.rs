//! Lossless presentation of changed result facts and repeated coverage reasons.
// @ref LLP 3000.037.000#12-repeat-command-output-budgets-tok2 — unchanged fields and repeated prefixes belong in complete evidence.
use std::collections::{BTreeMap,BTreeSet};
use serde_json::Value;

pub(crate) fn group_reasons<'a>(notes:impl IntoIterator<Item=&'a String>, names:&BTreeSet<&str>)->String {
    let mut grouped=BTreeMap::<&str,BTreeSet<&str>>::new();let mut other=Vec::new();
    for note in notes {
        if let Some((name,reason))=note.split_once(": ") && names.contains(name) {grouped.entry(reason).or_default().insert(name);}
        else {other.push(note.as_str().to_owned());}
    }
    other.extend(grouped.into_iter().map(|(reason,names)|format!("{}: {reason}",names.into_iter().collect::<Vec<_>>().join(", "))));
    other.join("; ")
}

fn one<'a>(v:&'a Value,key:&str)->Option<&'a Value>{v.as_object().filter(|o|o.len()==1).and_then(|o|o.get(key))}
fn short(v:&Value)->String {
    if let Some(s)=v.as_str(){return s.to_owned();}
    for (key,left,right) in [("nullable","(",")?"),("omittable","omittable<",">"),("page","page<",">"),("list","list<",">")] {
        if let Some(inner)=one(v,key){return format!("{left}{}{right}",short(inner));}
    }
    if let Some(fields)=one(v,"row").and_then(Value::as_object){return format!("{{{}}}",fields.iter().map(|(k,v)|format!("{k}:{}",short(v))).collect::<Vec<_>>().join(", "));}
    v.to_string()
}
fn changes(path:&str,before:&Value,after:&Value,out:&mut Vec<String>) {
    if before==after{return;}
    let wrapper=|v:&Value|["nullable","omittable"].into_iter().find(|k|one(v,k).is_some());
    if wrapper(before).is_some() && wrapper(after).is_some() && wrapper(before)!=wrapper(after) {
        out.push(format!("{path}: {} → {}",short(before),short(after)));return;
    }
    for key in ["nullable","omittable"] {
        let (a,b)=(one(before,key),one(after,key));
        if a.is_some() || b.is_some() {
            if a.is_none() || b.is_none(){let change=if b.is_some(){format!("now declared {key}")}else{format!("no longer declared {key}")};out.push(format!("{path}: {change}"));}
            changes(path,a.unwrap_or(before),b.unwrap_or(after),out);return;
        }
    }
    if let (Some(a),Some(b))=(one(before,"row").and_then(Value::as_object),one(after,"row").and_then(Value::as_object)) {
        for name in a.keys().chain(b.keys()).collect::<BTreeSet<_>>() {
            let p=format!("{path}.{name}");
            match (a.get(name),b.get(name)) {
                (Some(a),Some(b))=>changes(&p,a,b,out),
                (Some(a),None)=>out.push(format!("{p}: {} → missing",short(a))),
                (None,Some(b))=>out.push(format!("{p}: added {}",short(b))),
                _=>{},
            }
        }return;
    }
    for key in ["page","list"] {
        if let (Some(a),Some(b))=(one(before,key),one(after,key)){changes(&format!("{path}[]"),a,b,out);return;}
    }
    out.push(format!("{path}: {} → {}",short(before),short(after)));
}
pub(crate) fn row_shape(shape:&Value)->String {
    let mut out=Vec::new();
    for diff in shape["differences"].as_array().into_iter().flatten() {
        let name=diff["operation"].as_str().unwrap_or("?");
        if diff["served"].is_null(){out.push(format!("{name}: operation missing"));}
        else {changes(name,&diff["expected"],&diff["served"],&mut out);}
    }
    for child in shape["children"].as_array().into_iter().flatten() {
        out.push(format!("child {} of {} retains columns {}",child["child"],child["parent"],child["columns"]));
    }
    format!("target row shape CHANGED (release {}): {}",shape["target"],out.join("; "))
}

#[cfg(test)]
mod tests {
    use super::*;use serde_json::json;
    #[test]
    fn shape_delta_keeps_nullability_omission_missing_fields_operations_and_children() {
        let shape=json!({"differences":[{"operation":"list","expected":{"page":{"row":{"id":"id","amount":"Int","gone":"text","private":{"omittable":"text"}}}},"served":{"page":{"row":{"id":"id","amount":{"nullable":"Int"},"added":"text","private":"text"}}}},{"operation":"removed","expected":"Int","served":null}],"children":[{"parent":"orders","child":"photos","columns":["photo"]}]});
        let text=row_shape(&shape);
        for fact in ["list[].amount: now declared nullable","list[].private: no longer declared omittable","list[].gone: text → missing","list[].added: added text","removed: operation missing","photos","photo"]{assert!(text.contains(fact),"{text}");}
        assert!(!text.contains(".id:"),"unchanged fields stay in complete JSON: {text}");
        assert!(short(&json!({"nullable":{"omittable":"Int"}}))!=short(&json!({"omittable":{"nullable":"Int"}})));
        let future=json!({"differences":[{"operation":"future","expected":{"row":{"id":"id"},"newMetadata":"before"},"served":{"row":{"id":"id"},"newMetadata":"after"}}]});
        let text=row_shape(&future);assert!(text.contains("newMetadata")&&text.contains("before")&&text.contains("after"),"unknown forms remain complete: {text}");
    }
    #[test]
    fn grouping_preserves_every_affected_operation_and_distinct_reason() {
        let notes=["accept: actor-specific histories uncovered".into(),"decline: actor-specific histories uncovered".into(),"accept: no upload ledger".into(),"E_ASSET_TYPE: declare a file".into()];
        let text=group_reasons(&notes,&BTreeSet::from(["accept","decline"]));
        assert!(text.contains("accept, decline: actor-specific histories uncovered")&&text.contains("accept: no upload ledger")&&text.contains("E_ASSET_TYPE: declare a file"));
    }
}
