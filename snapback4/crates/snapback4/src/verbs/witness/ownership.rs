//! @ref LLP 3000.030#13 — simulator creation evidence must remain under this user's custody.
use super::*;
use std::{ffi::CString, io, os::{fd::{AsRawFd, FromRawFd}, unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt}}};

fn trusted(metadata: &fs::Metadata, uid: u32) -> bool {
    metadata.uid() == uid && metadata.mode() & 0o022 == 0
}

fn directory(path: &Path) -> io::Result<File> {
    let file = OpenOptions::new().read(true).custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW).open(path)?;
    if !trusted(&file.metadata()?, unsafe { libc::geteuid() }) {
        return Err(io::Error::new(io::ErrorKind::PermissionDenied, "ownership directory must belong to the current user and not be writable by others"));
    }
    Ok(file)
}

// Keep the verified directory open. Record reads and exclusive writes are
// relative to that handle, never a second traversal of an untrusted path.
pub(super) struct Records { path: PathBuf, directory: Option<File>, warned: bool }
impl Records {
    pub(super) fn open(path: PathBuf) -> Self {
        let mut records = Self { path, directory: None, warned: false };
        match directory(&records.path) {
            Ok(file) => records.directory = Some(file),
            Err(e) if e.kind() == io::ErrorKind::NotFound => {},
            Err(_) => records.warn(),
        }
        records
    }
    fn warn(&mut self) {
        if !self.warned {
            eprintln!("witness: warning: ignoring unsafe simulator ownership records; records and their directory must belong to the current user, must not be symlinks, and must not be writable by others ({})", self.path.display());
            self.warned = true;
        }
    }
    fn file(&self, udid: &str, flags: i32) -> io::Result<File> {
        let directory = self.directory.as_ref().ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no trusted simulator ownership directory"))?;
        // Recheck permissions on the same directory handle before using it.
        if !trusted(&directory.metadata()?, unsafe { libc::geteuid() }) {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "unsafe simulator ownership directory"));
        }
        let name = CString::new(format!("{udid}.json")).map_err(io::Error::other)?;
        let fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK, 0o600) };
        if fd == -1 { return Err(io::Error::last_os_error()); }
        Ok(unsafe { File::from_raw_fd(fd) })
    }
    pub(super) fn read(&mut self, udid: &str) -> Value {
        if self.directory.is_none() { return Value::Null; }
        let read = (|| -> io::Result<Value> {
            let mut file = self.file(udid, libc::O_RDONLY)?;
            let metadata = file.metadata()?;
            if !metadata.is_file() || !trusted(&metadata, unsafe { libc::geteuid() }) {
                return Err(io::Error::new(io::ErrorKind::PermissionDenied, "unsafe simulator ownership record"));
            }
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes)?;
            Ok(serde_json::from_slice(&bytes).unwrap_or(Value::Null))
        })();
        match read {
            Ok(value) => value,
            Err(e) if e.kind() == io::ErrorKind::NotFound => Value::Null,
            Err(_) => { self.warn(); Value::Null },
        }
    }
    pub(super) fn prepare(&mut self) -> Result<()> {
        if self.directory.is_none() {
            fs::DirBuilder::new().recursive(true).mode(0o700).create(&self.path)
                .map_err(|e| error("E_WITNESS_SIMULATOR", e))?;
            self.directory = Some(directory(&self.path).map_err(|e| error("E_WITNESS_SIMULATOR", e))?);
        }
        Ok(())
    }
    pub(super) fn remove(&self, udid: &str) -> Result<()> {
        let directory = self.directory.as_ref().unwrap();
        let name = CString::new(format!("{udid}.json")).unwrap();
        if unsafe { libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), 0) } != 0 {
            return Err(error("E_WITNESS_SIMULATOR", std::io::Error::last_os_error()));
        }
        Ok(())
    }
    pub(super) fn write(&self, udid: &str, selected: &Value) -> Result<()> {
        let mut file = self.file(udid, libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL)
            .map_err(|e| error("E_WITNESS_SIMULATOR", e))?;
        file.write_all(&serde_json::to_vec(selected).unwrap()).and_then(|_| file.sync_all())
            .map_err(|e| error("E_WITNESS_SIMULATOR", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ownership_predicate_requires_the_current_uid() {
        // Cargo's executable can be group-writable on a shared build host.
        // Supply a private fixture so the positive control isolates the UID.
        let path = std::env::temp_dir().join(format!("sb4-owner-uid-{}", std::process::id()));
        let file = OpenOptions::new().write(true).create_new(true).mode(0o600).open(&path).unwrap();
        let metadata = file.metadata().unwrap();
        fs::remove_file(path).unwrap();
        assert!(trusted(&metadata, metadata.uid()));
        assert!(!trusted(&metadata, metadata.uid().wrapping_add(1)));
    }
}
