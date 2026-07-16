//! Server-owned invocation authority.
//!
//! Wire authority, resolved authority, and the handler-visible projection are
//! deliberately different types. Runtime entry points consume a
//! [`PreparedInvocation`]; application code never receives a wire credential
//! or an operator bypass as identity.

// @ref LLP 0058#shared-invocation-authority — one closed gate separates wire authority, resolved authority, and the immutable handler projection.

use crate::admin::ServerProfile;
use crate::auth::admission::{AdmissionEffectGuard, AdmissionLease};
use crate::auth::provider::ResolvedSession;
use crate::auth::session_projection::FencedPublication;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{
    AuthInput, AuthMode, AuthRequirement, FunctionDefinition, FunctionKind, HandlerInput,
};
use crate::storage::auth_grants::ExactGrantScope;
use crate::storage::auth_agent_credentials::ResolvedScopedToken;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::time::Instant;
use uuid::Uuid;

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
    Session {
        user_id: String,
        session_id: String,
        provider: String,
        generation: u64,
        authority_instance_id: String,
        /// Earliest durable session deadline captured by the trusted
        /// projection. It is server-held and never enters `ctx.auth`.
        session_not_after_ms: u64,
        /// Optional provider-assertion deadline when it differs from the
        /// session's own lifetime.
        provider_not_after_ms: Option<u64>,
    },
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
    ServicePrincipal {
        actor_user_id: String,
        credential_id: String,
        credential_generation: u64,
        grant_id: String,
        token_id: String,
        effective_user_id: Option<String>,
        scopes: Vec<ResolvedGrantScope>,
        token_expires_at_ms: u64,
    },
    AdminBypass {
        reason: String,
    },
    System,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedGrantScope {
    function_id: String,
    kind: FunctionKind,
    basis: u64,
    authority_creating: bool,
}

impl ResolvedGrantScope {
    pub(crate) fn from_exact(scope: ExactGrantScope) -> Self {
        Self {
            function_id: scope.function_id,
            kind: scope.kind.into_function_kind(),
            basis: scope.basis,
            authority_creating: scope.authority_creating,
        }
    }

    pub(crate) fn function_id(&self) -> &str {
        &self.function_id
    }

    pub(crate) fn kind(&self) -> &FunctionKind {
        &self.kind
    }

    pub(crate) fn basis(&self) -> u64 {
        self.basis
    }

    pub(crate) fn authority_creating(&self) -> bool {
        self.authority_creating
    }
}

impl ResolvedAppAuthority {
    pub fn from_session(session: ResolvedSession) -> Self {
        Self::Session {
            user_id: session.user_id,
            session_id: session.session_id,
            provider: session.provider,
            generation: session.generation,
            authority_instance_id: session.authority_instance_id,
            session_not_after_ms: session.expires_at_ms.min(session.absolute_expires_at_ms),
            provider_not_after_ms: None,
        }
    }

