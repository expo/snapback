use crate::bounds::{
    CANONICAL_ARRAY_BASE_BYTES, CANONICAL_ROW_BASE_BYTES, declared_column_value_max,
    declared_serialized_column_max,
};
use crate::collection_rewrite::{
    ByteShape, OutputAssignmentPrice, OutputBound, OutputEstimate, OutputEstimator,
};
use crate::growth::{
    ProvenanceBinding, assignment_growth, collection_price_from,
    expression_from as provenance_expression_from, geometric_sum, has_word_list, saturating_power,
    take_identity,
};
use crate::ir::*;
use crate::retention::{argument_max, collection_bytes};
use crate::schema::Schema;
use crate::value::{Value, canonical_json};
use std::collections::BTreeMap;
impl<'a> OutputEstimator<'a> {
    pub(super) fn estimate(schema: &'a Schema, program: &Program) -> OutputEstimate {
        let mut estimator = Self {
            schema,
            max_result: canonical_json(&Value::Null).len() as u64,
            next_identity: program.args.len() as u64 + 1,
            shape: ByteShape::leaf(4, "null value"),
        };
        let mut next_identity = 1_u64;
        let mut variables = program
            .args
            .iter()
            .map(|(name, argument)| {
                let identity = next_identity;
                next_identity = next_identity.saturating_add(1);
                (
                    name.clone(),
                    OutputBound {
                        whole_element: false,
                        bytes: argument_max(argument),
                        instances: 1,
                        collection: matches!(argument, ArgType::List { .. }),
                        table: None,
                        provenance: ProvenanceBinding::new(
                            identity,
                            crate::growth::ProvenanceExpression::argument(),
                        ),
                        shape: ByteShape::leaf(argument_max(argument), format!("argument {name}")),
                        value: Expr::Variable(name.clone()),
                    },
                )
            })
            .collect();
        estimator.statements(&program.body, &mut variables, 1, 0, &mut Vec::new());
        OutputEstimate {
            bytes: estimator.max_result,
            shape: estimator.shape,
        }
    }

