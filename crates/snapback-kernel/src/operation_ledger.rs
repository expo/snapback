//! Durable operation suppression, envelope, lifecycle, and explanation store.
//!
//! This module is intentionally below transport negotiation. It gives covered
//! writers one transaction-scoped insertion seam and gives acceptance tests a
//! real SQLite lifecycle to crash/reopen. A protocol lane is not covered until
//! its caller supplies an authenticated issuance artifact and the target's
//! capability corpus names that caller.
//!
//! @ref LLP 0163#contract-summary-normative-details-per-llp-0162-0-2 — the
//!   data/journal/envelope/suppression/receipt set is one transaction and the
//!   lookup order survives payload reclamation.

use std::collections::BTreeSet;

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::commit_envelope::{
    ClientIdentityRangeV1, CommitEnvelopeV1, ExplanationDispositionV1, FactProvenanceV1,
    IdentityEpochStateV1, IdentityEpochV1, OperationCoverageManifestV1,
    OperationIdentityComparison, OperationIdentityTombstoneV1, OperationIdentityV1,
    OperationIssuanceV1, OperationLookupDispositionV1, OperationOriginatorClassV1,
    OperationSuppressionRecordV1, OperationTerminalOutcomeV1, PendingOperationLifecycleV1,
    PendingOperationTerminalOutcomeV1, PendingOperationTerminalSupplementV1,
    RetainedEnvelopeDetailV1, SnapshotAssociationKindV1, derive_host_operation_id,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};

pub const CLIENT_IDENTITY_RANGE_SIZE_V1: u64 = 256;
/// Four finite ranges bound one authenticated client epoch to the same 1,024
/// identities as the client outbox and per-auth settlement budget. A fifth
/// range refuses and requires a fresh authenticated epoch instead of making
/// the open epoch's tombstone population unbounded.
///
/// @ref LLP 0043#dated-c28-lifecycle-reconciliation-2026-08-05 — the
/// aggregate epoch cap is a retention parameter, not merely a per-range bound.
pub const CLIENT_IDENTITY_EPOCH_CAPACITY_V1: u64 = 1_024;
pub const CLIENT_IDENTITY_EPOCH_MAX_RANGES_V1: u64 =
    CLIENT_IDENTITY_EPOCH_CAPACITY_V1 / CLIENT_IDENTITY_RANGE_SIZE_V1;
pub const CLIENT_IDENTITY_RANGE_WINDOW_MS_V1: u64 = 30 * 24 * 60 * 60 * 1_000;
pub const HOST_RECEIPT_WINDOW_MS_V1: u64 = 24 * 60 * 60 * 1_000;
pub const OPERATION_EXPLANATION_MAX_RESULTS_V1: usize = 100;
pub const ORDINARY_MUTATION_LANE_V1: &str = "ordinaryMutation";
pub const HOST_CHILD_MUTATION_LANE_V1: &str = "hostChildMutation";
/// Fork-local journal-authority lanes are deliberately distinct from the
/// operation-envelope lanes above. A derived fork can prove that every app-row
/// write crossed a generated writer and its journal without claiming LLP
/// 0163's deferred operation attribution.
pub const DERIVED_FORK_ORDINARY_APP_ROW_JOURNAL_LANE_V1: &str = "derivedForkOrdinaryAppRowJournal";
pub const DERIVED_FORK_HOST_CHILD_APP_ROW_JOURNAL_LANE_V1: &str =
    "derivedForkHostChildAppRowJournal";
/// Pending host operations use an effectively non-expiring lease. The lease
/// completes only with the digest-linked terminal supplement; wall-clock
/// expiry must never make a pending publication reclaimable.
pub const PENDING_HOST_IDENTITY_LEASE_EXPIRY_MS_V1: u64 = i64::MAX as u64;
pub const ORDINARY_MUTATION_WRITERS_V1: [&str; 2] = [
    "LocalDatabase::execute_mutation_idempotent_guarded_with_settlement_time",
    "LocalDatabase::commit_buffered_writes_idempotent_guarded",
];
pub const HOST_CHILD_MUTATION_WRITERS_V1: [&str; 2] = [
    "LocalDatabase::execute_host_mutation_guarded_with_settlement_time",
    "LocalDatabase::commit_buffered_host_writes_guarded",
];

const ORIGINATOR_CLIENT: &str = "client";
const ORIGINATOR_HOST: &str = "host";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostIncarnationAuthorityV1 {
    pub audience: String,
    pub authority_instance_id: String,
    pub epoch_id: String,
    pub authority_authenticator_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct HostIdentityLeaseV1 {
    identity: OperationIdentityV1,
    expires_at_ms: i64,
    completed_at_ms: Option<i64>,
}

// Lookup results cross the storage/runtime boundary as one explicit value.
// Boxing the common exact-replay arm would add an allocation to every retry.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq)]
pub enum OperationLookupV1 {
    Novel,
    ExactReplay(Box<OperationSuppressionRecordV1>),
    ResultExpired {
        outcome: OperationTerminalOutcomeV1,
        receipt_digest: String,
    },
    IdentityHorizonPassed,
}

#[derive(Clone, Debug, PartialEq)]
pub enum PendingOperationLookupV1 {
    Novel,
    Pending(PendingOperationLifecycleV1),
    Terminal(PendingOperationTerminalSupplementV1),
    IdentityHorizonPassed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PendingOperationFinalizationV1 {
    Applied,
    ExactReplay,
}

impl OperationLookupV1 {
    pub fn disposition(&self) -> OperationLookupDispositionV1 {
        match self {
            Self::Novel => OperationLookupDispositionV1::Novel,
            Self::ExactReplay(_) => OperationLookupDispositionV1::ExactReplay,
            Self::ResultExpired { .. } => OperationLookupDispositionV1::ResultExpired,
            Self::IdentityHorizonPassed => OperationLookupDispositionV1::IdentityHorizonPassed,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentExplanationAuthorityV1 {
    pub audience: String,
    pub principal_fingerprint: String,
    pub authority_instance_id: String,
    pub current_artifact_digest: Option<String>,
    pub current_policy_provable: bool,
    pub fact_policy: ExplanationFactPolicyV1,
    pub administrative: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OwnerMutationExplanationKindV1 {
    Create,
    Update,
    Delete,
}

/// Closed current-policy proofs admitted by the public explanation projector.
/// `Unprovable` is deliberate: an opaque handler, a deleted owner row, or a
/// fact class whose live policy cannot be reconstructed never falls back to
/// principal/operation identity equality.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ExplanationFactPolicyV1 {
    Unprovable,
    OwnerMutationV1 {
        subject: String,
        table: String,
        owner_field: String,
        kind: OwnerMutationExplanationKindV1,
        /// Exact private HostPlan mint site recovered from the active
        /// generated create artifact. Absent for update/delete.
        create_mint_site: Option<String>,
    },
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ExplanationQueryV1 {
    pub principal_fingerprint: Option<String>,
    pub principal_session_or_invocation_id: Option<String>,
    pub recorded_at_or_after_ms: Option<u64>,
    pub recorded_before_ms: Option<u64>,
    pub limit: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredOperationExplanationV1 {
    pub envelope: CommitEnvelopeV1,
    pub disposition: ExplanationDispositionV1,
    pub read_set_digest: Option<String>,
    pub read_set_count: Option<u64>,
    pub write_set_digest: Option<String>,
    pub write_set_count: Option<u64>,
    pub detail: Option<Value>,
}

impl StoredOperationExplanationV1 {
    pub fn into_public(self) -> crate::commit_envelope::OperationExplanationV1 {
        let bound = &self.envelope.identity.bound_facts;
        let authorized = self.disposition != ExplanationDispositionV1::AuthorizationUnprovable;
        crate::commit_envelope::OperationExplanationV1 {
            schema_version: crate::commit_envelope::operation_explanation_schema_version(),
            key: self.envelope.identity.key.clone(),
            operation_kind: authorized.then(|| bound.operation_kind.clone()),
            function_or_command: authorized.then(|| bound.function_or_command.clone()),
            principal_fingerprint: authorized.then(|| bound.principal_fingerprint.clone()),
            principal_session_or_invocation_id: authorized
                .then(|| self.envelope.principal_session_or_invocation_id.clone()),
            snapshot: authorized.then(|| self.envelope.snapshot.clone()),
            disposition: self.disposition,
            read_set_digest: self.read_set_digest,
            read_set_count: self.read_set_count,
            write_set_digest: self.write_set_digest,
            write_set_count: self.write_set_count,
            detail: self.detail,
        }
    }
}

pub(crate) fn create_infra(tx: &Transaction<'_>) -> SnapbackResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS _snapback_operation_epochs_v1 (
           originator_class TEXT NOT NULL,
           audience TEXT NOT NULL,
           epoch_id TEXT NOT NULL,
           epoch_sequence INTEGER NOT NULL CHECK(epoch_sequence >= 0),
           authority_instance_id TEXT NOT NULL,
           state TEXT NOT NULL CHECK(state IN ('open','terminated','revoked','closed')),
           issued_at_ms INTEGER NOT NULL CHECK(issued_at_ms >= 0),
           terminated_at_ms INTEGER,
           authenticator_digest TEXT NOT NULL,
           successor_epoch_id TEXT,
           rotated_at_ms INTEGER,
           PRIMARY KEY(originator_class, audience, epoch_id),
           UNIQUE(originator_class, audience, epoch_sequence)
         );
         CREATE TABLE IF NOT EXISTS _snapback_operation_ranges_v1 (
           audience TEXT NOT NULL,
           epoch_id TEXT NOT NULL,
           range_start INTEGER NOT NULL CHECK(range_start >= 0),
           range_end_exclusive INTEGER NOT NULL CHECK(range_end_exclusive > range_start),
           issued_at_ms INTEGER NOT NULL CHECK(issued_at_ms >= 0),
           expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms > issued_at_ms),
           authenticator_digest TEXT NOT NULL,
           PRIMARY KEY(audience, epoch_id, range_start)
         );
         CREATE TABLE IF NOT EXISTS _snapback_operation_protected_detail_v1 (
           custody_reference TEXT PRIMARY KEY,
           key_id TEXT NOT NULL,
           nonce BLOB NOT NULL CHECK(length(nonce)=24),
           ciphertext BLOB NOT NULL,
           payload_digest TEXT NOT NULL,
           payload_bytes INTEGER NOT NULL CHECK(payload_bytes >= 0)
         );
         CREATE TABLE IF NOT EXISTS _snapback_operation_floors_v1 (
           originator_class TEXT NOT NULL,
           audience TEXT NOT NULL,
           floor_sequence INTEGER NOT NULL CHECK(floor_sequence >= 0),
           updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= 0),
           PRIMARY KEY(originator_class, audience)
         );
         CREATE TABLE IF NOT EXISTS _snapback_commit_envelopes_v1 (
           stream_id TEXT NOT NULL,
           originator_class TEXT NOT NULL,
           operation_id TEXT NOT NULL,
           audience TEXT NOT NULL,
           epoch_id TEXT NOT NULL,
           epoch_sequence INTEGER NOT NULL CHECK(epoch_sequence >= 0),
           principal_fingerprint TEXT NOT NULL,
           principal_session_id TEXT NOT NULL,
           recorded_at_ms INTEGER NOT NULL CHECK(recorded_at_ms >= 0),
           envelope_json TEXT NOT NULL,
           PRIMARY KEY(stream_id, originator_class, operation_id)
         );
         CREATE INDEX IF NOT EXISTS _snapback_commit_envelopes_v1_enumerate
           ON _snapback_commit_envelopes_v1(
             audience, principal_fingerprint, principal_session_id, recorded_at_ms,
             stream_id, originator_class, operation_id
           );
         CREATE TABLE IF NOT EXISTS _snapback_operation_suppression_v1 (
           stream_id TEXT NOT NULL,
           originator_class TEXT NOT NULL,
           operation_id TEXT NOT NULL,
           audience TEXT NOT NULL,
           epoch_id TEXT NOT NULL,
           epoch_sequence INTEGER NOT NULL CHECK(epoch_sequence >= 0),
           counter INTEGER,
           terminal_at_ms INTEGER NOT NULL CHECK(terminal_at_ms >= 0),
           acknowledged_at_ms INTEGER,
           identity_json TEXT NOT NULL,
           record_json TEXT NOT NULL,
           PRIMARY KEY(stream_id, originator_class, operation_id)
         );
         CREATE TABLE IF NOT EXISTS _snapback_operation_tombstones_v1 (
           stream_id TEXT NOT NULL,
           originator_class TEXT NOT NULL,
           operation_id TEXT NOT NULL,
           audience TEXT NOT NULL,
           epoch_id TEXT NOT NULL,
           epoch_sequence INTEGER NOT NULL CHECK(epoch_sequence >= 0),
           counter INTEGER,
           tombstone_json TEXT NOT NULL,
           PRIMARY KEY(stream_id, originator_class, operation_id)
         );
         CREATE TABLE IF NOT EXISTS _snapback_operation_coverage_v1 (
           manifest_version INTEGER PRIMARY KEY CHECK(manifest_version > 0),
           stream_id TEXT NOT NULL,
           manifest_json TEXT NOT NULL,
           coverage_digest TEXT NOT NULL,
           activated_at_ms INTEGER NOT NULL CHECK(activated_at_ms >= 0)
         );
         CREATE TABLE IF NOT EXISTS _snapback_operation_coverage_continuity_v1 (
           stream_id TEXT PRIMARY KEY,
           state TEXT NOT NULL CHECK(state IN ('continuous','broken')),
           expected_manifest_version INTEGER NOT NULL CHECK(expected_manifest_version > 0),
           expected_coverage_digest TEXT NOT NULL,
           first_activated_at_ms INTEGER NOT NULL CHECK(first_activated_at_ms >= 0),
           gap_detected_at_ms INTEGER,
           gap_reason TEXT,
           CHECK(
             (state='continuous' AND gap_detected_at_ms IS NULL AND gap_reason IS NULL)
             OR
             (state='broken' AND gap_detected_at_ms IS NOT NULL AND gap_reason IS NOT NULL)
           )
         );
         CREATE TABLE IF NOT EXISTS _snapback_host_identity_leases_v1 (
           stream_id TEXT NOT NULL,
           operation_id TEXT NOT NULL,
           audience TEXT NOT NULL,
           epoch_id TEXT NOT NULL,
           identity_json TEXT NOT NULL,
           expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms >= 0),
           completed_at_ms INTEGER,
           PRIMARY KEY(stream_id, operation_id)
         );
         CREATE TABLE IF NOT EXISTS _snapback_operation_purges_v1 (
           purge_id TEXT PRIMARY KEY,
           selector_class TEXT NOT NULL CHECK(selector_class IN ('auth','all')),
           selector_digest TEXT NOT NULL,
           settlement_count INTEGER NOT NULL CHECK(settlement_count >= 0),
           operation_count INTEGER NOT NULL CHECK(operation_count >= 0),
           operation_keys_digest TEXT NOT NULL,
           recorded_at_ms INTEGER NOT NULL CHECK(recorded_at_ms >= 0)
         );
         CREATE TABLE IF NOT EXISTS _snapback_operation_pending_v1 (
           stream_id TEXT NOT NULL,
           originator_class TEXT NOT NULL,
           operation_id TEXT NOT NULL,
           lane TEXT NOT NULL,
           audience TEXT NOT NULL,
           epoch_id TEXT NOT NULL,
           lifecycle_json TEXT NOT NULL,
           PRIMARY KEY(stream_id, originator_class, operation_id)
         );
         CREATE INDEX IF NOT EXISTS _snapback_operation_pending_v1_capacity
           ON _snapback_operation_pending_v1(lane, audience);
         CREATE TABLE IF NOT EXISTS _snapback_operation_terminal_supplements_v1 (
           stream_id TEXT NOT NULL,
           originator_class TEXT NOT NULL,
           operation_id TEXT NOT NULL,
           lane TEXT NOT NULL,
           audience TEXT NOT NULL,
           epoch_id TEXT NOT NULL,
           terminal_at_ms INTEGER NOT NULL CHECK(terminal_at_ms >= 0),
           supplement_json TEXT NOT NULL,
           PRIMARY KEY(stream_id, originator_class, operation_id)
         );",
    )?;
    let has_successor: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM pragma_table_info('_snapback_operation_epochs_v1')
           WHERE name='successor_epoch_id'
         )",
        [],
        |row| row.get(0),
    )?;
    if !has_successor {
        tx.execute(
            "ALTER TABLE _snapback_operation_epochs_v1 ADD COLUMN successor_epoch_id TEXT",
            [],
        )?;
    }
    let has_rotation_time: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM pragma_table_info('_snapback_operation_epochs_v1')
           WHERE name='rotated_at_ms'
         )",
        [],
        |row| row.get(0),
    )?;
    if !has_rotation_time {
        tx.execute(
            "ALTER TABLE _snapback_operation_epochs_v1 ADD COLUMN rotated_at_ms INTEGER",
            [],
        )?;
    }
    // @ref LLP 0165#derived-fork-authorizer-backed-net-diff--2026-08-06 — the
    // registered-connection class needs a monotonic fact that an exact
    // manifest restore cannot erase.
    // Databases activated before the continuity carrier shipped acquire one
    // from the latest still-present manifest during the ordinary additive
    // infrastructure migration. Once present, the row is monotonic: a
    // registered-writer reconstruction gap changes it to `broken`, and no
    // activation path can turn it back to `continuous`.
    tx.execute(
        "INSERT INTO _snapback_operation_coverage_continuity_v1(
           stream_id,state,expected_manifest_version,expected_coverage_digest,
           first_activated_at_ms,gap_detected_at_ms,gap_reason
         )
         SELECT coverage.stream_id,'continuous',coverage.manifest_version,
                coverage.coverage_digest,coverage.activated_at_ms,NULL,NULL
           FROM _snapback_operation_coverage_v1 coverage
          WHERE coverage.manifest_version=(
                  SELECT MAX(candidate.manifest_version)
                    FROM _snapback_operation_coverage_v1 candidate
                   WHERE candidate.stream_id=coverage.stream_id
                )
         ON CONFLICT(stream_id) DO NOTHING",
        [],
    )?;
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OperationCoverageContinuityV1 {
    pub stream_id: String,
    pub state: String,
    pub expected_manifest_version: u64,
    pub expected_coverage_digest: String,
    pub first_activated_at_ms: u64,
    pub gap_detected_at_ms: Option<u64>,
    pub gap_reason: Option<String>,
}

pub(crate) fn operation_coverage_continuity(
    conn: &Connection,
    stream_id: &str,
) -> SnapbackResult<Option<OperationCoverageContinuityV1>> {
    let row = conn
        .query_row(
            "SELECT state,expected_manifest_version,expected_coverage_digest,
                    first_activated_at_ms,gap_detected_at_ms,gap_reason
               FROM _snapback_operation_coverage_continuity_v1
              WHERE stream_id=?1",
            [stream_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, u64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, u64>(3)?,
                    row.get::<_, Option<u64>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .optional()?;
    let Some((
        state,
        expected_manifest_version,
        expected_coverage_digest,
        first_activated_at_ms,
        gap_detected_at_ms,
        gap_reason,
    )) = row
    else {
        return Ok(None);
    };
    let valid_state = match state.as_str() {
        "continuous" => gap_detected_at_ms.is_none() && gap_reason.is_none(),
        "broken" => {
            gap_detected_at_ms.is_some()
                && gap_reason.as_deref().is_some_and(|value| !value.is_empty())
        }
        _ => false,
    };
    if expected_manifest_version == 0 || expected_coverage_digest.is_empty() || !valid_state {
        return Err(invalid("coverage continuity carrier is invalid"));
    }
    Ok(Some(OperationCoverageContinuityV1 {
        stream_id: stream_id.to_owned(),
        state,
        expected_manifest_version,
        expected_coverage_digest,
        first_activated_at_ms,
        gap_detected_at_ms,
        gap_reason,
    }))
}

/// Irreversibly record that a process-owned registered writer observed a
/// missing or contradictory coverage boundary. Restoring the manifest bytes
/// later cannot erase this fact or re-earn whole-window completeness.
///
/// @ref LLP 0165#derived-fork-authorizer-backed-net-diff--2026-08-06 — a
/// whole-window coverage gap is monotonic within the registered-writer class.
pub(crate) fn break_operation_coverage_continuity(
    conn: &Connection,
    stream_id: &str,
    expected_manifest_version: u64,
    expected_coverage_digest: &str,
    detected_at_ms: u64,
    reason: &str,
) -> SnapbackResult<()> {
    if stream_id.is_empty()
        || expected_manifest_version == 0
        || expected_coverage_digest.is_empty()
        || reason.is_empty()
    {
        return Err(invalid("coverage continuity gap evidence is invalid"));
    }
    let changed = conn.execute(
        "UPDATE _snapback_operation_coverage_continuity_v1
            SET state='broken',gap_detected_at_ms=COALESCE(gap_detected_at_ms,?2),
                gap_reason=COALESCE(gap_reason,?3)
          WHERE stream_id=?1",
        params![
            stream_id,
            to_i64(detected_at_ms, "coverage gap time")?,
            reason
        ],
    )?;
    if changed == 0 {
        conn.execute(
            "INSERT INTO _snapback_operation_coverage_continuity_v1(
               stream_id,state,expected_manifest_version,expected_coverage_digest,
               first_activated_at_ms,gap_detected_at_ms,gap_reason
             ) VALUES(?1,'broken',?2,?3,?4,?4,?5)",
            params![
                stream_id,
                to_i64(
                    expected_manifest_version,
                    "expected coverage manifest version"
                )?,
                expected_coverage_digest,
                to_i64(detected_at_ms, "coverage gap time")?,
                reason,
            ],
        )?;
    }
    Ok(())
}

pub fn coverage_digest(
    stream_id: &str,
    manifest_version: u64,
    covered_lanes: &[String],
    writer_choke_points: &[String],
) -> String {
    let mut lanes = covered_lanes.to_vec();
    lanes.sort();
    lanes.dedup();
    let mut writers = writer_choke_points.to_vec();
    writers.sort();
    writers.dedup();
    digest_json(
        b"snapback:operation-coverage:v1\n",
        &json!({
            "streamId": stream_id,
            "manifestVersion": manifest_version,
            "coveredLanes": lanes,
            "writerChokePoints": writers,
        }),
    )
}

pub(crate) fn register_coverage_in(
    tx: &Transaction<'_>,
    manifest: &OperationCoverageManifestV1,
    activated_at_ms: u64,
) -> SnapbackResult<()> {
    validate_coverage_manifest(manifest, &manifest.stream_id)?;
    let body = serde_json::to_string(manifest)
        .map_err(|_| invalid("coverage manifest could not be encoded"))?;
    tx.execute(
        "INSERT INTO _snapback_operation_coverage_v1(
           manifest_version, stream_id, manifest_json, coverage_digest, activated_at_ms
         ) VALUES(?1, ?2, ?3, ?4, ?5)",
        params![
            to_i64(manifest.manifest_version, "manifest version")?,
            manifest.stream_id,
            body,
            manifest.coverage_digest,
            to_i64(activated_at_ms, "coverage activation time")?,
        ],
    )?;
    match operation_coverage_continuity(tx, &manifest.stream_id)? {
        None => {
            tx.execute(
                "INSERT INTO _snapback_operation_coverage_continuity_v1(
                   stream_id,state,expected_manifest_version,expected_coverage_digest,
                   first_activated_at_ms,gap_detected_at_ms,gap_reason
                 ) VALUES(?1,'continuous',?2,?3,?4,NULL,NULL)",
                params![
                    manifest.stream_id,
                    to_i64(manifest.manifest_version, "coverage manifest version")?,
                    manifest.coverage_digest,
                    to_i64(activated_at_ms, "coverage activation time")?,
                ],
            )?;
        }
        Some(continuity) if continuity.state == "continuous" => {
            if manifest.manifest_version <= continuity.expected_manifest_version {
                return Err(invalid(
                    "coverage manifest versions must advance monotonically",
                ));
            }
            tx.execute(
                "UPDATE _snapback_operation_coverage_continuity_v1
                    SET expected_manifest_version=?2,expected_coverage_digest=?3
                  WHERE stream_id=?1 AND state='continuous'",
                params![
                    manifest.stream_id,
                    to_i64(manifest.manifest_version, "coverage manifest version")?,
                    manifest.coverage_digest,
                ],
            )?;
        }
        Some(_) => {
            return Err(invalid("broken coverage continuity cannot be re-armed"));
        }
    }
    Ok(())
}

pub(crate) fn active_coverage_manifest(
    conn: &Connection,
    stream_id: &str,
) -> SnapbackResult<Option<OperationCoverageManifestV1>> {
    let body: Option<String> = conn
        .query_row(
            "SELECT manifest_json FROM _snapback_operation_coverage_v1
             WHERE stream_id=?1 ORDER BY manifest_version DESC LIMIT 1",
            params![stream_id],
            |row| row.get(0),
        )
        .optional()?;
    let manifest = body
        .map(|body| decode(&body, "active coverage manifest"))
        .transpose()?;
    if let Some(manifest) = manifest.as_ref() {
        validate_coverage_manifest(manifest, stream_id)?;
    }
    Ok(manifest)
}

fn validate_coverage_manifest(
    manifest: &OperationCoverageManifestV1,
    expected_stream_id: &str,
) -> SnapbackResult<()> {
    if manifest.schema_version != 1
        || manifest.manifest_version == 0
        || manifest.stream_id != expected_stream_id
        || manifest.stream_id.is_empty()
        || manifest.covered_lanes.is_empty()
        || manifest.writer_choke_points.is_empty()
        || manifest.coverage_digest
            != coverage_digest(
                &manifest.stream_id,
                manifest.manifest_version,
                &manifest.covered_lanes,
                &manifest.writer_choke_points,
            )
    {
        return Err(invalid("coverage manifest is invalid"));
    }
    Ok(())
}

pub(crate) fn register_epoch_in(
    tx: &Transaction<'_>,
    epoch: &IdentityEpochV1,
) -> SnapbackResult<()> {
    if epoch.schema_version != 1
        || epoch.audience.is_empty()
        || epoch.authority_instance_id.is_empty()
        || epoch.epoch_id.is_empty()
        || !valid_sha256(&epoch.authority_authenticator_digest)
        || epoch.state == IdentityEpochStateV1::Closed
        || epoch.terminated_at_ms.is_some() != (epoch.state != IdentityEpochStateV1::Open)
    {
        return Err(invalid("identity epoch is invalid"));
    }
    // @ref LLP 0163#implementation-record--2026-08-05-c27-abandonment-and-c28-lifecycle-repair
    // — epoch registration stays contiguous so the retained floor has no gaps.
    let latest_sequence: Option<i64> = tx.query_row(
        "SELECT MAX(epoch_sequence) FROM _snapback_operation_epochs_v1
         WHERE originator_class=?1 AND audience=?2",
        params![originator(epoch.originator_class), epoch.audience],
        |row| row.get(0),
    )?;
    if let Some(latest_sequence) = latest_sequence {
        let expected = latest_sequence
            .checked_add(1)
            .ok_or_else(|| invalid("identity epoch sequence overflowed"))?;
        if to_i64(epoch.epoch_sequence, "epoch sequence")? != expected {
            return Err(invalid(
                "identity epochs for one audience must be registered contiguously",
            ));
        }
    } else {
        let floor_exists: bool = tx.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM _snapback_operation_floors_v1
               WHERE originator_class=?1 AND audience=?2
             )",
            params![originator(epoch.originator_class), epoch.audience],
            |row| row.get(0),
        )?;
        if floor_exists {
            return Err(invalid(
                "identity epoch history is missing below an existing floor",
            ));
        }
    }
    tx.execute(
        "INSERT INTO _snapback_operation_epochs_v1(
           originator_class, audience, epoch_id, epoch_sequence,
           authority_instance_id, state, issued_at_ms, terminated_at_ms,
           authenticator_digest
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            originator(epoch.originator_class),
            epoch.audience,
            epoch.epoch_id,
            to_i64(epoch.epoch_sequence, "epoch sequence")?,
            epoch.authority_instance_id,
            epoch_state(epoch.state),
            to_i64(epoch.issued_at_ms, "epoch issue time")?,
            optional_i64(epoch.terminated_at_ms, "epoch termination time")?,
            epoch.authority_authenticator_digest,
        ],
    )?;
    Ok(())
}

