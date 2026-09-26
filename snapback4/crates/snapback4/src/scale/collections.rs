//! Structural lengths of page/list bindings used by scalar folds.
use super::*;

#[derive(Default)]
pub(super) struct Collections {
    definitions: BTreeMap<String, Expr>,
    pushed: BTreeMap<String, u64>,
}
impl Collections {
    // Like the presence-copy census, collect from the entire alpha-renamed IR
    // before walking: a later assignment invalidates the initial size.
    pub(super) fn new(program: &Program) -> Self {
        type Scope = Vec<(usize, Option<u64>)>;
        #[derive(Default)]
        struct Census {
            definitions: BTreeMap<String, Expr>,
            scopes: BTreeMap<String, Scope>,
            pushes: BTreeMap<String, Vec<Scope>>,
            changed: BTreeSet<String>,
            next: usize,
        }
        fn repeated(value: &serde_json::Value, max: Option<u64>, scope: &mut Scope, census: &mut Census) {
            census.next += 1;
            scope.push((census.next, max));
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
                    if let Some(name) = fields.get("Assign").and_then(|s| s.get("name")).and_then(|v| v.as_str()) { census.changed.insert(name.into()); }
                    if let Some(name) = fields.get("Push").and_then(|s| s.get("target")).and_then(|v| v.as_str()) {
                        census.pushes.entry(name.into()).or_default().push(scope.clone());
                    }
                    if let Some(loop_) = fields.get("For") {
                        let domain = &loop_["domain"];
                        walk(domain, scope, census);
                        let max = serde_json::from_value::<LoopDomain>(domain.clone()).ok().and_then(|domain| match domain {
                            LoopDomain::Page(scan) if scan.take != Bound::Meter => Some(scan.take.maximum()),
                            LoopDomain::LiteralRange { start, end_exclusive } => Some(end_exclusive.saturating_sub(start).max(0) as u64),
                            LoopDomain::DerivedArray { max, .. } | LoopDomain::ArgList { max, .. } => Some(u64::from(max)),
                            _ => None,
                        });
                        repeated(&loop_["body"], max, scope, census);
                        return;
                    }
                    for (kind, value) in fields {
                        // Filters, projections and lane setup can repeat without
                        // a statement loop. An escaping push is open work; a
                        // list initialized inside that scope starts afresh there.
                        if matches!(kind.as_str(), "Scan" | "Merge" | "Shape" | "Builtin") {
                            repeated(value, None, scope, census);
                        } else { walk(value, scope, census); }
                    }
                }
                serde_json::Value::Array(values) => for value in values { walk(value, scope, census); },
                _ => {}
            }
        }
        let mut census = Census::default();
        walk(&serde_json::to_value(&program.body).expect("serializable IR"), &mut Vec::new(), &mut census);
        let mut pushed = BTreeMap::new();
        // @ref LLP 3000.019#3.2 — shapes lower to [] plus pushes. Sum each
        // push's bounded iterations since initialization, multiplying nested
        // loops. Assignments and any open push keep the step-ceiling fallback.
        for (name, scopes) in &census.pushes {
            let bound = census.scopes.get(name).and_then(|initial| scopes.iter().try_fold(0u64, |sum, scope| {
                if !scope.starts_with(initial) { return None; }
                let times = scope[initial.len()..].iter().try_fold(1u64, |times, (_, max)| Some(times.saturating_mul((*max)?)))?;
                Some(sum.saturating_add(times))
            }));
            if let Some(bound) = bound.filter(|_| matches!(census.definitions.get(name), Some(Expr::Array(values)) if values.is_empty())) {
                pushed.insert(name.clone(), bound);
            } else { census.changed.insert(name.clone()); }
        }
        census.definitions.retain(|name, _| !census.changed.contains(name));
        pushed.retain(|name, _| !census.changed.contains(name));
        Self { definitions: census.definitions, pushed }
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
                let bound = if let Some(max) = self.pushed.get(name) { Some(*max) }
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
    match ty { ArgType::List { max, .. } => Some(u64::from(*max)), ArgType::Optional(inner) => list_bound(inner), _ => None }
}
