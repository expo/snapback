//! Structural lengths of page/list bindings used by scalar folds.
use super::*;

#[derive(Clone)]
enum Iterations { Static(u64), List(Expr), Open }

#[derive(Default)]
pub(super) struct Collections {
    definitions: BTreeMap<String, Expr>,
    pushes: BTreeMap<String, Vec<Vec<Iterations>>>,
}
impl Collections {
    // Like the presence-copy census, collect from the entire alpha-renamed IR
    // before walking: a later assignment invalidates the initial size.
    pub(super) fn new(program: &Program) -> Self {
        type Scope = Vec<usize>;
        #[derive(Default)]
        struct Census {
            definitions: BTreeMap<String, Expr>,
            scopes: BTreeMap<String, Scope>,
            pushes: BTreeMap<String, Vec<(Scope, Option<Expr>)>>,
            changed: BTreeSet<String>,
            iterations: BTreeMap<usize, Iterations>,
            next: usize,
        }
        fn repeated(value: &serde_json::Value, max: Iterations, scope: &mut Scope, census: &mut Census) {
            census.next += 1;
            census.iterations.insert(census.next, max);
            scope.push(census.next);
            walk(value, scope, census);
            scope.pop();
        }
        fn walk(value: &serde_json::Value, scope: &mut Scope, census: &mut Census) {
            match value {
                serde_json::Value::Object(fields) => {
                    for kind in ["Let", "Const"] {
                        if let Some(binding) = fields.get(kind)
                            && let Some(name) = binding.get("name").and_then(|v| v.as_str())
                            && let Some(value) = binding.get("value")
                            && let Ok(expr) = serde_json::from_value(value.clone()) {
                            census.scopes.insert(name.into(), scope.clone());
                            if census.definitions.insert(name.into(), expr).is_some() { census.changed.insert(name.into()); }
                        }
                    }
                    if let Some(assign) = fields.get("Assign")
                        && let Some(name) = assign.get("name").and_then(|v| v.as_str()) {
                        let increment = serde_json::from_value::<Expr>(assign["value"].clone()).ok().and_then(|value| {
                            let Expr::Builtin { builtin: Builtin::Concat, args } = value else { return None; };
                            let [left, right] = args.as_slice() else { return None; };
                            let is_self = |value: &Expr| matches!(value, Expr::Variable(source) if source == name);
                            match (is_self(left), is_self(right)) {
                                (true, false) => Some(right.clone()),
                                (false, true) => Some(left.clone()),
                                _ => None, // Doubling still needs the step-ceiling fallback.
                            }
                        });
                        if let Some(increment) = increment {
                            census.pushes.entry(name.into()).or_default().push((scope.clone(), Some(increment)));
                        } else { census.changed.insert(name.into()); }
                    }
                    if let Some(name) = fields.get("Push").and_then(|s| s.get("target")).and_then(|v| v.as_str()) {
                        census.pushes.entry(name.into()).or_default().push((scope.clone(), None));
                    }
                    if let Some(loop_) = fields.get("For") {
                        let domain = &loop_["domain"];
                        walk(domain, scope, census);
                        let max = match serde_json::from_value::<LoopDomain>(domain.clone()).ok() {
                            Some(LoopDomain::Page(scan)) if scan.take != Bound::Meter => Iterations::Static(scan.take.maximum()),
                            Some(LoopDomain::LiteralRange { start, end_exclusive }) => Iterations::Static(end_exclusive.saturating_sub(start).max(0) as u64),
                            // Append widens this type to the heap-meter sentinel,
                            // not a length. Resolve its source after the census.
                            Some(LoopDomain::DerivedArray { value, max: u32::MAX, .. }) => Iterations::List(value),
                            Some(LoopDomain::DerivedArray { max, .. } | LoopDomain::ArgList { max, .. }) => Iterations::Static(u64::from(max)),
                            _ => Iterations::Open,
                        };
                        repeated(&loop_["body"], max, scope, census);
                        return;
                    }
                    for (kind, value) in fields {
                        // Filters, projections and lane setup can repeat without
                        // a statement loop. An escaping push is open work; a
                        // list initialized inside that scope starts afresh there.
                        if matches!(kind.as_str(), "Scan" | "Merge" | "Shape" | "Builtin") {
                            repeated(value, Iterations::Open, scope, census);
                        } else { walk(value, scope, census); }
                    }
                }
                serde_json::Value::Array(values) => for value in values { walk(value, scope, census); },
                _ => {}
            }
        }
        let mut census = Census::default();
        walk(&serde_json::to_value(&program.body).expect("serializable IR"), &mut Vec::new(), &mut census);
        let mut pushes = BTreeMap::new();
        // @ref LLP 3000.019#3.2 — shapes lower to [] plus pushes. Sum each
        // push's bounded iterations since initialization, multiplying nested
        // loops. Resolve source-list bounds only after all pushes/assignments
        // are known. Bounded append/prepend contributes its length just like Push;
        // arbitrary assignments and open/cyclic growth keep the fallback.
        for (name, scopes) in &census.pushes {
            let iterations = census.scopes.get(name).and_then(|initial| scopes.iter().map(|(scope, increment)| {
                if !scope.starts_with(initial) { return None; }
                let mut times: Vec<_> = scope[initial.len()..].iter().map(|id| census.iterations[id].clone()).collect();
                if let Some(increment) = increment { times.push(Iterations::List(increment.clone())); }
                Some(times)
            }).collect::<Option<Vec<_>>>());
            if let Some(iterations) = iterations {
                pushes.insert(name.clone(), iterations);
            } else { census.changed.insert(name.clone()); }
        }
        census.definitions.retain(|name, _| !census.changed.contains(name));
        pushes.retain(|name, _| !census.changed.contains(name));
        Self { definitions: census.definitions, pushes }
    }

