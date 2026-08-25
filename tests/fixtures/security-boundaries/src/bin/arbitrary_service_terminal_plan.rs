use snapback_sync::auth::service_authority_contract::ServiceAuthorityDisposition;
use snapback_engine::local::LocalSnapback;

fn forge(snapback: &LocalSnapback) {
    // @attack
    let _ = snapback.service_authority_terminal_plan_for_test(
        vec!["caller-token".to_owned()],
        ServiceAuthorityDisposition::Carrier,
    );
}

fn main() {
    let _ = forge;
}
