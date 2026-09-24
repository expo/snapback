//! Lazy ordered merge, with borrowed word-lane IR and prepaid descriptor growth.
use super::*;

impl Runner<'_> {
    pub(super) fn word_note_table(&mut self, table: &str) -> Result<(), RuntimeError> {
        if !self.read_tables.contains(table) {
            self.meter.heap(word_heap::text(table) + word_heap::insertion::<String, ()>(self.read_tables.len()))?;
            self.read_tables.insert(table.to_owned());
        }
        Ok(())
    }
    pub(super) fn word_dependencies(&mut self, rule: &crate::schema::RuleExpr) -> Result<(), RuntimeError> {
        use crate::schema::RuleExpr::*;
        match rule {
            Exists { table, .. } | Created { table, .. } => {
                if let Some(maintain) = self.schema.maintain_for(table)
                    && self.schema.table(&maintain.source).is_some_and(|t| t.expire.is_some()) { self.word_note_table(&maintain.source)?; }
                self.word_note_table(table)?;
            }
            And(rules) | Or(rules) => { for rule in rules { self.word_dependencies(rule)?; } }
            Not(rule) => self.word_dependencies(rule)?, _ => {}
        }
        Ok(())
    }
    pub(super) fn word_shape_cursor(&mut self, site: &str, token: String) -> Result<(), RuntimeError> {
        if self.page_depth == 0 && self.page_plan.shapes.values().any(|shape| shape.page == site) {
            self.meter.heap(word_heap::text(site) + word_heap::insertion::<String, String>(self.shape_cursors.len()))?;
        }
        self.record_shape_cursor(site, Some(token));
        Ok(())
    }

    pub(super) fn validate_word_cursor(&mut self, token: &str, table: &str, index: &str, order: Order, suffix: &[CursorColumn]) -> Result<(), RuntimeError> {
        if self.word_cursor.as_ref().is_none_or(|(cached, _)| cached != token) {
            self.meter.heap(word_heap::cursor_decode(token) + word_heap::text(token))?;
            let position = decode_cursor(self.schema, token).map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?;
            self.word_cursor = Some((token.to_owned(), position));
        }
        let position = &self.word_cursor.as_ref().unwrap().1;
        if position.table != table || position.index != index || position.order != order || position.suffix != suffix {
            return Err(RuntimeError::Input(format!("cursor: {}", crate::cursor::CursorError::Descriptor)));
        }
        Ok(())
    }

    /// One head per uniform lane, then advance only the winning lane. Each
    /// one-row scan retains the ordinary scan's lookahead and meter checks.
    /// Deduplicate before counting the page, including overlapping lanes.
    pub(super) fn merge_lazy(&mut self, merge: Option<&Merge>, direct: Option<&Scan>) -> Result<Vec<Value>, RuntimeError> {
        let Some(first) = merge.and_then(|m| m.lanes.first()).map(|l| &l.scan).or(direct) else { return Ok(Vec::new()) };
        let site = merge.map_or(first.site.as_str(), |m| &m.site);
        let table = self.schema.table(&first.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", first.table)))?;
        let index = table.index(&first.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", first.table, first.index)))?;
        let take = self.take(&first.take)?;
        let order = first.order;
        let prefix_len = first.prefix.len();
        let metered_merge = first.prefix.iter().any(|k| matches!(k, IndexKeyExpr::WordPrefix(_)));
        let suffix = if metered_merge { word_heap::suffix(&mut self.meter, table, index, prefix_len, true)? }
            else { Self::merge_suffix(table, index, prefix_len) };
        let suffix_len = suffix.len();
        // @ref LLP 3000.007.000#1 — the merge position: every valued component after the prefix (a computed calendar key evaluates on the row), plus the stored row id when the suffix lacks it.
        let merge_key = move |row: &Value| -> Vec<Value> {
            let mut key = Vec::with_capacity(suffix_len);
            key.extend(index.components.iter().skip(prefix_len).filter_map(|component| component.value(row)));
            if key.len() < suffix_len { key.push(row.field("id").cloned().unwrap_or(Value::Null)); }
            key
        };
        self.record_shape_cursor(site, None);
        if first.opaque_cursor
            && let Some(after) = first.after.as_deref()
            && let Value::String(token) = self.expr(after)?
        {
            // The merge's initial cursor validation also allocates decode scratch.
            if metered_merge { self.validate_word_cursor(&token, &first.table, &first.index, order, &suffix)?; }
            else { decode_cursor_for(self.schema, &token, &first.table, &first.index, order, &suffix)
                .map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?; }
            if metered_merge { self.word_shape_cursor(site, token)?; }
            else { self.record_shape_cursor(site, Some(token)); }
        }
        let key_of = |row: &Value| merge_key(row);
        let depth = self.page_depth;
        self.page_depth += 1;
        let mut lanes: Vec<PreparedLane<'_>> = Vec::new();
        let mut heap = BinaryHeap::new();
        // No boxed word iterator or temporary generated Scan vector: the original
        // scan (including its arbitrary Expr trees and named take) is borrowed.
        for (scan, lane) in merge.into_iter().flat_map(|m| m.lanes.iter().map(|l| (&l.scan, Some(l))))
            .chain(direct.map(|s| (s, None))) {
            if metered_merge { self.meter.heap(word_heap::slots::<std::iter::Once<Value>>(1))?; }
            let sources = match lane { Some(lane) => self.lane_values(lane)?, None => Box::new(std::iter::once(Value::Null)) };
            for source_row in sources {
                if let Some(lane) = lane {
                    if !self.charge_lane(lane, site)? { break; }
                    if lane.source.is_some() { self.env.insert(lane.binding.clone(), source_row); }
                }
                if scan.prefix.iter().any(|key| matches!(key, IndexKeyExpr::WordPrefix(_))) {
                    let Some((words, scope, word)) = self.discover_words(scan)? else { continue };
                    self.meter.heap(word_heap::slots::<WordRead>(1) + 2 * word_heap::slots::<usize>(1))?;
                    let word = std::rc::Rc::new(word);
                    let definition = &self.schema.tables[&scan.table];
                    let index = definition.index(&scan.index).unwrap();
                    for token in words {
                        self.meter.heap(word_heap::text(site))?;
                        self.meter.at(site);
                        if self.read_capped() || !self.read_charge(MeterKind::Steps, 1)? { break; }
                        // Borrow the IR but retain per-lane evaluation of arbitrary
                        // bounds expressions (including their nested read costs).
                        let bounds = self.word_bounds(scan, definition, index, None, true)?;
                        self.meter.heap(word_heap::slots::<Value>(scope.len() + 1) + scope.iter().map(word_heap::value).sum::<u64>())?;
                        let mut prefix = Vec::with_capacity(scope.len() + 1);
                        prefix.extend(scope.iter().cloned());
                        prefix.push(Value::String(token));
                        word_heap::push(&mut self.meter, &mut lanes, (scan, prefix, bounds, VecDeque::new(), false, Some(word.clone())))?;
                    }
                } else {
                    let descriptor = lane.is_some_and(|lane| lane.source.as_ref().is_some_and(|source| source.scan().is_none()));
                    let prefix = self.prefix_values(scan)?;
                    let definition = &self.schema.tables[&scan.table];
                    let index = definition.index(&scan.index).unwrap();
                    let bounds = self.bounds(scan, definition, index, None)?;
                    if descriptor {
                        // Keep the previous range/list descriptor allowance. Exact
                        // word accounting must not change ordinary merges' costs.
                        let positions = [&bounds.after, &bounds.at_or_after, &bounds.before].into_iter().flatten().map(|values| {
                            values.capacity() as u64 * std::mem::size_of::<Value>() as u64 + values.iter().map(Value::heap_bytes).sum::<u64>()
                        }).sum::<u64>();
                        let seeks = [&bounds.gt, &bounds.gte, &bounds.lt, &bounds.lte].into_iter().flatten().map(Value::heap_bytes).sum::<u64>();
                        self.meter.heap(2 * std::mem::size_of::<(std::borrow::Cow<'_, Scan>, Vec<Value>, Bounds, VecDeque<Value>, bool, Option<WordRead>)>() as u64
                            + prefix.capacity() as u64 * std::mem::size_of::<Value>() as u64 + prefix.iter().map(Value::heap_bytes).sum::<u64>()
                            + positions + seeks + bounds.word.as_ref().map_or(0, |word| word.capacity() as u64))?;
                    }
                    lanes.push((scan, prefix, bounds, VecDeque::new(), false, None));
                }
            }
        }
        // A small merge benefits from a page per lane: repeated one-row SQL
        // seeks would cost more than reading those few pages in one call.
        let batch = if first.existence { 1 } else if lanes.len() <= 8 { take + 1 } else { 1 };
        for (position, (scan, prefix, bounds, buffer, done, lane_word)) in lanes.iter_mut().enumerate() {
            let (rows, _) = self.word_scan_prepared(scan, prefix, bounds, batch, lane_word.as_deref())?;
            if scan.existence && !rows.is_empty() {
                self.page_depth = depth;
                return Ok(rows);
            }
            *done = rows.len() < batch && !self.read_capped();
            *buffer = rows.into();
            if let Some(row) = buffer.pop_front() {
                self.meter.step(1)?;
                if lane_word.as_ref().is_some_and(|word| word.metered) {
                    self.charge_word_key(index, prefix_len, suffix_len, &row)?;
                    let additional = word_heap::grow::<MergeHead>(&mut self.meter, heap.len(), heap.capacity())?;
                    if additional != 0 { heap.reserve_exact(additional); }
                }
                let key = key_of(&row);
                heap.push(MergeHead { key, row, lane: position, order });
            }
        }
        // @ref LLP 3000.007.000#3 — only after an uncut opening does a failed refill stop the drain, after emitted and duplicate pops alike.
        let opened_all = !self.read_capped();
        let mut drain_cut = false;
        let mut seen = BTreeSet::<String>::new();
        let mut page = Vec::new();
        let mut has_more = false;
        let mut last = None;
        while let Some(head) = heap.pop() {
            self.meter.step(1)?;
            let metered_word = lanes[head.lane].5.as_ref().is_some_and(|word| word.metered);
            let id = head.row.field("id")?.as_str()?;
            if !seen.contains(id) {
                if metered_word {
                    self.meter.heap(word_heap::text(id) + word_heap::insertion::<String, ()>(seen.len()))?;
                }
                seen.insert(id.to_owned());
                if page.len() == take { has_more = true; break; }
                if metered_word { self.meter.heap(word_heap::values(&head.key))?; }
                last = Some(head.key.clone());
                if metered_word { word_heap::push(&mut self.meter, &mut page, head.row)?; }
                else { page.push(head.row); }
            }
            let (scan, prefix, bounds, buffer, done, lane_word) = &mut lanes[head.lane];
            bounds.after = Some(head.key);
            if opened_all && buffer.is_empty() && !*done {
                if self.read_capped() { drain_cut = true; break; }
                let (rows, _) = self.word_scan_prepared(scan, prefix, bounds, batch, lane_word.as_deref())?;
                *done = rows.len() < batch && !self.read_capped();
                *buffer = rows.into();
                if self.read_capped() { drain_cut = true; break; }
            }
            if let Some(row) = buffer.pop_front() {
                if metered_word { self.charge_word_key(index, prefix_len, suffix_len, &row)?; }
                let key = key_of(&row);
                heap.push(MergeHead { key, row, lane: head.lane, order });
            }
        }
        self.page_depth = depth;
        if depth == 0 {
            if first.opaque_cursor {
                let continues = self.word_cut_at.is_none() && ((has_more && !self.read_capped()) || (opened_all && drain_cut && !page.is_empty()));
                if metered_merge {
                    // Returned shaping may rewind to any emitted key, including
                    // one larger than the final key, or resume a terminal page.
                    // Prepay its collector before record_page constructs it. Its
                    // existing generic charge remains a conservative extra charge.
                    let shaped = self.page_plan.shapes.values().any(|shape| shape.page == site);
                    let mut max_key = 0;
                    let mut shape_bytes = if shaped { word_heap::vec_growth::<Vec<Value>>(page.len()) } else { 0 };
                    for row in &page {
                        let payload = index.components.iter().skip(prefix_len).filter_map(|c| c.column()).filter_map(|name| row.field(name).ok()).map(word_heap::value).sum::<u64>()
                            + if index.components.last().and_then(|c| c.column()).map(String::as_str) != Some("id") { row.field("id").map_or(0, word_heap::value) } else { 0 };
                        let bytes = word_heap::slots::<Value>(suffix_len) + payload;
                        max_key = max_key.max(bytes);
                        if shaped { shape_bytes += word_heap::vec_growth::<Value>(suffix_len) + payload; }
                    }
                    // A later returned-shape cut records a copied key in a
                    // separate map. Prepay every possible shape site now, too.
                    let trims = self.page_plan.shapes.iter().filter(|(_, shape)| shape.page == site).enumerate().map(|(n, (name, _))| {
                        word_heap::text(name) + max_key + word_heap::insertion::<String, super::super::shaping::ShapePosition>(self.shape_positions.len() + n)
                    }).sum::<u64>();
                    self.meter.heap(shape_bytes + trims + word_heap::insertion::<String, PagePosition>(self.pages.len())
                        + 3 * (word_heap::text(site) + word_heap::text(&first.table) + word_heap::text(&first.index))
                        + last.as_ref().map_or(0, |key| 2 * word_heap::values(key))
                        + word_heap::cursor_build(table, index, prefix_len, if continues || shaped { max_key } else { 0 }, word_heap::text(&first.table) + word_heap::text(&first.index)))?;
                }
                self.record_page(site.to_owned(), PagePosition { view_suffix: None, table: first.table.clone(), index: first.index.clone(), order, prefix_len, prefix: None, merge: true, interrupted: false, inclusive: false, shape_positions: Vec::new(), shape_resume: super::super::shaping::Resume::Never, next: if continues { last } else { None } }, page.iter())?;
            } else if has_more { self.page_overflow = true; self.components.note(|frame| frame.overflow = true); }
        }
        Ok(page)
    }
}
