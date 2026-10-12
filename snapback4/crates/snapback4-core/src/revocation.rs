//! Conservative authorization impact, shared by the server and device.
// @ref LLP 3000.023#12 — only evidence certified to preserve row authority is unbounded.
use crate::{schema::{Audience, ColumnType, RuleExpr, RuleTerm, Schema, Table}, value::Value};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const LIMIT: usize = 256;

/// Net transaction images, bounded independently of the mutation's row budget.
/// Prediction restore/replay may delete and reinstall the same id internally;
/// only its final image can change the displayed answer's authority.
#[derive(Default)]
pub struct Recorder {
    rows: BTreeMap<(String,String), (Option<Value>,Option<Value>)>,
    bytes: usize,
    seen: BTreeSet<String>,
    unknown: bool,
}
impl Recorder {
    pub fn widen(&mut self) { self.unknown = true; self.rows.clear(); }
    pub fn record(&mut self, name: &str, _table: &Table, old: Option<&Value>, new: Option<&Value>) {
        if self.unknown { return; }
        self.seen.insert(name.into());
        if old == new { return; }
        let id = new.or(old).and_then(|r| r.field("id").ok()).and_then(|id| id.as_str().ok());
        let Some(id) = id else { self.widen(); return; };
        // Count all observed images, including replaced intermediates: widening
        // cannot accidentally regain certification later in this transaction.
        self.bytes = self.bytes.saturating_add(old.map_or(0,image_bytes)).saturating_add(new.map_or(0,image_bytes));
        if self.bytes > 262144 || self.rows.len() >= LIMIT { self.widen(); return; }
        self.rows.entry((name.into(),id.into())).and_modify(|pair| pair.1 = new.cloned()).or_insert_with(|| (old.cloned(),new.cloned()));
    }
    pub fn covers(&self, tables: &[String]) -> bool { tables.iter().all(|t| self.seen.contains(t)) }
    pub fn footprint(&self) -> Footprint {
        let mut out = Footprint { unknown: self.unknown, ..Default::default() };
        if self.unknown { return out; }
        for ((name,_),(old,new)) in &self.rows {
            if old == new { continue; }
            let c = out.tables.entry(name.clone()).or_default();
            c.deleted |= new.is_none(); c.population |= old.is_none() || new.is_none();
            if let (Some(old),Some(new)) = (old,new) {
                if let (Ok(a),Ok(b)) = (old.as_object(),new.as_object()) {
                    for key in a.keys().chain(b.keys()) { if a.get(key) != b.get(key) { c.columns.insert(key.clone()); } }
                } else { out.widen(); break; }
            }
        }
        out
    }
}
fn image_bytes(value: &Value) -> usize {
    match value {
        Value::String(s) | Value::Id(s) => s.len(), Value::Bytes(b) => b.len(),
        Value::Row(fields) | Value::Map(fields) => fields.iter().fold(32usize,|n,(k,v)| n.saturating_add(k.len()).saturating_add(image_bytes(v))),
        Value::Array(values) => values.iter().fold(24usize,|n,v| n.saturating_add(image_bytes(v))), _ => 16,
    }
}

/// No values, principals, ids or counts cross this envelope.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Footprint {
    pub unknown: bool,
    pub tables: BTreeMap<String, Change>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Change {
    pub deleted: bool,
    pub population: bool,
    pub columns: BTreeSet<String>,
}
impl Footprint {
    pub fn widen(&mut self) { self.unknown = true; self.tables.clear(); }
    pub fn merge(&mut self, other: &Self) {
        if self.unknown || other.unknown || self.tables.len() + other.tables.len() > LIMIT { self.widen(); return; }
        for (name, change) in &other.tables {
            let target = self.tables.entry(name.clone()).or_default();
            target.deleted |= change.deleted;
            target.population |= change.population;
            target.columns.extend(change.columns.iter().cloned());
            if target.columns.len() > LIMIT { self.widen(); return; }
        }
    }
    pub fn preserved(&self, schema: &Schema) -> Vec<String> {
        if self.unknown || schema.tables.len() > LIMIT { return Vec::new(); }
        schema.visible_tables().filter(|(name, table)| {
            if self.tables.get(*name).is_some_and(|c| c.deleted) { return false; }
            let mut deps = Dependencies::default();
            deps.table(schema, name, table);
            !deps.unknown && !deps.tables.iter().any(|(name, columns)| self.tables.get(name).is_some_and(|change|
                columns.is_none() || columns.as_ref().is_some_and(|cols| !cols.is_disjoint(&change.columns))))
        }).map(|(name, _)| name.clone()).collect()
    }
}

