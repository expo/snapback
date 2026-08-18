//! Compatibility classification for successive exposed `/api/v1` contracts.
//!
//! @ref LLP 0204#d2--surface-1-the-third-party-api — exposed functions evolve
//!   additively within the v1 contract regime.
//! @ref LLP 0225#1-ownership-map — this pure classifier stays beside the API
//!   envelope contract; activation and persistence remain with their owners.

use crate::api_envelope::ApiEnvelopeV1;
use crate::diagnostic::Diagnostic;
use serde_json::Value;
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiCompatFinding {
    kind: &'static str,
    function_id: String,
    message: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ApiCompatOutcome {
    breaking: Vec<ApiCompatFinding>,
    advisories: Vec<Diagnostic>,
}

impl ApiCompatOutcome {
    pub fn is_compatible(&self) -> bool {
        self.breaking.is_empty()
    }

    pub fn breaking(&self) -> &[ApiCompatFinding] {
        &self.breaking
    }

    pub fn into_advisories(self) -> Vec<Diagnostic> {
        self.advisories
    }
}

impl ApiEnvelopeV1 {
    /// Route activation through the envelope contract owner without giving
    /// the unassigned `local.rs` remainder a new module dependency.
    pub fn classify_compatibility(
        prior: Option<&Self>,
        next: Option<&Self>,
    ) -> ApiCompatOutcome {
        classify_api_compatibility(prior, next)
    }
}

/// Compare exposed API contracts pairwise by stable function id.
///
/// A missing predecessor is an honest unavailable baseline, not an empty API.
pub fn classify_api_compatibility(
    prior: Option<&ApiEnvelopeV1>,
    next: Option<&ApiEnvelopeV1>,
) -> ApiCompatOutcome {
    let Some(prior) = prior else {
        return ApiCompatOutcome {
            breaking: Vec::new(),
            advisories: vec![Diagnostic::warning(
                "SNAPBACK_API_COMPATIBILITY_BASELINE_UNAVAILABLE",
                "app-api",
                "compatibility baseline unavailable; treated as new baseline",
            )],
        };
    };

    let prior_definitions = definitions_by_id(prior);
    let next_definitions = next.map(definitions_by_id).unwrap_or_default();
    let mut outcome = ApiCompatOutcome::default();

    for (stable_id, prior_definition) in prior_definitions
        .into_iter()
        .filter(|(_, definition)| is_exposed(definition))
    {
        let Some(next_definition) = next_definitions.get(stable_id) else {
            outcome.breaking.push(finding(
                "function-removed",
                stable_id,
                "previously exposed function was removed",
            ));
            continue;
        };
        if !is_exposed(next_definition) {
            outcome.breaking.push(finding(
                "function-unexposed",
                stable_id,
                "previously exposed function changed to expose: false",
            ));
            continue;
        }

        classify_auth(stable_id, prior_definition, next_definition, &mut outcome);
        if let Some(next) = next {
            classify_args(stable_id, prior, next, &mut outcome);
        }
    }

    outcome
}

fn definitions_by_id(envelope: &ApiEnvelopeV1) -> BTreeMap<&str, &Value> {
    envelope
        .functions
        .get("functions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|definition| {
            definition
                .get("id")
                .and_then(Value::as_str)
                .map(|id| (id, definition))
        })
        .collect()
}

