//! Independent intent must catch a correctly-enforced but incorrect rule.
use snapback4_lang::{compile,security::{self,Status}};
fn bound(source:&str)->snapback4_lang::Bound{let b=compile(&[("policy.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b}
fn basic(rule:&str)->String{format!("table notes:\n  owner: principal\n  body: text 1..80\n  read <- {rule}\n  insert <- .owner = viewer\n  update <- .owner = viewer\n  online only\ninvariant notes.read only .owner = viewer\n")}
#[test]fn independent_policy_refutes_broad_read_and_fixed_rule_passes(){
    let b=bound(&basic("allow"));let mut r=security::analyze(&b);assert_eq!(r.invariants[0].status,Status::Unproved);
    let c=security::challenges::run(&b);assert!(!c.violations.is_empty(),"{c:?}");security::challenges::apply(&mut r,&c);assert_eq!(r.invariants[0].status,Status::Refuted);
    let b=bound(&basic(".owner = viewer"));assert_eq!(security::analyze(&b).invariants[0].direct_rule,Status::Proved);assert!(security::challenges::run(&b).violations.is_empty());
}
#[test]fn retained_assignment_does_not_prove_current_role(){
    let schema="table roles:\n  principal: principal\n  role: enum('inspector', 'owner')\n  unique principal\n  read <- .principal = viewer\n  insert <- viewer = 'service:ops'\n  update <- viewer = 'service:ops'\n  online only\ntable grants:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  insert <- viewer = 'service:ops'\n  online only\ntable reports:\n  body: text 1..80\n  read <- exists grants[viewer]\n  online only\ninvariant reports.read only exists roles[viewer, role = 'inspector']\n";
    let b=bound(schema);let c=security::challenges::run(&b);assert!(!c.violations.is_empty(),"{c:?}");
    let b=bound(&schema.replace("read <- exists grants[viewer]","read <- exists grants[viewer] and exists roles[viewer, role = 'inspector']"));assert_eq!(security::analyze(&b).invariants[0].direct_rule,Status::Proved);assert!(security::challenges::run(&b).violations.is_empty());
}
#[test]fn raw_probe_observation_and_offline_snapshot_are_explicit_blockers(){
    let source=basic(".owner = viewer").replace("  online only","  sync to .owner");let b=bound(&source);let r=security::analyze(&b);assert_eq!(r.invariants[0].status,Status::Unproved);assert!(r.invariants[0].reasons.iter().any(|r|r.contains("device")));
    let source=format!("{}\ntable flags:\n  note: notes\n  read <- exists notes[.note]\n  online only\n",basic(".owner = viewer"));let b=bound(&source);assert!(security::analyze(&b).invariants[0].reasons.iter().any(|r|r.contains("raw rule")));
}
#[test]fn owned_field_bypass_and_cascades_cannot_be_proved_from_denied_rules(){
    let b=bound("table accounts:\n  principal: principal\n  role: text <=40 default 'member' written by .principal\n  read <- .principal = viewer\n  insert <- .principal = viewer\n  online only\ninvariant accounts.role write only viewer = 'service:ops'\n");let r=security::analyze(&b);assert_eq!(r.invariants[0].status,Status::Unproved);assert!(r.invariants[0].reasons.iter().any(|r|r.contains("owned-field")));
    let b=bound("table roots:\n  public 'root'\n  delete <- allow\n  online only\ntable children:\n  root: roots on delete cascade\n  cap 2 by root\n  owner: principal\n  read <- .owner = viewer\n  delete <- .owner = viewer\n  online only\ninvariant children.delete only .owner = viewer\n");assert!(security::analyze(&b).invariants[0].reasons.iter().any(|r|r.contains("cascade")));
}
#[test]fn unsupported_policy_is_named_and_misspelled_target_refuses(){
    let b=bound(&format!("{}invariant notes always now > 0\n",basic(".owner = viewer")));assert_eq!(security::analyze(&b).invariants[1].status,Status::Unproved);assert!(b.invariants[1].unsupported.is_some());
    let b=compile(&[("x.q".into(),"invariant missing.read only allow\n".into())]);assert!(b.diagnostics.iter().any(|d|d.code=="E_SECURITY_TARGET"));
}
#[test]fn row_media_integrity_is_a_type_theorem_only_when_required(){
    let src="table photos:\n  image: image <=5000\n  read <- allow\n  online only\ninvariant photos always .image != null\n";
    let b=bound(src);assert_eq!(security::analyze(&b).invariants[0].status,Status::Proved);
    let b=bound(&src.replace("image <=5000","image <=5000 ?"));assert_eq!(security::analyze(&b).invariants[0].status,Status::Unproved);
}

#[test]fn required_json_is_not_a_nonnull_type_and_parent_restrict_is_an_observation(){
 let b=bound("table docs:\n  payload: json <=100\n  photo: image <=5000\n  read <- allow\n  online only\ninvariant docs always .payload != null\n");assert_eq!(security::analyze(&b).invariants[0].status,Status::Unproved);
 let b=bound("table roots:\n  public 'root'\n  delete <- allow\n  online only\ntable children:\n  root: roots\n  owner: principal\n  read <- .owner = viewer\n  online only\ninvariant children.read only .owner = viewer\n");assert!(security::analyze(&b).invariants[0].reasons.iter().any(|r|r.contains("referential refusal")));
}
#[test]fn later_demotion_cannot_falsely_refute_earlier_authority(){
 let b=bound("table roles:\n  principal: principal\n  role: enum('owner', 'member')\n  unique principal\n  read <- .principal = viewer\n  update <- .principal = viewer\n  online only\ntable notes:\n  body: text 1..40\n  read <- allow\n  update <- exists roles[viewer, role = 'owner']\n  online only\nmutation perform(note: notes):\n  require exists roles[viewer, role = 'owner'] else NO_ROLE\n  update notes[note] { body: 'changed' }\n  update roles[viewer] { role: 'member' }\n  return null\ninvariant notes.perform only exists roles[viewer, role = 'owner']\n");assert_eq!(security::analyze(&b).invariants[0].status,Status::Unproved);assert!(security::challenges::run(&b).violations.is_empty());
}

