//! Capture the selected deployed bytes, generated client and contemporary fixtures.
// @ref LLP 3000.000.000.002#10-wave-25-day-two-friction-dx8 — exact-source refresh repairs derived artifacts without changing source or fixture evidence.
use super::{Options, Project};
use std::{collections::BTreeMap, path::PathBuf};

pub(super) struct SavedVersion { path: PathBuf, files: Vec<(PathBuf, Vec<u8>)>, complete: bool, refresh: bool }
impl Drop for SavedVersion {
    fn drop(&mut self) { if !self.complete && !self.refresh { let _ = std::fs::remove_dir_all(&self.path); } }
}
impl SavedVersion {
    pub(super) fn prepare(project: &Project, sources: &[(String,String)], bound: &snapback4_lang::Bound, options: &Options, deployment: &std::path::Path) -> Result<Option<Self>,String> {
        let Some(name) = options.flags.get("save-version") else {return Ok(None);};
        if sources.is_empty() || sources.iter().all(|(_,text)|text.trim().is_empty()) {return Err("not saved yet: a saved version needs nonempty Quarry source".into());}
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
        let refresh = match std::fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => return Err(format!("cannot refresh {name}: saved version must be a real directory")),
            Ok(_) => {
                let selected=sources.iter().cloned().collect::<BTreeMap<_,_>>();
                let existing=crate::client_compatibility::sources(&path).map_err(|e|format!("cannot refresh {name}: {e}"))?.into_iter().collect::<BTreeMap<_,_>>();
                if existing != selected {return Err(format!("cannot refresh {name}: selected source differs from the saved source; choose a new versions/vN"));}
                true
            }
            Err(error) if error.kind()==std::io::ErrorKind::NotFound => {std::fs::create_dir(&path).map_err(|e|format!("cannot save {name}: {e}"))?;false}
            Err(error) => return Err(format!("cannot inspect {name}: {error}")),
        };
        let mut files = if refresh {Vec::new()} else {sources.iter().map(|(name,text)|(PathBuf::from(name),text.as_bytes().to_vec())).collect()};
        // Keep the generated module boundary and every sibling artifact.
        // A saved-source selection draws siblings from that saved unit.
        let unit=match options.flags.get("schema").map(PathBuf::from) {
            None=>project.root.join("snapback/generated"),
            Some(source) if source.is_dir()=>source.join("generated"),
            Some(source)=>source.parent().unwrap_or(std::path::Path::new(".")).join("generated"),
        };
        fn collect(root:&std::path::Path,path:&std::path::Path,out:&mut Vec<(PathBuf,Vec<u8>)>)->Result<(),String>{
            for entry in std::fs::read_dir(path).map_err(|e|e.to_string())? {
                let entry=entry.map_err(|e|e.to_string())?;let kind=entry.file_type().map_err(|e|e.to_string())?;
                if kind.is_symlink(){return Err("saved generated artifacts must be regular files/directories, never symlinks".into());}
                if kind.is_dir(){collect(root,&entry.path(),out)?;}else if kind.is_file(){out.push((PathBuf::from("generated").join(entry.path().strip_prefix(root).unwrap()),std::fs::read(entry.path()).map_err(|e|e.to_string())?));}
            }Ok(())
        }
        if std::fs::symlink_metadata(&unit).is_ok_and(|m|m.file_type().is_symlink()){return Err("saved generated unit must be a real directory, never a symlink".into());}
        if unit.is_dir(){collect(&unit,&unit,&mut files)?;}
        let generated=[("generated/api.ts",snapback4_lang::emit::typescript(bound)),("generated/server.ts",snapback4_lang::emit::server_typescript(bound)),("generated/package.json",crate::project::GENERATED_PACKAGE.to_owned()),("generated/security-invariants.q.draft",snapback4_lang::security::draft(bound))];
        for(name,text)in generated {files.retain(|(path,_)|path!=std::path::Path::new(name));files.push((PathBuf::from(name),text.into_bytes()));}
        let mut saved=Self {path,files,complete:false,refresh};
        let fixture = match options.flags.get("schema").map(PathBuf::from) {
            None=>project.root.join("fixtures"),
            Some(source) if source.is_dir()=>source.join("fixtures"),
            Some(source) if source.file_name().is_some_and(|n|n=="schema.q")=>source.parent().unwrap().join("fixtures"),
            Some(source)=>source.with_file_name(format!("{}-fixtures",source.file_stem().unwrap_or_default().to_string_lossy())),
        };
        if fixture.is_dir() && !refresh {
            let mut entries=std::fs::read_dir(&fixture).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
            entries.sort_by_key(|e|e.file_name());
            for entry in entries {
                if entry.path().extension().is_some_and(|e|e=="jsonl") || entry.file_name()=="test.sweep.json" {
                    if !entry.file_type().map_err(|e|e.to_string())?.is_file() {return Err("saved fixtures must be regular files".into());}
                    saved.files.push((PathBuf::from("fixtures").join(entry.file_name()),std::fs::read(entry.path()).map_err(|e|e.to_string())?));
                }
            }
        }
        if !refresh {saved.files.push((PathBuf::from("fixtures/.gitkeep"),Vec::new()));}
        Ok(Some(saved))
    }
    pub(super) fn finish(&mut self, release: u64, source_hash: &str) -> Result<(),String> {
        self.files.push((PathBuf::from("release.json"),format!("{}\n",serde_json::json!({"release":release,"sourceHash":source_hash,"cliVersion":env!("CARGO_PKG_VERSION")})).into_bytes()));
        for (name,bytes) in &self.files {
            let path=self.path.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).map_err(|e|e.to_string())?;
            if self.refresh {
                let temporary=path.with_extension(format!("refresh-{}",std::process::id()));
                std::fs::write(&temporary,bytes).map_err(|e|e.to_string())?;
                std::fs::rename(&temporary,&path).map_err(|e|e.to_string())?;
            } else {
                use std::io::Write;
                let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|e|e.to_string())?;
                file.write_all(bytes).map_err(|e|e.to_string())?;
            }
        }
        self.complete=true;
        eprintln!("{} release {release} sources, generated client, contemporary fixtures and release.json at {}",if self.refresh {"refreshed"} else {"saved"},self.path.display());
        Ok(())
    }
}
