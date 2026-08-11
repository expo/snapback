//! Durable exact-function scope bases for LLP 0055 grants.
//!
//! Every function id keeps one row forever. Removal advances its generation
//! and marks it absent; re-adding the same shape makes that tombstone present
//! again without resetting the generation. Kind or `authorityCreating`
//! changes advance once at the activation that observes the change.
//!
//! @ref LLP 0055#grants — function removal, kind changes, and
//!   `authorityCreating` changes terminally invalidate previously consented
//!   exact scopes, including across restart and remove/re-add ABA cycles.

use super::LocalDatabase;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{FunctionDefinition, FunctionKind, FunctionManifest};
use rusqlite::{OptionalExtension, params};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ScopeBasis {
    pub function_id: String,
    pub kind: String,
    pub generation: u64,
    pub present: bool,
    pub authority_creating: bool,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct ScopeBasisReconciliation {
    /// Functions whose generation advanced in this activation. Callers use
    /// this witness to drive the single LLP 0053 event-2 invalidation cause.
    pub basis_advanced: BTreeSet<String>,
    pub became_present: BTreeSet<String>,
    pub became_absent: BTreeSet<String>,
}

/// Distinguished non-function consent entry for near-data AI. The spelling
/// makes the data-egress consequence visible even in generic approval UIs
/// that render exact scope rows without a Snapback-specific label table.
///
/// @ref LLP 0204#d5--surface-4-the-near-data-ai-interface — ask consent is
/// separate from ordinary query scopes and names authorized data egress.
pub(crate) const ASK_SCOPE_ID: &str = "snapback:ask:data-egress";

impl ScopeBasisReconciliation {
    pub(crate) fn advances_authorization(&self) -> bool {
        !self.basis_advanced.is_empty()
    }
}

impl LocalDatabase {
    /// Reconcile the complete active function set in one protected-catalog
    /// transaction. Rows are never deleted. A malformed stored row fails
    /// closed before any update commits.
    pub(crate) fn reconcile_auth_scope_bases(
        &mut self,
        manifest: &FunctionManifest,
    ) -> SnapbackResult<ScopeBasisReconciliation> {
        self.with_auth_transaction(|tx| reconcile_auth_scope_bases_on(tx, manifest))
    }

    pub(crate) fn reconcile_auth_scope_bases_with_schema(
        &mut self,
        manifest: &FunctionManifest,
        schema: &crate::manifest::SchemaManifest,
    ) -> SnapbackResult<ScopeBasisReconciliation> {
        self.with_auth_transaction(|tx| {
            let mut result = reconcile_auth_scope_bases_on(tx, manifest)?;
            reconcile_ask_scope_basis_on(tx, schema, &mut result)?;
            Ok(result)
        })
    }

    /// Return a callable exact-function basis only when every consent-bound
    /// shape field still matches. Missing, removed, or mismatched entries are
    /// indistinguishable to grant enforcement.
    pub(crate) fn current_auth_scope_basis(
        &self,
        function_id: &str,
        kind: &FunctionKind,
        authority_creating: bool,
    ) -> SnapbackResult<Option<u64>> {
        self.with_auth_read(|conn| {
            let row = conn
                .query_row(
                    "SELECT generation, present, authority_creating
                     FROM _auth_scope_bases
                     WHERE function_id = ?1 AND kind = ?2",
                    params![function_id, function_kind_name(kind)],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )
                .optional()?;
            let Some((generation, present, stored_authority_creating)) = row else {
                return Ok(None);
            };
            if generation < 0
                || !matches!(present, 0 | 1)
                || !matches!(stored_authority_creating, 0 | 1)
            {
                return Err(scope_basis_corrupt());
            }
            Ok(
                (present == 1 && stored_authority_creating == i64::from(authority_creating))
                    .then_some(generation as u64),
            )
        })
    }
}

/// Transactional core used by deployment activation. The caller owns the
/// event-2 authorization hook and commit, so the basis tombstones and version
/// advance cannot become externally visible in different cuts.
pub(super) fn reconcile_auth_scope_bases_on(
    tx: &rusqlite::Transaction<'_>,
    manifest: &FunctionManifest,
) -> SnapbackResult<ScopeBasisReconciliation> {
    let incoming = incoming_functions(manifest)?;
    let mut stored = BTreeMap::new();
    let mut statement = tx.prepare(
        "SELECT function_id, kind, generation, present, authority_creating
         FROM _auth_scope_bases ORDER BY function_id",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
        ))
    })?;
    for row in rows {
        let (function_id, kind, generation, present, authority_creating) = row?;
        if function_id.is_empty()
            || kind.is_empty()
            || generation < 0
            || !matches!(present, 0 | 1)
            || !matches!(authority_creating, 0 | 1)
        {
            return Err(scope_basis_corrupt());
        }
        stored.insert(
            function_id.clone(),
            ScopeBasis {
                function_id,
                kind,
                generation: generation as u64,
                present: present == 1,
                authority_creating: authority_creating == 1,
            },
        );
    }
    drop(statement);

    let mut reconciliation = ScopeBasisReconciliation::default();
    for (function_id, basis) in &stored {
        // Distinguished surface scopes are reconciled against their schema
        // declaration below. Treating one as a removed function here would
        // churn its basis on every otherwise-no-op generation activation.
        if function_id == ASK_SCOPE_ID {
            continue;
        }
        match incoming.get(function_id) {
            None if basis.present => {
                let generation = next_generation(basis.generation)?;
                tx.execute(
                    "UPDATE _auth_scope_bases
                     SET generation = ?1, present = 0
                     WHERE function_id = ?2",
                    params![generation as i64, function_id],
                )?;
                reconciliation.basis_advanced.insert(function_id.clone());
                reconciliation.became_absent.insert(function_id.clone());
            }
            None => {}
            Some(function) => {
                let kind = function_kind_name(&function.kind);
                let shape_changed =
                    basis.kind != kind || basis.authority_creating != function.authority_creating;
                let generation = if shape_changed {
                    reconciliation.basis_advanced.insert(function_id.clone());
                    next_generation(basis.generation)?
                } else {
                    basis.generation
                };
                if !basis.present {
                    reconciliation.became_present.insert(function_id.clone());
                }
                if shape_changed || !basis.present {
                    tx.execute(
                        "UPDATE _auth_scope_bases
                         SET kind = ?1, generation = ?2, present = 1,
                             authority_creating = ?3
                         WHERE function_id = ?4",
                        params![
                            kind,
                            generation as i64,
                            i64::from(function.authority_creating),
                            function_id,
                        ],
                    )?;
                }
            }
        }
    }

    for (function_id, function) in &incoming {
        if stored.contains_key(function_id) {
            continue;
        }
        tx.execute(
            "INSERT INTO _auth_scope_bases(
               function_id, kind, generation, present, authority_creating
             ) VALUES(?1, ?2, 0, 1, ?3)",
            params![
                function_id,
                function_kind_name(&function.kind),
                i64::from(function.authority_creating),
            ],
        )?;
        reconciliation.became_present.insert(function_id.clone());
    }

    Ok(reconciliation)
}

