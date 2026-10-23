//! Wave-24: questions remain distinct from gates and replayed violations.
use snapback4_lang::{compile,security::{self,challenges::{self,Campaign}}};
fn bound(s:&str)->snapback4_lang::Bound{let b=compile(&[("schema.q".into(),s.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b}
fn notes(s:&str)->security::Report{let b=bound(s);let mut r=security::analyze_rules(&b);security::add_source_notes(&mut r,&[("schema.q".into(),s.into())],&b);r}
#[test]fn wave24_lifecycle_findings_have_questions_without_intent(){
 for (s,codes) in [
 (include_str!("security/wave24/007.q"),vec!["N_OPTIONAL_EVIDENCE"]),
 (include_str!("security/wave24/008.q"),vec!["N_CHILD_EVIDENCE_PRESENCE"]),
 (include_str!("security/wave24/011.q"),vec!["N_APPROVAL_NOT_ENFORCED"]),
 (include_str!("security/wave24/013.q"),vec!["N_STALE_CREATION_CHECK"]),
 (include_str!("security/wave24/015.q"),vec!["N_TIME_TRANSITION","N_GUARD_NOT_CONSUMED"]),
 (include_str!("security/wave24/029.q"),vec!["N_EDIT_AFTER_APPROVAL"]),
 (include_str!("security/wave24/031.q"),vec!["N_DEPENDENT_WINDOW"]),
 (include_str!("security/wave24/033.q"),vec!["N_CHILD_EVIDENCE_PRESENCE"]),
 (include_str!("security/wave24/036.q"),vec!["N_EDIT_AFTER_APPROVAL"]),
 (include_str!("security/wave24/048.q"),vec!["N_CALENDAR_DURATION"]),
 ]{let s=s.lines().filter(|l|!l.starts_with("invariant ")).collect::<Vec<_>>().join("\n");let r=notes(&s);
 for code in codes{assert!(r.notes.iter().any(|n|n.code==code&&n.site.line>0),"missing {code}: {:?}",r.notes);}}
}
#[test]fn optional_presence_candidate_is_explicit_and_does_not_gate_without_intent(){
 let s=include_str!("security/wave24/007.q");let r=notes(s);
 assert!(!r.notes.iter().any(|n|n.code=="N_OPTIONAL_UPLOAD_CREATE"));
 assert!(r.notes.iter().any(|n|n.code=="N_OPTIONAL_EVIDENCE"&&n.rewrite.contains("invariant orders always .photo != null")));
 assert!(security::draft(&bound(s)).contains("invariant orders always .photo != null"));
 assert!(notes(&format!("{s}\ninvariant orders always .photo != null\n")).notes.iter().any(|n|n.code=="N_OPTIONAL_UPLOAD_CREATE"));
}
#[test]fn clock_and_cross_row_forms_are_evaluable_even_without_reachable_rows(){
 let s=include_str!("security/wave24/013.q").to_owned()+"\ninvariant fills.completeFill only .tank.visualAt > now - 365d\n";
 let b=bound(&s);let gaps=challenges::evaluation_gaps(&b);assert!(!gaps.iter().any(|s|s.contains("completeFill")),"{gaps:?}");
}
#[test]fn required_upload_creators_populate_generated_lifecycle_roots(){
 let s=include_str!("security/wave24/011.q").to_owned()+"\ninvariant jobs always not .needsFinishedRoom or .finishedRoomApproved or .status = 'quoted' or .status = 'accepted' or .status = 'survey' or .status = 'closed'\n";
 let b=bound(&s);let mut c=Campaign::default();challenges::generated_campaign(&b,&mut c,false);
 assert!(c.directed_peak_worlds<=16,"{}",c.directed_peak_worlds);
 assert!(c.directed_attempts>0,"{}",serde_json::to_string(&c).unwrap());
 assert!(c.violations.iter().any(|v|v.reachability.is_reachable()),"{}",serde_json::to_string(&c).unwrap());
}

