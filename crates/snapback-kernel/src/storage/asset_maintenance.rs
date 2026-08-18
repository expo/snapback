use super::{LocalDatabase, SnapbackResult};
use crate::assets;
use rusqlite::TransactionBehavior;
use serde_json::Value;

pub(super) fn asset_receipt(
    lineage: &str,
    event: assets::AssetReceiptEventV1,
    asset_id: &str,
    attempt_id: Option<&str>,
    at_ms: u64,
    details: Value,
) -> assets::AssetReceiptV1 {
    assets::AssetReceiptV1 {
        receipt_id: assets::new_opaque_key(),
        operation_lineage: lineage.to_owned(),
        event,
        asset_id: Some(asset_id.to_owned()),
        attempt_id: attempt_id.map(str::to_owned),
        at_ms,
        details,
    }
}

/// The one-transaction deletion cascade (LLP 0044 §Lifecycle transitions),
/// shared by maintenance and explicit-delete kernel operations.
pub(super) fn asset_delete_cascade(
    tx: &rusqlite::Transaction<'_>,
    asset: &mut assets::AssetRecordV1,
    cause: &str,
    now_ms: u64,
) -> SnapbackResult<Option<String>> {
    let mut fenced_staging = None;
    if let Some(mut attempt) = assets::current_attempt(tx, &asset.asset_id)? {
        assets::transition_attempt(
            tx,
            &mut attempt,
            assets::AssetAttemptState::Cancelled,
            now_ms,
        )?;
        assets::write_receipt(
            tx,
            &asset_receipt(
                &attempt.attempt_id.clone(),
                assets::AssetReceiptEventV1::AttemptCancelled,
                &asset.asset_id,
                Some(&attempt.attempt_id),
                now_ms,
                serde_json::json!({ "cause": cause }),
            ),
        )?;
        fenced_staging = Some(attempt.staging_key);
    }
    let mut renditions_retired = 0u64;
    let mut blobs_released = Vec::new();
    for mut rendition in assets::renditions_for_asset(tx, &asset.asset_id)? {
        use assets::AssetRenditionState as R;
        if rendition.state == R::Retired {
            continue;
        }
        // Failed renditions hold no committed blob reference (their
        // publication was condemned); every other live state does.
        let holds_reference = matches!(rendition.state, R::Pending | R::Ready | R::Superseded);
        assets::transition_rendition(tx, &mut rendition, R::Retired, now_ms)?;
        if holds_reference {
            let remaining = assets::release_blob_reference(tx, &rendition.blob_id, now_ms)?;
            blobs_released.push(serde_json::json!({
                "blobId": rendition.blob_id,
                "remainingReferences": remaining,
            }));
        }
        renditions_retired += 1;
    }
    let grants_removed = tx.execute(
        "DELETE FROM _snapback_asset_grants_v1 WHERE asset_id = ?1",
        [&asset.asset_id],
    )? as u64;
    assets::transition_asset(tx, asset, assets::AssetAvailability::Deleted, now_ms)?;
    assets::write_receipt(
        tx,
        &asset_receipt(
            &asset.asset_id.clone(),
            assets::AssetReceiptEventV1::AssetDeleted,
            &asset.asset_id,
            None,
            now_ms,
            serde_json::json!({
                "cause": cause,
                "renditionsRetired": renditions_retired,
                "blobsReleased": blobs_released,
                "grantsRemoved": grants_removed,
            }),
        ),
    )?;
    Ok(fenced_staging)
}

#[derive(Default)]
struct AssetRunnerDelta {
    completed: u64,
    retried: u64,
    exhausted: u64,
    cancelled: u64,
}

impl LocalDatabase {
    fn asset_maintenance_transaction<T>(
        &mut self,
        f: impl FnOnce(&rusqlite::Transaction<'_>) -> SnapbackResult<T>,
    ) -> SnapbackResult<T> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let value = f(&tx)?;
        tx.commit()?;
        Ok(value)
    }

    pub(super) fn publication_records_in_state(
        &mut self,
        state: assets::AssetPublicationState,
    ) -> SnapbackResult<Vec<assets::AssetPublicationRecordV1>> {
        self.asset_maintenance_transaction(|tx| assets::publications_in_state(tx, state))
    }

