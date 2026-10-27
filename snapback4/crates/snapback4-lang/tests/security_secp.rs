//! SECP: actual wave-30 lane guards, with unsafe variants retaining questions.
use snapback4_lang::{compile, security, Diagnostic};
fn notes(source:&str)->Vec<Diagnostic>{
    let sources=vec![("schema.q".into(),source.into())];let bound=compile(&sources);
    assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let mut report=security::analyze_rules(&bound);security::add_source_notes(&mut report,&sources,&bound);
    bound.notes.into_iter().chain(report.notes).collect()
}
const LANES:&[(&str,&str)]=&[
    ("001",include_str!("security/wave30/001.q")),
    ("005",include_str!("security/wave30/005.q")),
    ("011",include_str!("security/wave30/011.q")),
    ("012",include_str!("security/wave30/012.q")),
    ("026",include_str!("security/wave30/026.q")),
    ("033",include_str!("security/wave30/033.q")),
    ("036",include_str!("security/wave30/036.q")),
    ("040",include_str!("security/wave30/040.q")),
    ("043",include_str!("security/wave30/043.q")),
    ("048",include_str!("security/wave30/048.q")),
];
#[test]fn wave30_005e_documented_operator_provision_is_not_an_argument_grant_question(){
    for (lane,source) in LANES{let ns=notes(source);assert!(!ns.iter().any(|n|n.code=="N_ARGUMENT_GRANT"&&n.message.starts_with("provision:")),"lane {lane}: {:?}",ns.iter().filter(|n|n.code=="N_ARGUMENT_GRANT"||n.code=="N_GUARD_NOT_CONSUMED").collect::<Vec<_>>());}
    let source=LANES[1].1.replace("service:operator","dev:alice");
    assert!(notes(&source).iter().any(|n|n.code=="N_ARGUMENT_GRANT"&&n.message.starts_with("provision:")));
}
#[test]fn wave30_012e_pure_production_role_helper_answers_read_advice(){
    let ns=notes(LANES[3].1);
    assert!(!ns.iter().any(|n|n.code=="N_LOOKUP_FILTERED"&&["saveStoryboard","saveVoice","advanceStage","deliverPreview"].iter().any(|op|n.message.starts_with(&format!("mutation {op}:")))),"{:?}",ns.iter().filter(|n|n.code=="N_LOOKUP_FILTERED").collect::<Vec<_>>());
    assert!(!ns.iter().any(|n|n.code=="N_QUERY_FILTERED"&&n.message.starts_with("query board:")));
}
#[test]fn wave30_005_011_026_048_standing_guards_and_stage_advances_are_not_one_use(){
    for at in [1,2,4,9]{let (lane,source)=LANES[at];let ns=notes(source);
        assert!(!ns.iter().any(|n|n.code=="N_GUARD_NOT_CONSUMED"),"lane {lane}: {:?}",ns.iter().filter(|n|n.code=="N_ARGUMENT_GRANT"||n.code=="N_GUARD_NOT_CONSUMED").collect::<Vec<_>>());}
}
#[test]fn lifecycle_guards_are_row_specific_nondefault_nullable_and_exclusive(){
    let base="table docs:\n  stage:enum('draft','quoted','approved') default 'draft'\n  approvedAt:time ?\n  photo:image <=10000\n  read <- allow\n  update <- allow\n  online only\nmutation edit(doc:docs,other:docs,photo:image <=10000):\n  row=docs[doc] ! else MISSING\n  otherRow=docs[other] ! else MISSING\nGUARD  update docs[id = doc] {photo}\n";
    for (guard,warn) in [("",true),("  require row.stage = 'quoted' else NO\n",false),("  require row.approvedAt = null else NO\n",false),("  require row.stage = 'draft' or row.stage = 'quoted' else NO\n",false),("  require row.stage = 'draft' or row.stage = 'quoted' or row.stage = 'approved' else NO\n",true),("  require otherRow.stage = 'quoted' else NO\n",true)]{
        assert_eq!(notes(&base.replace("GUARD",guard)).iter().any(|n|n.code=="N_EDIT_AFTER_APPROVAL"),warn,"{guard}");
    }
}
#[test]fn remaining_questions_name_observed_guards_and_gap(){
    for (lane,source) in LANES{for n in notes(source){if matches!(n.code.as_str(),"N_EDIT_AFTER_APPROVAL"|"N_GUARD_NOT_CONSUMED"|"N_LOOKUP_FILTERED"|"N_ARGUMENT_GRANT"|"N_SWEEP_DEADLINE"|"N_DEPENDENT_WINDOW"|"N_QUERY_FILTERED"){
        assert!(n.message.contains("saw ")&&n.message.contains("not proved:"),"lane {lane}: {n:?}");assert!(!n.message.contains('\n'));
    }}}
}
const READER:&str="table roles:\n  principal:principal\n  role:enum('admin','member')\n  unique principal\n  read <- allow\n  update <- allow\n  delete <- allow\n  online only\ntable docs:\n  text:text\n  read <- exists roles[viewer,role='admin']\n  online only\nfn admin(): exists roles[viewer,role='admin']\n";
#[test]fn read_advice_keeps_stale_effectful_and_negative_helper_questions(){
    for (name,source,warn) in [
        ("pure",format!("{READER}mutation inspect(doc:docs):\n  require admin() else NO\n  return docs[doc]\n"),false),
        ("stale",format!("{READER}mutation inspect(doc:docs):\n  require admin() else NO\n  update roles[viewer] {{role:'member'}}\n  return docs[doc]\n"),true),
        ("negative",format!("{READER}mutation inspect(doc:docs):\n  require not admin() else NO\n  return docs[doc]\n"),true),
        ("unused_effect",format!("{READER}fn keep(ok:bool,unused:bool): ok\nfn revoke():\n  delete roles[viewer]\n  return true\nmutation inspect(doc:docs):\n  require keep(exists roles[viewer,role='admin'],revoke()) else NO\n  return docs[doc]\n"),true),
    ]{assert_eq!(notes(&source).iter().any(|n|n.code=="N_LOOKUP_FILTERED"),warn,"{name}");}
}
#[test]fn approved_state_and_broad_exclusion_do_not_answer_edit_question(){
    let base="table docs:\n  stage:enum('draft','quoted','approved','cancelled') default 'draft'\n  approved:bool default false\n  photo:image <=10000\n  read <- allow\n  update <- allow\n  online only\nmutation edit(doc:docs,photo:image <=10000):\n  row=docs[doc] ! else NO\n  require GUARD else NO\n  update docs[doc] {photo}\n";
    for (guard,warn) in [("row.approved",true),("row.stage != 'cancelled'",true),("row.stage = 'approved'",true),("row.approved = false",false),("row.stage = 'quoted'",false)]{
        assert_eq!(notes(&base.replace("GUARD",guard)).iter().any(|n|n.code=="N_EDIT_AFTER_APPROVAL"),warn,"{guard}");
    }
}
#[test]fn consumption_is_same_row_negative_and_on_every_effect_path(){
    let base="table receipts:\n  paid:bool default false\n  read <- allow\n  update <- allow\n  online only\ntable orders:\n  receipt:receipts\n  status:enum('pending','done') default 'pending'\n  read <- allow\n  update <- allow\n  online only\nmutation finish(order:orders,other:receipts,flag:bool):\n  o=orders[order] ! else NO\n  r=receipts[o.receipt] ! else NO\n  require r.paid else NOT_PAID\nCONSUME  update orders[order] {status:'done'}\n";
    for (consume,warn) in [("",true),("  update receipts[o.receipt] {paid:false}\n",false),("  update receipts[other] {paid:false}\n",true),("  update receipts[o.receipt] {paid:true}\n",true),("  if flag:\n    update receipts[o.receipt] {paid:false}\n",true)]{
        assert_eq!(notes(&base.replace("CONSUME",consume)).iter().any(|n|n.code=="N_GUARD_NOT_CONSUMED"),warn,"{consume}");
    }
    let creates="table consents:\n  granted:bool default false\n  read <- allow\n  online only\ntable redemptions:\n  key:text <=80\n  unique key\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation redeem(consent:consents,key:text <=80):\n  c=consents[consent] ! else NO\n  require c.granted else NO\n  return upsert redemptions[key=key] {key}\n";
    assert!(notes(creates).iter().any(|n|n.code=="N_GUARD_NOT_CONSUMED"));
}
const SWEEP:&str="table docs:\n  status:enum('open','expired','done') default 'open'\n  due:time\n  read <- allow\n  update <- allow\n  online only\nmutation finish(doc:docs,other:docs,flag:bool):\n  row=docs[doc] ! else NO\n  second=docs[other] ! else NO\n  require row.status = 'open' else NO\nGUARD  update docs[doc] {status:'done'}\njob expire(periodStart:time,periodEnd:time):\n  for row in docs:\n    if row.status = 'open' and DUE:\n      update docs[row.id] {status:'expired'}\nschedule expiry every 1d at 03:00: expire\n";
#[test]fn wave30_040r_reversed_deadline_equality_unknown_and_other_row_controls(){
    for (guard,warn) in [("  require now < row.due else CLOSED\n",false),("  require row.due > now else CLOSED\n",false),("  require row.due >= now else CLOSED\n",true),("  require not (row.due <= now and flag) else CLOSED\n",true),("  require second.due > now else CLOSED\n",true)]{
        let source=SWEEP.replace("GUARD",guard).replace("DUE","row.due <= periodEnd");
        assert_eq!(notes(&source).iter().any(|n|n.code=="N_SWEEP_DEADLINE"),warn,"{guard}");
    }
    let source=SWEEP.replace("GUARD","").replace("DUE","row.due < periodEnd - duration()")+"\nfn duration(): 1d\n";
    assert!(notes(&source).iter().any(|n|n.code=="N_SWEEP_DEADLINE"));
}
#[test]fn window_presence_and_secondary_key_are_not_a_bound(){
    let base="table parents:\n  predecessor:parents ?\n  dueAt:time\n  approvedAt:time ?\n  unique predecessor\n  read <- allow\n  online only\ntable children:\n  parent:parents\n  dueAt:time\n  read <- allow\n  insert <- allow\n  online only\nmutation create(parent:parents,proposed:time):\n  p=parents[KEY] ! else NO\n  require proposed > now else PAST\n  require BOUND else NO\n  return insert children {parent,dueAt:proposed}\n";
    for (key,guard,warn) in [("parent","p.approvedAt != null",true),("parent","proposed <= p.dueAt",false),("predecessor=parent","proposed <= p.dueAt",true)]{
        assert_eq!(notes(&base.replace("KEY",key).replace("BOUND",guard)).iter().any(|n|n.code=="N_DEPENDENT_WINDOW"),warn,"{key}: {guard}");
    }
}

