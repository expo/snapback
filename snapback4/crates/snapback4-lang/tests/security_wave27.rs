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
