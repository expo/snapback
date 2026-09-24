//! Mutation population admission. A page consumed as a whole group must
//! preserve one complete, uniformly readable, schema-capped population when
//! predicting. A never-predicting page pass still requires uniform visibility.
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


#[derive(Clone, Debug)]
pub struct Problem {
    pub code: &'static str,
    pub site: String,
    pub page_site: Option<String>,
    pub message: String,
    pub rewrite: String,
}

pub fn check(schema: &Schema, program: &Program) -> Result<(), RuntimeError> {
    check_detail(schema, program).map_err(|problem| RuntimeError::Structural { code: problem.code, message: problem.message })
}

// @ref LLP 3000.007#20 — admission reports the author's population and bound; source locations stay beside the IR.
pub fn check_detail(schema: &Schema, program: &Program) -> Result<(), Problem> {
    for table in crate::ir::read_sites(program).into_iter().map(|s|s.table).chain(crate::ir::write_tables(program).into_iter().map(|(t,_)|t)) {
        if let Err(error) = schema.refuse_private(&table) {
            return Err(Problem { code: "E_MAINTAINED_COLUMN_PRIVATE", site: program.name.clone(), page_site: None,
                message: error.to_string(), rewrite: "read the parent row or write its source rows".into() });
        }
    }
    let (scans, has_merge) = crate::ir::read_structure(program);
    if program.kind == ProgramKind::Mutation {
        require_uniform_mutation_pages(schema, &scans)?;
        // @ref LLP 3000.007#17 — structural merges and every mutation page are checked, including bound pages in predicting mutations.
        if has_merge { return Err(fanout(scans.first().copied(), &program.name, "a merge is not a plain prefix scan", "read this merge in a query, then pass the selected ids to the mutation")); }
        for scan in &scans {
            if let Some(reason) = plain_prefix_problem(schema, scan) {
                let rewrite = if reason.starts_with("a mutation page cannot scan a table with expiry") {
                    "read this page in a query, then pass the selected ids to the mutation; or use a job chunk, which may read a table with expiry"
                } else { "read this page in a query, then pass the selected ids to the mutation" };
                return Err(fanout(Some(scan), &scan.site, &reason, rewrite));
            }
        }
        let nonuniform = scans.iter().find(|s| schema.table(&s.table).and_then(|t| t.index(&s.index)).is_some() && !scan_visibility(schema, s).uniform).map(|s| (*s).clone());
        let mut bindings = BTreeMap::new();
        collect(&program.body, true, &mut bindings);
        let env = program.args.keys().map(|name| (name.clone(), if bindings.contains_key(name) { Origin::Unknown(vec![]) } else { Origin::Other })).collect();
        let mut flow = Flow { schema, program, nonuniform, env, error: None, bindings };
        flow.statements(&program.body, &Origin::Other, true);
        if let Some(error) = flow.error { return Err(error); }
        if flow.nonuniform.is_some() && crate::ir::write_tables(program).iter().any(|(name, effect)| {
            *effect != "delete" && schema.table(name).is_some_and(|t| t.constraints.iter().any(|c| matches!(c, Constraint::Cap { .. })))
        }) {
            return Err(fanout(flow.nonuniform.as_ref(), &program.name, "a non-uniform scan cannot share a mutation with a complete population or group cap check", "read this page in a query, then pass the selected ids to the mutation"));
        }
    }
    for scan in scans {
        if schema.table(&scan.table).and_then(|t| t.index(&scan.index)).is_none() {
            return Err(Problem { code: "E_UNBOUND_SCAN", site: scan.site.clone(), page_site: None, message: format!("missing scan table or index {}.{}", scan.table, scan.index), rewrite: "declare this table and index".into() });
        }
    }
    Ok(())
}

struct Flow<'a> {
    schema: &'a Schema,
    program: &'a Program,
    nonuniform: Option<Scan>,
    env: BTreeMap<String, Origin>,
    error: Option<Problem>,
    bindings: BTreeMap<String, Binding>,
}

