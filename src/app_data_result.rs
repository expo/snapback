//! The shared app-data result core (LLP 0024 amendment, LLP 0062 §2).
//!
//! One Rust-owned normalization DTO shared by the headless client and app CLI.
//! Raw HTTP routes retain their route-specific response envelopes; client
//! consumers normalize those responses into this core before projections
//! (CLI text/JSON, future MCP) consume it. `appCliCallResult` is the engine's
//! presentation wrapper around the normalized core, never a second outcome
//! taxonomy (LLP 0062 §2 result contract).
//
// @ref LLP 0024#dated-amendment-shared-app-data-result-core-2026-08-01 —
// this module is the schema authority the amendment registers; the frozen
// exit taxonomy lives in LLP 0062 §2 and the classification rules here.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const APP_DATA_RESULT_ARTIFACT_KIND: &str = "appDataResultCore";
pub const APP_DATA_RESULT_FORMAT_VERSION: &str = "snapback.app-data-result.v1";

/// Which call family produced the result. One-shot live reads are their own
/// kind (`live-snapshot`) so the per-kind mapping table stays closed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case", deny_unknown_fields)]
pub enum AppDataCallKind {
    Query,
    Mutation,
    Action,
    LiveSnapshot,
}

/// The closed outcome vocabulary. `Unknown` and `NotDispatched` implement
/// LLP 0062 §2's pinned write-effect semantics: a lost write reports what is
/// known, never a guess. `AppRefusal` is the declared `ctx.refuse` channel
/// (LLP 0108 §Declared application refusals) — distinct from `Failed`
/// (threw / `ok: false`) and from `Refused` (a SNAPBACK_* platform refusal).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case", deny_unknown_fields)]
pub enum AppDataOutcome {
    Ok,
    AppRefusal,
    Refused,
    Failed,
    TransportFailed,
    Timeout,
    Unknown,
    NotDispatched,
}

/// Where a diagnostic was observed on the wire. The frozen unknown-code
/// fallback exits (LLP 0062 review residue #8) key on this locus, never on
/// whether the engine recognizes the code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case", deny_unknown_fields)]
pub enum DiagnosticLocus {
    /// A non-2xx HTTP response to the request itself.
    Request,
    /// An HTTP-200 response whose function/action result carried the refusal.
    Result,
    /// A live subscription terminal or refusal frame.
    Live,
    /// A code-mode brokered call's error surface.
    Broker,
    /// Produced by the engine before or without dispatch.
    Engine,
}

/// The public diagnostic projection the core carries: `code`, `severity`,
/// `subsystem` (LLP 0012's shared dialect), the wire locus, and — only
/// through the versioned code-indexed allowlist — additional safe fields.
/// Free-text `message`/`details` never pass (LLP 0062 §2). Server codes are
/// preserved verbatim; an unknown-but-valid code sets `unrecognized` and is
/// never rewritten (forward skew is presentation, not a compatibility gate).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppDataDiagnosticV1 {
    pub code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subsystem: Option<String>,
    pub locus: DiagnosticLocus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unrecognized: bool,
    /// Allowlisted safe semantic fields only (code-indexed, versioned).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<Map<String, Value>>,
}

/// The declared application refusal (`ctx.refuse`): the declaration types
/// the code, the host folds forgeries, and the core carries it typed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppRefusalV1 {
    pub app_code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

/// Write-effect facts for mutations (LLP 0062 §2 pinned outcome semantics):
/// the durable client mutation id exists so an `outcome: "unknown"` result
/// has a replay handle; `underlying` names the failure class the exit code
/// derives from when the outcome alone is ambiguous (unknown ⇒ 6 or 9).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppDataMutationFactsV1 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_mutation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underlying: Option<AppDataOutcome>,
}

/// The shared app-data result core. Every field is either the application
/// value, a protocol fact, or a preserved server artifact — the core never
/// invents presentation. `taggedValues` is the RESERVED versioned
/// extension point for exact 64-bit integers / decimals / binary values
/// (LLP 0004 anticipates them); v1 emitters never set it, and v1 consumers
/// refuse a document that does (reserved means declared, not negotiable).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppDataResultCoreV1 {
    pub artifact_kind: String,
    pub format_version: String,
    pub kind: AppDataCallKind,
    pub outcome: AppDataOutcome,
    /// A query's rows, a mutation's `result`, an action's value. Absent on
    /// every non-`ok` outcome except `app-refusal`, which carries no value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
    /// Protocol facts preserved (`changed_count`, receipts, active identity).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub facts: Option<Map<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_refusal: Option<AppRefusalV1>,
    #[serde(default)]
    pub diagnostics: Vec<AppDataDiagnosticV1>,
    /// The server-derived attribution block, verbatim (LLP 0055 §Audit).
    /// Wrappers and projections never synthesize or reshape one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mutation: Option<AppDataMutationFactsV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tagged_values: Option<Value>,
}

