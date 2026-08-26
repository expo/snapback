use snapback_kernel::storage::ServingDatabase;

fn deserialize(database: &ServingDatabase) {
    // @attack
    let _ = database.deserialize_kernel_verified_evidence("{}");
}

fn main() {}
