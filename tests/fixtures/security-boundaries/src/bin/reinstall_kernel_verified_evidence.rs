use snapback_kernel::storage::ServingDatabase;

fn reinstall<T>(database: &ServingDatabase, evidence: T) {
    // @attack
    database.reinstall_kernel_verified_evidence(evidence);
}

fn main() {}
