//! Value provenance for the public derived-column note, not authorization or
//! equality analysis. A read's selectors choose a value; they are not that value.
// @ref LLP 3000.007#20.21 — unknown dependence or exhausted diagnostic work cannot supply an all-writers proof.
use crate::{ast::{self, Expr, Stmt, WriteOp}, print};
use crate::bind::catalog::Catalog;
use std::collections::{BTreeMap, BTreeSet};

#[path = "aggregate_value.rs"]
mod abstract_value;
use abstract_value::{Budget, Control, Value, AMBIENT, READ, ARGUMENT, UNKNOWN};
use std::rc::Rc;

// Branches and iterations hold only their writes; looking up an unchanged
// binding borrows its parent instead of copying or joining the whole environment.
struct Binding { value: Value, origins: BTreeSet<String> }
struct Env { scopes: Vec<BTreeMap<String, Binding>> }
impl Env {
    fn new(values: BTreeMap<String, Value>) -> Self { Self { scopes: vec![values.into_iter().map(|(name, value)| (name, Binding { value, origins: BTreeSet::new() })).collect()] } }
    fn binding(&self, name: &str) -> Option<&Binding> { self.scopes.iter().rev().find_map(|scope| scope.get(name)) }
    fn get(&self, name: &str) -> Option<&Value> { self.binding(name).map(|binding| &binding.value) }
    fn insert(&mut self, name: String, value: Value) { self.insert_with(name, value, BTreeSet::new()); }
    fn insert_with(&mut self, name: String, value: Value, origins: BTreeSet<String>) { self.scopes.last_mut().unwrap().insert(name, Binding { value, origins }); }
    fn push(&mut self) { self.scopes.push(BTreeMap::new()); }
    fn pop(&mut self) -> BTreeMap<String, Binding> { self.scopes.pop().unwrap() }
}

#[derive(Default)]
struct Column {
    disqualified: bool,
    evidence: Option<(String, String)>,
    maintain: Option<String>,
    selected: Vec<(String, Control)>,
}

// @ref LLP 3000.007#21.8 — L26: arguments may select read-derived values; only data dependence disqualifies them (literal inserts may initialize).
fn columns(catalog: &Catalog, budget: Rc<Budget>) -> BTreeMap<(String, String), Column> {
    // A native job can write arbitrary tables; its value provenance is not in
    // this catalog. No column has an all-writers proof in that case.
    if catalog.documents.iter().flat_map(|doc| &doc.programs).any(|program| program.native && program.kind == ast::ProgramKind::Job) { return BTreeMap::new(); }
    let mut scan = Scan { budget: budget.clone(), control: Control::default(), loop_cardinalities: Vec::new(), writes: Vec::new(), catalog, visited: BTreeSet::new(), calls: Vec::new(), cache: BTreeMap::new(), shapes: Vec::new(), owner: String::new(), scope_args: BTreeSet::new() };
    for doc in &catalog.documents {
        for program in &doc.programs {
            if budget.exhausted() { return BTreeMap::new(); }
            scan.owner = program.name.clone();
            scan.scope_args = program.args.iter().map(|arg| arg.name.clone()).collect();
            let mut env = arguments(&program.args, &budget);
            scan.body(&program.prelude, &mut env, &budget.scalar(0));
            scan.body(&program.body, &mut env, &budget.scalar(0));
        }
        // Actions have no Quarry data-plane body. Their external steps call
        // declared mutations, whose arguments are already classified above.
    }
    // Even an uncalled helper belongs to the catalog. Analyze it with arbitrary
    // inputs, but do not add a fictitious argument writer to an instantiated one.
    for (name, function) in &catalog.functions {
        if budget.exhausted() { return BTreeMap::new(); }
        if !scan.visited.contains(name) {
            scan.owner = name.clone();
            scan.function(function, function.args.iter().map(|arg| typed_value(&arg.type_, ARGUMENT, &budget)).collect());
        }
    }
    // An unvisited write could disqualify any earlier evidence. Exhaustion
    // therefore abandons the catalog proof, not just its last expression.
    if budget.exhausted() { return BTreeMap::new(); }
    let mut columns = BTreeMap::<(String, String), Column>::new();
    for fact in scan.writes {
        let column = columns.entry((fact.table, fact.name)).or_default();
        if !fact.initializer && (fact.data & (ARGUMENT | UNKNOWN) != 0 || fact.data & READ == 0) { column.disqualified = true; }
        if fact.data & READ != 0 {
            column.evidence.get_or_insert((fact.expression.clone(), fact.owner));
            if fact.control.bits & ARGUMENT != 0 && column.selected.len() < 2
                && !column.selected.iter().any(|(expression, control)| expression == &fact.expression && control == &fact.control) {
                column.selected.push((fact.expression, fact.control));
            }
            if column.maintain.is_none() { column.maintain = fact.maintain; }
        }
    }
    columns
}

fn typed_value(ty: &ast::ScalarType, bits: u8, budget: &Rc<Budget>) -> Value {
    let Some(_frame) = budget.enter() else { return budget.scalar(UNKNOWN) };
    match &ty.kind {
        ast::TypeKind::List { item, .. } => budget.list(bits, typed_value(item, bits, budget)),
        _ => budget.scalar(bits),
    }
}

fn arguments(args: &[ast::ArgDecl], budget: &Rc<Budget>) -> Env { Env::new(args.iter().map(|arg| (arg.name.clone(), typed_value(&arg.type_, ARGUMENT, budget))).collect()) }

