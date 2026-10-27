//! A host is owned by its launching parent, including npm above a surviving shell.
// @ref LLP 3000.037.000#9-serve-lifetime-and-store-recovery-srv1 — parent death must release ports, pipes and store custody.
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;
#[cfg(target_os = "linux")]
use std::fs;
#[cfg(not(target_os = "linux"))]
use std::process::Command;

pub(crate) const ENV: &str = "SNAPBACK4_SUPERVISOR_PID";
static SUPERVISOR: AtomicU32 = AtomicU32::new(0);
static PARENT: AtomicU32 = AtomicU32::new(0);
pub(crate) fn pid() -> Option<u32> { Some(SUPERVISOR.load(Ordering::Acquire)).filter(|pid| *pid != 0) }

/// Stable process birth identity and human-readable start time; zombies are dead.
#[cfg(target_os = "linux")]
pub(crate) fn identity(pid: u32) -> Option<(u32, String)> {
    let text = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let fields: Vec<_> = text.rsplit_once(") ")?.1.split_whitespace().collect();
    if matches!(*fields.first()?, "Z" | "X") { return None; }
    Some((fields.get(1)?.parse().ok()?, fields.get(19)?.to_string()))
}
#[cfg(target_os = "macos")]
pub(crate) fn identity(pid: u32) -> Option<(u32, String)> {
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::uninit();
    let size = std::mem::size_of::<libc::proc_bsdinfo>();
    let read = unsafe { libc::proc_pidinfo(pid as i32, libc::PROC_PIDTBSDINFO, 0, info.as_mut_ptr().cast(), size as i32) };
    if read != size as i32 { return None; }
    let info = unsafe { info.assume_init() };
    if info.pbi_status == libc::SZOMB { return None; }
    Some((info.pbi_ppid, format!("{}.{:06} Unix seconds", info.pbi_start_tvsec, info.pbi_start_tvusec)))
}
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub(crate) fn identity(pid: u32) -> Option<(u32, String)> {
    let output = Command::new("ps").env("LC_ALL", "C").args(["-p", &pid.to_string(), "-o", "ppid=,stat=,lstart="]).output().ok()?;
    if !output.status.success() { return None; }
    let text = String::from_utf8(output.stdout).ok()?;
    let mut fields = text.split_whitespace();
    let parent = fields.next()?.parse().ok()?;
    if fields.next()?.starts_with('Z') { return None; }
    Some((parent, fields.collect::<Vec<_>>().join(" ")))
}
fn npm(pid: u32) -> bool {
    #[cfg(target_os = "linux")]
    { fs::read_to_string(format!("/proc/{pid}/comm")).is_ok_and(|name| name.trim().starts_with("npm")) }
    #[cfg(not(target_os = "linux"))]
    { Command::new("ps").env("LC_ALL", "C").args(["-p", &pid.to_string(), "-o", "args="]).output().is_ok_and(|out| { let text = String::from_utf8_lossy(&out.stdout); text.trim().starts_with("npm") || text.contains("/npm-cli.js ") }) }
}

// Use a dedicated notification signal: Linux binds PDEATHSIG to the spawning
// *thread*. A libuv worker's exit while its process lives is not parent death.
// The handler checks actual reparenting before requesting ordinary SIGTERM.
#[cfg(target_os = "linux")]
extern "C" fn parent_notification(_: libc::c_int) {
    if unsafe { libc::getppid() } as u32 != PARENT.load(Ordering::Relaxed) {
        unsafe { libc::kill(libc::getpid(), libc::SIGTERM); }
    }
}

/// Called on main before threads, even for the direct native serve path.
pub(crate) fn adopt() {
    let supplied = std::env::var(ENV).ok().and_then(|s| s.parse::<u32>().ok());
    unsafe { std::env::remove_var(ENV) };
    let host = std::env::args().nth(1).is_some_and(|verb| matches!(verb.as_str(), "serve" | "dev"));
    if !host && supplied.is_none() { return; }
    let parent = unsafe { libc::getppid() } as u32;
    if let Some(pid) = supplied {
        if identity(pid).is_none() { std::process::exit(128 + libc::SIGTERM); }
    }
    if parent <= 1 {
        // A service manager may legitimately be PID 1. npm's environment,
        // however, means a wrapper disappeared before native entry.
        if host && std::env::var_os("npm_lifecycle_event").is_some() { std::process::exit(128 + libc::SIGTERM); }
        return;
    }
    PARENT.store(parent, Ordering::Release);
    let mut watched = Vec::new();
    if let Some((_, birth)) = identity(parent) { watched.push((parent, birth)); }
    // npm can leave sh -c alive when only the npm PID is killed. Observe the
    // nearest npm ancestor too, without tying hosts to arbitrary ancestors.
    let mut next = parent;
    for _ in 0..32 {
        let Some((ppid, birth)) = identity(next) else {
            // An ancestor vanished while we captured launch custody.
            unsafe { libc::kill(libc::getpid(), libc::SIGTERM); }
            return;
        };
        if Some(next) == supplied {
            SUPERVISOR.store(next, Ordering::Release);
            if next != parent { watched.push((next, birth.clone())); }
        }
        if npm(next) { if next != parent { watched.push((next, birth)); } break; }
        if ppid <= 1 { break; }
        next = ppid;
    }
    #[cfg(target_os = "linux")]
    unsafe {
        libc::signal(libc::SIGWINCH, parent_notification as *const () as libc::sighandler_t);
        libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGWINCH as libc::c_ulong, 0, 0, 0);
        if libc::getppid() as u32 != parent { libc::kill(libc::getpid(), libc::SIGTERM); }
    }
    // Required on Linux too: handles npm above sh and the thread caveat. On
    // Darwin the same birth-checked watchdog is the parent-death mechanism.
    std::thread::Builder::new().name("supervisor".into()).spawn(move || loop {
        std::thread::sleep(Duration::from_millis(250));
        if unsafe { libc::getppid() } as u32 != parent || watched.iter().any(|(pid, birth)| identity(*pid).is_none_or(|(_, current)| current != *birth)) {
            unsafe { libc::kill(libc::getpid(), libc::SIGTERM); }
            return;
        }
    }).expect("start parent-death watchdog");
}
