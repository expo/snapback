//! SQLite persistence for LLP 0058's four-key staged auth-mode protocol.

// @ref LLP 0058#the-four-keys — these exact metadata keys are the sole durable
// mode authority and are always cross-validated before mutation.
// @ref LLP 0058#corrupt-state-boundary — corrupt state is a read-only startup
// refusal; quarantine is reserved for a valid pending snapshot.
// @ref LLP 0058#crash-and-publication-traces — each state transition has one
// SQLite commit boundary and no guessed repair path.

use super::{
    LocalDatabase, create_index, create_or_update_table, current_version_on, next_storage_version,
    physical_user_tables, reject_field_retypes, reject_unsafe_required_field_changes, schema_table,
    seed_into_transaction, set_version, validate_enum_domain_evolution,
    validate_managed_row_versions, validate_managed_table_versions_by_name, validate_schema,
};
use crate::auth::mode::{
    AUTH_MODE_FORMAT_VERSION, AppDataAvailability, AuthModeQuarantine, AuthModeStateRecord,
    AuthModeStatus, AuthProgramReadiness, DeploymentIdentity, LEGACY_MANIFEST_POISON,
    StagedAuthModeRecord, mode_corrupt,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{AuthMode, FunctionManifest, SchemaManifest, SeedData};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use std::collections::BTreeMap;

fn manifest_password_identifier_mode(
    manifest: &SchemaManifest,
) -> super::auth::PasswordIdentifierMode {
    manifest.effective_auth_password_identifier_mode().into()
}

fn manifest_explicitly_declares_password_identifier_mode(manifest: &SchemaManifest) -> bool {
    manifest
        .auth
        .is_some_and(|auth| auth.password_identifier_mode.is_some())
}

pub const META_LEGACY_SCHEMA_MANIFEST: &str = "schema_manifest";
pub const META_CAPABILITY_AWARE_SCHEMA_MANIFEST: &str = "schema_manifest_capability_aware";
pub const META_STAGED_AUTH_MODE_MANIFEST: &str = "schema_manifest_staged_auth_mode";
pub const META_AUTH_MODE_STATE: &str = "auth_mode_state_v1";

#[derive(Clone, Debug, PartialEq)]
pub struct AuthModeSnapshot {
    pub state: AuthModeStateRecord,
    pub staged: Option<StagedAuthModeRecord>,
    pub active_manifest: Option<SchemaManifest>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthModeDowngradeResult {
    pub state: AuthModeStateRecord,
    pub sessions_revoked: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NetworkSeedOutcome {
    SkippedAbsent,
    Seeded,
    SkippedNonempty,
}

/// Exact authorization projection produced by the same SQLite transaction as
/// a same-mode deployment. The storage interlock consumes one clone for room
/// authority; the local runtime consumes this returned clone before reopening
/// app admission so durable subscriptions cannot remain on the predecessor.
///
/// @ref LLP 0058#same-mode-provisioning — sessions activation returns the
/// exact durable authorization witness and commit floor for pre-reopen local
/// projection.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkDeploymentAuthorization {
    pub witness: super::AuthorizationCommitWitness,
    pub min_commit_version: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkDeploymentCommit {
    pub seed_outcome: NetworkSeedOutcome,
    pub activation_changed: bool,
    pub state: AuthModeStateRecord,
    pub authorization: Option<NetworkDeploymentAuthorization>,
    pub projection_publications: Vec<super::PendingProjectionPublication>,
}

impl NetworkSeedOutcome {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SkippedAbsent => "skipped-absent",
            Self::Seeded => "seeded",
            Self::SkippedNonempty => "skipped-nonempty",
        }
    }
}

/// Explicit SQLite commit certainty for mode-authority writes. Callers may
/// preserve or reopen a predecessor only for `RolledBack`; `Uncertain` means
/// the process must fail closed and recover by reopening durable storage.
#[derive(Debug)]
pub enum DurableModeCommit<T> {
    Committed(T),
    RolledBack(SnapbackError),
    Uncertain(SnapbackError),
}

impl<T> DurableModeCommit<T> {
    fn into_result(self) -> SnapbackResult<T> {
        match self {
            Self::Committed(value) => Ok(value),
            Self::RolledBack(error) | Self::Uncertain(error) => Err(error),
        }
    }
}

#[derive(Clone, Debug)]
pub(super) enum OpenAuthModeInspection {
    Fresh,
    // Both classified states own a large schema snapshot. Keep the carrier
    // small because commit reconciliation moves it through several outcomes.
    Legacy {
        raw_manifest: String,
        manifest: Box<SchemaManifest>,
    },
    Managed(Box<AuthModeSnapshot>),
}

impl OpenAuthModeInspection {
    pub(super) fn active_manifest(&self) -> Option<&SchemaManifest> {
        match self {
            Self::Fresh => None,
            Self::Legacy { manifest, .. } => Some(manifest.as_ref()),
            Self::Managed(snapshot) => snapshot.active_manifest.as_ref(),
        }
    }
}

#[cfg(any(test, feature = "test-support"))]
thread_local! {
    static FAIL_AUTH_MODE_TRANSACTION_AFTER_STEP: std::cell::Cell<Option<usize>> =
        const { std::cell::Cell::new(None) };
    static BEFORE_AUTH_MODE_CONSUME_TRANSACTION: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        const { std::cell::RefCell::new(None) };
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AuthModeCommitBoundary {
    BeforeCommit,
    #[cfg(any(test, feature = "test-support"))]
    AfterRollback,
    AfterCommit,
}

#[cfg(any(test, feature = "test-support"))]
thread_local! {
    static FAIL_AUTH_MODE_COMMIT_BOUNDARY: std::cell::Cell<Option<AuthModeCommitBoundary>> =
        const { std::cell::Cell::new(None) };
}

#[cfg(any(test, feature = "test-support"))]
fn inject_auth_mode_failure_after_step(step: usize) {
    FAIL_AUTH_MODE_TRANSACTION_AFTER_STEP.with(|slot| {
        assert!(slot.get().is_none(), "auth-mode hook must be one-shot");
        slot.set(Some(step));
    });
}

#[cfg(any(test, feature = "test-support"))]
fn inject_before_auth_mode_consume_transaction(callback: impl FnOnce() + 'static) {
    BEFORE_AUTH_MODE_CONSUME_TRANSACTION.with(|slot| {
        assert!(
            slot.borrow().is_none(),
            "auth-mode consume hook must be one-shot"
        );
        *slot.borrow_mut() = Some(Box::new(callback));
    });
}

fn before_auth_mode_consume_transaction() {
    #[cfg(any(test, feature = "test-support"))]
    BEFORE_AUTH_MODE_CONSUME_TRANSACTION.with(|slot| {
        if let Some(callback) = slot.borrow_mut().take() {
            callback();
        }
    });
}

#[cfg(any(test, feature = "test-support"))]
fn inject_auth_mode_commit_boundary_failure(boundary: AuthModeCommitBoundary) {
    FAIL_AUTH_MODE_COMMIT_BOUNDARY.with(|slot| {
        assert!(
            slot.get().is_none(),
            "auth-mode commit hook must be one-shot"
        );
        slot.set(Some(boundary));
    });
}

fn commit_boundary_completed(boundary: AuthModeCommitBoundary) -> SnapbackResult<()> {
    #[cfg(not(any(test, feature = "test-support")))]
    let _ = boundary;
    #[cfg(any(test, feature = "test-support"))]
    FAIL_AUTH_MODE_COMMIT_BOUNDARY.with(|slot| {
        if slot.get() == Some(boundary) {
            slot.set(None);
            return Err(SnapbackError::error(
                "TEST_AUTH_MODE_COMMIT_BOUNDARY_FAILURE",
                "auth",
                format!("injected auth-mode {boundary:?} failure"),
            ));
        }
        Ok(())
    })?;
    Ok(())
}

fn commit_mode_sqlite_transaction(tx: &Transaction<'_>) -> SnapbackResult<()> {
    #[cfg(any(test, feature = "test-support"))]
    if let Err(error) = commit_boundary_completed(AuthModeCommitBoundary::AfterRollback) {
        tx.execute_batch("ROLLBACK")?;
        return Err(error);
    }
    tx.execute_batch("COMMIT")?;
    Ok(())
}

fn transaction_step_completed(step: usize) -> SnapbackResult<()> {
    #[cfg(not(any(test, feature = "test-support")))]
    let _ = step;
    #[cfg(any(test, feature = "test-support"))]
    FAIL_AUTH_MODE_TRANSACTION_AFTER_STEP.with(|slot| {
        if slot.get() == Some(step) {
            slot.set(None);
            return Err(SnapbackError::error(
                "TEST_AUTH_MODE_TRANSACTION_FAILURE",
                "auth",
                "injected auth-mode transaction failure",
            ));
        }
        Ok(())
    })?;
    Ok(())
}

/// Execute one mode-authority transaction and classify its durable result by
/// exact reread whenever SQLite does not give the caller a clean boundary.
/// Transaction-body failures count as rolled back only after an explicit
/// rollback succeeds (or an exact predecessor reread proves it).
/// `track_data_marker` is required when the body may change app/auth state
/// without changing the mode snapshot; pure mode transitions use their exact
/// predecessor and successor snapshots and avoid an unnecessary version read.
#[derive(Clone, Debug, Eq, PartialEq)]
struct ModeCommitMarker {
    app_version: u64,
    authorization: Option<super::AuthorizationVersion>,
}

fn mode_commit_marker_on(conn: &Connection) -> SnapbackResult<ModeCommitMarker> {
    Ok(ModeCommitMarker {
        app_version: current_version_on(conn)?,
        authorization: super::auth_stream::read_authorization_version_on(conn)?,
    })
}

fn commit_mode_transaction<T>(
    conn: &mut Connection,
    predecessor: &AuthModeSnapshot,
    track_data_marker: bool,
    interlock: super::AuthorizationInterlockState,
    commit_authority_identity: &super::ProcessBoundIdentity,
    transaction_body: impl FnOnce(
        &Transaction<'_>,
    ) -> SnapbackResult<(
        T,
        AuthModeSnapshot,
        Option<(super::AuthorizationCommitWitness, u64)>,
    )>,
) -> DurableModeCommit<T> {
    let tx = match conn.transaction_with_behavior(TransactionBehavior::Immediate) {
        Ok(tx) => tx,
        Err(error) => return DurableModeCommit::RolledBack(error.into()),
    };
    let predecessor_marker = if track_data_marker {
        match mode_commit_marker_on(&tx) {
            Ok(marker) => Some(marker),
            Err(error) => {
                return rollback_mode_transaction(&tx, predecessor, None, error);
            }
        }
    } else {
        None
    };
    let (output, successor, authorization) = match transaction_body(&tx) {
        Ok(prepared) => prepared,
        Err(error) => {
            return rollback_mode_transaction(&tx, predecessor, predecessor_marker.as_ref(), error);
        }
    };
    let successor_marker = if track_data_marker {
        match mode_commit_marker_on(&tx) {
            Ok(marker) => Some(marker),
            Err(error) => {
                return rollback_mode_transaction(
                    &tx,
                    predecessor,
                    predecessor_marker.as_ref(),
                    error,
                );
            }
        }
    } else {
        None
    };
    if let (Some(predecessor_marker), Some(successor_marker)) =
        (predecessor_marker.as_ref(), successor_marker.as_ref())
    {
        let expected_authorization = authorization
            .as_ref()
            .map(|(witness, _)| Some(witness.version.clone()))
            .unwrap_or_else(|| predecessor_marker.authorization.clone());
        if successor_marker.authorization != expected_authorization {
            return rollback_mode_transaction(
                &tx,
                predecessor,
                Some(predecessor_marker),
                mode_corrupt("auth-mode transaction produced a mismatched authorization successor"),
            );
        }
    }
    if let Err(error) = commit_boundary_completed(AuthModeCommitBoundary::BeforeCommit) {
        return rollback_mode_transaction(&tx, predecessor, predecessor_marker.as_ref(), error);
    }
    let prepared = match authorization.as_ref() {
        Some((witness, _)) if witness.event => match super::prepare_authorization_commit_interlock(
            witness,
            super::AuthorizationCommitImpact::AllProtectedRooms,
            &interlock,
            commit_authority_identity,
            predecessor_marker
                .as_ref()
                .and_then(|marker| marker.authorization.as_ref()),
        ) {
            Ok(prepared) => prepared,
            Err(error) => {
                return rollback_mode_transaction(
                    &tx,
                    predecessor,
                    predecessor_marker.as_ref(),
                    error,
                );
            }
        },
        _ => None,
    };
    let durable = if let Err(error) = commit_mode_sqlite_transaction(&tx) {
        if !tx.is_autocommit() && tx.execute_batch("ROLLBACK").is_ok() {
            DurableModeCommit::RolledBack(error)
        } else if tx.is_autocommit() {
            reconcile_mode_commit(
                &tx,
                predecessor,
                predecessor_marker.as_ref(),
                &successor,
                successor_marker.as_ref(),
                output,
                error,
            )
        } else {
            DurableModeCommit::Uncertain(error)
        }
    } else if let Err(error) = commit_boundary_completed(AuthModeCommitBoundary::AfterCommit) {
        reconcile_mode_commit(
            &tx,
            predecessor,
            predecessor_marker.as_ref(),
            &successor,
            successor_marker.as_ref(),
            output,
            error,
        )
    } else {
        DurableModeCommit::Committed(output)
    };
    match (durable, prepared, authorization) {
        (DurableModeCommit::Committed(output), Some(prepared), Some((_, min_version))) => {
            match prepared.finalize_committed(min_version) {
                Ok(()) => DurableModeCommit::Committed(output),
                Err(error) => DurableModeCommit::Uncertain(error),
            }
        }
        (DurableModeCommit::RolledBack(error), prepared, _) => {
            drop(prepared);
            DurableModeCommit::RolledBack(error)
        }
        (DurableModeCommit::Uncertain(error), Some(prepared), _) => {
            prepared.finalize_ambiguous();
            DurableModeCommit::Uncertain(error)
        }
        (durable, _, _) => durable,
    }
}

fn rollback_mode_transaction<T>(
    tx: &Transaction<'_>,
    predecessor: &AuthModeSnapshot,
    predecessor_marker: Option<&ModeCommitMarker>,
    error: SnapbackError,
) -> DurableModeCommit<T> {
    if !tx.is_autocommit() && tx.execute_batch("ROLLBACK").is_ok() {
        return DurableModeCommit::RolledBack(error);
    }
    let predecessor_is_durable = match predecessor_marker {
        Some(marker) => durable_mode_state_matches(tx, predecessor, marker),
        None => matches!(
            inspect_mode_durable_state(tx, false),
            Ok(Some((observed, None))) if &observed == predecessor
        ),
    };
    if tx.is_autocommit() && predecessor_is_durable {
        DurableModeCommit::RolledBack(error)
    } else {
        DurableModeCommit::Uncertain(error)
    }
}

fn reconcile_mode_commit<T>(
    conn: &Connection,
    predecessor: &AuthModeSnapshot,
    predecessor_marker: Option<&ModeCommitMarker>,
    successor: &AuthModeSnapshot,
    successor_marker: Option<&ModeCommitMarker>,
    output: T,
    error: SnapbackError,
) -> DurableModeCommit<T> {
    match inspect_mode_durable_state(conn, successor_marker.is_some()) {
        Ok(Some((observed, marker)))
            if &observed == successor && marker.as_ref() == successor_marker =>
        {
            DurableModeCommit::Committed(output)
        }
        Ok(Some((observed, marker)))
            if &observed == predecessor && marker.as_ref() == predecessor_marker =>
        {
            DurableModeCommit::RolledBack(error)
        }
        _ => DurableModeCommit::Uncertain(error),
    }
}

fn durable_mode_state_matches(
    conn: &Connection,
    expected: &AuthModeSnapshot,
    expected_marker: &ModeCommitMarker,
) -> bool {
    matches!(
        inspect_mode_durable_state(conn, true),
        Ok(Some((observed, marker)))
            if &observed == expected && marker.as_ref() == Some(expected_marker)
    )
}

fn inspect_mode_durable_state(
    conn: &Connection,
    include_marker: bool,
) -> SnapbackResult<Option<(AuthModeSnapshot, Option<ModeCommitMarker>)>> {
    let tx = conn.unchecked_transaction()?;
    let state = match inspect_for_open(&tx)? {
        OpenAuthModeInspection::Managed(snapshot) => Some((
            *snapshot,
            include_marker
                .then(|| mode_commit_marker_on(&tx))
                .transpose()?,
        )),
        OpenAuthModeInspection::Fresh | OpenAuthModeInspection::Legacy { .. } => None,
    };
    tx.commit()?;
    Ok(state)
}

impl LocalDatabase {
    pub fn auth_mode_snapshot(&self) -> SnapbackResult<AuthModeSnapshot> {
        match inspect_for_open(&self.conn)? {
            OpenAuthModeInspection::Managed(snapshot) => Ok(*snapshot),
            OpenAuthModeInspection::Fresh | OpenAuthModeInspection::Legacy { .. } => Err(
                mode_corrupt("an open database has not adopted the auth-mode record"),
            ),
        }
    }

    /// Stage a complete transition. The caller has already closed invocation
    /// admission and preflighted the function half; storage revalidates the
    /// durable state and schema half under an IMMEDIATE transaction.
    #[cfg(any(test, feature = "test-support"))]
    pub fn stage_auth_mode(
        &mut self,
        requested_deployment: DeploymentIdentity,
        schema_manifest: SchemaManifest,
        seed: Option<SeedData>,
    ) -> SnapbackResult<AuthModeStateRecord> {
        self.stage_auth_mode_inner(
            requested_deployment,
            schema_manifest,
            BTreeMap::new(),
            None,
            seed,
        )
        .into_result()
    }

    pub fn stage_auth_mode_with_functions(
        &mut self,
        requested_deployment: DeploymentIdentity,
        schema_manifest: SchemaManifest,
        functions: &FunctionManifest,
        seed: Option<SeedData>,
    ) -> SnapbackResult<AuthModeStateRecord> {
        require_complete_deployment_pair(&requested_deployment, &schema_manifest, functions)?;
        self.stage_auth_mode_inner(
            requested_deployment,
            schema_manifest,
            super::sequence_declarations_from_function_manifest(functions),
            Some(functions.clone()),
            seed,
        )
        .into_result()
    }

    #[cfg(test)]
    pub fn stage_auth_mode_classified(
        &mut self,
        requested_deployment: DeploymentIdentity,
        schema_manifest: SchemaManifest,
        seed: Option<SeedData>,
    ) -> DurableModeCommit<AuthModeStateRecord> {
        self.stage_auth_mode_inner(
            requested_deployment,
            schema_manifest,
            BTreeMap::new(),
            None,
            seed,
        )
    }

    pub fn stage_auth_mode_with_functions_classified(
        &mut self,
        requested_deployment: DeploymentIdentity,
        schema_manifest: SchemaManifest,
        functions: &FunctionManifest,
        seed: Option<SeedData>,
    ) -> DurableModeCommit<AuthModeStateRecord> {
        if let Err(error) =
            require_complete_deployment_pair(&requested_deployment, &schema_manifest, functions)
        {
            return DurableModeCommit::RolledBack(error);
        }
        self.stage_auth_mode_inner(
            requested_deployment,
            schema_manifest,
            super::sequence_declarations_from_function_manifest(functions),
            Some(functions.clone()),
            seed,
        )
    }

    fn stage_auth_mode_inner(
        &mut self,
        requested_deployment: DeploymentIdentity,
        schema_manifest: SchemaManifest,
        sequence_declarations: BTreeMap<String, crate::manifest::SequenceDeclaration>,
        trusted_predecessor_functions: Option<FunctionManifest>,
        seed: Option<SeedData>,
    ) -> DurableModeCommit<AuthModeStateRecord> {
        let _writer_token = match self
            .writer_authority
            .enter(super::write_authority::LocalWriterLaneV1::SchemaActivation)
        {
            Ok(token) => token,
            Err(error) => return DurableModeCommit::RolledBack(error),
        };
        let predecessor = match (|| -> SnapbackResult<_> {
            requested_deployment.validate()?;
            requested_deployment.validate_schema_half(&schema_manifest)?;
            validate_schema(&schema_manifest)?;
            reject_field_retypes(&self.schema, &schema_manifest)?;
            reject_unsafe_required_field_changes(&self.conn, &self.schema, &schema_manifest)?;

            let current = self.auth_mode_snapshot()?;
            require_transition_source(&current.state, requested_deployment.auth_mode)?;
            if seed.is_some() {
                require_fresh_seed_target(&self.conn, &current.state)?;
            }
            Ok(current)
        })() {
            Ok(predecessor) => predecessor,
            Err(error) => return DurableModeCommit::RolledBack(error),
        };
        let authorization_interlock = self.authorization_interlock.clone();
        let commit_authority_identity = self.commit_authority_identity.clone();
        let order_field_bounds = self.order_field_bounds.clone();
        let mut predecessor_sequence_declarations = BTreeMap::new();
        let exact_active_predecessor =
            trusted_predecessor_functions
                .as_ref()
                .is_some_and(|functions| {
                    predecessor.active_manifest.as_ref().is_some_and(|schema| {
                        DeploymentIdentity::from_manifests(
                            predecessor.state.active,
                            schema,
                            functions,
                        )
                        .ok()
                        .as_ref()
                            == predecessor.state.active_deployment.as_ref()
                    })
                });
        if exact_active_predecessor {
            predecessor_sequence_declarations.extend(self.sequence_declarations.as_ref().clone());
            predecessor_sequence_declarations.extend(sequence_declarations.clone());
        }
        let trusted_relation_parent_tables = predecessor
            .active_manifest
            .as_ref()
            .map(super::schema_relation_parent_tables)
            .unwrap_or_default()
            .into_iter()
            .map(ToOwned::to_owned)
            .collect();
        let predecessor_schema = self.schema.clone();
        let track_data_marker = seed.is_some();
        commit_mode_transaction(
            &mut self.conn,
            &predecessor,
            track_data_marker,
            authorization_interlock,
            &commit_authority_identity,
            |tx| {
                let current = require_managed_snapshot(tx)?;
                if current != predecessor {
                    return Err(mode_corrupt(
                        "auth-mode snapshot changed before the staging transaction",
                    ));
                }
                require_transition_source(&current.state, requested_deployment.auth_mode)?;
                super::auth::require_password_identifier_mode_declaration_on(
                    tx,
                    manifest_password_identifier_mode(&schema_manifest),
                    manifest_explicitly_declares_password_identifier_mode(&schema_manifest),
                )?;
                if seed.is_some() {
                    require_fresh_seed_target(tx, &current.state)?;
                }
                validate_enum_domain_evolution(tx, &predecessor_schema, &schema_manifest)?;
                let predecessor_head = current_version_on(tx)?;
                super::preflight_membership_activation_sources(
                    tx,
                    &schema_manifest,
                    predecessor_head,
                )?;

                // One final-state activation sequence on every deployment lane:
                // tables/columns -> same-transaction seed -> membership scan ->
                // generated/user indexes. The scan must judge the state that
                // will actually activate, and typed duplicate/null/role errors
                // must precede raw SQLite constraint failures.
                // @ref LLP 0056#declaring-a-membership-table
                apply_schema_tables(tx, &schema_manifest)?;
                crate::storage::stream_transcripts::activate_manifests_in(
                    tx,
                    &schema_manifest,
                    trusted_predecessor_functions.as_ref(),
                )?;
                super::preflight_sequence_enrollments(
                    tx,
                    &schema_manifest,
                    &trusted_relation_parent_tables,
                    &predecessor_sequence_declarations,
                    &sequence_declarations,
                )?;
                transaction_step_completed(0)?;

                let authorization = if let Some(seed) = seed {
                    let next_version = next_storage_version(current_version_on(tx)?)?;
                    let changes = seed_into_transaction(
                        tx,
                        &schema_manifest,
                        seed,
                        next_version,
                        &order_field_bounds,
                    )?;
                    if !changes.is_empty() {
                        set_version(tx, next_version)?;
                    }
                    let authorization = super::authorization::authorization_commit_hook_in(
                        tx,
                        super::authorization::AuthorizationCommitCause::AppWrites {
                            schema: &schema_manifest,
                            changes: &changes,
                        },
                    )?;
                    Some((authorization, current_version_on(tx)?))
                } else {
                    None
                };
                transaction_step_completed(1)?;
                super::validate_membership_activation(
                    tx,
                    &schema_manifest,
                    current_version_on(tx)?,
                )?;
                super::validate_sequence_activation(tx, &schema_manifest, &sequence_declarations)?;
                apply_schema_indexes(tx, &schema_manifest)?;
                crate::search::sqlite::activate_manifest_in_tx(
                    tx,
                    &schema_manifest,
                    current_version_on(tx)?,
                )?;
                crate::vector::sqlite::stage_manifest_in_tx(
                    tx,
                    &schema_manifest,
                    current_version_on(tx)?,
                )?;

                let generation = current.state.next_generation()?;
                let staged = StagedAuthModeRecord {
                    format_version: AUTH_MODE_FORMAT_VERSION,
                    transition_generation: generation,
                    requested_deployment: requested_deployment.clone(),
                    schema_manifest,
                };
                let next = AuthModeStateRecord {
                    format_version: AUTH_MODE_FORMAT_VERSION,
                    transition_generation: generation,
                    active: current.state.active,
                    desired: requested_deployment.auth_mode,
                    mode_state: AuthModeStatus::PendingRestart,
                    app_data_availability: AppDataAvailability::RefusedPending,
                    sessions_ever_activated: current.state.sessions_ever_activated,
                    active_deployment: current.state.active_deployment,
                    requested_deployment: Some(requested_deployment),
                    quarantine: None,
                };
                next.validate_shape()?;
                staged.validate_against(&next)?;
                save_json_meta(tx, META_STAGED_AUTH_MODE_MANIFEST, &staged)?;
                transaction_step_completed(2)?;
                save_json_meta(tx, META_AUTH_MODE_STATE, &next)?;
                transaction_step_completed(3)?;
                let observed = require_managed_snapshot(tx)?;
                let successor = AuthModeSnapshot {
                    state: next.clone(),
                    staged: Some(staged),
                    active_manifest: predecessor.active_manifest.clone(),
                };
                if observed != successor {
                    return Err(mode_corrupt(
                        "staged auth-mode transaction did not produce its exact successor",
                    ));
                }
                Ok((next, successor, authorization))
            },
        )
    }

    pub fn quarantine_auth_mode(&mut self, code: &str) -> SnapbackResult<AuthModeStateRecord> {
        if !valid_quarantine_code(code) {
            return Err(mode_corrupt(
                "quarantine code is not a stable Snapback diagnostic",
            ));
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = require_managed_snapshot(&tx)?;
        if !matches!(
            current.state.mode_state,
            AuthModeStatus::PendingRestart | AuthModeStatus::Quarantined
        ) {
            return Err(mode_corrupt(
                "only a valid pending transition can be quarantined",
            ));
        }
        let mut staged = current
            .staged
            .ok_or_else(|| mode_corrupt("pending transition lacks its staged record"))?;
        let generation = current.state.next_generation()?;
        staged.transition_generation = generation;
        let next = AuthModeStateRecord {
            transition_generation: generation,
            mode_state: AuthModeStatus::Quarantined,
            quarantine: Some(AuthModeQuarantine {
                transition_generation: generation,
                code: code.to_owned(),
            }),
            ..current.state
        };
        next.validate_shape()?;
        staged.validate_against(&next)?;
        save_json_meta(&tx, META_STAGED_AUTH_MODE_MANIFEST, &staged)?;
        save_json_meta(&tx, META_AUTH_MODE_STATE, &next)?;
        require_managed_snapshot(&tx)?;
        tx.commit()?;
        Ok(next)
    }

    pub fn unstage_auth_mode(&mut self) -> SnapbackResult<AuthModeStateRecord> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = require_managed_snapshot(&tx)?;
        if !matches!(
            current.state.mode_state,
            AuthModeStatus::PendingRestart | AuthModeStatus::Quarantined
        ) {
            return Err(mode_corrupt(
                "there is no pending auth-mode transition to clear",
            ));
        }
        let next = AuthModeStateRecord {
            transition_generation: current.state.next_generation()?,
            desired: current.state.active,
            mode_state: AuthModeStatus::Settled,
            app_data_availability: AppDataAvailability::Available,
            requested_deployment: None,
            quarantine: None,
            ..current.state
        };
        next.validate_shape()?;
        tx.execute(
            "DELETE FROM _snapback_meta WHERE key = ?1",
            params![META_STAGED_AUTH_MODE_MANIFEST],
        )?;
        save_json_meta(&tx, META_AUTH_MODE_STATE, &next)?;
        require_managed_snapshot(&tx)?;
        tx.commit()?;
        Ok(next)
    }

    /// Consume dev -> sessions after the caller has prepared the bundle and a
    /// usable keyring. Catalog DDL, active manifest relocation, poison, staged
    /// deletion, and settled state share this one commit.
    #[cfg(any(test, feature = "test-support"))]
    pub fn consume_sessions_auth_mode(
        &mut self,
        readiness: &AuthProgramReadiness,
    ) -> SnapbackResult<AuthModeStateRecord> {
        self.consume_sessions_auth_mode_inner(readiness, None, None)
    }

    pub fn consume_sessions_auth_mode_with_functions(
        &mut self,
        readiness: &AuthProgramReadiness,
        functions: &FunctionManifest,
    ) -> SnapbackResult<AuthModeStateRecord> {
        self.consume_sessions_auth_mode_inner(readiness, Some(functions), None)
    }

    pub fn consume_sessions_auth_mode_with_functions_and_catalog_activation(
        &mut self,
        readiness: &AuthProgramReadiness,
        functions: &FunctionManifest,
        activation: &crate::auth::keyring::PreparedAuthCatalogActivation,
    ) -> SnapbackResult<AuthModeStateRecord> {
        self.consume_sessions_auth_mode_inner(readiness, Some(functions), Some(activation))
    }

    fn consume_sessions_auth_mode_inner(
        &mut self,
        readiness: &AuthProgramReadiness,
        functions: Option<&FunctionManifest>,
        activation: Option<&crate::auth::keyring::PreparedAuthCatalogActivation>,
    ) -> SnapbackResult<AuthModeStateRecord> {
        let _writer_token = self
            .writer_authority
            .enter(super::write_authority::LocalWriterLaneV1::SchemaActivation)?;
        let current = self.auth_mode_snapshot()?;
        require_pending_direction(&current, AuthMode::Dev, AuthMode::Sessions)?;
        readiness.validate()?;
        if !readiness.session_activation_ready {
            self.quarantine_auth_mode("SNAPBACK_AUTH_POLICY_UNAVAILABLE")?;
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "session activation prerequisites are unavailable",
            ));
        }

        before_auth_mode_consume_transaction();
        let authorization_interlock = self.authorization_interlock.clone();
        let commit_authority_identity = self.commit_authority_identity.clone();
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = require_managed_snapshot(&tx)?;
        require_pending_direction(&current, AuthMode::Dev, AuthMode::Sessions)?;
        let staged = current
            .staged
            .ok_or_else(|| mode_corrupt("sessions consume lacks a staged manifest"))?;
        if let Some(functions) = functions {
            require_complete_deployment_pair(
                &staged.requested_deployment,
                &staged.schema_manifest,
                functions,
            )?;
        }
        let password_mode = manifest_password_identifier_mode(&staged.schema_manifest);
        if let Some(activation) = activation {
            crate::storage::auth::activate_current_auth_catalog_with_password_identifier_mode_and_origin_in(
                &tx,
                password_mode,
                Some(activation.origin()),
            )?;
        } else if manifest_explicitly_declares_password_identifier_mode(&staged.schema_manifest) {
            crate::storage::auth::activate_current_auth_catalog_with_password_identifier_mode_in(
                &tx,
                password_mode,
            )?;
        } else {
            crate::storage::auth::activate_current_auth_catalog_in(&tx)?;
        }
        // @ref LLP 0143#d1-device-token-custody — schema staging precedes the
        // sessions catalog. Install the generation-fenced token-retirement
        // triggers after their auth tables exist, in this same activation cut.
        crate::push::activate_manifest_in(&tx, staged.schema_manifest.push_seam.as_ref())?;
        crate::storage::auth_integrations::activate_manifest_in(&tx, &staged.schema_manifest)?;
        crate::storage::declared_clients::activate_manifest_in(&tx, &staged.schema_manifest)?;
        crate::storage::capability_links::activate_manifest_in(&tx, &staged.schema_manifest)?;
        crate::storage::pending_effects::activate_manifest_in(&tx, &staged.schema_manifest)?;
        crate::storage::webhooks::activate_manifest_in(&tx, &staged.schema_manifest)?;
        crate::storage::watches::activate_manifest_in(&tx, &staged.schema_manifest)?;
        crate::storage::ask_spend::activate_manifest_in(&tx, &staged.schema_manifest)?;
        crate::storage::stream_transcripts::activate_manifests_in(
            &tx,
            &staged.schema_manifest,
            functions,
        )?;
        // @ref LLP 0055#grants — initial sessions activation seeds the durable
        //   exact-function basis rows in the same cut as the existing LLP 0053
        //   activation event. No grant can observe an empty/intermediate set.
        if let Some(functions) = functions {
            super::auth_scope_bases::reconcile_auth_scope_bases_with_schema_on(
                &tx,
                functions,
                &staged.schema_manifest,
            )?;
        }
        transaction_step_completed(0)?;

        let schema_json = serialize_json(&staged.schema_manifest)?;
        save_raw_meta(&tx, META_CAPABILITY_AWARE_SCHEMA_MANIFEST, &schema_json)?;
        transaction_step_completed(1)?;
        save_raw_meta(&tx, META_LEGACY_SCHEMA_MANIFEST, LEGACY_MANIFEST_POISON)?;
        transaction_step_completed(2)?;
        tx.execute(
            "DELETE FROM _snapback_meta WHERE key = ?1",
            params![META_STAGED_AUTH_MODE_MANIFEST],
        )?;

        let next = AuthModeStateRecord {
            transition_generation: current.state.next_generation()?,
            active: AuthMode::Sessions,
            desired: AuthMode::Sessions,
            mode_state: AuthModeStatus::Settled,
            app_data_availability: AppDataAvailability::Available,
            sessions_ever_activated: true,
            active_deployment: Some(staged.requested_deployment),
            requested_deployment: None,
            quarantine: None,
            ..current.state
        };
        next.validate_shape()?;
        save_json_meta(&tx, META_AUTH_MODE_STATE, &next)?;
        transaction_step_completed(3)?;
        let authorization_predecessor = super::auth_stream::read_authorization_version_on(&tx)?;
        let authorization = super::authorization::authorization_commit_hook_in(
            &tx,
            super::authorization::AuthorizationCommitCause::Activation,
        )?;
        require_managed_snapshot(&tx)?;
        let min_commit_version = current_version_on(&tx)?;
        super::commit_with_authorization_interlock(
            tx,
            &authorization,
            super::AuthorizationCommitImpact::AllProtectedRooms,
            authorization_predecessor,
            min_commit_version,
            authorization_interlock,
            &commit_authority_identity,
        )?;
        self.replace_active_schema(staged.schema_manifest);
        Ok(next)
    }

    #[cfg(test)]
    pub fn consume_dev_downgrade(
        &mut self,
        allow_auth_downgrade: bool,
        now_ms: u64,
    ) -> SnapbackResult<AuthModeDowngradeResult> {
        self.consume_dev_downgrade_inner(allow_auth_downgrade, now_ms, None)
    }

    pub fn consume_dev_downgrade_with_functions(
        &mut self,
        allow_auth_downgrade: bool,
        now_ms: u64,
        functions: &FunctionManifest,
    ) -> SnapbackResult<AuthModeDowngradeResult> {
        self.consume_dev_downgrade_inner(allow_auth_downgrade, now_ms, Some(functions))
    }

    fn consume_dev_downgrade_inner(
        &mut self,
        allow_auth_downgrade: bool,
        now_ms: u64,
        functions: Option<&FunctionManifest>,
    ) -> SnapbackResult<AuthModeDowngradeResult> {
        let _writer_token = self
            .writer_authority
            .enter(super::write_authority::LocalWriterLaneV1::SchemaActivation)?;
        let current = self.auth_mode_snapshot()?;
        require_pending_direction(&current, AuthMode::Sessions, AuthMode::Dev)?;
        if !allow_auth_downgrade {
            self.quarantine_auth_mode("SNAPBACK_AUTH_MODE_DOWNGRADE")?;
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_MODE_DOWNGRADE",
                "auth",
                "sessions-to-dev consume requires the explicit downgrade flag",
            ));
        }
        if now_ms > 9_007_199_254_740_991 {
            return Err(mode_corrupt(
                "downgrade revocation time is outside the portable range",
            ));
        }

        before_auth_mode_consume_transaction();
        let authorization_interlock = self.authorization_interlock.clone();
        let commit_authority_identity = self.commit_authority_identity.clone();
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = require_managed_snapshot(&tx)?;
        require_pending_direction(&current, AuthMode::Sessions, AuthMode::Dev)?;
        let staged = current
            .staged
            .ok_or_else(|| mode_corrupt("downgrade consume lacks a staged manifest"))?;
        if let Some(functions) = functions {
            require_complete_deployment_pair(
                &staged.requested_deployment,
                &staged.schema_manifest,
                functions,
            )?;
        }
        let catalog = crate::storage::auth::inspect_auth_catalog_on(&tx)?;
        let sessions_revoked = crate::storage::auth::revoke_all_sessions_in(
            &tx,
            now_ms,
            crate::contract_types::RevocationReason::ModeTransition,
        )?;
        // @ref LLP 0055#companion-obligations — downgrade ends all agent
        // bearer and pending-consent authority in the same transaction as
        // browser-session revocation; principals and scope tombstones survive.
        if matches!(
            catalog,
            crate::storage::auth::AuthCatalogState::ReadyV2
                | crate::storage::auth::AuthCatalogState::ReadyV3
                | crate::storage::auth::AuthCatalogState::ReadyV4
        ) {
            crate::storage::auth::terminate_agent_authority_in(&tx)?;
        }
        transaction_step_completed(0)?;

        let schema_json = serialize_json(&staged.schema_manifest)?;
        save_raw_meta(&tx, META_CAPABILITY_AWARE_SCHEMA_MANIFEST, &schema_json)?;
        require_legacy_poison(&tx)?;
        tx.execute(
            "DELETE FROM _snapback_meta WHERE key = ?1",
            params![META_STAGED_AUTH_MODE_MANIFEST],
        )?;
        let next = AuthModeStateRecord {
            transition_generation: current.state.next_generation()?,
            active: AuthMode::Dev,
            desired: AuthMode::Dev,
            mode_state: AuthModeStatus::Settled,
            app_data_availability: AppDataAvailability::Available,
            sessions_ever_activated: true,
            active_deployment: Some(staged.requested_deployment),
            requested_deployment: None,
            quarantine: None,
            ..current.state
        };
        next.validate_shape()?;
        save_json_meta(&tx, META_AUTH_MODE_STATE, &next)?;
        transaction_step_completed(1)?;
        let authorization_predecessor = super::auth_stream::read_authorization_version_on(&tx)?;
        let authorization = super::authorization::authorization_commit_hook_in(
            &tx,
            super::authorization::AuthorizationCommitCause::Activation,
        )?;
        require_managed_snapshot(&tx)?;
        let min_commit_version = current_version_on(&tx)?;
        super::commit_with_authorization_interlock(
            tx,
            &authorization,
            super::AuthorizationCommitImpact::AllProtectedRooms,
            authorization_predecessor,
            min_commit_version,
            authorization_interlock,
            &commit_authority_identity,
        )?;
        self.replace_active_schema(staged.schema_manifest);
        Ok(AuthModeDowngradeResult {
            state: next,
            sessions_revoked,
        })
    }

    /// Same-mode deployment update with an exact complete pair identity. This
    /// is the integration seam that atomically advances `activeDeployment`.
    #[cfg(test)]
    pub fn apply_same_mode_schema(
        &mut self,
        deployment: DeploymentIdentity,
        manifest: SchemaManifest,
    ) -> SnapbackResult<()> {
        self.apply_same_mode_deployment(deployment, manifest, None)
    }

    /// Pre-bind same-mode deployment, with an optional seed accepted only for
    /// a truly fresh target. DDL, seed, active manifest, and deployment
    /// identity share one SQLite cut.
    #[cfg(test)]
    pub fn apply_same_mode_deployment(
        &mut self,
        deployment: DeploymentIdentity,
        manifest: SchemaManifest,
        seed: Option<SeedData>,
    ) -> SnapbackResult<()> {
        self.apply_same_mode_deployment_inner(deployment, manifest, BTreeMap::new(), seed)
    }

    /// Cold-start same-mode dev deployment. The complete function half is
    /// required even though dev mode has no persistent grant bases. Sessions
    /// updates use the admission-closed network activation path instead.
    pub fn apply_same_mode_dev_deployment_with_functions(
        &mut self,
        deployment: DeploymentIdentity,
        manifest: SchemaManifest,
        functions: &FunctionManifest,
        seed: Option<SeedData>,
    ) -> SnapbackResult<()> {
        if deployment.auth_mode != AuthMode::Dev {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "sessions same-mode deployment requires the admission-closed activation path",
            ));
        }
        functions.validate_artifact()?;
        let paired = DeploymentIdentity::from_manifests(AuthMode::Dev, &manifest, functions)?;
        if paired != deployment {
            return Err(mode_corrupt(
                "same-mode dev artifacts differ from their deployment identity",
            ));
        }
        self.apply_same_mode_deployment_inner(
            deployment,
            manifest,
            super::sequence_declarations_from_function_manifest(functions),
            seed,
        )
    }

    fn apply_same_mode_deployment_inner(
        &mut self,
        deployment: DeploymentIdentity,
        manifest: SchemaManifest,
        sequence_declarations: BTreeMap<String, crate::manifest::SequenceDeclaration>,
        seed: Option<SeedData>,
    ) -> SnapbackResult<()> {
        let _writer_token = self
            .writer_authority
            .enter(super::write_authority::LocalWriterLaneV1::SchemaActivation)?;
        deployment.validate()?;
        deployment.validate_schema_half(&manifest)?;
        validate_schema(&manifest)?;
        reject_field_retypes(&self.schema, &manifest)?;
        reject_unsafe_required_field_changes(&self.conn, &self.schema, &manifest)?;

        let current = self.auth_mode_snapshot()?;
        require_settled_available(&current.state)?;
        if seed.is_some() {
            require_fresh_seed_target(&self.conn, &current.state)?;
        }

        let authorization_interlock = self.authorization_interlock.clone();
        let commit_authority_identity = self.commit_authority_identity.clone();
        let mut predecessor_sequence_declarations = BTreeMap::new();
        if current.state.active_deployment.as_ref() == Some(&deployment) {
            predecessor_sequence_declarations.extend(self.sequence_declarations.as_ref().clone());
            predecessor_sequence_declarations.extend(sequence_declarations.clone());
        }
        let trusted_relation_parent_tables = current
            .active_manifest
            .as_ref()
            .map(super::schema_relation_parent_tables)
            .unwrap_or_default()
            .into_iter()
            .map(ToOwned::to_owned)
            .collect();
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = require_managed_snapshot(&tx)?;
        require_settled_available(&current.state)?;
        if deployment.auth_mode != current.state.active {
            return Err(mode_corrupt(
                "same-mode deployment differs from active auth mode",
            ));
        }
        super::auth::require_password_identifier_mode_declaration_on(
            &tx,
            manifest_password_identifier_mode(&manifest),
            manifest_explicitly_declares_password_identifier_mode(&manifest),
        )?;
        validate_enum_domain_evolution(&tx, &self.schema, &manifest)?;
        let activation_changed = current.active_manifest.as_ref() != Some(&manifest)
            || current.state.active_deployment.as_ref() != Some(&deployment);
        let predecessor_head = current_version_on(&tx)?;
        super::preflight_membership_activation_sources(&tx, &manifest, predecessor_head)?;
        apply_schema_tables(&tx, &manifest)?;
        super::preflight_sequence_enrollments(
            &tx,
            &manifest,
            &trusted_relation_parent_tables,
            &predecessor_sequence_declarations,
            &sequence_declarations,
        )?;
        let mut seeded_changes = Vec::new();
        if let Some(seed) = seed {
            require_fresh_seed_target(&tx, &current.state)?;
            let next_version = next_storage_version(current_version_on(&tx)?)?;
            seeded_changes = seed_into_transaction(
                &tx,
                &manifest,
                seed,
                next_version,
                &self.order_field_bounds,
            )?;
            if !seeded_changes.is_empty() {
                set_version(&tx, next_version)?;
            }
        }
        super::validate_membership_activation(&tx, &manifest, current_version_on(&tx)?)?;
        super::validate_sequence_activation(&tx, &manifest, &sequence_declarations)?;
        apply_schema_indexes(&tx, &manifest)?;
        crate::search::sqlite::activate_manifest_in_tx(&tx, &manifest, current_version_on(&tx)?)?;
        crate::vector::sqlite::stage_manifest_in_tx(&tx, &manifest, current_version_on(&tx)?)?;
        let raw = serialize_json(&manifest)?;
        save_active_manifest_in(&tx, &current.state, &raw)?;
        let next = AuthModeStateRecord {
            active_deployment: Some(deployment),
            ..current.state
        };
        next.validate_shape()?;
        save_json_meta(&tx, META_AUTH_MODE_STATE, &next)?;
        let authorization_predecessor = if activation_changed || !seeded_changes.is_empty() {
            super::auth_stream::read_authorization_version_on(&tx)?
        } else {
            None
        };
        let authorization = if activation_changed {
            Some(super::authorization::authorization_commit_hook_in(
                &tx,
                super::authorization::AuthorizationCommitCause::Activation,
            )?)
        } else if !seeded_changes.is_empty() {
            Some(super::authorization::authorization_commit_hook_in(
                &tx,
                super::authorization::AuthorizationCommitCause::AppWrites {
                    schema: &manifest,
                    changes: &seeded_changes,
                },
            )?)
        } else {
            None
        };
        require_managed_snapshot(&tx)?;
        match authorization {
            Some(authorization) => {
                let min_commit_version = current_version_on(&tx)?;
                super::commit_with_authorization_interlock(
                    tx,
                    &authorization,
                    if activation_changed {
                        super::AuthorizationCommitImpact::AllProtectedRooms
                    } else {
                        super::AuthorizationCommitImpact::AppWrites {
                            schema: &manifest,
                            changes: &seeded_changes,
                        }
                    },
                    authorization_predecessor,
                    min_commit_version,
                    authorization_interlock,
                    &commit_authority_identity,
                )?;
            }
            None => tx.commit()?,
        }
        self.replace_active_schema(manifest);
        Ok(())
    }

    /// Test convenience for callers that do not exercise ambiguous commit
    /// classification.
    #[cfg(test)]
    pub fn apply_same_mode_network_deployment(
        &mut self,
        deployment: DeploymentIdentity,
        manifest: SchemaManifest,
        seed: Option<SeedData>,
    ) -> SnapbackResult<(NetworkSeedOutcome, AuthModeStateRecord)> {
        let committed = self
            .apply_same_mode_network_deployment_classified(deployment, manifest, seed)
            .into_result()?;
        Ok((committed.seed_outcome, committed.state))
    }

    /// Same-mode network provisioning keeps the legacy seed-if-empty behavior
    /// while making DDL, seed, both active-manifest keys, and
    /// `activeDeployment` one transaction. Unlike the cold-start carrier seam,
    /// a repeated network provision may carry seed data for an existing app;
    /// it is applied only when every named target is empty.
    // @ref LLP 0058#same-mode-provisioning — a complete preflighted pair advances schema and deployment identity atomically before function publication.
    #[cfg(test)]
    pub fn apply_same_mode_network_deployment_classified(
        &mut self,
        deployment: DeploymentIdentity,
        manifest: SchemaManifest,
        seed: Option<SeedData>,
    ) -> DurableModeCommit<NetworkDeploymentCommit> {
        self.apply_same_mode_network_deployment_with_functions_classified(
            deployment,
            manifest,
            FunctionManifest::default(),
            seed,
            Vec::new(),
        )
    }

    pub fn apply_same_mode_network_deployment_with_functions_classified(
        &mut self,
        deployment: DeploymentIdentity,
        manifest: SchemaManifest,
        functions: FunctionManifest,
        seed: Option<SeedData>,
        projection_publications: Vec<super::PendingProjectionPublication>,
    ) -> DurableModeCommit<NetworkDeploymentCommit> {
        let _writer_token = match self
            .writer_authority
            .enter(super::write_authority::LocalWriterLaneV1::SchemaActivation)
        {
            Ok(token) => token,
            Err(error) => return DurableModeCommit::RolledBack(error),
        };
        let predecessor = match (|| -> SnapbackResult<_> {
            deployment.validate()?;
            deployment.validate_schema_half(&manifest)?;
            validate_schema(&manifest)?;
            reject_field_retypes(&self.schema, &manifest)?;
            reject_unsafe_required_field_changes(&self.conn, &self.schema, &manifest)?;
            let current = self.auth_mode_snapshot()?;
            require_settled_available(&current.state)?;
            if deployment.auth_mode != current.state.active {
                return Err(mode_corrupt(
                    "same-mode network deployment differs from active auth mode",
                ));
            }
            Ok(current)
        })() {
            Ok(predecessor) => predecessor,
            Err(error) => return DurableModeCommit::RolledBack(error),
        };
        let authorization_interlock = self.authorization_interlock.clone();
        let commit_authority_identity = self.commit_authority_identity.clone();
        let order_field_bounds = self.order_field_bounds.clone();
        let mut predecessor_sequence_declarations = BTreeMap::new();
        let sequence_declarations = super::sequence_declarations_from_function_manifest(&functions);
        if predecessor.state.active_deployment.as_ref() == Some(&deployment) {
            predecessor_sequence_declarations.extend(self.sequence_declarations.as_ref().clone());
            predecessor_sequence_declarations.extend(sequence_declarations.clone());
        }
        let trusted_relation_parent_tables = predecessor
            .active_manifest
            .as_ref()
            .map(super::schema_relation_parent_tables)
            .unwrap_or_default()
            .into_iter()
            .map(ToOwned::to_owned)
            .collect();
        let predecessor_schema = self.schema.clone();
        // A same-mode activation may advance authorization even without a
        // seed. The native reservation bind must therefore receive the exact
        // durable predecessor for every candidate activation, not only for
        // transactions that also carry app data.
        //
        // @ref LLP 0290#54-bind — successor validation is relative to the
        // committing database's transaction-start authorization fact.
        let track_data_marker = true;
        let committed = commit_mode_transaction(
            &mut self.conn,
            &predecessor,
            track_data_marker,
            authorization_interlock,
            &commit_authority_identity,
            |tx| {
                let current = require_managed_snapshot(tx)?;
                if current != predecessor {
                    return Err(mode_corrupt(
                        "auth-mode snapshot changed before the same-mode transaction",
                    ));
                }
                require_settled_available(&current.state)?;
                if deployment.auth_mode != current.state.active {
                    return Err(mode_corrupt(
                        "same-mode network deployment differs from active auth mode",
                    ));
                }

                validate_enum_domain_evolution(tx, &predecessor_schema, &manifest)?;

                let predecessor_head = current_version_on(tx)?;
                super::preflight_membership_activation_sources(tx, &manifest, predecessor_head)?;
                apply_schema_tables(tx, &manifest)?;
                crate::storage::stream_transcripts::activate_manifests_in(
                    tx,
                    &manifest,
                    Some(&functions),
                )?;
                super::preflight_sequence_enrollments(
                    tx,
                    &manifest,
                    &trusted_relation_parent_tables,
                    &predecessor_sequence_declarations,
                    &sequence_declarations,
                )?;
                if deployment.auth_mode == AuthMode::Sessions {
                    // @ref LLP 0055#grants — basis changes and the activation
                    //   authorization event share this transaction; the
                    //   returned witness drives connection/live projection
                    //   before successor admission reopens.
                    super::auth_scope_bases::reconcile_auth_scope_bases_with_schema_on(
                        tx, &functions, &manifest,
                    )?;
                }
                let mut seeded_changes = Vec::new();
                let seed_outcome = match seed {
                    None => NetworkSeedOutcome::SkippedAbsent,
                    Some(seed) => {
                        let mut all_empty = true;
                        let head = current_version_on(tx)?;
                        for table in seed.tables.keys() {
                            // `schema_table` validates the logical target before the
                            // quoted physical lookup. Any invalid seed rolls this
                            // transaction back, including additive DDL.
                            let table_manifest = schema_table(&manifest, table)?;
                            validate_managed_row_versions(tx, table_manifest, head)?;
                            let count: i64 = tx.query_row(
                                &format!("SELECT COUNT(*) FROM {}", super::quote_ident(table)?),
                                [],
                                |row| row.get(0),
                            )?;
                            if count != 0 {
                                all_empty = false;
                                break;
                            }
                        }
                        if all_empty {
                            let next_version = next_storage_version(current_version_on(tx)?)?;
                            seeded_changes = seed_into_transaction(
                                tx,
                                &manifest,
                                seed,
                                next_version,
                                &order_field_bounds,
                            )?;
                            if !seeded_changes.is_empty() {
                                set_version(tx, next_version)?;
                            }
                            NetworkSeedOutcome::Seeded
                        } else {
                            NetworkSeedOutcome::SkippedNonempty
                        }
                    }
                };
                super::validate_membership_activation(tx, &manifest, current_version_on(tx)?)?;
                super::validate_sequence_activation(tx, &manifest, &sequence_declarations)?;
                apply_schema_indexes(tx, &manifest)?;
                let mut all_projection_publications = projection_publications;
                let already_materialized = all_projection_publications
                    .iter()
                    .map(|publication| publication.plan_id.clone())
                    .collect::<std::collections::BTreeSet<_>>();
                for plan in &functions.projections {
                    if already_materialized.contains(&plan.id) {
                        continue;
                    }
                    let plan_digest = super::projection_rebuild::projection_plan_digest(plan)?;
                    let stored: Option<String> = tx
                        .query_row(
                            "SELECT value FROM _snapback_meta WHERE key = ?1",
                            params![format!("projection_plan_digest:{}", plan.id)],
                            |row| row.get(0),
                        )
                        .optional()?;
                    if stored.as_deref() == Some(plan_digest.as_str()) {
                        continue;
                    }
                    all_projection_publications.push(
                        super::projection_rebuild::materialize_projection_in(
                            tx,
                            &manifest,
                            &order_field_bounds,
                            plan,
                            &plan_digest,
                            "activation",
                            super::now_millis(),
                        )?,
                    );
                }
                crate::search::sqlite::activate_manifest_in_tx(
                    tx,
                    &manifest,
                    current_version_on(tx)?,
                )?;
                crate::vector::sqlite::stage_manifest_in_tx(
                    tx,
                    &manifest,
                    current_version_on(tx)?,
                )?;
                super::projection_rebuild::apply_projection_publication_in(
                    tx,
                    &all_projection_publications,
                )?;

                let raw = serialize_json(&manifest)?;
                save_active_manifest_in(tx, &current.state, &raw)?;
                let next = AuthModeStateRecord {
                    active_deployment: Some(deployment.clone()),
                    ..current.state
                };
                next.validate_shape()?;
                save_json_meta(tx, META_AUTH_MODE_STATE, &next)?;
                let observed = require_managed_snapshot(tx)?;
                let successor = AuthModeSnapshot {
                    state: next.clone(),
                    staged: predecessor.staged.clone(),
                    active_manifest: Some(manifest.clone()),
                };
                if observed != successor {
                    return Err(mode_corrupt(
                        "same-mode transaction did not produce its exact successor",
                    ));
                }
                let activation_changed = predecessor.active_manifest.as_ref() != Some(&manifest)
                    || predecessor.state.active_deployment.as_ref() != Some(&deployment);
                let authorization = if activation_changed {
                    Some(super::authorization::authorization_commit_hook_in(
                        tx,
                        super::authorization::AuthorizationCommitCause::Activation,
                    )?)
                } else if !seeded_changes.is_empty() {
                    Some(super::authorization::authorization_commit_hook_in(
                        tx,
                        super::authorization::AuthorizationCommitCause::AppWrites {
                            schema: &manifest,
                            changes: &seeded_changes,
                        },
                    )?)
                } else {
                    None
                };
                let authorization = match authorization {
                    Some(authorization) => Some((authorization, current_version_on(tx)?)),
                    None => None,
                };
                let output = NetworkDeploymentCommit {
                    seed_outcome,
                    activation_changed,
                    state: next,
                    authorization: authorization.as_ref().map(|(witness, min_commit_version)| {
                        NetworkDeploymentAuthorization {
                            witness: witness.clone(),
                            min_commit_version: *min_commit_version,
                        }
                    }),
                    projection_publications: all_projection_publications,
                };
                Ok((output, successor, authorization))
            },
        );
        if matches!(committed, DurableModeCommit::Committed(_)) {
            // This also covers a lost commit acknowledgement reconciled to the
            // exact successor above.
            self.replace_active_schema(manifest);
        }
        committed
    }

    pub(super) fn apply_schema_mode_aware(
        &mut self,
        manifest: SchemaManifest,
    ) -> SnapbackResult<()> {
        let _writer_token = self
            .writer_authority
            .enter(super::write_authority::LocalWriterLaneV1::SchemaActivation)?;
        // Raw schema application is the v0-dev compatibility ingress. A
        // complete v1-sessions pair must use staged provisioning even before
        // activeDeployment has been established.
        // @ref LLP 0058#the-two-admissible-tuples — a null deployment identity
        // is not authority to admit v1-dev or one half of a sessions pair.
        if manifest.schema_version != crate::manifest::SNAPBACK_SCHEMA_VERSION
            || manifest.effective_auth_mode() != AuthMode::Dev
        {
            return Err(SnapbackError::error(
                "SNAPBACK_CAPABILITY_UNSUPPORTED",
                "auth",
                "raw dev schema loading accepts only the snapback.v0-dev tuple",
            )
            .with_details(serde_json::json!({
                "authMode": manifest.effective_auth_mode(),
                "schemaVersion": manifest.schema_version,
                "expectedAuthMode": AuthMode::Dev,
                "expectedSchemaVersion": crate::manifest::SNAPBACK_SCHEMA_VERSION,
            })));
        }
        validate_schema(&manifest)?;
        reject_field_retypes(&self.schema, &manifest)?;
        reject_unsafe_required_field_changes(&self.conn, &self.schema, &manifest)?;
        let authorization_interlock = self.authorization_interlock.clone();
        let commit_authority_identity = self.commit_authority_identity.clone();
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = require_managed_snapshot(&tx)?;
        require_settled_available(&current.state)?;
        if current.state.active != AuthMode::Dev {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "legacy schema apply is unavailable in sessions mode",
            ));
        }
        if let Some(identity) = &current.state.active_deployment {
            identity.validate_schema_half(&manifest)?;
        }
        validate_enum_domain_evolution(&tx, &self.schema, &manifest)?;
        let activation_changed = current.active_manifest.as_ref() != Some(&manifest);
        let predecessor_head = current_version_on(&tx)?;
        super::preflight_membership_activation_sources(&tx, &manifest, predecessor_head)?;
        apply_schema_tables(&tx, &manifest)?;
        // Raw dev has no same-activation seed, but it uses the same post-DDL,
        // pre-index validator as staged and same-mode deployment.
        super::validate_membership_activation(&tx, &manifest, current_version_on(&tx)?)?;
        apply_schema_indexes(&tx, &manifest)?;
        crate::search::sqlite::activate_manifest_in_tx(&tx, &manifest, current_version_on(&tx)?)?;
        crate::vector::sqlite::stage_manifest_in_tx(&tx, &manifest, current_version_on(&tx)?)?;
        let raw = serialize_json(&manifest)?;
        save_active_manifest_in(&tx, &current.state, &raw)?;
        let authorization_predecessor = if activation_changed {
            super::auth_stream::read_authorization_version_on(&tx)?
        } else {
            None
        };
        let authorization = if activation_changed {
            Some(super::authorization::authorization_commit_hook_in(
                &tx,
                super::authorization::AuthorizationCommitCause::Activation,
            )?)
        } else {
            None
        };
        require_managed_snapshot(&tx)?;
        match authorization {
            Some(authorization) => {
                let min_commit_version = current_version_on(&tx)?;
                super::commit_with_authorization_interlock(
                    tx,
                    &authorization,
                    super::AuthorizationCommitImpact::AllProtectedRooms,
                    authorization_predecessor,
                    min_commit_version,
                    authorization_interlock,
                    &commit_authority_identity,
                )?;
            }
            None => tx.commit()?,
        }
        self.replace_active_schema(manifest);
        Ok(())
    }
}

