use super::*;

pub(super) fn collect_rule_indexes(
    schema: &Schema,
    rule: &RuleExpr,
    indexes: &mut BTreeSet<String>,
    visited_visibility_tables: &mut BTreeSet<String>,
) {
    match rule {
        RuleExpr::Exists { table, index, .. } => {
            indexes.insert(format!("{table}.{index}"));
            if visited_visibility_tables.insert(table.clone())
                && let Some(table) = schema.table(table)
            {
                collect_rule_indexes(
                    schema,
                    &table.rules.read,
                    indexes,
                    visited_visibility_tables,
                );
            }
        }
        RuleExpr::Created { table, index, .. } => {
            indexes.insert(format!("{table}.{index}"));
        }
        RuleExpr::And(rules) | RuleExpr::Or(rules) => {
            for rule in rules {
                collect_rule_indexes(schema, rule, indexes, visited_visibility_tables);
            }
        }
        RuleExpr::Not(rule) => {
            collect_rule_indexes(schema, rule, indexes, visited_visibility_tables)
        }
        RuleExpr::Public { .. }
        | RuleExpr::Allow
        | RuleExpr::Deny
        | RuleExpr::Eq(_, _)
        | RuleExpr::Ne(_, _) => {}
    }
}

// @ref LLP 1019#4-certification — the private read and write reserve is added
// before maintained amplification; logs can themselves source a maintain.
pub(super) fn reserve(schema: &Schema, summary: &mut Summary) {
    let sources = summary.writes.clone();
    for write in sources {
        let Some(deliver) = schema.table(&write.table).and_then(|t| t.deliver.as_ref()) else {
            continue;
        };
        let cap = crate::delivery::group_cap(&schema.tables[&deliver.target], &deliver.prefix)
            .unwrap_or(0);
        let per_call =
            u64::from(cap) + u64::from(matches!(write.kind, WriteKind::Insert | WriteKind::Upsert));
        let rows = per_call.saturating_mul(write.max_rows);
        let label = format!(
            "{} on {}: {} calls × {per_call} reserved rows",
            deliver.line(None),
            write.table,
            write.max_rows
        );
        summary.delivery_heap_bytes = summary.delivery_heap_bytes.saturating_add(
            rows.saturating_mul(crate::delivery::scratch_per_recipient(schema, deliver)),
        );
        summary.examined = summary.examined.saturating_add(rows);
        summary.index_entries = summary.index_entries.saturating_add(rows);
        summary.costs.scan(Cost {
            value: rows,
            source: label.clone(),
            repair: diagnostic::Repair::Work,
        });
        // Scan, construction/hash/indexing and a bounded identity metadata point.
        let steps = rows
            .saturating_mul(20)
            .saturating_add(write.max_rows.saturating_mul(4));
        summary.steps = summary.steps.saturating_add(steps);
        summary
            .costs
            .step(steps.saturating_sub(rows.saturating_mul(5)), &label, &[]);
        let probes = rows.saturating_mul(final_probes(schema, &deliver.log));
        summary.rule_probes = summary.rule_probes.saturating_add(probes);
        summary
            .costs
            .probes(&label, rows, final_probes(schema, &deliver.log), &[]);
        summary.writes.push(WriteSite {
            table: deliver.log.clone(),
            kind: WriteKind::Insert,
            max_rows: rows,
        });
        let index = crate::cap::enforcement_index(&schema.tables[&deliver.target], &deliver.prefix)
            .map(|(name, _)| name.as_str())
            .unwrap_or("byId");
        // Intrinsic sites are constraint inputs: membership bodies never become
        // receipt authority, nor do they add a client range obligation.
        summary
            .delivery_indexes
            .insert(format!("{}.{index}", deliver.target));
        summary
            .delivery_indexes
            .insert(format!("{}.byRow", deliver.log));
    }
}

