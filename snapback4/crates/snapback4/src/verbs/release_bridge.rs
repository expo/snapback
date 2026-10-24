//! Generate the target operations over loosened value domains for review.
// @ref LLP 3000.000.000#15-wave-15-preview-and-rollback-day5 — operator-owned source adaptation, no invented data migration.
use super::Project;
use std::path::Path;
pub(super) fn checklist(current: u64, target: u64, hazards: &[String]) -> Vec<String> {
    let mut lines=vec![format!("Before selecting release {target} from release {current}, prove the changed value domains and carried guards with real accounts.")];
    lines.extend(hazards.iter().filter(|s|!s.contains("RESULT REVIEW")&&!s.contains("BEHAVIOR REVIEW")).filter(|s|s.contains("safety guard")||s.contains("confidentiality")||s.contains("hidden")||s.contains("default")).map(|s|format!("Decision: {s}")));
    lines.sort();lines.dedup();
    lines.push("Review nullable old result fields in the frozen UI; never substitute zero for an amount still to follow. Deploy with --restore-dormant --check, then --restore-dormant to activate.".into());
    lines
}
pub(super) fn write(path: &Path, deployment: &Path, current: u64, target: u64, checklist: &[String]) -> Result<(),String> {
    let current_project=Project {root: deployment.join("releases").join(current.to_string())};
    let target_project=Project {root: deployment.join("releases").join(target.to_string())};
    let generated=snapback4_lang::release_bridge::loosen(&target_project.sources().map_err(|e|e.to_string())?,&current_project.sources().map_err(|e|e.to_string())?);
    let current_sources=current_project.sources().map_err(|e|e.to_string())?;
    let bound=snapback4_lang::compile(&current_sources);
    let mut checklist=checklist.to_vec();
    checklist.extend(bound.refusal_sites.iter().filter(|((kind,_),_)|kind=="$clause")
        .map(|((_,site),clause)|format!("Review current guard at {site}: {clause}; prove its admission/refusal in the bridge with real accounts.")));
    // Extraction ambiguity cannot be represented by a single legacy cell.
    // Start from the complete current workflow so the repair is callable.
    let extraction_repair=!bound.schema.extractions.is_empty();
    let sources=if extraction_repair {current_sources}else{generated.sources};
    let mut repair=String::new();
    for e in &bound.schema.extractions {
        repair.push_str(&format!("\n- Keep {} and its child population visible. For {} via {}, inspect candidates by parent id; choose a truthful old representation for [{}] through an authorized mutation (never first-row selection). Preview exact rollback only after resolving competition; preserve the other children in an authored bridge.\n",e.parent,e.child,e.reference,e.fields.iter().map(|(d,s)|format!("{d} → {s}")).collect::<Vec<_>>().join(", ")));
    }
    let changes=generated.changes.join("\n");
    let diagnostics=generated.diagnostics.iter().map(|d|format!("{}: {} — {}",d.site,d.message,d.rewrite)).collect::<Vec<_>>().join("\n");
    let deployment=deployment.canonicalize().map_err(|e|e.to_string())?;
    let absolute=std::path::absolute(path).map_err(|e|e.to_string())?;
    let parent=absolute.parent().ok_or("bridge needs a parent directory")?.canonicalize().map_err(|e|e.to_string())?;
    let destination=parent.join(absolute.file_name().ok_or("bridge needs a new directory name")?);
    if destination.starts_with(&deployment) {return Err("bridge destination is inside deployment custody; choose a new source directory outside the deployment and its immutable releases".into());}
    // No overwrite: a second attempt cannot replace the builder's edited bridge.
    std::fs::create_dir(path).map_err(|e|format!("bridge {}: {e}; choose a new directory",path.display()))?;
    let result=(|| {
        for (name,text) in sources {
            std::fs::write(path.join(name),text).map_err(|e|e.to_string())?;
        }
        let body=format!("{repair}\n# Rollback bridge: release {current} → {target}\n\nThis is a NEW bridge candidate for target release {target}, preserving release {current}'s data and guards; it never edits immutable release {target}. The generated changes below identify retained current workflows and paused legacy writes. New tables retain current rules; old operations may not expose them. Review changed nullability in old UI code and confirm the carried current safety guards.\n\nGenerated changes:\n{changes}\n\nCompiler diagnostics (resolve before deploy):\n{diagnostics}\n\n{}\n\nAfter editing, run deploy with --schema pointing at this directory and --restore-dormant --check, then prove this checklist before activation.\n",checklist.iter().map(|line|format!("- [ ] {line}")).collect::<Vec<_>>().join("\n"));
        std::fs::write(path.join("ROLLBACK-CHECKLIST.md"),body).map_err(|e|e.to_string())
    })();
    if result.is_err() {let _=std::fs::remove_dir_all(path);}
    result
}
