//! Ownership locks the database's sidecar; stat pins its inode. `serve.lock` is only an address hint.
use std::{fs::{self, File}, io::{Read, Seek, SeekFrom, Write}, path::{Path, PathBuf}, time::Duration};
use snapback4_core::{Engine, RuntimeError, store_port::AnyStore};
#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

pub(crate) struct Owner {
    _sidecar: std::sync::Arc<File>,
    identity: (u64, u64),
    path: PathBuf,
    control_directory: PathBuf,
    record: Option<File>,
    pub(crate) token_authority: Option<crate::serve::token::Authority>,
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
fn regular(path: &Path, create: bool, database: &Path) -> Result<File, String> {
    snapback4_core::private_fs::auxiliary_file(database, path, create, 16384)
        .map_err(|e| failure(path, e))
}

// @ref LLP 3000.019#3.4 — sidecar flocks fence backend writers and share device ownership without locking SQLite.
pub(crate) fn command(store: &Path) -> Result<Owner, String> { acquire(store, false, Duration::ZERO, true) }
pub(crate) fn device(store: &Path) -> Result<Owner, String> { acquire(store, true, Duration::ZERO, true) }
// @ref LLP 3000.009#5.3 — a restarting host waits for watchdogs to finish group cleanup.
pub(crate) fn host(store: &Path) -> Result<Owner, String> { acquire(store, false, Duration::from_secs(5), false) }

// @ref LLP 3000.000.000.001#9-wave-19-identity-retry-and-local-production-lifecycle — only pre-admission ownership can wait; a live host keeps its control path.
pub(crate) fn release_command(store: &Path) -> Result<Owner, String> {
    let live = address(store).is_some_and(|published| dialable(&published).is_none_or(|address|
        std::net::TcpStream::connect_timeout(&address, Duration::from_millis(50)).is_ok()));
    wait_command(store, if live && !stopped_host(store) { Duration::ZERO } else { Duration::from_secs(5) })
}
pub(crate) fn wait_command(store: &Path, wait: Duration) -> Result<Owner, String> {
    acquire(store, false, wait, false)
}

/// Read-only release barrier: never initializes SQLite, creates a lock file,
/// clears an address, or treats a PID/listener hint as authority.
#[cfg(unix)]
pub(crate) fn wait_released(store: &Path, wait: Duration) -> Result<(), String> {
    let path = store.canonicalize().map_err(|e| failure(store, e))?;
    let before = snapback4_core::private_fs::database_metadata(&path).map_err(|e| failure(&path,e))?
        .ok_or_else(|| failure(&path,"store disappeared"))?;
    let sidecar = match snapback4_core::private_fs::auxiliary_file(&path, &snapback4_core::private_fs::owner_path(&path), false, 0) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(failure(&path,e)),
    };
    let end = std::time::Instant::now() + wait;
    loop {
        match sidecar.try_lock() {
            Ok(()) => break,
            Err(fs::TryLockError::WouldBlock) if std::time::Instant::now() < end => std::thread::sleep(Duration::from_millis(25)),
            Err(fs::TryLockError::WouldBlock) => return Err(busy(&path)),
            Err(fs::TryLockError::Error(e)) => return Err(failure(&path,e)),
        }
    }
    let after = snapback4_core::private_fs::database_metadata(&path).map_err(|e|failure(&path,e))?;
    if !snapback4_core::private_fs::owner_is_named(&path,&sidecar) || !after.is_some_and(|after|same_file(&before,&after)) {
        return Err(failure(&path,"store or ownership sidecar changed while waiting"));
    }
    Ok(())
}

#[cfg(not(unix))]
pub(crate) fn wait_released(store: &Path, _: Duration) -> Result<(), String> { Err(failure(store,"database ownership requires Unix")) }

