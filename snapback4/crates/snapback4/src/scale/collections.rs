//! Structural lengths of immutable page/list bindings used by scalar folds.
use super::*;

#[derive(Default)]
pub(super) struct Collections(BTreeMap<String, Expr>);
impl Collections {
    // Like the presence-copy census, collect from the entire alpha-renamed IR
    // before walking: a later assignment or push invalidates the initial size.
    pub(super) fn new(program: &Program) -> Self {
        fn walk(value: &serde_json::Value, definitions: &mut BTreeMap<String, Expr>, changed: &mut BTreeSet<String>) {
            match value {
                serde_json::Value::Object(fields) => {
                    for kind in ["Let", "Const"] {
                        if let Some(binding) = fields.get(kind)
                            && let Some(name) = binding.get("name").and_then(|v| v.as_str())
                            && let Some(value) = binding.get("value")
                            && let Ok(expr) = serde_json::from_value(value.clone())
                            && definitions.insert(name.into(), expr).is_some() { changed.insert(name.into()); }
                    }
                    for (kind, target) in [("Assign", "name"), ("Push", "target")] {
                        if let Some(name) = fields.get(kind).and_then(|s| s.get(target)).and_then(|v| v.as_str()) { changed.insert(name.into()); }
                    }
                    for value in fields.values() { walk(value, definitions, changed); }
                }
                serde_json::Value::Array(values) => for value in values { walk(value, definitions, changed); },
                _ => {}
            }
        }
        let mut result = Self::default();
        let mut changed = BTreeSet::new();
        walk(&serde_json::to_value(&program.body).expect("serializable IR"), &mut result.0, &mut changed);
        result.0.retain(|name, _| !changed.contains(name));
        result
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
                let bound = if let Some(value) = self.0.get(name) { self.value(value, program, meter, seen) }
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
