//! Positive campaign evidence only; never a cached security proof.
// @ref LLP 3000.036.004#137-wave-19-correction-admissible-starts-and-persistent-refutations — exact source/fixture/executable binding.
use super::*;
use sha2::{Digest,Sha256};
#[derive(serde::Serialize,serde::Deserialize)]
pub(super) struct Record{pub fingerprint:String,pub complete:bool,pub attempted:usize,pub sequences:usize,pub coverage_gaps:usize,pub violations:Vec<security::challenges::Counterexample>}
fn selected_fixture(project:&Project,options:&Options)->std::path::PathBuf{
    let flag=if options.flags.contains_key("source"){"source"}else{"schema"};
    options.flags.get("fixture").map(std::path::PathBuf::from).unwrap_or_else(||{
        let saved=options.flags.get(flag).map(std::path::Path::new).map(|p|if p.is_dir(){p.join("fixtures")}else if p.file_name().is_some_and(|n|n=="schema.q"){p.parent().unwrap().join("fixtures")}else{p.with_file_name(format!("{}-fixtures",p.file_stem().unwrap_or_default().to_string_lossy()))});
        saved.filter(|p|p.is_dir()).unwrap_or_else(||project.root.join("fixtures"))
    })
}
pub(in crate::verbs) fn capture(sources:&[(String,String)],fixture:Option<&std::path::Path>)->Result<String,String>{
    let mut hash=Sha256::new();hash.update(b"SEC4-test-record-v2/full-default/NOW=1800000000000");
    for (name,text) in sources{hash.update((name.len()as u64).to_le_bytes());hash.update(name);hash.update((text.len()as u64).to_le_bytes());hash.update(text);}
    let binary=std::env::current_exe().and_then(std::fs::read).map_err(|e|e.to_string())?;hash.update(Sha256::digest(binary));
    if let Some(path)=fixture.filter(|p|p.is_dir()){
        let mut files=std::fs::read_dir(path).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;files.sort_by_key(|e|e.file_name());
        for f in files{
            // Follow the same regular-file symlinks as the fixture loader.
            if !std::fs::metadata(f.path()).map_err(|e|e.to_string())?.is_file(){continue;}
            let name=f.file_name().to_string_lossy().into_owned();let bytes=std::fs::read(f.path()).map_err(|e|e.to_string())?;
            hash.update((name.len()as u64).to_le_bytes());hash.update(name);hash.update((bytes.len()as u64).to_le_bytes());hash.update(bytes);
        }
    }Ok(format!("{:x}",hash.finalize()))
}
fn fingerprint(project:&Project,options:&Options)->Result<String,String>{
    let flag=if options.flags.contains_key("source"){"source"}else{"schema"};
    capture(&super::super::proof_source::sources(project,options,flag)?,Some(&selected_fixture(project,options)))
}
fn path(project:&Project)->std::path::PathBuf{project.root.join("snapback/generated/security-test.json")}
pub(in crate::verbs) fn remember(project:&Project,options:&Options,campaign:&security::challenges::Campaign,complete:bool,consumed:&str)->Result<(),String>{
    if fingerprint(project,options)?!=consumed{return Err("source or fixtures changed during test; evidence was not saved; rerun snapback4 test".into());}
    let mut record=Record{fingerprint:consumed.into(),complete,attempted:campaign.attempted,sequences:campaign.sequences,coverage_gaps:campaign.unsupported.len(),violations:campaign.violations.iter().filter(|c|c.reachability.is_reachable()).cloned().collect()};
    let prior=matching_key(project,consumed).map(|r|r.violations).unwrap_or_default();
    let mut seen=std::collections::BTreeSet::new();
    record.violations=prior.into_iter().chain(record.violations).filter(|v|v.reachability.is_reachable()&&seen.insert(serde_json::to_string(&(&v.invariant_site,&v.viewer,&v.operation,&v.effect,&v.reachability)).unwrap())).collect();
    let path=path(project);std::fs::create_dir_all(path.parent().unwrap()).map_err(|e|e.to_string())?;
    let temp=path.with_extension(format!("{}.tmp",std::process::id()));
    let result=std::fs::write(&temp,serde_json::to_vec(&record).map_err(|e|e.to_string())?).and_then(|_|std::fs::rename(&temp,&path));
    if result.is_err(){let _=std::fs::remove_file(temp);}result.map_err(|e|e.to_string())
}
pub(super) fn matching(project:&Project,options:&Options,sources:&[(String,String)])->Option<Record>{
    matching_key(project,&capture(sources,Some(&selected_fixture(project,options))).ok()?)
}
fn matching_key(project:&Project,key:&str)->Option<Record>{
    let path=path(project);
    let record:Record=serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    (record.fingerprint==key).then_some(record)
}

#[cfg(test)]
mod tests{
 use super::*;
 #[test]
 fn a_witness_free_later_run_keeps_failures_and_does_not_promote_synthetic_evidence(){
  let path=std::env::temp_dir().join(format!("sb4-security-record-{}",std::process::id()));
  struct Scratch(std::path::PathBuf);impl Drop for Scratch{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
  let _scratch=Scratch(path.clone());std::fs::create_dir_all(path.join("snapback")).unwrap();
  let source="table docs:\n  owner: principal\n  read <- allow\n  online only\ninvariant docs.read only .owner = viewer\n";
  std::fs::write(path.join("snapback/schema.q"),source).unwrap();let project=Project{root:path};let options=Options{positionals:Vec::new(),flags:Default::default(),json:false};
  let bound=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
  let mut engine=snapback4_core::Engine::memory(bound.schema.clone(),bound.programs.iter().map(|p|p.program.clone())).unwrap();
  engine.seed_at([("docs".into(),snapback4_core::Value::Row([("id".into(),snapback4_core::Value::Id("doc".into())),("owner".into(),snapback4_core::Value::Id("dev:owner".into()))].into_iter().collect()))],security::challenges::NOW).unwrap();
  let mut c=security::challenges::Campaign::default();security::challenges::fixture_observers(&bound,&engine,&mut c);assert!(!c.violations.is_empty());
  let mut synthetic=c.violations[0].clone();synthetic.reachability=security::challenges::Reachability::SyntheticOperation;synthetic.operation="synthetic-must-not-persist".into();c.violations.push(synthetic);
  let consumed=fingerprint(&project,&options).unwrap();
  remember(&project,&options,&c,true,&consumed).unwrap();let prior=matching(&project,&options,&[("schema.q".into(),source.into())]).unwrap();assert!(prior.violations.iter().all(|v|v.reachability.is_reachable()));
  remember(&project,&options,&Default::default(),false,&consumed).unwrap();let next=matching(&project,&options,&[("schema.q".into(),source.into())]).unwrap();assert!(!next.complete);assert_eq!(next.violations.len(),prior.violations.len());
  let other=vec![("schema.q".into(),source.replace("only .owner = viewer","only allow"))];let selected=snapback4_lang::compile(&other);
  assert!(!super::super::report(&project,&selected,&other,&options).refuted(),"evidence for current disk source must not refute an independently compiled selection");
  remember(&project,&options,&c,true,&consumed).unwrap();
  assert!(super::super::release_notice(&project,&selected,&other,&options).contains("run `snapback4 test"));
  assert!(super::super::release_notice(&project,&bound,&[("schema.q".into(),source.into())],&options).contains("matching test campaign recorded"));
 }
}
