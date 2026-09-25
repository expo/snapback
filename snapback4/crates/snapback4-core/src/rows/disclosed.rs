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

// Raw storage access requires proof that the caller is inside the internal
// ledger. No projection or actual raw price is exposed to the caller meter.
pub(crate) fn get(rows: &dyn Rows, name: &str, id: &str, _: &crate::engine::authorized_scan::Authorization) -> Result<Option<Value>, RuntimeError> {
    rows.get(name, id)
}
pub(crate) fn lookup(rows: &dyn Rows, name: &str, index_name: &str, index: &crate::schema::Index, key: &[Value], _: &crate::engine::authorized_scan::Authorization) -> Result<Option<Value>, RuntimeError> {
    rows.lookup(name, index_name, index, key)
}
pub(crate) fn candidates(rows: &dyn Rows, name: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize, meter: &mut Meter, _: &crate::engine::authorized_scan::Authorization) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> {
    let _ = meter;
    rows.scan(name, index, prefix, bounds, dir, limit)
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
