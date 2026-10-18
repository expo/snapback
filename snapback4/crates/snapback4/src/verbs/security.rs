//! CLI security reporting; compile/test evidence share one analyzer.
// @ref LLP 3000.036.004#5-exposure-report — full audit is opt-in, intent notes are on ordinary check.
use super::*;
use snapback4_lang::security::{self,Report};
mod http;
pub(super) fn unauthenticated(bound:&Bound,sources:&[(String,String)])->bool {
    match http::run(bound,sources){Ok(_)=>true,Err(why)=>{eprintln!("security HTTP failure: {why}");false}}
}
pub(super) fn report(project:&Project,bound:&Bound)->Report{
    let mut report=security::analyze(bound);
    if let Ok(sources)=project.sources(){security::add_source_notes(&mut report,&sources,bound);}
    let sites=report.invariants.iter().filter(|v|v.status==security::Status::Unproved).map(|v|v.invariant.site.to_string()).collect();
    let campaign=security::challenges::run_selected(bound,Some(&sites));
    security::challenges::apply(&mut report,&campaign);report
}
pub fn audit(options:&Options)->i32{
    let project=project_or_exit();
    let bound=compiled_or_exit(match project.compile(){Ok(b)=>b,Err(e)=>{eprintln!("audit: {e}");return 2;}},options.json);
    let report=report(&project,&bound);
    if options.json {println!("{}",serde_json::to_string(&report).unwrap());}
    else {print!("{}",report.text());}
    if report.refuted(){1}else{0}
}
pub(super) fn summary(report:&Report){
    for v in &report.invariants {eprintln!("security {:?}: {}.{} {}",v.status,v.invariant.table,v.invariant.target,v.invariant.predicate);for why in &v.reasons{eprintln!("  {why}");}if let Some(c)=&v.counterexample{eprintln!("  counterexample {}",serde_json::to_string(c).unwrap());}}
    for note in &report.notes{eprintln!("{}: {} — {}",note.code,note.message,note.rewrite);}
    if !report.invariants.is_empty(){eprintln!("security: audit --json lists paths, exclusions and grant writers; guide security explains proof scope");}
}
