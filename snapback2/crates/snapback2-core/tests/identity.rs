use snapback2_core::*;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn generation(password: bool, guests: bool) -> Generation {
    let auth = Auth { password, guests };
    Generation::certify(
        &ProjectJson {
            version: 1,
            schema: Schema {
                tables: BTreeMap::new(),
                maintains: Vec::new(),
                channels: BTreeMap::new(),
                auth: auth.clone(),
                effects: Vec::new(),
            },
            programs: Vec::new(),
            effects: Vec::new(),
            auth,
        },
        Ceilings::default(),
    )
    .unwrap()
}

#[test]
fn password_guest_persona_and_session_contracts_are_persistent_and_typed() {
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation(true, false)).unwrap();
    assert!(
        runtime
            .principals(Some("system"))
            .unwrap()
            .iter()
            .any(|principal| principal.id.as_str() == "system")
    );
    assert_eq!(Context::system().principal_kind, "system");

    assert!(matches!(
        runtime.signup("a@example.com", "short", 10),
        Err(IdentityError::PasswordWeak)
    ));
    let signup = runtime
        .signup("Alice@Example.com", "long enough password", 20)
        .unwrap();
    assert_eq!(signup.token.len(), 43);
    assert!(
        signup
            .token
            .chars()
            .all(|character| character.is_ascii_alphanumeric()
                || character == '-'
                || character == '_')
    );
    assert!(matches!(
        runtime.signup("alice@example.com", "another password", 21),
        Err(IdentityError::EmailTaken)
    ));
    assert!(matches!(
        runtime.login("missing@example.com", "long enough password", 22),
        Err(IdentityError::Invalid)
    ));
    assert!(matches!(
        runtime.login("alice@example.com", "wrong password", 22),
        Err(IdentityError::Invalid)
    ));
    let login = runtime
        .login("alice@example.com", "long enough password", 23)
        .unwrap();
    assert_eq!(
        runtime.authenticate(&login.token, 24).unwrap(),
        login.principal
    );
    runtime.logout(&login.token).unwrap();
    assert!(matches!(
        runtime.authenticate(&login.token, 24),
        Err(IdentityError::Session)
    ));
    assert!(matches!(runtime.guest(25), Err(IdentityError::GuestsOff)));

    let persona = runtime.persona("alice", 30).unwrap();
    assert_eq!(persona.principal.id.as_str(), "dev:alice");
    assert_eq!(runtime.persona("alice", 31).unwrap().token, persona.token);

    runtime.apply_successor(generation(true, true)).unwrap();
    let guest = runtime.guest(40).unwrap();
    assert_eq!(guest.principal.kind, "guest");
    assert!(
        runtime
            .principals(Some("persona"))
            .unwrap()
            .iter()
            .any(|principal| principal.id.as_str() == "dev:alice")
    );

    let snapshot = temp_path();
    runtime.store().snapshot_to(&snapshot).unwrap();
    let connection = rusqlite::Connection::open(&snapshot).unwrap();
    let hash: String = connection
        .query_row("SELECT hash FROM _credentials LIMIT 1", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert!(hash.starts_with("$argon2id$v="));
    drop(connection);
    cleanup(&snapshot);
}

#[test]
fn unknown_email_and_wrong_password_each_verify_once() {
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation(true, false)).unwrap();
    runtime
        .signup("known@example.com", "long enough password", 1)
        .unwrap();

    let verification_calls = |runtime: &mut Runtime, email: &str| {
        let before = snapback2_core::identity::password_verification_calls();
        assert!(matches!(
            runtime.login(email, "definitely wrong", 2),
            Err(IdentityError::Invalid)
        ));
        snapback2_core::identity::password_verification_calls()
            .checked_sub(before)
            .unwrap()
    };
    assert_eq!(verification_calls(&mut runtime, "unknown@example.com"), 1);
    assert_eq!(verification_calls(&mut runtime, "known@example.com"), 1);
}

fn temp_path() -> PathBuf {
    std::env::temp_dir().join(format!(
        "snapback2-identity-{}-{}.sqlite",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

fn cleanup(path: &Path) {
    for path in [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ] {
        let _ = std::fs::remove_file(path);
    }
}
