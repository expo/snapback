//! Streaming blob custody for local Snapback 2 assets.

use crate::protocol::Refusal;
use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

#[cfg(test)]
use std::cell::RefCell;

#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const BLOB_TEMP_STALE_AFTER: Duration = Duration::from_secs(5 * 60);

#[cfg(test)]
thread_local! {
    static ENUMERATE_BEFORE_INSPECTION: RefCell<Option<Box<dyn FnMut(&fs::DirEntry) -> bool>>> =
        RefCell::new(None);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ByteRange {
    pub start: u64,
    pub end: u64,
}

pub struct BlobRead {
    pub stream: Box<dyn Read + Send>,
    pub length: u64,
    pub total: u64,
    pub range: Option<ByteRange>,
}

/// The hosted implementation can replace this without admitting a whole-object buffer.
pub trait BlobStore: Send + Sync {
    fn put(&self, key: &str, source: &mut dyn Read) -> Result<u64, Refusal>;
    fn get(&self, key: &str, range: Option<ByteRange>) -> Result<BlobRead, Refusal>;
    fn delete(&self, key: &str) -> Result<(), Refusal>;
    fn enumerate(
        &self,
        prefix: &str,
        visitor: &mut dyn FnMut(&str) -> Result<(), Refusal>,
    ) -> Result<(), Refusal>;
}

#[derive(Clone, Debug)]
pub struct FileBlobStore {
    blobs: PathBuf,
    active_puts: Arc<Mutex<BTreeSet<String>>>,
}

#[derive(Clone, Debug)]
pub struct LocalStaging {
    staging: PathBuf,
}

impl FileBlobStore {
    /// Open the local byte store inside the already owner-only `.snapback` directory.
    ///
    /// @ref LLP 1006#9a-where-bytes-live-author-ruling-2026-09-03 — keys are
    /// ordinary asset ids, so any future path that opens a fork snapshot *writably*
    /// must rotate that store's `id_namespace` before it can allocate or publish bytes.
    /// Today's fork path creates read-only snapshots and never opens them as owners.
    pub fn open(project: &Path) -> Result<Self, Refusal> {
        let owner = project.join(".snapback");
        let blobs = secure_child_directory(&owner, "blobs")?;
        sweep_named_temporaries(&blobs, is_blob_temporary)?;
        Ok(Self {
            blobs,
            active_puts: Arc::new(Mutex::new(BTreeSet::new())),
        })
    }

    pub fn path_for_key(&self, key: &str) -> Result<PathBuf, Refusal> {
        validate_key(key)?;
        Ok(self.blobs.join(key))
    }
}

impl LocalStaging {
    pub fn open(project: &Path) -> Result<Self, Refusal> {
        let owner = project.join(".snapback");
        let staging = secure_child_directory(&owner, "staging")?;
        sweep_named_temporaries(&staging, is_staging_temporary)?;
        Ok(Self { staging })
    }

    pub fn create(&self) -> Result<StagingFile, Refusal> {
        self.create_named("upload")
    }

    pub fn create_named(&self, label: &str) -> Result<StagingFile, Refusal> {
        for _ in 0..100 {
            let mut random = [0_u8; 16];
            getrandom::fill(&mut random).map_err(|error| {
                asset_io(
                    format!("cannot allocate a staging name: {error}"),
                    "retry the upload after restoring operating-system randomness",
                )
            })?;
            let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let name = format!("{label}-{}-{sequence}.stage", hex(&random));
            let path = self.staging.join(name);
            let mut options = OpenOptions::new();
            options.write(true).read(true).create_new(true);
            #[cfg(unix)]
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
            match options.open(&path) {
                Ok(file) => {
                    return Ok(StagingFile {
                        path,
                        file: Some(file),
                    });
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(asset_io(
                        format!("cannot create staging file: {error}"),
                        "make .snapback/staging writable by its owner",
                    ));
                }
            }
        }
        Err(asset_io(
            "cannot allocate a unique staging file",
            "remove stale files from .snapback/staging and retry",
        ))
    }

    pub fn allocate_path(&self, label: &str) -> Result<PathBuf, Refusal> {
        let mut random = [0_u8; 16];
        getrandom::fill(&mut random).map_err(|error| {
            asset_io(
                format!("cannot allocate a staging path: {error}"),
                "retry after restoring operating-system randomness",
            )
        })?;
        Ok(self.staging.join(format!(
            "{label}-{}-{}.stage",
            hex(&random),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        )))
    }

    pub fn clear(&self) -> Result<(), Refusal> {
        for entry in fs::read_dir(&self.staging).map_err(|error| {
            asset_io(
                format!("cannot read .snapback/staging: {error}"),
                "make .snapback/staging readable by its owner",
            )
        })? {
            let entry = entry.map_err(|error| {
                asset_io(
                    format!("cannot inspect a staging entry: {error}"),
                    "repair .snapback/staging and retry reset",
                )
            })?;
            let metadata = fs::symlink_metadata(entry.path()).map_err(|error| {
                asset_io(
                    format!("cannot inspect {}: {error}", entry.path().display()),
                    "repair .snapback/staging and retry reset",
                )
            })?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(asset_io(
                    format!("refusing non-file staging entry {}", entry.path().display()),
                    "remove the unsafe entry from .snapback/staging and retry reset",
                ));
            }
            fs::remove_file(entry.path()).map_err(|error| {
                asset_io(
                    format!("cannot clear {}: {error}", entry.path().display()),
                    "make .snapback/staging writable by its owner",
                )
            })?;
        }
        Ok(())
    }
}

