use snapback_kernel::storage::{AuthorizationCommitParticipant, LocalDatabase};

fn main() {
    let database = LocalDatabase::memory().unwrap();
    // @attack
    let _ = AuthorizationCommitParticipant {
        binding: database.binding(),
        registry: panic!("compile-only private registry"),
        registry_generation: 1,
        activation: panic!("compile-only private activation"),
    };
}
