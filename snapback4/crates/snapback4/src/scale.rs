//! Structural scale certificates, over the same IR the interpreter executes.
//! @ref LLP 3000.013#9 — explain corpus-dependent work without changing admission or meters.
use serde::Serialize;
use snapback4_core::{Ceilings, ir::*, schema::{Constraint, RuleExpr, Schema}, Value};
use std::collections::{BTreeMap, BTreeSet};

#[path = "scale/display.rs"]
mod display;
#[path = "scale/writes.rs"]
mod writes;
#[path = "scale/dependencies.rs"]
mod dependencies;
pub(crate) use display::summary;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Class { Constant, Grows }

#[derive(Debug, Serialize)]
pub(crate) struct Certificate {
    pub operation: String,
    pub class: Class,
    pub per_chunk: bool,
    pub bounds: Bounds,
    pub growth_sites: Vec<Growth>,
    pub per_write: Vec<String>,
    pub whole_job: Vec<String>,
}

/// Bounds are conservative allowances, not predictions or a promise that a
/// call fits its heap/output/step budget. Null lanes means meter-only discovery.
#[derive(Default, Debug, Serialize)]
pub(crate) struct Bounds {
    pub rows_examined: u64,
    pub probes: u64,
    pub lanes: Option<u64>,
    pub writes: u64,
    pub arguments: BTreeMap<String, u64>,
    pub meters: Ceilings,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub(crate) struct Growth {
    pub site: String,
    pub reason: String,
    pub rewrite: String,
}

pub(crate) fn analyze(schema: &Schema, program: &Program) -> Certificate {
    let ceilings = if program.kind == ProgramKind::Job { Ceilings::job() } else { Ceilings::default() };
    let mut a = Analysis {
        schema, program,
        result: Certificate {
            operation: program.name.clone(), class: Class::Constant,
            per_chunk: program.kind == ProgramKind::Job,
            bounds: Bounds { lanes: Some(0), meters: ceilings, ..Bounds::default() },
            growth_sites: Vec::new(), per_write: Vec::new(), whole_job: Vec::new(),
        },
        data: BTreeMap::new(), in_filter: false,
    };
    for (name, kind) in &program.args {
        a.data.insert(name.clone(), false);
        if let ArgType::List { max, .. } = kind { a.result.bounds.arguments.insert(name.clone(), u64::from(*max)); }
    }
    if program.native || program.kind == ProgramKind::Action {
        a.growth(&program.name, "work in the external handler (no Quarry body to certify)".into(),
            "express the data work as bounded Quarry operations and inspect their certificates");
        a.meter_allowance();
        a.result.bounds.lanes = None;
    } else {
        // @ref LLP 3000.013#5.2 — automatic sweeps commit at most 64 items;
        // retries only shrink that size. Inner domains still use the meter.
        for stmt in &program.body {
            if program.kind == ProgramKind::Job
                && let Stmt::For { domain: LoopDomain::Page(scan), .. } = stmt
                && scan.take == Bound::Meter {
                let mut chunk = stmt.clone();
                if let Stmt::For { domain: LoopDomain::Page(scan), .. } = &mut chunk {
                    scan.take = Bound::Literal(64);
                }
                a.body(std::slice::from_ref(&chunk), 1);
            } else { a.body(std::slice::from_ref(stmt), 1); }
        }
        if program.kind == ProgramKind::Job {
            for stmt in &program.body {
                if let Stmt::For { domain: LoopDomain::Page(scan), .. } = stmt {
                    a.result.whole_job.push(format!("rows visited/written by the sweep over `{}`", display::domain(schema, scan)));
                }
            }
        }
    }
    a.result.class = if a.result.growth_sites.is_empty() { Class::Constant } else { Class::Grows };
    // Do not clip structural allowances to ceilings: the runtime records
    // the charge that crosses a ceiling, and a query may try later sites.
    a.result
}

struct Analysis<'a> {
    schema: &'a Schema,
    program: &'a Program,
    result: Certificate,
    // A local's value may come from data even if obtaining it costs one read.
    // That distinction matters when it subsequently supplies a range bound.
    data: BTreeMap<String, bool>,
    in_filter: bool,
}