fn require_complete_deployment_pair(
    deployment: &DeploymentIdentity,
    schema: &SchemaManifest,
    functions: &FunctionManifest,
) -> SnapbackResult<()> {
    functions.validate_artifact()?;
    let paired = DeploymentIdentity::from_manifests(deployment.auth_mode, schema, functions)?;
    if &paired == deployment {
        Ok(())
    } else {
        Err(mode_corrupt(
            "schema/function artifacts differ from their deployment identity",
        ))
    }
}

pub(super) fn inspect_for_open(conn: &Connection) -> SnapbackResult<OpenAuthModeInspection> {
    let Some(values) = read_mode_meta(conn)? else {
        return Ok(OpenAuthModeInspection::Fresh);
    };
    let legacy = values.get(META_LEGACY_SCHEMA_MANIFEST).cloned();
    let aware = values.get(META_CAPABILITY_AWARE_SCHEMA_MANIFEST).cloned();
    let staged_raw = values.get(META_STAGED_AUTH_MODE_MANIFEST).cloned();
    let state_raw = values.get(META_AUTH_MODE_STATE).cloned();

    let Some(state_raw) = state_raw else {
        if aware.is_some() || staged_raw.is_some() {
            return Err(mode_corrupt(
                "auth-mode companion key exists without mode state",
            ));
        }
        return match legacy {
            None => Ok(OpenAuthModeInspection::Fresh),
            Some(raw) if raw == LEGACY_MANIFEST_POISON => Err(mode_corrupt(
                "legacy poison exists without its sessions activation record",
            )),
            Some(raw) => {
                let manifest = parse_schema(&raw)?;
                require_manifest_mode(&manifest, AuthMode::Dev)?;
                Ok(OpenAuthModeInspection::Legacy {
                    raw_manifest: raw,
                    manifest: Box::new(manifest),
                })
            }
        };
    };

    let state: AuthModeStateRecord = parse_closed(&state_raw)?;
    state.validate_shape()?;
    let staged = staged_raw
        .as_deref()
        .map(parse_closed::<StagedAuthModeRecord>)
        .transpose()?;
    match state.mode_state {
        AuthModeStatus::Settled if staged.is_some() => {
            return Err(mode_corrupt("settled auth mode retains a staged key"));
        }
        AuthModeStatus::PendingRestart | AuthModeStatus::Quarantined if staged.is_none() => {
            return Err(mode_corrupt("pending auth mode lacks its staged key"));
        }
        _ => {}
    }
    if let Some(staged) = &staged {
        staged.validate_against(&state)?;
    }

    let active_manifest = aware.as_deref().map(parse_schema).transpose()?;
    if let Some(manifest) = &active_manifest {
        require_manifest_mode(manifest, state.active)?;
    }
    if let Some(identity) = &state.active_deployment {
        let Some(manifest) = &active_manifest else {
            return Err(mode_corrupt(
                "active deployment lacks a capability-aware manifest",
            ));
        };
        identity.validate_schema_half(manifest)?;
    }
    if state.active == AuthMode::Sessions && active_manifest.is_none() {
        return Err(mode_corrupt(
            "settled sessions mode lacks its active manifest",
        ));
    }

    if state.sessions_ever_activated {
        if legacy.as_deref() != Some(LEGACY_MANIFEST_POISON) {
            return Err(mode_corrupt(
                "sessions activation evidence lacks permanent poison",
            ));
        }
    } else {
        if legacy.as_deref() == Some(LEGACY_MANIFEST_POISON) {
            return Err(mode_corrupt("legacy poison precedes sessions activation"));
        }
        match (legacy.as_deref(), aware.as_deref()) {
            (None, None) => {}
            (Some(legacy), Some(aware)) if legacy == aware => {}
            _ => {
                return Err(mode_corrupt(
                    "pre-sessions legacy and capability-aware manifests differ",
                ));
            }
        }
    }

    Ok(OpenAuthModeInspection::Managed(Box::new(
        AuthModeSnapshot {
            state,
            staged,
            active_manifest,
        },
    )))
}

