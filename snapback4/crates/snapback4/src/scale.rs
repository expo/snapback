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
#[path = "scale/windows.rs"]
mod windows;
pub(crate) use display::summary;
pub(crate) use display::expr as expression;

/// Constant work, work that background cleanup returns to constant, or work
/// that grows with the corpus; a certificate takes the worst of its sites.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Class { Constant, Backlog, Grows }

#[derive(Debug, Serialize)]
pub(crate) struct Certificate {
    pub operation: String,
    pub class: Class,
    pub per_chunk: bool,
    pub bounds: Bounds,
    pub growth_sites: Vec<Growth>,
    pub per_write: Vec<String>,
    pub aggregates: Vec<String>,
    pub whole_job: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub variants: Vec<Variant>,
}

#[derive(Debug, Serialize)]
pub(crate) struct Variant {
    pub when: String,
    pub class: Class,
    pub indexes: BTreeSet<String>,
    /// The presence conditions `when` names, each argument present or absent.
    #[serde(skip)]
    pub conditions: Vec<(String, bool)>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub when: Option<String>,
    /// Rows a background sweep removes: retired Following entries or expired
    /// rows. The read meter bounds them while the backlog lasts.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub backlog: bool,
    pub site: String,
    pub reason: String,
    pub rewrite: String,
    /// The presence conditions under which the site runs; none for every call.
    #[serde(skip)]
    pub conditions: Vec<(String, bool)>,
}

pub(crate) fn analyze(schema: &Schema, program: &Program) -> Certificate {
    analyze_sources(schema, program, None)
}

pub(crate) fn analyze_bound(schema: &Schema, bound: &snapback4_lang::BoundProgram) -> Certificate {
    analyze_sources(schema, &bound.program, Some(bound))
}

fn analyze_sources(schema: &Schema, program: &Program, source: Option<&snapback4_lang::BoundProgram>) -> Certificate {
    let ceilings = if program.kind == ProgramKind::Job { Ceilings::job() } else { Ceilings::default() };
    let mut a = Analysis {
        schema, program, source,
        result: Certificate {
            operation: program.name.clone(), class: Class::Constant,
            per_chunk: program.kind == ProgramKind::Job,
            bounds: Bounds { lanes: Some(0), meters: ceilings, ..Bounds::default() },
            growth_sites: Vec::new(), aggregates: Vec::new(), per_write: Vec::new(), whole_job: Vec::new(), variants: Vec::new(),
        },
        labels: BTreeMap::new(), data: BTreeMap::new(), in_filter: false, has_variants: snapback4_core::ir::scans(program).iter().any(|scan| scan.variant.is_some()), conditions: Vec::new(),
        identities: Vec::new(), aliases: copies(program), tests: BTreeMap::new(), swept: BTreeSet::new(), written: Vec::new(),
        arguments: program.args.keys().cloned().collect(), unreachable: 0,
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
        // One walk of the whole body, so a branch that leaves it conditions what follows.
        let body: Vec<Stmt> = program.body.iter().map(|stmt| {
            let mut stmt = stmt.clone();
            if program.kind == ProgramKind::Job
                && let Stmt::For { domain: LoopDomain::Page(scan), .. } = &mut stmt
                && scan.take == Bound::Meter { scan.take = Bound::Literal(64); }
            stmt
        }).collect();
        a.body(&body, 1);
        if program.kind == ProgramKind::Job {
            // @ref LLP 3000.013#14.4 — a sweep after a `return` never runs, so the job does not grow with it.
            for stmt in &program.body {
                if let Stmt::For { binding, domain: LoopDomain::Page(scan), .. } = stmt
                    && a.swept.contains(binding) {
                    let domain = source.and_then(|p| p.loop_source(binding)).map(str::to_owned).unwrap_or_else(|| a.scan_domain(scan));
                    a.result.whole_job.push(format!("rows visited/written by the sweep over `{domain}`"));
                }
            }
        }
    }
    // @ref LLP 3000.013#14.4 — skips that background cleanup removes are a backlog, not growth with the corpus.
    a.result.class = if a.result.growth_sites.is_empty() { Class::Constant }
        else if a.result.growth_sites.iter().all(|g| g.backlog) { Class::Backlog } else { Class::Grows };
    // A site can run in every variant its conditions do not contradict, the
    // unconditional ones in all of them, so no variant is better than such a site.
    for variant in &mut a.result.variants {
        for site in &a.result.growth_sites {
            let contradicts = site.conditions.iter().any(|(name, present)| variant.conditions.iter().any(|(other, value)| name == other && present != value));
            if !contradicts { variant.class = variant.class.max(if site.backlog { Class::Backlog } else { Class::Grows }); }
        }
    }
    // Do not clip structural allowances to ceilings: the runtime records
    // the charge that crosses a ceiling, and a query may try later sites.
    a.result
}