    pub(super) fn publication_attempt(
        &mut self,
        record: &assets::AssetPublicationRecordV1,
    ) -> SnapbackResult<Option<assets::AssetAttemptRecordV1>> {
        self.asset_maintenance_transaction(|tx| {
            record
                .attempt_id
                .as_deref()
                .map(|id| assets::load_attempt(tx, id))
                .transpose()
                .map(Option::flatten)
        })
    }

    pub(super) fn publication_stage_verified_object(
        &mut self,
        record: &mut assets::AssetPublicationRecordV1,
        attempt: Option<&assets::AssetAttemptRecordV1>,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        let asset_id = attempt.map(|attempt| attempt.asset_id.clone());
        self.asset_maintenance_transaction(|tx| {
            assets::transition_publication(
                tx,
                record,
                assets::AssetPublicationState::Staged,
                now_ms,
            )?;
            assets::write_receipt(
                tx,
                &asset_receipt(
                    &record.publication_id.clone(),
                    assets::AssetReceiptEventV1::PublicationRepaired,
                    asset_id.as_deref().unwrap_or("unknown"),
                    record.attempt_id.as_deref(),
                    now_ms,
                    serde_json::json!({ "action": "staged", "probe": "object-verified" }),
                ),
            )
        })
    }

    pub(super) fn publication_condemn_not_redrivable(
        &mut self,
        record: &mut assets::AssetPublicationRecordV1,
        attempt: Option<&assets::AssetAttemptRecordV1>,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        let asset_id = attempt.map(|attempt| attempt.asset_id.clone());
        self.asset_maintenance_transaction(|tx| {
            assets::transition_publication(
                tx,
                record,
                assets::AssetPublicationState::Condemned,
                now_ms,
            )?;
            assets::write_receipt(
                tx,
                &asset_receipt(
                    &record.publication_id.clone(),
                    assets::AssetReceiptEventV1::PublicationRepaired,
                    asset_id.as_deref().unwrap_or("unknown"),
                    record.attempt_id.as_deref(),
                    now_ms,
                    serde_json::json!({ "action": "condemned", "cause": "not-re-drivable" }),
                ),
            )
        })
    }

    pub(super) fn publication_condemn_terminal_work(
        &mut self,
        record: &mut assets::AssetPublicationRecordV1,
        attempt: Option<&assets::AssetAttemptRecordV1>,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        let asset_id = attempt.map(|attempt| attempt.asset_id.clone());
        self.asset_maintenance_transaction(|tx| {
            assets::transition_publication(
                tx,
                record,
                assets::AssetPublicationState::Condemned,
                now_ms,
            )?;
            assets::write_receipt(
                tx,
                &asset_receipt(
                    &record.publication_id.clone(),
                    assets::AssetReceiptEventV1::PublicationRepaired,
                    asset_id.as_deref().unwrap_or("unknown"),
                    record.attempt_id.as_deref(),
                    now_ms,
                    serde_json::json!({ "action": "condemned", "cause": "work-terminal" }),
                ),
            )
        })
    }

    pub(super) fn publication_key_owned_by_live_blob(
        &mut self,
        planned_key: &str,
    ) -> SnapbackResult<bool> {
        self.asset_maintenance_transaction(|tx| {
            Ok(tx
                .query_row(
                    "SELECT COUNT(*) FROM _snapback_asset_blobs_v1
                     WHERE physical_key = ?1 AND condemned = 0",
                    [planned_key],
                    |row| row.get::<_, u64>(0),
                )
                .unwrap_or(0)
                > 0)
        })
    }

    pub(super) fn publication_retire_condemned(
        &mut self,
        record: &assets::AssetPublicationRecordV1,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.asset_maintenance_transaction(|tx| {
            assets::retire_publication(tx, &record.publication_id)?;
            assets::write_receipt(
                tx,
                &asset_receipt(
                    &record.publication_id.clone(),
                    assets::AssetReceiptEventV1::PublicationRepaired,
                    "unknown",
                    record.attempt_id.as_deref(),
                    now_ms,
                    serde_json::json!({ "action": "retired", "was": "condemned" }),
                ),
            )
        })
    }

