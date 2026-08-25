use snapback_sync::auth::service_fence::{
    ServiceAuthorityFenceRegistry, ServiceAuthorityWitness,
};
use std::time::Instant;

fn register_forged(
    registry: &ServiceAuthorityFenceRegistry,
    witness: ServiceAuthorityWitness,
) {
    // @attack
    let _ = registry.register(witness, 1, Instant::now());
}

fn main() {}
