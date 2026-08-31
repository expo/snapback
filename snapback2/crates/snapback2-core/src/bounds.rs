use crate::certificate::Ceilings;
use crate::schema::{ColumnType, Schema};

/// Conservative serialized maximum for one row; 1 KiB applies only without a table declaration.
pub fn declared_serialized_row_max(schema: &Schema, table: &str) -> u64 {
    schema.table(table).map_or(1024, |table| {
        table.columns.iter().fold(10_u64, |size, (name, column)| {
            size.saturating_add(name.len() as u64)
                .saturating_add(4)
                .saturating_add(declared_column_max(column))
        })
    })
}

/// Largest page that can be returned under the default certificate byte ceilings.
pub fn max_certified_page_rows(schema: &Schema, table: &str, ceilings: &Ceilings) -> u32 {
    let row = declared_serialized_row_max(schema, table);
    let output_rows = ceilings.output_bytes.saturating_sub(2) / row.saturating_add(1);
    let closure_rows = ceilings.closure_bytes / row.max(1);
    output_rows.min(closure_rows).min(u64::from(u32::MAX)) as u32
}

fn declared_column_max(column: &ColumnType) -> u64 {
    match column {
        ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. } => 144,
        ColumnType::Text { max } | ColumnType::Json { max_bytes: max } => {
            u64::from(*max).saturating_add(16)
        }
        ColumnType::Bytes { max } => u64::from(*max).saturating_mul(2).saturating_add(16),
        ColumnType::Int
        | ColumnType::Time
        | ColumnType::Decimal { .. }
        | ColumnType::Money { .. } => 32,
        ColumnType::Bool => 16,
        ColumnType::Optional(inner) => declared_column_max(inner).max(8),
        ColumnType::List { of, max } => 2_u64.saturating_add(
            u64::from(*max).saturating_mul(declared_column_max(of).saturating_add(1)),
        ),
        ColumnType::Enum { variants } => variants
            .iter()
            .map(|variant| variant.len() as u64 + 16)
            .max()
            .unwrap_or(16),
    }
}
