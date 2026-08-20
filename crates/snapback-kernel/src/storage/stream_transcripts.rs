//! Manifest-activated durable final records for private streaming actions.
//!
//! Chunks remain in the bounded live room only. V1 persists the attempt
//! identity, terminal cause, final value, chunk count, and nullable token
//! accounting so reconnect can explicitly report a live-history gap.
//!
//! @ref LLP 0076#dated-amendment-private-action-output-streams-2026-08-09 —
//! manifest gating, exact terminal shape, and the no-durable-chunks rule.
//! @ref LLP 0204#d5--surface-4-the-near-data-ai-interface — enabled ask runs
//! through the same durable terminal/transcript carrier.

use super::{LocalDatabase, SnapbackResult};
use crate::diagnostic::SnapbackError;
use crate::manifest::{FunctionKind, FunctionManifest};
use crate::stream_attempt::{PersistedStreamAttempt, StreamAttemptCause, StreamInitiator};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};

pub const STREAM_TRANSCRIPT_TABLE: &str = "_snapback_stream_transcripts";
pub const STREAM_TRANSCRIPT_FINAL_MAX_BYTES: usize = 256 * 1024;

const TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS _snapback_stream_transcripts (
  attempt_token TEXT NOT NULL PRIMARY KEY CHECK(length(attempt_token) BETWEEN 1 AND 512),
  function_id TEXT NOT NULL CHECK(length(function_id) BETWEEN 1 AND 512),
  initiator_kind TEXT NOT NULL CHECK(initiator_kind IN ('session_user','service_credential','anonymous_connection')),
  initiator_key TEXT NOT NULL CHECK(length(initiator_key) BETWEEN 1 AND 1024),
  started_at_ms INTEGER NOT NULL CHECK(started_at_ms BETWEEN 0 AND 9007199254740991),
  settled_at_ms INTEGER NOT NULL CHECK(settled_at_ms BETWEEN started_at_ms AND 9007199254740991),
  terminal_cause TEXT NOT NULL CHECK(terminal_cause IN ('complete','failed','cancelled','timed_out','ambiguous')),
  final_text TEXT CHECK(final_text IS NULL OR length(CAST(final_text AS BLOB)) <= 262144),
  chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 0 AND 9007199254740991),
  prompt_tokens INTEGER CHECK(prompt_tokens IS NULL OR prompt_tokens BETWEEN 0 AND 9007199254740991),
  completion_tokens INTEGER CHECK(completion_tokens IS NULL OR completion_tokens BETWEEN 0 AND 9007199254740991)
);
CREATE INDEX IF NOT EXISTS _snapback_stream_transcripts_initiator
  ON _snapback_stream_transcripts(initiator_kind, initiator_key, settled_at_ms DESC);
"#;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StreamTranscriptRecord {
    pub attempt_token: String,
    pub function_id: String,
    pub initiator: StreamInitiator,
    pub started_at_ms: u64,
    pub settled_at_ms: u64,
    pub terminal_cause: StreamAttemptCause,
    pub final_text: Option<String>,
    pub chunk_count: u64,
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
}

pub fn manifest_enabled(manifest: &FunctionManifest) -> bool {
    manifest
        .functions
        .iter()
        .any(|function| function.stream && function.kind == FunctionKind::Action)
}

pub fn manifests_enabled(
    schema: &crate::manifest::SchemaManifest,
    functions: Option<&FunctionManifest>,
) -> bool {
    schema.ask_manifest().is_some() || functions.is_some_and(manifest_enabled)
}

pub(crate) fn activate_manifests_in(
    tx: &Transaction<'_>,
    schema: &crate::manifest::SchemaManifest,
    functions: Option<&FunctionManifest>,
) -> SnapbackResult<()> {
    if !manifests_enabled(schema, functions) {
        tx.execute_batch(
            "DROP INDEX IF EXISTS _snapback_stream_transcripts_initiator;
             DROP TABLE IF EXISTS _snapback_stream_transcripts;",
        )?;
        return Ok(());
    }
    tx.execute_batch(TABLE_SQL)?;
    validate_exact_schema(tx)
}

