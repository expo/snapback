//! Project-local live dev listeners. Records contain no credentials.
// @ref LLP 3000.000.000.000.000#3-proof-fixture-loading — registration is per live instance; HTTP identity is authoritative.
use serde::{Deserialize, Serialize};
use std::os::unix::fs::MetadataExt;
use std::{
    fs::{self, File, TryLockError},
    io::{Read, Write},
    net::SocketAddr,
    path::{Path, PathBuf},
};

const LIMIT: usize = 128;
const BYTES: u64 = 8192;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Identity {
    pub instance: String,
    pub initial_store_id: String,
    pub project: PathBuf,
    pub address: SocketAddr,
    pub temporary: bool,
    pub pid: u32,
}
pub(crate) struct Registration {
    pub identity: Identity,
    path: PathBuf,
    file: File,
}
impl Drop for Registration {
    fn drop(&mut self) {
        remove_owned(&self.path, &self.file);
    }
}
fn error(path: &Path, message: impl std::fmt::Display) -> String {
    format!(
        "E_INPUT: dev host registry {}: {message}; inspect this directory and remove stale or invalid registrations before retrying",
        path.display()
    )
}
fn same_file(path: &Path, file: &File) -> bool {
    fs::symlink_metadata(path)
        .ok()
        .zip(file.metadata().ok())
        .is_some_and(|(a, b)| a.is_file() && a.dev() == b.dev() && a.ino() == b.ino())
}
fn remove_owned(path: &Path, file: &File) {
    if same_file(path, file) {
        let _ = fs::remove_file(path);
    }
}
/// Read at most 128 entries. An unlocked well-formed immutable record is stale;
/// retain its lock through unlink so a concurrent cleanup cannot acquire it.
fn scan(root: &Path, prune: bool) -> Result<Vec<Identity>, String> {
    let dir = root.join(".snapback4/dev-hosts");
    let metadata = match fs::symlink_metadata(&dir) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(error(&dir, e)),
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(error(&dir, "requires a real directory"));
    }
    let mut live = Vec::new();
    for (i, entry) in fs::read_dir(&dir).map_err(|e| error(&dir, e))?.enumerate() {
        if i == LIMIT {
            return Err(error(
                &dir,
                "more than 128 entries; bounded stale cleanup may have removed earlier unlocked records",
            ));
        }
        let path = entry.map_err(|e| error(&dir, e))?.path();
        let meta = match fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(error(&dir, e)),
        };
        if !meta.is_file()
            || meta.file_type().is_symlink()
            || meta.nlink() != 1
            || meta.len() > BYTES
        {
            continue;
        }
        let mut file = match snapback4_core::private_fs::auxiliary_file(
            &root.join(".snapback4/store.sqlite"),
            &path,
            false,
            BYTES,
        ) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(error(&dir, e)),
        };
        if !same_file(&path, &file) {
            continue;
        }
        let mut bytes = Vec::new();
        (&mut file)
            .take(BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| error(&dir, e))?;
        let Ok(identity) = serde_json::from_slice::<Identity>(&bytes) else {
            continue;
        };
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if identity.instance.is_empty()
            || identity
                .instance
                .bytes()
                .any(|c| !c.is_ascii_alphanumeric())
            || ![
                format!("{}.json", identity.instance),
                format!("{}.pending", identity.instance),
            ]
            .iter()
            .any(|n| n == name)
            || identity.initial_store_id.is_empty()
            || identity.project != root
            || !identity.address.ip().is_loopback()
            || identity.address.port() == 0
        {
            continue;
        }
        match file.try_lock() {
            Ok(()) => {
                if prune {
                    remove_owned(&path, &file);
                }
            }
            Err(TryLockError::WouldBlock) => {
                if name.ends_with(".json") {
                    live.push(identity);
                }
            }
            Err(e) => return Err(error(&dir, e)),
        }
    }
    Ok(live)
}
pub(crate) fn live(root: &Path) -> Result<Vec<Identity>, String> {
    scan(root, false)
}
pub(crate) fn register(
    root: &Path,
    address: SocketAddr,
    store_id: String,
    temporary: bool,
) -> Result<Registration, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let dir = root.join(".snapback4/dev-hosts");
    snapback4_core::private_fs::directory(&dir).map_err(|e| error(&dir, e))?;
    let live = scan(&root, true)?;
    if live.len() >= LIMIT
        || fs::read_dir(&dir)
            .map_err(|e| error(&dir, e))?
            .take(LIMIT)
            .count()
            >= LIMIT
    {
        return Err(error(
            &dir,
            "128 retained registrations; cleanup cannot remove live or invalid entries",
        ));
    }
    let identity = Identity {
        instance: snapback4_core::ids::mint(
            snapback4_core::now_ms(),
            &mut snapback4_core::ids::Mint::default(),
        )
        .map_err(|e| e.to_string())?,
        initial_store_id: store_id,
        project: root,
        address,
        temporary,
        pid: std::process::id(),
    };
    let pending = dir.join(format!("{}.pending", identity.instance));
    let path = dir.join(format!("{}.json", identity.instance));
    let mut file = snapback4_core::private_fs::file(&pending, true).map_err(|e| error(&dir, e))?;
    let publish = (|| -> std::io::Result<()> {
        file.lock()?;
        serde_json::to_writer(&mut file, &identity)?;
        file.flush()?;
        fs::rename(&pending, &path)
    })();
    if let Err(e) = publish {
        remove_owned(&pending, &file);
        return Err(error(&dir, e));
    }
    Ok(Registration {
        identity,
        path,
        file,
    })
}
impl Identity {
    pub fn matches(&self, status: &serde_json::Value) -> bool {
        status["project"] == serde_json::json!(self.project)
            && status["pid"] == self.pid
            && status["instance"] == self.instance
            && status["initialStoreId"] == self.initial_store_id
            && status["temporary"] == self.temporary
            && status["storeId"].as_str().is_some_and(|id| !id.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_stale_cleanup_reclaims_valid_records_but_never_invalid_files() {
        let root = std::env::temp_dir().join(format!("sb4-dev-registry-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let dir = root.join(".snapback4/dev-hosts");
        fs::create_dir_all(&dir).unwrap();
        for i in 0..129 {
            let identity = Identity {
                instance: format!("instance{i}"),
                initial_store_id: "store".into(),
                project: root.clone(),
                address: "127.0.0.1:1".parse().unwrap(),
                temporary: true,
                pid: 1,
            };
            fs::write(
                dir.join(format!("{}.json", identity.instance)),
                serde_json::to_vec(&identity).unwrap(),
            )
            .unwrap();
        }
        let error = scan(&root, true).unwrap_err();
        assert!(
            error.contains("more than 128 entries") && error.contains(dir.to_str().unwrap()),
            "{error}"
        );
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        scan(&root, true).unwrap();
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        fs::write(dir.join("invalid.json"), "not a record").unwrap();
        let active = register(&root, "127.0.0.1:1".parse().unwrap(), "store".into(), true).unwrap();
        assert_eq!(live(&root).unwrap().len(), 1);
        assert!(dir.join("invalid.json").exists());
        drop(active);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
