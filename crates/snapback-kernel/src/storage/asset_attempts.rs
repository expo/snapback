use super::asset_maintenance::asset_receipt;
use super::{CapturedReadDependency, LocalDatabase, SnapbackError, SnapbackResult};
use crate::assets;
use crate::manifest::{
    AssetImageVariant, AssetUploadIntentDefinition, HandlerInput, SchemaManifest,
};
use crate::services_assets::{
    AssetAttemptCurrentProof, AssetPublicationPlannedProof, AssetWidthPreparedVariant,
    AssetWidthPublicationPlannedProof,
};
use rusqlite::{OptionalExtension, TransactionBehavior};
use serde_json::{Map, Value};
use std::time::{SystemTime, UNIX_EPOCH};

/// A rendered variant whose immutable object is staged and ready for a
/// generation-checked storage commit.
#[derive(Clone)]
pub struct AssetPreparedVariant {
    pub key: String,
    pub width: u64,
    pub publication: assets::AssetPublicationRecordV1,
    pub digest: String,
    pub byte_length: u64,
    pub content_type: String,
    pub recipe_version: u64,
}

/// The two outcomes of the final publication transaction. Witness movement
/// returns control to the service layer for lock-free authorizer revalidation.
pub enum AssetPublishOutcome {
    Published {
        attempt: Box<assets::AssetAttemptRecordV1>,
        asset: Box<assets::AssetRecordV1>,
        reused: bool,
    },
    WitnessMoved,
}

/// Result of fencing the staged cut for an on-demand width publication.
#[must_use = "width publication staging must distinguish a staged request from a converged loser"]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AssetWidthPublicationStageOutcome {
    /// This request advanced or observed the shared publication as staged and
    /// must still run the rendition/blob/quota commit.
    Staged,
    /// A concurrent or staggered request already left a Ready rendition for
    /// this exact shared width operation, so no publication or quota work is
    /// left for this request.
    AlreadyCurrent,
}

enum AssetVariantCommit {
    Committed {
        rendition_id: String,
    },
    /// An idempotent re-drive: a Ready same-lineage rendition already holds
    /// the pointer; our duplicate publication condemns with tracked cleanup.
    AlreadyCurrent,
    /// Settlement would exceed the app quota: a structured rendition
    /// failure, gating `ready` only when the variant is required.
    QuotaRefused,
    /// A newer recipe version holds the pointer; the stale run loses and
    /// its publication condemns.
    StaleLost,
}

fn asset_planned_publication(
    app_id: &str,
    attempt_id: &str,
    digest: &str,
    now_ms: u64,
) -> assets::AssetPublicationRecordV1 {
    assets::AssetPublicationRecordV1 {
        publication_id: assets::new_opaque_key(),
        app_id: app_id.to_owned(),
        attempt_id: Some(attempt_id.to_owned()),
        asset_id: None,
        variant_key: None,
        planned_key: assets::new_opaque_key(),
        digest_algorithm: assets::ASSET_DIGEST_ALGORITHM_SHA256.to_owned(),
        digest: digest.to_owned(),
        canonicalization_policy: assets::ASSET_CANONICALIZATION_NONE.to_owned(),
        state: assets::AssetPublicationState::Planned,
        generation: 1,
        blob_id: None,
        created_at_ms: now_ms,
        updated_at_ms: now_ms,
    }
}

fn asset_commit_prepared_variant(
    tx: &rusqlite::Transaction<'_>,
    app_id: &str,
    asset_id: &str,
    prepared: &AssetPreparedVariant,
    app_quota: u64,
    now: u64,
) -> SnapbackResult<AssetVariantCommit> {
    let mut publication = prepared.publication.clone();
    let condemn = |tx: &rusqlite::Transaction<'_>,
                   publication: &mut assets::AssetPublicationRecordV1|
     -> SnapbackResult<()> {
        assets::transition_publication(
            tx,
            publication,
            assets::AssetPublicationState::Condemned,
            now,
        )?;
        assets::enqueue_work(
            tx,
            assets::ASSET_WORK_KIND_CONDEMNED_CLEANUP,
            asset_id,
            None,
            0,
            now,
        )?;
        Ok(())
    };

    // A request served by an existing Ready same-lineage rendition performs
    // no new logical allocation. Converge before quota settlement so a stale
    // planning cohort cannot be refused after its winner consumes the last
    // available unit. A newer recipe likewise wins without allocating here.
    if let Some(existing) = assets::load_rendition_by_variant(tx, asset_id, &prepared.key)? {
        let converged = if existing.recipe_version > prepared.recipe_version {
            Some(AssetVariantCommit::StaleLost)
        } else if existing.state == assets::AssetRenditionState::Ready
            && existing.recipe == assets::ASSET_RECIPE_IMAGE_VARIANT_V1
            && existing.recipe_version == prepared.recipe_version
        {
            Some(AssetVariantCommit::AlreadyCurrent)
        } else {
            None
        };
        if let Some(outcome) = converged {
            condemn(tx, &mut publication)?;
            return Ok(outcome);
        }
    }

    let accounting = assets::asset_accounting(tx, app_id)?;
    let increment = prepared
        .byte_length
        .max(assets::ASSET_MIN_ACCOUNTING_UNIT_BYTES);
    let in_use = accounting
        .reserved_bytes
        .saturating_add(accounting.settled_bytes);
    if in_use.saturating_add(increment) > app_quota {
        condemn(tx, &mut publication)?;
        return Ok(AssetVariantCommit::QuotaRefused);
    }

    let blob_record = assets::AssetBlobRecordV1 {
        blob_id: assets::new_opaque_key(),
        app_id: app_id.to_owned(),
        store: assets::ASSET_STORE_LOCAL_FS.to_owned(),
        physical_key: publication.planned_key.clone(),
        byte_length: prepared.byte_length,
        detected_content_type: prepared.content_type.clone(),
        digest_algorithm: assets::ASSET_DIGEST_ALGORITHM_SHA256.to_owned(),
        digest: prepared.digest.clone(),
        canonicalization_policy: assets::ASSET_CANONICALIZATION_NONE.to_owned(),
        created_at_ms: now,
    };
    let blob_id = match assets::insert_blob(tx, &blob_record, now)? {
        assets::BlobInsertOutcome::Created => {
            publication.blob_id = Some(blob_record.blob_id.clone());
            assets::transition_publication(
                tx,
                &mut publication,
                assets::AssetPublicationState::Committed,
                now,
            )?;
            blob_record.blob_id.clone()
        }
        assets::BlobInsertOutcome::ConvergedOnWinner { blob_id } => {
            condemn(tx, &mut publication)?;
            blob_id
        }
    };

    let rendition = assets::AssetRenditionRecordV1 {
        rendition_id: assets::new_opaque_key(),
        asset_id: asset_id.to_owned(),
        variant_key: prepared.key.clone(),
        blob_id: blob_id.clone(),
        state: assets::AssetRenditionState::Ready,
        recipe: assets::ASSET_RECIPE_IMAGE_VARIANT_V1.to_owned(),
        recipe_version: prepared.recipe_version,
        media_facts: Some(serde_json::json!({
            "contentType": prepared.content_type,
            "byteLength": prepared.byte_length,
            "width": prepared.width,
        })),
        created_at_ms: now,
        updated_at_ms: now,
        failure: None,
    };
    match assets::switch_variant_pointer(tx, &rendition, now)? {
        assets::AssetVariantSwitchOutcome::Installed => Ok(AssetVariantCommit::Committed {
            rendition_id: rendition.rendition_id,
        }),
        outcome @ (assets::AssetVariantSwitchOutcome::AlreadyCurrent
        | assets::AssetVariantSwitchOutcome::StaleLoses) => {
            // No rendition row took our reference: whether the blob was
            // freshly created (refcount 1) or converged onto the winner
            // (incremented), the acquired reference releases here. A
            // freshly created blob goes to zero references and blob GC
            // condemns it through its ordinary transactional path — the
            // committed publication record retires on retention, it does
            // not condemn (its closed set has no committed → condemned).
            assets::release_blob_reference(tx, &blob_id, now)?;
            Ok(match outcome {
                assets::AssetVariantSwitchOutcome::AlreadyCurrent => {
                    AssetVariantCommit::AlreadyCurrent
                }
                _ => AssetVariantCommit::StaleLost,
            })
        }
    }
}

fn width_publication_has_ready_rendition(
    tx: &rusqlite::Transaction<'_>,
    publication: &assets::AssetPublicationRecordV1,
    recipe_version: u64,
) -> SnapbackResult<bool> {
    let (Some(asset_id), Some(variant_key)) = (
        publication.asset_id.as_deref(),
        publication.variant_key.as_deref(),
    ) else {
        return Ok(false);
    };
    if publication.attempt_id.is_some() {
        return Ok(false);
    }
    let Some(rendition) = assets::load_rendition_by_variant(tx, asset_id, variant_key)? else {
        return Ok(false);
    };
    if rendition.state != assets::AssetRenditionState::Ready
        || rendition.recipe != assets::ASSET_RECIPE_IMAGE_VARIANT_V1
        || rendition.recipe_version != recipe_version
    {
        return Ok(false);
    }
    let Some(blob) = assets::load_blob_live(tx, &rendition.blob_id)? else {
        return Ok(false);
    };
    if blob.condemned
        || blob.record.digest_algorithm != publication.digest_algorithm
        || blob.record.digest != publication.digest
        || blob.record.canonicalization_policy != publication.canonicalization_policy
    {
        return Ok(false);
    }
    Ok(match publication.state {
        assets::AssetPublicationState::Committed => {
            publication.blob_id.as_deref() == Some(rendition.blob_id.as_str())
        }
        // A uniqueness loser has no blob edge of its own. Matching the exact
        // attempt-less owner tuple and immutable digest to the Ready winner is
        // the convergence proof for every request sharing that condemned row.
        assets::AssetPublicationState::Condemned => true,
        _ => false,
    })
}

