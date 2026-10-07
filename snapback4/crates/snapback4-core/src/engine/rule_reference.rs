//! Rule hops use the ordinary authorized point-read path under the rule's
//! prepaid allowance and the request's shared physical authorization limit.
use super::runner::Runner;
use crate::{error::RuntimeError, ir::{Expr, KeyProvenance, Read}, value::Value};
impl Runner<'_> {
    // @ref LLP 3000.007#5.4 — final obligations resolve live hops at transaction
    // end, under the same prepaid/physical allowance as ordinary write rules.
    pub(super) fn final_reference_key(&mut self, source: &str, rule: &crate::schema::RuleExpr, row: &Value) -> Result<Option<Vec<Value>>, RuntimeError> {
        use crate::{schema::{RuleExpr, RuleTerm}, error::MeterKind};
        use super::{rules, read::RuleProbe};
        let RuleExpr::Exists { key, .. } = rule else { unreachable!() };
        let probes = key.iter().map(|term| term.references().count() as u64).sum();
        // The resolved key outlives the authorized read scratch. Reserve its
        // declared copy bound before probing, independent of hidden occupants.
        let retained = key.iter().fold(crate::rows::word_heap::slots::<Value>(key.len()), |bytes, term| {
            let (table, field) = match term {
                RuleTerm::Reference { .. } | RuleTerm::ReferenceChain { .. } => term.references().last().expect("validated"),
                RuleTerm::Field(field) | RuleTerm::NextField(field) | RuleTerm::OldField(field) => (source,field.as_str()),
                RuleTerm::Viewer => return bytes.saturating_add(144),
                RuleTerm::Literal(value) => return bytes.saturating_add(super::runner::expression_copy(value)),
            };
            bytes.saturating_add(super::write_target::column_copy_ceiling(&self.schema.tables[table].columns[field]))
        });
        self.meter.heap(retained)?;
        let viewer = self.context.viewer.clone();
        self.authorized_scratch(self.rule_scratch(rule), &[(MeterKind::RuleProbes, probes)], |runner, allowance| {
            let mut probe = RuleProbe { runner, allowance };
            let mut missing = false;
            let key = key.iter().map(|term| rules::term(term, &viewer, None, row, &mut probe, &mut missing)).collect::<Result<Vec<_>, _>>()?;
            Ok((!missing).then_some(key))
        })
    }
    // @ref LLP 3000.007#5.4 — absent, hidden and unheld parents fail closed,
    // including under negation; no raw witness field escapes authorization.
    pub(super) fn rule_reference(&mut self, table: &str, id: &Value, field: &str) -> Result<Option<Value>, RuntimeError> {
        if !matches!(id, Value::Id(_)) { return Ok(None); }
        let read = Read { site: format!("rule {table}[ref].{field}"), table: table.into(), index: "byId".into(), key: vec![Expr::Literal(id.clone())], provenance: KeyProvenance::Computed };
        if self.device {
            let row = self.metered_scan(|runner, allowance| runner.fetch(allowance, table, id.as_str()?))?;
            let Some(row) = row else {
                self.unknown_fact(table, "byId", &[id.clone()], &read.site);
                return Ok(None);
            };
            // Delivered history is readable data but cannot supply current write authority.
            if !self.witness_covered(table, "byId", &[id.clone()], &row)? {
                self.unknown_fact(table, "byId", &[id.clone()], &read.site);
                return Ok(None);
            }
            if !self.authorize_read(table, &row, false)? { return Ok(None); }
        }
        let row = self.get(&read)?;
        if row == Value::Null { return Ok(None); }
        if self.is_provisional(table, &row)? && self.schema.tables[table].sequences.contains_key(field) {
            self.provisional_sequence_read = true;
        }
        Ok(Some(row.field(field).cloned().unwrap_or(Value::Null)))
    }
}