fn is_exposed(definition: &Value) -> bool {
    definition
        .get("apiExposure")
        .and_then(|exposure| exposure.get("expose"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn finding(
    kind: &'static str,
    function_id: impl Into<String>,
    message: impl Into<String>,
) -> ApiCompatFinding {
    ApiCompatFinding {
        kind,
        function_id: function_id.into(),
        message: message.into(),
    }
}

fn classify_auth(stable_id: &str, prior: &Value, next: &Value, outcome: &mut ApiCompatOutcome) {
    let prior_auth = auth_rank(prior);
    let next_auth = auth_rank(next);
    match next_auth.cmp(&prior_auth) {
        Ordering::Greater => outcome.breaking.push(finding(
            "auth-requirement-tightened",
            stable_id,
            format!(
                "authRequirement tightened from {} to {}",
                auth_name(prior_auth),
                auth_name(next_auth)
            ),
        )),
        Ordering::Less => outcome.advisories.push(
            Diagnostic::warning(
                "SNAPBACK_API_AUTH_REQUIREMENT_LOOSENED",
                "app-api",
                format!(
                    "exposed function {stable_id} loosened authRequirement from {} to {}; this is additive but changes disclosure",
                    auth_name(prior_auth),
                    auth_name(next_auth)
                ),
            )
            .with_details(serde_json::json!({
                "functionId": stable_id,
                "prior": auth_name(prior_auth),
                "next": auth_name(next_auth),
            })),
        ),
        Ordering::Equal => {}
    }
}

fn auth_rank(definition: &Value) -> u8 {
    match definition.get("authRequirement").and_then(Value::as_str) {
        Some("public") => 0,
        None | Some("optional-user") => 1,
        Some("authenticated") => 2,
        Some(_) => 3,
    }
}

fn auth_name(rank: u8) -> &'static str {
    match rank {
        0 => "public",
        1 => "optional-user",
        2 => "authenticated",
        _ => "invalid",
    }
}

fn classify_args(
    stable_id: &str,
    prior: &ApiEnvelopeV1,
    next: &ApiEnvelopeV1,
    outcome: &mut ApiCompatOutcome,
) {
    let prior_properties = prior
        .operations
        .get(stable_id)
        .map(|operation| schema_properties(&operation.args_schema))
        .unwrap_or_default();
    let next_properties = next
        .operations
        .get(stable_id)
        .map(|operation| schema_properties(&operation.args_schema))
        .unwrap_or_default();
    for name in prior_properties.difference(&next_properties) {
        outcome.breaking.push(finding(
            "argument-removed",
            stable_id,
            format!("existing argument '{name}' was removed"),
        ));
    }

    let prior_required = prior
        .operations
        .get(stable_id)
        .map(|operation| schema_required(&operation.args_schema))
        .unwrap_or_default();
    let next_required = next
        .operations
        .get(stable_id)
        .map(|operation| schema_required(&operation.args_schema))
        .unwrap_or_default();
    for name in next_required.difference(&prior_required) {
        outcome.breaking.push(finding(
            "required-argument-added",
            stable_id,
            format!("argument '{name}' became newly required"),
        ));
    }
}

fn schema_properties(schema: &Value) -> BTreeSet<&str> {
    schema
        .get("properties")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|properties| properties.keys().map(String::as_str))
        .collect()
}

fn schema_required(schema: &Value) -> BTreeSet<&str> {
    schema
        .get("required")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api_envelope::{
        ApiEnvelopeDeclarationsV1, ApiEnvelopeOperationV1, ApiEnvelopeTupleV1,
    };
    use crate::diagnostic::DiagnosticSeverity;
    use serde_json::json;

    fn definition(id: &str, expose: bool, auth: &str) -> Value {
        json!({
            "id": id,
            "name": id,
            "kind": "Mutation",
            "authRequirement": auth,
            "apiExposure": { "expose": expose }
        })
    }

    fn empty_args() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {}
        })
    }

    fn envelope(definitions: Vec<(Value, Value)>) -> ApiEnvelopeV1 {
        let mut operations = BTreeMap::new();
        let mut functions = Vec::new();
        for (definition, args_schema) in definitions {
            let id = definition["id"].as_str().expect("fixture id").to_owned();
            operations.insert(
                id,
                ApiEnvelopeOperationV1 {
                    name: definition["name"]
                        .as_str()
                        .expect("fixture name")
                        .to_owned(),
                    args_schema,
                },
            );
            functions.push(definition);
        }
        ApiEnvelopeV1 {
            artifact_kind: "apiEnvelope".to_owned(),
            format_version: "snapback.api-envelope.v1".to_owned(),
            app_id: "compat-test".to_owned(),
            tuple: ApiEnvelopeTupleV1 {
                schema_version: "snapback.v1".to_owned(),
                auth_mode: "sessions".to_owned(),
            },
            inputs_hash: None,
            bundle_hash: None,
            functions: json!({ "functions": functions }),
            operations,
            declarations: ApiEnvelopeDeclarationsV1 {
                app_bindings: String::new(),
            },
            member_digests: BTreeMap::new(),
        }
    }

    fn baseline() -> ApiEnvelopeV1 {
        envelope(vec![(
            definition("fn:existing", true, "public"),
            empty_args(),
        )])
    }

    fn kinds(outcome: &ApiCompatOutcome) -> Vec<&'static str> {
        outcome
            .breaking
            .iter()
            .map(|finding| finding.kind)
            .collect()
    }

    #[test]
    fn removed_exposed_function_is_breaking() {
        let prior = baseline();
        let next = envelope(Vec::new());
        assert_eq!(
            kinds(&classify_api_compatibility(Some(&prior), Some(&next))),
            ["function-removed"]
        );
    }

    #[test]
    fn unexposed_function_is_breaking() {
        let prior = baseline();
        let next = envelope(vec![(
            definition("fn:existing", false, "public"),
            empty_args(),
        )]);
        assert_eq!(
            kinds(&classify_api_compatibility(Some(&prior), Some(&next))),
            ["function-unexposed"]
        );
    }

    #[test]
    fn tightened_auth_is_breaking() {
        for (prior_auth, next_auth) in [
            ("public", "optional-user"),
            ("public", "authenticated"),
            ("optional-user", "authenticated"),
        ] {
            let prior = envelope(vec![(
                definition("fn:existing", true, prior_auth),
                empty_args(),
            )]);
            let next = envelope(vec![(
                definition("fn:existing", true, next_auth),
                empty_args(),
            )]);
            assert_eq!(
                kinds(&classify_api_compatibility(Some(&prior), Some(&next))),
                ["auth-requirement-tightened"]
            );
        }
    }

    #[test]
    fn required_argument_added_is_breaking() {
        let prior = baseline();
        let next = envelope(vec![(
            definition("fn:existing", true, "public"),
            json!({
                "type": "object",
                "additionalProperties": false,
                "properties": { "requiredNow": { "type": "string" } },
                "required": ["requiredNow"]
            }),
        )]);
        assert_eq!(
            kinds(&classify_api_compatibility(Some(&prior), Some(&next))),
            ["required-argument-added"]
        );
    }

    #[test]
    fn argument_removed_is_breaking() {
        let prior = envelope(vec![(
            definition("fn:existing", true, "public"),
            json!({
                "type": "object",
                "additionalProperties": false,
                "properties": { "old": { "type": "string" } }
            }),
        )]);
        let next = baseline();
        assert_eq!(
            kinds(&classify_api_compatibility(Some(&prior), Some(&next))),
            ["argument-removed"]
        );
    }

    #[test]
    fn new_exposed_function_is_additive() {
        let prior = baseline();
        let next = envelope(vec![
            (definition("fn:existing", true, "public"), empty_args()),
            (definition("fn:new", true, "public"), empty_args()),
        ]);
        assert!(classify_api_compatibility(Some(&prior), Some(&next)).is_compatible());
    }

    #[test]
    fn optional_argument_added_is_additive() {
        let prior = baseline();
        let next = envelope(vec![(
            definition("fn:existing", true, "public"),
            json!({
                "type": "object",
                "additionalProperties": false,
                "properties": { "optional": { "type": "string" } }
            }),
        )]);
        assert!(classify_api_compatibility(Some(&prior), Some(&next)).is_compatible());
    }

    #[test]
    fn loosened_auth_is_additive_with_advisory() {
        let prior = envelope(vec![(
            definition("fn:existing", true, "authenticated"),
            empty_args(),
        )]);
        let next = baseline();
        let outcome = classify_api_compatibility(Some(&prior), Some(&next));
        assert!(outcome.is_compatible());
        assert_eq!(outcome.advisories.len(), 1);
        assert_eq!(
            outcome.advisories[0].code,
            "SNAPBACK_API_AUTH_REQUIREMENT_LOOSENED"
        );
        assert_eq!(outcome.advisories[0].severity, DiagnosticSeverity::Warning);
    }

    #[test]
    fn absent_prior_is_additive_with_advisory() {
        let next = baseline();
        let outcome = classify_api_compatibility(None, Some(&next));
        assert!(outcome.is_compatible());
        assert_eq!(outcome.advisories.len(), 1);
        assert_eq!(
            outcome.advisories[0].code,
            "SNAPBACK_API_COMPATIBILITY_BASELINE_UNAVAILABLE"
        );
        assert_eq!(
            outcome.advisories[0].message,
            "compatibility baseline unavailable; treated as new baseline"
        );
    }
}
