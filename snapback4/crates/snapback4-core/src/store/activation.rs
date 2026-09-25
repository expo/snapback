//! Candidate activation: project rows, validate invariants, build indexes
//! and derived rows, then publish the semantic generation in one commit.
// @ref LLP 3000.000#implementation-follow-up — one atomic activation boundary

use super::*;
use crate::ir::Program;
use crate::schema::{Constraint, materialize_optional_fields};
use crate::value::digest;
use std::collections::BTreeSet;

pub(super) type Identity = (Option<String>, Option<String>, Option<String>, Option<String>);

pub(super) fn identity(conn: &Connection) -> Result<Identity, RuntimeError> {
    let mut statement = conn.prepare_cached("SELECT value FROM _meta WHERE key = ?1")?;
    let mut get = |key| statement.query_row([key], |row| row.get(0)).optional();
    Ok((get("schema_hash")?, get("activation_hash")?, get("generation")?, get("device:generation")?))
}

impl Store {
    /// Install a device's schema. Server engines also supply their programs
    /// and derived-state builder through `activate` below.
    pub fn install(&mut self, schema: &Schema) -> Result<(), RuntimeError> {
        self.activate(schema, None, false, |_, _| Ok(())).map(|_| ())
    }

    /// A device can discard an obsolete partition while atomically caching
    /// its replacement backend and reset watermark. It never migrates rows
    /// whose authority belongs to a previous server generation.
    pub fn install_device(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool) -> Result<(), RuntimeError> {
        self.install_device_checked(schema, metadata, reset, &BTreeMap::new())
    }

    pub fn install_device_checked(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool, expected: &BTreeMap<String, Option<String>>) -> Result<(), RuntimeError> {
        self.install_device_checked_with(schema, metadata, reset, expected, |_| Ok(()))
    }