#[test]fn wave30_016_027_032_036_039_unique_roster_else_branches_are_exhaustive(){
    let source="table roles:\n  principal:principal\n  role:enum('client','maker','owner')\n  unique principal\n  read <- .principal = viewer\n  online only\ntable docs:\n  value:text\n  read <- exists roles[viewer,role='maker'] or exists roles[viewer,role='owner']\n  online only\nquery board(c:cursor ?):\n  require exists roles[viewer] else NO_ROLE\n  if exists roles[viewer,role='client']:\n    return []\n  return docs last 20 by .id after c\n";
    assert!(!notes(source).iter().any(|n|n.code=="N_QUERY_FILTERED"));
    let restricted=source.replace("read <- .principal = viewer","read <- exists roles[viewer,role='owner']");
    // A successful visible role point itself establishes the owner policy.
    assert!(!notes(&restricted).iter().any(|n|n.code=="N_QUERY_FILTERED"));
    let nullable=source.replace("role:enum('client','maker','owner')","role:enum('client','maker','owner') ?");
    assert!(notes(&nullable).iter().any(|n|n.code=="N_QUERY_FILTERED"));
}
#[test]fn captured_role_rows_answer_advice_until_a_write_or_rebind(){
    let source=format!("{READER}mutation inspect(doc:docs):\n  r=roles[viewer] ! else NO_ROLE\n  require r.role = 'admin' else NO\n  return docs[doc]\n");
    assert!(!notes(&source).iter().any(|n|n.code=="N_LOOKUP_FILTERED"));
    let stale=source.replace("  return docs[doc]","  update roles[viewer] {role:'member'}\n  return docs[doc]");
    assert!(notes(&stale).iter().any(|n|n.code=="N_LOOKUP_FILTERED"));
}

