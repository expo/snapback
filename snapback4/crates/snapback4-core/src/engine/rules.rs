//! Rule evaluation and the static facts about it that the engine hoists: a
//! rule that is proven true by the scanned prefix (`decided_true`) costs no
//! probes; a rule whose deciding fields are pinned by the prefix (`uniform`) is
//! decided once for the whole range. Copied from Snapback 2's uniformity
//! analysis (LLP 2000.000 §5.1); the certificate that priced these is gone,
//! the analysis is not.

use crate::ir::{Expr, IndexKeyExpr, Input, Merge, Scan};
use crate::schema::{ColumnType, RuleExpr, RuleTerm, Schema, Table};
use crate::value::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Visibility {
    /// One verdict serves every row of the scanned prefix.
    pub uniform: bool,
    /// That verdict is `true` before any row is read.
    pub decided_true: bool,
}

pub fn scan_visibility(schema: &Schema, scan: &Scan) -> Visibility {
    let Some(table) = schema.table(&scan.table) else { return Visibility::default() };
    let Some(index) = table.index(&scan.index) else { return Visibility::default() };
    let pinned = |name: &str| index.components.iter().zip(&scan.prefix).find_map(|(part, key)| (part.column().is_some_and(|column| column == name)).then(|| key.scalar()).flatten());
    visibility(&scan.table, table, &table.rules.read, &pinned)

}

// @ref LLP 3000.007#20.5 — a missing upsert may insert only when the complete held group and its key decide that no hidden target can exist.
pub fn upsert_absence(schema: &Schema, name: &str, index: &str, key: &[Expr]) -> Result<Visibility, &'static str> {
    let table = schema.table(name).ok_or("the target is online only")?;
    let sync = table.sync.as_ref().ok_or("the target is online only")?;
    if sync.horizon.is_some() { return Err("the target has a horizon"); }
    let rule = table.rules.read.device_audience_rule();
    // Public subset sync has no whole-table absence proof. Its group coverage
    // is a separate decision; do not infer it merely from the public read rule.
    if rule.is_uniformly_readable() && sync.audience != crate::schema::Audience::Public { return Err("the key's synced group is not established"); }
    let index = table.index(index).ok_or("the key does not pin readability")?;
    let pinned = crate::small_map::collect(index.components.iter().zip(key).filter_map(|(part, expression)| part.column().map(|column| (column, expression))));
    let visibility = prefix_visibility(name, table, &rule, &pinned);
    if !visibility.uniform { return Err("the key does not pin readability"); }
    Ok(visibility)
}

// @ref LLP 3000.007#18.1 — simplify self-witnesses, then pre-check only the leading conjuncts whose fields the scope pins, in evaluation order.
pub(super) fn prefix_decision(schema: &Schema, scan: &Scan) -> Option<RuleExpr> {
    let table = schema.table(&scan.table)?;
    let index = table.index(&scan.index)?;
    let pinned: BTreeMap<_,_> = crate::small_map::collect(index.components.iter().zip(&scan.prefix).filter_map(|(part, key)| part.column().zip(key.scalar())));
    if table.through.as_ref().is_some_and(|t| pinned.contains_key(&t.reference)) { return Some(table.rules.read.clone()); }
    let rule = simplify_prefix(&table.rules.read, &scan.table, table, &pinned);
    if matches!(rule, RuleExpr::Allow) { return None; }
    let mut terms = Vec::new();
    conjuncts(rule, &mut terms);
    let decided: Vec<_> = terms.into_iter().take_while(|term| {
        let mut fields = BTreeSet::new();
        term.fields(&mut fields);
        fields.iter().all(|field| pinned.contains_key(field))
    }).collect();
    (!decided.is_empty()).then_some(RuleExpr::And(decided))
}

// Flatten only conjunctions, preserving left-to-right short-circuit order.
fn conjuncts(rule: RuleExpr, out: &mut Vec<RuleExpr>) {
    match rule { RuleExpr::And(terms) => for term in terms { conjuncts(term, out); }, rule => out.push(rule) }
}

fn simplify_prefix(rule: &RuleExpr, name: &str, table: &Table, pinned: &BTreeMap<&String, &Expr>) -> RuleExpr {
    if rule_true(rule, name, table, &|name| pinned.iter().find_map(|(key, value)| (key.as_str() == name).then_some(*value))) { return RuleExpr::Allow; }
    match rule {
        RuleExpr::And(terms) => {
            let mut out = Vec::new();
            for term in terms { conjuncts(simplify_prefix(term, name, table, pinned), &mut out); }
            out.retain(|term| !matches!(term, RuleExpr::Allow));
            RuleExpr::And(out)
        },
        RuleExpr::Or(_) => {
            // Use the same self-witness absorption as uniformity, but remove
            // the absorbed field read from the expression we actually run.
            let terms = rule.disjuncts();
            RuleExpr::Or(terms.iter().filter(|term| !terms.iter().any(|other| self_probe_absorbs(name, table, term, other))).map(|term| simplify_prefix(term, name, table, pinned)).collect())
        }
        RuleExpr::Not(inner) => RuleExpr::Not(Box::new(simplify_prefix(inner, name, table, pinned))),
        _ => rule.clone(),
    }
}

/// A read rule `A or G` whose disjunct `G` reads no column of the row (a
/// role such as `exists staff[viewer]`, or a service seat) is true for every
/// row whenever `G` holds for this caller. The page is then decided once, per
/// caller: a staff console's list is complete for staff, and is the same
/// per-row walk as before for everyone else.
///
/// Only grants whose every fact the caller could read are used, so `complete`
/// discloses nothing beyond the caller's own readable rows: each probe's
/// target row must be readable by its own read rule once the probe key pins
/// it (`.principal = viewer`, `public`, or the same probe), and a negated
/// probe is never a grant.
// @ref LLP 3000.036#12 — the role-guard completeness proof deferred in §11, server-side and per caller.
pub fn grant_decision(schema: &Schema, scan: &Scan) -> Option<RuleExpr> {
    let table = schema.table(&scan.table)?;
    if table.through.is_some() { return None; }
    let rule = &table.rules.read;
    if !matches!(rule, RuleExpr::Or(_)) { return None; }
    let grants: Vec<RuleExpr> = rule.disjuncts().into_iter()
        .filter(|disjunct| { let mut fields = BTreeSet::new(); disjunct.fields(&mut fields); fields.is_empty() })
        .filter(|disjunct| self_disclosing(schema, disjunct))
        .cloned().collect();
    (!grants.is_empty()).then(|| if grants.len() == 1 { grants.into_iter().next().unwrap() } else { RuleExpr::Or(grants) })
}

