//! Project-local dev discovery, independent of the serving store's ownership lock.
// @ref LLP 3000.019#3.7 — fresh/temporary stores advertise the same inspector.
use crate::project::Project;
use serde::{Deserialize, Serialize};
use std::{ffi::{CStr, CString, OsStr, OsString}, fs::{self, File, OpenOptions}, io::{self, Read, Write}, path::PathBuf};
use std::os::{fd::{AsRawFd, FromRawFd, IntoRawFd}, unix::{ffi::OsStringExt, fs::{MetadataExt, OpenOptionsExt}}};

#[derive(Serialize, Deserialize)]
pub(crate) struct Address {
    pub project: PathBuf,
    pub port: u16,
    pub store_id: String,
    pub temporary: bool,
}
struct Directory(File);
pub(crate) struct Registration { directory: Directory, name: OsString, file: File }

fn c_name(name: &OsStr) -> io::Result<CString> {
    CString::new(name.as_encoded_bytes()).map_err(io::Error::other)
}
impl Directory {
    // @ref LLP 3000.019#3.7 — validate the directory itself, then keep every
    // record operation relative to that descriptor even if its name is swapped.
    fn open(project: &Project, create: bool) -> io::Result<Self> {
        let path = project.data_dir();
        if create {
            match fs::create_dir(&path) {
                Ok(()) => (),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => (),
                Err(e) => return Err(e),
            }
        }
        Self::verify(OpenOptions::new().read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_DIRECTORY).open(path)?)
    }
    fn verify(file: File) -> io::Result<Self> {
        let meta = file.metadata()?;
        if !meta.is_dir() || meta.uid() != unsafe { libc::geteuid() } {
            return Err(io::Error::other(".snapback4 must be an owned directory, not a symlink"));
        }
        Ok(Self(file))
    }
    fn open_record(&self, name: &OsStr, create: bool) -> io::Result<File> {
        let name = c_name(name)?;
        let flags = libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC
            | if create { libc::O_RDWR | libc::O_CREAT } else { libc::O_RDONLY };
        let fd = unsafe { libc::openat(self.0.as_raw_fd(), name.as_ptr(), flags, 0o600) };
        if fd < 0 { return Err(io::Error::last_os_error()); }
        let file = unsafe { File::from_raw_fd(fd) };
        let meta = file.metadata()?;
        if !meta.is_file() || meta.nlink() != 1 || meta.uid() != unsafe { libc::geteuid() } {
            return Err(io::Error::other("dev address must be an owned regular file with one link"));
        }
        Ok(file)
    }
    fn same_file(&self, name: &OsStr, file: &File) -> bool {
        let Ok(name) = c_name(name) else { return false; };
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        if unsafe { libc::fstatat(self.0.as_raw_fd(), name.as_ptr(), stat.as_mut_ptr(), libc::AT_SYMLINK_NOFOLLOW) } != 0 { return false; }
        let stat = unsafe { stat.assume_init() };
        let Ok(file) = file.metadata() else { return false; };
        stat.st_mode & libc::S_IFMT == libc::S_IFREG && stat.st_nlink == 1
            && stat.st_dev as u64 == file.dev() && stat.st_ino as u64 == file.ino()
    }
    fn remove(&self, name: &OsStr, file: &File) {
        if self.same_file(name, file) && let Ok(name) = c_name(name) {
            unsafe { libc::unlinkat(self.0.as_raw_fd(), name.as_ptr(), 0); }
        }
    }
    fn names(&self) -> io::Result<Vec<OsString>> {
        // A new descriptor gives enumeration its own offset, without resolving
        // the directory's pathname again. fdopendir owns this descriptor.
        let fd = unsafe { libc::openat(self.0.as_raw_fd(), c".".as_ptr(), libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC) };
        if fd < 0 { return Err(io::Error::last_os_error()); }
        let file = unsafe { File::from_raw_fd(fd) };
        let dir = unsafe { libc::fdopendir(file.as_raw_fd()) };
        if dir.is_null() { return Err(io::Error::last_os_error()); }
        let _ = file.into_raw_fd();
        struct Entries(*mut libc::DIR);
        impl Drop for Entries { fn drop(&mut self) { unsafe { libc::closedir(self.0); } } }
        let entries = Entries(dir);
        let mut names = Vec::new();
        loop {
            let entry = unsafe { libc::readdir(entries.0) };
            if entry.is_null() { break; }
            names.push(OsString::from_vec(unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) }.to_bytes().to_vec()));
        }
        Ok(names)
    }
}
impl Registration {
    pub fn new(project: &Project, port: u16, store_id: String, temporary: bool) -> Result<Self, String> {
        let create = || -> io::Result<Self> {
            let directory = Directory::open(project, true)?;
            let name = OsString::from(format!("dev-address-{port}.json"));
            let mut file = directory.open_record(&name, true)?;
            file.try_lock().map_err(io::Error::other)?;
            if !directory.same_file(&name, &file) { return Err(io::Error::other("dev address changed while opening")); }
            let address = Address { project: project.root.canonicalize()?, port, store_id, temporary };
            let bytes = serde_json::to_vec(&address)?;
            file.set_len(0)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            Ok(Self { directory, name, file })
        };
        let record = create().map_err(|e| format!("cannot advertise dev inspector: {e}; restore an owned .snapback4 directory and a regular dev-address file, then retry snapback4 dev"))?;
        // Orderly termination runs Registration::drop even without a child worker.
        crate::lifecycle::address_cleanup();
        Ok(record)
    }
}
impl Drop for Registration {
    fn drop(&mut self) { self.directory.remove(&self.name, &self.file); }
}

/// Newest live host first; multiple fresh hosts may coexist. A crash can leave
/// a file, but only a held lifetime lock plus matching HTTP identity is live.
pub(crate) fn read(project: &Project) -> Vec<Address> {
    let Some(root) = project.root.canonicalize().ok() else { return Vec::new(); };
    let Ok(directory) = Directory::open(project, false) else { return Vec::new(); };
    let Ok(names) = directory.names() else { return Vec::new(); };
    let mut records = Vec::new();
    for name in names {
        let Some(port) = name.to_str().and_then(|s| s.strip_prefix("dev-address-")).and_then(|s| s.strip_suffix(".json")).and_then(|s| s.parse::<u16>().ok()) else { continue; };
        let Ok(file) = directory.open_record(&name, false) else { continue; };
        if !matches!(file.try_lock(), Err(fs::TryLockError::WouldBlock)) { continue; }
        if !directory.same_file(&name, &file) { continue; }
        let modified = file.metadata().and_then(|m| m.modified()).ok();
        let mut bytes = Vec::new();
        if file.take(8193).read_to_end(&mut bytes).is_err() || bytes.len() > 8192 { continue; }
        let Ok(address) = serde_json::from_slice::<Address>(&bytes) else { continue; };
        if address.project == root && address.port == port { records.push((modified, address)); }
    }
    records.sort_by(|a, b| b.0.cmp(&a.0));
    records.into_iter().map(|(_, address)| address).collect()
}

#[cfg(test)]
#[path = "../tests/latency/discovery.rs"]
mod tests;
