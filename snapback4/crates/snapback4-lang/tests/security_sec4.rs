//! SEC4: intent quality, typed generated populations, and bounded work.
use snapback4_lang::{compile, security::{self,challenges::{self,Campaign,Reachability}}};
fn bound(source:&str)->snapback4_lang::Bound {
    let b=compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b
}
const ROLES:&str="use identity password\ntable roles:\n  principal: principal\n  role: enum('doctor','volunteer')\n  unique principal\n  read <- allow\n  insert <- viewer = 'service:operator'\n  online only\n";
#[test]
fn equivalent_intent_is_advice_only_and_semantic_reordering_is_detected(){
    let source="table notes:\n  owner: principal\n  body: text <=80\n  read <- .owner = viewer\n  insert <- allow\n  online only\ninvariant notes.read only viewer = .owner and allow\n";
    let b=bound(source);let r=security::analyze(&b);
    assert!(r.notes.iter().any(|n|n.code=="N_INVARIANT_RESTATES_RULE"&&n.site.line==7));
    assert!(!r.refuted());
    let b=bound(&source.replace("viewer = .owner and allow","viewer = .owner or viewer = 'service:operator'"));
    assert!(!security::analyze(&b).notes.iter().any(|n|n.code=="N_INVARIANT_RESTATES_RULE"));
}
#[test]
fn per_role_population_catches_private_image_and_file_payloads_with_explicit_origin(){
    for field in ["scan: image <=5000", "scan: file <=5000 ('application/pdf')"] {
        let b=bound(&format!("{ROLES}table packages:\n  owner: principal\n  {field}\n  read <- exists roles[viewer]\n  insert <- allow\n  online only\ninvariant packages.scan read only exists roles[viewer, role = 'doctor']\nquery board(c: cursor ?):\n  return packages after c first 100 by .id\n"));
        let mut c=Campaign::default();c.generated_fixture=true;
        let fixture=challenges::generated_fixture(&b,&mut c).unwrap();
        let roles=fixture.store().rows("roles").unwrap();
        for role in ["doctor","volunteer"] {
            assert_eq!(roles.iter().filter(|r|r.field("role").unwrap()==&snapback4_core::Value::String(role.into())).count(),2);
        }
        assert!(fixture.store().rows("packages").unwrap().len()>=2);
        challenges::fixture_observers(&b,&fixture,&mut c);
        let witnesses=c.violations.iter().filter(|v|v.reachability==Reachability::GeneratedFixtureTrace).collect::<Vec<_>>();
        assert!(!witnesses.is_empty(),"{c:?}");
        assert!(witnesses.iter().any(|v|v.viewer.contains("volunteer")&&v.operation=="board"));
        let mut r=security::analyze(&b);challenges::apply(&mut r,&c);assert!(r.refuted());
        // A later synthetic witness must not replace the generated fixture provenance.
        let supplemental=challenges::run(&b);challenges::apply(&mut r,&supplemental);
        assert_eq!(r.invariants[0].counterexample.as_ref().unwrap().reachability,Reachability::GeneratedFixtureTrace);
    }
}
#[test]
fn generated_memberships_refer_to_valid_resource_and_distinct_owners(){
    let b=bound("table teams:\n  title: text 1..80\n  read <- allow\n  insert <- allow\n  online only\ntable members:\n  team: teams\n  principal: principal\n  role: enum('admin','member')\n  unique team, principal\n  read <- allow\n  insert <- allow\n  online only\n");
    let mut c=Campaign::default();let fixture=challenges::generated_fixture(&b,&mut c).unwrap();
    let teams=fixture.store().rows("teams").unwrap();let members=fixture.store().rows("members").unwrap();
    assert!(teams.len()>=2&&members.len()>=2,"{c:?}");
    assert_ne!(members[0].field("principal"),members[1].field("principal"));
    assert!(members.iter().all(|m|teams.iter().any(|t|t.field("id")==m.field("team"))));
}
#[test]
fn update_only_column_intent_does_not_refute_authorized_creation(){
    let b=bound("table tickets:\n  price: int\n  read <- allow\n  insert <- allow\n  update <- viewer = 'service:operator'\n  online only\nmutation create():\n  return insert tickets {price: 1}\ninvariant tickets.price update only viewer = 'service:operator'\n");
    assert_eq!(b.invariants[0].column.as_deref(),Some("price"));
    let mut c=Campaign::default();let fixture=challenges::generated_fixture(&b,&mut c).unwrap();
    challenges::fixture_observers(&b,&fixture,&mut c);assert!(c.violations.is_empty(),"{c:?}");
}
#[test]
fn check_exhaustion_is_explicit_and_retains_no_proof_assumptions(){
    let b=bound("table notes:\n  owner: principal\n  body: text <=80\n  read <- allow\n  insert <- allow\n  online only\ninvariant notes.body read only .owner = viewer\nquery notes():\n  return notes first 100 by .id\n");
    let r=security::analyze(&b);assert!(r.invariants.iter().all(|v|v.status==security::Status::Unproved));
    let c=challenges::run_selected_after(&b,None,Campaign::bounded(0));
    assert!(c.unsupported.iter().any(|s|s.contains("time budget exhausted")));assert!(c.violations.is_empty());
    let mut r=security::analyze(&b);challenges::apply(&mut r,&c);assert!(!r.refuted());
}
#[test]
fn board_advice_names_the_unscoped_branch_but_not_resource_scoped_roles(){
    let source=format!("{ROLES}table reports:\n  owner: principal\n  rating: enum('good','bad')\n  scan: image <=5000 ?\n  read <- .owner = viewer or (exists roles[viewer, role = 'volunteer'] and .rating = 'bad')\n  insert <- allow\n  online only\n");
    let b=bound(&source);assert!(security::analyze(&b).notes.iter().any(|n|n.code=="N_ROLE_WIDE_READ"));
    let b=bound(&source.replace(" and .rating = 'bad'"," and .owner = viewer and .rating = 'bad'"));
    assert!(!security::analyze(&b).notes.iter().any(|n|n.code=="N_ROLE_WIDE_READ"));
}
#[test]
fn dominating_argument_guard_suppresses_excluded_role_and_names_actual_risk(){
    let source=format!("{ROLES}table docs:\n  read <- exists roles[viewer, role = 'doctor']\n  insert <- allow\n  online only\nmutation register(role: enum('doctor','volunteer')):\n  require role = 'volunteer' else NOT_ALLOWED\n  return insert roles {{principal: viewer,role}}\n").replace("insert <- viewer = 'service:operator'","insert <- .principal = viewer");
    let b=bound(&source);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("schema.q".into(),source.clone())],&b);
    assert!(!r.notes.iter().any(|n|n.code=="N_PRIVILEGE_ESCALATION"),"{:?}",r.notes);
    let source=source.replace("  require role = 'volunteer' else NOT_ALLOWED\n","");
    let b=bound(&source);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("schema.q".into(),source)],&b);
    assert!(r.notes.iter().any(|n|n.code=="N_PRIVILEGE_ESCALATION"&&n.message.contains("'doctor'")),"{:?}",r.notes);
}

