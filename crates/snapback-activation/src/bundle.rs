//! Snapshot bundle endpoint contract — request/response shapes, the
//! `SNAPBACK_BUNDLE_*` refusal-code registry, the pinned hard limits, the
//! `params-v1` args-mapping substitution, and the pending-registration-owner
//! bookkeeping for register mode.
//!
//! @ref LLP 0092#0d--bundle-endpoint--connection-ownership — the 0D contract
//!   this module implements: `POST /app/bundle`, modes, closed per-entry
//!   union, atomicity, limits/codes, idempotency replay-validity, and the
//!   attach-grace/reaping defaults.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest as _, Sha256};

use crate::auth::invalidation::{AuthorizationInvalidationProjection, QueryNamespace, ScopeId};
use crate::live_wire::ResumeWire;

/// Stable `SNAPBACK_BUNDLE_*` refusal-code registry (LLP 0092 §0D.2).
/// Append-only, paralleling `SNAPBACK_RESUME_*`.
pub mod code {
    pub const ROUTE_UNKNOWN: &str = "SNAPBACK_BUNDLE_ROUTE_UNKNOWN";
    pub const ENTRY_INVALID: &str = "SNAPBACK_BUNDLE_ENTRY_INVALID";
    pub const PARAMS_INVALID: &str = "SNAPBACK_BUNDLE_PARAMS_INVALID";
    pub const MODE_INVALID: &str = "SNAPBACK_BUNDLE_MODE_INVALID";
    pub const NOT_PUBLIC: &str = "SNAPBACK_BUNDLE_NOT_PUBLIC";
    pub const REGISTER_REQUIRES_CREDENTIAL: &str = "SNAPBACK_BUNDLE_REGISTER_REQUIRES_CREDENTIAL";
    pub const QUERY_FAILED: &str = "SNAPBACK_BUNDLE_QUERY_FAILED";
    pub const LIMIT_QUERIES: &str = "SNAPBACK_BUNDLE_LIMIT_QUERIES";
    pub const LIMIT_ROWS: &str = "SNAPBACK_BUNDLE_LIMIT_ROWS";
    pub const LIMIT_BYTES: &str = "SNAPBACK_BUNDLE_LIMIT_BYTES";
    pub const LIMIT_TIME: &str = "SNAPBACK_BUNDLE_LIMIT_TIME";
    pub const RATE_LIMITED: &str = "SNAPBACK_BUNDLE_RATE_LIMITED";
    pub const IDEMPOTENCY_SENDER_MISMATCH: &str = "SNAPBACK_BUNDLE_IDEMPOTENCY_SENDER_MISMATCH";
    pub const IDEMPOTENCY_SCOPE_MISMATCH: &str = "SNAPBACK_BUNDLE_IDEMPOTENCY_SCOPE_MISMATCH";
    pub const IDEMPOTENCY_EXPIRED: &str = "SNAPBACK_BUNDLE_IDEMPOTENCY_EXPIRED";
    pub const PENDING_CAPACITY: &str = "SNAPBACK_BUNDLE_PENDING_CAPACITY";
}

/// Hard limits — pinned defaults (LLP 0092 §0D.2). Server policy knobs.
pub const BUNDLE_MAX_QUERIES: usize = 32;
pub const BUNDLE_MAX_ROWS: usize = 5_000;
pub const BUNDLE_MAX_BYTES: usize = 4 * 1024 * 1024;
pub const BUNDLE_MAX_EVAL_MS: u64 = 2_000;
pub const BUNDLE_RATE_PER_MINUTE: usize = 60;

/// Attach grace, reaper cadence, and pending-owner bounds (LLP 0092 §0D.4).
pub const BUNDLE_ATTACH_GRACE_MS: u64 = 30_000;
pub const BUNDLE_PENDING_SWEEP_MS: u64 = 10_000;
pub const BUNDLE_MAX_PENDING_OWNERS: usize = 256;
pub const BUNDLE_MAX_PENDING_PER_AUTHORITY: usize = 8;

/// `POST /app/bundle` request (LLP 0092 §0D.1). `mode` stays a plain string
/// so an unknown mode refuses with the coded `SNAPBACK_BUNDLE_MODE_INVALID`
/// rather than an untyped serde rejection.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BundleRequest {
    /// Absent for LLP 0112 format-1 requests; exactly `2` for the mixed-route
    /// successor wire. This explicit discriminator prevents a v1 decoder from
    /// reinterpreting a mixed registration.
    #[serde(
        default,
        rename = "formatVersion",
        alias = "format_version",
        skip_serializing_if = "Option::is_none"
    )]
    pub format_version: Option<u32>,
    /// Exactly `mixed-route.v2` when `formatVersion` is 2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    /// LLP 0157 PlanHashV1 expected by the generated v2 reference.
    #[serde(
        default,
        rename = "planHash",
        alias = "plan_hash",
        skip_serializing_if = "Option::is_none"
    )]
    pub plan_hash: Option<String>,
    /// Exact manifest route pattern (LLP 0092 §0C.1) — matched by string
    /// equality against the served route manifest; the endpoint never does
    /// URL matching.
    pub route: String,
    /// Route params, all strings (percent-decoded segment values).
    #[serde(default)]
    pub params: BTreeMap<String, String>,
    /// `"read"` (default) or `"register"`.
    #[serde(default)]
    pub mode: Option<String>,
    /// Register mode only, required there: client-minted per boot attempt,
    /// 22-char base64url (16 random bytes).
    #[serde(
        default,
        rename = "idempotencyKey",
        alias = "idempotency_key",
        skip_serializing_if = "Option::is_none"
    )]
    pub idempotency_key: Option<String>,
    /// Register-mode connection negotiation. This is the same must-understand
    /// offer carried by `POST /connection/open`; a bundled connection must
    /// not silently lose the authorization-invalidation protocol that its
    /// adopted subscriptions require.
    #[serde(
        default,
        rename = "authInvalidationProtocol",
        alias = "auth_invalidation_protocol",
        skip_serializing_if = "Option::is_none"
    )]
    pub auth_invalidation_protocol: Option<u32>,
    /// One positional namespace per route child. Register-mode clients
    /// allocate these before the bundle cut so auth-scoped subscriptions can
    /// create LLP 0053 obligations atomically with their first rows.
    #[serde(
        default,
        rename = "authorizationNamespaces",
        alias = "authorization_namespaces",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub authorization_namespaces: Vec<Option<crate::auth::invalidation::QueryNamespace>>,
    /// Dev/test-only inline manifest entry, refused by design whenever a
    /// served route manifest exists for the app (ENG-25448/ENG-25454): with
    /// the cluster-0C authoring surface landed (`snapback/routes.mjs` →
    /// `routes.manifest.json`, LLP 0092 §0C.1), the served manifest is the
    /// only source of route entries; this inline form remains a
    /// library/test seam for instances that serve no route manifest.
    #[serde(
        default,
        rename = "devManifestEntry",
        alias = "dev_manifest_entry",
        skip_serializing_if = "Option::is_none"
    )]
    pub dev_manifest_entry: Option<BundleRouteEntry>,
    /// Dev-mode legacy body auth (the `app_function_route` carrier); ignored
    /// in sessions mode like every legacy body-auth field.
    #[serde(default)]
    pub auth: crate::manifest::AuthInput,
}

/// One route entry: every query the route needs — the unit the bundle
/// evaluates at one commit (LLP 0092 §0C.1).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BundleRouteEntry {
    /// Route pattern: `/`-separated static segments plus `:name` params.
    pub route: String,
    /// 1..=32 query specs (the 0D.2 query-count limit).
    pub queries: Vec<BundleQuerySpec>,
    /// LLP 0091 §0A.5 per-entry persist opt-out (default true); carried for
    /// schema completeness — the client store consumes it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persist: Option<bool>,
    /// Codegen-derived eligibility for LLP 0112 registered query-group
    /// adoption. It is true only for all-LiveQuery routes whose `$param`
    /// references target string args, so clients need not duplicate server
    /// route-parameter coercion before I/O.
    #[serde(
        default,
        rename = "registerGroupEligible",
        alias = "register_group_eligible",
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub register_group_eligible: bool,
    /// Codegen-derived successor eligibility: the route contains at least one
    /// Query and one LiveQuery and carries an exact LLP 0157 mixed plan.
    #[serde(
        default,
        rename = "mixedGroupEligible",
        alias = "mixed_group_eligible",
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub mixed_group_eligible: bool,
    #[serde(
        default,
        rename = "mixedProfile",
        alias = "mixed_profile",
        skip_serializing_if = "Option::is_none"
    )]
    pub mixed_profile: Option<MixedRouteProfileV2>,
}

/// Codegen-owned LLP 0157 identity carrier for one mixed route. The complete
/// normalized record stays JSON so it remains byte-for-byte the shared JCS
/// grammar rather than a second Rust spelling; admission below validates its
/// closed discriminators and every per-child capability binding.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MixedRouteProfileV2 {
    pub format_version: u32,
    pub profile: String,
    pub normalized_composite_plan: Value,
    pub plan_hash: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BundleQuerySpec {
    /// Exported function name in the served functions manifest.
    pub function: String,
    /// `params-v1` args mapping (LLP 0092 §0E.6): JSON literals plus
    /// `{"$param": "name"}` references.
    #[serde(default)]
    pub args: Value,
}

