//! Exact LLP 0157 `sbsb2` snapshot-batch cursor.
//!
//! @ref LLP 0157#sbsb2-plaintext-and-budget — this module owns the v2 body,
//!   three-arm node-state union, purpose-separated XChaCha20-Poly1305 envelope,
//!   and the shared 8,192/6,099-byte ceilings without changing `sbsb1`.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;

pub const WIRE_PREFIX: &str = "sbsb2";
pub const MAX_WIRE_BYTES: usize = 8_192;
pub const MAX_PLAINTEXT_BYTES: usize = 6_099;
pub const MAX_AGE_MS: u64 = 1_209_600_000;
pub const FORMAT_VERSION: u32 = 2;
const PURPOSE: &[u8] = b"snapback:snapshot-batch-cursor:xchacha20:v2";
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
    #[serde(rename = "relational-boundary")]
    RelationalBoundary {
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

fn compact_boundary_state(
    kind: &str,
    order_fields: &[String],
    boundary: &[Value],
    row_id: &str,
) -> Result<String, &'static str> {
    let order_fields = Value::Array(order_fields.iter().cloned().map(Value::String).collect());
    let boundary = Value::Array(boundary.to_vec());
    Ok(format!(
        "{{\"kind\":{},\"orderFields\":{},\"boundary\":{},\"rowId\":{}}}",
        json_string(kind)?,
        crate::rqs_contract::jcs(&order_fields).map_err(|_| "serialize")?,
        crate::rqs_contract::jcs(&boundary).map_err(|_| "serialize")?,
        json_string(row_id)?,
    ))
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
            } => compact_boundary_state("boundary", order_fields, boundary, row_id)?,
            NodeState::RelationalBoundary {
                order_fields,
                boundary,
                row_id,
            } => compact_boundary_state("relational-boundary", order_fields, boundary, row_id)?,
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

#[doc(hidden)]
pub fn mint_with_nonce(
    root: &[u8; 32],
    body: &Body,
    nonce: [u8; 24],
) -> Result<String, &'static str> {
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
    let encoded = wire.strip_prefix("sbsb2.").ok_or("invalid")?;
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
            // Exact reserialization rejects alternate member order or number
            // spellings even when serde could otherwise decode the value.
            || compact_plaintext(&body).ok().as_deref() != Some(plaintext.as_slice())
        {
            continue;
        }
        return Ok(body);
    }
    Err("invalid")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn fixed_nonce(seed: u8) -> [u8; 24] {
    std::array::from_fn(|index| seed.wrapping_add(index as u8))
}

fn parity_vector(
    id: &str,
    root: &[u8; 32],
    nonce: [u8; 24],
    body: &Body,
    presentation: Option<Value>,
    expected_outcome: Option<&str>,
) -> Result<Value, &'static str> {
    let plaintext = String::from_utf8(compact_plaintext(body)?).map_err(|_| "serialize")?;
    let wire = mint_with_nonce(root, body, nonce)?;
    let mut record = serde_json::Map::from_iter([
        ("id".to_owned(), Value::String(id.to_owned())),
        ("rootHex".to_owned(), Value::String(hex(root))),
        ("nonceHex".to_owned(), Value::String(hex(&nonce))),
        (
            "body".to_owned(),
            serde_json::to_value(body).map_err(|_| "serialize")?,
        ),
        ("expectedPlaintext".to_owned(), Value::String(plaintext)),
        ("expectedWire".to_owned(), Value::String(wire)),
    ]);
    if let Some(presentation) = presentation {
        record.insert("presentation".to_owned(), presentation);
    }
    if let Some(expected_outcome) = expected_outcome {
        record.insert(
            "expectedOutcome".to_owned(),
            Value::String(expected_outcome.to_owned()),
        );
    }
    Ok(Value::Object(record))
}

fn mixed_vector_body() -> Body {
    Body::new(
        "generation-1".into(),
        "app".into(),
        "db".into(),
        "local".into(),
        "stream".into(),
        "mixedView".into(),
        format!("sha256:{}", "a".repeat(64)),
        serde_json::json!({"boardId":"board-1"}),
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
                    boundary: vec![serde_json::json!(9)],
                    row_id: "card-9".into(),
                },
            },
            Node {
                position: 1,
                node_plan_hash: format!("sha256:{}", "d".repeat(64)),
                state: NodeState::RelationalBoundary {
                    order_fields: vec!["updatedAt".into()],
                    boundary: vec![serde_json::json!(17)],
                    row_id: "event-17".into(),
                },
            },
            Node {
                position: 2,
                node_plan_hash: format!("sha256:{}", "e".repeat(64)),
                state: NodeState::Terminal,
            },
            Node {
                position: 3,
                node_plan_hash: format!("sha256:{}", "f".repeat(64)),
                state: NodeState::Terminal,
            },
        ],
        format!("sha256:{}", "1".repeat(64)),
        10_000,
    )
}