impl Analysis<'_> {
    fn growth(&mut self, site: &str, reason: String, rewrite: &str) {
        let growth = Growth { site: site.into(), reason, rewrite: rewrite.into() };
        if !self.result.growth_sites.contains(&growth) { self.result.growth_sites.push(growth); }
    }

    fn rows(&mut self, n: u64) { self.result.bounds.rows_examined = self.result.bounds.rows_examined.saturating_add(n); }
    fn probes(&mut self, n: u64) { self.result.bounds.probes = self.result.bounds.probes.saturating_add(n); }
    fn meter_allowance(&mut self) {
        // Implicit write work aborts on exhaustion, but records the failing
        // charge first. Maintained-column reservations can charge four rows
        // per maintain at once; authorization can reserve an entire rule.
        let rows = (self.schema.maintains.len() as u64).saturating_mul(4).max(1);
        let probes = self.schema.tables.values().map(|t| {
            let mut sites = Vec::new();
            snapback4_core::engine::rules::probe_sites(&t.rules.read, &mut sites);
            sites.len() as u64
        }).max().unwrap_or(0).max(1);
        self.rows(self.result.bounds.meters.examined.saturating_add(rows));
        self.probes(self.result.bounds.meters.rule_probes.saturating_add(probes));
        if self.program.kind != ProgramKind::Query { self.result.bounds.writes = self.result.bounds.meters.rows_written.saturating_add(rows); }
    }

    fn bound(&mut self, bound: &Bound) -> u64 {
        if let Bound::Arg { name, max } = bound { self.result.bounds.arguments.insert(name.clone(), u64::from(*max)); }
        match bound { Bound::Meter => self.result.bounds.meters.examined, _ => bound.maximum() }
    }

    fn body(&mut self, body: &[Stmt], times: u64) {
        for stmt in body {
            match stmt {
                Stmt::Const { name, value } | Stmt::Let { name, value } | Stmt::Assign { name, value } => {
                    let data = self.expr(value, times);
                    // Union assignments across branches and loop iterations;
                    // never clear a possible dependency on another path.
                    *self.data.entry(name.clone()).or_default() |= data;
                }
                Stmt::Push { target, value } => {
                    let data = self.expr(value, times);
                    *self.data.entry(target.clone()).or_default() |= data;
                }
                Stmt::Return(value) => { self.expr(value, times); }
                Stmt::Emit { payload, once, .. } => {
                    self.expr(payload, times);
                    if let Some(key) = once {
                        self.expr(key, times);
                        self.result.bounds.writes = self.result.bounds.writes.saturating_add(times);
                    }
                }
                Stmt::If { condition, then_body, else_body } => {
                    self.expr(condition, times);
                    self.body(then_body, times);
                    self.body(else_body, times);
                }
                Stmt::Require { condition, .. } => { self.expr(condition, times); }
                Stmt::Check { condition, current } => { self.expr(condition, times); self.point(current, times, true); }
                Stmt::For { binding, domain, body } => {
                    let (max, data) = self.domain(domain, times);
                    self.data.insert(binding.clone(), data);
                    // Later iterations can carry a dependency backwards
                    // through assignments. Resolve it before pricing once.
                    dependencies::fixed_point(&mut self.data, body);
                    self.body(body, times.saturating_mul(max));
                }
                Stmt::Insert { table, row } | Stmt::InsertIfAbsent { table, row, .. } => {
                    self.expr(row, times); self.write(table, "insert", times);
                    if let Stmt::InsertIfAbsent { result, .. } = stmt { self.data.insert(result.clone(), true); }
                }
                Stmt::Update { table, key, patch } => {
                    self.expr(key, times); self.expr(patch, times); self.write(table, "update", times);
                }
                Stmt::Upsert { table, key, row } => {
                    self.expr(key, times); self.expr(row, times); self.write(table, "upsert", times);
                }
                Stmt::Delete { table, key } => { self.expr(key, times); self.write(table, "delete", times); }
                Stmt::WriteTarget { target, patch, upsert, condition, result } => {
                    self.point(target, times, false);
                    self.expr(patch, times);
                    if let Some(c) = condition { self.body(&c.setup, times); self.expr(&c.value, times); }
                    self.write(&target.table, if *upsert { "upsert" } else { "update" }, times);
                    if let Some(name) = result { self.data.insert(name.clone(), true); }
                }
                Stmt::Break | Stmt::Continue => {}
            }
        }
    }

    fn domain(&mut self, domain: &LoopDomain, times: u64) -> (u64, bool) {
        match domain {
            LoopDomain::Page(scan) => { self.scan(scan, times, false); (self.bound(&scan.take), true) }
            LoopDomain::LiteralRange { start, end_exclusive } => (end_exclusive.saturating_sub(*start).max(0) as u64, false),
            LoopDomain::ExpressionRange { start, end_exclusive } => {
                let data = self.expr(start, times) | self.expr(end_exclusive, times);
                let max = display::range_size(start, end_exclusive);
                if max.is_none() && data {
                    self.growth(&self.program.name, format!("iterations of range({}, {}) from stored data", display::expr(start), display::expr(end_exclusive)),
                        "cap the domain or pass a bounded list argument");
                }
                // An input-only range is independent of corpus size; its
                // admitted iterations still cannot exceed the step ceiling.
                (max.unwrap_or(self.result.bounds.meters.steps), data)
            }
            LoopDomain::ArgList { name, max } => {
                self.result.bounds.arguments.insert(name.clone(), u64::from(*max));
                (u64::from(*max), false)
            }
            LoopDomain::DerivedArray { value, max, .. } => (u64::from(*max), self.expr(value, times)),
            LoopDomain::Recurse(r) => {
                self.expr(&r.seed, times);
                // Execution visits depths 0..=depth: include the seed,
                // then branch at every subsequent depth, not just once.
                let mut width = 1_u64;
                let mut total = 1_u64;
                for _ in 0..r.depth { width = width.saturating_mul(u64::from(r.fanout.max(1))); total = total.saturating_add(width); }
                self.point_work(&r.table, &r.index, &r.site, total.saturating_mul(times), true);
                (total, true)
            }
        }
    }

    fn expr(&mut self, expr: &Expr, times: u64) -> bool {
        match expr {
            Expr::Literal(_) | Expr::Input(_) => false,
            Expr::Variable(name) => self.data.get(name).copied().unwrap_or(true),
            Expr::Field { base, .. } => self.expr(base, times),
            Expr::Array(values) => values.iter().fold(false, |d, e| self.expr(e, times) | d),
            Expr::Object(values) => values.values().fold(false, |d, e| self.expr(e, times) | d),
            Expr::Shape { base, fields } => {
                let data = self.expr(base, times);
                fields.values().fold(data, |d, e| self.expr(e, times) | d)
            }
            Expr::Binary { left, right, .. } => self.expr(left, times) | self.expr(right, times),
            Expr::Unary { value, .. } => self.expr(value, times),
            Expr::Builtin { builtin, args } => args.iter().fold(matches!(builtin, Builtin::Connected), |d, e| self.expr(e, times) | d),
            Expr::Get(read) | Expr::Exists(read) => { self.point(read, times, true); true }
            Expr::Block { body, value } => { self.body(body, times); self.expr(value, times) }
            Expr::Scan(scan) => { self.scan(scan, times, false); true }
            Expr::Merge(merge) => {
                if let Some(after) = merge.position.as_ref().and_then(|p| p.after.as_ref()) {
                    self.expr(after, times);
                }
                for lane in &merge.lanes {
                    if let Some(guard) = &lane.guard { self.expr(guard, times); }
                    let count = match &lane.source {
                        None => 1,
                        Some(LaneSource::Scan(scan)) => { self.scan(scan, times, false); self.bound(&scan.take) }
                        Some(LaneSource::List { value, max }) => { self.expr(value, times); u64::from(*max) }
                        Some(LaneSource::Range { start, end_exclusive, max }) => {
                            self.domain(&LoopDomain::ExpressionRange { start: start.clone(), end_exclusive: end_exclusive.clone() }, times);
                            max.or_else(|| display::range_size(start, end_exclusive)).unwrap_or(self.result.bounds.meters.steps)
                        }
                    };
                    let static_max = match &lane.source {
                        Some(LaneSource::Range { start, end_exclusive, max }) => {
                            // Range arguments have a fixed admitted iteration
                            // allowance even when no literal span is known.
                            Some(max.or_else(|| display::range_size(start, end_exclusive)).unwrap_or(self.result.bounds.meters.steps))
                        }
                        source => source.as_ref().map_or(Some(1), LaneSource::static_max),
                    };
                    self.result.bounds.lanes = self.result.bounds.lanes.zip(static_max).map(|(a, b)| a.saturating_add(b.saturating_mul(times)));
                    self.data.insert(lane.binding.clone(), lane.source.is_some());
                    if let Some(distinct) = &lane.distinct { self.expr(distinct, times.saturating_mul(count)); }
                    self.body(&lane.setup, times.saturating_mul(count));
                    if let Some(position) = &merge.position {
                        // Projected views eagerly read take+1 per source lane,
                        // then project every authorized candidate before sorting.
                        let mut scan = lane.scan.clone();
                        scan.take = Bound::Literal(position.take.saturating_add(1));
                        self.scan(&scan, times.saturating_mul(count), false);
                        if let Some(project) = &lane.project {
                            self.expr(project, times.saturating_mul(count).saturating_mul(u64::from(position.take) + 1));
                        }
                    } else {
                        self.scan(&lane.scan, times.saturating_mul(count), true);
                    }
                }
                true
            }
        }
    }

    fn point(&mut self, read: &Read, times: u64, authorize: bool) {
        for key in &read.key { self.expr(key, times); }
        self.point_work(&read.table, &read.index, &read.site, times, authorize);
    }

    fn point_work(&mut self, table: &str, index: &str, site: &str, times: u64, authorize: bool) {
        self.rows(times.saturating_mul(if self.schema.table(table).is_some_and(|t| t.expire.is_some()) { 2 } else { 1 }));
        if self.in_filter { self.probes(times); }
        self.lookup_growth(table, index, site);
        if authorize && let Some(table) = self.schema.table(table) { self.rule(&table.rules.read, site, times); }
    }

    fn lookup_growth(&mut self, name: &str, index: &str, site: &str) {
        if self.schema.table(name).is_some_and(|t| t.expire.is_some()) && index != "byId" {
            self.growth(site, format!("expired {name} rows skipped by the `{index}` lookup"),
                "read by id, or use a non-expiring keyed view");
            self.rows(self.result.bounds.meters.examined);
        }
        if let Some(m) = self.schema.maintain_for(name)
            && self.schema.table(&m.source).is_some_and(|t| t.expire.is_some()) {
            self.growth(site, format!("live {} rows in the group behind `{name}`", m.source),
                "use a view over non-expiring contributions, or cap the source domain");
            self.rows(self.result.bounds.meters.examined);
        }
    }

    fn rule(&mut self, rule: &RuleExpr, site: &str, times: u64) {
        match rule {
            RuleExpr::Exists { table, index, .. } => {
                self.lookup_growth(table, index, site);
                // Static reservation and evaluation can both charge a probe.
                self.probes(times.saturating_mul(2));
            }
            RuleExpr::Created { table, index, equalities, .. } if !equalities.is_empty() => {
                self.lookup_growth(table, index, site); self.probes(times.saturating_mul(2));
            }
            RuleExpr::And(parts) | RuleExpr::Or(parts) => { for part in parts { self.rule(part, site, times); } }
            RuleExpr::Not(part) => self.rule(part, site, times),
            _ => {}
        }
    }

    fn scan(&mut self, scan: &Scan, times: u64, merged: bool) {
        for key in &scan.prefix { match key { IndexKeyExpr::Scalar(e) | IndexKeyExpr::WordPrefix(e) => { self.expr(e, times); } } }
        for e in [&scan.after, &scan.before].into_iter().flatten() { self.expr(e, times); }
        if let Some(r) = &scan.range { for e in [&r.gt, &r.gte, &r.lt, &r.lte].into_iter().flatten() { self.expr(e, times); } }
        let take = self.bound(&scan.take);
        let visibility = snapback4_core::engine::rules::scan_visibility(self.schema, scan);
        let table = self.schema.table(&scan.table);
        let mut grows = false;
        if scan.take == Bound::Meter {
            self.growth(&scan.site, format!("{} in the domain `{}`", scan.table, display::domain(self.schema, scan)),
                "cap the domain, page it, or add a maintained view for its aggregate");
            grows = true;
        }
        if let Some(filter) = &scan.filter {
            let timeline = self.schema.timelines.iter().find(|t| ["Feed", "Broadcast"].iter().any(|suffix| t.table(suffix) == scan.table));
            let reason = if let Some(t) = timeline {
                format!("Following `{}` entries skipped by removal tombstones before {} match", t.name, display::bound(&scan.take))
            } else { format!("{} skipped by `{}` before {} match", scan.table, display::expr(filter), display::bound(&scan.take)) };
            self.growth(&scan.site, reason,
                "pin the filter column in the read, or add a view indexed by that predicate");
            grows = true;
        }
        if !visibility.uniform && self.program.kind != ProgramKind::Job {
            self.growth(&scan.site, format!("{} skipped by its per-row read rule", scan.table),
                "pin the read rule's deciding columns in the domain");
            grows = true;
        }
        if table.is_some_and(|t| t.expire.is_some()) {
            self.growth(&scan.site, format!("expired {} rows skipped before {} live rows match", scan.table, display::bound(&scan.take)),
                "seek on the expiry column, or read a non-expiring keyed view");
            grows = true;
        }
        if scan.prefix.iter().any(|key| matches!(key, IndexKeyExpr::WordPrefix(_))) {
            self.growth(&scan.site, format!("matching words and candidate {} rows (additional search terms filter)", scan.table),
                "use an equality-pinned domain for a fixed-cost read; word-prefix search remains data-dependent");
            self.result.bounds.lanes = None;
            grows = true;
        }
        // A lazy lane can pop each of the `take` unique rows, including
        // duplicates already emitted by another lane. Every pop can refill:
        // one opening + `take` refills, each with its own lookahead and rule.
        // This also covers the <=8-lane/eager path (one take+1 batch, plus
        // lookahead). Existence stops at its first witness, without refills.
        let scans = if merged && !scan.existence { take.saturating_add(1) } else { 1 };
        let candidates = if grows { self.result.bounds.meters.examined.saturating_add(1) }
            else if merged && !scan.existence { scans.saturating_mul(2) }
            else { take.saturating_add(u64::from(!scan.existence)) };
        // Cut::Abort charges an admission unit before traversing each scan,
        // including empty openings and every merge refill, in mutations/jobs.
        let admission = if self.program.kind == ProgramKind::Query { 0 } else { scans };
        self.rows(times.saturating_mul(candidates.saturating_add(admission)));
        // Rules remain before all projections, filters, counts and ordering.
        if !visibility.decided_true && let Some(table) = table {
            self.rule(&table.rules.read, &scan.site, times.saturating_mul(if visibility.uniform { scans } else { candidates }));
        }
        // A scan already explains expiry; only the implicit live-aggregate
        // source work needs the point-lookup check here.
        self.lookup_growth(&scan.table, "byId", &scan.site);
        if let Some(filter) = &scan.filter {
            let previous = self.in_filter;
            self.in_filter = true;
            self.expr(filter, times.saturating_mul(candidates));
            self.in_filter = previous;
        }
    }
}
