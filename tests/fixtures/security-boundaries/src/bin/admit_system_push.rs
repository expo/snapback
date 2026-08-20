use snapback_kernel::storage::{LocalDatabase, ServingDatabase};

fn main() {
    let database = LocalDatabase::memory().unwrap();
    let serving = ServingDatabase::adopt(database).unwrap();
    // @attack
    let _ = serving.admit_system_push();
}
