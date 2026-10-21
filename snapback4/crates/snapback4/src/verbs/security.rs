//! CLI security reporting; compile/test evidence share one analyzer.
// @ref LLP 3000.036.004#5-exposure-report — full audit is opt-in, intent notes are on ordinary check.
use super::*;
use snapback4_lang::security::{self,Report};
mod http;
mod record;
pub(super) use record::{remember,capture};
pub(super) fn unauthenticated(bound:&Bound,sources:&[(String,String)])->bool {
    match http::run(bound,sources){Ok(_)=>true,Err(why)=>{eprintln!("security HTTP failure: {why}");false}}
}
pub(super) fn report(project:&Project,bound:&Bound,sources:&[(String,String)],options:&Options)->Report{
    let mut report=security::analyze(bound);
    security::add_source_notes(&mut report,sources,bound);
    let mut selection=options.clone();
    let selected_fixture=record::selected_fixture(project,options);
    if selected_fixture.is_dir(){selection.flags.insert("fixture".into(),selected_fixture.to_string_lossy().into_owned());}
    let inputs=match selection.flags.get("fixture"){
        Some(path)=>match super::test_fixture::snapshot(std::path::Path::new(path)){Ok(snapshot)=>Some(snapshot),Err(why)=>{report.campaign_coverage.insert(format!("fixture reachability not covered: {why}"));return report;}},None=>None,
    };
    if let Some(snapshot)=&inputs{selection.flags.insert("fixture".into(),snapshot.0.to_string_lossy().into_owned());}
    let cached=record::matching(project,&selection,sources);
    let known_failure=cached.as_ref().is_some_and(|r|!r.violations.is_empty())&&!options.flags.contains_key("security-full");
    let mut campaign=if options.flags.contains_key("security-full"){security::challenges::Campaign::default()}else{security::challenges::Campaign::bounded(1500)};
    if known_failure {campaign.work_remaining=Some(0);campaign.unsupported.insert("matching full-test refutations retained; bounded resampling skipped; repair and rerun snapback4 test".into());}
    if !bound.invariants.is_empty()&&!known_failure{
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
    if let Some(record)=cached {security::challenges::apply(&mut report,&security::challenges::Campaign{violations:record.violations,..Default::default()});}
    report
}
pub fn audit(options:&Options)->i32{
    let project=project_or_exit();
    let sources=match project.sources(){Ok(s)=>s,Err(e)=>{eprintln!("audit: {e}");return 2;}};
    let bound=compiled_or_exit(snapback4_lang::compile(&sources),options.json);
    let mut full=options.clone();full.flags.insert("security-full".into(),String::new());
    let report=report(&project,&bound,&sources,&full);
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
pub(super) fn release_loop(project:&Project,bound:&Bound,sources:&[(String,String)],prior:Option<&Bound>,options:&Options)->Result<Option<String>,String>{
    let changed=prior.is_none_or(|old|bound.schema.tables.iter().any(|(name,t)|old.schema.tables.get(name).is_none_or(|o|serde_json::to_value((&o.rules,&o.column_reads,&o.written_by)).ok()!=serde_json::to_value((&t.rules,&t.column_reads,&t.written_by)).ok()))||old.schema.tables.keys().any(|t|!bound.schema.tables.contains_key(t)));
    if !changed{return Ok(None);}
    // @ref LLP 3000.036.004#153-rule-changing-deployment-review — review is prominent, strictness is explicit and failure-origin aware.
    let report=report(project,bound,sources,options);
    let mut notice=String::from("SECURITY REVIEW — rules changed\n");
    for v in report.invariants.iter().filter(|v|v.status==security::Status::Refuted&&v.counterexample.as_ref().is_some_and(|c|c.reachability.is_reachable())){
        let c=v.counterexample.as_ref().unwrap();
        notice.push_str(&format!("  FIX {} {}: refuted via {} as {} ({:?}); repair enforcement to match intent, then run snapback4 test\n",v.invariant.site,v.invariant.target_label(),c.operation,c.viewer,c.reachability));
    }
    for v in report.invariants.iter().filter(|v|v.status!=security::Status::Proved&&!v.counterexample.as_ref().is_some_and(|c|c.reachability.is_reachable())){
        notice.push_str(&format!("  REVIEW {} {}: unproved — {}; run snapback4 audit for all paths; preserve spec intent\n",v.invariant.site,v.invariant.target_label(),v.reasons.first().map(String::as_str).unwrap_or("finite observations do not prove intent")));
    }
    for n in &report.notes{notice.push_str(&format!("  REVIEW {} {}: {}\n    {}\n",n.site,n.code,n.message,n.rewrite));}
    notice.push_str(&format!("  {}\n",release_notice(project,bound,sources,options)));
    notice.push_str(&format!("  {} independent invariants; {} coverage gaps; finite campaigns are not proof",bound.invariants.len(),report.campaign_coverage.len()));
    exposure(&report);eprintln!("{notice}");
    if options.flags.contains_key("strict")&&report.refuted(){return Err("E_SECURITY_REVIEW: --strict refuses reachable refuted security intent; repair the named rules and rerun snapback4 test before deploy".into());}
    Ok(Some(notice))
}
fn age(timestamp:Option<i64>,now:i64)->String{
    timestamp.map(|t|format!("at {t} ms since Unix epoch, age {}s",now.saturating_sub(t).max(0)/1000)).unwrap_or_else(||"time/age unknown (legacy record)".into())
}
fn release_notice(project:&Project,bound:&Bound,sources:&[(String,String)],options:&Options)->String{
    let selection=options.flags.get("schema").map(|s|format!(" --source {s:?}")).unwrap_or_default();
    let fixture=options.flags.get("fixture").map(|s|format!(" --fixture {s:?}")).unwrap_or_default();
    let now=snapback4_core::now_ms();
    let matching=record::matching(project,options,sources);
    let matches=matching.is_some();
    match matching.or_else(||record::latest(project)){
        Some(record)=>{
            let result=if !record.complete{"incomplete"}else if record.run_violations.unwrap_or(record.violations.len())>0{"FAILED"}else{"completed, no observed violation"};
            let current=if matches{"matches selected source/fixtures/CLI"}else{"STALE: source, fixtures or CLI differ; does not qualify selected release"};
            let next=if matches&&record.complete{"matching test campaign recorded (finite, not proof)".into()}else{format!("run `snapback4 test{selection}{fixture}` before deployment")};
            format!("last test: {result}, {}; {current}; {} retained reachable refutations, {} coverage gaps; last completed test {}; {next}",age(record.recorded_at,now),record.violations.len(),record.coverage_gaps,age(record.last_completed_at,now))
        },
        None=>format!("last test: NEVER RECORDED; run `snapback4 test{selection}{fixture}` before deployment; no matching completed campaign for this source, fixtures and CLI; {} independent invariants",bound.invariants.len()),
    }
}
