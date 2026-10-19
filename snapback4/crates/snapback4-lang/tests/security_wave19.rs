//! Wave-19 security regressions: trust belongs to authored fixtures, not proposals.
use snapback4_lang::{compile,security::{self,challenges::{self,Campaign,Reachability}}};
use snapback4_core::{Engine,Value};
fn bind(source:&str)->snapback4_lang::Bound{let b=compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b}
const ROLES:&str="use identity password\ntable roles:\n  principal: principal\n  role: enum('doctor','volunteer')\n  unique principal\n  read <- allow\n  insert <- viewer = 'service:operator'\n  update <- viewer = 'service:operator'\n  online only\n";
fn row(fields:Vec<(&str,Value)>)->Value{Value::Row(fields.into_iter().map(|(k,v)|(k.into(),v)).collect())}
fn id(v:&str)->Value{Value::Id(v.into())}
#[test]
fn authored_seed_read_and_integrity_refutations_fail_without_an_initialization_history(){
 let b=bind("table docs:\n  owner: principal\n  approved: bool\n  read <- allow\n  online only\ninvariant docs.read only .owner = viewer\ninvariant docs always not .approved\n");
 let mut e=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
 e.seed_at([("docs".into(),row(vec![("id",id("doc")),("owner",id("dev:owner")),("approved",Value::Bool(true))]))],challenges::NOW).unwrap();
 let mut c=Campaign::default();challenges::fixture_observers(&b,&e,&mut c);
 for inv in &b.invariants{assert!(c.violations.iter().any(|v|v.invariant_site==inv.site.to_string()&&v.reachability.is_reachable()),"{} {c:?}",inv.target);}
 let mut r=security::analyze(&b);challenges::apply(&mut r,&c);assert!(r.refuted());
 let synthetic=challenges::run(&b);assert!(synthetic.violations.iter().all(|v|!v.reachability.is_reachable()));
}
#[test]
fn generated_payloads_preserve_creator_copies_and_cold_approval_requirements(){
 let source=format!("{ROLES}table homes:\n  owner: principal\n  read <- allow\n  insert <- allow\n  online only\ntable reports:\n  home: homes\n  homeowner: principal\n  coldApproved: bool\n  reason: text <=40 ?\n  read <- allow\n  insert <- allow\n  online only\nmutation file(home: homes):\n  h = homes[home] ! else MISSING\n  return insert reports {{home,homeowner: h.owner,coldApproved: false,reason: null}}\ninvariant reports always not .coldApproved or .reason != null\n");
 let b=bind(&source);let mut c=Campaign::default();let e=challenges::generated_fixture(&b,&mut c).unwrap();
 let homes=e.store().rows("homes").unwrap();let reports=e.store().rows("reports").unwrap();assert!(!reports.is_empty(),"{c:?}");
 for r in reports{let home=homes.iter().find(|h|h.field("id")==r.field("home")).unwrap();assert_eq!(r.field("homeowner"),home.field("owner"));assert_eq!(r.field("coldApproved").unwrap(),&Value::Bool(false));}
 challenges::fixture_observers(&b,&e,&mut c);assert!(c.violations.is_empty(),"{c:?}");
}
#[test]
fn generated_assignments_obey_authored_recipient_role_guards(){
 let source=format!("{ROLES}table assignments:\n  assignee: principal\n  read <- .assignee = viewer\n  insert <- exists roles[viewer,role = 'doctor']\n  online only\nmutation assign(who: principal):\n  require exists roles[principal = who,role = 'doctor'] else WRONG_ROLE\n  return insert assignments {{assignee: who}}\ninvariant assignments.read only exists roles[viewer,role = 'doctor']\nquery mine():\n  return assignments first 50 by .id\n");
 let b=bind(&source);let mut c=Campaign::default();let e=challenges::generated_fixture(&b,&mut c).unwrap();let rs=e.store().rows("assignments").unwrap();assert!(!rs.is_empty(),"{c:?}");
 assert!(rs.iter().all(|r|r.field("assignee").unwrap().as_str().unwrap().contains("doctor")));
 challenges::fixture_observers(&b,&e,&mut c);assert!(c.violations.is_empty(),"{c:?}");
}
#[test]
fn generated_rows_cannot_bypass_an_impossible_insert_gate(){
 let b=bind("table secrets:\n  owner: principal\n  read <- allow\n  insert <- deny\n  online only\ninvariant secrets.read only .owner = viewer\nquery all():\n  return secrets first 50 by .id\n");
 let mut c=Campaign::default();let e=challenges::generated_fixture(&b,&mut c).unwrap();assert!(e.store().rows("secrets").unwrap().is_empty());challenges::fixture_observers(&b,&e,&mut c);assert!(c.violations.is_empty());assert!(c.unsupported.iter().any(|s|s.contains("no admitted insert")));
}
#[test]
fn negative_existence_column_intent_only_refutes_the_excluded_role(){
 let b=bind(&format!("{ROLES}table docs:\n  body: text <=40\n  read <- allow\n  insert <- allow\n  online only\ninvariant docs.body read only not exists roles[viewer,role = 'volunteer']\nquery all():\n  return docs first 50 by .id\n"));
 let mut c=Campaign::default();c.generated_fixture=true;let e=challenges::generated_fixture(&b,&mut c).unwrap();challenges::fixture_observers(&b,&e,&mut c);
 assert!(c.violations.iter().any(|v|v.viewer.contains("volunteer")),"{c:?}");assert!(c.violations.iter().all(|v|v.viewer.contains("volunteer")),"{c:?}");
}
#[test]
fn update_only_column_intent_ignores_an_unchanged_optional_column(){
 let b=bind("table units:\n  statusReason: text <=40 ?\n  inspected: bool\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation inspect(unit: units):\n  update units[unit] {inspected: true}\n  return null\ninvariant units.statusReason update only viewer = 'service:operator'\n");
 let mut c=Campaign::default();challenges::generated_campaign(&b,&mut c,false);assert!(c.operations.contains_key("inspect"));assert!(c.violations.iter().all(|v|!v.reachability.is_reachable()),"{c:?}");
}
#[test]
fn text_role_guard_literals_exercise_register_staff_itself(){
 let b=bind("table staff:\n  principal: principal\n  role: enum('physician','operator','patient')\n  unique principal\n  read <- allow\n  insert <- .principal = viewer\n  online only\nmutation foundUnit():\n  return insert staff {principal: viewer,role: 'physician'}\nmutation registerStaff(role: text 1..20):\n  require role = 'operator' or role = 'patient' else WRONG_ROLE\n  return insert staff {principal: viewer,role}\ninvariant staff.role write only viewer = 'service:operator'\n");
 let mut c=Campaign::default();challenges::generated_campaign(&b,&mut c,false);assert!(c.violations.iter().any(|v|v.reachability==Reachability::AuthoredFixtureTrace&&v.history.iter().any(|s|s.operation=="registerStaff"&&s.args.get("role")==Some(&Value::String("operator".into())))),"{c:?}");
}

