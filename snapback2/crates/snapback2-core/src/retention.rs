use crate::certificate::declared_serialized_row_max;
use crate::growth::{
    CollectionBinding, assignment_growth, expression_from as collection_expression_from,
    saturating_power, take_identity,
};
use crate::ir::{ArgType, Builtin, Expr, Input, LoopDomain, Program, Scan, Stmt};
use crate::schema::Schema;
use crate::value::Value;
use std::collections::BTreeMap;

const CLOSURE_METADATA_BYTES: u64 = 64;

#[derive(Clone, Default)]
struct Flow {
    rows: BTreeMap<String, RowFlow>,
    value_bytes: u64,
    retained_value_bytes: u64,
    depends_on_scan: bool,
}

#[derive(Clone)]
struct RowFlow {
    count: u64,
    bytes: u64,
}

impl Flow {
    fn row(site: &str, bytes: u64, count: u64) -> Self {
        Self {
            rows: BTreeMap::from([(site.to_owned(), RowFlow { count, bytes })]),
            value_bytes: 0,
            retained_value_bytes: 0,
            depends_on_scan: true,
        }
    }

    fn value(bytes: u64) -> Self {
        Self {
            value_bytes: bytes,
            ..Self::default()
        }
    }

    fn add(mut self, other: Self) -> Self {
        for (site, incoming) in other.rows {
            self.rows
                .entry(site)
                .and_modify(|current| current.count = current.count.saturating_add(incoming.count))
                .or_insert(incoming);
        }
        self.value_bytes = self.value_bytes.saturating_add(other.value_bytes);
        self.retained_value_bytes = self
            .retained_value_bytes
            .saturating_add(other.retained_value_bytes);
        self.depends_on_scan |= other.depends_on_scan;
        self
    }

    fn branch(mut self, other: Self) -> Self {
        for (site, incoming) in other.rows {
            self.rows
                .entry(site)
                .and_modify(|current| current.count = current.count.max(incoming.count))
                .or_insert(incoming);
        }
        self.value_bytes = self.value_bytes.max(other.value_bytes);
        self.retained_value_bytes = self.retained_value_bytes.max(other.retained_value_bytes);
        self.depends_on_scan |= other.depends_on_scan;
        self
    }

    fn scale(mut self, factor: u64) -> Self {
        for row in self.rows.values_mut() {
            row.count = row.count.saturating_mul(factor);
        }
        self.value_bytes = self.value_bytes.saturating_mul(factor);
        self.retained_value_bytes = self.retained_value_bytes.saturating_mul(factor);
        self
    }

    fn growth_over(mut self, current: &Self, occurrences: u64) -> Self {
        for (site, retained) in &current.rows {
            if let Some(incoming) = self.rows.get_mut(site) {
                incoming.count = incoming
                    .count
                    .saturating_sub(retained.count.saturating_mul(occurrences));
            }
        }
        self.rows.retain(|_, row| row.count > 0);
        self.value_bytes = self
            .value_bytes
            .saturating_sub(current.value_bytes.saturating_mul(occurrences));
        self.retained_value_bytes = self
            .retained_value_bytes
            .saturating_sub(current.retained_value_bytes.saturating_mul(occurrences));
        self
    }

    fn retain_value_width(mut self) -> Self {
        self.retained_value_bytes = self.retained_value_bytes.max(self.value_bytes);
        self
    }

    fn has_growth_width(&self) -> bool {
        self.value_bytes > 0
            || self.retained_value_bytes > 0
            || self.rows.values().any(|row| row.count > 0)
    }

    fn take(mut self, count: u64, available: u64) -> Self {
        let retained = count.min(available);
        for row in self.rows.values_mut() {
            // A slice may select all of one source from a concatenated page, so
            // proportional division would underprice mixed-width sources.
            row.count = row.count.min(retained);
        }
        self
    }

    fn element(mut self, count: u64) -> Self {
        for row in self.rows.values_mut() {
            row.count = row
                .count
                .saturating_add(count.saturating_sub(1))
                .saturating_div(count.max(1));
        }
        self.value_bytes = self
            .value_bytes
            .saturating_add(count.saturating_sub(1))
            .saturating_div(count.max(1));
        self.retained_value_bytes = self
            .retained_value_bytes
            .saturating_add(count.saturating_sub(1))
            .saturating_div(count.max(1));
        self
    }