// Track data names through local aliases solely to detect unmodelled carried
// recurrences. These sets never supply READ or ARGUMENT evidence. Known finite
// branch choices keep their selectors out; an unresolved capture stays unknown.
fn origins(expr: &Expr, env: &Env, budget: &Rc<Budget>, names: &mut BTreeSet<String>) {
    let Some(_frame) = budget.enter() else { return };
    let mut visit = |expr: &Expr| origins(expr, env, budget, names);
    match expr {
        Expr::Name { name, .. } => {
            let inherited = env.binding(name).map(|binding| &binding.origins);
            if !budget.spend(1 + inherited.map_or(0, BTreeSet::len)) { return; }
            names.insert(name.clone());
            if let Some(inherited) = inherited { names.extend(inherited.iter().cloned()); }
        }
        Expr::Focal { .. } | Expr::Literal { .. } => {}
        Expr::Member { base, .. } => visit(base),
        Expr::ShapeUse { base, .. } => { visit(base); names.insert("?".into()); }
        Expr::Unary { value, .. } | Expr::Assert { value, .. } => visit(value),
        Expr::Binary { left, right, .. } => { visit(left); visit(right); }
        Expr::If { then, otherwise, .. } => { visit(then); visit(otherwise); }
        Expr::Array { items, .. } | Expr::Call { args: items, .. } => for item in items { visit(item); },
        Expr::Object { fields, .. } => for field in fields {
            if let Some(value) = &field.value { origins(value, env, budget, names); }
            else { origins(&Expr::Name { name: field.name.clone(), site: field.site.clone() }, env, budget, names); }
        },
        // Read keys select stored data; their names are not its data sources.
        Expr::Read(_) | Expr::Exists { .. } | Expr::Walk { .. } | Expr::Merge(_) => {}
        Expr::Created { .. } => { names.insert("?".into()); }
        Expr::Shape { base, fields, .. } => {
            visit(base);
            for field in fields {
                match field {
                    ast::ShapeField::Field { value, .. } => origins(value, env, budget, names),
                    ast::ShapeField::NamedSpread { .. } => { names.insert("?".into()); }
                    _ => {}
                }
            }
        }
        Expr::Write { keys, fields, .. } => {
            for key in keys { visit(&key.value); }
            for field in fields {
                if let Some(value) = &field.value { origins(value, env, budget, names); }
                else { origins(&Expr::Name { name: field.name.clone(), site: field.site.clone() }, env, budget, names); }
            }
        }
    }
}

struct Flow { returned: Option<Value>, loop_exit: Control }

#[derive(Clone)]
struct WriteFact {
    table: String, name: String, data: u8, control: Control, initializer: bool,
    expression: String, owner: String, maintain: Option<String>,
}

// Bit 1 exits the function; bit 2 exits/continues the containing loop.
fn exits_path(stmts: &[Stmt], budget: &Rc<Budget>) -> u8 {
    let Some(_frame) = budget.enter() else { return 3 };
    let mut exits = 0;
    for stmt in stmts {
        if !budget.spend(1) { return 3; }
        exits |= match stmt {
            Stmt::Return { .. } => 1,
            Stmt::Break { .. } | Stmt::Continue { .. } => 2,
            Stmt::If { then_body, else_body, .. } => exits_path(then_body, budget) | exits_path(else_body, budget),
            Stmt::For { body, .. } => exits_path(body, budget) & 1,
            _ => 0,
        };
    }
    exits
}

fn assigned_names(stmts: &[Stmt], budget: &Rc<Budget>, names: &mut BTreeSet<String>) {
    let Some(_frame) = budget.enter() else { return };
    for stmt in stmts {
        if !budget.spend(1) { return; }
        match stmt {
            Stmt::Bind { names: assigned, .. } => {
                if !budget.spend(assigned.len()) { return; }
                names.extend(assigned.iter().cloned());
            }
            Stmt::If { then_body, else_body, .. } => {
                assigned_names(then_body, budget, names);
                assigned_names(else_body, budget, names);
            }
            Stmt::For { body, .. } => assigned_names(body, budget, names),
            _ => {}
        }
    }
}

struct Scan<'a> {
    budget: Rc<Budget>,
    control: Control,
    loop_cardinalities: Vec<(usize, u8)>,
    writes: Vec<WriteFact>,
    catalog: &'a Catalog,
    visited: BTreeSet<String>,
    calls: Vec<String>,
    cache: BTreeMap<(String, Vec<Value>, Control), (Value, Vec<WriteFact>)>,
    shapes: Vec<String>,
    owner: String,
    scope_args: BTreeSet<String>,
}

