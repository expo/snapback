//! Wave-23 day-two regressions; source copies contain schema only.
use snapback4_lang::{compile,security::{self,challenges::{self,Campaign}}};
fn bound(s:&str)->snapback4_lang::Bound{let b=compile(&[("schema.q".into(),s.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b}
fn notes(s:&str)->security::Report{let b=bound(s);let mut r=security::analyze_rules(&b);security::add_source_notes(&mut r,&[("schema.q".into(),s.into())],&b);r}
fn has(s:&str,code:&str)->bool{notes(s).notes.iter().any(|n|n.code==code)}
const LOOSEN:&[&str]=&[
 include_str!("security/wave23/003.q"),include_str!("security/wave23/007.q"),include_str!("security/wave23/011.q"),include_str!("security/wave23/015.q"),
 include_str!("security/wave23/019.q"),include_str!("security/wave23/023.q"),include_str!("security/wave23/027.q"),include_str!("security/wave23/031.q"),
 include_str!("security/wave23/035.q"),include_str!("security/wave23/039.q"),include_str!("security/wave23/043.q"),include_str!("security/wave23/047.q"),
];
#[test]fn all_twelve_loosen_lanes_have_no_optional_upload_gate_with_own_or_no_intent(){
 for (i,s) in LOOSEN.iter().enumerate(){for s in [s.to_string(),s.lines().filter(|l|!l.trim_start().starts_with("invariant ")).collect::<Vec<_>>().join("\n")]{assert!(!has(&s,"N_OPTIONAL_UPLOAD_CREATE"),"loosen lane index {i}");}}
}
const OPTIONAL:&str="table docs:\n  photo: image <=10000 ?\n  owner: principal\n  read <- allow\n  insert <- allow\n  online only\nmutation add(photo: image <=10000 ?):\n  return insert docs {photo,owner:viewer}\n";
#[test]fn optional_media_is_not_required_by_a_name_but_exact_nonnull_intent_is(){
 assert!(!has(OPTIONAL,"N_OPTIONAL_UPLOAD_CREATE"));
 for predicate in [".photo != null","not (.photo = null)",".photo != null and .owner = viewer"]{assert!(has(&format!("{OPTIONAL}invariant docs always {predicate}\n"),"N_OPTIONAL_UPLOAD_CREATE"),"{predicate}");}
 for predicate in [".photo != null or .owner = viewer","not (.photo != null)",".owner != null"]{assert!(!has(&format!("{OPTIONAL}invariant docs always {predicate}\n"),"N_OPTIONAL_UPLOAD_CREATE"),"{predicate}");}
 assert!(!has(&OPTIONAL.replace("photo: image <=10000 ?):","photo: image <=10000):"),"N_OPTIONAL_UPLOAD_CREATE"));
}
const CHILD:&str="table parents:\n  n: int default 0\n  read <- allow\n  insert <- allow\n  online only\ntable photos:\n  parent: parents\n  photo: image <=10000\n  unique parent\n  read <- allow\n  insert <- allow\n  delete <- allow\n  online only\nmutation add(photo: image <=10000 ?):\n  p = insert parents {}\n  if photo != null:\n    insert photos {parent:p.id,photo}\n  return p\n";
#[test]fn required_child_columns_do_not_make_an_optional_attachment_mandatory(){
 assert!(!has(CHILD,"N_OPTIONAL_UPLOAD_CREATE"));assert!(has(CHILD,"N_OPTIONAL_EVIDENCE"));
 let required=format!("{CHILD}invariant parents always exists photos[parent = .id]\n");assert!(has(&required,"N_OPTIONAL_UPLOAD_CREATE"));
 let guarded=required.replace("  p = insert parents {}","  require photo != null else REQUIRED\n  p = insert parents {}");assert!(!has(&guarded,"N_OPTIONAL_UPLOAD_CREATE"));
}
#[test]fn mandatory_child_discriminators_do_not_gate_unrelated_optional_attachments(){
 let s=CHILD.replace("  parent: parents", "  kind: enum('checkout','return')\n  parent: parents").replace("  unique parent", "  unique parent, kind").replace("photos {parent:p.id,photo}","photos {parent:p.id,kind:'return',photo}");
 let s=format!("{s}invariant parents always exists photos[parent = .id, kind = 'checkout']\n");assert!(!has(&s,"N_OPTIONAL_UPLOAD_CREATE"));
 let checkout=s.replace("kind:'return'","kind:'checkout'");assert!(has(&checkout,"N_OPTIONAL_UPLOAD_CREATE"));
 let sibling=checkout.replace("add(photo: image <=10000 ?)","add(photo: image <=10000 ?, required: image <=10000)").replace("  if photo != null:","  insert photos {parent:p.id,kind:'checkout',photo:required}\n  if photo != null:");assert!(!has(&sibling,"N_OPTIONAL_UPLOAD_CREATE"));
}
#[test]fn unknown_child_filters_and_a_different_parent_do_not_establish_an_upload_obligation(){
 let base=CHILD.replace("  parent: parents", "  kind: enum('checkout','return')\n  parent: parents").replace("  unique parent", "  unique parent, kind").replace("add(photo: image <=10000 ?)","add(photo: image <=10000 ?, kind:enum('checkout','return'))").replace("photos {parent:p.id,photo}","photos {parent:p.id,kind,photo}");
 let unknown=format!("{base}invariant parents always exists photos[parent = .id, kind = 'checkout']\n");assert!(!has(&unknown,"N_OPTIONAL_UPLOAD_CREATE"));
 let other=format!("{}invariant parents always exists photos[parent = .id]\n",CHILD.replace("add(photo: image <=10000 ?)","add(photo: image <=10000 ?, other:parents)").replace("parent:p.id","parent:other"));assert!(!has(&other,"N_OPTIONAL_UPLOAD_CREATE"));
}
#[test]fn zero_iteration_or_expression_conditional_siblings_cannot_discharge_required_evidence(){
 let base=CHILD.replace("add(photo: image <=10000 ?)","add(photo: image <=10000 ?, required: image <=10000, enabled: bool, photos: [image <=10000] <=4)");
 for sibling in ["  for image in photos:\n    insert photos {parent:p.id,photo:image}\n", "  extra = (insert photos {parent:p.id,photo:required}) if enabled else null\n"]{
  let s=base.replace("  if photo != null:",&format!("{sibling}  if photo != null:"));let s=format!("{s}invariant parents always exists photos[parent = .id]\n");assert!(has(&s,"N_OPTIONAL_UPLOAD_CREATE"));
 }
}
#[test]fn optional_return_photo_on_an_existing_rental_is_not_a_creation_gate(){
 let s=include_str!("security/wave23/040.q");assert!(!has(s,"N_OPTIONAL_UPLOAD_CREATE"));
}
#[test]fn stale_creation_names_the_approval_and_mutable_column_once(){
 let s=include_str!("security/wave23/030.q");let r=notes(s);let ns=r.notes.iter().filter(|n|n.code=="N_STALE_CREATION_CHECK").collect::<Vec<_>>();assert_eq!(ns.len(),1,"{ns:?}");
 for part in ["operatorFlags.suspended","submitApplication","approveApplication"]{assert!(ns[0].message.contains(part),"{part}: {ns:?}");}
 for unrelated in ["inspectApplication at","rejectApplication at","migrateInspectionRecorded at","trucks.owner"]{assert!(!ns[0].message.contains(unrelated),"{ns:?}");}
 assert_eq!(ns[0].message,notes(s).notes.into_iter().find(|n|n.code=="N_STALE_CREATION_CHECK").unwrap().message);
 let fixed=s.replace("  require app.lastPassed else DECISION_CONFLICTS","  require app.lastPassed else DECISION_CONFLICTS\n  require not exists operatorFlags[app.owner, suspended = true] else SUSPENDED");assert!(!has(&fixed,"N_STALE_CREATION_CHECK"));
}
#[test]fn stale_eligibility_rechecks_bind_the_applicant_and_every_mutable_column(){
 let s=include_str!("security/wave23/030.q");
 let wrong=s.replace("  require app.lastPassed else DECISION_CONFLICTS","  require app.lastPassed else DECISION_CONFLICTS\n  require not exists operatorFlags[viewer, suspended = true] else SUSPENDED");assert!(has(&wrong,"N_STALE_CREATION_CHECK"));
 let dual=s.replace("  suspended: bool", "  disabled: bool default false\n  suspended: bool").replace("flag.suspended = false", "(flag.suspended = false and flag.disabled = false)").replace("suspended: true }", "suspended: true, disabled:true }");
 let partial=dual.replace("  require app.lastPassed else DECISION_CONFLICTS","  require app.lastPassed else DECISION_CONFLICTS\n  require not exists operatorFlags[app.owner, suspended = true] else SUSPENDED");assert!(has(&partial,"N_STALE_CREATION_CHECK"));
 let complete=partial.replace("  require not exists operatorFlags[app.owner, suspended = true] else SUSPENDED","  require not exists operatorFlags[app.owner, suspended = true] else SUSPENDED\n  require not exists operatorFlags[app.owner, disabled = true] else DISABLED");assert!(!has(&complete,"N_STALE_CREATION_CHECK"));
}
#[test]fn separate_eligibility_dependencies_remain_two_grouped_questions(){
 let s=include_str!("security/wave23/030.q").replace("  flag = operatorFlags[viewer]", "  extra = extraFlags[viewer]\n  require extra = null or extra.suspended = false else EXTRA_SUSPENDED\n  flag = operatorFlags[viewer]");
 let s=format!("{s}\ntable extraFlags:\n  operator:principal\n  suspended:bool\n  unique operator\n  immutable operator\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation extraFlag(operator:principal,suspended:bool):\n  upsert extraFlags[operator] {{operator,suspended}}\n");let r=notes(&s);let ns=r.notes.iter().filter(|n|n.code=="N_STALE_CREATION_CHECK").collect::<Vec<_>>();assert_eq!(ns.len(),2,"{ns:?}");assert!(ns.iter().any(|n|n.message.contains("operatorFlags.suspended")));assert!(ns.iter().any(|n|n.message.contains("extraFlags.suspended")));
}
#[test]fn unmapped_callers_and_mutable_identity_aliases_never_prove_the_same_entity(){
 let s=include_str!("security/wave23/030.q");
 let wrong=s.replace("  require app.lastPassed else DECISION_CONFLICTS","  require app.lastPassed else DECISION_CONFLICTS\n  require not exists operatorFlags[viewer, suspended = true] else SUSPENDED").replace("immutable truck, owner, interiorPhotos", "immutable truck, interiorPhotos");assert!(has(&wrong,"N_STALE_CREATION_CHECK"));
 let alias=s.replace("  owner: principal\n  interiorPhotos:","  owner: principal\n  eligibilityOwner: principal\n  interiorPhotos:").replace("return insert applications { truck, owner: viewer,", "return insert applications { truck, owner: viewer, eligibilityOwner:viewer,").replace("  require app.lastPassed else DECISION_CONFLICTS","  require app.lastPassed else DECISION_CONFLICTS\n  require not exists operatorFlags[app.eligibilityOwner, suspended = true] else SUSPENDED");
 let alias=format!("{alias}\nmutation transferEligibility(application:applications, operator:principal):\n  update applications[application] {{eligibilityOwner:operator}}\n");assert!(has(&alias,"N_STALE_CREATION_CHECK"));
}
#[test]fn billing_asymmetry_names_the_private_column_and_its_owner_guard(){
 let s=include_str!("security/wave23/042.q");let r=notes(s);let ns=r.notes.iter().filter(|n|n.code=="N_PRIVATE_CREATE_EDIT_ASYMMETRY").collect::<Vec<_>>();assert_eq!(ns.len(),1,"{:?}",r.notes);
 for part in ["createSigning","signings.agencyBillingNotes","updateBilling","owner","write-only private"]{assert!(ns[0].message.contains(part),"{part}: {ns:?}");}
 assert!(!r.notes.iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"&&n.message.contains("agencyBillingNotes")));
 assert!(!r.notes.iter().any(|n|n.code.contains("CREATE_EDIT_ASYMMETRY")&&n.message.contains("signings.fee")));
 assert!(security::note_priority(&ns[0].code)<security::note_priority("N_INSERT_WRITE_INTENT"));
 let guarded=s.replace("  return insert signings {", "  require exists roles[principal = viewer, role = 'owner'] else OWNER\n  return insert signings {");assert!(!has(&guarded,"N_PRIVATE_CREATE_EDIT_ASYMMETRY"));
 let literal=s.replace("fee, agencyBillingNotes, outOfState:","fee, agencyBillingNotes:null, outOfState:");assert!(!has(&literal,"N_PRIVATE_CREATE_EDIT_ASYMMETRY"));
}
#[test]fn mixed_other_row_and_intervening_write_guards_do_not_become_this_columns_guard(){
 let s=include_str!("security/wave23/042.q");
 let mixed=s.replace("if agencyBillingNotes != s.agencyBillingNotes:","if agencyBillingNotes != s.agencyBillingNotes and fee > 1:");
 let other=s.replace("mutation updateBilling(signing: signings,", "mutation updateBilling(signing: signings, other: signings,").replace("  if agencyBillingNotes != s.agencyBillingNotes:","  otherRow = signings[other] ! else MISSING\n  if agencyBillingNotes != otherRow.agencyBillingNotes:");
 let intervening=s.replace("  update signings[signing] { fee, agencyBillingNotes }","  update signings[signing] { fee }\n  update signings[signing] { fee, agencyBillingNotes }");
 let early=s.replace("  if agencyBillingNotes != s.agencyBillingNotes:\n    require exists roles[principal = viewer, role = 'owner']", "  if agencyBillingNotes = s.agencyBillingNotes:\n    return null\n  require exists roles[principal = viewer, role = 'owner']");
 for s in [mixed,other,intervening,early]{let r=notes(&s);assert!(!r.notes.iter().any(|n|n.code=="N_PRIVATE_CREATE_EDIT_ASYMMETRY"));assert!(r.notes.iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"&&n.message.contains("agencyBillingNotes")));}
}
#[test]fn unguarded_edit_paths_are_unioned_and_public_columns_use_the_ordinary_asymmetry_rank(){
 let s=include_str!("security/wave23/042.q");
 let bypass=s.replace("  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF 'Only dispatch staff edits billing.'", "  if agencyBillingNotes != null:\n    update signings[signing] {agencyBillingNotes}\n    return null\n  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF");
 assert!(!has(&bypass,"N_PRIVATE_CREATE_EDIT_ASYMMETRY"));
 let public=s.lines().filter(|l|!l.trim_start().starts_with("read (fee,")).collect::<Vec<_>>().join("\n");assert!(has(&public,"N_CREATE_EDIT_ASYMMETRY"));assert!(!has(&public,"N_PRIVATE_CREATE_EDIT_ASYMMETRY"));
}
#[test]fn independent_billing_write_intent_has_a_nonnull_admitted_witness(){
 let own=include_str!("security/wave23/042.q");let s=format!("{}\ninvariant signings.agencyBillingNotes write only exists roles[principal = viewer, role = 'owner']\n",own.lines().filter(|l|!l.trim_start().starts_with("invariant ")).collect::<Vec<_>>().join("\n"));let b=bound(&s);let mut c=Campaign::default();challenges::generated_campaign(&b,&mut c,false);
 assert!(c.violations.iter().any(|v|v.reachability.is_reachable()&&v.operation=="createSigning"&&v.history.last().and_then(|s|s.args.get("agencyBillingNotes")).is_some_and(|v|*v!=snapback4_core::Value::Null)&&v.row.field("agencyBillingNotes").is_ok_and(|v|*v!=snapback4_core::Value::Null)),"no non-null replay among {} witnesses",c.violations.len());
 assert!(c.directed_attempts<=2048&&c.directed_peak_worlds<=16);
}
#[test]fn changed_field_guards_survive_a_helper_and_lexical_aliases(){
 let s="table roles:\n  principal: principal\n  role: enum('owner','writer')\n  unique principal\n  read <- allow\n  online only\ntable docs:\n  secret: text <=100 ? read <- exists roles[viewer,role = 'owner']\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation add(secret:text <=100 ?):\n  return insert docs {secret}\nfn editHelper(doc:docs,secret:text <=100 ?):\n  old = docs[doc] ! else MISSING\n  next = secret\n  if next != old.secret:\n    require exists roles[viewer,role = 'owner'] else OWNER\n  update docs[doc] {secret:next}\n  return null\nmutation edit(doc:docs,secret:text <=100 ?):\n  return editHelper(doc,secret)\n";
 assert!(has(s,"N_PRIVATE_CREATE_EDIT_ASYMMETRY"));
 let equality=s.replace("if next != old.secret:\n    require", "if next = old.secret:\n    next = secret\n  else:\n    require");assert!(has(&equality,"N_PRIVATE_CREATE_EDIT_ASYMMETRY"));
}
#[test]fn effectful_requirements_and_conditions_do_not_become_stable_edit_guards(){
 let s="table roles:\n  principal: principal\n  role: enum('owner','writer')\n  unique principal\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable docs:\n  secret: text <=100 ? read <- exists roles[viewer,role = 'owner']\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation add(secret:text <=100 ?):\n  return insert docs {secret}\nfn acquire():\n  upsert roles[viewer] {principal:viewer,role:'owner'}\n  return true\nmutation edit(doc:docs,secret:text <=100 ?):\n  old = docs[doc] ! else MISSING\n  if secret != old.secret:\n    require acquire() else ACQUIRE\n    require exists roles[viewer,role = 'owner'] else OWNER\n  update docs[doc] {secret}\n  return null\n";
 assert!(!has(s,"N_PRIVATE_CREATE_EDIT_ASYMMETRY"));
 let condition=s.replace("    require acquire() else ACQUIRE\n", "").replace("  update docs[doc] {secret}", "  if acquire():\n    update docs[doc] {secret}");assert!(!has(&condition,"N_PRIVATE_CREATE_EDIT_ASYMMETRY"));
}
#[test]fn an_emit_payload_write_ends_pending_column_authority(){
 let s=include_str!("security/wave23/042.q").replace("use identity password","use identity password\neffect changed").replace("  update signings[signing] { fee, agencyBillingNotes }", "  emit changed { value: (upsert roles[viewer] {principal:viewer,role:'owner'}) }\n  update signings[signing] { fee, agencyBillingNotes }");let r=notes(&s);assert!(!r.notes.iter().any(|n|n.code=="N_PRIVATE_CREATE_EDIT_ASYMMETRY"));assert!(r.notes.iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"&&n.message.contains("agencyBillingNotes")));
}
#[test]fn deleting_the_only_booking_photo_has_a_grouped_evidence_question(){
 let s=include_str!("security/wave23/028.q");let r=notes(s);let ns=r.notes.iter().filter(|n|n.code=="N_EVIDENCE_REMOVAL").collect::<Vec<_>>();assert_eq!(ns.len(),1,"{ns:?}");
 for part in ["vehicles.stay -> stays","removeVehicle","photo","last required"]{assert!(ns[0].message.contains(part),"{ns:?}");}
 let replacement=s.replace("mutation removeVehicle(vehicle: vehicles):","mutation removeVehicle(vehicle: vehicles, photo: image <=5000000):").replace("  delete vehicles[vehicle]","  update vehicles[vehicle] {photo}");assert!(!has(&replacement,"N_EVIDENCE_REMOVAL"));
}
#[test]fn optional_attachments_and_unrelated_parent_insertions_are_not_required_evidence(){
 let s=format!("{CHILD}mutation remove(photo: photos):\n  delete photos[photo]\n");assert!(!has(&s,"N_EVIDENCE_REMOVAL"));
 let required=s.replace("add(photo: image <=10000 ?)","add(photo: image <=10000)").replace("  if photo != null:\n    insert photos {parent:p.id,photo}","  insert photos {parent:p.id,photo}");assert!(has(&required,"N_EVIDENCE_REMOVAL"));
 let unrelated=required.replace("add(photo: image <=10000)","add(photo: image <=10000, other: parents)").replace("parent:p.id","parent:other");assert!(!has(&unrelated,"N_EVIDENCE_REMOVAL"));
}
#[test]fn evidence_detachment_and_clearing_are_distinct_from_ordinary_replacement(){
 let required=CHILD.replace("add(photo: image <=10000 ?)","add(photo: image <=10000)").replace("  if photo != null:\n    insert photos {parent:p.id,photo}","  insert photos {parent:p.id,photo}");
 let detach=format!("{required}mutation move(photo:photos,parent:parents):\n  update photos[photo] {{parent}}\n");assert!(has(&detach,"N_EVIDENCE_REMOVAL"));
 let same=format!("{required}mutation keep(photo:photos):\n  old = photos[photo] ! else MISSING\n  update photos[photo] {{parent:old.parent}}\n");assert!(!has(&same,"N_EVIDENCE_REMOVAL"));
 let clear=format!("{}mutation clear(photo:photos):\n  update photos[photo] {{photo:null}}\ninvariant photos always .photo != null\n",required.replace("  photo: image <=10000\n","  photo: image <=10000 ?\n"));assert!(has(&clear,"N_EVIDENCE_REMOVAL"));
}
#[test]fn separate_evidence_relationships_remain_two_questions(){
 let required=CHILD.replace("add(photo: image <=10000 ?)","add(photo: image <=10000)").replace("  if photo != null:\n    insert photos {parent:p.id,photo}","  insert photos {parent:p.id,photo}");
 let s=format!("{required}\ntable scans:\n  parent:parents\n  photo:image <=10000\n  read <- allow\n  insert <- allow\n  delete <- allow\n  online only\nmutation addScan(photo:image <=10000):\n  p = insert parents {{}}\n  insert scans {{parent:p.id,photo}}\nmutation removePhoto(photo:photos):\n  delete photos[photo]\nmutation removeScan(scan:scans):\n  delete scans[scan]\n");let r=notes(&s);let ns=r.notes.iter().filter(|n|n.code=="N_EVIDENCE_REMOVAL").collect::<Vec<_>>();assert_eq!(ns.len(),2,"{ns:?}");assert!(ns.iter().any(|n|n.message.contains("photos.parent")));assert!(ns.iter().any(|n|n.message.contains("scans.parent")));
}
#[test]fn carried_optional_evidence_keeps_advice_without_an_inferred_gate(){
 let s=include_str!("security/wave23/018.q");assert!(!has(s,"N_OPTIONAL_UPLOAD_CREATE"));assert!(has(s,"N_OPTIONAL_EVIDENCE"));
}