    /// Device-owned sidecar changes share the schema installation transaction.
    pub fn install_device_checked_with(&mut self, schema: &Schema, metadata: &BTreeMap<String, String>, reset: bool, expected: &BTreeMap<String, Option<String>>, prepare: impl FnOnce(&Tx<'_>) -> Result<(), RuntimeError>) -> Result<(), RuntimeError> {
        self.activate(schema, None, reset, |tx, _| {
            for (key, value) in expected {
                let held: Option<String> = tx.conn().query_row("SELECT value FROM _meta WHERE key = ?1", [key], |row| row.get(0)).optional()?;
                if &held != value { return Err(RuntimeError::Generation("the backend adoption capture is obsolete; retry sync".into())); }
            }
            prepare(tx)?;
            for (key, value) in metadata {
                // A device metadata namespace reset shares backend installation's transaction.
                if key.ends_with(':') {
                    tx.conn().execute("DELETE FROM _meta WHERE key >= ?1 AND key < ?2", params![key, format!("{key}\u{10ffff}")])?;
                } else { tx.set_meta(key, value)?; }
            }
            if reset { tx.conn().execute_batch("DELETE FROM _device_base; DELETE FROM _device_snapshot;")?; }
            Ok(())
        }).map(|_| ())
    }

    pub(crate) fn activate(&mut self, schema: &Schema, programs: Option<&BTreeMap<String, Program>>, reset: bool, build: impl FnOnce(&Tx<'_>, bool) -> Result<(), RuntimeError>) -> Result<u64, RuntimeError> {
        let sql = self.conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let before = identity(&sql)?;
        if before != self.identity { return Err(RuntimeError::Generation("another engine activated this store; reopen it before activating source".into())); }
        // One bounded result, no row images. Fresh stores have no schema;
        // an explicit device reset discards the old entries in this transaction.
        if before.0.is_some() && !reset {
            let violation: Option<(String, i64)> = sql.query_row(
                "SELECT c.name, COUNT(*) FROM i JOIN _catalog c ON c.num = i.ti WHERE length(i.k) > ?1 GROUP BY i.ti ORDER BY i.ti LIMIT 1",
                [crate::rows::MAX_INDEX_KEY_BYTES as i64], |row| Ok((row.get(0)?, row.get(1)?))
            ).optional()?;
            if let Some((name, count)) = violation {
                let (table, index) = name.rsplit_once('.').unwrap_or((&name, "unknown"));
                return Err(crate::rows::index_key_refusal(table, index, count as u64));
            }
        }
        let schema_hash = schema.hash();
        let activation_hash = programs.map(|programs| digest(&(schema, programs)));
        let schema_changed = before.0.as_deref() != Some(&schema_hash);
        let changed = schema_changed || activation_hash.as_ref().is_some_and(|hash| before.1.as_ref() != Some(hash));
        let mut catalog: BTreeMap<String, i64> = sql.prepare("SELECT name, num FROM _catalog")?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?.collect::<Result<_, _>>()?;
        let mut next = catalog.values().copied().max().unwrap_or(0) + 1;
        for (name, table) in &schema.tables {
            for full in std::iter::once(name.clone()).chain(table.indexes.keys().map(|index| format!("{name}.{index}"))) {
                if !catalog.contains_key(&full) {
                    sql.execute("INSERT INTO _catalog(name, num) VALUES (?1, ?2)", params![full, next])?;
                    catalog.insert(full, next); next += 1;
                }
            }
        }
        let tx = Tx { tx: sql, page_size: self.page_size, catalog: &catalog };
        if programs.is_some() { crate::engine::timeline::check_activation(&tx, schema)?; }
        if schema_changed && programs.is_some() {
            if let Some(step) = super::successor::assess(&tx, schema)?.iter().find(|s| s.change == crate::successor::Change::Narrowing) {
                return Err(step.refusal(schema));
            }
        }
        if reset { tx.tx.execute_batch("DELETE FROM r; DELETE FROM i; DELETE FROM _cap_counts;")?; }
        if schema_changed {
            // Removed names retain only their catalog number, never live row
            // images. Reintroducing a name starts empty, without resurrection.
            let active: BTreeSet<String> = schema.tables.iter().flat_map(|(t, def)| std::iter::once(t.clone()).chain(def.indexes.keys().map(move |i| format!("{t}.{i}")))).collect();
            for (name, num) in &catalog {
                if !active.contains(name) {
                    tx.tx.execute("DELETE FROM r WHERE t = ?1", [num])?;
                    tx.tx.execute("DELETE FROM i WHERE ti = ?1", [num])?;
                }
            }
            for (name, table) in &schema.tables {
                let t = catalog[name];
                for index in table.indexes.keys() { tx.tx.execute("DELETE FROM i WHERE ti = ?1", [catalog[&format!("{name}.{index}")]])?; }
                let mut contribution_meter = crate::meter::Meter::new(crate::meter::Ceilings::job(), crate::meter::Cut::Abort);
                let mut contribution_rows = 0;
                walk(&tx, t, |id, mut row| {
                    if contribution_rows % 256 == 0 { contribution_meter = crate::meter::Meter::new(crate::meter::Ceilings::job(), crate::meter::Cut::Abort); }
                    contribution_rows += 1;
                    let original = row.clone();
                    if let Value::Row(fields) | Value::Map(fields) = &mut row { fields.retain(|column, _| table.columns.contains_key(column) || (programs.is_none() && column == "pending")); }
                    // Persist only a destructive projection. Defaults and
                    // optionals are an interpretation of the stored image.
                    if row != original {
                        tx.tx.execute("UPDATE r SET data = ?1 WHERE t = ?2 AND id = ?3", params![canonical_json(&row), t, id])?;
                    }
                    materialize_optional_fields(&mut row, table);
                    // A device's prediction mark is metadata, retained in
                    // storage but absent from the row the schema validates.
                    if programs.is_none() { if let Value::Row(fields) = &mut row { fields.remove("pending"); } }
                    // Maintained rows are replaced by the candidate builder.
                    if schema.maintain_for(name).is_none() { crate::engine::validate::validate_row(schema, name, &row)?; }
                    for (index_name, index) in &table.indexes {
                        let scratch = contribution_meter.mark();
                        let contribution = match index.components.first() { Some(crate::schema::IndexComponent::Contribution(m)) => Some(m), _ => None };
                        if let Some(m) = contribution {
                            contribution_meter.at(&format!("adopt {name}.{index_name}"));
                            contribution_meter.charge(crate::error::MeterKind::Examined, 1)?;
                            contribution_meter.step(m.evaluation_steps())?;
                            contribution_meter.heap(row.heap_bytes().saturating_mul(4).saturating_add(4096))?;
                        }
                        for key in index_keys(index, &row, id) {
                            if contribution.is_some() && key.len() > crate::rows::MAX_INDEX_KEY_BYTES {
                                return Err(crate::rows::index_key_refusal(name, index_name, 1));
                            }
                            if contribution.is_some() { contribution_meter.charge(crate::error::MeterKind::IndexEntries, 1)?; }
                            tx.tx.execute("INSERT INTO i(ti, k, id) VALUES (?1, ?2, ?3)", params![catalog[&format!("{name}.{index_name}")], key, id])?;
                        }
                        contribution_meter.release_heap(scratch);
                    }
                    Ok(())
                })?;
            }
        }
        // Upgrade old stores and rebuild only when the schema changes. Counts
        // participate in the same activation transaction as rows and indexes.
        if tx.meta("cap_counts_schema")?.as_deref() != Some(&schema_hash) {
            tx.tx.execute_batch("DELETE FROM _cap_counts;")?;
            for (name, table) in &schema.tables {
                if table.expire.is_some() && table.constraints.iter().any(|c| matches!(c, Constraint::Cap { .. })) {
                    walk(&tx, catalog[name], |_, row| tx.update_cap_counts(name, table, None, Some(&row)).map(|_| ()))?;
                }
            }
            tx.set_meta("cap_counts_schema", &schema_hash)?;
        }
        build(&tx, changed)?;
        if schema_changed {
            for (name, table) in &schema.tables {
                walk(&tx, catalog[name], |_, mut row| {
                    materialize_optional_fields(&mut row, table);
                    if programs.is_none() { if let Value::Row(fields) = &mut row { fields.remove("pending"); } }
                    crate::engine::validate::validate_row(schema, name, &row)?;
                    for (column, kind) in &table.columns { validate_assets(&tx, kind, row.field(column).ok())?; }
                    Ok(())
                })?;
                for (index_name, index) in table.indexes.iter().filter(|(_, i)| i.unique) {
                    validate_groups(&tx, name, index_name, index.components.len(), 1, true)?;
                }
                for constraint in &table.constraints {
                    if let Constraint::Cap { by, max } = constraint {
                        let (index_name, _) = table.indexes.iter().find(|(_, i)| i.columns().starts_with(by)).ok_or_else(|| RuntimeError::Schema(format!("{name} cap has no matching index")))?;
                        validate_groups(&tx, name, index_name, by.len(), u64::from(*max), false)?;
                    }
                }
            }
        }
        if schema_changed {
            // A removed asset home is retired in the same transaction as its
            // projection. The ordinary collector removes bytes after commit.
            let homes: Vec<(String, String)> = tx.tx.prepare("SELECT DISTINCT home_table, home_column FROM _assets WHERE home_table IS NOT NULL AND released_at IS NULL")?.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?.collect::<Result<_, _>>()?;
            for (table, column) in homes {
                if schema.table(&table).and_then(|t| t.columns.get(&column)).is_none_or(|kind| !contains_asset_type(kind)) {
                    tx.tx.execute("UPDATE _assets SET released_at = ?3 WHERE home_table = ?1 AND home_column = ?2 AND released_at IS NULL", params![table, column, crate::now_ms()])?;
                }
            }
        }
        let previous = tx.tx.query_row("SELECT value FROM _meta WHERE key = 'generation'", [], |row| row.get::<_, String>(0)).optional()?.and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
        let generation = if programs.is_some() && changed { previous.checked_add(1).ok_or_else(|| RuntimeError::Generation("generation overflow".into()))? } else { previous.max(1) };
        tx.set_meta("schema_hash", &schema_hash)?;
        if let (Some(hash), Some(programs)) = (&activation_hash, programs) {
            tx.set_meta("activation_hash", hash)?;
            tx.set_meta("generation", &generation.to_string())?;
            if changed {
                tx.tx.execute("INSERT INTO _generations(generation, schema, programs, at) VALUES (?1, ?2, ?3, ?4)", params![i64::try_from(generation).map_err(|_| RuntimeError::Generation("generation overflow".into()))?, canonical_json(schema), canonical_json(programs), crate::now_ms()])?;
            }
        }
        let after = identity(&tx.tx)?;
        tx.commit()?;
        self.catalog = catalog;
        self.identity = after;
        Ok(generation)
    }
}

/// Bounded row buffers even for a large activation. Updating an image does
/// not change the primary key the next page resumes after.
pub(super) fn walk(tx: &Tx<'_>, table: i64, mut visit: impl FnMut(&str, Value) -> Result<(), RuntimeError>) -> Result<(), RuntimeError> {
    let mut after: Option<String> = None;
    loop {
        // Keep the continuation predicate sargable: `? IS NULL OR id > ?`
        // makes SQLite scan each preceding page again instead of seeking.
        let query = if after.is_some() { "SELECT id, data FROM r WHERE t = ?1 AND id > ?2 ORDER BY id LIMIT 500" } else { "SELECT id, data FROM r WHERE t = ?1 AND ?2 IS NULL ORDER BY id LIMIT 500" };
        let rows: Vec<(String, String)> = tx.tx.prepare(query)?
            .query_map(params![table, after], |row| Ok((row.get(0)?, row.get(1)?)))?.collect::<Result<_, _>>()?;
        for (id, data) in &rows { visit(id, serde_json::from_str(data).map_err(|e| RuntimeError::Store(e.to_string()))?)?; }
        if rows.len() < 500 { return Ok(()); }
        after = rows.last().map(|row| row.0.clone());
    }
}

/// Equal prefixes are adjacent in an index. Validate uniqueness and caps
/// in one bounded pass per invariant, retaining one key rather than one
/// allocation for every group/row in a potentially large activation.
fn validate_groups(tx: &Tx<'_>, table: &str, index: &str, prefix_len: usize, max: u64, nulls_distinct: bool) -> Result<(), RuntimeError> {
    let mut bounds = Bounds::default();
    let mut previous: Option<Vec<Value>> = None;
    let mut count = 0;
    loop {
        let rows = tx.scan(table, index, &[], &bounds, Dir::Asc, 500)?;
        for (_, key) in &rows {
            let full = crate::key::decode(key).ok_or_else(|| RuntimeError::Store("invalid rebuilt index key".into()))?;
            let group = full[..prefix_len].to_vec();
            bounds.after = Some(full);
            if nulls_distinct && group.contains(&Value::Null) { continue; }
            if previous.as_ref() == Some(&group) { count += 1; } else { previous = Some(group); count = 1; }
            if count > max { return Err(RuntimeError::Constraint(format!("cannot activate {table}.{index}: existing group exceeds {}", if nulls_distinct { "a unique key".to_owned() } else { format!("cap {max}") }))); }
        }
        if rows.len() < 500 { return Ok(()); }
    }
}

fn contains_asset_type(kind: &crate::schema::ColumnType) -> bool {
    use crate::schema::ColumnType::*;
    match kind { Optional(inner) | List { of: inner, .. } => contains_asset_type(inner), Image { .. } | Video { .. } => true, _ => false }
}
pub(super) fn validate_assets(tx: &Tx<'_>, kind: &crate::schema::ColumnType, value: Option<&Value>) -> Result<(), RuntimeError> {
    use crate::schema::ColumnType::*;
    use crate::assets::AssetKind;
    match (kind, value) {
        (Optional(inner), Some(value)) => validate_assets(tx, inner, Some(value)),
        (List { of, .. }, Some(Value::Array(values))) => { for value in values { validate_assets(tx, of, Some(value))?; } Ok(()) },
        (Image { max, .. } | Video { max }, Some(value)) => {
            if let Some(id) = crate::assets::asset_id(Some(value)) {
                if let Some(asset) = tx.asset(id)? {
                    let wanted = if matches!(kind, Image { .. }) { AssetKind::Image } else { AssetKind::Video };
                    if asset.kind != wanted { return Err(RuntimeError::Asset { code: "E_ASSET_TYPE", message: format!("cannot activate: {id} is {}, not {}", asset.kind.word(), wanted.word()) }); }
                    if asset.bytes > u64::from(*max) { return Err(RuntimeError::Asset { code: "E_ASSET_TOO_LARGE", message: format!("cannot activate: {id} has {} bytes; the column takes at most {max}", asset.bytes) }); }
                }
            }
            Ok(())
        },
        _ => Ok(())
    }
}
