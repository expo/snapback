//! A one-read membership opening. No saved search state or new cursor contract.
use super::*;
use super::super::runner::extrema::Aggregate;

pub(super) fn eligible(schema: &crate::schema::Schema, merge: &Merge) -> bool {
    let [lane] = merge.lanes.as_slice() else { return false };
    let Some(source) = lane.source.as_ref().and_then(LaneSource::scan) else { return false };
    let Some(Expr::Field { base, name }) = &lane.distinct else { return false };
    // The intent membership form has one scalar scope. Keep arbitrary authored
    // expressions/lanes on their existing evaluator.
    matches!(base.as_ref(), Expr::Variable(binding) if binding == &lane.binding)
        && lane.setup.is_empty() && lane.guard.is_none() && lane.project.is_none()
        && source.take == Bound::Meter && source.filter.is_none()
        // Retained read-through rows can have a denied live parent. Their word
        // enumeration keeps the existing private/retained evaluator.
        && schema.tables[&lane.scan.table].through.is_none()
        && rules::scan_visibility(schema, source).uniform
        && rules::scan_visibility(schema, &lane.scan).uniform
        && matches!(lane.scan.prefix.first(), Some(IndexKeyExpr::Scalar(Expr::Field { base, name: field }))
            if field == name && matches!(base.as_ref(), Expr::Variable(binding) if binding == &lane.binding))
        && matches!(lane.scan.prefix.last(), Some(IndexKeyExpr::WordPrefix(_)))
        && lane.scan.prefix[1..lane.scan.prefix.len()-1].iter().all(|key| matches!(key, IndexKeyExpr::Scalar(Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_))))
}

