use snapback_kernel::storage::LocalDatabase;

fn main() {
    let mut database = LocalDatabase::memory().unwrap();
    // @attack
    let _ = database.admitted_session_projection_snapshot();
}