    fn fixed_width(self) -> Self {
        Self {
            rows: BTreeMap::new(),
            value_bytes: self.value_bytes,
            retained_value_bytes: self.retained_value_bytes,
            depends_on_scan: self.depends_on_scan,
        }
    }

    fn held_bytes(&self) -> u64 {
        self.rows
            .values()
            .fold(self.retained_value_bytes, |total, row| {
                total.saturating_add(row.count.saturating_mul(row.bytes))
            })
    }
}

#[derive(Clone, Default)]
struct Binding {
    flow: Flow,
    instances: u64,
    collection_len: Option<u64>,
    held_collection: bool,
    collection: CollectionBinding,
}

pub(crate) struct RetentionEstimator<'a> {
    schema: &'a Schema,
    max_held_bytes: u64,
    has_fixed_width_result: bool,
    next_identity: u64,
}

impl<'a> RetentionEstimator<'a> {
    pub(crate) fn estimate(schema: &'a Schema, program: &Program) -> u64 {
        let mut estimator = Self {
            schema,
            max_held_bytes: 0,
            has_fixed_width_result: false,
            next_identity: 1,
        };
        let mut variables = program
            .args
            .iter()
            .map(|(name, argument)| {
                let identity = take_identity(&mut estimator.next_identity);
                let collection = matches!(argument, ArgType::List { .. });
                (
                    name.clone(),
                    Binding {
                        flow: Flow::value(argument_max(argument)),
                        instances: 1,
                        collection_len: match argument {
                            ArgType::List { max, .. } => Some(u64::from(*max)),
                            _ => None,
                        },
                        held_collection: false,
                        collection: CollectionBinding::new(
                            identity,
                            crate::growth::CollectionExpression::argument(collection),
                        ),
                    },
                )
            })
            .collect();
        estimator.statements(&program.body, &mut variables, 1, 0);
        if estimator.max_held_bytes == 0 && estimator.has_fixed_width_result {
            CLOSURE_METADATA_BYTES
        } else {
            estimator.max_held_bytes
        }
    }

