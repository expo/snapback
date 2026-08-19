use snapback_kernel::storage::LocalDatabase;

fn main() {
    let mut database = LocalDatabase::memory().unwrap();
    let authority = database.claim_kernel_commit_authority().unwrap();
    // @attack
    let _ =
        database.prepare_promotion_contention_reservation_for_bench(&authority, "canonical", 2, 1);
}