pub(super) fn reconcile_auth_scope_bases_with_schema_on(
    tx: &rusqlite::Transaction<'_>,
    manifest: &FunctionManifest,
    schema: &crate::manifest::SchemaManifest,
) -> SnapbackResult<ScopeBasisReconciliation> {
    let mut result = reconcile_auth_scope_bases_on(tx, manifest)?;
    reconcile_ask_scope_basis_on(tx, schema, &mut result)?;
    Ok(result)
}

fn reconcile_ask_scope_basis_on(
    tx: &rusqlite::Transaction<'_>,
    schema: &crate::manifest::SchemaManifest,
    result: &mut ScopeBasisReconciliation,
) -> SnapbackResult<()> {
    let enabled = schema.ask_manifest().is_some();
    let stored = tx
        .query_row(
            "SELECT kind, generation, present, authority_creating
             FROM _auth_scope_bases WHERE function_id = ?1",
            params![ASK_SCOPE_ID],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()?;
    match stored {
        None if enabled => {
            tx.execute(
                "INSERT INTO _auth_scope_bases(function_id, kind, generation, present, authority_creating)
                 VALUES(?1, 'query', 0, 1, 0)",
                params![ASK_SCOPE_ID],
            )?;
            result.became_present.insert(ASK_SCOPE_ID.to_owned());
        }
        Some((kind, generation, present, authority_creating)) => {
            if generation < 0 || !matches!(present, 0 | 1) || !matches!(authority_creating, 0 | 1) {
                return Err(scope_basis_corrupt());
            }
            let shape_changed = kind != "query" || authority_creating != 0;
            if enabled {
                let generation = if shape_changed {
                    result.basis_advanced.insert(ASK_SCOPE_ID.to_owned());
                    next_generation(generation as u64)?
                } else {
                    generation as u64
                };
                if present == 0 {
                    result.became_present.insert(ASK_SCOPE_ID.to_owned());
                }
                if shape_changed || present == 0 {
                    tx.execute(
                        "UPDATE _auth_scope_bases SET kind='query', generation=?1, present=1, authority_creating=0 WHERE function_id=?2",
                        params![generation as i64, ASK_SCOPE_ID],
                    )?;
                }
            } else if present == 1 {
                let generation = next_generation(generation as u64)?;
                tx.execute(
                    "UPDATE _auth_scope_bases SET generation=?1, present=0 WHERE function_id=?2",
                    params![generation as i64, ASK_SCOPE_ID],
                )?;
                result.basis_advanced.insert(ASK_SCOPE_ID.to_owned());
                result.became_absent.insert(ASK_SCOPE_ID.to_owned());
            }
        }
        None => {}
    }
    Ok(())
}

fn incoming_functions(
    manifest: &FunctionManifest,
) -> SnapbackResult<BTreeMap<String, &FunctionDefinition>> {
    let mut incoming = BTreeMap::new();
    for function in &manifest.functions {
        if function.id.is_empty() || incoming.insert(function.id.clone(), function).is_some() {
            return Err(SnapbackError::error(
                "SNAPBACK_FUNCTION_IDENTITY_INVALID",
                "manifest",
                "scope-basis reconciliation requires unique, non-empty function ids",
            ));
        }
    }
    Ok(incoming)
}

pub(crate) const fn function_kind_name(kind: &FunctionKind) -> &'static str {
    match kind {
        FunctionKind::Query => "query",
        FunctionKind::Mutation => "mutation",
        FunctionKind::LiveQuery => "liveQuery",
        FunctionKind::Action => "action",
    }
}

