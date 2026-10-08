//! Conservative one-shot dependencies, computed before the public projection.
// @ref LLP 3000.023#11 — custody includes engine-owned effects and authorization.
use serde::Serialize;
use snapback4_core::{
    ir::{effects::Effects, Program, ProgramKind},
    schema::{RuleExpr, Schema},
};
use std::collections::{BTreeMap, BTreeSet};

type Footprint = BTreeMap<String, Option<BTreeSet<String>>>;
#[derive(Serialize)]
pub struct Dependencies {
    reads: Footprint,
    writes: Footprint,
}
fn all(out: &mut Footprint, table: &str) {
    out.insert(table.into(), None);
}
fn fields(out: &mut Footprint, table: &str, fields: impl IntoIterator<Item = String>) {
    if let Some(columns) = out
        .entry(table.into())
        .or_insert_with(|| Some(BTreeSet::new()))
    {
        columns.extend(fields);
    }
}
fn rule(schema: &Schema, rule: &RuleExpr, out: &mut Footprint) {
    match rule {
        RuleExpr::Exists {
            table,
            index,
            equalities,
            ..
        }
        | RuleExpr::Created {
            table,
            index,
            equalities,
            ..
        } => {
            if let Some(index) = schema.tables.get(table).and_then(|t| t.index(index)) {
                fields(
                    out,
                    table,
                    index
                        .columns()
                        .iter()
                        .map(|s| s.to_string())
                        .chain(equalities.iter().map(|(f, _)| f.clone())),
                );
            } else {
                all(out, table);
            }
        }
        RuleExpr::And(rs) | RuleExpr::Or(rs) => {
            for r in rs {
                self::rule(schema, r, out);
            }
        }
        RuleExpr::Not(r) => self::rule(schema, r, out),
        RuleExpr::Public { .. }
        | RuleExpr::Allow
        | RuleExpr::Deny
        | RuleExpr::Eq(..)
        | RuleExpr::Ne(..)
        | RuleExpr::Compare(..) => {}
    }
    // References are currently write-only; keep their inputs if that changes.
    let terms: Vec<_> = match rule {
        RuleExpr::Eq(a, b) | RuleExpr::Ne(a, b) | RuleExpr::Compare(_, a, b) => vec![a, b],
        RuleExpr::Exists {
            key, equalities, ..
        }
        | RuleExpr::Created {
            key, equalities, ..
        } => key
            .iter()
            .chain(equalities.iter().map(|(_, t)| t))
            .collect(),
        _ => vec![],
    };
    for term in terms {
        for (table, _) in term.references() {
            all(out, table);
        }
    }
}
fn reads(schema: &Schema, initial: BTreeSet<String>) -> Footprint {
    let mut out: Footprint = initial.into_iter().map(|t| (t, None)).collect();
    loop {
        let before = out.clone();
        for name in before.keys() {
            let Some(table) = schema.tables.get(name) else {
                continue;
            };
            let mut fs = BTreeSet::new();
            table.rules.read.fields(&mut fs);
            fs.extend(table.expiry_column().map(str::to_owned));
            fields(&mut out, name, fs);
            rule(schema, &table.rules.read, &mut out);
            if let Some(parent) = &table.through {
                all(&mut out, &parent.parent);
            }
            for m in schema.maintains.iter().filter(|m| &m.target == name) {
                all(&mut out, &m.source);
                if let Some(k) = &m.row_key {
                    all(&mut out, &k.table);
                }
                if let Some(parent) = &m.parent_key {
                    all(&mut out, &parent.parent);
                }
            }
            for timeline in &schema.timelines {
                if timeline.owns(name) {
                    for source in &timeline.mapped {
                        all(&mut out, source);
                    }
                }
            }
        }
        if before == out {
            return out;
        }
    }
}

pub fn dependencies(schema: &Schema, program: &Program) -> Option<Dependencies> {
    if program.native || !matches!(program.kind, ProgramKind::Query | ProgramKind::Mutation) {
        return None;
    }
    let effects = Effects::of(program, schema);
    let mut writes: Footprint = effects.writes.into_iter().map(|t| (t, None)).collect();
    // These compiler-owned recipes update only the mapped watermark and runs.
    // Their names and complete bodies are reserved by receipt admission.
    for f in &schema.receipts {
        if program.name == f.delivered || program.name == f.compact {
            writes.insert(
                f.members.clone(),
                Some(BTreeSet::from([f.delivered_field.clone()])),
            );
        } else if program.name == f.seen {
            writes.insert(
                f.members.clone(),
                Some(BTreeSet::from([f.seen_field.clone()])),
            );
        }
    }
    loop {
        let before = writes.clone();
        for f in &schema.receipts {
            if before.contains_key(&f.messages) {
                fields(&mut writes, &f.scope, [f.counter.clone()]);
            }
            // Membership deletion retires runs; conservatively include all membership writes.
            if before.get(&f.members).is_some_and(Option::is_none) {
                all(&mut writes, &f.runs);
            }
        }
        for m in &schema.maintains {
            if before.contains_key(&m.source)
                || m.row_key
                    .as_ref()
                    .is_some_and(|k| before.contains_key(&k.table))
            {
                all(&mut writes, &m.target);
                if let Some(owner) = &m.private {
                    fields(&mut writes, &owner.table, [owner.column.clone()]);
                }
            }
        }
        // Deletion/expiry of a parent retires descendants and their derived data.
        for (name, table) in &schema.tables {
            if table
                .through
                .as_ref()
                .is_some_and(|p| before.contains_key(&p.parent))
            {
                all(&mut writes, name);
            }
        }
        for timeline in &schema.timelines {
            if timeline.mapped.iter().any(|t| before.contains_key(t)) {
                for t in timeline.owned.iter().chain(&timeline.mapped) {
                    all(&mut writes, t);
                }
            }
        }
        if writes == before {
            break;
        }
    }
    // Private tables never need to cross the wire; their public owner is above.
    writes.retain(|t, _| schema.visible(t));
    Some(Dependencies {
        reads: reads(schema, effects.reads),
        writes,
    })
}
