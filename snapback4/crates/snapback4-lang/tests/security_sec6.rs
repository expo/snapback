//! SEC6: every executed write and every returned row is an intent boundary.
use snapback4_lang::{compile,security::{self,challenges::{self,Campaign}}};
use snapback4_core::{Engine,Value};
fn bound(source:&str)->snapback4_lang::Bound{let b=compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b}
fn fixture(b:&snapback4_lang::Bound)->Engine{Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap()}
fn campaign(b:&snapback4_lang::Bound,e:&Engine)->Campaign{let mut c=Campaign::default();challenges::fixture_observers(b,e,&mut c);c}
const TABLE:&str="table docs:\n  owner: principal\n  secret: text <=40 ?\n  title: text <=40\n  read <- allow\n  insert <- allow\n  update <- allow\n  delete <- allow\n  online only\n";
fn seed(e:&mut Engine){e.seed_at([("docs".into(),Value::Row([("id".into(),Value::Id("doc".into())),("owner".into(),Value::Id("dev:owner".into())),("secret".into(),Value::String("private".into())),("title".into(),Value::String("public".into()))].into_iter().collect()))],challenges::NOW).unwrap();}
#[test]fn multiwrite_insert_and_intermediate_updates_check_independent_write_intent(){
 let b=bound(&format!("{TABLE}mutation create(owner: principal, secret: text <=40 ?):\n  r = insert docs {{owner,secret,title:'one'}}\n  update docs[r.id] {{title:'two'}}\n  return null\ninvariant docs.secret write only .owner = viewer\n"));
 let c=campaign(&b,&fixture(&b));assert!(c.violations.iter().any(|v|v.effect=="insert"&&v.reachability.is_reachable()),"{c:?}");
 let b=bound(&format!("{TABLE}mutation edit(doc: docs):\n  update docs[doc] {{secret:'changed'}}\n  update docs[doc] {{secret:'private'}}\n  return null\ninvariant docs.secret update only .owner = viewer\n"));let mut e=fixture(&b);seed(&mut e);
 let c=campaign(&b,&e);assert!(c.violations.iter().any(|v|v.effect=="update"&&v.reachability.is_reachable()),"{c:?}");
}
#[test]fn rolled_back_writes_and_unchanged_sibling_columns_do_not_refute(){
 for body in ["  update docs[doc] {secret:'changed'}\n  require false else NO\n  return null", "  update docs[doc] {title:'changed'}\n  return null"]{
 let b=bound(&format!("{TABLE}mutation edit(doc: docs):\n{body}\ninvariant docs.secret update only .owner = viewer\n"));let mut e=fixture(&b);seed(&mut e);let c=campaign(&b,&e);assert!(c.violations.is_empty(),"{c:?}");
 }
}
#[test]fn write_result_leak_is_caught_while_projection_and_column_gate_stay_safe(){
 for gate in [false,true]{
 let source=format!("{TABLE}shape publicDoc = {{id,title}}\nquery list():\n  return docs first 10 by .id publicDoc\nmutation edit(doc: docs):\n  update docs[doc] {{title:'changed'}}\ninvariant docs.secret read only .owner = viewer\n");
 let source=if gate{source.replace("secret: text <=40 ?","secret: text <=40 ? read <- .owner = viewer")}else{source};
 let b=bound(&source);let mut e=fixture(&b);seed(&mut e);let c=campaign(&b,&e);
 assert_eq!(c.violations.iter().any(|v|v.effect=="mutation result"&&v.reachability.is_reachable()),!gate,"{c:?}");
 let mut report=security::analyze(&b);security::add_source_notes(&mut report,&[("schema.q".into(),source)],&b);
 assert!(report.notes.iter().any(|n|n.code=="N_COLUMN_RESULT_EXPOSURE"&&n.message.contains("secret")),"{:?}",report.notes);
 }
}
#[test]fn guarded_creation_and_edit_asymmetry_are_advice_without_invariants(){
 let source=format!("{TABLE}mutation create(owner: principal, secret: text <=40 ?):\n  return insert docs {{owner,secret,title:'one'}}\nmutation edit(doc: docs, secret: text <=40 ?):\n  require viewer = 'service:editor' else NO\n  update docs[doc] {{secret}}\n");
 for guarded in [false,true]{let s=if guarded{source.replace("  return insert docs", "  require viewer = 'service:editor' else NO\n  return insert docs")}else{source.clone()};let b=bound(&s);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("schema.q".into(),s)],&b);
 assert_eq!(r.notes.iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"&&n.message.contains("secret")),!guarded,"{:?}",r.notes);assert!(!r.refuted());}
}

