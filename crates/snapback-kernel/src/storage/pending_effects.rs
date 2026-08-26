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
    caller_lane: String,
    caller_key: String,
    authority: PendingEffectAuthority,
    pub generation: ArtifactGeneration,
    pub effect_class: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_origin_id: Option<String>,
    #[serde(skip_serializing)]
    approver_principal_id: Option<String>,
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
    /// Present only on the exact row loaded for one admitted approval. This
    /// does not serialize or persist; it prevents a list/read DTO (or a row
    /// loaded from another database) from becoming attribution authority.
    #[serde(skip)]
    caller_attribution_binding: Option<PendingEffectCallerAttributionBinding>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PendingEffectCallerAttributionBinding {
    database_binding: crate::storage::DatabaseBinding,
    approver_principal_id: String,
}

impl PendingEffectRecord {
    pub fn caller_lane(&self) -> &str {
        &self.caller_lane
    }

    pub fn caller_key(&self) -> &str {
        &self.caller_key
    }

    pub fn authority(&self) -> &PendingEffectAuthority {
        &self.authority
    }

    pub fn approver_principal_id(&self) -> Option<&str> {
        self.approver_principal_id.as_deref()
    }

    /// Return the producing database only when `approver_principal_id` is the
    /// approver retained by the same prepared-approval carrier as this row.
    /// Ordinary pending-effect read DTOs deliberately return `None`.
    pub fn caller_attribution_database_binding(
        &self,
        approver_principal_id: &str,
    ) -> Option<&crate::storage::DatabaseBinding> {
        self.caller_attribution_binding
            .as_ref()
            .filter(|binding| binding.approver_principal_id == approver_principal_id)
            .map(|binding| &binding.database_binding)
    }
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

/// Untrusted evidence from which the pending-effect transaction derives its
/// exact owner.  The variants are deliberately public: presenting a durable
/// identity selector is not authority.  Only a successful lookup against this
/// database produces [`PendingEffectOwner`].
///
/// @ref LLP 0292#42-authority-flow — admission accepts evidence and the exact
/// operation selector; the canonical store alone creates verified authority.
pub enum PendingEffectOwnerEvidence {
    Anonymous,
    Session {
        bearer: crate::auth::crypto::SessionBearer,
        authorization_stream_incarnation: String,
    },
    ServicePrincipal(crate::auth::crypto::ScopedToken),
}

/// Exact owner derived by one serving database.  It is non-cloneable, has no
/// public constructor, and is invalid in a child process after `fork()`.
/// Every pending-effect transition consumes or borrows this same carrier.
///
/// @ref LLP 0303#the-governing-principle — durable effect authority is derived
/// from canonical state instead of accepted beside the effect subject.
/// @ref LLP 0303#t-allocation-identity-fails-open-across-fork-and-the-ruling-belongs-here —
/// inherited allocation identities fail closed outside their creator process.
pub struct PendingEffectOwner {
    database_binding: crate::storage::DatabaseBinding,
    authority: PendingEffectAuthority,
    principal_id: Option<String>,
    creator_process_id: u32,
}

impl std::fmt::Debug for PendingEffectOwner {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("PendingEffectOwner(..)")
    }
}

impl PendingEffectOwner {
    pub(super) fn verify_for(
        &self,
        database_binding: &crate::storage::DatabaseBinding,
    ) -> SnapbackResult<()> {
        if self.creator_process_id != std::process::id() {
            return Err(owner_invalid(
                "pending-effect owner was inherited from another process",
            ));
        }
        verify_command_identity(&self.database_binding, database_binding)
    }

    pub(super) fn require_session_principal(&self) -> SnapbackResult<&str> {
        self.principal_id.as_deref().ok_or_else(|| {
            owner_invalid("pending-effect management requires a durably resolved session owner")
        })
    }
}

/// Opaque, database-bound creation command. The request facts remain useful
/// to adapters, but only the kernel commit authority can turn them into a
/// writable transition.
pub struct CreatePendingEffectCommand {
    database_binding: crate::storage::DatabaseBinding,
    request: CreatePendingEffect,
}

/// Exact durable pending row admitted for approval by its derived session
/// principal. At this boundary the stored original-authority views are
/// borrowed from the carrier rather than supplied as independent coordinates.
///
/// @ref LLP 0303#the-governing-principle — the approval subject and stored
/// original authority are derived from one exact durable effect row.
#[derive(Clone)]
pub struct PreparedPendingEffectApproval {
    database_binding: crate::storage::DatabaseBinding,
    record: PendingEffectRecord,
    approver_principal_id: String,
}

impl std::fmt::Debug for PreparedPendingEffectApproval {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("PreparedPendingEffectApproval(..)")
    }
}

/// Borrowed session coordinates retained by one database-produced approval.
/// The consumer must verify the opaque database binding before reconstruction.
///
/// @ref LLP 0303#corollary--the-artifact-must-carry-provenance-not-just-type —
/// the borrow cannot be composed with an independent database's live session.
pub struct RetainedEffectSessionAuthority<'a> {
    database_binding: crate::storage::DatabaseBinding,
    authorization_stream_incarnation: &'a str,
    session_id: &'a str,
    user_id: &'a str,
    provider: &'a str,
    generation: u64,
    authority_instance_id: &'a str,
}

impl RetainedEffectSessionAuthority<'_> {
    pub fn belongs_to_database(&self, database_binding: &crate::storage::DatabaseBinding) -> bool {
        self.database_binding.matches(database_binding)
    }

    pub fn authorization_stream_incarnation(&self) -> &str {
        self.authorization_stream_incarnation
    }

    pub fn session_id(&self) -> &str {
        self.session_id
    }

    pub fn user_id(&self) -> &str {
        self.user_id
    }

    pub fn provider(&self) -> &str {
        self.provider
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn authority_instance_id(&self) -> &str {
        self.authority_instance_id
    }
}

/// Borrowed service coordinates retained by one database-produced approval.
/// The consumer must verify the opaque database binding before resolution.
///
/// @ref LLP 0303#corollary--the-artifact-must-carry-provenance-not-just-type —
/// the borrow cannot be composed with an independent database's live token.
pub struct RetainedEffectServiceAuthority<'a> {
    database_binding: crate::storage::DatabaseBinding,
    actor_user_id: &'a str,
    credential_id: &'a str,
    credential_generation: u64,
    grant_id: &'a str,
    token_id: &'a str,
    effective_user_id: Option<&'a str>,
    token_expires_at_ms: u64,
}