#[derive(Default)]
struct Dependencies { tables: BTreeMap<String, Option<BTreeSet<String>>>, visited: BTreeSet<String>, unknown: bool }
impl Dependencies {
    fn column(&mut self, table: &str, column: &str) {
        self.tables.entry(table.into()).or_insert_with(|| Some(BTreeSet::new())).as_mut().map(|s| s.insert(column.into()));
    }
    fn term(&mut self, table: &str, term: &RuleTerm) {
        match term {
            RuleTerm::Field(c) | RuleTerm::OldField(c) | RuleTerm::NextField(c) => self.column(table, c),
            RuleTerm::Reference { column, .. } | RuleTerm::ReferenceChain { column, .. } => { self.column(table, column); for (target, field) in term.references() { self.column(target, field); } self.unknown = true; },
            RuleTerm::Viewer | RuleTerm::Literal(_) => (),
        }
    }
    fn rule(&mut self, schema: &Schema, name: &str, rule: &RuleExpr) {
        match rule {
            RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny => (),
            RuleExpr::Eq(a,b) | RuleExpr::Ne(a,b) | RuleExpr::Compare(_,a,b) => { self.term(name,a); self.term(name,b); }
            RuleExpr::And(items) | RuleExpr::Or(items) => for item in items { self.rule(schema,name,item); },
            RuleExpr::Not(item) => self.rule(schema,name,item),
            RuleExpr::Exists { table, key, equalities, .. } | RuleExpr::Created { table, key, equalities, .. } => {
                for term in key.iter().chain(equalities.iter().map(|(_,t)| t)) { self.term(name,term); }
                // A probe includes negative membership, target authorization and index membership.
                // Widen to the whole input table; no audience mapping is guessed.
                self.tables.insert(table.clone(), None);
                if let Some(t) = schema.table(table) { self.table(schema,table,t); } else { self.unknown = true; }
            }
        }
    }
    fn table(&mut self, schema: &Schema, name: &str, table: &Table) {
        if !self.visited.insert(name.into()) { return; }
        if self.visited.len() > LIMIT { self.unknown = true; return; }
        // Aggregates authorize through their source, row-key owner or captured parent.
        for maintain in schema.maintains.iter().filter(|m| m.target == name) {
            for input in std::iter::once(&maintain.source).chain(maintain.row_key.iter().map(|k| &k.table)).chain(maintain.parent_key.iter().map(|p| &p.parent)) {
                self.tables.insert(input.clone(),None);
                if let Some(t) = schema.table(input) { self.table(schema,input,t); } else { self.unknown = true; }
            }
        }
        if let Some(input) = &table.residency.inherited_from {
            self.tables.insert(input.clone(),None);
            if let Some(t) = schema.table(input) { self.table(schema,input,t); } else { self.unknown = true; }
        }
        self.rule(schema,name,&table.rules.read);
        // Row readability is insufficient: ownership also decides disclosure.
        // Private values may change without revoking any field; only their
        // non-audience owner columns participate in this authorization decision.
        for authority in table.written_by.values().filter(|a| !a.audience) {
            self.column(name,&authority.owner);
        }
        if let Some(sync) = &table.sync {
            // @ref LLP 3000.036.000.000#7 — every arm of a union decides whether a viewer holds a row.
            for (audience, _) in sync.arms() {
                match audience {
                    Audience::Public => (),
                    Audience::Column(c) => self.column(name,c),
                    Audience::Target { table, prefix, .. } => {
                        for c in prefix { self.column(name,c); }
                        self.tables.insert(table.clone(),None);
                        if let Some(t) = schema.table(table) { self.table(schema,table,t); } else { self.unknown = true; }
                    }
                }
            }
        }
        if let Some(through) = &table.through {
            self.column(name,&through.reference);
            self.tables.insert(through.parent.clone(),None);
            if let Some(t) = schema.table(&through.parent) { self.table(schema,&through.parent,t); } else { self.unknown = true; }
        }
        if let Some(c) = &table.expire { self.column(name,c); }
        if table.is_expiring() { self.column(name,"$deadline"); self.column(name,"$parentDeadline"); }
        // @ref LLP 3000.023#12 — once protects served bytes, not the handle;
        // consumption cannot revoke row/field disclosure. Asset edits still can.
        for (column, kind) in &table.columns {
            if asset(kind) { self.column(name,column); }
        }
    }
}
fn asset(kind: &ColumnType) -> bool {
    match kind { ColumnType::Image { .. } | ColumnType::Video { .. } | ColumnType::File { .. } => true,
        ColumnType::Optional(t) | ColumnType::List { of: t, .. } | ColumnType::ListRange { of: t, .. } => asset(t), _ => false }
}

