//! Development argument checks shared by the host and fixture runner.
use serde_json::Value as Json;
#[cfg(test)] use serde_json::json;
use snapback4_core::Refusal;
use std::collections::BTreeMap;
pub(crate) fn arguments(personas:&[String],kinds:&BTreeMap<String,snapback4_core::ir::ArgType>,args:&Json)->Option<Refusal> {
    fn bare(kind:&snapback4_core::ir::ArgType,value:&Json,personas:&[String])->Option<String> {
        use snapback4_core::ir::ArgType;
        match kind {
            ArgType::Principal => value.as_str().filter(|v| personas.iter().any(|p| p==v)).map(String::from),
            ArgType::Optional(inner)=>bare(inner,value,personas),
            ArgType::List { of:Some(inner),.. }|ArgType::ListRange { of:Some(inner),.. }=>value.as_array()?.iter().find_map(|v|bare(inner,v,personas)),
            _=>None
        }
    }
    let fields=args.as_object()?;
    kinds.iter().find_map(|(name,kind)|bare(kind,fields.get(name)?,personas).map(|p|Refusal::new("E_INPUT","input",format!("argument {name}: '{p}' is a persona name, not a principal; write 'dev:{p}' (or use the authenticated account principal in production)")).guide("personas")))
}
#[cfg(test)]
mod qdiag_tests {
 use super::*;
 use snapback4_core::ir::ArgType;
 #[test] fn declared_persona_principals_are_checked_without_rewriting_identity(){
  let personas=vec!["alice".into()];let kinds=BTreeMap::from([("p".into(),ArgType::Principal)]);
  let value=json!({"p":"alice"});
  let why=arguments(&personas,&kinds,&value).unwrap();assert_eq!(why.code,"E_INPUT");assert!(why.message.contains("dev:alice"));assert_eq!(value,json!({"p":"alice"}));
  for p in ["dev:alice","aliceOther","user:alice","service:alice"] {assert!(arguments(&personas,&kinds,&json!({"p":p})).is_none());}
  assert!(arguments(&[],&kinds,&value).is_none());
  assert!(arguments(&personas,&BTreeMap::from([("p".into(),ArgType::Id)]),&value).is_none());
  let lists=BTreeMap::from([("p".into(),ArgType::Optional(Box::new(ArgType::List {of:Some(Box::new(ArgType::Principal)),max:5})))]);
  assert!(arguments(&personas,&lists,&json!({"p":["dev:alice","alice"]})).is_some());
 }
}
