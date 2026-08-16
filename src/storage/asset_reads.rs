use super::asset_attempts::asset_unknown;
use super::asset_maintenance::{asset_delete_cascade, asset_receipt};
use super::{
    CapturedReadDependency, CapturedReadKind, LocalDatabase, SnapbackError, SnapbackResult,
};
use crate::assets;
use crate::manifest::SchemaManifest;
use rusqlite::TransactionBehavior;
use serde_json::Value;
use std::sync::Arc;

fn asset_signed_url_forbidden() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_ASSET_FORBIDDEN",
        "assets",
        "this asset is not readable by the caller",
    )
}

/// One resolved delivery window over an `(asset, rendition)` alias. The
/// cache posture is the profile's: strict is `private, no-store`, signed is
/// `private` bounded by the remaining bearer window, public-immutable is the
/// immutable year (LLP 0044 §Delivery profiles).
pub struct AssetDelivery {
    pub store: Arc<dyn crate::assets_store::AssetStore>,
    pub blob_key: String,
    pub window_start: u64,
    pub window_length: u64,
    pub total_length: u64,
    pub content_type: String,
    pub etag: String,
    pub disposition: String,
    pub cache_control: String,
    pub partial: bool,
}

impl std::fmt::Debug for AssetDelivery {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AssetDelivery")
            .field("store", &self.store.kind())
            .field("blob_key", &self.blob_key)
            .field("window_start", &self.window_start)
            .field("window_length", &self.window_length)
            .field("total_length", &self.total_length)
            .field("content_type", &self.content_type)
            .field("etag", &self.etag)
            .field("disposition", &self.disposition)
            .field("cache_control", &self.cache_control)
            .field("partial", &self.partial)
            .finish()
    }
}

#[derive(Debug)]
pub enum AssetDeliveryOutcome {
    Content(Box<AssetDelivery>),
    /// Syntactically valid but unsatisfiable range: 416 with the total.
    Unsatisfiable {
        total_length: u64,
    },
}

#[allow(clippy::too_many_arguments)]
fn asset_deliver_from(
    tx: &rusqlite::Transaction<'_>,
    store: &Arc<dyn crate::assets_store::AssetStore>,
    asset: &assets::AssetRecordV1,
    variant: &str,
    max_width: Option<u64>,
    range_header: Option<&str>,
    profile_label: &str,
    cache_control: String,
    now: u64,
) -> SnapbackResult<AssetDeliveryOutcome> {
    let asset_id = asset.asset_id.as_str();
    let rendition = if variant == "best" {
        let bound = max_width.ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_ASSET_VARIANT_UNKNOWN",
                "assets",
                "the best selector requires a maxWidth bound",
            )
        })?;
        let ready = assets::load_ready_renditions(tx, asset_id)?;
        let width_of = |r: &assets::AssetRenditionRecordV1| {
            r.media_facts
                .as_ref()
                .and_then(|facts| facts.get("width"))
                .and_then(serde_json::Value::as_u64)
        };
        let mut sized: Vec<_> = ready
            .into_iter()
            .filter_map(|r| width_of(&r).map(|w| (w, r)))
            .collect();
        sized.sort_by_key(|(w, _)| *w);
        let within = sized.iter().rev().find(|(w, _)| *w <= bound).cloned();
        within
            .or_else(|| sized.into_iter().next())
            .map(|(_, r)| r)
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_VARIANT_UNKNOWN",
                    "assets",
                    "no ready rendition carries a width fact",
                )
            })?
    } else {
        assets::load_rendition_by_variant(tx, asset_id, variant)?
            .filter(|r| r.state == assets::AssetRenditionState::Ready)
            .ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_VARIANT_UNKNOWN",
                    "assets",
                    format!("no ready rendition for variant {variant}"),
                )
            })?
    };
    let blob = assets::load_blob_live(tx, &rendition.blob_id)?
        .filter(|b| !b.condemned)
        .map(|b| b.record)
        .ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_ASSET_STORE_UNAVAILABLE",
                "assets",
                "the rendition's blob is not available",
            )
        })?;
    let range = assets::parse_byte_range(range_header, blob.byte_length);
    if range == assets::ByteRangeOutcome::Unsatisfiable {
        return Ok(AssetDeliveryOutcome::Unsatisfiable {
            total_length: blob.byte_length,
        });
    }
    let (window_start, window_length, partial) = match range {
        assets::ByteRangeOutcome::Partial { start, end } => (start, end - start + 1, true),
        _ => (0, blob.byte_length, false),
    };
    assets::write_receipt(
        tx,
        &asset_receipt(
            &asset.asset_id.clone(),
            assets::AssetReceiptEventV1::DeliveryAdmitted,
            &asset.asset_id,
            None,
            now,
            serde_json::json!({
                "profile": profile_label,
                "variant": rendition.variant_key,
                "partial": partial,
                "windowStart": window_start,
                "windowLength": window_length,
            }),
        ),
    )?;
    let filename = rendition
        .media_facts
        .as_ref()
        .and_then(|facts| facts.get("filename"))
        .and_then(|value| value.as_str())
        .map(str::to_owned)
        .unwrap_or_else(|| assets::sanitize_filename(None));
    let disposition = if assets::forces_attachment_disposition(&blob.detected_content_type) {
        format!("attachment; filename=\"{filename}\"")
    } else {
        format!("inline; filename=\"{filename}\"")
    };
    Ok(AssetDeliveryOutcome::Content(Box::new(AssetDelivery {
        store: store.clone(),
        blob_key: blob.physical_key.clone(),
        window_start,
        window_length,
        total_length: blob.byte_length,
        content_type: blob.detected_content_type.clone(),
        // Rendition-scoped so two assets sharing one deduplicated blob never
        // expose equal validators (alias identity).
        etag: format!("\"r-{}\"", rendition.rendition_id),
        disposition,
        cache_control,
        partial,
    })))
}

