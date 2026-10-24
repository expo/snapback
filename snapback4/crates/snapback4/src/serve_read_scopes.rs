//! Conservative audience dependencies from public query inputs, never hidden rows.
//! @ref LLP 3000.023#10 — server and composed answers retain their audience scope.
use snapback4_core::{Context, Engine, ir::{self, Expr, Input, IndexKeyExpr}, schema::{Audience, Schema}, value::Value, wire};
use serde_json::{Value as Json, Map};
use std::collections::{BTreeMap, BTreeSet};

type Columns = BTreeMap<String, Json>;

/// Read every branch, not just the executed one: metadata cannot disclose which
/// hidden point/rule succeeded. Only literal, viewer and unshadowed argument
/// prefixes narrow a scope. Other selectors deliberately match the whole table.
pub(super) fn dependencies(engine: &Engine, name: &str, context: &Context) -> Option<Json> {
    let program = engine.program(name)?;
    if program.native { return None; }
    let schema = engine.schema();
    let sites = ir::read_sites(program);
    // With no replicated table there is no audience to narrow. Initial read
    // sites plus one unscoped rule/maintain visit per table bound the old walk;
    // retain that walk when it could reach its conservative exhaustion cut.
    if sites.len().saturating_add(schema.tables.len()) <= 128
        && schema.tables.values().all(|table| table.sync.is_none())
        && sites.iter().all(|site| schema.table(&site.table).is_some())
    {
        return Some(Json::Object(Map::new()));
    }
    let mut shadowed = BTreeSet::new();
    // IR bindings (including merge/loop bindings) can shadow an input anywhere.
    // A conservative syntactic collection needs no second Quarry evaluator.
    fn bindings(value: &Json, out: &mut BTreeSet<String>) {
        match value {
            Json::Object(map) => for (key, value) in map {
                if ["name", "binding", "target"].contains(&key.as_str()) {
                    if let Some(name) = value.as_str() { out.insert(name.into()); }
                }
                bindings(value, out);
            },
            Json::Array(items) => for item in items { bindings(item, out); },
            _ => (),
        }
    }
    bindings(&serde_json::to_value(&program.body).ok()?, &mut shadowed);
    let input = |expr: &Expr| -> Option<Json> {
        match expr {
            Expr::Literal(value) => Some(wire::to_json(value)),
            Expr::Input(Input::Viewer) => Some(Json::String(context.viewer.clone())),
            Expr::Variable(name) if !shadowed.contains(name) => context.args.get(name).map(wire::to_json),
            _ => None,
        }
    };
    let scans = ir::scans(program);
    let mut pending = Vec::new();
    for site in sites {
        let mut columns = Columns::new();
        if site.kind == "scan" {
            if let Some(scan) = scans.iter().find(|scan| scan.site == site.site) {
                if let Some(index) = schema.table(&site.table).and_then(|table| table.index(&site.index)) {
                    for (part, expr) in index.components.iter().zip(&scan.prefix) {
                        if let (Some(column), IndexKeyExpr::Scalar(expr)) = (part.column(), expr) {
                            if let Some(value) = input(expr) { columns.insert(column.clone(), value); }
                        }
                    }
                }
            }
        }
        pending.push((site.table, columns));
    }
    let mut result = Map::new();
    let mut visited = BTreeSet::new();
    while let Some((name, columns)) = pending.pop() {
        if !visited.insert((name.clone(), serde_json::to_string(&columns).ok()?)) { continue; }
        // Supplemental metadata is optional; exhaustion widens, never truncates.
        if visited.len() > 128 { return None; }
        let table = schema.table(&name)?;
        if let Some(sync) = &table.sync {
            let prefix = match &sync.audience {
                Audience::Column(column) => vec![column.clone()],
                Audience::Target { prefix, .. } => prefix.clone(),
                Audience::Public => Vec::new(),
            };
            let group: Map<_, _> = prefix.iter().enumerate().filter_map(|(position, column)|
                columns.get(column).map(|value| (position.to_string(), value.clone()))).collect();
            let entries = result.entry(name.clone()).or_insert_with(|| Json::Array(Vec::new())).as_array_mut()?;
            let group = Json::Object(group);
            if !entries.contains(&group) { entries.push(group); }
        }
        let mut probes = Vec::new();
        snapback4_core::engine::rules::probe_sites(&table.rules.read, &mut probes);
        for (target, index) in probes {
            let mut keys = Columns::new();
            // The validated audience inversion maps the SAME public group into
            // its membership table. Other rule dependencies remain unscoped.
            if let Some(sync) = &table.sync {
                if let Audience::Target { table: audience, prefix, .. } = &sync.audience {
                    if let Ok(binding) = snapback4_core::schema::audience_binding(schema, &name, table, sync) {
                        if audience == &target && binding.group_index == index {
                            for (source, target) in prefix.iter().zip(&binding.columns) {
                                if let Some(value) = columns.get(source) { keys.insert(target.clone(), value.clone()); }
                            }
                            keys.insert(binding.principal, wire::to_json(&Value::Id(context.viewer.clone())));
                        }
                    }
                }
            }
            pending.push((target, keys));
        }
        // Derived storage can depend on source audiences beyond its own rule.
        if let Some(maintain) = schema.maintain_for(&name) { pending.push((maintain.source.clone(), Columns::new())); }
    }
    let result = Json::Object(result);
    (serde_json::to_vec(&result).ok()?.len() <= 16_384).then_some(result)
}

/// Any runtime dependency not covered by the public plan stays conservative.
pub(super) fn complete(mut scopes: Option<Json>, schema: &Schema, tables: &[String]) -> Option<Json> {
    if let Some(Json::Object(map)) = &mut scopes {
        for name in tables {
            if schema.table(name).is_some_and(|table| table.sync.is_some()) {
                map.entry(name.clone()).or_insert_with(|| serde_json::json!([{}]));
            }
        }
    }
    scopes.filter(|value| value.as_object().is_some_and(|map| map.len() <= 128)
        && serde_json::to_vec(value).is_ok_and(|bytes| bytes.len() <= 16_384))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine(source: String) -> Engine {
        let bound=snapback4_lang::compile(&[("schema.q".into(),source)]);
        assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
        let schema=serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap();
        let programs:Vec<snapback4_core::Program>=bound.programs.into_iter().map(|p|serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap()).collect();
        Engine::memory(schema,programs).unwrap()
    }
    #[test]
    fn online_only_scopes_are_empty_and_replicated_scopes_remain_conservative() {
        for (mode,expected) in [("online only",serde_json::json!({})),("sync public",serde_json::json!({"notes":[{}]}))] {
            let engine=engine(format!("table notes:\n  room: text <=32\n  read <- allow\n  {mode}\nquery Q(note: notes):\n  return notes[note]\n"));
            assert_eq!(dependencies(&engine,"Q",&Context::new("alice",Default::default())),Some(expected));
        }
    }
    #[test]
    fn online_only_metadata_keeps_the_existing_exhaustion_cut() {
        let mut source="table notes:\n  room: text <=32\n  read <- allow\n  online only\nquery Q():\n".to_string();
        for n in 0..130 {source.push_str(&format!("  p{n} = notes where .room = 'r{n}' first 1 by .id\n"));}
        source.push_str("  return []\n");
        let engine=engine(source);
        assert_eq!(dependencies(&engine,"Q",&Context::new("alice",Default::default())),None);
    }
}
