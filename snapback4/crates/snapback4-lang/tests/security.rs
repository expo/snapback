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
 let src="table notes:\n  owner: principal\n  read <- allow\n  online only\nmutation edit(note: notes):\n  n = notes[note] ! else NOT_FOUND\n  require n.owner = viewer else FORBIDDEN\n  return null\n";let b=bound(src);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("schema.q".into(),src.into())],&b);assert!(!r.notes.iter().any(|n|n.code=="N_EXISTENCE_ORACLE"),"public rows have no private existence boundary");
}

#[test]fn argument_grants_and_retained_role_grants_receive_advice(){
 let src="table notes:\n  owner: principal\n  read <- .owner = viewer\n  insert <- allow\n  online only\nmutation assign(owner: principal):\n  return insert notes { owner }\n";let b=bound(src);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("schema.q".into(),src.into())],&b);assert!(r.notes.iter().any(|n|n.code=="N_ARGUMENT_GRANT"));
 let source=include_str!("security/wave16/019.q");let b=bound(source);assert!(!security::analyze(&b).notes.iter().any(|n|n.code=="N_GRANT_OUTLIVES_ROLE"));
 let b=bound(&format!("{source}\ninvariant inspections.insert only exists roles[viewer, role = 'inspector']\n"));assert!(security::analyze(&b).notes.iter().any(|n|n.code=="N_GRANT_OUTLIVES_ROLE"));
}

#[test]fn sibling_column_edits_and_upsert_insert_arms_do_not_refute_other_effects(){
 let b=bound("table notes:\n  frozen: text <=80\n  body: text <=80\n  immutable frozen\n  read <- allow\n  update <- allow\n  online only\nmutation edit(note: notes):\n  update notes[note] { body: 'changed' }\n  return null\ninvariant notes.frozen write only deny\n");assert!(security::challenges::run(&b).violations.is_empty());
 let b=bound("table notes:\n  key: text <=80\n  body: text <=80\n  unique key\n  read <- allow\n  insert <- allow\n  online only\nmutation put(key: text <=80):\n  return upsert notes[key] { key, body: 'changed' }\ninvariant notes.update only deny\n");assert!(security::challenges::run(&b).violations.is_empty());
}

#[test]fn delete_reinsert_and_contextual_probe_literals_cannot_falsely_refute(){
 let b=bound("table notes:\n  body: text <=80\n  read <- allow\n  insert <- allow\n  delete <- allow\n  online only\nmutation replace(note: notes):\n  delete notes[note]\n  upsert notes[note] { body: 'changed' }\n  return null\ninvariant notes.update only deny\n");assert!(security::challenges::run(&b).violations.is_empty());
 let b=bound("table roles:\n  name: text <=80\n  read <- allow\n  online only\ntable docs:\n  n: int 1..10\n  read <- allow\n  online only\ninvariant docs always .n > 0 and exists roles[id = 'security-roles']\n");assert!(security::challenges::run(&b).violations.is_empty());
}

