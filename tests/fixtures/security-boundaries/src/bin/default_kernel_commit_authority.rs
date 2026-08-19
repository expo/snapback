use snapback_kernel::storage::KernelCommitAuthority;

fn main() {
    // @attack
    let _ = KernelCommitAuthority::default();
}