impl Scan<'_> {
    fn selection(&self, expr: &Expr, value: &Value) -> Control {
        let control = value.controls();
        let choice = if value.all() & ARGUMENT != 0 {
            // Conditions such as `set and not exists ...` and `not set`
            // select with the same argument, so they share one arm witness.
            let mut names = BTreeSet::new();
            self.selection_names(expr, &mut names);
            if names.is_empty() { control.choice.clone() }
            else { Some(Rc::new((names.into_iter().collect::<Vec<_>>().join(", "), self.calls.last().unwrap_or(&self.owner).clone()))) }
        } else { control.choice.clone() };
        Control { bits: value.all() | control.bits, choice }
    }

    fn selection_names(&self, expr: &Expr, names: &mut BTreeSet<String>) {
        let Some(_frame) = self.budget.enter() else { return };
        match expr {
            Expr::Name { name, .. } if self.scope_args.contains(name) => { names.insert(name.clone()); }
            Expr::Unary { value, .. } | Expr::Assert { value, .. } => self.selection_names(value, names),
            Expr::Member { base, .. } | Expr::ShapeUse { base, .. } => self.selection_names(base, names),
            Expr::Binary { left, right, .. } => { self.selection_names(left, names); self.selection_names(right, names); }
            Expr::If { then, condition, otherwise, .. } => {
                for value in [then, condition, otherwise] { self.selection_names(value, names); }
            }
            Expr::Call { args, .. } | Expr::Array { items: args, .. } => {
                for arg in args { if self.budget.exhausted() { break; } self.selection_names(arg, names); }
            }
            Expr::Object { fields, .. } => for field in fields {
                if !self.budget.spend(1) { break; }
                if let Some(value) = &field.value { self.selection_names(value, names); }
                else if self.scope_args.contains(&field.name) { names.insert(field.name.clone()); }
            },
            // Read keys select the read's data; they do not supply it. Other
            // forms without a direct parameter witness use "an argument".
            _ => {}
        }
    }

    fn function(&mut self, function: &ast::FunctionDecl, args: Vec<Value>) -> Value {
        let Some(_frame) = self.budget.enter() else { return self.budget.scalar(UNKNOWN) };
        if args.len() != function.args.len() || self.calls.contains(&function.name) { return self.budget.scalar(UNKNOWN); }
        if !self.budget.spend(1 + args.iter().map(|value| value.nodes).sum::<usize>()) { return self.budget.scalar(UNKNOWN); }
        let key = (function.name.clone(), args, self.control.clone());
        // Replay writes too: a later enclosing loop exit can taint this call's
        // writes even when an earlier invocation had identical arguments/control.
        if let Some((result, writes)) = self.cache.get(&key) {
            if !self.budget.spend(writes.len()) { return self.budget.scalar(UNKNOWN); }
            self.writes.extend(writes.iter().cloned());
            return result.clone();
        }
        let start = self.writes.len();
        self.visited.insert(function.name.clone());
        self.calls.push(function.name.clone());
        let scope_args = std::mem::replace(&mut self.scope_args, function.args.iter().map(|arg| arg.name.clone()).collect());
        let mut env = Env::new(function.args.iter().zip(&key.1).map(|(arg, value)| (arg.name.clone(), value.clone())).collect());
        let loop_cardinalities = std::mem::take(&mut self.loop_cardinalities);
        let result = match &function.body {
            ast::FunctionBody::Expression(value) => self.expr(value, &mut env, &self.budget.scalar(0)),
            ast::FunctionBody::Block(stmts) => self.body(stmts, &mut env, &self.budget.scalar(0)).returned.unwrap_or_else(|| self.budget.scalar(AMBIENT)),
        };
        self.loop_cardinalities = loop_cardinalities;
        self.scope_args = scope_args;
        self.calls.pop();
        if self.budget.spend(self.writes.len() - start) {
            self.cache.insert(key, (result.clone(), self.writes[start..].to_vec()));
        }
        result
    }

    fn body(&mut self, stmts: &[Stmt], env: &mut Env, focal: &Value) -> Flow {
        let Some(_frame) = self.budget.enter() else { return Flow { returned: Some(self.budget.scalar(UNKNOWN)), loop_exit: Control { bits: UNKNOWN, choice: None } } };
        let mut result: Option<Value> = None;
        let inherited = self.control.clone();
        let mut control = inherited.clone();
        let mut carried_control = Control::default();
        for stmt in stmts {
            if !self.budget.spend(1) { break; }
            self.control = control.union(&carried_control);
            match stmt {
                Stmt::Bind { names, value, .. } => {
                    // Recognize direct recurrences for values consumed during
                    // this iteration; the loop join influences all assignments.
                    let accumulation = names.len() == 1 && matches!(value,
                        Expr::Binary { op, left, right, .. } if matches!(op.as_str(), "+" | "-")
                            && (matches!(left.as_ref(), Expr::Name { name, .. } if name == &names[0])
                                || op == "+" && matches!(right.as_ref(), Expr::Name { name, .. } if name == &names[0])));
                    let mut dependencies = BTreeSet::new();
                    if !self.loop_cardinalities.is_empty() { origins(value, env, &self.budget, &mut dependencies); }
                    let count = names.iter().fold(0, |bits, name| self.loop_cardinalities.iter().fold(bits, |bits, (depth, cardinality)| {
                        let carried = env.scopes[..*depth].iter().any(|scope| scope.contains_key(name));
                        let overwritten = env.scopes[*depth..].iter().any(|scope| scope.contains_key(name));
                        bits | if carried && !overwritten {
                            if accumulation { *cardinality }
                            else if dependencies.contains(name) || dependencies.contains("?") { UNKNOWN } else { 0 }
                        } else { 0 }
                    }));
                    // A two-name binding is `divmod`/`sorted` by syntax: the binder never consults a
                    // helper of that name, so a declared one must not lend its provenance (round 6).
                    let value = if names.len() == 2 && matches!(value, Expr::Call { name, .. } if self.catalog.functions.contains_key(name)) {
                        if let Expr::Call { args, .. } = value { for arg in args { self.expr(arg, env, focal); } }
                        self.budget.scalar(UNKNOWN)
                    } else { self.expr(value, env, focal) }.selected(&carried_control).influenced(count);
                    for name in names {
                        if !self.budget.spend(1 + dependencies.len()) { break; }
                        env.insert_with(name.clone(), value.clone(), dependencies.clone());
                    }
                }
                Stmt::Return { value, .. } => {
                    let value = self.expr(value, env, focal);
                    let value = value.selected(&control);
                    result = Some(result.map_or(value.clone(), |prior| prior.join(&value)));
                    break;
                }
                Stmt::Expr { value, .. } => { self.expr(value, env, focal); }
                Stmt::Require { condition: value, .. } => { self.expr(value, env, focal); }
                Stmt::Emit { payload, once, .. } => { self.expr(payload, env, focal); if let Some(key) = once { self.expr(key, env, focal); } }
                Stmt::If { condition, then_body, else_body, .. } => {
                    let value = self.expr(condition, env, focal);
                    let condition = self.selection(condition, &value);
                    self.control = self.control.union(&condition);
                    env.push();
                    let yes_return = self.body(then_body, env, focal);
                    let yes = env.pop();
                    env.push();
                    let no_return = self.body(else_body, env, focal);
                    let no = env.pop();
                    carried_control = carried_control.union(&yes_return.loop_exit).union(&no_return.loop_exit);
                    for returned in [yes_return.returned, no_return.returned].into_iter().flatten() {
                        let returned = returned.selected(&condition.union(&control));
                        result = Some(result.map_or(returned.clone(), |prior| prior.join(&returned)));
                    }
                    let changed: BTreeSet<_> = yes.keys().chain(no.keys()).collect();
                    for name in changed {
                        let Some(old) = env.binding(name) else { continue };
                        let left = yes.get(name).unwrap_or(old);
                        let right = no.get(name).unwrap_or(old);
                        let joined = left.value.join(&right.value);
                        if !self.budget.spend(left.origins.len() + right.origins.len()) { break; }
                        let dependencies = left.origins.union(&right.origins).cloned().collect();
                        // Equal provenance bits do not mean equal values: a
                        // caller may select 1 versus 2 through a statement if.
                        env.insert_with(name.clone(), joined.selected(&condition), dependencies);
                    }
                    // A conditional break/continue changes later carried values;
                    // a conditional return chooses which later value is returned.
                    let exits = exits_path(then_body, &self.budget) | exits_path(else_body, &self.budget);
                    if exits != 0 { control = control.union(&condition); }
                    if exits & 2 != 0 { carried_control = carried_control.union(&condition); }
                }
                Stmt::For { name, domain, body, .. } => {
                    // `range(a, b)` as a loop domain is syntax the binder handles itself; a helper
                    // of that name is bypassed there, so the pass must not call it (round 6).
                    let domain_value = if matches!(domain, Expr::Call { name, .. } if name == "range" && self.catalog.functions.contains_key("range")) {
                        if let Expr::Call { args, .. } = domain { for arg in args { self.expr(arg, env, focal); } }
                        self.budget.list(UNKNOWN, self.budget.scalar(UNKNOWN))
                    } else { self.expr(domain, env, focal) };
                    let count_influence = self.selection(domain, &domain_value);
                    let domain = domain_value;
                    let mut assigned = BTreeSet::new();
                    assigned_names(body, &self.budget, &mut assigned);
                    self.loop_cardinalities.push((env.scopes.len(), domain.cardinality));
                    let value = domain.element();
                    // Keep the first iteration's shape, then widen recursive
                    // growth to a finite summary while the provenance bits settle.
                    let mut first = true;
                    let loop_start = self.writes.len();
                    loop {
                        if !self.budget.spend(1) { break; }
                        self.control = control.union(&carried_control).union(&count_influence);
                        env.push();
                        env.insert(name.clone(), value.clone());
                        let flow = self.body(body, env, focal);
                        for fact in &mut self.writes[loop_start..] {
                            if !self.budget.spend(1) { break; }
                            fact.control = fact.control.union(&flow.loop_exit);
                            fact.data |= flow.loop_exit.bits & UNKNOWN;
                        }
                        if let Some(returned) = flow.returned {
                            // A return inside the loop may skip subsequent writes.
                            control = control.union(&returned.controls());
                            let returned = returned.selected(&count_influence.union(&control));
                            result = Some(result.map_or(returned.clone(), |prior| prior.join(&returned)));
                        }
                        let iteration = env.pop();
                        let mut changed = false;
                        for key in &assigned {
                            if !self.budget.spend(1) { break; }
                            if key == name { continue; }
                            let Some(old) = env.binding(key) else { continue };
                            let value = iteration.get(key).unwrap_or(old);
                            let mut joined = if first { old.value.join(&value.value) } else { old.value.widen(&value.value) };
                            if !self.budget.spend(old.origins.len() + value.origins.len()) { break; }
                            let dependencies: BTreeSet<_> = old.origins.union(&value.origins).cloned().collect();
                            // @ref LLP 3000.007#21.8 — L29: every assigned binding consumes domain cardinality, even after a break or reset.
                            joined = joined.influenced(domain.cardinality).selected(&count_influence.union(&flow.loop_exit));
                            changed |= old.value != joined || old.origins != dependencies;
                            env.insert_with(key.clone(), joined, dependencies);
                        }
                        if !changed { break; }
                        first = false;
                    }
                    self.loop_cardinalities.pop();
                }
                Stmt::Break { .. } | Stmt::Continue { .. } => break,
            }
        }
        self.control = inherited;
        Flow { returned: result, loop_exit: carried_control }
    }

    fn read(&mut self, read: &ast::ReadExpr, env: &mut Env, focal: &Value) -> Value {
        // A key selects WHICH group is counted — its size is a fact about the data, so
        // `count(likes[postId = postId])` is derived (the maintain-copy footgun) and a key's bits
        // stay control. Seek bounds, `matching` text, the cursor and the filter decide
        // HOW MANY rows the page holds: their bits enter its cardinality (L28) —
        // `count(posts[] matching q …)` with an argument `q` stores a caller-controlled
        // number (round 6, Grok).
        for key in &read.keys { self.expr(&key.value, env, focal); }
        let mut cardinality = READ;
        for seek in &read.seeks { cardinality |= self.expr(&seek.value, env, focal).all(); }
        if let Some(value) = &read.matching { cardinality |= self.expr(value, env, focal).all(); }
        if let Some(value) = read.range.as_ref().and_then(|range| range.cursor.as_ref()) { cardinality |= self.expr(value, env, focal).all(); }
        let row = self.row(&read.table);
        cardinality |= row.data;
        if let Some(value) = &read.filter { cardinality |= self.expr(value, env, &row).all(); }
        if read.range.is_some() || read.matching.is_some() || read.filter.is_some() || !read.seeks.is_empty() || read.keys.is_empty() {
            return self.budget.list(cardinality, row);
        }
        let Some(info) = self.catalog.tables.get(&read.table) else { return row };
        let mut point = false;
        let mut page = false;
        for index in &info.indexes {
            if !self.budget.spend(1 + index.columns.len() + read.keys.len()) { return self.budget.scalar(UNKNOWN); }
            if read.index.as_ref().is_some_and(|name| &index.name != name) || index.words.is_some() { continue; }
            if info.maintained.is_some() && read.index.is_none() && index.name != "byGroup" { continue; }
            point |= index.unique && (index.columns.len() == read.keys.len() && read.keys.iter().all(|key| key.column.as_ref().is_none_or(|column| index.columns.contains(column)))
                || info.total_unique(index) && index.columns.iter().all(|column| read.keys.iter().any(|key| key.column.as_ref() == Some(column))));
            page |= index.columns.len() > read.keys.len() && read.keys.iter().all(|key| key.column.as_ref().is_none_or(|column| index.columns[..read.keys.len()].contains(column)));
        }
        match (point, page) {
            (false, true) => self.budget.list(cardinality, row),
            (true, false) if info.maintained.is_none() => row,
            // Positional index selection also depends on types. This pass does
            // not repeat the binder: an opaque read still has READ data/length,
            // but a projection that needs its row-versus-list shape is UNKNOWN.
            (true, _) => self.budget.scalar(READ),
            _ => self.budget.scalar(UNKNOWN),
        }
    }

    fn row(&self, table: &str) -> Value {
        let Some(info) = self.catalog.tables.get(table) else { return self.budget.scalar(if table == "connected" { AMBIENT } else { UNKNOWN }) };
        let mut fields = BTreeMap::new();
        for (name, ty) in &info.columns {
            if !self.budget.spend(1) { return self.budget.scalar(UNKNOWN); }
            fields.insert(name.clone(), typed_value(ty, READ, &self.budget));
        }
        fields.insert("id".into(), self.budget.scalar(READ));
        self.budget.object(READ, fields)
    }

    fn fields(&mut self, fields: &[ast::ObjectField], env: &mut Env, focal: &Value) -> BTreeMap<String, Value> {
        let mut values = BTreeMap::new();
        for field in fields {
            if !self.budget.spend(1) { break; }
            let value = match &field.value { Some(expr) => self.expr(expr, env, focal), None => env.get(&field.name).cloned().unwrap_or_else(|| self.budget.scalar(UNKNOWN)) };
            values.insert(field.name.clone(), value);
        }
        values
    }

    fn shape(&mut self, base: Value, fields: &[ast::ShapeField], env: &mut Env) -> Value {
        let Some(_frame) = self.budget.enter() else { return self.budget.scalar(UNKNOWN) };
        // An opaque JSON/scalar source might be a list or an object. Replacing
        // its fields cannot establish either its item shape or cardinality.
        let opaque = base.item.is_none() && base.fields.is_empty() && !base.literal;
        let row = base.element();
        let mut bits = 0;
        let mut result = BTreeMap::new();
        for field in fields {
            if !self.budget.spend(1) { return self.budget.scalar(UNKNOWN); }
            match field {
                ast::ShapeField::Spread { .. } => {
                    if !self.budget.spend(row.nodes) { return self.budget.scalar(UNKNOWN); }
                    bits |= row.data;
                    result.extend(row.fields.clone());
                }
                ast::ShapeField::NamedSpread { name, .. } => {
                    let spread = self.named_shape(row.clone(), name, env);
                    if !self.budget.spend(spread.nodes) { return self.budget.scalar(UNKNOWN); }
                    bits |= spread.data;
                    result.extend(spread.fields.clone());
                }
                ast::ShapeField::Bare { name, .. } => { result.insert(name.clone(), row.field(name)); }
                ast::ShapeField::Field { name, value, .. } => { result.insert(name.clone(), self.expr(value, env, &row)); }
            }
        }
        // An optional/composed source may be selected by the caller even when
        // the projection replaces every field. Preserve that selection.
        let result = self.budget.object(bits, result).influenced(if opaque { UNKNOWN } else { base.data & UNKNOWN }).selected(&base.controls());
        if base.item.is_some() { self.budget.list(base.cardinality, result).selected(&base.control) } else { result }
    }

    fn named_shape(&mut self, base: Value, name: &str, env: &mut Env) -> Value {
        if self.shapes.iter().any(|active| active == name) { return self.budget.scalar(UNKNOWN); }
        let Some(shape) = self.catalog.shapes.get(name) else { return self.budget.scalar(UNKNOWN) };
        self.shapes.push(name.into());
        let result = self.shape(base, &shape.fields, env);
        self.shapes.pop();
        result
    }

    fn expr(&mut self, expr: &Expr, env: &mut Env, focal: &Value) -> Value {
        let Some(_frame) = self.budget.enter() else { return self.budget.scalar(UNKNOWN) };
        match expr {
            Expr::Name { name, .. } => env.get(name).cloned().unwrap_or_else(|| self.budget.scalar(if matches!(name.as_str(), "viewer" | "now" | "commit" | "new") { AMBIENT } else { UNKNOWN })),
            Expr::Focal { .. } => focal.clone(),
            Expr::Literal { .. } => self.budget.literal(),
            Expr::Member { base, name, .. } => self.expr(base, env, focal).field(name),
            Expr::Assert { value, .. } => self.expr(value, env, focal),
            Expr::Unary { op, value, .. } => {
                let value = self.expr(value, env, focal);
                if op == "-" && value.literal { self.budget.literal().selected(&value.controls()) } else { value.summary() }
            }
            Expr::Binary { op, left, right, .. } => {
                let a = self.expr(left, env, focal);
                let saved = self.control.clone();
                if matches!(op.as_str(), "and" | "or" | "??") { self.control = self.control.union(&self.selection(left, &a)); }
                let b = self.expr(right, env, focal);
                self.control = saved;
                if op == "??" || op == "+" && a.item.is_some() && b.item.is_some() { a.join(&b) }
                else { self.budget.scalar(a.all() | b.all()).selected(&a.controls().union(&b.controls())) }
            },
            Expr::If { then, condition, otherwise, .. } => {
                let value = self.expr(condition, env, focal);
                let condition = self.selection(condition, &value);
                let saved = self.control.clone();
                self.control = self.control.union(&condition);
                let a = self.expr(then, env, focal);
                let b = self.expr(otherwise, env, focal);
                self.control = saved;
                a.join(&b).selected(&condition)
            }
            Expr::Array { items, .. } => {
                let mut item: Option<Value> = None;
                for value in items {
                    if self.budget.exhausted() { return self.budget.scalar(UNKNOWN); }
                    let value = self.expr(value, env, focal);
                    item = Some(item.map_or(value.clone(), |prior| prior.join(&value)));
                }
                self.budget.list(AMBIENT, item.unwrap_or_else(|| self.budget.scalar(AMBIENT)))
            }
            Expr::Object { fields, .. } => { let fields = self.fields(fields, env, focal); self.budget.object(0, fields) },
            Expr::Shape { base, fields, .. } => {
                let value = self.expr(base, env, focal);
                let selection = self.selection(base, &value);
                self.shape(value, fields, env).selected(&selection)
            }
            Expr::ShapeUse { base, name, .. } => {
                let value = self.expr(base, env, focal);
                let selection = self.selection(base, &value);
                self.named_shape(value, name, env).selected(&selection)
            }
            Expr::Read(read) => self.read(read, env, focal),
            Expr::Exists { read, .. } => { let value = self.read(read, env, focal); value.summary() }
            Expr::Created { read, .. } => { self.read(read, env, focal); self.budget.scalar(UNKNOWN) } // rule-only form
            Expr::Walk { table, seed, .. } => {
                self.expr(seed, env, focal);
                let bits = if self.catalog.tables.contains_key(table) { READ } else { UNKNOWN };
                self.budget.list(bits, self.row(table))
            }
            Expr::Merge(merge) => {
                let known = self.catalog.tables.contains_key(&merge.table)
                    && merge.lanes.iter().all(|lane| lane.table.as_ref().is_none_or(|table| self.catalog.tables.contains_key(table)));
                let mut bits = if known { READ } else { UNKNOWN };
                for lane in &merge.lanes {
                    env.push();
                    // Lane prefixes are keys: which groups, not how many. A lane list's own
                    // cardinality (an argument-bounded range of lanes) does shape the count.
                    if let Some((name, domain)) = &lane.loop_ { let domain = self.expr(domain, env, focal); bits |= domain.cardinality(); env.insert(name.clone(), domain.element()); }
                    for value in &lane.prefix { self.expr(value, env, focal); }
                    env.pop();
                }
                // `matching` text, the cursor and the filter decide how many rows the merge yields (L28).
                for value in [&merge.matching, &merge.cursor].into_iter().flatten() { bits |= self.expr(value, env, &self.budget.scalar(READ)).all(); }
                let row = self.row(&merge.table);
                if let Some(filter) = &merge.filter { bits |= self.expr(filter, env, &row).all(); }
                self.budget.list(bits, row)
            }
            Expr::Call { name, args, .. } => {
                // Uncalled helpers are not typechecked by ordinary binding. This
                // diagnostic pass must establish its own indexing preconditions.
                if !self.catalog.functions.contains_key(name) && !builtin_arity(name, args.len()) {
                    for arg in args { self.expr(arg, env, focal); }
                    return self.budget.scalar(UNKNOWN);
                }
                if name == "sum" && args.len() == 2 && !self.catalog.functions.contains_key(name) {
                    let source = self.expr(&args[0], env, focal);
                    let saved = self.control.clone();
                    self.control = self.control.union(&self.selection(&args[0], &source));
                    let projection = self.expr(&args[1], env, &source.element());
                    self.control = saved;
                    return self.budget.scalar(source.cardinality | projection.all()).selected(&source.control.union(&projection.controls()));
                }
                let values: Vec<_> = args.iter().map(|arg| self.expr(arg, env, focal)).collect();
                if let Some(function) = self.catalog.functions.get(name) { return self.function(function, values); }
                match name.as_str() {
                    "first" | "last" => values.first().map(Value::consumed_element).unwrap_or_else(|| self.budget.scalar(UNKNOWN)),
                    "at" => values[0].consumed_element().selected(&self.selection(&args[1], &values[1])),
                    "slice" => {
                        values[0].selected(&args[1..].iter().zip(&values[1..]).fold(Control::default(), |control, (arg, value)| control.union(&self.selection(arg, value))))
                    }
                    "sort" => {
                        let mut influence = Control::default();
                        for arg in &args[1..] {
                            let Expr::Literal { value: ast::Literal::Str(field), .. } = arg else { return self.budget.scalar(UNKNOWN) };
                            let key = values[0].element().field(field.strip_prefix('-').unwrap_or(field));
                            influence = influence.union(&self.selection(expr, &key));
                        }
                        values[0].selected(&influence)
                    }
                    "group" => {
                        let source = values[0].clone();
                        let Expr::Literal { value: ast::Literal::Str(field), .. } = &args[1] else { return self.budget.scalar(UNKNOWN) };
                        let key = source.element().field(field);
                        // Key equality selects group membership and cardinality,
                        // including nested projections of an item from a group.
                        let bits = source.cardinality;
                        let control = self.selection(expr, &key).union(&source.control);
                        let source = source.selected(&control);
                        let group = self.budget.object(0, BTreeMap::from([("key".into(), key), ("items".into(), source)]));
                        self.budget.list(bits, group).selected(&control)
                    }
                    // These forms either return scalars or collapse all input
                    // influence into a summary shared by every selected field.
                    "count" => self.budget.scalar(values[0].cardinality | (values[0].all() & UNKNOWN)).selected(&values[0].control),
                    "range" | "tokens" => {
                        let value = self.budget.scalar(values.iter().fold(AMBIENT, |bits, value| bits | value.all()))
                            .selected(&values.iter().fold(Control::default(), |control, value| control.union(&value.controls())));
                        self.budget.list(value.all(), value)
                    }
                    "min" | "max" | "sorted" => {
                        let joined = values[0].join(&values[1]);
                        // Both candidate item trees and both cardinalities survive
                        // scalar/pair selection; comparison never drops supplied data.
                        joined.influenced(values[0].all() | values[1].all()).with_cardinality(joined.cardinality)
                    }
                    "sha256" => values[0].summary().with_cardinality(AMBIENT),
                    "sum" | "lower" | "trim" | "join"
                    | "divmod" | "share" | "day" | "hour" | "bucket" =>
                        self.budget.scalar(values.iter().fold(AMBIENT, |bits, value| bits | value.all()))
                            .selected(&values.iter().fold(Control::default(), |control, value| control.union(&value.controls()))),
                    _ => self.budget.scalar(UNKNOWN),
                }
            }
            Expr::Write { op, table, keys, fields, condition, .. } => {
                let key_values: Vec<_> = keys.iter().map(|key| self.expr(&key.value, env, focal)).collect();
                if let Some(condition) = condition { self.expr(condition, env, &self.budget.scalar(READ)); }
                if *op == WriteOp::Delete { return self.budget.scalar(AMBIENT); }
                let mut values = self.fields(fields, env, focal);
                if self.budget.exhausted() { return self.budget.scalar(UNKNOWN); }
                if matches!(op, WriteOp::Insert | WriteOp::Upsert) {
                    if let Some(info) = self.catalog.tables.get(table) {
                        if *op == WriteOp::Upsert {
                            // The insert arm fills omitted unique-key fields. Named
                            // keys are exact; ambiguous positional index choices are
                            // unknown here, never evidence for a derived column.
                            for index in info.indexes.iter().filter(|index| index.unique && index.columns.len() == keys.len()) {
                                for (position, name) in index.columns.iter().enumerate() {
                                    if values.contains_key(name) { continue; }
                                    let value = if keys.iter().all(|key| key.column.is_some()) {
                                        let Some(at) = keys.iter().position(|key| key.column.as_ref() == Some(name)) else { continue };
                                        key_values[at].clone()
                                    } else if name == "id" && info.indexes.iter().filter(|index| index.unique && index.columns.len() == keys.len()).count() == 1 {
                                        key_values[position].clone()
                                    } else { key_values[position].clone().influenced(UNKNOWN) };
                                    // The byId insert arm copies the key into the
                                    // returned id. It is supplied data, not a mint;
                                    // id itself is not a declared-column write fact.
                                    if name != "id" { self.record(table, name, &value, true, "upsert key", None); }
                                    values.insert(name.clone(), value);
                                }
                            }
                        }
                        for column in &info.decl.columns {
                            if !values.contains_key(&column.name) {
                                if let Some(default) = &column.default {
                                    let value = self.expr(default, env, focal);
                                    self.record(table, &column.name, &value, true, &print::expression(default), None);
                                    values.insert(column.name.clone(), value);
                                } else if column.type_.optional {
                                    let value = self.budget.literal();
                                    self.record(table, &column.name, &value, true, "null", None);
                                    values.insert(column.name.clone(), value);
                                }
                            }
                        }
                    }
                }
                for field in fields {
                    let evidence = field.value.as_ref().map_or_else(|| field.name.clone(), evidence);
                    let maintain = match &field.value {
                        Some(Expr::Read(read)) if read.range.is_none() && self.catalog.maintains.contains_key(&read.table) => Some(read.table.clone()),
                        _ => None,
                    };
                    if let Some(value) = values.get(&field.name) {
                        self.record(table, &field.name, value, *op == WriteOp::Insert, &evidence, maintain);
                    }
                }
                // A write result retains supplied field provenance, including
                // arguments, while unpatched fields come from the prior image.
                values.entry("id".into()).or_insert_with(|| self.budget.scalar(AMBIENT));
                self.budget.object(if *op == WriteOp::Insert { 0 } else { READ }, values)
            }
        }
    }

    fn record(&mut self, table: &str, name: &str, value: &Value, insert: bool, expression: &str, maintain: Option<String>) {
        if !self.budget.spend(1) { return; }
        // Only data bits decide the proof. Keep caller selection as evidence,
        // and retain UNKNOWN when the audit could not model the dependence.
        let control = self.control.union(&value.controls());
        self.writes.push(WriteFact { table: table.into(), name: name.into(), data: value.all() | (control.bits & UNKNOWN), control,
            initializer: insert && value.literal,
            expression: expression.into(), owner: self.owner.clone(), maintain });
    }
}