/// `POST /app/bundle` response (LLP 0092 §0D.1).
#[derive(Clone, Debug, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BundleResponse {
    /// Present exactly on the mixed successor wire; absent keeps format 1
    /// byte-compatible with LLP 0112.
    #[serde(
        default,
        rename = "formatVersion",
        skip_serializing_if = "Option::is_none"
    )]
    pub format_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    #[serde(default, rename = "planHash", skip_serializing_if = "Option::is_none")]
    pub plan_hash: Option<String>,
    /// Single shared commit version — every entry was evaluated at this cut.
    #[serde(rename = "commitVersion")]
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub commit_version: u64,
    pub generation: String,
    #[serde(rename = "versionStream")]
    pub version_stream: String,
    /// One per `querySpec`, manifest order.
    pub entries: Vec<BundleEntry>,
    /// Register mode only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection: Option<BundleConnection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aggregate: Option<MixedBundleAggregateV2>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MixedBundleAggregateV2 {
    pub kind: String,
    pub weakest: String,
    pub live_children: usize,
    pub read_only_children: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum MixedBundleDeliveryV2 {
    RegisteredLive {
        #[serde(rename = "nodePlanHash")]
        node_plan_hash: String,
    },
    ReadOnly {
        #[serde(rename = "nodePlanHash")]
        node_plan_hash: String,
    },
}

/// Per-entry closed union (LLP 0092 §0D.1): `resume` is present iff the
/// query is `rqsEligible` and explicitly `null` otherwise, in BOTH modes;
/// `subscriptionId` appears in register mode only; `authorization` appears
/// for register-mode auth-scoped entries only.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BundleEntry {
    pub function: String,
    /// Fully substituted, validated args.
    pub args: Value,
    pub rows: Vec<Value>,
    /// Always serialized (`null` for non-eligible entries) — the closed
    /// union's discriminating field.
    pub resume: Option<ResumeWire>,
    #[serde(
        default,
        rename = "subscriptionId",
        skip_serializing_if = "Option::is_none"
    )]
    pub subscription_id: Option<String>,
    /// LLP 0053 scope/invalidation projections for register-mode auth-scoped
    /// entries.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization: Option<BundleAuthorization>,
    /// Present exactly on format 2. This is the per-child delivery claim;
    /// rows alone never imply liveness.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery: Option<MixedBundleDeliveryV2>,
}

/// The exact LLP 0053 authorization projection adopted with a registered
/// child. Keeping this typed and closed prevents bundle boot from becoming a
/// looser wire dialect than ordinary live subscribe.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BundleAuthorization {
    pub scope: ScopeId,
    pub invalidation: Option<AuthorizationInvalidationProjection>,
}

/// Register-mode connection mint (LLP 0092 §0D.1/§0D.4).
#[derive(Clone, Debug, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BundleConnection {
    #[serde(rename = "connectionId")]
    pub connection_id: String,
    /// The connection-grant secret (`[secret]` response sensitivity).
    pub grant: String,
    /// Absolute server-clock ms deadline for socket attach.
    #[serde(rename = "attachDeadline")]
    pub attach_deadline: u64,
    /// The same negotiated authorization-invalidation connection descriptor
    /// returned by an ordinary connection open. Register-mode adoption needs
    /// it to install LLP 0053's authenticated expectation before the bundle
    /// rows become observable.
    ///
    /// @ref LLP 0112#registered-boot — auth-scoped registered children adopt
    /// the complete connection and per-child authorization projections.
    #[serde(
        default,
        rename = "authorizationInvalidation",
        skip_serializing_if = "Option::is_none"
    )]
    pub authorization_invalidation:
        Option<crate::auth::invalidation::AuthorizationInvalidationConnection>,
}

/// The served route→query manifest (LLP 0092 §0C.1): a schema-adjacent
/// declaration compiled by codegen (`snapback/routes.mjs` →
/// `snapback/generated/routes.manifest.json`) and admitted beside the
/// functions manifest through the same ensure machinery. Its canonical hash
/// is the `routeManifestHash` component of `resumeConfig` in `generation`
/// (LLP 0091 §0A.6).
///
/// @ref LLP 0092#0c1-routequery-manifest-artifact — the pinned artifact
///   schema, exact-pattern grammar, and admission obligations; a
///   route-manifest author selects queries for preload and can never widen
///   disclosure (`publicInline` is a function-level codegen fact, §0C.3).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RoutesManifest {
    /// Pinned `1`; implies the `params-v1` mapping grammar (LLP 0092 §0E.6).
    #[serde(rename = "formatVersion", alias = "format_version")]
    pub format_version: u32,
    pub app: String,
    pub routes: Vec<BundleRouteEntry>,
}

pub const ROUTES_MANIFEST_FORMAT_VERSION: u32 = 1;

/// Two v1 route patterns overlap when some concrete path matches both: same
/// segment count, and at every position the segments are equal statics or at
/// least one side is a `:param`. Both patterns must already be valid
/// (`route_pattern_params`).
pub fn route_patterns_overlap(a: &str, b: &str) -> bool {
    let split = |pattern: &str| -> Vec<String> {
        if pattern == "/" {
            Vec::new()
        } else {
            pattern[1..].split('/').map(str::to_owned).collect()
        }
    };
    let (a, b) = (split(a), split(b));
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .all(|(left, right)| left.starts_with(':') || right.starts_with(':') || left == right)
}

/// Structural validation of a routes manifest (LLP 0092 §0C.1): format
/// version, pattern grammar, per-entry query count, unambiguous patterns
/// (two entries that can match one path refuse), and the `params-v1` mapping
/// shape with every reference naming a pattern param. Validation against the
/// served functions manifest (function exists, is a query, references are
/// schema-typable) is the install-time half in `LocalSnapback`.
pub fn validate_routes_manifest_shape(manifest: &RoutesManifest) -> Result<(), String> {
    if manifest.format_version != ROUTES_MANIFEST_FORMAT_VERSION {
        return Err(format!(
            "unsupported routes manifest formatVersion {} (params-v1 is formatVersion 1)",
            manifest.format_version
        ));
    }
    if manifest.app.is_empty() {
        return Err("routes manifest app must be non-empty".to_owned());
    }
    for (index, entry) in manifest.routes.iter().enumerate() {
        let pattern_params = route_pattern_params(&entry.route)
            .map_err(|_| format!("route pattern {:?} is not a valid v1 pattern", entry.route))?;
        if entry.queries.is_empty() {
            return Err(format!("route {:?} declares no queries", entry.route));
        }
        if entry.queries.len() > BUNDLE_MAX_QUERIES {
            return Err(format!(
                "route {:?} declares {} queries; the limit is {BUNDLE_MAX_QUERIES}",
                entry.route,
                entry.queries.len()
            ));
        }
        if entry.register_group_eligible && entry.mixed_group_eligible {
            return Err(format!(
                "route {:?} cannot be both format-1 and mixed-group eligible",
                entry.route
            ));
        }
        if entry.mixed_group_eligible != entry.mixed_profile.is_some() {
            return Err(format!(
                "route {:?} must carry mixedProfile exactly when mixedGroupEligible is true",
                entry.route
            ));
        }
        for spec in &entry.queries {
            validate_mapping_references(&spec.args, &pattern_params).map_err(|_| {
                format!(
                    "route {:?} query {:?} has an invalid params-v1 args mapping",
                    entry.route, spec.function
                )
            })?;
        }
        for other in &manifest.routes[..index] {
            if route_patterns_overlap(&entry.route, &other.route) {
                return Err(format!(
                    "route patterns {:?} and {:?} can match the same path",
                    other.route, entry.route
                ));
            }
        }
    }
    Ok(())
}

/// Requested bundle mode after coded validation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BundleMode {
    Read,
    Register,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MixedChildAdmissionV2 {
    pub node_plan_hash: String,
    pub live: bool,
}

fn composition_hash(domain: &str, value: &Value) -> Result<String, &'static str> {
    let canonical = crate::rqs_contract::jcs(value).map_err(|_| code::ENTRY_INVALID)?;
    let mut digest = Sha256::new();
    digest.update(domain.as_bytes());
    digest.update(canonical.as_bytes());
    Ok(format!("sha256:{:x}", digest.finalize()))
}

fn exact_keys(value: &serde_json::Map<String, Value>, expected: &[&str]) -> bool {
    value.len() == expected.len() && expected.iter().all(|key| value.contains_key(*key))
}

