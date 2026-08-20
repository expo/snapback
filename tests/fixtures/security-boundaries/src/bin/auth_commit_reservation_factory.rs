use snapback_kernel::storage::{LocalDatabase, ServingDatabase};

fn main() {
    let database = LocalDatabase::memory().unwrap();
    let serving = ServingDatabase::adopt(database).unwrap();
    let factory = serving.authorization_commit_carriers();
    // @attack
    let _ = factory.reservation(|_, _, _| panic!("compile-only terminal"), || {});
}