/// Every caller who reaches `scan` holds the scan's readable grant, in a
/// program that never writes the grant's table (so the fact cannot change
/// between the guard and the walk): the page is fully readable for each of
/// them, which is exactly when the server's walk (`read.rs`) answers
/// `complete`. The guards followed are the ones authors write:
///
/// - `require G else …` before the statement holding the scan;
/// - `if G:` around it (and the `else` of `if not G:`);
/// - an early exit, `if not G: return …` (or `if viewer != 'service:x':
///   return []`), before it.
///
/// `G` may be an `exists` probe (with the grant's named equalities, as
/// `exists staff[principal = viewer, role = 'manager']` lowers them) or a
/// `viewer = '…'` comparison, and may be one conjunct of a larger condition.
/// Scans compare structurally, so every copy of the scan must be guarded.
// @ref LLP 3000.036#12 — require dominance: staff consoles and staff-only mutation passes.
// @ref LLP 3000.036#13.1 — `if` guards and early exits dominate too, so `check` agrees with the runtime verdict.
pub fn grant_dominated(schema: &Schema, program: &crate::ir::Program, scan: &Scan) -> bool {
    let Some(grant) = grant_decision(schema, scan) else { return false };
    let written: BTreeSet<String> = crate::ir::write_tables(program).into_iter().map(|(table, _)| table).collect();
    let mut probes = grant_probe_bindings(&program.body);
    probes.retain(|_, read| !written.contains(&read.table));
    let conditions = short_circuit_bindings(&program.body);
    let guard = Guard { grant: &grant, written: &written, probes: &probes, conditions: &conditions };
    let mut walk = Dominance { scan, found: 0, guarded: 0 };
    walk.body(&guard, &program.body, false);
    walk.found > 0 && walk.found == walk.guarded
}

/// `name = t[key]` bindings the compiler makes for a probe with named
/// equalities (`$probe1 = people[viewer]`; `$probe1 != null and
/// $probe1.role = 'manager'`). A name bound twice or reassigned is dropped.
fn grant_probe_bindings(body: &[crate::ir::Stmt]) -> BTreeMap<String, crate::ir::Read> {
    use crate::ir::Stmt;
    fn collect(body: &[Stmt], out: &mut BTreeMap<String, Option<crate::ir::Read>>) {
        for statement in body {
            match statement {
                Stmt::Let { name, value } | Stmt::Const { name, value } => {
                    let read = if let Expr::Get(read) = value { Some(read.clone()) } else { None };
                    if out.insert(name.clone(), read).is_some() { out.insert(name.clone(), None); }
                }
                Stmt::Assign { name, .. } => { out.insert(name.clone(), None); }
                Stmt::If { then_body, else_body, .. } => { collect(then_body, out); collect(else_body, out); }
                Stmt::For { binding, body, .. } => { out.insert(binding.clone(), None); collect(body, out); }
                _ => {}
            }
        }
    }
    let mut out = BTreeMap::new();
    collect(body, &mut out);
    out.into_iter().filter_map(|(name, read)| read.map(|read| (name, read))).collect()
}

/// The compiler lowers a short-circuit `a and b` (`a or b`) to a temporary:
/// `$bool1 = a`, then `if $bool1: $bool1 = b` (`if not $bool1: …`, or
/// `if $bool1:` with the assignment in its `else`). Each such
/// temporary, assigned only there, stands for the whole condition.
fn short_circuit_bindings(body: &[crate::ir::Stmt]) -> BTreeMap<String, Expr> {
    use crate::ir::{BinaryOp, Stmt, UnaryOp};
    fn assignments(body: &[Stmt], out: &mut BTreeMap<String, usize>) {
        for statement in body {
            match statement {
                Stmt::Let { name, .. } | Stmt::Const { name, .. } | Stmt::Assign { name, .. } => *out.entry(name.clone()).or_default() += 1,
                Stmt::If { then_body, else_body, .. } => { assignments(then_body, out); assignments(else_body, out); }
                Stmt::For { binding, body, .. } => { *out.entry(binding.clone()).or_default() += 1; assignments(body, out); }
                _ => {}
            }
        }
    }
    fn collect(body: &[Stmt], counts: &BTreeMap<String, usize>, out: &mut BTreeMap<String, Expr>) {
        for pair in body.windows(2) {
            let [Stmt::Let { name, value: first }, Stmt::If { condition, then_body, else_body }] = pair else { continue };
            if !name.starts_with('$') || counts.get(name) != Some(&2) { continue; }
            // `if $b: $b = second` (and), `if not $b: $b = second` or
            // `if $b: (nothing) else: $b = second` (or).
            let tested = |negated: bool| match condition {
                Expr::Variable(tested) => !negated && tested == name,
                Expr::Unary { op: UnaryOp::Not, value } => negated && matches!(value.as_ref(), Expr::Variable(tested) if tested == name),
                _ => false,
            };
            let (op, body) = if else_body.is_empty() && tested(false) { (BinaryOp::And, then_body) }
                else if else_body.is_empty() && tested(true) { (BinaryOp::Or, then_body) }
                else if then_body.is_empty() && tested(false) { (BinaryOp::Or, else_body) }
                else { continue };
            // The second operand's own setup (a probe's `$probe2 = t[key]`) precedes the assignment.
            let Some((Stmt::Assign { name: assigned, value: second }, setup)) = body.split_last() else { continue };
            if !setup.iter().all(|statement| matches!(statement, Stmt::Let { .. } | Stmt::Const { .. })) { continue; }
            if assigned != name { continue; }
            out.insert(name.clone(), Expr::Binary { op, left: Box::new(first.clone()), right: Box::new(second.clone()) });
        }
        for statement in body {
            match statement {
                Stmt::If { then_body, else_body, .. } => { collect(then_body, counts, out); collect(else_body, counts, out); }
                Stmt::For { body, .. } => collect(body, counts, out),
                _ => {}
            }
        }
    }
    let mut counts = BTreeMap::new();
    assignments(body, &mut counts);
    let mut out = BTreeMap::new();
    collect(body, &counts, &mut out);
    out
}

struct Guard<'a> {
    grant: &'a RuleExpr,
    written: &'a BTreeSet<String>,
    probes: &'a BTreeMap<String, crate::ir::Read>,
    conditions: &'a BTreeMap<String, Expr>,
}

