//! SQLite persistence for LLP 0055's four-key staged auth-mode protocol.

// @ref LLP 0055#the-four-keys — these exact metadata keys are the sole durable
// mode authority and are always cross-validated before mutation.
// @ref LLP 0055#corrupt-state-boundary — corrupt state is a read-only startup
// refusal; quarantine is reserved for a valid pending snapshot.
// @ref LLP 0055#crash-and-publication-traces — each state transition has one
// SQLite commit boundary and no guessed repair path.

use super::{
    LocalDatabase, create_index, create_or_update_table, current_version_on, physical_user_tables,
    reject_field_retypes, reject_unsafe_required_field_changes, schema_table,
    seed_into_transaction, set_version, validate_schema,
};
use crate::auth::mode::{
    AUTH_MODE_FORMAT_VERSION, AppDataAvailability, AuthModeQuarantine, AuthModeStateRecord,
    AuthModeStatus, AuthProgramReadiness, DeploymentIdentity, LEGACY_MANIFEST_POISON,
    StagedAuthModeRecord, mode_corrupt,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{AuthMode, SchemaManifest, SeedData};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use std::collections::BTreeMap;

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
pub(crate) enum NetworkSeedOutcome {
    SkippedAbsent,
    Seeded,
    SkippedNonempty,
}

impl NetworkSeedOutcome {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::SkippedAbsent => "skipped-absent",
            Self::Seeded => "seeded",
            Self::SkippedNonempty => "skipped-nonempty",
        }
    }
}

#[derive(Clone, Debug)]
pub(super) enum OpenAuthModeInspection {
    Fresh,
    Legacy {
        raw_manifest: String,
        manifest: SchemaManifest,
    },
    Managed(AuthModeSnapshot),
}

impl OpenAuthModeInspection {
    pub(super) fn active_manifest(&self) -> Option<&SchemaManifest> {
        match self {
            Self::Fresh => None,
            Self::Legacy { manifest, .. } => Some(manifest),
            Self::Managed(snapshot) => snapshot.active_manifest.as_ref(),
        }
    }
}

#[cfg(test)]
thread_local! {
    static FAIL_AUTH_MODE_TRANSACTION_AFTER_STEP: std::cell::Cell<Option<usize>> =
        const { std::cell::Cell::new(None) };
}

#[cfg(test)]
fn inject_auth_mode_failure_after_step(step: usize) {
    FAIL_AUTH_MODE_TRANSACTION_AFTER_STEP.with(|slot| {
        assert!(slot.get().is_none(), "auth-mode hook must be one-shot");
        slot.set(Some(step));
    });
}

