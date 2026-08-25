use snapback_server::admin_secret_read::{
    SecretReadLeaseRegistry, SecretReadLeaseRequest, SecretReadScope,
};
use std::collections::BTreeSet;
use std::sync::Arc;
use std::sync::atomic::AtomicU64;
use std::time::Duration;

fn main() {
    let (registry, _operator) =
        SecretReadLeaseRegistry::new(Arc::new(AtomicU64::new(0)));
    let request = SecretReadLeaseRequest {
        scopes: BTreeSet::from([SecretReadScope::AdminInspect]),
        ttl: Duration::from_secs(1),
        row_budget: 1,
        byte_budget: 1,
    };
    // @attack
    let _lease = registry.mint(request);
}
