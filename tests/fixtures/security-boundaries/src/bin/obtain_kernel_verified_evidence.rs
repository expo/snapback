use snapback_kernel::storage::ServingDatabase;

fn obtain(database: &ServingDatabase) {
    // @attack
    let _ = database.kernel_verified_evidence();
}

fn main() {}
