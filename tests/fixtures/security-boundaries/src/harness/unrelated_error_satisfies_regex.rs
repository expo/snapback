fn main() {
    // @attack
    let _ = 1_u32;
    let _: () = snapback_kernel::storage::AuthorizationCommitInterlock;
}
