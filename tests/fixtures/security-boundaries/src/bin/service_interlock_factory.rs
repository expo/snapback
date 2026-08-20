use snapback_kernel::storage::{LocalDatabase, ServingDatabase};

fn main() {
    let database = LocalDatabase::memory().unwrap();
    let mut serving = ServingDatabase::adopt(database).unwrap();
    let factory = serving.service_authority_terminal_factory();
    // @attack
    let interlock = serving.service_authority_commit_interlock(move |_, _| {
        Ok(factory.prepared(|| Ok(()), || {}, || {}))
    });
    serving
        .install_service_authority_commit_interlock(interlock)
        .unwrap();
}
