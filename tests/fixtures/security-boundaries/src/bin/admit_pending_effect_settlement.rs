use snapback_kernel::storage::{LocalDatabase, ServingDatabase};

fn main() {
    let database = LocalDatabase::memory().unwrap();
    let mut serving = ServingDatabase::adopt(database).unwrap();
    // @attack
    let _ = serving.settle_pending_effect_admitted("effect", true, None, 1);
}
