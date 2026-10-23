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
    let sources=generated.sources;
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
        let body=format!("# Rollback bridge: release {current} → {target}\n\nThese are release {target}'s operations with value domains loosened to represent release {current}'s data. New tables retain current rules; old operations may not expose them. This source is a NEW release, never an edit of immutable release {target}. Review changed nullability in old UI code and confirm the carried current safety guards.\n\nGenerated changes:\n{changes}\n\nCompiler diagnostics (resolve before deploy):\n{diagnostics}\n\n{}\n\nAfter editing, run deploy with --schema pointing at this directory and --restore-dormant --check, then prove this checklist before activation.\n",checklist.iter().map(|line|format!("- [ ] {line}")).collect::<Vec<_>>().join("\n"));
        std::fs::write(path.join("ROLLBACK-CHECKLIST.md"),body).map_err(|e|e.to_string())
    })();
    if result.is_err() {let _=std::fs::remove_dir_all(path);}
    result
}
