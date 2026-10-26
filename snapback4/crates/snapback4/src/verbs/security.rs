//! CLI security reporting; compile/test evidence share one analyzer.
// @ref LLP 3000.036.004#191-deploy-rollback-and-release-inspection-dx12 — gates lead; deploy advisory questions are opt-in.
use super::*;
use snapback4_lang::security::{self,Report};
mod http;
mod record;
mod presence;
pub(super) mod witnesses;
#[cfg(test)] mod derived_tests;
pub(super) use presence::remember as remember_presence;
pub(super) use record::{remember,capture};
pub(super) fn unauthenticated(project:&Project,bound:&Bound,sources:&[(String,String)])->bool {
    match http::run(project,bound,sources){Ok(_)=>true,Err(why)=>{eprintln!("security HTTP failure: {why}");false}}
}
pub(super) fn report(project:&Project,bound:&Bound,sources:&[(String,String)],options:&Options)->Report{
    report_with_reviewed(project,bound,sources,options,&Default::default())
}
fn report_with_reviewed(project:&Project,bound:&Bound,sources:&[(String,String)],options:&Options,reviewed:&std::collections::BTreeSet<String>)->Report{
    let augmented=if options.flags.contains_key("security-deploy"){security::derived::augmented(sources,bound)}else{bound.clone()};
    let bound=&augmented;
    // Reviewed alternatives remain in the report and full-test evidence, but
    // cannot spend the production replay budget ahead of other obligations.
    let replay=if reviewed.is_empty(){std::borrow::Cow::Borrowed(bound)}else{
        let mut replay=bound.clone();replay.invariants.retain(|i|!security::derived::is_derived(i)||!reviewed.contains(&i.site.to_string()));std::borrow::Cow::Owned(replay)
    };
    let replay=replay.as_ref();
    let mut selection=options.clone();
    selection.json=true; // Internal fixture loading must not print a second check transcript.
    let selected_fixture=record::selected_fixture(project,options);
    if selected_fixture.is_dir(){selection.flags.insert("fixture".into(),selected_fixture.to_string_lossy().into_owned());}
    let inputs=match selection.flags.get("fixture"){
        Some(path)=>match super::test_fixture::snapshot(std::path::Path::new(path)){Ok(snapshot)=>Some(snapshot),Err(why)=>{let mut report=security::analyze_rules(bound);security::add_source_notes(&mut report,sources,bound);report.campaign_coverage.insert(format!("fixture reachability not covered: {why}"));return report;}},None=>None,
    };
    if let Some(snapshot)=&inputs{selection.flags.insert("fixture".into(),snapshot.0.to_string_lossy().into_owned());}
    let cached=record::matching(project,&selection,sources);
    let known_failure=cached.as_ref().is_some_and(|record|record.violations.iter().any(|v|v.reachability.is_reachable()&&replay.invariants.iter().any(|i|!security::derived::is_derived(i)&&i.site.to_string()==v.invariant_site)))&&!options.flags.contains_key("security-full");
    let mut campaign=if options.flags.contains_key("security-full"){security::challenges::Campaign::default()}else{if options.flags.contains_key("security-deploy"){security::challenges::Campaign::work_bounded(3072)}else{security::challenges::Campaign::work_bounded(512)}};
    if known_failure {campaign.work_remaining=Some(0);campaign.unsupported.insert("matching full-test refutations retained; bounded resampling skipped; repair and rerun snapback4 test".into());}
    // An explicitly selected fixture remains the initial-state assumption.
    // Static generation runs only on the fixture-free path; both share this
    // one bounded campaign with all subsequent concrete exploration.
    let mut report=if selection.flags.contains_key("fixture")||known_failure||options.flags.contains_key("security-deploy"){
        security::analyze_rules(bound)
    }else{security::analyze_with_campaign(bound,&mut campaign)};
    security::add_source_notes(&mut report,sources,bound);
    if !replay.invariants.is_empty()&&!known_failure{
        if selection.flags.contains_key("fixture"){
            match super::test_fixture::engine_at(project,replay,&selection,1_800_000_000_000){
                Ok(fixture)=>if bound.schema.tables.keys().any(|t|fixture.store().rows(t).is_ok_and(|rs|!rs.is_empty())){security::challenges::fixture_observers(replay,&fixture,&mut campaign)}else{
                    // An empty starter directory selects generation, just as
                    // no fixture does. Give the direct contradiction its turn
                    // before empty-start mutation permutations spend the cap.
                    let explored=security::analyze_with_campaign(replay,&mut campaign);
                    if reviewed.is_empty(){report=explored;}
                    security::add_source_notes(&mut report,sources,bound);
                    security::challenges::generated_campaign(replay,&mut campaign,false)
                },
                Err(why)=>{campaign.unsupported.insert(format!("fixture reachability not covered: {why}"));}
            }
        }else{security::challenges::generated_campaign(replay,&mut campaign,false);}
    }
    let sites=report.invariants.iter().filter(|v|v.status==security::Status::Unproved&&!campaign.violations.iter().any(|c|c.invariant_site==v.invariant.site.to_string()&&c.reachability.is_reachable())).map(|v|v.invariant.site.to_string()).collect();
    let campaign=security::challenges::run_selected_after(replay,Some(&sites),campaign);
    security::challenges::apply(&mut report,&campaign);
    report.notes.extend(presence::notes(project,bound,None,sources).unwrap_or_else(|why|vec![snapback4_lang::Diagnostic::new(&Default::default(),"N_PRESENCE_LOOSENING",why,"repair the unreadable generated presence baseline").guide("security")]));
    if let Some(record)=cached {security::challenges::apply(&mut report,&security::challenges::Campaign{violations:record.violations,..Default::default()});}
    let mut canonical=security::analyze_rules(bound);
    security::add_source_notes(&mut canonical,sources,bound);
    canonical.notes.extend(report.notes.iter().filter(|n|n.code=="N_PRESENCE_LOOSENING").cloned());
    report.notes=canonical.notes;
    report
}
pub fn audit(options:&Options)->i32{
    let project=project_or_exit();
    let sources=match project.sources(){Ok(s)=>s,Err(e)=>{eprintln!("audit: {e}");return 2;}};
    let bound=compiled_or_exit(snapback4_lang::compile(&sources),options.json);
    // Audit is a permission map plus bounded evidence; `test` owns full campaigns.
    let report=report(&project,&bound,&sources,options);
    let dispositions=match super::security_reviews::review(&project,&sources,&report.notes,None){Ok(d)=>d,Err(error)=>{eprintln!("audit: E_SECURITY_NOTES: {error}");return 2;}};
    if options.json {let mut value=serde_json::to_value(&report).unwrap();value["securityReviews"]=serde_json::to_value(&dispositions).unwrap();println!("{value}");}
    else {let mut human=report.clone();human.notes.retain(|n|crate::note_rank::tier(&n.code)!=crate::note_rank::Tier::Review);print!("{}",human.text_with_all(options.flags.contains_key("all")));super::security_reviews::print(&dispositions,&report.notes);}
    if report.refuted(){1}else{0}
}
pub(super) fn exposure(report:&Report){
    let broad=report.exposures.iter().filter(|e|e.effects.get("read").is_some_and(|r|r=="allow"||r.starts_with("public"))).count();
    eprintln!("security exposure: {} tables, {} conditional audiences, {broad} broadly readable tables; run snapback4 audit for exact role/column predicates",report.exposures.len(),report.roles.len());
}
// @ref LLP 3000.036.004#18-wave-26-security-decisions-dx9 — report enforcement facts without claiming complete security.
pub(super) fn enforced(report:&Report,bound:&Bound){println!("{}",enforced_text(report,bound));}
pub(in crate::verbs) fn enforced_text(report:&Report,bound:&Bound)->String {
    let roles=report.notes.iter().filter(|n|n.code=="N_PRIVILEGE_ESCALATION").count();
    let columns=bound.schema.visible_tables().map(|(_,t)|t.column_reads.len()).sum::<usize>();
    let uploads=bound.schema.visible_tables().flat_map(|(_,t)|t.columns.values()).filter(|t|t.contains_asset()).count();
    format!("check: enforced by the language — {uploads} typed upload columns with owner-bound placement; {columns} column audiences; {roles} possible self-assignable role paths detected (bounded analysis)")
}
pub(super) fn summary(report:&Report,verbose:bool){
    let proved=report.invariants.iter().filter(|v|v.status==security::Status::Proved).count();
    let failures=report.invariants.iter().filter(|v|v.status==security::Status::Refuted&&v.counterexample.as_ref().is_some_and(|c|c.reachability.is_reachable())).collect::<Vec<_>>();
    let refuted=report.invariants.iter().filter(|v|v.status==security::Status::Refuted).count();
    let rule_enforced=report.invariants.iter().filter(|v|v.status==security::Status::Unproved&&v.direct_rule==security::Status::Proved).count();
    eprintln!("security: {proved} proved, {refuted} refuted; {rule_enforced} enforced by rule (additional paths not proved); {} other unproved ({} failing)",report.invariants.len()-proved-refuted-rule_enforced,failures.len());
    for v in &failures {
        let c=v.counterexample.as_ref().unwrap();
        eprintln!("  FIX {}: {} via {} as {} ({}); tighten enforcement to the declared intent, then run snapback4 test",v.invariant.site,v.invariant.target_label(),c.operation,c.viewer,serde_json::to_value(&c.reachability).unwrap().as_str().unwrap());
    }
    let supplemental=report.invariants.iter().filter(|v|v.status==security::Status::Refuted&&v.counterexample.as_ref().is_some_and(|c|!c.reachability.is_reachable())).count();
    if supplemental>0 {eprintln!("  {supplemental} seed/synthetic observations (non-failing)");}
    if verbose {let mut human=report.clone();human.notes.retain(|n|crate::note_rank::tier(&n.code)!=crate::note_rank::Tier::Review);eprint!("{}",human.text_with_all(true));}
    else if !report.invariants.is_empty()||!report.campaign_coverage.is_empty(){eprintln!("  next: snapback4 test; {} coverage gaps (check --verbose/JSON keeps every reason)",report.campaign_coverage.len());}
    if !report.exposures.is_empty(){eprintln!("  review audiences and {} uncovered exposures: snapback4 audit",report.uncovered.len());}
}

