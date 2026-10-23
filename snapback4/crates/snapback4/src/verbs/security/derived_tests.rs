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
    assert!(release_loop(&project,&bound,&sources,None,&options).unwrap_err().contains("E_SECURITY_REVIEW"));
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
    assert!(release_loop(&project,&changed_bound,&changed,None,&options).is_err(),"a changed rule needs a new decision");
}
