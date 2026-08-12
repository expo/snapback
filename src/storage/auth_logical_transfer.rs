//! Protected-catalog logical auth export and import.

use super::auth::{AuthCatalogState, PasswordIdentifierMode};
use super::{LocalDatabase, current_version_on};
use crate::auth::logical_transfer::{
    AUTH_LOGICAL_EXPORT_CATALOG_VERSION_V2, AUTH_LOGICAL_EXPORT_CATALOG_VERSION_V3,
    AUTH_LOGICAL_EXPORT_CATALOG_VERSION_V4, AuthLogicalExportV1, AuthLogicalIdentityV1,
    AuthLogicalImportOutcomeV1, AuthLogicalPrincipalKindV1, AuthLogicalScopeBaseV1,
    AuthLogicalUserV1, logical_export_invalid, logical_identity_collision, logical_import_invalid,
    logical_target_not_empty,
};
use crate::diagnostic::SnapbackResult;
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde_json::Value;

const AUTH_LOGICAL_TABLES_V2: &[&str] = &[
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
];

const AUTH_LOGICAL_TABLES_V3_EXTRA: &[&str] = &[
    "_auth_credentials",
    "_auth_password_credentials",
    "_auth_passkey_credentials",
    "_auth_recovery_code_sets",
    "_auth_recovery_codes",
    "_auth_assurances",
    "_auth_provisioning_receipts",
    "_auth_security_events",
];

/// Catalog-v4 lockout state is checked when proving an import target empty,
/// but intentionally has no logical-export slot. It is internal anti-abuse
/// history, not a principal, ownership, or identity fact, and exporting it
/// would unnecessarily place canonical identifiers in the artifact.
const AUTH_LOGICAL_TABLES_V4_INTERNAL_STATE: &[&str] = &["_auth_password_attempts"];

