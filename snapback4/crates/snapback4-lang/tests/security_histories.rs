use snapback4_lang::{compile,security};
use snapback4_core::{Engine,Value};
const SOURCE:&str="use personas alice, bob\ntable roles:\n  principal: principal\n  role: enum('inspector', 'member')\n  unique principal\n  read <- allow\n  insert <- viewer = 'service:ops'\n  update <- viewer = 'service:ops'\n  online only\ntable grants:\n  principal: principal\n  unique principal\n  read <- allow\n  insert <- viewer = 'service:ops'\n  online only\ntable reports:\n  body: text <=80\n  read <- exists grants[viewer]\n  online only\nmutation grant(who: principal):\n  return insert grants { principal: who }\nmutation demote(who: principal):\n  update roles[who] { role: 'member' }\n  return null\ninvariant reports.read only exists roles[viewer, role = 'inspector']\nquery inspect(report: reports):\n  return reports[report]\n";
fn row(fields:&[(&str,Value)])->Value{Value::Row(fields.iter().map(|(n,v)|(n.to_string(),v.clone())).collect())}
// @ref LLP 3000.036.004.001#read-payloads — typed read histories include the admitted terminal query.
fn observed_tail(v:&security::challenges::Counterexample)->bool {
 v.history.last().is_some_and(|step|step.operation==v.operation&&step.viewer==v.viewer&&step.args==v.args&&step.clock.is_some()&&step.result["state"]=="observed"&&step.result["complete"].is_boolean()&&step.observed_data.is_some())
}
#[test]
fn actual_grant_demotion_and_read_has_a_replayable_trace(){
 for fixed in [false,true]{
  let source=if fixed{SOURCE.replace("read <- exists grants[viewer]","read <- exists grants[viewer] and exists roles[viewer, role = 'inspector']")}else{SOURCE.into()};
  let b=compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
  let mut fixture=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
  fixture.seed_at(vec![("roles".into(),row(&[("id",Value::Id("role-a".into())),("principal",Value::Id("dev:security-a".into())),("role",Value::String("inspector".into()))])),
   ("reports".into(),row(&[("id",Value::Id("report".into())),("body",Value::String("private".into()))]))],1_800_000_000_000).unwrap();
  let mut c=security::challenges::Campaign::default();security::challenges::operations(&b,&fixture,&mut c);
  assert!(c.sequences>0);assert_eq!(c.violations.is_empty(),fixed,"{c:?}");
  if !fixed{assert!(c.violations.iter().any(|v|v.history.iter().any(|s|s.operation=="grant")&&v.history.iter().any(|s|s.operation=="demote")),"{c:?}");}
 }
}
#[test]
fn all_named_service_seats_and_enum_argument_tuples_are_exercised(){
 let b=compile(&[("schema.q".into(),"use personas alice, bob\ntable notes:\n  role: text <=20\n  read <- viewer = 'service:one' or viewer = 'service:two'\n  online only\ninvariant notes.read only viewer != 'service:policy-only'\nquery inspect(a: enum('one','two','three'), b: enum('x','y'), c: enum('u','v') ?):\n  require viewer != 'service:program-only' else DIFFERENT_SEAT\n  return { a, b, c, who: viewer }\n".into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let fixture=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
 let mut c=security::challenges::Campaign::default();security::challenges::operations(&b,&fixture,&mut c);
 // Four generic viewers, two personas and four seats (including operation-only
 // and intent-only literals) × eighteen tuples, including nullable variants.
 assert_eq!(c.operations["inspect"],10*18,"{c:?}");
}

#[test]
fn generated_foreign_asset_and_non_image_challenges_use_real_ledgers(){
 let b=compile(&[("schema.q".into(),"table photos:\n  owner: principal\n  image: image <=5000\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\ntable documents:\n  owner: principal\n  attachment: file <=5000 ('application/pdf')\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nmutation photo(image: image <=5000):\n  return insert photos { owner: viewer, image }\nmutation attach(attachment: file <=5000 ('application/pdf')):\n  return insert documents { owner: viewer, attachment }\n".into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let fixture=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
 let mut c=security::challenges::Campaign::default();security::challenges::operations(&b,&fixture,&mut c);
 assert!(c.boundary_failures.is_empty(),"{c:?}");
 assert_eq!(c.attempted,15,"all ordinary and hostile ledger cases run: {c:?}");
 assert_eq!(c.refused,3,"foreign image/file and non-image placement must refuse: {c:?}");
 assert_eq!(c.operations["photo"],10,"two verified image samples for each of four ordinary viewers, plus foreign-image and non-image ledger challenges: {c:?}");
 assert_eq!(c.operations["attach"],5,"four ordinary viewers plus the foreign-file ledger challenge: {c:?}");
}

#[test]
fn populated_media_maintained_and_expiring_fixtures_replay_without_reseeding(){
 const NOW:i64=1_800_000_000_000;
 let source=SOURCE.replace("  body: text <=80", "  body: text <=80\n  photo: image <=5000\n  until: time\n  expire at .until")+"\nview reportTotal: count reports\n";
 let b=compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let mut fixture=Engine::new_at(snapback4_core::Store::memory().unwrap(),b.schema.clone(),b.programs.iter().map(|p|p.program.clone()),NOW).unwrap();
 let png=[137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1];
 let photo=fixture.store_asset("service:ops",&png,NOW).unwrap().column_value();
 fixture.seed_at([
  ("roles".into(),row(&[("id",Value::Id("role-a".into())),("principal",Value::Id("dev:fixture-only".into())),("role",Value::String("inspector".into()))])),
  ("grants".into(),row(&[("id",Value::Id("grant-a".into())),("principal",Value::Id("dev:fixture-only".into()))])),
  ("reports".into(),row(&[("id",Value::Id("report".into())),("body",Value::String("private".into())),("photo",photo.clone()),("until",Value::Int(NOW+100_000))]))
 ],NOW).unwrap();
 let before=fixture.store().rows("reports").unwrap();let derived=fixture.store().rows("reportTotal").unwrap();
 let fork=fixture.store().fork_memory().unwrap();let directory=fork.asset_location().unwrap().directory().to_path_buf();
 assert_eq!(fork.rows("reportTotal").unwrap(),derived);assert_eq!(fork.rows("reports").unwrap(),before);assert!(directory.exists());drop(fork);assert!(!directory.exists(),"fork assets must clean up");
 let mut c=security::challenges::Campaign::default();security::challenges::operations(&b,&fixture,&mut c);
 assert!(c.sequences>0,"{c:?}");assert!(c.operations.contains_key("inspect"));
 assert!(c.violations.iter().any(|v|v.viewer=="dev:fixture-only"&&v.history.iter().any(|s|s.operation=="demote")),"{c:?}");
 assert!(!c.unsupported.iter().any(|s|s.contains("maintained aggregate; write")||s.contains("E_RECORDED_FIELD")),"{c:?}");
 assert_eq!(fixture.store().rows("reports").unwrap(),before);assert_eq!(fixture.store().rows("reportTotal").unwrap(),derived);
}

#[test]
fn claim_then_return_is_not_a_pre_write_column_disclosure(){
 let source="table notes:\n  owner: principal\n  body: text <=80\n  read <- allow\n  update <- allow\n  online only\ninvariant notes.body read only .owner = viewer\nmutation claim(note: notes):\n  update notes[note] { owner: viewer }\n  n = notes[note] ! else NOT_FOUND\n  return n.body\n";
 let b=compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let mut fixture=Engine::new_at(snapback4_core::Store::memory().unwrap(),b.schema.clone(),b.programs.iter().map(|p|p.program.clone()),1_800_000_000_000).unwrap();
 fixture.seed_at([("notes".into(),row(&[("id",Value::Id("n".into())),("owner",Value::Id("dev:fixture-owner".into())),("body",Value::String("secret".into()))]))],1_800_000_000_000).unwrap();
 let mut c=security::challenges::Campaign::default();security::challenges::operations(&b,&fixture,&mut c);assert!(c.violations.is_empty(),"{c:?}");assert!(c.unsupported.iter().any(|s|s.contains("before disclosure")));
}
#[test]
fn future_policy_probes_are_not_live_and_authored_deletes_are_checked(){
 let source="table bans:\n  principal: principal\n  starts: time\n  unique principal\n  not before .starts\n  read <- allow\n  online only\ntable notes:\n  body: text <=80\n  read <- not exists bans[viewer]\n  delete <- allow\n  online only\ninvariant notes.body read only not exists bans[viewer]\ninvariant notes.delete only viewer = 'service:ops'\nquery inspect(note: notes):\n  return notes[note]\nmutation remove(note: notes):\n  delete notes[note]\n  return null\n";
 let b=compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let now=1_800_000_000_000;let mut fixture=Engine::new_at(snapback4_core::Store::memory().unwrap(),b.schema.clone(),b.programs.iter().map(|p|p.program.clone()),now).unwrap();
 fixture.seed_at([("notes".into(),row(&[("id",Value::Id("n".into())),("body",Value::String("secret".into()))])),("bans".into(),row(&[("id",Value::Id("b".into())),("principal",Value::Id("dev:fixture-only".into())),("starts",Value::Int(now+100_000))]))],now).unwrap();
 let mut c=security::challenges::Campaign::default();security::challenges::operations(&b,&fixture,&mut c);
 assert!(!c.violations.iter().any(|v|v.effect=="column read observation"),"{c:?}");
 assert!(c.violations.iter().any(|v|v.effect=="delete"&&v.reachability==security::challenges::Reachability::AuthoredFixtureTrace),"{c:?}");
}

#[test]
fn column_observers_recheck_fixture_roles_after_demotion(){
 let source=SOURCE.replace("invariant reports.read only","invariant reports.body read only");
 let b=compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let now=1_800_000_000_000;let mut fixture=Engine::new_at(snapback4_core::Store::memory().unwrap(),b.schema.clone(),b.programs.iter().map(|p|p.program.clone()),now).unwrap();
 fixture.seed_at([
  ("roles".into(),row(&[("id",Value::Id("role".into())),("principal",Value::Id("dev:fixture-only".into())),("role",Value::String("inspector".into()))])),
  ("grants".into(),row(&[("id",Value::Id("grant".into())),("principal",Value::Id("dev:fixture-only".into()))])),
  ("reports".into(),row(&[("id",Value::Id("report".into())),("body",Value::String("private".into()))]))
 ],now).unwrap();
 let mut c=security::challenges::Campaign::default();security::challenges::operations(&b,&fixture,&mut c);
 assert!(c.violations.iter().any(|v|v.effect=="column read observation"&&v.viewer=="dev:fixture-only"&&v.history.iter().any(|s|s.operation=="demote")),"{c:?}");
}

#[test]
fn aliases_defaults_and_deprecated_inputs_preserve_column_challenges_and_audit() {
 // @ref LLP 3000.036.004#121-column-read-intent — compatibility forms keep the same disclosure obligations.
 for fixed in [false, true] {
  let source = SOURCE.replace("invariant reports.read only", "invariant reports.body read only")
   .replace("query inspect(report: reports):", "query inspect(report: reports, enabled: bool default true, old: text <=20 deprecated):")
   .replace("  return reports[report]", "  require enabled else DISABLED\n  return reports[report]")
   + "alias legacyInspect = inspect\n";
  let source = if fixed { source.replace("read <- exists grants[viewer]", "read <- exists grants[viewer] and exists roles[viewer, role = 'inspector']") } else { source };
  let b=compile(&[("schema.q".into(), source)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
  let report=security::analyze(&b);
  let exposure=report.exposures.iter().find(|e|e.table=="reports").unwrap();
  for name in ["inspect (query)", "legacyInspect (query)"] { assert!(exposure.operations.iter().any(|op|op==name),"{exposure:?}"); }
  let now=1_800_000_000_000;
  let mut fixture=Engine::new_at(snapback4_core::Store::memory().unwrap(),b.schema.clone(),b.programs.iter().map(|p|p.program.clone()),now).unwrap();
  fixture.seed_at([
   ("roles".into(),row(&[("id",Value::Id("role".into())),("principal",Value::Id("dev:fixture-only".into())),("role",Value::String("inspector".into()))])),
   ("grants".into(),row(&[("id",Value::Id("grant".into())),("principal",Value::Id("dev:fixture-only".into()))])),
   ("reports".into(),row(&[("id",Value::Id("report".into())),("body",Value::String("private".into()))]))
  ],now).unwrap();
  let mut campaign=security::challenges::Campaign::default();security::challenges::operations(&b,&fixture,&mut campaign);
  for name in ["inspect", "legacyInspect"] {assert!(campaign.operations.contains_key(name),"{campaign:?}");}
  assert_eq!(campaign.violations.is_empty(),fixed,"{campaign:?}");
  let args=std::collections::BTreeMap::from([("report".into(),Value::Id("report".into())),("old".into(),Value::String("old caller".into()))]);
  let mut context=snapback4_core::Context::new("dev:fixture-only",args);context.now=Some(now);
  let demote=std::collections::BTreeMap::from([("who".into(),Value::Id("dev:fixture-only".into()))]);
  let mut operator=snapback4_core::Context::new("service:ops",demote);operator.now=Some(now);
  fixture.mutate("demote",None,operator).unwrap();
  for name in ["inspect", "legacyInspect"] {
   let observed=fixture.query(name,context.clone()).unwrap();
   assert_eq!(observed.data==Value::Null,fixed,"{name}: {observed:?}");
  }
 }
}

#[test]
fn immutable_column_pairs_use_independent_valid_worlds(){
 let source="table notes:\n  owner: principal\n  body: text <=80\n  immutable owner, body\n  read <- allow\n  online only\ninvariant notes.body read only .owner = viewer\nquery inspect(note: notes):\n  n = notes[note] ! else NOT_FOUND\n  return n.body\n";
 let b=compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let now=1_800_000_000_000;let mut fixture=Engine::new_at(snapback4_core::Store::memory().unwrap(),b.schema.clone(),b.programs.iter().map(|p|p.program.clone()),now).unwrap();
 fixture.seed_at([("notes".into(),row(&[("id",Value::Id("n".into())),("owner",Value::Id("dev:fixture-owner".into())),("body",Value::String("secret".into()))]))],now).unwrap();
 let before=fixture.store().rows("notes").unwrap();let mut c=security::challenges::Campaign::default();security::challenges::operations(&b,&fixture,&mut c);
 assert!(c.violations.iter().any(|v|v.effect=="column read observation"&&v.reachability==security::challenges::Reachability::AuthoredFixtureTrace),"{c:?}");assert_eq!(fixture.store().rows("notes").unwrap(),before);
}
#[test]
fn hidden_reference_hops_stay_unknown_and_expiry_is_not_an_authored_delete(){
 let source="table parents:\n  owner: principal\n  active: bool\n  read <- .owner = viewer\n  online only\ntable notes:\n  parent: parents\n  until: time\n  read <- allow\n  update <- allow\n  expire at .until\n  online only\ninvariant notes.read only .parent.active != true\ninvariant notes.delete only deny\nquery inspect(note: notes):\n  return notes[note]\nmutation expire(note: notes):\n  update notes[note] { until: now }\n  return null\n";
 let b=compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let now=1_800_000_000_000;let mut fixture=Engine::new_at(snapback4_core::Store::memory().unwrap(),b.schema.clone(),b.programs.iter().map(|p|p.program.clone()),now).unwrap();
 fixture.seed_at([("parents".into(),row(&[("id",Value::Id("p".into())),("owner",Value::Id("dev:fixture-owner".into())),("active",Value::Bool(true))])),("notes".into(),row(&[("id",Value::Id("n".into())),("parent",Value::Id("p".into())),("until",Value::Int(now+100_000))]))],now).unwrap();
 let mut c=security::challenges::Campaign::default();security::challenges::operations(&b,&fixture,&mut c);
 assert!(c.violations.iter().all(|v|v.effect=="read"&&v.viewer=="dev:fixture-owner"),"{c:?}");assert!(c.unsupported.iter().any(|s|s.contains("unknown")));assert!(c.unsupported.iter().any(|s|s.contains("not an executed delete")));
}

fn fixture_campaign(source:&str,seeds:Vec<(String,Value)>)->security::challenges::Campaign{
 let b=compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let mut fixture=Engine::new_at(snapback4_core::Store::memory().unwrap(),b.schema.clone(),b.programs.iter().map(|p|p.program.clone()),1_800_000_000_000).unwrap();fixture.seed_at(seeds,1_800_000_000_000).unwrap();
 let mut c=security::challenges::Campaign::default();security::challenges::fixture_observers(&b,&fixture,&mut c);c
}
#[test]
fn reference_keys_are_stability_dependencies(){
 let source="table parents:\n  owner: principal\n  read <- allow\n  update <- allow\n  online only\ntable grants:\n  principal: principal\n  unique principal\n  read <- allow\n  online only\ntable notes:\n  parent: parents\n  insert <- exists grants[.parent.owner]\n  online only\ninvariant notes.insert only exists grants[.parent.owner]\nmutation add(parent: parents, who: principal):\n  update parents[parent] { owner: who }\n  return insert notes { parent }\n";
 let c=fixture_campaign(source,vec![("parents".into(),row(&[("id",Value::Id("p".into())),("owner",Value::Id("dev:old".into()))])),("grants".into(),row(&[("id",Value::Id("g".into())),("principal",Value::Id("dev:new".into()))]))]);assert!(c.violations.is_empty(),"{c:?}");
}
#[test]
fn independent_read_hops_use_authorized_runtime_intent(){
 let source="table parents:\n  active: bool\n  read <- allow\n  online only\ntable notes:\n  parent: parents\n  read <- allow\n  online only\ninvariant notes.read only .parent.active = true\nquery inspect(note: notes):\n  return notes[note]\n";
 let c=fixture_campaign(source,vec![("parents".into(),row(&[("id",Value::Id("p".into())),("active",Value::Bool(false))])),("notes".into(),row(&[("id",Value::Id("n".into())),("parent",Value::Id("p".into()))]))]);assert!(c.violations.iter().any(|v|v.reachability==security::challenges::Reachability::AuthoredFixtureTrace),"{c:?}");
}
#[test]
fn row_assertions_recheck_after_related_table_changes(){
 let source="table roles:\n  principal: principal\n  role: enum('inspector','member')\n  unique principal\n  read <- allow\n  update <- allow\n  online only\ntable reports:\n  author: principal\n  online only\ninvariant reports always exists roles[.author, role = 'inspector']\nmutation demote(who: principal):\n  update roles[who] { role: 'member' }\n  return null\n";
 let c=fixture_campaign(source,vec![("roles".into(),row(&[("id",Value::Id("r".into())),("principal",Value::Id("dev:inspector".into())),("role",Value::String("inspector".into()))])),("reports".into(),row(&[("id",Value::Id("report".into())),("author",Value::Id("dev:inspector".into()))]))]);assert!(c.violations.iter().any(|v|v.effect=="always"&&v.history.iter().any(|s|s.operation=="demote")),"{c:?}");
}

#[test]
fn projection_only_fixture_observers_do_not_disclose_column_values(){
 let source="table notes:\n  owner: principal\n  body: text <=80\n  read <- allow\n  online only\ninvariant notes.body read only .owner = viewer\nquery inspect(note: notes):\n  n = notes[note] ! else NOT_FOUND\n  return { id: n.id }\n";
 let c=fixture_campaign(source,vec![("notes".into(),row(&[("id",Value::Id("n".into())),("owner",Value::Id("dev:owner".into())),("body",Value::String("secret".into()))]))]);assert!(c.violations.is_empty(),"{c:?}");
}
#[test]
fn column_mutation_cannot_change_transitive_reference_authority(){
 let source="table roles:\n  principal: principal\n  active: bool\n  unique principal\n  read <- allow\n  update <- allow\n  online only\ntable parents:\n  owner: principal\n  read <- exists roles[viewer, active = true]\n  online only\ntable notes:\n  parent: parents\n  body: text <=80\n  read <- allow\n  online only\ninvariant notes.body read only .parent.owner = viewer\nmutation revoke(note: notes):\n  update roles[viewer] { active: false }\n  n = notes[note] ! else NOT_FOUND\n  return n.body\n";
 let c=fixture_campaign(source,vec![("roles".into(),row(&[("id",Value::Id("r".into())),("principal",Value::Id("dev:reader".into())),("active",Value::Bool(true))])),("parents".into(),row(&[("id",Value::Id("p".into())),("owner",Value::Id("dev:owner".into()))])),("notes".into(),row(&[("id",Value::Id("n".into())),("parent",Value::Id("p".into())),("body",Value::String("secret".into()))]))]);assert!(c.violations.is_empty(),"{c:?}");assert!(c.unsupported.iter().any(|s|s.contains("before disclosure")),"{c:?}");
}

#[test]
fn unchanged_authored_fixture_assertion_failures_are_reachable(){
 let source="table balances:\n  amount: int\n  read <- allow\n  online only\ninvariant balances always .amount >= 0\nquery one(balance: balances):\n  return balances[balance]\n";
 let c=fixture_campaign(source,vec![("balances".into(),row(&[("id",Value::Id("b".into())),("amount",Value::Int(-1))]))]);assert!(c.violations.iter().any(|v|v.reachability==security::challenges::Reachability::AuthoredFixtureTrace),"{c:?}");
}
#[test]
fn operation_matrix_enforces_the_shared_budget_with_many_operations(){
 let mut source="table notes:\n  n: int\n  read <- allow\n  online only\n".to_string();
 for n in 0..600{source.push_str(&format!("query q{n}(mode: enum('a','b','c','d','e','f','g','h')):\n  return notes first 1 by .id\n"));}
 let b=compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
 let mut fixture=Engine::new_at(snapback4_core::Store::memory().unwrap(),b.schema.clone(),b.programs.iter().map(|p|p.program.clone()),1_800_000_000_000).unwrap();fixture.seed_at([("notes".into(),row(&[("id",Value::Id("n".into())),("n",Value::Int(0))]))],1_800_000_000_000).unwrap();let mut c=security::challenges::Campaign::default();security::challenges::operations(&b,&fixture,&mut c);
 assert_eq!(c.operations.len(),600);assert!(c.attempted<=8192,"{}",c.attempted);assert!(c.unsupported.iter().any(|s|s.contains("8192-call budget")));
}

#[test]
fn trusted_column_observation_precedes_mutation_prefixes(){
 let source="table notes:\n  owner: principal\n  body: text <=80\n  read <- allow\n  online only\ntable counters:\n  n: int\n  update <- allow\n  online only\ninvariant notes.body read only .owner = viewer\nquery inspect(note: notes):\n  n = notes[note] ! else NOT_FOUND\n  return n.body\nmutation unrelated(counter: counters):\n  return update counters[counter] { n: 1 }\n";
 let c=fixture_campaign(source,vec![("notes".into(),row(&[("id",Value::Id("n".into())),("owner",Value::Id("dev:owner".into())),("body",Value::String("secret".into()))])),("counters".into(),row(&[("id",Value::Id("c".into())),("n",Value::Int(0))]))]);let disclosures=c.violations.iter().filter(|v|v.effect=="column read observation").collect::<Vec<_>>();assert!(!disclosures.is_empty());assert!(disclosures.iter().any(|v|v.history.is_empty()),"{c:?}");assert!(disclosures.iter().all(|v|v.reachability==security::challenges::Reachability::AuthoredFixtureTrace),"{c:?}");
}

#[test]
fn typed_media_column_payloads_are_witnesses_and_private_nulls_are_not(){
 let source="table roles:\n  principal: principal\n  role: enum('inspector','member')\n  unique principal\n  read <- allow\n  online only\ntable notes:\n  owner: principal\n  photo: image <=5000\n  body: text <=80 ? default null written by .owner\n  read <- allow\n  online only\ninvariant notes.photo read only .owner = viewer\ninvariant notes.body read only .owner = viewer and exists roles[viewer, role = 'inspector']\nquery inspect(note: notes):\n  return notes[note]\n";
 let b=compile(&[("schema.q".into(),source.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let now=1_800_000_000_000;
 let mut fixture=Engine::new_at(snapback4_core::Store::memory().unwrap(),b.schema.clone(),b.programs.iter().map(|p|p.program.clone()),now).unwrap();
 let png=[137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1];let photo=fixture.store_asset("service:ops",&png,now).unwrap().column_value();
 fixture.seed_at([("roles".into(),row(&[("id",Value::Id("r".into())),("principal",Value::Id("dev:owner".into())),("role",Value::String("inspector".into()))])),("notes".into(),row(&[("id",Value::Id("n".into())),("owner",Value::Id("dev:owner".into())),("photo",photo),("body",Value::Null)]))],now).unwrap();
 let mut c=security::challenges::Campaign::default();security::challenges::fixture_observers(&b,&fixture,&mut c);
 assert!(c.violations.iter().any(|v|v.invariant_site==b.invariants[0].site.to_string()&&v.operation=="inspect"&&v.reachability==security::challenges::Reachability::AuthoredFixtureTrace),"{c:?}");
 assert!(!c.violations.iter().any(|v|v.invariant_site==b.invariants[1].site.to_string()),"{c:?}");
}

#[test]
fn authored_query_refusal_is_a_column_value_observation() {
 let source="table notes:\n  owner: principal\n  body: text 1..40\n  read <- allow\n  online only\nquery observe(note: notes):\n  n = notes[note] ! else MISSING\n  require n.body = 'secret' else DIFFERENT 'protected value differs'\n  return 0\ninvariant notes.body read only .owner = viewer\n";
 let c=fixture_campaign(source,vec![("notes".into(),row(&[("id",Value::Id("n".into())),("owner",Value::Id("dev:owner".into())),("body",Value::String("secret".into()))]))]);
 let v=c.violations.iter().find(|v|v.effect=="column read observation"&&v.reachability==security::challenges::Reachability::AuthoredFixtureTrace).unwrap_or_else(||panic!("{c:?}"));
 let observations=serde_json::to_string(&v.observations).unwrap();
 assert!(observations.contains("DIFFERENT")&&observations.contains("protected value differs"),"{observations}");
}

#[test]
fn demotion_is_followed_by_writes_as_the_affected_principal() {
 let source="table roles:\n  principal: principal\n  role: enum('inspector','landowner')\n  unique principal\n  read <- allow\n  update <- viewer = 'service:ops'\n  online only\ntable reports:\n  owner: principal\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nmutation changeRole(who: principal, role: enum('inspector','landowner')):\n  update roles[who] { role }\n  return null\nmutation record():\n  return insert reports { owner: viewer }\ninvariant reports.insert only exists roles[viewer, role = 'inspector']\n";
 let c=fixture_campaign(source,vec![("roles".into(),row(&[("id",Value::Id("r".into())),("principal",Value::Id("dev:inspector".into())),("role",Value::String("inspector".into()))]))]);
 assert!(c.violations.iter().any(|v|v.viewer=="dev:inspector"&&v.effect=="insert"&&v.history.len()==2&&v.history[0].operation=="changeRole"&&v.history[1].operation=="record"),"{c:?}");
}

#[test]
fn pending_rows_keep_their_write_arm_and_executed_delete() {
 let source="table notes:\n  owner: principal\n  body: text <=40\n  opensAt: time\n  not before .opensAt\n  read <- .owner = viewer\n  update <- .owner = viewer\n  delete <- .owner = viewer\n  online only\nmutation edit(note: notes):\n  update notes[note] { body: 'edited' }\n  return null\nmutation remove(note: notes):\n  delete notes[note]\n  return null\ninvariant notes.insert only viewer = 'service:ops'\ninvariant notes.delete only viewer = 'service:ops'\n";
 let c=fixture_campaign(source,vec![("notes".into(),row(&[("id",Value::Id("n".into())),("owner",Value::Id("dev:owner".into())),("body",Value::String("old".into())),("opensAt",Value::Int(1_800_000_100_000))]))]);
 assert!(!c.violations.iter().any(|v|v.effect=="insert"),"{c:?}");
 assert!(c.violations.iter().any(|v|v.effect=="delete"&&v.operation=="remove"&&v.viewer=="dev:owner"),"{c:?}");
}

#[test]
fn column_pairs_do_not_change_materialized_asset_inputs() {
 let source="table notes:\n  owner: principal\n  body: text <=40\n  photo: image <=5000 ?\n  read <- allow\n  online only\nquery inspect(note: notes, image: image <=5000):\n  return notes[note].body\ninvariant notes.body read only .owner = viewer\n";
 let c=fixture_campaign(source,vec![("notes".into(),row(&[("id",Value::Id("n".into())),("owner",Value::Id("dev:owner".into())),("body",Value::String("secret".into()))]))]);
 assert!(c.violations.is_empty(),"{c:?}");
 assert!(c.unsupported.iter().any(|s|s.contains("coupled asset ledger")),"{c:?}");
}

#[test]
fn time_arguments_expose_a_deadline_checked_on_the_wrong_reference() {
 let source="table gates:\n  deadline: time\n  read <- allow\n  insert <- viewer = 'service:ops'\n  online only\ntable briefs:\n  home: gates\n  owner: principal\n  body: text <=40\n  read <- allow\n  online only\nmutation create(deadline: time):\n  return insert gates { deadline }\nquery inspect(brief: briefs, gate: gates):\n  b = briefs[brief] ! else MISSING\n  g = gates[gate] ! else MISSING\n  require g.deadline <= now else EARLY\n  return b\ninvariant briefs.read only .owner = viewer\n";
 let c=fixture_campaign(source,vec![("gates".into(),row(&[("id",Value::Id("future".into())),("deadline",Value::Int(1_800_604_800_000))])),("briefs".into(),row(&[("id",Value::Id("b".into())),("home",Value::Id("future".into())),("owner",Value::Id("dev:owner".into())),("body",Value::String("secret".into()))]))]);
 assert!(c.violations.iter().any(|v|v.operation=="inspect"&&v.history.len()==2&&observed_tail(v)&&v.history[0].operation=="create"&&v.history[0].viewer=="service:ops"&&v.observations.is_none()&&matches!(v.history[0].args.get("deadline"),Some(Value::Int(n)) if *n<1_800_000_000_000)&&v.args.get("gate")!=Some(&Value::Id("future".into()))),"{c:?}");
}

#[test]
fn real_media_creation_is_replayed_before_role_revocation() {
 let source="table roles:\n  principal: principal\n  role: enum('engineer','contractor','manager')\n  unique principal\n  read <- allow\n  update <- viewer = 'service:ops'\n  online only\ntable grants:\n  principal: principal\n  unique principal\n  read <- allow\n  online only\ntable photos:\n  photo: image <=5000\n  read <- exists roles[viewer, role = 'engineer'] or exists grants[viewer]\n  insert <- exists roles[viewer, role = 'engineer']\n  online only\nmutation add(photo: image <=5000):\n  return insert photos { photo }\nmutation changeRole(who: principal, role: enum('engineer','contractor','manager')):\n  update roles[who] { role }\n  return null\nquery list():\n  return photos first 50 by .id\ninvariant photos.read only exists roles[viewer, role = 'engineer'] or (exists roles[viewer, role = 'contractor'] and exists grants[viewer])\n";
 let c=fixture_campaign(source,vec![("roles".into(),row(&[("id",Value::Id("eng".into())),("principal",Value::Id("dev:eng".into())),("role",Value::String("engineer".into()))])),("roles".into(),row(&[("id",Value::Id("con".into())),("principal",Value::Id("dev:con".into())),("role",Value::String("contractor".into()))])),("grants".into(),row(&[("id",Value::Id("g".into())),("principal",Value::Id("dev:con".into()))]))]);
 assert!(c.violations.iter().any(|v|v.viewer=="dev:con"&&v.operation=="list"&&v.history.len()==3&&observed_tail(v)&&v.history[0].operation=="add"&&v.history[1].operation=="changeRole"&&v.reachability==security::challenges::Reachability::AuthoredFixtureTrace),"{c:?}");
}

#[test]
fn history_observers_materialize_owned_media_inputs_for_payloads_and_pairs() {
 for kind in ["image","file"] {for direct in [true,false] {
  let source=format!("table notes:\n  owner: principal\n  body: text <=40\n  evidence: {kind} <=5000 ?\n  read <- allow\n  online only\nquery inspect(note: notes, input: {kind} <=5000):\n  return notes[note]{}\ninvariant notes.read only .owner = viewer\n",if direct{""}else{".body"});
  let c=fixture_campaign(&source,vec![("notes".into(),row(&[("id",Value::Id("n".into())),("owner",Value::Id("dev:owner".into())),("body",Value::String("secret".into()))]))]);
  assert!(c.violations.iter().any(|v|v.operation=="inspect"&&v.reachability==security::challenges::Reachability::AuthoredFixtureTrace&&v.args.get("input").is_some_and(|v|v.field("id").is_ok())&&(!direct||v.observations.is_none())&&(direct||v.observations.is_some())),"{kind} {direct}: {c:?}");
 }}
}

#[test]
fn omitted_nullable_values_have_presence_observers() {
 let source="table notes:\n  owner: principal\n  body: text <=40 ?\n  read <- allow\n  online only\nquery present(note: notes):\n  return notes[note].body != null\ninvariant notes.body read only .owner = viewer\n";
 let c=fixture_campaign(source,vec![("notes".into(),row(&[("id",Value::Id("n".into())),("owner",Value::Id("dev:owner".into()))]))]);
 assert!(c.violations.iter().any(|v|v.operation=="present"&&v.history.is_empty()&&v.reachability==security::challenges::Reachability::AuthoredFixtureTrace),"{c:?}");
}

#[test]
fn an_empty_trusted_store_can_reach_authored_disclosure() {
 let source="table notes:\n  owner: principal\n  body: text <=40\n  read <- allow\n  insert <- .owner = viewer\n  online only\nmutation add():\n  return insert notes { owner: viewer, body: 'secret' }\nquery inspect(note: notes):\n  return notes[note]\ninvariant notes.read only .owner = viewer\ninvariant notes.body read only .owner = viewer\n";
 let c=fixture_campaign(source,vec![]);
 for effect in ["read","column read observation"] {assert!(c.violations.iter().any(|v|v.effect==effect&&v.operation=="inspect"&&v.history.len()==2&&observed_tail(v)&&v.history[0].operation=="add"&&v.reachability==security::challenges::Reachability::AuthoredFixtureTrace),"{effect}: {c:?}");}
 let source=source.replace("mutation add():\n  return insert notes { owner: viewer, body: 'secret' }\n", "");
 let c=fixture_campaign(&source,vec![]);assert!(c.violations.is_empty(),"{c:?}");
 let b=compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let mut r=security::analyze_rules(&b);let c=security::challenges::run(&b);security::challenges::apply(&mut r,&c);assert!(!c.violations.is_empty());assert!(!r.refuted());
}