/// Admit the v2 request against the codegen-carried LLP 0157 identity and
/// served function facts. No function runtime/plan shape participates in the
/// liveness decision: the exact capability binding says Query or LiveQuery,
/// and admission merely cross-checks that fact against the served export.
pub fn admit_mixed_profile_v2(
    entry: &BundleRouteEntry,
    request_format: Option<u32>,
    request_profile: Option<&str>,
    request_plan_hash: Option<&str>,
    function: impl Fn(&str) -> Option<crate::manifest::FunctionDefinition>,
) -> Result<Vec<MixedChildAdmissionV2>, &'static str> {
    if request_format != Some(2) || request_profile != Some("mixed-route.v2") {
        return Err(code::MODE_INVALID);
    }
    if !entry.mixed_group_eligible || entry.register_group_eligible {
        // diagnostics-registry: emission SNAPBACK_BUNDLE_ENTRY_INVALID
        return Err(code::ENTRY_INVALID);
    }
    let profile = entry.mixed_profile.as_ref().ok_or(code::ENTRY_INVALID)?;
    if profile.format_version != 2
        || profile.profile != "mixed-route.v2"
        || request_plan_hash != Some(profile.plan_hash.as_str())
    {
        return Err(code::ENTRY_INVALID);
    }
    if composition_hash("snapback:plan-hash:v1:", &profile.normalized_composite_plan)?
        != profile.plan_hash
    {
        return Err(code::ENTRY_INVALID);
    }
    let composite = profile
        .normalized_composite_plan
        .as_object()
        .ok_or(code::ENTRY_INVALID)?;
    if !exact_keys(
        composite,
        &[
            "format",
            "profileId",
            "nodes",
            "mergedArgsContractHash",
            "classification",
            "parentAuthorizationGroups",
        ],
    ) || composite.get("format").and_then(Value::as_str)
        != Some("snapback.normalized-composite-plan.v1")
        || composite.get("profileId").and_then(Value::as_str) != Some("mixed-route.v2")
        || composite.get("classification")
            != Some(&serde_json::json!({
                "callable": true,
                "live": { "kind": "none" },
                "invalidation": "none",
                "retention": "none",
            }))
        || composite.get("parentAuthorizationGroups") != Some(&Value::Array(Vec::new()))
    {
        return Err(code::ENTRY_INVALID);
    }
    let nodes = composite
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or(code::ENTRY_INVALID)?;
    if nodes.len() != entry.queries.len() {
        return Err(code::ENTRY_INVALID);
    }
    let merged_args = serde_json::json!({
        "format": "snapback.mixed-route-args.v2",
        "route": entry.route,
        "queries": entry.queries,
    });
    let expected_merged_args_hash =
        composition_hash("snapback:mixed-route-args:v2:", &merged_args)?;
    if composite
        .get("mergedArgsContractHash")
        .and_then(Value::as_str)
        != Some(expected_merged_args_hash.as_str())
    {
        return Err(code::ENTRY_INVALID);
    }
    let mut admitted = Vec::with_capacity(nodes.len());
    let mut saw_live = false;
    let mut saw_plain = false;
    for (position, (node, query)) in nodes.iter().zip(&entry.queries).enumerate() {
        let node = node.as_object().ok_or(code::ENTRY_INVALID)?;
        if !exact_keys(node, &["position", "nodePlan", "nodePlanHash"])
            || node.get("position").and_then(Value::as_u64) != Some(position as u64)
        {
            return Err(code::ENTRY_INVALID);
        }
        let node_plan = node.get("nodePlan").ok_or(code::ENTRY_INVALID)?;
        let node_plan_hash = node
            .get("nodePlanHash")
            .and_then(Value::as_str)
            .ok_or(code::ENTRY_INVALID)?;
        if composition_hash("snapback:node-plan:v1:", node_plan)? != node_plan_hash {
            return Err(code::ENTRY_INVALID);
        }
        let plan = node_plan.as_object().ok_or(code::ENTRY_INVALID)?;
        if !exact_keys(
            plan,
            &[
                "format",
                "classId",
                "classVersion",
                "normalizedPlan",
                "argumentBindings",
                "capability",
            ],
        ) || plan.get("format").and_then(Value::as_str) != Some("snapback.node-plan.v1")
            || plan.get("classId").and_then(Value::as_str) != Some("exported_query_v1")
            || plan.get("classVersion").and_then(Value::as_u64) != Some(1)
        {
            return Err(code::ENTRY_INVALID);
        }
        let served = function(&query.function).ok_or(code::ENTRY_INVALID)?;
        let served_json = serde_json::to_value(&served).map_err(|_| code::ENTRY_INVALID)?;
        let served_object = served_json.as_object().ok_or(code::ENTRY_INVALID)?;
        let expected_normalized = serde_json::json!({
            "format": "snapback.exported-query-plan.v1",
            "runtime": served_object.get("runtime").cloned().unwrap_or(Value::Null),
            "argsContractHash": served_object.get("argsContractHash").cloned().unwrap_or(Value::Null),
            "resultContractHash": served_object.get("resultContractHash").cloned().unwrap_or(Value::Null),
            "authRequirement": served_object.get("authRequirement").cloned().unwrap_or(Value::Null),
            "authorityIndependent": served.authority_independent,
            "authorizationDependence": served_object
                .get("authorizationDependence")
                .filter(|value| !value.is_null())
                .cloned()
                .unwrap_or_else(|| Value::Array(Vec::new())),
            "readSetSummary": served_object.get("readSetSummary").cloned().unwrap_or(Value::Null),
            "effectCeiling": served_object.get("effectCeiling").cloned().unwrap_or(Value::Null),
        });
        if plan.get("normalizedPlan") != Some(&expected_normalized) {
            return Err(code::ENTRY_INVALID);
        }
        let expected_bindings = served_object
            .get("argsContract")
            .and_then(|contract| contract.get("fields"))
            .and_then(Value::as_array)
            .ok_or(code::ENTRY_INVALID)?
            .iter()
            .map(|field| {
                let field = field.as_object().ok_or(code::ENTRY_INVALID)?;
                let name = field.get("name").cloned().ok_or(code::ENTRY_INVALID)?;
                let contract = serde_json::json!({
                    "format": "snapback.argument-binding-contract.v1",
                    "required": field.get("required").cloned().ok_or(code::ENTRY_INVALID)?,
                    "value": field.get("value").cloned().ok_or(code::ENTRY_INVALID)?,
                });
                Ok(serde_json::json!({
                    "name": name,
                    "contractHash": composition_hash(
                        "snapback:argument-binding-contract:v1:",
                        &contract,
                    )?,
                    "contract": contract,
                }))
            })
            .collect::<Result<Vec<_>, &'static str>>()?;
        if plan.get("argumentBindings") != Some(&Value::Array(expected_bindings)) {
            return Err(code::ENTRY_INVALID);
        }
        let capability = plan
            .get("capability")
            .and_then(Value::as_object)
            .ok_or(code::ENTRY_INVALID)?;
        if !exact_keys(
            capability,
            &["exportKind", "live", "retention", "requiredCapabilityIds"],
        ) {
            return Err(code::ENTRY_INVALID);
        }
        let live = match capability.get("exportKind").and_then(Value::as_str) {
            Some("Query") if served.kind == crate::manifest::FunctionKind::Query => {
                if capability.get("live") != Some(&serde_json::json!({ "kind": "none" })) {
                    return Err(code::ENTRY_INVALID);
                }
                saw_plain = true;
                false
            }
            Some("LiveQuery") if served.kind == crate::manifest::FunctionKind::LiveQuery => {
                if capability.get("live")
                    != Some(&serde_json::json!({
                        "kind": "admitted",
                        "delivery": "live_replace",
                        "pageDomain": "whole-result",
                    }))
                {
                    return Err(code::ENTRY_INVALID);
                }
                saw_live = true;
                true
            }
            _ => return Err(code::ENTRY_INVALID),
        };
        let mut capabilities = served.required_capabilities.clone();
        capabilities.sort();
        capabilities.dedup();
        let expected_retention = if served.retainable {
            served
                .retention_class
                .as_deref()
                .unwrap_or("opaque-authorized-snapshot-v1")
        } else {
            "none"
        };
        if capability.get("retention").and_then(Value::as_str) != Some(expected_retention) {
            return Err(code::ENTRY_INVALID);
        }
        if capability.get("requiredCapabilityIds")
            != Some(&serde_json::to_value(capabilities).map_err(|_| code::ENTRY_INVALID)?)
        {
            return Err(code::ENTRY_INVALID);
        }
        admitted.push(MixedChildAdmissionV2 {
            node_plan_hash: node_plan_hash.to_owned(),
            live,
        });
    }
    if !saw_live || !saw_plain {
        return Err(code::ENTRY_INVALID);
    }
    Ok(admitted)
}

/// Validate `mode` × `idempotencyKey` per LLP 0092 §0D.1: mode must be
/// `read`/`register`; the key is required in register mode, refused in read
/// mode, and must be the pinned 22-char base64url id shape.
pub fn validate_mode(
    mode: Option<&str>,
    idempotency_key: Option<&str>,
) -> Result<BundleMode, &'static str> {
    let mode = match mode {
        None | Some("read") => BundleMode::Read,
        Some("register") => BundleMode::Register,
        Some(_) => return Err(code::MODE_INVALID),
    };
    match (mode, idempotency_key) {
        (BundleMode::Read, None) => Ok(BundleMode::Read),
        (BundleMode::Read, Some(_)) => Err(code::MODE_INVALID),
        (BundleMode::Register, None) => Err(code::MODE_INVALID),
        (BundleMode::Register, Some(key)) => {
            if key.len() == 22
                && key
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
            {
                Ok(BundleMode::Register)
            } else {
                Err(code::MODE_INVALID)
            }
        }
    }
}

