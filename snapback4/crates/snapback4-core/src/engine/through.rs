//! Parent authority and lifetime checks shared by the storage adapters.
// @ref LLP 3000.014#4-the-capture — reserve before arm selection; resolve live, stamp, then authorize.
use super::{rules, runner::Runner};
use crate::{
    error::{MeterKind, RuntimeError},
    rows::{Bounds, Dir},
    schema::{Effect, Table, through::*},
    value::{Supplied, Value},
};
use std::collections::BTreeSet;

/// Minted only here: the stamped image re-enters the supplied-input channel
/// under reserve_capture's declared allowance.
pub(crate) struct CaptureInput(());

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ParentVerdict {
    Readable,
    Unreadable,
    Absent,
    Unknown,
}

impl Runner<'_> {
    pub(super) fn reserve_capture(&mut self, table: &Table) -> Result<(), RuntimeError> {
        let Some(through) = &table.through else {
            return Ok(());
        };
        if self.capture_prepaid {
            return Ok(());
        }
        let parent = &self.schema.tables[&through.parent];
        self.charge_price(crate::schema::reservations::capture_price(self.schema, table))?;
        self.capture_prepaid = true;
        self.read_tables.insert(through.parent.clone());
        self.rule_dependencies(&parent.rules.read);
        self.rule_dependencies(&table.rules.insert);
        Ok(())
    }

    pub(super) fn capture_insert(&mut self, name: &str, row: Supplied) -> Result<Supplied, RuntimeError> {
        let result = self.capture_insert_inner(name, row);
        self.trace_authorization(&result, name, Effect::Insert, "read through capture");
        result
    }

    fn capture_insert_inner(
        &mut self,
        name: &str,
        row: Supplied,
    ) -> Result<Supplied, RuntimeError> {
        let table = &self.schema.tables[name];
        let Some(through) = &table.through else {
            return Ok(row);
        };
        let mut row = row.into_value();
        let id = row
            .field(&through.reference)
            .ok()
            .and_then(|v| v.as_str().ok())
            .ok_or_else(|| self.rule_refusal(name, Effect::Insert, "read through parent reference"))?;
        let parent = &self.schema.tables[&through.parent];
        // @ref LLP 3000.015#2 — the parent lookup is authorization work under the
        // request's physical allowance; reserve_capture prepaid its logical charges.
        let found = self.authorized_scan(&[], |runner, scope| runner.tx.get(scope, &through.parent, id))?.filter(|r| !self.expired(parent, r));
        if self.device {
            let covered = if let Some(found) = &found {
                self.is_provisional(&through.parent, found)? || self.device_work(|runner| {
                    let viewer = runner.context.viewer.clone();
                    let now = runner.context.now.unwrap_or(0);
                    runner.authorized_scan(&[], |runner, scope| runner.tx.recording_covered(&through.parent, found, &viewer, now, scope, &mut runner.meter))
                })?
            } else { false };
            if !covered { return Err(RuntimeError::Prediction(format!("read through .{} needs a live, covered {} parent; queued without a row", through.reference, through.parent))); }
        }
        let found = found.ok_or_else(|| self.rule_refusal(name, Effect::Insert, "read through parent missing or expired"))?;
        stamp(parent, through, &found, &mut row)?;
        table.recompute_deadline(&mut row)?;
        if !self.context.is_system() {
            let viewer = self.context.viewer.clone();
            let readable = self.authorized_scratch(self.rule_scratch(&table.rules.read), &[], |runner, allowance| {
                rules::evaluate(&table.rules.read, &viewer, None, &row, false, &mut super::read::PrefixProbe { runner, allowance })
            })?;
            if !readable {
                // @ref LLP 3000.036.002#5 — only the developer trace names the unread parent.
                self.refusing_phase(&through.parent, &format!("insert into {name} needs unread parent {} through .{}", through.parent, through.reference), "read rule");
                return Err(RuntimeError::Rule { table: name.into(), effect: Effect::Insert });
            }
        }
        Ok(row.capture_input(&CaptureInput(())))
    }

    pub(super) fn physical_children(
        &mut self,
        parent: &str,
        id: &Value,
    ) -> Result<bool, RuntimeError> {
        self.physical_children_outside(parent, id, &BTreeSet::new())
    }

    /// Whether a read-through child remains outside a delete's cascade
    /// closure. Children in `deleting` are removed first by deletion_order and
    /// therefore do not physically retain their parent.
    pub(super) fn physical_children_outside(
        &mut self,
        parent: &str,
        id: &Value,
        deleting: &BTreeSet<(String, String)>,
    ) -> Result<bool, RuntimeError> {
        let children: Vec<_> = self
            .schema
            .children(parent)
            .map(|(n, _, _)| n.clone())
            .collect();
        // At most `deleting.len()` matching rows can be skipped across a
        // table: row ids are unique. One more row decides outside occupancy.
        let limit = deleting.len().saturating_add(1);
        // Reserve the complete schema-fixed probe set before its first seek.
        // Never short-circuit on an occupied table, including at low ceilings.
        // @ref LLP 3000.015#2 — the seeks draw from the request's physical allowance; occupancy never selects the logical charge.
        let heap = children.iter().map(|name| super::write_target::row_copy_ceiling(&self.schema.tables[name]).saturating_mul(limit as u64)).fold(0_u64, u64::saturating_add);
        let probes = (children.len() as u64).saturating_mul(limit as u64);
        self.authorized_scan(&[(MeterKind::Examined, probes), (MeterKind::Steps, probes), (MeterKind::HeapBytes, heap)], |runner, scope| {
            let mut occupied = false;
            for name in &children {
                let rows = runner.tx.scan(scope, name, CHILDREN, &[id.clone()], &Bounds::default(), Dir::Asc, limit)?;
                occupied |= rows.into_iter().any(|(row, _)| row.field("id").ok().and_then(|id| id.as_str().ok())
                    .is_none_or(|child| !deleting.contains(&(name.clone(), child.to_owned()))));
            }
            Ok(occupied)
        })
    }

    // A deadline suffix skips an arbitrary expired backlog in one seek.
    pub(super) fn refuse_live_children(
        &mut self,
        parent: &str,
        id: &Value,
    ) -> Result<(), RuntimeError> {
        let children: Vec<_> = self
            .schema
            .children(parent)
            .map(|(n, _, _)| n.clone())
            .collect();
        if children.is_empty() { return Ok(()); }
        let now = self
            .context
            .now
            .ok_or_else(|| RuntimeError::Input("delete clock is not pinned".into()))?;
        let heap = children
            .iter()
            .map(|n| super::write_target::row_copy_ceiling(&self.schema.tables[n]).saturating_mul(3))
            .fold(0_u64, u64::saturating_add);
        // @ref LLP 3000.015#2 — three schema-fixed seeks per child table, each drawn from the request's physical allowance.
        self.authorized_scan(&[(MeterKind::Examined, children.len() as u64 * 3), (MeterKind::Steps, children.len() as u64 * 3), (MeterKind::HeapBytes, heap)], |runner, scope| {
            if runner.device {
                let occupied = runner.device_work(|runner| runner.current_children(parent, id, &children))?;
                return if occupied { Err(runner.parent_has_children(parent)) } else { Ok(()) };
            }
            for name in &children {
                let never = runner.tx.scan(scope, name, CHILDREN, &[id.clone(), Value::Null], &Bounds::default(), Dir::Asc, 1)?;
                let finite = runner.tx.scan(scope, name, CHILDREN, &[id.clone()], &Bounds { gt: Some(Value::Int(now)), ..Default::default() }, Dir::Asc, 1)?;
                if !never.is_empty() || !finite.is_empty() {
                    return Err(runner.parent_has_children(parent));
                }
                // §3.3 forbids physical removal even when §6's live probe is empty.
                // The author's implementation ruling keeps this case fail-closed.
                if !runner.tx.scan(scope, name, CHILDREN, &[id.clone()], &Bounds::default(), Dir::Asc, 1)?.is_empty() {
                    return Err(runner.parent_has_children(parent));
                }
            }
            Ok(())
        })
    }

    pub(super) fn parent_has_children(&self, parent: &str) -> RuntimeError {
        RuntimeError::Structural {
            code: "E_PARENT_HAS_CHILDREN",
            message: format!("{parent} at {} has stored children; delete its live read-through children and sweep expired children, then retry `delete {parent}[id]` (guide rules)", self.statement_site),
        }
    }

    // @ref LLP 3000.014#5 — retained history cannot terminally refuse a
    // current delete. Mismatched, expired or uncovered witnesses must queue.
    fn current_children(&mut self, parent: &str, id: &Value, children: &[String]) -> Result<bool, RuntimeError> {
        if children.is_empty() { return Ok(false); }
        let uncertain = || RuntimeError::Prediction("parent deletion needs complete matching current child coverage; queued without a row".into());
        self.meter.charge(MeterKind::Examined, 1)?;
        self.meter.heap(super::write_target::row_copy_ceiling(&self.schema.tables[parent]))?;
        // Device-only work over held state: the token counts it on the device's separate physical allowance.
        let parent_id = id.as_str()?.to_owned();
        let parent_row = self.authorized_scan(&[], |runner, scope| runner.tx.get(scope, parent, &parent_id))?.ok_or_else(uncertain)?;
        for name in children {
            let table = &self.schema.tables[name];
            let through = table.through.as_ref().unwrap();
            if !self.child_coverage(name, through, &parent_row)? { return Err(uncertain()); }
            let table_scratch = self.meter.mark();
            // Expected captures plus a reusable row/cursor, reserved before seeking.
            self.meter.heap(super::write_target::row_copy_ceiling(table).saturating_mul(3))?;
            let mut expected = crate::value::object([] as [(&str, Value); 0]);
            stamp(&self.schema.tables[parent], through, &parent_row, &mut expected)?;
            let mut bounds = Bounds::default();
            loop {
                let scratch = self.meter.mark();
                self.meter.charge(MeterKind::Examined, 1)?;
                self.meter.step(through.fields.len() as u64 + 1)?;
                let page = self.authorized_scan(&[], |runner, scope| runner.tx.scan_metered(scope, name, CHILDREN, &[id.clone()], &bounds, Dir::Asc, 1, &mut runner.meter))?;
                let Some((row, key)) = page.into_iter().next() else { break };
                if self.engine_action && self.tx.retained_row(name, &row)? { return Err(uncertain()); }
                if !self.tx.retained_row(name, &row)? {
                    if self.expired(table, &row)
                        || !(self.tx.current_row(name, &row)? || self.is_provisional(name, &row)?)
                        || !capture_matches(through, &expected, &row) { return Err(uncertain()); }
                    return Ok(true);
                }
                bounds.after = crate::key::decode(&key).map(|key| key.into_iter().skip(1).collect());
                self.meter.release_heap(scratch);
            }
            self.meter.release_heap(table_scratch);
        }
        Ok(false)
    }
}

pub(super) fn capture_matches(through: &Through, expected: &Value, row: &Value) -> bool {
    through.fields.keys().map(String::as_str).chain([PARENT_DEADLINE])
        .all(|field| row.field(field).ok() == expected.field(field).ok())
}

pub(super) fn stamp(
    parent: &Table,
    through: &Through,
    image: &Value,
    row: &mut Value,
) -> Result<(), RuntimeError> {
    let image = crate::schema::row_image(image, parent);
    if let Value::Row(fields) | Value::Map(fields) = row {
        for (capture, source) in &through.fields {
            fields.insert(capture.clone(), image.field(source)?.clone());
        }
        fields.insert(
            PARENT_DEADLINE.into(),
            parent
                .deadline(&image)
                .map(Value::Int)
                .unwrap_or(Value::Null),
        );
    }
    Ok(())
}
