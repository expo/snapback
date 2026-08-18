use super::*;

// ---------------------------------------------------------------------------
// Transactionally maintained projections (LLP 0080 §5)
// ---------------------------------------------------------------------------

fn projection_fanout_exceeded(detail: String) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_PROJECTION_FANOUT_EXCEEDED",
        "storage",
        format!(
            "the mutation exceeds an admitted projection capacity and is refused whole: {detail}"
        ),
    )
}

fn projection_invariant(detail: String) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_PROJECTION_MAINTENANCE_INVALID",
        "storage",
        format!("projection maintenance refused the mutation: {detail}"),
    )
}

/// The stored projection identity and its activation timestamp (LLP 0080
/// §5): assigned at first activation, persisted in `_snapback_meta`, and
/// revision-stable — the same output key owns the same row identity across
/// maintenance, rebuilds, and plan revisions.
fn ensure_projection_identity(
    tx: &Transaction<'_>,
    plan_id: &str,
    now_ms: u64,
) -> SnapbackResult<(String, u64)> {
    let identity_key = format!("projection_identity:{plan_id}");
    let activated_key = format!("projection_activated_at:{plan_id}");
    let existing: Option<String> = tx
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key = ?1",
            params![identity_key],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(identity) = existing {
        let activated: Option<String> = tx
            .query_row(
                "SELECT value FROM _snapback_meta WHERE key = ?1",
                params![activated_key],
                |row| row.get(0),
            )
            .optional()?;
        let activated = activated
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or_else(|| {
                projection_invariant(format!(
                    "stored activation timestamp for {plan_id} is missing or corrupt"
                ))
            })?;
        return Ok((identity, activated));
    }
    // 48-bit UUIDv7 range check (LLP 0081 §3) at assignment time.
    if now_ms >= (1 << 48) {
        return Err(projection_invariant(
            "activation timestamp exceeds the 48-bit UUIDv7 range".to_owned(),
        ));
    }
    let identity = crate::ids::mint_time_ordered(crate::ids::Kind::Projection);
    tx.execute(
        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)",
        params![identity_key, identity],
    )?;
    tx.execute(
        "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)",
        params![activated_key, now_ms.to_string()],
    )?;
    Ok((identity, now_ms))
}

/// The deterministic output-row `_id` (LLP 0080 §5): a domain-separated
/// digest of the stored projection identity plus the canonical output-key
/// bytes, mapped into LLP 0007's UUIDv7 shape with the time bits carrying
/// the identity's activation-timestamp constant — key-stable, so the same
/// output key owns the same row across maintenance and rebuilds.
fn projection_row_id(identity: &str, activated_at_ms: u64, key_bytes: &str) -> String {
    let digest = crate::rqs_contract::projection_row_digest(identity, key_bytes);
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[..6].copy_from_slice(&activated_at_ms.to_be_bytes()[2..8]);
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes).to_string()
}

/// The canonical output key of one root row, or a typed refusal when a key
/// component is null/absent (LLP 0080 §5: a null key component refuses the
/// mutation — the plan marked the fields immutable and total).
fn projection_root_key(
    plan: &crate::manifest::MaintainedProjectionPlan,
    id: &str,
    row: Option<&Map<String, Value>>,
) -> SnapbackResult<Option<Vec<Value>>> {
    use crate::manifest::ProjectionOutputKey;
    match &plan.output_key {
        ProjectionOutputKey::RootId => Ok(Some(vec![Value::String(id.to_owned())])),
        ProjectionOutputKey::RootUniqueIndex { fields, .. } => {
            let Some(row) = row else { return Ok(None) };
            let mut key = Vec::with_capacity(fields.len());
            for field in fields {
                match row.get(field) {
                    Some(value) if !value.is_null() => key.push(value.clone()),
                    _ => {
                        return Err(projection_invariant(format!(
                            "projection {} output-key component {}.{field} is null",
                            plan.id, plan.root
                        )));
                    }
                }
            }
            Ok(Some(key))
        }
    }
}

fn projection_key_bytes(key: &[Value]) -> SnapbackResult<String> {
    crate::rqs_contract::jcs(&Value::Array(key.to_vec()))
        .map_err(|_| projection_invariant("output-key bytes are not canonicalizable".to_owned()))
}

/// Receipt of one `RebuildMaintainedProjection` operation (the LLP 0081
/// minimal slice, local profile): the deterministic operation id, the plan
/// and streaming content digests, and the publication facts. Persisted in
/// `_snapback_meta` and consumed by verification witnesses.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionRebuildReceipt {
    pub operation_id: String,
    pub plan_digest: String,
    pub content_digest: String,
    pub row_count: usize,
    pub generation: u64,
    pub published_version: u64,
    pub cause: String,
    pub at_ms: u64,
}