// The shared rewrite printer omits precedence parentheses. Preserve them for
// nested arithmetic/conditional operands in this note's written-value evidence.
fn evidence(expr: &Expr) -> String {
    match expr {
        Expr::Binary { op, left, right, .. } => {
            let operand = |value: &Expr| {
                let text = evidence(value);
                if matches!(value, Expr::Binary { .. } | Expr::If { .. }) { format!("({text})") } else { text }
            };
            format!("{} {op} {}", operand(left), operand(right))
        }
        _ => print::expression(expr),
    }
}

fn builtin_arity(name: &str, count: usize) -> bool {
    match name {
        "count" | "first" | "last" | "lower" | "trim" | "sha256" | "tokens" => count == 1,
        "at" | "group" | "join" | "min" | "max" | "range" | "sorted" | "divmod" => count == 2,
        "slice" | "share" => count == 3,
        "sum" | "day" | "hour" => matches!(count, 1 | 2),
        "bucket" => matches!(count, 2 | 3),
        "sort" => count >= 2,
        _ => false,
    }
}

pub(crate) fn notes(catalog: &Catalog, schema: &snapback4_core::schema::Schema) -> Vec<crate::diag::Diagnostic> {
    notes_with_budget(catalog, schema, Rc::new(Budget::default()))
}

