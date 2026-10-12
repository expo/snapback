//! Private filesystem-owner control transport; never an HTTP application door.
// @ref LLP 3000.000.000#5-hot-activation-and-ownership — the host remains the only database writer.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
#[cfg(unix)]
use std::os::unix::{
    ffi::OsStrExt,
    fs::{FileTypeExt, MetadataExt, PermissionsExt},
    net::{UnixListener, UnixStream},
};
use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

const INPUT: usize = 4096;
const OUTPUT: usize = 64 * 1024;
pub(crate) const SOCKET: &str = ".release-control.sock";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "kebab-case", deny_unknown_fields)]
pub(crate) enum Command {
    Status {
        after: u64,
        items_after: Option<String>,
        event: Option<u64>,
    },
    Activate {
        release: u64,
        expected_release: Option<u64>,
        expected_revision: u64,
        digest: String,
        rollback: bool,
        restore_dormant: bool,
        allow_feed_adoption: bool,
    },
    Prune {
        confirm: bool,
        expected_revision: u64,
    },
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    identity: String,
    command: Command,
}

#[cfg(unix)]
pub(crate) fn identity(store: &Path) -> Result<String, String> {
    let path = store.canonicalize().map_err(|e| e.to_string())?;
    let m = snapback4_core::private_fs::database_metadata(&path)
        .map_err(|e| e.to_string())?
        .ok_or("store disappeared")?;
    Ok(crate::native::digest(
        &serde_json::to_vec(&(path.as_os_str().as_bytes(), m.dev(), m.ino())).unwrap(),
    ))
}