impl LocalDatabase {
    fn asset_reads_transaction<T>(
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

    pub(super) fn asset_attempt_for_caller(
        &mut self,
        caller: Option<&str>,
        attempt_id: &str,
        now: u64,
    ) -> SnapbackResult<(assets::AssetAttemptRecordV1, Option<String>)> {
        self.asset_reads_transaction(|tx| {
            let mut attempt = assets::load_attempt(tx, attempt_id)?.ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_ATTEMPT_UNKNOWN",
                    "assets",
                    format!("unknown attempt {attempt_id}"),
                )
            })?;
            if caller != Some(attempt.admission.owner_principal.as_str()) {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_FORBIDDEN",
                    "assets",
                    "this attempt belongs to a different authority",
                ));
            }
            let mut expired_staging = None;
            if attempt.state.is_current() && now >= attempt.expires_at_ms {
                assets::transition_attempt(
                    tx,
                    &mut attempt,
                    assets::AssetAttemptState::Expired,
                    now,
                )?;
                assets::write_receipt(
                    tx,
                    &asset_receipt(
                        &attempt.attempt_id.clone(),
                        assets::AssetReceiptEventV1::AttemptExpired,
                        &attempt.asset_id,
                        Some(&attempt.attempt_id),
                        now,
                        serde_json::json!({ "expiresAtMs": attempt.expires_at_ms }),
                    ),
                )?;
                expired_staging = Some(attempt.staging_key.clone());
            }
            Ok((attempt, expired_staging))
        })
    }

    pub(super) fn asset_load_record(
        &mut self,
        asset_id: &str,
    ) -> SnapbackResult<Option<assets::AssetRecordV1>> {
        self.asset_reads_transaction(|tx| assets::load_asset(tx, asset_id))
    }

    pub(super) fn asset_require_record(
        &mut self,
        asset_id: &str,
    ) -> SnapbackResult<assets::AssetRecordV1> {
        self.asset_reads_transaction(|tx| {
            assets::load_asset(tx, asset_id)?.ok_or_else(asset_unknown(asset_id))
        })
    }

    pub(super) fn asset_record_inspect(
        &mut self,
        schema: &SchemaManifest,
        caller: Option<&str>,
        asset_id: &str,
    ) -> SnapbackResult<Value> {
        self.asset_reads_transaction(|tx| {
            let asset = assets::load_asset(tx, asset_id)?.ok_or_else(|| {
                SnapbackError::error(
                    "SNAPBACK_ASSET_UNKNOWN",
                    "assets",
                    format!("unknown asset {asset_id}"),
                )
            })?;
            let decision = super::asset_read_authorized(schema, tx, caller, &asset)?;
            if !decision.authorized {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_FORBIDDEN",
                    "assets",
                    "this asset is not readable by the caller",
                ));
            }
            let view = assets::asset_record_client_view(tx, &asset)?;
            Ok(serde_json::to_value(view).expect("client view serializes"))
        })
    }

    pub(super) fn asset_record_projection(
        &mut self,
        schema: &SchemaManifest,
        caller: Option<&str>,
        asset_id: &str,
    ) -> SnapbackResult<(Vec<Value>, Vec<CapturedReadDependency>)> {
        self.asset_reads_transaction(|tx| {
            let mut dependencies = Vec::new();
            let Some(asset) = assets::load_asset(tx, asset_id)? else {
                dependencies.push(CapturedReadDependency {
                    kind: CapturedReadKind::MissingRow,
                    table: Some("_snapback_asset_records_v1".to_owned()),
                    id: Some(asset_id.to_owned()),
                    version: None,
                    predicate: None,
                    rows: Vec::new(),
                    field: None,
                    value: None,
                    order: None,
                    limit: None,
                    result_count: None,
                    boundary: None,
                });
                return Ok((Vec::new(), dependencies));
            };
            let view = assets::asset_record_client_view(tx, &asset)?;
            dependencies.push(CapturedReadDependency {
                kind: CapturedReadKind::Row,
                table: Some("_snapback_asset_records_v1".to_owned()),
                id: Some(asset_id.to_owned()),
                version: Some(asset.lifecycle_generation),
                predicate: None,
                rows: Vec::new(),
                field: None,
                value: Some(serde_json::json!({
                    "availability": view.availability,
                    "updatedAtMs": view.updated_at_ms,
                    "primaryRenditionId": view.primary_rendition_id,
                    "renditions": view.renditions,
                    "media": view.media,
                })),
                order: None,
                limit: None,
                result_count: None,
                boundary: None,
            });
            let decision = super::asset_read_authorized(schema, tx, caller, &asset)?;
            dependencies.extend(decision.dependencies);
            let deleted = asset.availability == assets::AssetAvailability::Deleted;
            let rows = if decision.authorized && !deleted {
                vec![serde_json::to_value(view).expect("client view serializes")]
            } else {
                Vec::new()
            };
            Ok((rows, dependencies))
        })
    }

    pub(super) fn asset_capture_export_cut(
        &mut self,
        app_id: &str,
        now: u64,
    ) -> SnapbackResult<crate::assets_cut::AssetCutCapture> {
        let schema = self.schema.clone();
        self.asset_reads_transaction(|tx| {
            let version = super::current_version_on(tx)?;
            crate::assets_cut::capture_cut(tx, &schema, app_id, version, now)
        })
    }

    pub(super) fn asset_record_cut_exported(
        &mut self,
        now: u64,
        summary: &Value,
    ) -> SnapbackResult<()> {
        self.asset_reads_transaction(|tx| {
            assets::write_receipt(
                tx,
                &assets::AssetReceiptV1 {
                    receipt_id: crate::ids::mint_time_ordered(crate::ids::Kind::Receipt),
                    operation_lineage: "asset-cut-export".to_owned(),
                    event: assets::AssetReceiptEventV1::CutExported,
                    asset_id: None,
                    attempt_id: None,
                    at_ms: now,
                    details: summary.clone(),
                },
            )
        })
    }

    pub(super) fn asset_record_cut_import_validated(
        &mut self,
        now: u64,
        summary: &Value,
    ) -> SnapbackResult<()> {
        self.asset_reads_transaction(|tx| {
            assets::write_receipt(
                tx,
                &assets::AssetReceiptV1 {
                    receipt_id: crate::ids::mint_time_ordered(crate::ids::Kind::Receipt),
                    operation_lineage: "asset-cut-import".to_owned(),
                    event: assets::AssetReceiptEventV1::CutImportValidated,
                    asset_id: None,
                    attempt_id: None,
                    at_ms: now,
                    details: summary.clone(),
                },
            )
        })
    }

    pub(super) fn asset_apply_import_cut(
        &mut self,
        manifest: &crate::assets_cut::AssetCutManifestV1,
        fresh_keys: &[String],
        store_kind: &str,
        now: u64,
        summary: &Value,
    ) -> SnapbackResult<()> {
        let schema = self.schema.clone();
        self.asset_reads_transaction(|tx| {
            crate::assets_cut::apply_cut(tx, &schema, manifest, fresh_keys, store_kind, now)?;
            assets::write_receipt(
                tx,
                &assets::AssetReceiptV1 {
                    receipt_id: crate::ids::mint_time_ordered(crate::ids::Kind::Receipt),
                    operation_lineage: "asset-cut-import".to_owned(),
                    event: assets::AssetReceiptEventV1::CutImported,
                    asset_id: None,
                    attempt_id: None,
                    at_ms: now,
                    details: summary.clone(),
                },
            )
        })
    }

    pub(super) fn asset_seed_fixture_existing(
        &mut self,
        fixture_id: &str,
        source_digest: &str,
    ) -> SnapbackResult<Option<String>> {
        self.asset_reads_transaction(|tx| {
            let Some(mapping) = assets::lookup_seed_fixture(tx, fixture_id)? else {
                return Ok(None);
            };
            if mapping.source_digest != source_digest {
                return Ok(None);
            }
            let live = assets::load_asset(tx, &mapping.asset_id)?
                .is_some_and(|asset| asset.availability != assets::AssetAvailability::Deleted);
            Ok(live.then_some(mapping.asset_id))
        })
    }

    pub(super) fn asset_seed_fixture_upsert(
        &mut self,
        mapping: &assets::SeedFixtureMappingV1,
    ) -> SnapbackResult<()> {
        self.asset_reads_transaction(|tx| assets::upsert_seed_fixture(tx, mapping))
    }

    pub(super) fn asset_host_inspect(
        &mut self,
        schema: &SchemaManifest,
        caller: Option<&str>,
        asset_id: &str,
    ) -> SnapbackResult<Value> {
        self.asset_reads_transaction(|tx| {
            let asset = assets::load_asset(tx, asset_id)?.ok_or_else(asset_unknown(asset_id))?;
            if let Some(user) = caller {
                let decision = super::asset_read_authorized(schema, tx, Some(user), &asset)?;
                if !decision.authorized {
                    return Err(SnapbackError::error(
                        "SNAPBACK_ASSET_FORBIDDEN",
                        "assets",
                        "this asset is not readable by the caller",
                    ));
                }
            }
            let current = assets::current_attempt(tx, &asset.asset_id)?;
            let view = assets::asset_record_client_view(tx, &asset)?;
            let renditions = assets::renditions_for_asset(tx, &asset.asset_id)?;
            let edges = assets::load_edges_for_asset(tx, &asset.asset_id)?;
            let accounting = assets::asset_accounting(tx, &asset.app_id)?;
            let work = assets::work_rows_for_asset(tx, &asset.asset_id)?;
            let receipts = assets::receipts_for_asset(tx, &asset.asset_id, 200)?;
            let attempt = current.map(|attempt| {
                serde_json::json!({
                    "attemptId": attempt.attempt_id,
                    "state": attempt.state,
                    "acknowledgedOffset": attempt.acknowledged_offset,
                    "declaredLength": attempt.declared_length,
                    "integrityGrade": attempt.integrity_grade,
                    "expiresAtMs": attempt.expires_at_ms,
                })
            });
            Ok(serde_json::json!({
                "asset": {
                    "assetId": asset.asset_id,
                    "intentId": asset.intent_id,
                    "intentName": asset.intent_name,
                    "ownerPrincipal": asset.owner_principal,
                    "availability": asset.availability,
                    "deliveryProfile": asset.delivery_profile,
                    "readAccess": asset.read_access,
                    "primaryRenditionId": asset.primary_rendition_id,
                    "lifecycleGeneration": asset.lifecycle_generation,
                    "policyGeneration": asset.policy_generation,
                    "createdAtMs": asset.created_at_ms,
                    "updatedAtMs": asset.updated_at_ms,
                    "digest": view.digest,
                    "digestAlgorithm": view.digest_algorithm,
                    "integrityGrade": view.integrity_grade,
                },
                "currentAttempt": attempt,
                "renditions": renditions.iter().map(|rendition| serde_json::json!({
                    "renditionId": rendition.rendition_id,
                    "variantKey": rendition.variant_key,
                    "state": rendition.state,
                    "blobId": rendition.blob_id,
                })).collect::<Vec<_>>(),
                "referenceEdges": edges.iter().map(|edge| serde_json::json!({
                    "table": edge.table_name,
                    "rowId": edge.row_id,
                    "fieldPath": edge.field_path,
                })).collect::<Vec<_>>(),
                "accounting": {
                    "reservedBytes": accounting.reserved_bytes,
                    "settledBytes": accounting.settled_bytes,
                    "openAttempts": accounting.open_attempts_app,
                },
                "workRows": work.iter().map(|row| serde_json::json!({
                    "workId": row.work_id,
                    "kind": row.kind,
                    "state": row.state,
                    "attemptCount": row.attempt_count,
                    "retryCeiling": row.retry_ceiling,
                    "nextEligibleAtMs": row.next_eligible_at_ms,
                    "deadlineAtMs": row.deadline_at_ms,
                })).collect::<Vec<_>>(),
                "receipts": receipts,
            }))
        })
    }

    pub(super) fn asset_host_list(
        &mut self,
        state: Option<assets::AssetAvailability>,
    ) -> SnapbackResult<Value> {
        self.asset_reads_transaction(|tx| {
            let records = assets::assets_in_state(tx, state, 200)?;
            Ok(serde_json::json!({
                "assets": records.iter().map(|asset| serde_json::json!({
                    "assetId": asset.asset_id,
                    "intentName": asset.intent_name,
                    "ownerPrincipal": asset.owner_principal,
                    "availability": asset.availability,
                    "updatedAtMs": asset.updated_at_ms,
                })).collect::<Vec<_>>(),
            }))
        })
    }

    pub(super) fn asset_strict_read_probe(
        &mut self,
        schema: &SchemaManifest,
        caller: Option<&str>,
        asset_id: &str,
    ) -> SnapbackResult<()> {
        self.asset_reads_transaction(|tx| {
            let asset = assets::load_asset(tx, asset_id)?.ok_or_else(asset_unknown(asset_id))?;
            if asset.availability == assets::AssetAvailability::Deleted {
                return Err(asset_unknown(asset_id)());
            }
            let decision = super::asset_read_authorized(schema, tx, caller, &asset)?;
            if !decision.authorized {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_FORBIDDEN",
                    "assets",
                    "this asset is not readable by the caller",
                ));
            }
            if asset.availability != assets::AssetAvailability::Ready {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_NOT_READY",
                    "assets",
                    "the asset has no deliverable bytes yet",
                ));
            }
            Ok(())
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn asset_deliver_strict(
        &mut self,
        schema: &SchemaManifest,
        caller: Option<&str>,
        store: &Arc<dyn crate::assets_store::AssetStore>,
        asset_id: &str,
        variant: &str,
        max_width: Option<u64>,
        range_header: Option<&str>,
        now: u64,
    ) -> SnapbackResult<AssetDeliveryOutcome> {
        self.asset_reads_transaction(|tx| {
            let asset = assets::load_asset(tx, asset_id)?.ok_or_else(asset_unknown(asset_id))?;
            if asset.availability == assets::AssetAvailability::Deleted {
                return Err(asset_unknown(asset_id)());
            }
            let decision = super::asset_read_authorized(schema, tx, caller, &asset)?;
            if !decision.authorized {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_FORBIDDEN",
                    "assets",
                    "this asset is not readable by the caller",
                ));
            }
            if asset.availability != assets::AssetAvailability::Ready {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_NOT_READY",
                    "assets",
                    "the asset has no deliverable bytes yet",
                ));
            }
            asset_deliver_from(
                tx,
                store,
                &asset,
                variant,
                max_width,
                range_header,
                "private-strict",
                "private, no-store".to_owned(),
                now,
            )
        })
    }

    pub(super) fn asset_signed_url_width_probe(
        &mut self,
        schema: &SchemaManifest,
        caller: Option<&str>,
        asset_id: &str,
    ) -> SnapbackResult<()> {
        self.asset_reads_transaction(|tx| {
            let asset = assets::load_asset(tx, asset_id)?
                .filter(|asset| asset.availability != assets::AssetAvailability::Deleted)
                .ok_or_else(asset_signed_url_forbidden)?;
            let decision = super::asset_read_authorized(schema, tx, caller, &asset)?;
            if !decision.authorized {
                return Err(asset_signed_url_forbidden());
            }
            if asset.delivery_profile != assets::AssetDeliveryProfile::PrivateSigned {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_DELIVERY_PROFILE_UNSUPPORTED",
                    "assets",
                    "this asset's declared delivery profile does not issue signed URLs",
                ));
            }
            Ok(())
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn asset_signed_url_issue(
        &mut self,
        schema: &SchemaManifest,
        caller: Option<&str>,
        asset_id: &str,
        issued_variant: &str,
        validate_declared_variant: bool,
        ttl: u64,
        now: u64,
    ) -> SnapbackResult<assets::AssetSignedUrlIssueResponseV1> {
        self.asset_reads_transaction(|tx| {
            let asset = assets::load_asset(tx, asset_id)?
                .filter(|asset| asset.availability != assets::AssetAvailability::Deleted)
                .ok_or_else(asset_signed_url_forbidden)?;
            let decision = super::asset_read_authorized(schema, tx, caller, &asset)?;
            if !decision.authorized {
                return Err(asset_signed_url_forbidden());
            }
            if asset.delivery_profile != assets::AssetDeliveryProfile::PrivateSigned {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_DELIVERY_PROFILE_UNSUPPORTED",
                    "assets",
                    "this asset's declared delivery profile does not issue signed URLs",
                ));
            }
            // @ref LLP 0210#d2--issuance-defaults-and-typed-refusals — the
            // declared keys are metadata, so enumerate only after the read
            // policy has authorized this caller.
            if validate_declared_variant {
                let intent_json =
                    assets::load_intent_artifact(tx, &asset.intent_id, asset.policy_generation)?
                        .ok_or_else(|| {
                            SnapbackError::error(
                                "SNAPBACK_ASSET_RECORD_INVALID",
                                "assets",
                                "the asset's admitted upload-intent artifact is unavailable",
                            )
                        })?;
                let intent: crate::manifest::AssetUploadIntentDefinition =
                    serde_json::from_str(&intent_json).map_err(|_| {
                        SnapbackError::error(
                            "SNAPBACK_ASSET_RECORD_INVALID",
                            "assets",
                            "the asset's admitted upload-intent artifact is invalid",
                        )
                    })?;
                let mut variants = vec!["primary".to_owned()];
                if let Some(image) = intent.image {
                    for variant in image.variants {
                        if !variants.contains(&variant.key) {
                            variants.push(variant.key);
                        }
                    }
                }
                if !variants.iter().any(|variant| variant == issued_variant) {
                    return Err(SnapbackError::error(
                        "SNAPBACK_ASSET_VARIANT_UNKNOWN",
                        "assets",
                        format!(
                            "variant {issued_variant} is not declared; choose one of {}",
                            variants.join(", ")
                        ),
                    )
                    .with_details(serde_json::json!({
                        "requestedVariant": issued_variant,
                        "variants": variants,
                    })));
                }
            }
            if asset.availability != assets::AssetAvailability::Ready {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_NOT_READY",
                    "assets",
                    "the asset has no deliverable bytes yet",
                ));
            }
            let grantee = caller.unwrap_or("anonymous");
            let expires_at_ms = now.saturating_add(ttl);
            let key = assets::active_signing_key(tx, now)?;
            let token = assets::mint_signed_url_token(
                &key,
                asset_id,
                issued_variant,
                grantee,
                asset.lifecycle_generation,
                expires_at_ms,
            );
            assets::write_receipt(
                tx,
                &asset_receipt(
                    &asset.asset_id.clone(),
                    assets::AssetReceiptEventV1::SignedUrlIssued,
                    &asset.asset_id,
                    None,
                    now,
                    serde_json::json!({
                        "variant": issued_variant,
                        "expiresAtMs": expires_at_ms,
                    }),
                ),
            )?;
            Ok(assets::AssetSignedUrlIssueResponseV1 {
                url: format!("/assets/signed/{asset_id}/{issued_variant}?token={token}"),
                variant: issued_variant.to_owned(),
                expires_at_ms,
            })
        })
    }

    pub(super) fn asset_deliver_signed(
        &mut self,
        store: &Arc<dyn crate::assets_store::AssetStore>,
        asset_id: &str,
        variant: &str,
        token: &str,
        range_header: Option<&str>,
        now: u64,
    ) -> SnapbackResult<AssetDeliveryOutcome> {
        self.asset_reads_transaction(|tx| {
            let asset = assets::load_asset(tx, asset_id)?.ok_or_else(asset_unknown(asset_id))?;
            if asset.availability == assets::AssetAvailability::Deleted {
                return Err(asset_unknown(asset_id)());
            }
            if asset.delivery_profile != assets::AssetDeliveryProfile::PrivateSigned {
                return Err(asset_unknown(asset_id)());
            }
            match assets::validate_signed_url_token(
                tx,
                token,
                asset_id,
                variant,
                asset.lifecycle_generation,
                now,
            )? {
                assets::SignedTokenOutcome::Valid => {}
                assets::SignedTokenOutcome::Expired => {
                    return Err(SnapbackError::error(
                        "SNAPBACK_ASSET_SIGNATURE_EXPIRED",
                        "assets",
                        "the signed URL's bearer window has passed; request a fresh issuance",
                    ));
                }
                assets::SignedTokenOutcome::Invalid => {
                    return Err(SnapbackError::error(
                        "SNAPBACK_ASSET_SIGNATURE_INVALID",
                        "assets",
                        "the signed URL does not validate",
                    ));
                }
            }
            if asset.availability != assets::AssetAvailability::Ready {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_NOT_READY",
                    "assets",
                    "the asset has no deliverable bytes yet",
                ));
            }
            let remaining_s = token
                .split('.')
                .nth(2)
                .and_then(|part| part.parse::<u64>().ok())
                .map(|expires| expires.saturating_sub(now) / 1000)
                .unwrap_or(0);
            asset_deliver_from(
                tx,
                store,
                &asset,
                variant,
                None,
                range_header,
                "private-signed",
                format!("private, max-age={remaining_s}"),
                now,
            )
        })
    }

    pub(super) fn asset_public_width_probe(&mut self, asset_id: &str) -> SnapbackResult<()> {
        self.asset_reads_transaction(|tx| {
            let masked = asset_unknown(asset_id);
            let asset = assets::load_asset(tx, asset_id)?.ok_or_else(&masked)?;
            if asset.availability != assets::AssetAvailability::Ready
                || asset.delivery_profile != assets::AssetDeliveryProfile::PublicImmutable
            {
                return Err(masked());
            }
            Ok(())
        })
    }

    pub(super) fn asset_deliver_public(
        &mut self,
        store: &Arc<dyn crate::assets_store::AssetStore>,
        asset_id: &str,
        variant: &str,
        range_header: Option<&str>,
        now: u64,
    ) -> SnapbackResult<AssetDeliveryOutcome> {
        self.asset_reads_transaction(|tx| {
            let masked = asset_unknown(asset_id);
            let asset = assets::load_asset(tx, asset_id)?.ok_or_else(&masked)?;
            if asset.availability != assets::AssetAvailability::Ready
                || asset.delivery_profile != assets::AssetDeliveryProfile::PublicImmutable
            {
                return Err(masked());
            }
            asset_deliver_from(
                tx,
                store,
                &asset,
                variant,
                None,
                range_header,
                "public-immutable",
                "public, max-age=31536000, immutable".to_owned(),
                now,
            )
        })
    }

    pub(super) fn asset_rotate_signing_key(&mut self, now: u64) -> SnapbackResult<Value> {
        self.asset_reads_transaction(|tx| {
            assets::rotate_signing_key(tx, now)?;
            assets::write_receipt(
                tx,
                &assets::AssetReceiptV1 {
                    receipt_id: crate::ids::mint_time_ordered(crate::ids::Kind::Receipt),
                    operation_lineage: "signing-key-rotation".to_owned(),
                    event: assets::AssetReceiptEventV1::SigningKeyRotated,
                    asset_id: None,
                    attempt_id: None,
                    at_ms: now,
                    details: serde_json::json!({ "scope": "instance" }),
                },
            )?;
            Ok(serde_json::json!({ "rotated": true }))
        })
    }

    pub(super) fn asset_delete(
        &mut self,
        caller: Option<&str>,
        asset_id: &str,
        now: u64,
        crash: Option<fn() -> SnapbackError>,
    ) -> SnapbackResult<Option<String>> {
        self.asset_reads_transaction(|tx| {
            let mut asset =
                assets::load_asset(tx, asset_id)?.ok_or_else(asset_unknown(asset_id))?;
            if asset.availability == assets::AssetAvailability::Deleted {
                return Ok(None);
            }
            if caller != Some(asset.owner_principal.as_str()) {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_FORBIDDEN",
                    "assets",
                    "only the owner may delete this asset",
                ));
            }
            if !assets::load_edges_for_asset(tx, asset_id)?.is_empty() {
                return Err(SnapbackError::error(
                    "SNAPBACK_ASSET_REFERENCED",
                    "assets",
                    "typed references to this asset remain; clear them first",
                ));
            }
            let staging = asset_delete_cascade(tx, &mut asset, "explicit-delete", now)?;
            if let Some(crash) = crash {
                return Err(crash());
            }
            Ok(staging)
        })
    }

    pub(super) fn asset_delete_result(&mut self, asset_id: &str) -> SnapbackResult<Value> {
        self.asset_reads_transaction(|tx| {
            let asset = assets::load_asset(tx, asset_id)?.ok_or_else(asset_unknown(asset_id))?;
            Ok(serde_json::json!({
                "assetId": asset.asset_id,
                "availability": asset.availability,
                "lifecycleGeneration": asset.lifecycle_generation,
            }))
        })
    }
}

