use snapback_kernel::storage::{LocalDatabase, ServingDatabase};

fn main() {
    let database = LocalDatabase::memory().unwrap();
    let mut serving = ServingDatabase::adopt(database).unwrap();
    let approval = serving
        .prepare_pending_effect_approval("effect", "approver", 1)
        .unwrap();
    // @attack
    let _ = serving.approve_pending_effect_admitted(approval, None, 1);
}
