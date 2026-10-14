use snapback4_core::{Context, Engine, Value, WriteState, engine::refusal_trace::RefusalTrace};
use std::collections::BTreeMap;
fn id(s:&str)->Value{Value::Id(s.into())}
fn text(s:&str)->Value{Value::String(s.into())}
fn args(v:&[(&str,Value)])->BTreeMap<String,Value>{v.iter().map(|(k,v)|(k.to_string(),v.clone())).collect()}
fn engine(source:&str)->Engine{let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap()}
fn why(e:&mut Engine,op:&str,who:&str,values:&[(&str,Value)])->snapback4_core::Refusal{match e.mutate(op,None,Context::new(who,args(values)).at(100)).unwrap().state{WriteState::Failed {why,..}=>why,s=>panic!("{s:?}")}}
const UNIQUE:&str="table rows:\n  owner: principal\n  writer: principal\n  handle: text <=20\n  other: text <=20 ?\n  unique handle\n  unique other else OTHER_TAKEN 'Other key is taken'\n  read <- .owner = viewer\n  insert <- .writer = viewer\n  update <- .writer = viewer\nmutation add(id: id, owner: principal, writer: principal, handle: text <=20, other: text <=20 ?):\n  return insert rows {id,owner,writer,handle,other}\nmutation absent(id: id, owner: principal, writer: principal, handle: text <=20, other: text <=20 ?):\n  return insert rows {id,owner,writer,handle,other} if absent\nquery page(c: cursor ?):\n  return rows first 10 by .id after c\n";
fn seed(e:&mut Engine,id_:&str,owner:&str,handle:&str,other:Option<&str>){e.seed(vec![("rows".into(),snapback4_core::value::object([("id",id(id_)),("owner",id(owner)),("writer",id(owner)),("handle",text(handle)),("other",other.map(text).unwrap_or(Value::Null))]))]).unwrap();}
fn input(id_:&str,owner:&str,handle:&str,other:Option<&str>)->Vec<(&'static str,Value)>{vec![("id",id(id_)),("owner",id(owner)),("writer",id(owner)),("handle",text(handle)),("other",other.map(text).unwrap_or(Value::Null))]}
#[test]
fn visible_unique_names_the_declaration_and_authored_code_wins(){
 let mut e=engine(UNIQUE);seed(&mut e,"old","alice","key",Some("other"));
 let visible=why(&mut e,"add","alice",&input("new","alice","key",None));
 assert_eq!(visible.code,"E_UNIQUE");assert!(visible.message.contains("unique handle") && !visible.message.contains("$intent"));
 let named=why(&mut e,"add","alice",&input("new","alice","different",Some("other")));assert_eq!(named.code,"OTHER_TAKEN");
 assert_eq!(why(&mut e,"add","alice",&input("old","alice","different",None)).code,"E_CONSTRAINT");
 let absent=e.mutate("absent",None,Context::new("alice",args(&input("new","alice","key",None))).at(100)).unwrap();
 assert!(matches!(absent.state,WriteState::Sent {result:Value::Null,..}));
 // Null secondary keys do not conflict; the handle remains independently unique.
 for (i,handle) in [("two","two"),("three","three")] {assert!(matches!(e.mutate("add",None,Context::new("alice",args(&input(i,"alice",handle,None))).at(100)).unwrap().state,WriteState::Sent {..}));}
}
#[test]
fn hidden_unique_is_the_same_public_refusal_as_rule_denial_including_seats(){
 for viewer in ["alice","service:ops"] {
  let mut e=engine(UNIQUE);seed(&mut e,"old","bob","key",None);
  let collision=why(&mut e,"add",viewer,&input("new",viewer,"key",None));
  let mut denied=input("new",viewer,"different",None);denied[2].1=id("other");
  let denial=why(&mut e,"add",viewer,&denied);
  assert_eq!(collision,denial,"{viewer}");assert_eq!(collision.code,"E_RULE");assert!(collision.message.contains("a row you cannot read holds this key"));
  if viewer.starts_with("service:"){assert!(collision.message.contains("rows rule clause: insert <- .writer = viewer"));}
  assert_eq!(e.store().rows("rows").unwrap().len(),1);
 }
}
#[test]
fn hidden_counter_is_request_local_and_changes_no_query_envelope_or_meter(){
 let mut e=engine(UNIQUE);seed(&mut e,"a","alice","a",None);seed(&mut e,"b","bob","b",None);
 let plain=e.query("page",Context::new("alice",args(&[("c",Value::Null)])).at(100)).unwrap();
 let trace=RefusalTrace::default();
 let traced=e.query("page",Context::new("alice",args(&[("c",Value::Null)])).at(100).with_refusal_trace(trace.clone())).unwrap();
 assert_eq!(serde_json::to_value(plain).unwrap(),serde_json::to_value(traced).unwrap());
 assert_eq!(trace.hidden(),1);
 let next=RefusalTrace::default();e.query("page",Context::new(snapback4_core::SYSTEM_PRINCIPAL,args(&[("c",Value::Null)])).at(100).with_refusal_trace(next.clone())).unwrap();assert_eq!(next.hidden(),0);
}
#[test]
fn ephemeral_seat_denials_have_the_same_static_clause(){
 let mut e=engine("table typing:\n  owner: principal\n  unique owner\n  cap 50\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  ephemeral 4s\nmutation add(owner: principal):\n  return insert typing {owner}\n");
 let denied=why(&mut e,"add","service:ops",&[("owner",id("alice"))]);assert_eq!(denied.code,"E_RULE");assert!(denied.message.ends_with("typing rule clause: insert <- .owner = viewer"),"{denied:?}");
}
#[test]
fn hidden_point_images_are_counted_outside_the_query_envelope(){
 let source=format!("{UNIQUE}query point(key: rows):\n  return rows[key]\n");let mut e=engine(&source);seed(&mut e,"hidden","bob","key",None);
 let trace=RefusalTrace::default();let values=args(&[("key",id("hidden"))]);
 let plain=e.query("point",Context::new("alice",values.clone()).at(100)).unwrap();
 let traced=e.query("point",Context::new("alice",values).at(100).with_refusal_trace(trace.clone())).unwrap();assert_eq!(serde_json::to_value(plain).unwrap(),serde_json::to_value(traced).unwrap());assert_eq!(trace.hidden(),1);
}
