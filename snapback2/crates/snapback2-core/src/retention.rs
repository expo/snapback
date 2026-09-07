use crate::bounds::{
    CANONICAL_ARRAY_BASE_BYTES, declared_asset_record_max, declared_serialized_column_max,
    declared_serialized_row_max,
};
use crate::collection_rewrite::{ByteShape, row_shape};
use crate::growth::{
    ProvenanceBinding, assignment_growth, collection_price_from,
    expression_from as provenance_expression_from, geometric_sum, saturating_power, take_identity,
};
use crate::ir::{ArgType, Builtin, Expr, Input, LoopDomain, Program, Scan, Stmt};
use crate::schema::Schema;
use crate::value::Value;
use std::collections::{BTreeMap, BTreeSet};

const CLOSURE_METADATA_BYTES: u64 = 64;

#[derive(Clone, Default)]
struct Flow {
    whole_element: bool,
    rows: BTreeMap<String, RowFlow>,
    value_bytes: u64,
    retained_value_bytes: u64,
    depends_on_scan: bool,
}

#[derive(Clone)]
struct RowFlow {
    table: String,
    fields: BTreeSet<String>,
    count: u64,
    bytes: u64,
    max_bytes: u64,
    retained_bytes: u64,
}

impl Flow {
    fn row(site: &str, table: &str, bytes: u64, count: u64) -> Self {
        Self {
            whole_element: false,
            rows: BTreeMap::from([(
                site.to_owned(),
                RowFlow {
                    table: table.into(),
                    fields: BTreeSet::new(),
                    count,
                    bytes,
                    max_bytes: bytes,
                    retained_bytes: count.saturating_mul(bytes),
                },
            )]),
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
        self.whole_element |= other.whole_element;
        for (site, incoming) in other.rows {
            self.rows
                .entry(site)
                .and_modify(|current| {
                    if current.fields.is_empty() || incoming.fields.is_empty() {
                        current.fields.clear();
                    } else {
                        current.fields.extend(incoming.fields.clone());
                    }
                    current.count = current.count.saturating_add(incoming.count);
                    current.bytes = current.bytes.max(incoming.bytes);
                    current.max_bytes = current.max_bytes.max(incoming.max_bytes);
                    current.retained_bytes = current
                        .retained_bytes
                        .saturating_add(incoming.retained_bytes);
                })
                .or_insert(incoming);
        }
        self.value_bytes = self.value_bytes.saturating_add(other.value_bytes);
        self.retained_value_bytes = self
            .retained_value_bytes
            .saturating_add(other.retained_value_bytes);
        self.depends_on_scan |= other.depends_on_scan;
        self
    }

    fn add_projection(mut self, other: Self) -> Self {
        self.whole_element |= other.whole_element;
        for (site, incoming) in other.rows {
            self.rows
                .entry(site)
                .and_modify(|current| {
                    if current.fields.is_empty() || incoming.fields.is_empty() {
                        current.fields.clear();
                    } else {
                        current.fields.extend(incoming.fields.clone());
                    }
                    current.count = current.count.max(incoming.count);
                    current.max_bytes = current.max_bytes.max(incoming.max_bytes);
                    current.bytes = current
                        .bytes
                        .saturating_add(incoming.bytes)
                        .min(current.max_bytes);
                    current.retained_bytes = current.count.saturating_mul(current.bytes);
                })
                .or_insert(incoming);
        }
        self.value_bytes = self.value_bytes.saturating_add(other.value_bytes);
        self.retained_value_bytes = self
            .retained_value_bytes
            .saturating_add(other.retained_value_bytes);
        self.depends_on_scan |= other.depends_on_scan;
        self
    }

    fn project_width(mut self, bytes: u64, field: &str) -> Self {
        for row in self.rows.values_mut() {
            row.fields = BTreeSet::from([field.into()]);
            row.bytes = bytes.min(row.max_bytes);
            row.retained_bytes = row.count.saturating_mul(row.bytes);
        }
        self
    }

    fn whole_row_width(mut self) -> Self {
        for row in self.rows.values_mut() {
            row.fields.clear();
            row.bytes = row.max_bytes;
            row.retained_bytes = row.count.saturating_mul(row.bytes);
        }
        self
    }

    fn branch(mut self, other: Self) -> Self {
        self.whole_element |= other.whole_element;
        for (site, incoming) in other.rows {
            self.rows
                .entry(site)
                .and_modify(|current| {
                    if current.fields.is_empty() || incoming.fields.is_empty() {
                        current.fields.clear();
                    } else {
                        current.fields.extend(incoming.fields.clone());
                    }
                    current.count = current.count.max(incoming.count);
                    current.bytes = current.bytes.max(incoming.bytes);
                    current.max_bytes = current.max_bytes.max(incoming.max_bytes);
                    current.retained_bytes = current.count.saturating_mul(current.bytes);
                })
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
            row.retained_bytes = row.retained_bytes.saturating_mul(factor);
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
                incoming.retained_bytes = incoming
                    .retained_bytes
                    .saturating_sub(retained.retained_bytes.saturating_mul(occurrences));
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
            row.retained_bytes = row.count.saturating_mul(row.bytes);
        }
        self
    }

    fn element(mut self, count: u64) -> Self {
        if self.whole_element {
            return self;
        }
        for row in self.rows.values_mut() {
            row.count = row
                .count
                .saturating_add(count.saturating_sub(1))
                .saturating_div(count.max(1));
            row.retained_bytes = row.count.saturating_mul(row.bytes);
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
            whole_element: self.whole_element,
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
                total.saturating_add(row.retained_bytes)
            })
    }
}

