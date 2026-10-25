//! Approval inference controls and replay of the calibrated wave-26 shapes.
use snapback4_lang::{compile,security::{self,challenges::{self,Campaign}}};
fn sources(s:&str)->Vec<(String,String)>{vec![("schema.q".into(),s.into())]}
fn bound(s:&str)->snapback4_lang::Bound{let b=compile(&sources(s));assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b}
fn notes(s:&str)->Vec<snapback4_lang::Diagnostic>{let b=bound(s);let mut r=security::analyze_rules(&b);security::add_source_notes(&mut r,&sources(s),&b);r.notes.extend(b.notes);r.notes}
fn campaign(s:&str)->Campaign{let b=security::derived::augmented(&sources(s),&bound(s));let _=security::analyze_rules(&b);let mut c=Campaign::work_bounded(8192);challenges::generated_campaign(&b,&mut c,false);c}
#[test]fn ignored_flags_times_and_separate_approval_records_are_review_gates(){
    for source in [include_str!("security/wave26/020.q"),include_str!("security/wave26/036.q"),include_str!("security/wave26/046.q")]{
        let ns=notes(source);assert!(ns.iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{ns:?}");
    }
    assert!(security::gated_note("N_APPROVAL_NOT_ENFORCED"));
    let s="table docs:\n  approvedAt: time ?\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {approvedAt:now}\nmutation finish(doc: docs):\n  d = docs[doc] ! else NOT_FOUND\n  require d.approvedAt != null else NO_APPROVAL\n  update docs[doc] {status:'done'}\n";
    assert!(!notes(s).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}
#[test]fn sibling_approval_contracts_cover_reference_descendants(){
    let s=include_str!("security/wave26/018.q");let b=bound(s);let candidates=security::derived::invariants(&sources(s),&b);
    assert!(candidates.iter().any(|i|i.table=="rescans"&&i.target=="insert"&&i.predicate.contains("approvals")),"{candidates:?}");
    let c=campaign(s);assert!(c.violations.iter().any(|v|v.reachability.is_reachable()&&v.operation=="addRescan"&&v.invariant_site.contains("sibling-approval")),"{}",format!("operations={:?}, violations={:?}, gaps={:?}",c.operations,c.violations.iter().map(|v|(&v.operation,&v.invariant_site)).collect::<Vec<_>>(),c.unsupported));
}
#[test]fn bool_approval_input_edits_are_replayed(){
    let s=include_str!("security/wave26/033.q");let b=bound(s);let candidates=security::derived::invariants(&sources(s),&b);
    assert!(candidates.iter().any(|i|i.column.as_deref()==Some("customerConsent")),"{candidates:?}");
    let c=campaign(s);assert!(c.violations.iter().any(|v|v.reachability.is_reachable()&&v.operation=="signFailing"),"{}",format!("operations={:?}, violations={:?}, gaps={:?}",c.operations,c.violations.iter().map(|v|(&v.operation,&v.invariant_site)).collect::<Vec<_>>(),c.unsupported));
}
#[test]fn parent_child_and_repeat_create_candidates_replay(){
    for (source,labels) in [(include_str!("security/wave26/008.q"),vec!["parent-state","child-stage"]),(include_str!("security/wave26/025.q"),vec!["repeat-create","approval-history"]) ]{
        let b=bound(source);let candidates=security::derived::invariants(&sources(source),&b);
        for label in &labels{assert!(candidates.iter().any(|i|i.site.file.contains(label)),"missing {label}: {candidates:?}");}
        let c=campaign(source);for label in labels.into_iter().filter(|label|*label!="approval-history"){assert!(c.violations.iter().any(|v|v.reachability.is_reachable()&&v.invariant_site.contains(label)),"missing {label}: {}",format!("operations={:?}, violations={:?}, gaps={:?}",c.operations,c.violations.iter().map(|v|(&v.operation,&v.invariant_site)).collect::<Vec<_>>(),c.unsupported));}
    }
}
#[test]fn text_evidence_month_math_private_media_and_global_unique_questions(){
    for (source,code) in [(include_str!("security/wave26/024.q"),"N_TEXT_EVIDENCE"),(include_str!("security/wave26/002.q"),"N_CALENDAR_DURATION"),(include_str!("security/wave26/049.q"),"N_MEDIA_PRIVATE_FIELDS"),(include_str!("security/wave26/034.q"),"N_UNIQUE_HIDDEN"),(include_str!("security/wave26/024.q"),"N_CALLER_TIME")]{assert!(notes(source).iter().any(|n|n.code==code),"missing {code}");}
}
#[test]fn whitespace_assessment_guard_has_an_exact_repair(){
    let s=include_str!("security/wave26/045.q");assert!(notes(s).iter().any(|n|n.code=="N_BLANK_TEXT_GUARD"));
    let fixed=s.replace("assessment != ''","trim(assessment) != ''");assert!(!notes(&fixed).iter().any(|n|n.code=="N_BLANK_TEXT_GUARD"));
}
#[test]fn a_nested_trim_does_not_validate_an_untrimmed_selected_reason(){
    let source="table docs:\n  reason: text ?\n  read <- allow\n  update <- allow\n  online only\nmutation decide(doc: docs,reason: text ?,fallback: text):\n  require (reason ?? trim(fallback)) != '' else EMPTY\n  update docs[doc] {reason}\n";
    assert!(notes(source).iter().any(|n|n.code=="N_BLANK_TEXT_GUARD"));
    assert!(!notes(&source.replace("(reason ?? trim(fallback)) != ''","trim(reason ?? fallback) != ''")).iter().any(|n|n.code=="N_BLANK_TEXT_GUARD"));
}
#[test]fn dominating_nonblank_validation_and_positive_empty_tests_do_not_gate(){
    let template="table docs:\n  reason: text ?\n  read <- allow\n  update <- allow\n  online only\nmutation decide(doc: docs,reason: text <=30):\n  REQUIRE\n  update docs[doc] {reason}\n";
    for guard in ["require reason != '' and trim(reason) != '' else EMPTY","require reason != '' else EMPTY\n  require trim(reason) != '' else BLANK","require reason = '' else EXPECT_EMPTY","require not (reason != '') else EXPECT_EMPTY","require reason != '' and count(trim(reason)) > 0 else EMPTY","require reason != '' and not (count(trim(reason)) = 0) else EMPTY"]{
        assert!(!notes(&template.replace("REQUIRE",guard)).iter().any(|n|n.code=="N_BLANK_TEXT_GUARD"),"{guard}");
    }
    let row_enforced=template.replace("reason: text ?","reason: text 1..30 ?").replace("REQUIRE","require reason != '' else EMPTY");
    assert!(!notes(&row_enforced).iter().any(|n|n.code=="N_BLANK_TEXT_GUARD"));
    assert!(notes(&template.replace("REQUIRE","require not (reason = '') else EMPTY")).iter().any(|n|n.code=="N_BLANK_TEXT_GUARD"));
}
#[test]fn atomic_approval_audits_and_checked_stage_proxies_do_not_gate(){
    assert!(!notes(include_str!("security/wave26/008.q")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{:?}",notes(include_str!("security/wave26/008.q")));
    let source="table docs:\n  approvedAt: time ?\n  status: enum('draft','approved','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {approvedAt:now,status:'approved'}\nmutation finish(doc: docs):\n  d = docs[doc] ! else NOT_FOUND\n  require d.status = 'approved' else NO_APPROVAL\n  update docs[doc] {status:'done'}\n";
    assert!(!notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    assert!(!notes(&source.replace("approvedAt:now","approvedAt:now + 0ms").replace("  require d.status = 'approved' else NO_APPROVAL\n","")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}
#[test]fn consuming_approval_and_later_edits_are_not_a_sibling_bypass(){
    let source="table docs:\n  approved: bool default false\n  status: enum('draft','done') default 'draft'\n  note: text ?\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create():\n  return insert docs {approved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else NOT_FOUND\n  require d.approved else NO_APPROVAL\n  update docs[doc] {status:'done',approved:false}\nmutation edit(doc: docs):\n  d = docs[doc] ! else NOT_FOUND\n  require d.status = 'done' else BAD_STAGE\n  update docs[doc] {status:'done',note:'updated'}\n";
    let c=campaign(source);assert!(!c.violations.iter().any(|v|v.invariant_site.contains("sibling-approval")),"{c:?}");
    let bypass=format!("{}mutation bypass(doc: docs):\n  update docs[doc] {{status:'done'}}\n",source.replace("approved:true","approved:false"));
    assert!(campaign(&bypass).violations.iter().any(|v|v.reachability.is_reachable()&&v.operation=="bypass"));
}
#[test]fn approval_id_operands_keep_id_lookup_in_derived_contracts(){
    let source="table jobs:\n  read <- allow\n  online only\ntable approvals:\n  job: jobs\n  unique job\n  read <- allow\n  online only\ntable effects:\n  approval: approvals\n  read <- allow\n  insert <- allow\n  online only\nmutation create(approval: approvals):\n  require exists approvals[approval] else NO_APPROVAL\n  return insert effects {approval}\n";
    let b=bound(source);let cs=security::derived::invariants(&sources(source),&b);
    assert!(cs.iter().any(|i|i.site.file.contains("sibling-approval")),"{cs:?}");
    assert!(cs.iter().filter(|i|i.site.file.contains("sibling-approval")).all(|i|!i.predicate.contains("job =")),"{cs:?}");
}
#[test]fn work_budget_is_independent_of_elapsed_time(){
    let mut c=Campaign::work_bounded(512);assert!(c.deadline.is_none());
    let source=include_str!("security/wave20/050.q");let b=bound(source);
    std::thread::sleep(std::time::Duration::from_millis(2));let a=security::analyze_with_campaign(&b,&mut c);
    let mut d=Campaign::work_bounded(512);let b=security::analyze_with_campaign(&b,&mut d);
    assert_eq!(a.invariants.iter().map(|v|v.status.clone()).collect::<Vec<_>>(),b.invariants.iter().map(|v|v.status.clone()).collect::<Vec<_>>());
    assert_eq!(c.work_remaining,d.work_remaining);
}
#[test]fn every_multi_target_arm_uses_executed_write_tracing(){
    let source="table docs:\n  approved: bool default false\n  stage: enum('draft','first','done') default 'draft'\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation advance(doc: docs,next: enum('first','done')):\n  if next = 'first':\n    update docs[doc] {stage:'first'}\n  else:\n    update docs[doc] {stage:'done'}\ninvariant docs.advance only .approved = true\n";
    let b=bound(source);let c=challenges::run_selected_after(&b,None,Campaign::work_bounded(512));
    assert!(!c.unsupported.iter().any(|s|s.contains("multiple target writes")));
    assert!(c.violations.iter().any(|v|v.operation=="advance"&&v.rule_path.contains("executed write boundary")),"{c:?}");
}

