//! Platform-owned Expo push-token custody and handoff evidence.
//!
//! @ref LLP 0143#d1-device-token-custody — token bytes remain in a protected
//!   system table, with one live owner and generation-fenced retirement.

use crate::auth::wire::SecretInput;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::ids::{self, Kind};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::Read;
use std::net::IpAddr;
use std::sync::OnceLock;

pub use crate::contract_types::PushAudienceReferenceV1;
pub(crate) use crate::contract_types::PushDeferredGrantV1;

pub(crate) const PUSH_TOKEN_MAX_BYTES: usize = 1_024;
pub(crate) const PUSH_INSTALLATION_MAX_BYTES: usize = 64;
pub(crate) const PUSH_BATCH_MESSAGES_MAX: usize = 100;
pub(crate) const PUSH_HANDOFF_LEASE_MS: u64 = 30_000;
pub(crate) const PUSH_RECEIPT_FIRST_POLL_MS: u64 = 900_000;
pub(crate) const PUSH_RECEIPT_WINDOW_MS: u64 = 86_400_000;
pub(crate) const PUSH_RECEIPT_BATCH_MAX: usize = 1_000;
pub(crate) const PUSH_PROVIDER_RESPONSE_MAX_BYTES: u64 = 1_048_576;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushSendRequestV1 {
    pub to: PushAudienceReferenceV1,
    pub title: String,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Map<String, Value>>,
    pub dedupe_key: String,
    /// Explicit acknowledgement that re-driving an ambiguous predecessor may
    /// display the same notification twice. False/missing is always the
    /// deduplicated no-op posture.
    #[serde(default)]
    pub redrive_ambiguous: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PushDeferredGrantRequestV1 {
    pub(crate) to: PushAudienceReferenceV1,
    pub(crate) dedupe_key: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushSendReservationResponseV1 {
    pub intent_id: String,
    pub attempt: u32,
    pub target_count: usize,
    pub batch_count: usize,
    pub state: String,
    pub deduplicated: bool,
}

pub(crate) struct ReservedPushMessageV1 {
    pub(crate) message_id: String,
    pub(crate) token_id: String,
    pub(crate) token: String,
}

pub(crate) struct ReservedPushBatchV1 {
    pub(crate) batch_id: String,
}

pub(crate) struct ReservedPushAttemptV1 {
    pub(crate) response: PushSendReservationResponseV1,
    pub(crate) batches: Vec<ReservedPushBatchV1>,
}

pub(crate) struct PushBatchClaimV1 {
    pub(crate) batch_id: String,
    pub(crate) claim_id: String,
    pub(crate) fence: u64,
    pub(crate) messages: Vec<ReservedPushMessageV1>,
}

pub(crate) struct PushRecoveredBatchV1 {
    pub(crate) claim: PushBatchClaimV1,
    pub(crate) payload: Value,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PushReceiptPollEntryV1 {
    pub(crate) message_id: String,
    pub(crate) token_id: String,
    pub(crate) ticket_id: String,
    pub(crate) poll_count: u8,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PushReceiptPollClaimV1 {
    pub(crate) entries: Vec<PushReceiptPollEntryV1>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PushReceiptOutcomeV1 {
    Ok,
    Error { code: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PushTicketOutcomeV1 {
    Ok { ticket_id: String },
    Error { code: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PushBatchSettlementV1 {
    Tickets {
        http_status: u16,
        outcomes: Vec<PushTicketOutcomeV1>,
    },
    FailedPermanent {
        http_status: Option<u16>,
        code: String,
    },
    FailedConfig {
        http_status: Option<u16>,
        code: String,
    },
    FailedRetryable {
        http_status: Option<u16>,
        code: String,
        retry_at_ms: u64,
    },
    Ambiguous {
        code: String,
    },
}

pub(crate) struct ExpoHttpResponseV1 {
    pub(crate) status: u16,
    pub(crate) body: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ExpoHttpUncertaintyV1 {
    Transport,
    ResponseRead,
    ResponseTooLarge,
}

/// The one bounded HTTP carrier shared by send tickets and receipt polling.
/// It deliberately returns no transport prose: callers can persist only a
/// closed uncertainty class or parse the bounded response through the
/// stage-specific allowlists below.
pub(crate) fn post_expo_json(
    endpoint: &str,
    access_token: Option<&str>,
    payload: Value,
    timeout: std::time::Duration,
) -> Result<ExpoHttpResponseV1, ExpoHttpUncertaintyV1> {
    // @ref LLP 0251#consumerprofile-contract — Expo production is one exact
    // HTTPS authority. The pre-existing local/test override is admitted only
    // when it names a literal loopback HTTP authority; neither branch can be
    // widened by a redirect or inherited proxy.
    let target_policy =
        expo_http_target_policy(endpoint).ok_or(ExpoHttpUncertaintyV1::Transport)?;
    let prepared_target =
        crate::outbound_policy::prepare_http_target(endpoint, target_policy, 4_096)
            .map_err(|_| ExpoHttpUncertaintyV1::Transport)?;
    let agent = crate::outbound_policy::pinned_http_agent(&prepared_target, timeout)
        .map_err(|_| ExpoHttpUncertaintyV1::Transport)?;
    let mut outbound = agent
        .post(prepared_target.authored_url())
        .set("Content-Type", "application/json")
        .set("Accept", "application/json")
        .timeout(timeout);
    if let Some(access_token) = access_token {
        outbound = outbound.set("Authorization", &format!("Bearer {access_token}"));
    }
    let response = match outbound.send_json(payload) {
        Ok(response) | Err(ureq::Error::Status(_, response)) => response,
        Err(ureq::Error::Transport(_)) => return Err(ExpoHttpUncertaintyV1::Transport),
    };
    let status = response.status();
    let mut body = Vec::new();
    let mut reader = response
        .into_reader()
        .take(PUSH_PROVIDER_RESPONSE_MAX_BYTES + 1);
    if reader.read_to_end(&mut body).is_err() {
        return Err(ExpoHttpUncertaintyV1::ResponseRead);
    }
    if body.len() as u64 > PUSH_PROVIDER_RESPONSE_MAX_BYTES {
        return Err(ExpoHttpUncertaintyV1::ResponseTooLarge);
    }
    Ok(ExpoHttpResponseV1 { status, body })
}

fn expo_http_target_policy(endpoint: &str) -> Option<crate::outbound_policy::HttpTargetPolicy> {
    let parsed = ureq::get(endpoint).request_url().ok()?;
    let url = parsed.as_url();
    if url.username() != "" || url.password().is_some() || url.fragment().is_some() {
        return None;
    }
    let host = parsed.host().trim_start_matches('[').trim_end_matches(']');
    let port = parsed
        .port()
        .unwrap_or(if parsed.scheme() == "https" { 443 } else { 80 });
    if parsed.scheme() == "https" && host.eq_ignore_ascii_case("exp.host") && port == 443 {
        return Some(crate::outbound_policy::HttpTargetPolicy::PublicHttpsOnly);
    }
    if parsed.scheme() == "http"
        && host
            .parse::<IpAddr>()
            .ok()
            .is_some_and(|address| address.is_loopback())
    {
        return Some(crate::outbound_policy::HttpTargetPolicy::LocalDevLoopbackHttp);
    }
    None
}

pub(crate) fn expo_send_payload(claim: &PushBatchClaimV1, request: &PushSendRequestV1) -> Value {
    expo_send_payload_from_parts(claim, &request.title, &request.body, request.data.as_ref())
}

fn expo_send_payload_from_parts(
    claim: &PushBatchClaimV1,
    title: &str,
    body: &str,
    data: Option<&Map<String, Value>>,
) -> Value {
    Value::Array(
        claim
            .messages
            .iter()
            .map(|message| {
                json!({
                    "to": message.token,
                    "title": title,
                    "body": body,
                    "data": data,
                })
            })
            .collect(),
    )
}

/// Convert one bounded Expo send response into the closed request/ticket
/// outcome vocabulary. Provider prose is deliberately ignored; only the
/// stage-specific allowlisted code or ticket id crosses into settlement.
pub(crate) fn classify_expo_send_response(
    http_status: u16,
    body: &[u8],
    retry_at_ms: u64,
) -> PushBatchSettlementV1 {
    if http_status == 200 {
        let parse = || -> SnapbackResult<Vec<PushTicketOutcomeV1>> {
            let value: Value = serde_json::from_slice(body).map_err(|_| {
                SnapbackError::error(
                    "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
                    "push",
                    "Expo returned invalid ticket JSON",
                )
            })?;
            let tickets = value.get("data").and_then(Value::as_array).ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
                    "push",
                    "Expo ticket response omitted its data array",
                )
            })?;
            tickets
                .iter()
                .map(
                    |ticket| match ticket.get("status").and_then(Value::as_str) {
                        Some("ok") => {
                            let id = ticket.get("id").and_then(Value::as_str).ok_or_else(|| {
                                SnapbackError::error(
                                    "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
                                    "push",
                                    "Expo ok ticket omitted its id",
                                )
                            })?;
                            validate_provider_id(id)?;
                            Ok(PushTicketOutcomeV1::Ok {
                                ticket_id: id.to_owned(),
                            })
                        }
                        Some("error") => {
                            let code = ticket
                                .get("details")
                                .and_then(|details| details.get("error"))
                                .and_then(Value::as_str)
                                .ok_or_else(|| {
                                    SnapbackError::error(
                                        "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
                                        "push",
                                        "Expo error ticket omitted its allowlisted code",
                                    )
                                })?;
                            validate_ticket_error_code(code)?;
                            Ok(PushTicketOutcomeV1::Error {
                                code: code.to_owned(),
                            })
                        }
                        _ => Err(SnapbackError::error(
                            "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
                            "push",
                            "Expo ticket status is outside the closed vocabulary",
                        )),
                    },
                )
                .collect()
        };
        return match parse() {
            Ok(outcomes) => PushBatchSettlementV1::Tickets {
                http_status,
                outcomes,
            },
            Err(_) => PushBatchSettlementV1::Ambiguous {
                code: "provider-shape-invalid".into(),
            },
        };
    }

    let unauthorized = (http_status == 400 || http_status == 401)
        && serde_json::from_slice::<Value>(body)
            .ok()
            .is_some_and(|value| {
                value
                    .get("errors")
                    .and_then(Value::as_array)
                    .is_some_and(|errors| {
                        errors.iter().any(|error| {
                            error.get("code").and_then(Value::as_str) == Some("UNAUTHORIZED")
                        })
                    })
            });
    if unauthorized || http_status == 401 {
        PushBatchSettlementV1::FailedConfig {
            http_status: Some(http_status),
            code: "UNAUTHORIZED".into(),
        }
    } else if http_status == 400 {
        PushBatchSettlementV1::FailedPermanent {
            http_status: Some(http_status),
            code: "http-400".into(),
        }
    } else if http_status == 429 {
        PushBatchSettlementV1::FailedRetryable {
            http_status: Some(http_status),
            code: "http-429".into(),
            retry_at_ms,
        }
    } else if (500..=599).contains(&http_status) {
        PushBatchSettlementV1::FailedRetryable {
            http_status: Some(http_status),
            code: "http-5xx".into(),
            retry_at_ms,
        }
    } else {
        PushBatchSettlementV1::FailedPermanent {
            http_status: Some(http_status),
            code: "http-400".into(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PushTriggerModeV1 {
    Immediate,
    System,
    Deferred,
}

impl PushTriggerModeV1 {
    fn as_str(self) -> &'static str {
        match self {
            Self::Immediate => "immediate",
            Self::System => "system",
            Self::Deferred => "deferred",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushAppScopeV1 {
    pub eas_project_id: String,
    pub application_id: String,
    pub environment: String,
}

impl PushAppScopeV1 {
    pub(crate) fn validate(&self) -> SnapbackResult<()> {
        for (field, value) in [
            ("easProjectId", &self.eas_project_id),
            ("applicationId", &self.application_id),
            ("environment", &self.environment),
        ] {
            if value.is_empty()
                || value.len() > 255
                || !value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"._-:".contains(&byte))
            {
                return Err(invalid(format!(
                    "push appScope.{field} must be 1..255 ASCII letters, digits, '.', '_', '-', or ':'"
                )));
            }
        }
        Ok(())
    }

    pub(crate) fn identity(&self) -> String {
        format!(
            "{}:{}|{}:{}|{}:{}",
            self.eas_project_id.len(),
            self.eas_project_id,
            self.application_id.len(),
            self.application_id,
            self.environment.len(),
            self.environment,
        )
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushRegistryDeclarationV1 {
    pub idle_retention_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushLedgerDeclarationV1 {
    pub retention_ms: u64,
}

/// The closed v1 resolver vocabulary: all current rows of one LLP 0100
/// membership declaration, optionally narrowed to declared roles.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PushAudienceResolverV1 {
    ExplicitPrincipals {
        principals_arg: String,
        max_items: u16,
    },
    Membership {
        declaration: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resource_arg: Option<String>,
        roles: Vec<String>,
    },
}

/// Host-enforced send authorization. Membership checks are evaluated against
/// the resolved caller at execution; `system` is an explicit declaration,
/// never an inference from a cron/job action.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PushAudienceAuthorizeV1 {
    Membership {
        declaration: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resource_arg: Option<String>,
        roles: Vec<String>,
    },
    System,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushAudienceDeclarationV1 {
    pub resolve: PushAudienceResolverV1,
    pub authorize: PushAudienceAuthorizeV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushSeamDeclarationV1 {
    pub app_scope: PushAppScopeV1,
    pub registry: PushRegistryDeclarationV1,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub audiences: BTreeMap<String, PushAudienceDeclarationV1>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub uses: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ledger: Option<PushLedgerDeclarationV1>,
}

impl PushSeamDeclarationV1 {
    pub(crate) fn validate(&self) -> SnapbackResult<()> {
        self.app_scope.validate()?;
        if !(86_400_000..=31_536_000_000).contains(&self.registry.idle_retention_ms) {
            return Err(invalid(
                "push registry idleRetentionMs must be between one day and one year",
            ));
        }
        if self.audiences.is_empty() != self.ledger.is_none() {
            return Err(invalid(
                "push audiences and ledger must be declared together",
            ));
        }
        if let Some(ledger) = &self.ledger
            && !(86_400_000..=31_536_000_000).contains(&ledger.retention_ms)
        {
            return Err(invalid(
                "push ledger retentionMs must be between one day and one year",
            ));
        }
        if self.uses.len() > 16
            || self.uses.iter().any(|name| {
                name.is_empty()
                    || name.len() > 64
                    || !name
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
            })
            || self
                .uses
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                != self.uses.len()
        {
            return Err(invalid("push uses must be distinct bounded config names"));
        }
        for (name, audience) in &self.audiences {
            if name.is_empty()
                || name.len() > 64
                || !name.bytes().enumerate().all(|(index, byte)| {
                    byte.is_ascii_alphabetic()
                        || byte == b'_'
                        || (index > 0 && byte.is_ascii_digit())
                })
            {
                return Err(invalid("push audience name is invalid"));
            }
            validate_membership_clause(match &audience.resolve {
                PushAudienceResolverV1::ExplicitPrincipals {
                    principals_arg,
                    max_items,
                } => {
                    if !is_push_identifier(principals_arg) || !(1..=1_000).contains(max_items) {
                        return Err(invalid("push explicit-principals resolver is invalid"));
                    }
                    None
                }
                PushAudienceResolverV1::Membership {
                    declaration,
                    resource_arg,
                    roles,
                } => Some((declaration, resource_arg, roles)),
            })?;
            if let PushAudienceAuthorizeV1::Membership {
                declaration,
                resource_arg,
                roles,
            } = &audience.authorize
            {
                validate_membership_clause(Some((declaration, resource_arg, roles)))?;
                if let PushAudienceResolverV1::ExplicitPrincipals { principals_arg, .. } =
                    &audience.resolve
                    && resource_arg.as_ref() == Some(principals_arg)
                {
                    return Err(invalid(
                        "push resolver and authorization arguments have incompatible shapes",
                    ));
                }
            }
        }
        Ok(())
    }
}

pub(crate) fn validate_declaration_against_schema(
    declaration: &PushSeamDeclarationV1,
    schema: &crate::manifest::SchemaManifest,
) -> SnapbackResult<()> {
    declaration.validate()?;
    for audience in declaration.audiences.values() {
        let validate = |declaration_id: &str,
                        resource_arg: &Option<String>,
                        roles: &[String]|
         -> SnapbackResult<()> {
            let Some((_table, membership)) =
                crate::membership_rules::find_declaration(schema, declaration_id)
            else {
                return Err(invalid(
                    "push audience names an unknown membership declaration",
                ));
            };
            let resource_shape_matches = match membership.scope {
                crate::manifest::MembershipScope::Resource => resource_arg.is_some(),
                crate::manifest::MembershipScope::App => resource_arg.is_none(),
            };
            if !resource_shape_matches
                || roles
                    .iter()
                    .any(|role| !membership.vocabulary().any(|candidate| candidate == role))
            {
                return Err(invalid(
                    "push audience membership clause does not match its declaration",
                ));
            }
            Ok(())
        };
        match &audience.resolve {
            PushAudienceResolverV1::ExplicitPrincipals { .. } => {}
            PushAudienceResolverV1::Membership {
                declaration,
                resource_arg,
                roles,
            } => validate(declaration, resource_arg, roles)?,
        }
        if let PushAudienceAuthorizeV1::Membership {
            declaration,
            resource_arg,
            roles,
        } = &audience.authorize
        {
            validate(declaration, resource_arg, roles)?;
        }
    }
    Ok(())
}

pub(crate) fn validate_config_uses(
    declaration: &PushSeamDeclarationV1,
    functions: &crate::manifest::FunctionManifest,
) -> SnapbackResult<()> {
    let declared = functions
        .config
        .iter()
        .map(|entry| entry.name.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    if declaration
        .uses
        .iter()
        .any(|name| !declared.contains(name.as_str()))
    {
        return Err(SnapbackError::error(
            "SNAPBACK_CONFIG_USES_UNKNOWN",
            "config",
            "definePushSeam uses names an undeclared config entry",
        ));
    }
    Ok(())
}

fn validate_membership_clause(
    clause: Option<(&String, &Option<String>, &Vec<String>)>,
) -> SnapbackResult<()> {
    let Some((declaration, resource_arg, roles)) = clause else {
        return Ok(());
    };
    if !is_push_identifier(declaration)
        || resource_arg
            .as_deref()
            .is_some_and(|value| !is_push_identifier(value))
        || roles.is_empty()
        || roles.len() > 64
        || roles.iter().any(|role| !is_push_identifier(role))
    {
        return Err(invalid("push membership clause is invalid"));
    }
    Ok(())
}

fn is_push_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphabetic()
                || byte == b'_'
                || byte == b'-'
                || (index > 0 && byte.is_ascii_digit())
        })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RegisterPushTokenRequest {
    pub(crate) installation_id: String,
    pub(crate) token: SecretInput,
}

impl std::fmt::Debug for RegisterPushTokenRequest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RegisterPushTokenRequest")
            .field("installation_id", &self.installation_id)
            .field("token", &"[REDACTED]")
            .finish()
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UnregisterPushTokenRequest {
    pub(crate) installation_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PushTokenRegistrationResponse {
    pub(crate) token_id: String,
    pub(crate) installation_id: String,
    pub(crate) registered_at: u64,
    pub(crate) rotated: bool,
    pub(crate) ownership_transferred: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PushTokenUnregisterResponse {
    pub(crate) token_id: Option<String>,
    pub(crate) retired: bool,
}

pub(crate) struct Registration<'a> {
    pub(crate) declaration: &'a PushSeamDeclarationV1,
    pub(crate) principal_id: &'a str,
    pub(crate) session_id: &'a str,
    pub(crate) session_generation: u64,
    pub(crate) installation_id: &'a str,
    pub(crate) token: &'a str,
    pub(crate) now_ms: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PushRegistryInspectionV1 {
    pub live_tokens: u64,
    pub retired_tokens: u64,
    pub retirement_reasons: BTreeMap<String, u64>,
}

/// One privacy-bounded row from the declared push handoff ledger. The
/// projection is deliberately flat (one row per provider message, or one
/// intent-only row for a zero-target send) so every generated client can
/// express it without platform-owned nested types. Token bytes, payloads,
/// audience arguments, and provider prose never enter this carrier.
///
/// @ref LLP 0143#d6-activation-migration-and-the-no-op-posture — the packaged
///   read contract exposes lifecycle facts and opaque ids only.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PushLedgerRowV1 {
    #[serde(skip)]
    pub(crate) id: String,
    pub(crate) intent_id: String,
    pub(crate) trigger_mode: String,
    pub(crate) intent_state: String,
    pub(crate) attempt_count: u32,
    pub(crate) created_at_ms: u64,
    pub(crate) updated_at_ms: u64,
    pub(crate) expires_at_ms: u64,
    pub(crate) batch_id: Option<String>,
    pub(crate) attempt_number: Option<u32>,
    pub(crate) batch_index: Option<u32>,
    pub(crate) batch_state: Option<String>,
    pub(crate) transmitting_at_ms: Option<u64>,
    pub(crate) settled_at_ms: Option<u64>,
    pub(crate) http_status: Option<u16>,
    pub(crate) request_error_code: Option<String>,
    pub(crate) previous_ambiguous: Option<bool>,
    pub(crate) message_id: Option<String>,
    pub(crate) token_id: Option<String>,
    pub(crate) message_state: Option<String>,
    pub(crate) ticket_id: Option<String>,
    pub(crate) receipt_poll_count: Option<u8>,
    pub(crate) next_receipt_poll_at_ms: Option<u64>,
    pub(crate) receipt_window_closes_at_ms: Option<u64>,
    pub(crate) handed_to_expo_at_ms: Option<u64>,
    pub(crate) expo_accepted_at_ms: Option<u64>,
    pub(crate) expo_error_code: Option<String>,
    pub(crate) retirement_effect: Option<bool>,
}

impl PushLedgerRowV1 {
    pub(crate) fn to_row_value(&self) -> Value {
        let mut value = serde_json::to_value(self).expect("push ledger row is serializable");
        value
            .as_object_mut()
            .expect("push ledger row serializes as an object")
            .insert("_id".to_owned(), Value::String(self.id.clone()));
        value
    }
}

const SESSION_TERMINAL_TRIGGER_SQL: &str = "
CREATE TRIGGER IF NOT EXISTS _snapback_push_session_terminal_v1
  AFTER UPDATE OF generation, revoked_at_ms ON _auth_sessions
  WHEN NEW.revoked_at_ms IS NOT NULL
    AND (OLD.revoked_at_ms IS NULL OR NEW.generation != OLD.generation)
BEGIN
  UPDATE _snapback_push_tokens_v1
  SET retired_at_ms = NEW.revoked_at_ms,
      retirement_reason = 'session-ended',
      retirement_reference = OLD.id,
      token_bytes = '', token_hash = zeroblob(32)
  WHERE session_id = OLD.id AND session_generation = OLD.generation
    AND retired_at_ms IS NULL;
END;";

const CLOCK_FLOOR_INSERT_TRIGGER_SQL: &str = "
CREATE TRIGGER IF NOT EXISTS _snapback_push_clock_floor_insert_v1
  AFTER INSERT ON _snapback_meta
  WHEN NEW.key = 'auth_session_clock_floor_ms'
BEGIN
  UPDATE _snapback_push_tokens_v1
  SET retired_at_ms = CAST(NEW.value AS INTEGER),
      retirement_reason = 'session-expired',
      retirement_reference = session_id,
      token_bytes = '', token_hash = zeroblob(32)
  WHERE retired_at_ms IS NULL AND EXISTS(
    SELECT 1 FROM _auth_sessions AS session
    WHERE session.id = _snapback_push_tokens_v1.session_id
      AND session.generation = _snapback_push_tokens_v1.session_generation
      AND session.expires_at_ms <= CAST(NEW.value AS INTEGER)
  );
END;";

const CLOCK_FLOOR_UPDATE_TRIGGER_SQL: &str = "
CREATE TRIGGER IF NOT EXISTS _snapback_push_clock_floor_update_v1
  AFTER UPDATE OF value ON _snapback_meta
  WHEN NEW.key = 'auth_session_clock_floor_ms'
BEGIN
  UPDATE _snapback_push_tokens_v1
  SET retired_at_ms = CAST(NEW.value AS INTEGER),
      retirement_reason = 'session-expired',
      retirement_reference = session_id,
      token_bytes = '', token_hash = zeroblob(32)
  WHERE retired_at_ms IS NULL AND EXISTS(
    SELECT 1 FROM _auth_sessions AS session
    WHERE session.id = _snapback_push_tokens_v1.session_id
      AND session.generation = _snapback_push_tokens_v1.session_generation
      AND session.expires_at_ms <= CAST(NEW.value AS INTEGER)
  );
END;";

const REGISTRY_TABLE_SQL: &str = "
CREATE TABLE IF NOT EXISTS _snapback_push_tokens_v1 (
  id TEXT NOT NULL PRIMARY KEY,
  app_scope TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  token_hash BLOB NOT NULL CHECK(length(token_hash) = 32),
  token_bytes TEXT NOT NULL,
  session_id TEXT NOT NULL,
  session_generation INTEGER NOT NULL CHECK(session_generation >= 1),
  registered_at_ms INTEGER NOT NULL CHECK(registered_at_ms >= 0),
  last_registered_at_ms INTEGER NOT NULL CHECK(last_registered_at_ms >= registered_at_ms),
  last_successful_handoff_at_ms INTEGER,
  retired_at_ms INTEGER,
  retirement_reason TEXT,
  retirement_reference TEXT,
  CHECK((retired_at_ms IS NULL) = (retirement_reason IS NULL))
);";

const OWNER_LIVE_INDEX_SQL: &str = "
CREATE UNIQUE INDEX IF NOT EXISTS _snapback_push_tokens_v1_owner_live
  ON _snapback_push_tokens_v1(app_scope, principal_id, installation_id)
  WHERE retired_at_ms IS NULL;";

const BYTES_LIVE_INDEX_SQL: &str = "
CREATE UNIQUE INDEX IF NOT EXISTS _snapback_push_tokens_v1_bytes_live
  ON _snapback_push_tokens_v1(token_hash)
  WHERE retired_at_ms IS NULL;";

const SESSION_LIVE_INDEX_SQL: &str = "
CREATE INDEX IF NOT EXISTS _snapback_push_tokens_v1_session_live
  ON _snapback_push_tokens_v1(session_id, session_generation)
  WHERE retired_at_ms IS NULL;";

const IDLE_LIVE_INDEX_SQL: &str = "
CREATE INDEX IF NOT EXISTS _snapback_push_tokens_v1_idle_live
  ON _snapback_push_tokens_v1(last_registered_at_ms, id)
  WHERE retired_at_ms IS NULL;";

const INTENT_TABLE_SQL: &str = "
CREATE TABLE IF NOT EXISTS _snapback_push_intents_v1 (
  id TEXT NOT NULL PRIMARY KEY,
  app_scope TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  binding_hash BLOB NOT NULL CHECK(length(binding_hash) = 32),
  audience_name TEXT NOT NULL,
  audience_args_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  trigger_mode TEXT NOT NULL CHECK(trigger_mode IN ('immediate', 'system', 'deferred')),
  state TEXT NOT NULL CHECK(state IN ('reserved', 'handed-to-expo', 'expo-accepted', 'expo-error', 'failed-permanent', 'failed-config', 'failed-retryable', 'ambiguous', 'ambiguous-receipt', 'zero-target')),
  attempt_count INTEGER NOT NULL CHECK(attempt_count >= 1),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
  updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= created_at_ms),
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms >= updated_at_ms),
  UNIQUE(app_scope, dedupe_key)
);";

const BATCH_TABLE_SQL: &str = "
CREATE TABLE IF NOT EXISTS _snapback_push_batches_v1 (
  id TEXT NOT NULL PRIMARY KEY,
  intent_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK(attempt_number >= 1),
  batch_index INTEGER NOT NULL CHECK(batch_index >= 0),
  state TEXT NOT NULL CHECK(state IN ('reserved', 'claimed', 'transmitting', 'settled', 'ambiguous')),
  claim_id TEXT,
  claim_fence INTEGER NOT NULL DEFAULT 0 CHECK(claim_fence >= 0),
  claim_expires_at_ms INTEGER,
  transmitting_at_ms INTEGER,
  settled_at_ms INTEGER,
  http_status INTEGER,
  request_error_code TEXT,
  retry_at_ms INTEGER,
  previous_ambiguous INTEGER NOT NULL DEFAULT 0 CHECK(previous_ambiguous IN (0, 1)),
  UNIQUE(intent_id, attempt_number, batch_index),
  FOREIGN KEY(intent_id) REFERENCES _snapback_push_intents_v1(id) ON DELETE CASCADE
);";

const MESSAGE_TABLE_SQL: &str = "
CREATE TABLE IF NOT EXISTS _snapback_push_messages_v1 (
  id TEXT NOT NULL PRIMARY KEY,
  batch_id TEXT NOT NULL,
  token_id TEXT NOT NULL,
  token_hash BLOB NOT NULL CHECK(length(token_hash) = 32),
  token_bytes TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('reserved', 'handed-to-expo', 'expo-accepted', 'expo-error', 'expo-error-config', 'expo-error-rate', 'failed-permanent', 'ambiguous', 'ambiguous-receipt')),
  ticket_id TEXT,
  receipt_poll_count INTEGER NOT NULL DEFAULT 0 CHECK(receipt_poll_count BETWEEN 0 AND 7),
  next_receipt_poll_at_ms INTEGER,
  receipt_window_closes_at_ms INTEGER,
  handed_to_expo_at_ms INTEGER,
  expo_accepted_at_ms INTEGER,
  expo_error_code TEXT,
  retirement_effect INTEGER NOT NULL DEFAULT 0 CHECK(retirement_effect IN (0, 1)),
  UNIQUE(batch_id, token_id),
  FOREIGN KEY(batch_id) REFERENCES _snapback_push_batches_v1(id) ON DELETE CASCADE
);";

const BATCH_RECOVERY_INDEX_SQL: &str = "
CREATE INDEX IF NOT EXISTS _snapback_push_batches_v1_recovery
  ON _snapback_push_batches_v1(state, claim_expires_at_ms, id);";
const MESSAGE_RECEIPT_INDEX_SQL: &str = "
CREATE INDEX IF NOT EXISTS _snapback_push_messages_v1_receipts
  ON _snapback_push_messages_v1(state, next_receipt_poll_at_ms, id);";
const INTENT_EXPIRY_INDEX_SQL: &str = "
CREATE INDEX IF NOT EXISTS _snapback_push_intents_v1_expiry
  ON _snapback_push_intents_v1(expires_at_ms, id);";

fn create_ledger_infra(conn: &Connection) -> SnapbackResult<()> {
    conn.execute_batch(INTENT_TABLE_SQL)?;
    conn.execute_batch(BATCH_TABLE_SQL)?;
    conn.execute_batch(MESSAGE_TABLE_SQL)?;
    conn.execute_batch(BATCH_RECOVERY_INDEX_SQL)?;
    conn.execute_batch(MESSAGE_RECEIPT_INDEX_SQL)?;
    conn.execute_batch(INTENT_EXPIRY_INDEX_SQL)?;
    Ok(())
}

fn drop_ledger_infra(conn: &Connection) -> SnapbackResult<()> {
    conn.execute_batch(
        "DROP TABLE IF EXISTS _snapback_push_messages_v1;
         DROP TABLE IF EXISTS _snapback_push_batches_v1;
         DROP TABLE IF EXISTS _snapback_push_intents_v1;",
    )?;
    Ok(())
}

pub(crate) fn require_secure_delete(conn: &Connection) -> SnapbackResult<()> {
    conn.execute_batch("PRAGMA secure_delete = ON;")?;
    let enabled: i64 = conn.query_row("PRAGMA secure_delete", [], |row| row.get(0))?;
    if enabled != 1 {
        return Err(corrupt(
            "push-token custody requires SQLite secure deletion",
        ));
    }
    Ok(())
}

fn auth_lifecycle_catalog_present(conn: &Connection) -> SnapbackResult<bool> {
    let count: u8 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_schema
         WHERE type = 'table' AND name IN ('_auth_sessions', '_snapback_meta')",
        [],
        |row| row.get(0),
    )?;
    Ok(count == 2)
}

pub(crate) fn create_infra(conn: &Connection) -> SnapbackResult<()> {
    require_secure_delete(conn)?;
    conn.execute_batch(REGISTRY_TABLE_SQL)?;
    conn.execute_batch(OWNER_LIVE_INDEX_SQL)?;
    conn.execute_batch(BYTES_LIVE_INDEX_SQL)?;
    conn.execute_batch(SESSION_LIVE_INDEX_SQL)?;
    conn.execute_batch(IDLE_LIVE_INDEX_SQL)?;
    if auth_lifecycle_catalog_present(conn)? {
        conn.execute_batch(SESSION_TERMINAL_TRIGGER_SQL)?;
        conn.execute_batch(CLOCK_FLOOR_INSERT_TRIGGER_SQL)?;
        conn.execute_batch(CLOCK_FLOOR_UPDATE_TRIGGER_SQL)?;
        validate_exact_schema(conn)?;
    } else {
        // Sessions deployments stage their app schema before the auth catalog
        // exists. Validate the protected table/index shape now; the sessions
        // consume transaction installs and revalidates the lifecycle triggers.
        validate_exact_staged_schema(conn)?;
    }
    Ok(())
}

/// Refuse a preexisting or subsequently tampered protected catalog rather
/// than allowing `CREATE IF NOT EXISTS` to adopt a lookalike custody shape.
/// Callers invoke this only for a declared seam; the undeclared path performs
/// no registry inventory query.
///
/// @ref LLP 0143#d1-device-token-custody — protected token storage is an
///   exact platform catalog, not an adoptable application-owned lookalike.
pub(crate) fn validate_exact_schema(conn: &Connection) -> SnapbackResult<()> {
    let actual = registry_shape(conn)
        .map_err(|_| corrupt("push-token custody catalog physical shape could not be inspected"))?;
    let expected = expected_registry_shape()
        .map_err(|_| corrupt("push-token custody reference catalog could not be constructed"))?;
    if actual != *expected {
        return Err(corrupt(
            "push-token custody catalog differs from the exact protected shape",
        ));
    }
    Ok(())
}

fn validate_exact_staged_schema(conn: &Connection) -> SnapbackResult<()> {
    let actual = registry_shape(conn)
        .map_err(|_| corrupt("push-token custody catalog physical shape could not be inspected"))?;
    let expected = expected_registry_shape()
        .map_err(|_| corrupt("push-token custody reference catalog could not be constructed"))?;
    let actual_objects = actual
        .objects
        .iter()
        .filter(|(_, object)| object.kind != "trigger")
        .collect::<Vec<_>>();
    let expected_objects = expected
        .objects
        .iter()
        .filter(|(_, object)| object.kind != "trigger")
        .collect::<Vec<_>>();
    if actual
        .objects
        .values()
        .any(|object| object.kind == "trigger")
        || actual_objects != expected_objects
        || actual.columns != expected.columns
        || actual.foreign_keys != expected.foreign_keys
        || actual.indexes != expected.indexes
    {
        return Err(corrupt(
            "staged push-token custody catalog differs from the exact protected shape",
        ));
    }
    Ok(())
}

#[derive(Debug, Eq, PartialEq)]
struct LedgerShape {
    objects: BTreeMap<String, RegistryObjectShape>,
    tables: BTreeMap<String, LedgerTableShape>,
}

#[derive(Debug, Eq, PartialEq)]
struct LedgerTableShape {
    columns: Vec<ColumnShape>,
    foreign_keys: Vec<ForeignKeyShape>,
    indexes: BTreeMap<String, IndexShape>,
}

pub(crate) fn validate_exact_ledger_schema(conn: &Connection) -> SnapbackResult<()> {
    let actual = ledger_shape(conn)
        .map_err(|_| corrupt("push ledger catalog physical shape could not be inspected"))?;
    let expected = expected_ledger_shape()
        .map_err(|_| corrupt("push ledger reference catalog could not be constructed"))?;
    if actual != *expected {
        return Err(corrupt(
            "push ledger catalog differs from the exact protected shape",
        ));
    }
    Ok(())
}

fn expected_ledger_shape() -> SnapbackResult<&'static LedgerShape> {
    static EXPECTED: OnceLock<Result<LedgerShape, SnapbackError>> = OnceLock::new();
    match EXPECTED.get_or_init(|| {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        create_ledger_infra(&conn)?;
        ledger_shape(&conn)
    }) {
        Ok(shape) => Ok(shape),
        Err(error) => Err(error.clone()),
    }
}

fn ledger_shape(conn: &Connection) -> SnapbackResult<LedgerShape> {
    const TABLES: [&str; 3] = [
        "_snapback_push_intents_v1",
        "_snapback_push_batches_v1",
        "_snapback_push_messages_v1",
    ];
    const INDEXES: [(&str, &str); 6] = [
        (
            "_snapback_push_intents_v1",
            "sqlite_autoindex__snapback_push_intents_v1_2",
        ),
        (
            "_snapback_push_intents_v1",
            "_snapback_push_intents_v1_expiry",
        ),
        (
            "_snapback_push_batches_v1",
            "sqlite_autoindex__snapback_push_batches_v1_2",
        ),
        (
            "_snapback_push_batches_v1",
            "_snapback_push_batches_v1_recovery",
        ),
        (
            "_snapback_push_messages_v1",
            "sqlite_autoindex__snapback_push_messages_v1_2",
        ),
        (
            "_snapback_push_messages_v1",
            "_snapback_push_messages_v1_receipts",
        ),
    ];
    let mut objects = BTreeMap::new();
    let mut object_statement = conn.prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_schema
         WHERE tbl_name IN (
           '_snapback_push_intents_v1',
           '_snapback_push_batches_v1',
           '_snapback_push_messages_v1'
         ) ORDER BY type, name",
    )?;
    for row in object_statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })? {
        let (kind, name, table, sql) = row?;
        objects.insert(name, RegistryObjectShape { kind, table, sql });
    }

    let mut tables = BTreeMap::new();
    for table in TABLES {
        let mut columns_statement = conn.prepare(&format!("PRAGMA table_xinfo('{table}')"))?;
        let columns = columns_statement
            .query_map([], |row| {
                Ok(ColumnShape {
                    position: row.get(0)?,
                    name: row.get(1)?,
                    declared_type: row.get(2)?,
                    not_null: row.get::<_, i64>(3)? != 0,
                    default_sql: row.get(4)?,
                    primary_key_position: row.get(5)?,
                    hidden: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut foreign_key_statement =
            conn.prepare(&format!("PRAGMA foreign_key_list('{table}')"))?;
        let mut foreign_keys = foreign_key_statement
            .query_map([], |row| {
                Ok(ForeignKeyShape {
                    id: row.get(0)?,
                    sequence: row.get(1)?,
                    target_table: row.get(2)?,
                    from_column: row.get(3)?,
                    to_column: row.get(4)?,
                    on_update: row.get(5)?,
                    on_delete: row.get(6)?,
                    match_name: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        foreign_keys.sort();
        let mut indexes = BTreeMap::new();
        for (_, index) in INDEXES.iter().filter(|(owner, _)| owner == &table) {
            let mut list_statement = conn.prepare(&format!("PRAGMA index_list('{table}')"))?;
            let mut list_rows = list_statement.query([])?;
            let mut list_entry = None;
            while let Some(row) = list_rows.next()? {
                if row.get::<_, String>(1)? == *index {
                    list_entry = Some((
                        row.get::<_, i64>(2)? != 0,
                        row.get(3)?,
                        row.get::<_, i64>(4)? != 0,
                    ));
                    break;
                }
            }
            let mut column_statement = conn.prepare(&format!("PRAGMA index_xinfo('{index}')"))?;
            let columns = column_statement
                .query_map([], |row| {
                    Ok(IndexColumnShape {
                        sequence: row.get(0)?,
                        column_id: row.get(1)?,
                        name: row.get(2)?,
                        descending: row.get::<_, i64>(3)? != 0,
                        collation: row.get(4)?,
                        key_column: row.get::<_, i64>(5)? != 0,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            indexes.insert(
                (*index).to_owned(),
                IndexShape {
                    list_entry,
                    columns,
                },
            );
        }
        tables.insert(
            table.to_owned(),
            LedgerTableShape {
                columns,
                foreign_keys,
                indexes,
            },
        );
    }
    Ok(LedgerShape { objects, tables })
}

#[derive(Debug, Eq, PartialEq)]
struct RegistryShape {
    objects: BTreeMap<String, RegistryObjectShape>,
    columns: Vec<ColumnShape>,
    foreign_keys: Vec<ForeignKeyShape>,
    indexes: BTreeMap<String, IndexShape>,
}

#[derive(Debug, Eq, PartialEq)]
struct RegistryObjectShape {
    kind: String,
    table: String,
    sql: Option<String>,
}

#[derive(Debug, Eq, PartialEq)]
struct ColumnShape {
    position: i64,
    name: String,
    declared_type: String,
    not_null: bool,
    default_sql: Option<String>,
    primary_key_position: i64,
    hidden: i64,
}

#[derive(Debug, Eq, PartialEq, Ord, PartialOrd)]
struct ForeignKeyShape {
    id: i64,
    sequence: i64,
    target_table: String,
    from_column: String,
    to_column: String,
    on_update: String,
    on_delete: String,
    match_name: String,
}

#[derive(Debug, Eq, PartialEq)]
struct IndexShape {
    list_entry: Option<(bool, String, bool)>,
    columns: Vec<IndexColumnShape>,
}

#[derive(Debug, Eq, PartialEq)]
struct IndexColumnShape {
    sequence: i64,
    column_id: i64,
    name: Option<String>,
    descending: bool,
    collation: String,
    key_column: bool,
}

fn expected_registry_shape() -> SnapbackResult<&'static RegistryShape> {
    static EXPECTED: OnceLock<Result<RegistryShape, SnapbackError>> = OnceLock::new();
    match EXPECTED.get_or_init(|| {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "CREATE TABLE _auth_sessions(
               id TEXT, generation INTEGER, revoked_at_ms INTEGER, expires_at_ms INTEGER
             );
             CREATE TABLE _snapback_meta(key TEXT, value TEXT);",
        )?;
        conn.execute_batch(REGISTRY_TABLE_SQL)?;
        conn.execute_batch(OWNER_LIVE_INDEX_SQL)?;
        conn.execute_batch(BYTES_LIVE_INDEX_SQL)?;
        conn.execute_batch(SESSION_LIVE_INDEX_SQL)?;
        conn.execute_batch(IDLE_LIVE_INDEX_SQL)?;
        conn.execute_batch(SESSION_TERMINAL_TRIGGER_SQL)?;
        conn.execute_batch(CLOCK_FLOOR_INSERT_TRIGGER_SQL)?;
        conn.execute_batch(CLOCK_FLOOR_UPDATE_TRIGGER_SQL)?;
        registry_shape(&conn)
    }) {
        Ok(shape) => Ok(shape),
        Err(error) => Err(error.clone()),
    }
}

#[cfg(test)]
pub(crate) fn expected_registry_owner_index_sql_for_test() -> SnapbackResult<&'static str> {
    expected_registry_shape()?
        .objects
        .get("_snapback_push_tokens_v1_owner_live")
        .and_then(|object| object.sql.as_deref())
        .ok_or_else(|| corrupt("test reference index SQL is missing"))
}

fn registry_shape(conn: &Connection) -> SnapbackResult<RegistryShape> {
    const INDEX_NAMES: [&str; 5] = [
        "sqlite_autoindex__snapback_push_tokens_v1_1",
        "_snapback_push_tokens_v1_owner_live",
        "_snapback_push_tokens_v1_bytes_live",
        "_snapback_push_tokens_v1_session_live",
        "_snapback_push_tokens_v1_idle_live",
    ];

    let mut objects = BTreeMap::new();
    let mut statement = conn.prepare(
        "SELECT type, name, tbl_name, sql
         FROM sqlite_schema
         WHERE tbl_name = '_snapback_push_tokens_v1'
            OR name IN (
              '_snapback_push_session_terminal_v1',
              '_snapback_push_clock_floor_insert_v1',
              '_snapback_push_clock_floor_update_v1'
            )
         ORDER BY type, name",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;
    for row in rows {
        let (kind, name, table, sql) = row?;
        objects.insert(name, RegistryObjectShape { kind, table, sql });
    }

    let mut column_statement = conn.prepare("PRAGMA table_xinfo('_snapback_push_tokens_v1')")?;
    let columns = column_statement
        .query_map([], |row| {
            Ok(ColumnShape {
                position: row.get(0)?,
                name: row.get(1)?,
                declared_type: row.get(2)?,
                not_null: row.get::<_, i64>(3)? != 0,
                default_sql: row.get(4)?,
                primary_key_position: row.get(5)?,
                hidden: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut foreign_key_statement =
        conn.prepare("PRAGMA foreign_key_list('_snapback_push_tokens_v1')")?;
    let mut foreign_keys = foreign_key_statement
        .query_map([], |row| {
            Ok(ForeignKeyShape {
                id: row.get(0)?,
                sequence: row.get(1)?,
                target_table: row.get(2)?,
                from_column: row.get(3)?,
                to_column: row.get(4)?,
                on_update: row.get(5)?,
                on_delete: row.get(6)?,
                match_name: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    foreign_keys.sort();

    let mut indexes = BTreeMap::new();
    for name in INDEX_NAMES {
        let mut list_statement = conn.prepare("PRAGMA index_list('_snapback_push_tokens_v1')")?;
        let mut list_rows = list_statement.query([])?;
        let mut list_entry = None;
        while let Some(row) = list_rows.next()? {
            if row.get::<_, String>(1)? == name {
                list_entry = Some((
                    row.get::<_, i64>(2)? != 0,
                    row.get(3)?,
                    row.get::<_, i64>(4)? != 0,
                ));
                break;
            }
        }
        let pragma = format!("PRAGMA index_xinfo('{name}')");
        let mut column_statement = conn.prepare(&pragma)?;
        let columns = column_statement
            .query_map([], |row| {
                Ok(IndexColumnShape {
                    sequence: row.get(0)?,
                    column_id: row.get(1)?,
                    name: row.get(2)?,
                    descending: row.get::<_, i64>(3)? != 0,
                    collation: row.get(4)?,
                    key_column: row.get::<_, i64>(5)? != 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        indexes.insert(
            name.to_owned(),
            IndexShape {
                list_entry,
                columns,
            },
        );
    }
    Ok(RegistryShape {
        objects,
        columns,
        foreign_keys,
        indexes,
    })
}

pub(crate) fn is_exact_auth_lifecycle_trigger(name: &str, table: &str, sql: Option<&str>) -> bool {
    matches!(
        (name, table),
        ("_snapback_push_session_terminal_v1", "_auth_sessions")
            | ("_snapback_push_clock_floor_insert_v1", "_snapback_meta")
            | ("_snapback_push_clock_floor_update_v1", "_snapback_meta")
    ) && expected_registry_shape()
        .ok()
        .and_then(|shape| shape.objects.get(name))
        .is_some_and(|object| {
            object.kind == "trigger" && object.table == table && object.sql.as_deref() == sql
        })
}

/// Install or remove the registry as part of schema activation. Undeclared
/// applications retain no table, triggers, maintenance work, or inspection
/// query. A changed app scope cannot strand a live owner under the old scope.
pub(crate) fn activate_manifest_in(
    tx: &Transaction<'_>,
    declaration: Option<&PushSeamDeclarationV1>,
) -> SnapbackResult<()> {
    let Some(declaration) = declaration else {
        // DROP is a custody erasure, not merely a schema transition. Ensure
        // current table cells/pages are physically overwritten so a later
        // auth backup cannot copy plaintext from the source freelist after the
        // declaration and table are gone.
        require_secure_delete(tx)?;
        tx.execute_batch(
            "DROP TRIGGER IF EXISTS _snapback_push_session_terminal_v1;
             DROP TRIGGER IF EXISTS _snapback_push_clock_floor_insert_v1;
             DROP TRIGGER IF EXISTS _snapback_push_clock_floor_update_v1;
             DROP TABLE IF EXISTS _snapback_push_messages_v1;
             DROP TABLE IF EXISTS _snapback_push_batches_v1;
             DROP TABLE IF EXISTS _snapback_push_intents_v1;
             DROP TABLE IF EXISTS _snapback_push_tokens_v1;",
        )?;
        return Ok(());
    };
    declaration.validate()?;
    create_infra(tx)?;
    if declaration.ledger.is_some() {
        create_ledger_infra(tx)?;
        validate_exact_ledger_schema(tx)?;
    } else {
        drop_ledger_infra(tx)?;
    }
    let app_scope = declaration.app_scope.identity();
    let mismatched_live: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM _snapback_push_tokens_v1
           WHERE retired_at_ms IS NULL AND app_scope != ?1
         )",
        params![app_scope],
        |row| row.get(0),
    )?;
    if mismatched_live {
        return Err(SnapbackError::error(
            "SNAPBACK_PUSH_APP_SCOPE_CHANGE_BLOCKED",
            "push",
            "push appScope cannot change while the prior scope has live token custody",
        ));
    }
    Ok(())
}

pub(crate) fn inspect(conn: &Connection) -> SnapbackResult<PushRegistryInspectionV1> {
    validate_exact_schema(conn)?;
    let (live_tokens, retired_tokens) = conn.query_row(
        "SELECT
           COALESCE(SUM(CASE WHEN retired_at_ms IS NULL THEN 1 ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN retired_at_ms IS NOT NULL THEN 1 ELSE 0 END), 0)
         FROM _snapback_push_tokens_v1",
        [],
        |row| Ok((row.get::<_, u64>(0)?, row.get::<_, u64>(1)?)),
    )?;
    let mut retirement_reasons = BTreeMap::new();
    let mut statement = conn.prepare(
        "SELECT retirement_reason, COUNT(*)
         FROM _snapback_push_tokens_v1
         WHERE retired_at_ms IS NOT NULL
         GROUP BY retirement_reason ORDER BY retirement_reason",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?))
    })?;
    for row in rows {
        let (reason, count) = row?;
        validate_retirement_reason(&reason)?;
        retirement_reasons.insert(reason, count);
    }
    Ok(PushRegistryInspectionV1 {
        live_tokens,
        retired_tokens,
        retirement_reasons,
    })
}

/// Read one intent's lifecycle projection under the authorization declaration
/// attached to its audience. The audience name and arguments are taken from
/// the durable intent, never from the caller, so membership authorization
/// cannot be checked against one resource and then used to inspect another.
///
/// @ref LLP 0143#d2-the-send-lane — the same host-enforced audience authority
///   that admits a send gates its ledger read against current membership.
/// @ref LLP 0143#d6-activation-migration-and-the-no-op-posture — this is the
///   Rust-owned half of `definePushLedgerQuery`, not an ambient system-table
///   escape hatch.
pub(crate) fn read_ledger_projection(
    db: &crate::storage::DbRead<'_>,
    declaration: &PushSeamDeclarationV1,
    schema: &crate::manifest::SchemaManifest,
    authority: &crate::auth::invocation::PreparedAuthority,
    intent_id: &str,
) -> SnapbackResult<(
    Vec<PushLedgerRowV1>,
    Option<crate::storage::CapturedReadDependency>,
)> {
    validate_declaration_against_schema(declaration, schema)?;
    if declaration.ledger.is_none() {
        return Err(push_unavailable(
            "the application declares registry custody only",
        ));
    }
    if !ids::looks_like(Kind::PushIntent, intent_id) {
        return Err(push_invalid(
            "the push ledger query requires a push intent id",
        ));
    }
    let app_scope = declaration.app_scope.identity();
    let intent: Option<(String, String)> = db
        .conn()
        .query_row(
            "SELECT audience_name, audience_args_json
             FROM _snapback_push_intents_v1
             WHERE id = ?1 AND app_scope = ?2",
            params![intent_id, app_scope],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((audience_name, audience_args_json)) = intent else {
        return Ok((Vec::new(), None));
    };
    let audience = declaration.audiences.get(&audience_name).ok_or_else(|| {
        corrupt("push ledger intent names an audience absent from its active declaration")
    })?;
    let audience_args = serde_json::from_str::<Value>(&audience_args_json)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .ok_or_else(|| corrupt("push ledger intent carries invalid audience arguments"))?;
    validate_audience_args(audience, &audience_args)?;

    let authorization_dependency = match &audience.authorize {
        PushAudienceAuthorizeV1::System => {
            if !matches!(
                authority.resolved(),
                crate::auth::invocation::ResolvedAppAuthority::System
            ) {
                return Err(crate::membership_rules::role_denial());
            }
            None
        }
        PushAudienceAuthorizeV1::Membership {
            declaration,
            resource_arg,
            roles,
        } => {
            let principal = authority
                .projection()
                .user_id()
                .ok_or_else(crate::membership_rules::role_denial)?;
            let (table, membership) =
                crate::membership_rules::find_declaration(schema, declaration)
                    .ok_or_else(|| corrupt("push ledger authorization declaration is missing"))?;
            let resource = membership_clause_resource(membership, resource_arg, &audience_args)?;
            let binding = match resource {
                Some(value) => {
                    crate::membership_rules::ResourceBinding::Fixed(Value::String(value.into()))
                }
                None => crate::membership_rules::ResourceBinding::AppSingleton,
            };
            let outcome = crate::membership_rules::membership_read(
                db,
                membership,
                &table.name,
                principal,
                binding,
                roles,
            )?;
            if !outcome.present {
                return Err(crate::membership_rules::role_denial());
            }
            Some(outcome.dependency)
        }
    };

    let mut statement = db.conn().prepare(
        "SELECT
           intent.id, intent.trigger_mode, intent.state, intent.attempt_count,
           intent.created_at_ms, intent.updated_at_ms, intent.expires_at_ms,
           batch.id, batch.attempt_number, batch.batch_index, batch.state,
           batch.transmitting_at_ms, batch.settled_at_ms, batch.http_status,
           batch.request_error_code, batch.previous_ambiguous,
           message.id, message.token_id, message.state, message.ticket_id,
           message.receipt_poll_count, message.next_receipt_poll_at_ms,
           message.receipt_window_closes_at_ms, message.handed_to_expo_at_ms,
           message.expo_accepted_at_ms, message.expo_error_code,
           message.retirement_effect
         FROM _snapback_push_intents_v1 AS intent
         LEFT JOIN _snapback_push_batches_v1 AS batch ON batch.intent_id = intent.id
         LEFT JOIN _snapback_push_messages_v1 AS message ON message.batch_id = batch.id
         WHERE intent.id = ?1 AND intent.app_scope = ?2
         ORDER BY batch.attempt_number, batch.batch_index, message.id",
    )?;
    let rows = statement
        .query_map(params![intent_id, app_scope], |row| {
            let intent_id: String = row.get(0)?;
            let batch_id: Option<String> = row.get(7)?;
            let message_id: Option<String> = row.get(16)?;
            Ok(PushLedgerRowV1 {
                id: message_id
                    .clone()
                    .or_else(|| batch_id.clone())
                    .unwrap_or_else(|| intent_id.clone()),
                intent_id,
                trigger_mode: row.get(1)?,
                intent_state: row.get(2)?,
                attempt_count: u32::try_from(row.get::<_, u64>(3)?).unwrap_or(u32::MAX),
                created_at_ms: row.get(4)?,
                updated_at_ms: row.get(5)?,
                expires_at_ms: row.get(6)?,
                batch_id,
                attempt_number: row
                    .get::<_, Option<u64>>(8)?
                    .map(|value| u32::try_from(value).unwrap_or(u32::MAX)),
                batch_index: row
                    .get::<_, Option<u64>>(9)?
                    .map(|value| u32::try_from(value).unwrap_or(u32::MAX)),
                batch_state: row.get(10)?,
                transmitting_at_ms: row.get(11)?,
                settled_at_ms: row.get(12)?,
                http_status: row
                    .get::<_, Option<u64>>(13)?
                    .map(|value| u16::try_from(value).unwrap_or(u16::MAX)),
                request_error_code: row.get(14)?,
                previous_ambiguous: row.get::<_, Option<u64>>(15)?.map(|value| value != 0),
                message_id,
                token_id: row.get(17)?,
                message_state: row.get(18)?,
                ticket_id: row.get(19)?,
                receipt_poll_count: row
                    .get::<_, Option<u64>>(20)?
                    .map(|value| u8::try_from(value).unwrap_or(u8::MAX)),
                next_receipt_poll_at_ms: row.get(21)?,
                receipt_window_closes_at_ms: row.get(22)?,
                handed_to_expo_at_ms: row.get(23)?,
                expo_accepted_at_ms: row.get(24)?,
                expo_error_code: row.get(25)?,
                retirement_effect: row.get::<_, Option<u64>>(26)?.map(|value| value != 0),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok((rows, authorization_dependency))
}

/// Reserve one normalized intent and its per-token handoff rows before any
/// provider work. The caller receives token bytes only in this private value;
/// no handler/wire/inspection projection serializes it.
///
/// @ref LLP 0143#d3-the-handoff-ledger-receipts-honesty-and-crash-safety — reserve commits the payload binding,
///   resolved audience, batches, and messages before the transmitting cut.
pub(crate) struct PushSendReservation<'a> {
    pub(crate) declaration: &'a PushSeamDeclarationV1,
    pub(crate) schema: &'a crate::manifest::SchemaManifest,
    pub(crate) authority: &'a crate::auth::invocation::PreparedAuthority,
    pub(crate) trigger_mode: PushTriggerModeV1,
    pub(crate) deferred_grant: Option<&'a PushDeferredGrantV1>,
    pub(crate) request: &'a PushSendRequestV1,
    pub(crate) now_ms: u64,
}

pub(crate) fn reserve_send_in(
    tx: &Transaction<'_>,
    reservation: PushSendReservation<'_>,
) -> SnapbackResult<ReservedPushAttemptV1> {
    let PushSendReservation {
        declaration,
        schema,
        authority,
        trigger_mode,
        deferred_grant,
        request,
        now_ms,
    } = reservation;
    validate_declaration_against_schema(declaration, schema)?;
    if declaration.ledger.is_none() {
        return Err(push_unavailable(
            "the application declares registry custody only",
        ));
    }
    validate_send_request(request)?;
    if request.redrive_ambiguous && trigger_mode == PushTriggerModeV1::Deferred {
        return Err(SnapbackError::error(
            "SNAPBACK_PUSH_REDRIVE_REFUSED",
            "push",
            "a deferred push grant cannot authorize an ambiguous re-drive",
        )
        .into_trusted_permission_denial());
    }
    crate::manifest::validate_portable_timestamp_millis(now_ms)?;
    let audience = declaration
        .audiences
        .get(&request.to.audience)
        .ok_or_else(|| push_invalid("ctx.push.send names an undeclared audience"))?;
    validate_audience_args(audience, &request.to.args)?;
    authorize_send_in(
        tx,
        schema,
        audience,
        authority,
        trigger_mode,
        deferred_grant,
        request,
    )?;
    let principals = resolve_audience_in(tx, schema, &audience.resolve, &request.to.args)?;
    let app_scope = declaration.app_scope.identity();
    let mut tokens = Vec::new();
    for principal in principals {
        let mut statement = tx.prepare(
            "SELECT id, token_bytes, token_hash FROM _snapback_push_tokens_v1
             WHERE app_scope = ?1 AND principal_id = ?2 AND retired_at_ms IS NULL
             ORDER BY id",
        )?;
        for row in statement.query_map(params![app_scope, principal], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Vec<u8>>(2)?,
            ))
        })? {
            tokens.push(row?);
        }
    }
    tokens.sort_by(|left, right| left.0.cmp(&right.0));
    tokens.dedup_by(|left, right| left.0 == right.0);

    let audience_args_json = canonical_json(&Value::Object(request.to.args.clone()))?;
    let payload_json = canonical_json(&json!({
        "title": request.title,
        "body": request.body,
        "data": request.data,
    }))?;
    let mut binding_hasher = Sha256::new();
    binding_hasher.update(b"snapback:push-intent-binding:v1\n");
    binding_hasher.update(request.to.audience.as_bytes());
    binding_hasher.update([0]);
    binding_hasher.update(audience_args_json.as_bytes());
    binding_hasher.update([0]);
    binding_hasher.update(payload_json.as_bytes());
    let binding_hash: [u8; 32] = binding_hasher.finalize().into();
    let existing: Option<(String, Vec<u8>, i64, String)> = tx
        .query_row(
            "SELECT id, binding_hash, attempt_count, state
             FROM _snapback_push_intents_v1
             WHERE app_scope = ?1 AND dedupe_key = ?2",
            params![app_scope, request.dedupe_key],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    if let Some((intent_id, predecessor_hash, attempt, state)) = existing {
        if predecessor_hash.as_slice() != binding_hash {
            return Err(SnapbackError::error(
                "SNAPBACK_PUSH_DEDUPE_CONFLICT",
                "push",
                "dedupeKey is already bound to a different audience or payload",
            ));
        }
        if request.redrive_ambiguous {
            if state != "ambiguous" {
                return Err(SnapbackError::error(
                    "SNAPBACK_PUSH_REDRIVE_NOT_AMBIGUOUS",
                    "push",
                    "explicit duplicate-risk redrive requires an ambiguous predecessor",
                ));
            }
            let next_attempt = attempt.checked_add(1).ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_PUSH_ATTEMPT_EXHAUSTED",
                    "push",
                    "the push intent attempt counter is exhausted",
                )
            })?;
            let public_attempt = u32::try_from(next_attempt).map_err(|_| {
                SnapbackError::error(
                    "SNAPBACK_PUSH_ATTEMPT_EXHAUSTED",
                    "push",
                    "the push intent attempt counter exceeds the public range",
                )
            })?;
            let retention_ms = declaration
                .ledger
                .as_ref()
                .expect("checked send declaration")
                .retention_ms;
            let expires_at_ms = now_ms.checked_add(retention_ms).ok_or_else(|| {
                push_invalid("push ledger retention exceeds the portable timestamp range")
            })?;
            crate::manifest::validate_portable_timestamp_millis(expires_at_ms)?;
            let next_state = if tokens.is_empty() {
                "zero-target"
            } else {
                "reserved"
            };
            let changed = tx.execute(
                "UPDATE _snapback_push_intents_v1
                 SET state = ?1, attempt_count = ?2, updated_at_ms = ?3,
                     expires_at_ms = ?4
                 WHERE id = ?5 AND state = 'ambiguous' AND attempt_count = ?6",
                params![
                    next_state,
                    next_attempt,
                    now_ms as i64,
                    expires_at_ms as i64,
                    intent_id,
                    attempt,
                ],
            )?;
            if changed != 1 {
                return Err(SnapbackError::error(
                    "SNAPBACK_PUSH_REDRIVE_RACED",
                    "push",
                    "the ambiguous push intent changed before explicit redrive",
                ));
            }
            let batches = reserve_attempt_batches_in(tx, &intent_id, next_attempt, &tokens, true)?;
            return Ok(ReservedPushAttemptV1 {
                response: PushSendReservationResponseV1 {
                    intent_id,
                    attempt: public_attempt,
                    target_count: tokens.len(),
                    batch_count: batches.len(),
                    state: next_state.to_owned(),
                    deduplicated: false,
                },
                batches,
            });
        }
        let (target_count, batch_count): (i64, i64) = tx.query_row(
            "SELECT
               (SELECT COUNT(*) FROM _snapback_push_messages_v1 AS message
                JOIN _snapback_push_batches_v1 AS batch ON batch.id = message.batch_id
                WHERE batch.intent_id = ?1 AND batch.attempt_number = ?2),
               (SELECT COUNT(*) FROM _snapback_push_batches_v1
                WHERE intent_id = ?1 AND attempt_number = ?2)",
            params![intent_id, attempt],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        return Ok(ReservedPushAttemptV1 {
            response: PushSendReservationResponseV1 {
                intent_id,
                attempt: u32::try_from(attempt).unwrap_or(u32::MAX),
                target_count: usize::try_from(target_count).unwrap_or(usize::MAX),
                batch_count: usize::try_from(batch_count).unwrap_or(usize::MAX),
                state,
                deduplicated: true,
            },
            batches: Vec::new(),
        });
    }

    if request.redrive_ambiguous {
        return Err(SnapbackError::error(
            "SNAPBACK_PUSH_REDRIVE_NOT_AMBIGUOUS",
            "push",
            "explicit duplicate-risk redrive requires an existing ambiguous intent",
        ));
    }

    let retention_ms = declaration
        .ledger
        .as_ref()
        .expect("checked send declaration")
        .retention_ms;
    let expires_at_ms = now_ms.checked_add(retention_ms).ok_or_else(|| {
        push_invalid("push ledger retention exceeds the portable timestamp range")
    })?;
    crate::manifest::validate_portable_timestamp_millis(expires_at_ms)?;
    let intent_id = ids::mint_time_ordered(Kind::PushIntent);
    let initial_state = if tokens.is_empty() {
        "zero-target"
    } else {
        "reserved"
    };
    tx.execute(
        "INSERT INTO _snapback_push_intents_v1(
           id, app_scope, dedupe_key, binding_hash, audience_name,
           audience_args_json, payload_json, trigger_mode, state, attempt_count,
           created_at_ms, updated_at_ms, expires_at_ms
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?10, ?11)",
        params![
            intent_id,
            app_scope,
            request.dedupe_key,
            binding_hash.as_slice(),
            request.to.audience,
            audience_args_json,
            payload_json,
            trigger_mode.as_str(),
            initial_state,
            now_ms as i64,
            expires_at_ms as i64,
        ],
    )?;

    let batches = reserve_attempt_batches_in(tx, &intent_id, 1, &tokens, false)?;
    Ok(ReservedPushAttemptV1 {
        response: PushSendReservationResponseV1 {
            intent_id,
            attempt: 1,
            target_count: tokens.len(),
            batch_count: batches.len(),
            state: initial_state.to_owned(),
            deduplicated: false,
        },
        batches,
    })
}

fn reserve_attempt_batches_in(
    tx: &Transaction<'_>,
    intent_id: &str,
    attempt: i64,
    tokens: &[(String, String, Vec<u8>)],
    previous_ambiguous: bool,
) -> SnapbackResult<Vec<ReservedPushBatchV1>> {
    let mut batches = Vec::new();
    for (batch_index, chunk) in tokens.chunks(PUSH_BATCH_MESSAGES_MAX).enumerate() {
        let batch_id = ids::mint_time_ordered(Kind::PushBatch);
        tx.execute(
            "INSERT INTO _snapback_push_batches_v1(
               id, intent_id, attempt_number, batch_index, state,
               previous_ambiguous
             ) VALUES(?1, ?2, ?3, ?4, 'reserved', ?5)",
            params![
                batch_id,
                intent_id,
                attempt,
                batch_index as i64,
                i64::from(previous_ambiguous),
            ],
        )?;
        for (token_id, token, token_hash) in chunk {
            let message_id = ids::mint_time_ordered(Kind::PushMessage);
            tx.execute(
                "INSERT INTO _snapback_push_messages_v1(
                   id, batch_id, token_id, token_hash, token_bytes, state
                 ) VALUES(?1, ?2, ?3, ?4, ?5, 'reserved')",
                params![message_id, batch_id, token_id, token_hash, token],
            )?;
        }
        batches.push(ReservedPushBatchV1 { batch_id });
    }
    Ok(batches)
}

pub(crate) fn claim_batch_in(
    tx: &Transaction<'_>,
    batch_id: &str,
    now_ms: u64,
) -> SnapbackResult<Option<PushBatchClaimV1>> {
    if !ids::looks_like(Kind::PushBatch, batch_id) {
        return Err(push_invalid("push batch id is invalid"));
    }
    let intent_id: String = tx.query_row(
        "SELECT intent_id FROM _snapback_push_batches_v1 WHERE id = ?1",
        params![batch_id],
        |row| row.get(0),
    )?;
    refresh_reserved_batch_tokens_in(tx, batch_id)?;
    let remaining: i64 = tx.query_row(
        "SELECT COUNT(*) FROM _snapback_push_messages_v1
         WHERE batch_id = ?1 AND state = 'reserved'",
        params![batch_id],
        |row| row.get(0),
    )?;
    if remaining == 0 {
        tx.execute(
            "UPDATE _snapback_push_batches_v1
             SET state = 'settled', settled_at_ms = ?1,
                 request_error_code = 'all-tokens-retired-before-handoff'
             WHERE id = ?2 AND state = 'reserved'",
            params![now_ms as i64, batch_id],
        )?;
        recompute_intent_state_in(tx, &intent_id, now_ms)?;
        return Ok(None);
    }
    let claim_id = ids::mint_time_ordered(Kind::Lease);
    let lease_expires_at_ms = now_ms
        .checked_add(PUSH_HANDOFF_LEASE_MS)
        .ok_or_else(|| push_invalid("push handoff lease overflowed"))?;
    let predecessor_fence: Option<i64> = tx
        .query_row(
            "SELECT claim_fence FROM _snapback_push_batches_v1
             WHERE id = ?1 AND state = 'reserved'",
            params![batch_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(predecessor_fence) = predecessor_fence else {
        return Err(SnapbackError::error(
            "SNAPBACK_PUSH_BATCH_NOT_CLAIMABLE",
            "push",
            "push batch is not reserved for a handoff claim",
        ));
    };
    let fence = predecessor_fence.checked_add(1).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_PUSH_LEDGER_CORRUPT",
            "push",
            "push handoff claim fence exhausted",
        )
    })?;
    let changed = tx.execute(
        "UPDATE _snapback_push_batches_v1
         SET state = 'claimed', claim_id = ?1, claim_fence = ?2,
             claim_expires_at_ms = ?3
         WHERE id = ?4 AND state = 'reserved' AND claim_fence = ?5",
        params![
            claim_id,
            fence,
            lease_expires_at_ms as i64,
            batch_id,
            predecessor_fence,
        ],
    )?;
    if changed != 1 {
        return Err(SnapbackError::error(
            "SNAPBACK_PUSH_BATCH_CLAIM_RACED",
            "push",
            "push batch claim raced another owner",
        ));
    }
    let messages = {
        let mut statement = tx.prepare(
            "SELECT id, token_id, token_bytes FROM _snapback_push_messages_v1
             WHERE batch_id = ?1 AND state = 'reserved' ORDER BY id",
        )?;
        statement
            .query_map(params![batch_id], |row| {
                Ok(ReservedPushMessageV1 {
                    message_id: row.get(0)?,
                    token_id: row.get(1)?,
                    token: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    Ok(Some(PushBatchClaimV1 {
        batch_id: batch_id.to_owned(),
        claim_id,
        fence: u64::try_from(fence).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_PUSH_LEDGER_CORRUPT",
                "push",
                "push handoff claim fence is negative",
            )
        })?,
        messages,
    }))
}

fn refresh_reserved_batch_tokens_in(tx: &Transaction<'_>, batch_id: &str) -> SnapbackResult<()> {
    struct ReservedTokenSnapshot {
        message_id: String,
        snapshot_hash: Vec<u8>,
        live_bytes: Option<String>,
        live_hash: Option<Vec<u8>>,
    }

    let snapshots = {
        let mut statement = tx.prepare(
            "SELECT message.id, message.token_hash,
                    token.token_bytes, token.token_hash
             FROM _snapback_push_messages_v1 AS message
             LEFT JOIN _snapback_push_tokens_v1 AS token
               ON token.id = message.token_id AND token.retired_at_ms IS NULL
             WHERE message.batch_id = ?1 AND message.state = 'reserved'
             ORDER BY message.id",
        )?;
        statement
            .query_map(params![batch_id], |row| {
                Ok(ReservedTokenSnapshot {
                    message_id: row.get(0)?,
                    snapshot_hash: row.get(1)?,
                    live_bytes: row.get(2)?,
                    live_hash: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    for snapshot in snapshots {
        let ReservedTokenSnapshot {
            message_id,
            snapshot_hash,
            live_bytes,
            live_hash,
        } = snapshot;
        match (live_bytes, live_hash) {
            (Some(live_bytes), Some(live_hash)) if live_hash != snapshot_hash => {
                tx.execute(
                    "UPDATE _snapback_push_messages_v1
                     SET token_hash = ?1, token_bytes = ?2
                     WHERE id = ?3 AND state = 'reserved'",
                    params![live_hash, live_bytes, message_id],
                )?;
            }
            (Some(_), Some(_)) => {}
            _ => {
                tx.execute(
                    "UPDATE _snapback_push_messages_v1
                     SET state = 'failed-permanent',
                         expo_error_code = 'TokenRetiredBeforeHandoff',
                         token_hash = zeroblob(32), token_bytes = ''
                     WHERE id = ?1 AND state = 'reserved'",
                    params![message_id],
                )?;
            }
        }
    }
    Ok(())
}

/// The caller must commit this transition before constructing or writing the
/// provider request. A process death after this point is therefore ambiguous,
/// never eligible for automatic redrive.
///
/// @ref LLP 0143#d3-the-handoff-ledger-receipts-honesty-and-crash-safety — `transmitting` is durable before
///   the first provider byte and is the crash discriminator.
pub(crate) fn mark_batch_transmitting_in(
    tx: &Transaction<'_>,
    claim: &PushBatchClaimV1,
    now_ms: u64,
) -> SnapbackResult<()> {
    let changed = tx.execute(
        "UPDATE _snapback_push_batches_v1
         SET state = 'transmitting', transmitting_at_ms = ?1
         WHERE id = ?2 AND state = 'claimed' AND claim_id = ?3
           AND claim_fence = ?4 AND claim_expires_at_ms > ?1",
        params![
            now_ms as i64,
            claim.batch_id,
            claim.claim_id,
            claim.fence as i64,
        ],
    )?;
    if changed != 1 {
        return Err(SnapbackError::error(
            "SNAPBACK_PUSH_BATCH_CLAIM_STALE",
            "push",
            "push batch claim is stale before the transmit boundary",
        ));
    }
    Ok(())
}

pub(crate) fn settle_batch_in(
    tx: &Transaction<'_>,
    claim: &PushBatchClaimV1,
    settlement: &PushBatchSettlementV1,
    now_ms: u64,
) -> SnapbackResult<()> {
    let active: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM _snapback_push_batches_v1
           WHERE id = ?1 AND state = 'transmitting' AND claim_id = ?2 AND claim_fence = ?3
         )",
        params![claim.batch_id, claim.claim_id, claim.fence as i64],
        |row| row.get(0),
    )?;
    if !active {
        return Err(SnapbackError::error(
            "SNAPBACK_PUSH_BATCH_CLAIM_STALE",
            "push",
            "push batch claim is stale at settlement",
        ));
    }
    let intent_id: String = tx.query_row(
        "SELECT intent_id FROM _snapback_push_batches_v1 WHERE id = ?1",
        params![claim.batch_id],
        |row| row.get(0),
    )?;
    match settlement {
        PushBatchSettlementV1::Tickets {
            http_status,
            outcomes,
        } => {
            if claim.messages.len() != outcomes.len() {
                return Err(SnapbackError::error(
                    "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
                    "push",
                    "Expo ticket count does not match the transmitted message count",
                ));
            }
            for (message, outcome) in claim.messages.iter().zip(outcomes) {
                let token_id = tx
                    .query_row(
                        "SELECT token_id FROM _snapback_push_messages_v1
                         WHERE id = ?1 AND batch_id = ?2 AND state = 'reserved'",
                        params![message.message_id, claim.batch_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?
                    .filter(|token_id| token_id == &message.token_id)
                    .ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_PUSH_BATCH_CLAIM_STALE",
                            "push",
                            "the claimed push message set changed before settlement",
                        )
                    })?;
                match outcome {
                    PushTicketOutcomeV1::Ok { ticket_id } => {
                        validate_provider_id(ticket_id)?;
                        let next_poll = now_ms
                            .checked_add(PUSH_RECEIPT_FIRST_POLL_MS)
                            .ok_or_else(|| push_invalid("push receipt schedule overflowed"))?;
                        let window_close = now_ms
                            .checked_add(PUSH_RECEIPT_WINDOW_MS)
                            .ok_or_else(|| push_invalid("push receipt window overflowed"))?;
                        let changed = tx.execute(
                            "UPDATE _snapback_push_messages_v1
                             SET state = 'handed-to-expo', ticket_id = ?1,
                                 next_receipt_poll_at_ms = ?2,
                                 receipt_window_closes_at_ms = ?3,
                                 handed_to_expo_at_ms = ?4,
                                 token_hash = zeroblob(32), token_bytes = ''
                             WHERE id = ?5 AND state = 'reserved'",
                            params![
                                ticket_id,
                                next_poll as i64,
                                window_close as i64,
                                now_ms as i64,
                                message.message_id,
                            ],
                        )?;
                        if changed != 1 {
                            return Err(SnapbackError::error(
                                "SNAPBACK_PUSH_BATCH_CLAIM_STALE",
                                "push",
                                "the claimed push message changed during ticket settlement",
                            ));
                        }
                        tx.execute(
                            "UPDATE _snapback_push_tokens_v1
                             SET last_successful_handoff_at_ms = ?1
                             WHERE id = ?2 AND retired_at_ms IS NULL",
                            params![now_ms as i64, token_id],
                        )?;
                    }
                    PushTicketOutcomeV1::Error { code } => {
                        validate_ticket_error_code(code)?;
                        let retired = if code == "DeviceNotRegistered" {
                            retire_provider_token_in(
                                tx,
                                &token_id,
                                now_ms,
                                &format!("ticket:{}", message.message_id),
                            )?
                        } else {
                            false
                        };
                        let changed = tx.execute(
                            "UPDATE _snapback_push_messages_v1
                             SET state = 'failed-permanent', expo_error_code = ?1,
                                 retirement_effect = ?2,
                                 token_hash = zeroblob(32), token_bytes = ''
                             WHERE id = ?3 AND state = 'reserved'",
                            params![code, i64::from(retired), message.message_id],
                        )?;
                        if changed != 1 {
                            return Err(SnapbackError::error(
                                "SNAPBACK_PUSH_BATCH_CLAIM_STALE",
                                "push",
                                "the claimed push message changed during ticket settlement",
                            ));
                        }
                    }
                }
            }
            let changed = tx.execute(
                "UPDATE _snapback_push_batches_v1
                 SET state = 'settled', settled_at_ms = ?1, http_status = ?2
                 WHERE id = ?3 AND state = 'transmitting'
                   AND claim_id = ?4 AND claim_fence = ?5",
                params![
                    now_ms as i64,
                    i64::from(*http_status),
                    claim.batch_id,
                    claim.claim_id,
                    claim.fence as i64,
                ],
            )?;
            if changed != 1 {
                return Err(SnapbackError::error(
                    "SNAPBACK_PUSH_BATCH_CLAIM_STALE",
                    "push",
                    "the push batch claim changed during ticket settlement",
                ));
            }
            recompute_intent_state_in(tx, &intent_id, now_ms)?;
        }
        PushBatchSettlementV1::Ambiguous { code } => {
            validate_request_error_code(code)?;
            let changed = tx.execute(
                "UPDATE _snapback_push_batches_v1
                 SET state = 'ambiguous', settled_at_ms = ?1, request_error_code = ?2
                 WHERE id = ?3 AND state = 'transmitting'
                   AND claim_id = ?4 AND claim_fence = ?5",
                params![
                    now_ms as i64,
                    code,
                    claim.batch_id,
                    claim.claim_id,
                    claim.fence as i64,
                ],
            )?;
            if changed != 1 {
                return Err(SnapbackError::error(
                    "SNAPBACK_PUSH_BATCH_CLAIM_STALE",
                    "push",
                    "the push batch claim changed during ambiguous settlement",
                ));
            }
            settle_claim_messages_in(tx, claim, "ambiguous", None)?;
            tx.execute(
                "UPDATE _snapback_push_intents_v1
                 SET state = 'ambiguous', updated_at_ms = ?1 WHERE id = ?2",
                params![now_ms as i64, intent_id],
            )?;
        }
        PushBatchSettlementV1::FailedPermanent { http_status, code }
        | PushBatchSettlementV1::FailedConfig { http_status, code } => {
            validate_request_error_code(code)?;
            let state = if matches!(settlement, PushBatchSettlementV1::FailedConfig { .. }) {
                "failed-config"
            } else {
                "failed-permanent"
            };
            settle_request_failure_in(
                tx,
                claim,
                PushRequestFailure {
                    intent_id: &intent_id,
                    state,
                    http_status: *http_status,
                    code,
                    retry_at_ms: None,
                    now_ms,
                },
            )?;
        }
        PushBatchSettlementV1::FailedRetryable {
            http_status,
            code,
            retry_at_ms,
        } => {
            validate_request_error_code(code)?;
            settle_request_failure_in(
                tx,
                claim,
                PushRequestFailure {
                    intent_id: &intent_id,
                    state: "failed-retryable",
                    http_status: *http_status,
                    code,
                    retry_at_ms: Some(*retry_at_ms),
                    now_ms,
                },
            )?;
        }
    }
    Ok(())
}

struct PushRequestFailure<'a> {
    intent_id: &'a str,
    state: &'a str,
    http_status: Option<u16>,
    code: &'a str,
    retry_at_ms: Option<u64>,
    now_ms: u64,
}

fn settle_request_failure_in(
    tx: &Transaction<'_>,
    claim: &PushBatchClaimV1,
    failure: PushRequestFailure<'_>,
) -> SnapbackResult<()> {
    let PushRequestFailure {
        intent_id,
        state,
        http_status,
        code,
        retry_at_ms,
        now_ms,
    } = failure;
    let changed = tx.execute(
        "UPDATE _snapback_push_batches_v1
         SET state = 'settled', settled_at_ms = ?1, http_status = ?2,
             request_error_code = ?3, retry_at_ms = ?4
         WHERE id = ?5 AND state = 'transmitting'
           AND claim_id = ?6 AND claim_fence = ?7",
        params![
            now_ms as i64,
            http_status.map(i64::from),
            code,
            retry_at_ms.map(|value| value as i64),
            claim.batch_id,
            claim.claim_id,
            claim.fence as i64,
        ],
    )?;
    if changed != 1 {
        return Err(SnapbackError::error(
            "SNAPBACK_PUSH_BATCH_CLAIM_STALE",
            "push",
            "the push batch claim changed during request settlement",
        ));
    }
    settle_claim_messages_in(tx, claim, "failed-permanent", Some(code))?;
    tx.execute(
        "UPDATE _snapback_push_intents_v1
         SET state = ?1, updated_at_ms = ?2 WHERE id = ?3",
        params![state, now_ms as i64, intent_id],
    )?;
    Ok(())
}

fn settle_claim_messages_in(
    tx: &Transaction<'_>,
    claim: &PushBatchClaimV1,
    state: &str,
    expo_error_code: Option<&str>,
) -> SnapbackResult<()> {
    for message in &claim.messages {
        let changed = tx.execute(
            "UPDATE _snapback_push_messages_v1
             SET state = ?1, expo_error_code = ?2,
                 token_hash = zeroblob(32), token_bytes = ''
             WHERE id = ?3 AND batch_id = ?4 AND token_id = ?5 AND state = 'reserved'",
            params![
                state,
                expo_error_code,
                message.message_id,
                claim.batch_id,
                message.token_id,
            ],
        )?;
        if changed != 1 {
            return Err(SnapbackError::error(
                "SNAPBACK_PUSH_BATCH_CLAIM_STALE",
                "push",
                "the claimed push message set changed before settlement",
            ));
        }
    }
    Ok(())
}

pub(crate) fn recompute_intent_state_in(
    tx: &Transaction<'_>,
    intent_id: &str,
    now_ms: u64,
) -> SnapbackResult<()> {
    let (total, ambiguous, ambiguous_receipt, reserved, handed, accepted, failed): (
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
    ) = tx.query_row(
        "SELECT
           COUNT(*),
           COALESCE(SUM(CASE WHEN message.state = 'ambiguous' THEN 1 ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN message.state = 'ambiguous-receipt' THEN 1 ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN message.state = 'reserved' THEN 1 ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN message.state = 'handed-to-expo' THEN 1 ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN message.state = 'expo-accepted' THEN 1 ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN message.state IN (
             'expo-error', 'expo-error-config', 'expo-error-rate', 'failed-permanent'
           ) THEN 1 ELSE 0 END), 0)
         FROM _snapback_push_messages_v1 AS message
         JOIN _snapback_push_batches_v1 AS batch ON batch.id = message.batch_id
         WHERE batch.intent_id = ?1",
        params![intent_id],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        },
    )?;
    let state = if total == 0 {
        "zero-target"
    } else if ambiguous > 0 {
        "ambiguous"
    } else if ambiguous_receipt > 0 {
        "ambiguous-receipt"
    } else if reserved > 0 {
        "reserved"
    } else if handed > 0 {
        "handed-to-expo"
    } else if accepted > 0 && failed == 0 {
        "expo-accepted"
    } else if failed > 0 {
        "expo-error"
    } else {
        "reserved"
    };
    tx.execute(
        "UPDATE _snapback_push_intents_v1 SET state = ?1, updated_at_ms = ?2 WHERE id = ?3",
        params![state, now_ms as i64, intent_id],
    )?;
    Ok(())
}

/// Recover only the safe side of the transmit marker. Expired claims that
/// never crossed it return to `reserved`; every unsettled transmitting batch
/// becomes terminally ambiguous and is never automatically redriven.
pub(crate) fn recover_expired_batches_in(
    tx: &Transaction<'_>,
    now_ms: u64,
) -> SnapbackResult<(usize, usize)> {
    let safely_redriven = tx.execute(
        "UPDATE _snapback_push_batches_v1
         SET state = 'reserved', claim_id = NULL, claim_expires_at_ms = NULL
         WHERE state = 'claimed' AND claim_expires_at_ms <= ?1
           AND transmitting_at_ms IS NULL",
        params![now_ms as i64],
    )?;
    let transmitting: Vec<(String, String)> = {
        let mut statement = tx.prepare(
            "SELECT id, intent_id FROM _snapback_push_batches_v1
             WHERE state = 'transmitting' AND claim_expires_at_ms <= ?1
             ORDER BY id",
        )?;
        statement
            .query_map(params![now_ms as i64], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?
    };
    for (batch_id, intent_id) in &transmitting {
        tx.execute(
            "UPDATE _snapback_push_batches_v1
             SET state = 'ambiguous', settled_at_ms = ?1,
                 request_error_code = 'claim-expired-after-transmitting'
             WHERE id = ?2 AND state = 'transmitting'",
            params![now_ms as i64, batch_id],
        )?;
        tx.execute(
            "UPDATE _snapback_push_messages_v1
             SET state = 'ambiguous', token_hash = zeroblob(32), token_bytes = ''
             WHERE batch_id = ?1 AND state = 'reserved'",
            params![batch_id],
        )?;
        tx.execute(
            "UPDATE _snapback_push_intents_v1
             SET state = 'ambiguous', updated_at_ms = ?1 WHERE id = ?2",
            params![now_ms as i64, intent_id],
        )?;
    }
    Ok((safely_redriven, transmitting.len()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredPushPayloadV1 {
    title: String,
    body: String,
    #[serde(default)]
    data: Option<Map<String, Value>>,
}

/// Claim one batch that recovery proved never crossed the transmit marker,
/// reconstruct its provider payload from the protected intent row, and commit
/// the new transmit marker in the same transaction. Fresh action reservations
/// have fence zero and are deliberately ineligible, so maintenance cannot race
/// the action that created them.
///
/// @ref LLP 0143#d3-the-handoff-ledger-receipts-honesty-and-crash-safety — a
///   pre-transmit crash is safely re-driven from its exact durable binding;
///   every later crash remains ambiguous.
pub(crate) fn claim_recovered_batch_for_transmit_in(
    tx: &Transaction<'_>,
    now_ms: u64,
) -> SnapbackResult<Option<PushRecoveredBatchV1>> {
    loop {
        let batch_id: Option<String> = tx
            .query_row(
                "SELECT id FROM _snapback_push_batches_v1
                 WHERE state = 'reserved' AND claim_fence > 0
                 ORDER BY id LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let Some(batch_id) = batch_id else {
            return Ok(None);
        };
        let Some(claim) = claim_batch_in(tx, &batch_id, now_ms)? else {
            continue;
        };
        let payload_json: String = tx.query_row(
            "SELECT intent.payload_json
             FROM _snapback_push_batches_v1 AS batch
             JOIN _snapback_push_intents_v1 AS intent ON intent.id = batch.intent_id
             WHERE batch.id = ?1",
            params![batch_id],
            |row| row.get(0),
        )?;
        let stored: StoredPushPayloadV1 = serde_json::from_str(&payload_json).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_PUSH_LEDGER_CORRUPT",
                "push",
                "the protected push intent payload binding is invalid",
            )
        })?;
        let payload =
            expo_send_payload_from_parts(&claim, &stored.title, &stored.body, stored.data.as_ref());
        mark_batch_transmitting_in(tx, &claim, now_ms)?;
        return Ok(Some(PushRecoveredBatchV1 { claim, payload }));
    }
}

/// Enforce the declaration-bound ledger retention window. Foreign-key
/// cascades erase batch/message rows in the same transaction; no provider or
/// application payload survives beyond its intent chain.
pub(crate) fn expire_ledger_in(tx: &Transaction<'_>, now_ms: u64) -> SnapbackResult<usize> {
    crate::manifest::validate_portable_timestamp_millis(now_ms)?;
    Ok(tx.execute(
        "DELETE FROM _snapback_push_intents_v1 WHERE expires_at_ms <= ?1",
        params![now_ms as i64],
    )?)
}

fn receipt_poll_delay_after(poll_count: u8) -> u64 {
    match poll_count {
        0 => PUSH_RECEIPT_FIRST_POLL_MS,
        1 => 1_800_000,
        2 => 3_600_000,
        3 => 7_200_000,
        _ => 14_400_000,
    }
}

/// Claim at most Expo's 1,000-id receipt batch. The next due time is advanced
/// in the claim transaction so concurrent maintenance workers cannot poll the
/// same ticket set. Missing seventh-poll and closed-window rows become
/// `ambiguous-receipt`; they are never presented as delivery failures.
///
/// @ref LLP 0143#d3-the-handoff-ledger-receipts-honesty-and-crash-safety — 15m, 30m, 1h, 2h, then 4h-capped polling,
///   no more than seven attempts and a roughly 24-hour terminal window.
pub(crate) fn claim_due_receipts_in(
    tx: &Transaction<'_>,
    now_ms: u64,
) -> SnapbackResult<PushReceiptPollClaimV1> {
    let terminal_intents: Vec<String> = {
        let mut statement = tx.prepare(
            "SELECT DISTINCT batch.intent_id
             FROM _snapback_push_messages_v1 AS message
             JOIN _snapback_push_batches_v1 AS batch ON batch.id = message.batch_id
             WHERE message.state = 'handed-to-expo'
               AND (message.receipt_window_closes_at_ms <= ?1
                    OR (message.receipt_poll_count >= 7
                        AND message.next_receipt_poll_at_ms <= ?1))",
        )?;
        statement
            .query_map(params![now_ms as i64], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?
    };
    tx.execute(
        "UPDATE _snapback_push_messages_v1
         SET state = 'ambiguous-receipt', next_receipt_poll_at_ms = NULL
         WHERE state = 'handed-to-expo'
           AND (receipt_window_closes_at_ms <= ?1
                OR (receipt_poll_count >= 7 AND next_receipt_poll_at_ms <= ?1))",
        params![now_ms as i64],
    )?;
    for intent_id in terminal_intents {
        recompute_intent_state_in(tx, &intent_id, now_ms)?;
    }

    let due: Vec<(String, String, String, u8)> = {
        let mut statement = tx.prepare(
            "SELECT id, token_id, ticket_id, receipt_poll_count
             FROM _snapback_push_messages_v1
             WHERE state = 'handed-to-expo'
               AND next_receipt_poll_at_ms <= ?1
               AND receipt_window_closes_at_ms > ?1
               AND receipt_poll_count < 7
             ORDER BY next_receipt_poll_at_ms, id
             LIMIT ?2",
        )?;
        statement
            .query_map(
                params![now_ms as i64, PUSH_RECEIPT_BATCH_MAX as i64],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )?
            .collect::<Result<Vec<_>, _>>()?
    };
    let mut entries = Vec::with_capacity(due.len());
    for (message_id, token_id, ticket_id, old_count) in due {
        let poll_count = old_count.saturating_add(1);
        let next_poll = if poll_count >= 7 {
            // Keep a due marker until the response settles. If the seventh
            // poll itself loses response certainty, the next maintenance
            // claim terminalizes it rather than stranding a NULL schedule.
            Some(now_ms)
        } else {
            Some(now_ms.saturating_add(receipt_poll_delay_after(poll_count)))
        };
        let changed = tx.execute(
            "UPDATE _snapback_push_messages_v1
             SET receipt_poll_count = ?1, next_receipt_poll_at_ms = ?2
             WHERE id = ?3 AND state = 'handed-to-expo'
               AND receipt_poll_count = ?4 AND next_receipt_poll_at_ms <= ?5",
            params![
                i64::from(poll_count),
                next_poll.map(|value| value as i64),
                message_id,
                i64::from(old_count),
                now_ms as i64,
            ],
        )?;
        if changed != 1 {
            continue;
        }
        entries.push(PushReceiptPollEntryV1 {
            message_id,
            token_id,
            ticket_id,
            poll_count,
        });
    }
    Ok(PushReceiptPollClaimV1 { entries })
}

pub(crate) fn expo_receipt_payload(claim: &PushReceiptPollClaimV1) -> Value {
    json!({
        "ids": claim
            .entries
            .iter()
            .map(|entry| entry.ticket_id.as_str())
            .collect::<Vec<_>>()
    })
}

pub(crate) fn parse_expo_receipt_response(
    body: &[u8],
) -> SnapbackResult<BTreeMap<String, PushReceiptOutcomeV1>> {
    let value: Value = serde_json::from_slice(body).map_err(|_| {
        SnapbackError::error(
            "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
            "push",
            "Expo returned invalid receipt JSON",
        )
    })?;
    let receipts = value
        .get("data")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
                "push",
                "Expo receipt response omitted its data object",
            )
        })?;
    receipts
        .iter()
        .map(|(ticket_id, receipt)| {
            validate_provider_id(ticket_id)?;
            let outcome = match receipt.get("status").and_then(Value::as_str) {
                Some("ok") => PushReceiptOutcomeV1::Ok,
                Some("error") => {
                    let code = receipt
                        .get("details")
                        .and_then(|details| details.get("error"))
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            SnapbackError::error(
                                "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
                                "push",
                                "Expo error receipt omitted its allowlisted code",
                            )
                        })?;
                    validate_receipt_error_code(code)?;
                    PushReceiptOutcomeV1::Error {
                        code: code.to_owned(),
                    }
                }
                _ => {
                    return Err(SnapbackError::error(
                        "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
                        "push",
                        "Expo receipt status is outside the closed vocabulary",
                    ));
                }
            };
            Ok((ticket_id.clone(), outcome))
        })
        .collect()
}

pub(crate) fn settle_receipt_poll_in(
    tx: &Transaction<'_>,
    claim: &PushReceiptPollClaimV1,
    outcomes: &BTreeMap<String, PushReceiptOutcomeV1>,
    now_ms: u64,
) -> SnapbackResult<()> {
    if outcomes.keys().any(|ticket_id| {
        !claim
            .entries
            .iter()
            .any(|entry| &entry.ticket_id == ticket_id)
    }) {
        return Err(SnapbackError::error(
            "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
            "push",
            "Expo returned a receipt outside the claimed ticket set",
        ));
    }
    let mut intents = std::collections::BTreeSet::new();
    for entry in &claim.entries {
        let intent_id: String = tx
            .query_row(
                "SELECT batch.intent_id
                 FROM _snapback_push_messages_v1 AS message
                 JOIN _snapback_push_batches_v1 AS batch ON batch.id = message.batch_id
                 WHERE message.id = ?1 AND message.token_id = ?2
                   AND message.ticket_id = ?3 AND message.state = 'handed-to-expo'
                   AND message.receipt_poll_count = ?4",
                params![
                    entry.message_id,
                    entry.token_id,
                    entry.ticket_id,
                    i64::from(entry.poll_count),
                ],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_PUSH_RECEIPT_CLAIM_STALE",
                    "push",
                    "the claimed push receipt row changed before settlement",
                )
            })?;
        intents.insert(intent_id);
        let (state, code, retirement) = match outcomes.get(&entry.ticket_id) {
            Some(PushReceiptOutcomeV1::Ok) => ("expo-accepted", None, false),
            Some(PushReceiptOutcomeV1::Error { code }) => {
                let state = match code.as_str() {
                    "InvalidCredentials" => "expo-error-config",
                    "MessageRateExceeded" => "expo-error-rate",
                    "DeviceNotRegistered" | "MessageTooBig" => "expo-error",
                    _ => unreachable!("receipt parser owns the closed code vocabulary"),
                };
                let retirement = if code == "DeviceNotRegistered" {
                    retire_provider_token_in(
                        tx,
                        &entry.token_id,
                        now_ms,
                        &format!("receipt:{}", entry.message_id),
                    )?
                } else {
                    false
                };
                (state, Some(code.as_str()), retirement)
            }
            None if entry.poll_count >= 7 => ("ambiguous-receipt", None, false),
            None => continue,
        };
        let changed = tx.execute(
            "UPDATE _snapback_push_messages_v1
             SET state = ?1, expo_error_code = ?2, retirement_effect = ?3,
                 expo_accepted_at_ms = CASE WHEN ?1 = 'expo-accepted' THEN ?4 ELSE NULL END,
                 next_receipt_poll_at_ms = NULL
             WHERE id = ?5 AND state = 'handed-to-expo'
               AND receipt_poll_count = ?6",
            params![
                state,
                code,
                i64::from(retirement),
                now_ms as i64,
                entry.message_id,
                i64::from(entry.poll_count),
            ],
        )?;
        if changed != 1 {
            return Err(SnapbackError::error(
                "SNAPBACK_PUSH_RECEIPT_CLAIM_STALE",
                "push",
                "the claimed push receipt row changed during settlement",
            ));
        }
    }
    for intent_id in intents {
        recompute_intent_state_in(tx, &intent_id, now_ms)?;
    }
    Ok(())
}

fn validate_provider_id(id: &str) -> SnapbackResult<()> {
    if id.is_empty()
        || id.len() > 255
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(SnapbackError::error(
            "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
            "push",
            "Expo returned an invalid ticket or receipt id",
        ));
    }
    Ok(())
}

fn validate_ticket_error_code(code: &str) -> SnapbackResult<()> {
    if code == "DeviceNotRegistered" {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
        "push",
        "Expo returned an unrecognized ticket error code",
    ))
}

fn validate_receipt_error_code(code: &str) -> SnapbackResult<()> {
    if matches!(
        code,
        "DeviceNotRegistered" | "MessageTooBig" | "MessageRateExceeded" | "InvalidCredentials"
    ) {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
        "push",
        "Expo returned an unrecognized receipt error code",
    ))
}

fn validate_request_error_code(code: &str) -> SnapbackResult<()> {
    if matches!(
        code,
        "http-400"
            | "http-401"
            | "http-429"
            | "http-5xx"
            | "transport-error"
            | "timeout"
            | "claim-expired-after-transmitting"
            | "provider-shape-invalid"
            | "UNAUTHORIZED"
    ) {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID",
        "push",
        "push request error code is not allowlisted",
    ))
}

fn validate_send_request(request: &PushSendRequestV1) -> SnapbackResult<()> {
    let bounded_text = |value: &str, max: usize| {
        !value.is_empty() && value.len() <= max && !value.chars().any(char::is_control)
    };
    if !bounded_text(&request.title, 1_024)
        || !bounded_text(&request.body, 4_096)
        || !bounded_text(&request.dedupe_key, 200)
        || request.to.args.len() > 8
        || request
            .data
            .as_ref()
            .is_some_and(|data| canonical_json(&Value::Object(data.clone())).is_err())
    {
        return Err(push_invalid(
            "ctx.push.send received an invalid bounded request",
        ));
    }
    let payload_bytes = serde_json::to_vec(&json!({
        "title": request.title,
        "body": request.body,
        "data": request.data,
    }))
    .map_err(|_| push_invalid("ctx.push.send payload could not be serialized"))?;
    if payload_bytes.len() > 32_768 {
        return Err(push_invalid("ctx.push.send payload exceeds 32 KiB"));
    }
    Ok(())
}

fn canonical_json(value: &Value) -> SnapbackResult<String> {
    fn canonical(value: &Value) -> Value {
        match value {
            Value::Object(fields) => Value::Object(
                fields
                    .iter()
                    .map(|(key, value)| (key.clone(), canonical(value)))
                    .collect(),
            ),
            Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
            other => other.clone(),
        }
    }
    serde_json::to_string(&canonical(value))
        .map_err(|_| push_invalid("push value could not be canonically serialized"))
}

fn membership_clause_resource<'a>(
    membership: &crate::manifest::MembershipManifest,
    resource_arg: &Option<String>,
    args: &'a Map<String, Value>,
) -> SnapbackResult<Option<&'a str>> {
    match membership.scope {
        crate::manifest::MembershipScope::App => Ok(None),
        crate::manifest::MembershipScope::Resource => {
            let name = resource_arg.as_deref().ok_or_else(|| {
                push_invalid("resource push audience is missing its declared argument")
            })?;
            args.get(name)
                .and_then(Value::as_str)
                .map(Some)
                .ok_or_else(|| push_invalid("push audience resource argument must be a string id"))
        }
    }
}

/// Validate the single argument object against the union consumed by the
/// resolver and authorize clauses. Each clause subsequently reads only its
/// declared key, so an explicit-principal resolver can be combined with a
/// membership authorization resource without either clause treating the
/// other's argument as an undeclared escape hatch.
///
/// @ref LLP 0143#d2-the-send-lane — generated audience references
///   carry one exact argument object jointly interpreted by the closed
///   resolver and host-enforced authorization declarations.
fn validate_audience_args(
    audience: &PushAudienceDeclarationV1,
    args: &Map<String, Value>,
) -> SnapbackResult<()> {
    let mut declared = std::collections::BTreeSet::new();
    match &audience.resolve {
        PushAudienceResolverV1::ExplicitPrincipals { principals_arg, .. } => {
            declared.insert(principals_arg.as_str());
        }
        PushAudienceResolverV1::Membership { resource_arg, .. } => {
            declared.extend(resource_arg.iter().map(String::as_str));
        }
    }
    if let PushAudienceAuthorizeV1::Membership { resource_arg, .. } = &audience.authorize {
        declared.extend(resource_arg.iter().map(String::as_str));
    }
    let supplied = args
        .keys()
        .map(String::as_str)
        .collect::<std::collections::BTreeSet<_>>();
    if supplied != declared {
        return Err(push_invalid(
            "push audience args must contain exactly the resolver and authorization arguments",
        ));
    }
    Ok(())
}

fn membership_exists_in(
    tx: &Transaction<'_>,
    table: &crate::manifest::TableManifest,
    membership: &crate::manifest::MembershipManifest,
    principal: &str,
    resource: Option<&str>,
    roles: &[String],
) -> SnapbackResult<bool> {
    let mut sql = format!(
        "SELECT EXISTS(SELECT 1 FROM {} WHERE {} = ?1",
        crate::storage::quote_ident(&table.name)?,
        crate::storage::quote_ident(&membership.principal)?,
    );
    let mut values = vec![rusqlite::types::Value::Text(principal.to_owned())];
    if let (Some(field), Some(resource)) = (membership.resource.as_deref(), resource) {
        sql.push_str(&format!(
            " AND {} = ?2",
            crate::storage::quote_ident(field)?
        ));
        values.push(rusqlite::types::Value::Text(resource.to_owned()));
    }
    let role_offset = values.len() + 1;
    sql.push_str(&format!(
        " AND {} IN ({}) LIMIT 1)",
        crate::storage::quote_ident(&membership.role)?,
        (0..roles.len())
            .map(|index| format!("?{}", role_offset + index))
            .collect::<Vec<_>>()
            .join(", "),
    ));
    values.extend(roles.iter().cloned().map(rusqlite::types::Value::Text));
    Ok(tx.query_row(&sql, rusqlite::params_from_iter(values), |row| row.get(0))?)
}

/// Capture the transaction-bound half of a deferred push grant. The ordinary
/// membership read dependency is returned to the mutation runtime so a revoke
/// racing the producing commit invalidates the commit just like
/// `ctx.permissions.requireRole`.
pub(crate) fn capture_deferred_grant(
    db: &crate::storage::DbRead<'_>,
    producer_principal: &str,
    to: &PushAudienceReferenceV1,
    dedupe_key: &str,
) -> SnapbackResult<(PushDeferredGrantV1, crate::storage::CapturedReadDependency)> {
    if dedupe_key.is_empty() || dedupe_key.len() > 200 || dedupe_key.chars().any(char::is_control) {
        return Err(push_invalid(
            "deferred push dedupeKey must be 1..200 bounded characters",
        ));
    }
    let schema = db.schema();
    let declaration = schema
        .push_seam
        .as_ref()
        .ok_or_else(|| push_unavailable("the application does not declare the push send seam"))?;
    validate_declaration_against_schema(declaration, schema)?;
    if declaration.ledger.is_none() {
        return Err(push_unavailable(
            "the application declares registry custody only",
        ));
    }
    let audience = declaration
        .audiences
        .get(&to.audience)
        .ok_or_else(|| push_invalid("deferred push grant names an undeclared audience"))?;
    validate_audience_args(audience, &to.args)?;
    if matches!(
        audience.resolve,
        PushAudienceResolverV1::ExplicitPrincipals { .. }
    ) {
        return Err(push_invalid(
            "explicit-principals audiences cannot be captured for deferred push",
        ));
    }
    let PushAudienceAuthorizeV1::Membership {
        declaration,
        resource_arg,
        roles,
    } = &audience.authorize
    else {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_PERMISSION_DENIED",
            "auth",
            "system-authorized audiences do not mint user deferred push grants",
        ));
    };
    let (table, membership) = crate::membership_rules::find_declaration(schema, declaration)
        .ok_or_else(|| push_invalid("push authorization declaration is missing"))?;
    let resource = membership_clause_resource(membership, resource_arg, &to.args)?;
    let binding = match resource {
        Some(value) => crate::membership_rules::ResourceBinding::Fixed(Value::String(value.into())),
        None => crate::membership_rules::ResourceBinding::AppSingleton,
    };
    let outcome = crate::membership_rules::membership_read(
        db,
        membership,
        &table.name,
        producer_principal,
        binding,
        roles,
    )?;
    if !outcome.present {
        return Err(crate::membership_rules::role_denial());
    }
    Ok((
        PushDeferredGrantV1 {
            producer_principal: producer_principal.to_owned(),
            to: to.clone(),
            dedupe_key: dedupe_key.to_owned(),
        },
        outcome.dependency,
    ))
}

fn authorize_send_in(
    tx: &Transaction<'_>,
    schema: &crate::manifest::SchemaManifest,
    audience: &PushAudienceDeclarationV1,
    authority: &crate::auth::invocation::PreparedAuthority,
    trigger_mode: PushTriggerModeV1,
    deferred_grant: Option<&PushDeferredGrantV1>,
    request: &PushSendRequestV1,
) -> SnapbackResult<()> {
    let args = &request.to.args;
    let allowed = match &audience.authorize {
        PushAudienceAuthorizeV1::System => {
            trigger_mode == PushTriggerModeV1::System
                && deferred_grant.is_none()
                && matches!(
                    authority.resolved(),
                    crate::auth::invocation::ResolvedAppAuthority::System
                )
        }
        PushAudienceAuthorizeV1::Membership {
            declaration,
            resource_arg,
            roles,
        } => {
            let principal = match trigger_mode {
                PushTriggerModeV1::Immediate if deferred_grant.is_none() => {
                    authority.projection().user_id()
                }
                PushTriggerModeV1::Deferred
                    if matches!(
                        authority.resolved(),
                        crate::auth::invocation::ResolvedAppAuthority::System
                    ) =>
                {
                    deferred_grant
                        .filter(|grant| {
                            grant.to == request.to
                                && grant.dedupe_key == request.dedupe_key
                                && !request.redrive_ambiguous
                        })
                        .map(|grant| grant.producer_principal.as_str())
                }
                PushTriggerModeV1::System
                | PushTriggerModeV1::Immediate
                | PushTriggerModeV1::Deferred => None,
            };
            if trigger_mode == PushTriggerModeV1::Deferred
                && matches!(
                    audience.resolve,
                    PushAudienceResolverV1::ExplicitPrincipals { .. }
                )
            {
                false
            } else if let Some(principal) = principal {
                let (table, membership) =
                    crate::membership_rules::find_declaration(schema, declaration)
                        .ok_or_else(|| push_invalid("push authorization declaration is missing"))?;
                let resource = membership_clause_resource(membership, resource_arg, args)?;
                membership_exists_in(tx, table, membership, principal, resource, roles)?
            } else {
                false
            }
        }
    };
    if allowed {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_AUTH_PERMISSION_DENIED",
        "auth",
        "the current authority cannot use this push audience",
    ))
}

fn resolve_audience_in(
    tx: &Transaction<'_>,
    schema: &crate::manifest::SchemaManifest,
    resolver: &PushAudienceResolverV1,
    args: &Map<String, Value>,
) -> SnapbackResult<Vec<String>> {
    let PushAudienceResolverV1::Membership {
        declaration,
        resource_arg,
        roles,
    } = resolver
    else {
        let PushAudienceResolverV1::ExplicitPrincipals {
            principals_arg,
            max_items,
        } = resolver
        else {
            unreachable!("closed push resolver vocabulary")
        };
        let principals = args
            .get(principals_arg)
            .and_then(Value::as_array)
            .ok_or_else(|| {
                push_invalid("explicit-principals audience requires its declared array argument")
            })?;
        if principals.is_empty() || principals.len() > usize::from(*max_items) {
            return Err(push_invalid(
                "explicit-principals audience exceeds its declared bound",
            ));
        }
        let mut resolved = principals
            .iter()
            .map(|principal| {
                principal
                    .as_str()
                    .filter(|principal| ids::looks_like(Kind::User, principal))
                    .map(str::to_owned)
                    .ok_or_else(|| {
                        push_invalid(
                            "explicit-principals audience contains an invalid principal id",
                        )
                    })
            })
            .collect::<SnapbackResult<Vec<_>>>()?;
        resolved.sort();
        resolved.dedup();
        return Ok(resolved);
    };
    let (table, membership) = crate::membership_rules::find_declaration(schema, declaration)
        .ok_or_else(|| push_invalid("push resolver declaration is missing"))?;
    let resource = membership_clause_resource(membership, resource_arg, args)?;
    let mut sql = format!(
        "SELECT DISTINCT {} FROM {} WHERE ",
        crate::storage::quote_ident(&membership.principal)?,
        crate::storage::quote_ident(&table.name)?,
    );
    let mut values = Vec::new();
    if let (Some(field), Some(resource)) = (membership.resource.as_deref(), resource) {
        sql.push_str(&format!(
            "{} = ?1 AND ",
            crate::storage::quote_ident(field)?
        ));
        values.push(rusqlite::types::Value::Text(resource.to_owned()));
    }
    let role_offset = values.len() + 1;
    sql.push_str(&format!(
        "{} IN ({}) ORDER BY {}",
        crate::storage::quote_ident(&membership.role)?,
        (0..roles.len())
            .map(|index| format!("?{}", role_offset + index))
            .collect::<Vec<_>>()
            .join(", "),
        crate::storage::quote_ident(&membership.principal)?,
    ));
    values.extend(roles.iter().cloned().map(rusqlite::types::Value::Text));
    let mut statement = tx.prepare(&sql)?;
    Ok(statement
        .query_map(rusqlite::params_from_iter(values), |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?)
}

fn push_invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_PUSH_SEND_INVALID", "push", message)
}

fn push_unavailable(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_PUSH_SEND_UNAVAILABLE", "push", message)
}

pub(crate) fn register_in(
    tx: &Transaction<'_>,
    registration: Registration<'_>,
) -> SnapbackResult<PushTokenRegistrationResponse> {
    registration.declaration.validate()?;
    validate_installation_id(registration.installation_id)?;
    validate_token(registration.token)?;
    crate::manifest::validate_portable_timestamp_millis(registration.now_ms)?;
    if registration.session_generation == 0
        || registration.session_generation > crate::manifest::PORTABLE_TIMESTAMP_MAX_MS
    {
        return Err(invalid("push registration session generation is invalid"));
    }
    let app_scope = registration.declaration.app_scope.identity();
    let token_hash = Sha256::digest(registration.token.as_bytes());
    retire_idle_in(tx, registration.declaration, registration.now_ms)?;

    // Resolve, never infer, the exact live session generation. A stale request
    // cannot resurrect custody after logout or rotation of authority.
    let session_matches: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM _auth_sessions
           WHERE id = ?1 AND user_id = ?2 AND generation = ?3
             AND revoked_at_ms IS NULL
             AND MAX(
               ?4,
               COALESCE((
                 SELECT CAST(value AS INTEGER) FROM _snapback_meta
                 WHERE key = 'auth_session_clock_floor_ms'
               ), 0)
             ) < expires_at_ms
         )",
        params![
            registration.session_id,
            registration.principal_id,
            registration.session_generation as i64,
            registration.now_ms as i64,
        ],
        |row| row.get(0),
    )?;
    if !session_matches {
        return Err(SnapbackError::error(
            "SNAPBACK_PUSH_SESSION_STALE",
            "push",
            "push-token registration requires the current live session generation",
        ));
    }

    let collision: Option<(String, String)> = tx
        .query_row(
            "SELECT id, app_scope FROM _snapback_push_tokens_v1
             WHERE token_hash = ?1 AND retired_at_ms IS NULL",
            params![token_hash.as_slice()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if collision
        .as_ref()
        .is_some_and(|(_, existing_scope)| existing_scope != &app_scope)
    {
        return Err(SnapbackError::error(
            "SNAPBACK_PUSH_TOKEN_SCOPE_COLLISION",
            "push",
            "an Expo token collided across declared app scopes; registration was refused",
        )
        .with_details(json!({
            "indicator": "push-token-cross-app-scope-collision",
            "action": "registration-refused",
        })));
    }

    let predecessor: Option<(String, Vec<u8>, String)> = tx
        .query_row(
            "SELECT id, token_hash, principal_id
             FROM _snapback_push_tokens_v1
             WHERE app_scope = ?1 AND principal_id = ?2 AND installation_id = ?3
               AND retired_at_ms IS NULL",
            params![
                app_scope,
                registration.principal_id,
                registration.installation_id
            ],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;

    let mut ownership_transferred = false;
    if let Some((collision_id, _)) = collision.as_ref() {
        let same_owner = predecessor
            .as_ref()
            .is_some_and(|(id, _, _)| id == collision_id);
        if !same_owner {
            let changed = retire_exact_in(
                tx,
                collision_id,
                registration.now_ms,
                "ownership-transferred",
                Some(registration.session_id),
            )?;
            if changed != 1 {
                return Err(corrupt("live token owner changed during registration"));
            }
            ownership_transferred = true;
        }
    }

    let rotated = predecessor
        .as_ref()
        .is_some_and(|(_, predecessor_hash, _)| {
            predecessor_hash.as_slice() != token_hash.as_slice()
        });
    if let Some((id, _, _)) = predecessor.as_ref() {
        let changed = tx.execute(
            "UPDATE _snapback_push_tokens_v1
             SET token_hash = ?1, token_bytes = ?2, session_id = ?3,
                 session_generation = ?4, last_registered_at_ms = ?5
             WHERE id = ?6 AND retired_at_ms IS NULL",
            params![
                token_hash.as_slice(),
                registration.token,
                registration.session_id,
                registration.session_generation as i64,
                registration.now_ms as i64,
                id,
            ],
        )?;
        if changed != 1 {
            return Err(corrupt("push-token rotation lost its live owner"));
        }
        return Ok(PushTokenRegistrationResponse {
            token_id: id.clone(),
            installation_id: registration.installation_id.to_owned(),
            registered_at: registration.now_ms,
            rotated,
            ownership_transferred,
        });
    }

    let token_id = ids::mint_time_ordered(Kind::PushToken);
    tx.execute(
        "INSERT INTO _snapback_push_tokens_v1(
           id, app_scope, principal_id, installation_id, token_hash, token_bytes,
           session_id, session_generation, registered_at_ms, last_registered_at_ms
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            token_id,
            app_scope,
            registration.principal_id,
            registration.installation_id,
            token_hash.as_slice(),
            registration.token,
            registration.session_id,
            registration.session_generation as i64,
            registration.now_ms as i64,
        ],
    )?;
    Ok(PushTokenRegistrationResponse {
        token_id,
        installation_id: registration.installation_id.to_owned(),
        registered_at: registration.now_ms,
        rotated: false,
        ownership_transferred,
    })
}

pub(crate) fn unregister_in(
    tx: &Transaction<'_>,
    declaration: &PushSeamDeclarationV1,
    principal_id: &str,
    session_id: &str,
    session_generation: u64,
    installation_id: &str,
    now_ms: u64,
) -> SnapbackResult<PushTokenUnregisterResponse> {
    declaration.validate()?;
    validate_installation_id(installation_id)?;
    crate::manifest::validate_portable_timestamp_millis(now_ms)?;
    let app_scope = declaration.app_scope.identity();
    let token_id: Option<String> = tx
        .query_row(
            "SELECT id FROM _snapback_push_tokens_v1
             WHERE app_scope = ?1 AND principal_id = ?2 AND installation_id = ?3
               AND session_id = ?4 AND session_generation = ?5
               AND retired_at_ms IS NULL",
            params![
                app_scope,
                principal_id,
                installation_id,
                session_id,
                session_generation as i64,
            ],
            |row| row.get(0),
        )
        .optional()?;
    let retired = match token_id.as_deref() {
        Some(id) => retire_exact_in(tx, id, now_ms, "explicit-unregister", None)? == 1,
        None => false,
    };
    Ok(PushTokenUnregisterResponse { token_id, retired })
}

// The send slice is the first production caller; keep the validated retirement
// transition here so it cannot grow a second custody path there.
#[allow(dead_code)]
pub(crate) fn retire_provider_token_in(
    tx: &Transaction<'_>,
    token_id: &str,
    retired_at_ms: u64,
    provider_reference: &str,
) -> SnapbackResult<bool> {
    if !ids::looks_like(Kind::PushToken, token_id) || !valid_provider_reference(provider_reference)
    {
        return Err(invalid(
            "provider retirement requires a token id and provider reference",
        ));
    }
    Ok(retire_exact_in(
        tx,
        token_id,
        retired_at_ms,
        "device-not-registered",
        Some(provider_reference),
    )? == 1)
}

fn valid_provider_reference(reference: &str) -> bool {
    let body = reference
        .strip_prefix("ticket:")
        .or_else(|| reference.strip_prefix("receipt:"));
    reference.len() <= 255
        && body.is_some_and(|body| {
            !body.is_empty()
                && body
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
}

/// Retire installations whose last registry or handoff activity is outside
/// the app-declared window. The periodic auth maintenance lane calls this even
/// when no registration traffic arrives; registration also invokes it as an
/// opportunistic bound-preserving backstop.
///
/// @ref LLP 0143#d1-device-token-custody — reinstall/token rotation can strand
///   a predecessor, so boundedness is a declared maintenance rule.
pub(crate) fn retire_idle_in(
    tx: &Transaction<'_>,
    declaration: &PushSeamDeclarationV1,
    now_ms: u64,
) -> SnapbackResult<usize> {
    declaration.validate()?;
    crate::manifest::validate_portable_timestamp_millis(now_ms)?;
    let Some(cutoff_ms) = now_ms.checked_sub(declaration.registry.idle_retention_ms) else {
        return Ok(0);
    };
    let app_scope = declaration.app_scope.identity();
    Ok(tx.execute(
        "UPDATE _snapback_push_tokens_v1
         SET retired_at_ms = ?1, retirement_reason = 'idle-retention',
             retirement_reference = NULL, token_bytes = '', token_hash = zeroblob(32)
         WHERE app_scope = ?2 AND retired_at_ms IS NULL
           AND MAX(last_registered_at_ms,
                   COALESCE(last_successful_handoff_at_ms, last_registered_at_ms)) <= ?3",
        params![now_ms as i64, app_scope, cutoff_ms as i64],
    )?)
}

pub(crate) fn clear_in(tx: &Transaction<'_>) -> SnapbackResult<()> {
    require_secure_delete(tx)?;
    for table in [
        "_snapback_push_messages_v1",
        "_snapback_push_batches_v1",
        "_snapback_push_intents_v1",
    ] {
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1)",
            params![table],
            |row| row.get(0),
        )?;
        if exists {
            tx.execute(&format!("DELETE FROM {table}"), [])?;
        }
    }
    tx.execute("DELETE FROM _snapback_push_tokens_v1", [])?;
    Ok(())
}

fn retire_exact_in(
    tx: &Transaction<'_>,
    token_id: &str,
    retired_at_ms: u64,
    reason: &str,
    reference: Option<&str>,
) -> SnapbackResult<usize> {
    validate_retirement_reason(reason)?;
    Ok(tx.execute(
        "UPDATE _snapback_push_tokens_v1
         SET retired_at_ms = ?1, retirement_reason = ?2, retirement_reference = ?3,
             token_bytes = '', token_hash = zeroblob(32)
         WHERE id = ?4 AND retired_at_ms IS NULL",
        params![retired_at_ms as i64, reason, reference, token_id],
    )?)
}

fn validate_token(token: &str) -> SnapbackResult<()> {
    let wrapped = token
        .strip_prefix("ExponentPushToken[")
        .or_else(|| token.strip_prefix("ExpoPushToken["))
        .and_then(|rest| rest.strip_suffix(']'));
    if token.is_empty()
        || token.len() > PUSH_TOKEN_MAX_BYTES
        || wrapped.is_none_or(|body| {
            body.is_empty()
                || !body
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
    {
        return Err(invalid(
            "push token is not a bounded Expo push-token spelling",
        ));
    }
    Ok(())
}

fn validate_installation_id(installation_id: &str) -> SnapbackResult<()> {
    if installation_id.len() <= PUSH_INSTALLATION_MAX_BYTES
        && ids::looks_like(Kind::Installation, installation_id)
    {
        return Ok(());
    }
    Err(invalid(
        "installationId is not a platform-minted installation identifier",
    ))
}

fn validate_retirement_reason(reason: &str) -> SnapbackResult<()> {
    match reason {
        "explicit-unregister"
        | "ownership-transferred"
        | "session-ended"
        | "session-expired"
        | "idle-retention"
        | "device-not-registered" => Ok(()),
        _ => Err(corrupt("push-token retirement reason is not allowlisted")),
    }
}

fn invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_PUSH_TOKEN_INVALID", "push", message)
}

fn corrupt(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_PUSH_REGISTRY_CORRUPT", "push", message)
}

#[cfg(test)]
mod fake_expo;

#[cfg(test)]
mod tests {
    use super::fake_expo::{FakeExpo, FakeExpoStep};
    use super::*;
    use crate::auth::invocation::{
        InvocationGate, InvocationSource, ResolvedAppAuthority, WireAuthorityFields,
    };
    use crate::contract_types::ServerProfile;
    use crate::manifest::{AuthMode, MembershipManifest, MembershipScope, TableManifest};
    use crate::storage::{DbRead, LocalDatabase};

    fn declaration(environment: &str, idle_retention_ms: u64) -> PushSeamDeclarationV1 {
        PushSeamDeclarationV1 {
            app_scope: PushAppScopeV1 {
                eas_project_id: "eas-fixture".into(),
                application_id: "com.example.fixture".into(),
                environment: environment.into(),
            },
            registry: PushRegistryDeclarationV1 { idle_retention_ms },
            audiences: BTreeMap::new(),
            uses: Vec::new(),
            ledger: None,
        }
    }

    fn send_declaration() -> PushSeamDeclarationV1 {
        let mut declaration = declaration("test", 86_400_000);
        declaration.audiences.insert(
            "guests".into(),
            PushAudienceDeclarationV1 {
                resolve: PushAudienceResolverV1::Membership {
                    declaration: "event_members".into(),
                    resource_arg: Some("eventId".into()),
                    roles: vec!["guest".into()],
                },
                authorize: PushAudienceAuthorizeV1::System,
            },
        );
        declaration.ledger = Some(PushLedgerDeclarationV1 {
            retention_ms: 2_592_000_000,
        });
        declaration
    }

    fn registry_database() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("database");
        db.push_registry()
            .activate_current_auth_catalog()
            .expect("auth catalog");
        let declaration = declaration("preview", 86_400_000);
        db.push_registry()
            .activate_push_registry_for_test(declaration)
            .expect("push registry activation");
        db
    }

    fn system_ledger_declaration() -> PushSeamDeclarationV1 {
        let mut declaration = declaration("test", 86_400_000);
        declaration.audiences.insert(
            "selectedGuests".into(),
            PushAudienceDeclarationV1 {
                resolve: PushAudienceResolverV1::ExplicitPrincipals {
                    principals_arg: "principalIds".into(),
                    max_items: 10,
                },
                authorize: PushAudienceAuthorizeV1::System,
            },
        );
        declaration.ledger = Some(PushLedgerDeclarationV1 {
            retention_ms: 2_592_000_000,
        });
        declaration
    }

    #[test]
    fn expo_http_transport_is_exact_authority_or_literal_loopback_fixture_only() {
        assert_eq!(
            expo_http_target_policy("https://exp.host/--/api/v2/push/send"),
            Some(crate::outbound_policy::HttpTargetPolicy::PublicHttpsOnly)
        );
        assert_eq!(
            expo_http_target_policy("https://exp.host:443/--/api/v2/push/getReceipts"),
            Some(crate::outbound_policy::HttpTargetPolicy::PublicHttpsOnly)
        );
        assert_eq!(
            expo_http_target_policy("http://127.0.0.1:43123/--/api/v2/push/send"),
            Some(crate::outbound_policy::HttpTargetPolicy::LocalDevLoopbackHttp)
        );
        for endpoint in [
            "https://exp.host.example/--/api/v2/push/send",
            "https://exp.host:444/--/api/v2/push/send",
            "https://93.184.216.34/--/api/v2/push/send",
            "http://10.0.0.1/--/api/v2/push/send",
        ] {
            assert_eq!(expo_http_target_policy(endpoint), None, "{endpoint}");
        }
    }

    fn app_membership_schema() -> crate::manifest::SchemaManifest {
        let mut schema = crate::manifest::SchemaManifest::default();
        schema.tables.push(TableManifest {
            name: "app_members".into(),
            fields: Vec::new(),
            indexes: Vec::new(),
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            membership: Some(MembershipManifest {
                id: Some("app_members".into()),
                principal: "principal".into(),
                resource: None,
                role: "role".into(),
                roles: vec!["sender".into()],
                pending_roles: None,
                bootstrap_role: None,
                last_holder: None,
                expiry: None,
                incidental: None,
                provenance: None,
                transitions: Vec::new(),
                principal_addressed_writes: None,
                scope: MembershipScope::App,
                resource_table: None,
            }),
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        });
        schema
    }

    fn push_acceptance_schema(
        declaration: PushSeamDeclarationV1,
    ) -> crate::manifest::SchemaManifest {
        let mut schema = crate::manifest::SchemaManifest {
            push_seam: Some(declaration),
            ..Default::default()
        };
        for (table_name, declaration_id, roles) in [
            ("event_members", "event_members", vec!["guest".to_owned()]),
            ("event_senders", "event_senders", vec!["sender".to_owned()]),
        ] {
            schema.tables.push(TableManifest {
                name: table_name.into(),
                fields: Vec::new(),
                indexes: Vec::new(),
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                membership: Some(MembershipManifest {
                    id: Some(declaration_id.into()),
                    principal: "principal".into(),
                    resource: Some("event_id".into()),
                    role: "role".into(),
                    roles,
                    pending_roles: None,
                    bootstrap_role: None,
                    last_holder: None,
                    expiry: None,
                    incidental: None,
                    provenance: None,
                    transitions: Vec::new(),
                    principal_addressed_writes: None,
                    scope: MembershipScope::Resource,
                    resource_table: Some("events".into()),
                }),
                authority_profile: None,
                asset_sharing: None,
                visibility: None,
                history: None,
            });
        }
        schema
    }

    fn acceptance_request(audience: &str, event_id: &str, dedupe_key: &str) -> PushSendRequestV1 {
        PushSendRequestV1 {
            to: PushAudienceReferenceV1 {
                audience: audience.into(),
                args: Map::from_iter([("eventId".into(), Value::String(event_id.into()))]),
            },
            title: "Fixture title".into(),
            body: "Fixture body".into(),
            data: Some(Map::from_iter([("route".into(), json!("/fixture"))])),
            dedupe_key: dedupe_key.into(),
            redrive_ambiguous: false,
        }
    }

    fn session_authority(user_id: &str) -> crate::auth::invocation::PreparedAuthority {
        InvocationGate::prepare_authority(
            InvocationSource::HttpAction,
            AuthMode::Sessions,
            ServerProfile::Test,
            1,
            1,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::Session {
                user_id: user_id.into(),
                session_id: ids::mint(Kind::Session).expect("session id"),
                provider: "email-code".into(),
                generation: 1,
                authority_instance_id: ids::mint(Kind::AuthorityInstance)
                    .expect("authority instance id"),
                session_not_after_ms: 4_000_000_000_000,
                provider_not_after_ms: None,
                rehearsal_provenance: None,
            },
        )
        .expect("prepared session authority")
    }

    fn system_authority() -> crate::auth::invocation::PreparedAuthority {
        InvocationGate::prepare_authority(
            InvocationSource::Cron,
            AuthMode::Sessions,
            ServerProfile::Test,
            1,
            1,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::System,
        )
        .expect("prepared system authority")
    }

    fn insert_session(
        db: &mut LocalDatabase,
        principal_id: &str,
        session_id: &str,
        generation: u64,
        expires_at_ms: u64,
        discriminator: u8,
    ) {
        db.push_registry()
            .insert_session_for_test(
                principal_id,
                session_id,
                generation,
                expires_at_ms,
                discriminator,
            )
            .expect("insert session");
    }

    // Keep every registration security field explicit at the call site: these
    // vectors exercise generation fencing and token custody as one tuple.
    #[allow(clippy::too_many_arguments)]
    fn register(
        db: &mut LocalDatabase,
        declaration: &PushSeamDeclarationV1,
        principal_id: &str,
        session_id: &str,
        session_generation: u64,
        installation_id: &str,
        token: &str,
        now_ms: u64,
    ) -> SnapbackResult<PushTokenRegistrationResponse> {
        db.push_registry().register(
            declaration,
            principal_id,
            session_id,
            session_generation,
            installation_id,
            token,
            now_ms,
        )
    }

    #[test]
    fn token_validator_is_closed_and_never_echoes_bytes() {
        assert!(validate_token("ExponentPushToken[fixture_123]").is_ok());
        assert!(validate_token("ExpoPushToken[fixture-123]").is_ok());
        let secret = "ExponentPushToken[do-not-echo]";
        let error = validate_token(secret.trim_end_matches(']')).unwrap_err();
        assert!(!format!("{error:?}").contains("do-not-echo"));
    }

    #[test]
    fn ledger_projection_is_authorized_and_never_releases_payload_or_token_bytes() {
        let mut db = LocalDatabase::memory().expect("database");
        db.push_registry()
            .activate_current_auth_catalog()
            .expect("auth catalog");
        let declaration = system_ledger_declaration();
        db.push_registry()
            .activate_push_registry_for_test(declaration.clone())
            .expect("push ledger");
        let intent_id = ids::mint_time_ordered(Kind::PushIntent);
        let batch_id = ids::mint_time_ordered(Kind::PushBatch);
        let message_id = ids::mint_time_ordered(Kind::PushMessage);
        let token_id = ids::mint_time_ordered(Kind::PushToken);
        let principal_id = ids::mint(Kind::User).expect("principal id");
        let audience_args = serde_json::to_string(&json!({
            "principalIds": [principal_id],
        }))
        .unwrap();
        db.push_registry()
            .seed_ledger_projection_for_test(
                &declaration,
                &intent_id,
                &batch_id,
                &message_id,
                &token_id,
                &audience_args,
            )
            .expect("ledger fixture");

        let system = system_authority();
        let (rows, dependency) = read_ledger_projection(
            &DbRead::Live(&db),
            &declaration,
            db.schema(),
            &system,
            &intent_id,
        )
        .expect("system ledger read");
        assert!(dependency.is_none());
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].message_id.as_deref(), Some(message_id.as_str()));
        assert_eq!(rows[0].token_id.as_deref(), Some(token_id.as_str()));
        assert_eq!(rows[0].message_state.as_deref(), Some("handed-to-expo"));
        let wire = serde_json::to_string(&rows[0].to_row_value()).unwrap();
        assert!(!wire.contains("payload-secret"));
        assert!(!wire.contains("token-secret"));
        assert!(!wire.contains("dedupe-secret"));

        let user = session_authority(&principal_id);
        assert_eq!(
            read_ledger_projection(
                &DbRead::Live(&db),
                &declaration,
                db.schema(),
                &user,
                &intent_id,
            )
            .expect_err("system audience is not session-readable")
            .diagnostic
            .code,
            "SNAPBACK_AUTH_PERMISSION_DENIED",
        );
    }

    #[test]
    fn provider_error_allowlists_are_stage_specific() {
        validate_ticket_error_code("DeviceNotRegistered").expect("ticket retirement code");
        for receipt_code in [
            "DeviceNotRegistered",
            "MessageTooBig",
            "MessageRateExceeded",
            "InvalidCredentials",
        ] {
            validate_receipt_error_code(receipt_code).expect("receipt error code");
        }
        assert_eq!(
            validate_ticket_error_code("MessageTooBig")
                .expect_err("receipt-only code refuses at ticket stage")
                .diagnostic
                .code,
            "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID"
        );
        assert_eq!(
            validate_receipt_error_code("InvalidExpoPushToken")
                .expect_err("undeclared provider prose/code refuses")
                .diagnostic
                .code,
            "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID"
        );
        assert_eq!(
            classify_expo_send_response(
                200,
                br#"{"data":[{"status":"error","details":{"error":"MessageTooBig"}}]}"#,
                123,
            ),
            PushBatchSettlementV1::Ambiguous {
                code: "provider-shape-invalid".into(),
            }
        );
        assert_eq!(
            classify_expo_send_response(
                400,
                br#"{"errors":[{"code":"UNAUTHORIZED","message":"secret prose"}]}"#,
                123,
            ),
            PushBatchSettlementV1::FailedConfig {
                http_status: Some(400),
                code: "UNAUTHORIZED".into(),
            }
        );
    }

    #[test]
    fn packaged_push_schema_stages_before_the_sessions_catalog_exists() {
        let schema = serde_json::from_str(include_str!(
            "../packages/snapback-cli/fixtures/push-seam/app/snapback/generated/schema.manifest.json"
        ))
        .unwrap();
        let functions = serde_json::from_str(include_str!(
            "../packages/snapback-cli/fixtures/push-seam/app/snapback/generated/functions.manifest.json"
        ))
        .unwrap();
        let mut snapback = crate::local::LocalSnapback::memory().unwrap();
        let prepared = snapback
            .prepare_auth_provision(
                crate::local::EnsureAppMode::Sessions,
                Some(schema),
                Some(functions),
                None,
            )
            .unwrap();
        snapback.commit_auth_provision(prepared, "test").unwrap();
    }

    #[test]
    fn expo_receipt_fixture_maps_only_the_closed_outcome_vocabulary() {
        let parsed = parse_expo_receipt_response(
            br#"{
              "data": {
                "ticket_ok": {"status":"ok"},
                "ticket_device": {"status":"error","message":"must not persist","details":{"error":"DeviceNotRegistered"}},
                "ticket_big": {"status":"error","details":{"error":"MessageTooBig"}},
                "ticket_credentials": {"status":"error","details":{"error":"InvalidCredentials"}},
                "ticket_rate": {"status":"error","details":{"error":"MessageRateExceeded"}}
              }
            }"#,
        )
        .expect("closed Expo receipt fixture");
        assert_eq!(parsed.get("ticket_ok"), Some(&PushReceiptOutcomeV1::Ok));
        for (ticket, code) in [
            ("ticket_device", "DeviceNotRegistered"),
            ("ticket_big", "MessageTooBig"),
            ("ticket_credentials", "InvalidCredentials"),
            ("ticket_rate", "MessageRateExceeded"),
        ] {
            assert_eq!(
                parsed.get(ticket),
                Some(&PushReceiptOutcomeV1::Error { code: code.into() })
            );
        }
        assert_eq!(
            parse_expo_receipt_response(
                br#"{"data":{"ticket":{"status":"error","message":"prose only"}}}"#,
            )
            .expect_err("provider prose is not a receipt classification")
            .diagnostic
            .code,
            "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID"
        );
        assert_eq!(
            parse_expo_receipt_response(
                br#"{"data":{"ticket":{"status":"error","details":{"error":"UnknownProviderCode"}}}}"#,
            )
            .expect_err("unknown provider codes fail closed")
            .diagnostic
            .code,
            "SNAPBACK_PUSH_PROVIDER_SHAPE_INVALID"
        );
    }

    #[test]
    fn fake_expo_acceptance_covers_tickets_receipts_dedupe_ambiguity_and_authorization() {
        const SEND_PATH: &str = "/--/api/v2/push/send";
        const RECEIPT_PATH: &str = "/--/api/v2/push/getReceipts";
        const ACCESS_TOKEN: &str = "fixture-secret";

        let mut declaration = send_declaration();
        declaration.audiences.insert(
            "authorizedGuests".into(),
            PushAudienceDeclarationV1 {
                resolve: PushAudienceResolverV1::Membership {
                    declaration: "event_members".into(),
                    resource_arg: Some("eventId".into()),
                    roles: vec!["guest".into()],
                },
                authorize: PushAudienceAuthorizeV1::Membership {
                    declaration: "event_senders".into(),
                    resource_arg: Some("eventId".into()),
                    roles: vec!["sender".into()],
                },
            },
        );
        let schema = push_acceptance_schema(declaration.clone());
        let mut db = LocalDatabase::memory().expect("database");
        db.push_registry()
            .activate_current_auth_catalog()
            .expect("auth catalog");
        db.push_registry()
            .activate_push_registry_for_test(declaration.clone())
            .expect("push ledger");

        let principal_ok = ids::mint(Kind::User).expect("ok principal");
        let principal_ticket_dnr = ids::mint(Kind::User).expect("ticket DNR principal");
        let principal_receipt_dnr = ids::mint(Kind::User).expect("receipt DNR principal");
        let (token_ok, token_ticket_dnr, token_receipt_dnr) = db
            .push_registry()
            .seed_acceptance_audience_and_tokens_for_test(
                &declaration,
                &principal_ok,
                &principal_ticket_dnr,
                &principal_receipt_dnr,
            )
            .expect("acceptance audience and token custody");

        let request = acceptance_request("guests", "event-main", "acceptance-main");
        let attempt = db
            .push_registry()
            .reserve_send(
                &declaration,
                &schema,
                system_authority,
                PushTriggerModeV1::System,
                None,
                &request,
                100,
            )
            .expect("reserve fixture send");
        assert_eq!(attempt.response.target_count, 3);
        assert_eq!(attempt.response.batch_count, 1);
        let claim = db
            .push_registry()
            .claim_batch(&attempt.batches[0].batch_id, 101)
            .expect("claim fixture batch")
            .expect("fixture batch exists");
        db.push_registry()
            .mark_batch_transmitting(&claim, 102)
            .expect("durable fixture transmit cut");

        let tickets = claim
            .messages
            .iter()
            .map(|message| {
                if message.token_id == token_ok {
                    json!({"status": "ok", "id": "ticket-ok"})
                } else if message.token_id == token_ticket_dnr {
                    json!({
                        "status": "error",
                        "message": "secret-provider-prose-must-not-persist",
                        "details": {"error": "DeviceNotRegistered"}
                    })
                } else {
                    assert_eq!(message.token_id, token_receipt_dnr);
                    json!({"status": "ok", "id": "ticket-receipt-dnr"})
                }
            })
            .collect::<Vec<_>>();
        let mut receipts = Map::new();
        receipts.insert("ticket-ok".into(), json!({"status": "ok"}));
        receipts.insert(
            "ticket-receipt-dnr".into(),
            json!({
                "status": "error",
                "message": "different-secret-provider-prose-must-not-persist",
                "details": {"error": "DeviceNotRegistered"}
            }),
        );
        let provider = FakeExpo::start(vec![
            FakeExpoStep::Json {
                path: SEND_PATH,
                status: 200,
                body: json!({"data": tickets}),
                bearer: Some(ACCESS_TOKEN),
            },
            FakeExpoStep::Json {
                path: RECEIPT_PATH,
                status: 200,
                body: json!({"data": receipts}),
                bearer: Some(ACCESS_TOKEN),
            },
        ]);
        let send_response = post_expo_json(
            &provider.endpoint(SEND_PATH),
            Some(ACCESS_TOKEN),
            expo_send_payload(&claim, &request),
            std::time::Duration::from_secs(5),
        )
        .expect("fixture ticket response");
        let settlement =
            classify_expo_send_response(send_response.status, &send_response.body, 60_000);
        db.push_registry()
            .settle_batch(&claim, &settlement, 103)
            .expect("settle fixture tickets");

        let receipt_due = 103 + PUSH_RECEIPT_FIRST_POLL_MS;
        let receipt_claim = db
            .push_registry()
            .claim_due_receipts(receipt_due)
            .expect("claim fixture receipts");
        assert_eq!(receipt_claim.entries.len(), 2);
        let receipt_response = post_expo_json(
            &provider.endpoint(RECEIPT_PATH),
            Some(ACCESS_TOKEN),
            expo_receipt_payload(&receipt_claim),
            std::time::Duration::from_secs(5),
        )
        .expect("fixture receipt response");
        assert_eq!(receipt_response.status, 200);
        let receipt_outcomes =
            parse_expo_receipt_response(&receipt_response.body).expect("closed receipt response");
        db.push_registry()
            .settle_receipt_poll(&receipt_claim, &receipt_outcomes, receipt_due + 1)
            .expect("settle fixture receipts");

        db.push_registry()
            .assert_acceptance_ledger_outcomes_for_test(&[
                (&token_ok, "expo-accepted", false),
                (&token_ticket_dnr, "failed-permanent", true),
                (&token_receipt_dnr, "expo-error", true),
            ])
            .expect("fixture ledger outcomes");

        let requests = provider.finish();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].path, SEND_PATH);
        assert_eq!(requests[0].body.as_array().map(Vec::len), Some(3));
        assert_eq!(requests[1].path, RECEIPT_PATH);
        let mut receipt_ids = requests[1].body["ids"]
            .as_array()
            .expect("fixture receipt ids")
            .iter()
            .map(|value| value.as_str().expect("ticket id").to_owned())
            .collect::<Vec<_>>();
        receipt_ids.sort();
        assert_eq!(receipt_ids, ["ticket-ok", "ticket-receipt-dnr"]);

        let duplicate = db
            .push_registry()
            .reserve_send(
                &declaration,
                &schema,
                system_authority,
                PushTriggerModeV1::System,
                None,
                &request,
                receipt_due + 2,
            )
            .expect("duplicate intent lookup");
        assert!(duplicate.response.deduplicated);
        assert!(duplicate.batches.is_empty());

        let zero_target = acceptance_request("guests", "event-empty", "acceptance-zero");
        let zero_attempt = db
            .push_registry()
            .reserve_send(
                &declaration,
                &schema,
                system_authority,
                PushTriggerModeV1::System,
                None,
                &zero_target,
                receipt_due + 3,
            )
            .expect("zero-target intent");
        assert_eq!(zero_attempt.response.state, "zero-target");
        assert_eq!(zero_attempt.response.target_count, 0);
        assert!(zero_attempt.batches.is_empty());

        let unauthorized = ids::mint(Kind::User).expect("unauthorized principal");
        let unauthorized_request =
            acceptance_request("authorizedGuests", "event-main", "acceptance-unauthorized");
        let authorization_error = match db.push_registry().reserve_send(
            &declaration,
            &schema,
            || session_authority(&unauthorized),
            PushTriggerModeV1::Immediate,
            None,
            &unauthorized_request,
            receipt_due + 4,
        ) {
            Ok(_) => panic!("unauthorized push send must refuse"),
            Err(error) => error,
        };
        assert_eq!(
            authorization_error.diagnostic.code,
            "SNAPBACK_AUTH_PERMISSION_DENIED"
        );

        let drop_principal = ids::mint(Kind::User).expect("drop principal");
        db.push_registry()
            .seed_drop_audience_for_test(&declaration, &drop_principal)
            .expect("drop fixture audience");
        let drop_request = acceptance_request("guests", "event-drop", "acceptance-drop");
        let drop_attempt = db
            .push_registry()
            .reserve_send(
                &declaration,
                &schema,
                system_authority,
                PushTriggerModeV1::System,
                None,
                &drop_request,
                2_000_000,
            )
            .expect("reserve drop fixture");
        let drop_claim = db
            .push_registry()
            .claim_batch(&drop_attempt.batches[0].batch_id, 2_000_001)
            .expect("claim drop fixture")
            .expect("drop batch exists");
        db.push_registry()
            .mark_batch_transmitting(&drop_claim, 2_000_002)
            .expect("drop fixture transmit cut");
        let dropping_provider =
            FakeExpo::start(vec![FakeExpoStep::DropAfterRequest { path: SEND_PATH }]);
        let uncertainty = post_expo_json(
            &dropping_provider.endpoint(SEND_PATH),
            None,
            expo_send_payload(&drop_claim, &drop_request),
            std::time::Duration::from_secs(5),
        )
        .err()
        .expect("lost response is transport uncertainty");
        assert_eq!(uncertainty, ExpoHttpUncertaintyV1::Transport);
        db.push_registry()
            .settle_batch(
                &drop_claim,
                &PushBatchSettlementV1::Ambiguous {
                    code: "transport-error".into(),
                },
                2_000_003,
            )
            .expect("settle response-loss ambiguity");
        assert_eq!(dropping_provider.finish().len(), 1);
        db.push_registry()
            .assert_no_expired_batch_recovery_for_test(2_100_000)
            .expect("ambiguous settlement has no automatic redrive");

        let implicit_retry = db
            .push_registry()
            .reserve_send(
                &declaration,
                &schema,
                system_authority,
                PushTriggerModeV1::System,
                None,
                &drop_request,
                2_100_001,
            )
            .expect("same key remains a deduplicated lookup");
        assert!(implicit_retry.response.deduplicated);
        assert!(implicit_retry.batches.is_empty());

        let mut explicit_redrive = drop_request.clone();
        explicit_redrive.redrive_ambiguous = true;
        let redriven = db
            .push_registry()
            .reserve_send(
                &declaration,
                &schema,
                system_authority,
                PushTriggerModeV1::System,
                None,
                &explicit_redrive,
                2_100_002,
            )
            .expect("explicit duplicate-risk redrive");
        assert_eq!(redriven.response.attempt, 2);
        assert!(!redriven.response.deduplicated);
        assert_eq!(redriven.batches.len(), 1);
        db.push_registry()
            .redrive_previous_ambiguous_for_test(&redriven.batches[0].batch_id)
            .expect("redrive provenance marker");
    }

    #[test]
    fn deferred_grant_binds_request_and_revalidates_producer_membership() {
        let producer = ids::mint(Kind::User).expect("producer id");
        let audience = PushAudienceDeclarationV1 {
            resolve: PushAudienceResolverV1::Membership {
                declaration: "app_members".into(),
                resource_arg: None,
                roles: vec!["sender".into()],
            },
            authorize: PushAudienceAuthorizeV1::Membership {
                declaration: "app_members".into(),
                resource_arg: None,
                roles: vec!["sender".into()],
            },
        };
        let schema = app_membership_schema();
        let connection = Connection::open_in_memory().expect("sqlite");
        connection
            .execute_batch("CREATE TABLE app_members(principal TEXT, role TEXT);")
            .expect("membership table");
        connection
            .execute(
                "INSERT INTO app_members(principal, role) VALUES(?1, 'sender')",
                params![producer],
            )
            .expect("producer membership");
        let request = PushSendRequestV1 {
            to: PushAudienceReferenceV1 {
                audience: "members".into(),
                args: Map::new(),
            },
            title: "title".into(),
            body: "body".into(),
            data: None,
            dedupe_key: "deferred-1".into(),
            redrive_ambiguous: false,
        };
        let grant = PushDeferredGrantV1 {
            producer_principal: producer.clone(),
            to: request.to.clone(),
            dedupe_key: request.dedupe_key.clone(),
        };
        let authority = system_authority();
        let tx = connection.unchecked_transaction().expect("transaction");
        authorize_send_in(
            &tx,
            &schema,
            &audience,
            &authority,
            PushTriggerModeV1::Deferred,
            Some(&grant),
            &request,
        )
        .expect("exact grant and current membership authorize");

        let mut divergent = request.clone();
        divergent.dedupe_key = "deferred-2".into();
        assert_eq!(
            authorize_send_in(
                &tx,
                &schema,
                &audience,
                &authority,
                PushTriggerModeV1::Deferred,
                Some(&grant),
                &divergent,
            )
            .expect_err("grant is bound to one exact dedupe key")
            .diagnostic
            .code,
            "SNAPBACK_AUTH_PERMISSION_DENIED"
        );
        tx.execute(
            "DELETE FROM app_members WHERE principal = ?1",
            params![producer],
        )
        .expect("revoke producer membership");
        assert_eq!(
            authorize_send_in(
                &tx,
                &schema,
                &audience,
                &authority,
                PushTriggerModeV1::Deferred,
                Some(&grant),
                &request,
            )
            .expect_err("execution revalidates current producer membership")
            .diagnostic
            .code,
            "SNAPBACK_AUTH_PERMISSION_DENIED"
        );
    }

    #[test]
    fn explicit_principals_and_membership_authorize_consume_their_declared_argument_union() {
        let sender = ids::mint(Kind::User).expect("sender id");
        let recipient = ids::mint(Kind::User).expect("recipient id");
        let audience = PushAudienceDeclarationV1 {
            resolve: PushAudienceResolverV1::ExplicitPrincipals {
                principals_arg: "principalIds".into(),
                max_items: 12,
            },
            authorize: PushAudienceAuthorizeV1::Membership {
                declaration: "app_members".into(),
                resource_arg: None,
                roles: vec!["sender".into()],
            },
        };
        let mut args = Map::new();
        args.insert("principalIds".into(), json!([recipient]));
        validate_audience_args(&audience, &args).expect("exact declared union");

        let connection = Connection::open_in_memory().expect("sqlite");
        connection
            .execute_batch("CREATE TABLE app_members(principal TEXT, role TEXT);")
            .expect("membership table");
        connection
            .execute(
                "INSERT INTO app_members(principal, role) VALUES(?1, 'sender')",
                params![sender],
            )
            .expect("sender membership");
        let schema = app_membership_schema();
        let authority = session_authority(&sender);
        let tx = connection.unchecked_transaction().expect("transaction");
        authorize_send_in(
            &tx,
            &schema,
            &audience,
            &authority,
            PushTriggerModeV1::Immediate,
            None,
            &PushSendRequestV1 {
                to: PushAudienceReferenceV1 {
                    audience: "explicitAudience".into(),
                    args: args.clone(),
                },
                title: "title".into(),
                body: "body".into(),
                data: None,
                dedupe_key: "dedupe".into(),
                redrive_ambiguous: false,
            },
        )
        .expect("immediate explicit-principal send is membership-authorized");
        assert_eq!(
            resolve_audience_in(&tx, &schema, &audience.resolve, &args)
                .expect("explicit-principal resolution"),
            vec![recipient]
        );

        let mut extra_args = args.clone();
        extra_args.insert("escapeHatch".into(), json!([sender]));
        assert_eq!(
            validate_audience_args(&audience, &extra_args)
                .expect_err("extra argument refuses")
                .diagnostic
                .code,
            "SNAPBACK_PUSH_SEND_INVALID"
        );
        assert_eq!(
            authorize_send_in(
                &tx,
                &schema,
                &audience,
                &authority,
                PushTriggerModeV1::Deferred,
                None,
                &PushSendRequestV1 {
                    to: PushAudienceReferenceV1 {
                        audience: "explicitAudience".into(),
                        args,
                    },
                    title: "title".into(),
                    body: "body".into(),
                    data: None,
                    dedupe_key: "dedupe".into(),
                    redrive_ambiguous: false,
                },
            )
            .expect_err("deferred raw principal list refuses")
            .diagnostic
            .code,
            "SNAPBACK_AUTH_PERMISSION_DENIED"
        );
    }

    #[test]
    fn undeclared_database_has_no_registry_storage_or_lifecycle_triggers() {
        let mut db = LocalDatabase::memory().expect("undeclared database");
        db.push_registry()
            .activate_current_auth_catalog()
            .expect("auth catalog");
        let push_objects = |db: &mut LocalDatabase| -> Vec<String> {
            db.push_registry()
                .object_names_for_test()
                .expect("push object inventory")
        };
        assert!(push_objects(&mut db).is_empty());
        assert_eq!(
            db.push_registry()
                .push_registry_inspection()
                .expect("zero-cost inspection projection"),
            PushRegistryInspectionV1::default()
        );

        db.push_registry()
            .activate_push_registry_for_test(declaration("preview", 86_400_000))
            .expect("declared activation");
        assert!(!push_objects(&mut db).is_empty());
        db.push_registry()
            .activate_manifest(None)
            .expect("declaration removal");
        assert!(push_objects(&mut db).is_empty());
    }

    #[test]
    fn send_declaration_owns_exact_normalized_ledger_and_registry_only_does_not() {
        let mut db = LocalDatabase::memory().expect("database");
        db.push_registry()
            .activate_current_auth_catalog()
            .expect("auth catalog");
        db.push_registry()
            .activate_push_registry_for_test(declaration("test", 86_400_000))
            .expect("registry-only activation");
        let ledger_tables = |db: &mut LocalDatabase| -> Vec<String> {
            db.push_registry()
                .ledger_table_names_for_test()
                .expect("ledger table inventory")
        };
        assert!(ledger_tables(&mut db).is_empty());

        db.push_registry()
            .activate_push_registry_for_test(send_declaration())
            .expect("send activation");
        assert_eq!(ledger_tables(&mut db).len(), 3);
        db.push_registry()
            .validate_exact_ledger_schema()
            .expect("exact ledger");

        db.push_registry()
            .tamper_ledger_index_for_test()
            .expect("tamper ledger index");
        let error = db
            .push_registry()
            .validate_exact_ledger_schema()
            .expect_err("tampered physical ledger index refuses");
        assert_eq!(error.diagnostic.code, "SNAPBACK_PUSH_REGISTRY_CORRUPT");
    }

    #[test]
    fn mixed_batch_aggregate_never_hides_ambiguity_or_a_pending_sibling() {
        let mut db = LocalDatabase::memory().expect("database");
        db.push_registry()
            .activate_current_auth_catalog()
            .expect("auth catalog");
        db.push_registry()
            .activate_push_registry_for_test(send_declaration())
            .expect("send ledger");
        let intent_id = ids::mint_time_ordered(Kind::PushIntent);
        let ambiguous_batch = ids::mint_time_ordered(Kind::PushBatch);
        let pending_batch = ids::mint_time_ordered(Kind::PushBatch);
        let failed_batch = ids::mint_time_ordered(Kind::PushBatch);
        let ambiguous_message = ids::mint_time_ordered(Kind::PushMessage);
        let pending_message = ids::mint_time_ordered(Kind::PushMessage);
        let failed_message = ids::mint_time_ordered(Kind::PushMessage);
        db.push_registry()
            .seed_mixed_batch_aggregate_for_test(
                &intent_id,
                &ambiguous_batch,
                &pending_batch,
                &failed_batch,
                &ambiguous_message,
                &pending_message,
                &failed_message,
            )
            .expect("mixed aggregate fixture");
    }

    #[test]
    fn reserved_recovery_rebinds_rotation_drops_retirement_and_never_redrives_transmitting() {
        let mut db = LocalDatabase::memory().expect("database");
        db.push_registry()
            .activate_current_auth_catalog()
            .expect("auth catalog");
        db.push_registry()
            .activate_push_registry_for_test(send_declaration())
            .expect("send ledger");
        let token_id = ids::mint_time_ordered(Kind::PushToken);
        let intent_id = ids::mint_time_ordered(Kind::PushIntent);
        let batch_id = ids::mint_time_ordered(Kind::PushBatch);
        let message_id = ids::mint_time_ordered(Kind::PushMessage);
        let installation_id = ids::mint(Kind::Installation).unwrap();
        let first_hash = Sha256::digest(b"ExponentPushToken[first]").to_vec();
        db.push_registry()
            .seed_reserved_recovery_for_test(
                &token_id,
                &intent_id,
                &batch_id,
                &message_id,
                &installation_id,
                &first_hash,
            )
            .unwrap();

        assert!(
            db.push_registry()
                .claim_recovered_batch_for_transmit(9)
                .unwrap()
                .is_none(),
            "maintenance must not race a fresh fence-zero action reservation"
        );

        let first_claim = db
            .push_registry()
            .claim_batch(&batch_id, 10)
            .unwrap()
            .expect("first claim");
        assert_eq!(first_claim.messages[0].token, "ExponentPushToken[first]");
        let rotated_hash = Sha256::digest(b"ExponentPushToken[rotated]").to_vec();
        db.push_registry()
            .rotate_token_and_recover_reserved_for_test(&token_id, &rotated_hash)
            .unwrap();
        let recovered = db
            .push_registry()
            .claim_recovered_batch_for_transmit(31_001)
            .unwrap()
            .expect("safe recovery claim");
        assert_eq!(
            recovered.claim.messages[0].token,
            "ExponentPushToken[rotated]"
        );
        assert_eq!(
            recovered.payload,
            json!([{
                "to": "ExponentPushToken[rotated]",
                "title": "hello",
                "body": "world",
                "data": null,
            }])
        );

        // Recovery committed the durable transmit cut with the new claim; a
        // second crash from this point is never redriven.
        db.push_registry()
            .assert_transmitting_recovery_ambiguous_for_test(&batch_id)
            .unwrap();

        // A separately reserved batch whose registry row retires before its
        // first byte becomes a settled no-handoff, with custody erased.
        let retired_intent = ids::mint_time_ordered(Kind::PushIntent);
        let retired_batch = ids::mint_time_ordered(Kind::PushBatch);
        let retired_message = ids::mint_time_ordered(Kind::PushMessage);
        let live_message = ids::mint_time_ordered(Kind::PushMessage);
        let live_token_id = ids::mint_time_ordered(Kind::PushToken);
        let live_installation_id = ids::mint(Kind::Installation).unwrap();
        let live_hash = Sha256::digest(b"ExponentPushToken[live]").to_vec();
        db.push_registry()
            .seed_retired_recovery_for_test(
                &retired_intent,
                &retired_batch,
                &retired_message,
                &live_message,
                &live_token_id,
                &live_installation_id,
                &live_hash,
                &token_id,
                &rotated_hash,
            )
            .unwrap();
        let mixed_claim = db
            .push_registry()
            .claim_batch(&retired_batch, 70_001)
            .unwrap()
            .expect("the live sibling remains claimable");
        assert_eq!(mixed_claim.messages.len(), 1);
        assert_eq!(mixed_claim.messages[0].message_id, live_message);
        db.push_registry()
            .settle_mixed_retired_recovery_for_test(&mixed_claim, &retired_batch)
            .unwrap();
    }

    #[test]
    fn activation_refuses_a_preexisting_non_exact_registry_table() {
        let mut db = LocalDatabase::memory().expect("database");
        db.push_registry()
            .activate_current_auth_catalog()
            .expect("auth catalog");
        let tampered_table = REGISTRY_TABLE_SQL.replace(
            "retirement_reference TEXT,",
            "retirement_reference TEXT, tampered_column TEXT,",
        );
        db.push_registry()
            .create_lookalike_registry_for_test(&tampered_table)
            .expect("preexisting lookalike table");

        let error = db
            .push_registry()
            .activate_manifest_with_for_test(|| declaration("preview", 86_400_000))
            .expect_err("CREATE IF NOT EXISTS must not adopt a lookalike table");
        assert_eq!(error.diagnostic.code, "SNAPBACK_PUSH_REGISTRY_CORRUPT");
    }

    #[test]
    fn inspection_refuses_tampered_registry_index_and_trigger() {
        let mut index_db = registry_database();
        index_db
            .push_registry()
            .tamper_registry_index_for_test()
            .expect("tamper physical registry index while forging expected SQL text");
        let index_error = index_db
            .push_registry()
            .push_registry_inspection()
            .expect_err("physical index shape defeats forged sqlite_schema text");
        assert_eq!(
            index_error.diagnostic.code,
            "SNAPBACK_PUSH_REGISTRY_CORRUPT"
        );

        let mut trigger_db = registry_database();
        trigger_db
            .push_registry()
            .tamper_lifecycle_trigger_for_test()
            .expect("tamper lifecycle trigger");
        let trigger_error = trigger_db
            .push_registry()
            .push_registry_inspection()
            .expect_err("non-exact attached trigger refuses");
        assert_eq!(
            trigger_error.diagnostic.code,
            "SNAPBACK_PUSH_REGISTRY_CORRUPT"
        );
    }

    #[test]
    fn provider_retirement_is_idempotent_and_erases_token_bytes() {
        let mut db = LocalDatabase::memory().expect("database");
        db.push_registry()
            .activate_current_auth_catalog()
            .expect("auth catalog");
        db.push_registry()
            .activate_push_registry_for_test(declaration("preview", 86_400_000))
            .expect("push registry");
        let token_id = ids::mint_time_ordered(Kind::PushToken);
        db.push_registry()
            .provider_retirement_for_test(&token_id)
            .expect("retirement transaction");
    }

    #[test]
    fn registration_is_idempotent_rotates_atomically_and_enforces_single_owner() {
        let mut db = registry_database();
        insert_session(&mut db, "user-a", "session-a", 1, 1_000_000_000, 1);
        insert_session(&mut db, "user-b", "session-b", 1, 1_000_000_000, 2);
        let scope = declaration("preview", 86_400_000);
        let installation_a = ids::mint(Kind::Installation).expect("installation a");
        let installation_b = ids::mint(Kind::Installation).expect("installation b");
        let first_token = "ExponentPushToken[first_secret]";
        let rotated_token = "ExponentPushToken[rotated_secret]";

        let first = register(
            &mut db,
            &scope,
            "user-a",
            "session-a",
            1,
            &installation_a,
            first_token,
            100,
        )
        .expect("first registration");
        let repeated = register(
            &mut db,
            &scope,
            "user-a",
            "session-a",
            1,
            &installation_a,
            first_token,
            101,
        )
        .expect("idempotent registration");
        assert_eq!(repeated.token_id, first.token_id);
        assert!(!repeated.rotated);

        let rotated = register(
            &mut db,
            &scope,
            "user-a",
            "session-a",
            1,
            &installation_a,
            rotated_token,
            102,
        )
        .expect("atomic rotation");
        assert_eq!(rotated.token_id, first.token_id);
        assert!(rotated.rotated);

        let transferred = register(
            &mut db,
            &scope,
            "user-b",
            "session-b",
            1,
            &installation_b,
            rotated_token,
            103,
        )
        .expect("same-scope ownership transfer");
        assert_ne!(transferred.token_id, first.token_id);
        assert!(transferred.ownership_transferred);

        let (live, predecessor): (i64, (String, String)) = db
            .push_registry()
            .registry_facts_for_test(&first.token_id)
            .expect("registry facts");
        assert_eq!(live, 1);
        assert_eq!(predecessor, (String::new(), "ownership-transferred".into()));

        let other_scope = declaration("production", 86_400_000);
        let activation_error = db
            .push_registry()
            .activate_manifest(Some(&other_scope))
            .expect_err("live old scope blocks schema activation");
        assert_eq!(
            activation_error.diagnostic.code,
            "SNAPBACK_PUSH_APP_SCOPE_CHANGE_BLOCKED"
        );
        let collision = register(
            &mut db,
            &other_scope,
            "user-a",
            "session-a",
            1,
            &installation_a,
            rotated_token,
            104,
        )
        .expect_err("cross-scope token collision refuses");
        assert_eq!(
            collision.diagnostic.code,
            "SNAPBACK_PUSH_TOKEN_SCOPE_COLLISION"
        );
        assert_eq!(
            collision.diagnostic.details,
            json!({
                "indicator": "push-token-cross-app-scope-collision",
                "action": "registration-refused",
            })
        );
        let encoded = serde_json::to_string(&collision).expect("diagnostic serialization");
        assert!(!encoded.contains("rotated_secret"));

        let inspection = db
            .push_registry()
            .push_registry_inspection()
            .expect("operator inspection");
        assert_eq!(inspection.live_tokens, 1);
        assert_eq!(inspection.retired_tokens, 1);
        assert_eq!(inspection.retirement_reasons["ownership-transferred"], 1);
        let inspection_json = serde_json::to_string(&inspection).expect("inspection json");
        assert!(!inspection_json.contains("PushToken"));
        assert!(!inspection_json.contains("secret"));
    }

    #[test]
    fn durable_session_end_retires_exact_generation_and_stale_registration_cannot_resurrect() {
        let mut db = registry_database();
        let logout_session = ids::mint(Kind::Session).expect("logout session");
        let sibling_session = ids::mint(Kind::Session).expect("sibling session");
        insert_session(&mut db, "user-a", &logout_session, 1, 1_000_000_000, 3);
        insert_session(&mut db, "user-a", &sibling_session, 1, 1_000_000_000, 4);
        let scope = declaration("preview", 86_400_000);
        let logout_installation = ids::mint(Kind::Installation).expect("logout installation");
        let sibling_installation = ids::mint(Kind::Installation).expect("sibling installation");
        register(
            &mut db,
            &scope,
            "user-a",
            &logout_session,
            1,
            &logout_installation,
            "ExponentPushToken[logout_secret]",
            100,
        )
        .expect("logout registration");
        register(
            &mut db,
            &scope,
            "user-a",
            &sibling_session,
            1,
            &sibling_installation,
            "ExponentPushToken[sibling_secret]",
            100,
        )
        .expect("sibling registration");

        db.push_registry()
            .logout_session_for_test(&logout_session)
            .expect("logout commit");

        let facts: Vec<(String, Option<String>, String)> = db
            .push_registry()
            .session_retirement_facts_for_test()
            .expect("session retirement facts");
        let facts = facts
            .into_iter()
            .map(|(session_id, reason, bytes)| (session_id, (reason, bytes)))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            facts[logout_session.as_str()],
            (Some("session-ended".into()), String::new())
        );
        assert_eq!(
            facts[sibling_session.as_str()],
            (None, "ExponentPushToken[sibling_secret]".into())
        );
        let stale = register(
            &mut db,
            &scope,
            "user-a",
            &logout_session,
            1,
            &logout_installation,
            "ExponentPushToken[resurrection_secret]",
            201,
        )
        .expect_err("stale generation loses to logout");
        assert_eq!(stale.diagnostic.code, "SNAPBACK_PUSH_SESSION_STALE");

        // The same storage hook owns an administrator/durable revocation;
        // exact predecessor generation remains the invariant, not the cause.
        db.push_registry()
            .durable_revoke_session_for_test(&sibling_session)
            .expect("administrator durable-revocation commit");
        assert_eq!(
            db.push_registry()
                .push_registry_inspection()
                .expect("inspection after durable revocation")
                .retirement_reasons["session-ended"],
            2
        );
    }

    #[test]
    fn auth_clock_frontier_retires_expiry_in_its_exact_commit() {
        let mut db = registry_database();
        insert_session(&mut db, "user-a", "expiring-session", 1, 500, 5);
        let scope = declaration("preview", 86_400_000);
        let installation = ids::mint(Kind::Installation).expect("expiry installation");
        register(
            &mut db,
            &scope,
            "user-a",
            "expiring-session",
            1,
            &installation,
            "ExponentPushToken[expiry_secret]",
            100,
        )
        .expect("expiry registration");
        db.advance_auth_session_clock_floor(499)
            .expect("pre-expiry frontier");
        assert_eq!(
            db.push_registry()
                .push_registry_inspection()
                .unwrap()
                .live_tokens,
            1
        );
        db.advance_auth_session_clock_floor(500)
            .expect("expiry frontier commit");
        let inspection = db.push_registry().push_registry_inspection().unwrap();
        assert_eq!(inspection.live_tokens, 0);
        assert_eq!(inspection.retirement_reasons["session-expired"], 1);
        let bytes: String = db.push_registry().token_bytes_for_test().unwrap();
        assert!(bytes.is_empty());
        let stale = register(
            &mut db,
            &scope,
            "user-a",
            "expiring-session",
            1,
            &installation,
            "ExponentPushToken[expiry_resurrection_secret]",
            499,
        )
        .expect_err("durable expiry floor blocks registration after wall-clock rollback");
        assert_eq!(stale.diagnostic.code, "SNAPBACK_PUSH_SESSION_STALE");
        assert_eq!(
            db.push_registry()
                .push_registry_inspection()
                .unwrap()
                .live_tokens,
            0
        );
    }

    #[test]
    fn declared_idle_retention_retires_only_outside_the_window() {
        let mut db = registry_database();
        insert_session(&mut db, "user-a", "idle-session", 1, 1_000_000_000, 6);
        let retention = 86_400_000;
        let scope = declaration("preview", retention);
        let installation = ids::mint(Kind::Installation).expect("idle installation");
        register(
            &mut db,
            &scope,
            "user-a",
            "idle-session",
            1,
            &installation,
            "ExponentPushToken[idle_secret]",
            100,
        )
        .expect("idle registration");
        db.push_registry()
            .assert_idle_retention_for_test(&scope, retention)
            .expect("idle maintenance");
        let inspection = db.push_registry().push_registry_inspection().unwrap();
        assert_eq!(inspection.live_tokens, 0);
        assert_eq!(inspection.retirement_reasons["idle-retention"], 1);
    }
}
