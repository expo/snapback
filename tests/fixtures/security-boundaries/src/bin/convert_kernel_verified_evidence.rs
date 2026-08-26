use snapback_kernel::storage::ServingDatabase;

fn convert(database: &ServingDatabase) {
    // @attack
    let _ = database.convert_kernel_verified_evidence();
}

fn main() {}