#[cfg(unix)]
fn acquire(store: &Path, shared: bool, wait: Duration, cleanup_only: bool) -> Result<Owner, String> {
    let deadline = std::time::Instant::now() + wait;
    for _ in 0..16 {
        let path = resolve(store)?;
        snapback4_core::private_fs::directory(path.parent().ok_or("store path has no parent")?)
            .map_err(|e| failure(&path, e))?;
        // Stat before opening either auxiliary file; a refused probe creates
        // no database. Only the sidecar lock grants permission to create one.
        let before = snapback4_core::private_fs::database_metadata(&path).map_err(|e| failure(&path, e))?;
        let sidecar = snapback4_core::private_fs::owner_file(&path)
            .map_err(|e| failure(&snapback4_core::private_fs::owner_path(&path), e))?;
        let mut cleanup = None;
        loop {
            let locked = if shared { sidecar.try_lock_shared() } else { sidecar.try_lock() };
            match locked {
                Ok(()) => break,
                Err(fs::TryLockError::WouldBlock) if std::time::Instant::now() < deadline && (!cleanup_only || *cleanup.get_or_insert_with(|| stopped_host(&path))) => {
                    if cleanup.is_none() { eprintln!("waiting for store owner cleanup: {} (up to {} ms); no work admitted", path.display(), wait.as_millis()); cleanup = Some(true); }
                    std::thread::sleep(Duration::from_millis(25));
                },
                Err(fs::TryLockError::WouldBlock) => return Err(busy(&path)),
                Err(fs::TryLockError::Error(error)) => return Err(failure(&path, error)),
            }
        }
        if !snapback4_core::private_fs::owner_is_named(&path, &sidecar) { continue; }
        snapback4_core::private_fs::database_file(&path).map_err(|e| failure(&path, e))?;
        let database = snapback4_core::private_fs::database_metadata(&path).map_err(|e| failure(&path, e))?
            .ok_or_else(|| failure(&path, "database disappeared during ownership acquisition"))?;
        if before.as_ref().is_some_and(|old| !same_file(old, &database)) { continue; }
        let control_directory = store.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new(".")).canonicalize().map_err(|e|failure(store,e))?;
        let mut reclaimed = None;
        let record = if shared { None } else {
            let record_path = path.with_file_name("serve.lock");
            if let Some(pid)=owner_pid(&path) {
                if crate::supervisor::identity(pid).is_none() {
                    reclaimed = Some(format!("reclaimed stale serve.lock: dead PID {pid}; directory {}", path.parent().unwrap().display()));
                }
            }
            let file = regular(&record_path, true, &path)?;
            file.set_len(0).map_err(|e| failure(&record_path, e))?;
            let mut file = file;
            write_record(&mut file, None, &control_directory)?;
            Some(file)
        };
        if let Some(note) = reclaimed { eprintln!("note: {note}"); }
        return Ok(Owner { _sidecar: std::sync::Arc::new(sidecar), identity: (database.dev(), database.ino()), path, control_directory, record, token_authority: None });
    }
    Err(failure(store, "database path kept changing during ownership acquisition"))
}

#[cfg(not(unix))]
fn acquire(store: &Path, _: bool, _: Duration, _: bool) -> Result<Owner, String> { Err(failure(store, "database ownership requires Unix")) }

pub(crate) fn stopped_host(path: &Path) -> bool {
    // A recorded owner whose launch custody died is stopping even while its
    // listener still answers. Missing metadata may be the worker-drain window.
    // This is a refusal/wait hint, never permission to open the store: the
    // sidecar must still be acquired. Never dial a non-loopback address hint.
    if let Some(metadata) = record_metadata(path) {
        let dead = |pid: u64, birth: &str| crate::supervisor::identity(pid as u32).is_none_or(|(_, actual)|actual != birth);
        if metadata["pid"].as_u64().zip(metadata["birth"].as_str()).is_some_and(|(pid,birth)|dead(pid,birth)) { return true; }
        if metadata["parents"].as_array().is_some_and(|parents| parents.iter().any(|parent|
            parent[0].as_u64().zip(parent[1].as_str()).is_some_and(|(pid,birth)|dead(pid,birth)))) { return true; }
    } else if owner_pid(path).is_none() {
        // An exiting host can clear its address before worker keepers finish.
        // Only a subsequent successful flock admits work; this is a wait hint.
        return true;
    }
    address(path).is_some_and(|published| dialable(&published).is_none_or(|address|
        std::net::TcpStream::connect_timeout(&address, Duration::from_millis(50)).is_err()))
}

