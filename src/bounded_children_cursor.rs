//! AEAD cursor for LLP 0110's bounded-children profile.
//!
//! The credential has a purpose-specific prefix, HKDF key derivation and AAD;
//! it cannot be replayed as an RQS, relational, standard-pattern, or search
//! cursor even though those protocols share root-key custody.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use hkdf::Hkdf;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;

pub const WIRE_PREFIX: &str = "sbbc1";
pub const MAX_WIRE_BYTES: usize = 1_024;
pub const MAX_AGE_MS: u64 = 14 * 24 * 60 * 60 * 1_000;
const FORMAT_VERSION: u32 = 1;
const PURPOSE: &[u8] = b"snapback:bounded-children-cursor:xchacha20:v1";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Body {
    pub format_version: u32,
    pub key_generation: String,
    pub app_id: String,
    pub database_id: String,
    pub target_profile_id: String,
    pub stream_epoch: String,
    pub function: String,
    pub plan_hash: String,
    pub parent_id: String,
    pub parent_incarnation: String,
    pub parent_version: u64,
    pub authority_partition: String,
    pub order_fields: Vec<String>,
    pub boundary: Vec<Value>,
    pub row_id: String,
    pub issued_at: u64,
    pub expires_at: u64,
}

impl Body {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        key_generation: String,
        app_id: String,
        database_id: String,
        target_profile_id: String,
        stream_epoch: String,
        function: String,
        plan_hash: String,
        parent_id: String,
        parent_incarnation: String,
        parent_version: u64,
        authority_partition: String,
        order_fields: Vec<String>,
        boundary: Vec<Value>,
        row_id: String,
        issued_at: u64,
    ) -> Self {
        Self {
            format_version: FORMAT_VERSION,
            key_generation,
            app_id,
            database_id,
            target_profile_id,
            stream_epoch,
            function,
            plan_hash,
            parent_id,
            parent_incarnation,
            parent_version,
            authority_partition,
            order_fields,
            boundary,
            row_id,
            issued_at,
            expires_at: issued_at.saturating_add(MAX_AGE_MS),
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

pub fn mint(root: &[u8; 32], body: &Body) -> Result<String, &'static str> {
    let mut nonce = [0_u8; 24];
    getrandom::fill(&mut nonce).map_err(|_| "random")?;
    mint_with_nonce(root, body, nonce)
}

fn mint_with_nonce(root: &[u8; 32], body: &Body, nonce: [u8; 24]) -> Result<String, &'static str> {
    let key = derive_key(root, &body.key_generation).ok_or("derive")?;
    let cipher = XChaCha20Poly1305::new((&key).into());
    let plaintext = serde_json::to_vec(body).map_err(|_| "serialize")?;
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

pub fn decode(
    wire: &str,
    roots: &[(String, [u8; 32])],
    app_id: &str,
    database_id: &str,
    target_profile_id: &str,
    now_ms: u64,
) -> Result<Body, &'static str> {
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
        let Ok(body) = serde_json::from_slice::<Body>(&plaintext) else {
            continue;
        };
        if body.format_version != FORMAT_VERSION
            || body.key_generation != *generation
            || body.app_id != app_id
            || body.database_id != database_id
            || body.target_profile_id != target_profile_id
            || body.issued_at > now_ms
            || body.expires_at < now_ms
            || body.expires_at.saturating_sub(body.issued_at) != MAX_AGE_MS
        {
            continue;
        }
        return Ok(body);
    }
    Err("invalid")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(generation: &str) -> Body {
        Body::new(
            generation.to_owned(),
            "app".to_owned(),
            "db".to_owned(),
            "local".to_owned(),
            "stream".to_owned(),
            "incidentTasks".to_owned(),
            "sha256:plan".to_owned(),
            "incident-1".to_owned(),
            "018f4d5a-0000-7000-8000-000000000001".to_owned(),
            7,
            "authority".to_owned(),
            vec!["position".to_owned()],
            vec![Value::from(9)],
            "task-9".to_owned(),
            10_000,
        )
    }

    #[test]
    fn cursor_round_trip_tamper_and_purpose_binding() {
        let root = [7_u8; 32];
        let wire = mint(&root, &body("generation-1")).expect("mint");
        assert!(wire.starts_with("sbbc1."));
        assert!(wire.len() <= MAX_WIRE_BYTES);
        let decoded = decode(
            &wire,
            &[("generation-1".to_owned(), root)],
            "app",
            "db",
            "local",
            10_001,
        )
        .expect("decode");
        assert_eq!(decoded.row_id, "task-9");
        assert!(
            decode(
                &wire,
                &[("generation-1".to_owned(), root)],
                "other-app",
                "db",
                "local",
                10_001,
            )
            .is_err()
        );
        let mut tampered = wire.into_bytes();
        let last = tampered.last_mut().expect("wire byte");
        *last = if *last == b'A' { b'B' } else { b'A' };
        let tampered = String::from_utf8(tampered).expect("ascii wire");
        assert!(
            decode(
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

    // @ref LLP 0110#sbbc1-cursor-protocol-and-restart-precedence — one
    // committed fixed-nonce vector is consumed independently by Rust and
    // Node, pinning HKDF, length-framed AAD, struct serialization, XChaCha20-
    // Poly1305 bytes, and the canonical multi-type boundary vocabulary.
    #[test]
    fn cross_language_cursor_golden_vector() {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct CursorVector {
            root_hex: String,
            nonce_hex: String,
            body: Body,
            expected_wire: String,
        }
        #[derive(Deserialize)]
        struct OrderingRow {
            #[serde(rename = "_id")]
            id: String,
            position: i64,
            label: String,
            active: bool,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct OrderingVector {
            rows: Vec<OrderingRow>,
            expected_ids: Vec<String>,
        }
        #[derive(Deserialize)]
        struct Vectors {
            cursor: CursorVector,
            ordering: OrderingVector,
        }
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/conformance/relation-activity-publication-v1.vectors.json");
        let vectors: Vectors =
            serde_json::from_slice(&std::fs::read(path).expect("read cursor vectors"))
                .expect("parse cursor vectors");
        let decode_hex = |value: &str| {
            (0..value.len())
                .step_by(2)
                .map(|offset| u8::from_str_radix(&value[offset..offset + 2], 16).expect("hex byte"))
                .collect::<Vec<_>>()
        };
        let root: [u8; 32] = decode_hex(&vectors.cursor.root_hex)
            .try_into()
            .expect("32-byte root");
        let nonce: [u8; 24] = decode_hex(&vectors.cursor.nonce_hex)
            .try_into()
            .expect("24-byte nonce");
        let wire = mint_with_nonce(&root, &vectors.cursor.body, nonce).expect("fixed mint");
        assert_eq!(wire, vectors.cursor.expected_wire);
        let decoded = decode(
            &wire,
            &[(vectors.cursor.body.key_generation.clone(), root)],
            &vectors.cursor.body.app_id,
            &vectors.cursor.body.database_id,
            &vectors.cursor.body.target_profile_id,
            vectors.cursor.body.issued_at + 1,
        )
        .expect("decode golden");
        assert_eq!(decoded, vectors.cursor.body);

        let mut rows = vectors.ordering.rows;
        rows.sort_by(|left, right| {
            left.position
                .cmp(&right.position)
                .then_with(|| left.label.as_bytes().cmp(right.label.as_bytes()))
                .then_with(|| left.active.cmp(&right.active))
                .then_with(|| left.id.as_bytes().cmp(right.id.as_bytes()))
        });
        assert_eq!(
            rows.into_iter().map(|row| row.id).collect::<Vec<_>>(),
            vectors.ordering.expected_ids
        );
    }
}