    pub(super) fn publication_retire_committed(
        &mut self,
        record: &assets::AssetPublicationRecordV1,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.asset_maintenance_transaction(|tx| {
            assets::retire_publication(tx, &record.publication_id)?;
            assets::write_receipt(
                tx,
                &asset_receipt(
                    &record.publication_id.clone(),
                    assets::AssetReceiptEventV1::PublicationRepaired,
                    "unknown",
                    record.attempt_id.as_deref(),
                    now_ms,
                    serde_json::json!({ "action": "retired", "was": "committed" }),
                ),
            )
        })
    }

    pub(super) fn gc_expired_current_attempts(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<Vec<assets::AssetAttemptRecordV1>> {
        self.asset_maintenance_transaction(|tx| assets::expired_current_attempts(tx, now_ms))
    }

    pub(super) fn gc_expire_attempt(
        &mut self,
        attempt: &mut assets::AssetAttemptRecordV1,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.asset_maintenance_transaction(|tx| {
            assets::transition_attempt(tx, attempt, assets::AssetAttemptState::Expired, now_ms)?;
            assets::write_receipt(
                tx,
                &asset_receipt(
                    &attempt.attempt_id.clone(),
                    assets::AssetReceiptEventV1::AttemptExpired,
                    &attempt.asset_id,
                    Some(&attempt.attempt_id),
                    now_ms,
                    serde_json::json!({ "cause": "gc-sweep" }),
                ),
            )
        })
    }

    pub(super) fn gc_live_staging_keys(&mut self) -> SnapbackResult<Vec<String>> {
        self.asset_maintenance_transaction(assets::live_staging_keys)
    }

    pub(super) fn gc_reclaimable_pending_assets(
        &mut self,
        cutoff: u64,
    ) -> SnapbackResult<Vec<assets::AssetRecordV1>> {
        self.asset_maintenance_transaction(|tx| assets::reclaimable_pending_assets(tx, cutoff))
    }

    pub(super) fn gc_reclaim_pending_asset(
        &mut self,
        asset: &mut assets::AssetRecordV1,
        now_ms: u64,
    ) -> SnapbackResult<Option<String>> {
        self.asset_maintenance_transaction(|tx| {
            let staging = asset_delete_cascade(tx, asset, "pending-asset-gc", now_ms)?;
            assets::write_receipt(
                tx,
                &asset_receipt(
                    &asset.asset_id.clone(),
                    assets::AssetReceiptEventV1::GcReclaimed,
                    &asset.asset_id,
                    None,
                    now_ms,
                    serde_json::json!({
                        "policy": "pending-asset-gc",
                        "graceMs": assets::ASSET_PENDING_GRACE_MS,
                    }),
                ),
            )?;
            Ok(staging)
        })
    }

    pub(super) fn gc_reclaimable_reference_assets(
        &mut self,
        cutoff: u64,
    ) -> SnapbackResult<Vec<assets::AssetRecordV1>> {
        self.asset_maintenance_transaction(|tx| assets::reclaimable_reference_gc_assets(tx, cutoff))
    }

    pub(super) fn gc_reclaim_reference_asset(
        &mut self,
        asset: &mut assets::AssetRecordV1,
        grace_ms: u64,
        now_ms: u64,
    ) -> SnapbackResult<bool> {
        self.asset_maintenance_transaction(|tx| {
            let current = assets::load_asset(tx, &asset.asset_id)?;
            let still_eligible = current
                .as_ref()
                .is_some_and(|current| current.availability == assets::AssetAvailability::Ready)
                && assets::load_edges_for_asset(tx, &asset.asset_id)?.is_empty()
                && tx.query_row(
                    "SELECT COUNT(*) FROM _snapback_asset_grants_v1
                     WHERE asset_id = ?1 AND state = 'active'",
                    [&asset.asset_id],
                    |row| row.get::<_, u64>(0),
                )? == 0;
            if !still_eligible {
                return Ok(false);
            }
            asset_delete_cascade(tx, asset, "reference-gc", now_ms)?;
            assets::write_receipt(
                tx,
                &asset_receipt(
                    &asset.asset_id.clone(),
                    assets::AssetReceiptEventV1::GcReclaimed,
                    &asset.asset_id,
                    None,
                    now_ms,
                    serde_json::json!({
                        "policy": "reference-gc",
                        "graceMs": grace_ms,
                    }),
                ),
            )?;
            Ok(true)
        })
    }

    pub(super) fn gc_purgeable_tombstones(&mut self, cutoff: u64) -> SnapbackResult<Vec<String>> {
        self.asset_maintenance_transaction(|tx| assets::purgeable_tombstones(tx, cutoff))
    }

    pub(super) fn gc_purge_tombstone(&mut self, asset_id: &str) -> SnapbackResult<()> {
        self.asset_maintenance_transaction(|tx| {
            tx.execute(
                "DELETE FROM _snapback_asset_renditions_v1
                 WHERE asset_id = ?1 AND state = 'retired'",
                [asset_id],
            )?;
            tx.execute(
                "DELETE FROM _snapback_asset_records_v1
                 WHERE asset_id = ?1 AND availability = 'deleted'",
                [asset_id],
            )?;
            Ok(())
        })
    }

    pub(super) fn gc_purge_delivery_receipts(&mut self, cutoff: u64) -> SnapbackResult<u64> {
        self.asset_maintenance_transaction(|tx| assets::purge_delivery_receipts(tx, cutoff))
    }

    pub(super) fn gc_condemnable_blobs(
        &mut self,
        cutoff: u64,
    ) -> SnapbackResult<Vec<assets::AssetBlobRecordV1>> {
        self.asset_maintenance_transaction(|tx| assets::condemnable_blobs(tx, cutoff))
    }

    pub(super) fn gc_condemn_blob(
        &mut self,
        blob: &assets::AssetBlobRecordV1,
        now_ms: u64,
    ) -> SnapbackResult<bool> {
        self.asset_maintenance_transaction(|tx| {
            let condemned = assets::condemn_blob_if_unreferenced(tx, &blob.blob_id, now_ms)?;
            if condemned {
                assets::write_receipt(
                    tx,
                    &asset_receipt(
                        &blob.blob_id.clone(),
                        assets::AssetReceiptEventV1::GcReclaimed,
                        &blob.blob_id,
                        None,
                        now_ms,
                        serde_json::json!({
                            "policy": "blob-gc",
                            "action": "condemned",
                            "retentionMs": assets::ASSET_BLOB_RETENTION_MS,
                        }),
                    ),
                )?;
            }
            Ok(condemned)
        })
    }

    pub(super) fn gc_condemned_blobs(&mut self) -> SnapbackResult<Vec<assets::AssetBlobRecordV1>> {
        self.asset_maintenance_transaction(assets::condemned_blobs)
    }

    pub(super) fn gc_purge_condemned_blob(
        &mut self,
        blob: &assets::AssetBlobRecordV1,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.asset_maintenance_transaction(|tx| {
            assets::delete_blob_row(tx, &blob.blob_id)?;
            assets::write_receipt(
                tx,
                &asset_receipt(
                    &blob.blob_id.clone(),
                    assets::AssetReceiptEventV1::GcReclaimed,
                    &blob.blob_id,
                    None,
                    now_ms,
                    serde_json::json!({ "policy": "blob-gc", "action": "purged" }),
                ),
            )
        })
    }

    pub(super) fn gc_reclaim_intent_artifacts(&mut self, now_ms: u64) -> SnapbackResult<u64> {
        self.asset_maintenance_transaction(|tx| {
            let reclaimed = assets::reclaim_intent_artifacts(tx)?;
            for (intent_id, generation) in &reclaimed {
                assets::write_receipt(
                    tx,
                    &assets::AssetReceiptV1 {
                        receipt_id: assets::new_opaque_key(),
                        operation_lineage: format!("intent:{intent_id}"),
                        event: assets::AssetReceiptEventV1::IntentArtifactReclaimed,
                        asset_id: None,
                        attempt_id: None,
                        at_ms: now_ms,
                        details: serde_json::json!({
                            "intentId": intent_id,
                            "policyGeneration": generation,
                        }),
                    },
                )?;
            }
            Ok(reclaimed.len() as u64)
        })
    }

    pub(super) fn runner_reclaim_expired_leases(&mut self, now_ms: u64) -> SnapbackResult<u64> {
        self.asset_maintenance_transaction(|tx| {
            let expired = assets::load_expired_leases(tx, now_ms, assets::ASSET_WORK_CLAIM_BATCH)?;
            let mut count = 0u64;
            for mut row in expired {
                row.lease_owner = None;
                row.lease_expires_at_ms = None;
                row.next_eligible_at_ms = now_ms;
                assets::transition_work(tx, &mut row, assets::AssetWorkState::Enqueued, now_ms)?;
                assets::write_receipt(
                    tx,
                    &asset_receipt(
                        &row.work_id,
                        assets::AssetReceiptEventV1::WorkLeaseReclaimed,
                        &row.asset_id,
                        row.attempt_id.as_deref(),
                        now_ms,
                        serde_json::json!({ "kind": row.kind, "attemptCount": row.attempt_count }),
                    ),
                )?;
                count += 1;
            }
            Ok(count)
        })
    }

    pub(super) fn runner_claim_due_work(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<(Vec<assets::AssetWorkRowV1>, u64, u64)> {
        let mut report = AssetRunnerDelta::default();
        let claimed = self.asset_maintenance_transaction(|tx| {
            let due = assets::load_due_work(tx, now_ms, assets::ASSET_WORK_CLAIM_BATCH)?;
            let mut claimed = Vec::new();
            for mut row in due {
                let asset = assets::load_asset(tx, &row.asset_id)?;
                let fenced = match &asset {
                    None => true,
                    Some(asset) => asset.lifecycle_generation != row.lifecycle_generation,
                };
                if fenced {
                    assets::transition_work(
                        tx,
                        &mut row,
                        assets::AssetWorkState::Cancelled,
                        now_ms,
                    )?;
                    assets::write_receipt(
                        tx,
                        &asset_receipt(
                            &row.work_id,
                            assets::AssetReceiptEventV1::WorkCancelled,
                            &row.asset_id,
                            row.attempt_id.as_deref(),
                            now_ms,
                            serde_json::json!({
                                "kind": row.kind,
                                "cause": "generation-fence",
                            }),
                        ),
                    )?;
                    report.cancelled += 1;
                    continue;
                }
                if now_ms > row.deadline_at_ms {
                    row.failure =
                        Some(serde_json::json!({ "cause": "deadline exceeded before completion" }));
                    assets::transition_work(tx, &mut row, assets::AssetWorkState::Claimed, now_ms)?;
                    assets::transition_work(
                        tx,
                        &mut row,
                        assets::AssetWorkState::Exhausted,
                        now_ms,
                    )?;
                    assets::write_receipt(
                        tx,
                        &asset_receipt(
                            &row.work_id,
                            assets::AssetReceiptEventV1::WorkExhausted,
                            &row.asset_id,
                            row.attempt_id.as_deref(),
                            now_ms,
                            serde_json::json!({ "kind": row.kind, "cause": "deadline" }),
                        ),
                    )?;
                    report.exhausted += 1;
                    continue;
                }
                row.lease_owner = Some("local-runner".to_owned());
                row.lease_expires_at_ms = Some(now_ms + assets::ASSET_WORK_LEASE_MS);
                // Mirror the lease deadline into the indexed column so one
                // index serves the due scan and the expired-lease scan.
                row.next_eligible_at_ms = now_ms + assets::ASSET_WORK_LEASE_MS;
                assets::transition_work(tx, &mut row, assets::AssetWorkState::Claimed, now_ms)?;
                assets::write_receipt(
                    tx,
                    &asset_receipt(
                        &row.work_id,
                        assets::AssetReceiptEventV1::WorkClaimed,
                        &row.asset_id,
                        row.attempt_id.as_deref(),
                        now_ms,
                        serde_json::json!({ "kind": row.kind, "attemptCount": row.attempt_count }),
                    ),
                )?;
                claimed.push(row);
            }
            Ok(claimed)
        })?;
        Ok((claimed, report.cancelled, report.exhausted))
    }

    pub(super) fn runner_settle_work(
        &mut self,
        row: &mut assets::AssetWorkRowV1,
        outcome: &SnapbackResult<Option<Value>>,
        now_ms: u64,
    ) -> SnapbackResult<(u64, u64, u64)> {
        let mut report = AssetRunnerDelta::default();
        self.asset_maintenance_transaction(|tx| match outcome {
            Ok(authority_receipt) => {
                assets::transition_work(tx, row, assets::AssetWorkState::Done, now_ms)?;
                let mut details = serde_json::json!({ "kind": row.kind });
                if let Some(authority) = authority_receipt {
                    details["authority"] = authority.clone();
                }
                assets::write_receipt(
                    tx,
                    &asset_receipt(
                        &row.work_id,
                        assets::AssetReceiptEventV1::WorkCompleted,
                        &row.asset_id,
                        row.attempt_id.as_deref(),
                        now_ms,
                        details,
                    ),
                )?;
                report.completed += 1;
                Ok(())
            }
            Err(error) => {
                row.attempt_count += 1;
                row.failure = Some(serde_json::json!({ "code": error.diagnostic.code }));
                // A programmer-error kind can never succeed on retry;
                // exhaust it on first observation instead of burning the
                // ceiling on deterministic failures.
                let unretryable = matches!(
                    error.diagnostic.code.as_str(),
                    "SNAPBACK_ASSET_WORK_KIND_UNKNOWN" | "SNAPBACK_ASSET_WORK_PARAMS_INVALID"
                );
                if unretryable || row.attempt_count >= row.retry_ceiling {
                    assets::transition_work(tx, row, assets::AssetWorkState::Exhausted, now_ms)?;
                    assets::write_receipt(
                        tx,
                        &asset_receipt(
                            &row.work_id,
                            assets::AssetReceiptEventV1::WorkExhausted,
                            &row.asset_id,
                            row.attempt_id.as_deref(),
                            now_ms,
                            serde_json::json!({
                                "kind": row.kind,
                                "cause": "retry-ceiling",
                                "failure": error.diagnostic.code,
                                "attemptCount": row.attempt_count,
                            }),
                        ),
                    )?;
                    report.exhausted += 1;
                    return Ok(());
                }
                // Retrying is transient: it re-enters enqueued with the
                // backoff-derived eligibility in this same transaction.
                assets::transition_work(tx, row, assets::AssetWorkState::Retrying, now_ms)?;
                row.lease_owner = None;
                row.lease_expires_at_ms = None;
                row.next_eligible_at_ms = now_ms + assets::work_backoff_ms(row.attempt_count);
                assets::transition_work(tx, row, assets::AssetWorkState::Enqueued, now_ms)?;
                assets::write_receipt(
                    tx,
                    &asset_receipt(
                        &row.work_id,
                        assets::AssetReceiptEventV1::WorkRetrying,
                        &row.asset_id,
                        row.attempt_id.as_deref(),
                        now_ms,
                        serde_json::json!({
                            "kind": row.kind,
                            "failure": error.diagnostic.code,
                            "attemptCount": row.attempt_count,
                            "nextEligibleAtMs": row.next_eligible_at_ms,
                        }),
                    ),
                )?;
                report.retried += 1;
                Ok(())
            }
        })?;
        Ok((report.completed, report.retried, report.exhausted))
    }
}

/// Narrow typed access to asset maintenance storage operations.
///
/// @ref LLP 0225#1-ownership-map — asset maintenance enters the storage
/// kernel through typed operations instead of a raw SQLite transaction.
pub struct AssetMaintenanceKernel<'a> {
    db: &'a mut LocalDatabase,
}

impl<'a> AssetMaintenanceKernel<'a> {
    pub(super) fn new(db: &'a mut LocalDatabase) -> Self {
        Self { db }
    }

