//! CLI security reporting; compile/test evidence share one analyzer.
// @ref LLP 3000.036.004#5-exposure-report — full audit is opt-in, intent notes are on ordinary check.
use super::*;
use snapback4_lang::security::{self,Report};
mod http;
mod record;
pub(super) use record::remember;
pub(super) fn unauthenticated(bound:&Bound,sources:&[(String,String)])->bool {
    match http::run(bound,sources){Ok(_)=>true,Err(why)=>{eprintln!("security HTTP failure: {why}");false}}
}
pub(super) fn report(project:&Project,bound:&Bound,options:&Options)->Report{
    let mut report=security::analyze(bound);
    if let Ok(sources)=project.sources(){security::add_source_notes(&mut report,&sources,bound);}
    let mut campaign=if options.flags.contains_key("security-full"){security::challenges::Campaign::default()}else{security::challenges::Campaign::bounded(1500)};
    if !bound.invariants.is_empty(){
        let mut selection=options.clone();
        if !selection.flags.contains_key("fixture")&&project.root.join("fixtures").is_dir(){selection.flags.insert("fixture".into(),project.root.join("fixtures").to_string_lossy().into_owned());}
        if selection.flags.contains_key("fixture"){
            match super::test_fixture::engine_at(project,bound,&selection,1_800_000_000_000){
                Ok(fixture)=>if bound.schema.tables.keys().any(|t|fixture.store().rows(t).is_ok_and(|rs|!rs.is_empty())){security::challenges::fixture_observers(bound,&fixture,&mut campaign)}else{security::challenges::generated_campaign(bound,&mut campaign,false)},
                Err(why)=>{campaign.unsupported.insert(format!("fixture reachability not covered: {why}"));}
            }
        }else{security::challenges::generated_campaign(bound,&mut campaign,false);}
    }
    let sites=report.invariants.iter().filter(|v|v.status==security::Status::Unproved&&!campaign.violations.iter().any(|c|c.invariant_site==v.invariant.site.to_string()&&c.reachability.is_reachable())).map(|v|v.invariant.site.to_string()).collect();
    let campaign=security::challenges::run_selected_after(bound,Some(&sites),campaign);
    security::challenges::apply(&mut report,&campaign);
    if let Some(record)=record::matching(project,options) {security::challenges::apply(&mut report,&security::challenges::Campaign{violations:record.violations,..Default::default()});}
    report
}
pub fn audit(options:&Options)->i32{
    let project=project_or_exit();
    let bound=compiled_or_exit(match project.compile(){Ok(b)=>b,Err(e)=>{eprintln!("audit: {e}");return 2;}},options.json);
    let mut full=options.clone();full.flags.insert("security-full".into(),String::new());
    let report=report(&project,&bound,&full);
    if options.json {println!("{}",serde_json::to_string(&report).unwrap());}
    else {print!("{}",report.text_with_all(options.flags.contains_key("all")));}
    if report.refuted(){1}else{0}
}
pub(super) fn exposure(report:&Report){
    let broad=report.exposures.iter().filter(|e|e.effects.get("read").is_some_and(|r|r=="allow"||r.starts_with("public"))).count();
    eprintln!("security exposure: {} tables, {} conditional audiences, {broad} broadly readable tables; run snapback4 audit for exact role/column predicates",report.exposures.len(),report.roles.len());
}
pub(super) fn summary(report:&Report,verbose:bool){
    exposure(report);
    let proved=report.invariants.iter().filter(|v|v.status==security::Status::Proved).count();
    let refuted=report.invariants.iter().filter(|v|v.status==security::Status::Refuted&&v.counterexample.as_ref().is_some_and(|c|c.reachability.is_reachable())).count();
    let supplemental=report.invariants.iter().filter(|v|v.status==security::Status::Refuted&&!v.counterexample.as_ref().is_some_and(|c|c.reachability.is_reachable())).count();
    eprintln!("security: {proved} proved, {refuted} refuted, {} unproved; {supplemental} seed/synthetic observations (non-failing)",report.invariants.len()-proved-refuted);
    for v in report.invariants.iter().filter(|v|v.status==security::Status::Refuted){
        if let Some(c)=&v.counterexample&&c.reachability.is_reachable(){eprintln!("  {} FAIL {} via {} ({:?}; initial fixture assumptions apply)",v.invariant.site,v.invariant.target_label(),c.operation,c.reachability);}
    }
    if verbose {eprint!("{}",report.text_with_all(true));}
    if !report.invariants.is_empty()||!report.campaign_coverage.is_empty(){eprintln!("  run snapback4 test for full campaigns; {} coverage gaps (--verbose/JSON for details)",report.campaign_coverage.len());}
    if !report.exposures.is_empty(){eprintln!("  run snapback4 audit for column audiences, grant writers and {} uncovered exposures",report.uncovered.len());}
}

/// A rule-changing preflight demands a current campaign, without pretending
/// finite tests or undeclared intent certify a deployment.
pub(super) fn release_loop(project:&Project,bound:&Bound,prior:Option<&Bound>,options:&Options){
    let changed=prior.is_some_and(|old|bound.schema.tables.iter().any(|(name,t)|old.schema.tables.get(name).is_none_or(|o|serde_json::to_value(&o.rules).ok()!=serde_json::to_value(&t.rules).ok()))||old.schema.tables.keys().any(|t|!bound.schema.tables.contains_key(t)));
    if !changed{return;}
    let report=security::analyze(bound);exposure(&report);
    let selection=options.flags.get("schema").map(|s|format!(" --source {s:?}")).unwrap_or_default();
    let fixture=options.flags.get("fixture").map(|s|format!(" --fixture {s:?}")).unwrap_or_default();
    match record::matching(project,options){
        Some(record) if record.complete=>eprintln!("security rules changed: matching test campaign recorded; {} reachable refutations; {} coverage gaps; {} independent invariants (finite, not proof)",record.violations.len(),record.coverage_gaps,bound.invariants.len()),
        _=>eprintln!("security rules changed: run `snapback4 test{selection}{fixture}` before deployment; no matching completed campaign for this source, fixtures and CLI; {} independent invariants",bound.invariants.len()),
    }
}
