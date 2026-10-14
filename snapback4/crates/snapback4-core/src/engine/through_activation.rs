//! The generation barrier checks predecessor audiences before destructive projection.
// @ref LLP 3000.014#7-activation — pinned time, child scan, capture before validation, atomic publication.
use crate::{
    error::RuntimeError,
    rows::{Bounds, Dir, Rows},
    schema::{RuleExpr, Schema, Table, through::PARENT_DEADLINE},
    value::Value,
};
use std::collections::BTreeMap;

/// Only inherited batches need staging. Preserve the streaming path for
/// existing schemas, including large fixture imports.
pub(crate) fn ancestor_order<'a, I>(
    schema: &Schema,
    rows: I,
) -> Box<dyn Iterator<Item = (String, Value)> + 'a>
where
    I: IntoIterator<Item = (String, Value)>,
    I::IntoIter: 'a,
{
    if schema.tables.values().all(|t| t.through.is_none()) {
        return Box::new(rows.into_iter());
    }
    let order = schema.through_order();
    let mut rows: Vec<_> = rows.into_iter().collect();
    rows.sort_by_key(|(name, _)| order.iter().position(|n| n == name).unwrap_or(usize::MAX));
    Box::new(rows.into_iter())
}

fn refusal(name: &str, count: usize, reason: &str, samples: &[String]) -> RuntimeError {
    RuntimeError::Structural {
        code: "E_READ_THROUGH_ADOPT",
        message: format!(
            "{name}: {count} child rows cannot adopt read through: {reason}; sample ids/parent values [{}]; rewrite: reconcile the named audience fields and live parents in a bridge release, then `snapback4 deploy <dir> --restore-dormant` (guide rules)",
            samples.join(", ")
        ),
    }
}

fn sample(samples: &mut Vec<String>, row: &Value, reference: &str, parent: &str) {
    fn bounded(text: &str) -> &str {
        let mut end = text.len().min(256);
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        &text[..end]
    }
    if samples.len() < 5 {
        let id = row
            .field("id")
            .ok()
            .and_then(|v| v.as_str().ok())
            .unwrap_or("<missing>");
        let value = row
            .field(reference)
            .ok()
            .and_then(|v| v.as_str().ok())
            .unwrap_or("<missing>");
        samples.push(format!(
            "{}: {reference} -> {parent}[{}]",
            bounded(id),
            bounded(value)
        ));
    }
}

fn rows(
    tx: &dyn Rows,
    name: &str,
    mut visit: impl FnMut(Value) -> Result<(), RuntimeError>,
) -> Result<(), RuntimeError> {
    let mut bounds = Bounds::default();
    loop {
        let page = tx.scan(name, "byId", &[], &bounds, Dir::Asc, 256)?;
        if page.is_empty() {
            return Ok(());
        }
        for (row, key) in page {
            bounds.after = crate::key::decode(&key);
            visit(row)?;
        }
    }
}

fn correspondence(
    child: &RuleExpr,
    parent: &RuleExpr,
) -> Option<std::collections::BTreeMap<String, String>> {
    if child.is_uniformly_readable() && parent.is_uniformly_readable() {
        return Some(Default::default());
    }
    fn walk(
        a: &serde_json::Value,
        b: &serde_json::Value,
        map: &mut std::collections::BTreeMap<String, String>,
    ) -> bool {
        use serde_json::Value::*;
        match (a, b) {
            (Object(a), Object(b)) if a.len() == b.len() => {
                if let (Some(String(a)), Some(String(b))) = (a.get("Field"), b.get("Field")) {
                    if map.get(a).is_some_and(|old| old != b)
                        || map.iter().any(|(old, v)| v == b && old != a)
                    {
                        return false;
                    }
                    map.insert(a.clone(), b.clone());
                    true
                } else {
                    a.iter()
                        .all(|(k, a)| b.get(k).is_some_and(|b| walk(a, b, map)))
                }
            }
            (Array(a), Array(b)) if a.len() == b.len() => {
                a.iter().zip(b).all(|(a, b)| walk(a, b, map))
            }
            _ => a == b,
        }
    }
    let mut map = Default::default();
    walk(
        &serde_json::to_value(child).ok()?,
        &serde_json::to_value(parent).ok()?,
        &mut map,
    )
    .then_some(map)
}

