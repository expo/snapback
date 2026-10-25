//! Production refusals and individual dispositions share the same derived rule.
// @ref LLP 3000.036.004.000#5-derived-campaigns-and-production-deployment — authored refutations cannot be disposed of.
use super::*;
struct Scratch(std::path::PathBuf);impl Drop for Scratch{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
#[test]fn production_derived_fix_has_a_working_rule_bound_decision_path(){
    let dir=std::env::temp_dir().join(format!("sb4-sec9-deploy-{}",std::process::id()));let _scratch=Scratch(dir.clone());
    std::fs::create_dir_all(dir.join("snapback")).unwrap();let project=Project{root:dir};
    let source="table docs:\n  owner: principal\n  cell: text ?\n  read <- allow\n  insert <- allow\n  update (old, next) <- old.cell = next.cell or viewer = 'service:desk'\n  online only\nmutation create(owner: principal, cell: text ?):\n  return insert docs { owner, cell }\n";
    std::fs::write(project.schema_dir().join("schema.q"),source).unwrap();let sources=project.sources().unwrap();
    let bound=snapback4_lang::compile(&sources);assert!(bound.diagnostics.is_empty());let options=Options{positionals:Vec::new(),flags:BTreeMap::new(),json:false};
    assert!(enforce_release(release_loop(&project,&bound,&sources,None,&options).unwrap().as_ref(),&options).unwrap_err().contains("E_SECURITY_REVIEW"));
    let report=report(&project,&bound,&sources,&options);
    let decisions=super::super::security_reviews::review(&project,&sources,&report.notes,None).unwrap();
    let mut reviewed=0;
    for decision in decisions.iter().filter(|d|matches!(d.code.as_str(),"N_CREATE_EDIT_ASYMMETRY"|"N_DERIVED_WRITE_AUTHORITY")){
        super::super::security_reviews::review(&project,&sources,&report.notes,Some((&decision.id,"The specification deliberately gives creators broader authority"))).unwrap();reviewed+=1;
    }
    assert!(reviewed>=2,"static and replayed decisions must exist");
    let notice=release_loop(&project,&bound,&sources,None,&options).unwrap().unwrap();
    assert!(!notice.contains("  FIX "),"acknowledged candidates must not remain outstanding FIX: {notice}");
    let changed_source=source.replace("'service:desk'","'service:other'");
    std::fs::write(project.schema_dir().join("schema.q"),&changed_source).unwrap();let changed=project.sources().unwrap();let changed_bound=snapback4_lang::compile(&changed);
    assert!(enforce_release(release_loop(&project,&changed_bound,&changed,None,&options).unwrap().as_ref(),&options).is_err(),"a changed rule needs a new decision");
}

#[test]fn a_reviewed_label_cannot_hide_an_independent_approval_contract(){
    let dir=std::env::temp_dir().join(format!("sb4-sec10-reviewed-replay-{}",std::process::id()));let _scratch=Scratch(dir.clone());
    std::fs::create_dir_all(dir.join("snapback")).unwrap();let project=Project{root:dir};
    let source=include_str!("../../../../snapback4-lang/tests/security/wave27/033.q");
    std::fs::write(project.schema_dir().join("schema.q"),source).unwrap();let sources=project.sources().unwrap();let bound=snapback4_lang::compile(&sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let notes=security::derived::notes(&sources,&bound);let decisions=super::super::security_reviews::review(&project,&sources,&notes,None).unwrap();
    let label=decisions.iter().find(|d|d.site.contains("/label-consistency/")).unwrap();
    super::super::security_reviews::review(&project,&sources,&notes,Some((&label.id,"Manual summary overrides are intentional"))).unwrap();
    let options=Options{positionals:Vec::new(),flags:BTreeMap::new(),json:false};
    let summary=release_loop(&project,&bound,&sources,None,&options).unwrap().unwrap();
    let value:serde_json::Value=serde_json::from_str(&summary).unwrap();
    assert!(value["report"]["invariants"].as_array().unwrap().iter().any(|v|v["status"]=="refuted"&&v["invariant"]["column"]=="customerConsent"&&v["counterexample"]["operation"]=="signFailing"),"independent approval must retain replay reach: {summary}");
    assert!(enforce_release(Some(&summary),&options).is_err());
    // A matching record containing only the reviewed label must not suppress
    // the independent approval probe. Keep the real reachable trace visible.
    let mut deploy=options.clone();deploy.flags.insert("security-deploy".into(),String::new());
    let original=report(&project,&bound,&sources,&deploy);
    let label_failures=original.invariants.iter().filter(|v|v.invariant.site.file.contains("/label-consistency/")).filter_map(|v|v.counterexample.clone()).collect::<Vec<_>>();
    assert!(!label_failures.is_empty());
    let consumed=capture(&sources,None).unwrap();
    remember(&project,&options,&security::challenges::Campaign{violations:label_failures,..Default::default()},true,&consumed).unwrap();
    let cached=release_loop(&project,&bound,&sources,None,&options).unwrap().unwrap();let value:serde_json::Value=serde_json::from_str(&cached).unwrap();
    assert!(value["report"]["invariants"].as_array().unwrap().iter().any(|v|v["status"]=="refuted"&&v["invariant"]["column"]=="customerConsent"&&v["counterexample"]["operation"]=="signFailing"),"reviewed cached failure must not hide independent approval: {cached}");
    assert!(cached.contains("REVIEWED derived"));assert!(enforce_release(Some(&cached),&options).is_err());
}
