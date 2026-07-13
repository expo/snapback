//! Durable authorization-stream metadata and detached projection snapshots.
//!
//! The migration is explicit rather than part of `LocalDatabase::open`: LLP
//! 0055's stage-time collision inspection must remain read-only. Auth-capable
//! startup calls the migration before bind, then sessions startup obtains one
//! complete read transaction through `session_projection_source`.

use super::LocalDatabase;
use super::auth::{AuthCatalogState, inspect_auth_catalog_on};
use crate::auth::session_projection::{
    AUTHORIZATION_STREAM_META_KEY, AuthorizationStreamIncarnation, AuthorizationStreamRecord,
    ProjectionIdentityRow, ProjectionSessionRow, ProjectionSource, ProjectionTokenRow,
    ProjectionUserRow,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};

impl LocalDatabase {
    /// Create a missing format-1 record in one explicit migration transaction,
    /// or preserve and return the exact existing incarnation. Corrupt state is
    /// never repaired in place.
    ///
    /// @ref LLP 0056#durable-authorization-stream — migration precedes bind
    /// but remains separate from read-only auth-mode/collision inspection.
    pub(crate) fn ensure_authorization_stream_incarnation(
        &mut self,
    ) -> SnapbackResult<AuthorizationStreamIncarnation> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let incarnation = match read_authorization_stream_record_on(&tx)? {
            Some(record) => record.incarnation(),
            None => {
                let incarnation = AuthorizationStreamIncarnation::fresh();
                write_authorization_stream_incarnation_in(&tx, &incarnation)?;
                incarnation
            }
        };
        tx.commit()?;
        Ok(incarnation)
    }

    pub(crate) fn authorization_stream_incarnation(
        &self,
    ) -> SnapbackResult<AuthorizationStreamIncarnation> {
        read_authorization_stream_record_on(&self.conn)?
            .map(|record| record.incarnation())
            .ok_or_else(|| stream_corrupt("authorization-stream metadata is missing"))
    }

    /// Copy all projection inputs under one deferred read transaction. The
    /// returned source remains raw and unpublished until detached validation
    /// in `SessionProjection::rebuild` succeeds.
    ///
    /// @ref LLP 0056#startup-rebuild-and-deadline-derivation — session rows,
    /// identity bindings, tombstones, markers, and incarnation share one read
    /// snapshot; no partial projection escapes.
    pub(crate) fn session_projection_source(&mut self) -> SnapbackResult<ProjectionSource> {
        self.session_projection_source_inner().map_err(|error| {
            if matches!(
                error.diagnostic.code.as_str(),
                "SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT" | "SNAPBACK_AUTH_PROJECTION_CORRUPT"
            ) {
                error
            } else {
                projection_corrupt(
                    "session projection source could not be read with its exact declared types",
                )
            }
        })
    }

    fn session_projection_source_inner(&mut self) -> SnapbackResult<ProjectionSource> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        if inspect_auth_catalog_on(&tx)? != AuthCatalogState::ReadyV1 {
            return Err(projection_corrupt(
                "session projection requires an exact-ready auth catalog",
            ));
        }
        let authorization_stream_value = raw_text_meta_on(
            &tx,
            AUTHORIZATION_STREAM_META_KEY,
            "authorization-stream metadata",
        )?
        .ok_or_else(|| stream_corrupt("authorization-stream metadata is missing"))?;
        let restore_declaration_id = raw_text_meta_on(
            &tx,
            super::auth::META_AUTH_RESTORE_DECLARATION_ID,
            "restore declaration metadata",
        )?;

        let users = {
            let mut statement =
                tx.prepare("SELECT id, created_at_ms FROM _auth_users ORDER BY id")?;
            statement
                .query_map([], |row| {
                    Ok(ProjectionUserRow {
                        id: row.get(0)?,
                        created_at_ms: row.get(1)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        let identities = {
            let mut statement = tx.prepare(
                "SELECT id, user_id, provider, verified_at_ms
                 FROM _auth_identities ORDER BY id",
            )?;
            statement
                .query_map([], |row| {
                    Ok(ProjectionIdentityRow {
                        id: row.get(0)?,
                        user_id: row.get(1)?,
                        provider: row.get(2)?,
                        verified_at_ms: row.get(3)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        let sessions = {
            let mut statement = tx.prepare(
                "SELECT id, user_id, identity_id, authority_instance_id,
                        token_hash, generation, created_at_ms, last_used_at_ms,
                        expires_at_ms, absolute_expires_at_ms, revoked_at_ms
                 FROM _auth_sessions ORDER BY id",
            )?;
            statement
                .query_map([], |row| {
                    Ok(ProjectionSessionRow {
                        id: row.get(0)?,
                        user_id: row.get(1)?,
                        identity_id: row.get(2)?,
                        authority_instance_id: row.get(3)?,
                        token_hash: row.get(4)?,
                        generation: row.get(5)?,
                        created_at_ms: row.get(6)?,
                        last_used_at_ms: row.get(7)?,
                        expires_at_ms: row.get(8)?,
                        absolute_expires_at_ms: row.get(9)?,
                        revoked_at_ms: row.get(10)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        let superseded_tokens = {
            let mut statement = tx.prepare(
                "SELECT token_hash, session_id, superseded_at_ms
                 FROM _auth_session_tokens ORDER BY token_hash",
            )?;
            statement
                .query_map([], |row| {
                    Ok(ProjectionTokenRow {
                        token_hash: row.get(0)?,
                        session_id: row.get(1)?,
                        superseded_at_ms: row.get(2)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        tx.commit()?;
        Ok(ProjectionSource {
            authorization_stream_value,
            restore_declaration_id,
            users,
            identities,
            sessions,
            superseded_tokens,
        })
    }
}

/// Rotate inside the caller's destructive transaction. The caller decides
/// publication only after its commit is known successful.
///
/// @ref LLP 0056#reset-restore-and-stream-publication — reset/restore writes
/// the successor incarnation in the same transaction as destructive state.
pub(super) fn rotate_authorization_stream_incarnation_in(
    tx: &Transaction<'_>,
    incarnation: &AuthorizationStreamIncarnation,
) -> SnapbackResult<AuthorizationStreamIncarnation> {
    write_authorization_stream_incarnation_in(tx, incarnation)?;
    Ok(incarnation.clone())
}

pub(super) fn write_authorization_stream_incarnation_in(
    tx: &Transaction<'_>,
    incarnation: &AuthorizationStreamIncarnation,
) -> SnapbackResult<()> {
    let value = AuthorizationStreamRecord::new(incarnation.clone()).encode_string()?;
    tx.execute(
        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![AUTHORIZATION_STREAM_META_KEY, value],
    )?;
    Ok(())
}

fn read_authorization_stream_record_on(
    conn: &Connection,
) -> SnapbackResult<Option<AuthorizationStreamRecord>> {
    raw_text_meta_on(
        conn,
        AUTHORIZATION_STREAM_META_KEY,
        "authorization-stream metadata",
    )?
    .map(|bytes| AuthorizationStreamRecord::parse_exact(&bytes))
    .transpose()
}

fn raw_text_meta_on(conn: &Connection, key: &str, label: &str) -> SnapbackResult<Option<Vec<u8>>> {
    let value: Option<(String, Vec<u8>)> = conn
        .query_row(
            "SELECT typeof(value), CAST(value AS BLOB)
             FROM _snapback_meta WHERE key = ?1",
            params![key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    match value {
        Some((storage_class, bytes)) if storage_class == "text" => Ok(Some(bytes)),
        Some(_) => Err(if key == AUTHORIZATION_STREAM_META_KEY {
            stream_corrupt(&format!("{label} is not stored as SQLite text"))
        } else {
            projection_corrupt(&format!("{label} is not stored as SQLite text"))
        }),
        None => Ok(None),
    }
}

fn stream_corrupt(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT", "auth", message)
}

fn projection_corrupt(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_PROJECTION_CORRUPT", "auth", message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::session_projection::SessionProjection;
    use std::time::Instant;

    fn uuid_v7(timestamp_ms: u64, byte: u8) -> String {
        uuid::Builder::from_unix_timestamp_millis(timestamp_ms, &[byte; 10])
            .into_uuid()
            .to_string()
    }

    #[test]
    fn migration_writes_exact_record_and_restart_preserves_it() {
        let mut database = LocalDatabase::memory().expect("database");
        let incarnation = database
            .ensure_authorization_stream_incarnation()
            .expect("create stream record");
        let stored: String = database
            .conn
            .query_row(
                "SELECT value FROM _snapback_meta WHERE key = ?1",
                params![AUTHORIZATION_STREAM_META_KEY],
                |row| row.get(0),
            )
            .expect("stored record");
        assert_eq!(
            stored,
            format!(
                "{{\"formatVersion\":1,\"incarnation\":\"{}\"}}",
                incarnation.as_str()
            )
        );
        assert_eq!(
            database
                .ensure_authorization_stream_incarnation()
                .expect("idempotent migration"),
            incarnation
        );
    }

    #[test]
    fn migration_refuses_noncanonical_or_unknown_records_without_repair() {
        for malformed in [
            "{ \"formatVersion\":1,\"incarnation\":\"01890f3e-7b00-7000-8000-000000000000\"}",
            "{\"incarnation\":\"01890f3e-7b00-7000-8000-000000000000\",\"formatVersion\":1}",
            "{\"formatVersion\":2,\"incarnation\":\"01890f3e-7b00-7000-8000-000000000000\"}",
            "{\"formatVersion\":1,\"incarnation\":\"not-a-uuid\"}",
            "{\"formatVersion\":1,\"incarnation\":\"01890f3e-7b00-7000-8000-000000000000\",\"extra\":true}",
        ] {
            let mut database = LocalDatabase::memory().expect("database");
            database
                .conn
                .execute(
                    "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)",
                    params![AUTHORIZATION_STREAM_META_KEY, malformed],
                )
                .expect("inject malformed record");
            let error = database
                .ensure_authorization_stream_incarnation()
                .expect_err("malformed record must refuse startup migration");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT"
            );
            let retained: Option<String> = database
                .conn
                .query_row(
                    "SELECT value FROM _snapback_meta WHERE key = ?1",
                    params![AUTHORIZATION_STREAM_META_KEY],
                    |row| row.get(0),
                )
                .optional()
                .expect("retained malformed record");
            assert_eq!(retained.as_deref(), Some(malformed));
        }
    }

    #[test]
    fn storage_copies_one_complete_source_for_detached_rebuild() {
        let mut database = LocalDatabase::memory().expect("database");
        database.activate_auth_catalog_v1().expect("catalog");
        let incarnation = database
            .ensure_authorization_stream_incarnation()
            .expect("stream migration");
        let user_id = uuid_v7(1, 1);
        let identity_id = uuid_v7(2, 2);
        let session_id = uuid_v7(3, 3);
        let authority_id = uuid_v7(4, 4);
        database
            .with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT INTO _auth_users(id, created_at_ms) VALUES(?1, 1)",
                    params![user_id],
                )?;
                tx.execute(
                    "INSERT INTO _auth_identities(
                       id, user_id, provider, subject, verified_at_ms
                     ) VALUES(?1, ?2, 'email-code', 'person@example.com', 2)",
                    params![identity_id, user_id],
                )?;
                tx.execute(
                    "INSERT INTO _auth_sessions(
                       id, user_id, identity_id, authority_instance_id, token_hash,
                       generation, created_at_ms, last_used_at_ms, expires_at_ms,
                       absolute_expires_at_ms, revoked_at_ms
                     ) VALUES(?1, ?2, ?3, ?4, ?5, 1, 3, 4, 200, 300, NULL)",
                    params![
                        session_id,
                        user_id,
                        identity_id,
                        authority_id,
                        vec![7_u8; 32]
                    ],
                )?;
                tx.execute(
                    "INSERT INTO _auth_session_tokens(
                       token_hash, session_id, superseded_at_ms
                     ) VALUES(?1, ?2, 5)",
                    params![vec![6_u8; 32], session_id],
                )?;
                Ok(())
            })
            .expect("seed catalog");

        let source = database
            .session_projection_source()
            .expect("one read snapshot");
        assert_eq!(source.users.len(), 1);
        assert_eq!(source.identities.len(), 1);
        assert_eq!(source.sessions.len(), 1);
        assert_eq!(source.superseded_tokens.len(), 1);
        let projection = SessionProjection::rebuild(source, &uuid_v7(5, 5), 100, Instant::now())
            .expect("detached projection");
        assert_eq!(projection.incarnation(), &incarnation);
        projection
            .check_invariants()
            .expect("projection invariants");
    }

    #[test]
    fn sqlite_row_type_failure_is_projection_corrupt_not_generic_storage() {
        let mut database = LocalDatabase::memory().expect("database");
        database.activate_auth_catalog_v1().expect("catalog");
        database
            .ensure_authorization_stream_incarnation()
            .expect("stream migration");
        database
            .conn
            .execute(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES(?1, 1)",
                params![vec![0xff_u8]],
            )
            .expect("SQLite accepts a deliberately mistyped row");
        let error = database
            .session_projection_source()
            .expect_err("mistyped source must refuse projection rebuild");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_PROJECTION_CORRUPT");
    }
}
