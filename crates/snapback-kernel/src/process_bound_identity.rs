//! Exact allocation identity that is valid only in its creator process.
//!
//! On Unix, ordinary `fork()` advances a private lineage generation through a
//! `pthread_atfork` child hook. Equality itself never waits for hook
//! registration: an indeterminate registration state makes every comparison
//! false, while a registered state reads the current PID, loads the lineage
//! atomically, and compares the private allocation. This matters because a
//! child inherits only the thread that called `fork()`; waiting on a lock or
//! `Once` owned by another thread could otherwise wedge the child permanently.
//! A child forked before the hook is installed inherits `REGISTERING` and stays
//! fail-closed until `exec()` rather than trying to complete registration from
//! potentially frozen post-fork runtime state.
//!
//! Raw `clone()`/`clone3` calls that do not run `pthread_atfork` handlers are a
//! platform boundary. The current-PID check still refuses the immediate
//! descendant, but if the original creator exits and its PID is later reused,
//! the private generation cannot distinguish that descendant from the original
//! creator. Callers must use a fork path that runs registered handlers or
//! `exec()` before relying on this identity.

use std::sync::Arc;
use std::sync::atomic::{AtomicU8, AtomicU64, Ordering};

/// Opaque allocation identity whose equality fails closed after a process
/// fork.
///
/// Clones compare equal only while both identities remain in the process that
/// created them. A fresh allocation in that same process compares unequal.
/// The allocation and creator-process stamp are private, so consumers cannot
/// bypass the process check with their own pointer comparison.
///
/// @ref LLP 0303#t-allocation-identity-fails-open-across-fork-and-the-ruling-belongs-here
/// — allocation equality must compare a private creator-process identity with
/// the current process at comparison time; PID equality alone is insufficient.
#[derive(Clone)]
pub struct ProcessBoundIdentity {
    allocation: Arc<()>,
    creator_process: CreatorProcessIdentity,
}

#[derive(Clone, Copy, Eq, PartialEq)]
struct CreatorProcessIdentity {
    lineage_generation: u64,
    process_id: u32,
}

#[cfg(unix)]
const FORK_HOOK_UNREGISTERED: u8 = 0;
#[cfg(unix)]
const FORK_HOOK_REGISTERING: u8 = 1;
#[cfg(unix)]
const FORK_HOOK_REGISTERED: u8 = 2;
#[cfg(unix)]
const FORK_HOOK_FAILED: u8 = 3;

// Registration is deliberately a non-waiting state machine. A comparison that
// observes anything but REGISTERED refuses immediately; it never waits for the
// registering thread. If a fork lands after `pthread_atfork` succeeds but
// before the parent publishes REGISTERED, the child hook itself publishes
// REGISTERED in the child. If it lands earlier, the child inherits REGISTERING
// and remains fail-closed because no surviving thread can finish the attempt.
#[cfg(unix)]
static FORK_HOOK_REGISTRATION_STATE: AtomicU8 = AtomicU8::new(FORK_HOOK_UNREGISTERED);
static CURRENT_PROCESS_LINEAGE_GENERATION: AtomicU64 = AtomicU64::new(1);

#[cfg(all(test, unix))]
static PAUSE_BEFORE_FORK_HOOK_REGISTRATION_FOR_TEST: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
#[cfg(all(test, unix))]
static FORK_HOOK_REGISTRATION_STARTED_FOR_TEST: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
#[cfg(all(test, unix))]
static RELEASE_BEFORE_FORK_HOOK_REGISTRATION_FOR_TEST: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
#[cfg(all(test, unix))]
static PAUSE_AFTER_FORK_HOOK_REGISTRATION_FOR_TEST: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
#[cfg(all(test, unix))]
static FORK_HOOK_REGISTERED_BUT_UNPUBLISHED_FOR_TEST: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
#[cfg(all(test, unix))]
static RELEASE_FORK_HOOK_REGISTRATION_FOR_TEST: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

impl ProcessBoundIdentity {
    /// Mint a fresh allocation identity bound to the current process.
    pub fn new() -> Self {
        #[cfg(unix)]
        ensure_fork_identity_hook_registered();

        Self {
            allocation: Arc::new(()),
            creator_process: current_process_identity(),
        }
    }
}

impl std::fmt::Debug for ProcessBoundIdentity {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ProcessBoundIdentity(..)")
    }
}

