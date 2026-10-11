//! Process diagnostics must not acquire the engine (or stderr's Rust mutex):
//! the failing thread may already hold either. Signals use only atomics, a
//! stack buffer and write(2), including a real SIGBUS from a lost WAL mapping.
use std::fmt::{self, Write};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};

static GENERATION: AtomicU64 = AtomicU64::new(0);
static DEV: AtomicBool = AtomicBool::new(false);
static SIGNAL: AtomicI32 = AtomicI32::new(0);
static MANAGED_CLEANUP: AtomicBool = AtomicBool::new(false);

struct Line<const N: usize> { bytes: [u8; N], len: usize }
impl<const N: usize> Line<N> {
    fn new() -> Self { Self { bytes: [0; N], len: 0 } }
    fn send(mut self) {
        self.bytes[self.len] = b'\n';
        // One unbuffered write keeps short lines intact under redirection.
        // A closed/full descriptor cannot be made into a logging guarantee.
        unsafe { libc::write(libc::STDERR_FILENO, self.bytes.as_ptr().cast(), self.len + 1); }
    }
    fn number(&mut self, mut n: u64) {
        let mut digits = [0; 20];
        let mut at = digits.len();
        loop {
            at -= 1; digits[at] = b'0' + (n % 10) as u8; n /= 10;
            if n == 0 { break; }
        }
        for digit in &digits[at..] { self.bytes[self.len] = *digit; self.len += 1; }
    }
    fn prefix(&mut self, code: &str) {
        let _ = self.write_str(code);
        let _ = self.write_str(if DEV.load(Ordering::Relaxed) { " verb=dev generation=" } else { " verb=serve generation=" });
        self.number(GENERATION.load(Ordering::Acquire));
    }
}
impl<const N: usize> Write for Line<N> {
    fn write_str(&mut self, text: &str) -> fmt::Result {
        let mut count = text.len().min(self.bytes.len() - 1 - self.len);
        while !text.is_char_boundary(count) { count -= 1; }
        self.bytes[self.len..self.len + count].copy_from_slice(&text.as_bytes()[..count]);
        self.len += count;
        Ok(())
    }
}

pub(crate) fn generation(next: u64) { GENERATION.store(next, Ordering::Release); }
pub(crate) fn stopping() -> bool { SIGNAL.load(Ordering::Acquire) != 0 }
pub(crate) fn managed_cleanup() { MANAGED_CLEANUP.store(true, Ordering::Release); }

fn signal_name(signal: i32) -> &'static str {
    match signal {
        libc::SIGINT => "SIGINT", libc::SIGTERM => "SIGTERM", libc::SIGHUP => "SIGHUP",
        libc::SIGQUIT => "SIGQUIT", libc::SIGABRT => "SIGABRT", libc::SIGBUS => "SIGBUS",
        libc::SIGSEGV => "SIGSEGV", libc::SIGILL => "SIGILL", libc::SIGFPE => "SIGFPE",
        libc::SIGALRM => "SIGALRM", libc::SIGUSR1 => "SIGUSR1", libc::SIGUSR2 => "SIGUSR2",
        libc::SIGTRAP => "SIGTRAP", libc::SIGSYS => "SIGSYS", libc::SIGXCPU => "SIGXCPU",
        libc::SIGXFSZ => "SIGXFSZ", libc::SIGVTALRM => "SIGVTALRM", libc::SIGPROF => "SIGPROF",
        #[cfg(target_os = "macos")]
        libc::SIGEMT => "SIGEMT",
        #[cfg(target_os = "linux")]
        libc::SIGPOLL => "SIGPOLL",
        #[cfg(target_os = "linux")]
        libc::SIGPWR => "SIGPWR",
        #[cfg(target_os = "linux")]
        libc::SIGSTKFLT => "SIGSTKFLT",
        _ => "unknown",
    }
}

extern "C" fn signal_received(signal: libc::c_int) {
    #[cfg(target_os = "macos")]
    let errno = unsafe { libc::__error() };
    #[cfg(target_os = "linux")]
    let errno = unsafe { libc::__errno_location() };
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let saved_errno = unsafe { *errno };
    // @ref LLP 3000#7-decisions-during-execution — signal frames share a small alternate stack.
    let mut line = Line::<256>::new();
    // A signal can interrupt stderr formatting after a partial line.
    let _ = line.write_str("\n");
    line.prefix("SNAPBACK4_SIGNAL");
    let _ = line.write_str(" reason=");
    let _ = line.write_str(signal_name(signal));
    let _ = line.write_str(" signal=");
    line.number(signal as u64);
    line.send();
    if matches!(signal, libc::SIGINT | libc::SIGTERM | libc::SIGHUP) && MANAGED_CLEANUP.load(Ordering::Acquire) {
        SIGNAL.store(signal, Ordering::Release);
    } else {
        // Terminate immediately when there is no cleanup, and preserve fatal
        // signals' OS status/crash report in every mode.
        unsafe { libc::signal(signal, libc::SIG_DFL); libc::raise(signal); }
    }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    unsafe { *errno = saved_errno; }
}

