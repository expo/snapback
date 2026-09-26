//! Maintained columns activate behind a generation barrier. Rebuild the
//! private totals, then mirror live parents in place, without partition events.
// @ref LLP 3000.007.001#3.11 — resolved triggers and an unconditional parent commit.
use super::runner::Runner;
use crate::{error::RuntimeError, rows::{Bounds, Dir}, schema::{Maintain, Schema, maintained_id}, value::Value};
use std::collections::BTreeSet;

fn lifetime_changed(schema: &Schema, previous: &Schema, parent: &str) -> bool {
    let old = previous.table(parent);
    let new = schema.table(parent);
    old.and_then(|t| t.expire.as_ref()) != new.and_then(|t| t.expire.as_ref())
        || old.and_then(|t| t.through.as_ref()) != new.and_then(|t| t.through.as_ref())
        || old.into_iter().chain(new).filter_map(|t| t.expire.as_ref()).any(|field|
            crate::successor::interpretation(previous, parent, field) != crate::successor::interpretation(schema, parent, field))
}

pub(super) fn changed_parents(schema: &Schema, previous: Option<&Schema>) -> BTreeSet<String> {
    let mut parents = BTreeSet::new();
    for m in schema.maintains.iter().chain(previous.into_iter().flat_map(|s| &s.maintains)) {
        let Some(owner) = &m.private else { continue };
        if previous.is_none_or(|old| old.table(&owner.table).map(|t| &t.maintained) != schema.table(&owner.table).map(|t| &t.maintained)
            || lifetime_changed(schema, old, &owner.table)
            || schema.maintain_for(&m.target).is_some_and(|next| crate::successor::maintain_rebuild_needed(old, schema, next))) {
            parents.insert(owner.table.clone());
        }
    }
    parents
}

impl Runner<'_> {
    /// An authoritative in-memory generation rebuilds before publishing its
    /// staged store. Ordinary device installation does not call this path.
    pub fn rebuild_server_derivations(&mut self, previous: Option<&Schema>) -> Result<(),RuntimeError> {
        let saved=self.event_free;self.event_free=true;
        let result=(|| {
            for m in self.schema.maintains.iter().filter(|m|m.private.is_none()){self.rebuild_maintain(m)?;}
            self.activate_columns(previous,&self.schema.maintains.iter().collect::<Vec<_>>(),&changed_parents(self.schema,previous), None)
        })();
        self.event_free=saved;result
    }
    pub(super) fn activate_columns(&mut self, previous: Option<&Schema>, rebuild: &[&Maintain], parents: &BTreeSet<String>, mut report: Option<&mut crate::store::adoption_report::AdoptionReport>) -> Result<(), RuntimeError> {
        let saved = self.event_free;
        self.event_free = true;
        let result = (|| {
            // Even an all-zero addition/removal wakes server-run parent watches.
            self.written_tables.extend(parents.iter().cloned());
            for m in rebuild.iter().filter(|m| m.private.is_some()) {
                if let Some(report) = report.as_deref_mut() { self.rebuild_maintain_reported(m, report)?; } else { self.rebuild_maintain(m)?; }
            }
            for m in self.schema.maintains.iter().filter(|m| m.private.is_some()) {
                let owner = m.private.as_ref().unwrap();
                if rebuild.contains(&m) || previous.is_some_and(|old| lifetime_changed(self.schema, old, &owner.table)) {
                    self.mirror_column_pass(m)?;
                }
            }
            Ok(())
        })();
        self.event_free = saved;
        result
    }

    pub(super) fn mirror_column_pass(&mut self, m: &Maintain) -> Result<(), RuntimeError> {
        let owner = m.private.as_ref().expect("private maintain");
        let mut bounds = Bounds::default();
        loop {
            let page = self.metered_scan(|runner, allowance| runner.tx.scan(allowance, &owner.table, "byId", &[], &bounds, Dir::Asc, 256))?;
            if page.is_empty() { break; }
            for (row, key) in page {
                bounds.after = crate::key::decode(&key);
                let group = vec![row.field("id")?.clone()];
                let total = self.metered_scan(|runner, allowance| runner.tx.get(allowance, &m.target, &maintained_id(&group)))?
                    .and_then(|r| r.field("value").ok().cloned()).unwrap_or(Value::Int(0)).as_int()?;
                // Re-read the current parent in mirror_column: several columns
                // must compose. Missing zero stays physically absent.
                self.mirror_column(m, &group, total)?;
            }
        }
        Ok(())
    }
}
