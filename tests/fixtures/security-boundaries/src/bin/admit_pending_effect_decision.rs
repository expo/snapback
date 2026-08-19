use snapback_kernel::storage::LocalDatabase;

fn main() {
    let mut database = LocalDatabase::memory().unwrap();
    let authority = database.claim_kernel_commit_authority().unwrap();
    // @attack
    let _ = authority.admit_pending_effect_decision("effect", "approver", true, false, None, 1);
}
