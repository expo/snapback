//! Grace belongs to effect admission, never to predicted rows.
use super::runner::Runner;
use crate::{error::RuntimeError, ir::Expr, value::Value};
use crate::smallmap::SmallMap;

pub(super) type Dependencies = std::collections::BTreeMap<String, Option<i64>>;
pub(crate) type Emission = (String, String, Value, Dependencies);

#[derive(Default)]
pub(super) struct EffectPresence {
    pub enabled: bool,
    pub reads: Dependencies,
    pub guard: Dependencies,
    pub variables: SmallMap<String, Dependencies>,
    guards: SmallMap<String, (bool, bool)>,
}

pub(super) fn bytes(deps: &Dependencies) -> u64 { deps.keys().map(|key| key.len() as u64 + 64).sum() }

impl Runner<'_> {
    pub(super) fn prepare_effect_presence(&mut self, program: &crate::ir::Program) -> Result<(), RuntimeError> {
        self.effect_presence.enabled = self.schema.operations.get(&program.name).is_some_and(|fact| fact.connected_effects_only);
        self.meter.at(&program.name);
        if self.effect_presence.enabled { plan_guards(&program.body, &program.name, &mut SmallMap::new(), &mut self.effect_presence.guards, &mut self.meter)?; }
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
        self.set_variable(name, value);
        if deps.is_empty() { self.effect_presence.variables.remove(name); }
        else {
            self.meter.heap(name.len() as u64 + 64)?;
            self.effect_presence.variables.insert(name.into(), deps);
        }
        Ok(())
    }

    // @ref LLP 3000.007#19.1 — only a necessary absence guard can authorize reconnect cancellation; payload dependencies cannot.
    pub(super) fn emission_presence(&mut self) -> Result<Dependencies, RuntimeError> {
        self.meter.heap(bytes(&self.effect_presence.guard))?;
        Ok(self.effect_presence.guard.clone())
    }

    pub(super) fn enter_presence_guard(&mut self, site: &str, take_then: bool) -> Result<Dependencies, RuntimeError> {
        let (yes, no) = self.effect_presence.guards.get(site).copied().unwrap_or_default();
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

    pub(super) fn push_presence_value(&mut self, name: &str) -> Result<(), RuntimeError> {
        let deps = self.value_presence()?;
        if !deps.is_empty() {
            self.meter.heap(name.len() as u64 + 64 + bytes(&deps))?;
            self.effect_presence.variables.entry(name.into()).or_default().extend(deps);
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

type Proofs<'a> = SmallMap<&'a str, Proof>;

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

fn plan_guards<'a>(body: &'a [crate::ir::Stmt], prefix: &str, env: &mut Proofs<'a>, guards: &mut SmallMap<String, (bool, bool)>, meter: &mut crate::meter::Meter) -> Result<(), RuntimeError> {
    use crate::ir::Stmt;
    for (index, stmt) in body.iter().enumerate() {
        meter.heap(prefix.len() as u64 + 32)?;
        let site = format!("{prefix}:{}", index + 1);
        match stmt {
            Stmt::Let { name, value } | Stmt::Assign { name, value } | Stmt::Const { name, value } => {
                let p = proof(value, env);
                meter.heap(64)?;
                env.insert(name, p);
            }
            Stmt::If { condition, then_body, else_body } => {
                let p = proof(condition, env);
                meter.heap(site.len() as u64 + 64)?;
                guards.insert(site.clone(), (p.yes, p.no));
                let mut yes = copy_proofs(env, meter)?;
                let mut no = copy_proofs(env, meter)?;
                meter.heap(2 * site.len() as u64 + 10)?;
                plan_guards(then_body, &format!("{site}:then"), &mut yes, guards, meter)?;
                plan_guards(else_body, &format!("{site}:else"), &mut no, guards, meter)?;
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
                plan_guards(body, &site, env, guards, meter)?;
                for (name, value) in env.iter_mut() { if assigns(body, name) { *value = Proof::UNKNOWN; } }
            }
            Stmt::Push { target, .. } => { meter.heap(64)?; env.insert(target, Proof::UNKNOWN); }
            _ => {}
        }
    }
    Ok(())
}
