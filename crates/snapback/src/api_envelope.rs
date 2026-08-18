//! The API envelope: how a generic engine learns an app's callable surface
//! without parsing JavaScript.
//!
//! @ref LLP 0062#1-engine-plus-data-never-program-source--served-or-generated —
//! artifacts are data; the engine never executes served program source, so the
//! envelope carries declarative projections only.
//! @ref LLP 0062#5-distribution-the-server-advertises-the-server-is-the-version-authority —
//! Rust owns every DTO the server parses or emits, the envelope identity is the
//! SHA-256 of its JCS-canonicalized bytes, and admission recomputes each
//! member digest against an independently carried map.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

use crate::manifest::PublicFunctionManifest;

/// The envelope's own format version, moved only by a compatibility event.
pub const API_ENVELOPE_FORMAT_V1: &str = "snapback.api-envelope.v1";
pub const API_ENVELOPE_ARTIFACT_KIND: &str = "apiEnvelope";

/// Grammar bounds. Data is not code, which rules out remote execution — not
/// denial of service; every bound below is enforced before use.
pub const API_ENVELOPE_MAX_BYTES: usize = 8 * 1024 * 1024;
pub const API_ENVELOPE_MAX_FUNCTIONS: usize = 4_096;
pub const API_ENVELOPE_MAX_OPERATION_SCHEMAS: usize = 4_096;
pub const API_ENVELOPE_MAX_SCHEMA_DEPTH: usize = 32;
pub const API_ENVELOPE_MAX_DECLARATION_BYTES: usize = 2 * 1024 * 1024;

/// The digest domain: an envelope digest can never be confused for a seed,
/// blob, or artifact digest computed over the same bytes.
const ENVELOPE_DIGEST_DOMAIN: &str = "snapback:api-envelope:v1\n";
const MEMBER_DIGEST_DOMAIN: &str = "snapback:api-envelope-member:v1\n";

/// The app-only binding declarations the envelope publishes.
///
/// Deliberately distinct from the local merged `types` output (LLP 0062
/// round-10 residue #9): `appBindings` is the app's own generated surface,
/// carries no merged framework declarations, and is what a served consumer
/// materializes. The merged local output stays a checkout-side artifact.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ApiEnvelopeDeclarationsV1 {
    #[serde(rename = "appBindings")]
    pub app_bindings: String,
}

/// One operation's argument schema, keyed by the function's stable id.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ApiEnvelopeOperationV1 {
    /// The exported function name, for human-facing surfaces only. Selection
    /// is always by stable id.
    pub name: String,
    #[serde(rename = "argsSchema")]
    pub args_schema: Value,
}

/// The artifact tuple this envelope belongs to (LLP 0012's closed set).
#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ApiEnvelopeTupleV1 {
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "authMode")]
    pub auth_mode: String,
}

/// The served API envelope.
///
/// The nested `functions` projection is exactly the server-derived
/// `PublicFunctionManifest` — admission requires byte equality with the
/// projection of the manifest being activated, so a provisioner cannot smuggle
/// an unknown source-bearing member through a passthrough path.
#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ApiEnvelopeV1 {
    #[serde(rename = "artifactKind")]
    pub artifact_kind: String,
    #[serde(rename = "formatVersion")]
    pub format_version: String,
    #[serde(rename = "appId")]
    pub app_id: String,
    pub tuple: ApiEnvelopeTupleV1,
    #[serde(rename = "inputsHash")]
    pub inputs_hash: Option<String>,
    #[serde(rename = "bundleHash")]
    pub bundle_hash: Option<String>,
    /// Kept as a received value, never round-tripped through the typed
    /// projection: deserializing and re-serializing could normalize away a
    /// smuggled member, which is precisely the disclosure hole the
    /// exact-equality admission rule closes.
    #[schemars(with = "PublicFunctionManifest")]
    pub functions: Value,
    /// Operation argument schemas keyed by stable function id.
    pub operations: BTreeMap<String, ApiEnvelopeOperationV1>,
    pub declarations: ApiEnvelopeDeclarationsV1,
    /// Per-member digests keyed by stable id (`operation:<id>`,
    /// `declaration:appBindings`). Envelope-local digests prove internal
    /// consistency; the independently carried provision-side map proves the
    /// member belongs to *this* function — grammar bounds structure, the
    /// digest map binds semantics.
    #[serde(rename = "memberDigests")]
    pub member_digests: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvelopeRefusal {
    pub code: &'static str,
    pub message: String,
}

impl EnvelopeRefusal {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for EnvelopeRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

/// The member-digest key for an operation schema.
pub fn operation_member_key(stable_id: &str) -> String {
    format!("operation:{stable_id}")
}

/// The member-digest key for the app bindings declaration.
pub const DECLARATION_MEMBER_KEY: &str = "declaration:appBindings";

/// Digest one envelope member's canonical bytes under the member domain.
pub fn member_digest(canonical_bytes: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(MEMBER_DIGEST_DOMAIN.as_bytes());
    hasher.update(canonical_bytes.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// The envelope identity: SHA-256 over the JCS-canonicalized document under
/// the envelope domain.
pub fn envelope_digest(canonical_bytes: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(ENVELOPE_DIGEST_DOMAIN.as_bytes());
    hasher.update(canonical_bytes.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Canonicalize a value with the same JCS serializer the mint path uses, so
/// one logical envelope can never carry two identities.
pub fn canonicalize(value: &Value) -> Result<String, EnvelopeRefusal> {
    crate::rqs_contract::jcs(value).map_err(|refusal| {
        EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_NONCANONICAL",
            format!("envelope is not canonicalizable: {refusal:?}"),
        )
    })
}

fn json_depth(value: &Value, depth: usize, limit: usize) -> Result<(), EnvelopeRefusal> {
    if depth > limit {
        return Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
            format!("nesting exceeds the {limit}-level envelope bound"),
        ));
    }
    match value {
        Value::Array(items) => {
            for item in items {
                json_depth(item, depth + 1, limit)?;
            }
        }
        Value::Object(entries) => {
            for (_, item) in entries {
                json_depth(item, depth + 1, limit)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Parse received bytes into an envelope under the versioned admission
/// grammar. Bounded, canonicity-verified, and digest-checked: the three
/// refusal classes stay distinct because they demand different reactions.
pub fn parse_and_validate(bytes: &[u8]) -> Result<(ApiEnvelopeV1, String), EnvelopeRefusal> {
    if bytes.len() > API_ENVELOPE_MAX_BYTES {
        return Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_TOO_LARGE",
            format!(
                "envelope is {} bytes, over the {API_ENVELOPE_MAX_BYTES}-byte bound",
                bytes.len()
            ),
        ));
    }
    let received: Value = serde_json::from_slice(bytes).map_err(|err| {
        EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
            format!("envelope is not admissible JSON: {err}"),
        )
    })?;
    json_depth(&received, 0, API_ENVELOPE_MAX_SCHEMA_DEPTH)?;

    // Canonicity is verified, not assumed: reserialize and require byte
    // equality with what arrived.
    let canonical = canonicalize(&received)?;
    if canonical.as_bytes() != bytes {
        return Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_NONCANONICAL",
            "envelope bytes are not RFC 8785 canonical",
        ));
    }

    let envelope: ApiEnvelopeV1 = serde_json::from_value(received).map_err(|err| {
        EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
            format!("envelope does not match the admission grammar: {err}"),
        )
    })?;

