//! Read-only population advice, separate from adoption's correctness preflight.
// @ref LLP 3000.019#3.6 — measured population advice does not promise a write-pause SLO.
use super::*;

pub use crate::store_port::adoption_estimate::AdoptionEstimate;

impl Store {
    pub fn adoption_estimate(
        &mut self,
        schema: &Schema,
    ) -> Result<Option<AdoptionEstimate>, RuntimeError> {
        let tx = self.read_transaction()?;
        let previous: Option<String> = tx.tx.query_row("SELECT schema FROM _generations WHERE generation = (SELECT CAST(value AS INTEGER) FROM _meta WHERE key = 'generation')", [], |r| r.get(0)).optional()?;
        let Some(previous) = previous else {
            return Ok(None);
        };
        let previous: Schema = crate::json_codec::from_text(&previous)
            .map_err(|e| RuntimeError::Store(e.to_string()))?;
        let changed = previous != *schema;
        // Legacy live-sum repair can rebuild retained targets even with no schema delta.
        let repair_sums = tx.meta("live_sum_candidates")?.as_deref() != Some("1");
        let repair_maintained_ids = previous.maintains.iter().any(|maintain| maintain.row_key.is_none())
            && schema.maintains.iter().any(|maintain| maintain.row_key.is_none())
            && tx.meta(crate::schema::MAINTAINED_ID_META)?.as_deref() != Some(crate::schema::MAINTAINED_ID_VERSION);
        let cap_schema = tx.meta("cap_counts_schema")?;
        let rebuild_caps = (crate::rows::caps::required(schema) || cap_schema.is_some())
            && cap_schema.as_deref() != Some(&schema.hash());
        let rebuild: Vec<_> = schema.maintains.iter().filter(|m|
            (changed && crate::successor::maintain_rebuild_needed(&previous, schema, m))
                || (repair_maintained_ids && m.row_key.is_none())
                || (repair_sums && matches!(m.kind, crate::schema::MaintainKind::Sum { .. })
                    && schema.table(&m.source).is_some_and(|t| t.is_expiring()))).collect();
        if !changed && rebuild.is_empty() && !rebuild_caps {
            return Ok(None);
        }
        let plans = super::activation_plan::plans(schema, Some(&previous));
        let mut counts = BTreeMap::<String, u64>::new();
        let mut count = |name: &str| -> Result<u64, RuntimeError> {
            if let Some(count) = counts.get(name) {
                return Ok(*count);
            }
            let rows = if let Some(t) = tx.catalog.get(name) {
                tx.tx
                    .query_row("SELECT count(*) FROM r WHERE t = ?1", [t], |r| {
                        r.get::<_, i64>(0)
                    })? as u64
            } else {
                0
            };
            counts.insert(name.to_owned(), rows);
            Ok(rows)
        };
        let mut estimate = AdoptionEstimate {
            cache_mib: super::activation_cache::configured_mib()?,
            ..Default::default()
        };
        // Count each predecessor physical population once, including surviving
        // names cleared by timeline retirement, index replacement and rebuilds.
        let active = super::activation_plan::active_names(schema);
        let mut retired: std::collections::BTreeSet<String> = tx.catalog.keys()
            .filter(|name| !active.contains(*name)).cloned().collect();
        let mut cleared = crate::successor::retired_timeline_tables(&previous, schema);
        for m in &rebuild {
            cleared.insert(m.target.clone());
            if m.row_key.is_some() {
                cleared.extend([m.work_table(), format!("$basis:{}", m.target)]);
            }
        }
        for name in cleared {
            retired.insert(name.clone());
            for table in previous.table(&name).into_iter().chain(schema.table(&name)) {
                retired.extend(table.indexes.keys().map(|index| format!("{name}.{index}")));
            }
        }
        for (name, plan) in &plans {
            retired.extend(plan.indexes.iter().map(|index| format!("{name}.{index}")));
        }
        for num in retired.iter().filter_map(|name| tx.catalog.get(name)) {
            let (rows, indexes): (i64, i64) = tx.tx.query_row(
                "SELECT (SELECT count(*) FROM r WHERE t=?1), (SELECT count(*) FROM i WHERE ti=?1)",
                [num], |r| Ok((r.get(0)?, r.get(1)?)))?;
            estimate.retired_rows = estimate.retired_rows.saturating_add(rows as u64);
            estimate.retired_index_entries = estimate.retired_index_entries.saturating_add(indexes as u64);
        }
        // Selection is clock-independent. Affected tables may retire old rows;
        // unaffected through tables still rewrite every row's deadline. Avoid
        // predicting how many rows expire at the later activation's pinned time.
        let through = crate::engine::through_activation::Retirement::new(schema, &previous, 0);
        for (name, table) in schema.tables.iter().filter(|(_, t)| t.ephemeral.is_none()) {
            if changed && (through.affects(name) || table.through.is_some()) {
                let rows = count(name)?;
                if rows != 0 {
                    let label = super::adoption_report::table_label(schema, name);
                    if through.affects(name) {
                        estimate.unestimated.insert(format!("read-through retirement/recapture {label} ({rows} stored rows; deletion subset depends on activation time)"));
                    } else {
                        estimate.deadline_rewrite_rows = estimate.deadline_rewrite_rows.saturating_add(rows);
                        estimate.unestimated.insert(format!("read-through {label} rewrites {rows} stored rows to recompute deadlines"));
                    }
                }
            }
            let plan = &plans[name];
            let paths = table
                .recorded
                .keys()
                .filter(|path| {
                    previous
                        .table(name)
                        .is_none_or(|old| !old.recorded.contains_key(*path))
                })
                .count() as u64;
            if !plan.project && plan.indexes.is_empty() && paths == 0 {
                continue;
            }
            let rows = count(name)?;
            estimate.projected_rows = estimate.projected_rows.saturating_add(rows);
            estimate.index_rows = estimate
                .index_rows
                .saturating_add(rows.saturating_mul(plan.indexes.len() as u64));
            estimate.capture_rows = estimate
                .capture_rows
                .saturating_add(rows.saturating_mul(paths));
        }
        for maintain in &rebuild {
            let rows = count(&maintain.source)?;
            if let Some(key) = &maintain.row_key {
                let members = count(&key.table)?;
                estimate.member_rows = estimate.member_rows.saturating_add(members);
                // Each member's initial rebuild retains the ordinary writer's
                // 1,024-row recount boundary. A small-range probe can add 65
                // key-only visits before that scan (included conservatively).
                estimate.row_view_visits = estimate.row_view_visits.saturating_add(
                    rows.saturating_mul(key.fanout as u64)
                        .saturating_add(members.saturating_mul(65))
                        .min(members.saturating_mul(1_089)),
                );
            } else {
                estimate.aggregate_rows = estimate.aggregate_rows.saturating_add(rows);
            }
            if let Some(private) = &maintain.private {
                estimate.projected_rows = estimate
                    .projected_rows
                    .saturating_add(count(&private.table)?);
            }
        }
        // A parent lifetime change can mirror columns without rebuilding their
        // private totals. Conservatively include other parent-definition changes.
        for m in schema.maintains.iter().filter(|m| m.private.is_some()) {
            let parent = &m.private.as_ref().unwrap().table;
            if rebuild.contains(&m) || previous.table(parent) != schema.table(parent) {
                let rows = count(parent)?;
                if rows != 0 {
                    estimate.unestimated.insert(format!("maintained-column mirror {parent} ({rows} stored rows)"));
                }
            }
        }
        if rebuild_caps {
            // Resetting an existing occupancy ledger also costs writes when
            // the last capped table has been removed or emptied.
            let exists: bool = tx.tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='_cap_counts')", [], |r| r.get(0))?;
            let entries: i64 = if exists { tx.tx.query_row("SELECT count(*) FROM _cap_counts", [], |r| r.get(0))? } else { 0 };
            let mut sources = 0u64;
            for (name, table) in &schema.tables {
                if table.is_expiring() && table.constraints.iter().any(|c| matches!(c, crate::schema::Constraint::Cap { .. })) {
                    sources = sources.saturating_add(count(name)?);
                }
            }
            if entries != 0 || sources != 0 {
                estimate.unestimated.insert(format!("cap occupancy reset/rebuild ({entries} stored entries, {sources} source rows)"));
            }
        }
        if changed {
            let mut homes = tx.tx.prepare("SELECT home_table, home_column, count(*) FROM _assets WHERE home_table IS NOT NULL AND released_at IS NULL GROUP BY home_table, home_column")?;
            for home in homes.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)))? {
                let (name, column, rows) = home?;
                if schema.table(&name).and_then(|t| t.columns.get(&column)).is_none_or(|kind| !asset_type(kind)) {
                    estimate.unestimated.insert(format!("asset-home retirement {name}.{column} ({rows} ledger rows)"));
                }
            }
        }
        estimate.sources = counts
            .into_iter()
            .filter(|(_, rows)| *rows != 0)
            .map(|(name, rows)| (super::adoption_report::table_label(schema, &name), rows))
            .collect();
        Ok((!estimate.sources.is_empty() || estimate.retired_rows != 0 || estimate.retired_index_entries != 0 || !estimate.unestimated.is_empty()).then_some(estimate))
    }
}

fn asset_type(kind: &crate::schema::ColumnType) -> bool {
    use crate::schema::ColumnType::*;
    match kind { Optional(inner) | List { of: inner, .. } | ListRange { of: inner, .. } => asset_type(inner), Image { .. } | Video { .. } | File { .. } => true, _ => false }
}
