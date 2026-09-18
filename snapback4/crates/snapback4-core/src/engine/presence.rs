//! Grace belongs to effect admission, never to predicted rows.
use super::runner::Runner;
use crate::{error::RuntimeError, ir::{Expr, Stmt}, value::Value};
use std::collections::BTreeMap;
#[cfg(not(target_arch = "wasm32"))]
use std::collections::{HashMap, HashSet};

pub(super) type Dependencies = BTreeMap<String, Option<i64>>;
pub(crate) type Emission = (String, String, Value, Dependencies);

#[cfg(not(target_arch = "wasm32"))]
#[derive(Clone, Copy, Debug)]
pub(super) enum Scalar { Bool(bool), Count(i64) }
#[cfg(not(target_arch = "wasm32"))]
impl Scalar {
    pub fn value(self) -> Value { match self { Self::Bool(b) => Value::Bool(b), Self::Count(n) => Value::Int(n) } }
    pub fn of(value: &Value) -> Option<Self> { match value { Value::Bool(b) => Some(Self::Bool(*b)), Value::Int(n) => Some(Self::Count(*n)), _ => None } }
}

#[derive(Clone)]
pub(super) struct Tracked {
    pub deps: Dependencies,
    #[cfg(not(target_arch = "wasm32"))]
    pub absent: Option<Scalar>,
}
impl std::ops::Deref for Tracked { type Target = Dependencies; fn deref(&self) -> &Dependencies { &self.deps } }

#[derive(Default)]
struct Guard {
    yes: bool, no: bool,
    #[cfg(not(target_arch = "wasm32"))]
    setup: bool,
    #[cfg(not(target_arch = "wasm32"))]
    is_setup: bool,
    #[cfg(not(target_arch = "wasm32"))]
    emit_yes: bool,
    #[cfg(not(target_arch = "wasm32"))]
    emit_no: bool,
}

#[derive(Default)]
pub(super) struct EffectPresence {
    pub enabled: bool,
    pub reads: Dependencies,
    pub guard: Dependencies,
    pub variables: BTreeMap<String, Tracked>,
    #[cfg(not(target_arch = "wasm32"))]
    pub absent: Option<Scalar>,
    guards: BTreeMap<String, Guard>,
}

pub(super) fn bytes(deps: &Dependencies) -> u64 { deps.keys().map(|key| key.len() as u64 + 64).sum() }

