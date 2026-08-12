//! Exact LLP 0157 `sbsb1` snapshot-batch cursor.
//!
//! @ref LLP 0157#d8--coordinated-cursor-family-grammar-and-the-llp-0135-seam —
//!   this module owns the fixed body, compact serialization, purpose-separated
//!   XChaCha20-Poly1305 envelope, and the 8,192/6,099-byte ceilings.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;

pub const WIRE_PREFIX: &str = "sbsb1";
pub const MAX_WIRE_BYTES: usize = 8_192;
pub const MAX_PLAINTEXT_BYTES: usize = 6_099;
pub const MAX_AGE_MS: u64 = 1_209_600_000;
const FORMAT_VERSION: u32 = 1;
const PURPOSE: &[u8] = b"snapback:snapshot-batch-cursor:xchacha20:v1";
const JS_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParentGroup {
    pub group_index: u32,
    pub parent_authorization_key_digest: String,
    pub parent_id: String,
    pub parent_incarnation: String,
    pub parent_version: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum NodeState {
    Terminal,
    Boundary {
        #[serde(rename = "orderFields")]
        order_fields: Vec<String>,
        boundary: Vec<Value>,
        #[serde(rename = "rowId")]
        row_id: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Node {
    pub position: u32,
    pub node_plan_hash: String,
    pub state: NodeState,
}

/// Field declaration order is the normative compact-body order from LLP 0157.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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
    pub args: Value,
    pub parent_groups: Vec<ParentGroup>,
    pub nodes: Vec<Node>,
    pub authority_partition: String,
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
        args: Value,
        parent_groups: Vec<ParentGroup>,
        nodes: Vec<Node>,
        authority_partition: String,
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
            args,
            parent_groups,
            nodes,
            authority_partition,
            issued_at,
            expires_at: issued_at.saturating_add(MAX_AGE_MS),
        }
    }
}

fn associated_data(app_id: &str, database_id: &str, target_profile_id: &str) -> Vec<u8> {
    let mut out = PURPOSE.to_vec();
    for value in [app_id, database_id, target_profile_id] {
        out.extend_from_slice(&(value.len() as u32).to_be_bytes());
        out.extend_from_slice(value.as_bytes());
    }
    out
}

fn derive_key(root: &[u8; 32], key_generation: &str) -> Option<[u8; 32]> {
    let hkdf = Hkdf::<Sha256>::new(Some(PURPOSE), root);
    let mut key = [0_u8; 32];
    hkdf.expand(key_generation.as_bytes(), &mut key).ok()?;
    Some(key)
}

fn json_string(value: &str) -> Result<String, &'static str> {
    serde_json::to_string(value).map_err(|_| "serialize")
}

fn append_member(out: &mut String, name: &str, value: &str, first: &mut bool) {
    if !*first {
        out.push(',');
    }
    *first = false;
    out.push('"');
    out.push_str(name);
    out.push_str("\":");
    out.push_str(value);
}