#[derive(Clone)]
struct Binding {
    flow: Flow,
    instances: u64,
    collection_len: Option<u64>,
    held_collection: bool,
    collection: bool,
    table: Option<String>,
    value: Expr,
    provenance: ProvenanceBinding,
}

struct RetentionAssignmentPrice {
    flow: Flow,
    collection_len: Option<u64>,
    held_collection: bool,
    collection: bool,
    table: Option<String>,
}

pub(crate) struct RetentionEstimator<'a> {
    schema: &'a Schema,
    max_held_bytes: u64,
    peak: Flow,
    has_fixed_width_result: bool,
    next_identity: u64,
}

impl<'a> RetentionEstimator<'a> {
    pub(crate) fn estimate(schema: &'a Schema, program: &Program) -> ByteShape {
        let mut estimator = Self {
            schema,
            max_held_bytes: 0,
            peak: Flow::default(),
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
                        flow: Flow::value(argument_max(schema, argument)),
                        instances: 1,
                        collection_len: match argument {
                            ArgType::List { max, .. } => Some(u64::from(*max)),
                            _ => None,
                        },
                        held_collection: false,
                        collection,
                        table: None,
                        value: Expr::Variable(name.clone()),
                        provenance: ProvenanceBinding::new(
                            identity,
                            crate::growth::ProvenanceExpression::argument(),
                        ),
                    },
                )
            })
            .collect();
        estimator.statements(&program.body, &mut variables, 1, 0);
        if estimator.max_held_bytes == 0 && estimator.has_fixed_width_result {
            ByteShape::leaf(CLOSURE_METADATA_BYTES, "fixed-width closure metadata")
        } else {
            let mut children: Vec<_> = estimator
                .peak
                .rows
                .into_iter()
                .map(|(site, row)| {
                    let mut width = row_shape(schema, &row.table);
                    if !row.fields.is_empty() {
                        width.children.retain(|c| {
                            row.fields
                                .iter()
                                .any(|f| c.label == format!("{}.{f}", row.table))
                        });
                    }
                    width.bytes = row.bytes;
                    ByteShape::repeated(
                        row.retained_bytes,
                        format!("{} at {site}: {} retained rows", row.table, row.count),
                        row.count,
                        width,
                    )
                })
                .collect();
            if estimator.peak.retained_value_bytes > 0 {
                children.push(ByteShape::leaf(
                    estimator.peak.retained_value_bytes,
                    "retained constructed values",
                ));
            }
            ByteShape::group(
                estimator.max_held_bytes,
                "closure at peak retention",
                children,
            )
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
                    let provenance = provenance_expression_from(
                        value,
                        variables,
                        |binding| &binding.provenance,
                        iteration,
                    );
                    let (flow, collection_len, held_collection) = self.expression(value, variables);
                    let collection =
                        collection_price_from(value, variables, |binding| binding.collection);
                    let table = self.expression_table(value, variables);
                    let identity = take_identity(&mut self.next_identity);
                    variables.insert(
                        name.clone(),
                        Binding {
                            flow,
                            instances: calls,
                            collection_len,
                            held_collection,
                            collection,
                            table,
                            value: value.clone(),
                            provenance: ProvenanceBinding::new(identity, provenance),
                        },
                    );
                    self.record_held_collections(variables);
                }
                Stmt::Assign { name, value } => {
                    let instances = variables
                        .get(name)
                        .map_or(calls, |binding| binding.instances);
                    let assignment = assignment_growth(
                        variables.get(name).map(|binding| &binding.provenance),
                        value,
                        variables,
                        |binding| &binding.provenance,
                        calls,
                        instances,
                        iteration,
                        || {
                            let (flow, collection_len, held_collection) =
                                self.expression(value, variables);
                            RetentionAssignmentPrice {
                                flow,
                                collection_len,
                                held_collection,
                                collection: collection_price_from(value, variables, |binding| {
                                    binding.collection
                                }),
                                table: self.expression_table(value, variables),
                            }
                        },
                    );
                    let (provenance, growth, price) = assignment.into_parts();
                    if let Some(growth) = growth.filter(|_| price.collection) {
                        let current = variables.get_mut(name).expect("growth target exists");
                        let mut added = price
                            .flow
                            .clone()
                            .growth_over(&current.flow, growth.occurrences);
                        if !added.has_growth_width() {
                            added = price.flow.clone();
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
                            current.flow.clone().add(
                                price
                                    .flow
                                    .clone()
                                    .retain_value_width()
                                    .scale(growth.repetitions),
                            )
                        };
                        current.collection_len = current
                            .collection_len
                            .zip(price.collection_len)
                            .map(|(current_len, assigned_len)| {
                                current_len.saturating_add(
                                    assigned_len
                                        .saturating_sub(current_len)
                                        .saturating_mul(growth.repetitions),
                                )
                            });
                        current.held_collection = true;
                        current.collection = true;
                        current.table = None;
                        current.value = value.clone();
                        current.provenance = current.provenance.assigned(provenance);
                    } else {
                        let identity = variables
                            .get(name)
                            .map(|binding| binding.provenance.identity)
                            .unwrap_or_else(|| take_identity(&mut self.next_identity));
                        let assigned = variables
                            .get(name)
                            .map(|binding| binding.provenance.assigned(provenance.clone()))
                            .unwrap_or_else(|| ProvenanceBinding::new(identity, provenance));
                        variables.insert(
                            name.clone(),
                            Binding {
                                flow: price.flow,
                                instances,
                                collection_len: price.collection_len,
                                held_collection: price.held_collection,
                                collection: price.collection,
                                table: price.table,
                                value: value.clone(),
                                provenance: assigned,
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
                        collection: true,
                        table: None,
                        value: Expr::Array(Vec::new()),
                        provenance: ProvenanceBinding::new(
                            take_identity(&mut self.next_identity),
                            crate::growth::ProvenanceExpression::iteration(true, iteration),
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
                    current.collection = true;
                    current.table = None;
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
                    let table = match domain {
                        LoopDomain::Page(scan) => Some(scan.table.clone()),
                        LoopDomain::Recurse(recurse) => Some(recurse.table.clone()),
                        LoopDomain::DerivedArray { value, .. } => {
                            self.expression_table(value, variables)
                        }
                        _ => None,
                    };
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
                            collection: matches!(
                                domain,
                                LoopDomain::Page(_) | LoopDomain::Recurse(_)
                            ),
                            table,
                            value: Expr::Variable(binding.clone()),
                            provenance: ProvenanceBinding::new(
                                take_identity(&mut self.next_identity),
                                crate::growth::ProvenanceExpression::iteration(
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
                    if held > self.max_held_bytes {
                        self.max_held_bytes = held;
                        self.peak = flow.clone();
                    }
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
                let nodes = geometric_sum(u64::from(recurse.fanout), recurse.depth);
                (
                    nodes,
                    Flow::row(
                        &recurse.site,
                        &recurse.table,
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
            // @ref LLP 1001#10-what-binds-and-how-it-is-checked — a projected
            // closure retains selected bytes from one source row, not one row per field.
            Expr::Field { base, name } => {
                let (flow, _, _) = self.expression(base, variables);
                let flow = self
                    .expression_table(base, variables)
                    .and_then(|table| declared_serialized_column_max(self.schema, &table, name))
                    .map_or(flow.clone(), |bytes| flow.project_width(bytes, name));
                (flow, None, false)
            }
            Expr::Array(values) => {
                let flow = values.iter().fold(Flow::default(), |flow, value| {
                    flow.add(self.expression(value, variables).0)
                });
                (flow, Some(values.len() as u64), false)
            }
            Expr::Object(values) => (self.object(values, variables), None, false),
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
                    &read.table,
                    declared_serialized_row_max(self.schema, &read.table),
                    1,
                ),
                None,
                false,
            ),
            Expr::Exists(read) => (
                Flow::row(
                    &read.site,
                    &read.table,
                    declared_serialized_row_max(self.schema, &read.table),
                    1,
                )
                .fixed_width(),
                None,
                false,
            ),
            Expr::Merge(merge) => {
                // @ref LLP 1001#3-read-and-write-states-no-silent-states — the
                // receipt keeps all stepped heads/lookahead plus discovery's page/halo.
                let flow = Flow::row(
                    &merge.site,
                    merge.table(),
                    declared_serialized_row_max(self.schema, merge.table()),
                    if crate::certificate::search::disjoint_merge(self.schema, merge) {
                        merge
                            .max_lanes()
                            .saturating_add(merge.take())
                            .saturating_add(2)
                    } else {
                        merge
                            .max_lanes()
                            .saturating_mul(merge.take().saturating_add(3))
                    },
                );
                let flow = merge
                    .lanes
                    .iter()
                    .filter_map(|lane| lane.source.as_ref())
                    .fold(flow, |flow, source| {
                        flow.add(Flow::row(
                            &source.site,
                            &source.table,
                            declared_serialized_row_max(self.schema, &source.table),
                            source.take.maximum().saturating_add(1),
                        ))
                    });
                (flow, Some(merge.take()), true)
            }
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
            &scan.table,
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
                    let table = merged_table(current, &incoming);
                    let prefer_incoming = incoming.flow.held_bytes() > current.flow.held_bytes();
                    current.flow = current.flow.clone().branch(incoming.flow.clone());
                    current.instances = current.instances.min(incoming.instances);
                    current.collection_len = match (current.collection_len, incoming.collection_len)
                    {
                        (Some(left), Some(right)) => Some(left.max(right)),
                        _ => None,
                    };
                    current.held_collection |= incoming.held_collection;
                    current.collection |= incoming.collection;
                    current.table = table;
                    if prefer_incoming {
                        current.value = incoming.value.clone();
                    }
                    current.provenance.merge(&incoming.provenance);
                })
                .or_insert(incoming);
        }
    }

    fn record_held_collections(&mut self, variables: &BTreeMap<String, Binding>) {
        let flow = variables
            .values()
            .filter(|binding| binding.held_collection)
            .fold(Flow::default(), |total, binding| {
                total.add(binding.flow.clone())
            });
        let held = flow.held_bytes();
        if held > self.max_held_bytes {
            self.max_held_bytes = held;
            self.peak = flow;
        }
    }

    fn expression_table(
        &self,
        expression: &Expr,
        variables: &BTreeMap<String, Binding>,
    ) -> Option<String> {
        match expression {
            Expr::Variable(name) => variables
                .get(name)
                .and_then(|binding| binding.table.clone()),
            Expr::Get(read) => Some(read.table.clone()),
            Expr::Scan(scan) => Some(scan.table.clone()),
            Expr::Merge(merge) => Some(merge.table().to_owned()),
            Expr::Builtin {
                builtin: Builtin::Slice | Builtin::Sort { .. },
                args,
            } => args
                .first()
                .and_then(|value| self.expression_table(value, variables)),
            _ => None,
        }
    }

    fn object(
        &self,
        values: &BTreeMap<String, Expr>,
        variables: &BTreeMap<String, Binding>,
    ) -> Flow {
        struct RowFields<'a> {
            base: &'a Expr,
            table: String,
            columns: Vec<&'a str>,
            flow: Flow,
        }

        let mut flow = Flow::default();
        let mut row_fields: Vec<RowFields<'_>> = Vec::new();
        for value in values.values() {
            let Expr::Field { base, name } = value else {
                flow = flow.add(self.expression(value, variables).0);
                continue;
            };
            let Some(table) = self.expression_table(base, variables) else {
                flow = flow.add(self.expression(value, variables).0);
                continue;
            };
            if declared_serialized_column_max(self.schema, &table, name).is_none() {
                flow = flow.add(self.expression(value, variables).0);
                continue;
            }
            let field_flow = self.expression(value, variables).0;
            if let Some(group) = row_fields
                .iter_mut()
                .find(|group| group.table == table && group.base == base.as_ref())
            {
                group.columns.push(name);
                group.flow = group.flow.clone().add_projection(field_flow);
            } else {
                row_fields.push(RowFields {
                    base,
                    table,
                    columns: vec![name],
                    flow: field_flow,
                });
            }
        }
        for group in row_fields {
            // Raw IR may name an unresolved relation. Structural validation
            // refuses it; retain the field estimate while collecting other errors.
            let whole_row = self.schema.table(&group.table).is_some_and(|table| {
                group.columns.len() == table.columns.len()
                    && group
                        .columns
                        .iter()
                        .all(|column| table.columns.contains_key(*column))
            });
            flow = flow.add(if whole_row {
                group.flow.whole_row_width()
            } else {
                group.flow
            });
        }
        flow
    }
}

fn merged_table(current: &Binding, incoming: &Binding) -> Option<String> {
    match (&current.table, &incoming.table) {
        (Some(left), Some(right)) if left == right => Some(left.clone()),
        (Some(table), None) if matches!(incoming.value, Expr::Literal(Value::Null)) => {
            Some(table.clone())
        }
        (None, Some(table)) if matches!(current.value, Expr::Literal(Value::Null)) => {
            Some(table.clone())
        }
        _ => None,
    }
}

pub(crate) fn argument_max(schema: &Schema, argument: &ArgType) -> u64 {
    match argument {
        ArgType::Cursor => 5_480,
        ArgType::Id | ArgType::Principal => 144,
        ArgType::Ref { table } => crate::bounds::declared_identity_max(schema, table),
        ArgType::Text { max, .. } => u64::from(*max).saturating_mul(4).saturating_add(16),
        ArgType::Json { max_bytes } => u64::from(*max_bytes).saturating_add(16),
        ArgType::Bytes { max } => u64::from(*max).saturating_mul(2).saturating_add(16),
        // @ref LLP 1006#1-the-move — retention holds the same closed record
        // priced by the row-width estimator, never the blob bytes bounded by max.
        ArgType::Image { .. } => declared_asset_record_max(false),
        ArgType::Video { .. } => declared_asset_record_max(true),
        ArgType::Int | ArgType::Time | ArgType::Decimal { .. } | ArgType::Money { .. } => 32,
        ArgType::Bool => 16,
        ArgType::Optional(inner) => argument_max(schema, inner).max(8),
        ArgType::Scalar => 1024,
        ArgType::List { of, max } => CANONICAL_ARRAY_BASE_BYTES.saturating_add(
            u64::from(*max).saturating_mul(
                of.as_deref()
                    .map_or(1024, |inner| argument_max(schema, inner))
                    .saturating_add(1),
            ),
        ),
        ArgType::Enum { variants } => variants
            .iter()
            .map(|variant| variant.len() as u64 + 16)
            .max()
            .unwrap_or(16),
    }
}

pub(crate) fn collection_bytes(values: impl Iterator<Item = u64>) -> u64 {
    values.fold(CANONICAL_ARRAY_BASE_BYTES, |size, value| {
        size.saturating_add(value).saturating_add(1)
    })
}

fn literal_index(expression: Option<&Expr>) -> Option<u64> {
    match expression {
        Some(Expr::Literal(Value::Int(value))) => u64::try_from(*value).ok(),
        _ => None,
    }
}