    if envelope.artifact_kind != API_ENVELOPE_ARTIFACT_KIND {
        return Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
            format!("unexpected artifactKind '{}'", envelope.artifact_kind),
        ));
    }
    if envelope.format_version != API_ENVELOPE_FORMAT_V1 {
        return Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_VERSION_UNSUPPORTED",
            format!("unsupported formatVersion '{}'", envelope.format_version),
        ));
    }
    if envelope.app_id.is_empty() {
        return Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
            "envelope carries no app id",
        ));
    }
    let projected_functions = envelope
        .functions
        .get("functions")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            EnvelopeRefusal::new(
                "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
                "envelope projection carries no function list",
            )
        })?;
    if projected_functions.len() > API_ENVELOPE_MAX_FUNCTIONS {
        return Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
            format!("function count exceeds the {API_ENVELOPE_MAX_FUNCTIONS} bound"),
        ));
    }
    if envelope.operations.len() > API_ENVELOPE_MAX_OPERATION_SCHEMAS {
        return Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
            format!("operation count exceeds the {API_ENVELOPE_MAX_OPERATION_SCHEMAS} bound"),
        ));
    }
    if envelope.declarations.app_bindings.len() > API_ENVELOPE_MAX_DECLARATION_BYTES {
        return Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
            "declaration text exceeds the envelope bound",
        ));
    }

    verify_member_digests(&envelope)?;
    let identity = envelope_digest(&canonical);
    Ok((envelope, identity))
}

/// Recompute every member digest and compare it against the carried map.
/// A forged or swapped member fails here even when the envelope's own
/// structure is impeccable.
pub fn verify_member_digests(envelope: &ApiEnvelopeV1) -> Result<(), EnvelopeRefusal> {
    let mut expected_keys: Vec<String> = envelope
        .operations
        .keys()
        .map(|id| operation_member_key(id))
        .collect();
    expected_keys.push(DECLARATION_MEMBER_KEY.to_string());
    expected_keys.sort();

    let mut carried: Vec<String> = envelope.member_digests.keys().cloned().collect();
    carried.sort();
    if carried != expected_keys {
        return Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_MEMBER_DIGEST_MISMATCH",
            "member digest map does not cover exactly the envelope's members",
        ));
    }

    for (stable_id, operation) in &envelope.operations {
        let canonical = canonicalize(&operation.args_schema)?;
        let computed = member_digest(&canonical);
        let carried = envelope
            .member_digests
            .get(&operation_member_key(stable_id))
            .expect("key set checked above");
        if &computed != carried {
            return Err(EnvelopeRefusal::new(
                "SNAPBACK_API_ENVELOPE_MEMBER_DIGEST_MISMATCH",
                format!("operation '{stable_id}' schema digest does not match"),
            ));
        }
    }

    let declaration_digest = member_digest(&envelope.declarations.app_bindings);
    let carried_declaration = envelope
        .member_digests
        .get(DECLARATION_MEMBER_KEY)
        .expect("key set checked above");
    if &declaration_digest != carried_declaration {
        return Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_MEMBER_DIGEST_MISMATCH",
            "declaration digest does not match",
        ));
    }
    Ok(())
}

/// Cross-check an envelope against the function manifest being activated.
/// Correspondence, not simultaneity: a provisioner cannot pair manifest A
/// with envelope B.
pub fn verify_correspondence(
    envelope: &ApiEnvelopeV1,
    manifest_projection: &PublicFunctionManifest,
) -> Result<(), EnvelopeRefusal> {
    let envelope_inputs = envelope
        .functions
        .get("inputsHash")
        .and_then(Value::as_str)
        .map(str::to_string);
    let envelope_bundle = envelope
        .functions
        .get("bundleHash")
        .and_then(Value::as_str)
        .map(str::to_string);
    if envelope_inputs != envelope.inputs_hash || envelope_bundle != envelope.bundle_hash {
        return Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_CORRESPONDENCE_FAILED",
            "envelope header identity disagrees with its own projection",
        ));
    }
    if envelope.app_id != manifest_projection.app_id {
        return Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_CORRESPONDENCE_FAILED",
            "envelope app id does not match the activating manifest",
        ));
    }
    if envelope.inputs_hash != manifest_projection.inputs_hash
        || envelope.bundle_hash != manifest_projection.bundle_hash
    {
        return Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_CORRESPONDENCE_FAILED",
            "envelope artifact identity does not match the activating manifest",
        ));
    }

    // The nested projection must be exactly equal to the server-derived
    // projection — deliberately stricter than the additive-field rule,
    // because the server serves these bytes verbatim.
    let served = &envelope.functions;
    let derived = serde_json::to_value(manifest_projection).map_err(|err| {
        EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_CORRESPONDENCE_FAILED",
            format!("server projection is not serializable: {err}"),
        )
    })?;
    if served != &derived {
        return Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_CORRESPONDENCE_FAILED",
            "envelope function projection differs from the server-derived projection",
        ));
    }

    // Every activating function needs its operation schema, and no extra
    // schema may ride along.
    let mut manifest_ids: Vec<&str> = manifest_projection
        .functions
        .iter()
        .map(|fun| fun.id.as_str())
        .collect();
    manifest_ids.sort_unstable();
    let mut envelope_ids: Vec<&str> = envelope.operations.keys().map(String::as_str).collect();
    envelope_ids.sort_unstable();
    if manifest_ids != envelope_ids {
        return Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_CORRESPONDENCE_FAILED",
            "envelope operation set does not match the activating function set",
        ));
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct AppApiOperationProjection {
    pub(crate) stable_id: String,
    pub(crate) name: String,
    pub(crate) route_kind: &'static str,
    pub(crate) auth_requirement: String,
    pub(crate) args_schema: Value,
}

impl AppApiOperationProjection {
    fn admits_anonymous(&self) -> bool {
        matches!(self.auth_requirement.as_str(), "public" | "optional-user")
    }

    fn path(&self) -> String {
        format!(
            "/api/v1/{}/{}",
            self.route_kind,
            path_segment_escape(&self.name)
        )
    }
}

