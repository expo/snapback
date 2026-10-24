//! Wave-26 shapes, authored independently of the lane sources.
use snapback4_lang::{compile,security::{self,challenges::{self,Campaign}}};
fn campaign(source:&str)->Campaign {
    let sources=vec![("schema.q".into(),source.into())];let bound=compile(&sources);
    assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let bound=security::derived::augmented(&sources,&bound);let mut out=Campaign::default();
    challenges::generated_campaign(&bound,&mut out,false);out
}
const APPROVAL:&str="table treatments:\n  approvalReason: text <=80 ?\n  inpaintApproved: bool default false\n  read <- allow\n  insert <- viewer = 'service:registrar'\n  update <- allow\n  online only\nmutation intakePainting():\n  return insert treatments {}\ninvariant treatments.approvalReason write only viewer = 'service:director'\ninvariant treatments.inpaintApproved write only viewer = 'service:director'\n";
#[test]fn absent_reason_and_unapproved_default_are_not_approval_writes(){
    let c=campaign(APPROVAL);assert!(c.operations.get("intakePainting").is_some_and(|n|*n>0));
    assert!(c.violations.iter().all(|v|!v.reachability.is_reachable()),"{c:?}");
}
#[test]fn nonnull_approval_creation_and_approval_edits_still_refute(){
    for source in [
        APPROVAL.replace("insert treatments {}","insert treatments {approvalReason:'approved'}"),
        APPROVAL.replace("insert treatments {}","insert treatments {inpaintApproved:true}"),
        format!("{APPROVAL}mutation badApprove(treatment: treatments):\n  update treatments[treatment] {{inpaintApproved:true}}\n"),
        format!("{APPROVAL}mutation badReason(treatment: treatments):\n  update treatments[treatment] {{approvalReason:'changed'}}\n"),
        APPROVAL.replace("default false","default true"),
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
    let sources=vec![("schema.q".into(),source.into())];let bound=compile(&sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let inferred=security::derived::invariants(&sources,&bound);
    assert!(!inferred.iter().any(|i|matches!(i.column.as_deref(),Some("readyAt"|"stage"))),"{inferred:?}");
    assert!(inferred.iter().any(|i|i.column.as_deref()==Some("consent")),"actual non-null evidence stays inspected");
    let c=campaign(source);assert!(c.operations.get("advanceStage").is_some_and(|n|*n>0));assert!(!c.violations.iter().any(|v|v.reachability.is_reachable()),"{c:?}");
}

#[test]fn structural_write_audiences_still_judge_nonnull_defaults(){
    let source=APPROVAL.replace("inpaintApproved: bool default false","inpaintApproved: bool default false write <- viewer = 'service:director'");
    let b=compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let mut engine=snapback4_core::Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let result=engine.mutate("intakePainting",None,snapback4_core::Context::new("service:registrar",Default::default()).at(challenges::NOW)).unwrap();
    assert!(matches!(result.state,snapback4_core::WriteState::Failed{..}),"structural audiences still count defaults: {result:?}");
}
