//! A positional unique key followed by named tests is named-key sugar.
// @ref LLP 3000.013#2.2 — only declared unique keys resolve positions; extra equalities test one row.
use super::{catalog::{Catalog, TableInfo}, intent_walk as walk};
use crate::{ast::*, diag::{Diagnostic, Fallible, Site}, print};
use std::{borrow::Cow, collections::BTreeMap};

pub(super) fn keys<'a>(table: &TableInfo, parts: &'a [KeyPart], index: Option<&str>, site: &Site, synthesized: &std::collections::BTreeSet<(String, String)>, types: Option<&[(crate::types::Ty, bool)]>) -> Fallible<Cow<'a, [KeyPart]>> {
    if !parts.iter().any(|key| key.column.is_some()) || !parts.iter().any(|key| key.column.is_none()) { return Ok(Cow::Borrowed(parts)); }
    let prefix = parts.iter().take_while(|key| key.column.is_none()).count();
    if let Some(late) = parts[prefix..].iter().find(|key| key.column.is_none()) {
        let ordered = parts.iter().filter(|key| key.column.is_none()).chain(parts.iter().filter(|key| key.column.is_some())).map(spelling).collect::<Vec<_>>().join(", ");
        return Err(Diagnostic::new(&late.site, "E_QUARRY_KEY_ORDER", "positional key components come before named column tests",
            format!("{}[{ordered}]", table.decl.name)).guide("reads"));
    }
    let declared: Vec<_> = table.indexes.iter().filter(|key| key.unique
        && !synthesized.contains(&(table.decl.name.clone(), key.name.clone()))).collect();
    let candidates: Vec<_> = if let Some(types) = types {
        let read = ReadExpr { table: table.decl.name.clone(), keys: parts[..prefix].to_vec(), index: index.map(str::to_owned), site: site.clone(),
            cursor_prefix: None, computed: Default::default(), order_keys: Vec::new(), range: None, matching: None, filter: None, seeks: Vec::new() };
        super::positional_keys::candidates(table, &read, types, synthesized).into_iter()
            .filter(|key| key.unique && key.columns.len() == prefix).collect()
    } else {
        // Before types are known, do not silently turn `roles[viewer,
        // role = 'staff']` into an id lookup merely because byId has the
        // positional prefix's arity. A declared composite key covered by the
        // positional prefix plus named suffix must reach the typed pass, which
        // prints the fully named repair.
        let named: Vec<&str> = parts[prefix..].iter().filter_map(|part| part.column.as_deref()).collect();
        let partial_composite = declared.iter().any(|key| key.columns.len() == parts.len()
            && named.iter().all(|column| key.columns.iter().any(|key_column| key_column == column))
            && index.is_none_or(|name| name == key.name));
        if partial_composite { Vec::new() }
        else { declared.iter().copied().filter(|key| key.columns.len() == prefix && index.is_none_or(|name| name == key.name)).collect() }
    };
    let chosen = match candidates.as_slice() {
        [chosen] if table.total_unique(chosen) => *chosen,
        _ => {
            let suggested = candidates.first().copied().or_else(|| declared.iter().copied().find(|key| key.columns.len() > prefix)).or_else(|| declared.first().copied());
            let descriptions = declared.iter().map(|key| format!("({})", key.columns.join(", "))).collect::<Vec<_>>().join(" or ");
            let rewrite = if let Some(key) = suggested {
                let mut named = key.columns.iter().enumerate().map(|(at, column)| {
                    let value = parts.get(at).filter(|_| at < prefix).map(|part| print::expression(&part.value))
                        .or_else(|| parts.iter().find(|part| part.column.as_ref() == Some(column)).map(|part| print::expression(&part.value)))
                        .unwrap_or_else(|| format!("<{column}>"));
                    format!("{column} = {value}")
                }).collect::<Vec<_>>();
                named.extend(parts[prefix..].iter().filter(|part| !key.columns.contains(part.column.as_ref().unwrap())).map(spelling));
                format!("{}[{}]", table.decl.name, named.join(", "))
            } else { format!("{}[id = <id>, {}]", table.decl.name, parts[prefix..].iter().map(spelling).collect::<Vec<_>>().join(", ")) };
            return Err(Diagnostic::new(site, "E_QUARRY_POSITIONAL_SCAN",
                format!("{} needs one full declared unique key with non-null columns before named tests; {prefix} positional components match {} keys; declared keys: {descriptions}", table.decl.name, candidates.len()), rewrite.clone())
                .source_rewrite(crate::diag::SourceRewriteKind::MixedKey, rewrite).guide("reads"));
        }
    };
    let mut named = parts.to_vec();
    for (part, column) in named.iter_mut().zip(&chosen.columns) { part.column = Some(column.clone()); }
    Ok(Cow::Owned(named))
}

fn spelling(part: &KeyPart) -> String {
    match &part.column { Some(column) => format!("{column} = {}", print::expression(&part.value)), None => print::expression(&part.value) }
}

pub(super) fn read<'a>(table: &TableInfo, read: &'a ReadExpr, catalog: &Catalog) -> Fallible<Cow<'a, ReadExpr>> {
    read_typed(table, read, catalog, None)
}

pub(super) fn read_typed<'a>(table: &TableInfo, read: &'a ReadExpr, catalog: &Catalog, types: Option<&[(crate::types::Ty, bool)]>) -> Fallible<Cow<'a, ReadExpr>> {
    Ok(match keys(table, &read.keys, read.index.as_deref(), &read.site, &catalog.synthesized, types)? {
        Cow::Borrowed(_) => Cow::Borrowed(read),
        Cow::Owned(keys) => {
            let index = types.and_then(|types| super::positional_keys::candidates(table, read, types, &catalog.synthesized)
                .first().map(|index| index.name.clone())).or_else(|| read.index.clone());
            Cow::Owned(ReadExpr { keys, index, ..read.clone() })
        },
    })
}

/// Normalize before planning and sync inference, including helpers and shapes.
/// Invalid keys remain for the ordinary binder to diagnose at their use site.
pub(super) fn normalize(catalog: &mut Catalog) {
    let tables: BTreeMap<_, _> = catalog.tables.clone();
    let mut visit = |value: &mut Expr| {
        let (name, parts, index, site) = match value {
            Expr::Read(read) | Expr::Exists { read, .. } | Expr::Created { read, .. } => (&read.table, &mut read.keys, read.index.as_deref(), &read.site),
            Expr::Write { table, keys, site, .. } => (&*table, keys, None, &*site),
            _ => return,
        };
        if let Some(table) = tables.get(name)
            && let Ok(Cow::Owned(named)) = keys(table, parts, index, site, &catalog.synthesized, None) { *parts = named; }
    };
    for table in catalog.tables.values_mut() {
        for rule in &mut table.decl.rules { walk::expression(&mut rule.value, &mut visit); }
        for (value, _) in &mut table.decl.final_exists { walk::expression(value, &mut visit); }
    }
    for doc in &mut catalog.documents {
        walk::document(doc, &mut visit);
        for view in &mut doc.views { for branch in &mut view.branches {
            if let Some(predicate) = &mut branch.predicate { walk::expression(predicate, &mut visit); }
            walk::shape(&mut branch.fields, &mut visit);
        } }
    }
    catalog.shapes = catalog.documents.iter().flat_map(|doc| doc.shapes.iter().cloned().map(|shape| (shape.name.clone(), shape))).collect();
    catalog.functions = catalog.documents.iter().flat_map(|doc| doc.functions.iter().cloned().map(|function| (function.name.clone(), function))).collect();
}