    // @ref LLP 3000.019#3.2 — a materialized aggregate visits its page/list
    // bound, including through immutable aliases, not the step ceiling.
    pub(super) fn bound(&self, expr: &Expr, program: &Program, meter: u64) -> Option<u64> {
        self.value(expr, program, meter, &mut BTreeSet::new())
    }
    fn value(&self, expr: &Expr, program: &Program, meter: u64, seen: &mut BTreeSet<String>) -> Option<u64> {
        match expr {
            Expr::Array(values) => Some(values.len() as u64),
            Expr::Literal(Value::Array(values)) => Some(values.len() as u64),
            Expr::Scan(scan) => Some(if scan.take == Bound::Meter { meter } else { scan.take.maximum() }),
            Expr::Merge(merge) => merge.position.as_ref().map(|position| u64::from(position.take)),
            Expr::Shape { base, .. } | Expr::Block { value: base, .. } => self.value(base, program, meter, seen),
            Expr::Variable(name) if seen.insert(name.clone()) => {
                let bound = if let Some(pushes) = self.pushes.get(name) {
                    let initial = self.definitions.get(name).and_then(|value| self.value(value, program, meter, seen))?;
                    pushes.iter().try_fold(initial, |sum, iterations| {
                        let times = iterations.iter().try_fold(1u64, |times, iteration| {
                            let max = match iteration {
                                Iterations::Static(max) => *max,
                                Iterations::List(source) => self.value(source, program, meter, seen)?,
                                Iterations::Open => return None,
                            };
                            Some(times.saturating_mul(max))
                        })?;
                        Some(sum.saturating_add(times))
                    })
                }
                    else if let Some(value) = self.definitions.get(name) { self.value(value, program, meter, seen) }
                    else { program.args.get(name).and_then(list_bound) };
                seen.remove(name);
                bound
            }
            Expr::Builtin { builtin: Builtin::Sort { .. } | Builtin::Slice | Builtin::ProjectFields { .. }, args } => self.value(args.first()?, program, meter, seen),
            Expr::Builtin { builtin: Builtin::Concat, args } if args.len() == 2 =>
                Some(self.value(&args[0], program, meter, seen)?.saturating_add(self.value(&args[1], program, meter, seen)?)),
            _ => None,
        }
    }
}
fn list_bound(ty: &ArgType) -> Option<u64> {
    match ty { ArgType::List { max, .. } | ArgType::ListRange { max, .. } => Some(u64::from(*max)), ArgType::Optional(inner) => list_bound(inner), _ => None }
}
