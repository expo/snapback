use snapback_kernel::storage::LocalDatabase;

fn main() {
    let mut database = LocalDatabase::memory().unwrap();
    let authority = database.claim_kernel_commit_authority().unwrap();
    // @attack
    let _ = authority.admit_protected_record_erasure(
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
