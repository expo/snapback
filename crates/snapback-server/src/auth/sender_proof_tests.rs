pub use snapback_auth::auth::sender_proof::*;

use crate::auth::wire::SenderPublicJwk;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ring::rand::{SecureRandom, SystemRandom};

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
}
