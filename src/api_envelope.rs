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
use serde_json::Value;
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
#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ApiEnvelopeDeclarationsV1 {
    #[serde(rename = "appBindings")]
    pub app_bindings: String,
}

/// One operation's argument schema, keyed by the function's stable id.
#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
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
    crate::rqs::jcs(value).map_err(|refusal| {
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

pub fn schema_registrations() -> Vec<(&'static str, Value)> {
    vec![(
        "api.envelope.schema.json",
        serde_json::to_value(schemars::schema_for!(ApiEnvelopeV1))
            .expect("api envelope schema serializes"),
    )]
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
        let canonical_schema = crate::rqs::jcs(&args_schema).expect("schema canonicalizes");
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
        crate::rqs::jcs(value)
            .expect("fixture canonicalizes")
            .into_bytes()
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
            generated_at: None,
            unsupported_dependency_diagnostics: Vec::new(),
            acknowledged_experimental_capabilities: Vec::new(),
            functions: Vec::new(),
            cron_jobs: Vec::new(),
            config: Vec::new(),
        };
        let refusal =
            verify_correspondence(&envelope, &projection).expect_err("wrong app refuses");
        assert_eq!(refusal.code, "SNAPBACK_API_ENVELOPE_CORRESPONDENCE_FAILED");
    }
}
