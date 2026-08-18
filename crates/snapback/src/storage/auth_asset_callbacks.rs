//! Bearer-free service authority for sessions-mode asset lifecycle callbacks.
//!
//! The callback runner is server-originated, but it is not anonymous/system
//! authority and it never impersonates the asset owner. This module keeps the
//! LLP 0055 identity and grant facts in the protected auth catalog while
//! deliberately minting no credential, scoped-token secret, or user session.
//!
//! @ref LLP 0039#dated-amendment-sessions-asset-callback-execution-authority-2026-08-03
//!   — sessions callbacks run as an explicitly distinguishable service
//!   principal and remain ordinary validated mutations.
//! @ref LLP 0055#dated-amendment-per-app-asset-callbacks-service-principal-2026-08-03
//!   — one per-app `asset-callbacks` principal receives auditable immutable
//!   exact-function grants from the existing service-principal vocabulary.

use super::LocalDatabase;
use super::auth_grants::{ExactGrantScope, canonical_scopes_json};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use rusqlite::{OptionalExtension, params};

pub(crate) const ASSET_CALLBACKS_SERVICE_NAME: &str = "asset-callbacks";
const ASSET_CALLBACKS_CREATED_BY: &str = "startup:asset-callbacks";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AssetCallbacksServicePrincipal {
    pub app_id: String,
    pub actor_user_id: String,
    pub grant_id: String,
    pub scope: ExactGrantScope,
}

impl LocalDatabase {
    /// Resolve or mint the one per-app principal and an immutable grant for
    /// exactly one declared callback mutation. A different callback receives
    /// a sibling grant, so adding callbacks never widens or replaces the
    /// authority (and idempotency identity) of work already in flight.
    pub(crate) fn ensure_asset_callbacks_service_principal(
        &mut self,
        app_id: &str,
        scope: ExactGrantScope,
        now_ms: u64,
    ) -> SnapbackResult<AssetCallbacksServicePrincipal> {
        if app_id.is_empty()
            || scope.function_id.is_empty()
            || !matches!(scope.kind, super::auth_grants::ScopedFunctionKind::Mutation)
            || now_ms > super::SEQUENCE_MAX_SAFE_INTEGER
        {
            return Err(asset_callbacks_state_corrupt());
        }
        let provenance = asset_callbacks_provenance(app_id)?;
        let expected_scopes = canonical_scopes_json(std::slice::from_ref(&scope))?;
        let actor_candidate = crate::ids::mint(crate::ids::Kind::User)?;
        let grant_candidate = crate::ids::mint_time_ordered(crate::ids::Kind::Grant);
        let created_by = asset_callbacks_grant_creator(&scope.function_id);

        self.with_auth_transaction(|tx| {
            let mut actors = Vec::new();
            let mut statement = tx.prepare(
                "SELECT id FROM _auth_users
                 WHERE kind = 'agent' AND display_name = ?1
                   AND registration_provenance = ?2
                 ORDER BY created_at_ms, id",
            )?;
            for row in statement
                .query_map(params![ASSET_CALLBACKS_SERVICE_NAME, provenance], |row| {
                    row.get::<_, String>(0)
                })?
            {
                actors.push(row?);
            }
            drop(statement);
            if actors.len() > 1 {
                return Err(asset_callbacks_state_corrupt());
            }
            let actor_user_id = if let Some(actor) = actors.pop() {
                actor
            } else {
                tx.execute(
                    "INSERT INTO _auth_users(
                       id, created_at_ms, kind, display_name, operator_contact,
                       registration_provenance, deactivated_at_ms, owner_user_id
                     ) VALUES(?1, ?2, 'agent', ?3, NULL, ?4, NULL, NULL)",
                    params![
                        actor_candidate,
                        now_ms as i64,
                        ASSET_CALLBACKS_SERVICE_NAME,
                        provenance,
                    ],
                )?;
                actor_candidate.clone()
            };

            let mut exact_grant = None;
            let mut live_grants = Vec::new();
            let mut statement = tx.prepare(
                "SELECT id, scopes FROM _auth_grants
                 WHERE actor_user_id = ?1 AND effective_user_id IS NULL
                   AND expires_at_ms IS NULL AND revoked_at_ms IS NULL
                   AND created_by = ?2
                 ORDER BY created_at_ms, id",
            )?;
            for row in statement.query_map(params![actor_user_id, created_by], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })? {
                let (grant_id, scopes) = row?;
                if scopes == expected_scopes && exact_grant.is_none() {
                    exact_grant = Some(grant_id.clone());
                }
                live_grants.push((grant_id, scopes));
            }
            drop(statement);

            // A scope-basis shape change terminalizes the old immutable
            // grant. Revoke-and-remint preserves LLP 0055's no-edit rule.
            for (grant_id, scopes) in &live_grants {
                if scopes != &expected_scopes || exact_grant.as_deref() != Some(grant_id) {
                    tx.execute(
                        "UPDATE _auth_grants SET revoked_at_ms = ?1
                         WHERE id = ?2 AND revoked_at_ms IS NULL",
                        params![now_ms as i64, grant_id],
                    )?;
                }
            }

            let grant_id = if let Some(grant_id) = exact_grant {
                tx.execute(
                    "UPDATE _auth_grants SET last_used_at_ms = ?1 WHERE id = ?2",
                    params![now_ms as i64, grant_id],
                )?;
                grant_id
            } else {
                tx.execute(
                    "INSERT INTO _auth_grants(
                       id, actor_user_id, effective_user_id, scopes,
                       created_at_ms, expires_at_ms, revoked_at_ms, created_by,
                       request_id, consent_digest, last_used_at_ms
                     ) VALUES(?1, ?2, NULL, ?3, ?4, NULL, NULL, ?5, NULL, NULL, ?4)",
                    params![
                        grant_candidate,
                        actor_user_id,
                        expected_scopes,
                        now_ms as i64,
                        created_by,
                    ],
                )?;
                grant_candidate.clone()
            };