/// One fact a condition establishes: `left op right` with `op` `=`/`!=`, or
/// an `exists` probe that holds.
#[derive(Clone, Copy)]
enum Fact<'a> { Exists(&'a crate::ir::Read), Compare(bool, &'a Expr, &'a Expr) }

impl Guard<'_> {
    /// The alternatives `condition` being true establishes, each a set of
    /// facts that hold together (disjunctive normal form): `a or b` is two
    /// alternatives, `a and b` one with the facts of both. A part we cannot
    /// name contributes no fact, so an alternative built on it proves nothing.
    // @ref LLP 3000.036#14.1 — a guard `if exists A or exists B:` holds a grant on each alternative.
    fn when_true<'e>(&'e self, condition: &'e Expr) -> Vec<Vec<Fact<'e>>> {
        use crate::ir::{BinaryOp, UnaryOp};
        match condition {
            Expr::Variable(name) if self.conditions.contains_key(name) => self.when_true(&self.conditions[name]),
            Expr::Binary { op: BinaryOp::And, left, right } => product(self.when_true(left), self.when_true(right)),
            Expr::Binary { op: BinaryOp::Or, left, right } => union(self.when_true(left), self.when_true(right)),
            Expr::Binary { op: BinaryOp::Eq, left, right } => vec![vec![Fact::Compare(true, left, right)]],
            Expr::Binary { op: BinaryOp::Ne, left, right } => vec![vec![Fact::Compare(false, left, right)]],
            Expr::Unary { op: UnaryOp::Not, value } => self.when_false(value),
            Expr::Exists(read) => vec![vec![Fact::Exists(read)]],
            _ => vec![Vec::new()],
        }
    }

    /// The alternatives `condition` being false establishes.
    fn when_false<'e>(&'e self, condition: &'e Expr) -> Vec<Vec<Fact<'e>>> {
        use crate::ir::{BinaryOp, UnaryOp};
        match condition {
            Expr::Variable(name) if self.conditions.contains_key(name) => self.when_false(&self.conditions[name]),
            Expr::Binary { op: BinaryOp::Or, left, right } => product(self.when_false(left), self.when_false(right)),
            Expr::Binary { op: BinaryOp::And, left, right } => union(self.when_false(left), self.when_false(right)),
            Expr::Binary { op: BinaryOp::Eq, left, right } => vec![vec![Fact::Compare(false, left, right)]],
            Expr::Binary { op: BinaryOp::Ne, left, right } => vec![vec![Fact::Compare(true, left, right)]],
            Expr::Unary { op: UnaryOp::Not, value } => self.when_true(value),
            _ => vec![Vec::new()],
        }
    }

    /// The facts imply one of the grant's disjuncts.
    fn implies(&self, facts: &[Fact]) -> bool {
        self.grant.disjuncts().iter().any(|disjunct| self.implies_rule(disjunct, facts))
    }

    fn implies_rule(&self, rule: &RuleExpr, facts: &[Fact]) -> bool {
        let same = |expression: &Expr, term: &RuleTerm| pinned_term(term, expression);
        match rule {
            RuleExpr::And(items) => !items.is_empty() && items.iter().all(|item| self.implies_rule(item, facts)),
            RuleExpr::Eq(a, b) => facts.iter().any(|fact| matches!(fact, Fact::Compare(true, left, right)
                if (same(left, a) && same(right, b)) || (same(left, b) && same(right, a)))),
            RuleExpr::Exists { table, index, key, equalities, .. } => {
                if self.written.contains(table) { return false; }
                let keyed = |read: &crate::ir::Read| &read.table == table && &read.index == index && read.key.len() == key.len()
                    && read.key.iter().zip(key).all(|(expression, term)| pinned_term(term, expression));
                if equalities.is_empty() && facts.iter().any(|fact| matches!(fact, Fact::Exists(read) if keyed(read))) { return true; }
                // `$probe != null` for a bound point read of the same key, and
                // `$probe.col = term` for every named equality.
                self.probes.iter().filter(|(_, read)| keyed(read)).any(|(name, _)| {
                    let variable = |expression: &Expr| matches!(expression, Expr::Variable(bound) if bound == name);
                    let present = facts.iter().any(|fact| matches!(fact, Fact::Compare(false, left, right)
                        if (variable(left) && matches!(right, Expr::Literal(Value::Null))) || (variable(right) && matches!(left, Expr::Literal(Value::Null)))));
                    let field = |expression: &Expr, column: &str| matches!(expression, Expr::Field { base, name } if name == column && variable(base));
                    present && equalities.iter().all(|(column, term)| facts.iter().any(|fact| matches!(fact, Fact::Compare(true, left, right)
                        if (field(left, column) && same(right, term)) || (field(right, column) && same(left, term)))))
                })
            }
            _ => false,
        }
    }

    /// Every alternative under which `condition` is true implies a grant.
    fn holds_when_true(&self, condition: &Expr) -> bool {
        self.when_true(condition).iter().all(|facts| self.implies(facts))
    }

    fn holds_when_false(&self, condition: &Expr) -> bool {
        self.when_false(condition).iter().all(|facts| self.implies(facts))
    }
}

/// More alternatives than this and a guard proves nothing (the sound default).
const MAX_ALTERNATIVES: usize = 32;

fn union<'e>(mut a: Vec<Vec<Fact<'e>>>, b: Vec<Vec<Fact<'e>>>) -> Vec<Vec<Fact<'e>>> {
    a.extend(b);
    if a.len() > MAX_ALTERNATIVES { return vec![Vec::new()]; }
    a
}

fn product<'e>(a: Vec<Vec<Fact<'e>>>, b: Vec<Vec<Fact<'e>>>) -> Vec<Vec<Fact<'e>>> {
    if a.len() * b.len() > MAX_ALTERNATIVES { return vec![Vec::new()]; }
    a.iter().flat_map(|left| b.iter().map(move |right| left.iter().chain(right).cloned().collect())).collect()
}

struct Dominance<'s> { scan: &'s Scan, found: usize, guarded: usize }

