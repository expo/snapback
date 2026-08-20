use snapback_kernel::storage::{LocalDatabase, ServingDatabase};

fn attempt_through_shared_deref(database: &ServingDatabase) {
    let database: &LocalDatabase = database;
    // @attack
    let _ = database.attempt_unmediated_app_insert_for_test();
}

fn main() {}
