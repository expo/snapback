//! Predecessor sources select candidates; only fresh replay may make them gates.
// @ref LLP 3000.036.004.002#s2-release-narrowing — immutable release predecessors supersede generated local baselines.
use super::*;
type Sources=Vec<(String,String)>;
fn path(project:&Project)->std::path::PathBuf{project.schema_dir().join("generated/security-write-baseline.json")}
fn previous(project:&Project)->Result<Option<Sources>,String>{match std::fs::read(path(project)){
 Ok(bytes)=>serde_json::from_slice(&bytes).map(Some).map_err(|e|format!("invalid security write baseline: {e}")),
 Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(None),Err(e)=>Err(format!("cannot read security write baseline: {e}")),
}}
pub(super) fn notes(project:&Project,bound:&Bound,sources:&[(String,String)],prior:Option<&[(String,String)]>)->Result<Vec<snapback4_lang::Diagnostic>,String>{
 let baseline=if prior.is_none(){selected(project)?.or(previous(project)?)}else{None};
 let Some(previous)=prior.or(baseline.as_deref())else{return Ok(Vec::new());};
 if previous==sources{return Ok(Vec::new());}
 let old=snapback4_lang::compile(previous);if !old.diagnostics.is_empty(){return Err("security write baseline does not compile; restore its last successful sources or use an immutable release predecessor".into());}
 Ok(security::release_create::candidates(sources,bound,previous,&old).into_iter().map(|c|c.note).collect())
}
pub(super) fn remember(project:&Project,sources:&[(String,String)])->Result<(),String>{
 let bound=snapback4_lang::compile(sources);
 if !notes(project,&bound,sources,None)?.is_empty(){return Ok(());}
 let path=path(project);std::fs::create_dir_all(path.parent().unwrap()).map_err(|e|e.to_string())?;
 let temporary=path.with_extension(format!("{}.tmp",std::process::id()));
 let result=std::fs::write(&temporary,serde_json::to_vec(sources).unwrap()).and_then(|_|std::fs::rename(&temporary,&path));
 if result.is_err(){let _=std::fs::remove_file(temporary);}result.map_err(|e|e.to_string())
}
/// These hypotheses are already qualified against a predecessor. Reconstruct the
/// same column predicate for the ordinary fresh evidence campaign.
pub(super) fn candidate(sources:&[(String,String)],note:&snapback4_lang::Diagnostic)->Option<security::Invariant>{
 let details:serde_json::Value=serde_json::from_str(note.details.as_deref()?).ok()?;
 let fields=details.get("releaseCreate")?;
 let mut inv=super::witnesses::candidate(sources,&format!("invariant {}.{} write only {}",fields["table"].as_str()?,fields["column"].as_str()?,fields["policy"].as_str()?))?;
 inv.operation=Some(fields["operation"].as_str()?.into());Some(inv)
}

