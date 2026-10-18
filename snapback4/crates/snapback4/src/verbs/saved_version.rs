//! Capture the selected deployed bytes and their contemporary fixtures.
// @ref LLP 3000.011.003.000.000#14-wave-15-saved-deployments-and-case-evidence-day5 — snapshots never replace prior application evidence.
use super::{Options, Project};
use std::path::PathBuf;

pub(super) struct SavedVersion { path: PathBuf, files: Vec<(PathBuf, Vec<u8>)>, complete: bool }
impl Drop for SavedVersion {
    fn drop(&mut self) { if !self.complete { let _ = std::fs::remove_dir_all(&self.path); } }
}
impl SavedVersion {
    pub(super) fn prepare(project: &Project, sources: &[(String,String)], options: &Options, deployment: &std::path::Path) -> Result<Option<Self>,String> {
        let Some(name) = options.flags.get("save-version") else {return Ok(None);};
        if options.flags.contains_key("check") {return Err("--save-version captures a successful deployment; omit --check to save, or omit --save-version for a read-only preview".into());}
        if project.root.canonicalize().map_err(|e|e.to_string())?.starts_with(deployment.canonicalize().map_err(|e|e.to_string())?) {
            return Err("cannot save a version inside deployment custody; run deploy from the application's source directory".into());
        }
        let suffix = name.strip_prefix("versions/v").ok_or("--save-version needs a new project-relative versions/vN directory")?;
        if suffix.is_empty() || suffix.starts_with('0') || !suffix.bytes().all(|b|b.is_ascii_digit()) {return Err("--save-version needs versions/vN with a positive numeric N".into());}
        let parent=project.root.join("versions");
        if std::fs::symlink_metadata(&parent).is_ok_and(|m|m.file_type().is_symlink()) {return Err("--save-version refuses a symlinked versions directory".into());}
        std::fs::create_dir_all(&parent).map_err(|e|e.to_string())?;
        let path=project.root.join(name);
        // create_dir is the no-replace reservation: existing evidence is immutable.
        std::fs::create_dir(&path).map_err(|e|format!("cannot save {name}: {e}; choose a new versions/vN; existing snapshots are never overwritten"))?;
        let mut saved=Self {path,files:sources.iter().map(|(name,text)|(PathBuf::from(name),text.as_bytes().to_vec())).collect(),complete:false};
        let fixture = match options.flags.get("schema").map(PathBuf::from) {
            None=>project.root.join("fixtures"),
            Some(source) if source.is_dir()=>source.join("fixtures"),
            Some(source) if source.file_name().is_some_and(|n|n=="schema.q")=>source.parent().unwrap().join("fixtures"),
            Some(source)=>source.with_file_name(format!("{}-fixtures",source.file_stem().unwrap_or_default().to_string_lossy())),
        };
        if fixture.is_dir() {
            let mut entries=std::fs::read_dir(&fixture).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
            entries.sort_by_key(|e|e.file_name());
            for entry in entries {
                if entry.path().extension().is_some_and(|e|e=="jsonl") || entry.file_name()=="test.sweep.json" {
                    if !entry.file_type().map_err(|e|e.to_string())?.is_file() {return Err("saved fixtures must be regular files".into());}
                    saved.files.push((PathBuf::from("fixtures").join(entry.file_name()),std::fs::read(entry.path()).map_err(|e|e.to_string())?));
                }
            }
        }
        saved.files.push((PathBuf::from("fixtures/.gitkeep"),Vec::new()));
        Ok(Some(saved))
    }
    pub(super) fn finish(&mut self, release: u64, source_hash: &str) -> Result<(),String> {
        self.files.push((PathBuf::from("release.json"),format!("{}\n",serde_json::json!({"release":release,"sourceHash":source_hash,"cliVersion":env!("CARGO_PKG_VERSION")})).into_bytes()));
        for (name,bytes) in &self.files {
            let path=self.path.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).map_err(|e|e.to_string())?;
            use std::io::Write;
            let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|e|e.to_string())?;
            file.write_all(bytes).map_err(|e|e.to_string())?;
        }
        self.complete=true;
        eprintln!("saved release {release} sources, contemporary fixtures and release.json at {}",self.path.display());
        Ok(())
    }
}
