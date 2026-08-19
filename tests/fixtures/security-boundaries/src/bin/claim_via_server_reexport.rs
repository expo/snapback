fn main() {
    let mut database = snapback_server::storage::LocalDatabase::memory().unwrap();
    // @attack
    let _ = database.claim_kernel_commit_authority().unwrap();
}
