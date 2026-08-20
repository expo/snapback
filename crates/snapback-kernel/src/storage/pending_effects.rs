//! Durable, approval-gated effect intents for LLP 0204 D9.5.
//!
//! Arguments and authority facts are captured before execution. Approval is
//! only a decision over that frozen intent; the server separately revalidates
//! current authority, generation, exposure, and approval policy before it may
//! execute the ordinary mutation/action path.

use super::{LocalDatabase, SnapbackResult};
use crate::diagnostic::SnapbackError;
use crate::manifest::{ArtifactGeneration, FunctionKind, SchemaManifest};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest as _, Sha256};

pub const PENDING_EFFECT_TABLE: &str = "_snapback_pending_effects";
pub const DEFAULT_TTL_MS: u64 = 24 * 60 * 60 * 1_000;
pub const MAX_TTL_MS: u64 = 7 * DEFAULT_TTL_MS;
pub const ARGS_MAX_BYTES: usize = 256 * 1024;
const AUTHORITY_MAX_BYTES: usize = 64 * 1024;
const PREVIEW_MAX_BYTES: usize = 64 * 1024;
const JOURNAL_MAX_BYTES: usize = 64 * 1024;

const TABLE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS _snapback_pending_effects (
  id TEXT NOT NULL PRIMARY KEY,
  function_id TEXT NOT NULL,
  function_name TEXT NOT NULL,
  function_kind TEXT NOT NULL CHECK(function_kind IN ('mutation', 'action')),
  args_json TEXT NOT NULL CHECK(length(CAST(args_json AS BLOB)) <= 262144),
  args_digest TEXT NOT NULL CHECK(length(args_digest) = 64 AND args_digest NOT GLOB '*[^0-9a-f]*'),
  caller_lane TEXT NOT NULL CHECK(caller_lane IN ('anonymous', 'declared', 'integration', 'link', 'first-party')),
  caller_key TEXT NOT NULL CHECK(length(CAST(caller_key AS BLOB)) BETWEEN 1 AND 512),
  authority_json TEXT NOT NULL CHECK(length(CAST(authority_json AS BLOB)) <= 65536),
  generation_json TEXT NOT NULL CHECK(length(CAST(generation_json AS BLOB)) <= 4096),
  effect_class TEXT NOT NULL CHECK(effect_class IN ('mutation', 'action')),
  link_origin_id TEXT,
  approver_principal_id TEXT,
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms BETWEEN created_at_ms AND 9007199254740991),
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'executed', 'refused', 'expired')),
  approver_identity TEXT,
  preview_kind TEXT NOT NULL CHECK(preview_kind IN ('disclosed', 'dry-run')),
  preview_json TEXT NOT NULL CHECK(length(CAST(preview_json AS BLOB)) <= 65536),
  decided_at_ms INTEGER,
  executed_at_ms INTEGER,
  outcome_code TEXT CHECK(outcome_code IS NULL OR length(CAST(outcome_code AS BLOB)) <= 256),
  journal_json TEXT NOT NULL CHECK(length(CAST(journal_json AS BLOB)) <= 65536)
);
"#;

const APPROVER_INDEX_SQL: &str = r#"
CREATE INDEX IF NOT EXISTS _snapback_pending_effects_approver
  ON _snapback_pending_effects(status, approver_principal_id, expires_at_ms, id);
"#;

const EXPIRY_INDEX_SQL: &str = r#"
CREATE INDEX IF NOT EXISTS _snapback_pending_effects_expiry
  ON _snapback_pending_effects(status, expires_at_ms, id);