#[test]fn creation_only_presence_intent_gates_without_claiming_permanent_presence(){
 let s=include_str!("security/wave24/007.q").to_owned()+"\ninvariant orders.insert only .photo != null\n";
 assert!(notes(&s).notes.iter().any(|n|n.code=="N_OPTIONAL_UPLOAD_CREATE"));
}
#[test]fn child_evidence_checks_bind_the_actual_parent_and_positive_existence(){
 let s="table jobs:\n  status:enum('draft','active') default 'draft'\n  read <- allow\n  update <- allow\n  online only\ntable photos:\n  job:jobs\n  photo:image <=10000\n  read <- allow\n  insert <- allow\n  online only\nmutation add(job:jobs,photo:image <=10000):\n  return insert photos {job,photo}\nmutation advance(job:jobs,other:jobs):\nGUARD  update jobs[job] {status:'active'}\n";
 for (guard,expected) in [("",true),("  require exists photos[job = job] else PHOTO\n",false),("  require exists photos[job = other] else PHOTO\n",true),("  require not exists photos[job = job] else PHOTO\n",true)]{
  let ns=notes(&s.replace("GUARD",guard));assert_eq!(ns.notes.iter().any(|n|n.code=="N_CHILD_EVIDENCE_PRESENCE"),expected,"{guard}: {:?}",ns.notes);
 }
}
#[test]fn overdue_clock_check_must_bind_the_transitioned_row(){
 let s="table bills:\n  dueAt:time\n  status:enum('pending','missed') default 'pending'\n  read <- allow\n  update <- allow\n  online only\nmutation miss(bill:bills,other:bills):\n  b=bills[bill] ! else MISSING\n  o=bills[other] ! else MISSING\nGUARD  update bills[bill] {status:'missed'}\n";
 for (guard,expected) in [("",true),("  require b.dueAt < now else EARLY\n",false),("  require o.dueAt < now else EARLY\n",true)]{assert_eq!(notes(&s.replace("GUARD",guard)).notes.iter().any(|n|n.code=="N_TIME_TRANSITION"),expected);}
}
#[test]fn supported_integer_arithmetic_is_not_reported_as_an_evaluation_gap(){
 let b=bound("table pairs:\n  x:int\n  y:int\n  read <- allow\n  insert <- allow\n  online only\ninvariant pairs always .x + 1 <= .y\n");
 assert!(challenges::evaluation_gaps(&b).is_empty());
}

#[test]fn unrelated_default_guard_cannot_suppress_approved_media_question(){
 let s="table docs:\n  stage:enum('draft','approved') default 'draft'\n  unrelated:bool default false\n  color:enum('red','blue') default 'red'\n  photo:image <=10000\n  read <- allow\n  update <- allow\n  online only\nmutation edit(doc:docs,photo:image <=10000):\n  row=docs[doc] ! else MISSING\nGUARD  update docs[doc] {photo}\n";
 for (guard,expected) in [("",true),("  require row.unrelated = false else NO\n",true),("  require row.color = 'red' else NO\n",true),("  require row.stage = 'draft' else NO\n",false)]{assert_eq!(notes(&s.replace("GUARD",guard)).notes.iter().any(|n|n.code=="N_EDIT_AFTER_APPROVAL"),expected);}
}
#[test]fn contextual_id_coercion_is_named_for_aggregate_intent(){
 let b=bound("table docs:\n  owner:principal\n  n:int\n  read <- allow\n  insert <- allow\n  online only\ninvariant docs always .owner = 'dev:alice' or .n + 1 > 3\n");
 assert!(challenges::evaluation_gaps(&b).iter().any(|g|g.contains("principal/id")));
}

#[test]fn child_creation_and_nullable_approval_times_do_not_erase_required_histories(){
 for (source,intent) in [
 (include_str!("security/wave24/008.q"),"invariant jobs always .status = 'estimate' or .status = 'lapsed' or exists jobPhotos[job = .id]"),
 (include_str!("security/wave24/036.q"),"invariant commissions.sketch update only exists roles[viewer, role = 'owner'] or .stage = 'blocks'"),
 ]{
  let s=format!("{source}\n{intent}\n");let b=bound(&s);let site=b.invariants.last().unwrap().site.to_string();let mut c=Campaign::default();challenges::generated_campaign(&b,&mut c,false);
  assert!(c.directed_peak_worlds<=16,"{}",c.directed_peak_worlds);
  assert!(c.violations.iter().any(|v|v.reachability.is_reachable()&&v.invariant_site==site),"{}",serde_json::to_string(&c).unwrap());
 }
}

#[test]fn grouping_does_not_promote_restatement_noise_ahead_of_evidence(){
 let mut report=notes("table docs:\n  owner:principal\n  read <- .owner = viewer\n  online only\n");report.notes.clear();
 report.notes.push(snapback4_lang::Diagnostic::new(&snapback4_lang::Site::new("schema.q",1,1),"N_INVARIANT_RESTATES_RULE","docs.read matches current enforcement","confirm specification"));
 report.notes.push(snapback4_lang::Diagnostic::new(&snapback4_lang::Site::new("schema.q",100,1),"N_OPTIONAL_EVIDENCE","photos.image may be omitted","declare presence intent"));
 let compact=security::questionnaire_notes(&report.notes);let group=compact.iter().find(|n|n.message.starts_with("docs:")).unwrap();assert_eq!(security::note_priority(&group.code),6);
 let text=report.action_text(10);assert!(text.find("N_OPTIONAL_EVIDENCE")<text.find("docs: confirm"),"{text}");
}
