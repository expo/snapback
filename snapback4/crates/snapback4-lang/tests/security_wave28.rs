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

#[test]fn literal_self_assignments_do_not_establish_workflow_discriminators(){
 for kind in ["enum('steel','wood')","text <=30"]{let source=format!("table docs:\n  material: {kind}\n  coatingReason: text <=30\n  coatingApproved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.material = 'steel' else WRONG_MATERIAL\n  update docs[doc] {{coatingApproved:true}}\nmutation keepSteel(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.material = 'steel' else WRONG_MATERIAL\n  update docs[doc] {{material:'steel'}}\nmutation keepWood(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.material = 'wood' else WRONG_MATERIAL\n  update docs[doc] {{material:'wood'}}\nmutation replace(doc: docs):\n  update docs[doc] {{material:'wood'}}\n");for guard in ["d.material = 'steel'", "(d.material != 'wood') = true", "false != (d.material != 'wood')", "not ((d.material = 'steel') = false)", "trim(d.material) = 'steel'","d.material = 'steel' and viewer = 'service:worker'"] {let guard=if kind.starts_with("text"){guard.replace("d.material != 'wood'","d.material = 'steel'")}else{guard.into()};let variant=source.replace("require d.material = 'steel' else WRONG_MATERIAL\n  update docs[doc] {material:'steel'}",&format!("require {guard} else WRONG_MATERIAL\n  update docs[doc] {{material:'steel'}}"));let(s,b)=bound(&variant);assert!(security::derived::invariants(&s,&b).iter().any(|i|i.column.as_deref()==Some("material")),"{kind}: {guard}");}}
}

#[test]fn generic_noop_setters_do_not_establish_workflow_discriminators(){
 let source="table docs:\n  material: enum('steel','wood')\n  coatingReason: text <=30\n  coatingApproved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.material = 'steel' else WRONG_MATERIAL\n  update docs[doc] {coatingApproved:true}\nmutation keep(doc: docs,material: enum('steel','wood')):\n  d = docs[doc] ! else MISSING\n  require d.material = 'steel' or d.material = 'wood' else WRONG_MATERIAL\n  require material = d.material else SAME_ONLY\n  update docs[doc] {material}\nmutation replace(doc: docs):\n  update docs[doc] {material:'wood'}\n";
 let(s,b)=bound(source);assert!(security::derived::invariants(&s,&b).iter().any(|i|i.column.as_deref()==Some("material")));
}

#[test]fn approvals_allow_the_workflow_transitions_that_consume_them(){
 for source in [include_str!("security/wave28/historical-20-004.q"),include_str!("security/wave28/historical-20-026.q"),include_str!("security/wave28/historical-22-010.q"),include_str!("security/wave28/historical-22-039.q"),include_str!("security/wave28/historical-22-043.q"),include_str!("security/wave28/historical-24-020.q"),include_str!("security/wave28/historical-24-034.q"),include_str!("security/wave28/historical-24-048.q"),include_str!("security/wave28/historical-26-011.q"),include_str!("security/wave28/historical-26-026.q")]{let(s,b)=bound(source);let cs=security::derived::invariants(&s,&b);assert!(!cs.iter().any(|i|["status","stage"].contains(&i.column.as_deref().unwrap_or(""))&&i.policy.as_ref().is_some_and(|p|p.quarry().contains("old.")&&p.quarry().contains("approv"))),"{cs:?}");}
}
#[test]fn sibling_effects_test_approval_after_leaving_the_prior_stage(){
 let source=include_str!("security/wave28/historical-24-034.q");let(s,b)=bound(source);let cs=security::derived::invariants(&s,&b);let contracts=cs.iter().filter(|i|i.site.file.contains("sibling-approval")&&i.predicate.contains("printed")).collect::<Vec<_>>();assert!(!contracts.is_empty(),"{cs:?}");assert!(contracts.iter().all(|i|!i.predicate.contains("proofed")),"{contracts:?}");let c=campaign(source);assert!(!c.violations.iter().any(|v|v.reachability.is_reachable()&&v.invariant_site.starts_with("$derived")),"{:?}",c.violations);
}