#[cfg(test)]
impl LocalDatabase {
    fn test_asset_receipt_jsons_containing(&mut self, needle: &str) -> SnapbackResult<Vec<String>> {
        self.asset_reads_transaction(|tx| {
            let mut statement =
                tx.prepare("SELECT record_json FROM _snapback_asset_receipts_v1")?;
            let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
            Ok(rows
                .filter_map(|row| row.ok())
                .filter(|json| json.contains(needle))
                .collect())
        })
    }

    fn test_asset_load_pair(
        &mut self,
        first: &str,
        second: &str,
    ) -> SnapbackResult<(assets::AssetRecordV1, assets::AssetRecordV1)> {
        self.asset_reads_transaction(|tx| {
            Ok((
                assets::load_asset(tx, first)?.expect("first asset exists"),
                assets::load_asset(tx, second)?.expect("second asset exists"),
            ))
        })
    }

    fn test_asset_record_count(&mut self) -> SnapbackResult<u64> {
        self.asset_reads_transaction(|tx| {
            Ok(tx.query_row(
                "SELECT COUNT(*) FROM _snapback_asset_records_v1",
                [],
                |row| row.get(0),
            )?)
        })
    }

    fn test_asset_record_count_by_id(&mut self, asset_id: &str) -> SnapbackResult<u64> {
        self.asset_reads_transaction(|tx| {
            Ok(tx.query_row(
                "SELECT COUNT(*) FROM _snapback_asset_records_v1 WHERE asset_id = ?1",
                [asset_id],
                |row| row.get(0),
            )?)
        })
    }

