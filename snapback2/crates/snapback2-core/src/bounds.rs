use crate::certificate::Ceilings;
use crate::schema::{ColumnType, Schema};

pub(crate) const CANONICAL_ARRAY_BASE_BYTES: u64 = 12;
pub(crate) const CANONICAL_ROW_BASE_BYTES: u64 = 10;

/// Conservative serialized maximum for one row; 1 KiB applies only without a table declaration.
pub fn declared_serialized_row_max(schema: &Schema, table: &str) -> u64 {
    schema.table(table).map_or(1024, |declaration| {
        declaration
            .columns
            .iter()
            .fold(CANONICAL_ROW_BASE_BYTES, |size, (name, column)| {
                size.saturating_add(crate::value::canonical_json(name).len() as u64)
                    .saturating_add(2)
                    .saturating_add(
                        declared_column_value_max(schema, table, name)
                            .unwrap_or_else(|| declared_column_max(column)),
                    )
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
    if column == "id" {
        return Some(declared_identity_max(schema, table));
    }
    schema
        .table(table)
        .and_then(|table| table.columns.get(column))
        .map(|kind| declared_type_max(schema, kind))
        .or_else(|| (column == "id").then_some(declared_column_max(&ColumnType::Id)))
}

// @ref LLP 1001#maintained-addresses — preserve address bytes and price the
// target's declared group, including schema-targeted references. A recursive
// address domain has no finite maximum and saturates into the existing ceiling.
pub(crate) fn declared_identity_max(schema: &Schema, table: &str) -> u64 {
    identity_max(schema, table, &mut std::collections::BTreeSet::new())
}
pub(crate) fn declared_type_max(schema: &Schema, kind: &ColumnType) -> u64 {
    type_max(schema, kind, &mut std::collections::BTreeSet::new())
}
fn identity_max(
    schema: &Schema,
    table: &str,
    visiting: &mut std::collections::BTreeSet<String>,
) -> u64 {
    let Some(maintain) = schema.maintains.iter().find(|m| m.target == table) else {
        return 144;
    };
    if !visiting.insert(table.to_owned()) {
        return u64::MAX;
    }
    let tuple = maintain.by.iter().fold(2u64, |size, name| {
        let width = schema
            .table(&maintain.source)
            .and_then(|t| t.columns.get(name))
            .map_or(u64::MAX, |kind| type_max(schema, kind, visiting));
        size.saturating_add(width).saturating_add(1)
    });
    visiting.remove(table);
    tuple.saturating_mul(2).saturating_add(9).max(144)
}
fn type_max(
    schema: &Schema,
    kind: &ColumnType,
    visiting: &mut std::collections::BTreeSet<String>,
) -> u64 {
    match kind {
        ColumnType::Ref { table } => identity_max(schema, table, visiting),
        ColumnType::Optional(inner) => type_max(schema, inner, visiting).max(8),
        ColumnType::List { of, max } => CANONICAL_ARRAY_BASE_BYTES.saturating_add(
            u64::from(*max).saturating_mul(type_max(schema, of, visiting).saturating_add(1)),
        ),
        _ => declared_column_max(kind),
    }
}

pub(crate) fn declared_column_max(column: &ColumnType) -> u64 {
    match column {
        ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. } => 144,
        ColumnType::Text { max } => u64::from(*max).saturating_mul(4).saturating_add(16),
        ColumnType::Json { max_bytes } => u64::from(*max_bytes).saturating_add(16),
        ColumnType::Bytes { max } => u64::from(*max).saturating_mul(2).saturating_add(16),
        // @ref LLP 1006#1-the-move — the asset max constrains blob bytes;
        // row width prices only the closed id-and-dimensions record.
        ColumnType::Image { .. } => declared_asset_record_max(false),
        ColumnType::Video { .. } => declared_asset_record_max(true),
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
            .map(|variant| {
                (variant.len() as u64 + 16).max(
                    crate::value::canonical_json(&crate::Value::String(variant.clone())).len()
                        as u64,
                )
            })
            .max()
            .unwrap_or(16),
    }
}

pub(crate) fn declared_asset_record_max(has_duration: bool) -> u64 {
    let field =
        |name: &str, value: u64| (name.len() as u64).saturating_add(4).saturating_add(value);
    let image = CANONICAL_ROW_BASE_BYTES
        .saturating_add(field("id", declared_column_max(&ColumnType::Id)))
        .saturating_add(field("height", declared_column_max(&ColumnType::Int)))
        .saturating_add(field("width", declared_column_max(&ColumnType::Int)));
    if has_duration {
        image.saturating_add(field("duration", declared_column_max(&ColumnType::Int)))
    } else {
        image
    }
}

#[cfg(test)]
mod tests {
    use super::{declared_asset_record_max, declared_column_max};
    use crate::schema::ColumnType;

    #[test]
    fn asset_width_is_the_closed_record_not_the_blob_ceiling() {
        assert_eq!(declared_asset_record_max(false), 243);
        assert_eq!(declared_asset_record_max(true), 287);
        assert_eq!(
            declared_column_max(&ColumnType::Image {
                max: 1,
                once: false
            }),
            243
        );
        assert_eq!(
            declared_column_max(&ColumnType::Image {
                max: u32::MAX,
                once: false
            }),
            243
        );
        assert_eq!(declared_column_max(&ColumnType::Video { max: 1 }), 287);
    }
}
