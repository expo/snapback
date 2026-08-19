pub use snapback_auth::auth::sender_proof::*;

use crate::auth::wire::SenderPublicJwk;
use crate::contract_types::{
    ReplayConsumeError, SenderNonce, SenderNonceError, SenderNonceIssue, SenderNonceRead,
    SenderProofIdConsumption, SenderProofNonceRotation, VerifiedSenderProof,
};
use crate::storage::auth_sender::{self, SenderProofAuthorityOperations};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::rand::{SecureRandom, SystemRandom};
use snapback_services::test_support::rusqlite::{
    Connection, ErrorCode, OptionalExtension, Transaction, params,
};

fn sender_replay_epoch(connection: &Connection) -> Result<u64, ReplayConsumeError> {
    auth_sender::sender_replay_epoch_on(connection)
}

fn apply_sender_replay_epoch_floor(
    connection: &mut Connection,
    floor: u64,
) -> Result<(), ReplayConsumeError> {
    auth_sender::apply_sender_replay_epoch_floor_on(connection, floor)
}

fn rotate_sender_replay_epoch_for_stream_reset(
    transaction: &Transaction<'_>,
) -> Result<(), ReplayConsumeError> {
    auth_sender::rotate_sender_replay_epoch_for_stream_reset_on(transaction)
}

fn issue_sender_nonce(
    authority: &mut impl SenderProofAuthorityOperations,
    sender_replay_epoch: u64,
    family_jwk_thumbprint: &str,
    nonce: &str,
    now_seconds: u64,
    expires_at_seconds: u64,
    capacity: Option<u64>,
) -> Result<SenderNonce, SenderNonceError> {
    authority.issue_nonce(SenderNonceIssue {
        sender_replay_epoch,
        family_jwk_thumbprint,
        nonce,
        now_seconds,
        expires_at_seconds,
        capacity,
    })
}

fn read_sender_nonce(
    authority: &impl SenderProofAuthorityOperations,
    sender_replay_epoch: u64,
    family_jwk_thumbprint: &str,
    now_seconds: u64,
) -> Result<Option<SenderNonce>, SenderNonceError> {
    authority.read_nonce(SenderNonceRead {
        sender_replay_epoch,
        family_jwk_thumbprint,
        now_seconds,
    })
}

#[allow(clippy::too_many_arguments)]
fn consume_sender_proof_and_rotate_nonce(
    authority: &mut impl SenderProofAuthorityOperations,
    sender_replay_epoch: u64,
    family_jwk_thumbprint: &str,
    current: &SenderNonce,
    verified: &VerifiedSenderProof,
    now_seconds: u64,
    replay_expires_at_seconds: u64,
    next_nonce: &str,
    next_nonce_expires_at_seconds: u64,
    replay_capacity: Option<u64>,
) -> Result<SenderNonce, SenderNonceError> {
    authority.consume_proof_and_rotate_nonce(SenderProofNonceRotation {
        sender_replay_epoch,
        family_jwk_thumbprint,
        current,
        verified,
        now_seconds,
        replay_expires_at_seconds,
        next_nonce,
        next_nonce_expires_at_seconds,
        replay_capacity,
    })
}