pub(super) fn adopt_after_infra(
    db: &mut LocalDatabase,
    expected: OpenAuthModeInspection,
) -> SnapbackResult<()> {
    if matches!(expected, OpenAuthModeInspection::Managed(_)) {
        return Ok(());
    }
    let tx = db
        .conn
        .transaction_with_behavior(TransactionBehavior::Immediate)?;
    let observed = inspect_for_open(&tx)?;
    let (raw_manifest, active_manifest) = match (expected, observed) {
        (OpenAuthModeInspection::Fresh, OpenAuthModeInspection::Fresh) => (None, None),
        (
            OpenAuthModeInspection::Legacy {
                raw_manifest: expected_raw,
                manifest: expected_manifest,
            },
            OpenAuthModeInspection::Legacy {
                raw_manifest: observed_raw,
                manifest: observed_manifest,
            },
        ) if expected_raw == observed_raw && expected_manifest == observed_manifest => {
            (Some(expected_raw), Some(*expected_manifest))
        }
        _ => {
            return Err(mode_corrupt(
                "auth-mode keys changed while the legacy database was opening",
            ));
        }
    };

    if let Some(raw) = &raw_manifest {
        save_raw_meta(&tx, META_CAPABILITY_AWARE_SCHEMA_MANIFEST, raw)?;
    }
    let state = AuthModeStateRecord::initial_dev(None);
    save_json_meta(&tx, META_AUTH_MODE_STATE, &state)?;
    require_managed_snapshot(&tx)?;
    tx.commit()?;
    if let Some(manifest) = active_manifest {
        db.replace_active_schema(manifest);
    }
    Ok(())
}

