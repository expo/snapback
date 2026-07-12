//! Owner-only local capability-file I/O.
//!
//! Security-sensitive files must be validated through their opened file
//! descriptor, not by a path check followed by an ordinary open. On Unix this
//! uses `O_NOFOLLOW`, checks the inode is a regular file owned by the effective
//! user, and repairs group/other permissions before any bytes are read.

// @ref LLP 0036#the-store-and-the-target-seam-d1-d2-d7 — persisted capabilities are owner-only and validated through the opened inode.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::Path;

#[cfg(unix)]
fn open_existing(path: &Path, writable: bool) -> io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt as _;

    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(writable);
    options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    let file = options.open(path)?;
    validate_open_file(&file)?;
    repair_owner_only(&file)?;
    Ok(file)
}

#[cfg(unix)]
fn validate_open_file(file: &File) -> io::Result<()> {
    use std::os::unix::fs::MetadataExt as _;

    let metadata = file.metadata()?;
    if !metadata.file_type().is_file() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "secret path is not a regular file",
        ));
    }
    // SAFETY: geteuid has no preconditions and only reads process identity.
    let effective_uid = unsafe { libc::geteuid() };
    if metadata.uid() != effective_uid {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "secret file is not owned by the effective user",
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn repair_owner_only(file: &File) -> io::Result<()> {
    use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

    let metadata = file.metadata()?;
    if metadata.mode() & 0o077 != 0 || metadata.mode() & 0o700 != 0o600 {
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn open_existing(_path: &Path, _writable: bool) -> io::Result<File> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "owner-only capability-file ACL validation is not implemented on this host; refusing persistent secret I/O",
    ))
}

/// Read an existing capability file after validating its inode and repairing
/// owner-only protection. Missing files remain `NotFound`.
pub fn read_owner_only(path: &Path) -> io::Result<Vec<u8>> {
    let mut file = open_existing(path, false)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(bytes)
}

/// Replace a capability file's contents without following a link or trusting
/// a pre-created inode. Existing files are validated before truncation.
pub fn write_owner_only(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = match open_existing(path, true) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => create_new_owner_only(path)?,
        Err(error) => return Err(error),
    };
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(unix)]
fn create_new_owner_only(path: &Path) -> io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt as _;

    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)?;
    validate_open_file(&file)?;
    repair_owner_only(&file)?;
    Ok(file)
}

#[cfg(not(unix))]
fn create_new_owner_only(_path: &Path) -> io::Result<File> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "owner-only capability-file ACL creation is not implemented on this host; refusing persistent secret I/O",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn repairs_permissive_existing_file_before_reading() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secret");
        std::fs::write(&path, b"value").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();

        assert_eq!(read_owner_only(&path).unwrap(), b"value");
        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlink_substitution_for_read_and_write() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target");
        let link = dir.path().join("secret");
        std::fs::write(&target, b"do-not-touch").unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();

        assert!(read_owner_only(&link).is_err());
        assert!(write_owner_only(&link, b"replacement").is_err());
        assert_eq!(std::fs::read(target).unwrap(), b"do-not-touch");
    }

    #[cfg(unix)]
    #[test]
    fn accepts_safe_existing_file_and_refuses_non_regular_paths() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let safe = dir.path().join("safe");
        std::fs::write(&safe, b"value").unwrap();
        std::fs::set_permissions(&safe, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(read_owner_only(&safe).unwrap(), b"value");
        assert_eq!(
            std::fs::metadata(&safe).unwrap().permissions().mode() & 0o777,
            0o600
        );

        assert!(read_owner_only(dir.path()).is_err());
        assert!(write_owner_only(dir.path(), b"nope").is_err());
    }

    #[cfg(not(unix))]
    #[test]
    fn unsupported_acl_hosts_fail_closed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secret");
        assert_eq!(
            write_owner_only(&path, b"secret").unwrap_err().kind(),
            io::ErrorKind::Unsupported
        );
    }
}
