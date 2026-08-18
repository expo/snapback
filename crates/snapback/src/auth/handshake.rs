//! Closed bootstrap-handshake wire types and availability computation.
//!
//! The handshake is discovery, not authentication: every protected request
//! repeats its protocol offer and resolves its own credential. Keeping the
//! computation pure lets HTTP, tests, and the client sentinel share one exact
//! matrix without turning a previous handshake into server-side state.

// @ref LLP 0058#bootstrap-handshake — discovery advertises exact protocol readiness but never substitutes for per-request authority resolution.

use axum::http::HeaderMap;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub use crate::auth::mode::{
    AppDataAvailability as AppDataAvailabilityWire, AuthModeStatus as AuthModeStateWire,
    AuthProgramReadiness, DeploymentIdentity,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{AuthMode, AuthorityDescriptor};

pub const AUTH_CLIENT_PROTOCOL_HEADER: &str = "x-snapback-auth-client-protocol";
pub const AUTH_INVALIDATION_PROTOCOL_HEADER: &str = "x-snapback-auth-invalidation-protocol";
pub const AUTHORITY_DESCRIPTOR_PROTOCOL_HEADER: &str = "x-snapback-authority-descriptor-protocol";
pub const AUTHORIZED_LEASE_PROTOCOL_HEADER: &str = "x-snapback-authorized-lease-protocol";
pub const AUTH_CLIENT_PROTOCOL_SUBPROTOCOL_PREFIX: &str = "snapback.auth-client.";
pub const AUTH_INVALIDATION_PROTOCOL_SUBPROTOCOL_PREFIX: &str = "snapback.auth-invalidation.";
pub const AUTHORITY_DESCRIPTOR_PROTOCOL_SUBPROTOCOL_PREFIX: &str = "snapback.authority-descriptor.";
pub const AUTHORIZED_LEASE_PROTOCOL_SUBPROTOCOL_PREFIX: &str = "snapback.authorized-lease.";
pub const AUTH_PROTOCOL_V1: u64 = 1;

pub const AUTHORIZED_LEASE_PROTOCOL_VERSION: u32 = 1;
pub const AUTHORIZED_LEASE_DEFAULT_MS: u64 = 86_400_000;
pub const AUTHORIZED_LEASE_HARD_MAX_MS: u64 = 86_400_000;

pub(crate) fn lease_error(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "auth", message.into())
}

/// Validated per-app lease duration.  A larger value is a startup/config
/// error; it is never silently clamped into a misleading capability fact.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AuthorizedLeaseConfig {
    configured_ms: u64,
}

impl AuthorizedLeaseConfig {
    pub fn new(configured_ms: u64) -> SnapbackResult<Self> {
        if configured_ms == 0 || configured_ms > AUTHORIZED_LEASE_HARD_MAX_MS {
            return Err(lease_error(
                "SNAPBACK_AUTHORIZED_LEASE_CONFIG_INVALID",
                format!(
                    "authorized lease duration must be between 1 and {AUTHORIZED_LEASE_HARD_MAX_MS} milliseconds",
                ),
            ));
        }
        Ok(Self { configured_ms })
    }

    pub const fn configured_ms(self) -> u64 {
        self.configured_ms
    }
}

impl Default for AuthorizedLeaseConfig {
    fn default() -> Self {
        Self {
            configured_ms: AUTHORIZED_LEASE_DEFAULT_MS,
        }
    }
}

/// Capability/runtime facts projected by the bootstrap handshake.
///
/// Every member except `configuredMs` is a v1 protocol constant pinned by
/// LLP 0053's capability report; the schema publishes them as `const` so a
/// target advertising different lease semantics fails conformance instead of
/// passing a shape check the executable kit validator would reject.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizedLeaseFacts {
    #[schemars(extend("const" = 1))]
    pub protocol_version: u32,
    #[schemars(extend("const" = 86400000))]
    pub default_ms: u64,
    #[schemars(extend("const" = 86400000))]
    pub hard_max_ms: u64,
    #[schemars(range(min = 1, max = AUTHORIZED_LEASE_HARD_MAX_MS))]
    pub configured_ms: u64,
    #[schemars(extend("const" = ["session", "provider"]))]
    pub clamps: Vec<String>,
    #[schemars(extend("const" = "full-revalidation"))]
    pub renewal: String,
    #[schemars(extend("const" = "server-absolute+client-request-elapsed"))]
    pub time_basis: String,
    #[schemars(extend("const" = "delete-before-read"))]
    pub clock_rollback: String,
}