/// Ensure one durable range-less host epoch for the current storage/authority
/// incarnation. Reopening the same instance reuses it; explicit incarnation
/// rotation remains the only operation that retires it.
///
/// @ref LLP 0162#1-the-universal-commit-envelope — host identities are
///   server-authenticated and derive from durable upstream identities.
pub(crate) fn ensure_host_incarnation_in(
    tx: &Transaction<'_>,
    stream_id: &str,
    authority_instance_id: &str,
    issued_at_ms: u64,
) -> SnapbackResult<HostIncarnationAuthorityV1> {
    if stream_id.is_empty() || authority_instance_id.is_empty() {
        return Err(invalid(
            "host incarnation requires storage-stream and authority identities",
        ));
    }
    let audience = digest_json(
        b"snapback:host-operation-audience:v1\n",
        &json!({
            "authorityInstanceId": authority_instance_id,
            "streamId": stream_id,
        }),
    );
    let current: Option<(String, String)> = tx
        .query_row(
            "SELECT epoch_id,authenticator_digest
               FROM _snapback_operation_epochs_v1
              WHERE originator_class='host' AND audience=?1
                AND authority_instance_id=?2 AND state='open'
              ORDER BY epoch_sequence DESC LIMIT 1",
            params![audience, authority_instance_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let (epoch_id, authority_authenticator_digest) = match current {
        Some(current) => current,
        None => {
            let sequence: i64 = tx.query_row(
                "SELECT COALESCE(MAX(epoch_sequence), -1) + 1
                   FROM _snapback_operation_epochs_v1
                  WHERE originator_class='host' AND audience=?1",
                [&audience],
                |row| row.get(0),
            )?;
            let sequence =
                u64::try_from(sequence).map_err(|_| invalid("host epoch sequence overflowed"))?;
            let epoch_id = crate::ids::mint_time_ordered(crate::ids::Kind::Opaque);
            let authenticator = digest_json(
                b"snapback:host-operation-authority:v1\n",
                &json!({
                    "audience": audience,
                    "authorityInstanceId": authority_instance_id,
                    "epochId": epoch_id,
                    "epochSequence": sequence,
                    "issuedAtMs": issued_at_ms,
                    "streamId": stream_id,
                }),
            );
            register_epoch_in(
                tx,
                &IdentityEpochV1 {
                    schema_version: 1,
                    originator_class: OperationOriginatorClassV1::Host,
                    audience: audience.clone(),
                    authority_instance_id: authority_instance_id.to_owned(),
                    epoch_id: epoch_id.clone(),
                    epoch_sequence: sequence,
                    state: IdentityEpochStateV1::Open,
                    issued_at_ms,
                    terminated_at_ms: None,
                    authority_authenticator_digest: authenticator.clone(),
                },
            )?;
            (epoch_id, authenticator)
        }
    };
    Ok(HostIncarnationAuthorityV1 {
        audience,
        authority_instance_id: authority_instance_id.to_owned(),
        epoch_id,
        authority_authenticator_digest,
    })
}

pub(crate) fn resolve_host_incarnation_audience_in(
    tx: &Transaction<'_>,
    issuance: &OperationIssuanceV1,
    authority_instance_id: &str,
) -> SnapbackResult<String> {
    let OperationIssuanceV1::HostIncarnation {
        epoch_id,
        authority_authenticator_digest,
        ..
    } = issuance
    else {
        return Err(invalid("host mutation requires host-incarnation issuance"));
    };
    tx.query_row(
        "SELECT audience FROM _snapback_operation_epochs_v1
          WHERE originator_class='host' AND epoch_id=?1
            AND authority_instance_id=?2 AND authenticator_digest=?3
            AND state='open'",
        params![
            epoch_id,
            authority_instance_id,
            authority_authenticator_digest
        ],
        |row| row.get(0),
    )
    .optional()?
    .ok_or_else(|| {
        refused(
            "SNAPBACK_OPERATION_ISSUANCE_AUTH_INVALID",
            "host operation issuance does not resolve to a live server-recorded incarnation",
        )
    })
}

/// Rotate the server's host incarnation as one durable state transition. The
/// successor epoch and the fact that retired the predecessor are committed
/// together, so later reclamation never trusts a caller's assertion that a
/// rotation happened.
///
/// @ref LLP 0163#contract-summary-normative-details-per-llp-0162-0-2 — a
/// range-less host epoch closes only after its server incarnation has rotated.
pub(crate) fn rotate_host_incarnation_in(
    tx: &Transaction<'_>,
    audience: &str,
    retired_epoch_id: &str,
    successor: &IdentityEpochV1,
    rotated_at_ms: u64,
) -> SnapbackResult<()> {
    let retired: Option<(i64, String)> = tx
        .query_row(
            "SELECT epoch_sequence, authority_instance_id
             FROM _snapback_operation_epochs_v1
             WHERE originator_class='host' AND audience=?1 AND epoch_id=?2 AND state='open'",
            params![audience, retired_epoch_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((retired_sequence, retired_authority)) = retired else {
        return Err(refused(
            "SNAPBACK_HOST_INCARNATION_ROTATION_INVALID",
            "host rotation requires an open server-recorded predecessor epoch",
        ));
    };
    let expected_successor_sequence = retired_sequence
        .checked_add(1)
        .ok_or_else(|| invalid("host epoch sequence overflowed"))?;
    if successor.originator_class != OperationOriginatorClassV1::Host
        || successor.audience != audience
        || successor.epoch_id == retired_epoch_id
        || successor.authority_instance_id == retired_authority
        || i64::try_from(successor.epoch_sequence).ok() != Some(expected_successor_sequence)
        || successor.state != IdentityEpochStateV1::Open
        || successor.issued_at_ms != rotated_at_ms
        || successor.terminated_at_ms.is_some()
    {
        return Err(refused(
            "SNAPBACK_HOST_INCARNATION_ROTATION_INVALID",
            "host rotation requires the next open epoch under a distinct server incarnation",
        ));
    }
    register_epoch_in(tx, successor)?;
    let changed = tx.execute(
        "UPDATE _snapback_operation_epochs_v1
         SET state='terminated', terminated_at_ms=?1,
             successor_epoch_id=?2, rotated_at_ms=?1
         WHERE originator_class='host' AND audience=?3 AND epoch_id=?4 AND state='open'",
        params![
            to_i64(rotated_at_ms, "host rotation time")?,
            successor.epoch_id,
            audience,
            retired_epoch_id,
        ],
    )?;
    if changed != 1 {
        return Err(refused(
            "SNAPBACK_HOST_INCARNATION_ROTATION_INVALID",
            "host predecessor changed during incarnation rotation",
        ));
    }
    Ok(())
}

pub(crate) fn register_client_range_in(
    tx: &Transaction<'_>,
    range: &ClientIdentityRangeV1,
) -> SnapbackResult<()> {
    if !range.validate()
        || range.range_end_exclusive.saturating_sub(range.range_start)
            > CLIENT_IDENTITY_RANGE_SIZE_V1
        || range.expires_at_ms.saturating_sub(range.issued_at_ms)
            > CLIENT_IDENTITY_RANGE_WINDOW_MS_V1
    {
        return Err(invalid(
            "client identity range is invalid or exceeds v1 bounds",
        ));
    }
    let epoch: Option<(i64, String, String)> = tx
        .query_row(
            "SELECT epoch_sequence, authority_instance_id, authenticator_digest
             FROM _snapback_operation_epochs_v1
             WHERE originator_class='client' AND audience=?1 AND epoch_id=?2 AND state='open'",
            params![range.audience, range.epoch_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let Some((sequence, authority, authenticator)) = epoch else {
        return Err(refused(
            "SNAPBACK_OPERATION_EPOCH_UNAVAILABLE",
            "client range does not belong to an open server-recorded epoch",
        ));
    };
    if u64::try_from(sequence).ok() != Some(range.epoch_sequence)
        || authority != range.authority_instance_id
        || authenticator != range.authority_authenticator_digest
    {
        return Err(refused(
            "SNAPBACK_OPERATION_RANGE_AUTH_INVALID",
            "client range does not match its authenticated epoch",
        ));
    }
    let overlap: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM _snapback_operation_ranges_v1
           WHERE audience=?1 AND epoch_id=?2
             AND range_start < ?4 AND range_end_exclusive > ?3
         )",
        params![
            range.audience,
            range.epoch_id,
            to_i64(range.range_start, "range start")?,
            to_i64(range.range_end_exclusive, "range end")?,
        ],
        |row| row.get(0),
    )?;
    if overlap {
        return Err(refused(
            "SNAPBACK_OPERATION_RANGE_OVERLAP",
            "client identity ranges may not overlap",
        ));
    }
    let (range_count, allocated, expected_start): (i64, i64, i64) = tx.query_row(
        "SELECT COUNT(*), COALESCE(SUM(range_end_exclusive - range_start), 0),
                COALESCE(MAX(range_end_exclusive), 0)
         FROM _snapback_operation_ranges_v1
         WHERE audience=?1 AND epoch_id=?2",
        params![range.audience, range.epoch_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let range_count = u64::try_from(range_count)
        .map_err(|_| invalid("client identity epoch range count is invalid"))?;
    let allocated = u64::try_from(allocated)
        .map_err(|_| invalid("client identity epoch allocation is invalid"))?;
    let expected_start = u64::try_from(expected_start)
        .map_err(|_| invalid("client identity epoch range frontier is invalid"))?;
    if range.range_start != expected_start {
        return Err(refused(
            "SNAPBACK_OPERATION_RANGE_CONTINUITY_INVALID",
            "client identity ranges must extend the exact epoch frontier",
        ));
    }
    let requested = range.range_end_exclusive - range.range_start;
    if range_count >= CLIENT_IDENTITY_EPOCH_MAX_RANGES_V1
        || allocated
            .checked_add(requested)
            .is_none_or(|total| total > CLIENT_IDENTITY_EPOCH_CAPACITY_V1)
    {
        return Err(refused(
            "SNAPBACK_OPERATION_RANGE_EXHAUSTED",
            "client identity epoch reached its finite v1 counter capacity",
        ));
    }
    tx.execute(
        "INSERT INTO _snapback_operation_ranges_v1(
           audience, epoch_id, range_start, range_end_exclusive,
           issued_at_ms, expires_at_ms, authenticator_digest
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            range.audience,
            range.epoch_id,
            to_i64(range.range_start, "range start")?,
            to_i64(range.range_end_exclusive, "range end")?,
            to_i64(range.issued_at_ms, "range issue time")?,
            to_i64(range.expires_at_ms, "range expiry")?,
            range.authority_authenticator_digest,
        ],
    )?;
    Ok(())
}

/// Resolve the audience of an unwidened v1 client issuance from the exact
/// server-recorded range and its authenticated authority epoch. Keeping this
/// lookup below the public carrier preserves the shipped ClientRange shape
/// while ensuring that a caller cannot select or substitute an audience.
///
/// @ref LLP 0163#contract-summary-normative-details-per-llp-0162-0-2 — the
///   authority owns the range and mutation admission resolves its audience
///   from durable custody.
pub(crate) fn resolve_client_range_audience_in(
    tx: &Transaction<'_>,
    issuance: &OperationIssuanceV1,
    authority_instance_id: &str,
) -> SnapbackResult<String> {
    let OperationIssuanceV1::ClientRange {
        epoch_id,
        counter,
        range_start,
        range_end_exclusive,
        authority_authenticator_digest,
    } = issuance
    else {
        return Err(invalid("client mutation requires client-range issuance"));
    };
    let mut statement = tx.prepare(
        "SELECT r.audience
           FROM _snapback_operation_ranges_v1 r
           JOIN _snapback_operation_epochs_v1 e
             ON e.originator_class='client'
            AND e.audience=r.audience AND e.epoch_id=r.epoch_id
          WHERE r.epoch_id=?1 AND r.range_start=?2 AND r.range_end_exclusive=?3
            AND r.authenticator_digest=?4 AND e.authenticator_digest=?4
            AND e.authority_instance_id=?5
            AND r.range_start <= ?6 AND r.range_end_exclusive > ?6
          ORDER BY r.audience LIMIT 2",
    )?;
    let mut rows = statement.query(params![
        epoch_id,
        to_i64(*range_start, "range start")?,
        to_i64(*range_end_exclusive, "range end")?,
        authority_authenticator_digest,
        authority_instance_id,
        to_i64(*counter, "operation counter")?,
    ])?;
    let Some(first) = rows.next()? else {
        return Err(refused(
            "SNAPBACK_OPERATION_RANGE_AUTH_INVALID",
            "operation issuance does not resolve to a server-recorded authority range",
        ));
    };
    let audience: String = first.get(0)?;
    if rows.next()?.is_some() {
        return Err(invalid(
            "operation issuance ambiguously resolves to multiple audiences",
        ));
    }
    Ok(audience)
}

/// Resolve an issuance audience for retry classification after settlement
/// payload reclamation. Unlike first-attempt admission this accepts a retired
/// epoch: the retained authenticator is used only to locate the exact
/// suppression/tombstone/floor namespace, never to authorize new work.
///
/// @ref LLP 0162#1-the-universal-commit-envelope — lookup precedence remains
///   effective after issuer termination and must classify a below-floor retry
///   instead of executing it as novel.
pub(crate) fn resolve_operation_audience_for_lookup(
    conn: &Connection,
    issuance: &OperationIssuanceV1,
    authority_instance_id: &str,
) -> SnapbackResult<String> {
    let (originator_class, epoch_id, authenticator) = match issuance {
        OperationIssuanceV1::ClientRange {
            epoch_id,
            authority_authenticator_digest,
            ..
        } => (
            OperationOriginatorClassV1::Client,
            epoch_id,
            authority_authenticator_digest,
        ),
        OperationIssuanceV1::HostIncarnation {
            epoch_id,
            authority_authenticator_digest,
            ..
        } => (
            OperationOriginatorClassV1::Host,
            epoch_id,
            authority_authenticator_digest,
        ),
    };
    let audience: Option<String> = conn
        .query_row(
            "SELECT audience FROM _snapback_operation_epochs_v1
              WHERE originator_class=?1 AND epoch_id=?2
                AND authority_instance_id=?3 AND authenticator_digest=?4",
            params![
                originator(originator_class),
                epoch_id,
                authority_instance_id,
                authenticator,
            ],
            |row| row.get(0),
        )
        .optional()?;
    let audience = audience.ok_or_else(|| {
        refused(
            "SNAPBACK_OPERATION_ISSUANCE_AUTH_INVALID",
            "operation retry issuance does not resolve to a server-recorded authority epoch",
        )
    })?;
    if let OperationIssuanceV1::ClientRange {
        counter,
        range_start,
        range_end_exclusive,
        ..
    } = issuance
    {
        let exact_range: bool = conn.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM _snapback_operation_ranges_v1
                WHERE audience=?1 AND epoch_id=?2 AND range_start=?3
                  AND range_end_exclusive=?4 AND range_start <= ?5
                  AND range_end_exclusive > ?5 AND authenticator_digest=?6
             )",
            params![
                audience,
                epoch_id,
                to_i64(*range_start, "range start")?,
                to_i64(*range_end_exclusive, "range end")?,
                to_i64(*counter, "operation counter")?,
                authenticator,
            ],
            |row| row.get(0),
        )?;
        if !exact_range {
            return Err(refused(
                "SNAPBACK_OPERATION_RANGE_AUTH_INVALID",
                "operation retry issuance does not name its exact server-recorded range",
            ));
        }
    }
    Ok(audience)
}

/// Mint the next finite range under the exact live authority incarnation.
/// A caller may present its prior range only as a continuity assertion; it
/// never selects the audience, epoch, bounds, or authenticator. Issuance does
/// not activate coverage.
///
/// @ref LLP 0162#1-the-universal-commit-envelope — offline identities come
///   only from server-preallocated authenticated finite ranges.
pub(crate) fn issue_client_range_in(
    tx: &Transaction<'_>,
    _stream_id: &str,
    audience: &str,
    authority_instance_id: &str,
    previous: Option<&ClientIdentityRangeV1>,
    issued_at_ms: u64,
) -> SnapbackResult<ClientIdentityRangeV1> {
    if audience.is_empty() || authority_instance_id.is_empty() {
        return Err(invalid(
            "identity range issuance requires audience and authority identity",
        ));
    }
    if let Some(previous) = previous {
        if !previous.validate()
            || previous.audience != audience
            || previous.authority_instance_id != authority_instance_id
        {
            return Err(refused(
                "SNAPBACK_OPERATION_RANGE_AUTH_INVALID",
                "prior range does not belong to the current authority incarnation",
            ));
        }
        let exists: bool = tx.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM _snapback_operation_ranges_v1
               WHERE audience=?1 AND epoch_id=?2 AND range_start=?3
                 AND range_end_exclusive=?4 AND authenticator_digest=?5
             )",
            params![
                previous.audience,
                previous.epoch_id,
                to_i64(previous.range_start, "prior range start")?,
                to_i64(previous.range_end_exclusive, "prior range end")?,
                previous.authority_authenticator_digest,
            ],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(refused(
                "SNAPBACK_OPERATION_RANGE_AUTH_INVALID",
                "prior range is not a server-recorded range",
            ));
        }
    }

    let epoch: Option<(String, i64, String)> = tx
        .query_row(
            "SELECT epoch_id, epoch_sequence, authenticator_digest
             FROM _snapback_operation_epochs_v1
             WHERE originator_class='client' AND audience=?1
               AND authority_instance_id=?2 AND state='open'
             ORDER BY epoch_sequence DESC LIMIT 1",
            params![audience, authority_instance_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let (epoch_id, epoch_sequence, authenticator_digest) = match epoch {
        Some((epoch_id, sequence, authenticator)) => {
            let sequence =
                u64::try_from(sequence).map_err(|_| invalid("client epoch sequence is invalid"))?;
            (epoch_id, sequence, authenticator)
        }
        None => {
            let sequence: i64 = tx.query_row(
                "SELECT COALESCE(MAX(epoch_sequence), -1) + 1
                 FROM _snapback_operation_epochs_v1
                 WHERE originator_class='client' AND audience=?1",
                params![audience],
                |row| row.get(0),
            )?;
            let sequence =
                u64::try_from(sequence).map_err(|_| invalid("client epoch sequence overflowed"))?;
            let epoch_id = crate::ids::mint_time_ordered(crate::ids::Kind::Opaque);
            let authenticator_digest = digest_json(
                b"snapback:operation-range-authority:v1\n",
                &json!({
                    "audience": audience,
                    "authorityInstanceId": authority_instance_id,
                    "epochId": epoch_id,
                    "epochSequence": sequence,
                    "issuedAtMs": issued_at_ms,
                }),
            );
            register_epoch_in(
                tx,
                &IdentityEpochV1 {
                    schema_version: 1,
                    originator_class: OperationOriginatorClassV1::Client,
                    audience: audience.to_owned(),
                    authority_instance_id: authority_instance_id.to_owned(),
                    epoch_id: epoch_id.clone(),
                    epoch_sequence: sequence,
                    state: IdentityEpochStateV1::Open,
                    issued_at_ms,
                    terminated_at_ms: None,
                    authority_authenticator_digest: authenticator_digest.clone(),
                },
            )?;
            (epoch_id, sequence, authenticator_digest)
        }
    };
    let latest_range: Option<(i64, i64, i64, i64, String)> = tx
        .query_row(
            "SELECT range_start, range_end_exclusive, issued_at_ms, expires_at_ms,
                    authenticator_digest
             FROM _snapback_operation_ranges_v1
             WHERE audience=?1 AND epoch_id=?2
             ORDER BY range_end_exclusive DESC LIMIT 1",
            params![audience, epoch_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()?;
    let range_has_admitted_identity = |start: i64, end: i64| -> SnapbackResult<bool> {
        tx.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM _snapback_operation_suppression_v1
                WHERE originator_class='client' AND audience=?1 AND epoch_id=?2
                  AND counter >= ?3 AND counter < ?4
               UNION ALL
               SELECT 1 FROM _snapback_operation_tombstones_v1
                WHERE originator_class='client' AND audience=?1 AND epoch_id=?2
                  AND counter >= ?3 AND counter < ?4
             )",
            params![audience, epoch_id, start, end],
            |row| row.get(0),
        )
        .map_err(Into::into)
    };
    let retained_range = |start: i64,
                          end: i64,
                          issued: i64,
                          expires: i64,
                          digest: &str|
     -> SnapbackResult<ClientIdentityRangeV1> {
        Ok(ClientIdentityRangeV1 {
            schema_version: 1,
            audience: audience.to_owned(),
            authority_instance_id: authority_instance_id.to_owned(),
            epoch_id: epoch_id.clone(),
            epoch_sequence,
            range_start: u64::try_from(start)
                .map_err(|_| invalid("client range start is invalid"))?,
            range_end_exclusive: u64::try_from(end)
                .map_err(|_| invalid("client range end is invalid"))?,
            issued_at_ms: u64::try_from(issued)
                .map_err(|_| invalid("client range issue time is invalid"))?,
            expires_at_ms: u64::try_from(expires)
                .map_err(|_| invalid("client range expiry is invalid"))?,
            authority_authenticator_digest: digest.to_owned(),
        })
    };
    match (latest_range.as_ref(), previous) {
        (None, None) => {}
        (Some((start, end, _, _, digest)), Some(previous))
            if *start == to_i64(previous.range_start, "prior range start")?
                && *end == to_i64(previous.range_end_exclusive, "prior range end")?
                && digest == &previous.authority_authenticator_digest => {}
        // The successor may have committed while its response was lost. The
        // client still presents the exact immediate predecessor it durably
        // owns; re-serve the successor only until one of its counters is
        // admitted. Earlier-range admissions do not make this recovery
        // ambiguous because the latest range is finite and disjoint.
        (Some((start, end, issued, expires, digest)), Some(previous))
            if *start == to_i64(previous.range_end_exclusive, "prior range end")?
                && previous.epoch_id == epoch_id
                && digest == &previous.authority_authenticator_digest =>
        {
            if range_has_admitted_identity(*start, *end)? {
                return Err(refused(
                    "SNAPBACK_OPERATION_RANGE_CONTINUITY_INVALID",
                    "latest successor range has admitted identities; durable successor custody is required",
                ));
            }
            return retained_range(*start, *end, *issued, *expires, digest);
        }
        // A response can be lost after the server commits issuance but before
        // the client atomically installs it. Re-serve that exact latest range
        // only while no identity from that range has been admitted. Once the
        // range is used, omitting prior custody must fail closed.
        (Some((start, end, issued, expires, digest)), None) => {
            if range_has_admitted_identity(*start, *end)? {
                return Err(refused(
                    "SNAPBACK_OPERATION_RANGE_CONTINUITY_INVALID",
                    "latest range has admitted identities; durable prior custody is required",
                ));
            }
            return retained_range(*start, *end, *issued, *expires, digest);
        }
        (None, Some(_)) | (Some(_), Some(_)) => {
            return Err(refused(
                "SNAPBACK_OPERATION_RANGE_CONTINUITY_INVALID",
                "range refresh must present the latest server-recorded durable range",
            ));
        }
    }
    let start: i64 = tx.query_row(
        "SELECT COALESCE(MAX(range_end_exclusive), 0)
         FROM _snapback_operation_ranges_v1
         WHERE audience=?1 AND epoch_id=?2",
        params![audience, epoch_id],
        |row| row.get(0),
    )?;
    let range_start = u64::try_from(start).map_err(|_| invalid("client range start is invalid"))?;
    let range_end_exclusive = range_start
        .checked_add(CLIENT_IDENTITY_RANGE_SIZE_V1)
        .ok_or_else(|| {
            refused(
                "SNAPBACK_OPERATION_RANGE_EXHAUSTED",
                "client range counter exhausted",
            )
        })?;
    // SQLite storage uses signed integers even though the public counter is
    // unsigned. Refuse before any wrapping or lossy projection.
    to_i64(range_end_exclusive, "client range end")?;
    let expires_at_ms = issued_at_ms
        .checked_add(CLIENT_IDENTITY_RANGE_WINDOW_MS_V1)
        .ok_or_else(|| invalid("client range expiry overflowed"))?;
    let range = ClientIdentityRangeV1 {
        schema_version: 1,
        audience: audience.to_owned(),
        authority_instance_id: authority_instance_id.to_owned(),
        epoch_id,
        epoch_sequence,
        range_start,
        range_end_exclusive,
        issued_at_ms,
        expires_at_ms,
        authority_authenticator_digest: authenticator_digest,
    };
    register_client_range_in(tx, &range)?;
    Ok(range)
}

/// Explicit publication cut for the ordinary-mutation writer inventory.
/// Range issuance never calls this: activation is server-controlled only
/// after the named target's corpus and review gates pass.
#[allow(dead_code)] // Intentionally dormant while the public capability remains Missing.
pub(crate) fn activate_ordinary_mutation_coverage_in(
    tx: &Transaction<'_>,
    stream_id: &str,
    activated_at_ms: u64,
) -> SnapbackResult<OperationCoverageManifestV1> {
    activate_mutation_coverage_in(
        tx,
        stream_id,
        &[ORDINARY_MUTATION_LANE_V1],
        &ORDINARY_MUTATION_WRITERS_V1,
        activated_at_ms,
    )
}

/// Server-owned publication cut for every currently envelope-mapped local
/// application writer. Keeping the target cut separate from the ordinary-only
/// benchmark cut prevents measurement setup from accidentally advertising the
/// Host child lane.
#[allow(dead_code)] // Called only by the acceptance-gated publication step.
pub(crate) fn activate_local_target_mutation_coverage_in(
    tx: &Transaction<'_>,
    stream_id: &str,
    activated_at_ms: u64,
) -> SnapbackResult<OperationCoverageManifestV1> {
    let writers = ORDINARY_MUTATION_WRITERS_V1
        .into_iter()
        .chain(HOST_CHILD_MUTATION_WRITERS_V1)
        .collect::<Vec<_>>();
    activate_mutation_coverage_in(
        tx,
        stream_id,
        &[ORDINARY_MUTATION_LANE_V1, HOST_CHILD_MUTATION_LANE_V1],
        &writers,
        activated_at_ms,
    )
}

/// Fork-only publication cut for app-row journal completeness. It names the
/// same generated physical writer adapters as local operation coverage, but
/// uses separate logical lanes so ordinary fork calls do not acquire or imply
/// an LLP 0163 operation envelope.
///
/// @ref LLP 0165#derived-fork-authorizer-backed-net-diff--2026-08-06 — the
///   fork cut proves journal writer completeness while attribution remains an
///   explicit absent fact.
pub(crate) fn activate_derived_fork_app_row_journal_coverage_in(
    tx: &Transaction<'_>,
    stream_id: &str,
    activated_at_ms: u64,
) -> SnapbackResult<OperationCoverageManifestV1> {
    let writers = ORDINARY_MUTATION_WRITERS_V1
        .into_iter()
        .chain(HOST_CHILD_MUTATION_WRITERS_V1)
        .collect::<Vec<_>>();
    activate_mutation_coverage_in(
        tx,
        stream_id,
        &[
            DERIVED_FORK_ORDINARY_APP_ROW_JOURNAL_LANE_V1,
            DERIVED_FORK_HOST_CHILD_APP_ROW_JOURNAL_LANE_V1,
        ],
        &writers,
        activated_at_ms,
    )
}

fn activate_mutation_coverage_in(
    tx: &Transaction<'_>,
    stream_id: &str,
    lanes: &[&str],
    writers: &[&str],
    activated_at_ms: u64,
) -> SnapbackResult<OperationCoverageManifestV1> {
    let current = active_coverage_manifest(tx, stream_id)?;
    if let Some(manifest) = current.as_ref().filter(|manifest| {
        lanes.iter().all(|lane| {
            manifest
                .covered_lanes
                .iter()
                .any(|declared| declared == lane)
        }) && writers.iter().all(|writer| {
            manifest
                .writer_choke_points
                .iter()
                .any(|declared| declared == writer)
        })
    }) {
        return Ok(manifest.clone());
    }
    let manifest_version: i64 = tx.query_row(
        "SELECT COALESCE(MAX(manifest_version), 0) + 1
         FROM _snapback_operation_coverage_v1",
        [],
        |row| row.get(0),
    )?;
    let manifest_version = u64::try_from(manifest_version)
        .map_err(|_| invalid("coverage manifest version overflowed"))?;
    let mut covered_lanes = current
        .as_ref()
        .map(|manifest| manifest.covered_lanes.clone())
        .unwrap_or_default();
    covered_lanes.extend(lanes.iter().map(|lane| (*lane).to_owned()));
    covered_lanes.sort();
    covered_lanes.dedup();
    let mut writer_choke_points = current
        .map(|manifest| manifest.writer_choke_points)
        .unwrap_or_default();
    writer_choke_points.extend(writers.iter().map(|writer| (*writer).to_owned()));
    writer_choke_points.sort();
    writer_choke_points.dedup();
    let manifest = OperationCoverageManifestV1 {
        schema_version: 1,
        manifest_version,
        stream_id: stream_id.to_owned(),
        covered_lanes: covered_lanes.clone(),
        writer_choke_points: writer_choke_points.clone(),
        coverage_digest: coverage_digest(
            stream_id,
            manifest_version,
            &covered_lanes,
            &writer_choke_points,
        ),
    };
    register_coverage_in(tx, &manifest, activated_at_ms)?;
    Ok(manifest)
}

/// Insert one envelope and its suppression/receipt state in the caller's data
/// transaction. This function intentionally performs no COMMIT of its own.
///
/// @ref LLP 0163#implementation-record--2026-08-05-c27-abandonment-and-c28-lifecycle-repair
/// — writer insertion reclassifies retained identity state transactionally.
pub(crate) fn record_operation_in(
    tx: &Transaction<'_>,
    envelope: &CommitEnvelopeV1,
) -> SnapbackResult<()> {
    envelope
        .validate()
        .map_err(|error| invalid(format!("commit envelope is invalid: {error:?}")))?;
    let identity = &envelope.identity;
    refuse_retained_identity_for_insert(tx, identity, "covered operation")?;
    let (epoch_id, counter, authenticator) = issuance_parts(identity);
    let epoch_sequence = authenticate_operation_identity(tx, identity)?;
    if let OperationIssuanceV1::ClientRange {
        range_start,
        range_end_exclusive,
        ..
    } = &identity.issuance
    {
        let counter = counter.expect("client issuance has a counter");
        let admitted: bool = tx.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM _snapback_operation_ranges_v1
               WHERE audience=?1 AND epoch_id=?2 AND range_start=?3
                 AND range_end_exclusive=?4 AND range_start <= ?5
                 AND range_end_exclusive > ?5 AND expires_at_ms >= ?6
                 AND authenticator_digest=?7
             )",
            params![
                identity.bound_facts.audience,
                epoch_id,
                to_i64(*range_start, "range start")?,
                to_i64(*range_end_exclusive, "range end")?,
                to_i64(counter, "operation counter")?,
                to_i64(envelope.recorded_at_ms, "operation record time")?,
                authenticator,
            ],
            |row| row.get(0),
        )?;
        if !admitted {
            return Err(refused(
                "SNAPBACK_OPERATION_RANGE_EXHAUSTED",
                "operation counter is outside its live authenticated range",
            ));
        }
    }
    require_active_coverage(tx, envelope)?;
    require_journal_complete(tx, envelope)?;

    if identity.key.originator_class == OperationOriginatorClassV1::Client {
        let counter = counter.expect("client issuance has a counter");
        let occupied: bool = tx.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM _snapback_operation_suppression_v1
                WHERE originator_class='client' AND audience=?1 AND epoch_id=?2
                  AND counter=?3
                  AND NOT (stream_id=?4 AND operation_id=?5)
               UNION ALL
               SELECT 1 FROM _snapback_operation_tombstones_v1
                WHERE originator_class='client' AND audience=?1 AND epoch_id=?2
                  AND counter=?3
                  AND NOT (stream_id=?4 AND operation_id=?5)
             )",
            params![
                identity.bound_facts.audience,
                epoch_id,
                to_i64(counter, "operation counter")?,
                identity.key.stream_id,
                identity.key.operation_id,
            ],
            |row| row.get(0),
        )?;
        if occupied {
            return Err(refused(
                "SNAPBACK_OPERATION_RANGE_COUNTER_REUSED",
                "operation range counter is already retained under another operation identity",
            ));
        }
    }

    let envelope_json = serde_json::to_string(envelope)
        .map_err(|_| invalid("commit envelope could not be encoded"))?;
    let suppression = OperationSuppressionRecordV1 {
        schema_version: 1,
        identity: identity.clone(),
        terminal_outcome: match envelope.receipt.state {
            crate::commit_envelope::OperationReceiptStateV1::Committed => {
                OperationTerminalOutcomeV1::Committed
            }
            crate::commit_envelope::OperationReceiptStateV1::Refused => {
                OperationTerminalOutcomeV1::Refused
            }
            crate::commit_envelope::OperationReceiptStateV1::Pending => {
                return Err(invalid(
                    "a covered durable operation cannot commit a pending receipt",
                ));
            }
        },
        receipt_digest: envelope.receipt.receipt_digest.clone(),
        // Suppression retains only the bounded receipt projection/reference.
        // Protected plaintext stays exclusively in encrypted custody and is
        // opened only for an authorized exact replay.
        receipt_payload: serde_json::to_value(&envelope.receipt.payload)
            .map_err(|_| invalid("receipt payload could not be encoded"))?,
        terminal_at_ms: envelope.recorded_at_ms,
        acknowledged_at_ms: None,
    };
    let identity_json = serde_json::to_string(identity)
        .map_err(|_| invalid("operation identity could not be encoded"))?;
    let suppression_json = serde_json::to_string(&suppression)
        .map_err(|_| invalid("suppression record could not be encoded"))?;
    tx.execute(
        "INSERT INTO _snapback_commit_envelopes_v1(
           stream_id, originator_class, operation_id, audience, epoch_id,
           epoch_sequence, principal_fingerprint, principal_session_id,
           recorded_at_ms, envelope_json
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            identity.key.stream_id,
            originator(identity.key.originator_class),
            identity.key.operation_id,
            identity.bound_facts.audience,
            epoch_id,
            epoch_sequence,
            identity.bound_facts.principal_fingerprint,
            envelope.principal_session_or_invocation_id,
            to_i64(envelope.recorded_at_ms, "operation record time")?,
            envelope_json,
        ],
    )?;
    tx.execute(
        "INSERT INTO _snapback_operation_suppression_v1(
           stream_id, originator_class, operation_id, audience, epoch_id,
           epoch_sequence, counter, terminal_at_ms, acknowledged_at_ms,
           identity_json, record_json
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10)",
        params![
            identity.key.stream_id,
            originator(identity.key.originator_class),
            identity.key.operation_id,
            identity.bound_facts.audience,
            epoch_id,
            epoch_sequence,
            optional_i64(counter, "operation counter")?,
            to_i64(envelope.recorded_at_ms, "operation record time")?,
            identity_json,
            suppression_json,
        ],
    )?;
    Ok(())
}

