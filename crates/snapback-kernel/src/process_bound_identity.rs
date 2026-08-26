//! Exact allocation identity that is valid only in its creator process.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

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
struct CreatorProcessIdentity(u64);

// The high word is a private lineage generation; the low word is the last PID
// observed in this address space. A child inherits the word, observes its new
// PID on the first construction or comparison, and advances the generation.
// Keeping both in one atomic makes initialization and post-fork refresh
// lock-free and prevents a thread from observing a PID with the prior
// generation. If a PID is later reused in the same inherited lineage, the
// generation advances again, so equality never rests on the PID alone.
static CURRENT_PROCESS_STATE: AtomicU64 = AtomicU64::new(0);

const PID_MASK: u64 = u32::MAX as u64;

impl ProcessBoundIdentity {
    /// Mint a fresh allocation identity bound to the current process.
    pub fn new() -> Self {
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
        let current_process = current_process_identity();
        self.creator_process == current_process
            && other.creator_process == current_process
            && Arc::ptr_eq(&self.allocation, &other.allocation)
    }
}

impl Eq for ProcessBoundIdentity {}

fn current_process_identity() -> CreatorProcessIdentity {
    let current_pid = u64::from(std::process::id());
    let mut observed = CURRENT_PROCESS_STATE.load(Ordering::Acquire);
    loop {
        if observed & PID_MASK == current_pid && observed >> 32 != 0 {
            return CreatorProcessIdentity(observed);
        }
        let refreshed = refreshed_process_state(observed, current_pid as u32);
        match CURRENT_PROCESS_STATE.compare_exchange_weak(
            observed,
            refreshed,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => return CreatorProcessIdentity(refreshed),
            Err(actual) => observed = actual,
        }
    }
}

fn refreshed_process_state(observed: u64, current_pid: u32) -> u64 {
    let mut next_generation = (observed >> 32).wrapping_add(1) as u32;
    if next_generation == 0 {
        next_generation = 1;
    }
    (u64::from(next_generation) << 32) | u64::from(current_pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_process_clone_matches_and_fresh_allocation_does_not() {
        let identity = ProcessBoundIdentity::new();
        let clone = identity.clone();
        let fresh = ProcessBoundIdentity::new();

        assert_eq!(identity, clone);
        assert_ne!(identity, fresh);
    }

    #[test]
    fn reused_pid_advances_private_process_identity() {
        let first = refreshed_process_state(0, 41);
        let second = refreshed_process_state(first, 42);
        let reused = refreshed_process_state(second, 41);

        assert_ne!(first, second);
        assert_ne!(first, reused);
        assert_eq!(first as u32, reused as u32);
    }

    #[cfg(unix)]
    #[test]
    fn inherited_identity_refuses_in_forked_child() {
        const INHERITED_ACCEPTED: i32 = 42;

        let identity = ProcessBoundIdentity::new();
        let clone = identity.clone();
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
}
