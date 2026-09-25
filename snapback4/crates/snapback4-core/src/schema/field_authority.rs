//! Field authority and projection share one schema fact on every host.
// @ref LLP 3000.015#1 — the owner is a principal on this row, not a row update grant.
use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FieldAuthority {
    pub owner: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub audience: bool,
}

impl Table {
    pub fn private_field(&self, field: &str) -> bool {
        self.written_by.get(field).is_some_and(|authority| !authority.audience)
    }

    /// A missing viewer denotes a shared audience image. No defaults are
    /// materialized here: callers project only after interpreting the row.
    pub fn project_fields(&self, row: Value, viewer: Option<&str>) -> Value {
        if self.written_by.is_empty() { return row; }
        let hidden: Vec<_> = self.written_by.iter().filter(|(field, authority)| row.field(field).is_ok() && !authority.audience
            && !viewer.is_some_and(|viewer| row.field(&authority.owner).is_ok_and(|value| value == &Value::Id(viewer.into()))))
            .map(|(field, _)| field.clone()).collect();
        if hidden.is_empty() { return row; }
        // Build only the disclosed image. Removing from a shared map first
        // would clone every hidden payload and expose its size through meters.
        match row {
            Value::Row(fields) => Value::Row(fields.iter().filter(|(key,_)| !hidden.contains(key)).map(|(key,value)|(key.clone(),value.clone())).collect()),
            Value::Map(fields) => Value::Map(fields.iter().filter(|(key,_)| !hidden.contains(key)).map(|(key,value)|(key.clone(),value.clone())).collect()),
            other => other,
        }
    }

    pub fn projection_heap(&self, row: &Value, viewer: &str) -> u64 {
        let hidden = |field: &str| self.written_by.get(field).is_some_and(|a| !a.audience
            && row.field(&a.owner).ok() != Some(&Value::Id(viewer.into())));
        let Ok(fields)=row.as_object() else { return 0; };
        if !fields.keys().any(|field|hidden(field)) { return 0; }
        40 + fields.iter().filter(|(field,_)| !hidden(field)).map(|(field,value)|80 + field.len() as u64 + value.clone_heap_bytes()).sum::<u64>()
    }

    pub fn field_owners(&self, row: &Value) -> BTreeSet<String> {
        self.written_by.values().filter(|a| !a.audience).filter_map(|a|
            row.field(&a.owner).ok().and_then(|v| v.as_str().ok()).map(str::to_owned)).collect()
    }
}

// Private values cannot enter an index key (including cursors), an audience,
// attribution, or a materialized aggregate's ordinary readable output. This
// also checks resolved/inferred indexes and raw schemas, not just syntax.
pub fn validate(schema: &Schema) -> Vec<SchemaIssue> {
    let mut issues = Vec::new();
    let mut issue = |name: &str, field: &str, why: String| issues.push(SchemaIssue {
        path: format!("tables.{name}.columns.{field}"), message: format!("written by: {name}.{field} {why}") });
    for (name, table) in &schema.tables {
        for (field, authority) in &table.written_by {
            if !table.columns.contains_key(field) || field == "id" || table.columns.get(&authority.owner) != Some(&ColumnType::Principal)
                || table.written_by.contains_key(&authority.owner) || table.maintained.contains_key(field) || table.recorded.contains_key(field) {
                issue(name, field, format!("needs an ordinary required principal owner column .{} on the same table", authority.owner));
            }
            if !table.defaults.contains_key(field) {
                issue(name, field, "needs a declared default for inserts by other principals".into());
            }
            if authority.audience { continue; }
            if table.indexes.values().any(|index| index.uses_column(field)) || table.expire.as_ref() == Some(field) {
                issue(name, field, "is private and cannot supply an index/cursor or lifetime; declare readable by audience to use it there".into());
            }
            for timeline in &schema.timelines {
                let mut dependencies = BTreeSet::new();
                for mapping in [&timeline.authors[..], &timeline.posts[..], &timeline.reposts[..], &timeline.edges[..]] {
                    if mapping[0] == *name { dependencies.extend(mapping[1..].iter().cloned()); }
                }
                if timeline.posts[0] == *name && let Some(filter) = &timeline.filter { filter.fields(&mut dependencies); }
                if dependencies.contains(field) {
                    issue(name, field, "is private and cannot supply a timeline mapping or predicate; declare readable by audience first".into());
                }
            }
            for maintain in &schema.maintains {
                if maintain.source == *name && maintain.dependencies().contains(field) {
                    issue(name, field, "is private and cannot feed a readable aggregate; declare readable by audience first".into());
                }
            }
        }
        for (other_name, other) in &schema.tables {
            for capture in other.recorded.values() {
                if capture.table == *name && table.private_field(&capture.column) { issue(other_name, &capture.column, "cannot record another row's private field".into()); }
            }
        }
        for (effect, rule) in [("read", &table.rules.read), ("insert", &table.rules.insert), ("update", &table.rules.update), ("delete", &table.rules.delete)] {
            private_rule(schema, name, rule, effect == "update" && table.update_transition, &mut issue);
        }
    }
    issues
}

