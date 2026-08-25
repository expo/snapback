fn main() {
    // @attack
    let mut database = snapback_activation::storage::LocalDatabase::memory().unwrap();
    let _ = database.claim_kernel_commit_authority().unwrap();
}