pub(crate) fn activate_manifest_in(
    tx: &Transaction<'_>,
    manifest: &FunctionManifest,
) -> SnapbackResult<()> {
    if !manifest_enabled(manifest) {
        tx.execute_batch(
            "DROP INDEX IF EXISTS _snapback_stream_transcripts_initiator;
             DROP TABLE IF EXISTS _snapback_stream_transcripts;",
        )?;
        return Ok(());
    }
    tx.execute_batch(TABLE_SQL)?;
    validate_exact_schema(tx)
}

pub(crate) fn manifests_match_catalog(
    conn: &Connection,
    schema: &crate::manifest::SchemaManifest,
    functions: Option<&FunctionManifest>,
) -> SnapbackResult<bool> {
    if !manifests_enabled(schema, functions) {
        return Ok(!table_exists(conn)?);
    }
    if !table_exists(conn)? {
        return Ok(false);
    }
    catalog_matches_exact_schema(conn)
}

fn catalog_matches_exact_schema(conn: &Connection) -> SnapbackResult<bool> {
    let reference = Connection::open_in_memory()?;
    reference.execute_batch(TABLE_SQL)?;
    Ok(catalog_objects(conn)? == catalog_objects(&reference)?)
}

pub(super) fn validate_exact_schema(conn: &Connection) -> SnapbackResult<()> {
    if !catalog_matches_exact_schema(conn)? {
        return Err(catalog_corrupt());
    }
    Ok(())
}