/// Classify a complete interval. Legacy, pruned and over-limit intervals widen.
#[cfg(feature = "sqlite")]
pub fn preserved_between(conn: &rusqlite::Connection, schema: &Schema, after: u64, through: u64) -> Vec<String> {
    footprint_between(conn, after, through).map_or_else(Vec::new, |f| f.preserved(schema))
}

/// Complete bounded transaction evidence; gaps and legacy stores certify nothing.
#[cfg(feature = "sqlite")]
pub fn footprint_between(conn: &rusqlite::Connection, after: u64, through: u64) -> Option<Footprint> {
    if after == through { return Some(Footprint::default()); }
    if through < after { return None; }
    let mut statement = conn.prepare("SELECT c.seq, e.footprint FROM _commits c LEFT JOIN _change_evidence e ON e.seq=c.seq WHERE c.seq>?1 AND c.seq<=?2 ORDER BY c.seq LIMIT 501").ok()?;
    let rows = statement.query_map(rusqlite::params![after as i64, through as i64], |r| Ok((r.get::<_,i64>(0)? as u64, r.get::<_,Option<String>>(1)?))).ok()?;
    let mut footprint = Footprint::default();
    let mut previous = after;
    for (count, row) in rows.enumerate() {
        let (seq, json) = row.ok()?;
        if count >= 500 || seq != previous + 1 { return None; }
        let json = json?;
        if json.len() > 262144 { return None; }
        footprint.merge(&crate::json_codec::from_text::<Footprint>(&json).ok()?);
        previous = seq;
    }
    (previous == through).then_some(footprint)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn schema() -> Schema {
        let bound = snapback4_lang::compile(&[("schema.q".into(), "table members:\n  room: text <=40\n  principal: principal\n  unique room, principal\n  public\n  sync public\ntable messages:\n  room: text <=40\n  body: text\n  owner: principal\n  read <- .owner = viewer and exists members[.room, viewer]\n  online only\n".into())]);
        assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics); crate::json_codec::from_text(&serde_json::to_string(&bound.schema).unwrap()).unwrap()
    }
    fn row(owner: &str, body: &str) -> Value { crate::value::object([("id",Value::Id("id".into())),("room",Value::String("room".into())),("owner",Value::Id(owner.into())),("body",Value::String(body.into()))]) }
    #[test]
    fn insert_body_update_and_net_prediction_replay_preserve_authority() {
        let schema = schema(); let table = &schema.tables["messages"];
        let a = row("alice","before"); let b = row("alice","after");
        for (old,new) in [(None,Some(&a)),(Some(&a),Some(&b))] {
            let mut recorder = Recorder::default(); recorder.record("messages",table,old,new);
            assert!(recorder.footprint().preserved(&schema).contains(&"messages".into()));
        }
        let mut recorder = Recorder::default();
        recorder.record("messages",table,Some(&a),None);
        recorder.record("messages",table,None,Some(&b));
        assert!(recorder.footprint().preserved(&schema).contains(&"messages".into()));
    }
    #[test]
    fn delete_rule_input_and_rule_column_stay_revoking() {
        let schema = schema(); let a = row("alice","a"); let b = row("bob","a");
        for (name,old,new) in [("messages",Some(&a),None),("messages",Some(&a),Some(&b)),("members",None,Some(&a)),("members",Some(&a),Some(&b))] {
            let mut recorder = Recorder::default(); recorder.record(name,&schema.tables[name],old,new);
            assert!(!recorder.footprint().preserved(&schema).contains(&"messages".into()),"{name}");
        }
        let mut recorder = Recorder::default();
        recorder.record("messages",&schema.tables["messages"],Some(&a),None);
        recorder.record("messages",&schema.tables["messages"],None,Some(&b));
        assert!(!recorder.footprint().preserved(&schema).contains(&"messages".into()));
    }
    #[test]
    fn widened_envelopes_never_regain_certification() {
        let schema = schema(); let mut recorder = Recorder::default();
        recorder.widen(); recorder.record("messages",&schema.tables["messages"],None,Some(&row("a","b")));
        assert!(recorder.footprint().preserved(&schema).is_empty());
        let mut footprint = Footprint::default(); footprint.merge(&recorder.footprint());
        assert!(footprint.preserved(&schema).is_empty());
    }
}