#[test]
fn column_read_uses_read_authority_and_authored_projection_observers(){
    let src="table notes:\n  owner: principal\n  body: text 1..80\n  read <- allow\n  online only\ninvariant notes.body read only .owner = viewer\nquery inspect(note: notes):\n  n = notes[note] ! else NOT_FOUND\n  return n.body\n";
    let b=bound(src);assert_eq!(b.invariants[0].column.as_deref(),Some("body"));
    assert_ne!(security::analyze(&b).invariants[0].direct_rule,Status::Proved,"denied delete cannot prove a column read");
    let c=security::challenges::run(&b);assert!(c.violations.iter().any(|v|v.effect=="column read observation"),"{c:?}");
    let safe=bound(&src.replace("return n.body","return { owner: n.owner }"));
    assert!(security::challenges::run(&safe).violations.is_empty(),"projection excluding protected value is not a whole-row disclosure");
    let audit=security::analyze(&b);assert!(audit.exposures[0].column_audiences.contains_key("body"));
}
#[test]
fn column_private_owner_is_part_of_the_payload_theorem(){
    let b=bound("table notes:\n  owner: principal\n  body: text <=80 default '' written by .owner\n  read <- allow\n  insert <- .owner = viewer\n  online only\ninvariant notes.body read only .owner = viewer\n");
    assert_eq!(security::analyze(&b).invariants[0].direct_rule,Status::Proved);
}
#[test]
fn synthetic_refutation_is_visible_but_does_not_fail_acceptance(){
    let b=bound(&basic("allow"));let mut r=security::analyze(&b);let c=security::challenges::run(&b);
    security::challenges::apply(&mut r,&c);assert_eq!(r.invariants[0].status,Status::Refuted);assert!(!r.refuted());
    assert!(r.text().contains("non-failing"));assert!(r.text_with_all(true).contains("counterexample"));
}
#[test]
fn printed_nested_connectives_preserve_the_policy(){
    let src=basic(".owner = viewer and (viewer = 'service:one' or viewer = 'service:two')");
    let b=bound(&src);let printed=b.schema.tables["notes"].rules.read.quarry();assert!(printed.contains("("));
    let round=bound(&basic(&printed));assert_eq!(b.schema.tables["notes"].rules.read,round.schema.tables["notes"].rules.read);
}
#[test]
fn security_notes_have_real_sites_and_self_signup_role_is_flagged(){
    let src="table roles:\n  principal: principal\n  role: enum('member','admin')\n  unique principal\n  read <- .principal = viewer\n  insert <- .principal = viewer\n  online only\ntable notes:\n  read <- exists roles[viewer, role = 'admin']\n  online only\nmutation join(role: enum('member','admin')):\n  return insert roles { principal: viewer, role }\n";
    let b=bound(src);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("policy.q".into(),src.into())],&b);
    assert!(r.notes.iter().any(|n|n.code=="N_PRIVILEGE_ESCALATION"));assert!(r.notes.iter().all(|n|n.site.line>0));
    let fixed=src.replace("insert <- .principal = viewer","insert <- viewer = 'service:ops'");
    let b=bound(&fixed);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("policy.q".into(),fixed)],&b);
    assert!(!r.notes.iter().any(|n|n.code=="N_PRIVILEGE_ESCALATION"));
}

