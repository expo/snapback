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
mod maintenance_types;

pub fn check_state_predicates(schema: &Schema, program: &Program) -> Result<(), RuntimeError> {
    maintenance_types::check(schema, program).map_err(|message| RuntimeError::Structural { code: "E_VIEW_KEY", message })
}

/// Compiler-only helper identities join every call site's parameters/results.
/// They are absent from serialized programs and confer no native permission.
pub fn check_state_predicate_scopes(schema: &Schema, scopes: &[(&Program, &BTreeMap<String, String>)]) -> Vec<(usize, String)> {
    maintenance_types::check_scopes(schema, scopes)
}

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
    check_detail_with_statements(schema, program, &[])
}

/// Source statement ends supplied by Quarry alongside its flattened IR. Empty
/// means each IR statement owns itself (serialized/hand-built programs). Grouping
/// can only shorten eligibility: every statement in each group is still checked.
// @ref LLP 3000.025#3-proposed-rule — hoisted setup belongs to its entire source statement.
pub fn check_detail_with_statements(schema: &Schema, program: &Program, statement_ends: &[usize]) -> Result<(), Problem> {
    maintenance_types::check(schema, program).map_err(|message| Problem {
        code: "E_VIEW_KEY", site: program.name.clone(), page_site: None, message,
        rewrite: "project the field you need first: value or member fields; project recountPending as data and check complete; use a separate variable for the row".into(),
    })?;
    let mut fact = schema.operations.get(&program.name).cloned().unwrap_or_default();
    crate::schema::ephemeral::execution(schema, program, &mut fact).map_err(|message| Problem {
        code: "E_QUARRY_EPHEMERAL", site: program.name.clone(), page_site: None,
        message, rewrite: "split durable work from ephemeral mutations and queries".into(),
    })?;
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
        // @ref LLP 3000.025#3-proposed-rule — an entire read-only statement prefix precedes every effect, including hidden and indirect writes.
        let (prefix_len, effect_end) = read_only_prefix(&program.body, statement_ends);
        let (prelude, _) = crate::ir::body_read_structure(&program.body[..prefix_len]);
        let never = schema.operations.get(&program.name).is_some_and(|fact| fact.predicts.as_deref() == Some("never"));
        for scan in &scans {
            // Identity, not a forgeable diagnostic site or structural equality.
            let in_prefix = prelude.iter().any(|before| std::ptr::eq(*before, *scan));
            if let Some(reason) = plain_prefix_problem(schema, scan) {
                return Err(fanout(Some(scan), &scan.site, &reason, "read this page in a query, then pass the selected ids to the mutation"));
            }
            if schema.table(&scan.table).is_some_and(|table| table.is_expiring()) && !(never && in_prefix) {
                return Err(expiry_problem(program, scan, prefix_len..effect_end, never, in_prefix));
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

// Always cover the complete body; absent or malformed boundaries cannot skip
// an effect. A source statement may own several lowered top-level statements.
fn read_only_prefix(body: &[Stmt], statement_ends: &[usize]) -> (usize, usize) {
    let ends: Vec<_> = if statement_ends.is_empty() { (1..=body.len()).collect() }
        else { statement_ends.iter().copied().chain(std::iter::once(body.len())).collect() };
    let mut start = 0;
    for end in ends {
        if end <= start || end > body.len() { continue; }
        if !super::read_only::statements::<false>(&body[start..end]) { return (start, end); }
        start = end;
    }
    (body.len(), body.len())
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
            Expr::Block { .. } => Origin::Unknown(crate::ir::expression_scans(expr).into_iter().cloned().collect()),
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
                    let variants = origin.scans();
                    let variant = variants.iter().find(|scan| scan.variant.is_some());
                    if self.error.is_none() && let Some(scan) = variant {
                        self.error = Some(fanout(Some(scan), &site, "argument-presence alternatives cannot supply a mutation population",
                            &format!("iterate the complete capped group with `for row in {}:` and put the optional filter and work inside that loop; or move this pass to a job sweep", scan.table)));
                    }
                    let read_emit_list = variant.is_none() && matches!(domain, LoopDomain::DerivedArray { .. } | LoopDomain::ArgList { .. }) && super::read_only::statements::<true>(body);
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
            // Expiry was checked once on original scan identities above;
            // these flow copies only check the remaining page shape.
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

// @ref LLP 3000.025#6-diagnostics-and-exact-documentation-changes — name the enclosing statement, not an inferred product invariant.
fn expiry_problem(program: &Program, scan: &Scan, boundary: std::ops::Range<usize>, never: bool, in_prefix: bool) -> Problem {
    let mut message = format!("{} scans expiring {}", program.name, scan.table);
    let mut rewrite = if never { String::new() } else { format!("Make `{}` `: server`. ", program.name) };
    if in_prefix {
        message.push_str(" but may predict");
    } else if let Some(statement) = program.body[boundary.clone()].last() {
        let group = &program.body[boundary.clone()];
        let (inside, _) = crate::ir::body_read_structure(group);
        let enclosing = inside.iter().any(|candidate| std::ptr::eq(*candidate, scan));
        let site = match statement {
            Stmt::If { .. } => "if".into(),
            Stmt::For { .. } => "for".into(),
            Stmt::Emit { effect, .. } => format!("emit {effect}"),
            Stmt::Const { name, .. } | Stmt::Let { name, .. } | Stmt::Assign { name, .. } if !name.starts_with('$') => format!("binding {name}"),
            Stmt::Update { table, .. } => format!("update {table}"),
            Stmt::Upsert { table, .. } => format!("upsert {table}"),
            Stmt::WriteTarget { target, upsert, .. } => format!("{} {}", if *upsert { "upsert" } else { "update" }, target.table),
            Stmt::Delete { table, .. } => format!("delete {table}"),
            Stmt::DeleteTarget { target } => format!("delete {}", target.table),
            Stmt::Insert { table, .. } | Stmt::InsertIfAbsent { table, .. } => format!("insert {table}"),
            _ => format!("statement {}", boundary.start + 1),
        };
        let effect = if super::read_only::statements::<true>(group) { "an emit" } else { "a write" };
        message.push_str(&if enclosing {
            format!(" inside `{site}` containing {effect} (an untaken arm counts)")
        } else {
            format!(" after `{site}` containing {effect}, ending the read-only phase")
        });
        if enclosing && let Stmt::For { .. } = statement {
            let single = Program { body: vec![statement.clone()], ..program.clone() };
            let writes = crate::ir::write_tables(&single);
            let action = writes.first().map_or("…", |(_, kind)| *kind);
            rewrite.push_str(&format!("Bind before this entire loop: `page = {} …`; `for row in page: {action} …`.", scan.table));
        } else {
            rewrite.push_str(&format!("Move this scan into its own statement above the entire `{site}`. Then write."));
        }
    }
    Problem { code: "E_STRUCTURAL_FANOUT", site: scan.site.clone(), page_site: Some(scan.site.clone()), message, rewrite: rewrite.trim().into() }
}

// @ref LLP 3000.025#3-proposed-rule — expiry alone may pass the server read-only prefix; matching and merges keep their refusal.
fn plain_prefix_problem(schema: &Schema, scan: &Scan) -> Option<String> {
    let table = schema.table(&scan.table)?;
    if !table.index(&scan.index)?.is_plain() || scan.prefix.iter().any(|key| matches!(key, IndexKeyExpr::WordPrefix(_))) {
        Some("matching word scans expand hidden words before deciding visibility; read it in a query, or use a plain prefix scan".into())
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
        && follows.columns.contains_key("followerId") && !follows.is_expiring()
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
