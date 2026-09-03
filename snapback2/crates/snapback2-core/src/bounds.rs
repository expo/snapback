use crate::certificate::Ceilings;
use crate::schema::{ColumnType, Schema};

pub(crate) const CANONICAL_ARRAY_BASE_BYTES: u64 = 12;
pub(crate) const CANONICAL_ROW_BASE_BYTES: u64 = 10;

/// Conservative serialized maximum for one row; 1 KiB applies only without a table declaration.
pub fn declared_serialized_row_max(schema: &Schema, table: &str) -> u64 {
    schema.table(table).map_or(1024, |table| {
        table
            .columns
            .iter()
            .fold(CANONICAL_ROW_BASE_BYTES, |size, (name, column)| {
                size.saturating_add(name.len() as u64)
                    .saturating_add(4)
                    .saturating_add(declared_column_max(column))
            })
    })
}

/// Largest page that can be returned under the default certificate byte ceilings.
pub fn max_certified_page_rows(schema: &Schema, table: &str, ceilings: &Ceilings) -> u32 {
    let row = declared_serialized_row_max(schema, table);
    let output_rows = ceilings
        .output_bytes
        .saturating_sub(CANONICAL_ARRAY_BASE_BYTES)
        / row.saturating_add(1);
    let closure_rows = ceilings.closure_bytes / row.max(1);
    output_rows.min(closure_rows).min(u64::from(u32::MAX)) as u32
}

pub(crate) fn declared_serialized_column_max(
    schema: &Schema,
    table: &str,
    column: &str,
) -> Option<u64> {
    let column_max = declared_column_value_max(schema, table, column)?;
    Some(
        column_max
            .saturating_add(column.len() as u64)
            .saturating_add(4),
    )
}

pub(crate) fn declared_column_value_max(schema: &Schema, table: &str, column: &str) -> Option<u64> {
    schema
        .table(table)
        .and_then(|table| table.columns.get(column))
        .map(declared_column_max)
        .or_else(|| (column == "id").then_some(declared_column_max(&ColumnType::Id)))
}

pub(crate) fn declared_column_max(column: &ColumnType) -> u64 {
    match column {
        ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. } => 144,
        ColumnType::Text { max } => u64::from(*max).saturating_mul(4).saturating_add(16),
        ColumnType::Json { max_bytes } => u64::from(*max_bytes).saturating_add(16),
        ColumnType::Bytes { max } => u64::from(*max).saturating_mul(2).saturating_add(16),
        ColumnType::Int
        | ColumnType::Time
        | ColumnType::Decimal { .. }
        | ColumnType::Money { .. } => 32,
        ColumnType::Bool => 16,
        ColumnType::Optional(inner) => declared_column_max(inner).max(8),
        ColumnType::List { of, max } => CANONICAL_ARRAY_BASE_BYTES.saturating_add(
            u64::from(*max).saturating_mul(declared_column_max(of).saturating_add(1)),
        ),
        ColumnType::Enum { variants } => variants
            .iter()
            .map(|variant| variant.len() as u64 + 16)
            .max()
            .unwrap_or(16),
    }
}