fn notes_with_budget(catalog: &Catalog, schema: &snapback4_core::schema::Schema, budget: Rc<Budget>) -> Vec<crate::diag::Diagnostic> {
    use snapback4_core::schema::{Audience, ColumnType, Constraint};
    columns(catalog, budget).into_iter().filter_map(|((table, column), fact)| {
        let (expression, owner) = fact.evidence?;
        let target = schema.table(&table)?;
        let rules: Vec<_> = [("insert", &target.rules.insert), ("update", &target.rules.update)].into_iter()
            .filter(|(_, rule)| crate::bind::rule_truth(rule) == Some(true)).map(|(name, rule)| format!("`{name} <- {}`", rule.quarry())).collect();
        if fact.disqualified || schema.maintain_for(&table).is_some()
            || !(target.rules.read.is_uniformly_readable() || target.sync.as_ref().is_some_and(|sync| sync.audience == Audience::Public))
            || rules.is_empty()
            || target.constraints.iter().any(|constraint| matches!(constraint, Constraint::AppendOnly) || matches!(constraint, Constraint::Immutable { fields } if fields.contains(&column))) {
            return None;
        }
        let permission = format!("{} {}", rules.join(" and "), if rules.len() == 1 { "lets" } else { "let" });
        let message = if let Some((_, control)) = fact.selected.first() {
            let expressions = fact.selected.iter().filter(|(_, selected)| selected.choice == control.choice)
                .map(|(expression, _)| format!("`{expression}`")).collect::<Vec<_>>().join(" or ");
            let selected = control.choice.as_ref().map_or_else(|| format!("chosen by an argument in `{owner}`"),
                |choice| format!("chosen by `{}` in `{}`", choice.0, choice.1));
            format!("every write to {table}.{column} is computed from reads ({expressions}, {selected}); {permission} any principal run any mutation that writes it")
        } else if let Some(aggregate) = fact.maintain.filter(|name| schema.maintain_for(name).is_some_and(|maintain| maintain.source != table)) {
            let maintain = schema.maintain_for(&aggregate).unwrap();
            format!("column {table}.{column} copies maintain {aggregate}, an aggregate of {} the engine already keeps; {permission} any principal set this public column through any mutation that writes it", maintain.source)
        } else {
            format!("every write to {table}.{column} is computed from reads (`{expression}` in `{owner}`); {permission} any principal run any mutation that writes it")
        };
        let site = catalog.site_for(&format!("tables.{table}.columns.{column}"));
        let rewrite = super::rewrite(&table, &column, target.columns.get(&column).is_some_and(|ty|
            matches!(ty.required(), ColumnType::Int | ColumnType::Decimal { .. } | ColumnType::Money { .. })));
        Some(crate::diag::Diagnostic::new(&site, "N_PUBLIC_AGGREGATE_COPY", message, rewrite).guide("feeds"))
    }).collect()
}

#[cfg(test)]
#[allow(dead_code)]
pub(crate) fn measured_notes(catalog: &Catalog, schema: &snapback4_core::schema::Schema) -> (Vec<crate::diag::Diagnostic>, (usize, usize, usize)) {
    let budget = Rc::new(Budget::default());
    let notes = notes_with_budget(catalog, schema, budget.clone());
    (notes, budget.stats())
}