#[test]fn quoted_terminal_states_are_constructed_without_reparsing_literals(){
    let source=include_str!("security/wave26/008.q").replace("'finish'","'fin\\'ish'").replace("'finished'","'fin\\'ished'");
    let b=bound(&source);let cs=security::derived::invariants(&sources(&source),&b);
    assert!(cs.iter().any(|i|i.site.file.contains("child-stage")&&i.predicate.contains("ish")),"{cs:?}");
}

#[test]fn approval_absence_and_atomic_lifecycle_records_do_not_create_prerequisites(){
    let source="table docs:\n  approved: bool default false\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\ntable events:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else NOT_FOUND\n  require not d.approved else ALREADY_APPROVED\n  update docs[doc] {approved:true}\n  return insert events {doc}\n";
    let cs=security::derived::invariants(&sources(source),&bound(source));
    assert!(!cs.iter().any(|i|i.site.file.contains("sibling-approval")),"{cs:?}");
    let positive=source.replace("not d.approved","d.approved");
    assert!(security::derived::invariants(&sources(&positive),&bound(&positive)).iter().any(|i|i.site.file.contains("sibling-approval")));
}
#[test]fn aliased_loop_updates_do_not_panic_workflow_inference(){
    let source="table docs:\n  stage: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation migrate():\n  for d in docs first 10 by .id:\n    update d {stage:'done'}\n";
    let b=bound(source);let _=security::derived::invariants(&sources(source),&b);let _=security::derived::augmented(&sources(source),&b);
}

#[test]fn enum_and_principal_approval_inputs_derive_invalidation_contracts(){
    let source="table docs:\n  consent: enum('yes','no')\n  party: principal\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else NOT_FOUND\n  require d.consent = 'yes' else NO_CONSENT\n  require d.party = viewer else WRONG_PARTY\n  update docs[doc] {approved:true}\nmutation edit(doc: docs,consent: enum('yes','no'),party: principal):\n  update docs[doc] {consent,party}\n";
    let cs=security::derived::invariants(&sources(source),&bound(source));
    for column in ["consent","party"]{assert!(cs.iter().any(|i|i.column.as_deref()==Some(column)&&i.target=="update"),"{cs:?}");}
}

#[test]fn checked_helper_result_and_atomic_decision_tokens_consume_timestamp_approval(){
    let source="table docs:\n  approvedBy: principal ?\n  approvedAt: time ?\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nfn current(doc: docs):\n  return docs[doc] ! else NOT_FOUND\nmutation approve(doc: docs):\n  update docs[doc] {approvedBy:viewer,approvedAt:now}\nmutation finish(doc: docs):\n  d = current(doc)\n  require d.approvedBy != null else NO_APPROVAL\n  update docs[doc] {status:'done'}\n";
    assert!(!notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    assert!(security::derived::invariants(&sources(source),&bound(source)).iter().any(|i|i.site.file.contains("sibling-approval")));
}

#[test]fn calendar_offsets_and_explicit_broad_media_audiences_still_ask_the_question(){
    let source="table docs:\n  owner: principal\n  date: time\n  note: text read <- .owner = viewer\n  drawing: text\n  photo: image <=10000 ? read <- allow\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation finish(doc: docs):\n  d = docs[doc] ! else NOT_FOUND\n  require month(now) <= month(d.date) + 12 else EXPIRED\n  update docs[doc] {status:'done'}\n";
    let ns=notes(source);for code in ["N_CALENDAR_DURATION","N_MEDIA_PRIVATE_FIELDS","N_TEXT_EVIDENCE"]{assert!(ns.iter().any(|n|n.code==code),"{code}: {ns:?}");}
    let private=source.replace("photo: image <=10000 ? read <- allow","photo: image <=10000 ? read <- .owner = viewer");
    assert!(!notes(&private).iter().any(|n|n.code=="N_MEDIA_PRIVATE_FIELDS"));
}

#[test]fn positive_audit_minimum_dominates_later_atomic_writes(){
    let source="table docs:\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\ntable audits:\n  reason: text 1..30\n  read <- allow\n  insert <- allow\n  online only\nmutation finish(doc: docs,reason: text <=30):\n  require reason != '' else EMPTY\n  insert audits {reason}\n  update docs[doc] {status:'done'}\n";
    assert!(!notes(source).iter().any(|n|n.code=="N_BLANK_TEXT_GUARD"));
    let conditional=source.replace("  insert audits {reason}","  if reason = 'audit':\n    insert audits {reason}");
    assert!(notes(&conditional).iter().any(|n|n.code=="N_BLANK_TEXT_GUARD"));
}
#[test]fn child_terminality_includes_handoffs_between_roles(){
    let source="table roles:\n  principal: principal\n  role: enum('crew','owner')\n  unique principal\n  read <- allow\n  online only\ntable jobs:\n  stage: enum('open','active','done') default 'open'\n  read <- allow\n  update <- allow\n  online only\ntable tasks:\n  job: jobs\n  stage: enum('raw','handoff','finish') default 'raw'\n  read <- allow\n  update <- allow\n  online only\nmutation start(job: jobs):\n  require exists roles[viewer,role='crew'] else DENIED\n  j = jobs[job] ! else MISSING\n  require j.stage = 'open' else BAD_STAGE\n  update jobs[job] {stage:'active'}\nmutation handoff(task: tasks):\n  require exists roles[viewer,role='crew'] else DENIED\n  t = tasks[task] ! else MISSING\n  require t.stage = 'raw' else BAD_STAGE\n  update tasks[task] {stage:'handoff'}\nmutation inspect(item: tasks):\n  require exists roles[viewer,role='owner'] else DENIED\n  t = tasks[item] ! else MISSING\n  require t.stage = 'handoff' else BAD_STAGE\n  update tasks[item] {stage:'finish'}\nmutation finish(resource: jobs):\n  require exists roles[viewer,role='crew'] else DENIED\n  j = jobs[resource] ! else MISSING\n  require j.stage = 'active' else BAD_STAGE\n  update jobs[resource] {stage:'done'}\n";
    let cs=security::derived::invariants(&sources(source),&bound(source));
    let terminals=cs.iter().filter(|i|i.site.file.contains("child-stage")).collect::<Vec<_>>();
    assert!(!terminals.is_empty(),"{cs:?}");assert!(terminals.iter().all(|i|i.predicate.contains("'finish'")&&!i.predicate.contains("'handoff'")),"{terminals:?}");
    let multi=source.replace("inspect(item: tasks)","inspect(reference: tasks,item: tasks)").replace("  t = tasks[item] ! else MISSING","  r = tasks[reference] ! else MISSING\n  require r.stage = 'finish' else BAD_REFERENCE\n  t = tasks[item] ! else MISSING");
    let cs=security::derived::invariants(&sources(&multi),&bound(&multi));
    let terminals=cs.iter().filter(|i|i.site.file.contains("child-stage")).collect::<Vec<_>>();
    assert!(!terminals.is_empty(),"{cs:?}");assert!(terminals.iter().all(|i|i.predicate.contains("'finish'")&&!i.predicate.contains("'handoff'")),"{terminals:?}");

}
#[test]fn child_creation_can_consume_the_same_resource_approval(){
    let source="table docs:\n  approved: bool default false\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation create():\n  return insert docs {approved:true}\nmutation consume(doc: docs):\n  d = docs[doc] ! else NOT_FOUND\n  require d.approved else NO_APPROVAL\n  update docs[doc] {approved:false}\n  return insert effects {doc}\n";
    let c=campaign(source);assert!(!c.violations.iter().any(|v|v.invariant_site.contains("sibling-approval")),"{c:?}");
    let bad=source.replace("approved:true","approved:false")+"mutation bypass(doc: docs):\n  return insert effects {doc}\n";
    assert!(campaign(&bad).violations.iter().any(|v|v.reachability.is_reachable()&&v.operation=="bypass"&&v.invariant_site.contains("sibling-approval")));
}

