//! Closed bootstrap-handshake wire types and availability computation.
//!
//! The handshake is discovery, not authentication: every protected request
//! repeats its protocol offer and resolves its own credential. Keeping the
//! computation pure lets HTTP, tests, and the client sentinel share one exact
//! matrix without turning a previous handshake into server-side state.

use axum::http::HeaderMap;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub use crate::auth::mode::{
    AppDataAvailability as AppDataAvailabilityWire, AuthModeStatus as AuthModeStateWire,
    AuthProgramReadiness,
};
use crate::manifest::AuthMode;

pub const AUTH_CLIENT_PROTOCOL_HEADER: &str = "x-snapback-auth-client-protocol";
pub const AUTH_INVALIDATION_PROTOCOL_HEADER: &str = "x-snapback-auth-invalidation-protocol";
pub const AUTHORITY_DESCRIPTOR_PROTOCOL_HEADER: &str = "x-snapback-authority-descriptor-protocol";
pub const AUTHORIZED_LEASE_PROTOCOL_HEADER: &str = "x-snapback-authorized-lease-protocol";
pub const AUTH_PROTOCOL_V1: u64 = 1;

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
    pub fn from_headers(headers: &HeaderMap) -> Self {
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthSessionAuthority {
    pub user_id: Option<String>,
    pub session_id: Option<String>,
    pub is_authenticated: bool,
}

impl AuthSessionAuthority {
    pub fn anonymous() -> Self {
        Self {
            user_id: None,
            session_id: None,
            is_authenticated: false,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthSessionProvider {
    pub key: String,
    pub available: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientProtocols {
    pub auth_client: Option<u64>,
    pub auth_invalidation: Option<u64>,
    pub authority_descriptor: Option<u64>,
    pub authorized_lease: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OnlineAvailability {
    pub available: bool,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthScopedLiveAvailability {
    pub available: bool,
    pub minimum_auth_invalidation_protocol: Option<u64>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetainedReadAvailability {
    pub available: bool,
    pub minimum_auth_invalidation_protocol: Option<u64>,
    pub minimum_authorized_lease_protocol: Option<u64>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueuedReplayAvailability {
    pub available: bool,
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
pub struct AuthSessionResponse {
    pub protocol_version: u64,
    pub server_startup_nonce: String,
    pub authorization_stream_incarnation: String,
    pub transition_generation: u64,
    pub active_mode: AuthMode,
    pub desired_mode: AuthMode,
    pub mode_state: AuthModeStateWire,
    pub app_data_availability: AppDataAvailabilityWire,
    pub quarantine_code: Option<String>,
    pub client_protocols: ClientProtocols,
    pub availability: AuthSessionAvailability,
    pub provider: AuthSessionProvider,
    pub transports: Vec<String>,
    pub authority: AuthSessionAuthority,
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
    let queued_reason = if !online_ready || !facts.readiness.authority_descriptor {
        Some("SNAPBACK_AUTH_POLICY_UNAVAILABLE")
    } else if protocols.authority_descriptor != Some(AUTH_PROTOCOL_V1) {
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