/// Publication facts computed by repeatable projection materialization but
/// not yet made durable as the active generation's rebuild-skip oracle.
///
/// @ref LLP 0225#1-ownership-map — projection pins join the generation
///   record in the owning composite kernel transaction; materialized rows are
///   deliberately safe to commit earlier and rebuild after a crash.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingProjectionPublication {
    pub plan_id: String,
    pub plan_digest: String,
    pub receipt: ProjectionRebuildReceipt,
}

/// Publish projection pins and their verification witnesses in a caller-owned
/// kernel transaction. Keep these three upserts together: the plan digest is
/// the skip oracle, while generation and receipt are its proof facts.
pub(super) fn apply_projection_publication_in(
    tx: &Transaction<'_>,
    publications: &[PendingProjectionPublication],
) -> SnapbackResult<()> {
    for publication in publications {
        let upsert = |key: String, value: String| -> SnapbackResult<()> {
            tx.execute(
                "INSERT INTO _snapback_meta(key, value) VALUES(?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )?;
            Ok(())
        };
        upsert(
            digest_key_for_projection(&publication.plan_id),
            publication.plan_digest.clone(),
        )?;
        upsert(
            format!("projection_generation:{}", publication.plan_id),
            publication.receipt.generation.to_string(),
        )?;
        upsert(
            format!("projection_rebuild_receipt:{}", publication.plan_id),
            serde_json::to_string(&publication.receipt).map_err(|_| {
                projection_invariant("rebuild receipt does not serialize".to_owned())
            })?,
        )?;
    }
    Ok(())
}

pub(super) fn projection_plan_digest(
    plan: &crate::manifest::MaintainedProjectionPlan,
) -> SnapbackResult<String> {
    crate::rqs_contract::sha256_identity(
        &serde_json::to_value(plan)
            .map_err(|_| projection_invariant("projection plan does not serialize".to_owned()))?,
    )
    .map_err(|_| projection_invariant("projection plan is not canonicalizable".to_owned()))
}

impl LocalDatabase {
    /// Rebuild a maintained projection when its plan digest changed or it
    /// has never materialized; `Ok(None)` when the stored generation is
    /// already current. Activation calls this for every declared plan, so
    /// the §5 oracle holds from the first commit version a plan is active.
    pub fn rebuild_projection_if_stale(
        &mut self,
        plan: &crate::manifest::MaintainedProjectionPlan,
        cause: &str,
    ) -> SnapbackResult<Option<PendingProjectionPublication>> {
        let plan_digest = projection_plan_digest(plan)?;
        let digest_key = format!("projection_plan_digest:{}", plan.id);
        let stored: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM _snapback_meta WHERE key = ?1",
                params![digest_key],
                |row| row.get(0),
            )
            .optional()?;
        if stored.as_deref() == Some(plan_digest.as_str()) {
            return Ok(None);
        }
        self.rebuild_projection(plan, &plan_digest, cause).map(Some)
    }

    /// `RebuildMaintainedProjection` under the local exclusive barrier
    /// (LLP 0080 §5 / LLP 0081 minimal slice): one IMMEDIATE transaction is
    /// the barrier — the serialized writer fences every source write for
    /// the rebuild's duration, a crash at any point rolls back to the
    /// predecessor materialization whole. Publication is deliberately
    /// deferred to the owning generation or migration-journal transaction.
    /// The
    /// durable batch-cursor state machine, approval records with the full
    /// LLP 0072 audience, and the downtime ceiling land with the complete
    /// 0081 lane; this slice records a typed admission/receipt row and the
    /// streaming content digest under the split oracle.
    fn rebuild_projection(
        &mut self,
        plan: &crate::manifest::MaintainedProjectionPlan,
        plan_digest: &str,
        cause: &str,
    ) -> SnapbackResult<PendingProjectionPublication> {
        let _writer_token = self
            .writer_authority
            .enter(write_authority::LocalWriterLaneV1::ProjectionRebuild)?;
        crate::exec_guard::debug_assert_off_async_worker("a projection rebuild");
        let schema = self.schema.clone();
        let order_field_bounds = self.order_field_bounds.clone();
        let now_ms = now_millis();
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let publication = materialize_projection_in(
            &tx,
            &schema,
            order_field_bounds.as_ref(),
            plan,
            plan_digest,
            cause,
            now_ms,
        )?;
        tx.commit()?;
        Ok(publication)
    }
}