#[test]
fn a_committed_role_change_retains_the_assignment_and_fails_the_current_role_intent(){
 let b=bind(&format!("{ROLES}table jobs:\n  worker: principal\n  body: text <=40\n  read <- .worker = viewer\n  online only\nmutation provision(who: principal, role: enum('doctor','volunteer')):\n  update roles[who] {{role}}\n  return null\nquery jobs():\n  return jobs first 50 by .id\ninvariant jobs.body read only exists roles[viewer,role = 'doctor']\n"));
 let mut e=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
 e.seed_at([("roles".into(),row(vec![("id",id("role")),("principal",id("dev:worker")),("role",Value::String("doctor".into()))])),("jobs".into(),row(vec![("id",id("job")),("worker",id("dev:worker")),("body",Value::String("private".into()))]))],challenges::NOW).unwrap();
 let mut c=Campaign::default();challenges::fixture_observers(&b,&e,&mut c);
 assert!(c.violations.iter().any(|v|v.reachability==Reachability::AuthoredFixtureTrace&&v.operation=="jobs"&&v.history.iter().any(|s|s.operation=="provision"&&s.args.get("role")==Some(&Value::String("volunteer".into()))&&s.result["state"]=="sent")),"{c:?}");
}

#[test]
fn retained_assignment_advice_survives_absent_independent_role_intent(){
 let b=bind(&format!("{ROLES}table jobs:\n  body: text <=40\n  read <- exists assignments[job = .id, worker = viewer]\n  online only\ntable assignments:\n  job: jobs\n  worker: principal\n  unique job,worker\n  read <- allow\n  insert <- exists roles[viewer,role = 'doctor']\n  online only\nmutation role(who: principal, role: enum('doctor','volunteer')):\n  update roles[who] {{role}}\n  return null\n"));
 assert!(security::analyze(&b).notes.iter().any(|n|n.code=="N_GRANT_OUTLIVES_ROLE"&&n.message.contains("jobs.read")&&n.message.contains("assignments")));
}

