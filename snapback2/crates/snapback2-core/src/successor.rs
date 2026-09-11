//! Additive generation succession and explicit destructive migration plans.
// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — destructive changes need a plan.

use crate::engine::{
    RuntimeError, materialize_optional_fields, rebuild_owned_aggregate_target, reindex_row,
};
use crate::schema::{ColumnType, Maintain, MaintainKind, Schema};
use crate::value::{I53_MAX, I53_MIN, Value, canonical_json};
use rusqlite::{Connection, Transaction, params};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Drop {
    Table {
        name: String,
        rows: u64,
    },
    Column {
        table: String,
        name: String,
    },
    Index {
        table: String,
        name: String,
    },
    TypeChange {
        table: String,
        column: String,
        from: ColumnType,
        to: ColumnType,
    },
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationPlan {
    pub drops: Vec<Drop>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UniqueConflict {
    pub table: String,
    pub index: String,
    pub key: Vec<Value>,
}

#[derive(Clone, Debug, PartialEq, Eq, Error, Serialize, Deserialize)]
#[error("{code}: {message}; rewrite: {rewrite}")]
#[serde(rename_all = "camelCase")]
pub struct SuccessorRefusal {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cap_conflicts: Vec<CapConflict>,
    #[serde(default)]
    pub from: String,
    #[serde(default)]
    pub to: String,
    pub code: String,
    pub message: String,
    pub rewrite: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site: Option<String>,
    pub plan: MigrationPlan,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conflicts: Vec<UniqueConflict>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub narrowings: Vec<NarrowingConflict>,
}

impl SuccessorRefusal {
    pub(crate) fn compared(mut self, from: &str, to: &str) -> Self {
        self.from = from.to_owned();
        self.to = to.to_owned();
        self.message = format!("{} (generation {from} → {to})", self.message);
        self
    }

    pub(crate) fn destructive(plan: MigrationPlan) -> Self {
        Self {
            from: String::new(),
            to: String::new(),
            code: "E_SUCCESSOR_DESTRUCTIVE".to_owned(),
            message: "destructive successor requires an explicit migration plan".to_owned(),
            rewrite: "apply exactly the returned migration plan".to_owned(),
            site: plan.drops.first().map(|drop| match drop {
                Drop::Table { name, .. } => format!("schema.tables.{name}"),
                Drop::Column { table, name } => format!("schema.tables.{table}.columns.{name}"),
                Drop::TypeChange { table, column, .. } => {
                    format!("schema.tables.{table}.columns.{column}")
                }
                Drop::Index { table, name } => format!("schema.tables.{table}.indexes.{name}"),
            }),
            plan,
            conflicts: Vec::new(),
            cap_conflicts: Vec::new(),
            narrowings: Vec::new(),
        }
    }

    pub(crate) fn store(error: &RuntimeError) -> Self {
        Self {
            from: String::new(),
            to: String::new(),
            code: "E_SUCCESSOR_STORE".to_owned(),
            message: error.to_string(),
            rewrite: "repair the store error and retry the successor".to_owned(),
            site: Some("store".to_owned()),
            plan: MigrationPlan::default(),
            conflicts: Vec::new(),
            cap_conflicts: Vec::new(),
            narrowings: Vec::new(),
        }
    }

    fn required_column(table: &str, column: &str) -> Self {
        Self {
            from: String::new(),
            to: String::new(),
            code: "E_SUCCESSOR_COLUMN_REQUIRED".to_owned(),
            message: format!(
                "successor leaves required column {table}.{column} absent on stored rows"
            ),
            rewrite: format!(
                "declare {table}.{column} as T?, apply; fill it with a bounded job (`run fill_{table}_{column} --as system --wait`; see guide successor); then declare T and apply again"
            ),
            site: Some(format!("schema.tables.{table}.columns.{column}")),
            plan: MigrationPlan::default(),
            conflicts: Vec::new(),
            cap_conflicts: Vec::new(),
            narrowings: Vec::new(),
        }
    }

    fn unique(conflicts: Vec<UniqueConflict>) -> Self {
        let indexes = conflicts
            .iter()
            .map(|conflict| format!("{}.{}", conflict.table, conflict.index))
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>()
            .join(", ");
        Self {
            from: String::new(),
            to: String::new(),
            code: "E_SUCCESSOR_UNIQUE".to_owned(),
            message: format!("new unique index has conflicting keys in {indexes}"),
            rewrite: "make the index non-unique or fix the rows".to_owned(),
            site: conflicts
                .first()
                .map(|c| format!("schema.tables.{}.indexes.{}", c.table, c.index)),
            plan: MigrationPlan::default(),
            conflicts,
            cap_conflicts: Vec::new(),
            narrowings: Vec::new(),
        }
    }

    fn invalid_row(table: &str, row: &str, error: impl std::fmt::Display) -> Self {
        Self {
            from: String::new(),
            to: String::new(),
            code: "E_SUCCESSOR_ROW_INVALID".to_owned(),
            message: format!("successor validation refused stored row {table}.{row}: {error}"),
            rewrite: format!("repair or remove stored row {table}.{row}, then retry the successor"),
            site: Some(format!("{table}.{row}")),
            plan: MigrationPlan::default(),
            conflicts: Vec::new(),
            cap_conflicts: Vec::new(),
            narrowings: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuccessorReport {
    pub from: String,
    pub to: String,
    pub added_tables: Vec<String>,
    pub added_columns: Vec<String>,
    pub added_indexes: Vec<String>,
    pub backfilled_maintains: u64,
    pub maintains: Vec<String>,
    pub narrowings: Vec<NarrowingConflict>,
    /// One line per custody log bootstrapped at this installation (LLP 1019 §2).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bootstrapped_deliveries: Vec<String>,
    /// The audience bound `A` the engine recorded for each installed log (LLP 1019 §4).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub audience_bounds: BTreeMap<String, u32>,
}

impl SuccessorReport {
    pub(crate) fn persist(&self, transaction: &Transaction<'_>) -> Result<(), RuntimeError> {
        transaction.execute(
            "INSERT INTO _meta(key, value) VALUES ('last_successor', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [canonical_json(self)],
        )?;
        Ok(())
    }
}

/// `owned` is `projected_owned_ids` taken before any migration drop (the same set the
/// caller threads through admission and application).
pub(crate) fn plan(
    connection: &Connection,
    current: &Schema,
    next: &Schema,
    owned: &OwnedIds,
) -> Result<MigrationPlan, RuntimeError> {
    let mut drops = Vec::new();
    for (table_name, table) in &current.tables {
        let Some(next_table) = next.tables.get(table_name) else {
            let rows: i64 = connection.query_row(
                "SELECT COUNT(*) FROM rows WHERE table_name = ?1",
                [table_name],
                |row| row.get(0),
            )?;
            drops.push(Drop::Table {
                name: table_name.clone(),
                rows: rows.max(0) as u64,
            });
            continue;
        };
        // @ref LLP 1020#a3-exact-projection-ownership — a delta on a target whose
        // stored rows all lie in the union of the predecessor and successor projected
        // ids is the transactional replacement; any ordinary survivor keeps the plan.
        if let Some(ids) = owned.get(table_name) {
            let mut statement =
                connection.prepare("SELECT row_id FROM rows WHERE table_name=?1")?;
            let ids_in_store = statement
                .query_map([table_name], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            if ids_in_store.iter().all(|id| ids.contains(id)) {
                continue;
            }
        }
        for (column, column_type) in &table.columns {
            match next_table.columns.get(column) {
                None => drops.push(Drop::Column {
                    table: table_name.clone(),
                    name: column.clone(),
                }),
                Some(next_type)
                    if !widens(column_type, next_type) && !is_narrowing(column_type, next_type) =>
                {
                    drops.push(Drop::TypeChange {
                        table: table_name.clone(),
                        column: column.clone(),
                        from: column_type.clone(),
                        to: next_type.clone(),
                    })
                }
                Some(_) => {}
            }
        }
        for (index, definition) in &table.indexes {
            if next_table
                .indexes
                .get(index)
                .is_none_or(|next_index| next_index.components != definition.components)
            {
                drops.push(Drop::Index {
                    table: table_name.clone(),
                    name: index.clone(),
                });
            }
        }
    }
    let custody = delivery::custody_drops(connection, current, next, &drops)?;
    drops.extend(custody);
    Ok(MigrationPlan { drops })
}

/// `owned` is `projected_owned_ids` taken before any migration drop; the caller
/// threads it through so nothing re-derives a projection over rows whose columns
/// the drops have already cleared.
pub(crate) fn additive_refusal(
    connection: &Connection,
    current: &Schema,
    next: &Schema,
    owned: &OwnedIds,
) -> Result<Option<SuccessorRefusal>, RuntimeError> {
    let rebuilt_targets = maintained_targets_requiring_rebuild(current, next);
    if let Some(refusal) = narrowing_refusal(connection, current, next, owned)? {
        return Ok(Some(refusal));
    }
    if let Some(refusal) = delivery::bootstrap_refusal(connection, current, next)? {
        return Ok(Some(refusal));
    }
    for (table_name, current_table) in &current.tables {
        let Some(next_table) = next.tables.get(table_name) else {
            continue;
        };
        let absent_required = next_table.columns.iter().find(|(column, kind)| {
            current_table
                .columns
                .get(*column)
                .is_none_or(|current_kind| {
                    !widens(current_kind, kind) && !is_narrowing(current_kind, kind)
                })
                && !matches!(kind, ColumnType::Optional(_))
        });
        if let Some((column, _)) = absent_required {
            let mut stmt = connection.prepare("SELECT row_id FROM rows WHERE table_name = ?1")?;
            let rows = stmt
                .query_map([table_name], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            if rows
                .iter()
                .any(|id| !owned.get(table_name).is_some_and(|ids| ids.contains(id)))
            {
                return Ok(Some(SuccessorRefusal::required_column(table_name, column)));
            }
        }
    }

    if let Some(refusal) =
        validate_stored_rows(connection, current, next, &rebuilt_targets, owned)?
    {
        return Ok(Some(refusal));
    }

    if let Some(refusal) = caps::validate_caps(connection, next)? {
        return Ok(Some(refusal));
    }

    let mut conflicts = Vec::new();
    for (table_name, next_table) in &next.tables {
        let Some(current_table) = current.tables.get(table_name) else {
            continue;
        };
        if rebuilt_targets.contains(table_name) {
            continue;
        }
        for (index_name, index) in &next_table.indexes {
            let newly_unique = index.unique
                && !current_table
                    .indexes
                    .get(index_name)
                    .is_some_and(|old| old.unique && old.components == index.components);
            if !newly_unique {
                continue;
            }
            let mut counts = BTreeMap::<String, (Vec<Value>, usize)>::new();
            for_row_batches(connection, table_name, |row| {
                let key = index
                    .components
                    .iter()
                    .filter_map(crate::search_key::IndexComponent::column)
                    .map(|column| row.field(column).cloned().unwrap_or(Value::Null))
                    .collect::<Vec<_>>();
                let encoded = canonical_json(&key);
                counts
                    .entry(encoded)
                    .and_modify(|(_, count)| *count += 1)
                    .or_insert((key, 1));
                Ok(())
            })?;
            for (_, (key, count)) in counts {
                if count > 1 {
                    conflicts.push(UniqueConflict {
                        table: table_name.clone(),
                        index: index_name.clone(),
                        key,
                    });
                    if conflicts.len() == 10 {
                        return Ok(Some(SuccessorRefusal::unique(conflicts)));
                    }
                }
            }
        }
    }
    // Rebuilt targets validate the final survivor-plus-projection state inside
    // rebuild_target. Deferring that check preserves dependency order when one
    // maintained target is the next target's source.
    Ok((!conflicts.is_empty()).then(|| SuccessorRefusal::unique(conflicts)))
}

pub(crate) fn validate_stored_rows(
    connection: &Connection,
    current: &Schema,
    next: &Schema,
    replaced_tables: &BTreeSet<String>,
    owned: &OwnedIds,
) -> Result<Option<SuccessorRefusal>, RuntimeError> {
    for (table_name, next_table) in &next.tables {
        let current_table = current.tables.get(table_name);
        let columns = next_table
            .columns
            .iter()
            .filter(|(column, kind)| {
                match current_table.and_then(|table| table.columns.get(*column)) {
                    None => true,
                    Some(current_kind) => {
                        current_kind != *kind
                            && (contains_id_or_ref(kind) || is_narrowing(current_kind, kind))
                    }
                }
            })
            .collect::<Vec<_>>();
        let mut statement = connection
            .prepare("SELECT row_id, data FROM rows WHERE table_name = ?1 ORDER BY row_id")?;
        let rows = statement.query_map([table_name], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (row_id, data) = row?;
            if replaced_tables.contains(table_name)
                && owned
                    .get(table_name)
                    .is_some_and(|ids| ids.contains(&row_id))
            {
                continue;
            }
            let value = match serde_json::from_str::<Value>(&data) {
                Ok(value) => value,
                Err(error) => {
                    return Ok(Some(SuccessorRefusal::invalid_row(
                        table_name, &row_id, error,
                    )));
                }
            };
            let object = match value.as_object() {
                Ok(object) => object,
                Err(error) => {
                    return Ok(Some(SuccessorRefusal::invalid_row(
                        table_name, &row_id, error,
                    )));
                }
            };
            if let Some(id) = object.get("id") {
                if let Err(error) = crate::cap::validate_address(next, table_name, id) {
                    return Ok(Some(SuccessorRefusal::invalid_row(
                        table_name, &row_id, error,
                    )));
                }
            }
            for (column, value) in object
                .iter()
                .filter(|(name, _)| name.as_str() != "id" && next_table.columns.contains_key(*name))
            {
                let _ = column;
                if let Err(error) =
                    crate::cap::validate_typed_identities(next, &next_table.columns[column], value)
                {
                    return Ok(Some(SuccessorRefusal::invalid_row(
                        table_name, &row_id, error,
                    )));
                }
            }
            for (column, kind) in &columns {
                if let Err(error) = crate::engine::validate_typed_column_value(
                    next,
                    table_name,
                    column,
                    kind,
                    object.get(*column),
                ) {
                    return Ok(Some(SuccessorRefusal::invalid_row(
                        table_name, &row_id, error,
                    )));
                }
            }
        }
    }
    Ok(None)
}

fn contains_id_or_ref(kind: &ColumnType) -> bool {
    match kind {
        ColumnType::Id | ColumnType::Ref { .. } => true,
        ColumnType::Optional(inner) | ColumnType::List { of: inner, .. } => {
            contains_id_or_ref(inner)
        }
        _ => false,
    }
}

pub(crate) fn apply_additive(
    transaction: &Transaction<'_>,
    current: &Schema,
    next: &Schema,
    from: String,
    to: String,
    owned: OwnedIds,
    now: i64,
) -> Result<SuccessorReport, RuntimeError> {
    let mut report = SuccessorReport {
        from,
        to,
        narrowings: narrowing::checked_narrowings(transaction, current, next, &owned)?,
        maintains: next
            .maintains
            .iter()
            .filter(|m| !current.maintains.contains(m))
            .filter_map(|m| {
                current
                    .maintains
                    .iter()
                    .find(|old| old.target == m.target && !next.maintains.contains(old))
                    .and_then(|old| maintain_change_line(old, m))
            })
            .collect(),
        ..SuccessorReport::default()
    };
    for table in next.tables.keys() {
        if !current.tables.contains_key(table) {
            report.added_tables.push(table.clone());
        }
    }
    for (table_name, next_table) in &next.tables {
        let Some(table) = current.tables.get(table_name) else {
            for index in next_table.indexes.keys() {
                report.added_indexes.push(format!("{table_name}.{index}"));
            }
            continue;
        };
        for column in next_table.columns.keys() {
            if !table.columns.contains_key(column) {
                report.added_columns.push(format!("{table_name}.{column}"));
            }
        }
        for (index, next_index) in &next_table.indexes {
            if table
                .indexes
                .get(index)
                .is_none_or(|old| old.components != next_index.components)
            {
                report.added_indexes.push(format!("{table_name}.{index}"));
            }
        }
    }
    let changed_maintains = changed_maintains(current, next);
    report.backfilled_maintains = changed_maintains.len() as u64;

    let mut replaced_projection_ids = owned;

    // A retired projection can be the source of a new maintain. Clear its
    // engine-owned addresses before any active target reads that source;
    // target-name order is not a dependency order. Ordinary-id survivors stay.
    let next_targets = next
        .maintains
        .iter()
        .map(|maintain| maintain.target.as_str())
        .collect::<BTreeSet<_>>();
    let retired_targets = current
        .maintains
        .iter()
        .map(|maintain| maintain.target.as_str())
        .filter(|target| !next_targets.contains(target))
        .collect::<BTreeSet<_>>();
    for target in retired_targets {
        if let Some(ids) = replaced_projection_ids.remove(target) {
            rebuild_owned_aggregate_target(transaction, next, target, &ids, vec![])?;
        }
    }

    for table_name in next.tables.keys() {
        let needs_reindex = current.tables.get(table_name).is_some_and(|table| {
            next.tables[table_name].indexes.iter().any(|(name, index)| {
                table
                    .indexes
                    .get(name)
                    .is_none_or(|old| old.components != index.components)
            })
        });
        if needs_reindex {
            // Keep one source batch live; all postings are ready in this transaction before exposure.
            for_row_batches(transaction, table_name, |row| {
                // Exact predecessor-owned projections will be removed/replaced below.
                // Surviving rows still undergo scoped successor index admission.
                if let Some(ids) = replaced_projection_ids.get(table_name) {
                    if ids.contains(row.field("id")?.as_str()?) {
                        return Ok(());
                    }
                }
                // @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs —
                // reindex consumes declared key inputs, not unrelated legacy fields.
                let table = next.table(table_name).expect("successor table");
                let mut columns = BTreeSet::from(["id"]);
                for index in table.indexes.values() {
                    for component in &index.components {
                        match component {
                            crate::search_key::IndexComponent::Column(name) => {
                                columns.insert(name);
                            }
                            crate::search_key::IndexComponent::WordPrefixes { fields, .. } => {
                                columns.extend(fields.iter().map(String::as_str));
                            }
                        }
                    }
                }
                for column in columns {
                    let value = row.field(column).unwrap_or(&Value::Null);
                    crate::cap::validate_index_column(next, table_name, column, value)?;
                }
                reindex_row(transaction, next, table_name, &row)?;
                Ok(())
            })?;
        }
    }
    // A log is populated before any maintain over it is rebuilt from its rows.
    report.bootstrapped_deliveries = delivery::bootstrap(transaction, current, next, now)?;
    for target in maintained_targets_requiring_rebuild(current, next) {
        rebuild_target(
            transaction,
            next,
            &target,
            replaced_projection_ids.remove(&target).unwrap_or_default(),
        )?;
    }
    Ok(report)
}

pub(crate) fn apply_migration_drops(
    transaction: &Transaction<'_>,
    current: &mut Schema,
    migration: &MigrationPlan,
    released_at: i64,
) -> Result<(), RuntimeError> {
    for drop in &migration.drops {
        match drop {
            Drop::Table { name, .. } => {
                // @ref LLP 1006#2a-one-asset-one-home-author-ruling-2026-09-01 — destructive successors release every affine cell they remove.
                crate::assets_ledger::release_table_assets(transaction, name, released_at)?;
                transaction.execute("DELETE FROM index_entries WHERE table_name = ?1", [name])?;
                transaction.execute("DELETE FROM rows WHERE table_name = ?1", [name])?;
                clear_search_indexes(transaction, name, None)?;
            }
            Drop::Column { table, name }
            | Drop::TypeChange {
                table,
                column: name,
                ..
            } => {
                crate::assets_ledger::release_column_assets(transaction, table, name, released_at)?;
                drop_column_values(transaction, table, name)?;
                transaction.execute("DELETE FROM index_entries WHERE table_name = ?1", [table])?;
                clear_search_indexes(transaction, table, None)?;
            }
            Drop::Index { table, name } => {
                transaction.execute(
                    "DELETE FROM index_entries WHERE table_name = ?1 AND index_name = ?2",
                    params![table, name],
                )?;
                clear_search_indexes(transaction, table, Some(name))?;
            }
        }
    }
    for drop in &migration.drops {
        match drop {
            Drop::Table { name, .. } => {
                current.tables.remove(name);
            }
            Drop::Column { table, name } => {
                if let Some(table) = current.tables.get_mut(table) {
                    table.columns.remove(name);
                    table.indexes.clear();
                }
            }
            Drop::Index { table, name } => {
                if let Some(table) = current.tables.get_mut(table) {
                    table.indexes.remove(name);
                }
            }
            Drop::TypeChange { table, .. } => {
                if let Some(table) = current.tables.get_mut(table) {
                    // Keep predecessor column types in the comparison schema.
                    // The values were dropped above, so successor admission
                    // must still see the retype and validate the resulting
                    // absence against the successor type.
                    table.indexes.clear();
                }
            }
        }
    }
    Ok(())
}

fn clear_search_indexes(
    c: &Connection,
    table: &str,
    index: Option<&str>,
) -> Result<(), RuntimeError> {
    for storage in ["_search_postings", "_search_nodes"] {
        c.execute(
            &format!("DELETE FROM {storage} WHERE table_name=?1 AND (?2 IS NULL OR index_name=?2)"),
            params![table, index],
        )?;
    }
    Ok(())
}
/// Rows one successor batch reads at a time.
pub(crate) const ROW_BATCH: usize = 128;

fn for_row_batches(
    c: &Connection,
    table: &str,
    mut apply: impl FnMut(Value) -> Result<(), RuntimeError>,
) -> Result<(), RuntimeError> {
    let mut after: Option<String> = None;
    loop {
        let mut stmt = c.prepare_cached(&format!(
            "SELECT row_id,data FROM rows WHERE table_name=?1 AND (?2 IS NULL OR row_id>?2) ORDER BY row_id LIMIT {ROW_BATCH}"
        ))?;
        let batch = stmt
            .query_map(params![table, after], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        if batch.is_empty() {
            break;
        }
        for (id, data) in batch {
            apply(
                serde_json::from_str(&data)
                    .map_err(|e| RuntimeError::Serialization(e.to_string()))?,
            )?;
            after = Some(id);
        }
    }
    Ok(())
}

fn drop_column_values(
    transaction: &Transaction<'_>,
    table: &str,
    column: &str,
) -> Result<(), RuntimeError> {
    for_row_batches(transaction, table, |mut row| {
        let id = row.field("id")?.as_str()?.to_owned();
        match &mut row {
            Value::Row(fields) | Value::Map(fields) => {
                fields.remove(column);
            }
            _ => return Ok(()),
        }
        transaction.execute(
            "UPDATE rows SET data = ?3 WHERE table_name = ?1 AND row_id = ?2",
            params![table, id, canonical_json(&row)],
        )?;
        Ok(())
    })
}

// @ref LLP 1020#a3-exact-projection-ownership — every regroup, kind, or source change
// of a maintain states itself in the successor report: a positional read can keep
// compiling after any of them with its meaning changed.
pub(crate) fn maintain_change_line(old: &Maintain, new: &Maintain) -> Option<String> {
    let kind = |m: &Maintain| match &m.kind {
        MaintainKind::Count => "count".to_owned(),
        MaintainKind::Sum { of } => format!("sum of {of}"),
    };
    let mut changes = Vec::new();
    if old.source != new.source {
        changes.push(format!("from {} → from {}", old.source, new.source));
    }
    if old.kind != new.kind {
        changes.push(format!("{} → {}", kind(old), kind(new)));
    }
    if old.by != new.by {
        changes.push(format!(
            "by {} → by {}",
            old.by.join(", "),
            new.by.join(", ")
        ));
    }
    (!changes.is_empty()).then(|| format!("maintain {}: {}", new.target, changes.join(", ")))
}

fn changed_maintains<'a>(current: &'a Schema, next: &'a Schema) -> Vec<&'a Maintain> {
    let mut unmatched_next = next.maintains.iter().collect::<Vec<_>>();
    let mut changed = Vec::new();
    for maintain in &current.maintains {
        if let Some(offset) = unmatched_next
            .iter()
            .position(|candidate| *candidate == maintain)
        {
            unmatched_next.remove(offset);
        } else {
            changed.push(maintain);
        }
    }
    changed.extend(unmatched_next);
    changed
}

// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — additions,
// removals, declaration multiplicity, and projection-relevant type changes
// rebuild every affected derived target retained by the successor.
fn maintained_targets_requiring_rebuild(current: &Schema, next: &Schema) -> BTreeSet<String> {
    let mut targets = changed_maintains(current, next)
        .into_iter()
        .map(|maintain| maintain.target.clone())
        .collect::<BTreeSet<_>>();

    for maintain in next
        .maintains
        .iter()
        .filter(|maintain| current.maintains.contains(maintain))
    {
        let source_fields = maintain.by.iter().chain(match &maintain.kind {
            MaintainKind::Count => None,
            MaintainKind::Sum { of } => Some(of),
        });
        let source_changed = source_fields.into_iter().any(|field| {
            current
                .table(&maintain.source)
                .and_then(|table| table.columns.get(field))
                != next
                    .table(&maintain.source)
                    .and_then(|table| table.columns.get(field))
        });
        let target_changed = ["id", "value"]
            .into_iter()
            .chain(maintain.by.iter().map(String::as_str))
            .any(|field| {
                current
                    .table(&maintain.target)
                    .and_then(|table| table.columns.get(field))
                    != next
                        .table(&maintain.target)
                        .and_then(|table| table.columns.get(field))
            });
        if source_changed || target_changed {
            targets.insert(maintain.target.clone());
        }
    }

    targets.retain(|target| next.tables.contains_key(target));
    targets
}

/// Per target, the ids the engine owns: the union of the predecessor projection and
/// the successor projection — the rows a successor may replace or clear without a
/// plan (LLP 1001 §4, LLP 1020 A3).
pub(crate) type OwnedIds = BTreeMap<String, BTreeSet<String>>;

// @ref LLP 1020#a3-exact-projection-ownership — read once, before any migration drop.
// The successor projection joins the set only when it can be computed over the
// stored rows; a backfill that cannot (overflow, a group field the successor adds)
// contributes nothing here and refuses at the rebuild with its own code, so the
// destructive classification is never pre-empted by `E_SUCCESSOR_STORE`.
pub(crate) fn projected_owned_ids(
    connection: &Connection,
    current: &Schema,
    next: &Schema,
) -> Result<OwnedIds, RuntimeError> {
    maintained_targets_requiring_rebuild(current, next)
        .into_iter()
        .map(|target| {
            let mut ids = projected_target_rows(connection, current, &target)?
                .into_keys()
                .collect::<BTreeSet<_>>();
            if let Ok(rows) = projected_target_rows(connection, next, &target) {
                ids.extend(rows.into_keys());
            }
            Ok((target, ids))
        })
        .collect()
}

pub(crate) fn rebuild_target(
    transaction: &Transaction<'_>,
    schema: &Schema,
    target: &str,
    mut owned_ids: BTreeSet<String>,
) -> Result<(), RuntimeError> {
    let rows = projected_target_rows(transaction, schema, target)?;
    owned_ids.extend(rows.keys().cloned());
    let table = schema
        .table(target)
        .ok_or_else(|| RuntimeError::Schema(format!("missing maintained target {target}")))?;
    if table.indexes.values().any(|index| index.unique) {
        // @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — uniqueness
        // binds survivors and the replacement projection, after earlier rebuilds and
        // migration drops; only predecessor/successor-owned IDs leave the old image.
        let mut existing = Vec::new();
        for_row_batches(transaction, target, |row| {
            existing.push(row);
            Ok(())
        })?;
        let mut final_rows = rows
            .values()
            .filter(|row| row.field("value").and_then(Value::as_int) != Ok(0))
            .collect::<Vec<_>>();
        for row in &existing {
            if !owned_ids.contains(row.field("id")?.as_str()?) {
                final_rows.push(row);
            }
        }
        let mut conflicts = Vec::new();
        for (index_name, index) in table.indexes.iter().filter(|(_, index)| index.unique) {
            let mut counts = BTreeMap::<String, (Vec<Value>, usize)>::new();
            for row in &final_rows {
                let key = index
                    .components
                    .iter()
                    .filter_map(crate::search_key::IndexComponent::column)
                    .map(|column| row.field(column).cloned().unwrap_or(Value::Null))
                    .collect::<Vec<_>>();
                counts
                    .entry(canonical_json(&key))
                    .and_modify(|(_, count)| *count += 1)
                    .or_insert((key, 1));
            }
            for (_, (key, count)) in counts {
                if count > 1 {
                    conflicts.push(UniqueConflict {
                        table: target.to_owned(),
                        index: index_name.clone(),
                        key,
                    });
                    if conflicts.len() == 10 {
                        return Err(RuntimeError::Successor(Box::new(SuccessorRefusal::unique(
                            conflicts,
                        ))));
                    }
                }
            }
        }
        if !conflicts.is_empty() {
            return Err(RuntimeError::Successor(Box::new(SuccessorRefusal::unique(
                conflicts,
            ))));
        }
    }
    rebuild_owned_aggregate_target(
        transaction,
        schema,
        target,
        &owned_ids,
        rows.into_values().collect(),
    )
}

// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — an evaluator
// identity change reconciles its durable engine-owned representation once.
/// One-time evaluator migration from dense zero aggregates to the canonical
/// sparse representation. Exact group-address rows belong to the engine;
/// legacy ordinary-id survivors in the same table remain untouched.
pub(crate) fn reconcile_sparse_aggregate_rows(
    transaction: &Transaction<'_>,
    schema: &Schema,
    required: bool,
) -> Result<(), RuntimeError> {
    if !required {
        return Ok(());
    }
    let targets = schema
        .maintains
        .iter()
        .map(|maintain| maintain.target.clone())
        .collect::<BTreeSet<_>>();
    for target in targets {
        let maintain = schema
            .maintains
            .iter()
            .find(|maintain| maintain.target == target)
            .expect("target came from a maintain declaration");
        let mut zero_ids = BTreeSet::new();
        for_row_batches(transaction, &target, |row| {
            let expected = canonical_json(
                &maintain
                    .by
                    .iter()
                    .map(|field| row.field(field).cloned())
                    .collect::<Result<Vec<_>, _>>()?,
            );
            if row.field("value")?.as_int()? == 0 && row.field("id")?.as_str()? == expected {
                zero_ids.insert(expected);
            }
            Ok(())
        })?;
        if !zero_ids.is_empty() {
            rebuild_owned_aggregate_target(transaction, schema, &target, &zero_ids, vec![])?;
        }
    }
    Ok(())
}

fn projected_target_rows(
    connection: &Connection,
    schema: &Schema,
    target: &str,
) -> Result<BTreeMap<String, Value>, RuntimeError> {
    let mut combined = BTreeMap::<String, Value>::new();
    for maintain in schema
        .maintains
        .iter()
        .filter(|maintain| maintain.target == target)
    {
        for row in projected_backfill_rows(connection, schema, maintain)? {
            let id = row.field("id")?.as_str()?.to_owned();
            if let Some(existing) = combined.get_mut(&id) {
                let total = existing.field("value")?.as_int()? as i128
                    + row.field("value")?.as_int()? as i128;
                if !(I53_MIN as i128..=I53_MAX as i128).contains(&total) {
                    return Err(RuntimeError::Constraint(format!(
                        "aggregate backfill overflow for {target}"
                    )));
                }
                match existing {
                    Value::Row(fields) | Value::Map(fields) => {
                        fields.insert("value".to_owned(), Value::Int(total as i64));
                    }
                    _ => {
                        return Err(RuntimeError::Schema(format!(
                            "aggregate backfill for {target} produced a non-row"
                        )));
                    }
                }
            } else {
                combined.insert(id, row);
            }
        }
    }
    Ok(combined)
}

fn projected_backfill_rows(
    connection: &Connection,
    schema: &Schema,
    maintain: &Maintain,
) -> Result<Vec<Value>, RuntimeError> {
    let source = schema
        .table(&maintain.source)
        .ok_or_else(|| RuntimeError::Schema(format!("missing table {}", maintain.source)))?;
    let mut groups = BTreeMap::<String, (Vec<Value>, i128)>::new();
    for_row_batches(connection, &maintain.source, |mut row| {
        materialize_optional_fields(&mut row, source);
        let group = maintain
            .by
            .iter()
            .map(|field| row.field(field).cloned())
            .collect::<Result<Vec<_>, _>>()?;
        let id = canonical_json(&group);
        let amount = match &maintain.kind {
            MaintainKind::Count => 1_i128,
            MaintainKind::Sum { of } => row.field(of)?.as_int()? as i128,
        };
        groups
            .entry(id)
            .and_modify(|(_, value)| *value += amount)
            .or_insert((group, amount));
        Ok(())
    })?;
    groups
        .into_iter()
        .map(|(id, (group, value))| {
            if !(I53_MIN as i128..=I53_MAX as i128).contains(&value) {
                return Err(RuntimeError::Constraint(format!(
                    "aggregate backfill overflow for {}",
                    maintain.target
                )));
            }
            let mut fields = BTreeMap::from([
                ("id".to_owned(), Value::Id(id.clone())),
                ("value".to_owned(), Value::Int(value as i64)),
            ]);
            for (name, value) in maintain.by.iter().zip(group) {
                fields.insert(name.clone(), value);
            }
            Ok(Value::Row(fields.into()))
        })
        .collect()
}

#[path = "successor/caps.rs"]
mod caps;
pub use caps::CapConflict;
#[path = "successor/delivery.rs"]
pub mod delivery;
#[path = "successor_narrowing.rs"]
mod narrowing;
pub use narrowing::NarrowingConflict;
use narrowing::{is_narrowing, narrowing_refusal};

// @ref LLP 1020#a1-widening-is-additive — compare value domains, not declaration equality.
// Text minimum/format live in constraints; changing those is write-only admission.
fn widens(current: &ColumnType, next: &ColumnType) -> bool {
    if current == next || adding_once(current, next) {
        return true;
    }
    match (current, next) {
        (ColumnType::Optional(a), ColumnType::Optional(b)) => widens(a, b),
        (_, ColumnType::Optional(b)) if !matches!(current, ColumnType::Optional(_)) => {
            widens(current, b)
        }
        (ColumnType::List { of: a, max: am }, ColumnType::List { of: b, max: bm }) => {
            am <= bm && widens(a, b)
        }
        (ColumnType::Enum { variants: a }, ColumnType::Enum { variants: b }) => {
            a.iter().all(|v| b.contains(v))
        }
        (ColumnType::Text { max: a }, ColumnType::Text { max: b })
        | (ColumnType::Bytes { max: a }, ColumnType::Bytes { max: b })
        | (ColumnType::Video { max: a }, ColumnType::Video { max: b }) => a <= b,
        (ColumnType::Json { max_bytes: a }, ColumnType::Json { max_bytes: b }) => a <= b,
        (ColumnType::Image { max: a, once: ao }, ColumnType::Image { max: b, once: bo }) => {
            a <= b && (!ao || *bo)
        }
        _ => false,
    }
}

// @ref LLP 1006#2a1-one-use-image-delivery-clique-f3-2026-09-05 — existing images have no recorded prior views.
fn adding_once(current: &ColumnType, next: &ColumnType) -> bool {
    match (current, next) {
        (
            ColumnType::Image {
                max: a,
                once: false,
            },
            ColumnType::Image { max: b, once: true },
        ) => a == b,
        (ColumnType::Optional(a), ColumnType::Optional(b)) => adding_once(a, b),
        (ColumnType::List { of: a, max: am }, ColumnType::List { of: b, max: bm }) => {
            am == bm && adding_once(a, b)
        }
        _ => false,
    }
}
