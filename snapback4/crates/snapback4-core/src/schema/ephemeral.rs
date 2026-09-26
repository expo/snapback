//! Server-memory table admission, shared with the compiler and generation loader.
// @ref LLP 3000.017#2.1-declaration — memory may not decide a durable invariant.
use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ephemeral { pub life_ms: u64 }

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Version { pub epoch: u64, pub incarnation: String }

pub fn validate(schema: &Schema) -> Vec<SchemaIssue> {
    let mut issues = Vec::new();
    let ephemeral = |name: &str| schema.tables.get(name).is_some_and(|t| t.ephemeral.is_some());
    for (name, table) in &schema.tables {
        let mut refuse = |clause: &str, fix: &str| issues.push(SchemaIssue {
            path: format!("tables.{name}.ephemeral"), message: format!("ephemeral: {clause}; {fix}"),
        });
        if let Some(e) = &table.ephemeral {
            if !(1_000..=60_000).contains(&e.life_ms) { refuse("life must be between 1 second and 60 seconds inclusive", "use ephemeral 4s"); }
            if table.sync.is_some() { refuse("sync (including a horizon) cannot appear on an ephemeral table", "delete the sync line; devices read ephemeral rows from the server"); }
            if table.residency.online_only { refuse("online only cannot appear on an ephemeral table", "delete the line; devices read ephemeral rows from the server"); }
            if table.expire.is_some() { refuse("expire at cannot appear on an ephemeral table", "delete it; ephemeral <life> sets every row's deadline"); }
            if !table.sequences.is_empty() { refuse("sequence by cannot appear on an ephemeral table", "keep that data in a durable table"); }
            if table.through.is_some() { refuse("through cannot appear on an ephemeral table", "keep that data in a durable table"); }
            if table.indexes.values().any(|i| i.word_component().is_some()) { refuse("words(..) indexes cannot appear on an ephemeral table", "keep that data in a durable table"); }
            if table.columns.values().any(asset) { refuse("asset columns (image, video, once) cannot appear on an ephemeral table", "keep that data in a durable table"); }
            if table.columns.get(through::DEADLINE) != Some(&ColumnType::Time)
                || table.defaults.contains_key(through::DEADLINE)
                || table.index("$expiry") != Some(&Index::of(&[through::DEADLINE, "id"], false)) {
                refuse("hidden $deadline and $expiry must be engine-owned", "compile the ephemeral declaration again");
            }
        }
        for kind in table.columns.values() {
            if reference(kind).is_some_and(ephemeral) { refuse("a reference column cannot target an ephemeral table", "keep the referenced data in a durable table"); }
        }
        for rule in [&table.rules.read, &table.rules.insert, &table.rules.update, &table.rules.delete] {
            let mut targets = BTreeSet::new(); rule_tables(rule, &mut targets);
            if targets.iter().any(|t| ephemeral(t)) { refuse("a rule cannot probe an ephemeral table", "probe a durable table instead"); }
        }
        if table.constraints.iter().any(|c| matches!(c, Constraint::FinalExistsOnInsert { table, .. } if ephemeral(table))) {
            refuse("after insert cannot probe an ephemeral table", "probe a durable table instead");
        }
        if table.sync.as_ref().is_some_and(|s| matches!(&s.audience, Audience::Target { table, .. } if ephemeral(table))) {
            refuse("sync to cannot target an ephemeral table", "keep the audience in a durable table");
        }
    }
    for m in &schema.maintains {
        if ephemeral(&m.source) { issues.push(SchemaIssue { path: format!("tables.{}.ephemeral", m.source), message: "ephemeral: maintain cannot derive durable data from memory; count or rank durable rows".into() }); }
    }
    for t in &schema.timelines {
        if [&t.authors[0], &t.posts[0], &t.reposts[0], &t.edges[0]].iter().any(|n| ephemeral(n)) {
            issues.push(SchemaIssue { path: format!("timelines.{}", t.name), message: "ephemeral: Following/feed cannot derive durable data from memory; count or rank durable rows".into() });
        }
    }
    issues
}
fn asset(kind: &ColumnType) -> bool {
    match kind { ColumnType::Image { .. } | ColumnType::Video { .. } => true,
        ColumnType::Optional(inner) | ColumnType::List { of: inner, .. } => asset(inner), _ => false }
}
fn reference(kind: &ColumnType) -> Option<&str> {
    match kind { ColumnType::Ref { table } => Some(table),
        ColumnType::Optional(inner) | ColumnType::List { of: inner, .. } => reference(inner), _ => None }
}
pub fn rule_tables(rule: &RuleExpr, out: &mut BTreeSet<String>) {
    match rule {
        RuleExpr::Exists { table, .. } | RuleExpr::Created { table, .. } => { out.insert(table.clone()); }
        RuleExpr::And(xs) | RuleExpr::Or(xs) => xs.iter().for_each(|r| rule_tables(r, out)),
        RuleExpr::Not(r) => rule_tables(r, out),
        RuleExpr::Public { .. } | RuleExpr::Allow | RuleExpr::Deny | RuleExpr::Eq(..) | RuleExpr::Ne(..) | RuleExpr::Compare(..) => {}
    }
}