    fn test_asset_and_attempt_counts(&mut self) -> SnapbackResult<(u64, u64)> {
        self.asset_reads_transaction(|tx| {
            let asset_count = tx.query_row(
                "SELECT COUNT(*) FROM _snapback_asset_records_v1",
                [],
                |row| row.get(0),
            )?;
            let attempt_count = tx.query_row(
                "SELECT COUNT(*) FROM _snapback_asset_attempts_v1",
                [],
                |row| row.get(0),
            )?;
            Ok((asset_count, attempt_count))
        })
    }

    fn test_asset_set_attempt_expiry(
        &mut self,
        attempt_id: &str,
        expires_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.asset_reads_transaction(|tx| {
            let mut attempt = assets::load_attempt(tx, attempt_id)?.expect("attempt exists");
            attempt.expires_at_ms = expires_at_ms;
            assets::store_attempt(tx, &attempt)
        })
    }

    fn test_asset_expired_receipt_count(&mut self, attempt_id: &str) -> SnapbackResult<u64> {
        self.asset_reads_transaction(|tx| {
            Ok(tx.query_row(
                "SELECT COUNT(*) FROM _snapback_asset_receipts_v1
                 WHERE attempt_id = ?1 AND event = 'attempt-expired'",
                [attempt_id],
                |row| row.get(0),
            )?)
        })
    }

    fn test_asset_edges_for_row(
        &mut self,
        table: &str,
        row_id: &str,
    ) -> SnapbackResult<Vec<assets::AssetReferenceEdgeV1>> {
        self.asset_reads_transaction(|tx| assets::load_edges_for_row(tx, table, row_id))
    }

    fn test_asset_edges_for_asset(
        &mut self,
        asset_id: &str,
    ) -> SnapbackResult<Vec<assets::AssetReferenceEdgeV1>> {
        self.asset_reads_transaction(|tx| assets::load_edges_for_asset(tx, asset_id))
    }

    fn test_asset_receipts_for_asset(
        &mut self,
        asset_id: &str,
        limit: usize,
    ) -> SnapbackResult<Vec<assets::AssetReceiptV1>> {
        self.asset_reads_transaction(|tx| assets::receipts_for_asset(tx, asset_id, limit))
    }