#[test]fn unrestricted_entry_is_not_a_consumed_approval_receipt(){
    let source="table docs:\n  restricted: bool default false\n  approved: bool default false\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation create():\n  return insert docs {}\nmutation guarded(doc: docs):\n  d = docs[doc] ! else NOT_FOUND\n  require not d.restricted or d.approved else NO_APPROVAL\n  return insert effects {doc}\nmutation bypass(doc: docs):\n  update docs[doc] {restricted:true}\n  return insert effects {doc}\n";
    assert!(campaign(source).violations.iter().any(|v|v.reachability.is_reachable()&&v.operation=="bypass"&&v.invariant_site.contains("sibling-approval")));
}
#[test]fn a_guard_on_a_different_resource_does_not_define_an_effect_contract(){
    let source="table docs:\n  approved: bool default false\n  read <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation create(guard: docs,subject: docs):\n  d = docs[guard] ! else NOT_FOUND\n  require d.approved else NO_APPROVAL\n  return insert effects {doc:subject}\n";
    assert!(!security::derived::invariants(&sources(source),&bound(source)).iter().any(|i|i.site.file.contains("sibling-approval")));
}

#[test]fn matching_applied_decisions_and_unlinked_boolean_records_are_distinguished(){
    for (field,kind,value,column) in [("depositKept","bool default false","true","approvedAt"),("quoteStatus","enum('pending','approved') default 'pending'","'approved'","approvedAt"),("wording","text <=30 ?","'new wording'","wordingApprovedAt"),("dyedColor","text <=30 ?","'blue'","dyeApprovedAt")]{
        let source=format!("table docs:\n  {column}: time ?\n  {field}: {kind}\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation decide(doc: docs):\n  update docs[doc] {{{column}:now,{field}:{value}}}\nmutation finish(doc: docs):\n  update docs[doc] {{status:'done'}}\n");
        assert_eq!(notes(&source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),field=="depositKept","{source}");
    }
    let applied="table docs:\n  approvedAt: time ?\n  depositKept: bool default false\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation keep(doc: docs):\n  d = docs[doc] ! else MISSING\n  require not d.depositKept else ALREADY_KEPT\n  update docs[doc] {approvedAt:now,depositKept:true}\nmutation finish(doc: docs):\n  update docs[doc] {status:'done'}\n";
    assert!(!notes(applied).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let source="table docs:\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable approvals:\n  doc: docs\n  read <- allow\n  insert <- viewer = 'service:manager'\n  online only\nmutation create():\n  require viewer = 'service:manager' else DENIED\n  d = insert docs {}\n  return insert approvals {doc:d.id}\nmutation finish(doc: docs):\n  update docs[doc] {status:'done'}\n";
    assert!(!notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}

#[test]fn secondary_reference_updates_do_not_rebind_a_predecessor_approval(){
    let source="table docs:\n  predecessor: docs ?\n  approved: bool default false\n  status: enum('draft','done') default 'draft'\n  unique predecessor\n  read <- allow\n  update <- allow\n  online only\nmutation finish(doc: docs):\n  d = docs[doc] ! else NOT_FOUND\n  require d.approved else NO_APPROVAL\n  update docs[predecessor = doc] {status:'done'}\n";
    assert!(!security::derived::invariants(&sources(source),&bound(source)).iter().any(|i|i.site.file.contains("sibling-approval")));
    let direct=source.replace("docs[predecessor = doc]","docs[doc]");
    assert!(security::derived::invariants(&sources(&direct),&bound(&direct)).iter().any(|i|i.site.file.contains("sibling-approval")));
}