#[test]
fn kind_named_authority_and_owner_field_patches_receive_escalation_advice(){
    for owned in [false,true]{
        let source=format!("table seats:\n  principal: principal\n  kind: enum('member','admin') default 'member'{}\n  unique principal\n  read <- .principal = viewer\n  insert <- {}\n  online only\ntable secrets:\n  read <- exists seats[viewer, kind = 'admin']\n  online only\nmutation appoint(kind: enum('member','admin')):\n  return upsert seats[viewer] {{ principal: viewer, kind }}\n",if owned{" written by .principal readable by audience"}else{""},if owned{"viewer = 'service:ops'"}else{".principal = viewer"});
        let b=bound(&source);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("policy.q".into(),source)],&b);
        assert!(r.notes.iter().any(|n|n.code=="N_PRIVILEGE_ESCALATION"),"owned={owned}: {:?}",r.notes);
    }
}
#[test]
fn projected_temporal_column_does_not_use_whole_row_temporal_probes(){
 let b=bound("table notes:\n  body: text <=80\n  until: time\n  read <- allow\n  online only\ninvariant notes.body read only now < .until\nquery inspect(note: notes):\n  n = notes[note] ! else NOT_FOUND\n  return { id: n.id }\n");
 let c=security::challenges::run(&b);assert!(c.violations.is_empty(),"{c:?}");
 assert!(c.unsupported.iter().any(|s|s.contains("temporal ticks")));
}
#[test]
fn defaulted_self_signup_authority_is_flagged(){
 let source="table roles:\n  principal: principal\n  role: enum('member','admin') default 'admin'\n  unique principal\n  read <- .principal = viewer\n  insert <- .principal = viewer\n  online only\ntable secrets:\n  read <- exists roles[viewer, role = 'admin']\n  online only\nmutation join():\n  return insert roles { principal: viewer }\n";
 let b=bound(source);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("policy.q".into(),source.into())],&b);assert!(r.notes.iter().any(|n|n.code=="N_PRIVILEGE_ESCALATION"));
}
#[test]
fn derived_column_values_and_value_dependent_counts_are_observers(){
 for kind in ["sum notes of .amount","count notes where .amount > 1"]{
  let b=bound(&format!("table notes:\n  owner: principal\n  amount: int\n  read <- allow\n  online only\nview totals: {kind} by .owner\n  read <- allow\n  online only\nquery total(owner: principal):\n  return totals[owner]\ninvariant notes.amount read only .owner = viewer\n"));
  let c=security::challenges::run(&b);assert!(c.violations.iter().any(|v|v.effect=="column read observation"),"{kind}: {c:?}");
 }
}
#[test]
fn defaulted_upsert_role_does_not_borrow_update_authority(){
 let source="table roles:\n  principal: principal\n  role: enum('member','admin') default 'admin' written by .principal readable by audience\n  unique principal\n  read <- .principal = viewer\n  insert <- viewer = 'service:ops'\n  update <- .principal = viewer\n  online only\ntable secrets:\n  read <- exists roles[viewer, role = 'admin']\n  online only\nmutation touch():\n  return upsert roles[viewer] { principal: viewer }\n";
 let b=bound(source);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("policy.q".into(),source.into())],&b);assert!(!r.notes.iter().any(|n|n.code=="N_PRIVILEGE_ESCALATION"),"{:?}",r.notes);
}
#[test]
fn display_name_edits_do_not_make_a_role_revocable(){
 let source="table roles:\n  principal: principal\n  role: enum('inspector','member')\n  displayName: text <=80\n  unique principal\n  read <- allow\n  update <- viewer = 'service:ops'\n  online only\ntable grants:\n  inspector: principal\n  unique inspector\n  read <- .inspector = viewer\n  insert <- exists roles[viewer, role = 'inspector']\n  online only\ntable reports:\n  read <- exists grants[viewer]\n  online only\ninvariant reports.read only exists roles[viewer, role = 'inspector']\nmutation rename(who: principal, name: text <=80):\n  update roles[who] { displayName: name }\n  return null\n";
 let b=bound(source);assert!(!security::analyze(&b).notes.iter().any(|n|n.code=="N_GRANT_OUTLIVES_ROLE"));
 let b=bound(&(source.to_string()+"mutation demote(who: principal):\n  update roles[who] { role: 'member' }\n  return null\n"));assert!(security::analyze(&b).notes.iter().any(|n|n.code=="N_GRANT_OUTLIVES_ROLE"));
}

#[test]
fn column_value_existence_is_observed_without_disclosing_other_columns(){
 let b=bound("table notes:\n  owner: principal\n  secret: text <=30 ?\n  read <- allow\n  online only\nview totals: count notes where .secret != null by .owner\n  read <- allow\n  online only\nquery total(owner: principal):\n  return totals[owner]\ninvariant notes.secret read only .owner = viewer\n");
 let c=security::challenges::run(&b);assert!(c.violations.iter().any(|v|v.effect=="column read observation"),"{c:?}");
}

#[test]
fn fixed_literal_self_signup_of_global_authority_is_flagged(){
 let source="table roles:\n  principal: principal\n  role: enum('member','admin')\n  unique principal\n  read <- .principal = viewer\n  insert <- .principal = viewer\n  update <- viewer = 'service:ops'\n  online only\ntable secrets:\n  read <- exists roles[viewer, role = 'admin']\n  online only\nmutation join():\n  return insert roles { principal: viewer, role: 'admin' }\n";
 let b=bound(source);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("policy.q".into(),source.into())],&b);assert!(r.notes.iter().any(|n|n.code=="N_PRIVILEGE_ESCALATION"),"{:?}",r.notes);
}

