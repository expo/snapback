//! Production refusals and individual dispositions share the same derived rule.
// @ref LLP 3000.036.004.000#5-derived-campaigns-and-production-deployment — authored refutations cannot be disposed of.
use super::*;
struct Scratch(std::path::PathBuf);impl Drop for Scratch{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
#[test]fn production_derived_fix_has_a_working_rule_bound_decision_path(){
    let dir=std::env::temp_dir().join(format!("sb4-sec9-deploy-{}",std::process::id()));let _scratch=Scratch(dir.clone());
    std::fs::create_dir_all(dir.join("snapback")).unwrap();let project=Project{root:dir};
    let source="table docs:\n  value: int\n  approved: bool default false\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create(value: int):\n  return insert docs {value}\nmutation approve(doc: docs):\n  require viewer = 'service:reviewer' else NOT_REVIEWER\n  d = docs[doc] ! else MISSING\n  require d.value >= 0 else NEGATIVE\n  update docs[doc] {approved:true}\nmutation edit(doc: docs,value: int):\n  update docs[doc] {value}\n";
    std::fs::write(project.schema_dir().join("schema.q"),source).unwrap();let sources=project.sources().unwrap();
    let bound=snapback4_lang::compile(&sources);assert!(bound.diagnostics.is_empty());let options=Options{positionals:Vec::new(),flags:BTreeMap::new(),json:false};
    let initial=release_loop(&project,&bound,&sources,None,&options).unwrap().unwrap();
    assert!(enforce_release(Some(&initial),&options).unwrap_err().contains("E_SECURITY_REVIEW"));
    let initial:serde_json::Value=serde_json::from_str(&initial).unwrap();
    let report=report(&project,&bound,&sources,&options);
    let evidence=report.notes.iter().map(|note|initial["securityReviews"].as_array().unwrap().iter().find(|d|d["site"]==note.site.to_string()&&d["code"]==note.code).and_then(|d|d.get("witness").filter(|w|!w.is_null()).cloned())).collect::<Vec<_>>();
    let decisions=super::super::security_reviews::review_evidence(&project,&sources,&report.notes,None,&evidence).unwrap();
    let mut reviewed=0;
    for decision in decisions.iter().filter(|d|d.code=="N_DERIVED_WRITE_AUTHORITY"&&d.witness.is_some()){
        let witness=decision.witness.as_ref().unwrap();let kind=if matches!(witness["effect"].as_str(),Some("insert"|"upsert")){"audience: creators deliberately have broader authority"}else{"intended effect: the observed edit is deliberate"};
        let reason=format!("witness {}; permit {} as {}; {}; operation {} is explicitly intended",witness["id"].as_str().unwrap(),witness["operation"].as_str().unwrap(),witness["viewer"].as_str().unwrap(),kind,witness["operation"].as_str().unwrap());
        super::super::security_reviews::review_evidence(&project,&sources,&report.notes,Some((&decision.id,&reason)),&evidence).unwrap();reviewed+=1;
    }
    assert!(reviewed>=1,"the actual production witness has an individual decision");
    let notice=release_loop(&project,&bound,&sources,None,&options).unwrap().unwrap();
    assert!(!notice.contains("  FIX "),"acknowledged candidates must not remain outstanding FIX: {notice}");
    let changed_source=source.replace("update docs[doc] {value}","update docs[doc] {value: value + 1}");
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
    let mut label_only=bound.clone();label_only.invariants=security::derived::invariants(&sources,&bound).into_iter().filter(security::derived::advisory).collect();
    let mut label_campaign=security::challenges::Campaign::work_bounded(8192);security::challenges::generated_campaign(&label_only,&mut label_campaign,false);
    let label_failures=label_campaign.violations;
    assert!(!label_failures.is_empty());
    let consumed=capture(&sources,None).unwrap();
    remember(&project,&options,&security::challenges::Campaign{violations:label_failures,..Default::default()},true,&consumed).unwrap();
    let cached=release_loop(&project,&bound,&sources,None,&options).unwrap().unwrap();let value:serde_json::Value=serde_json::from_str(&cached).unwrap();
    assert!(value["report"]["invariants"].as_array().unwrap().iter().any(|v|v["status"]=="refuted"&&v["invariant"]["column"]=="customerConsent"&&v["counterexample"]["operation"]=="signFailing"),"reviewed cached failure must not hide independent approval: {cached}");
    assert!(!value["report"]["invariants"].as_array().unwrap().iter().any(|v|v["invariant"]["site"]["file"].as_str().is_some_and(|s|s.contains("/label-consistency/"))));assert!(enforce_release(Some(&cached),&options).is_err());
}

#[test]fn fresh_deploy_replays_nested_sibling_approval_without_authored_intent(){
    let dir=std::env::temp_dir().join(format!("sb4-sec10-nested-sibling-{}",std::process::id()));let _scratch=Scratch(dir.clone());
    std::fs::create_dir_all(dir.join("snapback")).unwrap();let project=Project{root:dir};
    let source=include_str!("../../../../snapback4-lang/tests/security/wave26/018.q").lines().filter(|line|!line.trim_start().starts_with("invariant ")).collect::<Vec<_>>().join("\n")+"\n";
    std::fs::write(project.schema_dir().join("schema.q"),source).unwrap();let sources=project.sources().unwrap();let bound=snapback4_lang::compile(&sources);assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let options=Options{positionals:Vec::new(),flags:BTreeMap::new(),json:false};
    let summary=release_loop(&project,&bound,&sources,None,&options).unwrap().unwrap();let value:serde_json::Value=serde_json::from_str(&summary).unwrap();
    let witness=value["report"]["invariants"].as_array().unwrap().iter().find(|v|v["status"]=="refuted"&&v["invariant"]["site"]["file"].as_str().is_some_and(|s|s.contains("/sibling-approval/"))&&v["counterexample"]["operation"]=="addRescan"&&matches!(v["counterexample"]["reachability"].as_str(),Some("authored-fixture-trace"|"generated-fixture-trace"))).expect("fresh deploy must retain a reachable nested sibling witness");
    let history=witness["counterexample"]["history"].as_array().unwrap();
    for operation in ["addScan","setRestriction","addRescan"]{assert!(history.iter().any(|step|step["operation"]==operation),"actual approval-bypassing history must include {operation}: {witness}");}
    assert!(value["fixes"].as_u64().unwrap()>0,"a reachable violation must count as a FIX");
    assert!(enforce_release(Some(&summary),&options).unwrap_err().contains("production deploy refuses reachable FIX"));
}