/// Derived facts and admission share exactly the same exhaustive traversal.
pub fn execution(schema: &Schema, program: &crate::ir::Program, fact: &mut Execution) -> Result<(), String> {
    use crate::ir::{ProgramKind, effects::Effects};
    if !schema.tables.values().any(|t| t.ephemeral.is_some()) { return Ok(()); }
    let mut effects = Effects::of(program);
    if program.native { effects.reads.extend(schema.tables.keys().cloned()); }
    // Implicit rule, attribution and aggregate reads are part of the closure too.
    let mut pending: Vec<_> = effects.reads.iter().chain(&effects.writes).cloned().collect();
    let mut seen = BTreeSet::new();
    while let Some(name) = pending.pop() {
        if !seen.insert(name.clone()) { continue; }
        if let Some(t) = schema.table(&name) {
            let mut targets = BTreeSet::new(); rule_tables(&t.rules.read, &mut targets);
            if effects.writes.contains(&name) {
                for rule in [&t.rules.insert, &t.rules.update, &t.rules.delete] { rule_tables(rule, &mut targets); }
            }
            targets.extend(t.recorded.values().map(|r| r.table.clone()));
            if let Some(t) = &t.through { targets.insert(t.parent.clone()); }
            for m in schema.maintains.iter().filter(|m| m.target == name) { targets.insert(m.source.clone()); }
            pending.extend(targets.iter().cloned()); effects.reads.extend(targets);
        }
    }
    let ephemeral = |name: &str| schema.table(name).is_some_and(|t| t.ephemeral.is_some());
    let writes: Vec<_> = effects.writes.iter().filter(|t| ephemeral(t)).collect();
    let reads: Vec<_> = effects.reads.iter().filter(|t| ephemeral(t)).cloned().collect();
    if writes.is_empty() && reads.is_empty() { return Ok(()); }
    if program.kind == ProgramKind::Query {
        if fact.held { return Err("held query cannot read an ephemeral table; split the ephemeral read into its own server query".into()); }
        if !writes.is_empty() { return Err("query cannot write an ephemeral table; put the writes in an ephemeral mutation".into()); }
        fact.ephemeral_reads = reads; fact.runs = Some("server".into()); fact.components.clear(); return Ok(());
    }
    if program.kind != ProgramKind::Mutation {
        return Err("job, schedule or action cannot read or write an ephemeral table; call an ephemeral mutation from the client".into());
    }
    if writes.is_empty() { return Err("durable mutation cannot read an ephemeral table; split the read into its own query".into()); }
    if writes.len() != effects.writes.len() { return Err("mixed durable and ephemeral writes; split this into two mutations; call the ephemeral one from the client after the durable one".into()); }
    if effects.emit || program.native { return Err("ephemeral mutation cannot emit or call a native job; keep that work in a durable mutation".into()); }
    if effects.writes.iter().any(|name| schema.tables[name].sequences.len() != 0) { return Err("ephemeral mutation cannot use a sequence; keep that data in a durable table".into()); }
    fact.ephemeral = true; fact.renews = effects.renews;
    fact.renew_ms = writes.iter().map(|name| schema.tables[*name].ephemeral.as_ref().unwrap().life_ms / 4).min();
    fact.runs = Some("server".into()); fact.predicts = Some("never".into()); fact.components.clear();
    Ok(())
}

pub fn admit_program(schema: &Schema, program: &crate::ir::Program) -> Result<(), crate::RuntimeError> {
    let before = schema.operations.get(&program.name).cloned().unwrap_or_default();
    let mut fact = before.clone();
    execution(schema, program, &mut fact).map_err(|message| crate::RuntimeError::Structural { code: "E_QUARRY_EPHEMERAL", message })?;
    if (before.ephemeral, before.renews, before.renew_ms, &before.ephemeral_reads) != (fact.ephemeral, fact.renews, fact.renew_ms, &fact.ephemeral_reads) {
        return Err(crate::RuntimeError::Structural { code: "E_QUARRY_EPHEMERAL", message: "ephemeral operation facts differ from the program's effects; compile this generation again".into() });
    }
    Ok(())
}

impl Table {
    pub fn stamp_ephemeral(&self, row: &mut Value, now: i64) -> Result<bool, crate::RuntimeError> {
        let Some(e) = &self.ephemeral else { return Ok(false); };
        let deadline=now.checked_add(e.life_ms as i64).filter(|n| *n <= crate::value::I53_MAX)
            .ok_or_else(||crate::RuntimeError::Input("ephemeral deadline exceeds the clock range".into()))?;
        if let Value::Row(fields) | Value::Map(fields) = row { fields.insert(through::DEADLINE.into(),Value::Int(deadline)); }
        Ok(true)
    }
}

impl Schema {
    pub fn refuse_ephemeral_import(&self, table: &str) -> Result<(), crate::RuntimeError> {
        if self.table(table).is_some_and(|t| t.ephemeral.is_some()) {
            return Err(crate::RuntimeError::Structural { code: "E_QUARRY_EPHEMERAL", message: format!("seed/load cannot import ephemeral table {table}; call its mutation in this process") });
        }
        Ok(())
    }
}
