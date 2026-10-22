use snapback4_lang::{compile,security::{self,Status}};

fn report(source:&str)->security::Report {
    let b=compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    security::analyze(&b)
}

#[test]
fn audit_leads_with_action_and_keeps_unproved_reasons_in_all_and_json(){
    let r=report("table notes:\n  owner: principal\n  body: text <=80\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\ninvariant notes.read only .owner = viewer\n");
    let text=r.text();let all=r.text_with_all(true);
    assert!(text.starts_with("security actions:"),"{text}");
    assert!(text.contains("REVIEW schema.q:")&&text.contains("N_INVARIANT_RESTATES_RULE"),"{text}");
    assert!(text.contains("proved,")&&text.contains("unproved"),"{text}");
    assert!(all.contains("security scope:")&&all.contains("exclusions:"),"{all}");
    for v in r.invariants.iter().filter(|v|v.status==Status::Unproved){
        for reason in &v.reasons {assert!(all.contains(reason),"missing {reason}: {all}");}
    }
    assert!(serde_json::to_value(&r).unwrap().get("exclusions").is_some());
}

#[test]
fn no_declared_intent_is_an_action_not_a_security_pass(){
    let r=report("table notes:\n  body: text <=80\n  read <- allow\n  online only\n");
    let text=r.action_text(5);
    assert!(text.contains("N_BROAD_READ")&&text.contains("from the spec"),"{text}");
    assert!(!text.contains("security passed")&&!text.contains("no security problems"),"{text}");
}

#[test]
fn review_limit_retains_every_escalation_and_names_remainder(){
    let mut r=report("table notes:\n  body: text <=80\n  read <- allow\n  online only\n");
    let base=r.notes[0].clone();r.notes.clear();
    for i in 0..7 {let mut n=base.clone();n.code=if i<3 {"N_SELF_CLAIMED_RELATIONSHIP"}else{"N_CALLER_TIME"}.into();n.message=format!("review operation {i}");r.notes.push(n);}
    for i in 0..4 {let mut n=base.clone();n.code="N_COLUMN_RESULT_EXPOSURE".into();n.message=format!("inventory {i}");r.notes.push(n);}
    let text=r.action_text(1);
    assert_eq!(text.matches("N_SELF_CLAIMED_RELATIONSHIP").count(),3,"{text}");
    assert_eq!(text.matches("N_CALLER_TIME").count(),4,"likely-hole questions survive the cap: {text}");
    assert!(!text.contains("N_COLUMN_RESULT_EXPOSURE"),"inventory stays behind actions: {text}");
    assert!(text.contains("4 more reviews"),"{text}");
}
