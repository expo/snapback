use snapback_kernel::storage::{
    CommitCapsuleAuthority, ExactCommitRows,
    watches::{WatchManagementCommit, WatchManagementIntent},
};

fn attempt_independent_intent(
    witness: ExactCommitRows<WatchManagementIntent, WatchManagementCommit>,
    authority: &CommitCapsuleAuthority,
    intent: &WatchManagementIntent,
) {
    // @attack
    let _ = witness.into_value_for(authority, intent);
}

fn main() {}
