//! Derived-first search retains the independent authored-reference history phase.
// @ref LLP 3000.036.004.000#11-wave-27-precision-and-workflow-conservation — phase-local directed ceilings share the outer work budget.
use snapback4_lang::{compile,security};
#[test]
fn derived_replay_does_not_spend_authored_reference_history_ceiling(){
 // Keep the authored weight/history obligation unchanged. Its explicit edit
 // intent now answers that field's inferred freeze, so the derived-first phase
 // gets a separate checked approval input whose edit intent is not declared.
 let base=include_str!("security/wave24/029.q");let marker="  update bookings[b.id] { approved: true";assert!(base.contains(marker));
 let independent=base.replace(marker,"  require b.guestName != 'unverified' else UNVERIFIED_GUEST\n  update bookings[b.id] { approved: true");
 let source=format!("{independent}\ninvariant bookings.weight update only .tour.status = 'booked'\n");
 let sources=vec![("schema.q".into(),source)];let bound=compile(&sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
 let bound=security::derived::augmented(&sources,&bound);
 assert!(bound.invariants.iter().any(|i|security::derived::is_derived(i)&&i.table=="bookings"&&i.column.as_deref()==Some("guestName")),"the separate approval-input freeze must commission the derived-first phase");
 let site=bound.invariants.iter().find(|i|!security::derived::is_derived(i)&&i.table=="bookings"&&i.column.as_deref()==Some("weight")&&i.target=="update").unwrap().site.to_string();
 let mut out=security::challenges::Campaign::default();security::challenges::generated_campaign(&bound,&mut out,false);
 assert!(out.violations.iter().any(|v|v.invariant_site==site&&v.operation=="updateBooking"&&v.reachability.is_reachable()),"directed={}; violations={:?}",out.directed_attempts,out.violations.iter().map(|v|(&v.operation,&v.invariant_site)).collect::<Vec<_>>());
}
