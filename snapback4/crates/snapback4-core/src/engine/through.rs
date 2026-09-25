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
        if self.device {
            return Err(RuntimeError::Prediction(
                "read through insertion requires the server until device support lands".into(),
            ));
        }
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
        let found = self
            .tx
            .get(&through.parent, id)?
            .filter(|r| !self.expired(parent, r))
            .ok_or_else(denied)?;
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

    pub(super) fn parent_verdict(
        &mut self,
        through: &Through,
        id: &Value,
    ) -> Result<ParentVerdict, RuntimeError> {
        let parent = self.schema.tables[&through.parent].clone();
        self.read_tables.insert(through.parent.clone());
        self.rule_dependencies(&parent.rules.read);
        for (kind, amount) in [
            (MeterKind::Examined, 1),
            (
                MeterKind::RuleProbes,
                rules::rule_probes(&parent.rules.read),
            ),
            (
                MeterKind::HeapBytes,
                super::write_target::row_copy_ceiling(&parent),
            ),
        ] {
            if !self.meter.charge(kind, amount)? {
                return Ok(ParentVerdict::Unknown);
            }
        }
        if self.device {
            return Ok(ParentVerdict::Unknown);
        }
        let Some(row) = self
            .tx
            .get(&through.parent, id.as_str()?)?
            .filter(|row| !self.expired(&parent, row))
        else {
            return Ok(ParentVerdict::Absent);
        };
        let viewer = self.context.viewer.clone();
        let row = crate::schema::row_image(&row, &parent);
        let previous_expiry = self.next_expiry;
        let readable = self.context.is_system()
            || rules::evaluate(
                &parent.rules.read,
                &viewer,
                None,
                &row,
                false,
                &mut super::read::PrefixProbe { runner: self },
            )?;
        if readable {
            if let Some(at) = parent.deadline(&row) {
                self.next_expiry = Some(self.next_expiry.map_or(at, |n| n.min(at)));
            }
        } else {
            self.next_expiry = previous_expiry;
        }
        Ok(if readable {
            ParentVerdict::Readable
        } else {
            ParentVerdict::Unreadable
        })
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
        if self.device && !children.is_empty() {
            return Err(RuntimeError::Prediction("parent deletion needs authoritative read-through child coverage; queue until server settlement".into()));
        }
        let refusal = || RuntimeError::Structural {
            code: "E_PARENT_HAS_CHILDREN",
            message: format!("{parent} at {} has stored children; delete its live read-through children and sweep expired children, then retry `delete {parent}[id]` (guide rules)", self.statement_site),
        };
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
                return Err(refusal());
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
                return Err(refusal());
            }
        }
        Ok(())
    }
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