#[test]fn operator_row_rule_does_not_hide_an_owner_field_grant_bypass(){
    let source="table docs:\n  owner:principal\n  recipient:principal ? default null written by .owner readable by audience\n  read <- .recipient = viewer\n  insert <- viewer = 'service:operator'\n  update <- viewer = 'service:operator'\n  online only\nmutation grant(doc:docs,recipient:principal ?):\n  update docs[doc] {recipient}\n";
    assert!(notes(source).iter().any(|n|n.code=="N_ARGUMENT_GRANT"));
    let operator=source.replace("  update docs[doc]","  require viewer = 'service:operator' else NO\n  update docs[doc]");
    assert!(!notes(&operator).iter().any(|n|n.code=="N_ARGUMENT_GRANT"));
}
#[test]fn wave30_043r_null_stamps_and_048r_exclusive_stage_guards(){
    let base="table docs:\n  stage:enum('draft','quoted','approved') default 'draft'\n  approved:bool ?\n  photo:image <=10000 ?\n  read <- allow\n  update <- allow\n  online only\nmutation edit(doc:docs,photo:image <=10000 ?):\n  row=docs[doc] ! else NO\nBODY\n";
    for body in ["  require not (row.approved ?? false) else NO\n  update docs[doc] {photo}","  update docs[doc] {photo:row.photo ?? photo}"]{
        assert!(!notes(&base.replace("BODY",body)).iter().any(|n|n.code=="N_EDIT_AFTER_APPROVAL"),"{body}");
    }
    assert!(notes(&base.replace("BODY","  update docs[doc] {photo:photo ?? row.photo}")).iter().any(|n|n.code=="N_EDIT_AFTER_APPROVAL"));
    let ns=notes(&base.replace("BODY","  if row.stage = 'draft':\n    update docs[doc] {photo}\n  elif row.stage = 'quoted':\n    update docs[doc] {photo}\n  else:\n    update docs[doc] {photo}"));
    assert_eq!(ns.iter().filter(|n|n.code=="N_EDIT_AFTER_APPROVAL").count(),1);
}
#[test]fn wave30_033_affine_quote_deadline_matches_both_operand_orders(){
    let source=LANES[5].1;
    for source in [source.to_owned(),source.replace("now <= j.quoteCreatedAt + 14d","j.quoteCreatedAt + 14d >= now")]{
        assert!(!notes(&source).iter().any(|n|n.code=="N_SWEEP_DEADLINE"&&n.message.contains("mutation acceptQuote:")));
    }
}

