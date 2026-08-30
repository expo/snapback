use crate::ir::{Builtin, Expr};
use crate::value::Value;
use std::collections::BTreeMap;

#[derive(Clone, Default)]
pub(crate) struct ProvenanceBinding {
    pub(crate) identity: u64,
    origins: BTreeMap<u64, u64>,
    constructed_at: Option<u64>,
}

#[derive(Clone, Default)]
pub(crate) struct ProvenanceExpression {
    origins: BTreeMap<u64, u64>,
    constructed_at: Option<u64>,
}

#[derive(Clone, Copy)]
pub(crate) struct Growth {
    pub(crate) occurrences: u64,
    pub(crate) repetitions: u64,
}

pub(crate) struct AssignmentGrowth<P> {
    provenance: ProvenanceExpression,
    growth: Option<Growth>,
    price: P,
}

impl<P> AssignmentGrowth<P> {
    pub(crate) fn into_parts(self) -> (ProvenanceExpression, Option<Growth>, P) {
        (self.provenance, self.growth, self.price)
    }
}

impl ProvenanceExpression {
    pub(crate) fn argument() -> Self {
        Self::default()
    }

    pub(crate) fn iteration(constructed: bool, iteration: u64) -> Self {
        Self {
            constructed_at: constructed.then_some(iteration),
            ..Self::default()
        }
    }

    pub(crate) fn references(&self, identity: u64) -> bool {
        self.origins.get(&identity).is_some_and(|count| *count > 0)
    }
}

impl ProvenanceBinding {
    pub(crate) fn new(identity: u64, expression: ProvenanceExpression) -> Self {
        Self {
            identity,
            origins: expression.origins,
            constructed_at: expression.constructed_at,
        }
    }

    pub(crate) fn assigned(&self, expression: ProvenanceExpression) -> Self {
        let mut next = Self::new(self.identity, expression);
        // The stable identity now denotes the assigned value, not an older
        // version already accounted for in that value's retained width.
        next.origins.remove(&self.identity);
        next
    }

    pub(crate) fn merge(&mut self, incoming: &Self) {
        if self.identity != incoming.identity {
            add_origin(&mut self.origins, incoming.identity, 1);
        }
        merge_origins(&mut self.origins, &incoming.origins, u64::max);
        if self.constructed_at != incoming.constructed_at {
            self.constructed_at = None;
        }
    }
}

// Default-deny: walk every assignment before pricing can inspect static value
// classification. Freshness requires a value constructed in this iteration
// and no structural path back to the binding's prior value; origins are
// followed through temporaries, helper arguments after lowering, every
// constructor argument, and nested arrays/objects. The pricing closure runs
// only after that decision, so scalar/collection classification can refine
// width without becoming a pre-provenance gate.
pub(crate) fn assignment_growth<T, P>(
    target: Option<&ProvenanceBinding>,
    value: &Expr,
    variables: &BTreeMap<String, T>,
    binding: fn(&T) -> &ProvenanceBinding,
    calls: u64,
    instances: u64,
    iteration: u64,
    price: impl FnOnce() -> P,
) -> AssignmentGrowth<P> {
    let provenance = expression_from(value, variables, binding, iteration);
    let occurrences = target
        .and_then(|target| provenance.origins.get(&target.identity))
        .copied()
        .unwrap_or(0);
    let proven_fresh = provenance.constructed_at == Some(iteration) && occurrences == 0;
    let growth = target.and_then(|_| {
        (!proven_fresh).then_some(Growth {
            occurrences,
            repetitions: calls
                .saturating_add(instances.saturating_sub(1))
                .saturating_div(instances.max(1)),
        })
    });
    let price = price();
    AssignmentGrowth {
        provenance,
        growth,
        price,
    }
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
    binding: fn(&T) -> &ProvenanceBinding,
    iteration: u64,
) -> ProvenanceExpression {
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
    variables: &BTreeMap<String, ProvenanceBinding>,
    iteration: u64,
) -> ProvenanceExpression {
    match value {
        Expr::Variable(name) => {
            variables
                .get(name)
                .map_or_else(ProvenanceExpression::default, |binding| {
                    let mut origins = binding.origins.clone();
                    add_origin(&mut origins, binding.identity, 1);
                    ProvenanceExpression {
                        origins,
                        constructed_at: binding.constructed_at,
                    }
                })
        }
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => {
            let mut provenance = expression(base, variables, iteration);
            provenance.constructed_at = None;
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
        Expr::Literal(value) => ProvenanceExpression {
            origins: BTreeMap::new(),
            constructed_at: matches!(value, Value::Array(_) | Value::Row(_) | Value::Map(_))
                .then_some(iteration),
        },
        Expr::Input(_) => ProvenanceExpression::default(),
    }
}

fn constructed(
    expressions: impl IntoIterator<Item = ProvenanceExpression>,
    calls: u64,
) -> ProvenanceExpression {
    let mut provenance = combined(expressions);
    provenance.constructed_at = Some(calls);
    provenance
}

fn combined(expressions: impl IntoIterator<Item = ProvenanceExpression>) -> ProvenanceExpression {
    expressions.into_iter().fold(
        ProvenanceExpression::default(),
        |mut combined, expression| {
            merge_origins(
                &mut combined.origins,
                &expression.origins,
                u64::saturating_add,
            );
            combined
        },
    )
}

// This classifier is deliberately separate from provenance and is intended
// only for a pricing closure passed to `assignment_growth`.
pub(crate) fn collection_price_from<T>(
    value: &Expr,
    variables: &BTreeMap<String, T>,
    collection: fn(&T) -> bool,
) -> bool {
    match value {
        Expr::Variable(name) => variables.get(name).is_some_and(collection),
        Expr::Array(_) | Expr::Object(_) | Expr::Get(_) | Expr::Scan(_) => true,
        Expr::Builtin { builtin, .. } => matches!(
            builtin,
            Builtin::Slice | Builtin::Sort { .. } | Builtin::Concat
        ),
        Expr::Literal(value) => matches!(value, Value::Array(_) | Value::Row(_) | Value::Map(_)),
        Expr::Field { .. }
        | Expr::Binary { .. }
        | Expr::Unary { .. }
        | Expr::Exists(_)
        | Expr::Input(_) => false,
    }
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