pub(crate) fn busy(path: &Path) -> String {
    let owner = holder(path).unwrap_or_else(|| "holder metadata unavailable (ownership sidecar is locked)".into());
    let recovery = record_metadata(path).and_then(|meta|meta["controlDirectory"].as_str().map(PathBuf::from));
    let dir = recovery.as_deref().unwrap_or_else(|| path.parent().unwrap_or(Path::new(".")));
    let quoted = format!("'{}'", dir.display().to_string().replace('\'', "'\\''"));
    format!("E_STORE_BUSY at {}: owned by {owner}; address {}; directory {}; no work was admitted. Recovery: run `snapback4 stop {quoted}`, rerun this command once, then restart the server. For an active CLI command wait for it to finish. For a disposable parallel proof use `dev --memory` (startDev({{args:[\"--memory\"]}})). Leave <database>-owner in place; deleting it does not stop that process and ends exclusion", path.display(), address(path).unwrap_or_else(|| "pending".into()), dir.display())
}

#[cfg(unix)]
pub(crate) fn address(path: &Path) -> Option<String> {
    // A missing/replaced address record cannot grant ownership. Never follow
    // a symlink (including one to the database), nor block on a FIFO.
    let record = path.with_file_name("serve.lock");
    let file = regular(&record, false, path).ok()?;
    let mut text = String::new();
    file.take(16384).read_to_string(&mut text).ok()?;
    let mut lines = text.lines();
    let port = lines.next().and_then(|s| s.parse::<u16>().ok());
    lines.next().filter(|s| !s.is_empty()).map(str::to_owned).or_else(|| port.filter(|p| *p != 0).map(|p| format!("http://127.0.0.1:{p}")))
}

/// The owning host's PID from its address record (`pid N` on the third line).
#[cfg(unix)]
fn owner_pid(path: &Path) -> Option<u32> {
    let record = path.with_file_name("serve.lock");
    let file = regular(&record, false, path).ok()?;
    let mut text = String::new();
    file.take(16384).read_to_string(&mut text).ok()?;
    text.lines().nth(2)?.strip_prefix("pid ")?.parse().ok()
}

#[cfg(not(unix))]
fn owner_pid(_: &Path) -> Option<u32> { None }

#[cfg(not(unix))]
pub(crate) fn address(_: &Path) -> Option<String> { None }


// @ref LLP 3000.037.000#9-serve-lifetime-and-store-recovery-srv1 — metadata explains a lock; it never authorizes a signal.
fn write_record(file: &mut File, address: Option<std::net::SocketAddr>, control: &Path) -> Result<(), String> {
    let pid = std::process::id();
    let start = crate::supervisor::identity(pid).map(|(_, start)| start).unwrap_or_else(|| "unknown".into());
    #[cfg(target_os = "linux")]
    let started = (|| {
        let boot = fs::read_to_string("/proc/stat").ok()?.lines().find_map(|line|line.strip_prefix("btime ").and_then(|s|s.parse::<u64>().ok()))?;
        let ticks = unsafe {libc::sysconf(libc::_SC_CLK_TCK)};
        (ticks > 0).then(|| format!("{} Unix seconds", boot + start.parse::<u64>().unwrap_or(0) / ticks as u64))
    })().unwrap_or_else(|| "unknown".into());
    #[cfg(not(target_os = "linux"))]
    let started = start.clone();
    // Never persist arbitrary argv (tokens/passwords can occur there).
    let verb = std::env::args().nth(1).filter(|s| crate::cli_flags::VERBS.contains(&s.as_str())).unwrap_or_else(|| "command".into());
    let metadata = serde_json::json!({"pid":pid,"birth":start,"startTime":started,"command":format!("snapback4 {verb}"),"controlDirectory":control.to_string_lossy(),"parents":crate::supervisor::parents()});
    write!(file, "{}\n{}\npid {pid}\n{metadata}\n", address.map(|a|a.port()).unwrap_or(0), address.map(|a|format!("http://{a}")).unwrap_or_default()).map_err(|e|e.to_string())
}
fn record_metadata(path: &Path) -> Option<serde_json::Value> {
    let mut text = String::new();
    regular(&path.with_file_name("serve.lock"), false, path).ok()?.take(16384).read_to_string(&mut text).ok()?;
    serde_json::from_str(text.lines().nth(3)?).ok()
}
fn holder(path: &Path) -> Option<String> {
    let mut text = String::new();
    regular(&path.with_file_name("serve.lock"), false, path).ok()?.take(16384).read_to_string(&mut text).ok()?;
    let pid = owner_pid(path)?;
    let metadata: serde_json::Value = text.lines().nth(3).and_then(|s|serde_json::from_str(s).ok()).unwrap_or_default();
    let alive = crate::supervisor::identity(pid).is_some_and(|(_, birth)| metadata["birth"].as_str().is_none_or(|saved| saved == birth));
    Some(format!("pid {pid}, command {}, start time {}, still alive: {alive}", metadata["command"].as_str().unwrap_or("unknown"), metadata["startTime"].as_str().unwrap_or("unknown")))
}

