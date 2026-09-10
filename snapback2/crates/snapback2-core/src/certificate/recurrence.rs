//! Simultaneous loop-carried widths: aliases and alternating branches form a recurrence together.
// @ref LLP 1020#a5-recurrence-pricing-is-a-bound — compose nonnegative affine bounds by squaring, never unroll the runtime bound.
use super::*;
use crate::value::canonical_json;
use crate::collection_rewrite::OutputBound;

type Width = BTreeMap<String, u64>; // empty key is the constant term
fn constant(n: u64) -> Width { BTreeMap::from([(String::new(), n)]) }
fn add(mut a: Width, b: Width) -> Width {
    for (key, n) in b { let entry = a.entry(key).or_default(); *entry = entry.saturating_add(n); }
    a
}
fn maximum(mut a: Width, b: Width) -> Width {
    for (key, n) in b { let entry = a.entry(key).or_default(); *entry = (*entry).max(n); }
    a
}
fn substitute(width: &Width, env: &BTreeMap<String, Width>) -> Width {
    width.iter().fold(Width::new(), |sum, (name, n)| {
        let replacement = env.get(name).cloned().unwrap_or_else(|| BTreeMap::from([(name.clone(), 1)]));
        add(sum, replacement.into_iter().map(|(key, v)| (key, v.saturating_mul(*n))).collect())
    })
}
fn targets(body: &[Stmt], names: &mut BTreeSet<String>) {
    for stmt in body {
        match stmt {
            // Only names bound before the loop survive the callers' `retain`; a fresh `let` is not carried.
            Stmt::Assign { name, .. } | Stmt::Let { name, .. } | Stmt::Const { name, .. } | Stmt::Push { target: name, .. } => { names.insert(name.clone()); }
            Stmt::For { body, .. } => targets(body, names),
            Stmt::If { then_body, else_body, .. } => { targets(then_body, names); targets(else_body, names); }
            _ => {}
        }
    }
}

impl OutputEstimator<'_> {
    pub(super) fn coupled_widths(&self, body: &[Stmt], variables: &BTreeMap<String, OutputBound>, bound: u64) -> BTreeMap<String, u64> {
        let mut names = BTreeSet::new();
        targets(body, &mut names);
        names.retain(|name| variables.contains_key(name));
        // The ordinary provenance estimator handles a single carried value, including its aliases.
        if names.len() < 2 || bound == 0 { return BTreeMap::new(); }
        let mut env = variables.iter().map(|(name, value)| (name.clone(), constant(value.bytes))).collect();
        self.width_loop(body, bound, &mut env, variables);
        names.into_iter().map(|name| {
            let bytes = env.get(&name).and_then(|width| width.get("")).copied().unwrap_or(0);
            (name, bytes)
        }).collect()
    }

    fn width_loop(&self, body: &[Stmt], mut bound: u64, env: &mut BTreeMap<String, Width>, variables: &BTreeMap<String, OutputBound>) {
        if bound == 0 { return; }
        let mut names = BTreeSet::new();
        targets(body, &mut names);
        names.retain(|name| env.contains_key(name));
        let mut symbolic = env.clone();
        for name in &names { symbolic.insert(name.clone(), BTreeMap::from([(name.clone(), 1)])); }
        self.width_statements(body, &mut symbolic, variables);
        let mut transform: BTreeMap<_, _> = names.iter().map(|name| {
            (name.clone(), symbolic[name].clone())
        }).collect();
        // Sum each intermediate width, including the initial value. This dominates
        // every early-exit peak without adding an identity coefficient to a copied value.
        for name in &names {
            transform.insert(format!("@peak:{name}"), add(symbolic[name].clone(), BTreeMap::from([(format!("@peak:{name}"), 1)])));
        }
        let mut powered: BTreeMap<_, _> = transform.keys().map(|name| (name.clone(), BTreeMap::from([(name.clone(), 1)]))).collect();
        while bound > 0 {
            if bound & 1 == 1 { powered = powered.iter().map(|(name, value)| (name.clone(), substitute(value, &transform))).collect(); }
            bound >>= 1;
            if bound > 0 { transform = transform.iter().map(|(name, value)| (name.clone(), substitute(value, &transform))).collect(); }
        }
        let mut before = env.clone();
        for name in &names { before.insert(format!("@peak:{name}"), before[name].clone()); }
        for name in names { env.insert(name.clone(), substitute(&powered[&format!("@peak:{name}")], &before)); }
    }

    fn width_statements(&self, body: &[Stmt], env: &mut BTreeMap<String, Width>, variables: &BTreeMap<String, OutputBound>) {
        for stmt in body {
            match stmt {
                Stmt::Let { name, value } | Stmt::Const { name, value } | Stmt::InsertIfAbsent { result: name, row: value, .. } => { env.insert(name.clone(), self.width_expr(value, env, variables)); }
                Stmt::Assign { name, value } => {
                    let width = self.width_expr(value, env, variables);
                    env.insert(name.clone(), width);
                }
                Stmt::Push { target, value } => {
                    let value = add(self.width_expr(value, env, variables), constant(1));
                    env.insert(target.clone(), add(env.get(target).cloned().unwrap_or_else(|| constant(12)), value));
                }
                Stmt::If { then_body, else_body, .. } => {
                    let mut left = env.clone();
                    let mut right = env.clone();
                    self.width_statements(then_body, &mut left, variables);
                    self.width_statements(else_body, &mut right, variables);
                    for (name, value) in left.into_iter().chain(right) {
                        env.insert(name.clone(), maximum(env.get(&name).cloned().unwrap_or_default(), value));
                    }
                }
                Stmt::For { binding, domain, body } => {
                    let (bound, bytes) = self.domain(domain, variables);
                    let previous = env.insert(binding.clone(), constant(bytes));
                    self.width_loop(body, bound, env, variables);
                    if let Some(previous) = previous { env.insert(binding.clone(), previous); } else { env.remove(binding); }
                }
                _ => {}
            }
        }
    }

    fn width_expr(&self, expr: &Expr, env: &BTreeMap<String, Width>, variables: &BTreeMap<String, OutputBound>) -> Width {
        match expr {
            Expr::Variable(name) => env.get(name).cloned().unwrap_or_else(|| constant(self.expression(expr, variables))),
            Expr::Field { base, .. } => {
                let base_width = self.width_expr(base, env, variables);
                if base_width.keys().any(|key| !key.is_empty()) || self.expression_table(base, variables).is_none() { base_width }
                else { constant(self.expression(expr, variables)) }
            }
            Expr::Object(fields) => fields.iter().fold(constant(10), |width, (key, value)| add(add(width, constant(canonical_json(key).len() as u64 + 2)), self.width_expr(value, env, variables))),
            Expr::Array(values) => values.iter().fold(constant(12), |width, value| add(add(width, constant(1)), self.width_expr(value, env, variables))),
            Expr::Builtin { builtin: Builtin::Concat, args } => args.iter().fold(Width::new(), |width, value| add(width, self.width_expr(value, env, variables))),
            Expr::Builtin { builtin: Builtin::Slice | Builtin::Sort { .. }, args } => args.first().map(|value| self.width_expr(value, env, variables)).unwrap_or_default(),
            Expr::Builtin { builtin: Builtin::Min | Builtin::Max, args } => args.iter().fold(Width::new(), |width, value| maximum(width, self.width_expr(value, env, variables))),
            Expr::Builtin { builtin: Builtin::MentionTokens, args } => {
                let value = args.first().map(|value| self.width_expr(value, env, variables)).unwrap_or_default();
                add(value.clone(), value)
            }
            _ => constant(self.expression(expr, variables)),
        }
    }
}
