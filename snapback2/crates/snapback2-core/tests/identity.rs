use sha2::{Digest, Sha256};
use snapback2_core::*;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static NEXT_TEMP_PATH: AtomicU64 = AtomicU64::new(0);

fn generation(password: bool, guests: bool) -> Generation {
    let auth = Auth { password, guests };
    Generation::certify(
        &ProjectJson {
            version: 1,
            schema: Schema {
                schedules: Vec::new(),
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
    assert!(Actor::new("system", "user").is_err());
    assert!(Actor::new("user:any", "system").is_err());

    assert!(matches!(
        runtime.signup("a@example.com", "short", 10),
        Err(IdentityError::PasswordWeak)
    ));
    let signup = runtime
        .signup("Alice@Example.com", "long enough password", 20)
        .unwrap();
    assert!(signup.auth_epoch > 0);
    assert_ne!(signup.principal.id.as_str(), SYSTEM_PRINCIPAL_ID.as_str());
    assert!(Actor::try_from(&signup.principal).is_ok());
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
    let authority = runtime.authenticate(&login.token, 24).unwrap();
    assert_eq!(authority.principal, login.principal);
    assert_eq!(authority.auth_epoch, login.auth_epoch);
    assert_eq!(runtime.logout(&login.token, 24).unwrap(), authority);
    assert!(matches!(
        runtime.authenticate(&login.token, 24),
        Err(IdentityError::Session)
    ));
    assert!(matches!(runtime.guest(25), Err(IdentityError::GuestsOff)));

    let persona_principal = runtime.ensure_persona("alice", 30).unwrap();
    assert_eq!(persona_principal.id.as_str(), "dev:alice");
    let persona = runtime.persona("alice", 31).unwrap();
    let second_persona = runtime.persona("alice", 32).unwrap();
    assert_eq!(persona.principal, persona_principal);
    assert_eq!(second_persona.principal, persona_principal);
    assert_ne!(second_persona.token, persona.token);
    assert!(second_persona.auth_epoch > persona.auth_epoch);
    assert!(persona.expires_at < i64::MAX);
    assert!(matches!(
        runtime.persona("system", 32),
        Err(IdentityError::ReservedSystem)
    ));
    assert!(matches!(
        runtime.ensure_persona("system", 32),
        Err(IdentityError::ReservedSystem)
    ));

    runtime.apply_successor(generation(true, true)).unwrap();
    let guest = runtime.guest(40).unwrap();
    assert_eq!(guest.principal.kind, "guest");
    assert_ne!(guest.principal.id.as_str(), SYSTEM_PRINCIPAL_ID.as_str());
    assert!(Actor::try_from(&guest.principal).is_ok());
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

#[test]
fn sessions_store_only_domain_separated_digests_and_redact_debug() {
    let path = temp_path();
    let snapshot = temp_path();
    let session;
    {
        let mut runtime =
            Runtime::open(Store::open(&path).unwrap(), generation(true, false)).unwrap();
        session = runtime
            .signup("digest@example.com", "long enough password", 100)
            .unwrap();
        assert!(!format!("{session:?}").contains(&session.token));
        assert!(format!("{session:?}").contains("[REDACTED]"));
        runtime.store().snapshot_to(&snapshot).unwrap();
        assert_files_omit(&path, session.token.as_bytes());
        assert_files_omit(&snapshot, session.token.as_bytes());
    }

    let connection = rusqlite::Connection::open(&snapshot).unwrap();
    let columns = connection
        .prepare("PRAGMA table_info(_sessions)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(
        columns,
        [
            "auth_epoch",
            "token_digest",
            "principal",
            "kind",
            "created_at",
            "expires_at",
        ]
    );
    let (epoch, digest, digest_type, digest_length): (i64, Vec<u8>, String, i64) = connection
        .query_row(
            "SELECT auth_epoch, token_digest, typeof(token_digest), length(token_digest)
             FROM _sessions",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    let mut expected = Sha256::new();
    expected.update(b"snapback2-session-token-v1\0");
    expected.update(session.token.as_bytes());
    assert_eq!(epoch as u64, session.auth_epoch);
    assert_eq!(digest, expected.finalize().as_slice());
    assert_eq!(digest_type, "blob");
    assert_eq!(digest_length, 32);
    drop(connection);

    let runtime = Runtime::open(Store::open(&path).unwrap(), generation(true, false)).unwrap();
    assert_eq!(
        runtime
            .authenticate(&session.token, 101)
            .unwrap()
            .auth_epoch,
        session.auth_epoch
    );
    drop(runtime);
    cleanup(&path);
    cleanup(&snapshot);
}

#[test]
fn one_byte_token_mutation_and_expiry_boundary_fail_closed() {
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation(true, false)).unwrap();
    let session = runtime
        .signup("boundary@example.com", "long enough password", 1_000)
        .unwrap();
    let mut mutated = session.token.clone().into_bytes();
    mutated[0] = if mutated[0] == b'A' { b'B' } else { b'A' };
    let mutated = String::from_utf8(mutated).unwrap();
    assert!(matches!(
        runtime.authenticate(&mutated, 1_001),
        Err(IdentityError::Session)
    ));
    assert_eq!(
        runtime
            .authenticate(&session.token, session.expires_at - 1)
            .unwrap()
            .auth_epoch,
        session.auth_epoch
    );
    assert!(matches!(
        runtime.authenticate(&session.token, session.expires_at),
        Err(IdentityError::Session)
    ));
    assert!(matches!(
        runtime.authenticate(&session.token, session.expires_at - 1),
        Err(IdentityError::Session)
    ));
    assert_eq!(runtime.next_session_expiry().unwrap(), None);
}

#[test]
fn exact_logout_expiry_and_reopen_never_reuse_session_epochs() {
    let path = temp_path();
    let first_epoch;
    let second_epoch;
    let email = "epochs@example.com";
    {
        let mut runtime =
            Runtime::open(Store::open(&path).unwrap(), generation(true, false)).unwrap();
        let first = runtime.signup(email, "long enough password", 100).unwrap();
        let second = runtime.login(email, "long enough password", 101).unwrap();
        first_epoch = first.auth_epoch;
        second_epoch = second.auth_epoch;
        assert!(second_epoch > first_epoch);
        assert_eq!(
            runtime.logout(&first.token, 102).unwrap().auth_epoch,
            first_epoch
        );
        assert!(matches!(
            runtime.logout(&first.token, 102),
            Err(IdentityError::Session)
        ));
        assert_eq!(
            runtime.authenticate(&second.token, 102).unwrap().auth_epoch,
            second_epoch
        );
        assert_eq!(
            runtime.next_session_expiry().unwrap(),
            Some(second.expires_at)
        );
        let expired = runtime.expire_sessions(second.expires_at).unwrap();
        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0].auth_epoch, second_epoch);
        assert!(matches!(
            runtime.authenticate(&second.token, 102),
            Err(IdentityError::Session)
        ));
    }

    let mut runtime = Runtime::open(Store::open(&path).unwrap(), generation(true, false)).unwrap();
    let third = runtime
        .login(email, "long enough password", 100_000_000)
        .unwrap();
    assert!(third.auth_epoch > second_epoch);
    drop(runtime);
    cleanup(&path);
}

#[test]
fn ensure_persona_is_session_free_and_persona_issues_fresh_finite_bearers() {
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation(true, false)).unwrap();
    let first = runtime.ensure_persona("dev", 10).unwrap();
    let second = runtime.ensure_persona("dev", 11).unwrap();
    assert_eq!(first, second);
    assert_eq!(runtime.next_session_expiry().unwrap(), None);

    let first_session = runtime.persona("dev", 12).unwrap();
    let second_session = runtime.persona("dev", 13).unwrap();
    assert_eq!(first_session.principal, first);
    assert_eq!(second_session.principal, first);
    assert_ne!(first_session.token, second_session.token);
    assert!(second_session.auth_epoch > first_session.auth_epoch);
    assert!(first_session.expires_at > 12);
    assert!(first_session.expires_at < i64::MAX);
}

#[test]
fn repeated_logins_and_invalid_credentials_do_not_limit_later_logins() {
    let path = temp_path();
    let emails = [
        "alice@example.com",
        "bob@example.com",
        "charlie@example.com",
    ];
    let password = "long enough password";
    let now = 5_000;
    {
        let mut runtime =
            Runtime::open(Store::open(&path).unwrap(), generation(true, false)).unwrap();
        for email in emails {
            runtime.signup(email, password, now).unwrap();
        }
        // Four three-user seed/acceptance rounds at one instant exceed both
        // former limits: three per email and eight globally per minute.
        for _ in 0..4 {
            for email in emails {
                let session = runtime.login(email, password, now).unwrap();
                runtime.authenticate(&session.token, now).unwrap();
                runtime.logout(&session.token, now).unwrap();
            }
        }
        for email in [emails[0], "unknown@example.com"] {
            let before = snapback2_core::identity::password_verification_calls();
            assert!(matches!(
                runtime.login(email, "wrong password", now),
                Err(IdentityError::Invalid)
            ));
            assert_eq!(
                snapback2_core::identity::password_verification_calls() - before,
                1,
                "known and unknown emails still perform password verification"
            );
        }
    }
    let mut runtime = Runtime::open(Store::open(&path).unwrap(), generation(true, false)).unwrap();
    runtime.login(" ALICE@EXAMPLE.COM ", password, now).unwrap();
    drop(runtime);
    cleanup(&path);
}

#[test]
fn registration_rolls_back_principal_and_credential_when_session_insert_fails() {
    let path = temp_path();
    drop(Store::open(&path).unwrap());
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "CREATE TRIGGER fail_session BEFORE INSERT ON _sessions
             BEGIN SELECT RAISE(ABORT, 'forced session failure'); END;",
        )
        .unwrap();
    drop(connection);

    let mut runtime = Runtime::open(Store::open(&path).unwrap(), generation(true, false)).unwrap();
    assert!(matches!(
        runtime.signup("atomic@example.com", "long enough password", 10),
        Err(IdentityError::Store(_))
    ));
    let snapshot = temp_path();
    runtime.store().snapshot_to(&snapshot).unwrap();
    let connection = rusqlite::Connection::open(&snapshot).unwrap();
    let principals: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM _principals WHERE id <> 'system'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let credentials: i64 = connection
        .query_row("SELECT COUNT(*) FROM _credentials", [], |row| row.get(0))
        .unwrap();
    let sessions: i64 = connection
        .query_row("SELECT COUNT(*) FROM _sessions", [], |row| row.get(0))
        .unwrap();
    assert_eq!((principals, credentials, sessions), (0, 0, 0));
    drop(connection);
    drop(runtime);
    cleanup(&path);
    cleanup(&snapshot);
}

fn temp_path() -> PathBuf {
    std::env::temp_dir().join(format!(
        "snapback2-identity-{}-{}-{}.sqlite",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        NEXT_TEMP_PATH.fetch_add(1, Ordering::Relaxed)
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

fn assert_files_omit(path: &Path, needle: &[u8]) {
    for path in [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ] {
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        assert!(
            !bytes.windows(needle.len()).any(|window| window == needle),
            "{} contains raw bearer bytes",
            path.display()
        );
    }
}
