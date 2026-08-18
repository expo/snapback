//! LLP 0146 D7's ruled remediation carrier and global kind registry.
//!
//! The outer diagnostic and result envelopes remain unchanged. Callers attach
//! a bounded [`RemediationSetV1`] at `diagnostic.details.remediationSet`; the
//! nested schema and registry versions evolve independently of those outer
//! envelopes.
//!
//! @ref LLP 0146#oq6-author-ruling--2026-08-10 — option B installs the
//!   versioned, contextual carrier under `diagnostic.details.remediationSet`.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

pub const REMEDIATION_SET_SCHEMA_VERSION: &str = "snapback.remediation-set.v1";
pub const REMEDIATION_KIND_REGISTRY_VERSION: &str = "snapback.remediation-kinds.v1";
pub const REMEDIATION_SET_MAX_ITEMS: usize = 8;
pub const REMEDIATION_ARTIFACT_STALE_CODE: &str = "SNAPBACK_REMEDIATION_ARTIFACT_STALE";
pub const REMEDIATION_APPROVAL_REQUIRED_CODE: &str = "SNAPBACK_REMEDIATION_APPROVAL_REQUIRED";
pub const REMEDIATION_APPLY_SCHEMA_VERSION: &str = "snapback.remediation-apply.v1";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RemediationKindV1 {
    FixTypo,
    ReplaceIdentifier,
    RegenerateArtifacts,
    RequestGrant,
    UseDifferentPrincipal,
}

