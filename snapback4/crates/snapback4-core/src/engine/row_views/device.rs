//! Device-only suffix counts. Server certification and durable cursors stay on the live basis.
use super::*;

impl Runner<'_> {
    // @ref LLP 3000.020#3.3 — a horizon miss asks the server; a covered meter cut only publishes its partial.
    pub(super) fn device_live_count(&mut self, m: &Maintain, member: &Value) -> Result<(i64, bool), RuntimeError> {
        let k = m.row_key.as_ref().unwrap();
        let selected = k.device_range(&self.schema.tables[&m.source])
            .and_then(|plan| plan.lower_bound(member).map(|(value, strict)| (plan.column, value, strict)));
        let mut bounds = Bounds::default();
        let (index, range) = if let Some((column, value, strict)) = selected {
            *(if strict { &mut bounds.gt } else { &mut bounds.gte }) = Some(value.clone());
            (k.range_index(column), true)
        } else { (k.source_index(), false) };
        let covered = self.covered_view_source(m, member, &index, &bounds)?;
        if !covered {
            if !range { return Ok((0, false)); }
            self.unknown_fact(&m.source, &index, std::slice::from_ref(member.field(&k.member_key)?), "row-keyed view range");
            if self.meter.cut == crate::meter::Cut::Abort {
                self.pending_view_read()?;
            }
        }
        let limit = self.scan_room(m).min(if self.meter.cut == crate::meter::Cut::Abort { WRITER_RECOUNT } else { usize::MAX });
        let (n, complete, _) = if range {
            self.view_scan(m, member, None, &index, bounds, limit, true)?
        } else { self.live_basis_scan(m, member, None, limit)? };
        Ok((if range || complete { n } else { 0 }, covered && complete && !self.beyond_horizon))
    }
}