impl From<AuthorizedLeaseConfig> for AuthorizedLeaseFacts {
    fn from(config: AuthorizedLeaseConfig) -> Self {
        Self {
            protocol_version: AUTHORIZED_LEASE_PROTOCOL_VERSION,
            default_ms: AUTHORIZED_LEASE_DEFAULT_MS,
            hard_max_ms: AUTHORIZED_LEASE_HARD_MAX_MS,
            configured_ms: config.configured_ms,
            clamps: vec!["session".to_owned(), "provider".to_owned()],
            renewal: "full-revalidation".to_owned(),
            time_basis: "server-absolute+client-request-elapsed".to_owned(),
            clock_rollback: "delete-before-read".to_owned(),
        }
    }
}

/// Parsed offers preserve an unknown integer for gate diagnostics while the
/// public echo exposes only exact versions this binary understands.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct AuthClientProtocolOffers {
    pub auth_client: Option<u64>,
    pub auth_invalidation: Option<u64>,
    pub authority_descriptor: Option<u64>,
    pub authorized_lease: Option<u64>,
}

impl AuthClientProtocolOffers {
    /// Ordinary HTTP requests accept only the four named decimal headers.
    /// `Sec-WebSocket-Protocol` is a carrier exclusively for a genuine browser
    /// WebSocket upgrade and must not become a second bootstrap grammar.
    pub fn from_http_headers(headers: &HeaderMap) -> Self {
        Self {
            auth_client: decimal_protocol_header(headers, AUTH_CLIENT_PROTOCOL_HEADER),
            auth_invalidation: decimal_protocol_header(headers, AUTH_INVALIDATION_PROTOCOL_HEADER),
            authority_descriptor: decimal_protocol_header(
                headers,
                AUTHORITY_DESCRIPTOR_PROTOCOL_HEADER,
            ),
            authorized_lease: decimal_protocol_header(headers, AUTHORIZED_LEASE_PROTOCOL_HEADER),
        }
    }

    /// WebSocket-upgrade parsing: custom headers win when available; browser
    /// clients may carry the same offers in closed subprotocol tokens.
    pub fn from_headers(headers: &HeaderMap) -> Self {
        Self {
            auth_client: decimal_protocol_offer(
                headers,
                AUTH_CLIENT_PROTOCOL_HEADER,
                AUTH_CLIENT_PROTOCOL_SUBPROTOCOL_PREFIX,
            ),
            auth_invalidation: decimal_protocol_offer(
                headers,
                AUTH_INVALIDATION_PROTOCOL_HEADER,
                AUTH_INVALIDATION_PROTOCOL_SUBPROTOCOL_PREFIX,
            ),
            authority_descriptor: decimal_protocol_offer(
                headers,
                AUTHORITY_DESCRIPTOR_PROTOCOL_HEADER,
                AUTHORITY_DESCRIPTOR_PROTOCOL_SUBPROTOCOL_PREFIX,
            ),
            authorized_lease: decimal_protocol_offer(
                headers,
                AUTHORIZED_LEASE_PROTOCOL_HEADER,
                AUTHORIZED_LEASE_PROTOCOL_SUBPROTOCOL_PREFIX,
            ),
        }
    }

    fn echoed(self) -> ClientProtocols {
        ClientProtocols {
            auth_client: exact_v1(self.auth_client),
            auth_invalidation: exact_v1(self.auth_invalidation),
            authority_descriptor: exact_v1(self.authority_descriptor),
            authorized_lease: exact_v1(self.authorized_lease),
        }
    }
}

