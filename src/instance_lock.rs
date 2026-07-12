//! Local app-instance ownership locks.
//!
//! A file-backed local server owns both the SQLite database and process-local
//! runtime state. The sidecar lock prevents two server processes from appearing
//! as separate instances while mutating the same database.

use anyhow::{Context, anyhow};
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs::File;
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

        let mut file = platform::open_lock_file(&lock_path).with_context(|| {
            format!(
                "failed to open a safe Snapback database lock {}",
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
    use std::fs::{File, OpenOptions};
    use std::io;
    use std::os::fd::AsRawFd;
    use std::os::raw::c_int;
    use std::os::unix::fs::{MetadataExt as _, OpenOptionsExt as _, PermissionsExt as _};
    use std::path::Path;

    const LOCK_EX: c_int = 2;
    const LOCK_NB: c_int = 4;
    const LOCK_UN: c_int = 8;

    unsafe extern "C" {
        fn flock(fd: c_int, operation: c_int) -> c_int;
    }

    pub fn open_lock_file(path: &Path) -> io::Result<File> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(path)?;
        validate_lock_file(&file, effective_uid())?;
        let metadata = file.metadata()?;
        if metadata.mode() & 0o777 != 0o600 {
            file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(file)
    }

    fn effective_uid() -> u32 {
        // SAFETY: geteuid has no preconditions and only reads process identity.
        unsafe { libc::geteuid() }
    }

    fn validate_lock_file(file: &File, expected_uid: u32) -> io::Result<()> {
        let metadata = file.metadata()?;
        if !metadata.file_type().is_file() {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "database lock path is not a regular file",
            ));
        }
        if metadata.uid() != expected_uid {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "database lock file is not owned by the effective user",
            ));
        }
        Ok(())
    }

    #[cfg(test)]
    pub(super) fn validate_for_effective_uid(file: &File, expected_uid: u32) -> io::Result<()> {
        validate_lock_file(file, expected_uid)
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
    use std::fs::{File, OpenOptions};
    use std::io;
    use std::mem::{size_of, zeroed};
    use std::os::windows::fs::OpenOptionsExt as _;
    use std::os::windows::io::AsRawHandle;
    use std::path::Path;
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::{
        CloseHandle, ERROR_SUCCESS, GENERIC_READ, GENERIC_WRITE, HANDLE, LocalFree,
    };
    use windows_sys::Win32::Security::Authorization::{
        GetSecurityInfo, SE_FILE_OBJECT, SetSecurityInfo,
    };
    use windows_sys::Win32::Security::{
        ACCESS_ALLOWED_ACE, ACL, ACL_REVISION, AddAccessAllowedAceEx, DACL_SECURITY_INFORMATION,
        EqualSid, GetLengthSid, GetTokenInformation, InitializeAcl, OWNER_SECURITY_INFORMATION,
        PROTECTED_DACL_SECURITY_INFORMATION, PSID, TOKEN_QUERY, TOKEN_USER, TokenUser,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ALL_ACCESS, FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_TAG_INFO,
        FILE_FLAG_OPEN_REPARSE_POINT, FileAttributeTagInfo, GetFileInformationByHandleEx,
        READ_CONTROL, WRITE_DAC,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

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

    struct OwnedHandle(HANDLE);

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: the handle was returned by OpenProcessToken and is
                // owned by this guard.
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
    }

    pub fn open_lock_file(path: &Path) -> io::Result<File> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .access_mode(GENERIC_READ | GENERIC_WRITE | READ_CONTROL | WRITE_DAC)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?;
        validate_windows_file(&file)?;
        validate_owner_and_repair_acl(&file)?;
        Ok(file)
    }

    fn validate_windows_file(file: &File) -> io::Result<()> {
        if !file.metadata()?.file_type().is_file() {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "database lock path is not a regular file",
            ));
        }
        let mut tag: FILE_ATTRIBUTE_TAG_INFO = unsafe { zeroed() };
        // SAFETY: the file handle is live and `tag` points to a correctly
        // sized writable FILE_ATTRIBUTE_TAG_INFO value.
        let ok = unsafe {
            GetFileInformationByHandleEx(
                file.as_raw_handle() as HANDLE,
                FileAttributeTagInfo,
                (&mut tag as *mut FILE_ATTRIBUTE_TAG_INFO).cast(),
                size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        if tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "database lock path is a reparse point",
            ));
        }
        Ok(())
    }

    fn validate_owner_and_repair_acl(file: &File) -> io::Result<()> {
        let mut token = null_mut();
        // SAFETY: GetCurrentProcess returns a pseudo-handle valid for this
        // call; `token` receives an owned process-token handle.
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let _token = OwnedHandle(token);

        let mut required = 0_u32;
        // The sizing call is expected to fail with an insufficient-buffer
        // status while populating `required`.
        unsafe {
            GetTokenInformation(token, TokenUser, null_mut(), 0, &mut required);
        }
        if required == 0 {
            return Err(io::Error::last_os_error());
        }
        let word = size_of::<usize>();
        let mut token_words = vec![0_usize; (required as usize).div_ceil(word)];
        // SAFETY: the aligned buffer holds at least `required` writable bytes.
        if unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                token_words.as_mut_ptr().cast(),
                required,
                &mut required,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: a successful TokenUser query returned a TOKEN_USER at the
        // start of the aligned buffer; its SID remains valid while the buffer
        // is alive.
        let user_sid = unsafe { (*(token_words.as_ptr() as *const TOKEN_USER)).User.Sid };
        if user_sid.is_null() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "current process token did not contain a user SID",
            ));
        }

        let mut owner_sid: PSID = null_mut();
        let mut security_descriptor = null_mut();
        // SAFETY: the file handle is live and the optional output pointers not
        // requested by this owner-only query are null.
        let status = unsafe {
            GetSecurityInfo(
                file.as_raw_handle() as HANDLE,
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION,
                &mut owner_sid,
                null_mut(),
                null_mut(),
                null_mut(),
                &mut security_descriptor,
            )
        };
        if status != ERROR_SUCCESS {
            return Err(io::Error::from_raw_os_error(status as i32));
        }
        if owner_sid.is_null() {
            // SAFETY: GetSecurityInfo allocated the descriptor with LocalAlloc.
            unsafe {
                LocalFree(security_descriptor);
            }
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "database lock file does not have an owner SID",
            ));
        }
        // SAFETY: both SIDs were returned by successful Windows security API
        // calls and remain live until the descriptor/buffer is released.
        let owner_matches = unsafe { EqualSid(owner_sid, user_sid) } != 0;
        // SAFETY: GetSecurityInfo allocated the descriptor with LocalAlloc.
        unsafe {
            LocalFree(security_descriptor);
        }
        if !owner_matches {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "database lock file is not owned by the effective user",
            ));
        }

        // SAFETY: user_sid came from the successful TokenUser query and is
        // still backed by token_words.
        let sid_bytes = unsafe { GetLengthSid(user_sid) as usize };
        let acl_bytes =
            size_of::<ACL>() + size_of::<ACCESS_ALLOWED_ACE>() - size_of::<u32>() + sid_bytes;
        let mut acl_storage = vec![0_u32; acl_bytes.div_ceil(size_of::<u32>())];
        let acl = acl_storage.as_mut_ptr().cast::<ACL>();
        // SAFETY: `acl_storage` is aligned and large enough for one full-access
        // ACE containing the current user SID.
        if unsafe { InitializeAcl(acl, acl_bytes as u32, ACL_REVISION) } == 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: the initialized ACL has capacity for this ACE and user_sid
        // remains valid in token_words.
        if unsafe { AddAccessAllowedAceEx(acl, ACL_REVISION, 0, FILE_ALL_ACCESS, user_sid) } == 0 {
            return Err(io::Error::last_os_error());
        }
        // Protect the DACL from inheritance and reduce it to the effective
        // user's full-control ACE, the Windows equivalent of Unix mode 0600.
        // SAFETY: `acl` is initialized and remains backed by acl_storage; the
        // file handle is live and all unrequested security fields are null.
        let status = unsafe {
            SetSecurityInfo(
                file.as_raw_handle() as HANDLE,
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                acl,
                null_mut(),
            )
        };
        if status != ERROR_SUCCESS {
            return Err(io::Error::from_raw_os_error(status as i32));
        }
        Ok(())
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
    use std::path::Path;

    pub fn open_lock_file(_path: &Path) -> io::Result<File> {
        Err(io::Error::new(
            ErrorKind::Unsupported,
            "safe database instance-lock files are not supported on this platform",
        ))
    }

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

    #[cfg(unix)]
    #[test]
    fn refuses_symlink_and_non_regular_lock_paths_without_touching_targets() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("snapback.db");
        let lock_path = lock_path_for_database(&db_path).expect("lock path");
        let target = dir.path().join("must-survive");
        std::fs::write(&target, b"must-survive").expect("target fixture");
        std::os::unix::fs::symlink(&target, &lock_path).expect("symlink fixture");

        let error = DatabaseInstanceLock::acquire(&db_path).expect_err("symlink must fail");
        assert!(error.to_string().contains("safe Snapback database lock"));
        assert_eq!(
            std::fs::read(&target).expect("target bytes"),
            b"must-survive"
        );

        std::fs::remove_file(&lock_path).expect("remove symlink");
        std::fs::create_dir(&lock_path).expect("directory fixture");
        DatabaseInstanceLock::acquire(&db_path).expect_err("non-regular path must fail");
    }

    #[cfg(unix)]
    #[test]
    fn safe_existing_lock_is_owner_only_and_wrong_owner_is_rejected() {
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("snapback.db");
        let lock_path = lock_path_for_database(&db_path).expect("lock path");
        std::fs::write(&lock_path, b"stale metadata").expect("existing lock fixture");
        std::fs::set_permissions(&lock_path, std::fs::Permissions::from_mode(0o666))
            .expect("permissive fixture");

        let lock = DatabaseInstanceLock::acquire(&db_path).expect("safe existing lock");
        let metadata = std::fs::metadata(&lock_path).expect("lock metadata");
        assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
        let owner = metadata.uid();
        let wrong_owner = owner.wrapping_add(1);
        assert!(
            super::platform::validate_for_effective_uid(&lock.file, wrong_owner).is_err(),
            "an opened inode owned by another identity must fail closed"
        );
    }
}
