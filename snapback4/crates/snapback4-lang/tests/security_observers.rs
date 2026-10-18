//! Observer proofs and executed counterexamples, including negative controls.
use snapback4_lang::{compile,security::{self,Status}};
fn bound(source:&str)->snapback4_lang::Bound {
    let b=compile(&[("policy.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b
}
fn aggregate(rule:&str,kind:&str)->String {let kind=if kind=="sum"{"sum notes of .amount"}else{"count notes"};format!("table notes:\n  owner: principal\n  amount: int\n  read <- .owner = viewer\n  online only\nview totals: {kind} by .owner\n  read <- {rule}\n  online only\nquery total(owner: principal):\n  return totals[owner]\ninvariant notes.read only .owner = viewer\n")}
#[test]
fn maintained_count_and_sum_preserve_or_expose_source_privacy(){
    for kind in ["count","sum"] {
        let b=bound(&aggregate(".owner = viewer",kind));
        let r=security::analyze(&b);
        assert!(r.invariants[0].obligations.iter().all(|o|o.status==Status::Proved),"{r:?}");
        assert!(security::challenges::run(&b).violations.is_empty());
        let b=bound(&aggregate("allow",kind));
        let r=security::analyze(&b);
        assert!(r.invariants[0].obligations.iter().any(|o|o.status==Status::Unproved));
        let c=security::challenges::run(&b);
        assert!(c.violations.iter().any(|v|v.observations.is_some()),"{c:?}");
    }
}
#[test]
fn lifetime_components_prove_exact_boundaries_with_nullable_edges(){
    for optional in ["", " ?"] {
        let lower=if optional.is_empty(){"now >= .opensAt"}else{".opensAt = null or now >= .opensAt"};
        let upper=if optional.is_empty(){"now < .endsAt"}else{".endsAt = null or now < .endsAt"};
        let b=bound(&format!("table bookings:\n  opensAt: time{optional}\n  endsAt: time{optional}\n  not before .opensAt\n  expire at .endsAt\n  read <- allow\n  online only\ninvariant bookings.read only ({lower}) and ({upper})\n"));
        let r=security::analyze(&b);
        assert_eq!(r.invariants[0].direct_rule,Status::Proved,"{r:?}");
        assert!(r.invariants[0].obligations.iter().all(|o|o.status==Status::Proved));
        // Global activity remains separately unproved; this is a component law.
        assert_eq!(r.invariants[0].status,Status::Unproved);
        let late=bound("table bookings:\n  opensAt: time\n  read <- allow\n  online only\ninvariant bookings.read only now >= .opensAt\n");
        assert_eq!(security::analyze(&late).invariants[0].direct_rule,Status::Unproved);
        assert!(!security::challenges::run(&late).violations.is_empty(),"an actual pre-publication read refutes the missing lifetime gate");
    }
}
#[test]
fn project_note_draft_and_uncovered_effects_are_independent(){
    let b=bound("table notes:\n  owner: principal\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\ntable publicNotes:\n  public 'published notes'\n  online only\n");
    let r=security::analyze(&b);
    assert_eq!(r.notes.iter().filter(|n|n.code=="N_SECURITY_INTENT").count(),1);
    assert!(r.notes.iter().any(|n|n.message.contains("2 tables have access rules")));
    let draft=security::draft(&b);assert!(draft.contains("DRAFT: NOT ACCEPTED"));
    assert!(draft.contains("invariant notes.read only .owner = viewer"));
    let b=bound(&format!("{}\ninvariant notes.read only .owner = viewer\n", "table notes:\n  owner: principal\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\n"));
    let r=security::analyze(&b);
    assert!(r.uncovered.iter().any(|e|e.table=="notes"&&e.effect=="insert"));
    assert!(!r.uncovered.iter().any(|e|e.table=="notes"&&e.effect=="read"));
    assert!(r.text().ends_with("notes.insert: caller satisfying .owner = viewer; rows: .owner = viewer\n"));
}

#[test]
fn aggregate_integrity_refutation_uses_committed_validated_rows(){
 let b=bound("table rounds:\n  required: int\n  read <- allow\n  online only\ntable readings:\n  round: rounds\n  read <- allow\n  online only\ninvariant rounds always .required = count(readings[round = .id])\n");
 let c=security::challenges::run(&b);
 assert!(c.violations.is_empty(), "one reading and required=1 is consistent: {c:?}");
 let b=bound("table rounds:\n  required: int 2..4\n  read <- allow\n  online only\ntable readings:\n  round: rounds\n  read <- allow\n  online only\ninvariant rounds always .required = count(readings[round = .id])\n");
 let c=security::challenges::run(&b);
 assert!(!c.violations.is_empty(),"{c:?}");
 assert!(c.violations.iter().all(|v|v.scope.contains("seed_at commit/read-back")));
}
