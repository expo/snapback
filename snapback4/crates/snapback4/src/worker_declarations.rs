//! The filename is the declaration; helpers belong in subdirectories.
use crate::project::Project;
use std::{collections::BTreeMap, path::{Path, PathBuf}};

// @ref LLP 3000.009#5.3 — one convention shared by development and immutable releases.
pub(super) fn declared(project: &Project) -> Result<BTreeMap<String, PathBuf>, String> {
    let dir = project.schema_dir().join("workers");
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(error) => return Err(format!("workers: {error}")),
    };
    let mut workers = BTreeMap::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() || !matches!(path.extension().and_then(|s| s.to_str()), Some("mjs" | "mts" | "ts")) { continue; }
        let name = path.file_stem().and_then(|s| s.to_str()).ok_or("worker name must be UTF-8")?.to_owned();
        if name.is_empty() || name.len() > 64 || !name.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_')) {
            return Err(format!("worker {name}: use 1–64 ASCII letters, digits, '-' or '_' for the service name"));
        }
        if workers.insert(name.clone(), path).is_some() { return Err(format!("worker {name}: declare only one entry extension")); }
    }
    Ok(workers)
}

/// Package this explicit source subtree. Dependencies are installed by the host.
/// A symlink cannot silently capture files outside the declared source tree.
pub(crate) fn package(project: &Project, stage: &Path) -> Result<(), String> {
    declared(project)?;
    fn copy(from: &Path, to: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(to)?;
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            if kind.is_symlink() { return Err(std::io::Error::other("worker source symlinks are not packaged")); }
            if kind.is_dir() { copy(&entry.path(), &to.join(entry.file_name()))?; }
            else if kind.is_file() { std::fs::copy(entry.path(), to.join(entry.file_name()))?; }
        }
        Ok(())
    }
    let from = project.schema_dir().join("workers");
    if from.exists() { copy(&from, &stage.join("snapback/workers")).map_err(|e| format!("packaging workers: {e}"))?; }
    Ok(())
}
