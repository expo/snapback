// @ref LLP 1010#a5-the-merged-feed — distinct uniform streams pay for heads plus a shared page reserve.
use super::*;

impl Analyzer<'_> {
    pub(super) fn merge(
        &mut self,
        merge: &Merge,
        calls: u64,
        factors: &[(String, u64)],
    ) -> Result<Summary, CheckError> {
        let invalid = || CheckError {
            site: Some(merge.site.clone()),
            code: "E_TRACE_SUBSET".into(),
            message:
                "merge lanes must share one table, index, prefix width, order, take and cursor"
                    .into(),
            rewrite: "recompile the merge from one table/index header and bounded lane sources"
                .into(),
        };
        let first = &merge.lanes.first().ok_or_else(invalid)?.scan;
        let index = self
            .schema
            .table(&first.table)
            .and_then(|t| t.index(&first.index))
            .ok_or_else(invalid)?;
        if first.prefix.len() >= index.columns.len()
            || index.columns.last().map(String::as_str) != Some("id")
            || merge.lanes.iter().any(|lane| {
                let s = &lane.scan;
                s.table != first.table
                    || s.index != first.index
                    || s.prefix.len() != first.prefix.len()
                    || s.order != first.order
                    || s.take != first.take
                    || s.after != first.after
                    || s.before != first.before
                    || s.range != first.range
                    || s.opaque_cursor != first.opaque_cursor
                    || s.merge_site.as_deref() != Some(&merge.site)
                    || !read_only_setup(&lane.setup)
                    || lane.source.as_ref().is_some_and(|source| {
                        source.merge_site.is_some() || lane.binding.is_empty()
                    })
            })
        {
            return Err(invalid());
        }
        let uniform = merge
            .lanes
            .iter()
            .all(|lane| crate::certificate_policy::uniform_visibility(self.schema, &lane.scan));
        let mut summary = Summary::default();
        for lane in &merge.lanes {
            let mut nested = factors.to_vec();
            let lanes = if let Some(source) = &lane.source {
                summary = summary.add(self.scan(source, calls, factors)?);
                nested.push((format!("{} take", source.site), source.take.maximum()));
                source.take.maximum()
            } else {
                1
            };
            summary =
                summary.add(self.statements(&lane.setup, calls.saturating_mul(lanes), &nested)?);
            summary = summary.add(self.scan_reserve(
                &lane.scan,
                calls.saturating_mul(lanes),
                &nested,
                if uniform {
                    1
                } else {
                    merge.take().saturating_add(2)
                },
            )?);
        }
        if uniform {
            let advances = calls.saturating_mul(merge.take().saturating_add(2));
            summary.examined = summary.examined.saturating_add(advances);
            summary.index_entries = summary.index_entries.saturating_add(advances);
            summary.steps = summary.steps.saturating_add(advances.saturating_mul(5));
            summary.costs.scan(Cost {
                value: calls
                    .saturating_mul(merge.max_lanes())
                    .saturating_add(advances),
                source: format!(
                    "merge {}: {} lanes heads + {} advances + 2 lookahead × {calls} calls ({})",
                    merge.site,
                    merge.max_lanes(),
                    merge.take(),
                    merge
                        .lanes
                        .iter()
                        .map(|lane| format!(
                            "{} × {}",
                            lane.scan.site,
                            lane.source
                                .as_ref()
                                .map_or(1, |source| source.take.maximum())
                        ))
                        .collect::<Vec<_>>()
                        .join("; ")
                ),
                repair: diagnostic::Repair::Merge,
            });
        }
        let heads = merge.max_lanes();
        let height = u64::from(64 - heads.max(1).leading_zeros());
        let work = heads
            .saturating_add(merge.take().saturating_add(2))
            .saturating_mul(3 * height + 4)
            .saturating_mul(calls);
        summary.steps = summary.steps.saturating_add(work);
        summary
            .costs
            .step(work, &format!("merge {}: heap work", merge.site), factors);
        let site = self
            .merge_sites
            .get_mut(&merge.site)
            .expect("lanes registered merge");
        site.max_lanes = site.max_lanes.max(heads);
        site.uniform = uniform;
        Ok(summary)
    }
}

fn read_only_setup(body: &[Stmt]) -> bool {
    body.iter().all(|stmt| match stmt {
        Stmt::Const { .. } | Stmt::Let { .. } | Stmt::Assign { .. } | Stmt::Require { .. } => true,
        Stmt::If {
            then_body,
            else_body,
            ..
        } => read_only_setup(then_body) && read_only_setup(else_body),
        _ => false,
    })
}
