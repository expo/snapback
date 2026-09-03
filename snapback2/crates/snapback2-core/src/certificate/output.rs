use crate::collection_rewrite::{
    CollectionRewrite, OutputAssignmentPrice, OutputBound, OutputEstimate, OutputEstimator,
};
use crate::growth::{
    ProvenanceBinding, assignment_growth, collection_price_from,
    expression_from as provenance_expression_from, geometric_sum, saturating_power, take_identity,
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
            args: program.args.keys().cloned().collect(),
            rewrite: None,
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
                        bytes: argument_max(argument),
                        instances: 1,
                        collection: matches!(argument, ArgType::List { .. }),
                        provenance: ProvenanceBinding::new(
                            identity,
                            crate::growth::ProvenanceExpression::argument(),
                        ),
                        rewrite: None,
                        value: Expr::Variable(name.clone()),
                    },
                )
            })
            .collect();
        estimator.statements(&program.body, &mut variables, 1, 0, &mut Vec::new());
        OutputEstimate {
            bytes: estimator.max_result,
            rewrite: estimator.rewrite,
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
                    let rewrite = self.expression_rewrite(value, variables);
                    let identity = take_identity(&mut self.next_identity);
                    variables.insert(
                        name.clone(),
                        OutputBound {
                            bytes,
                            instances: calls,
                            collection,
                            provenance: ProvenanceBinding::new(identity, provenance),
                            rewrite,
                            value: value.clone(),
                        },
                    );
                }
                Stmt::Assign { name, value } => {
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
                            rewrite: self.expression_rewrite(value, variables),
                        },
                    );
                    let (provenance, growth, price) = assignment.into_parts();
                    if let Some(growth) = growth.filter(|_| price.collection) {
                        let rewrite = CollectionRewrite::for_assignment(
                            self.args.clone(),
                            loops,
                            name,
                            value,
                            variables,
                        );
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
                        current.provenance = current.provenance.assigned(provenance);
                        current.rewrite = Some((current.bytes, rewrite));
                        current.value = value.clone();
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
                                bytes: price.bytes,
                                instances,
                                collection: price.collection,
                                provenance: assigned,
                                rewrite: price.rewrite,
                                value: value.clone(),
                            },
                        );
                    }
                }
                Stmt::Push { target, value } => {
                    let rewrite = (!loops.is_empty()).then(|| {
                        CollectionRewrite::for_push(
                            self.args.clone(),
                            loops,
                            target,
                            value,
                            variables,
                        )
                    });
                    let element = self.expression(value, variables).saturating_add(1);
                    let current = variables.entry(target.clone()).or_insert(OutputBound {
                        bytes: 2,
                        instances: calls,
                        collection: true,
                        provenance: ProvenanceBinding::new(
                            take_identity(&mut self.next_identity),
                            crate::growth::ProvenanceExpression::iteration(true, iteration),
                        ),
                        rewrite: None,
                        value: Expr::Array(Vec::new()),
                    });
                    let repetitions = calls
                        .saturating_add(current.instances.saturating_sub(1))
                        .saturating_div(current.instances.max(1));
                    current.bytes = current
                        .bytes
                        .saturating_add(repetitions.saturating_mul(element));
                    current.collection = true;
                    if let Some(rewrite) = rewrite {
                        current.rewrite = Some((current.bytes, rewrite));
                    }
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
                    let mut nested = variables.clone();
                    let nested_calls = calls.saturating_mul(bound);
                    let nested_iteration = take_identity(&mut self.next_identity);
                    nested.insert(
                        binding.clone(),
                        OutputBound {
                            bytes: element,
                            instances: nested_calls,
                            collection: matches!(
                                domain,
                                LoopDomain::Page(_) | LoopDomain::Recurse(_)
                            ),
                            provenance: ProvenanceBinding::new(
                                take_identity(&mut self.next_identity),
                                crate::growth::ProvenanceExpression::iteration(
                                    matches!(domain, LoopDomain::Page(_) | LoopDomain::Recurse(_)),
                                    nested_iteration,
                                ),
                            ),
                            rewrite: None,
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
                        self.rewrite = self.expression_rewrite(value, variables);
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
                self.expression(value, variables)
                    .saturating_div(u64::from(*max).max(1)),
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
            Expr::Field { base, .. } => self.expression(base, variables),
            Expr::Array(values) => {
                collection_bytes(values.iter().map(|value| self.expression(value, variables)))
            }
            Expr::Object(values) => values.iter().fold(2_u64, |size, (name, value)| {
                size.saturating_add(name.len() as u64)
                    .saturating_add(4)
                    .saturating_add(self.expression(value, variables))
            }),
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
                Builtin::Slice => {
                    let source = args.first();
                    let merge_table = source.and_then(|value| match value {
                        Expr::Builtin {
                            builtin: Builtin::DedupeById { table, .. },
                            ..
                        } => Some(table),
                        _ => None,
                    });
                    let literal_take = args.get(2).and_then(|value| match value {
                        Expr::Literal(Value::Int(value)) if *value >= 0 => Some(*value as u64),
                        _ => None,
                    });
                    match (source, merge_table, literal_take) {
                        (Some(_), Some(table), Some(take)) => Self::repeated(self.row(table), take),
                        (Some(value), _, _) => self.expression(value, variables),
                        _ => 0,
                    }
                }
                Builtin::Sort { .. } | Builtin::DedupeById { .. } => args
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
                Builtin::MentionTokens => args
                    .first()
                    .map(|value| self.expression(value, variables).saturating_mul(2))
                    .unwrap_or(2),
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
        }
    }

    fn repeated(element: u64, count: u64) -> u64 {
        2_u64.saturating_add(count.saturating_mul(element.saturating_add(1)))
    }
}
