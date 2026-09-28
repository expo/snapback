//! Developer source coordinates and static first-membership guidance.
use super::catalog::Catalog;
use crate::{Diagnostic, ast};
use snapback4_core::schema::{Schema, RuleExpr, RuleTerm};
use std::collections::BTreeMap;

pub(super) fn sites(catalog: &Catalog) -> BTreeMap<(String, String), String> {
    let mut out = BTreeMap::new();
    for (name, info) in &catalog.tables {
        out.insert((name.clone(), "table".into()), info.decl.site.to_string());
        for rule in &info.decl.rules {
            out.insert((name.clone(), format!("{} rule", rule.effect.word())), rule.site.to_string());
        }
        for col in &info.decl.columns {
            if col.sequence.is_some() { out.insert((name.clone(), "sequence read authority".into()), col.site.to_string()); }
        }
        for index in &info.indexes { out.insert((name.clone(), format!("unique {}", index.columns.join(", "))), index.site.to_string()); }
        for cap in &info.decl.caps { out.insert((name.clone(), format!("cap {}", cap.by.join(", "))), cap.site.to_string()); }
    }
    out
}

// @ref LLP 3000.015#2.1 — created parent identity is not a proof about its shared counter.
pub(super) fn sequence_notes(catalog: &Catalog, schema: &Schema) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    for (name, info) in &catalog.tables {
        let Some(table) = schema.table(name) else { continue };
        let RuleExpr::Exists { table: witness, key, .. } = &table.rules.read else { continue };
        if witness != name || !key.contains(&RuleTerm::Viewer) { continue; }
        for column in info.decl.columns.iter().filter(|col| col.sequence.is_some()) {
            let reference = column.sequence.as_ref().unwrap();
            if !key.contains(&RuleTerm::Field(reference.clone())) { continue; }
            let Some(ast::ScalarType { kind: ast::TypeKind::Ref { table: parent }, .. }) = info.columns.get(reference) else { continue };
            out.push(Diagnostic::new(&column.site, "N_SEQUENCE_READ",
                format!("{}.{}: the first membership in an empty {} group always refuses E_RULE: sequence read authority requires `{}` before this row is inserted. `created {parent}[.{reference}]` can admit the insert rule but cannot establish that read authority or a fresh shared counter", name, column.name, reference, table.rules.read.quarry()),
                format!("preserve this membership audience with the manual allocator in `guide sequences`: use `{}: int` on {name}, `lastOrdinal: int default 0` on {parent}; seed the new parent's memberships with {}: 0, set later joins from the readable parent's lastOrdinal, and increment that field atomically on each message insert. Keep the message ordinal an int and unique by ({reference}, ordinal).", column.name, column.name)).guide("sequences"));
        }
    }
    out
}
