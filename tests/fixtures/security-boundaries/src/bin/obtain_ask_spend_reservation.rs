use snapback_kernel::storage::LocalDatabase;

fn main() {
    let mut database = LocalDatabase::memory().unwrap();
    // @attack
    let _ = database.reserve_ask_spend(
        0,
        panic!("compile-only subject"),
        panic!("compile-only budgets"),
    );
}
