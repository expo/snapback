//! Wave-28 precision: workflow structure and named evidence are source-bound.
use snapback4_lang::{compile,security};
fn bound(source:&str)->(Vec<(String,String)>,snapback4_lang::Bound){let sources=vec![("schema.q".into(),source.into())];let b=compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);(sources,b)}
fn notes(source:&str)->Vec<snapback4_lang::Diagnostic>{let(s,b)=bound(source);let mut r=security::analyze_rules(&b);security::add_source_notes(&mut r,&s,&b);r.notes}
fn campaign(source:&str)->security::challenges::Campaign{let(s,b)=bound(source);let b=security::derived::augmented(&s,&b);let mut c=security::challenges::Campaign::work_bounded(2048);security::challenges::generated_campaign(&b,&mut c,false);c}
#[test]fn recording_a_workflow_effect_is_a_modeled_approved_act(){
 let source=include_str!("security/wave28/011.q");for source in [source.to_owned(),source.replace("recordInstallation","captureWork"),source.replace("recordInstallation","recordWork")]{assert!(notes(&source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"&&n.message.contains("indoorApproved")),"{:?}",notes(&source));}
}
#[test]fn text_lists_are_evidence_questions_too(){
 let source=include_str!("security/wave28/047.q");let ns=notes(source);assert!(ns.iter().any(|n|n.code=="N_TEXT_EVIDENCE"&&n.message.contains("trialPhotos")&&n.rewrite.contains("image list")),"{ns:?}");
}
#[test]fn renamed_workflow_discriminators_do_not_become_approved_evidence(){
 let source=include_str!("security/wave28/026.q");let definition=source.lines().find(|line|line.trim_start().starts_with("benchStatus:")).unwrap();let text=source.replace(definition,"  benchStatus: text <=30 default 'opened'");for (source,name) in [(source,"benchStatus"),(source,"workflowMarker"),(text.as_str(),"workflowMarker")]{let source=source.replace("benchStatus",name);let(s,b)=bound(&source);let cs=security::derived::invariants(&s,&b);assert!(!cs.iter().any(|i|i.column.as_deref()==Some(name)&&i.policy.as_ref().is_some_and(|p|p.quarry().contains("approved"))),"{cs:?}");let c=campaign(&source);assert!(!c.violations.iter().any(|v|v.reachability.is_reachable()),"{:?}",c.violations);}
}
#[test]fn approval_follows_named_media_even_without_an_explicit_media_require(){
 let source=include_str!("security/wave28/036.q");let(s,b)=bound(source);let cs=security::derived::invariants(&s,&b);assert!(cs.iter().any(|i|i.column.as_deref()==Some("likenessScan")),"{cs:?}");let c=campaign(source);assert!(c.violations.iter().any(|v|v.operation=="changeLikeness"&&v.reachability.is_reachable()),"{:?}",c.violations);assert!(!c.violations.iter().any(|v|v.operation=="approveLikenessChange"&&v.reachability.is_reachable()),"{:?}",c.violations);
}

#[test]fn visible_minima_apply_to_arguments_rows_and_list_elements(){
 use snapback4_core::{Engine,Context,Value,WriteState};use std::collections::BTreeMap;
 let source="table docs:\n  reason: text 1..30\n  reasons: [text 1..30] <=3 ?\n  read <- allow\n  insert <- allow\n  online only\nmutation typed(reason: text 1..30):\n  return reason\nmutation store(reason: text <=30,reasons: [text <=30] <=3 ?):\n  return insert docs {reason,reasons}\nmutation trimmed(reason: text <=30):\n  require trim(reason) != '' else EMPTY\n  return reason\n";
 let(_,b)=bound(source);let mut engine=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
 for blank in ["\u{200b}","\u{feff}","\u{2060}","\u{ad}","\u{2066}\u{2069}","\u{fe0f}"]{
  for (op,reason,reasons) in [("typed",blank,None),("trimmed",blank,None),("store",blank,Some(Value::Null)),("store","visible",Some(Value::Array(vec![Value::String(blank.into())])))]{
   let mut args=BTreeMap::from([("reason".into(),Value::String(reason.into()))]);if let Some(reasons)=reasons{args.insert("reasons".into(),reasons);}let out=engine.mutate(op,None,Context::new("alice",args).with_ids(["new".into()])).unwrap();assert!(matches!(out.state,WriteState::Failed{..}),"{op}: {out:?}");
  }
 }
 for text in ["❤️","同意"," a "]{let out=engine.mutate("typed",None,Context::new("alice",BTreeMap::from([("reason".into(),Value::String(text.into()))]))).unwrap();assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");}
}

