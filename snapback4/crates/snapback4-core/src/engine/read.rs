//! Reads: point lookups, bounded scans with the read rule hoisted where the
//! prefix decides it, opaque cursors, and merges of ordered lanes. Every
//! candidate row is charged to the meter; a query cut by the meter returns
//! what it found and is `capped` (LLP 2000.000 §6).

use super::rules::{self, Probe};
use super::runner::{PagePosition, Runner};
use crate::cursor::{CursorColumn, CursorPosition, decode_cursor_for, encode_cursor};
use crate::error::{MeterKind, RuntimeError};
use crate::ir::*;
use crate::schema::{Effect, Index, Table, materialize_optional_fields};
use crate::store::{Bounds, Dir};
use crate::value::{Value, canonical_json};
use std::cmp::Ordering;
use std::collections::BTreeSet;

impl Probe for Runner<'_> {
    fn exists(&mut self, table: &str, index: &str, key: &[Value]) -> Result<bool, RuntimeError> {
        if !self.meter.charge(MeterKind::RuleProbes, 1)? {
            // Cut: no lookup and no verdict; the site stops on `capped_at`.
            return Ok(false);
        }
        let definition = self.schema.table(table).ok_or_else(|| RuntimeError::Schema(format!("missing table {table}")))?;
        let index_def = definition.index(index).ok_or_else(|| RuntimeError::Schema(format!("missing index {table}.{index}")))?;
        self.read_tables.insert(table.to_owned());
        Ok(self.tx.lookup(table, index, index_def, key)?.is_some())
    }

    fn created(&mut self, table: &str, index: &str, key: &[Value]) -> bool {
        self.created.contains(&(table.to_owned(), index.to_owned(), canonical_json(&key)))
    }
}

