use snapback_kernel::storage::{LocalDatabase, ServingDatabase};

fn main() {
    let local = LocalDatabase::memory().unwrap();
    let mut serving = ServingDatabase::adopt(local).unwrap();
    let participant = serving.take_authorization_commit_participant().unwrap();
    // @attack
    let _ = participant.clone();
}