#[test]fn insertion_and_default_approvals_still_need_consumption(){
    let source="table docs:\n  approvedAt: time ?\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create():\n  return insert docs {approvedAt:now,status:'draft'}\nmutation finish(doc: docs):\n  update docs[doc] {status:'done'}\n";
    assert!(notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let defaults=source.replace("approvedAt: time ?","approved: bool default true").replace("approvedAt:now,","");
    assert!(notes(&defaults).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let time_default=source.replace("approvedAt: time ?","approvedAt: time default now").replace("approvedAt:now,","");
    assert!(notes(&time_default).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let inspected=source.replace("  approvedAt: time ?","  value: text ?\n  approvedAt: time ?")+"mutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.value != null else NO_EVIDENCE\n  update docs[doc] {approvedAt:now + 0ms}\nmutation edit(doc: docs,value: text ?):\n  update docs[doc] {value}\n";
    assert!(security::derived::invariants(&sources(&inspected),&bound(&inspected)).iter().any(|i|i.column.as_deref()==Some("value")&&i.target=="update"));
}

#[test]fn approval_questions_include_child_effects_without_a_parent_status_enum(){
    let source="table docs:\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {approved:true}\nmutation create(doc: docs):\n  return insert effects {doc}\n";
    assert!(notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}

#[test]fn approval_records_of_an_already_guarded_effect_are_not_unused_gates(){
    let source="table docs:\n  approvedAt: time\n  status: enum('approved','done') default 'approved'\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create():\n  return insert docs {approvedAt:now}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.status = 'approved' else NO_APPROVAL\n  update docs[doc] {status:'done'}\n";
    assert!(!notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let source="table docs:\n  approved: bool default false\n  price: int default 1\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs,price: int):\n  update docs[doc] {price,approved:true}\nmutation finish(doc: docs):\n  update docs[doc] {status:'done'}\n";
    // This unused flag is an informational record of the already applied
    // price. S1 deliberately requires its individual informational disposition.
    assert!(notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let bypass=source.to_owned()+"mutation bypass(doc: docs,price: int):\n  update docs[doc] {price}\n";
    assert!(notes(&bypass).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}
#[test]fn approval_guards_inside_typed_loops_are_still_enforcement(){
    let source="table trips:\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\ntable bookings:\n  trip: trips\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\ntable waivers:\n  booking: bookings\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(booking: bookings):\n  update bookings[booking] {approved:true}\nmutation waiver(booking: bookings):\n  return insert waivers {booking}\nmutation finish(trip: trips):\n  for b in bookings first 10 by .id:\n    require b.approved else NO_APPROVAL\n  update trips[trip] {status:'done'}\n";
    assert!(!notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let bad=source.replace("    require b.approved else NO_APPROVAL","    require b.trip != null else NO_TRIP");
    assert!(notes(&bad).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}
#[test]fn approval_input_children_are_not_mistaken_for_later_effects(){
    let source="table docs:\n  approvedAt: time ?\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable consents:\n  doc: docs\n  unique doc\n  read <- allow\n  insert <- allow\n  online only\nmutation create():\n  d = insert docs {}\n  return insert consents {doc:d.id}\nmutation approve(doc: docs):\n  require exists consents[doc = doc] else MISSING_CONSENT\n  update docs[doc] {approvedAt:now}\n";
    assert!(!notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let effect=source.to_owned()+"table effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation work(doc: docs):\n  return insert effects {doc}\n";
    assert!(notes(&effect).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}

#[test]fn anchored_windows_and_owner_scoped_unique_keys_have_precise_controls(){
    let source="table windows:\n  startsAt: time\n  read <- allow\n  online only\ntable events:\n  window: windows\n  at: time\n  read <- allow\n  insert <- allow\n  online only\nmutation create(window: windows,at: time):\n  w = windows[window] ! else MISSING\n  require at <= w.startsAt + 1d else TOO_LATE\n  return insert events {window,at}\n";
    assert!(notes(source).iter().any(|n|n.code=="N_CALLER_TIME"&&n.message.contains("one side")));
    let bounded=source.replace("  require at <=","  require at >= w.startsAt else TOO_EARLY\n  require at <=");
    assert!(!notes(&bounded).iter().any(|n|n.code=="N_CALLER_TIME"&&n.message.contains("one side")));
    let source="table handles:\n  owner: principal\n  name: text <=100\n  unique name\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\n";
    assert!(notes(source).iter().any(|n|n.code=="N_UNIQUE_HIDDEN"&&n.message.contains("global unique")));
    assert!(!notes(&source.replace("unique name","unique owner,name")).iter().any(|n|n.code=="N_UNIQUE_HIDDEN"&&n.message.contains("global unique")));
}

#[test]fn absence_and_unrelated_child_reads_do_not_consume_parent_approval(){
    let source="table docs:\n  approvedAt: time ?\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  doc: docs\n  unique doc\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(doc: docs):\n  require not exists effects[doc = doc] else ALREADY_DONE\n  update docs[doc] {approvedAt:now}\nmutation work(doc: docs):\n  return insert effects {doc}\n";
    assert!(notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let unrelated=source.replace("approve(doc: docs)","approve(doc: docs,other: docs)").replace("not exists effects[doc = doc]","exists effects[doc = other]");
    assert!(notes(&unrelated).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}
#[test]fn approval_input_dependencies_are_on_the_actual_guarded_row(){
    let source="table parts:\n  value: text ?\n  read <- allow\n  online only\ntable docs:\n  part: parts\n  value: text ?\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  p = parts[d.part] ! else MISSING\n  require p.value != null else EMPTY\n  update docs[id = doc] {approved:true}\nmutation edit(doc: docs,value: text ?):\n  update docs[doc] {value}\n";
    let candidates=security::derived::invariants(&sources(source),&bound(source));
    assert!(!candidates.iter().any(|i|i.table=="docs"&&i.column.as_deref()==Some("value")),"{candidates:?}");
}

#[test]fn atomic_stage_ledgers_do_not_require_approval_for_every_event(){
    let source="table docs:\n  approved: bool default false\n  status: enum('draft','ready','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\ntable events:\n  doc: docs\n  action: text 1..30\n  read <- allow\n  insert <- allow\n  online only\nmutation verify(doc: docs):\n  update docs[doc] {status:'ready'}\n  insert events {doc,action:'verified'}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approved else NO_APPROVAL\n  update docs[doc] {status:'done'}\n  insert events {doc,action:'finished'}\n";
    let candidates=security::derived::invariants(&sources(source),&bound(source));
    assert!(candidates.iter().any(|i|i.table=="docs"&&i.site.file.contains("sibling-approval")),"{candidates:?}");
    assert!(!candidates.iter().any(|i|i.table=="events"&&i.site.file.contains("sibling-approval")),"{candidates:?}");
}
#[test]fn a_repeated_create_without_an_approval_cap_is_a_question(){
    let source="table tours:\n  state: enum('booked','cancelled') default 'booked'\n  prior: tours ?\n  read <- allow\n  insert <- allow\n  online only\nmutation rebook(tour: tours):\n  t = tours[tour] ! else MISSING\n  require t.state = 'cancelled' else NOT_CANCELLED\n  return insert tours {prior:tour}\n";
    assert!(notes(source).iter().any(|n|n.code=="N_GUARD_NOT_CONSUMED"));
    assert!(!security::derived::invariants(&sources(source),&bound(source)).iter().any(|i|i.site.file.contains("repeat-create")));
}
#[test]fn a_single_parent_close_toggle_does_not_establish_child_completion(){
    let source="table roles:\n  principal: principal\n  role: enum('commander')\n  unique principal\n  read <- allow\n  online only\ntable searches:\n  state: enum('open','closed') default 'open'\n  read <- allow\n  update <- allow\n  online only\ntable teams:\n  callout: searches\n  state: enum('active','stood_down') default 'active'\n  read <- allow\n  update <- allow\n  online only\nmutation close(callout: searches):\n  require exists roles[viewer,role='commander'] else DENIED\n  s = searches[callout] ! else MISSING\n  require s.state = 'open' else CLOSED\n  update searches[callout] {state:'closed'}\nmutation standDown(team: teams):\n  require exists roles[viewer,role='commander'] else DENIED\n  t = teams[team] ! else MISSING\n  require t.state = 'active' else CLOSED\n  update teams[team] {state:'stood_down'}\n";
    assert!(!security::derived::invariants(&sources(source),&bound(source)).iter().any(|i|i.site.file.contains("child-stage")));
    let noop=source.to_string()+"mutation noop(callout: searches):\n  s = searches[callout] ! else MISSING\n  require s.state = 'open' else CLOSED\n  update searches[callout] {state:'open'}\n";assert!(!security::derived::invariants(&sources(&noop),&bound(&noop)).iter().any(|i|i.site.file.contains("child-stage")));
}

#[test]fn child_schema_write_authority_consumes_the_matching_parent_approval(){
    let source="table docs:\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- .doc.approved = true\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {approved:true}\nmutation work(doc: docs):\n  return insert effects {doc}\n";
    assert!(!notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    assert!(notes(&source.replace("insert <- .doc.approved = true","insert <- allow")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}
#[test]fn a_secondary_key_is_not_the_approved_parent_identity(){
    let source="table docs:\n  predecessor: docs ?\n  approved: bool default false\n  unique predecessor\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  doc: docs\n  unique doc\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(prior: docs):\n  require exists effects[doc = prior] else MISSING\n  update docs[predecessor = prior] {approved:true}\nmutation work(doc: docs):\n  return insert effects {doc}\n";
    assert!(notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}

#[test]fn a_conditional_stage_write_cannot_hide_an_insert_contract(){
    let source="table docs:\n  approved: bool default false\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation finish(doc: docs,changeStage: bool):\n  d = docs[doc] ! else MISSING\n  require d.approved else NO_APPROVAL\n  if changeStage:\n    update docs[doc] {status:'done'}\n  return insert effects {doc}\n";
    assert!(security::derived::invariants(&sources(source),&bound(source)).iter().any(|i|i.table=="effects"&&i.site.file.contains("sibling-approval")));
    let in_loop=source.replace("if changeStage:","for x in docs:").replacen("  online only\n","  cap 10\n  online only\n",1);
    assert!(security::derived::invariants(&sources(&in_loop),&bound(&in_loop)).iter().any(|i|i.table=="effects"&&i.site.file.contains("sibling-approval")));
}

#[test]fn filtered_and_named_key_approval_guards_are_enforcement(){
    let source="table approvals:\n  subject: principal\n  unique subject\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\ntable effects:\n  approval: approvals\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(approval: approvals):\n  update approvals[approval] {approved:true}\nmutation work(approval: approvals):\n  require exists approvals[subject = viewer] where .approved else NO_APPROVAL\n  return insert effects {approval}\n";
    assert!(!notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    for renamed in [source.to_string(),source.replace("approvals","permissions")]{let cs=security::derived::invariants(&sources(&renamed),&bound(&renamed));assert!(cs.iter().any(|i|i.table=="effects"&&i.site.file.contains("sibling-approval")),"{cs:?}");}
    let keyed=source.replace("approvals[subject = viewer] where .approved","approvals[subject = viewer, approved = true]");
    assert!(!notes(&keyed).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let nested=source.replace("approvals[subject = viewer] where .approved","effects where (exists approvals[subject = viewer] where .approved)");
    assert!(!notes(&nested).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let unrelated=source.replace("table effects:\n  approval: approvals", "table effects:\n  approved: bool default false\n  approval: approvals").replace("exists approvals[subject = viewer] where .approved", "exists effects where .approved");
    assert!(notes(&unrelated).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}

#[test]fn caller_approval_contracts_do_not_need_a_resource_argument(){
    let source="table approvals:\n  principal: principal\n  unique principal\n  approved: bool default false\n  read <- allow\n  online only\ntable effects:\n  owner: principal\n  read <- allow\n  insert <- allow\n  online only\nmutation guarded():\n  require exists approvals[principal = viewer, approved = true] else NO_APPROVAL\n  return insert effects {owner:viewer}\nmutation bypass():\n  return insert effects {owner:viewer}\n";
    let cs=security::derived::invariants(&sources(source),&bound(source));assert!(cs.iter().any(|i|i.table=="effects"&&i.site.file.contains("sibling-approval")),"{cs:?}");
}

#[test]fn idempotent_terminal_writes_do_not_create_work_windows(){
    let mut source=include_str!("security/wave26/008.q").to_string();source.push_str("\nmutation touchFinished(job: jobs):\n  require exists roles[viewer,role='crew'] else NOT_CREW\n  j = jobs[job] ! else MISSING\n  require j.status = 'finished' else BAD_STAGE\n  update jobs[job] {status:'finished'}\n");
    let cs=security::derived::invariants(&sources(&source),&bound(&source));assert!(cs.iter().any(|i|i.site.file.contains("child-stage")),"{cs:?}");
    assert!(cs.iter().filter(|i|i.site.file.contains("parent-state")).all(|i|!i.predicate.contains("'finished'")),"{cs:?}");
}

#[test]fn approval_record_exemptions_belong_to_each_exact_creator(){
    let source="table roles:\n  principal: principal\n  role: enum('manager','staff')\n  unique principal\n  read <- allow\n  online only\ntable docs:\n  status: enum('draft','done','archived') default 'draft'\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable approvals:\n  doc: docs\n  cap 10\n  read <- allow\n  insert <- exists roles[principal = viewer, role = 'manager']\n  online only\nmutation finish(doc: docs):\n  update docs[doc] {status:'archived'}\nmutation record(doc: docs,other: docs,touch: bool):\n  require exists roles[principal = viewer,role = 'manager'] else DENIED\n  d = docs[doc] ! else MISSING\nBODY  return insert approvals {doc}\n";
    for (body,gated) in [
        ("",true),
        ("  if touch:\n    update docs[other] {status:'draft'}\n",true),
        ("  o = docs[other] ! else MISSING\n  require o.status = 'draft' else BAD_STAGE\n  update docs[other] {status:'done'}\n",true),
        ("  update docs[doc] {status:'done'}\n",false),
        ("  require d.status = 'done' else BAD_STAGE\n  update docs[d.id] {status:'done'}\n",true),
        ("  require d.status = 'draft' else BAD_STAGE\n  update docs[d.id] {status:'done'}\n",false),
    ]{
        let source=source.replace("BODY",body);assert_eq!(notes(&source).iter().any(|note|note.code=="N_APPROVAL_NOT_ENFORCED"),gated,"{body}");
        if !gated{let upsert=source.clone()+"mutation overwrite(doc: docs):\n  return upsert docs[doc] {status:'done'}\n";assert!(notes(&upsert).iter().any(|note|note.code=="N_APPROVAL_NOT_ENFORCED"));let mixed=source+"mutation independent(doc: docs):\n  require exists roles[principal = viewer,role = 'manager'] else DENIED\n  return insert approvals {doc}\n";assert!(notes(&mixed).iter().any(|note|note.code=="N_APPROVAL_NOT_ENFORCED"&&note.message.contains("approvals.doc")));}
    }
    let insert_restricted=source.replace("BODY","  update docs[doc] {status:'done'}\n").replace("  insert <- allow\n  update <- allow","  insert <- exists roles[principal = viewer,role = 'manager']\n  update <- allow")+"mutation overwrite(doc: docs):\n  return upsert docs[doc] {status:'done'}\n";
    assert!(notes(&insert_restricted).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    for guard in ["exists approvals[doc = doc]","count(approvals[doc = doc]) > 0","not (count(approvals[doc = doc]) = 0)"]{let guarded=source.replace("BODY","").replace("  update docs[doc] {status:'archived'}",&format!("  require {guard} else NO_APPROVAL\n  update docs[doc] {{status:'archived'}}"));assert!(!notes(&guarded).iter().any(|note|note.code=="N_APPROVAL_NOT_ENFORCED"),"{guard}");}
    for guard in ["exists approvals[doc = other]","not exists approvals[doc = other]"]{let unrelated=source.replace("BODY","").replace("mutation finish(doc: docs):","mutation finish(doc: docs,other: docs):").replace("  update docs[doc] {status:'archived'}",&format!("  require {guard} else NO_APPROVAL\n  update docs[doc] {{status:'archived'}}"));assert!(notes(&unrelated).iter().any(|note|note.code=="N_APPROVAL_NOT_ENFORCED"),"{guard}");}
    for guard in ["exists approvals[doc = .id]","not exists approvals[doc = .id]"]{let guarded=source.replace("BODY","").replace("  doc: docs\n  cap 10", "  doc: docs\n  unique doc\n  cap 10").replace("update <- allow",&format!("update <- {guard}"));assert!(!notes(&guarded).iter().any(|note|note.code=="N_APPROVAL_NOT_ENFORCED"),"{guard}");}
    let vacuous=source.replace("BODY","").replace("  doc: docs\n  cap 10","  doc: docs\n  unique doc\n  cap 10").replace("update <- allow","update <- (true = true) or exists approvals[doc = .id]");
    assert!(notes(&vacuous).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let negative=source.replace("BODY","").replace("  update docs[doc] {status:'archived'}", "  require not exists approvals[doc = doc] else ALREADY\n  update docs[doc] {status:'archived'}");assert!(!notes(&negative).iter().any(|note|note.code=="N_APPROVAL_NOT_ENFORCED"));let unguarded=negative+"mutation unchecked(doc: docs):\n  update docs[doc] {status:'archived'}\n";assert!(notes(&unguarded).iter().any(|note|note.code=="N_APPROVAL_NOT_ENFORCED"));
    let created=source.replace("BODY","").replace("return insert approvals {doc}","fresh = insert docs {status:'done'}\n  return insert approvals {doc:fresh.id}");assert!(!notes(&created).iter().any(|note|note.code=="N_APPROVAL_NOT_ENFORCED"));let mixed=created+"mutation independent(doc: docs):\n  require exists roles[principal = viewer,role = 'manager'] else DENIED\n  return insert approvals {doc}\n";assert!(notes(&mixed).iter().any(|note|note.code=="N_APPROVAL_NOT_ENFORCED"));
}

#[test]fn read_audiences_and_other_rows_do_not_enforce_a_scalar_approval(){
    let source="table docs:\n  approved: bool default false\n  status: enum('draft','done') default 'draft'\n  note: text ? read <- .approved = true\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {approved:true}\nmutation finish(doc: docs,other: docs):\nGUARD  update docs[doc] {status:'done'}\n";
    for (guard,expected) in [("",true),("  o = docs[other] ! else MISSING\n  require o.approved else NO_APPROVAL\n",true),("  d = docs[doc] ! else MISSING\n  require d.approved else NO_APPROVAL\n",false)]{
        let ns=notes(&source.replace("GUARD",guard));assert_eq!(ns.iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),expected,"{ns:?}");
    }
}

#[test]fn one_negative_scalar_guard_does_not_discharge_an_unchecked_effect(){
    let source="table docs:\n  approved: bool default false\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {approved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require not d.approved else FROZEN\n  update docs[doc] {status:'done'}\nEXTRA";
    for (extra,expected) in [("",false),("mutation bypass(doc: docs):\n  update docs[doc] {status:'done'}\n",true)]{assert_eq!(notes(&source.replace("EXTRA",extra)).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),expected);}
}

#[test]fn enforced_corpus_approvals_and_exact_decision_audits_do_not_gate(){
    for source in [include_str!("security/sec10-controls/w18-043.q"),include_str!("security/sec10-controls/w20-010.q"),include_str!("security/sec10-controls/w22-024.q"),include_str!("security/sec10-controls/w24-038.q"),include_str!("security/sec10-controls/w26-018.q"),include_str!("security/sec10-controls/w26-048.q"),include_str!("security/sec10-controls/w15-096.q"),include_str!("security/sec10-controls/w18-042.q"),include_str!("security/sec10-controls/w20-007.q"),include_str!("security/sec10-controls/w20-049.q"),include_str!("security/sec10-controls/w22-022.q"),include_str!("security/sec10-controls/w22-049.q"),include_str!("security/sec10-controls/w24-050.q"),include_str!("security/sec10-controls/w26-010.q"),include_str!("security/sec10-controls/w26-026.q"),include_str!("security/sec10-controls/w26-041.q"),include_str!("security/sec10-controls/w24-022.q"),include_str!("security/sec10-controls/w25-005.q")]{assert!(!notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{:?}",notes(source));}
}
#[test]fn scalar_freezes_are_matched_to_each_affected_column(){
    let source="table docs:\n  approved: bool default false\n  status: enum('draft','done') default 'draft'\n  phase: enum('open','closed') default 'open'\n  immutable status when .approved = true\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {approved:true}\nmutation finish(doc: docs):\n  update docs[doc] {status:'done'}\nEXTRA";
    assert!(!notes(&source.replace("EXTRA","")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    assert!(notes(&source.replace("EXTRA","mutation bypass(doc: docs):\n  update docs[doc] {phase:'closed'}\n")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let dynamic=source.replace("EXTRA","").replace("mutation finish(doc: docs):\n  update docs[doc] {status:'done'}","mutation finish(doc: docs,next: enum('draft','done')):\n  update docs[doc] {status:next,approved:true}").replace("  immutable status when .approved = true\n","");
    assert!(notes(&dynamic).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}

#[test]fn mirrored_decision_audits_respect_broader_defaults_and_preserved_stamps(){
    let source="table roles:\n  principal: principal\n  role: enum('owner','crew')\n  unique principal\n  read <- allow\n  online only\ntable docs:\n  approvedAt: time ?\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable approvals:\n  doc: docs\n  read <- allow\n  insert <- exists roles[principal = viewer,role = 'owner']\n  online only\nmutation approve(doc: docs):\n  require exists roles[principal = viewer,role = 'owner'] else OWNER\n  update docs[doc] {approvedAt:now}\n  return insert approvals {doc}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approvedAt != null else APPROVAL\n  update docs[doc] {status:'done'}\nmutation preserve(doc: docs):\n  d = docs[doc] ! else MISSING\n  update docs[doc] {approvedAt:d.approvedAt}\n";
    assert!(!notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{:?}",notes(source));
    let helper=source.replace("  update docs[doc] {approvedAt:now}","  decision(doc)")+"fn decision(doc: docs):\n  update docs[doc] {approvedAt:now}\n  return null\n";
    assert!(!notes(&helper).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let early=source.replace("mutation approve(doc: docs):","mutation approve(doc: docs,skip: bool):").replace("  update docs[doc] {approvedAt:now}\n  return insert approvals {doc}","  insert approvals {doc}\n  if skip:\n    return null\n  update docs[doc] {approvedAt:now}\n  return null");
    assert!(notes(&early).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{:?}",notes(&early));
    for transfer in ["continue","break","return null"]{
        let body=format!("  for n in items:\n    insert approvals {{doc}}\n    if skip:\n      {transfer}\n    update docs[doc] {{approvedAt:now}}\n  return null");
        let skipped=source.replace("mutation approve(doc: docs):","mutation approve(doc: docs,items: [int] <=10,skip: bool):").replace("  update docs[doc] {approvedAt:now}\n  return insert approvals {doc}",&body);
        assert!(notes(&skipped).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{transfer}: {:?}",notes(&skipped));
    }
    let loop_return=source.replace("mutation approve(doc: docs):","mutation approve(doc: docs,items: [int] <=10):").replace("  update docs[doc] {approvedAt:now}\n  return insert approvals {doc}","  insert approvals {doc}\n  for n in items:\n    return null\n  update docs[doc] {approvedAt:now}\n  return null");
    assert!(notes(&loop_return).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let optional_helper=helper.replace("mutation approve(doc: docs):","mutation approve(doc: docs,items: [int] <=10):").replace("  decision(doc)","  for n in items:\n    decision(doc)");
    assert!(notes(&optional_helper).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let conditional=source.replace("mutation approve(doc: docs):","mutation approve(doc: docs,items: [int] <=10):").replace("  update docs[doc] {approvedAt:now}","  for n in items:\n    update docs[doc] {approvedAt:now}");
    assert!(notes(&conditional).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let defaulted=source.replace("approvedAt: time ?","approvedAt: time ? default now")+"mutation create():\n  return insert docs {}\n";
    assert!(notes(&defaulted).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}

#[test]fn source_paths_and_all_changed_columns_bound_scalar_enforcement(){
    let base="table docs:\n  approved: bool default false\n  status: enum('draft','done') default 'draft'\n  phase: enum('open','closed') default 'open'\n  immutable status when .approved = true\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {approved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  update docs[doc] {FIELDS}\n";
    for fields in ["status:'done',phase:'closed'","status:d.status,phase:'closed'"]{assert!(notes(&base.replace("FIELDS",fields)).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));}
    let pair="table docs:\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\ntable pairs:\n  primary: docs\n  secondary: docs\n  read <- allow\n  online only\ntable effects:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {approved:true}\nmutation work(pair: pairs):\n  p = pairs[pair] ! else MISSING\n  require p.CHECK.approved = true else APPROVAL\n  return insert effects {doc:p.primary}\n";
    assert!(notes(&pair.replace("CHECK","secondary")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));assert!(!notes(&pair.replace("CHECK","primary")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}
#[test]fn only_dominating_approval_loops_and_nonvacuous_conditions_count(){
    let source="table trips:\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\ntable bookings:\n  trip: trips\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\ntable waivers:\n  booking: bookings\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(booking: bookings):\n  update bookings[booking] {approved:true}\nmutation waiver(booking: bookings):\n  return insert waivers {booking}\nmutation finish(trip: trips):\nLOOP  update trips[trip] {status:'done'}\n";
    for (body,gate) in [("  for b in bookings first 10 by .id:\n    require b.approved else APPROVAL\n",false),("  if false:\n    for b in bookings first 10 by .id:\n      require b.approved else APPROVAL\n",true),("  for b in bookings first 10 by .id:\n    if false:\n      require b.approved else APPROVAL\n",true)]{assert_eq!(notes(&source.replace("LOOP",body)).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),gate);}
    let skipped="  for b in bookings first 10 by .id:\n    stop = true\n    if stop:\n      continue\n    require b.approved else APPROVAL\n";
    assert!(notes(&source.replace("LOOP",skipped)).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let inner="  for b in bookings first 10 by .id:\n    stop = false\n    for n in [1]:\n      stop = true\n    if stop:\n      continue\n    require b.approved else APPROVAL\n";
    assert!(notes(&source.replace("LOOP",inner)).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let prefix="  stop = false\n  if true:\n    stop = true\n  for b in bookings first 10 by .id:\n    if stop:\n      continue\n    require b.approved else APPROVAL\n";
    assert!(notes(&source.replace("LOOP",prefix)).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let phantom="  for b in bookings first 10 by .id:\n    stop = true\n    for n in [1]:\n      stop = false\n    if stop:\n      require b.approved else APPROVAL\n";
    assert!(notes(&source.replace("LOOP",phantom)).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    for (value,body) in [("true","    if stop:\n      continue\n    require b.approved else APPROVAL\n"),("false","    if stop:\n      require b.approved else APPROVAL\n")]{
        let loop_body=format!("  for b in bookings first 10 by .id:\n    stop = skip()\n{body}");let source=source.replace("LOOP",&loop_body)+&format!("fn skip(): {value}\n");assert!(notes(&source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"helper returns {value}");
    }
    let caller=source.replace("mutation finish(trip: trips):","mutation finish(trip: trips,restricted: bool):").replace("LOOP","  for b in bookings first 10 by .id:\n    stop = choose(restricted)\n    if stop:\n      require b.approved else APPROVAL\n")+"fn choose(value: bool): value\n";
    assert!(!notes(&caller).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let checked=source.replace("LOOP","  for b in bookings first 10 by .id:\n    stop = checked(b.approved)\n    if stop:\n      continue\n")+"fn checked(value: bool):\n  require value else APPROVAL\n  return false\n";
    assert!(!notes(&checked).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    for (value,consumed) in [("not checked(b.approved)",true),("checked(b.approved) = false",true),("choose(checked(b.approved))",true),("null ?? checked(b.approved)",true),("false ?? checked(b.approved)",false),("{value:checked(b.approved)}.value",true),("false and checked(b.approved)",false),("true or checked(b.approved)",false)]{
        let body=format!("  for b in bookings first 10 by .id:\n    stop = {value}\n");let source=source.replace("LOOP",&body)+"fn checked(value: bool):\n  require value else APPROVAL\n  return false\nfn choose(value: bool): value\n";assert_eq!(!notes(&source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),consumed,"{value}");
    }
    for expression in ["b.approved and opaque(flag)","opaque(flag) or b.approved"]{
        let body=format!("  for b in bookings first 10 by .id:\n    require {expression} else APPROVAL\n");let source=source.replace("mutation finish(trip: trips):","mutation finish(trip: trips,flag: bool):").replace("LOOP",&body)+"fn opaque(flag: bool):\n  if flag:\n    return true\n  return false\n";assert!(!notes(&source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{expression}");
    }
    let wrapped=source.replace("LOOP","  for b in bookings first 10 by .id:\n    ignored = wrap(b.approved)\n")+"fn checked(value: bool):\n  require value else APPROVAL\n  return true\nfn wrap(value: bool):\n  if checked(value):\n    return true\n  return false\n";
    assert!(!notes(&wrapped).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let domain=wrapped.replace("if checked(value):", "for n in checkedList(value):")+"fn checkedList(value: bool):\n  require value else APPROVAL\n  return [1]\n";
    assert!(!notes(&domain).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let projection=source.replace("LOOP","  for b in bookings first 10 by .id:\n    total = sum([], checkedInt(b.approved))\n")+"fn checkedInt(value: bool):\n  require value else APPROVAL\n  return 0\n";
    assert!(notes(&projection).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let conditional=source.replace("mutation finish(trip: trips):","mutation finish(trip: trips,flag: bool):").replace("LOOP","  for b in bookings first 10 by .id:\n    stop = flag and checked(b.approved)\n")+"fn checked(value: bool):\n  require value else APPROVAL\n  return false\n";
    assert!(!notes(&conditional).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    for value in ["null ?? skip()","{stop:skip()}.stop","skip() if true else false"]{
        let body=format!("  for b in bookings first 10 by .id:\n    stop = {value}\n    if stop:\n      continue\n    require b.approved else APPROVAL\n");let source=source.replace("LOOP",&body)+"fn skip(): true\n";assert!(notes(&source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{value}");
    }
    let dead=source.replace("mutation finish(trip: trips):","mutation finish(trip: trips,choice: bool):").replace("LOOP","  for b in bookings first 10 by .id:\n    if choice:\n      continue\n    if choice:\n      require b.approved else APPROVAL\n");assert!(notes(&dead).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let admitted=source.replace("mutation finish(trip: trips):","mutation finish(trip: trips,choice: bool):").replace("LOOP","  for b in bookings first 10 by .id:\n    stop = checkedChoice(choice)\n    if not choice:\n      require b.approved else APPROVAL\n")+"fn checkedChoice(value: bool):\n  require value else CHOICE\n  return false\n";assert!(notes(&admitted).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let helper=source.replace("  update trips[trip] {status:'done'}","  setDone(trip)")+"fn setDone(trip: trips):\n  update trips[trip] {status:'done'}\n  return null\n";
    assert!(!notes(&helper.replace("LOOP","  for b in bookings first 10 by .id:\n    require b.approved else APPROVAL\n")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    for transfer in ["continue","break","return null"]{
        let body=format!("  for b in bookings first 10 by .id:\n    {transfer}\n    require b.approved else APPROVAL\n");assert!(notes(&source.replace("LOOP",&body)).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    }
    let conditional="table docs:\n  approved: bool default false\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {approved:true}\nmutation work(doc: docs,restricted: bool):\n  d = docs[doc] ! else MISSING\n  if CONDITION:\n    require d.approved else APPROVAL\n  update docs[doc] {status:'done'}\n";
    assert!(!notes(&conditional.replace("CONDITION","restricted")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));assert!(notes(&conditional.replace("CONDITION","false")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}

#[test]fn potential_approval_writes_and_irrelevant_markers_do_not_hide_unused_approval(){
    let source="table docs:\n  approved: bool default false\n  marker: bool default false\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs,flag: bool):\n  update docs[doc] {PAYLOAD}\nmutation finish(doc: docs):\n  update docs[doc] {status:'done'}\n";
    for payload in ["approved:flag","approved:flag,status:'done'","approved:true,marker:false","approved:true,marker:true"]{assert!(notes(&source.replace("PAYLOAD",payload)).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));}
}

#[test]fn schema_approval_hops_keep_the_actual_stored_parent_path(){
    let source="table docs:\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\ntable pairs:\n  primary: docs\n  secondary: docs\n  read <- allow\n  online only\ntable effects:\n  doc: docs\n  pair: pairs\n  read <- allow\n  insert <- .pair.CHECK.approved = true\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {approved:true}\nmutation work(pair: pairs):\n  p = pairs[pair] ! else MISSING\n  return insert effects {doc:p.primary,pair}\n";
    assert!(!notes(&source.replace("CHECK","primary")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));assert!(notes(&source.replace("CHECK","secondary")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}

#[test]fn approval_table_freezes_cover_all_actual_state_columns(){
    let source="table roles:\n  principal: principal\n  role: enum('owner','crew')\n  unique principal\n  read <- allow\n  online only\ntable docs:\n  status: enum('draft','done') default 'draft' write <- not exists approvals[doc = .id]\n  phase: enum('open','closed') default 'open'\n  read <- allow\n  update <- allow\n  online only\ntable approvals:\n  doc: docs\n  unique doc\n  read <- allow\n  insert <- exists roles[principal = viewer,role = 'owner']\n  online only\nmutation approve(doc: docs):\n  require exists roles[principal = viewer,role = 'owner'] else OWNER\n  return insert approvals {doc}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  update docs[doc] {FIELDS}\n";
    assert!(!notes(&source.replace("FIELDS","status:'done'")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    for fields in ["status:'done',phase:'closed'","status:d.status,phase:'closed'"]{assert!(notes(&source.replace("FIELDS",fields)).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));}
}
#[test]fn self_references_keep_ancestor_audit_provenance(){
    let source="table roles:\n  principal: principal\n  role: enum('owner','crew')\n  unique principal\n  read <- allow\n  online only\ntable docs:\n  parent: docs ?\n  stage: enum('draft','issued','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\ntable approvals:\n  doc: docs\n  read <- allow\n  insert <- exists roles[principal = viewer,role = 'owner']\n  online only\nmutation decide(doc: docs,replacement: docs):\n  require exists roles[principal = viewer,role = 'owner'] else OWNER\n  d = docs[doc] ! else MISSING\n  parent = d.parent ! else MISSING\n  update docs[doc] {stage:'issued'RETARGET}\n  return insert approvals {doc:parent}\nmutation finish(doc: docs):\n  update docs[doc] {stage:'done'}\n";
    assert!(!notes(&source.replace("RETARGET","")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    assert!(!notes(&source.replace("RETARGET",",parent:d.parent")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    assert!(notes(&source.replace("RETARGET",",parent:replacement")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}
#[test]fn upsert_state_effects_cannot_leave_approvals_unenforced(){
    let source="table docs:\n  approved: bool default false\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  upsert docs[doc] {approved:true}\nmutation finish(doc: docs):\nGUARD  upsert docs[doc] {status:'done'}\n";
    assert!(notes(&source.replace("GUARD","")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));assert!(!notes(&source.replace("GUARD","  d = docs[doc] ! else MISSING\n  require d.approved else APPROVAL\n")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}

#[test]fn schema_constant_vacuity_cannot_consume_approvals(){
    let source="table docs:\n  approved: bool default false\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- POLICY\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {approved:true}\nmutation finish(doc: docs):\n  update docs[doc] {status:'done'}\n";
    for policy in ["true or .approved = true","not (false and .approved = false)","(true = true) or .approved = true","(1 != 2) or .approved = true"]{assert!(notes(&source.replace("POLICY",policy)).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));}
    assert!(!notes(&source.replace("POLICY","false or .approved = true")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}

#[test]fn reassigned_transfer_conditions_cannot_borrow_unreachable_decisions(){
    use snapback4_core::{Engine,Context,Value,WriteState};use std::collections::BTreeMap;
    let source="table roles:\n  principal: principal\n  role: enum('owner')\n  unique principal\n  read <- allow\n  online only\ntable docs:\n  approvedAt: time ?\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\ntable approvals:\n  doc: docs\n  read <- allow\n  insert <- exists roles[principal = viewer,role = 'owner']\n  online only\nmutation approve(doc: docs):\n  require exists roles[principal = viewer,role = 'owner'] else OWNER\n  for n in [1]:\n    stop = false\n    insert approvals {doc}\n    if true:\n      stop = true\n      if stop:\n        TRANSFER\n    update docs[doc] {approvedAt:now}\n  return null\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approvedAt != null else APPROVAL\n  update docs[doc] {status:'done'}\nquery get(doc: docs):\n  return docs[doc]\n";
    for transfer in ["continue","break","return null"]{let source=source.replace("TRANSFER",transfer);let b=bound(&source);assert!(notes(&source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{transfer}");let mut e=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=|table:&str,json:serde_json::Value|snapback4_core::wire::row_from_json(&b.schema.tables[table],&json).unwrap();e.seed_at([("roles".into(),row("roles",serde_json::json!({"id":"r","principal":"dev:owner","role":"owner"}))),("docs".into(),row("docs",serde_json::json!({"id":"d","approvedAt":null,"status":"draft"})))],challenges::NOW).unwrap();let args=BTreeMap::from([("doc".into(),Value::Id("d".into()))]);let result=e.mutate("approve",None,Context::new("dev:owner",args.clone()).at(challenges::NOW)).unwrap();assert!(matches!(result.state,WriteState::Sent{..}));let observed=e.query("get",Context::new("dev:owner",args).at(challenges::NOW)).unwrap();assert_eq!(observed.data.field("approvedAt").unwrap(),&Value::Null);}
}
#[test]fn negative_constant_guards_do_not_consume_an_approval(){
    let source="table docs:\n  approved: bool default false\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {approved:true}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require (-1 = -1) or d.approved else APPROVAL\n  update docs[doc] {status:'done'}\n";
    assert!(notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}

#[test]fn captured_loop_values_survive_later_reassignments(){
    let source="table roles:\n  principal: principal\n  role: enum('owner')\n  unique principal\n  read <- allow\n  online only\ntable docs:\n  approvedAt: time ?\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\ntable approvals:\n  doc: docs\n  read <- allow\n  insert <- exists roles[principal = viewer,role = 'owner']\n  online only\nmutation approve(doc: docs):\n  require exists roles[principal = viewer,role = 'owner'] else OWNER\n  for stop in [true]:\n    saved = stop\n    stop = false\n    insert approvals {doc}\n    if saved:\n      return null\n    update docs[doc] {approvedAt:now}\nmutation finish(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.approvedAt != null else APPROVAL\n  update docs[doc] {status:'done'}\n";
    assert!(notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    use snapback4_core::{Engine,Context,Value,WriteState};use std::collections::BTreeMap;
    let source=source.to_owned()+"query get(doc: docs):\n  return docs[doc]\n";let b=bound(&source);let mut e=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();let row=|table:&str,json:serde_json::Value|snapback4_core::wire::row_from_json(&b.schema.tables[table],&json).unwrap();e.seed_at([("roles".into(),row("roles",serde_json::json!({"id":"r","principal":"dev:owner","role":"owner"}))),("docs".into(),row("docs",serde_json::json!({"id":"d","approvedAt":null,"status":"draft"})))],challenges::NOW).unwrap();let args=BTreeMap::from([("doc".into(),Value::Id("d".into()))]);let result=e.mutate("approve",None,Context::new("dev:owner",args.clone()).at(challenges::NOW)).unwrap();assert!(matches!(result.state,WriteState::Sent{..}));let observed=e.query("get",Context::new("dev:owner",args).at(challenges::NOW)).unwrap();assert_eq!(observed.data.field("approvedAt").unwrap(),&Value::Null);
}

#[test]fn recursive_helper_requirements_cannot_overflow_source_advice(){
    let source="table trips:\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\ntable bookings:\n  trip: trips\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\ntable waivers:\n  booking: bookings\n  read <- allow\n  insert <- allow\n  online only\nmutation waiver(booking: bookings):\n  return insert waivers {booking}\nfn cycleA(value: bool):\n  require cycleB(value) else DENIED\n  return value\nfn cycleB(value: bool):\n  require cycleA(value) else DENIED\n  return value\nmutation approve(booking: bookings):\n  update bookings[booking] {approved:true}\nmutation finish(trip: trips):\n  for b in bookings first 10 by .id:\n    require cycleA(true) else DENIED\n    require b.approved else APPROVAL\n  update trips[trip] {status:'done'}\n";
    let (_,diagnostics)=snapback4_lang::parse_document("schema.q",source);assert!(diagnostics.is_empty(),"{diagnostics:?}");
    let sources=sources(source);let b=compile(&sources);let mut report=security::analyze_rules(&b);security::add_source_notes(&mut report,&sources,&b);assert!(report.notes.iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}

#[test]fn only_actually_inspected_clauses_create_approval_input_contracts(){
    let source="table docs:\n  consent: bool\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  d = docs[doc] ! else MISSING\n  require GUARD else CONSENT\n  update docs[doc] {approved:true}\nmutation edit(doc: docs,consent: bool):\n  update docs[doc] {consent}\n";
    let original=include_str!("security/sec10-controls/vacuous-bool-approval.q");assert!(!security::derived::invariants(&sources(original),&bound(original)).iter().any(|i|i.table=="docs"&&i.column.as_deref()==Some("consent")));
    for (guard,expected) in [("true or d.consent",false),("(1 = 1) or d.consent",false),("false or d.consent",true),("checked(d.consent)",true),("wrapper(d.consent)",true)]{
        let source=source.replace("GUARD",guard)+"fn checked(value: bool):\n  require value else CONSENT\n  return true\nfn wrapper(value: bool):\n  require checked(value) else CONSENT\n  return true\n";let candidates=security::derived::invariants(&sources(&source),&bound(&source));assert_eq!(candidates.iter().any(|i|i.table=="docs"&&i.column.as_deref()==Some("consent")),expected,"{guard}: {candidates:?}");
    }
}

#[test]fn joined_bindings_preserve_known_and_caller_conditional_approval_use(){
    let source="table docs:\n  approved: bool default false\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {approved:true}\nmutation finish(doc: docs,choice: bool):\n  d = docs[doc] ! else MISSING\n  stop = BEFORE\n  if choice:\n    stop = AFTER\n  if stop:\n    require d.approved else APPROVAL\n  update docs[doc] {status:'done'}\n";
    for (before,after,gated) in [("false","false",true),("true","true",false),("false","true",false),("true","false",false)]{let source=source.replace("BEFORE",before).replace("AFTER",after);assert_eq!(notes(&source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),gated,"{before}/{after}");}
}

#[test]fn caller_path_facts_exclude_skipped_approval_branches(){
    let source="table docs:\n  approved: bool default false\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {approved:true}\nmutation finish(doc: docs,choice: bool):\n  d = docs[doc] ! else MISSING\n  if choice:\n    return null\n  if choice:\n    require d.approved else APPROVAL\n  update docs[doc] {status:'done'}\n";
    assert!(notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    for condition in ["choice = true","choice != false","true = choice"]{let guarded=source.replacen("  if choice:\n    return null",&format!("  if {condition}:\n    return null"),1);assert!(notes(&guarded).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{condition}");}
    let opaque=source.replace("  if choice:\n    return null\n","").replace("  if choice:\n    require d.approved","  if never(choice):\n    require d.approved")+"fn never(flag: bool):\n  if flag:\n    return false\n  return false\n";assert!(notes(&opaque).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let checked=source.replace("  if choice:\n    return null\n","").replace("require d.approved else APPROVAL","require checked(d.approved) else APPROVAL")+"fn checked(value: bool):\n  require value else APPROVAL\n  return true\n";assert!(!notes(&checked).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));

    let joined=source.replace("  if choice:\n    return null", "  stop = false\n  if choice:\n    stop = true\n    return null").replace("  if choice:\n    require d.approved", "  if stop:\n    require d.approved");assert!(notes(&joined).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}

#[test]fn an_unrelated_unknown_value_does_not_erase_an_unconditional_approval_guard(){
    let source="table docs:\n  approved: bool default false\n  status: enum('draft','done') default 'draft'\n  reason: text <=30 ?\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {approved:true}\nmutation finish(doc: docs,newReason: text <=30 ?):\n  d = docs[doc] ! else MISSING\n  reason = newReason\n  if reason = null:\n    reason = d.reason\n  require reason != null else REASON\n  require d.approved else APPROVAL\n  update docs[doc] {status:'done'}\n";
    assert!(!notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}

#[test]fn approval_alternatives_do_not_establish_caller_facts(){
    assert!(!notes(include_str!("security/sec10-controls/or-branch-facts.q")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}
#[test]fn parent_approval_loops_keep_the_selected_parent(){
    let source=include_str!("security/sec10-controls/or-branch-facts.q").replace("mutation finish(trip: trips,flag: bool):","mutation finish(trip: trips,other: trips,flag: bool):\n  require trip != other else DIFFERENT").replace("    require flag or opaque(flag) else CHOICE\n    if flag:\n      continue\n","");
    for (target,gated) in [("trip",false),("other",true)]{let source=source.replace("bookings first 10",&format!("bookings where .trip = {target} first 10"));assert_eq!(notes(&source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),gated,"{target}");}
    for predicate in [".trip = trip and .trip = other",".trip = trip and false"]{let source=source.replace("bookings first 10",&format!("bookings where {predicate} first 10"));assert!(notes(&source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{predicate}");}
    let ancestor=source.replace("table trips:","table trips:\n  parent: trips ?").replace("  for b in bookings first 10", "  t = trips[trip] ! else MISSING\n  parent = t.parent ! else NO_PARENT\n  require parent != trip else DIFFERENT_PARENT\n  for b in bookings where .trip = parent first 10");assert!(notes(&ancestor).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    assert!(!notes(&ancestor.replace("update trips[trip]", "update trips[parent]")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}
#[test]fn approval_table_use_belongs_to_each_literal_kind(){
    let source="table roles:\n  principal: principal\n  role: enum('manager','staff')\n  unique principal\n  read <- allow\n  online only\ntable docs:\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\ntable approvals:\n  doc: docs\n  kind: enum('permit','audit')\n  unique doc,kind\n  read <- allow\n  insert <- exists roles[principal = viewer,role = 'manager']\n  online only\nmutation permit(doc: docs):\n  require exists roles[principal = viewer,role = 'manager'] else MANAGER\n  return insert approvals {doc,kind:'permit'}\nmutation audit(doc: docs):\n  require exists roles[principal = viewer,role = 'manager'] else MANAGER\n  return insert approvals {doc,kind:'audit'}\nmutation finish(doc: docs):\n  require exists approvals[doc = doc,kind = 'permit'] else PERMIT\n  update docs[doc] {status:'done'}\n";
    let audit_line=source.lines().position(|line|line.contains("return insert approvals {doc,kind:'audit'}")).unwrap()+1;
    for guard in ["exists approvals[doc = doc,kind = 'permit']","exists approvals where .doc = doc and .kind = 'permit'","exists approvals[doc = doc] where .kind != 'audit'"]{
        let source=source.replace("exists approvals[doc = doc,kind = 'permit']",guard);let ns=notes(&source).into_iter().filter(|n|n.code=="N_APPROVAL_NOT_ENFORCED").collect::<Vec<_>>();assert_eq!(ns.len(),1,"{guard}: {ns:?}");assert_eq!(ns[0].site.line as usize,audit_line,"{guard}");
    }
    let schema=source.replace("  update <- allow","  update <- exists approvals[doc = .id,kind = 'permit']").replace("  require exists approvals[doc = doc,kind = 'permit'] else PERMIT\n","");let ns=notes(&schema).into_iter().filter(|n|n.code=="N_APPROVAL_NOT_ENFORCED").collect::<Vec<_>>();assert_eq!(ns.len(),1,"{ns:?}");assert_eq!(ns[0].site.line as usize,audit_line);
    let broad=source.replace("exists approvals[doc = doc,kind = 'permit']","exists approvals where .doc = doc and (.kind = 'permit' or .kind = 'audit')");assert!(!notes(&broad).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let mutable=source.replace("  insert <- exists roles[principal = viewer,role = 'manager']","  update <- allow\n  insert <- exists roles[principal = viewer,role = 'manager']")+"mutation classify(approval: approvals):\n  update approvals[approval] {kind:'permit'}\n";assert!(!notes(&mutable).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let denied=source.to_string()+"mutation classify(approval: approvals):\n  update approvals[approval] {kind:'permit'}\n";assert!(notes(&denied).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let immutable=mutable.replace("  kind: enum('permit','audit')", "  kind: enum('permit','audit')\n  immutable kind");assert!(notes(&immutable).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    for body in ["  a = approvals[approval] ! else MISSING\n  update approvals[approval] {kind:a.kind}\n","  require false else DENIED\n  update approvals[approval] {kind:'permit'}\n","  update approvals[approval] {kind:'permit'} if false\n","  update approvals[approval] {kind:'audit'}\n"]{let shape=source.replace("  insert <- exists roles[principal = viewer,role = 'manager']","  update <- allow\n  insert <- exists roles[principal = viewer,role = 'manager']")+"mutation preserve(approval: approvals):\n"+body;assert!(notes(&shape).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{body}");}
}

#[test]fn row_alias_approval_writes_keep_the_actual_table_and_source_site(){
    let source="table docs:\n  approved: bool default false\n  stage: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\nBODY\nmutation finish(doc: docs):\n  update docs[doc] {stage:'done'}\n";
    for body in ["  d = docs[doc] ! else MISSING\n  update d {approved:true}","  d = lookup(doc)\n  update d {approved:true}\nfn lookup(doc: docs):\n  return docs[doc] ! else MISSING","  for d in docs first 10 by .id:\n    update d {approved:true}"]{
        let source=source.replace("BODY",body);let b=security::derived::augmented(&sources(&source),&bound(&source));assert!(b.schema.tables.contains_key("docs"));assert!(notes(&source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{body}");
        let guarded=source.replace("  update docs[doc] {stage:'done'}","  d = docs[doc] ! else MISSING\n  require d.approved else APPROVAL\n  update d {stage:'done'}");assert!(!notes(&guarded).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{body}");
    }
}

#[test]fn actual_alias_corpus_schema_does_not_panic_and_keeps_unused_approval_visible(){
    let source=include_str!("security/sec10-controls/w26-037.q");let _=security::derived::augmented(&sources(source),&bound(source));assert!(notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"&&n.message.contains("remakeApproved")));
}

#[test]fn impossible_effects_neither_consume_approval_nor_create_sibling_contracts(){
    let source="table docs:\n  approved: bool default false\n  stage: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\ntable outputs:\n  doc: docs\n  read <- allow\n  insert <- allow\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {approved:true}\nmutation guarded(doc: docs,flag: bool):\n  d = docs[doc] ! else MISSING\nPREFIX  require d.approved else APPROVAL\n  return update docs[doc] {stage:'done'} if CONDITION\nmutation bypass(doc: docs):\n  return update docs[doc] {stage:'done'}\n";
    for (prefix,condition,possible) in [("","false",false),("  require not flag else FLAG\n","flag",false),("","flag",true)]{
        let source=source.replace("PREFIX",prefix).replace("CONDITION",condition);let b=bound(&source);let cs=security::derived::invariants(&sources(&source),&b);assert_eq!(cs.iter().any(|i|i.site.file.contains("sibling-approval")),possible,"{condition}");assert_eq!(!notes(&source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),possible,"{condition}");
    }
    for domain in ["[]","docs where false first 10 by .id"]{let source=source.replace("PREFIX","").replace("  require d.approved else APPROVAL\n  return update docs[doc] {stage:'done'} if CONDITION",&format!("  for row in {domain}:\n    require d.approved else APPROVAL\n    update docs[doc] {{stage:'done'}}\n  return null"));let cs=security::derived::invariants(&sources(&source),&bound(&source));assert!(!cs.iter().any(|i|i.site.file.contains("sibling-approval")),"{domain}");assert!(notes(&source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));}
}
#[test]fn no_op_child_stage_copies_cannot_erase_completion_obligations(){
    let source=include_str!("security/wave26/008.q");
    for body in ["  w = walls[wall] ! else MISSING\n  update walls[wall] {stage:w.stage}","  w = walls[wall] ! else MISSING\n  require w.stage = 'finish' else STAGE\n  update walls[wall] {stage:'finish'}"]{let source=source.to_string()+"\nmutation copyWall(wall: walls):\n"+body+"\n";let cs=security::derived::invariants(&sources(&source),&bound(&source));assert!(cs.iter().any(|i|i.site.file.contains("child-stage")),"{body}");}
}
#[test]fn unresolved_row_selection_has_an_explicit_inference_gap(){
    let source="table docs:\n  approved: bool default false\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs,other: docs,flag: bool):\n  d = choose(doc,other,flag)\n  update d {approved:true}\nfn choose(doc: docs,other: docs,flag: bool):\n  if flag:\n    return docs[doc] ! else MISSING\n  return docs[other] ! else MISSING\n";let b=bound(source);let gaps=security::source_inference_gaps(&sources(source),&b);assert!(gaps.iter().any(|gap|gap.contains("unresolved write target")&&gap.contains("update TABLE[key]")),"{gaps:?}");let _=security::derived::augmented(&sources(source),&b);
}
