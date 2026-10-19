//! CLI security reporting; compile/test evidence share one analyzer.
// @ref LLP 3000.036.004#5-exposure-report — full audit is opt-in, intent notes are on ordinary check.
use super::*;
use snapback4_lang::security::{self,Report};
mod http;
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
                Ok(fixture)=>security::challenges::fixture_observers(bound,&fixture,&mut campaign),
                Err(why)=>{campaign.unsupported.insert(format!("fixture reachability not covered: {why}"));}
            }
        }else{security::challenges::generated_campaign(bound,&mut campaign,false);}
    }
    let sites=report.invariants.iter().filter(|v|v.status==security::Status::Unproved&&!campaign.violations.iter().any(|c|c.invariant_site==v.invariant.site.to_string()&&c.reachability.is_reachable())).map(|v|v.invariant.site.to_string()).collect();
    let campaign=security::challenges::run_selected_after(bound,Some(&sites),campaign);
    security::challenges::apply(&mut report,&campaign);report
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
pub(super) fn summary(report:&Report,verbose:bool){
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