impl Certificate {
    // @ref LLP 1019#4-certification — installation's A is an engine fact,
    // outside schema identity. Specialize the native reserve, preserving every
    // supplied site and meter (never recertify away a containment fault).
    pub fn with_delivery_audiences(
        &self,
        schema: &Schema,
        audiences: &BTreeMap<String, u32>,
        ceilings: &Ceilings,
    ) -> Result<Self, CheckError> {
        let mut next = self.clone();
        let mut additions = BTreeMap::<String, u64>::new();
        let mut expected = BTreeMap::<String, u64>::new();
        let mut terms = Vec::new();
        for write in &self.write_sites {
            let Some(d) = schema.table(&write.table).and_then(|t| t.deliver.as_ref()) else {
                continue;
            };
            let n = u64::from(
                crate::delivery::group_cap(&schema.tables[&d.target], &d.prefix).unwrap_or(0),
            );
            let base = n + u64::from(matches!(write.kind, WriteKind::Insert | WriteKind::Upsert));
            let a = u64::from(*audiences.get(&d.log).unwrap_or(&(n as u32))).max(n);
            let actual = match write.kind {
                WriteKind::Insert => base,
                WriteKind::Upsert => base.max(a),
                _ => a,
            };
            let total = expected.entry(d.log.clone()).or_default();
            *total = total.saturating_add(base.saturating_mul(write.max_rows));
            let extra = actual.saturating_sub(base).saturating_mul(write.max_rows);
            let total = additions.entry(d.log.clone()).or_default();
            *total = total.saturating_add(extra);
            if extra > 0 {
                terms.push((
                    format!("schema.tables.{}.deliver", write.table),
                    format!(
                        "{} on {}: A {a} × {} calls",
                        d.line(None),
                        write.table,
                        write.max_rows
                    ),
                ));
            }
        }
        let rows = additions.values().copied().fold(0u64, u64::saturating_add);
        if rows == 0 {
            return Ok(next);
        }
        let refusal = |message: String| CheckError {
            code: "E_BOUND".into(),
            site: Some(terms[0].0.clone()),
            message: format!(
                "{message} ({})",
                terms
                    .iter()
                    .map(|(_, t)| t.as_str())
                    .collect::<Vec<_>>()
                    .join(" + ")
            ),
            rewrite: "reduce this mutation's fan-out or this job's chunk size".into(),
        };
        for (log, extra) in &additions {
            if *extra == 0 {
                continue;
            }
            let reserved: u64 = next
                .write_sites
                .iter()
                .filter(|w| w.table == *log && w.kind == WriteKind::Insert)
                .map(|w| w.max_rows)
                .fold(0u64, u64::saturating_add);
            if reserved < expected[log] {
                return Err(refusal(format!(
                    "missing certified delivery write reserve for {log}"
                )));
            }
            let site = next
                .write_sites
                .iter_mut()
                .find(|w| w.table == *log && w.kind == WriteKind::Insert)
                .unwrap();
            site.max_rows = site.max_rows.saturating_add(*extra);
        }
        let mut maintained_extra = BTreeMap::<String, u64>::new();
        let mut derived_steps = 0u64;
        for (log, extra) in &additions {
            for m in schema.maintains.iter().filter(|m| m.source == *log) {
                let work = crate::engine::search_index::table_write_bound(
                    schema,
                    &m.target,
                    &schema.tables[&m.target],
                    true,
                    true,
                );
                derived_steps = derived_steps.saturating_add(work.steps.saturating_mul(*extra));
                let total = maintained_extra.entry(m.target.clone()).or_default();
                *total = total.saturating_add(*extra);
                let total = next.maintained_writes.entry(m.target.clone()).or_default();
                *total = total.saturating_add(*extra);
                next.maintained_amplification =
                    next.maintained_amplification.saturating_add(*extra);
            }
        }
        let probes = additions
            .iter()
            .map(|(log, extra)| extra.saturating_mul(final_probes(schema, log)))
            .fold(0u64, u64::saturating_add);
        next.max_rule_probes = next.max_rule_probes.saturating_add(probes);
        next.derived_steps = next.derived_steps.saturating_add(derived_steps);
        let extra_writes: Vec<_> = additions
            .iter()
            .chain(&maintained_extra)
            .map(|(table, rows)| WriteSite {
                table: table.clone(),
                kind: WriteKind::Insert,
                max_rows: *rows,
            })
            .collect();
        let timers = crate::timers::write_bound(schema, &extra_writes);
        if timers > 0 {
            let Some(site) = next.write_sites.iter_mut().find(|w| w.table == "_timers") else {
                return Err(refusal("missing certified timer reserve".into()));
            };
            site.max_rows = site.max_rows.saturating_add(timers);
        }
        next.max_examined = next.max_examined.saturating_add(rows);
        next.max_index_entries = next.max_index_entries.saturating_add(rows);
        let scratch = additions
            .iter()
            .map(|(log, n)| {
                crate::delivery::owner(schema, log).map_or(0, |(_, d, _)| {
                    n.saturating_mul(crate::delivery::scratch_per_recipient(schema, d))
                })
            })
            .fold(0u64, u64::saturating_add);
        let steps = rows.saturating_mul(20);
        next.max_steps = next
            .max_steps
            .saturating_add(steps)
            .saturating_add(derived_steps);
        next.max_heap_bytes = next
            .max_heap_bytes
            .saturating_add(steps.saturating_mul(HEAP_BYTES_PER_STEP))
            .saturating_add(scratch);
        let writes = next
            .write_sites
            .iter()
            .map(|w| w.max_rows)
            .fold(next.maintained_amplification, u64::saturating_add);
        for (name, actual, ceiling) in [
            ("examined entries", next.max_examined, ceilings.examined),
            (
                "index entries",
                next.max_index_entries,
                ceilings.index_entries,
            ),
            ("steps", next.max_steps, ceilings.steps),
            ("rule probes", next.max_rule_probes, ceilings.rule_probes),
            ("heap bytes", next.max_heap_bytes, ceilings.heap_bytes),
            ("write rows", writes, ceilings.write_rows),
        ] {
            if actual > ceiling {
                return Err(refusal(format!(
                    "{name} {actual} exceeds ceiling {ceiling}"
                )));
            }
        }
        Ok(next)
    }
}

fn final_probes(schema: &Schema, log: &str) -> u64 {
    schema
        .maintains
        .iter()
        .filter(|m| m.source == log)
        .map(|m| {
            schema.tables[&m.target]
                .constraints
                .iter()
                .filter(|c| matches!(c, Constraint::FinalExistsOnInsert { .. }))
                .count() as u64
        })
        .sum()
}
