use snapback_kernel::storage::LocalDatabase;

fn main() {
    let mut first = LocalDatabase::memory().unwrap();
    let authority = first.claim_kernel_commit_authority().unwrap();
    let mut second = LocalDatabase::memory().unwrap();
    // @attack
    let _ = second.join_kernel_commit_authority_for_test(&authority);
}