impl LocalDatabase {
    /// Read the exact included rows from one SQLite snapshot. The artifact's
    /// closed type has no field for any excluded authority class.
    pub(crate) fn auth_logical_export(&self) -> SnapbackResult<AuthLogicalExportV1> {
        let catalog = self.inspect_auth_catalog()?;
        let catalog_version = match catalog {
            AuthCatalogState::ReadyV2 => AUTH_LOGICAL_EXPORT_CATALOG_VERSION_V2,
            AuthCatalogState::ReadyV3 => AUTH_LOGICAL_EXPORT_CATALOG_VERSION_V3,
            AuthCatalogState::ReadyV4 => AUTH_LOGICAL_EXPORT_CATALOG_VERSION_V4,
            _ => {
                return Err(logical_export_invalid(
                    "logical auth export requires an exact catalog version 2, 3, or 4",
                ));
            }
        };
        let password_identifier_mode = (catalog == AuthCatalogState::ReadyV4)
            .then(|| self.auth_password_identifier_mode())
            .transpose()?;
        let identity_password_identifier_mode =
            password_identifier_mode.unwrap_or(PasswordIdentifierMode::UsernameV1);
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
                if matches!(
                    catalog_version,
                    AUTH_LOGICAL_EXPORT_CATALOG_VERSION_V3 | AUTH_LOGICAL_EXPORT_CATALOG_VERSION_V4
                ) {
                    let mut statement = conn.prepare(
                        "SELECT id, user_id, kind, provider, issuer, subject,
                                canonical_value, verified_at_ms, disabled_at_ms
                         FROM _auth_identities ORDER BY id",
                    )?;
                    statement
                        .query_map([], |row| {
                            let kind = row.get::<_, String>(2)?;
                            let provider = row.get::<_, String>(3)?;
                            let issuer = row.get::<_, Option<String>>(4)?;
                            let subject = row.get::<_, String>(5)?;
                            let canonical_value = row.get::<_, Option<String>>(6)?;
                            let disabled_at_ms = row.get::<_, Option<u64>>(8)?;
                            let Some((expected_kind, expected_canonical)) =
                                format_one_identity_descriptor(
                                    &provider,
                                    &subject,
                                    identity_password_identifier_mode,
                                )
                            else {
                                return Err(rusqlite::Error::InvalidQuery);
                            };
                            if kind != expected_kind
                                || issuer.is_some()
                                || canonical_value.as_deref() != expected_canonical
                                || disabled_at_ms.is_some()
                            {
                                return Err(rusqlite::Error::InvalidQuery);
                            }
                            Ok(AuthLogicalIdentityV1 {
                                id: row.get(0)?,
                                user_id: row.get(1)?,
                                provider,
                                subject,
                                verified_at_ms: row.get(7)?,
                            })
                        })?
                        .collect::<Result<Vec<_>, _>>()?
                } else {
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
                }
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
            AuthLogicalExportV1::new(
                catalog_version,
                password_identifier_mode.map(|mode| mode.as_str().to_owned()),
                users,
                identities,
                scope_bases,
            )
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
        let target_catalog = super::auth::inspect_auth_catalog_on(&tx)?;
        if !matches!(
            target_catalog,
            AuthCatalogState::ReadyV2 | AuthCatalogState::ReadyV3 | AuthCatalogState::ReadyV4
        ) {
            return Err(logical_import_invalid(
                "logical auth import requires an exact catalog version 2, 3, or 4",
            ));
        }
        require_empty_auth_target(&tx, target_catalog, &artifact.scope_bases)?;

        let target_password_identifier_mode = match target_catalog {
            AuthCatalogState::ReadyV4 => super::auth::require_password_identifier_mode_on(&tx)?,
            _ => PasswordIdentifierMode::UsernameV1,
        };
        if target_catalog == AuthCatalogState::ReadyV4
            && artifact.password_identifier_mode.as_deref()
                != Some(target_password_identifier_mode.as_str())
        {
            return Err(logical_import_invalid(
                "logical auth import password identifier mode differs from the target",
            ));
        }

        if matches!(
            target_catalog,
            AuthCatalogState::ReadyV3 | AuthCatalogState::ReadyV4
        ) && artifact.identities.iter().any(|identity| {
            format_one_identity_descriptor(
                &identity.provider,
                &identity.subject,
                target_password_identifier_mode,
            )
            .is_none()
        }) {
            return Err(logical_import_invalid(
                "logical auth import contains an identity descriptor that format 1 cannot map to catalog version 3",
            ));
        }

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
            let inserted = if matches!(
                target_catalog,
                AuthCatalogState::ReadyV3 | AuthCatalogState::ReadyV4
            ) {
                // Format 1 predates v3's explicit identity kind and canonical
                // value. Preserve the two built-in provider semantics; other
                // provider subjects remain external identity links.
                //
                // @ref LLP 0214#35-identity-link-relation — v3 imports write
                // the complete non-null identity descriptor without treating
                // provider subjects as credentials.
                let (kind, canonical_value) =
                    format_one_identity_descriptor(
                        &identity.provider,
                        &identity.subject,
                        target_password_identifier_mode,
                    )
                        .ok_or_else(|| {
                            logical_import_invalid(
                                "logical auth import contains an identity descriptor that format 1 cannot map to catalog version 3",
                            )
                        })?;
                tx.execute(
                    "INSERT INTO _auth_identities(
                       id, user_id, kind, provider, issuer, subject,
                       canonical_value, created_at_ms, verified_at_ms,
                       disabled_at_ms
                     ) VALUES(?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?7, NULL)",
                    params![
                        identity.id,
                        identity.user_id,
                        kind,
                        identity.provider,
                        identity.subject,
                        canonical_value,
                        identity.verified_at_ms,
                    ],
                )
            } else {
                tx.execute(
                    "INSERT INTO _auth_identities(
                       id, user_id, provider, subject, verified_at_ms
                     ) VALUES(?1, ?2, ?3, ?4, ?5)",
                    params![
                        identity.id,
                        identity.user_id,
                        identity.provider,
                        identity.subject,
                        identity.verified_at_ms,
                    ],
                )
            };
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
                 ) VALUES(?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(function_id) DO NOTHING",
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

/// Format 1 predates catalog-v3 identity descriptors. These are the only
/// provider spellings whose v3 kind/canonical fields are fully implied by the
/// format-1 row; all others must fail closed instead of being guessed.
fn format_one_identity_descriptor<'a>(
    provider: &str,
    subject: &'a str,
    password_identifier_mode: PasswordIdentifierMode,
) -> Option<(&'static str, Option<&'a str>)> {
    match provider {
        "email-code" => crate::auth::crypto::CanonicalAddress::parse(subject)
            .ok()
            .filter(|canonical| canonical.as_str() == subject)
            .map(|_| ("email", Some(subject))),
        "local-password" => super::auth_identity::canonical_password_identifier_value(
            password_identifier_mode,
            subject,
        )
        .ok()
        .filter(|canonical| canonical == subject)
        .map(|_| (password_identifier_mode.identity_kind(), Some(subject))),
        "agent-credential" => Some(("external", None)),
        _ => None,
    }
}

