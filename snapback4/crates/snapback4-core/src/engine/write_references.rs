//! Referential actions on delete (LLP 3000.038 §3): before a delete removes
//! its row, reserve a schema-fixed charge, close over the `cascade`
//! references, refuse while a `restrict` reference still holds a closure row
//! from outside the closure, clear `set null` references outside it, and
//! remove the closure children first. The caller then removes the row itself.
// @ref LLP 3000.038#3 — closure first; probes exclude the closure; deletion dominates set null.
use super::Origin;
use crate::engine::runner::Runner;
use crate::{
    error::{MeterKind, RuntimeError},
    meter::{Ceilings, Cut, Meter},
    rows::{Bounds, Dir},
    schema::{Effect, references::{OnDelete, Referencing}},
    value::Value,
};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

impl Runner<'_> {
    pub(super) fn apply_reference_actions(&mut self, table_name: &str, old: &Value) -> Result<(), RuntimeError> {
        let schema = self.schema;
        if !schema.is_referenced(table_name) { return Ok(()); }
        let Some(price) = schema.delete_reservation(table_name) else {
            // A device without a reached child's exported price cannot charge
            // what the server charges; the server always has every price.
            if self.device { return Err(RuntimeError::Prediction(format!("deleting {table_name} needs every referencing table's write price; queued without a local delete"))); }
            return Err(RuntimeError::Schema(format!("{table_name}'s delete actions have no reservation: a cascading reference lacks its cap or its child's write price (guide writes)")));
        };
        // @ref LLP 3000.038#4.2 — what the commit publishes is fixed by the schema, not by the rows the actions reach.
        let closure = schema.action_tables(table_name);
        for table in &closure.written { if schema.visible(table) { self.written_tables.insert(table.clone()); } }
        for table in &closure.read { self.read_tables.insert(table.clone()); }
        if !closure.written.is_empty() { self.tx.widen_change_evidence(); }
        for (kind, amount) in [(MeterKind::Steps, price[0]), (MeterKind::IndexEntries, price[1]), (MeterKind::Examined, price[2]), (MeterKind::RowsWritten, price[3]), (MeterKind::RuleProbes, price[6])] {
            if amount > 0 { self.meter.charge(kind, amount)?; }
        }
        let mark = self.meter.mark();
        self.meter.heap(price[4])?;
        // @ref LLP 3000.038#3 — draw the reservation's rows from the request's physical allowance before the first seek.
        if !self.context.is_system() { self.tx.draw(table_name, price[2])?; }
        let meter = std::mem::replace(&mut self.meter, Meter::new(Ceilings::unbounded(), Cut::Abort));
        let result = self.reference_closure(table_name, old);
        self.meter = meter;
        self.meter.release_heap(mark);
        result
    }

    /// Steps 3–6.
    fn reference_closure(&mut self, root_table: &str, root: &Value) -> Result<(), RuntimeError> {
        let schema = self.schema;
        let key = |table: &str, row: &Value| -> Result<(String, String), RuntimeError> { Ok((table.to_owned(), row.field("id")?.as_str()?.to_owned())) };
        let mut seen: BTreeSet<(String, String)> = BTreeSet::from([key(root_table, root)?]);
        let mut reached: Vec<(String, Value)> = Vec::new();
        let mut visits: Vec<(String, Value)> = vec![(root_table.to_owned(), root.field("id")?.clone())];
        let mut queue: VecDeque<(String, Value)> = VecDeque::from([(root_table.to_owned(), root.field("id")?.clone())]);
        // 3. Close over cascades. Every reached row's referencing groups must be held on a device.
        while let Some((table, id)) = queue.pop_front() {
            for r in schema.referencing(&table).collect::<Vec<_>>() {
                if self.device && !through_reference(&r) { self.prove_reference_held(&r, &id)?; }
                if r.action != OnDelete::Cascade { continue; }
                for child in self.live_children(&r, &id)? {
                    if seen.insert(key(r.child, &child)?) {
                        let child_id = child.field("id")?.clone();
                        queue.push_back((r.child.to_owned(), child_id.clone()));
                        visits.push((r.child.to_owned(), child_id));
                        reached.push((r.child.to_owned(), child));
                    }
                }
            }
        }
        // 4. Restrict: every probe runs; the first occupied reference in schema order is reported.
        let mut occupied: BTreeSet<(String, String, String)> = BTreeSet::new();
        for (table, id) in &visits {
            for r in schema.referencing(table).filter(|r| r.action == OnDelete::Restrict && !through_reference(r)).collect::<Vec<_>>() {
                let outside = self.live_children(&r, id)?.into_iter().any(|row| key(r.child, &row).is_ok_and(|k| !seen.contains(&k)));
                if outside { occupied.insert((r.child.to_owned(), r.column.to_owned(), table.clone())); }
            }
        }
        if let Some((child, column, parent)) = occupied.into_iter().next() {
            #[cfg(feature = "sqlite")]
            self.refusing_clause(&child, &format!("{column}: {parent} (on delete restrict)"));
            return Err(RuntimeError::Structural { code: "E_REFERENCED", message: format!("{root_table} at {} is still referenced through {child}.{column} ({parent} rows reached by this delete are named by live {child} rows; on delete restrict); delete or retarget those rows first, or declare the reference's action (guide writes)", self.statement_site) });
        }
        // 5. Set null outside the closure, each from its current image.
        for (table, id) in &visits {
            for r in schema.referencing(table).filter(|r| r.action == OnDelete::SetNull).collect::<Vec<_>>() {
                for row in self.live_children(&r, id)? {
                    let row_key = key(r.child, &row)?;
                    if seen.contains(&row_key) { continue; }
                    self.clear_reference(r.child, r.column, row)?;
                    self.action_rows.insert(row_key);
                }
            }
        }
        // 6. Delete the closure, children first, each from its current image.
        let order = deletion_order(schema, &reached);
        for (table, row) in order {
            let id = row.field("id")?.as_str()?.to_owned();
            let current = self.metered_scan(|runner, allowance| runner.tx.get(allowance, &table, &id))?;
            let Some(current) = current else { continue };
            self.delete_reached(&table, current)?;
            self.action_rows.insert((table, id));
        }
        Ok(())
    }

    /// The live rows referencing `id` through `r`, found through its index.
    fn live_children(&mut self, r: &Referencing<'_>, id: &Value) -> Result<Vec<Value>, RuntimeError> {
        let schema = self.schema;
        let index = schema.reference_index(r.child, r.column).ok_or_else(|| RuntimeError::Schema(format!("{}.{} has no reference index", r.child, r.column)))?.to_owned();
        let expiring = r.table.expire.is_some() && !through_reference(r);
        let mut rows = Vec::new();
        if expiring {
            let now = self.context.now.ok_or_else(|| RuntimeError::Input("delete clock is not pinned".into()))?;
            for (prefix, bounds) in [(vec![id.clone(), Value::Null], Bounds::default()), (vec![id.clone()], Bounds { gt: Some(Value::Int(now)), ..Default::default() })] {
                rows.extend(self.metered_scan(|runner, allowance| runner.tx.scan(allowance, r.child, &index, &prefix, &bounds, Dir::Asc, usize::MAX))?.into_iter().map(|(row, _)| row));
            }
        } else {
            rows.extend(self.metered_scan(|runner, allowance| runner.tx.scan(allowance, r.child, &index, std::slice::from_ref(id), &Bounds::default(), Dir::Asc, usize::MAX))?.into_iter().map(|(row, _)| row));
        }
        let mut live = Vec::with_capacity(rows.len());
        for row in rows {
            if self.device {
                // @ref LLP 3000.014#5 — retained history is outside the quantifier; only a live, current (or own provisional) row is a witness.
                if self.tx.retained_row(r.child, &row)? && !self.tx.current_row(r.child, &row)? { continue; }
                if self.expired(r.table, &row) || !(self.tx.current_row(r.child, &row)? || self.is_provisional(r.child, &row)?) {
                    return Err(RuntimeError::Prediction(format!("deleting needs a current image of every {} row that references it; queued without a local delete", r.child)));
                }
            } else if self.expired(r.table, &row) { continue; }
            live.push(row);
        }
        Ok(live)
    }

    /// A device predicts only over a referencing group it holds completely.
    // @ref LLP 3000.038#6.4 — the held-group proof of LLP 3000.007 §20.5, per closure row and reference.
    fn prove_reference_held(&mut self, r: &Referencing<'_>, id: &Value) -> Result<(), RuntimeError> {
        let index = self.schema.reference_index(r.child, r.column).ok_or_else(|| RuntimeError::Schema(format!("{}.{} has no reference index", r.child, r.column)))?.to_owned();
        let (child, key) = (r.child.to_owned(), [id.clone()]);
        if self.device_work(|runner| runner.upsert_absence_proven(&child, &index, &key))? { return Ok(()); }
        Err(RuntimeError::Prediction(format!("deleting needs every {} row that references it held; queued without a local delete", r.child)))
    }

    /// The engine's own write of a `set null` reference: no rule, every constraint.
    fn clear_reference(&mut self, table: &str, column: &str, old: Value) -> Result<(), RuntimeError> {
        let mut new = old.clone();
        if let Value::Row(fields) | Value::Map(fields) = &mut new { fields.insert(column.to_owned(), Value::Null); }
        let patch = crate::value::object([(column, Value::Null)]);
        self.target_attempt(table, |runner| {
            runner.reserve_maintains(table, &runner.schema.tables[table])?;
            runner.replace_authorized(table, old, new, true, &patch, 0)
        })
    }

    /// The engine's own delete of a closure row: no rule, its constraints, its
    /// `read through` children's probe, maintains and partition events.
    fn delete_reached(&mut self, table_name: &str, old: Value) -> Result<(), RuntimeError> {
        self.target_attempt(table_name, |runner| {
            runner.refuse_engine_owned(table_name, Effect::Delete)?;
            let table = &runner.schema.tables[table_name];
            runner.reserve_maintains(table_name, table)?;
            runner.receipt_member_removed(table_name, &old)?;
            runner.refuse_live_children(table_name, old.field("id")?)?;
            runner.check_constraints(table_name, Some(&old), &old, Effect::Delete)?;
            let entries = runner.maintain_scratch(runner.contribution_heap(table), |runner| runner.tx.delete(table_name, table, &old))?;
            runner.charge_source_indexes(table, Some(&old), None, entries)?;
            runner.row_changed(table_name, Some(&old), None, Origin::Source)
        })
    }
}