/// Parse a v1 route pattern (LLP 0092 §0C.1): `/`-separated static segments
/// plus `:name` params, each matching exactly one non-empty segment. No
/// wildcards, regexes, optional segments, or trailing-slash variants.
/// Returns the ordered param names.
pub fn route_pattern_params(pattern: &str) -> Result<Vec<String>, &'static str> {
    if pattern.is_empty() || !pattern.starts_with('/') {
        return Err(code::ENTRY_INVALID);
    }
    if pattern != "/" && pattern.ends_with('/') {
        return Err(code::ENTRY_INVALID);
    }
    let mut params = Vec::new();
    if pattern == "/" {
        return Ok(params);
    }
    for segment in pattern[1..].split('/') {
        if segment.is_empty() {
            return Err(code::ENTRY_INVALID);
        }
        if let Some(name) = segment.strip_prefix(':') {
            if name.is_empty()
                || !name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
            {
                return Err(code::ENTRY_INVALID);
            }
            if params.iter().any(|existing| existing == name) {
                return Err(code::ENTRY_INVALID);
            }
            params.push(name.to_owned());
        } else if segment.contains(':') {
            return Err(code::ENTRY_INVALID);
        }
    }
    Ok(params)
}

/// The decode type a `$param` reference's target arg takes (LLP 0092 §0E.6:
/// `string`, `number` — integer or float — or `boolean`; any other referenced
/// type refuses the entry).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RouteParamType {
    String,
    /// A `number` target backed by an integer-typed schema field: strict
    /// decimal integer decode within the ±(2^53 − 1) safe band.
    Integer,
    /// A `number` target backed by a real-typed schema field: strict decimal
    /// decode refused unless the value round-trips under the JCS number rules
    /// (LLP 0091 §0A.2), so `argsHash` stays well-defined.
    Number,
    Boolean,
}

/// Per-arg decode types for a query's route params. HostPlan queries retain
/// LLP 0092 §0E.6's schema-derived inference: every plan filter comparing a
/// schema field against `ValueExpr::Arg(name)` types that arg by the field's
/// schema type. JavaScript queries use the generated argument contract, which
/// is the served artifact's authoritative declaration for that runtime.
/// Conflicting, missing, and non-scalar types yield no entry (fail closed).
///
/// @ref LLP 0092#dated-amendment-depth-one-javascript-route-parameters-2026-08-10
///   — depth-one JavaScript positions use the same carried argsContract that
///   already types nested positions, closing the codegen/ensure seam without
///   reinterpreting HostPlan inference.
pub fn function_route_arg_types(
    function: &crate::manifest::FunctionDefinition,
    schema: &crate::manifest::SchemaManifest,
) -> BTreeMap<String, RouteParamType> {
    use crate::manifest::{FieldType, FunctionRuntime, HandlerPlan, ValueExpr};
    let mut types: BTreeMap<String, Option<RouteParamType>> = BTreeMap::new();
    let FunctionRuntime::HostPlan(HandlerPlan::Query(plan)) = &function.runtime else {
        if matches!(&function.runtime, FunctionRuntime::IbexModule(_)) {
            return function_nested_route_arg_types(function)
                .into_iter()
                .filter_map(|(path, target)| match path.as_slice() {
                    [name] => Some((name.clone(), target)),
                    _ => None,
                })
                .collect();
        }
        return BTreeMap::new();
    };
    let Some(table) = schema.tables.iter().find(|table| table.name == plan.table) else {
        return BTreeMap::new();
    };
    for filter in &plan.filters {
        let ValueExpr::Arg(name) = &filter.value else {
            continue;
        };
        let Some(field) = table.fields.iter().find(|field| field.name == filter.field) else {
            continue;
        };
        let inferred = match &field.field_type {
            FieldType::String
            | FieldType::Enum { .. }
            | FieldType::Principal
            | FieldType::Id { .. }
            | FieldType::RelationIncarnation { .. }
            | FieldType::AssetRef { .. } => Some(RouteParamType::String),
            FieldType::Integer => Some(RouteParamType::Integer),
            FieldType::Real => Some(RouteParamType::Number),
            FieldType::Boolean => Some(RouteParamType::Boolean),
            FieldType::Json | FieldType::Structured { .. } | FieldType::Vector { .. } => None,
        };
        match types.get(name.as_str()) {
            None => {
                types.insert(name.clone(), inferred);
            }
            Some(existing) if *existing == inferred => {}
            Some(_) => {
                // Conflicting inference: drop the arg from the typable set.
                types.insert(name.clone(), None);
            }
        }
    }
    types
        .into_iter()
        .filter_map(|(name, inferred)| inferred.map(|inferred| (name, inferred)))
        .collect()
}

/// Declaration-derived decode types for object-reachable route parameters.
/// The argument-contract root contributes paths of length one, and only
/// `Object` nodes extend a path; every non-scalar leaf fails closed.
///
/// @ref LLP 0092#dated-amendment-structured-route-group-arguments-2026-08-08
///   — LLP 0131's carried `argsContract` invalidated step 3's "no
///   manifest-carried arg schema" premise for object-reachable positions.
pub fn function_nested_route_arg_types(
    function: &crate::manifest::FunctionDefinition,
) -> BTreeMap<Vec<String>, RouteParamType> {
    use crate::manifest::{ResultObjectFieldContract, ResultValueContract};

    fn collect(
        fields: &[ResultObjectFieldContract],
        path: &mut Vec<String>,
        types: &mut BTreeMap<Vec<String>, RouteParamType>,
    ) {
        for field in fields {
            path.push(field.name.clone());
            let inferred = match &field.value {
                ResultValueContract::String { .. }
                | ResultValueContract::Principal
                | ResultValueContract::AssetRef
                | ResultValueContract::Id { .. } => Some(RouteParamType::String),
                ResultValueContract::Integer { .. } => Some(RouteParamType::Integer),
                ResultValueContract::FiniteReal { .. } => Some(RouteParamType::Number),
                ResultValueContract::Boolean => Some(RouteParamType::Boolean),
                ResultValueContract::Object { fields, .. } => {
                    collect(fields, path, types);
                    None
                }
                ResultValueContract::Null
                | ResultValueContract::Literal { .. }
                | ResultValueContract::Json { .. }
                | ResultValueContract::Array { .. }
                | ResultValueContract::Tuple { .. }
                | ResultValueContract::Vector { .. }
                | ResultValueContract::Union { .. }
                | ResultValueContract::MediaRefV1 { .. }
                | ResultValueContract::PlatformSchemaRef { .. } => None,
            };
            if let Some(inferred) = inferred {
                types.insert(path.clone(), inferred);
            }
            path.pop();
        }
    }

    let Some(contract) = function.args_contract.as_ref() else {
        return BTreeMap::new();
    };
    let mut types = BTreeMap::new();
    collect(&contract.fields, &mut Vec::new(), &mut types);
    types
}

/// Decode one percent-decoded route-param segment string by its target type
/// (LLP 0092 §0E.6 per-request substitution): `string` as-is; `number` by
/// strict decimal parse refused unless the value round-trips under the JCS
/// number rules; `boolean` by exact `"true"`/`"false"`.
pub fn decode_route_param(value: &str, target: RouteParamType) -> Result<Value, &'static str> {
    match target {
        RouteParamType::String => Ok(Value::String(value.to_owned())),
        RouteParamType::Boolean => match value {
            "true" => Ok(Value::Bool(true)),
            "false" => Ok(Value::Bool(false)),
            _ => Err(code::PARAMS_INVALID),
        },
        RouteParamType::Integer => {
            let parsed: i64 = value.parse().map_err(|_| code::PARAMS_INVALID)?;
            if parsed.abs() > 9_007_199_254_740_991 || parsed.to_string() != value {
                return Err(code::PARAMS_INVALID);
            }
            Ok(Value::Number(parsed.into()))
        }
        RouteParamType::Number => {
            let parsed: f64 = value.parse().map_err(|_| code::PARAMS_INVALID)?;
            let number = serde_json::Number::from_f64(parsed).ok_or(code::PARAMS_INVALID)?;
            let canonical = Value::Number(number);
            // JCS round-trip rule: the decoded value's canonical serialization
            // must reproduce the presented segment exactly, so `argsHash` is
            // well-defined (LLP 0091 §0A.2).
            match crate::rqs_contract::jcs(&canonical) {
                Ok(serialized) if serialized == value => Ok(canonical),
                _ => Err(code::PARAMS_INVALID),
            }
        }
    }
}