    pub fn publication_records_in_state(
        &mut self,
        state: assets::AssetPublicationState,
    ) -> SnapbackResult<Vec<assets::AssetPublicationRecordV1>> {
        self.db.publication_records_in_state(state)
    }

    pub fn publication_attempt(
        &mut self,
        record: &assets::AssetPublicationRecordV1,
    ) -> SnapbackResult<Option<assets::AssetAttemptRecordV1>> {
        self.db.publication_attempt(record)
    }

    pub fn publication_stage_verified_object(
        &mut self,
        record: &mut assets::AssetPublicationRecordV1,
        attempt: Option<&assets::AssetAttemptRecordV1>,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db
            .publication_stage_verified_object(record, attempt, now_ms)
    }

    pub fn publication_condemn_not_redrivable(
        &mut self,
        record: &mut assets::AssetPublicationRecordV1,
        attempt: Option<&assets::AssetAttemptRecordV1>,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db
            .publication_condemn_not_redrivable(record, attempt, now_ms)
    }

    pub fn publication_condemn_terminal_work(
        &mut self,
        record: &mut assets::AssetPublicationRecordV1,
        attempt: Option<&assets::AssetAttemptRecordV1>,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db
            .publication_condemn_terminal_work(record, attempt, now_ms)
    }

    pub fn publication_key_owned_by_live_blob(
        &mut self,
        planned_key: &str,
    ) -> SnapbackResult<bool> {
        self.db.publication_key_owned_by_live_blob(planned_key)
    }

