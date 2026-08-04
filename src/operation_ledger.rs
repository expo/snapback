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
};
use crate::diagnostic::{SnapbackError, SnapbackResult};

pub const CLIENT_IDENTITY_RANGE_SIZE_V1: u64 = 256;
pub const CLIENT_IDENTITY_RANGE_WINDOW_MS_V1: u64 = 30 * 24 * 60 * 60 * 1_000;
pub const HOST_RECEIPT_WINDOW_MS_V1: u64 = 24 * 60 * 60 * 1_000;
pub const OPERATION_EXPLANATION_MAX_RESULTS_V1: usize = 100;
pub const ORDINARY_MUTATION_LANE_V1: &str = "ordinaryMutation";

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
         );",
    )?;
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
    let epoch: Option<(i64, String, String, String)> = tx
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
            "operation identity names an unknown epoch",
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
    host_incarnation_rotated: bool,
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
            if !host_incarnation_rotated {
                false
            } else {
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
                !young
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
    envelope.read_set.detail = RetainedEnvelopeDetailV1::Expired;
    envelope.write_set.detail = RetainedEnvelopeDetailV1::Expired;
    envelope.ctx_answers.detail = RetainedEnvelopeDetailV1::Expired;
    envelope.effects.facts.detail = RetainedEnvelopeDetailV1::Expired;
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
        && authority.principal_fingerprint == bound.principal_fingerprint
        && authority.authority_instance_id == bound.authority_instance_id
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
    let (mut disposition, detail) = detail_projection(&envelope);
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

fn detail_projection(envelope: &CommitEnvelopeV1) -> (ExplanationDispositionV1, Option<Value>) {
    let details = [&envelope.read_set.detail, &envelope.write_set.detail];
    if details
        .iter()
        .any(|detail| matches!(detail, RetainedEnvelopeDetailV1::Truncated))
    {
        return (ExplanationDispositionV1::DetailTruncated, None);
    }
    if details
        .iter()
        .any(|detail| matches!(detail, RetainedEnvelopeDetailV1::Expired))
    {
        return (ExplanationDispositionV1::DetailExpired, None);
    }
    let mut projected = Vec::new();
    for detail in details {
        if let RetainedEnvelopeDetailV1::InlineRedacted { detail } = detail {
            projected.push(detail.clone());
        }
    }
    (
        ExplanationDispositionV1::Complete,
        Some(Value::Array(projected)),
    )
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
        let writers = vec![
            "storage::execute_mutation_plan".to_owned(),
            "storage::commit_buffered_writes".to_owned(),
        ];
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
                false,
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
                false,
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
        host.issuance = OperationIssuanceV1::HostIncarnation {
            epoch_id: "host-epoch-1".to_owned(),
            upstream_identity: "cron:occurrence-1".to_owned(),
            commit_ordinal: 0,
            authority_authenticator_digest: sha('e'),
        };
        record_operation_in(&tx, &envelope(host.clone(), 0, 0)).expect("host operation");
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
        terminate_epoch_in(
            &tx,
            OperationOriginatorClassV1::Host,
            "audience-1",
            "host-epoch-1",
            false,
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
                true,
            )
            .expect("host window remains")
        );
        assert!(
            close_epoch_if_complete_in(
                &tx,
                OperationOriginatorClassV1::Host,
                "audience-1",
                "host-epoch-1",
                HOST_RECEIPT_WINDOW_MS_V1 + 11,
                true,
            )
            .expect("host window elapsed")
        );
        tx.commit().expect("host close");
    }
}