#[cfg(unix)]
fn peer(stream: &UnixStream) -> io::Result<()> {
    use std::os::fd::AsRawFd;
    #[cfg(target_os = "linux")]
    let uid = {
        let mut credentials = std::mem::MaybeUninit::<libc::ucred>::uninit();
        let mut size = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
        if unsafe {
            libc::getsockopt(
                stream.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                credentials.as_mut_ptr().cast(),
                &mut size,
            )
        } != 0
        {
            return Err(io::Error::last_os_error());
        }
        if size as usize != std::mem::size_of::<libc::ucred>() {
            return Err(io::Error::other("invalid peer credentials"));
        }
        unsafe { credentials.assume_init() }.uid
    };
    #[cfg(target_os = "macos")]
    let uid = {
        let (mut uid, mut gid) = (0, 0);
        if unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) } != 0 {
            return Err(io::Error::last_os_error());
        }
        uid
    };
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    return Err(io::Error::other(
        "release control peer credentials unsupported on this Unix host",
    ));
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    if uid != unsafe { libc::geteuid() } {
        return Err(io::Error::other(
            "release control requires the same filesystem owner",
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn socket_entry(path: &Path) -> io::Result<fs::Metadata> {
    let m = fs::symlink_metadata(path)?;
    if !m.file_type().is_socket()
        || m.uid() != unsafe { libc::geteuid() }
        || m.permissions().mode() & 0o777 != 0o600
    {
        return Err(io::Error::other(
            "release control must be a same-owner 0600 socket, never a symlink or regular file",
        ));
    }
    Ok(m)
}

#[cfg(unix)]
fn address(dir: &Path) -> io::Result<(Option<fs::File>, PathBuf)> {
    let path = dir.join(SOCKET);
    #[cfg(target_os = "linux")]
    if path.as_os_str().as_bytes().len() >= 100 {
        use std::os::{fd::AsRawFd, unix::fs::OpenOptionsExt};
        // The socket still lives in the deployment directory. Descriptor
        // addressing avoids sockaddr_un's short pathname limit on Linux.
        let directory = fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
            .open(dir)?;
        let short = PathBuf::from(format!(
            "/proc/self/fd/{}/{}",
            directory.as_raw_fd(),
            SOCKET
        ));
        return Ok((Some(directory), short));
    }
    Ok((None, path))
}

/// Only called while the exclusive database sidecar is held, so stale socket
/// replacement cannot disconnect another admitted serving owner.
#[cfg(unix)]
pub(crate) struct Listener {
    listener: UnixListener,
    path: PathBuf,
    inode: (u64, u64),
    identity: String,
}
#[cfg(unix)]
impl Listener {
    pub(crate) fn bind(dir: &Path, store: &Path) -> Result<Self, String> {
        let path = dir.join(SOCKET);
        match fs::symlink_metadata(&path) {
            Ok(_) => {
                socket_entry(&path).map_err(|e| e.to_string())?;
                fs::remove_file(&path).map_err(|e| e.to_string())?;
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        let (_directory, address) = address(dir).map_err(|e| e.to_string())?;
        let listener = UnixListener::bind(&address)
            .map_err(|e| format!("release control {}: {e}", path.display()))?;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let m = socket_entry(&path).map_err(|e| e.to_string())?;
        Ok(Self {
            listener,
            path,
            inode: (m.dev(), m.ino()),
            identity: identity(store)?,
        })
    }
    fn handle(
        &self,
        stream: &mut UnixStream,
        mut handle: impl FnMut(Command) -> Result<Value, String>,
    ) {
        let result = (|| -> Result<Value, String> {
            peer(&stream).map_err(|e| e.to_string())?;
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .map_err(|e| e.to_string())?;
            stream
                .set_write_timeout(Some(Duration::from_secs(5)))
                .map_err(|e| e.to_string())?;
            let mut bytes = Vec::new();
            (&mut *stream)
                .take((INPUT + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() > INPUT {
                return Err("release control command exceeds 4096 bytes".into());
            }
            let request: Envelope = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            if request.identity != self.identity {
                return Err("release control store identity differs; run releases against the owned deployment".into());
            }
            handle(request.command)
        })();
        let reply = match result {
            Ok(value) => json!({"ok":value}),
            Err(error) => json!({"error":error}),
        };
        let mut bytes = serde_json::to_vec(&reply).unwrap();
        if bytes.len() > OUTPUT {
            bytes=serde_json::to_vec(&json!({"error":"release control reply exceeds its bound; inspect paginated `snapback4 releases <dir>`; an admitted activation/prune may already have committed"})).unwrap();
        }
        // A timeout/lost peer does not cancel or undo admitted work.
        let _ = stream.write_all(&bytes);
    }
    pub(crate) fn run(self, mut handle: impl FnMut(Command) -> Result<Value, String>) {
        while !crate::lifecycle::stopping() {
            match self.listener.accept() {
                Ok((mut stream, _)) => {
                    self.handle(&mut stream, &mut handle);
                }
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(25))
                }
                Err(e) => {
                    snapback4_core::diagnostic!("release control accept: {e}");
                    std::thread::sleep(Duration::from_millis(50));
                }
            }
        }
    }
}
#[cfg(unix)]
impl Drop for Listener {
    fn drop(&mut self) {
        if fs::symlink_metadata(&self.path)
            .is_ok_and(|m| m.file_type().is_socket() && (m.dev(), m.ino()) == self.inode)
        {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(unix)]
pub(crate) fn request(dir: &Path, command: Command) -> Result<Value, String> {
    let store = dir.join("store.sqlite");
    let path = dir.join(SOCKET);
    let unavailable = |reason: String| {
        let owner_path = store.canonicalize().unwrap_or_else(|_| store.clone());
        let detail = if reason.contains("No such file or directory") {
            "this deployment has no release control socket".to_owned()
        } else { reason };
        format!(
            "{}; release control unavailable: {detail}; stop `snapback4 serve {}`, rerun the exact command, then `snapback4 serve {}`",
            crate::store_owner::busy(&owner_path), dir.display(), dir.display()
        )
    };
    let before = socket_entry(&path).map_err(|e| unavailable(e.to_string()))?;
    let (_directory, address) = address(dir).map_err(|e| unavailable(e.to_string()))?;
    let mut stream = UnixStream::connect(&address).map_err(|e| unavailable(e.to_string()))?;
    peer(&stream).map_err(|e| unavailable(e.to_string()))?;
    let after = socket_entry(&path).map_err(|e| unavailable(e.to_string()))?;
    if (before.dev(), before.ino()) != (after.dev(), after.ino()) {
        return Err(unavailable(
            "release control socket changed before send".into(),
        ));
    }
    stream
        .set_read_timeout(Some(Duration::from_secs(120)))
        .map_err(|e| unavailable(e.to_string()))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| unavailable(e.to_string()))?;
    let bytes = serde_json::to_vec(&Envelope {
        identity: identity(&store)?,
        command,
    })
    .unwrap();
    if bytes.len() > INPUT {
        return Err("release control command exceeds 4096 bytes".into());
    }
    let ambiguous = |reason: io::Error| {
        format!(
            "release command result is unknown: {reason}; run `snapback4 releases {}` to inspect database authority; the server continues admitted work. Do not automatically deploy another release",
            dir.display()
        )
    };
    stream.write_all(&bytes).map_err(ambiguous)?;
    stream
        .shutdown(std::net::Shutdown::Write)
        .map_err(ambiguous)?;
    let mut reply = Vec::new();
    stream
        .take((OUTPUT + 1) as u64)
        .read_to_end(&mut reply)
        .map_err(ambiguous)?;
    if reply.len() > OUTPUT {
        return Err("release reply too large; inspect releases before retrying".into());
    }
    let value: Value = serde_json::from_slice(&reply).map_err(|e| {
        format!(
            "release result is unknown ({e}); inspect `snapback4 releases {}` before retrying",
            dir.display()
        )
    })?;
    match value.get("ok") {
        Some(value) => Ok(value.clone()),
        None => Err(value["error"]
            .as_str()
            .unwrap_or("release control refused command; inspect releases")
            .into()),
    }
}

#[cfg(not(unix))]
pub(crate) fn request(_: &Path, _: Command) -> Result<Value, String> {
    Err("local release control requires Unix".into())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicU64, Ordering},
        mpsc,
    };
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Directory(PathBuf);
    impl Directory {
        fn new(long: bool) -> Self {
            let root = std::env::temp_dir().join(format!(
                "sb4-roll-control-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            let root = if long {
                root.join("long-path-component".repeat(6))
            } else {
                root
            };
            snapback4_core::private_fs::directory(&root).unwrap();
            let _store = snapback4_core::Store::open(&root.join("store.sqlite")).unwrap();
            Self(root)
        }
    }
    impl Drop for Directory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn socket_permissions_and_entry_types_are_enforced() {
        let dir = Directory::new(false);
        let path = dir.0.join(SOCKET);
        fs::write(&path, "not a socket").unwrap();
        assert!(
            Listener::bind(&dir.0, &dir.0.join("store.sqlite"))
                .err()
                .unwrap()
                .contains("0600 socket")
        );
        fs::remove_file(&path).unwrap();
        std::os::unix::fs::symlink("store.sqlite", &path).unwrap();
        assert!(Listener::bind(&dir.0, &dir.0.join("store.sqlite")).is_err());
        fs::remove_file(&path).unwrap();
        let listener = Listener::bind(&dir.0, &dir.0.join("store.sqlite")).unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        fs::set_permissions(&path, fs::Permissions::from_mode(0o666)).unwrap();
        assert!(
            request(
                &dir.0,
                Command::Status {
                    after: 0,
                    items_after: None,
                    event: None
                }
            )
            .unwrap_err()
            .contains("0600 socket")
        );
        drop(listener);
        assert!(!path.exists());
    }
    #[test]
    fn rejected_store_identity_does_not_execute_command() {
        let dir = Directory::new(false);
        let listener = Listener::bind(&dir.0, &dir.0.join("store.sqlite")).unwrap();
        listener.listener.set_nonblocking(false).unwrap();
        let task = std::thread::spawn(move || {
            let (mut stream, _) = listener.listener.accept().unwrap();
            listener.handle(&mut stream, |_| panic!("wrong identity admitted"));
        });
        let mut stream = UnixStream::connect(dir.0.join(SOCKET)).unwrap();
        stream.write_all(br#"{"identity":"wrong","command":{"command":"status","after":0,"items_after":null,"event":null}}"#).unwrap();
        stream.shutdown(std::net::Shutdown::Write).unwrap();
        let mut reply = String::new();
        stream.read_to_string(&mut reply).unwrap();
        assert!(reply.contains("identity differs"));
        task.join().unwrap();
    }
    #[test]
    fn lost_reply_does_not_cancel_admitted_command() {
        let dir = Directory::new(false);
        let listener = Listener::bind(&dir.0, &dir.0.join("store.sqlite")).unwrap();
        listener.listener.set_nonblocking(false).unwrap();
        let (entered, waiting) = mpsc::channel();
        let (resume, resumed) = mpsc::channel();
        let (done, finished) = mpsc::channel();
        let task = std::thread::spawn(move || {
            let (mut stream, _) = listener.listener.accept().unwrap();
            listener.handle(&mut stream, |_| {
                entered.send(()).unwrap();
                resumed.recv_timeout(Duration::from_secs(10)).unwrap();
                done.send(()).unwrap();
                Ok(json!({"committed":true}))
            });
        });
        let mut stream = UnixStream::connect(dir.0.join(SOCKET)).unwrap();
        let envelope = Envelope {
            identity: identity(&dir.0.join("store.sqlite")).unwrap(),
            command: Command::Prune {
                confirm: true,
                expected_revision: 1,
            },
        };
        stream
            .write_all(&serde_json::to_vec(&envelope).unwrap())
            .unwrap();
        stream.shutdown(std::net::Shutdown::Write).unwrap();
        waiting.recv_timeout(Duration::from_secs(10)).unwrap();
        drop(stream);
        resume.send(()).unwrap();
        finished.recv_timeout(Duration::from_secs(10)).unwrap();
        task.join().unwrap();
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn long_deployment_path_uses_same_private_socket() {
        let dir = Directory::new(true);
        assert!(dir.0.as_os_str().as_bytes().len() > 108);
        let listener = Listener::bind(&dir.0, &dir.0.join("store.sqlite")).unwrap();
        listener.listener.set_nonblocking(false).unwrap();
        let task = std::thread::spawn(move || {
            let (mut stream, _) = listener.listener.accept().unwrap();
            listener.handle(&mut stream, |_| Ok(json!({"release":2})));
        });
        assert_eq!(
            request(
                &dir.0,
                Command::Status {
                    after: 0,
                    items_after: None,
                    event: None
                }
            )
            .unwrap()["release"],
            2
        );
        task.join().unwrap();
        assert!(!dir.0.join(SOCKET).exists());
    }
}
