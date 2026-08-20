use snapback_kernel::storage::LocalDatabase;

fn main() {
    let mut first = LocalDatabase::memory().unwrap();
    let binding = first.claim_database_binding().unwrap();
    let mut second = LocalDatabase::memory().unwrap();
    // @attack
    let _ = second.join_kernel_commit_authority_for_test(&binding);
}
