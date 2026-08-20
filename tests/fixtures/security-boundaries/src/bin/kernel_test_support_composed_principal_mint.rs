use snapback_kernel::contract_types::TokenDigest;
use snapback_kernel::storage::LocalDatabase;

fn main() {
    let mut database = LocalDatabase::memory().unwrap();
    database.activate_current_auth_catalog().unwrap();
    let digest = TokenDigest::from_bytes([0x41; 32]);

    // @attack additive test support must not let a dependent compose a
    // caller-authored human row and caller-known session digest into the
    // kernel's accepted opaque principal proof.
    let principal = {
        database
            .auth_catalog()
            .insert_human_user_for_test("alice", 1)
            .unwrap();
        database
            .push_registry()
            .insert_session_for_test("alice", "session-alice", 1, 2_000, 0x41)
            .unwrap();
        database
            .resolve_principal_from_session(&digest, 1_000)
            .unwrap()
    };
    assert_eq!(principal.principal_id(), "alice");
}
