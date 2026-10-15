//! A conservative backward slice over alpha-renamed locals. All definitions of
//! a slot are joined, including loop back edges and early exits: a shared use
//! keeps the entire slot. Only total work ending exclusively in emits is erased.
use snapback4_core::{ir::*, schema::Schema, Value};
use std::collections::{BTreeMap, BTreeSet};

mod walk;
use walk::{expression, statement};

pub(super) fn uses_presence(program: &Program) -> bool {
    let mut found = false;
    for stmt in &program.body {
        statement(stmt, &mut |expr| expression(expr, &mut |expr| {
            found |= matches!(expr, Expr::Builtin { builtin: Builtin::Connected, .. });
        }));
    }
    found
}

#[derive(Default)]
struct Facts {
    names: BTreeSet<String>,
    reads: bool,
    unsafe_work: bool,
}

impl Facts {
    fn expr(&mut self, expr: &Expr, fallible_reads: &BTreeSet<String>) {
        expression(expr, &mut |expr| match expr {
            Expr::Variable(name) => { self.names.insert(name.clone()); }
            Expr::Get(read) | Expr::Exists(read) => {
                self.reads = true;
                self.unsafe_work |= fallible_reads.contains(&read.table);
            }
            _ => {}
        });
        self.unsafe_work |= !total(expr);
    }
}

#[derive(Default)]
struct Slice {
    fallible_reads: BTreeSet<String>,
    definitions: BTreeMap<String, Facts>,
    bindings: Vec<(String, String)>,
    emits: Vec<(String, Facts)>,
    live: BTreeSet<String>,
}

// @ref LLP 3000.013#12.3 — effect-payload point reads are server-only; the
// compiler proves their whole use chain before a device omits any statement.
pub(super) fn plan(schema: &Schema, program: &Program) -> Vec<String> {
    if program.kind != ProgramKind::Mutation { return Vec::new(); }
    // @ref LLP 3000.013#12.3 — retain data-dependent reads. Payload omission
    // is an actual-value meter exception, never a proof about expiry, private
    // derivations, authority walks or a live maintained result.
    let fallible_reads = schema.tables.iter().filter(|(name, table)| {
        let mut probes = Vec::new();
        snapback4_core::engine::rules::probe_sites(&table.rules.read, &mut probes);
        table.is_expiring() || !table.maintained.is_empty() || table.through.is_some()
            || !probes.is_empty()
            || schema.maintain_for(name).is_some_and(|m| m.row_key.is_some()
                || m.parent_key.is_some() || schema.tables[&m.source].is_expiring()
                || schema.tables[&m.source].through.is_some())
    }).map(|(name, _)| name.clone()).collect();
    let mut slice = Slice { fallible_reads, ..Slice::default() };
    slice.body(&program.body, &program.name);
    for (name, facts) in &slice.definitions {
        if facts.unsafe_work { slice.live.insert(name.clone()); }
    }
    let mut effect = BTreeSet::new();
    let mut skips = Vec::new();
    for (path, facts) in &slice.emits {
        let names = closure(facts.names.clone(), &slice.definitions);
        let safe = !facts.unsafe_work && names.iter().all(|name| slice.definitions.get(name).is_none_or(|facts| !facts.unsafe_work));
        let reads = facts.reads || names.iter().any(|name| slice.definitions.get(name).is_some_and(|facts| facts.reads));
        if safe && reads {
            skips.push(path.clone());
            effect.extend(names);
        } else {
            slice.live.extend(names);
        }
    }
    // A retained dead/unused binding still evaluates its initializer. Keep its
    // dependencies too; this is effect slicing, not general dead-code removal.
    slice.live.extend(slice.definitions.keys().filter(|name| !effect.contains(*name)).cloned());
    let live = closure(slice.live, &slice.definitions);
    for (path, name) in slice.bindings {
        if effect.contains(&name) && !live.contains(&name) { skips.push(path); }
    }
    skips.sort();
    skips
}

fn closure(mut names: BTreeSet<String>, definitions: &BTreeMap<String, Facts>) -> BTreeSet<String> {
    let mut pending: Vec<_> = names.iter().cloned().collect();
    while let Some(name) = pending.pop() {
        if let Some(facts) = definitions.get(&name) {
            for dependency in &facts.names {
                if names.insert(dependency.clone()) { pending.push(dependency.clone()); }
            }
        }
    }
    names
}

impl Slice {
    fn sink(&mut self, expr: &Expr) {
        expression(expr, &mut |expr| {
            if let Expr::Variable(name) = expr { self.live.insert(name.clone()); }
        });
    }

