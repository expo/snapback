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
    ClientIdentityRangeV1, CommitEnvelopeV1, ExplanationDispositionV1, IdentityEpochStateV1,
    IdentityEpochV1, OperationCoverageManifestV1, OperationIdentityComparison,
    OperationIdentityTombstoneV1, OperationIdentityV1, OperationIssuanceV1,
    OperationLookupDispositionV1, OperationOriginatorClassV1, OperationSuppressionRecordV1,
    OperationTerminalOutcomeV1, RetainedEnvelopeDetailV1, SnapshotAssociationKindV1,
    derive_host_operation_id,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};

pub const CLIENT_IDENTITY_RANGE_SIZE_V1: u64 = 256;
pub const CLIENT_IDENTITY_RANGE_WINDOW_MS_V1: u64 = 30 * 24 * 60 * 60 * 1_000;
pub const HOST_RECEIPT_WINDOW_MS_V1: u64 = 24 * 60 * 60 * 1_000;
pub const OPERATION_EXPLANATION_MAX_RESULTS_V1: usize = 100;
pub const ORDINARY_MUTATION_LANE_V1: &str = "ordinaryMutation";
pub const ORDINARY_MUTATION_WRITERS_V1: [&str; 2] = [
    "LocalDatabase::execute_mutation_idempotent_guarded_with_settlement_time",
    "LocalDatabase::commit_buffered_writes_idempotent_guarded",
];

const ORIGINATOR_CLIENT: &str = "client";
const ORIGINATOR_HOST: &str = "host";

