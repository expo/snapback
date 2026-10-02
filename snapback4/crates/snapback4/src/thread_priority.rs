//! Scheduling hints, never a privileged scheduling policy or a latency guarantee.
// @ref LLP 3000#contended-read-serving — readers outrank our background work.

use std::{collections::BTreeMap, sync::Mutex};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Failure { count: usize, last_errno: i32, last_at_ms: u64 }
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Diagnostics {
    qos_failures: usize,
    failures: BTreeMap<&'static str, Failure>,
    startup_readback: &'static str,
}
static DIAGNOSTICS: Mutex<Diagnostics> = Mutex::new(Diagnostics {
    qos_failures: 0, failures: BTreeMap::new(), startup_readback: "not performed",
});
pub(crate) fn diagnostics() -> Diagnostics {
    DIAGNOSTICS.lock().unwrap_or_else(|e| e.into_inner()).clone()
}
impl Diagnostics {
    #[cfg(any(test, target_os = "macos"))]
    fn failure(&mut self, class: &'static str, error: i32, at: u64) {
        self.qos_failures += 1;
        let entry = self.failures.entry(class).or_insert(Failure { count: 0, last_errno: 0, last_at_ms: 0 });
        entry.count += 1;
        entry.last_errno = error;
        entry.last_at_ms = at;
    }
}
#[cfg(target_os = "macos")]
fn qos(class: libc::qos_class_t, thread_class: &'static str) -> i32 {
    record_qos(thread_class, class, unsafe { libc::pthread_set_qos_class_self_np(class, 0) })
}
#[cfg(target_os = "macos")]
fn record_qos(thread_class: &'static str, class: libc::qos_class_t, error: i32) -> i32 {
    if error != 0 {
        let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
        DIAGNOSTICS.lock().unwrap_or_else(|e| e.into_inner()).failure(thread_class, error, at);
        snapback4_core::diagnostic!("snapback4: thread QoS failed (thread class {thread_class}, requested {}, errno {error}, at unix ms {at}); inspect doctor host.scheduling: {}", class as u32, std::io::Error::from_raw_os_error(error));
    }
    error
}
// Called before creating accept/parsing threads. On failure, only a confirmed
// default-or-higher caller may proceed; utility inheritance never serves HTTP.
pub(crate) fn request_parent() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    { establish_request(true, |class| qos(class, "http-startup")) }
    #[cfg(not(target_os = "macos"))]
    { Ok(()) }
}
#[cfg(target_os = "macos")]
fn establish_request(startup: bool, set: impl FnOnce(libc::qos_class_t) -> i32) -> Result<(), String> {
    let setter = set(libc::qos_class_t::QOS_CLASS_USER_INITIATED);
    if startup || setter != 0 {
        let mut class = libc::qos_class_t::QOS_CLASS_UNSPECIFIED;
        let error = unsafe { libc::pthread_get_qos_class_np(libc::pthread_self(), &mut class, std::ptr::null_mut()) };
        let passed = error == 0 && matches!(class, libc::qos_class_t::QOS_CLASS_DEFAULT | libc::qos_class_t::QOS_CLASS_USER_INITIATED | libc::qos_class_t::QOS_CLASS_USER_INTERACTIVE);
        if startup {
            DIAGNOSTICS.lock().unwrap_or_else(|e| e.into_inner()).startup_readback = if passed { "passed: default or higher" } else { "failed: below default or unknown" };
        }
        if !passed {
            return Err("cannot establish default-or-higher HTTP QoS; refusing to serve at utility or unknown priority".into());
        }
    }
    Ok(())
}
pub(crate) fn request() {
    #[cfg(target_os = "macos")]
    establish_request(false, |class| qos(class, "http")).expect("HTTP thread inherited an invalid QoS class");
    // Linux never changes the creator's nice: restoring it needs privilege.
}
// Lease recovery, expiry and schedules have a real-time completion obligation.
// Keep Linux's inherited priority and select Darwin default (not utility).
pub(crate) fn maintenance() {
    #[cfg(target_os = "macos")]
    { qos(libc::qos_class_t::QOS_CLASS_DEFAULT, "maintenance"); }
}
pub(crate) fn background() {
    #[cfg(target_os = "macos")]
    { qos(libc::qos_class_t::QOS_CLASS_UTILITY, "background"); }
    #[cfg(target_os = "linux")]
    unsafe {
        let current = libc::getpriority(libc::PRIO_PROCESS, 0);
        if current < 5 { libc::setpriority(libc::PRIO_PROCESS, 0, 5); }
    }
}
pub(crate) fn dispatcher() {
    // Keep Linux's thread-creation parent unchanged: otherwise its children
    // could never regain the original priority in an unprivileged process.
    request();
}