struct Analysis<'a> {
    source: Option<&'a snapback4_lang::BoundProgram>,
    schema: &'a Schema,
    program: &'a Program,
    result: Certificate,
    // A local's value may come from data even if obtaining it costs one read.
    // That distinction matters when it subsequently supplies a range bound.
    data: BTreeMap<String, bool>,
    labels: BTreeMap<String, String>,
    in_filter: bool,
    /// The presence conditions in force, as the author names them (for `when`)
    /// and as binding identities (for matching sites to variants).
    conditions: Vec<(String, bool)>,
    identities: Vec<(String, bool)>,
    /// Bindings that only copy another binding, neither ever reassigned.
    aliases: BTreeMap<String, String>,
    /// The test each boolean binding holds where the walk has reached.
    tests: BTreeMap<String, Test>,
    /// Page loops the walk reaches: a job's whole-job sweeps.
    swept: BTreeSet<String>,
    /// Every binding the walk has seen reassigned, in order.
    written: Vec<String>,
    /// The operation's arguments: only their presence, fixed for a call, defines a variant.
    arguments: BTreeSet<String>,
    /// Depth of code no call reaches: after a way out, or under a test the facts in force contradict.
    unreachable: u32,
    /// Only a program with a planner variant scan records variants; every program's
    /// tests decide what never runs.
    has_variants: bool,
}

/// Every binding a body reassigns anywhere, statement bodies and expression
/// blocks included: such a binding is never an alias.
fn assigned(body: &[Stmt]) -> BTreeSet<String> {
    fn walk(value: &serde_json::Value, out: &mut BTreeSet<String>) {
        match value {
            serde_json::Value::Object(fields) => {
                if let Some(serde_json::Value::Object(assign)) = fields.get("Assign")
                    && let Some(serde_json::Value::String(name)) = assign.get("name") { out.insert(name.clone()); }
                for field in fields.values() { walk(field, out); }
            }
            serde_json::Value::Array(items) => { for item in items { walk(item, out); } }
            _ => {}
        }
    }
    let mut out = BTreeSet::new();
    walk(&serde_json::to_value(body).unwrap_or_default(), &mut out);
    out
}

/// Bindings that only copy another binding, from the whole program at once, so a
/// test judged before the walk reaches a copy still reads through it. The IR
/// names each binding once (`$selected1`), by `const` or `let`; a copy counts
/// only if it is never reassigned. A copy of a reassigned local reads through to
/// that local, which is no argument, so it states no presence fact either way.
fn copies(program: &Program) -> BTreeMap<String, String> {
    fn walk(value: &serde_json::Value, out: &mut BTreeMap<String, String>) {
        match value {
            serde_json::Value::Object(fields) => {
                for kind in ["Let", "Const"] {
                    if let Some(serde_json::Value::Object(binding)) = fields.get(kind)
                        && let Some(serde_json::Value::String(name)) = binding.get("name")
                        && let Some(source) = binding.get("value").and_then(|v| v.get("Variable")).and_then(|v| v.as_str()) {
                        out.insert(name.clone(), source.to_owned());
                    }
                }
                for field in fields.values() { walk(field, out); }
            }
            serde_json::Value::Array(items) => { for item in items { walk(item, out); } }
            _ => {}
        }
    }
    let mut out = BTreeMap::new();
    walk(&serde_json::to_value(&program.body).unwrap_or_default(), &mut out);
    let reassigned = assigned(&program.body);
    out.retain(|name, _| !reassigned.contains(name));
    out
}

