//! Candidate preparation returns a provisional deadline alongside its image.
use super::{expiry::Pending, runner::Runner};
use crate::{error::RuntimeError, schema::Effect, value::Value};

impl Runner<'_> {
    pub(super) fn read_candidate(
        &mut self,
        table_name: &str,
        row: Value,
        uniform_verdict: Option<bool>,
        prefix_expiry: Pending,
    ) -> Result<Option<(Value, Pending)>, RuntimeError> {
        let expiry = self.next_expiry.scope();
        self.next_expiry.inherit(prefix_expiry);
        let allowed = match uniform_verdict {
            Some(verdict) => verdict && self.provisional_readable(table_name, &row)?,
            None => self.check_rule(table_name, Effect::Read, None, &row)?,
        };
        if self.read_capped() || !allowed {
            return Ok(None);
        }
        let table = &self.schema.tables[table_name];
        self.note_expiry(table, &row);
        // @ref LLP 3000.007#20.21 — an unfinished live total is unavailable.
        let row = self.live_aggregate(table_name, row)?;
        if self.read_capped() {
            return Ok(None);
        }
        // Authorization is not emission. Filters, lookahead and retention still
        // have to finish before the caller can commit this candidate's deadline.
        row.map(|mut row| {
            self.stamp_source(table_name, &mut row)?;
            Ok((super::recorded::public_image(table, row), expiry.defer()))
        }).transpose()
    }
}
