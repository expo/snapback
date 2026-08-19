use snapback_kernel::storage::LocalDatabase;

fn main() {
    let mut database = LocalDatabase::memory().unwrap();
    let authority = database.claim_kernel_commit_authority().unwrap();
    let factory = authority.service_authority_terminal_factory();
    // @attack
    let interlock = authority.service_authority_commit_interlock(move |_, _| {
        Ok(factory.prepared(|| Ok(()), || {}, || {}))
    });
    database
        .install_service_authority_commit_interlock(&authority, interlock)
        .unwrap();
}
