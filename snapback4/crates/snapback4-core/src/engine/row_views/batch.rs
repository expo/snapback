//! A bounded delivery batch certifies several members against one current basis.
use super::*;

#[cfg(test)]
mod tests;

impl Runner<'_> {
    // @ref LLP 3000.015#3 — certify current live input regardless of cached count/pending state.
    // @ref LLP 3000.019#3.6 — snapshot and stream readers share their transaction, never a writer cache.
    pub(crate) fn live_aggregate_batch(&mut self, name: &str, rows: &[Value]) -> Result<Vec<Option<Value>>, RuntimeError> {
        assert!(rows.len() <= 256);
        let Some(m) = self.schema.maintain_for(name).filter(|m|
            !self.device && m.row_key.is_some() && self.schema.tables[&m.source].is_expiring()) else {
            return rows.iter().cloned().map(|row| self.live_aggregate(name, row)).collect();
        };
        let mark = self.meter.mark();
        let result = self.certify_batch(m, rows);
        self.meter.release_heap(mark);
        // The transient members and walk are gone; the returned images remain.
        if let Ok(images) = &result {
            self.meter.heap(crate::rows::word_heap::slots::<Option<Value>>(images.len()))?;
            for _ in images.iter().flatten() {
                self.meter.heap(super::super::write_target::row_copy_ceiling(&self.schema.tables[&m.target]))?;
            }
        }
        result
    }

    fn certify_batch(&mut self, m: &Maintain, rows: &[Value]) -> Result<Vec<Option<Value>>, RuntimeError> {
        let k = m.row_key.as_ref().unwrap();
        let source = &self.schema.tables[&m.source];
        self.read_tables.insert(k.table.clone());
        self.read_tables.insert(m.source.clone());
        self.meter.heap(crate::rows::word_heap::slots::<Option<Value>>(rows.len()))?;
        self.meter.heap(crate::rows::word_heap::slots::<(usize, Value, i64)>(rows.len()))?;
        self.meter.heap(crate::rows::MAX_INDEX_KEY_BYTES as u64 * 4)?;
        // Reserve all output images before constructing any. Member payload is
        // separately authorized and charged by row_view_member_image.
        self.meter.heap(super::super::write_target::row_copy_ceiling(&self.schema.tables[&m.target])
            .saturating_mul(rows.len() as u64))?;
        let mut out = vec![None; rows.len()];
        let mut members = Vec::with_capacity(rows.len());
        for (position, row) in rows.iter().enumerate() {
            let Some(member) = self.row_view_member_image(m, row)? else { continue; };
            if !self.row_view_source_readable(m, &member)? {
                self.pending_view_read()?;
                out[position] = Some(self.view_image(m, &member, 0, true)?);
            } else {
                members.push((position, member, 0_i64));
            }
        }
        // At most 256 members. Adjacent batches need no shared cache or lifetime.
        while let Some((_, first, _)) = members.first() {
            let parent = first.field(&k.member_key)?.clone();
            let mut group_len = 0;
            for at in 0..members.len() {
                self.meter.step(1)?;
                if members[at].1.field(&k.member_key)? == &parent {
                    members.swap(group_len, at);
                    group_len += 1;
                }
            }
            let group = &mut members[..group_len];
            let bytes = crate::rows::disclosed::decode_reservation(source);
            self.disclosed_scratch(bytes, &[(MeterKind::Examined, group_len as u64), (MeterKind::Steps, group_len as u64)], |runner, _| {
                runner.certify_group(m, &parent, group)
            })?;
            self.meter.require_uncapped()?;
            for (position, member, total) in members.drain(..group_len) {
                out[position] = Some(self.view_image(m, &member, total, false)?);
            }
        }
        Ok(out)
    }

    fn certify_group(&mut self, m: &Maintain, parent: &Value, members: &mut [(usize, Value, i64)]) -> Result<(), RuntimeError> {
        let k = m.row_key.as_ref().unwrap();
        let source = &self.schema.tables[&m.source];
        let index = k.range_index(source.expiry_column().unwrap());
        let prefix = std::slice::from_ref(parent);
        self.meter.heap(crate::rows::word_heap::key_decode(source.indexes[&index].components.len() + 1,
            crate::rows::MAX_INDEX_KEY_BYTES).saturating_mul(2))?;
        for mut bounds in [Bounds { lte: Some(Value::Null), ..Default::default() },
            Bounds { gt: Some(Value::Int(self.context.now.unwrap_or(0))), ..Default::default() }] {
            loop {
                self.meter.charge(MeterKind::Examined, 1)?;
                let mark = self.meter.mark();
                let result = (|| {
                    // Every source row still crosses the sealed rule/field boundary.
                    let Some((row, key)) = self.scan_authorized(&m.source, &index, prefix, &bounds, Dir::Asc, 1, true, true, #[cfg(feature = "server-search")] None)?.pop() else { return Ok(false); };
                    let Some(row) = row else {
                        return Err(RuntimeError::Prediction("row-view source authority is not covered".into()));
                    };
                    let row = row.into_value();
                    self.rebuilt_source_rows = self.rebuilt_source_rows.saturating_add(1);
                    bounds.after = crate::key::decode(&key).map(|v| v.into_iter().skip(1).collect());
                    for (_, member, total) in &mut *members {
                        self.meter.step(k.predicate.steps() * 2 + 4)?;
                        if !self.expired(source, &row) && k.matches(&row, member) {
                            *total += 1;
                            self.note_expiry(source, &row);
                        }
                    }
                    Ok(true)
                })();
                self.meter.release_heap(mark);
                if !result? { break; }
            }
        }
        Ok(())
    }
}
