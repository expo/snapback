//! Compiler diagnostics describe authored sites, never generated index names.
use super::catalog::{Catalog, TableInfo};
use crate::{ast::IndexDecl, diag::Diagnostic};
use std::collections::BTreeMap;

pub(super) fn authored(catalog: &Catalog, diagnostics: &mut [Diagnostic]) {
    // An identical definition has the same generated name on different tables.
    // Resolve the diagnostic's table before replacing an unqualified name.
    let mut indexes: BTreeMap<&str, Vec<(&TableInfo, &IndexDecl)>> = BTreeMap::new();
    for table in catalog.tables.values() {
        for index in table.indexes.iter().filter(|index| index.name.starts_with("$intent:")) {
            indexes.entry(&index.name).or_default().push((table, index));
        }
    }
    for diagnostic in diagnostics {
        for (name, candidates) in &indexes {
            if !diagnostic.message.contains(name) && !diagnostic.rewrite.contains(name) { continue; }
            let qualified = |table: &TableInfo| format!("{}.{}", table.decl.name, name);
            let by = |table: &TableInfo| format!("{} by {name}", table.decl.name);
            // N_NEVER_COMPLETE spells its page `table[..] by name`.
            let page = |table: &TableInfo| format!("{}[..] by {name}", table.decl.name);
            let selected = candidates.iter().find(|(table, _)| diagnostic.message.contains(&qualified(table)) || diagnostic.message.contains(&by(table)) || diagnostic.message.contains(&page(table)))
                .or_else(|| candidates.iter().find(|(_, index)| index.site == diagnostic.site));
            let description = selected.map(|(table, index)| label(table, index)).unwrap_or_else(|| candidates.iter().map(|(table, index)| label(table, index)).collect::<Vec<_>>().join(" or "));
            if diagnostic.rewrite.contains(name) { diagnostic.mechanical = false; }
            // First replace qualified occurrences individually, even if one
            // diagnostic refers to identical definitions on several tables.
            for (table, index) in candidates {
                let target = label(table, index);
                diagnostic.message = diagnostic.message.replace(&page(table), &format!("{}[..] by {target}", table.decl.name)).replace(&qualified(table), &target).replace(&by(table), &target);
                diagnostic.rewrite = diagnostic.rewrite.replace(&qualified(table), &target);
            }
            diagnostic.message = diagnostic.message.replace(name, &description);
            if diagnostic.rewrite.contains(name) {
                let index = selected.unwrap_or(&candidates[0]).1;
                let order = index.columns.iter().map(|column| format!(".{column}")).collect::<Vec<_>>().join(", ");
                diagnostic.rewrite = diagnostic.rewrite.replace(&format!("by {name}"), &format!("by {order}")).replace(name, &description);
                // A generated name never appeared in source; it cannot be the
                // target of a spelling-only source repair.
                diagnostic.mechanical = false;
            }
        }
    }
}

fn label(table: &TableInfo, index: &IndexDecl) -> String {
    let unique = table.decl.indexes.iter().any(|decl| decl.name == index.name && decl.unique);
    format!("{} on {} ({}) at {}", if unique { "unique declaration" } else { "read or declaration" }, table.decl.name, index.columns.join(", "), index.site)
}
