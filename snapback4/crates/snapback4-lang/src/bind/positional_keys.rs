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
            let expected = if index.computed.contains_key(column) { Ty::Int }
                else if column == "id" { Ty::Ref(read.table.clone()) }
                else { info.columns.get(column).map(Ty::from_scalar).unwrap_or(Ty::Unknown) };
            ty.comparable(&expected) || (!ty.is_optional() && matches!((ty.required(),expected.required()),(Ty::Row(a)|Ty::WriteRow(a),Ty::Ref(b)) if a==b)) || (*literal && expected.is_identity())
        })).collect()
}

pub(super) fn refusal(info: &TableInfo, read: &ReadExpr, candidates: &[&IndexDecl], catalog: &Catalog) -> Diagnostic {
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
