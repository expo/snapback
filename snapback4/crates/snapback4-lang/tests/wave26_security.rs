//! Wave-26 shapes, authored independently of the lane sources.
use snapback4_lang::{compile,security::{self,challenges::{self,Campaign}}};
fn campaign(source:&str)->Campaign {
    let sources=vec![("schema.q".into(),source.into())];let bound=compile(&sources);
    assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let bound=security::derived::augmented(&sources,&bound);let mut out=Campaign::default();
    challenges::generated_campaign(&bound,&mut out,false);out
}
const APPROVAL:&str="table treatments:\n  approvalReason: text <=80 ?\n  inpaintApproved: bool default false\n  read <- allow\n  insert <- viewer = 'service:registrar'\n  update <- allow\n  online only\nmutation intakePainting():\n  return insert treatments {}\ninvariant treatments.approvalReason write only viewer = 'service:director'\ninvariant treatments.inpaintApproved write only viewer = 'service:director'\n";
#[test]fn absent_reason_and_literal_defaults_are_initialization_not_approval_writes(){
    for source in [APPROVAL.to_owned(),
        APPROVAL.replace("insert treatments {}","insert treatments {inpaintApproved:false}"),
        APPROVAL.replace("default false","default true"),
        APPROVAL.replace("default false","default true").replace("insert treatments {}","insert treatments {inpaintApproved:true}")] {
        let c=campaign(&source);assert!(c.operations.get("intakePainting").is_some_and(|n|*n>0));
        assert!(c.violations.iter().all(|v|!v.reachability.is_reachable()),"{source}\n{c:?}");
    }
}
#[test]fn nondefault_approval_creation_and_approval_edits_still_refute(){
    for source in [
        APPROVAL.replace("insert treatments {}","insert treatments {approvalReason:'approved'}"),
        APPROVAL.replace("insert treatments {}","insert treatments {inpaintApproved:true}"),
        APPROVAL.replace("default false","default true").replace("insert treatments {}","insert treatments {inpaintApproved:false}"),
        format!("{APPROVAL}mutation badApprove(treatment: treatments):\n  update treatments[treatment] {{inpaintApproved:true}}\n"),
        format!("{APPROVAL}mutation badReason(treatment: treatments):\n  update treatments[treatment] {{approvalReason:'changed'}}\n"),
    ] {let c=campaign(&source);assert!(c.violations.iter().any(|v|v.reachability.is_reachable()),"{source}\n{c:?}");}
}
const ROSTER:&str="table roles:\n  principal: principal\n  role: enum('member','director')\n  unique principal\n  immutable principal\n  read <- .principal = viewer or viewer = 'service:operator'\n  insert <- viewer = 'service:operator'\n  update <- viewer = 'service:operator'\n  online only\nmutation provision(principal: principal, role: enum('member','director')):\n  require viewer = 'service:operator' else NOT_OPERATOR\n  return upsert roles[principal] {principal,role}\nquery mine():\n  return roles[viewer]\ninvariant roles.read only .principal = viewer\n";
#[test]fn operator_provisioning_own_result_is_outside_authored_roster_read_intent(){
    let c=campaign(ROSTER);assert!(c.operations.get("provision").is_some_and(|n|*n>0));
    assert!(!c.violations.iter().any(|v|v.reachability.is_reachable()),"{c:?}");
}
#[test]fn operator_later_query_and_other_mutation_disclosures_are_still_checked(){
    for source in [format!("{ROSTER}query roster():\n  return roles first 10 by .id\n"),
        ROSTER.replace("mutation provision(","mutation ordinary(")]
    {let c=campaign(&source);assert!(c.violations.iter().any(|v|v.reachability.is_reachable()),"{c:?}");}
}
#[test]fn approval_null_and_stage_preconditions_are_not_frozen_evidence(){
    let source="table machines:\n  readyAt: time ?\n  boilerApprovedAt: time ?\n  consent: text ?\n  stage: text\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation add():\n  return insert machines {stage:'pressure-test',consent:'signed'}\nmutation approveBoiler(machine: machines):\n  m = machines[machine] ! else NOT_FOUND\n  require m.readyAt = null and m.stage != 'returned' else WRONG_STAGE\n  require m.consent != null else NO_CONSENT\n  update machines[machine] {boilerApprovedAt:now}\nmutation advanceStage(machine: machines):\n  m = machines[machine] ! else NOT_FOUND\n  require m.boilerApprovedAt != null else NOT_APPROVED\n  update machines[machine] {stage:'ready',readyAt:now}\n";
    for column in ["stage","workflowMarker"]{let source=source.replace("stage",column);
    let sources=vec![("schema.q".into(),source.clone())];let bound=compile(&sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let inferred=security::derived::invariants(&sources,&bound);
    // Stage is an effect destination in the new sibling contract, not an
    // inspected input frozen by approval invalidation.
    assert!(!inferred.iter().filter(|i|i.policy.is_some()).any(|i|i.column.as_deref().is_some_and(|name|name=="readyAt"||name==column)),"{inferred:?}");
    assert!(inferred.iter().any(|i|i.site.file.starts_with("$derived/sibling-approval/")&&i.column.as_deref()==Some(column)),"the approval still governs entry to ready");
    assert!(inferred.iter().any(|i|i.column.as_deref()==Some("consent")),"actual non-null evidence stays inspected");
    let c=campaign(&source);assert!(c.operations.get("advanceStage").is_some_and(|n|*n>0));assert!(!c.violations.iter().any(|v|v.reachability.is_reachable()),"{c:?}");
}
}