#[test]fn fixture_instrumentation_does_not_change_outcome_meter_or_product_state(){
 use snapback4_core::{Context,engine::fixture_trace::{Trace,Intent},schema::{Effect,RuleExpr}};
 let b=bound(&format!("{TABLE}mutation edit(doc: docs):\n  update docs[doc] {{title:'changed'}}\n"));let mut base=fixture(&b);seed(&mut base);
 let mut plain=base.fork_fixture().unwrap();let mut observed=base.fork_fixture().unwrap();
 let args=std::collections::BTreeMap::from([("doc".into(),Value::Id("doc".into()))]);
 let trace=Trace::new(vec![Intent{site:"intent".into(),table:"docs".into(),effects:vec![Effect::Update],column:None,policy:RuleExpr::Deny}]);
 let a=plain.mutate("edit",None,Context::new("dev:other",args.clone()).at(challenges::NOW)).unwrap();
 let z=observed.mutate("edit",None,Context::new("dev:other",args).at(challenges::NOW).with_fixture_trace(trace.clone())).unwrap();
 assert_eq!(serde_json::to_value(a).unwrap(),serde_json::to_value(z).unwrap());
 assert_eq!(plain.store().rows("docs").unwrap(),observed.store().rows("docs").unwrap());
 assert_eq!(trace.take().len(),1);
}

#[test]fn inserted_payload_is_an_observer_even_when_the_column_world_is_coupled(){
 let b=bound("table docs:\n  body: int\n  read <- allow\n  insert <- allow\n  online only\ntable markers:\n  code: int\n  unique code\n  read <- allow\n  insert <- allow\n  online only\nmutation file(body: int):\n  d = insert docs {body}\n  insert markers {code:d.body} if absent\n  return d\ninvariant docs.body read only deny\n");
 let c=campaign(&b,&fixture(&b));assert!(c.violations.iter().any(|v|v.effect=="mutation result"&&v.operation=="file"),"{c:?}");
}
#[test]fn saved_readable_image_is_not_judged_under_a_later_owner(){
 let b=bound(&format!("{TABLE}mutation transfer(doc: docs, who: principal):\n  old = docs[doc] ! else MISSING\n  require old.owner = viewer else NO\n  update docs[doc] {{owner:who}}\n  return old\ninvariant docs.secret read only .owner = viewer\n"));let mut e=fixture(&b);seed(&mut e);let c=campaign(&b,&e);
 assert!(c.violations.is_empty(),"{c:?}");assert!(c.unsupported.iter().any(|s|s.contains("policy image")),"{c:?}");
}
#[test]fn executed_upsert_arms_delete_and_if_absent_collision_keep_their_identity(){
 use snapback4_core::{Context,engine::fixture_trace::{Trace,Intent},schema::{Effect,RuleExpr}};
 let source=TABLE.replace("  read <- allow","  unique title\n  read <- allow");
 let b=bound(&format!("{source}mutation insertTwice():\n  insert docs {{owner:viewer,secret:null,title:'same'}} if absent\n  insert docs {{owner:viewer,secret:null,title:'same'}} if absent\n  return null\nmutation put(doc: docs):\n  upsert docs[doc] {{owner:viewer,secret:'new',title:'put'}}\n  return null\nmutation replace(doc: docs):\n  delete docs[doc]\n  upsert docs[doc] {{owner:viewer,secret:'new',title:'put'}}\n  return null\n"));
 let mut e=fixture(&b);seed(&mut e);
 let trace=Trace::new(vec![Intent{site:"intent".into(),table:"docs".into(),effects:vec![Effect::Insert,Effect::Update,Effect::Delete],column:None,policy:RuleExpr::Deny}]);
 let call=|e:&mut Engine,name:&str,args:std::collections::BTreeMap<String,Value>|e.mutate(name,None,Context::new("dev:other",args).at(challenges::NOW).with_fixture_trace(trace.clone())).unwrap();
 assert!(matches!(call(&mut e,"insertTwice",Default::default()).state,snapback4_core::WriteState::Sent{..}));
 assert_eq!(trace.take().iter().map(|o|o.effect).collect::<Vec<_>>(),vec![Effect::Insert]);
 let args=std::collections::BTreeMap::from([("doc".into(),Value::Id("doc".into()))]);
 assert!(matches!(call(&mut e,"put",args.clone()).state,snapback4_core::WriteState::Sent{..}));assert_eq!(trace.take()[0].effect,Effect::Update);
 assert!(matches!(call(&mut e,"replace",args).state,snapback4_core::WriteState::Sent{..}));assert_eq!(trace.take().iter().map(|o|o.effect).collect::<Vec<_>>(),vec![Effect::Delete,Effect::Insert]);
}

