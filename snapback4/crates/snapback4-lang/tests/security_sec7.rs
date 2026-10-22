//! SEC7 wave-22 regressions: questions are distinct from actual replayed catches.
use snapback4_lang::{compile,security::{self,challenges::{self,Campaign}}};
fn bound(s:&str)->snapback4_lang::Bound{let b=compile(&[("schema.q".into(),s.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b}
fn notes(s:&str)->security::Report{let b=bound(s);let mut r=security::analyze_rules(&b);security::add_source_notes(&mut r,&[("schema.q".into(),s.into())],&b);r}
#[test]fn wave22_findings_have_located_notes_without_invariants(){
 for (source,codes) in [
 (include_str!("security/wave22/004.q"),vec!["N_TRANSITION_BYPASS"]),
 (include_str!("security/wave22/011.q"),vec!["N_ROLE_WIDE_WRITE"]),
 (include_str!("security/wave22/021.q"),vec!["N_RETAINED_ROLE_GRANT"]),
 (include_str!("security/wave22/026.q"),vec!["N_ROLE_WIDE_READ"]),
 (include_str!("security/wave22/030.q"),vec!["N_STALE_CREATION_CHECK"]),
 (include_str!("security/wave22/040.q"),vec!["N_OPTIONAL_UPLOAD_CREATE","N_CREATION_REASON"]),
 (include_str!("security/wave22/044.q"),vec!["N_CONSTANT_APPROVAL","N_DURATION_BOUNDS"]),
 ]{let s=source.lines().filter(|l|!l.starts_with("invariant ")).collect::<Vec<_>>().join("\n");let r=notes(&s);
 for code in codes{assert!(r.notes.iter().any(|n|n.code==code&&n.site.line>0),"missing {code}: {:?}",r.notes);}}
}
const DOCS:&str="table docs:\n  owner: principal\n  photo: image <=10000 ?\n  price: int ?\n  reason: text <=100 ?\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\n";
#[test]fn optional_upload_guard_and_alias_controls(){
 for guard in ["","  require photo != null else REQUIRED\n"]{
 let s=format!("{DOCS}mutation add(photo: image <=10000 ?):\n{guard}  alias = photo\n  return insert docs {{owner:viewer,photo:alias,price:null,reason:null}}\n");let r=notes(&s);
 assert_eq!(r.notes.iter().any(|n|n.code=="N_OPTIONAL_UPLOAD_CREATE"),guard.is_empty(),"{:?}",r.notes);
 }
 let s=format!("{DOCS}mutation edit(photo: image <=10000 ?):\n  if photo != null:\n    return insert docs {{owner:viewer,photo,price:null,reason:null}}\n  return null\n");assert!(notes(&s).notes.iter().any(|n|n.code=="N_OPTIONAL_UPLOAD_CREATE"));
}
#[test]fn optional_money_and_positive_reason_minimum(){
 let s=format!("{DOCS}mutation add(price: int ?, reason: text 1..100 ?):\n  return insert docs {{owner:viewer,photo:null,price,reason}}\n");let r=notes(&s);assert!(r.notes.iter().any(|n|n.code=="N_CREATION_MONEY"));assert!(!r.notes.iter().any(|n|n.code=="N_CREATION_REASON"));
}
#[test]fn retained_grant_gate_requires_recipient_not_assigner_and_current_role_silences_it(){
 let s=include_str!("security/wave22/021.q");
 for source in [s.replace("  require exists roles[driver, role = 'driver'] else NOT_DRIVER\n",""),s.replace("or exists driverRoutes[viewer, route = .route]","or (exists roles[viewer, role = 'driver'] and exists driverRoutes[viewer, route = .route])")]{assert!(!notes(&source).notes.iter().any(|n|n.code=="N_RETAINED_ROLE_GRANT"));}
}
#[test]fn default_filled_and_literal_insert_columns_are_quiet(){
 let s="table docs:\n  n: int default 0\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation add():\n  return insert docs {}\nmutation literal():\n  return insert docs {n:42}\nmutation edit(doc: docs,n: int):\n  require viewer = 'service:editor' else NO\n  update docs[doc] {n}\n";
 assert!(!notes(s).notes.iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"));
 let s=s.replace("mutation literal():","mutation literal(n: int):").replace("{n:42}","{n}");assert!(notes(&s).notes.iter().any(|n|n.code=="N_INSERT_WRITE_INTENT"));
}
#[test]fn audit_prioritizes_holes_and_sorts_sites_numerically(){
 let mut r=notes(DOCS);r.notes.clear();for (line,code) in [(101,"N_ROLE_WIDE_READ"),(41,"N_ROLE_WIDE_READ"),(1,"N_COLUMN_RESULT_EXPOSURE")]{r.notes.push(snapback4_lang::Diagnostic::new(&snapback4_lang::Site::new("schema.q",line,1),code,"question","repair"));}
 let text=r.action_text(1);assert!(text.contains("schema.q:41:1"));assert!(text.find("schema.q:41:1")<text.find("schema.q:101:1"));assert!(!text.contains("schema.q:1:1 N_COLUMN"));
}
#[test]fn result_notes_group_per_table_and_keep_each_observer(){
 let s="table docs:\n  secret: int\n  title: int\n  read <- allow\n  insert <- allow\n  online only\nquery publicList():\n  return docs first 5 by .id {id,title}\nquery full(doc: docs):\n  return docs[doc]\nmutation add(secret:int):\n  return insert docs {secret,title:1}\n";
 let r=notes(s);let ns=r.notes.iter().filter(|n|n.code=="N_COLUMN_RESULT_EXPOSURE").collect::<Vec<_>>();assert_eq!(ns.len(),1);for name in ["full","add","secret"]{assert!(ns[0].message.contains(name),"missing {name}: {:?}",ns);}
}
#[test]fn directed_wave22_pickup_and_suspension_refute_spec_intent(){
 for (lane,source) in [("026",include_str!("security/wave22/026-spec.q")),("030",include_str!("security/wave22/030-spec.q"))]{
 let b=bound(source);let mut c=Campaign::default();challenges::generated_campaign(&b,&mut c,false);
 assert!(c.violations.iter().any(|v|v.reachability.is_reachable()),"{lane}: {}",serde_json::to_string(&c).unwrap());
 }
}

