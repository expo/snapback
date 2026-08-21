use snapback_kernel::storage::{AuthorizationCommitOutcome, AuthorizationVersion, LocalDatabase};

fn main() {
    let database = LocalDatabase::memory().unwrap();
    // @attack
    let _ = AuthorizationCommitOutcome {
        binding: database.binding(),
        registry: panic!("compile-only private registry"),
        registry_generation: 1,
        ticket_id: 1,
        sequence: 1,
        predecessor: None,
        authorization: AuthorizationVersion {
            incarnation: "0197f862-f196-7bb2-b3f0-2a67185dfd17".to_owned(),
            epoch: 1,
        },
        min_commit_version: 1,
        incarnation_rotated: false,
    };
}
