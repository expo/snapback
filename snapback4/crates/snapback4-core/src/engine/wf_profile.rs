//! Opt-in numeric clocks for the loopback WF witness; absent from product builds.
use std::time::Instant;
pub(crate) fn enabled() -> bool {
    static ENABLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ENABLED.get_or_init(|| std::env::var("SNAPBACK4_WF_PROFILE").as_deref() == Ok("1"))
}
fn cpu() -> u64 {
    #[cfg(all(target_os = "linux", feature = "postgres"))]
    {
        let time = rustix::time::clock_gettime(rustix::time::ClockId::ThreadCPUTime);
        return time.tv_sec as u64 * 1_000_000_000 + time.tv_nsec as u64;
    }
    #[cfg(not(all(target_os = "linux", feature = "postgres")))]
    {0}
}
fn records() -> &'static std::sync::Mutex<Vec<serde_json::Value>> {
    static RECORDS:std::sync::OnceLock<std::sync::Mutex<Vec<serde_json::Value>>>=std::sync::OnceLock::new();
    RECORDS.get_or_init(||std::sync::Mutex::new(Vec::new()))
}
pub(crate) fn record(stage: &str, wall: std::time::Duration, cpu: u64, n: usize) {
    if enabled() {
        records().lock().unwrap().push(serde_json::json!({"stage":stage,"wall_ns":wall.as_nanos(),"cpu_ns":cpu,"n":n}));
    }
}
pub(crate) fn flush() {
    for value in std::mem::take(&mut *records().lock().unwrap()) {eprintln!("WF_STAGE {value}");}
}
pub(crate) struct Scope(&'static str, Instant, u64, usize);
impl Scope {
    pub(crate) fn new(stage: &'static str, n: usize) -> Option<Self> {
        enabled().then(|| Self(stage, Instant::now(), cpu(), n))
    }
}
impl Drop for Scope {
    fn drop(&mut self) { record(self.0, self.1.elapsed(), cpu().saturating_sub(self.2), self.3); }
}

thread_local! { static CONFIRMED: std::cell::Cell<Option<Instant>> = const {std::cell::Cell::new(None)}; }
pub(crate) fn confirmed(at:Instant) {CONFIRMED.with(|c|c.set(Some(at)));}
pub(crate) fn reply() {if enabled() {CONFIRMED.with(|c|{if let Some(at)=c.get() {record("reply_release",at.elapsed(),0,1);}});}}
