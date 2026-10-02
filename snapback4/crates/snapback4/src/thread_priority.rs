//! Scheduling hints, never a privileged scheduling policy or a latency guarantee.
// @ref LLP 3000#contended-read-serving — readers outrank our background work.

use std::sync::atomic::{AtomicI32, AtomicUsize, Ordering};
static QOS_FAILURES: AtomicUsize = AtomicUsize::new(0);
static QOS_LAST_ERROR: AtomicI32 = AtomicI32::new(0);
pub(crate) fn diagnostics() -> (usize, i32) {
    (QOS_FAILURES.load(Ordering::Relaxed), QOS_LAST_ERROR.load(Ordering::Relaxed))
}
#[cfg(target_os = "macos")]
fn qos(class: libc::qos_class_t) -> i32 {
    record_qos(class, unsafe { libc::pthread_set_qos_class_self_np(class, 0) })
}
#[cfg(target_os = "macos")]
fn record_qos(class: libc::qos_class_t, error: i32) -> i32 {
    if error != 0 {
        QOS_FAILURES.fetch_add(1, Ordering::Relaxed);
        QOS_LAST_ERROR.store(error, Ordering::Relaxed);
        snapback4_core::diagnostic!("snapback4: thread QoS failed (class {}, errno {error}); inspect doctor host.scheduling: {}", class as u32, std::io::Error::from_raw_os_error(error));
    }
    error
}
// Called before creating accept/parsing threads. On failure, only a confirmed
// default-or-higher caller may proceed; utility inheritance never serves HTTP.
pub(crate) fn request_parent() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    { establish_request(qos) }
    #[cfg(not(target_os = "macos"))]
    { Ok(()) }
}
#[cfg(target_os = "macos")]
fn establish_request(set: impl FnOnce(libc::qos_class_t) -> i32) -> Result<(), String> {
    if set(libc::qos_class_t::QOS_CLASS_USER_INITIATED) != 0 {
        let mut class = libc::qos_class_t::QOS_CLASS_UNSPECIFIED;
        let error = unsafe { libc::pthread_get_qos_class_np(libc::pthread_self(), &mut class, std::ptr::null_mut()) };
        if error != 0 || !matches!(class, libc::qos_class_t::QOS_CLASS_DEFAULT | libc::qos_class_t::QOS_CLASS_USER_INITIATED | libc::qos_class_t::QOS_CLASS_USER_INTERACTIVE) {
            return Err("cannot establish default-or-higher HTTP QoS; refusing to serve at utility or unknown priority".into());
        }
    }
    Ok(())
}
pub(crate) fn request() {
    request_parent().expect("HTTP thread inherited an invalid QoS class");
    // Linux never changes the creator's nice: restoring it needs privilege.
}
// Lease recovery, expiry and schedules have a real-time completion obligation.
// Keep Linux's inherited priority and select Darwin default (not utility).
pub(crate) fn maintenance() {
    #[cfg(target_os = "macos")]
    { qos(libc::qos_class_t::QOS_CLASS_DEFAULT); }
}
pub(crate) fn background() {
    #[cfg(target_os = "macos")]
    { qos(libc::qos_class_t::QOS_CLASS_UTILITY); }
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
            let before = super::diagnostics().0;
            assert_eq!(super::qos(libc::qos_class_t::QOS_CLASS_UTILITY), 0);
            assert!(super::establish_request(|class| super::record_qos(class, libc::EINVAL)).is_err());
            assert_eq!(super::qos(libc::qos_class_t::QOS_CLASS_DEFAULT), 0);
            assert!(super::establish_request(|class| super::record_qos(class, libc::EINVAL)).is_ok());
            assert!(super::diagnostics().0 >= before + 2);
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
