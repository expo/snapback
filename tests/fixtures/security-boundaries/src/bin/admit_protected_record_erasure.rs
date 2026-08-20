use snapback_kernel::storage::{LocalDatabase, ServingDatabase};

fn main() {
    let database = LocalDatabase::memory().unwrap();
    let serving = ServingDatabase::adopt(database).unwrap();
    // @attack
    let _ = serving.admit_protected_record_erasure(
        "operation".to_owned(),
        "items".to_owned(),
        "row".to_owned(),
        "admin-bypass",
        "operator",
        "protected-erasure",
        "production",
        1,
        "fixture",
        "00",
        "fixture-stream",
        1,
    );
}
