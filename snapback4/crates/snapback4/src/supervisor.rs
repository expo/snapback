//! A host is owned by its launching parent, including npm above a surviving shell.
// @ref LLP 3000.037.000#9-serve-lifetime-and-store-recovery-srv1 — parent death must release ports, pipes and store custody.
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;
#[cfg(target_os = "linux")]
use std::fs;
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
use std::process::Command;

static STARTED: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
pub(crate) fn started() -> u64 { *STARTED.get_or_init(|| std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()) }
fn alive(pid: u32) -> bool {
    if pid == 0 || pid > i32::MAX as u32 { return false; }
    (unsafe { libc::kill(pid as libc::pid_t, 0) }) == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}
fn opaque_identity(pid: u32) -> Option<(u32, String)> {
    alive(pid).then(|| (1, "unverified".into()))
}
fn changed(before: &str, after: &str) -> bool { before != "unverified" && after != "unverified" && before != after }

pub(crate) const ENV: &str = "SNAPBACK4_SUPERVISOR_PID";
static SUPERVISOR: AtomicU32 = AtomicU32::new(0);
static PARENT: AtomicU32 = AtomicU32::new(0);
static PARENTS: std::sync::OnceLock<Vec<(u32, String)>> = std::sync::OnceLock::new();
pub(crate) fn parents() -> &'static [(u32, String)] { PARENTS.get().map(Vec::as_slice).unwrap_or(&[]) }
pub(crate) fn pid() -> Option<u32> { Some(SUPERVISOR.load(Ordering::Acquire)).filter(|pid| *pid != 0) }

/// Stable process birth identity and human-readable start time; zombies are dead.
#[cfg(target_os = "linux")]
pub(crate) fn identity(pid: u32) -> Option<(u32, String)> {
    let text = match fs::read_to_string(format!("/proc/{pid}/stat")) {
        Ok(text) => text,
        // Minimal distribution proofs deliberately omit /proc. Kernel parent
        // notifications and getppid remain authoritative for direct custody.
        Err(_) => return opaque_identity(pid),
    };
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
    #[cfg(target_os = "macos")]
    {
        let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid as i32];
        let mut bytes = vec![0u8; 256 * 1024];
        let mut size = bytes.len();
        if unsafe { libc::sysctl(mib.as_mut_ptr(), 3, bytes.as_mut_ptr().cast(), &mut size, std::ptr::null_mut(), 0) } != 0 { return false; }
        // Kernel argv may include secrets: inspect only for npm identity and
        // never retain or report the bytes. Bound by ARG_MAX, not a subprocess.
        npm_arguments(&bytes[..size.min(bytes.len())])
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
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
    let _ = started();
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
    let _ = PARENTS.set(watched.clone());
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
        if unsafe { libc::getppid() } as u32 != parent || watched.iter().any(|(pid, birth)| identity(*pid).is_none_or(|(_, current)| changed(birth, &current))) {
            unsafe { libc::kill(libc::getpid(), libc::SIGTERM); }
            return;
        }
    }).expect("start parent-death watchdog");
}


// KERN_PROCARGS2 appends environment strings after argv. argc is the boundary;
// an inherited npm_execpath must never make a shell look like npm.
#[cfg(any(target_os = "macos", test))]
fn npm_arguments(bytes: &[u8]) -> bool {
    let Some(header) = bytes.get(..4) else { return false; };
    let argc = i32::from_ne_bytes(header.try_into().unwrap());
    if argc <= 0 || argc as usize > bytes.len() { return false; }
    let rest = &bytes[4..];
    let Some(executable_end) = rest.iter().position(|byte| *byte == 0) else { return false; };
    let mut rest = &rest[executable_end + 1..];
    while rest.first() == Some(&0) { rest = &rest[1..]; }
    let mut found = false;
    for _ in 0..argc {
        let Some(end) = rest.iter().position(|byte| *byte == 0) else { return false; };
        let arg = &rest[..end];
        let assignment = arg.iter().position(|byte| *byte == b'=').is_some_and(|at|
            at > 0 && arg[..at].iter().enumerate().all(|(i, byte)| byte.is_ascii_alphabetic() || *byte == b'_' || (i > 0 && byte.is_ascii_digit())));
        if !assignment {
            found |= arg.starts_with(b"npm ") || arg == b"npm" || arg.ends_with(b"/npm-cli.js") || arg.windows(12).any(|part| part == b"/npm-cli.js ");
        }
        rest = &rest[end + 1..];
    }
    found
}

#[cfg(test)]
mod tests {
    use super::npm_arguments;
    fn arguments(argv: &[&str], env: &[&str]) -> Vec<u8> {
        let mut bytes = (argv.len() as i32).to_ne_bytes().to_vec();
        bytes.extend_from_slice(b"/usr/local/bin/node\0\0\0");
        for arg in argv.iter().chain(env) { bytes.extend_from_slice(arg.as_bytes()); bytes.push(0); }
        bytes
    }
    #[test]
    fn missing_process_table_does_not_turn_a_living_process_into_a_dead_parent() {
        let current = super::opaque_identity(std::process::id()).unwrap();
        assert_eq!(current.1, "unverified");
        assert!(super::opaque_identity(u32::MAX).is_none());
        assert!(!super::changed("unverified", "12345"));
        assert!(!super::changed("12345", "unverified"));
        assert!(super::changed("12345", "12346"));
    }
    #[test]
    fn darwin_npm_argv_never_inspects_inherited_environment() {
        let env = ["npm_execpath=/usr/local/lib/npm/bin/npm-cli.js", "npm_lifecycle_event=prod:serve"];
        assert!(!npm_arguments(&arguments(&["node", "scripts/prod-serve.mjs"], &env)));
        assert!(!npm_arguments(&arguments(&["sh", "-c", "node scripts/prod-serve.mjs"], &env)));
        assert!(npm_arguments(&arguments(&["node", "/usr/local/lib/npm/bin/npm-cli.js", "run", "prod:serve"], &env)));
        assert!(npm_arguments(&arguments(&["npm run prod:serve"], &env)));
        assert!(npm_arguments(&arguments(&["npm run prod:serve -- --port=3000"], &env)));
        assert!(npm_arguments(&arguments(&["node", "/prefix=a/npm-cli.js"], &env)));
        assert!(!npm_arguments(&arguments(&["node", "driver.mjs"], &["/prefix/npm-cli.js"])));
        assert!(!npm_arguments(&[1, 2, 3]));
        let mut truncated = arguments(&["node"], &[]); truncated.pop();
        assert!(!npm_arguments(&truncated));
    }
}