    fn statements(
        &mut self,
        statements: &[Stmt],
        variables: &mut BTreeMap<String, OutputBound>,
        calls: u64,
        iteration: u64,
        loops: &mut Vec<(String, LoopDomain)>,
    ) {
        for statement in statements {
            match statement {
                Stmt::Const { name, value } | Stmt::Let { name, value } => {
                    let provenance = provenance_expression_from(
                        value,
                        variables,
                        |bound| &bound.provenance,
                        iteration,
                    );
                    let bytes = self.expression(value, variables);
                    let collection =
                        collection_price_from(value, variables, |bound| bound.collection);
                    let table = self.expression_table(value, variables);
                    let shape = self.expression_shape(value, variables);
                    let identity = take_identity(&mut self.next_identity);
                    variables.insert(
                        name.clone(),
                        OutputBound {
                            whole_element: has_word_list(value, variables, |v| v.whole_element),
                            bytes,
                            instances: calls,
                            collection,
                            table,
                            provenance: ProvenanceBinding::new(identity, provenance),
                            shape,
                            value: value.clone(),
                        },
                    );
                }
                Stmt::Assign { name, value } => {
                    let whole_element = has_word_list(value, variables, |v| v.whole_element)
                        || variables.get(name).is_some_and(|v| v.whole_element);
                    let instances = variables.get(name).map_or(calls, |bound| bound.instances);
                    let assignment = assignment_growth(
                        variables.get(name).map(|bound| &bound.provenance),
                        value,
                        variables,
                        |bound| &bound.provenance,
                        calls,
                        instances,
                        iteration,
                        || OutputAssignmentPrice {
                            bytes: self.expression(value, variables),
                            collection: collection_price_from(value, variables, |bound| {
                                bound.collection
                            }),
                            table: self.expression_table(value, variables),
                            shape: self.expression_shape(value, variables),
                        },
                    );
                    let (provenance, growth, price) = assignment.into_parts();
                    if let Some(growth) = growth.filter(|_| price.collection) {
                        let current = variables.get_mut(name).expect("growth target exists");
                        let mut added = price
                            .bytes
                            .saturating_sub(current.bytes.saturating_mul(growth.occurrences));
                        if added == 0 {
                            added = price.bytes;
                        }
                        current.bytes =
                            if growth.occurrences > 1 {
                                current.bytes.saturating_add(added).saturating_mul(
                                    saturating_power(growth.occurrences, growth.repetitions),
                                )
                            } else if growth.occurrences == 1 {
                                current
                                    .bytes
                                    .saturating_add(added.saturating_mul(growth.repetitions))
                            } else {
                                current
                                    .bytes
                                    .saturating_add(price.bytes.saturating_mul(growth.repetitions))
                            };
                        current.collection = true;
                        current.table = None;
                        current.provenance = current.provenance.assigned(provenance);
                        current.shape = ByteShape::repeated(
                            current.bytes,
                            format!(
                                "{name} collection growth over {} repetitions",
                                growth.repetitions
                            ),
                            growth.repetitions,
                            price.shape,
                        );
                        current.value = value.clone();
                        current.whole_element = whole_element;
                    } else {
                        let identity = variables
                            .get(name)
                            .map(|bound| bound.provenance.identity)
                            .unwrap_or_else(|| take_identity(&mut self.next_identity));
                        let assigned = variables
                            .get(name)
                            .map(|bound| bound.provenance.assigned(provenance.clone()))
                            .unwrap_or_else(|| ProvenanceBinding::new(identity, provenance));
                        variables.insert(
                            name.clone(),
                            OutputBound {
                                whole_element,
                                bytes: price.bytes,
                                instances,
                                collection: price.collection,
                                table: price.table,
                                provenance: assigned,
                                shape: price.shape,
                                value: value.clone(),
                            },
                        );
                    }
                }
                Stmt::Push { target, value } => {
                    let whole_element = has_word_list(value, variables, |v| v.whole_element);
                    let shape = self.expression_shape(value, variables);
                    let label = loops
                        .last()
                        .map(|(_, domain)| match domain {
                            LoopDomain::Page(scan) => crate::collection_rewrite::scan_label(scan),
                            LoopDomain::DerivedArray { value, .. } => {
                                self.expression_shape(value, variables).collection_label()
                            }
                            LoopDomain::ArgList { name, .. } => format!("argument {name}"),
                            _ => "bounded loop".into(),
                        })
                        .unwrap_or_else(|| target.clone());
                    let element = self.expression(value, variables).saturating_add(1);
                    let current = variables.entry(target.clone()).or_insert(OutputBound {
                        whole_element: false,
                        bytes: CANONICAL_ARRAY_BASE_BYTES,
                        instances: calls,
                        collection: true,
                        table: None,
                        provenance: ProvenanceBinding::new(
                            take_identity(&mut self.next_identity),
                            crate::growth::ProvenanceExpression::iteration(true, iteration),
                        ),
                        shape: ByteShape::leaf(CANONICAL_ARRAY_BASE_BYTES, "array framing"),
                        value: Expr::Array(Vec::new()),
                    });
                    current.whole_element |= whole_element;
                    let repetitions = calls
                        .saturating_add(current.instances.saturating_sub(1))
                        .saturating_div(current.instances.max(1));
                    current.bytes = current
                        .bytes
                        .saturating_add(repetitions.saturating_mul(element));
                    current.collection = true;
                    current.table = None;
                    let added = ByteShape::repeated(
                        repetitions.saturating_mul(element),
                        format!("{label} ({repetitions} repetitions)"),
                        repetitions,
                        shape,
                    );
                    current.shape = ByteShape::group(
                        current.bytes,
                        if target.starts_with("__q") {
                            "collection"
                        } else {
                            target
                        },
                        vec![current.shape.clone(), added],
                    );
                }
                Stmt::If {
                    then_body,
                    else_body,
                    ..
                } => {
                    let mut then_variables = variables.clone();
                    let mut else_variables = variables.clone();
                    self.statements(then_body, &mut then_variables, calls, iteration, loops);
                    self.statements(else_body, &mut else_variables, calls, iteration, loops);
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
                        OutputBound {
                            whole_element: match domain {
                                LoopDomain::DerivedArray { value, .. } => {
                                    has_word_list(value, variables, |v| v.whole_element)
                                }
                                _ => false,
                            },
                            bytes: element,
                            instances: nested_calls,
                            collection: matches!(
                                domain,
                                LoopDomain::Page(_) | LoopDomain::Recurse(_)
                            ),
                            shape: table
                                .as_ref()
                                .map(|t| self.row_shape(t))
                                .unwrap_or_else(|| ByteShape::leaf(element, binding)),
                            table,
                            provenance: ProvenanceBinding::new(
                                take_identity(&mut self.next_identity),
                                crate::growth::ProvenanceExpression::iteration(
                                    matches!(domain, LoopDomain::Page(_) | LoopDomain::Recurse(_)),
                                    nested_iteration,
                                ),
                            ),
                            value: Expr::Variable(binding.clone()),
                        },
                    );
                    loops.push((binding.clone(), domain.clone()));
                    self.statements(body, &mut nested, nested_calls, nested_iteration, loops);
                    loops.pop();
                    nested.remove(binding);
                    Self::merge_variables(variables, nested);
                }
                Stmt::Return(value) => {
                    let bytes = self.expression(value, variables);
                    if bytes > self.max_result {
                        self.max_result = bytes;
                        self.shape = self.expression_shape(value, variables);
                    }
                }
                Stmt::Require { .. }
                | Stmt::Insert { .. }
                | Stmt::Update { .. }
                | Stmt::Upsert { .. }
                | Stmt::Delete { .. }
                | Stmt::Emit { .. }
                | Stmt::Break
                | Stmt::Continue => {}
            }
        }
    }

    fn domain(&self, domain: &LoopDomain, variables: &BTreeMap<String, OutputBound>) -> (u64, u64) {
        match domain {
            LoopDomain::Page(scan) => (scan.take.maximum(), self.row(&scan.table)),
            LoopDomain::LiteralRange {
                start,
                end_exclusive,
            } => (end_exclusive.saturating_sub(*start).max(0) as u64, 32),
            LoopDomain::ArgList { name, max } => {
                let element = variables
                    .get(name)
                    .map(|bound| bound.bytes)
                    .unwrap_or(1024)
                    .saturating_div(u64::from(*max).max(1));
                (u64::from(*max), element)
            }
            LoopDomain::DerivedArray { value, max, .. } => (
                u64::from(*max),
                self.expression(value, variables).saturating_div(
                    if has_word_list(value, variables, |v| v.whole_element) {
                        1
                    } else {
                        u64::from(*max).max(1)
                    },
                ),
            ),
            LoopDomain::Recurse(recurse) => {
                let nodes = geometric_sum(u64::from(recurse.fanout), recurse.depth);
                (nodes, self.row(&recurse.table))
            }
        }
    }

    pub(crate) fn expression(
        &self,
        expression: &Expr,
        variables: &BTreeMap<String, OutputBound>,
    ) -> u64 {
        match expression {
            Expr::Literal(value) => canonical_json(value).len() as u64,
            Expr::Variable(name) => variables.get(name).map(|bound| bound.bytes).unwrap_or(1024),
            Expr::Input(Input::Viewer | Input::NewId) => 144,
            Expr::Input(Input::Now | Input::ReadTime) => 32,
            // @ref LLP 1001#10-what-binds-and-how-it-is-checked — row provenance,
            // not a variable spelling, selects the declared column bound.
            Expr::Field { base, name } => self
                .expression_table(base, variables)
                .and_then(|table| declared_serialized_column_max(self.schema, &table, name))
                .unwrap_or_else(|| self.expression(base, variables)),
            Expr::Array(values) => {
                collection_bytes(values.iter().map(|value| self.expression(value, variables)))
            }
            Expr::Object(values) => self.object(values, variables),
            Expr::Binary { op, .. } => match op {
                BinaryOp::Eq
                | BinaryOp::Ne
                | BinaryOp::SameValueZero
                | BinaryOp::Lt
                | BinaryOp::Lte
                | BinaryOp::Gt
                | BinaryOp::Gte
                | BinaryOp::And
                | BinaryOp::Or => 16,
                BinaryOp::Add | BinaryOp::Sub | BinaryOp::Mul => 32,
            },
            Expr::Unary { op, .. } => match op {
                UnaryOp::Not => 16,
                UnaryOp::Neg => 32,
            },
            Expr::Builtin { builtin, args } => match builtin {
                Builtin::Slice => args
                    .first()
                    .map(|value| self.expression(value, variables))
                    .unwrap_or(0),
                Builtin::Sort { .. } => args
                    .first()
                    .map(|value| self.expression(value, variables))
                    .unwrap_or(0),
                Builtin::Concat => args.iter().fold(0_u64, |size, value| {
                    size.saturating_add(self.expression(value, variables))
                }),
                Builtin::Min | Builtin::Max => args
                    .iter()
                    .map(|value| self.expression(value, variables))
                    .max()
                    .unwrap_or(0),
                // @ref LLP 1001#pure-builtins — each ASCII run adds a tagged String and separator;
                // eight times the input's serialized bytes covers even one-letter words.
                Builtin::Words => args
                    .first()
                    .map(|value| self.expression(value, variables).saturating_mul(8))
                    .unwrap_or(CANONICAL_ARRAY_BASE_BYTES),
                Builtin::MentionTokens => args
                    .first()
                    .map(|value| self.expression(value, variables).saturating_mul(2))
                    .unwrap_or(CANONICAL_ARRAY_BASE_BYTES),
                Builtin::Divmod { .. } => 256,
                Builtin::Len
                | Builtin::DeterministicShare
                | Builtin::Count
                | Builtin::Sum
                | Builtin::CountCapped => 32,
            },
            Expr::Get(read) => self.row(&read.table),
            Expr::Exists(_) => 16,
            Expr::Scan(scan) => Self::repeated(self.row(&scan.table), scan.take.maximum()),
            Expr::Merge(merge) => Self::repeated(self.row(merge.table()), merge.take()),
        }
    }

    fn repeated(element: u64, count: u64) -> u64 {
        CANONICAL_ARRAY_BASE_BYTES.saturating_add(count.saturating_mul(element.saturating_add(1)))
    }

    pub(crate) fn expression_table(
        &self,
        expression: &Expr,
        variables: &BTreeMap<String, OutputBound>,
    ) -> Option<String> {
        match expression {
            Expr::Variable(name) => variables.get(name).and_then(|bound| bound.table.clone()),
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
        variables: &BTreeMap<String, OutputBound>,
    ) -> u64 {
        struct RowFields<'a> {
            base: &'a Expr,
            table: String,
            fields: Vec<(&'a str, &'a str)>,
        }

        let mut size = CANONICAL_ROW_BASE_BYTES;
        let mut row_fields: Vec<RowFields<'_>> = Vec::new();
        for (output_name, value) in values {
            let Expr::Field { base, name } = value else {
                size = size
                    .saturating_add(output_name.len() as u64)
                    .saturating_add(4)
                    .saturating_add(self.expression(value, variables));
                continue;
            };
            let Some(table) = self.expression_table(base, variables) else {
                size = size
                    .saturating_add(output_name.len() as u64)
                    .saturating_add(4)
                    .saturating_add(self.expression(value, variables));
                continue;
            };
            if declared_column_value_max(self.schema, &table, name).is_none() {
                size = size
                    .saturating_add(output_name.len() as u64)
                    .saturating_add(4)
                    .saturating_add(self.expression(value, variables));
                continue;
            }
            if let Some(group) = row_fields
                .iter_mut()
                .find(|group| group.table == table && group.base == base.as_ref())
            {
                group.fields.push((output_name, name));
            } else {
                row_fields.push(RowFields {
                    base,
                    table,
                    fields: vec![(output_name, name)],
                });
            }
        }

        for group in row_fields {
            let table = self
                .schema
                .table(&group.table)
                .expect("resolved table exists");
            let whole_row = group.fields.len() == table.columns.len()
                && group.fields.iter().all(|(output, column)| {
                    output == column && table.columns.contains_key(*column)
                });
            if whole_row {
                size = size.saturating_add(
                    self.row(&group.table)
                        .saturating_sub(CANONICAL_ROW_BASE_BYTES),
                );
                continue;
            }
            for (output, column) in group.fields {
                size = size
                    .saturating_add(output.len() as u64)
                    .saturating_add(4)
                    .saturating_add(
                        declared_column_value_max(self.schema, &group.table, column)
                            .expect("resolved column exists"),
                    );
            }
        }
        size
    }
}
