//! Admission of replica-independent unique point keys. Populations and
//! maintained null groups have their own semantics.
use super::catalog::TableInfo;
use crate::{ast::{IndexDecl, ReadExpr}, Diagnostic};

// Arguments remain in authored order, with the binder's normalized column
// names and presence facts (including control-flow narrowing).
pub(super) fn check(table: &TableInfo, index: &IndexDecl, read: &ReadExpr, arguments: &[(Option<&str>, bool)], rule: bool) -> Result<(), Diagnostic> {
    // @ref LLP 3000.013#2.2 — the complete maintained group is unique even with nulls.
    // Extra predicates (such as value = 1) may use a secondary access index.
    // A partial group or a value-only key must still pass ordinary admission.
    if table.maintained.is_some() && table.indexes.iter().any(|key| key.name == "byGroup"
        && key.columns.iter().all(|column| index.columns.contains(column) && !index.computed.contains_key(column))) {
        return Ok(());
    }
    // @ref LLP 3000.013#2.2 — a fully pinned superset of a required unique key is itself unique.
    // Preserve role-bearing rule/postcondition indexes without adding a
    // redundant uniqueness constraint or changing their physical selection.
    let unique = index.unique || table.indexes.iter().any(|key| table.total_unique(key)
        && key.columns.iter().all(|column| index.columns.contains(column) && !index.computed.contains_key(column)));
    if !unique {
        let repair = if rule {
            "declare a non-null unique key for this probe; table rules cannot scan a population, so move population work into a query or mutation before storing the fact the rule tests"
        } else {
            "use a bounded population read (`where … first N`) or declare a non-null unique key"
        };
        return Err(Diagnostic::new(&read.site, "E_QUARRY_POINT_KEY",
            format!("{}.{} is not unique: a point probe can choose different tied rows across replicas, even with non-null arguments", read.table, index.name),
            repair).guide("indexes"));
    }
    if !index.unique || table.maintained.is_some() { return Ok(()); }
    let named = arguments.iter().all(|(column, _)| column.is_some());
    let mut guards = Vec::new();
    let mut nulls = Vec::new();
    for (position, (column, present)) in arguments.iter().enumerate() {
        let column = if named { column.unwrap() } else { index.columns[position].as_str() };
        if index.columns.iter().any(|key| key == column) && !index.computed.contains_key(column)
            && table.columns.get(column).is_some_and(|ty| ty.optional) && !present {
            if matches!(&read.keys[position].value, crate::ast::Expr::Literal { value: crate::ast::Literal::Null, .. }) { nulls.push(column); }
            else { guards.push(column); }
        }
    }
    if guards.is_empty() && nulls.is_empty() { return Ok(()); }
    // @ref LLP 3000.013#2.2 — null ties have no replica-independent point;
    // require proof of presence without changing total population equality.
    let mut advice = Vec::new();
    if !nulls.is_empty() { advice.push(format!("replace literal null with a non-null value for {}", nulls.join(", "))); }
    if !guards.is_empty() {
        advice.push(format!("prove non-null arguments for {} with required types or presence guards", guards.join(", ")));
    }
    // Recovery choices are design advice. Do not print a source edit without
    // a context proof (a population can need a different index or bound).
    Err(Diagnostic::new(&read.site, "E_QUARRY_NULL_KEY",
        format!("{}.{} is a nullable unique key: a null argument can tie several rows; a point is ambiguous across replicas because each device may hold different tied rows. {}; alternatively read a bounded population or key the row by id (guide indexes)", read.table, index.name, advice.join("; ")),
        "").guide("indexes"))
}
