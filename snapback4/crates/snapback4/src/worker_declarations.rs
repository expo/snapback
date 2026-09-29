//! The filename is the declaration; helpers belong in subdirectories.
use crate::project::Project;
use std::{collections::BTreeMap, ffi::{CStr, CString, OsString}, fs::File, io, os::{fd::{AsRawFd, FromRawFd}, unix::ffi::{OsStrExt, OsStringExt}}, path::{Path, PathBuf}};

// Descriptor-relative opens pin each directory and refuse symlinks at every
// level. A concurrent rename cannot redirect a later copy through a pathname.
fn open(parent: &File, name: &std::ffi::OsStr) -> io::Result<File> {
    let name = CString::new(name.as_bytes())?;
    let fd = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK) };
    if fd < 0 { return Err(io::Error::last_os_error()); }
    Ok(unsafe { File::from_raw_fd(fd) })
}
fn entries(dir: &File) -> io::Result<Vec<OsString>> {
    if !dir.metadata()?.is_dir() { return Err(io::Error::other("worker source directory is not a directory")); }
    let fd = unsafe { libc::fcntl(dir.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
    if fd < 0 { return Err(io::Error::last_os_error()); }
    let stream = unsafe { libc::fdopendir(fd) };
    if stream.is_null() { unsafe { libc::close(fd); } return Err(io::Error::last_os_error()); }
    // readdir uses errno to distinguish EOF from an error.
    let mut names = Vec::new();
    let result = loop {
        #[cfg(target_os = "linux")]
        unsafe { *libc::__errno_location() = 0; }
        #[cfg(target_os = "macos")]
        unsafe { *libc::__error() = 0; }
        let entry = unsafe { libc::readdir(stream) };
        if entry.is_null() {
            let error = io::Error::last_os_error();
            break if error.raw_os_error() == Some(0) { Ok(names) } else { Err(error) };
        }
        let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes();
        if name != b"." && name != b".." { names.push(OsString::from_vec(name.to_vec())); }
    };
    unsafe { libc::closedir(stream); }
    result
}
fn root(project: &Project) -> io::Result<Option<File>> {
    let project = File::open(project.root.canonicalize()?)?;
    let schema = match open(&project, std::ffi::OsStr::new("snapback")) {
        Ok(schema) => schema,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    match open(&schema, std::ffi::OsStr::new("workers")) {
        Ok(dir) => Ok(Some(dir)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}
fn walk(dir: &File, relative: &Path, visit: &mut impl FnMut(&Path, &mut File) -> io::Result<()>) -> io::Result<()> {
    for name in entries(dir)? {
        let mut file = open(dir, &name)?;
        let kind = file.metadata()?.file_type();
        let path = relative.join(name);
        if kind.is_dir() { walk(&file, &path, visit)?; }
        else if kind.is_file() { visit(&path, &mut file)?; }
        else { return Err(io::Error::other("worker source must contain only directories and regular files (no symlinks)")); }
    }
    Ok(())
}

// @ref LLP 3000.009#5.3 — one convention shared by development and immutable releases.
pub(super) fn declared(project: &Project) -> Result<BTreeMap<String, PathBuf>, String> {
    let mut workers = BTreeMap::new();
    let Some(dir) = root(project).map_err(|e| format!("workers: {e}"))? else { return Ok(workers); };
    walk(&dir, Path::new(""), &mut |path, _| {
        if path.components().count() != 1 || !matches!(path.extension().and_then(|s| s.to_str()), Some("mjs" | "mts" | "ts")) { return Ok(()); }
        let name = path.file_stem().and_then(|s| s.to_str()).ok_or_else(|| io::Error::other("worker name must be UTF-8"))?.to_owned();
        if name.is_empty() || name.len() > 64 || !name.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_')) {
            return Err(io::Error::other(format!("worker {name}: use 1–64 ASCII letters, digits, '-' or '_' for the service name")));
        }
        if workers.insert(name.clone(), project.schema_dir().join("workers").join(path)).is_some() { return Err(io::Error::other(format!("worker {name}: declare only one entry extension"))); }
        Ok(())
    }).map_err(|e| format!("workers: {e}"))?;
    Ok(workers)
}

/// Snapshot only regular files reached through the project's pinned directories.
/// Dependencies are installed by the host.
pub(crate) fn package(project: &Project, stage: &Path) -> Result<(), String> {
    declared(project)?;
    let Some(dir) = root(project).map_err(|e| format!("packaging workers: {e}"))? else { return Ok(()); };
    walk(&dir, Path::new(""), &mut |path, source| {
        let target = stage.join("snapback/workers").join(path);
        std::fs::create_dir_all(target.parent().unwrap())?;
        let mut output = File::create(target)?;
        io::copy(source, &mut output)?;
        output.set_permissions(source.metadata()?.permissions())?;
        Ok(())
    }).map_err(|e| format!("packaging workers: {e}"))
}