/// Refuse a new pending operation when the lane/audience budget is full.
/// The exact retained identity remains admissible so crash recovery can
/// finish it; no pending row is ever selected for eviction.
pub(crate) fn require_pending_operation_capacity_in(
    conn: &Connection,
    lane: &str,
    audience: &str,
    proposed: Option<&OperationIdentityV1>,
    maximum: u64,
) -> SnapbackResult<()> {
    if lane.is_empty() || audience.is_empty() || maximum == 0 {
        return Err(invalid("pending operation capacity arguments are invalid"));
    }
    // @ref LLP 0163#implementation-record--2026-08-05-exact-c30-stop-and-c31-repair — indexed lifecycle projections are advisory until globally compared with retained JSON.
    // Enumerate first so a moved lane/audience projection cannot hide an
    // outcome-pending publication from the bounded admission count.
    let mut active = 0_u64;
    let mut proposed_retained = false;
    for (retained, outcome_pending) in validated_pending_lifecycles(conn)? {
        if let Some(proposed) = proposed
            && retained.identity.key == proposed.key
        {
            reject_divergence(&retained.identity, proposed)?;
            proposed_retained = true;
        }
        if outcome_pending
            && retained.lane == lane
            && retained.identity.bound_facts.audience == audience
        {
            active = active
                .checked_add(1)
                .ok_or_else(|| invalid("pending operation capacity overflowed"))?;
        }
    }
    if active < maximum || proposed_retained {
        return Ok(());
    }
    Err(refused(
        "SNAPBACK_OPERATION_PENDING_CAPACITY_FULL",
        "pending operation capacity is full; admission refuses rather than evicting an outcome-pending publication",
    ))
}

/// Record the immutable publication-side envelope plus its pending lifecycle
/// row in the caller's application-visible transaction. Unlike
/// `record_operation_in`, this seam deliberately accepts only Pending and does
/// not create a terminal suppression record.
///
/// @ref LLP 0163#implementation-record--2026-08-05-c27-abandonment-and-c28-lifecycle-repair
/// — pending and terminal publication share the same retained-state guard.
pub(crate) fn record_pending_operation_in(
    tx: &Transaction<'_>,
    envelope: &CommitEnvelopeV1,
    lifecycle: &PendingOperationLifecycleV1,
    maximum_pending_for_lane_audience: u64,
) -> SnapbackResult<()> {
    envelope
        .validate()
        .map_err(|error| invalid(format!("pending commit envelope is invalid: {error:?}")))?;
    let retained_pending_projection = serde_json::to_value(&envelope.receipt.payload)
        .map_err(|_| invalid("pending receipt projection could not be encoded"))?;
    if envelope.receipt.state != crate::commit_envelope::OperationReceiptStateV1::Pending
        || lifecycle.schema_version != 1
        || lifecycle.lane.is_empty()
        || lifecycle.identity != envelope.identity
        || lifecycle.publication != envelope.snapshot
        || lifecycle.publication.association != SnapshotAssociationKindV1::ProducedCommit
        || lifecycle.pending_receipt_digest != envelope.receipt.receipt_digest
        || !valid_sha256(&lifecycle.pending_receipt_digest)
        || pending_operation_receipt_digest(&retained_pending_projection)?
            != lifecycle.pending_receipt_digest
        || lifecycle.pending_at_ms != envelope.recorded_at_ms
        || retained_pending_projection != lifecycle.pending_payload
    {
        return Err(invalid(
            "pending lifecycle must exactly match its Pending commit envelope",
        ));
    }
    let identity = &envelope.identity;
    if identity.key.originator_class != OperationOriginatorClassV1::Host {
        return Err(invalid(
            "v1 pending durable operations require authenticated host issuance",
        ));
    }
    refuse_retained_identity_for_insert(tx, identity, "pending operation")?;
    let epoch_sequence = authenticate_operation_identity(tx, identity)?;
    require_pending_operation_capacity_in(
        tx,
        &lifecycle.lane,
        &identity.bound_facts.audience,
        Some(identity),
        maximum_pending_for_lane_audience,
    )?;
    let (epoch_id, _, _) = issuance_parts(identity);
    tx.execute(
        "INSERT INTO _snapback_commit_envelopes_v1(
           stream_id, originator_class, operation_id, audience, epoch_id,
           epoch_sequence, principal_fingerprint, principal_session_id,
           recorded_at_ms, envelope_json
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            identity.key.stream_id,
            originator(identity.key.originator_class),
            identity.key.operation_id,
            identity.bound_facts.audience,
            epoch_id,
            epoch_sequence,
            identity.bound_facts.principal_fingerprint,
            envelope.principal_session_or_invocation_id,
            to_i64(envelope.recorded_at_ms, "pending operation record time")?,
            serde_json::to_string(envelope)
                .map_err(|_| invalid("pending envelope could not be encoded"))?,
        ],
    )?;
    tx.execute(
        "INSERT INTO _snapback_operation_pending_v1(
           stream_id,originator_class,operation_id,lane,audience,epoch_id,lifecycle_json
         ) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![
            identity.key.stream_id,
            originator(identity.key.originator_class),
            identity.key.operation_id,
            lifecycle.lane,
            identity.bound_facts.audience,
            epoch_id,
            serde_json::to_string(lifecycle)
                .map_err(|_| invalid("pending lifecycle could not be encoded"))?,
        ],
    )?;
    register_host_identity_lease_in(tx, identity, PENDING_HOST_IDENTITY_LEASE_EXPIRY_MS_V1)?;
    Ok(())
}

/// Digest of the append-only Pending→terminal link. This is public to the
/// owning migration adapter so it can seal the supplement from the same
/// terminal receipt bytes it stores in its journal transaction.
pub fn pending_operation_transition_digest(
    identity: &OperationIdentityV1,
    publication: &crate::commit_envelope::StreamQualifiedVersionV1,
    pending_receipt_digest: &str,
    terminal_outcome: PendingOperationTerminalOutcomeV1,
    terminal_receipt_digest: &str,
    terminal_write_set_digest: &str,
    terminal_write_set_count: u64,
) -> String {
    digest_json(
        b"snapback:pending-operation-terminal-transition:v1\n",
        &json!({
            "identity": identity,
            "publication": publication,
            "pendingReceiptDigest": pending_receipt_digest,
            "terminalOutcome": terminal_outcome,
            "terminalReceiptDigest": terminal_receipt_digest,
            "terminalWriteSetDigest": terminal_write_set_digest,
            "terminalWriteSetCount": terminal_write_set_count,
        }),
    )
}

fn retained_projection_digest(domain: &[u8], projection: &Value) -> SnapbackResult<String> {
    let canonical = crate::rqs_contract::jcs(projection)
        .map_err(|_| invalid("retained operation projection is not canonicalizable"))?;
    let mut digest = Sha256::new();
    digest.update(domain);
    digest.update(canonical.as_bytes());
    Ok(format!("sha256:{:x}", digest.finalize()))
}

pub fn pending_operation_receipt_digest(projection: &Value) -> SnapbackResult<String> {
    retained_projection_digest(b"snapback:pending-operation-receipt:v1\n", projection)
}

pub fn pending_operation_terminal_receipt_digest(projection: &Value) -> SnapbackResult<String> {
    retained_projection_digest(
        b"snapback:pending-operation-terminal-receipt:v1\n",
        projection,
    )
}

fn load_validated_pending_lifecycle(
    conn: &Connection,
    proposed: &OperationIdentityV1,
) -> SnapbackResult<Option<PendingOperationLifecycleV1>> {
    let pending: Option<(String, String, String, String)> = conn
        .query_row(
            "SELECT lane,audience,epoch_id,lifecycle_json
               FROM _snapback_operation_pending_v1
              WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
            params![
                proposed.key.stream_id,
                originator(proposed.key.originator_class),
                proposed.key.operation_id,
            ],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let Some((row_lane, row_audience, row_epoch_id, pending)) = pending else {
        return Ok(None);
    };
    let pending: PendingOperationLifecycleV1 = decode(&pending, "pending operation lifecycle")?;
    reject_divergence(&pending.identity, proposed)?;
    if pending.lane != row_lane
        || pending.identity.bound_facts.audience != row_audience
        || issuance_parts(&pending.identity).0 != row_epoch_id
    {
        return Err(invalid("stored pending lifecycle is incoherent"));
    }
    let envelope: Option<String> = conn
        .query_row(
            "SELECT envelope_json FROM _snapback_commit_envelopes_v1
              WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
            params![
                proposed.key.stream_id,
                originator(proposed.key.originator_class),
                proposed.key.operation_id,
            ],
            |row| row.get(0),
        )
        .optional()?;
    let Some(envelope) = envelope else {
        return Err(invalid(
            "pending lifecycle survived without its publication envelope",
        ));
    };
    let envelope: CommitEnvelopeV1 = decode(&envelope, "pending commit envelope")?;
    envelope
        .validate()
        .map_err(|error| invalid(format!("pending commit envelope is invalid: {error:?}")))?;
    let retained_projection = serde_json::to_value(&envelope.receipt.payload)
        .map_err(|_| invalid("pending receipt projection could not be encoded"))?;
    if envelope.identity != pending.identity
        || envelope.identity != *proposed
        || envelope.receipt.state != crate::commit_envelope::OperationReceiptStateV1::Pending
        || envelope.snapshot != pending.publication
        || envelope.receipt.receipt_digest != pending.pending_receipt_digest
        || pending_operation_receipt_digest(&retained_projection)? != pending.pending_receipt_digest
        || retained_projection != pending.pending_payload
        || envelope.recorded_at_ms != pending.pending_at_ms
    {
        return Err(invalid(
            "pending lifecycle and publication envelope do not match exactly",
        ));
    }
    Ok(Some(pending))
}

pub(crate) fn lookup_pending_operation(
    conn: &Connection,
    proposed: &OperationIdentityV1,
) -> SnapbackResult<PendingOperationLookupV1> {
    proposed
        .validate()
        .map_err(|error| invalid(format!("pending operation identity is invalid: {error:?}")))?;
    let terminal: Option<(String, String, String, i64, String)> = conn
        .query_row(
            "SELECT lane,audience,epoch_id,terminal_at_ms,supplement_json
               FROM _snapback_operation_terminal_supplements_v1
              WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
            params![
                proposed.key.stream_id,
                originator(proposed.key.originator_class),
                proposed.key.operation_id,
            ],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()?;
    if let Some((row_lane, row_audience, row_epoch_id, row_terminal_at_ms, terminal)) = terminal {
        let terminal: PendingOperationTerminalSupplementV1 =
            decode(&terminal, "pending operation terminal supplement")?;
        reject_divergence(&terminal.identity, proposed)?;
        let Some(pending) = load_validated_pending_lifecycle(conn, proposed)? else {
            return Err(invalid(
                "terminal supplement survived without its pending lifecycle",
            ));
        };
        if row_lane != pending.lane
            || row_audience != terminal.identity.bound_facts.audience
            || row_epoch_id != issuance_parts(&terminal.identity).0
            || row_terminal_at_ms
                != to_i64(terminal.terminal_at_ms, "stored terminal supplement time")?
            || terminal.publication != pending.publication
            || terminal.pending_receipt_digest != pending.pending_receipt_digest
            || terminal.terminal_at_ms < pending.pending_at_ms
            || terminal.transition_digest
                != pending_operation_transition_digest(
                    &terminal.identity,
                    &terminal.publication,
                    &terminal.pending_receipt_digest,
                    terminal.terminal_outcome,
                    &terminal.terminal_receipt_digest,
                    &terminal.terminal_write_set_digest,
                    terminal.terminal_write_set_count,
                )
        {
            return Err(invalid(
                "terminal supplement does not match its pending publication",
            ));
        }
        return Ok(PendingOperationLookupV1::Terminal(terminal));
    }
    let Some(pending) = load_validated_pending_lifecycle(conn, proposed)? else {
        let envelope: Option<String> = conn
            .query_row(
                "SELECT envelope_json FROM _snapback_commit_envelopes_v1
                  WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
                params![
                    proposed.key.stream_id,
                    originator(proposed.key.originator_class),
                    proposed.key.operation_id,
                ],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(envelope) = envelope {
            let envelope: CommitEnvelopeV1 = decode(&envelope, "pending commit envelope")?;
            reject_divergence(&envelope.identity, proposed)?;
            if envelope.receipt.payload != RetainedEnvelopeDetailV1::Expired {
                return Err(invalid(
                    "pending publication envelope survived without its lifecycle",
                ));
            }
        }
        let floor: Option<i64> = conn
            .query_row(
                "SELECT floor_sequence FROM _snapback_operation_floors_v1
                 WHERE originator_class=?1 AND audience=?2",
                params![
                    originator(proposed.key.originator_class),
                    proposed.bound_facts.audience,
                ],
                |row| row.get(0),
            )
            .optional()?;
        let epoch_sequence: Option<i64> = conn
            .query_row(
                "SELECT epoch_sequence FROM _snapback_operation_epochs_v1
                 WHERE originator_class=?1 AND audience=?2 AND epoch_id=?3",
                params![
                    originator(proposed.key.originator_class),
                    proposed.bound_facts.audience,
                    issuance_parts(proposed).0,
                ],
                |row| row.get(0),
            )
            .optional()?;
        return if matches!((floor, epoch_sequence), (Some(floor), Some(epoch)) if epoch < floor) {
            Ok(PendingOperationLookupV1::IdentityHorizonPassed)
        } else {
            Ok(PendingOperationLookupV1::Novel)
        };
    };
    Ok(PendingOperationLookupV1::Pending(pending))
}

fn validated_pending_lifecycles(
    conn: &Connection,
) -> SnapbackResult<Vec<(PendingOperationLifecycleV1, bool)>> {
    let mut statement = conn.prepare(
        "SELECT stream_id,originator_class,operation_id,lifecycle_json
           FROM _snapback_operation_pending_v1",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    let rows = rows.collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    let mut retained = Vec::with_capacity(rows.len());
    for (row_stream_id, row_originator, row_operation_id, lifecycle_json) in rows {
        let lifecycle: PendingOperationLifecycleV1 =
            decode(&lifecycle_json, "pending operation lifecycle")?;
        let identity = &lifecycle.identity;
        if row_stream_id != identity.key.stream_id
            || row_originator != originator(identity.key.originator_class)
            || row_operation_id != identity.key.operation_id
        {
            return Err(invalid("pending lifecycle primary key is incoherent"));
        }
        let outcome_pending = match lookup_pending_operation(conn, identity)? {
            PendingOperationLookupV1::Pending(ref exact) if exact == &lifecycle => true,
            PendingOperationLookupV1::Terminal(_) => false,
            _ => {
                return Err(invalid("pending lifecycle is not exact retained authority"));
            }
        };
        retained.push((lifecycle, outcome_pending));
    }
    Ok(retained)
}

/// Append the terminal supplement in the caller's T-release/T-rollback
/// transaction. The Pending envelope and lifecycle row remain immutable
/// evidence of P, while this additive carrier participates independently in
/// host-window retention so the established v1 suppression wire shape does
/// not need to change.
pub(crate) fn finalize_pending_operation_in(
    tx: &Transaction<'_>,
    supplement: &PendingOperationTerminalSupplementV1,
    retained_terminal_projection: &Value,
) -> SnapbackResult<PendingOperationFinalizationV1> {
    if supplement.schema_version != 1
        || supplement.publication.association != SnapshotAssociationKindV1::ProducedCommit
        || !valid_sha256(&supplement.pending_receipt_digest)
        || !valid_sha256(&supplement.terminal_receipt_digest)
        || !valid_sha256(&supplement.terminal_write_set_digest)
        || pending_operation_terminal_receipt_digest(retained_terminal_projection)?
            != supplement.terminal_receipt_digest
        || supplement.transition_digest
            != pending_operation_transition_digest(
                &supplement.identity,
                &supplement.publication,
                &supplement.pending_receipt_digest,
                supplement.terminal_outcome,
                &supplement.terminal_receipt_digest,
                &supplement.terminal_write_set_digest,
                supplement.terminal_write_set_count,
            )
    {
        return Err(invalid("pending operation terminal supplement is invalid"));
    }
    let identity = &supplement.identity;
    let existing: Option<(String, String, String, i64, String)> = tx
        .query_row(
            "SELECT lane,audience,epoch_id,terminal_at_ms,supplement_json
               FROM _snapback_operation_terminal_supplements_v1
              WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
            params![
                identity.key.stream_id,
                originator(identity.key.originator_class),
                identity.key.operation_id,
            ],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()?;
    if let Some((row_lane, row_audience, row_epoch_id, row_terminal_at_ms, existing)) = existing {
        let existing: PendingOperationTerminalSupplementV1 =
            decode(&existing, "pending operation terminal supplement")?;
        reject_divergence(&existing.identity, identity)?;
        let Some(pending) = load_validated_pending_lifecycle(tx, identity)? else {
            return Err(invalid(
                "terminal supplement survived without its pending lifecycle",
            ));
        };
        if row_lane != pending.lane
            || row_audience != existing.identity.bound_facts.audience
            || row_epoch_id != issuance_parts(&existing.identity).0
            || row_terminal_at_ms
                != to_i64(existing.terminal_at_ms, "stored terminal supplement time")?
            || existing.publication != pending.publication
            || existing.pending_receipt_digest != pending.pending_receipt_digest
            || existing.terminal_at_ms < pending.pending_at_ms
            || existing.transition_digest
                != pending_operation_transition_digest(
                    &existing.identity,
                    &existing.publication,
                    &existing.pending_receipt_digest,
                    existing.terminal_outcome,
                    &existing.terminal_receipt_digest,
                    &existing.terminal_write_set_digest,
                    existing.terminal_write_set_count,
                )
        {
            return Err(invalid("stored terminal supplement is incoherent"));
        }
        if existing == *supplement {
            return Ok(PendingOperationFinalizationV1::ExactReplay);
        }
        return Err(refused(
            "SNAPBACK_OPERATION_TERMINAL_DIVERGED",
            "pending operation was finalized with different terminal facts",
        ));
    }
    let Some(pending) = load_validated_pending_lifecycle(tx, identity)? else {
        return Err(refused(
            "SNAPBACK_OPERATION_PENDING_NOT_FOUND",
            "terminal settlement requires the exact retained pending publication",
        ));
    };
    let lane = pending.lane.clone();
    if pending.publication != supplement.publication
        || pending.pending_receipt_digest != supplement.pending_receipt_digest
        || supplement.terminal_at_ms < pending.pending_at_ms
    {
        return Err(refused(
            "SNAPBACK_OPERATION_TERMINAL_DIVERGED",
            "terminal settlement does not link the exact pending publication and receipt digest",
        ));
    }
    let (epoch_id, _, _) = issuance_parts(identity);
    tx.execute(
        "INSERT INTO _snapback_operation_terminal_supplements_v1(
           stream_id,originator_class,operation_id,lane,audience,epoch_id,
           terminal_at_ms,supplement_json
         ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            identity.key.stream_id,
            originator(identity.key.originator_class),
            identity.key.operation_id,
            lane,
            identity.bound_facts.audience,
            epoch_id,
            to_i64(supplement.terminal_at_ms, "terminal supplement time")?,
            serde_json::to_string(supplement)
                .map_err(|_| invalid("terminal supplement could not be encoded"))?,
        ],
    )?;
    complete_host_identity_lease_in(tx, identity, supplement.terminal_at_ms)?;
    Ok(PendingOperationFinalizationV1::Applied)
}

/// Authenticate a host identity against the durable epoch authority before it
/// can enter a host-only admission seam such as promotion ticket issuance.
/// Structural `HostIncarnation` shape is insufficient: the epoch must be open,
/// its authority/authenticator must match, and its operation id must be the
/// deterministic derivation of the recorded upstream identity.
pub(crate) fn authenticate_host_identity(
    conn: &Connection,
    identity: &OperationIdentityV1,
) -> SnapbackResult<()> {
    if identity.key.originator_class != OperationOriginatorClassV1::Host
        || !matches!(
            &identity.issuance,
            OperationIssuanceV1::HostIncarnation { .. }
        )
    {
        return Err(refused(
            "SNAPBACK_HOST_OPERATION_IDENTITY_INVALID",
            "host admission requires a host-incarnation identity",
        ));
    }
    authenticate_operation_identity(conn, identity).map(|_| ())
}

fn decode_validated_host_identity_lease(
    row_stream_id: String,
    row_operation_id: String,
    row_audience: String,
    row_epoch_id: String,
    identity_json: String,
    expires_at_ms: i64,
    completed_at_ms: Option<i64>,
) -> SnapbackResult<HostIdentityLeaseV1> {
    let identity: OperationIdentityV1 = decode(&identity_json, "host identity lease")?;
    identity
        .validate()
        .map_err(|_| invalid("host identity lease identity is invalid"))?;
    if identity.key.originator_class != OperationOriginatorClassV1::Host
        || !matches!(
            &identity.issuance,
            OperationIssuanceV1::HostIncarnation { .. }
        )
        || row_stream_id != identity.key.stream_id
        || row_operation_id != identity.key.operation_id
        || row_audience != identity.bound_facts.audience
        || row_epoch_id != issuance_parts(&identity).0
        || expires_at_ms < 0
        || completed_at_ms.is_some_and(|value| value < 0)
    {
        return Err(invalid("stored host identity lease is incoherent"));
    }
    Ok(HostIdentityLeaseV1 {
        identity,
        expires_at_ms,
        completed_at_ms,
    })
}

fn load_validated_host_identity_lease(
    conn: &Connection,
    identity: &OperationIdentityV1,
) -> SnapbackResult<Option<HostIdentityLeaseV1>> {
    Ok(validated_host_identity_leases(conn)?
        .into_iter()
        .find(|lease| lease.identity.key == identity.key))
}

fn validated_host_identity_leases(conn: &Connection) -> SnapbackResult<Vec<HostIdentityLeaseV1>> {
    let mut statement = conn.prepare(
        "SELECT stream_id,operation_id,audience,epoch_id,identity_json,
                expires_at_ms,completed_at_ms
           FROM _snapback_host_identity_leases_v1",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, Option<i64>>(6)?,
        ))
    })?;
    let rows = rows.collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    let mut leases = Vec::with_capacity(rows.len());
    for (
        row_stream_id,
        row_operation_id,
        row_audience,
        row_epoch_id,
        identity_json,
        expires_at_ms,
        completed_at_ms,
    ) in rows
    {
        leases.push(decode_validated_host_identity_lease(
            row_stream_id,
            row_operation_id,
            row_audience,
            row_epoch_id,
            identity_json,
            expires_at_ms,
            completed_at_ms,
        )?);
    }
    Ok(leases)
}

/// @ref LLP 0163#implementation-record--2026-08-05-exact-c30-stop-and-c31-repair
/// — closure must derive live Host custody from globally validated identities,
/// not SQL audience/epoch accelerators that could move independently.
fn host_epoch_has_live_lease(
    conn: &Connection,
    audience: &str,
    epoch_id: &str,
    now_ms: u64,
) -> SnapbackResult<bool> {
    let now_ms = to_i64(now_ms, "host closure time")?;
    Ok(validated_host_identity_leases(conn)?
        .into_iter()
        .any(|lease| {
            lease.identity.bound_facts.audience == audience
                && issuance_parts(&lease.identity).0 == epoch_id
                && lease.completed_at_ms.is_none()
                && lease.expires_at_ms > now_ms
        }))
}

/// Retain an authenticated host-only admission identity while external work is
/// still live. Promotion tickets use this lease so incarnation rotation cannot
/// reclaim their epoch before the ticket completes or expires.
pub(crate) fn register_host_identity_lease_in(
    tx: &Transaction<'_>,
    identity: &OperationIdentityV1,
    expires_at_ms: u64,
) -> SnapbackResult<()> {
    authenticate_host_identity(tx, identity)?;
    let identity_json = serde_json::to_string(identity)
        .map_err(|_| invalid("host identity lease could not be encoded"))?;
    if let Some(existing) = load_validated_host_identity_lease(tx, identity)? {
        if existing.identity == *identity
            && existing.expires_at_ms == to_i64(expires_at_ms, "host lease expiry")?
        {
            return Ok(());
        }
        return Err(refused(
            "SNAPBACK_HOST_OPERATION_IDENTITY_REUSED",
            "host admission identity was reused with divergent lease facts",
        ));
    }
    let (epoch_id, _, _) = issuance_parts(identity);
    tx.execute(
        "INSERT INTO _snapback_host_identity_leases_v1(
           stream_id,operation_id,audience,epoch_id,identity_json,expires_at_ms
         ) VALUES(?1,?2,?3,?4,?5,?6)",
        params![
            identity.key.stream_id,
            identity.key.operation_id,
            identity.bound_facts.audience,
            epoch_id,
            identity_json,
            to_i64(expires_at_ms, "host lease expiry")?,
        ],
    )?;
    Ok(())
}

pub(crate) fn complete_host_identity_lease_in(
    tx: &Transaction<'_>,
    identity: &OperationIdentityV1,
    completed_at_ms: u64,
) -> SnapbackResult<()> {
    let Some(existing) = load_validated_host_identity_lease(tx, identity)? else {
        return Err(refused(
            "SNAPBACK_HOST_OPERATION_LEASE_INVALID",
            "host identity lease is missing, divergent, or already completed",
        ));
    };
    if existing.identity != *identity || existing.completed_at_ms.is_some() {
        return Err(refused(
            "SNAPBACK_HOST_OPERATION_LEASE_INVALID",
            "host identity lease is missing, divergent, or already completed",
        ));
    }
    let identity_json = serde_json::to_string(identity)
        .map_err(|_| invalid("host identity lease could not be encoded"))?;
    let changed = tx.execute(
        "UPDATE _snapback_host_identity_leases_v1 SET completed_at_ms=?3
         WHERE stream_id=?1 AND operation_id=?2 AND identity_json=?4
           AND completed_at_ms IS NULL",
        params![
            identity.key.stream_id,
            identity.key.operation_id,
            to_i64(completed_at_ms, "host lease completion")?,
            identity_json,
        ],
    )?;
    if changed != 1 {
        return Err(refused(
            "SNAPBACK_HOST_OPERATION_LEASE_INVALID",
            "host identity lease is missing, divergent, or already completed",
        ));
    }
    Ok(())
}