#[test]fn wave22_judgment_case_keeps_independent_column_intent(){
 let own=bound(include_str!("security/wave22/037.q"));let spec=bound(include_str!("security/wave22/037-spec.q"));
 assert!(!own.invariants.is_empty());let mut c=Campaign::default();challenges::generated_campaign(&spec,&mut c,false);
 let mut report=security::analyze_rules(&spec);challenges::apply(&mut report,&c);
 assert!(report.refuted(),"{}",serde_json::to_string(&c).unwrap());
 assert!(c.violations.iter().any(|v|v.reachability.is_reachable()&&v.invariant_site==spec.invariants[0].site.to_string()));
}

#[test]fn a_branch_local_upload_guard_cannot_clear_an_unguarded_alternate_creation(){
 let s=format!("{DOCS}mutation add(photo: image <=10000 ?, guarded: bool):\n  if guarded:\n    require photo != null else REQUIRED\n    return insert docs {{owner:viewer,photo,price:null,reason:null}}\n  return insert docs {{owner:viewer,photo,price:null,reason:null}}\n");
 assert!(notes(&s).notes.iter().any(|n|n.code=="N_OPTIONAL_UPLOAD_CREATE"));
}
#[test]fn cross_table_insert_results_preserve_original_secret_lineage(){
 for gate in [""," read <- .owner = viewer"]{for projected in [false,true]{for absent in [false,true]{
 let s=format!("table secrets:\n  owner: principal\n  secret: text <=40\n  title: text <=40\n  read <- allow\n  online only\ntable copies:\n  owner: principal\n  value: text <=40{gate}\n  unique owner\n  read <- allow\n  insert <- allow\n  online only\nquery publicList():\n  return secrets first 5 by .id {{id,title}}\nmutation copy(secret: secrets):\n  s = secrets[secret] ! else MISSING\n  return insert copies {{owner:viewer,value:s.secret}}\n");
 let expression=format!("insert copies {{owner:viewer,value:s.secret}}{}",if absent{" if absent"}else{""});
 let replacement=if projected{format!("  copied = {expression}\n  return copied.value if copied != null else null")}else{format!("  return {expression}")};
 let s=s.replace("  return insert copies {owner:viewer,value:s.secret}",&replacement);
 let r=notes(&s);assert!(r.notes.iter().any(|n|n.code=="N_COLUMN_RESULT_EXPOSURE"&&n.message.starts_with("secrets:")&&n.message.contains("copy at")),"{:?}",r.notes);
 }}}
}
#[test]fn companion_principal_in_a_role_probe_is_not_the_recipient_role(){
 let s=include_str!("security/wave22/021.q").replace("  role: enum('customer', 'attendant', 'driver', 'owner')","  assistant: principal ?\n  role: enum('customer', 'attendant', 'driver', 'owner')").replace("require exists roles[driver, role = 'driver'] else NOT_DRIVER","require exists roles[viewer, role = 'owner', assistant = driver] else NOT_DRIVER");
 assert!(!notes(&s).notes.iter().any(|n|n.code=="N_RETAINED_ROLE_GRANT"));
}