/// A rule-changing preflight demands a current campaign, without pretending
/// finite tests or undeclared intent certify a deployment.
pub(super) fn release_loop(project:&Project,bound:&Bound,sources:&[(String,String)],prior:Option<&Bound>,options:&Options)->Result<Option<String>,String>{
    let changed=match prior {
        None=>true,
        Some(old)=>serde_json::to_vec(&old.schema).map_err(|e|e.to_string())?!=serde_json::to_vec(&bound.schema).map_err(|e|e.to_string())?
            ||serde_json::to_vec(&old.invariants).map_err(|e|e.to_string())?!=serde_json::to_vec(&bound.invariants).map_err(|e|e.to_string())?
            ||serde_json::to_vec(&old.programs.iter().map(|p|&p.program).collect::<Vec<_>>()).map_err(|e|e.to_string())?!=serde_json::to_vec(&bound.programs.iter().map(|p|&p.program).collect::<Vec<_>>()).map_err(|e|e.to_string())?,
    };
    if !changed{return Ok(None);}
    // @ref LLP 3000.036.004#153-rule-changing-deployment-review — review is prominent, strictness is explicit and failure-origin aware.
    let started=std::time::Instant::now();
    let mut preflight=options.clone();if !options.flags.contains_key("staging")||options.flags.contains_key("strict"){preflight.flags.insert("security-deploy".into(),String::new());}
    let decisions=super::security_reviews::ReviewSnapshot::capture(project)?;
    let derived=security::derived::notes(sources,bound);
    // A legacy rationale cannot skip the replay that establishes its current
    // witness. Individual alternatives are applied only after actual evidence.
    let mut report=report_with_reviewed(project,bound,sources,&preflight,&Default::default());
    report.notes.extend(presence::notes(project,bound,prior,sources)?);
    if super::proof_source::sources(project,options,"schema")?!=sources{return Err("selected Quarry sources changed during deployment security preflight".into());}
    let mut evidence=witnesses::collect(project,bound,sources,&report.notes,true,options);
    witnesses::apply_report(sources,bound,&report,&report.notes,&mut evidence);
    if super::proof_source::sources(project,options,"schema")?!=sources{return Err("selected Quarry sources changed during deployment witness replay; rerun deploy".into());}
    let mut dispositions=decisions.dispositions_with_evidence(sources,&report.notes,&evidence);
    // Current enforced derived refutations are blockers, never advisory questions.
    // Standalone question-campaign witnesses retain their nonblocking tier.
    for (note,disposition) in report.notes.iter().zip(&mut dispositions) {
        if note.code=="N_DERIVED_WRITE_AUTHORITY" && report.invariants.iter().any(|v|
            v.invariant.site==note.site && v.status==security::Status::Refuted &&
            v.counterexample.as_ref().is_some_and(|c|c.reachability.is_reachable() &&
                super::security_reviews::witness::concrete(&witnesses::evidence(sources,bound,&v.invariant,c)))) {
            disposition.gated=true;
        }
    }
    super::security_reviews::remember_families(project,sources,&report.notes);
    decisions.ensure_current(project)?;
    let acknowledged=derived.iter().filter(|n|report.notes.iter().zip(&dispositions).any(|(r,d)|r.site==n.site&&r.code==n.code&&r.message==n.message&&d.acknowledged)).map(|n|n.site.to_string()).collect::<std::collections::BTreeSet<_>>();
    let pending=super::security_reviews::pending(&dispositions);
    let witnessed=|v:&&security::Verdict|v.status==security::Status::Refuted&&v.counterexample.as_ref().is_some_and(|c|c.reachability.is_reachable()&&(!security::derived::is_derived(&v.invariant)||super::security_reviews::witness::concrete(&witnesses::evidence(sources,bound,&v.invariant,c))));
    let fixes=report.invariants.iter().filter(witnessed).filter(|v|!security::derived::is_derived(&v.invariant)||!acknowledged.contains(&v.invariant.site.to_string())).count();
    let authored_fixes=report.invariants.iter().filter(witnessed).filter(|v|!security::derived::is_derived(&v.invariant)).count();
    if options.flags.contains_key("verbose") { eprintln!("security deploy campaign: {} ms; bounded replay, remaining paths retain coverage gaps",started.elapsed().as_millis()); }
    let scope=release_scope(bound,prior,sources);
    let review=options.flags.contains_key("review")||options.flags.contains_key("verbose");
    let mut notice=String::new();
    for v in report.invariants.iter().filter(witnessed){
        let c=v.counterexample.as_ref().unwrap();
        if security::derived::is_derived(&v.invariant)&&acknowledged.contains(&v.invariant.site.to_string()){
            if review {notice.push_str(&format!("  REVIEWED derived {}: individual specification decision retained\n",v.invariant.target_label()));} continue;
        }
        notice.push_str(&format!("  FIX {} {}: refuted via {} as {} ({:?}); repair enforcement to match intent, then run snapback4 test\n",v.invariant.site,v.invariant.target_label(),c.operation,c.viewer,c.reachability));
        if !security::derived::is_derived(&v.invariant) {
            if v.invariant.target=="write"&&v.invariant.column.is_some()&&c.effect=="insert" {
                notice.push_str(&format!("  INTENT {}: if broader creation is deliberate, replace this assertion with `invariant {}.{} update only {}`; then run snapback4 test. Authored contradictions cannot be cleared with --ack-security\n",v.invariant.site,v.invariant.table,v.invariant.column.as_ref().unwrap(),v.invariant.predicate));
            }else {
                notice.push_str(&format!("  INTENT {}: if this observed audience is deliberate, revise the authored assertion here to match that specification, then run snapback4 test; --ack-security applies only to derived questions, never an authored contradiction\n",v.invariant.site));
            }
        }
        let aggregates=bound.schema.maintains.iter().filter(|m|m.source==v.invariant.table).map(|m|m.target.as_str()).collect::<Vec<_>>();
        if c.observations.is_some()&&!aggregates.is_empty()&&v.invariant.target=="read"&&v.invariant.column.is_none() {
            notice.push_str(&format!("  DERIVED {}: a separately readable aggregate changes in the paired observation; tightening the source read rule alone cannot clear this disclosure\n",aggregates.join(", ")));
            let field=v.invariant.predicate.split('.').skip(1).filter_map(|part|part.split(|c:char|!c.is_alphanumeric()&&c!='_').next()).find(|field|bound.schema.table(&v.invariant.table).and_then(|t|t.columns.get(*field)).is_some_and(|kind|matches!(kind.required(),snapback4_core::schema::ColumnType::Principal)));
            if let Some(field)=field {notice.push_str(&format!("  INTENT {}: if aggregate counts are intentionally public, replace the whole-row assertion with `invariant {}.{} read only {}` for this protected field and independently declare any other private fields; otherwise restrict the aggregate audience; rerun snapback4 test\n",v.invariant.site,v.invariant.table,field,v.invariant.predicate));}
        }else if v.invariant.target=="read"&&v.invariant.column.is_none() {
            for (file,text) in sources {
                let doc=snapback4_lang::parser::parse_document(file,text).0;
                if let Some(table)=doc.tables.iter().find(|t|t.name==v.invariant.table) {
                    if let Some(rule)=table.rules.iter().find(|r|r.effect==snapback4_lang::ast::Effect::Read) {
                        let expanded=bound.refusal_sites.get(&(v.invariant.table.clone(),"$read-rule".into()));
                        if expanded.is_some() {
                            notice.push_str(&format!("  SOURCE {}: preserve `{}` and its parent lifetime/authority; if this audience is unintended, repair the parent read rule before rerunning snapback4 test\n",v.invariant.table,snapback4_lang::bind::spell_internals(&snapback4_lang::print::expression(&rule.value))));
                        }else {
                            notice.push_str(&format!("  SOURCE {}: retain the current audience and enforce this declared intent with `read <- ({}) and ({})`; rerun snapback4 test\n",v.invariant.table,snapback4_lang::print::expression(&rule.value),v.invariant.predicate));
                        }
                        let predicate=expanded.cloned().unwrap_or_else(||snapback4_lang::print::expression(&rule.value));
                        notice.push_str(&format!("  INTENT {}: if every reader admitted by the current read rule is deliberately allowed, replace this assertion with `invariant {}.read only {predicate}`; then run snapback4 test and deploy again. This is an authored specification change, not --ack-security\n",v.invariant.site,v.invariant.table));
                    }
                }
            }
        }

    }
    let mut notes=report.notes.iter().filter(|n|n.code!="N_SECURITY_INTENT"&&scope.iter().any(|(file,start,end)|n.site.file==*file&&n.site.line>=*start&&n.site.line<*end)).collect::<Vec<_>>();
    notes.sort_by_key(|n|crate::note_rank::summary_order(&n.code));
    let count=notes.len();
    // Never suppress a gate or write-authority question behind the display cap.
    for (i,n) in notes.into_iter().enumerate(){if (review||crate::note_rank::tier(&n.code)==crate::note_rank::Tier::Fix)&&crate::note_rank::tier(&n.code)!=crate::note_rank::Tier::Review&&(i<5||security::note_priority(&n.code)<=3||crate::note_rank::tier(&n.code)==crate::note_rank::Tier::Fix){notice.push_str(&format!("  REVIEW {} {}: {}\n    {}\n",n.site,n.code,n.message,n.rewrite));}}
    if review&&count>5 {notice.push_str(&format!("  {count} changed-scope notes in deploy --check --json\n"));}
    let selected=report.notes.iter().zip(&dispositions).filter(|(n,d)|d.gated || d.witness.is_some()&&!d.acknowledged || n.code!="N_SECURITY_INTENT" && scope.iter().any(|(file,start,end)| n.site.file==*file&&n.site.line>=*start&&n.site.line<*end)).collect::<Vec<_>>();
    let complete_family=dispositions.iter().filter(|d|d.family.is_some()).count()==selected.iter().filter(|(_,d)|d.family.is_some()).count();
    let scoped_notes=selected.iter().map(|(n,_)|(*n).clone()).collect::<Vec<_>>();
    let scoped_dispositions=selected.iter().map(|(_,d)| {let mut d=(*d).clone(); if !complete_family {d.family=None;} d}).collect::<Vec<_>>();
    // A scoped deploy cannot silently acknowledge unseen family members. It
    // prints their individual commands; ordinary check offers the whole family.
    notice.push_str(&super::security_reviews::render_mode(&scoped_dispositions,&scoped_notes,review));
    let test=release_notice(project,bound,sources,options);
    let advice=scoped_dispositions.iter().filter(|d|!d.gated&&!d.acknowledged&&d.witness.is_none()).count();
    let witnessed=scoped_dispositions.iter().filter(|d|!d.gated&&!d.acknowledged&&d.witness.is_some()).count();
    notice.push_str(&format!("{}; {witnessed} witnessed questions; {advice} advisories (don't block): deploy --review (or check --review)\n",enforced_text(&report,bound).replacen("check:","security:",1)));
    if review||test.contains("run `snapback4 test")||test.contains("FAILED") {notice.push_str(&format!("  {test}\n"));}
    let gates=dispositions.iter().filter(|d|d.gated&&!d.acknowledged).count();
    let verdict=format!("security FIX {authored_fixes}; {gates} gates; {witnessed} witnessed questions; {advice} advisories (don't block): deploy --review");
    Ok(Some(serde_json::json!({"notice":notice,"verdict":verdict,"fixes":fixes,"pending":pending,"changedNotes":count,"report":report,"securityReviews":dispositions}).to_string()))
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
            let next=if matches&&record.complete&&record.run_violations.unwrap_or(record.violations.len())==0{"matching test campaign recorded (finite, not proof)".into()}else{format!("run `snapback4 test{selection}{fixture}` before deployment")};
            format!("last test: {result}, {}; {current}; {} retained reachable refutations, {} coverage gaps; last completed test {}; {next}",age(record.recorded_at,now),record.violations.len(),record.coverage_gaps,age(record.last_completed_at,now))
        },
        None=>format!("last test: NEVER RECORDED; run `snapback4 test{selection}{fixture}` before deployment; no matching completed campaign for this source, fixtures and CLI; {} independent invariants",bound.invariants.len()),
    }
}