pub(crate) fn projection_operations(
    envelope: &ApiEnvelopeV1,
) -> Result<Vec<AppApiOperationProjection>, EnvelopeRefusal> {
    let definitions = envelope
        .functions
        .get("functions")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            EnvelopeRefusal::new(
                "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
                "envelope projection carries no function list",
            )
        })?;
    let mut definitions_by_id = BTreeMap::new();
    for definition in definitions {
        let stable_id = definition
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                EnvelopeRefusal::new(
                    "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
                    "envelope function projection carries a function without a stable id",
                )
            })?;
        if definitions_by_id.insert(stable_id, definition).is_some() {
            return Err(EnvelopeRefusal::new(
                "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
                format!("duplicate function stable id '{stable_id}'"),
            ));
        }
    }
    if definitions_by_id.len() != envelope.operations.len()
        || envelope
            .operations
            .keys()
            .any(|stable_id| !definitions_by_id.contains_key(stable_id.as_str()))
    {
        return Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
            "operation ids do not exactly match the public function projection",
        ));
    }

    let mut operations = Vec::with_capacity(envelope.operations.len());
    for (stable_id, operation) in &envelope.operations {
        let definition = definitions_by_id
            .get(stable_id.as_str())
            .expect("exact id set checked above");
        let route_kind = match definition.get("kind").and_then(Value::as_str) {
            Some("Query" | "LiveQuery") => "query",
            Some("Mutation") => "mutation",
            Some("Action") => "action",
            Some(kind) => {
                return Err(EnvelopeRefusal::new(
                    "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
                    format!("function '{stable_id}' has unsupported kind '{kind}'"),
                ));
            }
            None => {
                return Err(EnvelopeRefusal::new(
                    "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
                    format!("function '{stable_id}' carries no kind"),
                ));
            }
        };
        let auth_requirement = match definition.get("authRequirement") {
            None | Some(Value::Null) => "optional-user",
            Some(Value::String(requirement))
                if matches!(
                    requirement.as_str(),
                    "public" | "optional-user" | "authenticated"
                ) =>
            {
                requirement
            }
            _ => {
                return Err(EnvelopeRefusal::new(
                    "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
                    format!("function '{stable_id}' carries an invalid auth requirement"),
                ));
            }
        };
        operations.push(AppApiOperationProjection {
            stable_id: stable_id.clone(),
            name: operation.name.clone(),
            route_kind,
            auth_requirement: auth_requirement.to_string(),
            args_schema: operation.args_schema.clone(),
        });
    }
    operations.sort_by(|left, right| {
        let kind_order = |kind| match kind {
            "query" => 0,
            "mutation" => 1,
            "action" => 2,
            _ => 3,
        };
        kind_order(left.route_kind)
            .cmp(&kind_order(right.route_kind))
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.stable_id.cmp(&right.stable_id))
    });
    Ok(operations)
}

fn path_segment_escape(raw: &str) -> String {
    let mut escaped = String::with_capacity(raw.len());
    for byte in raw.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                escaped.push(byte as char);
            }
            _ => escaped.push_str(&format!("%{byte:02X}")),
        }
    }
    escaped
}

/// Compose the OpenAPI 3.1 projection directly from persisted envelope bytes.
/// The envelope has already applied the app's disclosure posture; this join
/// deliberately applies no second exposure filter.
///
/// @ref LLP 0204#d2--surface-1-the-third-party-api — OpenAPI is generated
/// from the envelope, the external request is unpinned, and result schemas
/// are not invented when envelope v1 does not carry them.
/// @ref LLP 0204#d8--authority-acquisition-the-ceremony-and-the-facade — enabled apps project the OAuth authorization-code flow, discovery documents, and named-bundle scope vocabulary.
pub fn compose_openapi_document(envelope_bytes: &[u8]) -> Result<Value, EnvelopeRefusal> {
    compose_openapi_document_with_oauth(envelope_bytes, None)
}

pub fn compose_openapi_document_with_oauth(
    envelope_bytes: &[u8],
    oauth: Option<&crate::contract_types::ApiOAuthManifest>,
) -> Result<Value, EnvelopeRefusal> {
    let (envelope, digest) = parse_and_validate(envelope_bytes)?;
    let operations = projection_operations(&envelope)?;
    let mut paths = Map::new();
    for operation in operations {
        let scheme = if oauth.is_some() { "oauth2" } else { "bearer" };
        let security = if operation.admits_anonymous() {
            serde_json::json!([{}, { (scheme): [] }])
        } else {
            serde_json::json!([{ (scheme): [] }])
        };
        paths.insert(
            operation.path(),
            serde_json::json!({
                "post": {
                    "operationId": operation.stable_id,
                    "summary": operation.name,
                    "x-snapback-auth-requirement": operation.auth_requirement,
                    "security": security,
                    "requestBody": {
                        "required": true,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "required": ["args"],
                                    "properties": {
                                        "args": operation.args_schema
                                    },
                                    "additionalProperties": false
                                }
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "description": "Successful Snapback invocation. Envelope v1 does not carry a result schema, so result members are intentionally unspecified.",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "description": "Snapback success envelope with operation-defined result members and server-owned invocation facts.",
                                        "additionalProperties": true
                                    }
                                }
                            }
                        }
                    }
                }
            }),
        );
    }

    let security_scheme = if let Some(oauth) = oauth {
        let scopes = oauth
            .bundles
            .keys()
            .map(|name| {
                (
                    name.clone(),
                    Value::String(format!("Snapback function bundle {name}")),
                )
            })
            .collect::<Map<String, Value>>();
        serde_json::json!({
            "type": "oauth2",
            "description": "Local-only OAuth 2.1 authorization-code facade; PKCE S256 is required.",
            "x-snapback-authorization-server-metadata": "/.well-known/oauth-authorization-server",
            "x-snapback-protected-resource-metadata": "/.well-known/oauth-protected-resource",
            "flows": {
                "authorizationCode": {
                    "authorizationUrl": "/auth/oauth/authorize",
                    "tokenUrl": "/auth/oauth/token",
                    "scopes": scopes
                }
            }
        })
    } else {
        serde_json::json!({
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "Snapback scoped token",
            "description": "A live scoped token acquired through the app's agent authority ceremony."
        })
    };
    let scheme_name = if oauth.is_some() { "oauth2" } else { "bearer" };
    Ok(serde_json::json!({
        "openapi": "3.1.0",
        "info": {
            "title": envelope.app_id,
            "version": digest,
            "x-snapback-envelope-digest": digest
        },
        "servers": [{ "url": "/" }],
        "paths": Value::Object(paths),
        "components": {
            "securitySchemes": {
                (scheme_name): security_scheme
            }
        }
    }))
}

fn first_array_value(schema: &Value, key: &str) -> Option<Value> {
    schema
        .get(key)
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .cloned()
}

