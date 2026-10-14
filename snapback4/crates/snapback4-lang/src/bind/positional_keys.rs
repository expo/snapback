//! Shared type-directed positional point selection for programs and rules.
// @ref LLP 3000.013#2.2 — identity wins; otherwise ordered compatible declared keys only.
use super::catalog::{Catalog, TableInfo};
use crate::{ast::{IndexDecl, ReadExpr}, diag::Diagnostic, types::Ty};

pub(super) fn candidates<'a>(info: &'a TableInfo, read: &ReadExpr, types: &[(Ty, bool)], synthesized: &std::collections::BTreeSet<(String, String)>) -> Vec<&'a IndexDecl> {
    let identity = read.index.is_none() && types.len() == 1 &&
        (types[0].0.required() == Ty::Id || types[0].0.required() == Ty::Ref(read.table.clone())
            || (!types[0].0.is_optional() && matches!(types[0].0.required(),Ty::Row(t)|Ty::WriteRow(t) if t==read.table)));
    info.indexes.iter().filter(|index| !synthesized.contains(&(read.table.clone(), index.name.clone())))
        .filter(|index| match &read.index {
            Some(name) => &index.name == name,
            None if identity => index.name == "byId",
            None => index.unique && index.columns.len() == types.len(),
        })
        // Explicit indexes keep their existing mismatch diagnostics and range semantics.
        .filter(|index| read.index.is_some() || types.iter().zip(&index.columns).all(|((ty, literal), column)| {
            compatible(ty, *literal, &column_ty(info, index, column))
        })).collect()
}

fn column_ty(info: &TableInfo, index: &IndexDecl, column: &str) -> Ty {
    if index.computed.contains_key(column) { Ty::Int }
    else if column == "id" { Ty::Ref(info.decl.name.clone()) }
    else { info.columns.get(column).map(Ty::from_scalar).unwrap_or(Ty::Unknown) }
}

fn compatible(ty: &Ty, literal: bool, expected: &Ty) -> bool {
    ty.comparable(expected)
        || (!ty.is_optional() && matches!((ty.required(), expected.required()), (Ty::Row(a) | Ty::WriteRow(a), Ty::Ref(b)) if a == b))
        || (literal && expected.is_identity())
}

pub(super) fn refusal(
    info: &TableInfo,
    read: &ReadExpr,
    types: &[(Ty, bool)],
    candidates: &[&IndexDecl],
    catalog: &Catalog,
) -> Diagnostic {
    // @ref LLP 3000.036.002#9 — lead a wrong-table positional lookup with the foreign reference's actual table.
    if candidates.is_empty() && let Some((position, source)) = types.iter().enumerate().find_map(|(position, (ty, literal))| {
        match ty.required() {
            Ty::Ref(source) | Ty::Row(source) | Ty::WriteRow(source) if source != read.table
                && !info.indexes.iter()
                    .filter(|index| !catalog.synthesized.contains(&(read.table.clone(), index.name.clone())))
                    .filter(|index| read.index.as_ref().is_some_and(|name| name == &index.name)
                        || (read.index.is_none() && index.unique && index.columns.len() == types.len()))
                    .any(|index| index.columns.get(position)
                        .is_some_and(|column| compatible(ty, *literal, &column_ty(info, index, column)))) => Some((position, source)),
            _ => None,
        }
    }) {
        let value = read.keys.get(position).map(|key| crate::print::expression(&key.value)).unwrap_or_else(|| "this value".into());
        let mut expected = info.indexes.iter()
            .filter(|index| !catalog.synthesized.contains(&(read.table.clone(), index.name.clone())))
            .filter(|index| read.index.as_ref().is_some_and(|name| name == &index.name)
                || (read.index.is_none() && index.unique && index.columns.len() == types.len()))
            .filter_map(|index| index.columns.get(position).map(|column| column_ty(info, index, column).name()))
            .collect::<Vec<_>>();
        expected.sort();
        expected.dedup();
        let expected = if expected.is_empty() { "a value accepted by a declared key".into() } else { expected.join(" or ") };
        return Diagnostic::new(
            &read.site,
            "E_QUARRY_POSITIONAL_SCAN",
            format!("`{value}` is a {source} reference, but {} key position {} expects {expected}; a reference from another table cannot select it", read.table, position + 1),
            format!("replace `{value}` with {expected}, and name the intended key columns or choose its index with `by`; if this is a population read, use `{} where .<column> = <value> first 20 by .id`", read.table),
        )
        .guide("reads");
    }
    let alternatives = if candidates.is_empty() && read.index.is_some() {
        info.indexes.iter().filter(|index| !catalog.synthesized.contains(&(read.table.clone(), index.name.clone()))).collect::<Vec<_>>()
    } else { candidates.to_vec() };
    // @ref LLP 3000.036#15.7 — `budgets['general']` (lane 020): a text value names the declared
    // text key far more often than a row id, so that named form leads (and is --fix's choice).
    let mut alternatives = alternatives;
    alternatives.sort_by_key(|index| index.columns.iter().any(|column| column == "id"));
    let mut changes = Vec::new();
    for index in &alternatives {
        // Same-column opposite-order indexes need the explicit name as well.
        let duplicate = info.indexes.iter().any(|other| other.name != index.name && other.unique
            && other.columns.len() == index.columns.len() && other.columns.iter().all(|c| index.columns.contains(c)));
        if read.index.is_none() { changes.push(crate::repair::ReadChange::NamedKey { columns: index.columns.clone(), index: duplicate.then(|| index.name.clone()) }); }
        // Unknown explicit indexes and computed keys retain verified legacy alternatives.
        changes.push(crate::repair::ReadChange::Index(index.name.clone()));
    }
    let message = if alternatives.is_empty() {
        format!("{} has no declared unique key accepting these positional argument types in order; name the key columns, or use where for a population", read.table)
    } else {
        format!("{} positional argument types leave {} candidate keys; name the intended key columns or choose a compatible unique index explicitly", read.table, candidates.len())
    };
    let diagnostic = Diagnostic::new(&read.site, "E_QUARRY_POSITIONAL_SCAN", message, "").guide("reads").repair_read(&read.site, changes);
    // The user explicitly opts into one context-verified choice with --fix.
    if read.index.is_none() && candidates.len() > 1 { diagnostic.mechanical() } else { diagnostic }
}