#[derive(Clone, Debug, PartialEq)]
pub enum OperationLookupV1 {
    Novel,
    ExactReplay(OperationSuppressionRecordV1),
    ResultExpired {
        outcome: OperationTerminalOutcomeV1,
        receipt_digest: String,
    },
    IdentityHorizonPassed,
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
    pub current_policy_provable: bool,
    pub allow_non_row_facts: bool,
    pub administrative: bool,
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
    pub(crate) fn into_public(self) -> crate::commit_envelope::OperationExplanationV1 {
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

pub fn create_infra(tx: &Transaction<'_>) -> SnapbackResult<()> {
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
         CREATE TABLE IF NOT EXISTS _snapback_host_identity_leases_v1 (
           stream_id TEXT NOT NULL,
           operation_id TEXT NOT NULL,
           audience TEXT NOT NULL,
           epoch_id TEXT NOT NULL,
           identity_json TEXT NOT NULL,
           expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms >= 0),
           completed_at_ms INTEGER,
           PRIMARY KEY(stream_id, operation_id)
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

pub fn register_coverage_in(
    tx: &Transaction<'_>,
    manifest: &OperationCoverageManifestV1,
    activated_at_ms: u64,
) -> SnapbackResult<()> {
    if manifest.schema_version != 1
        || manifest.manifest_version == 0
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
    Ok(())
}

pub fn active_coverage_manifest(
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
    body.map(|body| decode(&body, "active coverage manifest"))
        .transpose()
}

pub fn register_epoch_in(tx: &Transaction<'_>, epoch: &IdentityEpochV1) -> SnapbackResult<()> {
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

/// Rotate the server's host incarnation as one durable state transition. The
/// successor epoch and the fact that retired the predecessor are committed
/// together, so later reclamation never trusts a caller's assertion that a
/// rotation happened.
///
/// @ref LLP 0163#contract-summary-normative-details-per-llp-0162-0-2 — a
/// range-less host epoch closes only after its server incarnation has rotated.
pub fn rotate_host_incarnation_in(
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

pub fn register_client_range_in(
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
pub fn resolve_client_range_audience_in(
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

/// Mint the next finite range under the exact live authority incarnation.
/// A caller may present its prior range only as a continuity assertion; it
/// never selects the audience, epoch, bounds, or authenticator. Issuance does
/// not activate coverage.
///
/// @ref LLP 0162#1-the-universal-commit-envelope — offline identities come
///   only from server-preallocated authenticated finite ranges.
pub fn issue_client_range_in(
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
        // only while no identity from its epoch has ever been admitted. Once
        // any operation exists, omitting prior custody must fail closed.
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
) -> SnapbackResult<()> {
    let current = active_coverage_manifest(tx, stream_id)?;
    if current.as_ref().is_some_and(|manifest| {
        manifest
            .covered_lanes
            .iter()
            .any(|lane| lane == ORDINARY_MUTATION_LANE_V1)
            && ORDINARY_MUTATION_WRITERS_V1.iter().all(|writer| {
                manifest
                    .writer_choke_points
                    .iter()
                    .any(|declared| declared == writer)
            })
    }) {
        return Ok(());
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
    covered_lanes.push(ORDINARY_MUTATION_LANE_V1.to_owned());
    covered_lanes.sort();
    covered_lanes.dedup();
    let mut writer_choke_points = current
        .map(|manifest| manifest.writer_choke_points)
        .unwrap_or_default();
    writer_choke_points.extend(
        ORDINARY_MUTATION_WRITERS_V1
            .iter()
            .map(|writer| (*writer).to_owned()),
    );
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
    register_coverage_in(tx, &manifest, activated_at_ms)
}

/// Insert one envelope and its suppression/receipt state in the caller's data
/// transaction. This function intentionally performs no COMMIT of its own.
pub fn record_operation_in(
    tx: &Transaction<'_>,
    envelope: &CommitEnvelopeV1,
) -> SnapbackResult<()> {
    envelope
        .validate()
        .map_err(|error| invalid(format!("commit envelope is invalid: {error:?}")))?;
    let identity = &envelope.identity;
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

    if let Some(retained) = load_identity_for_key(tx, identity)? {
        return match retained.compare(identity) {
            OperationIdentityComparison::ExactReplay => Err(refused(
                "SNAPBACK_OPERATION_ALREADY_RECORDED",
                "exact replay must be answered before executing the covered writer",
            )),
            OperationIdentityComparison::BoundFactsDiverged => Err(refused(
                "SNAPBACK_CLIENT_MUTATION_ID_REUSED",
                "operation identity was reused with divergent bound facts",
            )),
            OperationIdentityComparison::Novel => unreachable!("lookup used the same key"),
        };
    }
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

/// Authenticate a host identity against the durable epoch authority before it
/// can enter a host-only admission seam such as promotion ticket issuance.
/// Structural `HostIncarnation` shape is insufficient: the epoch must be open,
/// its authority/authenticator must match, and its operation id must be the
/// deterministic derivation of the recorded upstream identity.
pub fn authenticate_host_identity(
    conn: &Connection,
    identity: &OperationIdentityV1,
) -> SnapbackResult<()> {
    if identity.key.originator_class != OperationOriginatorClassV1::Host
        || !matches!(
            identity.issuance,
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
    let existing: Option<(String, i64)> = tx
        .query_row(
            "SELECT identity_json,expires_at_ms FROM _snapback_host_identity_leases_v1
             WHERE stream_id=?1 AND operation_id=?2",
            params![identity.key.stream_id, identity.key.operation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((stored_identity, stored_expiry)) = existing {
        if stored_identity == identity_json
            && stored_expiry == to_i64(expires_at_ms, "host lease expiry")?
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
    {
        if upstream_identity.trim().is_empty()
            || identity.key.operation_id
                != derive_host_operation_id(upstream_identity, *commit_ordinal)
        {
            return Err(refused(
                "SNAPBACK_HOST_OPERATION_IDENTITY_INVALID",
                "host operation id does not match its authenticated upstream derivation",
            ));
        }
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

pub fn lookup_operation(
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
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT identity_json, record_json
             FROM _snapback_operation_suppression_v1
             WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
            key_params,
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((identity_json, record_json)) = row {
        let identity: OperationIdentityV1 = decode(&identity_json, "stored operation identity")?;
        reject_divergence(&identity, proposed)?;
        let record: OperationSuppressionRecordV1 =
            decode(&record_json, "stored suppression record")?;
        return Ok(OperationLookupV1::ExactReplay(record));
    }

    let tombstone: Option<String> = conn
        .query_row(
            "SELECT tombstone_json FROM _snapback_operation_tombstones_v1
             WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
            params![
                proposed.key.stream_id,
                originator(proposed.key.originator_class),
                proposed.key.operation_id,
            ],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(tombstone) = tombstone {
        let tombstone: OperationIdentityTombstoneV1 =
            decode(&tombstone, "stored operation tombstone")?;
        if tombstone.audience != proposed.bound_facts.audience {
            return Err(refused(
                "SNAPBACK_AUTH_STALE_RESULT",
                "operation tombstone belongs to another audience",
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

pub fn acknowledge_and_reclaim_in(
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
        audience: identity.bound_facts.audience.clone(),
        epoch_id,
        terminal_outcome: record.terminal_outcome,
        receipt_digest: record.receipt_digest.clone(),
        retained_at_ms: acknowledged_at_ms,
    };
    tx.execute(
        "INSERT INTO _snapback_operation_tombstones_v1(
           stream_id, originator_class, operation_id, audience, epoch_id,
           epoch_sequence, counter, tombstone_json
         ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(stream_id, originator_class, operation_id) DO UPDATE SET
           tombstone_json=excluded.tombstone_json",
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
    compact_envelope_receipt_in(tx, identity)?;
    Ok(())
}

pub fn acknowledge_client_operation_by_id_in(
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

pub fn terminate_epoch_in(
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
pub fn close_epoch_if_complete_in(
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
    let Some((sequence, state)) = row else {
        return Ok(false);
    };
    if state == "open" || state == "closed" {
        return Ok(false);
    }
    let ready = match originator_class {
        OperationOriginatorClassV1::Client => {
            let unacknowledged: bool = tx.query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM _snapback_operation_suppression_v1
                   WHERE originator_class='client' AND audience=?1 AND epoch_id=?2
                 )",
                params![audience, epoch_id],
                |row| row.get(0),
            )?;
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
                let live_host_lease: bool = tx.query_row(
                    "SELECT EXISTS(
                       SELECT 1 FROM _snapback_host_identity_leases_v1
                       WHERE audience=?1 AND epoch_id=?2
                         AND completed_at_ms IS NULL AND expires_at_ms > ?3
                     )",
                    params![audience, epoch_id, to_i64(now_ms, "host closure time")?],
                    |row| row.get(0),
                )?;
                let young: bool = tx.query_row(
                    "SELECT EXISTS(
                       SELECT 1 FROM _snapback_operation_suppression_v1
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
                !live_host_lease && !young
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
    let next_floor = sequence
        .checked_add(1)
        .ok_or_else(|| invalid("epoch floor overflowed"))?;
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

pub fn explain_operation(
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
    reject_divergence(&envelope.identity, identity)?;
    Ok(Some(project_explanation(conn, envelope, authority)?))
}

/// Independent compact-envelope retention clock. Suppression/tombstone/floor
/// state remains untouched, so pruning cannot turn a known identity novel.
pub fn prune_compact_envelope_in(
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
pub fn expire_envelope_detail_in(
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

pub fn enumerate_explanations(
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
                && authority.authority_instance_id == bound.authority_instance_id))
        && authority.allow_non_row_facts;
    if !authorized {
        return Ok(StoredOperationExplanationV1 {
            envelope,
            disposition: ExplanationDispositionV1::AuthorizationUnprovable,
            read_set_digest: None,
            read_set_count: None,
            write_set_digest: None,
            write_set_count: None,
            detail: None,
        });
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
    let (mut disposition, detail) = detail_projection(conn, &envelope);
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
        "SELECT identity_json FROM _snapback_operation_suppression_v1
         WHERE originator_class=?1 AND audience=?2 AND epoch_id=?3",
    )?;
    let rows = statement.query_map(
        params![originator(originator_class), audience, epoch_id],
        |row| row.get::<_, String>(0),
    )?;
    rows.map(|row| decode(&row?, "suppression identity"))
        .collect()
}

fn load_identity_for_key(
    conn: &Connection,
    identity: &OperationIdentityV1,
) -> SnapbackResult<Option<OperationIdentityV1>> {
    let body: Option<String> = conn
        .query_row(
            "SELECT identity_json FROM _snapback_operation_suppression_v1
             WHERE stream_id=?1 AND originator_class=?2 AND operation_id=?3",
            params![
                identity.key.stream_id,
                originator(identity.key.originator_class),
                identity.key.operation_id,
            ],
            |row| row.get(0),
        )
        .optional()?;
    body.map(|body| decode(&body, "stored operation identity"))
        .transpose()
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
        terminate_epoch_in(
            &tx,
            OperationOriginatorClassV1::Client,
            "audience-1",
            "epoch-1",
            false,
            30,
        )
        .expect("terminate");
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
        prune_compact_envelope_in(&tx, &first).expect("prune first compact envelope");
        tx.commit().expect("commit closure");
        assert_eq!(
            lookup_operation(&conn, &first).expect("below floor retry"),
            OperationLookupV1::IdentityHorizonPassed
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

        // Once an identity from the epoch is admitted, a response-loss retry
        // without the durable previous range refuses instead of forking.
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
            current_policy_provable: true,
            allow_non_row_facts: true,
            administrative: false,
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
        assert!(
            close_epoch_if_complete_in(
                &tx,
                OperationOriginatorClassV1::Host,
                "audience-1",
                "host-epoch-1",
                HOST_RECEIPT_WINDOW_MS_V1 + 11,
            )
            .expect("host window elapsed after ticket completion")
        );
        tx.commit().expect("host close");
    }
}
