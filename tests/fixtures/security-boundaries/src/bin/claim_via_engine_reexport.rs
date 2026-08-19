fn main() {
    let mut database = snapback_engine::storage::LocalDatabase::memory().unwrap();
    // @attack
    let _ = database.claim_kernel_commit_authority().unwrap();
}