#[test]fn independent_roles_and_boolean_wrappers_preserve_workflow_admissions(){
 let source="table docs:\n  workflow: enum('draft','ready','closed') default 'draft'\n  coilReason: text <=30\n  coilApproved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require STAGE else BAD_STAGE\n  update docs[doc] {coilApproved:true}\nmutation prepare(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.workflow = 'draft' and viewer = 'service:worker' else BAD_STAGE\n  update docs[doc] {workflow:'ready'}\n";
 for guard in ["d.workflow != 'closed'","(d.workflow != 'closed') = true","false != (d.workflow != 'closed')","not ((d.workflow != 'closed') = false)"]{let source=source.replace("require STAGE else",&format!("require {guard} else"));let(s,b)=bound(&source);assert!(!security::derived::invariants(&s,&b).iter().any(|i|i.column.as_deref()==Some("workflow")&&i.predicate.contains("old.coilApproved")),"{guard}");}
}

#[test]fn recorded_approving_principal_is_a_workflow_receipt(){
 let source="table docs:\n  workflow: enum('draft','ready','done') default 'draft'\n  approved: bool default false\n  approvedBy: principal ?\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create():\n  return insert docs {}\nmutation prepare(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.workflow = 'draft' else BAD_STAGE\n  update docs[doc] {workflow:'ready'}\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.workflow = 'ready' else BAD_STAGE\n  update docs[doc] {approved:true,approvedBy:viewer}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.workflow = 'ready' and d.approvedBy = viewer else BAD_APPROVAL\n  update docs[doc] {workflow:'done'}\n";
 for source in [source.to_owned(),source.replace("{workflow:'done'}","{workflow:'done',approved:false,approvedBy:null}")]{let(s,b)=bound(&source);let cs=security::derived::invariants(&s,&b);assert!(!cs.iter().any(|i|i.column.as_deref()==Some("workflow")&&i.predicate.contains("old.approved")),"{cs:?}");assert!(cs.iter().any(|i|i.site.file.contains("sibling-approval")&&i.predicate.contains("approvedBy = viewer")),"{cs:?}");let c=campaign(&source);assert!(!c.violations.iter().any(|v|v.reachability.is_reachable()),"{:?}",c.violations);}
 let unchecked=format!("{source}mutation bypass(doc: docs):\n  update docs[doc] {{workflow:'done',approved:false,approvedBy:null}}\n");let c=campaign(&unchecked);assert!(c.violations.iter().any(|v|v.operation=="bypass"&&v.reachability.is_reachable()),"{c:?}");
}
#[test]fn required_text_preparation_survives_directed_history_deduplication(){
 let source="table docs:\n  consent: text <=20\n  approved: bool default false\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create():\n  return insert docs {consent:'no'}\nmutation prepare(doc: docs):\n  update docs[doc] {consent:'yes'}\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.consent = 'yes' else NO_CONSENT\n  update docs[doc] {approved:true}\nmutation replace(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approved else NOT_APPROVED\n  update docs[doc] {consent:'no'}\n";
 let c=campaign(source);assert!(c.violations.iter().any(|v|v.operation=="replace"&&v.reachability.is_reachable()&&{let names=v.history.iter().map(|s|s.operation.as_str()).collect::<Vec<_>>();names.windows(3).any(|w|w==["prepare","approve","replace"])}),"{:?}",c.violations);
}

#[test]fn literal_or_argument_self_consumers_do_not_erase_single_value_evidence(){
 for (args,guard,value) in [("","d.material = 'steel'","'steel'"),(",material: enum('steel','wood')","d.material = 'steel' and material = d.material","material"),(",material: enum('steel','wood')","d.material = 'steel' and material = 'steel'","material")]{let source=format!("table docs:\n  material: enum('steel','wood')\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.material = 'steel' else MATERIAL\n  update docs[doc] {{approved:true}}\nmutation change(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.material = 'steel' else MATERIAL\n  update docs[doc] {{material:'wood'}}\nmutation keep(doc: docs{args}):\n  d = docs[doc] ! else MISSING\n  require {guard} else MATERIAL\n  require d.approved or viewer = 'service:owner' else APPROVAL\n  update docs[doc] {{material:{value}}}\n");let(s,b)=bound(&source);assert!(security::derived::invariants(&s,&b).iter().any(|i|i.column.as_deref()==Some("material")&&i.predicate.contains("old.approved")),"{source}");}
}

