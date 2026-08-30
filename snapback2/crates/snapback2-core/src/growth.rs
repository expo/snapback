use crate::ir::{Builtin, Expr};
use crate::value::Value;
use std::collections::BTreeMap;

#[derive(Clone, Default)]
pub(crate) struct CollectionBinding {
    pub(crate) identity: u64,
    origins: BTreeMap<u64, u64>,
    constructed_at: Option<u64>,
    pub(crate) collection: bool,
}

#[derive(Clone, Default)]
pub(crate) struct CollectionExpression {
    origins: BTreeMap<u64, u64>,
    constructed_at: Option<u64>,
    collection: bool,
}

#[derive(Clone, Copy)]
pub(crate) struct Growth {
    pub(crate) occurrences: u64,
    pub(crate) repetitions: u64,
}

impl CollectionExpression {
    pub(crate) fn argument(collection: bool) -> Self {
        Self {
            collection,
            ..Self::default()
        }
    }

    pub(crate) fn iteration(collection: bool, iteration: u64) -> Self {
        Self {
            constructed_at: Some(iteration),
            collection,
            ..Self::default()
        }
    }

    pub(crate) fn references(&self, identity: u64) -> bool {
        self.origins.get(&identity).is_some_and(|count| *count > 0)
    }
}

impl CollectionBinding {
    pub(crate) fn new(identity: u64, expression: CollectionExpression) -> Self {
        Self {
            identity,
            origins: expression.origins,
            constructed_at: expression.constructed_at,
            collection: expression.collection,
        }
    }

    pub(crate) fn assigned(&self, expression: CollectionExpression) -> Self {
        let mut next = Self::new(self.identity, expression);
        // The stable identity now denotes the assigned value, not an older
        // version already accounted for in that value's retained width.
        next.origins.remove(&self.identity);
        next.collection |= self.collection;
        next
    }

    pub(crate) fn merge(&mut self, incoming: &Self) {
        if self.identity != incoming.identity && incoming.collection {
            add_origin(&mut self.origins, incoming.identity, 1);
        }
        merge_origins(&mut self.origins, &incoming.origins, u64::max);
        if self.constructed_at != incoming.constructed_at {
            self.constructed_at = None;
        }
        self.collection |= incoming.collection;
    }
}

// Default-deny: a collection assignment inside a loop is growth unless the
// analysis proves freshness. Freshness requires a collection constructed in
// this iteration and no dataflow path back to the binding's prior value;
// origins are followed through temporaries, helper arguments after lowering,
// every argument of a collection constructor, and nested arrays/objects.
pub(crate) fn assignment_growth(
    target: &CollectionBinding,
    expression: &CollectionExpression,
    calls: u64,
    instances: u64,
    iteration: u64,
) -> Option<Growth> {
    if !target.collection {
        return None;
    }
    let occurrences = expression
        .origins
        .get(&target.identity)
        .copied()
        .unwrap_or(0);
    if expression.collection && expression.constructed_at == Some(iteration) && occurrences == 0 {
        return None;
    }
    Some(Growth {
        occurrences,
        repetitions: calls
            .saturating_add(instances.saturating_sub(1))
            .saturating_div(instances.max(1)),
    })
}

pub(crate) fn saturating_power(mut base: u64, mut exponent: u64) -> u64 {
    let mut value = 1_u64;
    while exponent > 0 {
        if exponent & 1 == 1 {
            value = value.saturating_mul(base);
        }
        exponent >>= 1;
        base = base.saturating_mul(base);
    }
    value
}

pub(crate) fn expression_from<T>(
    value: &Expr,
    variables: &BTreeMap<String, T>,
    binding: fn(&T) -> &CollectionBinding,
    iteration: u64,
) -> CollectionExpression {
    let collections = variables
        .iter()
        .map(|(name, value)| (name.clone(), binding(value).clone()))
        .collect();
    expression(value, &collections, iteration)
}

pub(crate) fn take_identity(next: &mut u64) -> u64 {
    let identity = *next;
    *next = next.saturating_add(1);
    identity
}