impl Runner<'_> {
    fn opening_error(&self, site: &str, count: usize, discovered: bool) -> RuntimeError {
        let ceilings = self.meter.ceilings;
        let kind = self.meter.capped_at.as_ref().map(|cap|cap.0)
            .or_else(||(self.meter.used.steps > ceilings.steps).then_some(MeterKind::Steps));
        let (resource, ceiling) = match kind {
            Some(MeterKind::Examined) => ("examined rows", ceilings.examined),
            Some(MeterKind::IndexEntries) => ("index entries", ceilings.index_entries),
            Some(MeterKind::RuleProbes) => ("rule probes", ceilings.rule_probes),
            Some(MeterKind::Steps) => ("steps", ceilings.steps),
            Some(MeterKind::HeapBytes) => ("heap bytes", ceilings.heap_bytes),
            Some(MeterKind::OutputBytes) => ("output bytes", ceilings.output_bytes),
            _ => ("physical authorization entries", AUTHORIZATION_WALK_LIMIT as u64),
        };
        RuntimeError::SearchOpening { site: site.into(), memberships: count,
            unfinished: if discovered { "" } else { " (lower bound; total is unknown because discovery did not finish)" }, resource, ceiling }
    }

    // @ref LLP 3000.024#3 — one compact key per membership, one head per scope;
    // every candidate still passes the ordinary row/field/expiry/filter boundary.
    pub(super) fn merge_memberships(&mut self, merge: &Merge) -> Result<Vec<Value>, RuntimeError> {
        let mut progress = (0, false, true);
        let depth = self.page_depth;
        let result = self.membership_page(merge, &mut progress);
        self.page_depth = depth;
        match result {
            Err(RuntimeError::Bound { .. } | RuntimeError::AuthorizationBudget { .. }) if progress.2 => Err(self.opening_error(&merge.site, progress.0, progress.1)),
            other => other,
        }
    }

    fn membership_page(&mut self, merge: &Merge, progress: &mut (usize, bool, bool)) -> Result<Vec<Value>, RuntimeError> {
        let lane = &merge.lanes[0];
        let source = lane.source.as_ref().unwrap().scan().unwrap();
        let Expr::Field { name: field, .. } = lane.distinct.as_ref().unwrap() else { unreachable!() };
        let scan = &lane.scan;
        let table = &self.schema.tables[&scan.table];
        let index = &table.indexes[&scan.index];
        let suffix = word_heap::suffix(&mut self.meter, table, index, scan.prefix.len(), true)?;
        self.record_shape_cursor(&merge.site, None);
        if let Some(after) = scan.after.as_deref() && let Value::String(token) = self.expr(after)? {
            self.validate_word_cursor(&token, &scan.table, &scan.index, scan.order, &suffix, merge.variant.or(scan.variant))?;
            self.word_shape_cursor(&merge.site, token)?;
        }
        let depth = self.page_depth;
        self.page_depth += 1;
        let mut scopes = Vec::new();
        let prefix = self.prefix_values(source)?;
        let definition = &self.schema.tables[&source.table];
        let bounds = self.bounds(source, definition, &definition.indexes[&source.index], Some(&prefix))?;
        let result = self.scan_consumed(source, prefix, bounds, usize::MAX, None,
            Some(&mut Aggregate::Keys { values: &mut scopes, field }), false, false);
        progress.0 = scopes.len();
        if matches!(result, Err(RuntimeError::Bound { .. })) || self.read_capped() {
            return Err(self.opening_error(&merge.site, scopes.len(), false));
        }
        result?;
        // Sorting uses no extra buffer. Duplicates cannot open or emit twice.
        self.meter.step(scopes.len() as u64 * (usize::BITS - scopes.len().max(1).leading_zeros()) as u64)?;
        scopes.sort_unstable_by(Value::total_cmp);
        scopes.dedup();
        let count = scopes.len();
        *progress = (count, true, true);
        let mut heap = BinaryHeap::<MergeHead>::new();
        for scope in scopes {
            let key = self.membership_head(lane, field, &scope, None);
            if matches!(key, Err(RuntimeError::Bound { .. })) || self.read_capped() {
                return Err(self.opening_error(&merge.site, count, true));
            }
            if let Some(key) = key? {
                let grow = word_heap::grow::<MergeHead>(&mut self.meter, heap.len(), heap.capacity())?;
                if grow != 0 { heap.reserve_exact(grow); }
                heap.push(MergeHead { key, row: scope, lane: 0, order: scan.order });
            }
        }
        let take = self.take(&scan.take)?;
        let mut page = Vec::new();
        let mut last = None;
        let mut drain_cut = false;
        let mut has_more = false;
        while let Some(head) = heap.pop() {
            self.meter.step(1)?;
            if page.len() == take { has_more = true; break; }
            // Only an emitted hit materializes a result row/shape. Authorization
            // is checked again by the normal point boundary in this transaction.
            let id = head.key.last().unwrap().as_str()?;
            let Some(row) = self.authorized_member(&scan.table, id)? else {
                drain_cut = self.read_capped();
                if drain_cut && page.is_empty() { return Err(self.opening_error(&merge.site, count, true)); }
                break;
            };
            let mut row = super::super::recorded::public_image(table, self.sequence_read_result(&scan.table, row)?);
            self.stamp_source(&scan.table, &mut row)?;
            word_heap::push(&mut self.meter, &mut page, row)?;
            progress.2 = false;
            self.meter.heap(DisclosedKeys(&head.key).heap())?;
            last = Some(head.key.clone());
            let key = self.membership_head(lane, field, &head.row, Some(head.key))?;
            // @ref LLP 3000.007.000#3 — a failed refill stops before another pop.
            if self.read_capped() { drain_cut = true; break; }
            if let Some(key) = key { heap.push(MergeHead { key, row: head.row, lane: 0, order: scan.order }); }
        }
        self.page_depth = depth;
        self.note_value_source_page(has_more);
        if depth == 0 {
            let continues = self.word_cut_at.is_none() && ((has_more && !self.read_capped()) || (drain_cut && !page.is_empty()));
            self.finish_merge_page(scan, &merge.site, merge.variant.or(scan.variant), &page, last, has_more, continues, true)?;
        }
        Ok(page)
    }

    fn membership_head(&mut self, lane: &MergeLane, field: &str, scope: &Value, after: Option<Vec<Value>>) -> Result<Option<Vec<Value>>, RuntimeError> {
        // The one binding is transient, with its allowance released only after
        // the map, field names and values have been dropped/restored.
        let bytes = word_heap::node::<String, Value>() + word_heap::text(field) + DisclosedKey(scope).heap()
            + word_heap::slots::<usize>(2) + word_heap::text(&lane.binding) + word_heap::insertion::<String, Value>(self.env.len());
        self.meter.heap(bytes)?;
        let mark = self.meter.mark();
        let prior = self.env.insert(lane.binding.clone(), Value::Row(std::collections::BTreeMap::from([(field.into(), scope.clone())]).into()));
        let result = self.scope_head(&lane.scan, after);
        match prior { Some(v) => { self.env.insert(lane.binding.clone(), v); }, None => { self.env.remove(&lane.binding); } }
        self.meter.release_row_heap(mark, bytes);
        result
    }

    fn scope_head(&mut self, scan: &Scan, after: Option<Vec<Value>>) -> Result<Option<Vec<Value>>, RuntimeError> {
        let table = &self.schema.tables[&scan.table];
        let index = &table.indexes[&scan.index];
        let mut bounds = self.word_bounds(scan, table, index, None, true)?;
        let Some((scope, first, mut word)) = self.prepare_words(scan, true)? else { return Ok(None) };
        // Field selection is a storage optimization, never an authorization
        // bypass: deciding fields, expiry and remaining-term/filter inputs stay.
        let selection_bytes = 2 * table.columns.keys().map(|name| word_heap::text(name) + word_heap::insertion::<String, ()>(table.columns.len())).sum::<u64>() + word_heap::slots::<String>(table.columns.len());
        self.meter.heap(selection_bytes)?;
        let selection_mark = self.meter.mark();
        let mut fields = rules::deciding_fields(&scan.table, table, &table.rules.read);
        fields.insert("id".into());
        for part in &index.components {
            match part {
                crate::schema::IndexComponent::Column(name) => { fields.insert(name.clone()); }
                crate::schema::IndexComponent::Calendar(key) => { fields.insert(key.column.clone()); }
                _ => {}
            }
        }
        if let Some(expiry) = table.expiry_column() { fields.insert(expiry.into()); }
        if !word.terms.is_empty() { fields.extend(word.fields.iter().cloned()); }
        for authority in table.written_by.values() { fields.insert(authority.owner.clone()); }
        if scan.filter.as_ref().is_some_and(|filter| !selected_fields(filter, &mut fields))
            || !table.sequences.is_empty() || !table.recorded.is_empty() || table.through.is_some() || self.schema.maintain_for(&scan.table).is_some() {
            fields.extend(table.columns.keys().cloned());
        }
        word.selected = Some(fields.into_iter().collect());
        if after.is_some() { bounds.after = after; bounds.at_or_after = None; }
        let mut words = Bounds { word: Some(first), ..Bounds::default() };
        let mut best: Option<Vec<Value>> = None;
        loop {
            if self.read_capped() || !self.read_charge(MeterKind::IndexEntries, 1)? { break; }
            self.meter.step(1)?;
            // A uniform admitted scope permits word enumeration. The key is
            // scratch only; it cannot count/order/emit a row before the scan below.
            let scratch_bytes = self.meter.used.heap_bytes;
            let scratch = self.meter.mark();
            self.meter.heap(8 * crate::rows::MAX_INDEX_KEY_BYTES as u64 + word_heap::slots::<Value>(index.components.len() + 1))?;
            let key = self.metered_scan(|runner, authority| runner.tx.index_head(authority, &scan.table, &scan.index, &scope, &words, Dir::Asc))?;
            let token = key.and_then(|mut key| if key.len() > scope.len() { Some(key.remove(scope.len())) } else { None });
            let Some(token) = token else { self.meter.release_heap(scratch); break };
            // Preserve only the token; all other decoded components are dropped.
            let token_bytes = DisclosedKey(&token).heap();
            let released = self.meter.used.heap_bytes - scratch_bytes;
            self.meter.heap(2 * token_bytes + word_heap::slots::<Value>(1) + DisclosedKeys(&scope).heap() + word_heap::slots::<Value>(1))?;
            self.meter.release_row_heap(scratch, released);
            words.after = Some(vec![token.clone()]);
            let mut prefix = scope.clone();
            prefix.push(token);
            let mut candidate = None;
            let mut fold = Aggregate::Head { value: &mut candidate, index, prefix: scan.prefix.len() };
            self.meter.heap(DisclosedBounds(&bounds).heap())?;
            self.scan_consumed(scan, prefix, bounds.clone(), 1, Some(&word), Some(&mut fold), false, false)?;
            if self.read_capped() { break; }
            if let Some(candidate) = candidate {
                self.meter.step(1)?;
                let better = best.as_ref().is_none_or(|best| {
                    let cmp = candidate.iter().zip(best).find_map(|(a,b)| (a.total_cmp(b) != Ordering::Equal).then(|| a.total_cmp(b))).unwrap_or(Ordering::Equal);
                    if scan.order == Order::Desc { cmp.is_gt() } else { cmp.is_lt() }
                });
                if better { best = Some(candidate); }
            }
        }
        drop(word);
        self.meter.release_row_heap(selection_mark, selection_bytes);
        Ok(best)
    }
}

fn selected_fields(expr: &Expr, fields: &mut BTreeSet<String>) -> bool {
    match expr {
        Expr::Field { base, name } if matches!(base.as_ref(), Expr::Variable(v) if v == "$filter") => { fields.insert(name.clone()); true }
        Expr::Literal(_) | Expr::Input(_) => true,
        Expr::Variable(name) => name != "$filter",
        Expr::Unary { value, .. } => selected_fields(value, fields),
        Expr::Binary { left, right, .. } => selected_fields(left, fields) && selected_fields(right, fields),
        _ => false,
    }
}