fn require_managed_snapshot(conn: &Connection) -> SnapbackResult<AuthModeSnapshot> {
    match inspect_for_open(conn)? {
        OpenAuthModeInspection::Managed(snapshot) => Ok(*snapshot),
        _ => Err(mode_corrupt(
            "auth-mode state disappeared during a transition",
        )),
    }
}

fn require_transition_source(
    state: &AuthModeStateRecord,
    requested: AuthMode,
) -> SnapbackResult<()> {
    if !matches!(
        state.mode_state,
        AuthModeStatus::Settled | AuthModeStatus::PendingRestart | AuthModeStatus::Quarantined
    ) || requested == state.active
    {
        return Err(mode_corrupt(
            "staged transition must request the mode opposite the active mode",
        ));
    }
    Ok(())
}

fn require_pending_direction(
    snapshot: &AuthModeSnapshot,
    active: AuthMode,
    desired: AuthMode,
) -> SnapbackResult<()> {
    if snapshot.state.active != active
        || snapshot.state.desired != desired
        || !matches!(
            snapshot.state.mode_state,
            AuthModeStatus::PendingRestart | AuthModeStatus::Quarantined
        )
    {
        return Err(mode_corrupt("auth-mode consume direction is invalid"));
    }
    Ok(())
}

fn require_settled_available(state: &AuthModeStateRecord) -> SnapbackResult<()> {
    if state.mode_state != AuthModeStatus::Settled
        || state.app_data_availability != AppDataAvailability::Available
    {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_MODE_PENDING",
            "auth",
            "ordinary schema apply is unavailable during an auth-mode transition",
        ));
    }
    Ok(())
}

