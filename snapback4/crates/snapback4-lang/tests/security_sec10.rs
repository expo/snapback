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
        let c=campaign(source);for label in labels{assert!(c.violations.iter().any(|v|v.reachability.is_reachable()&&v.invariant_site.contains(label)),"missing {label}: {}",format!("operations={:?}, violations={:?}, gaps={:?}",c.operations,c.violations.iter().map(|v|(&v.operation,&v.invariant_site)).collect::<Vec<_>>(),c.unsupported));}
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
    assert!(!notes(include_str!("security/wave26/008.q")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
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
    let b=bound(source);let _=security::derived::invariants(&sources(source),&b);
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

#[test]fn timestamps_recording_the_atomic_decision_are_not_unused_approvals(){
    for (field,kind,value,column) in [("depositKept","bool default false","true","approvedAt"),("quoteStatus","enum('pending','approved') default 'pending'","'approved'","approvedAt"),("wording","text <=30 ?","'new wording'","wordingApprovedAt"),("dyedColor","text <=30 ?","'blue'","dyeApprovedAt")]{
        let source=format!("table docs:\n  {column}: time ?\n  {field}: {kind}\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation decide(doc: docs):\n  update docs[doc] {{{column}:now,{field}:{value}}}\nmutation finish(doc: docs):\n  update docs[doc] {{status:'done'}}\n");
        assert!(!notes(&source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{source}");
    }
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