#[test]fn a_guarded_data_setter_does_not_erase_approval_evidence(){
 let source="table docs:\n  material: enum('steel','wood')\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.material = 'steel' else WRONG_MATERIAL\n  update docs[doc] {approved:true}\nmutation replace(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.material = 'steel' else WRONG_MATERIAL\n  update docs[doc] {material:'wood'}\n";
 let(s,b)=bound(source);let cs=security::derived::invariants(&s,&b);assert!(cs.iter().any(|i|i.column.as_deref()==Some("material")),"{cs:?}");
}
#[test]fn unrelated_subject_prefixes_do_not_derive_asset_freezes(){
 for (stamp,column) in [("carApproved","cargoPhoto"),("artApproved","artistPhoto")]{let source=format!("table docs:\n  {column}: image <=10000\n  {stamp}: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {{{stamp}:true}}\nmutation replace(doc: docs,photo: image <=10000):\n  update docs[doc] {{{column}:photo}}\n");let(s,b)=bound(&source);assert!(!security::derived::invariants(&s,&b).iter().any(|i|i.column.as_deref()==Some(column)));}
}

#[test]fn checked_caller_data_stays_an_input_when_other_operations_stage_its_column(){
 for kind in ["enum('steel','wood')","text <=30"]{
 let source=format!("table docs:\n  material: {kind}\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs,material: {kind}):\n  require material = 'steel' else WRONG_MATERIAL\n  update docs[doc] {{material,approved:true}}\nmutation replace(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.material = 'steel' else WRONG_MATERIAL\n  update docs[doc] {{material:'wood'}}\nmutation restore(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.material = 'wood' else WRONG_MATERIAL\n  update docs[doc] {{material:'steel'}}\n");let(s,b)=bound(&source);let cs=security::derived::invariants(&s,&b);assert!(cs.iter().any(|i|i.column.as_deref()==Some("material")),"{cs:?}");
 }
}

#[test]fn named_subjects_follow_positive_birth_and_default_recordings(){
 for (default,field) in [("false",",likenessApproved:true"),("true","")]{let source=format!("table docs:\n  likenessScan: image <=10000\n  likenessApproved: bool default {default}\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create(photo: image <=10000):\n  return insert docs {{likenessScan:photo{field}}}\nmutation replace(doc: docs,photo: image <=10000):\n  update docs[doc] {{likenessScan:photo}}\n");let(s,b)=bound(&source);let cs=security::derived::invariants(&s,&b);assert!(cs.iter().any(|i|i.column.as_deref()==Some("likenessScan")),"{cs:?}");let c=campaign(&source);assert!(c.violations.iter().any(|v|v.operation=="replace"&&v.reachability.is_reachable()),"{:?}",c.violations);}
}
#[test]fn text_workflow_effects_are_modeled_approval_acts(){
 let source="table docs:\n  workflow: text <=30 default 'wiring'\n  indoorMount: bool default false\n  indoorApproved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation request(doc: docs):\n  require viewer = 'service:worker' else NOT_WORKER\n  update docs[doc] {indoorMount:true}\nmutation approve(doc: docs):\n  require viewer = 'service:owner' else NOT_OWNER\n  d = docs[doc] ! else MISSING\n  require d.indoorMount else NOT_REQUESTED\n  update docs[doc] {indoorApproved:true}\nmutation captureWork(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.workflow = 'wiring' else BAD_STAGE\n  update docs[doc] {workflow:'inspection'}\n";
 assert!(notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{:?}",notes(source));
}

#[test]fn evidence_words_are_not_metadata_prefixes(){
 for column in ["likenessCostume","likenessAtlas","likenessConsentForm","likeness_costume","likeness_consent_form"]{let source=format!("table docs:\n  {column}: image <=10000\n  likenessApproved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {{likenessApproved:true}}\nmutation replace(doc: docs,photo: image <=10000):\n  update docs[doc] {{{column}:photo}}\n");let(s,b)=bound(&source);assert!(security::derived::invariants(&s,&b).iter().any(|i|i.column.as_deref()==Some(column)),"{column}");}
}
