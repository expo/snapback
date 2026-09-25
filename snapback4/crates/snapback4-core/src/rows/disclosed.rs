//! Fixed transient decode reservation, followed by typed viewer projection.
// @ref LLP 3000.015#1 — raw blob lengths never enter a principal's meter.
use super::*;
use crate::{meter::Meter, schema::ColumnType};

/// Includes serialized storage scratch, typed decode, escaping scratch, map
/// nodes and geometric array growth. Id/Principal/Ref have the admission bound
/// of 144 canonical tagged bytes (value::validate_identities), on every host.
pub fn decode_reservation(table: &Table) -> u64 {
    table.columns.iter().fold(4096 + MAX_INDEX_KEY_BYTES as u64 * 4, |n, (name, ty)|
        n.saturating_add(256 + name.len() as u64 * 16).saturating_add(column(ty)))
}

fn column(ty: &ColumnType) -> u64 {
    use ColumnType::*;
    match ty {
        Id | Principal | Ref { .. } => 144 * 16,
        Text { max } => u64::from(*max) * 16,
        Bytes { max } => u64::from(*max) * 16,
        Enum { variants } => variants.iter().map(|v| v.len() as u64 * 16).max().unwrap_or(0),
        Optional(inner) => column(inner),
        List { of, max } => u64::from(*max).saturating_mul(256_u64.saturating_add(column(of))).saturating_add(256),
        Json { max_bytes } => u64::from(*max_bytes) * 256,
        Image { .. } | Video { .. } => 16384, // bounded asset facts, never file bytes
        Int | Decimal { .. } | Money { .. } | Bool | Time => 256,
    }
}

/// A private table is fetched one row at a time. The fixed decode reservation
/// stays live through projection; only then are raw payloads dropped and the
/// reservation released. Errors keep their peak/cut, never restore the meter.
pub fn scan<'a>(rows: &dyn Rows, name: &str, table: &'a Table, viewer: &str, index: &str,
    prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize, meter: &mut Meter,
) -> Result<Vec<(crate::value::Disclosed<'a>, Vec<u8>)>, RuntimeError> {
    if !table.written_by.values().any(|a| !a.audience) {
        meter.heap(word_heap::slots::<(crate::value::Disclosed<'_>, Vec<u8>)>(limit))?;
        return rows.scan_metered(name, index, prefix, bounds, dir, limit, meter)
            .map(|rows| rows.into_iter().map(|(row,key)|(table.project_fields(row,Some(viewer)),key)).collect());
    }
    meter.heap((256 + word_heap::text(viewer)) * limit as u64 + word_heap::bounds(bounds))?;
    let mut cursor = bounds.clone();
    let mut out = Vec::with_capacity(limit);
    for _ in 0..limit {
        let mark = meter.mark();
        let reservation = decode_reservation(table);
        meter.heap(reservation)?;
        let fetched = rows.scan(name, index, prefix, &cursor, dir, 1)?;
        let Some((raw, key)) = fetched.into_iter().next() else { meter.release_row_heap(mark,reservation); break; };
        let disclosed = table.project_fields(raw,Some(viewer));
        meter.heap(disclosed.heap_bytes() + disclosed.projection_heap() + word_heap::materialize(&disclosed,table))?;
        let value = disclosed.into_value(); // drops every undisclosed allocation
        meter.release_row_heap(mark,reservation);
        // The suffix consists exclusively of public indexed fields. Its maximum
        // admitted encoded size is reserved above; retaining it costs its size.
        meter.heap(word_heap::key_decode(table.index(index).map_or(1,|i|i.components.len()+1),key.len()))?;
        cursor.after = crate::key::decode(&key).map(|v|v.into_iter().skip(prefix.len()).collect());
        out.push((table.project_fields(value,Some(viewer)),key));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn oversized_nested_declarations_saturate_the_reservation() {
        let mut kind = ColumnType::Text { max: u32::MAX };
        for _ in 0..5 { kind = ColumnType::List { of: Box::new(kind), max: u32::MAX }; }
        let table = crate::schema::public_table([("payload".into(),kind)].into(),Default::default());
        assert_eq!(decode_reservation(&table),u64::MAX);
    }
}
