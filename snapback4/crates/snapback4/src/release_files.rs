//! Immutable release custody: digest the required tree and flush it before DB selection.
// @ref LLP 3000.000.000#5-hot-activation-and-ownership — source durability precedes the database's release pointer.
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

fn files(root: &Path, path: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    let mut entries = fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .map(|e| e.map(|e| e.path()).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort();
    for path in entries {
        let relative = path.strip_prefix(root).map_err(|e| e.to_string())?;
        if relative
            .components()
            .next()
            .is_some_and(|c| c.as_os_str() == ".snapback4")
        {
            continue;
        }
        let m = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if m.is_dir() {
            files(root, &path, out)?;
        } else if m.is_file() {
            out.push(path);
        } else {
            return Err(format!(
                "immutable release artifact must be a real directory or regular file: {}",
                path.display()
            ));
        }
    }
    Ok(())
}
pub(crate) fn digest(root: &Path) -> Result<String, String> {
    bundle_digest(root, false)
}
pub(crate) fn executable_digest(root: &Path) -> Result<String, String> {
    bundle_digest(root, true)
}
fn bundle_digest(root: &Path, executable: bool) -> Result<String, String> {
    let mut paths = Vec::new();
    files(root, root, &mut paths)?;
    let mut hash = Sha256::new();
    for path in paths {
        let name = path.strip_prefix(root).unwrap().to_string_lossy();
        // @ref LLP 3000.000.000.000.000#4-cli-surface-contracts — metadata does not change executable release identity.
        if name == ".pending-adoption" || name == "provenance.json" {continue;}
        // @ref LLP 3000.000.000#16-release-reactivation-and-rollback-foresight-rel5 — compiler and host-location reports are not executable content.
        // Keep both reports in control-request integrity; only release identity
        // ignores them. Activation recompiles and checks the retained source normally.
        if executable && matches!(name.as_ref(), "device-compatibility.json" | "worker-package.json") {continue;}
        hash.update((name.len() as u64).to_le_bytes());
        hash.update(name.as_bytes());
        #[cfg(unix)]
        use std::os::unix::fs::OpenOptionsExt;
        let mut options = fs::OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        options.custom_flags(libc::O_NOFOLLOW);
        let mut file = options.open(&path).map_err(|e| e.to_string())?;
        hash.update(
            file.metadata()
                .map_err(|e| e.to_string())?
                .len()
                .to_le_bytes(),
        );
        let mut buffer = [0u8; 16384];
        loop {
            let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            hash.update(&buffer[..n]);
        }
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub(crate) fn durable(root: &Path) -> Result<(), String> {
    let mut paths = Vec::new();
    files(root, root, &mut paths)?;
    for path in paths {
        fs::File::open(path)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
    }
    fn dirs(path: &Path) -> Result<(), String> {
        for e in fs::read_dir(path).map_err(|e| e.to_string())? {
            let e = e.map_err(|e| e.to_string())?;
            if e.file_type().map_err(|e| e.to_string())?.is_dir() {
                dirs(&e.path())?;
            }
        }
        fs::File::open(path)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())
    }
    dirs(root)
}

pub(crate) fn link_store(root: &Path) -> Result<(), String> {
    let project = crate::project::Project { root: root.into() };
    snapback4_core::private_fs::directory(&project.data_dir()).map_err(|e| e.to_string())?;
    let path = project.store_path();
    #[cfg(unix)]
    {
        let target = Path::new("../../../store.sqlite");
        match fs::symlink_metadata(&path) {
            Ok(m) if m.file_type().is_symlink() => {
                if fs::read_link(&path).map_err(|e| e.to_string())? != target {
                    fs::remove_file(&path).map_err(|e| e.to_string())?;
                    std::os::unix::fs::symlink(target, &path).map_err(|e| e.to_string())?;
                }
            }
            Ok(_) => {
                return Err(format!(
                    "release store path must be a symbolic link: {}",
                    path.display()
                ));
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                std::os::unix::fs::symlink(target, &path).map_err(|e| e.to_string())?
            }
            Err(e) => return Err(e.to_string()),
        }
        Ok(())
    }
    #[cfg(not(unix))]
    Err("serving shared releases requires Unix symbolic links".into())
}

pub(crate) struct Pointer {
    staged: PathBuf,
    dir: PathBuf,
    release: u64,
    previous: Option<u64>,
    rollback: bool,
    ledger: fs::File,
}
impl Pointer {
    pub(crate) fn prepare(
        dir: &Path,
        release: u64,
        previous: Option<u64>,
        rollback: bool,
    ) -> Result<Self, String> {
        let pointer = dir.join("current");
        if pointer.exists() && !pointer.is_file() {
            return Err("current must be a regular release pointer file".into());
        }
        let staged = dir.join(format!(".current-{}-{release}", std::process::id()));
        let file = snapback4_core::private_fs::file(&staged, true).map_err(|e| e.to_string())?;
        let mut prepared = Self {
            staged,
            dir: dir.into(),
            release,
            previous,
            rollback,
            ledger: file,
        };
        writeln!(prepared.ledger, "{release}")
            .and_then(|_| prepared.ledger.sync_all())
            .map_err(|e| e.to_string())?;
        prepared.ledger = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("releases.jsonl"))
            .map_err(|e| e.to_string())?;
        writeln!(prepared.ledger,"{}",serde_json::json!({"at":snapback4_core::now_ms(),"release":release,"previous":previous,"rollback":rollback,"state":"prepared"})).and_then(|_|prepared.ledger.sync_all()).map_err(|e|e.to_string())?;
        Ok(prepared)
    }
    pub(crate) fn finish(&mut self, generation: u64) -> Result<(), String> {
        fs::rename(&self.staged,self.dir.join("current")).and_then(|_|fs::File::open(&self.dir)?.sync_all()).map_err(|e|format!("release {} committed in database, but current copy failed: {e}; inspect `snapback4 releases {}`",self.release,self.dir.display()))?;
        writeln!(self.ledger,"{}",serde_json::json!({"at":snapback4_core::now_ms(),"release":self.release,"previous":self.previous,"rollback":self.rollback,"generation":generation,"state":"activated"})).and_then(|_|self.ledger.sync_all()).map_err(|e|format!("release committed, but ledger completion failed: {e}"))
    }
}
impl Drop for Pointer {
    fn drop(&mut self) {
        if self.staged.exists() {
            let _ = fs::remove_file(&self.staged);
        }
    }
}

// @ref LLP 3000.000.000#16-release-reactivation-and-rollback-foresight-rel5 — deletion requires a definitive non-commit, never a lost reply.
pub(crate) struct Candidate { dir: PathBuf, release: u64, pub committed: bool, pub pending: bool }
impl Candidate {
    pub(crate) fn new(dir: &Path, release: u64) -> Self { Self {dir:dir.into(),release,committed:false,pending:false} }
}
impl Drop for Candidate {
    fn drop(&mut self) {
        if self.committed { return; }
        if self.pending {eprintln!("release {} result remains unknown; retained source while the server may still commit; inspect releases",self.release);return;}
        let probe=(|| -> Result<bool,String> {
            let store=snapback4_core::Store::open_read_only(&self.dir.join("store.sqlite")).map_err(|e|e.to_string())?;
            let history:bool=store.conn().query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='_release_events')",[],|r|r.get(0)).map_err(|e|e.to_string())?;
            if !history {return Ok(false);}
            store.conn().query_row("SELECT EXISTS(SELECT 1 FROM _release_events WHERE release=?1 OR previous=?1)",[self.release as i64],|r|r.get(0)).map_err(|e|e.to_string())
        })();
        match probe {
            Ok(false)=>if let Err(e)=fs::remove_dir_all(self.dir.join("releases").join(self.release.to_string())) {eprintln!("uncommitted release {} cleanup failed: {e}",self.release);},
            Ok(true)=>{},
            Err(e)=>eprintln!("release {} outcome unknown; retained source for recovery; inspect releases: {e}",self.release),
        }
    }
}