fn authenticate_operation_identity(
    conn: &Connection,
    identity: &OperationIdentityV1,
) -> SnapbackResult<i64> {
    identity.validate().map_err(|_| {
        refused(
            "SNAPBACK_OPERATION_ISSUANCE_AUTH_INVALID",
            "operation identity is structurally invalid",
        )
    })?;
    let (epoch_id, _, authenticator) = issuance_parts(identity);
    if let OperationIssuanceV1::HostIncarnation {
        upstream_identity,
        commit_ordinal,
        ..
    } = &identity.issuance
        && (upstream_identity.trim().is_empty()
            || identity.key.operation_id
                != derive_host_operation_id(upstream_identity, *commit_ordinal))
    {
        return Err(refused(
            "SNAPBACK_HOST_OPERATION_IDENTITY_INVALID",
            "host operation id does not match its authenticated upstream derivation",
        ));
    }
    let epoch: Option<(i64, String, String, String)> = conn
        .query_row(
            "SELECT epoch_sequence, authority_instance_id, authenticator_digest, state
             FROM _snapback_operation_epochs_v1
             WHERE originator_class=?1 AND audience=?2 AND epoch_id=?3",
            params![
                originator(identity.key.originator_class),
                identity.bound_facts.audience,
                epoch_id,
            ],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let Some((epoch_sequence, authority_instance, expected_authenticator, state)) = epoch else {
        return Err(refused(
            "SNAPBACK_OPERATION_EPOCH_UNAVAILABLE",
            "operation identity names an unknown server-recorded epoch",
        ));
    };
    if state != "open" {
        return Err(refused(
            "SNAPBACK_OPERATION_EPOCH_CLOSED",
            "operation identity names an epoch that cannot admit first attempts",
        ));
    }
    if authority_instance != identity.bound_facts.authority_instance_id
        || expected_authenticator != authenticator
    {
        return Err(refused(
            "SNAPBACK_OPERATION_ISSUANCE_AUTH_INVALID",
            "operation issuance does not match its server-recorded authority",
        ));
    }
    Ok(epoch_sequence)
}

pub(crate) fn lookup_operation(
    conn: &Connection,
    proposed: &OperationIdentityV1,
) -> SnapbackResult<OperationLookupV1> {
    proposed
        .validate()
        .map_err(|error| invalid(format!("operation identity is invalid: {error:?}")))?;
    let key_params = params![
        proposed.key.stream_id,
        originator(proposed.key.originator_class),
        proposed.key.operation_id,
    ];
    type OperationSuppressionRow = (
        String,
        String,
        i64,
        Option<i64>,
        i64,
        Option<i64>,
        String,
        String,
    );
    let row: Option<OperationSuppressionRow> = conn
        .query_row(
            "SELECT audience, epoch_id, epoch_sequence, counter,
                    terminal_at_ms, acknowledged_at_ms,
                    identity_json, record_json
             FROM _snapback_operation_suppression_v1
             WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
            key_params,
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            },
        )
        .optional()?;
    if let Some((
        row_audience,
        row_epoch_id,
        row_epoch_sequence,
        row_counter,
        row_terminal_at_ms,
        row_acknowledged_at_ms,
        identity_json,
        record_json,
    )) = row
    {
        let identity: OperationIdentityV1 = decode(&identity_json, "stored operation identity")?;
        let record: OperationSuppressionRecordV1 =
            decode(&record_json, "stored suppression record")?;
        let (identity_epoch_id, identity_counter, _) = issuance_parts(&identity);
        let referenced_epoch_sequence: Option<i64> = conn
            .query_row(
                "SELECT epoch_sequence FROM _snapback_operation_epochs_v1
                 WHERE originator_class=?1 AND audience=?2 AND epoch_id=?3",
                params![
                    originator(identity.key.originator_class),
                    row_audience,
                    row_epoch_id,
                ],
                |row| row.get(0),
            )
            .optional()?;
        if identity.validate().is_err()
            || record.schema_version != 1
            || record.identity != identity
            || !valid_sha256(&record.receipt_digest)
            || identity.key != proposed.key
            || identity.bound_facts.audience != row_audience
            || identity_epoch_id != row_epoch_id
            || optional_i64(identity_counter, "stored operation counter")? != row_counter
            || to_i64(record.terminal_at_ms, "stored operation terminal time")?
                != row_terminal_at_ms
            || optional_i64(
                record.acknowledged_at_ms,
                "stored operation acknowledgement time",
            )? != row_acknowledged_at_ms
            || referenced_epoch_sequence != Some(row_epoch_sequence)
        {
            return Err(invalid("stored operation suppression is incoherent"));
        }
        reject_divergence(&identity, proposed)?;
        return Ok(OperationLookupV1::ExactReplay(Box::new(record)));
    }

    // @ref LLP 0043#dated-c28-lifecycle-reconciliation-2026-08-05 — a
    // payload-free tombstone remains complete collision authority after the
    // compact envelope leaves.
    let tombstone: Option<(String, String, i64, Option<i64>, String)> = conn
        .query_row(
            "SELECT audience, epoch_id, epoch_sequence, counter, tombstone_json
             FROM _snapback_operation_tombstones_v1
             WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
            params![
                proposed.key.stream_id,
                originator(proposed.key.originator_class),
                proposed.key.operation_id,
            ],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()?;
    if let Some((row_audience, row_epoch_id, row_epoch_sequence, row_counter, tombstone)) =
        tombstone
    {
        let tombstone: OperationIdentityTombstoneV1 =
            decode(&tombstone, "stored operation tombstone")?;
        let referenced_epoch_sequence: Option<i64> = conn
            .query_row(
                "SELECT epoch_sequence FROM _snapback_operation_epochs_v1
                 WHERE originator_class=?1 AND audience=?2 AND epoch_id=?3",
                params![
                    originator(proposed.key.originator_class),
                    row_audience,
                    row_epoch_id,
                ],
                |row| row.get(0),
            )
            .optional()?;
        if tombstone.schema_version != 1
            || tombstone.key != proposed.key
            || tombstone.audience.is_empty()
            || tombstone.epoch_id.is_empty()
            || row_audience != tombstone.audience
            || row_epoch_id != tombstone.epoch_id
            || optional_i64(tombstone.counter, "stored tombstone counter")? != row_counter
            || (proposed.key.originator_class == OperationOriginatorClassV1::Client)
                != tombstone.counter.is_some()
            || referenced_epoch_sequence != Some(row_epoch_sequence)
            || !valid_sha256(&tombstone.identity_digest)
            || !valid_sha256(&tombstone.auth_facts_digest)
            || !valid_sha256(&tombstone.receipt_digest)
        {
            return Err(invalid("stored operation tombstone is incoherent"));
        }
        let proposed_identity_digest = operation_identity_digest(proposed)?;
        let proposed_auth_facts_digest = operation_auth_facts_digest(proposed)?;
        if tombstone.identity_digest != proposed_identity_digest {
            return Err(refused(
                if tombstone.auth_facts_digest != proposed_auth_facts_digest {
                    "SNAPBACK_AUTH_STALE_RESULT"
                } else {
                    "SNAPBACK_CLIENT_MUTATION_ID_REUSED"
                },
                "operation tombstone collides with divergent bound identity facts",
            ));
        }
        if tombstone.auth_facts_digest != proposed_auth_facts_digest
            || tombstone.audience != proposed.bound_facts.audience
            || tombstone.epoch_id != issuance_parts(proposed).0
        {
            return Err(invalid(
                "stored operation tombstone digests and lookup facts diverged",
            ));
        }
        return Ok(OperationLookupV1::ResultExpired {
            outcome: tombstone.terminal_outcome,
            receipt_digest: tombstone.receipt_digest,
        });
    }

    let compact: Option<String> = conn
        .query_row(
            "SELECT envelope_json FROM _snapback_commit_envelopes_v1
             WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
            params![
                proposed.key.stream_id,
                originator(proposed.key.originator_class),
                proposed.key.operation_id,
            ],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(compact) = compact {
        let envelope: CommitEnvelopeV1 = decode(&compact, "stored compact envelope")?;
        reject_divergence(&envelope.identity, proposed)?;
        return Ok(OperationLookupV1::ResultExpired {
            outcome: match envelope.receipt.state {
                crate::commit_envelope::OperationReceiptStateV1::Committed => {
                    OperationTerminalOutcomeV1::Committed
                }
                crate::commit_envelope::OperationReceiptStateV1::Refused => {
                    OperationTerminalOutcomeV1::Refused
                }
                crate::commit_envelope::OperationReceiptStateV1::Pending => {
                    return Err(invalid("compact envelope retained a pending receipt"));
                }
            },
            receipt_digest: envelope.receipt.receipt_digest,
        });
    }

    let floor: Option<i64> = conn
        .query_row(
            "SELECT floor_sequence FROM _snapback_operation_floors_v1
             WHERE originator_class=?1 AND audience=?2",
            params![
                originator(proposed.key.originator_class),
                proposed.bound_facts.audience,
            ],
            |row| row.get(0),
        )
        .optional()?;
    let epoch_sequence: Option<i64> = conn
        .query_row(
            "SELECT epoch_sequence FROM _snapback_operation_epochs_v1
             WHERE originator_class=?1 AND audience=?2 AND epoch_id=?3",
            params![
                originator(proposed.key.originator_class),
                proposed.bound_facts.audience,
                issuance_parts(proposed).0,
            ],
            |row| row.get(0),
        )
        .optional()?;
    if matches!((floor, epoch_sequence), (Some(floor), Some(epoch)) if epoch < floor) {
        return Ok(OperationLookupV1::IdentityHorizonPassed);
    }
    Ok(OperationLookupV1::Novel)
}

pub(crate) fn acknowledge_and_reclaim_in(
    tx: &Transaction<'_>,
    identity: &OperationIdentityV1,
    acknowledged_at_ms: u64,
) -> SnapbackResult<()> {
    let record: Option<String> = tx
        .query_row(
            "SELECT record_json FROM _snapback_operation_suppression_v1
             WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
            params![
                identity.key.stream_id,
                originator(identity.key.originator_class),
                identity.key.operation_id,
            ],
            |row| row.get(0),
        )
        .optional()?;
    let Some(record) = record else {
        return Ok(());
    };
    let mut record: OperationSuppressionRecordV1 = decode(&record, "suppression record")?;
    reject_divergence(&record.identity, identity)?;
    record.acknowledged_at_ms = Some(acknowledged_at_ms);
    let epoch_id = issuance_parts(identity).0.to_owned();
    let epoch: (i64, String) = tx.query_row(
        "SELECT epoch_sequence, state FROM _snapback_operation_epochs_v1
         WHERE originator_class=?1 AND audience=?2 AND epoch_id=?3",
        params![
            originator(identity.key.originator_class),
            identity.bound_facts.audience,
            epoch_id,
        ],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let tombstone = OperationIdentityTombstoneV1 {
        schema_version: 1,
        key: identity.key.clone(),
        identity_digest: operation_identity_digest(identity)?,
        auth_facts_digest: operation_auth_facts_digest(identity)?,
        audience: identity.bound_facts.audience.clone(),
        epoch_id,
        counter: issuance_parts(identity).1,
        terminal_outcome: record.terminal_outcome,
        receipt_digest: record.receipt_digest.clone(),
        retained_at_ms: acknowledged_at_ms,
    };
    tx.execute(
        "INSERT INTO _snapback_operation_tombstones_v1(
           stream_id, originator_class, operation_id, audience, epoch_id,
           epoch_sequence, counter, tombstone_json
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            identity.key.stream_id,
            originator(identity.key.originator_class),
            identity.key.operation_id,
            identity.bound_facts.audience,
            tombstone.epoch_id,
            epoch.0,
            optional_i64(issuance_parts(identity).1, "operation counter")?,
            serde_json::to_string(&tombstone)
                .map_err(|_| invalid("operation tombstone could not be encoded"))?,
        ],
    )?;
    tx.execute(
        "DELETE FROM _snapback_operation_suppression_v1
         WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
        params![
            identity.key.stream_id,
            originator(identity.key.originator_class),
            identity.key.operation_id,
        ],
    )?;
    // A pending operation's terminal supplement is a bounded transition
    // record, not a second forever-retained receipt. Once the owning
    // suppression result is compacted, the ordinary tombstone above carries
    // the outcome/digest anti-replay fact and both lifecycle rows can leave.
    tx.execute(
        "DELETE FROM _snapback_operation_terminal_supplements_v1
         WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
        params![
            identity.key.stream_id,
            originator(identity.key.originator_class),
            identity.key.operation_id,
        ],
    )?;
    tx.execute(
        "DELETE FROM _snapback_operation_pending_v1
         WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
        params![
            identity.key.stream_id,
            originator(identity.key.originator_class),
            identity.key.operation_id,
        ],
    )?;
    compact_envelope_receipt_in(tx, identity)?;
    Ok(())
}

pub(crate) fn acknowledge_client_operation_by_id_in(
    tx: &Transaction<'_>,
    client_mutation_id: &str,
    principal_fingerprint: &str,
    authority_instance_id: Option<&str>,
    acknowledged_at_ms: u64,
) -> SnapbackResult<u64> {
    let mut statement = tx.prepare(
        "SELECT identity_json FROM _snapback_operation_suppression_v1
         WHERE originator_class='client' AND operation_id=?1",
    )?;
    let rows = statement
        .query_map(params![client_mutation_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut matched = 0_u64;
    for body in rows {
        let identity: OperationIdentityV1 = decode(&body, "client operation identity")?;
        if identity.bound_facts.principal_fingerprint != principal_fingerprint
            || authority_instance_id
                .is_some_and(|expected| identity.bound_facts.authority_instance_id != expected)
        {
            continue;
        }
        acknowledge_and_reclaim_in(tx, &identity, acknowledged_at_ms)?;
        matched += 1;
    }
    Ok(matched)
}

/// Convert every covered suppression row selected by an administrative
/// settlement purge into the same compact/tombstone state as ACK reclamation,
/// then append one payload-free audit record in the caller's transaction.
/// This intentionally forfeits replay of the full result while preserving
/// anti-duplication and the `result-expired`/floor lookup order.
///
/// @ref LLP 0162#acceptance — row 14 requires operator purge to be explicit,
///   recorded, and unable to turn a retained operation into a novel write.
pub(crate) fn operator_purge_client_operations_in(
    tx: &Transaction<'_>,
    selector_class: &str,
    selector_digest: &str,
    settlements: &[(String, String, Option<String>)],
    recorded_at_ms: u64,
) -> SnapbackResult<u64> {
    if !matches!(selector_class, "auth" | "all") || !valid_sha256(selector_digest) {
        return Err(invalid("operation purge selector is invalid"));
    }
    let stream_id = crate::seed_identity::strict_current_data_version_stream(tx)?;
    let mut reclaimed = Vec::new();
    for (operation_id, principal_fingerprint, authority_instance_id) in settlements {
        let Some(stream_id) = stream_id.as_deref() else {
            // Pre-0163 databases can retain predecessor settlement rows
            // without any operation stream. They still receive the explicit
            // payload-free purge audit, with zero operation keys reclaimed.
            continue;
        };
        let mut statement = tx.prepare(
            "SELECT identity_json FROM _snapback_operation_suppression_v1
              WHERE stream_id=?1 AND originator_class='client' AND operation_id=?2",
        )?;
        let bodies = statement
            .query_map(params![stream_id, operation_id], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        for body in bodies {
            let identity: OperationIdentityV1 = decode(&body, "purged operation identity")?;
            if identity.bound_facts.principal_fingerprint != *principal_fingerprint
                || authority_instance_id
                    .as_ref()
                    .is_some_and(|expected| identity.bound_facts.authority_instance_id != *expected)
            {
                return Err(invalid(
                    "operator purge settlement and operation authority diverged",
                ));
            }
            acknowledge_and_reclaim_in(tx, &identity, recorded_at_ms)?;
            reclaimed.push(identity.key);
        }
    }
    reclaimed.sort();
    reclaimed.dedup();
    let operation_keys_digest = digest_json(
        b"snapback:operation-purge-keys:v1\n",
        &serde_json::to_value(&reclaimed)
            .map_err(|_| invalid("operation purge keys could not be encoded"))?,
    );
    let purge_id = crate::ids::mint_time_ordered(crate::ids::Kind::Opaque);
    tx.execute(
        "INSERT INTO _snapback_operation_purges_v1(
           purge_id,selector_class,selector_digest,settlement_count,
           operation_count,operation_keys_digest,recorded_at_ms
         ) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![
            purge_id,
            selector_class,
            selector_digest,
            to_i64(settlements.len() as u64, "purged settlement count")?,
            to_i64(reclaimed.len() as u64, "purged operation count")?,
            operation_keys_digest,
            to_i64(recorded_at_ms, "operation purge time")?,
        ],
    )?;
    Ok(reclaimed.len() as u64)
}

pub(crate) fn terminate_epoch_in(
    tx: &Transaction<'_>,
    originator_class: OperationOriginatorClassV1,
    audience: &str,
    epoch_id: &str,
    revoked: bool,
    at_ms: u64,
) -> SnapbackResult<()> {
    let changed = tx.execute(
        "UPDATE _snapback_operation_epochs_v1
         SET state=?1, terminated_at_ms=?2
         WHERE originator_class=?3 AND audience=?4 AND epoch_id=?5 AND state='open'",
        params![
            if revoked { "revoked" } else { "terminated" },
            to_i64(at_ms, "epoch termination time")?,
            originator(originator_class),
            audience,
            epoch_id,
        ],
    )?;
    if changed != 1 {
        return Err(refused(
            "SNAPBACK_OPERATION_EPOCH_STATE_INVALID",
            "only an open epoch can terminate or revoke",
        ));
    }
    Ok(())
}

/// Close an epoch only when its originator-specific predicate is complete and
/// advance the per-audience floor atomically with tombstone reclamation.
///
/// @ref LLP 0163#implementation-record--2026-08-05-c27-abandonment-and-c28-lifecycle-repair
/// — only the contiguous closed prefix may advance the floor.
pub(crate) fn close_epoch_if_complete_in(
    tx: &Transaction<'_>,
    originator_class: OperationOriginatorClassV1,
    audience: &str,
    epoch_id: &str,
    now_ms: u64,
) -> SnapbackResult<bool> {
    let row: Option<(i64, String)> = tx
        .query_row(
            "SELECT epoch_sequence, state FROM _snapback_operation_epochs_v1
             WHERE originator_class=?1 AND audience=?2 AND epoch_id=?3",
            params![originator(originator_class), audience, epoch_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((_sequence, state)) = row else {
        return Ok(false);
    };
    if state == "open" || state == "closed" {
        return Ok(false);
    }
    let ready = match originator_class {
        OperationOriginatorClassV1::Client => {
            // Use the JSON identity as authority for the SQL lookup
            // projections. A moved unacknowledged receipt must fail closed,
            // not disappear from client-epoch closure.
            let unacknowledged = !suppression_identities_for_epoch(
                tx,
                OperationOriginatorClassV1::Client,
                audience,
                epoch_id,
            )?
            .is_empty();
            if unacknowledged {
                false
            } else {
                let live_range: bool = tx.query_row(
                    "SELECT EXISTS(
                       SELECT 1 FROM _snapback_operation_ranges_v1
                       WHERE audience=?1 AND epoch_id=?2 AND expires_at_ms > ?3
                     )",
                    params![audience, epoch_id, to_i64(now_ms, "closure time")?],
                    |row| row.get(0),
                )?;
                !live_range
            }
        }
        OperationOriginatorClassV1::Host => {
            let rotation_recorded: bool = tx.query_row(
                "SELECT EXISTS(
                   SELECT 1
                   FROM _snapback_operation_epochs_v1 AS retired
                   JOIN _snapback_operation_epochs_v1 AS successor
                     ON successor.originator_class='host'
                    AND successor.audience=retired.audience
                    AND successor.epoch_id=retired.successor_epoch_id
                    AND successor.epoch_sequence=retired.epoch_sequence + 1
                    AND successor.authority_instance_id <> retired.authority_instance_id
                   WHERE retired.originator_class='host'
                     AND retired.audience=?1 AND retired.epoch_id=?2
                     AND retired.rotated_at_ms <= ?3
                 )",
                params![audience, epoch_id, to_i64(now_ms, "host closure time")?],
                |row| row.get(0),
            )?;
            if !rotation_recorded {
                false
            } else {
                // The retention decision below uses the SQL terminal-time
                // projection. Re-run the exact lookup classifier first so a
                // divergent SQL/JSON projection fails closed instead of
                // shortening the host receipt window.
                for identity in suppression_identities_for_epoch(
                    tx,
                    OperationOriginatorClassV1::Host,
                    audience,
                    epoch_id,
                )? {
                    if !matches!(
                        lookup_operation(tx, &identity)?,
                        OperationLookupV1::ExactReplay(_)
                    ) {
                        return Err(invalid(
                            "host suppression row is not exact retained authority",
                        ));
                    }
                }
                // Lease audience/epoch columns are lookup accelerators, not
                // authority. Enumerate and compare them with identity_json so
                // a moved live lease cannot disappear from epoch closure.
                let live_host_lease = host_epoch_has_live_lease(tx, audience, epoch_id, now_ms)?;
                let outcome_pending = host_epoch_has_outcome_pending(tx, audience, epoch_id)?;
                // Validate every Host terminal supplement before trusting its
                // SQL audience/epoch/time projections in the retention query.
                // The helper enumerates globally, so a corrupt projection
                // cannot hide the young record by moving it out of this epoch.
                let _ = pending_terminal_identities_for_epoch(tx, audience, epoch_id)?;
                let young: bool = tx.query_row(
                    "SELECT EXISTS(
                       SELECT 1 FROM _snapback_operation_suppression_v1
                       WHERE originator_class='host' AND audience=?1 AND epoch_id=?2
                         AND terminal_at_ms > ?3
                       UNION ALL
                       SELECT 1 FROM _snapback_operation_terminal_supplements_v1
                       WHERE originator_class='host' AND audience=?1 AND epoch_id=?2
                         AND terminal_at_ms > ?3
                     )",
                    params![
                        audience,
                        epoch_id,
                        to_i64(
                            now_ms.saturating_sub(HOST_RECEIPT_WINDOW_MS_V1),
                            "host retention threshold",
                        )?,
                    ],
                    |row| row.get(0),
                )?;
                !live_host_lease && !outcome_pending && !young
            }
        }
    };
    if !ready {
        return Ok(false);
    }
    if originator_class == OperationOriginatorClassV1::Host {
        let keys = suppression_identities_for_epoch(tx, originator_class, audience, epoch_id)?;
        for identity in keys {
            acknowledge_and_reclaim_in(tx, &identity, now_ms)?;
        }
        let pending_keys = pending_terminal_identities_for_epoch(tx, audience, epoch_id)?;
        for identity in pending_keys {
            compact_envelope_receipt_in(tx, &identity)?;
            tx.execute(
                "DELETE FROM _snapback_operation_terminal_supplements_v1
                 WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
                params![
                    identity.key.stream_id,
                    originator(identity.key.originator_class),
                    identity.key.operation_id,
                ],
            )?;
            tx.execute(
                "DELETE FROM _snapback_operation_pending_v1
                 WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
                params![
                    identity.key.stream_id,
                    originator(identity.key.originator_class),
                    identity.key.operation_id,
                ],
            )?;
        }
        tx.execute(
            "DELETE FROM _snapback_host_identity_leases_v1
             WHERE audience=?1 AND epoch_id=?2",
            params![audience, epoch_id],
        )?;
    }
    tx.execute(
        "UPDATE _snapback_operation_epochs_v1 SET state='closed'
         WHERE originator_class=?1 AND audience=?2 AND epoch_id=?3",
        params![originator(originator_class), audience, epoch_id],
    )?;
    // A later ready epoch may close before an earlier one. The audience floor
    // is the first still-nonclosed sequence, never merely named+1; otherwise a
    // later close could strand a live earlier identity and erase its tombstone.
    let next_floor: i64 = tx.query_row(
        "SELECT COALESCE(
           (SELECT MIN(epoch_sequence)
              FROM _snapback_operation_epochs_v1
             WHERE originator_class=?1 AND audience=?2 AND state <> 'closed'),
           (SELECT COALESCE(MAX(epoch_sequence), -1) + 1
              FROM _snapback_operation_epochs_v1
             WHERE originator_class=?1 AND audience=?2)
         )",
        params![originator(originator_class), audience],
        |row| row.get(0),
    )?;
    let retained_floor: Option<i64> = tx
        .query_row(
            "SELECT floor_sequence FROM _snapback_operation_floors_v1
             WHERE originator_class=?1 AND audience=?2",
            params![originator(originator_class), audience],
            |row| row.get(0),
        )
        .optional()?;
    if retained_floor.is_some_and(|floor| floor > next_floor) {
        return Err(invalid(
            "identity floor already advances past a nonclosed earlier epoch",
        ));
    }
    tx.execute(
        "INSERT INTO _snapback_operation_floors_v1(
           originator_class, audience, floor_sequence, updated_at_ms
         ) VALUES(?1, ?2, ?3, ?4)
         ON CONFLICT(originator_class, audience) DO UPDATE SET
           floor_sequence=MAX(floor_sequence, excluded.floor_sequence),
           updated_at_ms=excluded.updated_at_ms",
        params![
            originator(originator_class),
            audience,
            next_floor,
            to_i64(now_ms, "floor update time")?,
        ],
    )?;
    tx.execute(
        "DELETE FROM _snapback_operation_tombstones_v1
         WHERE originator_class=?1 AND audience=?2 AND epoch_sequence < ?3",
        params![originator(originator_class), audience, next_floor],
    )?;
    Ok(true)
}

pub(crate) fn explain_operation(
    conn: &Connection,
    identity: &OperationIdentityV1,
    authority: &CurrentExplanationAuthorityV1,
) -> SnapbackResult<Option<StoredOperationExplanationV1>> {
    let body: Option<String> = conn
        .query_row(
            "SELECT envelope_json FROM _snapback_commit_envelopes_v1
             WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
            params![
                identity.key.stream_id,
                originator(identity.key.originator_class),
                identity.key.operation_id,
            ],
            |row| row.get(0),
        )
        .optional()?;
    let Some(body) = body else {
        return Ok(None);
    };
    let envelope: CommitEnvelopeV1 = decode(&body, "commit envelope")?;
    if envelope.identity != *identity {
        if authority.administrative {
            reject_divergence(&envelope.identity, identity)?;
        } else {
            // @ref LLP 0163#implementation-record--2026-08-04-explanation-and-protected-custody — public non-exact lookups use one metadata-free refusal; admin retains exact diagnostics.
            // The public lane has one closed answer for a non-exact lookup.
            // Reused/auth-stale classification is settlement authority, not
            // a cross-principal operation-existence oracle.
            return Ok(Some(authorization_unprovable(envelope)));
        }
    }
    Ok(Some(project_explanation(conn, envelope, authority)?))
}

/// Independent compact-envelope retention clock. Suppression/tombstone/floor
/// state remains untouched, so pruning cannot turn a known identity novel.
pub(crate) fn prune_compact_envelope_in(
    tx: &Transaction<'_>,
    identity: &OperationIdentityV1,
) -> SnapbackResult<bool> {
    let body: Option<String> = tx
        .query_row(
            "SELECT envelope_json FROM _snapback_commit_envelopes_v1
             WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
            params![
                identity.key.stream_id,
                originator(identity.key.originator_class),
                identity.key.operation_id,
            ],
            |row| row.get(0),
        )
        .optional()?;
    let Some(body) = body else {
        return Ok(false);
    };
    let envelope: CommitEnvelopeV1 = decode(&body, "commit envelope")?;
    reject_divergence(&envelope.identity, identity)?;
    delete_protected_detail_in(tx, &envelope)?;
    Ok(tx.execute(
        "DELETE FROM _snapback_commit_envelopes_v1
         WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
        params![
            identity.key.stream_id,
            originator(identity.key.originator_class),
            identity.key.operation_id,
        ],
    )? == 1)
}

/// Independent detail clock: retain compact digests/counts while making the
/// absence explicit. Protected custody is not opened by this operation.
pub(crate) fn expire_envelope_detail_in(
    tx: &Transaction<'_>,
    identity: &OperationIdentityV1,
) -> SnapbackResult<bool> {
    let body: Option<String> = tx
        .query_row(
            "SELECT envelope_json FROM _snapback_commit_envelopes_v1
             WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
            params![
                identity.key.stream_id,
                originator(identity.key.originator_class),
                identity.key.operation_id,
            ],
            |row| row.get(0),
        )
        .optional()?;
    let Some(body) = body else {
        return Ok(false);
    };
    let mut envelope: CommitEnvelopeV1 = decode(&body, "commit envelope")?;
    delete_protected_detail_in(tx, &envelope)?;
    envelope.read_set.detail = RetainedEnvelopeDetailV1::Expired;
    envelope.write_set.detail = RetainedEnvelopeDetailV1::Expired;
    envelope.ctx_answers.detail = RetainedEnvelopeDetailV1::Expired;
    envelope.effects.facts.detail = RetainedEnvelopeDetailV1::Expired;
    envelope.receipt.payload = RetainedEnvelopeDetailV1::Expired;
    tx.execute(
        "UPDATE _snapback_commit_envelopes_v1 SET envelope_json=?1
         WHERE stream_id=?2 AND originator_class=?3 AND operation_id=?4",
        params![
            serde_json::to_string(&envelope)
                .map_err(|_| invalid("expired envelope could not be encoded"))?,
            identity.key.stream_id,
            originator(identity.key.originator_class),
            identity.key.operation_id,
        ],
    )?;
    Ok(true)
}

pub(crate) fn enumerate_explanations(
    conn: &Connection,
    query: &ExplanationQueryV1,
    authority: &CurrentExplanationAuthorityV1,
) -> SnapbackResult<Vec<StoredOperationExplanationV1>> {
    if query.limit == 0 || query.limit > OPERATION_EXPLANATION_MAX_RESULTS_V1 {
        return Err(refused(
            "SNAPBACK_OPERATION_EXPLANATION_LIMIT_INVALID",
            "explanation enumeration limit is outside the declared bound",
        ));
    }
    if query.principal_fingerprint.is_none()
        && query.principal_session_or_invocation_id.is_none()
        && query.recorded_at_or_after_ms.is_none()
        && query.recorded_before_ms.is_none()
    {
        return Err(refused(
            "SNAPBACK_OPERATION_EXPLANATION_QUERY_UNBOUNDED",
            "enumeration requires a principal, session, or time bound",
        ));
    }
    let mut statement = conn.prepare(
        "SELECT envelope_json FROM _snapback_commit_envelopes_v1
         WHERE audience=?1
           AND (?2 IS NULL OR principal_fingerprint=?2)
           AND (?3 IS NULL OR principal_session_id=?3)
           AND (?4 IS NULL OR recorded_at_ms>=?4)
           AND (?5 IS NULL OR recorded_at_ms<?5)
         ORDER BY recorded_at_ms DESC, stream_id, originator_class, operation_id
         LIMIT ?6",
    )?;
    let rows = statement.query_map(
        params![
            authority.audience,
            query.principal_fingerprint,
            query.principal_session_or_invocation_id,
            optional_i64(query.recorded_at_or_after_ms, "enumeration start")?,
            optional_i64(query.recorded_before_ms, "enumeration end")?,
            to_i64(query.limit as u64, "enumeration limit")?,
        ],
        |row| row.get::<_, String>(0),
    )?;
    let mut projected = Vec::new();
    for row in rows {
        let envelope: CommitEnvelopeV1 = decode(&row?, "enumerated commit envelope")?;
        projected.push(project_explanation(conn, envelope, authority)?);
    }
    Ok(projected)
}

fn project_explanation(
    conn: &Connection,
    envelope: CommitEnvelopeV1,
    authority: &CurrentExplanationAuthorityV1,
) -> SnapbackResult<StoredOperationExplanationV1> {
    let bound = &envelope.identity.bound_facts;
    let authorized = authority.current_policy_provable
        && authority.audience == bound.audience
        && (authority.administrative
            || (authority.principal_fingerprint == bound.principal_fingerprint
                && authority.authority_instance_id == bound.authority_instance_id
                && matches!(
                    (&envelope.executable_artifact_digest, &authority.current_artifact_digest),
                    (crate::commit_envelope::LaneFactV1::Defined(recorded), Some(current))
                        if recorded == current
                )));
    if !authorized {
        return Ok(authorization_unprovable(envelope));
    }
    let journal_count =
        if envelope.snapshot.association == SnapshotAssociationKindV1::ProducedCommit {
            conn.query_row(
                "SELECT COUNT(*) FROM _snapback_changes WHERE version=?1",
                params![to_i64(envelope.snapshot.version, "snapshot version")?],
                |row| row.get::<_, u64>(0),
            )?
        } else {
            0
        };
    let (mut disposition, mut detail) = detail_projection(conn, &envelope);
    if !authority.administrative {
        // Public authorization is per retained fact. Truncation, expiry, or
        // unavailable custody means at least one constituent can no longer be
        // evaluated, so even aggregate counts/digests are withheld.
        let public_detail = (disposition == ExplanationDispositionV1::Complete)
            .then(|| {
                detail.as_ref().and_then(|detail| {
                    public_fact_policy_projection(conn, &envelope, detail, &authority.fact_policy)
                        .ok()
                        .flatten()
                })
            })
            .flatten();
        let Some(public_detail) = public_detail else {
            return Ok(authorization_unprovable(envelope));
        };
        detail = Some(public_detail);
    }
    if envelope.snapshot.association == SnapshotAssociationKindV1::ProducedCommit
        && journal_count < envelope.write_set.count
    {
        disposition = ExplanationDispositionV1::JournalExpired;
    }
    Ok(StoredOperationExplanationV1 {
        read_set_digest: Some(envelope.read_set.digest.clone()),
        read_set_count: Some(envelope.read_set.count),
        write_set_digest: Some(envelope.write_set.digest.clone()),
        write_set_count: Some(envelope.write_set.count),
        envelope,
        disposition,
        detail,
    })
}

fn authorization_unprovable(envelope: CommitEnvelopeV1) -> StoredOperationExplanationV1 {
    StoredOperationExplanationV1 {
        envelope,
        disposition: ExplanationDispositionV1::AuthorizationUnprovable,
        read_set_digest: None,
        read_set_count: None,
        write_set_digest: None,
        write_set_count: None,
        detail: None,
    }
}

/// Evaluate the exact, finite public fact policy after protected custody has
/// authenticated and opened every retained payload. Any unknown shape or
/// unsupported class returns false; there is no permissive default.
///
/// @ref LLP 0162#acceptance — row facts require current plus retained-value
///   policy; missing/predicate/membership/context/effect facts are decided per
///   class, and one unprovable constituent redacts the whole aggregate.
fn public_fact_policy_projection(
    conn: &Connection,
    envelope: &CommitEnvelopeV1,
    detail: &Value,
    policy: &ExplanationFactPolicyV1,
) -> SnapbackResult<Option<Value>> {
    let ExplanationFactPolicyV1::OwnerMutationV1 {
        subject,
        table,
        owner_field,
        kind,
        create_mint_site,
    } = policy
    else {
        return Ok(None);
    };
    // Public row/ctx/receipt detail is admitted only through authenticated
    // protected custody. Empty effect facts are the one payload-free class.
    if envelope.read_set.provenance != FactProvenanceV1::ServerCaptured
        || envelope.write_set.provenance != FactProvenanceV1::ServerCaptured
        || envelope.ctx_answers.provenance != FactProvenanceV1::ServerCaptured
        || envelope.effects.facts.provenance != FactProvenanceV1::ServerCaptured
        || !matches!(
            envelope.read_set.detail,
            RetainedEnvelopeDetailV1::ProtectedLane { .. }
        )
        || !matches!(
            envelope.write_set.detail,
            RetainedEnvelopeDetailV1::ProtectedLane { .. }
        )
        || !matches!(
            envelope.ctx_answers.detail,
            RetainedEnvelopeDetailV1::ProtectedLane { .. }
        )
        || !matches!(
            envelope.receipt.payload,
            RetainedEnvelopeDetailV1::ProtectedLane { .. }
        )
        || envelope.effects.facts.count != 0
        || !envelope.effects.egress_families.is_empty()
        || !envelope.effects.settlement_capabilities.is_empty()
        || !matches!(
            &envelope.effects.facts.detail,
            RetainedEnvelopeDetailV1::InlineRedacted { detail }
                if detail == &json!([])
        )
        || envelope.effects.facts.digest
            != digest_fact_set(b"snapback:operation-effects:v1\n", &json!([]))
    {
        return Ok(None);
    }
    let Some(object) = detail.as_object() else {
        return Ok(None);
    };
    if object.len() != 5
        || !["readSet", "writeSet", "effects", "ctxAnswers", "receipt"]
            .iter()
            .all(|name| object.contains_key(*name))
    {
        return Ok(None);
    }
    let Some(read_value) = object.get("readSet") else {
        return Ok(None);
    };
    let Some(write_value) = object.get("writeSet") else {
        return Ok(None);
    };
    let Some(effect_value) = object.get("effects") else {
        return Ok(None);
    };
    let Some(ctx_value) = object.get("ctxAnswers") else {
        return Ok(None);
    };
    let Some(receipt_value) = object.get("receipt") else {
        return Ok(None);
    };
    if effect_value
        .as_array()
        .is_none_or(|effects| !effects.is_empty())
    {
        return Ok(None);
    }
    let reads: Vec<crate::storage::CapturedReadDependency> =
        match serde_json::from_value(read_value.clone()) {
            Ok(reads) => reads,
            Err(_) => return Ok(None),
        };
    let writes: Vec<crate::storage::ChangedRow> = match serde_json::from_value(write_value.clone())
    {
        Ok(writes) => writes,
        Err(_) => return Ok(None),
    };
    if reads.len() as u64 != envelope.read_set.count
        || writes.len() as u64 != envelope.write_set.count
        || serde_json::to_value(&reads).ok().as_ref() != Some(read_value)
        || serde_json::to_value(&writes).ok().as_ref() != Some(write_value)
    {
        return Ok(None);
    }
    let ctx: crate::manifest::CtxAnswerLedger = match serde_json::from_value(ctx_value.clone()) {
        Ok(ctx) => ctx,
        Err(_) => return Ok(None),
    };
    if envelope.ctx_answers.count != 1
        || ctx.version != crate::manifest::ctx_ledger_version()
        || ctx.auth_fingerprint.is_some()
        || serde_json::to_value(&ctx).ok().as_ref() != Some(ctx_value)
    {
        return Ok(None);
    }
    let receipt: crate::manifest::MutationOutput =
        match serde_json::from_value(receipt_value.clone()) {
            Ok(receipt) => receipt,
            Err(_) => return Ok(None),
        };
    if serde_json::to_value(&receipt).ok().as_ref() != Some(receipt_value) {
        return Ok(None);
    }
    let row_writes = writes
        .iter()
        .filter(|write| write.table == *table)
        .collect::<Vec<_>>();
    if row_writes.len() != 1 || writes.len() != 1 {
        return Ok(None);
    }
    let write = row_writes[0];
    let expected_op = match kind {
        OwnerMutationExplanationKindV1::Create => crate::storage::ChangeOp::Insert,
        OwnerMutationExplanationKindV1::Update => crate::storage::ChangeOp::Update,
        OwnerMutationExplanationKindV1::Delete => crate::storage::ChangeOp::Delete,
    };
    if write.op != expected_op
        || write
            .row
            .as_ref()
            .and_then(Value::as_object)
            .and_then(|row| row.get(owner_field))
            .and_then(Value::as_str)
            != Some(subject)
    {
        return Ok(None);
    }
    // @ref LLP 0088#6-authorization--pursue-precondition-of-capability-1-fail-closed-per-version —
    //   owner.v1 must hold for the current row and every retained postimage.
    //   A generated delete has a trustworthy preimage but no current row, so
    //   it remains a normative refusal rather than reusing historical owner
    //   identity as current authority.
    if *kind == OwnerMutationExplanationKindV1::Delete
        || current_owner(conn, table, owner_field, &write.id)?.as_deref() != Some(subject)
    {
        return Ok(None);
    }
    let expected_result = match kind {
        OwnerMutationExplanationKindV1::Create | OwnerMutationExplanationKindV1::Update => {
            write.row.clone().unwrap_or(Value::Null)
        }
        OwnerMutationExplanationKindV1::Delete => json!(1),
    };
    let mint_context_valid = match kind {
        OwnerMutationExplanationKindV1::Create => {
            ctx.ids.len() == 1
                && ctx.ids[0] == write.id
                && receipt.settlement_mint_observations.len() == 1
                && receipt.settlement_mint_observations[0].id == write.id
                && receipt.settlement_mint_observations[0].occurrence == 0
                && create_mint_site.as_deref()
                    == Some(receipt.settlement_mint_observations[0].site.as_str())
        }
        OwnerMutationExplanationKindV1::Update | OwnerMutationExplanationKindV1::Delete => {
            create_mint_site.is_none()
                && ctx.ids.is_empty()
                && receipt.settlement_mint_observations.is_empty()
        }
    };
    if !mint_context_valid
        || envelope.receipt.state != crate::commit_envelope::OperationReceiptStateV1::Committed
        || receipt.version != envelope.snapshot.version
        || receipt.changed_count != 1
        || receipt.result != expected_result
        || receipt.ctx_ledger.as_ref() != Some(&ctx)
        || receipt.settlement_time_observation.is_some()
        || !receipt.settlement_sequence_allocations.is_empty()
    {
        return Ok(None);
    }
    for read in &reads {
        match read.kind {
            crate::storage::CapturedReadKind::Auth => {
                if read.table.is_some()
                    || read.id.is_some()
                    || read.version.is_some()
                    || read.predicate.is_some()
                    || !read.rows.is_empty()
                    || read.field.as_deref() != Some("userId")
                    || read.value.as_ref().and_then(Value::as_str) != Some(subject)
                    || read.order.is_some()
                    || read.limit.is_some()
                    || read.result_count.is_some()
                    || read.boundary.is_some()
                {
                    return Ok(None);
                }
            }
            crate::storage::CapturedReadKind::Permission => {
                let expected_scope = format!("user:{subject}");
                if read.table.is_some()
                    || read.id.is_some()
                    || read.version.is_none()
                    || read.predicate.is_some()
                    || !read.rows.is_empty()
                    || read.field.as_deref() != Some("scope")
                    || read.value.as_ref().and_then(Value::as_str) != Some(expected_scope.as_str())
                    || read.order.is_some()
                    || read.limit.is_some()
                    || read.result_count.is_some()
                    || read.boundary.is_some()
                {
                    // Membership and other permission facts have a different
                    // shape and need their own live evaluator.
                    return Ok(None);
                }
            }
            crate::storage::CapturedReadKind::Row => {
                if !matches!(
                    kind,
                    OwnerMutationExplanationKindV1::Update | OwnerMutationExplanationKindV1::Delete
                ) || read.table.as_deref() != Some(table)
                    || read.id.as_deref() != Some(write.id.as_str())
                    || read.predicate.is_some()
                    || !read.rows.is_empty()
                    || read.field.is_some()
                    || read.value.is_some()
                    || read.order.is_some()
                    || read.limit.is_some()
                    || read.result_count.is_some()
                    || read.boundary.is_some()
                    || historical_owner(conn, table, owner_field, &write.id, read.version)?
                        .as_deref()
                        != Some(subject)
                {
                    return Ok(None);
                }
            }
            crate::storage::CapturedReadKind::MissingRow
            | crate::storage::CapturedReadKind::Query
            | crate::storage::CapturedReadKind::GraphNode => {
                // A missing-row or predicate/result-membership fact has no
                // retained owner post-image in v1. Do not infer its policy
                // from the caller or enclosing operation.
                return Ok(None);
            }
        }
    }
    let row_read_count = reads
        .iter()
        .filter(|read| read.kind == crate::storage::CapturedReadKind::Row)
        .count();
    let fact_shape_valid = match kind {
        OwnerMutationExplanationKindV1::Create => {
            row_read_count == 0
                && historical_owner(
                    conn,
                    table,
                    owner_field,
                    &write.id,
                    Some(envelope.snapshot.version),
                )?
                .as_deref()
                    == Some(subject)
        }
        OwnerMutationExplanationKindV1::Update => row_read_count == 1,
        OwnerMutationExplanationKindV1::Delete => false,
    };
    if !fact_shape_valid {
        return Ok(None);
    }

    // LLP 0133's mint observation is validated as captured context, never as
    // authority, and is removed before this protected receipt crosses the
    // public projection. The authorized row id remains available in the
    // row/result and ctx answer; the private site/occurrence ledger does not.
    let mut public_receipt = receipt;
    public_receipt.settlement_mint_observations.clear();
    public_receipt.settlement_time_observation = None;
    public_receipt.settlement_sequence_allocations.clear();
    let mut projected = object.clone();
    projected.insert(
        "receipt".to_owned(),
        serde_json::to_value(public_receipt)
            .map_err(|_| invalid("public operation receipt could not be encoded"))?,
    );
    Ok(Some(Value::Object(projected)))
}

fn historical_owner(
    conn: &Connection,
    table: &str,
    owner_field: &str,
    id: &str,
    version: Option<u64>,
) -> SnapbackResult<Option<String>> {
    let Some(version) = version else {
        return Ok(None);
    };
    let mut statement = conn.prepare(
        "SELECT op,row_json FROM _snapback_record_history_v1
         WHERE table_name=?1 AND row_id=?2 AND version=?3 ORDER BY id LIMIT 2",
    )?;
    let mut rows = statement.query(params![
        table,
        id,
        to_i64(version, "historical row version")?
    ])?;
    let Some(first) = rows.next()? else {
        return Ok(None);
    };
    let op: String = first.get(0)?;
    let row_json: Option<String> = first.get(1)?;
    if rows.next()?.is_some() || !matches!(op.as_str(), "insert" | "update") {
        return Ok(None);
    }
    let row: Option<Value> = row_json
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| invalid("retained historical operation row is invalid"))?;
    Ok(row
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|row| row.get(owner_field))
        .and_then(Value::as_str)
        .map(str::to_owned))
}

