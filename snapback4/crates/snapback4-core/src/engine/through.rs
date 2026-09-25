//! Parent authority and lifetime checks shared by the storage adapters.
// @ref LLP 3000.014#4-the-capture — reserve before arm selection; resolve live, stamp, then authorize.
use super::{rules, runner::Runner};
use crate::{
    error::{MeterKind, RuntimeError},
    rows::{Bounds, Dir},
    schema::{Effect, Table, through::*},
    value::Value,
};

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
        let probes =
            rules::rule_probes(&parent.rules.read) + rules::rule_probes(&table.rules.insert);
        for (kind, amount) in [
            (MeterKind::Examined, 1),
            (MeterKind::RuleProbes, probes),
            (
                MeterKind::HeapBytes,
                super::write_target::row_copy_ceiling(parent)
                    .saturating_mul(2)
                    .saturating_add(super::write_target::row_copy_ceiling(table)),
            ),
            (MeterKind::Steps, through.fields.len() as u64 + 2),
        ] {
            self.meter.charge(kind, amount)?;
        }
        self.capture_prepaid = true;
        self.read_tables.insert(through.parent.clone());
        self.rule_dependencies(&parent.rules.read);
        self.rule_dependencies(&table.rules.insert);
        Ok(())
    }

    pub(super) fn capture_insert(
        &mut self,
        name: &str,
        mut row: Value,
    ) -> Result<Value, RuntimeError> {
        let table = self.schema.tables[name].clone();
        let Some(through) = &table.through else {
            return Ok(row);
        };
        let denied = || RuntimeError::Rule {
            table: name.into(),
            effect: Effect::Insert,
        };
        let id = row
            .field(&through.reference)
            .ok()
            .and_then(|v| v.as_str().ok())
            .ok_or_else(denied)?;
        let parent = &self.schema.tables[&through.parent];
        let found = self.tx.get(&through.parent, id)?.filter(|r| !self.expired(parent, r));
        if self.device {
            let covered = if let Some(found) = &found {
                self.is_provisional(&through.parent, found)? || self.device_work(|runner| runner.tx.recording_covered(
                    &through.parent, found, &runner.context.viewer, runner.context.now.unwrap_or(0), &mut runner.meter))?
            } else { false };
            if !covered { return Err(RuntimeError::Prediction(format!("read through .{} needs a live, covered {} parent; queued without a row", through.reference, through.parent))); }
        }
        let found = found.ok_or_else(denied)?;
        stamp(parent, through, &found, &mut row)?;
        table.recompute_deadline(&mut row)?;
        if !self.context.is_system() {
            let viewer = self.context.viewer.clone();
            if !rules::evaluate(
                &table.rules.read,
                &viewer,
                None,
                &row,
                false,
                &mut super::read::PrefixProbe { runner: self },
            )? {
                return Err(denied());
            }
        }
        Ok(row)
    }

    pub(super) fn physical_children(
        &mut self,
        parent: &str,
        id: &Value,
    ) -> Result<bool, RuntimeError> {
        let children: Vec<_> = self
            .schema
            .children(parent)
            .map(|(n, _, _)| n.clone())
            .collect();
        // Reserve the complete schema-fixed probe set before its first seek.
        // Never short-circuit on an occupied table, including at low ceilings.
        self.meter.charge(MeterKind::Examined, children.len() as u64)?;
        self.meter.step(children.len() as u64)?;
        self.meter.heap(children.iter().map(|name| super::write_target::row_copy_ceiling(&self.schema.tables[name])).fold(0_u64, u64::saturating_add))?;
        let mut occupied = false;
        for name in children {
            occupied |= !self
                .tx
                .scan(
                    &name,
                    CHILDREN,
                    &[id.clone()],
                    &Bounds::default(),
                    Dir::Asc,
                    1,
                )?
                .is_empty();
        }
        Ok(occupied)
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
        if self.device {
            let occupied = self.device_work(|runner| runner.current_children(parent, id, &children))?;
            return if occupied { Err(self.parent_has_children(parent)) } else { Ok(()) };
        }
        self.meter
            .charge(MeterKind::Examined, children.len() as u64 * 3)?;
        self.meter.step(children.len() as u64 * 3)?;
        self.meter.heap(
            children
                .iter()
                .map(|n| {
                    super::write_target::row_copy_ceiling(&self.schema.tables[n]).saturating_mul(3)
                })
                .fold(0_u64, u64::saturating_add),
        )?;
        for name in children {
            let never = self.tx.scan(
                &name,
                CHILDREN,
                &[id.clone(), Value::Null],
                &Bounds::default(),
                Dir::Asc,
                1,
            )?;
            let now = self
                .context
                .now
                .ok_or_else(|| RuntimeError::Input("delete clock is not pinned".into()))?;
            let finite = self.tx.scan(
                &name,
                CHILDREN,
                &[id.clone()],
                &Bounds {
                    gt: Some(Value::Int(now)),
                    ..Default::default()
                },
                Dir::Asc,
                1,
            )?;
            if !never.is_empty() || !finite.is_empty() {
                return Err(self.parent_has_children(parent));
            }
            // §3.3 forbids physical removal even when §6's live probe is empty.
            // The author's implementation ruling keeps this case fail-closed.
            if !self
                .tx
                .scan(
                    &name,
                    CHILDREN,
                    &[id.clone()],
                    &Bounds::default(),
                    Dir::Asc,
                    1,
                )?
                .is_empty()
            {
                return Err(self.parent_has_children(parent));
            }
        }
        Ok(())
    }

    fn parent_has_children(&self, parent: &str) -> RuntimeError {
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
        let parent_row = self.tx.get(parent, id.as_str()?)?.ok_or_else(uncertain)?;
        for name in children {
            let table = self.schema.tables[name].clone();
            let through = table.through.as_ref().unwrap();
            if !self.child_coverage(name, through, &parent_row)? { return Err(uncertain()); }
            let table_scratch = self.meter.mark();
            // Expected captures plus a reusable row/cursor, reserved before seeking.
            self.meter.heap(super::write_target::row_copy_ceiling(&table).saturating_mul(3))?;
            let mut expected = crate::value::object([] as [(&str, Value); 0]);
            stamp(&self.schema.tables[parent], through, &parent_row, &mut expected)?;
            let mut bounds = Bounds::default();
            loop {
                let scratch = self.meter.mark();
                self.meter.charge(MeterKind::Examined, 1)?;
                self.meter.step(through.fields.len() as u64 + 1)?;
                let page = self.tx.scan_metered(name, CHILDREN, &[id.clone()], &bounds, Dir::Asc, 1, &mut self.meter)?;
                let Some((row, key)) = page.into_iter().next() else { break };
                if !self.tx.retained_row(name, &row)? {
                    if self.expired(&table, &row)
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
