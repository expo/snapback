//! Projected merges preserve source authorization and distinguish branches even
//! when different tables (or two branches of one table) carry the same row id.
use super::*;

impl Runner<'_> {
    // @ref LLP 3000.013#3.1 — one interpreter; source rules precede every projection.
    pub(super) fn merge_view(&mut self, merge: &Merge) -> Result<Vec<Value>, RuntimeError> {
        let descriptor = merge.position.as_ref().ok_or_else(|| RuntimeError::Schema("view needs a position descriptor".into()))?;
        let suffix = descriptor.suffix.clone();
        let names: Vec<_> = suffix.iter().filter(|column| column.name != "$branch").map(|column| column.name.clone()).collect();
        let view = format!("$view:{}", merge.view.as_deref().ok_or_else(|| RuntimeError::Schema("view merge needs a view identity".into()))?);
        let view_index = "position";
        let take = descriptor.take as usize;
        let order = descriptor.order;
        let position = if let Some(after) = &descriptor.after {
            match self.expr(after)? {
                Value::Null => None,
                Value::String(token) => {
                    self.validate_word_cursor(&token, &view, view_index, order, &suffix)?;
                    self.meter.heap(word_heap::cursor_decode(&token))?;
                    self.record_shape_cursor(&merge.site, Some(token));
                    Some(self.word_cursor.as_ref().unwrap().1.clone())
                }
                _ => return Err(RuntimeError::Input("an opaque cursor is a string or null".into())),
            }
        } else { None };
        let outer_depth = self.page_depth;
        let mut candidates = Vec::new();
        let mut seen = BTreeSet::new();
        for lane in &merge.lanes {
            self.word_note_table(&lane.scan.table)?;
            self.word_dependencies(&self.schema.tables[&lane.scan.table].rules.read)?;
        }
        for lane in &merge.lanes {
            self.page_depth = outer_depth + 1;
            let sources = self.lane_values(lane)?;
            for source in sources {
                if !self.charge_lane(lane, &merge.site)? { break; }
                if lane.source.is_some() { self.env.insert(lane.binding.clone(), source); }
                self.statements(&lane.setup, &merge.site)?;
                let mut scan = lane.scan.clone();
                let branch = lane.branch.as_deref().ok_or_else(|| RuntimeError::Schema("projected merge lane needs a branch identity".into()))?;
                let table = &self.schema.tables[&scan.table];
                let index = &table.indexes[&scan.index];
                let local_suffix = Self::merge_suffix(table, index, scan.prefix.len());

                let local_position = if let Some(position) = &position {
                    let mut local = position.clone();
                    let previous_branch = local.values.pop().ok_or_else(|| RuntimeError::Input("cursor has no branch".into()))?;
                    let previous_branch = previous_branch.as_str()?;
                    // Equal source keys from a later branch remain after the
                    // shared cursor. Earlier branches seek strictly past them.
                    local.inclusive = match branch.cmp(previous_branch) {
                        Ordering::Equal => position.inclusive,
                        Ordering::Greater => order == Order::Asc,
                        Ordering::Less => order == Order::Desc,
                    };
                    local.values = local_suffix.iter().map(|column| {
                        let offset = names.iter().position(|name| projected_column(lane.project.as_ref().unwrap(), name) == Some(column.name.as_str()))
                            .ok_or_else(|| RuntimeError::Schema(format!("source order {} is absent from the view cursor", column.name)))?;
                        Ok(position.values[offset].clone())
                    }).collect::<Result<Vec<_>, RuntimeError>>()?;
                    local.table = scan.table.clone(); local.index = scan.index.clone(); local.suffix = local_suffix.clone();
                    Some((scan.site.clone(), local))
                } else { None };
                scan.after = None;
                scan.take = Bound::Literal((take as u32).saturating_add(1));
                // A null shared position can seek a required source column. It
                // is already validated against the view's unified descriptor;
                // it is not an independently supplied source-table cursor.
                let previous_seek = std::mem::replace(&mut self.view_seek, local_position);
                let scanned = self.scan_with_words(&scan, None);
                self.view_seek = previous_seek;
                let rows = scanned?.0;
                for row in rows {
                    let id = row.field("id")?.as_str()?;
                    self.meter.heap(branch.len() as u64 + id.len() as u64 + 64)?;
                    if !seen.insert((branch.to_owned(), id.to_owned())) { continue; }
                    let prior = self.env.insert("$project".into(), row);
                    let cut = self.read_cuts;
                    let projected = self.expr(lane.project.as_ref().ok_or_else(|| RuntimeError::Schema("view lane has no projection".into()))?);
                    if let Some(prior) = prior { self.env.insert("$project".into(), prior); } else { self.env.remove("$project"); }
                    let projected = projected?;
                    if self.read_cuts != cut { break; }
                    let mut key = names.iter().map(|name| projected.field(name).cloned()).collect::<Result<Vec<_>, _>>()?;
                    key.push(Value::String(branch.into()));
                    self.meter.heap(key.iter().map(Value::heap_bytes).sum::<u64>() + projected.heap_bytes() + 64)?;
                    candidates.push((key, projected));
                }
            }
        }
        self.page_depth = outer_depth;
        self.meter.step((candidates.len() as u64).saturating_mul(u64::from(candidates.len().max(1).ilog2()) + 1))?;
        candidates.sort_by(|(a, _), (b, _)| {
            let order_key = a.iter().zip(b).find_map(|(a, b)| (a.total_cmp(b) != Ordering::Equal).then(|| a.total_cmp(b))).unwrap_or(Ordering::Equal);
            if order == Order::Asc { order_key } else { order_key.reverse() }
        });
        let has_more = candidates.len() > take;
        self.note_value_source_page(has_more);
        candidates.truncate(take);
        if outer_depth == 0 {
            if descriptor.after.is_some() {
                let next = (has_more && !self.read_capped() && self.word_cut_at.is_none() && !self.beyond_horizon && !self.presence_unknown).then(|| candidates.last().unwrap().0.clone());
                self.meter.heap(candidates.iter().map(|(key, _)| key.iter().map(Value::heap_bytes).sum::<u64>() + 64).sum())?;
                let cursor_rows: Vec<Value> = candidates.iter().map(|(key, _)| Value::Row(suffix.iter().zip(key).map(|(column, value)| (column.name.clone(), value.clone())).collect::<std::collections::BTreeMap<_, _>>().into())).collect();
                self.record_page(merge.site.clone(), PagePosition { view_suffix: Some(suffix), table: view, index: view_index.into(), order,
                    prefix_len: 0, prefix: None, merge: true, interrupted: false, inclusive: false, next, shape_positions: Vec::new(), shape_resume: super::super::shaping::Resume::Never }, cursor_rows.iter())?;
            } else if has_more { self.page_overflow = true; self.components.note(|frame| frame.overflow = true); }
        }
        Ok(candidates.into_iter().map(|(_, row)| row).collect())
    }
}

fn projected_column<'a>(project: &'a Expr, name: &str) -> Option<&'a str> {
    match project {
        Expr::Block { value, .. } => projected_column(value, name),
        Expr::Object(fields) | Expr::Shape { fields, .. } => match fields.get(name)? {
            Expr::Field { base, name } if matches!(base.as_ref(), Expr::Variable(row) if row == "$project") => Some(name),
            _ => None,
        },
        _ => None,
    }
}
