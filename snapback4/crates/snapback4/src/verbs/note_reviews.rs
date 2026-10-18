//! Explicit, shareable review of compiler notes; errors and dynamic notes stay live.
// @ref LLP 3000.036.002#132-reviewed-notes — source edits invalidate review, and JSON retains every finding.
use crate::project::Project;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use snapback4_lang::Diagnostic;
use std::{collections::BTreeSet, fs, io};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    version: u32,
    sources: String,
    reviewed: BTreeSet<String>,
}
pub(super) struct Review {
    pub new: Vec<Diagnostic>,
    pub acknowledged: Vec<Diagnostic>,
}
pub(super) fn fingerprint(note: &Diagnostic) -> String {
    hash(&serde_json::to_vec(note).expect("serializable diagnostic"))
}
fn hash(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn digest(value: &str) -> bool { value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit()) }

pub(super) fn review(project: &Project, compiled_sources: &[(String, String)], notes: &[Diagnostic], eligible: &BTreeSet<String>, acknowledge: bool) -> Result<Review, String> {
    let path = project.schema_dir().join("check-notes.json");
    // Persist the input actually compiled, never a later editor save paired
    // with old diagnostics. A later edit will also invalidate this digest.
    if project.sources().map_err(|e| e.to_string())? != compiled_sources {
        return Err("Quarry sources changed during check; rerun before reviewing notes".into());
    }
    let mut sources = compiled_sources.to_vec();
    sources.sort_by(|a,b| a.0.cmp(&b.0));
    let sources = hash(&serde_json::to_vec(&sources).expect("serializable sources"));
    let failure = |error: String| format!("cannot read {}: {error}; inspect and remove or repair this file, then rerun check --ack-notes", path.display());
    let previous: Option<File> = match fs::read(&path) {
        Ok(bytes) => {
            let file: File = serde_json::from_slice(&bytes).map_err(|e| failure(e.to_string()))?;
            if file.version != 1 || !digest(&file.sources) || file.reviewed.iter().any(|s| !digest(s)) {
                return Err(failure("unsupported format (expected version 1 and SHA-256 digests)".into()));
            }
            Some(file)
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => None,
        Err(e) => return Err(failure(e.to_string())),
    };
    let current: BTreeSet<_> = notes.iter().map(fingerprint).filter(|f| eligible.contains(f)).collect();
    let reviewed = if acknowledge {
        let file = File { version: 1, sources: sources.clone(), reviewed: current.clone() };
        let temporary = path.with_extension(format!("json.{}.tmp", std::process::id()));
        let bytes = serde_json::to_vec_pretty(&file).map_err(|e| e.to_string())?;
        // Rename publishes a complete file; a failed write preserves the old review.
        fs::write(&temporary, bytes).and_then(|_| fs::rename(&temporary, &path)).map_err(|e| {
            let _ = fs::remove_file(&temporary);
            format!("cannot write {}: {e}", path.display())
        })?;
        current
    } else {
        previous.filter(|file| file.sources == sources).map(|file| file.reviewed).unwrap_or_default()
    };
    let (acknowledged, new) = notes.iter().cloned().partition(|note| {
        let key = fingerprint(note);
        eligible.contains(&key) && reviewed.contains(&key)
    });
    Ok(Review { new, acknowledged })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn an_editor_save_cannot_bind_old_findings_to_new_source_bytes() {
        let root = std::env::temp_dir().join(format!("sb4-review-race-{}", std::process::id()));
        fs::create_dir_all(root.join("snapback")).unwrap();
        fs::write(root.join("snapback/schema.q"), "query a():\n  return true\n").unwrap();
        let project = Project { root: root.clone() };
        let compiled = project.sources().unwrap();
        let note = Diagnostic::new(&Default::default(), "N_NO_CURSOR", "review me", "");
        let eligible = BTreeSet::from([fingerprint(&note)]);
        fs::write(root.join("snapback/schema.q"), "query a():\n  return false\n").unwrap();
        assert!(review(&project, &compiled, &[note], &eligible, true).err().unwrap().contains("sources changed"));
        assert!(!root.join("snapback/check-notes.json").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
