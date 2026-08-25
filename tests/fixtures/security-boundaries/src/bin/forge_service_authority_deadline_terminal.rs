use snapback_kernel::auth::service_authority_contract::ServiceAuthorityDisposition;
use snapback_kernel::auth::service_fence::ServiceAuthorityDeadlineTerminal;
use snapback_kernel::storage::LocalDatabase;
use std::time::Instant;

fn main() {
    let database_binding = LocalDatabase::memory().unwrap().binding();
    // @attack
    let _ = ServiceAuthorityDeadlineTerminal {
        database_binding,
        token_id: "caller-token".to_owned(),
        grant_id: "caller-grant".to_owned(),
        deadline_ms: 1,
        disposition: ServiceAuthorityDisposition::Carrier,
        close_by: Instant::now(),
    };
}