    fn test_asset_callback_log_count(&mut self) -> SnapbackResult<u64> {
        self.asset_reads_transaction(|tx| {
            Ok(tx.query_row("SELECT COUNT(*) FROM callback_log", [], |row| row.get(0))?)
        })
    }

    fn test_asset_posts_count(&mut self) -> SnapbackResult<u64> {
        self.asset_reads_transaction(|tx| {
            Ok(tx.query_row("SELECT COUNT(*) FROM posts", [], |row| row.get(0))?)
        })
    }

    fn test_asset_work_rows(
        &mut self,
        asset_id: &str,
    ) -> SnapbackResult<Vec<assets::AssetWorkRowV1>> {
        self.asset_reads_transaction(|tx| assets::work_rows_for_asset(tx, asset_id))
    }

    #[allow(clippy::too_many_arguments)]
    fn test_asset_enqueue_work_with_params(
        &mut self,
        kind: &str,
        asset_id: &str,
        attempt_id: Option<&str>,
        generation: u64,
        now: u64,
        params: Option<Value>,
    ) -> SnapbackResult<String> {
        self.asset_reads_transaction(|tx| {
            assets::enqueue_work_with_params(
                tx, kind, asset_id, attempt_id, generation, now, params,
            )
        })
    }

    fn test_asset_enqueue_work(
        &mut self,
        kind: &str,
        asset_id: &str,
        attempt_id: Option<&str>,
        generation: u64,
        now: u64,
    ) -> SnapbackResult<String> {
        self.asset_reads_transaction(|tx| {
            assets::enqueue_work(tx, kind, asset_id, attempt_id, generation, now)
        })
    }

    fn test_asset_load_work_row(
        &mut self,
        work_id: &str,
    ) -> SnapbackResult<assets::AssetWorkRowV1> {
        self.asset_reads_transaction(|tx| {
            Ok(assets::load_work_row(tx, work_id)?.expect("work row exists"))
        })
    }

    fn test_asset_mark_work_claimed(&mut self, work_id: &str, now: u64) -> SnapbackResult<()> {
        self.asset_reads_transaction(|tx| {
            let mut row = assets::load_work_row(tx, work_id)?.expect("row exists");
            row.lease_owner = Some("crashed-runner".to_owned());
            row.lease_expires_at_ms = Some(now.saturating_sub(1));
            row.next_eligible_at_ms = now.saturating_sub(1);
            assets::transition_work(tx, &mut row, assets::AssetWorkState::Claimed, now)
        })
    }

    fn test_asset_age_work_deadline(
        &mut self,
        work_id: &str,
        deadline_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.asset_reads_transaction(|tx| {
            let mut row = assets::load_work_row(tx, work_id)?.expect("row exists");
            row.deadline_at_ms = deadline_at_ms;
            assets::update_work_row(tx, &row)
        })
    }

    fn test_asset_transition_deleted(&mut self, asset_id: &str, now: u64) -> SnapbackResult<()> {
        self.asset_reads_transaction(|tx| {
            let mut asset = assets::load_asset(tx, asset_id)?.expect("asset exists");
            assets::transition_asset(tx, &mut asset, assets::AssetAvailability::Deleted, now)
        })
    }

    fn test_asset_read_decision_dependencies(
        &mut self,
        schema: &SchemaManifest,
        caller: Option<&str>,
        asset_id: &str,
    ) -> SnapbackResult<Vec<CapturedReadDependency>> {
        self.asset_reads_transaction(|tx| {
            let asset = assets::load_asset(tx, asset_id)?.expect("asset exists");
            let decision = super::asset_read_authorized(schema, tx, caller, &asset)?;
            assert!(!decision.authorized);
            Ok(decision.dependencies)
        })
    }

    fn test_asset_read_dependencies_moved(
        &mut self,
        schema: &SchemaManifest,
        caller: Option<&str>,
        asset_id: &str,
        captured: &[CapturedReadDependency],
    ) -> SnapbackResult<bool> {
        self.asset_reads_transaction(|tx| {
            let asset = assets::load_asset(tx, asset_id)?.expect("asset exists");
            super::asset_read_dependencies_moved(schema, tx, caller, &asset, captured)
        })
    }

