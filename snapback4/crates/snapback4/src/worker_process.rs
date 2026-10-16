//! One watchdog per worker: the pipe is held only by its server owner.
//! EOF also covers SIGKILL and works on both Linux and macOS.
// @ref LLP 3000.009#5.3 — the whole worker process group belongs to the host lifetime.
use std::{fs::File, os::{fd::{AsRawFd, FromRawFd}, unix::process::CommandExt}, process::Command, sync::Arc, time::{Duration, Instant}};

#[path = "worker_spawn.rs"]
mod spawn;

static STOP: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
extern "C" fn stop_signal(_: libc::c_int) { STOP.store(true, std::sync::atomic::Ordering::Relaxed); }

pub(super) fn isolate(command: &mut Command) { command.process_group(0); }

// Pass the same flock's open file description, never reopen the sidecar.
// Change inheritance only in the forked watchdog, not the threaded host.
pub(super) fn retain_owner(command: &mut Command, owner: Option<Arc<File>>) {
    command.arg(owner.as_ref().map_or(-1, |file| file.as_raw_fd()).to_string());
    unsafe { command.pre_exec(move || {
        if let Some(owner) = &owner { inheritance(owner.as_raw_fd(), true)?; }
        Ok(())
    }); }
}

fn inheritance(fd: libc::c_int, inherit: bool) -> std::io::Result<()> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
    if flags < 0 { return Err(std::io::Error::last_os_error()); }
    let flags = if inherit { flags & !libc::FD_CLOEXEC } else { flags | libc::FD_CLOEXEC };
    if unsafe { libc::fcntl(fd, libc::F_SETFD, flags) } < 0 { return Err(std::io::Error::last_os_error()); }
    Ok(())
}

// @ref LLP 3000.000.000.000.000#7 — kernel executable identity works without procfs; argv[0] never authorizes a watchdog.
fn running_executable(current: std::io::Result<std::path::PathBuf>) -> std::io::Result<std::path::PathBuf> {
    current.or_else(|error| {
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::ffi::OsStrExt;
            // AT_EXECFN is supplied by the kernel's exec loader, independent of
            // mutable argv[0], PATH, or application-controlled environment.
            let pointer = unsafe { libc::getauxval(libc::AT_EXECFN) } as *const libc::c_char;
            if !pointer.is_null() {
                let bytes = unsafe { std::ffi::CStr::from_ptr(pointer) }.to_bytes();
                let path = std::path::Path::new(std::ffi::OsStr::from_bytes(bytes));
                if let Ok(path) = path.canonicalize() { return Ok(path); }
            }
        }
        Err(error)
    })
}

pub(super) fn executable() -> std::io::Result<std::path::PathBuf> {
    let executable = running_executable(std::env::current_exe())?;
    // Unit fixtures host the production supervisor inside Rust's test runner,
    // whose main cannot dispatch CLI verbs. The suite builds this sibling CLI
    // first (as do the crate's integration-test targets).
    #[cfg(test)]
    { Ok(executable.parent().unwrap().parent().unwrap().join("snapback4")) }
    #[cfg(not(test))]
    { Ok(executable) }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    #[test]
    fn kernel_executable_fallback_ignores_spoofed_argv_zero() {
        let actual = std::env::current_exe().unwrap();
        if std::env::var_os("SNAPBACK4_SURF4_EXEC_PROBE").is_some() {
            assert_eq!(std::env::args().next().unwrap(), "not-the-running-executable");
            let missing_proc = Err(std::io::Error::new(std::io::ErrorKind::NotFound, "procfs absent"));
            assert_eq!(running_executable(missing_proc).unwrap(), actual);
            return;
        }
        let result = std::process::Command::new(actual).arg0("not-the-running-executable")
            .args(["--exact", "dev_worker::process::tests::kernel_executable_fallback_ignores_spoofed_argv_zero", "--nocapture"])
            .env("SNAPBACK4_SURF4_EXEC_PROBE", "1").output().unwrap();
        assert!(result.status.success(), "{}{}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));
        assert!(String::from_utf8_lossy(&result.stdout).contains("1 passed"));
    }
}

pub(crate) fn watchdog(args: &[String]) -> u8 {
    crate::thread_priority::background();
    if args.len() != 3 { return 1; }
    let owner_fd = match args[2].parse::<libc::c_int>() { Ok(fd) if fd == -1 || fd >= 3 => fd, _ => return 1 };
    // Keep ownership through kill/wait/output cleanup, but close it on Node's
    // exec. Application code must neither unlock it nor prolong its lifetime.
    let _owner = if owner_fd >= 3 {
        if inheritance(owner_fd, false).is_err() { return 1; }
        Some(unsafe { File::from_raw_fd(owner_fd) })
    } else { None };
    // A host-wide TERM can reach the watchdog too. Survive it long enough to
    // perform the same bounded group cleanup as EOF, even if the host is gone.
    for signal in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP] {
        let mut action: libc::sigaction = unsafe { std::mem::zeroed() };
        action.sa_sigaction = stop_signal as *const () as usize;
        unsafe {
            libc::sigemptyset(&mut action.sa_mask);
            if libc::sigaction(signal, &action, std::ptr::null_mut()) != 0 { return 1; }
        }
    }
    let mut child = match spawn::spawn(&args[0], &args[1]) {
        Ok(child) => child,
        Err(error) => { eprintln!("snapback4 worker: cannot start: {error}"); return 1; }
    };
    let group = child.id() as libc::pid_t;
    // Consume this PID before forwarding any worker output. Public status and
    // restart controls refer to the Node child, never the watchdog itself.
    use std::io::Write;
    let handshake = writeln!(std::io::stdout(), "{group} {}", crate::thread_priority::child_nice_error()).and_then(|_| std::io::stdout().flush());
    if handshake.is_err() {
        unsafe { libc::kill(-group, libc::SIGKILL); }
        let _ = child.wait(); return 1;
    }
    let mut output = child.stdout.take().unwrap();
    let output = std::thread::spawn(move || { crate::thread_priority::background(); let _ = std::io::copy(&mut output, &mut std::io::stdout()); });
    let mut stopping = None;
    loop {
        // WNOWAIT keeps the group leader's PID reserved until the final kill,
        // including when only grandchildren remain. Never signal a reused PID.
        let mut status: libc::siginfo_t = unsafe { std::mem::zeroed() };
        let exited = unsafe {
            libc::waitid(libc::P_PID, child.id(), &mut status, libc::WEXITED | libc::WNOHANG | libc::WNOWAIT) == 0 && status.si_pid() != 0
        };
        if exited || stopping.is_some_and(|at: Instant| at.elapsed() >= Duration::from_secs(2)) { break; }
        let mut pipe = libc::pollfd { fd: 0, events: libc::POLLIN | libc::POLLHUP, revents: 0 };
        let polled = unsafe { libc::poll(&mut pipe, 1, 50) };
        if stopping.is_none() && (STOP.load(std::sync::atomic::Ordering::Relaxed) || (polled > 0 && pipe.revents != 0) || (polled < 0 && std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted)) {
            unsafe { libc::kill(-group, libc::SIGTERM); }
            stopping = Some(Instant::now());
        }
        // EOF stays readable; don't spin during the grace period.
        if stopping.is_some() { std::thread::sleep(Duration::from_millis(20)); }
    }
    unsafe { libc::kill(-group, libc::SIGKILL); }
    let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(1).clamp(0, 255) as u8;
    let _ = output.join();
    code
}
