//! Evaluate frozen query calls on private replay copies; emit hashes/presence only.
//! Build as a temporary `snapback4` example, then remove that temporary source.
use serde_json::{Value as Json,json};
use snapback4_core::{Engine, Context, store_port::AnyStore, value::digest};
use std::{collections::BTreeMap,path::Path};
fn rows(value:&Json,out:&mut Vec<Json>){
    match value{
        Json::Array(values)=>for value in values{rows(value,out)},
        Json::Object(fields)=>{
            if let Some(id)=fields.get("id").and_then(Json::as_str){
                let hashes=fields.iter().map(|(field,value)|(field.clone(),json!({"present":true,"null":value.is_null(),"sha256":digest(value)}))).collect::<BTreeMap<_,_>>();
                out.push(json!({"idSha256":digest(&id),"fields":hashes}));
            }else{for value in fields.values(){rows(value,out);}}
        },_=>()
    }
}
fn main()->Result<(),Box<dyn std::error::Error>>{
    let args=std::env::args().collect::<Vec<_>>();
    let deployment=Path::new(&args[1]);let probes:Json=serde_json::from_slice(&std::fs::read(&args[2])?)?;
    let store=AnyStore::open(&deployment.join("store.sqlite"))?;
    let release=store.release_value()?.ok_or("no selected release")?.parse()?;
    let mut e=Engine::attach_release_at(store,release,snapback4_core::now_ms())?;
    let mut result=Vec::new();
    for probe in probes.as_array().ok_or("probe list expected")?{
        let op=probe["operation"].as_str().ok_or("operation missing")?;
        let Some(program)=e.program(op)else{result.push(json!({"operation":op,"code":"E_OP"}));continue};
        let decoded=match snapback4_core::wire::arguments_from_json(program,&probe["args"]){Ok(args)=>args,Err(error)=>{result.push(json!({"operation":op,"code":error.code()}));continue}};
        match e.query(op,Context::new(probe["viewer"].as_str().ok_or("viewer missing")?,decoded)){
            Ok(outcome)=>{let mut projected=Vec::new();rows(&snapback4_core::wire::to_json(&outcome.data),&mut projected);result.push(json!({"operation":op,"viewerSha256":digest(&probe["viewer"]),"code":null,"complete":outcome.complete,"hasNext":outcome.next.is_some(),"rows":projected}));},
            Err(error)=>result.push(json!({"operation":op,"code":error.code()})),
        }
    }
    println!("{}",serde_json::to_string(&json!({"release":release,"results":result}))?);Ok(())
}
