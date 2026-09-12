use super::*;

pub(super) fn validate_scan_cursors(
    checker: &Checker<'_>,
    program: &Program,
    scan: &Scan,
    bindings: &BTreeMap<String, StaticBinding>,
    errors: &mut Vec<CheckError>,
) {
    let Some(table) = checker.schema.table(&scan.table) else {
        return;
    };
    let Some(index) = table.index(&scan.index) else {
        return;
    };
    if scan.prefix.len() > index.components.len() {
        errors.push(CheckError {
            site: None,
            code: "E_ARGS_TYPE".to_owned(),
            message: format!(
                "scan {} prefix supplies {} components but {}.{} has {} columns",
                scan.site,
                scan.prefix.len(),
                scan.table,
                scan.index,
                index.components.len(),
            ),
            rewrite: format!(
                "keep only the first {} prefix components when scanning {}.{}",
                index.components.len(),
                scan.table,
                scan.index,
            ),
        });
        return;
    }
    if scan.merge_site.is_some()
        && index
            .components
            .last()
            .and_then(crate::search_key::IndexComponent::column)
            .map(String::as_str)
            != Some("id")
    {
        let columns = index
            .components
            .iter()
            .filter_map(crate::search_key::IndexComponent::column)
            .filter(|column| column.as_str() != "id")
            .cloned()
            .chain(std::iter::once("id".to_owned()))
            .collect::<Vec<_>>()
            .join(", ");
        if !errors.iter().any(|error| {
            error.code == "E_ARGS_CURSOR_INDEX"
                && error
                    .message
                    .contains(scan.merge_site.as_deref().unwrap_or_default())
        }) {
            errors.push(CheckError {
                site: None,
                code: "E_ARGS_CURSOR_INDEX".to_owned(),
                message: format!(
                    "pageable merge {} uses {}.{}, whose index does not end in intrinsic id",
                    scan.merge_site.as_deref().unwrap_or(&scan.site),
                    scan.table,
                    scan.index,
                ),
                rewrite: format!(
                    "change {}.{} columns to [{columns}] so the shared merge suffix is total",
                    scan.table, scan.index
                ),
            });
        }
    }
    if scan.after.is_none() && scan.before.is_none() {
        return;
    }
    let remaining_columns = &index.suffix_columns(scan.prefix.len()).unwrap_or_default();
    if remaining_columns.is_empty() {
        for expression in [scan.after.as_deref(), scan.before.as_deref()] {
            if expression.is_none() {
                continue;
            }
            errors.push(CheckError {
                site: None,
                code: "E_ARGS_CURSOR_SHAPE".to_owned(),
                message: format!(
                    "scan {}.{} prefix names every index column, so a cursor has no position to compare; remove after/before or shorten the prefix",
                    scan.table, scan.index
                ),
                rewrite: format!(
                    "remove after and before from the scan of {}.{}; its prefix already names every index column",
                    scan.table, scan.index
                ),
            });
        }
        return;
    }
    // @ref LLP 1001#3-read-and-write-states-no-silent-states — a cursored index must be a total order (ends in `id`, or is
    // unique); the runtime accepts the lossy shape, so this is a policy refusal.
    if index
        .components
        .last()
        .and_then(crate::search_key::IndexComponent::column)
        .map(String::as_str)
        != Some("id")
        && !index.unique
    {
        let columns = index
            .components
            .iter()
            .filter_map(crate::search_key::IndexComponent::column)
            .filter(|column| column.as_str() != "id")
            .cloned()
            .chain(std::iter::once("id".to_owned()))
            .collect::<Vec<_>>()
            .join(", ");
        errors.push(CheckError {
            site: None,
            code: "E_ARGS_CURSOR_INDEX".to_owned(),
            message: format!(
                "scan {} uses a cursor on {}.{}, whose index is not a total order (it neither ends in id nor is unique)",
                scan.site, scan.table, scan.index
            ),
            rewrite: format!(
                "change {}.{} columns to [{columns}] so every cursor position is a total order",
                scan.table, scan.index
            ),
        });
        return;
    }
    for (bound, expression) in [
        ("after", scan.after.as_deref()),
        ("before", scan.before.as_deref()),
    ] {
        let Some(expression) = expression else {
            continue;
        };
        let fact = static_expression_fact(
            checker.schema,
            program,
            expression,
            bindings,
            &mut BTreeSet::new(),
        );
        if scan.opaque_cursor {
            if bound != "after" || !matches!(unwrap_static_type(&fact.kind), StaticType::Cursor) {
                errors.push(CheckError {
                    site: None,
                    code: "E_ARGS_TYPE".to_owned(),
                    message: format!(
                        "scan {} opaque cursor must be an after expression typed Cursor",
                        scan.site
                    ),
                    rewrite: "pass a Cursor argument to after, or use a typed tuple in raw IR"
                        .to_owned(),
                });
            }
            continue;
        }
        let expected = remaining_columns.len();
        if expected == 1 && matches!(fact.kind, StaticType::Object) {
            errors.push(CheckError {
                site: None,
                code: "E_ARGS_CURSOR_SHAPE".to_owned(),
                message: format!(
                    "scan {} {bound} cursor must be an indexable scalar",
                    scan.site
                ),
                rewrite: cursor_tuple_rewrite(scan, bound, remaining_columns),
            });
            continue;
        }
        let shape_matches = match unwrap_static_type(&fact.kind) {
            StaticType::List {
                len: Some(actual), ..
            } => Some(*actual == expected),
            StaticType::List { len: None, .. }
            | StaticType::Unknown
            | StaticType::Json
            | StaticType::Row(_)
            | StaticType::Optional(_) => None,
            StaticType::Object => Some(false),
            _ => Some(expected == 1),
        };
        if shape_matches == Some(false) {
            errors.push(CheckError {
                site: None,
                code: "E_ARGS_CURSOR_SHAPE".to_owned(),
                message: format!(
                    "scan {} {bound} cursor must contain exactly {expected} value(s), one for each remaining {}.{} index column",
                    scan.site, scan.table, scan.index
                ),
                rewrite: cursor_tuple_rewrite(scan, bound, remaining_columns),
            });
            continue;
        }
        let Some(element_types) =
            static_cursor_element_types(checker.schema, program, expression, bindings, expected)
        else {
            continue;
        };
        if element_types.len() != remaining_columns.len() {
            continue;
        }
        for (offset, (actual, column)) in element_types.iter().zip(remaining_columns).enumerate() {
            let Some(expected) = table.columns.get(column) else {
                continue;
            };
            if cursor_static_type_matches_column(actual, expected) == Some(false) {
                errors.push(CheckError {
                    site: None,
                    code: "E_ARGS_TYPE".to_owned(),
                    message: format!(
                        "scan {} {bound} cursor component {} is {} but {}.{} column {} is {}",
                        scan.site,
                        offset + 1,
                        static_cursor_kind(actual),
                        scan.table,
                        scan.index,
                        column,
                        cursor_column_kind(expected),
                    ),
                    rewrite: cursor_tuple_rewrite(scan, bound, remaining_columns),
                });
            }
        }
    }
}

