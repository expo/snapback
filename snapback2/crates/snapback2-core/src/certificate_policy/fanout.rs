//! Complete population loops, independently of the IR spelling of their page.
// @ref LLP 1017#32-the-rule — identity bindings and row shapes preserve pages; cuts do not.
use super::{rule_fields, uniform_visibility, visit_statement_exprs};
use crate::certificate::CheckError;
use crate::ir::*;
use crate::schema::{Constraint, Schema};
use crate::value::Value;
use std::collections::{BTreeMap, BTreeSet};

#[path = "fanout_bindings.rs"]
mod bindings;
#[path = "fanout_repair.rs"]
mod repair;

#[derive(Clone, Debug, PartialEq, Eq)]
enum Origin {
    Other,
    Empty,
    Page(Scan),
    Merge(Vec<Scan>),
    Unknown(Vec<Scan>),
}

impl Origin {
    fn scans(&self) -> Vec<Scan> {
        match self {
            Self::Page(scan) => vec![scan.clone()],
            Self::Merge(scans) | Self::Unknown(scans) => scans.clone(),
            _ => Vec::new(),
        }
    }
    fn population(&self) -> bool {
        !matches!(self, Self::Other | Self::Empty)
    }
    fn join(self, other: Self) -> Self {
        if self == other {
            return self;
        }
        if !self.population() && !other.population() {
            return Self::Other;
        }
        let mut scans = self.scans();
        for scan in other.scans() {
            if !scans.contains(&scan) {
                scans.push(scan);
            }
        }
        if matches!(self, Self::Merge(_)) || matches!(other, Self::Merge(_)) {
            Self::Merge(scans)
        } else {
            Self::Unknown(scans)
        }
    }
    fn transformed(self) -> Self {
        match self {
            Self::Page(scan) => Self::Unknown(vec![scan]),
            origin => origin,
        }
    }
}

pub(crate) fn check(schema: &Schema, program: &Program) -> (Vec<CheckError>, BTreeSet<String>) {
    if program.kind != ProgramKind::Mutation {
        return (Vec::new(), BTreeSet::new());
    }
    let mut scans = Vec::new();
    all_scans(&program.body, &mut scans);
    let nonuniform = scans
        .into_iter()
        .find(|scan| !uniform_visibility(schema, scan));
    let mut bindings = BTreeMap::new();
    bindings::collect(&program.body, true, &mut bindings);
    let mut flow = Flow {
        schema,
        program,
        nonuniform,
        env: BTreeMap::new(),
        errors: Vec::new(),
        complete: BTreeSet::new(),
        loops: BTreeMap::new(),
        bindings,
    };
    for name in program.args.keys() {
        flow.env.insert(
            name.clone(),
            if flow.bindings.contains_key(name) {
                Origin::Unknown(vec![])
            } else {
                Origin::Other
            },
        );
    }
    // @ref LLP 1017#24-metering — no unbounded consumer may spend a cap probe's reserve.
    let mut capped = BTreeSet::new();
    bindings::capped_writes(schema, &program.body, &mut capped);
    if let Some(scan) = &flow.nonuniform {
        for table in capped {
            flow.errors.push(CheckError {
                site: Some(scan.site.clone()),
                code: "E_STRUCTURAL_FANOUT".into(),
                message: format!("the non-uniform scan at {} can spend the budget the cap check on {table} needs", scan.site),
                rewrite: repair::prefix(schema, program, scan, None),
            });
        }
    }
    flow.statements(&program.body, &Origin::Other, true);
    (flow.errors, flow.complete)
}

fn all_scans(statements: &[Stmt], scans: &mut Vec<Scan>) {
    for statement in statements {
        visit_statement_exprs(statement, &mut |expr| {
            if let Expr::Scan(scan) = expr {
                scans.push(scan.clone());
            }
        });
        match statement {
            Stmt::For { body, .. } => all_scans(body, scans),
            Stmt::If {
                then_body,
                else_body,
                ..
            } => {
                all_scans(then_body, scans);
                all_scans(else_body, scans);
            }
            _ => {}
        }
    }
}

struct Flow<'a> {
    schema: &'a Schema,
    program: &'a Program,
    nonuniform: Option<Scan>,
    env: BTreeMap<String, Origin>,
    errors: Vec<CheckError>,
    complete: BTreeSet<String>,
    loops: BTreeMap<String, u32>,
    bindings: BTreeMap<String, bindings::Binding>,
}

