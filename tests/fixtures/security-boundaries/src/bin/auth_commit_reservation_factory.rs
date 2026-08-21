use snapback_kernel::storage::{LocalDatabase, ServingDatabase};

fn main() {
    let database = LocalDatabase::memory().unwrap();
    let serving = ServingDatabase::adopt(database).unwrap();
    // @attack
    let factory = serving.authorization_commit_carriers();
    let _ = factory.reservation(|_, _, _| panic!("compile-only terminal"), || {});
}
