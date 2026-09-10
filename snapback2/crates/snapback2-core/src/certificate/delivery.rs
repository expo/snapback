use super::*;

// @ref LLP 1019#4-certification — the private read and write reserve is added
// before maintained amplification; logs can themselves source a maintain.
pub(super) fn reserve(schema: &Schema, summary: &mut Summary) {
    let sources = summary.writes.clone();
    for write in sources {
        if let Some((_, d, crate::delivery::Generated::Receipts)) = crate::delivery::owner(schema, &write.table) {
            let n = u64::from(crate::delivery::group_cap(&schema.tables[&d.target], &d.prefix).unwrap()) + 1;
            let rows = write.max_rows.saturating_mul(n);
            let steps = rows.saturating_mul(5);
            summary.examined = summary.examined.saturating_add(rows);
            summary.index_entries = summary.index_entries.saturating_add(rows);
            summary.steps = summary.steps.saturating_add(steps);
            // Each acknowledgement releases its private membership page before
            // the next identity; body/event pooling is priced by ordinary reads.
            summary.delivery_heap_bytes = summary.delivery_heap_bytes.saturating_add(n.saturating_mul(
                crate::bounds::declared_serialized_row_max(schema, &d.target).saturating_mul(4).saturating_add(256)));
            summary.costs.delivery(rows, steps, &format!("schema.tables.{}.deliver", crate::delivery::owner(schema, &write.table).unwrap().0), "delivery acknowledgement: 50 event identities × (N+1) membership reserve");
            let (index, _) = crate::cap::enforcement_index(&schema.tables[&d.target], &d.prefix).unwrap();
            summary.delivery_indexes.insert(format!("{}.{index}", d.target));
        }
        let Some(deliver) = schema.table(&write.table).and_then(|t| t.deliver.as_ref()) else {
            continue;
        };
        let cap = crate::delivery::group_cap(&schema.tables[&deliver.target], &deliver.prefix)
            .unwrap_or(0);
        let per_call =
            u64::from(cap) + u64::from(matches!(write.kind, WriteKind::Insert | WriteKind::Upsert));
        let rows = per_call.saturating_mul(write.max_rows);
        if let Some(table) = deliver.receipts_table() {
            summary.writes.push(WriteSite { table: table.clone(), kind: WriteKind::Upsert, max_rows: rows });
            reserve_final_probes(schema, summary, &table, rows, WriteKind::Upsert);
            summary.delivery_indexes.insert(format!("{table}.byId"));
        }
        reserve_final_probes(schema, summary, &deliver.log, rows, WriteKind::Insert);
        let rows = rows.saturating_mul(if deliver.receipts { 2 } else { 1 });
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
        // Scan, construction/hash/indexing and a bounded identity metadata point.
        let steps = rows
            .saturating_mul(20)
            .saturating_add(write.max_rows.saturating_mul(4));
        summary.steps = summary.steps.saturating_add(steps);
        summary.costs.delivery(rows, steps, &format!("schema.tables.{}.deliver", write.table), &label);
        summary.writes.push(WriteSite {
            table: deliver.log.clone(),
            kind: WriteKind::Insert,
            max_rows: per_call.saturating_mul(write.max_rows),
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

fn reserve_final_probes(schema: &Schema, summary: &mut Summary, table: &str, rows: u64, kind: WriteKind) {
    let per_row = final_probes(schema, table).saturating_mul(kind.maintained_applications());
    summary.rule_probes = summary.rule_probes.saturating_add(rows.saturating_mul(per_row));
    summary.costs.probes(&format!("{table} {kind:?} maintained final constraints"), rows, per_row, &[]);
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
        let mut kinds = BTreeMap::<String, WriteKind>::new();
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
            kinds.insert(d.log.clone(), WriteKind::Insert);
            if let Some(table) = d.receipts_table() {
                kinds.insert(table.clone(), WriteKind::Upsert);
                *expected.entry(table.clone()).or_default() += base.saturating_mul(write.max_rows);
                *additions.entry(table).or_default() += extra;
            }
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
                .filter(|w| w.table == *log && w.kind == kinds[log])
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
                .find(|w| w.table == *log && w.kind == kinds[log])
                .unwrap();
            site.max_rows = site.max_rows.saturating_add(*extra);
        }
        let mut maintained_extra = BTreeMap::<String, u64>::new();
        let mut derived_steps = 0u64;
        for (log, extra) in &additions {
            let applications = extra.saturating_mul(kinds[log].maintained_applications());
            for m in schema.maintains.iter().filter(|m| m.source == *log) {
                let work = crate::engine::search_index::table_write_bound(
                    schema,
                    &m.target,
                    &schema.tables[&m.target],
                    true,
                    true,
                );
                derived_steps = derived_steps.saturating_add(work.steps.saturating_mul(applications));
                let total = maintained_extra.entry(m.target.clone()).or_default();
                *total = total.saturating_add(applications);
                let total = next.maintained_writes.entry(m.target.clone()).or_default();
                *total = total.saturating_add(applications);
                next.maintained_amplification =
                    next.maintained_amplification.saturating_add(applications);
            }
        }
        let probes = additions
            .iter()
            .map(|(log, extra)| extra.saturating_mul(kinds[log].maintained_applications()).saturating_mul(final_probes(schema, log)))
            .fold(0u64, u64::saturating_add);
        next.max_rule_probes = next.max_rule_probes.saturating_add(probes);
        next.derived_steps = next.derived_steps.saturating_add(derived_steps);
        let extra_writes: Vec<_> = additions
            .iter()
            .map(|(table, rows)| WriteSite {
                table: table.clone(),
                kind: kinds[table],
                max_rows: *rows,
            })
            .chain(maintained_extra.iter().map(|(table, rows)| WriteSite {
                table: table.clone(), kind: WriteKind::Update, max_rows: *rows,
            }))
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

pub(super) fn constraint_checks(schema: &Schema, writes: &[WriteSite], checks: &mut BTreeSet<String>) {
    for write in writes {
        if let Some((_, d, crate::delivery::Generated::Receipts)) = crate::delivery::owner(schema, &write.table) {
            if write.kind == WriteKind::Update {
                checks.insert(format!("{}:DeliveryAcknowledgement", d.target));
            } else if write.kind == WriteKind::Upsert {
                checks.insert(format!("{}:DeliveryReceipt", write.table));
            }
        }
        if let Some(d) = schema.table(&write.table).and_then(|t| t.deliver.as_ref()) {
            if matches!(write.kind, WriteKind::Insert | WriteKind::Upsert) {
                checks.insert(format!("{}:DeliverIncarnation", d.log));
                checks.insert(format!("{}:DeliverAudience({})", d.target, write.table));
            }
            if write.kind != WriteKind::Insert {
                checks.insert(format!("{}:DeliverAudience({})", d.log, write.table));
            }
        }
    }
}

#[cfg(test)]
#[test]
fn a_nonuniform_job_chunk_cannot_spend_the_delivery_reserve() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!("../../../../corpus/deliver-log-schema-identity.json")).unwrap();
    let mut schema: Schema = serde_json::from_value(fixture["schema"].clone()).unwrap();
    schema.tables.get_mut("memberships").unwrap().rules.read = RuleExpr::Eq(crate::RuleTerm::Field("principal".into()), crate::RuleTerm::Viewer);
    let program = Program { name: "chunk".into(), kind: ProgramKind::Mutation, args: BTreeMap::new(), read_time_granularity_ms: None, body: vec![
        Stmt::Let { name: "members".into(), value: Expr::Scan(Scan { site: "chunk.members".into(), table: "memberships".into(), index: "byId".into(), prefix: vec![], order: Order::Asc, take: Bound::Literal(1), after: None, before: None, range: None, opaque_cursor: false, merge_site: None, provenance: KeyProvenance::Const }) },
        Stmt::Delete { table: "messages".into(), key: Expr::Literal(crate::Value::Id("m".into())) },
    ] };
    let error = Checker::new(&schema, Ceilings::default()).job_chunk().check(&program).unwrap_err();
    assert_eq!(error.code, "E_STRUCTURAL_FANOUT");
    assert_eq!(error.site.as_deref(), Some("chunk.members"));
}