fn current_owner(
    conn: &Connection,
    table: &str,
    owner_field: &str,
    id: &str,
) -> SnapbackResult<Option<String>> {
    let sql = format!(
        "SELECT {} FROM {} WHERE _id=?1",
        crate::storage::quote_ident(owner_field)?,
        crate::storage::quote_ident(table)?,
    );
    conn.query_row(&sql, params![id], |row| row.get(0))
        .optional()
        .map_err(Into::into)
}

fn detail_projection(
    conn: &Connection,
    envelope: &CommitEnvelopeV1,
) -> (ExplanationDispositionV1, Option<Value>) {
    let details = [
        ("readSet", &envelope.read_set.detail),
        ("writeSet", &envelope.write_set.detail),
        ("ctxAnswers", &envelope.ctx_answers.detail),
        ("effects", &envelope.effects.facts.detail),
        ("receipt", &envelope.receipt.payload),
    ];
    if details
        .iter()
        .any(|(_, detail)| matches!(detail, RetainedEnvelopeDetailV1::Truncated))
    {
        return (ExplanationDispositionV1::DetailTruncated, None);
    }
    if details
        .iter()
        .any(|(_, detail)| matches!(detail, RetainedEnvelopeDetailV1::Expired))
    {
        return (ExplanationDispositionV1::DetailExpired, None);
    }
    let mut projected = serde_json::Map::new();
    for (name, detail) in details {
        match detail {
            RetainedEnvelopeDetailV1::InlineRedacted { detail } => {
                projected.insert(name.to_owned(), detail.clone());
            }
            RetainedEnvelopeDetailV1::ProtectedLane {
                custody_reference,
                payload_digest,
                ..
            } => match crate::operation_detail::open(conn, custody_reference, payload_digest) {
                Ok(Some(detail)) => {
                    projected.insert(name.to_owned(), detail);
                }
                Ok(None) | Err(_) => {
                    return (ExplanationDispositionV1::ProtectedCustodyUnavailable, None);
                }
            },
            RetainedEnvelopeDetailV1::Truncated | RetainedEnvelopeDetailV1::Expired => {}
        }
    }
    (
        ExplanationDispositionV1::Complete,
        Some(Value::Object(projected)),
    )
}

fn delete_protected_detail_in(
    tx: &Transaction<'_>,
    envelope: &CommitEnvelopeV1,
) -> SnapbackResult<()> {
    for detail in [
        &envelope.read_set.detail,
        &envelope.write_set.detail,
        &envelope.ctx_answers.detail,
        &envelope.effects.facts.detail,
        &envelope.receipt.payload,
    ] {
        if let RetainedEnvelopeDetailV1::ProtectedLane {
            custody_reference, ..
        } = detail
        {
            tx.execute(
                "DELETE FROM _snapback_operation_protected_detail_v1
                 WHERE custody_reference=?1",
                params![custody_reference],
            )?;
        }
    }
    Ok(())
}

fn compact_envelope_receipt_in(
    tx: &Transaction<'_>,
    identity: &OperationIdentityV1,
) -> SnapbackResult<()> {
    let body: String = tx.query_row(
        "SELECT envelope_json FROM _snapback_commit_envelopes_v1
         WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
        params![
            identity.key.stream_id,
            originator(identity.key.originator_class),
            identity.key.operation_id,
        ],
        |row| row.get(0),
    )?;
    let mut envelope: CommitEnvelopeV1 = decode(&body, "commit envelope")?;
    if let RetainedEnvelopeDetailV1::ProtectedLane {
        custody_reference, ..
    } = &envelope.receipt.payload
    {
        tx.execute(
            "DELETE FROM _snapback_operation_protected_detail_v1
             WHERE custody_reference=?1",
            params![custody_reference],
        )?;
    }
    envelope.receipt.payload = RetainedEnvelopeDetailV1::Expired;
    tx.execute(
        "UPDATE _snapback_commit_envelopes_v1 SET envelope_json=?1
         WHERE stream_id=?2 AND originator_class=?3 AND operation_id=?4",
        params![
            serde_json::to_string(&envelope)
                .map_err(|_| invalid("compact envelope could not be encoded"))?,
            identity.key.stream_id,
            originator(identity.key.originator_class),
            identity.key.operation_id,
        ],
    )?;
    Ok(())
}

