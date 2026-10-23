//! Structural candidate origin, concrete evaluation and exact asymmetry gates.
// @ref LLP 3000.036.004.000#4-asymmetry-and-presentation — an implication failure is a review, never a concrete hole.
use snapback4_lang::{compile,security::{self,challenges::{self,Campaign}}};
fn bound(s:&str)->snapback4_lang::Bound{let b=compile(&[("schema.q".into(),s.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b}
fn report(s:&str)->security::Report{let b=bound(s);let mut r=security::analyze_rules(&b);security::add_source_notes(&mut r,&[("schema.q".into(),s.into())],&b);r}
const ASYMMETRY:&str="table records:\n  owner: principal\n  value: text ?\n  read <- allow\n  insert <- allow\n  update (old, next) <- old.value = next.value or viewer = 'service:desk'\n  online only\nmutation create(owner: principal, value: text ?):\n  return insert records { owner, value }\n";
#[test]fn table_changed_column_guard_gates_until_creation_difference_is_explicit(){
 assert!(report(ASYMMETRY).notes.iter().any(|n|n.code=="N_CREATE_EDIT_ASYMMETRY"));
 let intentional=format!("{ASYMMETRY}\ninvariant records.value update only viewer = 'service:desk'\n");
 assert!(!report(&intentional).notes.iter().any(|n|n.code=="N_CREATE_EDIT_ASYMMETRY"));
 let enforced=ASYMMETRY.replace("value: text ?\n","value: text ? write <- viewer = 'service:desk'\n");
 assert!(!report(&enforced).notes.iter().any(|n|n.code=="N_CREATE_EDIT_ASYMMETRY"));
}
#[test]fn creator_subset_with_unrelated_conjunct_does_not_gate(){
 let s=ASYMMETRY.replace("insert <- allow","insert <- viewer = 'service:desk' and .owner = viewer").replace("or viewer = 'service:desk'","or viewer = 'service:desk' or viewer = 'service:manager'");
 assert!(!report(&s).notes.iter().any(|n|n.code=="N_CREATE_EDIT_ASYMMETRY"));
}
#[test]fn row_dependent_change_audiences_gate_only_a_wider_creator(){
 let wider=ASYMMETRY.replace("viewer = 'service:desk'","old.owner = viewer");
 assert!(report(&wider).notes.iter().any(|n|n.code=="N_CREATE_EDIT_ASYMMETRY"));
 let own=wider.replace("insert records { owner, value }","insert records { owner: viewer, value }");
 assert!(!report(&own).notes.iter().any(|n|n.code=="N_CREATE_EDIT_ASYMMETRY"));
 let sources=vec![("schema.q".into(),wider.clone())];
 assert!(!security::derived::invariants(&sources,&bound(&wider)).is_empty());
}
#[test]fn non_null_creation_is_derived_without_specification_intent(){
 let sources=vec![("schema.q".into(),ASYMMETRY.into())];let b=security::derived::augmented(&sources,&bound(ASYMMETRY));
 assert!(!b.invariants.is_empty());assert!(b.invariants.iter().all(security::derived::is_derived));
 let mut c=Campaign::default();challenges::generated_campaign(&b,&mut c,false);
 assert!(c.violations.iter().any(|v|v.reachability.is_reachable()&&v.row.field("value").is_ok_and(|v|*v!=snapback4_core::Value::Null)),"{}",serde_json::to_string(&c).unwrap());
}
#[test]fn clock_cross_row_and_read_through_forms_have_no_syntactic_gap(){
 for (fixture,line) in [
  (include_str!("security/wave24/013.q"),"invariant fills.completeFill only .tank.visualAt > now - 365d"),
  (include_str!("security/wave24/031.q"),"invariant services.insert only .restaurant.nextDueAt = null or .dueAt <= .restaurant.nextDueAt"),
  (include_str!("security/wave24/033.q"),"invariant jobs always exists surfaces[job = .id]"),
 ]{
  let s=format!("{fixture}\n{line}\n");let b=bound(&s);let site=b.invariants.last().unwrap().site.to_string();
  assert!(!challenges::evaluation_gaps(&b).iter().any(|s|s.contains(&site)),"{:?}",challenges::evaluation_gaps(&b));
 }
}

#[test]fn default_only_and_unconditionally_immutable_values_are_not_derived_creation_authority(){
 for s in [ASYMMETRY.replace("  owner: principal", "  immutable value\n  owner: principal"),ASYMMETRY.replace("value: text ?", "value: text ? default 'initial'").replace("insert records { owner, value }","insert records { owner }")] {
  let sources=vec![("schema.q".into(),s.clone())];assert!(security::derived::invariants(&sources,&bound(&s)).is_empty());
 }
}

#[test]fn unrelated_unchanged_fields_do_not_widen_a_creation_audience(){
 let s="table docs:\n  fee: text\n  stage: enum('new','done')\n  score: int ?\n  read <- allow\n  insert <- viewer = 'service:registrar'\n  update (old,next) <- (viewer = 'service:teacher' and old.fee = next.fee) or (viewer = 'service:registrar' and old.stage = next.stage and old.score = next.score)\n  online only\nmutation create(fee: text):\n  return insert docs {fee,stage:'new'}\n";
 assert!(!report(s).notes.iter().any(|n|n.code=="N_CREATE_EDIT_ASYMMETRY"));
}

#[test]fn inspected_payload_has_an_approve_then_edit_witness_without_spec_intent(){
 let source="table docs:\n  value: text ?\n  approved: bool default false\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation add(value: text ?):\n  return insert docs {value}\nmutation approve(doc: docs):\n  row = docs[doc] ! else NOT_FOUND\n  require row.value != null else MISSING\n  update docs[doc] {approved:true}\nmutation edit(doc: docs,value: text ?):\n  update docs[doc] {value}\n";
 let sources=vec![("schema.q".into(),source.into())];let b=security::derived::augmented(&sources,&bound(source));
 assert!(b.invariants.iter().any(|i|security::derived::is_derived(i)&&i.column.as_deref()==Some("value")&&i.target=="update"));
 let mut c=Campaign::default();challenges::generated_campaign(&b,&mut c,false);
 assert!(c.violations.iter().any(|v|v.reachability.is_reachable()&&v.history.iter().any(|s|s.operation=="approve")&&v.history.last().is_some_and(|s|s.operation=="edit")),"{}",serde_json::to_string(&c).unwrap());
}

#[test]fn edits_that_invalidate_approval_do_not_refute_derived_retained_approval_intent(){
 let source="table docs:\n  value: text ?\n  approved: bool default false\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation add(value: text ?):\n  return insert docs {value}\nmutation approve(doc: docs):\n  row = docs[doc] ! else NOT_FOUND\n  require row.value != null else MISSING\n  update docs[doc] {approved:true}\nmutation edit(doc: docs,value: text ?):\n  update docs[doc] {value,approved:false}\n";
 let sources=vec![("schema.q".into(),source.into())];let b=security::derived::augmented(&sources,&bound(source));assert!(b.invariants.iter().any(|i|security::derived::is_derived(i)&&i.column.as_deref()==Some("value")));let mut c=Campaign::default();challenges::generated_campaign(&b,&mut c,false);
 assert!(!c.violations.iter().any(|v|v.reachability.is_reachable()),"{}",serde_json::to_string(&c).unwrap());assert!(c.operations.get("edit").copied().unwrap_or(0)>0);
}
