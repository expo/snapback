//! The npm wrapper (`bin/snapback4.js`) runs this binary as its child and
//! forwards SIGINT, SIGTERM and SIGHUP. A SIGKILL to the wrapper cannot be
//! forwarded, so the wrapper names itself in `SNAPBACK4_SUPERVISOR_PID` and the
//! binary stops itself, with SIGTERM's orderly cleanup, once that parent is
//! gone: on Linux the kernel delivers it (`PR_SET_PDEATHSIG`), elsewhere a
//! thread notices the reparenting within 250 ms.
// @ref LLP 3000.011.004.000#6 — a scripted dev stops with its wrapper, even one killed by SIGKILL.
use std::sync::atomic::{AtomicU32, Ordering};

pub(crate) const ENV: &str = "SNAPBACK4_SUPERVISOR_PID";
static SUPERVISOR: AtomicU32 = AtomicU32::new(0);

/// The wrapper's PID when this process runs under it.
pub(crate) fn pid() -> Option<u32> { Some(SUPERVISOR.load(Ordering::Acquire)).filter(|pid| *pid != 0) }

/// Process entry, before any thread starts: read and clear the wrapper's PID
/// (children such as the dev worker must not inherit it), then tie this
/// process's life to it.
pub(crate) fn adopt() {
    let Some(value) = std::env::var_os(ENV) else { return };
    // SAFETY: process entry, before any thread is started.
    unsafe { std::env::remove_var(ENV) };
    let Some(pid) = value.to_str().and_then(|text| text.parse::<u32>().ok()).filter(|pid| *pid > 1) else { return };
    // A variable inherited from elsewhere names someone else's process: only
    // the parent that launched us supervises us.
    let parent = unsafe { libc::getppid() } as u32;
    if parent != pid {
        let alive = unsafe { libc::kill(pid as libc::pid_t, 0) } == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM);
        if alive { return; }
        // The wrapper died between spawning us and now: its server must not start.
        eprintln!("SNAPBACK4_SIGNAL reason=\"supervisor {pid} exited before start\"");
        std::process::exit(128 + libc::SIGTERM);
    }
    SUPERVISOR.store(pid, Ordering::Release);
    #[cfg(target_os = "linux")]
    unsafe {
        libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM as libc::c_ulong, 0, 0, 0);
        // The parent may have died before the request took effect.
        if libc::getppid() as u32 != pid { libc::kill(libc::getpid(), libc::SIGTERM); }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = std::thread::Builder::new().name("supervisor".into()).spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(250));
            if unsafe { libc::getppid() } as u32 != pid {
                unsafe { libc::kill(libc::getpid(), libc::SIGTERM); }
                return;
            }
        });
    }
}