#[test]
fn projected_media_scalar_uses_a_coupled_verified_ledger(){
    let b=bound(&format!("{ROLES}table packages:\n  scan: image <=5000\n  read <- exists roles[viewer]\n  insert <- allow\n  online only\ninvariant packages.scan read only exists roles[viewer, role = 'doctor']\nquery scan(package: packages):\n  p = packages[package] ! else NOT_FOUND\n  return p.scan\n"));
    let mut c=Campaign::default();c.generated_fixture=true;let fixture=challenges::generated_fixture(&b,&mut c).unwrap();
    challenges::fixture_observers(&b,&fixture,&mut c);
    assert!(c.violations.iter().any(|v|v.operation=="scan"&&v.reachability==Reachability::GeneratedFixtureTrace),"{c:?}");
}

#[test]
fn draft_candidates_are_never_equivalent_to_the_read_gate(){
    let b=bound(&format!("{ROLES}table docs:\n  body: text <=80\n  read <- exists roles[viewer, role = 'doctor']\n  insert <- allow\n  online only\n"));
    let draft=security::draft(&b);
    assert!(!draft.lines().any(|line|line.contains("invariant docs.body")&&line.contains("'doctor'")));
    assert!(draft.lines().any(|line|line.contains("invariant docs.body")&&line.contains("'volunteer'")));
}