#[test]fn genuine_conditional_workflow_consumers_retain_their_whole_policy(){
 let source="table docs:\n  workflow: enum('ready','done') default 'ready'\n  approved: bool default false\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create():\n  return insert docs {}\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.workflow = 'ready' else STAGE\n  update docs[doc] {approved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.workflow = 'ready' else STAGE\n  require d.approved or viewer = 'service:owner' else APPROVAL\n  update docs[doc] {workflow:'done'}\nmutation bypass(doc: docs):\n  update docs[doc] {workflow:'done'}\n";
 let(s,b)=bound(source);let cs=security::derived::invariants(&s,&b);assert!(!cs.iter().any(|i|i.column.as_deref()==Some("workflow")&&i.predicate.contains("old.approved")),"{cs:?}");assert!(cs.iter().any(|i|i.site.file.contains("sibling-approval")&&i.predicate.contains(".approved or viewer = 'service:owner'")),"{cs:?}");let c=campaign(source);assert!(c.violations.iter().any(|v|v.operation=="bypass"&&v.reachability.is_reachable()),"{c:?}");assert!(!c.violations.iter().any(|v|v.operation=="finish"&&v.reachability.is_reachable()),"{:?}",c.violations);
}

#[test]fn authorization_record_names_do_not_identify_themselves_as_subject_data(){
 for stamp in ["coatingApproved","coatingAuthorized","coatingAuthorizationAt"]{let kind=if stamp.ends_with("At"){"time ?"}else{"bool default false"};let value=if stamp.ends_with("At"){"now"}else{"true"};let source=format!("table docs:\n  material: enum('steel','wood')\n  {stamp}: {kind}\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.material = 'steel' else MATERIAL\n  update docs[doc] {{{stamp}:{value}}}\nmutation change(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.material = 'steel' else MATERIAL\n  update docs[doc] {{material:'wood'}}\n");let(s,b)=bound(&source);assert!(security::derived::invariants(&s,&b).iter().any(|i|i.column.as_deref()==Some("material")),"{stamp}");}
}
#[test]fn global_receipt_effects_use_structural_workflow_columns(){
 for kind in ["enum('draft','done') default 'draft'","text <=30 default 'draft'"]{let source=format!("table approvals:\n  principal: principal\n  approved: bool default false\n  unique principal\n  read <- allow\n  online only\ntable docs:\n  workflow: {kind}\n  read <- allow\n  update <- allow\n  online only\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.workflow = 'draft' else STAGE\n  require exists approvals[principal = viewer, approved = true] else APPROVAL\n  update docs[doc] {{workflow:'done'}}\nmutation bypass(doc: docs):\n  update docs[doc] {{workflow:'done'}}\n");let(s,b)=bound(&source);assert!(security::derived::invariants(&s,&b).iter().any(|i|i.column.as_deref()==Some("workflow")&&i.site.file.contains("sibling-approval")&&i.predicate.contains("approvals")),"{kind}");}
}

#[test]fn positive_and_negative_receipt_wrappers_retain_operand_polarity(){
 let source="table docs:\n  workflow: enum('ready','done') default 'ready'\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.workflow = 'ready' else STAGE\n  update docs[doc] {approved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.workflow = 'ready' else STAGE\n  require RECEIPT else APPROVAL\n  update docs[doc] {workflow:'done'}\n";
 for (guard,positive) in [("(not d.approved) = false",true),("false = (not d.approved)",true),("(d.approved = false) != true",true),("(not d.approved) = true",false),("(d.approved = true) = false",false)]{let source=source.replace("RECEIPT",guard);let(s,b)=bound(&source);let cs=security::derived::invariants(&s,&b);assert_eq!(cs.iter().any(|i|i.column.as_deref()==Some("workflow")&&i.predicate.contains("old.approved")),!positive,"{guard}: {cs:?}");}
}

#[test]fn copied_or_parallel_workflow_fields_do_not_shadow_categorical_effects(){
 for workflow in ["d.workflow","'ready'"]{let source=format!("table docs:\n  workflow: enum('draft','ready') default 'draft'\n  outcome: enum('pending','released') default 'pending'\n  resolution: enum('pending','released') default 'pending'\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation prepare(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.workflow = 'draft' else STAGE\n  update docs[doc] {{workflow:'ready'}}\nmutation guarded(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approved else APPROVAL\n  update docs[doc] {{workflow:{workflow},outcome:'released',resolution:'released'}}\nmutation bypass(doc: docs):\n  update docs[doc] {{outcome:'released',resolution:'released'}}\n");let(s,b)=bound(&source);let cs=security::derived::invariants(&s,&b);for column in ["outcome","resolution"]{assert!(cs.iter().any(|i|i.column.as_deref()==Some(column)&&i.site.file.contains("sibling-approval")&&i.predicate.contains("approved")),"{workflow}: {column}: {cs:?}");}}
}

