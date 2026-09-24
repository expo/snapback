//! Audience indexes follow the exact read probe's column order, never query pin order.
use super::{catalog::TableInfo, intent::column};
use crate::ast::*;
use std::collections::BTreeMap;

pub(super) struct AudienceNeed {
    pub prefix: Vec<String>,
    pub inverse: Option<(String, Vec<String>)>,
}

pub(super) fn need(table: &TableInfo, tables: &BTreeMap<String, TableInfo>) -> AudienceNeed {
    let empty = || AudienceNeed { prefix: Vec::new(), inverse: None };
    let Some(sync) = &table.decl.sync else { return empty(); };
    let rule = table.decl.rules.iter().find(|rule| rule.effect == Effect::Read).map(|rule| &rule.value);
    if let Some(Expr::Exists { read, .. }) = rule && let Some(target) = tables.get(&read.table) {
        let named = read.keys.iter().all(|key| key.column.is_some());
        let candidates: Vec<_> = target.indexes.iter().filter(|index| index.is_plain() && index.columns.len() == read.keys.len()
            && match &read.index {
                Some(name) => index.name == *name,
                None if named => index.unique && index.columns.iter().all(|column| read.keys.iter().any(|key| key.column.as_ref() == Some(column))),
                None => index.unique,
            }).collect();
        if let [index] = candidates.as_slice() {
            let keys: Vec<_> = index.columns.iter().enumerate().filter_map(|(at, column)|
                if named { read.keys.iter().find(|key| key.column.as_ref() == Some(column)) } else { read.keys.get(at) }).collect();
            if matches!(keys.last().map(|key| &key.value), Some(Expr::Name { name, .. }) if name == "viewer") {
                let prefix: Option<Vec<_>> = keys[..keys.len()-1].iter().map(|key| column(&key.value).map(str::to_owned)).collect();
                if let Some(prefix) = prefix {
                    let mut inverse = vec![index.columns.last().unwrap().clone()];
                    inverse.extend(index.columns[..index.columns.len()-1].iter().cloned());
                    return AudienceNeed { prefix, inverse: Some((read.table.clone(), inverse)) };
                }
            }
        }
    }
    let prefix = match &sync.audience {
        SyncAudience::Column(column) => vec![column.clone()],
        SyncAudience::Target { prefix, .. } => prefix.clone(),
        SyncAudience::Inferred { .. } => match rule {
            Some(Expr::Binary { op, left, right, .. }) if op == "=" => [(left.as_ref(), right.as_ref()), (right.as_ref(), left.as_ref())].into_iter()
                .find_map(|(field, viewer)| matches!(viewer, Expr::Name { name, .. } if name == "viewer").then(|| column(field)).flatten()).map(|column| vec![column.into()]).unwrap_or_default(),
            _ => Vec::new(),
        },
        SyncAudience::Public => Vec::new(),
    };
    AudienceNeed { prefix, inverse: None }
}