impl PartialEq for ProcessBoundIdentity {
    fn eq(&self, other: &Self) -> bool {
        let Some(current_process) = current_process_identity_for_comparison() else {
            return false;
        };
        self.creator_process == current_process
            && other.creator_process == current_process
            && Arc::ptr_eq(&self.allocation, &other.allocation)
    }
}

impl Eq for ProcessBoundIdentity {}

fn current_process_identity() -> CreatorProcessIdentity {
    CreatorProcessIdentity {
        lineage_generation: CURRENT_PROCESS_LINEAGE_GENERATION.load(Ordering::Acquire),
        process_id: current_process_id(),
    }
}

#[cfg(unix)]
fn current_process_identity_for_comparison() -> Option<CreatorProcessIdentity> {
    if FORK_HOOK_REGISTRATION_STATE.load(Ordering::Acquire) != FORK_HOOK_REGISTERED {
        return None;
    }
    Some(current_process_identity())
}

#[cfg(not(unix))]
fn current_process_identity_for_comparison() -> Option<CreatorProcessIdentity> {
    Some(current_process_identity())
}

#[cfg(unix)]
fn current_process_id() -> u32 {
    // SAFETY: POSIX specifies `getpid` as async-signal-safe. It neither
    // allocates nor waits on process-local synchronization after a fork.
    unsafe { libc::getpid() as u32 }
}

#[cfg(not(unix))]
fn current_process_id() -> u32 {
    std::process::id()
}

#[cfg(unix)]
fn ensure_fork_identity_hook_registered() {
    match FORK_HOOK_REGISTRATION_STATE.compare_exchange(
        FORK_HOOK_UNREGISTERED,
        FORK_HOOK_REGISTERING,
        Ordering::AcqRel,
        Ordering::Acquire,
    ) {
        Ok(_) => {}
        Err(FORK_HOOK_REGISTERED | FORK_HOOK_REGISTERING) => return,
        Err(FORK_HOOK_FAILED) => {
            panic!("failed to install the process-bound identity fork hook")
        }
        Err(state) => panic!("invalid process-bound identity fork-hook state {state}"),
    }

    #[cfg(test)]
    if PAUSE_BEFORE_FORK_HOOK_REGISTRATION_FOR_TEST.load(Ordering::Acquire) {
        FORK_HOOK_REGISTRATION_STARTED_FOR_TEST.store(true, Ordering::Release);
        while !RELEASE_BEFORE_FORK_HOOK_REGISTRATION_FOR_TEST.load(Ordering::Acquire) {
            std::hint::spin_loop();
        }
    }

    // SAFETY: the callback has C ABI, captures no Rust state, and performs
    // only lock-free atomic operations in the post-fork child.
    let registered =
        unsafe { libc::pthread_atfork(None, None, Some(advance_process_identity_after_fork)) };
    if registered != 0 {
        // Invalidate an identity minted concurrently while registration was in
        // progress, then make every later constructor fail closed as well.
        CURRENT_PROCESS_LINEAGE_GENERATION.fetch_add(1, Ordering::SeqCst);
        FORK_HOOK_REGISTRATION_STATE.store(FORK_HOOK_FAILED, Ordering::Release);
        panic!("failed to install the process-bound identity fork hook: {registered}");
    }

    #[cfg(test)]
    if PAUSE_AFTER_FORK_HOOK_REGISTRATION_FOR_TEST.load(Ordering::Acquire) {
        FORK_HOOK_REGISTERED_BUT_UNPUBLISHED_FOR_TEST.store(true, Ordering::Release);
        while !RELEASE_FORK_HOOK_REGISTRATION_FOR_TEST.load(Ordering::Acquire) {
            std::hint::spin_loop();
        }
    }

    FORK_HOOK_REGISTRATION_STATE.store(FORK_HOOK_REGISTERED, Ordering::Release);
}