#[test]fn null_is_a_real_prior_state_for_optional_categorical_effects(){
 let source="table approvals:\n  principal: principal\n  approved: bool default false\n  unique principal\n  read <- allow\n  online only\ntable docs:\n  outcome: enum('released') ?\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create():\n  return insert docs {}\nmutation guarded(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.outcome = null else RELEASED\n  require exists approvals[principal = viewer, approved = true] else APPROVAL\n  update docs[doc] {outcome:'released'}\nmutation bypass(doc: docs):\n  update docs[doc] {outcome:'released'}\n";
 let(s,b)=bound(source);assert!(security::derived::invariants(&s,&b).iter().any(|i|i.column.as_deref()==Some("outcome")&&i.site.file.contains("sibling-approval")));let c=campaign(source);assert!(c.violations.iter().any(|v|v.operation=="bypass"&&v.reachability.is_reachable()),"{c:?}");
}

#[test]fn parallel_effect_projection_keeps_the_other_workflow_policy(){
 let source="table docs:\n  workflow: enum('draft','ready','done') default 'draft'\n  outcome: enum('pending','released') default 'pending'\n  approved: bool default false\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create():\n  return insert docs {}\nmutation prepare(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.workflow = 'draft' else STAGE\n  update docs[doc] {workflow:'ready'}\nmutation release(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.workflow = 'ready' or d.approved else APPROVAL\n  update docs[doc] {workflow:'done',outcome:'released'}\nmutation bypass(doc: docs):\n  update docs[doc] {outcome:'released'}\n";
 let(s,b)=bound(source);let cs=security::derived::invariants(&s,&b);assert!(cs.iter().any(|i|i.column.as_deref()==Some("outcome")&&i.site.file.contains("sibling-approval")&&i.predicate.contains("workflow")),"{cs:?}");let c=campaign(source);assert!(c.violations.iter().any(|v|v.operation=="bypass"&&v.reachability.is_reachable()),"{c:?}");assert!(!c.violations.iter().any(|v|v.operation=="release"&&v.reachability.is_reachable()),"{c:?}");
}

#[test]fn enum_self_assignments_are_informational_approval_records(){
 for (args,guard,value) in [("","d.workflow = 'ready'","'ready'"),("","(d.workflow != 'done') = true","'ready'"),(",workflow: enum('ready','done')","workflow = d.workflow","workflow")]{let source=format!("table docs:\n  workflow: enum('ready','done') default 'ready'\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {{approved:true}}\nmutation keep(doc: docs{args}):\n  d = docs[doc] ! else MISSING\n  require {guard} else STAGE\n  update docs[doc] {{workflow:{value}}}\n");for source in [source.clone(),source.replace("approved","readyApproved").replace("mutation keep(","mutation performReady(")]{let ns=notes(&source);assert!(!ns.iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{ns:?}");assert!(ns.iter().any(|n|n.code=="N_APPROVAL_INFORMATIONAL"),"{ns:?}");}}
}

#[test]fn finite_enum_and_local_destinations_do_not_freeze_workflow_admission(){
 for kind in ["enum('booked','prepped','tinted') default 'booked'","text <=30 default 'booked'"]{for (binding,value) in [("","to"),("  nextState = to\n","nextState"),("  nextState = 'prepped' if d.workflow = 'booked' else 'tinted'\n","nextState")]{
  let source=format!("table docs:\n  workflow: {kind}\n  material: enum('steel','wood') default 'steel'\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.workflow = 'booked' or d.workflow = 'prepped' else STAGE\n  require d.material = 'steel' else MATERIAL\n  update docs[doc] {{approved:true}}\nmutation advance(doc: docs,to: enum('prepped','tinted')):\n  d = docs[doc] ! else MISSING\n  if to = 'prepped':\n    require d.workflow = 'booked' else STAGE\n  else:\n    require d.workflow = 'prepped' else STAGE\n    require d.approved else APPROVAL\n{binding}  update docs[doc] {{workflow:{value}}}\n");
  let(s,b)=bound(&source);let cs=security::derived::invariants(&s,&b);
  assert!(!cs.iter().any(|i|i.column.as_deref()==Some("workflow")&&i.predicate.contains("old.approved")),"{kind} {value}: {cs:?}");
  assert!(cs.iter().any(|i|i.column.as_deref()==Some("material")&&i.predicate.contains("old.approved")),"actual inspected data remains protected: {cs:?}");
 }}
}

#[test]fn clearing_text_is_not_a_nonempty_workflow_destination(){
 let source="table docs:\n  material: text <=30 default 'steel'\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.material = 'steel' or d.material = 'wood' else MATERIAL\n  update docs[doc] {approved:true}\nmutation clear(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.material = 'steel' or d.material = 'wood' else MATERIAL\n  update docs[doc] {material:''}\n";
 let(s,b)=bound(source);let cs=security::derived::invariants(&s,&b);assert!(cs.iter().any(|i|i.column.as_deref()==Some("material")&&i.predicate.contains("old.approved")),"empty destination must retain inspected data: {cs:?}");
}