impl Owner {
    pub(crate) fn control_directory(&self) -> &Path { &self.control_directory }
    // @ref LLP 3000.000.000#11-wave-11-factual-release-narration — unlink only our address inode; the ownership sidecar remains named.
    pub(crate) fn clear_address(&self) {
        #[cfg(unix)]
        if let Some(file) = &self.record {
            let path = self.path.with_file_name("serve.lock");
            if let (Ok(held), Ok(named)) = (file.metadata(), fs::symlink_metadata(&path))
                && same_file(&held, &named) {
                let _ = fs::remove_file(path);
            }
        }
    }
    pub(crate) fn worker_lock(&self) -> std::sync::Arc<File> { self._sidecar.clone() }

    pub(crate) fn path(&self) -> Result<&Path, RuntimeError> {
        #[cfg(unix)]
        {
            let meta = snapback4_core::private_fs::database_metadata(&self.path)
                .map_err(|e| RuntimeError::Store(failure(&self.path, e)))?;
            if meta.is_some_and(|m| (m.dev(), m.ino()) == self.identity) { return Ok(&self.path); }
        }
        Err(RuntimeError::Store(failure(&self.path, "owned database moved or was replaced; stop and reopen its current path")))
    }

    pub(crate) fn open_store(&self, timeout: Duration) -> Result<AnyStore, RuntimeError> {
        let mut store = AnyStore::open_with_busy_timeout(self.path()?, timeout)?;
        #[cfg(unix)]
        if self.record.is_some() { store.retain_exclusive_ownership(self._sidecar.clone(), self.identity)?; }
        else { store.retain_ownership(self._sidecar.clone())?; }
        Ok(store)
    }

    pub(crate) fn open_engine(&self, bound: &snapback4_lang::Bound, timeout: Duration, now: i64) -> Result<Engine, RuntimeError> {
        let store = self.open_store(timeout)?;
        if store.release_value()?.is_some() {
            return Err(RuntimeError::Generation("this store belongs to a deployment; use `deploy` to activate source and `serve` to run it".into()));
        }
        Engine::new_at(store, bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone()), now)
    }
}

impl Drop for Owner { fn drop(&mut self) { self.clear_address(); } }

pub(crate) fn announce(owner: &mut Owner, address: std::net::SocketAddr) -> Result<(), String> {
    // @ref LLP 3000.019#3.4 — live token work runs through the owner, with proof of local store access.
    owner.token_authority = Some(crate::serve::token::publish(owner.path().map_err(|e| e.to_string())?)
        .map_err(|e| failure(&owner.path, e))?);
    let file = owner.record.as_mut().ok_or("device ownership has no server address record")?;
    file.set_len(0).and_then(|_| file.seek(SeekFrom::Start(0))).map_err(|e| e.to_string())?;
    // First-line port is retained for the dev inspector; the third line names the owning process.
    write_record(file, Some(address), &owner.control_directory)
}

#[cfg(all(test, unix))]
#[path = "store_owner_tests.rs"]
mod tests;
