use snapback_kernel::storage::{LocalDatabase, ServingDatabase};

fn main() {
    let database = LocalDatabase::memory().unwrap();
    let mut serving = ServingDatabase::adopt(database).unwrap();
    // @attack
    let _ = serving.deny_pending_effect_admitted("effect", "approver", 1);
}