#[cfg(test)]
mod candidate_tests {
    use super::*;
    #[test]
    fn cleanup_removes_only_definitively_uncommitted_candidates() {
        let root=std::env::temp_dir().join(format!("sb4-candidate-custody-{}-{}",std::process::id(),snapback4_core::now_ms()));
        fs::create_dir_all(root.join("releases")).unwrap();
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
        let _cleanup=Cleanup(root.clone());
        let store=snapback4_core::Store::open(&root.join("store.sqlite")).unwrap();
        store.conn().execute_batch("CREATE TABLE _release_events(release INTEGER,previous INTEGER)").unwrap();
        for n in 1..=3 {fs::create_dir(root.join("releases").join(n.to_string())).unwrap();}
        drop(Candidate::new(&root,1));
        assert!(!root.join("releases/1").exists());
        // A server may commit after this history read. No observed row is not a completed refusal.
        let mut flight=Candidate::new(&root,2);flight.pending=true;drop(flight);
        assert!(root.join("releases/2").is_dir());
        store.conn().execute("INSERT INTO _release_events VALUES(3,NULL)",[]).unwrap();
        drop(Candidate::new(&root,3));
        assert!(root.join("releases/3").is_dir());
    }
}

#[cfg(test)]
mod identity_tests {
    use super::*;
    #[test]
    fn compiler_reports_do_not_change_release_identity_but_remain_integrity_bound() {
        struct Scratch(PathBuf);
        impl Drop for Scratch { fn drop(&mut self) {let _=fs::remove_dir_all(&self.0);} }
        let id=snapback4_core::ids::mint(snapback4_core::now_ms(),&mut snapback4_core::ids::Mint::default()).unwrap();
        let root=Scratch(std::env::temp_dir().join(format!("sb4-release-identity-{id}")));
        let a=root.0.join("old");let b=root.0.join("new");
        for dir in [&a,&b] {
            fs::create_dir_all(dir.join("snapback")).unwrap();
            fs::write(dir.join("snapback/schema.q"),"query q():\n  return 1\n").unwrap();
        }
        fs::write(a.join("device-compatibility.json"),r#"{"server_version":"0.4.33"}"#).unwrap();
        fs::write(b.join("device-compatibility.json"),r#"{"server_version":"0.4.34"}"#).unwrap();
        fs::write(a.join("worker-package.json"),r#"{"directory":"/old/app"}"#).unwrap();
        assert_eq!(executable_digest(&a).unwrap(),executable_digest(&b).unwrap());
        assert_ne!(digest(&a).unwrap(),digest(&b).unwrap(),"control integrity still covers the captured report");
        for file in ["snapback/schema.q","snapback/generated/native.wasm","worker.mjs"] {
            let path=b.join(file);fs::create_dir_all(path.parent().unwrap()).unwrap();fs::write(&path,b"changed executable").unwrap();
            assert_ne!(executable_digest(&a).unwrap(),executable_digest(&b).unwrap(),"{file}");
            if file=="snapback/schema.q" {fs::write(path,"query q():\n  return 1\n").unwrap();}else{fs::remove_file(path).unwrap();}
        }
    }
}
