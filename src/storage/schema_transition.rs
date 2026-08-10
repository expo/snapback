use super::*;

// ---------------------------------------------------------------------------
// Schema-transition journal events (LLP 0081 §4's same-landing LLP 0007
// amendment): `schema-resync` and `rollback-resync` are first-class typed
// operations in the change-journal grammar. They ride `_snapback_changes`
// under the reserved pseudo-table name below, count toward the journal
// high-water exactly like a data operation (they are ordinary journal rows
// at their publication version), and the head/journal-cut equality holds
// across them unchanged. The vocabulary is closed: a row under the
// pseudo-table whose operation or payload does not decode is corruption,
// never an ignorable dialect.
// ---------------------------------------------------------------------------

/// The reserved journal pseudo-table for schema-transition events.
/// Application tables cannot collide (`validate_user_identifier` refuses the
/// `_snapback` prefix), and the per-table strict operation parser never
/// queries this name.
pub const SCHEMA_TRANSITION_JOURNAL_TABLE: &str = "_snapback_schema";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum SchemaTransitionKind {
    #[serde(rename = "schema-resync")]
    SchemaResync,
    #[serde(rename = "rollback-resync")]
    RollbackResync,
}

impl SchemaTransitionKind {
    pub const fn as_op(self) -> &'static str {
        match self {
            Self::SchemaResync => "schema-resync",
            Self::RollbackResync => "rollback-resync",
        }
    }

    pub fn from_op(op: &str) -> Option<Self> {
        match op {
            "schema-resync" => Some(Self::SchemaResync),
            "rollback-resync" => Some(Self::RollbackResync),
            _ => None,
        }
    }
}

/// The typed payload of one schema-transition event — the pinned amendment
/// vocabulary: operation identity, predecessor/successor schema hashes,
/// storage-generation identities, and the retention floor the publication
/// raised, plus the plan's compatibility posture (what the posture-aware
/// client handshake consumes). Strict: an unknown member is corruption.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchemaTransitionEventBodyV1 {
    pub operation_id: String,
    pub plan_id: String,
    pub predecessor_schema_hash: String,
    pub successor_schema_hash: String,
    pub predecessor_generation: u64,
    pub successor_generation: u64,
    pub retention_floor: u64,
    pub compatibility_posture: crate::migration::CompatibilityPosture,
}

/// One decoded schema-transition event: the journal row's kind, version,
/// and timestamp around the typed body.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SchemaTransitionEventV1 {
    pub kind: SchemaTransitionKind,
    pub version: u64,
    pub at_ms: u64,
    pub body: SchemaTransitionEventBodyV1,
}

fn schema_transition_corrupt(detail: String) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_STORAGE_VERSION_CORRUPT",
        "storage",
        format!("schema-transition journal event is corrupt: {detail}"),
    )
}

/// Append one typed schema-transition event at `version`. The caller's
/// publication transaction must also `set_version(version)` and raise the
/// retention floor to `version` — the constructor enforces the floor
/// equality so the amendment's "raised in the publication transaction"
/// clause cannot drift from the event's own claim.
pub(crate) fn record_schema_transition_event(
    tx: &Transaction<'_>,
    version: u64,
    kind: SchemaTransitionKind,
    body: &SchemaTransitionEventBodyV1,
    now_ms: u64,
) -> SnapbackResult<()> {
    if body.operation_id.is_empty() {
        return Err(schema_transition_corrupt("empty operation id".to_owned()));
    }
    if body.retention_floor != version {
        return Err(schema_transition_corrupt(format!(
            "retention floor {} does not equal the publication version {version}",
            body.retention_floor
        )));
    }
    if body.successor_generation <= body.predecessor_generation
        && matches!(kind, SchemaTransitionKind::SchemaResync)
    {
        return Err(schema_transition_corrupt(
            "forward publication must advance the storage generation".to_owned(),
        ));
    }
    let payload = serde_json::to_string(body)
        .map_err(|error| schema_transition_corrupt(error.to_string()))?;
    tx.execute(
        "INSERT INTO _snapback_changes(version, table_name, row_id, op, row_json, changed_at_ms)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            version_to_sql_integer(version)?,
            SCHEMA_TRANSITION_JOURNAL_TABLE,
            body.operation_id,
            kind.as_op(),
            payload,
            timestamp_to_sql_millis(now_ms)?
        ],
    )?;
    Ok(())
}