/// The retirement phase shared by activation and its read-only occupancy
/// preview. Selection and the predecessor deadline predicate live here once;
/// checking a candidate must not count a row this phase would remove.
pub(crate) struct Retirement<'a> {
    affected: Vec<(String, &'a Table)>,
    now: i64,
}

impl<'a> Retirement<'a> {
    pub(crate) fn new(next: &Schema, previous: &'a Schema, now: i64) -> Self {
        let affected = next
            .through_order()
            .into_iter()
            .filter_map(|name| {
                let next = &next.tables[&name];
                let old = previous.table(&name)?;
                Self::changes_lifetime(next,old).then_some((name, old))
            })
            .collect();
        Self { affected, now }
    }

    fn changes_lifetime(next:&Table,old:&Table) -> bool {
        next.through != old.through || next.through.is_some() && (next.expire != old.expire || next.expire.as_ref().is_some_and(|field|old.defaults.get(field)!=next.defaults.get(field)))
    }

    pub(crate) fn retires_image(next:&Table,old:&Table,row:&Value,now:i64) -> bool {
        (next.through!=old.through || next.expire!=old.expire || old.expire.as_ref().is_some_and(|field|old.defaults.get(field)!=next.defaults.get(field))) && old.expired(row,now)
    }

    pub(crate) fn affects(&self, name: &str) -> bool {
        self.affected.iter().any(|(table, _)| table == name)
    }

    pub(crate) fn retires(&self, name: &str, row: &Value) -> bool {
        self.affected
            .iter()
            .find(|(table, _)| table == name)
            .is_some_and(|(_, old)| old.expired(row, self.now))
    }
}

/// Capture barrier for an authoritative adapter's uncommitted generation.
pub fn activate(
    tx: &dyn Rows,
    next: &Schema,
    previous: Option<&Schema>,
    now: i64,
) -> Result<std::collections::BTreeMap<String, u64>, RuntimeError> {
    activate_retained(tx, next, previous, now, &Default::default())
}

pub(crate) fn activate_retained(
    tx: &dyn Rows,
    next: &Schema,
    previous: Option<&Schema>,
    now: i64,
    retained: &std::collections::BTreeSet<String>,
) -> Result<std::collections::BTreeMap<String, u64>, RuntimeError> {
    let mut shortened = std::collections::BTreeMap::new();
    let Some(previous) = previous else {
        return Ok(shortened);
    };
    // Previous indexes and row images still exist. Every affected expired row
    // retires under its old deadline, before a new default or capture can revive it.
    let retirement = Retirement::new(next, previous, now);
    for (name, old) in retirement.affected.iter().rev() {
        rows(tx, name, |row| {
            if retirement.retires(name, &row) {
                tx.delete(name, old, &row)?;
            }
            Ok(())
        })?;
    }
    // Compare all predecessor images before any ancestor is recaptured.
    for (name, _) in &retirement.affected {
        let Some(t) = &next.tables[name].through else {
            continue;
        };
        let Some(old) = previous.table(name).filter(|t| t.through.is_none()) else {
            continue;
        };
        let parent = previous
            .table(&t.parent)
            .ok_or_else(|| refusal(name, 0, "the previous parent schema is absent", &[]))?;
        let map = correspondence(&old.rules.read, &parent.rules.read);
        let mut invalid = 0;
        let mut samples = Vec::new();
        rows(tx, name, |row| {
            // @ref LLP 3000.000.000#10-wave-10-release-lifecycle-amendment — historical capture restoration needs no audience recapture.
            if retained.contains(name) && row.field(PARENT_DEADLINE).is_ok() && t.fields.keys().all(|f|row.field(f).is_ok()) {return Ok(());}
            let Some(map) = &map else {
                invalid += 1;
                sample(&mut samples, &row, &t.reference, &t.parent);
                return Ok(());
            };
            let row = crate::schema::row_image(&row, old);
            let parent_row = row
                .field(&t.reference)
                .ok()
                .and_then(|id| id.as_str().ok())
                .map(|id| tx.get(&t.parent, id))
                .transpose()?
                .flatten();
            let matches = parent_row.as_ref().is_some_and(|image| {
                !parent.expired(image, now) && {
                    let image = crate::schema::row_image(image, parent);
                    map.iter()
                        .all(|(child, p)| row.field(child).ok() == image.field(p).ok())
                }
            });
            if !matches {
                invalid += 1;
                sample(&mut samples, &row, &t.reference, &t.parent);
            }
            Ok(())
        })?;
        if invalid > 0 {
            return Err(refusal(
                name,
                invalid,
                "missing, ambiguous or disagreeing predecessor audience correspondence",
                &samples,
            ));
        }
    }
    for name in next.through_order() {
        let table = &next.tables[&name];
        let Some(t) = &table.through else {
            continue;
        };
        let parent = &next.tables[&t.parent];
        let recapture = previous.table(&name).and_then(|t| t.through.as_ref()) != Some(t);
        let mut invalid = 0;
        let mut samples = Vec::new();
        rows(tx, &name, |old| {
            let mut row = old.clone();
            // @ref LLP 3000.000.000#2-retain-by-default — restored audience/deadline captures retain their original lifetime.
            let historical = retained.contains(&name) && old.field(PARENT_DEADLINE).is_ok();
            if recapture && (!historical || t.fields.keys().any(|field| old.field(field).is_err()))
            {
                let parent_row = old
                    .field(&t.reference)
                    .ok()
                    .and_then(|id| id.as_str().ok())
                    .map(|id| tx.get(&t.parent, id))
                    .transpose()?
                    .flatten();
                // @ref LLP 3000.014#7-activation — previous-schema expiry was retired before projection; a newly due deadline must propagate, not veto adoption.
                let Some(parent_row) = parent_row else {
                    invalid += 1;
                    sample(&mut samples, &old, &t.reference, &t.parent);
                    return Ok(());
                };
                if historical {
                    let mut fresh = row.clone();
                    super::through::stamp(parent, t, &parent_row, &mut fresh)?;
                    if let Value::Row(fields) | Value::Map(fields) = &mut row {
                        for field in t.fields.keys().filter(|field| old.field(field).is_err()) {
                            fields.insert(field.clone(), fresh.field(field)?.clone());
                        }
                    }
                } else {
                    super::through::stamp(parent, t, &parent_row, &mut row)?;
                }
            }
            table.recompute_deadline(&mut row)?;
            let before = previous.table(&name).and_then(|table| table.deadline(&old));
            if table
                .deadline(&row)
                .is_some_and(|after| before.is_none_or(|before| after < before))
            {
                *shortened.entry(name.clone()).or_default() += 1;
            }
            tx.put(&name, table, &row, Some(&old))?;
            Ok(())
        })?;
        if invalid > 0 {
            return Err(refusal(&name, invalid, "missing parent", &samples));
        }
    }
    Ok(shortened)
}

