use snapback_kernel::storage::CommitCapsuleOrigin;

struct FakePending;

fn attack(origin: &CommitCapsuleOrigin) {
    // @attack
    let _ = origin.commit_watch_management(FakePending);
}

fn main() {}
