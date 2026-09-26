//! Device-only suffix counts. Server certification and durable cursors stay on the live basis.
use super::*;

impl Runner<'_> {
    pub(super) fn device_view_plan(&self, m: &Maintain, member: &Value) -> (String, Bounds, bool) {
        let k = m.row_key.as_ref().unwrap();
        if let Some(range) = k.device_range(&self.schema.tables[&m.source])
            && let Some(bounds) = range.bounds(member) {
            return (k.range_index(range.column), bounds, true);
        }
        (k.source_index(), Bounds::default(), false)
    }

    // @ref LLP 3000.020#3.3 — a horizon miss asks the server; a covered meter cut only publishes its partial.
    pub(super) fn device_live_count(&mut self, m: &Maintain, member: &Value) -> Result<(i64, bool), RuntimeError> {
        let (index, bounds, range) = self.device_view_plan(m, member);
        let covered = self.covered_view_source(m, member, &index, &bounds)?;
        if !covered {
            if !range { return Ok((0, false)); }
            let k = m.row_key.as_ref().unwrap();
            self.unknown_fact(&m.source, &index, &[member.field(&k.member_key)?.clone()], "row-keyed view range");
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
