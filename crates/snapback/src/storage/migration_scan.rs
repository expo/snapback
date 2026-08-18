use super::*;

// ---------------------------------------------------------------------------
// MigrationKeysetScanV1 (LLP 0081 §3)
// ---------------------------------------------------------------------------

#[cfg_attr(not(test), allow(dead_code))]
fn migration_plan_invalid(detail: String) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_MIGRATION_PLAN_INVALID",
        "storage",
        format!("migration keyset scan refused: {detail}"),
    )
}

#[cfg_attr(not(test), allow(dead_code))]
fn migration_precondition_failed(detail: String) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_MIGRATION_PRECONDITION_FAILED",
        "storage",
        format!("migration keyset scan precondition failed: {detail}"),
    )
}

fn is_migration_scan_false(value: &bool) -> bool {
    !*value
}

/// The closed per-batch ceilings a target enforces on the privileged scan
/// (LLP 0081 §3). These are the scan's OWN bounds — the scan is not the
/// application query surface and neither relaxes nor consumes LLP 0007's
/// 1,024-row query or 500-binding limits.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationScanCeilingsV1 {
    pub max_batch_rows: u32,
    pub max_batch_bytes: u64,
    pub max_batch_millis: u64,
}

/// Hard caps the local target enforces over any requested ceiling.
pub const MIGRATION_SCAN_MAX_BATCH_ROWS: u32 = 16_384;
pub const MIGRATION_SCAN_MAX_BATCH_BYTES: u64 = 64 * 1024 * 1024;
pub const MIGRATION_SCAN_MAX_BATCH_MILLIS: u64 = 60_000;

/// The closed validator facts a plan may request from the scan (LLP 0081
/// §3): the scan emits facts, never application rows.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum MigrationScanValidatorV1 {
    /// Count rows whose field is null or absent (`ValidateRequired`).
    NonNull { field: String },
    /// Count adjacent duplicate all-present keys (`ValidateUnique`). Sound
    /// only in the compound key's own order, so the scan requires these
    /// fields to lead the scan index in the same order. `field` remains the
    /// leading component for checkpoint compatibility.
    ///
    /// @ref LLP 0007#index-contract — optional unique keys participate only
    ///   when every component is present.
    Unique {
        field: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        additional_fields: Vec<String>,
        #[serde(
            default,
            rename = "whereApplicable",
            alias = "where_applicable",
            skip_serializing_if = "is_migration_scan_false"
        )]
        where_applicable: bool,
    },
}

/// Resumable per-validator state, persisted with the batch checkpoint.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum MigrationScanValidatorStateV1 {
    NonNull {
        field: String,
        violations: u64,
        /// First offending row ids (bounded sample for actionability).
        samples: Vec<String>,
    },
    Unique {
        field: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        additional_fields: Vec<String>,
        #[serde(
            default,
            rename = "whereApplicable",
            alias = "where_applicable",
            skip_serializing_if = "is_migration_scan_false"
        )]
        where_applicable: bool,
        duplicates: u64,
        samples: Vec<String>,
        /// The previous participating key at the batch boundary — adjacency
        /// carries across batches through this. A compound key is represented
        /// as a JSON array; the single-field legacy shape remains scalar.
        last: Option<Value>,
    },
}

#[cfg_attr(not(test), allow(dead_code))]
const MIGRATION_SCAN_SAMPLE_CAP: usize = 8;

/// One scan request: one declared table, an optional declared index (the
/// stable key order; `_id` order when absent), the requested closed facts,
/// optional `ContentDigestV1` streaming, and the batch ceilings.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationKeysetScanRequestV1 {
    pub table: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub validators: Vec<MigrationScanValidatorV1>,
    /// When present, the scan streams both `ContentDigestV1` stages —
    /// logical rows under the logical domain and system fields under the
    /// system domain — with this shared header.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<crate::rqs_contract::ContentDigestHeaderV1>,
    pub ceilings: MigrationScanCeilingsV1,
}

/// The serializable batch checkpoint the Wave-2 executor persists in its
/// journal: identity of the scan, the keyset boundary, cumulative
/// counters, resumable validator states, and the digest accumulators
/// (SHA-256 chaining state + counters, LLP 0081 §5).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationKeysetScanCheckpointV1 {
    pub version: String,
    pub table: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boundary: Option<KeysetAfter>,
    pub rows_scanned: u64,
    pub bytes_scanned: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub validators: Vec<MigrationScanValidatorStateV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logical_digest: Option<crate::rqs_contract::ContentDigestAccumulatorV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_digest: Option<crate::rqs_contract::ContentDigestAccumulatorV1>,
}