impl RemediationKindV1 {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::FixTypo => "fixTypo",
            Self::ReplaceIdentifier => "replaceIdentifier",
            Self::RegenerateArtifacts => "regenerateArtifacts",
            Self::RequestGrant => "requestGrant",
            Self::UseDifferentPrincipal => "useDifferentPrincipal",
        }
    }

    fn from_str(value: &str) -> Option<Self> {
        match value {
            "fixTypo" => Some(Self::FixTypo),
            "replaceIdentifier" => Some(Self::ReplaceIdentifier),
            "regenerateArtifacts" => Some(Self::RegenerateArtifacts),
            "requestGrant" => Some(Self::RequestGrant),
            "useDifferentPrincipal" => Some(Self::UseDifferentPrincipal),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum RemediationRiskClassV1 {
    Mechanical,
    AuthorityWidening,
    AuthoritySensitive,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum RemediationAuthorityEffectV1 {
    None,
    Widens,
    ChangesEffectivePrincipal,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum RemediationPreconditionV1 {
    ArtifactHash {
        #[serde(rename = "artifactHash")]
        artifact_hash: String,
    },
    GrantableScope {
        #[serde(rename = "grantableScope")]
        grantable_scope: String,
    },
    PrincipalAvailable {
        #[serde(rename = "principalAvailable")]
        principal_available: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RemediationActionV1 {
    ReplaceIdentifier {
        target: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        owner: Option<String>,
        replacement: String,
    },
    RegenerateArtifacts {
        target: String,
    },
    RequestGrant {
        #[serde(rename = "grantableScope")]
        scope: String,
    },
    UseDifferentPrincipal {
        principal: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RemediationItemV1 {
    pub kind: RemediationKindV1,
    pub risk_class: RemediationRiskClassV1,
    pub machine_applicable: bool,
    pub requires_approval: bool,
    pub authority_effect: RemediationAuthorityEffectV1,
    pub precondition: RemediationPreconditionV1,
    pub action: RemediationActionV1,
}

impl RemediationItemV1 {
    pub fn identifier_replacement(
        kind: RemediationKindV1,
        artifact_hash: &str,
        target: impl Into<String>,
        owner: Option<String>,
        replacement: impl Into<String>,
    ) -> Self {
        debug_assert!(matches!(
            kind,
            RemediationKindV1::FixTypo | RemediationKindV1::ReplaceIdentifier
        ));
        Self {
            kind,
            risk_class: RemediationRiskClassV1::Mechanical,
            machine_applicable: true,
            requires_approval: false,
            authority_effect: RemediationAuthorityEffectV1::None,
            precondition: RemediationPreconditionV1::ArtifactHash {
                artifact_hash: artifact_hash.to_owned(),
            },
            action: RemediationActionV1::ReplaceIdentifier {
                target: target.into(),
                owner,
                replacement: replacement.into(),
            },
        }
    }

    pub fn request_grant(scope: impl Into<String>) -> Self {
        let scope = scope.into();
        Self {
            kind: RemediationKindV1::RequestGrant,
            risk_class: RemediationRiskClassV1::AuthorityWidening,
            machine_applicable: false,
            requires_approval: true,
            authority_effect: RemediationAuthorityEffectV1::Widens,
            precondition: RemediationPreconditionV1::GrantableScope {
                grantable_scope: scope.clone(),
            },
            action: RemediationActionV1::RequestGrant { scope },
        }
    }

    fn validate_registry_contract(&self, carrier_hash: Option<&str>) -> Result<(), String> {
        let (risk_class, machine_applicable, requires_approval, authority_effect) = match self.kind
        {
            RemediationKindV1::FixTypo
            | RemediationKindV1::ReplaceIdentifier
            | RemediationKindV1::RegenerateArtifacts => (
                RemediationRiskClassV1::Mechanical,
                true,
                false,
                RemediationAuthorityEffectV1::None,
            ),
            RemediationKindV1::RequestGrant => (
                RemediationRiskClassV1::AuthorityWidening,
                false,
                true,
                RemediationAuthorityEffectV1::Widens,
            ),
            RemediationKindV1::UseDifferentPrincipal => (
                RemediationRiskClassV1::AuthoritySensitive,
                false,
                true,
                RemediationAuthorityEffectV1::ChangesEffectivePrincipal,
            ),
        };
        if self.risk_class != risk_class
            || self.machine_applicable != machine_applicable
            || self.requires_approval != requires_approval
            || self.authority_effect != authority_effect
        {
            return Err(format!(
                "{} remediation axes do not match the v1 registry",
                self.kind.as_str()
            ));
        }

        let contract_matches = match (&self.kind, &self.precondition, &self.action) {
            (
                RemediationKindV1::FixTypo | RemediationKindV1::ReplaceIdentifier,
                RemediationPreconditionV1::ArtifactHash { artifact_hash },
                RemediationActionV1::ReplaceIdentifier { .. },
            ) => carrier_hash.is_some_and(|carrier_hash| carrier_hash == artifact_hash),
            (
                RemediationKindV1::RegenerateArtifacts,
                RemediationPreconditionV1::ArtifactHash { artifact_hash },
                RemediationActionV1::RegenerateArtifacts { .. },
            ) => carrier_hash.is_some_and(|carrier_hash| carrier_hash == artifact_hash),
            (
                RemediationKindV1::RequestGrant,
                RemediationPreconditionV1::GrantableScope { grantable_scope },
                RemediationActionV1::RequestGrant { scope },
            ) => grantable_scope == scope,
            (
                RemediationKindV1::UseDifferentPrincipal,
                RemediationPreconditionV1::PrincipalAvailable {
                    principal_available,
                },
                RemediationActionV1::UseDifferentPrincipal { principal },
            ) => principal_available == principal,
            _ => false,
        };
        if !contract_matches {
            return Err(format!(
                "{} remediation action/precondition does not match the v1 registry",
                self.kind.as_str()
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RemediationSetV1 {
    pub schema_version: String,
    pub registry_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_hash: Option<String>,
    pub items: Vec<RemediationItemV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemediationApplyInputV1 {
    pub schema_version: String,
    pub artifact_hash: String,
    pub item: RemediationItemV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemediationApplyResultV1 {
    pub schema_version: String,
    pub applied: bool,
    pub artifact_hash: String,
    pub replacement: RemediationReplacementV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemediationReplacementV1 {
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    pub value: String,
}

pub const REMEDIATION_FIXTURE_FORMAT_VERSION: &str = "snapback.remediation-fixtures.v1";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemediationFixtureCorpusV1 {
    pub format_version: String,
    pub cases: Vec<RemediationFixtureCaseV1>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemediationFixtureCaseV1 {
    pub name: String,
    pub fixture_kind: String,
    pub diagnostic: Value,
    pub expect: Value,
}

impl RemediationSetV1 {
    pub fn for_artifact(artifact_hash: impl Into<String>, items: Vec<RemediationItemV1>) -> Self {
        let artifact_hash = artifact_hash.into();
        let items = items
            .into_iter()
            .filter(|item| {
                item.validate_registry_contract(Some(artifact_hash.as_str()))
                    .is_ok()
            })
            .take(REMEDIATION_SET_MAX_ITEMS)
            .collect();
        Self {
            schema_version: REMEDIATION_SET_SCHEMA_VERSION.to_owned(),
            registry_version: REMEDIATION_KIND_REGISTRY_VERSION.to_owned(),
            artifact_hash: Some(artifact_hash),
            items,
        }
    }

    pub fn authority(items: Vec<RemediationItemV1>) -> Self {
        Self {
            schema_version: REMEDIATION_SET_SCHEMA_VERSION.to_owned(),
            registry_version: REMEDIATION_KIND_REGISTRY_VERSION.to_owned(),
            artifact_hash: None,
            items: items
                .into_iter()
                .filter(|item| item.validate_registry_contract(None).is_ok())
                .take(REMEDIATION_SET_MAX_ITEMS)
                .collect(),
        }
    }
}

/// Attach the ruled nested carrier without changing the outer Diagnostic.
/// A non-object details value is preserved under `originalDetails` rather
/// than silently discarded.
pub fn attach_remediation_set(details: &mut Value, remediation_set: RemediationSetV1) {
    let carrier = serde_json::to_value(remediation_set).expect("remediation set serializes");
    match details {
        Value::Object(object) => {
            object.insert("remediationSet".to_owned(), carrier);
        }
        original => {
            let mut object = Map::new();
            object.insert("originalDetails".to_owned(), std::mem::take(original));
            object.insert("remediationSet".to_owned(), carrier);
            *original = Value::Object(object);
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DecodedRemediationSetV1 {
    pub artifact_hash: Option<String>,
    pub items: Vec<RemediationItemV1>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RemediationDecodeError {
    UnsupportedSchemaVersion(String),
    UnsupportedRegistryVersion(String),
    InvalidCarrier(String),
}

/// Decode the optional carrier from a Diagnostic details map. Unknown object
/// members are ignored by serde. Unknown kind rows are skipped so a v1 reader
/// can continue using known rows added to the global v1 registry.
pub fn decode_remediation_set(
    details: &Value,
) -> Result<Option<DecodedRemediationSetV1>, RemediationDecodeError> {
    let Some(raw) = details.get("remediationSet") else {
        return Ok(None);
    };
    let object = raw.as_object().ok_or_else(|| {
        RemediationDecodeError::InvalidCarrier("remediationSet must be an object".to_owned())
    })?;
    let schema_version = required_string(object, "schemaVersion")?;
    if schema_version != REMEDIATION_SET_SCHEMA_VERSION {
        return Err(RemediationDecodeError::UnsupportedSchemaVersion(
            schema_version.to_owned(),
        ));
    }
    let registry_version = required_string(object, "registryVersion")?;
    if registry_version != REMEDIATION_KIND_REGISTRY_VERSION {
        return Err(RemediationDecodeError::UnsupportedRegistryVersion(
            registry_version.to_owned(),
        ));
    }
    let artifact_hash = object
        .get("artifactHash")
        .and_then(Value::as_str)
        .map(str::to_owned);
    if artifact_hash
        .as_deref()
        .is_some_and(|hash| !artifact_hash_is_valid(hash))
    {
        return Err(RemediationDecodeError::InvalidCarrier(
            "artifactHash must be a supported sha256 digest".to_owned(),
        ));
    }
    let raw_items = object
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            RemediationDecodeError::InvalidCarrier("items must be an array".to_owned())
        })?;
    if raw_items.len() > REMEDIATION_SET_MAX_ITEMS {
        return Err(RemediationDecodeError::InvalidCarrier(format!(
            "items exceeds the {REMEDIATION_SET_MAX_ITEMS}-item bound"
        )));
    }
    let mut items = Vec::new();
    for raw_item in raw_items {
        let Some(kind) = raw_item
            .get("kind")
            .and_then(Value::as_str)
            .and_then(RemediationKindV1::from_str)
        else {
            continue;
        };
        let mut item: RemediationItemV1 =
            serde_json::from_value(raw_item.clone()).map_err(|error| {
                RemediationDecodeError::InvalidCarrier(format!(
                    "invalid {} item: {error}",
                    kind.as_str()
                ))
            })?;
        item.kind = kind;
        item.validate_registry_contract(artifact_hash.as_deref())
            .map_err(RemediationDecodeError::InvalidCarrier)?;
        items.push(item);
    }
    Ok(Some(DecodedRemediationSetV1 {
        artifact_hash,
        items,
    }))
}

fn required_string<'a>(
    object: &'a Map<String, Value>,
    name: &str,
) -> Result<&'a str, RemediationDecodeError> {
    object
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| RemediationDecodeError::InvalidCarrier(format!("{name} must be a string")))
}

pub fn remediation_kind_registry_artifact() -> Value {
    let artifact_hash_precondition = json!({
        "type": "artifact-hash",
        "required": ["artifactHash"]
    });
    json!({
        "schemaVersion": REMEDIATION_KIND_REGISTRY_VERSION,
        "registryKind": "remediationKindRegistry",
        "status": "active",
        "kinds": [
            registry_row(RemediationKindV1::FixTypo, RemediationRiskClassV1::Mechanical, true, false, RemediationAuthorityEffectV1::None, artifact_hash_precondition.clone()),
            registry_row(RemediationKindV1::ReplaceIdentifier, RemediationRiskClassV1::Mechanical, true, false, RemediationAuthorityEffectV1::None, artifact_hash_precondition.clone()),
            registry_row(RemediationKindV1::RegenerateArtifacts, RemediationRiskClassV1::Mechanical, true, false, RemediationAuthorityEffectV1::None, artifact_hash_precondition),
            registry_row(RemediationKindV1::RequestGrant, RemediationRiskClassV1::AuthorityWidening, false, true, RemediationAuthorityEffectV1::Widens, json!({"type": "grantable-scope", "required": ["grantableScope"]})),
            registry_row(RemediationKindV1::UseDifferentPrincipal, RemediationRiskClassV1::AuthoritySensitive, false, true, RemediationAuthorityEffectV1::ChangesEffectivePrincipal, json!({"type": "principal-available", "required": ["principalAvailable"]})),
        ]
    })
}

fn registry_row(
    kind: RemediationKindV1,
    risk_class: RemediationRiskClassV1,
    machine_applicable: bool,
    requires_approval: bool,
    authority_effect: RemediationAuthorityEffectV1,
    precondition: Value,
) -> Value {
    json!({
        "kind": kind,
        "riskClass": risk_class,
        "machineApplicable": machine_applicable,
        "requiresApproval": requires_approval,
        "authorityEffect": authority_effect,
        "precondition": precondition,
    })
}

/// LLP 0095's committed cross-projection remediation fixtures. Positive
/// diagnostics are serialized through the real Rust carrier; adversarial
/// unknown-member/kind cases are raw JSON by design.
pub fn remediation_fixture_corpus() -> RemediationFixtureCorpusV1 {
    let hash = "sha256:0123456789abcdef";
    let positive = |name: &str, target: &str, owner: Option<String>, replacement: &str| {
        let diagnostic = crate::diagnostic::Diagnostic::error(
            "SNAPBACK_UNKNOWN_FUNCTION",
            "fixture",
            "fixture refusal",
        )
        .with_remediation_set(RemediationSetV1::for_artifact(
            hash,
            vec![RemediationItemV1::identifier_replacement(
                RemediationKindV1::FixTypo,
                hash,
                target,
                owner,
                replacement,
            )],
        ));
        let value = serde_json::to_value(&diagnostic).expect("fixture diagnostic serializes");
        let bytes = serde_json::to_string(&diagnostic).expect("fixture diagnostic bytes");
        RemediationFixtureCaseV1 {
            name: name.to_owned(),
            fixture_kind: "positive".to_owned(),
            diagnostic: value,
            expect: json!({
                "decodedItems": 1,
                "diagnosticBytesByProjection": {
                    "directHttp": bytes,
                    "hostOpsCli": bytes,
                    "generatedMcp": bytes,
                    "hosted": bytes,
                }
            }),
        }
    };
    let mut cases = vec![
        positive("operation-typo", "hostOperation", None, "app.inspect"),
        positive("function-typo", "function", None, "listTodos"),
        positive(
            "argument-field-typo",
            "argumentField",
            Some("fn_list_todos".to_owned()),
            "limit",
        ),
        positive(
            "schema-field-typo",
            "schemaField",
            Some("todos".to_owned()),
            "title",
        ),
        positive("http-route-typo", "httpRoute", None, "/app/ensure"),
    ];
    let authority = crate::diagnostic::Diagnostic::error(
        "SNAPBACK_AUTH_GRANT_SCOPE_DENIED",
        "auth",
        "the scoped grant does not authorize this function",
    )
    .with_remediation_set(RemediationSetV1::authority(vec![
        RemediationItemV1::request_grant("function:query:fn_list_todos"),
    ]));
    cases.push(RemediationFixtureCaseV1 {
        name: "approval-required-grant".to_owned(),
        fixture_kind: "approval".to_owned(),
        diagnostic: serde_json::to_value(authority).expect("authority fixture serializes"),
        expect: json!({
            "autoApply": false,
            "refusalCode": REMEDIATION_APPROVAL_REQUIRED_CODE,
        }),
    });

    let mut unknown = cases[0].diagnostic.clone();
    unknown["details"]["remediationSet"]["futureMember"] = json!({"ignored": true});
    let mut unknown_item = unknown["details"]["remediationSet"]["items"][0].clone();
    unknown_item["kind"] = json!("futureKind");
    unknown["details"]["remediationSet"]["items"]
        .as_array_mut()
        .expect("fixture items")
        .push(unknown_item);
    cases.push(RemediationFixtureCaseV1 {
        name: "unknown-member-and-kind".to_owned(),
        fixture_kind: "forward-compatibility".to_owned(),
        diagnostic: unknown,
        expect: json!({"diagnosticUsable": true, "decodedItems": 1}),
    });
    cases.push(RemediationFixtureCaseV1 {
        name: "stale-artifact-no-effect".to_owned(),
        fixture_kind: "stale-artifact".to_owned(),
        diagnostic: serde_json::to_value(crate::diagnostic::Diagnostic::error(
            REMEDIATION_ARTIFACT_STALE_CODE,
            "remediation",
            "the remediation artifact is stale",
        ))
        .expect("stale fixture serializes"),
        expect: json!({
            "httpStatus": 409,
            "writes": 0,
            "aliases": 0,
            "regenerations": 0,
            "invocations": 0,
        }),
    });
    cases.push(RemediationFixtureCaseV1 {
        name: "disclosure-negative".to_owned(),
        fixture_kind: "disclosure-negative".to_owned(),
        diagnostic: cases[1].diagnostic.clone(),
        expect: json!({
            "forbiddenSubstrings": ["rejected-spelling", "secret-value", "unknown-before-auth"],
        }),
    });
    RemediationFixtureCorpusV1 {
        format_version: REMEDIATION_FIXTURE_FORMAT_VERSION.to_owned(),
        cases,
    }
}

/// Read-only view of the served authoring surfaces, built by the caller that
/// holds the generation fence. Passing the manifests instead of the runtime
/// handle keeps this contract leaf independent of the runtime god-files.
pub(crate) struct ServedSurfacesV1<'a> {
    pub functions: &'a crate::manifest::FunctionManifest,
    pub schema: &'a crate::manifest::SchemaManifest,
    /// Digest of the served host-operation catalog, when the caller serves one.
    pub catalog_digest: Option<String>,
    /// The served host-operation identifiers.
    pub served_host_ops: &'a [&'a str],
    /// The served HTTP route paths.
    pub served_routes: Vec<&'a str>,
}

/// Consume one exact carrier item while the caller holds the serving
/// generation fence. This operation repairs only the identifier value it
/// returns; it never writes, aliases, regenerates artifacts, or invokes an
/// application function.
///
/// @ref LLP 0146#oq6-author-ruling--2026-08-10 — compare the supplied and
///   currently served artifact hashes in the same critical section that
///   selects the replacement, and refuse stale with no side effects.
pub(crate) fn apply_remediation(
    surfaces: &ServedSurfacesV1<'_>,
    input: RemediationApplyInputV1,
) -> Result<RemediationApplyResultV1, crate::diagnostic::SnapbackError> {
    use crate::diagnostic::SnapbackError;

    if input.schema_version != REMEDIATION_APPLY_SCHEMA_VERSION {
        return Err(SnapbackError::error(
            "SNAPBACK_REMEDIATION_INPUT_INVALID",
            "remediation",
            "remediation.apply requires the v1 closed input carrier",
        ));
    }
    if !artifact_hash_is_valid(&input.artifact_hash) {
        return Err(SnapbackError::error(
            "SNAPBACK_REMEDIATION_INPUT_INVALID",
            "remediation",
            "remediation.apply artifactHash must be a supported sha256 digest",
        ));
    }
    input
        .item
        .validate_registry_contract(Some(input.artifact_hash.as_str()))
        .map_err(|message| {
            SnapbackError::error("SNAPBACK_REMEDIATION_INPUT_INVALID", "remediation", message)
        })?;
    if input.item.requires_approval || !input.item.machine_applicable {
        return Err(SnapbackError::error(
            REMEDIATION_APPROVAL_REQUIRED_CODE,
            "remediation",
            "the selected remediation requires explicit approval and is not machine-applicable",
        ));
    }
    let RemediationPreconditionV1::ArtifactHash {
        artifact_hash: item_hash,
    } = &input.item.precondition
    else {
        return Err(SnapbackError::error(
            "SNAPBACK_REMEDIATION_INPUT_INVALID",
            "remediation",
            "machine-applicable remediation requires an artifact-hash precondition",
        ));
    };
    if item_hash != &input.artifact_hash {
        return Err(stale_artifact_refusal());
    }
    let RemediationActionV1::ReplaceIdentifier {
        target,
        owner,
        replacement,
    } = &input.item.action
    else {
        return Err(SnapbackError::error(
            "SNAPBACK_REMEDIATION_INPUT_INVALID",
            "remediation",
            "v1 remediation.apply consumes only identifier replacements",
        ));
    };

    let current_hash = current_artifact_hash(surfaces, target, owner.as_deref())
        .ok_or_else(stale_artifact_refusal)?;
    if current_hash != input.artifact_hash {
        return Err(stale_artifact_refusal());
    }
    if !replacement_is_served(surfaces, target, owner.as_deref(), replacement) {
        return Err(stale_artifact_refusal());
    }

    Ok(RemediationApplyResultV1 {
        schema_version: REMEDIATION_APPLY_SCHEMA_VERSION.to_owned(),
        applied: true,
        artifact_hash: current_hash,
        replacement: RemediationReplacementV1 {
            target: target.clone(),
            owner: owner.clone(),
            value: replacement.clone(),
        },
    })
}

fn stale_artifact_refusal() -> crate::diagnostic::SnapbackError {
    crate::diagnostic::SnapbackError::error(
        REMEDIATION_ARTIFACT_STALE_CODE,
        "remediation",
        "the remediation artifact is stale; obtain a new refusal and choose from its current remediation set",
    )
}

fn artifact_hash_is_valid(hash: &str) -> bool {
    let Some(hex) = hash.strip_prefix("sha256:") else {
        return false;
    };
    matches!(hex.len(), 16 | 64)
        && hex
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

fn current_artifact_hash(
    surfaces: &ServedSurfacesV1<'_>,
    target: &str,
    owner: Option<&str>,
) -> Option<String> {
    match target {
        "hostOperation" => surfaces.catalog_digest.clone(),
        "function" => surfaces.functions.bundle_hash.clone(),
        "argumentField" => owner
            .and_then(|owner| {
                surfaces
                    .functions
                    .functions
                    .iter()
                    .find(|function| function.id == owner)
            })
            .and_then(|function| function.args_contract_hash.clone()),
        "schemaField" => owner
            .and_then(|owner| surfaces.schema.table(owner))
            .map(crate::authoring_suggestion::table_shape_hash),
        "httpRoute" => Some(crate::authoring_suggestion::path_set_hash(
            &surfaces.served_routes,
        )),
        _ => None,
    }
}

fn replacement_is_served(
    surfaces: &ServedSurfacesV1<'_>,
    target: &str,
    owner: Option<&str>,
    replacement: &str,
) -> bool {
    match target {
        "hostOperation" => surfaces.served_host_ops.contains(&replacement),
        "function" => surfaces.functions.function(replacement).is_some(),
        "argumentField" => owner
            .and_then(|owner| {
                surfaces
                    .functions
                    .functions
                    .iter()
                    .find(|function| function.id == owner)
            })
            .and_then(|function| function.args_contract.as_ref())
            .is_some_and(|contract| {
                contract
                    .fields
                    .iter()
                    .any(|field| field.name == replacement)
            }),
        "schemaField" => owner
            .and_then(|owner| surfaces.schema.table(owner))
            .is_some_and(|table| table.fields.iter().any(|field| field.name == replacement)),
        "httpRoute" => surfaces.served_routes.contains(&replacement),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn construction_binds_and_bounds_machine_items() {
        let hash = "sha256:0123456789abcdef";
        let items = (0..12)
            .map(|index| {
                RemediationItemV1::identifier_replacement(
                    RemediationKindV1::FixTypo,
                    hash,
                    "function",
                    None,
                    format!("replacement{index}"),
                )
            })
            .collect();
        let set = RemediationSetV1::for_artifact(hash, items);
        assert_eq!(set.items.len(), REMEDIATION_SET_MAX_ITEMS);
    }

    #[test]
    fn decoder_ignores_unknown_members_and_kinds() {
        let mut details = json!({});
        attach_remediation_set(
            &mut details,
            RemediationSetV1::for_artifact(
                "sha256:0123456789abcdef",
                vec![RemediationItemV1::identifier_replacement(
                    RemediationKindV1::FixTypo,
                    "sha256:0123456789abcdef",
                    "function",
                    None,
                    "listTodos",
                )],
            ),
        );
        details["remediationSet"]["futureMember"] = json!(true);
        details["remediationSet"]["items"][0]["futureItemMember"] = json!({"x": 1});
        let mut unknown = details["remediationSet"]["items"][0].clone();
        unknown["kind"] = json!("futureKind");
        details["remediationSet"]["items"]
            .as_array_mut()
            .unwrap()
            .push(unknown);
        let decoded = decode_remediation_set(&details).unwrap().unwrap();
        assert_eq!(decoded.items.len(), 1);
        assert_eq!(decoded.items[0].kind, RemediationKindV1::FixTypo);
    }

    #[test]
    fn decoder_rejects_items_whose_claimed_axes_disagree_with_the_registry() {
        let mut details = json!({});
        attach_remediation_set(
            &mut details,
            RemediationSetV1::authority(vec![RemediationItemV1::request_grant(
                "function:query:fn_list_todos",
            )]),
        );
        details["remediationSet"]["items"][0]["machineApplicable"] = json!(true);
        details["remediationSet"]["items"][0]["requiresApproval"] = json!(false);
        let error = decode_remediation_set(&details).expect_err("tampered axes must refuse");
        assert!(matches!(error, RemediationDecodeError::InvalidCarrier(_)));
    }

    #[test]
    fn fixture_projection_bytes_are_identical_and_disclosure_safe() {
        let corpus = remediation_fixture_corpus();
        assert_eq!(corpus.format_version, REMEDIATION_FIXTURE_FORMAT_VERSION);
        for case in &corpus.cases {
            if let Some(projections) = case.expect["diagnosticBytesByProjection"].as_object() {
                let values = projections.values().collect::<Vec<_>>();
                assert!(values.windows(2).all(|pair| pair[0] == pair[1]));
            }
            let serialized = serde_json::to_string(&case.diagnostic).unwrap();
            for forbidden in case.expect["forbiddenSubstrings"]
                .as_array()
                .into_iter()
                .flatten()
            {
                assert!(!serialized.contains(forbidden.as_str().unwrap()));
            }
        }
    }
}
