use snapback_kernel::storage::CommitCapsuleOrigin;

fn attack(origin: &CommitCapsuleOrigin) {
    // @attack
    let _ = &origin.authority;
}

fn main() {}