fn asset_ceiling_error(what: &str, limit: u64, observed: u64) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_ASSET_CEILING_EXCEEDED",
        "assets",
        format!("the {what} ceiling is reached"),
    )
    .with_details(serde_json::json!({ "limit": limit, "observed": observed }))
}

pub(super) fn asset_unknown(asset_id: &str) -> impl Fn() -> SnapbackError + '_ {
    move || {
        SnapbackError::error(
            "SNAPBACK_ASSET_UNKNOWN",
            "assets",
            format!("unknown asset {asset_id}"),
        )
    }
}

fn asset_terminal_error(attempt: &assets::AssetAttemptRecordV1) -> SnapbackError {
    if attempt.state == assets::AssetAttemptState::Expired {
        SnapbackError::error(
            "SNAPBACK_ASSET_ATTEMPT_EXPIRED",
            "assets",
            "this attempt expired; request a fresh one (retry preserves the asset id)",
        )
    } else {
        SnapbackError::error(
            "SNAPBACK_ASSET_ATTEMPT_TERMINAL",
            "assets",
            format!("attempt is terminal ({})", attempt.state.as_str()),
        )
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl LocalDatabase {
    fn asset_attempts_transaction<T>(
        &mut self,
        f: impl FnOnce(&rusqlite::Transaction<'_>) -> SnapbackResult<T>,
    ) -> SnapbackResult<T> {
        self.asset_attempts_transaction_guarded(f, || Ok(()))
    }

    /// Execute one asset-attempt transaction and acquire a caller-owned guard
    /// only after every fallible transaction step has completed. The returned
    /// guard lives through SQLite COMMIT and drops before post-commit store or
    /// live-fanout work.
    ///
    /// @ref LLP 0058#split-phase-authorized-effect-fence — ordinary HTTP
    /// authority permits are reserved before Local; mode admission is the
    /// final lock acquired at this durable cut.
    fn asset_attempts_transaction_guarded<T, G, BeforeCommit>(
        &mut self,
        f: impl FnOnce(&rusqlite::Transaction<'_>) -> SnapbackResult<T>,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<T>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let value = f(&tx)?;
        let _commit_guard = before_commit()?;
        tx.commit()?;
        Ok(value)
    }

    pub(super) fn attempt_require_current(
        &self,
        attempt: &assets::AssetAttemptRecordV1,
    ) -> SnapbackResult<()> {
        if attempt.state.is_current() {
            Ok(())
        } else {
            Err(asset_terminal_error(attempt))
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn attempt_create(
        &mut self,
        intent: &AssetUploadIntentDefinition,
        deployed_implementation_hash: &str,
        intent_artifact_json: &str,
        now: u64,
        app_id: &str,
        app_quota: u64,
        caller: &Option<String>,
        declared_length: u64,
        request: &assets::AssetAttemptCreateRequestV1,
        owner: &str,
        auth_pair: &Value,
        witness: &Value,
    ) -> SnapbackResult<(
        assets::AssetAttemptRecordV1,
        Option<assets::AssetAttemptRecordV1>,
    )> {
        self.attempt_create_guarded(
            intent,
            deployed_implementation_hash,
            intent_artifact_json,
            now,
            app_id,
            app_quota,
            caller,
            declared_length,
            request,
            owner,
            auth_pair,
            witness,
            || Ok(()),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn attempt_create_guarded<G, BeforeCommit>(
        &mut self,
        intent: &AssetUploadIntentDefinition,
        deployed_implementation_hash: &str,
        intent_artifact_json: &str,
        now: u64,
        app_id: &str,
        app_quota: u64,
        caller: &Option<String>,
        declared_length: u64,
        request: &assets::AssetAttemptCreateRequestV1,
        owner: &str,
        auth_pair: &Value,
        witness: &Value,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<(
        assets::AssetAttemptRecordV1,
        Option<assets::AssetAttemptRecordV1>,
    )>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.asset_attempts_transaction_guarded(|tx| {
            let generation = assets::ensure_intent_generation(
                tx,
                &intent.id,
                &intent.intent_policy_hash,
                deployed_implementation_hash,
                intent_artifact_json,
                now,
            )?;
            if generation.revoked {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_INTENT_REVOKED",
                    "assets",
                    "this intent's policy generation is revoked; nothing further finalizes under it",
                ));
            }

            // Ceilings and logical quota, inside the reservation transaction
            // so concurrent preflights cannot jointly overrun.
            let accounting = assets::asset_accounting(tx, app_id)?;
            if accounting.open_attempts_app >= assets::ASSET_MAX_OPEN_ATTEMPTS_PER_APP {
                return Err(asset_ceiling_error(
                    "open attempts per app",
                    assets::ASSET_MAX_OPEN_ATTEMPTS_PER_APP,
                    accounting.open_attempts_app,
                ));
            }
            if let Some(principal) = caller {
                let open = assets::open_attempts_for_principal(tx, app_id, principal)?;
                if open >= assets::ASSET_MAX_OPEN_ATTEMPTS_PER_PRINCIPAL {
                    return Err(asset_ceiling_error(
                        "open attempts per principal",
                        assets::ASSET_MAX_OPEN_ATTEMPTS_PER_PRINCIPAL,
                        open,
                    ));
                }
            }
            let reservation = declared_length.max(assets::ASSET_MIN_ACCOUNTING_UNIT_BYTES);
            let in_use = accounting
                .reserved_bytes
                .saturating_add(accounting.settled_bytes);
            if in_use.saturating_add(reservation) > app_quota {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_QUOTA_EXCEEDED",
                    "assets",
                    "the app's logical asset quota cannot cover this reservation",
                )
                .with_details(serde_json::json!({
                    "limit": app_quota,
                    "observed": in_use,
                    "reservation": reservation,
                })));
            }

            let lineage = assets::new_opaque_key();
            let (asset_id, lifecycle_generation, predecessor) = match &request.retry_of_asset_id {
                None => {
                    let asset = assets::AssetRecordV1 {
                        asset_id: assets::new_opaque_key(),
                        app_id: app_id.to_owned(),
                        intent_id: intent.id.clone(),
                        intent_name: intent.name.clone(),
                        intent_policy_hash: intent.intent_policy_hash.clone(),
                        policy_generation: generation.generation,
                        owner_principal: owner.to_owned(),
                        delivery_profile: intent.delivery.kind,
                        read_access: intent.access.read,
                        grants_enabled: intent.grants,
                        availability: assets::AssetAvailability::Pending,
                        primary_rendition_id: None,
                        media_kind: None,
                        lifecycle_generation: 1,
                        created_at_ms: now,
                        updated_at_ms: now,
                        deleted_at_ms: None,
                    };
                    assets::insert_asset(tx, &asset)?;
                    assets::write_receipt(
                        tx,
                        &asset_receipt(
                            &lineage,
                            assets::AssetReceiptEventV1::AssetReserved,
                            &asset.asset_id,
                            None,
                            now,
                            serde_json::json!({
                                "intentId": intent.id,
                                "policyGeneration": generation.generation,
                            }),
                        ),
                    )?;
                    (asset.asset_id, asset.lifecycle_generation, None)
                }
                Some(asset_id) => {
                    // Retry: the same-asset successor path. The asset must be
                    // pending (ready/rejected/deleted admit no attempts), the
                    // same intent, and the caller's fresh admission must
                    // produce the same owner.
                    let asset = assets::load_asset(tx, asset_id)?.ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_ASSET_UNKNOWN",
                            "assets",
                            format!("unknown asset {asset_id}"),
                        )
                    })?;
                    if asset.availability != assets::AssetAvailability::Pending {
                        return Err(SnapbackError::error(
                            "SNAPBACK_ASSET_ATTEMPT_TERMINAL",
                            "assets",
                            "attempts exist only for pending assets; replacement is a new asset",
                        ));
                    }
                    if asset.intent_id != intent.id || asset.owner_principal != owner {
                        return Err(SnapbackError::error(
                            "SNAPBACK_ASSET_ATTACH_DENIED",
                            "assets",
                            "retry does not admit this caller for this asset",
                        ));
                    }
                    let predecessor = match assets::current_attempt(tx, asset_id)? {
                        Some(mut current) => {
                            // Supersession: predecessor cancels in the same
                            // transaction that opens the successor; its
                            // staging object is fenced after commit (the key
                            // is unique and never reused).
                            assets::transition_attempt(
                                tx,
                                &mut current,
                                assets::AssetAttemptState::Cancelled,
                                now,
                            )?;
                            assets::write_receipt(
                                tx,
                                &asset_receipt(
                                    &lineage,
                                    assets::AssetReceiptEventV1::AttemptCancelled,
                                    asset_id,
                                    Some(&current.attempt_id),
                                    now,
                                    serde_json::json!({ "superseded": true }),
                                ),
                            )?;
                            Some(current)
                        }
                        None => None,
                    };
                    (asset.asset_id.clone(), asset.lifecycle_generation, predecessor)
                }
            };

            let attempt = assets::AssetAttemptRecordV1 {
                attempt_id: assets::new_opaque_key(),
                predecessor_attempt_id: predecessor
                    .as_ref()
                    .map(|attempt| attempt.attempt_id.clone()),
                asset_id: asset_id.clone(),
                app_id: app_id.to_owned(),
                intent_id: intent.id.clone(),
                lifecycle_generation,
                state: assets::AssetAttemptState::Open,
                staging_key: assets::new_opaque_key(),
                declared_filename: request.declared_filename.clone(),
                declared_length,
                declared_content_type: request.declared_content_type.clone(),
                acknowledged_offset: 0,
                integrity_grade: assets::AssetIntegrityGrade::ReceivedBytesCanonical,
                all_chunks_checksummed: true,
                admission: assets::AssetAdmissionV1 {
                    intent_policy_hash: intent.intent_policy_hash.clone(),
                    implementation_hash: Some(deployed_implementation_hash.to_owned()),
                    policy_generation: generation.generation,
                    owner_principal: owner.to_owned(),
                    auth: auth_pair.clone(),
                    witness: witness.clone(),
                    args: request.args.clone(),
                },
                expires_at_ms: now + assets::ASSET_ATTEMPT_TTL_MS,
                created_at_ms: now,
                updated_at_ms: now,
                failure: None,
            };
            assets::insert_attempt(tx, &attempt)?;
            assets::write_receipt(
                tx,
                &asset_receipt(
                    &lineage,
                    assets::AssetReceiptEventV1::AttemptCreated,
                    &asset_id,
                    Some(&attempt.attempt_id),
                    now,
                    serde_json::json!({ "declaredLength": declared_length }),
                ),
            )?;
            Ok((attempt, predecessor))
        }, before_commit)
    }

    pub(super) fn attempt_cancel(
        &mut self,
        request: &assets::AssetAttemptCancelRequestV1,
        now: u64,
    ) -> SnapbackResult<(assets::AssetAttemptRecordV1, Option<assets::AssetRecordV1>)> {
        self.attempt_cancel_guarded(request, now, || Ok(()))
    }

    pub(super) fn attempt_cancel_guarded<G, BeforeCommit>(
        &mut self,
        request: &assets::AssetAttemptCancelRequestV1,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<(assets::AssetAttemptRecordV1, Option<assets::AssetRecordV1>)>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.asset_attempts_transaction_guarded(
            |tx| {
                let mut attempt =
                    assets::load_attempt(tx, &request.attempt_id)?.ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_ASSET_ATTEMPT_UNKNOWN",
                            "assets",
                            format!("unknown attempt {}", request.attempt_id),
                        )
                    })?;
                if attempt.lifecycle_generation != request.lifecycle_generation {
                    return Err(SnapbackError::error(
                        "SNAPBACK_ASSET_GENERATION_STALE",
                        "assets",
                        "the request carries a stale lifecycle generation",
                    ));
                }
                let mut asset = assets::load_asset(tx, &attempt.asset_id)?;
                if attempt.state.is_current() {
                    assets::transition_attempt(
                        tx,
                        &mut attempt,
                        assets::AssetAttemptState::Cancelled,
                        now,
                    )?;
                    assets::write_receipt(
                        tx,
                        &asset_receipt(
                            &attempt.attempt_id.clone(),
                            assets::AssetReceiptEventV1::AttemptCancelled,
                            &attempt.asset_id,
                            Some(&attempt.attempt_id),
                            now,
                            serde_json::json!({ "discardAsset": request.discard_asset }),
                        ),
                    )?;
                }
                if request.discard_asset
                    && let Some(record) = asset.as_mut()
                    && record.availability == assets::AssetAvailability::Pending
                {
                    // Explicit cancel-and-discard: pending → deleted without
                    // waiting out the grace period (LLP 0044 §Deletion).
                    assets::transition_asset(tx, record, assets::AssetAvailability::Deleted, now)?;
                    assets::write_receipt(
                        tx,
                        &asset_receipt(
                            &attempt.attempt_id.clone(),
                            assets::AssetReceiptEventV1::AssetDeleted,
                            &attempt.asset_id,
                            Some(&attempt.attempt_id),
                            now,
                            serde_json::json!({ "cause": "cancel-and-discard" }),
                        ),
                    )?;
                }
                Ok((attempt, asset))
            },
            before_commit,
        )
    }

    pub(super) fn attempt_ingest_load(
        &mut self,
        attempt_id: &str,
    ) -> SnapbackResult<Option<assets::AssetAttemptRecordV1>> {
        self.asset_attempts_transaction(|tx| assets::load_attempt(tx, attempt_id))
    }

    pub(super) fn attempt_tus_patch(
        &mut self,
        attempt_id: &str,
        expected_offset: u64,
        expected_all_checksummed: bool,
        new_offset: u64,
        all_checksummed: bool,
        now: u64,
    ) -> SnapbackResult<assets::AssetAttemptRecordV1> {
        self.attempt_tus_patch_guarded(
            attempt_id,
            expected_offset,
            expected_all_checksummed,
            new_offset,
            all_checksummed,
            now,
            || Ok(()),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn attempt_tus_patch_guarded<G, BeforeCommit>(
        &mut self,
        attempt_id: &str,
        expected_offset: u64,
        expected_all_checksummed: bool,
        new_offset: u64,
        all_checksummed: bool,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<assets::AssetAttemptRecordV1>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.asset_attempts_transaction_guarded(|tx| {
            let mut attempt = assets::load_attempt(tx, attempt_id)?.ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_ATTEMPT_UNKNOWN",
                    "assets",
                    format!("unknown attempt {attempt_id}"),
                )
            })?;
            if !attempt.state.is_current() {
                return Err(asset_terminal_error(&attempt));
            }
            if attempt.acknowledged_offset != expected_offset
                || attempt.all_chunks_checksummed != expected_all_checksummed
            {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_OFFSET_CONFLICT",
                    "assets",
                    format!(
                        "upload state moved before acknowledgement (expected offset {expected_offset}, current offset {})",
                        attempt.acknowledged_offset
                    ),
                ));
            }
            if attempt.state == assets::AssetAttemptState::Open {
                assets::transition_attempt(
                    tx,
                    &mut attempt,
                    assets::AssetAttemptState::Transferring,
                    now,
                )?;
            }
            attempt.acknowledged_offset = new_offset;
            attempt.all_chunks_checksummed = all_checksummed;
            attempt.updated_at_ms = now;
            assets::store_attempt(tx, &attempt)?;
            Ok(attempt)
        }, before_commit)
    }

    pub(super) fn stage_prepared_variant_plan(
        &mut self,
        app_id: &str,
        digest: &str,
        now: u64,
    ) -> SnapbackResult<assets::AssetPublicationRecordV1> {
        self.stage_prepared_variant_plan_guarded(app_id, digest, now, || Ok(()))
    }

    pub(super) fn stage_prepared_variant_plan_guarded<G, BeforeCommit>(
        &mut self,
        app_id: &str,
        digest: &str,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<assets::AssetPublicationRecordV1>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.stage_owned_variant_plan_guarded(app_id, None, None, None, digest, now, before_commit)
    }

    #[allow(clippy::too_many_arguments)]
    fn stage_owned_variant_plan_guarded<G, BeforeCommit>(
        &mut self,
        app_id: &str,
        attempt_id: Option<&str>,
        asset_id: Option<&str>,
        variant_key: Option<&str>,
        digest: &str,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<assets::AssetPublicationRecordV1>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.asset_attempts_transaction_guarded(
            |tx| {
                if let (Some(asset_id), Some(variant_key)) = (asset_id, variant_key)
                    && let Some(existing) =
                        assets::open_publication_for_variant(tx, attempt_id, asset_id, variant_key)?
                {
                    if existing.app_id != app_id || existing.digest != digest {
                        return Err(SnapbackError::error(
                            "SNAPBACK_ASSET_RECORD_INVALID",
                            "assets",
                            "an open variant publication has divergent immutable facts",
                        ));
                    }
                    return Ok(existing);
                }

                let mut publication =
                    asset_planned_publication(app_id, attempt_id.unwrap_or("variant"), digest, now);
                publication.attempt_id = attempt_id.map(str::to_owned);
                publication.asset_id = asset_id.map(str::to_owned);
                publication.variant_key = variant_key.map(str::to_owned);
                assets::insert_publication(tx, &publication)?;
                Ok(publication)
            },
            before_commit,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn stage_attempt_variant_plan_proved_guarded<G, BeforeCommit>(
        &mut self,
        app_id: &str,
        attempt_id: &str,
        asset_id: &str,
        variant_key: &str,
        digest: &str,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<AssetPublicationPlannedProof>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        let publication = self.stage_owned_variant_plan_guarded(
            app_id,
            Some(attempt_id),
            Some(asset_id),
            Some(variant_key),
            digest,
            now,
            before_commit,
        )?;
        Ok(AssetPublicationPlannedProof::new(publication))
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn stage_width_variant_plan_proved_guarded<G, BeforeCommit>(
        &mut self,
        app_id: &str,
        asset_id: &str,
        variant_key: &str,
        digest: &str,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<AssetWidthPublicationPlannedProof>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        let publication = self.stage_owned_variant_plan_guarded(
            app_id,
            None,
            Some(asset_id),
            Some(variant_key),
            digest,
            now,
            before_commit,
        )?;
        Ok(AssetWidthPublicationPlannedProof::new(publication))
    }

    pub(super) fn stage_prepared_variant_commit_staged(
        &mut self,
        publication: &mut assets::AssetPublicationRecordV1,
    ) -> SnapbackResult<()> {
        self.stage_prepared_variant_commit_staged_guarded(publication, || Ok(()))
    }

    pub(super) fn stage_prepared_variant_commit_staged_guarded<G, BeforeCommit>(
        &mut self,
        publication: &mut assets::AssetPublicationRecordV1,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<()>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.stage_variant_publication_commit_staged_guarded(publication, before_commit)
    }

    fn stage_variant_publication_commit_staged_guarded<G, BeforeCommit>(
        &mut self,
        publication: &mut assets::AssetPublicationRecordV1,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<()>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.asset_attempts_transaction_guarded(
            |tx| {
                let mut current = assets::load_publication(tx, &publication.publication_id)?
                    .ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_ASSET_TRANSITION_INVALID",
                            "assets",
                            "the publication record disappeared before its staged transition",
                        )
                    })?;
                if current.app_id != publication.app_id
                    || current.planned_key != publication.planned_key
                    || current.digest != publication.digest
                    || current.attempt_id != publication.attempt_id
                    || current.asset_id != publication.asset_id
                    || current.variant_key != publication.variant_key
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_ASSET_RECORD_INVALID",
                        "assets",
                        "the publication record changed immutable facts before staging",
                    ));
                }
                match current.state {
                    assets::AssetPublicationState::Planned => {
                        assets::transition_publication(
                            tx,
                            &mut current,
                            assets::AssetPublicationState::Staged,
                            now_millis(),
                        )?;
                    }
                    assets::AssetPublicationState::Staged => {}
                    other => {
                        return Err(SnapbackError::error(
                            "SNAPBACK_ASSET_TRANSITION_INVALID",
                            "assets",
                            format!("publication cannot stage from persisted state {other:?}"),
                        ));
                    }
                }
                *publication = current;
                Ok(())
            },
            before_commit,
        )
    }

    /// Fence the staged cut for a width request while preserving the accepted
    /// concurrent-first and staggered-cohort convergence contract. The opaque
    /// width carrier cannot be passed to the ordinary staging helper above.
    ///
    /// @ref LLP 0044#acceptance — a loser holding the same publication may
    /// observe it after the winner's commit and succeeds on that rendition.
    pub(super) fn stage_width_variant_commit_staged_guarded<G, BeforeCommit>(
        &mut self,
        prepared: &mut AssetWidthPreparedVariant,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<AssetWidthPublicationStageOutcome>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        let recipe_version = prepared.prepared().recipe_version;
        let publication = &mut prepared.prepared_mut().publication;
        self.asset_attempts_transaction_guarded(
            |tx| {
                let mut current = assets::load_publication(tx, &publication.publication_id)?
                    .ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_ASSET_TRANSITION_INVALID",
                            "assets",
                            "the publication record disappeared before its staged transition",
                        )
                    })?;
                if current.app_id != publication.app_id
                    || current.planned_key != publication.planned_key
                    || current.digest != publication.digest
                    || current.attempt_id != publication.attempt_id
                    || current.asset_id != publication.asset_id
                    || current.variant_key != publication.variant_key
                {
                    return Err(SnapbackError::error(
                        "SNAPBACK_ASSET_RECORD_INVALID",
                        "assets",
                        "the publication record changed immutable facts before staging",
                    ));
                }
                let outcome = match current.state {
                    assets::AssetPublicationState::Planned => {
                        assets::transition_publication(
                            tx,
                            &mut current,
                            assets::AssetPublicationState::Staged,
                            now_millis(),
                        )?;
                        AssetWidthPublicationStageOutcome::Staged
                    }
                    assets::AssetPublicationState::Staged => {
                        AssetWidthPublicationStageOutcome::Staged
                    }
                    assets::AssetPublicationState::Committed
                    | assets::AssetPublicationState::Condemned
                        if width_publication_has_ready_rendition(tx, &current, recipe_version)? =>
                    {
                        AssetWidthPublicationStageOutcome::AlreadyCurrent
                    }
                    other => {
                        return Err(SnapbackError::error(
                            "SNAPBACK_ASSET_TRANSITION_INVALID",
                            "assets",
                            format!("publication cannot stage from persisted state {other:?}"),
                        ));
                    }
                };
                *publication = current;
                Ok(outcome)
            },
            before_commit,
        )
    }

    pub(super) fn attempt_finalize_load_asset(
        &mut self,
        asset_id: &str,
    ) -> SnapbackResult<Option<assets::AssetRecordV1>> {
        self.asset_attempts_transaction(|tx| assets::load_asset(tx, asset_id))
    }

    pub(super) fn attempt_finalize_load_intent_artifact(
        &mut self,
        intent_id: &str,
        policy_generation: u64,
    ) -> SnapbackResult<Option<String>> {
        self.asset_attempts_transaction(|tx| {
            assets::load_intent_artifact(tx, intent_id, policy_generation)
        })
    }

    pub(super) fn attempt_finalize_generation_revoked(
        &mut self,
        intent_id: &str,
        policy_generation: u64,
    ) -> SnapbackResult<bool> {
        self.asset_attempts_transaction(|tx| {
            let generation: Option<(u64, bool)> = tx
                .query_row(
                    "SELECT generation, revoked
                     FROM _snapback_asset_intent_generations_v1 WHERE intent_id = ?1",
                    [intent_id],
                    |row| Ok((row.get(0)?, row.get::<_, i64>(1)? != 0)),
                )
                .optional()?;
            Ok(matches!(
                generation,
                Some((generation, true)) if generation == policy_generation
            ))
        })
    }

    pub(super) fn attempt_finalize_commit_plan(
        &mut self,
        app_id: &str,
        attempt_id: &str,
        digest: &str,
        now: u64,
    ) -> SnapbackResult<assets::AssetPublicationRecordV1> {
        self.attempt_finalize_commit_plan_guarded(app_id, attempt_id, digest, now, || Ok(()))
    }

    pub(super) fn attempt_finalize_commit_plan_guarded<G, BeforeCommit>(
        &mut self,
        app_id: &str,
        attempt_id: &str,
        digest: &str,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<assets::AssetPublicationRecordV1>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.asset_attempts_transaction_guarded(
            |tx| {
                let mut record = assets::load_attempt(tx, attempt_id)?.ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_ASSET_ATTEMPT_UNKNOWN",
                        "assets",
                        format!("unknown attempt {attempt_id}"),
                    )
                })?;
                if record.state != assets::AssetAttemptState::Finalizing {
                    assets::transition_attempt(
                        tx,
                        &mut record,
                        assets::AssetAttemptState::Finalizing,
                        now,
                    )?;
                }
                match assets::open_publication_for_attempt(tx, attempt_id)? {
                    Some(existing) if existing.digest == digest => {
                        // Phase B runs without the global Local writer, so two
                        // prepared finalizers can serialize through this Phase A
                        // transaction while the first racer's put is still in
                        // flight. The first creates `planned`; the loser must get
                        // that exact record/key and perform the same idempotent
                        // put. Phase-A victory is not a publication lease: either
                        // racer may reach Phase C first. Exactly one publishes;
                        // Phase C's attempt reload gives the other the same
                        // ordinary idempotent completion as the old serialized
                        // choreography, never a new key or contention error.
                        Ok(existing)
                    }
                    Some(mut divergent) => {
                        // A re-drive can only carry the same staged bytes; a
                        // divergent digest means the record belongs to bytes that
                        // no longer exist. Condemn it and plan afresh.
                        assets::transition_publication(
                            tx,
                            &mut divergent,
                            assets::AssetPublicationState::Condemned,
                            now,
                        )?;
                        assets::enqueue_work(
                            tx,
                            "condemned-object-cleanup",
                            &record.asset_id,
                            Some(attempt_id),
                            record.lifecycle_generation,
                            now,
                        )?;
                        let planned = asset_planned_publication(app_id, attempt_id, digest, now);
                        assets::insert_publication(tx, &planned)?;
                        Ok(planned)
                    }
                    None => {
                        let planned = asset_planned_publication(app_id, attempt_id, digest, now);
                        assets::insert_publication(tx, &planned)?;
                        Ok(planned)
                    }
                }
            },
            before_commit,
        )
    }

    pub(super) fn attempt_finalize_commit_staged(
        &mut self,
        attempt_id: &str,
        publication: &assets::AssetPublicationRecordV1,
        now: u64,
    ) -> SnapbackResult<assets::AssetPublicationRecordV1> {
        self.attempt_finalize_commit_staged_guarded(attempt_id, publication, now, || Ok(()))
    }

    pub(super) fn attempt_finalize_commit_staged_guarded<G, BeforeCommit>(
        &mut self,
        attempt_id: &str,
        publication: &assets::AssetPublicationRecordV1,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<assets::AssetPublicationRecordV1>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.asset_attempts_transaction_guarded(
            |tx| {
                let mut record = assets::open_publication_for_attempt(tx, attempt_id)?
                    .filter(|record| record.publication_id == publication.publication_id)
                    .ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_ASSET_RECORD_INVALID",
                            "assets",
                            "the publication record disappeared mid-finalization",
                        )
                    })?;
                if record.state == assets::AssetPublicationState::Planned {
                    assets::transition_publication(
                        tx,
                        &mut record,
                        assets::AssetPublicationState::Staged,
                        now,
                    )?;
                }
                Ok(record)
            },
            before_commit,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn attempt_finalize_commit_completion_guarded<G, BeforeCommit>(
        &mut self,
        attempt: &assets::AssetAttemptRecordV1,
        attempt_id: String,
        publication_id: String,
        schema: &SchemaManifest,
        witness_input: &HandlerInput,
        witness_snapshot: Vec<CapturedReadDependency>,
        auth_moved: bool,
        canonical_length: u64,
        canonical_policy: &'static str,
        image_facts: Map<String, Value>,
        detected_type: String,
        app: String,
        digest_value: String,
        required_variants: Vec<AssetPreparedVariant>,
        optional_keys: Vec<AssetImageVariant>,
        app_quota: u64,
        on_ready: &Option<String>,
        grade: assets::AssetIntegrityGrade,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<AssetPublishOutcome>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.asset_attempts_transaction_guarded(
            |tx| {
                let mut record = assets::load_attempt(tx, &attempt_id)?.ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_ASSET_ATTEMPT_UNKNOWN",
                        "assets",
                        format!("unknown attempt {attempt_id}"),
                    )
                })?;
                if record.state != assets::AssetAttemptState::Finalizing {
                    return Err(asset_terminal_error(&record));
                }
                if !auth_moved {
                    match crate::storage::validate_asset_witness(
                        tx,
                        schema,
                        witness_input,
                        &witness_snapshot,
                    ) {
                        Ok(()) => {}
                        Err(error) if error.diagnostic.code == "SNAPBACK_MUTATION_CONFLICT" => {
                            return Ok(AssetPublishOutcome::WitnessMoved);
                        }
                        Err(error) => return Err(error),
                    }
                } else {
                    return Ok(AssetPublishOutcome::WitnessMoved);
                }

                let mut publication = assets::open_publication_for_attempt(tx, &attempt_id)?
                    .filter(|found| found.publication_id == publication_id)
                    .ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_ASSET_RECORD_INVALID",
                            "assets",
                            "the publication record disappeared mid-finalization",
                        )
                    })?;

                let blob_record = assets::AssetBlobRecordV1 {
                    blob_id: assets::new_opaque_key(),
                    app_id: app.clone(),
                    store: assets::ASSET_STORE_LOCAL_FS.to_owned(),
                    physical_key: publication.planned_key.clone(),
                    byte_length: canonical_length,
                    detected_content_type: detected_type.clone(),
                    digest_algorithm: assets::ASSET_DIGEST_ALGORITHM_SHA256.to_owned(),
                    digest: digest_value.clone(),
                    canonicalization_policy: canonical_policy.to_owned(),
                    created_at_ms: now,
                };
                let (blob_id, reused) = match assets::insert_blob(tx, &blob_record, now) {
                    Ok(assets::BlobInsertOutcome::Created) => {
                        publication.blob_id = Some(blob_record.blob_id.clone());
                        assets::transition_publication(
                            tx,
                            &mut publication,
                            assets::AssetPublicationState::Committed,
                            now,
                        )?;
                        (blob_record.blob_id.clone(), false)
                    }
                    Ok(assets::BlobInsertOutcome::ConvergedOnWinner { blob_id }) => {
                        // Dedup or a lost uniqueness race: adopt the winner,
                        // condemn our own record; its object is tracked
                        // cleanup, never a silent orphan.
                        assets::transition_publication(
                            tx,
                            &mut publication,
                            assets::AssetPublicationState::Condemned,
                            now,
                        )?;
                        assets::enqueue_work(
                            tx,
                            "condemned-object-cleanup",
                            &record.asset_id,
                            Some(&attempt_id),
                            record.lifecycle_generation,
                            now,
                        )?;
                        (blob_id, true)
                    }
                    Err(error) if error.diagnostic.code == "SNAPBACK_ASSET_BLOB_CONDEMNED_RACE" => {
                        // The identity slot is held by a condemned row: the
                        // retry-under-fresh-key path deletes it, records its
                        // orphaned object as a condemned publication, and
                        // publishes our own object.
                        if let Some(orphan_key) = assets::resolve_condemned_identity(
                            tx,
                            &app,
                            assets::ASSET_DIGEST_ALGORITHM_SHA256,
                            &digest_value,
                            canonical_policy,
                        )? {
                            let orphan = assets::AssetPublicationRecordV1 {
                                publication_id: assets::new_opaque_key(),
                                app_id: app.clone(),
                                attempt_id: Some(attempt_id.clone()),
                                asset_id: Some(record.asset_id.clone()),
                                variant_key: None,
                                planned_key: orphan_key,
                                digest_algorithm: assets::ASSET_DIGEST_ALGORITHM_SHA256.to_owned(),
                                digest: digest_value.clone(),
                                canonicalization_policy: canonical_policy.to_owned(),
                                state: assets::AssetPublicationState::Condemned,
                                generation: record.lifecycle_generation,
                                blob_id: None,
                                created_at_ms: now,
                                updated_at_ms: now,
                            };
                            assets::insert_publication(tx, &orphan)?;
                            assets::enqueue_work(
                                tx,
                                "condemned-object-cleanup",
                                &record.asset_id,
                                Some(&attempt_id),
                                record.lifecycle_generation,
                                now,
                            )?;
                        }
                        match assets::insert_blob(tx, &blob_record, now)? {
                            assets::BlobInsertOutcome::Created => {}
                            assets::BlobInsertOutcome::ConvergedOnWinner { .. } => {
                                return Err(SnapbackError::error(
                                    "SNAPBACK_ASSET_BLOB_CONDEMNED_RACE",
                                    "assets",
                                    "blob identity remained contended after condemned-row \
                                 resolution",
                                ));
                            }
                        }
                        publication.blob_id = Some(blob_record.blob_id.clone());
                        assets::transition_publication(
                            tx,
                            &mut publication,
                            assets::AssetPublicationState::Committed,
                            now,
                        )?;
                        (blob_record.blob_id.clone(), false)
                    }
                    Err(error) => return Err(error),
                };

                // The primary rendition is the publication in v1; required
                // renditions gate `ready`, and the primary is the only (and
                // required) member until the image pipeline ships.
                let rendition = assets::AssetRenditionRecordV1 {
                    rendition_id: assets::new_opaque_key(),
                    asset_id: record.asset_id.clone(),
                    variant_key: assets::ASSET_RENDITION_PRIMARY.to_owned(),
                    blob_id: blob_id.clone(),
                    state: assets::AssetRenditionState::Ready,
                    recipe: assets::ASSET_RENDITION_PRIMARY.to_owned(),
                    recipe_version: 1,
                    media_facts: Some({
                        let mut facts = serde_json::json!({
                            "contentType": detected_type,
                            "byteLength": canonical_length,
                            // Metadata only, sanitized here; never a
                            // physical key.
                            "filename": assets::sanitize_filename(
                                attempt.declared_filename.as_deref(),
                            ),
                        });
                        facts
                            .as_object_mut()
                            .expect("json object")
                            .extend(image_facts.clone());
                        facts
                    }),
                    created_at_ms: now,
                    updated_at_ms: now,
                    failure: None,
                };
                assets::insert_rendition(tx, &rendition)?;

                let mut committed_variants: Vec<(String, String)> = Vec::new();
                for prepared in &required_variants {
                    match asset_commit_prepared_variant(
                        tx,
                        &app,
                        &record.asset_id,
                        prepared,
                        app_quota,
                        now,
                    )? {
                        AssetVariantCommit::Committed { rendition_id, .. } => {
                            committed_variants.push((prepared.key.clone(), rendition_id));
                        }
                        AssetVariantCommit::AlreadyCurrent | AssetVariantCommit::StaleLost => {}
                        AssetVariantCommit::QuotaRefused => {
                            // Err aborts the transaction whole: required
                            // renditions are part of the asset-ready
                            // contract, so nothing publishes.
                            return Err(SnapbackError::error(
                                "SNAPBACK_ASSET_QUOTA_EXCEEDED",
                                "assets",
                                "a required rendition's settlement would exceed the app quota",
                            )
                            .with_details(serde_json::json!({
                                "variantKey": prepared.key,
                            })));
                        }
                    }
                }

                let mut asset = assets::load_asset(tx, &record.asset_id)?.ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_ASSET_UNKNOWN",
                        "assets",
                        format!("unknown asset {}", record.asset_id),
                    )
                })?;
                asset.primary_rendition_id = Some(rendition.rendition_id.clone());
                asset.media_kind =
                    Some(assets::media_kind_for_detected_content_type(&detected_type));
                assets::transition_asset(tx, &mut asset, assets::AssetAvailability::Ready, now)?;
                // A never-attached upload starts its reference-GC grace
                // clock at publication; any attachment clears it.
                assets::mark_unreferenced_if_edgeless(tx, &record.asset_id, now)?;
                // The declared ready callback enqueues transactionally with
                // the transition it observes (LLP 0044 §Processing runner:
                // a row enqueues in the same transaction as the transition
                // that requires it), under the frozen admitted policy.
                if let Some(handler) = on_ready.as_deref() {
                    assets::enqueue_work_with_params(
                        tx,
                        assets::ASSET_WORK_KIND_LIFECYCLE_CALLBACK,
                        &record.asset_id,
                        None,
                        asset.lifecycle_generation,
                        now,
                        Some(serde_json::json!({
                            "event": "ready",
                            "handler": handler,
                        })),
                    )?;
                }

                // Optional variants enqueue transactionally with `ready`,
                // carrying the post-transition generation so the runner's
                // claim fence admits them.
                for variant in &optional_keys {
                    assets::enqueue_work_with_params(
                        tx,
                        assets::ASSET_WORK_KIND_IMAGE_VARIANT,
                        &record.asset_id,
                        None,
                        asset.lifecycle_generation,
                        now,
                        Some(serde_json::json!({
                            "key": variant.key,
                            "width": variant.width,
                            "recipeVersion": 1,
                            "contentType": detected_type,
                        })),
                    )?;
                }

                record.integrity_grade = grade;
                assets::transition_attempt(
                    tx,
                    &mut record,
                    assets::AssetAttemptState::Complete,
                    now,
                )?;

                let lineage = attempt_id.clone();
                for (event, details) in [
                    (
                        assets::AssetReceiptEventV1::BytesVerified,
                        serde_json::json!({
                            "integrityGrade": grade,
                            "detectedContentType": detected_type,
                            "byteLength": canonical_length,
                            "canonicalizationPolicy": canonical_policy,
                        }),
                    ),
                    (
                        if reused {
                            assets::AssetReceiptEventV1::BlobReused
                        } else {
                            assets::AssetReceiptEventV1::BlobCreated
                        },
                        serde_json::json!({ "blobId": blob_id }),
                    ),
                    (
                        assets::AssetReceiptEventV1::RenditionProduced,
                        serde_json::json!({
                            "renditionId": rendition.rendition_id,
                            "variantKey": assets::ASSET_RENDITION_PRIMARY,
                        }),
                    ),
                    (
                        assets::AssetReceiptEventV1::AssetReady,
                        serde_json::json!({
                            "lifecycleGeneration": asset.lifecycle_generation,
                            "locationPolicy": image_facts.get("locationPolicy"),
                        }),
                    ),
                    (
                        assets::AssetReceiptEventV1::AttemptCompleted,
                        serde_json::json!({ "integrityGrade": grade }),
                    ),
                ] {
                    assets::write_receipt(
                        tx,
                        &asset_receipt(
                            &lineage,
                            event,
                            &record.asset_id,
                            Some(&attempt_id),
                            now,
                            details,
                        ),
                    )?;
                }
                for (variant_key, rendition_id) in &committed_variants {
                    assets::write_receipt(
                        tx,
                        &asset_receipt(
                            &lineage,
                            assets::AssetReceiptEventV1::RenditionProduced,
                            &record.asset_id,
                            Some(&attempt_id),
                            now,
                            serde_json::json!({
                                "renditionId": rendition_id,
                                "variantKey": variant_key,
                                "required": true,
                            }),
                        ),
                    )?;
                }
                Ok(AssetPublishOutcome::Published {
                    attempt: Box::new(record),
                    asset: Box::new(asset),
                    reused,
                })
            },
            before_commit,
        )
    }

    pub(super) fn attempt_finalize_commit_staging_cleaned(
        &mut self,
        attempt_ref: &str,
        asset_ref: &str,
    ) -> SnapbackResult<()> {
        self.attempt_finalize_commit_staging_cleaned_guarded(attempt_ref, asset_ref, || Ok(()))
    }

    pub(super) fn attempt_finalize_commit_staging_cleaned_guarded<G, BeforeCommit>(
        &mut self,
        attempt_ref: &str,
        asset_ref: &str,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<()>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.asset_attempts_transaction_guarded(
            |tx| {
                assets::write_receipt(
                    tx,
                    &asset_receipt(
                        attempt_ref,
                        assets::AssetReceiptEventV1::StagingCleaned,
                        asset_ref,
                        Some(attempt_ref),
                        now_millis(),
                        serde_json::json!({}),
                    ),
                )
            },
            before_commit,
        )
    }

    pub(super) fn attempt_fail(
        &mut self,
        attempt_id: &str,
        asset_outcome: assets::AssetAvailability,
        refusal_facts: &Value,
        on_rejected: Option<&str>,
        now: u64,
    ) -> SnapbackResult<String> {
        self.attempt_fail_guarded(
            attempt_id,
            asset_outcome,
            refusal_facts,
            on_rejected,
            now,
            || Ok(()),
        )
    }

    pub(super) fn attempt_fail_guarded<G, BeforeCommit>(
        &mut self,
        attempt_id: &str,
        asset_outcome: assets::AssetAvailability,
        refusal_facts: &Value,
        on_rejected: Option<&str>,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<String>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.asset_attempts_transaction_guarded(
            |tx| {
                let mut record = assets::load_attempt(tx, attempt_id)?.ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_ASSET_ATTEMPT_UNKNOWN",
                        "assets",
                        format!("unknown attempt {attempt_id}"),
                    )
                })?;
                record.failure = Some(refusal_facts.clone());
                assets::transition_attempt(
                    tx,
                    &mut record,
                    assets::AssetAttemptState::Failed,
                    now,
                )?;
                assets::write_receipt(
                    tx,
                    &asset_receipt(
                        attempt_id,
                        assets::AssetReceiptEventV1::BytesRejected,
                        &record.asset_id,
                        Some(attempt_id),
                        now,
                        refusal_facts.clone(),
                    ),
                )?;
                assets::write_receipt(
                    tx,
                    &asset_receipt(
                        attempt_id,
                        assets::AssetReceiptEventV1::AttemptFailed,
                        &record.asset_id,
                        Some(attempt_id),
                        now,
                        refusal_facts.clone(),
                    ),
                )?;
                if asset_outcome == assets::AssetAvailability::Rejected {
                    let mut asset = assets::load_asset(tx, &record.asset_id)?.ok_or_else(|| {
                        SnapbackError::error(
                            "SNAPBACK_ASSET_UNKNOWN",
                            "assets",
                            format!("unknown asset {}", record.asset_id),
                        )
                    })?;
                    assets::transition_asset(
                        tx,
                        &mut asset,
                        assets::AssetAvailability::Rejected,
                        now,
                    )?;
                    assets::write_receipt(
                        tx,
                        &asset_receipt(
                            attempt_id,
                            assets::AssetReceiptEventV1::AssetRejected,
                            &record.asset_id,
                            Some(attempt_id),
                            now,
                            refusal_facts.clone(),
                        ),
                    )?;
                    if let Some(handler) = on_rejected {
                        assets::enqueue_work_with_params(
                            tx,
                            assets::ASSET_WORK_KIND_LIFECYCLE_CALLBACK,
                            &record.asset_id,
                            Some(attempt_id),
                            asset.lifecycle_generation,
                            now,
                            Some(serde_json::json!({
                                "event": "rejected",
                                "handler": handler,
                            })),
                        )?;
                    }
                }
                Ok(record.staging_key.clone())
            },
            before_commit,
        )
    }

    pub(super) fn work_condemned_publications(
        &mut self,
    ) -> SnapbackResult<Vec<assets::AssetPublicationRecordV1>> {
        self.asset_attempts_transaction(|tx| {
            assets::publications_in_state(tx, assets::AssetPublicationState::Condemned)
        })
    }

    pub(super) fn work_lifecycle_callback_facts(
        &mut self,
        asset_id: &str,
    ) -> SnapbackResult<(assets::AssetRecordV1, Vec<assets::AssetRenditionRecordV1>)> {
        self.asset_attempts_transaction(|tx| {
            let asset = assets::load_asset(tx, asset_id)?.ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_UNKNOWN",
                    "assets",
                    format!("unknown asset {asset_id}"),
                )
            })?;
            let renditions = assets::renditions_for_asset(tx, asset_id)?;
            Ok((asset, renditions))
        })
    }

    pub(super) fn work_image_variant_is_current(
        &mut self,
        asset_id: &str,
        key: &str,
        recipe_version: u64,
    ) -> SnapbackResult<bool> {
        self.asset_attempts_transaction(|tx| {
            Ok(assets::load_rendition_by_variant(tx, asset_id, key)?
                .filter(|r| {
                    r.state == assets::AssetRenditionState::Ready
                        && r.recipe == assets::ASSET_RECIPE_IMAGE_VARIANT_V1
                        && r.recipe_version >= recipe_version
                })
                .is_some())
        })
    }

    pub(super) fn work_image_variant_primary_key(
        &mut self,
        asset_id: &str,
    ) -> SnapbackResult<String> {
        self.asset_attempts_transaction(|tx| {
            let asset = assets::load_asset(tx, asset_id)?.ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_UNKNOWN",
                    "assets",
                    format!("unknown asset {asset_id}"),
                )
            })?;
            let rendition_id = asset.primary_rendition_id.as_deref().ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_NOT_READY",
                    "assets",
                    "the asset has no primary rendition to derive from",
                )
            })?;
            let primary = assets::load_rendition(tx, rendition_id)?.ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_RECORD_INVALID",
                    "assets",
                    "the primary rendition record is missing",
                )
            })?;
            let blob = assets::load_blob_live(tx, &primary.blob_id)?
                .filter(|blob| !blob.condemned)
                .map(|blob| blob.record)
                .ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                        "assets",
                        "the primary blob is not available",
                    )
                })?;
            Ok(blob.physical_key)
        })
    }

    pub(super) fn work_commit_rendition_failure(
        &mut self,
        work_id: &str,
        asset_id: &str,
        key: &str,
        failure: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.asset_attempts_transaction(|tx| {
            assets::write_receipt(
                tx,
                &asset_receipt(
                    work_id,
                    assets::AssetReceiptEventV1::RenditionFailed,
                    asset_id,
                    None,
                    now_ms,
                    serde_json::json!({
                        "variantKey": key,
                        "failure": failure,
                    }),
                ),
            )
        })
    }

    pub(super) fn work_commit_prepared_variant(
        &mut self,
        work_id: &str,
        app_id: &str,
        asset_id: &str,
        prepared: &AssetPreparedVariant,
        app_quota: u64,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.asset_attempts_transaction(|tx| {
            match asset_commit_prepared_variant(tx, app_id, asset_id, prepared, app_quota, now_ms)?
            {
                AssetVariantCommit::Committed { rendition_id, .. } => {
                    assets::write_receipt(
                        tx,
                        &asset_receipt(
                            work_id,
                            assets::AssetReceiptEventV1::RenditionProduced,
                            asset_id,
                            None,
                            now_ms,
                            serde_json::json!({
                                "renditionId": rendition_id,
                                "variantKey": prepared.key,
                            }),
                        ),
                    )?;
                }
                AssetVariantCommit::QuotaRefused => {
                    assets::write_receipt(
                        tx,
                        &asset_receipt(
                            work_id,
                            assets::AssetReceiptEventV1::RenditionFailed,
                            asset_id,
                            None,
                            now_ms,
                            serde_json::json!({
                                "variantKey": prepared.key,
                                "failure": "SNAPBACK_ASSET_QUOTA_EXCEEDED",
                            }),
                        ),
                    )?;
                }
                AssetVariantCommit::AlreadyCurrent | AssetVariantCommit::StaleLost => {
                    assets::write_receipt(
                        tx,
                        &asset_receipt(
                            work_id,
                            assets::AssetReceiptEventV1::RenditionSuperseded,
                            asset_id,
                            None,
                            now_ms,
                            serde_json::json!({
                                "variantKey": prepared.key,
                                "outcome": "pointer-unchanged",
                            }),
                        ),
                    )?;
                }
            }
            Ok(())
        })
    }

    pub(super) fn resolve_width_variant_is_ready(
        &mut self,
        asset_id: &str,
        key: &str,
    ) -> SnapbackResult<bool> {
        self.asset_attempts_transaction(|tx| {
            Ok(assets::load_rendition_by_variant(tx, asset_id, key)?
                .filter(|r| r.state == assets::AssetRenditionState::Ready)
                .is_some())
        })
    }

    pub(super) fn resolve_width_variant_primary(
        &mut self,
        asset_id: &str,
    ) -> SnapbackResult<(String, String)> {
        self.asset_attempts_transaction(|tx| {
            let asset = assets::load_asset(tx, asset_id)?.ok_or_else(asset_unknown(asset_id))?;
            let rendition_id = asset.primary_rendition_id.as_deref().ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_NOT_READY",
                    "assets",
                    "the asset has no primary rendition to derive from",
                )
            })?;
            let primary = assets::load_rendition(tx, rendition_id)?.ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_RECORD_INVALID",
                    "assets",
                    "the primary rendition record is missing",
                )
            })?;
            let blob = assets::load_blob_live(tx, &primary.blob_id)?
                .filter(|blob| !blob.condemned)
                .map(|blob| blob.record)
                .ok_or_else(|| {
                    SnapbackError::error(
                        "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                        "assets",
                        "the primary blob is not available",
                    )
                })?;
            Ok((blob.physical_key, blob.detected_content_type))
        })
    }

    pub(super) fn resolve_width_variant_commit(
        &mut self,
        app_id: &str,
        asset_id: &str,
        prepared: &AssetWidthPreparedVariant,
        app_quota: u64,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.resolve_width_variant_commit_guarded(
            app_id,
            asset_id,
            prepared,
            app_quota,
            now_ms,
            || Ok(()),
        )
    }

    pub(super) fn resolve_width_variant_commit_guarded<G, BeforeCommit>(
        &mut self,
        app_id: &str,
        asset_id: &str,
        prepared: &AssetWidthPreparedVariant,
        app_quota: u64,
        now_ms: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<()>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        let prepared = prepared.prepared();
        self.asset_attempts_transaction_guarded(
            |tx| {
                match asset_commit_prepared_variant(
                    tx, app_id, asset_id, prepared, app_quota, now_ms,
                )? {
                    AssetVariantCommit::Committed { rendition_id, .. } => {
                        assets::write_receipt(
                            tx,
                            &asset_receipt(
                                asset_id,
                                assets::AssetReceiptEventV1::RenditionProduced,
                                asset_id,
                                None,
                                now_ms,
                                serde_json::json!({
                                    "renditionId": rendition_id,
                                    "variantKey": prepared.key,
                                    "onDemand": true,
                                }),
                            ),
                        )?;
                        Ok(())
                    }
                    AssetVariantCommit::QuotaRefused => Err(SnapbackError::error(
                        "SNAPBACK_ASSET_QUOTA_EXCEEDED",
                        "assets",
                        "materializing the requested width would exceed the app quota",
                    )),
                    // Concurrent firsts converge on one winner.
                    AssetVariantCommit::AlreadyCurrent | AssetVariantCommit::StaleLost => Ok(()),
                }
            },
            before_commit,
        )
    }
}

