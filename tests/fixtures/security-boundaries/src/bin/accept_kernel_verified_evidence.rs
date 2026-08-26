use snapback_kernel::storage::ServingDatabase;

fn accept<T>(database: &ServingDatabase, evidence: T) {
    // @attack
    database.accept_kernel_verified_evidence(evidence);
}

fn main() {}