#[test]fn insert_and_upsert_observations_do_not_get_a_payload_only_proof(){let b=bound(&basic(".owner = viewer"));let report=security::analyze(&b);assert_eq!(report.invariants[0].status,Status::Unproved);assert!(report.invariants[0].reasons.iter().any(|r|r.contains("collision")));}

#[test]fn insertion_negative_probe_uses_the_same_admission_snapshot(){
 let b=bound("table notes:\n  body: text 1..80\n  read <- allow\n  insert <- not exists notes[.id]\n  online only\ninvariant notes.insert only not exists notes[.id]\n");assert!(security::challenges::run(&b).violations.is_empty());
}
#[test]fn maintained_targets_cannot_prove_denied_implicit_writes(){
 let b=bound("table posts:\n  author: principal\n  read <- .author = viewer\n  insert <- .author = viewer\n  online only\nview totals: count posts by .author\n  read <- .author = viewer\n  online only\ninvariant totals.insert only deny\ninvariant totals.update only deny\ninvariant totals.delete only deny\n");assert!(security::analyze(&b).invariants.iter().all(|v|v.status==Status::Unproved));
}

#[test]fn evidence_advice_includes_omitted_columns_and_empty_lists(){
 let b=bound("table reports:\n  photo: image <=5000 ?\n  proofs: [image <=5000] <=4\n  read <- allow\n  online only\n");let r=security::analyze(&b);
 assert_eq!(r.notes.iter().filter(|n|n.code=="N_OPTIONAL_EVIDENCE").count(),2);
 assert!(r.exposures[0].paths.iter().any(|p|p.contains("asset read")));
 let b=bound("table reports:\n  photo: image <=5000\n  proofs: [image <=5000] 1..4\n  read <- allow\n  online only\n");assert!(!security::analyze(&b).notes.iter().any(|n|n.code=="N_OPTIONAL_EVIDENCE"));
}
#[test]fn bakeoff_security_advice_names_global_bootstrap_and_existence_oracle(){
 let source=include_str!("security/wave16/021.q");let b=bound(source);
 assert!(security::analyze(&b).notes.iter().any(|n|n.code=="N_VACUOUS_RULE"));
 let src="table notes:\n  owner: principal\n  read <- allow\n  online only\nmutation edit(note: notes):\n  n = notes[note] ! else NOT_FOUND\n  require n.owner = viewer else FORBIDDEN\n  return null\n";let b=bound(src);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("schema.q".into(),src.into())],&b);assert!(r.notes.iter().any(|n|n.code=="N_EXISTENCE_ORACLE"));
}

#[test]fn argument_grants_and_retained_role_grants_receive_advice(){
 let src="table notes:\n  owner: principal\n  read <- .owner = viewer\n  insert <- allow\n  online only\nmutation assign(owner: principal):\n  return insert notes { owner }\n";let b=bound(src);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("schema.q".into(),src.into())],&b);assert!(r.notes.iter().any(|n|n.code=="N_ARGUMENT_GRANT"));
 let b=bound(include_str!("security/wave16/019.q"));assert!(security::analyze(&b).notes.iter().any(|n|n.code=="N_GRANT_OUTLIVES_ROLE"));
}

#[test]fn sibling_column_edits_and_upsert_insert_arms_do_not_refute_other_effects(){
 let b=bound("table notes:\n  frozen: text <=80\n  body: text <=80\n  immutable frozen\n  read <- allow\n  update <- allow\n  online only\nmutation edit(note: notes):\n  update notes[note] { body: 'changed' }\n  return null\ninvariant notes.frozen write only deny\n");assert!(security::challenges::run(&b).violations.is_empty());
 let b=bound("table notes:\n  key: text <=80\n  body: text <=80\n  unique key\n  read <- allow\n  insert <- allow\n  online only\nmutation put(key: text <=80):\n  return upsert notes[key] { key, body: 'changed' }\ninvariant notes.update only deny\n");assert!(security::challenges::run(&b).violations.is_empty());
}

#[test]fn delete_reinsert_and_contextual_probe_literals_cannot_falsely_refute(){
 let b=bound("table notes:\n  body: text <=80\n  read <- allow\n  insert <- allow\n  delete <- allow\n  online only\nmutation replace(note: notes):\n  delete notes[note]\n  upsert notes[note] { body: 'changed' }\n  return null\ninvariant notes.update only deny\n");assert!(security::challenges::run(&b).violations.is_empty());
 let b=bound("table roles:\n  name: text <=80\n  read <- allow\n  online only\ntable docs:\n  n: int 1..10\n  read <- allow\n  online only\ninvariant docs always .n > 0 and exists roles[id = 'security-roles']\n");assert!(security::challenges::run(&b).violations.is_empty());
}