    fn test_asset_receipt_events(&mut self, asset_id: &str) -> SnapbackResult<Vec<String>> {
        self.asset_reads_transaction(|tx| {
            let mut statement = tx.prepare(
                "SELECT event FROM _snapback_asset_receipts_v1
                 WHERE asset_id = ?1 ORDER BY at_ms, receipt_id",
            )?;
            Ok(statement
                .query_map([asset_id], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?)
        })
    }

    fn test_asset_published_records(
        &mut self,
        rendition_id: &str,
        app_id: &str,
    ) -> SnapbackResult<(
        assets::AssetRenditionRecordV1,
        assets::AssetBlobLive,
        Vec<String>,
        assets::AssetAccounting,
    )> {
        self.asset_reads_transaction(|tx| {
            let rendition = assets::load_rendition(tx, rendition_id)?.expect("rendition row");
            let blob = assets::load_blob_live(tx, &rendition.blob_id)?.expect("blob row");
            let mut statement = tx.prepare("SELECT state FROM _snapback_asset_publications_v1")?;
            let states = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            let accounting = assets::asset_accounting(tx, app_id)?;
            Ok((rendition, blob, states, accounting))
        })
    }

    fn test_asset_attempt_and_record(
        &mut self,
        attempt_id: &str,
        asset_id: &str,
    ) -> SnapbackResult<(assets::AssetAttemptRecordV1, assets::AssetRecordV1)> {
        self.asset_reads_transaction(|tx| {
            Ok((
                assets::load_attempt(tx, attempt_id)?.expect("attempt exists"),
                assets::load_asset(tx, asset_id)?.expect("asset exists"),
            ))
        })
    }

    fn test_asset_dedup_facts(
        &mut self,
        app_id: &str,
    ) -> SnapbackResult<(u64, u64, assets::AssetAccounting, u64)> {
        self.asset_reads_transaction(|tx| {
            let rows =
                tx.query_row("SELECT COUNT(*) FROM _snapback_asset_blobs_v1", [], |row| {
                    row.get(0)
                })?;
            let refcount = tx.query_row(
                "SELECT reference_count FROM _snapback_asset_blobs_v1",
                [],
                |row| row.get(0),
            )?;
            let accounting = assets::asset_accounting(tx, app_id)?;
            let cleanup = tx.query_row(
                "SELECT COUNT(*) FROM _snapback_asset_work_ledger_v1
                 WHERE kind = 'condemned-object-cleanup'",
                [],
                |row| row.get(0),
            )?;
            Ok((rows, refcount, accounting, cleanup))
        })
    }

    fn test_asset_seed_condemned_identity(
        &mut self,
        record: &assets::AssetBlobRecordV1,
    ) -> SnapbackResult<()> {
        self.asset_reads_transaction(|tx| {
            assets::insert_blob(tx, record, 1)?;
            assets::release_blob_reference(tx, &record.blob_id, 2)?;
            assert!(assets::condemn_blob_if_unreferenced(
                tx,
                &record.blob_id,
                3
            )?);
            Ok(())
        })
    }

    fn test_asset_condemned_race_facts(&mut self) -> SnapbackResult<(u64, u64, u64)> {
        self.asset_reads_transaction(|tx| {
            let live = tx.query_row(
                "SELECT COUNT(*) FROM _snapback_asset_blobs_v1 WHERE condemned = 0",
                [],
                |row| row.get(0),
            )?;
            let condemned = tx.query_row(
                "SELECT COUNT(*) FROM _snapback_asset_blobs_v1 WHERE condemned = 1",
                [],
                |row| row.get(0),
            )?;
            let orphans = tx.query_row(
                "SELECT COUNT(*) FROM _snapback_asset_publications_v1
                 WHERE state = 'condemned'",
                [],
                |row| row.get(0),
            )?;
            Ok((live, condemned, orphans))
        })
    }

    fn test_asset_plant_missing_row_witness(
        &mut self,
        attempt_id: &str,
        witness: &Value,
    ) -> SnapbackResult<()> {
        self.asset_reads_transaction(|tx| {
            let mut attempt = assets::load_attempt(tx, attempt_id)?.expect("attempt");
            attempt.admission.witness = witness.clone();
            assets::store_attempt(tx, &attempt)
        })
    }

    fn test_asset_insert_phantom(&mut self, version: u64) -> SnapbackResult<()> {
        self.asset_reads_transaction(|tx| {
            tx.execute(
                "UPDATE _snapback_version SET version = MAX(version, ?1) WHERE id = 1",
                [version],
            )?;
            tx.execute(
                "INSERT INTO profiles (_id, _version, _createdAt, _updatedAt, name)
                 VALUES ('phantom_1', ?1, 1, 1, 'ghost')",
                [version],
            )?;
            Ok(())
        })
    }

    fn test_asset_load_attempt(
        &mut self,
        attempt_id: &str,
    ) -> SnapbackResult<assets::AssetAttemptRecordV1> {
        self.asset_reads_transaction(|tx| {
            Ok(assets::load_attempt(tx, attempt_id)?.expect("attempt exists"))
        })
    }

    fn test_asset_delete_intent_artifacts(&mut self) -> SnapbackResult<u64> {
        self.asset_reads_transaction(|tx| {
            Ok(tx.execute("DELETE FROM _snapback_asset_intent_artifacts_v1", [])? as u64)
        })
    }

    fn test_asset_generation(&mut self, intent_id: &str) -> SnapbackResult<(Option<String>, u64)> {
        self.asset_reads_transaction(|tx| {
            Ok(tx.query_row(
                "SELECT implementation_hash, generation
                 FROM _snapback_asset_intent_generations_v1
                 WHERE intent_id = ?1",
                [intent_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?)
        })
    }

    fn test_asset_simulate_legacy_carrier(&mut self, attempt_id: &str) -> SnapbackResult<()> {
        self.asset_reads_transaction(|tx| {
            let mut attempt = assets::load_attempt(tx, attempt_id)?.expect("attempt");
            attempt.admission.implementation_hash = None;
            assets::store_attempt(tx, &attempt)?;
            tx.execute(
                "UPDATE _snapback_asset_intent_generations_v1
                 SET implementation_hash = NULL WHERE intent_id = ?1",
                [&attempt.intent_id],
            )?;
            Ok(())
        })
    }

    fn test_asset_generation_number(&mut self, intent_id: &str) -> SnapbackResult<u64> {
        self.asset_reads_transaction(|tx| {
            Ok(tx.query_row(
                "SELECT generation FROM _snapback_asset_intent_generations_v1
                 WHERE intent_id = ?1",
                [intent_id],
                |row| row.get(0),
            )?)
        })
    }

    fn test_asset_intent_artifact_count(&mut self) -> SnapbackResult<u64> {
        self.asset_reads_transaction(|tx| {
            Ok(tx.query_row(
                "SELECT COUNT(*) FROM _snapback_asset_intent_artifacts_v1",
                [],
                |row| row.get(0),
            )?)
        })
    }

    fn test_asset_intent_reclaimed_receipt_count(&mut self) -> SnapbackResult<u64> {
        self.asset_reads_transaction(|tx| {
            Ok(tx.query_row(
                "SELECT COUNT(*) FROM _snapback_asset_receipts_v1
                 WHERE event = 'intent-artifact-reclaimed' AND asset_id = ''",
                [],
                |row| row.get(0),
            )?)
        })
    }

    fn test_asset_load_rendition_by_variant(
        &mut self,
        asset_id: &str,
        key: &str,
    ) -> SnapbackResult<Option<assets::AssetRenditionRecordV1>> {
        self.asset_reads_transaction(|tx| assets::load_rendition_by_variant(tx, asset_id, key))
    }

    fn test_asset_load_rendition(
        &mut self,
        rendition_id: &str,
    ) -> SnapbackResult<Option<assets::AssetRenditionRecordV1>> {
        self.asset_reads_transaction(|tx| assets::load_rendition(tx, rendition_id))
    }

    fn test_asset_load_blob(
        &mut self,
        blob_id: &str,
    ) -> SnapbackResult<Option<assets::AssetBlobRecordV1>> {
        self.asset_reads_transaction(|tx| assets::load_blob(tx, blob_id))
    }

    fn test_asset_live_blob_count(&mut self) -> SnapbackResult<u64> {
        self.asset_reads_transaction(|tx| {
            Ok(tx.query_row(
                "SELECT COUNT(*) FROM _snapback_asset_blobs_v1 WHERE condemned = 0",
                [],
                |row| row.get(0),
            )?)
        })
    }

    fn test_asset_insert_rendition(
        &mut self,
        rendition: &assets::AssetRenditionRecordV1,
    ) -> SnapbackResult<()> {
        self.asset_reads_transaction(|tx| assets::insert_rendition(tx, rendition))
    }

    fn test_asset_switch_variant_pointer_now(
        &mut self,
        rendition: &assets::AssetRenditionRecordV1,
    ) -> SnapbackResult<assets::AssetVariantSwitchOutcome> {
        self.asset_reads_transaction(|tx| {
            assets::switch_variant_pointer(tx, rendition, test_now_millis())
        })
    }

    fn test_asset_rendition_and_refcount(
        &mut self,
        rendition_id: &str,
        blob_id: &str,
    ) -> SnapbackResult<(assets::AssetRenditionRecordV1, u64)> {
        self.asset_reads_transaction(|tx| {
            let rendition = assets::load_rendition(tx, rendition_id)?.expect("rendition exists");
            let count = tx.query_row(
                "SELECT reference_count FROM _snapback_asset_blobs_v1 WHERE blob_id = ?1",
                [blob_id],
                |row| row.get(0),
            )?;
            Ok((rendition, count))
        })
    }

    fn test_asset_mint_expired_signed_url_token(
        &mut self,
        asset_id: &str,
    ) -> SnapbackResult<String> {
        self.asset_reads_transaction(|tx| {
            let asset = assets::load_asset(tx, asset_id)?.expect("asset exists");
            let key = assets::active_signing_key(tx, test_now_millis())?;
            Ok(assets::mint_signed_url_token(
                &key,
                asset_id,
                "primary",
                "user_a",
                asset.lifecycle_generation,
                test_now_millis().saturating_sub(1_000),
            ))
        })
    }

    fn test_asset_mint_stale_generation_signed_url_token(
        &mut self,
        asset_id: &str,
    ) -> SnapbackResult<String> {
        self.asset_reads_transaction(|tx| {
            let asset = assets::load_asset(tx, asset_id)?.expect("asset exists");
            let key = assets::active_signing_key(tx, test_now_millis())?;
            Ok(assets::mint_signed_url_token(
                &key,
                asset_id,
                "primary",
                "user_a",
                asset.lifecycle_generation + 1,
                test_now_millis() + 60_000,
            ))
        })
    }

    fn test_asset_receipt_count_for_asset_event(
        &mut self,
        asset_id: &str,
        event: &str,
    ) -> SnapbackResult<u64> {
        self.asset_reads_transaction(|tx| {
            Ok(tx.query_row(
                "SELECT COUNT(*) FROM _snapback_asset_receipts_v1
                 WHERE asset_id = ?1 AND event = ?2",
                rusqlite::params![asset_id, event],
                |row| row.get(0),
            )?)
        })
    }

    fn test_asset_accounting(&mut self, app_id: &str) -> SnapbackResult<assets::AssetAccounting> {
        self.asset_reads_transaction(|tx| assets::asset_accounting(tx, app_id))
    }

    fn test_asset_post_delete_facts(&mut self, asset_id: &str) -> SnapbackResult<(String, u64)> {
        self.asset_reads_transaction(|tx| {
            let asset = assets::load_asset(tx, asset_id)?.expect("asset row");
            let refs = tx.query_row(
                "SELECT reference_count FROM _snapback_asset_blobs_v1 WHERE condemned = 0",
                [],
                |row| row.get(0),
            )?;
            Ok((
                serde_json::to_value(asset.availability)
                    .expect("availability serializes")
                    .as_str()
                    .expect("availability string")
                    .to_owned(),
                refs,
            ))
        })
    }

    fn test_asset_highest_live_refcount(&mut self) -> SnapbackResult<u64> {
        self.asset_reads_transaction(|tx| {
            Ok(tx.query_row(
                "SELECT reference_count FROM _snapback_asset_blobs_v1
                 WHERE reference_count > 0 ORDER BY reference_count DESC LIMIT 1",
                [],
                |row| row.get(0),
            )?)
        })
    }

    fn test_asset_availability_and_rendition_state(
        &mut self,
        asset_id: &str,
    ) -> SnapbackResult<(Value, Value)> {
        self.asset_reads_transaction(|tx| {
            let asset = assets::load_asset(tx, asset_id)?.expect("asset");
            let renditions = assets::renditions_for_asset(tx, asset_id)?;
            Ok((
                serde_json::to_value(asset.availability).expect("availability serializes"),
                serde_json::to_value(renditions[0].state).expect("state serializes"),
            ))
        })
    }
}

#[cfg(test)]
fn test_now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Narrow typed access to asset delivery, inspection, host-operation, and
/// deletion storage operations.
///
/// @ref LLP 0225#1-ownership-map — asset services enter the storage
/// kernel through typed operations instead of a raw SQLite transaction.
pub struct AssetReadsKernel<'a> {
    db: &'a mut LocalDatabase,
}

impl<'a> AssetReadsKernel<'a> {
    pub(super) fn new(db: &'a mut LocalDatabase) -> Self {
        Self { db }
    }

    pub fn attempt_for_caller(
        &mut self,
        caller: Option<&str>,
        attempt_id: &str,
        now: u64,
    ) -> SnapbackResult<(assets::AssetAttemptRecordV1, Option<String>)> {
        self.db.asset_attempt_for_caller(caller, attempt_id, now)
    }

    pub fn load_asset(&mut self, asset_id: &str) -> SnapbackResult<Option<assets::AssetRecordV1>> {
        self.db.asset_load_record(asset_id)
    }

    pub fn require_asset(&mut self, asset_id: &str) -> SnapbackResult<assets::AssetRecordV1> {
        self.db.asset_require_record(asset_id)
    }

    pub fn record_inspect(
        &mut self,
        schema: &SchemaManifest,
        caller: Option<&str>,
        asset_id: &str,
    ) -> SnapbackResult<Value> {
        self.db.asset_record_inspect(schema, caller, asset_id)
    }

    pub fn record_projection(
        &mut self,
        schema: &SchemaManifest,
        caller: Option<&str>,
        asset_id: &str,
    ) -> SnapbackResult<(Vec<Value>, Vec<CapturedReadDependency>)> {
        self.db.asset_record_projection(schema, caller, asset_id)
    }

    pub fn capture_export_cut(
        &mut self,
        app_id: &str,
        now: u64,
    ) -> SnapbackResult<crate::assets_cut::AssetCutCapture> {
        self.db.asset_capture_export_cut(app_id, now)
    }

    pub fn record_cut_exported(&mut self, now: u64, summary: &Value) -> SnapbackResult<()> {
        self.db.asset_record_cut_exported(now, summary)
    }

    pub fn record_cut_import_validated(&mut self, now: u64, summary: &Value) -> SnapbackResult<()> {
        self.db.asset_record_cut_import_validated(now, summary)
    }

    pub fn apply_import_cut(
        &mut self,
        manifest: &crate::assets_cut::AssetCutManifestV1,
        fresh_keys: &[String],
        store_kind: &str,
        now: u64,
        summary: &Value,
    ) -> SnapbackResult<()> {
        self.db
            .asset_apply_import_cut(manifest, fresh_keys, store_kind, now, summary)
    }

    pub fn seed_fixture_existing(
        &mut self,
        fixture_id: &str,
        source_digest: &str,
    ) -> SnapbackResult<Option<String>> {
        self.db
            .asset_seed_fixture_existing(fixture_id, source_digest)
    }

    pub fn seed_fixture_upsert(
        &mut self,
        mapping: &assets::SeedFixtureMappingV1,
    ) -> SnapbackResult<()> {
        self.db.asset_seed_fixture_upsert(mapping)
    }

    pub fn host_inspect(
        &mut self,
        schema: &SchemaManifest,
        caller: Option<&str>,
        asset_id: &str,
    ) -> SnapbackResult<Value> {
        self.db.asset_host_inspect(schema, caller, asset_id)
    }

    pub fn host_list(&mut self, state: Option<assets::AssetAvailability>) -> SnapbackResult<Value> {
        self.db.asset_host_list(state)
    }

    pub fn strict_read_probe(
        &mut self,
        schema: &SchemaManifest,
        caller: Option<&str>,
        asset_id: &str,
    ) -> SnapbackResult<()> {
        self.db.asset_strict_read_probe(schema, caller, asset_id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn deliver_strict(
        &mut self,
        schema: &SchemaManifest,
        caller: Option<&str>,
        store: &Arc<dyn crate::assets_store::AssetStore>,
        asset_id: &str,
        variant: &str,
        max_width: Option<u64>,
        range_header: Option<&str>,
        now: u64,
    ) -> SnapbackResult<AssetDeliveryOutcome> {
        self.db.asset_deliver_strict(
            schema,
            caller,
            store,
            asset_id,
            variant,
            max_width,
            range_header,
            now,
        )
    }

    pub fn signed_url_width_probe(
        &mut self,
        schema: &SchemaManifest,
        caller: Option<&str>,
        asset_id: &str,
    ) -> SnapbackResult<()> {
        self.db
            .asset_signed_url_width_probe(schema, caller, asset_id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn signed_url_issue(
        &mut self,
        schema: &SchemaManifest,
        caller: Option<&str>,
        asset_id: &str,
        issued_variant: &str,
        validate_declared_variant: bool,
        ttl: u64,
        now: u64,
    ) -> SnapbackResult<assets::AssetSignedUrlIssueResponseV1> {
        self.db.asset_signed_url_issue(
            schema,
            caller,
            asset_id,
            issued_variant,
            validate_declared_variant,
            ttl,
            now,
        )
    }

    pub fn deliver_signed(
        &mut self,
        store: &Arc<dyn crate::assets_store::AssetStore>,
        asset_id: &str,
        variant: &str,
        token: &str,
        range_header: Option<&str>,
        now: u64,
    ) -> SnapbackResult<AssetDeliveryOutcome> {
        self.db
            .asset_deliver_signed(store, asset_id, variant, token, range_header, now)
    }

    pub fn public_width_probe(&mut self, asset_id: &str) -> SnapbackResult<()> {
        self.db.asset_public_width_probe(asset_id)
    }

    pub fn deliver_public(
        &mut self,
        store: &Arc<dyn crate::assets_store::AssetStore>,
        asset_id: &str,
        variant: &str,
        range_header: Option<&str>,
        now: u64,
    ) -> SnapbackResult<AssetDeliveryOutcome> {
        self.db
            .asset_deliver_public(store, asset_id, variant, range_header, now)
    }

    pub fn rotate_signing_key(&mut self, now: u64) -> SnapbackResult<Value> {
        self.db.asset_rotate_signing_key(now)
    }

    pub fn delete(
        &mut self,
        caller: Option<&str>,
        asset_id: &str,
        now: u64,
        crash: Option<fn() -> SnapbackError>,
    ) -> SnapbackResult<Option<String>> {
        self.db.asset_delete(caller, asset_id, now, crash)
    }

    pub fn delete_result(&mut self, asset_id: &str) -> SnapbackResult<Value> {
        self.db.asset_delete_result(asset_id)
    }
}

#[cfg(test)]
impl<'a> AssetReadsKernel<'a> {
    pub fn receipt_jsons_containing(&mut self, needle: &str) -> SnapbackResult<Vec<String>> {
        self.db.test_asset_receipt_jsons_containing(needle)
    }

    pub fn load_pair(
        &mut self,
        first: &str,
        second: &str,
    ) -> SnapbackResult<(assets::AssetRecordV1, assets::AssetRecordV1)> {
        self.db.test_asset_load_pair(first, second)
    }

    pub fn record_count(&mut self) -> SnapbackResult<u64> {
        self.db.test_asset_record_count()
    }

    pub fn record_count_by_id(&mut self, asset_id: &str) -> SnapbackResult<u64> {
        self.db.test_asset_record_count_by_id(asset_id)
    }

    pub fn asset_and_attempt_counts(&mut self) -> SnapbackResult<(u64, u64)> {
        self.db.test_asset_and_attempt_counts()
    }

    pub fn set_attempt_expiry(
        &mut self,
        attempt_id: &str,
        expires_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.db
            .test_asset_set_attempt_expiry(attempt_id, expires_at_ms)
    }

    pub fn expired_receipt_count(&mut self, attempt_id: &str) -> SnapbackResult<u64> {
        self.db.test_asset_expired_receipt_count(attempt_id)
    }

    pub fn edges_for_row(
        &mut self,
        table: &str,
        row_id: &str,
    ) -> SnapbackResult<Vec<assets::AssetReferenceEdgeV1>> {
        self.db.test_asset_edges_for_row(table, row_id)
    }

    pub fn edges_for_asset(
        &mut self,
        asset_id: &str,
    ) -> SnapbackResult<Vec<assets::AssetReferenceEdgeV1>> {
        self.db.test_asset_edges_for_asset(asset_id)
    }

    pub fn receipts_for_asset(
        &mut self,
        asset_id: &str,
        limit: usize,
    ) -> SnapbackResult<Vec<assets::AssetReceiptV1>> {
        self.db.test_asset_receipts_for_asset(asset_id, limit)
    }

    pub fn callback_log_count(&mut self) -> SnapbackResult<u64> {
        self.db.test_asset_callback_log_count()
    }

    pub fn posts_count(&mut self) -> SnapbackResult<u64> {
        self.db.test_asset_posts_count()
    }

    pub fn work_rows(&mut self, asset_id: &str) -> SnapbackResult<Vec<assets::AssetWorkRowV1>> {
        self.db.test_asset_work_rows(asset_id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn enqueue_work_with_params(
        &mut self,
        kind: &str,
        asset_id: &str,
        attempt_id: Option<&str>,
        generation: u64,
        now: u64,
        params: Option<Value>,
    ) -> SnapbackResult<String> {
        self.db.test_asset_enqueue_work_with_params(
            kind, asset_id, attempt_id, generation, now, params,
        )
    }

    pub fn enqueue_work(
        &mut self,
        kind: &str,
        asset_id: &str,
        attempt_id: Option<&str>,
        generation: u64,
        now: u64,
    ) -> SnapbackResult<String> {
        self.db
            .test_asset_enqueue_work(kind, asset_id, attempt_id, generation, now)
    }

    pub fn load_work_row(&mut self, work_id: &str) -> SnapbackResult<assets::AssetWorkRowV1> {
        self.db.test_asset_load_work_row(work_id)
    }

    pub fn mark_work_claimed(&mut self, work_id: &str, now: u64) -> SnapbackResult<()> {
        self.db.test_asset_mark_work_claimed(work_id, now)
    }

    pub fn age_work_deadline(&mut self, work_id: &str, deadline_at_ms: u64) -> SnapbackResult<()> {
        self.db
            .test_asset_age_work_deadline(work_id, deadline_at_ms)
    }

    pub fn transition_deleted(&mut self, asset_id: &str, now: u64) -> SnapbackResult<()> {
        self.db.test_asset_transition_deleted(asset_id, now)
    }

    pub fn read_decision_dependencies(
        &mut self,
        schema: &SchemaManifest,
        caller: Option<&str>,
        asset_id: &str,
    ) -> SnapbackResult<Vec<CapturedReadDependency>> {
        self.db
            .test_asset_read_decision_dependencies(schema, caller, asset_id)
    }

    pub fn read_dependencies_moved(
        &mut self,
        schema: &SchemaManifest,
        caller: Option<&str>,
        asset_id: &str,
        captured: &[CapturedReadDependency],
    ) -> SnapbackResult<bool> {
        self.db
            .test_asset_read_dependencies_moved(schema, caller, asset_id, captured)
    }

    pub fn receipt_events(&mut self, asset_id: &str) -> SnapbackResult<Vec<String>> {
        self.db.test_asset_receipt_events(asset_id)
    }

    pub fn published_records(
        &mut self,
        rendition_id: &str,
        app_id: &str,
    ) -> SnapbackResult<(
        assets::AssetRenditionRecordV1,
        assets::AssetBlobLive,
        Vec<String>,
        assets::AssetAccounting,
    )> {
        self.db.test_asset_published_records(rendition_id, app_id)
    }

    pub fn attempt_and_record(
        &mut self,
        attempt_id: &str,
        asset_id: &str,
    ) -> SnapbackResult<(assets::AssetAttemptRecordV1, assets::AssetRecordV1)> {
        self.db.test_asset_attempt_and_record(attempt_id, asset_id)
    }

    pub fn dedup_facts(
        &mut self,
        app_id: &str,
    ) -> SnapbackResult<(u64, u64, assets::AssetAccounting, u64)> {
        self.db.test_asset_dedup_facts(app_id)
    }

    pub fn seed_condemned_identity(
        &mut self,
        record: &assets::AssetBlobRecordV1,
    ) -> SnapbackResult<()> {
        self.db.test_asset_seed_condemned_identity(record)
    }

    pub fn condemned_race_facts(&mut self) -> SnapbackResult<(u64, u64, u64)> {
        self.db.test_asset_condemned_race_facts()
    }

    pub fn plant_missing_row_witness(
        &mut self,
        attempt_id: &str,
        witness: &Value,
    ) -> SnapbackResult<()> {
        self.db
            .test_asset_plant_missing_row_witness(attempt_id, witness)
    }

    pub fn insert_phantom(&mut self, version: u64) -> SnapbackResult<()> {
        self.db.test_asset_insert_phantom(version)
    }

    pub fn load_attempt(
        &mut self,
        attempt_id: &str,
    ) -> SnapbackResult<assets::AssetAttemptRecordV1> {
        self.db.test_asset_load_attempt(attempt_id)
    }

    pub fn delete_intent_artifacts(&mut self) -> SnapbackResult<u64> {
        self.db.test_asset_delete_intent_artifacts()
    }

    pub fn generation(&mut self, intent_id: &str) -> SnapbackResult<(Option<String>, u64)> {
        self.db.test_asset_generation(intent_id)
    }

    pub fn simulate_legacy_carrier(&mut self, attempt_id: &str) -> SnapbackResult<()> {
        self.db.test_asset_simulate_legacy_carrier(attempt_id)
    }

    pub fn generation_number(&mut self, intent_id: &str) -> SnapbackResult<u64> {
        self.db.test_asset_generation_number(intent_id)
    }

    pub fn intent_artifact_count(&mut self) -> SnapbackResult<u64> {
        self.db.test_asset_intent_artifact_count()
    }

    pub fn intent_reclaimed_receipt_count(&mut self) -> SnapbackResult<u64> {
        self.db.test_asset_intent_reclaimed_receipt_count()
    }

    pub fn load_rendition_by_variant(
        &mut self,
        asset_id: &str,
        key: &str,
    ) -> SnapbackResult<Option<assets::AssetRenditionRecordV1>> {
        self.db.test_asset_load_rendition_by_variant(asset_id, key)
    }

    pub fn load_rendition(
        &mut self,
        rendition_id: &str,
    ) -> SnapbackResult<Option<assets::AssetRenditionRecordV1>> {
        self.db.test_asset_load_rendition(rendition_id)
    }

    pub fn load_blob(
        &mut self,
        blob_id: &str,
    ) -> SnapbackResult<Option<assets::AssetBlobRecordV1>> {
        self.db.test_asset_load_blob(blob_id)
    }

    pub fn live_blob_count(&mut self) -> SnapbackResult<u64> {
        self.db.test_asset_live_blob_count()
    }

    pub fn insert_rendition(
        &mut self,
        rendition: &assets::AssetRenditionRecordV1,
    ) -> SnapbackResult<()> {
        self.db.test_asset_insert_rendition(rendition)
    }

    pub fn switch_variant_pointer_now(
        &mut self,
        rendition: &assets::AssetRenditionRecordV1,
    ) -> SnapbackResult<assets::AssetVariantSwitchOutcome> {
        self.db.test_asset_switch_variant_pointer_now(rendition)
    }

    pub fn rendition_and_refcount(
        &mut self,
        rendition_id: &str,
        blob_id: &str,
    ) -> SnapbackResult<(assets::AssetRenditionRecordV1, u64)> {
        self.db
            .test_asset_rendition_and_refcount(rendition_id, blob_id)
    }

    pub fn mint_expired_signed_url_token(&mut self, asset_id: &str) -> SnapbackResult<String> {
        self.db.test_asset_mint_expired_signed_url_token(asset_id)
    }

    pub fn mint_stale_generation_signed_url_token(
        &mut self,
        asset_id: &str,
    ) -> SnapbackResult<String> {
        self.db
            .test_asset_mint_stale_generation_signed_url_token(asset_id)
    }

    pub fn receipt_count_for_asset_event(
        &mut self,
        asset_id: &str,
        event: &str,
    ) -> SnapbackResult<u64> {
        self.db
            .test_asset_receipt_count_for_asset_event(asset_id, event)
    }

    pub fn accounting(&mut self, app_id: &str) -> SnapbackResult<assets::AssetAccounting> {
        self.db.test_asset_accounting(app_id)
    }

    pub fn post_delete_facts(&mut self, asset_id: &str) -> SnapbackResult<(String, u64)> {
        self.db.test_asset_post_delete_facts(asset_id)
    }

    pub fn highest_live_refcount(&mut self) -> SnapbackResult<u64> {
        self.db.test_asset_highest_live_refcount()
    }

    pub fn availability_and_rendition_state(
        &mut self,
        asset_id: &str,
    ) -> SnapbackResult<(Value, Value)> {
        self.db
            .test_asset_availability_and_rendition_state(asset_id)
    }
}
