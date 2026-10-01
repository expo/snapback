//! Scheduling hints, never a privileged scheduling policy or a latency guarantee.
// @ref LLP 3000#contended-read-serving — readers outrank our background work.

#[cfg(target_os = "macos")]
fn qos(class: libc::qos_class_t) {
    let error = unsafe { libc::pthread_set_qos_class_self_np(class, 0) };
    if error != 0 { snapback4_core::diagnostic!("snapback4: thread QoS hint failed: {}", std::io::Error::from_raw_os_error(error)); }
}
pub(crate) fn request() {
    #[cfg(target_os = "macos")]
    qos(libc::qos_class_t::QOS_CLASS_USER_INITIATED);
    // Linux cannot raise an inherited nice value without privilege. Request
    // workers inherit the unchanged dispatcher's priority.
}
pub(crate) fn background() {
    #[cfg(target_os = "macos")]
    qos(libc::qos_class_t::QOS_CLASS_UTILITY);
    #[cfg(target_os = "linux")]
    unsafe {
        let current = libc::getpriority(libc::PRIO_PROCESS, 0);
        if current < 5 { libc::setpriority(libc::PRIO_PROCESS, 0, 5); }
    }
}
pub(crate) fn dispatcher() {
    // Keep Linux's thread-creation parent unchanged: otherwise its children
    // could never regain the original priority in an unprivileged process.
    #[cfg(target_os = "macos")]
    qos(libc::qos_class_t::QOS_CLASS_UTILITY);
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
    #[cfg(target_os = "macos")]
    #[test]
    fn request_worker_explicitly_raises_utility_inheritance() {
        std::thread::spawn(|| {
            super::background();
            std::thread::spawn(|| {
                super::request();
                assert_eq!(super::current_qos(), libc::qos_class_t::QOS_CLASS_USER_INITIATED as u32);
            }).join().unwrap();
        }).join().unwrap();
    }
}
