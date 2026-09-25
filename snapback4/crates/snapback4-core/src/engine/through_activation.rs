//! The generation barrier checks predecessor audiences before destructive projection.
// @ref LLP 3000.014#7-activation — pinned time, child scan, capture before validation, atomic publication.
use crate::{
    error::RuntimeError,
    rows::{Bounds, Dir, Rows},
    schema::{RuleExpr, Schema, through::PARENT_DEADLINE},
    value::Value,
};

fn refusal(name: &str, count: usize, reason: &str) -> RuntimeError {
    RuntimeError::Structural {
        code: "E_READ_THROUGH_ADOPT",
        message: format!(
            "{name}: {count} child rows cannot adopt read through: {reason}; reconcile their audience fields and live parents before adoption (guide rules)"
        ),
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

/// Capture barrier for an authoritative adapter's uncommitted generation.
pub fn activate(
    tx: &dyn Rows,
    next: &Schema,
    previous: Option<&Schema>,
    now: i64,
) -> Result<std::collections::BTreeMap<String, u64>, RuntimeError> {
    let mut shortened = std::collections::BTreeMap::new();
    let Some(previous) = previous else {
        return Ok(shortened);
    };
    // Previous indexes and row images still exist. Every affected expired row
    // retires under its old deadline, before a new default or capture can revive it.
    let affected: Vec<_> = next
        .through_order()
        .into_iter()
        .filter(|name| {
            let next = &next.tables[name];
            let old = previous.table(name);
            next.through != old.and_then(|t| t.through.clone())
                || next.through.is_some()
                    && (next.expire.as_ref() != old.and_then(|t| t.expire.as_ref())
                        || next.expire.as_ref().is_some_and(|field| {
                            old.is_some_and(|t| t.defaults.get(field) != next.defaults.get(field))
                        }))
        })
        .collect();
    for name in affected.iter().rev() {
        if let Some(old) = previous.table(name) {
            rows(tx, name, |row| {
                if old.expired(&row, now) {
                    tx.delete(name, old, &row)?;
                }
                Ok(())
            })?;
        }
    }
    // Compare all predecessor images before any ancestor is recaptured.
    for name in &affected {
        let Some(t) = &next.tables[name].through else {
            continue;
        };
        let Some(old) = previous.table(name).filter(|t| t.through.is_none()) else {
            continue;
        };
        let parent = previous
            .table(&t.parent)
            .ok_or_else(|| refusal(name, 0, "the previous parent schema is absent"))?;
        let map = correspondence(&old.rules.read, &parent.rules.read);
        let mut invalid = 0;
        rows(tx, name, |row| {
            let Some(map) = &map else {
                invalid += 1;
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
            }
            Ok(())
        })?;
        if invalid > 0 {
            return Err(refusal(
                name,
                invalid,
                "missing, ambiguous or disagreeing predecessor audience correspondence",
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
        rows(tx, &name, |old| {
            let mut row = old.clone();
            if recapture {
                let parent_row = old
                    .field(&t.reference)
                    .ok()
                    .and_then(|id| id.as_str().ok())
                    .map(|id| tx.get(&t.parent, id))
                    .transpose()?
                    .flatten();
                let Some(parent_row) = parent_row.filter(|r| !parent.expired(r, now)) else {
                    invalid += 1;
                    return Ok(());
                };
                super::through::stamp(parent, t, &parent_row, &mut row)?;
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
            return Err(refusal(&name, invalid, "missing or expired parent"));
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
            }
            Ok(())
        })?;
        if invalid > 0 {
            return Err(refusal(
                &name,
                invalid,
                "restored captures do not match a live parent",
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
            self.upsert(&name, &row.field("id")?.clone(), row)?;
        }
        self.check_final_exists()?;
        Ok(count)
    }

    /// A bounded child-first sweep on the common Rows interface.
    pub fn sweep_server_rows(&mut self, limit: usize) -> Result<u64, RuntimeError> {
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
        for name in self.schema.through_order().into_iter().rev() {
            let Some((index, _)) = self.schema.tables[&name].expiry_index() else {
                continue;
            };
            while count < limit as u64 {
                let page = self.tx.scan(
                    &name,
                    index,
                    &[],
                    &Bounds {
                        gte: Some(Value::Int(i64::MIN)),
                        lte: Some(Value::Int(now)),
                        ..Default::default()
                    },
                    Dir::Asc,
                    (limit - count as usize).min(256),
                )?;
                if page.is_empty() {
                    break;
                }
                let mut progress = false;
                for (row, _) in page {
                    if self.physical_children(&name, row.field("id")?)? {
                        continue;
                    }
                    self.remove(&name, &row)?;
                    count += 1;
                    progress = true;
                }
                if !progress {
                    break;
                }
            }
        }
        Ok(count)
    }
}