fn synthesize_schema_value(schema: &Value, path: &str) -> Result<Value, EnvelopeRefusal> {
    if schema == &Value::Bool(true) {
        return Ok(Value::Null);
    }
    if schema == &Value::Bool(false) {
        return Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
            format!("{path} rejects every JSON value"),
        ));
    }
    let object = schema.as_object().ok_or_else(|| {
        EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
            format!("{path} is not a JSON Schema object or boolean"),
        )
    })?;
    for key in ["const", "default"] {
        if let Some(value) = object.get(key) {
            return Ok(value.clone());
        }
    }
    for key in ["examples", "enum", "oneOf", "anyOf"] {
        if let Some(value) = first_array_value(schema, key) {
            return if matches!(key, "oneOf" | "anyOf") {
                synthesize_schema_value(&value, path)
            } else {
                Ok(value)
            };
        }
    }
    if let Some(branches) = object.get("allOf").and_then(Value::as_array) {
        let mut merged = Map::new();
        for branch in branches {
            let value = synthesize_schema_value(branch, path)?;
            let Value::Object(fields) = value else {
                return Ok(value);
            };
            merged.extend(fields);
        }
        return Ok(Value::Object(merged));
    }

    let declared_types = match object.get("type") {
        Some(Value::String(kind)) => vec![kind.as_str()],
        Some(Value::Array(kinds)) => kinds.iter().filter_map(Value::as_str).collect(),
        _ if object.get("properties").is_some() => vec!["object"],
        _ => vec!["object"],
    };
    let kind = declared_types
        .iter()
        .copied()
        .find(|kind| *kind != "null")
        .or_else(|| declared_types.first().copied())
        .unwrap_or("object");
    match kind {
        "object" => {
            let properties = object
                .get("properties")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let mut required = object
                .get("required")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>();
            required.sort_unstable();
            let mut result = Map::new();
            for name in required {
                let child = properties.get(name).or_else(|| {
                    object
                        .get("additionalProperties")
                        .filter(|schema| schema.is_object() || schema.is_boolean())
                });
                let Some(child) = child else {
                    return Err(EnvelopeRefusal::new(
                        "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
                        format!("{path} requires '{name}' but carries no schema for it"),
                    ));
                };
                result.insert(
                    name.to_string(),
                    synthesize_schema_value(child, &format!("{path}.{name}"))?,
                );
            }
            Ok(Value::Object(result))
        }
        "array" => {
            let length = object.get("minItems").and_then(Value::as_u64).unwrap_or(0);
            let unconstrained_items = Value::Bool(true);
            let items = object.get("items").unwrap_or(&unconstrained_items);
            let mut result = Vec::new();
            for index in 0..length {
                result.push(synthesize_schema_value(items, &format!("{path}[{index}]"))?);
            }
            Ok(Value::Array(result))
        }
        "string" => {
            let length = object.get("minLength").and_then(Value::as_u64).unwrap_or(1);
            let length = usize::try_from(length.max(1)).map_err(|_| {
                EnvelopeRefusal::new(
                    "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
                    format!("{path} string minimum is too large to render"),
                )
            })?;
            Ok(Value::String("x".repeat(length)))
        }
        "integer" => {
            let minimum = object.get("minimum").and_then(Value::as_f64).unwrap_or(0.0);
            let exclusive = object
                .get("exclusiveMinimum")
                .and_then(Value::as_f64)
                .map(|value| value.floor() + 1.0)
                .unwrap_or(minimum);
            Ok(Value::from(minimum.max(exclusive).ceil() as i64))
        }
        "number" => {
            let minimum = object.get("minimum").and_then(Value::as_f64).unwrap_or(0.0);
            let exclusive = object
                .get("exclusiveMinimum")
                .and_then(Value::as_f64)
                .map(|value| value + 0.5)
                .unwrap_or(minimum);
            serde_json::Number::from_f64(minimum.max(exclusive))
                .map(Value::Number)
                .ok_or_else(|| {
                    EnvelopeRefusal::new(
                        "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
                        format!("{path} has a non-finite numeric minimum"),
                    )
                })
        }
        "boolean" => Ok(Value::Bool(false)),
        "null" => Ok(Value::Null),
        _ => Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
            format!("{path} uses unsupported type '{kind}'"),
        )),
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

/// Compose the app's compact, digest-pinned Agent Skill from the same
/// persisted envelope as the OpenAPI projection. Mutable operation and scope
/// inventories remain pointers to current server facts rather than prose.
///
/// @ref LLP 0204#d92--generated-agent-skill — discovery, authority, finite
/// invocation, and target-conditional code mode are taught without embedding
/// credentials or a static scope list.
pub fn compose_agent_skill(envelope_bytes: &[u8]) -> Result<String, EnvelopeRefusal> {
    compose_agent_skill_with_oauth(envelope_bytes, false)
}

/// @ref LLP 0204#d8--authority-acquisition-the-ceremony-and-the-facade — the generated skill keeps native LLP 0150 acquisition primary while teaching standards clients the live facade discovery path.
pub fn compose_agent_skill_with_oauth(
    envelope_bytes: &[u8],
    oauth_enabled: bool,
) -> Result<String, EnvelopeRefusal> {
    let (envelope, digest) = parse_and_validate(envelope_bytes)?;
    let operations = projection_operations(&envelope)?;
    let example = if let Some(operation) = operations.first() {
        let args = synthesize_schema_value(
            &operation.args_schema,
            &format!("operations.{}.argsSchema", operation.name),
        )?;
        let body = serde_json::to_string_pretty(&serde_json::json!({ "args": args })).map_err(
            |error| {
                EnvelopeRefusal::new(
                    "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
                    format!("agent-skill example could not be serialized: {error}"),
                )
            },
        )?;
        let anonymous_note = if operation.admits_anonymous() {
            " This operation admits anonymous callers, so omit the Authorization header when no user authority is needed."
        } else {
            ""
        };
        format!(
            concat!(
                "The current envelope's first operation is `{}` (`{}`).{}\n\n",
                "```sh\n",
                "curl --fail-with-body --silent --show-error \\\n",
                "  -X POST \"$APP_BASE_URL{}\" \\\n",
                "  -H 'content-type: application/json' \\\n",
                "  -H 'x-snapback-auth-client-protocol: 1' \\\n",
                "  -H \"authorization: Bearer $APP_API_TOKEN\" \\\n",
                "  --data {}\n",
                "```",
            ),
            operation.name,
            operation.stable_id,
            anonymous_note,
            operation.path(),
            shell_quote(&body),
        )
    } else {
        "The pinned envelope currently declares no callable operations; fetch the next current envelope before invoking.".to_string()
    };

    let oauth_pointer = if oauth_enabled {
        "\n\nThis app also enables the local-only OAuth 2.1 facade. Discover authorization-server and protected-resource facts at `GET /.well-known/oauth-authorization-server` and `GET /.well-known/oauth-protected-resource`; the former points to `POST /auth/oauth/register`, `GET|POST /auth/oauth/authorize`, `POST /auth/oauth/token`, and `POST /auth/oauth/revoke`. Use authorization code + PKCE S256. Dynamic registration returns no client secret. Tokens are 15-minute bearer carriers with no refresh-token flow; re-authorize after expiry. Suspension and revocation are checked at authorization and token exchange."
    } else {
        ""
    };
    Ok(format!(
        "---\nname: snapback-app-api\ndescription: Discover and invoke the current digest-pinned API for this Snapback app.\n---\n\n# Snapback app API: {}\n\nEnvelope digest: `{}`\n\nThis skill is a navigation aid for one persisted API envelope. Fetch current facts before acting; do not treat this document as an operation or scope registry. It contains no credential.\n\n## Discover\n\n1. Fetch `GET /app-api/current`.\n2. Fetch the exact `GET /app-api/envelope/{{sha256}}` named by discovery and require its digest to equal `{}`.\n3. Fetch `GET /app-api/openapi.json` for the OpenAPI 3.1 projection of that same current envelope.\n\nIf discovery changes, discard derived facts and repeat these steps.\n\n## Acquire authority\n\nUse the app's live LLP 0150 ceremony endpoints as pointers: `POST /auth/agents/register` for eligible registration, or the pairing path through `POST /auth/pairing-codes` and `POST /auth/agents/pair`; mint bounded authority with `POST /auth/agents/token`. Follow live refusals and discovery for the exact next step. Never invent scopes, copy a static scope list, or persist returned credentials in source or model output.{}\n\n## Invoke\n\nCall the versioned finite family at `POST /api/v1/{{kind}}/{{name}}` with a closed body containing only `args`; `expectedGeneration` is not part of this external contract. Use the live OpenAPI document for current names, argument schemas, and anonymous-admission facts.\n\n{}\n\n## Code mode\n\n`POST /api/v1/run` is registered, but every current target refuses execution until a target carries the separately evidenced untrusted-code profile. Submit code only after `GET /inspect` advertises that profile; otherwise continue with finite calls. Owner-code runtime qualification is not evidence for this capability.\n",
        envelope.app_id, digest, digest, oauth_pointer, example,
    ))
}

