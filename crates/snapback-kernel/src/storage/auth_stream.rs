//! Durable authorization-stream metadata and detached projection snapshots.
//!
//! The migration is explicit rather than part of `LocalDatabase::open`: LLP
//! 0058's stage-time collision inspection must remain read-only. Auth-capable
//! startup calls the migration before bind, then sessions startup obtains one
//! complete read transaction through `session_projection_source`.

use super::auth::inspect_auth_catalog_on;
use super::{AuthorizationVersion, LocalDatabase};
use crate::auth::session_projection::{
    AUTHORIZATION_STREAM_META_KEY, AdmittedProjectionSnapshot, AuthorizationStreamRecord,
    ProjectionIdentityRow, ProjectionSessionRow, ProjectionSource, ProjectionTokenRow,
    ProjectionUserRow,
};
use crate::contract_types::{AuthorizationStreamIncarnation, SESSION_TERMINAL_CAUSE_META_PREFIX};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use std::collections::BTreeMap;

pub const AUTHORIZATION_EPOCH_META_KEY: &str = "authorization_epoch_v1";

impl LocalDatabase {
    /// Create a missing format-1 record in one explicit migration transaction,
    /// or preserve and return the exact existing incarnation. Corrupt state is
    /// never repaired in place.
    ///
    /// @ref LLP 0059#durable-authorization-stream — migration precedes bind
    /// but remains separate from read-only auth-mode/collision inspection.
    pub fn ensure_authorization_stream_incarnation(
        &mut self,
    ) -> SnapbackResult<AuthorizationStreamIncarnation> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let version = ensure_authorization_version_in(&tx)?;
        tx.commit()?;
        AuthorizationStreamIncarnation::parse(&version.incarnation).map_err(Into::into)
    }

    pub fn authorization_stream_incarnation(
        &self,
    ) -> SnapbackResult<AuthorizationStreamIncarnation> {
        read_authorization_stream_record_on(&self.conn)?
            .map(|record| record.incarnation())
            .ok_or_else(|| stream_corrupt("authorization-stream metadata is missing"))
    }

    /// Read the complete durable authorization witness. Missing or partial
    /// state is never interpreted as continuity.
    pub fn authorization_version(&self) -> SnapbackResult<AuthorizationVersion> {
        super::with_pinned_read_snapshot(&self.conn, |conn| {
            read_authorization_version_on(conn)?.ok_or_else(|| {
                authorization_version_corrupt("authorization-version metadata is missing")
            })
        })
    }

    /// Read the data head and authorization witness from one durable snapshot.
    /// Reservation/revalidation callers compare this pair as one admission
    /// frontier; assembling it from two transactions could publish a pair that
    /// never existed.
    ///
    /// @ref LLP 0059#durable-authorization-stream — data and authorization
    /// frontiers used by a reservation are snapshot-bound.
    pub fn authorization_reservation_snapshot(
        &self,
    ) -> SnapbackResult<(u64, AuthorizationVersion)> {
        super::with_pinned_read_snapshot(&self.conn, |conn| {
            let data_version = super::current_version_on(conn)?;
            let authorization = read_authorization_version_on(conn)?.ok_or_else(|| {
                authorization_version_corrupt("authorization-version metadata is missing")
            })?;
            Ok((data_version, authorization))
        })
    }

    /// Copy all projection inputs under one deferred read transaction. The
    /// returned source remains raw and unpublished until detached validation
    /// in `SessionProjection::rebuild` succeeds.
    ///
    /// @ref LLP 0059#startup-rebuild-and-deadline-derivation — session rows,
    /// identity bindings, tombstones, markers, and incarnation share one read
    /// snapshot; no partial projection escapes.
    pub fn session_projection_source(&mut self) -> SnapbackResult<ProjectionSource> {
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

    /// Mint the opaque full-catalog snapshot accepted by the sync
    /// coordinator. Only a kernel read transaction can construct this value.
    pub fn admitted_session_projection_snapshot(
        &mut self,
    ) -> SnapbackResult<AdmittedProjectionSnapshot> {
        self.session_projection_source()
            .map(AdmittedProjectionSnapshot::new)
    }

    /// Mint the stream-only snapshot used while the auth catalog is absent or
    /// by a direct reset. The incarnation is read or initialized by the
    /// kernel; callers cannot substitute authored authority rows.
    pub fn admitted_stream_projection_snapshot(
        &mut self,
    ) -> SnapbackResult<AdmittedProjectionSnapshot> {
        let incarnation = self.ensure_authorization_stream_incarnation()?;
        Ok(AdmittedProjectionSnapshot::new(ProjectionSource {
            authorization_stream_value: AuthorizationStreamRecord::new(incarnation)
                .encode_bytes()?,
            restore_declaration_id: None,
            users: Vec::new(),
            identities: Vec::new(),
            sessions: Vec::new(),
            superseded_tokens: Vec::new(),
        }))
    }

    fn session_projection_source_inner(&mut self) -> SnapbackResult<ProjectionSource> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Deferred)?;
        if !inspect_auth_catalog_on(&tx)?.is_ready() {
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
        let mut identities = {
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
        // Guest sessions deliberately have no durable identity row, but the
        // memory-only resolver's uniform session shape needs a provider-bearing
        // projection node. Use the already-unique session id as a synthetic,
        // projection-only identity key; no catalog identity is fabricated.
        //
        // @ref LLP 0214#62-projection-rules — guest claims project no
        //   identities while their public session provider is `guest`.
        {
            let mut statement = tx.prepare(
                "SELECT id,user_id,created_at_ms FROM _auth_sessions
                 WHERE authn_source='guest' ORDER BY id",
            )?;
            let guest_identities = statement
                .query_map([], |row| {
                    Ok(ProjectionIdentityRow {
                        id: row.get(0)?,
                        user_id: row.get(1)?,
                        provider: "guest".to_owned(),
                        verified_at_ms: row.get(2)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            identities.extend(guest_identities);
        }
        let mut terminal_causes = {
            let mut statement = tx.prepare(
                "SELECT key, typeof(value), CAST(value AS BLOB)
                 FROM _snapback_meta
                 WHERE substr(key, 1, ?1) = ?2
                 ORDER BY key",
            )?;
            let rows = statement
                .query_map(
                    params![
                        SESSION_TERMINAL_CAUSE_META_PREFIX.len() as i64,
                        SESSION_TERMINAL_CAUSE_META_PREFIX,
                    ],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Vec<u8>>(2)?,
                        ))
                    },
                )?
                .collect::<Result<Vec<_>, _>>()?;
            let mut causes = BTreeMap::new();
            for (key, storage_class, bytes) in rows {
                if storage_class != "text" {
                    return Err(projection_corrupt(
                        "a session terminal-cause witness is not stored as SQLite text",
                    ));
                }
                let session_id = key
                    .strip_prefix(SESSION_TERMINAL_CAUSE_META_PREFIX)
                    .expect("prefix-constrained metadata query");
                if session_id.is_empty() || causes.insert(session_id.to_owned(), bytes).is_some() {
                    return Err(projection_corrupt(
                        "session terminal-cause metadata has an invalid key",
                    ));
                }
            }
            causes
        };
        let mut rehearsal_provenance =
            super::auth_rehearsal::rehearsal_session_provenance_by_id(&tx)?;
        let sessions = {
            let mut statement = tx.prepare(
                "SELECT id, user_id, COALESCE(identity_id,id), authority_instance_id,
                        token_hash, generation, created_at_ms, last_used_at_ms,
                        expires_at_ms, absolute_expires_at_ms, revoked_at_ms
                 FROM _auth_sessions ORDER BY id",
            )?;
            let mut sessions = statement
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
                        terminal_cause: None,
                        rehearsal_provenance: rehearsal_provenance
                            .remove(&row.get::<_, String>(0)?),
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for session in &mut sessions {
                session.terminal_cause = terminal_causes.remove(&session.id);
            }
            sessions
        };
        if !terminal_causes.is_empty() {
            return Err(projection_corrupt(
                "session terminal-cause metadata names a missing session",
            ));
        }
        if !rehearsal_provenance.is_empty() {
            return Err(projection_corrupt(
                "rehearsal session provenance names a missing session",
            ));
        }
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

/// Create or migrate the exact pair inside a caller-owned transaction.
pub(super) fn ensure_authorization_version_in(
    tx: &Transaction<'_>,
) -> SnapbackResult<AuthorizationVersion> {
    let stream = read_authorization_stream_record_on(tx)?;
    let epoch = read_authorization_epoch_on(tx)?;
    match (stream, epoch) {
        (Some(stream), Some(epoch)) => Ok(AuthorizationVersion {
            incarnation: stream.incarnation().as_str().to_owned(),
            epoch,
        }),
        (Some(stream), None) => {
            write_authorization_epoch_in(tx, 0)?;
            Ok(AuthorizationVersion {
                incarnation: stream.incarnation().as_str().to_owned(),
                epoch: 0,
            })
        }
        (None, None) => {
            let incarnation = AuthorizationStreamIncarnation::fresh();
            write_authorization_stream_incarnation_in(tx, &incarnation)?;
            write_authorization_epoch_in(tx, 0)?;
            Ok(AuthorizationVersion {
                incarnation: incarnation.as_str().to_owned(),
                epoch: 0,
            })
        }
        (None, Some(_)) => Err(authorization_version_corrupt(
            "authorization epoch exists without its stream incarnation",
        )),
    }
}

pub(super) fn advance_authorization_epoch_in(
    tx: &Transaction<'_>,
) -> SnapbackResult<AuthorizationVersion> {
    let mut version = ensure_authorization_version_in(tx)?;
    version.epoch = version
        .epoch
        .checked_add(1)
        .filter(|epoch| *epoch <= super::MAX_AUTHORIZATION_EPOCH)
        .ok_or_else(super::authorization::epoch_exhausted)?;
    write_authorization_epoch_in(tx, version.epoch)?;
    Ok(version)
}

/// Rotate inside the caller's destructive transaction and reset the epoch.
/// The caller decides publication only after its commit is known successful.
///
/// @ref LLP 0059#reset-restore-and-stream-publication — reset/restore writes
/// the successor incarnation in the same transaction as destructive state.
pub(super) fn rotate_authorization_stream_incarnation_in(
    tx: &Transaction<'_>,
    incarnation: &AuthorizationStreamIncarnation,
) -> SnapbackResult<AuthorizationStreamIncarnation> {
    write_authorization_stream_incarnation_in(tx, incarnation)?;
    write_authorization_epoch_in(tx, 0)?;
    Ok(incarnation.clone())
}

pub(crate) fn rotate_authorization_version_in(
    tx: &Transaction<'_>,
) -> SnapbackResult<AuthorizationVersion> {
    let incarnation = AuthorizationStreamIncarnation::fresh();
    rotate_authorization_stream_incarnation_in(tx, &incarnation)?;
    Ok(AuthorizationVersion {
        incarnation: incarnation.as_str().to_owned(),
        epoch: 0,
    })
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

pub(super) fn read_authorization_stream_record_on(
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

pub(super) fn read_authorization_version_on(
    conn: &Connection,
) -> SnapbackResult<Option<AuthorizationVersion>> {
    let stream = read_authorization_stream_record_on(conn)?;
    let epoch = read_authorization_epoch_on(conn)?;
    match (stream, epoch) {
        (None, None) => Ok(None),
        (Some(stream), Some(epoch)) => Ok(Some(AuthorizationVersion {
            incarnation: stream.incarnation().as_str().to_owned(),
            epoch,
        })),
        _ => Err(authorization_version_corrupt(
            "authorization-version metadata is partial",
        )),
    }
}

/// Read both halves of the authorization pair from one SQLite snapshot when
/// the caller is outside an existing transaction.
pub(crate) fn read_authorization_version_snapshot(
    conn: &Connection,
) -> SnapbackResult<Option<AuthorizationVersion>> {
    super::with_pinned_read_snapshot(conn, read_authorization_version_on)
}

fn read_authorization_epoch_on(conn: &Connection) -> SnapbackResult<Option<u64>> {
    let Some(bytes) = raw_text_meta_on(
        conn,
        AUTHORIZATION_EPOCH_META_KEY,
        "authorization epoch metadata",
    )?
    else {
        return Ok(None);
    };
    let raw = std::str::from_utf8(&bytes).map_err(|_| {
        authorization_version_corrupt("authorization epoch is not UTF-8 decimal text")
    })?;
    let epoch = raw.parse::<u64>().map_err(|_| {
        authorization_version_corrupt("authorization epoch is not canonical decimal text")
    })?;
    if epoch.to_string() != raw || epoch > super::MAX_AUTHORIZATION_EPOCH {
        return Err(authorization_version_corrupt(
            "authorization epoch is outside canonical JavaScript-safe decimal form",
        ));
    }
    Ok(Some(epoch))
}

fn write_authorization_epoch_in(tx: &Transaction<'_>, epoch: u64) -> SnapbackResult<()> {
    if epoch > super::MAX_AUTHORIZATION_EPOCH {
        return Err(super::authorization::epoch_exhausted());
    }
    tx.execute(
        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![AUTHORIZATION_EPOCH_META_KEY, epoch.to_string()],
    )?;
    Ok(())
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
        } else if key == AUTHORIZATION_EPOCH_META_KEY {
            authorization_version_corrupt(&format!("{label} is not stored as SQLite text"))
        } else {
            projection_corrupt(&format!("{label} is not stored as SQLite text"))
        }),
        None => Ok(None),
    }
}

fn stream_corrupt(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_STREAM_INCARNATION_CORRUPT", "auth", message)
}

fn authorization_version_corrupt(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTHORIZATION_VERSION_CORRUPT", "auth", message)
}

fn projection_corrupt(message: &str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_PROJECTION_CORRUPT", "auth", message)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let epoch: String = database
            .conn
            .query_row(
                "SELECT value FROM _snapback_meta WHERE key = ?1",
                params![AUTHORIZATION_EPOCH_META_KEY],
                |row| row.get(0),
            )
            .expect("stored epoch");
        assert_eq!(epoch, "0");
        assert_eq!(
            database.authorization_version().unwrap(),
            AuthorizationVersion {
                incarnation: incarnation.as_str().to_owned(),
                epoch: 0,
            }
        );
        assert_eq!(
            database
                .ensure_authorization_stream_incarnation()
                .expect("idempotent migration"),
            incarnation
        );
    }

    #[test]
    fn migration_adds_epoch_to_an_existing_item5_stream_without_rotating() {
        let mut database = LocalDatabase::memory().expect("database");
        let incarnation = AuthorizationStreamIncarnation::fresh();
        let tx = database.conn.transaction().unwrap();
        write_authorization_stream_incarnation_in(&tx, &incarnation).unwrap();
        tx.commit().unwrap();

        assert_eq!(
            database
                .ensure_authorization_stream_incarnation()
                .expect("migrate stream-only record"),
            incarnation
        );
        assert_eq!(
            database.authorization_version().unwrap(),
            AuthorizationVersion {
                incarnation: incarnation.as_str().to_owned(),
                epoch: 0,
            }
        );
    }

    #[test]
    fn epoch_is_canonical_js_safe_text_and_partial_state_fails_closed() {
        for malformed in ["00", "+1", "9007199254740992", "-1", "1.0"] {
            let mut database = LocalDatabase::memory().expect("database");
            let incarnation = AuthorizationStreamIncarnation::fresh();
            // Use one explicit transaction so the stream and malformed epoch
            // are both durably visible to the reader.
            let tx = database.conn.transaction().unwrap();
            write_authorization_stream_incarnation_in(&tx, &incarnation).unwrap();
            tx.execute(
                "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)",
                params![AUTHORIZATION_EPOCH_META_KEY, malformed],
            )
            .unwrap();
            tx.commit().unwrap();
            let error = database
                .authorization_version()
                .expect_err("malformed epoch must fail closed");
            assert_eq!(
                error.diagnostic.code,
                "SNAPBACK_AUTHORIZATION_VERSION_CORRUPT"
            );
        }

        let mut database = LocalDatabase::memory().expect("database");
        database
            .conn
            .execute(
                "INSERT INTO _snapback_meta(key, value) VALUES(?1, '1')",
                params![AUTHORIZATION_EPOCH_META_KEY],
            )
            .unwrap();
        let error = database
            .ensure_authorization_stream_incarnation()
            .expect_err("epoch without incarnation must fail closed");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTHORIZATION_VERSION_CORRUPT"
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
        database.activate_current_auth_catalog().expect("catalog");
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
                crate::storage::insert_test_email_identity(
                    tx,
                    &identity_id,
                    &user_id,
                    "person@example.com",
                    2,
                    false,
                )?;
                crate::storage::insert_test_identity_session(
                    tx,
                    &session_id,
                    &user_id,
                    &identity_id,
                    &authority_id,
                    &[7_u8; 32],
                    3,
                    4,
                    200,
                    300,
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
        let stream = AuthorizationStreamRecord::parse_exact(&source.authorization_stream_value)
            .expect("canonical stream record");
        assert_eq!(stream.incarnation(), incarnation);
    }

    #[test]
    fn sqlite_row_type_failure_is_projection_corrupt_not_generic_storage() {
        let mut database = LocalDatabase::memory().expect("database");
        database.activate_current_auth_catalog().expect("catalog");
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
impl super::ServingDatabase {
    pub fn ensure_authorization_stream_incarnation(
        &mut self,
    ) -> SnapbackResult<AuthorizationStreamIncarnation> {
        self.db.ensure_authorization_stream_incarnation()
    }
    pub fn admitted_session_projection_snapshot(
        &mut self,
    ) -> SnapbackResult<AdmittedProjectionSnapshot> {
        self.db.admitted_session_projection_snapshot()
    }
    pub fn admitted_stream_projection_snapshot(
        &mut self,
    ) -> SnapbackResult<AdmittedProjectionSnapshot> {
        self.db.admitted_stream_projection_snapshot()
    }
}
impl super::ServingDatabase {
    pub fn session_projection_source(&mut self) -> SnapbackResult<ProjectionSource> {
        self.db.session_projection_source()
    }
}