pub const MIGRATION_SCAN_CHECKPOINT_VERSION: &str = "migration-keyset-scan-checkpoint-v1";

/// One batch's outcome: the ceiling-bounded work done, whether the table
/// is exhausted, and the checkpoint to persist. Sealed digests are only
/// available once `done` (the trailer binds the total row count).
#[derive(Clone, Debug)]
pub struct MigrationKeysetScanBatch {
    pub batch_rows: u64,
    pub batch_bytes: u64,
    pub done: bool,
    pub checkpoint: MigrationKeysetScanCheckpointV1,
    /// `Some((logical, system))` exactly when `done` and the request
    /// streamed digests.
    pub sealed_digests: Option<(String, String)>,
}

#[cfg_attr(not(test), allow(dead_code))]
fn migration_scan_order(
    table: &TableManifest,
    index: Option<&str>,
) -> SnapbackResult<Vec<OrderExpr>> {
    let Some(index_name) = index else {
        return Ok(Vec::new());
    };
    let declared = table
        .indexes
        .iter()
        .find(|candidate| candidate.name == index_name)
        .ok_or_else(|| {
            migration_plan_invalid(format!(
                "index {index_name:?} is not declared on {}",
                table.name
            ))
        })?;
    for field in &declared.fields {
        ensure_orderable_field(table, field)?;
    }
    Ok(declared
        .fields
        .iter()
        .map(|field| OrderExpr {
            field: field.clone(),
            direction: OrderDirection::Asc,
            max_encoded_bytes: None,
        })
        .collect())
}

#[cfg_attr(not(test), allow(dead_code))]
fn migration_scan_initial_state(
    request: &MigrationKeysetScanRequestV1,
) -> SnapbackResult<MigrationKeysetScanCheckpointV1> {
    let header = request.digest.as_ref();
    Ok(MigrationKeysetScanCheckpointV1 {
        version: MIGRATION_SCAN_CHECKPOINT_VERSION.to_owned(),
        table: request.table.clone(),
        index: request.index.clone(),
        boundary: None,
        rows_scanned: 0,
        bytes_scanned: 0,
        validators: request
            .validators
            .iter()
            .map(|validator| match validator {
                MigrationScanValidatorV1::NonNull { field } => {
                    MigrationScanValidatorStateV1::NonNull {
                        field: field.clone(),
                        violations: 0,
                        samples: Vec::new(),
                    }
                }
                MigrationScanValidatorV1::Unique {
                    field,
                    additional_fields,
                    where_applicable,
                } => MigrationScanValidatorStateV1::Unique {
                    field: field.clone(),
                    additional_fields: additional_fields.clone(),
                    where_applicable: *where_applicable,
                    duplicates: 0,
                    samples: Vec::new(),
                    last: None,
                },
            })
            .collect(),
        logical_digest: header.map(|header| {
            crate::rqs_contract::ContentDigestStream::new(
                crate::rqs_contract::CONTENT_DIGEST_DOMAIN,
                header,
            )
            .checkpoint()
        }),
        system_digest: header.map(|header| {
            crate::rqs_contract::ContentDigestStream::new(
                crate::rqs_contract::CONTENT_DIGEST_SYSTEM_DOMAIN,
                header,
            )
            .checkpoint()
        }),
    })
}

