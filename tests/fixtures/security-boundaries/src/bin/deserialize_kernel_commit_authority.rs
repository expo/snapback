use snapback_kernel::storage::KernelCommitAuthority;

fn main() {
    // @attack
    let _: KernelCommitAuthority = serde_json::from_str("{}").unwrap();
}