impl BlobStore for FileBlobStore {
    // @ref LLP 1006#9a-where-bytes-live-author-ruling-2026-09-03 — publish is
    // streams to a temporary then no-clobber-links it; neither the trait nor this implementation
    // can express v1's whole-object `Vec` custody.
    fn put(&self, key: &str, source: &mut dyn Read) -> Result<u64, Refusal> {
        let destination = self.path_for_key(key)?;
        let temporary_name = format!(
            ".{key}.put-{}-{}.tmp",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let temporary = self.blobs.join(&temporary_name);
        self.active_puts
            .lock()
            .expect("active blob put lock")
            .insert(temporary_name.clone());
        let _active = ActivePut {
            name: temporary_name,
            active: self.active_puts.clone(),
        };
        let result: io::Result<u64> = (|| {
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
            let mut output = options.open(&temporary)?;
            let bytes = io::copy(source, &mut output)?;
            output.flush()?;
            output.sync_all()?;
            // Linking is the local no-clobber publish primitive. `rename`
            // would silently replace an existing immutable id on Unix.
            fs::hard_link(&temporary, &destination)?;
            fs::remove_file(&temporary)?;
            File::open(&self.blobs)?.sync_all()?;
            Ok(bytes)
        })();
        match result {
            Ok(bytes) => Ok(bytes),
            Err(error) => {
                let _ = fs::remove_file(&temporary);
                Err(asset_io(
                    format!("cannot publish asset blob {key}: {error}"),
                    "make .snapback/blobs writable and retry the upload",
                ))
            }
        }
    }

    fn get(&self, key: &str, range: Option<ByteRange>) -> Result<BlobRead, Refusal> {
        let path = self.path_for_key(key)?;
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        options.custom_flags(libc::O_NOFOLLOW);
        let mut file = options
            .open(&path)
            .map_err(|error| unavailable(key, error))?;
        let metadata = file.metadata().map_err(|error| unavailable(key, error))?;
        if !metadata.is_file() {
            return Err(unavailable(
                key,
                io::Error::other("blob key is not a regular file"),
            ));
        }
        let total = metadata.len();
        let (start, length) = match range {
            Some(range) => {
                if range.start > range.end || range.end >= total {
                    return Err(asset_io(
                        format!("asset blob {key} range is outside its bytes"),
                        "retry without an invalid byte range",
                    ));
                }
                file.seek(SeekFrom::Start(range.start))
                    .map_err(|error| unavailable(key, error))?;
                (range.start, range.end - range.start + 1)
            }
            None => (0, total),
        };
        let _ = start;
        Ok(BlobRead {
            stream: Box::new(file.take(length)),
            length,
            total,
            range,
        })
    }

    fn delete(&self, key: &str) -> Result<(), Refusal> {
        let path = self.path_for_key(key)?;
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(asset_io(
                format!("cannot delete asset blob {key}: {error}"),
                "make .snapback/blobs writable and retry reclamation",
            )),
        }
    }