impl Dominance<'_> {
    fn count(&mut self, scans: Vec<&Scan>, guarded: bool) {
        let n = scans.into_iter().filter(|candidate| *candidate == self.scan).count();
        self.found += n;
        if guarded { self.guarded += n; }
    }

    /// Walks `body` under `guarded`; true when the body always leaves its
    /// enclosing block (a `return`, `break` or `continue` on every path).
    fn body(&mut self, guard: &Guard, body: &[crate::ir::Stmt], mut guarded: bool) -> bool {
        use crate::ir::Stmt;
        for statement in body {
            match statement {
                Stmt::If { condition, then_body, else_body } => {
                    self.count(crate::ir::expression_scans(condition), guarded);
                    let then_guarded = guarded || guard.holds_when_true(condition);
                    let else_guarded = guarded || guard.holds_when_false(condition);
                    let then_exits = self.body(guard, then_body, then_guarded);
                    let else_exits = self.body(guard, else_body, else_guarded);
                    match (then_exits, else_exits) {
                        (true, true) => return true,
                        (true, false) => guarded = else_guarded,
                        (false, true) => guarded = then_guarded,
                        (false, false) => {}
                    }
                }
                Stmt::For { body: inner, .. } => {
                    let all = crate::ir::body_read_structure(std::slice::from_ref(statement)).0;
                    let nested = crate::ir::body_read_structure(inner).0.len();
                    // The domain's scans come first in the walk order; the body is walked with its own exits.
                    self.count(all[..all.len() - nested].to_vec(), guarded);
                    self.body(guard, inner, guarded);
                }
                Stmt::Require { condition, .. } => {
                    self.count(crate::ir::expression_scans(condition), guarded);
                    guarded = guarded || guard.holds_when_true(condition);
                }
                Stmt::Return(_) | Stmt::Break | Stmt::Continue => {
                    self.count(crate::ir::body_read_structure(std::slice::from_ref(statement)).0, guarded);
                    return true;
                }
                _ => self.count(crate::ir::body_read_structure(std::slice::from_ref(statement)).0, guarded),
            }
        }
        false
    }
}

/// Every fact the grant reads is one the caller may read itself.
fn self_disclosing(schema: &Schema, grant: &RuleExpr) -> bool {
    disclosing(schema, grant, false)
}

/// A disjunct whose row columns a page pins (`exists cats[.cat, owner =
/// viewer]` under `.cat = cat`): whenever it holds, the caller can read every
/// row it probes, so a program's own `exists cats[cat, owner = viewer]` (which
/// sees only readable rows) answers exactly as the rule does. Pinned columns
/// are arbitrary values here: they pin nothing on the probed row's rule.
// @ref LLP 3000.036#16.1 — a printed branch on a parent probe must not narrow the probe's holders.
pub fn pinned_probe_readable(schema: &Schema, disjunct: &RuleExpr) -> bool {
    disclosing(schema, disjunct, true)
}

fn disclosing(schema: &Schema, grant: &RuleExpr, fields: bool) -> bool {
    match grant {
        RuleExpr::Allow | RuleExpr::Public { .. } => true,
        RuleExpr::Eq(a, b) | RuleExpr::Ne(a, b) => [a, b].iter().all(|term| matches!(term, RuleTerm::Viewer | RuleTerm::Literal(_)) || fields && matches!(term, RuleTerm::Field(_))),
        RuleExpr::And(items) => items.iter().all(|item| disclosing(schema, item, fields)),
        RuleExpr::Exists { table: target, index, key, equalities, .. } => {
            let Some(target_table) = schema.table(target) else { return false };
            let Some(target_index) = target_table.index(index) else { return false };
            if target_table.through.is_some() || target_table.is_expiring() { return false; }
            let value = |term: &RuleTerm| match term {
                RuleTerm::Viewer => Some(Expr::Input(Input::Viewer)),
                RuleTerm::Literal(value) => Some(Expr::Literal(value.clone())),
                _ => None,
            };
            let mut pins: BTreeMap<String, Expr> = BTreeMap::new();
            for (component, term) in target_index.components.iter().zip(key) {
                if fields && matches!(term, RuleTerm::Field(_)) && component.column().is_some() { continue; }
                let (Some(column), Some(expr)) = (component.column(), value(term)) else { return false };
                pins.insert(column.clone(), expr);
            }
            for (column, term) in equalities {
                if fields && matches!(term, RuleTerm::Field(_)) { continue; }
                let Some(expr) = value(term) else { return false };
                pins.insert(column.clone(), expr);
            }
            let pinned = |name: &str| pins.get(name);
            // The witness row's own read rule, decided by what the probe pins,
            // or carrying this very probe as a disjunct (`read <- exists staff[viewer]`).
            rule_true(&target_table.rules.read, target, target_table, &pinned)
                || target_table.rules.read.disjuncts().iter().any(|disjunct| implied_by(disjunct, grant))
        }
        _ => false,
    }
}

/// `weaker` holds whenever `stronger` does: the same probe with fewer extra equalities.
fn implied_by(weaker: &RuleExpr, stronger: &RuleExpr) -> bool {
    match (weaker, stronger) {
        (RuleExpr::Exists { table: a, index: ai, key: ak, equalities: ae, .. }, RuleExpr::Exists { table: b, index: bi, key: bk, equalities: be, .. }) =>
            a == b && ai == bi && ak == bk && ae.iter().all(|pair| be.contains(pair)),
        _ => weaker == stronger,
    }
}

/// Lazy lanes need a position that identifies one row within the lane.
/// Keep setup evaluation and non-uniform traversal in their original order.
pub fn lazy_merge(schema: &Schema, merge: &Merge) -> bool {
    let Some(first) = merge.lanes.first() else { return true };
    if merge.branches() { return branch_merge_lazy(schema, merge); }
    merge.lanes.iter().all(|lane| {
        let scan = &lane.scan;
        lane.project.is_none() && lane.setup.is_empty() && scan.table == first.scan.table && scan.index == first.scan.index
            && scan.prefix.iter().enumerate().all(|(position, key)| matches!(key, IndexKeyExpr::Scalar(_)) || position + 1 == scan.prefix.len())
            && scan.order == first.scan.order && scan.prefix.len() == first.scan.prefix.len()
            && scan_visibility(schema, scan).uniform
            && schema.table(&scan.table).is_some_and(|table| table.index(&scan.index).is_some_and(|index| {
                // Nullable unique keys allow multiple nulls; they are not a
                // position from which a one-row refill can safely resume.
                let total_unique = index.unique && index.components.iter().all(|component| component.key_type(table).is_some_and(|kind| !kind.is_optional()));
                scan.prefix.len() < index.components.len() && (total_unique || index.columns().last().is_some_and(|c| c == "id"))
            }))
    })
}