pub(crate) fn schema_transition_events_on(
    conn: &Connection,
    since_version: u64,
) -> SnapbackResult<Vec<SchemaTransitionEventV1>> {
    let mut statement = conn.prepare_cached(
        "SELECT version, op, row_json, changed_at_ms FROM _snapback_changes \
         WHERE table_name = ?1 AND version > ?2 ORDER BY version, id",
    )?;
    let rows = statement.query_map(
        params![
            SCHEMA_TRANSITION_JOURNAL_TABLE,
            version_to_sql_integer(since_version)?
        ],
        |row| {
            let version: SqlValue = row.get(0)?;
            let op: SqlValue = row.get(1)?;
            let payload: SqlValue = row.get(2)?;
            let at_ms: SqlValue = row.get(3)?;
            Ok((version, op, payload, at_ms))
        },
    )?;
    let mut events = Vec::new();
    for row in rows {
        let (version, op, payload, at_ms) = row?;
        let version =
            decode_required_committed_version(version, "schema-transition event version")?;
        let op = decode_required_storage_text(op, "schema-transition event operation")?;
        let kind = SchemaTransitionKind::from_op(&op).ok_or_else(|| {
            schema_transition_corrupt(format!(
                "operation {op:?} is outside the closed schema-transition vocabulary"
            ))
        })?;
        let payload = decode_optional_storage_text(payload, "schema-transition event payload")?
            .ok_or_else(|| schema_transition_corrupt("missing payload".to_owned()))?;
        let body: SchemaTransitionEventBodyV1 = serde_json::from_str(&payload)
            .map_err(|error| schema_transition_corrupt(error.to_string()))?;
        let at_ms = match at_ms {
            SqlValue::Integer(raw) if raw >= 0 => raw as u64,
            other => {
                return Err(schema_transition_corrupt(format!(
                    "timestamp column holds {other:?}"
                )));
            }
        };
        events.push(SchemaTransitionEventV1 {
            kind,
            version,
            at_ms,
            body,
        });
    }
    Ok(events)
}

impl LocalDatabase {
    /// Every schema-transition event after `since_version`, decoded under
    /// the closed grammar (unknown operations or payloads are corruption).
    pub fn schema_transition_events(
        &self,
        since_version: u64,
    ) -> SnapbackResult<Vec<SchemaTransitionEventV1>> {
        with_pinned_read_snapshot(&self.conn, |conn| {
            schema_transition_events_on(conn, since_version)
        })
    }

    /// The most recent schema-transition event, if any — what the
    /// posture-aware client handshake consults.
    pub fn latest_schema_transition(&self) -> SnapbackResult<Option<SchemaTransitionEventV1>> {
        Ok(self.schema_transition_events(0)?.into_iter().last())
    }
}

/// Barrier-time retained-work proof (LLP 0081 §6): v1's local profile can
/// prove exactly one posture — `empty` — by counting the server-resident
/// work stores this target actually holds (retained client-mutation
/// records and durable auth-invalidation retry episodes). `dual-compatible`
/// binds predecessor/successor payload validators that no owning subsystem
/// models on this profile yet, so a non-empty store under it fails closed
/// rather than admitting unproven work; `transformed` was already refused
/// at plan validation. Draining currently runnable work does not erase
/// scheduled-future payloads from this check — the counts are of durable
/// rows, not of what happens to be runnable.
pub(crate) fn prove_retained_work_posture(
    tx: &Transaction<'_>,
    posture: crate::migration::RetainedWorkPosture,
) -> SnapbackResult<()> {
    let count = |table: &str| -> SnapbackResult<i64> {
        if !sqlite_table_exists(tx, table)? {
            return Ok(0);
        }
        Ok(tx.query_row(
            &format!("SELECT COUNT(*) FROM {}", quote_ident(table)?),
            [],
            |row| row.get(0),
        )?)
    };
    let retained_mutations = count("_snapback_client_mutations")?;
    let retry_episodes = count("_snapback_auth_retry_episodes")?;
    let empty = retained_mutations == 0 && retry_episodes == 0;
    match posture {
        crate::migration::RetainedWorkPosture::Empty
        | crate::migration::RetainedWorkPosture::DualCompatible
            if empty =>
        {
            Ok(())
        }
        _ => Err(SnapbackError::error(
            "SNAPBACK_MIGRATION_RETAINED_WORK_INCOMPATIBLE",
            "storage",
            format!(
                "the target holds retained server-resident work the declared posture cannot \
                 prove ({retained_mutations} retained mutation records, {retry_episodes} retry \
                 episodes); the local profile proves only the empty posture"
            ),
        )),
    }
}

/// Test-only seam: manufacture one publication cut (typed transition
/// event, version bump, floor raise) outside the executor, for the posture
/// and floor witnesses in `local`.
#[cfg(test)]
pub(crate) fn publish_schema_transition_for_test(
    db: &mut LocalDatabase,
    posture: crate::migration::CompatibilityPosture,
    predecessor_schema_hash: &str,
) -> u64 {
    let successor_schema_hash = db
        .schema()
        .schema_hash
        .clone()
        .unwrap_or_else(|| "s".repeat(64));
    let tx = db
        .conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .expect("transition tx");
    let version = current_version_on(&tx).expect("head") + 1;
    record_schema_transition_event(
        &tx,
        version,
        SchemaTransitionKind::SchemaResync,
        &SchemaTransitionEventBodyV1 {
            operation_id: "operation-v1:posture-test".to_owned(),
            plan_id: "migration-v1:posture-test".to_owned(),
            predecessor_schema_hash: predecessor_schema_hash.to_owned(),
            successor_schema_hash,
            predecessor_generation: 1,
            successor_generation: 2,
            retention_floor: version,
            compatibility_posture: posture,
        },
        1_000,
    )
    .expect("record transition");
    set_version(&tx, version).expect("set version");
    save_retention_floor_on(&tx, version).expect("raise floor");
    tx.commit().expect("commit transition");
    version
}
