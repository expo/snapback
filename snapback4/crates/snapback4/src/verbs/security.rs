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
    let mut campaign=security::challenges::Campaign::default();
    if !bound.invariants.is_empty(){
        let mut selection=options.clone();
        if !selection.flags.contains_key("fixture")&&project.root.join("fixtures").is_dir(){selection.flags.insert("fixture".into(),project.root.join("fixtures").to_string_lossy().into_owned());}
        let fixture=if selection.flags.contains_key("fixture"){
            super::test_fixture::engine_at(project,bound,&selection,1_800_000_000_000)
        }else{
            campaign.unsupported.insert("no supplied fixture: histories start at the validated empty store; populated production states remain uncovered".into());
            snapback4_core::Store::memory().and_then(|store|snapback4_core::Engine::new_at(store,bound.schema.clone(),bound.programs.iter().map(|p|p.program.clone()),1_800_000_000_000)).map_err(|why|why.to_string())
        };
        match fixture{
            Ok(fixture)=>security::challenges::fixture_observers(bound,&fixture,&mut campaign),
            Err(why)=>for verdict in &mut report.invariants{verdict.reasons.push(format!("fixture reachability not covered: {why}"));},
        }
    }
    let sites=report.invariants.iter().filter(|v|v.status==security::Status::Unproved&&!campaign.violations.iter().any(|c|c.invariant_site==v.invariant.site.to_string()&&c.reachability==security::challenges::Reachability::AuthoredFixtureTrace)).map(|v|v.invariant.site.to_string()).collect();
    let campaign=security::challenges::run_selected_after(bound,Some(&sites),campaign);
    security::challenges::apply(&mut report,&campaign);report
}
pub fn audit(options:&Options)->i32{
    let project=project_or_exit();
    let bound=compiled_or_exit(match project.compile(){Ok(b)=>b,Err(e)=>{eprintln!("audit: {e}");return 2;}},options.json);
    let report=report(&project,&bound,options);
    if options.json {println!("{}",serde_json::to_string(&report).unwrap());}
    else {print!("{}",report.text_with_all(options.flags.contains_key("all")));}
    if report.refuted(){1}else{0}
}
pub(super) fn summary(report:&Report,all:bool){
    for v in &report.invariants {if !all&&v.status==security::Status::Refuted&&v.counterexample.as_ref().is_some_and(|c|c.reachability!=security::challenges::Reachability::AuthoredFixtureTrace){eprintln!("security: {} refuted by seed/synthetic witness only (non-failing; --all for detail)",v.invariant.target_label());continue;}eprintln!("security {:?}: {} {}",v.status,v.invariant.target_label(),v.invariant.predicate);for why in &v.reasons{eprintln!("  {why}");}if let Some(c)=&v.counterexample{eprintln!("  counterexample {}",serde_json::to_string(c).unwrap());}}
    for note in &report.notes{eprintln!("{} {}: {} — {}",note.site,note.code,note.message,note.rewrite);}
    if !report.invariants.is_empty(){eprintln!("security: audit --json lists paths, exclusions and grant writers; guide security explains proof scope");}
}
