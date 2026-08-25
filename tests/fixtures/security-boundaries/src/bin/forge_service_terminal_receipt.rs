use snapback_kernel::auth::service_authority_contract::ServiceAuthorityDisposition;
use snapback_kernel::auth::service_fence::ServiceAuthorityTerminalReceipt;
use snapback_kernel::storage::LocalDatabase;

fn main() {
    let binding = LocalDatabase::memory().unwrap().binding();
    // @attack
    let _ = ServiceAuthorityTerminalReceipt::new(
        binding,
        vec!["forged-token".to_owned()],
        ServiceAuthorityDisposition::Carrier,
    );
}
