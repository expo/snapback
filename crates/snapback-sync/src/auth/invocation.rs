//! Server-owned invocation authority.
//!
//! Wire authority, resolved authority, and the handler-visible projection are
//! deliberately different types. Runtime entry points consume a
//! [`PreparedInvocation`]; application code never receives a wire credential
//! or an operator bypass as identity.

// @ref LLP 0058#shared-invocation-authority — one closed gate separates wire authority, resolved authority, and the immutable handler projection.

use crate::auth::admission::{AdmissionController, AdmissionEffectGuard, AdmissionLease};
use crate::auth::descriptor::canonical_uuid_v7;
use crate::auth::identity_core::AuthClaimsProjection;
use crate::auth::service_authority_contract::ServiceAuthorityDisposition;
use crate::auth::service_fence::ServiceAuthorityDeadlineTerminal;
use crate::auth::service_fence::{
    RetainedServiceAuthorityGuard, ServiceAuthorityActResolution,
    ServiceAuthorityExternalEffectPermit, ServiceAuthorityPublication, ServiceAuthorityWorkPermit,
    ServiceAuthorityWorkReservationError,
};
use crate::auth::session_projection::{
    FencedAuthorityWorkPermit, FencedAuthorityWorkReservationError, FencedPublication,
    TerminalAuthorityDisposition,
};
use crate::contract_types::ServerProfile;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{
    AuthInput, AuthMode, AuthRequirement, FunctionDefinition, FunctionKind, HandlerInput,
};
use crate::storage::AuthorityCallerAttributionBasis;
use crate::storage::auth_agent_credentials::ResolvedScopedToken;
use crate::storage::auth_asset_callbacks::{
    ASSET_CALLBACKS_SERVICE_NAME, AssetCallbacksServicePrincipal,
};
use crate::storage::auth_grants::ExactGrantScope;
use crate::storage::pending_effects::{PendingEffectAuthority, PendingEffectRecord};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
pub use snapback_types::auth::invocation::FunctionAttribution;
use snapback_types::telemetry_contract::CallerAttributionV1;
use std::collections::BTreeMap;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

fn rehearsal_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(9_007_199_254_740_991_u128) as u64
}

fn session_retired_error(disposition: TerminalAuthorityDisposition) -> SnapbackError {
    let disposition = match disposition {
        TerminalAuthorityDisposition::Carrier => "carrier",
        TerminalAuthorityDisposition::DurableDelete => "durableDelete",
    };
    SnapbackError::error(
        "SNAPBACK_AUTH_SESSION_EXPIRED",
        "auth",
        "authentication session is expired or revoked",
    )
    .with_details(serde_json::json!({ "authorityDisposition": disposition }))
}

fn authorization_stream_retired_error() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_STREAM_RESET",
        "auth",
        "the authorization stream is no longer current",
    )
    .with_details(serde_json::json!({
        "authorityDisposition": "carrier",
        "retryable": true,
        "cause": "stream_replaced",
    }))
}

fn caller_attribution_invalid(message: &'static str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_INVOCATION_AUTHORITY_INVALID", "auth", message)
}

/// Presence of one authority-bearing wire location.
///
/// This is intentionally not `Option<Value>`: explicit null is forbidden in
/// sessions just as a non-null legacy authority value is.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum WireFieldPresence {
    #[default]
    Absent,
    PresentNull,
    PresentValue,
}

impl WireFieldPresence {
    fn from_value(value: Option<&Value>) -> Self {
        match value {
            None => Self::Absent,
            Some(Value::Null) => Self::PresentNull,
            Some(_) => Self::PresentValue,
        }
    }

    pub fn is_present(self) -> bool {
        !matches!(self, Self::Absent)
    }
}

/// Closed registry of legacy authority-bearing wire locations.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum WireAuthorityLocation {
    HandlerAuth,
    HandlerAuthPrincipal,
    HandlerAuthSessionId,
    HandlerAuthUserId,
    CtxLedgerAuthFingerprint,
    LiveOwnerAuth,
    LiveOwnerPrincipal,
    LiveOwnerSessionId,
    LiveOwnerUserId,
    EphemeralAuth,
    EphemeralPrincipal,
    EphemeralSessionId,
    EphemeralUserId,
    EphemeralCustomKey,
}

impl WireAuthorityLocation {
    pub const ALL: [Self; 14] = [
        Self::HandlerAuth,
        Self::HandlerAuthPrincipal,
        Self::HandlerAuthSessionId,
        Self::HandlerAuthUserId,
        Self::CtxLedgerAuthFingerprint,
        Self::LiveOwnerAuth,
        Self::LiveOwnerPrincipal,
        Self::LiveOwnerSessionId,
        Self::LiveOwnerUserId,
        Self::EphemeralAuth,
        Self::EphemeralPrincipal,
        Self::EphemeralSessionId,
        Self::EphemeralUserId,
        Self::EphemeralCustomKey,
    ];

    pub const fn wire_name(self) -> &'static str {
        match self {
            Self::HandlerAuth => "auth",
            Self::HandlerAuthPrincipal => "auth.principal",
            Self::HandlerAuthSessionId => "auth.session_id",
            Self::HandlerAuthUserId => "auth.user_id",
            Self::CtxLedgerAuthFingerprint => "ctx_ledger.auth_fingerprint",
            Self::LiveOwnerAuth => "live.auth",
            Self::LiveOwnerPrincipal => "live.principal",
            Self::LiveOwnerSessionId => "live.session_id",
            Self::LiveOwnerUserId => "live.user_id",
            Self::EphemeralAuth => "ephemeral.auth",
            Self::EphemeralPrincipal => "ephemeral.principal",
            Self::EphemeralSessionId => "ephemeral.session_id",
            Self::EphemeralUserId => "ephemeral.user_id",
            Self::EphemeralCustomKey => "ephemeral.custom_key",
        }
    }
}

/// Ingress-only, untrusted authority presence map.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct WireAuthorityFields {
    fields: BTreeMap<WireAuthorityLocation, WireFieldPresence>,
}

impl WireAuthorityFields {
    pub fn record(&mut self, location: WireAuthorityLocation, presence: WireFieldPresence) {
        if presence.is_present() {
            self.fields.insert(location, presence);
        } else {
            self.fields.remove(&location);
        }
    }

    pub fn presence(&self, location: WireAuthorityLocation) -> WireFieldPresence {
        self.fields.get(&location).copied().unwrap_or_default()
    }

    pub fn first_present(&self) -> Option<WireAuthorityLocation> {
        WireAuthorityLocation::ALL
            .into_iter()
            .find(|location| self.presence(*location).is_present())
    }

    /// Inspect the typed handler-input wrapper before serde defaults erase
    /// presence. `args` is deliberately never traversed.
    pub fn inspect_handler(value: &Value) -> Self {
        let mut fields = Self::default();
        let Some(object) = value.as_object() else {
            return fields;
        };
        fields.record_auth_object(
            object.get("auth"),
            WireAuthorityLocation::HandlerAuth,
            WireAuthorityLocation::HandlerAuthPrincipal,
            WireAuthorityLocation::HandlerAuthSessionId,
            WireAuthorityLocation::HandlerAuthUserId,
        );
        fields.record(
            WireAuthorityLocation::CtxLedgerAuthFingerprint,
            WireFieldPresence::from_value(
                object
                    .get("ctx_ledger")
                    .or_else(|| object.get("ctxLedger"))
                    .and_then(Value::as_object)
                    .and_then(|ledger| {
                        ledger
                            .get("auth_fingerprint")
                            .or_else(|| ledger.get("authFingerprint"))
                    }),
            ),
        );
        fields
    }

    /// Inspect the owner fields on a durable live operation. Initial
    /// subscribe passes its nested `input` object; resume/unsubscribe pass the
    /// operation root. Ordinary query arguments are never traversed.
    pub fn inspect_live_owner(value: &Value) -> Self {
        let mut fields = Self::default();
        let Some(object) = value.as_object() else {
            return fields;
        };
        fields.record_auth_object(
            object.get("auth"),
            WireAuthorityLocation::LiveOwnerAuth,
            WireAuthorityLocation::LiveOwnerPrincipal,
            WireAuthorityLocation::LiveOwnerSessionId,
            WireAuthorityLocation::LiveOwnerUserId,
        );
        fields.record(
            WireAuthorityLocation::CtxLedgerAuthFingerprint,
            WireFieldPresence::from_value(
                object
                    .get("ctx_ledger")
                    .or_else(|| object.get("ctxLedger"))
                    .and_then(Value::as_object)
                    .and_then(|ledger| {
                        ledger
                            .get("auth_fingerprint")
                            .or_else(|| ledger.get("authFingerprint"))
                    }),
            ),
        );
        fields
    }

    /// Inspect every legacy authority sibling accepted by the dev ephemeral
    /// DTO family. Presence, including explicit null, is forbidden in
    /// sessions before typed deserialization can erase or ignore it.
    pub fn inspect_ephemeral(value: &Value) -> Self {
        let mut fields = Self::default();
        let Some(object) = value.as_object() else {
            return fields;
        };
        fields.record_auth_object(
            object.get("auth"),
            WireAuthorityLocation::EphemeralAuth,
            WireAuthorityLocation::EphemeralPrincipal,
            WireAuthorityLocation::EphemeralSessionId,
            WireAuthorityLocation::EphemeralUserId,
        );
        fields.record_if_present(
            WireAuthorityLocation::EphemeralPrincipal,
            WireFieldPresence::from_value(object.get("principal")),
        );
        fields.record_if_present(
            WireAuthorityLocation::EphemeralSessionId,
            WireFieldPresence::from_value(
                object.get("session_id").or_else(|| object.get("sessionId")),
            ),
        );
        fields.record_if_present(
            WireAuthorityLocation::EphemeralUserId,
            WireFieldPresence::from_value(object.get("user_id").or_else(|| object.get("userId"))),
        );
        fields.record_if_present(
            WireAuthorityLocation::EphemeralCustomKey,
            WireFieldPresence::from_value(
                object.get("custom_key").or_else(|| object.get("customKey")),
            ),
        );
        fields
    }

    fn record_if_present(&mut self, location: WireAuthorityLocation, presence: WireFieldPresence) {
        if presence.is_present() {
            self.record(location, presence);
        }
    }

    fn record_auth_object(
        &mut self,
        auth: Option<&Value>,
        root: WireAuthorityLocation,
        principal: WireAuthorityLocation,
        session_id: WireAuthorityLocation,
        user_id: WireAuthorityLocation,
    ) {
        self.record(root, WireFieldPresence::from_value(auth));
        if let Some(auth) = auth.and_then(Value::as_object) {
            self.record(
                principal,
                WireFieldPresence::from_value(auth.get("principal")),
            );
            self.record(
                session_id,
                WireFieldPresence::from_value(
                    auth.get("session_id").or_else(|| auth.get("sessionId")),
                ),
            );
            self.record(
                user_id,
                WireFieldPresence::from_value(auth.get("user_id").or_else(|| auth.get("userId"))),
            );
        }
    }
}

/// Authority resolved by a server-owned carrier. This value never crosses the
/// handler or wire boundary.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ResolvedAppAuthority {
    Anonymous,
    Session(ResolvedSessionAuthority),
    /// Credential-free durable-watch authority. The worker reconstructs this
    /// only after loading the protected watch record and revalidating the
    /// current human principal. It deliberately has no session id, provider
    /// assertion, bearer, or expiry copied from watch creation.
    ///
    /// @ref LLP 0055#dated-amendment-llp-0204-integration-registrations-and-watch-anchors-2026-08-08 —
    /// user-owned watches use `revalidatePrincipal`, never a retained session.
    RevalidatedPrincipal(ResolvedRevalidatedPrincipalAuthority),
    DevImpersonation {
        user_id: String,
        roles: Vec<String>,
        local_dev_only: bool,
    },
    /// One server-resolved scoped-token authority. The grant scopes remain
    /// server-only and are consumed by `prepare_function`; the handler sees
    /// only the sealed projection below.
    ///
    /// @ref LLP 0055#resolved-authority-serviceprincipal — carrier identity is
    ///   distinct from effective identity, and delegated authority projects
    ///   the effective user while retaining an attributable actor.
    ServicePrincipal(ResolvedServicePrincipalAuthority),
    AdminBypass {
        reason: String,
    },
    System,
}

/// Immutable result of one projection-owned bearer resolution. Its private
/// fields are the lifetime boundary: callers may inspect a derived subject,
/// but cannot construct or retarget it from copied catalog facts.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedSessionAuthority {
    user_id: String,
    session_id: String,
    provider: String,
    generation: u64,
    authority_instance_id: String,
    session_not_after_ms: u64,
    provider_not_after_ms: Option<u64>,
    rehearsal_provenance: Option<crate::auth::rehearsal::AuthRehearsalProvenanceV1>,
    admission_origin: crate::auth::admission::AdmissionLeaseOrigin,
}

impl ResolvedSessionAuthority {
    pub fn user_id(&self) -> &str {
        &self.user_id
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn provider(&self) -> &str {
        &self.provider
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn authority_instance_id(&self) -> &str {
        &self.authority_instance_id
    }

    pub fn session_not_after_ms(&self) -> u64 {
        self.session_not_after_ms
    }

    pub fn provider_not_after_ms(&self) -> Option<u64> {
        self.provider_not_after_ms
    }

    pub fn rehearsal_provenance(
        &self,
    ) -> Option<&crate::auth::rehearsal::AuthRehearsalProvenanceV1> {
        self.rehearsal_provenance.as_ref()
    }
}

/// Immutable result of one serving-database scoped-token resolution.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedServicePrincipalAuthority {
    actor_user_id: String,
    credential_id: String,
    credential_generation: u64,
    grant_id: String,
    token_id: String,
    effective_user_id: Option<String>,
    scopes: Vec<ResolvedGrantScope>,
    token_expires_at_ms: u64,
    integration_status: Option<crate::storage::auth_integrations::IntegrationStatus>,
    admission_origin: crate::auth::admission::AdmissionLeaseOrigin,
}

impl ResolvedServicePrincipalAuthority {
    pub fn actor_user_id(&self) -> &str {
        &self.actor_user_id
    }

    pub fn credential_id(&self) -> &str {
        &self.credential_id
    }

    pub fn credential_generation(&self) -> u64 {
        self.credential_generation
    }

    pub fn grant_id(&self) -> &str {
        &self.grant_id
    }

    pub fn token_id(&self) -> &str {
        &self.token_id
    }

    pub fn effective_user_id(&self) -> Option<&str> {
        self.effective_user_id.as_deref()
    }

    pub fn scopes(&self) -> &[ResolvedGrantScope] {
        &self.scopes
    }

    pub fn token_expires_at_ms(&self) -> u64 {
        self.token_expires_at_ms
    }

    pub fn integration_status(
        &self,
    ) -> Option<crate::storage::auth_integrations::IntegrationStatus> {
        self.integration_status
    }
}

/// Immutable result of protected watch-principal revalidation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedRevalidatedPrincipalAuthority {
    user_id: String,
    authority_instance_id: String,
    admission_origin: crate::auth::admission::AdmissionLeaseOrigin,
}

impl ResolvedRevalidatedPrincipalAuthority {
    pub fn user_id(&self) -> &str {
        &self.user_id
    }

    pub fn authority_instance_id(&self) -> &str {
        &self.authority_instance_id
    }
}

