//! Live progress shared with `why recent`, independent of the blocked writer.
//! Only atomic memory stores occur on the response path; no flush or file IO.
use std::{fs::File, io, path::Path, sync::atomic::{AtomicU64, Ordering}};

pub(super) struct Watermark(*mut AtomicU64);
// The mapping owns one aligned atomic, shared across threads and CLI processes.
unsafe impl Send for Watermark {}
unsafe impl Sync for Watermark {}
impl Watermark {
    pub fn create(path: &Path) -> io::Result<Self> {
        let file = super::private_file(path)?;
        file.set_len(8)?;
        Self::map(&file, true)
    }
    pub fn open(path: &Path) -> io::Result<Self> { Self::map(&File::open(path)?, false) }
    fn map(file: &File, write: bool) -> io::Result<Self> {
        use std::os::fd::AsRawFd;
        if file.metadata()?.len() != 8 { return Err(io::Error::other("invalid dev refusal watermark")); }
        // mmap is page-aligned; the new file is zero-filled, a valid AtomicU64.
        let ptr = unsafe { libc::mmap(std::ptr::null_mut(), 8, libc::PROT_READ | if write { libc::PROT_WRITE } else { 0 }, libc::MAP_SHARED, file.as_raw_fd(), 0) };
        if ptr == libc::MAP_FAILED { return Err(io::Error::last_os_error()); }
        Ok(Self(ptr.cast()))
    }
    pub fn next(&self) -> u64 { unsafe { &*self.0 }.fetch_add(1, Ordering::SeqCst) + 1 }
    pub fn load(&self) -> u64 { unsafe { &*self.0 }.load(Ordering::SeqCst) }
}
impl Drop for Watermark {
    fn drop(&mut self) { unsafe { libc::munmap(self.0.cast(), 8); } }
}
