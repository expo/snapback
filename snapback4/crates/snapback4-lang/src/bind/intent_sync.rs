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
        .map(|rule| audience_rule(&table.decl.name, table, &rule));
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

/// The read rule as a sync audience: service grants removed, then each
/// same-row `.principal = viewer` disjunct that a self-probe on a total
/// unique key absorbs (the row is its own witness). The core's
/// `sync_audience_rule` makes the same simplification and remains the authority.
// @ref LLP 3000.036.000#3.1 — exact equivalence only; anything else stays a refused union.
pub(super) fn audience_rule(name: &str, info: &TableInfo, rule: &RuleExpr) -> RuleExpr {
    let audience = rule.device_audience_rule().into_owned();
    let terms = audience.disjuncts();
    if terms.len() < 2 { return audience; }
    let absorbs = |disjunct: &RuleExpr, other: &RuleExpr| {
        let (RuleExpr::Eq(RuleTerm::Field(column), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(column))) = disjunct else { return false };
        let RuleExpr::Exists { table, index, key, equalities, .. } = other else { return false };
        let Some(index) = info.indexes.iter().find(|candidate| &candidate.name == index) else { return false };
        table == name && info.total_unique(index) && index.columns.len() == key.len() && index.columns.contains(column)
            && equalities.iter().all(|(field, term)| matches!(term, RuleTerm::Field(source) if source == field) || (field == column && matches!(term, RuleTerm::Viewer)))
            && index.columns.iter().zip(key).all(|(component, term)|
                if component == column { matches!(term, RuleTerm::Viewer) } else { matches!(term, RuleTerm::Field(field) if field == component) })
    };
    let kept: Vec<RuleExpr> = terms.iter().filter(|term| !terms.iter().any(|other| absorbs(term, other))).map(|term| (*term).clone()).collect();
    match kept.len() {
        n if n == terms.len() => audience.clone(),
        1 => kept.into_iter().next().expect("one audience"),
        _ => RuleExpr::Or(kept),
    }
}
