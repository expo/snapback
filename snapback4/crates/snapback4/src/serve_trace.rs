//! Opt-in qualification trace. No arguments, tokens, answers or retained samples.
//! The harness and server use one host monotonic clock; no wall-clock alignment.
use std::{cell::RefCell, fs::{File, OpenOptions}, io::Write, sync::{Mutex, OnceLock}, time::Instant};
use serde::Serialize;
use tiny_http::Request;

static OUTPUT: OnceLock<Option<Mutex<File>>> = OnceLock::new();
fn output() -> Option<&'static Mutex<File>> {
    OUTPUT.get_or_init(|| std::env::var_os("SNAPBACK4_READ_TRACE")
        .map(|path| Mutex::new(OpenOptions::new().create_new(true).write(true).open(path)
            .expect("SNAPBACK4_READ_TRACE must name a new writable qualification file")))).as_ref()
}

// Same clock as Node 24's uv_hrtime: CLOCK_MONOTONIC on Linux and
// mach_continuous_time on Darwin. Sleep is forbidden during qualification.
pub(super) fn now() -> u64 {
    #[cfg(target_os = "macos")]
    unsafe {
        let mut info = libc::mach_timebase_info_data_t { numer: 0, denom: 0 };
        libc::mach_timebase_info(&mut info);
        unsafe extern "C" { fn mach_continuous_time() -> u64; }
        return (mach_continuous_time() as u128 * info.numer as u128 / info.denom as u128) as u64;
    }
    #[cfg(not(target_os = "macos"))]
    unsafe {
        let mut t = libc::timespec { tv_sec: 0, tv_nsec: 0 };
        assert_eq!(libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut t), 0);
        t.tv_sec as u64 * 1_000_000_000 + t.tv_nsec as u64
    }
}

#[derive(Serialize)]
pub(super) struct Trace {
    id: u64, accepted: u64, dispatched: u64, started: u64,
    query_start: u64, query_end: u64, encode_start: u64, encode_end: u64,
    write_start: u64, write_end: u64, mutation_commit: u64,
    mutex_wait: u64, readers_wait: u64, engine_wait: u64,
    thread_id: u64, cpu_start: i32, cpu_end: i32, query_cpu_start: i32, query_cpu_end: i32,
    cpu_ns_start: u64, cpu_ns_end: u64,
}
thread_local! { static CURRENT: RefCell<Option<Trace>> = const { RefCell::new(None) }; }
impl Trace {
    pub(super) fn capture(request: &Request, dev: bool) -> Option<Self> {
        if !dev || output().is_none() { return None; }
        let id = request.headers().iter().find(|h| h.field.equiv("x-snapback-ct"))?.value.as_str().parse().ok()?;
        let dispatched = now();
        Some(Self { id, accepted: dispatched.saturating_sub(request.accepted_at().elapsed().as_nanos() as u64),
            dispatched, started: 0, query_start: 0, query_end: 0, encode_start: 0, encode_end: 0,
            write_start: 0, write_end: 0, mutation_commit: 0, mutex_wait: 0, readers_wait: 0, engine_wait: 0,
            thread_id: 0, cpu_start: -1, cpu_end: -1, query_cpu_start: -1, query_cpu_end: -1, cpu_ns_start: 0, cpu_ns_end: 0 })
    }
    pub(super) fn run(mut self, body: impl FnOnce()) {
        self.started = now();
        self.thread_id = thread_id();
        self.cpu_start = cpu();
        self.cpu_ns_start = thread_cpu_ns();
        CURRENT.with(|slot| { assert!(slot.borrow().is_none()); *slot.borrow_mut() = Some(self); });
        struct Finish;
        impl Drop for Finish {
            fn drop(&mut self) {
                if let Some(mut trace) = CURRENT.with(|slot| slot.take()) {
                    trace.cpu_end = cpu();
                    trace.cpu_ns_end = thread_cpu_ns();
                    // After the response; only the explicitly enabled harness pays file I/O.
                    let mut file = output().unwrap().lock().unwrap_or_else(|e| e.into_inner());
                    serde_json::to_writer(&mut *file, &trace).expect("qualification trace write");
                    file.write_all(b"\n").expect("qualification trace write");
                }
            }
        }
        let _finish = Finish;
        body();
    }
}
pub(super) fn begin() -> Option<Instant> { CURRENT.with(|slot| slot.borrow().as_ref().map(|_| Instant::now())) }
pub(super) fn waited(start: Option<Instant>, kind: &str) {
    if let Some(start) = start { CURRENT.with(|slot| { if let Some(t) = slot.borrow_mut().as_mut() {
        let ns = start.elapsed().as_nanos() as u64;
        match kind { "engine" => t.engine_wait += ns, "readers" => t.readers_wait += ns, _ => t.mutex_wait += ns }
    } }); }
}
pub(super) fn mark(stage: &str) {
    CURRENT.with(|slot| { if let Some(t) = slot.borrow_mut().as_mut() {
        let at = now();
        match stage { "query_start" => { t.query_start = at; t.query_cpu_start = cpu(); }, "query_end" => { t.query_end = at; t.query_cpu_end = cpu(); },
            "encode_start" => t.encode_start = at, "encode_end" => t.encode_end = at,
            "mutation_commit" => t.mutation_commit = at,
            "write_start" => t.write_start = at, "write_end" if t.write_end == 0 => t.write_end = at, "write_end" => {}, _ => unreachable!() }
    } });
}

fn cpu() -> i32 {
    #[cfg(target_os = "linux")] { unsafe { libc::sched_getcpu() } }
    #[cfg(not(target_os = "linux"))] { -1 }
}
fn thread_id() -> u64 {
    #[cfg(target_os = "linux")] { unsafe { libc::syscall(libc::SYS_gettid) as u64 } }
    #[cfg(target_os = "macos")] { let mut id = 0; unsafe { libc::pthread_threadid_np(0, &mut id); } id }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))] { 0 }
}
fn thread_cpu_ns() -> u64 {
    let mut t = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    if unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) } != 0 { return 0; }
    t.tv_sec as u64 * 1_000_000_000 + t.tv_nsec as u64
}