#[test]fn wave21_stored_code_disclosure_and_nonnull_creation_intent_are_replayed(){
 for (lane,source) in [("040",include_str!("security/wave21/040.q")),("048",include_str!("security/wave21/048.q"))]{
  let b=bound(source);let mut c=Campaign::default();challenges::generated_campaign(&b,&mut c,true);
  let caught=if lane=="040"{c.violations.iter().any(|v|v.reachability.is_reachable()&&matches!(v.operation.as_str(),"takeRetrieval"|"markReady")&&v.effect=="mutation result")}
   else{c.violations.iter().any(|v|v.reachability.is_reachable()&&v.operation=="addRider"&&v.effect=="insert"&&v.viewer.contains("instructor")&&v.row.field("riderGoals").is_ok_and(|v|*v!=Value::Null))};
  assert!(caught,"{lane}: {}",serde_json::to_string(&c).unwrap());
 }
}

#[test]fn matrix_snapshot_proposals_cannot_become_reachable_disclosures(){
 let b=bound("table docs:\n  secret: text <=40\n  read <- allow\n  insert <- deny\n  online only\nmutation observe(doc: docs):\n  return docs[doc]\ninvariant docs.secret read only deny\n");
 let mut c=Campaign::default();challenges::operations(&b,&fixture(&b),&mut c);
 assert!(c.violations.iter().all(|v|!v.reachability.is_reachable()),"{c:?}");
}

#[test]fn another_query_return_and_an_authored_refusal_are_projection_privacy_observers(){
 let source=format!("{TABLE}shape publicDoc = {{id,title}}\nquery publicList():\n  return docs first 10 by .id publicDoc\nquery full(doc: docs):\n  return docs[doc]\nmutation probe(doc: docs, guess: text <=40):\n  d = docs[doc] ! else MISSING\n  require d.secret = guess else WRONG\n  return null\n");
 let b=bound(&source);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("schema.q".into(),source)],&b);
 for operation in ["full:","probe:"]{assert!(r.notes.iter().any(|n|n.code=="N_COLUMN_RESULT_EXPOSURE"&&n.message.starts_with(operation)&&n.message.contains("secret")),"{:?}",r.notes);}
 assert!(!r.notes.iter().any(|n|n.code=="N_COLUMN_RESULT_EXPOSURE"&&n.message.starts_with("publicList:")));
}
