//! Parent authorization is shared; device acquisition remains a separate fact.
// @ref LLP 3000.014#5 — only matching live current captures may borrow a parent verdict.
use super::{rules::{self, Verdict}, runner::Runner, through::{ParentVerdict, capture_matches, stamp}};
use crate::{error::{MeterKind, RuntimeError}, rows::{Bounds, Dir}, schema::{Audience, through::*}, value::Value};

impl Runner<'_> {
    // @ref LLP 3000.014#5.1 — never enumerate aggregate keys before the parent verdict.
    pub(super) fn aggregate_parent_prefix(&mut self, scan: &crate::ir::Scan, prefix: &[Value]) -> Result<Option<bool>, RuntimeError> {
        let Some(m) = self.schema.maintain_for(&scan.table).filter(|m| m.groups_by_parent(self.schema)) else { return Ok(None) };
        let parent = m.parent_key.as_ref();
        let id = parent.and_then(|p| self.schema.tables[&scan.table].indexes[&scan.index].columns().iter().position(|f| f == &p.reference)).and_then(|at| prefix.get(at));
        let (Some(parent), Some(id)) = (parent, id) else {
            return Err(RuntimeError::Structural { code: "E_READ_THROUGH_SCAN", message: format!("{} at {} needs one pinned readable parent; use the parent page with a nested keyed totals read (guide maintains)", scan.table, scan.site) });
        };
        self.read_tables.insert(scan.table.clone());
        self.read_tables.insert(m.source.clone());
        let verdict = self.parent_verdict(&m.source, parent, id)?;
        let unknown = verdict == ParentVerdict::Unknown || self.device && (self.beyond_horizon || self.schema.tables[&scan.table].sync.is_none());
        if unknown {
            self.unknown_fact(&scan.table, &scan.index, prefix, &scan.site);
            self.components.note(|frame| frame.speculative = true);
        }
        Ok(Some(!unknown && verdict == ParentVerdict::Readable))
    }

    pub(super) fn parent_verdict(&mut self, child: &str, through: &Through, id: &Value) -> Result<ParentVerdict, RuntimeError> {
        let parent = &self.schema.tables[&through.parent];
        self.read_tables.insert(through.parent.clone());
        self.rule_dependencies(&parent.rules.read);
        for (kind, amount) in [
            (MeterKind::Examined, 1),
            (MeterKind::RuleProbes, rules::rule_probes(&parent.rules.read)),
            (MeterKind::HeapBytes, super::write_target::row_copy_ceiling(parent)),
        ] {
            if !self.read_charge(kind, amount)? { return Ok(ParentVerdict::Unknown); }
        }
        // @ref LLP 3000.015#2 — the parent fetch draws from the request's physical allowance; its logical charges were reserved above.
        let parent_id = id.as_str()?.to_owned();
        let row = self.authorized_scan(&[], |runner, scope| runner.tx.get(scope, &through.parent, &parent_id))?;
        let live = row.as_ref().filter(|row| !self.expired(parent, row));
        if self.device {
            self.read_tables.insert(child.into());
            if !self.read_charge(MeterKind::HeapBytes, super::write_target::row_copy_ceiling(&self.schema.tables[child]).saturating_mul(2))? { return Ok(ParentVerdict::Unknown); }
            if !self.captures_match(child, through, id, live)? { return Ok(ParentVerdict::Unknown); }
        }
        let Some(row) = live else {
            let covered = !self.device || match &row {
                Some(row) => self.tx.current_row(&through.parent, row)?,
                None => self.authorized_scan(&[], |runner, scope| runner.authorization_absence_covered(scope, &through.parent, "byId", &[id.clone()]))?
                    && self.tx.current_group(&through.parent, "byId", &[id.clone()])?,
            };
            return Ok(if covered { ParentVerdict::Absent } else { ParentVerdict::Unknown });
        };
        if self.device && !(self.is_provisional(&through.parent, row)? || self.tx.current_row(&through.parent, row)?) {
            return Ok(ParentVerdict::Unknown);
        }
        let verdict = if self.context.is_system() { Verdict::Readable } else { self.read_authority(&through.parent, row, true)? };
        match verdict {
            Verdict::Unknown => Ok(ParentVerdict::Unknown),
            Verdict::Denied => Ok(ParentVerdict::Unreadable),
            Verdict::Readable => {
                self.note_expiry(parent, row);
                // A parent authorizes; it cannot certify acquisition of its children.
                if self.device && !self.child_coverage(child, through, row)? {
                    self.unknown_fact(child, CHILDREN, &[id.clone()], "read through child coverage");
                }
                Ok(ParentVerdict::Readable)
            }
        }
    }

    pub(super) fn child_coverage(&self, child: &str, through: &Through, parent_row: &Value) -> Result<bool, RuntimeError> {
        let table = &self.schema.tables[child];
        let Some(sync) = &table.sync else { return Ok(false) };
        if sync.horizon.is_some() || self.is_provisional(&through.parent, parent_row)? { return Ok(false); }
        let mut image = crate::value::object([(through.reference.clone(), parent_row.field("id")?.clone())]);
        stamp(&self.schema.tables[&through.parent], through, parent_row, &mut image)?;
        let columns = match &sync.audience {
            Audience::Public => vec![],
            Audience::Column(column) => vec![column.clone()],
            Audience::Target { prefix, .. } => prefix.clone(),
        };
        let Some((index, _)) = table.indexes.iter().find(|(_, index)| index.is_plain() && index.columns().starts_with(&columns)) else { return Ok(false) };
        let prefix = columns.iter().map(|column| image.field(column).cloned()).collect::<Result<Vec<_>,_>>()?;
        self.tx.current_group(child, index, &prefix)
    }

    pub(super) fn captured_aggregate_coverage(&mut self, maintain: &crate::schema::Maintain, index: &crate::schema::Index, key: &[Value]) -> Result<bool, RuntimeError> {
        let source = &self.schema.tables[&maintain.source];
        self.read_tables.insert(maintain.source.clone());
        let Some(sync) = source.sync.as_ref().filter(|sync| sync.horizon.is_none()) else { return Ok(false) };
        let fields: std::collections::BTreeMap<_, _> = crate::small_map::collect(index.columns().into_iter().zip(key).map(|(field, value)| (maintain.aliases.get(&field).cloned().unwrap_or(field), value)));
        let columns = match &sync.audience { Audience::Public => vec![], Audience::Column(column) => vec![column.clone()], Audience::Target { prefix, .. } => prefix.clone() };
        let Some(prefix) = columns.iter().map(|column| fields.get(column).map(|value| (*value).clone())).collect::<Option<Vec<_>>>() else { return Ok(false) };
        let Some((index, _)) = source.indexes.iter().find(|(_, index)| index.is_plain() && index.columns().starts_with(&columns)) else { return Ok(false) };
        self.tx.current_group(&maintain.source, index, &prefix)
    }

    fn captures_match(&mut self, child: &str, through: &Through, id: &Value, parent: Option<&Value>) -> Result<bool, RuntimeError> {
        let table = &self.schema.tables[child];
        let mut expected = crate::value::object([] as [(&str, Value); 0]);
        if let Some(parent) = parent { stamp(&self.schema.tables[&through.parent], through, parent, &mut expected)?; }
        let mut bounds = Bounds::default();
        loop {
            let scratch = self.meter.mark();
            let page = self.metered_scan(|runner, scope| runner.tx.scan_metered(scope, child, CHILDREN, &[id.clone()], &bounds, Dir::Asc, 1, &mut runner.meter))?;
            if self.read_capped() { return Ok(false); }
            let Some((row, key)) = page.into_iter().next() else { return Ok(true) };
            if !self.read_charge(MeterKind::Examined, 1)? || !self.read_charge(MeterKind::Steps, through.fields.len() as u64 + 1)? { return Ok(false); }
            let current = !self.expired(table, &row) && !self.tx.retained_row(child, &row)?;
            if current && (parent.is_none() || !capture_matches(through, &expected, &row)) { return Ok(false); }
            bounds.after = crate::key::decode(&key).map(|key| key.into_iter().skip(1).collect());
            // One cursor is retained, with a schema-sized reservation; row scratch is reusable.
            self.meter.release_heap(scratch);
        }
    }
}
