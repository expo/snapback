//! Local app-instance ownership locks.
//!
//! A file-backed local server owns both the SQLite database and process-local
//! runtime state. The sidecar lock prevents two server processes from appearing
//! as separate instances while mutating the same database.

use anyhow::{Context, anyhow};
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug)]
pub struct DatabaseInstanceLock {
    file: File,
    db_path: PathBuf,
    lock_path: PathBuf,
    started_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct DatabaseInstanceMetadata {
    pub pid: u32,
    pub db_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub started_at_ms: u64,
}

impl DatabaseInstanceLock {
    pub fn acquire(db_path: impl AsRef<Path>) -> anyhow::Result<Self> {
        let db_path = db_path.as_ref().to_path_buf();
        let lock_path = lock_path_for_database(&db_path)?;
        if let Some(parent) = lock_path.parent() {
            std::fs::create_dir_all(parent).with_context(|| {
                format!(
                    "failed to create Snapback database lock directory {}",
                    parent.display()
                )
            })?;
        }

        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)
            .with_context(|| {
                format!(
                    "failed to open Snapback database lock {}",
                    lock_path.display()
                )
            })?;

        if let Err(error) = platform::try_lock_exclusive(&file) {
            if error.kind() == io::ErrorKind::WouldBlock {
                let owner = read_metadata(&mut file).ok().flatten();
                return Err(anyhow!(lock_held_message(&db_path, &lock_path, owner)));
            }
            return Err(error).with_context(|| {
                format!(
                    "failed to lock Snapback database lock {}",
                    lock_path.display()
                )
            });
        }

        let mut lock = Self {
            file,
            db_path,
            lock_path,
            started_at_ms: now_millis(),
        };
        lock.write_metadata(None, None)?;
        Ok(lock)
    }

    pub fn record_server(&mut self, host: &str, port: u16) -> anyhow::Result<()> {
        self.write_metadata(Some(host), Some(port))
    }

    #[cfg(test)]
    fn lock_path(&self) -> &Path {
        &self.lock_path
    }

    fn write_metadata(&mut self, host: Option<&str>, port: Option<u16>) -> anyhow::Result<()> {
        let url = host
            .zip(port)
            .map(|(host, port)| format!("http://{}:{port}", url_host(host)));
        let metadata = DatabaseInstanceMetadata {
            pid: std::process::id(),
            db_path: self.db_path.display().to_string(),
            host: host.map(ToOwned::to_owned),
            port,
            url,
            started_at_ms: self.started_at_ms,
        };

        self.file.set_len(0).with_context(|| {
            format!(
                "failed to truncate Snapback database lock {}",
                self.lock_path.display()
            )
        })?;
        self.file.seek(SeekFrom::Start(0))?;
        serde_json::to_writer_pretty(&mut self.file, &metadata)
            .context("failed to serialize Snapback database lock metadata")?;
        self.file.write_all(b"\n")?;
        self.file.sync_data().with_context(|| {
            format!(
                "failed to flush Snapback database lock {}",
                self.lock_path.display()
            )
        })?;
        Ok(())
    }
}

impl Drop for DatabaseInstanceLock {
    fn drop(&mut self) {
        let _ = platform::unlock(&self.file);
    }
}

pub fn lock_path_for_database(db_path: &Path) -> anyhow::Result<PathBuf> {
    let file_name = db_path.file_name().ok_or_else(|| {
        anyhow!(
            "Snapback database path has no file name: {}",
            db_path.display()
        )
    })?;
    let mut lock_name: OsString = file_name.to_os_string();
    lock_name.push(".snapback.lock");
    Ok(db_path
        .parent()
        .map(|parent| parent.join(&lock_name))
        .unwrap_or_else(|| PathBuf::from(lock_name)))
}

fn read_metadata(file: &mut File) -> anyhow::Result<Option<DatabaseInstanceMetadata>> {
    file.seek(SeekFrom::Start(0))?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)?;
    let contents = contents.trim();
    if contents.is_empty() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_str(contents)?))
}

fn lock_held_message(
    db_path: &Path,
    lock_path: &Path,
    owner: Option<DatabaseInstanceMetadata>,
) -> String {
    let mut message = format!(
        "Snapback database is already owned by another local server:\n  db: {}",
        db_path.display()
    );
    if let Some(owner) = owner {
        if let Some(url) = owner.url {
            message.push_str(&format!("\n  server: {url}"));
        } else {
            message.push_str("\n  server: starting (port not bound yet)");
        }
        message.push_str(&format!("\n  pid: {}", owner.pid));
    } else {
        message.push_str(&format!(
            "\n  lock: {}\n  owner metadata: unavailable",
            lock_path.display()
        ));
    }
    message.push_str("\n\nUse that server, stop it, pass --memory, or choose a different --db.");
    message
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn url_host(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_owned()
    }
}

#[cfg(unix)]
mod platform {
    use std::fs::File;
    use std::io;
    use std::os::fd::AsRawFd;
    use std::os::raw::c_int;