fn suppression_identities_for_epoch(
    tx: &Transaction<'_>,
    originator_class: OperationOriginatorClassV1,
    audience: &str,
    epoch_id: &str,
) -> SnapbackResult<Vec<OperationIdentityV1>> {
    let mut statement = tx.prepare(
        "SELECT stream_id,originator_class,operation_id,identity_json
           FROM _snapback_operation_suppression_v1",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    let rows = rows.collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    let mut identities = Vec::new();
    for (row_stream_id, row_originator, row_operation_id, identity_json) in rows {
        let identity: OperationIdentityV1 = decode(&identity_json, "suppression identity")?;
        if identity.key.originator_class != originator_class
            && row_originator != originator(originator_class)
        {
            continue;
        }
        if row_stream_id != identity.key.stream_id
            || row_originator != originator(identity.key.originator_class)
            || row_operation_id != identity.key.operation_id
            || !matches!(
                lookup_operation(tx, &identity)?,
                OperationLookupV1::ExactReplay(_)
            )
        {
            return Err(invalid("suppression row is not exact retained authority"));
        }
        if identity.bound_facts.audience == audience && issuance_parts(&identity).0 == epoch_id {
            identities.push(identity);
        }
    }
    Ok(identities)
}

fn pending_terminal_identities_for_epoch(
    tx: &Transaction<'_>,
    audience: &str,
    epoch_id: &str,
) -> SnapbackResult<Vec<OperationIdentityV1>> {
    let mut statement = tx.prepare(
        "SELECT stream_id,originator_class,operation_id,supplement_json
           FROM _snapback_operation_terminal_supplements_v1",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    let rows = rows.collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    let mut identities = Vec::new();
    for (row_stream_id, row_originator, row_operation_id, supplement_json) in rows {
        let supplement: PendingOperationTerminalSupplementV1 =
            decode(&supplement_json, "pending terminal supplement")?;
        let identity = supplement.identity.clone();
        if identity.key.originator_class != OperationOriginatorClassV1::Host
            && row_originator != originator(OperationOriginatorClassV1::Host)
        {
            continue;
        }
        if row_stream_id != identity.key.stream_id
            || row_originator != originator(identity.key.originator_class)
            || row_operation_id != identity.key.operation_id
            || !matches!(
                lookup_pending_operation(tx, &identity)?,
                PendingOperationLookupV1::Terminal(ref retained) if retained == &supplement
            )
        {
            return Err(invalid(
                "host terminal supplement is not exact retained authority",
            ));
        }
        if identity.bound_facts.audience == audience && issuance_parts(&identity).0 == epoch_id {
            identities.push(identity);
        }
    }
    Ok(identities)
}

fn host_epoch_has_outcome_pending(
    tx: &Transaction<'_>,
    audience: &str,
    epoch_id: &str,
) -> SnapbackResult<bool> {
    let mut statement = tx.prepare(
        "SELECT stream_id,originator_class,operation_id,lifecycle_json
           FROM _snapback_operation_pending_v1",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    let rows = rows.collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    let mut outcome_pending = false;
    for (row_stream_id, row_originator, row_operation_id, lifecycle_json) in rows {
        let lifecycle: PendingOperationLifecycleV1 =
            decode(&lifecycle_json, "pending operation lifecycle")?;
        let identity = lifecycle.identity.clone();
        if identity.key.originator_class != OperationOriginatorClassV1::Host
            && row_originator != originator(OperationOriginatorClassV1::Host)
        {
            continue;
        }
        if row_stream_id != identity.key.stream_id
            || row_originator != originator(identity.key.originator_class)
            || row_operation_id != identity.key.operation_id
        {
            return Err(invalid("host pending lifecycle primary key is incoherent"));
        }
        let lookup = lookup_pending_operation(tx, &identity)?;
        if identity.bound_facts.audience == audience && issuance_parts(&identity).0 == epoch_id {
            match lookup {
                PendingOperationLookupV1::Pending(ref retained) if retained == &lifecycle => {
                    outcome_pending = true;
                }
                PendingOperationLookupV1::Terminal(_) => {}
                _ => {
                    return Err(invalid(
                        "host pending lifecycle is not exact retained authority",
                    ));
                }
            }
        }
    }
    Ok(outcome_pending)
}

fn refuse_retained_identity_for_insert(
    conn: &Connection,
    identity: &OperationIdentityV1,
    subject: &str,
) -> SnapbackResult<()> {
    let epoch_id = issuance_parts(identity).0;
    let originator_class = originator(identity.key.originator_class);
    if identity.key.originator_class == OperationOriginatorClassV1::Client {
        let (retained, below_floor): (bool, bool) = conn.query_row(
            "SELECT
               EXISTS(
                 SELECT 1 FROM _snapback_operation_suppression_v1
                  WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3
                 UNION ALL
                 SELECT 1 FROM _snapback_operation_tombstones_v1
                  WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3
                 UNION ALL
                 SELECT 1 FROM _snapback_commit_envelopes_v1
                  WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3
               ),
               EXISTS(
                 SELECT 1 FROM _snapback_operation_floors_v1 AS floor
                 JOIN _snapback_operation_epochs_v1 AS epoch
                   ON epoch.originator_class=floor.originator_class
                  AND epoch.audience=floor.audience
                  AND epoch.epoch_id=?5
                  AND epoch.epoch_sequence < floor.floor_sequence
                 WHERE floor.originator_class=?2 AND floor.audience=?4
               )",
            params![
                identity.key.stream_id,
                originator_class,
                identity.key.operation_id,
                identity.bound_facts.audience,
                epoch_id,
            ],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        return if retained || below_floor {
            refuse_retained_terminal_identity_for_insert(conn, identity, subject)
        } else {
            Ok(())
        };
    }

    let (pending_index_exists, retained_envelope, retained_terminal, below_floor): (
        bool,
        Option<String>,
        bool,
        bool,
    ) = conn.query_row(
        "SELECT
           EXISTS(
             SELECT 1 FROM _snapback_operation_pending_v1
              WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3
             UNION ALL
             SELECT 1 FROM _snapback_operation_terminal_supplements_v1
              WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3
           ),
           (SELECT envelope_json FROM _snapback_commit_envelopes_v1
             WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3),
           EXISTS(
             SELECT 1 FROM _snapback_operation_suppression_v1
              WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3
             UNION ALL
             SELECT 1 FROM _snapback_operation_tombstones_v1
              WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3
           ),
           EXISTS(
             SELECT 1 FROM _snapback_operation_floors_v1 AS floor
             JOIN _snapback_operation_epochs_v1 AS epoch
               ON epoch.originator_class=floor.originator_class
              AND epoch.audience=floor.audience
              AND epoch.epoch_id=?5
              AND epoch.epoch_sequence < floor.floor_sequence
             WHERE floor.originator_class=?2 AND floor.audience=?4
           )",
        params![
            identity.key.stream_id,
            originator_class,
            identity.key.operation_id,
            identity.bound_facts.audience,
            epoch_id,
        ],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    let pending_envelope = retained_envelope
        .as_deref()
        .map(|body| decode::<CommitEnvelopeV1>(body, "retained commit envelope"))
        .transpose()?
        .is_some_and(|envelope| {
            envelope.receipt.state == crate::commit_envelope::OperationReceiptStateV1::Pending
        });
    if pending_index_exists || pending_envelope {
        return match lookup_pending_operation(conn, identity)? {
            PendingOperationLookupV1::Pending(_) | PendingOperationLookupV1::Terminal(_) => {
                Err(refused(
                    "SNAPBACK_OPERATION_ALREADY_RECORDED",
                    format!("{subject} identity already has retained pending state"),
                ))
            }
            PendingOperationLookupV1::IdentityHorizonPassed => Err(refused(
                "SNAPBACK_OPERATION_IDENTITY_HORIZON_PASSED",
                format!("{subject} identity is below the retained outcome horizon"),
            )),
            PendingOperationLookupV1::Novel => {
                if retained_terminal || retained_envelope.is_some() || below_floor {
                    refuse_retained_terminal_identity_for_insert(conn, identity, subject)
                } else {
                    Err(invalid(
                        "pending operation indexes exist without a retained lifecycle",
                    ))
                }
            }
        };
    }
    if retained_terminal || retained_envelope.is_some() || below_floor {
        refuse_retained_terminal_identity_for_insert(conn, identity, subject)
    } else {
        Ok(())
    }
}

fn refuse_retained_terminal_identity_for_insert(
    conn: &Connection,
    identity: &OperationIdentityV1,
    subject: &str,
) -> SnapbackResult<()> {
    match lookup_operation(conn, identity)? {
        OperationLookupV1::Novel => Ok(()),
        OperationLookupV1::ExactReplay(_) | OperationLookupV1::ResultExpired { .. } => {
            Err(refused(
                "SNAPBACK_OPERATION_ALREADY_RECORDED",
                format!("{subject} identity already has retained terminal state"),
            ))
        }
        OperationLookupV1::IdentityHorizonPassed => Err(refused(
            "SNAPBACK_OPERATION_IDENTITY_HORIZON_PASSED",
            format!("{subject} identity is below the retained outcome horizon"),
        )),
    }
}

fn require_active_coverage(
    tx: &Transaction<'_>,
    envelope: &CommitEnvelopeV1,
) -> SnapbackResult<()> {
    let row: Option<(String, String)> = tx
        .query_row(
            "SELECT manifest_json, coverage_digest
             FROM _snapback_operation_coverage_v1
             WHERE stream_id=?1 ORDER BY manifest_version DESC LIMIT 1",
            params![envelope.identity.key.stream_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((body, digest)) = row else {
        return Err(refused(
            "SNAPBACK_OPERATION_COVERAGE_UNAVAILABLE",
            "no active coverage manifest exists for the operation stream",
        ));
    };
    let manifest: OperationCoverageManifestV1 = decode(&body, "coverage manifest")?;
    let declared = manifest.covered_lanes.iter().collect::<BTreeSet<_>>();
    if digest != envelope.coverage.coverage_digest
        || envelope
            .coverage
            .covered_lanes
            .iter()
            .any(|lane| !declared.contains(lane))
    {
        return Err(refused(
            "SNAPBACK_OPERATION_COVERAGE_MISMATCH",
            "envelope coverage does not match the active stream manifest",
        ));
    }
    Ok(())
}

fn require_journal_complete(
    tx: &Transaction<'_>,
    envelope: &CommitEnvelopeV1,
) -> SnapbackResult<()> {
    if envelope.snapshot.association == SnapshotAssociationKindV1::ObservedSnapshot {
        if envelope.write_set.count != 0 {
            return Err(refused(
                "SNAPBACK_OPERATION_JOURNAL_INCOMPLETE",
                "receipt-only envelope claims writes",
            ));
        }
        return Ok(());
    }
    let observed: u64 = tx.query_row(
        "SELECT COUNT(*) FROM _snapback_changes WHERE version=?1",
        params![to_i64(envelope.snapshot.version, "snapshot version")?],
        |row| row.get(0),
    )?;
    if observed != envelope.write_set.count {
        return Err(refused(
            "SNAPBACK_OPERATION_JOURNAL_INCOMPLETE",
            format!(
                "covered commit claims {} writes but its journal has {observed}",
                envelope.write_set.count
            ),
        ));
    }
    Ok(())
}

fn reject_divergence(
    retained: &OperationIdentityV1,
    proposed: &OperationIdentityV1,
) -> SnapbackResult<()> {
    match retained.compare(proposed) {
        OperationIdentityComparison::ExactReplay => Ok(()),
        OperationIdentityComparison::BoundFactsDiverged => Err(refused(
            if retained.bound_facts.audience != proposed.bound_facts.audience
                || retained.bound_facts.principal_fingerprint
                    != proposed.bound_facts.principal_fingerprint
                || retained.bound_facts.authority_instance_id
                    != proposed.bound_facts.authority_instance_id
            {
                "SNAPBACK_AUTH_STALE_RESULT"
            } else {
                "SNAPBACK_CLIENT_MUTATION_ID_REUSED"
            },
            "operation identity collides with divergent bound facts",
        )),
        OperationIdentityComparison::Novel => Err(invalid(
            "operation lookup compared identities from different physical keys",
        )),
    }
}

fn operation_identity_digest(identity: &OperationIdentityV1) -> SnapbackResult<String> {
    digest_serialized(
        b"snapback:operation-identity-tombstone:identity:v1\n",
        identity,
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationTombstoneAuthFactsDigestV1<'a> {
    audience: &'a str,
    principal_fingerprint: &'a str,
    authority_instance_id: &'a str,
}

fn operation_auth_facts_digest(identity: &OperationIdentityV1) -> SnapbackResult<String> {
    digest_serialized(
        b"snapback:operation-identity-tombstone:auth-facts:v1\n",
        &OperationTombstoneAuthFactsDigestV1 {
            audience: &identity.bound_facts.audience,
            principal_fingerprint: &identity.bound_facts.principal_fingerprint,
            authority_instance_id: &identity.bound_facts.authority_instance_id,
        },
    )
}

fn digest_serialized<T: Serialize>(domain: &[u8], value: &T) -> SnapbackResult<String> {
    let bytes = serde_json::to_vec(value)
        .map_err(|_| invalid("operation identity digest projection could not be encoded"))?;
    let mut digest = Sha256::new();
    digest.update(domain);
    digest.update(bytes);
    Ok(format!("sha256:{:x}", digest.finalize()))
}

fn issuance_parts(identity: &OperationIdentityV1) -> (&str, Option<u64>, &str) {
    match &identity.issuance {
        OperationIssuanceV1::ClientRange {
            epoch_id,
            counter,
            authority_authenticator_digest,
            ..
        } => (epoch_id, Some(*counter), authority_authenticator_digest),
        OperationIssuanceV1::HostIncarnation {
            epoch_id,
            authority_authenticator_digest,
            ..
        } => (epoch_id, None, authority_authenticator_digest),
    }
}

fn originator(value: OperationOriginatorClassV1) -> &'static str {
    match value {
        OperationOriginatorClassV1::Client => ORIGINATOR_CLIENT,
        OperationOriginatorClassV1::Host => ORIGINATOR_HOST,
    }
}

fn epoch_state(value: IdentityEpochStateV1) -> &'static str {
    match value {
        IdentityEpochStateV1::Open => "open",
        IdentityEpochStateV1::Terminated => "terminated",
        IdentityEpochStateV1::Revoked => "revoked",
        IdentityEpochStateV1::Closed => "closed",
    }
}

fn digest_json(domain: &[u8], value: &Value) -> String {
    let mut digest = Sha256::new();
    digest.update(domain);
    digest.update(serde_json::to_vec(value).expect("JSON value serializes"));
    format!("sha256:{:x}", digest.finalize())
}

pub fn digest_fact_set(domain: &[u8], value: &Value) -> String {
    digest_json(domain, value)
}

fn decode<T: for<'de> Deserialize<'de>>(body: &str, subject: &str) -> SnapbackResult<T> {
    serde_json::from_str(body).map_err(|_| invalid(format!("{subject} is corrupt")))
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn to_i64(value: u64, subject: &str) -> SnapbackResult<i64> {
    i64::try_from(value).map_err(|_| invalid(format!("{subject} exceeds SQLite INTEGER")))
}

fn optional_i64(value: Option<u64>, subject: &str) -> SnapbackResult<Option<i64>> {
    value.map(|value| to_i64(value, subject)).transpose()
}

fn invalid(message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_OPERATION_LEDGER_INVALID",
        "storage",
        message.into(),
    )
}

fn refused(code: &'static str, message: impl Into<String>) -> SnapbackError {
    SnapbackError::error(code, "storage", message.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commit_envelope::{
        EnvelopeAuthorityFactsV1, EnvelopeCoverageV1, EnvelopeEffectFactsV1, EnvelopeFactSetV1,
        FactProvenanceV1, LaneFactV1, OperationBoundFactsV1, OperationKeyV1,
        OperationReceiptStateV1, OperationReceiptV1, SnapshotAssociationKindV1,
        StreamQualifiedVersionV1,
    };

    fn sha(character: char) -> String {
        format!("sha256:{}", character.to_string().repeat(64))
    }

    fn connection() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open SQLite");
        conn.execute_batch(
            "CREATE TABLE _snapback_changes(
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               version INTEGER NOT NULL,
               table_name TEXT NOT NULL,
               row_id TEXT NOT NULL,
               op TEXT NOT NULL,
               row_json TEXT,
               changed_at_ms INTEGER NOT NULL
             );
             CREATE TABLE app_rows(id TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )
        .expect("base infra");
        let tx = conn.transaction().expect("infra tx");
        create_infra(&tx).expect("operation infra");
        tx.commit().expect("commit infra");
        conn
    }

    fn register_client_authority(conn: &mut Connection, expires_at_ms: u64) -> String {
        let authenticator = sha('a');
        let tx = conn.transaction().expect("authority tx");
        register_epoch_in(
            &tx,
            &IdentityEpochV1 {
                schema_version: 1,
                originator_class: OperationOriginatorClassV1::Client,
                audience: "audience-1".to_owned(),
                authority_instance_id: "authority-1".to_owned(),
                epoch_id: "epoch-1".to_owned(),
                epoch_sequence: 1,
                state: IdentityEpochStateV1::Open,
                issued_at_ms: 1,
                terminated_at_ms: None,
                authority_authenticator_digest: authenticator.clone(),
            },
        )
        .expect("epoch");
        register_client_range_in(
            &tx,
            &ClientIdentityRangeV1 {
                schema_version: 1,
                audience: "audience-1".to_owned(),
                authority_instance_id: "authority-1".to_owned(),
                epoch_id: "epoch-1".to_owned(),
                epoch_sequence: 1,
                range_start: 0,
                range_end_exclusive: 2,
                issued_at_ms: 1,
                expires_at_ms,
                authority_authenticator_digest: authenticator.clone(),
            },
        )
        .expect("range");
        register_coverage_in(&tx, &manifest("stream-1"), 1).expect("coverage");
        tx.commit().expect("authority commit");
        authenticator
    }

    fn manifest(stream: &str) -> OperationCoverageManifestV1 {
        let lanes = vec![ORDINARY_MUTATION_LANE_V1.to_owned()];
        let writers = ORDINARY_MUTATION_WRITERS_V1
            .iter()
            .map(|writer| (*writer).to_owned())
            .collect::<Vec<_>>();
        OperationCoverageManifestV1 {
            schema_version: 1,
            manifest_version: 1,
            stream_id: stream.to_owned(),
            covered_lanes: lanes.clone(),
            writer_choke_points: writers.clone(),
            coverage_digest: coverage_digest(stream, 1, &lanes, &writers),
        }
    }

    fn client_identity(
        counter: u64,
        operation_id: &str,
        authenticator: &str,
    ) -> OperationIdentityV1 {
        OperationIdentityV1 {
            schema_version: 1,
            key: OperationKeyV1 {
                stream_id: "stream-1".to_owned(),
                originator_class: OperationOriginatorClassV1::Client,
                operation_id: operation_id.to_owned(),
            },
            issuance: OperationIssuanceV1::ClientRange {
                epoch_id: "epoch-1".to_owned(),
                counter,
                range_start: 0,
                range_end_exclusive: 2,
                authority_authenticator_digest: authenticator.to_owned(),
            },
            bound_facts: OperationBoundFactsV1 {
                audience: "audience-1".to_owned(),
                principal_fingerprint: "principal-1".to_owned(),
                authority_instance_id: "authority-1".to_owned(),
                operation_kind: "ordinaryMutation".to_owned(),
                function_or_command: "todos.create".to_owned(),
                input_fingerprint: sha('b'),
            },
        }
    }

    fn facts(value: Value, provenance: FactProvenanceV1) -> EnvelopeFactSetV1 {
        let count = value.as_array().map_or(1, |items| items.len()) as u64;
        EnvelopeFactSetV1 {
            digest: digest_fact_set(b"test-facts\n", &value),
            count,
            provenance,
            detail: RetainedEnvelopeDetailV1::InlineRedacted { detail: value },
        }
    }

    fn envelope(identity: OperationIdentityV1, version: u64, writes: u64) -> CommitEnvelopeV1 {
        let coverage = manifest(&identity.key.stream_id);
        CommitEnvelopeV1 {
            schema_version: 1,
            snapshot: StreamQualifiedVersionV1 {
                stream_id: identity.key.stream_id.clone(),
                version,
                association: if writes == 0 {
                    SnapshotAssociationKindV1::ObservedSnapshot
                } else {
                    SnapshotAssociationKindV1::ProducedCommit
                },
            },
            principal_session_or_invocation_id: "session-1".to_owned(),
            authority: EnvelopeAuthorityFactsV1 {
                audience: identity.bound_facts.audience.clone(),
                grant_or_policy_identity: LaneFactV1::Defined("grant-1".to_owned()),
                fencing_token_or_epoch: LaneFactV1::Defined("epoch-1".to_owned()),
            },
            executable_artifact_digest: LaneFactV1::Defined(sha('c')),
            argument_digest: sha('d'),
            plan_digest: LaneFactV1::NotDefinedForLane,
            base_version: LaneFactV1::NotDefinedForLane,
            read_set: facts(
                json!([{"table":"todos","id":"todo-0"}]),
                FactProvenanceV1::ServerCaptured,
            ),
            write_set: facts(
                Value::Array((0..writes).map(|index| json!({"id": index})).collect()),
                FactProvenanceV1::ServerCaptured,
            ),
            ctx_answers: facts(json!([]), FactProvenanceV1::ServerCaptured),
            effects: EnvelopeEffectFactsV1 {
                facts: facts(json!([]), FactProvenanceV1::ServerCaptured),
                egress_families: Vec::new(),
                settlement_capabilities: Vec::new(),
            },
            receipt: OperationReceiptV1 {
                state: OperationReceiptStateV1::Committed,
                receipt_digest: sha('e'),
                payload: RetainedEnvelopeDetailV1::InlineRedacted {
                    detail: json!({"version": version}),
                },
            },
            coverage: EnvelopeCoverageV1 {
                covered_lanes: vec![ORDINARY_MUTATION_LANE_V1.to_owned()],
                uncovered_lanes: Vec::new(),
                coverage_digest: coverage.coverage_digest,
            },
            recorded_at_ms: 10,
            identity,
        }
    }

    fn insert_covered_change(tx: &Transaction<'_>, version: u64, id: &str) {
        tx.execute(
            "INSERT INTO app_rows(id,value) VALUES(?1,'value')",
            params![id],
        )
        .expect("app write");
        tx.execute(
            "INSERT INTO _snapback_changes(version,table_name,row_id,op,row_json,changed_at_ms)
             VALUES(?1,'todos',?2,'insert','{}',10)",
            params![version as i64, id],
        )
        .expect("journal write");
    }

    #[test]
    fn atomic_crash_cuts_leave_none_or_the_complete_commit_set() {
        let mut conn = connection();
        let authenticator = register_client_authority(&mut conn, 1_000);
        let identity = client_identity(0, "operation-0", &authenticator);
        {
            let tx = conn.transaction().expect("crash-cut tx");
            insert_covered_change(&tx, 1, "rolled-back");
            record_operation_in(&tx, &envelope(identity.clone(), 1, 1)).expect("stage envelope");
            tx.rollback().expect("simulated pre-commit crash");
        }
        for table in [
            "app_rows",
            "_snapback_changes",
            "_snapback_commit_envelopes_v1",
            "_snapback_operation_suppression_v1",
        ] {
            let count: u64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("count");
            assert_eq!(count, 0, "{table} survived rollback");
        }

        let tx = conn.transaction().expect("commit tx");
        insert_covered_change(&tx, 1, "committed");
        record_operation_in(&tx, &envelope(identity.clone(), 1, 1)).expect("record envelope");
        tx.commit().expect("atomic commit");
        assert!(matches!(
            lookup_operation(&conn, &identity).expect("lookup"),
            OperationLookupV1::ExactReplay(_)
        ));
        for table in [
            "app_rows",
            "_snapback_changes",
            "_snapback_commit_envelopes_v1",
            "_snapback_operation_suppression_v1",
        ] {
            let count: u64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("count");
            assert_eq!(count, 1, "{table} did not commit atomically");
        }
    }

    #[test]
    fn restored_client_cannot_rebind_an_admitted_or_tombstoned_range_counter() {
        let mut conn = connection();
        let authenticator = register_client_authority(&mut conn, 1_000);
        let original = client_identity(0, "operation-original", &authenticator);
        let tx = conn.transaction().expect("original tx");
        insert_covered_change(&tx, 1, "original-row");
        record_operation_in(&tx, &envelope(original.clone(), 1, 1)).expect("record original");
        tx.commit().expect("commit original");

        let squatted = client_identity(0, "operation-restored-copy", &authenticator);
        let tx = conn.transaction().expect("counter squat tx");
        insert_covered_change(&tx, 2, "squat-rolled-back");
        assert_eq!(
            record_operation_in(&tx, &envelope(squatted.clone(), 2, 1))
                .expect_err("same ranged counter cannot bind another operation")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_RANGE_COUNTER_REUSED"
        );
        tx.rollback().expect("rollback counter squat");
        let app_row_count: u64 = conn
            .query_row(
                "SELECT COUNT(*) FROM app_rows WHERE id='squat-rolled-back'",
                [],
                |row| row.get(0),
            )
            .expect("count rolled-back row");
        assert_eq!(app_row_count, 0);

        let tx = conn.transaction().expect("reclaim original");
        acknowledge_and_reclaim_in(&tx, &original, 20).expect("retain tombstone");
        tx.commit().expect("commit tombstone");
        let tx = conn.transaction().expect("tombstone counter squat tx");
        assert_eq!(
            record_operation_in(&tx, &envelope(squatted, 1, 0))
                .expect_err("tombstoned counter remains occupied")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_RANGE_COUNTER_REUSED"
        );
        tx.rollback().expect("rollback tombstone squat");
    }

    #[test]
    fn retry_collision_range_exhaustion_and_floor_lifecycle_fail_closed() {
        let mut conn = connection();
        let authenticator = register_client_authority(&mut conn, 100);
        let first = client_identity(0, "operation-0", &authenticator);
        let second = client_identity(1, "operation-1", &authenticator);
        for (version, identity) in [(1, &first), (2, &second)] {
            let tx = conn.transaction().expect("operation tx");
            insert_covered_change(&tx, version, &format!("todo-{version}"));
            record_operation_in(&tx, &envelope(identity.clone(), version, 1)).expect("record");
            tx.commit().expect("commit");
        }
        assert!(matches!(
            lookup_operation(&conn, &first).expect("exact retry"),
            OperationLookupV1::ExactReplay(_)
        ));
        let mut divergent = first.clone();
        divergent.bound_facts.input_fingerprint = sha('f');
        assert_eq!(
            lookup_operation(&conn, &divergent)
                .expect_err("divergent retry")
                .diagnostic
                .code,
            "SNAPBACK_CLIENT_MUTATION_ID_REUSED"
        );
        let tx = conn.transaction().expect("suppression corruption probe");
        let body: String = tx
            .query_row(
                "SELECT record_json FROM _snapback_operation_suppression_v1
                 WHERE stream_id=?1 AND originator_class='client' AND operation_id=?2",
                params![first.key.stream_id, first.key.operation_id],
                |row| row.get(0),
            )
            .expect("stored suppression");
        let mut corrupt: OperationSuppressionRecordV1 =
            serde_json::from_str(&body).expect("decode suppression");
        corrupt.identity.bound_facts.input_fingerprint = sha('9');
        tx.execute(
            "UPDATE _snapback_operation_suppression_v1 SET record_json=?1
             WHERE stream_id=?2 AND originator_class='client' AND operation_id=?3",
            params![
                serde_json::to_string(&corrupt).expect("encode corrupt suppression"),
                first.key.stream_id,
                first.key.operation_id,
            ],
        )
        .expect("stage suppression corruption");
        assert_eq!(
            lookup_operation(&tx, &first)
                .expect_err("mismatched suppression record never replays")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_LEDGER_INVALID"
        );
        tx.rollback().expect("discard suppression corruption");
        let mut exhausted = client_identity(2, "operation-2", &authenticator);
        exhausted.issuance = OperationIssuanceV1::ClientRange {
            epoch_id: "epoch-1".to_owned(),
            counter: 2,
            range_start: 2,
            range_end_exclusive: 4,
            authority_authenticator_digest: authenticator.clone(),
        };
        let tx = conn.transaction().expect("exhausted tx");
        assert_eq!(
            record_operation_in(&tx, &envelope(exhausted, 2, 0))
                .expect_err("range exhaustion")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_RANGE_EXHAUSTED"
        );
        tx.rollback().expect("rollback refusal");

        let tx = conn.transaction().expect("ack first");
        acknowledge_and_reclaim_in(&tx, &first, 20).expect("ack first");
        assert_eq!(
            prune_compact_envelope_in(&tx, &divergent)
                .expect_err("divergent identity cannot prune retained evidence")
                .diagnostic
                .code,
            "SNAPBACK_CLIENT_MUTATION_ID_REUSED"
        );
        assert!(
            prune_compact_envelope_in(&tx, &first).expect("prune first compact envelope"),
            "the tombstone must remain the sole collision authority"
        );
        terminate_epoch_in(
            &tx,
            OperationOriginatorClassV1::Client,
            "audience-1",
            "epoch-1",
            false,
            30,
        )
        .expect("terminate");
        tx.execute(
            "UPDATE _snapback_operation_suppression_v1 SET audience='audience-moved'
             WHERE stream_id=?1 AND originator_class='client' AND operation_id=?2",
            params![second.key.stream_id, second.key.operation_id],
        )
        .expect("move unacknowledged client suppression projection");
        assert_eq!(
            close_epoch_if_complete_in(
                &tx,
                OperationOriginatorClassV1::Client,
                "audience-1",
                "epoch-1",
                200,
            )
            .expect_err("moved client suppression cannot disappear from closure")
            .diagnostic
            .code,
            "SNAPBACK_OPERATION_LEDGER_INVALID"
        );
        tx.execute(
            "UPDATE _snapback_operation_suppression_v1 SET audience='audience-1'
             WHERE stream_id=?1 AND originator_class='client' AND operation_id=?2",
            params![second.key.stream_id, second.key.operation_id],
        )
        .expect("restore client suppression projection");
        assert!(
            !close_epoch_if_complete_in(
                &tx,
                OperationOriginatorClassV1::Client,
                "audience-1",
                "epoch-1",
                200,
            )
            .expect("unacknowledged second holds floor")
        );
        tx.commit().expect("commit first ack");
        assert!(matches!(
            lookup_operation(&conn, &first).expect("tombstone retry"),
            OperationLookupV1::ResultExpired { .. }
        ));
        assert_eq!(
            lookup_operation(&conn, &divergent)
                .expect_err("tombstone refuses divergent input")
                .diagnostic
                .code,
            "SNAPBACK_CLIENT_MUTATION_ID_REUSED"
        );
        let mut divergent_auth = first.clone();
        divergent_auth.bound_facts.principal_fingerprint = "principal-other".to_owned();
        assert_eq!(
            lookup_operation(&conn, &divergent_auth)
                .expect_err("tombstone refuses divergent auth")
                .diagnostic
                .code,
            "SNAPBACK_AUTH_STALE_RESULT"
        );
        for (label, mutate) in [("audience", 0_u8), ("authority instance", 1_u8)] {
            let mut mismatch = first.clone();
            if mutate == 0 {
                mismatch.bound_facts.audience = "audience-other".to_owned();
            } else {
                mismatch.bound_facts.authority_instance_id = "authority-other".to_owned();
            }
            assert_eq!(
                lookup_operation(&conn, &mismatch)
                    .expect_err(&format!("tombstone refuses divergent {label}"))
                    .diagnostic
                    .code,
                "SNAPBACK_AUTH_STALE_RESULT"
            );
        }

        // The writer seam independently rechecks retained state in the same
        // transaction as app/journal publication. A caller that bypasses the
        // normal pre-handler lookup still cannot execute a tombstoned key.
        let tx = conn.transaction().expect("direct writer replay probe");
        insert_covered_change(&tx, 3, "direct-replay-rolled-back");
        assert_eq!(
            record_operation_in(&tx, &envelope(first.clone(), 3, 1))
                .expect_err("tombstoned identity cannot be reinserted")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_ALREADY_RECORDED"
        );
        tx.rollback().expect("rollback direct replay probe");
        let replay_rows: u64 = conn
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM app_rows WHERE id='direct-replay-rolled-back') +
                   (SELECT COUNT(*) FROM _snapback_changes WHERE version=3)",
                [],
                |row| row.get(0),
            )
            .expect("count rolled-back direct replay writes");
        assert_eq!(replay_rows, 0);
        let (envelopes, suppressions, tombstones): (u64, u64, u64) = conn
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM _snapback_commit_envelopes_v1
                     WHERE stream_id=?1 AND originator_class='client' AND operation_id=?2),
                   (SELECT COUNT(*) FROM _snapback_operation_suppression_v1
                     WHERE stream_id=?1 AND originator_class='client' AND operation_id=?2),
                   (SELECT COUNT(*) FROM _snapback_operation_tombstones_v1
                     WHERE stream_id=?1 AND originator_class='client' AND operation_id=?2)",
                params![first.key.stream_id, first.key.operation_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("retained replay state after rollback");
        assert_eq!((envelopes, suppressions, tombstones), (0, 0, 1));

        let tx = conn.transaction().expect("tombstone corruption probe");
        tx.execute(
            "UPDATE _snapback_operation_tombstones_v1 SET audience='audience-corrupt'
             WHERE stream_id=?1 AND originator_class='client' AND operation_id=?2",
            params![first.key.stream_id, first.key.operation_id],
        )
        .expect("stage tombstone projection corruption");
        assert_eq!(
            lookup_operation(&tx, &first)
                .expect_err("projection-corrupt tombstone never settles")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_LEDGER_INVALID"
        );
        tx.rollback().expect("discard tombstone corruption");

        let tx = conn
            .transaction()
            .expect("tombstone counter corruption probe");
        tx.execute(
            "UPDATE _snapback_operation_tombstones_v1 SET counter=counter + 1
             WHERE stream_id=?1 AND originator_class='client' AND operation_id=?2",
            params![first.key.stream_id, first.key.operation_id],
        )
        .expect("stage tombstone counter corruption");
        assert_eq!(
            lookup_operation(&tx, &first)
                .expect_err("counter-corrupt tombstone never settles")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_LEDGER_INVALID"
        );
        tx.rollback().expect("discard tombstone counter corruption");

        let tx = conn.transaction().expect("ack second");
        acknowledge_and_reclaim_in(&tx, &second, 201).expect("ack second");
        assert!(
            close_epoch_if_complete_in(
                &tx,
                OperationOriginatorClassV1::Client,
                "audience-1",
                "epoch-1",
                201,
            )
            .expect("close complete epoch")
        );
        assert!(
            !prune_compact_envelope_in(&tx, &first).expect("first compact envelope remains pruned")
        );
        tx.commit().expect("commit closure");
        assert_eq!(
            lookup_operation(&conn, &first).expect("below floor retry"),
            OperationLookupV1::IdentityHorizonPassed
        );
        let tx = conn.transaction().expect("below-floor writer probe");
        insert_covered_change(&tx, 4, "below-floor-rolled-back");
        assert_eq!(
            record_operation_in(&tx, &envelope(first.clone(), 4, 1))
                .expect_err("writer classifier runs before closed-epoch authentication")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_IDENTITY_HORIZON_PASSED"
        );
        tx.rollback().expect("rollback below-floor writer probe");
        let below_floor_rows: u64 = conn
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM app_rows WHERE id='below-floor-rolled-back') +
                   (SELECT COUNT(*) FROM _snapback_changes WHERE version=4)",
                [],
                |row| row.get(0),
            )
            .expect("count rolled-back below-floor writes");
        assert_eq!(below_floor_rows, 0);
    }

    #[test]
    fn later_epoch_closure_cannot_leap_an_earlier_open_epoch() {
        let mut conn = connection();
        let authenticator = register_client_authority(&mut conn, 100);
        let retained = client_identity(0, "operation-retained", &authenticator);
        let first_delivery = client_identity(1, "operation-first-delivery", &authenticator);
        let tx = conn.transaction().expect("retain lower tombstone");
        insert_covered_change(&tx, 1, "retained-lower");
        record_operation_in(&tx, &envelope(retained.clone(), 1, 1)).expect("record lower");
        acknowledge_and_reclaim_in(&tx, &retained, 20).expect("reclaim lower");
        prune_compact_envelope_in(&tx, &retained).expect("prune lower compact envelope");
        register_epoch_in(
            &tx,
            &IdentityEpochV1 {
                schema_version: 1,
                originator_class: OperationOriginatorClassV1::Client,
                audience: "audience-1".to_owned(),
                authority_instance_id: "authority-2".to_owned(),
                epoch_id: "epoch-2".to_owned(),
                epoch_sequence: 2,
                state: IdentityEpochStateV1::Open,
                issued_at_ms: 21,
                terminated_at_ms: None,
                authority_authenticator_digest: sha('c'),
            },
        )
        .expect("register later epoch");
        terminate_epoch_in(
            &tx,
            OperationOriginatorClassV1::Client,
            "audience-1",
            "epoch-2",
            false,
            22,
        )
        .expect("terminate later epoch");
        assert!(
            close_epoch_if_complete_in(
                &tx,
                OperationOriginatorClassV1::Client,
                "audience-1",
                "epoch-2",
                200,
            )
            .expect("close later ready epoch")
        );
        tx.commit().expect("commit out-of-order closure");

        let floor: u64 = conn
            .query_row(
                "SELECT floor_sequence FROM _snapback_operation_floors_v1
                 WHERE originator_class='client' AND audience='audience-1'",
                [],
                |row| row.get(0),
            )
            .expect("retained floor");
        assert_eq!(floor, 1, "floor remains at the earlier open epoch");
        assert!(matches!(
            lookup_operation(&conn, &retained).expect("lower tombstone survives"),
            OperationLookupV1::ResultExpired { .. }
        ));
        assert_eq!(
            lookup_operation(&conn, &first_delivery).expect("lower first delivery remains novel"),
            OperationLookupV1::Novel
        );
    }

    #[test]
    fn tombstone_digest_vectors_are_stable() {
        let identity = client_identity(0, "operation-0", &sha('a'));
        assert_eq!(
            operation_identity_digest(&identity).expect("identity digest"),
            "sha256:e2ec83fc1627a35cb4ae18dcf3a6185ea4741cc3d48be018769d0ff66bd45e5c"
        );
        assert_eq!(
            operation_auth_facts_digest(&identity).expect("auth facts digest"),
            "sha256:19df90202954e9a6526d20e7120d54d0a9c824a5366d48c24305a017c3bd9742"
        );
    }

    #[test]
    fn range_registration_is_atomic_and_overlap_is_refused() {
        let mut conn = connection();
        let authenticator = sha('a');
        let tx = conn.transaction().expect("epoch tx");
        register_epoch_in(
            &tx,
            &IdentityEpochV1 {
                schema_version: 1,
                originator_class: OperationOriginatorClassV1::Client,
                audience: "audience-1".to_owned(),
                authority_instance_id: "authority-1".to_owned(),
                epoch_id: "epoch-1".to_owned(),
                epoch_sequence: 1,
                state: IdentityEpochStateV1::Open,
                issued_at_ms: 1,
                terminated_at_ms: None,
                authority_authenticator_digest: authenticator.clone(),
            },
        )
        .expect("epoch");
        tx.commit().expect("epoch commit");
        let range = ClientIdentityRangeV1 {
            schema_version: 1,
            audience: "audience-1".to_owned(),
            authority_instance_id: "authority-1".to_owned(),
            epoch_id: "epoch-1".to_owned(),
            epoch_sequence: 1,
            range_start: 0,
            range_end_exclusive: 2,
            issued_at_ms: 1,
            expires_at_ms: 100,
            authority_authenticator_digest: authenticator,
        };
        let tx = conn.transaction().expect("range crash tx");
        register_client_range_in(&tx, &range).expect("stage range");
        tx.rollback().expect("simulate crash before persistence");
        let count: u64 = conn
            .query_row(
                "SELECT COUNT(*) FROM _snapback_operation_ranges_v1",
                [],
                |row| row.get(0),
            )
            .expect("count ranges");
        assert_eq!(count, 0);
        let tx = conn.transaction().expect("range commit tx");
        register_client_range_in(&tx, &range).expect("register range");
        assert_eq!(
            register_client_range_in(&tx, &range)
                .expect_err("overlap")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_RANGE_OVERLAP"
        );
        let mut gap = range.clone();
        gap.range_start = 3;
        gap.range_end_exclusive = 4;
        assert_eq!(
            register_client_range_in(&tx, &gap)
                .expect_err("range cannot skip the retained frontier")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_RANGE_CONTINUITY_INVALID"
        );
        tx.commit().expect("range commit");
    }

    #[test]
    fn public_range_issuance_is_server_owned_contiguous_and_response_loss_safe() {
        let mut conn = connection();
        let audience = "audience-issued-a";
        let authority = "authority-issued";
        let first = {
            let tx = conn.transaction().expect("first issuance");
            let range = issue_client_range_in(&tx, "stream-issued", audience, authority, None, 10)
                .expect("issue first range");
            tx.commit().expect("commit first range");
            range
        };
        assert_eq!(first.range_start, 0);
        assert_eq!(first.range_end_exclusive, CLIENT_IDENTITY_RANGE_SIZE_V1);

        // Simulate losing the committed response before the client can install
        // it: while the epoch has admitted no operation, retry returns the
        // exact same range and never creates a gap.
        let recovered = {
            let tx = conn.transaction().expect("response loss retry");
            let range = issue_client_range_in(&tx, "stream-issued", audience, authority, None, 11)
                .expect("recover first response");
            tx.commit().expect("commit no-op recovery");
            range
        };
        assert_eq!(recovered, first);

        // Issuance is not publication: neither this cohort nor another client
        // under the same authority can turn coverage on.
        assert!(
            active_coverage_manifest(&conn, "stream-issued")
                .expect("coverage lookup")
                .is_none()
        );
        let independent = {
            let tx = conn.transaction().expect("independent client issuance");
            let range = issue_client_range_in(
                &tx,
                "stream-issued",
                "audience-issued-b",
                authority,
                None,
                12,
            )
            .expect("issue independent first range");
            tx.commit().expect("commit independent range");
            range
        };
        assert_ne!(independent.audience, first.audience);
        assert_ne!(independent.epoch_id, first.epoch_id);
        assert_ne!(
            independent.authority_authenticator_digest,
            first.authority_authenticator_digest
        );

        // A server-controlled publication cut is separate. Once activated,
        // the unwidened v1 issuance resolves its audience transactionally and
        // the exact envelope is admitted with that audience.
        let identity = OperationIdentityV1 {
            schema_version: 1,
            key: OperationKeyV1 {
                stream_id: "stream-issued".to_owned(),
                originator_class: OperationOriginatorClassV1::Client,
                operation_id: "operation-issued-0".to_owned(),
            },
            issuance: OperationIssuanceV1::ClientRange {
                epoch_id: first.epoch_id.clone(),
                counter: first.range_start,
                range_start: first.range_start,
                range_end_exclusive: first.range_end_exclusive,
                authority_authenticator_digest: first.authority_authenticator_digest.clone(),
            },
            bound_facts: OperationBoundFactsV1 {
                audience: first.audience.clone(),
                principal_fingerprint: "principal-issued".to_owned(),
                authority_instance_id: authority.to_owned(),
                operation_kind: ORDINARY_MUTATION_LANE_V1.to_owned(),
                function_or_command: "todos.create".to_owned(),
                input_fingerprint: sha('b'),
            },
        };
        {
            let tx = conn
                .transaction()
                .expect("explicit activation and operation");
            assert_eq!(
                resolve_client_range_audience_in(&tx, &identity.issuance, authority)
                    .expect("resolve recorded range audience"),
                first.audience
            );
            activate_ordinary_mutation_coverage_in(&tx, "stream-issued", 13)
                .expect("explicit activation");
            let coverage = active_coverage_manifest(&tx, "stream-issued")
                .expect("coverage lookup")
                .expect("coverage explicitly active");
            insert_covered_change(&tx, 1, "issued-covered");
            let mut admitted = envelope(identity.clone(), 1, 1);
            admitted.coverage.coverage_digest = coverage.coverage_digest;
            record_operation_in(&tx, &admitted).expect("admit issued envelope");
            tx.commit().expect("commit issued envelope");
        }
        assert!(matches!(
            lookup_operation(&conn, &identity).expect("lookup admitted envelope"),
            OperationLookupV1::ExactReplay(_)
        ));

        // Once an identity from the latest range is admitted, a response-loss
        // retry without the durable previous range refuses instead of forking.
        let tx = conn.transaction().expect("missing continuity refusal");
        assert_eq!(
            issue_client_range_in(&tx, "stream-issued", audience, authority, None, 14,)
                .expect_err("admitted epoch requires durable custody")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_RANGE_CONTINUITY_INVALID"
        );
        tx.rollback().expect("rollback refusal");

        let second = {
            let tx = conn.transaction().expect("refresh issuance");
            let range =
                issue_client_range_in(&tx, "stream-issued", audience, authority, Some(&first), 15)
                    .expect("issue contiguous successor");
            tx.commit().expect("commit successor");
            range
        };
        assert_eq!(second.range_start, first.range_end_exclusive);

        let recovered_second = {
            let tx = conn.transaction().expect("lost successor response retry");
            let range =
                issue_client_range_in(&tx, "stream-issued", audience, authority, Some(&first), 16)
                    .expect("re-serve unadmitted successor");
            tx.commit().expect("commit successor recovery no-op");
            range
        };
        assert_eq!(recovered_second, second);

        let mut second_identity = identity.clone();
        second_identity.key.operation_id = "operation-issued-successor".to_owned();
        second_identity.issuance = OperationIssuanceV1::ClientRange {
            epoch_id: second.epoch_id.clone(),
            counter: second.range_start,
            range_start: second.range_start,
            range_end_exclusive: second.range_end_exclusive,
            authority_authenticator_digest: second.authority_authenticator_digest.clone(),
        };
        {
            let tx = conn.transaction().expect("admit successor identity");
            let coverage = active_coverage_manifest(&tx, "stream-issued")
                .expect("coverage lookup")
                .expect("coverage active");
            insert_covered_change(&tx, 2, "issued-successor-covered");
            let mut admitted = envelope(second_identity, 2, 1);
            admitted.coverage.coverage_digest = coverage.coverage_digest;
            record_operation_in(&tx, &admitted).expect("admit successor identity");
            tx.commit().expect("commit successor identity");
        }

        let tx = conn.transaction().expect("stale continuity refusal");
        assert_eq!(
            issue_client_range_in(&tx, "stream-issued", audience, authority, Some(&first), 17,)
                .expect_err("old range cannot fork allocation")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_RANGE_CONTINUITY_INVALID"
        );
        tx.rollback().expect("rollback refusal");

        let third = {
            let tx = conn.transaction().expect("third range issuance");
            let range =
                issue_client_range_in(&tx, "stream-issued", audience, authority, Some(&second), 18)
                    .expect("issue third contiguous range");
            tx.commit().expect("commit third range");
            range
        };
        let fourth = {
            let tx = conn.transaction().expect("fourth range issuance");
            let range =
                issue_client_range_in(&tx, "stream-issued", audience, authority, Some(&third), 19)
                    .expect("issue fourth contiguous range");
            tx.commit().expect("commit fourth range");
            range
        };
        let recovered_fourth = {
            let tx = conn.transaction().expect("fourth response loss retry");
            let range =
                issue_client_range_in(&tx, "stream-issued", audience, authority, Some(&third), 20)
                    .expect("re-serve unadmitted fourth range");
            tx.commit().expect("commit fourth recovery no-op");
            range
        };
        assert_eq!(recovered_fourth, fourth);

        let tx = conn.transaction().expect("epoch capacity refusal");
        assert_eq!(
            issue_client_range_in(&tx, "stream-issued", audience, authority, Some(&fourth), 21)
                .expect_err("fifth range exceeds finite epoch capacity")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_RANGE_EXHAUSTED"
        );
        tx.rollback().expect("rollback capacity refusal");
        let (range_count, allocated): (u64, u64) = conn
            .query_row(
                "SELECT COUNT(*), SUM(range_end_exclusive - range_start)
                 FROM _snapback_operation_ranges_v1 WHERE audience=?1 AND epoch_id=?2",
                params![audience, first.epoch_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("bounded epoch allocation");
        assert_eq!(range_count, CLIENT_IDENTITY_EPOCH_MAX_RANGES_V1);
        assert_eq!(CLIENT_IDENTITY_EPOCH_MAX_RANGES_V1, 4);
        assert_eq!(allocated, CLIENT_IDENTITY_EPOCH_CAPACITY_V1);
        assert_eq!(
            CLIENT_IDENTITY_EPOCH_CAPACITY_V1,
            crate::storage::CLIENT_MUTATION_MAX_RECORDS_PER_AUTH
        );

        let coverage = active_coverage_manifest(&conn, "stream-issued")
            .expect("coverage lookup")
            .expect("ordinary coverage active");
        assert!(
            coverage
                .covered_lanes
                .iter()
                .any(|lane| lane == ORDINARY_MUTATION_LANE_V1)
        );
        let mut expected_writers = ORDINARY_MUTATION_WRITERS_V1
            .iter()
            .map(|writer| (*writer).to_owned())
            .collect::<Vec<_>>();
        expected_writers.sort();
        assert_eq!(coverage.writer_choke_points, expected_writers);
    }

    #[test]
    fn explanation_is_bounded_and_current_authority_fails_closed() {
        let mut conn = connection();
        let authenticator = register_client_authority(&mut conn, 1_000);
        let identity = client_identity(0, "operation-0", &authenticator);
        let tx = conn.transaction().expect("operation tx");
        insert_covered_change(&tx, 1, "todo-1");
        record_operation_in(&tx, &envelope(identity.clone(), 1, 1)).expect("record");
        tx.commit().expect("commit");
        let authority = CurrentExplanationAuthorityV1 {
            audience: "audience-1".to_owned(),
            principal_fingerprint: "principal-1".to_owned(),
            authority_instance_id: "authority-1".to_owned(),
            current_artifact_digest: None,
            current_policy_provable: true,
            fact_policy: ExplanationFactPolicyV1::Unprovable,
            administrative: true,
        };
        let complete = explain_operation(&conn, &identity, &authority)
            .expect("explain")
            .expect("present");
        assert_eq!(complete.disposition, ExplanationDispositionV1::Complete);
        assert!(complete.read_set_digest.is_some());

        let denied = explain_operation(
            &conn,
            &identity,
            &CurrentExplanationAuthorityV1 {
                current_policy_provable: false,
                ..authority.clone()
            },
        )
        .expect("deny")
        .expect("metadata remains");
        assert_eq!(
            denied.disposition,
            ExplanationDispositionV1::AuthorizationUnprovable
        );
        assert_eq!(denied.read_set_digest, None);
        assert_eq!(denied.write_set_count, None);
        let denied_public = denied.into_public();
        assert_eq!(denied_public.key, identity.key);
        assert_eq!(denied_public.operation_kind, None);
        assert_eq!(denied_public.function_or_command, None);
        assert_eq!(denied_public.principal_fingerprint, None);
        assert_eq!(denied_public.principal_session_or_invocation_id, None);
        assert_eq!(denied_public.snapshot, None);

        let tx = conn.transaction().expect("expire detail");
        expire_envelope_detail_in(&tx, &identity).expect("expire");
        tx.commit().expect("commit expiry");
        assert_eq!(
            explain_operation(&conn, &identity, &authority)
                .expect("explain expired")
                .expect("present")
                .disposition,
            ExplanationDispositionV1::DetailExpired
        );
        conn.execute("DELETE FROM _snapback_changes WHERE version=1", [])
            .expect("prune journal");
        assert_eq!(
            explain_operation(&conn, &identity, &authority)
                .expect("explain pruned")
                .expect("present")
                .disposition,
            ExplanationDispositionV1::JournalExpired
        );
        assert_eq!(
            enumerate_explanations(
                &conn,
                &ExplanationQueryV1 {
                    principal_fingerprint: Some("principal-1".to_owned()),
                    limit: 1,
                    ..ExplanationQueryV1::default()
                },
                &authority,
            )
            .expect("bounded enumeration")
            .len(),
            1
        );
        assert_eq!(
            enumerate_explanations(
                &conn,
                &ExplanationQueryV1 {
                    limit: OPERATION_EXPLANATION_MAX_RESULTS_V1 + 1,
                    ..ExplanationQueryV1::default()
                },
                &authority,
            )
            .expect_err("unbounded enumeration")
            .diagnostic
            .code,
            "SNAPBACK_OPERATION_EXPLANATION_LIMIT_INVALID"
        );
    }

    #[test]
    fn public_owner_policy_rechecks_artifact_history_current_row_and_every_fact_class() {
        let mut conn = connection();
        crate::operation_detail::install(&conn, None).expect("install protected custody");
        conn.execute_batch(
            "CREATE TABLE todos(
               _id TEXT PRIMARY KEY,
               ownerId TEXT NOT NULL,
               title TEXT NOT NULL
             );
             CREATE TABLE _snapback_record_history_v1(
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               version INTEGER NOT NULL,
               table_name TEXT NOT NULL,
               row_id TEXT NOT NULL,
               op TEXT NOT NULL,
               row_json TEXT,
               changed_at_ms INTEGER NOT NULL,
               operation_id TEXT
             );
             INSERT INTO todos(_id,ownerId,title) VALUES('todo-1','alice','after');
             INSERT INTO _snapback_record_history_v1(
               version,table_name,row_id,op,row_json,changed_at_ms,operation_id
             ) VALUES(
               1,'todos','todo-1','insert',
               '{\"_id\":\"todo-1\",\"_version\":1,\"ownerId\":\"alice\",\"title\":\"before\"}',
               1,NULL
             );",
        )
        .expect("owner history fixture");
        let authenticator = register_client_authority(&mut conn, 1_000);
        let mut identity = client_identity(0, "operation-owner-update", &authenticator);
        identity.bound_facts.function_or_command = "todos.update".to_owned();
        let artifact_digest = sha('f');
        let read_value = serde_json::to_value(vec![crate::storage::CapturedReadDependency {
            graph: None,
            kind: crate::storage::CapturedReadKind::Row,
            table: Some("todos".to_owned()),
            id: Some("todo-1".to_owned()),
            version: Some(1),
            predicate: None,
            rows: Vec::new(),
            field: None,
            value: None,
            order: None,
            limit: None,
            result_count: None,
            boundary: None,
        }])
        .expect("read detail");
        let changed_row = crate::storage::ChangedRow {
            table: "todos".to_owned(),
            id: "todo-1".to_owned(),
            op: crate::storage::ChangeOp::Update,
            row: Some(json!({
                "_id": "todo-1",
                "_version": 2,
                "ownerId": "alice",
                "title": "after",
            })),
            changed_fields: vec!["title".to_owned()],
        };
        let write_value = serde_json::to_value(vec![changed_row.clone()]).expect("write detail");
        let ctx = crate::manifest::CtxAnswerLedger {
            version: crate::manifest::ctx_ledger_version(),
            ids: Vec::new(),
            now: 10,
            auth_fingerprint: None,
        };
        let ctx_value = serde_json::to_value(&ctx).expect("ctx detail");
        let receipt = crate::manifest::MutationOutput {
            version: 2,
            changed_count: 1,
            result: changed_row.row.clone().expect("post image"),
            authority_transitions: Vec::new(),
            ctx_ledger: Some(ctx.clone()),
            settlement_mint_observations: Vec::new(),
            settlement_time_observation: None,
            settlement_sequence_allocations: Vec::new(),
        };
        let receipt_value = serde_json::to_value(&receipt).expect("receipt detail");
        let tx = conn.transaction().expect("owner operation tx");
        insert_covered_change(&tx, 2, "todo-1");
        let protected = |tx: &Transaction<'_>,
                         reference: &str,
                         domain: &'static [u8],
                         value: Value,
                         count: u64|
         -> EnvelopeFactSetV1 {
            let digest = digest_fact_set(domain, &value);
            let payload_bytes = crate::operation_detail::seal_in(tx, reference, &digest, &value)
                .expect("seal protected fact");
            EnvelopeFactSetV1 {
                digest: digest.clone(),
                count,
                provenance: FactProvenanceV1::ServerCaptured,
                detail: RetainedEnvelopeDetailV1::ProtectedLane {
                    custody_reference: reference.to_owned(),
                    payload_digest: digest,
                    payload_bytes,
                },
            }
        };
        let mut retained = envelope(identity.clone(), 2, 1);
        retained.executable_artifact_digest = LaneFactV1::Defined(artifact_digest.clone());
        retained.effects.facts.digest =
            digest_fact_set(b"snapback:operation-effects:v1\n", &json!([]));
        retained.read_set = protected(&tx, "owner:reads", b"owner:reads\n", read_value, 1);
        retained.write_set = protected(&tx, "owner:writes", b"owner:writes\n", write_value, 1);
        retained.ctx_answers = protected(&tx, "owner:ctx", b"owner:ctx\n", ctx_value, 1);
        let receipt_digest = digest_fact_set(b"owner:receipt\n", &receipt_value);
        let receipt_bytes =
            crate::operation_detail::seal_in(&tx, "owner:receipt", &receipt_digest, &receipt_value)
                .expect("seal receipt");
        retained.receipt.receipt_digest = receipt_digest.clone();
        retained.receipt.payload = RetainedEnvelopeDetailV1::ProtectedLane {
            custody_reference: "owner:receipt".to_owned(),
            payload_digest: receipt_digest,
            payload_bytes: receipt_bytes,
        };
        record_operation_in(&tx, &retained).expect("record owner operation");
        tx.commit().expect("commit owner operation");

        let policy = ExplanationFactPolicyV1::OwnerMutationV1 {
            subject: "alice".to_owned(),
            table: "todos".to_owned(),
            owner_field: "ownerId".to_owned(),
            kind: OwnerMutationExplanationKindV1::Update,
            create_mint_site: None,
        };
        let authority = CurrentExplanationAuthorityV1 {
            audience: "audience-1".to_owned(),
            principal_fingerprint: "principal-1".to_owned(),
            authority_instance_id: "authority-1".to_owned(),
            current_artifact_digest: Some(artifact_digest.clone()),
            current_policy_provable: true,
            fact_policy: policy.clone(),
            administrative: false,
        };
        assert_eq!(
            explain_operation(&conn, &identity, &authority)
                .expect("owner explanation")
                .expect("owner operation")
                .disposition,
            ExplanationDispositionV1::Complete
        );
        for (class, changed_authority) in [
            (
                "audience",
                CurrentExplanationAuthorityV1 {
                    audience: "audience-2".to_owned(),
                    ..authority.clone()
                },
            ),
            (
                "principal",
                CurrentExplanationAuthorityV1 {
                    principal_fingerprint: "principal-2".to_owned(),
                    ..authority.clone()
                },
            ),
            (
                "authority-incarnation",
                CurrentExplanationAuthorityV1 {
                    authority_instance_id: "authority-2".to_owned(),
                    ..authority.clone()
                },
            ),
            (
                "absent-artifact",
                CurrentExplanationAuthorityV1 {
                    current_artifact_digest: None,
                    ..authority.clone()
                },
            ),
            (
                "unsupported-policy",
                CurrentExplanationAuthorityV1 {
                    fact_policy: ExplanationFactPolicyV1::Unprovable,
                    ..authority.clone()
                },
            ),
        ] {
            assert_eq!(
                explain_operation(&conn, &identity, &changed_authority)
                    .expect("authority drift decision")
                    .expect("owner operation")
                    .disposition,
                ExplanationDispositionV1::AuthorizationUnprovable,
                "{class} drift must remain fail-closed"
            );
        }

        conn.execute("UPDATE todos SET ownerId='bob' WHERE _id='todo-1'", [])
            .expect("change current owner");
        assert_eq!(
            explain_operation(&conn, &identity, &authority)
                .expect("current owner denial")
                .expect("owner operation")
                .disposition,
            ExplanationDispositionV1::AuthorizationUnprovable
        );
        conn.execute("UPDATE todos SET ownerId='alice' WHERE _id='todo-1'", [])
            .expect("restore current owner");
        conn.execute(
            "UPDATE _snapback_record_history_v1
             SET row_json='{\"_id\":\"todo-1\",\"_version\":1,\"ownerId\":\"bob\",\"title\":\"before\"}'
             WHERE table_name='todos' AND row_id='todo-1' AND version=1",
            [],
        )
        .expect("change historical owner");
        assert_eq!(
            explain_operation(&conn, &identity, &authority)
                .expect("historical owner denial")
                .expect("owner operation")
                .disposition,
            ExplanationDispositionV1::AuthorizationUnprovable
        );
        conn.execute(
            "UPDATE _snapback_record_history_v1
             SET row_json='{\"_id\":\"todo-1\",\"_version\":1,\"ownerId\":\"alice\",\"title\":\"before\"}'
             WHERE table_name='todos' AND row_id='todo-1' AND version=1",
            [],
        )
        .expect("restore historical owner");
        assert_eq!(
            explain_operation(
                &conn,
                &identity,
                &CurrentExplanationAuthorityV1 {
                    current_artifact_digest: Some(sha('9')),
                    ..authority.clone()
                },
            )
            .expect("artifact denial")
            .expect("owner operation")
            .disposition,
            ExplanationDispositionV1::AuthorizationUnprovable
        );

        let (_, Some(detail)) = detail_projection(&conn, &retained) else {
            panic!("protected owner detail opens");
        };
        let mut auth_and_permission_detail = detail.clone();
        auth_and_permission_detail["readSet"]
            .as_array_mut()
            .expect("read set array")
            .extend([
                json!({
                    "kind": "auth",
                    "field": "userId",
                    "value": "alice",
                }),
                json!({
                    "kind": "permission",
                    "version": 0,
                    "field": "scope",
                    "value": "user:alice",
                }),
            ]);
        let mut auth_and_permission_envelope = retained.clone();
        auth_and_permission_envelope.read_set.count = 3;
        assert!(
            public_fact_policy_projection(
                &conn,
                &auth_and_permission_envelope,
                &auth_and_permission_detail,
                &policy,
            )
            .expect("auth and permission facts")
            .is_some(),
            "exact current-subject auth and permission facts remain provable"
        );
        for (class, path, changed_value) in [
            ("changed-auth-subject", 1, json!("bob")),
            ("changed-permission-scope", 2, json!("user:bob")),
        ] {
            let mut changed = auth_and_permission_detail.clone();
            changed["readSet"][path]["value"] = changed_value;
            assert!(
                public_fact_policy_projection(
                    &conn,
                    &auth_and_permission_envelope,
                    &changed,
                    &policy,
                )
                .expect("changed auth fact decision")
                .is_none(),
                "{class} must remain fail-closed"
            );
        }
        for (class, changed) in [
            ("missing-row", {
                let mut value = detail.clone();
                value["readSet"][0]["kind"] = json!("missingRow");
                value
            }),
            ("predicate-membership", {
                let mut value = detail.clone();
                value["readSet"][0]["kind"] = json!("query");
                value["readSet"][0]["predicate"] = json!({"ownerId":"alice"});
                value
            }),
            ("aggregate-result-membership", {
                let mut value = detail.clone();
                value["readSet"][0]["kind"] = json!("query");
                value["readSet"][0]["predicate"] = json!({"ownerId":"alice"});
                value["readSet"][0]["rows"] = json!(["todo-1"]);
                value["readSet"][0]["result_count"] = json!(1);
                value
            }),
            ("row-with-result-membership", {
                let mut value = detail.clone();
                value["readSet"][0]["rows"] = json!(["todo-1"]);
                value["readSet"][0]["result_count"] = json!(1);
                value
            }),
            ("membership-permission", {
                let mut value = detail.clone();
                value["readSet"][0]["kind"] = json!("permission");
                value["readSet"][0]["predicate"] = json!({"resource":"room-1"});
                value
            }),
            ("nonempty-ctx", {
                let mut value = detail.clone();
                value["ctxAnswers"]["ids"] = json!(["generated-secret"]);
                value
            }),
            ("divergent-receipt", {
                let mut value = detail.clone();
                value["receipt"]["result"]["title"] = json!("different");
                value
            }),
            ("nonempty-effect", {
                let mut value = detail.clone();
                value["effects"] = json!([{"family":"fetch"}]);
                value
            }),
        ] {
            assert!(
                public_fact_policy_projection(&conn, &retained, &changed, &policy)
                    .expect("fact policy decision")
                    .is_none(),
                "{class} must remain fail-closed"
            );
        }

        let mut truncated = retained.clone();
        truncated.read_set.detail = RetainedEnvelopeDetailV1::Truncated;
        assert_eq!(
            project_explanation(&conn, truncated, &authority)
                .expect("truncated projection")
                .disposition,
            ExplanationDispositionV1::AuthorizationUnprovable
        );
        let mut expired = retained.clone();
        expired.read_set.detail = RetainedEnvelopeDetailV1::Expired;
        assert_eq!(
            project_explanation(&conn, expired, &authority)
                .expect("expired projection")
                .disposition,
            ExplanationDispositionV1::AuthorizationUnprovable
        );

        // The active generated create artifact can justify the row id it
        // minted only by binding the private observation to its exact plan
        // site. The observation is then stripped from the public receipt; it
        // is captured consistency evidence, never owner authority.
        conn.execute(
            "INSERT INTO todos(_id,ownerId,title) VALUES('todo-create','alice','created')",
            [],
        )
        .expect("current created row");
        conn.execute(
            "INSERT INTO _snapback_record_history_v1(
               version,table_name,row_id,op,row_json,changed_at_ms,operation_id
             ) VALUES(
               3,'todos','todo-create','insert',
               '{\"_id\":\"todo-create\",\"_version\":3,\"ownerId\":\"alice\",\"title\":\"created\"}',
               3,NULL
             )",
            [],
        )
        .expect("created row history");
        let create_row = crate::storage::ChangedRow {
            table: "todos".to_owned(),
            id: "todo-create".to_owned(),
            op: crate::storage::ChangeOp::Insert,
            row: Some(json!({
                "_id": "todo-create",
                "_version": 3,
                "ownerId": "alice",
                "title": "created",
            })),
            changed_fields: vec!["ownerId".to_owned(), "title".to_owned()],
        };
        let create_ctx = crate::manifest::CtxAnswerLedger {
            version: crate::manifest::ctx_ledger_version(),
            ids: vec!["todo-create".to_owned()],
            now: 11,
            auth_fingerprint: None,
        };
        let create_receipt = crate::manifest::MutationOutput {
            version: 3,
            changed_count: 1,
            result: create_row.row.clone().expect("create result"),
            authority_transitions: Vec::new(),
            ctx_ledger: Some(create_ctx.clone()),
            settlement_mint_observations: vec![crate::manifest::SettlementMintObservation {
                id: "todo-create".to_owned(),
                site: "plan/steps/0/insert/row-id".to_owned(),
                occurrence: 0,
            }],
            settlement_time_observation: None,
            settlement_sequence_allocations: Vec::new(),
        };
        let create_detail = json!({
            "readSet": [],
            "writeSet": [create_row],
            "ctxAnswers": create_ctx,
            "effects": [],
            "receipt": create_receipt,
        });
        let mut create_envelope = retained.clone();
        create_envelope.snapshot.version = 3;
        create_envelope.read_set.count = 0;
        create_envelope.write_set.count = 1;
        let create_policy = ExplanationFactPolicyV1::OwnerMutationV1 {
            subject: "alice".to_owned(),
            table: "todos".to_owned(),
            owner_field: "ownerId".to_owned(),
            kind: OwnerMutationExplanationKindV1::Create,
            create_mint_site: Some("plan/steps/0/insert/row-id".to_owned()),
        };
        let projected =
            public_fact_policy_projection(&conn, &create_envelope, &create_detail, &create_policy)
                .expect("generated create policy")
                .expect("generated create facts are current-policy provable");
        assert_eq!(projected["receipt"]["result"]["_id"], "todo-create");
        assert!(
            projected["receipt"]
                .get("_settlementMintObservations")
                .is_none(),
            "the private mint-site ledger never crosses public explanation"
        );

        for (class, changed) in [
            ("wrong-site", {
                let mut value = create_detail.clone();
                value["receipt"]["_settlementMintObservations"][0]["site"] =
                    json!("plan/steps/1/insert/row-id");
                value
            }),
            ("extra-observation", {
                let mut value = create_detail.clone();
                value["receipt"]["_settlementMintObservations"]
                    .as_array_mut()
                    .expect("mint observation array")
                    .push(json!({
                        "id": "todo-create",
                        "site": "plan/steps/0/insert/row-id",
                        "occurrence": 1,
                    }));
                value
            }),
            ("reordered-observations", {
                let mut value = create_detail.clone();
                value["receipt"]["_settlementMintObservations"] = json!([
                    {
                        "id": "todo-create",
                        "site": "plan/steps/0/insert/row-id",
                        "occurrence": 1,
                    },
                    {
                        "id": "todo-create",
                        "site": "plan/steps/0/insert/row-id",
                        "occurrence": 0,
                    },
                ]);
                value
            }),
        ] {
            assert!(
                public_fact_policy_projection(&conn, &create_envelope, &changed, &create_policy)
                    .expect("mint-context decision")
                    .is_none(),
                "{class} must not be accepted as the generated create mint"
            );
        }

        let mut effect_bearing = create_envelope.clone();
        effect_bearing
            .effects
            .egress_families
            .push(crate::commit_envelope::EffectEgressFamilyV1::Fetch);
        assert!(
            public_fact_policy_projection(&conn, &effect_bearing, &create_detail, &create_policy,)
                .expect("effect-bearing decision")
                .is_none()
        );

        // Generated owner delete is an exact recognizable policy shape, but
        // current owner policy cannot be evaluated after the row is absent.
        // Historical ownership and operation identity therefore cannot
        // authorize its public explanation.
        let delete_policy = ExplanationFactPolicyV1::OwnerMutationV1 {
            subject: "alice".to_owned(),
            table: "todos".to_owned(),
            owner_field: "ownerId".to_owned(),
            kind: OwnerMutationExplanationKindV1::Delete,
            create_mint_site: None,
        };
        let mut delete_detail = detail.clone();
        delete_detail["writeSet"][0]["op"] = json!("Delete");
        delete_detail["receipt"]["result"] = json!(1);
        conn.execute("DELETE FROM todos WHERE _id='todo-1'", [])
            .expect("delete current row");
        assert!(
            public_fact_policy_projection(&conn, &retained, &delete_detail, &delete_policy)
                .expect("generated delete decision")
                .is_none(),
            "retained owner identity cannot replace absent current authority"
        );
    }

    #[test]
    fn coverage_bypass_and_host_namespace_squatting_are_refused() {
        let mut conn = connection();
        let authenticator = register_client_authority(&mut conn, 1_000);
        let client = client_identity(0, "shared-operation", &authenticator);
        let tx = conn.transaction().expect("coverage negatives");
        let mut wrong_coverage = envelope(client.clone(), 1, 0);
        wrong_coverage.coverage.coverage_digest = sha('f');
        assert_eq!(
            record_operation_in(&tx, &wrong_coverage)
                .expect_err("coverage mismatch")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_COVERAGE_MISMATCH"
        );
        let missing_journal = envelope(client.clone(), 1, 1);
        assert_eq!(
            record_operation_in(&tx, &missing_journal)
                .expect_err("missing journal")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_JOURNAL_INCOMPLETE"
        );
        tx.rollback().expect("rollback negatives");

        let tx = conn.transaction().expect("host setup");
        register_epoch_in(
            &tx,
            &IdentityEpochV1 {
                schema_version: 1,
                originator_class: OperationOriginatorClassV1::Host,
                audience: "audience-1".to_owned(),
                authority_instance_id: "host-incarnation-1".to_owned(),
                epoch_id: "host-epoch-1".to_owned(),
                epoch_sequence: 1,
                state: IdentityEpochStateV1::Open,
                issued_at_ms: 1,
                terminated_at_ms: None,
                authority_authenticator_digest: sha('e'),
            },
        )
        .expect("host epoch");
        let mut host = client.clone();
        host.key.originator_class = OperationOriginatorClassV1::Host;
        host.bound_facts.authority_instance_id = "host-incarnation-1".to_owned();
        host.key.operation_id = derive_host_operation_id("cron:occurrence-1", 0);
        host.issuance = OperationIssuanceV1::HostIncarnation {
            epoch_id: "host-epoch-1".to_owned(),
            upstream_identity: "cron:occurrence-1".to_owned(),
            commit_ordinal: 0,
            authority_authenticator_digest: sha('e'),
        };
        let mut forged_authenticator = host.clone();
        forged_authenticator.issuance = OperationIssuanceV1::HostIncarnation {
            epoch_id: "host-epoch-1".to_owned(),
            upstream_identity: "cron:occurrence-1".to_owned(),
            commit_ordinal: 0,
            authority_authenticator_digest: sha('f'),
        };
        assert_eq!(
            record_operation_in(&tx, &envelope(forged_authenticator, 0, 0))
                .expect_err("forged host authenticator")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_ISSUANCE_AUTH_INVALID"
        );
        let mut squatted_identity = host.clone();
        squatted_identity.key.operation_id = "client-chosen-host-id".to_owned();
        assert_eq!(
            record_operation_in(&tx, &envelope(squatted_identity, 0, 0))
                .expect_err("host namespace squatting")
                .diagnostic
                .code,
            "SNAPBACK_HOST_OPERATION_IDENTITY_INVALID"
        );
        record_operation_in(&tx, &envelope(host.clone(), 0, 0)).expect("host operation");
        let mut pending_guard = host.clone();
        pending_guard.key.operation_id = derive_host_operation_id("migration:pending-guard", 0);
        pending_guard.issuance = OperationIssuanceV1::HostIncarnation {
            epoch_id: "host-epoch-1".to_owned(),
            upstream_identity: "migration:pending-guard".to_owned(),
            commit_ordinal: 0,
            authority_authenticator_digest: sha('e'),
        };
        record_operation_in(&tx, &envelope(pending_guard.clone(), 0, 0))
            .expect("terminal predecessor for pending guard");
        acknowledge_and_reclaim_in(&tx, &pending_guard, 12)
            .expect("retain pending-guard tombstone");
        assert!(
            prune_compact_envelope_in(&tx, &pending_guard)
                .expect("prune pending-guard compact envelope")
        );
        tx.execute_batch("SAVEPOINT terminal_writer_guard")
            .expect("terminal writer savepoint");
        insert_covered_change(&tx, 76, "terminal-guard-rolled-back");
        assert_eq!(
            record_operation_in(&tx, &envelope(pending_guard.clone(), 76, 1))
                .expect_err("terminal writer cannot reuse a tombstoned host identity")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_ALREADY_RECORDED"
        );
        let (staged_rows, envelopes, suppressions, leases, tombstones): (u64, u64, u64, u64, u64) =
            tx.query_row(
                "SELECT
                   (SELECT COUNT(*) FROM app_rows WHERE id='terminal-guard-rolled-back') +
                   (SELECT COUNT(*) FROM _snapback_changes WHERE version=76),
                   (SELECT COUNT(*) FROM _snapback_commit_envelopes_v1
                     WHERE stream_id=?1 AND originator_class='host' AND operation_id=?2),
                   (SELECT COUNT(*) FROM _snapback_operation_suppression_v1
                     WHERE stream_id=?1 AND originator_class='host' AND operation_id=?2),
                   (SELECT COUNT(*) FROM _snapback_host_identity_leases_v1
                     WHERE stream_id=?1 AND operation_id=?2),
                   (SELECT COUNT(*) FROM _snapback_operation_tombstones_v1
                     WHERE stream_id=?1 AND originator_class='host' AND operation_id=?2)",
                params![pending_guard.key.stream_id, pending_guard.key.operation_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("terminal guard staged state");
        assert_eq!(
            (staged_rows, envelopes, suppressions, leases, tombstones),
            (2, 0, 0, 0, 1),
            "the retained-state guard refuses before lifecycle writes while caller writes remain staged"
        );
        tx.execute_batch("ROLLBACK TO terminal_writer_guard; RELEASE terminal_writer_guard")
            .expect("rollback terminal writer publication");
        let terminal_staged_rows: u64 = tx
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM app_rows WHERE id='terminal-guard-rolled-back') +
                   (SELECT COUNT(*) FROM _snapback_changes WHERE version=76)",
                [],
                |row| row.get(0),
            )
            .expect("terminal guard rollback state");
        assert_eq!(terminal_staged_rows, 0);
        tx.execute_batch("SAVEPOINT pending_writer_guard")
            .expect("pending writer savepoint");
        insert_covered_change(&tx, 77, "pending-guard-rolled-back");
        let mut pending_envelope = envelope(pending_guard.clone(), 77, 1);
        pending_envelope.snapshot.association = SnapshotAssociationKindV1::ProducedCommit;
        pending_envelope.recorded_at_ms = 13;
        pending_envelope.receipt.state = OperationReceiptStateV1::Pending;
        pending_envelope.receipt.payload = RetainedEnvelopeDetailV1::InlineRedacted {
            detail: json!({"migrationId":"pending-guard"}),
        };
        let pending_payload =
            serde_json::to_value(&pending_envelope.receipt.payload).expect("pending payload");
        pending_envelope.receipt.receipt_digest =
            pending_operation_receipt_digest(&pending_payload).expect("pending digest");
        let pending_lifecycle = PendingOperationLifecycleV1 {
            schema_version: 1,
            lane: "migration".to_owned(),
            identity: pending_guard.clone(),
            publication: pending_envelope.snapshot.clone(),
            pending_receipt_digest: pending_envelope.receipt.receipt_digest.clone(),
            pending_payload,
            pending_at_ms: pending_envelope.recorded_at_ms,
        };
        assert_eq!(
            record_pending_operation_in(&tx, &pending_envelope, &pending_lifecycle, 8)
                .expect_err("pending writer cannot reuse a tombstoned host identity")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_ALREADY_RECORDED"
        );
        let (staged_rows, pending_rows, envelopes, leases, tombstones): (u64, u64, u64, u64, u64) =
            tx.query_row(
                "SELECT
                   (SELECT COUNT(*) FROM app_rows WHERE id='pending-guard-rolled-back') +
                   (SELECT COUNT(*) FROM _snapback_changes WHERE version=77),
                   (SELECT COUNT(*) FROM _snapback_operation_pending_v1
                     WHERE stream_id=?1 AND originator_class='host' AND operation_id=?2),
                   (SELECT COUNT(*) FROM _snapback_commit_envelopes_v1
                     WHERE stream_id=?1 AND originator_class='host' AND operation_id=?2),
                   (SELECT COUNT(*) FROM _snapback_host_identity_leases_v1
                     WHERE stream_id=?1 AND operation_id=?2),
                   (SELECT COUNT(*) FROM _snapback_operation_tombstones_v1
                     WHERE stream_id=?1 AND originator_class='host' AND operation_id=?2)",
                params![pending_guard.key.stream_id, pending_guard.key.operation_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("pending guard staged state");
        assert_eq!(
            (staged_rows, pending_rows, envelopes, leases, tombstones),
            (2, 0, 0, 0, 1),
            "pending refusal leaves caller app/journal writes staged and writes no lifecycle state"
        );
        tx.execute_batch("ROLLBACK TO pending_writer_guard; RELEASE pending_writer_guard")
            .expect("rollback pending writer publication");
        let (staged_rows, pending_rows, envelopes, leases, tombstones): (u64, u64, u64, u64, u64) =
            tx.query_row(
                "SELECT
                   (SELECT COUNT(*) FROM app_rows WHERE id='pending-guard-rolled-back') +
                   (SELECT COUNT(*) FROM _snapback_changes WHERE version=77),
                   (SELECT COUNT(*) FROM _snapback_operation_pending_v1
                     WHERE stream_id=?1 AND originator_class='host' AND operation_id=?2),
                   (SELECT COUNT(*) FROM _snapback_commit_envelopes_v1
                     WHERE stream_id=?1 AND originator_class='host' AND operation_id=?2),
                   (SELECT COUNT(*) FROM _snapback_host_identity_leases_v1
                     WHERE stream_id=?1 AND operation_id=?2),
                   (SELECT COUNT(*) FROM _snapback_operation_tombstones_v1
                     WHERE stream_id=?1 AND originator_class='host' AND operation_id=?2)",
                params![pending_guard.key.stream_id, pending_guard.key.operation_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("pending guard retained state");
        assert_eq!(
            (staged_rows, pending_rows, envelopes, leases, tombstones),
            (0, 0, 0, 0, 1)
        );
        let mut pending_terminal = host.clone();
        pending_terminal.key.operation_id =
            derive_host_operation_id("migration:pending-terminal", 0);
        pending_terminal.issuance = OperationIssuanceV1::HostIncarnation {
            epoch_id: "host-epoch-1".to_owned(),
            upstream_identity: "migration:pending-terminal".to_owned(),
            commit_ordinal: 0,
            authority_authenticator_digest: sha('e'),
        };
        insert_covered_change(&tx, 78, "pending-terminal-retained");
        let mut pending_terminal_envelope = envelope(pending_terminal.clone(), 78, 1);
        pending_terminal_envelope.snapshot.association = SnapshotAssociationKindV1::ProducedCommit;
        pending_terminal_envelope.recorded_at_ms = 14;
        pending_terminal_envelope.receipt.state = OperationReceiptStateV1::Pending;
        pending_terminal_envelope.receipt.payload = RetainedEnvelopeDetailV1::InlineRedacted {
            detail: json!({"migrationId":"pending-terminal"}),
        };
        let pending_terminal_payload =
            serde_json::to_value(&pending_terminal_envelope.receipt.payload)
                .expect("pending terminal payload");
        pending_terminal_envelope.receipt.receipt_digest =
            pending_operation_receipt_digest(&pending_terminal_payload)
                .expect("pending terminal digest");
        let pending_terminal_lifecycle = PendingOperationLifecycleV1 {
            schema_version: 1,
            lane: "migration".to_owned(),
            identity: pending_terminal.clone(),
            publication: pending_terminal_envelope.snapshot.clone(),
            pending_receipt_digest: pending_terminal_envelope.receipt.receipt_digest.clone(),
            pending_payload: pending_terminal_payload,
            pending_at_ms: pending_terminal_envelope.recorded_at_ms,
        };
        record_pending_operation_in(
            &tx,
            &pending_terminal_envelope,
            &pending_terminal_lifecycle,
            8,
        )
        .expect("record outcome-pending Host publication");
        let terminal_projection = json!({"migrationId":"pending-terminal","state":"committed"});
        let terminal_receipt_digest =
            pending_operation_terminal_receipt_digest(&terminal_projection)
                .expect("terminal receipt digest");
        let terminal_write_set_digest = sha('d');
        let terminal_supplement = PendingOperationTerminalSupplementV1 {
            schema_version: 1,
            identity: pending_terminal.clone(),
            publication: pending_terminal_lifecycle.publication.clone(),
            pending_receipt_digest: pending_terminal_lifecycle.pending_receipt_digest.clone(),
            terminal_outcome: PendingOperationTerminalOutcomeV1::Committed,
            terminal_receipt_digest: terminal_receipt_digest.clone(),
            terminal_write_set_digest: terminal_write_set_digest.clone(),
            terminal_write_set_count: 1,
            terminal_at_ms: 100,
            transition_digest: pending_operation_transition_digest(
                &pending_terminal,
                &pending_terminal_lifecycle.publication,
                &pending_terminal_lifecycle.pending_receipt_digest,
                PendingOperationTerminalOutcomeV1::Committed,
                &terminal_receipt_digest,
                &terminal_write_set_digest,
                1,
            ),
        };
        finalize_pending_operation_in(&tx, &terminal_supplement, &terminal_projection)
            .expect("finalize outcome-pending Host publication");
        let mut live_ticket = host.clone();
        live_ticket.key.operation_id = derive_host_operation_id("promotion:ticket-1", 0);
        live_ticket.issuance = OperationIssuanceV1::HostIncarnation {
            epoch_id: "host-epoch-1".to_owned(),
            upstream_identity: "promotion:ticket-1".to_owned(),
            commit_ordinal: 0,
            authority_authenticator_digest: sha('e'),
        };
        register_host_identity_lease_in(&tx, &live_ticket, HOST_RECEIPT_WINDOW_MS_V1 + 100)
            .expect("live promotion ticket lease");
        tx.commit().expect("commit host");
        assert_eq!(
            lookup_operation(&conn, &client).expect("client key"),
            OperationLookupV1::Novel
        );
        assert!(matches!(
            lookup_operation(&conn, &host).expect("host retry"),
            OperationLookupV1::ExactReplay(_)
        ));

        let tx = conn.transaction().expect("host closure");
        assert!(
            !close_epoch_if_complete_in(
                &tx,
                OperationOriginatorClassV1::Host,
                "audience-1",
                "host-epoch-1",
                HOST_RECEIPT_WINDOW_MS_V1 + 11,
            )
            .expect("caller cannot assert an unrecorded rotation")
        );
        assert_eq!(
            rotate_host_incarnation_in(
                &tx,
                "audience-1",
                "host-epoch-1",
                &IdentityEpochV1 {
                    schema_version: 1,
                    originator_class: OperationOriginatorClassV1::Host,
                    audience: "audience-1".to_owned(),
                    authority_instance_id: "host-incarnation-1".to_owned(),
                    epoch_id: "host-epoch-forged".to_owned(),
                    epoch_sequence: 2,
                    state: IdentityEpochStateV1::Open,
                    issued_at_ms: 20,
                    terminated_at_ms: None,
                    authority_authenticator_digest: sha('f'),
                },
                20,
            )
            .expect_err("same incarnation is not a rotation")
            .diagnostic
            .code,
            "SNAPBACK_HOST_INCARNATION_ROTATION_INVALID"
        );
        rotate_host_incarnation_in(
            &tx,
            "audience-1",
            "host-epoch-1",
            &IdentityEpochV1 {
                schema_version: 1,
                originator_class: OperationOriginatorClassV1::Host,
                audience: "audience-1".to_owned(),
                authority_instance_id: "host-incarnation-2".to_owned(),
                epoch_id: "host-epoch-2".to_owned(),
                epoch_sequence: 2,
                state: IdentityEpochStateV1::Open,
                issued_at_ms: 20,
                terminated_at_ms: None,
                authority_authenticator_digest: sha('f'),
            },
            20,
        )
        .expect("rotate host incarnation");
        assert!(
            !close_epoch_if_complete_in(
                &tx,
                OperationOriginatorClassV1::Host,
                "audience-1",
                "host-epoch-1",
                HOST_RECEIPT_WINDOW_MS_V1 - 1,
            )
            .expect("host window remains")
        );
        for (column, moved, restored) in [
            ("audience", "moved-audience", "audience-1"),
            ("epoch_id", "moved-epoch", "host-epoch-1"),
        ] {
            tx.execute(
                &format!(
                    "UPDATE _snapback_host_identity_leases_v1 SET {column}=?1
                      WHERE stream_id=?2 AND operation_id=?3"
                ),
                params![
                    moved,
                    live_ticket.key.stream_id,
                    live_ticket.key.operation_id
                ],
            )
            .unwrap_or_else(|error| panic!("move Host lease {column}: {error}"));
            assert_eq!(
                close_epoch_if_complete_in(
                    &tx,
                    OperationOriginatorClassV1::Host,
                    "audience-1",
                    "host-epoch-1",
                    HOST_RECEIPT_WINDOW_MS_V1 + 11,
                )
                .expect_err("moved Host lease projection cannot hide a live ticket")
                .diagnostic
                .code,
                "SNAPBACK_OPERATION_LEDGER_INVALID"
            );
            assert_eq!(
                complete_host_identity_lease_in(&tx, &live_ticket, HOST_RECEIPT_WINDOW_MS_V1 + 11,)
                    .expect_err("lease completion validates retained projections")
                    .diagnostic
                    .code,
                "SNAPBACK_OPERATION_LEDGER_INVALID"
            );
            tx.execute(
                &format!(
                    "UPDATE _snapback_host_identity_leases_v1 SET {column}=?1
                      WHERE stream_id=?2 AND operation_id=?3"
                ),
                params![
                    restored,
                    live_ticket.key.stream_id,
                    live_ticket.key.operation_id
                ],
            )
            .unwrap_or_else(|error| panic!("restore Host lease {column}: {error}"));
        }
        tx.execute(
            "UPDATE _snapback_host_identity_leases_v1 SET operation_id='moved-operation'
              WHERE stream_id=?1 AND operation_id=?2",
            params![live_ticket.key.stream_id, live_ticket.key.operation_id],
        )
        .expect("move Host lease physical key");
        assert_eq!(
            close_epoch_if_complete_in(
                &tx,
                OperationOriginatorClassV1::Host,
                "audience-1",
                "host-epoch-1",
                HOST_RECEIPT_WINDOW_MS_V1 + 11,
            )
            .expect_err("moved Host lease physical key cannot hide a live ticket")
            .diagnostic
            .code,
            "SNAPBACK_OPERATION_LEDGER_INVALID"
        );
        assert_eq!(
            complete_host_identity_lease_in(&tx, &live_ticket, HOST_RECEIPT_WINDOW_MS_V1 + 11,)
                .expect_err("lease completion globally validates physical keys")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_LEDGER_INVALID"
        );
        tx.execute(
            "UPDATE _snapback_host_identity_leases_v1 SET operation_id=?1
              WHERE stream_id=?2 AND operation_id='moved-operation'",
            params![live_ticket.key.operation_id, live_ticket.key.stream_id],
        )
        .expect("restore Host lease physical key");
        assert!(
            !close_epoch_if_complete_in(
                &tx,
                OperationOriginatorClassV1::Host,
                "audience-1",
                "host-epoch-1",
                HOST_RECEIPT_WINDOW_MS_V1 + 11,
            )
            .expect("live ticket holds the rotated epoch open")
        );
        complete_host_identity_lease_in(&tx, &live_ticket, HOST_RECEIPT_WINDOW_MS_V1 + 11)
            .expect("ticket completed");
        tx.execute(
            "UPDATE _snapback_operation_suppression_v1
                SET terminal_at_ms=0
              WHERE stream_id=?1 AND originator_class='host' AND operation_id=?2",
            params![host.key.stream_id, host.key.operation_id],
        )
        .expect("stage retention-time projection corruption");
        assert_eq!(
            lookup_operation(&tx, &host)
                .expect_err("terminal-time-corrupt suppression never settles")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_LEDGER_INVALID"
        );
        assert_eq!(
            close_epoch_if_complete_in(
                &tx,
                OperationOriginatorClassV1::Host,
                "audience-1",
                "host-epoch-1",
                HOST_RECEIPT_WINDOW_MS_V1 + 11,
            )
            .expect_err("host closure cannot trust a divergent terminal time")
            .diagnostic
            .code,
            "SNAPBACK_OPERATION_LEDGER_INVALID"
        );
        tx.execute(
            "UPDATE _snapback_operation_suppression_v1
                SET terminal_at_ms=10
              WHERE stream_id=?1 AND originator_class='host' AND operation_id=?2",
            params![host.key.stream_id, host.key.operation_id],
        )
        .expect("restore coherent retention time");
        let host_record_json: String = tx
            .query_row(
                "SELECT record_json FROM _snapback_operation_suppression_v1
                  WHERE stream_id=?1 AND originator_class='host' AND operation_id=?2",
                params![host.key.stream_id, host.key.operation_id],
                |row| row.get(0),
            )
            .expect("read Host suppression JSON");
        let host_record: OperationSuppressionRecordV1 =
            serde_json::from_str(&host_record_json).expect("decode Host suppression JSON");
        for (label, corrupted) in [
            ("terminal JSON", {
                let mut record = host_record.clone();
                record.terminal_at_ms = 0;
                record
            }),
            ("acknowledgement JSON", {
                let mut record = host_record.clone();
                record.acknowledged_at_ms = Some(5);
                record
            }),
        ] {
            tx.execute(
                "UPDATE _snapback_operation_suppression_v1 SET record_json=?1
                  WHERE stream_id=?2 AND originator_class='host' AND operation_id=?3",
                params![
                    serde_json::to_string(&corrupted).expect("encode corrupt Host suppression"),
                    host.key.stream_id,
                    host.key.operation_id,
                ],
            )
            .unwrap_or_else(|error| panic!("stage {label} corruption: {error}"));
            assert_eq!(
                lookup_operation(&tx, &host)
                    .expect_err("corrupt Host suppression never replays")
                    .diagnostic
                    .code,
                "SNAPBACK_OPERATION_LEDGER_INVALID"
            );
            assert_eq!(
                close_epoch_if_complete_in(
                    &tx,
                    OperationOriginatorClassV1::Host,
                    "audience-1",
                    "host-epoch-1",
                    HOST_RECEIPT_WINDOW_MS_V1 + 11,
                )
                .expect_err("Host closure rejects corrupt suppression JSON")
                .diagnostic
                .code,
                "SNAPBACK_OPERATION_LEDGER_INVALID"
            );
            tx.execute(
                "UPDATE _snapback_operation_suppression_v1 SET record_json=?1
                  WHERE stream_id=?2 AND originator_class='host' AND operation_id=?3",
                params![&host_record_json, host.key.stream_id, host.key.operation_id],
            )
            .unwrap_or_else(|error| panic!("restore {label} coherence: {error}"));
        }
        tx.execute(
            "UPDATE _snapback_operation_terminal_supplements_v1
                SET terminal_at_ms=0
              WHERE stream_id=?1 AND originator_class='host' AND operation_id=?2",
            params![
                pending_terminal.key.stream_id,
                pending_terminal.key.operation_id
            ],
        )
        .expect("stage terminal-supplement retention-time corruption");
        assert_eq!(
            lookup_pending_operation(&tx, &pending_terminal)
                .expect_err("terminal-supplement projection corruption never settles")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_LEDGER_INVALID"
        );
        assert_eq!(
            finalize_pending_operation_in(&tx, &terminal_supplement, &terminal_projection)
                .expect_err("terminal exact replay validates retained SQL/JSON coherence")
                .diagnostic
                .code,
            "SNAPBACK_OPERATION_LEDGER_INVALID"
        );
        assert_eq!(
            close_epoch_if_complete_in(
                &tx,
                OperationOriginatorClassV1::Host,
                "audience-1",
                "host-epoch-1",
                HOST_RECEIPT_WINDOW_MS_V1 + 11,
            )
            .expect_err("host closure cannot trust a divergent supplement time")
            .diagnostic
            .code,
            "SNAPBACK_OPERATION_LEDGER_INVALID"
        );
        tx.execute(
            "UPDATE _snapback_operation_terminal_supplements_v1
                SET terminal_at_ms=100
              WHERE stream_id=?1 AND originator_class='host' AND operation_id=?2",
            params![
                pending_terminal.key.stream_id,
                pending_terminal.key.operation_id
            ],
        )
        .expect("restore coherent terminal-supplement time");
        assert!(
            !close_epoch_if_complete_in(
                &tx,
                OperationOriginatorClassV1::Host,
                "audience-1",
                "host-epoch-1",
                HOST_RECEIPT_WINDOW_MS_V1 + 11,
            )
            .expect("young terminal supplement retains the Host epoch")
        );
        assert!(
            close_epoch_if_complete_in(
                &tx,
                OperationOriginatorClassV1::Host,
                "audience-1",
                "host-epoch-1",
                HOST_RECEIPT_WINDOW_MS_V1 + 101,
            )
            .expect("host window elapsed after ticket completion")
        );
        let (state, floor, suppressions, pending, supplements, leases, tombstones): (
            String,
            u64,
            u64,
            u64,
            u64,
            u64,
            u64,
        ) = tx
            .query_row(
                "SELECT
                   (SELECT state FROM _snapback_operation_epochs_v1
                     WHERE originator_class='host' AND audience='audience-1'
                       AND epoch_id='host-epoch-1'),
                   (SELECT floor_sequence FROM _snapback_operation_floors_v1
                     WHERE originator_class='host' AND audience='audience-1'),
                   (SELECT COUNT(*) FROM _snapback_operation_suppression_v1
                     WHERE originator_class='host' AND audience='audience-1'
                       AND epoch_id='host-epoch-1'),
                   (SELECT COUNT(*) FROM _snapback_operation_pending_v1
                     WHERE originator_class='host' AND audience='audience-1'
                       AND epoch_id='host-epoch-1'),
                   (SELECT COUNT(*) FROM _snapback_operation_terminal_supplements_v1
                     WHERE originator_class='host' AND audience='audience-1'
                       AND epoch_id='host-epoch-1'),
                   (SELECT COUNT(*) FROM _snapback_host_identity_leases_v1
                     WHERE audience='audience-1' AND epoch_id='host-epoch-1'),
                   (SELECT COUNT(*) FROM _snapback_operation_tombstones_v1
                     WHERE originator_class='host' AND audience='audience-1'
                       AND epoch_id='host-epoch-1')",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .expect("closed Host epoch retained-state projection");
        assert_eq!(state, "closed");
        assert_eq!(floor, 2);
        assert_eq!(
            (suppressions, pending, supplements, leases, tombstones),
            (0, 0, 0, 0, 0)
        );
        tx.commit().expect("host close");
    }
}
