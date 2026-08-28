//! Auth-owned provisioning carriers and the engine host port.

use snapback_kernel::diagnostic::{Diagnostic, SnapbackResult};
use snapback_types::auth::mode::{AuthModeStateRecord, DeploymentIdentity, StartupArtifacts};
use snapback_types::contract_types::AuthMode;
use std::fmt;
use std::marker::PhantomData;

/// Complete provisioning bytes carried across the server admission barrier.
///
/// This is deliberately not an authority or an assertion that engine-state
/// admission occurred. The engine repeats posture, artifact, deployment, and
/// route validation under its classified write cut before it can commit.
///
/// ```compile_fail
/// use snapback_auth::auth::provision::{AuthProvisionHost, PreparedAuthProvision};
/// use snapback_auth::auth::mode::{DeploymentIdentity, StartupArtifacts};
/// use snapback_auth::contract_types::AuthMode;
/// use snapback_auth::diagnostic::SnapbackResult;
///
/// struct AuthorizedEngineHost;
/// impl AuthProvisionHost for AuthorizedEngineHost {
///     type Routes = ();
///     type ApiEnvelope = ();
///     type Outcome = ();
///     fn validate_auth_provision_carrier(
///         &mut self,
///         _: AuthMode,
///         _: &StartupArtifacts,
///         _: &DeploymentIdentity,
///         _: Option<&Self::Routes>,
///         _: Option<&Self::ApiEnvelope>,
///     ) -> SnapbackResult<()> { Ok(()) }
/// }
/// struct Subject;
/// impl AuthProvisionHost for Subject {
///     type Routes = ();
///     type ApiEnvelope = ();
///     type Outcome = ();
///     fn validate_auth_provision_carrier(
///         &mut self,
///         _: AuthMode,
///         _: &StartupArtifacts,
///         _: &DeploymentIdentity,
///         _: Option<&Self::Routes>,
///         _: Option<&Self::ApiEnvelope>,
///     ) -> SnapbackResult<()> { Ok(()) }
/// }
///
/// // A subject can only prepare a carrier keyed to itself. It cannot mint
/// // the distinct host-keyed input accepted by the authorized engine.
/// fn engine_input(_: PreparedAuthProvision<AuthorizedEngineHost>) {}
/// let subject_input: PreparedAuthProvision<Subject> = todo!();
/// engine_input(subject_input);
/// ```
pub struct PreparedAuthProvision<Host: AuthProvisionHost> {
    requested_mode: AuthMode,
    artifacts: StartupArtifacts,
    deployment: DeploymentIdentity,
    routes: Option<Host::Routes>,
    api_envelope: Option<Host::ApiEnvelope>,
    host: PhantomData<fn(&mut Host)>,
}

/// One-use projection token paired with a validated host-keyed plan.
///
/// This token does not authorize a durable write. It only lets the engine
/// package the outcome after its classified commit path has completed.
#[doc(hidden)]
pub struct AuthProvisionResultProjection<Host: AuthProvisionHost> {
    host: PhantomData<fn(&mut Host)>,
}

impl<Host: AuthProvisionHost> Clone for PreparedAuthProvision<Host>
where
    Host::Routes: Clone,
    Host::ApiEnvelope: Clone,
{
    fn clone(&self) -> Self {
        Self {
            requested_mode: self.requested_mode,
            artifacts: self.artifacts.clone(),
            deployment: self.deployment.clone(),
            routes: self.routes.clone(),
            api_envelope: self.api_envelope.clone(),
            host: PhantomData,
        }
    }
}

impl<Host: AuthProvisionHost> fmt::Debug for PreparedAuthProvision<Host>
where
    Host::Routes: fmt::Debug,
    Host::ApiEnvelope: fmt::Debug,
{
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PreparedAuthProvision")
            .field("requested_mode", &self.requested_mode)
            .field("artifacts", &self.artifacts)
            .field("deployment", &self.deployment)
            .field("routes", &self.routes)
            .field("api_envelope", &self.api_envelope)
            .finish_non_exhaustive()
    }
}

impl<Host: AuthProvisionHost> PreparedAuthProvision<Host> {
    pub fn requested_mode(&self) -> AuthMode {
        self.requested_mode
    }

    /// Return the candidate's already-validated password minimum so the
    /// process owner can compare it with startup-bound provider state before
    /// moving this one-use carrier into the commit path.
    pub fn candidate_password_minimum_length(&self) -> u16 {
        self.artifacts
            .schema
            .effective_auth_password_minimum_length()
    }

