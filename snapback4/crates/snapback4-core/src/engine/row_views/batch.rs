//! A bounded delivery batch certifies several members against one current basis.
use super::*;

#[cfg(test)]
mod tests;

impl Runner<'_> {
    // @ref LLP 3000.015#3 — certify current live input regardless of cached count/pending state.
    // @ref LLP 3000.019#3.6 — snapshot and stream readers share their transaction, never a writer cache.
    pub(crate) fn live_aggregate_batch(&mut self, name: &str, rows: &[Value]) -> Result<Vec<Option<Value>>, RuntimeError> {
        self.live_batch(name, rows, true)
    }

    /// A cold snapshot walks all held groups. Skip the optional per-member
    /// 64-key small-range probe, and certify each group's live basis once.
    #[cfg(feature = "sqlite")]
    pub(crate) fn live_acquisition_batch(&mut self, name: &str, rows: &[Value]) -> Result<Vec<Option<Value>>, RuntimeError> {
        self.live_batch(name, rows, false)
    }

    fn live_batch(&mut self, name: &str, rows: &[Value], probe_small: bool) -> Result<Vec<Option<Value>>, RuntimeError> {
        assert!(rows.len() <= 256);
        let Some(m) = self.schema.maintain_for(name).filter(|m|
            !self.device && m.row_key.is_some() && self.schema.tables[&m.source].is_expiring()) else {
            return rows.iter().cloned().map(|row| self.live_aggregate(name, row)).collect();
        };
        let mark = self.meter.mark();
        let result = self.certify_batch(m, rows, probe_small);
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

    fn certify_batch(&mut self, m: &Maintain, rows: &[Value], _probe_small: bool) -> Result<Vec<Option<Value>>, RuntimeError> {
        let k = m.row_key.as_ref().unwrap();
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
            if !_probe_small {
                self.certify_acquisition_group(m, &parent, group)?;
            } else {
                self.certify_group(m, &parent, group)?;
            }
            self.meter.require_uncapped()?;
            for (position, member, total) in members.drain(..group_len) {
                out[position] = Some(self.view_image(m, &member, total, false)?);
            }
        }
        Ok(out)
    }

    fn certify_group(&mut self, m: &Maintain, parent: &Value, members: &mut [(usize, Value, i64)]) -> Result<(), RuntimeError> {
        self.certify_bounded_group(m, parent, members, true)
    }

    fn certify_acquisition_group(&mut self, m: &Maintain, parent: &Value, members: &mut [(usize, Value, i64)]) -> Result<(), RuntimeError> {
        self.certify_bounded_group(m, parent, members, false)
    }

    // @ref LLP 3000.015#3 — stream and acquisition certification share bounded
    // decoder pages; reserve against the caller before entering prepaid work.
    #[cfg(feature = "sqlite")]
    fn certify_bounded_group(&mut self, m: &Maintain, parent: &Value, members: &mut [(usize, Value, i64)], probe_small: bool) -> Result<(), RuntimeError> {
        let source = &self.schema.tables[&m.source];
        let decoder = crate::rows::disclosed::decode_reservation(source);
        let scratch = self.rule_scratch(&source.rules.read);
        let single_bytes = decoder.saturating_add(scratch);
        let page_bytes = decoder.saturating_mul(32)
            .saturating_add(scratch)
            .saturating_add(crate::rows::word_heap::slots::<(Value, Vec<u8>)>(32))
            .saturating_add(crate::rows::word_heap::slots::<(Option<super::super::authorized_point::AuthorizedRow<'_>>, Vec<u8>)>(32));
        let internal = (self.meter.ceilings.heap_bytes, self.meter.used.heap_bytes);
        let caller = self.caller_heap_ceiling;
        let (limit, used) = caller.unwrap_or(internal);
        let page = if page_bytes <= limit.saturating_sub(used) { 32 } else { 1 };
        self.meter.ceilings.heap_bytes = limit;
        self.meter.used.heap_bytes = used;
        let result = (|| {
            self.meter.heap(if page == 32 { page_bytes } else { single_bytes })?;
            // Nested public witnesses must see the reservation as occupied too.
            self.caller_heap_ceiling = Some((limit, self.meter.used.heap_bytes));
            self.prepaid_scan(&[(MeterKind::Examined, members.len() as u64), (MeterKind::Steps, members.len() as u64)], false,
                |runner, _| runner.certify_group_mode(m, parent, members, probe_small, page))
        })();
        self.caller_heap_ceiling = caller;
        self.meter.ceilings.heap_bytes = internal.0;
        self.meter.used.heap_bytes = internal.1;
        result
    }

    fn certify_group_mode(&mut self, m: &Maintain, parent: &Value, members: &mut [(usize, Value, i64)], probe_small: bool, _page: usize) -> Result<(), RuntimeError> {
        // Receipt changes commonly leave only a few unread positions. Every
        // member is authorized before these bounded, private probes.
        let mut small = probe_small;
        for (_, member, total) in members.iter_mut().take(if probe_small { usize::MAX } else { 0 }) {
            match self.small_view_range(m, member)? {
                Some(n) => *total = n,
                None => { small = false; break; }
            }
        }
        if small { return Ok(()); }
        for (_, _, total) in &mut *members { *total = 0; }
        let k = m.row_key.as_ref().unwrap();
        let source = &self.schema.tables[&m.source];
        let index = k.range_index(source.expiry_column().unwrap());
        let prefix = std::slice::from_ref(parent);
        self.meter.heap(crate::rows::word_heap::key_decode(source.indexes[&index].components.len() + 1,
            crate::rows::MAX_INDEX_KEY_BYTES).saturating_mul(2))?;
        let predicate_steps = k.predicate.steps() * 2 + 4;
        for mut bounds in [Bounds { lte: Some(Value::Null), ..Default::default() },
            Bounds { gt: Some(Value::Int(self.context.now.unwrap_or(0))), ..Default::default() }] {
            loop {
                self.meter.charge(MeterKind::Examined, 1)?;
                let mark = self.meter.mark();
                let result = (|| {
                    // Every source row still crosses the sealed rule/field boundary.
                    // The same sealed authorization path in bounded pages;
                    // a cold partition must not re-plan a scan for every row.
                    #[cfg(feature = "sqlite")]
                    let batch = _page > 1;
                    #[cfg(feature = "sqlite")]
                    let rows = if batch { self.scan_acquisition_basis(&m.source, &index, prefix, &bounds)? } else {
                        self.scan_authorized(&m.source, &index, prefix, &bounds, Dir::Asc, 1, true, true, #[cfg(feature = "server-search")] None)?
                    };
                    #[cfg(not(feature = "sqlite"))]
                    let rows = self.scan_authorized(&m.source, &index, prefix, &bounds, Dir::Asc, 1, true, true, #[cfg(feature = "server-search")] None)?;
                    if rows.is_empty() { return Ok(false); }
                    for (position, (row, key)) in rows.into_iter().enumerate() {
                    if position != 0 { self.meter.charge(MeterKind::Examined, 1)?; }
                    let Some(row) = row else {
                        return Err(RuntimeError::Prediction("row-view source authority is not covered".into()));
                    };
                    let row = row.into_value();
                    self.rebuilt_source_rows = self.rebuilt_source_rows.saturating_add(1);
                    bounds.after = crate::key::decode(&key).map(|v| v.into_iter().skip(1).collect());
                    let live = !self.expired(source, &row);
                    let mut contributed = false;
                    for (_, member, total) in &mut *members {
                        self.meter.step(predicate_steps)?;
                        if live && k.matches(&row, member) {
                            *total += 1;
                            if !contributed { self.note_expiry(source, &row); contributed = true; }
                        }
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