    fn enumerate(
        &self,
        prefix: &str,
        visitor: &mut dyn FnMut(&str) -> Result<(), Refusal>,
    ) -> Result<(), Refusal> {
        for entry in fs::read_dir(&self.blobs).map_err(|error| {
            asset_io(
                format!("cannot enumerate asset blobs: {error}"),
                "make .snapback/blobs readable by its owner",
            )
        })? {
            let entry = entry.map_err(|error| {
                asset_io(
                    format!("cannot inspect an asset blob: {error}"),
                    "repair .snapback/blobs and retry reclamation",
                )
            })?;
            #[cfg(test)]
            ENUMERATE_BEFORE_INSPECTION.with(|hook| {
                let mut hook = hook.borrow_mut();
                if hook.as_mut().is_some_and(|hook| hook(&entry)) {
                    hook.take();
                }
            });
            let path = entry.path();
            let name = entry.file_name().into_string().map_err(|_| {
                asset_io(
                    format!("blob name is not UTF-8 at {}", path.display()),
                    "remove the invalid entry from .snapback/blobs and retry",
                )
            })?;
            let temporary = is_blob_temporary(&name);
            if temporary {
                let active = self
                    .active_puts
                    .lock()
                    .expect("active blob put lock")
                    .contains(&name);
                if active {
                    continue;
                }
            }
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => {
                    return Err(asset_io(
                        format!("cannot inspect {}: {error}", path.display()),
                        "repair .snapback/blobs and retry reclamation",
                    ));
                }
            };
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(asset_io(
                    format!("refusing non-file blob entry {}", path.display()),
                    "remove the unsafe entry from .snapback/blobs and retry",
                ));
            }
            if temporary {
                let modified = metadata.modified().map_err(|error| {
                    asset_io(
                        format!("cannot read temporary mtime at {}: {error}", path.display()),
                        "repair .snapback/blobs and retry reclamation",
                    )
                })?;
                let age = SystemTime::now()
                    .duration_since(modified)
                    .unwrap_or_default();
                if age >= BLOB_TEMP_STALE_AFTER {
                    match fs::remove_file(&path) {
                        Ok(()) => {}
                        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                        Err(error) => {
                            return Err(asset_io(
                                format!(
                                    "cannot remove stale blob temporary {}: {error}",
                                    path.display()
                                ),
                                "make .snapback/blobs writable and retry reclamation",
                            ));
                        }
                    }
                }
                continue;
            }
            validate_key(&name)?;
            if name.starts_with(prefix) {
                visitor(&name)?;
            }
        }
        Ok(())
    }
}

struct ActivePut {
    name: String,
    active: Arc<Mutex<BTreeSet<String>>>,
}

impl Drop for ActivePut {
    fn drop(&mut self) {
        self.active
            .lock()
            .expect("active blob put lock")
            .remove(&self.name);
    }
}

pub struct StagingFile {
    path: PathBuf,
    file: Option<File>,
}

impl StagingFile {
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn file_mut(&mut self) -> &mut File {
        self.file.as_mut().expect("staging file is open")
    }

    pub fn flush(&mut self) -> Result<(), Refusal> {
        self.file_mut().flush().map_err(|error| {
            asset_io(
                format!("cannot flush upload staging bytes: {error}"),
                "make .snapback/staging writable and retry the upload",
            )
        })
    }

    pub fn sync_and_close(&mut self) -> Result<(), Refusal> {
        let Some(mut file) = self.file.take() else {
            return Ok(());
        };
        file.flush()
            .and_then(|()| file.sync_all())
            .map_err(|error| {
                asset_io(
                    format!("cannot sync upload staging bytes: {error}"),
                    "make .snapback/staging writable and retry the upload",
                )
            })
    }
}

