//! Owner-only local capability-file I/O.
//!
//! Security-sensitive files must be validated through their opened file
//! descriptor, not by a path check followed by an ordinary open. Ordinary
//! capability files repair group/other permission bits before reading. The
//! stricter auth path never repairs: it also requires one link, exact mode
//! `0600`, and proof that the opened inode carries no extended access ACL.

// @ref LLP 0036#the-store-and-the-target-seam-d1-d2-d7 — persisted capabilities are owner-only and validated through the opened inode.

use std::ffi::OsStr;
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

/// Human-readable inode kind for refusal diagnostics. Metadata only — a
/// refused artifact's predicate must be identifiable without exposing bytes.
#[cfg(unix)]
fn file_type_description(file_type: std::fs::FileType) -> &'static str {
    use std::os::unix::fs::FileTypeExt as _;

    if file_type.is_dir() {
        "a directory"
    } else if file_type.is_symlink() {
        "a symbolic link"
    } else if file_type.is_fifo() {
        "a FIFO"
    } else if file_type.is_socket() {
        "a socket"
    } else if file_type.is_block_device() {
        "a block device"
    } else if file_type.is_char_device() {
        "a character device"
    } else {
        "an unrecognized non-regular file"
    }
}

#[cfg(unix)]
fn validate_open_file(file: &File) -> io::Result<()> {
    use std::os::unix::fs::MetadataExt as _;

    let metadata = file.metadata()?;
    if !metadata.file_type().is_file() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!(
                "secret path is {}, not a regular file",
                file_type_description(metadata.file_type())
            ),
        ));
    }
    // SAFETY: geteuid has no preconditions and only reads process identity.
    let effective_uid = unsafe { libc::geteuid() };
    if metadata.uid() != effective_uid {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!(
                "secret file is owned by uid {}, not the effective uid {effective_uid}",
                metadata.uid()
            ),
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn validate_open_file_strict(file: &File) -> io::Result<()> {
    crate::owner_only_file::validate_strict_owner_only_descriptor(file)
}

/// Validate an already-open auth-sensitive file descriptor without reopening
/// a mutable pathname. Descriptor-relative staging/publication uses this after
/// `openat` so type, owner, exact mode, link count, and extended ACL policy are
/// all checked on the inode that will be published.
#[cfg(unix)]
pub fn validate_strict_owner_only_descriptor(file: &File) -> io::Result<()> {
    crate::owner_only_file::validate_strict_owner_only_descriptor(file)
}

#[cfg(unix)]
fn validate_no_extended_acl(file: &File) -> io::Result<()> {
    crate::owner_only_file::validate_no_extended_acl_descriptor(file)
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
pub fn validate_and_repair_owner_only(file: &File) -> io::Result<()> {
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
pub fn read_strict_owner_only(path: &Path, maximum_bytes: usize) -> io::Result<Vec<u8>> {
    crate::owner_only_file::read_strict_owner_only(path, maximum_bytes)
}

/// Open a strict owner-only regular file without following symlinks or
/// accepting hardlinks. Callers that must stream a large secret-bearing
/// artifact use the validated descriptor rather than reopening its path.
#[cfg(unix)]
pub fn open_strict_owner_only(path: &Path) -> io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt as _;

    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)?;
    validate_open_file_strict(&file)?;
    Ok(file)
}

/// Read an operator-selected executable artifact through one pinned inode.
///
/// Startup manifests are not credentials, so they may be group/world-readable,
/// but another principal must not be able to replace or modify the authority
/// they carry. The opened object must therefore be a single-link regular file
/// owned by the effective user, have no group/other write bit or extended ACL,
/// and remain the path's exact inode and size through the bounded read.
// @ref LLP 0058#cold-startup-artifact-carrier — executable deployment authority is read once through a stable, non-writable inode.
#[cfg(unix)]
pub fn read_trusted_executable_artifact(
    path: &Path,
    maximum_bytes: usize,
) -> io::Result<Vec<u8>> {
    use std::os::unix::fs::{MetadataExt as _, OpenOptionsExt as _};

    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)?;
    validate_trusted_executable_descriptor(&file)?;
    let before = file.metadata()?;
    if before.len() > maximum_bytes as u64 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "executable artifact exceeds its size limit",
        ));
    }

    let mut bytes = Vec::with_capacity(before.len() as usize);
    (&mut file)
        .take(maximum_bytes as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > maximum_bytes {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "executable artifact exceeds its size limit",
        ));
    }

    validate_trusted_executable_descriptor(&file)?;
    let after = file.metadata()?;
    let current = std::fs::symlink_metadata(path)?;
    if !current.file_type().is_file()
        || current.dev() != before.dev()
        || current.ino() != before.ino()
        || after.dev() != before.dev()
        || after.ino() != before.ino()
        || after.len() != before.len()
        || bytes.len() as u64 != before.len()
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "executable artifact changed while it was being read",
        ));
    }
    Ok(bytes)
}