/// A branch merge's lanes may read different indexes of one table: each
/// resumes on its own index from the shared merge position, so every lane
/// needs scalar pins, a total position and the same position columns. A
/// party or `where` lane must be decided by its prefix; a grant lane is
/// decided per caller before it opens (`word_merge.rs`).
// @ref LLP 3000.036.001#3 — the binding check makes these hold; a lane that fails one keeps the eager traversal.
pub fn branch_merge_lazy(schema: &Schema, merge: &Merge) -> bool {
    let Some(first) = merge.lanes.first() else { return true };
    let Some(table) = schema.table(&first.scan.table) else { return false };
    let mut suffix: Option<Vec<(String, ColumnType)>> = None;
    merge.lanes.iter().all(|lane| {
        let scan = &lane.scan;
        let Some(index) = table.index(&scan.index) else { return false };
        let total_unique = index.unique && index.components.iter().all(|component| component.key_type(table).is_some_and(|kind| !kind.is_optional()));
        let lane_suffix = merge_position(table, index, scan.prefix.len());
        let same = suffix.get_or_insert_with(|| lane_suffix.clone()) == &lane_suffix;
        lane.project.is_none() && lane.setup.is_empty() && lane.source.is_none() && scan.table == first.scan.table
            && scan.prefix.iter().all(|key| matches!(key, IndexKeyExpr::Scalar(_)))
            && scan.order == first.scan.order && !scan.existence && same
            && scan.prefix.len() < index.components.len() && index.word_component().is_none()
            && index.components.iter().all(|component| component.column().is_some())
            && (total_unique || index.columns().last().is_some_and(|c| c == "id"))
            && (lane.grant() || scan_visibility(schema, scan).uniform)
    })
}

/// A lane's merge position columns: the index components after its prefix,
/// then `id` when they do not end in it (LLP 3000.007.000 §1).
pub fn merge_position(table: &Table, index: &crate::schema::Index, prefix_len: usize) -> Vec<(String, ColumnType)> {
    let mut columns: Vec<(String, ColumnType)> = index.components.iter().skip(prefix_len)
        .filter_map(|component| Some((component.key_name()?.clone(), component.key_type(table)?))).collect();
    if columns.last().is_none_or(|(name, _)| name != "id") { columns.push(("id".into(), table.columns["id"].clone())); }
    columns
}

/// The grant a branch merge's grant lane is decided by: the readable grants
/// of `grant_decision`, only when they are every disjunct of the read rule
/// that reads no column of the row. Otherwise a caller could be admitted by
/// a grant the lane cannot evaluate, and its page would miss rows.
// @ref LLP 3000.036.001#2 — every grant disjunct must be readable, or the read binds as its grant lane alone.
pub fn covering_grant(schema: &Schema, scan: &Scan) -> Option<RuleExpr> {
    let table = schema.table(&scan.table)?;
    let grant = grant_decision(schema, scan)?;
    let independent = table.rules.read.disjuncts().into_iter()
        .filter(|disjunct| { let mut fields = BTreeSet::new(); disjunct.fields(&mut fields); fields.is_empty() }).count();
    let held = match &grant { RuleExpr::Or(grants) => grants.len(), _ => 1 };
    (held == independent).then_some(grant)
}

/// The same analysis for an arbitrary pinned prefix (`sync` audiences and
/// merge lanes use it too).
pub fn prefix_visibility(table_name: &str, table: &Table, rule: &RuleExpr, pinned: &BTreeMap<&String, &Expr>) -> Visibility {
    visibility(table_name, table, rule, &|name| pinned.iter().find_map(|(key, value)| (key.as_str() == name).then_some(*value)))
}

// @ref LLP 3000.007#20.24 — visibility borrows compiled rule/scan images; word lanes allocate no analysis maps or field sets.
fn visibility<'a>(name: &str, table: &Table, rule: &RuleExpr, pinned: &impl Fn(&str) -> Option<&'a Expr>) -> Visibility {
    if table.through.as_ref().is_some_and(|t| pinned(&t.reference).is_some()) { return Visibility {uniform:true,decided_true:false}; }
    let decided_true = rule_true(rule, name, table, pinned);
    Visibility { uniform: decided_true || fields_pinned(name, table, rule, pinned), decided_true }
}
fn any_disjunct(rule: &RuleExpr, test: &impl Fn(&RuleExpr) -> bool) -> bool {
    match rule { RuleExpr::Or(terms) => terms.iter().any(|term| any_disjunct(term, test)), other => test(other) }
}
fn all_disjunct(rule: &RuleExpr, test: &impl Fn(&RuleExpr) -> bool) -> bool {
    match rule { RuleExpr::Or(terms) => terms.iter().all(|term| all_disjunct(term, test)), other => test(other) }
}
fn fields_pinned<'a>(name: &str, table: &Table, rule: &RuleExpr, pinned: &impl Fn(&str) -> Option<&'a Expr>) -> bool {
    let term = |term: &RuleTerm| !matches!(term, RuleTerm::Field(field) | RuleTerm::Reference { column: field, .. } | RuleTerm::ReferenceChain { column: field, .. } if pinned(field).is_none());
    match rule {
        RuleExpr::Or(_) => all_disjunct(rule, &|part| any_disjunct(rule, &|other| self_probe_absorbs(name, table, part, other)) || fields_pinned(name, table, part, pinned)),
        RuleExpr::And(terms) => terms.iter().all(|part| fields_pinned(name, table, part, pinned)),
        RuleExpr::Not(inner) => fields_pinned(name, table, inner, pinned),
        RuleExpr::Eq(a, b) | RuleExpr::Ne(a, b) | RuleExpr::Compare(_,a,b) => term(a) && term(b),
        RuleExpr::Exists { key, equalities, .. } | RuleExpr::Created { key, equalities, .. } => key.iter().chain(equalities.iter().map(|(_, term)| term)).all(term),
        RuleExpr::Allow | RuleExpr::Deny | RuleExpr::Public { .. } => true,
    }
}