impl Drop for StagingFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn secure_child_directory(owner: &Path, name: &str) -> Result<PathBuf, Refusal> {
    let path = owner.join(name);
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(asset_io(
                format!("{} must be a directory, not a symlink", path.display()),
                format!("replace .snapback/{name} with an owner-only directory"),
            ));
        }
        Ok(metadata) => {
            #[cfg(unix)]
            {
                if metadata.uid() != unsafe { libc::geteuid() } {
                    return Err(asset_io(
                        format!("{} is not owned by the current user", path.display()),
                        format!("replace .snapback/{name} with an owner-only directory"),
                    ));
                }
                if metadata.mode() & 0o777 != 0o700 {
                    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).map_err(
                        |error| {
                            asset_io(
                                format!("cannot secure {}: {error}", path.display()),
                                format!("make .snapback/{name} mode 0700"),
                            )
                        },
                    )?;
                }
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let mut builder = fs::DirBuilder::new();
            #[cfg(unix)]
            builder.mode(0o700);
            builder.create(&path).map_err(|error| {
                asset_io(
                    format!("cannot create {}: {error}", path.display()),
                    format!("make .snapback writable so {name} can be created"),
                )
            })?;
        }
        Err(error) => {
            return Err(asset_io(
                format!("cannot inspect {}: {error}", path.display()),
                format!("make .snapback/{name} accessible to its owner"),
            ));
        }
    }
    Ok(path)
}

fn sweep_named_temporaries(directory: &Path, matches: fn(&str) -> bool) -> Result<(), Refusal> {
    for entry in fs::read_dir(directory).map_err(|error| {
        asset_io(
            format!(
                "cannot inspect {} for stale temporaries: {error}",
                directory.display()
            ),
            "make the owner asset directories readable and retry startup",
        )
    })? {
        let entry = entry.map_err(|error| {
            asset_io(
                format!("cannot inspect a stale asset temporary: {error}"),
                "repair the owner asset directories and retry startup",
            )
        })?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !matches(&name) {
            continue;
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            asset_io(
                format!("cannot inspect stale temporary {}: {error}", path.display()),
                "remove the unsafe entry and retry startup",
            )
        })?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(asset_io(
                format!("refusing non-file stale temporary {}", path.display()),
                "remove the unsafe entry and retry startup",
            ));
        }
        fs::remove_file(&path).map_err(|error| {
            asset_io(
                format!("cannot remove stale temporary {}: {error}", path.display()),
                "make the owner asset directories writable and retry startup",
            )
        })?;
    }
    Ok(())
}

fn is_blob_temporary(name: &str) -> bool {
    name.starts_with('.') && name.contains(".put-") && name.ends_with(".tmp")
}

fn is_staging_temporary(name: &str) -> bool {
    (name.ends_with(".stage")
        && ["upload-", "heic-normalized-", "rung-", "source-"]
            .iter()
            .any(|prefix| name.starts_with(prefix)))
        || (name.starts_with(".asset-strip-") && name.ends_with(".tmp"))
        || (name.starts_with('.') && name.contains(".snapback2-media-") && name.ends_with(".tmp"))
}

fn validate_key(key: &str) -> Result<(), Refusal> {
    let (id, rung) = key
        .split_once(".w")
        .map_or((key, None), |(id, rung)| (id, Some(rung)));
    let Some(rest) = id.strip_prefix("s2id-") else {
        return Err(invalid_key(key));
    };
    let Some((namespace, sequence)) = rest.rsplit_once('-') else {
        return Err(invalid_key(key));
    };
    let lower_hex = |byte: u8| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte);
    if namespace.len() != 32
        || sequence.len() != 16
        || !namespace.bytes().all(lower_hex)
        || !sequence.bytes().all(lower_hex)
        || sequence.bytes().all(|byte| byte == b'0')
        || rung.is_some_and(|rung| {
            rung.parse::<u32>()
                .ok()
                .filter(|value| *value > 0)
                .is_none()
        })
    {
        return Err(invalid_key(key));
    }
    Ok(())
}

fn invalid_key(key: &str) -> Refusal {
    asset_io(
        format!("refusing unsafe asset blob key {key:?}"),
        "use the engine-minted asset id and a named internal width rung",
    )
}

fn unavailable(key: &str, error: io::Error) -> Refusal {
    Refusal::new(
        "E_ASSET_NOT_READY",
        "input",
        format!("asset blob {key} is unavailable: {error}"),
        "upload the asset again and store the returned record",
        "assets/delivery",
    )
}

