use snapback_kernel::storage::{
    CommitCapsuleAuthority, ExactCommitRows,
    watches::{WatchManagementCommit, WatchManagementIntent},
};
use snapback_row_attack_fixtures::report_observation;

fn launder_independent_intent(
    witness: ExactCommitRows<WatchManagementIntent, WatchManagementCommit>,
    authority: &CommitCapsuleAuthority,
    independent_intent: &WatchManagementIntent,
) {
    // @attack
    let supplied = authority.derive_intent_instance(independent_intent);
    let cloned = supplied.clone();
    let _ = witness.into_value_for(authority, &cloned);
}

fn main() {
    let _ = launder_independent_intent;
    report_observation(
        "F220",
        Ok("caller-selected intent was wrapped by public database authority".to_owned()),
    );
}
