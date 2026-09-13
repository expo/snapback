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
        Ok(_) => file(path, false).map(drop),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}