#[cfg(all(test, target_os = "macos"))]
pub(crate) fn current_qos() -> u32 {
    let mut class = libc::qos_class_t::QOS_CLASS_UNSPECIFIED;
    assert_eq!(unsafe { libc::pthread_get_qos_class_np(libc::pthread_self(), &mut class, std::ptr::null_mut()) }, 0);
    class as u32
}

#[cfg(test)]
mod tests {
    #[test]
    fn later_failures_preserve_startup_evidence_and_identify_each_class() {
        let mut state = super::Diagnostics { qos_failures: 0, failures: Default::default(), startup_readback: "passed: default or higher" };
        state.failure("maintenance", libc::EINVAL, 1234);
        state.failure("background", libc::EPERM, 2345);
        state.failure("maintenance", libc::EINVAL, 3456);
        let wire = serde_json::to_value(state).unwrap();
        assert_eq!(wire["startupReadback"], "passed: default or higher");
        assert_eq!(wire["qosFailures"], 3);
        assert_eq!(wire["failures"]["maintenance"]["count"], 2);
        assert_eq!(wire["failures"]["maintenance"]["lastAtMs"], 3456);
        assert_eq!(wire["failures"]["background"]["lastErrno"], libc::EPERM);
    }

    #[test]
    fn background_priority_is_lower_without_changing_its_parent() {
        #[cfg(target_os = "linux")]
        let parent = unsafe { libc::getpriority(libc::PRIO_PROCESS, 0) };
        std::thread::spawn(|| {
            super::background();
            #[cfg(target_os = "linux")]
            assert!(unsafe { libc::getpriority(libc::PRIO_PROCESS, 0) } >= 5);
            #[cfg(target_os = "macos")]
            assert_eq!(super::current_qos(), libc::qos_class_t::QOS_CLASS_UTILITY as u32);
        }).join().unwrap();
        #[cfg(target_os = "linux")]
        assert_eq!(unsafe { libc::getpriority(libc::PRIO_PROCESS, 0) }, parent);
    }
    #[test]
    fn maintenance_keeps_ordinary_priority() {
        #[cfg(target_os = "linux")]
        let parent = unsafe { libc::getpriority(libc::PRIO_PROCESS, 0) };
        std::thread::spawn(move || {
            super::maintenance();
            #[cfg(target_os = "linux")]
            assert_eq!(unsafe { libc::getpriority(libc::PRIO_PROCESS, 0) }, parent);
            #[cfg(target_os = "macos")]
            assert_eq!(super::current_qos(), libc::qos_class_t::QOS_CLASS_DEFAULT as u32);
        }).join().unwrap();
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn failed_raise_is_reported_and_cannot_admit_utility_inheritance() {
        std::thread::spawn(|| {
            let before = super::diagnostics().qos_failures;
            assert_eq!(super::qos(libc::qos_class_t::QOS_CLASS_UTILITY, "background"), 0);
            assert!(super::establish_request(false, |class| super::record_qos("http", class, libc::EINVAL)).is_err());
            assert_eq!(super::qos(libc::qos_class_t::QOS_CLASS_DEFAULT, "maintenance"), 0);
            assert!(super::establish_request(false, |class| super::record_qos("http", class, libc::EINVAL)).is_ok());
            assert!(super::diagnostics().qos_failures >= before + 2);
        }).join().unwrap();
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn intake_and_request_inheritance_are_user_initiated() {
        std::thread::spawn(|| {
            super::request_parent().unwrap();
            assert_eq!(super::current_qos(), libc::qos_class_t::QOS_CLASS_USER_INITIATED as u32);
            std::thread::spawn(|| {
                super::dispatcher();
                assert_eq!(super::current_qos(), libc::qos_class_t::QOS_CLASS_USER_INITIATED as u32);
            }).join().unwrap();
        }).join().unwrap();
    }
}