pub(crate) fn expression(
    value: &Expr,
    variables: &BTreeMap<String, CollectionBinding>,
    iteration: u64,
) -> CollectionExpression {
    match value {
        Expr::Variable(name) => {
            variables
                .get(name)
                .map_or_else(CollectionExpression::default, |binding| {
                    let mut origins = binding.origins.clone();
                    if binding.collection {
                        add_origin(&mut origins, binding.identity, 1);
                    }
                    CollectionExpression {
                        origins,
                        constructed_at: binding.constructed_at,
                        collection: binding.collection,
                    }
                })
        }
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => {
            let mut provenance = expression(base, variables, iteration);
            provenance.collection = false;
            provenance
        }
        Expr::Array(values) => constructed(
            values
                .iter()
                .map(|value| expression(value, variables, iteration)),
            iteration,
        ),
        Expr::Object(values) => constructed(
            values
                .values()
                .map(|value| expression(value, variables, iteration)),
            iteration,
        ),
        Expr::Binary { left, right, .. } => combined([
            expression(left, variables, iteration),
            expression(right, variables, iteration),
        ]),
        Expr::Builtin { builtin, args } => {
            let mut provenance = combined(
                args.iter()
                    .map(|argument| expression(argument, variables, iteration)),
            );
            if matches!(
                builtin,
                Builtin::Slice | Builtin::Sort { .. } | Builtin::Concat
            ) {
                provenance.constructed_at = Some(iteration);
                provenance.collection = true;
            }
            provenance
        }
        Expr::Get(read) => {
            let mut provenance = combined(
                read.key
                    .iter()
                    .map(|argument| expression(argument, variables, iteration)),
            );
            provenance.constructed_at = Some(iteration);
            provenance.collection = true;
            provenance
        }
        Expr::Exists(read) => combined(
            read.key
                .iter()
                .map(|argument| expression(argument, variables, iteration)),
        ),
        Expr::Scan(scan) => {
            let mut inputs = Vec::new();
            inputs.extend(scan.prefix.iter());
            inputs.extend(scan.after.as_deref());
            inputs.extend(scan.before.as_deref());
            if let Some(range) = &scan.range {
                inputs.extend(range.gt.as_deref());
                inputs.extend(range.gte.as_deref());
                inputs.extend(range.lt.as_deref());
                inputs.extend(range.lte.as_deref());
            }
            constructed(
                inputs
                    .into_iter()
                    .map(|argument| expression(argument, variables, iteration)),
                iteration,
            )
        }
        Expr::Literal(value) => CollectionExpression {
            origins: BTreeMap::new(),
            constructed_at: matches!(value, Value::Array(_) | Value::Row(_) | Value::Map(_))
                .then_some(iteration),
            collection: matches!(value, Value::Array(_) | Value::Row(_) | Value::Map(_)),
        },
        Expr::Input(_) => CollectionExpression::default(),
    }
}

fn constructed(
    expressions: impl IntoIterator<Item = CollectionExpression>,
    calls: u64,
) -> CollectionExpression {
    let mut provenance = combined(expressions);
    provenance.constructed_at = Some(calls);
    provenance.collection = true;
    provenance
}

fn combined(expressions: impl IntoIterator<Item = CollectionExpression>) -> CollectionExpression {
    expressions.into_iter().fold(
        CollectionExpression::default(),
        |mut combined, expression| {
            merge_origins(
                &mut combined.origins,
                &expression.origins,
                u64::saturating_add,
            );
            combined.collection |= expression.collection;
            combined
        },
    )
}

fn add_origin(origins: &mut BTreeMap<u64, u64>, identity: u64, count: u64) {
    origins
        .entry(identity)
        .and_modify(|current| *current = current.saturating_add(count))
        .or_insert(count);
}

fn merge_origins(
    target: &mut BTreeMap<u64, u64>,
    incoming: &BTreeMap<u64, u64>,
    merge: impl Fn(u64, u64) -> u64,
) {
    for (&identity, &count) in incoming {
        target
            .entry(identity)
            .and_modify(|current| *current = merge(*current, count))
            .or_insert(count);
    }
}