/// What the walk knows of a condition: a constant, an argument's presence (its
/// identity, its author's name, and the presence under which the test holds), or
/// nothing, combined by `not`, `and` and `or`.
#[derive(Clone, Debug)]
enum Test {
    Known(bool),
    Present(String, String, bool),
    Unknown,
    Not(Box<Test>),
    And(Box<Test>, Box<Test>),
    Or(Box<Test>, Box<Test>),
}

/// A presence fact: an argument's identity, its author's name, and whether it is present.
type Fact = (String, String, bool);

impl Test {
    /// Its value where the facts `known` hold, when they decide it.
    fn value(&self, known: &[(String, bool)]) -> Option<bool> {
        match self {
            Test::Known(value) => Some(*value),
            Test::Present(identity, _, present) => known.iter().find(|(name, _)| name == identity).map(|(_, value)| value == present),
            Test::Unknown => None,
            Test::Not(test) => test.value(known).map(|value| !value),
            Test::And(a, b) => match (a.value(known), b.value(known)) {
                (Some(false), _) | (_, Some(false)) => Some(false),
                (Some(true), Some(true)) => Some(true),
                _ => None,
            },
            Test::Or(a, b) => match (a.value(known), b.value(known)) {
                (Some(true), _) | (_, Some(true)) => Some(true),
                (Some(false), Some(false)) => Some(false),
                _ => None,
            },
        }
    }

    /// The presence facts that hold wherever the test has `value`, given the facts `known`.
    fn facts(&self, value: bool, known: &[(String, bool)], out: &mut Vec<Fact>) {
        match self {
            Test::Present(identity, name, present) => out.push((identity.clone(), name.clone(), *present == value)),
            Test::Not(test) => test.facts(!value, known, out),
            Test::And(a, b) | Test::Or(a, b) => {
                let and = matches!(self, Test::And(..));
                if value == and {
                    // `a and b` holds, or `a or b` fails: so does each side.
                    a.facts(value, known, out);
                    b.facts(value, known, out);
                } else {
                    // `a and b` fails, or `a or b` holds: a side known to be `true` (`false` for
                    // `or`) leaves the other to decide it.
                    if a.value(known) == Some(and) { b.facts(value, known, out); }
                    if b.value(known) == Some(and) { a.facts(value, known, out); }
                }
            }
            Test::Known(_) | Test::Unknown => {}
        }
    }
}

/// The value a branch gives `name` last, as the step of an `and` or `or` does.
fn step<'a>(branch: &'a [Stmt], name: &str) -> Option<&'a Expr> {
    match branch.last() { Some(Stmt::Assign { name: target, value }) if target == name => Some(value), _ => None }
}

/// Two literals compared as the interpreter compares them (`engine::runner::binary`).
fn compare(op: &BinaryOp, a: &Value, b: &Value) -> Test {
    use std::cmp::Ordering::{Greater, Less};
    Test::Known(match op {
        BinaryOp::Eq => a == b,
        BinaryOp::Ne => a != b,
        BinaryOp::Lt => a.total_cmp(b) == Less,
        BinaryOp::Lte => a.total_cmp(b) != Greater,
        BinaryOp::Gt => a.total_cmp(b) == Greater,
        BinaryOp::Gte => a.total_cmp(b) != Less,
        _ => return Test::Unknown,
    })
}