#[cfg(test)]
pub(crate) fn test_revalidated_authority(
    user_id: impl Into<String>,
    authority_instance_id: impl Into<String>,
) -> ResolvedAppAuthority {
    ResolvedAppAuthority::RevalidatedPrincipal(ResolvedRevalidatedPrincipalAuthority {
        user_id: user_id.into(),
        authority_instance_id: authority_instance_id.into(),
        admission_origin: test_admission_controller(AuthMode::Sessions, 0)
            .expect("test admission controller")
            .lease_origin(),
    })
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(crate) fn test_session_authority(
    user_id: impl Into<String>,
    session_id: impl Into<String>,
    provider: impl Into<String>,
    generation: u64,
    authority_instance_id: impl Into<String>,
    session_not_after_ms: u64,
    provider_not_after_ms: Option<u64>,
    rehearsal_provenance: Option<crate::auth::rehearsal::AuthRehearsalProvenanceV1>,
) -> ResolvedAppAuthority {
    test_session_authority_with_origin(
        user_id,
        session_id,
        provider,
        generation,
        authority_instance_id,
        session_not_after_ms,
        provider_not_after_ms,
        rehearsal_provenance,
        test_admission_controller(AuthMode::Sessions, 0)
            .expect("test admission controller")
            .lease_origin(),
    )
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
fn test_session_authority_with_origin(
    user_id: impl Into<String>,
    session_id: impl Into<String>,
    provider: impl Into<String>,
    generation: u64,
    authority_instance_id: impl Into<String>,
    session_not_after_ms: u64,
    provider_not_after_ms: Option<u64>,
    rehearsal_provenance: Option<crate::auth::rehearsal::AuthRehearsalProvenanceV1>,
    admission_origin: crate::auth::admission::AdmissionLeaseOrigin,
) -> ResolvedAppAuthority {
    ResolvedAppAuthority::resolved_session(
        user_id.into(),
        session_id.into(),
        provider.into(),
        generation,
        authority_instance_id.into(),
        session_not_after_ms,
        provider_not_after_ms,
        rehearsal_provenance,
        admission_origin,
    )
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(crate) fn test_service_authority(
    actor_user_id: impl Into<String>,
    credential_id: impl Into<String>,
    credential_generation: u64,
    grant_id: impl Into<String>,
    token_id: impl Into<String>,
    effective_user_id: Option<String>,
    scopes: Vec<ResolvedGrantScope>,
    token_expires_at_ms: u64,
    integration_status: Option<crate::storage::auth_integrations::IntegrationStatus>,
) -> ResolvedAppAuthority {
    ResolvedAppAuthority::resolved_service_principal(
        actor_user_id.into(),
        credential_id.into(),
        credential_generation,
        grant_id.into(),
        token_id.into(),
        effective_user_id,
        scopes,
        token_expires_at_ms,
        integration_status,
        test_admission_controller(AuthMode::Sessions, 0)
            .expect("test admission controller")
            .lease_origin(),
    )
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedGrantScope {
    function_id: String,
    kind: FunctionKind,
    basis: u64,
    authority_creating: bool,
}

impl ResolvedGrantScope {
    pub fn from_exact(scope: ExactGrantScope) -> Self {
        Self {
            function_id: scope.function_id,
            kind: scope.kind.into_function_kind(),
            basis: scope.basis,
            authority_creating: scope.authority_creating,
        }
    }

    pub fn function_id(&self) -> &str {
        &self.function_id
    }

    pub fn kind(&self) -> &FunctionKind {
        &self.kind
    }

    pub fn basis(&self) -> u64 {
        self.basis
    }

    pub fn authority_creating(&self) -> bool {
        self.authority_creating
    }
}

impl ResolvedAppAuthority {
    pub fn session_id(&self) -> Option<&str> {
        match self {
            Self::Session(subject) => Some(subject.session_id()),
            _ => None,
        }
    }

    pub fn has_ask_consent_scope(&self) -> bool {
        matches!(self, Self::Session(_))
            || matches!(
                self,
                Self::ServicePrincipal(subject)
                    if subject.scopes().iter().any(|scope| {
                        scope.function_id()
                            == crate::storage::auth_scope_bases::ASK_SCOPE_ID
                            && matches!(scope.kind(), FunctionKind::Query)
                    })
            )
    }

    pub fn has_granted_read_scope(&self) -> bool {
        matches!(self, Self::Session(_))
            || matches!(
                self,
                Self::ServicePrincipal(subject)
                    if subject.scopes().iter().any(|scope| {
                        scope.function_id()
                            != crate::storage::auth_scope_bases::ASK_SCOPE_ID
                            && matches!(scope.kind(), FunctionKind::Query | FunctionKind::LiveQuery)
                    })
            )
    }

    /// The one derivation of the LLP 0055 §Audit attribution block. Only a
    /// resolved service principal has authority to attribute; every other
    /// class answers `None` and the wire omits the member entirely.
    pub(crate) fn function_attribution(&self) -> Option<FunctionAttribution> {
        match self {
            Self::ServicePrincipal(subject) => Some(FunctionAttribution {
                actor_user_id: subject.actor_user_id().to_owned(),
                effective_user_id: subject.effective_user_id().map(str::to_owned),
                grant_id: subject.grant_id().to_owned(),
                dry_run: false,
            }),
            _ => None,
        }
    }

    /// Project a kernel-resolved scoped token into the admission graph that
    /// owns its engine. Neither input is constructible from identity strings.
    fn from_scoped_token(
        token: ResolvedScopedToken,
        admission_origin: crate::auth::admission::AdmissionLeaseOrigin,
    ) -> Self {
        Self::resolved_service_principal(
            token.actor_user_id().to_owned(),
            token.credential_id().to_owned(),
            token.credential_generation(),
            token.grant_id().to_owned(),
            token.token_id().to_owned(),
            token.effective_user_id().map(str::to_owned),
            token
                .scopes()
                .iter()
                .cloned()
                .map(ResolvedGrantScope::from_exact)
                .collect(),
            token.expires_at_ms(),
            token.integration_status(),
            admission_origin,
        )
    }

    /// Construct a session authority only from the projection resolver's
    /// opaque output, preserving the exact verifier/controller graph.
    pub(super) fn from_projected_session(
        authority: crate::auth::session_projection::ProjectedSessionAuthority,
        admission_origin: crate::auth::admission::AdmissionLeaseOrigin,
    ) -> Self {
        Self::resolved_session(
            authority.user_id().to_owned(),
            authority.session_id().to_owned(),
            authority.provider().to_owned(),
            authority.generation(),
            authority.authority_instance_id().to_owned(),
            authority
                .expires_at_ms()
                .min(authority.absolute_expires_at_ms()),
            None,
            authority.rehearsal_provenance().cloned(),
            admission_origin,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn resolved_session(
        user_id: String,
        session_id: String,
        provider: String,
        generation: u64,
        authority_instance_id: String,
        session_not_after_ms: u64,
        provider_not_after_ms: Option<u64>,
        rehearsal_provenance: Option<crate::auth::rehearsal::AuthRehearsalProvenanceV1>,
        admission_origin: crate::auth::admission::AdmissionLeaseOrigin,
    ) -> Self {
        Self::Session(ResolvedSessionAuthority {
            user_id,
            session_id,
            provider,
            generation,
            authority_instance_id,
            session_not_after_ms,
            provider_not_after_ms,
            rehearsal_provenance,
            admission_origin,
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn resolved_service_principal(
        actor_user_id: String,
        credential_id: String,
        credential_generation: u64,
        grant_id: String,
        token_id: String,
        effective_user_id: Option<String>,
        scopes: Vec<ResolvedGrantScope>,
        token_expires_at_ms: u64,
        integration_status: Option<crate::storage::auth_integrations::IntegrationStatus>,
        admission_origin: crate::auth::admission::AdmissionLeaseOrigin,
    ) -> Self {
        Self::ServicePrincipal(ResolvedServicePrincipalAuthority {
            actor_user_id,
            credential_id,
            credential_generation,
            grant_id,
            token_id,
            effective_user_id,
            scopes,
            token_expires_at_ms,
            integration_status,
            admission_origin,
        })
    }

    pub fn dev_from_auth(input: &AuthInput) -> Self {
        input
            .user_id
            .as_ref()
            .map_or(Self::Anonymous, |user_id| Self::DevImpersonation {
                user_id: user_id.clone(),
                roles: Vec::new(),
                local_dev_only: true,
            })
    }

    pub fn carries_user(&self) -> bool {
        matches!(
            self,
            Self::Session(_)
                | Self::RevalidatedPrincipal(_)
                | Self::DevImpersonation { .. }
                | Self::ServicePrincipal(_)
        )
    }

    /// Stable, bearer-free identity for durable invalidation retry ownership.
    /// Length prefixes make the representation injective without depending on
    /// a caller-controlled JSON/debug rendering.
    pub fn invalidation_subject(&self) -> String {
        match self {
            Self::Anonymous => "anonymous".to_owned(),
            Self::Session(subject) => format!(
                "session:{}:{}:{generation}",
                subject.authority_instance_id().len(),
                subject.authority_instance_id(),
                generation = subject.generation(),
            ),
            Self::RevalidatedPrincipal(subject) => format!(
                "watch-principal:{}:{}:{}:{}",
                subject.user_id().len(),
                subject.user_id(),
                subject.authority_instance_id().len(),
                subject.authority_instance_id()
            ),
            Self::DevImpersonation { user_id, .. } => {
                format!("dev:{}:{user_id}", user_id.len())
            }
            Self::ServicePrincipal(subject) => format!(
                "service-principal:{}:{}:{}:{}:{}:{}:{credential_generation}",
                subject.actor_user_id().len(),
                subject.actor_user_id(),
                subject.credential_id().len(),
                subject.credential_id(),
                subject.grant_id().len(),
                subject.grant_id(),
                credential_generation = subject.credential_generation(),
            ),
            Self::AdminBypass { .. } => "admin-bypass".to_owned(),
            Self::System => "system".to_owned(),
        }
    }

    pub fn key(&self) -> AuthorityKey {
        match self {
            Self::Anonymous => AuthorityKey::Anonymous,
            Self::Session(subject) => AuthorityKey::Session {
                user_id: subject.user_id().to_owned(),
                session_id: subject.session_id().to_owned(),
                generation: subject.generation(),
            },
            Self::RevalidatedPrincipal(subject) => AuthorityKey::RevalidatedPrincipal {
                user_id: subject.user_id().to_owned(),
                authority_instance_id: subject.authority_instance_id().to_owned(),
            },
            Self::DevImpersonation { user_id, .. } => AuthorityKey::DevImpersonation {
                user_id: user_id.clone(),
            },
            Self::ServicePrincipal(subject) => AuthorityKey::ServicePrincipal {
                actor_user_id: subject.actor_user_id().to_owned(),
                credential_id: subject.credential_id().to_owned(),
                credential_generation: subject.credential_generation(),
                grant_id: subject.grant_id().to_owned(),
            },
            Self::AdminBypass { .. } => AuthorityKey::AdminBypass,
            Self::System => AuthorityKey::System,
        }
    }

    fn legacy_input(&self) -> AuthInput {
        match self {
            Self::Session(subject) => AuthInput {
                principal: None,
                session_id: Some(subject.session_id().to_owned()),
                user_id: Some(subject.user_id().to_owned()),
                ..AuthInput::default()
            }
            .with_authorization_projection(Some("human"), None, false)
            .with_activity_provenance(Some(subject.user_id()), Some("human"), None),
            Self::RevalidatedPrincipal(subject) => AuthInput {
                principal: None,
                session_id: None,
                user_id: Some(subject.user_id().to_owned()),
                ..AuthInput::default()
            }
            .with_authorization_projection(Some("human"), None, false)
            .with_activity_provenance(Some(subject.user_id()), Some("human"), None),
            Self::DevImpersonation { user_id, .. } => AuthInput {
                principal: None,
                session_id: None,
                user_id: Some(user_id.clone()),
                ..AuthInput::default()
            }
            .with_authorization_projection(Some("human"), None, false),
            Self::ServicePrincipal(subject) => AuthInput {
                principal: None,
                session_id: None,
                user_id: Some(
                    subject
                        .effective_user_id()
                        .unwrap_or(subject.actor_user_id())
                        .to_owned(),
                ),
                ..AuthInput::default()
            }
            .with_authorization_projection(
                Some(if subject.effective_user_id().is_some() {
                    "human"
                } else {
                    "agent"
                }),
                subject.effective_user_id().map(|_| "agent"),
                subject.effective_user_id().is_some(),
            )
            .with_activity_provenance(
                subject.effective_user_id().map(|_| subject.actor_user_id()),
                subject.effective_user_id().map(|_| "agent"),
                subject.effective_user_id().map(|_| subject.grant_id()),
            ),
            Self::Anonymous | Self::AdminBypass { .. } | Self::System => AuthInput::default(),
        }
    }
}

/// Exact database-bound service resolution paired with the publication
/// registered from that same durable carrier. There is no parts constructor:
/// callers can inspect the derived authority but preparation consumes this
/// coherent value and installs its publication internally.
#[derive(Clone, Debug)]
pub struct ResolvedServiceAuthority {
    database_binding: crate::storage::DatabaseBinding,
    resolved: ResolvedAppAuthority,
    publication: ServiceAuthorityPublication,
    scoped_token: Option<std::sync::Arc<crate::auth::crypto::ScopedToken>>,
}

impl ResolvedServiceAuthority {
    pub fn from_registered(
        registered: crate::auth::service_fence::RegisteredServiceAuthority,
        admission_origin: crate::auth::admission::AdmissionLeaseOrigin,
    ) -> Self {
        let (database_binding, resolved, publication) = registered.into_parts();
        Self {
            database_binding,
            resolved: ResolvedAppAuthority::from_scoped_token(resolved, admission_origin),
            publication,
            scoped_token: None,
        }
    }

    pub fn from_registered_with_token(
        registered: crate::auth::service_fence::RegisteredServiceAuthority,
        admission_origin: crate::auth::admission::AdmissionLeaseOrigin,
        token: std::sync::Arc<crate::auth::crypto::ScopedToken>,
    ) -> Self {
        let mut authority = Self::from_registered(registered, admission_origin);
        authority.scoped_token = Some(token);
        authority
    }

    pub fn resolved(&self) -> &ResolvedAppAuthority {
        &self.resolved
    }

    pub fn publication(&self) -> &ServiceAuthorityPublication {
        &self.publication
    }

    #[allow(clippy::too_many_arguments)]
    pub fn prepare(
        self,
        expected_database: &crate::storage::DatabaseBinding,
        source: InvocationSource,
        active_mode: AuthMode,
        profile: ServerProfile,
        admission: AdmissionLease,
        wire: &WireAuthorityFields,
        stream_publication: Option<FencedPublication>,
    ) -> SnapbackResult<PreparedAuthority> {
        if &self.database_binding != expected_database {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "the durable service authority belongs to another database",
            ));
        }
        let authority = InvocationGate::prepare_admitted_authority(
            source,
            active_mode,
            profile,
            admission,
            wire,
            self.resolved,
            None,
        )?
        .with_service_publication(self.publication);
        let authority = match self.scoped_token {
            Some(token) => authority.with_pending_effect_scoped_token(token),
            None => authority,
        };
        Ok(match stream_publication {
            Some(publication) => authority.with_fenced_publication(publication),
            None => authority,
        })
    }
}

pub(crate) trait MembershipWriterResolvedExt {
    fn from_resolved(resolved: &ResolvedAppAuthority) -> Self;
    fn from_resolved_with_authority_creating(
        resolved: &ResolvedAppAuthority,
        authority_creating_consent: bool,
    ) -> Self;
}

impl MembershipWriterResolvedExt for crate::storage::MembershipWriter {
    fn from_resolved(resolved: &ResolvedAppAuthority) -> Self {
        <Self as MembershipWriterResolvedExt>::from_resolved_with_authority_creating(
            resolved, false,
        )
    }

    fn from_resolved_with_authority_creating(
        resolved: &ResolvedAppAuthority,
        authority_creating_consent: bool,
    ) -> Self {
        use crate::storage::ResolvedMembershipWriter as Kernel;
        let kernel = match resolved {
            ResolvedAppAuthority::Session(subject) => Kernel::User {
                user_id: subject.user_id().to_owned(),
            },
            ResolvedAppAuthority::RevalidatedPrincipal(subject) => Kernel::User {
                user_id: subject.user_id().to_owned(),
            },
            ResolvedAppAuthority::DevImpersonation { user_id, .. } => Kernel::User {
                user_id: user_id.clone(),
            },
            ResolvedAppAuthority::ServicePrincipal(subject) => Kernel::ServicePrincipal {
                actor_user_id: subject.actor_user_id().to_owned(),
                effective_user_id: subject.effective_user_id().map(str::to_owned),
                grant_id: subject.grant_id().to_owned(),
            },
            ResolvedAppAuthority::System => Kernel::System,
            ResolvedAppAuthority::AdminBypass { .. } => Kernel::AdminBypass,
            ResolvedAppAuthority::Anonymous => Kernel::Anonymous,
        };
        crate::storage::MembershipWriter::from_resolved_with_authority_creating(
            &kernel,
            authority_creating_consent,
        )
    }
}

/// Stable, bearer-free equality key for authority-owned state.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum AuthorityKey {
    Anonymous,
    Session {
        user_id: String,
        session_id: String,
        generation: u64,
    },
    RevalidatedPrincipal {
        user_id: String,
        authority_instance_id: String,
    },
    DevImpersonation {
        user_id: String,
    },
    ServicePrincipal {
        actor_user_id: String,
        credential_id: String,
        credential_generation: u64,
        grant_id: String,
    },
    AdminBypass,
    System,
}

/// Exact handler-visible authority payload. It intentionally cannot be
/// deserialized. The JS harness copies these known serialized keys into a
/// null-prototype, deeply frozen object before evaluating application code.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandlerAuthProjection {
    user_id: Option<String>,
    session_id: Option<String>,
    is_authenticated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    roles: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    actor: Option<HandlerAuthActorProjection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    actor_kind: Option<String>,
    /// Server-catalog projection for a real session. No wire or non-session
    /// authority can populate this member.
    ///
    /// @ref LLP 0214#6-read-only-ctxauth-claims — verified claims are
    /// installed only after session resolution and copied into the frozen JS
    /// projection.
    #[serde(skip_serializing_if = "Option::is_none")]
    claims: Option<AuthClaimsProjection>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct HandlerAuthActorProjection {
    user_id: String,
    kind: String,
    grant_id: String,
}
/// The sealed direct baseline used by host-mediated authorization for a
/// delegated invocation. Authentication-shape fields are intentionally
/// impossible here: authorization may not distinguish a user's real session
/// from the same user's delegated baseline.
///
/// @ref LLP 0055#resolved-authority-serviceprincipal — delegated authority is
/// intersected with this exact effective-user projection, which excludes
/// sessionId, provider, and every actor dimension.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectAuthorizationProjection {
    user_id: String,
    is_authenticated: bool,
    roles: Vec<String>,
    kind: String,
}

impl DirectAuthorizationProjection {
    fn for_effective_user(user_id: &str) -> Self {
        Self {
            user_id: user_id.to_owned(),
            is_authenticated: true,
            roles: Vec::new(),
            kind: "human".to_owned(),
        }
    }
}

impl HandlerAuthProjection {
    pub fn from_authority(
        authority: &ResolvedAppAuthority,
        session_claims: Option<AuthClaimsProjection>,
    ) -> SnapbackResult<Self> {
        if matches!(authority, ResolvedAppAuthority::Session(_)) != session_claims.is_some() {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_CLAIMS_AUTHORITY_INVALID",
                "auth",
                if session_claims.is_some() {
                    "verified claims require resolved session authority"
                } else {
                    "resolved session authority requires its server-catalog claims projection"
                },
            ));
        }
        Ok(match authority {
            ResolvedAppAuthority::Session(subject) => Self {
                user_id: Some(subject.user_id().to_owned()),
                session_id: Some(subject.session_id().to_owned()),
                is_authenticated: true,
                provider: Some(subject.provider().to_owned()),
                roles: Some(Vec::new()),
                kind: Some("human".to_owned()),
                actor: None,
                actor_kind: None,
                claims: session_claims,
            },
            ResolvedAppAuthority::RevalidatedPrincipal(subject) => Self {
                user_id: Some(subject.user_id().to_owned()),
                session_id: None,
                is_authenticated: true,
                provider: Some("snapback-watch".to_owned()),
                roles: Some(Vec::new()),
                kind: Some("human".to_owned()),
                actor: None,
                actor_kind: None,
                claims: None,
            },
            ResolvedAppAuthority::DevImpersonation { user_id, roles, .. } => Self {
                user_id: Some(user_id.clone()),
                session_id: None,
                is_authenticated: true,
                provider: None,
                roles: Some(roles.clone()),
                kind: Some("human".to_owned()),
                actor: None,
                actor_kind: None,
                claims: None,
            },
            ResolvedAppAuthority::ServicePrincipal(subject) => Self {
                user_id: Some(
                    subject
                        .effective_user_id()
                        .unwrap_or(subject.actor_user_id())
                        .to_owned(),
                ),
                session_id: None,
                is_authenticated: true,
                provider: Some("agent-credential".to_owned()),
                roles: Some(Vec::new()),
                kind: Some(if subject.effective_user_id().is_some() {
                    "human".to_owned()
                } else {
                    "agent".to_owned()
                }),
                actor: subject
                    .effective_user_id()
                    .map(|_| HandlerAuthActorProjection {
                        user_id: subject.actor_user_id().to_owned(),
                        kind: "agent".to_owned(),
                        grant_id: subject.grant_id().to_owned(),
                    }),
                actor_kind: None,
                claims: None,
            },
            ResolvedAppAuthority::Anonymous
            | ResolvedAppAuthority::AdminBypass { .. }
            | ResolvedAppAuthority::System => Self {
                user_id: None,
                session_id: None,
                is_authenticated: false,
                provider: None,
                roles: None,
                kind: None,
                actor: None,
                actor_kind: None,
                claims: None,
            },
        })
    }

    /// Exact handler projection for the bearer-free callback service. The
    /// ordinary autonomous-agent projection would say `agent-credential`,
    /// which is false here, and would not identify the actor class. Keep the
    /// sealed value honest and explicitly distinguishable from sessions.
    ///
    /// @ref LLP 0039#dated-amendment-sessions-asset-callback-execution-authority-2026-08-03
    ///   — `ctx.auth.actorKind` names the service principal; no interactive
    ///   session projection is counterfeited.
    fn for_asset_callbacks(principal: &AssetCallbacksServicePrincipal) -> Self {
        Self::for_asset_callbacks_actor(principal.actor_user_id())
    }

    fn for_asset_callbacks_actor(actor_user_id: &str) -> Self {
        Self {
            user_id: Some(actor_user_id.to_owned()),
            session_id: None,
            is_authenticated: true,
            provider: Some("snapback-service-principal".to_owned()),
            roles: Some(Vec::new()),
            kind: Some("agent".to_owned()),
            actor: None,
            actor_kind: Some(ASSET_CALLBACKS_SERVICE_NAME.to_owned()),
            claims: None,
        }
    }

    pub fn user_id(&self) -> Option<&str> {
        self.user_id.as_deref()
    }

    pub fn session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    pub fn is_authenticated(&self) -> bool {
        self.is_authenticated
    }

    pub fn roles(&self) -> &[String] {
        self.roles.as_deref().unwrap_or(&[])
    }
}

/// Every authority entry is registered here. The target classification is an
/// exhaustive match: there is no nullable function id or catch-all source.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InvocationSource {
    BootstrapHandshake,
    AuthRefresh,
    AuthLogout,
    PushTokenRegistry,
    AgentGrantManagement,
    HttpQuery,
    HttpMutation,
    HttpAction,
    /// The outer authority for one bounded `/api/v1/run` program. The
    /// program is not an app function; any injected-client calls prepare
    /// their own ordinary finite invocation sources.
    HttpRun,
    /// Outer authority for the read-only near-data AI loop. Nested query
    /// calls inherit the caller and re-enter ordinary query preparation.
    HttpAsk,
    /// Streamable-HTTP MCP multiplexes every finite function kind behind one
    /// registered route; the tool dispatcher still enters the same per-kind
    /// finite invocation handlers as `/api/v1/*`.
    HttpMcp,
    /// One v1 capability-link invocation. The bearer adds arguments,
    /// attribution, and budget treatment to an anonymous invocation; it never
    /// supplies an actor principal or new function authority.
    HttpCapabilityLink,
    /// Session-only capability-link mint/revoke management. This is an
    /// authority-only scoped-grant operation, never a function runner.
    CapabilityLinkManagement,
    /// Session-only inbox, approve, and deny operations for durable effects.
    EffectManagement,
    /// The ordinary mutation/action path after one approved intent has been
    /// revalidated. This source suppresses recursive approval creation only.
    EffectExecution,
    /// Session-only lifecycle management for durable watches.
    WatchManagement,
    /// One credential-free standing query evaluation after principal and
    /// function-basis revalidation.
    WatchEvaluation,
    /// One exact declared reaction dispatch after an admitted false-to-true
    /// edge. Query, mutation, and action reactions share this source.
    WatchReaction,
    LocalQuery,
    LocalMutation,
    LocalAction,
    /// Bearer-free lifecycle work. Dev mode uses the existing owner
    /// impersonation; sessions mode uses the per-app `asset-callbacks`
    /// service principal.
    AssetCallback,
    DirectAdminRunner,
    /// Registered operator administration. The transport adapter may mint
    /// this authority only after the route registry has admitted the exact
    /// AdminRead/AdminWrite operation; it is never selected by application
    /// input or an open-ended host operation.
    OperatorCommand,
    HostOperationFunctionRun,
    HostOperationMutationDryRun,
    /// Registered AdminWrite product command for canonical protected-record
    /// erasure and checkpoint-copy obligation custody.
    ProtectedRecordErasure,
    /// Registered AdminWrite product command that explicitly publishes the
    /// exact local envelope-writer coverage cut.
    OperationCoverageActivation,
    /// A real handler executing against a server-custodied in-app branch.
    /// The only admitted authority is the server-constructed branch principal;
    /// neither an admin bypass nor body-supplied authority is compatible.
    BranchOperation,
    /// One owner-triggered config probe. Composition proves access to this
    /// source separately; the handler itself always receives anonymous,
    /// powerless authority plus the exact config grant staged by the engine.
    ///
    /// @ref LLP 0285#2-author-rulings-incorporated-2026-08-19 — ruling 6
    ///   removes System authority without changing the empty handler projection.
    ConfigVerify,
    Cron,
    NestedMutation,
    LiveInitialQuery,
    LiveRerun,
    /// `/client-mutations/acknowledge`: settling durable queued-replay
    /// receipts. Deliberately descriptor-bound (LLP 0059 item 7).
    MutationSettlementAcknowledgement,
    /// `/live/authorization-invalidation/acknowledge` and `/manual-retry`:
    /// discharging live invalidation obligations. Owned by the invalidation
    /// program (LLP 0059 item 6), independent of the descriptor plane.
    InvalidationAcknowledgement,
    /// `/assets/attempts/{id}` and `/assets/tus/{id}`: upload-attempt
    /// inspection, cancellation, and TUS transfer (LLP 0044 §Upload
    /// sessions). Authority-only — the intent authorizer ran at attempt
    /// creation; possession of an attempt URL is never authority.
    AssetTransfer,
    ConnectionOpen,
    ConnectionClose,
    EphemeralRegister,
    EphemeralPublish,
    EphemeralDelete,
    EphemeralSubscribe,
    EphemeralUnsubscribe,
    LiveResume,
    LiveUnsubscribe,
    LiveSupersede,
    LiveStream,
    OutboxDrain,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InvocationTarget {
    Function(FunctionKindConstraint),
    AuthorityOnly,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FunctionKindConstraint {
    Query,
    Mutation,
    Action,
    Any,
}

impl InvocationSource {
    pub const ALL: [Self; 49] = [
        Self::BootstrapHandshake,
        Self::AuthRefresh,
        Self::AuthLogout,
        Self::PushTokenRegistry,
        Self::AgentGrantManagement,
        Self::HttpQuery,
        Self::HttpMutation,
        Self::HttpAction,
        Self::HttpRun,
        Self::HttpAsk,
        Self::HttpMcp,
        Self::HttpCapabilityLink,
        Self::CapabilityLinkManagement,
        Self::EffectManagement,
        Self::EffectExecution,
        Self::WatchManagement,
        Self::WatchEvaluation,
        Self::WatchReaction,
        Self::LocalQuery,
        Self::LocalMutation,
        Self::LocalAction,
        Self::AssetCallback,
        Self::DirectAdminRunner,
        Self::OperatorCommand,
        Self::HostOperationFunctionRun,
        Self::HostOperationMutationDryRun,
        Self::ProtectedRecordErasure,
        Self::OperationCoverageActivation,
        Self::BranchOperation,
        Self::ConfigVerify,
        Self::Cron,
        Self::NestedMutation,
        Self::LiveInitialQuery,
        Self::LiveRerun,
        Self::MutationSettlementAcknowledgement,
        Self::InvalidationAcknowledgement,
        Self::AssetTransfer,
        Self::ConnectionOpen,
        Self::ConnectionClose,
        Self::EphemeralRegister,
        Self::EphemeralPublish,
        Self::EphemeralDelete,
        Self::EphemeralSubscribe,
        Self::EphemeralUnsubscribe,
        Self::LiveResume,
        Self::LiveUnsubscribe,
        Self::LiveSupersede,
        Self::LiveStream,
        Self::OutboxDrain,
    ];

    pub const fn target(self) -> InvocationTarget {
        match self {
            Self::HttpQuery
            | Self::LocalQuery
            | Self::LiveInitialQuery
            | Self::LiveRerun
            | Self::WatchEvaluation => InvocationTarget::Function(FunctionKindConstraint::Query),
            Self::HttpMutation
            | Self::LocalMutation
            | Self::AssetCallback
            | Self::HostOperationMutationDryRun
            | Self::NestedMutation => InvocationTarget::Function(FunctionKindConstraint::Mutation),
            Self::HttpAction | Self::LocalAction | Self::ConfigVerify | Self::Cron => {
                InvocationTarget::Function(FunctionKindConstraint::Action)
            }
            Self::HttpMcp
            | Self::HttpCapabilityLink
            | Self::DirectAdminRunner
            | Self::HostOperationFunctionRun
            | Self::BranchOperation
            | Self::WatchReaction => InvocationTarget::Function(FunctionKindConstraint::Any),
            Self::EffectExecution => InvocationTarget::Function(FunctionKindConstraint::Any),
            Self::BootstrapHandshake
            | Self::AuthRefresh
            | Self::AuthLogout
            | Self::PushTokenRegistry
            | Self::AgentGrantManagement
            | Self::HttpRun
            | Self::HttpAsk
            | Self::CapabilityLinkManagement
            | Self::EffectManagement
            | Self::WatchManagement
            | Self::OperatorCommand
            | Self::ProtectedRecordErasure
            | Self::OperationCoverageActivation
            | Self::MutationSettlementAcknowledgement
            | Self::InvalidationAcknowledgement
            | Self::AssetTransfer
            | Self::ConnectionOpen
            | Self::ConnectionClose
            | Self::EphemeralRegister
            | Self::EphemeralPublish
            | Self::EphemeralDelete
            | Self::EphemeralSubscribe
            | Self::EphemeralUnsubscribe
            | Self::LiveResume
            | Self::LiveUnsubscribe
            | Self::LiveSupersede
            | Self::LiveStream
            | Self::OutboxDrain => InvocationTarget::AuthorityOnly,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AuthorityAuditFact {
    Anonymous,
    Session,
    RevalidatedPrincipal,
    ServicePrincipal,
    DevBodyAuthority,
    DirectRunnerBodyUser,
    HostOperationImpersonation,
    BranchPrincipal,
    AdminBypass,
    System,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OperationAvailability {
    Available,
}

/// Host-owned provenance for the root function that established an invocation
/// ancestry. Nested handlers may change function kind, but cannot replace this
/// fact and turn an action/background root into caller elevation.
///
/// @ref LLP 0231#d7--handler-reads-are-scoped-unless-the-call-site-is-explicitly-elevated —
///   call-local elevation is fenced transitively by trusted root provenance.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ElevationRootProvenance {
    /// Authority preparation precedes function selection. Inheriting a nested
    /// function before this state is bound fails closed.
    Unbound,
    /// A direct caller-backed named query/mutation established the ancestry.
    CallerBackedNamedRead,
    /// An action, scheduled/background source, or unsupported root established
    /// the ancestry. This state is permanent for descendants.
    Fenced,
}

/// Immutable result of mode, policy, wire-field, and credential preparation.
#[derive(Clone, Debug)]
pub struct PreparedAuthority {
    admission: AdmissionLease,
    active_mode: AuthMode,
    profile: ServerProfile,
    source: InvocationSource,
    elevation_root_provenance: ElevationRootProvenance,
    resolved: ResolvedAppAuthority,
    projection: HandlerAuthProjection,
    direct_authorization: Option<DirectAuthorizationProjection>,
    audit: AuthorityAuditFact,
    availability: OperationAvailability,
    /// Item-5 leaf handles for the final externally-observable publication
    /// cut. Dev-only/local preparations may omit this; every projection- or
    /// connection-resolved sessions-mode request installs it.
    publication: Option<FencedPublication>,
    /// Exact finite scoped-token fence. Unlike the authorization-stream fence,
    /// this carrier also applies to the diagnostic `/auth/session` projection.
    service_publication: Option<ServiceAuthorityPublication>,
    authorization_stream_incarnation: Option<String>,
    /// Server-derived, non-authoritative telemetry attribution for a
    /// classified invocation. Ordinary app calls use the closed first-party
    /// lane; this fact never participates in authorization.
    caller_attribution: Option<CallerAttributionV1>,
    /// The internal callback service has durable principal/grant authority
    /// but deliberately no credential/token carrier. Presence selects its
    /// exact protected-catalog revalidation path; it is never inferred from
    /// ids or names.
    asset_callbacks_service: Option<AssetCallbacksServicePrincipal>,
    rehearsal_provenance: Option<crate::auth::rehearsal::AuthRehearsalProvenanceV1>,
    rehearsal_fence: Option<crate::auth::rehearsal::RehearsalAuthorityFence>,
    pending_effect_session_bearer: Option<std::sync::Arc<crate::auth::crypto::SessionBearer>>,
    pending_effect_scoped_token: Option<std::sync::Arc<crate::auth::crypto::ScopedToken>>,
}

/// Opaque authority root for pending-effect approver attribution. The retained
/// management authority, rather than an independently supplied principal id,
/// is revalidated when telemetry is attached to the effect execution.
///
/// @ref LLP 0303#a-derivation-is-only-as-strong-as-its-root — a derived
/// approver remains as strong as the exact effect-management authority from
/// which it was derived.
#[derive(Clone)]
pub struct PreparedEffectApproverAttribution {
    authority: PreparedAuthority,
}

impl std::fmt::Debug for PreparedEffectApproverAttribution {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("PreparedEffectApproverAttribution(..)")
    }
}

impl PreparedEffectApproverAttribution {
    fn validated_subject(&self) -> SnapbackResult<&ResolvedSessionAuthority> {
        self.authority
            .validate_admission("pending-effect approver attribution")?;
        if self.authority.source != InvocationSource::EffectManagement
            || self.authority.active_mode != AuthMode::Sessions
        {
            return Err(caller_attribution_invalid(
                "pending-effect approver attribution requires effect-management session authority",
            ));
        }
        let ResolvedAppAuthority::Session(subject) = &self.authority.resolved else {
            return Err(caller_attribution_invalid(
                "pending-effect approver attribution requires effect-management session authority",
            ));
        };
        Ok(subject)
    }

    /// The principal derived from the retained approving authority. Exposing
    /// this value lets storage select the intended row, but does not let a
    /// caller construct or retarget this carrier.
    pub fn principal_id(&self) -> &str {
        let ResolvedAppAuthority::Session(subject) = &self.authority.resolved else {
            unreachable!("sealed effect-approver carrier retains session authority")
        };
        subject.user_id()
    }
}

/// Explicit stream/session reservation for an authority-sensitive durable
/// effect. Dev authority is represented by its own closed variant; absence of
/// a session publication is never interpreted as an implicit mode-only bypass.
enum AuthorizedPublicationReservation {
    Fenced { _permit: FencedAuthorityWorkPermit },
    DevMode,
}

/// Owned, lock-free authority permits reserved before entering managed Local.
/// The only constructor validates stream/session first and optional finite
/// service authority second. Callers carry this value into a synchronous
/// write and acquire its commit guard only at the final transaction cut.
#[must_use = "authorized-effect reservations must be retained through the durable commit"]
pub struct AuthorizedEffectReservation {
    authority: PreparedAuthority,
    _publication: AuthorizedPublicationReservation,
    service: Option<ServiceAuthorityWorkPermit>,
    #[cfg(any(test, feature = "test-support"))]
    before_commit_guard_for_test:
        std::sync::Mutex<Option<Box<dyn FnOnce(&'static str) + Send + 'static>>>,
    #[cfg(any(test, feature = "test-support"))]
    commit_guard_failure_for_test: std::sync::Mutex<Option<SnapbackError>>,
    #[cfg(any(test, feature = "test-support"))]
    test_identity: u64,
    #[cfg(any(test, feature = "test-support"))]
    scope_probe_for_test: std::sync::Mutex<Option<AuthorizedEffectScopeProbeForTest>>,
}

#[cfg(any(test, feature = "test-support"))]
static ACTIVE_AUTHORIZED_EFFECT_RESERVATIONS_FOR_TEST: std::sync::OnceLock<
    std::sync::Mutex<std::collections::BTreeSet<u64>>,
> = std::sync::OnceLock::new();

impl Drop for AuthorizedEffectReservation {
    fn drop(&mut self) {
        #[cfg(any(test, feature = "test-support"))]
        {
            ACTIVE_AUTHORIZED_EFFECT_RESERVATIONS_FOR_TEST
                .get_or_init(|| std::sync::Mutex::new(std::collections::BTreeSet::new()))
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .remove(&self.test_identity);
            if let Some(probe) = self
                .scope_probe_for_test
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .as_ref()
            {
                probe.release();
            }
        }
    }
}

#[cfg(any(test, feature = "test-support"))]
#[doc(hidden)]
pub fn authorized_effect_reservation_active_for_test(identity: u64) -> bool {
    ACTIVE_AUTHORIZED_EFFECT_RESERVATIONS_FOR_TEST
        .get_or_init(|| std::sync::Mutex::new(std::collections::BTreeSet::new()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .contains(&identity)
}

#[cfg(any(test, feature = "test-support"))]
struct ClassifiedAdmissionHookForTest {
    successful_checks_before_hook: usize,
    hook: Box<dyn FnOnce()>,
}

#[cfg(any(test, feature = "test-support"))]
thread_local! {
    static CLASSIFIED_ADMISSION_HOOK_FOR_TEST:
        std::cell::RefCell<Option<ClassifiedAdmissionHookForTest>> = const {
            std::cell::RefCell::new(None)
        };
}

/// Install a one-shot callback after the requested number of successful
/// classified admission checks on this thread. This exposes an epoch change
/// between repeated production checks without weakening their ordinary API.
#[cfg(any(test, feature = "test-support"))]
#[doc(hidden)]
pub fn install_classified_admission_hook_for_test(
    successful_checks_before_hook: usize,
    hook: impl FnOnce() + 'static,
) {
    CLASSIFIED_ADMISSION_HOOK_FOR_TEST.with(|slot| {
        let previous = slot.borrow_mut().replace(ClassifiedAdmissionHookForTest {
            successful_checks_before_hook,
            hook: Box::new(hook),
        });
        assert!(
            previous.is_none(),
            "classified admission hook already installed"
        );
    });
}

#[cfg(any(test, feature = "test-support"))]
fn run_classified_admission_hook_for_test() {
    CLASSIFIED_ADMISSION_HOOK_FOR_TEST.with(|slot| {
        let hook = {
            let mut slot = slot.borrow_mut();
            let Some(installed) = slot.as_mut() else {
                return;
            };
            if installed.successful_checks_before_hook > 0 {
                installed.successful_checks_before_hook -= 1;
                return;
            }
            slot.take().map(|installed| installed.hook)
        };
        if let Some(hook) = hook {
            hook();
        }
    });
}

/// A terminal caller cause is distinct from an operational reservation
/// failure and retains its exact authority/disposition axis for later action
/// calls and final settlement.
#[derive(Clone, Debug)]
pub enum CallerAuthorityTerminalCause {
    AdmissionEpochRetired {
        error: SnapbackError,
    },
    AuthorizationStreamRetired {
        error: SnapbackError,
    },
    SessionRetired {
        disposition: TerminalAuthorityDisposition,
        error: SnapbackError,
    },
    ScopedServiceRetired {
        disposition: ServiceAuthorityDisposition,
        error: SnapbackError,
    },
}

impl CallerAuthorityTerminalCause {
    pub fn error(&self) -> &SnapbackError {
        match self {
            Self::AdmissionEpochRetired { error }
            | Self::AuthorizationStreamRetired { error }
            | Self::SessionRetired { error, .. }
            | Self::ScopedServiceRetired { error, .. } => error,
        }
    }

    pub fn into_error(self) -> SnapbackError {
        match self {
            Self::AdmissionEpochRetired { error }
            | Self::AuthorizationStreamRetired { error }
            | Self::SessionRetired { error, .. }
            | Self::ScopedServiceRetired { error, .. } => error,
        }
    }
}

#[derive(Debug)]
pub enum AuthorizedEffectReservationError {
    Terminal(CallerAuthorityTerminalCause),
    NonTerminal(SnapbackError),
}

impl AuthorizedEffectReservationError {
    pub fn into_error(self) -> SnapbackError {
        match self {
            Self::Terminal(cause) => cause.into_error(),
            Self::NonTerminal(error) => error,
        }
    }
}

/// Test-only observation of one exact reservation and its commit-guard scope.
/// The marker distinguishes a freshly reserved effect from any predecessor,
/// while the active effect identifies the particular durable cut it guards.
/// The standard shipped binary excludes this API; `test-support` is internal
/// verification plumbing and must not be enabled in a published build.
#[cfg(any(test, feature = "test-support"))]
#[doc(hidden)]
#[derive(Clone)]
pub struct AuthorizedEffectScopeProbeForTest {
    marker: String,
    reservation_held: std::sync::Arc<std::sync::atomic::AtomicBool>,
    active_effect: std::sync::Arc<std::sync::Mutex<Option<&'static str>>>,
}

#[cfg(any(test, feature = "test-support"))]
impl AuthorizedEffectScopeProbeForTest {
    #[doc(hidden)]
    pub fn new(marker: impl Into<String>) -> Self {
        Self {
            marker: marker.into(),
            reservation_held: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            active_effect: std::sync::Arc::new(std::sync::Mutex::new(None)),
        }
    }

    #[doc(hidden)]
    pub fn marker(&self) -> &str {
        &self.marker
    }

    #[doc(hidden)]
    pub fn is_reservation_held(&self) -> bool {
        self.reservation_held
            .load(std::sync::atomic::Ordering::Acquire)
    }

    #[doc(hidden)]
    pub fn is_active_for(&self, effect: &'static str) -> bool {
        *self
            .active_effect
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            == Some(effect)
    }

    #[doc(hidden)]
    pub fn is_inactive(&self) -> bool {
        !self.is_reservation_held()
            && self
                .active_effect
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .is_none()
    }

    fn reserve(&self) {
        assert!(
            !self
                .reservation_held
                .swap(true, std::sync::atomic::Ordering::AcqRel),
            "authorized-effect scope probe {} is already reserved",
            self.marker
        );
    }

    fn release(&self) {
        assert!(
            self.reservation_held
                .swap(false, std::sync::atomic::Ordering::AcqRel),
            "authorized-effect scope probe {} was released without a reservation",
            self.marker
        );
    }

    fn enter(&self, effect: &'static str) -> AuthorizedEffectScopeProbeGuardForTest {
        let mut active = self
            .active_effect
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        assert!(
            active.is_none(),
            "authorized-effect scope probe {} is already active",
            self.marker
        );
        *active = Some(effect);
        drop(active);
        AuthorizedEffectScopeProbeGuardForTest {
            probe: self.clone(),
        }
    }
}

#[cfg(any(test, feature = "test-support"))]
struct AuthorizedEffectScopeProbeGuardForTest {
    probe: AuthorizedEffectScopeProbeForTest,
}

#[cfg(any(test, feature = "test-support"))]
impl Drop for AuthorizedEffectScopeProbeGuardForTest {
    fn drop(&mut self) {
        *self
            .probe
            .active_effect
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
    }
}

/// The inner synchronous commit guard for an authorized effect. Field order is
/// release order: mode admission drops before the retained service witness,
/// while the borrowed reservation keeps every authority-work permit alive.
/// No synchronous mutex guard in this value may cross an await.
pub struct AuthorizedEffectCommitGuard<'a> {
    _mode: AdmissionEffectGuard<'a>,
    _service: Option<RetainedServiceAuthorityGuard<'a>>,
    _reservation: &'a AuthorizedEffectReservation,
    #[cfg(any(test, feature = "test-support"))]
    test_reservation_identity: u64,
    #[cfg(any(test, feature = "test-support"))]
    _scope_probe_for_test: Option<AuthorizedEffectScopeProbeGuardForTest>,
}

#[cfg(any(test, feature = "test-support"))]
thread_local! {
    static LIVE_AUTHORIZED_EFFECT_COMMIT_GUARDS_FOR_TEST:
        std::cell::RefCell<std::collections::BTreeMap<u64, usize>> =
        const { std::cell::RefCell::new(std::collections::BTreeMap::new()) };
}

/// Whether this thread owns the commit guard minted from the exact
/// authorized-effect reservation. This observes guard identity only; it is
/// not an authorization API and never consults an authority mutex.
#[cfg(any(test, feature = "test-support"))]
#[doc(hidden)]
pub fn current_thread_holds_authorized_effect_commit_guard_for_test(identity: u64) -> bool {
    LIVE_AUTHORIZED_EFFECT_COMMIT_GUARDS_FOR_TEST.with(|guards| {
        guards
            .borrow()
            .get(&identity)
            .is_some_and(|count| *count > 0)
    })
}

impl Drop for AuthorizedEffectCommitGuard<'_> {
    fn drop(&mut self) {
        #[cfg(any(test, feature = "test-support"))]
        LIVE_AUTHORIZED_EFFECT_COMMIT_GUARDS_FOR_TEST.with(|guards| {
            let mut guards = guards.borrow_mut();
            let count = guards
                .get_mut(&self.test_reservation_identity)
                .expect("authorized-effect commit guard identity remains registered");
            *count -= 1;
            if *count == 0 {
                guards.remove(&self.test_reservation_identity);
            }
        });
    }
}

impl AuthorizedEffectReservation {
    #[cfg(any(test, feature = "test-support"))]
    #[doc(hidden)]
    pub fn identity_for_test(&self) -> u64 {
        self.test_identity
    }

    #[cfg(any(test, feature = "test-support"))]
    #[doc(hidden)]
    pub fn has_service_permit_for_test(&self) -> bool {
        self.service.is_some()
    }

    #[cfg(any(test, feature = "test-support"))]
    #[doc(hidden)]
    pub fn mode_guard_identity_for_test(
        &self,
    ) -> Option<snapback_kernel::storage::AdmissionEffectGuardIdentityForTest> {
        self.authority.admission.effect_guard_identity_for_test()
    }
    /// Install one exact-reservation callback immediately before the mode
    /// commit guard is acquired. This test-only seam can retire the captured
    /// epoch at the historical pre-guard cut without affecting another
    /// concurrent authorized effect.
    #[cfg(any(test, feature = "test-support"))]
    #[doc(hidden)]
    pub fn with_before_commit_guard_for_test(
        self,
        hook: impl FnOnce(&'static str) + Send + 'static,
    ) -> Self {
        *self
            .before_commit_guard_for_test
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(Box::new(hook));
        self
    }

    /// Inject a typed final-guard refusal after staging. This test-only seam
    /// exercises rollback and permit-drain ownership without retiring the
    /// shared admission controller used by a concurrently draining logout.
    #[cfg(any(test, feature = "test-support"))]
    #[doc(hidden)]
    pub fn with_commit_guard_failure_for_test(self, error: SnapbackError) -> Self {
        self.set_commit_guard_failure_for_test(error);
        self
    }

    /// Install the same final-guard refusal after a higher-level owner has
    /// acquired the reservation. This keeps capsule tests from constructing a
    /// permit outside the capsule merely to configure the test seam.
    #[cfg(any(test, feature = "test-support"))]
    #[doc(hidden)]
    pub fn set_commit_guard_failure_for_test(&self, error: SnapbackError) {
        *self
            .commit_guard_failure_for_test
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(error);
    }

    /// Mark every guard acquired from this exact reservation so a transaction
    /// post-COMMIT hook can observe its lifetime without widening production
    /// authority carriers.
    #[cfg(any(test, feature = "test-support"))]
    #[doc(hidden)]
    pub fn with_scope_probe_for_test(self, probe: AuthorizedEffectScopeProbeForTest) -> Self {
        probe.reserve();
        *self
            .scope_probe_for_test
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(probe);
        self
    }

    /// Acquire the independent mode guard last and retain the complete
    /// authority bundle until the returned transaction guard is dropped.
    pub fn commit_guard(
        &self,
        effect: &'static str,
    ) -> SnapbackResult<AuthorizedEffectCommitGuard<'_>> {
        self.commit_guard_classified(effect)
            .map_err(AuthorizedEffectReservationError::into_error)
    }

    pub fn commit_guard_classified(
        &self,
        effect: &'static str,
    ) -> Result<AuthorizedEffectCommitGuard<'_>, AuthorizedEffectReservationError> {
        #[cfg(any(test, feature = "test-support"))]
        if let Some(hook) = self
            .before_commit_guard_for_test
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
        {
            hook(effect);
        }
        #[cfg(any(test, feature = "test-support"))]
        if let Some(error) = self
            .commit_guard_failure_for_test
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
        {
            return Err(AuthorizedEffectReservationError::NonTerminal(error));
        }
        let service = self
            .service
            .as_ref()
            .map(ServiceAuthorityWorkPermit::retain_authority);
        if let Err(error) = self.authority.validate_rehearsal_authority() {
            drop(service);
            return Err(AuthorizedEffectReservationError::NonTerminal(error));
        }
        let mode = match self.authority.admission.effect_guard(effect) {
            Ok(mode) => mode,
            Err(error) => {
                drop(service);
                return Err(AuthorizedEffectReservationError::Terminal(
                    CallerAuthorityTerminalCause::AdmissionEpochRetired { error },
                ));
            }
        };
        #[cfg(any(test, feature = "test-support"))]
        let scope_probe_for_test = {
            LIVE_AUTHORIZED_EFFECT_COMMIT_GUARDS_FOR_TEST.with(|guards| {
                *guards.borrow_mut().entry(self.test_identity).or_default() += 1;
            });
            self.scope_probe_for_test
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .as_ref()
                .map(|probe| probe.enter(effect))
        };
        Ok(AuthorizedEffectCommitGuard {
            _mode: mode,
            _service: service,
            _reservation: self,
            #[cfg(any(test, feature = "test-support"))]
            test_reservation_identity: self.test_identity,
            #[cfg(any(test, feature = "test-support"))]
            _scope_probe_for_test: scope_probe_for_test,
        })
    }
}

/// Process-live rehearsal authority bound to an admitted authorization
/// coordinator. Its registry is intentionally opaque: callers may carry the
/// binding across the engine boundary but cannot mint one or substitute raw
/// live-authority entries at the preparation call.
///
/// ```compile_fail
/// use snapback_sync::auth::invocation::RehearsalAuthorityBinding;
///
/// let _forged = RehearsalAuthorityBinding { registry: todo!() };
/// ```
#[derive(Clone, Debug)]
pub struct RehearsalAuthorityBinding {
    registry: crate::auth::rehearsal::RehearsalLiveAuthorityRegistry,
}

impl RehearsalAuthorityBinding {
    pub(super) fn new(registry: crate::auth::rehearsal::RehearsalLiveAuthorityRegistry) -> Self {
        Self { registry }
    }

    pub fn bind(
        &self,
        mut authority: PreparedAuthority,
        deferred: Option<crate::storage::jobs::DeferredRehearsalAuthority>,
    ) -> SnapbackResult<PreparedAuthority> {
        if let Some(deferred) = deferred.and_then(|authority| authority.into_provenance()) {
            deferred.validate()?;
            authority.rehearsal_provenance = Some(match &authority.rehearsal_provenance {
                Some(current) => current.canonical_union(&deferred)?,
                None => deferred,
            });
        }
        authority.with_rehearsal_authority_registry(self.registry.clone())
    }
}

/// Bearer-free authority retained by a durable live subscription. It carries
/// no admission lease; each rerun must combine it with a fresh short root from
/// the current controller epoch through `prepare_rerun`.
#[derive(Clone, Debug)]
pub struct RetainedLiveAuthority {
    active_mode: AuthMode,
    profile: ServerProfile,
    elevation_root_provenance: ElevationRootProvenance,
    /// Stable bearer-free owner identity. The complete resolved authority is
    /// retained separately for reruns, but mutable deadline facts are not part
    /// of live ownership.
    ///
    /// @ref LLP 0058#live-owner-and-replacement-predicate — resume,
    /// unsubscribe, and supersession compare the resolved authority key plus
    /// the exact connection grant, not the full resolution snapshot.
    owner_key: AuthorityKey,
    resolved: ResolvedAppAuthority,
    /// The sealed producer that can acquire future counted roots for this
    /// exact authority without accepting a lease from an unrelated caller.
    rerun_origin: Option<crate::auth::admission::AdmissionLeaseOrigin>,
    /// Unmanaged authority exists only on compatibility/test lanes. Keep its
    /// original diagnostic root rather than pretending it has a producer.
    unmanaged_rerun_admission: Option<AdmissionLease>,
    /// The one immutable grant entry that authorized this live function.
    /// Carrier validity remains grant-wide, but a sibling entry is not part of
    /// this subscription's authority and cannot terminalize it when its basis
    /// changes.
    matched_grant_scope: Option<ResolvedGrantScope>,
    service_publication: Option<ServiceAuthorityPublication>,
    caller_attribution: Option<CallerAttributionV1>,
    rehearsal_provenance: Option<crate::auth::rehearsal::AuthRehearsalProvenanceV1>,
    rehearsal_fence: Option<crate::auth::rehearsal::RehearsalAuthorityFence>,
}

impl PreparedAuthority {
    pub fn source(&self) -> InvocationSource {
        self.source
    }

    fn bind_elevation_root(&mut self, function_kind: &FunctionKind) {
        if self.elevation_root_provenance != ElevationRootProvenance::Unbound {
            return;
        }
        let direct_caller_source = matches!(
            self.source,
            InvocationSource::HttpQuery
                | InvocationSource::HttpMutation
                | InvocationSource::HttpMcp
                | InvocationSource::HttpCapabilityLink
                | InvocationSource::LocalQuery
                | InvocationSource::LocalMutation
                | InvocationSource::BranchOperation
                | InvocationSource::LiveInitialQuery
        );
        self.elevation_root_provenance = if direct_caller_source
            && matches!(
                function_kind,
                FunctionKind::Query | FunctionKind::LiveQuery | FunctionKind::Mutation
            ) {
            ElevationRootProvenance::CallerBackedNamedRead
        } else {
            ElevationRootProvenance::Fenced
        };
    }

    pub fn elevated_database_allowed(&self) -> bool {
        self.elevation_root_provenance == ElevationRootProvenance::CallerBackedNamedRead
    }

    pub fn transition_generation(&self) -> u64 {
        self.admission.transition_generation()
    }

    pub fn admission_epoch(&self) -> u64 {
        self.admission.admission_epoch()
    }

    pub fn active_mode(&self) -> AuthMode {
        self.active_mode
    }

    pub fn profile(&self) -> ServerProfile {
        self.profile
    }

    pub fn resolved(&self) -> &ResolvedAppAuthority {
        &self.resolved
    }

    #[doc(hidden)]
    pub fn pending_effect_session_bearer(&self) -> Option<&crate::auth::crypto::SessionBearer> {
        self.pending_effect_session_bearer.as_deref()
    }

    #[doc(hidden)]
    pub fn pending_effect_scoped_token(&self) -> Option<&crate::auth::crypto::ScopedToken> {
        self.pending_effect_scoped_token.as_deref()
    }

    pub(crate) fn with_pending_effect_session_bearer(
        mut self,
        bearer: std::sync::Arc<crate::auth::crypto::SessionBearer>,
    ) -> Self {
        self.pending_effect_session_bearer = Some(bearer);
        self
    }

    fn with_pending_effect_scoped_token(
        mut self,
        token: std::sync::Arc<crate::auth::crypto::ScopedToken>,
    ) -> Self {
        self.pending_effect_scoped_token = Some(token);
        self
    }

    pub fn rehearsal_provenance(
        &self,
    ) -> Option<&crate::auth::rehearsal::AuthRehearsalProvenanceV1> {
        self.rehearsal_provenance.as_ref()
    }

    /// Install the process-live governor checker after server composition has
    /// resolved the session projection. Provenance without this host-owned
    /// registry remains fail closed.
    pub(crate) fn with_rehearsal_authority_registry(
        mut self,
        registry: crate::auth::rehearsal::RehearsalLiveAuthorityRegistry,
    ) -> SnapbackResult<Self> {
        if let Some(provenance) = self.rehearsal_provenance.clone() {
            let fence = crate::auth::rehearsal::RehearsalAuthorityFence::new(provenance, registry)?;
            fence.validate_at(rehearsal_now_ms())?;
            self.rehearsal_fence = Some(fence);
        }
        Ok(self)
    }

    /// Rehydrate protected durable provenance onto a clean System runner.
    /// This is the only deferred-work constructor and unions rather than
    /// replacing an existing marker.
    pub fn projection(&self) -> &HandlerAuthProjection {
        &self.projection
    }

    pub fn direct_authorization_projection(&self) -> Option<&DirectAuthorizationProjection> {
        self.direct_authorization.as_ref()
    }

    pub fn function_attribution(&self) -> Option<FunctionAttribution> {
        self.resolved.function_attribution()
    }

    pub fn telemetry_caller_details(&self) -> Option<Value> {
        self.caller_attribution
            .as_ref()
            .map(CallerAttributionV1::details)
    }

    pub fn audit(&self) -> &AuthorityAuditFact {
        &self.audit
    }

    pub fn availability(&self) -> OperationAvailability {
        self.availability
    }

    pub fn admission_lease(&self) -> &AdmissionLease {
        &self.admission
    }

    pub fn canonical_auth_input(&self) -> AuthInput {
        if let Some(principal) = &self.asset_callbacks_service {
            return AuthInput {
                user_id: Some(principal.actor_user_id().to_owned()),
                ..AuthInput::default()
            }
            .with_authorization_projection(Some("agent"), Some(ASSET_CALLBACKS_SERVICE_NAME), false)
            .with_activity_provenance(
                Some(principal.actor_user_id()),
                Some(ASSET_CALLBACKS_SERVICE_NAME),
                Some(principal.grant_id()),
            );
        }
        self.resolved.legacy_input()
    }

    pub fn asset_callbacks_service(&self) -> Option<&AssetCallbacksServicePrincipal> {
        self.asset_callbacks_service.as_ref()
    }

    pub fn with_fenced_publication(mut self, publication: FencedPublication) -> Self {
        self.authorization_stream_incarnation =
            Some(publication.authorization_stream_incarnation().to_owned());
        self.publication = Some(publication);
        self
    }

    /// Whether this prepared caller carries the process-live authorization
    /// publication that an authorized-effect reservation must retain. Some
    /// credential-free internal invocations (including watch reactions) run
    /// in sessions mode without such a carrier and remain mode-fenced only.
    pub fn has_fenced_publication(&self) -> bool {
        self.publication.is_some()
    }

    /// Whether this prepared caller carries a process-live finite-service
    /// publication in addition to, or instead of, a caller publication.
    pub fn has_service_publication(&self) -> bool {
        self.service_publication.is_some()
    }

    /// The exact process-live caller carriers retained by this prepared
    /// authority. Stream-attempt provenance inspects these carriers directly:
    /// resolved authority and active mode alone do not establish that a
    /// transition is caller-backed.
    pub(crate) fn stream_attempt_publication_carriers(
        &self,
    ) -> (
        Option<&FencedPublication>,
        Option<&ServiceAuthorityPublication>,
    ) {
        (self.publication.as_ref(), self.service_publication.as_ref())
    }

    fn with_service_publication(mut self, publication: ServiceAuthorityPublication) -> Self {
        self.service_publication = Some(publication);
        self
    }

    /// Retain the exact effect-management authority that is approving a
    /// pending effect. No subject value is accepted at this boundary.
    ///
    /// @ref LLP 0303#the-governing-principle — the approver is derived from
    /// the authority that actually approves instead of supplied beside it.
    pub fn prepare_effect_approver_attribution(
        &self,
    ) -> SnapbackResult<PreparedEffectApproverAttribution> {
        let prepared = PreparedEffectApproverAttribution {
            authority: self.clone(),
        };
        prepared.validated_subject()?;
        Ok(prepared)
    }

    /// Derive same-principal telemetry directly from this prepared authority.
    /// Cross-principal transport and pending-effect lanes have separate,
    /// provenance-carrying entry points below.
    ///
    /// @ref LLP 0303#the-governing-principle — an authority-derived subject
    /// is not accepted as an independent caller DTO.
    pub fn with_authority_caller_attribution(mut self) -> SnapbackResult<Self> {
        self.validate_admission("caller telemetry attribution")?;
        let attribution = match (&self.source, &self.resolved) {
            (
                InvocationSource::WatchEvaluation | InvocationSource::WatchReaction,
                ResolvedAppAuthority::RevalidatedPrincipal(subject),
            ) => CallerAttributionV1::owner(subject.user_id().to_owned()),
            (
                InvocationSource::WatchEvaluation | InvocationSource::WatchReaction,
                ResolvedAppAuthority::ServicePrincipal(subject),
            ) => CallerAttributionV1::owner(subject.actor_user_id().to_owned()),
            (InvocationSource::WatchEvaluation | InvocationSource::WatchReaction, _) => {
                return Err(caller_attribution_invalid(
                    "watch caller attribution requires its revalidated owner authority",
                ));
            }
            (InvocationSource::EffectExecution, _) => {
                return Err(caller_attribution_invalid(
                    "effect execution caller attribution requires its prepared pending effect",
                ));
            }
            (_, ResolvedAppAuthority::Anonymous) => CallerAttributionV1::anonymous(),
            (_, ResolvedAppAuthority::ServicePrincipal(subject))
                if subject.integration_status().is_some() =>
            {
                return Err(caller_attribution_invalid(
                    "integration caller attribution requires its database-resolved registration",
                ));
            }
            _ => CallerAttributionV1::first_party(),
        };
        self.caller_attribution = Some(attribution);
        Ok(self)
    }

    /// Attach a cross-principal transport caller only from an opaque fact
    /// produced by the same serving database as this admitted authority.
    ///
    /// @ref LLP 0303#corollary--the-artifact-must-carry-provenance-not-just-type —
    /// the database origin and authority class are checked together here.
    pub fn with_external_caller_attribution(
        mut self,
        basis: AuthorityCallerAttributionBasis,
    ) -> SnapbackResult<Self> {
        self.validate_admission("external caller telemetry attribution")?;
        let same_database = self
            .admission
            .origin()
            .is_some_and(|origin| origin.matches_database_binding(basis.database_binding()));
        if !same_database {
            return Err(caller_attribution_invalid(
                "external caller attribution belongs to another engine authority graph",
            ));
        }
        let attribution = match basis.lane() {
            "integration"
                if matches!(
                    &self.resolved,
                    ResolvedAppAuthority::ServicePrincipal(subject)
                        if subject.integration_status().is_some()
                            && basis.principal_user_id() == Some(subject.actor_user_id())
                ) =>
            {
                CallerAttributionV1::integration(basis.caller_key().to_owned())
            }
            "declared"
                if basis.principal_user_id().is_none()
                    && matches!(self.resolved, ResolvedAppAuthority::Anonymous)
                    && matches!(
                        self.source,
                        InvocationSource::HttpQuery
                            | InvocationSource::HttpMutation
                            | InvocationSource::HttpAction
                            | InvocationSource::HttpRun
                            | InvocationSource::HttpAsk
                            | InvocationSource::HttpMcp
                    ) =>
            {
                CallerAttributionV1::declared(basis.caller_key().to_owned())
            }
            "link"
                if basis.principal_user_id().is_none()
                    && matches!(self.resolved, ResolvedAppAuthority::Anonymous)
                    && self.source == InvocationSource::HttpCapabilityLink =>
            {
                CallerAttributionV1::link(basis.caller_key().to_owned())
            }
            _ => {
                return Err(caller_attribution_invalid(
                    "external caller attribution does not match the prepared authority lane",
                ));
            }
        };
        self.caller_attribution = Some(attribution);
        Ok(self)
    }

    /// Attribute one approved effect to the original caller and the exact
    /// approver retained by the database-bound prepared approval.
    ///
    /// @ref LLP 0303#the-governing-principle — caller, approver, and original
    /// authority are verified as one database-produced pending-effect row.
    pub fn with_effect_caller_attribution(
        mut self,
        effect: &PendingEffectRecord,
        approver: &PreparedEffectApproverAttribution,
    ) -> SnapbackResult<Self> {
        self.validate_admission("pending-effect caller telemetry attribution")?;
        if self.source != InvocationSource::EffectExecution {
            return Err(caller_attribution_invalid(
                "pending-effect caller attribution requires effect execution authority",
            ));
        }
        let approver_principal_id = approver.validated_subject()?.user_id();
        let binding = effect
            .caller_attribution_database_binding(approver_principal_id)
            .ok_or_else(|| {
                caller_attribution_invalid(
                    "pending-effect caller attribution requires the exact prepared approval",
                )
            })?;
        if !self
            .admission
            .origin()
            .is_some_and(|origin| origin.matches_database_binding(binding))
        {
            return Err(caller_attribution_invalid(
                "pending-effect caller attribution belongs to another engine authority graph",
            ));
        }
        if !approver
            .authority
            .admission
            .origin()
            .is_some_and(|origin| origin.matches_database_binding(binding))
        {
            return Err(caller_attribution_invalid(
                "pending-effect approver authority belongs to another engine authority graph",
            ));
        }
        let authority_matches = match (&self.resolved, effect.authority()) {
            (ResolvedAppAuthority::Anonymous, PendingEffectAuthority::Anonymous) => true,
            (
                ResolvedAppAuthority::Session(subject),
                PendingEffectAuthority::Session {
                    user_id,
                    session_id,
                    provider,
                    generation,
                    authority_instance_id,
                    authorization_stream_incarnation,
                },
            ) => {
                subject.user_id() == user_id
                    && subject.session_id() == session_id
                    && subject.provider() == provider
                    && subject.generation() == *generation
                    && subject.authority_instance_id() == authority_instance_id
                    && self.authorization_stream_incarnation()
                        == Some(authorization_stream_incarnation.as_str())
            }
            (
                ResolvedAppAuthority::ServicePrincipal(subject),
                PendingEffectAuthority::ServicePrincipal {
                    actor_user_id,
                    credential_id,
                    credential_generation,
                    grant_id,
                    token_id,
                    effective_user_id,
                    token_expires_at_ms,
                },
            ) => {
                subject.actor_user_id() == actor_user_id
                    && subject.credential_id() == credential_id
                    && subject.credential_generation() == *credential_generation
                    && subject.grant_id() == grant_id
                    && subject.token_id() == token_id
                    && subject.effective_user_id() == effective_user_id.as_deref()
                    && subject.token_expires_at_ms() == *token_expires_at_ms
            }
            _ => false,
        };
        if !authority_matches {
            return Err(caller_attribution_invalid(
                "pending-effect caller attribution does not match the original authority",
            ));
        }
        self.caller_attribution = Some(
            CallerAttributionV1::from_effect(effect.caller_lane(), effect.caller_key().to_owned())
                .with_approver(approver_principal_id.to_owned()),
        );
        Ok(self)
    }

    /// Reclassify a session-authorized management request only for the exact
    /// query/reaction functions being captured into a watch. Later execution
    /// does not retain this session authority; it reconstructs the dedicated
    /// credential-free authority above.
    pub fn watch_function_authority(&self, source: InvocationSource) -> SnapbackResult<Self> {
        if self.source != InvocationSource::WatchManagement
            || !matches!(
                source,
                InvocationSource::WatchEvaluation | InvocationSource::WatchReaction
            )
            || !matches!(
                self.resolved,
                ResolvedAppAuthority::Session(_) | ResolvedAppAuthority::ServicePrincipal(_)
            )
        {
            return Err(SnapbackError::error(
                "SNAPBACK_INVOCATION_SOURCE_INVALID",
                "auth",
                "watch function authority requires an admitted session or scoped integration management request",
            ));
        }
        Ok(Self {
            source,
            ..self.clone()
        })
    }

    fn with_optional_caller_attribution(
        mut self,
        attribution: Option<CallerAttributionV1>,
    ) -> Self {
        self.caller_attribution = attribution;
        self
    }

    pub fn resolve_service_authority_act(
        &self,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<Option<ServiceAuthorityActResolution>> {
        self.service_publication
            .as_ref()
            .map(|publication| publication.resolve_act(epoch_now_ms, monotonic_now))
            .transpose()
    }

    pub fn service_clock_sample(
        &self,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> (u64, Instant) {
        self.service_publication
            .as_ref()
            .map_or((epoch_now_ms, monotonic_now), |publication| {
                publication.current_clock_sample(epoch_now_ms, monotonic_now)
            })
    }

    pub fn expired_service_deadline_terminal(
        &self,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<Option<ServiceAuthorityDeadlineTerminal>> {
        self.service_publication
            .as_ref()
            .map(|publication| publication.expired_deadline_terminal(epoch_now_ms, monotonic_now))
            .transpose()
            .map(Option::flatten)
    }

    pub fn service_terminal_disposition(
        &self,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> Option<ServiceAuthorityDisposition> {
        self.service_publication
            .as_ref()
            .map(|publication| publication.terminal_disposition(epoch_now_ms, monotonic_now))
    }

    pub fn begin_service_external_effect(
        &self,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<Option<ServiceAuthorityExternalEffectPermit>> {
        self.begin_service_external_effect_classified(epoch_now_ms, monotonic_now)
            .map_err(AuthorizedEffectReservationError::into_error)
    }

    pub fn begin_service_external_effect_classified(
        &self,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> Result<Option<ServiceAuthorityExternalEffectPermit>, AuthorizedEffectReservationError>
    {
        let Some(publication) = self.service_publication.as_ref() else {
            return Ok(None);
        };
        match publication.begin_authority_work_classified(epoch_now_ms, monotonic_now) {
            Ok(permit) => Ok(Some(permit)),
            Err(ServiceAuthorityWorkReservationError::Terminal { disposition, error }) => {
                Err(AuthorizedEffectReservationError::Terminal(
                    CallerAuthorityTerminalCause::ScopedServiceRetired { disposition, error },
                ))
            }
            Err(ServiceAuthorityWorkReservationError::NonTerminal(error)) => {
                Err(AuthorizedEffectReservationError::NonTerminal(error))
            }
        }
    }

    pub fn session_terminal_reason(
        &self,
        epoch_now_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<Option<crate::contract_types::RevocationReason>> {
        match &self.publication {
            Some(publication) => publication.session_terminal_reason(epoch_now_ms, monotonic_now),
            None => Ok(None),
        }
    }

    /// Install the authorization stream selected by the controller that
    /// admitted this authority. A consumer cannot use its own stream to
    /// repair a foreign authority: controller ownership is checked before a
    /// missing value is installed, and an existing value must match exactly.
    ///
    /// @ref LLP 0303#derivation-is-a-lifetime-property-not-a-constructor-event —
    ///   the stream attachment stays inside the authority's admission graph.
    pub fn bind_authorization_stream(
        mut self,
        admission: &AdmissionController,
        incarnation: String,
    ) -> SnapbackResult<Self> {
        if !admission.owns_lease(&self.admission) {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "authorization stream belongs to another admission graph",
            ));
        }
        canonical_uuid_v7(&incarnation).map_err(|()| {
            SnapbackError::error(
                "SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT",
                "auth",
                "authorization-stream incarnation is not a canonical UUIDv7",
            )
        })?;
        if let Some(installed) = self.authorization_stream_incarnation.as_deref() {
            if installed != incarnation {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                    "auth",
                    "authority already belongs to another authorization stream",
                ));
            }
            return Ok(self);
        }
        self.authorization_stream_incarnation = Some(incarnation);
        Ok(self)
    }

    /// Consume a fully computed finite effect at the exact stream/session
    /// fence. Dev-mode authority has no session projection and publishes
    /// directly; Sessions authority always installs a fence in middleware.
    pub fn try_publish_fenced<T>(
        &self,
        epoch_now_ms: u64,
        monotonic_now: std::time::Instant,
        publish: impl FnOnce() -> SnapbackResult<T>,
    ) -> SnapbackResult<Option<T>> {
        let publish_service = || match &self.service_publication {
            Some(publication) => publication.try_publish(epoch_now_ms, monotonic_now, publish),
            None => publish().map(Some),
        };
        // Diagnostic admission lets the bootstrap handshake remain observable
        // while mode admission is pending; it does not waive an installed
        // authorization-stream/session fence. In particular, reset must not
        // let a predecessor handshake publish its captured authority under the
        // successor stream.
        //
        // @ref LLP 0059#handshake-and-readiness — the handshake incarnation
        //   and authority are one counted, final-fenced capture.
        let publish_session = || match &self.publication {
            Some(publication) => {
                let nested =
                    publication.try_publish(epoch_now_ms, monotonic_now, publish_service)?;
                Ok(nested.flatten())
            }
            None => publish_service(),
        };
        match (&self.rehearsal_provenance, &self.rehearsal_fence) {
            (Some(_), Some(fence)) => fence
                .try_publish(epoch_now_ms, || publish_session().map_err(Into::into))
                .map_err(Into::into),
            (Some(_), None) => Err(crate::auth::rehearsal::authority_ended()),
            (None, _) => publish_session(),
        }
    }

    pub fn authorization_stream_incarnation(&self) -> Option<&str> {
        self.authorization_stream_incarnation.as_deref()
    }

    pub fn retain_live_owner(&self) -> SnapbackResult<RetainedLiveAuthority> {
        self.validate_admission("live owner retention")?;
        if self.source != InvocationSource::LiveInitialQuery {
            return Err(SnapbackError::error(
                "SNAPBACK_INVOCATION_SOURCE_INVALID",
                "auth",
                "only LiveInitialQuery authority can establish a retained live owner",
            ));
        }
        Ok(RetainedLiveAuthority {
            active_mode: self.active_mode,
            profile: self.profile,
            elevation_root_provenance: self.elevation_root_provenance,
            owner_key: self.resolved.key(),
            resolved: self.resolved.clone(),
            rerun_origin: match &self.resolved {
                ResolvedAppAuthority::Session(subject) => Some(subject.admission_origin.clone()),
                ResolvedAppAuthority::ServicePrincipal(subject) => {
                    Some(subject.admission_origin.clone())
                }
                ResolvedAppAuthority::RevalidatedPrincipal(subject) => {
                    Some(subject.admission_origin.clone())
                }
                _ => self.admission.origin(),
            },
            unmanaged_rerun_admission: self
                .admission
                .origin()
                .is_none()
                .then(|| self.admission.clone()),
            matched_grant_scope: None,
            service_publication: self.service_publication.clone(),
            caller_attribution: self.caller_attribution.clone(),
            rehearsal_provenance: self.rehearsal_provenance.clone(),
            rehearsal_fence: self.rehearsal_fence.clone(),
        })
    }

    pub fn validate_admission(&self, effect: &'static str) -> SnapbackResult<()> {
        self.validate_admission_classified(effect)
            .map_err(AuthorizedEffectReservationError::into_error)
    }

    pub fn validate_admission_classified(
        &self,
        effect: &'static str,
    ) -> Result<(), AuthorizedEffectReservationError> {
        self.admission.validate(effect).map_err(|error| {
            AuthorizedEffectReservationError::Terminal(
                CallerAuthorityTerminalCause::AdmissionEpochRetired { error },
            )
        })?;
        self.validate_rehearsal_authority()
            .map_err(AuthorizedEffectReservationError::NonTerminal)?;
        #[cfg(any(test, feature = "test-support"))]
        run_classified_admission_hook_for_test();
        Ok(())
    }

    fn validate_rehearsal_authority(&self) -> SnapbackResult<()> {
        match (&self.rehearsal_provenance, &self.rehearsal_fence) {
            (Some(_), Some(fence)) => fence.validate_at(rehearsal_now_ms()).map_err(Into::into),
            (Some(_), None) => Err(crate::auth::rehearsal::authority_ended()),
            (None, _) => Ok(()),
        }
    }

    /// Reserve stream/session and optional finite-service authority before a
    /// synchronous Local write. The returned permits are lock-free; terminal
    /// premark closes every later reservation and drains an earlier one before
    /// its durable terminal transaction may begin.
    ///
    /// @ref LLP 0058#split-phase-authorized-effect-fence — sites choose this
    /// authorized path explicitly; reservation ordering, typed stale mapping,
    /// retained-witness installation, and mode-last commit guarding stay here.
    /// @ref LLP 0059#allowed-order — stream/session precede optional service;
    /// the independent mode guard is acquired only by the inner commit guard.
    pub fn reserve_authorized_effect(
        &self,
        effect: &'static str,
    ) -> SnapbackResult<AuthorizedEffectReservation> {
        self.reserve_authorized_effect_classified(effect)
            .map_err(AuthorizedEffectReservationError::into_error)
    }

    pub fn reserve_authorized_effect_classified(
        &self,
        effect: &'static str,
    ) -> Result<AuthorizedEffectReservation, AuthorizedEffectReservationError> {
        self.admission.validate(effect).map_err(|error| {
            AuthorizedEffectReservationError::Terminal(
                CallerAuthorityTerminalCause::AdmissionEpochRetired { error },
            )
        })?;
        self.validate_rehearsal_authority()
            .map_err(AuthorizedEffectReservationError::NonTerminal)?;
        let (epoch_now_ms, monotonic_now) =
            self.service_clock_sample(rehearsal_now_ms(), Instant::now());
        let publication = match &self.publication {
            Some(publication) => {
                match publication.try_reserve_work_classified(epoch_now_ms, monotonic_now) {
                    Ok(permit) => AuthorizedPublicationReservation::Fenced { _permit: permit },
                    Err(FencedAuthorityWorkReservationError::AuthorizationStreamRetired) => {
                        return Err(AuthorizedEffectReservationError::Terminal(
                            CallerAuthorityTerminalCause::AuthorizationStreamRetired {
                                error: authorization_stream_retired_error(),
                            },
                        ));
                    }
                    Err(FencedAuthorityWorkReservationError::SessionRetired { disposition }) => {
                        return Err(AuthorizedEffectReservationError::Terminal(
                            CallerAuthorityTerminalCause::SessionRetired {
                                disposition,
                                error: session_retired_error(disposition),
                            },
                        ));
                    }
                    Err(FencedAuthorityWorkReservationError::SessionMutationPending(error)) => {
                        return Err(AuthorizedEffectReservationError::NonTerminal(error));
                    }
                    Err(FencedAuthorityWorkReservationError::NonTerminal(error)) => {
                        return Err(AuthorizedEffectReservationError::NonTerminal(error));
                    }
                }
            }
            None if self.active_mode == AuthMode::Dev => AuthorizedPublicationReservation::DevMode,
            None => {
                return Err(AuthorizedEffectReservationError::NonTerminal(
                    SnapbackError::error(
                        "SNAPBACK_AUTH_PROJECTION_UNAVAILABLE",
                        "auth",
                        "authorized effect requires an installed authorization publication",
                    ),
                ));
            }
        };
        let service = match self.service_publication.as_ref() {
            Some(service) => match service
                .begin_authority_work_classified(epoch_now_ms, monotonic_now)
            {
                Ok(permit) => Some(permit),
                Err(ServiceAuthorityWorkReservationError::Terminal { disposition, error }) => {
                    drop(publication);
                    return Err(AuthorizedEffectReservationError::Terminal(
                        CallerAuthorityTerminalCause::ScopedServiceRetired { disposition, error },
                    ));
                }
                Err(ServiceAuthorityWorkReservationError::NonTerminal(error)) => {
                    drop(publication);
                    return Err(AuthorizedEffectReservationError::NonTerminal(error));
                }
            },
            None => None,
        };
        let reservation = AuthorizedEffectReservation {
            authority: self.clone(),
            _publication: publication,
            service,
            #[cfg(any(test, feature = "test-support"))]
            before_commit_guard_for_test: std::sync::Mutex::new(None),
            #[cfg(any(test, feature = "test-support"))]
            commit_guard_failure_for_test: std::sync::Mutex::new(None),
            #[cfg(any(test, feature = "test-support"))]
            test_identity: {
                static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
                NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            },
            #[cfg(any(test, feature = "test-support"))]
            scope_probe_for_test: std::sync::Mutex::new(None),
        };
        #[cfg(any(test, feature = "test-support"))]
        ACTIVE_AUTHORIZED_EFFECT_RESERVATIONS_FOR_TEST
            .get_or_init(|| std::sync::Mutex::new(std::collections::BTreeSet::new()))
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(reservation.test_identity);
        Ok(reservation)
    }

    fn authorized_effect_stale(&self, epoch_now_ms: u64, monotonic_now: Instant) -> SnapbackError {
        match &self.resolved {
            ResolvedAppAuthority::Session(_) => {
                let disposition = self
                    .session_terminal_reason(epoch_now_ms, monotonic_now)
                    .ok()
                    .flatten()
                    .map(|reason| match reason.authority_disposition() {
                        crate::contract_types::TerminalAuthorityDisposition::Carrier => "carrier",
                        crate::contract_types::TerminalAuthorityDisposition::DurableDelete => {
                            "durableDelete"
                        }
                    })
                    .unwrap_or("carrier");
                SnapbackError::error(
                    "SNAPBACK_AUTH_SESSION_EXPIRED",
                    "auth",
                    "authentication session is expired or revoked",
                )
                .with_details(serde_json::json!({
                    "authorityDisposition": disposition,
                }))
            }
            ResolvedAppAuthority::ServicePrincipal(_) => {
                let disposition =
                    match self.service_terminal_disposition(epoch_now_ms, monotonic_now) {
                        Some(ServiceAuthorityDisposition::DurableDelete) => "durableDelete",
                        Some(ServiceAuthorityDisposition::Carrier) | None => "carrier",
                    };
                SnapbackError::error(
                    "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
                    "auth",
                    "scoped agent token authority is no longer current",
                )
                .with_details(serde_json::json!({
                    "authorityDisposition": disposition,
                }))
            }
            _ => SnapbackError::error(
                "SNAPBACK_AUTH_STREAM_RESET",
                "auth",
                "the authorization stream is no longer current",
            )
            .with_details(serde_json::json!({
                "authorityDisposition": "carrier",
                "retryable": true,
                "cause": "stream_replaced",
            })),
        }
    }

    /// Mode-only/terminal-carrier effect guard. This does not reserve
    /// stream/session or finite-service authority; call sites select it
    /// explicitly only when publication authority is inapplicable or the
    /// operation is itself responsible for ending that authority.
    pub fn mode_effect_guard(
        &self,
        effect: &'static str,
    ) -> SnapbackResult<AdmissionEffectGuard<'_>> {
        self.validate_admission(effect)?;
        self.admission.effect_guard(effect)
    }

    /// Compatibility spelling for existing mode-only fences. New durable
    /// authority-sensitive sites choose `reserve_authorized_effect` instead.
    pub fn effect_guard(&self, effect: &'static str) -> SnapbackResult<AdmissionEffectGuard<'_>> {
        self.mode_effect_guard(effect)
    }

    /// Validate the exact authorization stream/session leaf and perform one
    /// bounded synchronous publication while its guards remain held.
    pub fn try_fenced_publication<T>(
        &self,
        epoch_now_ms: u64,
        monotonic_now: Instant,
        publish: impl FnOnce() -> SnapbackResult<T>,
    ) -> SnapbackResult<Option<T>> {
        self.try_publish_fenced(epoch_now_ms, monotonic_now, publish)
    }

    pub fn inherit_for(&self, source: InvocationSource) -> SnapbackResult<Self> {
        let same_authority_transition = matches!(
            (self.source, source),
            (
                InvocationSource::HttpQuery,
                InvocationSource::LiveInitialQuery
            ) | (
                InvocationSource::LiveInitialQuery,
                InvocationSource::LiveUnsubscribe
            )
        );
        if !same_authority_transition
            && !matches!(
                source,
                InvocationSource::NestedMutation | InvocationSource::LiveRerun
            )
        {
            return Err(SnapbackError::error(
                "SNAPBACK_INVOCATION_SOURCE_INVALID",
                "auth",
                "resolved invocation authority cannot be inherited by this source",
            ));
        }
        // @ref LLP 0303#derivation-is-a-lifetime-property-not-a-constructor-event —
        // source continuation clones the complete prepared carrier; it never
        // accepts subject fields or a separately supplied admission lease.
        let elevation_root_provenance = match self.elevation_root_provenance {
            ElevationRootProvenance::Unbound => ElevationRootProvenance::Fenced,
            provenance => provenance,
        };
        Ok(Self {
            source,
            elevation_root_provenance,
            ..self.clone()
        })
    }

    /// Re-enter the ordinary finite-query gate from the host-owned ask loop.
    /// This changes only the source/target classification; the exact prepared
    /// caller, admission lease, grant scopes, and publication fences remain
    /// unchanged.
    pub fn ask_query_authority(&self) -> SnapbackResult<Self> {
        if !matches!(
            self.source,
            InvocationSource::HttpAsk | InvocationSource::HttpMcp
        ) {
            return Err(SnapbackError::error(
                "SNAPBACK_INVOCATION_SOURCE_INVALID",
                "auth",
                "only the HTTP or MCP ask host may re-enter ordinary query preparation",
            ));
        }
        Ok(Self {
            source: InvocationSource::HttpQuery,
            ..self.clone()
        })
    }
}

impl RetainedLiveAuthority {
    pub fn resolved(&self) -> &ResolvedAppAuthority {
        &self.resolved
    }

    pub fn profile(&self) -> ServerProfile {
        self.profile
    }

    /// Attribution for the authority that ESTABLISHED this subscription.
    /// `resolved` is cloned once at establishment and never rewritten, so the
    /// block a renewal resubscribe carries is byte-identical to the one the
    /// establishment answered with — immutable subscription metadata, never
    /// re-derived from the caller presenting the resume.
    ///
    /// @ref LLP 0055#audit — server-derived attribution; wrappers copy it
    ///   verbatim and can never synthesize it.
    pub fn function_attribution(&self) -> Option<FunctionAttribution> {
        self.resolved.function_attribution()
    }

    pub fn telemetry_caller_details(&self) -> Option<Value> {
        self.caller_attribution
            .as_ref()
            .map(CallerAttributionV1::details)
    }

    pub fn matches(&self, authority: &PreparedAuthority) -> bool {
        self.active_mode == authority.active_mode
            && self.profile == authority.profile
            && self.owner_key == authority.resolved.key()
    }

    pub fn matched_grant_scope(&self) -> Option<&ResolvedGrantScope> {
        self.matched_grant_scope.as_ref()
    }

    pub fn prepare_rerun(
        &self,
        session_claims: Option<AuthClaimsProjection>,
    ) -> SnapbackResult<PreparedAuthority> {
        // @ref LLP 0303#derivation-is-a-lifetime-property-not-a-constructor-event — a retained subject acquires its own fresh root; callers cannot pair it with an independent lease.
        let admission = match &self.rerun_origin {
            Some(origin) => origin.admit_for_mode(self.active_mode)?,
            None => self.unmanaged_rerun_admission.clone().ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                    "auth",
                    "retained authority has no resolution producer",
                )
            })?,
        };
        let prepared = InvocationGate::prepare_admitted_authority_inner(
            InvocationSource::LiveRerun,
            self.active_mode,
            self.profile,
            admission,
            &WireAuthorityFields::default(),
            self.resolved.clone(),
            session_claims,
            true,
        )?;
        let prepared = match &self.service_publication {
            Some(publication) => prepared.with_service_publication(publication.clone()),
            None => prepared,
        }
        .with_optional_caller_attribution(self.caller_attribution.clone());
        Ok(PreparedAuthority {
            elevation_root_provenance: self.elevation_root_provenance,
            rehearsal_provenance: self.rehearsal_provenance.clone(),
            rehearsal_fence: self.rehearsal_fence.clone(),
            ..prepared
        })
    }

    pub fn canonicalize_input(&self, mut input: HandlerInput) -> HandlerInput {
        input.auth = self.resolved.legacy_input();
        input
    }
}

/// Immutable authority-bearing input to a function runtime seam.
#[derive(Clone, Debug)]
pub struct PreparedInvocation {
    authority: PreparedAuthority,
    function_id: String,
    function_kind: FunctionKind,
    requirement: AuthRequirement,
    authority_creating_consent: bool,
    /// Exact service-grant entry selected for this function. Keeping the full
    /// identity here prevents later live retention from reconstructing scope
    /// authority from a grant-wide list.
    matched_grant_scope: Option<ResolvedGrantScope>,
    invocation_id: String,
    /// The function's declared application refusal codes, carried from the
    /// manifest so the envelope decoder can admit a claimed `appCode` only
    /// when the author declared it. An empty set folds every claim.
    ///
    /// @ref LLP 0108#declared-application-refusals
    declared_refusals: Vec<String>,
    /// Declared refusal codes whose admitted occurrences opt into issue
    /// tracking. Kept beside the full declaration set so later emission never
    /// has to reopen or reinterpret a manifest.
    ///
    /// @ref LLP 0108#tracked-refusal-opt-in
    tracked_refusals: Vec<String>,
    /// Immutable sequence reach declarations carried through preparation so
    /// handler code cannot swap the scope/access contract at the host seam.
    /// @ref LLP 0135#12-allocation-surfaces — the manifest declaration is the
    ///   runtime ctx boundary authority.
    sequences: Vec<crate::manifest::SequenceDeclaration>,
    /// Unforgeable codegen identity for a synthesized authority operation.
    /// Runtime host seams consume this exact manifest fact; a matching export
    /// name or dependency vector is insufficient.
    generated_authority_operation: Option<crate::manifest::GeneratedAuthorityOperationV1>,
    /// Declared read/write table sets plus the declaration's source span,
    /// carried immutably for the strict-declaration runtime seams. Populated
    /// only for opaque (Ibex-module) handlers — HostPlan declared sets derive
    /// from the generated plan and cannot drift by hand.
    ///
    /// @ref LLP 0146#d1-declarationobservation-conformance — strict mode
    ///   refuses undeclared application-table reads/writes at the seam.
    strict_declaration_facts: Option<crate::conformance::StrictDeclarationFacts>,
    result_contract: crate::manifest::FunctionResultContract,
    result_contract_hash: Option<String>,
    artifact_generation: Option<String>,
}

impl PreparedInvocation {
    pub fn authority(&self) -> &PreparedAuthority {
        &self.authority
    }

    /// Derive the storage writer only from this admitted, opaque invocation.
    /// Callers cannot supply or self-assert a raw authority classification.
    pub fn membership_writer(&self) -> crate::storage::MembershipWriter {
        <crate::storage::MembershipWriter as MembershipWriterResolvedExt>::from_resolved_with_authority_creating(
            self.authority.resolved(),
            self.authority_creating_consent,
        )
    }

    pub fn telemetry_caller_details(&self) -> Option<Value> {
        self.authority.telemetry_caller_details()
    }

    pub fn projection(&self) -> &HandlerAuthProjection {
        self.authority.projection()
    }

    pub fn function_id(&self) -> &str {
        &self.function_id
    }

    pub fn function_kind(&self) -> &FunctionKind {
        &self.function_kind
    }

    pub fn result_contract(&self) -> &crate::manifest::FunctionResultContract {
        &self.result_contract
    }

    pub fn result_contract_hash(&self) -> Option<&str> {
        self.result_contract_hash.as_deref()
    }

    pub fn artifact_generation(&self) -> Option<&str> {
        self.artifact_generation.as_deref()
    }

    pub fn auth_requirement(&self) -> AuthRequirement {
        self.requirement
    }

    pub fn authority_creating_consent(&self) -> bool {
        self.authority_creating_consent
    }

    pub fn invocation_id(&self) -> &str {
        &self.invocation_id
    }

    /// Declared application refusal codes for this function (LLP 0108).
    pub fn declared_refusals(&self) -> &[String] {
        &self.declared_refusals
    }

    /// Refusal codes whose admitted occurrences opt into issue tracking.
    /// The runtime carrier consumes this accessor in the next D-05 tranche;
    /// this authoring commit prepares the immutable authority without yet
    /// changing emission behavior.
    #[allow(dead_code)]
    pub fn tracked_refusals(&self) -> &[String] {
        &self.tracked_refusals
    }

    pub fn sequences(&self) -> &[crate::manifest::SequenceDeclaration] {
        &self.sequences
    }

    pub fn generated_authority_operation(
        &self,
    ) -> Option<&crate::manifest::GeneratedAuthorityOperationV1> {
        self.generated_authority_operation.as_ref()
    }

    /// Declaration facts for the strict-conformance seams; `None` for
    /// HostPlan runtimes, whose declared sets cannot drift by hand.
    pub fn strict_declaration_facts(&self) -> Option<&crate::conformance::StrictDeclarationFacts> {
        self.strict_declaration_facts.as_ref()
    }

    pub fn admission_lease(&self) -> &AdmissionLease {
        self.authority.admission_lease()
    }

    pub fn validate_admission(&self, effect: &'static str) -> SnapbackResult<()> {
        self.authority.validate_admission(effect)
    }

    pub fn validate_admission_classified(
        &self,
        effect: &'static str,
    ) -> Result<(), AuthorizedEffectReservationError> {
        self.authority.validate_admission_classified(effect)
    }

    pub fn mode_effect_guard(
        &self,
        effect: &'static str,
    ) -> SnapbackResult<AdmissionEffectGuard<'_>> {
        self.authority.mode_effect_guard(effect)
    }

    pub fn effect_guard(&self, effect: &'static str) -> SnapbackResult<AdmissionEffectGuard<'_>> {
        self.mode_effect_guard(effect)
    }

    /// Retain the exact service-grant entry selected by this function's
    /// admission. The complete resolved grant remains on the owner for
    /// resume-owner equality, while reruns revalidate only this immutable
    /// `{fn, kind, basis, authorityCreating}` entry.
    ///
    /// @ref LLP 0055#grant-backed-live-and-queued-replay — a sibling entry on
    ///   the same grant cannot terminalize this subscription.
    pub fn retain_live_owner(&self) -> SnapbackResult<RetainedLiveAuthority> {
        let mut retained = self.authority.retain_live_owner()?;
        retained.matched_grant_scope = self.matched_grant_scope.clone();
        if matches!(
            &self.authority.resolved,
            ResolvedAppAuthority::ServicePrincipal(_)
        ) && retained.matched_grant_scope.is_none()
        {
            return Err(missing_grant_scope(&self.function_id, &self.function_kind));
        }
        Ok(retained)
    }

    /// Replace legacy wire authority with the server-derived compatibility
    /// projection used by HostPlan/storage expressions. Runtime JS receives
    /// `HandlerAuthProjection` separately.
    pub fn canonicalize_input(&self, mut input: HandlerInput) -> HandlerInput {
        input.auth = self.authority.canonical_auth_input();
        input
    }

    pub fn inherit_authority_for(
        &self,
        source: InvocationSource,
    ) -> SnapbackResult<PreparedAuthority> {
        self.authority.inherit_for(source)
    }
}

pub struct InvocationGate;

impl InvocationGate {
    #[cfg(test)]
    fn compatibility_admission(
        active_mode: AuthMode,
        transition_generation: u64,
    ) -> SnapbackResult<AdmissionLease> {
        test_admission_controller(active_mode, transition_generation)?.admit_for_mode(active_mode)
    }

    #[allow(clippy::too_many_arguments)]
    #[cfg(test)]
    pub fn prepare_authority(
        source: InvocationSource,
        active_mode: AuthMode,
        profile: ServerProfile,
        transition_generation: u64,
        _admission_epoch: u64,
        wire: &WireAuthorityFields,
        resolved: ResolvedAppAuthority,
    ) -> SnapbackResult<PreparedAuthority> {
        let managed = match &resolved {
            ResolvedAppAuthority::Session(subject) => {
                Some(subject.admission_origin.admit_for_mode(active_mode)?)
            }
            ResolvedAppAuthority::ServicePrincipal(subject) => {
                Some(subject.admission_origin.admit_for_mode(active_mode)?)
            }
            ResolvedAppAuthority::RevalidatedPrincipal(subject) => {
                Some(subject.admission_origin.admit_for_mode(active_mode)?)
            }
            _ => None,
        };
        let session_claims = matches!(&resolved, ResolvedAppAuthority::Session(_))
            .then(|| AuthClaimsProjection::server_derived(Vec::new(), Vec::new()));
        Self::prepare_admitted_authority(
            source,
            active_mode,
            profile,
            match managed {
                Some(admission) => admission,
                None => Self::compatibility_admission(active_mode, transition_generation)?,
            },
            wire,
            resolved,
            session_claims,
        )
    }

    /// Prepare authority under a counted admission lease owned by the app's
    /// process-local controller. HTTP composition must use this form; the raw
    /// generation/epoch overload exists only while that lane is being wired.
    pub(crate) fn prepare_admitted_authority(
        source: InvocationSource,
        active_mode: AuthMode,
        profile: ServerProfile,
        admission: AdmissionLease,
        wire: &WireAuthorityFields,
        resolved: ResolvedAppAuthority,
        session_claims: Option<AuthClaimsProjection>,
    ) -> SnapbackResult<PreparedAuthority> {
        Self::prepare_admitted_authority_inner(
            source,
            active_mode,
            profile,
            admission,
            wire,
            resolved,
            session_claims,
            false,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn prepare_admitted_authority_inner(
        source: InvocationSource,
        active_mode: AuthMode,
        profile: ServerProfile,
        admission: AdmissionLease,
        wire: &WireAuthorityFields,
        resolved: ResolvedAppAuthority,
        session_claims: Option<AuthClaimsProjection>,
        allow_inherited_live_rerun: bool,
    ) -> SnapbackResult<PreparedAuthority> {
        admission.validate("invocation preparation")?;
        admission.require_mode(active_mode)?;
        // @ref LLP 0303#corollary--the-artifact-must-carry-provenance-not-just-type — subject facts and the admission lease
        // must share one verifier-owned graph for their entire lifetime.
        let subject_origin = match &resolved {
            ResolvedAppAuthority::Session(subject) => Some(&subject.admission_origin),
            ResolvedAppAuthority::ServicePrincipal(subject) => Some(&subject.admission_origin),
            ResolvedAppAuthority::RevalidatedPrincipal(subject) => Some(&subject.admission_origin),
            _ => None,
        };
        if subject_origin.is_some_and(|origin| !origin.owns(&admission)) {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "resolved authority does not match its resolution graph",
            ));
        }
        if active_mode == AuthMode::Sessions
            && let Some(location) = wire.first_present()
        {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED",
                "auth",
                format!(
                    "legacy authority field {} is unsupported in sessions mode",
                    location.wire_name()
                ),
            ));
        }
        if !source_allows_authority(source, active_mode, &resolved, allow_inherited_live_rerun) {
            return Err(SnapbackError::error(
                "SNAPBACK_INVOCATION_SOURCE_INVALID",
                "auth",
                format!(
                    "invocation source {source:?} cannot be prepared with this authority class in {} mode",
                    active_mode.as_str()
                ),
            ));
        }
        let audit = match (&resolved, source) {
            (ResolvedAppAuthority::Anonymous, _) => AuthorityAuditFact::Anonymous,
            (ResolvedAppAuthority::Session(_), _) => AuthorityAuditFact::Session,
            (ResolvedAppAuthority::RevalidatedPrincipal(_), _) => {
                AuthorityAuditFact::RevalidatedPrincipal
            }
            (ResolvedAppAuthority::ServicePrincipal(_), _) => AuthorityAuditFact::ServicePrincipal,
            (ResolvedAppAuthority::AdminBypass { .. }, _) => AuthorityAuditFact::AdminBypass,
            (ResolvedAppAuthority::System, _) => AuthorityAuditFact::System,
            (
                ResolvedAppAuthority::DevImpersonation { .. },
                InvocationSource::DirectAdminRunner,
            ) => AuthorityAuditFact::DirectRunnerBodyUser,
            (
                ResolvedAppAuthority::DevImpersonation { .. },
                InvocationSource::HostOperationFunctionRun
                | InvocationSource::HostOperationMutationDryRun,
            ) => AuthorityAuditFact::HostOperationImpersonation,
            (ResolvedAppAuthority::DevImpersonation { .. }, InvocationSource::BranchOperation) => {
                AuthorityAuditFact::BranchPrincipal
            }
            (ResolvedAppAuthority::DevImpersonation { .. }, _) => {
                AuthorityAuditFact::DevBodyAuthority
            }
        };
        let projection = HandlerAuthProjection::from_authority(&resolved, session_claims)?;
        let direct_authorization = match &resolved {
            ResolvedAppAuthority::ServicePrincipal(subject) => subject
                .effective_user_id()
                .map(DirectAuthorizationProjection::for_effective_user),
            _ => None,
        };
        let rehearsal_provenance = match &resolved {
            ResolvedAppAuthority::Session(subject) => subject.rehearsal_provenance().cloned(),
            _ => None,
        };
        Ok(PreparedAuthority {
            admission,
            active_mode,
            profile,
            source,
            elevation_root_provenance: ElevationRootProvenance::Unbound,
            resolved,
            projection,
            direct_authorization,
            audit,
            availability: OperationAvailability::Available,
            publication: None,
            service_publication: None,
            authorization_stream_incarnation: None,
            caller_attribution: None,
            asset_callbacks_service: None,
            rehearsal_provenance,
            rehearsal_fence: None,
            pending_effect_session_bearer: None,
            pending_effect_scoped_token: None,
        })
    }

    /// Prepare only authority classes whose identity is intentionally
    /// caller-selected at this boundary. Subject-bearing variants are refused
    /// and must arrive through their opaque resolver-owned carriers.
    #[allow(clippy::too_many_arguments)]
    pub fn prepare_admitted_subjectless_authority(
        source: InvocationSource,
        active_mode: AuthMode,
        profile: ServerProfile,
        admission: AdmissionLease,
        wire: &WireAuthorityFields,
        resolved: ResolvedAppAuthority,
        session_claims: Option<AuthClaimsProjection>,
    ) -> SnapbackResult<PreparedAuthority> {
        if session_claims.is_some()
            || matches!(
                resolved,
                ResolvedAppAuthority::Session(_)
                    | ResolvedAppAuthority::ServicePrincipal(_)
                    | ResolvedAppAuthority::RevalidatedPrincipal(_)
            )
        {
            return Err(SnapbackError::error(
                "SNAPBACK_INVOCATION_AUTHORITY_INVALID",
                "auth",
                "subject authority requires its verifier-owned carrier",
            ));
        }
        Self::prepare_admitted_authority(
            source,
            active_mode,
            profile,
            admission,
            wire,
            resolved,
            None,
        )
    }

    /// Prepare a human watch owner only from the protected-catalog proof that
    /// revalidated the current principal.
    pub fn prepare_admitted_revalidated_principal(
        source: InvocationSource,
        profile: ServerProfile,
        admission: AdmissionLease,
        principal: crate::storage::watches::RevalidatedWatchPrincipal,
    ) -> SnapbackResult<PreparedAuthority> {
        let admission_origin = admission.origin().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "revalidated watch authority requires a controller-managed admission",
            )
        })?;
        if !admission_origin.matches_database_binding(principal.database_binding()) {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "the revalidated watch principal and admission lease belong to different engine authority graphs",
            ));
        }
        Self::prepare_admitted_authority(
            source,
            AuthMode::Sessions,
            profile,
            admission,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::RevalidatedPrincipal(ResolvedRevalidatedPrincipalAuthority {
                user_id: principal.user_id().to_owned(),
                authority_instance_id: principal.authority_instance_id().to_owned(),
                admission_origin,
            }),
            None,
        )
    }

    /// Prepare the ruled bearer-free service principal under the same closed
    /// function gate as external LLP 0055 service principals. Only the carrier
    /// validation differs: the protected catalog contains a principal and
    /// immutable grant, but no credential or token secret.
    pub fn prepare_admitted_asset_callbacks(
        profile: ServerProfile,
        admission: AdmissionLease,
        principal: AssetCallbacksServicePrincipal,
    ) -> SnapbackResult<PreparedAuthority> {
        let admission_origin = admission.origin().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "asset callback authority requires a controller-managed admission",
            )
        })?;
        if !admission_origin.matches_database_binding(principal.database_binding()) {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "the asset callback principal and admission lease belong to different engine authority graphs",
            ));
        }
        let credential_id = derived_asset_callbacks_id(
            crate::ids::Kind::AgentCredential,
            &[principal.actor_user_id()],
        );
        let token_id = derived_asset_callbacks_id(
            crate::ids::Kind::AgentToken,
            &[principal.actor_user_id(), principal.grant_id()],
        );
        let resolved = ResolvedAppAuthority::resolved_service_principal(
            principal.actor_user_id().to_owned(),
            credential_id,
            1,
            principal.grant_id().to_owned(),
            token_id,
            None,
            vec![ResolvedGrantScope::from_exact(principal.scope().clone())],
            u64::MAX,
            None,
            admission_origin,
        );
        let mut authority = Self::prepare_admitted_authority_inner(
            InvocationSource::AssetCallback,
            AuthMode::Sessions,
            profile,
            admission,
            &WireAuthorityFields::default(),
            resolved,
            None,
            false,
        )?;
        authority.projection = HandlerAuthProjection::for_asset_callbacks(&principal);
        authority.asset_callbacks_service = Some(principal);
        Ok(authority)
    }

    /// Prepare an integration watch only from the exact protected-record and
    /// grant revalidation carrier.
    pub fn prepare_admitted_watch_anchor(
        source: InvocationSource,
        profile: ServerProfile,
        admission: AdmissionLease,
        watch_id: &str,
        anchor: crate::storage::watches::WatchAnchorAuthority,
    ) -> SnapbackResult<PreparedAuthority> {
        let admission_origin = admission.origin().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "watch authority requires a controller-managed admission",
            )
        })?;
        if !admission_origin.matches_database_binding(anchor.database_binding()) {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "the watch anchor and admission lease belong to different engine authority graphs",
            ));
        }
        let resolved = ResolvedAppAuthority::resolved_service_principal(
            anchor.actor_user_id().to_owned(),
            format!("watchAnchor:{watch_id}"),
            0,
            anchor.grant_id().to_owned(),
            format!("watch:{watch_id}"),
            Some(anchor.effective_user_id().to_owned()),
            anchor
                .scopes()
                .iter()
                .cloned()
                .map(ResolvedGrantScope::from_exact)
                .collect(),
            anchor.expires_at_ms(),
            Some(anchor.integration_status()),
            admission_origin,
        );
        Self::prepare_admitted_authority(
            source,
            AuthMode::Sessions,
            profile,
            admission,
            &WireAuthorityFields::default(),
            resolved,
            None,
        )
    }

    #[cfg(test)]
    pub fn prepare_dev_input(
        source: InvocationSource,
        profile: ServerProfile,
        input: &HandlerInput,
    ) -> SnapbackResult<PreparedAuthority> {
        Self::prepare_authority(
            source,
            AuthMode::Dev,
            profile,
            0,
            0,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::dev_from_auth(&input.auth),
        )
    }

    pub fn prepare_admitted_dev_input(
        source: InvocationSource,
        profile: ServerProfile,
        input: &HandlerInput,
        admission: AdmissionLease,
    ) -> SnapbackResult<PreparedAuthority> {
        Self::prepare_admitted_authority(
            source,
            AuthMode::Dev,
            profile,
            admission,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::dev_from_auth(&input.auth),
            None,
        )
    }

    pub fn prepare_function(
        authority: PreparedAuthority,
        function: &FunctionDefinition,
    ) -> SnapbackResult<PreparedInvocation> {
        Self::prepare_function_classified(authority, function)
            .map_err(AuthorizedEffectReservationError::into_error)
    }

    pub fn prepare_function_classified(
        mut authority: PreparedAuthority,
        function: &FunctionDefinition,
    ) -> Result<PreparedInvocation, AuthorizedEffectReservationError> {
        authority.validate_admission_classified("function invocation preparation")?;
        let InvocationTarget::Function(constraint) = authority.source.target() else {
            return Err(AuthorizedEffectReservationError::NonTerminal(
                SnapbackError::error(
                    "SNAPBACK_INVOCATION_SOURCE_INVALID",
                    "auth",
                    "an authority-only source cannot invoke an application function",
                ),
            ));
        };
        if !function_kind_matches(constraint, &function.kind) {
            return Err(AuthorizedEffectReservationError::NonTerminal(
                SnapbackError::error(
                    "SNAPBACK_FUNCTION_KIND_MISMATCH",
                    "runtime",
                    format!(
                        "invocation source {:?} cannot run function kind {:?}",
                        authority.source, function.kind
                    ),
                ),
            ));
        }
        authority.bind_elevation_root(&function.kind);
        let (requirement, authority_creating_consent, matched_grant_scope) =
            evaluate_function_policy_classified(&authority, function)?;
        Ok(PreparedInvocation {
            authority,
            function_id: function.id.clone(),
            function_kind: function.kind.clone(),
            requirement,
            authority_creating_consent,
            matched_grant_scope,
            invocation_id: crate::ids::mint_time_ordered(crate::ids::Kind::Invocation),
            declared_refusals: function.refusals.clone(),
            tracked_refusals: function.tracked_refusals.clone(),
            sequences: function.sequences.clone(),
            generated_authority_operation: function.generated_authority_operation.clone(),
            strict_declaration_facts: matches!(
                function.runtime,
                crate::manifest::FunctionRuntime::IbexModule(_)
            )
            .then(|| crate::conformance::StrictDeclarationFacts {
                declared_reads: function.read_set_summary.tables.clone(),
                declared_writes: function.write_set_summary.tables.clone(),
                source_span: function.source_span.clone(),
            }),
            result_contract: function.result_contract.clone(),
            result_contract_hash: function.result_contract_hash.clone(),
            artifact_generation: function.implementation_hash.clone(),
        })
    }

    /// Re-evaluate the current function/grant/profile policy without treating
    /// the explanation request's HTTP-query carrier as authority to execute
    /// the historical mutation. This is the same policy core consumed by
    /// [`Self::prepare_function`], minus only target-kind dispatch.
    ///
    /// @ref LLP 0162#acceptance — an envelope's recorded authority identifiers
    ///   are lookup keys only; public explanation must re-run current policy.
    pub fn validate_current_function_policy(
        authority: &PreparedAuthority,
        function: &FunctionDefinition,
    ) -> SnapbackResult<()> {
        evaluate_function_policy(authority, function).map(|_| ())
    }
}

