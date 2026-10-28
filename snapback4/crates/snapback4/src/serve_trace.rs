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

#[derive(Clone, Serialize)]
pub(super) struct Trace {
    id: u64, accepted: u64, dispatched: u64, started: u64,
    query_start: u64, query_end: u64, encode_start: u64, encode_end: u64,
    write_start: u64, write_end: u64, mutation_commit: u64,
    mutex_wait: u64, readers_wait: u64, engine_wait: u64,
    writer_thread_id: u64, writer_cpu_ns: u64,
    parser_cpu_ns:Option<u64>, parsed:u64, lookup_start:u64, lookup_end:u64, lookup_cpu_start:u64, lookup_cpu_end:u64,
    query_cpu_ns_start:u64, query_cpu_ns_end:u64, encode_cpu_start:u64, encode_cpu_end:u64,
    parked_start: u64, parked_end: u64, resumed: u64, active_cpu_ns: u64,
    thread_id: u64, cpu_start: i32, cpu_end: i32, query_cpu_start: i32, query_cpu_end: i32,
    cpu_ns_start: u64, cpu_ns_end: u64,
}
thread_local! { static CURRENT: RefCell<Option<Trace>> = const { RefCell::new(None) }; }
impl Trace {
    pub(super) fn capture(request: &Request, dev: bool) -> Option<Self> {
        if output().is_none() || (!dev && std::env::var_os("SNAPBACK4_READ_TRACE_ALL").is_none()) { return None; }
        let id = request.headers().iter().find(|h| h.field.equiv("x-snapback-ct")).and_then(|h|h.value.as_str().parse().ok()).or_else(||std::env::var_os("SNAPBACK4_READ_TRACE_ALL").map(|_|now()))?;
        let dispatched = now();
        Some(Self { id, accepted: dispatched.saturating_sub(request.accepted_at().elapsed().as_nanos() as u64),
            dispatched, started: 0, query_start: 0, query_end: 0, encode_start: 0, encode_end: 0,
            write_start: 0, write_end: 0, mutation_commit: 0, mutex_wait: 0, readers_wait: 0, engine_wait: 0,
            writer_thread_id: 0, writer_cpu_ns: 0, parser_cpu_ns:request.parser_cpu_ns(), parsed:0, lookup_start:0, lookup_end:0, lookup_cpu_start:0, lookup_cpu_end:0, query_cpu_ns_start:0, query_cpu_ns_end:0, encode_cpu_start:0, encode_cpu_end:0, parked_start:0, parked_end:0, resumed:0, active_cpu_ns:0,
            thread_id: 0, cpu_start: -1, cpu_end: -1, query_cpu_start: -1, query_cpu_end: -1, cpu_ns_start: 0, cpu_ns_end: 0 })
    }
    pub(super) fn run(mut self, body: impl FnOnce()) {
        if self.started==0 {self.started = now();} else {self.resumed=now();}
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
                    trace.active_cpu_ns+=trace.cpu_ns_end.saturating_sub(trace.cpu_ns_start);
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
        match stage { "query_start" => { t.query_start = at; t.query_cpu_start = cpu(); t.query_cpu_ns_start=thread_cpu_ns(); }, "query_end" => { t.query_end = at; t.query_cpu_end = cpu(); t.query_cpu_ns_end=thread_cpu_ns(); },
            "parsed" => t.parsed=at,
            "lookup_start" => {t.lookup_start=at;t.lookup_cpu_start=thread_cpu_ns();},
            "lookup_end" => {t.lookup_end=at;t.lookup_cpu_end=thread_cpu_ns();},
            "encode_start" => {t.encode_start = at;t.encode_cpu_start=thread_cpu_ns();}, "encode_end" => {t.encode_end = at;t.encode_cpu_end=thread_cpu_ns();},
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

pub(super) fn worker_sample() -> Option<(Trace, Instant)> {
    CURRENT.with(|slot| slot.borrow().as_ref().cloned().map(|trace| (trace, Instant::now())))
}
pub(super) fn run_worker<T>(sample: Option<(Trace, Instant)>, run: impl FnOnce() -> T) -> (T, Option<Trace>) {
    let Some((mut trace, queued)) = sample else { return (run(), None); };
    trace.engine_wait += queued.elapsed().as_nanos() as u64;
    trace.writer_thread_id = thread_id();
    let cpu_start = thread_cpu_ns();
    CURRENT.with(|slot| { assert!(slot.borrow().is_none()); *slot.borrow_mut() = Some(trace); });
    struct Clear;
    impl Drop for Clear { fn drop(&mut self) { CURRENT.with(|slot| { slot.take(); }); } }
    let _clear = Clear;
    let value = run();
    let trace = CURRENT.with(|slot| slot.take()).map(|mut trace| {
        trace.writer_cpu_ns += thread_cpu_ns().saturating_sub(cpu_start); trace
    });
    (value, trace)
}
pub(super) fn merge_worker(trace: Option<Trace>) {
    if let Some(trace) = trace { CURRENT.with(|slot| *slot.borrow_mut() = Some(trace)); }
}

pub(super) fn suspend()->Option<Trace> {
    CURRENT.with(|slot|slot.take()).map(|mut trace| {
        trace.parked_start=now();
        trace.active_cpu_ns+=thread_cpu_ns().saturating_sub(trace.cpu_ns_start);trace
    })
}
pub(super) fn unpark(trace:&mut Option<Trace>) {if let Some(trace)=trace {trace.parked_end=now();}}

pub(super) fn install_parser_clock() {
    if std::env::var_os("SNAPBACK4_READ_TRACE_ALL").is_some() {
        tiny_http::set_parser_cpu_clock(|| {let n=thread_cpu_ns();(n>0).then_some(n)});
    }
}