fn consume_sender_proof_id(
    authority: &mut impl SenderProofAuthorityOperations,
    sender_replay_epoch: u64,
    proof_id: [u8; 16],
    now_seconds: u64,
    expires_at_seconds: u64,
    capacity: Option<u64>,
) -> Result<(), ReplayConsumeError> {
    authority.consume_proof_id(SenderProofIdConsumption {
        sender_replay_epoch,
        proof_id,
        now_seconds,
        expires_at_seconds,
        capacity,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::{OsRandom, SessionBearer};
    use ring::rand::SystemRandom;
    use ring::signature::{ECDSA_P256_SHA256_FIXED_SIGNING, EcdsaKeyPair, KeyPair};
    use serde_json::{Value, json};
    use std::sync::{Arc, Barrier};
    use std::time::{Duration, Instant};

    struct ProofKey {
        key: EcdsaKeyPair,
        x: String,
        y: String,
        thumbprint: String,
    }

    fn proof_key() -> ProofKey {
        let random = SystemRandom::new();
        let pkcs8 = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &random)
            .expect("generate key");
        let key =
            EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, pkcs8.as_ref(), &random)
                .expect("parse key");
        let public = key.public_key().as_ref();
        let x = URL_SAFE_NO_PAD.encode(&public[1..33]);
        let y = URL_SAFE_NO_PAD.encode(&public[33..65]);
        let thumbprint = sha256_base64url(
            format!("{{\"crv\":\"P-256\",\"kty\":\"EC\",\"x\":\"{x}\",\"y\":\"{y}\"}}").as_bytes(),
        );
        ProofKey {
            key,
            x,
            y,
            thumbprint,
        }
    }

    fn sign_proof(
        proof_key: &ProofKey,
        token: &str,
        nonce: &str,
        issued_at_seconds: u64,
        proof_id: [u8; 16],
    ) -> String {
        let random = SystemRandom::new();
        let header = URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&json!({
                "alg": "ES256",
                "jwk": {
                    "crv": "P-256",
                    "kty": "EC",
                    "x": proof_key.x,
                    "y": proof_key.y
                },
                "typ": "dpop+jwt"
            }))
            .unwrap(),
        );
        let payload = URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&json!({
                "ath": sha256_base64url(token.as_bytes()),
                "htm": "POST",
                "htu": "https://app.example.test/query",
                "iat": issued_at_seconds,
                "jti": URL_SAFE_NO_PAD.encode(proof_id),
                "nonce": nonce,
                "version": 2
            }))
            .unwrap(),
        );
        let signing_input = format!("{header}.{payload}");
        let signature = proof_key
            .key
            .sign(&random, signing_input.as_bytes())
            .expect("sign");
        format!(
            "{signing_input}.{}",
            URL_SAFE_NO_PAD.encode(signature.as_ref())
        )
    }

    fn sign_issuance_proof(
        proof_key: &ProofKey,
        challenge_id: &str,
        issued_at_seconds: u64,
        proof_id: [u8; 16],
    ) -> String {
        let random = SystemRandom::new();
        let header = URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&json!({
                "alg": "ES256",
                "jwk": {
                    "crv": "P-256",
                    "kty": "EC",
                    "x": proof_key.x,
                    "y": proof_key.y
                },
                "typ": "dpop+jwt"
            }))
            .unwrap(),
        );
        let payload = URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&json!({
                "challengeId": challenge_id,
                "htm": "POST",
                "htu": "https://app.example.test/auth/exchange",
                "iat": issued_at_seconds,
                "jti": URL_SAFE_NO_PAD.encode(proof_id),
                "protocol": SENDER_ISSUANCE_PROTOCOL,
                "version": 2
            }))
            .unwrap(),
        );
        let signing_input = format!("{header}.{payload}");
        let signature = proof_key
            .key
            .sign(&random, signing_input.as_bytes())
            .expect("sign issuance proof");
        format!(
            "{signing_input}.{}",
            URL_SAFE_NO_PAD.encode(signature.as_ref())
        )
    }

    fn proof_fixture() -> (String, SenderProofExpectation<'static>) {
        let key = proof_key();
        let compact = sign_proof(&key, "sbs_test", "nonce-1", 1_000, [7_u8; 16]);
        (
            compact,
            SenderProofExpectation {
                method: "POST",
                canonical_external_uri: "https://app.example.test/query",
                access_token: b"sbs_test",
                nonce: "nonce-1",
                family_jwk_thumbprint: Box::leak(key.thumbprint.into_boxed_str()),
                server_unix_seconds: 1_000,
            },
        )
    }

    fn compact_with_segment(compact: &str, index: usize, replacement: String) -> String {
        let mut parts: Vec<String> = compact.split('.').map(str::to_owned).collect();
        assert_eq!(parts.len(), 3);
        parts[index] = replacement;
        parts.join(".")
    }

    fn compact_with_json_mutation(
        compact: &str,
        index: usize,
        mutate: impl FnOnce(&mut Value),
    ) -> String {
        let parts: Vec<&str> = compact.split('.').collect();
        let mut value: Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[index]).unwrap()).unwrap();
        mutate(&mut value);
        compact_with_segment(
            compact,
            index,
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&value).unwrap()),
        )
    }

    #[test]
    fn es256_sender_proof_binds_every_expected_fact() {
        let (proof, expected) = proof_fixture();
        let verified = verify_sender_proof(&proof, &expected).expect("valid proof");
        assert_eq!(verified.proof_id, [7_u8; 16]);

        let mut wrong_method = expected.clone();
        wrong_method.method = "GET";
        assert_eq!(
            verify_sender_proof(&proof, &wrong_method),
            Err(SenderProofError::Binding)
        );
        let mut wrong_uri = expected.clone();
        wrong_uri.canonical_external_uri = "https://app.example.test/other";
        assert_eq!(
            verify_sender_proof(&proof, &wrong_uri),
            Err(SenderProofError::Binding)
        );
        let mut wrong_token = expected.clone();
        wrong_token.access_token = b"sbs_other";
        assert_eq!(
            verify_sender_proof(&proof, &wrong_token),
            Err(SenderProofError::Binding)
        );
        let mut wrong_nonce = expected.clone();
        wrong_nonce.nonce = "nonce-2";
        assert_eq!(
            verify_sender_proof(&proof, &wrong_nonce),
            Err(SenderProofError::Nonce)
        );
        let mut wrong_thumbprint = expected.clone();
        wrong_thumbprint.family_jwk_thumbprint = "wrong-thumbprint";
        assert_eq!(
            verify_sender_proof(&proof, &wrong_thumbprint),
            Err(SenderProofError::Binding)
        );

        let mut oldest_accepted = expected.clone();
        oldest_accepted.server_unix_seconds = 1_030;
        verify_sender_proof(&proof, &oldest_accepted).expect("past boundary is inclusive");
        let mut newest_accepted = expected.clone();
        newest_accepted.server_unix_seconds = 995;
        verify_sender_proof(&proof, &newest_accepted).expect("future boundary is inclusive");
        let mut stale = expected.clone();
        stale.server_unix_seconds = 1_031;
        assert_eq!(
            verify_sender_proof(&proof, &stale),
            Err(SenderProofError::Time)
        );
        let mut future = expected;
        future.server_unix_seconds = 994;
        assert_eq!(
            verify_sender_proof(&proof, &future),
            Err(SenderProofError::Time)
        );
    }

    #[test]
    fn sender_proof_codec_and_signature_negative_matrix_is_closed() {
        let (proof, expected) = proof_fixture();

        for invalid in [
            compact_with_json_mutation(&proof, 0, |header| header["alg"] = json!("HS256")),
            compact_with_json_mutation(&proof, 0, |header| header["typ"] = json!("JWT")),
            compact_with_json_mutation(&proof, 0, |header| header["jwk"]["crv"] = json!("P-384")),
            compact_with_json_mutation(&proof, 1, |payload| payload["version"] = json!(3)),
        ] {
            assert_eq!(
                verify_sender_proof(&invalid, &expected),
                Err(SenderProofError::Algorithm)
            );
        }

        for invalid in [
            compact_with_json_mutation(&proof, 0, |header| header["crit"] = json!(["alg"])),
            compact_with_json_mutation(&proof, 0, |header| header["jwk"]["use"] = json!("sig")),
            compact_with_json_mutation(&proof, 0, |header| {
                let x = header["jwk"]["x"].as_str().unwrap().to_owned();
                header["jwk"]["x"] = json!(format!("{x}="));
            }),
            compact_with_json_mutation(&proof, 1, |payload| payload["extra"] = json!(true)),
            compact_with_json_mutation(&proof, 1, |payload| {
                payload["jti"] = json!(URL_SAFE_NO_PAD.encode([1_u8; 15]))
            }),
            compact_with_segment(&proof, 1, format!("{}=", proof.split('.').nth(1).unwrap())),
            format!("{proof}.extra"),
        ] {
            assert_eq!(
                verify_sender_proof(&invalid, &expected),
                Err(SenderProofError::Malformed)
            );
        }

        let parts: Vec<&str> = proof.split('.').collect();
        let duplicate_header = URL_SAFE_NO_PAD.encode(
            br#"{"alg":"ES256","alg":"ES256","jwk":{"crv":"P-256","kty":"EC","x":"x","y":"y"},"typ":"dpop+jwt"}"#,
        );
        assert_eq!(
            verify_sender_proof(
                &format!("{duplicate_header}.{}.{}", parts[1], parts[2]),
                &expected,
            ),
            Err(SenderProofError::Malformed)
        );
        let duplicate_payload = URL_SAFE_NO_PAD.encode(
            br#"{"ath":"a","htm":"POST","htu":"https://app.example.test/query","iat":1000,"jti":"AAAAAAAAAAAAAAAAAAAAAA","nonce":"nonce-1","nonce":"nonce-1","version":2}"#,
        );
        assert_eq!(
            verify_sender_proof(
                &format!("{}.{duplicate_payload}.{}", parts[0], parts[2]),
                &expected,
            ),
            Err(SenderProofError::Malformed)
        );

        let mut signature = URL_SAFE_NO_PAD.decode(parts[2]).unwrap();
        signature[0] ^= 0x80;
        let bad_signature = compact_with_segment(&proof, 2, URL_SAFE_NO_PAD.encode(signature));
        assert_eq!(
            verify_sender_proof(&bad_signature, &expected),
            Err(SenderProofError::Signature)
        );
    }

    #[test]
    fn issuance_proof_binds_challenge_endpoint_and_separate_public_jwk() {
        let key = proof_key();
        let proof = sign_issuance_proof(&key, "challenge-1", 1_000, [8; 16]);
        let public_jwk = SenderPublicJwk {
            crv: "P-256".to_owned(),
            kty: "EC".to_owned(),
            x: key.x.clone(),
            y: key.y.clone(),
        };
        let expected = SenderIssuanceExpectation {
            challenge_id: "challenge-1",
            canonical_exchange_uri: "https://app.example.test/auth/exchange",
            public_jwk: &public_jwk,
            server_unix_seconds: 1_000,
        };
        let verified =
            verify_sender_issuance_proof(&proof, &expected).expect("valid issuance proof");
        assert_eq!(verified.proof_id, [8; 16]);
        assert_eq!(verified.jwk_thumbprint, key.thumbprint);

        let wrong_jwk = SenderPublicJwk {
            x: URL_SAFE_NO_PAD.encode([1_u8; 32]),
            ..public_jwk.clone()
        };
        let wrong_key = SenderIssuanceExpectation {
            public_jwk: &wrong_jwk,
            ..expected.clone()
        };
        assert_eq!(
            verify_sender_issuance_proof(&proof, &wrong_key),
            Err(SenderProofError::Binding)
        );
        let wrong_challenge = SenderIssuanceExpectation {
            challenge_id: "challenge-2",
            ..expected
        };
        assert_eq!(
            verify_sender_issuance_proof(&proof, &wrong_challenge),
            Err(SenderProofError::Binding)
        );
    }

    #[test]
    fn sender_proof_rejects_unknown_and_duplicate_fields() {
        let (proof, expected) = proof_fixture();
        let parts: Vec<_> = proof.split('.').collect();
        let header = URL_SAFE_NO_PAD.encode(
            br#"{"alg":"ES256","alg":"ES256","jwk":{"crv":"P-256","kty":"EC","x":"x","y":"y"},"typ":"dpop+jwt"}"#,
        );
        let duplicate = format!("{header}.{}.{}", parts[1], parts[2]);
        assert_eq!(
            verify_sender_proof(&duplicate, &expected),
            Err(SenderProofError::Malformed)
        );
    }

    #[test]
    fn replay_authority_is_atomic_bounded_and_restart_durable() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_sender_proof_replay_after_hosted_preflight(&connection).unwrap();
        consume_sender_proof_id(&mut connection, 7, [1; 16], 100, 140, Some(2)).unwrap();
        assert_eq!(
            consume_sender_proof_id(&mut connection, 7, [1; 16], 100, 140, Some(2)),
            Err(ReplayConsumeError::Replay)
        );
        consume_sender_proof_id(&mut connection, 7, [2; 16], 100, 140, Some(2)).unwrap();
        assert_eq!(
            consume_sender_proof_id(&mut connection, 7, [3; 16], 100, 140, Some(2)),
            Err(ReplayConsumeError::Capacity)
        );
        assert_eq!(
            consume_sender_proof_id(&mut connection, 8, [3; 16], 140, 180, Some(2)),
            Err(ReplayConsumeError::Capacity),
            "expiry is exclusive at the final retained second",
        );
        consume_sender_proof_id(&mut connection, 8, [3; 16], 141, 180, Some(2)).unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM _snapback_sender_proof_replay",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
    }

    fn race_production_sender_transaction(
        database: &std::path::Path,
    ) -> Result<SenderNonce, SenderNonceError> {
        let mut connection = Connection::open(database).unwrap();
        connection.busy_timeout(Duration::from_secs(5)).unwrap();
        let thumbprint = URL_SAFE_NO_PAD.encode([42_u8; 32]);
        let current = read_sender_nonce(&connection, 7, &thumbprint, 100)
            .unwrap()
            .expect("installed race nonce");
        consume_sender_proof_and_rotate_nonce(
            &mut connection,
            7,
            &thumbprint,
            &current,
            &VerifiedSenderProof {
                proof_id: [42_u8; 16],
                jwk_thumbprint: thumbprint.clone(),
                issued_at_seconds: 100,
            },
            100,
            131,
            &URL_SAFE_NO_PAD.encode([43_u8; 32]),
            170,
            Some(2),
        )
    }

    fn initialize_production_sender_race(database: &std::path::Path) {
        let mut connection = Connection::open(database).unwrap();
        initialize_sender_proof_replay_after_hosted_preflight(&connection).unwrap();
        let thumbprint = URL_SAFE_NO_PAD.encode([42_u8; 32]);
        issue_sender_nonce(
            &mut connection,
            7,
            &thumbprint,
            &URL_SAFE_NO_PAD.encode([41_u8; 32]),
            100,
            160,
            Some(2),
        )
        .unwrap();
    }

    #[test]
    fn two_sqlite_connections_racing_production_transaction_have_one_success_and_one_replay() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("sender-replay.sqlite");
        initialize_production_sender_race(&database);

        let barrier = Arc::new(Barrier::new(3));
        let mut workers = Vec::new();
        for _ in 0..2 {
            let barrier = barrier.clone();
            let database = database.clone();
            workers.push(std::thread::spawn(move || {
                let mut connection = Connection::open(&database).unwrap();
                connection.busy_timeout(Duration::from_secs(5)).unwrap();
                let thumbprint = URL_SAFE_NO_PAD.encode([42_u8; 32]);
                let current = read_sender_nonce(&connection, 7, &thumbprint, 100)
                    .unwrap()
                    .expect("installed race nonce");
                barrier.wait();
                consume_sender_proof_and_rotate_nonce(
                    &mut connection,
                    7,
                    &thumbprint,
                    &current,
                    &VerifiedSenderProof {
                        proof_id: [42_u8; 16],
                        jwk_thumbprint: thumbprint.clone(),
                        issued_at_seconds: 100,
                    },
                    100,
                    131,
                    &URL_SAFE_NO_PAD.encode([43_u8; 32]),
                    170,
                    Some(2),
                )
            }));
        }
        barrier.wait();
        let results: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| **result == Err(SenderNonceError::Replay))
                .count(),
            1
        );
    }

    #[test]
    fn two_processes_racing_production_transaction_have_one_success_and_one_replay() {
        const CHILD_ENV: &str = "SNAPBACK_TEST_SENDER_REPLAY_PROCESS_CHILD";
        const DATABASE_ENV: &str = "SNAPBACK_TEST_SENDER_REPLAY_PROCESS_DATABASE";
        const READY_ENV: &str = "SNAPBACK_TEST_SENDER_REPLAY_PROCESS_READY";
        const START_ENV: &str = "SNAPBACK_TEST_SENDER_REPLAY_PROCESS_START";

        if std::env::var_os(CHILD_ENV).is_some() {
            let database = std::env::var_os(DATABASE_ENV).expect("child database path");
            let ready = std::env::var_os(READY_ENV).expect("child ready path");
            let start = std::env::var_os(START_ENV).expect("child start path");
            let database = std::path::PathBuf::from(database);
            let ready = std::path::PathBuf::from(ready);
            let start = std::path::PathBuf::from(start);

            let connection = Connection::open(&database).unwrap();
            connection.busy_timeout(Duration::from_secs(5)).unwrap();
            let thumbprint = URL_SAFE_NO_PAD.encode([42_u8; 32]);
            assert!(
                read_sender_nonce(&connection, 7, &thumbprint, 100)
                    .unwrap()
                    .is_some(),
                "child observes the exact predecessor before publication",
            );
            drop(connection);
            std::fs::write(&ready, b"ready").unwrap();
            let deadline = Instant::now() + Duration::from_secs(10);
            while !start.exists() {
                assert!(
                    Instant::now() < deadline,
                    "parent did not release sender replay process race",
                );
                std::thread::sleep(Duration::from_millis(5));
            }

            match race_production_sender_transaction(&database) {
                Ok(_) => println!("SNAPBACK_SENDER_REPLAY_PROCESS_RESULT=success"),
                Err(SenderNonceError::Replay) => {
                    println!("SNAPBACK_SENDER_REPLAY_PROCESS_RESULT=replay")
                }
                other => panic!("unexpected process race outcome: {other:?}"),
            }
            return;
        }

        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("sender-replay-process.sqlite");
        let start = directory.path().join("start");
        initialize_production_sender_race(&database);

        let test_name = "auth::sender_proof_tests::tests::two_processes_racing_production_transaction_have_one_success_and_one_replay";
        let mut children = Vec::new();
        let mut ready_paths = Vec::new();
        for index in 0..2 {
            let ready = directory.path().join(format!("ready-{index}"));
            ready_paths.push(ready.clone());
            children.push(
                std::process::Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", test_name, "--nocapture"])
                    .env(CHILD_ENV, "1")
                    .env(DATABASE_ENV, &database)
                    .env(READY_ENV, ready)
                    .env(START_ENV, &start)
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .spawn()
                    .expect("spawn sender replay process worker"),
            );
        }

        let deadline = Instant::now() + Duration::from_secs(10);
        while ready_paths.iter().any(|path| !path.exists()) {
            assert!(
                Instant::now() < deadline,
                "sender replay process workers did not become ready",
            );
            std::thread::sleep(Duration::from_millis(5));
        }
        std::fs::write(&start, b"start").unwrap();

        let outputs: Vec<_> = children
            .into_iter()
            .map(|child| child.wait_with_output().unwrap())
            .collect();
        for output in &outputs {
            assert!(
                output.status.success(),
                "sender replay child failed\nstdout:\n{}\nstderr:\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr),
            );
        }
        let combined = outputs
            .iter()
            .map(|output| String::from_utf8_lossy(&output.stdout))
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(
            combined
                .matches("SNAPBACK_SENDER_REPLAY_PROCESS_RESULT=success")
                .count(),
            1,
            "{combined}",
        );
        assert_eq!(
            combined
                .matches("SNAPBACK_SENDER_REPLAY_PROCESS_RESULT=replay")
                .count(),
            1,
            "{combined}",
        );
    }

    #[test]
    fn replay_authority_fails_closed_when_not_initialized() {
        let mut connection = Connection::open_in_memory().unwrap();
        assert_eq!(
            consume_sender_proof_id(&mut connection, 1, [1; 16], 1, 10, None),
            Err(ReplayConsumeError::Unavailable)
        );
    }

    #[test]
    fn nonce_use_atomically_consumes_proof_and_rotates_generation() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_sender_proof_replay_after_hosted_preflight(&connection).unwrap();
        let thumbprint = URL_SAFE_NO_PAD.encode([9_u8; 32]);
        let nonce_1 = URL_SAFE_NO_PAD.encode([1_u8; 32]);
        let nonce_2 = URL_SAFE_NO_PAD.encode([2_u8; 32]);
        let installed =
            issue_sender_nonce(&mut connection, 7, &thumbprint, &nonce_1, 100, 160, Some(2))
                .unwrap();
        assert_eq!(installed.generation, 1);
        assert!(!format!("{installed:?}").contains(&nonce_1));
        assert_eq!(
            read_sender_nonce(&connection, 7, &thumbprint, 100).unwrap(),
            Some(installed.clone())
        );

        let proof = VerifiedSenderProof {
            proof_id: [3_u8; 16],
            jwk_thumbprint: thumbprint.clone(),
            issued_at_seconds: 100,
        };
        let rotated = consume_sender_proof_and_rotate_nonce(
            &mut connection,
            7,
            &thumbprint,
            &installed,
            &proof,
            100,
            135,
            &nonce_2,
            170,
            Some(2),
        )
        .unwrap();
        assert_eq!(rotated.generation, 2);
        assert_eq!(rotated.expose_for_transport(), nonce_2);
        assert_eq!(
            read_sender_nonce(&connection, 7, &thumbprint, 100).unwrap(),
            Some(rotated)
        );
        assert_eq!(
            consume_sender_proof_and_rotate_nonce(
                &mut connection,
                7,
                &thumbprint,
                &installed,
                &proof,
                100,
                135,
                &URL_SAFE_NO_PAD.encode([4_u8; 32]),
                170,
                Some(2),
            ),
            Err(SenderNonceError::Replay)
        );
    }

    #[test]
    fn replay_refusal_rolls_back_nonce_rotation() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_sender_proof_replay_after_hosted_preflight(&connection).unwrap();
        let first_thumbprint = URL_SAFE_NO_PAD.encode([8_u8; 32]);
        let second_thumbprint = URL_SAFE_NO_PAD.encode([9_u8; 32]);
        let first_nonce = URL_SAFE_NO_PAD.encode([1_u8; 32]);
        let second_nonce = URL_SAFE_NO_PAD.encode([2_u8; 32]);
        let first = issue_sender_nonce(
            &mut connection,
            9,
            &first_thumbprint,
            &first_nonce,
            200,
            260,
            None,
        )
        .unwrap();
        let second = issue_sender_nonce(
            &mut connection,
            9,
            &second_thumbprint,
            &second_nonce,
            200,
            260,
            None,
        )
        .unwrap();
        let proof_id = [5_u8; 16];
        let first_proof = VerifiedSenderProof {
            proof_id,
            jwk_thumbprint: first_thumbprint.clone(),
            issued_at_seconds: 200,
        };
        consume_sender_proof_and_rotate_nonce(
            &mut connection,
            9,
            &first_thumbprint,
            &first,
            &first_proof,
            200,
            235,
            &URL_SAFE_NO_PAD.encode([3_u8; 32]),
            270,
            None,
        )
        .unwrap();
        let second_proof = VerifiedSenderProof {
            proof_id,
            jwk_thumbprint: second_thumbprint.clone(),
            issued_at_seconds: 200,
        };
        assert_eq!(
            consume_sender_proof_and_rotate_nonce(
                &mut connection,
                9,
                &second_thumbprint,
                &second,
                &second_proof,
                200,
                235,
                &URL_SAFE_NO_PAD.encode([4_u8; 32]),
                270,
                None,
            ),
            Err(SenderNonceError::Replay)
        );
        assert_eq!(
            read_sender_nonce(&connection, 9, &second_thumbprint, 200).unwrap(),
            Some(second)
        );
    }

    #[test]
    fn nonce_authority_is_bounded_and_unavailable_before_preflight() {
        let mut uninitialized = Connection::open_in_memory().unwrap();
        let thumbprint = URL_SAFE_NO_PAD.encode([7_u8; 32]);
        let nonce = URL_SAFE_NO_PAD.encode([6_u8; 32]);
        assert_eq!(
            issue_sender_nonce(&mut uninitialized, 1, &thumbprint, &nonce, 1, 60, None),
            Err(SenderNonceError::Unavailable)
        );

        let mut connection = Connection::open_in_memory().unwrap();
        initialize_sender_proof_replay_after_hosted_preflight(&connection).unwrap();
        issue_sender_nonce(&mut connection, 1, &thumbprint, &nonce, 1, 60, Some(1)).unwrap();
        assert_eq!(
            issue_sender_nonce(
                &mut connection,
                1,
                &URL_SAFE_NO_PAD.encode([8_u8; 32]),
                &URL_SAFE_NO_PAD.encode([9_u8; 32]),
                1,
                60,
                Some(1),
            ),
            Err(SenderNonceError::Capacity)
        );
        assert_eq!(
            read_sender_nonce(&connection, 1, &thumbprint, 60).unwrap(),
            None
        );
    }

    #[test]
    fn pre_body_admission_challenges_then_accepts_and_rotates() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE _auth_sessions (
                    id TEXT PRIMARY KEY,
                    token_hash BLOB NOT NULL,
                    revoked_at_ms INTEGER
                 ) STRICT;",
            )
            .unwrap();
        initialize_sender_proof_replay_after_hosted_preflight(&connection).unwrap();
        let bearer = SessionBearer::generate_sender_v2(&OsRandom).unwrap();
        let token_hash = bearer.token_hash();
        connection
            .execute(
                "INSERT INTO _auth_sessions(id, token_hash, revoked_at_ms)
                 VALUES ('session-2', ?1, NULL)",
                params![token_hash.as_bytes()],
            )
            .unwrap();
        let key = proof_key();
        let transaction = connection.transaction().unwrap();
        bind_issued_session_sender_constraint(&transaction, "session-2", &key.thumbprint).unwrap();
        transaction.commit().unwrap();

        let challenge = admit_sender_constrained_request(
            &mut connection,
            11,
            "POST",
            "https://app.example.test/query",
            bearer.expose_secret(),
            None,
            1_000,
            60,
            true,
            None,
            None,
            None,
        )
        .unwrap_err();
        assert_eq!(challenge.kind, SenderAdmissionRejectionKind::Required);
        let nonce = challenge
            .challenge()
            .expect("fresh challenge")
            .expose_for_transport()
            .to_owned();
        assert!(!format!("{challenge:?}").contains(&nonce));
        let repeated = admit_sender_constrained_request(
            &mut connection,
            11,
            "POST",
            "https://app.example.test/query",
            bearer.expose_secret(),
            None,
            1_000,
            60,
            true,
            None,
            None,
            None,
        )
        .unwrap_err();
        assert_eq!(repeated.kind, SenderAdmissionRejectionKind::Required);
        assert_eq!(
            repeated
                .challenge()
                .expect("same live challenge")
                .expose_for_transport(),
            nonce,
        );
        assert_eq!(
            read_sender_nonce(&connection, 11, &key.thumbprint, 1_000)
                .unwrap()
                .unwrap()
                .generation,
            1,
            "an unauthenticated challenge cannot advance a live generation",
        );
        let wrong_nonce_proof = sign_proof(
            &key,
            bearer.expose_secret(),
            &URL_SAFE_NO_PAD.encode([77_u8; 32]),
            1_000,
            [11_u8; 16],
        );
        let wrong_nonce = admit_sender_constrained_request(
            &mut connection,
            11,
            "POST",
            "https://app.example.test/query",
            bearer.expose_secret(),
            Some(&wrong_nonce_proof),
            1_000,
            60,
            true,
            None,
            None,
            None,
        )
        .unwrap_err();
        assert_eq!(wrong_nonce.kind, SenderAdmissionRejectionKind::Required);
        assert_eq!(
            wrong_nonce
                .challenge()
                .expect("still-current challenge")
                .expose_for_transport(),
            nonce,
        );
        let proof = sign_proof(&key, bearer.expose_secret(), &nonce, 1_000, [12_u8; 16]);
        let admitted = admit_sender_constrained_request(
            &mut connection,
            11,
            "POST",
            "https://app.example.test/query",
            bearer.expose_secret(),
            Some(&proof),
            1_000,
            60,
            true,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(admitted.verified.proof_id, [12_u8; 16]);
        assert_eq!(admitted.next_nonce_generation(), 2);
        assert_ne!(admitted.next_nonce_for_transport(), nonce);
        assert!(!format!("{admitted:?}").contains(admitted.next_nonce_for_transport()));

        let stale_nonce = admit_sender_constrained_request(
            &mut connection,
            11,
            "POST",
            "https://app.example.test/query",
            bearer.expose_secret(),
            Some(&proof),
            1_000,
            60,
            true,
            None,
            None,
            None,
        )
        .unwrap_err();
        assert_eq!(stale_nonce.kind, SenderAdmissionRejectionKind::Required);
        assert_eq!(
            stale_nonce
                .challenge()
                .expect("current nonce challenge")
                .expose_for_transport(),
            read_sender_nonce(&connection, 11, &key.thumbprint, 1_000)
                .unwrap()
                .unwrap()
                .expose_for_transport()
        );
    }

    // @ref LLP 0077#author-decisions--2026-07-23 — decision 4, verifier half: a
    // live sender-bound family presented in the legacy `sbs_` spelling
    // refuses at proof time without touching nonce state; the proofless path
    // still answers with a challenge so the decision-3 anti-oracle posture is
    // preserved. Migration for pre-change families is deletion-and-re-exchange.
    #[test]
    fn v1_spelling_over_a_live_bound_family_refuses_at_proof_time() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE _auth_sessions (
                    id TEXT PRIMARY KEY,
                    token_hash BLOB NOT NULL,
                    revoked_at_ms INTEGER
                 ) STRICT;",
            )
            .unwrap();
        initialize_sender_proof_replay_after_hosted_preflight(&connection).unwrap();
        let bearer = SessionBearer::generate(&OsRandom).unwrap();
        let token_hash = bearer.token_hash();
        connection
            .execute(
                "INSERT INTO _auth_sessions(id, token_hash, revoked_at_ms)
                 VALUES ('session-v1-bound', ?1, NULL)",
                params![token_hash.as_bytes()],
            )
            .unwrap();
        let key = proof_key();
        let transaction = connection.transaction().unwrap();
        bind_issued_session_sender_constraint(&transaction, "session-v1-bound", &key.thumbprint)
            .unwrap();
        transaction.commit().unwrap();

        // Proofless: a challenge, indistinguishable from any other carrier.
        let challenge = admit_sender_constrained_request(
            &mut connection,
            11,
            "POST",
            "https://app.example.test/query",
            bearer.expose_secret(),
            None,
            1_000,
            60,
            true,
            None,
            None,
            None,
        )
        .unwrap_err();
        assert_eq!(challenge.kind, SenderAdmissionRejectionKind::Required);
        let nonce = challenge
            .challenge()
            .expect("fresh challenge")
            .expose_for_transport()
            .to_owned();

        // A fully valid proof over the current nonce still refuses: the
        // spelling, not the proof, is what is wrong.
        let proof = sign_proof(&key, bearer.expose_secret(), &nonce, 1_000, [21_u8; 16]);
        let refused = admit_sender_constrained_request(
            &mut connection,
            11,
            "POST",
            "https://app.example.test/query",
            bearer.expose_secret(),
            Some(&proof),
            1_000,
            60,
            true,
            None,
            None,
            None,
        )
        .unwrap_err();
        assert_eq!(refused.kind, SenderAdmissionRejectionKind::Invalid);
        assert!(refused.challenge().is_none());
        assert_eq!(
            read_sender_nonce(&connection, 11, &key.thumbprint, 1_000)
                .unwrap()
                .unwrap()
                .generation,
            1,
            "the spelling refusal never consumes or rotates nonce state",
        );
    }

    #[test]
    fn production_admission_refuses_replay_at_final_inclusive_second() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE _auth_sessions (
                    id TEXT PRIMARY KEY,
                    token_hash BLOB NOT NULL,
                    revoked_at_ms INTEGER
                 ) STRICT;",
            )
            .unwrap();
        initialize_sender_proof_replay_after_hosted_preflight(&connection).unwrap();
        let bearer = SessionBearer::generate_sender_v2(&OsRandom).unwrap();
        connection
            .execute(
                "INSERT INTO _auth_sessions(id, token_hash, revoked_at_ms)
                 VALUES ('session-final-second', ?1, NULL)",
                params![bearer.token_hash().as_bytes()],
            )
            .unwrap();
        let key = proof_key();
        let transaction = connection.transaction().unwrap();
        bind_issued_session_sender_constraint(
            &transaction,
            "session-final-second",
            &key.thumbprint,
        )
        .unwrap();
        transaction.commit().unwrap();

        let initial = admit_sender_constrained_request(
            &mut connection,
            7,
            "POST",
            "https://app.example.test/query",
            bearer.expose_secret(),
            None,
            100,
            60,
            true,
            None,
            None,
            None,
        )
        .unwrap_err();
        let first_nonce = initial
            .challenge()
            .expect("initial nonce")
            .expose_for_transport()
            .to_owned();
        let proof_id = [55_u8; 16];
        let first_proof = sign_proof(&key, bearer.expose_secret(), &first_nonce, 105, proof_id);
        let admitted = admit_sender_constrained_request(
            &mut connection,
            7,
            "POST",
            "https://app.example.test/query",
            bearer.expose_secret(),
            Some(&first_proof),
            100,
            60,
            true,
            None,
            None,
            None,
        )
        .unwrap();

        let final_second_replay = sign_proof(
            &key,
            bearer.expose_secret(),
            admitted.next_nonce_for_transport(),
            105,
            proof_id,
        );
        let rejected = admit_sender_constrained_request(
            &mut connection,
            7,
            "POST",
            "https://app.example.test/query",
            bearer.expose_secret(),
            Some(&final_second_replay),
            135,
            60,
            true,
            None,
            None,
            None,
        )
        .unwrap_err();
        assert_eq!(
            rejected.kind,
            SenderAdmissionRejectionKind::Replayed,
            "iat + 30 is still an accepted instant, so its jti remains retained",
        );
    }

    #[test]
    fn invalid_bearer_missing_proof_gets_untracked_opaque_challenge() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_sender_proof_replay_after_hosted_preflight(&connection).unwrap();
        let rejection = admit_sender_constrained_request(
            &mut connection,
            1,
            "GET",
            "https://app.example.test/query",
            "not-a-session-token",
            None,
            1,
            60,
            true,
            None,
            None,
            None,
        )
        .unwrap_err();
        assert_eq!(rejection.kind, SenderAdmissionRejectionKind::Required);
        assert_eq!(
            rejection
                .challenge()
                .expect("opaque challenge")
                .expose_for_transport()
                .len(),
            43
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM _snapback_sender_nonce", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );

        let with_proof = admit_sender_constrained_request(
            &mut connection,
            1,
            "GET",
            "https://app.example.test/query",
            "not-a-session-token",
            Some("unknown.carrier.proof"),
            1,
            60,
            true,
            None,
            None,
            None,
        )
        .unwrap_err();
        assert_eq!(
            with_proof.kind,
            SenderAdmissionRejectionKind::Required,
            "an unknown carrier is folded into the anti-oracle challenge",
        );
        assert_eq!(
            with_proof
                .challenge()
                .expect("cover challenge")
                .expose_for_transport()
                .len(),
            43,
        );
    }

    #[test]
    fn unknown_carrier_cover_nonce_is_keyed_stable_and_never_installed() {
        // @ref LLP 0077#author-decisions--2026-07-23 — decision 3: the cover
        // nonce is deterministic per (epoch, token digest, time bucket), so an
        // unknown carrier observes a stable value exactly like a live bound
        // family observes its installed nonce — no existence oracle — while
        // nothing is ever written for it.
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_sender_proof_replay_after_hosted_preflight(&connection).unwrap();
        let key = SenderCoverNonceKey::from_bytes([9_u8; 32]);
        let mut challenge = |token: &str, proof: Option<&str>, now_seconds: u64| {
            let rejection = admit_sender_constrained_request(
                &mut connection,
                1,
                "GET",
                "https://app.example.test/query",
                token,
                proof,
                now_seconds,
                120,
                true,
                None,
                None,
                Some(&key),
            )
            .unwrap_err();
            assert_eq!(rejection.kind, SenderAdmissionRejectionKind::Required);
            rejection
                .challenge()
                .expect("cover challenge")
                .expose_for_transport()
                .to_owned()
        };
        let first = challenge("not-a-session-token", None, 10);
        assert_eq!(first.len(), 43, "cover nonce has the canonical shape");
        assert_eq!(
            challenge("not-a-session-token", None, 30),
            first,
            "the cover value is stable within one time bucket",
        );
        assert_eq!(
            challenge("not-a-session-token", Some("unknown.carrier.proof"), 30),
            first,
            "a present proof folds into the same stable cover challenge",
        );
        assert_ne!(
            challenge("another-unknown-token", None, 30),
            first,
            "distinct carriers observe independent cover streams",
        );
        assert_ne!(
            challenge("not-a-session-token", None, 130),
            first,
            "the cover value rotates across time buckets",
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM _snapback_sender_nonce", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0,
            "cover nonces are never installed",
        );
    }

    #[test]
    fn sender_replay_epoch_floor_advances_clears_and_never_lowers() {
        // @ref LLP 0077#author-decisions--2026-07-23 — decision 1: a raw
        // backup rollback reverts the durable tables but cannot lower the
        // control-plane floor, so no epoch value under which a proof was
        // accepted can recur.
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_sender_proof_replay_after_hosted_preflight(&connection).unwrap();
        assert_eq!(sender_replay_epoch(&connection).unwrap(), 1);
        connection
            .execute(
                "INSERT INTO _snapback_sender_proof_replay(
                    admission_epoch, proof_id, expires_at_seconds
                 ) VALUES (1, ?1, 1000)",
                params![[7_u8; 16].as_slice()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO _snapback_sender_nonce(
                    admission_epoch, jwk_thumbprint, generation, nonce,
                    expires_at_seconds
                 ) VALUES (1, ?1, 1, ?2, 1000)",
                params!["t".repeat(43), "n".repeat(43)],
            )
            .unwrap();

        // The rolled-back durable state boots against a floor the rollback
        // could not rewind: the epoch advances and both tables clear in one
        // transaction, orphaning every accepted proof and nonce.
        apply_sender_replay_epoch_floor(&mut connection, 3).unwrap();
        assert_eq!(sender_replay_epoch(&connection).unwrap(), 3);
        let count = |connection: &Connection, table: &str| {
            connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap()
        };
        assert_eq!(count(&connection, REPLAY_TABLE), 0);
        assert_eq!(count(&connection, NONCE_TABLE), 0);

        // The floor never lowers the durable counter, and an absent floor is
        // a no-op.
        apply_sender_replay_epoch_floor(&mut connection, 2).unwrap();
        assert_eq!(sender_replay_epoch(&connection).unwrap(), 3);
        apply_sender_replay_epoch_floor(&mut connection, 0).unwrap();
        assert_eq!(sender_replay_epoch(&connection).unwrap(), 3);
    }

    #[test]
    fn sender_replay_epoch_survives_restart_and_rotates_only_on_reset() {
        // Ordinary restart/rollout re-runs hosted preflight against the same
        // durable file: the epoch and both tables must be preserved (no
        // per-rollout resync storm), while the stream-reset transaction is
        // the one place the namespace rotates and the tables clear.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sender-epoch.sqlite");
        {
            let connection = Connection::open(&path).unwrap();
            initialize_sender_proof_replay_after_hosted_preflight(&connection).unwrap();
            connection
                .execute(
                    "INSERT INTO _snapback_sender_proof_replay(
                        admission_epoch, proof_id, expires_at_seconds
                     ) VALUES (1, ?1, 1000)",
                    params![[8_u8; 16].as_slice()],
                )
                .unwrap();
        }
        let mut connection = Connection::open(&path).unwrap();
        initialize_sender_proof_replay_after_hosted_preflight(&connection).unwrap();
        assert_eq!(
            sender_replay_epoch(&connection).unwrap(),
            1,
            "restart preserves the durable namespace",
        );
        assert_eq!(
            connection
                .query_row(&format!("SELECT COUNT(*) FROM {REPLAY_TABLE}"), [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            1,
            "restart preserves retained replay ids",
        );

        let transaction = connection.transaction().unwrap();
        rotate_sender_replay_epoch_for_stream_reset(&transaction).unwrap();
        transaction.commit().unwrap();
        assert_eq!(sender_replay_epoch(&connection).unwrap(), 2);
        assert_eq!(
            connection
                .query_row(&format!("SELECT COUNT(*) FROM {REPLAY_TABLE}"), [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0,
            "reset clears the replay space with the epoch advance",
        );
    }

    #[test]
    fn logout_tombstone_delivers_terminal_outcome_without_touching_nonce_state() {
        // @ref LLP 0077#issuance-refresh-and-recovery — decision 2: a
        // committed logout whose response was lost resolves against the
        // bounded revoked-family tombstone by thumbprint, receives the
        // terminal durableDelete outcome, and consumes its proof id without
        // rotating or freshly generating a nonce; anything less than a valid
        // proof stays behind the anti-oracle cover challenge.
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE _auth_sessions (
                    id TEXT PRIMARY KEY,
                    token_hash BLOB NOT NULL,
                    generation INTEGER NOT NULL,
                    revoked_at_ms INTEGER
                 ) STRICT;
                 CREATE TABLE _auth_session_tokens (
                    token_hash BLOB PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES _auth_sessions(id),
                    superseded_at_ms INTEGER NOT NULL
                 ) STRICT;
                 CREATE TABLE _snapback_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                 ) STRICT;",
            )
            .unwrap();
        initialize_sender_proof_replay_after_hosted_preflight(&connection).unwrap();
        // Deliberately the legacy `sbs_` spelling: a pre-change client
        // stranded by a lost logout response must still converge through the
        // tombstone (the decision-4 spelling refusal applies only to live
        // bound families, never to the revoked-family terminal outcome).
        let bearer = SessionBearer::generate(&OsRandom).unwrap();
        let revoked_at_ms: u64 = 900_000;
        let now_seconds: u64 = 1_000;
        let session_id = uuid::Uuid::now_v7().hyphenated().to_string();
        connection
            .execute(
                "INSERT INTO _auth_sessions(id, token_hash, generation, revoked_at_ms)
                 VALUES (?3, ?1, 4, ?2)",
                params![
                    bearer.token_hash().as_bytes(),
                    revoked_at_ms as i64,
                    session_id
                ],
            )
            .unwrap();
        let key = proof_key();
        let transaction = connection.transaction().unwrap();
        bind_issued_session_sender_constraint(&transaction, &session_id, &key.thumbprint).unwrap();
        crate::storage::auth::write_session_terminal_cause_in(
            &transaction,
            &session_id,
            4,
            revoked_at_ms,
            crate::contract_types::RevocationReason::Logout,
        )
        .unwrap();
        transaction.commit().unwrap();
        let cover = SenderCoverNonceKey::from_bytes([5_u8; 32]);
        let nonce_rows = |connection: &Connection| {
            connection
                .query_row(&format!("SELECT COUNT(*) FROM {NONCE_TABLE}"), [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap()
        };

        // Missing proof: the tombstone stays private behind the cover
        // challenge and no nonce state appears.
        let unproven = admit_sender_constrained_request(
            &mut connection,
            1,
            "POST",
            "https://app.example.test/query",
            bearer.expose_secret(),
            None,
            now_seconds,
            120,
            true,
            None,
            None,
            Some(&cover),
        )
        .unwrap_err();
        assert_eq!(unproven.kind, SenderAdmissionRejectionKind::Required);
        assert!(unproven.challenge().is_some());
        assert_eq!(nonce_rows(&connection), 0);

        // A wrong-key proof is indistinguishable from an unknown carrier.
        let stranger = proof_key();
        let wrong_key = sign_proof(
            &stranger,
            bearer.expose_secret(),
            &"n".repeat(43),
            now_seconds,
            [41_u8; 16],
        );
        let wrong = admit_sender_constrained_request(
            &mut connection,
            1,
            "POST",
            "https://app.example.test/query",
            bearer.expose_secret(),
            Some(&wrong_key),
            now_seconds,
            120,
            true,
            None,
            None,
            Some(&cover),
        )
        .unwrap_err();
        assert_eq!(wrong.kind, SenderAdmissionRejectionKind::Required);

        // The bound key's valid proof (nonce necessarily stale/arbitrary)
        // receives the terminal outcome and consumes its jti.
        let proof = sign_proof(
            &key,
            bearer.expose_secret(),
            &"m".repeat(43),
            now_seconds,
            [42_u8; 16],
        );
        let terminal = admit_sender_constrained_request(
            &mut connection,
            1,
            "POST",
            "https://app.example.test/query",
            bearer.expose_secret(),
            Some(&proof),
            now_seconds,
            120,
            true,
            None,
            None,
            Some(&cover),
        )
        .unwrap_err();
        assert_eq!(
            terminal.kind,
            SenderAdmissionRejectionKind::TerminalDurableDelete,
        );
        assert!(terminal.challenge().is_none(), "no nonce accompanies it");
        assert_eq!(
            nonce_rows(&connection),
            0,
            "tombstones never touch nonce state"
        );

        // The consumed proof id refuses replay.
        let replayed = admit_sender_constrained_request(
            &mut connection,
            1,
            "POST",
            "https://app.example.test/query",
            bearer.expose_secret(),
            Some(&proof),
            now_seconds,
            120,
            true,
            None,
            None,
            Some(&cover),
        )
        .unwrap_err();
        assert_eq!(replayed.kind, SenderAdmissionRejectionKind::Replayed);

        // A carrier-class ending (expiry/eviction) is not a deletion fact:
        // rewrite the witness and the same valid proof stays behind the
        // cover challenge.
        let transaction = connection.transaction().unwrap();
        transaction
            .execute("DELETE FROM _snapback_meta", [])
            .unwrap();
        crate::storage::auth::write_session_terminal_cause_in(
            &transaction,
            &session_id,
            4,
            revoked_at_ms,
            crate::contract_types::RevocationReason::CapEviction,
        )
        .unwrap();
        transaction.commit().unwrap();
        let carrier_proof = sign_proof(
            &key,
            bearer.expose_secret(),
            &"m".repeat(43),
            now_seconds,
            [43_u8; 16],
        );
        let carrier = admit_sender_constrained_request(
            &mut connection,
            1,
            "POST",
            "https://app.example.test/query",
            bearer.expose_secret(),
            Some(&carrier_proof),
            now_seconds,
            120,
            true,
            None,
            None,
            Some(&cover),
        )
        .unwrap_err();
        assert_eq!(carrier.kind, SenderAdmissionRejectionKind::Required);

        // Past the tombstone horizon the family resolves to nothing at all.
        connection
            .execute("UPDATE _auth_sessions SET revoked_at_ms = 0", [])
            .unwrap();
        let transaction = connection.transaction().unwrap();
        transaction
            .execute("DELETE FROM _snapback_meta", [])
            .unwrap();
        crate::storage::auth::write_session_terminal_cause_in(
            &transaction,
            &session_id,
            4,
            0,
            crate::contract_types::RevocationReason::Logout,
        )
        .unwrap();
        transaction.commit().unwrap();
        let expired_now_seconds = SENDER_TOMBSTONE_RETENTION_MS / 1_000 + 10;
        let late_proof = sign_proof(
            &key,
            bearer.expose_secret(),
            &"m".repeat(43),
            expired_now_seconds,
            [44_u8; 16],
        );
        let late = admit_sender_constrained_request(
            &mut connection,
            1,
            "POST",
            "https://app.example.test/query",
            bearer.expose_secret(),
            Some(&late_proof),
            expired_now_seconds,
            120,
            true,
            None,
            None,
            Some(&cover),
        )
        .unwrap_err();
        assert_eq!(
            late.kind,
            SenderAdmissionRejectionKind::Required,
            "a long-offline client lands in ordinary re-authentication",
        );
    }

    #[test]
    fn session_binding_is_issuance_atomic_and_v1_has_no_upgrade_api() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE _auth_sessions (
                    id TEXT PRIMARY KEY,
                    token_hash BLOB NOT NULL,
                    revoked_at_ms INTEGER
                 ) STRICT;
                 CREATE TABLE _auth_session_tokens (
                    token_hash BLOB PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES _auth_sessions(id),
                    superseded_at_ms INTEGER NOT NULL
                 ) STRICT;
                 INSERT INTO _auth_sessions(id, token_hash, revoked_at_ms)
                 VALUES ('session-1', zeroblob(32), NULL);",
            )
            .unwrap();
        initialize_sender_proof_replay_after_hosted_preflight(&connection).unwrap();
        assert_eq!(
            sender_constraint_for_presented_token(&connection, &[0; 32], 100_000, true).unwrap(),
            None
        );
        let thumbprint = URL_SAFE_NO_PAD.encode([9_u8; 32]);
        let commitment = SenderIssuanceCommitment::new(
            VerifiedSenderIssuance {
                proof_id: [8_u8; 16],
                jwk_thumbprint: thumbprint.clone(),
                issued_at_seconds: 100,
            },
            100,
            60,
        )
        .unwrap();
        let transaction = connection.transaction().unwrap();
        transaction
            .execute(
                "INSERT INTO _auth_sessions(id, token_hash, revoked_at_ms)
                 VALUES ('session-2', ?1, NULL)",
                params![vec![1_u8; 32]],
            )
            .unwrap();
        commitment.install(&transaction, "session-2").unwrap();
        transaction.commit().unwrap();
        assert_eq!(
            sender_constraint_for_presented_token(&connection, &[0; 32], 100_000, true).unwrap(),
            None,
            "the extant v1 family remains unbound",
        );
        assert_eq!(
            sender_constraint_for_presented_token(&connection, &[1; 32], 100_000, true).unwrap(),
            Some(thumbprint),
            "the new v2 family is bound only by its issuance commitment",
        );
    }

    #[test]
    fn sender_binding_lookup_honors_finite_grace_but_connection_open_is_current_only() {
        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE _auth_sessions (
                    id TEXT PRIMARY KEY,
                    token_hash BLOB NOT NULL,
                    revoked_at_ms INTEGER
                 ) STRICT;
                 CREATE TABLE _auth_session_tokens (
                    token_hash BLOB PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES _auth_sessions(id),
                    superseded_at_ms INTEGER NOT NULL
                 ) STRICT;",
            )
            .unwrap();
        initialize_sender_proof_replay_after_hosted_preflight(&connection).unwrap();
        let predecessor = [3_u8; 32];
        let successor = [4_u8; 32];
        connection
            .execute(
                "INSERT INTO _auth_sessions(id, token_hash, revoked_at_ms)
                 VALUES ('session-grace', ?1, NULL)",
                params![predecessor.as_slice()],
            )
            .unwrap();
        let thumbprint = URL_SAFE_NO_PAD.encode([10_u8; 32]);
        let transaction = connection.transaction().unwrap();
        bind_issued_session_sender_constraint(&transaction, "session-grace", &thumbprint).unwrap();
        transaction.commit().unwrap();
        connection
            .execute(
                "UPDATE _auth_sessions SET token_hash = ?1 WHERE id = 'session-grace'",
                params![successor.as_slice()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO _auth_session_tokens(token_hash, session_id, superseded_at_ms)
                 VALUES (?1, 'session-grace', 1000)",
                params![predecessor.as_slice()],
            )
            .unwrap();

        assert_eq!(
            sender_constraint_for_presented_token(
                &connection,
                predecessor.as_slice(),
                11_000,
                true,
            )
            .unwrap(),
            Some(thumbprint.clone()),
            "finite requests accept the inclusive ten-second predecessor grace",
        );
        assert_eq!(
            sender_constraint_for_presented_token(
                &connection,
                predecessor.as_slice(),
                11_000,
                false,
            )
            .unwrap(),
            None,
            "connection-open remains current-token-only",
        );
        assert_eq!(
            sender_constraint_for_presented_token(
                &connection,
                predecessor.as_slice(),
                11_001,
                true,
            )
            .unwrap(),
            None,
            "the predecessor is refused immediately after grace",
        );
        assert_eq!(
            sender_constraint_for_presented_token(&connection, successor.as_slice(), 11_001, true,)
                .unwrap(),
            Some(thumbprint.clone()),
        );
        connection
            .execute(
                "UPDATE _auth_sessions SET revoked_at_ms = 11001 WHERE id = 'session-grace'",
                [],
            )
            .unwrap();
        assert_eq!(
            sender_constraint_for_presented_token(&connection, successor.as_slice(), 11_001, true,)
                .unwrap(),
            None,
        );
    }
}