#[test]fn directed_boolean_lifecycle_keeps_role_revocation_between_open_and_finalize(){
 let b=bound("use personas alice\ntable roles:\n  principal: principal\n  role: enum('member','revoked')\n  unique principal\n  read <- allow\n  update <- viewer = 'service:ops'\n  online only\ntable docs:\n  owner: principal\n  opened: bool default false\n  finished: bool default false\n  read <- allow\n  update <- .owner = viewer\n  online only\nmutation open(doc: docs):\n  require exists roles[viewer,role = 'member'] else NO_ROLE\n  update docs[doc] {opened:true}\n  return null\nmutation revoke(principal: principal):\n  require viewer = 'service:ops' else NO_OPS\n  update roles[principal] {role:'revoked'}\n  return null\nmutation finalize(doc: docs):\n  d = docs[doc] ! else MISSING\n  require d.opened else NOT_OPEN\n  update docs[doc] {finished:true}\n  return null\ninvariant docs.finished update only exists roles[viewer,role = 'member']\n");
 let mut e=snapback4_core::Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
 let row=|pairs:Vec<(&str,snapback4_core::Value)>|snapback4_core::Value::Row(pairs.into_iter().map(|(k,v)|(k.into(),v)).collect());
 use snapback4_core::Value as V;
 e.seed_at([("roles".into(),row(vec![("id",V::Id("role".into())),("principal",V::Id("dev:alice".into())),("role",V::String("member".into()))])),("docs".into(),row(vec![("id",V::Id("doc".into())),("owner",V::Id("dev:alice".into()))]))],challenges::NOW).unwrap();
 let mut c=Campaign::default();challenges::fixture_observers(&b,&e,&mut c);
 assert!(c.violations.iter().any(|v|v.reachability.is_reachable()&&v.operation=="finalize"&&v.history.len()>=3),"{}",serde_json::to_string(&c).unwrap());
 assert!(c.directed_peak_worlds<=16,"retained {} worlds",c.directed_peak_worlds);
 assert!(c.directed_attempts<=2048);
}

#[test]fn a_different_rows_owner_does_not_suppress_the_target_write_question(){
 let source="table roles:\n  principal: principal\n  role: enum('owner','guest')\n  unique principal\n  read <- allow\n  online only\ntable docs:\n  owner: principal\n  signedBy: principal ?\n  read <- allow\n  update <- exists roles[viewer,role = 'owner']\n  online only\nmutation sign(target: docs, other: docs):\n  require exists roles[viewer,role = 'owner'] else NO_ROLE\n  o = docs[other] ! else MISSING\n  require o.owner = viewer else NOT_OWNER\n  update docs[target] {signedBy:viewer}\n  return null\n";
 assert!(notes(source).notes.iter().any(|n|n.code=="N_ROLE_WIDE_WRITE"));
 assert!(!notes(&source.replace("o = docs[other]","o = docs[target]")).notes.iter().any(|n|n.code=="N_ROLE_WIDE_WRITE"));
}

#[test]fn parent_ownership_probes_are_not_assignment_key_gates(){
 for source in [include_str!("security/wave22/001.q"),include_str!("security/wave22/009.q"),include_str!("security/wave22/041.q")]{
  assert!(!notes(source).notes.iter().any(|n|n.code=="N_RETAINED_ROLE_GRANT"));
 }
}

#[test]fn retained_grant_keys_and_column_payloads_are_gated(){
 let source=include_str!("security/wave22/021.q").replace("upsert driverRoutes[driver] { driver, route }","upsert driverRoutes[driver] { route }");
 assert!(notes(&source).notes.iter().any(|n|n.code=="N_RETAINED_ROLE_GRANT"));
 let source=source.replace("  priceCents: int 0..1000000","  priceCents: int 0..1000000 read <- exists driverRoutes[viewer, route = .route]").replace("read <- .customer = viewer or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'owner'] or exists driverRoutes[viewer, route = .route]","read <- allow");
 assert!(notes(&source).notes.iter().any(|n|n.code=="N_RETAINED_ROLE_GRANT"&&n.message.starts_with("orders.priceCents read")));
 let source=source.replace("read <- exists driverRoutes[viewer, route = .route]","read <- exists roles[viewer,role = 'driver'] and exists driverRoutes[viewer, route = .route]");
 assert!(!notes(&source).notes.iter().any(|n|n.code=="N_RETAINED_ROLE_GRANT"));
}