impl Runner<'_> {
    pub(super) fn prepare_effect_presence(&mut self, program: &crate::ir::Program) -> Result<(), RuntimeError> {
        self.effect_presence.enabled = self.schema.operations.get(&program.name).is_some_and(|fact| fact.connected_effects_only);
        self.meter.at(&program.name);
        if self.effect_presence.enabled {
            #[cfg(not(target_arch = "wasm32"))]
            let mut setups = Setups::default();
            plan_guards(&program.body, &program.name, &mut BTreeMap::new(), &mut self.effect_presence.guards, &mut self.meter, #[cfg(not(target_arch = "wasm32"))] &mut setups)?;
            #[cfg(not(target_arch = "wasm32"))]
            if !self.device {
                needed_setups(&program.body, &mut Bindings::default(), &self.effect_presence.guards, &mut setups);
                mark_bindings(&setups, &mut self.effect_presence.guards);
            }
        }
        Ok(())
    }

    // @ref LLP 3000.007#19.1 — reserve every potential dependency on every host, including absent/live principals; grace cannot decide a mutation refusal.
    pub(super) fn grace_read(&mut self, principal: &str, deadline: Option<i64>) -> Result<(), RuntimeError> {
        self.meter.heap(principal.len() as u64 + 64)?;
        self.effect_presence.reads.insert(principal.into(), deadline);
        Ok(())
    }

    pub(super) fn read_presence_value(&mut self, expr: &Expr) -> Result<(), RuntimeError> {
        if !self.effect_presence.enabled { return Ok(()); }
        // Include borrowed field/scalar fast paths, which do not call expr
        // on their root variable. Values themselves stay untouched.
        let name = match expr {
            Expr::Variable(name) => Some(name),
            Expr::Field { base, .. } => return self.read_presence_value(base),
            Expr::Builtin { args, .. } => {
                for arg in args { self.read_presence_value(arg)?; }
                None
            }
            _ => None,
        };
        if let Some(deps) = name.and_then(|name| self.effect_presence.variables.get(name)) {
            self.meter.heap(bytes(deps))?;
            self.effect_presence.reads.extend(deps.iter().map(|(principal, deadline)| (principal.clone(), *deadline)));
        }
        Ok(())
    }

    fn value_presence(&mut self) -> Result<Dependencies, RuntimeError> {
        self.meter.heap(bytes(&self.effect_presence.reads) + bytes(&self.effect_presence.guard))?;
        let mut deps = self.effect_presence.guard.clone();
        deps.extend(self.effect_presence.reads.iter().map(|(principal, deadline)| (principal.clone(), *deadline)));
        Ok(deps)
    }

    pub(super) fn bind_effect_value(&mut self, name: &str, value: Value) -> Result<(), RuntimeError> {
        let deps = self.value_presence()?;
        self.env.insert(name.into(), value);
        if deps.is_empty() { self.effect_presence.variables.remove(name); }
        else {
            self.meter.heap(name.len() as u64 + 64)?;
            self.effect_presence.variables.insert(name.into(), Tracked { deps, #[cfg(not(target_arch = "wasm32"))] absent: self.effect_presence.absent });
        }
        Ok(())
    }

    // @ref LLP 3000.007#19.1 — only a necessary absence guard can authorize reconnect cancellation; payload dependencies cannot.
    pub(super) fn emission_presence(&mut self) -> Result<Dependencies, RuntimeError> {
        self.meter.heap(bytes(&self.effect_presence.guard))?;
        Ok(self.effect_presence.guard.clone())
    }

    pub(super) fn enter_presence_guard(&mut self, site: &str, take_then: bool) -> Result<Dependencies, RuntimeError> {
        let proof = self.effect_presence.guards.get(site);
        let (yes, no) = proof.map(|p| (p.yes, p.no)).unwrap_or_default();
        // Reserve the same guard copy on either arm. Only the proven arm
        // carries deadlines; None still reserves the potential allocation.
        self.meter.heap(bytes(&self.effect_presence.guard) + bytes(&self.effect_presence.reads))?;
        let mut deps = self.effect_presence.guard.clone();
        for (principal, deadline) in &self.effect_presence.reads {
            let deadline = if if take_then { yes } else { no } { *deadline } else { None };
            let entry = deps.entry(principal.clone()).or_default();
            *entry = (*entry).max(deadline);
        }
        Ok(std::mem::replace(&mut self.effect_presence.guard, deps))
    }

    // @ref LLP 3000.007#21.3 — project only proven absence guards; the ordinary scalar remains the payload's value.
    #[cfg(not(target_arch = "wasm32"))]
    pub(super) fn presence_arm(&self, site: &str, actual: bool) -> bool {
        if self.device { return actual; }
        let Some(Scalar::Bool(absent)) = self.effect_presence.absent else { return actual; };
        let Some(proof) = self.effect_presence.guards.get(site) else { return actual; };
        if proof.setup || (!proof.is_setup && if absent { proof.yes && proof.emit_yes } else { proof.no && proof.emit_no }) { absent } else { actual }
    }

    #[cfg(target_arch = "wasm32")]
    pub(super) fn presence_arm(&self, _site: &str, actual: bool) -> bool { actual }

    #[cfg(not(target_arch = "wasm32"))]
    pub(super) fn presence_binary(&mut self, op: crate::ir::BinaryOp, left: &Value, projected: Option<Scalar>, right: &Value) {
        let other = self.effect_presence.absent.take();
        if projected.is_none() && other.is_none() { return; }
        if let (Some(l), Some(r)) = (projected.or_else(|| Scalar::of(left)), other.or_else(|| Scalar::of(right))) {
            self.effect_presence.absent = super::runner::binary(op, l.value(), r.value()).ok().as_ref().and_then(Scalar::of);
        }
    }

    pub(super) fn push_presence_value(&mut self, name: &str) -> Result<(), RuntimeError> {
        let deps = self.value_presence()?;
        if !deps.is_empty() {
            self.meter.heap(name.len() as u64 + 64 + bytes(&deps))?;
            let value = self.effect_presence.variables.entry(name.into()).or_insert_with(|| Tracked { deps: Dependencies::new(), #[cfg(not(target_arch = "wasm32"))] absent: None });
            #[cfg(not(target_arch = "wasm32"))]
            { value.absent = None; }
            value.deps.extend(deps);
        }
        Ok(())
    }
}

// A proof is deliberately narrower than a dependency: for each boolean
// outcome, *every* presence input must be absent for that outcome to hold.
// False conjunctions and true disjunctions provide no such proof. Unknown
// forms retain ordinary emission semantics; no condition is re-executed.
#[derive(Clone, Copy, PartialEq)]
struct Proof { independent: bool, count: bool, yes: bool, no: bool }
impl Proof {
    const INDEPENDENT: Self = Self { independent: true, count: false, yes: true, no: true };
    const UNKNOWN: Self = Self { independent: false, count: false, yes: false, no: false };
    fn boolean(yes: bool, no: bool) -> Self { Self { yes, no, ..Self::UNKNOWN } }
    fn not(self) -> Self { Self { yes: self.no, no: self.yes, count: false, ..self } }
    fn combine(self, right: Self, and: bool) -> Self {
        if self.independent && right.independent { return Self::INDEPENDENT; }
        Self::boolean(and && self.yes && right.yes, !and && self.no && right.no)
    }
}

type Proofs<'a> = BTreeMap<&'a str, Proof>;

fn proof(expr: &Expr, env: &Proofs<'_>) -> Proof {
    use crate::ir::{BinaryOp as B, Builtin, UnaryOp};
    match expr {
        Expr::Variable(name) => env.get(name.as_str()).copied().unwrap_or(Proof::INDEPENDENT),
        Expr::Literal(_) | Expr::Input(_) => Proof::INDEPENDENT,
        Expr::Unary { op: UnaryOp::Not, value } => proof(value, env).not(),
        Expr::Builtin { builtin: Builtin::Connected, args } if args.iter().all(|e| proof(e, env).independent) => Proof { count: true, ..Proof::UNKNOWN },
        Expr::Binary { op, left, right } => {
            let l = proof(left, env);
            let r = proof(right, env);
            if *op == B::And || *op == B::Or { return l.combine(r, *op == B::And); }
            if l.independent && r.independent { return Proof::INDEPENDENT; }
            if let Expr::Literal(Value::Bool(value)) = **right {
                if *op == B::Eq { return if value { l } else { l.not() }; }
                if *op == B::Ne { return if value { l.not() } else { l }; }
            }
            if l.count && matches!(**right, Expr::Literal(Value::Int(0))) {
                return match op { B::Eq | B::Lte => Proof::boolean(true, false), B::Ne | B::Gt => Proof::boolean(false, true), _ => Proof::UNKNOWN };
            }
            if r.count && matches!(**left, Expr::Literal(Value::Int(0))) {
                return match op { B::Eq | B::Gte => Proof::boolean(true, false), B::Ne | B::Lt => Proof::boolean(false, true), _ => Proof::UNKNOWN };
            }
            Proof::UNKNOWN
        }
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } if proof(base, env).independent => Proof::INDEPENDENT,
        Expr::Builtin { args, .. } if args.iter().all(|e| proof(e, env).independent) => Proof::INDEPENDENT,
        _ => Proof::UNKNOWN,
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn emits(body: &[Stmt]) -> bool {
    body.iter().any(|stmt| match stmt {
        Stmt::Emit { .. } => true,
        Stmt::If { then_body, else_body, .. } => emits(then_body) || emits(else_body),
        Stmt::For { body, .. } => emits(body),
        _ => false,
    })
}

fn assigns(body: &[crate::ir::Stmt], name: &str) -> bool {
    use crate::ir::Stmt;
    body.iter().any(|s| match s {
        Stmt::Let { name: n, .. } | Stmt::Assign { name: n, .. } | Stmt::Const { name: n, .. } | Stmt::Push { target: n, .. } => n == name,
        Stmt::If { then_body, else_body, .. } => assigns(then_body, name) || assigns(else_body, name),
        Stmt::For { body, .. } => assigns(body, name),
        _ => false,
    })
}

fn copy_proofs<'a>(env: &Proofs<'a>, meter: &mut crate::meter::Meter) -> Result<Proofs<'a>, RuntimeError> {
    meter.heap(env.len() as u64 * 64)?;
    Ok(env.clone())
}

fn plan_guards<'a>(body: &'a [crate::ir::Stmt], prefix: &str, env: &mut Proofs<'a>, guards: &mut BTreeMap<String, Guard>, meter: &mut crate::meter::Meter, #[cfg(not(target_arch = "wasm32"))] setups: &mut Setups) -> Result<(), RuntimeError> {
    use crate::ir::Stmt;
    for (index, stmt) in body.iter().enumerate() {
        meter.heap(prefix.len() as u64 + 32)?;
        let site = format!("{prefix}:{}", index + 1);
        match stmt {
            Stmt::Let { name, value } | Stmt::Assign { name, value } | Stmt::Const { name, value } => {
                let p = proof(value, env);
                #[cfg(not(target_arch = "wasm32"))]
                if p.independent { setups.independent.insert(stmt as *const Stmt as usize); }
                meter.heap(64)?;
                env.insert(name, p);
            }
            Stmt::If { condition, then_body, else_body } => {
                let p = proof(condition, env);
                #[cfg(not(target_arch = "wasm32"))]
                setups.guards.insert(stmt as *const Stmt as usize, site.clone());
                meter.heap(site.len() as u64 + 64)?;
                guards.insert(site.clone(), Guard {
                    yes: p.yes, no: p.no,
                    #[cfg(not(target_arch = "wasm32"))]
                    setup: false,
                    #[cfg(not(target_arch = "wasm32"))]
                    is_setup: short_target(condition, then_body, else_body).is_some(),
                    #[cfg(not(target_arch = "wasm32"))]
                    emit_yes: emits(then_body),
                    #[cfg(not(target_arch = "wasm32"))]
                    emit_no: emits(else_body),
                });
                let mut yes = copy_proofs(env, meter)?;
                let mut no = copy_proofs(env, meter)?;
                meter.heap(2 * site.len() as u64 + 10)?;
                plan_guards(then_body, &format!("{site}:then"), &mut yes, guards, meter, #[cfg(not(target_arch = "wasm32"))] setups)?;
                plan_guards(else_body, &format!("{site}:else"), &mut no, guards, meter, #[cfg(not(target_arch = "wasm32"))] setups)?;
                // The lowered short circuit is `let b = left; if b:
                // b = right` (and), or its else arm (or). Reconstruct its
                // boolean proof using both alternatives, even when one skips.
                let short = if let Expr::Variable(name) = condition {
                    let (branch, right, and) = if else_body.is_empty() { (then_body, &yes, true) } else { (else_body, &no, false) };
                    let other_empty = if and { else_body.is_empty() } else { then_body.is_empty() };
                    if other_empty && matches!(branch.last(), Some(Stmt::Assign { name: target, .. }) if target == name) {
                        right.get(name.as_str()).map(|r| (name.as_str(), p.combine(*r, and)))
                    } else { None }
                } else { None };
                for (&name, value) in yes.iter().chain(no.iter()) {
                    if assigns(then_body, name) || assigns(else_body, name) {
                        let merged = if let Some((_, result)) = short.filter(|(target, _)| *target == name) { result }
                            else if p.independent && value.independent && yes.get(name).is_some_and(|v| v.independent) && no.get(name).is_some_and(|v| v.independent) { Proof::INDEPENDENT }
                            else { Proof::UNKNOWN };
                        meter.heap(64)?;
                        env.insert(name, merged);
                    }
                }
            }
            Stmt::For { binding, body, .. } => {
                // Loop-carried values are not boolean proofs; a literal/direct
                // absence guard inside the loop still qualifies on every row.
                for (name, value) in env.iter_mut() { if assigns(body, name) { *value = Proof::UNKNOWN; } }
                meter.heap(64)?;
                env.insert(binding, Proof::INDEPENDENT);
                plan_guards(body, &site, env, guards, meter, #[cfg(not(target_arch = "wasm32"))] setups)?;
                for (name, value) in env.iter_mut() { if assigns(body, name) { *value = Proof::UNKNOWN; } }
            }
            Stmt::Push { target, .. } => { meter.heap(64)?; env.insert(target, Proof::UNKNOWN); }
            _ => {}
        }
    }
    Ok(())
}

// Quarry lowers a boolean expression to a private accumulator and one
// assignment arm. Project that setup only when its result feeds a proven
// guard, never for payloads or an unproven enclosing boolean expression.
#[cfg(not(target_arch = "wasm32"))]
pub(super) fn short_target<'a>(condition: &'a Expr, then_body: &[Stmt], else_body: &[Stmt]) -> Option<&'a str> {
    let Expr::Variable(name) = condition else { return None; };
    if !name.starts_with("$bool") { return None; }
    let branch = if else_body.is_empty() { then_body } else if then_body.is_empty() { else_body } else { return None; };
    matches!(branch.last(), Some(Stmt::Assign { name: target, .. }) if target == name).then_some(name)
}

// @ref LLP 3000.007#19.1 — scoped setup invalidation follows uses before undo, preserving definition marks and every meter charge.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Default)]
struct Setups {
    independent: HashSet<usize>,
    guards: HashMap<usize, String>,
    inputs: HashMap<usize, Vec<usize>>,
    roots: Vec<usize>,
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Clone, Copy, PartialEq, Eq)]
struct Binding { statement: usize, loop_depth: usize, loop_scope: usize }

#[cfg(not(target_arch = "wasm32"))]
#[derive(Default)]
struct Bindings<'a> {
    values: HashMap<&'a str, Binding>,
    undo: Vec<(&'a str, Option<Binding>)>,
    loops: Vec<usize>,
}

#[cfg(not(target_arch = "wasm32"))]
impl<'a> Bindings<'a> {
    fn get(&self, name: &str, assignments: &Assignments<'_>) -> Option<&usize> {
        let value = self.values.get(name)?;
        if value.loop_depth > 0 && self.loops.get(value.loop_depth - 1) != Some(&value.loop_scope) { return None; }
        // Only the outermost loop entered since this definition matters:
        // its assignment range contains every nested loop's range as well.
        if self.loops.get(value.loop_depth).is_some_and(|scope| assignments.assigns(*scope, name)) { return None; }
        Some(&value.statement)
    }
    fn set(&mut self, name: &'a str, value: Option<usize>) {
        let value = value.map(|statement| Binding { statement, loop_depth: self.loops.len(), loop_scope: self.loops.last().copied().unwrap_or(0) });
        let old = self.values.get(name).copied();
        if old == value { return; }
        self.undo.push((name, old));
        if let Some(value) = value { self.values.insert(name, value); } else { self.values.remove(name); }
    }
    fn restore(&mut self, mark: usize) {
        while self.undo.len() > mark {
            let (name, old) = self.undo.pop().unwrap();
            if let Some(old) = old { self.values.insert(name, old); } else { self.values.remove(name); }
        }
    }
}

// A join only needs to forget names read before this scope is undone. The
// enclosing join owns reads outside it. Build those scoped kills backwards,
// merging smaller name sets into larger ones: descendant assignments are
// never enumerated again at every ancestor. Short-circuit arms include their
// implicit result read. Loop entry is lazy: a name's sorted assignment sites
// answer membership in the outermost newly entered loop with one search.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Default)]
struct Assignments<'a> {
    exits: HashMap<usize, Vec<&'a str>>,
    positions: HashMap<&'a str, Vec<usize>>,
    loops: HashMap<usize, std::ops::Range<usize>>,
}

#[cfg(not(target_arch = "wasm32"))]
impl<'a> Assignments<'a> {
    fn index(&mut self, body: &'a [Stmt], next: &mut usize) {
        for stmt in body {
            match stmt {
                Stmt::Let { name, .. } | Stmt::Assign { name, .. } | Stmt::Const { name, .. } | Stmt::Push { target: name, .. } => {
                    self.positions.entry(name).or_default().push(*next);
                    *next += 1;
                }
                Stmt::If { then_body, else_body, .. } => { self.index(then_body, next); self.index(else_body, next); }
                Stmt::For { body, .. } => {
                    let start = *next;
                    self.index(body, next);
                    self.loops.insert(stmt as *const Stmt as usize, start..*next);
                }
                _ => {}
            }
        }
    }
    fn assigns(&self, scope: usize, name: &str) -> bool {
        let Some(positions) = self.positions.get(name) else { return false; };
        let range = &self.loops[&scope];
        positions.get(positions.partition_point(|p| *p < range.start)).is_some_and(|p| *p < range.end)
    }
    fn merge(into: &mut HashSet<&'a str>, mut other: HashSet<&'a str>) {
        if into.len() < other.len() { std::mem::swap(into, &mut other); }
        into.extend(other);
    }
    fn intersection(a: &HashSet<&'a str>, b: &HashSet<&'a str>) -> Vec<&'a str> {
        let (small, large) = if a.len() < b.len() { (a, b) } else { (b, a) };
        small.iter().copied().filter(|name| large.contains(name)).collect()
    }
    fn reads(expr: &'a Expr, names: &mut HashSet<&'a str>) {
        match expr {
            Expr::Variable(name) => { names.insert(name); }
            Expr::Field { base, .. } | Expr::Unary { value: base, .. } => Self::reads(base, names),
            Expr::Binary { left, right, .. } => { Self::reads(left, names); Self::reads(right, names); }
            Expr::Builtin { args, .. } => { for arg in args { Self::reads(arg, names); } }
            _ => {}
        }
    }
    fn collect(&mut self, body: &'a [Stmt], result: Option<&'a str>) -> (HashSet<&'a str>, HashSet<&'a str>) {
        let mut written = HashSet::new();
        let mut read = HashSet::new();
        read.extend(result);
        for stmt in body.iter().rev() {
            let statement = stmt as *const Stmt as usize;
            match stmt {
                Stmt::Let { name, value } | Stmt::Assign { name, value } | Stmt::Const { name, value } => {
                    written.insert(name.as_str());
                    Self::reads(value, &mut read);
                }
                Stmt::Push { target, .. } => { written.insert(target.as_str()); }
                Stmt::If { condition, then_body, else_body } => {
                    let target = short_target(condition, then_body, else_body);
                    let (mut writes, mut reads) = self.collect(then_body, target.filter(|_| else_body.is_empty()));
                    let (other_writes, other_reads) = self.collect(else_body, target.filter(|_| !else_body.is_empty()));
                    Self::merge(&mut writes, other_writes);
                    Self::merge(&mut reads, other_reads);
                    self.exits.insert(statement, Self::intersection(&writes, &read));
                    Self::merge(&mut written, writes);
                    Self::merge(&mut read, reads);
                    Self::reads(condition, &mut read);
                }
                Stmt::For { body, .. } => {
                    let (writes, reads) = self.collect(body, None);
                    self.exits.insert(statement, Self::intersection(&writes, &read));
                    Self::merge(&mut written, writes);
                    Self::merge(&mut read, reads);
                }
                _ => {}
            }
        }
        (written, read)
    }
    fn forget(&self, statement: usize, bindings: &mut Bindings<'a>) {
        for &name in &self.exits[&statement] { bindings.set(name, None); }
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn mark_inputs(expr: &Expr, bindings: &Bindings<'_>, inputs: &mut Vec<usize>, assignments: &Assignments<'_>) {
    match expr {
        Expr::Variable(name) => { if let Some(binding) = bindings.get(name.as_str(), assignments) { inputs.push(*binding); } }
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => mark_inputs(base, bindings, inputs, assignments),
        Expr::Binary { left, right, .. } => { mark_inputs(left, bindings, inputs, assignments); mark_inputs(right, bindings, inputs, assignments); }
        Expr::Builtin { args, .. } => { for arg in args { mark_inputs(arg, bindings, inputs, assignments); } }
        _ => {}
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn mark_bindings(setups: &Setups, guards: &mut BTreeMap<String, Guard>) {
    let mut visited = HashSet::new();
    let mut pending = setups.roots.clone();
    while let Some(statement) = pending.pop() {
        if !visited.insert(statement) { continue; }
        if let Some(site) = setups.guards.get(&statement) { guards.get_mut(site).unwrap().setup = true; }
        if let Some(inputs) = setups.inputs.get(&statement) { pending.extend(inputs); }
    }
}

// Resolve each input to the reaching statement, not its spelling: assigning
// the same variable later must not reuse an earlier definition's visited bit.
// Independent definitions are absent from the graph. No backwards name scan
// or recursive alias expansion is needed, even for a diamond-shaped DAG.
#[cfg(not(target_arch = "wasm32"))]
fn needed_setups<'a>(body: &'a [Stmt], bindings: &mut Bindings<'a>, guards: &BTreeMap<String, Guard>, setups: &mut Setups) {
    let mut assignments = Assignments::default();
    assignments.index(body, &mut 0);
    assignments.collect(body, None);
    discover_setups(body, bindings, guards, setups, &assignments);
}

#[cfg(not(target_arch = "wasm32"))]
fn discover_setups<'a>(body: &'a [Stmt], bindings: &mut Bindings<'a>, guards: &BTreeMap<String, Guard>, setups: &mut Setups, assignments: &Assignments<'a>) {
    for stmt in body {
        let statement = stmt as *const Stmt as usize;
        match stmt {
            Stmt::Let { name, value } | Stmt::Assign { name, value } | Stmt::Const { name, value } => {
                if setups.independent.contains(&statement) { bindings.set(name, None); }
                else {
                    let mut inputs = Vec::new();
                    mark_inputs(value, bindings, &mut inputs, assignments);
                    setups.inputs.insert(statement, inputs);
                    bindings.set(name, Some(statement));
                }
            }
            Stmt::If { condition, then_body, else_body } => {
                let guard = &guards[&setups.guards[&statement]];
                if !guard.is_setup && ((guard.yes && guard.emit_yes) || (guard.no && guard.emit_no)) {
                    mark_inputs(condition, bindings, &mut setups.roots, assignments);
                }
                let target = short_target(condition, then_body, else_body);
                let mut inputs = Vec::new();
                if target.is_some() { mark_inputs(condition, bindings, &mut inputs, assignments); }
                let mark = bindings.undo.len();
                discover_setups(then_body, bindings, guards, setups, assignments);
                if else_body.is_empty() {
                    if let Some(binding) = target.and_then(|name| bindings.get(name, assignments)) { inputs.push(*binding); }
                }
                bindings.restore(mark);
                discover_setups(else_body, bindings, guards, setups, assignments);
                if !else_body.is_empty() {
                    if let Some(binding) = target.and_then(|name| bindings.get(name, assignments)) { inputs.push(*binding); }
                }
                bindings.restore(mark);
                assignments.forget(statement, bindings);
                if let Some(name) = target {
                    if inputs.is_empty() { bindings.set(name, None); }
                    else { setups.inputs.insert(statement, inputs); bindings.set(name, Some(statement)); }
                }
            }
            Stmt::For { binding, body, .. } => {
                bindings.loops.push(statement);
                bindings.set(binding, None);
                discover_setups(body, bindings, guards, setups, assignments);
                bindings.loops.pop();
                assignments.forget(statement, bindings);
            }
            Stmt::Push { target, .. } => bindings.set(target, None),
            _ => {}
        }
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
#[path = "../../tests/presence/setups.rs"]
mod setup_tests;