#[cfg(any(test, feature = "test-support"))]
pub(crate) fn test_admission_controller(
    active_mode: AuthMode,
    transition_generation: u64,
) -> SnapbackResult<crate::auth::admission::AdmissionController> {
    use crate::auth::mode::{
        AUTH_MODE_FORMAT_VERSION, AppDataAvailability, AuthModeStateRecord, AuthModeStatus,
        DeploymentIdentity,
    };

    let active_deployment = (active_mode == AuthMode::Sessions).then(|| DeploymentIdentity {
        schema_version: "snapback.v1".to_owned(),
        auth_mode: AuthMode::Sessions,
        app_id: "invocation-unit-test".to_owned(),
        schema_hash: format!("snapback.v1:sessions:schema:sha256:{}", "1".repeat(64)),
        bundle_hash: format!("snapback.v1:sessions:function:sha256:{}", "2".repeat(64)),
        inputs_hash: format!("snapback.v1:sessions:inputs:sha256:{}", "3".repeat(64)),
    });
    crate::auth::admission::AdmissionController::from_mode_state(&AuthModeStateRecord {
        format_version: AUTH_MODE_FORMAT_VERSION,
        transition_generation,
        active: active_mode,
        desired: active_mode,
        mode_state: AuthModeStatus::Settled,
        app_data_availability: AppDataAvailability::Available,
        sessions_ever_activated: active_mode == AuthMode::Sessions,
        active_deployment,
        requested_deployment: None,
        quarantine: None,
    })
}