pub(crate) fn install(verb: &str) -> Result<(), String> {
    DEV.store(verb == "dev", Ordering::Relaxed);
    std::panic::set_hook(Box::new(|info| {
        let thread = std::thread::current();
        let reason = info.payload().downcast_ref::<&str>().copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(String::as_str)).unwrap_or("non-string panic payload");
        let mut line = Line::<4096>::new();
        line.prefix("SNAPBACK4_PANIC");
        let _ = write!(line, " thread={:?} action={} reason={reason:?}", thread.name().unwrap_or("unnamed"), if cfg!(panic = "abort") { "abort" } else { "unwind" });
        if let Some(at) = info.location() { let _ = write!(line, " location={}:{}:{}", at.file(), at.line(), at.column()); }
        line.send();
    }));
    let signals = [libc::SIGINT, libc::SIGTERM, libc::SIGHUP, libc::SIGQUIT, libc::SIGABRT, libc::SIGBUS, libc::SIGSEGV, libc::SIGILL, libc::SIGFPE, libc::SIGALRM, libc::SIGUSR1, libc::SIGUSR2, libc::SIGTRAP, libc::SIGSYS, libc::SIGXCPU, libc::SIGXFSZ, libc::SIGVTALRM, libc::SIGPROF,
        #[cfg(target_os = "macos")] libc::SIGEMT,
        #[cfg(target_os = "linux")] libc::SIGPOLL,
        #[cfg(target_os = "linux")] libc::SIGPWR,
        #[cfg(target_os = "linux")] libc::SIGSTKFLT,
    ];
    for signal in signals {
        let mut action: libc::sigaction = unsafe { std::mem::zeroed() };
        action.sa_sigaction = signal_received as *const () as libc::sighandler_t;
        action.sa_flags = libc::SA_RESTART | libc::SA_ONSTACK;
        if !matches!(signal, libc::SIGINT | libc::SIGTERM | libc::SIGHUP) { action.sa_flags |= libc::SA_RESETHAND; }
        unsafe {
            libc::sigemptyset(&mut action.sa_mask);
            if libc::sigaction(signal, &action, std::ptr::null_mut()) != 0 {
                return Err(format!("cannot install {} handler: {}", signal_name(signal), std::io::Error::last_os_error()));
            }
        }
    }
    Ok(())
}

pub(crate) fn finish(result: Result<(), String>) -> i32 {
    let signal = SIGNAL.load(Ordering::Acquire);
    if signal != 0 { return 128 + signal; } // The handler already reported the reason, before cleanup.
    let (status, reason) = match result { Ok(()) => (0, "server loop returned".to_owned()), Err(reason) => (1, reason) };
    // A multi-line refusal (a rewrite under it) reads as written; the exit line below stays one quoted line.
    if reason.contains('\n') { eprintln!("{reason}"); }
    let mut line = Line::<4096>::new();
    line.prefix("SNAPBACK4_EXIT");
    let _ = write!(line, " status={status} reason={reason:?}");
    line.send();
    status
}

pub(crate) fn run(verb: &str, body: impl FnOnce() -> Result<(), String>) -> i32 {
    finish(install(verb).and_then(|()| body()))
}

pub(crate) fn background(name: &'static str, body: impl FnOnce() + Send + 'static) -> Result<std::thread::JoinHandle<()>, String> {
    std::thread::Builder::new().name(name.into()).spawn(move || {
        crate::thread_priority::maintenance();
        struct Exit(&'static str);
        impl Drop for Exit {
            fn drop(&mut self) {
                let mut line = Line::<4096>::new();
                line.prefix("SNAPBACK4_THREAD_EXIT");
                let reason = if std::thread::panicking() { "panic" } else if stopping() { "shutdown" } else { "unexpected return" };
                let _ = write!(line, " thread={:?} reason={reason:?}", self.0);
                line.send();
            }
        }
        let _exit = Exit(name);
        body();
    }).map_err(|error| format!("cannot start {name} thread: {error}"))
}
