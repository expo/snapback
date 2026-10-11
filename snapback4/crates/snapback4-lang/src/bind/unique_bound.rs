//! A prefix that pins a unique key bounds its rows as a `cap` does: at most
//! one row, or one per value of the key's remaining finite columns (`unique
//! subscriber, topic` with a three-value `topic` enum: three rows per
//! subscriber). The store enforces the key on every insert and update, so
//! the bound is exact, like a cap's.
// @ref LLP 3000.036#13.4 — wave 3 #7: a unique-key equality is a bound (lanes 041 058 098).
use snapback4_core::schema::{ColumnType, Schema};

/// The tighter of the schema's cap over `pinned` and a unique key's bound.
pub(crate) fn group_bound(schema: &Schema, table: &str, pinned: &[String]) -> Option<u32> {
    schema.group_bound(table, pinned).into_iter().chain(unique_bound(schema, table, pinned)).min()
}

/// Rows a prefix pinning `pinned` can hold under some unique key of `table`.
pub(crate) fn unique_bound(schema: &Schema, table: &str, pinned: &[String]) -> Option<u32> {
    let info = schema.table(table)?;
    let column = |name: &str| if name == "id" { Some(&ColumnType::Id) } else { info.columns.get(name) };
    info.indexes.values().filter(|index| index.unique && index.is_plain()).filter_map(|index| {
        let columns = index.columns();
        // A nullable key column admits tied nulls; and an unpinned column
        // bounds the group only through its finite set of values.
        let mut rows: u32 = 1;
        for name in &columns {
            let kind = column(name)?;
            if kind.is_optional() { return None; }
            if pinned.contains(name) { continue; }
            let values = match kind {
                ColumnType::Enum { variants } => u32::try_from(variants.len()).ok()?,
                ColumnType::Bool => 2,
                _ => return None,
            };
            rows = rows.checked_mul(values)?;
        }
        (!columns.is_empty()).then_some(rows)
    }).min()
}