/// Fields that decide a rule after absorbing same-row equalities into
/// self-probes in each `or`. Shared by runtime hoisting and compiler notes.
pub fn deciding_fields(table_name: &str, table: &Table, rule: &RuleExpr) -> BTreeSet<String> {
    if let Some(t) = &table.through { return BTreeSet::from([t.reference.clone()]); }
    let mut used = BTreeSet::new();
    match rule {
        RuleExpr::Or(_) => {
            let disjuncts = rule.disjuncts();
            for disjunct in &disjuncts {
                if !disjuncts.iter().any(|other| self_probe_absorbs(table_name, table, disjunct, other)) {
                    used.extend(deciding_fields(table_name, table, disjunct));
                }
            }
        }
        RuleExpr::And(terms) => terms.iter().for_each(|term| used.extend(deciding_fields(table_name, table, term))),
        RuleExpr::Not(inner) => used.extend(deciding_fields(table_name, table, inner)),
        _ => rule.fields(&mut used),
    }
    used
}

pub(crate) fn self_probe_absorbs(table_name: &str, table: &Table, disjunct: &RuleExpr, other: &RuleExpr) -> bool {
    let column = match disjunct {
        RuleExpr::Eq(RuleTerm::Field(column), RuleTerm::Viewer) | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(column)) => column,
        _ => return false,
    };
    let RuleExpr::Exists { table: target, index, key, equalities, .. } = other else { return false };
    if target != table_name { return false; }
    let Some(index) = table.index(index) else { return false };
    // @ref LLP 3000.007#16 — the equal row is its own witness on a total unique key; literal key terms cannot absorb it.
    index.unique && index.is_plain() && key.len() == index.components.len()
        && equalities.iter().all(|(field, term)| matches!(term, RuleTerm::Field(source) if source == field) || (field == column && matches!(term, RuleTerm::Viewer)))
        && index.components.iter().any(|part| part.column() == Some(column))
        && index.components.iter().filter_map(|part| part.column()).zip(key).all(|(component, term)| {
            table.columns.get(component).is_some_and(|kind| !kind.is_optional())
                && if component == column { matches!(term, RuleTerm::Viewer) } else { matches!(term, RuleTerm::Field(field) if field == component) }
        })
}

fn pinned_term(term: &RuleTerm, expression: &Expr) -> bool {
    match (term, expression) {
        (RuleTerm::Viewer, Expr::Input(Input::Viewer)) => true,
        (RuleTerm::Literal(left), Expr::Literal(right)) => left == right,
        _ => false,
    }
}

fn rule_true<'a>(rule: &RuleExpr, table_name: &str, table: &Table, pinned: &impl Fn(&str) -> Option<&'a Expr>) -> bool {
    match rule {
        RuleExpr::Allow | RuleExpr::Public { .. } => true,
        RuleExpr::Eq(left, right) => [(left, right), (right, left)].iter().any(|(field, value)| {
            let RuleTerm::Field(column) = field else { return false };
            pinned(column).is_some_and(|expression| pinned_term(value, expression))
        }),
        RuleExpr::Or(rules) => rules.iter().any(|rule| rule_true(rule, table_name, table, pinned)),
        RuleExpr::And(rules) => !rules.is_empty() && rules.iter().all(|rule| rule_true(rule, table_name, table, pinned)),
        RuleExpr::Exists { table: target, index, key, equalities, .. } if target == table_name => {
            // A self-probe on a total unique key whose every component is
            // either the row's own column or pinned to the probing value is
            // true for every row the prefix selects.
            let Some(index) = table.index(index) else { return false };
            // Extra tests must be true on the self-witness too; a unique key alone cannot decide them.
            equalities.iter().all(|(column, term)| match term {
                RuleTerm::Field(field) => field == column,
                _ => pinned(column).is_some_and(|expression| pinned_term(term, expression)),
            }) && index.unique
                && index.is_plain()
                && !key.is_empty()
                && key.len() == index.components.len()
                && index.components.iter().filter_map(|part| part.column()).zip(key).all(|(column, term)| {
                    table.columns.get(column).is_some_and(|ty| !matches!(ty, ColumnType::Optional(_)))
                        && match term {
                            RuleTerm::Field(field) => field == column,
                            _ => pinned(column).is_some_and(|expression| pinned_term(term, expression)),
                        }
                })
        }
        _ => false,
    }
}

/// The prefix expressions of a scan as `IndexKeyExpr`s, for callers that
/// pin values rather than expressions.
pub fn pinned_literals(prefix: &[Value]) -> Vec<IndexKeyExpr> {
    prefix.iter().map(|value| IndexKeyExpr::Scalar(Expr::Literal(value.clone()))).collect()
}