fn exact_v1(value: Option<u64>) -> Option<u64> {
    (value == Some(AUTH_PROTOCOL_V1)).then_some(AUTH_PROTOCOL_V1)
}

fn decimal_protocol_header(headers: &HeaderMap, name: &'static str) -> Option<u64> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?.as_bytes();
    if values.next().is_some() || value.is_empty() || !value.iter().all(u8::is_ascii_digit) {
        return None;
    }
    std::str::from_utf8(value).ok()?.parse().ok()
}

fn decimal_protocol_offer(
    headers: &HeaderMap,
    header_name: &'static str,
    subprotocol_prefix: &'static str,
) -> Option<u64> {
    // A custom HTTP header is authoritative when the transport can send one.
    // Browser WebSockets cannot, so the upgrade offers the same version in a
    // closed Sec-WebSocket-Protocol token instead. A present-but-malformed or
    // duplicated custom header never falls through to the alternate carrier.
    if headers.contains_key(header_name) {
        return decimal_protocol_header(headers, header_name);
    }
    let mut offered = headers
        .get_all(axum::http::header::SEC_WEBSOCKET_PROTOCOL)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .filter_map(|value| value.strip_prefix(subprotocol_prefix));
    let value = offered.next()?;
    if offered.next().is_some()
        || value.is_empty()
        || !value.as_bytes().iter().all(u8::is_ascii_digit)
    {
        return None;
    }
    value.parse().ok()
}

// @ref LLP 0058#exact-response-dto — the schema is the executable client
// contract: every member is mandatory (nullable is expressed by value, never
// by omission). The authority kind distinguishes a human session from a
// service principal so admitting the latter's null session id cannot weaken
// browser-session custody.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AuthSessionAuthorityKind {
    Anonymous,
    HumanSession,
    ServicePrincipal,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(extend(
    "required" = ["kind", "userId", "sessionId", "isAuthenticated"],
    "oneOf" = [
      {"properties": {"kind": {"const": "anonymous"}, "userId": {"type": "null"}, "sessionId": {"type": "null"}, "isAuthenticated": {"const": false}}},
      {"properties": {"kind": {"const": "humanSession"}, "userId": {"type": "string", "pattern": crate::ids::ID_WIRE_PATTERN}, "sessionId": {"type": "string", "pattern": crate::ids::ID_WIRE_PATTERN}, "isAuthenticated": {"const": true}}},
      {"properties": {"kind": {"const": "servicePrincipal"}, "userId": {"type": "string", "pattern": crate::ids::ID_WIRE_PATTERN}, "sessionId": {"type": "null"}, "isAuthenticated": {"const": true}}}
    ]
))]
pub struct AuthSessionAuthority {
    pub kind: AuthSessionAuthorityKind,
    pub user_id: Option<String>,
    pub session_id: Option<String>,
    pub is_authenticated: bool,
}

/// Handshake-specific descriptor closure. Mutation inputs retain their own
/// diagnostic surface; the bootstrap schema pins protocol-v1 and canonical
/// UUIDv7 independently so the server schema and executable kit agree.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthSessionAuthorityDescriptor {
    #[schemars(range(min = 1, max = 1))]
    pub descriptor_version: u64,
    #[schemars(pattern(crate::ids::ID_WIRE_PATTERN))]
    pub authority_instance_id: String,
    /// Zero is the anonymous/no-session sentinel; authenticated session
    /// descriptors are positive and every value stays JavaScript-safe.
    #[schemars(range(max = crate::manifest::AUTHORITY_DESCRIPTOR_MAX_SESSION_GENERATION))]
    pub session_generation: u64,
}

impl From<AuthorityDescriptor> for AuthSessionAuthorityDescriptor {
    fn from(value: AuthorityDescriptor) -> Self {
        Self {
            descriptor_version: u64::from(value.descriptor_version),
            authority_instance_id: value.authority_instance_id,
            session_generation: value.session_generation,
        }
    }
}

