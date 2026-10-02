//! Authoring advice only: the runtime still owns resource admission.
use super::*;

impl Binder<'_> {
    // @ref LLP 3000.007#24 — a data-dependent shape read is a note, never a static cost refusal.
    pub(super) fn shape_meter_note(&mut self, scan: &Scan, read: &ReadExpr) {
        let Some((field, shape_site)) = &self.shape_field else { return };
        if self.caller_kind != ProgramKind::Query { return; }
        let ceiling = snapback4_core::Ceilings::default().examined;
        let index = &self.schema.tables[&scan.table].indexes[&scan.index];
        let pinned = index.columns().into_iter().take(scan.prefix.len()).collect::<Vec<_>>();
        let cap = self.schema.group_bound(&scan.table, &pinned).or_else(|| {
            let maintain = self.schema.maintain_for(&scan.table)?;
            let parent = maintain.parent_key.as_ref()?;
            pinned.contains(&parent.reference).then(|| self.schema.group_bound(&maintain.source, &[parent.reference.clone()])).flatten()
        });
        // A cap bounds candidates even when a residual rejects every one.
        if cap.is_some_and(|n| u64::from(n) <= ceiling) { return; }
        let info = &self.catalog.tables[&scan.table];
        if info.indexes.iter().any(|i| info.total_unique(i) && i.columns.iter().all(|c| pinned.contains(c))) { return; }
        // A page limit bounds emitted rows, not rows rejected by its predicate
        // or read rule. Allow one lookahead candidate for an ordinary page.
        let uniform = snapback4_core::engine::rules::scan_visibility(self.schema, scan).uniform;
        let limit = match scan.take { Bound::Literal(n) => Some(u64::from(n) + 1), _ => None };
        if scan.filter.is_none() && uniform && limit.is_some_and(|n| n <= ceiling) { return; }
        let reason = if let Some(cap) = cap {
            format!("its candidate cap {cap} exceeds the default {ceiling}-row examined meter")
        } else if limit.is_some() && (scan.filter.is_some() || !uniform) {
            format!("its page limit bounds matches, but rejected candidates can grow past the default {ceiling}-row examined meter")
        } else if let Some(limit) = limit {
            format!("its page and lookahead can examine {limit} rows, above the default {ceiling}-row examined meter")
        } else {
            format!("its candidate population has no static bound and can grow past the default {ceiling}-row examined meter")
        };
        let helpers = self.call_chain.iter().skip(1).map(|(name, site)| format!("{name} at {site}")).collect::<Vec<_>>();
        let via = if helpers.is_empty() { String::new() } else { format!(" via {}", helpers.join(" -> ")) };
        self.notes.push(Diagnostic::new(&read.site, "N_SHAPE_METER",
            format!("query {} shape field `{field}` at {shape_site}, read {} on {}{via}: {reason}; the shape may fail to finish at scale (E_SHAPE_EXCEEDS_METER on a no-progress returned-page retry); use a maintained count/view (guide views), `first N`/`last N` for a preview, or move the work out of the returned shape", self.name, scan.site, scan.table),
            "use a maintained count or view for an exact total (`view unreadCounts: count messages by members m where ...`, then `unreadCounts[.id]`; guide views); use `first N`/`last N` for a bounded preview, keeping residual candidate work bounded; or move this work out of the returned shape into a separate query").guide("reads"));
    }
}
