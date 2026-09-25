//! B1's sealed result boundary, specialized to B3's authorized member read.
use super::runner::Runner;
use crate::{Value, RuntimeError, schema::{Effect, row_image}, meter::Meter, error::MeterKind};

// Only the successful row-read verdict below can construct this capability.
// B3 has no written-by surface yet; query projection omits recorded fields.
// The combined baseline uses B1's Disclosed projection in this same capability.
struct AuthorizedRow(Value);
impl AuthorizedRow {
    fn charge(self, meter: &mut Meter) -> Result<Value, RuntimeError> {
        meter.heap(self.0.heap_bytes())?;
        Ok(self.0)
    }
}
impl Runner<'_> {
    // @ref LLP 3000.015#1 — B1's reservation/internal-ledger/sealed-result order.
    pub(super) fn authorized_member(&mut self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        let definition = &self.schema.tables[table];
        let bytes = crate::rows::disclosed::decode_reservation(definition);
        let expiry_mark = self.next_expiry;
        let authorized = self.authorized_scratch(bytes, &[(MeterKind::Examined,1)], |runner,_| {
            let Some(row) = runner.tx.get(table,id)? else { return Ok(None); };
            let row = row_image(&row,definition).into_owned();
            if runner.expired(definition,&row) || !runner.check_rule(table,Effect::Read,None,&row)? {
                runner.next_expiry = expiry_mark;
                return Ok(None);
            }
            runner.note_expiry(definition,&row);
            Ok(Some(AuthorizedRow(super::recorded::public_image(definition,row))))
        })?;
        authorized.map(|row|row.charge(&mut self.meter)).transpose()
    }
}
