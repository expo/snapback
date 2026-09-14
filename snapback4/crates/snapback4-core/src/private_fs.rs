//! Owner-only persistence, independent of the launching shell's umask.
//! Unix is the supported storage host; other targets fail closed until an
//! owner-only ACL implementation exists.
use std::fs::{self, File, OpenOptions};
use std::io;
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;

pub fn directory(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        fs::DirBuilder::new().recursive(true).mode(0o700).create(path)?;
        let meta = fs::symlink_metadata(path)?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err(io::Error::other("private data directory must be a real directory"));
        }
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Err(io::Error::other("owner-only storage ACLs are not implemented on this host"))
    }
}

/// Create atomically with mode 0600. `new` forbids replacing an upload;
/// otherwise tighten an existing regular file before opening the store.
pub fn file(path: &Path, new: bool) -> io::Result<File> {
    #[cfg(unix)]
    {
        if let Ok(meta) = fs::symlink_metadata(path) {
            if !meta.is_file() || meta.file_type().is_symlink() {
                return Err(io::Error::other("private data file must be a regular file"));
            }
        }
        let mut options = OpenOptions::new();
        options.read(true).write(true).mode(0o600);
        if new {
            options.create_new(true);
        } else {
            options.create(true);
        }
        let opened = options.open(path)?;
        opened.set_permissions(fs::Permissions::from_mode(0o600))?;
        Ok(opened)
    }
    #[cfg(not(unix))]
    {
        let _ = (path, new);
        Err(io::Error::other("owner-only storage ACLs are not implemented on this host"))
    }
}

pub fn existing_file(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            if !meta.is_file() || meta.file_type().is_symlink() {
                return Err(io::Error::other("private data file must be a regular file"));
            }
            #[cfg(unix)]
            { fs::set_permissions(path, fs::Permissions::from_mode(0o600)) }
            #[cfg(not(unix))]
            { Err(io::Error::other("owner-only storage ACLs are not implemented on this host")) }
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

// @ref LLP 3000.007#8 — item 12: closing a raw descriptor drops the process's SQLite locks, including the WAL dead-man lock.
// Tighten existing files by path, without open/close. Another SQLite opener
// may otherwise truncate shared memory still mapped by this process (SIGBUS).
pub fn database_file(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(_) => existing_file(path),
        Err(e) if e.kind() == io::ErrorKind::NotFound => match file(path, true) {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => existing_file(path),
            Err(e) => Err(e),
        },
        Err(e) => Err(e),
    }
}
