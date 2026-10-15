//! Referential actions on delete (LLP 3000.039 §3): before a delete removes
//! its row, reserve a schema-fixed charge, close over the `cascade`
//! references, refuse while a `restrict` reference still holds a closure row
//! from outside the closure, clear `set null` references outside it, and
//! remove the closure children first. The caller then removes the row itself.
// @ref LLP 3000.039#3 — closure first; probes exclude the closure; deletion dominates set null.
use crate::engine::runner::Runner;
use crate::{
    error::{MeterKind, RuntimeError},
    meter::{Ceilings, Cut, Meter},
    rows::{Bounds, Dir},
    schema::{Effect, references::{OnDelete, Referencing}},
    value::Value,
};
use std::collections::BTreeSet;

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
        // @ref LLP 3000.039#4.2 — what the commit publishes is fixed by the schema, not by the rows the actions reach.
        let closure = schema.action_tables(table_name);
        // A public device projection carries the private column's price but
        // not the maintain that computes its value. If an action can write
        // such a source, settlement must supply the authoritative mirror.
        // @ref LLP 3000.007.001#3.7 — devices store maintained columns but never derive them.
        if self.device && closure.written.iter().any(|source| schema.write_reservation(source)
            .is_some_and(|plan| plan.price(crate::schema::reservations::COLUMNS)[3] != 0)) {
            return Err(RuntimeError::Prediction(format!("deleting {table_name} can change a server-maintained column; queued without a local delete")));
        }
        for table in &closure.written {
            if schema.visible(table) { self.written_tables.insert(table.clone()); }
            self.action_tables.insert(table.clone());
        }
        for table in &closure.read { self.read_tables.insert(table.clone()); }
        if !closure.written.is_empty() { self.tx.widen_change_evidence(); }
        for (kind, amount) in [(MeterKind::Steps, price[0]), (MeterKind::IndexEntries, price[1]), (MeterKind::Examined, price[2]), (MeterKind::RowsWritten, price[3]), (MeterKind::OutputBytes, price[5]), (MeterKind::RuleProbes, price[6])] {
            if amount > 0 { self.meter.charge(kind, amount)?; }
        }
        // Pending event images survive the closure and subsequent statements.
        // Keep their schema-fixed reservation until the request ends.
        let events = schema.delete_event_heap(table_name).unwrap_or(0);
        self.meter.heap(events)?;
        let mark = self.meter.mark();
        self.meter.heap(price[4].saturating_sub(events))?;
        // @ref LLP 3000.039#3 — draw the reservation's rows from the request's physical allowance before the first seek.
        if !self.context.is_system() { self.tx.draw(table_name, price[2])?; }
        let meter = std::mem::replace(&mut self.meter, Meter::new(Ceilings::unbounded(), Cut::Abort));
        // The fixed action reservation prepays the closure itself, but held-
        // group and authority proofs remain device-only bounded work. Keep the
        // active allowance reachable by nested `device_work` calls while the
        // closure runs under its prepaid unbounded meter. Recursive cascade
        // removals see the already-stored allowance and must not take it over.
        // @ref LLP 3000.039#6.4 — every device-only proof spends the separate bounded physical-work allowance.
        let owns_device_allowance = self.device_work_active && self.device_allowance.is_none();
        let mut meter = Some(meter);
        if owns_device_allowance { self.device_allowance = meter.take(); }
        let prepaid = self.tx.reference_prepaid(true);
        let action = std::mem::replace(&mut self.engine_action, true);
        let result = self.reference_closure(table_name, old);
        self.engine_action = action;
        self.tx.reference_prepaid(prepaid);
        self.meter = if owns_device_allowance {
            self.device_allowance.take().expect("active device allowance")
        } else {
            meter.expect("prepaid action meter")
        };
        self.meter.release_heap(mark);
        result
    }

    /// Steps 3–6. The walk holds identities, never images: each child scan
    /// streams `PAGE` rows per seek, and every write rereads its row current.
    fn reference_closure(&mut self, root_table: &str, root: &Value) -> Result<(), RuntimeError> {
        let schema = self.schema;
        let mut seen: BTreeSet<(String, String)> = BTreeSet::from([(root_table.to_owned(), root.field("id")?.as_str()?.to_owned())]);
        // (Vectors, not maps: the web device pays for every new collection type.)
        let mut visits: Vec<(String, Value)> = vec![(root_table.to_owned(), root.field("id")?.clone())];
        // 3. Close over cascades, breadth first. Every reached row's referencing groups must be held on a device.
        let mut next = 0;
        while next < visits.len() {
            let (table, id) = visits[next].clone();
            next += 1;
            for r in schema.referencing(&table) {
                if self.device && !through_reference(&r) { self.prove_reference_held(&r, &id)?; }
                if r.action != OnDelete::Cascade { continue; }
                self.each_child(&r, &id, true, &mut |_, child| {
                    if seen.insert((r.child.to_owned(), child.as_str()?.to_owned())) { visits.push((r.child.to_owned(), child)); }
                    Ok(true)
                })?;
            }
        }
        // 4. Restrict: every probe runs, streaming past closure rows (the root
        // included) to the first outside witness; the first occupied reference
        // in schema order is reported. One reference's probes visit each closure
        // row at most once, plus one witness per probe (LLP 3000.039 §5.1).
        let mut occupied: Option<(String, String, String)> = None;
        for (table, id) in &visits {
            for r in schema.referencing(table) {
                if r.action != OnDelete::Restrict || through_reference(&r) { continue; }
                let mut outside = false;
                self.each_child(&r, id, false, &mut |_, child| {
                    outside = !seen.contains(&(r.child.to_owned(), child.as_str()?.to_owned()));
                    Ok(!outside)
                })?;
                let candidate = (r.child.to_owned(), r.column.to_owned(), table.clone());
                if outside && occupied.as_ref().is_none_or(|o| candidate < *o) { occupied = Some(candidate); }
            }
        }
        if let Some((child, column, parent)) = occupied {
            #[cfg(feature = "sqlite")]
            self.refusing_clause(&child, &format!("{column}: {parent} (on delete restrict)"));
            let via = if parent == root_table { String::new() } else { format!(", through a {parent} row this delete cascades to") };
            return Err(RuntimeError::Structural { code: "E_REFERENCED", message: format!("{root_table} at {} is still referenced through {child}.{column} (on delete restrict){via}; delete or retarget those rows first, or declare the reference's action (guide writes)", self.statement_site) });
        }
        // A cascaded row can itself have a physically retained read-through
        // child. Decide that blocker before set-null writes begin, so expiry
        // can retain this root and continue without relying on transaction
        // rollback to undo a partial closure.
        for (table, id) in visits.iter().skip(1) {
            if self.physical_children_outside(table, id, &seen)? {
                return Err(self.parent_has_children(table));
            }
        }
        // 5. Set null outside the closure. Each group is gathered whole before
        // any of it is cleared: a clear can recount a sibling that shares the
        // reference's index and move it behind a page cursor. Each row is then
        // reread current before its write.
        // @ref LLP 3000.039#3 — gather, then clear: no row moves out of a walk it has not finished.
        for (table, id) in &visits {
            for r in schema.referencing(table) {
                if r.action != OnDelete::SetNull { continue; }
                let mut group: Vec<String> = Vec::new();
                self.each_child(&r, id, true, &mut |_, child| {
                    let child = child.as_str()?.to_owned();
                    if !seen.contains(&(r.child.to_owned(), child.clone())) { group.push(child); }
                    Ok(true)
                })?;
                for child in group {
                    let current = self.metered_scan(|runner, allowance| runner.tx.get(allowance, r.child, &child))?;
                    if let Some(current) = current.filter(|row| row.field(r.column).is_ok_and(|v| v == id)) {
                        self.clear_reference(r.child, r.column, current)?;
                    }
                }
            }
        }
        // 6. Delete the closure, children first, each from its current image.
        let reached: Vec<(String, String)> = visits[1..].iter().map(|(t, id)| Ok((t.clone(), id.as_str()?.to_owned()))).collect::<Result<_, RuntimeError>>()?;
        drop(visits);
        for (table, id) in deletion_order(schema, &reached) {
            let current = self.metered_scan(|runner, allowance| runner.tx.get(allowance, &table, &id))?;
            let Some(current) = current else { continue };
            self.delete_reached(&table, current)?;
        }
        Ok(())
    }

    /// Streams the ids of the live rows referencing `id` through `r` to
    /// `visit`, through its index, until `visit` answers false. A capped walk
    /// (cascade, set null) reads `PAGE` rows per seek and holds at most the
    /// reference's cap; a restrict probe reads one row per seek, so it examines
    /// nothing past its witness. Images are dropped before `visit` runs. Seeks
    /// start at the live suffix, so an expired backlog is never visited.
    fn each_child(&mut self, r: &Referencing<'_>, id: &Value, capped: bool, visit: &mut dyn FnMut(&mut Self, Value) -> Result<bool, RuntimeError>) -> Result<(), RuntimeError> {
        let schema = self.schema;
        let index = schema.reference_index(r.child, r.column).ok_or_else(|| RuntimeError::Schema(format!("{}.{} has no reference index", r.child, r.column)))?.to_owned();
        let (cap, page_rows) = if capped { (schema.reference_cap(r.child, r.column).map_or(u64::MAX, u64::from), PAGE) } else { (u64::MAX, 1) };
        // @ref LLP 3000.039#2.3 — seek on the effective deadline (a read-through child's `$deadline`), so no expired row is visited.
        let ranges = if r.table.expiry_column().is_some() && !through_reference(r) {
            let now = self.context.now.ok_or_else(|| RuntimeError::Input("delete clock is not pinned".into()))?;
            vec![(vec![id.clone(), Value::Null], None), (vec![id.clone()], Some(Value::Int(now)))]
        } else {
            vec![(vec![id.clone()], None)]
        };
        let mut live = 0_u64;
        for (prefix, gt) in ranges {
            let mut bounds = Bounds { gt, ..Default::default() };
            loop {
                let page = self.metered_scan(|runner, allowance| runner.tx.scan(allowance, r.child, &index, &prefix, &bounds, Dir::Asc, page_rows))?;
                let more = page.len() == page_rows;
                if let Some((_, key)) = page.last() { bounds.after = crate::key::decode(key).map(|v| v.into_iter().skip(prefix.len()).collect()); }
                let mut ids = Vec::with_capacity(page.len());
                for (row, _) in page {
                    if self.device {
                        // @ref LLP 3000.039#6.4 — a device predicts only over current rows: retained history queues the delete, and only a live, current (or own provisional) row is a witness.
                        // A retained, no longer current row is work the reservation does not
                        // price and a witness the device cannot judge: the delete queues.
                        if self.tx.retained_row(r.child, &row)? && !self.tx.current_row(r.child, &row)? {
                            return Err(RuntimeError::Prediction(format!("deleting meets retained {} history that references it; queued without a local delete", r.child)));
                        }
                        if self.expired(r.table, &row) || !(self.tx.current_row(r.child, &row)? || self.is_provisional(r.child, &row)?) {
                            return Err(RuntimeError::Prediction(format!("deleting needs a current image of every {} row that references it; queued without a local delete", r.child)));
                        }
                    } else if self.expired(r.table, &row) { continue; }
                    live += 1;
                    // Activation validates caps and every write keeps them; more than the cap
                    // is a store that broke its own invariant, never a hidden-row count.
                    if live > cap { return Err(RuntimeError::Schema(format!("{}.{} holds more rows than its cap for one {} row", r.child, r.column, r.column))); }
                    ids.push(row.field("id")?.clone());
                }
                for child in ids {
                    if !visit(self, child)? { return Ok(()); }
                }
                if !more { break; }
            }
        }
        Ok(())
    }

    /// A device predicts only over a referencing group it holds completely.
    // @ref LLP 3000.039#6.4 — the held-group proof of LLP 3000.007 §20.5, per closure row and reference.
    fn prove_reference_held(&mut self, r: &Referencing<'_>, id: &Value) -> Result<(), RuntimeError> {
        let index = self.schema.reference_index(r.child, r.column).ok_or_else(|| RuntimeError::Schema(format!("{}.{} has no reference index", r.child, r.column)))?.to_owned();
        let (child, key) = (r.child.to_owned(), [id.clone()]);
        // Key-decided readability, and the group itself held (a rejoined or
        // unacquired range is unknown even when the rule admits the viewer).
        if self.device_work(|runner| runner.upsert_absence_proven(&child, &index, &key))? && self.tx.current_group(&child, &index, &key)? { return Ok(()); }
        Err(RuntimeError::Prediction(format!("deleting needs every {} row that references it held; queued without a local delete", r.child)))
    }

    /// The engine's own write of a `set null` reference: no rule, every constraint.
    fn clear_reference(&mut self, table: &str, column: &str, old: Value) -> Result<(), RuntimeError> {
        let mut new = old.clone();
        if let Value::Row(fields) | Value::Map(fields) = &mut new { fields.insert(column.to_owned(), Value::Null); }
        let patch = crate::value::object([(column, Value::Null)]);
        let outer = std::mem::replace(&mut self.engine_action, true);
        let result = self.target_attempt(table, |runner| {
            runner.reserve_maintains(table, &runner.schema.tables[table])?;
            runner.replace_authorized(table, old, new, true, &patch, 0)
        });
        self.engine_action = outer;
        result
    }

    /// The engine's own delete of a closure row: no rule, its constraints, its
    /// `read through` children's probe, maintains and partition events.
    fn delete_reached(&mut self, table_name: &str, old: Value) -> Result<(), RuntimeError> {
        self.target_attempt(table_name, |runner| {
            runner.refuse_engine_owned(table_name, Effect::Delete)?;
            let table = &runner.schema.tables[table_name];
            runner.reserve_maintains(table_name, table)?;
            runner.delete_row(table_name, old)
        })
    }
}

