//! Purpose-separated AEAD envelope for LLP 0135's snapshot-batch cursor.
//!
//! `sbsb1` shares root-key custody with the RQS keyring, but derives a distinct
//! key and AAD domain. It therefore cannot be replayed as `sbbc1` or any other
//! cursor family even when the underlying root and generation are identical.
//!
//! @ref LLP 0135#24-composite-cursor-and-coordinated-resume — prefix, custody,
//!   lifetime, and the exact wire/plaintext ceilings are profile contracts.

#![cfg_attr(not(test), allow(dead_code))] // Consumed by the snapshot-batch runtime lane.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::Sha256;

pub const WIRE_PREFIX: &str = "sbsb1";
pub const MAX_WIRE_BYTES: usize = 8_192;
pub const MAX_PLAINTEXT_BYTES: usize = 6_099;
pub const MAX_AGE_MS: u64 = 14 * 24 * 60 * 60 * 1_000;
const FORMAT_VERSION: u32 = 1;
const PURPOSE: &[u8] = b"snapback:snapshot-batch-cursor:xchacha20:v1";

/// The closed cryptographic envelope around a caller-owned typed state.
///
/// LLP 0135 fixes what the eventual snapshot-batch state must bind, but does
/// not pin the JSON member spelling for its parent-binding and node-boundary
/// records. Keeping that state typed and generic lets the runtime slice supply
/// its eventual `deny_unknown_fields` record without this isolated codec
/// inventing a competing schema. The serialized `Body<State>` is the protected
/// plaintext and is counted in full against [`MAX_PLAINTEXT_BYTES`].
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Body<State> {
    pub format_version: u32,
    pub key_generation: String,
    pub app_id: String,
    pub database_id: String,
    pub target_profile_id: String,
    pub issued_at: u64,
    pub expires_at: u64,
    pub state: State,
}

impl<State> Body<State> {
    pub fn new(
        key_generation: String,
        app_id: String,
        database_id: String,
        target_profile_id: String,
        state: State,
        issued_at: u64,
    ) -> Self {
        Self {
            format_version: FORMAT_VERSION,
            key_generation,
            app_id,
            database_id,
            target_profile_id,
            issued_at,
            expires_at: issued_at.saturating_add(MAX_AGE_MS),
            state,
        }
    }
}

fn associated_data(app_id: &str, database_id: &str, target_profile_id: &str) -> Vec<u8> {
    let mut out = PURPOSE.to_vec();
    for value in [
        app_id.as_bytes(),
        database_id.as_bytes(),
        target_profile_id.as_bytes(),
    ] {
        out.extend_from_slice(&(value.len() as u32).to_be_bytes());
        out.extend_from_slice(value);
    }
    out
}

fn derive_key(root: &[u8; 32], key_generation: &str) -> Option<[u8; 32]> {
    let hkdf = Hkdf::<Sha256>::new(Some(PURPOSE), root.as_slice());
    let mut key = [0_u8; 32];
    hkdf.expand(key_generation.as_bytes(), &mut key).ok()?;
    Some(key)
}

fn has_valid_lifetime<State>(body: &Body<State>) -> bool {
    body.expires_at.saturating_sub(body.issued_at) == MAX_AGE_MS
}

pub fn mint<State: Serialize>(root: &[u8; 32], body: &Body<State>) -> Result<String, &'static str> {
    let mut nonce = [0_u8; 24];
    getrandom::fill(&mut nonce).map_err(|_| "random")?;
    mint_with_nonce(root, body, nonce)
}