#[test]
fn clearance_descriptions_are_not_child_lifecycle_stages() {
    let original=include_str!("security/sec10-controls/w19-045.q");
    for name in ["clearance", "benchStatus", "stage"] {
        let source=original.replace("clearance",name);
        let sources=vec![("schema.q".into(),source)];
        let bound=snapback4_lang::compile(&sources);
        assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
        let stages=security::derived::workflow_columns_from_sources(&sources,&bound);
        assert!(!stages.contains(&("papers".into(),name.into())),"{stages:?}");
        let contracts=security::derived::invariants(&sources,&bound);
        assert!(!contracts.iter().any(|i| i.table=="papers" && i.site.file.contains("/parent-state/")),"{contracts:?}");
    }
}

#[test]
fn shipping_label_setters_do_not_create_enduring_equation_refusals() {
 for source in [include_str!("security/sec10-shipping/w29-001.q"),include_str!("security/sec10-shipping/w29-013.q"),include_str!("security/sec10-shipping/w29-041.q")] {
  let(s,b)=bound(source);let augmented=security::derived::augmented(&s,&b);
  assert!(!augmented.invariants.iter().any(security::derived::advisory));
  assert!(security::derived::notes(&s,&augmented).iter().any(|n|n.site.file.contains("/label-consistency/")&&n.rewrite.contains("advice only")));
 }
}
#[test]
fn shipping_branch_scoped_stage_exclusions_never_freeze_the_workflow() {
 let(s,b)=bound(include_str!("security/sec10-shipping/w30-028.q"));
 let stages=security::derived::workflow_columns_from_sources(&s,&b);assert!(stages.contains(&("projects".into(),"stage".into())),"{stages:?}");
 let candidates=security::derived::invariants(&s,&b);
 assert!(!candidates.iter().any(|i|i.table=="projects"&&i.column.as_deref()==Some("stage")&&i.predicate.contains("approvedAt")),"{candidates:?}");
}
#[test]
fn a_typed_approval_consumer_cannot_be_labeled_an_external_act() {
 for source in [include_str!("security/sec10-shipping/w30-018.q"),include_str!("security/sec10-shipping/w30-025.q")] {
  let(s,b)=bound(source);let mut report=security::analyze_rules(&b);security::add_source_notes(&mut report,&s,&b);
  assert!(!report.notes.iter().any(|n|n.code=="N_APPROVAL_INFORMATIONAL"&&n.message.starts_with("approvals.")),"{:?}",report.notes);
 }
}

#[test]
fn shipping_three_image_creator_reaches_its_money_threshold() {
 let source=format!("{}\ninvariant intakeAlbums.insert only exists roles[viewer, role = 'intake_manager']\n",include_str!("security/sec10-shipping/w29-016.q"));let(s,b)=bound(&source);
 let mut out=security::challenges::Campaign::work_bounded(8192);security::challenges::generated_campaign(&b,&mut out,false);
 assert!(out.violations.iter().any(|v|v.operation=="logTractor"&&v.effect=="insert"&&v.reachability.is_reachable()&&!v.history.is_empty()),"operations={:?}; unsupported={:?}",out.operations,out.unsupported);
}

#[test]
fn projected_edit_guards_do_not_reintroduce_advisory_creation_refusals() {
 let source="table docs:\n  cell:text ?\n  read <- allow\n  insert <- allow\n  update(old,next) <- old.cell = next.cell or viewer = 'service:editor'\n  online only\nmutation create(cell:text ?):\n  return insert docs {cell}\n";
 let(s,b)=bound(source);let candidates=security::derived::invariants(&s,&b);assert!(candidates.iter().any(security::derived::advisory));let augmented=security::derived::augmented(&s,&b);assert!(!augmented.invariants.iter().any(|i|security::derived::is_derived(i)));
 assert!(security::derived::notes(&s,&b).iter().any(|n|n.rewrite.contains("advice only")));
}