    pub fn publication_retire_condemned(
        &mut self,
        record: &assets::AssetPublicationRecordV1,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db.publication_retire_condemned(record, now_ms)
    }

    pub fn publication_retire_committed(
        &mut self,
        record: &assets::AssetPublicationRecordV1,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db.publication_retire_committed(record, now_ms)
    }

    pub fn gc_expired_current_attempts(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<Vec<assets::AssetAttemptRecordV1>> {
        self.db.gc_expired_current_attempts(now_ms)
    }

    pub fn gc_expire_attempt(
        &mut self,
        attempt: &mut assets::AssetAttemptRecordV1,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db.gc_expire_attempt(attempt, now_ms)
    }

    pub fn gc_live_staging_keys(&mut self) -> SnapbackResult<Vec<String>> {
        self.db.gc_live_staging_keys()
    }

    pub fn gc_reclaimable_pending_assets(
        &mut self,
        cutoff: u64,
    ) -> SnapbackResult<Vec<assets::AssetRecordV1>> {
        self.db.gc_reclaimable_pending_assets(cutoff)
    }

    pub fn gc_reclaim_pending_asset(
        &mut self,
        asset: &mut assets::AssetRecordV1,
        now_ms: u64,
    ) -> SnapbackResult<Option<String>> {
        self.db.gc_reclaim_pending_asset(asset, now_ms)
    }

    pub fn gc_reclaimable_reference_assets(
        &mut self,
        cutoff: u64,
    ) -> SnapbackResult<Vec<assets::AssetRecordV1>> {
        self.db.gc_reclaimable_reference_assets(cutoff)
    }

    pub fn gc_reclaim_reference_asset(
        &mut self,
        asset: &mut assets::AssetRecordV1,
        grace_ms: u64,
        now_ms: u64,
    ) -> SnapbackResult<bool> {
        self.db.gc_reclaim_reference_asset(asset, grace_ms, now_ms)
    }

    pub fn gc_purgeable_tombstones(&mut self, cutoff: u64) -> SnapbackResult<Vec<String>> {
        self.db.gc_purgeable_tombstones(cutoff)
    }

    pub fn gc_purge_tombstone(&mut self, asset_id: &str) -> SnapbackResult<()> {
        self.db.gc_purge_tombstone(asset_id)
    }

    pub fn gc_purge_delivery_receipts(&mut self, cutoff: u64) -> SnapbackResult<u64> {
        self.db.gc_purge_delivery_receipts(cutoff)
    }

    pub fn gc_condemnable_blobs(
        &mut self,
        cutoff: u64,
    ) -> SnapbackResult<Vec<assets::AssetBlobRecordV1>> {
        self.db.gc_condemnable_blobs(cutoff)
    }

    pub fn gc_condemn_blob(
        &mut self,
        blob: &assets::AssetBlobRecordV1,
        now_ms: u64,
    ) -> SnapbackResult<bool> {
        self.db.gc_condemn_blob(blob, now_ms)
    }

    pub fn gc_condemned_blobs(&mut self) -> SnapbackResult<Vec<assets::AssetBlobRecordV1>> {
        self.db.gc_condemned_blobs()
    }

    pub fn gc_purge_condemned_blob(
        &mut self,
        blob: &assets::AssetBlobRecordV1,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db.gc_purge_condemned_blob(blob, now_ms)
    }

    pub fn gc_reclaim_intent_artifacts(&mut self, now_ms: u64) -> SnapbackResult<u64> {
        self.db.gc_reclaim_intent_artifacts(now_ms)
    }

    pub fn runner_reclaim_expired_leases(&mut self, now_ms: u64) -> SnapbackResult<u64> {
        self.db.runner_reclaim_expired_leases(now_ms)
    }

    pub fn runner_claim_due_work(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<(Vec<assets::AssetWorkRowV1>, u64, u64)> {
        self.db.runner_claim_due_work(now_ms)
    }

    pub fn runner_settle_work(
        &mut self,
        row: &mut assets::AssetWorkRowV1,
        outcome: &SnapbackResult<Option<Value>>,
        now_ms: u64,
    ) -> SnapbackResult<(u64, u64, u64)> {
        self.db.runner_settle_work(row, outcome, now_ms)
    }
}