"#;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PendingEffectAuthority {
    Anonymous,
    Session {
        user_id: String,
        session_id: String,
        provider: String,
        generation: u64,
        authority_instance_id: String,
        authorization_stream_incarnation: String,
    },
    ServicePrincipal {
        actor_user_id: String,
        credential_id: String,
        credential_generation: u64,
        grant_id: String,
        token_id: String,
        effective_user_id: Option<String>,
        token_expires_at_ms: u64,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PendingEffectStatus {
    Pending,
    Approved,
    Executed,
    Refused,
    Expired,
}

impl PendingEffectStatus {
    fn parse(value: &str) -> SnapbackResult<Self> {
        match value {
            "pending" => Ok(Self::Pending),
            "approved" => Ok(Self::Approved),
            "executed" => Ok(Self::Executed),
            "refused" => Ok(Self::Refused),
            "expired" => Ok(Self::Expired),
            _ => Err(catalog_corrupt()),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingEffectJournalEntry {
    pub at_ms: u64,
    pub transition: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome_code: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingEffectPreview {
    pub kind: String,
    pub args_digest: String,
    pub declared_write_set: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingEffectRecord {
    pub id: String,
    pub function_id: String,
    pub function_name: String,
    pub function_kind: FunctionKind,
    pub args: Value,
    pub args_digest: String,
    pub caller_lane: String,
    pub caller_key: String,
    pub authority: PendingEffectAuthority,
    pub generation: ArtifactGeneration,
    pub effect_class: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_origin_id: Option<String>,
    #[serde(skip_serializing)]
    pub approver_principal_id: Option<String>,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
    pub status: PendingEffectStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approver_identity: Option<String>,
    pub preview: PendingEffectPreview,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decided_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executed_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome_code: Option<String>,
    pub journal: Vec<PendingEffectJournalEntry>,
}

#[derive(Clone, Debug)]
pub struct CreatePendingEffect {
    pub function_id: String,
    pub function_name: String,
    pub function_kind: FunctionKind,
    pub args: Value,
    pub caller_lane: String,
    pub caller_key: String,
    pub authority: PendingEffectAuthority,
    pub generation: ArtifactGeneration,
    pub link_origin_id: Option<String>,
    pub approver_principal_id: Option<String>,
    pub declared_write_set: Vec<String>,
    pub now_ms: u64,
    pub ttl_ms: u64,
}

/// Opaque, database-bound creation command. The request facts remain useful
/// to adapters, but only the kernel commit authority can turn them into a
/// writable transition.
pub struct CreatePendingEffectCommand {
    database_binding: crate::storage::DatabaseBinding,
    request: CreatePendingEffect,
}

pub struct DecidePendingEffectCommand {
    database_binding: crate::storage::DatabaseBinding,
    id: String,
    approver: super::resolved_principal::ResolvedEffectApprover,
    active_function_policies: super::ActiveFunctionPolicies,
    approve: bool,
    step_up: Option<crate::auth::crypto::StepUpProof>,
    now_ms: u64,
}

pub struct SettlePendingEffectCommand {
    database_binding: crate::storage::DatabaseBinding,
    id: String,
    executed: bool,
    outcome_code: Option<String>,
    now_ms: u64,
}

pub struct RefusePendingEffectCommand {
    database_binding: crate::storage::DatabaseBinding,
    id: String,
    outcome_code: String,
    now_ms: u64,
}

impl crate::storage::KernelCommitAuthority {
    pub fn admit_pending_effect_creation(
        &self,
        request: CreatePendingEffect,
    ) -> CreatePendingEffectCommand {
        CreatePendingEffectCommand {
            database_binding: self.binding(),
            request,
        }
    }

    pub fn admit_pending_effect_decision(
        &self,
        id: &str,
        approver: &super::ResolvedPrincipal,
        active_function_policies: super::ActiveFunctionPolicies,
        approve: bool,
        step_up: Option<&crate::auth::crypto::StepUpProof>,
        now_ms: u64,
    ) -> SnapbackResult<DecidePendingEffectCommand> {
        let approver = approver.effect_approver()?;
        if !approver.database_binding.matches(&self.binding) {
            return Err(SnapbackError::error(
                "SNAPBACK_EFFECT_AUTHORITY_INVALID",
                "effects",
                "the resolved approver belongs to a different database",
            ));
        }
        Ok(DecidePendingEffectCommand {
            database_binding: self.binding(),
            id: id.to_owned(),
            approver,
            active_function_policies,
            approve,
            step_up: step_up.cloned(),
            now_ms,
        })
    }

    pub fn admit_pending_effect_settlement(
        &self,
        id: &str,
        executed: bool,
        outcome_code: Option<&str>,
        now_ms: u64,
    ) -> SettlePendingEffectCommand {
        SettlePendingEffectCommand {
            database_binding: self.binding(),
            id: id.to_owned(),
            executed,
            outcome_code: outcome_code.map(str::to_owned),
            now_ms,
        }
    }

    pub fn admit_pending_effect_refusal(
        &self,
        id: &str,
        outcome_code: &str,
        now_ms: u64,
    ) -> RefusePendingEffectCommand {
        RefusePendingEffectCommand {
            database_binding: self.binding(),
            id: id.to_owned(),
            outcome_code: outcome_code.to_owned(),
            now_ms,
        }
    }
}

fn verify_command_identity(
    actual: &crate::storage::DatabaseBinding,
    expected: &crate::storage::DatabaseBinding,
) -> SnapbackResult<()> {
    if actual.matches(expected) {
        Ok(())
    } else {
        Err(SnapbackError::error(
            "SNAPBACK_EFFECT_AUTHORITY_INVALID",
            "effects",
            "pending-effect command belongs to a different database",
        ))
    }
}

pub fn manifest_enabled(manifest: &SchemaManifest) -> bool {
    manifest.api.as_ref().is_some_and(|api| api.enabled)
}

// @ref LLP 0204#d95--approval-gated-effects — this sibling table exists only
// while the external API declaration is activated.
pub(crate) fn activate_manifest_in(
    tx: &Transaction<'_>,
    manifest: &SchemaManifest,
) -> SnapbackResult<()> {
    if !manifest_enabled(manifest) {
        tx.execute_batch("DROP TABLE IF EXISTS _snapback_pending_effects;")?;
        return Ok(());
    }
    tx.execute_batch(TABLE_SQL)?;
    tx.execute_batch(APPROVER_INDEX_SQL)?;
    tx.execute_batch(EXPIRY_INDEX_SQL)?;
    validate_exact_schema(tx)
}

pub(super) fn validate_exact_schema(conn: &Connection) -> SnapbackResult<()> {
    let reference = Connection::open_in_memory()?;
    reference.execute_batch(TABLE_SQL)?;
    reference.execute_batch(APPROVER_INDEX_SQL)?;
    reference.execute_batch(EXPIRY_INDEX_SQL)?;
    if catalog_objects(conn)? != catalog_objects(&reference)? {
        return Err(catalog_corrupt());
    }
    Ok(())
}

fn catalog_objects(conn: &Connection) -> SnapbackResult<Vec<(String, String, String, String)>> {
    let mut statement = conn.prepare(
        "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_schema
         WHERE name = '_snapback_pending_effects'
            OR tbl_name = '_snapback_pending_effects'
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
            "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1",
            params![PENDING_EFFECT_TABLE],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn function_kind_name(kind: &FunctionKind) -> SnapbackResult<&'static str> {
    match kind {
        FunctionKind::Mutation => Ok("mutation"),
        FunctionKind::Action => Ok("action"),
        FunctionKind::Query | FunctionKind::LiveQuery => Err(input_invalid(
            "approval intents may name only mutations or actions",
        )),
    }
}

fn parse_function_kind(value: &str) -> SnapbackResult<FunctionKind> {
    match value {
        "mutation" => Ok(FunctionKind::Mutation),
        "action" => Ok(FunctionKind::Action),
        _ => Err(catalog_corrupt()),
    }
}

fn args_digest(args_json: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"snapback:pending-effect-args:v1\n");
    hasher.update(args_json.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn read_record(conn: &Connection, id: &str) -> SnapbackResult<Option<PendingEffectRecord>> {
    let raw = conn
        .query_row(
            "SELECT id, function_id, function_name, function_kind, args_json,
                    args_digest, caller_lane, caller_key, authority_json,
                    generation_json, effect_class, link_origin_id,
                    approver_principal_id, created_at_ms, expires_at_ms, status,
                    approver_identity, preview_kind, preview_json, decided_at_ms,
                    executed_at_ms, outcome_code, journal_json
             FROM _snapback_pending_effects WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, Option<String>>(12)?,
                    row.get::<_, i64>(13)?,
                    row.get::<_, i64>(14)?,
                    row.get::<_, String>(15)?,
                    row.get::<_, Option<String>>(16)?,
                    row.get::<_, String>(17)?,
                    row.get::<_, String>(18)?,
                    row.get::<_, Option<i64>>(19)?,
                    row.get::<_, Option<i64>>(20)?,
                    row.get::<_, Option<String>>(21)?,
                    row.get::<_, String>(22)?,
                ))
            },
        )
        .optional()?;
    raw.map(|row| {
        let args = serde_json::from_str(&row.4).map_err(|_| catalog_corrupt())?;
        if args_digest(&row.4) != row.5 || row.10 != row.3 {
            return Err(catalog_corrupt());
        }
        let preview: PendingEffectPreview =
            serde_json::from_str(&row.18).map_err(|_| catalog_corrupt())?;
        if preview.kind != row.17 || preview.args_digest != row.5 {
            return Err(catalog_corrupt());
        }
        Ok(PendingEffectRecord {
            id: row.0,
            function_id: row.1,
            function_name: row.2,
            function_kind: parse_function_kind(&row.3)?,
            args,
            args_digest: row.5,
            caller_lane: row.6,
            caller_key: row.7,
            authority: serde_json::from_str(&row.8).map_err(|_| catalog_corrupt())?,
            generation: serde_json::from_str(&row.9).map_err(|_| catalog_corrupt())?,
            effect_class: row.10,
            link_origin_id: row.11,
            approver_principal_id: row.12,
            created_at_ms: row.13 as u64,
            expires_at_ms: row.14 as u64,
            status: PendingEffectStatus::parse(&row.15)?,
            approver_identity: row.16,
            preview,
            decided_at_ms: row.19.map(|value| value as u64),
            executed_at_ms: row.20.map(|value| value as u64),
            outcome_code: row.21,
            journal: serde_json::from_str(&row.22).map_err(|_| catalog_corrupt())?,
        })
    })
    .transpose()
}

fn append_transition(
    tx: &Transaction<'_>,
    id: &str,
    entry: PendingEffectJournalEntry,
) -> SnapbackResult<()> {
    let journal_json: String = tx.query_row(
        "SELECT journal_json FROM _snapback_pending_effects WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    let mut journal = serde_json::from_str::<Vec<PendingEffectJournalEntry>>(&journal_json)
        .map_err(|_| catalog_corrupt())?;
    journal.push(entry);
    let next = serde_json::to_string(&journal).map_err(|_| catalog_corrupt())?;
    if next.len() > JOURNAL_MAX_BYTES {
        return Err(catalog_corrupt());
    }
    tx.execute(
        "UPDATE _snapback_pending_effects SET journal_json = ?1 WHERE id = ?2",
        params![next, id],
    )?;
    Ok(())
}

fn lazy_expire(tx: &Transaction<'_>, id: Option<&str>, now_ms: u64) -> SnapbackResult<()> {
    let mut statement = tx.prepare(
        "SELECT id FROM _snapback_pending_effects
         WHERE status = 'pending' AND expires_at_ms <= ?1
           AND (?2 IS NULL OR id = ?2)",
    )?;
    let ids = statement
        .query_map(params![now_ms as i64, id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    for id in ids {
        tx.execute(
            "UPDATE _snapback_pending_effects
             SET status = 'expired', decided_at_ms = ?1, outcome_code = 'SNAPBACK_EFFECT_EXPIRED'
             WHERE id = ?2 AND status = 'pending'",
            params![now_ms as i64, id],
        )?;
        append_transition(
            tx,
            &id,
            PendingEffectJournalEntry {
                at_ms: now_ms,
                transition: "expired".to_owned(),
                actor: None,
                outcome_code: Some("SNAPBACK_EFFECT_EXPIRED".to_owned()),
            },
        )?;
    }
    Ok(())
}

impl LocalDatabase {
    pub fn create_pending_effect(
        &mut self,
        command: CreatePendingEffectCommand,
    ) -> SnapbackResult<PendingEffectRecord> {
        verify_command_identity(&command.database_binding, &self.binding())?;
        let request = command.request;
        if !table_exists(&self.conn)? {
            return Err(input_invalid("approval-gated effects require api.enabled"));
        }
        let kind = function_kind_name(&request.function_kind)?;
        if request.ttl_ms == 0 || request.ttl_ms > MAX_TTL_MS {
            return Err(input_invalid("effect approval ttl must be within 1ms..=7d"));
        }
        let args_json = serde_json::to_string(&request.args)
            .map_err(|_| input_invalid("effect arguments do not serialize"))?;
        if args_json.len() > ARGS_MAX_BYTES {
            return Err(input_invalid("effect arguments exceed the 256 KiB bound"));
        }
        let digest = args_digest(&args_json);
        let authority_json = serde_json::to_string(&request.authority)
            .map_err(|_| input_invalid("effect authority does not serialize"))?;
        let generation_json = serde_json::to_string(&request.generation)
            .map_err(|_| input_invalid("effect generation does not serialize"))?;
        if authority_json.len() > AUTHORITY_MAX_BYTES || generation_json.len() > 4096 {
            return Err(input_invalid(
                "effect authority or generation exceeds its bound",
            ));
        }
        let mut write_set = request.declared_write_set;
        write_set.sort();
        write_set.dedup();
        let preview = PendingEffectPreview {
            kind: "disclosed".to_owned(),
            args_digest: digest.clone(),
            declared_write_set: write_set,
        };
        let preview_json = serde_json::to_string(&preview).map_err(|_| catalog_corrupt())?;
        if preview_json.len() > PREVIEW_MAX_BYTES {
            return Err(input_invalid("effect disclosure preview exceeds its bound"));
        }
        let expires_at_ms = request
            .now_ms
            .checked_add(request.ttl_ms)
            .ok_or_else(|| input_invalid("effect approval expiry overflows"))?;
        let id = crate::ids::mint_time_ordered(crate::ids::Kind::PendingEffect);
        let journal = vec![PendingEffectJournalEntry {
            at_ms: request.now_ms,
            transition: "created".to_owned(),
            actor: Some(request.caller_key.clone()),
            outcome_code: Some("SNAPBACK_EFFECT_APPROVAL_PENDING".to_owned()),
        }];
        let journal_json = serde_json::to_string(&journal).map_err(|_| catalog_corrupt())?;
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _snapback_pending_effects(
                   id, function_id, function_name, function_kind, args_json,
                   args_digest, caller_lane, caller_key, authority_json,
                   generation_json, effect_class, link_origin_id,
                   approver_principal_id, created_at_ms, expires_at_ms, status,
                   preview_kind, preview_json, journal_json
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?4,
                          ?11, ?12, ?13, ?14, 'pending', 'disclosed', ?15, ?16)",
                params![
                    id,
                    request.function_id,
                    request.function_name,
                    kind,
                    args_json,
                    digest,
                    request.caller_lane,
                    request.caller_key,
                    authority_json,
                    generation_json,
                    request.link_origin_id,
                    request.approver_principal_id,
                    request.now_ms as i64,
                    expires_at_ms as i64,
                    preview_json,
                    journal_json,
                ],
            )?;
            Ok(())
        })?;
        read_record(&self.conn, &id)?.ok_or_else(catalog_corrupt)
    }

    pub fn pending_effect(&mut self, id: &str, now_ms: u64) -> SnapbackResult<PendingEffectRecord> {
        if !table_exists(&self.conn)? {
            return Err(not_found());
        }
        self.with_auth_transaction(|tx| lazy_expire(tx, Some(id), now_ms))?;
        read_record(&self.conn, id)?.ok_or_else(not_found)
    }

    pub fn pending_effects_for_approver(
        &mut self,
        principal_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<Vec<PendingEffectRecord>> {
        if !table_exists(&self.conn)? {
            return Ok(Vec::new());
        }
        self.with_auth_transaction(|tx| lazy_expire(tx, None, now_ms))?;
        let mut statement = self.conn.prepare(
            "SELECT id FROM _snapback_pending_effects
             WHERE status = 'pending'
               AND (approver_principal_id IS NULL OR approver_principal_id = ?1)
             ORDER BY created_at_ms, id LIMIT 256",
        )?;
        let ids = statement
            .query_map(params![principal_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids.into_iter()
            .map(|id| read_record(&self.conn, &id)?.ok_or_else(catalog_corrupt))
            .collect()
    }

    pub fn decide_pending_effect(
        &mut self,
        command: DecidePendingEffectCommand,
    ) -> SnapbackResult<PendingEffectRecord> {
        verify_command_identity(&command.database_binding, &self.binding())?;
        let DecidePendingEffectCommand {
            id,
            approver,
            active_function_policies,
            approve,
            step_up,
            now_ms,
            ..
        } = command;
        let database_binding = self.binding();
        self.with_auth_transaction(|tx| {
            // @ref LLP 0059#durable-session-clock-floor — approval time is the
            // transaction-local durable high-water, never a rewindable caller
            // sample. Expiry, proof consumption, decision, and journal share it.
            let effective_now_ms = super::auth::advance_session_clock_floor_on(tx, now_ms)?;
            lazy_expire(tx, Some(&id), effective_now_ms)?;
            let current = read_record(tx, &id)?.ok_or_else(not_found)?;
            if current.status == PendingEffectStatus::Expired {
                return Err(expired());
            }
            if current.status != PendingEffectStatus::Pending {
                return Err(state_invalid());
            }
            let approver_principal_id = super::resolved_principal::revalidate_effect_approver_on(
                tx,
                &approver,
                &database_binding,
                effective_now_ms,
            )?;
            if current
                .approver_principal_id
                .as_deref()
                .is_some_and(|expected| expected != approver_principal_id)
            {
                return Err(approval_denied());
            }
            // `with_auth_transaction` holds BEGIN IMMEDIATE here. Re-derive
            // policy after reading the effect and consume any proof before the
            // decision UPDATE, so policy activation cannot race verification
            // and commit.
            let requires_step_up = if approve {
                let canonical = active_function_policies
                    .get(&current.function_id)
                    .filter(|policy| policy.kind == current.function_kind)
                    .ok_or_else(binding_stale)?;
                let projected = super::auth_scope_bases::current_authority_creating_on(
                    tx,
                    &current.function_id,
                    &current.function_kind,
                )?
                .ok_or_else(binding_stale)?;
                if projected != canonical.authority_creating {
                    return Err(binding_stale());
                }
                canonical.authority_creating
            } else {
                false
            };
            if requires_step_up {
                let proof = step_up
                    .as_ref()
                    .ok_or_else(crate::auth::crypto::step_up_required_error)?;
                if super::auth_catalog_ops::consume_step_up_proof_on(tx, proof, effective_now_ms)?
                    != crate::auth::crypto::StepUpConsumption::Verified
                {
                    return Err(crate::auth::crypto::step_up_required_error());
                }
            }
            let status = if approve { "approved" } else { "refused" };
            let outcome = if approve {
                None
            } else {
                Some("SNAPBACK_EFFECT_APPROVAL_DENIED")
            };
            let changed = tx.execute(
                "UPDATE _snapback_pending_effects
                 SET status = ?1, approver_identity = ?2, decided_at_ms = ?3,
                     outcome_code = ?4
                 WHERE id = ?5 AND status = 'pending'",
                params![
                    status,
                    approver_principal_id,
                    effective_now_ms as i64,
                    outcome,
                    id
                ],
            )?;
            if changed != 1 {
                return Err(state_invalid());
            }
            append_transition(
                tx,
                &id,
                PendingEffectJournalEntry {
                    at_ms: effective_now_ms,
                    transition: status.to_owned(),
                    actor: Some(approver_principal_id.to_owned()),
                    outcome_code: outcome.map(str::to_owned),
                },
            )
        })?;
        read_record(&self.conn, &id)?.ok_or_else(catalog_corrupt)
    }

    pub fn settle_pending_effect(
        &mut self,
        command: SettlePendingEffectCommand,
    ) -> SnapbackResult<PendingEffectRecord> {
        verify_command_identity(&command.database_binding, &self.binding())?;
        let SettlePendingEffectCommand {
            id,
            executed,
            outcome_code,
            now_ms,
            ..
        } = command;
        let status = if executed { "executed" } else { "refused" };
        self.with_auth_transaction(|tx| {
            let changed = tx.execute(
                "UPDATE _snapback_pending_effects
                 SET status = ?1, executed_at_ms = ?2, outcome_code = ?3
                 WHERE id = ?4 AND status = 'approved'",
                params![status, now_ms as i64, outcome_code, id],
            )?;
            if changed != 1 {
                return Err(state_invalid());
            }
            append_transition(
                tx,
                &id,
                PendingEffectJournalEntry {
                    at_ms: now_ms,
                    transition: status.to_owned(),
                    actor: None,
                    outcome_code: outcome_code.clone(),
                },
            )
        })?;
        read_record(&self.conn, &id)?.ok_or_else(catalog_corrupt)
    }

    pub fn refuse_pending_effect(
        &mut self,
        command: RefusePendingEffectCommand,
    ) -> SnapbackResult<()> {
        verify_command_identity(&command.database_binding, &self.binding())?;
        let RefusePendingEffectCommand {
            id,
            outcome_code,
            now_ms,
            ..
        } = command;
        self.with_auth_transaction(|tx| {
            let changed = tx.execute(
                "UPDATE _snapback_pending_effects
                 SET status = 'refused', decided_at_ms = COALESCE(decided_at_ms, ?1),
                     outcome_code = ?2
                 WHERE id = ?3 AND status IN ('pending', 'approved')",
                params![now_ms as i64, outcome_code, id],
            )?;
            if changed == 1 {
                append_transition(
                    tx,
                    &id,
                    PendingEffectJournalEntry {
                        at_ms: now_ms,
                        transition: "refused".to_owned(),
                        actor: None,
                        outcome_code: Some(outcome_code.to_owned()),
                    },
                )?;
            }
            Ok(())
        })
    }
}

fn input_invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error("SNAPBACK_EFFECT_INPUT_INVALID", "effects", message)
}

fn not_found() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_EFFECT_NOT_FOUND",
        "effects",
        "the pending effect does not exist",
    )
}

fn approval_denied() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_EFFECT_APPROVAL_DENIED",
        "effects",
        "the current session is not this effect's approver",
    )
}

fn state_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_EFFECT_STATE_INVALID",
        "effects",
        "the pending effect is no longer awaiting this transition",
    )
}

fn expired() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_EFFECT_EXPIRED",
        "effects",
        "the pending effect expired before approval",
    )
}