fn evaluate_function_policy(
    authority: &PreparedAuthority,
    function: &FunctionDefinition,
) -> SnapbackResult<(AuthRequirement, bool, Option<ResolvedGrantScope>)> {
    authority.validate_admission("current function policy evaluation")?;
    evaluate_function_policy_after_admission(authority, function)
}

fn evaluate_function_policy_classified(
    authority: &PreparedAuthority,
    function: &FunctionDefinition,
) -> Result<(AuthRequirement, bool, Option<ResolvedGrantScope>), AuthorizedEffectReservationError> {
    authority.validate_admission_classified("current function policy evaluation")?;
    evaluate_function_policy_after_admission(authority, function)
        .map_err(AuthorizedEffectReservationError::NonTerminal)
}

fn evaluate_function_policy_after_admission(
    authority: &PreparedAuthority,
    function: &FunctionDefinition,
) -> SnapbackResult<(AuthRequirement, bool, Option<ResolvedGrantScope>)> {
    let requirement = function.effective_auth_requirement();
    if requirement == AuthRequirement::Authenticated && !authority.resolved.carries_user() {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_REQUIRED",
            "auth",
            "this function requires an authenticated user",
        ));
    }
    let mut authority_creating_consent = false;
    let mut matched_grant_scope = None;
    if let ResolvedAppAuthority::ServicePrincipal(subject) = &authority.resolved {
        let scope = subject
            .scopes()
            .iter()
            .find(|scope| scope.function_id == function.id && scope.kind == function.kind)
            .ok_or_else(|| missing_grant_scope(&function.id, &function.kind))?;
        // @ref LLP 0204#d1--the-exposure-declaration-keystone — the
        // credentialed exposure check shares the function-policy chokepoint,
        // after scope selection and before profile-class admission, so bare
        // routes, live reruns, and nested mutations cannot bypass it.
        if function
            .api_exposure
            .as_ref()
            .is_some_and(|exposure| !exposure.expose)
        {
            return Err(SnapbackError::error(
                "SNAPBACK_API_EXPOSURE_DENIED",
                "api",
                "the external API exposure policy does not authorize this function",
            )
            .with_details(serde_json::json!({
                "functionId": function.id,
                "function": function.name,
            })));
        }
        // @ref LLP 0055#dated-amendment-llp-0204-integration-registrations-and-watch-anchors-2026-08-08 — suspended integration admission is checked beside external exposure on every invocation; it is not credential/grant revocation.
        match subject.integration_status() {
            Some(crate::storage::auth_integrations::IntegrationStatus::Suspended) => {
                return Err(crate::storage::auth_integrations::integration_suspended(
                    subject.actor_user_id(),
                ));
            }
            Some(crate::storage::auth_integrations::IntegrationStatus::Revoked) => {
                return Err(crate::storage::auth_integrations::integration_revoked(
                    subject.actor_user_id(),
                ));
            }
            Some(crate::storage::auth_integrations::IntegrationStatus::Active) | None => {}
        }
        authority_creating_consent = scope.authority_creating;
        matched_grant_scope = Some(scope.clone());
        if function.authority_creating && !authority_creating_consent {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED",
                "auth",
                "the function requires explicit authority-creating consent",
            )
            .with_details(serde_json::json!({ "reason": "scope_not_authority_creating" })));
        }
    }
    // @ref LLP 0065#2-the-v1-visibility-floor — profile-class admission runs
    //   last, after the target, grant-scope, and authentication gates: a
    //   generated standard pattern requires a principal that projects the
    //   canonical user subject. A delegated agent resolves to the delegating
    //   user and is admitted; a bare servicePrincipal or non-delegated
    //   autonomous agent reaches this point authenticated but subject-less
    //   and is refused. A future profile may admit such principals explicitly.
    if function.standard_pattern.is_some() {
        let projects_user_subject = match &authority.resolved {
            ResolvedAppAuthority::ServicePrincipal(subject) => {
                subject.effective_user_id().is_some()
            }
            _ => true,
        };
        if !projects_user_subject {
            return Err(SnapbackError::error(
                "SNAPBACK_STANDARD_PATTERN_PRINCIPAL_UNSUPPORTED",
                "auth",
                "generated standard patterns require a principal that projects a user subject; a \
                 bare service principal or non-delegated agent is not admitted in v1",
            ));
        }
    }
    Ok((requirement, authority_creating_consent, matched_grant_scope))
}

