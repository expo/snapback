//! Device-only suffix counts. Server certification and durable cursors stay on the live basis.
use super::*;

impl Runner<'_> {
    // @ref LLP 3000.020#3.3 — a horizon miss asks the server; a covered meter cut only publishes its partial.
    pub(super) fn device_live_count(&mut self, m: &Maintain, member: &Value) -> Result<(i64, bool), RuntimeError> {
        let k = m.row_key.as_ref().unwrap();
        let writer = self.meter.cut == crate::meter::Cut::Abort;
        // @ref LLP 3000.020#3.2 — Whole keeps the expiry-index seek around expired backlog.
        if self.covered_view_source(m, member, &k.source_index(), &Bounds::default())? {
            let limit = self.scan_room(m).min(if writer { WRITER_RECOUNT } else { usize::MAX });
            let (n, complete, _) = self.live_basis_scan(m, member, None, limit)?;
            return Ok((if complete { n } else { 0 }, complete && !self.beyond_horizon));
        }
        let Some(plan) = k.device_range(&self.schema.tables[&m.source]) else { return Ok((0, false)); };
        let Some((value, strict)) = plan.lower_bound(member) else { return Ok((0, false)); };
        let index = k.range_index(plan.column);
        let mut bounds = Bounds::default();
        *(if strict { &mut bounds.gt } else { &mut bounds.gte }) = Some(value.clone());
        let covered = self.covered_view_source(m, member, &index, &bounds)?;
        if !covered {
            self.unknown_fact(&m.source, &index, std::slice::from_ref(member.field(&k.member_key)?), "row-keyed view range");
            if writer { self.pending_view_read()?; }
        }
        // The final empty seek proves completion at exactly 1,024 candidates.
        // A 1,025th candidate leaves complete=false and the prediction rolls back.
        let limit = self.scan_room(m).min(if writer { WRITER_RECOUNT + 1 } else { usize::MAX });
        let (n, complete, _) = self.view_scan(m, member, None, &index, bounds, limit, true)?;
        Ok((n, covered && complete && !self.beyond_horizon))
    }
}