#[cfg(unix)]
fn validate_trusted_executable_descriptor(file: &File) -> io::Result<()> {
    use std::os::unix::fs::MetadataExt as _;

    let metadata = file.metadata()?;
    if !metadata.file_type().is_file() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!(
                "executable artifact is {}, not a regular file",
                file_type_description(metadata.file_type())
            ),
        ));
    }
    // SAFETY: geteuid has no preconditions and reads process identity only.
    let effective_uid = unsafe { libc::geteuid() };
    if metadata.uid() != effective_uid {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!(
                "executable artifact is owned by uid {}, not the effective uid {effective_uid}",
                metadata.uid()
            ),
        ));
    }
    if metadata.mode() & 0o022 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!(
                "executable artifact mode {:04o} grants group or other write; \
                 those bits must be clear",
                metadata.mode() & 0o7777
            ),
        ));
    }
    if metadata.nlink() != 1 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!(
                "executable artifact has {} hard links; exactly one is required",
                metadata.nlink()
            ),
        ));
    }
    // Conservatively reject every persisted access ACL. That is stronger than
    // attempting to interpret platform-specific write grants and prevents an
    // unrecognized ACL form from becoming executable authority.
    validate_no_extended_acl(file)
}

#[cfg(not(unix))]
pub fn open_strict_owner_only(_path: &Path) -> io::Result<File> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "strict owner-only capability-file validation is not implemented on this host",
    ))
}

#[cfg(not(unix))]
pub fn read_trusted_executable_artifact(
    _path: &Path,
    _maximum_bytes: usize,
) -> io::Result<Vec<u8>> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "trusted executable-artifact validation is not implemented on this host",
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
pub fn write_new_owner_only(path: &Path, bytes: &[u8]) -> io::Result<()> {
    crate::owner_only_file::write_new_owner_only(path, bytes)
}

/// Copy a potentially large validated artifact to a brand-new owner-only file
/// without buffering its secret-bearing contents in memory.
#[allow(dead_code)] // Consumed by the physical auth-restore integration lane.
pub fn copy_new_owner_only(source: &mut File, path: &Path) -> io::Result<u64> {
    source.seek(SeekFrom::Start(0))?;
    let mut copied = 0;
    write_new_owner_only_with(path, |destination| {
        copied = io::copy(source, destination)?;
        destination.sync_all()
    })?;
    Ok(copied)
}

