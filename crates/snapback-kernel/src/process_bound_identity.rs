//! Exact allocation identity that is valid only in its creator process.

use std::sync::Arc;
use std::sync::Once;
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
struct CreatorProcessIdentity {
    lineage_generation: u64,
    process_id: u32,
}

// Register before the first identity can be returned. POSIX calls the child
// hook around `fork`, after the address space has been copied and before the
// child returns to application code. Every descendant therefore advances a
// private lineage token even if it never compares an identity before forking
// again. The freshly read PID is an additional current-process fact, not the
// source of uniqueness, so PID reuse cannot resurrect an inherited identity.
#[cfg(unix)]
static REGISTER_FORK_IDENTITY_HOOK: Once = Once::new();
static CURRENT_PROCESS_LINEAGE_GENERATION: AtomicU64 = AtomicU64::new(1);

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
    #[cfg(unix)]
    REGISTER_FORK_IDENTITY_HOOK.call_once(|| {
        // SAFETY: the callback has C ABI, captures no Rust state, and performs
        // only one lock-free atomic operation in the post-fork child.
        let registered =
            unsafe { libc::pthread_atfork(None, None, Some(advance_process_identity_after_fork)) };
        assert_eq!(
            registered, 0,
            "failed to install the process-bound identity fork hook"
        );
    });

    CreatorProcessIdentity {
        lineage_generation: CURRENT_PROCESS_LINEAGE_GENERATION.load(Ordering::Acquire),
        process_id: std::process::id(),
    }
}

#[cfg(unix)]
unsafe extern "C" fn advance_process_identity_after_fork() {
    CURRENT_PROCESS_LINEAGE_GENERATION.fetch_add(1, Ordering::SeqCst);
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
