//! @ref LLP 3000.030#15 — native group custody, independent of the Node launcher.
use super::*;
use std::os::unix::process::CommandExt;
#[cfg(target_os = "macos")]
use std::os::fd::{AsRawFd, FromRawFd};

static STOP: AtomicBool = AtomicBool::new(false);
extern "C" fn stop(_: i32) { STOP.store(true, Ordering::Relaxed); }
extern "C" fn kill_own_group(_: i32) { unsafe { libc::kill(0, libc::SIGKILL); } }

// The watcher is armed before any worker can start. Check getppid after arming
// to close the parent-died-before-registration case. Never poll a reusable PID.
struct OwnerWatch {
    #[cfg(target_os = "macos")]
    queue: File,
}
impl OwnerWatch {
    fn new(parent: u32, anchor: bool) -> Result<Self> {
        for signal in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP] {
            let mut action: libc::sigaction = unsafe { std::mem::zeroed() };
            action.sa_sigaction = if anchor { kill_own_group as *const () as usize } else { stop as *const () as usize };
            unsafe { libc::sigemptyset(&mut action.sa_mask); libc::sigaction(signal, &action, std::ptr::null_mut()); }
        }
        #[cfg(target_os = "linux")]
        if unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) } != 0 { return Err(error("E_WITNESS_PROCESS", std::io::Error::last_os_error())); }
        #[cfg(target_os = "macos")]
        let queue = {
            let fd = unsafe { libc::kqueue() };
            if fd < 0 { return Err(error("E_WITNESS_PROCESS", std::io::Error::last_os_error())); }
            let file = unsafe { File::from_raw_fd(fd) };
            unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC); }
            let event = libc::kevent { ident: parent as _, filter: libc::EVFILT_PROC, flags: libc::EV_ADD | libc::EV_ONESHOT,
                fflags: libc::NOTE_EXIT, data: 0, udata: std::ptr::null_mut() };
            if unsafe { libc::kevent(fd, &event, 1, std::ptr::null_mut(), 0, std::ptr::null()) } < 0 { return Err(error("E_WITNESS_PROCESS", "cannot watch preparation owner exit")); }
            file
        };
        if unsafe { libc::getppid() } != parent as i32 { return Err(error("E_WITNESS_PROCESS", "preparation owner exited before custody handshake")); }
        Ok(Self { #[cfg(target_os = "macos")] queue })
    }
    fn ended(&self) -> bool {
        if STOP.load(Ordering::Relaxed) { return true; }
        #[cfg(target_os = "macos")]
        {
            let mut event: libc::kevent = unsafe { std::mem::zeroed() };
            let timeout = libc::timespec { tv_sec: 0, tv_nsec: 0 };
            if unsafe { libc::kevent(self.queue.as_raw_fd(), std::ptr::null(), 0, &mut event, 1, &timeout) } != 0 { return true; }
        }
        false
    }
}

