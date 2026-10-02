//! Transactional count evidence. Authority is freshly proved before reuse.
// @ref LLP 3000.015#3 — versioned basis, conservative deadline, current authority.
use super::*;

impl Runner<'_> {
    pub(super) fn view_certification_version(&mut self, m: &Maintain) -> String {
        if let Some((name, version)) = &self.count_version
            && name == &m.target { return version.clone(); }
        let k = m.row_key.as_ref().unwrap();
        // Includes rules, audience, field disclosure, defaults, effective expiry
        // and the predicate. Witness *data* is checked fresh, never cached here.
        let version = crate::value::digest(&("count-basis-v2", m,
            &self.schema.tables[&m.source], &self.schema.tables[&k.table]));
        self.count_version = Some((m.target.clone(), version.clone()));
        version
    }

    pub(super) fn certification_scratch(&self, m: &Maintain) -> u64 {
        [&m.target, &format!("$basis:{}", m.target)].into_iter()
            .map(|name| crate::rows::disclosed::decode_reservation(&self.schema.tables[name]))
            .sum()
    }

    /// The maintained value and evidence belong to the current transaction,
    /// not the historical image passed by a log/snapshot caller. Pending values
    /// never substitute for the live walk. Missing pre-upgrade evidence misses.
    /// The caller has admitted source scratch and proved member/group authority.
    pub(super) fn certified_view_count(&mut self, m: &Maintain, member: &Value) -> Result<Option<i64>, RuntimeError> {
        let source = &self.schema.tables[&m.source];
        let k = m.row_key.as_ref().unwrap();
        // Row-dependent field disclosure and read-through authority need the
        // sealed per-source path. Recorded member inputs are stripped by the
        // query projection too. Private member predicates already require an
        // owner-only read rule at schema admission.
        // Expiring recipients can miss source deltas while absent, then become
        // live again after rollback. Their stored numerical basis is not proof.
        // This includes inherited expiry and avoids walking expired recipients.
        if self.device || self.schema.tables[&k.table].is_expiring() || source.through.is_some() || !source.recorded.is_empty()
            || !self.schema.tables[&k.table].recorded.is_empty()
            || source.written_by.values().any(|field| !field.audience)
            || self.schema.maintain_for(&m.source).is_some()
            || !Self::view_source_uniform(&m.source, source, &k.source_key, member.field(&k.member_key)?) {
            return Ok(None);
        }
        let mark = self.meter.mark();
        let result = (|| {
            self.meter.heap(self.certification_scratch(m))?;
            self.meter.step(1)?;
            let id = member.field("id")?.as_str()?;
            let Some(basis) = self.view_get(&format!("$basis:{}", m.target), id)? else { return Ok(None); };
            let now = self.context.now.unwrap_or(0);
            if basis.field("version").ok().and_then(|v| v.as_str().ok()) != Some(self.view_certification_version(m).as_str())
                || number(&basis, "at") > now { return Ok(None); }
            let deadline = match basis.field("deadline") {
                Ok(Value::Null) => None,
                Ok(Value::Int(at)) if *at > now => Some(*at),
                _ => return Ok(None),
            };
            let Some(row) = self.view_get(&m.target, id)? else { return Ok(None); };
            if pending(&row) { return Ok(None); }
            self.next_expiry.note_option(deadline);
            Ok(Some(number(&row, "value")))
        })();
        self.meter.release_heap(mark);
        result
    }

    /// Source deltas already evaluate the full predicate for every recipient.
    /// Extend their evidence atomically. Removing the earliest candidate seeks
    /// the next expiry key, so a completed sweep restores reusable evidence.
    pub(super) fn extend_view_certification(&mut self, m: &Maintain, id: &str, parent: &Value, removed: Option<i64>, deadline: Option<i64>) -> Result<(), RuntimeError> {
        if removed.is_none() && deadline.is_none() { return Ok(()); }
        let table = format!("$basis:{}", m.target);
        let Some(basis) = self.view_get(&table, id)? else { return Ok(()); };
        let before = basis.field("deadline").ok().and_then(|v| v.as_int().ok());
        let next_deadline = if removed.is_some() && removed == before {
            let source = &self.schema.tables[&m.source];
            let index = m.row_key.as_ref().unwrap().range_index(source.expiry_column().unwrap());
            self.charge_maintain(MeterKind::Examined, 1)?;
            // All future-in-basis source rows are a superset of contributors.
            // No payload or predicate work, and no scan of expired history.
            self.metered_scan(|r, scope| r.tx.index_head(scope, &m.source, &index, std::slice::from_ref(parent),
                &Bounds { gt: Some(Value::Int(number(&basis, "at"))), ..Default::default() }, Dir::Asc))?
                .and_then(|key| key.get(1).and_then(|v| v.as_int().ok()))
        } else { before.into_iter().chain(deadline).min() };
        if next_deadline == before { return Ok(()); }
        let mut next = basis.as_object()?.clone();
        next.insert("deadline".into(), next_deadline.map(Value::Int).unwrap_or(Value::Null));
        self.view_put(&table, &Value::Row(next.into()), Some(&basis), true)
    }
}