#[cfg_attr(not(test), allow(dead_code))]
fn validate_migration_scan_request(
    schema: &SchemaManifest,
    request: &MigrationKeysetScanRequestV1,
) -> SnapbackResult<()> {
    let table = schema_table(schema, &request.table)?;
    let ceilings = &request.ceilings;
    if ceilings.max_batch_rows == 0
        || ceilings.max_batch_rows > MIGRATION_SCAN_MAX_BATCH_ROWS
        || ceilings.max_batch_bytes == 0
        || ceilings.max_batch_bytes > MIGRATION_SCAN_MAX_BATCH_BYTES
        || ceilings.max_batch_millis == 0
        || ceilings.max_batch_millis > MIGRATION_SCAN_MAX_BATCH_MILLIS
    {
        return Err(migration_plan_invalid(format!(
            "batch ceilings must be positive and within the target caps \
             (rows <= {MIGRATION_SCAN_MAX_BATCH_ROWS}, bytes <= \
             {MIGRATION_SCAN_MAX_BATCH_BYTES}, millis <= {MIGRATION_SCAN_MAX_BATCH_MILLIS})"
        )));
    }
    let order = migration_scan_order(table, request.index.as_deref())?;
    for validator in &request.validators {
        match validator {
            MigrationScanValidatorV1::NonNull { field } => {
                ensure_field_or_system(table, field)?;
            }
            MigrationScanValidatorV1::Unique {
                field,
                additional_fields,
                ..
            } => {
                let fields = std::iter::once(field)
                    .chain(additional_fields)
                    .collect::<Vec<_>>();
                for field in &fields {
                    ensure_field_or_system(table, field)?;
                }
                let leads = order
                    .iter()
                    .map(|expr| &expr.field)
                    .take(fields.len())
                    .eq(fields.iter().copied());
                if !leads {
                    return Err(migration_plan_invalid(format!(
                        "uniqueness over {fields:?} requires scanning an index that \
                         leads with those fields in the same order; adjacency is only \
                         sound in the compound key's own order"
                    )));
                }
            }
        }
    }
    Ok(())
}