#[cfg(unix)]
unsafe extern "C" fn advance_process_identity_after_fork() {
    CURRENT_PROCESS_LINEAGE_GENERATION.fetch_add(1, Ordering::SeqCst);
    // Reaching this callback proves registration succeeded. Publishing the
    // fact in the child also repairs the exact fork-after-registration,
    // before-parent-publication interval exercised below.
    FORK_HOOK_REGISTRATION_STATE.store(FORK_HOOK_REGISTERED, Ordering::Release);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn wait_for_registration_to_settle() {
        while FORK_HOOK_REGISTRATION_STATE.load(Ordering::Acquire) == FORK_HOOK_REGISTERING {
            std::thread::yield_now();
        }
    }

    #[test]
    fn same_process_clone_matches_and_fresh_allocation_does_not() {
        let identity = ProcessBoundIdentity::new();
        let clone = identity.clone();
        let fresh = ProcessBoundIdentity::new();

        #[cfg(unix)]
        wait_for_registration_to_settle();

        assert_eq!(identity, clone);
        assert_ne!(identity, fresh);
    }

    #[test]
    fn private_lineage_token_not_pid_is_the_identity_discriminator() {
        let first = CreatorProcessIdentity {
            lineage_generation: 7,
            process_id: 41,
        };
        let reused_pid_in_a_descendant = CreatorProcessIdentity {
            lineage_generation: 9,
            process_id: 41,
        };

        assert!(first != reused_pid_in_a_descendant);
    }

    #[cfg(unix)]
    #[test]
    fn inherited_identity_refuses_in_forked_child() {
        const INHERITED_ACCEPTED: i32 = 42;

        let identity = ProcessBoundIdentity::new();
        let clone = identity.clone();

        wait_for_registration_to_settle();
        assert_eq!(identity, clone);

        // SAFETY: the child performs only lock-free identity comparison and
        // `_exit`; it does not run inherited destructors or buffered I/O.
        let child = unsafe { libc::fork() };
        assert!(
            child >= 0,
            "fork failed: {}",
            std::io::Error::last_os_error()
        );
        if child == 0 {
            let inherited_matches = identity == clone;
            // SAFETY: terminate the child without touching inherited runtime
            // state that may have been owned by another test thread at fork.
            unsafe {
                libc::_exit(if inherited_matches {
                    INHERITED_ACCEPTED
                } else {
                    0
                })
            };
        }

        let mut status = 0;
        // SAFETY: `child` is the positive PID returned above and `status` is
        // valid writable storage for this synchronous wait.
        let waited = unsafe { libc::waitpid(child, &mut status, 0) };
        assert_eq!(waited, child);
        assert!(libc::WIFEXITED(status), "child status {status}");
        assert_eq!(libc::WEXITSTATUS(status), 0);
    }

    #[cfg(unix)]
    #[test]
    fn fork_before_hook_installation_neither_hangs_nor_matches_indeterminate_identity() {
        const SUBPROCESS_ENV: &str = "PROCESS_BOUND_IDENTITY_PRE_REGISTRATION_RACE_SUBPROCESS";
        const IDENTITY_ACCEPTED: i32 = 42;

        if std::env::var_os(SUBPROCESS_ENV).is_none() {
            let output = std::process::Command::new(
                std::env::current_exe().expect("current unit-test executable"),
            )
            .args([
                "--exact",
                "process_bound_identity::tests::fork_before_hook_installation_neither_hangs_nor_matches_indeterminate_identity",
                "--nocapture",
            ])
            .env(SUBPROCESS_ENV, "1")
            .output()
            .expect("pre-registration-race subprocess");
            assert!(
                output.status.success(),
                "pre-registration-race subprocess failed: status={} stdout={} stderr={}",
                output.status,
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr),
            );
            return;
        }

        assert_eq!(
            FORK_HOOK_REGISTRATION_STATE.load(Ordering::Acquire),
            FORK_HOOK_UNREGISTERED,
            "isolated subprocess must begin before fork-hook registration",
        );

        // White-box construction is necessary to hold the first registration
        // open. Normal construction is the operation that starts registration.
        let identity = ProcessBoundIdentity {
            allocation: Arc::new(()),
            creator_process: current_process_identity(),
        };
        let clone = identity.clone();
        assert_ne!(identity, clone, "unregistered equality must fail closed");

        PAUSE_BEFORE_FORK_HOOK_REGISTRATION_FOR_TEST.store(true, Ordering::Release);
        let registrar = std::thread::spawn(ensure_fork_identity_hook_registered);
        while !FORK_HOOK_REGISTRATION_STARTED_FOR_TEST.load(Ordering::Acquire) {
            std::thread::yield_now();
        }
        assert_ne!(
            identity, clone,
            "the registering parent must fail closed without waiting",
        );

        // SAFETY: no atfork callback is installed yet. The child arms an
        // async-signal-safe alarm, performs only atomic/Arc pointer operations,
        // and exits with `_exit`.
        let child = unsafe { libc::fork() };
        assert!(
            child >= 0,
            "fork failed: {}",
            std::io::Error::last_os_error(),
        );
        if child == 0 {
            unsafe { libc::alarm(2) };
            let inherited_matches = identity == clone;
            let child_stamped = ProcessBoundIdentity {
                allocation: Arc::clone(&identity.allocation),
                creator_process: current_process_identity(),
            };
            let indeterminate_matches = child_stamped == child_stamped.clone();
            unsafe {
                libc::_exit(if inherited_matches || indeterminate_matches {
                    IDENTITY_ACCEPTED
                } else {
                    0
                })
            };
        }

        RELEASE_BEFORE_FORK_HOOK_REGISTRATION_FOR_TEST.store(true, Ordering::Release);
        registrar.join().expect("fork-hook registrar");

        let mut status = 0;
        assert_eq!(unsafe { libc::waitpid(child, &mut status, 0) }, child);
        assert!(
            libc::WIFEXITED(status),
            "child hung or was signaled during identity lookup: status={status}",
        );
        assert_eq!(
            libc::WEXITSTATUS(status),
            0,
            "child matched an identity with indeterminate hook registration",
        );
        assert_eq!(
            identity, clone,
            "parent identity did not recover after registration completed",
        );
    }

    #[cfg(unix)]
    #[test]
    fn fork_after_hook_registration_before_publication_neither_hangs_nor_accepts() {
        const SUBPROCESS_ENV: &str = "PROCESS_BOUND_IDENTITY_REGISTRATION_RACE_SUBPROCESS";
        const INHERITED_ACCEPTED: i32 = 42;

        if std::env::var_os(SUBPROCESS_ENV).is_none() {
            let output = std::process::Command::new(
                std::env::current_exe().expect("current unit-test executable"),
            )
            .args([
                "--exact",
                "process_bound_identity::tests::fork_after_hook_registration_before_publication_neither_hangs_nor_accepts",
                "--nocapture",
            ])
            .env(SUBPROCESS_ENV, "1")
            .output()
            .expect("registration-race subprocess");
            assert!(
                output.status.success(),
                "registration-race subprocess failed: status={} stdout={} stderr={}",
                output.status,
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr),
            );
            return;
        }

        assert_eq!(
            FORK_HOOK_REGISTRATION_STATE.load(Ordering::Acquire),
            FORK_HOOK_UNREGISTERED,
            "isolated subprocess must begin before fork-hook registration",
        );

        // Mint only for this white-box schedule: ordinary construction is the
        // operation whose registration interval the test needs to hold open.
        let identity = ProcessBoundIdentity {
            allocation: Arc::new(()),
            creator_process: current_process_identity(),
        };
        let clone = identity.clone();
        assert_ne!(identity, clone, "unregistered equality must fail closed");

        PAUSE_AFTER_FORK_HOOK_REGISTRATION_FOR_TEST.store(true, Ordering::Release);
        let registrar = std::thread::spawn(ensure_fork_identity_hook_registered);
        while !FORK_HOOK_REGISTERED_BUT_UNPUBLISHED_FOR_TEST.load(Ordering::Acquire) {
            std::thread::yield_now();
        }
        assert_ne!(
            identity, clone,
            "the registering parent must fail closed without waiting",
        );

        // SAFETY: the child arms an async-signal-safe alarm, performs the
        // lock-free identity comparison under test, and exits with `_exit`.
        let child = unsafe { libc::fork() };
        assert!(
            child >= 0,
            "fork failed: {}",
            std::io::Error::last_os_error(),
        );
        if child == 0 {
            // Bound the regression: the former inherited-RUNNING `Once`
            // blocks here until SIGALRM terminates the child.
            unsafe { libc::alarm(2) };
            let registration_ready = current_process_identity_for_comparison().is_some();
            let inherited_matches = identity == clone;
            unsafe {
                libc::_exit(if !registration_ready {
                    43
                } else if inherited_matches {
                    INHERITED_ACCEPTED
                } else {
                    0
                })
            };
        }

        RELEASE_FORK_HOOK_REGISTRATION_FOR_TEST.store(true, Ordering::Release);
        registrar.join().expect("fork-hook registrar");

        let mut status = 0;
        // SAFETY: `child` is the positive PID returned above and `status` is
        // valid writable storage for this synchronous wait.
        assert_eq!(unsafe { libc::waitpid(child, &mut status, 0) }, child);
        assert!(
            libc::WIFEXITED(status),
            "child hung or was signaled during identity lookup: status={status}",
        );
        assert_eq!(
            libc::WEXITSTATUS(status),
            0,
            "child accepted an identity inherited during hook registration",
        );
        assert_eq!(
            identity, clone,
            "parent identity stopped matching after fork"
        );
    }
}