    /// Validate and package input for this exact host type.
    ///
    /// The host method is required rather than defaulted: calling this with
    /// `LocalSnapback` necessarily executes the engine's admission checks,
    /// while a subject's own implementation can only mint a subject-keyed
    /// carrier that the engine API does not accept.
    #[doc(hidden)]
    pub fn prepare(
        host: &mut Host,
        requested_mode: AuthMode,
        artifacts: StartupArtifacts,
        deployment: DeploymentIdentity,
        routes: Option<Host::Routes>,
        api_envelope: Option<Host::ApiEnvelope>,
    ) -> SnapbackResult<Self> {
        host.validate_auth_provision_carrier(
            requested_mode,
            &artifacts,
            &deployment,
            routes.as_ref(),
            api_envelope.as_ref(),
        )?;
        Ok(Self {
            requested_mode,
            artifacts,
            deployment,
            routes,
            api_envelope,
            host: PhantomData,
        })
    }

    #[doc(hidden)]
    pub fn into_untrusted_parts(
        self,
    ) -> (
        AuthMode,
        StartupArtifacts,
        DeploymentIdentity,
        Option<Host::Routes>,
        Option<Host::ApiEnvelope>,
        AuthProvisionResultProjection<Host>,
    ) {
        (
            self.requested_mode,
            self.artifacts,
            self.deployment,
            self.routes,
            self.api_envelope,
            AuthProvisionResultProjection { host: PhantomData },
        )
    }
}

pub struct AuthProvisionCommit<Host: AuthProvisionHost> {
    outcome: Host::Outcome,
    state: AuthModeStateRecord,
    pub diagnostics: Vec<Diagnostic>,
    host: PhantomData<fn(&mut Host)>,
}

impl<Host: AuthProvisionHost> Clone for AuthProvisionCommit<Host>
where
    Host::Outcome: Clone,
{
    fn clone(&self) -> Self {
        Self {
            outcome: self.outcome.clone(),
            state: self.state.clone(),
            diagnostics: self.diagnostics.clone(),
            host: PhantomData,
        }
    }
}

impl<Host: AuthProvisionHost> fmt::Debug for AuthProvisionCommit<Host>
where
    Host::Outcome: fmt::Debug,
{
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AuthProvisionCommit")
            .field("outcome", &self.outcome)
            .field("state", &self.state)
            .field("diagnostics", &self.diagnostics)
            .finish_non_exhaustive()
    }
}

impl<Host: AuthProvisionHost> AuthProvisionCommit<Host> {
    pub fn state(&self) -> &AuthModeStateRecord {
        &self.state
    }

    pub fn into_outcome(self) -> Host::Outcome {
        self.outcome
    }

    pub fn into_diagnostics(self) -> Vec<Diagnostic> {
        self.diagnostics
    }

    #[doc(hidden)]
    pub fn into_parts(self) -> (Host::Outcome, AuthModeStateRecord, Vec<Diagnostic>) {
        (self.outcome, self.state, self.diagnostics)
    }
}

impl<Host: AuthProvisionHost> AuthProvisionResultProjection<Host> {
    /// Project a completed engine outcome into the lower-owned result carrier.
    /// This is a data projection, not a commit or admission primitive.
    #[doc(hidden)]
    pub fn project_committed(
        self,
        outcome: Host::Outcome,
        state: AuthModeStateRecord,
        diagnostics: Vec<Diagnostic>,
    ) -> AuthProvisionCommit<Host> {
        AuthProvisionCommit {
            outcome,
            state,
            diagnostics,
            host: PhantomData,
        }
    }
}

/// Lower-owned carrier port implemented by the engine coordinator.
///
/// @ref LLP 0276#phases — the auth owner declares the inter-crate carrier
///   protocol while the higher engine keeps its `LocalSnapback` implementation.
///
/// Implementing this trait grants no storage or commit authority. Preparation
/// creates untrusted owned input only after reproducing the supplied deployment
/// identity; the engine repeats all state-sensitive admission at the classified
/// durable cut.
#[doc(hidden)]
pub trait AuthProvisionHost {
    type Routes;
    type ApiEnvelope;
    type Outcome;

    fn validate_auth_provision_carrier(
        &mut self,
        requested_mode: AuthMode,
        artifacts: &StartupArtifacts,
        deployment: &DeploymentIdentity,
        routes: Option<&Self::Routes>,
        api_envelope: Option<&Self::ApiEnvelope>,
    ) -> SnapbackResult<()>;
}
