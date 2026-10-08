//! Test-only process isolation for last-close ownership assertions.
use super::*;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

// @ref LLP 3000.030#15 — unrelated concurrent forks can retain close-on-exec
// leases. Run the unchanged scenario alone, without serializing its neighbours
// or unlocking shared production custody. Every intentional child is still the
// scenario's responsibility. The parent remains bounded on a stalled fixture.
pub(super) fn isolated() -> bool {
    let thread = std::thread::current();
    let name = thread.name().expect("named libtest thread");
    if std::env::var("SB4_ISOLATED_LOCK_TEST").as_deref() == Ok(name) { return true; }
    let mut child = Owned::spawn(Command::new(std::env::current_exe().unwrap())
        .args(["--exact", name, "--nocapture", "--test-threads=1"])
        .env("SB4_ISOLATED_LOCK_TEST", name)).unwrap();
    let end = Instant::now() + Duration::from_secs(122);
    loop {
        if let Some(status) = child.status().unwrap() {
            assert!(status.success(), "isolated {name}: {status}");
            return false;
        }
        assert!(Instant::now() < end, "isolated {name} stalled");
        sleep(Duration::from_millis(10));
    }
}

// Hold the exact fork-inherited open-file descriptions until the parent closes
// the pipe, then reap before returning. No timing guess or child-side allocator.
pub(super) struct ForkHolder { pid: libc::pid_t, release: Option<OwnedFd> }
impl ForkHolder {
    pub(super) fn new() -> Self {
        let mut pipe = [0; 2];
        assert_eq!(unsafe { libc::pipe(pipe.as_mut_ptr()) }, 0);
        let read = unsafe { OwnedFd::from_raw_fd(pipe[0]) };
        let write = unsafe { OwnedFd::from_raw_fd(pipe[1]) };
        let pid = unsafe { libc::fork() };
        assert!(pid >= 0);
        if pid == 0 {
            unsafe {
                libc::close(write.as_raw_fd());
                let mut byte = 0u8;
                // EOF releases the gate, including if the parent panics/exits.
                while libc::read(read.as_raw_fd(), &mut byte as *mut _ as *mut _, 1) != 0 {}
                libc::_exit(0);
            }
        }
        Self { pid, release: Some(write) }
    }
}
impl Drop for ForkHolder {
    fn drop(&mut self) {
        self.release.take();
        let mut status = 0;
        loop {
            let result = unsafe { libc::waitpid(self.pid, &mut status, 0) };
            if result < 0 && std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted { continue; }
            assert_eq!(result, self.pid);
            assert_eq!(status, 0);
            break;
        }
    }
}
