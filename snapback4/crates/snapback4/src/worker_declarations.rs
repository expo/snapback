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
fn walk(dir: &File, relative: &Path, dependencies: Option<(&Path, &Path)>, visit: &mut impl FnMut(&Path, &mut File) -> io::Result<()>) -> io::Result<()> {
    for name in entries(dir)? {
        // Automatic conventional entries keep their relative schema helpers.
        // Installed dependencies are host-owned, as in the ancestor scopes;
        // never traverse package-manager symlinks as application source.
        if name == "node_modules" {
            if let Some((source, stage)) = dependencies {
                let target = stage.join(relative).join(&name);
                std::fs::create_dir_all(target.parent().unwrap())?;
                if !target.exists() { std::os::unix::fs::symlink(source.join(relative).join(&name), target)?; }
                continue;
            }
        }
        let mut file = open(dir, &name)?;
        let kind = file.metadata()?.file_type();
        let path = relative.join(name);
        if kind.is_dir() { walk(&file, &path, dependencies, visit)?; }
        else if kind.is_file() { visit(&path, &mut file)?; }
        else { return Err(io::Error::other("worker source must contain only directories and regular files (no symlinks)")); }
    }
    Ok(())
}

// @ref LLP 3000.009#5.3 — one convention shared by development and immutable releases.
pub(super) fn declared(project: &Project) -> Result<BTreeMap<String, PathBuf>, String> {
    collect(project, None)
}

fn collect(project: &Project, stage: Option<&Path>) -> Result<BTreeMap<String, PathBuf>, String> {
    let mut workers = BTreeMap::new();
    let Some(dir) = root(project).map_err(|e| format!("workers: {e}"))? else { return Ok(workers); };
    walk(&dir, Path::new(""), None, &mut |path, source| {
        if let Some(stage) = stage {
            let target = stage.join("snapback/workers").join(path);
            std::fs::create_dir_all(target.parent().unwrap())?;
            let mut output = File::options().write(true).create_new(true).open(target)?;
            io::copy(source, &mut output)?;
            output.set_permissions(source.metadata()?.permissions())?;
        }
        if path.components().count() != 1 || !matches!(path.extension().and_then(|s| s.to_str()), Some("mjs" | "mts" | "ts")) { return Ok(()); }
        let name = path.file_stem().and_then(|s| s.to_str()).ok_or_else(|| io::Error::other("worker name must be UTF-8"))?.to_owned();
        if name.is_empty() || name.len() > 64 || !name.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_')) {
            return Err(io::Error::other(format!("worker {name}: use 1–64 ASCII letters, digits, '-' or '_' for the service name")));
        }
        if workers.insert(name.clone(), stage.unwrap_or(&project.root).join("snapback/workers").join(path)).is_some() { return Err(io::Error::other(format!("worker {name}: declare only one entry extension"))); }
        Ok(())
    }).map_err(|e| format!("workers: {e}"))?;
    Ok(workers)
}

/// Snapshot only regular files reached through the project's pinned directories.
/// Dependencies are installed by the host.
pub(crate) fn package(project: &Project, stage: &Path) -> Result<(), String> {
    collect(project, Some(stage)).map(|_| ())
}

/// A launch owns these copied bytes until its process group has stopped.
/// Module dependencies remain installed host code, outside source custody.
// @ref LLP 3000.009#5.3 — validation and execution share one private snapshot.
pub(super) struct Snapshot { root: PathBuf, pub entry: PathBuf }
impl Snapshot {
    pub fn new(project: &Project, name: &str) -> Result<Self, String> {
        Self::create(project, name).map_err(|e| format!("workers: {e}"))
    }
    fn create(project: &Project, name: &str) -> io::Result<Self> {
        let (mut owned, stage) = Self::scope(project)?;
        let mut entries = collect(project, Some(&stage)).map_err(io::Error::other)?;
        owned.entry = entries.remove(name).ok_or_else(|| io::Error::other(format!("worker {name}: declaration is absent")))?;
        Ok(owned)
    }

    pub fn automatic(project: &Project, source: &Path) -> Result<Self, String> {
        Self::copy_automatic(project, source).map_err(|e| format!("workers: {e}"))
    }
    fn copy_automatic(project: &Project, source: &Path) -> io::Result<Self> {
        let (mut owned, stage) = Self::scope(project)?;
        let project_root = project.root.canonicalize()?;
        let root = File::open(&project_root)?;
        let schema = open(&root, std::ffi::OsStr::new("snapback"))?;
        let schema_stage = stage.join("snapback");
        walk(&schema, Path::new(""), Some((&project_root.join("snapback"), &schema_stage)), &mut |path, source| {
            let target = schema_stage.join(path);
            std::fs::create_dir_all(target.parent().unwrap())?;
            // scope copied the schema's package type; use the pinned copy here.
            if path == Path::new("package.json") { std::fs::remove_file(&target)?; }
            let mut output = File::options().write(true).create_new(true).open(target)?;
            io::copy(source, &mut output)?;
            output.set_permissions(source.metadata()?.permissions())?;
            Ok(())
        })?;
        owned.entry = schema_stage.join(source.file_name().ok_or_else(|| io::Error::other("worker entry has no filename"))?);
        if !owned.entry.is_file() { return Err(io::Error::other("automatic worker entry is absent")); }
        Ok(owned)
    }

    fn scope(project: &Project) -> io::Result<(Self, PathBuf)> {
        let template = std::env::temp_dir().join("snapback4-worker-XXXXXX");
        let mut bytes = CString::new(template.as_os_str().as_bytes())?.into_bytes_with_nul();
        if unsafe { libc::mkdtemp(bytes.as_mut_ptr().cast()) }.is_null() { return Err(io::Error::last_os_error()); }
        bytes.pop();
        let owned = Self { root: PathBuf::from(OsString::from_vec(bytes)), entry: PathBuf::new() };
        // Reproduce Node's ancestor package search in private directories.
        // This works for immutable releases too: no writes to project source.
        let project_root = project.root.canonicalize()?;
        let mut stage = owned.root.clone();
        for ancestor in project_root.ancestors().collect::<Vec<_>>().into_iter().rev() {
            stage = stage.join("scope");
            std::fs::create_dir(&stage)?;
            if ancestor.join("node_modules").is_dir() {
                std::os::unix::fs::symlink(ancestor.join("node_modules"), stage.join("node_modules"))?;
            }
            if ancestor.join("package.json").is_file() {
                std::fs::copy(ancestor.join("package.json"), stage.join("package.json"))?;
            }
        }
        // Preserve schema-local package precedence as well as module type,
        // using the same trusted host-dependency links as the ancestor scopes.
        // Entry/helper custody still belongs to collect's no-follow copies.
        std::fs::create_dir(stage.join("snapback"))?;
        if project_root.join("snapback/node_modules").is_dir() {
            std::os::unix::fs::symlink(project_root.join("snapback/node_modules"), stage.join("snapback/node_modules"))?;
        }
        if project_root.join("snapback/package.json").is_file() {
            std::fs::copy(project_root.join("snapback/package.json"), stage.join("snapback/package.json"))?;
        }
        Ok((owned, stage))
    }
}
impl Drop for Snapshot {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.root); }
}