#[test]fn captured_preapproval_and_null_initialization_expire_when_written(){
    let source="table docs:\n  stage:enum('draft','quoted','approved') default 'draft'\n  photo:image <=10000\n  read <- allow\n  update <- allow\n  online only\nmutation approveThenReplace(doc:docs,photo:image <=10000):\n  row=docs[doc] ! else NO\n  require row.stage = 'quoted' else NO\n  require row.photo != null else NO\n  update docs[doc] {stage:'approved'}\n  update docs[doc] {photo}\n";
    assert!(notes(source).iter().any(|n|n.code=="N_EDIT_AFTER_APPROVAL"&&n.message.contains("docs.photo")));
}
#[test]fn an_optional_window_comparison_cannot_discharge_the_write_path(){
    let source="table parents:\n  dueAt:time\n  returnedAt:time\n  read <- allow\n  online only\ntable children:\n  parent:parents\n  dueAt:time\n  read <- allow\n  insert <- allow\n  online only\nmutation create(parent:parents,proposed:time,bypass:bool):\n  p=parents[parent] ! else NO\n  require proposed > now else PAST\n  require bypass or proposed <= p.returnedAt else OUTSIDE\n  return insert children {parent,dueAt:proposed}\n";
    assert!(notes(source).iter().any(|n|n.code=="N_DEPENDENT_WINDOW"));
    assert!(!notes(&source.replace("bypass or proposed <= p.returnedAt","not (proposed > p.returnedAt)")).iter().any(|n|n.code=="N_DEPENDENT_WINDOW"));
}

