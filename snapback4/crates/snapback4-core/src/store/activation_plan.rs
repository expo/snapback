//! Reuse physical state whose complete interpretation has not changed.
use crate::schema::Schema;
use std::collections::{BTreeMap, BTreeSet};

pub(super) struct Plan {
    pub project: bool,
    pub indexes: BTreeSet<String>,
}

// @ref LLP 3000.019#3.6 — an added view must not reconstruct unrelated rows and indexes.
// Compare the whole table except indexes. This intentionally keeps the old
// exhaustive validation for defaults, captures, rules, lifetimes and constraints.
// An index can survive an unrelated column change only when each interpreted
// dependency (including calendar, words and contribution predicates) is equal.
// Device installations have no persisted server predecessor and keep that path.
pub(super) fn plans(next: &Schema, previous: Option<&Schema>) -> BTreeMap<String, Plan> {
    next.tables
        .iter()
        .map(|(name, table)| {
            let old = previous.and_then(|schema| schema.table(name));
            let project = old.is_none_or(|old| {
                let mut comparable = table.clone();
                comparable.indexes = old.indexes.clone();
                &comparable != old
            });
            let indexes = table
                .indexes
                .iter()
                .filter(|(index_name, index)| {
                    old.is_none_or(|old| {
                        old.indexes.get(*index_name) != Some(*index)
                            || old.through != table.through
                            || old.columns.keys().chain(table.columns.keys()).any(|field| {
                                index.uses_column(field)
                                    && (crate::successor::interpretation(
                                        previous.unwrap(),
                                        name,
                                        field,
                                    ) != crate::successor::interpretation(next, name, field)
                                        || old.maintained.get(field) != table.maintained.get(field))
                            })
                    })
                })
                .map(|(name, _)| name.clone())
                .collect();
            (name.clone(), Plan { project, indexes })
        })
        .collect()
}

/// Historical catalog numbers remain, but inactive names lose their rows/keys.
pub(super) fn active_names(schema: &Schema) -> BTreeSet<String> {
    schema.tables.iter().filter(|(_, t)| t.ephemeral.is_none())
        .flat_map(|(name, table)| std::iter::once(name.clone())
            .chain(table.indexes.keys().map(move |index| format!("{name}.{index}"))))
        .collect()
}