impl Flow<'_> {
    fn expr(&self, expr: &Expr) -> Origin {
        match expr {
            Expr::Block { .. } => Origin::Unknown(Vec::new()),
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
            Expr::Object(fields) | Expr::Shape { fields, .. } => fields
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
                Stmt::WriteTarget { condition: Some(condition), .. } => {
                    let before = self.env.clone();
                    self.statements(&condition.setup, population, false);
                    self.env = before;
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
                    let site = format!("for/{binding}");
                    let origin = self.domain(domain);
                    // @ref LLP 3000.007#5.7 — complete-population proof protects row fanout; a bounded read/emit list need not preserve a whole group.
                    let read_emit_list = matches!(domain, LoopDomain::DerivedArray { .. } | LoopDomain::ArgList { .. }) && read_emit_only(body);
                    if !read_emit_list { self.admit(&origin, &site); }
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


    fn admit(&mut self, origin: &Origin, site: &str) {
        let reason = match origin {
            Origin::Other | Origin::Empty => return,
            Origin::Page(scan) => self.page_problem(scan),
            Origin::Merge(_) => Some("a merge has no proof of a complete union".into()),
            Origin::Unknown(_) => Some("this list does not preserve one complete page".into()),
        };
        if self.error.is_none() {
            if let Some(reason) = reason {
                let scans = origin.scans();
                let scan = scans.first();
                let rewrite = if let Some(scan) = scan && let Some(table) = self.schema.table(&scan.table) {
                    let pinned: Vec<_> = table.index(&scan.index).map(|index| index.columns().into_iter().take(scan.prefix.len()).collect()).unwrap_or_default();
                    let cap = table.constraints.iter().filter_map(|c| match c { Constraint::Cap { by, max } if by.iter().all(|key| pinned.contains(key)) => Some(*max), _ => None }).min();
                    match cap {
                        Some(_) => format!("iterate the original group: `for row in {}{}:`; put the condition and work inside that loop", scan.table, if pinned.is_empty() { String::new() } else { format!(" where {}", pinned.iter().map(|column| format!(".{column} = <value>")).collect::<Vec<_>>().join(" and ")) }),
                        None if !pinned.is_empty() => format!("declare `cap {} by {}` on {} only if it is a product limit, then iterate the whole group: `for row in {} where {}:`", scan.take.maximum(), pinned.join(", "), scan.table, scan.table, pinned.iter().map(|column| format!(".{column} = <value>")).collect::<Vec<_>>().join(" and ")),
                        _ => format!("move this pass to a job: `for row in {}:`", scan.table),
                    }
                } else { "pass a bounded list argument directly, or move the population pass to a job sweep".into() };
                self.error = Some(fanout(scan, site, &reason, &rewrite));
            }
        }
    }
    fn page_problem(&self, scan: &Scan) -> Option<String> {
        let Some(table) = self.schema.table(&scan.table) else { return Some(format!("missing table {}", scan.table)); };
        let Some(index) = table.index(&scan.index) else { return Some(format!("missing index {}.{}", scan.table, scan.index)); };
        if !scan_visibility(self.schema, scan).uniform { return Some("the read rule is not uniform over the prefix".into()); }
        if self.nonuniform.is_some() { return Some("another non-uniform scan can truncate this mutation's population".into()); }
        // @ref LLP 3000.007#5.9 — a never-predicting pass drops completeness, never uniformity.
        if self.schema.operations.get(&self.program.name).is_some_and(|fact| fact.predicts.as_deref() == Some("never")) {
            return plain_prefix_problem(self.schema, scan);
        }
        let pinned: Vec<_> = index.columns().into_iter().take(scan.prefix.len()).collect();
        let cap = self.schema.group_bound(&scan.table, &pinned);
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
            Stmt::WriteTarget { condition: Some(condition), .. } => collect(&condition.setup, false, out),
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

// @ref LLP 3000.007#17 — every mutation page stays a plain, non-expiring prefix even after the uniform-verdict repair.
fn plain_prefix_problem(schema: &Schema, scan: &Scan) -> Option<String> {
    let table = schema.table(&scan.table)?;
    if !table.index(&scan.index)?.is_plain() || scan.prefix.iter().any(|key| matches!(key, IndexKeyExpr::WordPrefix(_))) {
        Some("matching word scans expand hidden words before deciding visibility; read it in a query, or use a plain prefix scan".into())
    } else if table.expire.is_some() {
        Some("a mutation page cannot scan a table with expiry; read it in a query, or use a job chunk".into())
    } else if scan.merge_site.is_some() {
        Some("a merge is not a plain prefix scan; read it in a query, or use a job chunk".into())
    } else { None }
}

// @ref LLP 3000.007#14 — ruling 17 (c): binding a page has the same abort channel as looping over it.
fn require_uniform_mutation_pages(schema: &Schema, scans: &[&Scan]) -> Result<(), Problem> {
    for scan in scans {
        if schema.table(&scan.table).and_then(|table| table.index(&scan.index)).is_some() && !scan_visibility(schema, scan).uniform {
            return Err(fanout(Some(scan), &scan.site, "the mutation page's read rule is not uniformly decided by its prefix", &uniform_rewrite(schema, scan)));
        }
    }
    Ok(())
}

fn fanout(scan: Option<&Scan>, site: &str, reason: &str, rewrite: &str) -> Problem {
    let reason = reason.split_once("; ").map_or(reason, |(reason, _)| reason);
    let population = scan.map(|scan| format!("{} by {} (page bound {}): ", scan.table, scan.index, scan.take.maximum())).unwrap_or_default();
    Problem { code: "E_STRUCTURAL_FANOUT", site: site.into(), page_site: scan.map(|scan| scan.site.clone()), message: format!("{population}{reason}"), rewrite: rewrite.into() }
}

// @ref LLP 3000.007#20.3 — a private feed cleanup must pin the reader; changing its audience is not a rewrite.
fn uniform_rewrite(schema: &Schema, scan: &Scan) -> String {
    let table = &schema.tables[&scan.table];
    let mut fields = BTreeSet::new();
    table.rules.read.fields(&mut fields);
    let pinned = table.index(&scan.index).expect("checked index").columns().into_iter().take(scan.prefix.len()).collect::<BTreeSet<_>>();
    fields.retain(|field| !pinned.contains(field));
    if fields.is_empty() { return "this rule needs more than column pinning; read the page in a query, or use a job chunk".into(); }
    let columns = fields.iter().map(|field| format!(".{field}")).collect::<Vec<_>>().join(", ");
    let mut rewrite = format!("pin {columns} in each read's index prefix by iterating the capped group that supplies those values");
    // Recognize the published follower vocabulary, not a relation inferred
    // from principal types alone. actorId/eventId are example bindings.
    if fields.len() == 1 && fields.contains("readerId") && table.columns.contains_key("eventId")
        && let Some(follows) = schema.tables.get("follows")
        && follows.columns.contains_key("followerId") && follows.expire.is_none()
        && { let mut deciding = BTreeSet::new(); follows.rules.read.fields(&mut deciding); deciding.iter().all(|field| field == "followedId") }
        && table.indexes.values().any(|index| index.unique && index.columns() == ["readerId", "eventId"])
        && follows.cap(&["followedId".into()]).is_some()
        && let Some((index, _)) = follows.indexes.iter().find(|(_, i)| i.is_plain() && i.columns().starts_with(&["followedId".into()])) {
        rewrite.push_str(&format!("; for example, with actorId and eventId bound: `for f in follows[actorId] by {index}:`, then address `{}[readerId = f.followerId, eventId = eventId]`; pinning .readerId decides visibility but grants no read authority over another reader's inbox (see `snapback4 guide feeds`)", scan.table));
    } else {
        let keys = fields.iter().map(|field| format!("{field} = row.{field}")).collect::<Vec<_>>().join(", ");
        rewrite.push_str(&format!("; inside that loop use `{}[{keys}]` with an index leading on those columns; or read the page in a query", scan.table));
    }
    rewrite
}

// Check expressions too: an inlined helper may hide a write in a payload,
// condition, binding or loop domain. Unknown future forms must be considered.
fn read_emit_only(body: &[Stmt]) -> bool {
    body.iter().all(|stmt| match stmt {
        Stmt::Const { value, .. } | Stmt::Let { value, .. } | Stmt::Assign { value, .. } | Stmt::Push { value, .. }
        | Stmt::Return(value) | Stmt::Require { condition: value, .. } => read_only_expr(value),
        Stmt::Emit { payload, once, .. } => read_only_expr(payload) && once.as_ref().is_none_or(read_only_expr),
        Stmt::Check { condition, current } => read_only_expr(condition) && current.key.iter().all(read_only_expr),
        Stmt::If { condition, then_body, else_body } => read_only_expr(condition) && read_emit_only(then_body) && read_emit_only(else_body),
        Stmt::For { domain, body, .. } => read_only_domain(domain) && read_emit_only(body),
        Stmt::Break | Stmt::Continue => true,
        Stmt::Insert { .. } | Stmt::InsertIfAbsent { .. } | Stmt::Update { .. } | Stmt::Upsert { .. } | Stmt::WriteTarget { .. } | Stmt::Delete { .. } | Stmt::DeleteTarget { .. } => false,
    })
}

fn read_only_domain(domain: &LoopDomain) -> bool {
    match domain {
        LoopDomain::Page(scan) => read_only_scan(scan),
        LoopDomain::DerivedArray { value, .. } => read_only_expr(value),
        LoopDomain::ExpressionRange { start, end_exclusive } => read_only_expr(start) && read_only_expr(end_exclusive),
        LoopDomain::Recurse(recurse) => read_only_expr(&recurse.seed),
        LoopDomain::LiteralRange { .. } | LoopDomain::ArgList { .. } => true,
    }
}

fn read_only_scan(scan: &Scan) -> bool {
    scan.prefix.iter().all(|key| match key { IndexKeyExpr::Scalar(value) | IndexKeyExpr::WordPrefix(value) => read_only_expr(value) })
        && [&scan.filter, &scan.after, &scan.before].into_iter().flatten().all(|value| read_only_expr(value))
        && scan.range.as_ref().is_none_or(|range| [&range.gt, &range.gte, &range.lt, &range.lte].into_iter().flatten().all(|value| read_only_expr(value)))
}

fn read_only_expr(value: &Expr) -> bool {
    match value {
        Expr::Block { body, value } => read_emit_only(body) && read_only_expr(value),
        Expr::Array(values) | Expr::Builtin { args: values, .. } => values.iter().all(read_only_expr),
        Expr::Object(fields) => fields.values().all(read_only_expr),
        Expr::Shape { base, fields } => read_only_expr(base) && fields.values().all(read_only_expr),
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => read_only_expr(base),
        Expr::Binary { left, right, .. } => read_only_expr(left) && read_only_expr(right),
        Expr::Get(read) | Expr::Exists(read) => read.key.iter().all(read_only_expr),
        Expr::Scan(scan) => read_only_scan(scan),
        Expr::Merge(merge) => merge.position.as_ref().and_then(|position| position.after.as_deref()).is_none_or(read_only_expr) && merge.lanes.iter().all(|lane| lane.guard.as_ref().is_none_or(read_only_expr) && lane.project.as_ref().is_none_or(read_only_expr) && lane.distinct.as_ref().is_none_or(read_only_expr) && read_emit_only(&lane.setup) && read_only_scan(&lane.scan) && lane.source.as_ref().is_none_or(|source| source.scan().is_none_or(read_only_scan) && source.expressions().into_iter().all(read_only_expr))),
        Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_) => true,
    }
}
