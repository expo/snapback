//! Wave-27 follow-up: decisions are scoped to actual modeled effects.
use snapback4_lang::{compile,security};
fn notes(source:&str)->Vec<snapback4_lang::Diagnostic>{
 let sources=vec![("schema.q".into(),source.into())];let b=compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let mut r=security::analyze_rules(&b);security::add_source_notes(&mut r,&sources,&b);r.notes.extend(b.notes);r.notes
}
#[test]fn approvals_for_unmodeled_acts_are_informational_not_gates(){
 for source in [include_str!("security/wave27/001.q"),include_str!("security/wave27/003.q"),include_str!("security/wave27/006.q"),include_str!("security/wave27/009.q"),include_str!("security/wave27/017.q"),include_str!("security/wave27/028.q"),include_str!("security/wave27/050.q")]{
  let ns=notes(source);assert!(!ns.iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{:?}",ns.iter().filter(|n|n.code.contains("APPROVAL")).collect::<Vec<_>>());
  assert!(ns.iter().any(|n|n.code=="N_APPROVAL_INFORMATIONAL"&&n.message.contains("informational record")&&n.rewrite.starts_with("acknowledge")));
 }
 assert!(!security::gated_note("N_APPROVAL_INFORMATIONAL"));
}
#[test]fn real_modeled_effects_and_blank_text_remain_gated(){
 for source in [include_str!("security/wave27/020.q"),include_str!("security/wave27/036.q"),include_str!("security/wave27/046.q"),include_str!("security/wave26/036.q")]{assert!(notes(source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));}
 assert!(notes(include_str!("security/wave27/045.q")).iter().any(|n|n.code=="N_BLANK_TEXT_GUARD"));
}
const EDIT:&str="table roles:\n  principal: principal\n  role: enum('clerk','editor')\n  unique principal\n  read <- allow\n  insert <- viewer = 'service:operator'\n  online only\ntable docs:\n  title: text <=80\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create(title: text <=80):\n  return insert docs {title}\nmutation edit(doc: docs,title: text <=80):\n  require exists roles[viewer,role='editor'] else NOT_EDITOR\n  update docs[doc] {title}\n";
#[test]fn mutation_edit_guard_question_has_one_line_answers(){
 assert!(notes(EDIT).iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"));assert!(security::gated_note("N_INSERT_WRITE_INTENT"));
 let intent=format!("{EDIT}invariant docs.title update only exists roles[viewer,role='editor']\n");
 assert!(!notes(&intent).iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"));
 let rule=EDIT.replace("title: text <=80\n","title: text <=80 write <- exists roles[viewer,role='editor']\n");
 assert!(!notes(&rule).iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"));
 let weak=EDIT.replace("title: text <=80\n","title: text <=80 write <- allow\n");assert!(notes(&weak).iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"));
 let table=EDIT.replace("  update <- allow","  update <- exists roles[viewer,role='editor']").replace("  require exists roles[viewer,role='editor'] else NOT_EDITOR\n","");
 assert!(!notes(&table).iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"));assert!(!security::gated_note("N_INSERT_TABLE_AUTHORITY"));
}

fn campaign(source:&str)->security::challenges::Campaign{
 let sources=vec![("schema.q".into(),source.into())];let b=compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let b=security::derived::augmented(&sources,&b);let mut out=security::challenges::Campaign::work_bounded(8192);security::challenges::generated_campaign(&b,&mut out,false);out
}
#[test]fn backfill_equations_produce_replayed_label_candidates(){
 for source in [include_str!("security/wave27/033.q"),include_str!("security/wave27/037.q")]{
  let sources=vec![("schema.q".into(),source.into())];let b=compile(&sources);
  let candidates=security::derived::invariants(&sources,&b);
  assert!(candidates.iter().any(|i|i.site.file.contains("/label-consistency/")),"{candidates:?}");
  let out=campaign(source);assert!(out.violations.iter().any(|v|v.invariant_site.contains("/label-consistency/")&&v.reachability.is_reachable()),"operations={:?}; violations={:?}",out.operations,out.violations.iter().map(|v|(&v.operation,&v.invariant_site)).collect::<Vec<_>>());
 }
}
#[test]fn participant_removal_replays_stable_charge_conservation(){
 let source=include_str!("security/wave27/020.q");
 let out=campaign(source);
 assert!(out.violations.iter().any(|v|v.operation=="removeOutingHiker"&&v.invariant_site.contains("/participant-conservation/")&&v.reachability.is_reachable()),"operations={:?}; violations={:?}",out.operations,out.violations.iter().map(|v|(&v.operation,&v.invariant_site)).collect::<Vec<_>>());
}
#[test]fn wave27_sibling_path_gets_a_turn_before_general_observers(){
 let out=campaign(include_str!("security/wave27/018.q"));
 assert!(out.violations.iter().any(|v|v.operation=="addRescan"&&v.invariant_site.contains("/sibling-approval/")&&v.reachability.is_reachable()),"operations={:?}; violations={:?}",out.operations,out.violations.iter().map(|v|(&v.operation,&v.invariant_site)).collect::<Vec<_>>());
}
const DEFAULT:&str="table docs:\n  label: text <=80 default 'pending'\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ninvariant docs.label write only viewer = 'service:editor'\nmutation create():\n  return insert docs {label:'pending'}\n";
#[test]fn literal_default_creation_has_source_custody(){
 let out=campaign(DEFAULT);
 assert!(!out.violations.iter().any(|v|v.reachability.is_reachable()),"{:?}",out.violations);
 let caller=DEFAULT.replace("mutation create():","mutation create(label: text <=80):").replace("{label:'pending'}","{label}");
 assert!(campaign(&caller).violations.iter().any(|v|v.reachability.is_reachable()));
 let edit=format!("{DEFAULT}mutation edit(doc: docs):\n  update docs[doc] {{label:'changed'}}\n");
 assert!(campaign(&edit).violations.iter().any(|v|v.operation=="edit"&&v.reachability.is_reachable()));
 let guarded=DEFAULT.replace("label: text <=80 default 'pending'","label: text <=80 default 'pending' write <- viewer = 'service:editor'");
 assert!(!campaign(&guarded).violations.iter().any(|v|v.reachability.is_reachable()));
}

