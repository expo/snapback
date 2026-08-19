use snapback_kernel::storage::AuthorizationCommitCarrierFactory;

fn main() {
    // @attack
    let _ = AuthorizationCommitCarrierFactory::for_test();
}