fn asset_io(message: impl Into<String>, rewrite: impl Into<String>) -> Refusal {
    Refusal::new(
        "E_OWNER_ASSET_IO",
        "owner",
        message,
        rewrite,
        "assets/storage",
    )
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    bytes
        .iter()
        .flat_map(|byte| {
            [
                DIGITS[usize::from(byte >> 4)] as char,
                DIGITS[usize::from(byte & 0x0f)] as char,
            ]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::io::Cursor;
    use std::sync::mpsc::{Receiver, Sender, channel};
    use std::thread;

    const REAL_KEY: &str = "s2id-0123456789abcdef0123456789abcdef-0000000000000001";
    const PUT_KEY: &str = "s2id-0123456789abcdef0123456789abcdef-0000000000000002";

    fn root() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "snapback2-blob-store-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(path.join(".snapback")).unwrap();
        path
    }

    #[test]
    fn put_get_range_and_delete_are_streaming() {
        let root = root();
        let store = FileBlobStore::open(&root).unwrap();
        let key = REAL_KEY;
        assert_eq!(store.put(key, &mut &b"abcdef"[..]).unwrap(), 6);
        assert_eq!(
            store.put(key, &mut &b"replacement"[..]).unwrap_err().code,
            "E_OWNER_ASSET_IO"
        );
        let mut read = store
            .get(key, Some(ByteRange { start: 2, end: 4 }))
            .unwrap();
        let mut bytes = Vec::new();
        read.stream.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes, b"cde");
        assert_eq!((read.length, read.total), (3, 6));
        store.delete(key).unwrap();
        assert!(store.get(key, None).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn enumerate_skips_publish_temporary_and_returns_real_blob() {
        let root = root();
        let store = FileBlobStore::open(&root).unwrap();
        store.put(REAL_KEY, &mut &b"real"[..]).unwrap();
        let temporary = root
            .join(".snapback/blobs")
            .join(format!(".{PUT_KEY}.put-1-2.tmp"));
        fs::write(&temporary, b"in flight").unwrap();

        let mut keys = Vec::new();
        store
            .enumerate("", &mut |key| {
                keys.push(key.to_owned());
                Ok(())
            })
            .unwrap();
        assert_eq!(keys, vec![REAL_KEY]);
        assert!(temporary.is_file());
        fs::remove_dir_all(root).unwrap();
    }

    struct PausingReader {
        source: Cursor<&'static [u8]>,
        started: Option<Sender<()>>,
        resume: Receiver<()>,
    }

    impl Read for PausingReader {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            if let Some(started) = self.started.take() {
                started.send(()).unwrap();
                self.resume.recv().unwrap();
            }
            self.source.read(buffer)
        }
    }

    #[test]
    fn sweep_during_in_flight_put_keeps_the_active_temporary() {
        let root = root();
        let store = Arc::new(FileBlobStore::open(&root).unwrap());
        store.put(REAL_KEY, &mut &b"real"[..]).unwrap();
        let (started_tx, started_rx) = channel();
        let (resume_tx, resume_rx) = channel();
        let writer = {
            let store = store.clone();
            thread::spawn(move || {
                let mut source = PausingReader {
                    source: Cursor::new(b"published"),
                    started: Some(started_tx),
                    resume: resume_rx,
                };
                store.put(PUT_KEY, &mut source)
            })
        };
        started_rx.recv().unwrap();
        let temporary = fs::read_dir(root.join(".snapback/blobs"))
            .unwrap()
            .map(Result::unwrap)
            .find(|entry| is_blob_temporary(entry.file_name().to_str().unwrap()))
            .unwrap()
            .path();

        crate::asset_gc::sweep_asset_blobs(
            &root,
            store.as_ref(),
            &BTreeSet::from([REAL_KEY.to_owned(), PUT_KEY.to_owned()]),
            &BTreeSet::new(),
        )
        .unwrap();
        assert!(temporary.is_file());
        resume_tx.send(()).unwrap();
        assert_eq!(writer.join().unwrap().unwrap(), 9);
        assert!(store.path_for_key(PUT_KEY).unwrap().is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn enumerate_tolerates_put_completing_before_temporary_inspection() {
        let root = root();
        let store = Arc::new(FileBlobStore::open(&root).unwrap());
        store.put(REAL_KEY, &mut &b"real"[..]).unwrap();
        let (started_tx, started_rx) = channel();
        let (resume_tx, resume_rx) = channel();
        let (completed_tx, completed_rx) = channel();
        let writer = {
            let store = store.clone();
            thread::spawn(move || {
                let mut source = PausingReader {
                    source: Cursor::new(b"published"),
                    started: Some(started_tx),
                    resume: resume_rx,
                };
                let result = store.put(PUT_KEY, &mut source);
                completed_tx.send(()).unwrap();
                result
            })
        };
        started_rx.recv().unwrap();
        let temporary = fs::read_dir(root.join(".snapback/blobs"))
            .unwrap()
            .map(Result::unwrap)
            .find(|entry| is_blob_temporary(entry.file_name().to_str().unwrap()))
            .unwrap()
            .path();

        ENUMERATE_BEFORE_INSPECTION.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move |entry| {
                if entry.path() != temporary {
                    return false;
                }
                resume_tx.send(()).unwrap();
                completed_rx.recv().unwrap();
                true
            }));
        });
        let mut keys = Vec::new();
        store
            .enumerate(REAL_KEY, &mut |key| {
                keys.push(key.to_owned());
                Ok(())
            })
            .unwrap();

        assert_eq!(writer.join().unwrap().unwrap(), 9);
        assert_eq!(keys, vec![REAL_KEY]);
        assert_eq!(
            fs::read(store.path_for_key(REAL_KEY).unwrap()).unwrap(),
            b"real"
        );
        assert_eq!(
            fs::read(store.path_for_key(PUT_KEY).unwrap()).unwrap(),
            b"published"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn periodic_sweep_removes_stale_untracked_publish_temporary() {
        let root = root();
        let store = FileBlobStore::open(&root).unwrap();
        store.put(REAL_KEY, &mut &b"real"[..]).unwrap();
        let temporary = root
            .join(".snapback/blobs")
            .join(format!(".{PUT_KEY}.put-1-2.tmp"));
        fs::write(&temporary, b"crashed").unwrap();
        let old = SystemTime::now()
            .checked_sub(BLOB_TEMP_STALE_AFTER + Duration::from_secs(1))
            .unwrap();
        File::options()
            .write(true)
            .open(&temporary)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(old))
            .unwrap();

        crate::asset_gc::sweep_asset_blobs(
            &root,
            &store,
            &BTreeSet::from([REAL_KEY.to_owned()]),
            &BTreeSet::new(),
        )
        .unwrap();
        assert!(!temporary.exists());
        assert!(store.path_for_key(REAL_KEY).unwrap().is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn traversal_is_refused_as_typed_owner_io() {
        let root = root();
        let store = FileBlobStore::open(&root).unwrap();
        let refusal = store.put("../store.sqlite", &mut &b"x"[..]).unwrap_err();
        assert_eq!(refusal.code, "E_OWNER_ASSET_IO");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn startup_sweeps_only_type_checked_crash_temporaries() {
        let root = root();
        let blobs = root.join(".snapback/blobs");
        let staging = root.join(".snapback/staging");
        fs::create_dir_all(&blobs).unwrap();
        fs::create_dir_all(&staging).unwrap();
        let put = blobs.join(".s2id-dead.put-1-2.tmp");
        let upload = staging.join("upload-dead-1.stage");
        let strip = staging.join(".asset-strip-1-2.tmp");
        let helper = staging.join(".rung-dead.stage.snapback2-media-1-2.tmp");
        let unknown = staging.join("author-file.txt");
        for path in [&put, &upload, &strip, &helper, &unknown] {
            fs::write(path, b"stale").unwrap();
        }
        FileBlobStore::open(&root).unwrap();
        LocalStaging::open(&root).unwrap();
        for path in [&put, &upload, &strip, &helper] {
            assert!(!path.exists(), "{} survived startup sweep", path.display());
        }
        assert!(unknown.is_file());
        fs::remove_dir_all(root).unwrap();
    }
}