/// Narrow typed access to asset attempt, staging, and work-execution storage
/// operations.
///
/// @ref LLP 0225#1-ownership-map — asset services enter the storage
/// kernel through typed operations instead of a raw SQLite transaction.
pub struct AssetAttemptsKernel<'a> {
    db: &'a mut LocalDatabase,
}

impl<'a> AssetAttemptsKernel<'a> {
    pub(super) fn new(db: &'a mut LocalDatabase) -> Self {
        Self { db }
    }

    pub fn attempt_require_current(
        &self,
        attempt: &assets::AssetAttemptRecordV1,
    ) -> SnapbackResult<()> {
        self.db.attempt_require_current(attempt)
    }

    /// Mint an opaque continuity proof only after the kernel has checked that
    /// the exact attempt snapshot is current.
    ///
    /// @ref LLP 0276#phases — inter-crate capability carriers remain
    /// unconstructable outside the kernel operation that proves their facts.
    pub(crate) fn attempt_require_current_proof(
        &mut self,
        attempt: &assets::AssetAttemptRecordV1,
    ) -> SnapbackResult<AssetAttemptCurrentProof> {
        let canonical = self
            .db
            .attempt_ingest_load(&attempt.attempt_id)?
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_ATTEMPT_UNKNOWN",
                    "assets",
                    format!("unknown attempt {}", attempt.attempt_id),
                )
            })?;
        if canonical != *attempt {
            return Err(SnapbackError::error(
                "SNAPBACK_ASSET_RECORD_INVALID",
                "assets",
                "the admitted attempt snapshot does not match its canonical storage record",
            ));
        }
        self.db.attempt_require_current(&canonical)?;
        Ok(AssetAttemptCurrentProof::new(canonical))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn attempt_create(
        &mut self,
        intent: &AssetUploadIntentDefinition,
        deployed_implementation_hash: &str,
        intent_artifact_json: &str,
        now: u64,
        app_id: &str,
        app_quota: u64,
        caller: &Option<String>,
        declared_length: u64,
        request: &assets::AssetAttemptCreateRequestV1,
        owner: &str,
        auth_pair: &Value,
        witness: &Value,
    ) -> SnapbackResult<(
        assets::AssetAttemptRecordV1,
        Option<assets::AssetAttemptRecordV1>,
    )> {
        self.db.attempt_create(
            intent,
            deployed_implementation_hash,
            intent_artifact_json,
            now,
            app_id,
            app_quota,
            caller,
            declared_length,
            request,
            owner,
            auth_pair,
            witness,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn attempt_create_guarded<G, BeforeCommit>(
        &mut self,
        intent: &AssetUploadIntentDefinition,
        deployed_implementation_hash: &str,
        intent_artifact_json: &str,
        now: u64,
        app_id: &str,
        app_quota: u64,
        caller: &Option<String>,
        declared_length: u64,
        request: &assets::AssetAttemptCreateRequestV1,
        owner: &str,
        auth_pair: &Value,
        witness: &Value,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<(
        assets::AssetAttemptRecordV1,
        Option<assets::AssetAttemptRecordV1>,
    )>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db.attempt_create_guarded(
            intent,
            deployed_implementation_hash,
            intent_artifact_json,
            now,
            app_id,
            app_quota,
            caller,
            declared_length,
            request,
            owner,
            auth_pair,
            witness,
            before_commit,
        )
    }

    pub fn attempt_cancel(
        &mut self,
        request: &assets::AssetAttemptCancelRequestV1,
        now: u64,
    ) -> SnapbackResult<(assets::AssetAttemptRecordV1, Option<assets::AssetRecordV1>)> {
        self.db.attempt_cancel(request, now)
    }

    pub fn attempt_cancel_guarded<G, BeforeCommit>(
        &mut self,
        request: &assets::AssetAttemptCancelRequestV1,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<(assets::AssetAttemptRecordV1, Option<assets::AssetRecordV1>)>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db.attempt_cancel_guarded(request, now, before_commit)
    }

    pub fn attempt_ingest_load(
        &mut self,
        attempt_id: &str,
    ) -> SnapbackResult<Option<assets::AssetAttemptRecordV1>> {
        self.db.attempt_ingest_load(attempt_id)
    }

    pub fn attempt_tus_patch(
        &mut self,
        attempt_id: &str,
        expected_offset: u64,
        expected_all_checksummed: bool,
        new_offset: u64,
        all_checksummed: bool,
        now: u64,
    ) -> SnapbackResult<assets::AssetAttemptRecordV1> {
        self.db.attempt_tus_patch(
            attempt_id,
            expected_offset,
            expected_all_checksummed,
            new_offset,
            all_checksummed,
            now,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn attempt_tus_patch_guarded<G, BeforeCommit>(
        &mut self,
        attempt_id: &str,
        expected_offset: u64,
        expected_all_checksummed: bool,
        new_offset: u64,
        all_checksummed: bool,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<assets::AssetAttemptRecordV1>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db.attempt_tus_patch_guarded(
            attempt_id,
            expected_offset,
            expected_all_checksummed,
            new_offset,
            all_checksummed,
            now,
            before_commit,
        )
    }

    pub fn stage_prepared_variant_plan(
        &mut self,
        app_id: &str,
        digest: &str,
        now: u64,
    ) -> SnapbackResult<assets::AssetPublicationRecordV1> {
        self.db.stage_prepared_variant_plan(app_id, digest, now)
    }

    pub fn stage_prepared_variant_plan_guarded<G, BeforeCommit>(
        &mut self,
        app_id: &str,
        digest: &str,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<assets::AssetPublicationRecordV1>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db
            .stage_prepared_variant_plan_guarded(app_id, digest, now, before_commit)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn stage_attempt_variant_plan_proved_guarded<G, BeforeCommit>(
        &mut self,
        app_id: &str,
        attempt_id: &str,
        asset_id: &str,
        variant_key: &str,
        digest: &str,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<AssetPublicationPlannedProof>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db.stage_attempt_variant_plan_proved_guarded(
            app_id,
            attempt_id,
            asset_id,
            variant_key,
            digest,
            now,
            before_commit,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn stage_width_variant_plan_proved_guarded<G, BeforeCommit>(
        &mut self,
        app_id: &str,
        asset_id: &str,
        variant_key: &str,
        digest: &str,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<AssetWidthPublicationPlannedProof>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db.stage_width_variant_plan_proved_guarded(
            app_id,
            asset_id,
            variant_key,
            digest,
            now,
            before_commit,
        )
    }

    pub fn stage_prepared_variant_commit_staged(
        &mut self,
        publication: &mut assets::AssetPublicationRecordV1,
    ) -> SnapbackResult<()> {
        self.db.stage_prepared_variant_commit_staged(publication)
    }

    pub fn stage_prepared_variant_commit_staged_guarded<G, BeforeCommit>(
        &mut self,
        publication: &mut assets::AssetPublicationRecordV1,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<()>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db
            .stage_prepared_variant_commit_staged_guarded(publication, before_commit)
    }

    pub fn stage_width_variant_commit_staged_guarded<G, BeforeCommit>(
        &mut self,
        prepared: &mut AssetWidthPreparedVariant,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<AssetWidthPublicationStageOutcome>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db
            .stage_width_variant_commit_staged_guarded(prepared, before_commit)
    }

    pub fn attempt_finalize_load_asset(
        &mut self,
        asset_id: &str,
    ) -> SnapbackResult<Option<assets::AssetRecordV1>> {
        self.db.attempt_finalize_load_asset(asset_id)
    }

    pub fn attempt_finalize_load_intent_artifact(
        &mut self,
        intent_id: &str,
        policy_generation: u64,
    ) -> SnapbackResult<Option<String>> {
        self.db
            .attempt_finalize_load_intent_artifact(intent_id, policy_generation)
    }

    pub fn attempt_finalize_generation_revoked(
        &mut self,
        intent_id: &str,
        policy_generation: u64,
    ) -> SnapbackResult<bool> {
        self.db
            .attempt_finalize_generation_revoked(intent_id, policy_generation)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn test_revoke_intent_generation(
        &mut self,
        intent_id: &str,
        policy_generation: u64,
    ) -> SnapbackResult<()> {
        self.db.asset_attempts_transaction(|tx| {
            let changed = tx.execute(
                "UPDATE _snapback_asset_intent_generations_v1
                 SET revoked = 1
                 WHERE intent_id = ?1 AND generation = ?2",
                rusqlite::params![intent_id, policy_generation],
            )?;
            if changed != 1 {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_RECORD_INVALID",
                    "assets",
                    "the test generation to revoke does not exist",
                ));
            }
            Ok(())
        })
    }

    pub fn attempt_finalize_commit_plan(
        &mut self,
        app_id: &str,
        attempt_id: &str,
        digest: &str,
        now: u64,
    ) -> SnapbackResult<assets::AssetPublicationRecordV1> {
        self.db
            .attempt_finalize_commit_plan(app_id, attempt_id, digest, now)
    }

    /// Commit the publication plan and return the only token accepted by the
    /// services-owned Phase-B ticket constructor.
    ///
    /// @ref LLP 0276#phases — the committed plan is transported as an opaque
    /// fact instead of a caller-asserted publication record.
    pub(crate) fn attempt_finalize_commit_plan_proved(
        &mut self,
        app_id: &str,
        attempt_id: &str,
        digest: &str,
        now: u64,
    ) -> SnapbackResult<AssetPublicationPlannedProof> {
        let publication = self
            .db
            .attempt_finalize_commit_plan(app_id, attempt_id, digest, now)?;
        Ok(AssetPublicationPlannedProof::new(publication))
    }

    pub(crate) fn attempt_finalize_commit_plan_proved_guarded<G, BeforeCommit>(
        &mut self,
        app_id: &str,
        attempt_id: &str,
        digest: &str,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<AssetPublicationPlannedProof>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        let publication = self.db.attempt_finalize_commit_plan_guarded(
            app_id,
            attempt_id,
            digest,
            now,
            before_commit,
        )?;
        Ok(AssetPublicationPlannedProof::new(publication))
    }

    pub fn attempt_finalize_commit_staged(
        &mut self,
        attempt_id: &str,
        publication: &assets::AssetPublicationRecordV1,
        now: u64,
    ) -> SnapbackResult<assets::AssetPublicationRecordV1> {
        self.db
            .attempt_finalize_commit_staged(attempt_id, publication, now)
    }

    pub fn attempt_finalize_commit_staged_guarded<G, BeforeCommit>(
        &mut self,
        attempt_id: &str,
        publication: &assets::AssetPublicationRecordV1,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<assets::AssetPublicationRecordV1>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db
            .attempt_finalize_commit_staged_guarded(attempt_id, publication, now, before_commit)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn attempt_finalize_commit_completion(
        &mut self,
        attempt: &assets::AssetAttemptRecordV1,
        attempt_id: String,
        publication_id: String,
        schema: &SchemaManifest,
        witness_input: &HandlerInput,
        witness_snapshot: Vec<CapturedReadDependency>,
        auth_moved: bool,
        canonical_length: u64,
        canonical_policy: &'static str,
        image_facts: Map<String, Value>,
        detected_type: String,
        app: String,
        digest_value: String,
        required_variants: Vec<AssetPreparedVariant>,
        optional_keys: Vec<AssetImageVariant>,
        app_quota: u64,
        on_ready: &Option<String>,
        grade: assets::AssetIntegrityGrade,
        now: u64,
    ) -> SnapbackResult<AssetPublishOutcome> {
        self.db.attempt_finalize_commit_completion_guarded(
            attempt,
            attempt_id,
            publication_id,
            schema,
            witness_input,
            witness_snapshot,
            auth_moved,
            canonical_length,
            canonical_policy,
            image_facts,
            detected_type,
            app,
            digest_value,
            required_variants,
            optional_keys,
            app_quota,
            on_ready,
            grade,
            now,
            || Ok(()),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn attempt_finalize_commit_completion_guarded<G, BeforeCommit>(
        &mut self,
        attempt: &assets::AssetAttemptRecordV1,
        attempt_id: String,
        publication_id: String,
        schema: &SchemaManifest,
        witness_input: &HandlerInput,
        witness_snapshot: Vec<CapturedReadDependency>,
        auth_moved: bool,
        canonical_length: u64,
        canonical_policy: &'static str,
        image_facts: Map<String, Value>,
        detected_type: String,
        app: String,
        digest_value: String,
        required_variants: Vec<AssetPreparedVariant>,
        optional_keys: Vec<AssetImageVariant>,
        app_quota: u64,
        on_ready: &Option<String>,
        grade: assets::AssetIntegrityGrade,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<AssetPublishOutcome>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db.attempt_finalize_commit_completion_guarded(
            attempt,
            attempt_id,
            publication_id,
            schema,
            witness_input,
            witness_snapshot,
            auth_moved,
            canonical_length,
            canonical_policy,
            image_facts,
            detected_type,
            app,
            digest_value,
            required_variants,
            optional_keys,
            app_quota,
            on_ready,
            grade,
            now,
            before_commit,
        )
    }

    pub fn attempt_finalize_commit_staging_cleaned(
        &mut self,
        attempt_ref: &str,
        asset_ref: &str,
    ) -> SnapbackResult<()> {
        self.db
            .attempt_finalize_commit_staging_cleaned(attempt_ref, asset_ref)
    }

    pub fn attempt_finalize_commit_staging_cleaned_guarded<G, BeforeCommit>(
        &mut self,
        attempt_ref: &str,
        asset_ref: &str,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<()>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db.attempt_finalize_commit_staging_cleaned_guarded(
            attempt_ref,
            asset_ref,
            before_commit,
        )
    }

    pub fn attempt_fail(
        &mut self,
        attempt_id: &str,
        asset_outcome: assets::AssetAvailability,
        refusal_facts: &Value,
        on_rejected: Option<&str>,
        now: u64,
    ) -> SnapbackResult<String> {
        self.db
            .attempt_fail(attempt_id, asset_outcome, refusal_facts, on_rejected, now)
    }

    pub fn attempt_fail_guarded<G, BeforeCommit>(
        &mut self,
        attempt_id: &str,
        asset_outcome: assets::AssetAvailability,
        refusal_facts: &Value,
        on_rejected: Option<&str>,
        now: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<String>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db.attempt_fail_guarded(
            attempt_id,
            asset_outcome,
            refusal_facts,
            on_rejected,
            now,
            before_commit,
        )
    }

    pub fn work_condemned_publications(
        &mut self,
    ) -> SnapbackResult<Vec<assets::AssetPublicationRecordV1>> {
        self.db.work_condemned_publications()
    }

    pub fn work_lifecycle_callback_facts(
        &mut self,
        asset_id: &str,
    ) -> SnapbackResult<(assets::AssetRecordV1, Vec<assets::AssetRenditionRecordV1>)> {
        self.db.work_lifecycle_callback_facts(asset_id)
    }

    pub fn work_image_variant_is_current(
        &mut self,
        asset_id: &str,
        key: &str,
        recipe_version: u64,
    ) -> SnapbackResult<bool> {
        self.db
            .work_image_variant_is_current(asset_id, key, recipe_version)
    }

    pub fn work_image_variant_primary_key(&mut self, asset_id: &str) -> SnapbackResult<String> {
        self.db.work_image_variant_primary_key(asset_id)
    }

    pub fn work_commit_rendition_failure(
        &mut self,
        work_id: &str,
        asset_id: &str,
        key: &str,
        failure: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db
            .work_commit_rendition_failure(work_id, asset_id, key, failure, now_ms)
    }

    pub fn work_commit_prepared_variant(
        &mut self,
        work_id: &str,
        app_id: &str,
        asset_id: &str,
        prepared: &AssetPreparedVariant,
        app_quota: u64,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db
            .work_commit_prepared_variant(work_id, app_id, asset_id, prepared, app_quota, now_ms)
    }

    pub fn resolve_width_variant_is_ready(
        &mut self,
        asset_id: &str,
        key: &str,
    ) -> SnapbackResult<bool> {
        self.db.resolve_width_variant_is_ready(asset_id, key)
    }

    pub fn resolve_width_variant_primary(
        &mut self,
        asset_id: &str,
    ) -> SnapbackResult<(String, String)> {
        self.db.resolve_width_variant_primary(asset_id)
    }

    pub fn resolve_width_variant_commit(
        &mut self,
        app_id: &str,
        asset_id: &str,
        prepared: &AssetWidthPreparedVariant,
        app_quota: u64,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.db
            .resolve_width_variant_commit(app_id, asset_id, prepared, app_quota, now_ms)
    }

    pub fn resolve_width_variant_commit_guarded<G, BeforeCommit>(
        &mut self,
        app_id: &str,
        asset_id: &str,
        prepared: &AssetWidthPreparedVariant,
        app_quota: u64,
        now_ms: u64,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<()>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db.resolve_width_variant_commit_guarded(
            app_id,
            asset_id,
            prepared,
            app_quota,
            now_ms,
            before_commit,
        )
    }
}