fn missing_grant_scope(function_id: &str, function_kind: &FunctionKind) -> SnapbackError {
    let kind = crate::storage::auth_scope_bases::function_kind_name(function_kind);
    let grantable_scope = format!("function:{kind}:{function_id}");
    // Authorization has already resolved the caller-visible function and
    // missing scope at this point, so the carrier discloses no new authority.
    // @ref LLP 0146#d7-typed-remediations-and-type-aware-suggestion
    SnapbackError::new(
        crate::diagnostic::Diagnostic::error(
            "SNAPBACK_AUTH_GRANT_SCOPE_DENIED",
            "auth",
            "the scoped grant does not authorize this function",
        )
        .with_details(serde_json::json!({
            "reason": "missing_scope",
            "functionId": function_id,
            "missingScope": {
                "functionId": function_id,
                "kind": kind,
            },
        }))
        .with_remediation_set(crate::remediation::RemediationSetV1::authority(vec![
            crate::remediation::RemediationItemV1::request_grant(grantable_scope),
        ])),
    )
}

fn source_allows_authority(
    source: InvocationSource,
    mode: AuthMode,
    resolved: &ResolvedAppAuthority,
    allow_inherited_live_rerun: bool,
) -> bool {
    let ordinary = match mode {
        AuthMode::Dev => matches!(
            resolved,
            ResolvedAppAuthority::Anonymous
                | ResolvedAppAuthority::DevImpersonation {
                    local_dev_only: true,
                    ..
                }
        ),
        AuthMode::Sessions => matches!(
            resolved,
            ResolvedAppAuthority::Anonymous | ResolvedAppAuthority::Session(_)
        ),
    };
    let admin = match mode {
        AuthMode::Dev => matches!(
            resolved,
            ResolvedAppAuthority::Anonymous
                | ResolvedAppAuthority::DevImpersonation {
                    local_dev_only: true,
                    ..
                }
        ),
        AuthMode::Sessions => matches!(resolved, ResolvedAppAuthority::AdminBypass { .. }),
    };

    match source {
        InvocationSource::BootstrapHandshake => match mode {
            AuthMode::Dev => matches!(resolved, ResolvedAppAuthority::Anonymous),
            AuthMode::Sessions => matches!(
                resolved,
                ResolvedAppAuthority::Anonymous
                    | ResolvedAppAuthority::Session(_)
                    | ResolvedAppAuthority::ServicePrincipal(_)
            ),
        },
        InvocationSource::AuthRefresh
        | InvocationSource::AuthLogout
        | InvocationSource::AgentGrantManagement
        | InvocationSource::CapabilityLinkManagement
        | InvocationSource::EffectManagement
        | InvocationSource::PushTokenRegistry => {
            mode == AuthMode::Sessions && matches!(resolved, ResolvedAppAuthority::Session(_))
        }
        InvocationSource::WatchManagement => {
            mode == AuthMode::Sessions
                && matches!(
                    resolved,
                    ResolvedAppAuthority::Session(_) | ResolvedAppAuthority::ServicePrincipal(_)
                )
        }
        InvocationSource::HttpQuery
        | InvocationSource::HttpMutation
        | InvocationSource::HttpAction
        | InvocationSource::HttpRun
        | InvocationSource::HttpAsk
        | InvocationSource::HttpMcp => {
            ordinary
                || (mode == AuthMode::Sessions
                    && matches!(resolved, ResolvedAppAuthority::ServicePrincipal(_)))
        }
        InvocationSource::HttpCapabilityLink => {
            matches!(resolved, ResolvedAppAuthority::Anonymous)
        }
        InvocationSource::EffectExecution => {
            ordinary
                || (mode == AuthMode::Sessions
                    && matches!(resolved, ResolvedAppAuthority::ServicePrincipal(_)))
        }
        InvocationSource::WatchEvaluation | InvocationSource::WatchReaction => {
            mode == AuthMode::Sessions
                && matches!(resolved, ResolvedAppAuthority::RevalidatedPrincipal(_))
        }
        InvocationSource::ConnectionOpen => {
            ordinary
                || (mode == AuthMode::Sessions
                    && matches!(resolved, ResolvedAppAuthority::ServicePrincipal(_)))
        }
        InvocationSource::LiveInitialQuery
        | InvocationSource::MutationSettlementAcknowledgement
        | InvocationSource::InvalidationAcknowledgement
        | InvocationSource::AssetTransfer
        | InvocationSource::ConnectionClose
        | InvocationSource::LiveResume
        | InvocationSource::LiveUnsubscribe
        | InvocationSource::LiveSupersede
        | InvocationSource::LiveStream
        | InvocationSource::OutboxDrain => {
            ordinary
                || (mode == AuthMode::Sessions
                    && matches!(resolved, ResolvedAppAuthority::ServicePrincipal(_)))
        }
        InvocationSource::EphemeralRegister
        | InvocationSource::EphemeralPublish
        | InvocationSource::EphemeralDelete
        | InvocationSource::EphemeralSubscribe
        | InvocationSource::EphemeralUnsubscribe => ordinary,
        InvocationSource::LocalQuery
        | InvocationSource::LocalMutation
        | InvocationSource::LocalAction => mode == AuthMode::Dev && ordinary,
        InvocationSource::AssetCallback => match mode {
            AuthMode::Dev => ordinary,
            AuthMode::Sessions => {
                matches!(resolved, ResolvedAppAuthority::ServicePrincipal(_))
            }
        },
        InvocationSource::DirectAdminRunner
        | InvocationSource::OperatorCommand
        | InvocationSource::HostOperationFunctionRun
        | InvocationSource::HostOperationMutationDryRun
        | InvocationSource::ProtectedRecordErasure
        | InvocationSource::OperationCoverageActivation => admin,
        InvocationSource::BranchOperation => matches!(
            resolved,
            ResolvedAppAuthority::DevImpersonation {
                local_dev_only: false,
                ..
            }
        ),
        InvocationSource::ConfigVerify => matches!(resolved, ResolvedAppAuthority::Anonymous),
        InvocationSource::Cron => matches!(resolved, ResolvedAppAuthority::System),
        InvocationSource::LiveRerun => {
            allow_inherited_live_rerun
                && (ordinary
                    || (mode == AuthMode::Sessions
                        && matches!(resolved, ResolvedAppAuthority::ServicePrincipal(_))))
        }
        InvocationSource::NestedMutation => false,
    }
}

