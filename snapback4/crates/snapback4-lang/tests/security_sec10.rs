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
#[test]fn atomic_approval_audits_and_checked_stage_proxies_do_not_gate(){
    assert!(!notes(include_str!("security/wave26/008.q")).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let source="table docs:\n  approvedAt: time ?\n  status: enum('draft','approved','done') default 'draft'\n  read <- allow\n  update <- allow\n  online only\nmutation approve(doc: docs):\n  update docs[doc] {approvedAt:now,status:'approved'}\nmutation finish(doc: docs):\n  d = docs[doc] ! else NOT_FOUND\n  require d.status = 'approved' else NO_APPROVAL\n  update docs[doc] {status:'done'}\n";
    assert!(!notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
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