impl Analysis<'_> {
    /// What a condition tests. Only an argument's presence, fixed for the whole
    /// call, is a fact; a boolean binding holds the test it was given, as far as
    /// the walk has reached.
    fn test(&self, condition: &Expr) -> Test {
        let test = |expr: &Expr| Box::new(self.test(expr));
        match condition {
            Expr::Literal(Value::Bool(value)) => Test::Known(*value),
            Expr::Variable(name) => self.tests.get(name).cloned().unwrap_or(Test::Unknown),
            Expr::Unary { op: UnaryOp::Not, value } => Test::Not(test(value)),
            Expr::Binary { op: BinaryOp::And, left, right } => Test::And(test(left), test(right)),
            Expr::Binary { op: BinaryOp::Or, left, right } => Test::Or(test(left), test(right)),
            Expr::Binary { op, left, right } => match (left.as_ref(), right.as_ref()) {
                (Expr::Literal(a), Expr::Literal(b)) => compare(op, a, b),
                _ => self.presence(condition),
            },
            _ => self.presence(condition),
        }
    }

    /// A presence test of an argument, or of a search of one.
    fn presence(&self, condition: &Expr) -> Test {
        display::presence(condition).and_then(|(binding, search, present)| {
            let root = self.identity(&binding);
            // Quarry never reassigns an argument (locals cannot shadow one).
            self.arguments.contains(&root).then(|| {
                let name = display::author_name(&root);
                if search { Test::Present(format!("search {root}"), format!("search {name}"), present) } else { Test::Present(root, name, present) }
            })
        }).unwrap_or(Test::Unknown)
    }

    /// The facts a branch adds to those in force, where `test` has `value`; none at
    /// all when no call reaches it, because the facts in force or its own contradict it.
    fn assume(&self, test: &Test, value: bool) -> Option<Vec<Fact>> {
        if test.value(&self.identities).is_some_and(|holds| holds != value) { return None; }
        let mut facts = Vec::new();
        test.facts(value, &self.identities, &mut facts);
        let mut added: Vec<Fact> = Vec::new();
        for (identity, name, present) in facts {
            let known = self.identities.iter().map(|(known, value)| (known, *value))
                .chain(added.iter().map(|(known, _, value)| (known, *value)))
                .find(|(known, _)| **known == identity).map(|(_, value)| value);
            match known {
                Some(value) if value != present => return None,
                Some(_) => {}
                None => added.push((identity, name, present)),
            }
        }
        Some(added)
    }

    /// Walks with `facts` added to those in force, or, without any, as code no call reaches.
    fn under<T>(&mut self, facts: Option<&[Fact]>, walk: impl FnOnce(&mut Self) -> T) -> T {
        let Some(facts) = facts else {
            self.unreachable += 1;
            let leaves = walk(self);
            self.unreachable -= 1;
            return leaves;
        };
        let depth = self.identities.len();
        for (identity, name, present) in facts {
            self.identities.push((identity.clone(), *present));
            self.conditions.push((name.clone(), *present));
        }
        let leaves = walk(self);
        self.identities.truncate(depth);
        self.conditions.truncate(depth);
        leaves
    }

    /// The binding a presence test finally reads, through any aliases.
    fn identity(&self, name: &str) -> String {
        let mut name = name.to_owned();
        // A chain of copies ends at its source; the bound only guards a malformed program.
        for _ in 0..=self.aliases.len() {
            let Some(next) = self.aliases.get(&name) else { break };
            name = next.clone();
        }
        name
    }

    fn scan_domain(&self, scan: &Scan) -> String {
        self.source.and_then(|p| p.domain_source(&scan.site)).map(str::to_owned).unwrap_or_else(|| display::domain(self.schema, scan))
    }

    fn growth(&mut self, site: &str, reason: String, rewrite: &str) { self.site(false, site, reason, rewrite); }

    /// Rows a background sweep removes: bounded by the read meter while the
    /// backlog lasts, and absent once cleanup catches up.
    fn backlog(&mut self, site: &str, reason: String, rewrite: &str) { self.site(true, site, reason, rewrite); }

    fn site(&mut self, backlog: bool, site: &str, reason: String, rewrite: &str) {
        if self.unreachable > 0 { return; }
        self.variant(if backlog { Class::Backlog } else { Class::Grows }, None);
        let when = self.when();
        let conditions = if when.is_some() { self.identities.clone() } else { Vec::new() };
        let growth = Growth { when, backlog, site: site.into(), reason, rewrite: rewrite.into(), conditions };
        if !self.result.growth_sites.contains(&growth) { self.result.growth_sites.push(growth); }
    }

    /// The presence state the walk is in, as the author names it: a variant only
    /// where a planner variant scan makes one.
    fn when(&self) -> Option<String> {
        if self.has_variants { display::conditions(&self.conditions) } else { None }
    }

    fn variant(&mut self, class: Class, index: Option<String>) {
        if self.unreachable > 0 { return; }
        let Some(when) = self.when() else { return; };
        // One variant per combination of bindings, not per spelling: a helper's
        // parameter and a query argument can share a name.
        let same = |conditions: &[(String, bool)]| conditions.len() == self.identities.len() && conditions.iter().all(|c| self.identities.contains(c));
        let at = self.result.variants.iter().position(|v| same(&v.conditions)).unwrap_or_else(|| {
            self.result.variants.push(Variant { when, class: Class::Constant, indexes: BTreeSet::new(), conditions: self.identities.clone() });
            self.result.variants.len() - 1
        });
        let variant = &mut self.result.variants[at];
        if class > variant.class { variant.class = class; }
        if let Some(index) = index { variant.indexes.insert(index); }
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

    /// Walks a body. `None` when every path through it leaves it: a `return`, `break`
    /// or `continue`, a refusal where its test fails, or a test each of whose branches
    /// leaves or never runs. Otherwise the presence facts, beyond those in force, that
    /// hold wherever it falls through. A loop may not run, so it never leaves and
    /// states nothing.
    fn body(&mut self, body: &[Stmt], times: u64) -> Option<Vec<Fact>> {
        for (at, stmt) in body.iter().enumerate() {
            let rest = &body[at + 1..];
            match stmt {
                Stmt::Const { name, value } | Stmt::Let { name, value } | Stmt::Assign { name, value } => {
                    if name.starts_with("$intentNeedle") {
                        self.labels.insert(name.clone(), display::expr(value));
                    }
                    let data = self.expr(value, times);
                    // Union assignments across branches and loop iterations;
                    // never clear a possible dependency on another path.
                    *self.data.entry(name.clone()).or_default() |= data;
                    // A binding holds the test it is defined with. Reassigned, it holds none from
                    // here, except the step of an `and` or `or`, which its `if` recovers. Code that
                    // never runs assigns nothing.
                    if self.unreachable == 0 {
                        let test = if matches!(stmt, Stmt::Assign { .. }) { self.written.push(name.clone()); Test::Unknown } else { self.test(value) };
                        self.tests.insert(name.clone(), test);
                    }
                }
                Stmt::Push { target, value } => {
                    let data = self.expr(value, times);
                    *self.data.entry(target.clone()).or_default() |= data;
                }
                // Nothing after a statement that leaves the body runs.
                Stmt::Return(value) => { self.expr(value, times); self.never(rest, times); return None; }
                Stmt::Break | Stmt::Continue => { self.never(rest, times); return None; }
                Stmt::Emit { payload, once, .. } => {
                    self.expr(payload, times);
                    if let Some(key) = once {
                        self.expr(key, times);
                        self.result.bounds.writes = self.result.bounds.writes.saturating_add(times);
                    }
                }
                Stmt::If { condition, then_body, else_body } => {
                    self.expr(condition, times);
                    // @ref LLP 3000.013#14.4 — only an argument's presence, fixed for the whole call, is a fact.
                    // A test of anything else (a loop variable, a reassigned or computed binding) can go both
                    // ways in one call. Each branch runs under the facts its test adds, or never, when they
                    // contradict the facts in force.
                    let test = self.test(condition);
                    // Each arm starts from the bindings' tests as they stand here.
                    let (incoming, written) = (self.tests.clone(), self.written.len());
                    let (mut stays, mut combined) = (Vec::new(), None);
                    for (branch, other, holds) in [(then_body, else_body, true), (else_body, then_body, false)] {
                        self.tests = incoming.clone();
                        let facts = self.assume(&test, holds);
                        let end = self.under(facts.as_deref(), |a| a.body(branch, times));
                        // An arm that runs and falls through keeps its test's facts and its own.
                        if let (Some(facts), Some(end)) = (facts, end) { stays.push([facts, end].concat()); }
                        // `x and y` binds `b = x; if b: b = y`, and `x or y` binds `b = x; if b: else: b = y`;
                        // the step's value is read where its arm ends.
                        if let Expr::Variable(name) = condition && other.is_empty()
                            && let (Some(assigned), Some(before)) = (step(branch, name), incoming.get(name)) {
                            let (before, after) = (Box::new(before.clone()), Box::new(self.test(assigned)));
                            combined = Some((name.clone(), if holds { Test::And(before, after) } else { Test::Or(before, after) }));
                        }
                    }
                    // After the `if`, a binding either arm reassigned holds either path's value, so no
                    // test, except the `if`'s own step.
                    self.tests = incoming;
                    for name in self.written[written..].to_vec() { self.tests.insert(name, Test::Unknown); }
                    if let Some((name, test)) = combined { self.tests.insert(name, test); }
                    // @ref LLP 3000.013#14.4 — what follows runs only after an arm that can run and does
                    // not leave, under the facts every such arm keeps.
                    let mut stays = stays.into_iter();
                    let Some(first) = stays.next() else { self.never(rest, times); return None; };
                    let kept: Vec<Fact> = match stays.next() {
                        Some(second) => first.into_iter().filter(|fact| second.contains(fact)).collect(),
                        None => first,
                    };
                    if !kept.is_empty() { return self.after(kept, rest, times); }
                }
                Stmt::Require { condition, .. } => {
                    self.expr(condition, times);
                    // A refusal leaves where its test fails, so what follows runs only where it holds.
                    let test = self.test(condition);
                    match self.assume(&test, true) {
                        None => { self.never(rest, times); return None; }
                        Some(facts) if !facts.is_empty() => return self.after(facts, rest, times),
                        Some(_) => {}
                    }
                }
                Stmt::Check { condition, current } => { self.expr(condition, times); self.point(current, times, true); }
                Stmt::For { binding, domain, body } => {
                    let spelling = self.source.and_then(|p| p.loop_source(binding));
                    let (max, data) = self.domain(domain, times, spelling);
                    self.data.insert(binding.clone(), data);
                    // Later iterations can carry a dependency backwards
                    // through assignments. Resolve it before pricing once.
                    dependencies::fixed_point(&mut self.data, body);
                    if self.unreachable == 0 && matches!(domain, LoopDomain::Page(_)) { self.swept.insert(binding.clone()); }
                    self.repeated(body, times.saturating_mul(max));
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
                Stmt::DeleteTarget { target } => {
                    for key in &target.key { self.expr(key, times); }
                    if self.schema.table(&target.table).is_some_and(|t| t.is_expiring()) { self.expiry_write(&target.table, &target.index); }
                    self.write(&target.table, "delete", times);
                }
                Stmt::WriteTarget { target, patch, upsert, condition, result } => {
                    if self.schema.table(&target.table).is_some_and(|t| t.is_expiring()) {
                        // Write targets are complete unique keys. Their only
                        // variable expiry work is the matching collision backlog.
                        for key in &target.key { self.expr(key, times); }
                        self.expiry_write(&target.table, &target.index);
                    } else { self.point(target, times, false); }
                    self.expr(patch, times);
                    if let Some(c) = condition { self.body(&c.setup, times); self.expr(&c.value, times); }
                    self.write(&target.table, if *upsert { "upsert" } else { "update" }, times);
                    if let Some(name) = result { self.data.insert(name.clone(), true); }
                }
            }
        }
        Some(Vec::new())
    }

    /// Walks what follows under `facts`, which then also hold wherever it falls through.
    fn after(&mut self, facts: Vec<Fact>, rest: &[Stmt], times: u64) -> Option<Vec<Fact>> {
        let end = self.under(Some(&facts), |a| a.body(rest, times))?;
        Some([facts, end].concat())
    }

    /// A body that runs again and again, or not at all: a binding it reassigns can
    /// carry a later value back to its start, or keep its value from before it, so
    /// the walk knows no test of it inside or after.
    fn repeated(&mut self, body: &[Stmt], times: u64) {
        let assigned = assigned(body);
        for name in &assigned { self.tests.remove(name); }
        self.body(body, times);
        for name in &assigned { self.tests.remove(name); }
    }

    /// Statements that never run: walked for their bindings, but no site of theirs counts.
    fn never(&mut self, body: &[Stmt], times: u64) {
        self.under(None, |a| { a.body(body, times); });
    }

    fn domain(&mut self, domain: &LoopDomain, times: u64, spelling: Option<&str>) -> (u64, bool) {
        match domain {
            LoopDomain::Page(scan) => { self.scan(scan, times, false); (self.bound(&scan.take), true) }
            LoopDomain::LiteralRange { start, end_exclusive } => (end_exclusive.saturating_sub(*start).max(0) as u64, false),
            LoopDomain::ExpressionRange { start, end_exclusive } => {
                let data = self.expr(start, times) | self.expr(end_exclusive, times);
                let max = display::range_size(start, end_exclusive);
                if max.is_none() && data {
                    let range = spelling.map(str::to_owned).unwrap_or_else(|| format!("range({}, {})", display::expr(start), display::expr(end_exclusive)));
                    self.growth(&self.program.name, format!("iterations of {range} from stored data"),
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
            Expr::Builtin { builtin: Builtin::Extremum { field, max, domain: true }, args } if matches!(args.first(), Some(Expr::Scan(_))) => {
                let Expr::Scan(scan) = &args[0] else { unreachable!() };
                let ordered = scan.orders_field(self.schema, field) && scan.order == if *max { Order::Desc } else { Order::Asc };
                let operation = if *max { "max" } else { "min" };
                self.result.aggregates.push(format!("{operation}({domain}, .{field}): {access} on {table}.{index}; nulls skipped; a cut has no scalar answer",
                    domain = self.scan_domain(scan), table = scan.table, index = scan.index,
                    access = if ordered { "ordered-index seek to the first visible match" } else { "metered scan of the domain" }));
                let mut priced = scan.clone();
                if ordered {
                    priced.take = Bound::Literal(1);
                    priced.existence = true;
                    if scan.range.as_ref().is_none_or(|range| range.gt.is_none() && range.gte.is_none())
                        && self.schema.table(&scan.table).and_then(|table| table.columns.get(field)).is_some_and(|column| matches!(column, snapback4_core::schema::ColumnType::Optional(_))) {
                        self.growth(&scan.site, format!("null .{field} rows skipped before the {operation} endpoint"), "make the column required if the product has no missing values");
                        self.rows(self.result.bounds.meters.examined);
                    }
                }
                self.scan(&priced, times, false);
                true
            }
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
                            let spelling = self.source.and_then(|p| p.loop_source(&lane.binding));
                            self.domain(&LoopDomain::ExpressionRange { start: start.clone(), end_exclusive: end_exclusive.clone() }, times, spelling);
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
                    self.repeated(&lane.setup, times.saturating_mul(count));
                    if let Some(position) = &merge.position {
                        // Projected views eagerly read take+1 per source lane,
                        // then project every authorized candidate before sorting.
                        let mut scan = lane.scan.clone();
                        scan.take = Bound::Literal(position.take.saturating_add(1));
                        self.scan_with_window(&scan, times.saturating_mul(count), false, windows::reason(self.schema, lane));
                        if let Some(project) = &lane.project {
                            self.expr(project, times.saturating_mul(count).saturating_mul(u64::from(position.take) + 1));
                        }
                    } else {
                        self.scan_with_window(&lane.scan, times.saturating_mul(count), true, windows::reason(self.schema, lane));
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
        self.rows(times.saturating_mul(if self.schema.table(table).is_some_and(|t| t.is_expiring()) { 2 } else { 1 }));
        if self.in_filter { self.probes(times); }
        self.lookup_growth(table, index, site);
        if authorize && let Some(table) = self.schema.table(table) { self.rule(&table.rules.read, site, times); }
    }

    fn lookup_growth(&mut self, name: &str, index: &str, site: &str) {
        if self.schema.table(name).is_some_and(|t| t.is_expiring()) && index != "byId" {
            self.backlog(site, Self::expiry_reason(name, &format!("by the `{index}` lookup")),
                "read by id, or use a non-expiring keyed view");
            self.rows(self.result.bounds.meters.examined);
        }
        if let Some(m) = self.schema.maintain_for(name)
            && self.schema.table(&m.source).is_some_and(|t| t.is_expiring()) {
            self.growth(site, format!("server: constant aggregate lookup plus unswept expired {} contributions in the group behind `{name}`; server expiry sweep: 1-second tick, at most 2,000 rows per pass; the examined meter bounds the backlog; device: live source recomputation still scans the held group", m.source),
                "allow the server expiry sweep to drain the group backlog; live group size adds no server read work; use server fallback when the device cannot complete");
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
        self.scan_with_window(scan, times, merged, None);
    }

    fn expiry_reason(table: &str, skipped: &str) -> String {
        format!("expired {table} rows not yet swept, skipped {skipped} (server expiry sweep: 1-second tick, at most 2,000 rows per pass; backlog, downtime or failures can leave older rows; the read meter bounds work)")
    }

    fn scan_with_window(&mut self, scan: &Scan, times: u64, merged: bool, window: Option<String>) {
        if scan.variant.is_some() { self.variant(Class::Constant, Some(format!("{}.{}", scan.table, scan.index))); }
        for key in &scan.prefix { match key { IndexKeyExpr::Scalar(e) | IndexKeyExpr::WordPrefix(e) => { self.expr(e, times); } } }
        for e in [&scan.after, &scan.before].into_iter().flatten() { self.expr(e, times); }
        if let Some(r) = &scan.range { for e in [&r.gt, &r.gte, &r.lt, &r.lte].into_iter().flatten() { self.expr(e, times); } }
        let take = self.bound(&scan.take);
        let visibility = snapback4_core::engine::rules::scan_visibility(self.schema, scan);
        let table = self.schema.table(&scan.table);
        let mut grows = false;
        if scan.take == Bound::Meter {
            self.growth(&scan.site, format!("{} in the domain `{}`", scan.table, self.scan_domain(scan)),
                "cap the domain, page it, or add a maintained view for its aggregate");
            grows = true;
        }
        if let Some(filter) = &scan.filter {
            // A timeline read carries no filter of its own (E_TIMELINE_READ): the scan the
            // compiler generates for it filters only by the platform's retirement check, and
            // cleanup purges what that skips. Any authored scan, even of the owned feed table,
            // can skip rows no cleanup removes, so it grows. Without the binder's record there
            // is no proof, and the scan grows too. The expansion is a plain scan, never a lane,
            // so it has no window.
            let timeline = self.source.filter(|source| source.timeline_scan(&scan.site))
                .and_then(|_| self.schema.timelines.iter().find(|t| t.table("Feed") == scan.table));
            let authored = self.source.and_then(|source| source.filter_source(&scan.site));
            if let Some(t) = timeline {
                self.backlog(&scan.site, format!("Following `{}` entries retired by an unfollow or a removal and not yet purged, skipped before {} match (background cleanup purges them in chunks of at most 256; the read meter bounds the work until it does)", t.name, display::bound(&scan.take)), "");
            } else {
                let rewrite = if window.is_some() { "" } else { "pin the filter column in the read, or add a view indexed by that predicate" };
                let reason = if let Some(window) = window { window } else {
                    format!("{} skipped by `{}` before {} match", scan.table, authored.map(str::to_owned).unwrap_or_else(|| display::expr(filter)), display::bound(&scan.take))
                };
                self.growth(&scan.site, reason, rewrite);
            }
            grows = true;
        }
        if !visibility.uniform && self.program.kind != ProgramKind::Job {
            self.growth(&scan.site, format!("{} skipped by its per-row read rule", scan.table),
                "pin the read rule's deciding columns in the domain");
            grows = true;
        }
        if table.is_some_and(|t| t.is_expiring()) {
            self.backlog(&scan.site, Self::expiry_reason(&scan.table, &format!("before {} live rows match", display::bound(&scan.take))), "");
            grows = true;
        }
        if scan.prefix.iter().any(|key| matches!(key, IndexKeyExpr::WordPrefix(_))) {
            self.growth(&scan.site, format!("matching words and candidate {} rows (additional search terms filter)", scan.table),
                "use an equality-pinned domain for a fixed-cost read; word-prefix search remains data-dependent");
            if self.unreachable == 0 { self.result.bounds.lanes = None; }
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
