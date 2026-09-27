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

// @ref LLP 3000.019#3.4 — ownership flocks belong beside SQLite, never on its database inode.
#[cfg(unix)]
pub fn owner_path(database: &Path) -> std::path::PathBuf {
    let mut name = database.as_os_str().to_owned();
    name.push("-owner");
    name.into()
}

/// Stat only: opening and closing a hard-linked database loses SQLite locks.
#[cfg(unix)]
pub fn database_metadata(database: &Path) -> io::Result<Option<fs::Metadata>> {
    use std::os::unix::fs::MetadataExt;
    match fs::symlink_metadata(database) {
        Ok(meta) if !meta.is_file() => Err(io::Error::other("database must be a regular file")),
        Ok(meta) if meta.nlink() != 1 => Err(io::Error::other("database has hard links; copy the store, do not hard-link it")),
        Ok(meta) => Ok(Some(meta)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

#[cfg(unix)]
pub fn owner_file(database: &Path) -> io::Result<File> {
    auxiliary_file(database, &owner_path(database), true, 0)
}

// @ref LLP 3000.019#3.4 — preflight aliases; an ambiguous descriptor must leak rather than close SQLite's POSIX locks.
/// Ownership files are empty; address records fit in 128 bytes. The size
/// bound also rejects a database renamed here after its original name vanished.
#[cfg(unix)]
pub fn auxiliary_file(database: &Path, path: &Path, create: bool, max_len: u64) -> io::Result<File> {
    let before = match fs::symlink_metadata(database) {
        Ok(meta) => Some(meta),
        Err(e) if e.kind() == io::ErrorKind::NotFound => None,
        Err(e) => return Err(e),
    };
    match fs::symlink_metadata(path) {
        Ok(meta) => auxiliary_metadata(&meta, before.as_ref(), max_len)?,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {},
        Err(e) => return Err(e),
    }
    let file = OpenOptions::new().read(true).write(create).create(create).truncate(false)
        .mode(0o600).custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK).open(path)?;
    let file = checked_auxiliary(file, database, before.as_ref(), max_len)?;
    if create { file.set_permissions(fs::Permissions::from_mode(0o600))?; }
    Ok(file)
}

#[cfg(unix)]
fn auxiliary_metadata(meta: &fs::Metadata, database: Option<&fs::Metadata>, max_len: u64) -> io::Result<()> {
    use std::os::unix::fs::MetadataExt;
    if !meta.is_file() || meta.nlink() != 1 || meta.len() > max_len
        || database.is_some_and(|db| (meta.dev(), meta.ino()) == (db.dev(), db.ino())) {
        Err(io::Error::other("ownership/address file must be a separate regular single-linked file of the expected size; stop the owners and restore the store and its sidecars"))
    } else { Ok(()) }
}

#[cfg(unix)]
fn checked_auxiliary(file: File, database: &Path, before: Option<&fs::Metadata>, max_len: u64) -> io::Result<File> {
    // Inspect both the pre-open and current database identities. On any
    // uncertainty, do not flock, chmod, read, write, unlock, or close the fd.
    let checked = (|| {
        let meta = file.metadata()?;
        auxiliary_metadata(&meta, before, max_len)?;
        match fs::symlink_metadata(database) {
            Ok(db) => auxiliary_metadata(&meta, Some(&db), max_len),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
        }
    })();
    if let Err(e) = checked {
        std::mem::forget(file);
        return Err(e);
    }
    Ok(file)
}

#[cfg(unix)]
pub fn owner_is_named(database: &Path, file: &File) -> bool {
    use std::os::unix::fs::MetadataExt;
    fs::symlink_metadata(owner_path(database)).is_ok_and(|named| {
        named.is_file() && named.nlink() == 1 && file.metadata().is_ok_and(|held| {
            (named.dev(), named.ino()) == (held.dev(), held.ino())
        })
    })
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

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{os::fd::AsRawFd, process::Command};

    #[test]
    fn post_open_database_alias_retains_descriptor_and_posix_lock() {
        for renamed in [false, true] {
            let dir = std::env::temp_dir().join(format!("snapback4-aux-race-{}-{renamed}", std::process::id()));
            fs::create_dir_all(&dir).unwrap();
            let database = dir.join("store.sqlite");
            let conn = rusqlite::Connection::open(&database).unwrap();
            conn.execute_batch("CREATE TABLE t(n); BEGIN IMMEDIATE").unwrap();
            let before = fs::symlink_metadata(&database).unwrap();
            let target = owner_path(&database);
            if renamed { fs::rename(&database, &target).unwrap(); }
            else { fs::hard_link(&database, &target).unwrap(); }
            // Deterministically inject the descriptor a raced open returns.
            // An unlimited length isolates the inode/link checks from size.
            let file = File::open(&target).unwrap();
            let fd = file.as_raw_fd();
            assert!(checked_auxiliary(file, &database, Some(&before), u64::MAX).is_err());
            assert!(fs::metadata(format!("/dev/fd/{fd}")).is_ok(), "refusal must forget, never close");
            let out = Command::new("python3").args(["-c", r#"
import errno, fcntl, os, sys
f = os.open(sys.argv[1], os.O_RDWR)
try:
    fcntl.lockf(f, fcntl.LOCK_EX | fcntl.LOCK_NB, 1, 1073741825)
except OSError as error:
    if error.errno in (errno.EACCES, errno.EAGAIN):
        sys.exit(0)
    raise
sys.exit('SQLite reserved lock was dropped')
"#]).arg(&target).output().unwrap();
            assert!(out.status.success(), "{out:?}");
            conn.execute_batch("ROLLBACK").unwrap();
            drop(conn);
            // The refused descriptor intentionally lives until test-process exit.
            fs::remove_dir_all(dir).unwrap();
        }
    }
}
