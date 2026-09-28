//! One recognition of point keys versus prefix populations, shared by reads,
//! loop domains, merge discovery and program existence tests.
use super::*;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Position { Page, Domain, Aggregate, Exists }

impl Binder<'_> {
    pub(super) fn is_page(&self, read: &ReadExpr, point: ReadMode) -> Fallible<bool> {
        if !read.order_keys.is_empty() || read.range.is_some() || read.matching.is_some() || read.filter.is_some() || !read.seeks.is_empty() || read.keys.is_empty() { return Ok(true); }
        // Speculation cannot emit setup or consume compiler names. The selected
        // form binds its key expressions exactly once in the caller's body.
        let mut probe = self.clone();
        let info = probe.table(&read.table, &read.site)?;
        let mut lookup = read.clone();
        if point == ReadMode::FilteredPoint && info.maintained.is_some() && lookup.index.is_none() { lookup.index = Some("byGroup".into()); }
        match probe.select_index(info, &lookup, point, &mut setup::Body::default()) {
            Ok(_) => Ok(false),
            Err(error) if error.code == "E_QUARRY_AMBIGUOUS" => Err(error),
            Err(point_error) => {
                // Only an actual index prefix changes the form. A mistyped
                // full key or an uncovered named equality keeps its point
                // diagnostic, including the established repair.
                let mut probe = self.clone();
                match probe.select_index(info, read, ReadMode::Range, &mut setup::Body::default()) {
                    Ok(_) => Ok(true),
                    Err(error) if error.code == "E_QUARRY_AMBIGUOUS" => Err(error),
                    Err(error) if error.code == "E_QUARRY_POSITIONAL_SCAN" => Err(error),
                    Err(_) => Err(point_error),
                }
            },
        }
    }

    pub(super) fn prefix_bound(&self, read: &ReadExpr, index: &ast::IndexDecl, position: Position) -> Fallible<(ast::RangeSpec, Bound)> {
        if let Some(range) = &read.range { return Ok((range.clone(), Bound::Literal(range.take))); }
        let ceiling = if self.caller_kind == ProgramKind::Job { snapback4_core::Ceilings::job() } else { snapback4_core::Ceilings::default() }.examined;
        let pinned = &index.columns[..read.keys.len()];
        let cap = self.schema.group_bound(&read.table, pinned);
        let bound = if position == Position::Exists { Bound::Literal(1) }
        // @ref LLP 3000.007#20.22 — ruling 24: the schema cap supplies the whole group's ordinary literal scan bound.
        // Queries with a non-uniform rule keep this existing capped path;
        // scan_at upgrades uniformly decided aggregates to streaming below.
        else if position == Position::Aggregate && self.caller_kind == ProgramKind::Query && let Some(cap) = cap.filter(|cap| u64::from(*cap) <= ceiling) { Bound::Literal(cap) }
        else if position == Position::Aggregate || (position == Position::Domain && self.caller_kind == ProgramKind::Job) { Bound::Meter }
        else if let Some(cap) = cap.filter(|cap| u64::from(*cap) <= ceiling) { Bound::Literal(cap) }
        // @ref LLP 3000.007#20.22 — ruling 23: only query loop and lane domains may consume a prefix under the examined meter.
        else if position == Position::Domain && self.caller_kind == ProgramKind::Query { Bound::Meter }
        else {
            let columns = if pinned.is_empty() { String::new() } else { format!(" by {}", pinned.join(", ")) };
            let mut page = read.clone();
            page.index = Some(index.name.clone());
            page.range = Some(ast::RangeSpec { order: ast::Order::Asc, take: 50, cursor: Some(Box::new(A::Name { name: "c".into(), site: read.site.clone() })), site: read.site.clone() });
            let suggestion = format!("page with `first N` and a cursor: `{}` (declare `c: cursor ?`)", self.catalog.source.expression(&A::Read(page.clone())));
            let rewrite = if cap.is_none() { format!("declare `cap N{columns}` on {}, or {suggestion}", read.table) } else { suggestion };
            let message = match cap {
                Some(cap) => format!("{}'s whole group has cap {cap}, above the {ceiling} examined ceiling; one read cannot examine the whole group", read.table),
                None => format!("{} has no cap over this prefix; this position needs a bounded page", read.table),
            };
            return Err(if position == Position::Domain && self.caller_kind != ProgramKind::Query {
                placement(&read.site, format!("{message}; meter-bounded prefix loops and lane sources belong in queries"), rewrite).guide("bounds")
            } else { Diagnostic::new(&read.site, "E_QUARRY_BOUND", message, rewrite).guide("bounds") });
        };
        if !read.seeks.is_empty() && read.order_keys.is_empty() && !matches!(position, Position::Aggregate | Position::Exists) && !(position == Position::Domain && self.caller_kind == ProgramKind::Job) {
            return Err(Diagnostic::new(&read.site, "E_QUARRY_BOUND", "a seek needs an explicit page bound", format!("{} first 50 by {}", self.catalog.source.expression(&A::Read(read.clone())), index.name)).guide("bounds"));
        }
        Ok((ast::RangeSpec { order: ast::Order::Asc, take: bound.maximum() as u32, cursor: None, site: read.site.clone() }, bound))
    }

    pub(super) fn check_meter_prefix(&self, read: &ReadExpr, scan: &Scan) -> Fallible<()> {
        if scan.take != Bound::Meter || snapback4_core::engine::rules::scan_visibility(self.schema, scan).uniform { return Ok(()); }
        let table = &self.schema.tables[&scan.table];
        let index = &table.indexes[&scan.index];
        let pinned = index.columns().into_iter().take(scan.prefix.len()).collect::<std::collections::BTreeSet<_>>();
        let used = snapback4_core::engine::rules::deciding_fields(&scan.table, table, &table.rules.read);
        let missing = used.difference(&pinned).cloned().collect::<Vec<_>>();
        let mut leading = missing.clone();
        for column in index.columns().into_iter().skip(scan.prefix.len()) { if !leading.contains(&column) { leading.push(column); } }
        let mut page = read.clone();
        page.range = Some(ast::RangeSpec { order: ast::Order::Asc, take: 50, cursor: Some(Box::new(A::Name { name: "c".into(), site: read.site.clone() })), site: read.site.clone() });
        // @ref LLP 3000.028#4-put-the-rules-where-the-builder-meets-them — preserve the refusal at the loop, with its callers and the cost of truncating a total.
        let jobs = self.call_chain.last().filter(|_| self.call_chain.len() > 1)
            .map(|(helper, _)| self.helper_job_callers(helper)).unwrap_or_default();
        if self.caller_kind != ProgramKind::Query || jobs.is_empty() {
            return Err(Diagnostic::new(&read.site, "E_QUARRY_BOUND", format!("{} by {}: a meter-bounded prefix needs a read rule uniformly decided by its pinned columns", scan.table, scan.index),
                format!("use `first N`: `{}` (declare `c: cursor ?` and follow its cursor); for a complete read, scan by an index leading with {} and pin the deciding columns (N_NEVER_COMPLETE)", self.catalog.source.expression(&A::Read(page)), leading.join(", "))).guide("bounds"));
        }
        let chain = self.call_chain.iter().map(|(name, site)| format!("{name} (at {site})")).collect::<Vec<_>>().join(" -> ");
        let job = format!("the system job caller(s) {}", jobs.join(", "));
        let authored = self.catalog.read_origins.get(&read.site.to_string()).cloned().unwrap_or_else(|| self.catalog.source.expression(&A::Read(read.clone())));
        let rule = if missing.is_empty() { "read rule".into() } else { format!("{}-based read rule", missing.join(", ")) };
        let context = format!("; viewer query caller chain: {chain}. `{authored}` does not decide its {rule}; a helper grants no system authority");
        Err(Diagnostic::new(&read.site, "E_QUARRY_BOUND", format!("{} by {}: a meter-bounded prefix needs a read rule uniformly decided by its pinned columns{context}", scan.table, scan.index),
            format!("use `first N` only for a separately named paged preview: `{}` (declare `c: cursor ?` and follow its cursor); `first 50` is a partial preview, not an equivalent complete total. For a complete per-group read, scan by an index leading with {} and pin the deciding columns (N_NEVER_COMPLETE). Or keep the complete scheduled job: this loop is permitted under {job}'s chunk meter. Inner recipient work must fit one chunk even when the outer sweep adapts its chunk size; an oversized recipient parks with E_BOUND rather than committing a partial total. See guide jobs",
                self.catalog.source.expression(&A::Read(page)), leading.join(", "))).guide("bounds"))
    }

    // @ref LLP 3000.007#20.22 — ruling 25: program existence over a prefix is a top-1 scan below page ownership; rule probes retain their exact-key path.
    pub(super) fn exists_read(&mut self, read: &ReadExpr, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        if !self.is_page(read, ReadMode::Exists)? { return Ok((self.read_value(read, ReadMode::Exists, out)?, Ty::Bool)); }
        let (scan, _) = self.scan_at(read, out, Position::Exists)?;
        Ok((Expr::Binary { op: BinaryOp::Gt, left: Box::new(Expr::Builtin { builtin: Builtin::Count, args: vec![Expr::Scan(scan)] }), right: Box::new(Expr::Literal(Value::Int(0))) }, Ty::Bool))
    }
}
