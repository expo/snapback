//! A query page planned as the k-way merge of its disjunctive branches
//! (LLP 3000.036.001): `tasks where .owner = viewer or .assignee = viewer`, or
//! the same list read through `read <- .owner = viewer or .assignee = viewer`.
//! Each lane is an index range of one table whose prefix decides the read
//! rule; lanes may read different indexes. Every lane resumes on its own
//! index from one shared position, the order columns then `id`, which
//! totally orders the union, so a row matching several branches has one
//! position and is emitted once.
use super::*;

/// One opened lane: its scan (without the shared cursor), evaluated prefix
/// and bounds, the rows read ahead, whether the range is exhausted, and the
/// grant verdict's deadline when a grant admitted it.
struct Lane {
    scan: Scan,
    prefix: Vec<Value>,
    bounds: Bounds,
    buffer: VecDeque<Value>,
    done: bool,
    grant: Option<super::super::expiry::Pending>,
    position_len: usize,
    /// The last position this lane examined (read or rejected by the
    /// filter), when it has examined anything past the cursor.
    through: Option<Vec<Value>>,
}

impl Runner<'_> {
    // @ref LLP 3000.036.001#3 — the lazy merge across indexes: one heap of lane heads, one shared position.
    pub(super) fn merge_branches(&mut self, merge: &Merge) -> Result<Vec<Value>, RuntimeError> {
        let first = &merge.lanes[0].scan;
        let site = merge.site.as_str();
        let table = self.schema.table(&first.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", first.table)))?;
        let index = table.index(&first.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", first.table, first.index)))?;
        let take = self.take(&first.take)?;
        let order = first.order;
        let suffix = Self::merge_suffix(table, index, first.prefix.len());
        let descriptor = merge.branch_descriptor();
        // Every lane's evaluated pins, in lane order: the token's scope, so a
        // cursor never resumes a page whose arguments or viewer changed
        // (Muse round 3, finding 1), as a direct page's scope does.
        let prefixes = merge.lanes.iter().map(|lane| match lane.source.as_ref().and_then(LaneSource::scan) {
            Some(source) if lane.membership() => self.prefix_values(source), _ => self.prefix_values(&lane.scan),
        }).collect::<Result<Vec<_>, _>>()?;
        let scope = branch_scope(&prefixes)?;
        self.record_shape_cursor(site, None);
        let mut after = None;
        if first.opaque_cursor && let Some(expr) = first.after.as_deref() {
            match self.expr(expr)? {
                Value::Null => {}
                Value::String(token) => {
                    let position = decode_cursor(self.schema, &token).map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?;
                    crate::cursor::check_variant(&position, merge.variant)?;
                    // @ref LLP 3000.036.001#5 — a token minted by another plan of this read (one index, or another branch set) restarts it.
                    if position.check_descriptor(&first.table, &descriptor, order, &suffix).is_err() {
                        if position.table == first.table {
                            return Err(RuntimeError::Structural { code: "E_CURSOR_INDEX", message: "cursor belongs to another plan of this read; it now merges its branches: restart this read with a null cursor".into() });
                        }
                        return Err(RuntimeError::Input(format!("cursor: {}", crate::cursor::CursorError::Descriptor)));
                    }
                    if !position.scope.as_ref().is_some_and(|s| s.generation == self.context.generation && s.prefix == scope) {
                        return Err(RuntimeError::Input(format!("cursor: {}", crate::cursor::CursorError::Scope)));
                    }
                    self.record_shape_cursor(site, Some(token));
                    after = Some((position.values, position.inclusive));
                }
                _ => return Err(RuntimeError::Input("an opaque cursor is a string or null".into())),
            }
        }
        let depth = self.page_depth;
        self.page_depth += 1;
        let result = self.merge_branch_lanes(merge, prefixes, take, after);
        self.page_depth = depth;
        let (page, has_more, next) = result?;
        self.note_value_source_page(has_more);
        if depth == 0 && first.opaque_cursor {
            let next = next.filter(|_| self.word_cut_at.is_none());
            self.record_page(site.to_owned(), PagePosition { variant: merge.variant, view_suffix: Some(suffix), table: first.table.clone(), index: descriptor, order,
                prefix_len: 0, prefix: Some(scope), merge: true, interrupted: false, inclusive: false, shape_positions: Vec::new(),
                shape_resume: super::super::shaping::Resume::Never, next }, page.iter())?;
        }
        Ok(page)
    }

    /// The page and its continuation candidate (`None` when it ends).
    fn merge_branch_lanes(&mut self, merge: &Merge, prefixes: Vec<Vec<Value>>, take: usize, after: Option<(Vec<Value>, bool)>) -> Result<(Vec<Value>, bool, Option<Vec<Value>>), RuntimeError> {
        let order = merge.lanes[0].scan.order;
        let site = merge.site.as_str();
        // System/grant lanes can cover every other lane. Membership discovery
        // finishes before any target row may be emitted.
        let mut lanes: Vec<Lane> = Vec::with_capacity(merge.lanes.len());
        let mut covered = false;
        let numbered: Vec<(&MergeLane, Vec<Value>)> = merge.lanes.iter().zip(prefixes).collect();
        for (lane, prefix) in numbered.iter().filter(|(lane, _)| lane.system())
            .chain(numbered.iter().filter(|(lane, _)| lane.grant()))
            .chain(numbered.iter().filter(|(lane, _)| !lane.system() && !lane.grant())) {
            if covered { break; }
            if lane.system() {
                if !self.context.is_system() { continue; }
                lanes.push(self.open_branch_lane(lane, prefix.clone(), after.as_ref(), None)?); covered = true; continue;
            }
            if lane.membership() {
                let values: Vec<Value> = self.lane_values(lane)?.collect();
                if self.value_source_incomplete || self.read_capped() { return Ok((Vec::new(), false, None)); }
                let prior = self.env.get(&lane.binding).cloned();
                let prefixes = (|| -> Result<Vec<Vec<Value>>, RuntimeError> {
                    let mut prefixes = Vec::with_capacity(values.len());
                    for value in values {
                        self.env.insert(lane.binding.clone(), value);
                        let prefix = self.prefix_values(&lane.scan)?;
                        self.meter.at(site);
                        if !self.read_charge(MeterKind::Steps, 1)? { break; }
                        self.meter.heap(std::mem::size_of::<Lane>() as u64 + DisclosedKeys(&prefix).heap())?;
                        prefixes.push(prefix);
                    }
                    Ok(prefixes)
                })();
                if let Some(prior) = prior { self.env.insert(lane.binding.clone(), prior); } else { self.env.remove(&lane.binding); }
                let prefixes = prefixes?;
                if self.read_capped() { return Ok((Vec::new(), false, None)); }
                for prefix in prefixes { lanes.push(self.open_branch_lane(lane, prefix, after.as_ref(), Some(Default::default()))?); }
                continue;
            }
            let definition = &self.schema.tables[&lane.scan.table];
            let index = &definition.indexes[&lane.scan.index];
            let mut grant = None;
            if lane.grant() {
                if !self.context.is_system() {
                    let Some(rule) = rules::covering_grant(self.schema, &lane.scan) else { continue };
                    // @ref LLP 3000.036.001#7 — a device decides a seat (`viewer = 'service:x'`), which reads no row;
                    // a probe guard (a role, a pinned parent) it does not decide (LLP 3000.036 §12.1): the read is unknown and the client asks the server.
                    if self.device && rules::rule_probes(&rule) > 0 {
                        self.unknown_fact(&lane.scan.table, &lane.scan.index, prefix, site);
                        continue;
                    }
                    let (allowed, pending) = self.grant_verdict(definition, index, prefix, &rule)?;
                    if !allowed { continue; }
                    grant = Some(pending);
                }
                covered = true;
            }
            lanes.push(self.open_branch_lane(lane, prefix.clone(), after.as_ref(), grant)?);
        }
        // A page per lane: k small reads instead of a seek per returned row.
        let batch = take + 1;
        let mut heap = BinaryHeap::new();
        for position in 0..lanes.len() {
            // A lane the meter never reached has examined nothing.
            if self.read_capped() { break; }
            self.fill_branch(&mut lanes[position], batch)?;
            let lane = &mut lanes[position];
            if let Some(row) = lane.buffer.pop_front() {
                self.meter.step(1)?;
                let key = self.branch_position(lane, &row);
                heap.push(MergeHead { key, row, lane: position, order });
            }
        }
        let mut seen = BTreeSet::<String>::new();
        let mut page = Vec::new();
        let mut last = None;
        while let Some(head) = heap.peek() {
            // @ref LLP 3000.036.001#6 — after a cut, emit only what every lane has examined:
            // the page is a true prefix of the merged order and continues from the frontier.
            if self.read_capped() && !Self::within(&head.key, Self::frontier(&lanes, order).as_ref(), order) { break; }
            let head = heap.pop().expect("peeked head");
            self.meter.step(1)?;
            let id = head.row.field("id")?.as_str()?;
            if !seen.contains(id) {
                seen.insert(id.to_owned());
                if page.len() == take { return Ok((page, true, last)); }
                last = Some(head.key.clone());
                page.push(head.row);
            }
            let lane = &mut lanes[head.lane];
            lane.bounds.at_or_after = None;
            lane.bounds.after = Some(head.key);
            if lane.buffer.is_empty() && !lane.done && !self.read_capped() { self.fill_branch(lane, batch)?; }
            let lane = &mut lanes[head.lane];
            if let Some(row) = lane.buffer.pop_front() {
                let key = self.branch_position(lane, &row);
                heap.push(MergeHead { key, row, lane: head.lane, order });
            }
        }
        if !self.read_capped() { return Ok((page, false, None)); }
        // Cut: every row up to the frontier is on the page, so the page
        // continues from there; with a lane that examined nothing, it ends.
        Ok((page, false, Self::frontier(&lanes, order)))
    }

    fn open_branch_lane(&mut self, lane: &MergeLane, prefix: Vec<Value>, after: Option<&(Vec<Value>, bool)>, grant: Option<super::super::expiry::Pending>) -> Result<Lane, RuntimeError> {
        let mut scan = lane.scan.clone(); scan.after = None;
        let definition = &self.schema.tables[&scan.table]; let index = &definition.indexes[&scan.index];
        let mut bounds = self.bounds(&scan, definition, index, None)?;
        match after { Some((values, true)) => bounds.at_or_after = Some(values.clone()), Some((values, false)) => bounds.after = Some(values.clone()), None => {} }
        let position_len = Self::merge_suffix(definition, index, scan.prefix.len()).len();
        Ok(Lane { scan, prefix, bounds, buffer: VecDeque::new(), done: false, grant, position_len, through: None })
    }

    /// Read a lane's next batch strictly after its position, recording how
    /// far it examined.
    fn fill_branch(&mut self, lane: &mut Lane, batch: usize) -> Result<(), RuntimeError> {
        // Arm the capture with the lane's own table and index: `scan_consumed`
        // then records the last rule-visible candidate this read examined,
        // filter rejects included (never a nested read's key).
        let prior = self.scan_frontier.replace((lane.scan.table.clone(), lane.scan.index.clone(), None));
        let rows = self.read_branch(lane, batch);
        let examined = std::mem::replace(&mut self.scan_frontier, prior).and_then(|(_, _, key)| key);
        let rows = rows?;
        let capped = self.read_capped();
        lane.done = rows.len() < batch && !capped;
        let read_to = if capped {
            examined.and_then(|key| crate::key::decode(&key)).map(|values| values.into_iter().skip(lane.prefix.len()).take(lane.position_len).collect::<Vec<_>>())
                .filter(|values| values.len() == lane.position_len)
                .or_else(|| rows.last().map(|row| self.branch_position(lane, row)))
        } else { rows.last().map(|row| self.branch_position(lane, row)) };
        if read_to.is_some() { lane.through = read_to; }
        lane.buffer = rows.into();
        Ok(())
    }

    /// The position every unfinished lane has examined through: the least in
    /// the page's order, or `None` when some lane examined nothing past the
    /// cursor. A finished lane bounds nothing.
    fn frontier(lanes: &[Lane], order: Order) -> Option<Vec<Value>> {
        let mut least: Option<&Vec<Value>> = None;
        for lane in lanes.iter().filter(|lane| !lane.done) {
            let through = lane.through.as_ref()?;
            if least.is_none_or(|least| Self::compare(through, least, order) == Ordering::Less) { least = Some(through); }
        }
        least.cloned()
    }

    fn compare(a: &[Value], b: &[Value], order: Order) -> Ordering {
        let ordering = a.iter().zip(b).find_map(|(x, y)| match x.total_cmp(y) { Ordering::Equal => None, other => Some(other) }).unwrap_or(a.len().cmp(&b.len()));
        if order == Order::Asc { ordering } else { ordering.reverse() }
    }

    /// `key` is at or before `through` in the page's order.
    fn within(key: &[Value], through: Option<&Vec<Value>>, order: Order) -> bool {
        through.is_some_and(|through| Self::compare(key, through, order) != Ordering::Greater)
    }

    /// One read of a lane strictly after its current position. A lane its
    /// grant admitted reads as a decided page (`scan_consumed`'s grant arm).
    fn read_branch(&mut self, lane: &Lane, batch: usize) -> Result<Vec<Value>, RuntimeError> {
        self.merge_grant = lane.grant;
        let result = self.scan_prepared(&lane.scan, lane.prefix.clone(), lane.bounds.clone(), batch, None);
        self.merge_grant = None;
        Ok(result?.0)
    }

    /// The lane's merge position for a row: its index components after the
    /// lane's prefix, then `id` (the binder checks every lane has the same
    /// position columns).
    fn branch_position(&self, lane: &Lane, row: &Value) -> Vec<Value> {
        let index = &self.schema.tables[&lane.scan.table].indexes[&lane.scan.index];
        let mut key = Vec::with_capacity(lane.position_len);
        key.extend(index.components.iter().skip(lane.prefix.len()).filter_map(|component| component.value(row)));
        if key.len() < lane.position_len { key.push(row.field("id").cloned().unwrap_or(Value::Null)); }
        key
    }
}

/// A branch token's scope: a digest of every lane's evaluated pins, in lane
/// order. The lanes' prefixes together can exceed the token's 4096 bytes where
/// each alone fits (GPT round 4, finding 3); the digest binds them all in 64.
// @ref LLP 3000.036.001#5 — the scope binds every lane's pins, at a bounded size
pub(super) fn branch_scope(prefixes: &[Vec<Value>]) -> Result<Vec<Value>, RuntimeError> {
    use sha2::{Digest, Sha256};
    let bytes = crate::json_codec::to_vec(&prefixes).map_err(|error| RuntimeError::Schema(format!("branch scope: {error}")))?;
    Ok(vec![Value::String(format!("{:x}", Sha256::digest(bytes)))])
}
