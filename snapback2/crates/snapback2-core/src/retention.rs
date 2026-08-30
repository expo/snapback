use crate::certificate::declared_serialized_row_max;
use crate::ir::{Builtin, Expr, LoopDomain, Program, Scan, Stmt};
use crate::schema::Schema;
use crate::value::Value;
use std::collections::BTreeMap;

const CLOSURE_METADATA_BYTES: u64 = 64;

#[derive(Clone, Default)]
struct Flow {
    rows: BTreeMap<String, RowFlow>,
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
            depends_on_scan: true,
        }
    }

    fn add(mut self, other: Self) -> Self {
        for (site, incoming) in other.rows {
            self.rows
                .entry(site)
                .and_modify(|current| current.count = current.count.saturating_add(incoming.count))
                .or_insert(incoming);
        }
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
        self.depends_on_scan |= other.depends_on_scan;
        self
    }

    fn scale(mut self, factor: u64) -> Self {
        for row in self.rows.values_mut() {
            row.count = row.count.saturating_mul(factor);
        }
        self
    }

    fn growth_over(mut self, current: &Self) -> Self {
        for (site, retained) in &current.rows {
            if let Some(incoming) = self.rows.get_mut(site) {
                incoming.count = incoming.count.saturating_sub(retained.count);
            }
        }
        self.rows.retain(|_, row| row.count > 0);
        self
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
        self
    }

    fn fixed_width(self) -> Self {
        Self {
            rows: BTreeMap::new(),
            depends_on_scan: self.depends_on_scan,
        }
    }

    fn held_bytes(&self) -> u64 {
        self.rows.values().fold(0, |total, row| {
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
    loop_varying: bool,
}

pub(crate) struct RetentionEstimator<'a> {
    schema: &'a Schema,
    max_held_bytes: u64,
    has_fixed_width_result: bool,
}

impl<'a> RetentionEstimator<'a> {
    pub(crate) fn estimate(schema: &'a Schema, program: &Program) -> u64 {
        let mut estimator = Self {
            schema,
            max_held_bytes: 0,
            has_fixed_width_result: false,
        };
        let mut variables = BTreeMap::new();
        estimator.statements(&program.body, &mut variables, 1);
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
    ) {
        for statement in statements {
            match statement {
                Stmt::Const { name, value } | Stmt::Let { name, value } => {
                    let (flow, collection_len, held_collection) = self.expression(value, variables);
                    let loop_varying = Self::expression_is_loop_varying(value, variables, None);
                    variables.insert(
                        name.clone(),
                        Binding {
                            flow,
                            instances: calls,
                            collection_len,
                            held_collection,
                            loop_varying,
                        },
                    );
                    self.record_held_collections(variables);
                }
                Stmt::Assign { name, value } => {
                    let (flow, collection_len, held_collection) = self.expression(value, variables);
                    let loop_varying =
                        Self::expression_is_loop_varying(value, variables, Some(name));
                    let collection = collection_len.is_some() || held_collection;
                    let growth = collection
                        && variables.contains_key(name)
                        && expression_references_matching(value, &mut |variable| variable == name)
                        && loop_varying;
                    if growth {
                        let current = variables.get_mut(name).expect("growth target exists");
                        let repetitions = calls
                            .saturating_add(current.instances.saturating_sub(1))
                            .saturating_div(current.instances.max(1));
                        let added = flow.growth_over(&current.flow).scale(repetitions);
                        current.flow = current.flow.clone().add(added);
                        current.collection_len = current.collection_len.zip(collection_len).map(
                            |(current_len, assigned_len)| {
                                current_len.saturating_add(
                                    assigned_len
                                        .saturating_sub(current_len)
                                        .saturating_mul(repetitions),
                                )
                            },
                        );
                        current.held_collection = true;
                        current.loop_varying |= loop_varying;
                    } else {
                        variables.insert(
                            name.clone(),
                            Binding {
                                flow,
                                instances: calls,
                                collection_len,
                                held_collection,
                                loop_varying,
                            },
                        );
                    }
                    self.record_held_collections(variables);
                }
                Stmt::Push { target, value } => {
                    let (element, _, _) = self.expression(value, variables);
                    let loop_varying =
                        Self::expression_is_loop_varying(value, variables, Some(target));
                    let current = variables.entry(target.clone()).or_insert(Binding {
                        flow: Flow::default(),
                        instances: calls,
                        collection_len: Some(0),
                        held_collection: true,
                        loop_varying: false,
                    });
                    let repetitions = calls
                        .saturating_add(current.instances.saturating_sub(1))
                        .saturating_div(current.instances.max(1));
                    current.flow = current.flow.clone().add(element.scale(repetitions));
                    current.collection_len = current
                        .collection_len
                        .map(|length| length.saturating_add(repetitions));
                    current.held_collection = true;
                    current.loop_varying |= loop_varying;
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
                    self.statements(then_body, &mut then_variables, calls);
                    self.statements(else_body, &mut else_variables, calls);
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
                    nested.insert(
                        binding.clone(),
                        Binding {
                            flow: element,
                            instances: nested_calls,
                            collection_len: None,
                            held_collection: false,
                            loop_varying: true,
                        },
                    );
                    self.statements(body, &mut nested, nested_calls);
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
                Flow::default(),
            ),
            LoopDomain::ArgList { max, .. } => (u64::from(*max), Flow::default()),
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
            Expr::Literal(_) | Expr::Input(_) => (Flow::default(), None, false),
        }
    }

    fn scan(&self, scan: &Scan) -> Flow {
        Flow::row(
            &scan.site,
            declared_serialized_row_max(self.schema, &scan.table),
            scan.take.maximum(),
        )
    }

    fn expression_is_loop_varying(
        expression: &Expr,
        variables: &BTreeMap<String, Binding>,
        excluded: Option<&String>,
    ) -> bool {
        expression_references_matching(expression, &mut |name| {
            excluded.is_none_or(|excluded| name != excluded)
                && variables
                    .get(name)
                    .is_some_and(|binding| binding.loop_varying)
        })
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
                    current.loop_varying |= incoming.loop_varying;
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

fn literal_index(expression: Option<&Expr>) -> Option<u64> {
    match expression {
        Some(Expr::Literal(Value::Int(value))) => u64::try_from(*value).ok(),
        _ => None,
    }
}

pub(crate) fn expression_references_matching(
    expression: &Expr,
    predicate: &mut impl FnMut(&str) -> bool,
) -> bool {
    match expression {
        Expr::Variable(name) => predicate(name),
        Expr::Field { base, .. } | Expr::Unary { value: base, .. } => {
            expression_references_matching(base, predicate)
        }
        Expr::Array(values) => values
            .iter()
            .any(|value| expression_references_matching(value, predicate)),
        Expr::Object(values) => values
            .values()
            .any(|value| expression_references_matching(value, predicate)),
        Expr::Binary { left, right, .. } => {
            expression_references_matching(left, predicate)
                || expression_references_matching(right, predicate)
        }
        Expr::Builtin { args, .. } => args
            .iter()
            .any(|value| expression_references_matching(value, predicate)),
        Expr::Get(read) | Expr::Exists(read) => read
            .key
            .iter()
            .any(|value| expression_references_matching(value, predicate)),
        Expr::Scan(scan) => {
            scan.prefix
                .iter()
                .any(|value| expression_references_matching(value, predicate))
                || scan
                    .after
                    .as_deref()
                    .is_some_and(|value| expression_references_matching(value, predicate))
                || scan
                    .before
                    .as_deref()
                    .is_some_and(|value| expression_references_matching(value, predicate))
                || scan.range.as_ref().is_some_and(|range| {
                    [
                        range.gt.as_deref(),
                        range.gte.as_deref(),
                        range.lt.as_deref(),
                        range.lte.as_deref(),
                    ]
                    .into_iter()
                    .flatten()
                    .any(|value| expression_references_matching(value, predicate))
                })
        }
        Expr::Literal(_) | Expr::Input(_) => false,
    }
}