pub fn schema_registrations() -> Vec<(&'static str, Value)> {
    vec![
        (
            "api.envelope.schema.json",
            serde_json::to_value(schemars::schema_for!(ApiEnvelopeV1))
                .expect("api envelope schema serializes"),
        ),
        (
            "api.envelope-members.schema.json",
            serde_json::to_value(schemars::schema_for!(ApiEnvelopeMembersV1))
                .expect("api envelope members schema serializes"),
        ),
        (
            "app-api.discovery.schema.json",
            serde_json::to_value(schemars::schema_for!(AppApiDiscoveryV1))
                .expect("app-api discovery schema serializes"),
        ),
    ]
}

/// The codegen-owned envelope members carried through the provision intent
/// under the 2026-08-01 server-composes ruling: codegen supplies only what it
/// owns (operation argument schemas and the appBindings declaration, with its
/// own digest map binding them), and the server composes the canonical
/// envelope from its own projection at activation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ApiEnvelopeMembersV1 {
    /// Operation argument schemas keyed by stable function id.
    pub operations: BTreeMap<String, ApiEnvelopeOperationV1>,
    pub declarations: ApiEnvelopeDeclarationsV1,
    /// Digests over the supplied members, recomputed and compared at
    /// composition: the map binds the members to what codegen produced, so a
    /// transport or tooling corruption refuses instead of activating.
    #[serde(rename = "memberDigests")]
    pub member_digests: BTreeMap<String, String>,
}

/// The `/app-api/current` discovery document (sessions targets only).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AppApiDiscoveryV1 {
    #[serde(rename = "artifactKind")]
    pub artifact_kind: String,
    #[serde(rename = "formatVersion")]
    pub format_version: String,
    #[serde(rename = "appId")]
    pub app_id: String,
    /// The active artifact tuple identity.
    pub tuple: AppApiDiscoveryTupleV1,
    /// The current envelope, or the typed absent marker (never a 404: an
    /// envelope-less generation is an admissible state whose tuple still
    /// binds).
    pub envelope: AppApiDiscoveryEnvelopeV1,
    /// Whether this target advertises the `app-cli.target` eligibility
    /// capability (LLP 0062 §4). Advisory pre-flag; the engine still treats
    /// absence as capability-absent.
    #[serde(rename = "appCliTarget")]
    pub app_cli_target: bool,
    /// The `app-cli.target` descriptor itself, echoed here because LLP 0062
    /// §4 requires eligibility to ride the capability manifest "and echoed by
    /// sessions discovery": the engine reads this credential-free, before any
    /// principal is selected, so a refused lane is a stated target capability
    /// rather than an inference from the URL. Absent = capability-absent.
    #[serde(
        rename = "appCliDescriptor",
        skip_serializing_if = "Option::is_none",
        default
    )]
    pub app_cli_descriptor: Option<crate::manifest::AppCliTargetFactsV1>,
    /// Advisory engine-version range. None until a range is published.
    #[serde(rename = "engineRange")]
    pub engine_range: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AppApiDiscoveryTupleV1 {
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "authMode")]
    pub auth_mode: String,
    #[serde(rename = "schemaHash")]
    pub schema_hash: Option<String>,
    #[serde(rename = "bundleHash")]
    pub bundle_hash: Option<String>,
    #[serde(rename = "inputsHash")]
    pub inputs_hash: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(tag = "state", rename_all = "kebab-case", deny_unknown_fields)]
pub enum AppApiDiscoveryEnvelopeV1 {
    Current {
        sha256: String,
    },
    /// The generation activated without an envelope (provisioned before the
    /// envelope amendment, or without the codegen-owned members).
    Absent,
}

/// The server-composed envelope: canonical bytes plus their content address.
#[derive(Clone, Debug, PartialEq)]
pub struct ComposedEnvelope {
    pub canonical: String,
    pub digest: String,
}

