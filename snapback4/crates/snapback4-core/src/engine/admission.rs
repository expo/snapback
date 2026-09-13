//! Mutation population admission. A page consumed as a whole group must
//! preserve one complete, uniformly readable, schema-capped population.
//! Provenance follows bindings and row shaping, never just the final loop
//! syntax. Runtime metering remains independent and aborts over-budget writes.
// @ref LLP 3000.003#implementation-follow-up — retained structural admission
use crate::ir::*;
use crate::schema::{Constraint, Schema};
use crate::value::Value;
use crate::error::RuntimeError;
use crate::engine::rules::scan_visibility;
use std::collections::{BTreeMap, BTreeSet};

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


pub fn check(schema: &Schema, program: &Program) -> Result<(), RuntimeError> {
    let scans = crate::ir::scans(program);
    if program.kind == ProgramKind::Mutation {
        let nonuniform = scans.iter().find(|s| schema.table(&s.table).and_then(|t| t.index(&s.index)).is_some() && !scan_visibility(schema, s).uniform).map(|s| (*s).clone());
        let mut bindings = BTreeMap::new();
        collect(&program.body, true, &mut bindings);
        let env = program.args.keys().map(|name| (name.clone(), if bindings.contains_key(name) { Origin::Unknown(vec![]) } else { Origin::Other })).collect();
        let mut flow = Flow { schema, program, nonuniform, env, error: None, loops: BTreeMap::new(), bindings };
        flow.statements(&program.body, &Origin::Other, true);
        if let Some(error) = flow.error { return Err(error); }
        if flow.nonuniform.is_some() && crate::ir::write_tables(program).iter().any(|(name, effect)| {
            *effect != "delete" && schema.table(name).is_some_and(|t| t.constraints.iter().any(|c| matches!(c, Constraint::Cap { .. })))
        }) {
            return Err(RuntimeError::Structural { code: "E_STRUCTURAL_FANOUT", message: "a non-uniform scan cannot share a mutation with a complete population or group cap check; pin its read-rule fields or move the pass to a job".into() });
        }
    }
    for scan in scans {
        if schema.table(&scan.table).and_then(|t| t.index(&scan.index)).is_none() {
            return Err(RuntimeError::Structural { code: "E_UNBOUND_SCAN", message: format!("{}: missing scan table or index {}.{}", scan.site, scan.table, scan.index) });
        }
    }
    Ok(())
}

struct Flow<'a> {
    schema: &'a Schema,
    program: &'a Program,
    nonuniform: Option<Scan>,
    env: BTreeMap<String, Origin>,
    error: Option<RuntimeError>,
    loops: BTreeMap<String, u32>,
    bindings: BTreeMap<String, Binding>,
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
                    self.admit(binding, &origin, &site);
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
                            Origin::Page(scan) => self.page_problem(scan).is_none(),
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


    fn admit(&mut self, binding: &str, origin: &Origin, site: &str) {
        let reason = match origin {
            Origin::Other | Origin::Empty => return,
            Origin::Page(scan) => self.page_problem(scan),
            Origin::Merge(_) => Some("a merge has no proof of a complete union".into()),
            Origin::Unknown(_) => Some(format!("{binding} does not preserve one complete page")),
        };
        if self.error.is_none() {
            if let Some(reason) = reason { self.error = Some(RuntimeError::Structural { code: "E_STRUCTURAL_FANOUT", message: format!("{site}: {reason}; pin a schema-capped group with a literal bound at least its cap, or use a job chunk") }); }
        }
    }
    fn page_problem(&self, scan: &Scan) -> Option<String> {
        let Some(table) = self.schema.table(&scan.table) else { return Some(format!("missing table {}", scan.table)); };
        let Some(index) = table.index(&scan.index) else { return Some(format!("missing index {}.{}", scan.table, scan.index)); };
        let pinned: Vec<_> = index.columns().into_iter().take(scan.prefix.len()).collect();
        let cap = table.constraints.iter().filter_map(|c| match c { Constraint::Cap { by, max } if by.iter().all(|key| pinned.contains(key)) => Some(*max), _ => None }).min();
        let Some(cap) = cap else { return Some(format!("{} has no cap over the selected group", scan.table)); };
        if !scan_visibility(self.schema, scan).uniform { return Some("the read rule is not uniform over the prefix".into()); }
        if !matches!(scan.take, Bound::Literal(n) if n >= cap) { return Some(format!("the literal page bound must cover the schema cap {cap}")); }
        if scan.after.is_some() || scan.before.is_some() || scan.range.is_some() { return Some("a cursor or key range cuts the population".into()); }
        if self.nonuniform.is_some() { return Some("another non-uniform scan can truncate this mutation's population".into()); }
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

#[derive(Default)]
struct Binding {
    writes: usize,
    pushes: usize,
    top: bool,
    empty_declaration: bool,
}

impl Binding {
    fn single_top(&self) -> bool {
        self.writes == 1 && self.top && self.pushes == 0
    }
    fn head_only(&self) -> bool {
        self.writes == 1 && self.pushes == 0
    }
    fn collector(&self) -> bool {
        self.writes == 1 && self.top && self.empty_declaration && self.pushes == 1
    }
}

fn collect(body: &[Stmt], top: bool, out: &mut BTreeMap<String, Binding>) {
    for stmt in body {
        match stmt {
            Stmt::Let { name, value }
            | Stmt::Const { name, value }
            | Stmt::Assign { name, value } => {
                let fact = out.entry(name.clone()).or_default();
                fact.writes += 1;
                fact.top = top;
                fact.empty_declaration = !matches!(stmt, Stmt::Assign { .. })
                    && match value {
                        Expr::Array(v) => v.is_empty(),
                        Expr::Literal(Value::Array(v)) => v.is_empty(),
                        _ => false,
                    };
            }
            Stmt::Push { target, .. } => out.entry(target.clone()).or_default().pushes += 1,
            Stmt::For { binding, body, .. } => {
                out.entry(binding.clone()).or_default().writes += 1;
                collect(body, false, out);
            }
            Stmt::If {
                then_body,
                else_body,
                ..
            } => {
                collect(then_body, false, out);
                collect(else_body, false, out);
            }
            _ => {}
        }
    }
}

