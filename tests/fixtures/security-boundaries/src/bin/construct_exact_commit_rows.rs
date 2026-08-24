use snapback_kernel::storage::ExactCommitRows;
use snapback_kernel::storage::watches::{
    WatchManagementCommit, WatchManagementIntendedRows,
};

fn main() {
    // @attack
    let _ = ExactCommitRows::<WatchManagementIntendedRows, WatchManagementCommit> {
        binding: panic!("compile-only database binding"),
        operation_identity: panic!("compile-only operation identity"),
        semantic_fingerprint: [0; 32],
        value: panic!("compile-only value"),
    };
}