/// Materialize one projection inside a caller-owned kernel transaction.
/// Complete-pair activation uses this only when successor DDL or same-cut seed
/// makes pre-transaction materialization impossible; publication still occurs
/// later in that exact transaction through `apply_projection_publication_in`.
pub(super) fn materialize_projection_in(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    order_field_bounds: &BTreeMap<(String, String), u64>,
    plan: &crate::manifest::MaintainedProjectionPlan,
    plan_digest: &str,
    cause: &str,
    now_ms: u64,
) -> SnapbackResult<PendingProjectionPublication> {
    // Projection rebuild is its own row-writing primitive rather than an
    // ordinary handler write. Keep the identity-binding seal at that shared
    // primitive so every activation/rebuild caller is covered.
    super::enforce_identity_binding_write_seal(schema, &plan.output_table)?;
    let current_version = current_version_on(tx)?;
    let next_version = next_storage_version(current_version)?;
    let root_table = schema_table(schema, &plan.root)?;
    let output_table = schema_table(schema, &plan.output_table)?;
    let (identity, activated_at_ms) = ensure_projection_identity(tx, &plan.id, now_ms)?;

    // --- Enumerate every root; prove existing-data fan-out. -----------
    let mut desired: BTreeMap<String, (Vec<Value>, Map<String, Value>)> = BTreeMap::new();
    let mut references: BTreeMap<String, u32> = BTreeMap::new();
    let scan = QueryPlan {
        table_visibility: None,
        table: plan.root.clone(),
        filters: Vec::new(),
        membership_filters: Vec::new(),
        order: Vec::new(),
        limit: None,
        indexed_by: None,
    };
    let (sql, values) = build_query_sql(
        root_table,
        schema,
        &scan,
        &HandlerInput::default(),
        &BTreeMap::new(),
        None,
        now_ms,
        None,
        "projection/root-scan",
        None,
        None,
        false,
        None,
    )?;
    let mut statement = tx.prepare(&sql)?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut rows = statement.query(params_from_iter(values.iter()))?;
    let mut roots: Vec<Value> = Vec::new();
    while let Some(row) = rows.next()? {
        roots.push(row_to_document(row, root_table, &columns)?);
    }
    drop(rows);
    drop(statement);
    for root in &roots {
        // Pre-activation fan-out proof: every reverse-index entry for a
        // joined key consumes limit, admitted or not, so an existing
        // over-limit population refuses activation instead of leaving
        // the joined row permanently un-updatable.
        let joined_key = plan
            .join_on
            .iter()
            .map(|pair| match root.get(&pair.root_field) {
                Some(value) if !value.is_null() => Some(value.clone()),
                _ => None,
            })
            .collect::<Option<Vec<Value>>>();
        if let Some(joined_key) = joined_key {
            let count = references
                .entry(projection_key_bytes(&joined_key)?)
                .or_insert(0);
            *count += 1;
            if *count > plan.fan_out_limit {
                return Err(projection_fanout_exceeded(format!(
                    "existing data holds more than fanOutLimit {} references to one \
                         joined key of projection {}; activation is refused",
                    plan.fan_out_limit, plan.id
                )));
            }
        }
        let id = root
            .get("_id")
            .and_then(Value::as_str)
            .ok_or_else(|| projection_invariant("root row without _id".to_owned()))?;
        let filter_plan = QueryPlan {
            table_visibility: None,
            table: plan.root.clone(),
            filters: plan.root_filters.clone(),
            membership_filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            indexed_by: None,
        };
        if crate::live_matcher::row_matches_query_filters(
            &filter_plan,
            &HandlerInput::default(),
            root,
        ) != Some(true)
        {
            continue;
        }
        let Some(key) = projection_root_key(plan, id, root.as_object())? else {
            continue;
        };
        let Some(logical) = projection_logical_row(tx, schema, plan, root, now_ms)? else {
            continue;
        };
        desired.insert(projection_key_bytes(&key)?, (key, logical));
    }

    // --- Converge the output table; stream the content digest. --------
    let existing = {
        let scan = QueryPlan {
            table_visibility: None,
            table: plan.output_table.clone(),
            filters: Vec::new(),
            membership_filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            indexed_by: None,
        };
        let (sql, values) = build_query_sql(
            output_table,
            schema,
            &scan,
            &HandlerInput::default(),
            &BTreeMap::new(),
            None,
            now_ms,
            None,
            "projection/output-scan",
            None,
            None,
            false,
            None,
        )?;
        let mut statement = tx.prepare(&sql)?;
        let columns = statement
            .column_names()
            .into_iter()
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        let mut rows = statement.query(params_from_iter(values.iter()))?;
        let mut existing = Vec::new();
        while let Some(row) = rows.next()? {
            existing.push(row_to_document(row, output_table, &columns)?);
        }
        existing
    };
    let mut pending: BTreeMap<String, (&Vec<Value>, &Map<String, Value>)> = desired
        .iter()
        .map(|(bytes, (key, logical))| {
            let output_id = projection_row_id(&identity, activated_at_ms, bytes);
            (output_id, (key, logical))
        })
        .collect();
    let mut changed = false;
    for row in &existing {
        let Some(id) = row.get("_id").and_then(Value::as_str) else {
            continue;
        };
        match pending.remove(id) {
            None => {
                // Not in the rebuilt generation: remove.
                if delete_document(tx, output_table, id)? {
                    record_change(
                        tx,
                        next_version,
                        &output_table.name,
                        id,
                        ChangeOp::Delete,
                        None,
                        now_ms,
                    )?;
                    changed = true;
                }
            }
            Some((_, logical)) => {
                let unchanged = plan.projection.iter().all(|leaf| {
                    row.get(&leaf.name).cloned().unwrap_or(Value::Null)
                        == logical.get(&leaf.name).cloned().unwrap_or(Value::Null)
                });
                if !unchanged {
                    patch_document(
                        tx,
                        output_table,
                        id,
                        logical,
                        next_version,
                        now_ms,
                        order_field_bounds,
                    )?;
                    let document = get_document_from_tx(tx, output_table, id, next_version)?;
                    record_change(
                        tx,
                        next_version,
                        &output_table.name,
                        id,
                        ChangeOp::Update,
                        document.as_ref(),
                        now_ms,
                    )?;
                    changed = true;
                }
            }
        }
    }
    for (output_id, (_, logical)) in &pending {
        let document = insert_document(
            tx,
            output_table,
            output_id,
            logical,
            next_version,
            now_ms,
            order_field_bounds,
        )?;
        record_change(
            tx,
            next_version,
            &output_table.name,
            output_id,
            ChangeOp::Insert,
            Some(&document),
            now_ms,
        )?;
        changed = true;
    }

    // The streaming content digest under the split oracle: logical rows
    // (key + declared leaves) in canonical output-key byte order.
    // System fields are checked against their own deterministic rule by
    // the verification witnesses, never folded into this digest.
    let digest_rows: Vec<Value> = desired
        .iter()
        .map(|(_, (key, logical))| {
            json!({ "k": Value::Array(key.clone()), "r": Value::Object(logical.clone()) })
        })
        .collect();
    let content_digest = crate::rqs_contract::seq1_digest(&digest_rows)
        .map_err(|_| projection_invariant("rebuilt rows are not canonicalizable".to_owned()))?;

    // --- Compute publication facts; materialization commits alone. -----
    let generation_key = format!("projection_generation:{}", plan.id);
    let generation: u64 = tx
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key = ?1",
            params![generation_key],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0)
        + 1;
    // The minimal deterministic operation-id namespace: digest over the
    // plan digest and generation. The full LLP 0081 §3 UUIDv7 namespace
    // with conformance vectors lands with the plan-artifact ticket.
    let operation_digest =
        crate::rqs_contract::projection_row_digest(plan_digest, &format!("rebuild:{generation}"));
    let operation_id = format!(
        "rebuild_{}",
        operation_digest[..8]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    );
    let receipt = ProjectionRebuildReceipt {
        operation_id,
        plan_digest: plan_digest.to_owned(),
        content_digest,
        row_count: desired.len(),
        generation,
        published_version: if changed {
            next_version
        } else {
            current_version
        },
        cause: cause.to_owned(),
        at_ms: now_ms,
    };
    if changed {
        set_version(tx, next_version)?;
    }
    Ok(PendingProjectionPublication {
        plan_id: plan.id.clone(),
        plan_digest: plan_digest.to_owned(),
        receipt,
    })
}

