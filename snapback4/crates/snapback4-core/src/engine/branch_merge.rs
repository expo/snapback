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
struct Lane<'a> {
    /// The compiled scan can contain arbitrarily large filter literals. It is
    /// shared by every discovered membership lane; only evaluated keys and
    /// bounds are retained per lane.
    scan: &'a Scan,
    prefix: Vec<Value>,
    bounds: Bounds,
    buffer: VecDeque<Value>,
    done: bool,
    grant: Option<super::super::expiry::Pending>,
    metered: bool,
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
        let metered_merge = merge.lanes.iter().any(MergeLane::membership);
        let table = self.schema.table(&first.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", first.table)))?;
        let index = table.index(&first.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", first.table, first.index)))?;
        let take = self.take(&first.take)?;
        let order = first.order;
        let suffix = if metered_merge { word_heap::suffix(&mut self.meter, table, index, first.prefix.len(), true)? }
            else { Self::merge_suffix(table, index, first.prefix.len()) };
        if metered_merge { self.meter.heap(word_heap::allocation(crate::ir::BRANCH_DESCRIPTOR.len() + 64))?; }
        let descriptor = merge.branch_descriptor();
        // Every lane's evaluated pins, in lane order: the token's scope, so a
        // cursor never resumes a page whose arguments or viewer changed
        // (Muse round 3, finding 1), as a direct page's scope does.
        if metered_merge { self.meter.heap(word_heap::slots::<Vec<Value>>(merge.lanes.len()))?; }
        let mut prefixes = Vec::with_capacity(merge.lanes.len());
        for lane in &merge.lanes {
            let scan = match lane.source.as_ref().and_then(LaneSource::scan) { Some(source) if lane.membership() => source, _ => &lane.scan };
            let prefix = self.branch_prefix_values(scan, metered_merge);
            let prefix = if metered_merge {
                let Some(prefix) = self.membership_discovery_steps(prefix)? else { return Ok(Vec::new()); };
                prefix
            } else { prefix? };
            prefixes.push(prefix);
        }
        if metered_merge { self.meter.heap(word_heap::slots::<Value>(1) + word_heap::allocation(64))?; }
        let scope = branch_scope(&prefixes)?;
        self.record_shape_cursor(site, None);
        let mut after = None;
        if first.opaque_cursor && let Some(expr) = first.after.as_deref() {
            match self.expr(expr)? {
                Value::Null => {}
                Value::String(token) => {
                    if metered_merge { self.meter.heap(word_heap::cursor_decode(&token) + word_heap::text(&token))?; }
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
                    if metered_merge { self.meter.heap(DisclosedKeys(&position.values).heap())?; }
                    let resume = (position.values, position.inclusive);
                    if metered_merge { self.word_shape_cursor(site, token)?; } else { self.record_shape_cursor(site, Some(token)); }
                    after = Some(resume);
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
            if metered_merge { self.charge_branch_page(first, site, &descriptor, &page, next.as_ref())?; }
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
        let metered_merge = merge.lanes.iter().any(MergeLane::membership);
        // System/grant lanes can cover every other lane. Membership discovery
        // finishes before any target row may be emitted.
        let mut lanes: Vec<Lane<'_>> = Vec::new();
        let mut covered = false;
        if metered_merge { self.meter.heap(word_heap::slots::<(&MergeLane, Vec<Value>)>(merge.lanes.len()))?; }
        let numbered: Vec<(&MergeLane, Vec<Value>)> = merge.lanes.iter().zip(prefixes).collect();
        for (lane, prefix) in numbered.iter().filter(|(lane, _)| lane.system())
            .chain(numbered.iter().filter(|(lane, _)| lane.grant()))
            .chain(numbered.iter().filter(|(lane, _)| !lane.system() && !lane.grant())) {
            if covered { break; }
            if lane.system() {
                if !self.context.is_system() { continue; }
                let prefix = self.clone_branch_prefix(prefix, metered_merge)?;
                let opened = self.open_branch_lane(lane, prefix, after.as_ref(), None, metered_merge)?;
                self.push_branch_lane(&mut lanes, opened, metered_merge, site)?; covered = true; continue;
            }
            if lane.membership() {
                let prior = self.env.get_mut(&lane.binding).map(|slot| std::mem::replace(slot, Value::Null));
                let prefixes = (|| -> Result<Vec<Vec<Value>>, RuntimeError> {
                    let mut prefixes = Vec::new();
                    for value in self.lane_values(lane)? {
                        if let Some(slot) = self.env.get_mut(&lane.binding) { *slot = value; }
                        else {
                            self.meter.heap(word_heap::text(&lane.binding) + word_heap::insertion::<String, Value>(self.env.len()))?;
                            self.env.insert(lane.binding.clone(), value);
                        }
                        self.meter.at(site);
                        if !self.read_charge(MeterKind::Steps, 1)? { break; }
                        // Reserve the evaluated prefix before its Vec and
                        // source-field copies are allocated. The full bound
                        // row is conservative for a prefix that projects it.
                        self.meter.heap(self.environment_value_copy_heap(&lane.binding))?;
                        let prefix = self.branch_prefix_values(&lane.scan, true)?;
                        word_heap::push(&mut self.meter, &mut prefixes, prefix)?;
                    }
                    Ok(prefixes)
                })();
                if let Some(prior) = prior { *self.env.get_mut(&lane.binding).expect("saved binding") = prior; } else { self.env.remove(&lane.binding); }
                let Some(prefixes) = self.membership_discovery_steps(prefixes)? else { return Ok((Vec::new(), false, None)); };
                if self.value_source_incomplete || self.read_capped() { return Ok((Vec::new(), false, None)); }
                for prefix in prefixes {
                    let opened = self.open_branch_lane(lane, prefix, after.as_ref(), Some(Default::default()), true)?;
                    self.push_branch_lane(&mut lanes, opened, true, site)?;
                }
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
            let prefix = self.clone_branch_prefix(prefix, metered_merge)?;
            let opened = self.open_branch_lane(lane, prefix, after.as_ref(), grant, metered_merge)?;
            self.push_branch_lane(&mut lanes, opened, metered_merge, site)?;
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
                self.charge_branch_position(lane, &row)?;
                let key = self.branch_position(lane, &row);
                Self::push_branch_head(&mut self.meter, &mut heap, MergeHead { key, row, lane: position, order }, metered_merge)?;
            }
        }
        let mut seen = BTreeSet::<String>::new();
        let mut page = Vec::new();
        let mut last = None;
        let mut cut_frontier: Option<Option<usize>> = None;
        while let Some(head) = heap.peek() {
            // @ref LLP 3000.036.001#6 — after a cut, emit only what every lane has examined:
            // the page is a true prefix of the merged order and continues from the frontier.
            if self.read_capped() {
                let frontier = *cut_frontier.get_or_insert_with(|| Self::frontier_index(&lanes, order));
                if !Self::within(&head.key, frontier.and_then(|n| lanes[n].through.as_ref()), order) { break; }
            }
            let head = heap.pop().expect("peeked head");
            self.meter.step(1)?;
            let id = head.row.field("id")?.as_str()?;
            if !seen.contains(id) {
                if metered_merge { self.meter.heap(word_heap::text(id) + word_heap::insertion::<String, ()>(seen.len()))?; }
                seen.insert(id.to_owned());
                if page.len() == take { return Ok((page, true, last)); }
                if metered_merge { self.meter.heap(DisclosedKeys(&head.key).heap())?; }
                last = Some(head.key.clone());
                if metered_merge { word_heap::push(&mut self.meter, &mut page, head.row)?; } else { page.push(head.row); }
            }
            let lane = &mut lanes[head.lane];
            lane.bounds.at_or_after = None;
            lane.bounds.after = Some(head.key);
            if lane.buffer.is_empty() && !lane.done && !self.read_capped() { self.fill_branch(lane, batch)?; }
            let lane = &mut lanes[head.lane];
            if let Some(row) = lane.buffer.pop_front() {
                self.charge_branch_position(lane, &row)?;
                let key = self.branch_position(lane, &row);
                Self::push_branch_head(&mut self.meter, &mut heap, MergeHead { key, row, lane: head.lane, order }, metered_merge)?;
            }
        }
        if !self.read_capped() { return Ok((page, false, None)); }
        // Cut: every row up to the frontier is on the page, so the page
        // continues from there; with a lane that examined nothing, it ends.
        let frontier = cut_frontier.unwrap_or_else(|| Self::frontier_index(&lanes, order));
        Ok((page, false, frontier.and_then(|n| lanes[n].through.take())))
    }

    fn open_branch_lane<'a>(&mut self, lane: &'a MergeLane, prefix: Vec<Value>, after: Option<&(Vec<Value>, bool)>, grant: Option<super::super::expiry::Pending>, metered: bool) -> Result<Lane<'a>, RuntimeError> {
        let scan = &lane.scan;
        let definition = &self.schema.tables[&scan.table]; let index = &definition.indexes[&scan.index];
        // A branch cursor was validated once above. Do not clone the compiled
        // Scan merely to clear it; evaluate only the remaining bounds here.
        let mut bounds = self.word_bounds(scan, definition, index, None, metered, true)?;
        if metered && let Some((values, _)) = after { self.meter.heap(DisclosedKeys(values).heap())?; }
        let point_id = rules::membership_point_id(self.schema, lane);
        let mut done = false;
        if point_id {
            // The point's pinned id is also its logical page position. Decide
            // the shared cursor here instead of applying it after the fully
            // consumed physical prefix.
            if let Some((values, inclusive)) = after {
                let position = &prefix[prefix.len() - 1..];
                let comparison = Self::compare(position, values, scan.order);
                done = comparison == Ordering::Less || comparison == Ordering::Equal && !inclusive;
            }
        } else {
            match after { Some((values, true)) => bounds.at_or_after = Some(values.clone()), Some((values, false)) => bounds.after = Some(values.clone()), None => {} }
        }
        let suffix = index.components.iter().skip(scan.prefix.len()).filter_map(|component| component.key_name());
        let (position_len, ends_in_id) = suffix.fold((0usize, false), |(len, _), name| (len + 1, name == "id"));
        let position_len = position_len + usize::from(!ends_in_id || point_id);
        Ok(Lane { scan, prefix, bounds, buffer: VecDeque::new(), done, grant, metered, position_len, through: None })
    }

    /// Read a lane's next batch strictly after its position, recording how
    /// far it examined.
    fn fill_branch(&mut self, lane: &mut Lane<'_>, batch: usize) -> Result<(), RuntimeError> {
        if lane.done { return Ok(()); }
        // Arm the capture with the lane's own table and index: `scan_consumed`
        // then records the last rule-visible candidate this read examined,
        // filter rejects included (never a nested read's key).
        if lane.metered { self.meter.heap(word_heap::text(&lane.scan.table) + word_heap::text(&lane.scan.index))?; }
        let prior = self.scan_frontier.replace((lane.scan.table.clone(), lane.scan.index.clone(), None));
        let rows = self.read_branch(lane, batch);
        let examined = std::mem::replace(&mut self.scan_frontier, prior).and_then(|(_, _, key)| key);
        let rows = rows?;
        let capped = self.read_capped();
        lane.done = rows.len() < batch && !capped;
        let mut read_to = None;
        if capped && let Some(key) = examined {
            if lane.metered { self.meter.heap(word_heap::key_decode(lane.prefix.len() + lane.position_len, key.len()))?; }
            if let Some(mut values) = crate::key::decode(&key) {
                if lane.prefix.len() <= values.len() { values.drain(..lane.prefix.len()); }
                values.truncate(lane.position_len);
                if values.len() == lane.position_len { read_to = Some(values); }
            }
        }
        if read_to.is_none() && let Some(row) = rows.last() {
            self.charge_branch_position(lane, row)?;
            read_to = Some(self.branch_position(lane, row));
        }
        if read_to.is_some() { lane.through = read_to; }
        lane.buffer = rows.into();
        Ok(())
    }

    /// The position every unfinished lane has examined through: the least in
    /// the page's order, or `None` when some lane examined nothing past the
    /// cursor. A finished lane bounds nothing.
    fn frontier_index(lanes: &[Lane<'_>], order: Order) -> Option<usize> {
        let mut least: Option<usize> = None;
        for (position, lane) in lanes.iter().enumerate().filter(|(_, lane)| !lane.done) {
            let through = lane.through.as_ref()?;
            if least.is_none_or(|n| Self::compare(through, lanes[n].through.as_ref().expect("frontier"), order) == Ordering::Less) { least = Some(position); }
        }
        least
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
    fn read_branch(&mut self, lane: &Lane<'_>, batch: usize) -> Result<Vec<Value>, RuntimeError> {
        self.merge_grant = lane.grant;
        if lane.metered { self.meter.heap(DisclosedKeys(&lane.prefix).heap() + DisclosedBounds(&lane.bounds).heap())?; }
        let result = self.scan_consumed(&lane.scan, lane.prefix.clone(), lane.bounds.clone(), batch, None, None, false, lane.metered);
        self.merge_grant = None;
        Ok(result?.0)
    }

    fn branch_prefix_values(&mut self, scan: &Scan, metered: bool) -> Result<Vec<Value>, RuntimeError> {
        if metered { self.meter.heap(word_heap::slots::<Value>(scan.prefix.len()))?; }
        let mut values = Vec::with_capacity(scan.prefix.len());
        for key in &scan.prefix {
            values.push(match key {
                IndexKeyExpr::Scalar(expr) => self.expr(expr)?,
                IndexKeyExpr::WordPrefix(_) => return Err(RuntimeError::Schema("a branch prefix is never a words prefix".into())),
            });
        }
        Ok(values)
    }

    fn clone_branch_prefix(&mut self, prefix: &[Value], metered: bool) -> Result<Vec<Value>, RuntimeError> {
        if metered { self.meter.heap(DisclosedKeys(prefix).heap())?; }
        Ok(prefix.to_vec())
    }

    fn push_branch_lane<'a>(&mut self, lanes: &mut Vec<Lane<'a>>, lane: Lane<'a>, metered: bool, site: &str) -> Result<(), RuntimeError> {
        if metered {
            self.meter.at(site);
            if !self.read_charge(MeterKind::Steps, 1)? { return Ok(()); }
            word_heap::push(&mut self.meter, lanes, lane)
        } else { lanes.push(lane); Ok(()) }
    }

    fn push_branch_head(meter: &mut crate::meter::Meter, heap: &mut BinaryHeap<MergeHead>, head: MergeHead, metered: bool) -> Result<(), RuntimeError> {
        if metered {
            let additional = word_heap::grow::<MergeHead>(meter, heap.len(), heap.capacity())?;
            if additional != 0 { heap.reserve_exact(additional); }
        }
        heap.push(head);
        Ok(())
    }

    fn charge_branch_position(&mut self, lane: &Lane<'_>, row: &Value) -> Result<(), RuntimeError> {
        if !lane.metered { return Ok(()); }
        let index = &self.schema.tables[&lane.scan.table].indexes[&lane.scan.index];
        let copied = index.components.iter().skip(lane.prefix.len()).filter_map(|part| part.column())
            .filter_map(|name| row.field(name).ok()).map(|value| DisclosedKey(value).copy_heap()).sum::<u64>();
        let appended = if index.components.len() - lane.prefix.len() < lane.position_len {
            row.field("id").map_or(0, |value| DisclosedKey(value).copy_heap())
        } else { 0 };
        self.meter.heap(word_heap::slots::<Value>(lane.position_len) + copied + appended)
    }

    fn charge_branch_page(&mut self, first: &Scan, site: &str, descriptor: &str, page: &[Value], next: Option<&Vec<Value>>) -> Result<(), RuntimeError> {
        let table = &self.schema.tables[&first.table];
        let index = &table.indexes[&first.index];
        let position_len = index.components.len() - first.prefix.len()
            + usize::from(index.components.last().and_then(|part| part.column()).map(String::as_str) != Some("id"));
        let shaped = self.page_plan.shapes.values().any(|shape| shape.page == site);
        let mut max_key = 0;
        let mut shape_bytes = if shaped { word_heap::vec_growth::<Vec<Value>>(page.len()) } else { 0 };
        for row in page {
            let copied = index.components.iter().skip(first.prefix.len()).filter_map(|part| part.column())
                .filter_map(|name| row.field(name).ok()).map(|value| DisclosedKey(value).copy_heap()).sum::<u64>();
            let appended = if index.components.len() - first.prefix.len() < position_len {
                row.field("id").map_or(0, |value| DisclosedKey(value).copy_heap())
            } else { 0 };
            let bytes = word_heap::slots::<Value>(position_len) + copied + appended;
            max_key = max_key.max(bytes);
            if shaped { shape_bytes += word_heap::vec_growth::<Value>(position_len) + copied + appended; }
        }
        // A meter frontier can continue an empty page, and may be wider than
        // every emitted key. Cursor encoding must reserve that actual key.
        if let Some(key) = next { max_key = max_key.max(DisclosedKeys(key).heap()); }
        let trims = self.page_plan.shapes.iter().filter(|(_, shape)| shape.page == site).enumerate().map(|(n, (name, _))| {
            word_heap::text(name) + max_key
                + word_heap::insertion::<String, super::super::shaping::ShapePosition>(self.shape_positions.len() + n)
        }).sum::<u64>();
        self.meter.heap(shape_bytes + trims + word_heap::insertion::<String, PagePosition>(self.pages.len())
            + 3 * (word_heap::text(site) + word_heap::text(&first.table) + word_heap::text(descriptor))
            + next.map_or(0, |key| 2 * DisclosedKeys(key).heap())
            + word_heap::cursor_build(table, index, first.prefix.len(), if next.is_some() || shaped { max_key } else { 0 },
                word_heap::text(&first.table) + word_heap::text(descriptor)))
    }

    /// The lane's merge position for a row: its index components after the
    /// lane's prefix, then `id` (the binder checks every lane has the same
    /// position columns).
    fn branch_position(&self, lane: &Lane<'_>, row: &Value) -> Vec<Value> {
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
    struct HashWriter<'a>(&'a mut Sha256);
    impl std::io::Write for HashWriter<'_> {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> { self.0.update(bytes); Ok(bytes.len()) }
        fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
    }
    let mut hash = Sha256::new();
    crate::json_codec::to_sink(&mut HashWriter(&mut hash), prefixes).map_err(|error| RuntimeError::Schema(format!("branch scope: {error}")))?;
    Ok(vec![Value::String(format!("{:x}", hash.finalize()))])
}