fn require_empty_auth_target(
    conn: &rusqlite::Connection,
    catalog: AuthCatalogState,
    incoming_scope_bases: &[AuthLogicalScopeBaseV1],
) -> SnapbackResult<()> {
    for table in AUTH_LOGICAL_TABLES_V2
        .iter()
        .copied()
        .chain(
            matches!(
                catalog,
                AuthCatalogState::ReadyV3 | AuthCatalogState::ReadyV4
            )
            .then_some(AUTH_LOGICAL_TABLES_V3_EXTRA)
            .into_iter()
            .flatten()
            .copied(),
        )
        .chain(
            (catalog == AuthCatalogState::ReadyV4)
                .then_some(AUTH_LOGICAL_TABLES_V4_INTERNAL_STATE)
                .into_iter()
                .flatten()
                .copied(),
        )
    {
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

    // Normal sessions-mode activation seeds the current app's scope bases
    // before an operator can stop the fresh target and run this offline
    // import. Those rows are schema authority, not spendable caller
    // authority. Admit them only when every target row is an exact member of
    // the artifact; the later conflict-free inserts then retain the matching
    // rows while importing any source tombstones the fresh target lacks.
    let target_scope_bases = conn
        .prepare(
            "SELECT function_id, kind, generation, present, authority_creating
             FROM _auth_scope_bases ORDER BY function_id",
        )?
        .query_map([], |row| {
            Ok(AuthLogicalScopeBaseV1 {
                function_id: row.get(0)?,
                kind: row.get(1)?,
                generation: row.get(2)?,
                present: row.get(3)?,
                authority_creating: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if target_scope_bases.iter().any(|target| {
        !incoming_scope_bases
            .iter()
            .any(|incoming| incoming == target)
    }) {
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

    fn ready_database_with_mode(mode: PasswordIdentifierMode) -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.activate_current_auth_catalog_with_password_identifier_mode(mode)
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
            crate::storage::insert_test_email_identity(
                tx,
                "identity-human",
                "human-1",
                "owner@example.com",
                11,
                false,
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
            crate::storage::insert_test_external_identity(
                tx,
                "identity-agent",
                "agent-owned",
                "agent-credential",
                "dead-credential-id",
                12,
            )?;
            tx.execute(
                "INSERT INTO _auth_scope_bases(function_id, kind, generation, present, authority_creating)
                 VALUES('fn:write', 'mutation', 7, 1, 1)",
                [],
            )?;
            // Planted authority and secrets must have no representable export slot.
            crate::storage::insert_test_identity_session(
                tx,
                "session-secret-marker",
                "human-1",
                "identity-human",
                "authority-secret-marker",
                &[0x11_u8; 32],
                11,
                11,
                90,
                100,
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
                "INSERT INTO _auth_password_attempts(
                   address, window_start_ms, failed_count, locked_until_ms
                 ) VALUES('ledger-address@example.com', 10, 3, 100)",
                [],
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
        assert_eq!(
            artifact.auth_catalog_version,
            AUTH_LOGICAL_EXPORT_CATALOG_VERSION_V4
        );
        assert_eq!(
            artifact.password_identifier_mode.as_deref(),
            Some("username-v1")
        );
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
            b"ledger-address@example.com".as_slice(),
        ] {
            assert!(!bytes.windows(planted.len()).any(|window| window == planted));
        }

        let parsed = AuthLogicalExportV1::parse(&bytes).unwrap();
        let mut mismatched_target = ready_database();
        mismatched_target
            .with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT INTO _auth_scope_bases(
                       function_id, kind, generation, present, authority_creating
                     ) VALUES('fn:write', 'mutation', 6, 1, 1)",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        assert_eq!(
            mismatched_target
                .auth_logical_import(&parsed)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_LOGICAL_IMPORT_TARGET_NOT_EMPTY",
            "activation scope bases are admissible only as exact incoming schema facts",
        );
        let mut target = ready_database();
        target
            .with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT INTO _auth_scope_bases(
                       function_id, kind, generation, present, authority_creating
                     ) VALUES('fn:write', 'mutation', 7, 1, 1)",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
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
            "_auth_password_attempts",
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
    fn logical_v4_transfer_preserves_and_requires_the_identifier_mode() {
        let random = crate::auth::crypto::OsRandom;
        let key = [23; 32];
        let mut source = ready_database_with_mode(PasswordIdentifierMode::EmailV1);
        let registered = source
            .identity_password_register(
                "OWNER@Example.COM",
                &crate::auth::identity_core::PasswordSecret::new(
                    "strong-logical-email-password-1".to_owned(),
                ),
                10,
                &random,
                "key-1",
                &key,
            )
            .unwrap();
        let artifact = source.auth_logical_export().unwrap();
        assert_eq!(
            artifact.password_identifier_mode.as_deref(),
            Some("email-v1")
        );

        let mut matching = ready_database_with_mode(PasswordIdentifierMode::EmailV1);
        matching.auth_logical_import(&artifact).unwrap();
        let descriptor: (String, String, String) = matching
            .conn
            .query_row(
                "SELECT kind,provider,subject FROM _auth_identities WHERE user_id=?1",
                [&registered.user_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            descriptor,
            (
                "email".to_owned(),
                "local-password".to_owned(),
                "owner@example.com".to_owned()
            )
        );

        let mut mismatched = ready_database_with_mode(PasswordIdentifierMode::UsernameV1);
        assert_eq!(
            mismatched
                .auth_logical_import(&artifact)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_LOGICAL_IMPORT_INVALID"
        );
        assert_eq!(
            mismatched
                .conn
                .query_row("SELECT COUNT(*) FROM _auth_users", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn logical_v3_transfer_refuses_identity_descriptors_format_one_cannot_preserve() {
        let source = seed_source();
        source
            .conn
            .execute(
                "UPDATE _auth_identities SET disabled_at_ms = 12
                 WHERE id = 'identity-human'",
                [],
            )
            .unwrap();
        assert_eq!(
            source.auth_logical_export().unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_LOGICAL_EXPORT_INVALID"
        );

        source
            .conn
            .execute(
                "UPDATE _auth_identities
                 SET kind = 'external', provider = 'future-provider',
                     canonical_value = NULL, disabled_at_ms = NULL
                 WHERE id = 'identity-human'",
                [],
            )
            .unwrap();
        assert_eq!(
            source.auth_logical_export().unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_LOGICAL_EXPORT_INVALID"
        );

        let mut artifact = seed_source().auth_logical_export().unwrap();
        let identity = artifact
            .identities
            .iter_mut()
            .find(|identity| identity.id == "identity-human")
            .unwrap();
        identity.provider = "future-provider".to_owned();
        let mut target = ready_database();
        assert_eq!(
            target
                .auth_logical_import(&artifact)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_LOGICAL_IMPORT_INVALID"
        );
        assert_eq!(
            target
                .conn
                .query_row("SELECT COUNT(*) FROM _auth_users", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap(),
            0
        );
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
