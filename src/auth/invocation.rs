//! Server-owned invocation authority.
//!
//! Wire authority, resolved authority, and the handler-visible projection are
//! deliberately different types. Runtime entry points consume a
//! [`PreparedInvocation`]; application code never receives a wire credential
//! or an operator bypass as identity.

use crate::admin::ServerProfile;
use crate::auth::provider::ResolvedSession;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{
    AuthInput, AuthMode, AuthRequirement, FunctionDefinition, FunctionKind, HandlerInput,
};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
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
        let auth = object.get("auth");
        fields.record(
            WireAuthorityLocation::HandlerAuth,
            WireFieldPresence::from_value(auth),
        );
        if let Some(auth) = auth.and_then(Value::as_object) {
            fields.record(
                WireAuthorityLocation::HandlerAuthPrincipal,
                WireFieldPresence::from_value(auth.get("principal")),
            );
            fields.record(
                WireAuthorityLocation::HandlerAuthSessionId,
                WireFieldPresence::from_value(
                    auth.get("session_id").or_else(|| auth.get("sessionId")),
                ),
            );
            fields.record(
                WireAuthorityLocation::HandlerAuthUserId,
                WireFieldPresence::from_value(auth.get("user_id").or_else(|| auth.get("userId"))),
            );
        }
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
    },
    DevImpersonation {
        user_id: String,
        roles: Vec<String>,
        local_dev_only: bool,
    },
    AdminBypass {
        reason: String,
    },
    System,
}

impl ResolvedAppAuthority {
    pub fn from_session(session: ResolvedSession) -> Self {
        Self::Session {
            user_id: session.user_id,
            session_id: session.session_id,
            provider: session.provider,
            generation: session.generation,
            authority_instance_id: session.authority_instance_id,
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
        matches!(self, Self::Session { .. } | Self::DevImpersonation { .. })
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
            },
            ResolvedAppAuthority::DevImpersonation { user_id, roles, .. } => Self {
                user_id: Some(user_id.clone()),
                session_id: None,
                is_authenticated: true,
                provider: None,
                roles: Some(roles.clone()),
            },
            ResolvedAppAuthority::Anonymous
            | ResolvedAppAuthority::AdminBypass { .. }
            | ResolvedAppAuthority::System => Self {
                user_id: None,
                session_id: None,
                is_authenticated: false,
                provider: None,
                roles: None,
            },
        }
    }

    pub fn user_id(&self) -> Option<&str> {
        self.user_id.as_deref()
    }

    pub fn is_authenticated(&self) -> bool {
        self.is_authenticated
    }
}

/// Every authority entry is registered here. The target classification is an
/// exhaustive match: there is no nullable function id or catch-all source.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InvocationSource {
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
    pub const ALL: [Self; 24] = [
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
            Self::StandaloneAcknowledgement
            | Self::ConnectionOpen
            | Self::ConnectionClose
            | Self::EphemeralRegister
            | Self::EphemeralPublish
            | Self::EphemeralDelete
            | Self::EphemeralSubscribe
            | Self::EphemeralUnsubscribe
            | Self::LiveResume
            | Self::LiveUnsubscribe
            | Self::LiveSupersede => InvocationTarget::AuthorityOnly,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AuthorityAuditFact {
    Anonymous,
    Session,
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
    transition_generation: u64,
    admission_epoch: u64,
    active_mode: AuthMode,
    profile: ServerProfile,
    source: InvocationSource,
    resolved: ResolvedAppAuthority,
    projection: HandlerAuthProjection,
    audit: AuthorityAuditFact,
    availability: OperationAvailability,
}

impl PreparedAuthority {
    pub fn source(&self) -> InvocationSource {
        self.source
    }

    pub fn transition_generation(&self) -> u64 {
        self.transition_generation
    }

    pub fn admission_epoch(&self) -> u64 {
        self.admission_epoch
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

    pub fn audit(&self) -> &AuthorityAuditFact {
        &self.audit
    }

    pub fn availability(&self) -> OperationAvailability {
        self.availability
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

/// Immutable authority-bearing input to a function runtime seam.
#[derive(Clone, Debug)]
pub struct PreparedInvocation {
    authority: PreparedAuthority,
    function_id: String,
    function_kind: FunctionKind,
    requirement: AuthRequirement,
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

    pub fn invocation_id(&self) -> &str {
        &self.invocation_id
    }

    /// Replace legacy wire authority with the server-derived compatibility
    /// projection used by HostPlan/storage expressions. Runtime JS receives
    /// `HandlerAuthProjection` separately.
    pub fn canonicalize_input(&self, mut input: HandlerInput) -> HandlerInput {
        input.auth = self.authority.resolved.legacy_input();
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
    pub fn prepare_authority(
        source: InvocationSource,
        active_mode: AuthMode,
        profile: ServerProfile,
        transition_generation: u64,
        admission_epoch: u64,
        wire: &WireAuthorityFields,
        resolved: ResolvedAppAuthority,
    ) -> SnapbackResult<PreparedAuthority> {
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
        let audit = match (&resolved, source) {
            (ResolvedAppAuthority::Anonymous, _) => AuthorityAuditFact::Anonymous,
            (ResolvedAppAuthority::Session { .. }, _) => AuthorityAuditFact::Session,
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
        Ok(PreparedAuthority {
            transition_generation,
            admission_epoch,
            active_mode,
            profile,
            source,
            resolved,
            projection,
            audit,
            availability: OperationAvailability::Available,
        })
    }

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

    pub fn prepare_function(
        authority: PreparedAuthority,
        function: &FunctionDefinition,
    ) -> SnapbackResult<PreparedInvocation> {
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
        Ok(PreparedInvocation {
            authority,
            function_id: function
                .id
                .clone()
                .unwrap_or_else(|| format!("fn:{}", function.name)),
            function_kind: function.kind.clone(),
            requirement,
            invocation_id: format!("inv_{}", Uuid::now_v7().simple()),
        })
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
            prepared(ResolvedAppAuthority::AdminBypass {
                reason: "direct runner".to_owned(),
            }),
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
                "roles": []
            })
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
    }

    #[test]
    fn source_registry_has_no_unclassified_entry() {
        for source in InvocationSource::ALL {
            let _ = source.target();
        }
    }
}
