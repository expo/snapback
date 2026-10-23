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

/// Complete enforcing-key identity, shared by registration and preparation.
/// Opaque contracts are compared intact; only typed plain-column identities
/// may be aligned. Printed calendar/function names are not their meaning.
pub(super) fn same_key(
    before: &Schema, after: &Schema, table: &str,
    old: &ast::IndexDecl, next: &ast::IndexDecl,
    columns: &BTreeMap<String, String>,
) -> bool {
    let (Some(old), Some(next)) = (
        before.table(table).and_then(|t| t.index(&old.name)),
        after.table(table).and_then(|t| t.index(&next.name)),
    ) else { return false };
    let mut next = next.clone();
    for component in &mut next.components {
        if let IndexComponent::Column(column) = component {
            if let Some(prior) = columns.get(column) { *column = prior.clone(); }
        }
    }
    old == &next
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

/// Align comparison metadata only; never change authored executable source.
/// Both preparation and CLI admission must see the same declared identities.
pub fn align_current_schema(
    view: &Schema, view_sources: &[(String,String)],
    current: &Schema, current_sources: &[(String,String)],
    table_names: &BTreeMap<String,String>,
) -> Result<Schema,String> {
    let current=current.with_table_names(table_names).map_err(|e|e.to_string())?;
    let view_docs=view_sources.iter().map(|(f,t)|crate::parser::parse_document(f,t).0).collect::<Vec<_>>();
    let current_docs=current_sources.iter().map(|(f,t)|crate::parser::parse_document(f,t).0).collect::<Vec<_>>();
    let mut columns=BTreeMap::new();
    for name in view.tables.keys() {if let Some(next)=current.table(name) {
        let prior=view_docs.iter().flat_map(|d|&d.tables).find(|t|&t.name==name);
        let authored=current_docs.iter().flat_map(|d|&d.tables).find(|t|table_names.get(&t.name).unwrap_or(&t.name)==name);
        if let(Some(prior),Some(authored))=(prior,authored) {
            let map=column_names(prior,authored).ok_or_else(||format!("unambiguous declared column identities required on {name}"))?;
            if next.columns.keys().map(|c|map.get(c).unwrap_or(c)).collect::<BTreeSet<_>>().len()!=next.columns.len() {
                return Err(format!("cannot merge independent column identities on {name}"));
            }
            if !map.is_empty(){columns.insert(name.clone(),map);}
        }
    }}
    Ok(current.with_column_names(&columns))
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

/// Retain every named dependency, without introducing an unused duplicate
/// unique key that changes an otherwise unambiguous positional point lookup.
pub(super) fn prune_unused_equivalent_keys(sources: &mut [(String, String)], current: &[(String, String)], changes: &mut Vec<String>) {
    let mut docs=sources.iter().map(|(f,t)|crate::parser::parse_document(f,t).0).collect::<Vec<_>>();
    let current=current.iter().map(|(f,t)|crate::parser::parse_document(f,t).0).collect::<Vec<_>>();
    let mut used=BTreeSet::new();
    let mut visit=|value:&mut ast::Expr|match value {
        ast::Expr::Read(read)|ast::Expr::Exists{read,..}|ast::Expr::Created{read,..}=>{
            if let Some(index)=&read.index {used.insert((read.table.clone(),index.clone()));}
        }
        ast::Expr::Merge(merge)=>{used.insert((merge.table.clone(),merge.index.clone()));}
        _=>{}
    };
    for doc in &mut docs {
        crate::bind::intent_walk::document(doc,&mut visit);
        for table in &mut doc.tables {
            for rule in &mut table.rules {crate::bind::intent_walk::expression(&mut rule.value,&mut visit);}
            for value in table.column_read_values_mut() {crate::bind::intent_walk::expression(value,&mut visit);}
            for column in &mut table.columns {
                if let Some(value)=&mut column.default {crate::bind::intent_walk::expression(value,&mut visit);}
                if let Some(value)=column.maintained.as_mut().and_then(|m|m.filter.as_mut()) {crate::bind::intent_walk::expression(value,&mut visit);}
            }
            for(value,_)in &mut table.final_exists {crate::bind::intent_walk::expression(value,&mut visit);}
            for index in &mut table.indexes {for value in index.computed.values_mut(){crate::bind::intent_walk::expression(value,&mut visit);}}
        }
        for invariant in &mut doc.invariants {crate::bind::intent_walk::expression(&mut invariant.value,&mut visit);}
        for maintain in &mut doc.maintains {
            for value in &mut maintain.keys {crate::bind::intent_walk::expression(value,&mut visit);}
            if let Some(value)=&mut maintain.filter {crate::bind::intent_walk::expression(value,&mut visit);}
            if let Some(rule)=&mut maintain.read {crate::bind::intent_walk::expression(&mut rule.value,&mut visit);}
        }
        for timeline in &mut doc.timelines {if let Some(value)=&mut timeline.filter {crate::bind::intent_walk::expression(value,&mut visit);}}
        for view in &mut doc.views {for branch in &mut view.branches {
            if let Some(value)=&mut branch.predicate {crate::bind::intent_walk::expression(value,&mut visit);}
            for field in &mut branch.fields {if let ast::ShapeField::Field{value,..}=field{crate::bind::intent_walk::expression(value,&mut visit);}}
        }}
        for view in &mut doc.feed_views {crate::bind::intent_walk::expression(&mut view.predicate,&mut visit);}
        for action in &mut doc.actions {crate::bind::intent_walk::expression(&mut action.rule,&mut visit);}
        for arg in doc.programs.iter_mut().flat_map(|p|&mut p.args)
            .chain(doc.functions.iter_mut().flat_map(|f|&mut f.args))
            .chain(doc.actions.iter_mut().flat_map(|a|&mut a.args)) {
            if let Some(value)=&mut arg.default {crate::bind::intent_walk::expression(value,&mut visit);}
        }
    }
    for doc in &docs {for table in &doc.tables {
        if let Some((_,ast::SyncOrder::Index(index)))=table.sync.as_ref().and_then(|s|s.horizon.as_ref()) {
            used.insert((table.name.clone(),index.clone()));
        }
    }}
    for ((_,text),doc) in sources.iter_mut().zip(&docs) {
        let mut edits=Vec::new();
        for table in &doc.tables {
            let mut groups=BTreeMap::<Vec<String>,Vec<&ast::IndexDecl>>::new();
            for index in table.indexes.iter().filter(|i|i.unique&&i.is_plain()) {groups.entry(index.columns.clone()).or_default().push(index);}
            for group in groups.values().filter(|g|g.len()>1) {
                let named=group.iter().filter(|i|used.contains(&(table.name.clone(),i.name.clone()))).collect::<Vec<_>>();
                let preferred=current.iter().flat_map(|d|&d.tables)
                    .filter(|t|t.name==table.name||t.renamed_from.as_ref()==Some(&table.name)||table.renamed_from.as_ref()==Some(&t.name))
                    .flat_map(|t|&t.indexes).find_map(|i|group.iter().find(|old|old.name==i.name));
                let keep=preferred.unwrap_or(&group[0]);
                for index in group {
                    if used.contains(&(table.name.clone(),index.name.clone())) || (named.is_empty()&&index.name==keep.name) {continue}
                    let start=text.split_inclusive('\n').take(index.site.line.saturating_sub(1)as usize).map(str::len).sum::<usize>();
                    let end=text[start..].find('\n').map_or(text.len(),|n|start+n+1);
                    edits.push((start,end));
                    changes.push(format!("{}: omitted unused equivalent unique index {}; the identical ordered key remains enforced",table.name,index.name));
                }
            }
        }
        edits.sort_by_key(|edit|std::cmp::Reverse(edit.0));
        for(start,end)in edits {text.replace_range(start..end,"");}
    }
}