#[test]fn potentially_aliasing_writes_expire_lifecycle_and_window_snapshots(){
    let source="table docs:\n  stage:enum('quoted','approved') default 'quoted'\n  photo:image <=10000\n  read <- allow\n  update <- allow\n  online only\nmutation edit(doc:docs,other:docs,photo:image <=10000):\n  d=docs[doc] ! else NO\n  require d.stage = 'quoted' else NO\n  update docs[other] {stage:'approved'}\n  update docs[doc] {photo}\n";
    assert!(notes(source).iter().any(|n|n.code=="N_EDIT_AFTER_APPROVAL"));
    let base="table parents:\n  due:time\n  read <- allow\n  update <- allow\n  online only\ntable children:\n  parent:parents\n  due:time\n  read <- allow\n  insert <- allow\n  online only\nmutation create(parent:parents,proposed:time,flag:bool):\n  p=parents[parent] ! else NO\n  require proposed > now else NO\n  require BOUND else NO\n  return insert children {parent,due:proposed}\n";
    for bound in ["proposed <= (now + 365d if flag else p.due)","proposed <= p.due + (proposed - p.due)"]{
        assert!(notes(&base.replace("BOUND",bound)).iter().any(|n|n.code=="N_DEPENDENT_WINDOW"),"{bound}");
    }
}
#[test]fn wave30_036_source_stamp_reset_keeps_sweep_question(){
    let source=include_str!("security/wave30/036.schema.q");
    assert!(!notes(source).iter().any(|n|n.code=="N_SWEEP_DEADLINE"&&n.message.starts_with("mutation requestChange:")));
    let reset=format!("{source}\nmutation reset(mascot:mascots):\n  update mascots[mascot] {{stage:'approval'}}\n");
    assert!(notes(&reset).iter().any(|n|n.code=="N_SWEEP_DEADLINE"&&n.message.starts_with("mutation requestChange:")));
}
#[test]fn wave30_033_020_constructor_mismatch_keeps_linked_reader_questions(){
    let source=include_str!("security/wave30/033.schema.q").replace("customer: j.customer, amountCents","customer: viewer, amountCents");
    assert!(notes(&source).iter().any(|n|n.code=="N_QUERY_FILTERED"&&n.message.starts_with("query jobInvoices:")));
    let source=include_str!("security/wave30/020.schema.q").replace("ride: ride.id, rider, priceCents","ride: ride.id, rider: viewer, priceCents");
    assert!(notes(&source).iter().any(|n|n.code=="N_LOOKUP_FILTERED"&&n.message.starts_with("mutation cancelRide:")));
}
#[test]fn wave30_043_amendment_edit_needs_its_atomic_approval(){
    let source=include_str!("security/wave30/043.schema.q");
    for changed in [source.replace("  update amendments[a.id] {approvedBy: viewer, approvedAt: now}\n",""),source.replace("report: a.proposedReport","report: 'unreviewed replacement'"),source.replace("immutable inspection, client, branch", "immutable client, branch")]{
        assert!(notes(&changed).iter().any(|n|n.code=="N_EDIT_AFTER_APPROVAL"&&n.message.starts_with("approveAmendment:")));
    }
}
#[test]fn wave30_011_016_exclusive_stage_arms_are_not_intervening_writes(){
    for source in [include_str!("security/wave30/011.schema.q"),include_str!("security/wave30/016.schema.q")]{
        assert!(!notes(source).iter().any(|n|n.code=="N_EDIT_AFTER_APPROVAL"&&["advanceInstall:","advanceStage:"].iter().any(|op|n.message.starts_with(op))));
    }
}
#[test]fn wave30_038_standing_window_states_its_parent_applicability(){
    assert!(!notes(include_str!("security/wave30/038.schema.q")).iter().any(|n|n.code=="N_DEPENDENT_WINDOW"&&n.message.starts_with("scheduleDelivery:")));
}
#[test]fn helper_requirements_use_actual_principal_and_alias_writes_revoke_facts(){
    let prefix=format!("{READER}fn check(principal:principal):\n  require exists roles[principal,role='admin'] else NO\n");
    for (argument,warn) in [("viewer",false),("principal",true)]{
        let source=format!("{prefix}mutation inspect(doc:docs,principal:principal):\n  check({argument})\n  return docs[doc]\n");
        assert_eq!(notes(&source).iter().any(|n|n.code=="N_LOOKUP_FILTERED"&&n.message.starts_with("mutation inspect:")),warn);
    }
    let source=format!("{READER}mutation inspect(doc:docs):\n  r=roles[viewer] ! else NO\n  require r.role = 'admin' else NO\n  update r {{role:'member'}}\n  return docs[doc]\n");
    assert!(notes(&source).iter().any(|n|n.code=="N_LOOKUP_FILTERED"));
}
#[test]fn reverse_link_uses_child_copy_field_not_a_same_named_owner(){
    let source="table parents:\n  owner:principal\n  immutable owner\n  read <- .owner = viewer\n  insert <- allow\n  online only\ntable children:\n  parent:parents\n  copiedOwner:principal\n  owner:principal\n  immutable parent,copiedOwner,owner\n  read <- .owner = viewer\n  insert <- allow\n  online only\nmutation create(parent:parents,owner:principal):\n  p=parents[parent] ! else NO\n  return insert children {parent,copiedOwner:p.owner,owner}\nmutation inspect(child:children):\n  c=children[child] ! else NO\n  require c.owner = viewer else NO\n  return parents[c.parent]\n";
    assert!(notes(source).iter().any(|n|n.code=="N_LOOKUP_FILTERED"&&n.message.starts_with("mutation inspect:")));
}
#[test]fn wave30_036_conditional_row_reset_defeats_source_monotonicity(){
    let source=format!("{}\nmutation reset(first:mascots,second:mascots,flag:bool):\n  a=mascots[first] ! else NO\n  b=mascots[second] ! else NO\n  chosen=a if flag else b\n  update chosen {{stage:'approval'}}\n",include_str!("security/wave30/036.schema.q"));
    assert!(notes(&source).iter().any(|n|n.code=="N_SWEEP_DEADLINE"&&n.message.starts_with("mutation requestChange:")));
}
#[test]fn terminal_sweep_write_must_affect_the_checked_resource(){
    let source=SWEEP.replace("GUARD","").replace("DUE","row.due <= periodEnd").replace("update docs[doc] {status:'done'}","update docs[other] {status:'expired'}");
    assert!(notes(&source).iter().any(|n|n.code=="N_SWEEP_DEADLINE"));
}
#[test]fn recipient_role_check_expires_on_potentially_aliasing_writes(){
    let source=format!("{READER}table shares:\n  recipient:principal\n  read <- .recipient = viewer\n  insert <- allow\n  online only\nmutation grant(recipient:principal):\n  r=roles[principal=recipient] ! else NO\n  require r.role = 'member' else NO\n  update roles[principal=recipient] {{role:'admin'}}\n  return insert shares {{recipient}}\n");
    assert!(notes(&source).iter().any(|n|n.code=="N_ARGUMENT_GRANT"&&n.message.starts_with("grant:")));
}
#[test]fn wave30_033_job_resets_defeat_one_way_fact_exemption(){
    let source=format!("{}\njob reset():\n  for row in jobs:\n    update jobs[row.id] {{dampSigned:false}}\n",include_str!("security/wave30/033.schema.q"));
    assert!(notes(&source).iter().any(|n|n.code=="N_EDIT_AFTER_APPROVAL"&&n.message.starts_with("markDamp:")));
}
#[test]fn unresolved_recipient_role_write_keeps_the_argument_question(){
    let source=format!("{READER}table shares:\n  recipient:principal\n  read <- .recipient = viewer\n  insert <- allow\n  online only\nmutation grant(recipient:principal,flag:bool):\n  r=roles[principal=recipient] ! else NO\n  other=roles[viewer] ! else NO\n  require r.role = 'member' else NO\n  chosen=r if flag else other\n  update chosen {{role:'admin'}}\n  return insert shares {{recipient}}\n");
    assert!(notes(&source).iter().any(|n|n.code=="N_ARGUMENT_GRANT"&&n.message.starts_with("grant:")));
}
#[test]fn unresolved_helper_effects_expire_lifecycle_and_recipient_guards(){
    let source="table docs:\n  stage:enum('quoted','approved') default 'quoted'\n  photo:image <=10000\n  read <- allow\n  update <- allow\n  online only\nfn approveChosen(doc:docs,other:docs,flag:bool):\n  a=docs[doc] ! else NO\n  b=docs[other] ! else NO\n  chosen=a if flag else b\n  update chosen {stage:'approved'}\n  return true\nmutation edit(doc:docs,other:docs,flag:bool,photo:image <=10000):\n  d=docs[doc] ! else NO\n  require d.stage = 'quoted' else NO\n  approveChosen(doc,other,flag)\n  update docs[doc] {photo}\n";
    assert!(notes(source).iter().any(|n|n.code=="N_EDIT_AFTER_APPROVAL"&&n.message.starts_with("edit:")));
    let source=format!("{READER}table shares:\n  recipient:principal\n  read <- .recipient = viewer\n  insert <- allow\n  online only\nfn change(recipient:principal,flag:bool):\n  a=roles[principal=recipient] ! else NO\n  b=roles[viewer] ! else NO\n  chosen=a if flag else b\n  update chosen {{role:'admin'}}\n  return true\nmutation grant(recipient:principal,flag:bool):\n  r=roles[principal=recipient] ! else NO\n  require r.role = 'member' else NO\n  change(recipient,flag)\n  return insert shares {{recipient}}\n");
    assert!(notes(&source).iter().any(|n|n.code=="N_ARGUMENT_GRANT"&&n.message.starts_with("grant:")));
}
#[test]fn unresolved_helper_effects_expire_parent_window_snapshots(){
    let source="table parents:\n  due:time\n  read <- allow\n  update <- allow\n  online only\ntable children:\n  parent:parents\n  due:time\n  read <- allow\n  insert <- allow\n  online only\nfn shorten(first:parents,second:parents,flag:bool):\n  a=parents[first] ! else NO\n  b=parents[second] ! else NO\n  chosen=a if flag else b\n  update chosen {due:now}\n  return true\nmutation create(parent:parents,other:parents,proposed:time,flag:bool):\n  p=parents[parent] ! else NO\n  require proposed > now else NO\n  shorten(parent,other,flag)\n  require proposed <= p.due else NO\n  return insert children {parent,due:proposed}\n";
    assert!(notes(source).iter().any(|n|n.code=="N_DEPENDENT_WINDOW"));
}
#[test]fn unresolved_targets_cannot_hide_behind_an_existing_table_name(){
    let prefix=format!("{READER}table shares:\n  recipient:principal\n  read <- .recipient = viewer\n  insert <- allow\n  online only\n");
    for (helper,invoke) in [("", "  docs=r if flag else other\n  update docs {role:'admin'}"),("fn change(recipient:principal,flag:bool):\n  r=roles[principal=recipient] ! else NO\n  other=roles[viewer] ! else NO\n  docs=r if flag else other\n  update docs {role:'admin'}\n  return true\n", "  change(recipient,flag)")]{
        let source=format!("{prefix}{helper}mutation grant(recipient:principal,flag:bool):\n  r=roles[principal=recipient] ! else NO\n  other=roles[viewer] ! else NO\n  require r.role = 'member' else NO\n{invoke}\n  return insert shares {{recipient}}\n");
        assert!(notes(&source).iter().any(|n|n.code=="N_ARGUMENT_GRANT"&&n.message.starts_with("grant:")));
    }
    let source="table docs:\n  stage:enum('quoted','approved') default 'quoted'\n  photo:image <=10000\n  read <- allow\n  update <- allow\n  online only\ntable alias:\n  stage:enum('quoted','approved')\n  read <- allow\n  update <- allow\n  online only\nfn change(first:docs,second:docs,flag:bool):\n  a=docs[first] ! else NO\n  b=docs[second] ! else NO\n  alias=a if flag else b\n  update alias {stage:'approved'}\n  return true\nmutation edit(doc:docs,other:docs,flag:bool,photo:image <=10000):\n  d=docs[doc] ! else NO\n  require d.stage = 'quoted' else NO\n  change(doc,other,flag)\n  update docs[doc] {photo}\n";
    assert!(notes(source).iter().any(|n|n.code=="N_EDIT_AFTER_APPROVAL"&&n.message.starts_with("edit:")));
}
#[test]fn exclusive_helper_arms_at_different_calls_can_both_execute(){
    let source="table docs:\n  stage:enum('quoted','approved') default 'quoted'\n  flip:bool default true\n  photo:image <=10000\n  read <- allow\n  update <- allow\n  online only\nfn change(doc:docs,photo:image <=10000):\n  current=docs[doc] ! else NO\n  if current.flip:\n    update docs[doc] {stage:'approved',flip:false}\n  else:\n    update docs[doc] {photo}\n  return true\nmutation edit(doc:docs,photo:image <=10000):\n  d=docs[doc] ! else NO\n  require d.stage = 'quoted' else NO\n  change(doc,photo)\n  change(doc,photo)\n";
    assert!(notes(source).iter().any(|n|n.code=="N_EDIT_AFTER_APPROVAL"&&n.message.starts_with("edit:")));
}
#[test]fn loop_backedges_can_change_a_captured_lifecycle_guard(){
    let base="table docs:\n  stage:enum('quoted','approved') default 'quoted'\n  flip:bool default true\n  photo:image <=10000\n  read <- allow\n  update <- allow\n  online only\nmutation edit(doc:docs,photo:image <=10000):\n  d=docs[doc] ! else NO\n  require d.stage = 'quoted' else NO\n  for step in [1,2]:\n    current=docs[doc] ! else NO\nBODY";
    for body in ["    if current.flip:\n      update docs[doc] {stage:'approved',flip:false}\n    else:\n      update docs[doc] {photo}\n", "    if not current.flip:\n      update docs[doc] {photo}\n    else:\n      update docs[doc] {stage:'approved',flip:false}\n"]{
        assert!(notes(&base.replace("BODY",body)).iter().any(|n|n.code=="N_EDIT_AFTER_APPROVAL"));
    }
}
#[test]fn a_loop_cannot_reuse_a_captured_paid_guard_after_consumption(){
    let source="table receipts:\n  paid:bool default false\n  read <- allow\n  update <- allow\n  online only\ntable orders:\n  receipt:receipts\n  read <- allow\n  insert <- allow\n  online only\nmutation finish(receipt:receipts):\n  r=receipts[receipt] ! else NO\n  require r.paid else NOT_PAID\n  for step in [1,2]:\n    insert orders {receipt}\n    update receipts[receipt] {paid:false}\n";
    assert!(notes(source).iter().any(|n|n.code=="N_GUARD_NOT_CONSUMED"));
}