#[test]
fn fixture_free_first_caller_role_claim_has_an_actual_empty_start_trace(){
    let source="table roles:\n  principal: principal\n  role: enum('staff','guest')\n  unique principal\n  read <- allow\n  insert <- .principal = viewer\n  online only\ntable secrets:\n  read <- exists roles[viewer, role = 'staff']\n  insert <- allow\n  online only\nmutation register(role: text 1..20):\n  require role = 'staff' or role = 'guest' else BAD_ROLE\n  return insert roles {principal: viewer,role}\ninvariant roles.role write only viewer = 'service:operator'\n";
    let b=bound(source);let mut c=Campaign::default();challenges::generated_campaign(&b,&mut c,false);
    assert!(c.violations.iter().any(|v|v.reachability==Reachability::AuthoredFixtureTrace&&v.history.iter().any(|s|s.operation=="register")&&v.supporting_rows.values().all(Vec::is_empty)),"{c:?}");
}

#[test]
fn relationship_argument_transfer_rechecks_live_intent_after_the_authored_write(){
    let source="table units:\n  landlord: principal\n  read <- allow\n  insert <- allow\n  update <- viewer = 'service:operator'\n  online only\ntable reports:\n  unit: units\n  landlord: principal\n  body: text <=80\n  read <- .landlord = viewer\n  insert <- allow\n  online only\nmutation linkUnit(unit: units, landlord: principal):\n  update units[unit] {landlord}\n  return null\nquery report(report: reports):\n  return reports[report]\ninvariant reports.body read only .unit.landlord = viewer\n";
    let b=bound(source);let mut c=Campaign::default();challenges::generated_campaign(&b,&mut c,false);
    assert!(c.violations.iter().any(|v|v.reachability==Reachability::GeneratedFixtureTrace&&v.history.iter().any(|s|s.operation=="linkUnit")),"{c:?}");
}

#[test]
fn rejected_fallback_final_exists_world_never_becomes_a_failing_fixture(){
    let source="table roots:\n  creator: principal\n  read <- allow\n  insert <- allow\n  after insert <- exists members[root = .id]\n  online only\ntable members:\n  root: roots\n  proof: image <=1\n  unique root\n  read <- allow\n  insert <- allow\n  online only\ninvariant roots.read only deny\nquery roots():\n  return roots first 100 by .id\n";
    let b=bound(source);let mut c=Campaign::default();
    assert!(challenges::generated_fixture(&b,&mut c).is_err(),"invalid final-exists seed must remain unsupported");
    challenges::generated_campaign(&b,&mut c,false);
    assert!(c.violations.is_empty(),"{c:?}");
    assert!(c.unsupported.iter().any(|s|s.contains("final-exists")),"{c:?}");
}

#[test]
fn bounded_campaign_charges_initial_worlds_and_every_mutation_step(){
    let b=bound("table notes:\n  owner: principal\n  body: text <=80\n  read <- allow\n  insert <- .owner = viewer\n  online only\nmutation add():\n  return insert notes {owner: viewer,body: 'x'}\ninvariant notes.read only .owner = viewer\nquery inspect():\n  return notes first 100 by .id\n");
    let mut c=Campaign::bounded(10000);c.work_remaining=Some(1);
    let fixture=challenges::generated_fixture(&b,&mut c).unwrap();
    assert_eq!(c.work_remaining,Some(0));
    challenges::fixture_observers(&b,&fixture,&mut c);
    assert_eq!(c.attempted,0);assert!(c.unsupported.iter().any(|s|s.contains("work budget exhausted")));
    let fixture=snapback4_core::Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
    let mut c=Campaign::bounded(10000);c.work_remaining=Some(1);
    challenges::fixture_observers(&b,&fixture,&mut c);
    assert_eq!(c.attempted,0,"the one reservation pays for the replay world, leaving no mutation step");
}