    // Retention is a data-flow property, not an expression-shape property. Scan
    // rows count only when the page (or a row derived from it) reaches Return or
    // is pushed into a collection that grows with the page. Binding a page and
    // using it only for Count/Sum/Len, or folding a For loop into fixed-width
    // scalars, therefore retains O(1) metadata rather than every examined row.
    fn statements(
        &mut self,
        statements: &[Stmt],
        variables: &mut BTreeMap<String, Binding>,
        calls: u64,
        iteration: u64,
    ) {
        for statement in statements {
            match statement {
                Stmt::Const { name, value } | Stmt::Let { name, value } => {
                    let (flow, collection_len, held_collection) = self.expression(value, variables);
                    let provenance = collection_expression_from(
                        value,
                        variables,
                        |binding| &binding.collection,
                        iteration,
                    );
                    let identity = take_identity(&mut self.next_identity);
                    variables.insert(
                        name.clone(),
                        Binding {
                            flow,
                            instances: calls,
                            collection_len,
                            held_collection,
                            collection: CollectionBinding::new(identity, provenance),
                        },
                    );
                    self.record_held_collections(variables);
                }
                Stmt::Assign { name, value } => {
                    let (flow, collection_len, held_collection) = self.expression(value, variables);
                    let provenance = collection_expression_from(
                        value,
                        variables,
                        |binding| &binding.collection,
                        iteration,
                    );
                    let growth = variables.get(name).and_then(|current| {
                        assignment_growth(
                            &current.collection,
                            &provenance,
                            calls,
                            current.instances,
                            iteration,
                        )
                    });
                    if let Some(growth) = growth {
                        let current = variables.get_mut(name).expect("growth target exists");
                        let mut added = flow.clone().growth_over(&current.flow, growth.occurrences);
                        if !added.has_growth_width() {
                            added = flow.clone();
                        }
                        current.flow = if growth.occurrences > 1 {
                            let factor = saturating_power(growth.occurrences, growth.repetitions);
                            current
                                .flow
                                .clone()
                                .scale(factor)
                                .add(added.retain_value_width().scale(factor))
                        } else if growth.occurrences == 1 {
                            current
                                .flow
                                .clone()
                                .add(added.retain_value_width().scale(growth.repetitions))
                        } else {
                            current
                                .flow
                                .clone()
                                .add(flow.clone().retain_value_width().scale(growth.repetitions))
                        };
                        current.collection_len = current.collection_len.zip(collection_len).map(
                            |(current_len, assigned_len)| {
                                current_len.saturating_add(
                                    assigned_len
                                        .saturating_sub(current_len)
                                        .saturating_mul(growth.repetitions),
                                )
                            },
                        );
                        current.held_collection = true;
                        current.collection = current.collection.assigned(provenance);
                    } else {
                        let identity = variables
                            .get(name)
                            .map(|binding| binding.collection.identity)
                            .unwrap_or_else(|| take_identity(&mut self.next_identity));
                        let collection = variables
                            .get(name)
                            .map(|binding| binding.collection.assigned(provenance.clone()))
                            .unwrap_or_else(|| CollectionBinding::new(identity, provenance));
                        variables.insert(
                            name.clone(),
                            Binding {
                                flow,
                                instances: calls,
                                collection_len,
                                held_collection,
                                collection,
                            },
                        );
                    }
                    self.record_held_collections(variables);
                }
                Stmt::Push { target, value } => {
                    let (element, _, _) = self.expression(value, variables);
                    let current = variables.entry(target.clone()).or_insert(Binding {
                        flow: Flow::default(),
                        instances: calls,
                        collection_len: Some(0),
                        held_collection: true,
                        collection: CollectionBinding::new(
                            take_identity(&mut self.next_identity),
                            crate::growth::CollectionExpression::iteration(true, iteration),
                        ),
                    });
                    let repetitions = calls
                        .saturating_add(current.instances.saturating_sub(1))
                        .saturating_div(current.instances.max(1));
                    current.flow = current.flow.clone().add(element.scale(repetitions));
                    current.collection_len = current
                        .collection_len
                        .map(|length| length.saturating_add(repetitions));
                    current.held_collection = true;
                    self.record_held_collections(variables);
                }
                Stmt::If {
                    condition,
                    then_body,
                    else_body,
                } => {
                    let _ = self.expression(condition, variables);
                    let mut then_variables = variables.clone();
                    let mut else_variables = variables.clone();
                    self.statements(then_body, &mut then_variables, calls, iteration);
                    self.statements(else_body, &mut else_variables, calls, iteration);
                    Self::merge_variables(variables, then_variables);
                    Self::merge_variables(variables, else_variables);
                }
                Stmt::For {
                    binding,
                    domain,
                    body,
                } => {
                    let (bound, element) = self.domain(domain, variables);
                    let mut nested = variables.clone();
                    let nested_calls = calls.saturating_mul(bound);
                    let nested_iteration = take_identity(&mut self.next_identity);
                    nested.insert(
                        binding.clone(),
                        Binding {
                            flow: element,
                            instances: nested_calls,
                            collection_len: None,
                            held_collection: false,
                            collection: CollectionBinding::new(
                                take_identity(&mut self.next_identity),
                                crate::growth::CollectionExpression::iteration(
                                    matches!(domain, LoopDomain::Page(_) | LoopDomain::Recurse(_)),
                                    nested_iteration,
                                ),
                            ),
                        },
                    );
                    self.statements(body, &mut nested, nested_calls, nested_iteration);
                    nested.remove(binding);
                    Self::merge_variables(variables, nested);
                }
                Stmt::Return(value) => {
                    let (flow, _, _) = self.expression(value, variables);
                    let held = flow.held_bytes();
                    self.max_held_bytes = self.max_held_bytes.max(held);
                    self.has_fixed_width_result |= held == 0 && flow.depends_on_scan;
                }
                Stmt::Require { condition, .. } => {
                    let _ = self.expression(condition, variables);
                }
                Stmt::Insert { row, .. } => {
                    let _ = self.expression(row, variables);
                }
                Stmt::Update { key, patch, .. } => {
                    let _ = self.expression(key, variables);
                    let _ = self.expression(patch, variables);
                }
                Stmt::Upsert { key, row, .. } => {
                    let _ = self.expression(key, variables);
                    let _ = self.expression(row, variables);
                }
                Stmt::Delete { key, .. } => {
                    let _ = self.expression(key, variables);
                }
                Stmt::Emit { payload, .. } => {
                    let _ = self.expression(payload, variables);
                }
                Stmt::Break | Stmt::Continue => {}
            }
        }
    }