fn transaction_step_completed(step: usize) -> SnapbackResult<()> {
    #[cfg(not(test))]
    let _ = step;
    #[cfg(test)]
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

impl LocalDatabase {
    pub fn auth_mode_snapshot(&self) -> SnapbackResult<AuthModeSnapshot> {
        match inspect_for_open(&self.conn)? {
            OpenAuthModeInspection::Managed(snapshot) => Ok(snapshot),
            OpenAuthModeInspection::Fresh | OpenAuthModeInspection::Legacy { .. } => Err(
                mode_corrupt("an open database has not adopted the auth-mode record"),
            ),
        }
    }

    /// Stage a complete transition. The caller has already closed invocation
    /// admission and preflighted the function half; storage revalidates the
    /// durable state and schema half under an IMMEDIATE transaction.
    pub fn stage_auth_mode(
        &mut self,
        requested_deployment: DeploymentIdentity,
        schema_manifest: SchemaManifest,
        seed: Option<SeedData>,
    ) -> SnapbackResult<AuthModeStateRecord> {
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

        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = require_managed_snapshot(&tx)?;
        require_transition_source(&current.state, requested_deployment.auth_mode)?;
        if seed.is_some() {
            require_fresh_seed_target(&tx, &current.state)?;
        }

        // DDL precedes seed, and both precede mode metadata in this transaction.
        for table in &schema_manifest.tables {
            create_or_update_table(&tx, table)?;
            for index in &table.indexes {
                create_index(&tx, table, index.name.as_str(), &index.fields)?;
            }
        }
        transaction_step_completed(0)?;

        if let Some(seed) = seed {
            let next_version = current_version_on(&tx)?
                .checked_add(1)
                .ok_or_else(|| mode_corrupt("app version overflowed while staging auth mode"))?;
            let changed = seed_into_transaction(&tx, &schema_manifest, seed, next_version)?;
            if changed > 0 {
                set_version(&tx, next_version)?;
            }
        }
        transaction_step_completed(1)?;

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
        save_json_meta(&tx, META_STAGED_AUTH_MODE_MANIFEST, &staged)?;
        transaction_step_completed(2)?;
        save_json_meta(&tx, META_AUTH_MODE_STATE, &next)?;
        transaction_step_completed(3)?;
        require_managed_snapshot(&tx)?;
        tx.commit()?;
        Ok(next)
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
    pub fn consume_sessions_auth_mode(
        &mut self,
        readiness: &AuthProgramReadiness,
    ) -> SnapbackResult<AuthModeStateRecord> {
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

        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = require_managed_snapshot(&tx)?;
        require_pending_direction(&current, AuthMode::Dev, AuthMode::Sessions)?;
        let staged = current
            .staged
            .ok_or_else(|| mode_corrupt("sessions consume lacks a staged manifest"))?;
        crate::storage::auth::activate_auth_catalog_v1_in(&tx)?;
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
        require_managed_snapshot(&tx)?;
        tx.commit()?;
        self.schema = staged.schema_manifest;
        Ok(next)
    }

    pub fn consume_dev_downgrade(
        &mut self,
        allow_auth_downgrade: bool,
        now_ms: u64,
    ) -> SnapbackResult<AuthModeDowngradeResult> {
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

        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = require_managed_snapshot(&tx)?;
        require_pending_direction(&current, AuthMode::Sessions, AuthMode::Dev)?;
        let staged = current
            .staged
            .ok_or_else(|| mode_corrupt("downgrade consume lacks a staged manifest"))?;
        let sessions_revoked = crate::storage::auth::revoke_all_sessions_in(&tx, now_ms)?;
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
        require_managed_snapshot(&tx)?;
        tx.commit()?;
        self.schema = staged.schema_manifest;
        Ok(AuthModeDowngradeResult {
            state: next,
            sessions_revoked,
        })
    }

    /// Same-mode deployment update with an exact complete pair identity. This
    /// is the integration seam that atomically advances `activeDeployment`.
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
    pub fn apply_same_mode_deployment(
        &mut self,
        deployment: DeploymentIdentity,
        manifest: SchemaManifest,
        seed: Option<SeedData>,
    ) -> SnapbackResult<()> {
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
        apply_schema_ddl(&tx, &manifest)?;
        if let Some(seed) = seed {
            require_fresh_seed_target(&tx, &current.state)?;
            let next_version = current_version_on(&tx)?
                .checked_add(1)
                .ok_or_else(|| mode_corrupt("app version overflowed while seeding deployment"))?;
            let changed = seed_into_transaction(&tx, &manifest, seed, next_version)?;
            if changed > 0 {
                set_version(&tx, next_version)?;
            }
        }
        let raw = serialize_json(&manifest)?;
        save_active_manifest_in(&tx, &current.state, &raw)?;
        let next = AuthModeStateRecord {
            active_deployment: Some(deployment),
            ..current.state
        };
        next.validate_shape()?;
        save_json_meta(&tx, META_AUTH_MODE_STATE, &next)?;
        require_managed_snapshot(&tx)?;
        tx.commit()?;
        self.schema = manifest;
        Ok(())
    }

    /// Same-mode network provisioning keeps the legacy seed-if-empty behavior
    /// while making DDL, seed, both active-manifest keys, and
    /// `activeDeployment` one transaction. Unlike the cold-start carrier seam,
    /// a repeated network provision may carry seed data for an existing app;
    /// it is applied only when every named target is empty.
    // @ref LLP 0055#same-mode-provisioning — a complete preflighted pair advances schema and deployment identity atomically before function publication.
    pub(crate) fn apply_same_mode_network_deployment(
        &mut self,
        deployment: DeploymentIdentity,
        manifest: SchemaManifest,
        seed: Option<SeedData>,
    ) -> SnapbackResult<NetworkSeedOutcome> {
        deployment.validate()?;
        deployment.validate_schema_half(&manifest)?;
        validate_schema(&manifest)?;
        reject_field_retypes(&self.schema, &manifest)?;
        reject_unsafe_required_field_changes(&self.conn, &self.schema, &manifest)?;

        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = require_managed_snapshot(&tx)?;
        require_settled_available(&current.state)?;
        if deployment.auth_mode != current.state.active {
            return Err(mode_corrupt(
                "same-mode network deployment differs from active auth mode",
            ));
        }

        apply_schema_ddl(&tx, &manifest)?;
        let seed_outcome = match seed {
            None => NetworkSeedOutcome::SkippedAbsent,
            Some(seed) => {
                let mut all_empty = true;
                for table in seed.tables.keys() {
                    // `schema_table` validates the logical target before the
                    // quoted physical lookup. Any invalid seed rolls this
                    // transaction back, including additive DDL.
                    schema_table(&manifest, table)?;
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
                    let next_version =
                        current_version_on(&tx)?.checked_add(1).ok_or_else(|| {
                            mode_corrupt("app version overflowed while provisioning deployment")
                        })?;
                    let changed = seed_into_transaction(&tx, &manifest, seed, next_version)?;
                    if changed > 0 {
                        set_version(&tx, next_version)?;
                    }
                    NetworkSeedOutcome::Seeded
                } else {
                    NetworkSeedOutcome::SkippedNonempty
                }
            }
        };

        let raw = serialize_json(&manifest)?;
        save_active_manifest_in(&tx, &current.state, &raw)?;
        let next = AuthModeStateRecord {
            active_deployment: Some(deployment),
            ..current.state
        };
        next.validate_shape()?;
        save_json_meta(&tx, META_AUTH_MODE_STATE, &next)?;
        require_managed_snapshot(&tx)?;
        tx.commit()?;
        self.schema = manifest;
        Ok(seed_outcome)
    }

    pub(super) fn apply_schema_mode_aware(
        &mut self,
        manifest: SchemaManifest,
    ) -> SnapbackResult<()> {
        validate_schema(&manifest)?;
        reject_field_retypes(&self.schema, &manifest)?;
        reject_unsafe_required_field_changes(&self.conn, &self.schema, &manifest)?;
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
        apply_schema_ddl(&tx, &manifest)?;
        let raw = serialize_json(&manifest)?;
        save_active_manifest_in(&tx, &current.state, &raw)?;
        require_managed_snapshot(&tx)?;
        tx.commit()?;
        self.schema = manifest;
        Ok(())
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
                    manifest,
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

    Ok(OpenAuthModeInspection::Managed(AuthModeSnapshot {
        state,
        staged,
        active_manifest,
    }))
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
            (Some(expected_raw), Some(expected_manifest))
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
        db.schema = manifest;
    }
    Ok(())
}

fn require_managed_snapshot(conn: &Connection) -> SnapbackResult<AuthModeSnapshot> {
    match inspect_for_open(conn)? {
        OpenAuthModeInspection::Managed(snapshot) => Ok(snapshot),
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
    if state.active_deployment.is_some() {
        return Err(mode_corrupt(
            "transition seed is allowed only for a fresh database",
        ));
    }
    for table in physical_user_tables(conn)? {
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
}

fn apply_schema_ddl(tx: &Transaction<'_>, manifest: &SchemaManifest) -> SnapbackResult<()> {
    for table in &manifest.tables {
        create_or_update_table(tx, table)?;
        for index in &table.indexes {
            create_index(tx, table, index.name.as_str(), &index.fields)?;
        }
    }
    Ok(())
}

fn save_active_manifest_in(
    tx: &Transaction<'_>,
    state: &AuthModeStateRecord,
    raw: &str,
) -> SnapbackResult<()> {
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
    use crate::manifest::{AuthManifest, FieldManifest, FieldType, TableManifest};
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
            session_activation_ready: true,
        }
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
                "CREATE TABLE _snapback_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);",
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
    fn same_mode_network_deployment_commits_identity_and_seed_if_empty_once() {
        let mut database = LocalDatabase::memory().unwrap();
        let (identity, manifest) = dev_pair(Some("network_items"));
        let mut row = Map::new();
        row.insert("_id".to_owned(), serde_json::json!("seeded"));
        row.insert("value".to_owned(), serde_json::json!("first"));
        let seed = SeedData {
            tables: BTreeMap::from([("network_items".to_owned(), vec![row])]),
        };

        let outcome = database
            .apply_same_mode_network_deployment(
                identity.clone(),
                manifest.clone(),
                Some(seed.clone()),
            )
            .unwrap();
        assert_eq!(outcome, NetworkSeedOutcome::Seeded);
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

        let outcome = database
            .apply_same_mode_network_deployment(identity, manifest, Some(seed))
            .unwrap();
        assert_eq!(outcome, NetworkSeedOutcome::SkippedNonempty);
        let count: i64 = database
            .conn
            .query_row("SELECT COUNT(*) FROM network_items", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

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
    fn downgrade_flag_quarantines_then_explicit_consume_revokes_sessions() {
        let mut database = LocalDatabase::memory().unwrap();
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
                tx.execute(
                    "INSERT INTO _auth_identities(id, user_id, provider, subject, verified_at_ms)
                     VALUES('i', 'u', 'email-code', 'u@example.com', 1)",
                    [],
                )?;
                tx.execute(
                    "INSERT INTO _auth_sessions(
                       id, user_id, identity_id, authority_instance_id, token_hash, generation,
                       created_at_ms, last_used_at_ms, expires_at_ms, absolute_expires_at_ms
                     ) VALUES('s', 'u', 'i', 'a', zeroblob(32), 1, 1, 1, 100, 100)",
                    [],
                )?;
                Ok(())
            })
            .unwrap();

        let (dev_identity, dev_manifest) = dev_pair(None);
        database
            .stage_auth_mode(dev_identity, dev_manifest.clone(), None)
            .unwrap();
        let error = database.consume_dev_downgrade(false, 10).unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_MODE_DOWNGRADE");
        assert_eq!(
            database.auth_mode_snapshot().unwrap().state.mode_state,
            AuthModeStatus::Quarantined
        );

        let result = database.consume_dev_downgrade(true, 10).unwrap();
        assert_eq!(result.sessions_revoked, 1);
        assert_eq!(result.state.active, AuthMode::Dev);
        let (generation, revoked): (i64, Option<i64>) = database
            .with_auth_read(|conn| {
                Ok(conn.query_row(
                    "SELECT generation, revoked_at_ms FROM _auth_sessions WHERE id = 's'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?)
            })
            .unwrap();
        assert_eq!((generation, revoked), (2, Some(10)));
        assert_eq!(database.schema(), &dev_manifest);
        assert_eq!(
            mode_meta(&database.conn)
                .get(META_LEGACY_SCHEMA_MANIFEST)
                .map(String::as_str),
            Some(LEGACY_MANIFEST_POISON)
        );
    }

    #[test]
    fn corrupt_mode_open_is_read_only_and_never_quarantines() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("corrupt.sqlite");
        drop(LocalDatabase::open(&path).unwrap());
        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "UPDATE _snapback_meta SET value = ?2 WHERE key = ?1",
                params![META_AUTH_MODE_STATE, r#"{"formatVersion":2}"#],
            )
            .unwrap();
        let before = mode_meta(&connection);
        drop(connection);

        let error = match LocalDatabase::open(&path) {
            Ok(_) => panic!("corrupt auth-mode state must refuse open"),
            Err(error) => error,
        };
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_MODE_STATE_CORRUPT");
        let connection = Connection::open(&path).unwrap();
        let after = mode_meta(&connection);
        assert_eq!(before, after);
        assert!(!after.contains_key(META_STAGED_AUTH_MODE_MANIFEST));
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
