//! Returned one-to-one collectors run after their source page is materialized.
use super::{pages::Shape, runner::{Flow, PagePosition, Runner}};
use crate::{error::{MeterKind, RuntimeError}, value::Value};

#[derive(Clone, Copy, Debug)]
pub(super) enum Resume { Never, FromStart, AfterEmission }

pub(super) struct ShapePosition {
    pub rows: usize,
    pub next: Option<Vec<Value>>,
    pub inclusive: bool,
    /// The meter was already capped before this row's shape ran.
    pub inherited_cap: bool,
}

impl Runner<'_> {
    pub(super) fn record_shape_positions<'r>(&mut self, site: &str, page: &mut PagePosition, rows: impl Iterator<Item = &'r Value>) -> Result<(), RuntimeError> {
        if !self.page_plan.shapes.values().any(|shape| shape.page == site) { return Ok(()); }
        // An opening/word-cut merge has unknown heads; shaping cannot grant it a cursor.
        page.shape_resume = if !page.merge || (self.meter.capped_at.is_none() && self.word_cut_at.is_none()) { Resume::FromStart }
            else if page.next.is_some() { Resume::AfterEmission } else { Resume::Never };
        let index = if page.view_suffix.is_some() { None } else { Some(self.schema.tables[&page.table].index(&page.index).expect("recorded page index")) };
        page.shape_positions = rows.map(|row| {
            if let Some(suffix) = &page.view_suffix { return suffix.iter().map(|column| row.field(&column.name).cloned().unwrap_or(Value::Null)).collect(); }
            let index = index.expect("ordinary page index");
            let mut key: Vec<_> = index.components.iter().skip(page.prefix_len).filter_map(|component| component.value(row)).collect();
            if page.merge && index.components.last().and_then(|component| component.column()).map(String::as_str) != Some("id") {
                key.push(row.field("id").cloned().unwrap_or(Value::Null));
            }
            key
        }).collect();
        let bytes = page.shape_positions.capacity() as u64 * std::mem::size_of::<Vec<Value>>() as u64
            + page.shape_positions.iter().map(|key| key.capacity() as u64 * std::mem::size_of::<Value>() as u64 + key.iter().map(Value::heap_bytes).sum::<u64>()).sum::<u64>();
        self.meter.heap(bytes)
    }

    pub(super) fn shape_lengths(&self, shape: &Shape) -> Vec<usize> {
        shape.targets.iter().map(|target| self.env.get(target).and_then(|value| value.as_array().ok()).map_or(0, |values| values.len())).collect()
    }

    pub(super) fn shape_starved(&self, mark: u64, result: &Result<Flow, RuntimeError>) -> bool {
        if self.meter.capped_at.is_none() { return false; }
        match result {
            Ok(_) => self.read_cuts != mark,
            Err(RuntimeError::Bound { kind: MeterKind::Examined | MeterKind::IndexEntries | MeterKind::RuleProbes, .. }) => true,
            _ => false,
        }
    }

    // @ref LLP 3000.007#5.6 — a cut page never shows a row it could not finish; the continuation reaches it first
    pub(super) fn trim_shape(&mut self, site: &str, shape: &Shape, index: usize, lengths: &[usize], inherited_cap: bool) {
        for (target, length) in shape.targets.iter().zip(lengths) {
            if let Some(Value::Array(values)) = self.env.get_mut(target) { values.truncate(*length); }
        }
        if let Some(page) = self.pages.get(&shape.page) {
            let next = match page.shape_resume {
                Resume::Never => None,
                Resume::AfterEmission if index == 0 => None,
                _ => page.shape_positions.get(index.saturating_sub(1)).cloned(),
            };
            let inclusive = index == 0 && next.is_some();
            self.shape_positions.insert(site.to_owned(), ShapePosition { rows: index, next, inclusive, inherited_cap });
        }
    }
}