fn through_reference(r: &Referencing<'_>) -> bool {
    r.table.through.as_ref().is_some_and(|t| t.reference == r.column)
}

/// The closure's rows, children before parents: a table whose rows reference
/// another reached table goes first (cascade graphs are acyclic; any other
/// cycle keeps discovery order), and within a table, later discoveries first.
fn deletion_order(schema: &crate::schema::Schema, reached: &[(String, Value)]) -> Vec<(String, Value)> {
    let tables: Vec<&str> = {
        let mut seen = Vec::new();
        for (table, _) in reached { if !seen.contains(&table.as_str()) { seen.push(table.as_str()); } }
        seen
    };
    // edges: child table -> parent tables it references (among the reached tables)
    let mut parents: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for &parent in &tables {
        for r in schema.referencing(parent) {
            if r.child != parent && tables.contains(&r.child) { parents.entry(r.child).or_default().insert(parent); }
        }
    }
    let mut order: Vec<&str> = Vec::new();
    let mut remaining = tables.clone();
    while !remaining.is_empty() {
        // A table no remaining table references can go now (its referencers are gone).
        let position = remaining.iter().position(|t| !remaining.iter().any(|other| other != t && parents.get(other).is_some_and(|p| p.contains(t))))
            .unwrap_or(remaining.len() - 1);
        order.push(remaining.remove(position));
    }
    let mut out = Vec::with_capacity(reached.len());
    for table in order {
        out.extend(reached.iter().rev().filter(|(t, _)| t == table).cloned());
    }
    out
}