impl Flow<'_> {
    fn expr(&self, expr: &Expr) -> Origin {
        match expr {
            Expr::Merge(merge) => {
                Origin::Merge(merge.lanes.iter().map(|lane| lane.scan.clone()).collect())
            }
            Expr::Scan(scan) if scan.merge_site.is_some() => Origin::Merge(vec![scan.clone()]),
            Expr::Scan(scan) => Origin::Page(scan.clone()),
            Expr::Variable(name) => self
                .env
                .get(name)
                .cloned()
                .unwrap_or(Origin::Unknown(Vec::new())),
            Expr::Array(values) if values.is_empty() => Origin::Empty,
            Expr::Literal(Value::Array(values)) if values.is_empty() => Origin::Empty,
            Expr::Builtin { args, .. } | Expr::Array(args) => args
                .iter()
                .fold(Origin::Other, |origin, arg| origin.join(self.expr(arg)))
                .transformed(),
            Expr::Object(fields) => fields
                .values()
                .fold(Origin::Other, |origin, value| origin.join(self.expr(value)))
                .transformed(),
            Expr::Field { base, .. } | Expr::Unary { value: base, .. } => {
                self.expr(base).transformed()
            }
            Expr::Binary { left, right, .. } => {
                self.expr(left).join(self.expr(right)).transformed()
            }
            // A point read, list argument, or literal list has its own existing bounded contract.
            Expr::Get(_) | Expr::Exists(_) | Expr::Literal(_) | Expr::Input(_) => Origin::Other,
        }
    }

    fn domain(&self, domain: &LoopDomain) -> Origin {
        match domain {
            LoopDomain::Page(scan) => self.expr(&Expr::Scan(scan.clone())),
            LoopDomain::DerivedArray { value, .. } => self.expr(value),
            LoopDomain::ArgList { name, .. } => self.expr(&Expr::Variable(name.clone())),
            _ => Origin::Other,
        }
    }

    fn statements(&mut self, statements: &[Stmt], population: &Origin, top: bool) {
        for statement in statements {
            match statement {
                Stmt::Const { name, value }
                | Stmt::Let { name, value }
                | Stmt::Assign { name, value } => {
                    let origin = self.expr(value);
                    let fact = &self.bindings[name];
                    let allowed = top
                        && !self.program.args.contains_key(name)
                        && (fact.single_top() || (fact.collector() && origin == Origin::Empty));
                    let origin = if allowed {
                        origin
                    } else {
                        let old = self.env.get(name).cloned().unwrap_or(Origin::Other);
                        Origin::Unknown(old.join(origin).scans())
                    };
                    self.env.insert(name.clone(), origin);
                }
                Stmt::Push { target, value } => {
                    let old = self.env.get(target).cloned().unwrap_or(Origin::Other);
                    let origin = old.join(self.expr(value)).join(population.clone());
                    self.env
                        .insert(target.clone(), Origin::Unknown(origin.scans()));
                }
                Stmt::If {
                    then_body,
                    else_body,
                    ..
                } => {
                    let before = self.env.clone();
                    self.statements(then_body, population, false);
                    let then_env = self.env.clone();
                    self.env = before;
                    self.statements(else_body, population, false);
                    join_env(&mut self.env, then_env);
                }
                Stmt::For {
                    binding,
                    domain,
                    body,
                } => {
                    let ordinal = self.loops.entry(binding.clone()).or_default();
                    let site = format!("{}/for/{binding}/{ordinal}", self.program.name);
                    *ordinal += 1;
                    let origin = self.domain(domain);
                    self.admit(binding, domain, &origin, &site);
                    let before = self.env.clone();
                    // The head is the only local binding path we admit. A body write
                    // poisons it globally, including reads preceding that write.
                    let head_only = self
                        .bindings
                        .get(binding)
                        .is_some_and(|fact| fact.head_only());
                    self.env.insert(
                        binding.clone(),
                        if head_only {
                            Origin::Other
                        } else {
                            Origin::Unknown(vec![])
                        },
                    );
                    self.statements(body, &origin, false);
                    join_env(&mut self.env, before.clone());
                    if top
                        && let Some(target) = shape_target(body)
                        && self
                            .bindings
                            .get(target)
                            .is_some_and(|fact| fact.collector())
                        && !self.program.args.contains_key(target)
                        && before.get(target) == Some(&Origin::Empty)
                        && match &origin {
                            Origin::Page(scan) => self.page_problem(scan, binding).is_none(),
                            Origin::Other => true, // Bounded walks/lists are not page populations.
                            _ => false,
                        }
                    {
                        self.env.insert(target.to_owned(), origin.clone());
                    }
                    // Runtime leaves the final head binding in the environment;
                    // zero iterations and early exits make its post-loop origin unknown.
                    let last = self.env.get(binding).cloned().unwrap_or(Origin::Other);
                    self.env
                        .insert(binding.clone(), Origin::Unknown(last.scans()));
                }
                _ => {}
            }
        }
    }

    fn admit(&mut self, binding: &str, domain: &LoopDomain, origin: &Origin, site: &str) {
        if !origin.population() {
            return;
        }
        let scans = origin.scans();
        let scan = scans.first();
        let label = scan
            .map(|s| format!("{}.{}", s.table, s.index))
            .unwrap_or_else(|| binding.to_owned());
        let (reason, rewrite) = match origin {
            Origin::Merge(_) => (
                "a merge page has no union proof".to_owned(),
                repair::NO_UNION.to_owned(),
            ),
            Origin::Unknown(_) => {
                let name = match domain {
                    LoopDomain::DerivedArray {
                        value: Expr::Variable(name),
                        ..
                    }
                    | LoopDomain::ArgList { name, .. } => name,
                    _ => binding,
                };
                let rewrite = if scans.len() == 1
                    && repair::executable(self.program, &scans[0])
                    && self.page_problem(&scans[0], binding).is_none()
                {
                    format!("for {binding} in {}:", repair::scan_text(&scans[0], None))
                } else {
                    "bind exactly one page; per-recipient rows past one group are LLP 1016's continuation, not yet available".to_owned()
                };
                (format!("`{name}` is not a single page scan"), rewrite)
            }
            Origin::Page(scan) => {
                let Some((reason, rewrite)) = self.page_problem(scan, binding) else {
                    self.complete.insert(scan.site.clone());
                    return;
                };
                (reason, rewrite)
            }
            _ => unreachable!(),
        };
        self.errors.push(CheckError {
            site: Some(site.to_owned()),
            code: "E_STRUCTURAL_FANOUT".to_owned(),
            message: format!(
                "`for` over {label} at {site} may end before its range does: {reason}"
            ),
            rewrite,
        });
    }

    fn page_problem(&self, scan: &Scan, binding: &str) -> Option<(String, String)> {
        let Some(table) = self.schema.table(&scan.table) else {
            return Some((
                format!("missing table {}", scan.table),
                repair::missing(scan),
            ));
        };
        let Some(index) = table.index(&scan.index) else {
            return Some((
                format!("missing index {}.{}", scan.table, scan.index),
                repair::missing(scan),
            ));
        };
        let pinned: Vec<_> = index
            .columns
            .iter()
            .take(scan.prefix.len())
            .cloned()
            .collect();
        let cap = table
            .constraints
            .iter()
            .filter_map(|c| match c {
                Constraint::Cap { by, max } if by.iter().all(|column| pinned.contains(column)) => {
                    Some(*max)
                }
                _ => None,
            })
            .min();
        let Some(cap) = cap else {
            if pinned.is_empty() {
                return Some((
                    format!("{} has no cap over its unpinned range", scan.table),
                    "pin a declared group in the loop's index prefix; a whole-table fan-out needs LLP 1016's continuation, not yet available".to_owned(),
                ));
            }
            let columns = pinned;
            return Some((
                format!("{} has no cap over {}", scan.table, columns.join(", ")),
                format!(
                    "cap {} by {}",
                    scan.take.maximum().max(1),
                    columns.join(", ")
                ),
            ));
        };
        if !uniform_visibility(self.schema, scan) {
            return Some((
                "the read rule is not uniform over the scanned prefix".to_owned(),
                repair::prefix(self.schema, self.program, scan, Some(binding)),
            ));
        }
        match scan.take {
            Bound::Arg { .. } => {
                return Some((
                    "the bound is an argument".to_owned(),
                    format!("first {cap}"),
                ));
            }
            Bound::Literal(n) if n < cap => {
                return Some((
                    format!("bound {n} is below cap {cap}"),
                    format!("first {cap}"),
                ));
            }
            _ => {}
        }
        if scan.after.is_some() || scan.before.is_some() || scan.range.is_some() {
            let reason = if scan.after.is_some() {
                "the loop reads after a cursor"
            } else if scan.before.is_some() {
                "the loop reads before a cursor"
            } else {
                "the loop reads a key range"
            };
            let mut whole = scan.clone();
            whole.after = None;
            whole.before = None;
            whole.range = None;
            return Some((
                reason.to_owned(),
                if repair::executable(self.program, &whole) {
                    format!("for {binding} in {}:", repair::scan_text(&whole, None))
                } else {
                    "remove the cursor or key range and pin the prefix from arguments or `viewer`"
                        .to_owned()
                },
            ));
        }
        if let Some(other) = &self.nonuniform {
            return Some((
                format!(
                    "the non-uniform scan at {} can spend the budget this loop needs",
                    other.site
                ),
                repair::prefix(self.schema, self.program, other, None),
            ));
        }
        None
    }
}

fn join_env(env: &mut BTreeMap<String, Origin>, other: BTreeMap<String, Origin>) {
    let keys: BTreeSet<_> = env.keys().chain(other.keys()).cloned().collect();
    for key in keys {
        let a = env.remove(&key).unwrap_or(Origin::Other);
        let b = other.get(&key).cloned().unwrap_or(Origin::Other);
        env.insert(key, a.join(b));
    }
}

fn shape_target(body: &[Stmt]) -> Option<&str> {
    let mut target = None;
    for statement in body {
        match statement {
            Stmt::Push { target: name, .. } if target.is_none() => target = Some(name.as_str()),
            Stmt::Const { .. } | Stmt::Let { .. } => {}
            _ => return None,
        }
    }
    target
}