/// Trusted restoration validates the existing immutable captures; it never stamps them.
pub fn validate_restore(tx: &dyn Rows, schema: &Schema, now: i64) -> Result<(), RuntimeError> {
    for name in schema.through_order() {
        let table = &schema.tables[&name];
        let Some(t) = &table.through else {
            continue;
        };
        let parent = &schema.tables[&t.parent];
        let mut invalid = 0;
        let mut samples = Vec::new();
        rows(tx, &name, |row| {
            let found = row
                .field(&t.reference)
                .ok()
                .and_then(|v| v.as_str().ok())
                .map(|id| tx.get(&t.parent, id))
                .transpose()?
                .flatten();
            let matches = found.as_ref().is_some_and(|p| {
                (!parent.expired(p, now) || table.expired(&row, now)) && {
                    let p = crate::schema::row_image(p, parent);
                    t.fields
                        .iter()
                        .all(|(field, source)| row.field(field).ok() == p.field(source).ok())
                        && row.field(PARENT_DEADLINE).ok()
                            == Some(&parent.deadline(&p).map(Value::Int).unwrap_or(Value::Null))
                }
            });
            if !matches {
                invalid += 1;
                sample(&mut samples, &row, &t.reference, &t.parent);
            }
            Ok(())
        })?;
        if invalid > 0 {
            return Err(refusal(
                &name,
                invalid,
                "restored captures do not match a live parent",
                &samples,
            ));
        }
    }
    Ok(())
}

