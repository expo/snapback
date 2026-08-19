fn main() {
    let mut database = snapback_auth::storage::LocalDatabase::memory().unwrap();
    // @attack
    let _ = database.claim_kernel_commit_authority().unwrap();
}
