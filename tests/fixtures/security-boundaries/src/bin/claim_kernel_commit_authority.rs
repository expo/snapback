use snapback_kernel::storage::LocalDatabase;

fn main() {
    let mut database = LocalDatabase::memory().unwrap();
    // @attack
    let _ = database.claim_kernel_commit_authority().unwrap();
}
