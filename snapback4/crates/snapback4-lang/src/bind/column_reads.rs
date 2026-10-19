//! Column syntax uses the existing read-rule binder and resolved index planner.
// @ref LLP 3000.036#221-surface-and-authority — groups and inline declarations share one payload gate.
use super::{
    catalog::{Catalog, TableInfo},
    schema::bind_rule,
};
use crate::{
    ast::{Effect, RuleDecl},
    diag::{Diagnostic, Site},
};
use snapback4_core::schema::RuleExpr;
use std::collections::BTreeMap;

pub(super) fn refusal(site: &Site, message: impl Into<String>) -> Diagnostic {
    Diagnostic::new(site,"E_COLUMN_READ",message,"keep payload authority on the column; use ordinary public keys for authority, order and derived storage (guide rules)").guide("rules")
}

pub(super) fn bind(
    catalog: &Catalog,
    info: &TableInfo,
    diagnostics: &mut Vec<Diagnostic>,
) -> BTreeMap<String, RuleExpr> {
    let inline = info.decl.columns.iter().filter_map(|c| {
        c.read.as_ref().map(|value| {
            (
                vec![c.name.clone()],
                RuleDecl {
                    effect: Effect::Read,
                    bindings: Vec::new(),
                    value: value.clone(),
                    site: c.site.clone(),
                },
            )
        })
    });
    let mut out = BTreeMap::new();
    for (fields, rule) in inline.chain(info.decl.column_reads.iter().cloned()) {
        let value = match bind_rule(catalog, info, &rule) {
            Ok(rule) => rule,
            Err(error) => {
                diagnostics.push(error);
                continue;
            }
        };
        for field in fields {
            if field == "id" || !info.columns.contains_key(&field) {
                diagnostics.push(refusal(
                    &rule.site,
                    format!(
                        "{}.{} is not an ordinary declared payload column",
                        info.decl.name, field
                    ),
                ));
                continue;
            }
            if out.insert(field.clone(), value.clone()).is_some() {
                diagnostics.push(refusal(
                    &rule.site,
                    format!(
                        "{}.{} has more than one column read rule",
                        info.decl.name, field
                    ),
                ));
            }
        }
    }
    out
}

pub(super) fn notes(schema: &snapback4_core::schema::Schema) -> Vec<Diagnostic> {
    let mut notes = Vec::new();
    for (name, table) in schema.visible_tables() {
        if !table.column_reads.is_empty()
            || schema.maintain_for(name).is_some()
            || table.through.is_some()
        {
            continue;
        }
        let parents: Vec<_> = table
            .columns
            .iter()
            .filter_map(|(field, kind)| match kind {
                snapback4_core::schema::ColumnType::Ref { table: parent } => Some((field, parent)),
                _ => None,
            })
            .collect();
        if let [(field, parent)] = parents.as_slice()
            && table
                .indexes
                .values()
                .any(|i| i.unique && i.columns() == [(*field).clone()])
            && let Some(p) = schema.table(parent)
            && table.rules.read != p.rules.read
            && !table.rules.read.is_uniformly_readable()
        {
            notes.push(Diagnostic::new(&Site::default(),"N_COLUMN_READ",format!("{name} is a one-to-one extension of {parent} with a separate read audience; a field that only narrows visibility can use `field: type read <- policy` on {parent}"),"use a column rule for a private field; keep this table when it represents a separate entity or lifecycle").guide("rule-recipes"));
        }
    }
    notes
}
