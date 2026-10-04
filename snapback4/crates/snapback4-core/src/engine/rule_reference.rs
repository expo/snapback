//! Rule hops use the ordinary authorized point-read path under the rule's
//! prepaid allowance and the request's shared physical authorization limit.
use super::runner::Runner;
use crate::{error::RuntimeError, ir::{Expr, KeyProvenance, Read}, value::Value};
impl Runner<'_> {
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
