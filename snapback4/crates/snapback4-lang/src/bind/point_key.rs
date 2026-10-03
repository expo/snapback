//! Admission of replica-independent unique point keys. Populations and
//! maintained null groups have their own semantics and do not enter this check.
use super::catalog::TableInfo;
use crate::{ast::{IndexDecl, ReadExpr}, Diagnostic};

// Arguments remain in authored order, with the binder's normalized column
// names and presence facts (including control-flow narrowing).
pub(super) fn check(table: &TableInfo, index: &IndexDecl, read: &ReadExpr, arguments: &[(Option<&str>, bool)]) -> Result<(), Diagnostic> {
    if !index.unique || table.maintained.is_some() { return Ok(()); }
    let named = arguments.iter().all(|(column, _)| column.is_some());
    let mut guards = Vec::new();
    let mut nulls = Vec::new();
    let mut predicates = Vec::new();
    let mut captures = Vec::new();
    for (position, (column, present)) in arguments.iter().enumerate() {
        let column = if named { column.unwrap() } else { index.columns[position].as_str() };
        let value = crate::print::expression(&read.keys[position].value);
        let population_value = if value.starts_with('.') {
            let local = format!("key{}", position + 1);
            captures.push(format!("{local} = {value}"));
            local
        } else { value.clone() };
        predicates.push(format!(".{column} = {population_value}"));
        if index.columns.iter().any(|key| key == column) && !index.computed.contains_key(column)
            && table.columns.get(column).is_some_and(|ty| ty.optional) && !present {
            if matches!(&read.keys[position].value, crate::ast::Expr::Literal { value: crate::ast::Literal::Null, .. }) { nulls.push(column); }
            else { guards.push(format!("{value} != null")); }
        }
    }
    if guards.is_empty() && nulls.is_empty() { return Ok(()); }
    // @ref LLP 3000.013#2.2 — null ties have no replica-independent point;
    // require proof of presence without changing total population equality.
    let mut advice = Vec::new();
    if !nulls.is_empty() { advice.push(format!("replace literal null with a non-null value for {}", nulls.join(", "))); }
    if !guards.is_empty() {
        let guard = guards.join(" and ");
        advice.push(format!("guard the arguments with `if {guard}:` (in a rule, put `{guard} and` before the probe)"));
    }
    let capture = if captures.is_empty() { String::new() } else { format!("capture {} outside the predicate, then ", captures.join(", ")) };
    Err(Diagnostic::new(&read.site, "E_QUARRY_NULL_KEY",
        format!("{}.{} is a nullable unique key: a null argument can tie several rows; a point is ambiguous across replicas because each device may hold different tied rows", read.table, index.name),
        format!("{}; or {capture}read the population `{} where {} by .id` with a page bound (`first N`) or a cap; or key the row by id: `{}[id]`", advice.join("; "), read.table, predicates.join(" and "), read.table)).guide("indexes"))
}
