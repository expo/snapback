//! A current indexed read must not acquire an older index's meaning.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — named read dependencies are part of current execution context.
use crate::{ast, lexer};
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
        let Some(columns) = column_names(prior, next) else { return true };
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

/// One injective declared identity map serves both source transport and checks.
pub fn column_names(prior: &ast::TableDecl, next: &ast::TableDecl) -> Option<BTreeMap<String, String>> {
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
    let distinct = next.columns.iter().map(|column| columns.get(&column.name).unwrap_or(&column.name)).collect::<BTreeSet<_>>();
    (distinct.len() == next.columns.len()).then_some(columns)
}

/// Rewrite only plain-key column tokens. Index labels, refusal codes/messages
/// and every other literal retain their current authored spelling.
pub(super) fn plain_declaration(file: &str, raw: &str, index: &ast::IndexDecl, prior: &ast::TableDecl, next: &ast::TableDecl) -> String {
    if !index.is_plain() { return raw.into(); }
    let Some(columns) = column_names(prior, next) else { return raw.into() };
    let (tokens, diagnostics) = lexer::lex(file, raw);
    if !diagnostics.is_empty() { return raw.into(); }
    let Some(keyword) = tokens.iter().position(|token| matches!(token.value.as_str(), "by" | "unique")) else { return raw.into() };
    let mut cursor = keyword + 1;
    if tokens.get(cursor + 1).is_some_and(|token| token.value == ":") { cursor += 2; }
    let mut edits = Vec::new();
    for (ordinal, column) in index.columns.iter().enumerate() {
        let Some(token) = tokens.get(cursor).filter(|token| &token.value == column) else { return raw.into() };
        if let Some(old) = columns.get(column) {
            let start = raw.split_inclusive('\n').take(token.site.line.saturating_sub(1) as usize).map(str::len).sum::<usize>();
            let start = start + raw[start..].chars().take(token.site.col.saturating_sub(1) as usize).map(char::len_utf8).sum::<usize>();
            edits.push((start, start + token.value.len(), old.clone()));
        }
        cursor += 1;
        if ordinal + 1 < index.columns.len() {
            if !tokens.get(cursor).is_some_and(|token| token.value == ",") { return raw.into(); }
            cursor += 1;
        }
    }
    let mut source = raw.to_owned();
    edits.sort_by_key(|edit| std::cmp::Reverse(edit.0));
    for (start, end, value) in edits { source.replace_range(start..end, &value); }
    source
}
