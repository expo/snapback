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
fn copy_package(parent: &File, stage: &Path) -> io::Result<()> {
    let mut source = match open(parent, std::ffi::OsStr::new("package.json")) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if !source.metadata()?.is_file() { return Err(io::Error::other("worker package.json must be a regular file")); }
    let mut output = File::options().write(true).create_new(true).open(stage.join("package.json"))?;
    io::copy(&mut source, &mut output)?;
    Ok(())
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
// Host-installed packages are separate from immutable source; restore every
// nested package scope that exists in the source snapshot.
fn link_package_scopes(source: &Path, target: &Path) -> io::Result<()> {
    if !target.is_dir() { return Ok(()); }
    let entries = match std::fs::read_dir(source) { Ok(entries) => entries, Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()), Err(e) => return Err(e) };
    for entry in entries {
        let entry = entry?; let name = entry.file_name();
        if name == "node_modules" {
            if entry.path().is_dir() && !target.join(&name).exists() { std::os::unix::fs::symlink(entry.path(), target.join(&name))?; }
        } else if entry.file_type()?.is_dir() {
            link_package_scopes(&entry.path(), &target.join(name))?;
        }
    }
    Ok(())
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
        // @ref LLP 3000.009#5.3 — packages are host-owned, including nested
        // node_modules and package-manager symlinks. Never deploy their bytes
        // or validate them as source; launches link the original installation.
        if name == "node_modules" {
            if let Some((source, stage)) = dependencies {
                let target = stage.join(relative).join(&name);
                std::fs::create_dir_all(target.parent().unwrap())?;
                if !target.exists() { std::os::unix::fs::symlink(source.join(relative).join(&name), target)?; }
            }
            continue;
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
    collect(project, None, false)
}

fn collect(project: &Project, stage: Option<&Path>, link_dependencies: bool) -> Result<BTreeMap<String, PathBuf>, String> {
    let mut workers = BTreeMap::new();
    let Some(dir) = root(project).map_err(|e| format!("workers: {e}"))? else { return Ok(workers); };
    let source_root = project.root.join("snapback/workers");
    let target_root = stage.map(|stage| stage.join("snapback/workers"));
    let dependencies = target_root.as_deref().filter(|_| link_dependencies).map(|target| (source_root.as_path(), target));
    walk(&dir, Path::new(""), dependencies, &mut |path, source| {
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
    if link_dependencies && let Some(target) = target_root {
        let packages = Snapshot::package_root(project).map_err(|e| e.to_string())?.join("snapback/workers");
        link_package_scopes(&packages, &target).map_err(|e| e.to_string())?;
    }
    Ok(workers)
}

/// Snapshot only regular files reached through the project's pinned directories.
/// Dependencies are installed by the host.
pub(crate) fn package(project: &Project, stage: &Path) -> Result<(), String> {
    collect(project, Some(stage), false)?;
    // @ref LLP 3000.001.000#workers — immutable source records its host app installation separately.
    std::fs::write(stage.join("worker-package.json"), serde_json::to_vec(&serde_json::json!({ "directory": project.root.canonicalize().map_err(|e| e.to_string())? })).map_err(|e| e.to_string())?).map_err(|e| e.to_string())

}

pub(crate) fn private_scope(project: &Project, root: &Path) -> Result<PathBuf, String> {
    package_scopes(&Snapshot::package_root(project).map_err(|e|e.to_string())?, root.to_owned()).map_err(|e|e.to_string())
}
fn package_scopes(package_root: &Path, mut stage: PathBuf) -> io::Result<PathBuf> {
    for ancestor in package_root.ancestors().collect::<Vec<_>>().into_iter().rev() {
        stage = stage.join("scope"); std::fs::create_dir(&stage)?;
        if ancestor.join("node_modules").is_dir() {
            std::os::unix::fs::symlink(ancestor.join("node_modules"), stage.join("node_modules"))?;
        }
        copy_package(&File::open(ancestor)?, &stage)?;
    }
    Ok(stage)
}

pub(crate) fn link_dependencies(project: &Project, stage: &Path) -> Result<(), String> {
    link_package_scopes(&Snapshot::package_root(project).map_err(|e| e.to_string())?, stage).map_err(|e| e.to_string())
}

/// Capture the same checked source closure used by automatic development entries.
// @ref LLP 3000.000.000.000.000#7-serve-and-surface-completion-surf4-2026-10-16 — release source, including imports, is immutable; installed packages remain host-owned.
pub(crate) fn package_entry(project: &Project, stage: &Path) -> Result<(), String> {
    let Some(source) = super::source(project) else { return Ok(()); };
    let snapshot = Snapshot::automatic(project, &source)?;
    let captured = snapshot.entry.parent().and_then(Path::parent).ok_or("worker snapshot root")?;
    fn copy(source: &Path, target: &Path) -> io::Result<()> {
        for entry in std::fs::read_dir(source)? {
            let entry = entry?;
            if matches!(entry.file_name().to_str(), Some("node_modules")) || entry.path().extension().is_some_and(|ext| ext == "q") { continue; }
            let kind = entry.file_type()?;
            if kind.is_symlink() { return Err(io::Error::other("worker source must be a regular file or directory")); }
            let target = target.join(entry.file_name());
            if kind.is_dir() { std::fs::create_dir_all(&target)?; copy(&entry.path(), &target)?; }
            else if kind.is_file() { std::fs::copy(entry.path(), target)?; }
        }
        Ok(())
    }
    copy(captured, stage).map_err(|e| e.to_string())?;
    let graph = stage.join("snapback/generated/server-watch.json");
    if let Ok(bytes) = std::fs::read(&graph) {
        type Dependency = (PathBuf, Option<(String, String)>);
        let dependencies: Vec<Dependency> = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        let root = project.root.canonicalize().map_err(|e| e.to_string())?;
        let relative: Vec<Dependency> = dependencies.into_iter().filter_map(|(path, state)| {
            // macOS's temporary path may spell /var while the pinned root is
            // /private/var. Normalize ancestors without following the leaf.
            let located = path.parent().zip(path.file_name())
                .and_then(|(parent, name)| parent.canonicalize().ok().map(|parent| parent.join(name)))
                .unwrap_or(path);
            let relative = located.strip_prefix(&root).ok()?;
            if relative.components().any(|part| part.as_os_str() == "node_modules") { return None; }
            // Stat data is checker-local evidence, not executable release identity.
            Some((relative.to_owned(), state.map(|_| ("captured".into(), "captured".into()))))
        }).collect();
        std::fs::write(graph, serde_json::to_vec(&relative).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    Ok(())
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
        let mut entries = collect(project, Some(&stage), true).map_err(io::Error::other)?;
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
        Self::checked_imports(&root, &project_root, &stage)?;
        // External checked imports keep their own nearest package scopes too.
        link_package_scopes(&Self::package_root(project)?, &stage)?;
        owned.entry = schema_stage.join(source.file_name().ok_or_else(|| io::Error::other("worker entry has no filename"))?);
        if !owned.entry.is_file() { return Err(io::Error::other("automatic worker entry is absent")); }
        Ok(owned)
    }

    // @ref LLP 3000.009#5.3 — checked project imports share source custody with the entry.
    fn checked_imports(root: &File, project_root: &Path, stage: &Path) -> io::Result<()> {
        // Read the already pinned copy of the checker's existing dependency
        // graph. It includes missing lookup candidates and host packages too;
        // only present files inside this project belong in the source snapshot.
        let graph = match std::fs::read(stage.join("snapback/generated/server-watch.json")) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
        };
        type Dependency = (PathBuf, Option<(String, String)>);
        let dependencies: Vec<Dependency> = serde_json::from_slice(&graph).map_err(io::Error::other)?;
        for (path, state) in dependencies {
            let path = if path.is_absolute() { path } else { project_root.join(path) };
            // The checker records paths as it resolved them, possibly through a
            // symlinked ancestor (macOS /var is /private/var). Canonicalize only
            // the parent: the final component is still opened without following.
            let located = path.parent().zip(path.file_name())
                .and_then(|(parent, name)| parent.canonicalize().ok().map(|parent| parent.join(name)))
                .unwrap_or_else(|| path.clone());
            let Ok(relative) = located.strip_prefix(project_root) else { continue; };
            if state.is_none() || relative.starts_with("snapback") || relative.components().any(|part| part.as_os_str() == "node_modules") { continue; }
            let mut source = root.try_clone()?;
            for component in relative.components() {
                let std::path::Component::Normal(name) = component else { return Err(io::Error::other("checked worker imports must stay inside the project")); };
                source = open(&source, name)?;
            }
            if !source.metadata()?.is_file() { return Err(io::Error::other("checked worker imports must be regular files")); }
            let target = stage.join(relative);
            std::fs::create_dir_all(target.parent().unwrap())?;
            // scope() may have copied the project's package type. Replace it
            // with these descriptor-validated bytes, not another pathname read.
            if target.exists() { std::fs::remove_file(&target)?; }
            let mut output = File::options().write(true).create_new(true).open(target)?;
            io::copy(&mut source, &mut output)?;
            output.set_permissions(source.metadata()?.permissions())?;
        }
        Ok(())
    }

    fn package_root(project: &Project) -> io::Result<PathBuf> {
        if let Some(path) = std::env::var_os("SNAPBACK_WORKER_PACKAGE_DIR") { return PathBuf::from(path).canonicalize(); }
        match std::fs::read(project.root.join("worker-package.json")) {
            Ok(bytes) => {
                let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(io::Error::other)?;
                let path = value["directory"].as_str().ok_or_else(|| io::Error::other("worker package directory is absent"))?;
                PathBuf::from(path).canonicalize().map_err(|_| io::Error::other("worker app installation is unavailable; set SNAPBACK_WORKER_PACKAGE_DIR to the app package directory on this host"))
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => project.root.canonicalize(),
            Err(e) => Err(e),
        }
    }

    fn scope(project: &Project) -> io::Result<(Self, PathBuf)> {
        // A global temporary parent adds its node_modules to Node's search.
        // Keep launch bytes under this project's private runtime directory.
        let data = project.data_dir();
        snapback4_core::private_fs::directory(&data)?;
        let template = data.canonicalize()?.join("worker-XXXXXX");
        let mut bytes = CString::new(template.as_os_str().as_bytes())?.into_bytes_with_nul();
        if unsafe { libc::mkdtemp(bytes.as_mut_ptr().cast()) }.is_null() { return Err(io::Error::last_os_error()); }
        bytes.pop();
        let owned = Self { root: PathBuf::from(OsString::from_vec(bytes)), entry: PathBuf::new() };
        // Reproduce Node's ancestor package search in private directories.
        // This works for immutable releases too: no writes to project source.
        let project_root = project.root.canonicalize()?;
        let package_root = Self::package_root(project)?;
        let stage = package_scopes(&package_root, owned.root.clone())?;
        // Preserve schema-local package precedence as well as module type,
        // using the same trusted host-dependency links as the ancestor scopes.
        // Entry/helper custody still belongs to collect's no-follow copies.
        std::fs::create_dir(stage.join("snapback"))?;
        if let Some(packages) = package_root.ancestors().map(|root| root.join("snapback/node_modules")).find(|path| path.is_dir()) {
            std::os::unix::fs::symlink(packages, stage.join("snapback/node_modules"))?;
        }
        let project_dir = File::open(&project_root)?;
        let schema = open(&project_dir, std::ffi::OsStr::new("snapback"))?;
        copy_package(&schema, &stage.join("snapback"))?;
        Ok((owned, stage))
    }
}
impl Drop for Snapshot {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.root); }
}