#[test]
fn an_alternate_copied_immutable_owner_cannot_invent_a_disclosure(){
 let b=bind("table homes:\n  owner: principal\n  read <- allow\n  insert <- allow\n  online only\ntable reports:\n  home: homes\n  homeowner: principal\n  immutable home,homeowner\n  read <- .homeowner = viewer\n  insert <- allow\n  online only\nmutation file(home: homes):\n  h = homes[home] ! else MISSING\n  return insert reports {home,homeowner: h.owner}\nquery mine():\n  return reports where .homeowner = viewer first 50 by .id\ninvariant reports.homeowner read only .home.owner = viewer\n");
 let mut c=Campaign::default();challenges::generated_campaign(&b,&mut c,false);assert!(c.violations.is_empty(),"{c:?}");assert!(c.unsupported.iter().any(|s|s.contains("creator/guard coupling")),"{c:?}");
}

#[test]
fn optional_role_columns_still_get_two_active_principals_per_role(){
 let b=bind("table roles:\n  principal: principal\n  role: enum('doctor','volunteer') ?\n  unique principal\n  read <- allow\n  insert <- viewer = 'service:operator'\n  online only\n");
 let mut c=Campaign::default();let fixture=challenges::generated_fixture(&b,&mut c).unwrap();let roles=fixture.store().rows("roles").unwrap();
 for role in ["doctor","volunteer"]{assert_eq!(roles.iter().filter(|r|r.field("role").ok()==Some(&Value::String(role.into()))).count(),2,"{c:?}");}
}

#[test]
fn a_post_insert_guard_through_the_returned_row_preserves_owner_coupling(){
 let b=bind("table homes:\n  owner: principal\n  read <- allow\n  insert <- allow\n  online only\ntable reports:\n  home: homes\n  homeowner: principal\n  immutable home,homeowner\n  read <- .homeowner = viewer\n  insert <- allow\n  online only\nmutation file(home: homes, homeowner: principal):\n  r = insert reports {home,homeowner}\n  h = homes[home] ! else MISSING\n  require r.homeowner = h.owner else WRONG_OWNER\n  return r\nquery mine():\n  return reports where .homeowner = viewer first 50 by .id\ninvariant reports.homeowner read only .home.owner = viewer\n");
 let mut e=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
 e.seed_at([("homes".into(),row(vec![("id",id("h")),("owner",id("dev:owner"))])),("reports".into(),row(vec![("id",id("r")),("home",id("h")),("homeowner",id("dev:owner"))]))],challenges::NOW).unwrap();
 let args=std::collections::BTreeMap::from([("home".into(),id("h")),("homeowner".into(),id("dev:security-a"))]);
 let rejected=e.mutate("file",None,snapback4_core::Context::new("dev:security-a",args).at(challenges::NOW)).unwrap();
 assert!(matches!(rejected.state,snapback4_core::WriteState::Failed{..}));
 let observed=e.query("mine",snapback4_core::Context::new("dev:security-a",std::collections::BTreeMap::new()).at(challenges::NOW)).unwrap();assert_eq!(observed.data,Value::Array(Vec::new()));
 let mut c=Campaign::default();challenges::fixture_observers(&b,&e,&mut c);
 assert!(c.violations.is_empty(),"{c:?}");assert!(c.unsupported.iter().any(|s|s.contains("creator/guard coupling")),"{c:?}");
}
