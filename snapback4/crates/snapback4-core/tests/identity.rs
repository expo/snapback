use snapback4_core::{Store, identity};

#[test]
fn signup_minimum_counts_unicode_scalars() {
    let store = Store::memory().unwrap();
    let mut entropy = snapback4_core::ids::Mint::default();
    for (n, letter) in ["é", "😀", "a"].into_iter().enumerate() {
        let email = format!("unicode-{n}@example.com");
        let short = letter.repeat(7);
        let error = identity::signup(&store, &email, &short, 1_000, &mut entropy).unwrap_err().refusal();
        assert_eq!(error.code, "E_AUTH");
        assert_eq!(error.message, "a password needs at least 8 characters");
        assert!(identity::credential(&store, &email).unwrap().is_none());
        let password = letter.repeat(8);
        let signed_up = identity::signup(&store, &email, &password, 1_000, &mut entropy).unwrap();
        let signed_in = identity::login(&store, &email, &password, 2_000).unwrap();
        assert_eq!(signed_in.principal, signed_up.principal);
        println!("minimum: 7 characters / {} bytes refused; 8 characters / {} bytes accepted", short.len(), password.len());
    }
    // Two supplementary scalars were enough for the old eight-byte minimum.
    assert!(identity::signup(&store, "two@example.com", "😀😀", 1_000, &mut entropy).is_err());
    // Four displayed letters with combining marks are eight Unicode scalars.
    let combining = "e\u{301}".repeat(4);
    assert_eq!(combining.chars().count(), 8);
    identity::signup(&store, "combining@example.com", &combining, 1_000, &mut entropy).unwrap();
}

#[test]
fn password_maximum_still_counts_utf8_bytes() {
    let store = Store::memory().unwrap();
    let mut entropy = snapback4_core::ids::Mint::default();
    assert_eq!(identity::PASSWORD_MAX_BYTES, 1024);
    for (n, password) in ["a".repeat(1024), "é".repeat(512), "😀".repeat(256)].into_iter().enumerate() {
        assert_eq!(password.len(), 1024);
        let email = format!("maximum-{n}@example.com");
        let session = identity::signup(&store, &email, &password, 1_000, &mut entropy).unwrap();
        assert_eq!(identity::login(&store, &email, &password, 2_000).unwrap().principal, session.principal);
        let oversized = format!("{password}a");
        for error in [
            identity::signup(&store, "oversized@example.com", &oversized, 1_000, &mut entropy).unwrap_err(),
            identity::login(&store, &email, &oversized, 2_000).unwrap_err(),
        ] {
            assert_eq!(error.refusal().code, "E_AUTH");
            assert_eq!(error.refusal().message, "a password is at most 1024 UTF-8 bytes");
        }
        println!("maximum: {} characters / 1024 bytes accepted; 1025 bytes refused", password.chars().count());
    }
}
