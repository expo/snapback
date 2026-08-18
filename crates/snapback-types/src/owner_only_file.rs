//! Dependency-free strict owner-only file primitives shared by contract leaves
//! and the storage kernel.
//!
//! @ref LLP 0036#the-store-and-the-target-seam-d1-d2-d7 — persisted
//! capabilities are opened without following links and validated through the
//! opened inode before secret bytes cross the boundary.

use std::fs::File;
use std::io::{self, Read as _, Write as _};
use std::path::Path;

use zeroize::Zeroize as _;

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
pub fn validate_strict_owner_only_descriptor(file: &File) -> io::Result<()> {
    use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};

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
    if metadata.permissions().mode() & 0o777 != 0o600 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!(
                "secret file mode {:04o} is not exactly owner read/write (0600); \
                 group/other permission bits must be clear",
                metadata.permissions().mode() & 0o7777
            ),
        ));
    }
    if metadata.nlink() != 1 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!(
                "secret file has {} hard links; exactly one is required",
                metadata.nlink()
            ),
        ));
    }
    validate_no_extended_acl_descriptor(file)
}

// @ref LLP 0057#keyring-protocol — strict auth files fail closed on
// ACL-bearing inodes, and unsupported descriptor-level ACL validation never
// exposes bytes.
#[cfg(target_os = "macos")]
pub fn validate_no_extended_acl_descriptor(file: &File) -> io::Result<()> {
    use std::os::fd::AsRawFd as _;

    const ACL_TYPE_EXTENDED: libc::c_int = 0x0000_0100;

    unsafe extern "C" {
        fn acl_get_fd_np(fd: libc::c_int, acl_type: libc::c_int) -> *mut libc::c_void;
        fn acl_free(object: *mut libc::c_void) -> libc::c_int;
    }

    // SAFETY: the file descriptor remains valid for the duration of the call.
    let acl = unsafe { acl_get_fd_np(file.as_raw_fd(), ACL_TYPE_EXTENDED) };
    if acl.is_null() {
        let error = io::Error::last_os_error();
        return match error.raw_os_error() {
            Some(libc::ENOENT) => Ok(()),
            Some(libc::EOPNOTSUPP) => Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "strict owner-only ACL validation is unsupported by this filesystem",
            )),
            _ => Err(error),
        };
    }

    // SAFETY: `acl` was allocated by `acl_get_fd_np` and has not been freed.
    let free_result = unsafe { acl_free(acl) };
    if free_result != 0 {
        return Err(io::Error::last_os_error());
    }
    Err(io::Error::new(
        io::ErrorKind::PermissionDenied,
        "secret file has an extended access ACL",
    ))
}

#[cfg(target_os = "linux")]
pub fn validate_no_extended_acl_descriptor(file: &File) -> io::Result<()> {
    use std::os::fd::AsRawFd as _;

    const POSIX_ACCESS_ACL: &[u8] = b"system.posix_acl_access\0";
    // SAFETY: the descriptor is live, the attribute name is NUL-terminated,
    // and a null buffer with size zero is the documented size probe.
    let result = unsafe {
        libc::fgetxattr(
            file.as_raw_fd(),
            POSIX_ACCESS_ACL.as_ptr().cast(),
            std::ptr::null_mut(),
            0,
        )
    };
    if result >= 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "secret file has an extended access ACL",
        ));
    }

    let error = io::Error::last_os_error();
    match error.raw_os_error() {
        Some(libc::ENODATA) => Ok(()),
        Some(libc::EOPNOTSUPP) => Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "strict owner-only ACL validation is unsupported by this filesystem",
        )),
        _ => Err(error),
    }
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
pub fn validate_no_extended_acl_descriptor(_file: &File) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "strict owner-only ACL validation is not implemented on this Unix host",
    ))
}

#[cfg(unix)]
pub fn read_strict_owner_only(path: &Path, maximum_bytes: usize) -> io::Result<Vec<u8>> {
    use std::os::unix::fs::{MetadataExt as _, OpenOptionsExt as _};

    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)?;
    validate_strict_owner_only_descriptor(&file)?;
    let before = file.metadata()?;
    if before.len() > maximum_bytes as u64 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "secret file exceeds its size limit",
        ));
    }

    let mut bytes = Vec::with_capacity(before.len() as usize);
    if let Err(error) = (&mut file)
        .take(maximum_bytes as u64 + 1)
        .read_to_end(&mut bytes)
    {
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
    if let Err(error) = validate_strict_owner_only_descriptor(&file) {
        bytes.zeroize();
        return Err(error);
    }

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

#[cfg(not(unix))]
pub fn read_strict_owner_only(_path: &Path, _maximum_bytes: usize) -> io::Result<Vec<u8>> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "strict owner-only capability-file validation is not implemented on this host",
    ))
}

#[cfg(unix)]
pub fn write_new_owner_only(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt as _;

    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)?;
    let result = validate_strict_owner_only_descriptor(&file)
        .and_then(|()| file.write_all(bytes))
        .and_then(|()| file.sync_all())
        .and_then(|()| validate_strict_owner_only_descriptor(&file));
    drop(file);
    if result.is_err() {
        // Creation succeeded, so this inode is ours. An AlreadyExists error
        // returns before this point and never removes the preexisting path.
        let _ = std::fs::remove_file(path);
    }
    result
}

/// Replace one strict owner-only capability with freshly written bytes.
///
/// The candidate is fully written and descriptor-validated before the atomic
/// rename. An existing destination must itself be a strict single-link 0600
/// owner file; symlinks, hard links, ACL-bearing files, and non-files refuse
/// without exposing or modifying their contents.
#[cfg(unix)]
pub fn replace_owner_only(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt as _;

    let file_name = path.file_name().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "owner-only replacement path has no file name",
        )
    })?;
    let mut temporary_name = file_name.to_os_string();
    temporary_name.push(format!(".tmp-{}", uuid::Uuid::new_v4().simple()));
    let temporary = path.with_file_name(temporary_name);
    write_new_owner_only(&temporary, bytes)?;
    let result = (|| {
        match std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(path)
        {
            Ok(existing) => validate_strict_owner_only_descriptor(&existing)?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        std::fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

#[cfg(not(unix))]
pub fn replace_owner_only(_path: &Path, _bytes: &[u8]) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "strict owner-only capability replacement is not implemented on this host",
    ))
}

#[cfg(not(unix))]
pub fn write_new_owner_only(_path: &Path, _bytes: &[u8]) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "owner-only capability-file ACL creation is not implemented on this host; refusing persistent secret I/O",
    ))
}