fn binding_stale() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_EFFECT_BINDING_STALE",
        "effects",
        "the pending effect's durable function policy is absent or no longer active",
    )
}

fn catalog_corrupt() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_EFFECT_CATALOG_CORRUPT",
        "effects",
        "the pending-effect catalog does not match its exact protected shape",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{
        FunctionDefinition, FunctionManifest, FunctionRuntime, HandlerPlan, QueryPlan,
    };
    use crate::storage::{ResolvedPrincipal, ServingDatabase};

    fn ready() -> ServingDatabase {
        let mut db = LocalDatabase::memory().expect("pending-effect database");
        db.activate_current_auth_catalog()
            .expect("activate protected catalog");
        db.conn.execute_batch(TABLE_SQL).unwrap();
        db.conn.execute_batch(APPROVER_INDEX_SQL).unwrap();
        db.conn.execute_batch(EXPIRY_INDEX_SQL).unwrap();
        db.conn
            .execute(
                "INSERT INTO _auth_scope_bases(
                   function_id, kind, generation, present, authority_creating
                 ) VALUES('fn:write', 'mutation', 1, 1, 0)",
                [],
            )
            .expect("durable function policy");
        insert_session_on(&mut db, "human-a", 0xa0);
        insert_session_on(&mut db, "human-b", 0xb0);
        let mut serving = ServingDatabase::adopt(db).expect("serving database");
        install_loaded_policy(&mut serving, false);
        serving
    }

    fn request(now_ms: u64, ttl_ms: u64) -> CreatePendingEffect {
        CreatePendingEffect {
            function_id: "fn:write".to_owned(),
            function_name: "write".to_owned(),
            function_kind: FunctionKind::Mutation,
            args: serde_json::json!({ "title": "bounded" }),
            caller_lane: "integration".to_owned(),
            caller_key: "intg_test".to_owned(),
            authority: PendingEffectAuthority::Anonymous,
            generation: ArtifactGeneration {
                schema_version: "snapback.v1".to_owned(),
                app_id: "app".to_owned(),
                schema_hash: "schema".to_owned(),
                bundle_hash: "bundle".to_owned(),
                inputs_hash: "inputs".to_owned(),
            },
            link_origin_id: None,
            approver_principal_id: Some("human-a".to_owned()),
            declared_write_set: vec!["todos".to_owned(), "todos".to_owned()],
            now_ms,
            ttl_ms,
        }
    }

    fn policy_manifest(authority_creating: bool) -> FunctionManifest {
        let mut function = FunctionDefinition::new(
            "write",
            FunctionKind::Mutation,
            FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
                table_visibility: None,
                table: "todos".to_owned(),
                filters: Vec::new(),
                order: Vec::new(),
                limit: None,
                membership_filters: Vec::new(),
                indexed_by: None,
            })),
        );
        function.id = "fn:write".to_owned();
        function.authority_creating = authority_creating;
        FunctionManifest {
            functions: vec![function],
            ..FunctionManifest::default()
        }
    }

    fn insert_session_on(db: &mut LocalDatabase, principal: &str, token_byte: u8) {
        db.auth_catalog()
            .insert_email_session_for_test(
                principal,
                &format!("identity-{principal}"),
                &format!("session-{principal}"),
                &format!("authority-{principal}"),
                &format!("{principal}@example.com"),
                &[token_byte; 32],
                1,
                1,
                1_000,
                2_000,
            )
            .expect("durable approver session");
    }

    fn insert_session(db: &mut ServingDatabase, principal: &str, token_byte: u8) {
        insert_session_on(db.auth_database_mut(), principal, token_byte);
    }

    fn install_loaded_policy(db: &mut ServingDatabase, authority_creating: bool) {
        let manifest = policy_manifest(authority_creating);
        db.auth_database_mut()
            .reconcile_auth_scope_bases(&manifest)
            .expect("install durable function policy projection");
        db.active_function_policies = crate::storage::active_function_policies(&manifest)
            .expect("install canonical process-loaded function policy");
    }

    fn principal(db: &mut ServingDatabase, principal: &str, token_byte: u8) -> ResolvedPrincipal {
        let resolved = db
            .resolve_principal_from_session(
                &crate::contract_types::TokenDigest::from_bytes([token_byte; 32]),
                10,
            )
            .expect("live durable approver principal");
        assert_eq!(resolved.principal_id(), principal);
        resolved
    }

    #[test]
    fn disclosed_intent_is_bounded_and_journals_approve_execute() {
        let mut db = ready();
        let created = db
            .create_pending_effect_admitted(request(10, DEFAULT_TTL_MS))
            .unwrap();
        assert!(created.id.starts_with("pfx_"));
        assert_eq!(created.status, PendingEffectStatus::Pending);
        assert_eq!(created.preview.kind, "disclosed");
        assert_eq!(created.preview.declared_write_set, ["todos"]);
        assert_eq!(created.preview.args_digest, created.args_digest);
        assert_eq!(created.journal[0].transition, "created");

        let approver = principal(&mut db, "human-a", 0xa0);
        let approved = db
            .decide_pending_effect_admitted(&created.id, &approver, true, None, 20)
            .unwrap();
        assert_eq!(approved.status, PendingEffectStatus::Approved);
        let executed = db
            .settle_pending_effect_admitted(&created.id, true, Some("ok"), 21)
            .unwrap();
        assert_eq!(executed.status, PendingEffectStatus::Executed);
        assert_eq!(
            executed
                .journal
                .iter()
                .map(|entry| entry.transition.as_str())
                .collect::<Vec<_>>(),
            ["created", "approved", "executed"],
        );
    }

    #[test]
    fn approver_deny_and_lazy_expiry_are_closed_transitions() {
        let mut db = ready();
        let denied = db.create_pending_effect_admitted(request(10, 100)).unwrap();
        let human_b = principal(&mut db, "human-b", 0xb0);
        assert_eq!(
            db.decide_pending_effect_admitted(&denied.id, &human_b, false, None, 20)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_EFFECT_APPROVAL_DENIED",
        );
        let human_a = principal(&mut db, "human-a", 0xa0);
        let refused = db
            .decide_pending_effect_admitted(&denied.id, &human_a, false, None, 20)
            .unwrap();
        assert_eq!(refused.status, PendingEffectStatus::Refused);

        let expiring = db.create_pending_effect_admitted(request(30, 1)).unwrap();
        let expired = db.pending_effect(&expiring.id, 31).unwrap();
        assert_eq!(expired.status, PendingEffectStatus::Expired);
        assert_eq!(expired.journal.last().unwrap().transition, "expired");
        assert_eq!(
            db.decide_pending_effect_admitted(&expiring.id, &human_a, true, None, 32)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_EFFECT_EXPIRED",
        );
    }

    #[test]
    fn approval_rederives_step_up_from_durable_policy_inside_the_transaction() {
        let mut db = ready();
        let created = db
            .create_pending_effect_admitted(request(10, DEFAULT_TTL_MS))
            .unwrap();
        install_loaded_policy(&mut db, true);
        db.auth_database_mut()
            .conn
            .execute(
                "UPDATE _auth_scope_bases
                 SET authority_creating = 1
                 WHERE function_id = 'fn:write'",
                [],
            )
            .expect("durable policy changes before decision");

        let approver = principal(&mut db, "human-a", 0xa0);
        let error = db
            .decide_pending_effect_admitted(&created.id, &approver, true, None, 20)
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_STEP_UP_REQUIRED");
        assert_eq!(
            db.pending_effect(&created.id, 20).unwrap().status,
            PendingEffectStatus::Pending,
        );
    }

    #[test]
    fn public_scope_reconciliation_cannot_downgrade_the_loaded_function_policy() {
        let mut db = ready();
        install_loaded_policy(&mut db, true);
        let created = db
            .create_pending_effect_admitted(request(10, DEFAULT_TTL_MS))
            .unwrap();

        db.auth_database_mut()
            .reconcile_auth_scope_bases(&policy_manifest(false))
            .expect("attacker rewrites the public durable projection");
        let approver = principal(&mut db, "human-a", 0xa0);
        let error = db
            .decide_pending_effect_admitted(&created.id, &approver, true, None, 20)
            .expect_err("the caller-written projection cannot bypass step-up");
        assert_eq!(error.diagnostic.code, "SNAPBACK_EFFECT_BINDING_STALE");
        assert_eq!(
            db.pending_effect(&created.id, 20).unwrap().status,
            PendingEffectStatus::Pending,
        );

        db.auth_database_mut()
            .reconcile_auth_scope_bases(&policy_manifest(true))
            .expect("restore the canonical projection value");
        db.generation_commit_ops()
            .commit_function_generation(crate::storage::CommitFunctionGeneration {
                manifest: policy_manifest(false),
                trusted_active_generation: false,
                projection_publications: Vec::new(),
            })
            .expect("caller can commit durable generation metadata but not publish loaded policy");
        let error = db
            .decide_pending_effect_admitted(&created.id, &approver, true, None, 20)
            .expect_err("canonical authority-creating policy still requires proof");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_STEP_UP_REQUIRED");
    }

    #[test]
    fn decision_cannot_attribute_mallorys_approval_to_alice() {
        let mut db = ready();
        insert_session(&mut db, "alice", 0xa1);
        insert_session(&mut db, "mallory", 0xb2);
        let mallory_digest = crate::contract_types::TokenDigest::from_bytes([0xb2; 32]);
        let mallory = db
            .resolve_principal_from_session(&mallory_digest, 10)
            .expect("Mallory has only Mallory's live durable principal");
        assert_eq!(mallory.principal_id(), "mallory");
        let mut assigned = request(10, DEFAULT_TTL_MS);
        assigned.approver_principal_id = Some("alice".to_owned());
        let created = db.create_pending_effect_admitted(assigned).unwrap();

        let error = db
            .decide_pending_effect_admitted(&created.id, &mallory, true, None, 20)
            .expect_err("Mallory cannot submit Alice's identifier as approval authority");
        assert_eq!(error.diagnostic.code, "SNAPBACK_EFFECT_APPROVAL_DENIED");
        assert_eq!(
            db.pending_effect(&created.id, 20).unwrap().status,
            PendingEffectStatus::Pending,
        );
    }

    #[test]
    fn decision_cannot_rewind_below_the_durable_clock_floor() {
        let mut db = ready();
        let created = db.create_pending_effect_admitted(request(10, 10)).unwrap();
        db.auth_database_mut()
            .advance_auth_session_clock_floor(21)
            .expect("authoritative clock passes effect expiry");

        let approver = principal(&mut db, "human-a", 0xa0);
        let error = db
            .decide_pending_effect_admitted(&created.id, &approver, true, None, 19)
            .expect_err("a backdated decision cannot revive an expired effect");
        assert_eq!(error.diagnostic.code, "SNAPBACK_EFFECT_EXPIRED");
        let expired = db.pending_effect(&created.id, 21).unwrap();
        assert_eq!(expired.status, PendingEffectStatus::Expired);
        assert_eq!(expired.journal.last().unwrap().at_ms, 21);
    }

    #[test]
    fn exact_catalog_rejects_unrecognized_shape() {
        let mut db = ready();
        validate_exact_schema(&db.auth_database_mut().conn).unwrap();
        db.auth_database_mut()
            .conn
            .execute_batch(
                "CREATE INDEX _snapback_pending_effects_unrecognized
             ON _snapback_pending_effects(function_name);",
            )
            .unwrap();
        assert_eq!(
            validate_exact_schema(&db.auth_database_mut().conn)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_EFFECT_CATALOG_CORRUPT",
        );
    }
}
impl super::ServingDatabase {
    pub fn pending_effect(&mut self, id: &str, now_ms: u64) -> SnapbackResult<PendingEffectRecord> {
        self.db.pending_effect(id, now_ms)
    }
    pub fn pending_effects_for_approver(
        &mut self,
        principal_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<Vec<PendingEffectRecord>> {
        self.db.pending_effects_for_approver(principal_id, now_ms)
    }
}