fn private_rule(schema: &Schema, name: &str, rule: &RuleExpr, update: bool, issue: &mut impl FnMut(&str, &str, String)) {
    let term = |term: &RuleTerm, issue: &mut dyn FnMut(&str, &str, String)| {
        if !update && let RuleTerm::Field(field) | RuleTerm::OldField(field) | RuleTerm::NextField(field) = term
            && schema.tables[name].private_field(field) {
            issue(name, field, "is private; only a named update (old, next) transition may use it as a rule input; declare readable by audience for other rules".into());
        }
    };
    match rule {
        RuleExpr::Eq(a,b) | RuleExpr::Ne(a,b) | RuleExpr::Compare(_,a,b) => { term(a,issue); term(b,issue); }
        RuleExpr::And(items) | RuleExpr::Or(items) => for item in items { private_rule(schema,name,item,update,issue); },
        RuleExpr::Not(inner) => private_rule(schema,name,inner,update,issue),
        RuleExpr::Exists { table, key, equalities, .. } | RuleExpr::Created { table, key, equalities, .. } => {
            for item in key { term(item,issue); }
            for (field,value) in equalities {
                term(value,issue);
                if schema.table(table).is_some_and(|t|t.private_field(field)) { issue(table,field,"is private and cannot be probed from a rule".into()); }
            }
        }
        _ => {}
    }
}

impl RuleExpr {
    /// Comparing an untouched field with itself needs no knowledge of its
    /// value. Every other use (including a probe key) requires field visibility.
    pub fn needs_field_value(&self, field: &str) -> bool {
        let term = |term: &RuleTerm| matches!(term, RuleTerm::Field(name) | RuleTerm::OldField(name) | RuleTerm::NextField(name) if name == field);
        match self {
            Self::Eq(a,b) | Self::Ne(a,b) | Self::Compare(_,a,b) => term(a) != term(b),
            Self::And(items) | Self::Or(items) => items.iter().any(|rule|rule.needs_field_value(field)),
            Self::Not(inner) => inner.needs_field_value(field),
            Self::Exists { key, equalities, .. } | Self::Created { key, equalities, .. } => key.iter().chain(equalities.iter().map(|(_,value)|value)).any(term),
            _ => false,
        }
    }

    pub fn references_field(&self, field: &str) -> bool {
        let term = |term: &RuleTerm| matches!(term, RuleTerm::Field(name) | RuleTerm::OldField(name) | RuleTerm::NextField(name) if name == field);
        match self {
            Self::Eq(a,b) | Self::Ne(a,b) | Self::Compare(_,a,b) => term(a) || term(b),
            Self::And(items) | Self::Or(items) => items.iter().any(|rule| rule.references_field(field)),
            Self::Not(inner) => inner.references_field(field),
            Self::Exists { key, equalities, .. } | Self::Created { key, equalities, .. } => key.iter().chain(equalities.iter().map(|(_,value)|value)).any(term),
            _ => false,
        }
    }
}