/// One ceiling-bounded batch of the privileged migration scan (LLP 0081
/// §3): stable total key order (`index fields ASC NULLS LAST, _id ASC` —
/// the same totalization as every keyset surface), a checkpointed cursor,
/// closed validator facts, and optional `ContentDigestV1` streaming. Runs
/// against whatever connection the caller pins — the Wave-2 executor calls
/// it inside its own batch transaction.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn migration_keyset_scan_batch_on(
    conn: &Connection,
    schema: &SchemaManifest,
    request: &MigrationKeysetScanRequestV1,
    checkpoint: Option<&MigrationKeysetScanCheckpointV1>,
) -> SnapbackResult<MigrationKeysetScanBatch> {
    validate_migration_scan_request(schema, request)?;
    let table = schema_table(schema, &request.table)?;
    let order = migration_scan_order(table, request.index.as_deref())?;

    let mut state = match checkpoint {
        None => migration_scan_initial_state(request)?,
        Some(checkpoint) => {
            if checkpoint.version != MIGRATION_SCAN_CHECKPOINT_VERSION
                || checkpoint.table != request.table
                || checkpoint.index != request.index
            {
                return Err(migration_precondition_failed(
                    "checkpoint does not belong to this scan request".to_owned(),
                ));
            }
            checkpoint.clone()
        }
    };
    let mut logical_stream = state
        .logical_digest
        .as_ref()
        .map(|accumulator| {
            crate::rqs_contract::ContentDigestStream::resume(accumulator)
                .map_err(|reason| migration_precondition_failed(reason.to_owned()))
        })
        .transpose()?;
    let mut system_stream = state
        .system_digest
        .as_ref()
        .map(|accumulator| {
            crate::rqs_contract::ContentDigestStream::resume(accumulator)
                .map_err(|reason| migration_precondition_failed(reason.to_owned()))
        })
        .transpose()?;

    // Privileged SQL: the scan bypasses the application query surface (and
    // its membership-privacy fence) deliberately — it emits closed facts,
    // never application rows, and only the migration executor can reach it.
    let outer = quote_ident("__snapback_migration_scan")?;
    let mut sql = format!(
        "SELECT {outer}.* FROM {} AS {outer}",
        quote_ident(&table.name)?
    );
    let mut values: Vec<SqlValue> = Vec::new();
    if let Some(boundary) = &state.boundary {
        let mut bindings = 0_usize;
        let (clause, keyset_values) =
            build_keyset_after_sql(table, &order, boundary, &mut bindings)?;
        sql.push_str(" WHERE ");
        sql.push_str(&clause);
        values.extend(keyset_values);
    }
    let mut order_parts: Vec<String> = Vec::new();
    for expr in &order {
        order_parts.push(format!("{} ASC NULLS LAST", quote_ident(&expr.field)?));
    }
    order_parts.push("\"_id\" ASC".to_owned());
    sql.push_str(" ORDER BY ");
    sql.push_str(&order_parts.join(", "));
    sql.push_str(&format!(" LIMIT {}", request.ceilings.max_batch_rows));

    let started = std::time::Instant::now();
    let mut statement = conn.prepare(&sql)?;
    let columns = statement
        .column_names()
        .into_iter()
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    let mut rows = statement.query(params_from_iter(values.iter()))?;

    // A NonNull validator must observe and count its target NULLs. This is a
    // migration-fact exception only: all non-target fields and every ordinary
    // application read retain the strict declared representation decoder.
    //
    // @ref LLP 0081#3-typed-migration-steps — ValidateRequired emits bounded
    //   violation facts before MakeRequired; decoding cannot erase that fact.
    let staged_nullable_fields = request
        .validators
        .iter()
        .filter_map(|validator| match validator {
            MigrationScanValidatorV1::NonNull { field } => Some(field.as_str()),
            MigrationScanValidatorV1::Unique { .. } => None,
        })
        .collect::<Vec<_>>();

    let mut batch_rows = 0_u64;
    let mut batch_bytes = 0_u64;
    let mut fetched = 0_u32;
    let mut ceiling_stop = false;
    let mut last_row: Option<Value> = None;
    while let Some(row) = rows.next()? {
        fetched += 1;
        let document = row_to_document_with_staged_nullable_fields(
            row,
            table,
            &columns,
            &staged_nullable_fields,
        )?;
        let id = document
            .get("_id")
            .and_then(Value::as_str)
            .ok_or_else(|| migration_plan_invalid("scanned row without _id".to_owned()))?
            .to_owned();

        // Facts.
        for validator in &mut state.validators {
            match validator {
                MigrationScanValidatorStateV1::NonNull {
                    field,
                    violations,
                    samples,
                } => {
                    let value = document.get(field.as_str());
                    if value.is_none() || value.is_some_and(Value::is_null) {
                        *violations += 1;
                        if samples.len() < MIGRATION_SCAN_SAMPLE_CAP {
                            samples.push(id.clone());
                        }
                    }
                }
                MigrationScanValidatorStateV1::Unique {
                    field,
                    additional_fields,
                    where_applicable: _,
                    duplicates,
                    samples,
                    last,
                } => {
                    let values = std::iter::once(field.as_str())
                        .chain(additional_fields.iter().map(String::as_str))
                        .map(|field| {
                            document
                                .get(field)
                                .filter(|value| !value.is_null())
                                .cloned()
                        })
                        .collect::<Option<Vec<_>>>();
                    let value = values.map(|mut values| {
                        if values.len() == 1 {
                            values.pop().expect("one participating unique component")
                        } else {
                            Value::Array(values)
                        }
                    });
                    match (last.as_ref(), value.as_ref()) {
                        (Some(previous), Some(current)) if previous == current => {
                            *duplicates += 1;
                            if samples.len() < MIGRATION_SCAN_SAMPLE_CAP {
                                samples.push(id.clone());
                            }
                        }
                        _ => {}
                    }
                    *last = value;
                }
            }
        }

        // Digest streams: logical rows exclude the four system fields;
        // system fields stream separately under their own domain
        // (LLP 0081 §5). A value outside the canonical proof domain fails
        // closed rather than digesting approximately.
        if logical_stream.is_some() || system_stream.is_some() {
            let object = document
                .as_object()
                .ok_or_else(|| migration_plan_invalid("scanned row is not an object".to_owned()))?;
            let mut logical = Map::new();
            let mut system = Map::new();
            for (key, value) in object {
                if matches!(
                    key.as_str(),
                    "_id" | "_version" | "_createdAt" | "_updatedAt"
                ) {
                    system.insert(key.clone(), value.clone());
                } else {
                    logical.insert(key.clone(), value.clone());
                }
            }
            if let Some(stream) = logical_stream.as_mut() {
                stream.absorb_row(&Value::Object(logical)).map_err(|_| {
                    migration_plan_invalid(format!(
                        "row {id} of {} is outside the canonical proof domain",
                        table.name
                    ))
                })?;
            }
            if let Some(stream) = system_stream.as_mut() {
                stream.absorb_row(&Value::Object(system)).map_err(|_| {
                    migration_plan_invalid(format!(
                        "system fields of row {id} in {} are outside the canonical proof domain",
                        table.name
                    ))
                })?;
            }
        }

        batch_rows += 1;
        batch_bytes += serde_json::to_string(&document)
            .map(|serialized| serialized.len() as u64)
            .unwrap_or(0);
        last_row = Some(document);

        // Ceilings: every batch makes progress (at least one row) and then
        // stops at whichever ceiling trips first.
        if batch_bytes >= request.ceilings.max_batch_bytes
            || started.elapsed().as_millis() as u64 >= request.ceilings.max_batch_millis
        {
            ceiling_stop = true;
            break;
        }
    }

    if let Some(last) = &last_row {
        let entries = order
            .iter()
            .map(|expr| {
                (
                    expr.field.clone(),
                    last.get(&expr.field).cloned().unwrap_or(Value::Null),
                )
            })
            .collect();
        let id = last
            .get("_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        state.boundary = Some(KeysetAfter { entries, id });
    }
    state.rows_scanned += batch_rows;
    state.bytes_scanned += batch_bytes;
    state.logical_digest = logical_stream.as_ref().map(|stream| stream.checkpoint());
    state.system_digest = system_stream.as_ref().map(|stream| stream.checkpoint());

    let done = !ceiling_stop && fetched < request.ceilings.max_batch_rows;
    let sealed_digests = if done {
        match (logical_stream, system_stream) {
            (Some(logical), Some(system)) => Some((logical.finalize(), system.finalize())),
            _ => None,
        }
    } else {
        None
    };
    Ok(MigrationKeysetScanBatch {
        batch_rows,
        batch_bytes,
        done,
        checkpoint: state,
        sealed_digests,
    })
}

impl LocalDatabase {
    /// One ceiling-bounded batch of the privileged migration scan against a
    /// pinned read snapshot (LLP 0081 §3). The Wave-2 executor instead calls
    /// [`migration_keyset_scan_batch_on`] inside its own batch transaction.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn migration_keyset_scan_batch(
        &self,
        request: &MigrationKeysetScanRequestV1,
        checkpoint: Option<&MigrationKeysetScanCheckpointV1>,
    ) -> SnapbackResult<MigrationKeysetScanBatch> {
        self.query_reads_read()
            .with_pinned_read_view(|db| match db {
                DbRead::Pinned { conn, schema } => {
                    migration_keyset_scan_batch_on(conn, schema, request, checkpoint)
                }
                DbRead::Live(db) => {
                    migration_keyset_scan_batch_on(&db.conn, &db.schema, request, checkpoint)
                }
            })
    }

    /// Snapshot-pinned preview facts for LLP 0081's separately digested
    /// observation. Each current v1 plan step declares at most one read table;
    /// its row summary inspects no more than `max_affected_rows + 1` rows. The
    /// extra row is the bounded signal that the reviewed ceiling is already
    /// exceeded, without turning preview into an unbounded application scan.
    ///
    /// @ref LLP 0081#2-canonical-plan-and-approval — preview observations
    /// carry the target head and bounded aggregate preconditions from one
    /// snapshot, but never add authority to the sealed plan.
    pub(crate) fn migration_preview_observation_facts(
        &self,
        steps: &[crate::migration::MigrationStepRecord],
        max_affected_rows: u64,
    ) -> SnapbackResult<(u64, BTreeMap<String, u64>)> {
        self.query_reads_read().with_pinned_read_view(|view| {
            let head = view.current_version()?;
            let limit = max_affected_rows
                .saturating_add(1)
                .min(i64::MAX as u64) as i64;
            let mut table_rows = BTreeMap::<String, u64>::new();
            let mut precondition_rows = BTreeMap::new();
            for record in steps {
                let [table] = record.reads.as_slice() else {
                    // The v1 planner currently emits zero or one read table.
                    // A later multi-source step needs a versioned observation
                    // shape instead of collapsing several counts into one.
                    continue;
                };
                let rows = match table_rows.get(table) {
                    Some(rows) => *rows,
                    None => {
                        let _ = schema_table(view.schema(), table)?;
                        let quoted = quote_ident(table)?;
                        let observed: i64 = view.conn().query_row(
                            &format!(
                                "SELECT COUNT(*) FROM (SELECT 1 FROM {quoted} LIMIT ?1)"
                            ),
                            params![limit],
                            |row| row.get(0),
                        )?;
                        let rows = u64::try_from(observed).map_err(|_| {
                            SnapbackError::error(
                                "SNAPBACK_MIGRATION_PRECONDITION_FAILED",
                                "storage",
                                format!(
                                    "preview row summary for {table} was outside the non-negative integer domain"
                                ),
                            )
                        })?;
                        table_rows.insert(table.clone(), rows);
                        rows
                    }
                };
                precondition_rows.insert(record.id.clone(), rows);
            }
            Ok((head, precondition_rows))
        })
    }
}