fn write_new_owner_only_with(
    path: &Path,
    write: impl FnOnce(&mut File) -> io::Result<()>,
) -> io::Result<()> {
    let mut file = create_new_owner_only(path)?;
    // Strict publications reject inherited ACLs before any secret bytes are
    // written, then revalidate the same descriptor after the complete fsynced
    // candidate has been produced. Ordinary `write_owner_only` intentionally
    // keeps its separate repair-in-place compatibility contract.
    #[cfg(unix)]
    let initial_validation = validate_open_file_strict(&file);
    #[cfg(not(unix))]
    let initial_validation: io::Result<()> = Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "strict owner-only capability-file validation is not implemented on this host",
    ));
    let result = initial_validation
        .and_then(|()| write(&mut file))
        .and_then(|()| {
            #[cfg(unix)]
            {
                validate_open_file_strict(&file)
            }
            #[cfg(not(unix))]
            {
                Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    "strict owner-only capability-file validation is not implemented on this host",
                ))
            }
        });
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
pub fn rename_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
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
pub fn rename_no_replace(source: &Path, destination: &Path) -> io::Result<()> {
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
pub fn rename_no_replace(_source: &Path, _destination: &Path) -> io::Result<()> {
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
pub fn rename_no_replace_in_directory(
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
pub fn rename_no_replace_in_directory(
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
pub fn rename_no_replace_in_directory(
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

pub fn sync_parent(path: &Path) -> io::Result<()> {
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

    #[cfg(target_os = "macos")]
    fn add_extended_acl(path: &Path, entry: &str) {
        let status = std::process::Command::new("chmod")
            .arg("+a")
            .arg(entry)
            .arg(path)
            .status()
            .unwrap();
        assert!(status.success(), "chmod failed to install a test ACL");
    }

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
    fn trusted_executable_artifact_accepts_readable_but_non_writable_file() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("deployment.json");
        std::fs::write(&path, br#"{"formatVersion":1}"#).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();

        assert_eq!(
            read_trusted_executable_artifact(&path, 1_024).unwrap(),
            br#"{"formatVersion":1}"#
        );
    }

    #[cfg(unix)]
    #[test]
    fn trusted_executable_artifact_refuses_writable_link_or_oversize_input() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("deployment.json");
        std::fs::write(&path, b"authority").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o664)).unwrap();
        assert_eq!(
            read_trusted_executable_artifact(&path, 1_024)
                .unwrap_err()
                .kind(),
            io::ErrorKind::PermissionDenied
        );

        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(
            read_trusted_executable_artifact(&path, 4)
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidData
        );

        let link = dir.path().join("deployment-link.json");
        std::os::unix::fs::symlink(&path, &link).unwrap();
        assert!(read_trusted_executable_artifact(&link, 1_024).is_err());

        let hardlink = dir.path().join("deployment-hardlink.json");
        std::fs::hard_link(&path, &hardlink).unwrap();
        assert_eq!(
            read_trusted_executable_artifact(&path, 1_024)
                .unwrap_err()
                .kind(),
            io::ErrorKind::PermissionDenied
        );
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

    #[cfg(target_os = "macos")]
    #[test]
    fn strict_read_rejects_mode_0600_file_with_extended_acl() {
        use std::os::unix::fs::PermissionsExt as _;

        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("strict-secret");
        std::fs::write(&path, b"acl-secret-sentinel").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        add_extended_acl(&path, "everyone allow read");

        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            open_strict_owner_only(&path).unwrap_err().kind(),
            io::ErrorKind::PermissionDenied
        );
        assert_eq!(
            read_strict_owner_only(&path, 64).unwrap_err().kind(),
            io::ErrorKind::PermissionDenied
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn strict_publication_rejects_inherited_acl_before_writing() {
        use std::cell::Cell;

        let directory = tempfile::tempdir().unwrap();
        add_extended_acl(directory.path(), "everyone allow read,file_inherit");
        let path = directory.path().join("strict-secret");
        let writer_ran = Cell::new(false);

        let error = write_new_owner_only_with(&path, |_| {
            writer_ran.set(true);
            Ok(())
        })
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        assert!(!writer_ran.get());
        assert!(!path.exists());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn strict_publication_revalidates_acl_after_writing() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("strict-secret");

        let error = write_new_owner_only_with(&path, |file| {
            file.write_all(b"acl-publication-sentinel")?;
            file.sync_all()?;
            add_extended_acl(&path, "everyone allow read");
            Ok(())
        })
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        assert!(!path.exists());
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