#[test]
fn helpers_preserve_role_assignment_advice_and_operator_guards(){
 for guarded in [false,true]{
  let source=format!("table roles:\n  principal: principal\n  role: enum('member','admin')\n  unique principal\n  read <- .principal = viewer\n  insert <- .principal = viewer\n  online only\ntable secrets:\n  read <- exists roles[viewer, role = 'admin']\n  online only\nfn enroll(chosen: enum('member','admin')):\n{}  return insert roles {{ principal: viewer, role: chosen }}\nmutation join(role: enum('member','admin')):\n  return enroll(role)\n",if guarded{"  require viewer = 'service:ops' else OPERATOR\n"}else{""});
  let b=bound(&source);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("policy.q".into(),source)],&b);assert_eq!(r.notes.iter().any(|n|n.code=="N_PRIVILEGE_ESCALATION"),!guarded,"{:?}",r.notes);
 }
}

#[test]
fn tuple_role_probes_and_literal_targets_are_not_hidden_by_arguments(){
 for tuple in [false,true]{
  let source=format!("table roles:\n  principal: principal\n  role: enum('member','admin')\n  unique principal{}\n  read <- allow\n  insert <- .principal = viewer\n  online only\ntable secrets:\n  read <- exists roles[{}]\n  online only\nmutation join(role: enum('member')):\n  return insert roles {{ principal: viewer, role: 'admin' }}\n",if tuple{", role"}else{""},if tuple{"viewer, 'admin'"}else{"viewer, role = 'admin'"});
  let b=bound(&source);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("policy.q".into(),source)],&b);assert!(r.notes.iter().any(|n|n.code=="N_PRIVILEGE_ESCALATION"),"{tuple}: {:?}",r.notes);
 }
}
#[test]
fn successful_operator_helper_guards_protect_later_caller_writes(){
 let source="table roles:\n  principal: principal\n  role: enum('member','admin')\n  unique principal\n  read <- allow\n  insert <- .principal = viewer\n  online only\ntable secrets:\n  read <- exists roles[viewer, role = 'admin']\n  online only\nfn operator():\n  require viewer = 'service:ops' else OPERATOR\n  return null\nmutation join():\n  operator()\n  return insert roles { principal: viewer, role: 'admin' }\n";
 let b=bound(source);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("policy.q".into(),source.into())],&b);assert!(!r.notes.iter().any(|n|n.code=="N_PRIVILEGE_ESCALATION"),"{:?}",r.notes);
}

#[test]
fn ordinary_project_ownership_is_not_role_delegation(){
 let source="table projects:\n  owner: principal\n  state: enum('open','closed')\n  unique owner\n  read <- allow\n  insert <- .owner = viewer\n  online only\ntable roles:\n  principal: principal\n  role: enum('member','admin')\n  unique principal\n  read <- allow\n  insert <- .principal = viewer\n  online only\ntable secrets:\n  read <- exists roles[viewer, role = 'admin']\n  online only\nmutation join():\n  require exists projects[viewer, state = 'open'] else NO_PROJECT\n  return insert roles { principal: viewer, role: 'admin' }\n";
 let b=bound(source);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("policy.q".into(),source.into())],&b);assert!(r.notes.iter().any(|n|n.code=="N_PRIVILEGE_ESCALATION"),"{:?}",r.notes);
}
#[test]
fn insert_intent_does_not_constrain_authorized_role_updates(){
 let source="table roles:\n  principal: principal\n  role: enum('member','admin','legal')\n  unique principal\n  read <- allow\n  insert <- viewer = 'service:ops'\n  update <- exists roles[viewer, role = 'admin']\n  online only\ntable secrets:\n  read <- exists roles[viewer, role = 'legal']\n  online only\ninvariant roles.insert only .role = 'member'\nmutation promote(who: principal):\n  return update roles[who] { role: 'legal' }\n";
 let b=bound(source);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("policy.q".into(),source.into())],&b);assert!(!r.notes.iter().any(|n|n.code=="N_PRIVILEGE_ESCALATION"),"{:?}",r.notes);
}
#[test]
fn fixed_customer_enrollment_with_self_scoped_permissions_is_quiet(){
 let source="table roles:\n  principal: principal\n  role: enum('customer','dispatcher')\n  unique principal\n  read <- .principal = viewer\n  insert <- .principal = viewer and .role = 'customer'\n  online only\ntable bookings:\n  customer: principal\n  read <- .customer = viewer or exists roles[viewer, role = 'dispatcher']\n  insert <- .customer = viewer and exists roles[viewer, role = 'customer']\n  online only\nmutation join():\n  return insert roles { principal: viewer, role: 'customer' }\n";
 let b=bound(source);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("policy.q".into(),source.into())],&b);assert!(!r.notes.iter().any(|n|n.code=="N_PRIVILEGE_ESCALATION"),"{:?}",r.notes);
}

