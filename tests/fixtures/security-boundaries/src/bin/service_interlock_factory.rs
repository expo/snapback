use snapback_kernel::storage::{LocalDatabase, ServingDatabase};

fn main() {
    let database = LocalDatabase::memory().unwrap();
    let mut serving = ServingDatabase::adopt(database).unwrap();
    let first = serving.service_authority_commit_interlock(|receipt| {
        Ok(receipt.prepared(|| Ok(()), || {}, || {}))
    });
    serving
        .install_service_authority_commit_interlock(first)
        .unwrap();
    // @attack
    let replacement = serving.service_authority_commit_interlock(|receipt| {
        Ok(receipt.prepared(|| Ok(()), || {}, || {}))
    });
    serving
        .install_service_authority_commit_interlock(replacement)
        .unwrap();
}