#[test]
fn the_same_update_tuple_reaches_every_role_before_diagonal_variation(){
    let source=format!("{ROLES}table bouts:\n  status: enum('recorded','overturned')\n  score: int 0..15\n  read <- allow\n  insert <- allow\n  update <- exists roles[viewer, role = 'doctor']\n  online only\ntable appeals:\n  bout: bouts\n  decision: enum('upheld','pending')\n  unique bout\n  read <- allow\n  insert <- allow\n  online only\nmutation correct(bout: bouts, score: int 0..15):\n  require exists roles[viewer, role = 'doctor'] else NO_ROLE\n  b = bouts[bout] ! else MISSING\n  require b.status = 'recorded' else CLOSED\n  update bouts[bout] {{score}}\n  return null\ninvariant bouts.score update only not exists appeals[bout = .id, decision = 'upheld']\n");
    let b=bound(&source);let mut c=Campaign::default();challenges::generated_campaign(&b,&mut c,false);
    assert!(c.violations.iter().any(|v|v.reachability==Reachability::GeneratedFixtureTrace&&v.history.iter().any(|s|s.operation=="correct")),"{c:?}");
}

#[test]
fn principal_columns_vary_independently_even_when_one_drives_the_read_gate(){
    let b=bound("table docs:\n  a: principal\n  b: principal\n  c: principal\n  read <- .a = viewer or .b != .c\n  insert <- allow\n  online only\ninvariant docs.read only .a = viewer\nquery docs():\n  return docs first 100 by .id\n");
    let mut c=Campaign::default();c.generated_fixture=true;
    let fixture=challenges::generated_fixture(&b,&mut c).unwrap();
    assert!(fixture.store().rows("docs").unwrap().len()>=8);
    challenges::fixture_observers(&b,&fixture,&mut c);
    assert!(c.violations.iter().any(|v|v.reachability==Reachability::GeneratedFixtureTrace&&v.operation=="docs"),"{c:?}");
}

#[test]
fn a_column_alternate_must_preserve_final_exists_before_observation(){
    let b=bound("table codes:\n  code: text <=20\n  unique code\n  read <- allow\n  insert <- allow\n  online only\ntable records:\n  value: text <=20\n  read <- allow\n  insert <- allow\n  after insert <- exists codes[code = .value]\n  online only\ninvariant records.value read only deny\nquery probe(record: records):\n  r = records[record] ! else NOT_FOUND\n  return exists codes[code = r.value]\n");
    let mut c=Campaign::default();c.generated_fixture=true;
    let fixture=challenges::generated_fixture(&b,&mut c).unwrap();
    challenges::fixture_observers(&b,&fixture,&mut c);
    assert!(c.violations.is_empty(),"{c:?}");
    assert!(c.unsupported.iter().any(|s|s.contains("final-exists")),"{c:?}");
}

#[test]
fn no_authored_observer_does_not_fork_useless_absence_worlds(){
    let b=bound("table docs:\n  marker: enum('a','b','c','d','e','f','g','h')\n  read <- allow\n  insert <- allow\n  online only\ninvariant docs.read only deny\n");
    let mut setup=Campaign::default();let fixture=challenges::generated_fixture(&b,&mut setup).unwrap();
    let mut c=Campaign::bounded(10000);c.generated_fixture=true;c.work_remaining=Some(10);
    challenges::fixture_observers(&b,&fixture,&mut c);
    assert!(c.work_remaining.unwrap()>0,"no authored query can distinguish an absent world: {c:?}");
    assert_eq!(c.history_observer_calls,0);assert!(c.violations.is_empty());
}

#[test]
fn history_absence_world_preserves_final_exists_in_other_tables(){
    let b=bound("table codes:\n  code: text <=20\n  unique code\n  read <- allow\n  insert <- allow\n  online only\ntable records:\n  value: text <=20\n  read <- allow\n  insert <- allow\n  after insert <- exists codes[code = .value]\n  online only\ninvariant codes.read only deny\nquery probe():\n  return exists codes[code = 'sample0']\n");
    let mut c=Campaign::default();c.generated_fixture=true;
    let fixture=challenges::generated_fixture(&b,&mut c).unwrap();
    challenges::fixture_observers(&b,&fixture,&mut c);
    assert!(c.violations.is_empty(),"{c:?}");
    assert!(c.unsupported.iter().any(|s|s.contains("absent world invalid")&&s.contains("final-exists")),"{c:?}");
}

