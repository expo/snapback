use snapback_kernel::storage::LocalDatabase;

fn main() {
    let mut database = LocalDatabase::memory().unwrap();
    database.activate_current_auth_catalog().unwrap();
    // @attack additive test support must not mint an arbitrary durable
    // identity/session/digest tuple that resolves into kernel authority.
    database.auth_catalog().insert_email_session_for_test(
        "alice",
        "identity-alice",
        "session-alice",
        "authority-alice",
        "alice@example.test",
        &[0x41; 32],
        1,
        1,
        1_000,
        2_000,
    );
}