fn catalog_objects(conn: &Connection) -> SnapbackResult<Vec<(String, String, String, String)>> {
    let mut statement = conn.prepare(
        "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_schema
         WHERE name = '_snapback_stream_transcripts'
            OR tbl_name = '_snapback_stream_transcripts'
         ORDER BY type, name",
    )?;
    Ok(statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn table_exists(conn: &Connection) -> SnapbackResult<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1",
            params![STREAM_TRANSCRIPT_TABLE],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn initiator_parts(initiator: &StreamInitiator) -> (&'static str, &str) {
    match initiator {
        StreamInitiator::SessionUser(key) => ("session_user", key),
        StreamInitiator::ServiceCredential(key) => ("service_credential", key),
        StreamInitiator::AnonymousConnection(key) => ("anonymous_connection", key),
    }
}

fn parse_initiator(kind: &str, key: String) -> SnapbackResult<StreamInitiator> {
    match kind {
        "session_user" => Ok(StreamInitiator::SessionUser(key)),
        "service_credential" => Ok(StreamInitiator::ServiceCredential(key)),
        "anonymous_connection" => Ok(StreamInitiator::AnonymousConnection(key)),
        _ => Err(catalog_corrupt()),
    }
}

impl LocalDatabase {
    #[cfg(any(test, feature = "test-support"))]
    pub fn activate_stream_transcript_manifest(
        &mut self,
        manifest: &FunctionManifest,
    ) -> SnapbackResult<()> {
        let schema = self.schema.clone();
        let tx = self.conn.transaction()?;
        if schema.ask_manifest().is_some() {
            activate_manifests_in(&tx, &schema, Some(manifest))?;
        } else {
            activate_manifest_in(&tx, manifest)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn settle_stream_transcript(
        &mut self,
        record: &StreamTranscriptRecord,
    ) -> SnapbackResult<()> {
        if !table_exists(&self.conn)? {
            return Err(SnapbackError::error(
                "SNAPBACK_STREAM_TRANSCRIPTS_UNAVAILABLE",
                "storage",
                "stream transcripts are not active for this function manifest",
            ));
        }
        if record
            .final_text
            .as_ref()
            .is_some_and(|value| value.len() > STREAM_TRANSCRIPT_FINAL_MAX_BYTES)
        {
            return Err(SnapbackError::error(
                "SNAPBACK_STREAM_FINAL_TOO_LARGE",
                "runtime",
                "the streaming action final value exceeds 256 KiB",
            ));
        }
        let (kind, key) = initiator_parts(&record.initiator);
        self.conn.execute(
            "INSERT INTO _snapback_stream_transcripts(
               attempt_token,function_id,initiator_kind,initiator_key,started_at_ms,
               settled_at_ms,terminal_cause,final_text,chunk_count,prompt_tokens,completion_tokens)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
             ON CONFLICT(attempt_token) DO NOTHING",
            params![
                record.attempt_token,
                record.function_id,
                kind,
                key,
                record.started_at_ms as i64,
                record.settled_at_ms as i64,
                record.terminal_cause.as_str(),
                record.final_text,
                record.chunk_count as i64,
                record.prompt_tokens.map(|value| value as i64),
                record.completion_tokens.map(|value| value as i64),
            ],
        )?;
        Ok(())
    }

    pub fn stream_transcript(
        &self,
        attempt_token: &str,
    ) -> SnapbackResult<Option<StreamTranscriptRecord>> {
        if !table_exists(&self.conn)? {
            return Ok(None);
        }
        self.conn
            .query_row(
                "SELECT function_id,initiator_kind,initiator_key,started_at_ms,settled_at_ms,
                        terminal_cause,final_text,chunk_count,prompt_tokens,completion_tokens
                 FROM _snapback_stream_transcripts WHERE attempt_token=?1",
                params![attempt_token],
                |row| {
                    let kind: String = row.get(1)?;
                    let key: String = row.get(2)?;
                    let cause: String = row.get(5)?;
                    Ok((
                        row.get::<_, String>(0)?,
                        kind,
                        key,
                        row.get::<_, u64>(3)?,
                        row.get::<_, u64>(4)?,
                        cause,
                        row.get::<_, Option<String>>(6)?,
                        row.get::<_, u64>(7)?,
                        row.get::<_, Option<u64>>(8)?,
                        row.get::<_, Option<u64>>(9)?,
                    ))
                },
            )
            .optional()?
            .map(|row| {
                Ok(StreamTranscriptRecord {
                    attempt_token: attempt_token.to_owned(),
                    function_id: row.0,
                    initiator: parse_initiator(&row.1, row.2)?,
                    started_at_ms: row.3,
                    settled_at_ms: row.4,
                    terminal_cause: StreamAttemptCause::parse(&row.5)
                        .ok_or_else(catalog_corrupt)?,
                    final_text: row.6,
                    chunk_count: row.7,
                    prompt_tokens: row.8,
                    completion_tokens: row.9,
                })
            })
            .transpose()
    }

    pub fn reconcile_stream_transcript_from_attempt(
        &mut self,
        attempt: &PersistedStreamAttempt,
    ) -> SnapbackResult<()> {
        let (Some(function_id), Some(initiator), Some(terminal), Some(settled_at_ms)) = (
            attempt.function_id.clone(),
            attempt.initiator.clone(),
            attempt.terminal.clone(),
            attempt.settled_at_ms,
        ) else {
            return Ok(());
        };
        if !table_exists(&self.conn)? {
            return Ok(());
        }
        self.settle_stream_transcript(&StreamTranscriptRecord {
            attempt_token: attempt.token.clone(),
            function_id,
            initiator,
            started_at_ms: attempt.started_at_ms,
            settled_at_ms,
            terminal_cause: terminal.cause,
            final_text: None,
            chunk_count: attempt.chunk_count,
            prompt_tokens: None,
            completion_tokens: None,
        })
    }
}

fn catalog_corrupt() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_STREAM_TRANSCRIPT_CATALOG_CORRUPT",
        "storage",
        "stream transcript catalog differs from the exact protected shape",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{FunctionDefinition, FunctionRuntime, IbexModule};
    use crate::stream_attempt::{
        PersistedStreamCursor, StreamAttemptSettledBy, StreamAttemptTerminal, StreamInitiationState,
    };
    use std::collections::BTreeMap;

    fn stream_manifest() -> FunctionManifest {
        let mut function = FunctionDefinition::new(
            "conversation",
            FunctionKind::Action,
            FunctionRuntime::IbexModule(IbexModule {
                source: "globalThis.__snapbackHandlers = {};".to_owned(),
                export: "conversation".to_owned(),
            }),
        );
        function.stream = true;
        FunctionManifest {
            functions: vec![function],
            ..FunctionManifest::default()
        }
    }

    #[test]
    fn table_is_gated_by_stream_actions_and_settlement_is_immutable() {
        let mut db = LocalDatabase::memory().expect("stream transcript database");
        db.activate_stream_transcript_manifest(&FunctionManifest::default())
            .expect("empty manifest");
        assert!(!table_exists(&db.conn).unwrap());

        db.activate_stream_transcript_manifest(&stream_manifest())
            .expect("stream manifest activates table");
        let complete = StreamTranscriptRecord {
            attempt_token: "attempt-complete".to_owned(),
            function_id: "app:conversation".to_owned(),
            initiator: StreamInitiator::SessionUser("user-a".to_owned()),
            started_at_ms: 100,
            settled_at_ms: 200,
            terminal_cause: StreamAttemptCause::Complete,
            final_text: Some("final answer".to_owned()),
            chunk_count: 3,
            prompt_tokens: None,
            completion_tokens: None,
        };
        db.settle_stream_transcript(&complete)
            .expect("settle complete");
        assert_eq!(
            db.stream_transcript("attempt-complete").unwrap(),
            Some(complete.clone())
        );

        let mut late = complete.clone();
        late.terminal_cause = StreamAttemptCause::Failed;
        late.final_text = None;
        db.settle_stream_transcript(&late)
            .expect("late settlement returns the winner");
        assert_eq!(
            db.stream_transcript("attempt-complete").unwrap(),
            Some(complete)
        );

        for (token, cause) in [
            ("attempt-failed", StreamAttemptCause::Failed),
            ("attempt-cancelled", StreamAttemptCause::Cancelled),
        ] {
            let record = StreamTranscriptRecord {
                attempt_token: token.to_owned(),
                function_id: "app:conversation".to_owned(),
                initiator: StreamInitiator::ServiceCredential("credential-a".to_owned()),
                started_at_ms: 300,
                settled_at_ms: 400,
                terminal_cause: cause,
                final_text: None,
                chunk_count: 1,
                prompt_tokens: None,
                completion_tokens: None,
            };
            db.settle_stream_transcript(&record).unwrap();
            assert_eq!(db.stream_transcript(token).unwrap(), Some(record));
        }

        db.activate_stream_transcript_manifest(&FunctionManifest::default())
            .expect("removing last stream action drops table");
        assert!(!table_exists(&db.conn).unwrap());
    }

    #[test]
    fn process_death_reconciliation_settles_a_conservative_transcript() {
        let mut db = LocalDatabase::memory().expect("stream transcript database");
        db.activate_stream_transcript_manifest(&stream_manifest())
            .expect("stream manifest activates table");
        let attempt = PersistedStreamAttempt {
            token: "attempt-orphan".to_owned(),
            client_key: "output:orphan".to_owned(),
            runner_generation: 1,
            progress_commits: 0,
            cursors_opened: 1,
            cursors: BTreeMap::from([(
                "cursor".to_owned(),
                PersistedStreamCursor {
                    initiation_state: StreamInitiationState::InitiationPossible,
                    open: true,
                },
            )]),
            terminal: None,
            function_id: Some("app:conversation".to_owned()),
            initiator: Some(StreamInitiator::AnonymousConnection(
                "connection-a".to_owned(),
            )),
            started_at_ms: 100,
            settled_at_ms: None,
            emitted_bytes: 12,
            chunk_count: 2,
        };
        let reconciled = crate::stream_attempt::reconcile_orphaned_record(
            &serde_json::to_string(&attempt).unwrap(),
        )
        .expect("live orphan gains terminal");
        let reconciled: PersistedStreamAttempt = serde_json::from_str(&reconciled).unwrap();
        assert_eq!(
            reconciled.terminal,
            Some(StreamAttemptTerminal {
                cause: StreamAttemptCause::Failed,
                effect_may_have_executed: true,
                settled_by: StreamAttemptSettledBy::Terminalizer,
            })
        );
        db.reconcile_stream_transcript_from_attempt(&reconciled)
            .expect("orphan transcript settles");
        let transcript = db
            .stream_transcript("attempt-orphan")
            .unwrap()
            .expect("reconciled transcript");
        assert_eq!(transcript.terminal_cause, StreamAttemptCause::Failed);
        assert_eq!(transcript.final_text, None);
        assert_eq!(transcript.chunk_count, 2);
        assert_eq!(
            transcript.initiator,
            StreamInitiator::AnonymousConnection("connection-a".to_owned())
        );
    }
}
impl super::ServingDatabase {
    pub fn settle_stream_transcript(
        &mut self,
        record: &StreamTranscriptRecord,
    ) -> SnapbackResult<()> {
        self.db.settle_stream_transcript(record)
    }
    pub fn reconcile_stream_transcript_from_attempt(
        &mut self,
        attempt: &PersistedStreamAttempt,
    ) -> SnapbackResult<()> {
        self.db.reconcile_stream_transcript_from_attempt(attempt)
    }
}
