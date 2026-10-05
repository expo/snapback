//! Admission for a fetched adoption page, before any callback can write.
use crate::{error::{MeterKind, RuntimeError}, meter::Meter, schema::{ColumnDefault, IndexComponent, Maintain, Table}, value::{Value, InternalPrice}};
use super::word_heap as heap;
use crate::engine::authorized_scan::InternalLedger;

/// Cumulative callback work per source row. Admission adds one examination;
/// heap is checked separately because row scratch is released after each row.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Work {
    pub examined: u64,
    pub steps: u64,
    pub index_entries: u64,
}

impl Work {
    pub const DECODE: Self = Self { examined: 1, steps: 0, index_entries: 0 };

    pub fn with_contribution(mut self, maintain: &Maintain) -> Self {
        self.examined = self.examined.saturating_add(1);
        self.steps = self.steps.saturating_add(maintain.evaluation_steps());
        // A selected contribution creates exactly one entry, otherwise none.
        self.index_entries = self.index_entries.saturating_add(1);
        self
    }

    pub fn table(table: &Table) -> Self {
        table.indexes.values().fold(Self::DECODE, |work, index| match index.components.first() {
            Some(IndexComponent::Contribution(maintain)) => work.with_contribution(maintain),
            _ => work,
        })
    }

    fn counters(self, meter: &Meter) -> [(MeterKind, u64, u64, u64); 3] {
        [
            (MeterKind::Examined, self.examined.saturating_add(1), meter.used.examined, meter.ceilings.examined),
            (MeterKind::Steps, self.steps, meter.used.steps, meter.ceilings.steps),
            (MeterKind::IndexEntries, self.index_entries, meter.used.index_entries, meter.ceilings.index_entries),
        ]
    }

    pub fn limit(self, meter: &Meter, maximum: usize) -> usize {
        self.counters(meter).into_iter().filter(|(_, per_row, _, _)| *per_row != 0)
            .fold(maximum as u64, |limit, (_, per_row, used, ceiling)| limit.min(ceiling.saturating_sub(used) / per_row))
            // An empty range is still legal; a non-fitting singleton refuses
            // in fits(), after establishing that there really is a source row.
            .max(1) as usize
    }

    fn fits(self, meter: &Meter, count: usize) -> Result<bool, RuntimeError> {
        for (kind, per_row, used, ceiling) in self.counters(meter) {
            let actual = used.saturating_add(per_row.saturating_mul(count as u64));
            if actual > ceiling {
                if count > 1 { return Ok(false); }
                return Err(RuntimeError::Bound { kind, actual, ceiling, site: meter.site().to_owned() });
            }
        }
        Ok(true)
    }
}

pub(crate) fn decode_bytes(data: &str) -> InternalPrice {
    InternalLedger::with_meter(&mut Meter::new(crate::Ceilings::unbounded(), crate::meter::Cut::Abort), |_, scope| heap::stored_row(data, scope).fixed(4096))
}

/// The price remains opaque: adoption may charge it only on its internal meter.
pub(crate) fn contribution_bytes(row: &Value, table: &Table) -> InternalPrice {
    InternalLedger::with_meter(&mut Meter::new(crate::Ceilings::unbounded(), crate::meter::Cut::Abort), |_, scope| {
        let mut bytes = row.retained_internal(scope);
        for (name, kind) in &table.columns {
            if row.field(name).is_ok() { continue; }
            let added = if table.maintained.contains_key(name) || kind.is_optional() { Some(InternalPrice::zero()) }
                else if let Some(ColumnDefault::Literal(value)) = table.defaults.get(name) { Some(value.retained_internal(scope)) }
                else { None };
            if let Some(added) = added { bytes = bytes.fixed(80 + name.len() as u64).plus(added); }
        }
        bytes.times(4).fixed(4096)
    })
}

pub(crate) fn charge(meter: &mut Meter, price: InternalPrice) -> Result<(), RuntimeError> {
    InternalLedger::with_meter(meter, |meter, scope| price.charge(meter, scope))
}
pub(crate) fn fits(meter: &mut Meter, price: &InternalPrice) -> bool {
    InternalLedger::with_meter(meter, |meter, scope| price.fits(meter, scope))
}

// @ref LLP 3000.007#20.9.3 — shrink pages before adoption writes when retained images plus row work cannot fit.
pub(crate) fn page_fits<'a>(images: impl ExactSizeIterator<Item = &'a str>, meter: &mut Meter,
    work: Work, scratch: Option<&dyn Fn(&Value) -> InternalPrice>) -> Result<bool, RuntimeError> {
    // Fix every cumulative budget before admission decodes or callbacks. Heap
    // retries retain used work, so both this check and limit use the remainder.
    if !work.fits(meter, images.len())? { return Ok(false); }
    let singleton = images.len() == 1;
    for data in images {
        let mark = meter.mark();
        let decode = decode_bytes(data);
        if !singleton && !fits(meter, &decode) { return Ok(false); }
        charge(meter, decode)?;
        meter.charge(MeterKind::Examined, 1)?;
        let row: Option<Value> = scratch.map(|_| crate::json_codec::from_text(data).map_err(|e| RuntimeError::Store(e.to_string()))).transpose()?;
        let work = match (scratch, row.as_ref()) { (Some(scratch), Some(row)) => scratch(row), _ => InternalPrice::zero() };
        let fits = fits(meter, &work);
        // Only a singleton may refuse for heap. Larger pages can be dropped
        // and fetched again with a smaller limit, without replaying a write.
        if !fits && singleton { charge(meter, work)?; }
        drop(row);
        meter.release_heap(mark);
        if !fits { return Ok(false); }
    }
    Ok(true)
}