/// `params-v1` substitution (LLP 0092 §0E.6): the mapping is a JSON value
/// mirroring the args shape where every node is either a literal or a
/// `{"$param": "name"}` reference. References decode by their target arg's
/// schema-driven type. Depth-1 positions use [`function_route_arg_types`]
/// unchanged; deeper object-reachable positions use
/// [`function_nested_route_arg_types`]. References inside arrays and at the
/// mapping root remain untypable and refuse.
///
/// Request params must exactly cover the pattern's names: a request naming
/// a missing or extra param refuses `SNAPBACK_BUNDLE_PARAMS_INVALID`.
pub fn substitute_params_v1(
    mapping: &Value,
    params: &BTreeMap<String, String>,
    arg_types: &BTreeMap<String, RouteParamType>,
    nested_arg_types: &BTreeMap<Vec<String>, RouteParamType>,
) -> Result<Value, &'static str> {
    fn substitute(
        value: &Value,
        params: &BTreeMap<String, String>,
        arg_types: &BTreeMap<String, RouteParamType>,
        nested_arg_types: &BTreeMap<Vec<String>, RouteParamType>,
        path: &mut Vec<String>,
        inside_array: bool,
    ) -> Result<Value, &'static str> {
        match value {
            Value::Object(map) => {
                if map.contains_key("$param") {
                    // The root has no named arg target, and array interiors
                    // remain literal-only even when they contain objects.
                    if path.is_empty() || inside_array || map.len() != 1 {
                        return Err(code::PARAMS_INVALID);
                    }
                    let Some(Value::String(name)) = map.get("$param") else {
                        return Err(code::PARAMS_INVALID);
                    };
                    let raw = params.get(name).ok_or(code::PARAMS_INVALID)?;
                    let target = if path.len() == 1 {
                        arg_types.get(path[0].as_str())
                    } else {
                        nested_arg_types.get(path)
                    }
                    .copied()
                    .ok_or(code::PARAMS_INVALID)?;
                    return decode_route_param(raw, target);
                }
                let mut output = serde_json::Map::new();
                for (key, inner) in map {
                    path.push(key.clone());
                    let inner = substitute(
                        inner,
                        params,
                        arg_types,
                        nested_arg_types,
                        path,
                        inside_array,
                    )?;
                    path.pop();
                    output.insert(key.clone(), inner);
                }
                Ok(Value::Object(output))
            }
            Value::Array(items) => Ok(Value::Array(
                items
                    .iter()
                    .map(|item| substitute(item, params, arg_types, nested_arg_types, path, true))
                    .collect::<Result<Vec<_>, _>>()?,
            )),
            literal => Ok(literal.clone()),
        }
    }

    substitute(
        mapping,
        params,
        arg_types,
        nested_arg_types,
        &mut Vec::new(),
        false,
    )
}

/// Validate that the request's params exactly match the route pattern's
/// param names (missing or extra params refuse) and that every referenced
/// `$param` in the entry's mappings names a pattern param.
pub fn validate_entry_against_params(
    entry: &BundleRouteEntry,
    request_route: &str,
    params: &BTreeMap<String, String>,
) -> Result<(), &'static str> {
    if entry.route != request_route {
        return Err(code::ROUTE_UNKNOWN);
    }
    let pattern_params = route_pattern_params(&entry.route)?;
    if entry.queries.is_empty() {
        return Err(code::ENTRY_INVALID);
    }
    if entry.queries.len() > BUNDLE_MAX_QUERIES {
        // diagnostics-registry: emission SNAPBACK_BUNDLE_LIMIT_QUERIES
        return Err(code::LIMIT_QUERIES);
    }
    for name in params.keys() {
        if !pattern_params.iter().any(|param| param == name) {
            return Err(code::PARAMS_INVALID);
        }
    }
    for name in &pattern_params {
        if !params.contains_key(name) {
            return Err(code::PARAMS_INVALID);
        }
    }
    for spec in &entry.queries {
        validate_mapping_references(&spec.args, &pattern_params)?;
    }
    Ok(())
}

fn validate_mapping_references(
    mapping: &Value,
    pattern_params: &[String],
) -> Result<(), &'static str> {
    fn validate(
        value: &Value,
        pattern_params: &[String],
        at_root: bool,
        inside_array: bool,
    ) -> Result<(), &'static str> {
        match value {
            Value::Object(map) => {
                if map.contains_key("$param") {
                    if at_root || inside_array || map.len() != 1 {
                        return Err(code::PARAMS_INVALID);
                    }
                    let Some(Value::String(name)) = map.get("$param") else {
                        return Err(code::PARAMS_INVALID);
                    };
                    if !pattern_params.iter().any(|param| param == name) {
                        return Err(code::PARAMS_INVALID);
                    }
                    return Ok(());
                }
                for inner in map.values() {
                    validate(inner, pattern_params, false, inside_array)?;
                }
                Ok(())
            }
            Value::Array(items) => {
                for item in items {
                    validate(item, pattern_params, false, true)?;
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }
    validate(mapping, pattern_params, true, false)
}

/// The replay-validity tuple of the LLP 0031 dated amendment: (authority,
/// sender-key identity, credential incarnation, `generation`, manifest
/// entry, canonical args, connection protocol, per-child authorization
/// namespaces). On a hosted sender-constrained request, sender identity is
/// the verified RFC 7638 JWK thumbprint and incarnation is the durable
/// `sender_replay_epoch`; other credential families retain their native
/// resolved-authority identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BundleReplayScope {
    pub authority_key: String,
    pub sender_identity: String,
    pub credential_incarnation: u64,
    pub generation: String,
    pub entry_identity: String,
    pub args_identity: String,
    pub auth_invalidation_protocol: Option<u32>,
    pub authorization_namespaces: Vec<Option<QueryNamespace>>,
    pub wire_format_version: Option<u32>,
    pub wire_profile: Option<String>,
    pub plan_hash: Option<String>,
}

/// One pending-registration owner (LLP 0031 amendment): the bounded server
/// owner of a register-mode registration set awaiting socket attach.
#[derive(Clone, Debug)]
pub struct PendingRegistrationOwner {
    pub idempotency_key: String,
    pub scope: BundleReplayScope,
    pub connection_id: String,
    pub grant_id: String,
    pub subscription_ids: Vec<String>,
    pub attach_deadline_ms: u64,
}

/// Terminal states a consumed idempotency key can be found in
/// (`SNAPBACK_BUNDLE_IDEMPOTENCY_EXPIRED` on replay after either).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PendingResolution {
    Attached,
    Reaped,
}

/// Outcome of `begin_register` for a presented idempotency key.
#[derive(Clone, Debug)]
pub enum RegisterAdmission {
    /// No pending owner holds this key; a reservation was installed. The
    /// caller must `commit_register` or `abandon_register` it.
    New,
    /// A live pending owner holds this key with a matching replay tuple:
    /// the retry atomically supersedes it (fresh evaluation, same connection
    /// identity, rotated grant secret — the LLP 0031 amendment).
    Replay {
        connection_id: String,
        grant_id: String,
    },
}

/// Socket-attach outcome for a connection id.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AttachOutcome {
    /// The connection has no pending owner — an ordinary socket attach.
    NotPending,
    /// Attach inside the grace window: the pending registrations hand off to
    /// the socket session and the idempotency key's replay validity ends.
    Attached,
    /// Attach after `attachDeadline` — enforcement is exact at attach
    /// (LLP 0092 §0D.4): the caller must reap and refuse the socket.
    Expired { grant_id: String },
}

const RESOLVED_TOMBSTONE_CAP: usize = 4_096;

#[derive(Default)]
struct PendingBundleState {
    by_key: std::collections::HashMap<String, PendingRegistrationOwner>,
    by_connection: std::collections::HashMap<String, String>,
    resolved: std::collections::HashMap<String, PendingResolution>,
    resolved_order: std::collections::VecDeque<String>,
    rate: std::collections::HashMap<String, std::collections::VecDeque<u64>>,
}

/// Process-local pending-registration-owner registry and per-authority bundle
/// rate limiter (LLP 0092 §0D.2/§0D.4; LLP 0031 dated amendment). Bounded:
/// at most [`BUNDLE_MAX_PENDING_OWNERS`] owners per instance and
/// [`BUNDLE_MAX_PENDING_PER_AUTHORITY`] per authority; consumed idempotency
/// keys leave bounded tombstones so a late replay refuses
/// `SNAPBACK_BUNDLE_IDEMPOTENCY_EXPIRED` rather than minting a duplicate.
#[derive(Clone, Default)]
pub struct PendingBundleRegistry(std::sync::Arc<std::sync::Mutex<PendingBundleState>>);