impl LocalDatabase {
    /// The persisted receipt of the last rebuild of `plan_id`, if any.
    /// Consumed by the coupled-suite verification witnesses today; the
    /// operator-facing `snapback migrate verify` surface (the full 0081
    /// lane) is its production reader.
    pub fn projection_rebuild_receipt(
        &self,
        plan_id: &str,
    ) -> SnapbackResult<Option<ProjectionRebuildReceipt>> {
        let stored: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM _snapback_meta WHERE key = ?1",
                params![format!("projection_rebuild_receipt:{plan_id}")],
                |row| row.get(0),
            )
            .optional()?;
        Ok(match stored {
            Some(raw) => Some(serde_json::from_str(&raw).map_err(|_| {
                projection_invariant("stored rebuild receipt is corrupt".to_owned())
            })?),
            None => None,
        })
    }

    /// Recorded-per-slice compensation primitive for a future path that proves
    /// it cannot publish through its owning transaction. OQ3 leaves no current
    /// activation caller: materialization stays unpinned until either the
    /// raw-dev generation or complete-pair record commits with it.
    #[allow(dead_code)] // Reserved compensation seam for a future non-transactional activation path.
    pub fn clear_projection_plan_digests(
        &mut self,
        plan_ids: &[String],
    ) -> SnapbackResult<()> {
        if plan_ids.is_empty() {
            return Ok(());
        }
        let _writer_token = self
            .writer_authority
            .enter(write_authority::LocalWriterLaneV1::ProjectionRebuild)?;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        for plan_id in plan_ids.iter().collect::<BTreeSet<_>>() {
            tx.execute(
                "DELETE FROM _snapback_meta WHERE key = ?1",
                params![digest_key_for_projection(plan_id)],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

fn digest_key_for_projection(plan_id: &str) -> String {
    format!("projection_plan_digest:{plan_id}")
}

/// The logical output row of one admitted root under a maintained
/// projection (LLP 0080 §5): perform the declared unique join against the
/// current transaction state and project the declared leaves. `None` means
/// the plan admits no output row for this root (an inner join with a
/// missing or null-keyed joined row). Shared by same-transaction
/// maintenance and barrier rebuild so the two evaluators cannot drift.
fn projection_logical_row(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    plan: &crate::manifest::MaintainedProjectionPlan,
    root: &Value,
    now_ms: u64,
) -> SnapbackResult<Option<Map<String, Value>>> {
    use crate::manifest::{JoinKind, ProjectionSource};
    let root_join_key = plan
        .join_on
        .iter()
        .map(|pair| match root.get(&pair.root_field) {
            Some(value) if !value.is_null() => Some(value.clone()),
            _ => None,
        })
        .collect::<Option<Vec<Value>>>();
    let joined_row: Option<Value> = match root_join_key {
        None => None,
        Some(joined_key) => {
            let joined_table = schema_table(schema, &plan.joined)?;
            let filters: Vec<crate::manifest::FilterExpr> = plan
                .join_on
                .iter()
                .zip(&joined_key)
                .map(|(pair, value)| crate::manifest::FilterExpr {
                    field: pair.joined_field.clone(),
                    op: FilterOp::Eq,
                    value: ValueExpr::Literal(value.clone()),
                })
                .collect();
            let lookup = QueryPlan {
                table_visibility: None,
                table: plan.joined.clone(),
                filters,
                membership_filters: Vec::new(),
                order: Vec::new(),
                limit: Some(2),
                indexed_by: None,
            };
            let (sql, values) = build_query_sql(
                joined_table,
                schema,
                &lookup,
                &HandlerInput::default(),
                &BTreeMap::new(),
                None,
                now_ms,
                None,
                "projection/joined-lookup",
                Some(2),
                None,
                false,
                None,
            )?;
            let mut statement = tx.prepare(&sql)?;
            let columns = statement
                .column_names()
                .into_iter()
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>();
            let mut matched = statement.query(params_from_iter(values.iter()))?;
            let mut found: Vec<Value> = Vec::new();
            while let Some(row) = matched.next()? {
                found.push(row_to_document(row, joined_table, &columns)?);
            }
            if found.len() > 1 {
                return Err(SnapbackError::error(
                    "SNAPBACK_RELATIONAL_DUPLICATE_UNIQUE_KEY",
                    "storage",
                    format!(
                        "two joined rows in {} share the unique key during maintenance of \
                         projection {}",
                        plan.joined, plan.id
                    ),
                ));
            }
            found.into_iter().next()
        }
    };
    if joined_row.is_none() && matches!(plan.join_kind, JoinKind::Inner) {
        return Ok(None);
    }
    let mut fields = Map::new();
    for leaf in &plan.projection {
        let value = match &leaf.source {
            ProjectionSource::Literal(value) => value.clone(),
            ProjectionSource::RootField(field) => root.get(field).cloned().unwrap_or(Value::Null),
            ProjectionSource::JoinedField(field) => joined_row
                .as_ref()
                .and_then(|row| row.get(field).cloned())
                .unwrap_or(Value::Null),
        };
        fields.insert(leaf.name.clone(), value);
    }
    Ok(Some(fields))
}

#[derive(Clone, Copy)]
pub(super) enum ProjectionEffectCeiling {
    MutationV1,
    VersionedSeedV1,
    UnboundedPreview,
}

fn projection_effect_ceiling_error(
    ceiling: ProjectionEffectCeiling,
    direct_writes: usize,
    projection_writes: usize,
) -> Option<SnapbackError> {
    let total = match direct_writes.checked_add(projection_writes) {
        Some(total) => total,
        None => {
            return Some(match ceiling {
                ProjectionEffectCeiling::VersionedSeedV1 => SnapbackError::error(
                    "SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED",
                    "seed",
                    "versioned seed application-effect count overflowed",
                ),
                ProjectionEffectCeiling::MutationV1 | ProjectionEffectCeiling::UnboundedPreview => {
                    projection_invariant(
                        "projection application-effect count overflowed".to_owned(),
                    )
                }
            });
        }
    };
    match ceiling {
        ProjectionEffectCeiling::UnboundedPreview => None,
        ProjectionEffectCeiling::MutationV1 if total > 1024 => {
            Some(projection_fanout_exceeded(format!(
                "direct writes ({direct_writes}) plus projection writes \
                 ({projection_writes}) exceed the 1024-write mutation bound"
            )))
        }
        ProjectionEffectCeiling::VersionedSeedV1
            if total > crate::seed_identity::VERSIONED_SEED_MAX_EFFECTS_V1 =>
        {
            Some(SnapbackError::error(
                "SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED",
                "seed",
                format!(
                    "versioned seed exceeds the {}-effect ceiling",
                    crate::seed_identity::VERSIONED_SEED_MAX_EFFECTS_V1
                ),
            ))
        }
        _ => None,
    }
}

/// Same-transaction projection maintenance (LLP 0080 §5): close the
/// affected-key set over pre/post images, prove the reverse-index and
/// write-budget bounds, evaluate each affected output row exactly once
/// against the final transaction snapshot, and write only rows whose
/// logical bytes changed. The mutation either commits source and
/// projection together or commits neither.
#[allow(clippy::too_many_arguments)]
pub(super) fn maintain_projections_in_tx(
    tx: &Transaction<'_>,
    schema: &SchemaManifest,
    plans: &[crate::manifest::MaintainedProjectionPlan],
    changes: &mut Vec<ChangedRow>,
    pre_images: &BTreeMap<(String, String), Option<Map<String, Value>>>,
    next_version: u64,
    now_ms: u64,
    order_field_bounds: &BTreeMap<(String, String), u64>,
    effect_ceiling: ProjectionEffectCeiling,
) -> SnapbackResult<()> {
    use crate::manifest::ProjectionOutputKey;

    let direct_writes = changes.len();
    let mut projection_writes = 0_usize;

    for plan in plans {
        let touches_plan = changes[..direct_writes]
            .iter()
            .any(|change| change.table == plan.root || change.table == plan.joined);
        if !touches_plan {
            continue;
        }
        // Projection maintenance writes output rows directly in this
        // transaction. Seal its one shared primitive before identity/meta or
        // row effects so source and projection still refuse atomically.
        super::enforce_identity_binding_write_seal(schema, &plan.output_table)?;
        let root_table = schema_table(schema, &plan.root)?;
        let output_table = schema_table(schema, &plan.output_table)?;
        let (identity, activated_at_ms) = ensure_projection_identity(tx, &plan.id, now_ms)?;

        // --- Affected-key closure over pre and final post images. ---------
        let mut affected: BTreeMap<String, Vec<Value>> = BTreeMap::new();
        let mut admission_joined_keys: BTreeMap<String, Vec<Value>> = BTreeMap::new();
        let joined_key_of = |row: &Map<String, Value>| -> Option<Vec<Value>> {
            let mut key = Vec::with_capacity(plan.join_on.len());
            for pair in &plan.join_on {
                match row.get(&pair.joined_field) {
                    Some(value) if !value.is_null() => key.push(value.clone()),
                    _ => return None,
                }
            }
            Some(key)
        };
        let root_join_key_of = |row: &Map<String, Value>| -> Option<Vec<Value>> {
            let mut key = Vec::with_capacity(plan.join_on.len());
            for pair in &plan.join_on {
                match row.get(&pair.root_field) {
                    Some(value) if !value.is_null() => key.push(value.clone()),
                    _ => return None,
                }
            }
            Some(key)
        };

        for change in &changes[..direct_writes] {
            let pre = pre_images
                .get(&(change.table.clone(), change.id.clone()))
                .and_then(|pre| pre.as_ref());
            let post = change.row.as_ref().and_then(|row| row.as_object());
            if change.table == plan.root {
                let pre_key = projection_root_key(plan, &change.id, pre)?;
                let post_key = projection_root_key(plan, &change.id, post)?;
                // The plan marks output-key fields immutable: a committed
                // row whose key tuple moved refuses the whole mutation.
                if let (Some(pre_key), Some(post_key)) = (&pre_key, &post_key)
                    && matches!(plan.output_key, ProjectionOutputKey::RootUniqueIndex { .. })
                    && pre_key != post_key
                {
                    return Err(projection_invariant(format!(
                        "projection {} output-key fields are immutable; the mutation moved \
                         the key of {}/{}",
                        plan.id, plan.root, change.id
                    )));
                }
                for key in [pre_key, post_key].into_iter().flatten() {
                    affected.insert(projection_key_bytes(&key)?, key);
                }
                // A root insert or join-key change adds a reverse-index
                // reference; its joined key re-proves capacity below.
                if let Some(post) = post
                    && let Some(joined_key) = root_join_key_of(post)
                {
                    admission_joined_keys.insert(projection_key_bytes(&joined_key)?, joined_key);
                }
            }
            if change.table == plan.joined {
                for row in [pre, post].into_iter().flatten() {
                    if let Some(joined_key) = joined_key_of(row) {
                        admission_joined_keys
                            .insert(projection_key_bytes(&joined_key)?, joined_key);
                    }
                }
            }
        }

        // --- Reverse-index admission + joined-side affected roots. --------
        // The scan reads exactly the counted range: every reverse-index
        // entry for the joined key consumes limit, filtered-out roots
        // included, so the work is bounded by the proved quantity.
        for (_, joined_key) in admission_joined_keys {
            let filters: Vec<crate::manifest::FilterExpr> = plan
                .join_on
                .iter()
                .zip(&joined_key)
                .map(|(pair, value)| crate::manifest::FilterExpr {
                    field: pair.root_field.clone(),
                    op: FilterOp::Eq,
                    value: ValueExpr::Literal(value.clone()),
                })
                .collect();
            let scan = QueryPlan {
                table_visibility: None,
                table: plan.root.clone(),
                filters,
                membership_filters: Vec::new(),
                order: Vec::new(),
                limit: Some(plan.fan_out_limit as usize + 1),
                indexed_by: Some(plan.root_reverse_index.clone()),
            };
            let (sql, values) = build_query_sql(
                root_table,
                schema,
                &scan,
                &HandlerInput::default(),
                &BTreeMap::new(),
                None,
                now_ms,
                None,
                "projection/root-reverse-lookup",
                Some(plan.fan_out_limit as usize + 1),
                None,
                false,
                None,
            )?;
            let mut statement = tx.prepare(&sql)?;
            let columns = statement
                .column_names()
                .into_iter()
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>();
            let mut rows = statement.query(params_from_iter(values.iter()))?;
            let mut references = 0_usize;
            while let Some(row) = rows.next()? {
                references += 1;
                if references > plan.fan_out_limit as usize {
                    return Err(projection_fanout_exceeded(format!(
                        "joined key in projection {} would exceed fanOutLimit {}",
                        plan.id, plan.fan_out_limit
                    )));
                }
                let document = row_to_document(row, root_table, &columns)?;
                let id = document
                    .get("_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| projection_invariant("root row without _id".to_owned()))?;
                if let Some(key) = projection_root_key(plan, id, document.as_object())? {
                    affected.insert(projection_key_bytes(&key)?, key);
                }
            }
        }

        // --- Evaluate each affected key once against the final snapshot. --
        for (key_bytes, key) in affected {
            let root_row: Option<Value> = match &plan.output_key {
                ProjectionOutputKey::RootId => {
                    let Some(Value::String(id)) = key.first() else {
                        return Err(projection_invariant("malformed RootId key".to_owned()));
                    };
                    get_document_from_tx(tx, root_table, id, next_version)?
                }
                ProjectionOutputKey::RootUniqueIndex { fields, .. } => {
                    let filters: Vec<crate::manifest::FilterExpr> = fields
                        .iter()
                        .zip(&key)
                        .map(|(field, value)| crate::manifest::FilterExpr {
                            field: field.clone(),
                            op: FilterOp::Eq,
                            value: ValueExpr::Literal(value.clone()),
                        })
                        .collect();
                    let lookup = QueryPlan {
                        table_visibility: None,
                        table: plan.root.clone(),
                        filters,
                        membership_filters: Vec::new(),
                        order: Vec::new(),
                        limit: Some(1),
                        indexed_by: None,
                    };
                    let (sql, values) = build_query_sql(
                        root_table,
                        schema,
                        &lookup,
                        &HandlerInput::default(),
                        &BTreeMap::new(),
                        None,
                        now_ms,
                        None,
                        "projection/root-lookup",
                        Some(1),
                        None,
                        false,
                        None,
                    )?;
                    let mut statement = tx.prepare(&sql)?;
                    let columns = statement
                        .column_names()
                        .into_iter()
                        .map(ToOwned::to_owned)
                        .collect::<Vec<_>>();
                    let mut rows = statement.query(params_from_iter(values.iter()))?;
                    match rows.next()? {
                        Some(row) => Some(row_to_document(row, root_table, &columns)?),
                        None => None,
                    }
                }
            };
            // materializeAll admission: the non-security root filter, no
            // caller (visibility declarations constrain information flow,
            // not maintenance selection).
            let admitted_root = root_row.as_ref().filter(|row| {
                let filter_plan = QueryPlan {
                    table_visibility: None,
                    table: plan.root.clone(),
                    filters: plan.root_filters.clone(),
                    membership_filters: Vec::new(),
                    order: Vec::new(),
                    limit: None,
                    indexed_by: None,
                };
                crate::live_matcher::row_matches_query_filters(
                    &filter_plan,
                    &HandlerInput::default(),
                    row,
                ) == Some(true)
            });

            let logical: Option<Map<String, Value>> = match admitted_root {
                None => None,
                Some(root) => projection_logical_row(tx, schema, plan, root, now_ms)?,
            };

            let output_id = projection_row_id(&identity, activated_at_ms, &key_bytes);
            let existing = get_document_from_tx(tx, output_table, &output_id, next_version)?;
            let existing_logical = existing.as_ref().map(|row| {
                let mut fields = Map::new();
                for leaf in &plan.projection {
                    fields.insert(
                        leaf.name.clone(),
                        row.get(&leaf.name).cloned().unwrap_or(Value::Null),
                    );
                }
                fields
            });

            // The counted unit is a distinct output row whose bytes change:
            // unchanged recomputations issue no write and count nothing.
            let write = match (&existing_logical, &logical) {
                (None, None) => None,
                (Some(previous), Some(next)) if previous == next => None,
                (_, Some(next)) => Some(Some(next.clone())),
                (Some(_), None) => Some(None),
            };
            let Some(write) = write else { continue };
            projection_writes += 1;
            if let Some(error) =
                projection_effect_ceiling_error(effect_ceiling, direct_writes, projection_writes)
            {
                return Err(error);
            }
            match write {
                Some(next) => {
                    let changed_fields = changed_field_names(&next);
                    if existing.is_some() {
                        patch_document(
                            tx,
                            output_table,
                            &output_id,
                            &next,
                            next_version,
                            now_ms,
                            order_field_bounds,
                        )?;
                        let document =
                            get_document_from_tx(tx, output_table, &output_id, next_version)?;
                        record_change(
                            tx,
                            next_version,
                            &output_table.name,
                            &output_id,
                            ChangeOp::Update,
                            document.as_ref(),
                            now_ms,
                        )?;
                        changes.push(ChangedRow {
                            table: output_table.name.clone(),
                            id: output_id,
                            op: ChangeOp::Update,
                            row: document,
                            changed_fields,
                        });
                    } else {
                        let document = insert_document(
                            tx,
                            output_table,
                            &output_id,
                            &next,
                            next_version,
                            now_ms,
                            order_field_bounds,
                        )?;
                        record_change(
                            tx,
                            next_version,
                            &output_table.name,
                            &output_id,
                            ChangeOp::Insert,
                            Some(&document),
                            now_ms,
                        )?;
                        changes.push(ChangedRow {
                            table: output_table.name.clone(),
                            id: output_id,
                            op: ChangeOp::Insert,
                            row: Some(document),
                            changed_fields,
                        });
                    }
                }
                None => {
                    if delete_document(tx, output_table, &output_id)? {
                        record_change(
                            tx,
                            next_version,
                            &output_table.name,
                            &output_id,
                            ChangeOp::Delete,
                            None,
                            now_ms,
                        )?;
                        changes.push(ChangedRow {
                            table: output_table.name.clone(),
                            id: output_id,
                            op: ChangeOp::Delete,
                            row: existing,
                            changed_fields: Vec::new(),
                        });
                    }
                }
            }
        }
    }
    Ok(())
}