#[test]fn predecessor_and_self_backfills_do_not_create_current_label_contracts(){
 for source in [
  "table docs:\n  state: enum('a','b')\n  label: text <=30\n  read <- allow\n  update <- allow\n  online only\nbackfill docs label(state: enum('old','new')):\n  {label:'yes' if state = 'old' else 'no'}\nmutation edit(doc: docs,label: text <=30):\n  update docs[doc] {label}\n",
  "table docs:\n  label: text <=30\n  read <- allow\n  update <- allow\n  online only\nbackfill docs label(label: text <=30):\n  {label}\nmutation edit(doc: docs,label: text <=30):\n  update docs[doc] {label}\n"
 ]{
  let sources=vec![("schema.q".into(),source.into())];let b=compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
  assert!(!security::derived::invariants(&sources,&b).iter().any(|i|i.site.file.contains("/label-consistency/")));
 }
}



#[test]fn evidence_bearing_installation_is_still_a_modeled_act(){
 let source=include_str!("security/wave27/046.q");
 let source=source.replace("table parts:","table parts:\n  photo: image <=8000000 ?");
 assert!(notes(&source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{:?}",notes(&source));
}


#[test]fn model_approval_question_names_the_downstream_effect(){
 let ns=notes(include_str!("security/wave26/036.q"));
 assert!(ns.iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"&&n.message.contains("advanceStage")));
 assert!(!ns.iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"&&n.message.contains("modeled approveModel")));
}

#[test]fn immutable_upsert_identity_does_not_ask_for_edit_intent(){
 let source="table staff:\n  principal: principal\n  role: enum('clerk','editor')\n  unique principal\n  read <- allow\n  insert <- viewer = 'service:operator'\n  online only\ntable docs:\n  owner: principal\n  title: text <=80 default 'initial'\n  unique owner\n  immutable owner\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create(owner: principal,title: text <=80):\n  return upsert docs[owner] {owner,title}\nmutation edit(owner: principal):\n  require exists staff[viewer,role='editor'] else NOT_EDITOR\n  return upsert docs[owner] {owner}\n";
 assert!(!notes(source).iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"),"{:?}",notes(source));
 let mutable=source.replace("  immutable owner\n","").replace("mutation edit(owner: principal):","mutation edit(doc: docs,owner: principal):").replace("return upsert docs[owner] {owner}\n","return update docs[doc] {owner}\n");
 assert!(notes(&mutable).iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"));
 let mixed=source.replace("mutation edit(owner: principal):","mutation edit(owner: principal,title: text <=80):").replace("return upsert docs[owner] {owner}\n","return upsert docs[owner] {owner,title}\n");
 let ns=notes(&mixed);let question=ns.iter().find(|n|n.code=="N_INSERT_WRITE_INTENT").unwrap();assert!(question.message.contains("docs.title"));assert!(!question.message.contains("docs.owner"));
}

#[test]fn requests_and_named_receipts_do_not_govern_unrelated_stages(){
 let base="table parents:\n  price: int default 100\n  needsRefigure: bool default false\n  status: enum('open','done','refigured') default 'open'\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable refigureApprovals:\n  parent: parents\n  immutable parent\n  read <- allow\n  insert <- viewer = 'service:manager'\n  online only\nmutation approveRefigure(parent: parents):\n  require viewer = 'service:manager' else NOT_MANAGER\n  p = parents[parent] ! else MISSING\n  require p.needsRefigure else NOT_NEEDED\n  return insert refigureApprovals {parent}\nmutation flagDamaged(parent: parents):\n  update parents[parent] {needsRefigure:true}\nmutation advance(parent: parents):\n  update parents[parent] {status:'done'}\n";
 assert!(!notes(base).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
 let modeled=format!("{base}mutation performRefigure(parent: parents):\n  update parents[parent] {{status:'refigured'}}\n");
 assert!(notes(&modeled).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
 let discount=base.replace("refigureApprovals","approvals").replace("approveRefigure","approveDiscount").replace("  require p.needsRefigure else NOT_NEEDED\n","").replace("  return insert approvals {parent}","  insert approvals {parent}\n  return update parents[parent] {price:0}");
 assert!(!notes(&discount).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));assert!(notes(&discount).iter().any(|n|n.code=="N_APPROVAL_INFORMATIONAL"));
 let bypass=format!("{discount}mutation performDiscount(parent: parents):\n  update parents[parent] {{price:0}}\n");
 assert!(notes(&bypass).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
}

#[test]fn existence_of_the_same_profile_is_not_a_stricter_edit_role(){
 let source="table profiles:\n  principal: principal\n  name: text <=80\n  role: enum('member','editor') default 'member'\n  unique principal\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation register(name: text <=80):\n  insert profiles {principal:viewer,name}\nmutation edit(name: text <=80):\n  require exists profiles[viewer] else MISSING\n  update profiles[viewer] {name}\n";
 assert!(!notes(source).iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"));
 let timed=source.replace("  principal: principal","  principal: principal\n  opensAt: time default now").replace("  read <- allow","  not before .opensAt\n  read <- allow");
 assert!(notes(&timed).iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"));
 let hidden=source.replace("read <- allow","read <- .role = 'editor'");
 assert!(notes(&hidden).iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"));
 let owner_read=source.replace("read <- allow","read <- .principal = viewer");
 assert!(!notes(&owner_read).iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"));
 let restricted=source.replace("require exists profiles[viewer] else", "require exists profiles[viewer,role='editor'] else");
 assert!(notes(&restricted).iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"));
 let alias=source.replace("  update profiles[viewer] {name}","  p = profiles[viewer] ! else MISSING\n  update profiles[p.id] {name}");
 assert!(!notes(&alias).iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"));
 let other=source.replace("update profiles[viewer] {name}","update profiles[principal='dev:other'] {name}");
 assert!(notes(&other).iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"));
}

#[test]fn repeated_create_remains_reachable_with_an_unrelated_category_setter(){
 let out=campaign(include_str!("security/wave27/025.q"));
 assert!(out.violations.iter().any(|v|v.operation=="retest"&&v.invariant_site.contains("/repeat-create/")&&v.reachability.is_reachable()),"operations={:?}; violations={:?}",out.operations,out.violations.iter().map(|v|(&v.operation,&v.invariant_site)).collect::<Vec<_>>());
}

#[test]fn producer_cancellation_alone_is_not_a_pending_approved_effect(){
 let scalar="table jobs:\n  approved: bool default false\n  status: enum('draft','cancelled','done') default 'draft'\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation decide(job: jobs,approve: bool):\n  if approve:\n    require viewer = 'service:manager' else NOT_MANAGER\n    update jobs[job] {approved:true}\n  else:\n    update jobs[job] {status:'cancelled'}\n  return null\n";
 for act in ["hardening","denim","declination","abortion","withdrawal"]{
  let approved=format!("{act}Approved");let done=format!("{act}Done");
  let ordinary=scalar.replace("approved",&approved).replace(&format!("  {approved}: bool"),&format!("  {done}: bool default false\n  {approved}: bool")).replace("{status:'cancelled'}",&format!("{{{done}:true}}"));
  assert!(notes(&ordinary).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{act}: {:?}",notes(&ordinary));
  let ordinary_record=ordinary.replace("mutation decide",&format!("table {act}Approvals:\n  job: jobs\n  read <- allow\n  insert <- viewer = 'service:manager'\n  online only\nmutation decide")).replace(&format!("update jobs[job] {{{approved}:true}}"),&format!("insert {act}Approvals {{job}}"));
  assert!(notes(&ordinary_record).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{act}");
  if act=="withdrawal"{
   for valued in [&ordinary,&ordinary_record]{
    let reset=valued.replace(&format!("{{{done}:true}}"),&format!("{{{done}:false}}"));assert!(!notes(&reset).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
    let named=reset.replace("  else:\n    update jobs[job]", "  return null\nmutation performWithdrawal(job: jobs):\n  update jobs[job]");assert!(!notes(&named).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{:?}",notes(&named));
    let birth=named.replace("  withdrawalDone: bool default false", "  resetFlag: bool default true\n  withdrawalDone: bool default true").replace("update jobs[job] {withdrawalDone:false}","upsert jobs[job] {resetFlag:false}");assert!(notes(&birth).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{:?}",notes(&birth));
    let negative_birth=birth.replace("  withdrawalDone: bool default true","  withdrawalDone: bool default false");assert!(!notes(&negative_birth).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{:?}",notes(&negative_birth));
   }
  }
 }
 let extra_effect=scalar.replace("  approved: bool","  costCents: int default 100\n  approved: bool").replace("{status:'cancelled'}","{status:'cancelled',costCents:0}");
 assert!(notes(&extra_effect).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
 let refund=scalar.replace("approved","refundApproved").replace("  refundApproved: bool","  refundSent: bool default false\n  refundApproved: bool").replace("{status:'cancelled'}","{status:'cancelled',refundSent:true}");
 let refund_record=refund.replace("mutation decide", "table refundApprovals:\n  job: jobs\n  read <- allow\n  insert <- viewer = 'service:manager'\n  online only\nmutation decide").replace("update jobs[job] {refundApproved:true}","insert refundApprovals {job}");
 for mixed in [refund,refund_record]{assert!(notes(&mixed).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));}
 for name in ["cancelApproved","approvedCancel","approvalCancel","managerApprovedCancel","manager_approved_cancel","managerapprovedcancel"]{let cancel_is_the_act=scalar.replace("approved",name);assert!(notes(&cancel_is_the_act).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));}
 let named_producer=scalar.replace("mutation decide", "mutation approveCancel");assert!(notes(&named_producer).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
 let denied=scalar.replace("approved","approvedDenied").replace("cancelled","denied");assert!(notes(&denied).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
 let birth=scalar.replace("  approved: bool","  refundSent: bool default true\n  approved: bool").replace("update jobs[job] {status:'cancelled'}","upsert jobs[job] {status:'cancelled'}");assert!(notes(&birth).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
 let record=scalar.replace("mutation decide", "table approvals:\n  job: jobs\n  read <- allow\n  insert <- viewer = 'service:manager'\n  online only\nmutation decide").replace("update jobs[job] {approved:true}","insert approvals {job}");
 let named_record_producer=record.replace("mutation decide", "mutation approveCancel");assert!(notes(&named_record_producer).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
 let no_cancel=scalar.replace("  else:\n    update jobs[job] {status:'cancelled'}\n", "").replace("approved", "managerApprovedCancel");assert!(!notes(&no_cancel).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
 let unrelated=scalar.replace("approved", "managerApprovedCancel").replace("{status:'cancelled'}", "{status:'done'}");assert!(!notes(&unrelated).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
 let named_record=record.replace("approvals", "approvalCancel");assert!(notes(&named_record).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
 for source in [scalar.to_owned(),record]{
  assert!(!notes(&source).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"),"{:?}",notes(&source));
  let active=source.replace("{status:'cancelled'}","{status:'done'}");
  // The lower-authority active branch still performs a potentially governed
  // effect; only a cancellation-only branch is excluded.
  assert!(notes(&active).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
  let later=format!("{source}mutation execute(job: jobs):\n  update jobs[job] {{status:'done'}}\n");
  assert!(notes(&later).iter().any(|n|n.code=="N_APPROVAL_NOT_ENFORCED"));
 }
}