pub(super) fn helper(args: &[&std::ffi::OsStr]) -> Command {
    let executable = std::env::current_exe().unwrap();
    #[cfg(test)]
    let executable = executable.parent().unwrap().parent().unwrap().join("snapback4");
    let mut command = Command::new(executable);
    command.arg("--internal-witness-process").args(args);
    command
}
fn seal(path: &Path, value: &Value) -> Result<()> {
    let temp = path.with_extension("tmp");
    fs::write(&temp, serde_json::to_vec(value).unwrap()).and_then(|_| fs::rename(temp, path)).map_err(|e| error("E_WITNESS_PROCESS", e))
}
fn input() -> Result<Option<u8>> {
    let mut poll = libc::pollfd { fd: 0, events: libc::POLLIN | libc::POLLHUP, revents: 0 };
    if unsafe { libc::poll(&mut poll, 1, 20) } < 0 {
        if std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted { return Ok(None); }
        return Err(error("E_WITNESS_PROCESS", "preparation control pipe failed"));
    }
    if poll.revents == 0 { return Ok(None); }
    let mut byte = [0];
    Ok(Some(if std::io::stdin().read(&mut byte).unwrap_or(0) == 1 { byte[0] } else { 0 }))
}
fn anchor(args: &[String]) -> Result<()> {
    if unsafe { libc::getpgrp() != libc::getpid() } { return Err(error("E_WITNESS_PROCESS", "native anchor must lead its own group")); }
    let watch = OwnerWatch::new(args[0].parse().map_err(|_| error("E_WITNESS_PROCESS", "invalid owner"))?, true)?;
    while !watch.ended() {
        match input()? { Some(b's') => break, Some(_) => { kill_own_group(0); }, None => {} }
    }
    if watch.ended() { kill_own_group(0); }
    let mut command = Command::new(&args[2]); command.args(&args[3..]).stdin(Stdio::null());
    #[cfg(target_os = "linux")]
    let parent = std::process::id() as i32;
    #[cfg(target_os = "linux")]
    unsafe { command.pre_exec(move || {
        if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) != 0 { return Err(std::io::Error::last_os_error()); }
        if libc::getppid() != parent { return Err(std::io::Error::from_raw_os_error(libc::ECHILD)); }
        Ok(())
    }); }
    let mut worker = command.spawn().map_err(|e| error("E_WITNESS_PROCESS", e))?;
    let mut recorded = false;
    loop {
        if watch.ended() { kill_own_group(0); }
        if !recorded {
            if let Some(status) = worker.try_wait().map_err(|e| error("E_WITNESS_PROCESS", e))? {
                seal(Path::new(&args[1]), &json!({ "status": status.code().unwrap_or(1) }))?;
                recorded = true;
            }
        }
        sleep(Duration::from_millis(20));
    }
}
fn supervisor(args: &[String]) -> Result<()> {
    let watch = OwnerWatch::new(args[0].parse().map_err(|_| error("E_WITNESS_PROCESS", "invalid owner"))?, false)?;
    let ready = Path::new(&args[1]);
    let lock_path = ready.with_extension("reap.lock");
    let reap_lock = File::options().read(true).write(true).create(true).truncate(false).open(&lock_path).map_err(|e| error("E_WITNESS_PROCESS", e))?;
    let parent = std::process::id().to_string();
    let mut argv = vec![std::ffi::OsStr::new("anchor"), parent.as_ref()];
    argv.extend(args[2..].iter().map(std::ffi::OsStr::new));
    let mut child = helper(&argv).process_group(0).stdin(Stdio::piped()).spawn().map_err(|e| error("E_WITNESS_PROCESS", e))?;
    // Never try_wait this child: even a dead anchor reserves the group's number
    // until both inspections are empty and no recovery holds the reaping lock.
    let group = child.id();
    let result = (|| {
        let leader = recovery::birth(group).ok_or_else(|| error("E_WITNESS_PROCESS", "cannot inspect native group anchor"))?;
        seal(ready, &json!({ "group": group, "leader": leader, "guardian": recovery::identity(std::process::id()), "reapLock": lock_path }))?;
        loop {
            if watch.ended() { break; }
            let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
            if unsafe { libc::waitid(libc::P_PID, group, &mut info, libc::WEXITED | libc::WNOHANG | libc::WNOWAIT) } != 0 {
                return Err(error("E_WITNESS_PROCESS", "cannot inspect preparation anchor"));
            }
            if unsafe { info.si_pid() } != 0 { return Err(error("E_WITNESS_PROCESS", "preparation anchor exited")); }
            match input()? {
                Some(b's') => { child.stdin.as_mut().unwrap().write_all(b"s").map_err(|e| error("E_WITNESS_PROCESS", e))?; }
                Some(_) => break,
                None => {}
            }
        }
        Ok(())
    })();
    // This parent owns an unreaped leader even after exit: no numeric reuse
    // window in the normal/watchdog path. KILL is group-wide on every pass.
    let end = Instant::now() + Duration::from_secs(4);
    let mut empty = 0;
    loop {
        unsafe { libc::kill(-(group as i32), libc::SIGKILL); }
        if recovery::members(group)?.is_empty() { empty += 1; } else { empty = 0; }
        if empty == 2 { break; }
        if Instant::now() >= end { return Err(error("E_WITNESS_PROCESS", "watchdog group survived SIGKILL; recovery required")); }
        sleep(Duration::from_millis(20));
    }
    reap_lock.lock().map_err(|e| error("E_WITNESS_PROCESS", e))?;
    child.wait().map_err(|e| error("E_WITNESS_PROCESS", e))?;
    result
}
pub(crate) fn command(args: &[String]) -> u8 {
    let result = match args.first().map(String::as_str) {
        Some("supervisor") if args.len() >= 5 => supervisor(&args[1..]),
        Some("anchor") if args.len() >= 4 => anchor(&args[1..]),
        _ => Err(error("E_WITNESS_PROCESS", "invalid internal preparation command")),
    };
    match result { Ok(()) => 0, Err(e) => { eprintln!("{e}"); 1 } }
}