impl PendingBundleRegistry {
    fn lock(&self) -> std::sync::MutexGuard<'_, PendingBundleState> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Per-authority bundle request rate (60/min). Anonymous callers share
    /// one interim bucket — per-client-address keying is LLP 0092 OQ-A, an
    /// implementation-time per-arm decision this step leaves open.
    pub fn admit_rate(&self, authority_key: &str, now_ms: u64) -> Result<(), &'static str> {
        let mut state = self.lock();
        let window = state.rate.entry(authority_key.to_owned()).or_default();
        while window
            .front()
            .is_some_and(|at| now_ms.saturating_sub(*at) >= 60_000)
        {
            window.pop_front();
        }
        if window.len() >= BUNDLE_RATE_PER_MINUTE {
            return Err(code::RATE_LIMITED);
        }
        window.push_back(now_ms);
        Ok(())
    }

    /// Admit a register-mode idempotency key: replay-tuple validation plus
    /// the pending-owner capacity bounds. `New` installs a reservation the
    /// caller must commit or abandon.
    pub fn begin_register(
        &self,
        key: &str,
        scope: &BundleReplayScope,
    ) -> Result<RegisterAdmission, &'static str> {
        let mut state = self.lock();
        if state.resolved.contains_key(key) {
            // diagnostics-registry: emission SNAPBACK_BUNDLE_IDEMPOTENCY_EXPIRED
            return Err(code::IDEMPOTENCY_EXPIRED);
        }
        if let Some(owner) = state.by_key.get(key) {
            if owner.scope.sender_identity != scope.sender_identity
                || owner.scope.credential_incarnation != scope.credential_incarnation
            {
                // diagnostics-registry: emission SNAPBACK_BUNDLE_IDEMPOTENCY_SENDER_MISMATCH
                return Err(code::IDEMPOTENCY_SENDER_MISMATCH);
            }
            if owner.scope != *scope {
                // diagnostics-registry: emission SNAPBACK_BUNDLE_IDEMPOTENCY_SCOPE_MISMATCH
                return Err(code::IDEMPOTENCY_SCOPE_MISMATCH);
            }
            if owner.subscription_ids.is_empty() && owner.attach_deadline_ms == u64::MAX {
                // A reservation for the same key is still evaluating; refuse
                // transiently rather than superseding an in-flight mint.
                // diagnostics-registry: emission SNAPBACK_BUNDLE_PENDING_CAPACITY
                return Err(code::PENDING_CAPACITY);
            }
            return Ok(RegisterAdmission::Replay {
                connection_id: owner.connection_id.clone(),
                grant_id: owner.grant_id.clone(),
            });
        }
        if state.by_key.len() >= BUNDLE_MAX_PENDING_OWNERS {
            return Err(code::PENDING_CAPACITY);
        }
        let per_authority = state
            .by_key
            .values()
            .filter(|owner| owner.scope.authority_key == scope.authority_key)
            .count();
        if per_authority >= BUNDLE_MAX_PENDING_PER_AUTHORITY {
            return Err(code::PENDING_CAPACITY);
        }
        state.by_key.insert(
            key.to_owned(),
            PendingRegistrationOwner {
                idempotency_key: key.to_owned(),
                scope: scope.clone(),
                connection_id: String::new(),
                grant_id: String::new(),
                subscription_ids: Vec::new(),
                attach_deadline_ms: u64::MAX,
            },
        );
        Ok(RegisterAdmission::New)
    }

    /// Publish a successful mint (or a successful superseding retry) under
    /// its key: the owner becomes reapable at `attach_deadline_ms`.
    pub fn commit_register(&self, owner: PendingRegistrationOwner) {
        let mut state = self.lock();
        state
            .by_connection
            .insert(owner.connection_id.clone(), owner.idempotency_key.clone());
        state.by_key.insert(owner.idempotency_key.clone(), owner);
    }

    /// Drop a reservation whose mint failed — a failed bundle strands no
    /// pending state.
    pub fn abandon_register(&self, key: &str) {
        let mut state = self.lock();
        if let Some(owner) = state.by_key.get(key)
            && owner.subscription_ids.is_empty()
            && owner.attach_deadline_ms == u64::MAX
        {
            state.by_key.remove(key);
        }
    }

    fn resolve_locked(state: &mut PendingBundleState, key: String, resolution: PendingResolution) {
        if let Some(owner) = state.by_key.remove(&key) {
            state.by_connection.remove(&owner.connection_id);
        }
        if state.resolved.insert(key.clone(), resolution).is_none() {
            state.resolved_order.push_back(key);
            while state.resolved_order.len() > RESOLVED_TOMBSTONE_CAP {
                if let Some(oldest) = state.resolved_order.pop_front() {
                    state.resolved.remove(&oldest);
                }
            }
        }
    }

    /// Socket attach for `connection_id`. Inside the grace window the owner
    /// resolves Attached (replay validity ends — atomic handoff); past the
    /// deadline the caller must reap and refuse the socket.
    pub fn mark_attached(&self, connection_id: &str, now_ms: u64) -> AttachOutcome {
        let mut state = self.lock();
        let Some(key) = state.by_connection.get(connection_id).cloned() else {
            return AttachOutcome::NotPending;
        };
        let Some(owner) = state.by_key.get(&key) else {
            return AttachOutcome::NotPending;
        };
        if now_ms > owner.attach_deadline_ms {
            let grant_id = owner.grant_id.clone();
            Self::resolve_locked(&mut state, key, PendingResolution::Reaped);
            return AttachOutcome::Expired { grant_id };
        }
        Self::resolve_locked(&mut state, key, PendingResolution::Attached);
        AttachOutcome::Attached
    }

    /// Reap every owner past its deadline (the ≤10 s sweep of LLP 0092
    /// §0D.4). Returns the (connection, grant) identities the caller must
    /// tear down — demand disarmed, capacity released, grant invalidated.
    pub fn sweep(&self, now_ms: u64) -> Vec<(String, String)> {
        let mut state = self.lock();
        let expired: Vec<String> = state
            .by_key
            .values()
            .filter(|owner| {
                owner.attach_deadline_ms != u64::MAX && now_ms > owner.attach_deadline_ms
            })
            .map(|owner| owner.idempotency_key.clone())
            .collect();
        let mut reaped = Vec::with_capacity(expired.len());
        for key in expired {
            if let Some(owner) = state.by_key.get(&key) {
                reaped.push((owner.connection_id.clone(), owner.grant_id.clone()));
            }
            Self::resolve_locked(&mut state, key, PendingResolution::Reaped);
        }
        reaped
    }

    /// Terminally resolve a key (used when a superseding retry fails after
    /// the prior pending set was already purged — the client starts a fresh
    /// boot attempt with a new key).
    pub fn resolve_key(&self, key: &str, resolution: PendingResolution) {
        let mut state = self.lock();
        Self::resolve_locked(&mut state, key.to_owned(), resolution);
    }

    /// The number of live pending owners (observability/tests).
    pub fn pending_len(&self) -> usize {
        self.lock()
            .by_key
            .values()
            .filter(|owner| owner.attach_deadline_ms != u64::MAX)
            .count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn mixed_test_function(
        name: &str,
        kind: crate::manifest::FunctionKind,
    ) -> crate::manifest::FunctionDefinition {
        let mut function = crate::manifest::FunctionDefinition::new(
            name,
            kind,
            crate::manifest::FunctionRuntime::HostPlan(crate::manifest::HandlerPlan::Query(
                crate::manifest::QueryPlan {
                    table_visibility: None,
                    table: "items".to_owned(),
                    filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    membership_filters: Vec::new(),
                    indexed_by: None,
                },
            )),
        );
        function.args_contract = Some(crate::manifest::FunctionArgsContract::default());
        function
    }

    /// Reproduce the codegen side of LLP 0157 NodePlanRecordV1 in the host
    /// acceptance. Keeping this producer independent from admission catches a
    /// casing/default/domain mismatch before a real generated route is served.
    fn generated_mixed_node(function: &crate::manifest::FunctionDefinition) -> Value {
        let served = serde_json::to_value(function).expect("serialize served function");
        let served = served.as_object().expect("served function object");
        let argument_bindings = served["argsContract"]["fields"]
            .as_array()
            .expect("argument fields")
            .iter()
            .map(|field| {
                let contract = json!({
                    "format": "snapback.argument-binding-contract.v1",
                    "required": field["required"],
                    "value": field["value"],
                });
                json!({
                    "name": field["name"],
                    "contractHash": composition_hash(
                        "snapback:argument-binding-contract:v1:",
                        &contract,
                    ).expect("argument contract hash"),
                    "contract": contract,
                })
            })
            .collect::<Vec<_>>();
        let mut required_capabilities = function.required_capabilities.clone();
        required_capabilities.sort();
        required_capabilities.dedup();
        let live = match function.kind {
            crate::manifest::FunctionKind::LiveQuery => json!({
                "kind": "admitted",
                "delivery": "live_replace",
                "pageDomain": "whole-result",
            }),
            crate::manifest::FunctionKind::Query => json!({ "kind": "none" }),
            _ => panic!("mixed fixture must be a query"),
        };
        let export_kind = match function.kind {
            crate::manifest::FunctionKind::LiveQuery => "LiveQuery",
            crate::manifest::FunctionKind::Query => "Query",
            _ => unreachable!(),
        };
        let node_plan = json!({
            "format": "snapback.node-plan.v1",
            "classId": "exported_query_v1",
            "classVersion": 1,
            "normalizedPlan": {
                "format": "snapback.exported-query-plan.v1",
                "runtime": served.get("runtime").cloned().unwrap_or(Value::Null),
                "argsContractHash": served.get("argsContractHash").cloned().unwrap_or(Value::Null),
                "resultContractHash": served.get("resultContractHash").cloned().unwrap_or(Value::Null),
                "authRequirement": served.get("authRequirement").cloned().unwrap_or(Value::Null),
                "authorityIndependent": function.authority_independent,
                "authorizationDependence": served
                    .get("authorizationDependence")
                    .filter(|value| !value.is_null())
                    .cloned()
                    .unwrap_or_else(|| Value::Array(Vec::new())),
                "readSetSummary": served.get("readSetSummary").cloned().unwrap_or(Value::Null),
                "effectCeiling": served.get("effectCeiling").cloned().unwrap_or(Value::Null),
            },
            "argumentBindings": argument_bindings,
            "capability": {
                "exportKind": export_kind,
                "live": live,
                "retention": if function.retainable {
                    function
                        .retention_class
                        .as_deref()
                        .unwrap_or("opaque-authorized-snapshot-v1")
                } else {
                    "none"
                },
                "requiredCapabilityIds": required_capabilities,
            },
        });
        json!({
            "nodePlanHash": composition_hash("snapback:node-plan:v1:", &node_plan)
                .expect("node plan hash"),
            "nodePlan": node_plan,
        })
    }

    #[test]
    fn mixed_profile_admission_rebuilds_codegen_identity_and_route_args_hash() {
        let live = mixed_test_function("liveItems", crate::manifest::FunctionKind::LiveQuery);
        let plain = mixed_test_function("plainItems", crate::manifest::FunctionKind::Query);
        let queries = vec![
            BundleQuerySpec {
                function: live.name.clone(),
                args: json!({}),
            },
            BundleQuerySpec {
                function: plain.name.clone(),
                args: json!({}),
            },
        ];
        let nodes = [&live, &plain]
            .into_iter()
            .enumerate()
            .map(|(position, function)| {
                let identity = generated_mixed_node(function);
                json!({
                    "position": position,
                    "nodePlan": identity["nodePlan"],
                    "nodePlanHash": identity["nodePlanHash"],
                })
            })
            .collect::<Vec<_>>();
        let merged_args = json!({
            "format": "snapback.mixed-route-args.v2",
            "route": "/mixed",
            "queries": queries,
        });
        let normalized_composite_plan = json!({
            "format": "snapback.normalized-composite-plan.v1",
            "profileId": "mixed-route.v2",
            "nodes": nodes,
            "mergedArgsContractHash": composition_hash(
                "snapback:mixed-route-args:v2:",
                &merged_args,
            ).expect("merged route args hash"),
            "classification": {
                "callable": true,
                "live": { "kind": "none" },
                "invalidation": "none",
                "retention": "none",
            },
            "parentAuthorizationGroups": [],
        });
        let plan_hash = composition_hash("snapback:plan-hash:v1:", &normalized_composite_plan)
            .expect("plan hash");
        let entry = BundleRouteEntry {
            route: "/mixed".to_owned(),
            queries,
            persist: None,
            register_group_eligible: false,
            mixed_group_eligible: true,
            mixed_profile: Some(MixedRouteProfileV2 {
                format_version: 2,
                profile: "mixed-route.v2".to_owned(),
                normalized_composite_plan,
                plan_hash: plan_hash.clone(),
            }),
        };
        let functions = [live, plain];
        let admitted = admit_mixed_profile_v2(
            &entry,
            Some(2),
            Some("mixed-route.v2"),
            Some(&plan_hash),
            |name| {
                functions
                    .iter()
                    .find(|function| function.name == name)
                    .cloned()
            },
        )
        .expect("codegen identity admits");
        assert_eq!(
            admitted.iter().map(|child| child.live).collect::<Vec<_>>(),
            vec![true, false]
        );

        // A caller can recompute PlanHashV1 around a forged opaque merged hash;
        // host reconstruction of the route mapping must still refuse it.
        let mut forged = entry.clone();
        let forged_profile = forged.mixed_profile.as_mut().expect("mixed profile");
        forged_profile.normalized_composite_plan["mergedArgsContractHash"] =
            json!(format!("sha256:{}", "0".repeat(64)));
        forged_profile.plan_hash = composition_hash(
            "snapback:plan-hash:v1:",
            &forged_profile.normalized_composite_plan,
        )
        .expect("forged outer plan hash");
        let forged_plan_hash = forged_profile.plan_hash.clone();
        assert_eq!(
            admit_mixed_profile_v2(
                &forged,
                Some(2),
                Some("mixed-route.v2"),
                Some(&forged_plan_hash),
                |name| functions
                    .iter()
                    .find(|function| function.name == name)
                    .cloned(),
            ),
            Err(code::ENTRY_INVALID)
        );
    }

    #[test]
    fn mode_validation_is_coded() {
        assert_eq!(validate_mode(None, None), Ok(BundleMode::Read));
        assert_eq!(validate_mode(Some("read"), None), Ok(BundleMode::Read));
        assert_eq!(
            validate_mode(Some("register"), Some("AAAAAAAAAAAAAAAAAAAAAA")),
            Ok(BundleMode::Register)
        );
        // Unknown mode, key in read mode, missing/malformed key in register.
        assert_eq!(validate_mode(Some("write"), None), Err(code::MODE_INVALID));
        assert_eq!(
            validate_mode(None, Some("AAAAAAAAAAAAAAAAAAAAAA")),
            Err(code::MODE_INVALID)
        );
        assert_eq!(
            validate_mode(Some("register"), None),
            Err(code::MODE_INVALID)
        );
        assert_eq!(
            validate_mode(Some("register"), Some("short")),
            Err(code::MODE_INVALID)
        );
        assert_eq!(
            validate_mode(Some("register"), Some("has spaces? not base64url!")),
            Err(code::MODE_INVALID)
        );
    }

    #[test]
    fn bundle_nested_request_shapes_are_closed() {
        let route_unknown = json!({
            "route": "/home",
            "queries": [],
            "unexpected": true,
        });
        assert!(
            serde_json::from_value::<BundleRouteEntry>(route_unknown).is_err(),
            "route entries must reject unknown fields",
        );
        let query_unknown = json!({
            "function": "listPosts",
            "args": {},
            "unexpected": true,
        });
        assert!(
            serde_json::from_value::<BundleQuerySpec>(query_unknown).is_err(),
            "query specs must reject unknown fields",
        );

        let entry = BundleEntry {
            function: "listTodos".to_owned(),
            args: json!({}),
            rows: Vec::new(),
            resume: None,
            subscription_id: Some("sub-1".to_owned()),
            authorization: Some(BundleAuthorization {
                scope: ScopeId::ClientQuery {
                    namespace: QueryNamespace {
                        client_store_id: "store-a".to_owned(),
                        query_key: "listTodos:{}".to_owned(),
                        query_instance_id: 1,
                    },
                },
                invalidation: None,
            }),
            delivery: None,
        };
        let mut encoded = serde_json::to_value(entry).expect("serialize typed authorization");
        serde_json::from_value::<BundleEntry>(encoded.clone())
            .expect("typed authorization round-trips");
        encoded["authorization"]["unexpected"] = json!(true);
        assert!(
            serde_json::from_value::<BundleEntry>(encoded).is_err(),
            "authorization projections must reject unknown fields",
        );
    }

    #[test]
    fn replay_scope_binds_connection_protocol_and_authorization_namespaces() {
        let registry = PendingBundleRegistry::default();
        let base = BundleReplayScope {
            authority_key: "session:user-1".to_owned(),
            sender_identity: "jkt:sender-a".to_owned(),
            credential_incarnation: 7,
            generation: "gen1:test".to_owned(),
            entry_identity: "entry-a".to_owned(),
            args_identity: "args-a".to_owned(),
            auth_invalidation_protocol: None,
            authorization_namespaces: Vec::new(),
            wire_format_version: None,
            wire_profile: None,
            plan_hash: None,
        };
        assert!(matches!(
            registry.begin_register("AAAAAAAAAAAAAAAAAAAAAA", &base),
            Ok(RegisterAdmission::New)
        ));

        let mut changed_protocol = base.clone();
        changed_protocol.auth_invalidation_protocol = Some(1);
        assert!(matches!(
            registry.begin_register("AAAAAAAAAAAAAAAAAAAAAA", &changed_protocol),
            Err(code::IDEMPOTENCY_SCOPE_MISMATCH)
        ));

        let mut changed_namespace = base;
        changed_namespace.authorization_namespaces = vec![Some(QueryNamespace {
            client_store_id: "store-a".to_owned(),
            query_key: "listPosts:{}".to_owned(),
            query_instance_id: 1,
        })];
        assert!(matches!(
            registry.begin_register("AAAAAAAAAAAAAAAAAAAAAA", &changed_namespace),
            Err(code::IDEMPOTENCY_SCOPE_MISMATCH)
        ));
    }

    #[test]
    fn route_patterns_are_exact_v1_shapes() {
        assert_eq!(route_pattern_params("/").unwrap(), Vec::<String>::new());
        assert_eq!(
            route_pattern_params("/board/:boardId").unwrap(),
            vec!["boardId".to_owned()]
        );
        assert_eq!(
            route_pattern_params("/a/:x/b/:y").unwrap(),
            vec!["x".to_owned(), "y".to_owned()]
        );
        for bad in [
            "",
            "board",
            "/board/",
            "/board//x",
            "/board/:",
            "/board/:a:b",
            "/board/:x/:x",
            "/board/:bad-name",
        ] {
            assert!(route_pattern_params(bad).is_err(), "{bad:?} must refuse");
        }
    }

    #[test]
    fn params_v1_substitution_and_refusals() {
        let params: BTreeMap<String, String> = [("boardId".to_owned(), "b-7".to_owned())]
            .into_iter()
            .collect();
        let types: BTreeMap<String, RouteParamType> =
            [("board".to_owned(), RouteParamType::String)]
                .into_iter()
                .collect();
        let nested_types: BTreeMap<Vec<String>, RouteParamType> = [(
            vec!["context".to_owned(), "board".to_owned()],
            RouteParamType::String,
        )]
        .into_iter()
        .collect();
        let mapping = json!({ "board": { "$param": "boardId" }, "limit": 5, "tags": ["a", "b"] });
        assert_eq!(
            substitute_params_v1(&mapping, &params, &types, &nested_types).unwrap(),
            json!({ "board": "b-7", "limit": 5, "tags": ["a", "b"] })
        );
        assert_eq!(
            substitute_params_v1(
                &json!({ "context": { "board": { "$param": "boardId" } } }),
                &params,
                &types,
                &nested_types,
            )
            .unwrap(),
            json!({ "context": { "board": "b-7" } })
        );
        // Array interiors remain literal-only.
        assert_eq!(
            substitute_params_v1(
                &json!({ "tags": ["a", { "$param": "boardId" }] }),
                &params,
                &types,
                &nested_types,
            ),
            Err(code::PARAMS_INVALID)
        );
        // $param alongside other keys / non-string reference / unknown param /
        // untyped target arg.
        assert_eq!(
            substitute_params_v1(
                &json!({ "$param": "boardId", "x": 1 }),
                &params,
                &types,
                &nested_types,
            ),
            Err(code::PARAMS_INVALID)
        );
        assert_eq!(
            substitute_params_v1(
                &json!({ "board": { "$param": 3 } }),
                &params,
                &types,
                &nested_types,
            ),
            Err(code::PARAMS_INVALID)
        );
        assert_eq!(
            substitute_params_v1(
                &json!({ "board": { "$param": "missing" } }),
                &params,
                &types,
                &nested_types,
            ),
            Err(code::PARAMS_INVALID)
        );
        assert_eq!(
            substitute_params_v1(
                &json!({ "untyped": { "$param": "boardId" } }),
                &params,
                &types,
                &nested_types,
            ),
            Err(code::PARAMS_INVALID)
        );
    }

    #[test]
    fn typed_route_param_decode_is_strict() {
        use super::RouteParamType as T;
        assert_eq!(decode_route_param("b-7", T::String), Ok(json!("b-7")));
        assert_eq!(decode_route_param("true", T::Boolean), Ok(json!(true)));
        assert_eq!(decode_route_param("false", T::Boolean), Ok(json!(false)));
        for bad in ["True", "1", "", "yes"] {
            assert_eq!(
                decode_route_param(bad, T::Boolean),
                Err(code::PARAMS_INVALID)
            );
        }
        assert_eq!(decode_route_param("42", T::Integer), Ok(json!(42)));
        assert_eq!(decode_route_param("-7", T::Integer), Ok(json!(-7)));
        // Non-canonical, non-integral, over-band, or junk decimal forms refuse
        // (the JCS round-trip rule keeps argsHash well-defined).
        for bad in ["042", "1.5", "+1", "1e3", "9007199254740992", ""] {
            assert_eq!(
                decode_route_param(bad, T::Integer),
                Err(code::PARAMS_INVALID)
            );
        }
        assert_eq!(decode_route_param("1.5", T::Number), Ok(json!(1.5)));
        assert_eq!(decode_route_param("42", T::Number), Ok(json!(42.0)));
        for bad in ["1.50", "NaN", "Infinity", "0.10000000000000000001x", ""] {
            assert_eq!(
                decode_route_param(bad, T::Number),
                Err(code::PARAMS_INVALID)
            );
        }
    }

    #[test]
    fn routes_manifest_shape_validation() {
        let entry = |route: &str| BundleRouteEntry {
            route: route.to_owned(),
            queries: vec![BundleQuerySpec {
                function: "listCells".to_owned(),
                args: json!({ "boardId": { "$param": "boardId" } }),
            }],
            persist: None,
            register_group_eligible: false,
            mixed_group_eligible: false,
            mixed_profile: None,
        };
        let manifest = RoutesManifest {
            format_version: 1,
            app: "graffiti".to_owned(),
            routes: vec![entry("/board/:boardId")],
        };
        assert!(validate_routes_manifest_shape(&manifest).is_ok());
        // Unknown format version fails closed.
        let mut wrong_version = manifest.clone();
        wrong_version.format_version = 2;
        assert!(validate_routes_manifest_shape(&wrong_version).is_err());
        // Overlapping patterns refuse: a static and a param segment at the
        // same position can match the same path.
        let mut overlapping = manifest.clone();
        overlapping.routes.push(BundleRouteEntry {
            route: "/board/wall".to_owned(),
            queries: vec![BundleQuerySpec {
                function: "listCells".to_owned(),
                args: json!({ "boardId": "wall" }),
            }],
            persist: None,
            register_group_eligible: false,
            mixed_group_eligible: false,
            mixed_profile: None,
        });
        assert!(validate_routes_manifest_shape(&overlapping).is_err());
        // Distinct static routes are fine.
        let mut disjoint = manifest.clone();
        disjoint.routes.push(BundleRouteEntry {
            route: "/about".to_owned(),
            queries: vec![BundleQuerySpec {
                function: "listCells".to_owned(),
                args: json!({ "boardId": "wall" }),
            }],
            persist: None,
            register_group_eligible: false,
            mixed_group_eligible: false,
            mixed_profile: None,
        });
        assert!(validate_routes_manifest_shape(&disjoint).is_ok());
        // A dangling reference refuses at shape validation.
        let mut dangling = manifest.clone();
        dangling.routes[0].queries[0].args = json!({ "boardId": { "$param": "missing" } });
        assert!(validate_routes_manifest_shape(&dangling).is_err());
        assert!(route_patterns_overlap("/", "/"));
        assert!(route_patterns_overlap("/a/:x", "/:y/b"));
        assert!(!route_patterns_overlap("/a/:x", "/b/:y"));
        assert!(!route_patterns_overlap("/a", "/a/b"));
    }

    #[test]
    fn entry_validation_covers_params_exactly() {
        let entry = BundleRouteEntry {
            route: "/board/:boardId".to_owned(),
            queries: vec![BundleQuerySpec {
                function: "listCells".to_owned(),
                args: json!({ "board": { "$param": "boardId" } }),
            }],
            persist: None,
            register_group_eligible: false,
            mixed_group_eligible: false,
            mixed_profile: None,
        };
        let exact: BTreeMap<String, String> = [("boardId".to_owned(), "b".to_owned())]
            .into_iter()
            .collect();
        assert!(validate_entry_against_params(&entry, "/board/:boardId", &exact).is_ok());
        // Missing param.
        assert_eq!(
            validate_entry_against_params(&entry, "/board/:boardId", &BTreeMap::new()),
            Err(code::PARAMS_INVALID)
        );
        // Extra param.
        let extra: BTreeMap<String, String> = [
            ("boardId".to_owned(), "b".to_owned()),
            ("other".to_owned(), "x".to_owned()),
        ]
        .into_iter()
        .collect();
        assert_eq!(
            validate_entry_against_params(&entry, "/board/:boardId", &extra),
            Err(code::PARAMS_INVALID)
        );
        // Route mismatch.
        assert_eq!(
            validate_entry_against_params(&entry, "/other", &exact),
            Err(code::ROUTE_UNKNOWN)
        );
        // Mapping referencing a param the pattern lacks.
        let dangling = BundleRouteEntry {
            route: "/board".to_owned(),
            queries: vec![BundleQuerySpec {
                function: "listCells".to_owned(),
                args: json!({ "board": { "$param": "boardId" } }),
            }],
            persist: None,
            register_group_eligible: false,
            mixed_group_eligible: false,
            mixed_profile: None,
        };
        assert_eq!(
            validate_entry_against_params(&dangling, "/board", &BTreeMap::new()),
            Err(code::PARAMS_INVALID)
        );
        // Query-count limit.
        let oversized = BundleRouteEntry {
            route: "/board".to_owned(),
            queries: vec![
                BundleQuerySpec {
                    function: "q".to_owned(),
                    args: Value::Null,
                };
                BUNDLE_MAX_QUERIES + 1
            ],
            persist: None,
            register_group_eligible: false,
            mixed_group_eligible: false,
            mixed_profile: None,
        };
        assert_eq!(
            validate_entry_against_params(&oversized, "/board", &BTreeMap::new()),
            Err(code::LIMIT_QUERIES)
        );
    }
}
