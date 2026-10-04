//! Read-only population advice, separate from adoption's correctness preflight.
// @ref LLP 3000.019#3.6 — measured population advice does not promise a write-pause SLO.
use super::*;

#[derive(Debug, Default)]
pub struct AdoptionEstimate {
    pub cache_mib: u32,
    pub retired_rows: u64,
    pub retired_index_entries: u64,
    pub sources: BTreeMap<String, u64>,
    pub projected_rows: u64,
    pub index_rows: u64,
    pub capture_rows: u64,
    pub aggregate_rows: u64,
    pub member_rows: u64,
    pub row_view_visits: u64,
}

impl AdoptionEstimate {
    /// Reference rates measured on eb1000, release profile, calibration #30.
    /// Row-keyed work is a range: source populations alone do not reveal the
    /// member predicates, small-range probes or where a recount becomes pending.
    pub fn seconds(&self) -> (f64, f64) {
        let fixed = self.projected_rows as f64 / 200_000.0
            + self.index_rows as f64 / 400_000.0
            + self.capture_rows as f64 / 80_000.0
            + self.aggregate_rows as f64 / 200_000.0
            + self.member_rows as f64 / 10_000.0;
        (fixed, fixed + self.row_view_visits as f64 / 100_000.0)
    }

    pub fn summary(&self) -> String {
        let (lo, hi) = self.seconds();
        let sources = self
            .sources
            .iter()
            .map(|(name, rows)| format!("{name}={rows}"))
            .collect::<Vec<_>>()
            .join(", ");
        let pause = if hi == 0.0 {
            "unestimated write pause for retirement".to_owned()
        } else {
            format!("estimated write work up to {hi:.2} s on a host like measured eb1000 (not a host/load SLO); {lo:.2} s subtotal excludes row-view visits and is not a floor")
        };
        let retirement = if self.retired_rows != 0 || self.retired_index_entries != 0 {
            format!("; additional unestimated retirement pause: {} stored rows and {} index entries", self.retired_rows, self.retired_index_entries)
        } else { String::new() };
        let cache = if self.cache_mib == 0 { "caller cache setting".to_owned() }
            else { format!("{} MiB combined main/temp cache target (larger caller settings retained, reduced for Linux address-space headroom)", self.cache_mib) };
        format!(
            "{pause}; source rows [{sources}]; {} row projections, {} index row builds, {} capture fills, {} aggregate visits, {} members / up to {} row-view visits{retirement}; memory: {cache}, prior 64 MiB main-cache run used about 147 MiB process RSS (workspace target is not a process cap); SNAPBACK4_ADOPTION_CACHE_MIB=0 keeps caller settings, default 64; if the cache was enlarged, SQLite NOMEM rolls back and retries once at caller settings; payload width, token fanout, group distribution, cache setting and WAL/storage affect the actual time",
            self.projected_rows,
            self.index_rows,
            self.capture_rows,
            self.aggregate_rows,
            self.member_rows,
            self.row_view_visits
        )
    }
}

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
        if previous == *schema {
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
        // Use the same catalog retirement set as activation, including old
        // private leaves and tables becoming ephemeral. Retained historical
        // catalog names with no physical content contribute zero work.
        let active = super::activation_plan::active_names(schema);
        for (_, num) in tx.catalog.iter().filter(|(name, _)| !active.contains(*name)) {
            let (rows, indexes): (i64, i64) = tx.tx.query_row(
                "SELECT (SELECT count(*) FROM r WHERE t=?1), (SELECT count(*) FROM i WHERE ti=?1)",
                [num], |r| Ok((r.get(0)?, r.get(1)?)))?;
            estimate.retired_rows = estimate.retired_rows.saturating_add(rows as u64);
            estimate.retired_index_entries = estimate.retired_index_entries.saturating_add(indexes as u64);
        }
        for (name, table) in schema.tables.iter().filter(|(_, t)| t.ephemeral.is_none()) {
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
        for maintain in schema
            .maintains
            .iter()
            .filter(|m| crate::successor::maintain_rebuild_needed(&previous, schema, m))
        {
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
        estimate.sources = counts
            .into_iter()
            .filter(|(_, rows)| *rows != 0)
            .map(|(name, rows)| (super::adoption_report::table_label(schema, &name), rows))
            .collect();
        Ok((!estimate.sources.is_empty() || estimate.retired_rows != 0 || estimate.retired_index_entries != 0).then_some(estimate))
    }
}
