//! Committed conservation boundaries, including atomic order and aborted deletes.
use snapback4_lang::{compile,security::{self,challenges::{self,Campaign}}};
use snapback4_core::Engine;
const SOURCE:&str="table trips:\n  name: text\n  read <- allow\n  insert <- allow\n  online only\ntable participants:\n  trip: trips\n  person: principal\n  unique trip, person\n  immutable trip, person\n  read <- allow\n  insert <- allow\n  delete <- allow\n  online only\ntable ledger:\n  trip: trips\n  person: principal\n  paidCents: int\n  kind: enum('charge','refund')\n  unique trip, person, kind\n  immutable trip, person, paidCents, kind\n  read <- allow\n  insert <- allow\n  update <- deny\n  delete <- deny\n  online only\nmutation add(trip: trips,person: principal):\n  insert participants {trip,person}\n  return insert ledger {trip,person,paidCents:100,kind:'charge'}\nmutation refund(trip: trips,person: principal):\n  return insert ledger {trip,person,paidCents:100,kind:'refund'}\nmutation remove(entry: participants):\n  e = participants[entry] ! else MISSING\n  BEFORE\n  delete participants[entry]\n  AFTER\n";
fn replay(before:&str,after:&str,charge:bool)->Campaign{
 let source=SOURCE.replace("BEFORE",before).replace("AFTER",after);
 let sources=vec![("schema.q".into(),source)];let b=compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let mut b=security::derived::augmented(&sources,&b);b.invariants.retain(|i|i.site.file.contains("/participant-conservation/"));assert_eq!(b.invariants.len(),1);
 let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
 let row=|table:&str,value:serde_json::Value|snapback4_core::wire::row_from_json(&b.schema.tables[table],&value).unwrap();
 let mut rows=vec![("trips".into(),row("trips",serde_json::json!({"id":"trip","name":"Trip"}))),("participants".into(),row("participants",serde_json::json!({"id":"entry","trip":"trip","person":"dev:hiker"})))];
 if charge{rows.push(("ledger".into(),row("ledger",serde_json::json!({"id":"charge","trip":"trip","person":"dev:hiker","paidCents":100,"kind":"charge"}))));}
 engine.seed_at(rows,challenges::NOW).unwrap();
 let mut out=Campaign::work_bounded(1024);challenges::fixture_observers(&b,&engine,&mut out);out
}
fn bad(out:&Campaign)->bool{out.violations.iter().any(|v|v.operation=="remove"&&v.reachability.is_reachable())}
#[test]fn removal_without_full_matching_refund_is_refuted(){
 assert!(bad(&replay("","",true)));
 assert!(bad(&replay("insert ledger {trip:e.trip,person:e.person,paidCents:1,kind:'refund'}","",true)));
 assert!(bad(&replay("insert ledger {trip:e.trip,person:'dev:other',paidCents:100,kind:'refund'}","",true)));
}
#[test]fn atomic_refund_before_or_after_removal_and_uncharged_removal_are_allowed(){
 let refund="insert ledger {trip:e.trip,person:e.person,paidCents:100,kind:'refund'}";
 assert!(!bad(&replay(refund,"",true)));
 assert!(!bad(&replay("",refund,true)));
 let uncharged=replay("","",false);assert!(!uncharged.violations.iter().any(|v|v.operation=="remove"&&!v.history.iter().any(|step|step.operation=="add")));
}
#[test]fn aborted_removal_is_never_a_committed_refutation(){
 assert!(!bad(&replay("","require false else ABORTED",true)));
}
#[test]fn exclusive_birth_branches_do_not_establish_cocreation(){
 let source=SOURCE.replace("mutation add(trip: trips,person: principal):\n  insert participants {trip,person}\n  return insert ledger {trip,person,paidCents:100,kind:'charge'}","mutation add(trip: trips,person: principal,flag: bool):\n  if flag:\n    insert participants {trip,person}\n    return null\n  else:\n    insert ledger {trip,person,paidCents:100,kind:'charge'}\n    return null").replace("BEFORE","").replace("AFTER","");
 let sources=vec![("schema.q".into(),source)];let b=compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 assert!(!security::derived::invariants(&sources,&b).iter().any(|i|i.site.file.contains("/participant-conservation/")));
}


#[test]fn mutable_reads_are_not_shared_captured_identity(){
 let slots="table slots:\n  person: principal\n  read <- allow\n  update <- allow\n  online only\n";
 for captured in [false,true]{
  let person=if captured{"a.person"}else{"b.person"};
  let birth=format!("mutation add(trip: trips,slot: slots):\n  a = slots[slot] ! else MISSING\n  insert participants {{trip,person:a.person}}\n  update slots[slot] {{person:'dev:other'}}\n  b = slots[slot] ! else MISSING\n  return insert ledger {{trip,person:{person},paidCents:100,kind:'charge'}}");
  let original="mutation add(trip: trips,person: principal):\n  insert participants {trip,person}\n  return insert ledger {trip,person,paidCents:100,kind:'charge'}";
  let source=slots.to_owned()+&SOURCE.replace(original,&birth).replace("BEFORE","").replace("AFTER","");
  let sources=vec![("schema.q".into(),source)];let b=compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
  let found=security::derived::invariants(&sources,&b).iter().any(|i|i.site.file.contains("/participant-conservation/"));
  assert_eq!(found,captured,"captured={captured}");
  if !captured{assert!(security::source_inference_gaps(&sources,&b).iter().any(|gap|gap.contains("participant conservation not covered")));}
 }
}
#[test]fn ambiguous_numeric_amounts_report_conservation_coverage(){
 let source=SOURCE.replace("  paidCents: int","  receiptNo: int default 0\n  paidCents: int").replace("BEFORE","").replace("AFTER","");
 let sources=vec![("schema.q".into(),source)];let b=compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 assert!(!security::derived::invariants(&sources,&b).iter().any(|i|i.site.file.contains("/participant-conservation/")));
 assert!(security::source_inference_gaps(&sources,&b).iter().any(|gap|gap.contains("participant conservation not covered")));
}