fn presentation(body: &Body) -> Value {
    serde_json::json!({
        "appId": "app",
        "databaseId": "db",
        "targetProfileId": "local",
        "function": "mixedView",
        "planHash": format!("sha256:{}", "a".repeat(64)),
        "args": {"boardId":"board-1"},
        "parentGroups": [{
            "groupIndex": 0,
            "parentAuthorizationKeyDigest": format!("sha256:{}", "b".repeat(64)),
            "parentId": "board-1",
            "parentIncarnation": "018f4d5a-0000-7000-8000-000000000001",
            "parentVersion": 7,
        }],
        "nodeClasses": [
            "bounded_children_v1", "relational_query_v1",
            "bounded_children_v1", "relational_query_v1",
        ],
        "authorityPartition": format!("sha256:{}", "1".repeat(64)),
        "streamEpoch": "stream",
        "nowMs": body.issued_at + 1,
        "parentSurface": "visible",
        "boundaryValid": true,
    })
}

/// Rust-owned emitter input for the complete shared LLP 0157 §D8 parity set.
/// The small CLI in
/// `crates/snapback-conformance/src/bin/snapback-sbsb2-vectors.rs` is the only writer.
/// Both the Rust drift test below and the independent Node consumer read the
/// committed rendering.
#[doc(hidden)]
pub fn reference_parity_fixture() -> Result<Value, &'static str> {
    let root: [u8; 32] = std::array::from_fn(|index| index as u8);
    let mixed = mixed_vector_body();
    let all_relational = Body::new(
        "generation-1".into(),
        "app".into(),
        "db".into(),
        "local".into(),
        "stream".into(),
        "allRelational".into(),
        format!("sha256:{}", "2".repeat(64)),
        serde_json::json!({}),
        Vec::new(),
        vec![
            Node {
                position: 0,
                node_plan_hash: format!("sha256:{}", "3".repeat(64)),
                state: NodeState::RelationalBoundary {
                    order_fields: vec!["sequence".into()],
                    boundary: vec![serde_json::json!(41)],
                    row_id: "event-41".into(),
                },
            },
            Node {
                position: 1,
                node_plan_hash: format!("sha256:{}", "4".repeat(64)),
                state: NodeState::Terminal,
            },
        ],
        format!("sha256:{}", "5".repeat(64)),
        20_000,
    );

    // The vector records its schema-declared widths explicitly. NUL is the
    // maximum compact-JSON escape expansion for one stored byte; both string
    // and id fields consume every byte of their respective declared bound.
    let template_order_fields = vec![
        "boundedString".to_owned(),
        "boundedId".to_owned(),
        "safeInteger".to_owned(),
        "boolFalse".to_owned(),
        "boolTrue".to_owned(),
    ];
    let template_boundary = vec![
        Value::String("\0".repeat(32)),
        Value::String("\0".repeat(32)),
        Value::from(-9_007_199_254_740_991_i64),
        Value::Bool(false),
        Value::Bool(true),
    ];
    let mut maximum = Body::new(
        "generation-maximum-spelling".into(),
        "app".into(),
        "database".into(),
        "local-dev-sqlite-ibex".into(),
        "stream".into(),
        "maximumTemplate".into(),
        format!("sha256:{}", "6".repeat(64)),
        serde_json::json!({"padding":""}),
        vec![ParentGroup {
            group_index: 0,
            parent_authorization_key_digest: format!("sha256:{}", "7".repeat(64)),
            parent_id: "parent-maximum".into(),
            parent_incarnation: "00000000-0000-0000-0000-000000000000".into(),
            parent_version: 9_007_199_254_740_991,
        }],
        vec![
            Node {
                position: 0,
                node_plan_hash: format!("sha256:{}", "8".repeat(64)),
                state: NodeState::Boundary {
                    order_fields: template_order_fields.clone(),
                    boundary: template_boundary.clone(),
                    row_id: "x".repeat(256),
                },
            },
            Node {
                position: 1,
                node_plan_hash: format!("sha256:{}", "9".repeat(64)),
                state: NodeState::RelationalBoundary {
                    order_fields: template_order_fields.clone(),
                    boundary: template_boundary,
                    row_id: "y".repeat(256),
                },
            },
        ],
        format!("sha256:{}", "a".repeat(64)),
        9_007_198_045_140_991,
    );
    let empty_len = compact_plaintext(&maximum)?.len();
    let padding_len = MAX_PLAINTEXT_BYTES
        .checked_sub(empty_len)
        .ok_or("oversize")?;
    maximum.args = serde_json::json!({"padding":"x".repeat(padding_len)});
    if compact_plaintext(&maximum)?.len() != MAX_PLAINTEXT_BYTES {
        return Err("serialize");
    }
    let mut over_limit = maximum.clone();
    let padding = over_limit
        .args
        .get("padding")
        .and_then(Value::as_str)
        .ok_or("serialize")?
        .to_owned();
    over_limit.args = serde_json::json!({"padding":format!("{padding}x")});
    if compact_plaintext(&over_limit)?.len() != MAX_PLAINTEXT_BYTES + 1
        || mint_with_nonce(&root, &over_limit, fixed_nonce(0xc0)) != Err("oversize")
    {
        return Err("serialize");
    }

    let mut near_misses = Vec::new();
    let mut add = |id: &str,
                   seed: u8,
                   body: Body,
                   presented: Value,
                   outcome: &str|
     -> Result<(), &'static str> {
        near_misses.push(parity_vector(
            id,
            &root,
            fixed_nonce(seed),
            &body,
            Some(presented),
            Some(outcome),
        )?);
        Ok(())
    };
    let invalid = "SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID";
    let restart = "SNAPBACK_SNAPSHOT_BATCH_RESTART_REQUIRED";

    for (id, seed, mutate) in [
        (
            "cross-app",
            0x10,
            (|body: &mut Body| body.app_id = "other-app".into()) as fn(&mut Body),
        ),
        (
            "cross-database",
            0x11,
            (|body: &mut Body| body.database_id = "other-db".into()) as fn(&mut Body),
        ),
        (
            "cross-target",
            0x12,
            (|body: &mut Body| body.target_profile_id = "remote".into()) as fn(&mut Body),
        ),
        (
            "cross-function",
            0x13,
            (|body: &mut Body| body.function = "otherFunction".into()) as fn(&mut Body),
        ),
        (
            "cross-plan",
            0x14,
            (|body: &mut Body| body.plan_hash = format!("sha256:{}", "0".repeat(64)))
                as fn(&mut Body),
        ),
        (
            "cross-args",
            0x15,
            (|body: &mut Body| body.args = serde_json::json!({"boardId":"board-2"}))
                as fn(&mut Body),
        ),
        (
            "cross-parent",
            0x16,
            (|body: &mut Body| body.parent_groups[0].parent_id = "board-2".into()) as fn(&mut Body),
        ),
        (
            "cross-authority",
            0x17,
            (|body: &mut Body| {
                body.authority_partition = format!("sha256:{}", "0".repeat(64));
            }) as fn(&mut Body),
        ),
        (
            "boundary-invalid",
            0x18,
            (|body: &mut Body| {
                let NodeState::Boundary { boundary, .. } = &mut body.nodes[0].state else {
                    unreachable!()
                };
                boundary[0] = Value::String("not-an-integer".into());
            }) as fn(&mut Body),
        ),
        (
            "state-class-mismatch",
            0x19,
            (|body: &mut Body| {
                body.nodes[0].state = NodeState::RelationalBoundary {
                    order_fields: vec!["position".into()],
                    boundary: vec![serde_json::json!(9)],
                    row_id: "card-9".into(),
                };
            }) as fn(&mut Body),
        ),
    ] {
        let mut body = mixed.clone();
        mutate(&mut body);
        add(id, seed, body, presentation(&mixed), invalid)?;
    }

    let mut epoch = mixed.clone();
    epoch.stream_epoch = "tampered-stream".into();
    add("changed-epoch", 0x1a, epoch, presentation(&mixed), restart)?;

    let mut changed_parent = presentation(&mixed);
    changed_parent["parentGroups"][0]["parentIncarnation"] =
        Value::String("018f4d5a-0000-7000-8000-000000000002".into());
    changed_parent["parentGroups"][0]["parentVersion"] = Value::from(8);
    add(
        "changed-parent-incarnation-and-version",
        0x1b,
        mixed.clone(),
        changed_parent,
        restart,
    )?;

    let mut expired = presentation(&mixed);
    expired["nowMs"] = Value::from(mixed.expires_at + 1);
    add("expired", 0x1c, mixed.clone(), expired, invalid)?;
    let mut expired_epoch = presentation(&mixed);
    expired_epoch["nowMs"] = Value::from(mixed.expires_at + 1);
    expired_epoch["streamEpoch"] = Value::String("changed-stream".into());
    add(
        "expired-plus-changed-epoch",
        0x1d,
        mixed.clone(),
        expired_epoch,
        invalid,
    )?;
    let mut expired_parent = presentation(&mixed);
    expired_parent["nowMs"] = Value::from(mixed.expires_at + 1);
    expired_parent["parentGroups"][0]["parentVersion"] = Value::from(8);
    add(
        "expired-plus-changed-parent",
        0x1e,
        mixed.clone(),
        expired_parent,
        invalid,
    )?;
    let mut rotation = presentation(&mixed);
    rotation["streamEpoch"] = Value::String("rotated-stream".into());
    rotation["authorityPartition"] = Value::String(format!("sha256:{}", "0".repeat(64)));
    add("genuine-rotation", 0x1f, mixed.clone(), rotation, invalid)?;

    let mixed_vector = parity_vector("mixed", &root, fixed_nonce(0xa0), &mixed, None, None)?;
    let all_relational_vector = parity_vector(
        "all-relational",
        &root,
        fixed_nonce(0xb0),
        &all_relational,
        None,
        None,
    )?;
    let maximum_vector = parity_vector(
        "maximum-template",
        &root,
        fixed_nonce(0xc0),
        &maximum,
        None,
        None,
    )?;
    let v1_fixture: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/snapshot-batch-sbsb1-parity-v1.json"
    ))
    .map_err(|_| "serialize")?;
    let v1_wire = v1_fixture
        .get("expectedWire")
        .and_then(Value::as_str)
        .ok_or("serialize")?;
    let v2_wire = mixed_vector
        .get("expectedWire")
        .and_then(Value::as_str)
        .ok_or("serialize")?;

    Ok(serde_json::json!({
        "formatVersion": "snapshot-batch-sbsb2-parity-v1",
        "purposeUtf8": "snapback:snapshot-batch-cursor:xchacha20:v2",
        "vectors": [mixed_vector, all_relational_vector, maximum_vector],
        "maximumTemplate": {
            "plaintextBytes": MAX_PLAINTEXT_BYTES,
            "wireBytes": MAX_WIRE_BYTES,
            "templateWidths": {
                "boundedStringMaxEncodedBytes": 32,
                "boundedIdMaxEncodedBytes": 32,
                "rootIdBytes": 256,
                "safeIntegerCharacters": 17,
                "booleanSpellings": [false, true],
                "maximumEscapeScalar": "U+0000",
            },
            "overLimitBody": over_limit,
            "overLimitPlaintextBytes": MAX_PLAINTEXT_BYTES + 1,
            "expectedEstablishmentOutcome": "SNAPBACK_SNAPSHOT_BATCH_CURSOR_BUDGET_EXCEEDED",
        },
        "nearMisses": near_misses,
        "crossFamilyPresentations": [
            {
                "id": "sbsb1-at-v2-visible",
                "wire": v1_wire,
                "surface": "snapshot-batch.v2",
                "parentSurface": "visible",
                "expectedOutcome": invalid,
            },
            {
                "id": "sbsb1-at-v2-absent",
                "wire": v1_wire,
                "surface": "snapshot-batch.v2",
                "parentSurface": "absent",
                "expectedEnvelope": {"kind":"absent","nodes":null,"continuation":null},
            },
            {
                "id": "sbsb2-at-v1-visible",
                "wire": v2_wire,
                "surface": "snapshot-batch.v1",
                "parentSurface": "visible",
                "expectedOutcome": invalid,
            },
            {
                "id": "sbsb2-at-v1-absent",
                "wire": v2_wire,
                "surface": "snapshot-batch.v1",
                "parentSurface": "absent",
                "expectedEnvelope": {"kind":"absent","nodes":null,"continuation":null},
            },
            {
                "id": "sbsb1-payload-rewritten-as-sbsb2",
                "wire": format!("sbsb2.{}", v1_wire.strip_prefix("sbsb1.").ok_or("serialize")?),
                "surface": "snapshot-batch.v2",
                "parentSurface": "visible",
                "expectedOutcome": invalid,
            },
            {
                "id": "sbsb2-payload-rewritten-as-sbsb1",
                "wire": format!("sbsb1.{}", v2_wire.strip_prefix("sbsb2.").ok_or("serialize")?),
                "surface": "snapshot-batch.v1",
                "parentSurface": "visible",
                "expectedOutcome": invalid,
            },
        ],
    }))
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
                    state: NodeState::RelationalBoundary {
                        order_fields: vec!["updatedAt".into()],
                        boundary: vec![json!(17)],
                        row_id: "event-17".into(),
                    },
                },
                Node {
                    position: 2,
                    node_plan_hash: format!("sha256:{}", "e".repeat(64)),
                    state: NodeState::Terminal,
                },
            ],
            format!("sha256:{}", "f".repeat(64)),
            10_000,
        )
    }

    #[test]
    fn exact_body_round_trips_both_boundary_arms_and_binds_context() {
        let root = [7; 32];
        let body = body();
        let plaintext = String::from_utf8(compact_plaintext(&body).unwrap()).unwrap();
        assert!(plaintext.contains("\"kind\":\"boundary\""));
        assert!(plaintext.contains("\"kind\":\"relational-boundary\""));

        let wire = mint(&root, &body).unwrap();
        assert_eq!(
            decode(
                &wire,
                &[("generation-1".into(), root)],
                "app",
                "db",
                "local",
                10_001,
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
                10_001,
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
                body.expires_at + 1,
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

        let Value::String(padding) = &mut body.args else {
            unreachable!("padding string")
        };
        padding.push('x');
        assert_eq!(mint_with_nonce(&root, &body, [3; 24]), Err("oversize"));
    }

    #[test]
    fn sbsb1_and_sbsb2_refuse_cross_family_replay_both_ways() {
        let root = [13; 32];
        let v2 = mint_with_nonce(&root, &body(), [5; 24]).unwrap();
        let v1_body = crate::snapshot_batch_cursor::Body::new(
            "generation-1".into(),
            "app".into(),
            "db".into(),
            "local".into(),
            "stream".into(),
            "boardView".into(),
            format!("sha256:{}", "a".repeat(64)),
            json!({"boardId":"board-1"}),
            vec![],
            vec![crate::snapshot_batch_cursor::Node {
                position: 0,
                node_plan_hash: format!("sha256:{}", "c".repeat(64)),
                state: crate::snapshot_batch_cursor::NodeState::Terminal,
            }],
            format!("sha256:{}", "f".repeat(64)),
            10_000,
        );
        let v1 = crate::snapshot_batch_cursor::mint(&root, &v1_body).unwrap();

        assert!(
            decode(
                &v1,
                &[("generation-1".into(), root)],
                "app",
                "db",
                "local",
                10_001,
            )
            .is_err()
        );
        assert!(
            crate::snapshot_batch_cursor::decode(
                &v2,
                &[("generation-1".into(), root)],
                "app",
                "db",
                "local",
                10_001,
            )
            .is_err()
        );

        let rewritten_v1 = format!("sbsb2.{}", v1.strip_prefix("sbsb1.").unwrap());
        let rewritten_v2 = format!("sbsb1.{}", v2.strip_prefix("sbsb2.").unwrap());
        assert!(
            decode(
                &rewritten_v1,
                &[("generation-1".into(), root)],
                "app",
                "db",
                "local",
                10_001,
            )
            .is_err()
        );
        assert!(
            crate::snapshot_batch_cursor::decode(
                &rewritten_v2,
                &[("generation-1".into(), root)],
                "app",
                "db",
                "local",
                10_001,
            )
            .is_err()
        );
    }

    // @ref LLP 0157#sbsb2-plaintext-and-budget — Rust consumes the exact
    // shared file written by the reference emitter, independently replays
    // every fixed nonce, and exact-compares the in-module source rendering so
    // neither committed bytes nor the emitter can drift alone.
    #[test]
    fn complete_reference_fixture_is_byte_exact_and_drift_guarded() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("tests/fixtures/snapshot-batch-sbsb2-parity-v1.json");
        let committed_bytes = std::fs::read(&path).expect("read sbsb2 parity fixture");
        let committed: Value =
            serde_json::from_slice(&committed_bytes).expect("parse sbsb2 parity fixture");
        assert_eq!(
            committed,
            reference_parity_fixture().expect("render reference")
        );
        assert_eq!(committed["formatVersion"], "snapshot-batch-sbsb2-parity-v1");

        let decode_hex = |value: &str| -> Vec<u8> {
            (0..value.len())
                .step_by(2)
                .map(|index| u8::from_str_radix(&value[index..index + 2], 16).unwrap())
                .collect()
        };
        for vector in committed["vectors"]
            .as_array()
            .expect("golden vectors")
            .iter()
            .chain(
                committed["nearMisses"]
                    .as_array()
                    .expect("near-miss vectors"),
            )
        {
            let root: [u8; 32] = decode_hex(vector["rootHex"].as_str().expect("root hex"))
                .try_into()
                .expect("32-byte root");
            let nonce: [u8; 24] = decode_hex(vector["nonceHex"].as_str().expect("nonce hex"))
                .try_into()
                .expect("24-byte nonce");
            let body: Body =
                serde_json::from_value(vector["body"].clone()).expect("closed v2 body");
            let plaintext = compact_plaintext(&body).expect("compact plaintext");
            assert_eq!(
                plaintext,
                vector["expectedPlaintext"]
                    .as_str()
                    .expect("expected plaintext")
                    .as_bytes(),
                "{} plaintext",
                vector["id"]
            );
            assert_eq!(
                mint_with_nonce(&root, &body, nonce).expect("fixed nonce mints"),
                vector["expectedWire"].as_str().expect("expected wire"),
                "{} wire",
                vector["id"]
            );
        }

        let mixed = &committed["vectors"][0]["body"];
        assert_eq!(mixed["parentGroups"].as_array().expect("groups").len(), 1);
        assert_eq!(
            mixed["nodes"]
                .as_array()
                .expect("mixed nodes")
                .iter()
                .map(|node| node["state"]["kind"].as_str().expect("state tag"))
                .collect::<Vec<_>>(),
            vec!["boundary", "relational-boundary", "terminal", "terminal"],
        );
        assert!(
            committed["vectors"][1]["body"]["parentGroups"]
                .as_array()
                .expect("all-relational groups")
                .is_empty()
        );
        assert_eq!(
            committed["vectors"][2]["expectedPlaintext"]
                .as_str()
                .expect("maximum plaintext")
                .len(),
            MAX_PLAINTEXT_BYTES
        );
        assert_eq!(
            committed["vectors"][2]["expectedWire"]
                .as_str()
                .expect("maximum wire")
                .len(),
            MAX_WIRE_BYTES
        );
        let over: Body =
            serde_json::from_value(committed["maximumTemplate"]["overLimitBody"].clone())
                .expect("over-limit body");
        assert_eq!(
            compact_plaintext(&over).unwrap().len(),
            MAX_PLAINTEXT_BYTES + 1
        );
        assert_eq!(mint_with_nonce(&[0; 32], &over, [0; 24]), Err("oversize"));

        let near = committed["nearMisses"].as_array().expect("near misses");
        for required in [
            "cross-app",
            "cross-database",
            "cross-target",
            "cross-function",
            "cross-plan",
            "cross-args",
            "cross-parent",
            "cross-authority",
            "expired",
            "boundary-invalid",
            "state-class-mismatch",
            "changed-epoch",
            "changed-parent-incarnation-and-version",
            "expired-plus-changed-epoch",
            "expired-plus-changed-parent",
            "genuine-rotation",
        ] {
            assert!(
                near.iter().any(|entry| entry["id"] == required),
                "{required}"
            );
        }
        assert_eq!(
            near.iter()
                .find(|entry| entry["id"] == "expired-plus-changed-epoch")
                .expect("decode-first overlap")["expectedOutcome"],
            "SNAPBACK_SNAPSHOT_BATCH_CURSOR_INVALID"
        );
        assert_eq!(
            committed["crossFamilyPresentations"]
                .as_array()
                .expect("cross-family presentations")
                .len(),
            6
        );
    }
}