// SEC7 owns ordinary check ranking/gates; this scope and output belong to ROLL.
fn release_scope(bound:&Bound,prior:Option<&Bound>,sources:&[(String,String)])->Vec<(String,u32,u32)> {
    let mut scope=Vec::new();
    fn normalized(p:&impl serde::Serialize)->serde_json::Value {
        fn clear(v:&mut serde_json::Value){match v{serde_json::Value::Object(o)=>{o.remove("site");for v in o.values_mut(){clear(v);}},serde_json::Value::Array(a)=>for v in a{clear(v)},_=>()}}
        let mut v=serde_json::to_value(p).unwrap();clear(&mut v);v
    }
    for(file,text)in sources {
        let doc=snapback4_lang::parser::parse_document(file,text).0;
        let mut starts=text.lines().enumerate().filter(|(_,s)|!s.is_empty()&&!s.starts_with(char::is_whitespace)&&!s.starts_with("--")).map(|(i,_)|i as u32+1).collect::<Vec<_>>();starts.sort();
        let mut add=|line:u32|scope.push((file.clone(),line,starts.iter().copied().find(|n|*n>line).unwrap_or(u32::MAX)));
        for t in &doc.tables {if prior.is_none_or(|old|old.schema.tables.get(&t.name).map(normalized)!=bound.schema.tables.get(&t.name).map(normalized)){add(t.site.line);}}
        for p in &doc.programs {
            let next=bound.programs.iter().find(|b|b.program.name==p.name);
            let old=prior.and_then(|b|b.programs.iter().find(|b|b.program.name==p.name));
            if next.map(|b|normalized(&b.program))!=old.map(|b|normalized(&b.program)){add(p.site.line);}
        }
    }scope
}
pub(super) fn print_release(summary:Option<&String>){if let Some(s)=summary.and_then(|s|serde_json::from_str::<serde_json::Value>(s).ok()){eprint!("{}",s["notice"].as_str().unwrap_or(""));}}
pub(super) fn release_verdict(summary:Option<&String>)->String {summary.and_then(|s|serde_json::from_str::<serde_json::Value>(s).ok()).and_then(|s|s["verdict"].as_str().map(str::to_owned)).unwrap_or_else(||"security unchanged".into())}

pub(super) fn enforce_release(summary:Option<&String>,options:&Options)->Result<(),String>{
    let Some(value)=summary.and_then(|s|serde_json::from_str::<serde_json::Value>(s).ok())else{return Ok(())};
    if !options.flags.contains_key("staging")||options.flags.contains_key("strict"){
        if value["fixes"].as_u64().unwrap_or(0)>0{return Err("E_SECURITY_REVIEW: production deploy refuses reachable FIX; repair the named rule and rerun snapback4 test; for a derived candidate only, run check --ack-security ID --reason '<specification rationale>' using the reported rule ID".into())}
        if value["pending"].as_bool()==Some(true){return Err("E_SECURITY_REVIEW: production deploy requires individual security review; run each reported check --ack-security ID --reason '<specification decision>', or enforce the named intent in source".into())}
    }Ok(())
}
