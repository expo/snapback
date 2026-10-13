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
    let mut paths = Vec::new();
    files(root, root, &mut paths)?;
    let mut hash = Sha256::new();
    for path in paths {
        let name = path.strip_prefix(root).unwrap().to_string_lossy();
        if name == ".pending-adoption" {continue;}
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