    pub(crate) fn from_scoped_token(token: ResolvedScopedToken) -> Self {
        Self::ServicePrincipal {
            actor_user_id: token.actor_user_id,
            credential_id: token.credential_id,
            credential_generation: token.credential_generation,
            grant_id: token.grant_id,
            token_id: token.token_id,
            effective_user_id: token.effective_user_id,
            scopes: token
                .scopes
                .into_iter()
                .map(ResolvedGrantScope::from_exact)
                .collect(),
            token_expires_at_ms: token.expires_at_ms,
        }
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
            Self::Session { .. }
                | Self::DevImpersonation { .. }
                | Self::ServicePrincipal { .. }
        )
    }

    /// Stable, bearer-free identity for durable invalidation retry ownership.
    /// Length prefixes make the representation injective without depending on
    /// a caller-controlled JSON/debug rendering.
    pub(crate) fn invalidation_subject(&self) -> String {
        match self {
            Self::Anonymous => "anonymous".to_owned(),
            Self::Session {
                authority_instance_id,
                generation,
                ..
            } => format!(
                "session:{}:{}:{generation}",
                authority_instance_id.len(),
                authority_instance_id
            ),
            Self::DevImpersonation { user_id, .. } => {
                format!("dev:{}:{user_id}", user_id.len())
            }
            Self::ServicePrincipal {
                actor_user_id,
                credential_id,
                credential_generation,
                grant_id,
                ..
            } => format!(
                "service-principal:{}:{}:{}:{}:{}:{}:{credential_generation}",
                actor_user_id.len(),
                actor_user_id,
                credential_id.len(),
                credential_id,
                grant_id.len(),
                grant_id,
            ),
            Self::AdminBypass { .. } => "admin-bypass".to_owned(),
            Self::System => "system".to_owned(),
        }
    }

    pub fn key(&self) -> AuthorityKey {
        match self {
            Self::Anonymous => AuthorityKey::Anonymous,
            Self::Session {
                user_id,
                session_id,
                generation,
                ..
            } => AuthorityKey::Session {
                user_id: user_id.clone(),
                session_id: session_id.clone(),
                generation: *generation,
            },
            Self::DevImpersonation { user_id, .. } => AuthorityKey::DevImpersonation {
                user_id: user_id.clone(),
            },
            Self::ServicePrincipal {
                actor_user_id,
                credential_id,
                credential_generation,
                grant_id,
                ..
            } => AuthorityKey::ServicePrincipal {
                actor_user_id: actor_user_id.clone(),
                credential_id: credential_id.clone(),
                credential_generation: *credential_generation,
                grant_id: grant_id.clone(),
            },
            Self::AdminBypass { .. } => AuthorityKey::AdminBypass,
            Self::System => AuthorityKey::System,
        }
    }

    fn legacy_input(&self) -> AuthInput {
        match self {
            Self::Session {
                user_id,
                session_id,
                ..
            } => AuthInput {
                principal: None,
                session_id: Some(session_id.clone()),
                user_id: Some(user_id.clone()),
            },
            Self::DevImpersonation { user_id, .. } => AuthInput {
                principal: None,
                session_id: None,
                user_id: Some(user_id.clone()),
            },
            Self::ServicePrincipal {
                actor_user_id,
                effective_user_id,
                ..
            } => AuthInput {
                principal: None,
                session_id: None,
                user_id: Some(
                    effective_user_id
                        .as_ref()
                        .unwrap_or(actor_user_id)
                        .clone(),
                ),
            },
            Self::Anonymous | Self::AdminBypass { .. } | Self::System => AuthInput::default(),
        }
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
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct HandlerAuthActorProjection {
    user_id: String,
    kind: String,
    grant_id: String,
}

/// Server-derived, bearer-free attribution for one app-data function
/// response. Wrappers may copy this value, but cannot synthesize attribution
/// authority when the invocation gate did not produce it.
///
/// @ref LLP 0055#audit — every resolved service-principal function response
/// carries the same actor/effective/grant attribution and v1 has no agent
/// dry-run surface.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FunctionAttribution {
    pub actor_user_id: String,
    pub effective_user_id: Option<String>,
    pub grant_id: String,
    pub dry_run: bool,
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

    fn legacy_input(&self) -> AuthInput {
        AuthInput {
            principal: None,
            session_id: None,
            user_id: Some(self.user_id.clone()),
        }
    }
}

