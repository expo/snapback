//! One watchdog per worker: the pipe is held only by its server owner.
//! EOF also covers SIGKILL and works on both Linux and macOS.
// @ref LLP 3000.009#5.3 — the whole worker process group belongs to the host lifetime.
use std::{os::unix::process::CommandExt, process::{Command, Stdio}, time::{Duration, Instant}};

pub(super) fn isolate(command: &mut Command) { command.process_group(0); }

pub(super) fn executable() -> std::path::PathBuf {
    let executable = std::env::current_exe().expect("running executable");
    // Unit fixtures host the production supervisor inside Rust's test runner,
    // whose main cannot dispatch CLI verbs. The suite builds this sibling CLI
    // first (as do the crate's integration-test targets).
    #[cfg(test)]
    { executable.parent().unwrap().parent().unwrap().join("snapback4") }
    #[cfg(not(test))]
    { executable }
}

pub(crate) fn watchdog(args: &[String]) -> u8 {
    if args.len() != 2 { return 1; }
    let mut command = Command::new(&args[0]);
    isolate(&mut command);
    let mut child = match command.arg(&args[1]).stdin(Stdio::null()).stdout(Stdio::piped()).spawn() {
        Ok(child) => child,
        Err(error) => { eprintln!("snapback4 worker: cannot start: {error}"); return 1; }
    };
    let group = child.id() as libc::pid_t;
    // Consume this PID before forwarding any worker output. Public status and
    // restart controls refer to the Node child, never the watchdog itself.
    use std::io::Write;
    let handshake = writeln!(std::io::stdout(), "{group}").and_then(|_| std::io::stdout().flush());
    if handshake.is_err() {
        unsafe { libc::kill(-group, libc::SIGKILL); }
        let _ = child.wait(); return 1;
    }
    let mut output = child.stdout.take().unwrap();
    let output = std::thread::spawn(move || { let _ = std::io::copy(&mut output, &mut std::io::stdout()); });
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
        if stopping.is_none() && ((polled > 0 && pipe.revents != 0) || (polled < 0 && std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted)) {
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
