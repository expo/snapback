//! Owner-only local capability-file I/O.
//!
//! Security-sensitive files must be validated through their opened file
//! descriptor, not by a path check followed by an ordinary open. On Unix this
//! uses `O_NOFOLLOW`, checks the inode is a regular file owned by the effective
//! user, and repairs group/other permissions before any bytes are read.

// @ref LLP 0036#the-store-and-the-target-seam-d1-d2-d7 — persisted capabilities are owner-only and validated through the opened inode.

use std::ffi::OsStr;
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::Path;

use zeroize::Zeroize as _;

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
fn validate_open_file_strict(file: &File) -> io::Result<()> {
    use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

    validate_open_file(file)?;
    let metadata = file.metadata()?;
    if metadata.permissions().mode() & 0o777 != 0o600 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "secret file mode is not exactly owner read/write",
        ));
    }
    if metadata.nlink() != 1 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "secret file must have exactly one hard link",
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

#[cfg(unix)]
pub(crate) fn validate_and_repair_owner_only(file: &File) -> io::Result<()> {
    validate_open_file(file)?;
    repair_owner_only(file)
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

/// Read an owner-only capability file under stricter auth-keyring rules.
///
/// Unlike [`read_owner_only`], this never repairs permissions: mode, owner,
/// regular-file status, link count, and size must already be valid before a
/// byte is exposed. The path must still name the opened inode after the read.
#[cfg(unix)]
pub(crate) fn read_strict_owner_only(path: &Path, maximum_bytes: usize) -> io::Result<Vec<u8>> {
    use std::os::unix::fs::MetadataExt as _;

    let file = open_strict_owner_only(path)?;
    let before = file.metadata()?;
    if before.len() > maximum_bytes as u64 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "secret file exceeds its size limit",
        ));
    }

    let mut bytes = Vec::with_capacity(before.len() as usize);
    if let Err(error) = file.take(maximum_bytes as u64 + 1).read_to_end(&mut bytes) {
        bytes.zeroize();
        return Err(error);
    }
    if bytes.len() > maximum_bytes {
        bytes.zeroize();
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "secret file exceeds its size limit",
        ));
    }

    // Re-open-free path verification closes the ordinary path-check/open race
    // in the other direction: replacement during the read is refused rather
    // than allowing this operation to keep using a stale cached inode.
    let current = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) => {
            bytes.zeroize();
            return Err(error);
        }
    };
    if !current.file_type().is_file()
        || current.dev() != before.dev()
        || current.ino() != before.ino()
    {
        bytes.zeroize();
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "secret path changed while it was being read",
        ));
    }
    let after = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) => {
            bytes.zeroize();
            return Err(error);
        }
    };
    // SAFETY: geteuid has no preconditions and reads process identity only.
    let effective_uid = unsafe { libc::geteuid() };
    if after.len() != bytes.len() as u64
        || after.nlink() != 1
        || after.uid() != effective_uid
        || after.mode() & 0o777 != 0o600
    {
        bytes.zeroize();
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "secret file changed while it was being read",
        ));
    }
    Ok(bytes)
}

/// Open a strict owner-only regular file without following symlinks or
/// accepting hardlinks. Callers that must stream a large secret-bearing
/// artifact use the validated descriptor rather than reopening its path.
#[cfg(unix)]
pub(crate) fn open_strict_owner_only(path: &Path) -> io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt as _;

    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)?;
    validate_open_file_strict(&file)?;
    Ok(file)
}

#[cfg(not(unix))]
pub(crate) fn read_strict_owner_only(_path: &Path, _maximum_bytes: usize) -> io::Result<Vec<u8>> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "strict owner-only capability-file validation is not implemented on this host",
    ))
}

#[cfg(not(unix))]
pub(crate) fn open_strict_owner_only(_path: &Path) -> io::Result<File> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "strict owner-only capability-file validation is not implemented on this host",
    ))
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

/// Create a brand-new owner-only file and write it without ever accepting an
/// existing inode. Atomic-publication temporary files use this variant: an
/// attacker who pre-creates or races a hardlink at the candidate path gets
/// `AlreadyExists`, never a truncation of the linked target.
pub(crate) fn write_new_owner_only(path: &Path, bytes: &[u8]) -> io::Result<()> {
    write_new_owner_only_with(path, |file| {
        file.write_all(bytes)?;
        file.sync_all()?;
        #[cfg(unix)]
        validate_open_file_strict(file)?;
        Ok(())
    })
}

/// Copy a potentially large validated artifact to a brand-new owner-only file
/// without buffering its secret-bearing contents in memory.
#[allow(dead_code)] // Consumed by the physical auth-restore integration lane.
pub(crate) fn copy_new_owner_only(source: &mut File, path: &Path) -> io::Result<u64> {
    source.seek(SeekFrom::Start(0))?;
    let mut copied = 0;
    write_new_owner_only_with(path, |destination| {
        copied = io::copy(source, destination)?;
        destination.sync_all()?;
        #[cfg(unix)]
        validate_open_file_strict(destination)?;
        Ok(())
    })?;
    Ok(copied)
}