    fn domain(&self, domain: &LoopDomain, variables: &BTreeMap<String, Binding>) -> (u64, Flow) {
        match domain {
            LoopDomain::Page(scan) => {
                let bound = scan.take.maximum();
                (bound, self.scan(scan).element(bound))
            }
            LoopDomain::LiteralRange {
                start,
                end_exclusive,
            } => (
                end_exclusive.saturating_sub(*start).max(0) as u64,
                Flow::value(32),
            ),
            LoopDomain::ArgList { name, max } => (
                u64::from(*max),
                variables
                    .get(name)
                    .map(|binding| binding.flow.clone().element(u64::from(*max)))
                    .unwrap_or_else(|| Flow::value(1024)),
            ),
            LoopDomain::DerivedArray { value, max, .. } => {
                let (flow, collection_len, _) = self.expression(value, variables);
                let bound = u64::from(*max);
                (bound, flow.element(collection_len.unwrap_or(bound)))
            }
            LoopDomain::Recurse(recurse) => {
                let mut nodes = 0_u64;
                let mut level = 1_u64;
                for _ in 0..=recurse.depth {
                    nodes = nodes.saturating_add(level);
                    level = level.saturating_mul(u64::from(recurse.fanout));
                }
                (
                    nodes,
                    Flow::row(
                        &recurse.site,
                        declared_serialized_row_max(self.schema, &recurse.table),
                        1,
                    ),
                )
            }
        }
    }

    fn expression(
        &self,
        expression: &Expr,
        variables: &BTreeMap<String, Binding>,
    ) -> (Flow, Option<u64>, bool) {
        match expression {
            Expr::Variable(name) => variables
                .get(name)
                .map(|binding| {
                    (
                        binding.flow.clone(),
                        binding.collection_len,
                        binding.held_collection,
                    )
                })
                .unwrap_or_default(),
            Expr::Field { base, .. } => {
                let (flow, _, _) = self.expression(base, variables);
                (flow, None, false)
            }
            Expr::Array(values) => {
                let flow = values.iter().fold(Flow::default(), |flow, value| {
                    flow.add(self.expression(value, variables).0)
                });
                (flow, Some(values.len() as u64), false)
            }
            Expr::Object(values) => {
                let flow = values.values().fold(Flow::default(), |flow, value| {
                    flow.add(self.expression(value, variables).0)
                });
                (flow, None, false)
            }
            Expr::Binary { left, right, .. } => {
                let flow = self
                    .expression(left, variables)
                    .0
                    .add(self.expression(right, variables).0)
                    .fixed_width();
                (flow, None, false)
            }
            Expr::Unary { value, .. } => (
                self.expression(value, variables).0.fixed_width(),
                None,
                false,
            ),
            Expr::Builtin { builtin, args } => {
                let mut flows = args
                    .iter()
                    .map(|argument| self.expression(argument, variables));
                let first = flows.next().unwrap_or_default();
                match builtin {
                    Builtin::Slice => {
                        let start = literal_index(args.get(1)).unwrap_or(0);
                        let end = literal_index(args.get(2)).unwrap_or(first.1.unwrap_or(u64::MAX));
                        let count = end.saturating_sub(start);
                        let available = first.1.unwrap_or(count);
                        (
                            first.0.take(count, available),
                            Some(count.min(available)),
                            true,
                        )
                    }
                    Builtin::Sort { .. } => (first.0, first.1, true),
                    Builtin::Concat => {
                        let (flow, length) = flows.fold(
                            (first.0, first.1),
                            |(flow, length), (next, next_len, _)| {
                                (
                                    flow.add(next),
                                    length
                                        .zip(next_len)
                                        .map(|(left, right)| left.saturating_add(right)),
                                )
                            },
                        );
                        (flow, length, true)
                    }
                    Builtin::Len
                    | Builtin::Min
                    | Builtin::Max
                    | Builtin::Divmod { .. }
                    | Builtin::MentionTokens
                    | Builtin::DeterministicShare
                    | Builtin::Count
                    | Builtin::Sum
                    | Builtin::CountCapped => {
                        let flow = flows.fold(first.0, |flow, (next, _, _)| flow.add(next));
                        (flow.fixed_width(), None, false)
                    }
                }
            }
            Expr::Get(read) => (
                Flow::row(
                    &read.site,
                    declared_serialized_row_max(self.schema, &read.table),
                    1,
                ),
                None,
                false,
            ),
            Expr::Exists(read) => (
                Flow::row(
                    &read.site,
                    declared_serialized_row_max(self.schema, &read.table),
                    1,
                )
                .fixed_width(),
                None,
                false,
            ),
            Expr::Scan(scan) => {
                let count = scan.take.maximum();
                (self.scan(scan), Some(count), false)
            }
            Expr::Literal(value) => {
                let collection_len = match value {
                    Value::Array(values) => Some(values.len() as u64),
                    _ => None,
                };
                (
                    Flow::value(crate::value::canonical_json(value).len() as u64),
                    collection_len,
                    false,
                )
            }
            Expr::Input(input) => (
                Flow::value(match input {
                    Input::Viewer | Input::NewId => 144,
                    Input::Now | Input::ReadTime => 32,
                }),
                None,
                false,
            ),
        }
    }