            Ok(AssetCallbacksServicePrincipal {
                app_id: app_id.to_owned(),
                actor_user_id,
                grant_id,
                scope: scope.clone(),
            })
        })
    }

    /// Commit-time/fresh-execution revalidation for the bearer-free runner.
    /// The exact principal, immutable grant, and current basis must all still
    /// agree; the absence of a token row is intentional, not a fallback.
    pub(crate) fn asset_callbacks_service_principal_is_live(
        &self,
        principal: &AssetCallbacksServicePrincipal,
    ) -> SnapbackResult<bool> {
        let expected_scopes = canonical_scopes_json(std::slice::from_ref(&principal.scope))?;
        let created_by = asset_callbacks_grant_creator(&principal.scope.function_id);
        let provenance = asset_callbacks_provenance(&principal.app_id)?;
        self.with_auth_read(|connection| {
            let live = connection
                .query_row(
                    "SELECT g.scopes
                     FROM _auth_grants AS g
                     JOIN _auth_users AS u ON u.id = g.actor_user_id
                     WHERE g.id = ?1 AND g.actor_user_id = ?2
                       AND g.effective_user_id IS NULL
                       AND g.expires_at_ms IS NULL AND g.revoked_at_ms IS NULL
                       AND g.created_by = ?3
                       AND u.kind = 'agent' AND u.deactivated_at_ms IS NULL
                       AND u.display_name = ?4
                       AND u.registration_provenance = ?5",
                    params![
                        principal.grant_id,
                        principal.actor_user_id,
                        created_by,
                        ASSET_CALLBACKS_SERVICE_NAME,
                        provenance,
                    ],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if live.as_deref() != Some(expected_scopes.as_str()) {
                return Ok(false);
            }
            let current = connection
                .query_row(
                    "SELECT generation, present, authority_creating
                     FROM _auth_scope_bases
                     WHERE function_id = ?1 AND kind = ?2",
                    params![principal.scope.function_id, principal.scope.kind.as_str(),],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    },
                )
                .optional()?;
            Ok(matches!(
                current,
                Some((generation, 1, authority_creating))
                    if generation >= 0
                        && generation as u64 == principal.scope.basis
                        && authority_creating == i64::from(principal.scope.authority_creating)
            ))
        })
    }
}