fn write_new_owner_only_with(
    path: &Path,
    write: impl FnOnce(&mut File) -> io::Result<()>,
) -> io::Result<()> {
    let mut file = create_new_owner_only(path)?;
    let result = write(&mut file);
    drop(file);
    if result.is_err() {
        // Creation succeeded, so this inode is ours. An AlreadyExists error
        // returns before this block and never removes the preexisting path.
        let _ = std::fs::remove_file(path);
    }
    result
}

/// Atomically install `source` at an absent `destination` without overwriting
/// a file that appeared after the caller's read. Both paths must share a
/// directory/filesystem.
#[cfg(target_vendor = "apple")]
pub(crate) fn rename_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt as _;

    let source = CString::new(source.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "source path contains NUL"))?;
    let destination = CString::new(destination.as_os_str().as_bytes()).map_err(|_| {
        io::Error::new(io::ErrorKind::InvalidInput, "destination path contains NUL")
    })?;
    // SAFETY: the C strings are NUL-terminated and valid for the duration of
    // the call; renamex_np retains neither pointer.
    let result =
        unsafe { libc::renamex_np(source.as_ptr(), destination.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn rename_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt as _;

    let source = CString::new(source.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "source path contains NUL"))?;
    let destination = CString::new(destination.as_os_str().as_bytes()).map_err(|_| {
        io::Error::new(io::ErrorKind::InvalidInput, "destination path contains NUL")
    })?;
    // SAFETY: valid C strings are passed to the OS and retained by neither
    // side. AT_FDCWD makes each same-directory path resolve normally.
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            destination.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
pub(crate) fn rename_no_replace(_source: &Path, _destination: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "atomic no-replace publication is not implemented on this host",
    ))
}

/// Atomically rename two direct children of an already-open directory without
/// replacement. Pinning the parent descriptor prevents a path swap from
/// redirecting final artifact publication after staging.
#[cfg(target_vendor = "apple")]
#[allow(dead_code)] // Consumed by descriptor-pinned auth artifact publication.
pub(crate) fn rename_no_replace_in_directory(
    directory: &File,
    source_name: &OsStr,
    destination_name: &OsStr,
) -> io::Result<()> {
    use std::os::fd::AsRawFd as _;

    let source = direct_child_c_string(source_name)?;
    let destination = direct_child_c_string(destination_name)?;
    // SAFETY: both names are valid NUL-terminated direct children and the
    // directory descriptor remains open for the duration of the call.
    let result = unsafe {
        libc::renameatx_np(
            directory.as_raw_fd(),
            source.as_ptr(),
            directory.as_raw_fd(),
            destination.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
#[allow(dead_code)] // Consumed by descriptor-pinned auth artifact publication.
pub(crate) fn rename_no_replace_in_directory(
    directory: &File,
    source_name: &OsStr,
    destination_name: &OsStr,
) -> io::Result<()> {
    use std::os::fd::AsRawFd as _;

    let source = direct_child_c_string(source_name)?;
    let destination = direct_child_c_string(destination_name)?;
    // SAFETY: both names are valid NUL-terminated direct children and the
    // directory descriptor remains open for the duration of the call.
    let result = unsafe {
        libc::renameat2(
            directory.as_raw_fd(),
            source.as_ptr(),
            directory.as_raw_fd(),
            destination.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(any(target_vendor = "apple", target_os = "linux")))]
#[allow(dead_code)] // Consumed by descriptor-pinned auth artifact publication.
pub(crate) fn rename_no_replace_in_directory(
    _directory: &File,
    _source_name: &OsStr,
    _destination_name: &OsStr,
) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "descriptor-relative no-replace publication is not implemented on this host",
    ))
}

#[cfg(any(target_vendor = "apple", target_os = "linux"))]
#[allow(dead_code)] // Helper for descriptor-pinned auth artifact publication.
fn direct_child_c_string(name: &OsStr) -> io::Result<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt as _;

    let bytes = name.as_bytes();
    if bytes.is_empty() || bytes == b"." || bytes == b".." || bytes.contains(&b'/') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "publication name is not a direct child",
        ));
    }
    std::ffi::CString::new(bytes)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "publication name contains NUL"))
}

pub(crate) fn sync_parent(path: &Path) -> io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    File::open(parent)?.sync_all()
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

    #[cfg(unix)]
    #[test]
    fn create_new_write_refuses_a_precreated_hardlink_without_truncating_it() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("managed-artifact");
        let candidate = dir.path().join("publication-temp");
        std::fs::write(&target, b"do-not-touch").unwrap();
        std::fs::hard_link(&target, &candidate).unwrap();

        let error = write_new_owner_only(&candidate, b"replacement").unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read(target).unwrap(), b"do-not-touch");
    }

    #[cfg(unix)]
    #[test]
    fn create_new_write_removes_its_partial_file_on_post_create_failure() {
        let dir = tempfile::tempdir().unwrap();
        let candidate = dir.path().join("publication-temp");
        let error = write_new_owner_only_with(&candidate, |file| {
            file.write_all(b"partial-secret")?;
            Err(io::Error::other("injected fsync failure"))
        })
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::Other);
        assert!(!candidate.exists());
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