#[test]fn structural_write_audiences_allow_only_default_initialization(){
    for (default,other) in [("false","true"),("true","false")] {
        for value in [None,Some(default),Some(other)] {
            let source=APPROVAL.replace("inpaintApproved: bool default false",&format!("inpaintApproved: bool default {default} write <- viewer = 'service:director'"));
            let insertion=value.map_or_else(||"insert treatments {}".to_owned(),|v|format!("insert treatments {{inpaintApproved:{v}}}"));
            let source=source.replace("insert treatments {}",&insertion);
            let b=compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
            let mut engine=snapback4_core::Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
            let result=engine.mutate("intakePainting",None,snapback4_core::Context::new("service:registrar",Default::default()).at(challenges::NOW)).unwrap();
            assert_eq!(matches!(result.state,snapback4_core::WriteState::Sent{..}),value.is_none_or(|v|v==default),"default={default}, supplied={value:?}: {result:?}");
        }
    }
}

#[test]fn provision_preimage_and_mixed_before_after_results_are_not_exempt(){
    for returned in ["previous","{before:previous,after:current}"] {
        let body=format!("previous = roles[principal] ! else NOT_FOUND\n  current = upsert roles[principal] {{principal,role}}\n  return {returned}");
        let source=ROSTER.replace("return upsert roles[principal] {principal,role}",&body);
        let b=compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut fixture=snapback4_core::Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
        use snapback4_core::Value;
        let row=Value::Row(std::collections::BTreeMap::from([("id".into(),Value::Id("role-a".into())),("principal".into(),Value::Id("dev:security-a".into())),("role".into(),Value::String("member".into()))]).into());
        fixture.seed_at([("roles".into(),row)],challenges::NOW).unwrap();
        let mut c=Campaign::default();challenges::operations(&b,&fixture,&mut c);
        assert!(c.violations.iter().any(|v|v.operation=="provision"&&v.effect=="mutation result"&&v.viewer=="service:operator"),"{returned}: {c:?}");
    }
}
#[test]fn negated_absence_keeps_positive_evidence_and_double_negation_keeps_absence(){
    for (condition,expected) in [("not (m.consent = null)",true),("m.consent != null",true),("not (m.consent != null)",false),("not not (m.consent = null)",false),("(null if m.consent != null else 'missing') = null",true)] {
        let source=format!("table docs:\n  consent: text ?\n  approved: bool default false\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  m = docs[doc] ! else NOT_FOUND\n  require {condition} else NO_CONSENT\n  update docs[doc] {{approved:true}}\nmutation edit(doc: docs,consent: text ?):\n  update docs[doc] {{consent}}\n");
        let sources=vec![("schema.q".into(),source)];let b=compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        assert_eq!(security::derived::invariants(&sources,&b).iter().any(|i|i.column.as_deref()==Some("consent")),expected,"{condition}");
    }
}

#[test]fn nullable_column_write_intent_does_not_invent_creation_presence(){
    let source="table docs:\n  photo: image <=10000 ?\n  read <- allow\n  insert <- allow\n  online only\nmutation create(photo: image <=10000 ?):\n  return insert docs {photo}\n";
    for (intent,required) in [("invariant docs.photo write only .photo != null",false),("invariant docs.insert only .photo != null",true),("invariant docs always .photo != null",true),("invariant docs.write only .photo != null",true)] {
        let sources=vec![("schema.q".into(),format!("{source}{intent}\n"))];let b=compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let mut report=security::analyze_rules(&b);security::add_source_notes(&mut report,&sources,&b);
        assert_eq!(report.notes.iter().any(|n|n.code=="N_OPTIONAL_UPLOAD_CREATE"),required,"{intent}: {:?}",report.notes);
    }
}