/// Something that can answer an `exists`/`created` probe while a rule runs.
pub trait Probe {
    fn reference(&mut self, _table: &str, _id: &Value, _field: &str) -> Result<Option<Value>, crate::error::RuntimeError> { Ok(None) }
    /// Exact count-predicate transitions, distinct from ordinary witness expiry.
    fn take_changes(&mut self) -> Option<Vec<(i64, super::rules::Verdict)>> { None }
    /// Exchange the private expiry accumulator; ordinary probes have none.
    fn replace_expiry(&mut self, _expiry: Option<i64>) -> Option<i64> { None }
    /// Coverage of the most recent leaf, consumed once by the shared evaluator.
    fn take_unknown(&mut self) -> bool { false }
    /// Called only when evaluation loads a field, after short-circuit decisions.
    fn field(&mut self, _field: &str, _old: bool) {}
    /// Apply the schema's point-key null rule before storage access. Timeline
    /// evaluation can visit operands that logical short-circuiting would skip.
    fn exists(&mut self, table: &str, index: &str, key: &[Value], equalities: &[(String, Value)]) -> Result<bool, crate::error::RuntimeError>;
    fn created(&mut self, table: &str, index: &str, key: &[Value]) -> bool;
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum Verdict { Readable, Denied, #[default] Unknown }

impl Verdict {
    fn not(self) -> Self {
        match self { Self::Readable => Self::Denied, Self::Denied => Self::Readable, Self::Unknown => Self::Unknown }
    }
    fn combine(self, other: Self, conjunction: bool) -> Self {
        let decisive = if conjunction { Self::Denied } else { Self::Readable };
        if self == decisive || other == decisive { decisive }
        else if self == Self::Unknown || other == Self::Unknown { Self::Unknown }
        else { decisive.not() }
    }
}

/// Evaluate a rule over a row image (and its old image, for update rules).
pub fn evaluate(rule: &RuleExpr, viewer: &str, old: Option<&Value>, next: &Value, created_allowed: bool, probe: &mut dyn Probe) -> Result<bool, crate::error::RuntimeError> {
    evaluate_verdict(rule, viewer, old, next, created_allowed, probe).map(|verdict| verdict == Verdict::Readable)
}

pub(super) fn evaluate_verdict(rule: &RuleExpr, viewer: &str, old: Option<&Value>, next: &Value, created_allowed: bool, probe: &mut dyn Probe) -> Result<Verdict, crate::error::RuntimeError> {
    let prior = probe.replace_expiry(None);
    let result = timeline(rule, viewer, old, next, created_allowed, probe);
    probe.replace_expiry(match &result {
        Ok(answer) if answer.value == Verdict::Readable => earliest(prior, answer.changes.first().map(|(time, _)| *time)),
        _ => prior,
    });
    result.map(|answer| answer.value)
}

pub(super) fn earliest(a: Option<i64>, b: Option<i64>) -> Option<i64> {
    match (a, b) { (Some(a), Some(b)) => Some(a.min(b)), (a, b) => a.or(b) }
}

struct Timeline {
    value: Verdict,
    changes: Vec<(i64, Verdict)>,
    // Proven from rule structure and verdicts, never from witness deadlines.
    invariant: bool,
}
impl Timeline {
    fn constant(value: Verdict) -> Self { Self { value, changes: Vec::new(), invariant: true } }
    fn combine(self, other: Self, conjunction: bool) -> Self {
        let (mut left, mut right) = (self.value, other.value);
        let mut result = Self::constant(left.combine(right, conjunction));
        let decisive = if conjunction { Verdict::Denied } else { Verdict::Readable };
        result.invariant = (self.invariant && left == decisive)
            || (other.invariant && right == decisive) || (self.invariant && other.invariant);
        let (mut a, mut b) = (self.changes.as_slice(), other.changes.as_slice());
        let mut previous = result.value;
        while let Some(time) = earliest(a.first().map(|(t, _)| *t), b.first().map(|(t, _)| *t)) {
            // All rows expiring at the same instant disappear together. This
            // preserves correlations, including A or not A and A and not A.
            if let Some((head, tail)) = a.split_first() && head.0 == time { left = head.1; a = tail; }
            if let Some((head, tail)) = b.split_first() && head.0 == time { right = head.1; b = tail; }
            let value = left.combine(right, conjunction);
            if value != previous { result.changes.push((time, value)); previous = value; }
        }
        result
    }
}

// @ref LLP 3000.015#2 — next_expiry is the first expiry boundary that changes
// the complete bound rule's verdict, not a branch or first witness lifetime.
// Leaves prove their timeline within the original shared allowance. Combining
// those timelines performs no further storage reads.
fn timeline(rule: &RuleExpr, viewer: &str, old: Option<&Value>, next: &Value, created_allowed: bool, probe: &mut dyn Probe) -> Result<Timeline, crate::error::RuntimeError> {
    match rule {
        RuleExpr::And(terms) | RuleExpr::Or(terms) => {
            let conjunction = matches!(rule, RuleExpr::And(_));
            let decisive = if conjunction { Verdict::Denied } else { Verdict::Readable };
            let mut answer = Timeline::constant(decisive.not());
            for term in terms {
                answer = answer.combine(timeline(term, viewer, old, next, created_allowed, probe)?, conjunction);
                // Whole-rule expiry needs the remaining alternatives unless
                // structure/verdicts alone prove them irrelevant. An exists
                // with a permanent witness visits exactly the same branches
                // as one with a finite witness, under the same physical bound.
                // Logical guard narrowing does not assume this traversal skips
                // an operand: ordinary unique null points return a known miss
                // before touching storage (LLP 3000.013 §2.2).
                if answer.value == decisive && answer.invariant { break; }
            }
            Ok(answer)
        }
        RuleExpr::Not(inner) => {
            let mut answer = timeline(inner, viewer, old, next, created_allowed, probe)?;
            answer.value = answer.value.not();
            for (_, value) in &mut answer.changes { *value = value.not(); }
            Ok(answer)
        }
        _ => {
            probe.take_changes();
            let mut missing = false;
            let value = evaluate_leaf(rule, viewer, old, next, created_allowed, probe, &mut missing)?;
            let expiry = probe.replace_expiry(None);
            let mut answer = Timeline::constant(if probe.take_unknown() || missing { Verdict::Unknown } else if value { Verdict::Readable } else { Verdict::Denied });
            if let Some(changes) = probe.take_changes() {
                answer.changes = changes;
                answer.invariant = false;
                return Ok(answer);
            }
            // An absent witness stays absent as rows expire. Positive probes
            // (including created facts with extra tests) need their alternatives
            // in both lifetime worlds; the observed deadline cannot decide this.
            answer.invariant = rule_probes(rule) == 0 || answer.value == Verdict::Denied;
            if answer.value == Verdict::Readable && let Some(time) = expiry { answer.changes.push((time, Verdict::Denied)); }
            Ok(answer)
        }
    }
}

fn evaluate_leaf(rule: &RuleExpr, viewer: &str, old: Option<&Value>, next: &Value, created_allowed: bool, probe: &mut dyn Probe, missing: &mut bool) -> Result<bool, crate::error::RuntimeError> {
    match rule {
        RuleExpr::Public { .. } | RuleExpr::Allow => Ok(true),
        RuleExpr::Deny => Ok(false),
        RuleExpr::Eq(left, right) => Ok(term(left, viewer, old, next, probe, missing)? == term(right, viewer, old, next, probe, missing)?),
        RuleExpr::Ne(left, right) => Ok(term(left, viewer, old, next, probe, missing)? != term(right, viewer, old, next, probe, missing)?),
        RuleExpr::Compare(op,left,right) => {
            let left = term(left, viewer, old, next, probe, missing)?;
            let right = term(right, viewer, old, next, probe, missing)?;
            let (Value::Int(a),Value::Int(b)) = (left,right) else { return Ok(false); };
            Ok(match op { crate::ir::BinaryOp::Gte => a >= b, crate::ir::BinaryOp::Gt => a > b,
                crate::ir::BinaryOp::Lte => a <= b, crate::ir::BinaryOp::Lt => a < b, _ => false })
        }
        RuleExpr::And(_) | RuleExpr::Or(_) | RuleExpr::Not(_) => unreachable!("compound rule"),
        RuleExpr::Exists { table, index, key, equalities, .. } | RuleExpr::Created { table, index, key, equalities, .. } => {
            // Bind each operand once, through one codec/allocation path for both leaves.
            let created = matches!(rule, RuleExpr::Created { .. });
            if created && !created_allowed {
                return Err(crate::error::RuntimeError::Schema("created probes are valid only in insert rules".into()));
            }
            let key = key.iter().map(|term| self::term(term, viewer, old, next, probe, missing)).collect::<Result<Vec<_>, _>>()?;
            if *missing { return Ok(false); }
            if created {
                if !probe.created(table, index, &key) { return Ok(false); }
                if equalities.is_empty() { return Ok(true); }
            }
            let equalities = equalities.iter().map(|(column, value)| Ok((column.clone(), term(value, viewer, old, next, probe, missing)?))).collect::<Result<Vec<_>, crate::error::RuntimeError>>()?;
            if *missing { return Ok(false); }
            probe.exists(table, index, &key, &equalities)
        }
    }
}

pub(super) fn term(term: &RuleTerm, viewer: &str, old: Option<&Value>, next: &Value, probe: &mut dyn Probe, missing: &mut bool) -> Result<Value, crate::error::RuntimeError> {
    Ok(match term {
        RuleTerm::Field(field) | RuleTerm::NextField(field) => { probe.field(field, false); next.field(field).cloned().unwrap_or(Value::Null) },
        RuleTerm::OldField(field) => { probe.field(field, true); old.and_then(|old| old.field(field).ok()).cloned().unwrap_or(Value::Null) },
        RuleTerm::Reference { column, old: previous, .. } | RuleTerm::ReferenceChain { column, old: previous, .. } => {
            probe.field(column, *previous);
            let row = if *previous { old } else { Some(next) };
            let mut value = row.and_then(|r| r.field(column).ok()).cloned().unwrap_or(Value::Null);
            for (table, field) in term.references() {
                match probe.reference(table, &value, field)? {
                    Some(next) => value = next,
                    None => { *missing = true; return Ok(Value::Null); }
                }
            }
            value
        },
        RuleTerm::Viewer => Value::Id(viewer.to_owned()),
        RuleTerm::Literal(value) => value.clone(),
    })
}

/// The schema-derived probe allowance, independent of short-circuit answers.
pub(crate) fn rule_probes(rule: &RuleExpr) -> u64 {
    let hops = |terms: &[&RuleTerm]| terms.iter().map(|t| t.references().count() as u64).sum::<u64>();
    match rule {
        RuleExpr::Eq(a,b) | RuleExpr::Ne(a,b) | RuleExpr::Compare(_,a,b) => hops(&[a,b]),
        RuleExpr::Exists { key, equalities, .. } => 1 + key.iter().chain(equalities.iter().map(|(_,t)| t)).map(|t| hops(&[t])).sum::<u64>(),
        // @ref LLP 3000.007#17 — created facts with extra equalities take the metered exists path when the fact holds.
        RuleExpr::Created { key, equalities, .. } => u64::from(!equalities.is_empty()) + key.iter().chain(equalities.iter().map(|(_,t)| t)).map(|t| hops(&[t])).sum::<u64>(),
        RuleExpr::And(terms) | RuleExpr::Or(terms) => terms.iter().map(rule_probes).fold(0, u64::saturating_add),
        RuleExpr::Not(inner) => rule_probes(inner),
        RuleExpr::Allow | RuleExpr::Deny | RuleExpr::Public { .. } => 0,
    }
}

/// A rule's probe sites, as `(table, index)`: what a rule reads besides the
/// row, for live subscriptions and the partition audience.
pub fn probe_sites(rule: &RuleExpr, out: &mut Vec<(String, String)>) {
    fn term(t: &RuleTerm, out: &mut Vec<(String, String)>) {
        for (table, _) in t.references() { out.push((table.into(), "byId".into())); }
    }
    match rule {
        RuleExpr::Eq(a,b) | RuleExpr::Ne(a,b) | RuleExpr::Compare(_,a,b) => { term(a,out); term(b,out); }
        RuleExpr::Exists { table, index, key, equalities, .. } | RuleExpr::Created { table, index, key, equalities, .. } => {
            out.push((table.clone(), index.clone()));
            for t in key.iter().chain(equalities.iter().map(|(_,t)| t)) { term(t,out); }
        }
        RuleExpr::And(items) | RuleExpr::Or(items) => items.iter().for_each(|item| probe_sites(item, out)),
        RuleExpr::Not(inner) => probe_sites(inner, out),
        _ => {}
    }
}

#[cfg(test)]
mod lifetime_tests {
    use super::*;
    struct Witness { present: bool, until: Option<i64>, expiry: Option<i64>, visited: Vec<String> }
    impl Probe for Witness {
        fn replace_expiry(&mut self, expiry: Option<i64>) -> Option<i64> { std::mem::replace(&mut self.expiry, expiry) }
        fn exists(&mut self, table: &str, _: &str, _: &[Value], _: &[(String,Value)]) -> Result<bool, crate::RuntimeError> {
            self.visited.push(table.into());
            if table == "early" { self.expiry = self.until; Ok(self.present) } else { Ok(true) }
        }
        fn created(&mut self, _: &str, _: &str, _: &[Value]) -> bool { true }
    }
    #[test]
    fn branch_selection_uses_verdicts_and_structure_including_created_tests() {
        let exists = |name: &str| RuleExpr::Exists { table: name.into(), index: "byId".into(), key: vec![], provenance: crate::ir::KeyProvenance::Const, equalities: vec![] };
        let created = RuleExpr::Created { table: "early".into(), index: "byId".into(), key: vec![], provenance: crate::ir::KeyProvenance::Const,
            equalities: vec![("kind".into(), RuleTerm::Literal(Value::Int(1)))] };
        for early in [exists("early"), created] {
            for until in [None, Some(2000)] {
                for (rule, present, verdict, visits) in [
                    (RuleExpr::Or(vec![early.clone(), exists("stable")]), true, true, vec!["early", "stable"]),
                    (RuleExpr::And(vec![early.clone(), exists("stable")]), false, false, vec!["early"]),
                    (RuleExpr::Or(vec![RuleExpr::Allow, early.clone()]), true, true, vec![]),
                    (RuleExpr::And(vec![RuleExpr::Deny, early.clone()]), true, false, vec![]),
                ] {
                    let mut probe = Witness { present, until, expiry: None, visited: vec![] };
                    assert_eq!(evaluate(&rule, "alice", None, &Value::Null, true, &mut probe).unwrap(), verdict);
                    assert_eq!(probe.visited, visits);
                    assert_eq!(probe.expiry, None, "stable authority or denial exports no deadline");
                }
            }
        }
    }
}