fn require_manifest_mode(manifest: &SchemaManifest, mode: AuthMode) -> SnapbackResult<()> {
    if manifest.schema_version != mode.artifact_version() || manifest.effective_auth_mode() != mode
    {
        return Err(mode_corrupt(
            "active schema manifest is not coherent with its auth mode",
        ));
    }
    Ok(())
}

fn require_fresh_seed_target(conn: &Connection, state: &AuthModeStateRecord) -> SnapbackResult<()> {
    super::with_pinned_read_snapshot(conn, |conn| {
        if state.active_deployment.is_some() {
            return Err(mode_corrupt(
                "transition seed is allowed only for a fresh database",
            ));
        }
        let mode_meta = read_mode_meta(conn)?.unwrap_or_default();
        if mode_meta.contains_key(META_LEGACY_SCHEMA_MANIFEST)
            || mode_meta.contains_key(META_CAPABILITY_AWARE_SCHEMA_MANIFEST)
        {
            return Err(mode_corrupt(
                "transition seed is not allowed for an adopted application",
            ));
        }
        let head = current_version_on(conn)?;
        for table in physical_user_tables(conn)? {
            // Emptiness is a durable-state decision. Refuse corrupt/future rows
            // before COUNT can classify the table and hide them from decoding.
            validate_managed_table_versions_by_name(conn, &table, head)?;
            let count: i64 = conn.query_row(
                &format!("SELECT COUNT(*) FROM {}", super::quote_ident(&table)?),
                [],
                |row| row.get(0),
            )?;
            if count != 0 {
                return Err(mode_corrupt("transition seed target is not empty"));
            }
        }
        Ok(())
    })
}

fn apply_schema_tables(tx: &Transaction<'_>, manifest: &SchemaManifest) -> SnapbackResult<()> {
    for table in &manifest.tables {
        create_or_update_table(tx, table)?;
    }
    // @ref LLP 0143#d6-activation-migration-and-the-no-op-posture — registry storage
    // and auth-lifecycle triggers exist iff the schema declares the seam.
    crate::push::activate_manifest_in(tx, manifest.push_seam.as_ref())?;
    crate::storage::auth_integrations::activate_manifest_in(tx, manifest)?;
    crate::storage::declared_clients::activate_manifest_in(tx, manifest)?;
    crate::storage::capability_links::activate_manifest_in(tx, manifest)?;
    crate::storage::pending_effects::activate_manifest_in(tx, manifest)?;
    crate::storage::webhooks::activate_manifest_in(tx, manifest)?;
    crate::storage::watches::activate_manifest_in(tx, manifest)?;
    crate::storage::ask_spend::activate_manifest_in(tx, manifest)?;
    Ok(())
}

fn apply_schema_indexes(tx: &Transaction<'_>, manifest: &SchemaManifest) -> SnapbackResult<()> {
    for table in &manifest.tables {
        for index in &table.indexes {
            create_index(
                tx,
                table,
                index.name.as_str(),
                &index.fields,
                index.unique,
                index.where_applicable,
            )?;
        }
        // The generated true-unique membership index. Host-derived from the
        // declaration rather than hand-declared, so seed/import/admin writers
        // and reopened stored manifests all get the same total uniqueness
        // guarantee without the app author spelling an index.
        // @ref LLP 0056#declaring-a-membership-table — the generated index.
        if let Some((name, fields)) = super::membership_unique_index(table) {
            create_index(tx, table, &name, &fields, true, false)?;
        }
        if let Some((name, fields)) = super::membership_reverse_index(table) {
            create_index(tx, table, &name, &fields, false, false)?;
        }
    }
    Ok(())
}

/// Publication-path manifest write for the LLP 0081 migration executor: a
/// published successor (or a §6 republished predecessor) must land in the
/// same slots the mode-aware apply path maintains — the capability-aware
/// copy always, the legacy copy in lockstep before sessions has ever
/// activated, and never over the permanent poison afterward. Writing only
/// the legacy slot leaves the two pre-sessions copies divergent and bricks
/// the store at the next open (found by the Step 5 schema-evolution
/// witness).
pub(super) fn publish_manifest_for_migration(
    tx: &Transaction<'_>,
    raw: &str,
) -> SnapbackResult<()> {
    let snapshot = require_managed_snapshot(tx)?;
    save_active_manifest_in(tx, &snapshot.state, raw)
}

fn save_active_manifest_in(
    tx: &Transaction<'_>,
    state: &AuthModeStateRecord,
    raw: &str,
) -> SnapbackResult<()> {
    let manifest: SchemaManifest = serde_json::from_str(raw)
        .map_err(|_| mode_corrupt("published schema manifest does not parse"))?;
    crate::proof_checkpoint::activate_history_policies_in_tx(tx, &manifest)?;
    save_raw_meta(tx, META_CAPABILITY_AWARE_SCHEMA_MANIFEST, raw)?;
    if state.sessions_ever_activated {
        require_legacy_poison(tx)?;
    } else {
        save_raw_meta(tx, META_LEGACY_SCHEMA_MANIFEST, raw)?;
    }
    Ok(())
}

fn require_legacy_poison(conn: &Connection) -> SnapbackResult<()> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key = ?1",
            params![META_LEGACY_SCHEMA_MANIFEST],
            |row| row.get(0),
        )
        .optional()?;
    if value.as_deref() != Some(LEGACY_MANIFEST_POISON) {
        return Err(mode_corrupt("permanent legacy manifest poison is missing"));
    }
    Ok(())
}