#[test]
fn an_update_keeps_appeal_intent_stable_despite_declared_delete_cascades(){
    let source=format!("{ROLES}table bouts:\n  status: enum('recorded','overturned')\n  score: int 0..15\n  read <- allow\n  insert <- allow\n  update <- exists roles[viewer, role = 'doctor']\n  online only\ntable appeals:\n  bout: bouts on delete cascade\n  decision: enum('upheld','pending')\n  unique bout else ALREADY_APPEALED\n  read <- allow\n  insert <- allow\n  online only\nmutation correct(bout: bouts, score: int 0..15):\n  require exists roles[viewer, role = 'doctor'] else NO_ROLE\n  b = bouts[bout] ! else MISSING\n  require b.status = 'recorded' else CLOSED\n  update bouts[bout] {{score}}\n  return null\ninvariant bouts.score update only not exists appeals[bout = .id, decision = 'upheld']\n");
    let b=bound(&source);let mut c=Campaign::default();challenges::generated_campaign(&b,&mut c,false);
    assert!(c.violations.iter().any(|v|v.reachability==Reachability::GeneratedFixtureTrace&&v.history.iter().any(|s|s.operation=="correct")),"{c:?}");
}

#[test]
fn inherited_expiry_replacement_cannot_refute_a_guarded_post_retirement_write(){
    use snapback4_core::{Engine,Store,Value,Context};
    use std::collections::BTreeMap;
    fn row(fields:impl IntoIterator<Item=(&'static str,Value)>)->Value{Value::Row(fields.into_iter().map(|(k,v)|(k.into(),v)).collect())}
    fn id(s:&str)->Value{Value::Id(s.into())}
    let b=bound("table roots:\n  until: time\n  immutable until\n  expire at .until\n  read <- allow\n  insert <- allow\n  online only\ntable slots:\n  root: roots\n  immutable root\n  read through .root\n  insert <- allow\n  online only\ntable docs:\n  score: int\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\ntable approvals:\n  slot: slots on delete cascade\n  doc: docs\n  unique doc\n  cap 1 by slot\n  read <- allow\n  insert <- allow\n  online only\nmutation replace(slot: slots, root: roots, doc: docs):\n  insert slots {id: slot, root}\n  require not exists approvals[doc = doc] else HELD\n  update docs[doc] {score: 2}\n  return null\ninvariant docs.score update only not exists approvals[doc = .id]\n");
    let now=challenges::NOW;
    let mut fixture=Engine::new_at(Store::memory().unwrap(),b.schema.clone(),b.programs.iter().map(|p|p.program.clone()),now-1000).unwrap();
    fixture.seed_at(vec![
        ("roots".into(),row([("id",id("old")),("until",Value::Int(now-1))])),
        ("roots".into(),row([("id",id("new")),("until",Value::Int(now+10000))])),
        ("slots".into(),row([("id",id("slot")),("root",id("old"))])),
        ("docs".into(),row([("id",id("doc")),("score",Value::Int(1))])),
        ("approvals".into(),row([("id",id("approval")),("slot",id("slot")),("doc",id("doc"))])),
    ],now-1000).unwrap();
    assert!(b.schema.tables["slots"].expire.is_none()&&b.schema.tables["slots"].is_expiring());
    let mut actual=fixture.fork_fixture().unwrap();
    let result=actual.mutate("replace",None,Context::new("dev:security-a",BTreeMap::from([("slot".into(),id("slot")),("root".into(),id("new")),("doc".into(),id("doc"))])).at(now)).unwrap();
    assert!(matches!(result.state,snapback4_core::WriteState::Sent{..}));
    assert!(actual.store().rows("approvals").unwrap().is_empty());
    let mut c=Campaign::default();challenges::fixture_observers(&b,&fixture,&mut c);
    assert!(c.operations.get("replace").copied().unwrap_or(0)>0);
    assert!(c.violations.is_empty(),"the guard sees approvals after inherited retirement: {c:?}");
}
