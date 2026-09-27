//! Ownership follows the database inode. `serve.lock` is only an address hint.
use std::{fs::{self, File, OpenOptions}, io::{Read, Seek, SeekFrom, Write}, path::{Path, PathBuf}, time::Duration};
use snapback4_core::{Engine, RuntimeError, Store};
#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};

pub(crate) struct Owner {
    database: File,
    path: PathBuf,
    record: Option<File>,
}

/// The address `doctor` dials for the server that owns this store: the
/// published loopback address itself, or, for a wildcard bind, that family's
/// loopback on the same port. A published non-loopback address is not followed.
pub(crate) fn inspector_address(store: &Path) -> Option<std::net::SocketAddr> {
    let path = store.canonicalize().ok()?;
    dialable(&address(&path)?)
}

fn dialable(published: &str) -> Option<std::net::SocketAddr> {
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
    let address = published.strip_prefix("http://")?.parse::<SocketAddr>().ok()?;
    let ip = match address.ip() {
        ip if ip.is_loopback() => ip,
        IpAddr::V4(ip) if ip.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST),
        IpAddr::V6(ip) if ip.is_unspecified() => IpAddr::V6(Ipv6Addr::LOCALHOST),
        _ => return None,
    };
    (address.port() != 0).then(|| SocketAddr::new(ip, address.port()))
}

fn resolve(store: &Path) -> Result<PathBuf, String> {
    match store.canonicalize() {
        Ok(path) => Ok(path),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let parent = store.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
            snapback4_core::private_fs::directory(parent).map_err(|e| failure(store, e))?;
            Ok(parent.canonicalize().map_err(|e| failure(store, e))?.join(store.file_name().ok_or("store path has no filename")?))
        }
        Err(e) => Err(failure(store, e)),
    }
}

fn failure(path: &Path, reason: impl std::fmt::Display) -> String {
    format!("E_STORE at {}: {reason}; restore a regular store/address file and retry", path.display())
}

#[cfg(unix)]
fn same_file(a: &fs::Metadata, b: &fs::Metadata) -> bool { a.dev() == b.dev() && a.ino() == b.ino() }

#[cfg(unix)]
fn regular(path: &Path, create: bool, database: Option<&fs::Metadata>) -> Result<File, String> {
    let file = OpenOptions::new().read(true).write(true).create(create).truncate(false)
        .mode(0o600).custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK).open(path)
        .map_err(|e| failure(path, e))?;
    let meta = file.metadata().map_err(|e| failure(path, e))?;
    if !meta.is_file() {
        return Err(failure(path, "expected a regular file"));
    }
    if database.is_some_and(|db| meta.nlink() != 1 || same_file(&meta, db)) {
        return Err(failure(path, "address record must not be a hard link"));
    }
    file.set_permissions(fs::Permissions::from_mode(0o600)).map_err(|e| failure(path, e))?;
    Ok(file)
}

// @ref LLP 3000.019#3.4 — fence every backend writer; compatible device processes share ownership.
pub(crate) fn command(store: &Path) -> Result<Owner, String> { acquire(store, false) }
pub(crate) fn device(store: &Path) -> Result<Owner, String> { acquire(store, true) }

#[cfg(unix)]
fn acquire(store: &Path, shared: bool) -> Result<Owner, String> {
    for _ in 0..16 {
        let path = resolve(store)?;
        snapback4_core::private_fs::directory(path.parent().ok_or("store path has no parent")?)
            .map_err(|e| failure(&path, e))?;
        let database = regular(&path, true, None)?;
        let locked = if shared { database.try_lock_shared() } else { database.try_lock() };
        // stat/fstat only: opening and closing another database descriptor can
        // discard SQLite's process-wide POSIX locks. No SQLite exists yet here.
        let named = fs::metadata(&path).ok().is_some_and(|m| database.metadata().is_ok_and(|f| same_file(&f, &m)));
        if !named { drop(database); continue; }
        locked.map_err(|error| match error {
            fs::TryLockError::WouldBlock => busy(&path),
            fs::TryLockError::Error(error) => failure(&path, error),
        })?;
        let record = if shared { None } else {
            let record_path = path.with_file_name("serve.lock");
            let file = regular(&record_path, true, Some(&database.metadata().map_err(|e| failure(&path, e))?))?;
            file.set_len(0).map_err(|e| failure(&record_path, e))?;
            Some(file)
        };
        return Ok(Owner { database, path, record });
    }
    Err(failure(store, "database path kept changing during ownership acquisition"))
}

#[cfg(not(unix))]
fn acquire(store: &Path, _: bool) -> Result<Owner, String> { Err(failure(store, "database ownership requires Unix")) }

fn busy(path: &Path) -> String {
    let owner = address(path).unwrap_or_else(|| "another CLI command or a server starting up (address pending)".into());
    format!("E_STORE_BUSY at {}: this store is live; owned by {owner}; no work was admitted. Stop its `snapback4 dev` or `snapback4 serve` process (or wait for the owning CLI command), rerun this command once, then restart the server", path.display())
}

#[cfg(unix)]
fn address(path: &Path) -> Option<String> {
    // A missing/replaced address record cannot grant ownership. Never follow
    // a symlink (including one to the database), nor block on a FIFO.
    let file = OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path.with_file_name("serve.lock")).ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file() || metadata.nlink() != 1 { return None; }
    let mut text = String::new();
    file.take(1024).read_to_string(&mut text).ok()?;
    let mut lines = text.lines();
    let port = lines.next().and_then(|s| s.parse::<u16>().ok());
    lines.next().map(str::to_owned).or_else(|| port.map(|p| format!("http://127.0.0.1:{p}")))
}

#[cfg(not(unix))]
fn address(_: &Path) -> Option<String> { None }

impl Owner {
    pub(crate) fn path(&self) -> Result<&Path, RuntimeError> {
        #[cfg(unix)]
        if fs::metadata(&self.path).ok().is_some_and(|m| self.database.metadata().is_ok_and(|f| same_file(&f, &m))) {
            return Ok(&self.path);
        }
        Err(RuntimeError::Store(failure(&self.path, "owned database moved or was replaced; stop and reopen its current path")))
    }

    pub(crate) fn open_store(&self, timeout: Duration) -> Result<Store, RuntimeError> {
        Store::open_with_busy_timeout(self.path()?, timeout)
    }

    pub(crate) fn open_engine(&self, bound: &snapback4_lang::Bound, timeout: Duration, now: i64) -> Result<Engine, RuntimeError> {
        let store = self.open_store(timeout)?;
        if store.meta("release")?.is_some() {
            return Err(RuntimeError::Generation("this store belongs to a deployment; use `deploy` to activate source and `serve` to run it".into()));
        }
        Engine::new_at(store, bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone()), now)
    }
}

pub(crate) fn announce(owner: &mut Owner, address: std::net::SocketAddr) -> Result<(), String> {
    let file = owner.record.as_mut().ok_or("device ownership has no server address record")?;
    file.set_len(0).and_then(|_| file.seek(SeekFrom::Start(0))).map_err(|e| e.to_string())?;
    // First-line port is retained for the dev inspector.
    write!(file, "{}\nhttp://{address}\n", address.port()).map_err(|e| e.to_string())
}

#[cfg(all(test, unix))]
#[path = "store_owner_tests.rs"]
mod tests;
