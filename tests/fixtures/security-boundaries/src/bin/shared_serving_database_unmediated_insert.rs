use snapback_kernel::storage::ServingDatabase;

fn attempt_from_shared_serving_database(database: &ServingDatabase) {
    // @attack
    let _ = database.attempt_unmediated_app_insert_for_test();
}

fn main() {}
