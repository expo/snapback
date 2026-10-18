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
#[cfg(feature="postgres")]
pub(crate) fn page_fits<'a>(images: impl ExactSizeIterator<Item = &'a str>, meter: &mut Meter,
    work: Work, scratch: Option<&dyn Fn(&Value) -> InternalPrice>) -> Result<bool, RuntimeError> {
    let checked=|row:&Value|Ok(scratch.map_or_else(InternalPrice::zero,|f|f(row)));
    page_fits_checked(images,meter,work,scratch.map(|_|&checked as &dyn Fn(&Value)->Result<InternalPrice,RuntimeError>))
}

pub(crate) fn page_fits_checked<'a>(images: impl ExactSizeIterator<Item = &'a str>, meter: &mut Meter,
    work: Work, scratch: Option<&dyn Fn(&Value) -> Result<InternalPrice,RuntimeError>>) -> Result<bool, RuntimeError> {
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
        let work = match (scratch, row.as_ref()) { (Some(scratch), Some(row)) => scratch(row)?, _ => InternalPrice::zero() };
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

/// Full simultaneous old/new key-vector scratch, including bounded token
/// cardinality. Live destinations are plain; captured/manual successors may
/// add word indexes and must still be admitted before native index_write.
pub(crate) fn index_capacity(table:&Table)->u64 {
    table.indexes.values().map(|i|index_copies(table,i)).fold(0_u64,u64::saturating_add)
}
fn index_copies(table:&Table,index:&crate::schema::Index)->u64 {
    if let Some((_,fields))=index.word_component() {
        fields.iter().filter_map(|f|table.columns.get(f)).map(|k|match k.required(){crate::schema::ColumnType::Text{max}=>u64::from(*max),crate::schema::ColumnType::Enum{variants}=>variants.iter().map(|s|s.len() as u64).max().unwrap_or(0),_=>0}).fold(0_u64,u64::saturating_add).min(crate::words::MAX_TOKENS_PER_ROW as u64)
    }else{1}
}
pub(crate) fn index_scratch(name:&str,table:&Table)->u64 {
    table.indexes.iter().map(|(label,index)| {
        // Legacy oversized keys may legally remain equal or shrink. Their
        // buffers still coexist; the ordinary 2048-byte gate is not a bound
        // on allocation before that gate runs.
        let key=index.components.iter().fold(291_u64,|n,c|n.saturating_add(match c {
            IndexComponent::Column(field)=>table.columns.get(field).and_then(crate::schema::live::key_column).unwrap_or_else(||super::disclosed::decode_reservation(table)),
            IndexComponent::WordPrefixes{..}=>2*crate::words::MAX_TOKEN_BYTES as u64+3,
            _=>super::disclosed::decode_reservation(table),
        })).max(super::MAX_INDEX_KEY_BYTES as u64);
        // Empty token sets still allocate an IndexWrite slot and the word
        // field-reference vector. These are independent of emitted key count.
        let fixed=512_u64.saturating_add(4*(name.len()+label.len()) as u64)
            .saturating_add(index.word_component().map_or(0,|(_,fields)|(fields.len() as u64).saturating_mul(32)));
        fixed.saturating_add(index_copies(table,index).saturating_mul(key.saturating_mul(4).saturating_add(128*(index.components.len() as u64+1)+512+4*(name.len()+label.len()) as u64)))
    }).fold(0_u64,u64::saturating_add)
}

#[cfg(test)]
mod live_index_scratch_tests {
    use super::*;
    #[test]
    fn empty_word_sets_still_reserve_native_index_slots() {
        use crate::schema::{ColumnType,Index,IndexComponent,public_table};
        let table=public_table([("id".into(),ColumnType::Id),("body".into(),ColumnType::Text{max:0})].into(),[("words".into(),Index{components:vec![IndexComponent::WordPrefixes{fields:vec!["body".into()],contract:serde_json::Value::String(crate::words::CONTRACT.into())},IndexComponent::Column("id".into())],unique:false})].into());
        assert_eq!(index_capacity(&table),0);
        // A nonempty vector of zero-key IndexWrite records remains retained.
        assert!(index_scratch("t",&table)>=512);
    }
    #[test]
    fn enum_words_reserve_the_tokens_the_native_index_will_emit() {
        use crate::schema::{ColumnType,Index,IndexComponent,public_table};
        let table=public_table([("id".into(),ColumnType::Id),("body".into(),ColumnType::Enum{variants:vec!["one two".into()]})].into(),[("words".into(),Index{components:vec![IndexComponent::WordPrefixes{fields:vec!["body".into()],contract:serde_json::Value::String(crate::words::CONTRACT.into())},IndexComponent::Column("id".into())],unique:false})].into());
        let row=crate::value::object([("id",Value::Id("r".into())),("body",Value::String("one two".into()))]);
        let keys=super::super::index_keys(&table.indexes["words"],&row,"r");assert_eq!(keys.len(),2);
        assert!(index_capacity(&table)>=keys.len() as u64);
        assert!(index_scratch("t",&table)>=keys.iter().map(|k|k.len() as u64*4).sum());
    }
}