impl AuthSessionAuthority {
    pub fn anonymous() -> Self {
        Self {
            kind: AuthSessionAuthorityKind::Anonymous,
            user_id: None,
            session_id: None,
            is_authenticated: false,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthSessionProvider {
    #[schemars(length(min = 1))]
    pub key: String,
    pub available: bool,
}

// @ref LLP 0058#exact-response-dto — protocol echoes are exactly the versions
// this binary understands: v1 or null, never another integer, and never an
// omitted member. The schema pins that so conformance cannot approve a
// response shape the executable kit validator rejects.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(extend(
    "required" = ["authClient", "authInvalidation", "authorityDescriptor", "authorizedLease"]
))]
pub struct ClientProtocols {
    #[schemars(extend("enum" = [1, null]))]
    pub auth_client: Option<u64>,
    #[schemars(extend("enum" = [1, null]))]
    pub auth_invalidation: Option<u64>,
    #[schemars(extend("enum" = [1, null]))]
    pub authority_descriptor: Option<u64>,
    #[schemars(extend("enum" = [1, null]))]
    pub authorized_lease: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(extend("required" = ["available", "reason"]))]
pub struct OnlineAvailability {
    pub available: bool,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(extend(
    "required" = ["available", "minimumAuthInvalidationProtocol", "reason"]
))]
pub struct AuthScopedLiveAvailability {
    pub available: bool,
    #[schemars(extend("enum" = [1, null]))]
    pub minimum_auth_invalidation_protocol: Option<u64>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(extend(
    "required" = [
        "available",
        "minimumAuthInvalidationProtocol",
        "minimumAuthorizedLeaseProtocol",
        "reason"
    ]
))]
pub struct RetainedReadAvailability {
    pub available: bool,
    #[schemars(extend("enum" = [1, null]))]
    pub minimum_auth_invalidation_protocol: Option<u64>,
    #[schemars(extend("enum" = [1, null]))]
    pub minimum_authorized_lease_protocol: Option<u64>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(extend(
    "required" = ["available", "minimumAuthorityDescriptorProtocol", "reason"]
))]
pub struct QueuedReplayAvailability {
    pub available: bool,
    #[schemars(extend("enum" = [1, null]))]
    pub minimum_authority_descriptor_protocol: Option<u64>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthSessionAvailability {
    pub online_request_response: OnlineAvailability,
    pub auth_scoped_live: AuthScopedLiveAvailability,
    pub retained_reads: RetainedReadAvailability,
    pub queued_replay: QueuedReplayAvailability,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(extend(
    "required" = [
        "protocolVersion",
        "serverStartupNonce",
        "authorizationStreamIncarnation",
        "transitionGeneration",
        "activeMode",
        "desiredMode",
        "modeState",
        "appDataAvailability",
        "quarantineCode",
        "clientProtocols",
        "availability",
        "provider",
        "transports",
        "authority",
        "authorityDescriptor",
        "deploymentIdentity",
        "authorizedLease"
    ],
    "allOf" = [
      {
        "if": {"properties": {"activeMode": {"const": "dev"}}},
        "then": {"properties": {"authority": {"properties": {"kind": {"const": "anonymous"}}}}}
      },
      {
        "if": {"properties": {"authority": {"properties": {"kind": {"enum": ["humanSession", "servicePrincipal"]}}}}},
        "then": {"properties": {"activeMode": {"const": "sessions"}}}
      }
    ],
    "oneOf" = [
      {
        "properties": {
          "authority": {"properties": {"kind": {"const": "anonymous"}}},
          "authorityDescriptor": {"properties": {"sessionGeneration": {"const": 0}}}
        }
      },
      {
        "properties": {
          "authority": {"properties": {"kind": {"const": "humanSession"}}},
          "authorityDescriptor": {"properties": {"sessionGeneration": {"minimum": 1}}}
        }
      },
      {
        "properties": {
          "authority": {"properties": {"kind": {"const": "servicePrincipal"}}},
          "authorityDescriptor": {"properties": {"sessionGeneration": {"const": 0}}}
        }
      }
    ]
))]
pub struct AuthSessionResponse {
    // @ref LLP 0058#exact-response-dto — protocol v1 is a closed must-
    // understand value; the schema pins `const: 1` because a different
    // integer is a different protocol, not an additive change.
    #[schemars(extend("const" = 1))]
    pub protocol_version: u64,
    #[schemars(length(min = 1))]
    pub server_startup_nonce: String,
    #[schemars(pattern(crate::ids::ID_WIRE_PATTERN))]
    pub authorization_stream_incarnation: String,
    #[schemars(range(min = 0, max = 9007199254740991_u64))]
    pub transition_generation: u64,
    pub active_mode: AuthMode,
    pub desired_mode: AuthMode,
    pub mode_state: AuthModeStateWire,
    pub app_data_availability: AppDataAvailabilityWire,
    /// Always present: null means "not quarantined", never omission.
    pub quarantine_code: Option<String>,
    pub client_protocols: ClientProtocols,
    pub availability: AuthSessionAvailability,
    pub provider: AuthSessionProvider,
    // @ref LLP 0058#exact-response-dto — bearer is the only v1 transport;
    // another entry is a protocol revision, not an additive capability.
    #[schemars(extend("items" = {"const": "bearer"}, "minItems" = 1, "maxItems" = 1))]
    pub transports: Vec<String>,
    pub authority: AuthSessionAuthority,
    /// Consistency only: possession never authorizes an invocation.
    pub authority_descriptor: AuthSessionAuthorityDescriptor,
    /// Server-proven artifact identity. Sessions mode requires a non-null
    /// value; legacy dev databases may not yet have one.
    pub deployment_identity: Option<DeploymentIdentity>,
    /// Exact lease capability facts appear only when this binary's full
    /// issuance/store/service implementation is ready. A client offer alone
    /// can never manufacture support. Always present: null means "not
    /// supported", never omission.
    pub authorized_lease: Option<AuthorizedLeaseFacts>,
}

#[derive(Clone, Debug)]
pub struct AuthSessionFacts {
    pub server_startup_nonce: String,
    pub authorization_stream_incarnation: String,
    pub transition_generation: u64,
    pub active_mode: AuthMode,
    pub desired_mode: AuthMode,
    pub mode_state: AuthModeStateWire,
    pub app_data_availability: AppDataAvailabilityWire,
    pub quarantine_code: Option<String>,
    pub readiness: AuthProgramReadiness,
    pub provider_key: String,
    pub provider_ready: bool,
    pub authority: AuthSessionAuthority,
    pub authority_descriptor: AuthorityDescriptor,
    pub deployment_identity: Option<DeploymentIdentity>,
    pub authorized_lease_config: AuthorizedLeaseConfig,
}

impl AuthSessionResponse {
    pub fn from_facts(facts: AuthSessionFacts, offers: AuthClientProtocolOffers) -> Self {
        let protocols = offers.echoed();
        let availability = availability(&facts, protocols);
        let provider_available = facts.active_mode == AuthMode::Sessions
            && facts.desired_mode == AuthMode::Sessions
            && facts.mode_state == AuthModeStateWire::Settled
            && facts.app_data_availability == AppDataAvailabilityWire::Available
            && facts.provider_ready;
        Self {
            protocol_version: AUTH_PROTOCOL_V1,
            server_startup_nonce: facts.server_startup_nonce,
            authorization_stream_incarnation: facts.authorization_stream_incarnation,
            transition_generation: facts.transition_generation,
            active_mode: facts.active_mode,
            desired_mode: facts.desired_mode,
            mode_state: facts.mode_state,
            app_data_availability: facts.app_data_availability,
            quarantine_code: facts.quarantine_code,
            client_protocols: protocols,
            availability,
            provider: AuthSessionProvider {
                key: facts.provider_key,
                available: provider_available,
            },
            transports: vec!["bearer".to_owned()],
            authority: facts.authority,
            authority_descriptor: facts.authority_descriptor.into(),
            deployment_identity: facts.deployment_identity,
            authorized_lease: facts
                .readiness
                .authorized_lease
                .then(|| AuthorizedLeaseFacts::from(facts.authorized_lease_config)),
        }
    }
}

fn availability(facts: &AuthSessionFacts, protocols: ClientProtocols) -> AuthSessionAvailability {
    let settled = facts.active_mode == facts.desired_mode
        && facts.mode_state == AuthModeStateWire::Settled
        && facts.app_data_availability == AppDataAvailabilityWire::Available;
    if !settled {
        return unavailable_matrix("SNAPBACK_AUTH_MODE_PENDING", false);
    }
    if facts.active_mode == AuthMode::Dev {
        return AuthSessionAvailability {
            online_request_response: available(),
            auth_scoped_live: AuthScopedLiveAvailability {
                available: true,
                minimum_auth_invalidation_protocol: None,
                reason: None,
            },
            retained_reads: RetainedReadAvailability {
                available: true,
                minimum_auth_invalidation_protocol: None,
                minimum_authorized_lease_protocol: None,
                reason: None,
            },
            queued_replay: QueuedReplayAvailability {
                available: true,
                minimum_authority_descriptor_protocol: None,
                reason: None,
            },
        };
    }

    let online_ready =
        facts.readiness.session_activation_ready && protocols.auth_client == Some(AUTH_PROTOCOL_V1);
    let online = if online_ready {
        available()
    } else {
        unavailable("SNAPBACK_AUTH_POLICY_UNAVAILABLE")
    };
    let live_reason = if !online_ready {
        Some("SNAPBACK_AUTH_POLICY_UNAVAILABLE")
    } else if !facts.readiness.authorization_invalidation {
        Some("SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE")
    } else if protocols.auth_invalidation != Some(AUTH_PROTOCOL_V1) {
        Some("SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED")
    } else {
        None
    };
    let queued_reason = if !online_ready
        || !facts.readiness.authority_descriptor
        || protocols.authority_descriptor != Some(AUTH_PROTOCOL_V1)
    {
        Some("SNAPBACK_AUTH_POLICY_UNAVAILABLE")
    } else {
        None
    };
    let retained_reason = if !online_ready
        || !facts.readiness.authorization_invalidation
        || !facts.readiness.authorized_lease
    {
        Some("SNAPBACK_AUTH_POLICY_UNAVAILABLE")
    } else if protocols.auth_invalidation != Some(AUTH_PROTOCOL_V1) {
        Some("SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED")
    } else if protocols.authorized_lease != Some(AUTH_PROTOCOL_V1) {
        Some("SNAPBACK_AUTH_POLICY_UNAVAILABLE")
    } else {
        None
    };
    AuthSessionAvailability {
        online_request_response: online,
        auth_scoped_live: AuthScopedLiveAvailability {
            available: live_reason.is_none(),
            minimum_auth_invalidation_protocol: Some(AUTH_PROTOCOL_V1),
            reason: live_reason.map(str::to_owned),
        },
        retained_reads: RetainedReadAvailability {
            available: retained_reason.is_none(),
            minimum_auth_invalidation_protocol: Some(AUTH_PROTOCOL_V1),
            minimum_authorized_lease_protocol: Some(AUTH_PROTOCOL_V1),
            reason: retained_reason.map(str::to_owned),
        },
        queued_replay: QueuedReplayAvailability {
            available: queued_reason.is_none(),
            minimum_authority_descriptor_protocol: Some(AUTH_PROTOCOL_V1),
            reason: queued_reason.map(str::to_owned),
        },
    }
}

fn available() -> OnlineAvailability {
    OnlineAvailability {
        available: true,
        reason: None,
    }
}

fn unavailable(reason: &str) -> OnlineAvailability {
    OnlineAvailability {
        available: false,
        reason: Some(reason.to_owned()),
    }
}

fn unavailable_matrix(reason: &str, session_minima: bool) -> AuthSessionAvailability {
    let minimum = session_minima.then_some(AUTH_PROTOCOL_V1);
    AuthSessionAvailability {
        online_request_response: unavailable(reason),
        auth_scoped_live: AuthScopedLiveAvailability {
            available: false,
            minimum_auth_invalidation_protocol: minimum,
            reason: Some(reason.to_owned()),
        },
        retained_reads: RetainedReadAvailability {
            available: false,
            minimum_auth_invalidation_protocol: minimum,
            minimum_authorized_lease_protocol: minimum,
            reason: Some(reason.to_owned()),
        },
        queued_replay: QueuedReplayAvailability {
            available: false,
            minimum_authority_descriptor_protocol: minimum,
            reason: Some(reason.to_owned()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn facts(mode: AuthMode, readiness: AuthProgramReadiness) -> AuthSessionFacts {
        AuthSessionFacts {
            server_startup_nonce: "startup-1".to_owned(),
            authorization_stream_incarnation: "01890f3c-9d5b-7000-8000-000000000001".to_owned(),
            transition_generation: 7,
            active_mode: mode,
            desired_mode: mode,
            mode_state: AuthModeStateWire::Settled,
            app_data_availability: AppDataAvailabilityWire::Available,
            quarantine_code: None,
            readiness,
            provider_key: "email-code".to_owned(),
            provider_ready: true,
            authority: AuthSessionAuthority::anonymous(),
            authority_descriptor: AuthorityDescriptor {
                descriptor_version: 1,
                authority_instance_id: "018f0d90-7b24-7a22-8c33-445566778899".to_owned(),
                session_generation: 0,
            },
            deployment_identity: Some(DeploymentIdentity {
                schema_version: mode.artifact_version().to_owned(),
                auth_mode: mode,
                app_id: "handshake-test".to_owned(),
                schema_hash: "sha256:schema".to_owned(),
                bundle_hash: "sha256:bundle".to_owned(),
                inputs_hash: "sha256:inputs".to_owned(),
            }),
            authorized_lease_config: AuthorizedLeaseConfig::default(),
        }
    }

    #[test]
    fn protocol_offers_echo_only_exact_single_decimal_v1_values() {
        let mut headers = HeaderMap::new();
        headers.insert(AUTH_CLIENT_PROTOCOL_HEADER, HeaderValue::from_static("1"));
        headers.insert(
            AUTH_INVALIDATION_PROTOCOL_HEADER,
            HeaderValue::from_static("2"),
        );
        headers.insert(
            AUTHORITY_DESCRIPTOR_PROTOCOL_HEADER,
            HeaderValue::from_static("not-an-integer"),
        );
        headers.append(
            AUTHORIZED_LEASE_PROTOCOL_HEADER,
            HeaderValue::from_static("1"),
        );
        headers.append(
            AUTHORIZED_LEASE_PROTOCOL_HEADER,
            HeaderValue::from_static("1"),
        );
        let offers = AuthClientProtocolOffers::from_headers(&headers);
        assert_eq!(offers.auth_client, Some(1));
        assert_eq!(offers.auth_invalidation, Some(2));
        assert_eq!(offers.authority_descriptor, None);
        assert_eq!(offers.authorized_lease, None);
        assert_eq!(
            offers.echoed(),
            ClientProtocols {
                auth_client: Some(1),
                auth_invalidation: None,
                authority_descriptor: None,
                authorized_lease: None,
            }
        );
    }

    #[test]
    fn websocket_subprotocols_carry_exact_protocol_offers_without_custom_headers() {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::SEC_WEBSOCKET_PROTOCOL,
            HeaderValue::from_static(
                "snapback.v1, snapback.auth-client.1, snapback.auth-invalidation.1, \
                 snapback.authority-descriptor.1, snapback.authorized-lease.1",
            ),
        );
        assert_eq!(
            AuthClientProtocolOffers::from_headers(&headers),
            AuthClientProtocolOffers {
                auth_client: Some(1),
                auth_invalidation: Some(1),
                authority_descriptor: Some(1),
                authorized_lease: Some(1),
            }
        );
        assert_eq!(
            AuthClientProtocolOffers::from_http_headers(&headers),
            AuthClientProtocolOffers::default(),
            "ordinary HTTP bootstrap cannot negotiate through WebSocket tokens"
        );

        headers.insert(AUTH_CLIENT_PROTOCOL_HEADER, HeaderValue::from_static("bad"));
        assert_eq!(
            AuthClientProtocolOffers::from_headers(&headers).auth_client,
            None,
            "a malformed custom header cannot fall through to the WebSocket carrier"
        );
    }

    #[test]
    fn item4_cannot_advertise_session_online_availability() {
        let response = AuthSessionResponse::from_facts(
            facts(AuthMode::Sessions, AuthProgramReadiness::item4(true)),
            AuthClientProtocolOffers {
                auth_client: Some(1),
                ..Default::default()
            },
        );
        assert!(!response.availability.online_request_response.available);
        assert_eq!(
            response
                .availability
                .online_request_response
                .reason
                .as_deref(),
            Some("SNAPBACK_AUTH_POLICY_UNAVAILABLE")
        );
        assert!(!response.provider.available || response.provider.key == "email-code");
    }

    #[test]
    fn pending_mode_refuses_every_surface_even_with_all_later_facts() {
        let mut pending = facts(
            AuthMode::Sessions,
            AuthProgramReadiness::new(true, true, true, true, true, true, true),
        );
        pending.desired_mode = AuthMode::Dev;
        pending.mode_state = AuthModeStateWire::PendingRestart;
        pending.app_data_availability = AppDataAvailabilityWire::RefusedPending;
        let response = AuthSessionResponse::from_facts(
            pending,
            AuthClientProtocolOffers {
                auth_client: Some(1),
                auth_invalidation: Some(1),
                authority_descriptor: Some(1),
                authorized_lease: Some(1),
            },
        );
        assert_eq!(
            serde_json::to_value(&response).unwrap()["availability"],
            serde_json::json!({
                "onlineRequestResponse": { "available": false, "reason": "SNAPBACK_AUTH_MODE_PENDING" },
                "authScopedLive": { "available": false, "minimumAuthInvalidationProtocol": null, "reason": "SNAPBACK_AUTH_MODE_PENDING" },
                "retainedReads": { "available": false, "minimumAuthInvalidationProtocol": null, "minimumAuthorizedLeaseProtocol": null, "reason": "SNAPBACK_AUTH_MODE_PENDING" },
                "queuedReplay": { "available": false, "minimumAuthorityDescriptorProtocol": null, "reason": "SNAPBACK_AUTH_MODE_PENDING" }
            })
        );
    }

    #[test]
    fn later_items_unlock_only_their_owned_surfaces() {
        let offers = AuthClientProtocolOffers {
            auth_client: Some(1),
            auth_invalidation: Some(1),
            authority_descriptor: Some(1),
            authorized_lease: Some(1),
        };
        let item5 = AuthSessionResponse::from_facts(
            facts(
                AuthMode::Sessions,
                AuthProgramReadiness::new(true, true, true, true, false, false, false),
            ),
            offers,
        );
        assert!(item5.availability.online_request_response.available);
        assert!(!item5.availability.auth_scoped_live.available);
        assert!(!item5.availability.queued_replay.available);
        assert!(!item5.availability.retained_reads.available);

        let item6 = AuthSessionResponse::from_facts(
            facts(
                AuthMode::Sessions,
                AuthProgramReadiness::new(true, true, true, true, true, false, false),
            ),
            offers,
        );
        assert!(item6.availability.auth_scoped_live.available);
        assert!(!item6.availability.queued_replay.available);
        assert!(!item6.availability.retained_reads.available);

        let item7 = AuthSessionResponse::from_facts(
            facts(
                AuthMode::Sessions,
                AuthProgramReadiness::new(true, true, true, true, true, true, false),
            ),
            offers,
        );
        assert!(item7.availability.queued_replay.available);
        assert!(!item7.availability.retained_reads.available);

        let item8 = AuthSessionResponse::from_facts(
            facts(
                AuthMode::Sessions,
                AuthProgramReadiness::new(true, true, true, true, true, true, true),
            ),
            offers,
        );
        assert!(item8.availability.retained_reads.available);
    }
}