#[test]
fn operation_specific_delegation_intent_is_honored_by_advice(){
 let source="table roles:\n  principal: principal\n  role: enum('producer','legal')\n  unique principal\n  read <- allow\n  update <- exists roles[viewer, role = 'producer']\n  online only\ntable releases:\n  read <- exists roles[viewer, role = 'legal']\n  online only\ninvariant roles.promote only .role != 'legal'\nmutation promote(who: principal):\n  return update roles[who] { role: 'legal' }\n";
 let b=bound(source);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("policy.q".into(),source.into())],&b);assert!(r.notes.iter().any(|n|n.code=="N_PRIVILEGE_ESCALATION"),"{:?}",r.notes);
}
#[test]
fn scoped_enum_context_is_not_a_global_role_roster(){
 let source="table roles:\n  principal: principal\n  region: enum('north','south')\n  role: enum('member','admin')\n  unique principal, region\n  read <- allow\n  insert <- .principal = viewer and .role = 'member'\n  online only\ntable notes:\n  region: enum('north','south')\n  read <- exists roles[viewer, .region, role = 'member']\n  online only\nmutation join(region: enum('north','south')):\n  return insert roles { principal: viewer, region, role: 'member' }\n";
 let b=bound(source);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("schema.q".into(),source.into())],&b);assert!(!r.notes.iter().any(|n|n.code=="N_PRIVILEGE_ESCALATION"),"{:?}",r.notes);
}
#[test]
fn tuple_role_tests_guard_and_explain_retained_grants_consistently(){
 let source="table seats:\n  principal: principal\n  kind: enum('inspector','member')\n  unique principal, kind\n  read <- allow\n  delete <- viewer = 'service:ops'\n  online only\ntable grants:\n  principal: principal\n  unique principal\n  read <- allow\n  insert <- exists seats[viewer, 'inspector']\n  online only\ntable leaks:\n  read <- exists grants[viewer]\n  online only\ntable guarded:\n  read <- exists seats[viewer, 'inspector']\n  online only\ninvariant leaks.read only exists seats[viewer, 'inspector']\ninvariant guarded.read only exists seats[viewer, 'inspector']\nmutation revoke(who: principal, kind: enum('inspector','member')):\n  delete seats[who, kind]\n  return null\n";
 let r=security::analyze(&bound(source));assert!(r.notes.iter().any(|n|n.code=="N_GRANT_OUTLIVES_ROLE"&&n.message.starts_with("leaks.")),"{:?}",r.notes);assert!(!r.notes.iter().any(|n|n.code=="N_GRANT_OUTLIVES_ROLE"&&n.message.starts_with("guarded.")),"{:?}",r.notes);
}

#[test]
fn a_different_or_negated_role_does_not_discharge_retained_intent(){
 for test in ["exists roles[viewer, role = 'member']","not exists roles[viewer, role = 'judge']"]{
  let source=format!("table roles:\n  principal: principal\n  role: enum('judge','member')\n  unique principal\n  read <- allow\n  update <- viewer = 'service:ops'\n  online only\ntable notes:\n  assignee: principal\n  read <- .assignee = viewer and {test}\n  online only\ninvariant notes.read only exists roles[viewer, role = 'judge']\nmutation demote(who: principal):\n  return update roles[who] {{ role: 'member' }}\n");
  let r=security::analyze(&bound(&source));assert!(r.notes.iter().any(|n|n.code=="N_GRANT_OUTLIVES_ROLE"&&n.message.starts_with("notes.read")),"{:?}",r.notes);
 }
}
