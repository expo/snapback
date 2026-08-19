use snapback_kernel::storage::LocalDatabase;

fn main() {
    let mut database = LocalDatabase::memory().unwrap();
    let factory = database
        .claim_kernel_commit_authority()
        .unwrap()
        .authorization_commit_carriers();
    // @attack
    let _ = factory.prepared(|_| Ok(()), || {}, || {});
}
