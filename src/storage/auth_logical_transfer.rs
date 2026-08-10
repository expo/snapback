//! Protected-catalog logical auth export and import.

use super::auth::AuthCatalogState;
use super::{LocalDatabase, current_version_on};
use crate::auth::logical_transfer::{
    AuthLogicalExportV1, AuthLogicalIdentityV1, AuthLogicalImportOutcomeV1,
    AuthLogicalPrincipalKindV1, AuthLogicalScopeBaseV1, AuthLogicalUserV1, logical_export_invalid,
    logical_identity_collision, logical_import_invalid, logical_target_not_empty,
};
use crate::diagnostic::SnapbackResult;
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde_json::Value;

const AUTH_LOGICAL_TABLES: &[&str] = &[
    "_auth_users",
    "_auth_identities",
    "_auth_sessions",
    "_auth_session_tokens",
    "_auth_verification_codes",
    "_auth_agent_credentials",
    "_auth_grants",
    "_auth_grant_tokens",
    "_auth_agent_invitations",
    "_auth_pairing_requests",
    "_auth_scope_bases",
];

impl LocalDatabase {
    /// Read the exact included rows from one SQLite snapshot. The artifact's
    /// closed type has no field for any excluded authority class.
    pub(crate) fn auth_logical_export(&self) -> SnapbackResult<AuthLogicalExportV1> {
        if self.inspect_auth_catalog()? != AuthCatalogState::ReadyV2 {
            return Err(logical_export_invalid(
                "logical auth export requires an exact current catalog version 2",
            ));
        }
        super::with_pinned_read_snapshot(&self.conn, |conn| {
            let users = {
                let mut statement = conn.prepare(
                    "SELECT id, created_at_ms, kind, display_name, operator_contact,
                            registration_provenance, deactivated_at_ms, owner_user_id
                     FROM _auth_users ORDER BY id",
                )?;
                statement
                    .query_map([], |row| {
                        let kind = match row.get::<_, String>(2)?.as_str() {
                            "human" => AuthLogicalPrincipalKindV1::Human,
                            "agent" => AuthLogicalPrincipalKindV1::Agent,
                            _ => return Err(rusqlite::Error::InvalidQuery),
                        };
                        let provenance = row
                            .get::<_, Option<String>>(5)?
                            .map(|raw| {
                                serde_json::from_str::<Value>(&raw)
                                    .map_err(|_| rusqlite::Error::InvalidQuery)
                            })
                            .transpose()?;
                        Ok(AuthLogicalUserV1 {
                            id: row.get(0)?,
                            created_at_ms: row.get(1)?,
                            kind,
                            display_name: row.get(3)?,
                            operator_contact: row.get(4)?,
                            registration_provenance: provenance,
                            deactivated_at_ms: row.get(6)?,
                            owner_user_id: row.get(7)?,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?
            };
            let identities = {
                let mut statement = conn.prepare(
                    "SELECT id, user_id, provider, subject, verified_at_ms
                     FROM _auth_identities ORDER BY id",
                )?;
                statement
                    .query_map([], |row| {
                        Ok(AuthLogicalIdentityV1 {
                            id: row.get(0)?,
                            user_id: row.get(1)?,
                            provider: row.get(2)?,
                            subject: row.get(3)?,
                            verified_at_ms: row.get(4)?,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?
            };
            let scope_bases = {
                let mut statement = conn.prepare(
                    "SELECT function_id, kind, generation, present, authority_creating
                     FROM _auth_scope_bases ORDER BY function_id",
                )?;
                statement
                    .query_map([], |row| {
                        let present = row.get::<_, i64>(3)?;
                        let authority_creating = row.get::<_, i64>(4)?;
                        if !matches!(present, 0 | 1) || !matches!(authority_creating, 0 | 1) {
                            return Err(rusqlite::Error::InvalidQuery);
                        }
                        Ok(AuthLogicalScopeBaseV1 {
                            function_id: row.get(0)?,
                            kind: row.get(1)?,
                            generation: row.get(2)?,
                            present: present == 1,
                            authority_creating: authority_creating == 1,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?
            };
            AuthLogicalExportV1::new(users, identities, scope_bases)
        })
        .map_err(|_| {
            logical_export_invalid(
                "logical auth export could not validate the included catalog rows",
            )
        })
    }

    /// Import only into a current, empty auth catalog and rotate the durable
    /// authorization incarnation in the same transaction as every inserted
    /// identity fact. No source bearer/key material enters this method.
    pub(crate) fn auth_logical_import(
        &mut self,
        artifact: &AuthLogicalExportV1,
    ) -> SnapbackResult<AuthLogicalImportOutcomeV1> {
        artifact.validate()?;
        let authorization_interlock = self.authorization_interlock.clone();
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if super::auth::inspect_auth_catalog_on(&tx)? != AuthCatalogState::ReadyV2 {
            return Err(logical_import_invalid(
                "logical auth import requires an exact current catalog version 2",
            ));
        }
        require_empty_auth_target(&tx)?;

        for user in &artifact.users {
            tx.execute(
                "INSERT INTO _auth_users(
                   id, created_at_ms, kind, display_name, operator_contact,
                   registration_provenance, deactivated_at_ms, owner_user_id
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)",
                params![
                    user.id,
                    user.created_at_ms,
                    match user.kind {
                        AuthLogicalPrincipalKindV1::Human => "human",
                        AuthLogicalPrincipalKindV1::Agent => "agent",
                    },
                    user.display_name,
                    user.operator_contact,
                    user.registration_provenance
                        .as_ref()
                        .map(serde_json::to_string)
                        .transpose()
                        .map_err(|_| logical_import_invalid(
                            "registration provenance is invalid"
                        ))?,
                    user.deactivated_at_ms,
                ],
            )?;
        }
        for user in &artifact.users {
            if let Some(owner) = user.owner_user_id.as_deref() {
                let changed = tx.execute(
                    "UPDATE _auth_users SET owner_user_id = ?1 WHERE id = ?2 AND kind = 'agent'",
                    params![owner, user.id],
                )?;
                if changed != 1 {
                    return Err(logical_import_invalid(
                        "logical auth import could not restore agent ownership",
                    ));
                }
            }
        }
        for identity in &artifact.identities {
            let inserted = tx.execute(
                "INSERT INTO _auth_identities(id, user_id, provider, subject, verified_at_ms)
                 VALUES(?1, ?2, ?3, ?4, ?5)",
                params![
                    identity.id,
                    identity.user_id,
                    identity.provider,
                    identity.subject,
                    identity.verified_at_ms,
                ],
            );
            if let Err(error) = inserted {
                if matches!(
                    error.sqlite_error_code(),
                    Some(rusqlite::ErrorCode::ConstraintViolation)
                ) {
                    return Err(logical_identity_collision());
                }
                return Err(error.into());
            }
        }
        for scope in &artifact.scope_bases {
            tx.execute(
                "INSERT INTO _auth_scope_bases(
                   function_id, kind, generation, present, authority_creating
                 ) VALUES(?1, ?2, ?3, ?4, ?5)",
                params![
                    scope.function_id,
                    scope.kind,
                    scope.generation,
                    i64::from(scope.present),
                    i64::from(scope.authority_creating),
                ],
            )?;
        }

        let authorization_predecessor = super::auth_stream::read_authorization_version_on(&tx)?;
        let authorization = super::authorization::authorization_commit_hook_in(
            &tx,
            super::authorization::AuthorizationCommitCause::DestructiveBoundary,
        )?;
        super::auth_invalidation::clear_retry_episodes_in(&tx)?;
        super::authorized_lease::clear_authorized_lease_reservations_in(&tx)?;
        super::auth_invalidation::rotate_data_version_stream_in(&tx)?;
        let min_commit_version = current_version_on(&tx)?;
        super::commit_with_authorization_interlock(
            tx,
            &authorization,
            super::AuthorizationCommitImpact::AllProtectedRooms,
            authorization_predecessor,
            min_commit_version,
            authorization_interlock,
        )?;
        Ok(AuthLogicalImportOutcomeV1::from_artifact(
            artifact,
            authorization.version.incarnation,
        ))
    }
}

fn require_empty_auth_target(conn: &rusqlite::Connection) -> SnapbackResult<()> {
    for table in AUTH_LOGICAL_TABLES {
        let sql = format!("SELECT EXISTS(SELECT 1 FROM \"{table}\" LIMIT 1)");
        if conn.query_row(&sql, [], |row| row.get::<_, bool>(0))? {
            return Err(logical_target_not_empty());
        }
    }

    let companion_tables = conn
        .prepare(
            "SELECT name FROM sqlite_schema
             WHERE type = 'table'
               AND (name GLOB '_snapback_auth_*'
                    OR name IN ('_snapback_integration_records',
                                '_snapback_oauth_authorizations',
                                '_snapback_sender_proof_replay',
                                '_snapback_sender_nonce',
                                '_snapback_sender_replay_epoch',
                                '_snapback_sender_family_binding'))
             ORDER BY name",
        )?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for table in companion_tables {
        let quoted = table.replace('"', "\"\"");
        let sql = format!("SELECT EXISTS(SELECT 1 FROM \"{quoted}\" LIMIT 1)");
        if conn.query_row(&sql, [], |row| row.get::<_, bool>(0))? {
            return Err(logical_target_not_empty());
        }
    }

    let terminal_cause_present = conn
        .query_row(
            "SELECT 1 FROM _snapback_meta WHERE key GLOB 'auth_session_terminal_cause_v1:*' LIMIT 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_some();
    if terminal_cause_present {
        return Err(logical_target_not_empty());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::logical_transfer::AUTH_LOGICAL_EXPORT_FORMAT_VERSION;
    use crate::storage::auth_agents::AgentRegistration;
    use rusqlite::params;
    use serde_json::json;

    fn ready_database() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.activate_current_auth_catalog()
            .expect("activate auth catalog");
        db
    }

    fn seed_source() -> LocalDatabase {
        let mut db = ready_database();
        db.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES('human-1', 10)",
                [],
            )?;
            tx.execute(
                "INSERT INTO _auth_identities(id, user_id, provider, subject, verified_at_ms)
                 VALUES('identity-human', 'human-1', 'email-code', 'owner@example.com', 11)",
                [],
            )?;
            Ok(())
        })
        .unwrap();
        db.create_agent_principal(
            "agent-owned",
            12,
            &AgentRegistration {
                display_name: Some("Owned agent".to_owned()),
                operator_contact: Some("operator@example.com".to_owned()),
                registration_provenance: json!({
                    "class": "agent",
                    "source": "user-invitation",
                    "createdAtMs": 12,
                })
                .to_string(),
                owner_user_id: Some("human-1".to_owned()),
            },
        )
        .unwrap();
        db.create_agent_principal(
            "agent-unowned",
            13,
            &AgentRegistration {
                display_name: Some("Unowned agent".to_owned()),
                operator_contact: None,
                registration_provenance: json!({
                    "class": "agent",
                    "source": "self-register",
                    "createdAtMs": 13,
                })
                .to_string(),
                owner_user_id: None,
            },
        )
        .unwrap();
        db.with_auth_transaction(|tx| {
            tx.execute(
                "UPDATE _auth_users SET deactivated_at_ms = 20 WHERE id = 'agent-unowned'",
                [],
            )?;
            tx.execute(
                "INSERT INTO _auth_identities(id, user_id, provider, subject, verified_at_ms)
                 VALUES('identity-agent', 'agent-owned', 'agent-credential', 'dead-credential-id', 12)",
                [],
            )?;
            tx.execute(
                "INSERT INTO _auth_scope_bases(function_id, kind, generation, present, authority_creating)
                 VALUES('fn:write', 'mutation', 7, 1, 1)",
                [],
            )?;
            // Planted authority and secrets must have no representable export slot.
            tx.execute(
                "INSERT INTO _auth_sessions(
                   id, user_id, identity_id, authority_instance_id, token_hash,
                   generation, created_at_ms, last_used_at_ms, expires_at_ms,
                   absolute_expires_at_ms, revoked_at_ms
                 ) VALUES('session-secret-marker', 'human-1', 'identity-human',
                          'authority-secret-marker', ?1, 1, 11, 11, 90, 100, NULL)",
                params![vec![0x11_u8; 32]],
            )?;
            tx.execute(
                "INSERT INTO _auth_session_tokens(token_hash, session_id, superseded_at_ms)
                 VALUES(?1, 'session-secret-marker', 12)",
                params![vec![0x12_u8; 32]],
            )?;
            tx.execute(
                "INSERT INTO _auth_verification_codes(
                   challenge_id, canonical_address, code_digest, key_id, attempts,
                   max_attempts, requested_at_ms, expires_at_ms, consumed_at_ms,
                   superseded_by
                 ) VALUES('challenge-secret-marker', 'owner@example.com', ?1,
                          'key-secret-marker', 0, 5, 10, 100, NULL, NULL)",
                params![vec![0x13_u8; 32]],
            )?;
            tx.execute(
                "INSERT INTO _auth_agent_credentials(
                   id, user_id, secret_hash, generation, created_at_ms, rotated_at_ms,
                   last_used_at_ms, revoked_at_ms
                 ) VALUES('credential-secret-marker', 'agent-owned', ?1, 1, 12, 12, 12, NULL)",
                params![vec![0xA5_u8; 32]],
            )?;
            tx.execute(
                "INSERT INTO _auth_grants(
                   id, actor_user_id, effective_user_id, scopes, created_at_ms,
                   expires_at_ms, revoked_at_ms, created_by, request_id,
                   consent_digest, last_used_at_ms
                 ) VALUES('grant-secret-marker', 'agent-owned', NULL, '[]', 12,
                          NULL, NULL, 'planted-secret', NULL, NULL, 12)",
                [],
            )?;
            tx.execute(
                "INSERT INTO _auth_grant_tokens(
                   id, token_hash, grant_id, credential_id, credential_generation,
                   created_at_ms, expires_at_ms, revoked_at_ms
                 ) VALUES('token-secret-marker', ?1, 'grant-secret-marker',
                          'credential-secret-marker', 1, 12, 100, NULL)",
                params![vec![0x5A_u8; 32]],
            )?;
            tx.execute(
                "INSERT INTO _auth_agent_invitations(
                   id, token_hash, class, created_by, minted_profile, agent_user_id,
                   created_at_ms, expires_at_ms, revoked_at_ms, consumed_at_ms,
                   consumed_by
                 ) VALUES('invitation-secret-marker', ?1, 'recovery', 'human-1',
                          'prod', 'agent-owned', 12, 100, NULL, NULL, NULL)",
                params![vec![0x14_u8; 32]],
            )?;
            tx.execute(
                "INSERT INTO _auth_pairing_requests(
                   id, code_hash, minted_by_user_id, agent_user_id, requested_scopes,
                   state, attempts, created_at_ms, expires_at_ms, consumed_at_ms,
                   grant_id
                 ) VALUES('pairing-secret-marker', ?1, 'human-1', 'agent-owned',
                          'pairing-pending-secret', 'pending', 0, 12, 100, NULL, NULL)",
                params![vec![0x15_u8; 32]],
            )?;
            Ok(())
        })
        .unwrap();
        db
    }

    #[test]
    fn logical_round_trip_preserves_identity_facts_and_resurrects_no_authority() {
        let source = seed_source();
        let source_version = source.authorization_version().unwrap();
        let artifact = source.auth_logical_export().unwrap();
        let bytes = artifact.to_pretty_bytes().unwrap();
        for planted in [
            b"credential-secret-marker".as_slice(),
            b"grant-secret-marker".as_slice(),
            b"token-secret-marker".as_slice(),
            b"planted-secret".as_slice(),
            b"session-secret-marker".as_slice(),
            b"authority-secret-marker".as_slice(),
            b"challenge-secret-marker".as_slice(),
            b"key-secret-marker".as_slice(),
            b"invitation-secret-marker".as_slice(),
            b"pairing-secret-marker".as_slice(),
            b"pairing-pending-secret".as_slice(),
        ] {
            assert!(!bytes.windows(planted.len()).any(|window| window == planted));
        }

        let parsed = AuthLogicalExportV1::parse(&bytes).unwrap();
        let mut target = ready_database();
        let target_before = target.authorization_version().unwrap();
        let outcome = target.auth_logical_import(&parsed).unwrap();
        assert_ne!(outcome.authorization_incarnation, target_before.incarnation);
        assert_ne!(
            outcome.authorization_incarnation,
            source_version.incarnation
        );
        assert_eq!(outcome.owned_agents, 1);
        assert_eq!(outcome.unowned_agents, 1);
        assert_eq!(outcome.deactivated_agents, 1);
        assert_eq!(target.auth_logical_export().unwrap(), artifact);

        for table in [
            "_auth_sessions",
            "_auth_session_tokens",
            "_auth_verification_codes",
            "_auth_agent_credentials",
            "_auth_grants",
            "_auth_grant_tokens",
            "_auth_agent_invitations",
            "_auth_pairing_requests",
        ] {
            let count: i64 = target
                .conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "{table} resurrected authority");
        }
        let owned: (Option<String>, Option<i64>) = target
            .conn
            .query_row(
                "SELECT owner_user_id, deactivated_at_ms FROM _auth_users WHERE id='agent-owned'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(owned, (Some("human-1".to_owned()), None));
        let unowned: (Option<String>, Option<i64>) = target
            .conn
            .query_row(
                "SELECT owner_user_id, deactivated_at_ms FROM _auth_users WHERE id='agent-unowned'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(unowned, (None, Some(20)));
    }

    #[test]
    fn logical_import_rejects_old_corrupt_colliding_and_nonempty_inputs_atomically() {
        let artifact = seed_source().auth_logical_export().unwrap();

        let mut old = serde_json::to_value(&artifact).unwrap();
        old["formatVersion"] = json!(u64::from(AUTH_LOGICAL_EXPORT_FORMAT_VERSION) - 1);
        let old_error = AuthLogicalExportV1::parse(&serde_json::to_vec(&old).unwrap()).unwrap_err();
        assert_eq!(
            old_error.diagnostic.code,
            "SNAPBACK_AUTH_LOGICAL_IMPORT_FORMAT_UNSUPPORTED"
        );

        let mut wrong_catalog = serde_json::to_value(&artifact).unwrap();
        wrong_catalog["authCatalogVersion"] = json!(1);
        assert_eq!(
            AuthLogicalExportV1::parse(&serde_json::to_vec(&wrong_catalog).unwrap())
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_LOGICAL_IMPORT_INVALID"
        );

        let mut corrupt = artifact.clone();
        corrupt.identities.push(corrupt.identities[0].clone());
        assert_eq!(
            corrupt.validate().unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_LOGICAL_IMPORT_INVALID"
        );

        let mut missing_field = serde_json::to_value(&artifact).unwrap();
        missing_field["users"][0]
            .as_object_mut()
            .unwrap()
            .remove("ownerUserId");
        assert_eq!(
            AuthLogicalExportV1::parse(&serde_json::to_vec(&missing_field).unwrap())
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_LOGICAL_IMPORT_INVALID"
        );

        let mut collision = artifact.clone();
        let mut duplicate_subject = collision.identities[0].clone();
        duplicate_subject.id = "zz-duplicate-identity".to_owned();
        collision.identities.push(duplicate_subject);
        collision
            .identities
            .sort_by(|left, right| left.id.cmp(&right.id));
        assert_eq!(
            collision.validate().unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_LOGICAL_IMPORT_IDENTITY_COLLISION"
        );

        let mut target = ready_database();
        target
            .with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT INTO _auth_users(id, created_at_ms) VALUES('existing', 0)",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        let before = target.authorization_version().unwrap();
        assert_eq!(
            target
                .auth_logical_import(&artifact)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_LOGICAL_IMPORT_TARGET_NOT_EMPTY"
        );
        assert_eq!(target.authorization_version().unwrap(), before);
        assert_eq!(
            target
                .conn
                .query_row("SELECT COUNT(*) FROM _auth_users", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
}