impl RetainedEffectServiceAuthority<'_> {
    pub fn belongs_to_database(&self, database_binding: &crate::storage::DatabaseBinding) -> bool {
        self.database_binding.matches(database_binding)
    }

    pub fn actor_user_id(&self) -> &str {
        self.actor_user_id
    }

    pub fn credential_id(&self) -> &str {
        self.credential_id
    }

    pub fn credential_generation(&self) -> u64 {
        self.credential_generation
    }

    pub fn grant_id(&self) -> &str {
        self.grant_id
    }

    pub fn token_id(&self) -> &str {
        self.token_id
    }

    pub fn effective_user_id(&self) -> Option<&str> {
        self.effective_user_id
    }

    pub fn token_expires_at_ms(&self) -> u64 {
        self.token_expires_at_ms
    }
}

pub enum RetainedEffectOriginalAuthority<'a> {
    Anonymous,
    Session(RetainedEffectSessionAuthority<'a>),
    ServicePrincipal(RetainedEffectServiceAuthority<'a>),
}

impl PreparedPendingEffectApproval {
    pub fn effect(&self) -> &PendingEffectRecord {
        &self.record
    }

    pub fn effect_id(&self) -> &str {
        &self.record.id
    }

    pub fn approver_principal_id(&self) -> &str {
        &self.approver_principal_id
    }

    pub fn original_authority(&self) -> RetainedEffectOriginalAuthority<'_> {
        match &self.record.authority {
            PendingEffectAuthority::Anonymous => RetainedEffectOriginalAuthority::Anonymous,
            PendingEffectAuthority::Session {
                user_id,
                session_id,
                provider,
                generation,
                authority_instance_id,
                authorization_stream_incarnation,
            } => RetainedEffectOriginalAuthority::Session(RetainedEffectSessionAuthority {
                database_binding: self.database_binding.clone(),
                authorization_stream_incarnation,
                session_id,
                user_id,
                provider,
                generation: *generation,
                authority_instance_id,
            }),
            PendingEffectAuthority::ServicePrincipal {
                actor_user_id,
                credential_id,
                credential_generation,
                grant_id,
                token_id,
                effective_user_id,
                token_expires_at_ms,
            } => {
                RetainedEffectOriginalAuthority::ServicePrincipal(RetainedEffectServiceAuthority {
                    database_binding: self.database_binding.clone(),
                    actor_user_id,
                    credential_id,
                    credential_generation: *credential_generation,
                    grant_id,
                    token_id,
                    effective_user_id: effective_user_id.as_deref(),
                    token_expires_at_ms: *token_expires_at_ms,
                })
            }
        }
    }
}

pub struct ApprovePendingEffectCommand {
    approval: PreparedPendingEffectApproval,
    requires_step_up: bool,
    step_up: Option<crate::auth::crypto::StepUpProof>,
    now_ms: u64,
    owner: PendingEffectOwner,
}

pub struct DenyPendingEffectCommand {
    database_binding: crate::storage::DatabaseBinding,
    id: String,
    approver_principal_id: String,
    now_ms: u64,
}

pub struct ApprovedPendingEffect {
    pub record: PendingEffectRecord,
    execution: PendingEffectExecutionTicket,
}

pub struct PendingEffectExecutionTicket {
    database_binding: crate::storage::DatabaseBinding,
    id: String,
    owner: PendingEffectOwner,
}

impl ApprovedPendingEffect {
    pub fn into_parts(self) -> (PendingEffectRecord, PendingEffectExecutionTicket) {
        (self.record, self.execution)
    }
}

pub struct PendingEffectSettlement {
    execution: PendingEffectExecutionTicket,
    executed: bool,
    outcome_code: Option<String>,
    now_ms: u64,
}

impl PendingEffectExecutionTicket {
    /// Consume the exact approved ticket into an executed settlement.  The
    /// result can no longer be supplied as an independent sibling argument to
    /// the durable consumer.
    pub fn executed(self, outcome_code: Option<&str>, now_ms: u64) -> PendingEffectSettlement {
        PendingEffectSettlement {
            execution: self,
            executed: true,
            outcome_code: outcome_code.map(str::to_owned),
            now_ms,
        }
    }

    /// Consume the exact approved ticket into a refused settlement.
    pub fn refused(self, outcome_code: &str, now_ms: u64) -> PendingEffectSettlement {
        PendingEffectSettlement {
            execution: self,
            executed: false,
            outcome_code: Some(outcome_code.to_owned()),
            now_ms,
        }
    }
}

pub struct RefusePendingEffectCommand {
    database_binding: crate::storage::DatabaseBinding,
    id: String,
    outcome_code: String,
    now_ms: u64,
    owner_principal_id: String,
}

impl crate::storage::KernelCommitAuthority {
    pub fn admit_pending_effect_creation(
        &self,
        owner: &PendingEffectOwner,
        request: CreatePendingEffect,
    ) -> SnapbackResult<CreatePendingEffectCommand> {
        owner.verify_for(&self.binding())?;
        let mut request = request;
        request.authority = owner.authority.clone();
        Ok(CreatePendingEffectCommand {
            database_binding: self.binding(),
            request,
        })
    }

    pub fn admit_pending_effect_approval(
        &self,
        owner: PendingEffectOwner,
        approval: PreparedPendingEffectApproval,
        requires_step_up: bool,
        step_up: Option<&crate::auth::crypto::StepUpProof>,
        now_ms: u64,
    ) -> SnapbackResult<ApprovePendingEffectCommand> {
        owner.verify_for(&self.binding())?;
        if approval.approver_principal_id != owner.require_session_principal()? {
            return Err(owner_invalid(
                "pending-effect approval belongs to a different derived approver",
            ));
        }
        Ok(ApprovePendingEffectCommand {
            approval,
            requires_step_up,
            step_up: step_up.cloned(),
            now_ms,
            owner,
        })
    }

