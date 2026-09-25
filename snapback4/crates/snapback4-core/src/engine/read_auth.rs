//! Read authorization of provisional images, over raw combined-state witnesses.
use super::{rules::{self, Probe}, runner::Runner};
use crate::{error::{MeterKind, RuntimeError}, schema::{Audience, RuleExpr, materialize_optional_fields}, value::Value};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Verdict { Readable, Denied, Unknown }

impl Runner<'_> {
    pub(super) fn is_provisional(&self, table: &str, row: &Value) -> Result<bool, RuntimeError> {
        Ok(self.device && (self.provisional_rows.contains(&(table.into(), row.field("id")?.as_str()?.into())) || self.tx.provisional_row(table, row)?))
    }

    pub(super) fn provisional_readable(&mut self, table: &str, row: &Value) -> Result<bool, RuntimeError> {
        if self.context.is_system() || !self.is_provisional(table, row)? { return Ok(true); }
        self.authorize_read(table, row, false)
    }

    /// F3 calls this on an image before insertion; provenance cannot bypass it.
    pub(super) fn evaluate_read_rule(&mut self, table: &str, row: &Value) -> Result<bool, RuntimeError> {
        self.authorize_read(table, row, false)
    }

    pub(super) fn authorize_read(&mut self, table: &str, row: &Value, prepaid: bool) -> Result<bool, RuntimeError> {
        self.device_work(|runner| {
            let scratch = runner.meter.mark();
            let result = runner.authorize_read_inner(table, row, prepaid);
            // Only a verdict escapes; all fetched witnesses and cursors have
            // been dropped. Keep physical work charged across authorizations.
            if runner.device_work_active { runner.meter.release_heap(scratch); }
            result
        })
    }

    fn authorize_read_inner(&mut self, table: &str, row: &Value, prepaid: bool) -> Result<bool, RuntimeError> {
        let provisional = self.is_provisional(table, row)?;
        let definition = &self.schema.tables[table];
        let rule = definition.rules.read.clone();
        if self.device_work_active { self.meter.heap(crate::rows::word_heap::materialize(row, definition))?; }
        let mut row = row.clone();
        materialize_optional_fields(&mut row, definition);
        self.rule_dependencies(&rule);
        let viewer = self.context.viewer.clone();
        let verdict = evaluate(&rule, &viewer, &row, &mut ReadProbe { runner: self, table, provisional, prepaid, unknown: false })?;
        if self.read_capped() { return Ok(false); }
        if verdict == Verdict::Unknown {
            self.unknown_fact(table, "byId", &[row.field("id")?.clone()], "provisional read authority");
        }
        Ok(verdict == Verdict::Readable)
    }

    pub(super) fn witness_covered(&self, table: &str, index: &str, key: &[Value], row: &Value) -> Result<bool, RuntimeError> {
        // Own pending writes are facts in the combined state, even in a Left
        // group. Settlement removes their dependents if the server refuses.
        Ok(!self.device || self.is_provisional(table, row)? ||
            (self.schema.tables[table].sync.is_some() && !self.tx.retained_row(table, row)? && !self.tx.retained_group(table, index, key)?))
    }

    pub(super) fn authorization_absence_covered(&mut self, table: &str, index: &str, key: &[Value]) -> Result<bool, RuntimeError> {
        let definition = &self.schema.tables[table];
        let Some(sync) = &definition.sync else { return Ok(false) };
        if sync.horizon.is_some() || self.tx.retained_group(table, index, key)? { return Ok(false); }
        let pinned: std::collections::BTreeMap<_, _> = definition.index(index).expect("validated index").columns().into_iter().zip(key).collect();
        match &sync.audience {
            Audience::Public => Ok(true),
            Audience::Column(column) => Ok(pinned.get(column).is_some_and(|value| value.as_str() == Ok(self.context.viewer.as_str()))),
            Audience::Target { table: target, prefix, .. } => {
                let Some(mut group) = prefix.iter().map(|column| pinned.get(column).map(|value| (*value).clone())).collect::<Option<Vec<_>>>() else { return Ok(false) };
                let binding = crate::schema::audience_binding(self.schema, table, definition, sync).map_err(RuntimeError::Schema)?;
                group.push(Value::Id(self.context.viewer.clone()));
                let target_def = &self.schema.tables[target];
                self.read_tables.insert(target.clone());
                // This is a raw audience membership, not the witness's ACL.
                let found = self.lookup_live(target, &binding.group_index, target_def.index(&binding.group_index).expect("audience index"), &group, false)?;
                found.map(|row| self.witness_covered(target, &binding.group_index, &group, &row)).transpose().map(|known| known.unwrap_or(false))
            }
        }
    }
}

struct ReadProbe<'a, 'b> { runner: &'a mut Runner<'b>, table: &'a str, provisional: bool, prepaid: bool, unknown: bool }
impl Probe for ReadProbe<'_, '_> {
    fn field(&mut self, field: &str, _old: bool) {
        self.runner.provisional_sequence_read |= self.provisional && self.runner.schema.tables[self.table].sequences.contains_key(field);
    }
    fn exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, RuntimeError> {
        if !self.prepaid && !self.runner.read_charge(MeterKind::RuleProbes, 1)? { return Ok(false); }
        let (present, known) = self.runner.probe_witness(table, index, key, equalities, true)?;
        self.unknown |= !known;
        Ok(present)
    }
    fn created(&mut self, table: &str, index: &str, key: &[Value]) -> bool { self.runner.created(table, index, key) }
}

/// Three-valued logic keeps an unused unknown branch out of read coverage.
/// Only the final Unknown verdict publishes a missing fact; cuts stay meters.
fn evaluate(rule: &RuleExpr, viewer: &str, row: &Value, probe: &mut ReadProbe<'_, '_>) -> Result<Verdict, RuntimeError> {
    use Verdict::*;
    match rule {
        RuleExpr::And(terms) | RuleExpr::Or(terms) => {
            let conjunction = matches!(rule, RuleExpr::And(_));
            let decisive = if conjunction { Denied } else { Readable };
            let mut unknown = false;
            for term in terms {
                let verdict = evaluate(term, viewer, row, probe)?;
                if probe.runner.read_capped() { return Ok(Denied); }
                if verdict == decisive { return Ok(decisive); }
                unknown |= verdict == Unknown;
            }
            Ok(if unknown { Unknown } else if conjunction { Readable } else { Denied })
        }
        RuleExpr::Not(inner) => Ok(match evaluate(inner, viewer, row, probe)? { Readable => Denied, Denied => Readable, Unknown => Unknown }),
        _ => {
            probe.unknown = false;
            let allowed = rules::evaluate(rule, viewer, None, row, false, probe)?;
            Ok(if probe.unknown { Unknown } else if allowed { Readable } else { Denied })
        }
    }
}