/// Rows a child scan holds per seek: the reservation's transient `4 × row`
/// (LLP 3000.039 §5.1, `Schema::delete_reservation`).
const PAGE: usize = crate::schema::references::REFERENCE_PAGE;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Context, rows::{MemoryRows, Rows}, value::{Value, object}};

    #[test]
    fn prepaid_actions_keep_nested_device_proofs_bounded() {
        let bound = snapback4_lang::compile(&[("nested-allowance.q".into(), r#"
table parents:
  public
table children:
  parent: parents on delete cascade
  cap 1 by parent
  public
"#.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let schema: crate::Schema = crate::json_codec::from_text(
            &crate::json_codec::to_text(&bound.schema).unwrap(),
        ).unwrap();
        let rows = MemoryRows::new();
        let parent = object([("id", Value::Id("p".into()))]);
        rows.put("parents", &schema.tables["parents"], &parent, None).unwrap();
        rows.put("children", &schema.tables["children"], &object([
            ("id", Value::Id("c".into())), ("parent", Value::Id("p".into())),
        ]), None).unwrap();
        let price = schema.delete_reservation("parents").unwrap();
        let ceilings = Ceilings {
            steps: price[0], index_entries: price[1], examined: price[2],
            rows_written: price[3], heap_bytes: price[4], output_bytes: price[5],
            rule_probes: price[6],
        };
        let mut runner = Runner::new(&rows, &schema, Context::system().at(1), Meter::new(ceilings, Cut::Abort), 0);
        runner.device = true;
        // Model the commit-end walk after its outer device_work swap: the
        // bounded allowance is the active meter and no spare copy exists.
        runner.device_work_active = true;
        let error = runner.apply_reference_actions("parents", &parent).unwrap_err();
        assert!(matches!(&error, RuntimeError::Prediction(message) if message.contains("allowance exhausted")), "{error:?}");
        assert_eq!(runner.meter.used.steps, price[0] + 1, "the nested proof attempted its bounded step");
    }
}

fn through_reference(r: &Referencing<'_>) -> bool {
    r.table.through.as_ref().is_some_and(|t| t.reference == r.column)
}

/// The closure's rows, children before parents: a table goes first when no
/// other reached table must be removed before it (the cascade and `read
/// through` edges are acyclic by `check`), and within a table, later
/// discoveries first.
fn deletion_order(schema: &crate::schema::Schema, reached: &[(String, String)]) -> Vec<(String, String)> {
    let tables: Vec<&str> = {
        let mut seen = Vec::new();
        for (table, _) in reached { if !seen.contains(&table.as_str()) { seen.push(table.as_str()); } }
        seen
    };
    // edges: child table -> the reached tables it must be removed before
    // (its cascade parents and its `read through` parent; LLP 3000.039 §3).
    let mut edges: Vec<(&str, &str)> = Vec::new();
    for &child in &tables {
        for &parent in &tables {
            if child != parent && schema.deletion_precedes(child, parent) { edges.push((child, parent)); }
        }
    }
    let mut order: Vec<&str> = Vec::new();
    let mut remaining = tables.clone();
    while !remaining.is_empty() {
        // A table no remaining table references can go now (its referencers are gone).
        let position = remaining.iter().position(|t| !remaining.iter().any(|other| other != t && edges.contains(&(*other, *t))))
            .unwrap_or(remaining.len() - 1);
        order.push(remaining.remove(position));
    }
    let mut out = Vec::with_capacity(reached.len());
    for table in order {
        out.extend(reached.iter().rev().filter(|(t, _)| t == table).cloned());
    }
    out
}
