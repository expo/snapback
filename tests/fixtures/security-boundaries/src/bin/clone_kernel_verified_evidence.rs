use snapback_kernel::storage::ServingDatabase;

fn clone_evidence(database: &ServingDatabase) {
    // @attack
    let _ = database.clone_kernel_verified_evidence();
}

fn main() {}