    const LOCK_EX: c_int = 2;
    const LOCK_NB: c_int = 4;
    const LOCK_UN: c_int = 8;

    unsafe extern "C" {
        fn flock(fd: c_int, operation: c_int) -> c_int;
    }

    pub fn try_lock_exclusive(file: &File) -> io::Result<()> {
        let result = unsafe { flock(file.as_raw_fd(), LOCK_EX | LOCK_NB) };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    pub fn unlock(file: &File) -> io::Result<()> {
        let result = unsafe { flock(file.as_raw_fd(), LOCK_UN) };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::fs::File;
    use std::io;
    use std::os::windows::io::AsRawHandle;
    use std::ptr::null_mut;

    type Bool = i32;
    type Dword = u32;
    type Handle = *mut c_void;

    const LOCKFILE_EXCLUSIVE_LOCK: Dword = 0x00000002;
    const LOCKFILE_FAIL_IMMEDIATELY: Dword = 0x00000001;
    const ERROR_LOCK_VIOLATION: i32 = 33;
    // Keep the byte-range lock away from the metadata JSON at the start of the
    // sidecar file. Windows enforces byte-range locks against normal reads, so
    // locking byte 0 made contenders unable to read the owner diagnostic.
    const LOCK_BYTE_OFFSET_LOW: Dword = 0xFFFF_FFFF;
    const LOCK_BYTE_OFFSET_HIGH: Dword = 0xFFFF_FFFF;

    #[repr(C)]
    struct Overlapped {
        internal: usize,
        internal_high: usize,
        offset: Dword,
        offset_high: Dword,
        h_event: Handle,
    }

    impl Overlapped {
        fn lock_byte() -> Self {
            Self {
                internal: 0,
                internal_high: 0,
                offset: LOCK_BYTE_OFFSET_LOW,
                offset_high: LOCK_BYTE_OFFSET_HIGH,
                h_event: null_mut(),
            }
        }
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn LockFileEx(
            hFile: Handle,
            dwFlags: Dword,
            dwReserved: Dword,
            nNumberOfBytesToLockLow: Dword,
            nNumberOfBytesToLockHigh: Dword,
            lpOverlapped: *mut Overlapped,
        ) -> Bool;
        fn UnlockFileEx(
            hFile: Handle,
            dwReserved: Dword,
            nNumberOfBytesToUnlockLow: Dword,
            nNumberOfBytesToUnlockHigh: Dword,
            lpOverlapped: *mut Overlapped,
        ) -> Bool;
    }

    pub fn try_lock_exclusive(file: &File) -> io::Result<()> {
        let mut overlapped = Overlapped::lock_byte();
        let result = unsafe {
            LockFileEx(
                file.as_raw_handle() as Handle,
                LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
                0,
                1,
                0,
                &mut overlapped,
            )
        };
        if result != 0 {
            Ok(())
        } else {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(ERROR_LOCK_VIOLATION) {
                Err(io::Error::new(io::ErrorKind::WouldBlock, error))
            } else {
                Err(error)
            }
        }
    }

    pub fn unlock(file: &File) -> io::Result<()> {
        let mut overlapped = Overlapped::lock_byte();
        let result =
            unsafe { UnlockFileEx(file.as_raw_handle() as Handle, 0, 1, 0, &mut overlapped) };
        if result != 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
}

#[cfg(not(any(unix, windows)))]
mod platform {
    use std::fs::File;
    use std::io::{self, ErrorKind};

    pub fn try_lock_exclusive(_file: &File) -> io::Result<()> {
        Err(io::Error::new(
            ErrorKind::Unsupported,
            "Snapback database instance locks are not supported on this platform",
        ))
    }

    pub fn unlock(_file: &File) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{DatabaseInstanceLock, lock_path_for_database};

    #[test]
    fn lock_path_appends_sidecar_suffix() {
        let path = std::path::Path::new("/tmp/app.sqlite3");
        let lock_path = lock_path_for_database(path).unwrap();

        assert_eq!(
            lock_path,
            std::path::Path::new("/tmp/app.sqlite3.snapback.lock")
        );
    }

    #[test]
    fn ipv6_url_hosts_are_bracketed() {
        assert_eq!(super::url_host("::1"), "[::1]");
        assert_eq!(super::url_host("127.0.0.1"), "127.0.0.1");
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn second_file_backed_owner_gets_metadata_diagnostic() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("snapback.db");
        let mut first = DatabaseInstanceLock::acquire(&db_path).expect("first lock");
        first
            .record_server("127.0.0.1", 4290)
            .expect("record server");

        let error = DatabaseInstanceLock::acquire(&db_path).expect_err("second lock fails");
        let message = error.to_string();

        assert!(first.lock_path().exists());
        assert!(message.contains("already owned by another local server"));
        assert!(message.contains("http://127.0.0.1:4290"));
        assert!(message.contains("pass --memory"));
    }
}