pub fn validate_indexes(tx: &dyn Rows, schema: &Schema) -> Result<(), RuntimeError> {
    for (name, table) in &schema.tables {
        let mut checks: Vec<_> = table
            .indexes
            .iter()
            .filter(|(_, i)| i.unique)
            .map(|(name, i)| (name, i.components.len(), 1, true))
            .collect();
        for constraint in &table.constraints {
            if let crate::schema::Constraint::Cap { by, max } = constraint {
                let (index, _) = table
                    .indexes
                    .iter()
                    .find(|(_, i)| i.columns().starts_with(by))
                    .ok_or_else(|| RuntimeError::Schema(format!("{name} cap has no index")))?;
                checks.push((index, by.len(), u64::from(*max), false));
            }
        }
        for (index, width, max, nulls_distinct) in checks {
            let mut bounds = Bounds::default();
            let mut previous = None;
            let mut count = 0;
            loop {
                let page = tx.scan(name, index, &[], &bounds, Dir::Asc, 256)?;
                if page.is_empty() {
                    break;
                }
                for (_, key) in page {
                    let full = crate::key::decode(&key)
                        .ok_or_else(|| RuntimeError::Store("invalid activation index".into()))?;
                    let group = full[..width].to_vec();
                    bounds.after = Some(full);
                    if nulls_distinct && group.contains(&Value::Null) {
                        continue;
                    }
                    if previous.as_ref() == Some(&group) {
                        count += 1;
                    } else {
                        previous = Some(group);
                        count = 1;
                    }
                    if count > max {
                        return Err(RuntimeError::Constraint(format!(
                            "cannot activate {name}.{index}: existing group exceeds {max}"
                        )));
                    }
                }
            }
        }
    }
    Ok(())
}

impl super::runner::Runner<'_> {
    /// Authoritative adapters feed an ancestor-ordered batch to the ordinary
    /// insert/update path; captures always resolve inside this transaction.
    pub fn seed_server_rows(
        &mut self,
        rows: impl IntoIterator<Item = (String, Value)>,
    ) -> Result<u64, RuntimeError> {
        if !self.context.is_system() || self.device {
            return Err(RuntimeError::Input(
                "server seed requires system authority".into(),
            ));
        }
        let order = self.schema.through_order();
        let mut rows: Vec<_> = rows.into_iter().collect();
        rows.sort_by_key(|(n, _)| order.iter().position(|x| x == n));
        let count = rows.len() as u64;
        for (name, row) in rows {
            super::timeline::check_import(self.schema, &name)?;
            // Adoption rewrites are system imports of stored images (LLP 3000.015 §1).
            self.upsert(
                &name,
                &row.field("id")?.clone(),
                row.import_input(&super::ImportInput(())),
            )?;
        }
        self.check_final_exists()?;
        Ok(count)
    }

    /// A bounded child-first sweep on the common Rows interface.
    pub fn sweep_server_rows(&mut self, limit: usize, expiry_after: &mut BTreeMap<String, Vec<Value>>) -> Result<u64, RuntimeError> {
        if !self.context.is_system() || self.device {
            return Err(RuntimeError::Input(
                "server sweep requires system authority".into(),
            ));
        }
        let now = self
            .context
            .now
            .ok_or_else(|| RuntimeError::Input("sweep clock is not pinned".into()))?;
        let mut count = 0;
        let mut visited = 0;
        for name in self.schema.through_order().into_iter().rev() {
            let Some((index, _)) = self.schema.tables[&name].expiry_index() else {
                continue;
            };
            let due = Bounds { gte: Some(Value::Int(i64::MIN)), lte: Some(Value::Int(now)), ..Default::default() };
            let mut bounds = due.clone();
            bounds.after = expiry_after.get(&name).cloned();
            let mut wrapped = bounds.after.is_none();
            while visited < limit {
                let batch = (limit - visited).min(256);
                let page = self.metered_scan(|runner, scope| {
                    runner
                        .tx
                        .scan(scope, &name, index, &[], &bounds, Dir::Asc, batch)
                })?;
                if page.is_empty() {
                    expiry_after.remove(&name);
                    if !wrapped && visited < limit {
                        bounds = due.clone();
                        wrapped = true;
                        continue;
                    }
                    break;
                }
                let page_len = page.len();
                for (row, key) in page {
                    bounds.after = crate::key::decode(&key);
                    if let Some(after) = &bounds.after { expiry_after.insert(name.clone(), after.clone()); }
                    visited += 1;
                    match self.retire_expired_row(&name, &row) {
                        Ok(true) => count += 1,
                        Ok(false) => {},
                        Err(RuntimeError::Structural { code: "E_REFERENCED", .. }) => {},
                        Err(error) => return Err(error),
                    }
                }
                if page_len < batch {
                    expiry_after.remove(&name);
                    if !wrapped && visited < limit {
                        bounds = due.clone();
                        wrapped = true;
                        continue;
                    }
                    break;
                }
            }
        }
        Ok(count)
    }
}