/// Serialize exactly in the member order fixed by LLP 0157 while applying JCS
/// to embedded client values and boundary scalars.
pub fn compact_plaintext(body: &Body) -> Result<Vec<u8>, &'static str> {
    let mut out = String::from("{");
    let mut first = true;
    append_member(
        &mut out,
        "formatVersion",
        &body.format_version.to_string(),
        &mut first,
    );
    append_member(
        &mut out,
        "keyGeneration",
        &json_string(&body.key_generation)?,
        &mut first,
    );
    append_member(&mut out, "appId", &json_string(&body.app_id)?, &mut first);
    append_member(
        &mut out,
        "databaseId",
        &json_string(&body.database_id)?,
        &mut first,
    );
    append_member(
        &mut out,
        "targetProfileId",
        &json_string(&body.target_profile_id)?,
        &mut first,
    );
    append_member(
        &mut out,
        "streamEpoch",
        &json_string(&body.stream_epoch)?,
        &mut first,
    );
    append_member(
        &mut out,
        "function",
        &json_string(&body.function)?,
        &mut first,
    );
    append_member(
        &mut out,
        "planHash",
        &json_string(&body.plan_hash)?,
        &mut first,
    );
    append_member(
        &mut out,
        "args",
        &crate::rqs_contract::jcs(&body.args).map_err(|_| "serialize")?,
        &mut first,
    );

    let mut groups = String::from("[");
    for (index, group) in body.parent_groups.iter().enumerate() {
        if index != 0 {
            groups.push(',');
        }
        groups.push('{');
        let mut member = true;
        append_member(
            &mut groups,
            "groupIndex",
            &group.group_index.to_string(),
            &mut member,
        );
        append_member(
            &mut groups,
            "parentAuthorizationKeyDigest",
            &json_string(&group.parent_authorization_key_digest)?,
            &mut member,
        );
        append_member(
            &mut groups,
            "parentId",
            &json_string(&group.parent_id)?,
            &mut member,
        );
        append_member(
            &mut groups,
            "parentIncarnation",
            &json_string(&group.parent_incarnation)?,
            &mut member,
        );
        append_member(
            &mut groups,
            "parentVersion",
            &group.parent_version.to_string(),
            &mut member,
        );
        groups.push('}');
    }
    groups.push(']');
    append_member(&mut out, "parentGroups", &groups, &mut first);

    let mut nodes = String::from("[");
    for (index, node) in body.nodes.iter().enumerate() {
        if index != 0 {
            nodes.push(',');
        }
        nodes.push('{');
        let mut member = true;
        append_member(
            &mut nodes,
            "position",
            &node.position.to_string(),
            &mut member,
        );
        append_member(
            &mut nodes,
            "nodePlanHash",
            &json_string(&node.node_plan_hash)?,
            &mut member,
        );
        let state = match &node.state {
            NodeState::Terminal => "{\"kind\":\"terminal\"}".to_owned(),
            NodeState::Boundary {
                order_fields,
                boundary,
                row_id,
            } => {
                let order_fields =
                    Value::Array(order_fields.iter().cloned().map(Value::String).collect());
                let boundary = Value::Array(boundary.clone());
                format!(
                    "{{\"kind\":\"boundary\",\"orderFields\":{},\"boundary\":{},\"rowId\":{}}}",
                    crate::rqs_contract::jcs(&order_fields).map_err(|_| "serialize")?,
                    crate::rqs_contract::jcs(&boundary).map_err(|_| "serialize")?,
                    json_string(row_id)?,
                )
            }
        };
        append_member(&mut nodes, "state", &state, &mut member);
        nodes.push('}');
    }
    nodes.push(']');
    append_member(&mut out, "nodes", &nodes, &mut first);
    append_member(
        &mut out,
        "authorityPartition",
        &json_string(&body.authority_partition)?,
        &mut first,
    );
    append_member(
        &mut out,
        "issuedAt",
        &body.issued_at.to_string(),
        &mut first,
    );
    append_member(
        &mut out,
        "expiresAt",
        &body.expires_at.to_string(),
        &mut first,
    );
    out.push('}');
    Ok(out.into_bytes())
}

fn valid_body_numbers(body: &Body) -> bool {
    body.issued_at <= JS_SAFE_INTEGER
        && body.expires_at <= JS_SAFE_INTEGER
        && body.expires_at.checked_sub(body.issued_at) == Some(MAX_AGE_MS)
        && body
            .parent_groups
            .iter()
            .all(|group| group.parent_version <= JS_SAFE_INTEGER)
}

pub fn mint(root: &[u8; 32], body: &Body) -> Result<String, &'static str> {
    let mut nonce = [0_u8; 24];
    getrandom::fill(&mut nonce).map_err(|_| "random")?;
    mint_with_nonce(root, body, nonce)
}

