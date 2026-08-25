use snapback_server::admin_secret_read::SecretReadLeaseRegistry;
use std::sync::Arc;
use std::sync::atomic::AtomicU64;

fn main() {
    let (_registry, operator) =
        SecretReadLeaseRegistry::new(Arc::new(AtomicU64::new(0)));
    // @attack
    let _relocated = operator.clone();
}
