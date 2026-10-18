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

#[test]
fn aggregate_policy_dependency_cannot_be_changed_before_paired_disclosure(){
 let b=bound("table roles:\n  principal: principal\n  enabled: bool\n  unique principal\n  read <- allow\n  update <- allow\n  online only\ntable secrets:\n  body: text <=20\n  read <- exists roles[viewer, enabled = true]\n  online only\nmutation enableAndRead():\n  update roles[viewer] { enabled: true }\n  return secrets['security-secrets']\ninvariant secrets.read only count(roles[principal = viewer, enabled = true]) = 1\n");
 let c=security::challenges::run(&b);
 assert!(c.violations.is_empty(),"{c:?}");
 assert!(c.unsupported.iter().any(|s|s.contains("complete bound policy dependencies")));
}

#[test]
fn recorded_reference_group_keys_do_not_alias_source_fields_in_a_proof(){
 let b=bound("table authors:\n  label: principal\n  immutable label\n  public 'authors'\n  online only\ntable notes:\n  author: authors\n  label: principal\n  immutable author\n  read <- .label = viewer\n  online only\nview totals: count notes by .author.label\n  read <- allow\n  online only\ninvariant notes.read only .label = viewer\n");
 let r=security::analyze(&b);
 assert!(r.invariants[0].obligations.iter().any(|o|o.status==Status::Unproved&&o.reason.contains("bare identically typed")),"{r:?}");
}

#[test]
fn excluded_resource_refusals_never_become_logical_privacy_counterexamples(){
 let b=bound("table secrets:\n  owner: principal\n  read <- .owner = viewer\n  online only\nmutation examine():\n  for n in range(0, 9000):\n    hidden = secrets['security-secrets']\n  return null\ninvariant secrets.read only .owner = viewer\n");
 let c=security::challenges::run(&b);
 assert!(c.violations.is_empty(),"{c:?}");
}

#[test]
fn update_proofs_include_both_images_and_only_collapse_immutable_fields(){
 let source="table notes:\n  owner: principal\n  body: text <=20\n  read <- .owner = viewer\n  update <- .owner = viewer\n  online only\ninvariant notes.update only .owner = viewer\n";
 for immutable in [false,true]{
  let src=if immutable{source.replace("  read <-","  immutable owner\n  read <-")}else{source.into()};
  let b=bound(&src);assert_eq!(security::analyze(&b).invariants[0].direct_rule,Status::Proved);
 }
 let b=bound("table notes:\n  owner: principal\n  read <- allow\n  update (old, next) <- next.owner = viewer\n  online only\ninvariant notes.update only .owner = viewer\n");
 assert_eq!(security::analyze(&b).invariants[0].direct_rule,Status::Unproved,"next-image authority cannot establish the old owner");
}

#[test]
fn synthetic_update_witness_records_the_committed_next_image_and_patch(){
 let b=bound("table bookings:\n  owner: principal\n  status: enum('booked', 'override')\n  immutable owner\n  read <- .owner = viewer\n  update (old, next) <- old.owner = viewer and next.owner = viewer and next.status != 'override'\n  online only\ninvariant bookings.status write only .status != 'override'\n");
 let c=security::challenges::run(&b);
 let v=c.violations.iter().find(|v|v.effect=="update").expect("strong both-image policy is false on the old override image");
 assert_eq!(v.old.as_ref().unwrap().field("status").unwrap(),&snapback4_core::Value::String("override".into()));
 assert_eq!(v.row.field("status").unwrap(),&snapback4_core::Value::String("booked".into()));
 assert_ne!(v.old.as_ref(),Some(&v.row));
 assert!(v.args.contains_key("$syntheticPatch"));
}

#[test]
fn paired_pruning_keeps_maintained_column_owning_tables(){
 let b=bound("table posts:\n  likeCount: count likes\n  public 'public totals'\n  online only\ntable likes:\n  post: posts\n  owner: principal\n  read <- .owner = viewer\n  online only\nquery total(post: posts):\n  return posts[post].likeCount\ninvariant likes.read only .owner = viewer\n");
 let c=security::challenges::run(&b);
 assert!(c.violations.iter().any(|v|v.observations.is_some()),"{c:?}");
}

#[test]
fn invalid_paired_final_exists_fixtures_remain_unsupported_per_observer(){
    let b=bound("table conversations:\n  creator: principal\n  after insert <- exists members[conversation = .id, principal = .creator]\n  online only\ntable members:\n  conversation: conversations\n  principal: principal\n  unique conversation, principal\n  online only\ntable aliases:\n  owner: principal\n  conversation: conversations\n  read <- .owner = viewer\n  online only\nquery first(alias: aliases):\n  return aliases[alias]\nquery second(alias: aliases):\n  return aliases[alias]\ninvariant aliases.read only .owner = viewer\n");
    let c=security::challenges::run(&b);
    assert!(c.violations.is_empty(),"{c:?}");
    for name in ["policy.first","policy.second"]{assert!(c.unsupported.iter().any(|reason|reason.starts_with(&format!("{name}: conversations:"))&&reason.ends_with("trusted seed did not establish final-exists constraint")),"{c:?}");}
}
