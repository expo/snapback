use snapback_kernel::auth::service_authority_contract::ServiceAuthorityDisposition;
use snapback_kernel::storage::LocalDatabase;

fn supply(db: &mut LocalDatabase) {
    // @attack
    let _ = db.attempt_auth_transaction_with_service_terminal(
        ServiceAuthorityDisposition::Carrier,
        |_transaction| Ok(vec!["caller-token".to_owned()]),
        |_transaction| Ok(()),
    );
}

fn main() {
    let _ = supply;
}