fn mint_with_nonce<State: Serialize>(
    root: &[u8; 32],
    body: &Body<State>,
    nonce: [u8; 24],
) -> Result<String, &'static str> {
    if body.format_version != FORMAT_VERSION || !has_valid_lifetime(body) {
        return Err("invalid");
    }
    let key = derive_key(root, &body.key_generation).ok_or("derive")?;
    let plaintext = serde_json::to_vec(body).map_err(|_| "serialize")?;
    if plaintext.len() > MAX_PLAINTEXT_BYTES {
        return Err("oversize");
    }
    let cipher = XChaCha20Poly1305::new((&key).into());
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: &associated_data(&body.app_id, &body.database_id, &body.target_profile_id),
            },
        )
        .map_err(|_| "encrypt")?;
    let mut payload = nonce.to_vec();
    payload.extend_from_slice(&ciphertext);
    let wire = format!("{WIRE_PREFIX}.{}", URL_SAFE_NO_PAD.encode(payload));
    (wire.len() <= MAX_WIRE_BYTES)
        .then_some(wire)
        .ok_or("oversize")
}

pub fn decode<State: DeserializeOwned>(
    wire: &str,
    roots: &[(String, [u8; 32])],
    app_id: &str,
    database_id: &str,
    target_profile_id: &str,
    now_ms: u64,
) -> Result<Body<State>, &'static str> {
    if wire.len() > MAX_WIRE_BYTES {
        return Err("invalid");
    }
    let encoded = wire
        .strip_prefix(&format!("{WIRE_PREFIX}."))
        .ok_or("invalid")?;
    let payload = URL_SAFE_NO_PAD.decode(encoded).map_err(|_| "invalid")?;
    if payload.len() < 24 + 16 {
        return Err("invalid");
    }
    let (nonce, ciphertext) = payload.split_at(24);
    for (generation, root) in roots {
        let Some(key) = derive_key(root, generation) else {
            continue;
        };
        let cipher = XChaCha20Poly1305::new((&key).into());
        let Ok(plaintext) = cipher.decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: &associated_data(app_id, database_id, target_profile_id),
            },
        ) else {
            continue;
        };
        if plaintext.len() > MAX_PLAINTEXT_BYTES {
            continue;
        }
        let Ok(body) = serde_json::from_slice::<Body<State>>(&plaintext) else {
            continue;
        };
        if body.format_version != FORMAT_VERSION
            || body.key_generation != *generation
            || body.app_id != app_id
            || body.database_id != database_id
            || body.target_profile_id != target_profile_id
            || body.issued_at > now_ms
            || body.expires_at < now_ms
            || !has_valid_lifetime(&body)
        {
            continue;
        }
        return Ok(body);
    }
    Err("invalid")
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

    #[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct FixtureParent {
        argument: String,
        parent_id: String,
        incarnation: String,
        version: u64,
    }

    #[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct FixtureNode {
        terminal: bool,
        boundary: Vec<Value>,
        row_id: Option<String>,
    }

    #[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct FixtureState {
        function: String,
        plan_hash: String,
        parent_bindings: Vec<FixtureParent>,
        node_states: Vec<FixtureNode>,
        authority_partition: String,
    }

    fn fixture_body(generation: &str) -> Body<FixtureState> {
        Body::new(
            generation.to_owned(),
            "app".to_owned(),
            "db".to_owned(),
            "local".to_owned(),
            FixtureState {
                function: "boardView".to_owned(),
                plan_hash: "sha256:batch-plan".to_owned(),
                parent_bindings: vec![FixtureParent {
                    argument: "boardId".to_owned(),
                    parent_id: "board-1".to_owned(),
                    incarnation: "018f4d5a-0000-7000-8000-000000000001".to_owned(),
                    version: 7,
                }],
                node_states: vec![
                    FixtureNode {
                        terminal: false,
                        boundary: vec![Value::from(9), Value::from("todo")],
                        row_id: Some("card-9".to_owned()),
                    },
                    FixtureNode {
                        terminal: true,
                        boundary: Vec::new(),
                        row_id: None,
                    },
                ],
                authority_partition: "authority".to_owned(),
            },
            10_000,
        )
    }

    #[test]
    fn cursor_round_trip_tamper_expiry_and_context_binding() {
        let root = [7_u8; 32];
        let body = fixture_body("generation-1");
        let wire = mint(&root, &body).expect("mint");
        assert!(wire.starts_with("sbsb1."));
        assert!(wire.len() <= MAX_WIRE_BYTES);
        let decoded = decode::<FixtureState>(
            &wire,
            &[("generation-1".to_owned(), root)],
            "app",
            "db",
            "local",
            10_001,
        )
        .expect("decode");
        assert_eq!(decoded, body);

        for (app, database, target) in [
            ("other-app", "db", "local"),
            ("app", "other-db", "local"),
            ("app", "db", "other-target"),
        ] {
            assert!(
                decode::<FixtureState>(
                    &wire,
                    &[("generation-1".to_owned(), root)],
                    app,
                    database,
                    target,
                    10_001,
                )
                .is_err()
            );
        }
        assert!(
            decode::<FixtureState>(
                &wire,
                &[("generation-1".to_owned(), root)],
                "app",
                "db",
                "local",
                body.issued_at - 1,
            )
            .is_err()
        );
        assert!(
            decode::<FixtureState>(
                &wire,
                &[("generation-1".to_owned(), root)],
                "app",
                "db",
                "local",
                body.expires_at,
            )
            .is_ok()
        );
        assert!(
            decode::<FixtureState>(
                &wire,
                &[("generation-1".to_owned(), root)],
                "app",
                "db",
                "local",
                body.expires_at + 1,
            )
            .is_err()
        );

        let mut tampered = wire.into_bytes();
        let index = tampered.len() / 2;
        tampered[index] = if tampered[index] == b'A' { b'B' } else { b'A' };
        let tampered = String::from_utf8(tampered).expect("ascii wire");
        assert!(
            decode::<FixtureState>(
                &tampered,
                &[("generation-1".to_owned(), root)],
                "app",
                "db",
                "local",
                10_001,
            )
            .is_err()
        );
    }

    #[test]
    fn plaintext_and_wire_limits_are_exact() {
        let root = [11_u8; 32];
        let mut body = Body::new(
            "generation-limit".to_owned(),
            "app".to_owned(),
            "db".to_owned(),
            "local".to_owned(),
            String::new(),
            20_000,
        );
        let empty_len = serde_json::to_vec(&body).expect("serialize empty").len();
        body.state = "x".repeat(MAX_PLAINTEXT_BYTES - empty_len);
        assert_eq!(
            serde_json::to_vec(&body).expect("serialize max").len(),
            MAX_PLAINTEXT_BYTES
        );
        let wire = mint_with_nonce(&root, &body, [3_u8; 24]).expect("mint exact maximum");
        assert_eq!(wire.len(), MAX_WIRE_BYTES);
        assert!(
            decode::<String>(
                &wire,
                &[("generation-limit".to_owned(), root)],
                "app",
                "db",
                "local",
                20_001,
            )
            .is_ok()
        );

        body.state.push('x');
        assert_eq!(
            serde_json::to_vec(&body).expect("serialize oversize").len(),
            MAX_PLAINTEXT_BYTES + 1
        );
        assert_eq!(mint_with_nonce(&root, &body, [3_u8; 24]), Err("oversize"));
        assert!(
            decode::<String>(
                &format!("{wire}x"),
                &[("generation-limit".to_owned(), root)],
                "app",
                "db",
                "local",
                20_001,
            )
            .is_err()
        );
    }

    #[test]
    fn sbsb1_and_sbbc1_cross_decoders_refuse_even_after_prefix_rewrite() {
        let root = [13_u8; 32];
        let composite = mint_with_nonce(&root, &fixture_body("generation-cross"), [5_u8; 24])
            .expect("mint composite");
        let standalone_body = crate::bounded_children_cursor::Body::new(
            "generation-cross".to_owned(),
            "app".to_owned(),
            "db".to_owned(),
            "local".to_owned(),
            "stream".to_owned(),
            "boardCards".to_owned(),
            "sha256:node-plan".to_owned(),
            "board-1".to_owned(),
            "018f4d5a-0000-7000-8000-000000000001".to_owned(),
            7,
            "authority".to_owned(),
            vec!["position".to_owned()],
            vec![Value::from(9)],
            "card-9".to_owned(),
            10_000,
        );
        let standalone =
            crate::bounded_children_cursor::mint(&root, &standalone_body).expect("mint standalone");

        assert!(
            decode::<FixtureState>(
                &standalone,
                &[("generation-cross".to_owned(), root)],
                "app",
                "db",
                "local",
                10_001,
            )
            .is_err()
        );
        assert!(
            crate::bounded_children_cursor::decode(
                &composite,
                &[("generation-cross".to_owned(), root)],
                "app",
                "db",
                "local",
                10_001,
            )
            .is_err()
        );

        let standalone_with_composite_prefix = format!(
            "{WIRE_PREFIX}.{}",
            standalone
                .strip_prefix("sbbc1.")
                .expect("standalone prefix")
        );
        assert!(
            decode::<FixtureState>(
                &standalone_with_composite_prefix,
                &[("generation-cross".to_owned(), root)],
                "app",
                "db",
                "local",
                10_001,
            )
            .is_err(),
            "distinct HKDF/AAD purpose must refuse after a prefix rewrite"
        );
        let composite_with_standalone_prefix = format!(
            "sbbc1.{}",
            composite
                .strip_prefix(&format!("{WIRE_PREFIX}."))
                .expect("composite prefix")
        );
        assert!(
            crate::bounded_children_cursor::decode(
                &composite_with_standalone_prefix,
                &[("generation-cross".to_owned(), root)],
                "app",
                "db",
                "local",
                10_001,
            )
            .is_err(),
            "distinct HKDF/AAD purpose must refuse after a prefix rewrite"
        );
    }

    #[test]
    fn fixed_nonce_golden_vector() {
        let root = [
            0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d,
            0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b,
            0x1c, 0x1d, 0x1e, 0x1f,
        ];
        let nonce = [
            0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xab, 0xac, 0xad,
            0xae, 0xaf, 0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7,
        ];
        let body = fixture_body("generation-golden");
        let wire = mint_with_nonce(&root, &body, nonce).expect("fixed mint");
        assert_eq!(
            wire,
            "sbsb1.oKGio6SlpqeoqaqrrK2ur7CxsrO0tba35XWvlyD9VKEB1zcqgSGCKi44r_z4VB9oAz5dIsnqjGSxlXH2XfaoeZpN3yq88scAKS8WlpqWIkxbJGf1ecaV1zgnnuNqwRDgh7WC4jVjEO-cs5A5aXwWe1QNsDcP9ezJQpyN0yypPkfRkQsV_nhmyAjTXxdUbbD4bRlPJ4JPACuQcKMB5k5toEPSo8q52IYsrxPvsOwgmekcsVMLH58i5X53lfX_jHOIgqGglSj4jpS8bUOO_wDbemYyS9bejUStImxF_DHrgbB4TNencSpoE5JWY8Qc1lQ3b3Q0J_VyTmYs8qMC9xpO9YRh1a2597VhN56Im6W1jY7bbNIqGGWZdwwcmCtIpi-xz9bb4tlbfVt6PqsefbTlnPa7BLZ6I5mWCIAzkbQsL_siWJmxhTe9gsJwNy5SgAsDmoCS9RL4_Lxa7HpBpc2tPV-AMGmDGRjd9w2gNnT_biz_pi-miyUbh9MTT3DjsfNtF6rbPJ2_2W-s3KuDTQEe7b_EQGjdOliBR1B5Cs85E8gutEGC4zcRTnCgVhYRAvNczLU1H91ccuyTfm2pxrNAGqr9QEnDj5qrVUz0rwb66j92ZKSEPUcTbAPdCQfJ-qya6ujntWzKJJi2mcODQd2hi0PuABT-cNLfNrbD1I9YdQEdc36NjBawClhwsYwrj5QRSmtecVBownI"
        );
    }
}