    pub fn admit_pending_effect_denial(
        &self,
        owner: &PendingEffectOwner,
        id: &str,
        now_ms: u64,
    ) -> SnapbackResult<DenyPendingEffectCommand> {
        owner.verify_for(&self.binding())?;
        Ok(DenyPendingEffectCommand {
            database_binding: self.binding(),
            id: id.to_owned(),
            approver_principal_id: owner.require_session_principal()?.to_owned(),
            now_ms,
        })
    }

    pub fn admit_pending_effect_refusal(
        &self,
        owner: &PendingEffectOwner,
        id: &str,
        outcome_code: &str,
        now_ms: u64,
    ) -> SnapbackResult<RefusePendingEffectCommand> {
        owner.verify_for(&self.binding())?;
        Ok(RefusePendingEffectCommand {
            database_binding: self.binding(),
            id: id.to_owned(),
            outcome_code: outcome_code.to_owned(),
            now_ms,
            owner_principal_id: owner.require_session_principal()?.to_owned(),
        })
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

fn owner_invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_EFFECT_AUTHORITY_INVALID",
        "effects",
        message.into(),
    )
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
            caller_attribution_binding: None,
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
    /// Resolve caller-presented identity evidence against this database and
    /// return the single owner carrier shared by every pending-effect
    /// transition.  Session and service coordinates are lookup keys only; all
    /// stored authority fields are reconstructed from the protected catalog.
    ///
    /// @ref LLP 0292#42-authority-flow — the canonical store converts evidence
    /// into an exact prepared operation rather than trusting copied subjects.
    pub(crate) fn resolve_pending_effect_owner(
        &mut self,
        evidence: PendingEffectOwnerEvidence,
        now_ms: u64,
    ) -> SnapbackResult<PendingEffectOwner> {
        let (authority, principal_id) = match evidence {
            PendingEffectOwnerEvidence::Anonymous => (PendingEffectAuthority::Anonymous, None),
            PendingEffectOwnerEvidence::Session {
                bearer,
                authorization_stream_incarnation,
            } => {
                let lookup = self
                    .auth_catalog_read()
                    .lookup_presented_session(&bearer.token_hash())?;
                let session = match lookup {
                    crate::contract_types::PresentedSessionLookup::Current(session)
                        if session.live_at(now_ms) =>
                    {
                        session.session
                    }
                    _ => {
                        return Err(owner_invalid(
                            "pending-effect session bearer is not current",
                        ));
                    }
                };
                let stream_is_canonical_v7 =
                    uuid::Uuid::parse_str(&authorization_stream_incarnation)
                        .ok()
                        .is_some_and(|stream| {
                            stream.get_version_num() == 7
                                && stream.to_string() == authorization_stream_incarnation
                        });
                if !stream_is_canonical_v7 {
                    return Err(owner_invalid(
                        "pending-effect session evidence is no longer current",
                    ));
                }
                let user_id = session.user_id;
                (
                    PendingEffectAuthority::Session {
                        user_id: user_id.clone(),
                        session_id: session.session_id,
                        provider: session.provider,
                        generation: session.generation,
                        authority_instance_id: session.authority_instance_id,
                        authorization_stream_incarnation,
                    },
                    Some(user_id),
                )
            }
            PendingEffectOwnerEvidence::ServicePrincipal(token) => {
                let resolved = self.resolve_scoped_service_authority(&token, now_ms)?;
                let resolved = resolved.resolved();
                (
                    PendingEffectAuthority::ServicePrincipal {
                        actor_user_id: resolved.actor_user_id().to_owned(),
                        credential_id: resolved.credential_id().to_owned(),
                        credential_generation: resolved.credential_generation(),
                        grant_id: resolved.grant_id().to_owned(),
                        token_id: resolved.token_id().to_owned(),
                        effective_user_id: resolved.effective_user_id().map(str::to_owned),
                        token_expires_at_ms: resolved.expires_at_ms(),
                    },
                    None,
                )
            }
        };
        Ok(PendingEffectOwner {
            database_binding: self.binding(),
            authority,
            principal_id,
            creator_process_id: std::process::id(),
        })
    }

    /// Re-resolve every stored service coordinate borrowed from an exact
    /// pending-effect approval, including the frozen token deadline.
    ///
    /// @ref LLP 0303#the-governing-principle — the retained service subject is
    /// supplied as one derived borrow view, not as caller-selected fields.
    pub fn resolve_prepared_pending_effect_service_authority(
        &mut self,
        retained: &RetainedEffectServiceAuthority<'_>,
        now_ms: u64,
    ) -> SnapbackResult<crate::storage::auth_agent_credentials::ResolvedScopedToken> {
        verify_command_identity(&retained.database_binding, &self.binding())?;
        let resolved = self.resolve_retained_service_authority(
            crate::storage::auth_agent_credentials::RetainedServiceAuthority {
                actor_user_id: retained.actor_user_id(),
                credential_id: retained.credential_id(),
                credential_generation: retained.credential_generation(),
                grant_id: retained.grant_id(),
                token_id: retained.token_id(),
                effective_user_id: retained.effective_user_id(),
            },
            now_ms,
        )?;
        if resolved.expires_at_ms() != retained.token_expires_at_ms() {
            return Err(SnapbackError::error(
                "SNAPBACK_EFFECT_BINDING_STALE",
                "effects",
                "the scoped-token deadline differs from the frozen authority",
            ));
        }
        Ok(resolved)
    }

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

