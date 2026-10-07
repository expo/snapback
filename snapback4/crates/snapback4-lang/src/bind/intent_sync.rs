//! Audience indexes follow the exact read probe's column order, never query pin order.
use super::catalog::{Catalog, TableInfo};
use crate::ast::*;
use snapback4_core::schema::{RuleExpr, RuleTerm};

pub(super) struct AudienceNeed {
    pub prefix: Vec<String>,
    pub inverse: Option<(String, Vec<String>)>,
}

// @ref LLP 3000.013#2.2 — planning consumes the same admitted rule/index order as sync binding.
pub(super) fn need(table: &TableInfo, catalog: &Catalog) -> AudienceNeed {
    let empty = || AudienceNeed { prefix: Vec::new(), inverse: None };
    let Some(sync) = &table.decl.sync else { return empty(); };
    let rule = table.decl.rules.iter().find(|rule| rule.effect == Effect::Read)
        .and_then(|rule| super::schema::bind_rule(catalog, table, rule).ok())
        .map(|rule| rule.device_audience_rule().into_owned());
    if let Some(RuleExpr::Exists { table: target, index, key, equalities, .. }) = &rule
        && equalities.is_empty() && key.last() == Some(&RuleTerm::Viewer)
        && let Some(index) = catalog.tables.get(target).and_then(|t| t.indexes.iter().find(|i| &i.name == index))
        && index.is_plain() && index.columns.len() == key.len() {
        let prefix = key[..key.len()-1].iter().map(|term| match term {
            RuleTerm::Field(column) => Some(column.clone()), _ => None,
        }).collect::<Option<Vec<_>>>();
        if let Some(prefix) = prefix {
            let mut inverse = vec![index.columns.last().unwrap().clone()];
            inverse.extend(index.columns[..index.columns.len()-1].iter().cloned());
            return AudienceNeed { prefix, inverse: Some((target.clone(), inverse)) };
        }
    }
    let prefix = match &sync.audience {
        SyncAudience::Column(column) => vec![column.clone()],
        SyncAudience::Target { prefix, .. } => prefix.clone(),
        SyncAudience::Inferred { .. } => match &rule {
            Some(RuleExpr::Eq(RuleTerm::Field(column), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(column))) => vec![column.clone()],
            _ => Vec::new(),
        },
        SyncAudience::Public => Vec::new(),
    };
    AudienceNeed { prefix, inverse: None }
}