    fn scan(&self, scan: &Scan) -> Flow {
        Flow::row(
            &scan.site,
            declared_serialized_row_max(self.schema, &scan.table),
            scan.take.maximum(),
        )
    }

    fn merge_variables(
        variables: &mut BTreeMap<String, Binding>,
        branch: BTreeMap<String, Binding>,
    ) {
        for (name, incoming) in branch {
            variables
                .entry(name)
                .and_modify(|current| {
                    current.flow = current.flow.clone().branch(incoming.flow.clone());
                    current.instances = current.instances.min(incoming.instances);
                    current.collection_len = match (current.collection_len, incoming.collection_len)
                    {
                        (Some(left), Some(right)) => Some(left.max(right)),
                        _ => None,
                    };
                    current.held_collection |= incoming.held_collection;
                    current.collection.merge(&incoming.collection);
                })
                .or_insert(incoming);
        }
    }

    fn record_held_collections(&mut self, variables: &BTreeMap<String, Binding>) {
        let held = variables
            .values()
            .filter(|binding| binding.held_collection)
            .fold(0_u64, |total, binding| {
                total.saturating_add(binding.flow.held_bytes())
            });
        self.max_held_bytes = self.max_held_bytes.max(held);
    }
}

pub(crate) fn argument_max(argument: &ArgType) -> u64 {
    match argument {
        ArgType::Id | ArgType::Ref { .. } => 144,
        ArgType::Text { max } | ArgType::Json { max_bytes: max } => u64::from(*max) + 16,
        ArgType::Int | ArgType::Time | ArgType::Decimal { .. } | ArgType::Money { .. } => 32,
        ArgType::Bool => 16,
        ArgType::Optional(inner) => argument_max(inner).max(8),
        ArgType::Scalar => 1024,
        ArgType::List { of, max } => 2_u64.saturating_add(
            u64::from(*max)
                .saturating_mul(of.as_deref().map_or(1024, argument_max).saturating_add(1)),
        ),
        ArgType::Enum { variants } => variants
            .iter()
            .map(|variant| variant.len() as u64 + 16)
            .max()
            .unwrap_or(16),
    }
}

pub(crate) fn collection_bytes(values: impl Iterator<Item = u64>) -> u64 {
    values.fold(2_u64, |size, value| {
        size.saturating_add(value).saturating_add(1)
    })
}

fn literal_index(expression: Option<&Expr>) -> Option<u64> {
    match expression {
        Some(Expr::Literal(Value::Int(value))) => u64::try_from(*value).ok(),
        _ => None,
    }
}
