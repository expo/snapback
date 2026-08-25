use snapback_auth::auth::service_fence::ServiceAuthorityFenceRegistry;
use snapback_row_attack_fixtures::report_observation;
use std::time::Instant;

fn register_raw_witness(registry: &ServiceAuthorityFenceRegistry) {
    // @attack
    let _register = |witness| registry.register(witness, 1, Instant::now());
}

fn main() {
    let _ = register_raw_witness;
    report_observation(
        "F113",
        Ok("dependent called raw service-authority witness registration".to_owned()),
    );
}