fn static_cursor_element_types(
    schema: &Schema,
    program: &Program,
    expression: &Expr,
    bindings: &BTreeMap<String, StaticBinding>,
    expected: usize,
) -> Option<Vec<StaticType>> {
    let expression = resolve_static_expression(expression, bindings, &mut BTreeSet::new());
    match expression {
        Expr::Array(values) => Some(
            values
                .iter()
                .map(|value| {
                    static_expression_fact(schema, program, value, bindings, &mut BTreeSet::new())
                        .kind
                })
                .collect(),
        ),
        Expr::Literal(Value::Array(values)) => {
            Some(values.iter().map(static_literal_type).collect())
        }
        _ if expected == 1 => Some(vec![
            static_expression_fact(schema, program, expression, bindings, &mut BTreeSet::new())
                .kind,
        ]),
        _ => None,
    }
}

fn cursor_static_type_matches_column(actual: &StaticType, expected: &ColumnType) -> Option<bool> {
    // Optional arguments and row expressions can evaluate to the universal Null
    // sentinel. Their non-null arm remains runtime-authoritative.
    if matches!(actual, StaticType::Optional(_) | StaticType::Row(_)) {
        return None;
    }
    let actual = unwrap_static_type(actual);
    let expected = unwrap_column_type(expected);
    if matches!(actual, StaticType::Null) {
        return Some(true);
    }
    if matches!(actual, StaticType::Unknown | StaticType::Json) {
        return None;
    }
    if matches!(actual, StaticType::Int | StaticType::Decimal)
        && matches!(
            expected,
            ColumnType::Int
                | ColumnType::Time
                | ColumnType::Decimal { .. }
                | ColumnType::Money { .. }
        )
    {
        return Some(true);
    }
    matches_static_column(actual, expected)
}

fn static_cursor_kind(value: &StaticType) -> &'static str {
    match unwrap_static_type(value) {
        StaticType::WireId | StaticType::Id | StaticType::Principal | StaticType::Ref(_) => "Id",
        StaticType::Text | StaticType::Enum => "String",
        StaticType::Int | StaticType::Decimal => "Int",
        StaticType::Bool => "Bool",
        StaticType::Bytes => "Bytes",
        StaticType::Asset(_) => "asset",
        StaticType::Null => "Null",
        StaticType::Row(_) | StaticType::Object => "object",
        StaticType::List { .. } => "array",
        StaticType::Unknown | StaticType::Json => "unknown",
        StaticType::Cursor => "Cursor",
        StaticType::Optional(_) => unreachable!("static cursor types are unwrapped"),
    }
}

fn cursor_column_kind(value: &ColumnType) -> &'static str {
    match unwrap_column_type(value) {
        ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. } => "Id",
        ColumnType::Text { .. } | ColumnType::Enum { .. } => "String",
        ColumnType::Int
        | ColumnType::Time
        | ColumnType::Decimal { .. }
        | ColumnType::Money { .. } => "Int",
        ColumnType::Bool => "Bool",
        ColumnType::Bytes { .. } => "Bytes",
        ColumnType::Image { .. } | ColumnType::Video { .. } => "a non-indexable asset",
        ColumnType::Json { .. } | ColumnType::List { .. } => "an indexable scalar",
        ColumnType::Optional(_) => unreachable!("cursor column types are unwrapped"),
    }
}

fn cursor_tuple_rewrite(scan: &Scan, bound: &str, columns: &[String]) -> String {
    let tuple = columns
        .iter()
        .map(|column| format!("lastRow.{column}"))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "carry the last returned row and set {bound}: [{tuple}] when scanning {}.{}",
        scan.table, scan.index
    )
}
