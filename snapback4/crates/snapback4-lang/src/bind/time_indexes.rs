//! Computed index keys are positions, not columns in the table's row type.
use crate::ast::{Expr, ScalarType, TypeKind};
use crate::diag::{Fallible, type_error};
use snapback4_core::maintain::CalendarKey;
use std::collections::BTreeMap;

// @ref LLP 3000.007#21.6 — time functions are index components at any position, sharing maintain argument rules and ordinals.
pub(super) fn key(table: &str, columns: &BTreeMap<String, ScalarType>, function: &str, expr: &Expr) -> Fallible<CalendarKey> {
    let Expr::Call { name, args, site } = expr else {
        return Err(type_error(expr.site(), "a time index component is one day, hour or bucket call, not a computed expression", "day(at), hour(at, 30m), or bucket(at, 2h, 30m); declare at: time on this table").guide("indexes"));
    };
    let form = |column: &str| if function == "bucket" { format!("bucket({column}, 2h)") } else { format!("{function}({column})") };
    if columns.contains_key(function) {
        return Err(type_error(site, format!("{table} has a column named {function}, which collides with the computed index key"), format!("rename column {function} before declaring {}", form("at"))).guide("indexes"));
    }
    let (millis, offset) = super::maintains::calendar(name, args, site).map_err(|error| type_error(&error.site, error.message, error.rewrite).guide("indexes"))?;
    let column = match &args[0] {
        Expr::Name { name, .. } => name,
        _ => return Err(type_error(args[0].site(), format!("{function} index key needs a required time column of {table}"), format!("{}  -- declare at: time on {table}", form("at"))).guide("indexes")),
    };
    if columns.get(column) != Some(&ScalarType { kind: TypeKind::Time, optional: false }) {
        return Err(type_error(args[0].site(), format!("{table}.{column} must be a required time column for {function}"), format!("{column}: time  -- on {table}; use {} only in the index", form(column))).guide("indexes"));
    }
    Ok(CalendarKey { function: function.into(), column: column.clone(), millis, offset })
}