fn mint_with_nonce(root: &[u8; 32], body: &Body, nonce: [u8; 24]) -> Result<String, &'static str> {
    if body.format_version != FORMAT_VERSION || !valid_body_numbers(body) {
        return Err("invalid");
    }
    let plaintext = compact_plaintext(body)?;
    if plaintext.len() > MAX_PLAINTEXT_BYTES {
        return Err("oversize");
    }
    let key = derive_key(root, &body.key_generation).ok_or("derive")?;
    let ciphertext = XChaCha20Poly1305::new((&key).into())
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: &associated_data(&body.app_id, &body.database_id, &body.target_profile_id),
            },
        )
        .map_err(|_| "encrypt")?;
    let mut payload = nonce.to_vec();
    payload.extend(ciphertext);
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
    let encoded = wire.strip_prefix("sbsb1.").ok_or("invalid")?;
    let payload = URL_SAFE_NO_PAD.decode(encoded).map_err(|_| "invalid")?;
    if payload.len() < 40 {
        return Err("invalid");
    }
    let (nonce, ciphertext) = payload.split_at(24);
    for (generation, root) in roots {
        let Some(key) = derive_key(root, generation) else {
            continue;
        };
        let Ok(plaintext) = XChaCha20Poly1305::new((&key).into()).decrypt(
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
            || !valid_body_numbers(&body)
            || compact_plaintext(&body).ok().as_deref() != Some(plaintext.as_slice())
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
    use serde_json::json;

    fn body() -> Body {
        Body::new(
            "generation-1".into(),
            "app".into(),
            "db".into(),
            "local".into(),
            "stream".into(),
            "boardView".into(),
            format!("sha256:{}", "a".repeat(64)),
            json!({"boardId":"board-1"}),
            vec![ParentGroup {
                group_index: 0,
                parent_authorization_key_digest: format!("sha256:{}", "b".repeat(64)),
                parent_id: "board-1".into(),
                parent_incarnation: "018f4d5a-0000-7000-8000-000000000001".into(),
                parent_version: 7,
            }],
            vec![
                Node {
                    position: 0,
                    node_plan_hash: format!("sha256:{}", "c".repeat(64)),
                    state: NodeState::Boundary {
                        order_fields: vec!["position".into()],
                        boundary: vec![json!(9)],
                        row_id: "card-9".into(),
                    },
                },
                Node {
                    position: 1,
                    node_plan_hash: format!("sha256:{}", "d".repeat(64)),
                    state: NodeState::Terminal,
                },
            ],
            format!("sha256:{}", "e".repeat(64)),
            10_000,
        )
    }

    #[test]
    fn exact_body_round_trips_and_binds_context() {
        let root = [7; 32];
        let body = body();
        let wire = mint(&root, &body).unwrap();
        assert_eq!(
            decode(
                &wire,
                &[("generation-1".into(), root)],
                "app",
                "db",
                "local",
                10_001
            )
            .unwrap(),
            body
        );
        assert!(
            decode(
                &wire,
                &[("generation-1".into(), root)],
                "other",
                "db",
                "local",
                10_001
            )
            .is_err()
        );
        assert!(
            decode(
                &wire,
                &[("generation-1".into(), root)],
                "app",
                "db",
                "local",
                body.expires_at + 1
            )
            .is_err()
        );
    }

    #[test]
    fn plaintext_and_wire_caps_are_exact() {
        let root = [11; 32];
        let mut body = body();
        body.args = Value::String(String::new());
        let empty_len = compact_plaintext(&body).unwrap().len();
        body.args = Value::String("x".repeat(MAX_PLAINTEXT_BYTES - empty_len));
        assert_eq!(compact_plaintext(&body).unwrap().len(), MAX_PLAINTEXT_BYTES);
        let wire = mint_with_nonce(&root, &body, [3; 24]).expect("exact cap mints");
        assert_eq!(wire.len(), MAX_WIRE_BYTES);
        assert!(
            decode(
                &wire,
                &[("generation-1".into(), root)],
                "app",
                "db",
                "local",
                10_001,
            )
            .is_ok()
        );

        let Value::String(padding) = &mut body.args else {
            unreachable!("padding string")
        };
        padding.push('x');
        assert_eq!(mint_with_nonce(&root, &body, [3; 24]), Err("oversize"));
    }

    #[test]
    fn cross_family_replay_is_refused() {
        let root = [13; 32];
        let composite = mint_with_nonce(&root, &body(), [5; 24]).unwrap();
        assert!(
            crate::bounded_children_cursor::decode(
                &composite,
                &[("generation-1".into(), root)],
                "app",
                "db",
                "local",
                10_001
            )
            .is_err()
        );
        let standalone = crate::bounded_children_cursor::mint(
            &root,
            &crate::bounded_children_cursor::Body::new(
                "generation-1".into(),
                "app".into(),
                "db".into(),
                "local".into(),
                "stream".into(),
                "boardCards".into(),
                format!("sha256:{}", "f".repeat(64)),
                "board-1".into(),
                "018f4d5a-0000-7000-8000-000000000001".into(),
                7,
                format!("sha256:{}", "e".repeat(64)),
                vec!["position".into()],
                vec![json!(9)],
                "card-9".into(),
                10_000,
            ),
        )
        .unwrap();
        assert!(
            decode(
                &standalone,
                &[("generation-1".into(), root)],
                "app",
                "db",
                "local",
                10_001
            )
            .is_err()
        );

        let rewritten_standalone = format!("sbsb1.{}", standalone.strip_prefix("sbbc1.").unwrap(),);
        let rewritten_composite = format!("sbbc1.{}", composite.strip_prefix("sbsb1.").unwrap(),);
        assert!(
            decode(
                &rewritten_standalone,
                &[("generation-1".into(), root)],
                "app",
                "db",
                "local",
                10_001
            )
            .is_err()
        );
        assert!(
            crate::bounded_children_cursor::decode(
                &rewritten_composite,
                &[("generation-1".into(), root)],
                "app",
                "db",
                "local",
                10_001
            )
            .is_err()
        );
    }

    // @ref LLP 0157#sbsb1-plaintext-and-budget — one committed fixed-nonce
    // vector is consumed independently by Rust and Node
    // (tests/conformance/snapshot-batch-sbsb1-parity-v1.mjs), freezing the
    // exact plaintext bytes and the HKDF/AAD/XChaCha20-Poly1305 envelope.
    #[test]
    fn fixed_nonce_golden_vector_and_exact_order() {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct ParityFixture {
            format_version: String,
            root_hex: String,
            nonce_hex: String,
            body: Body,
            expected_plaintext: String,
            expected_wire: String,
        }
        let decode_hex = |value: &str| -> Vec<u8> {
            (0..value.len())
                .step_by(2)
                .map(|index| u8::from_str_radix(&value[index..index + 2], 16).unwrap())
                .collect()
        };
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/snapshot-batch-sbsb1-parity-v1.json");
        let fixture: ParityFixture =
            serde_json::from_slice(&std::fs::read(path).expect("read sbsb1 parity fixture"))
                .expect("parse sbsb1 parity fixture");
        assert_eq!(fixture.format_version, "snapshot-batch-sbsb1-parity-v1");
        let root: [u8; 32] = decode_hex(&fixture.root_hex).try_into().unwrap();
        let nonce: [u8; 24] = decode_hex(&fixture.nonce_hex).try_into().unwrap();
        let plain = String::from_utf8(compact_plaintext(&fixture.body).unwrap()).unwrap();
        assert_eq!(plain, fixture.expected_plaintext);
        let wire = mint_with_nonce(&root, &fixture.body, nonce).unwrap();
        assert_eq!(wire, fixture.expected_wire);
        // The in-module construction stays pinned to the same vector so the
        // fixture cannot drift away from what mint actually produces.
        assert_eq!(compact_plaintext(&body()).unwrap(), plain.as_bytes());
    }
}
