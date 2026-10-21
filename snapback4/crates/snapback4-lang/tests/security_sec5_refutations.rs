//! Wave-20 SEC5: rule contradictions require real, repeatable observations.
use snapback4_lang::{compile,security::{self,challenges::{self,Campaign}}};
fn bound(source:&str)->snapback4_lang::Bound {
    let b=compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);b
}
#[test]
fn wave20_contact_columns_refute_with_authored_observers(){
    let b=bound(include_str!("security/wave20/050.q"));
    // Keep the production 512-reservation cap, with wall-clock headroom for
    // the parallel full suite on shared qualification hosts.
    let mut budget=Campaign::bounded(10000);
    let direct=security::analyze_with_campaign(&b,&mut budget);
    assert!(direct.refuted(),"bounded check did not refute the excluded intake role: {direct:#?}");
    assert!(direct.invariants.iter().all(|v|v.status==security::Status::Refuted),"bounded check must share its work across both contact columns: {direct:#?}");
    let mut c=Campaign::default();c.generated_fixture=true;
    let fixture=challenges::generated_fixture(&b,&mut c).unwrap();
    challenges::fixture_observers(&b,&fixture,&mut c);
    let mut r=security::analyze(&b);challenges::apply(&mut r,&c);
    assert!(r.refuted(),"{c:#?}");
    assert!(r.invariants.iter().all(|v|v.status==security::Status::Refuted),"{r:#?}");
}

#[test]
fn media_pairs_hold_unrelated_asset_identities_constant(){
    for media in ["image <=5000","file <=5000 ('application/pdf')","[image <=5000] 1..2"]{
        let b=bound(&format!("table notes:\n  owner: principal\n  media: {media}\n  body: text <=80\n  read <- .owner = viewer\n  online only\nview totals: count notes by .owner\n  read <- allow\n  online only\nquery total(owner: principal):\n  return totals[owner]\ninvariant notes.read only .owner = viewer\n"));
        let c=challenges::run(&b);
        assert!(c.violations.iter().any(|v|v.observations.is_some()),"{media}: {c:#?}");
        assert!(!c.unsupported.iter().any(|s|s.contains("asset identities are not coupled")),"{c:#?}");
        assert!(c.violations.iter().all(|v|!v.reachability.is_reachable()),"synthetic comparison must retain its origin: {c:#?}");
    }
}

const ROLE_SOURCE:&str="table roles:\n  principal: principal\n  role: enum('intake','senior')\n  unique principal\n  read <- allow\n  insert <- viewer = 'service:operator'\n  online only\ntable notes:\n  owner: principal\n  body: text <=80\n  read <- exists roles[viewer, role = 'intake']\n  insert <- allow\n  online only\ninvariant notes.body read only .owner = viewer or exists roles[viewer, role = 'senior']\n";

#[test]
fn failed_boolean_implication_without_a_real_disclosure_stays_unproved(){
    for source in [ROLE_SOURCE.into(),format!("{ROLE_SOURCE}query inspect(note: notes):\n  n = notes[note] ! else NOT_FOUND\n  return {{ id: n.id }}\n"),format!("{}query inspect(note: notes):\n  return notes[note]\n",ROLE_SOURCE.replace("read <- exists roles[viewer, role = 'intake']","read <- exists roles[viewer, role = 'intake'] and exists roles[viewer, role = 'senior']"))]{
        let b=bound(&source);let r=security::analyze(&b);
        assert!(!r.refuted(),"{r:#?}");
        assert_eq!(r.invariants[0].status,security::Status::Unproved);
    }
}

#[test]
fn analysis_work_exhaustion_cannot_turn_candidates_into_failures(){
    let b=bound(&format!("{ROLE_SOURCE}query inspect(note: notes):\n  return notes[note]\n"));
    let mut c=Campaign::bounded(10000);c.work_remaining=Some(0);
    let r=security::analyze_with_campaign(&b,&mut c);
    assert!(!r.refuted());assert_eq!(r.invariants[0].status,security::Status::Unproved);
    assert!(c.unsupported.iter().any(|s|s.contains("budget exhausted")));
}

#[test]
fn corrected_contact_audience_is_not_refused(){
    let source=include_str!("security/wave20/050.q").replace("read (ownerName, address) <- .owner = viewer or exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'senior']","read (ownerName, address) <- .owner = viewer or exists roles[viewer, role = 'senior']");
    let b=bound(&source);let r=security::analyze(&b);
    assert!(!r.refuted(),"{r:#?}");
    assert!(r.invariants.iter().all(|v|v.direct_rule==security::Status::Proved));
}
#[test]
fn wave20_incident_media_does_not_block_real_refutations(){
    let b=bound(include_str!("security/wave20/036.q"));
    let mut c=Campaign::default();challenges::generated_campaign(&b,&mut c,false);
    let mut r=security::analyze(&b);challenges::apply(&mut r,&c);
    assert!(r.refuted(),"{c:#?}");
}