    fn body(&mut self, body: &[Stmt], prefix: &str) {
        for (index, stmt) in body.iter().enumerate() {
            let path = format!("{prefix}:{}", index + 1);
            match stmt {
                Stmt::Const { name, value } | Stmt::Let { name, value } | Stmt::Assign { name, value } => {
                    self.definitions.entry(name.clone()).or_default().expr(value, &self.fallible_reads);
                    self.bindings.push((path, name.clone()));
                }
                Stmt::Emit { payload, once, .. } => {
                    let mut facts = Facts::default();
                    facts.expr(payload, &self.fallible_reads);
                    // Payload-only slicing never erases a once-key dependency.
                    if let Some(key) = once { self.sink(key); }
                    self.emits.push((path, facts));
                }
                Stmt::If { condition, then_body, else_body } => {
                    // `??` is a value operation, not an authored condition.
                    // Its private slot and exact lowering establish ownership.
                    if let Some((name, written)) = coalesce(condition, then_body, else_body) {
                        let owner = self.definitions.entry(name.into()).or_default();
                        owner.expr(condition, &self.fallible_reads);
                        owner.names.extend(written.iter().cloned());
                        // Removing the enclosing value branch must also be safe
                        // for every fallback slot. A shared or fallible fallback
                        // keeps the owner and its nullable input, transitively.
                        for slot in written { self.definitions.entry(slot).or_default().names.insert(name.into()); }
                        self.bindings.push((path.clone(), name.into()));
                    } else {
                        self.sink(condition);
                    }
                    self.body(then_body, &format!("{path}:then"));
                    self.body(else_body, &format!("{path}:else"));
                }
                Stmt::For { binding, domain, body } => {
                    // Never eliminate a loop/domain or its binding. Population
                    // admission and the ordinary loop meters remain unchanged.
                    self.live.insert(binding.clone());
                    walk::domain(domain, &mut |expr| self.sink(expr));
                    self.body(body, &path);
                }
                other => statement(other, &mut |expr| self.sink(expr)),
            }
            // Mutating a slot by push, a write result, or opaque block setup
            // makes it shared. This includes reads used by a later iteration.
            match stmt {
                Stmt::Push { target, .. } => { self.live.insert(target.clone()); }
                Stmt::InsertIfAbsent { result, .. } | Stmt::WriteTarget { result: Some(result), .. } => { self.live.insert(result.clone()); }
                _ => {}
            }
        }
    }
}

fn coalesce<'a>(condition: &'a Expr, yes: &[Stmt], no: &[Stmt]) -> Option<(&'a str, BTreeSet<String>)> {
    let Expr::Binary { op: BinaryOp::Eq, left, right } = condition else { return None };
    let Expr::Variable(name) = left.as_ref() else { return None };
    if !name.starts_with("$or") || **right != Expr::Literal(Value::Null) || !no.is_empty() { return None; }
    if !matches!(yes.last(), Some(Stmt::Assign { name: target, .. }) if target == name) { return None; }
    fn value_body(body: &[Stmt], written: &mut BTreeSet<String>) -> bool {
        body.iter().all(|stmt| match stmt {
            Stmt::Let { name, value } | Stmt::Const { name, value } | Stmt::Assign { name, value } => {
                written.insert(name.clone()); total(value)
            }
            Stmt::If { condition, then_body, else_body } => total(condition)
                && value_body(then_body, written) && value_body(else_body, written),
            _ => false,
        })
    }
    let mut written = BTreeSet::new();
    value_body(yes, &mut written).then_some((name, written))
}

fn total(expr: &Expr) -> bool {
    match expr {
        Expr::Literal(_) | Expr::Variable(_) | Expr::Input(Input::Viewer | Input::Now | Input::ReadTime) => true,
        Expr::Get(read) | Expr::Exists(read) => read.key.iter().all(total),
        Expr::Field { base, .. } | Expr::Unary { op: UnaryOp::Not, value: base } => total(base),
        Expr::Array(items) => items.iter().all(total),
        Expr::Object(fields) => fields.values().all(total),
        Expr::Shape { base, fields } => total(base) && fields.values().all(total),
        Expr::Binary { op, left, right } => total(left) && total(right) &&
            (!matches!(op, BinaryOp::Add | BinaryOp::Sub | BinaryOp::Mul) || integer(expr).is_some()),
        Expr::Unary { op: UnaryOp::Neg, .. } => integer(expr).is_some(),
        Expr::Builtin { builtin, args } => args.iter().all(total) && match builtin {
            Builtin::Connected | Builtin::Slice | Builtin::Len | Builtin::Count | Builtin::Min | Builtin::Max |
            Builtin::First | Builtin::Last | Builtin::At | Builtin::Lower | Builtin::Trim | Builtin::Concat |
            Builtin::Sha256 | Builtin::Join => true,
            // Typed ints are bounded to the safe integer range. Dividing by a
            // known nonzero integer cannot overflow that range (including -1).
            Builtin::Divmod { remainder_sink } => remainder_sink == "operator" && args.get(1).and_then(integer).is_some_and(|n| n != 0),
            Builtin::Divide { .. } => false,
            _ => false,
        },
        Expr::Input(Input::NewId) | Expr::Scan(_) | Expr::Merge(_) | Expr::Block { .. } => false,
    }
}

fn integer(expr: &Expr) -> Option<i128> {
    let n = match expr {
        Expr::Literal(Value::Int(n)) => *n as i128,
        Expr::Unary { op: UnaryOp::Neg, value } => -integer(value)?,
        Expr::Binary { op, left, right } => {
            let (a, b) = (integer(left)?, integer(right)?);
            match op { BinaryOp::Add => a + b, BinaryOp::Sub => a - b, BinaryOp::Mul => a * b, _ => return None }
        }
        _ => return None,
    };
    (n.abs() <= 9_007_199_254_740_991).then_some(n)
}

/// Preserve every original path for ownership, diagnostics and guard charging.
/// This copy is only an analysis input; the server keeps the original program.
pub(super) fn prediction_program(program: &Program, skips: &[String]) -> Program {
    fn body(stmts: &mut [Stmt], prefix: &str, skips: &BTreeSet<&str>) {
        for (index, stmt) in stmts.iter_mut().enumerate() {
            let path = format!("{prefix}:{}", index + 1);
            if skips.contains(path.as_str()) {
                *stmt = Stmt::Emit { effect: String::new(), payload: Expr::Literal(Value::Null), once: None };
                continue;
            }
            match stmt {
                Stmt::If { then_body, else_body, .. } => { body(then_body, &format!("{path}:then"), skips); body(else_body, &format!("{path}:else"), skips); }
                Stmt::For { body: inner, .. } => body(inner, &path, skips),
                _ => {}
            }
        }
    }
    let mut local = program.clone();
    body(&mut local.body, &program.name, &skips.iter().map(String::as_str).collect());
    local
}