impl HandlerAuthProjection {
    pub fn from_authority(authority: &ResolvedAppAuthority) -> Self {
        match authority {
            ResolvedAppAuthority::Session {
                user_id,
                session_id,
                provider,
                ..
            } => Self {
                user_id: Some(user_id.clone()),
                session_id: Some(session_id.clone()),
                is_authenticated: true,
                provider: Some(provider.clone()),
                roles: Some(Vec::new()),
                kind: Some("human".to_owned()),
                actor: None,
            },
            ResolvedAppAuthority::DevImpersonation { user_id, roles, .. } => Self {
                user_id: Some(user_id.clone()),
                session_id: None,
                is_authenticated: true,
                provider: None,
                roles: Some(roles.clone()),
                kind: Some("human".to_owned()),
                actor: None,
            },
            ResolvedAppAuthority::ServicePrincipal {
                actor_user_id,
                grant_id,
                effective_user_id,
                ..
            } => Self {
                user_id: Some(
                    effective_user_id
                        .as_ref()
                        .unwrap_or(actor_user_id)
                        .clone(),
                ),
                session_id: None,
                is_authenticated: true,
                provider: Some("agent-credential".to_owned()),
                roles: Some(Vec::new()),
                kind: Some(if effective_user_id.is_some() {
                    "human".to_owned()
                } else {
                    "agent".to_owned()
                }),
                actor: effective_user_id.as_ref().map(|_| HandlerAuthActorProjection {
                    user_id: actor_user_id.clone(),
                    kind: "agent".to_owned(),
                    grant_id: grant_id.clone(),
                }),
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
            },
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

    pub(crate) fn roles(&self) -> &[String] {
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
    AgentGrantManagement,
    HttpQuery,
    HttpMutation,
    HttpAction,
    LocalQuery,
    LocalMutation,
    LocalAction,
    DirectAdminRunner,
    HostOperationFunctionRun,
    HostOperationMutationDryRun,
    Cron,
    NestedMutation,
    LiveInitialQuery,
    LiveRerun,
    StandaloneAcknowledgement,
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
    pub const ALL: [Self; 30] = [
        Self::BootstrapHandshake,
        Self::AuthRefresh,
        Self::AuthLogout,
        Self::AgentGrantManagement,
        Self::HttpQuery,
        Self::HttpMutation,
        Self::HttpAction,
        Self::LocalQuery,
        Self::LocalMutation,
        Self::LocalAction,
        Self::DirectAdminRunner,
        Self::HostOperationFunctionRun,
        Self::HostOperationMutationDryRun,
        Self::Cron,
        Self::NestedMutation,
        Self::LiveInitialQuery,
        Self::LiveRerun,
        Self::StandaloneAcknowledgement,
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
            Self::HttpQuery | Self::LocalQuery | Self::LiveInitialQuery | Self::LiveRerun => {
                InvocationTarget::Function(FunctionKindConstraint::Query)
            }
            Self::HttpMutation
            | Self::LocalMutation
            | Self::HostOperationMutationDryRun
            | Self::NestedMutation => InvocationTarget::Function(FunctionKindConstraint::Mutation),
            Self::HttpAction | Self::LocalAction | Self::Cron => {
                InvocationTarget::Function(FunctionKindConstraint::Action)
            }
            Self::DirectAdminRunner | Self::HostOperationFunctionRun => {
                InvocationTarget::Function(FunctionKindConstraint::Any)
            }
            Self::BootstrapHandshake
            | Self::AuthRefresh
            | Self::AuthLogout
            | Self::AgentGrantManagement
            | Self::StandaloneAcknowledgement
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
    ServicePrincipal,
    DevBodyAuthority,
    DirectRunnerBodyUser,
    HostOperationImpersonation,
    AdminBypass,
    System,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OperationAvailability {
    Available,
}

/// Immutable result of mode, policy, wire-field, and credential preparation.
#[derive(Clone, Debug)]
pub struct PreparedAuthority {
    admission: AdmissionLease,
    active_mode: AuthMode,
    profile: ServerProfile,
    source: InvocationSource,
    resolved: ResolvedAppAuthority,
    projection: HandlerAuthProjection,
    direct_authorization: Option<DirectAuthorizationProjection>,
    audit: AuthorityAuditFact,
    availability: OperationAvailability,
    /// Item-5 leaf handles for the final externally-observable publication
    /// cut. Dev-only/local preparations may omit this; every projection- or
    /// connection-resolved sessions-mode request installs it.
    publication: Option<FencedPublication>,
    authorization_stream_incarnation: Option<String>,
}

/// Bearer-free authority retained by a durable live subscription. It carries
/// no admission lease; each rerun must combine it with a fresh short root from
/// the current controller epoch through `prepare_rerun`.
#[derive(Clone, Debug)]
pub(crate) struct RetainedLiveAuthority {
    active_mode: AuthMode,
    profile: ServerProfile,
    resolved: ResolvedAppAuthority,
}

impl PreparedAuthority {
    pub fn source(&self) -> InvocationSource {
        self.source
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

    pub fn projection(&self) -> &HandlerAuthProjection {
        &self.projection
    }

    pub fn direct_authorization_projection(&self) -> Option<&DirectAuthorizationProjection> {
        self.direct_authorization.as_ref()
    }

    pub fn function_attribution(&self) -> Option<FunctionAttribution> {
        match &self.resolved {
            ResolvedAppAuthority::ServicePrincipal {
                actor_user_id,
                effective_user_id,
                grant_id,
                ..
            } => Some(FunctionAttribution {
                actor_user_id: actor_user_id.clone(),
                effective_user_id: effective_user_id.clone(),
                grant_id: grant_id.clone(),
                dry_run: false,
            }),
            _ => None,
        }
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

    pub(crate) fn canonical_auth_input(&self) -> AuthInput {
        self.direct_authorization
            .as_ref()
            .map_or_else(|| self.resolved.legacy_input(), |direct| direct.legacy_input())
    }

    pub(crate) fn with_fenced_publication(mut self, publication: FencedPublication) -> Self {
        self.authorization_stream_incarnation =
            Some(publication.authorization_stream_incarnation().to_owned());
        self.publication = Some(publication);
        self
    }

    pub(crate) fn with_authorization_stream_incarnation(mut self, incarnation: String) -> Self {
        self.authorization_stream_incarnation = Some(incarnation);
        self
    }

    /// Consume a fully computed finite effect at the exact stream/session
    /// fence. Dev-mode authority has no session projection and publishes
    /// directly; Sessions authority always installs a fence in middleware.
    pub(crate) fn try_publish_fenced<T>(
        &self,
        epoch_now_ms: u64,
        monotonic_now: std::time::Instant,
        publish: impl FnOnce() -> SnapbackResult<T>,
    ) -> SnapbackResult<Option<T>> {
        if self.admission.is_diagnostic() {
            return publish().map(Some);
        }
        match &self.publication {
            Some(publication) => publication.try_publish(epoch_now_ms, monotonic_now, publish),
            None => publish().map(Some),
        }
    }

    pub(crate) fn authorization_stream_incarnation(&self) -> Option<&str> {
        self.authorization_stream_incarnation.as_deref()
    }

    pub(crate) fn retain_live_owner(&self) -> SnapbackResult<RetainedLiveAuthority> {
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
            resolved: self.resolved.clone(),
        })
    }

    pub fn validate_admission(&self, effect: &'static str) -> SnapbackResult<()> {
        self.admission.validate(effect)
    }

    pub fn effect_guard(&self, effect: &'static str) -> SnapbackResult<AdmissionEffectGuard<'_>> {
        self.admission.effect_guard(effect)
    }

    /// Validate the exact authorization stream/session leaf and perform one
    /// bounded synchronous publication while its guards remain held.
    pub(crate) fn try_fenced_publication<T>(
        &self,
        epoch_now_ms: u64,
        monotonic_now: Instant,
        publish: impl FnOnce() -> SnapbackResult<T>,
    ) -> SnapbackResult<Option<T>> {
        self.try_publish_fenced(epoch_now_ms, monotonic_now, publish)
    }

    pub fn inherit_for(&self, source: InvocationSource) -> SnapbackResult<Self> {
        if !matches!(
            source,
            InvocationSource::NestedMutation | InvocationSource::LiveRerun
        ) {
            return Err(SnapbackError::error(
                "SNAPBACK_INVOCATION_SOURCE_INVALID",
                "auth",
                "resolved invocation authority cannot be inherited by this source",
            ));
        }
        Ok(Self {
            source,
            ..self.clone()
        })
    }
}

impl RetainedLiveAuthority {
    pub(crate) fn resolved(&self) -> &ResolvedAppAuthority {
        &self.resolved
    }

    pub(crate) fn matches(&self, authority: &PreparedAuthority) -> bool {
        self.active_mode == authority.active_mode
            && self.profile == authority.profile
            && self.resolved == authority.resolved
    }

    pub(crate) fn prepare_rerun(
        &self,
        admission: AdmissionLease,
    ) -> SnapbackResult<PreparedAuthority> {
        InvocationGate::prepare_admitted_authority_inner(
            InvocationSource::LiveRerun,
            self.active_mode,
            self.profile,
            admission,
            &WireAuthorityFields::default(),
            self.resolved.clone(),
            true,
        )
    }

    pub(crate) fn canonicalize_input(&self, mut input: HandlerInput) -> HandlerInput {
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
    invocation_id: String,
}

impl PreparedInvocation {
    pub fn authority(&self) -> &PreparedAuthority {
        &self.authority
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

    pub fn auth_requirement(&self) -> AuthRequirement {
        self.requirement
    }

    pub(crate) fn authority_creating_consent(&self) -> bool {
        self.authority_creating_consent
    }

    pub fn invocation_id(&self) -> &str {
        &self.invocation_id
    }

    pub fn admission_lease(&self) -> &AdmissionLease {
        self.authority.admission_lease()
    }

    pub fn validate_admission(&self, effect: &'static str) -> SnapbackResult<()> {
        self.authority.validate_admission(effect)
    }

    pub fn effect_guard(&self, effect: &'static str) -> SnapbackResult<AdmissionEffectGuard<'_>> {
        self.authority.effect_guard(effect)
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
    #[allow(clippy::too_many_arguments)]
    #[cfg(test)]
    pub fn prepare_authority(
        source: InvocationSource,
        active_mode: AuthMode,
        profile: ServerProfile,
        transition_generation: u64,
        admission_epoch: u64,
        wire: &WireAuthorityFields,
        resolved: ResolvedAppAuthority,
    ) -> SnapbackResult<PreparedAuthority> {
        Self::prepare_admitted_authority(
            source,
            active_mode,
            profile,
            AdmissionLease::unmanaged(transition_generation, admission_epoch),
            wire,
            resolved,
        )
    }

    /// Prepare authority under a counted admission lease owned by the app's
    /// process-local controller. HTTP composition must use this form; the raw
    /// generation/epoch overload exists only while that lane is being wired.
    pub fn prepare_admitted_authority(
        source: InvocationSource,
        active_mode: AuthMode,
        profile: ServerProfile,
        admission: AdmissionLease,
        wire: &WireAuthorityFields,
        resolved: ResolvedAppAuthority,
    ) -> SnapbackResult<PreparedAuthority> {
        Self::prepare_admitted_authority_inner(
            source,
            active_mode,
            profile,
            admission,
            wire,
            resolved,
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
        allow_inherited_live_rerun: bool,
    ) -> SnapbackResult<PreparedAuthority> {
        admission.validate("invocation preparation")?;
        admission.require_mode(active_mode)?;
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
            (ResolvedAppAuthority::Session { .. }, _) => AuthorityAuditFact::Session,
            (ResolvedAppAuthority::ServicePrincipal { .. }, _) => {
                AuthorityAuditFact::ServicePrincipal
            }
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
            (ResolvedAppAuthority::DevImpersonation { .. }, _) => {
                AuthorityAuditFact::DevBodyAuthority
            }
        };
        let projection = HandlerAuthProjection::from_authority(&resolved);
        let direct_authorization = match &resolved {
            ResolvedAppAuthority::ServicePrincipal {
                effective_user_id: Some(effective_user_id),
                ..
            } => Some(DirectAuthorizationProjection::for_effective_user(
                effective_user_id,
            )),
            _ => None,
        };
        Ok(PreparedAuthority {
            admission,
            active_mode,
            profile,
            source,
            resolved,
            projection,
            direct_authorization,
            audit,
            availability: OperationAvailability::Available,
            publication: None,
            authorization_stream_incarnation: None,
        })
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
        )
    }

    pub fn prepare_function(
        authority: PreparedAuthority,
        function: &FunctionDefinition,
    ) -> SnapbackResult<PreparedInvocation> {
        authority.validate_admission("function invocation preparation")?;
        let InvocationTarget::Function(constraint) = authority.source.target() else {
            return Err(SnapbackError::error(
                "SNAPBACK_INVOCATION_SOURCE_INVALID",
                "auth",
                "an authority-only source cannot invoke an application function",
            ));
        };
        if !function_kind_matches(constraint, &function.kind) {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_KIND_MISMATCH",
                "runtime",
                format!(
                    "invocation source {:?} cannot run function kind {:?}",
                    authority.source, function.kind
                ),
            ));
        }
        let requirement = function.effective_auth_requirement();
        if requirement == AuthRequirement::Authenticated && !authority.resolved.carries_user() {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_REQUIRED",
                "auth",
                "this function requires an authenticated user",
            ));
        }
        let mut authority_creating_consent = false;
        if let ResolvedAppAuthority::ServicePrincipal { scopes, .. } = &authority.resolved {
            let scope = scopes
                .iter()
                .find(|scope| scope.function_id == function.id && scope.kind == function.kind)
                .ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_AUTH_GRANT_SCOPE_DENIED",
                        "auth",
                        "the scoped grant does not authorize this function",
                    )
                    .with_details(serde_json::json!({ "reason": "missing_scope" }))
                })?;
            authority_creating_consent = scope.authority_creating;
            if function.authority_creating && !authority_creating_consent {
                return Err(SnapbackError::error(
                    "SNAPBACK_AUTH_AUTHORITY_CREATING_UNCONSENTED",
                    "auth",
                    "the function requires explicit authority-creating consent",
                )
                .with_details(serde_json::json!({ "reason": "scope_not_authority_creating" })));
            }
        }
        Ok(PreparedInvocation {
            authority,
            function_id: function.id.clone(),
            function_kind: function.kind.clone(),
            requirement,
            authority_creating_consent,
            invocation_id: format!("inv_{}", Uuid::now_v7().simple()),
        })
    }
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
            ResolvedAppAuthority::Anonymous | ResolvedAppAuthority::Session { .. }
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
                    | ResolvedAppAuthority::Session { .. }
                    | ResolvedAppAuthority::ServicePrincipal { .. }
            ),
        },
        InvocationSource::AuthRefresh
        | InvocationSource::AuthLogout
        | InvocationSource::AgentGrantManagement => {
            mode == AuthMode::Sessions && matches!(resolved, ResolvedAppAuthority::Session { .. })
        }
        InvocationSource::HttpQuery
        | InvocationSource::HttpMutation
        | InvocationSource::HttpAction => {
            ordinary
                || (mode == AuthMode::Sessions
                    && matches!(resolved, ResolvedAppAuthority::ServicePrincipal { .. }))
        }
        InvocationSource::ConnectionOpen => {
            ordinary
                || (mode == AuthMode::Sessions
                    && matches!(resolved, ResolvedAppAuthority::ServicePrincipal { .. }))
        }
        InvocationSource::LiveInitialQuery
        | InvocationSource::StandaloneAcknowledgement
        | InvocationSource::ConnectionClose
        | InvocationSource::LiveResume
        | InvocationSource::LiveUnsubscribe
        | InvocationSource::LiveSupersede
        | InvocationSource::LiveStream
        | InvocationSource::OutboxDrain => {
            ordinary
                || (mode == AuthMode::Sessions
                    && matches!(resolved, ResolvedAppAuthority::ServicePrincipal { .. }))
        }
        InvocationSource::EphemeralRegister
        | InvocationSource::EphemeralPublish
        | InvocationSource::EphemeralDelete
        | InvocationSource::EphemeralSubscribe
        | InvocationSource::EphemeralUnsubscribe => ordinary,
        InvocationSource::LocalQuery
        | InvocationSource::LocalMutation
        | InvocationSource::LocalAction => mode == AuthMode::Dev && ordinary,
        InvocationSource::DirectAdminRunner
        | InvocationSource::HostOperationFunctionRun
        | InvocationSource::HostOperationMutationDryRun => admin,
        InvocationSource::Cron => matches!(resolved, ResolvedAppAuthority::System),
        InvocationSource::LiveRerun => {
            allow_inherited_live_rerun
                && (ordinary
                    || (mode == AuthMode::Sessions
                        && matches!(resolved, ResolvedAppAuthority::ServicePrincipal { .. })))
        }
        InvocationSource::NestedMutation => false,
    }
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
    use crate::auth::admission::AdmissionController;
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
        let anonymous = serde_json::to_value(HandlerAuthProjection::from_authority(
            &ResolvedAppAuthority::Anonymous,
        ))
        .unwrap();
        assert_eq!(
            anonymous,
            json!({
                "userId": null,
                "sessionId": null,
                "isAuthenticated": false
            })
        );

        let session = serde_json::to_value(HandlerAuthProjection::from_authority(
            &ResolvedAppAuthority::Session {
                user_id: "user_1".to_owned(),
                session_id: "session_1".to_owned(),
                provider: "email-code".to_owned(),
                generation: 3,
                authority_instance_id: "authority_1".to_owned(),
                session_not_after_ms: 10_000,
                provider_not_after_ms: None,
            },
        ))
        .unwrap();
        assert_eq!(
            session,
            json!({
                "userId": "user_1",
                "sessionId": "session_1",
                "isAuthenticated": true,
                "provider": "email-code",
                "roles": [],
                "kind": "human"
            })
        );

        let autonomous = serde_json::to_value(HandlerAuthProjection::from_authority(
            &ResolvedAppAuthority::ServicePrincipal {
                actor_user_id: "agent_1".to_owned(),
                credential_id: "credential_1".to_owned(),
                credential_generation: 2,
                grant_id: "grant_1".to_owned(),
                token_id: "token_1".to_owned(),
                effective_user_id: None,
                scopes: Vec::new(),
                token_expires_at_ms: 20_000,
            },
        ))
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

        let delegated = serde_json::to_value(HandlerAuthProjection::from_authority(
            &ResolvedAppAuthority::ServicePrincipal {
                actor_user_id: "agent_1".to_owned(),
                credential_id: "credential_1".to_owned(),
                credential_generation: 2,
                grant_id: "grant_1".to_owned(),
                token_id: "token_1".to_owned(),
                effective_user_id: Some("user_1".to_owned()),
                scopes: Vec::new(),
                token_expires_at_ms: 20_000,
            },
        ))
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
    fn function_attribution_exists_only_after_service_principal_resolution() {
        let authority = InvocationGate::prepare_authority(
            InvocationSource::HttpQuery,
            AuthMode::Sessions,
            ServerProfile::Test,
            0,
            0,
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::ServicePrincipal {
                actor_user_id: "agent_1".to_owned(),
                credential_id: "credential_1".to_owned(),
                credential_generation: 2,
                grant_id: "grant_1".to_owned(),
                token_id: "token_1".to_owned(),
                effective_user_id: Some("user_1".to_owned()),
                scopes: Vec::new(),
                token_expires_at_ms: 20_000,
            },
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
            ResolvedAppAuthority::ServicePrincipal {
                actor_user_id: "agent_1".to_owned(),
                credential_id: "credential_1".to_owned(),
                credential_generation: 2,
                grant_id: "grant_1".to_owned(),
                token_id: "token_1".to_owned(),
                effective_user_id: Some("user_1".to_owned()),
                scopes: Vec::new(),
                token_expires_at_ms: 20_000,
            },
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
        assert_eq!(
            authority.canonical_auth_input(),
            AuthInput {
                principal: None,
                session_id: None,
                user_id: Some("user_1".to_owned()),
            },
            "host authorization sees only the direct effective-user baseline"
        );
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
            ResolvedAppAuthority::ServicePrincipal {
                actor_user_id: "agent_1".to_owned(),
                credential_id: "credential_1".to_owned(),
                credential_generation: 2,
                grant_id: "grant_1".to_owned(),
                token_id: "token_1".to_owned(),
                effective_user_id: None,
                scopes: Vec::new(),
                token_expires_at_ms: 20_000,
            },
        )
        .unwrap();
        assert!(autonomous.direct_authorization_projection().is_none());
    }

    #[test]
    fn service_principal_scope_is_checked_before_function_preparation() {
        let function = function(Some(AuthRequirement::Authenticated));
        let service = |scopes| ResolvedAppAuthority::ServicePrincipal {
            actor_user_id: "agent_1".to_owned(),
            credential_id: "credential_1".to_owned(),
            credential_generation: 1,
            grant_id: "grant_1".to_owned(),
            token_id: "token_1".to_owned(),
            effective_user_id: Some("user_1".to_owned()),
            scopes,
            token_expires_at_ms: 20_000,
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

        let denied = InvocationGate::prepare_function(prepare(service(Vec::new())), &function)
            .unwrap_err();
        assert_eq!(denied.diagnostic.code, "SNAPBACK_AUTH_GRANT_SCOPE_DENIED");
        assert_eq!(denied.diagnostic.details["reason"], "missing_scope");

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
    }

    #[test]
    fn source_registry_has_no_unclassified_entry() {
        for source in InvocationSource::ALL {
            let _ = source.target();
        }
    }

    #[test]
    fn source_mode_authority_matrix_is_closed_and_exhaustive() {
        #[derive(Clone, Copy)]
        enum Kind {
            Anonymous,
            Session,
            Service,
            Dev,
            Admin,
            System,
        }
        let authority = |kind| match kind {
            Kind::Anonymous => ResolvedAppAuthority::Anonymous,
            Kind::Session => ResolvedAppAuthority::Session {
                user_id: "user".to_owned(),
                session_id: "session".to_owned(),
                provider: "email-code".to_owned(),
                generation: 1,
                authority_instance_id: "authority".to_owned(),
                session_not_after_ms: 10_000,
                provider_not_after_ms: None,
            },
            Kind::Service => ResolvedAppAuthority::ServicePrincipal {
                actor_user_id: "agent".to_owned(),
                credential_id: "credential".to_owned(),
                credential_generation: 1,
                grant_id: "grant".to_owned(),
                token_id: "token".to_owned(),
                effective_user_id: Some("user".to_owned()),
                scopes: Vec::new(),
                token_expires_at_ms: 10_000,
            },
            Kind::Dev => ResolvedAppAuthority::DevImpersonation {
                user_id: "dev".to_owned(),
                roles: Vec::new(),
                local_dev_only: true,
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
                | InvocationSource::AgentGrantManagement => {
                    mode == AuthMode::Sessions && matches!(kind, Kind::Session)
                }
                InvocationSource::HttpQuery
                | InvocationSource::HttpMutation
                | InvocationSource::HttpAction => {
                    ordinary
                        || matches!((mode, kind), (AuthMode::Sessions, Kind::Service))
                }
                InvocationSource::ConnectionOpen => {
                    ordinary
                        || matches!((mode, kind), (AuthMode::Sessions, Kind::Service))
                }
                InvocationSource::LiveInitialQuery
                | InvocationSource::StandaloneAcknowledgement
                | InvocationSource::ConnectionClose
                | InvocationSource::LiveResume
                | InvocationSource::LiveUnsubscribe
                | InvocationSource::LiveSupersede
                | InvocationSource::LiveStream
                | InvocationSource::OutboxDrain => {
                    ordinary
                        || matches!((mode, kind), (AuthMode::Sessions, Kind::Service))
                }
                InvocationSource::EphemeralRegister
                | InvocationSource::EphemeralPublish
                | InvocationSource::EphemeralDelete
                | InvocationSource::EphemeralSubscribe
                | InvocationSource::EphemeralUnsubscribe => ordinary,
                InvocationSource::LocalQuery
                | InvocationSource::LocalMutation
                | InvocationSource::LocalAction => mode == AuthMode::Dev && ordinary,
                InvocationSource::DirectAdminRunner
                | InvocationSource::HostOperationFunctionRun
                | InvocationSource::HostOperationMutationDryRun => admin,
                InvocationSource::Cron => matches!(kind, Kind::System),
                InvocationSource::NestedMutation | InvocationSource::LiveRerun => false,
            }
        };

        for source in InvocationSource::ALL {
            for mode in [AuthMode::Dev, AuthMode::Sessions] {
                for kind in [
                    Kind::Anonymous,
                    Kind::Session,
                    Kind::Service,
                    Kind::Dev,
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
                    if let Err(error) = result {
                        assert_eq!(error.diagnostic.code, "SNAPBACK_INVOCATION_SOURCE_INVALID");
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
        let resolved = ResolvedAppAuthority::Session {
            user_id: "user".to_owned(),
            session_id: "session".to_owned(),
            provider: "email-code".to_owned(),
            generation: 1,
            authority_instance_id: "authority".to_owned(),
            session_not_after_ms: 10_000,
            provider_not_after_ms: None,
        };
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
            .prepare_rerun(AdmissionLease::unmanaged(7, 10))
            .unwrap();
        assert_eq!(rerun.source(), InvocationSource::LiveRerun);
        assert_eq!(rerun.resolved(), &resolved);

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
        let resolved = ResolvedAppAuthority::Session {
            user_id: "canonical-user".to_owned(),
            session_id: "canonical-session".to_owned(),
            provider: "email-code".to_owned(),
            generation: 4,
            authority_instance_id: "authority-instance".to_owned(),
            session_not_after_ms: 10_000,
            provider_not_after_ms: None,
        };
        let initial = InvocationGate::prepare_admitted_authority(
            InvocationSource::LiveInitialQuery,
            AuthMode::Sessions,
            ServerProfile::Test,
            controller.admit_for_mode(AuthMode::Sessions).unwrap(),
            &WireAuthorityFields::default(),
            resolved.clone(),
        )
        .unwrap();
        assert_eq!(controller.snapshot().in_flight, 1);
        let retained = initial.retain_live_owner().unwrap();
        let canonical = retained.canonicalize_input(HandlerInput {
            auth: AuthInput {
                principal: Some("wire-principal".to_owned()),
                session_id: Some("wire-session".to_owned()),
                user_id: Some("wire-user".to_owned()),
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
            .prepare_rerun(controller.admit_for_mode(AuthMode::Sessions).unwrap())
            .unwrap();
        assert_eq!(controller.snapshot().in_flight, 1);
        assert_eq!(rerun.source(), InvocationSource::LiveRerun);
        assert_eq!(rerun.resolved(), &resolved);
        drop(rerun);
        assert_eq!(controller.snapshot().in_flight, 0);
    }
}
