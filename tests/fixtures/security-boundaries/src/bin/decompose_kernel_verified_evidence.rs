use snapback_kernel::storage::ServingDatabase;

fn decompose(database: &ServingDatabase) {
    // @attack
    let _ = database.decompose_kernel_verified_evidence();
}

fn main() {}
