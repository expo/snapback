use snapback_kernel::storage::{LocalDatabase, ServingDatabase};

fn main() {
    let database = LocalDatabase::memory().unwrap();
    let mut serving = ServingDatabase::adopt(database).unwrap();
    // @attack
    let _ = serving.refuse_pending_effect_admitted("effect", "REFUSED", 1);
}
