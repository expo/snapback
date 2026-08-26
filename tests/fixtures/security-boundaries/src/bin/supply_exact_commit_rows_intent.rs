use snapback_kernel::storage::{
    CommitCapsuleAuthority, ExactCommitRows,
    watches::{WatchManagementCommit, WatchManagementIntent},
};

fn attempt_independent_intent(
    witness: ExactCommitRows<WatchManagementIntent, WatchManagementCommit>,
    authority: &CommitCapsuleAuthority,
    independent_intent: &WatchManagementIntent,
) {
    // @attack
    let supplied = authority.derive_intent_instance(independent_intent);
    let cloned = supplied.clone();
    let _ = witness.into_value_for(authority, &cloned);
}

fn main() {}