impl Runner<'_> {
    /// Whether the viewer may `effect` the row. The system principal is the
    /// store's owner and passes every rule; validation and constraints
    /// still run for it.
    pub(super) fn check_rule(&mut self, table_name: &str, effect: Effect, old: Option<&Value>, next: &Value) -> Result<bool, RuntimeError> {
        if self.context.is_system() {
            return Ok(true);
        }
        let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
        let rule = table.rules.for_effect(effect).clone();
        let mut next = next.clone();
        materialize_optional_fields(&mut next, table);
        let old = old.map(|old| {
            let mut old = old.clone();
            materialize_optional_fields(&mut old, table);
            old
        });
        let viewer = self.context.viewer.clone();
        rules::evaluate(&rule, &viewer, old.as_ref(), &next, effect == Effect::Insert, self)
    }

    /// A row by id, materialized, without a rule check.
    pub(super) fn fetch(&mut self, table_name: &str, id: &str) -> Result<Option<Value>, RuntimeError> {
        let table = self.schema.table(table_name).ok_or_else(|| RuntimeError::Schema(format!("missing table {table_name}")))?;
        Ok(self.tx.get(table_name, id)?.map(|mut row| {
            materialize_optional_fields(&mut row, table);
            row
        }))
    }

    /// A point read: the row when it exists and the viewer may read it, else
    /// `null`. Hidden and absent are the same word on purpose.
    pub(super) fn get(&mut self, read: &Read) -> Result<Value, RuntimeError> {
        let key = read.key.iter().map(|value| self.expr(value)).collect::<Result<Vec<_>, _>>()?;
        let table = self.schema.table(&read.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", read.table)))?;
        let index = table.index(&read.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", read.table, read.index)))?;
        self.read_tables.insert(read.table.clone());
        self.meter.at(&read.site);
        if key.iter().any(|value| *value == Value::Null) && !index.columns().iter().zip(&key).all(|(column, value)| *value != Value::Null || table.columns.get(column).is_some_and(|kind| kind.is_optional())) {
            // A null key on a required column addresses nothing.
            return Ok(Value::Null);
        }
        // Absent, hidden or visible: one examined row, so the meter says the
        // same of a miss and of a row the viewer may not read; the probes
        // that decided a hidden row are rolled back.
        let mark = self.meter.mark();
        let found = self.tx.lookup(&read.table, &read.index, index, &key)?;
        if !self.meter.charge(MeterKind::Examined, 1)? {
            return Ok(Value::Null);
        }
        let Some(mut row) = found else { return Ok(Value::Null) };
        materialize_optional_fields(&mut row, table);
        if self.check_rule(&read.table, Effect::Read, None, &row)? {
            Ok(row)
        } else {
            self.meter.restore(mark);
            self.meter.charge(MeterKind::Examined, 1)?;
            Ok(Value::Null)
        }
    }

    /// The scan's prefix values, evaluated.
    fn prefix_values(&mut self, scan: &Scan) -> Result<Vec<Value>, RuntimeError> {
        scan.prefix
            .iter()
            .map(|key| match key {
                IndexKeyExpr::Scalar(expr) => self.expr(expr),
                IndexKeyExpr::WordPrefix(_) => Err(RuntimeError::Schema("word-prefix scans are not in this slice".into())),
            })
            .collect()
    }

    fn take(&self, bound: &Bound) -> Result<usize, RuntimeError> {
        Ok(match bound {
            Bound::Literal(value) => *value as usize,
            Bound::Arg { name, max } => {
                let value = self.context.args.get(name).ok_or_else(|| RuntimeError::Input(format!("missing take arg {name}")))?.as_int()?;
                if value < 0 || value > *max as i64 {
                    return Err(RuntimeError::Fanout);
                }
                value as usize
            }
        })
    }

    fn cursor_suffix(table: &Table, index: &Index, prefix_len: usize) -> Vec<CursorColumn> {
        index.columns().iter().skip(prefix_len).map(|name| CursorColumn { name: name.clone(), kind: table.columns[name].clone() }).collect()
    }

    /// The bounds of a scan: the cursor position and any value range.
    fn bounds(&mut self, scan: &Scan, table: &Table, index: &Index) -> Result<Bounds, RuntimeError> {
        let mut bounds = Bounds::default();
        let after = scan.after.as_deref().map(|value| self.expr(value)).transpose()?;
        let before = scan.before.as_deref().map(|value| self.expr(value)).transpose()?;
        match before {
            None | Some(Value::Null) => {}
            Some(Value::Array(values)) => bounds.before = Some(values),
            Some(value) => bounds.before = Some(vec![value]),
        }
        match after {
            None | Some(Value::Null) => {}
            Some(Value::String(token)) if scan.opaque_cursor => {
                let suffix = Self::cursor_suffix(table, index, scan.prefix.len());
                let values = decode_cursor_for(self.schema, &token, &scan.table, &scan.index, scan.order, &suffix).map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?;
                bounds.after = Some(values);
            }
            Some(Value::Array(values)) if !scan.opaque_cursor => bounds.after = Some(values),
            Some(value) if !scan.opaque_cursor => bounds.after = Some(vec![value]),
            Some(_) => return Err(RuntimeError::Input("an opaque cursor is a string or null".into())),
        }
        if let Some(range) = &scan.range {
            bounds.gt = range.gt.as_deref().map(|v| self.expr(v)).transpose()?;
            bounds.gte = range.gte.as_deref().map(|v| self.expr(v)).transpose()?;
            bounds.lt = range.lt.as_deref().map(|v| self.expr(v)).transpose()?;
            bounds.lte = range.lte.as_deref().map(|v| self.expr(v)).transpose()?;
        }
        Ok(bounds)
    }

    /// A bounded page. Returns the visible rows, at most `take`, and records
    /// the page position for `next` when this scan is the program's page.
    pub(super) fn scan(&mut self, scan: &Scan) -> Result<Vec<Value>, RuntimeError> {
        let (rows, _) = self.scan_with_keys(scan)?;
        Ok(rows)
    }

    pub(super) fn scan_with_keys(&mut self, scan: &Scan) -> Result<(Vec<Value>, Vec<Vec<u8>>), RuntimeError> {
        let prefix = self.prefix_values(scan)?;
        let table = self.schema.table(&scan.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", scan.table)))?;
        let index = table.index(&scan.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", scan.table, scan.index)))?;
        let bounds = self.bounds(scan, table, index)?;
        let take = self.take(&scan.take)?;
        self.read_tables.insert(scan.table.clone());
        self.meter.at(&scan.site);
        let dir = match scan.order {
            Order::Asc => Dir::Asc,
            Order::Desc => Dir::Desc,
        };
        let visibility = rules::scan_visibility(self.schema, scan);
        let always_visible = self.context.is_system() || visibility.decided_true || table.rules.read.is_uniformly_readable();
        if !visibility.uniform && !always_visible {
            self.non_uniform = true;
        }
        let mut visible: Vec<Value> = Vec::new();
        let mut keys: Vec<Vec<u8>> = Vec::new();
        let mut has_more = false;
        let mut capped = false;
        let mut uniform_verdict: Option<bool> = always_visible.then_some(true);
        // Fetch in batches so a hidden run costs examined rows, never a
        // materialized table. A uniform rule needs one verdict, so one
        // batch of take + 1 decides the page.
        let mut cursor = bounds.clone();
        let batch = if visibility.uniform { take + 1 } else { (take + 1).max(32) };
        let mark = self.meter.mark();
        'outer: loop {
            let fetched = self.tx.scan(&scan.table, &scan.index, &prefix, &cursor, dir, batch)?;
            if fetched.is_empty() {
                break;
            }
            let fetched_len = fetched.len();
            for (mut row, key) in fetched {
                if !self.meter.charge(MeterKind::Examined, 1)? {
                    capped = true;
                    break 'outer;
                }
                materialize_optional_fields(&mut row, table);
                let allowed = match uniform_verdict {
                    Some(verdict) => verdict,
                    None => {
                        let verdict = self.check_rule(&scan.table, Effect::Read, None, &row)?;
                        if visibility.uniform {
                            uniform_verdict = Some(verdict);
                        }
                        verdict
                    }
                };
                if self.meter.capped_at.is_some() {
                    capped = true;
                    break 'outer;
                }
                if allowed {
                    if visible.len() == take {
                        has_more = true;
                        break 'outer;
                    }
                    visible.push(row);
                    keys.push(key.clone());
                } else if visibility.uniform {
                    // One hidden row hides the prefix: stop without reading
                    // it, and at the cost of an empty range.
                    self.meter.restore(mark);
                    break 'outer;
                }
                cursor.after = Some(crate::key::decode(&key).unwrap_or_default().into_iter().take(index.components.len()).skip(prefix.len()).collect());
            }
            if fetched_len < batch {
                break;
            }
        }
        if self.page_depth == 0 && scan.opaque_cursor {
            let components = index.components.len();
            // A capped page continues from its last visible row whether or not
            // the range went on, and an empty capped page is the end: the
            // presence of `next` then says nothing about hidden rows.
            let continues = if capped || self.non_uniform { !visible.is_empty() } else { has_more };
            let next = if continues { keys.last().and_then(|key| crate::key::decode(key)).map(|values| values.into_iter().take(components).skip(prefix.len()).collect()) } else { None };
            self.page = Some(PagePosition { table: scan.table.clone(), index: scan.index.clone(), order: scan.order, prefix_len: prefix.len(), next });
        }
        Ok((visible, keys))
    }

    /// The opaque `next` cursor of the program's page, if it has one.
    pub(super) fn next_cursor(&self) -> Result<Option<String>, RuntimeError> {
        let Some(page) = &self.page else { return Ok(None) };
        let Some(values) = &page.next else { return Ok(None) };
        let table = self.schema.table(&page.table).expect("scanned table");
        let index = table.index(&page.index).expect("scanned index");
        let suffix = Self::cursor_suffix(table, index, page.prefix_len);
        encode_cursor(self.schema, &CursorPosition { table: page.table.clone(), index: page.index.clone(), order: page.order, suffix, values: values.clone() })
            .map(Some)
            .map_err(|error| RuntimeError::Input(format!("cursor: {error}")))
    }

    /// Merge N ordered lanes into one ordered page: every lane reads
    /// `take` rows, the union is sorted by the shared index suffix, and the
    /// first `take` are returned. Lane discovery (`for` lanes) runs the
    /// source scan and binds each of its rows before the lane scan.
    pub(super) fn merge(&mut self, merge: &Merge) -> Result<Vec<Value>, RuntimeError> {
        let Some(first) = merge.lanes.first() else { return Ok(Vec::new()) };
        let table = self.schema.table(&first.scan.table).ok_or_else(|| RuntimeError::Schema(format!("missing table {}", first.scan.table)))?;
        let index = table.index(&first.scan.index).ok_or_else(|| RuntimeError::Schema(format!("missing index {}.{}", first.scan.table, first.scan.index)))?;
        let order = first.scan.order;
        let take = self.take(&first.scan.take)?;
        let prefix_len = first.scan.prefix.len();
        let suffix_columns: Vec<String> = index.columns().into_iter().skip(prefix_len).collect();
        // A merge's cursor names the merge's own scope; it is checked before
        // lane discovery so an empty discovery cannot admit a foreign token.
        if first.scan.opaque_cursor
            && let Some(after) = first.scan.after.as_deref()
            && let Value::String(token) = self.expr(after)?
        {
            let suffix = Self::cursor_suffix(table, index, prefix_len);
            decode_cursor_for(self.schema, &token, &first.scan.table, &first.scan.index, order, &suffix).map_err(|error| RuntimeError::Input(format!("cursor: {error}")))?;
        }
        let mut candidates: Vec<(Vec<Value>, Value)> = Vec::new();
        let mut seen = BTreeSet::new();
        let outer_depth = self.page_depth;
        for lane in &merge.lanes {
            let sources = match &lane.source {
                Some(source) => {
                    self.page_depth += 1;
                    let rows = self.scan(source)?;
                    self.page_depth -= 1;
                    rows
                }
                None => vec![Value::Null],
            };
            for source_row in sources {
                if lane.source.is_some() {
                    self.env.insert(lane.binding.clone(), source_row);
                }
                self.statements(&lane.setup, &merge.site)?;
                self.page_depth += 1;
                let rows = self.scan(&lane.scan)?;
                self.page_depth = outer_depth;
                for row in rows {
                    let id = row.field("id")?.as_str()?.to_owned();
                    if !seen.insert(id) {
                        continue;
                    }
                    let key: Vec<Value> = suffix_columns.iter().map(|column| row.field(column).cloned().unwrap_or(Value::Null)).collect();
                    candidates.push((key, row));
                }
            }
        }
        self.meter.step(candidates.len() as u64)?;
        candidates.sort_by(|(a, _), (b, _)| {
            let ordering = a.iter().zip(b).find_map(|(x, y)| match x.total_cmp(y) {
                Ordering::Equal => None,
                other => Some(other),
            }).unwrap_or(Ordering::Equal);
            match order {
                Order::Asc => ordering,
                Order::Desc => ordering.reverse(),
            }
        });
        let has_more = candidates.len() > take;
        candidates.truncate(take);
        if self.page_depth == 0 && first.scan.opaque_cursor {
            let continues = if self.meter.capped_at.is_some() || self.non_uniform { !candidates.is_empty() } else { has_more };
            let next = if continues { candidates.last().map(|(key, _)| key.clone()) } else { None };
            self.page = Some(PagePosition { table: first.scan.table.clone(), index: first.scan.index.clone(), order, prefix_len, next });
        }
        Ok(candidates.into_iter().map(|(_, row)| row).collect())
    }
}
