//! SEC4: intent quality, typed generated populations, and bounded work.
use snapback4_lang::{compile, security::{self,challenges::{self,Campaign,Reachability}}};
fn bound(source:&str)->snapback4_lang::Bound {
    let b=compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b
}
const ROLES:&str="use identity password\ntable roles:\n  principal: principal\n  role: enum('doctor','volunteer')\n  unique principal\n  read <- allow\n  insert <- viewer = 'service:operator'\n  online only\n";
#[test]
fn equivalent_intent_is_advice_only_and_semantic_reordering_is_detected(){
    let source="table notes:\n  owner: principal\n  body: text <=80\n  read <- .owner = viewer\n  online only\ninvariant notes.read only viewer = .owner and allow\n";
    let b=bound(source);let r=security::analyze(&b);
    assert!(r.notes.iter().any(|n|n.code=="N_INVARIANT_RESTATES_RULE"&&n.site.line==6));
    assert!(!r.refuted());
    let b=bound(&source.replace("viewer = .owner and allow","viewer = .owner or viewer = 'service:operator'"));
    assert!(!security::analyze(&b).notes.iter().any(|n|n.code=="N_INVARIANT_RESTATES_RULE"));
}
#[test]
fn per_role_population_catches_private_image_and_file_payloads_with_explicit_origin(){
    for field in ["scan: image <=5000", "scan: file <=5000 ('application/pdf')"] {
        let b=bound(&format!("{ROLES}table packages:\n  owner: principal\n  {field}\n  read <- exists roles[viewer]\n  online only\ninvariant packages.scan read only exists roles[viewer, role = 'doctor']\nquery board(c: cursor ?):\n  return packages after c first 100 by .id\n"));
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
    let b=bound("table teams:\n  title: text 1..80\n  read <- allow\n  online only\ntable members:\n  team: teams\n  principal: principal\n  role: enum('admin','member')\n  unique team, principal\n  read <- allow\n  online only\n");
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
    let b=bound("table notes:\n  owner: principal\n  body: text <=80\n  read <- allow\n  online only\ninvariant notes.body read only .owner = viewer\nquery notes():\n  return notes first 100 by .id\n");
    let r=security::analyze(&b);assert!(r.invariants.iter().all(|v|v.status==security::Status::Unproved));
    let c=challenges::run_selected_after(&b,None,Campaign::bounded(0));
    assert!(c.unsupported.iter().any(|s|s.contains("time budget exhausted")));assert!(c.violations.is_empty());
    let mut r=security::analyze(&b);challenges::apply(&mut r,&c);assert!(!r.refuted());
}
#[test]
fn board_advice_names_the_unscoped_branch_but_not_resource_scoped_roles(){
    let source=format!("{ROLES}table reports:\n  owner: principal\n  rating: enum('good','bad')\n  scan: image <=5000 ?\n  read <- .owner = viewer or (exists roles[viewer, role = 'volunteer'] and .rating = 'bad')\n  online only\n");
    let b=bound(&source);assert!(security::analyze(&b).notes.iter().any(|n|n.code=="N_ROLE_WIDE_READ"));
    let b=bound(&source.replace(" and .rating = 'bad'"," and .owner = viewer and .rating = 'bad'"));
    assert!(!security::analyze(&b).notes.iter().any(|n|n.code=="N_ROLE_WIDE_READ"));
}
#[test]
fn dominating_argument_guard_suppresses_excluded_role_and_names_actual_risk(){
    let source=format!("{ROLES}table docs:\n  read <- exists roles[viewer, role = 'doctor']\n  online only\nmutation register(role: enum('doctor','volunteer')):\n  require role = 'volunteer' else NOT_ALLOWED\n  return insert roles {{principal: viewer,role}}\n").replace("insert <- viewer = 'service:operator'","insert <- .principal = viewer");
    let b=bound(&source);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("schema.q".into(),source.clone())],&b);
    assert!(!r.notes.iter().any(|n|n.code=="N_PRIVILEGE_ESCALATION"),"{:?}",r.notes);
    let source=source.replace("  require role = 'volunteer' else NOT_ALLOWED\n","");
    let b=bound(&source);let mut r=security::analyze(&b);security::add_source_notes(&mut r,&[("schema.q".into(),source)],&b);
    assert!(r.notes.iter().any(|n|n.code=="N_PRIVILEGE_ESCALATION"&&n.message.contains("'doctor'")),"{:?}",r.notes);
}

#[test]
fn projected_media_scalar_uses_a_coupled_verified_ledger(){
    let b=bound(&format!("{ROLES}table packages:\n  scan: image <=5000\n  read <- exists roles[viewer]\n  online only\ninvariant packages.scan read only exists roles[viewer, role = 'doctor']\nquery scan(package: packages):\n  p = packages[package] ! else NOT_FOUND\n  return p.scan\n"));
    let mut c=Campaign::default();c.generated_fixture=true;let fixture=challenges::generated_fixture(&b,&mut c).unwrap();
    challenges::fixture_observers(&b,&fixture,&mut c);
    assert!(c.violations.iter().any(|v|v.operation=="scan"&&v.reachability==Reachability::GeneratedFixtureTrace),"{c:?}");
}

#[test]
fn draft_candidates_are_never_equivalent_to_the_read_gate(){
    let b=bound(&format!("{ROLES}table docs:\n  body: text <=80\n  read <- exists roles[viewer, role = 'doctor']\n  online only\n"));
    let draft=security::draft(&b);
    assert!(!draft.lines().any(|line|line.contains("invariant docs.body")&&line.contains("'doctor'")));
    assert!(draft.lines().any(|line|line.contains("invariant docs.body")&&line.contains("'volunteer'")));
}