fn derived_asset_callbacks_id(kind: crate::ids::Kind, values: &[&str]) -> String {
    let mut digest = Sha256::new();
    digest.update(b"snapback.asset-callbacks.internal-carrier.v1");
    for value in values {
        digest.update((value.len() as u64).to_be_bytes());
        digest.update(value.as_bytes());
    }
    let hash = digest.finalize();
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&hash[..16]);
    crate::ids::format_id(kind, &bytes)
}

fn function_kind_matches(constraint: FunctionKindConstraint, kind: &FunctionKind) -> bool {
    match constraint {
        FunctionKindConstraint::Query => {
            matches!(kind, FunctionKind::Query | FunctionKind::LiveQuery)
        }
        FunctionKindConstraint::Mutation => matches!(kind, FunctionKind::Mutation),
        FunctionKindConstraint::Action => matches!(kind, FunctionKind::Action),
        FunctionKindConstraint::Any => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::mode::{
        AUTH_MODE_FORMAT_VERSION, AppDataAvailability, AuthModeStateRecord, AuthModeStatus,
        DeploymentIdentity, FUNCTION_V1_PREFIX, INPUTS_V1_PREFIX, SCHEMA_V1_PREFIX,
    };
    use crate::manifest::{FunctionRuntime, HandlerPlan, QueryPlan};
    use serde_json::json;

    fn function(requirement: Option<AuthRequirement>) -> FunctionDefinition {
        let mut function = FunctionDefinition::new(
            "example",
            FunctionKind::Query,
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table_visibility: None,
                table: "items".to_owned(),
                filters: Vec::new(),
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            })),
        );
        function.auth_requirement = requirement;
        function
    }

    struct CeremonySession {
        user_id: String,
        bearer: String,
    }

    fn mint_guest_session(
        database: &mut crate::storage::LocalDatabase,
        idempotency_key: &str,
        now_ms: u64,
    ) -> CeremonySession {
        use crate::auth::crypto::OsRandom;
        use crate::auth::keyring::AuthKeyringStore;
        use crate::auth::provider::{
            AuthProvider, PasswordIssuanceCustody, PlannedIssuanceCommit, ProviderGuestSessionPlan,
        };
        use crate::contract_types::AuthProviderProfile;
        use crate::storage::auth::AuthTransactionAttempt;
        use std::sync::Arc;

        let keyring = Arc::new(AuthKeyringStore::in_memory());
        keyring
            .load_or_mint_initial(now_ms, &OsRandom)
            .expect("initialize guest ceremony keyring");
        let provider = AuthProvider::new(AuthProviderProfile::Test, keyring)
            .expect("construct guest ceremony provider");
        let ProviderGuestSessionPlan::Planned(plan) = provider
            .plan_guest_session(
                database,
                now_ms,
                60_000,
                crate::auth::throttle::RollingWindowBudgetTerms {
                    limit: 10,
                    window_ms: 1_000,
                },
                idempotency_key,
                "effect-attribution-fixture",
                "effect-attribution-deployment",
                &format!("sha256:{}", "a".repeat(64)),
                PasswordIssuanceCustody::Bearer,
            )
            .expect("plan guest ceremony")
        else {
            panic!("fresh guest ceremony must produce a plan")
        };
        let commit_plan = plan.commit_plan();
        let AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed {
            session,
            committed_revocations,
        }) = provider.commit_guest_issuance(database, &commit_plan)
        else {
            panic!("guest ceremony must commit")
        };
        let issue = plan.into_issue(session, committed_revocations);
        CeremonySession {
            user_id: issue.response().session.user_id.clone(),
            bearer: issue.response().token().expose_secret().to_owned(),
        }
    }

    fn effect_attribution_fixture() -> (
        crate::storage::ServingDatabase,
        AdmissionController,
        CeremonySession,
        CeremonySession,
        CeremonySession,
    ) {
        let mut local = crate::storage::LocalDatabase::memory()
            .expect("pending-effect attribution fixture database");
        local
            .activate_current_auth_catalog()
            .expect("activate pending-effect attribution auth catalog");
        let approver_a0 = mint_guest_session(&mut local, "effect-approver-a0", 10);
        let approver_a1 = mint_guest_session(&mut local, "effect-approver-a1", 11);
        let attacker = mint_guest_session(&mut local, "effect-attacker-00", 12);
        let mut schema = crate::manifest::SchemaManifest::default();
        schema.app_id = "effect-attribution-fixture".to_owned();
        schema.api = Some(crate::contract_types::ApiManifest {
            enabled: true,
            ..crate::contract_types::ApiManifest::default()
        });
        local
            .schema_seed()
            .apply_schema(schema)
            .expect("activate pending-effect storage");
        let database = crate::storage::ServingDatabase::adopt(local)
            .expect("adopt pending-effect attribution database");
        let digest =
            |prefix: &str, marker: char| format!("{prefix}{}", marker.to_string().repeat(64));
        let mode = AuthModeStateRecord {
            format_version: AUTH_MODE_FORMAT_VERSION,
            transition_generation: 0,
            active: AuthMode::Sessions,
            desired: AuthMode::Sessions,
            mode_state: AuthModeStatus::Settled,
            app_data_availability: AppDataAvailability::Available,
            sessions_ever_activated: true,
            active_deployment: Some(DeploymentIdentity {
                schema_version: "snapback.v1".to_owned(),
                auth_mode: AuthMode::Sessions,
                app_id: "effect-attribution-fixture".to_owned(),
                schema_hash: digest(SCHEMA_V1_PREFIX, '1'),
                bundle_hash: digest(FUNCTION_V1_PREFIX, '2'),
                inputs_hash: digest(INPUTS_V1_PREFIX, '3'),
            }),
            requested_deployment: None,
            quarantine: None,
        };
        let admission =
            AdmissionController::from_mode_state_with_database_binding(&mode, database.binding())
                .expect("bind admission to the serving database");
        (database, admission, approver_a0, approver_a1, attacker)
    }

    fn create_effect_attribution_row(
        database: &mut crate::storage::ServingDatabase,
        caller_key: &str,
        approver: Option<&str>,
        now_ms: u64,
    ) -> crate::storage::pending_effects::PendingEffectRecord {
        let owner = database
            .resolve_pending_effect_owner(
                crate::storage::pending_effects::PendingEffectOwnerEvidence::Anonymous,
                now_ms,
            )
            .expect("derive anonymous pending-effect owner");
        database
            .create_pending_effect_admitted(
                &owner,
                crate::storage::pending_effects::CreatePendingEffect {
                    function_id: "fn:effectAttribution".to_owned(),
                    function_name: "effectAttribution".to_owned(),
                    function_kind: FunctionKind::Mutation,
                    args: json!({ "caller": caller_key }),
                    caller_lane: "integration".to_owned(),
                    caller_key: caller_key.to_owned(),
                    authority: crate::storage::pending_effects::PendingEffectAuthority::Anonymous,
                    generation: crate::manifest::ArtifactGeneration {
                        schema_version: "snapback.v1".to_owned(),
                        app_id: "effect-attribution-fixture".to_owned(),
                        schema_hash: "schema".to_owned(),
                        bundle_hash: "bundle".to_owned(),
                        inputs_hash: "inputs".to_owned(),
                    },
                    link_origin_id: None,
                    approver_principal_id: approver.map(str::to_owned),
                    declared_write_set: vec!["items".to_owned()],
                    now_ms,
                    ttl_ms: 60_000,
                },
            )
            .expect("create durable pending effect")
    }

    fn effect_execution_authority(admission: &AdmissionController) -> PreparedAuthority {
        InvocationGate::prepare_admitted_authority(
            InvocationSource::EffectExecution,
            AuthMode::Sessions,
            ServerProfile::Test,
            admission
                .admit_for_mode(AuthMode::Sessions)
                .expect("admit exact engine graph"),
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::Anonymous,
            None,
        )
        .expect("prepare exact anonymous original authority")
    }

    fn effect_management_authority(
        admission: &AdmissionController,
        approver: &str,
    ) -> PreparedAuthority {
        let lease = admission
            .admit_for_mode(AuthMode::Sessions)
            .expect("admit effect-management session");
        let resolved = test_session_authority_with_origin(
            approver,
            format!("session-{approver}"),
            "email-code",
            1,
            format!("authority-{approver}"),
            10_000,
            None,
            None,
            lease.origin().expect("managed database-bound admission"),
        );
        InvocationGate::prepare_admitted_authority(
            InvocationSource::EffectManagement,
            AuthMode::Sessions,
            ServerProfile::Test,
            lease,
            &WireAuthorityFields::default(),
            resolved,
            Some(AuthClaimsProjection::server_derived(Vec::new(), Vec::new())),
        )
        .expect("prepare exact effect-management authority")
    }

    #[test]
    fn pending_effect_caller_and_approver_attribution_refuses_crossed_rows() {
        let (mut database, admission, session_a0, session_a1, attacker) =
            effect_attribution_fixture();
        let effect_c0 = create_effect_attribution_row(
            &mut database,
            "caller-C0",
            Some(&session_a0.user_id),
            100,
        );
        let effect_c1 = create_effect_attribution_row(
            &mut database,
            "caller-C1",
            Some(&session_a1.user_id),
            101,
        );
        let owner_a0 = database
            .resolve_pending_effect_owner(
                crate::storage::pending_effects::PendingEffectOwnerEvidence::Session(
                    crate::auth::crypto::SessionBearer::parse_any_version(&session_a0.bearer)
                        .expect("A0 ceremony bearer"),
                ),
                110,
            )
            .expect("derive A0 approval owner");
        let owner_a1 = database
            .resolve_pending_effect_owner(
                crate::storage::pending_effects::PendingEffectOwnerEvidence::Session(
                    crate::auth::crypto::SessionBearer::parse_any_version(&session_a1.bearer)
                        .expect("A1 ceremony bearer"),
                ),
                110,
            )
            .expect("derive A1 approval owner");
        let prepared_c0_a0 = database
            .prepare_pending_effect_approval(&owner_a0, &effect_c0.id, 110)
            .expect("prepare C0/A0");
        let prepared_c1_a1 = database
            .prepare_pending_effect_approval(&owner_a1, &effect_c1.id, 110)
            .expect("prepare C1/A1");
        let authority = effect_execution_authority(&admission);
        let approver_a0 = effect_management_authority(&admission, &session_a0.user_id)
            .prepare_effect_approver_attribution()
            .expect("derive A0 from its approving authority");
        let approver_a1 = effect_management_authority(&admission, &session_a1.user_id)
            .prepare_effect_approver_attribution()
            .expect("derive A1 from its approving authority");

        let crossed_approver = authority
            .clone()
            .with_effect_caller_attribution(prepared_c0_a0.effect(), &approver_a1)
            .expect_err("C0/A0's row must refuse unrelated A1");
        assert_eq!(
            crossed_approver.diagnostic.code,
            "SNAPBACK_INVOCATION_AUTHORITY_INVALID"
        );
        let crossed_other_row = authority
            .clone()
            .with_effect_caller_attribution(prepared_c1_a1.effect(), &approver_a0)
            .expect_err("C1/A1's row must refuse unrelated A0");
        assert_eq!(
            crossed_other_row.diagnostic.code,
            "SNAPBACK_INVOCATION_AUTHORITY_INVALID"
        );

        let unbound_read = database
            .pending_effect(&effect_c0.id, 111)
            .expect("ordinary read DTO");
        let unbound = authority
            .clone()
            .with_effect_caller_attribution(&unbound_read, &approver_a0)
            .expect_err("a read DTO is not a prepared approval capability");
        assert_eq!(
            unbound.diagnostic.code,
            "SNAPBACK_INVOCATION_AUTHORITY_INVALID"
        );

        let legitimate = authority
            .clone()
            .with_effect_caller_attribution(prepared_c0_a0.effect(), &approver_a0)
            .expect("refused crossed attempts must not poison C0/A0");
        assert_eq!(
            legitimate.telemetry_caller_details().unwrap(),
            json!({
                "callerLane": "integration",
                "callerKey": "caller-C0",
                "approverKey": session_a0.user_id,
            })
        );

        let (mut foreign_database, foreign_admission, foreign_a0, _, _) =
            effect_attribution_fixture();
        let foreign_effect = create_effect_attribution_row(
            &mut foreign_database,
            "caller-C0",
            Some(&foreign_a0.user_id),
            100,
        );
        let foreign_owner = foreign_database
            .resolve_pending_effect_owner(
                crate::storage::pending_effects::PendingEffectOwnerEvidence::Session(
                    crate::auth::crypto::SessionBearer::parse_any_version(&foreign_a0.bearer)
                        .expect("foreign A0 ceremony bearer"),
                ),
                110,
            )
            .expect("derive foreign A0 approval owner");
        let foreign_approval = foreign_database
            .prepare_pending_effect_approval(&foreign_owner, &foreign_effect.id, 110)
            .expect("prepare same-shaped row in another database");
        let foreign_error = authority
            .with_effect_caller_attribution(foreign_approval.effect(), &approver_a0)
            .expect_err("same-shaped foreign row must not cross engine graphs");
        assert_eq!(
            foreign_error.diagnostic.code,
            "SNAPBACK_INVOCATION_AUTHORITY_INVALID"
        );

        // Denial inversion: a fresh authority from the foreign graph still
        // accepts that graph's legitimate pair after the cross-graph refusal.
        let foreign_approver = effect_management_authority(&foreign_admission, &foreign_a0.user_id)
            .prepare_effect_approver_attribution()
            .expect("derive foreign A0 authority");
        effect_execution_authority(&foreign_admission)
            .with_effect_caller_attribution(foreign_approval.effect(), &foreign_approver)
            .expect("foreign graph remains usable by its legitimate authority");

        // Adapt the original public two-call attack instead of merely proving
        // the old string parameter disappeared. A genuinely resolved but
        // unrelated session may approve an unrestricted row, but the final
        // consumer still refuses to attribute it to A0.
        let unrestricted = create_effect_attribution_row(&mut database, "caller-open", None, 120);
        let attacker_owner = database
            .resolve_pending_effect_owner(
                crate::storage::pending_effects::PendingEffectOwnerEvidence::Session(
                    crate::auth::crypto::SessionBearer::parse_any_version(&attacker.bearer)
                        .expect("attacker ceremony bearer"),
                ),
                121,
            )
            .expect("derive unrelated approval owner");
        let forged = database
            .prepare_pending_effect_approval(&attacker_owner, &unrestricted.id, 121)
            .expect("unrestricted row admits the genuinely resolved session");
        let adapted_attack = effect_execution_authority(&admission)
            .with_effect_caller_attribution(forged.effect(), &approver_a0)
            .expect_err("caller-supplied storage binding is not approver authority");
        assert_eq!(
            adapted_attack.diagnostic.code,
            "SNAPBACK_INVOCATION_AUTHORITY_INVALID"
        );
    }

    fn prepared(authority: ResolvedAppAuthority) -> PreparedAuthority {
        InvocationGate::prepare_authority(
            InvocationSource::LocalQuery,
            AuthMode::Dev,
            ServerProfile::Test,
            0,
            0,
            &WireAuthorityFields::default(),
            authority,
        )
        .unwrap()
    }

    #[test]
    fn claims_are_required_at_the_authority_projection_chokepoint() {
        let session = test_session_authority(
            "user-1",
            "session-1",
            "email-code",
            1,
            "authority-1",
            10_000,
            None,
            None,
        );
        let projection = HandlerAuthProjection::from_authority(
            &session,
            Some(AuthClaimsProjection::server_derived(Vec::new(), Vec::new())),
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(&projection).unwrap()["claims"],
            json!({ "identities": [], "assurances": [] })
        );

        assert_eq!(
            HandlerAuthProjection::from_authority(
                &ResolvedAppAuthority::Anonymous,
                Some(AuthClaimsProjection::server_derived(Vec::new(), Vec::new())),
            )
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_CLAIMS_AUTHORITY_INVALID"
        );
        assert_eq!(
            HandlerAuthProjection::from_authority(&session, None)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_CLAIMS_AUTHORITY_INVALID"
        );
    }

    #[test]
    fn wire_presence_preserves_explicit_null_without_scanning_args() {
        let fields = WireAuthorityFields::inspect_handler(&json!({
            "auth": null,
            "ctx_ledger": { "auth_fingerprint": null },
            "args": { "auth": { "user_id": "ordinary-data" } }
        }));
        assert_eq!(
            fields.presence(WireAuthorityLocation::HandlerAuth),
            WireFieldPresence::PresentNull
        );
        assert_eq!(
            fields.presence(WireAuthorityLocation::CtxLedgerAuthFingerprint),
            WireFieldPresence::PresentNull
        );
        assert_eq!(
            fields.presence(WireAuthorityLocation::HandlerAuthUserId),
            WireFieldPresence::Absent
        );
    }

    #[test]
    fn suspended_integration_is_refused_at_the_shared_invocation_gate() {
        let function = function(Some(AuthRequirement::Authenticated));
        let service = |status| {
            InvocationGate::prepare_authority(
                InvocationSource::LiveInitialQuery,
                AuthMode::Sessions,
                ServerProfile::Test,
                0,
                0,
                &WireAuthorityFields::default(),
                test_service_authority(
                    "integration-1",
                    "credential-1",
                    1,
                    "grant-1",
                    "token-1",
                    Some("user-1".to_owned()),
                    vec![ResolvedGrantScope {
                        function_id: function.id.clone(),
                        kind: FunctionKind::Query,
                        basis: 0,
                        authority_creating: false,
                    }],
                    10_000,
                    Some(status),
                ),
            )
            .unwrap()
        };
        let error = evaluate_function_policy(
            &service(crate::storage::auth_integrations::IntegrationStatus::Suspended),
            &function,
        )
        .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_INTEGRATION_SUSPENDED");
        assert!(error.diagnostic.message.contains("suspended"));
        assert!(!error.diagnostic.message.contains("revok"));
        evaluate_function_policy(
            &service(crate::storage::auth_integrations::IntegrationStatus::Active),
            &function,
        )
        .expect("active integration reaches the ordinary function checks");
    }

    #[test]
    fn classified_function_policy_preserves_intervening_epoch_retirement() {
        let controller = AdmissionController::new(1, true).expect("dev admission controller");
        let authority = InvocationGate::prepare_admitted_authority(
            InvocationSource::LocalQuery,
            AuthMode::Dev,
            ServerProfile::Test,
            controller.admit_dev().expect("admit classified query"),
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::Anonymous,
            None,
        )
        .expect("prepare classified query authority");
        let retire = controller.clone();
        install_classified_admission_hook_for_test(0, move || {
            retire
                .fail_closed_after_uncertain_commit()
                .expect("retire admission between classified policy checks");
        });

        let error = match InvocationGate::prepare_function_classified(authority, &function(None)) {
            Ok(_) => panic!("the repeated policy check must observe the retired epoch"),
            Err(error) => error,
        };
        assert!(matches!(
            error,
            AuthorizedEffectReservationError::Terminal(
                CallerAuthorityTerminalCause::AdmissionEpochRetired { .. }
            )
        ));
    }

    #[test]
    fn sessions_rejects_present_null_before_authority_projection() {
        let fields = WireAuthorityFields::inspect_handler(&json!({ "auth": null }));
        let error = InvocationGate::prepare_authority(
            InvocationSource::HttpQuery,
            AuthMode::Sessions,
            ServerProfile::Test,
            7,
            9,
            &fields,
            ResolvedAppAuthority::Anonymous,
        )
        .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED");
    }

    #[test]
    fn live_and_ephemeral_inspectors_cover_nested_and_sibling_authority() {
        let live = WireAuthorityFields::inspect_live_owner(&json!({
            "auth": { "user_id": "legacy" }
        }));
        assert_eq!(
            live.first_present(),
            Some(WireAuthorityLocation::LiveOwnerAuth)
        );

        let ephemeral = WireAuthorityFields::inspect_ephemeral(&json!({
            "auth": {},
            "session_id": null,
            "customKey": "legacy"
        }));
        assert_eq!(
            ephemeral.presence(WireAuthorityLocation::EphemeralAuth),
            WireFieldPresence::PresentValue
        );
        assert_eq!(
            ephemeral.presence(WireAuthorityLocation::EphemeralSessionId),
            WireFieldPresence::PresentNull
        );
        assert_eq!(
            ephemeral.presence(WireAuthorityLocation::EphemeralCustomKey),
            WireFieldPresence::PresentValue
        );
    }

    #[test]
    fn requirement_matrix_is_closed_and_admin_bypass_is_not_a_user() {
        for requirement in [
            None,
            Some(AuthRequirement::Public),
            Some(AuthRequirement::OptionalUser),
        ] {
            InvocationGate::prepare_function(
                prepared(ResolvedAppAuthority::Anonymous),
                &function(requirement),
            )
            .unwrap();
        }
        let error = InvocationGate::prepare_function(
            InvocationGate::prepare_authority(
                InvocationSource::DirectAdminRunner,
                AuthMode::Sessions,
                ServerProfile::Test,
                0,
                0,
                &WireAuthorityFields::default(),
                ResolvedAppAuthority::AdminBypass {
                    reason: "direct runner".to_owned(),
                },
            )
            .unwrap(),
            &function(Some(AuthRequirement::Authenticated)),
        )
        .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_REQUIRED");

        InvocationGate::prepare_function(
            prepared(ResolvedAppAuthority::DevImpersonation {
                user_id: "user_1".to_owned(),
                roles: Vec::new(),
                local_dev_only: true,
            }),
            &function(Some(AuthRequirement::Authenticated)),
        )
        .unwrap();
    }

    #[test]
    fn projections_expose_only_the_exact_authority_shape() {
        let anonymous = serde_json::to_value(
            HandlerAuthProjection::from_authority(&ResolvedAppAuthority::Anonymous, None).unwrap(),
        )
        .unwrap();
        assert_eq!(
            anonymous,
            json!({
                "userId": null,
                "sessionId": null,
                "isAuthenticated": false
            })
        );

        let session = serde_json::to_value(
            HandlerAuthProjection::from_authority(
                &test_session_authority(
                    "user_1",
                    "session_1",
                    "email-code",
                    3,
                    "authority_1",
                    10_000,
                    None,
                    None,
                ),
                Some(AuthClaimsProjection::server_derived(Vec::new(), Vec::new())),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            session,
            json!({
                "userId": "user_1",
                "sessionId": "session_1",
                "isAuthenticated": true,
                "provider": "email-code",
                "roles": [],
                "kind": "human",
                "claims": { "identities": [], "assurances": [] }
            })
        );

        let autonomous = serde_json::to_value(
            HandlerAuthProjection::from_authority(
                &test_service_authority(
                    "agent_1",
                    "credential_1",
                    2,
                    "grant_1",
                    "token_1",
                    None,
                    Vec::new(),
                    20_000,
                    None,
                ),
                None,
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            autonomous,
            json!({
                "userId": "agent_1",
                "sessionId": null,
                "isAuthenticated": true,
                "provider": "agent-credential",
                "roles": [],
                "kind": "agent"
            })
        );

        let delegated = serde_json::to_value(
            HandlerAuthProjection::from_authority(
                &test_service_authority(
                    "agent_1",
                    "credential_1",
                    2,
                    "grant_1",
                    "token_1",
                    Some("user_1".to_owned()),
                    Vec::new(),
                    20_000,
                    None,
                ),
                None,
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            delegated,
            json!({
                "userId": "user_1",
                "sessionId": null,
                "isAuthenticated": true,
                "provider": "agent-credential",
                "roles": [],
                "kind": "human",
                "actor": {
                    "userId": "agent_1",
                    "kind": "agent",
                    "grantId": "grant_1"
                }
            })
        );
    }

    #[test]
    fn asset_callbacks_projection_names_the_noninteractive_actor_kind() {
        assert_eq!(
            serde_json::to_value(HandlerAuthProjection::for_asset_callbacks_actor(
                "usr_asset_callbacks",
            ))
            .unwrap(),
            json!({
                "userId": "usr_asset_callbacks",
                "sessionId": null,
                "isAuthenticated": true,
                "provider": "snapback-service-principal",
                "roles": [],
                "kind": "agent",
                "actorKind": "asset-callbacks"
            })
        );
    }

    #[test]
    fn function_attribution_exists_only_after_service_principal_resolution() {
        let authority = InvocationGate::prepare_authority(
            InvocationSource::HttpQuery,
            AuthMode::Sessions,
            ServerProfile::Test,
            0,
            0,
            &WireAuthorityFields::default(),
            test_service_authority(
                "agent_1",
                "credential_1",
                2,
                "grant_1",
                "token_1",
                Some("user_1".to_owned()),
                Vec::new(),
                20_000,
                None,
            ),
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(authority.function_attribution()).unwrap(),
            json!({
                "actorUserId": "agent_1",
                "effectiveUserId": "user_1",
                "grantId": "grant_1",
                "dryRun": false
            })
        );
        assert!(
            prepared(ResolvedAppAuthority::DevImpersonation {
                user_id: "user_1".to_owned(),
                roles: Vec::new(),
                local_dev_only: true,
            })
            .function_attribution()
            .is_none()
        );
    }

    #[test]
    fn delegated_authority_has_exact_direct_non_widening_baseline() {
        let authority = InvocationGate::prepare_authority(
            InvocationSource::HttpQuery,
            AuthMode::Sessions,
            ServerProfile::Test,
            0,
            0,
            &WireAuthorityFields::default(),
            test_service_authority(
                "agent_1",
                "credential_1",
                2,
                "grant_1",
                "token_1",
                Some("user_1".to_owned()),
                Vec::new(),
                20_000,
                None,
            ),
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(authority.direct_authorization_projection()).unwrap(),
            json!({
                "userId": "user_1",
                "isAuthenticated": true,
                "roles": [],
                "kind": "human"
            })
        );
        let canonical = authority.canonical_auth_input();
        assert_eq!(canonical.user_id.as_deref(), Some("user_1"));
        assert_eq!(canonical.authorization_kind.as_deref(), Some("human"));
        assert_eq!(canonical.authorization_actor_kind.as_deref(), Some("agent"));
        assert!(canonical.authorization_is_delegated);
        assert_eq!(authority.projection().session_id(), None);
        assert_eq!(
            serde_json::to_value(authority.projection()).unwrap()["actor"]["userId"],
            "agent_1",
            "the once-run handler still sees delegated attribution"
        );

        let autonomous = InvocationGate::prepare_authority(
            InvocationSource::HttpQuery,
            AuthMode::Sessions,
            ServerProfile::Test,
            0,
            0,
            &WireAuthorityFields::default(),
            test_service_authority(
                "agent_1",
                "credential_1",
                2,
                "grant_1",
                "token_1",
                None,
                Vec::new(),
                20_000,
                None,
            ),
        )
        .unwrap();
        assert!(autonomous.direct_authorization_projection().is_none());
    }

    // @ref LLP 0065#2-the-v1-visibility-floor — profile-class admission:
    //   generated standard patterns admit only principals that project the
    //   canonical user subject. The gate order is pinned — grant scope and
    //   authentication first, profile class last — and the refusal is
    //   reserved for authenticated-but-ineligible principals.
    #[test]
    fn standard_pattern_profile_class_admits_only_user_subjects() {
        let mut pattern = function(Some(AuthRequirement::Authenticated));
        pattern.standard_pattern = Some(crate::manifest::StandardPatternIdentity {
            helper: "owned-crud.v1".to_owned(),
            profile: "owner.v1".to_owned(),
            membership: None,
        });
        let scope = |function: &FunctionDefinition| ResolvedGrantScope {
            function_id: function.id.clone(),
            kind: function.kind.clone(),
            basis: 0,
            authority_creating: false,
        };
        let service = |effective: Option<&str>, scoped: &FunctionDefinition| {
            test_service_authority(
                "agent_1",
                "credential_1",
                1,
                "grant_1",
                "token_1",
                effective.map(str::to_owned),
                vec![scope(scoped)],
                20_000,
                None,
            )
        };
        let prepare = |resolved| {
            InvocationGate::prepare_authority(
                InvocationSource::HttpQuery,
                AuthMode::Sessions,
                ServerProfile::Test,
                1,
                1,
                &WireAuthorityFields::default(),
                resolved,
            )
            .unwrap()
        };

        // A delegated agent resolves to the delegating user's subject.
        InvocationGate::prepare_function(prepare(service(Some("user_1"), &pattern)), &pattern)
            .unwrap();
        // A bare service principal / autonomous agent is authenticated but
        // projects no user subject: refused by profile-class admission,
        // after the scope and authentication gates.
        let refused = InvocationGate::prepare_function(prepare(service(None, &pattern)), &pattern)
            .unwrap_err();
        assert_eq!(
            refused.diagnostic.code,
            "SNAPBACK_STANDARD_PATTERN_PRINCIPAL_UNSUPPORTED"
        );
        // Signed-in users are unaffected.
        InvocationGate::prepare_function(
            prepared(ResolvedAppAuthority::DevImpersonation {
                user_id: "user_1".to_owned(),
                roles: Vec::new(),
                local_dev_only: true,
            }),
            &pattern,
        )
        .unwrap();
        // The same subject-less principal still runs a non-pattern function:
        // the refusal is scoped to the generated profile, not the principal.
        let plain = function(Some(AuthRequirement::Authenticated));
        InvocationGate::prepare_function(prepare(service(None, &plain)), &plain).unwrap();
    }

    #[test]
    fn service_principal_scope_is_checked_before_function_preparation() {
        let function = function(Some(AuthRequirement::Authenticated));
        let service = |scopes| {
            test_service_authority(
                "agent_1",
                "credential_1",
                1,
                "grant_1",
                "token_1",
                Some("user_1".to_owned()),
                scopes,
                20_000,
                None,
            )
        };
        let prepare = |resolved| {
            InvocationGate::prepare_authority(
                InvocationSource::HttpQuery,
                AuthMode::Sessions,
                ServerProfile::Test,
                1,
                1,
                &WireAuthorityFields::default(),
                resolved,
            )
            .unwrap()
        };

        InvocationGate::prepare_function(
            prepare(service(vec![ResolvedGrantScope {
                function_id: function.id.clone(),
                kind: function.kind.clone(),
                basis: 0,
                authority_creating: false,
            }])),
            &function,
        )
        .unwrap();

        let denied =
            InvocationGate::prepare_function(prepare(service(Vec::new())), &function).unwrap_err();
        assert_eq!(denied.diagnostic.code, "SNAPBACK_AUTH_GRANT_SCOPE_DENIED");
        assert_eq!(denied.diagnostic.details["reason"], "missing_scope");
        assert_eq!(denied.diagnostic.details["functionId"], function.id);
        assert_eq!(
            denied.diagnostic.details["missingScope"]["functionId"],
            function.id
        );
        assert_eq!(denied.diagnostic.details["missingScope"]["kind"], "query");
        let remediation = &denied.diagnostic.details["remediationSet"];
        assert_eq!(
            remediation["items"][0]["kind"],
            crate::remediation::RemediationKindV1::RequestGrant.as_str()
        );
        assert_eq!(remediation["items"][0]["machineApplicable"], false);
        assert_eq!(remediation["items"][0]["requiresApproval"], true);
        assert_eq!(
            remediation["items"][0]["action"]["grantableScope"],
            format!("function:query:{}", function.id)
        );

        let mut marked = function.clone();
        marked.authority_creating = true;
        let unconsented = InvocationGate::prepare_function(
            prepare(service(vec![ResolvedGrantScope {
                function_id: marked.id.clone(),
                kind: marked.kind.clone(),
                basis: 0,
                authority_creating: false,
            }])),
            &marked,
        )
        .unwrap_err();
        assert_eq!(
            unconsented.diagnostic.code,
            "SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED"
        );
        assert_eq!(
            unconsented.diagnostic.details["reason"],
            "scope_not_authority_creating"
        );

        let consented = InvocationGate::prepare_function(
            prepare(service(vec![ResolvedGrantScope {
                function_id: marked.id.clone(),
                kind: marked.kind.clone(),
                basis: 0,
                authority_creating: true,
            }])),
            &marked,
        )
        .unwrap();
        assert!(consented.authority_creating_consent());
    }

    #[test]
    fn api_exposure_gate_covers_finite_live_rerun_and_nested_service_invocations() {
        let mut exposed_query = function(Some(AuthRequirement::Authenticated));
        exposed_query.api_exposure = Some(crate::manifest::ApiFunctionExposure {
            expose: true,
            since: None,
            approval: None,
        });
        let mut closed_query = exposed_query.clone();
        closed_query.name = "closedQuery".to_owned();
        closed_query.id = "fn:closedQuery".to_owned();
        closed_query.api_exposure = Some(crate::manifest::ApiFunctionExposure::default());
        let mut exposed_mutation = FunctionDefinition::new(
            "exposedMutation",
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(crate::manifest::MutationPlan {
                owner_write_checks: Vec::new(),
                steps: Vec::new(),
                return_value: None,
            })),
        );
        exposed_mutation.auth_requirement = Some(AuthRequirement::Authenticated);
        exposed_mutation.api_exposure = Some(crate::manifest::ApiFunctionExposure {
            expose: true,
            since: None,
            approval: None,
        });
        let mut closed_mutation = exposed_mutation.clone();
        closed_mutation.name = "closedMutation".to_owned();
        closed_mutation.id = "fn:closedMutation".to_owned();
        closed_mutation.auth_requirement = Some(AuthRequirement::Authenticated);
        closed_mutation.api_exposure = Some(crate::manifest::ApiFunctionExposure::default());

        let scopes = [
            &exposed_query,
            &closed_query,
            &exposed_mutation,
            &closed_mutation,
        ]
        .into_iter()
        .map(|function| ResolvedGrantScope {
            function_id: function.id.clone(),
            kind: function.kind.clone(),
            basis: 0,
            authority_creating: false,
        })
        .collect::<Vec<_>>();
        let service = test_service_authority(
            "agent_1",
            "credential_1",
            1,
            "grant_1",
            "token_1",
            Some("user_1".to_owned()),
            scopes,
            20_000,
            None,
        );
        let prepare = |source| {
            InvocationGate::prepare_authority(
                source,
                AuthMode::Sessions,
                ServerProfile::Test,
                1,
                1,
                &WireAuthorityFields::default(),
                service.clone(),
            )
            .unwrap()
        };

        for source in [
            InvocationSource::HttpQuery,
            InvocationSource::LiveInitialQuery,
        ] {
            InvocationGate::prepare_function(prepare(source), &exposed_query)
                .expect("an exposed, granted finite or initial-live query succeeds");
        }
        for source in [
            InvocationSource::HttpQuery,
            InvocationSource::LiveInitialQuery,
        ] {
            let error = InvocationGate::prepare_function(prepare(source), &closed_query)
                .expect_err("unexposed service query refuses");
            assert_eq!(error.diagnostic.code, "SNAPBACK_API_EXPOSURE_DENIED");
        }

        let live = prepare(InvocationSource::LiveInitialQuery)
            .inherit_for(InvocationSource::LiveRerun)
            .unwrap();
        InvocationGate::prepare_function(live.clone(), &exposed_query)
            .expect("an exposed, granted live rerun succeeds");
        assert_eq!(
            InvocationGate::prepare_function(live, &closed_query)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_API_EXPOSURE_DENIED"
        );

        let nested = prepare(InvocationSource::HttpQuery)
            .inherit_for(InvocationSource::NestedMutation)
            .unwrap();
        InvocationGate::prepare_function(nested.clone(), &exposed_mutation)
            .expect("an exposed, granted nested mutation succeeds");
        assert_eq!(
            InvocationGate::prepare_function(nested, &closed_mutation)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_API_EXPOSURE_DENIED"
        );
    }

    #[test]
    fn nested_authority_is_inherited_and_nested_wire_input_cannot_replace_it() {
        let outer = InvocationGate::prepare_function(
            prepared(ResolvedAppAuthority::DevImpersonation {
                user_id: "outer".to_owned(),
                roles: vec!["writer".to_owned()],
                local_dev_only: true,
            }),
            &function(Some(AuthRequirement::Authenticated)),
        )
        .unwrap();
        let nested_authority = outer
            .inherit_authority_for(InvocationSource::NestedMutation)
            .unwrap();
        assert_eq!(nested_authority.resolved(), outer.authority().resolved());

        let session = test_session_authority(
            "nested-user",
            "nested-session",
            "email-code",
            1,
            "nested-authority",
            10_000,
            None,
            None,
        );
        let outer = InvocationGate::prepare_function(
            InvocationGate::prepare_authority(
                InvocationSource::HttpQuery,
                AuthMode::Sessions,
                ServerProfile::Test,
                0,
                0,
                &WireAuthorityFields::default(),
                session,
            )
            .unwrap(),
            &function(Some(AuthRequirement::Authenticated)),
        )
        .unwrap();
        let nested = outer
            .inherit_authority_for(InvocationSource::NestedMutation)
            .expect("nested mutation inherits the prepared session projection");
        assert!(
            serde_json::to_value(nested.projection()).unwrap()["claims"].is_object(),
            "nested invocation must preserve claims rather than re-project authority"
        );
    }

    #[test]
    fn prepared_invocation_carries_refusal_tracking_authority() {
        let mut declared = function(None);
        declared.refusals = vec!["INVITE_CONSUMED".to_owned(), "STALE_MOVE".to_owned()];
        declared.tracked_refusals = vec!["STALE_MOVE".to_owned()];

        let prepared =
            InvocationGate::prepare_function(prepared(ResolvedAppAuthority::Anonymous), &declared)
                .expect("valid refusal tracking authority prepares");
        assert_eq!(prepared.declared_refusals(), declared.refusals);
        assert_eq!(prepared.tracked_refusals(), declared.tracked_refusals);
    }

    #[test]
    fn source_registry_has_no_unclassified_entry() {
        for source in InvocationSource::ALL {
            let _ = source.target();
        }
    }

    #[test]
    fn revalidated_principal_cannot_be_reprepared_under_a_foreign_lease() {
        let resolved = test_revalidated_authority("user", "watch-authority");
        let foreign = test_admission_controller(AuthMode::Sessions, 0)
            .expect("foreign sessions admission controller");
        let error = InvocationGate::prepare_admitted_authority(
            InvocationSource::WatchEvaluation,
            AuthMode::Sessions,
            ServerProfile::Test,
            foreign
                .admit_for_mode(AuthMode::Sessions)
                .expect("foreign sessions admission"),
            &WireAuthorityFields::default(),
            resolved,
            None,
        )
        .expect_err("watch subject and lease must share one authority graph");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_POLICY_UNAVAILABLE");
    }

    #[test]
    fn config_verify_source_rejects_system_authority_in_every_mode() {
        for mode in [AuthMode::Dev, AuthMode::Sessions] {
            InvocationGate::prepare_authority(
                InvocationSource::ConfigVerify,
                mode,
                ServerProfile::Test,
                0,
                0,
                &WireAuthorityFields::default(),
                ResolvedAppAuthority::Anonymous,
            )
            .expect("config verify admits only its powerless authority");
            let error = InvocationGate::prepare_authority(
                InvocationSource::ConfigVerify,
                mode,
                ServerProfile::Test,
                0,
                0,
                &WireAuthorityFields::default(),
                ResolvedAppAuthority::System,
            )
            .expect_err("config verify must never obtain System authority");
            assert_eq!(error.diagnostic.code, "SNAPBACK_INVOCATION_SOURCE_INVALID");
        }
    }

    #[test]
    fn source_mode_authority_matrix_is_closed_and_exhaustive() {
        #[derive(Clone, Copy, Debug)]
        enum Kind {
            Anonymous,
            Session,
            Watch,
            Service,
            Dev,
            Branch,
            Admin,
            System,
        }
        let authority = |kind| match kind {
            Kind::Anonymous => ResolvedAppAuthority::Anonymous,
            Kind::Session => test_session_authority(
                "user",
                "session",
                "email-code",
                1,
                "authority",
                10_000,
                None,
                None,
            ),
            Kind::Watch => test_revalidated_authority("user", "watch-authority"),
            Kind::Service => test_service_authority(
                "agent",
                "credential",
                1,
                "grant",
                "token",
                Some("user".to_owned()),
                Vec::new(),
                10_000,
                None,
            ),
            Kind::Dev => ResolvedAppAuthority::DevImpersonation {
                user_id: "dev".to_owned(),
                roles: Vec::new(),
                local_dev_only: true,
            },
            Kind::Branch => ResolvedAppAuthority::DevImpersonation {
                user_id: "branch-principal".to_owned(),
                roles: Vec::new(),
                local_dev_only: false,
            },
            Kind::Admin => ResolvedAppAuthority::AdminBypass {
                reason: "operator".to_owned(),
            },
            Kind::System => ResolvedAppAuthority::System,
        };
        let expected = |source, mode, kind| {
            let ordinary = matches!(
                (mode, kind),
                (AuthMode::Dev, Kind::Anonymous | Kind::Dev)
                    | (AuthMode::Sessions, Kind::Anonymous | Kind::Session)
            );
            let admin = matches!(
                (mode, kind),
                (AuthMode::Dev, Kind::Anonymous | Kind::Dev) | (AuthMode::Sessions, Kind::Admin)
            );
            match source {
                InvocationSource::BootstrapHandshake => matches!(
                    (mode, kind),
                    (AuthMode::Dev, Kind::Anonymous)
                        | (
                            AuthMode::Sessions,
                            Kind::Anonymous | Kind::Session | Kind::Service
                        )
                ),
                InvocationSource::AuthRefresh
                | InvocationSource::AuthLogout
                | InvocationSource::AgentGrantManagement
                | InvocationSource::CapabilityLinkManagement
                | InvocationSource::EffectManagement
                | InvocationSource::PushTokenRegistry => {
                    mode == AuthMode::Sessions && matches!(kind, Kind::Session)
                }
                InvocationSource::WatchManagement => {
                    matches!(
                        (mode, kind),
                        (AuthMode::Sessions, Kind::Session | Kind::Service)
                    )
                }
                InvocationSource::HttpQuery
                | InvocationSource::HttpMutation
                | InvocationSource::HttpAction
                | InvocationSource::HttpRun
                | InvocationSource::HttpAsk
                | InvocationSource::HttpMcp => {
                    ordinary || matches!((mode, kind), (AuthMode::Sessions, Kind::Service))
                }
                InvocationSource::EffectExecution => {
                    ordinary || matches!((mode, kind), (AuthMode::Sessions, Kind::Service))
                }
                InvocationSource::HttpCapabilityLink => matches!(kind, Kind::Anonymous),
                InvocationSource::WatchEvaluation | InvocationSource::WatchReaction => {
                    mode == AuthMode::Sessions && matches!(kind, Kind::Watch)
                }
                InvocationSource::ConnectionOpen => {
                    ordinary || matches!((mode, kind), (AuthMode::Sessions, Kind::Service))
                }
                InvocationSource::LiveInitialQuery
                | InvocationSource::MutationSettlementAcknowledgement
                | InvocationSource::InvalidationAcknowledgement
                | InvocationSource::AssetTransfer
                | InvocationSource::ConnectionClose
                | InvocationSource::LiveResume
                | InvocationSource::LiveUnsubscribe
                | InvocationSource::LiveSupersede
                | InvocationSource::LiveStream
                | InvocationSource::OutboxDrain => {
                    ordinary || matches!((mode, kind), (AuthMode::Sessions, Kind::Service))
                }
                InvocationSource::EphemeralRegister
                | InvocationSource::EphemeralPublish
                | InvocationSource::EphemeralDelete
                | InvocationSource::EphemeralSubscribe
                | InvocationSource::EphemeralUnsubscribe => ordinary,
                InvocationSource::LocalQuery
                | InvocationSource::LocalMutation
                | InvocationSource::LocalAction => mode == AuthMode::Dev && ordinary,
                InvocationSource::AssetCallback => match mode {
                    AuthMode::Dev => ordinary,
                    AuthMode::Sessions => matches!(kind, Kind::Service),
                },
                InvocationSource::DirectAdminRunner
                | InvocationSource::OperatorCommand
                | InvocationSource::HostOperationFunctionRun
                | InvocationSource::HostOperationMutationDryRun
                | InvocationSource::ProtectedRecordErasure
                | InvocationSource::OperationCoverageActivation => admin,
                InvocationSource::BranchOperation => matches!(kind, Kind::Branch),
                InvocationSource::ConfigVerify => matches!(kind, Kind::Anonymous),
                InvocationSource::Cron => matches!(kind, Kind::System),
                InvocationSource::NestedMutation | InvocationSource::LiveRerun => false,
            }
        };

        for source in InvocationSource::ALL {
            for mode in [AuthMode::Dev, AuthMode::Sessions] {
                for kind in [
                    Kind::Anonymous,
                    Kind::Session,
                    Kind::Watch,
                    Kind::Service,
                    Kind::Dev,
                    Kind::Branch,
                    Kind::Admin,
                    Kind::System,
                ] {
                    let result = InvocationGate::prepare_authority(
                        source,
                        mode,
                        ServerProfile::Test,
                        0,
                        0,
                        &WireAuthorityFields::default(),
                        authority(kind),
                    );
                    assert_eq!(
                        result.is_ok(),
                        expected(source, mode, kind),
                        "unexpected compatibility for {source:?} in {mode:?}"
                    );
                    match result {
                        Ok(prepared) => {
                            let projection = serde_json::to_value(prepared.projection()).unwrap();
                            if matches!(kind, Kind::Session) {
                                assert_eq!(
                                    projection["claims"],
                                    json!({ "identities": [], "assurances": [] }),
                                    "every admitted session source must cross the claims projection chokepoint: {source:?}",
                                );
                            } else {
                                assert!(
                                    projection.get("claims").is_none(),
                                    "non-session authority must never project claims: {source:?} {kind:?}",
                                );
                            }
                        }
                        Err(error) => {
                            let expected_code = if mode == AuthMode::Dev
                                && matches!(kind, Kind::Session | Kind::Watch | Kind::Service)
                            {
                                "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
                            } else {
                                "SNAPBACK_INVOCATION_SOURCE_INVALID"
                            };
                            assert_eq!(
                                error.diagnostic.code, expected_code,
                                "unexpected refusal for {source:?} in {mode:?} with {kind:?}",
                            );
                        }
                    }
                }
            }
        }

        let error = InvocationGate::prepare_authority(
            InvocationSource::HttpQuery,
            AuthMode::Dev,
            ServerProfile::Test,
            0,
            0,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::DevImpersonation {
                user_id: "dev".to_owned(),
                roles: Vec::new(),
                local_dev_only: false,
            },
        )
        .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_INVOCATION_SOURCE_INVALID");
    }

    #[test]
    fn sessions_live_rerun_requires_an_inherited_retained_owner() {
        let resolved = test_session_authority(
            "user",
            "session",
            "email-code",
            1,
            "authority",
            10_000,
            None,
            None,
        );
        let initial = InvocationGate::prepare_authority(
            InvocationSource::LiveInitialQuery,
            AuthMode::Sessions,
            ServerProfile::Test,
            7,
            9,
            &WireAuthorityFields::default(),
            resolved.clone(),
        )
        .unwrap();
        let retained = initial.retain_live_owner().unwrap();
        let rerun = retained
            .prepare_rerun(Some(AuthClaimsProjection::server_derived(
                Vec::new(),
                Vec::new(),
            )))
            .unwrap();
        assert_eq!(rerun.source(), InvocationSource::LiveRerun);
        assert_eq!(rerun.resolved(), &resolved);
        assert!(serde_json::to_value(rerun.projection()).unwrap()["claims"].is_object());

        let raw = InvocationGate::prepare_authority(
            InvocationSource::LiveRerun,
            AuthMode::Sessions,
            ServerProfile::Test,
            7,
            10,
            &WireAuthorityFields::default(),
            resolved,
        )
        .unwrap_err();
        assert_eq!(raw.diagnostic.code, "SNAPBACK_INVOCATION_SOURCE_INVALID");
    }

    #[test]
    fn retained_sessions_owner_is_bearer_free_canonical_and_uses_one_fresh_root() {
        let digest =
            |prefix: &str, marker: char| format!("{prefix}{}", marker.to_string().repeat(64));
        let deployment = DeploymentIdentity {
            schema_version: "snapback.v1".to_owned(),
            auth_mode: AuthMode::Sessions,
            app_id: "live-auth-test".to_owned(),
            schema_hash: digest(SCHEMA_V1_PREFIX, '1'),
            bundle_hash: digest(FUNCTION_V1_PREFIX, '2'),
            inputs_hash: digest(INPUTS_V1_PREFIX, '3'),
        };
        let mode = AuthModeStateRecord {
            format_version: AUTH_MODE_FORMAT_VERSION,
            transition_generation: 7,
            active: AuthMode::Sessions,
            desired: AuthMode::Sessions,
            mode_state: AuthModeStatus::Settled,
            app_data_availability: AppDataAvailability::Available,
            sessions_ever_activated: true,
            active_deployment: Some(deployment),
            requested_deployment: None,
            quarantine: None,
        };
        let controller = AdmissionController::from_mode_state(&mode).unwrap();
        let resolved = test_session_authority_with_origin(
            "canonical-user",
            "canonical-session",
            "email-code",
            4,
            "authority-instance",
            10_000,
            None,
            None,
            controller.lease_origin(),
        );
        let initial = InvocationGate::prepare_admitted_authority(
            InvocationSource::LiveInitialQuery,
            AuthMode::Sessions,
            ServerProfile::Test,
            controller.admit_for_mode(AuthMode::Sessions).unwrap(),
            &WireAuthorityFields::default(),
            resolved.clone(),
            Some(AuthClaimsProjection::server_derived(Vec::new(), Vec::new())),
        )
        .unwrap();
        assert_eq!(controller.snapshot().in_flight, 1);
        let retained = initial.retain_live_owner().unwrap();
        let canonical = retained.canonicalize_input(HandlerInput {
            auth: AuthInput {
                principal: Some("wire-principal".to_owned()),
                session_id: Some("wire-session".to_owned()),
                user_id: Some("wire-user".to_owned()),
                ..AuthInput::default()
            },
            ..HandlerInput::default()
        });
        assert_eq!(canonical.auth.principal, None);
        assert_eq!(canonical.auth.user_id.as_deref(), Some("canonical-user"));
        assert_eq!(
            canonical.auth.session_id.as_deref(),
            Some("canonical-session")
        );

        drop(initial);
        assert_eq!(
            controller.snapshot().in_flight,
            0,
            "retained owner must not retain the initial admission root"
        );
        let rerun = retained
            .prepare_rerun(Some(AuthClaimsProjection::server_derived(
                Vec::new(),
                Vec::new(),
            )))
            .unwrap();
        assert_eq!(controller.snapshot().in_flight, 1);
        assert_eq!(rerun.source(), InvocationSource::LiveRerun);
        assert_eq!(rerun.resolved(), &resolved);
        drop(rerun);
        assert_eq!(controller.snapshot().in_flight, 0);
    }
}