fn asset_callbacks_provenance(app_id: &str) -> SnapbackResult<String> {
    serde_json::to_string(&serde_json::json!({
        "appId": app_id,
        "createdBy": "snapback",
        "servicePrincipal": ASSET_CALLBACKS_SERVICE_NAME,
        "version": 1,
    }))
    .map_err(|_| asset_callbacks_state_corrupt())
}

fn asset_callbacks_grant_creator(function_id: &str) -> String {
    format!("{ASSET_CALLBACKS_CREATED_BY}:{function_id}")
}

fn asset_callbacks_state_corrupt() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
        "auth",
        "the per-app asset-callbacks service-principal state is unavailable",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{
        FunctionDefinition, FunctionKind, FunctionManifest, FunctionRuntime, HandlerPlan,
        MutationPlan,
    };

    fn callback_scope(function_id: &str, basis: u64) -> ExactGrantScope {
        ExactGrantScope {
            function_id: function_id.to_owned(),
            kind: super::super::auth_grants::ScopedFunctionKind::Mutation,
            basis,
            authority_creating: false,
        }
    }

    fn callback_function(id: &str) -> FunctionDefinition {
        let mut function = FunctionDefinition::new(
            id.trim_start_matches("fn:"),
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Mutation(MutationPlan {
            owner_write_checks: Vec::new(),
                steps: Vec::new(),
                return_value: None,
            })),
        );
        function.id = id.to_owned();
        function
    }

    #[test]
    fn principal_is_per_app_and_grants_only_the_named_callback() {
        let mut database = LocalDatabase::memory().expect("memory database");
        database
            .activate_current_auth_catalog()
            .expect("auth catalog");
        database
            .reconcile_auth_scope_bases(&FunctionManifest {
                functions: vec![
                    callback_function("fn:onReady"),
                    callback_function("fn:other"),
                ],
                ..FunctionManifest::default()
            })
            .expect("scope bases");

        let ready = database
            .ensure_asset_callbacks_service_principal("app-a", callback_scope("fn:onReady", 0), 100)
            .expect("mint app-a callback authority");
        let ready_again = database
            .ensure_asset_callbacks_service_principal("app-a", callback_scope("fn:onReady", 0), 101)
            .expect("reuse app-a callback authority");
        assert_eq!(
            ready, ready_again,
            "principal and immutable grant are stable"
        );
        assert!(
            database
                .asset_callbacks_service_principal_is_live(&ready)
                .unwrap()
        );

        let other = database
            .ensure_asset_callbacks_service_principal("app-a", callback_scope("fn:other", 0), 102)
            .expect("mint sibling exact grant");
        assert_eq!(ready.actor_user_id, other.actor_user_id);
        assert_ne!(ready.grant_id, other.grant_id);

        let app_b = database
            .ensure_asset_callbacks_service_principal("app-b", callback_scope("fn:onReady", 0), 103)
            .expect("mint app-b callback authority");
        assert_ne!(ready.actor_user_id, app_b.actor_user_id);
        assert_ne!(ready.grant_id, app_b.grant_id);

        let encoded: String = database
            .conn
            .query_row(
                "SELECT scopes FROM _auth_grants WHERE id = ?1",
                params![ready.grant_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Vec<ExactGrantScope>>(&encoded).unwrap(),
            vec![callback_scope("fn:onReady", 0)],
            "the grant contains only the callback mutation's exact basis",
        );
        for table in [
            "_auth_agent_credentials",
            "_auth_grant_tokens",
            "_auth_sessions",
        ] {
            let count: u64 = database
                .conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(
                count, 0,
                "the bearer-free callback service mints no {table}"
            );
        }
    }
}
