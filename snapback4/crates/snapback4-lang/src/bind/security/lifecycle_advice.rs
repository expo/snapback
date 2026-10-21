//! State advice requires authored transitions, not merely an enum declaration.
// @ref LLP 3000.036.004#142-advice-without-declared-invariants — transition evidence narrows advisory state questions.
use super::*;
use serde_json::Value as Json;
fn visit(value:&Json,f:&mut impl FnMut(&Json)){
    f(value);match value{Json::Object(xs)=>for x in xs.values(){visit(x,f)},Json::Array(xs)=>for x in xs{visit(x,f)},_=>{}}
}
fn table_of(value:&Json,bindings:&BTreeMap<String,Json>,depth:usize)->Option<String>{
    if depth>32{return None;}
    if let Some(get)=value.get("Get"){return get.get("table")?.as_str().map(str::to_owned);}
    if let Some(name)=value.get("Variable").and_then(Json::as_str){return table_of(bindings.get(name)?,bindings,depth+1);}
    if let Some(block)=value.get("Block"){return table_of(block.get("value")?,bindings,depth+1);}
    if let Some(builtin)=value.get("Builtin"){
        let args=builtin.get("args")?.as_array()?;
        if args.len()==1{return table_of(&args[0],bindings,depth+1);}
    }
    None
}
pub(super) fn states(bound:&Bound,name:&str,t:&snapback4_core::schema::Table)->Vec<String>{
    let roles=super::privilege::role_columns(bound,name);
    let candidates=t.columns.iter().filter(|(c,k)|!c.starts_with('$')&&!roles.contains(*c)&&matches!(k.required(),snapback4_core::schema::ColumnType::Enum{..})&&!t.constraints.iter().any(|k|matches!(k,snapback4_core::schema::Constraint::Immutable{fields} if fields.contains(*c)))).map(|(c,_)|c.clone()).collect::<BTreeSet<_>>();
    let mut written=BTreeSet::new();let mut compared=BTreeSet::new();
    for p in &bound.programs{
        let json=serde_json::to_value(&p.program).unwrap();let mut bindings=BTreeMap::new();let mut ambiguous=BTreeSet::new();
        visit(&json,&mut |v|for tag in ["Let","Const","Assign"]{if let Some(b)=v.get(tag)&&let (Some(n),Some(value))=(b.get("name").and_then(Json::as_str),b.get("value")){
            if bindings.get(n).is_some_and(|old|old!=value){ambiguous.insert(n.to_string());}else{bindings.insert(n.to_string(),value.clone());}
        }});
        for n in ambiguous{bindings.remove(&n);}
        visit(&json,&mut |v|{
            for tag in ["Update","Upsert","WriteTarget"]{if let Some(body)=v.get(tag){
                let target=if tag=="WriteTarget"{body.get("target").and_then(|r|r.get("table"))}else{body.get("table")};
                if target.and_then(Json::as_str)!=Some(name){continue;}
                let patch=body.get(if tag=="Upsert"{"row"}else{"patch"}).and_then(|v|v.get("Object")).and_then(Json::as_object);
                if let Some(patch)=patch{for (c,value) in patch{if candidates.contains(c)&&value.get("Literal").and_then(|l|l.get("String")).is_some(){written.insert(c.clone());}}}
            }}
            if let Some(binary)=v.get("Binary")&&matches!(binary.get("op").and_then(Json::as_str),Some("Eq"|"Ne")){
                for side in ["left","right"]{if let Some(field)=binary.get(side).and_then(|v|v.get("Field"))&&let Some(c)=field.get("name").and_then(Json::as_str)&&candidates.contains(c)&&field.get("base").and_then(|base|table_of(base,&bindings,0)).as_deref()==Some(name){compared.insert(c.to_string());}}
            }
        });
    }
    written.intersection(&compared).cloned().collect()
}