// A refused deployment leaves its exact predecessor available to the printed
// ordinary check/ack command, including in a fresh checkout with no check baseline.
fn selected(project:&Project)->Result<Option<Sources>,String>{
 let path=project.schema_dir().join("generated/security-write-release.json");
 match std::fs::read(path){Ok(bytes)=>serde_json::from_slice(&bytes).map(Some).map_err(|e|format!("invalid selected security predecessor: {e}")),Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(None),Err(e)=>Err(e.to_string())}
}
pub(super) fn select(project:&Project,sources:&[(String,String)])->Result<(),String>{
 let path=project.schema_dir().join("generated/security-write-release.json");std::fs::create_dir_all(path.parent().unwrap()).map_err(|e|e.to_string())?;
 let temporary=path.with_extension(format!("{}.tmp",std::process::id()));
 let result=std::fs::write(&temporary,serde_json::to_vec(sources).unwrap()).and_then(|_|std::fs::rename(&temporary,&path));
 if result.is_err(){let _=std::fs::remove_file(temporary);}result.map_err(|e|e.to_string())
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn sec12_a_fresh_deploys_predecessor_is_available_to_its_printed_ack_command(){
  let root=std::env::temp_dir().join(format!("sb4-sec12-release-{}",std::process::id()));std::fs::create_dir_all(root.join("snapback")).unwrap();
  struct Cleanup(std::path::PathBuf);impl Drop for Cleanup{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}let _cleanup=Cleanup(root.clone());let project=Project{root};
  let original="table docs:\n  value: int\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create(value: int):\n  return insert docs { value }\n";
  let previous=vec![("schema.q".into(),original.into())];let old=snapback4_lang::compile(&previous);
  let current=format!("{original}\nmutation edit(doc: docs, value: int):\n  require viewer = 'service:owner' else OWNER\n  update docs[doc] {{ value }}\n  return null\n");std::fs::write(project.schema_dir().join("schema.q"),&current).unwrap();
  let sources=project.sources().unwrap();let bound=snapback4_lang::compile(&sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
  let options=Options{positionals:Vec::new(),flags:BTreeMap::new(),json:false};
  let deployment=super::super::release_loop(&project,&bound,&sources,Some(&old),Some(&previous),&options).unwrap().unwrap();
  assert!(super::super::enforce_release(Some(&deployment),&options).is_err());
  let deployment:serde_json::Value=serde_json::from_str(&deployment).unwrap();
  let gate=deployment["securityReviews"].as_array().unwrap().iter().find(|d|d["code"]=="N_RELEASE_CREATE_AUTHORITY"&&d["gated"]==true).expect("actual excluded-caller create witness");
  let report=super::super::report(&project,&bound,&sources,&options);
  let evidence=super::super::witnesses::collect(&project,&bound,&sources,&report.notes,true,&options);
  let ds=super::super::super::security_reviews::review_evidence(&project,&sources,&report.notes,None,&evidence).unwrap();assert!(ds.iter().any(|d|Some(d.id.as_str())==gate["id"].as_str()&&d.gated));
  let reason=super::super::super::security_reviews::witness::reason_template(&gate["witness"]).replace("<Quarry predicate for intended audience/effect>","true");
  let mut answering=options.clone();answering.flags.insert("reason".into(),reason.clone());
  let evidence=super::super::witnesses::collect(&project,&bound,&sources,&report.notes,true,&answering);
  let ds=super::super::super::security_reviews::review_evidence(&project,&sources,&report.notes,Some((gate["id"].as_str().unwrap(),&reason)),&evidence).unwrap();assert!(ds.iter().any(|d|Some(d.id.as_str())==gate["id"].as_str()&&d.acknowledged));
  let fixed=current.replacen("value: int\n","value: int write <- viewer = 'service:owner'\n",1);let fixed_sources=vec![("schema.q".into(),fixed)];let fixed_bound=snapback4_lang::compile(&fixed_sources);assert!(fixed_bound.diagnostics.is_empty(),"{:?}",fixed_bound.diagnostics);
  assert!(notes(&project,&fixed_bound,&fixed_sources,Some(&previous)).unwrap().is_empty());
 }
}

pub(super) fn prior_policy(sources:&[(String,String)],note:&snapback4_lang::Diagnostic)->Option<security::Invariant>{
 let details:serde_json::Value=serde_json::from_str(note.details.as_deref()?).ok()?;
 let fields=details.get("releaseCreate")?;
 super::witnesses::candidate(sources,&format!("invariant {}.{} write only {}",fields["table"].as_str()?,fields["column"].as_str()?,fields["predecessorPolicy"].as_str()?))
}

#[cfg(test)]mod precision_tests{
 use super::*;
 pub(super) fn source(guard:&str)->Vec<(String,String)>{vec![("schema.q".into(),format!("table docs:\n  value: int\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create(value: int):\n  return insert docs {{ value }}\nmutation edit(doc: docs, value: int):\n  require {guard} else OWNER\n  update docs[doc] {{ value }}\n  return null\n"))]}
 #[test]fn sec12_impossible_boolean_valuations_cannot_supply_a_false_gate(){
  let root=std::env::temp_dir().join(format!("sb4-sec12-equivalent-{}",std::process::id()));std::fs::create_dir_all(root.join("snapback")).unwrap();let project=Project{root};
  let old=source("viewer = 'service:owner'");let current=source("viewer = 'service:owner' and viewer != 'service:other'");
  std::fs::write(project.schema_dir().join("schema.q"),&current[0].1).unwrap();select(&project,&old).unwrap();let bound=snapback4_lang::compile(&current);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
  let notes=notes(&project,&bound,&current,None).unwrap();let options=Options{positionals:Vec::new(),flags:BTreeMap::new(),json:false};
  let evidence=super::super::witnesses::collect(&project,&bound,&current,&notes,true,&options);
  let ds=super::super::super::security_reviews::review_evidence(&project,&current,&notes,None,&evidence).unwrap();assert!(!super::super::super::security_reviews::pending(&ds));
  std::fs::remove_dir_all(project.root).unwrap();
 }
 #[test]fn sec12_successful_release_advances_the_predecessor_for_local_checks(){
  let root=std::env::temp_dir().join(format!("sb4-sec12-advance-{}",std::process::id()));std::fs::create_dir_all(root.join("snapback")).unwrap();let project=Project{root};
  let old=source("viewer = 'service:owner'");let widened=source("viewer = 'service:owner' or viewer = 'service:editor'");
  select(&project,&old).unwrap();super::super::remember_write_release(&project,&widened);
  let narrow=source("viewer = 'service:owner'");let bound=snapback4_lang::compile(&narrow);
  assert_eq!(notes(&project,&bound,&narrow,None).unwrap().len(),1);
  std::fs::remove_dir_all(project.root).unwrap();
 }
}

#[cfg(test)]mod release_absence_tests{
 use super::*;
 #[test]fn sec12_a_fresh_target_cannot_inherit_another_targets_predecessor(){
  let root=std::env::temp_dir().join(format!("sb4-sec12-absent-{}",std::process::id()));std::fs::create_dir_all(root.join("snapback")).unwrap();let project=Project{root};
  let old=super::precision_tests::source("true");let current=super::precision_tests::source("viewer = 'service:owner'");
  select(&project,&old).unwrap();std::fs::write(project.schema_dir().join("schema.q"),&current[0].1).unwrap();let bound=snapback4_lang::compile(&current);
  let options=Options{positionals:Vec::new(),flags:BTreeMap::new(),json:false};
  let summary=super::super::release_loop(&project,&bound,&current,None,None,&options).unwrap().unwrap();let value:serde_json::Value=serde_json::from_str(&summary).unwrap();
  assert!(!value["securityReviews"].as_array().unwrap().iter().any(|d|d["code"]=="N_RELEASE_CREATE_AUTHORITY"));
  std::fs::remove_dir_all(project.root).unwrap();
 }
}