fn read_mode_meta(conn: &Connection) -> SnapbackResult<Option<BTreeMap<String, String>>> {
    let has_meta = conn
        .query_row(
            "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '_snapback_meta'",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !has_meta {
        return Ok(None);
    }
    let mut statement = conn.prepare(
        "SELECT key, value FROM _snapback_meta
         WHERE key IN (?1, ?2, ?3, ?4)",
    )?;
    let rows = statement.query_map(
        params![
            META_LEGACY_SCHEMA_MANIFEST,
            META_CAPABILITY_AWARE_SCHEMA_MANIFEST,
            META_STAGED_AUTH_MODE_MANIFEST,
            META_AUTH_MODE_STATE,
        ],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )?;
    Ok(Some(rows.collect::<Result<BTreeMap<_, _>, _>>()?))
}

fn save_raw_meta(conn: &Connection, key: &str, value: &str) -> SnapbackResult<()> {
    conn.execute(
        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

fn save_json_meta<T: serde::Serialize>(
    conn: &Connection,
    key: &str,
    value: &T,
) -> SnapbackResult<()> {
    let raw = serialize_json(value)?;
    save_raw_meta(conn, key, &raw)
}

fn serialize_json<T: serde::Serialize>(value: &T) -> SnapbackResult<String> {
    serde_json::to_string(value)
        .map_err(|_| mode_corrupt("auth-mode record could not be serialized"))
}

fn parse_closed<T: serde::de::DeserializeOwned>(raw: &str) -> SnapbackResult<T> {
    serde_json::from_str(raw).map_err(|_| mode_corrupt("auth-mode record could not be parsed"))
}

fn parse_schema(raw: &str) -> SnapbackResult<SchemaManifest> {
    serde_json::from_str(raw).map_err(|_| mode_corrupt("stored active schema could not be parsed"))
}

fn valid_quarantine_code(value: &str) -> bool {
    let Some(suffix) = value.strip_prefix("SNAPBACK_") else {
        return false;
    };
    !suffix.is_empty()
        && suffix
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{
        AuthManifest, AuthPasswordIdentifierMode, FieldManifest, FieldType, FunctionDefinition,
        FunctionKind, FunctionRuntime, IbexModule, MembershipLastHolder, MembershipManifest,
        MembershipScope, SequenceDeclaration, SequenceScopeAccess, TableManifest,
    };
    use serde_json::Map;
    use tempfile::tempdir;

    fn digest(prefix: &str, nibble: char) -> String {
        format!("{prefix}{}", nibble.to_string().repeat(64))
    }

    fn table(name: &str) -> TableManifest {
        TableManifest {
            name: name.to_owned(),
            fields: vec![FieldManifest {
                name: "value".to_owned(),
                field_type: FieldType::String,
                optional: false,
            }],
            indexes: Vec::new(),
            syncable: false,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        }
    }

    fn sessions_pair(table_name: Option<&str>) -> (DeploymentIdentity, SchemaManifest) {
        let schema_hash = digest(crate::auth::mode::SCHEMA_V1_PREFIX, 'a');
        let inputs_hash = digest(crate::auth::mode::INPUTS_V1_PREFIX, 'c');
        let manifest = SchemaManifest {
            schema_version: "snapback.v1".to_owned(),
            app_id: "mode-test".to_owned(),
            auth: Some(AuthManifest {
                mode: AuthMode::Sessions,
                agents: None,
                password_identifier_mode: None,
                password_minimum_length: None,
            }),
            schema_hash: Some(schema_hash.clone()),
            inputs_hash: Some(inputs_hash.clone()),
            tables: table_name.into_iter().map(table).collect(),
            ..SchemaManifest::default()
        };
        (
            DeploymentIdentity {
                schema_version: "snapback.v1".to_owned(),
                auth_mode: AuthMode::Sessions,
                app_id: "mode-test".to_owned(),
                schema_hash,
                bundle_hash: digest(crate::auth::mode::FUNCTION_V1_PREFIX, 'b'),
                inputs_hash,
            },
            manifest,
        )
    }

    fn dev_pair(table_name: Option<&str>) -> (DeploymentIdentity, SchemaManifest) {
        let manifest = SchemaManifest {
            schema_version: "snapback.v0".to_owned(),
            app_id: "mode-test".to_owned(),
            schema_hash: Some("sha256:dev-schema".to_owned()),
            inputs_hash: Some("sha256:dev-inputs".to_owned()),
            tables: table_name.into_iter().map(table).collect(),
            ..SchemaManifest::default()
        };
        (
            DeploymentIdentity {
                schema_version: "snapback.v0".to_owned(),
                auth_mode: AuthMode::Dev,
                app_id: "mode-test".to_owned(),
                schema_hash: "sha256:dev-schema".to_owned(),
                bundle_hash: "sha256:dev-functions".to_owned(),
                inputs_hash: "sha256:dev-inputs".to_owned(),
            },
            manifest,
        )
    }

    #[test]
    #[ignore = "stale-schema ownership measurement; run explicitly"]
    fn stale_predecessor_dev_schema_publication_overwrites_durable_successor() {
        let dir = tempdir().expect("stale schema publication tempdir");
        let path = dir.path().join("stale-schema-publication.sqlite");
        let mut stale = LocalDatabase::open(&path).expect("open stale handle A");
        let (_, mut predecessor) = dev_pair(Some("items"));
        predecessor.schema_hash = Some("sha256:publication-predecessor".to_owned());
        stale
            .schema_seed()
            .apply_schema(predecessor)
            .expect("publish predecessor through handle A");
        let mut publisher = LocalDatabase::open(&path).expect("open publisher handle B");
        let (_, mut successor) = dev_pair(Some("items"));
        successor.schema_hash = Some("sha256:publication-successor".to_owned());
        publisher
            .schema_seed()
            .apply_schema(successor)
            .expect("durably publish successor through handle B");
        assert_eq!(
            stale.schema().schema_hash.as_deref(),
            Some("sha256:publication-predecessor"),
            "handle A must retain its predecessor"
        );
        assert_eq!(
            publisher.schema().schema_hash.as_deref(),
            Some("sha256:publication-successor"),
            "handle B must hold its successor before A's use"
        );

        let (_, mut stale_contender) = dev_pair(Some("items"));
        stale_contender.schema_hash = Some("sha256:publication-stale-contender".to_owned());
        let outcome = stale.schema_seed().apply_schema(stale_contender);
        let observer = LocalDatabase::open(&path).expect("open effect observer C");
        let durable_hash = observer.schema().schema_hash.as_deref();
        assert!(
            outcome.is_ok(),
            "current implementation accepts stale publication"
        );
        assert_eq!(
            durable_hash,
            Some("sha256:publication-stale-contender"),
            "stale A's contender must be the exact durable effect"
        );
        eprintln!(
            "FAMILY12_NEEDS_OWNERSHIP_DECISION: use returned Ok; observer C saw \
             durable_hash={} after B had published sha256:publication-successor",
            durable_hash.unwrap_or("missing")
        );
    }

    fn membership_dev_pair() -> (DeploymentIdentity, SchemaManifest) {
        let (identity, mut manifest) = dev_pair(None);
        manifest.tables = vec![
            TableManifest {
                name: "events".to_owned(),
                fields: vec![FieldManifest {
                    name: "title".to_owned(),
                    field_type: FieldType::String,
                    optional: true,
                }],
                indexes: Vec::new(),
                syncable: false,
                permission_backing: false,
                permission_fields: None,
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: None,
                history: None,
            },
            TableManifest {
                name: "event_members".to_owned(),
                fields: vec![
                    FieldManifest {
                        name: "userId".to_owned(),
                        field_type: FieldType::Principal,
                        optional: false,
                    },
                    FieldManifest {
                        name: "eventId".to_owned(),
                        field_type: FieldType::Id {
                            table: "events".to_owned(),
                        },
                        optional: false,
                    },
                    FieldManifest {
                        name: "role".to_owned(),
                        field_type: FieldType::String,
                        optional: false,
                    },
                ],
                indexes: Vec::new(),
                syncable: false,
                permission_backing: false,
                permission_fields: None,
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                membership: Some(MembershipManifest {
                    id: None,
                    principal: "userId".to_owned(),
                    resource: Some("eventId".to_owned()),
                    role: "role".to_owned(),
                    roles: vec!["host".to_owned()],
                    pending_roles: None,
                    bootstrap_role: Some("host".to_owned()),
                    last_holder: Some(MembershipLastHolder {
                        protect: "host".to_owned(),
                    }),
                    expiry: None,
                    incidental: None,
                    provenance: None,
                    transitions: Vec::new(),
                    scope: MembershipScope::Resource,
                    resource_table: Some("events".to_owned()),
                    principal_addressed_writes: None,
                }),
                authority_profile: None,
                asset_sharing: None,
                visibility: None,
                history: None,
            },
        ];
        (identity, manifest)
    }

    fn function_half(identity: &DeploymentIdentity) -> FunctionManifest {
        FunctionManifest {
            schema_version: identity.schema_version.clone(),
            app_id: identity.app_id.clone(),
            bundle_hash: Some(identity.bundle_hash.clone()),
            inputs_hash: Some(identity.inputs_hash.clone()),
            ..FunctionManifest::default()
        }
    }

    fn sequence_function_half(
        identity: &DeploymentIdentity,
        scope_table: &str,
    ) -> FunctionManifest {
        let mut manifest = function_half(identity);
        let mut function = FunctionDefinition::new(
            "allocatePosition",
            FunctionKind::Mutation,
            FunctionRuntime::IbexModule(IbexModule {
                source: "globalThis.__snapbackHandlers = {};".to_owned(),
                export: "allocatePosition".to_owned(),
            }),
        );
        function.required_capabilities = vec![
            "ibex_ctx_db_host_bridge".to_owned(),
            "sequence_allocation_v1".to_owned(),
        ];
        function.sequences = vec![SequenceDeclaration {
            name: "positions".to_owned(),
            scope_table: scope_table.to_owned(),
            scope_access: SequenceScopeAccess::Public("public.v1".to_owned()),
        }];
        manifest.functions.push(function);
        manifest
    }

    fn sequence_seed(table: &str) -> SeedData {
        SeedData {
            tables: BTreeMap::from([(
                table.to_owned(),
                vec![Map::from_iter([(
                    "value".to_owned(),
                    serde_json::Value::String("seeded".to_owned()),
                )])],
            )]),
        }
    }

    fn assert_sequence_seed_activation(database: &LocalDatabase, table: &str) {
        let marker: i64 = database
            .conn
            .query_row(
                "SELECT count(*) FROM _snapback_sequence_scope_enrollments_v1
                  WHERE table_name = ?1",
                params![table],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(marker, 1, "sequence enrollment precedes same-cut seed");
        let rows: i64 = database
            .conn
            .query_row(
                &format!(
                    "SELECT count(*) FROM {}",
                    super::super::quote_ident(table).unwrap()
                ),
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 1);
        let active: i64 = database
            .conn
            .query_row(
                "SELECT count(*) FROM _snapback_relation_incarnations_v1
                  WHERE table_name = ?1 AND active = 1",
                params![table],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(active, 1, "seeded scope receives its active incarnation");
    }

    fn ready() -> AuthProgramReadiness {
        AuthProgramReadiness {
            route_registry_enforced: true,
            existing_surface_closure: true,
            admin_secret_read_enforced: true,
            secret_read_process_prerequisites: true,
            provider_core: true,
            shared_invocation_gate: true,
            staged_mode: true,
            connection_binding: true,
            two_phase_revocation: true,
            auth_coordinator: true,
            authorization_invalidation: false,
            authority_descriptor: false,
            authorized_lease: false,
            password_provider: crate::auth::mode::PasswordProviderReadiness::requires_v4(None),
            session_activation_ready: true,
        }
    }

    fn force_exhausted_storage_head(database: &LocalDatabase) {
        database
            .conn
            .execute(
                "UPDATE _snapback_version SET version = ?1 WHERE id = 1",
                params![crate::manifest::PORTABLE_STORAGE_VERSION_MAX as i64],
            )
            .unwrap();
        assert_eq!(
            database.current_version().unwrap(),
            crate::manifest::PORTABLE_STORAGE_VERSION_MAX
        );
    }

    fn assert_physical_table_absent(database: &LocalDatabase, table: &str) {
        let count: i64 = database
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = ?1",
                params![table],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, "{table} DDL must roll back");
    }

    fn mode_meta(connection: &Connection) -> BTreeMap<String, String> {
        read_mode_meta(connection).unwrap().unwrap()
    }

    #[test]
    fn legacy_open_adopts_without_changing_legacy_bytes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("legacy.sqlite");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE _snapback_version(
                     id INTEGER PRIMARY KEY CHECK(id = 1),
                     version INTEGER NOT NULL
                 );
                 INSERT INTO _snapback_version(id, version) VALUES(1, 0);
                 CREATE TABLE _snapback_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);",
            )
            .unwrap();
        let raw = serde_json::to_string(&SchemaManifest::default()).unwrap();
        connection
            .execute(
                "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)",
                params![META_LEGACY_SCHEMA_MANIFEST, raw],
            )
            .unwrap();
        drop(connection);

        let database = LocalDatabase::open(&path).unwrap();
        let snapshot = database.auth_mode_snapshot().unwrap();
        assert_eq!(snapshot.state, AuthModeStateRecord::initial_dev(None));
        drop(database);

        let connection = Connection::open(&path).unwrap();
        let values = mode_meta(&connection);
        assert_eq!(
            values.get(META_LEGACY_SCHEMA_MANIFEST),
            values.get(META_CAPABILITY_AWARE_SCHEMA_MANIFEST)
        );
    }

    #[test]
    fn adopted_empty_legacy_application_is_not_a_fresh_seed_target() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("adopted-empty.sqlite");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE _snapback_version(
                     id INTEGER PRIMARY KEY CHECK(id = 1),
                     version INTEGER NOT NULL
                 );
                 INSERT INTO _snapback_version(id, version) VALUES(1, 0);
                 CREATE TABLE _snapback_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);",
            )
            .unwrap();
        let raw = serde_json::to_string(&SchemaManifest::default()).unwrap();
        connection
            .execute(
                "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)",
                params![META_LEGACY_SCHEMA_MANIFEST, raw],
            )
            .unwrap();
        drop(connection);

        let mut database = LocalDatabase::open(&path).unwrap();
        let (identity, manifest) = sessions_pair(Some("items"));
        let seed = SeedData {
            tables: BTreeMap::from([(
                "items".to_owned(),
                vec![Map::from_iter([(
                    "value".to_owned(),
                    serde_json::Value::String("seeded".to_owned()),
                )])],
            )]),
        };
        let error = database
            .stage_auth_mode(identity, manifest, Some(seed))
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_MODE_STATE_CORRUPT");
        assert_eq!(
            database.auth_mode_snapshot().unwrap().state,
            AuthModeStateRecord::initial_dev(None)
        );
    }

    #[test]
    fn seed_present_mode_lanes_refuse_an_exhausted_storage_head_atomically() {
        let empty_seed = || SeedData {
            tables: BTreeMap::new(),
        };

        let mut staged = LocalDatabase::memory().unwrap();
        force_exhausted_storage_head(&staged);
        let staged_before = staged.auth_mode_snapshot().unwrap();
        let (sessions_identity, sessions_manifest) = sessions_pair(Some("staged_items"));
        let error = staged
            .stage_auth_mode(sessions_identity, sessions_manifest, Some(empty_seed()))
            .expect_err("seed-present staging reserves a storage successor");
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_EXHAUSTED");
        assert_eq!(staged.auth_mode_snapshot().unwrap(), staged_before);
        assert_physical_table_absent(&staged, "staged_items");

        let mut same_mode = LocalDatabase::memory().unwrap();
        force_exhausted_storage_head(&same_mode);
        let same_mode_before = same_mode.auth_mode_snapshot().unwrap();
        let (dev_identity, dev_manifest) = dev_pair(Some("same_mode_items"));
        let error = same_mode
            .apply_same_mode_deployment(dev_identity, dev_manifest, Some(empty_seed()))
            .expect_err("seed-present same-mode apply reserves a storage successor");
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_EXHAUSTED");
        assert_eq!(same_mode.auth_mode_snapshot().unwrap(), same_mode_before);
        assert_physical_table_absent(&same_mode, "same_mode_items");

        let mut network = LocalDatabase::memory().unwrap();
        force_exhausted_storage_head(&network);
        let network_before = network.auth_mode_snapshot().unwrap();
        let (network_identity, network_manifest) = dev_pair(Some("network_items"));
        let error = match network.apply_same_mode_network_deployment_classified(
            network_identity,
            network_manifest,
            Some(empty_seed()),
        ) {
            DurableModeCommit::RolledBack(error) => error,
            other => panic!("seed-present network apply must roll back, got {other:?}"),
        };
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_EXHAUSTED");
        assert_eq!(network.auth_mode_snapshot().unwrap(), network_before);
        assert_physical_table_absent(&network, "network_items");
    }

    // Sequence activation belongs to the complete schema/function cut. Every
    // deployment lane enrolls the empty scope after DDL, seeds it in the same
    // transaction, and validates the resulting incarnation before publishing
    // the successor pair.
    #[test]
    fn complete_pair_mode_lanes_enroll_sequence_before_same_cut_seed() {
        let mut staged = LocalDatabase::memory().unwrap();
        let (staged_identity, staged_schema) = sessions_pair(Some("staged_scopes"));
        let staged_functions = sequence_function_half(&staged_identity, "staged_scopes");
        staged
            .stage_auth_mode_with_functions(
                staged_identity,
                staged_schema,
                &staged_functions,
                Some(sequence_seed("staged_scopes")),
            )
            .expect("staged complete pair activates sequence enrollment before seed");
        assert_sequence_seed_activation(&staged, "staged_scopes");

        let mut same_mode = LocalDatabase::memory().unwrap();
        let (same_identity, same_schema) = dev_pair(Some("same_mode_scopes"));
        let same_functions = sequence_function_half(&same_identity, "same_mode_scopes");
        same_mode
            .apply_same_mode_dev_deployment_with_functions(
                same_identity,
                same_schema,
                &same_functions,
                Some(sequence_seed("same_mode_scopes")),
            )
            .expect("same-mode complete pair activates sequence enrollment before seed");
        assert_sequence_seed_activation(&same_mode, "same_mode_scopes");

        let mut network = LocalDatabase::memory().unwrap();
        let (network_identity, network_schema) = dev_pair(Some("network_scopes"));
        let network_functions = sequence_function_half(&network_identity, "network_scopes");
        match network.apply_same_mode_network_deployment_with_functions_classified(
            network_identity,
            network_schema,
            network_functions,
            Some(sequence_seed("network_scopes")),
            Vec::new(),
        ) {
            DurableModeCommit::Committed(_) => {}
            other => panic!("network complete-pair sequence activation failed: {other:?}"),
        }
        assert_sequence_seed_activation(&network, "network_scopes");
    }

    #[test]
    fn seed_absent_mode_lanes_do_not_reserve_a_storage_successor() {
        let mut staged = LocalDatabase::memory().unwrap();
        force_exhausted_storage_head(&staged);
        let (sessions_identity, sessions_manifest) = sessions_pair(Some("staged_items"));
        staged
            .stage_auth_mode(sessions_identity, sessions_manifest, None)
            .expect("seed-absent staging does not advance app data");
        assert_eq!(
            staged.current_version().unwrap(),
            crate::manifest::PORTABLE_STORAGE_VERSION_MAX
        );

        let mut same_mode = LocalDatabase::memory().unwrap();
        force_exhausted_storage_head(&same_mode);
        let (dev_identity, dev_manifest) = dev_pair(Some("same_mode_items"));
        same_mode
            .apply_same_mode_deployment(dev_identity, dev_manifest, None)
            .expect("seed-absent same-mode apply does not advance app data");
        assert_eq!(
            same_mode.current_version().unwrap(),
            crate::manifest::PORTABLE_STORAGE_VERSION_MAX
        );

        let mut network = LocalDatabase::memory().unwrap();
        force_exhausted_storage_head(&network);
        let (network_identity, network_manifest) = dev_pair(Some("network_items"));
        match network.apply_same_mode_network_deployment_classified(
            network_identity,
            network_manifest,
            None,
        ) {
            DurableModeCommit::Committed(_) => {}
            other => panic!("seed-absent network apply must commit, got {other:?}"),
        }
        assert_eq!(
            network.current_version().unwrap(),
            crate::manifest::PORTABLE_STORAGE_VERSION_MAX
        );
    }

    #[test]
    fn raw_schema_loader_rejects_sessions_half_on_fresh_dev() {
        let mut database = LocalDatabase::memory().unwrap();
        let (_, manifest) = sessions_pair(Some("must_not_exist"));
        let error = database.schema_seed().apply_schema(manifest).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_CAPABILITY_UNSUPPORTED");
        let exists: i64 = database
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'must_not_exist'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exists, 0);
    }

    #[test]
    fn failed_stage_rolls_back_ddl_and_both_mode_records() {
        let mut database = LocalDatabase::memory().unwrap();
        let (identity, manifest) = sessions_pair(Some("staged_items"));
        inject_auth_mode_failure_after_step(2);
        let error = database
            .stage_auth_mode(identity.clone(), manifest.clone(), None)
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "TEST_AUTH_MODE_TRANSACTION_FAILURE");
        assert_eq!(
            database.auth_mode_snapshot().unwrap().state.mode_state,
            AuthModeStatus::Settled
        );
        let physical: i64 = database
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='staged_items'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(physical, 0);

        let pending = database.stage_auth_mode(identity, manifest, None).unwrap();
        assert_eq!(pending.transition_generation, 1);
        assert_eq!(pending.mode_state, AuthModeStatus::PendingRestart);
        let quarantined = database
            .quarantine_auth_mode("SNAPBACK_AUTH_POLICY_UNAVAILABLE")
            .unwrap();
        assert_eq!(quarantined.transition_generation, 2);
        assert_eq!(quarantined.mode_state, AuthModeStatus::Quarantined);
        let settled = database.unstage_auth_mode().unwrap();
        assert_eq!(settled.transition_generation, 3);
        assert_eq!(settled.mode_state, AuthModeStatus::Settled);
    }

    #[test]
    fn staged_commit_boundary_reconciles_exact_predecessor_and_successor() {
        let mut rolled_back = LocalDatabase::memory().unwrap();
        let (identity, manifest) = sessions_pair(Some("before_commit_items"));
        inject_auth_mode_commit_boundary_failure(AuthModeCommitBoundary::BeforeCommit);
        let error = match rolled_back.stage_auth_mode_classified(
            identity.clone(),
            manifest.clone(),
            None,
        ) {
            DurableModeCommit::RolledBack(error) => error,
            other => panic!("expected confirmed rollback, got {other:?}"),
        };
        assert_eq!(
            error.diagnostic.code,
            "TEST_AUTH_MODE_COMMIT_BOUNDARY_FAILURE"
        );
        assert_eq!(
            rolled_back.auth_mode_snapshot().unwrap().state,
            AuthModeStateRecord::initial_dev(None)
        );
        let physical: i64 = rolled_back
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='before_commit_items'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(physical, 0);

        let mut committed = LocalDatabase::memory().unwrap();
        inject_auth_mode_commit_boundary_failure(AuthModeCommitBoundary::AfterCommit);
        let returned = match committed.stage_auth_mode_classified(identity, manifest, None) {
            DurableModeCommit::Committed(state) => state,
            other => panic!("expected exact committed successor, got {other:?}"),
        };
        let reread = committed.auth_mode_snapshot().unwrap();
        assert_eq!(reread.state, returned);
        assert_eq!(returned.mode_state, AuthModeStatus::PendingRestart);
        assert!(reread.staged.is_some());
    }

    #[test]
    fn same_mode_network_deployment_commits_identity_and_seed_if_empty_once() {
        let mut database = LocalDatabase::memory().unwrap();
        let (identity, manifest) = dev_pair(Some("network_items"));
        let mut row = Map::new();
        row.insert("_id".to_owned(), serde_json::json!("seeded"));
        row.insert("value".to_owned(), serde_json::json!("first"));
        let seed = SeedData {
            tables: BTreeMap::from([("network_items".to_owned(), vec![row])]),
        };

        let (outcome, committed) = database
            .apply_same_mode_network_deployment(
                identity.clone(),
                manifest.clone(),
                Some(seed.clone()),
            )
            .unwrap();
        assert_eq!(outcome, NetworkSeedOutcome::Seeded);
        assert_eq!(committed.active_deployment, Some(identity.clone()));
        assert_eq!(
            database
                .auth_mode_snapshot()
                .unwrap()
                .state
                .active_deployment,
            Some(identity.clone())
        );
        let values = mode_meta(&database.conn);
        assert_eq!(
            values.get(META_LEGACY_SCHEMA_MANIFEST),
            values.get(META_CAPABILITY_AWARE_SCHEMA_MANIFEST)
        );

        let (outcome, committed) = database
            .apply_same_mode_network_deployment(identity, manifest, Some(seed))
            .unwrap();
        assert_eq!(outcome, NetworkSeedOutcome::SkippedNonempty);
        assert_eq!(
            committed.active_deployment,
            database
                .auth_mode_snapshot()
                .unwrap()
                .state
                .active_deployment
        );
        let count: i64 = database
            .conn
            .query_row("SELECT COUNT(*) FROM network_items", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn network_seed_emptiness_check_refuses_future_rows_before_counting() {
        let mut database = LocalDatabase::memory().unwrap();
        let (identity, manifest) = dev_pair(Some("network_items"));
        database
            .apply_same_mode_network_deployment(identity.clone(), manifest.clone(), None)
            .unwrap();
        let seed = SeedData {
            tables: BTreeMap::from([(
                "network_items".to_owned(),
                vec![Map::from_iter([
                    ("_id".to_owned(), serde_json::json!("existing")),
                    ("value".to_owned(), serde_json::json!("existing")),
                ])],
            )]),
        };
        database.schema_seed().seed(seed.clone()).unwrap();
        let head = database.current_version().unwrap();
        database
            .conn
            .execute(
                "UPDATE network_items SET _version = ?1 WHERE _id = 'existing'",
                params![(head + 1) as i64],
            )
            .unwrap();
        let before = database.auth_mode_snapshot().unwrap();

        let error = database
            .apply_same_mode_network_deployment(identity, manifest, Some(seed))
            .expect_err("future row cannot classify a seed target as nonempty");
        assert_eq!(error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT");
        assert_eq!(database.auth_mode_snapshot().unwrap(), before);
        assert_eq!(database.current_version().unwrap(), head);
    }

    #[test]
    fn membership_activation_judges_same_transaction_seed_before_indexes() {
        let (identity, manifest) = membership_dev_pair();
        let resource = Map::from_iter([
            ("_id".to_owned(), serde_json::json!("event-1")),
            ("title".to_owned(), serde_json::json!("seeded")),
        ]);
        let holder = Map::from_iter([
            ("_id".to_owned(), serde_json::json!("member-1")),
            ("userId".to_owned(), serde_json::json!("alice")),
            ("eventId".to_owned(), serde_json::json!("event-1")),
            ("role".to_owned(), serde_json::json!("host")),
        ]);
        let complete_seed = SeedData {
            tables: BTreeMap::from([
                ("events".to_owned(), vec![resource.clone()]),
                ("event_members".to_owned(), vec![holder]),
            ]),
        };
        let mut complete = LocalDatabase::memory().unwrap();
        complete
            .apply_same_mode_network_deployment(
                identity.clone(),
                manifest.clone(),
                Some(complete_seed),
            )
            .expect("holder seeded in the activation transaction");

        let mut incomplete = LocalDatabase::memory().unwrap();
        let error = incomplete
            .apply_same_mode_network_deployment(
                identity,
                manifest,
                Some(SeedData {
                    tables: BTreeMap::from([("events".to_owned(), vec![resource])]),
                }),
            )
            .expect_err("a fresh protected resource cannot activate without its holder");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_ACTIVATION_UNPROTECTED_RESOURCE"
        );
        let table_count: i64 = incomplete
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema
                 WHERE type = 'table' AND name IN ('events', 'event_members')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table_count, 0, "failed activation rolls DDL and seed back");
    }

    #[test]
    fn network_unrelated_seed_cannot_legitimize_future_activation_sources() {
        for source in ["holder", "resource"] {
            let (identity, mut manifest) = membership_dev_pair();
            manifest.tables.push(table("notes"));
            let initial = SeedData {
                tables: BTreeMap::from([
                    (
                        "events".to_owned(),
                        vec![Map::from_iter([
                            ("_id".to_owned(), serde_json::json!("event-1")),
                            ("title".to_owned(), serde_json::json!("seeded")),
                        ])],
                    ),
                    (
                        "event_members".to_owned(),
                        vec![Map::from_iter([
                            ("_id".to_owned(), serde_json::json!("member-1")),
                            ("userId".to_owned(), serde_json::json!("alice")),
                            ("eventId".to_owned(), serde_json::json!("event-1")),
                            ("role".to_owned(), serde_json::json!("host")),
                        ])],
                    ),
                ]),
            };
            let mut database = LocalDatabase::memory().unwrap();
            database
                .apply_same_mode_network_deployment(
                    identity.clone(),
                    manifest.clone(),
                    Some(initial),
                )
                .unwrap();
            let head = database.current_version().unwrap();
            let (table, id) = if source == "holder" {
                ("event_members", "member-1")
            } else {
                ("events", "event-1")
            };
            database
                .conn
                .execute(
                    &format!(
                        "UPDATE {} SET _version = ?1 WHERE _id = ?2",
                        super::super::quote_ident(table).unwrap()
                    ),
                    params![(head + 1) as i64, id],
                )
                .unwrap();
            let unrelated = SeedData {
                tables: BTreeMap::from([(
                    "notes".to_owned(),
                    vec![Map::from_iter([
                        (
                            "_id".to_owned(),
                            serde_json::json!(format!("note-{source}")),
                        ),
                        ("value".to_owned(), serde_json::json!("unrelated")),
                    ])],
                )]),
            };

            let error = database
                .apply_same_mode_network_deployment(identity, manifest, Some(unrelated))
                .expect_err("network seed must preflight every activation relation");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_STORAGE_VERSION_CORRUPT",
                "{source}"
            );
            assert_eq!(database.current_version().unwrap(), head);
            let notes: i64 = database
                .conn
                .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
                .unwrap();
            assert_eq!(notes, 0);
        }
    }

    #[test]
    fn brownfield_membership_activation_treats_a_new_roster_as_empty() {
        let (_, full) = membership_dev_pair();
        let mut base = full.clone();
        base.tables.truncate(1);
        let mut db = LocalDatabase::memory().unwrap();
        db.schema_seed().apply_schema(base).unwrap();
        db.schema_seed()
            .seed(SeedData {
                tables: BTreeMap::from([(
                    "events".to_owned(),
                    vec![Map::from_iter([
                        ("_id".to_owned(), serde_json::json!("event-1")),
                        ("title".to_owned(), serde_json::json!("brownfield")),
                    ])],
                )]),
            })
            .unwrap();
        let error = db
            .schema_seed()
            .apply_schema(full)
            .expect_err("new empty roster must not silently protect existing resources");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_ACTIVATION_UNPROTECTED_RESOURCE"
        );
        let membership_table: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema
                 WHERE type = 'table' AND name = 'event_members'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(membership_table, 0);
    }

    #[test]
    fn same_mode_network_commit_returns_the_exact_activation_witness_and_floor() {
        let mut database = LocalDatabase::memory().unwrap();
        let (identity, manifest) = dev_pair(None);
        let committed = match database.apply_same_mode_network_deployment_classified(
            identity.clone(),
            manifest.clone(),
            None,
        ) {
            DurableModeCommit::Committed(committed) => committed,
            other => panic!("activation must commit, got {other:?}"),
        };
        let authorization = committed
            .authorization
            .expect("changed activation returns its durable witness");
        assert!(authorization.witness.event);
        assert!(!authorization.witness.incarnation_rotated);
        assert_eq!(
            authorization.witness.version,
            database.authorization_version().unwrap()
        );
        assert_eq!(
            authorization.min_commit_version,
            database.current_version().unwrap()
        );

        let repeated = match database
            .apply_same_mode_network_deployment_classified(identity, manifest, None)
        {
            DurableModeCommit::Committed(committed) => committed,
            other => panic!("identical deployment must commit, got {other:?}"),
        };
        assert!(repeated.authorization.is_none());
    }

    #[test]
    fn same_mode_commit_boundary_reconciles_and_installs_exact_schema() {
        let mut rolled_back = LocalDatabase::memory().unwrap();
        let (identity, manifest) = dev_pair(Some("same_before_items"));
        inject_auth_mode_commit_boundary_failure(AuthModeCommitBoundary::BeforeCommit);
        match rolled_back.apply_same_mode_network_deployment_classified(
            identity.clone(),
            manifest.clone(),
            None,
        ) {
            DurableModeCommit::RolledBack(error) => assert_eq!(
                error.diagnostic.code,
                "TEST_AUTH_MODE_COMMIT_BOUNDARY_FAILURE"
            ),
            other => panic!("expected confirmed rollback, got {other:?}"),
        }
        assert_eq!(rolled_back.schema(), &SchemaManifest::default());
        assert_eq!(
            rolled_back
                .auth_mode_snapshot()
                .unwrap()
                .state
                .active_deployment,
            None
        );

        let mut committed = LocalDatabase::memory().unwrap();
        inject_auth_mode_commit_boundary_failure(AuthModeCommitBoundary::AfterCommit);
        let returned = match committed.apply_same_mode_network_deployment_classified(
            identity,
            manifest.clone(),
            None,
        ) {
            DurableModeCommit::Committed(committed) => committed.state,
            other => panic!("expected exact committed successor, got {other:?}"),
        };
        assert_eq!(committed.schema(), &manifest);
        assert_eq!(committed.auth_mode_snapshot().unwrap().state, returned);
    }

    // @ref LLP 0225#1-ownership-map — pending projection pins ride the
    //   classified complete-pair verdict and never participate in successor
    //   identity; reopen reads only what the reconciled SQLite cut committed.
    #[test]
    fn consume_crash_rolls_back_catalog_poison_and_mode_then_retry_settles() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("consume.sqlite");
        let mut database = LocalDatabase::open(&path).unwrap();
        let (identity, manifest) = sessions_pair(Some("session_items"));
        database
            .stage_auth_mode(identity.clone(), manifest.clone(), None)
            .unwrap();

        inject_auth_mode_failure_after_step(2);
        let error = database.consume_sessions_auth_mode(&ready()).unwrap_err();
        assert_eq!(error.diagnostic.code, "TEST_AUTH_MODE_TRANSACTION_FAILURE");
        let after_failure = database.auth_mode_snapshot().unwrap();
        assert_eq!(
            after_failure.state.mode_state,
            AuthModeStatus::PendingRestart
        );
        assert_eq!(
            database.inspect_auth_catalog().unwrap(),
            crate::storage::auth::AuthCatalogState::Uninitialized
        );
        assert_ne!(
            mode_meta(&database.conn)
                .get(META_LEGACY_SCHEMA_MANIFEST)
                .map(String::as_str),
            Some(LEGACY_MANIFEST_POISON)
        );

        let settled = database.consume_sessions_auth_mode(&ready()).unwrap();
        assert_eq!(settled.active, AuthMode::Sessions);
        assert!(settled.sessions_ever_activated);
        assert_eq!(
            mode_meta(&database.conn)
                .get(META_LEGACY_SCHEMA_MANIFEST)
                .map(String::as_str),
            Some(LEGACY_MANIFEST_POISON)
        );
        drop(database);

        let reopened = LocalDatabase::open(&path).unwrap();
        assert_eq!(reopened.schema(), &manifest);
        assert_eq!(
            reopened
                .auth_mode_snapshot()
                .unwrap()
                .state
                .active_deployment,
            Some(identity)
        );
    }

    #[test]
    fn declared_email_password_mode_activates_v4_and_cannot_be_changed() {
        let mut database = LocalDatabase::memory().unwrap();
        let (identity, mut manifest) = sessions_pair(None);
        manifest
            .auth
            .as_mut()
            .expect("sessions auth declaration")
            .password_identifier_mode = Some(AuthPasswordIdentifierMode::EmailV1);
        database
            .stage_auth_mode(identity.clone(), manifest.clone(), None)
            .unwrap();
        database.consume_sessions_auth_mode(&ready()).unwrap();
        assert_eq!(
            database.auth_password_identifier_mode().unwrap(),
            crate::storage::auth::PasswordIdentifierMode::EmailV1
        );

        let mut contradictory = manifest;
        contradictory
            .auth
            .as_mut()
            .expect("sessions auth declaration")
            .password_identifier_mode = Some(AuthPasswordIdentifierMode::UsernameV1);
        let successor_schema_hash = digest(crate::auth::mode::SCHEMA_V1_PREFIX, 'e');
        contradictory.schema_hash = Some(successor_schema_hash.clone());
        let mut successor = identity;
        successor.schema_hash = successor_schema_hash;
        let error = database
            .apply_same_mode_schema(successor, contradictory)
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_MODE_IMMUTABLE"
        );
    }

    #[test]
    fn privileged_restage_between_preflight_and_consume_cannot_mix_function_pairs() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("restage.sqlite3");
        let mut database = LocalDatabase::open(&path).unwrap();
        let (sessions_a, sessions_manifest) = sessions_pair(None);
        let functions_a = function_half(&sessions_a);
        database
            .stage_auth_mode_with_functions(
                sessions_a.clone(),
                sessions_manifest.clone(),
                &functions_a,
                None,
            )
            .unwrap();
        let mut sessions_b = sessions_a;
        sessions_b.bundle_hash = digest(crate::auth::mode::FUNCTION_V1_PREFIX, 'd');
        let functions_b = function_half(&sessions_b);
        let hook_path = path.clone();
        let hook_sessions = sessions_b.clone();
        let hook_manifest = sessions_manifest.clone();
        let hook_functions = functions_b.clone();
        inject_before_auth_mode_consume_transaction(move || {
            let mut restager = LocalDatabase::open(&hook_path).unwrap();
            restager.unstage_auth_mode().unwrap();
            restager
                .stage_auth_mode_with_functions(hook_sessions, hook_manifest, &hook_functions, None)
                .unwrap();
        });
        let sessions_error = database
            .consume_sessions_auth_mode_with_functions(&ready(), &functions_a)
            .unwrap_err();
        assert_eq!(
            sessions_error.diagnostic.code,
            "SNAPBACK_AUTH_MODE_STATE_CORRUPT"
        );
        let pending = database.auth_mode_snapshot().unwrap();
        assert_eq!(pending.state.requested_deployment, Some(sessions_b));
        assert_eq!(
            database.inspect_auth_catalog().unwrap(),
            crate::storage::auth::AuthCatalogState::Uninitialized
        );

        database
            .consume_sessions_auth_mode_with_functions(&ready(), &functions_b)
            .unwrap();
        database
            .with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT INTO _auth_users(id, created_at_ms) VALUES('u', 1)",
                    [],
                )?;
                crate::storage::insert_test_email_identity(
                    tx,
                    "i",
                    "u",
                    "u@example.com",
                    1,
                    false,
                )?;
                crate::storage::insert_test_identity_session(
                    tx,
                    "01890f47-0000-7000-8000-000000000001",
                    "u",
                    "i",
                    "a",
                    &[0_u8; 32],
                    1,
                    1,
                    100,
                    100,
                )?;
                Ok(())
            })
            .unwrap();

        let (dev_a, dev_manifest) = dev_pair(None);
        let dev_functions_a = function_half(&dev_a);
        database
            .stage_auth_mode_with_functions(
                dev_a.clone(),
                dev_manifest.clone(),
                &dev_functions_a,
                None,
            )
            .unwrap();
        let mut dev_b = dev_a;
        dev_b.bundle_hash = "sha256:dev-functions-b".to_owned();
        let dev_functions_b = function_half(&dev_b);
        let hook_path = path.clone();
        inject_before_auth_mode_consume_transaction(move || {
            let mut restager = LocalDatabase::open(&hook_path).unwrap();
            restager.unstage_auth_mode().unwrap();
            restager
                .stage_auth_mode_with_functions(dev_b, dev_manifest, &dev_functions_b, None)
                .unwrap();
        });
        let dev_error = database
            .consume_dev_downgrade_with_functions(true, 10, &dev_functions_a)
            .unwrap_err();
        assert_eq!(
            dev_error.diagnostic.code,
            "SNAPBACK_AUTH_MODE_STATE_CORRUPT"
        );
        let session: (i64, Option<i64>) = database
            .with_auth_read(|conn| {
                Ok(conn.query_row(
                    "SELECT generation, revoked_at_ms FROM _auth_sessions WHERE id = '01890f47-0000-7000-8000-000000000001'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?)
            })
            .unwrap();
        assert_eq!(session, (1, None));
        assert_eq!(
            database.auth_mode_snapshot().unwrap().state.active,
            AuthMode::Sessions
        );
    }

    #[test]
    fn downgrade_flag_quarantines_then_explicit_consume_revokes_sessions() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("downgrade-agent-authority.sqlite");
        let mut database = LocalDatabase::open(&path).unwrap();
        let (sessions_identity, sessions_manifest) = sessions_pair(None);
        database
            .stage_auth_mode(sessions_identity, sessions_manifest, None)
            .unwrap();
        database.consume_sessions_auth_mode(&ready()).unwrap();
        database
            .with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT INTO _auth_users(id, created_at_ms) VALUES('u', 1)",
                    [],
                )?;
                crate::storage::insert_test_email_identity(
                    tx,
                    "i",
                    "u",
                    "u@example.com",
                    1,
                    false,
                )?;
                crate::storage::insert_test_identity_session(
                    tx,
                    "01890f47-0000-7000-8000-000000000001",
                    "u",
                    "i",
                    "a",
                    &[0_u8; 32],
                    1,
                    1,
                    100,
                    100,
                )?;
                tx.execute_batch(
                    "INSERT INTO _auth_users(
                       id, created_at_ms, kind, display_name, registration_provenance
                     ) VALUES('agent', 1, 'agent', 'Agent', 'test');
                     INSERT INTO _auth_agent_credentials(
                       id, user_id, secret_hash, generation, created_at_ms,
                       rotated_at_ms, last_used_at_ms
                     ) VALUES('credential', 'agent', randomblob(32), 1, 1, 1, 1);
                     INSERT INTO _auth_grants(
                       id, actor_user_id, scopes, created_at_ms, created_by, last_used_at_ms
                     ) VALUES('grant', 'agent', '[]', 1, 'test', 1);
                     INSERT INTO _auth_grant_tokens(
                       id, token_hash, grant_id, credential_id, credential_generation,
                       created_at_ms, expires_at_ms
                     ) VALUES('grant-token', randomblob(32), 'grant', 'credential', 1, 1, 100);
                     INSERT INTO _auth_agent_invitations(
                       id, token_hash, class, created_by, minted_profile,
                       created_at_ms, expires_at_ms
                     ) VALUES('invitation', randomblob(32), 'creation', 'test', 'dev', 1, 100);
                     INSERT INTO _auth_pairing_requests(
                       id, code_hash, minted_by_user_id, agent_user_id,
                       requested_scopes, created_at_ms, expires_at_ms
                     ) VALUES('pairing', randomblob(32), 'u', 'agent', '[]', 1, 100);
                     INSERT INTO _auth_scope_bases(
                       function_id, kind, generation, present, authority_creating
                     ) VALUES('retained-scope', 'mutation', 4, 0, 1);",
                )?;
                Ok(())
            })
            .unwrap();

        let (dev_identity, dev_manifest) = dev_pair(None);
        let dev_functions = function_half(&dev_identity);
        let mut mismatched_functions = dev_functions.clone();
        mismatched_functions.bundle_hash = Some("sha256:not-the-staged-functions".to_owned());
        let mismatch = database
            .stage_auth_mode_with_functions(
                dev_identity.clone(),
                dev_manifest.clone(),
                &mismatched_functions,
                None,
            )
            .unwrap_err();
        assert_eq!(mismatch.diagnostic.code, "SNAPBACK_AUTH_MODE_STATE_CORRUPT");
        assert_eq!(
            database.auth_mode_snapshot().unwrap().state.active,
            AuthMode::Sessions
        );
        database
            .stage_auth_mode_with_functions(
                dev_identity,
                dev_manifest.clone(),
                &dev_functions,
                None,
            )
            .unwrap();
        let consume_mismatch = database
            .consume_dev_downgrade_with_functions(true, 10, &mismatched_functions)
            .unwrap_err();
        assert_eq!(
            consume_mismatch.diagnostic.code,
            "SNAPBACK_AUTH_MODE_STATE_CORRUPT"
        );
        let before_downgrade: (i64, Option<i64>) = database
            .with_auth_read(|conn| {
                Ok(conn.query_row(
                    "SELECT generation, revoked_at_ms FROM _auth_sessions WHERE id = '01890f47-0000-7000-8000-000000000001'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?)
            })
            .unwrap();
        assert_eq!(before_downgrade, (1, None));
        let error = database.consume_dev_downgrade(false, 10).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_MODE_DOWNGRADE");
        assert_eq!(
            database.auth_mode_snapshot().unwrap().state.mode_state,
            AuthModeStatus::Quarantined
        );

        inject_auth_mode_failure_after_step(0);
        let rollback = database
            .consume_dev_downgrade_with_functions(true, 10, &dev_functions)
            .expect_err("failure after authority purge must roll back the whole downgrade");
        assert_eq!(
            rollback.diagnostic.code,
            "TEST_AUTH_MODE_TRANSACTION_FAILURE"
        );
        assert_eq!(
            database
                .with_auth_read(|conn| {
                    Ok(conn.query_row(
                        "SELECT generation, revoked_at_ms FROM _auth_sessions WHERE id = '01890f47-0000-7000-8000-000000000001'",
                        [],
                        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?)),
                    )?)
                })
                .unwrap(),
            (1, None),
            "session revocation must roll back with the authority purge"
        );
        for table in [
            "_auth_agent_credentials",
            "_auth_grants",
            "_auth_grant_tokens",
            "_auth_agent_invitations",
            "_auth_pairing_requests",
        ] {
            let count: i64 = database
                .conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 1, "rollback restored {table}");
        }
        assert_eq!(
            database.auth_mode_snapshot().unwrap().state.mode_state,
            AuthModeStatus::Quarantined
        );

        let result = database
            .consume_dev_downgrade_with_functions(true, 10, &dev_functions)
            .unwrap();
        assert_eq!(result.sessions_revoked, 1);
        assert_eq!(result.state.active, AuthMode::Dev);
        let (generation, revoked): (i64, Option<i64>) = database
            .with_auth_read(|conn| {
                Ok(conn.query_row(
                    "SELECT generation, revoked_at_ms FROM _auth_sessions WHERE id = '01890f47-0000-7000-8000-000000000001'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?)
            })
            .unwrap();
        assert_eq!((generation, revoked), (2, Some(10)));
        for table in [
            "_auth_agent_credentials",
            "_auth_grants",
            "_auth_grant_tokens",
            "_auth_agent_invitations",
            "_auth_pairing_requests",
        ] {
            let count: i64 = database
                .conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "downgrade purged {table}");
        }
        assert_eq!(
            database
                .conn
                .query_row(
                    "SELECT COUNT(*) FROM _auth_users WHERE id = 'agent'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            1,
            "agent principal survives downgrade"
        );
        assert_eq!(
            database
                .conn
                .query_row(
                    "SELECT generation FROM _auth_scope_bases WHERE function_id = 'retained-scope'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            4,
            "scope tombstone survives downgrade"
        );
        assert_eq!(database.schema(), &dev_manifest);
        assert_eq!(
            mode_meta(&database.conn)
                .get(META_LEGACY_SCHEMA_MANIFEST)
                .map(String::as_str),
            Some(LEGACY_MANIFEST_POISON)
        );

        drop(database);
        let mut database = LocalDatabase::open(&path).unwrap();
        let (sessions_identity, sessions_manifest) = sessions_pair(None);
        let sessions_functions = function_half(&sessions_identity);
        database
            .stage_auth_mode_with_functions(
                sessions_identity,
                sessions_manifest,
                &sessions_functions,
                None,
            )
            .unwrap();
        database
            .consume_sessions_auth_mode_with_functions(&ready(), &sessions_functions)
            .unwrap();
        for table in [
            "_auth_agent_credentials",
            "_auth_grants",
            "_auth_grant_tokens",
            "_auth_agent_invitations",
            "_auth_pairing_requests",
        ] {
            let count: i64 = database
                .conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(
                count, 0,
                "{table} did not resurrect after restart/re-enable"
            );
        }
    }

    #[test]
    fn ready_v1_sessions_to_dev_downgrade_skips_absent_agent_tables() {
        let mut database = LocalDatabase::memory().unwrap();
        crate::storage::auth::install_frozen_v1_catalog_fixture(&mut database).unwrap();
        let (sessions_identity, sessions_manifest) = sessions_pair(None);
        database
            .stage_auth_mode(sessions_identity, sessions_manifest, None)
            .unwrap();
        database.consume_sessions_auth_mode(&ready()).unwrap();
        database
            .with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT INTO _auth_users(id, created_at_ms) VALUES('v1-user', 1)",
                    [],
                )?;
                tx.execute(
                    "INSERT INTO _auth_identities(id, user_id, provider, subject, verified_at_ms)
                     VALUES('v1-identity', 'v1-user', 'email-code', 'v1@example.com', 1)",
                    [],
                )?;
                tx.execute(
                    "INSERT INTO _auth_sessions(
                       id, user_id, identity_id, authority_instance_id, token_hash,
                       generation, created_at_ms, last_used_at_ms, expires_at_ms,
                       absolute_expires_at_ms
                     ) VALUES(
                       '01890f47-0000-7000-8000-000000000002', 'v1-user', 'v1-identity', 'v1-authority',
                       zeroblob(32), 1, 1, 1, 100, 100
                     )",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        let (dev_identity, dev_manifest) = dev_pair(None);
        database
            .stage_auth_mode(dev_identity, dev_manifest, None)
            .unwrap();

        let result = database.consume_dev_downgrade(true, 10).unwrap();

        assert_eq!(result.sessions_revoked, 1);
        assert_eq!(result.state.active, AuthMode::Dev);
        assert_eq!(
            database.inspect_auth_catalog().unwrap(),
            crate::storage::auth::AuthCatalogState::ReadyV1
        );
        assert_eq!(
            database
                .conn
                .query_row(
                    "SELECT generation, revoked_at_ms FROM _auth_sessions WHERE id = '01890f47-0000-7000-8000-000000000002'",
                    [],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                )
                .unwrap(),
            (2, 10)
        );
    }

    #[test]
    fn corrupt_mode_open_is_read_only_and_never_quarantines() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("corrupt.sqlite");
        drop(LocalDatabase::open(&path).unwrap());
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;")
            .unwrap();
        connection
            .execute(
                "UPDATE _snapback_meta SET value = ?2 WHERE key = ?1",
                params![META_AUTH_MODE_STATE, r#"{"formatVersion":2}"#],
            )
            .unwrap();
        let before = mode_meta(&connection);
        let wal_path = std::path::PathBuf::from(format!("{}-wal", path.display()));
        let database_bytes_before = std::fs::read(&path).unwrap();
        let wal_bytes_before = std::fs::read(&wal_path).expect("corruption write remains in WAL");

        let error = match LocalDatabase::open(&path) {
            Ok(_) => panic!("corrupt auth-mode state must refuse open"),
            Err(error) => error,
        };
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_MODE_STATE_CORRUPT");
        let after = mode_meta(&connection);
        assert_eq!(before, after);
        assert!(!after.contains_key(META_STAGED_AUTH_MODE_MANIFEST));
        assert_eq!(
            std::fs::read(&path).unwrap(),
            database_bytes_before,
            "corrupt open must not alter the database image"
        );
        assert_eq!(
            std::fs::read(&wal_path).unwrap(),
            wal_bytes_before,
            "corrupt open must not append, checkpoint, or rewrite the WAL"
        );
    }

    #[test]
    fn same_mode_pair_updates_manifest_and_active_deployment_atomically() {
        let mut database = LocalDatabase::memory().unwrap();
        let (identity, manifest) = dev_pair(Some("items"));
        database
            .apply_same_mode_schema(identity.clone(), manifest.clone())
            .unwrap();
        let snapshot = database.auth_mode_snapshot().unwrap();
        assert_eq!(snapshot.state.active_deployment, Some(identity));
        assert_eq!(snapshot.active_manifest, Some(manifest));
        let values = mode_meta(&database.conn);
        assert_eq!(
            values.get(META_LEGACY_SCHEMA_MANIFEST),
            values.get(META_CAPABILITY_AWARE_SCHEMA_MANIFEST)
        );
    }

    #[test]
    fn production_same_mode_seam_requires_complete_dev_pair_and_refuses_sessions() {
        let mut database = LocalDatabase::memory().unwrap();
        let (dev_identity, dev_manifest) = dev_pair(Some("items"));
        let dev_functions = function_half(&dev_identity);
        database
            .apply_same_mode_dev_deployment_with_functions(
                dev_identity.clone(),
                dev_manifest.clone(),
                &dev_functions,
                None,
            )
            .unwrap();

        let mut mismatched_functions = dev_functions;
        mismatched_functions.bundle_hash = Some("sha256:other-functions".to_owned());
        let mismatch = database
            .apply_same_mode_dev_deployment_with_functions(
                dev_identity.clone(),
                dev_manifest,
                &mismatched_functions,
                None,
            )
            .unwrap_err();
        assert_eq!(mismatch.diagnostic.code, "SNAPBACK_AUTH_MODE_STATE_CORRUPT");

        let (sessions_identity, sessions_manifest) = sessions_pair(None);
        let sessions_error = database
            .apply_same_mode_dev_deployment_with_functions(
                sessions_identity,
                sessions_manifest,
                &function_half(&dev_identity),
                None,
            )
            .unwrap_err();
        assert_eq!(
            sessions_error.diagnostic.code,
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        );
        assert_eq!(
            database
                .auth_mode_snapshot()
                .unwrap()
                .state
                .active_deployment,
            Some(dev_identity)
        );
    }

    #[test]
    fn seed_failure_rolls_back_stage_ddl_and_state() {
        let mut database = LocalDatabase::memory().unwrap();
        let (identity, manifest) = sessions_pair(Some("items"));
        let mut tables = BTreeMap::new();
        let mut row = Map::new();
        row.insert("value".to_owned(), serde_json::Value::Number(1.into()));
        tables.insert("items".to_owned(), vec![row]);
        let error = database
            .stage_auth_mode(identity, manifest, Some(SeedData { tables }))
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_FIELD_TYPE_MISMATCH");
        assert_eq!(
            database.auth_mode_snapshot().unwrap().state.mode_state,
            AuthModeStatus::Settled
        );
        let physical: i64 = database
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='items'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(physical, 0);
    }
}
impl super::ServingDatabase {
    pub fn stage_auth_mode_with_functions(
        &mut self,
        requested_deployment: DeploymentIdentity,
        schema_manifest: SchemaManifest,
        functions: &FunctionManifest,
        seed: Option<SeedData>,
    ) -> SnapbackResult<AuthModeStateRecord> {
        self.db.stage_auth_mode_with_functions(
            requested_deployment,
            schema_manifest,
            functions,
            seed,
        )
    }
    pub fn stage_auth_mode_with_functions_classified(
        &mut self,
        requested_deployment: DeploymentIdentity,
        schema_manifest: SchemaManifest,
        functions: &FunctionManifest,
        seed: Option<SeedData>,
    ) -> DurableModeCommit<AuthModeStateRecord> {
        self.db.stage_auth_mode_with_functions_classified(
            requested_deployment,
            schema_manifest,
            functions,
            seed,
        )
    }
    pub fn quarantine_auth_mode(&mut self, code: &str) -> SnapbackResult<AuthModeStateRecord> {
        self.db.quarantine_auth_mode(code)
    }
    pub fn unstage_auth_mode(&mut self) -> SnapbackResult<AuthModeStateRecord> {
        self.db.unstage_auth_mode()
    }
    pub fn consume_sessions_auth_mode_with_functions(
        &mut self,
        readiness: &AuthProgramReadiness,
        functions: &FunctionManifest,
    ) -> SnapbackResult<AuthModeStateRecord> {
        self.db
            .consume_sessions_auth_mode_with_functions(readiness, functions)
    }
    pub fn consume_sessions_auth_mode_with_functions_and_catalog_activation(
        &mut self,
        readiness: &AuthProgramReadiness,
        functions: &FunctionManifest,
        activation: &crate::auth::keyring::PreparedAuthCatalogActivation,
    ) -> SnapbackResult<AuthModeStateRecord> {
        self.db
            .consume_sessions_auth_mode_with_functions_and_catalog_activation(
                readiness, functions, activation,
            )
    }
    pub fn consume_dev_downgrade_with_functions(
        &mut self,
        allow_auth_downgrade: bool,
        now_ms: u64,
        functions: &FunctionManifest,
    ) -> SnapbackResult<AuthModeDowngradeResult> {
        self.db
            .consume_dev_downgrade_with_functions(allow_auth_downgrade, now_ms, functions)
    }
    pub fn apply_same_mode_dev_deployment_with_functions(
        &mut self,
        deployment: DeploymentIdentity,
        manifest: SchemaManifest,
        functions: &FunctionManifest,
        seed: Option<SeedData>,
    ) -> SnapbackResult<()> {
        self.db
            .apply_same_mode_dev_deployment_with_functions(deployment, manifest, functions, seed)
    }
}
