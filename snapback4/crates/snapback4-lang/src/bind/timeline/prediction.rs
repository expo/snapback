//! Only event-changing writes fence a synced event aggregate. Unknown insert
//! filters and deletes need their actual source witness, so the runtime decides.
// @ref LLP 3000.016#2.1a — replies and ordinary edits do not change owned events.
use snapback4_core::{Value, ir::{Expr, Program, Stmt}, schema::{Execution, ResidencySite, Schema, SiteClass, timeline::Timeline}};
use std::collections::{BTreeMap, BTreeSet};

type Constants = BTreeMap<String, Expr>;

pub(crate) fn aggregate_sites(schema: &Schema, program: &Program, fact: &mut Execution) {
    walk(schema, &program.body, &mut Constants::new(), false, fact);
}

fn resolve<'a>(value: &'a Expr, constants: &'a Constants) -> &'a Expr {
    // Only immutable constants are recorded, resolved at their declaration.
    if let Expr::Variable(name) = value { constants.get(name).unwrap_or(value) } else { value }
}

fn insertion(t: &Timeline, schema: &Schema, repost: bool, row: &Expr, constants: &Constants) -> Option<SiteClass> {
    if repost { return Some(SiteClass::Server); }
    let Expr::Object(fields) = resolve(row, constants) else { return Some(SiteClass::Horizon); };
    let mut needed = BTreeSet::new();
    if let Some(filter) = &t.filter { filter.fields(&mut needed); }
    if !t.posts[3].is_empty() { needed.insert(t.posts[3].clone()); }
    let mut image = BTreeMap::new();
    for field in needed {
        let value = match fields.get(&field).map(|v| resolve(v, constants)) {
            Some(Expr::Literal(value)) => value.clone(),
            None if schema.tables[&t.posts[0]].columns[&field].is_optional() => Value::Null,
            _ => return Some(SiteClass::Horizon),
        };
        image.insert(field, value);
    }
    let row = Value::Row(image.into());
    let live = row.field(&t.posts[3]).ok() != Some(&Value::Bool(true)) && t.filter.as_ref().is_none_or(|p| p.matches(&row));
    live.then_some(SiteClass::Server)
}

fn add(schema: &Schema, table: &str, kind: &str, value: Option<&Expr>, constants: &Constants, fact: &mut Execution) {
    for t in schema.timelines.iter().filter(|t| table == t.posts[0] || table == t.reposts[0]) {
        let repost = table == t.reposts[0];
        if t.fully_synced(schema, repost) { continue; }
        let class = match kind {
            "insert" => insertion(t, schema, repost, value.unwrap(), constants),
            "update" if repost || t.posts[3].is_empty() => None,
            "update" => match resolve(value.unwrap(), constants) {
                Expr::Object(fields) if !fields.contains_key(&t.posts[3]) => None,
                Expr::Object(fields) if matches!(fields.get(&t.posts[3]).map(|v| resolve(v, constants)), Some(Expr::Literal(Value::Bool(false)))) => None,
                _ => Some(SiteClass::Server),
            },
            // Upsert may update a harmless field or insert a filtered-out row;
            // unrepost may find no row. The transition guard uses the witness.
            _ => Some(SiteClass::Horizon),
        };
        let Some(class) = class else { continue; };
        for aggregate in t.synced_aggregates(schema) {
            fact.sites.push(ResidencySite { site: format!("{kind} {table}: {aggregate}"), table: aggregate.into(), index: "byGroup".into(),
                kind: "timeline aggregate".into(), class: class.clone(),
                reason: format!("Following {} queues if this write changes a partial event in synced aggregate {aggregate}{}", t.name,
                    if class == SiteClass::Horizon { "; the runtime checks the source slot and insert filter" } else { "" }),
                rewrite: format!("queue this mutation without predicted rows, or declare view {aggregate} online only") });
        }
    }
}

fn walk(schema: &Schema, body: &[Stmt], constants: &mut Constants, conditional: bool, fact: &mut Execution) {
    for stmt in body {
        let first_site = fact.sites.len();
        match stmt {
            Stmt::Const { name, value } => {
                // Mutable variables and nested evaluation stay unknown. Retain
                // object shape without pretending their field values are known.
                let value = resolve(value, constants).clone();
                constants.insert(name.clone(), value);
            }
            Stmt::Insert { table, row } | Stmt::InsertIfAbsent { table, row, .. } => add(schema, table, "insert", Some(row), constants, fact),
            Stmt::Update { table, patch, .. } => add(schema, table, "update", Some(patch), constants, fact),
            Stmt::Upsert { table, row, .. } => add(schema, table, "upsert", Some(row), constants, fact),
            Stmt::WriteTarget { target, patch, upsert, .. } => add(schema, &target.table, if *upsert { "upsert" } else { "update" }, Some(patch), constants, fact),
            Stmt::Delete { table, .. } => add(schema, table, "delete", None, constants, fact),
            Stmt::DeleteTarget { target } => add(schema, &target.table, "delete", None, constants, fact),
            Stmt::If { then_body, else_body, .. } => { walk(schema, then_body, &mut constants.clone(), true, fact); walk(schema, else_body, &mut constants.clone(), true, fact); }
            Stmt::For { body, .. } => walk(schema, body, &mut constants.clone(), true, fact),
            _ => {}
        }
        if conditional {
            for site in &mut fact.sites[first_site..] {
                if site.class == SiteClass::Server {
                    site.class = SiteClass::Horizon;
                    site.reason.push_str("; the runtime checks whether this branch changes an event");
                }
            }
        }
    }
}
