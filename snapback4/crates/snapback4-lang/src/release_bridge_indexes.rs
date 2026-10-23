//! A current indexed read must not acquire an older index's meaning.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — named read dependencies are part of current execution context.
use crate::ast;
use snapback4_core::{Schema, schema::IndexComponent};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn current_context_needed(
    view: &[ast::Document], current: &[ast::Document],
    view_schema: &Schema, current_schema: &Schema, names: &BTreeMap<String, String>,
) -> bool {
    let Ok(aligned) = current_schema.with_table_names(names) else { return true };
    for next in current.iter().flat_map(|doc| &doc.tables) {
        let name = names.get(&next.name).unwrap_or(&next.name);
        let Some(prior) = view.iter().flat_map(|doc| &doc.tables).find(|table| &table.name == name) else { continue };
        let (Some(before), Some(after)) = (view_schema.table(name), aligned.table(name)) else { continue };
        // Only declared physical column identities are normalized. Never edit
        // business strings, a computed expression, or an opaque token contract.
        let mut columns = BTreeMap::new();
        for column in &next.columns {
            if let Some(old) = column.renamed_from.as_ref().filter(|old| prior.columns.iter().any(|p| &p.name == *old)) {
                if old != &column.name { columns.insert(column.name.clone(), old.clone()); }
            }
        }
        for column in &prior.columns {
            if let Some(old) = column.renamed_from.as_ref().filter(|old| next.columns.iter().any(|p| &p.name == *old)) {
                if !next.columns.iter().any(|p| p.name == column.name) { columns.insert(old.clone(), column.name.clone()); }
            }
        }
        if after.columns.keys().map(|column| columns.get(column).unwrap_or(column)).collect::<BTreeSet<_>>().len() != after.columns.len() {
            return true;
        }
        for declaration in &next.indexes {
            let (Some(actual), Some(expected)) = (before.index(&declaration.name), after.index(&declaration.name)) else { continue };
            // Complex components retain their complete compiled contract. A
            // rename inside one needs the complete current workflow rather
            // than guessed rewrites of its embedded semantics.
            if !expected.is_plain() && columns.keys().any(|column| expected.uses_column(column)) { return true; }
            let mut components = expected.components.clone();
            for component in &mut components {
                if let IndexComponent::Column(column) = component {
                    if let Some(old) = columns.get(column) { *column = old.clone(); }
                }
            }
            if actual.components != components { return true; }
        }
    }
    false
}
