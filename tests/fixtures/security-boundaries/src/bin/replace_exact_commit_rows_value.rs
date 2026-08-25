use snapback_kernel::storage::{
    ExactCommitRows,
    watches::{WatchManagementCommit, WatchManagementIntent},
};

fn attempt_replace_witness_contents(
    witness: ExactCommitRows<WatchManagementIntent, WatchManagementCommit>,
    replacement: WatchManagementCommit,
) {
    // @attack
    let _ = witness.map(|_| replacement);
}

fn main() {}