    /// Load and bind the exact durable effect selected by a derived approver.
    /// The carrier keeps the existing database binding for the decision sink;
    /// retained original-authority coordinates are derived from the loaded row.
    ///
    /// @ref LLP 0303#corollary--the-artifact-must-carry-provenance-not-just-type —
    /// the retained authority arm comes from the database-bound row.
    pub fn prepare_pending_effect_approval(
        &mut self,
        id: &str,
        approver_principal_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<PreparedPendingEffectApproval> {
        if !table_exists(&self.conn)? {
            return Err(not_found());
        }
        self.with_auth_transaction(|tx| lazy_expire(tx, Some(id), now_ms))?;
        let mut record = read_record(&self.conn, id)?.ok_or_else(not_found)?;
        if record.status == PendingEffectStatus::Expired {
            return Err(expired());
        }
        if record.status != PendingEffectStatus::Pending {
            return Err(state_invalid());
        }
        if record
            .approver_principal_id
            .as_deref()
            .is_some_and(|expected| expected != approver_principal_id)
        {
            return Err(approval_denied());
        }
        record.caller_attribution_binding = Some(PendingEffectCallerAttributionBinding {
            database_binding: self.binding(),
            approver_principal_id: approver_principal_id.to_owned(),
        });
        Ok(PreparedPendingEffectApproval {
            database_binding: self.binding(),
            record,
            approver_principal_id: approver_principal_id.to_owned(),
        })
    }

    pub fn approve_pending_effect(
        &mut self,
        command: ApprovePendingEffectCommand,
    ) -> SnapbackResult<ApprovedPendingEffect> {
        verify_command_identity(&command.approval.database_binding, &self.binding())?;
        let ApprovePendingEffectCommand {
            approval,
            requires_step_up,
            step_up,
            now_ms,
            owner,
        } = command;
        let PreparedPendingEffectApproval {
            record: prepared,
            approver_principal_id,
            ..
        } = approval;
        let id = prepared.id.clone();
        self.with_auth_transaction(|tx| {
            lazy_expire(tx, Some(&id), now_ms)?;
            let mut current = read_record(tx, &id)?.ok_or_else(not_found)?;
            if current.status == PendingEffectStatus::Expired {
                return Err(expired());
            }
            if current.status != PendingEffectStatus::Pending {
                return Err(state_invalid());
            }
            // The prepared row carries an ephemeral attribution binding that
            // is intentionally absent from durable readback. Normalize only
            // that private proof before comparing every durable field.
            current.caller_attribution_binding = prepared.caller_attribution_binding.clone();
            if current != prepared {
                return Err(state_invalid());
            }
            if requires_step_up {
                let proof = step_up
                    .as_ref()
                    .ok_or_else(crate::auth::crypto::step_up_required_error)?;
                if super::auth_catalog_ops::consume_step_up_proof_on(tx, proof, now_ms)?
                    != crate::auth::crypto::StepUpConsumption::Verified
                {
                    return Err(crate::auth::crypto::step_up_required_error());
                }
            }
            let changed = tx.execute(
                "UPDATE _snapback_pending_effects
                 SET status = ?1, approver_identity = ?2, decided_at_ms = ?3,
                     outcome_code = ?4
                 WHERE id = ?5 AND status = 'pending'",
                params![
                    "approved",
                    approver_principal_id,
                    now_ms as i64,
                    None::<String>,
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
                    at_ms: now_ms,
                    transition: "approved".to_owned(),
                    actor: Some(approver_principal_id.to_owned()),
                    outcome_code: None,
                },
            )
        })?;
        let record = read_record(&self.conn, &id)?.ok_or_else(catalog_corrupt)?;
        Ok(ApprovedPendingEffect {
            record,
            execution: PendingEffectExecutionTicket {
                database_binding: self.binding(),
                id,
                owner,
            },
        })
    }

    pub fn deny_pending_effect(
        &mut self,
        command: DenyPendingEffectCommand,
    ) -> SnapbackResult<PendingEffectRecord> {
        verify_command_identity(&command.database_binding, &self.binding())?;
        let DenyPendingEffectCommand {
            id,
            approver_principal_id,
            now_ms,
            ..
        } = command;
        self.with_auth_transaction(|tx| {
            lazy_expire(tx, Some(&id), now_ms)?;
            let current = read_record(tx, &id)?.ok_or_else(not_found)?;
            if current.status == PendingEffectStatus::Expired {
                return Err(expired());
            }
            if current.status != PendingEffectStatus::Pending {
                return Err(state_invalid());
            }
            if current
                .approver_principal_id
                .as_deref()
                .is_some_and(|expected| expected != approver_principal_id)
            {
                return Err(approval_denied());
            }
            let outcome = "SNAPBACK_EFFECT_APPROVAL_DENIED";
            let changed = tx.execute(
                "UPDATE _snapback_pending_effects
                 SET status = 'refused', approver_identity = ?1, decided_at_ms = ?2,
                     outcome_code = ?3
                 WHERE id = ?4 AND status = 'pending'",
                params![approver_principal_id, now_ms as i64, outcome, id],
            )?;
            if changed != 1 {
                return Err(state_invalid());
            }
            append_transition(
                tx,
                &id,
                PendingEffectJournalEntry {
                    at_ms: now_ms,
                    transition: "refused".to_owned(),
                    actor: Some(approver_principal_id.to_owned()),
                    outcome_code: Some(outcome.to_owned()),
                },
            )
        })?;
        read_record(&self.conn, &id)?.ok_or_else(catalog_corrupt)
    }

    pub fn settle_pending_effect(
        &mut self,
        settlement: PendingEffectSettlement,
    ) -> SnapbackResult<PendingEffectRecord> {
        verify_command_identity(&settlement.execution.database_binding, &self.binding())?;
        settlement.execution.owner.verify_for(&self.binding())?;
        let PendingEffectSettlement {
            execution,
            executed,
            outcome_code,
            now_ms,
        } = settlement;
        let id = execution.id;
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
            owner_principal_id,
            ..
        } = command;
        self.with_auth_transaction(|tx| {
            let current = read_record(tx, &id)?.ok_or_else(not_found)?;
            if current.approver_principal_id.as_deref() != Some(owner_principal_id.as_str()) {
                return Err(owner_invalid(
                    "pending-effect refusal owner does not match the stored effect",
                ));
            }
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
    use crate::auth::crypto::{CryptoError, RandomSource};
    use std::sync::atomic::{AtomicU8, Ordering};

    struct CounterRandom(AtomicU8);

    impl CounterRandom {
        fn new() -> Self {
            Self(AtomicU8::new(1))
        }
    }

    impl RandomSource for CounterRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
            destination.fill(self.0.fetch_add(1, Ordering::SeqCst));
            Ok(())
        }
    }

    fn ready() -> (LocalDatabase, crate::storage::KernelCommitAuthority) {
        let mut db = LocalDatabase::memory().expect("pending-effect database");
        db.activate_current_auth_catalog()
            .expect("activate protected catalog");
        db.conn.execute_batch(TABLE_SQL).unwrap();
        db.conn.execute_batch(APPROVER_INDEX_SQL).unwrap();
        db.conn.execute_batch(EXPIRY_INDEX_SQL).unwrap();
        let authority = db
            .claim_kernel_commit_authority()
            .expect("kernel authority");
        (db, authority)
    }

    fn test_owner(
        db: &LocalDatabase,
        authority: PendingEffectAuthority,
        principal_id: Option<&str>,
    ) -> PendingEffectOwner {
        PendingEffectOwner {
            database_binding: db.binding(),
            authority,
            principal_id: principal_id.map(str::to_owned),
            creator_process_id: std::process::id(),
        }
    }

    fn admit_creation(
        db: &LocalDatabase,
        authority: &crate::storage::KernelCommitAuthority,
        request: CreatePendingEffect,
    ) -> CreatePendingEffectCommand {
        let owner = test_owner(db, request.authority.clone(), None);
        authority
            .admit_pending_effect_creation(&owner, request)
            .unwrap()
    }

    fn management_owner(db: &LocalDatabase, principal_id: &str) -> PendingEffectOwner {
        test_owner(db, PendingEffectAuthority::Anonymous, Some(principal_id))
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

    fn seed_service_authority(
        db: &mut LocalDatabase,
        actor_user_id: &str,
        effective_user_id: Option<&str>,
        grant_id: &str,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> crate::auth::crypto::ScopedToken {
        db.conn
            .execute(
                "INSERT INTO _auth_users(
                   id, created_at_ms, kind, display_name, operator_contact,
                   registration_provenance, deactivated_at_ms, owner_user_id
                 ) VALUES(?1, 0, 'agent', NULL, NULL,
                          'pending-effect-derivation-test', NULL, NULL)",
                [actor_user_id],
            )
            .expect("create retained-effect agent");
        if let Some(effective_user_id) = effective_user_id {
            db.conn
                .execute(
                    "INSERT INTO _auth_users(
                       id, created_at_ms, kind, display_name, operator_contact,
                       registration_provenance, deactivated_at_ms, owner_user_id
                     ) VALUES(?1, 0, 'human', NULL, NULL, NULL, NULL, NULL)",
                    [effective_user_id],
                )
                .expect("create retained-effect effective user");
        }
        let credential = db
            .issue_initial_agent_credential(actor_user_id, now_ms, random)
            .expect("issue retained-effect credential");
        db.conn
            .execute(
                "INSERT OR IGNORE INTO _auth_scope_bases(
                   function_id, kind, generation, present, authority_creating
                 ) VALUES('fn:write', 'mutation', 0, 1, 0)",
                [],
            )
            .expect("seed retained-effect scope basis");
        db.conn
            .execute(
                "INSERT INTO _auth_grants(
                   id, actor_user_id, effective_user_id, scopes, created_at_ms,
                   expires_at_ms, revoked_at_ms, created_by, request_id,
                   consent_digest, last_used_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, NULL, 'test', NULL, NULL, ?5)",
                params![
                    grant_id,
                    actor_user_id,
                    effective_user_id,
                    r#"[{"fn":"fn:write","kind":"mutation","basis":0,"authorityCreating":false}]"#,
                    now_ms as i64,
                    (now_ms + 60_000) as i64,
                ],
            )
            .expect("seed retained-effect grant");
        db.mint_scoped_token(&credential.secret, grant_id, Some(60_000), now_ms, random)
            .expect("mint retained-effect token")
            .secret
    }

    #[test]
    fn disclosed_intent_is_bounded_and_journals_approve_execute() {
        let (mut db, authority) = ready();
        let created = db
            .create_pending_effect(admit_creation(&db, &authority, request(10, DEFAULT_TTL_MS)))
            .unwrap();
        assert!(created.id.starts_with("pfx_"));
        assert_eq!(created.status, PendingEffectStatus::Pending);
        assert_eq!(created.preview.kind, "disclosed");
        assert_eq!(created.preview.declared_write_set, ["todos"]);
        assert_eq!(created.preview.args_digest, created.args_digest);
        assert_eq!(created.journal[0].transition, "created");

        let approval = db
            .prepare_pending_effect_approval(&created.id, "human-a", 20)
            .unwrap();
        let approved = db
            .approve_pending_effect(
                authority
                    .admit_pending_effect_approval(
                        management_owner(&db, "human-a"),
                        approval,
                        false,
                        None,
                        20,
                    )
                    .unwrap(),
            )
            .unwrap();
        assert_eq!(approved.record.status, PendingEffectStatus::Approved);
        let (_, execution) = approved.into_parts();
        let executed = db
            .settle_pending_effect(execution.executed(Some("ok"), 21))
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
        let durable = db
            .conn
            .query_row(
                "SELECT id, function_id, function_name, function_kind, args_json,
                        args_digest, caller_lane, caller_key, authority_json,
                        generation_json, effect_class, link_origin_id,
                        approver_principal_id, created_at_ms, expires_at_ms, status,
                        approver_identity, preview_kind, preview_json, decided_at_ms,
                        executed_at_ms, outcome_code, journal_json
                 FROM _snapback_pending_effects WHERE id = ?1",
                [&created.id],
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
            .expect("read all 23 durable pending-effect columns");
        assert_eq!(durable.0, created.id);
        assert_eq!(durable.1, created.function_id);
        assert_eq!(durable.2, created.function_name);
        assert_eq!(durable.3, "mutation");
        assert_eq!(durable.4, serde_json::to_string(&created.args).unwrap());
        assert_eq!(durable.5, created.args_digest);
        assert_eq!(durable.6, created.caller_lane);
        assert_eq!(durable.7, created.caller_key);
        assert_eq!(
            durable.8,
            serde_json::to_string(&created.authority).unwrap()
        );
        assert_eq!(
            durable.9,
            serde_json::to_string(&created.generation).unwrap()
        );
        assert_eq!(durable.10, created.effect_class);
        assert_eq!(durable.11, created.link_origin_id);
        assert_eq!(durable.12, created.approver_principal_id);
        assert_eq!(durable.13, created.created_at_ms as i64);
        assert_eq!(durable.14, created.expires_at_ms as i64);
        assert_eq!(durable.15, "executed");
        assert_eq!(durable.16.as_deref(), Some("human-a"));
        assert_eq!(durable.17, created.preview.kind);
        assert_eq!(durable.18, serde_json::to_string(&created.preview).unwrap());
        assert_eq!(durable.19, Some(20));
        assert_eq!(durable.20, Some(21));
        assert_eq!(durable.21.as_deref(), Some("ok"));
        assert_eq!(
            durable.22,
            serde_json::to_string(&executed.journal).unwrap()
        );
    }

    #[test]
    fn retained_effect_service_reconstruction_derives_the_stored_original_subject() {
        const STORED_ORIGINAL_ACTOR: &str = "effect-derived-agent-b";
        const SUBSTITUTED_LIVE_ACTOR: &str = "effect-substituted-agent-c";
        let mut db = LocalDatabase::memory().expect("pending-effect service database");
        db.activate_current_auth_catalog()
            .expect("activate protected catalog");
        db.conn.execute_batch(TABLE_SQL).unwrap();
        db.conn.execute_batch(APPROVER_INDEX_SQL).unwrap();
        db.conn.execute_batch(EXPIRY_INDEX_SQL).unwrap();
        let random = CounterRandom::new();
        let now_ms = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("fixture wall clock follows the Unix epoch")
            .as_millis() as u64)
            .checked_add(60_000)
            .expect("fixture authorization clock can advance");
        let stored_token = seed_service_authority(
            &mut db,
            STORED_ORIGINAL_ACTOR,
            None,
            "effect-derived-grant-b",
            now_ms,
            &random,
        );
        let substituted_token = seed_service_authority(
            &mut db,
            SUBSTITUTED_LIVE_ACTOR,
            None,
            "effect-substituted-grant-c",
            now_ms,
            &random,
        );
        let stored = db
            .resolve_scoped_token(&stored_token, now_ms + 1)
            .expect("resolve stored original service authority");
        db.resolve_scoped_token(&substituted_token, now_ms + 1)
            .expect("confirm the independently selectable substitute is live");
        let authority = db
            .claim_kernel_commit_authority()
            .expect("kernel authority after service setup");
        let mut effect_request = request(now_ms + 10, DEFAULT_TTL_MS);
        effect_request.authority = PendingEffectAuthority::ServicePrincipal {
            actor_user_id: stored.actor_user_id().to_owned(),
            credential_id: stored.credential_id().to_owned(),
            credential_generation: stored.credential_generation(),
            grant_id: stored.grant_id().to_owned(),
            token_id: stored.token_id().to_owned(),
            effective_user_id: stored.effective_user_id().map(str::to_owned),
            token_expires_at_ms: stored.expires_at_ms(),
        };
        let created = db
            .create_pending_effect(admit_creation(&db, &authority, effect_request))
            .expect("store exact original service authority");
        let approval = db
            .prepare_pending_effect_approval(&created.id, "human-a", now_ms + 11)
            .expect("derive the exact pending effect for its approver");
        let RetainedEffectOriginalAuthority::ServicePrincipal(retained) =
            approval.original_authority()
        else {
            panic!("stored service authority must produce the service borrow view")
        };

        let reconstructed = db
            .resolve_prepared_pending_effect_service_authority(&retained, now_ms + 11)
            .expect("reconstruct the stored original service authority");
        assert_eq!(reconstructed.actor_user_id(), STORED_ORIGINAL_ACTOR);
        let observed_clock = db
            .conn
            .query_row(
                "SELECT key, value FROM _snapback_meta WHERE key = ?1",
                [crate::storage::auth_invalidation::AUTH_CLOCK_META_KEY],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .expect("read back the retained-service authorization clock write");
        assert_eq!(
            observed_clock,
            (
                "auth_invalidation_clock_high_water_ms_v1".to_owned(),
                (now_ms + 11).to_string(),
            )
        );

        {
            const ACTOR: &str = "effect-agent-m";
            const EFFECTIVE_USER: &str = "effect-human-m";
            const GRANT: &str = "effect-grant-m";
            let mut db = LocalDatabase::memory().expect("retained service coordinate database");
            db.activate_current_auth_catalog()
                .expect("activate protected catalog");
            db.conn.execute_batch(TABLE_SQL).unwrap();
            db.conn.execute_batch(APPROVER_INDEX_SQL).unwrap();
            db.conn.execute_batch(EXPIRY_INDEX_SQL).unwrap();
            let random = CounterRandom::new();
            let now_ms = (std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("fixture wall clock follows the Unix epoch")
                .as_millis() as u64)
                .checked_add(60_000)
                .expect("fixture authorization clock can advance");
            let token = seed_service_authority(
                &mut db,
                ACTOR,
                Some(EFFECTIVE_USER),
                GRANT,
                now_ms,
                &random,
            );
            let stored = db
                .resolve_scoped_token(&token, now_ms + 1)
                .expect("resolve the exact stored service authority");
            assert!(stored.credential_generation() > 0);
            let exact = PendingEffectAuthority::ServicePrincipal {
                actor_user_id: stored.actor_user_id().to_owned(),
                credential_id: stored.credential_id().to_owned(),
                credential_generation: stored.credential_generation(),
                grant_id: stored.grant_id().to_owned(),
                token_id: stored.token_id().to_owned(),
                effective_user_id: stored.effective_user_id().map(str::to_owned),
                token_expires_at_ms: stored.expires_at_ms(),
            };
            let authority = db
                .claim_kernel_commit_authority()
                .expect("kernel authority after service setup");
            let mut cases = Vec::new();
            let mut add_case = |name: &'static str, mutate: fn(&mut PendingEffectAuthority)| {
                let mut retained = exact.clone();
                mutate(&mut retained);
                cases.push((name, retained));
            };
            add_case("actor-lower", |authority| {
                let PendingEffectAuthority::ServicePrincipal { actor_user_id, .. } = authority
                else {
                    unreachable!()
                };
                *actor_user_id = "effect-agent-a".to_owned();
            });
            add_case("actor-higher", |authority| {
                let PendingEffectAuthority::ServicePrincipal { actor_user_id, .. } = authority
                else {
                    unreachable!()
                };
                *actor_user_id = "effect-agent-z".to_owned();
            });
            add_case("credential-lower", |authority| {
                let PendingEffectAuthority::ServicePrincipal { credential_id, .. } = authority
                else {
                    unreachable!()
                };
                *credential_id = String::new();
            });
            add_case("credential-higher", |authority| {
                let PendingEffectAuthority::ServicePrincipal { credential_id, .. } = authority
                else {
                    unreachable!()
                };
                *credential_id = "\u{10ffff}".to_owned();
            });
            add_case("credential-generation-lower", |authority| {
                let PendingEffectAuthority::ServicePrincipal {
                    credential_generation,
                    ..
                } = authority
                else {
                    unreachable!()
                };
                *credential_generation -= 1;
            });
            add_case("credential-generation-higher", |authority| {
                let PendingEffectAuthority::ServicePrincipal {
                    credential_generation,
                    ..
                } = authority
                else {
                    unreachable!()
                };
                *credential_generation += 1;
            });
            add_case("grant-lower", |authority| {
                let PendingEffectAuthority::ServicePrincipal { grant_id, .. } = authority else {
                    unreachable!()
                };
                *grant_id = "effect-grant-a".to_owned();
            });
            add_case("grant-higher", |authority| {
                let PendingEffectAuthority::ServicePrincipal { grant_id, .. } = authority else {
                    unreachable!()
                };
                *grant_id = "effect-grant-z".to_owned();
            });
            add_case("token-lower", |authority| {
                let PendingEffectAuthority::ServicePrincipal { token_id, .. } = authority else {
                    unreachable!()
                };
                *token_id = String::new();
            });
            add_case("token-higher", |authority| {
                let PendingEffectAuthority::ServicePrincipal { token_id, .. } = authority else {
                    unreachable!()
                };
                *token_id = "\u{10ffff}".to_owned();
            });
            add_case("effective-user-lower", |authority| {
                let PendingEffectAuthority::ServicePrincipal {
                    effective_user_id, ..
                } = authority
                else {
                    unreachable!()
                };
                *effective_user_id = Some("effect-human-a".to_owned());
            });
            add_case("effective-user-higher", |authority| {
                let PendingEffectAuthority::ServicePrincipal {
                    effective_user_id, ..
                } = authority
                else {
                    unreachable!()
                };
                *effective_user_id = Some("effect-human-z".to_owned());
            });
            add_case("deadline-lower", |authority| {
                let PendingEffectAuthority::ServicePrincipal {
                    token_expires_at_ms,
                    ..
                } = authority
                else {
                    unreachable!()
                };
                *token_expires_at_ms -= 1;
            });
            add_case("deadline-higher", |authority| {
                let PendingEffectAuthority::ServicePrincipal {
                    token_expires_at_ms,
                    ..
                } = authority
                else {
                    unreachable!()
                };
                *token_expires_at_ms += 1;
            });
            cases.push(("exact", exact.clone()));

            let mut accepted = Vec::new();
            let mut refused = Vec::new();
            for (name, retained_authority) in cases {
                let mut effect_request = request(now_ms + 10, DEFAULT_TTL_MS);
                effect_request.authority = retained_authority;
                let created = db
                    .create_pending_effect(admit_creation(&db, &authority, effect_request))
                    .expect("store one retained service coordinate case");
                let approval = db
                    .prepare_pending_effect_approval(&created.id, "human-a", now_ms + 11)
                    .expect("derive the stored coordinate case");
                let RetainedEffectOriginalAuthority::ServicePrincipal(retained) =
                    approval.original_authority()
                else {
                    panic!("coordinate case must retain the service arm")
                };
                let result =
                    db.resolve_prepared_pending_effect_service_authority(&retained, now_ms + 11);
                if result.is_ok() {
                    accepted.push(name);
                } else {
                    refused.push(name);
                }
            }
            assert_eq!(accepted, ["exact"]);
            assert_eq!(
                refused,
                [
                    "actor-lower",
                    "actor-higher",
                    "credential-lower",
                    "credential-higher",
                    "credential-generation-lower",
                    "credential-generation-higher",
                    "grant-lower",
                    "grant-higher",
                    "token-lower",
                    "token-higher",
                    "effective-user-lower",
                    "effective-user-higher",
                    "deadline-lower",
                    "deadline-higher",
                ]
            );

            let mut revocation_request = request(now_ms + 10, DEFAULT_TTL_MS);
            revocation_request.authority = exact;
            let revocation_effect = db
                .create_pending_effect(admit_creation(&db, &authority, revocation_request))
                .expect("store exact authority for revocation cases");
            let revocation_approval = db
                .prepare_pending_effect_approval(&revocation_effect.id, "human-a", now_ms + 11)
                .expect("derive exact authority for revocation cases");
            let RetainedEffectOriginalAuthority::ServicePrincipal(revocation_retained) =
                revocation_approval.original_authority()
            else {
                panic!("revocation cases must retain the service arm")
            };
            let revocation_cases = [
                (
                    "credential-revoked",
                    "_auth_agent_credentials",
                    stored.credential_id(),
                ),
                ("grant-revoked", "_auth_grants", stored.grant_id()),
                ("token-revoked", "_auth_grant_tokens", stored.token_id()),
            ];
            let mut revocation_accepted = Vec::new();
            let mut revocation_refused = Vec::new();
            for (name, table, id) in revocation_cases {
                db.conn
                    .execute(
                        &format!("UPDATE {table} SET revoked_at_ms = ?1 WHERE id = ?2"),
                        params![(now_ms + 2) as i64, id],
                    )
                    .expect("revoke exactly one retained service row");
                if db
                    .resolve_prepared_pending_effect_service_authority(
                        &revocation_retained,
                        now_ms + 11,
                    )
                    .is_ok()
                {
                    revocation_accepted.push(name);
                } else {
                    revocation_refused.push(name);
                }
                db.conn
                    .execute(
                        &format!("UPDATE {table} SET revoked_at_ms = NULL WHERE id = ?1"),
                        [id],
                    )
                    .expect("restore the retained service row for the next independent case");
            }
            assert_eq!(revocation_accepted, Vec::<&str>::new());
            assert_eq!(
                revocation_refused,
                ["credential-revoked", "grant-revoked", "token-revoked"]
            );
            db.resolve_prepared_pending_effect_service_authority(&revocation_retained, now_ms + 11)
                .expect("the exact restored service rows remain accepted");
            let observed_clock = db
                .conn
                .query_row(
                    "SELECT key, value FROM _snapback_meta WHERE key = ?1",
                    [crate::storage::auth_invalidation::AUTH_CLOCK_META_KEY],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .expect("read authorization clock after accepted and refused service cases");
            assert_eq!(
                observed_clock,
                (
                    "auth_invalidation_clock_high_water_ms_v1".to_owned(),
                    (now_ms + 11).to_string(),
                )
            );
        }
    }

    #[test]
    fn retained_effect_service_rejects_foreign_database_composition_and_borrow_reuse() {
        const ACTOR: &str = "effect-cross-database-agent";
        const GRANT: &str = "effect-cross-database-grant";
        let now_ms = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("fixture wall clock follows the Unix epoch")
            .as_millis() as u64)
            .checked_add(60_000)
            .expect("fixture authorization clock can advance");

        let mut database_b = LocalDatabase::memory().expect("service consumer database B");
        database_b
            .activate_current_auth_catalog()
            .expect("activate protected catalog in database B");
        let token_b = seed_service_authority(
            &mut database_b,
            ACTOR,
            None,
            GRANT,
            now_ms,
            &CounterRandom::new(),
        );
        let matching_b = database_b
            .resolve_scoped_token(&token_b, now_ms + 1)
            .expect("database B has independently produced live coordinates");

        let mut database_a = LocalDatabase::memory().expect("service producer database A");
        database_a
            .activate_current_auth_catalog()
            .expect("activate protected catalog in database A");
        database_a.conn.execute_batch(TABLE_SQL).unwrap();
        database_a.conn.execute_batch(APPROVER_INDEX_SQL).unwrap();
        database_a.conn.execute_batch(EXPIRY_INDEX_SQL).unwrap();
        let authority_a = database_a
            .claim_kernel_commit_authority()
            .expect("claim producer authority for database A");
        let mut effect_request = request(now_ms + 10, DEFAULT_TTL_MS);
        effect_request.authority = PendingEffectAuthority::ServicePrincipal {
            actor_user_id: matching_b.actor_user_id().to_owned(),
            credential_id: matching_b.credential_id().to_owned(),
            credential_generation: matching_b.credential_generation(),
            grant_id: matching_b.grant_id().to_owned(),
            token_id: matching_b.token_id().to_owned(),
            effective_user_id: matching_b.effective_user_id().map(str::to_owned),
            token_expires_at_ms: matching_b.expires_at_ms(),
        };
        let created = database_a
            .create_pending_effect(admit_creation(&database_a, &authority_a, effect_request))
            .expect("store retained service view in database A");
        let approval = database_a
            .prepare_pending_effect_approval(&created.id, "human-a", now_ms + 11)
            .expect("derive retained service view from database A");
        let RetainedEffectOriginalAuthority::ServicePrincipal(retained) =
            approval.original_authority()
        else {
            panic!("stored service authority must produce the service borrow view")
        };

        assert_eq!(matching_b.actor_user_id(), retained.actor_user_id());
        assert_eq!(matching_b.credential_id(), retained.credential_id());
        assert_eq!(matching_b.grant_id(), retained.grant_id());
        assert_eq!(matching_b.token_id(), retained.token_id());

        for attempt in 1..=2 {
            let error = database_b
                .resolve_prepared_pending_effect_service_authority(&retained, now_ms + 11)
                .expect_err("database B must reject database A's borrowed retained view");
            assert_eq!(
                error.diagnostic.code, "SNAPBACK_EFFECT_AUTHORITY_INVALID",
                "foreign borrowed use {attempt}"
            );
        }
    }

    #[test]
    fn approver_deny_and_lazy_expiry_are_closed_transitions() {
        let (mut db, authority) = ready();
        let denied = db
            .create_pending_effect(admit_creation(&db, &authority, request(10, 100)))
            .unwrap();
        assert_eq!(
            db.deny_pending_effect(
                authority
                    .admit_pending_effect_denial(&management_owner(&db, "human-b"), &denied.id, 20,)
                    .unwrap()
            )
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_EFFECT_APPROVAL_DENIED",
        );
        assert_eq!(
            db.prepare_pending_effect_approval(&denied.id, "human-b", 20)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_EFFECT_APPROVAL_DENIED",
        );
        let refused = db
            .deny_pending_effect(
                authority
                    .admit_pending_effect_denial(&management_owner(&db, "human-a"), &denied.id, 20)
                    .unwrap(),
            )
            .unwrap();
        assert_eq!(refused.status, PendingEffectStatus::Refused);

        let expiring = db
            .create_pending_effect(admit_creation(&db, &authority, request(30, 1)))
            .unwrap();
        let expired = db.pending_effect(&expiring.id, 31).unwrap();
        assert_eq!(expired.status, PendingEffectStatus::Expired);
        assert_eq!(expired.journal.last().unwrap().transition, "expired");
        assert_eq!(
            db.prepare_pending_effect_approval(&expiring.id, "human-a", 32)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_EFFECT_EXPIRED",
        );
    }

    #[test]
    fn exact_catalog_rejects_unrecognized_shape() {
        let (db, _authority) = ready();
        validate_exact_schema(&db.conn).unwrap();
        db.conn
            .execute_batch(
                "CREATE INDEX _snapback_pending_effects_unrecognized
             ON _snapback_pending_effects(function_name);",
            )
            .unwrap();
        assert_eq!(
            validate_exact_schema(&db.conn).unwrap_err().diagnostic.code,
            "SNAPBACK_EFFECT_CATALOG_CORRUPT",
        );
    }
}
impl super::ServingDatabase {
    pub fn resolve_prepared_pending_effect_service_authority(
        &mut self,
        retained: &RetainedEffectServiceAuthority<'_>,
        now_ms: u64,
    ) -> SnapbackResult<crate::storage::auth_agent_credentials::DurablyResolvedServiceAuthority>
    {
        let resolved = self
            .db
            .resolve_prepared_pending_effect_service_authority(retained, now_ms)?;
        Ok(
            crate::storage::auth_agent_credentials::DurablyResolvedServiceAuthority::new(
                self.binding(),
                resolved,
            ),
        )
    }

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
