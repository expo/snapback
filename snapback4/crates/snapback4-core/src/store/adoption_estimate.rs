//! Read-only population advice, separate from adoption's correctness preflight.
// @ref LLP 3000.019#3.6 — measured population advice does not promise a write-pause SLO.
use super::*;

#[derive(Debug, Default)]
pub struct AdoptionEstimate {
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
        format!(
            "estimated write pause {lo:.2}–{hi:.2} s using measured eb1000 release rates (not a host/load SLO); source rows [{sources}]; {} row projections, {} index row builds, {} capture fills, {} aggregate visits, {} members / up to {} row-view visits; payload width, token fanout, group distribution and WAL/storage affect the actual time",
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
        let mut estimate = AdoptionEstimate::default();
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
        Ok((!estimate.sources.is_empty()).then_some(estimate))
    }
}