impl AppDataResultCoreV1 {
    /// Admission: the identity pair plus the reserved-member rule.
    pub fn validate(&self) -> Result<(), String> {
        if self.artifact_kind != APP_DATA_RESULT_ARTIFACT_KIND {
            return Err(format!(
                "artifactKind must be {APP_DATA_RESULT_ARTIFACT_KIND}, got {}",
                self.artifact_kind
            ));
        }
        if self.format_version != APP_DATA_RESULT_FORMAT_VERSION {
            return Err(format!(
                "formatVersion must be {APP_DATA_RESULT_FORMAT_VERSION}, got {}",
                self.format_version
            ));
        }
        if self.tagged_values.is_some() {
            return Err("taggedValues is reserved in v1 and must be absent".to_string());
        }
        Ok(())
    }
}

pub fn schema_registrations() -> Vec<(&'static str, Value)> {
    vec![(
        "app-data.result-core.schema.json",
        serde_json::to_value(schemars::schema_for!(AppDataResultCoreV1))
            .expect("app-data result core schema serializes"),
    )]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The representative document the engine emits (kept byte-faithful to
    /// packages/snapback-app-cli/result-core.mjs's construction order): the
    /// Rust authority must admit exactly what the JS engine builds.
    const ENGINE_REPRESENTATIVE: &str = r#"{
        "artifactKind": "appDataResultCore",
        "formatVersion": "snapback.app-data-result.v1",
        "kind": "mutation",
        "outcome": "ok",
        "value": { "id": "todo_1" },
        "facts": { "changedCount": 1 },
        "diagnostics": [],
        "attribution": { "actorUserId": "u_1", "effectiveUserId": "u_1", "grantId": null, "dryRun": false },
        "mutation": { "clientMutationId": "cm_018f" }
    }"#;

    #[test]
    fn engine_representative_document_round_trips() {
        let core: AppDataResultCoreV1 =
            serde_json::from_str(ENGINE_REPRESENTATIVE).expect("engine document admits");
        core.validate().expect("engine document validates");
        assert_eq!(core.kind, AppDataCallKind::Mutation);
        assert_eq!(core.outcome, AppDataOutcome::Ok);
        let reserialized = serde_json::to_value(&core).expect("reserializes");
        let original: Value = serde_json::from_str(ENGINE_REPRESENTATIVE).expect("parses");
        assert_eq!(reserialized, original, "core round-trip must be lossless");
    }

    #[test]
    fn app_refusal_and_unrecognized_diagnostic_admit() {
        let doc = r#"{
            "artifactKind": "appDataResultCore",
            "formatVersion": "snapback.app-data-result.v1",
            "kind": "action",
            "outcome": "app-refusal",
            "appRefusal": { "appCode": "SEAT_TAKEN", "details": { "seat": "12A" } },
            "diagnostics": [{
                "code": "SNAPBACK_FUTURE_CODE_UNSEEN",
                "locus": "result",
                "unrecognized": true
            }]
        }"#;
        let core: AppDataResultCoreV1 = serde_json::from_str(doc).expect("admits");
        core.validate().expect("validates");
        assert_eq!(core.app_refusal.as_ref().unwrap().app_code, "SEAT_TAKEN");
        assert!(core.diagnostics[0].unrecognized);
    }

    #[test]
    fn unknown_member_and_reserved_member_refuse() {
        let smuggled = r#"{
            "artifactKind": "appDataResultCore",
            "formatVersion": "snapback.app-data-result.v1",
            "kind": "query",
            "outcome": "ok",
            "value": [],
            "diagnostics": [],
            "sourceText": "export const q = ..."
        }"#;
        assert!(serde_json::from_str::<AppDataResultCoreV1>(smuggled).is_err());

        let reserved = r#"{
            "artifactKind": "appDataResultCore",
            "formatVersion": "snapback.api-envelope.v1",
            "kind": "query",
            "outcome": "ok",
            "diagnostics": []
        }"#;
        let wrong_version: AppDataResultCoreV1 = serde_json::from_str(reserved).expect("parses");
        assert!(wrong_version.validate().is_err());

        let tagged = AppDataResultCoreV1 {
            artifact_kind: APP_DATA_RESULT_ARTIFACT_KIND.to_string(),
            format_version: APP_DATA_RESULT_FORMAT_VERSION.to_string(),
            kind: AppDataCallKind::Query,
            outcome: AppDataOutcome::Ok,
            value: None,
            facts: None,
            app_refusal: None,
            diagnostics: vec![],
            attribution: None,
            mutation: None,
            tagged_values: Some(Value::Null),
        };
        assert!(
            tagged.validate().is_err(),
            "reserved member must refuse in v1"
        );
    }
}
