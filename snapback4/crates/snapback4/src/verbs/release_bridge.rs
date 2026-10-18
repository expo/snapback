//! A bridge starts from the current immutable source, retaining every gate.
// @ref LLP 3000.000.000#15-wave-15-preview-and-rollback-day5 — operator-owned source adaptation, no invented data migration.
use super::Project;
use std::path::Path;
pub(super) fn checklist(current: u64, target: u64, hazards: &[String]) -> Vec<String> {
    let mut lines=vec![format!("Before selecting release {target} from release {current}, assert the guarded refusal and query visibility for each affected workflow below against real accounts.")];
    lines.extend(hazards.iter().map(|line|format!("Verify: {line}")));
    lines.push("Keep current value domains, audiences, guards and quotas in a bridge; repair records through authorized mutations; prove the blocked case still refuses, then rerun the target preview. Pause any workflow whose invariant the target cannot retain.".into());
    lines
}
pub(super) fn write(path: &Path, deployment: &Path, current: u64, target: u64, checklist: &[String]) -> Result<(),String> {
    let project=Project {root: deployment.join("releases").join(current.to_string())};
    let sources=project.sources().map_err(|e|e.to_string())?;
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
        let body=format!("# Rollback bridge: release {current} → {target}\n\nThese are release {current}'s complete source files. They preserve current behavior. Edit this copy toward the target while retaining the required guards; no migration is generated.\n\n{}\n\nAfter editing, run deploy with --schema pointing at this directory and --check, then prove this checklist before activation.\n",checklist.iter().map(|line|format!("- [ ] {line}")).collect::<Vec<_>>().join("\n"));
        std::fs::write(path.join("ROLLBACK-CHECKLIST.md"),body).map_err(|e|e.to_string())
    })();
    if result.is_err() {let _=std::fs::remove_dir_all(path);}
    result
}
