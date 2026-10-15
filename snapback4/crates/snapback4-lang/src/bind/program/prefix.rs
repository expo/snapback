//! One recognition of point keys versus prefix populations, shared by reads,
//! loop domains, merge discovery and program existence tests.
use super::*;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Position { Page, Domain, Aggregate, Exists }

impl Binder<'_> {
    pub(super) fn is_page(&self, read: &ReadExpr, point: ReadMode) -> Fallible<bool> {
        let global = read.keys.is_empty() && self.catalog.tables.get(&read.table)
            .and_then(|table| table.maintained.as_ref()).is_some_and(|maintain| maintain.by.is_empty());
        if !read.order_keys.is_empty() || read.range.is_some() || read.matching.is_some() || read.filter.is_some() || !read.seeks.is_empty() || read.keys.is_empty() && !global { return Ok(true); }
        if global { return Ok(false); }
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
        // One group per distinct source key: a parent-scoped source cap bounds
        // its aggregate rows too, without copying a constraint onto the view.
        // A pinned unique key bounds the group as a cap does (wave 3 #7); `.id = x`
        // plans as the closed seek `.id >= x and .id <= x` on the next column.
        let mut equal = pinned.to_vec();
        if let Some(next) = index.columns.get(read.keys.len()) {
            let printed = |op: &str| read.seeks.iter().filter(|seek| &seek.column == next && seek.op == op).map(|seek| crate::print::expression(&seek.value)).collect::<Vec<_>>();
            let (low, high) = (printed(">="), printed("<="));
            if read.seeks.len() == 2 && low.len() == 1 && low == high { equal.push(next.clone()); }
        }
        let cap = self.schema.group_bound(&read.table, pinned).into_iter().chain(crate::bind::unique_bound::unique_bound(self.schema, &read.table, &equal)).min().or_else(|| {
            let m = self.schema.maintain_for(&read.table)?;
            let parent = m.parent_key.as_ref()?;
            pinned.contains(&parent.reference).then(|| self.schema.group_bound(&m.source, &[parent.reference.clone()])).flatten()
        });
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
            // @ref LLP 3000.036#13.3 — a synced table's horizon keeps the newest rows, so its page reads newest first:
            // the page rewrite and N_NO_HORIZON's window then agree, and applying both draws no N_SYNC_ORDER.
            let window = self.schema.table(&read.table).and_then(|table| table.sync.as_ref()).map(|sync| sync.horizon.as_ref().map(|window| window.by.clone()));
            if let Some(Some(by)) = &window
                && let Some(horizon) = self.catalog.tables.get(&read.table).and_then(|info| info.indexes.iter().find(|candidate| &candidate.name == by))
                && horizon.words.is_none() && horizon.columns.len() > pinned.len() && horizon.columns[..pinned.len()] == *pinned {
                page.index = Some(horizon.name.clone());
            }
            let order = if window.is_some() { ast::Order::Desc } else { ast::Order::Asc };
            page.range = Some(ast::RangeSpec { order, take: 50, cursor: Some(Box::new(A::Name { name: "c".into(), site: read.site.clone() })), site: read.site.clone() });
            let suggestion = format!("page with `{} N` and a cursor: `{}` (declare `c: cursor ?`)", if window.is_some() { "last" } else { "first" }, self.catalog.source.expression(&A::Read(page.clone())));
            // A filter pinning a whole unique key names at most one row: offer the one-row read first.
            let one = (index.unique && index.words.is_none() && !pinned.is_empty() && pinned.len() == index.columns.len()).then(|| {
                let mut one = page.clone();
                one.range = Some(ast::RangeSpec { order: ast::Order::Asc, take: 1, cursor: None, site: read.site.clone() });
                format!("`unique {}` makes this at most one row: `{}`; or ", pinned.join(", "), self.catalog.source.expression(&A::Read(one)))
            }).unwrap_or_default();
            let rewrite = if cap.is_none() { format!("{one}declare `cap N{columns}` on {}, or {suggestion}", read.table) } else { suggestion };
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

    pub(super) fn check_meter_prefix(&mut self, read: &ReadExpr, scan: &Scan, aggregate: bool) -> Fallible<()> {
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
        // @ref LLP 3000.028#4-put-the-rules-where-the-builder-meets-them — preserve the loop, callers and truncation cost in the reason.
        let jobs = self.call_chain.last().filter(|_| self.call_chain.len() > 1)
            .map(|(helper, _)| self.helper_job_callers(helper)).unwrap_or_default();
        let query_site = &self.call_chain[0].1;
        let declaration = self.catalog.source.declarations.get(&query_site.to_string());
        if aggregate && (self.caller_kind != ProgramKind::Query || jobs.is_empty() || declaration.is_none()) {
            // @ref LLP 3000.036#11 — a total has no first-N repair (app-farm lane 087).
            let deciding = if missing.is_empty() { leading.join(", ") } else { missing.iter().map(|c| format!(".{c}")).collect::<Vec<_>>().join(", ") };
            let grant = snapback4_core::engine::rules::grant_decision(self.schema, scan);
            // @ref LLP 3000.036#17.8 — a readable grant the program requires before the total (`require exists staff[viewer]`)
            // makes every row readable for every caller who reaches it, which the server decides once (read.rs `granted`).
            let guard = grant.as_ref().map_or_else(String::new, |grant| format!("; or guard it with the grant, so every caller who reaches it reads every row: `require {} else …` before it (or `if {}:` around it)", grant.quarry(), grant.quarry()));
            let diagnostic = Diagnostic::new(&read.site, "E_QUARRY_BOUND", format!("{} by {}: a total over rows the viewer may only partly read is not decided by its pinned columns, so no page bound makes it exact", scan.table, scan.index),
                format!("pin {deciding} with where equalities so one verdict covers every row (the total then covers only that scope){guard}; {}. If the maintained count keeps the source's private read rule, its group keys must carry every field that rule reads (including {deciding}); a public total instead deliberately discloses the count across hidden rows; or return a `first N` page with a cursor and fold it in the client", self.total_view_recipe(read, scan))).guide("bounds");
            if grant.is_some() && self.caller_kind == ProgramKind::Query && self.call_chain.len() == 1 {
                self.pending_totals.push((scan.site.clone(), diagnostic));
                return Ok(());
            }
            return Err(diagnostic);
        }
        if self.caller_kind != ProgramKind::Query || jobs.is_empty() || declaration.is_none() {
            return Err(Diagnostic::new(&read.site, "E_QUARRY_BOUND", format!("{} by {}: a meter-bounded prefix needs a read rule uniformly decided by its pinned columns", scan.table, scan.index),
                format!("use `first N`: `{}` (declare `c: cursor ?` and follow its cursor); for a complete read, scan by an index leading with {} and pin the deciding columns (N_NEVER_COMPLETE)", self.catalog.source.expression(&A::Read(page)), leading.join(", "))).guide("bounds"));
        }
        let chain = self.call_chain.iter().map(|(name, site)| format!("{name} (at {site})")).collect::<Vec<_>>().join(" -> ");
        let job = format!("the system job caller(s) {}", jobs.join(", "));
        let authored = self.catalog.read_origins.get(&read.site.to_string()).cloned().unwrap_or_else(|| self.catalog.source.expression(&A::Read(read.clone())));
        let rule = if missing.is_empty() { "read rule".into() } else { format!("{}-based read rule", missing.join(", ")) };
        // @ref LLP 3000.007#23 — a whole-query replacement points to that declaration, never its shared helper.
        let end = query_site.line + declaration.unwrap().lines().count() as u32 - 1;
        let context = format!("; viewer query caller chain: {chain}. `{authored}` (at {}) does not decide its {rule}; a helper grants no system authority. The replacement is for the entire unused viewer query `{}`: replace lines {}-{end} in {} with the printed comment. Keep the complete scheduled job. A separately named paged preview needs its own cursor; `first 50` is a partial preview, not an equivalent complete total. For a complete per-group read, pin {}. Inner recipient work must fit one chunk even when the outer sweep adapts its chunk size; an oversized recipient parks with E_BOUND rather than committing a partial total", read.site, self.call_chain[0].0, query_site.line, query_site.file, leading.join(", "));
        Err(Diagnostic::new(query_site, "E_QUARRY_BOUND", format!("{} by {}: a meter-bounded prefix needs a read rule uniformly decided by its pinned columns{context}", scan.table, scan.index),
            format!("-- {} removed: keep the complete helper under {job}'s chunk meter.", self.call_chain[0].0)).guide("bounds"))
    }

    /// A maintained view that keeps this total, rendered from the author's own
    /// table, column and group (lanes 007 062 067: "hard to map to this schema").
    // @ref LLP 3000.036#13.10 — a total over partly readable rows: the view discloses the total, never the rows.
    fn total_view_recipe(&self, read: &ReadExpr, scan: &Scan) -> String {
        use crate::bind::intent::{column, split};
        let table = &scan.table;
        let (kind, of) = self.total.clone().unwrap_or(("count", None));
        // The group: the read's equalities, in its index order.
        let mut groups: Vec<(String, String)> = read.keys.iter().filter_map(|key| key.column.clone().map(|column| (column, print::expression(&key.value)))).collect();
        let mut filters = Vec::new();
        if let Some(filter) = read.filter.clone() { split(*filter, &mut filters); }
        for filter in &filters {
            if let A::Binary { op, left, right, .. } = filter && op == "=" && let Some(col) = column(left)
                && super::super::intent::independent(right) && !groups.iter().any(|(c, _)| c == col) {
                groups.push((col.to_owned(), print::expression(right)));
            }
        }
        let suffix = if kind == "count" { "Count" } else { "Total" };
        let name = format!("{table}{suffix}");
        let aggregate = match &of { Some(column) => format!("sum {table} of {column}"), None => format!("count {table}") };
        let (readers, who) = match snapback4_core::engine::rules::grant_decision(self.schema, scan) {
            Some(grant) => (grant.quarry(), "the callers that grant admits"),
            None => ("allow".to_owned(), "everyone; narrow it to the readers the total is for"),
        };
        if groups.is_empty() {
            // @ref LLP 3000.036#17.2 — a view needs a group key (the core refuses an empty `by`): a whole-table
            // total groups by a column every row holds the same value of (lane 020 pasted `count t` and got E_QUARRY_SYNTAX).
            let key = (1..).map(|n| if n == 1 { "totalKey".to_owned() } else { format!("totalKey{n}") })
                .find(|key| !table_columns(self.schema, table).contains(key)).unwrap();
            return format!("or keep the total in a view, which discloses the total, never the rows; a view groups by a key, so give every {table} row the same one: add `{key}: enum('all') default 'all'` and `immutable {key}` to {table}, declare `view {name}: {aggregate} by .{key}` with `read <- {readers}` ({who}), then read `{name}['all']`");
        }
        let by = format!(" by {}", groups.iter().map(|(c, _)| format!(".{c}")).collect::<Vec<_>>().join(", "));
        let lookup = format!("{name}[{}]", groups.iter().map(|(_, v)| v.clone()).collect::<Vec<_>>().join(", "));
        format!("or keep the total in a view, which discloses the total, never the rows: `view {name}: {aggregate}{by}` with `read <- {readers}` ({who}), then read `{lookup}`")
    }

    // @ref LLP 3000.007#20.22 — ruling 25: program existence over a prefix is a top-1 scan below page ownership; rule probes retain their exact-key path.
    pub(super) fn exists_read(&mut self, read: &ReadExpr, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        if self.catalog.tables.get(&read.table).and_then(|table| table.maintained.as_ref())
            .is_some_and(|maintain| maintain.by.is_empty())
        {
            return Err(type_error(&read.site, format!("{} is one global maintained scalar, not an existence probe", read.table),
                format!("compare the bare scalar instead: `{} > 0`", read.table)).guide("maintains"));
        }
        self.exists_probe(read, out).map_err(|error| super::super::bracket_ranges::refusal(read, false, error))
    }

    fn exists_probe(&mut self, read: &ReadExpr, out: &mut setup::Body) -> Fallible<(Expr, Ty)> {
        if !self.is_page(read, ReadMode::Exists)? { return Ok((self.read_value(read, ReadMode::Exists, out)?, Ty::Bool)); }
        let (scan, _) = self.scan_at(read, out, Position::Exists)?;
        Ok((Expr::Binary { op: BinaryOp::Gt, left: Box::new(Expr::Builtin { builtin: Builtin::Count, args: vec![Expr::Scan(scan)] }), right: Box::new(Expr::Literal(Value::Int(0))) }, Ty::Bool))
    }
}

fn table_columns(schema: &snapback4_core::schema::Schema, table: &str) -> Vec<String> {
    schema.table(table).map(|t| t.columns.keys().cloned().collect()).unwrap_or_default()
}