fn next_generation(generation: u64) -> SnapbackResult<u64> {
    generation
        .checked_add(1)
        .filter(|generation| *generation <= i64::MAX as u64)
        .ok_or_else(scope_basis_corrupt)
}

fn scope_basis_corrupt() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_SCOPE_BASIS_CORRUPT",
        "auth",
        "stored function scope basis is corrupt",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{
        ApiAskBilling, ApiAskBudgets, ApiAskManifest, ApiAskPerPrincipalDayBudget,
        ApiAskPerRequestBudget, ApiAskResultVolumeBudget, ApiAskTokenBudget, ApiBudgetsManifest,
        ApiManifest, FunctionDefinition, FunctionRuntime, HandlerPlan, QueryPlan, SchemaManifest,
    };

    fn function(id: &str, kind: FunctionKind, authority_creating: bool) -> FunctionDefinition {
        let mut function = FunctionDefinition::new(
            id,
            kind,
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
        function.id = id.to_owned();
        function.authority_creating = authority_creating;
        function
    }

    fn manifest(functions: Vec<FunctionDefinition>) -> FunctionManifest {
        FunctionManifest {
            functions,
            ..FunctionManifest::default()
        }
    }

    fn ready() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.activate_current_auth_catalog().expect("auth catalog v2");
        db
    }

    fn ask_schema() -> SchemaManifest {
        SchemaManifest {
            api: Some(ApiManifest {
                enabled: true,
                ask: Some(ApiAskManifest {
                    enabled: true,
                    billing: ApiAskBilling::CallerKey,
                    model: None,
                }),
                budgets: Some(ApiBudgetsManifest {
                    ask: Some(ApiAskBudgets {
                        per_request: ApiAskPerRequestBudget {
                            max_tokens: 10,
                            max_steps: 4,
                            max_wall_ms: 1_000,
                        },
                        per_principal_day: ApiAskPerPrincipalDayBudget { max_tokens: 100 },
                        per_integration_day: None,
                        app_monthly: ApiAskTokenBudget { max_tokens: 1_000 },
                        result_volume: ApiAskResultVolumeBudget {
                            max_bytes: 1_000,
                            max_rows: 10,
                            per_principal_day_bytes: 10_000,
                        },
                    }),
                }),
                ..ApiManifest::default()
            }),
            ..SchemaManifest::default()
        }
    }

    #[test]
    fn distinguished_ask_basis_is_stable_until_the_schema_disables_it() {
        let mut db = ready();
        let functions = manifest(vec![function("fn:read", FunctionKind::Query, false)]);
        let enabled = ask_schema();
        let added = db
            .reconcile_auth_scope_bases_with_schema(&functions, &enabled)
            .unwrap();
        assert_eq!(
            added.became_present,
            BTreeSet::from(["fn:read".to_owned(), ASK_SCOPE_ID.to_owned(),])
        );
        assert_eq!(
            db.current_auth_scope_basis(ASK_SCOPE_ID, &FunctionKind::Query, false)
                .unwrap(),
            Some(0)
        );

        let unchanged = db
            .reconcile_auth_scope_bases_with_schema(&functions, &enabled)
            .unwrap();
        assert!(!unchanged.advances_authorization());
        assert_eq!(
            db.current_auth_scope_basis(ASK_SCOPE_ID, &FunctionKind::Query, false)
                .unwrap(),
            Some(0)
        );

        let removed = db
            .reconcile_auth_scope_bases_with_schema(&functions, &SchemaManifest::default())
            .unwrap();
        assert_eq!(
            removed.became_absent,
            BTreeSet::from([ASK_SCOPE_ID.to_owned()])
        );
        assert_eq!(
            db.current_auth_scope_basis(ASK_SCOPE_ID, &FunctionKind::Query, false)
                .unwrap(),
            None
        );
    }

    #[test]
    fn removal_tombstone_survives_restart_and_same_shape_readd() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("scope-bases.sqlite3");
        {
            let mut db = LocalDatabase::open(&path).unwrap();
            db.activate_current_auth_catalog().unwrap();
            let initial = manifest(vec![function("fn:read", FunctionKind::Query, false)]);
            let added = db.reconcile_auth_scope_bases(&initial).unwrap();
            assert!(!added.advances_authorization());
            assert_eq!(
                db.current_auth_scope_basis("fn:read", &FunctionKind::Query, false)
                    .unwrap(),
                Some(0)
            );
            let removed = db
                .reconcile_auth_scope_bases(&manifest(Vec::new()))
                .unwrap();
            assert_eq!(
                removed.basis_advanced,
                BTreeSet::from(["fn:read".to_owned()])
            );
            assert_eq!(
                db.current_auth_scope_basis("fn:read", &FunctionKind::Query, false)
                    .unwrap(),
                None
            );
        }

        let mut reopened = LocalDatabase::open(&path).unwrap();
        let readded = reopened
            .reconcile_auth_scope_bases(&manifest(vec![function(
                "fn:read",
                FunctionKind::Query,
                false,
            )]))
            .unwrap();
        assert!(!readded.advances_authorization());
        assert_eq!(
            reopened
                .current_auth_scope_basis("fn:read", &FunctionKind::Query, false)
                .unwrap(),
            Some(1)
        );
    }

    #[test]
    fn kind_and_authority_marker_changes_each_advance_basis() {
        let mut db = ready();
        db.reconcile_auth_scope_bases(&manifest(vec![function(
            "fn:write",
            FunctionKind::Mutation,
            false,
        )]))
        .unwrap();

        let kind_change = db
            .reconcile_auth_scope_bases(&manifest(vec![function(
                "fn:write",
                FunctionKind::Action,
                false,
            )]))
            .unwrap();
        assert!(kind_change.advances_authorization());
        assert_eq!(
            db.current_auth_scope_basis("fn:write", &FunctionKind::Action, false)
                .unwrap(),
            Some(1)
        );

        let marker_change = db
            .reconcile_auth_scope_bases(&manifest(vec![function(
                "fn:write",
                FunctionKind::Action,
                true,
            )]))
            .unwrap();
        assert!(marker_change.advances_authorization());
        assert_eq!(
            db.current_auth_scope_basis("fn:write", &FunctionKind::Action, true)
                .unwrap(),
            Some(2)
        );
        assert_eq!(
            db.current_auth_scope_basis("fn:write", &FunctionKind::Action, false)
                .unwrap(),
            None
        );
    }

    #[test]
    fn different_shape_readd_advances_the_removal_tombstone_again() {
        let mut db = ready();
        db.reconcile_auth_scope_bases(&manifest(vec![function(
            "fn:read",
            FunctionKind::Query,
            false,
        )]))
        .unwrap();
        db.reconcile_auth_scope_bases(&manifest(Vec::new()))
            .unwrap();
        let readded = db
            .reconcile_auth_scope_bases(&manifest(vec![function(
                "fn:read",
                FunctionKind::Mutation,
                true,
            )]))
            .unwrap();
        assert!(readded.advances_authorization());
        assert_eq!(
            db.current_auth_scope_basis("fn:read", &FunctionKind::Mutation, true)
                .unwrap(),
            Some(2)
        );
    }
}