/// Compose the canonical envelope from the server's own projection plus the
/// codegen-owned members, then self-verify the composition with the same
/// admission rules a received envelope would face. A composition that fails
/// its own verification refuses activation.
///
/// @ref LLP 0062#5-distribution-the-server-advertises-the-server-is-the-version-authority — the 2026-08-01 author ruling: server-composed at activation.
pub fn compose_api_envelope(
    projection: &PublicFunctionManifest,
    members: &ApiEnvelopeMembersV1,
    auth_mode: &str,
) -> Result<ComposedEnvelope, EnvelopeRefusal> {
    // Bind the received members to codegen's digest map before composing.
    // Exactly the convention `verify_member_digests` enforces: an operation's
    // digest covers its canonicalized args schema, and the declaration's
    // covers its raw bytes. Two conventions would mean a composition that can
    // never self-verify.
    let mut expected: BTreeMap<String, String> = BTreeMap::new();
    for (id, operation) in &members.operations {
        let canonical = canonicalize(&operation.args_schema)?;
        expected.insert(operation_member_key(id), member_digest(&canonical));
    }
    expected.insert(
        DECLARATION_MEMBER_KEY.to_string(),
        member_digest(&members.declarations.app_bindings),
    );
    if expected != members.member_digests {
        return Err(EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_MEMBER_DIGEST_MISMATCH",
            "supplied member digests do not match the supplied members",
        ));
    }

    let functions = serde_json::to_value(projection).map_err(|err| {
        EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_CORRESPONDENCE_FAILED",
            format!("server projection is not serializable: {err}"),
        )
    })?;
    let envelope = ApiEnvelopeV1 {
        artifact_kind: API_ENVELOPE_ARTIFACT_KIND.to_string(),
        format_version: API_ENVELOPE_FORMAT_V1.to_string(),
        app_id: projection.app_id.clone(),
        tuple: ApiEnvelopeTupleV1 {
            schema_version: projection.schema_version.clone(),
            auth_mode: auth_mode.to_string(),
        },
        inputs_hash: projection.inputs_hash.clone(),
        bundle_hash: projection.bundle_hash.clone(),
        functions,
        operations: members.operations.clone(),
        declarations: members.declarations.clone(),
        member_digests: members.member_digests.clone(),
    };
    let value = serde_json::to_value(&envelope).map_err(|err| {
        EnvelopeRefusal::new(
            "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID",
            format!("composed envelope is not serializable: {err}"),
        )
    })?;
    let canonical = canonicalize(&value)?;

    // Self-verification: the composed bytes must satisfy every rule a
    // received envelope would — grammar, canonicity, member digests, and
    // exact correspondence with the projection that produced them.
    let (parsed, _) = parse_and_validate(canonical.as_bytes())?;
    verify_member_digests(&parsed)?;
    verify_correspondence(&parsed, projection)?;

    let digest = envelope_digest(&canonical);
    Ok(ComposedEnvelope { canonical, digest })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture_envelope() -> Value {
        let functions = json!({
            "artifactKind": "publicFunctionManifest",
            "schemaVersion": "snapback.v1",
            "appId": "demo",
            "bundleHash": "b1",
            "inputsHash": "i1",
            "generatedAt": null,
            "unsupportedDependencyDiagnostics": [],
            "functions": [],
            "cronJobs": [],
            "config": []
        });
        let args_schema = json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "additionalProperties": false,
            "properties": {}
        });
        let declaration = "export declare const api: unknown;\n";
        let canonical_schema = crate::rqs_contract::jcs(&args_schema).expect("schema canonicalizes");
        json!({
            "artifactKind": API_ENVELOPE_ARTIFACT_KIND,
            "formatVersion": API_ENVELOPE_FORMAT_V1,
            "appId": "demo",
            "tuple": { "schemaVersion": "snapback.v1", "authMode": "sessions" },
            "inputsHash": "i1",
            "bundleHash": "b1",
            "functions": functions,
            "operations": {
                "demo:listTodos": {
                    "name": "listTodos",
                    "argsSchema": args_schema
                }
            },
            "declarations": { "appBindings": declaration },
            "memberDigests": {
                "operation:demo:listTodos": member_digest(&canonical_schema),
                "declaration:appBindings": member_digest(declaration)
            }
        })
    }

    fn canonical_bytes(value: &Value) -> Vec<u8> {
        crate::rqs_contract::jcs(value)
            .expect("fixture canonicalizes")
            .into_bytes()
    }

    fn projectable_envelope() -> Value {
        let mut value = fixture_envelope();
        value["functions"]["functions"] = json!([
            {
                "id": "demo:listTodos",
                "name": "listTodos",
                "kind": "Query",
                "authRequirement": "public",
                "apiExposure": { "expose": true }
            },
            {
                "id": "demo:createTodo",
                "name": "createTodo",
                "kind": "Mutation",
                "authRequirement": "authenticated",
                "apiExposure": { "expose": true }
            }
        ]);
        let list_schema = json!({
            "type": "object",
            "required": ["filter"],
            "properties": {
                "filter": {
                    "type": "object",
                    "required": ["term"],
                    "properties": {
                        "term": { "type": "string", "minLength": 1 },
                        "limit": { "type": "integer", "minimum": 1 }
                    },
                    "additionalProperties": false
                }
            },
            "additionalProperties": false
        });
        let create_schema = json!({
            "type": "object",
            "required": ["title"],
            "properties": {
                "title": { "type": "string", "minLength": 1 }
            },
            "additionalProperties": false
        });
        value["operations"] = json!({
            "demo:listTodos": {
                "name": "listTodos",
                "argsSchema": list_schema
            },
            "demo:createTodo": {
                "name": "createTodo",
                "argsSchema": create_schema
            }
        });
        let declaration = value["declarations"]["appBindings"]
            .as_str()
            .expect("declaration");
        value["memberDigests"] = json!({
            "operation:demo:listTodos": member_digest(
                &canonicalize(&list_schema).expect("list schema canonicalizes")
            ),
            "operation:demo:createTodo": member_digest(
                &canonicalize(&create_schema).expect("create schema canonicalizes")
            ),
            "declaration:appBindings": member_digest(declaration)
        });
        value
    }

    #[test]
    fn admits_a_canonical_envelope_and_returns_its_identity() {
        let bytes = canonical_bytes(&fixture_envelope());
        let (envelope, identity) = parse_and_validate(&bytes).expect("fixture admits");
        assert_eq!(envelope.app_id, "demo");
        assert_eq!(identity.len(), 64);
        assert!(identity.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn refuses_noncanonical_bytes_so_one_envelope_cannot_carry_two_identities() {
        let pretty = serde_json::to_vec_pretty(&fixture_envelope()).expect("serializes");
        let refusal = parse_and_validate(&pretty).expect_err("noncanonical bytes refuse");
        assert_eq!(refusal.code, "SNAPBACK_API_ENVELOPE_NONCANONICAL");
    }

    #[test]
    fn refuses_a_forged_member_after_local_hashes_are_recomputed() {
        let mut value = fixture_envelope();
        value["operations"]["demo:listTodos"]["argsSchema"]["properties"] = json!({
            "smuggled": { "type": "string" }
        });
        let bytes = canonical_bytes(&value);
        let refusal = parse_and_validate(&bytes).expect_err("forged member refuses");
        assert_eq!(refusal.code, "SNAPBACK_API_ENVELOPE_MEMBER_DIGEST_MISMATCH");
    }

    #[test]
    fn refuses_an_unknown_member_rather_than_ignoring_it() {
        let mut value = fixture_envelope();
        value["smuggledSource"] = json!("export function handler() {}");
        let bytes = canonical_bytes(&value);
        let refusal = parse_and_validate(&bytes).expect_err("unknown member refuses");
        assert_eq!(refusal.code, "SNAPBACK_API_ENVELOPE_GRAMMAR_INVALID");
    }

    #[test]
    fn refuses_a_digest_map_that_does_not_cover_the_members() {
        let mut value = fixture_envelope();
        value["memberDigests"]
            .as_object_mut()
            .expect("map")
            .remove("declaration:appBindings");
        let bytes = canonical_bytes(&value);
        let refusal = parse_and_validate(&bytes).expect_err("partial map refuses");
        assert_eq!(refusal.code, "SNAPBACK_API_ENVELOPE_MEMBER_DIGEST_MISMATCH");
    }

    #[test]
    fn refuses_an_unsupported_format_version() {
        let mut value = fixture_envelope();
        value["formatVersion"] = json!("snapback.api-envelope.v2");
        let bytes = canonical_bytes(&value);
        let refusal = parse_and_validate(&bytes).expect_err("future version refuses");
        assert_eq!(refusal.code, "SNAPBACK_API_ENVELOPE_VERSION_UNSUPPORTED");
    }

    #[test]
    fn a_zero_function_envelope_is_admissible() {
        let mut value = fixture_envelope();
        value["operations"] = json!({});
        let declaration = value["declarations"]["appBindings"]
            .as_str()
            .expect("declaration")
            .to_string();
        value["memberDigests"] = json!({
            "declaration:appBindings": member_digest(&declaration)
        });
        let bytes = canonical_bytes(&value);
        let (envelope, _) = parse_and_validate(&bytes).expect("degenerate envelope admits");
        assert!(envelope.operations.is_empty());
    }

    #[test]
    fn correspondence_refuses_a_mismatched_manifest_pairing() {
        let bytes = canonical_bytes(&fixture_envelope());
        let (envelope, _) = parse_and_validate(&bytes).expect("fixture admits");
        let projection = PublicFunctionManifest {
            artifact_kind: "publicFunctionManifest".to_string(),
            schema_version: "snapback.v1".to_string(),
            app_id: "other".to_string(),
            bundle_hash: Some("b1".to_string()),
            inputs_hash: Some("i1".to_string()),
            authored_source_hash: None,
            generated_at: None,
            unsupported_dependency_diagnostics: Vec::new(),
            acknowledged_experimental_capabilities: Vec::new(),
            functions: Vec::new(),
            cron_jobs: Vec::new(),
            config: Vec::new(),
        };
        let refusal = verify_correspondence(&envelope, &projection).expect_err("wrong app refuses");
        assert_eq!(refusal.code, "SNAPBACK_API_ENVELOPE_CORRESPONDENCE_FAILED");
    }

    #[test]
    fn openapi_projection_joins_operations_and_keeps_result_shape_honest() {
        let bytes = canonical_bytes(&projectable_envelope());
        let document = compose_openapi_document(&bytes).expect("OpenAPI composes");
        assert_eq!(document["openapi"], "3.1.0");
        assert_eq!(document["info"]["title"], "demo");
        let canonical = std::str::from_utf8(&bytes).expect("canonical UTF-8");
        assert_eq!(document["info"]["version"], envelope_digest(canonical));
        assert_eq!(document["paths"].as_object().expect("paths").len(), 2);

        let query = &document["paths"]["/api/v1/query/listTodos"]["post"];
        let request_schema = &query["requestBody"]["content"]["application/json"]["schema"];
        assert_eq!(request_schema["required"], json!(["args"]));
        assert_eq!(request_schema["additionalProperties"], false);
        assert_eq!(
            request_schema["properties"]
                .as_object()
                .expect("request properties")
                .keys()
                .collect::<Vec<_>>(),
            vec!["args"]
        );
        assert!(request_schema.get("expectedGeneration").is_none());
        assert_eq!(query["security"][0], json!({}));
        assert_eq!(query["security"][1], json!({ "bearer": [] }));

        let mutation = &document["paths"]["/api/v1/mutation/createTodo"]["post"];
        assert_eq!(mutation["security"], json!([{ "bearer": [] }]));
        assert!(
            mutation["responses"]["200"]["description"]
                .as_str()
                .expect("response description")
                .contains("does not carry a result schema")
        );
        assert_eq!(
            mutation["responses"]["200"]["content"]["application/json"]["schema"]["additionalProperties"],
            true
        );
    }

    #[test]
    fn oauth_enabled_projection_uses_authorization_code_bundle_scopes_and_skill_discovery() {
        let bytes = canonical_bytes(&projectable_envelope());
        let oauth = crate::contract_types::ApiOAuthManifest {
            enabled: true,
            bearer: true,
            bundles: BTreeMap::from([(
                "todos.read".to_owned(),
                crate::contract_types::ApiOAuthBundle {
                    functions: vec!["listTodos".to_owned()],
                },
            )]),
        };
        let document = compose_openapi_document_with_oauth(&bytes, Some(&oauth))
            .expect("OAuth OpenAPI composes");
        let scheme = &document["components"]["securitySchemes"]["oauth2"];
        assert_eq!(scheme["type"], "oauth2");
        assert_eq!(
            scheme["flows"]["authorizationCode"]["authorizationUrl"],
            "/auth/oauth/authorize"
        );
        assert_eq!(
            scheme["flows"]["authorizationCode"]["tokenUrl"],
            "/auth/oauth/token"
        );
        assert_eq!(
            scheme["x-snapback-authorization-server-metadata"],
            "/.well-known/oauth-authorization-server"
        );
        assert_eq!(
            scheme["x-snapback-protected-resource-metadata"],
            "/.well-known/oauth-protected-resource"
        );
        assert!(scheme["flows"]["authorizationCode"]["scopes"]["todos.read"].is_string());
        assert_eq!(
            document["paths"]["/api/v1/mutation/createTodo"]["post"]["security"],
            json!([{ "oauth2": [] }])
        );

        let skill = compose_agent_skill_with_oauth(&bytes, true).expect("OAuth skill composes");
        assert!(skill.contains("/.well-known/oauth-authorization-server"));
        assert!(skill.contains("/.well-known/oauth-protected-resource"));
        assert!(skill.contains("/auth/oauth/revoke"));
        assert!(skill.contains("PKCE S256"));
        assert!(skill.contains("no refresh-token flow"));
        assert!(
            skill.contains("/auth/agents/register"),
            "native LLP 0150 path remains"
        );
    }

    #[test]
    fn generated_agent_skill_is_small_pinned_and_pointer_heavy() {
        let bytes = canonical_bytes(&projectable_envelope());
        let skill = compose_agent_skill(&bytes).expect("agent skill composes");
        let canonical = std::str::from_utf8(&bytes).expect("canonical UTF-8");
        assert!(skill.len() < 8 * 1024, "skill grew beyond the D9.2 target");
        assert!(skill.contains(&envelope_digest(canonical)));
        for pointer in [
            "/app-api/current",
            "/app-api/envelope/{sha256}",
            "/app-api/openapi.json",
            "/auth/agents/register",
            "/auth/agents/pair",
            "/auth/agents/token",
            "/api/v1/query/listTodos",
            "/api/v1/run",
        ] {
            assert!(skill.contains(pointer), "missing pointer {pointer}");
        }
        assert!(skill.contains("\"filter\": {"));
        assert!(skill.contains("\"term\": \"x\""));
        assert!(!skill.contains("requestedScopes"));
        assert!(!skill.contains("sbagt_"));
        assert!(!skill.contains("read_set"));
    }
}

#[cfg(test)]
mod compose_tests {
    use super::*;
    use serde_json::json;

    // `PublicFunctionManifest` is serialize-only by design (it is a
    // projection, never parsed back), so the fixture is constructed.
    fn projection() -> PublicFunctionManifest {
        PublicFunctionManifest {
            artifact_kind: "publicFunctionManifest".to_string(),
            schema_version: "snapback.v1".to_string(),
            app_id: "demo".to_string(),
            bundle_hash: Some("b1".to_string()),
            inputs_hash: Some("i1".to_string()),
            authored_source_hash: None,
            generated_at: None,
            unsupported_dependency_diagnostics: Vec::new(),
            acknowledged_experimental_capabilities: Vec::new(),
            functions: Vec::new(),
            cron_jobs: Vec::new(),
            config: Vec::new(),
        }
    }

    // The zero-function projection with its declaration-only members: the
    // degenerate-but-valid envelope the admission suite already covers.
    // Operation/function pairing is exercised by the ghost test below.
    fn members() -> ApiEnvelopeMembersV1 {
        let declaration = "export declare const api: unknown;\n".to_string();
        let mut member_digests = BTreeMap::new();
        member_digests.insert(
            DECLARATION_MEMBER_KEY.to_string(),
            member_digest(&declaration),
        );
        ApiEnvelopeMembersV1 {
            operations: BTreeMap::new(),
            declarations: ApiEnvelopeDeclarationsV1 {
                app_bindings: declaration,
            },
            member_digests,
        }
    }

    #[test]
    fn composes_and_self_verifies_from_the_server_projection() {
        let composed = compose_api_envelope(&projection(), &members(), "sessions")
            .expect("composition self-verifies");
        assert_eq!(composed.digest.len(), 64);
        // The composed bytes must survive the same admission a received
        // envelope faces — that is the whole point of self-verification.
        let (parsed, identity) =
            parse_and_validate(composed.canonical.as_bytes()).expect("composed bytes admit");
        assert_eq!(identity, composed.digest);
        assert_eq!(parsed.app_id, "demo");
        // Correspondence is trivially true by construction, which is exactly
        // what the server-composes ruling buys.
        verify_correspondence(&parsed, &projection()).expect("composition corresponds");
    }

    #[test]
    fn composition_is_deterministic_for_the_same_inputs() {
        let first = compose_api_envelope(&projection(), &members(), "sessions").expect("first");
        let second = compose_api_envelope(&projection(), &members(), "sessions").expect("second");
        assert_eq!(first.digest, second.digest);
        assert_eq!(first.canonical, second.canonical);
    }

    #[test]
    fn refuses_members_whose_digests_do_not_bind_them() {
        let mut tampered = members();
        // A member changed in transit while its digest map did not: the
        // binding check refuses before anything is composed or activated.
        tampered.declarations.app_bindings = "export declare const api: never;\n".to_string();
        let refusal = compose_api_envelope(&projection(), &tampered, "sessions")
            .expect_err("tampered members refuse");
        assert_eq!(refusal.code, "SNAPBACK_API_ENVELOPE_MEMBER_DIGEST_MISMATCH");
    }

    #[test]
    fn refuses_when_an_operation_has_no_activating_function() {
        // The projection carries no functions, so an operation for a
        // function that is not activating fails correspondence — the
        // pairing rule survives composition.
        let mut extra = members();
        let args_schema = json!({ "type": "object" });
        let canonical = canonicalize(&args_schema).expect("canonicalizes");
        extra.operations.insert(
            "demo:ghost".to_string(),
            ApiEnvelopeOperationV1 {
                name: "ghost".to_string(),
                args_schema,
            },
        );
        extra.member_digests.insert(
            operation_member_key("demo:ghost"),
            member_digest(&canonical),
        );
        let refusal =
            compose_api_envelope(&projection(), &extra, "sessions").expect_err("ghost refuses");
        assert_eq!(refusal.code, "SNAPBACK_API_ENVELOPE_CORRESPONDENCE_FAILED");
    }

    #[test]
    fn the_auth_mode_rides_the_composed_tuple() {
        let composed =
            compose_api_envelope(&projection(), &members(), "sessions").expect("composes");
        let (parsed, _) = parse_and_validate(composed.canonical.as_bytes()).expect("admits");
        assert_eq!(parsed.tuple.auth_mode, "sessions");
    }

    /// Cross-language anchor with the JS engine's ingestion verifier
    /// (`packages/snapback-app-cli/envelope.test.mjs`): the identical
    /// canonical bytes must admit on both sides and produce the identical
    /// content address, or one side's canonicalization/digesting drifted.
    #[test]
    fn js_engine_anchor_envelope_parses_and_digests_identically() {
        let canonical = format!(
            concat!(
                "{{\"appId\":\"anchor-app\",\"artifactKind\":\"apiEnvelope\",",
                "\"bundleHash\":\"snapback.v1:sessions:function:sha256:{b}\",",
                "\"declarations\":{{\"appBindings\":\"export const bindings = {{}};\\n\"}},",
                "\"formatVersion\":\"snapback.api-envelope.v1\",",
                "\"functions\":{{\"appId\":\"anchor-app\",\"artifactKind\":\"functionManifest\",",
                "\"bundleHash\":\"snapback.v1:sessions:function:sha256:{b}\",",
                "\"functions\":[{{\"authRequirement\":\"authenticated\",\"id\":\"anchor-app:addNote\",\"kind\":\"Mutation\",\"name\":\"addNote\"}},",
                "{{\"authRequirement\":\"authenticated\",\"id\":\"anchor-app:listNotes\",\"kind\":\"Query\",\"name\":\"listNotes\"}}],",
                "\"inputsHash\":\"snapback.v1:sessions:inputs:sha256:{c}\"}},",
                "\"inputsHash\":\"snapback.v1:sessions:inputs:sha256:{c}\",",
                "\"memberDigests\":{{\"declaration:appBindings\":\"e8e2d8ff0088c9ee62db4171f268cac2931f51c5724cb6a2fbd3b9b52968bd59\",",
                "\"operation:anchor-app:addNote\":\"c5159bb036b76512dcd0d9d97bd51cd7041c9367af483ea2e355e9885d30dbf2\",",
                "\"operation:anchor-app:listNotes\":\"cb851c1685cc73404ff7c5c0bf704d8399afa8cbd05a18fd835e2069c2f76641\"}},",
                "\"operations\":{{\"anchor-app:addNote\":{{\"argsSchema\":{{\"properties\":{{\"title\":{{\"type\":\"string\"}}}},\"type\":\"object\"}},\"name\":\"addNote\"}},",
                "\"anchor-app:listNotes\":{{\"argsSchema\":{{\"properties\":{{}},\"type\":\"object\"}},\"name\":\"listNotes\"}}}},",
                "\"tuple\":{{\"authMode\":\"sessions\",\"schemaVersion\":\"snapback.v1\"}}}}"
            ),
            b = "b".repeat(64),
            c = "c".repeat(64),
        );
        let (parsed, identity) =
            parse_and_validate(canonical.as_bytes()).expect("the JS anchor admits");
        assert_eq!(parsed.app_id, "anchor-app");
        assert_eq!(
            identity,
            "ae62a5543e096aba479faa7f3c00314922448e736e673606b0a3ef3407b5d905",
        );
    }
}
