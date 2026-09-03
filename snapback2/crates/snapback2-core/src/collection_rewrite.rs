use crate::bounds::declared_serialized_row_max;
use crate::growth::{ProvenanceBinding, expression_from as provenance_expression_from};
use crate::ir::*;
use crate::schema::Schema;
use crate::value::{Value, canonical_json};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) struct OutputEstimator<'a> {
    pub(crate) schema: &'a Schema,
    pub(crate) max_result: u64,
    pub(crate) next_identity: u64,
    pub(crate) args: BTreeSet<String>,
    pub(crate) rewrite: Option<(u64, CollectionRewrite)>,
}

#[derive(Clone)]
pub(crate) struct OutputBound {
    pub(crate) bytes: u64,
    pub(crate) instances: u64,
    pub(crate) collection: bool,
    pub(crate) table: Option<String>,
    pub(crate) provenance: ProvenanceBinding,
    pub(crate) rewrite: Option<(u64, CollectionRewrite)>,
    pub(crate) value: Expr,
}

pub(crate) struct OutputEstimate {
    pub(crate) bytes: u64,
    pub(crate) rewrite: Option<(u64, CollectionRewrite)>,
}

pub(crate) struct OutputAssignmentPrice {
    pub(crate) bytes: u64,
    pub(crate) collection: bool,
    pub(crate) table: Option<String>,
    pub(crate) rewrite: Option<(u64, CollectionRewrite)>,
}

#[derive(Clone)]
pub(crate) struct CollectionRewrite {
    args: BTreeSet<String>,
    loops: Vec<(String, LoopDomain)>,
    target: String,
    value: Expr,
}

impl OutputEstimator<'_> {
    pub(crate) fn row(&self, table: &str) -> u64 {
        declared_serialized_row_max(self.schema, table)
    }

    pub(crate) fn merge_variables(
        variables: &mut BTreeMap<String, OutputBound>,
        branch: BTreeMap<String, OutputBound>,
    ) {
        for (name, bound) in branch {
            variables
                .entry(name)
                .and_modify(|current| {
                    let table = merged_table(current, &bound);
                    if bound.bytes > current.bytes {
                        current.bytes = bound.bytes;
                        current.rewrite = bound.rewrite.clone();
                        current.value = bound.value.clone();
                    } else if bound.bytes == current.bytes
                        && current.rewrite.is_none()
                        && bound.rewrite.is_some()
                    {
                        current.rewrite = bound.rewrite.clone();
                    }
                    current.instances = current.instances.min(bound.instances);
                    current.collection |= bound.collection;
                    current.table = table;
                    current.provenance.merge(&bound.provenance);
                })
                .or_insert(bound);
        }
    }

    pub(crate) fn expression_rewrite(
        &self,
        expression: &Expr,
        variables: &BTreeMap<String, OutputBound>,
    ) -> Option<(u64, CollectionRewrite)> {
        let largest = |values: Vec<&Expr>| {
            values
                .into_iter()
                .filter_map(|value| self.expression_rewrite(value, variables))
                .max_by_key(|(bytes, _)| *bytes)
        };
        match expression {
            Expr::Variable(name) => variables.get(name).and_then(|bound| bound.rewrite.clone()),
            Expr::Field { base, .. } => self.expression_rewrite(base, variables),
            Expr::Array(values) => largest(values.iter().collect()),
            Expr::Object(values) => largest(values.values().collect()),
            Expr::Builtin { builtin, args } => match builtin {
                Builtin::Slice | Builtin::Sort { .. } | Builtin::DedupeById { .. } => args
                    .first()
                    .and_then(|value| self.expression_rewrite(value, variables)),
                Builtin::Concat => largest(args.iter().collect()),
                Builtin::Len
                | Builtin::MentionTokens
                | Builtin::Min
                | Builtin::Max
                | Builtin::Divmod { .. }
                | Builtin::DeterministicShare
                | Builtin::Count
                | Builtin::Sum
                | Builtin::CountCapped => None,
            },
            Expr::Literal(_)
            | Expr::Input(_)
            | Expr::Binary { .. }
            | Expr::Unary { .. }
            | Expr::Get(_)
            | Expr::Exists(_)
            | Expr::Scan(_) => None,
        }
    }
}

fn merged_table(current: &OutputBound, incoming: &OutputBound) -> Option<String> {
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

impl CollectionRewrite {
    pub(crate) fn for_assignment(
        args: BTreeSet<String>,
        loops: &[(String, LoopDomain)],
        target: &str,
        value: &Expr,
        variables: &BTreeMap<String, OutputBound>,
    ) -> Self {
        let identity = variables
            .get(target)
            .map(|bound| bound.provenance.identity)
            .unwrap_or(0);
        let available = args
            .iter()
            .cloned()
            .chain(loops.iter().map(|(binding, _)| binding.clone()))
            .collect();
        let value = fresh_collection_value(
            value,
            target,
            identity,
            variables,
            &available,
            &mut BTreeSet::new(),
        )
        .unwrap_or_else(|| {
            loops.last().map_or_else(
                || Expr::Array(Vec::new()),
                |(binding, _)| Expr::Array(vec![Expr::Variable(binding.clone())]),
            )
        });
        Self {
            loops: resolve_loops(loops, variables, &args),
            args,
            target: target.to_owned(),
            value: ensure_collection(value),
        }
    }

    pub(crate) fn for_push(
        args: BTreeSet<String>,
        loops: &[(String, LoopDomain)],
        target: &str,
        value: &Expr,
        variables: &BTreeMap<String, OutputBound>,
    ) -> Self {
        let available = args
            .iter()
            .cloned()
            .chain(loops.iter().map(|(binding, _)| binding.clone()))
            .collect();
        Self {
            loops: resolve_loops(loops, variables, &args),
            args,
            target: target.to_owned(),
            value: Expr::Array(vec![inline_expr(
                value,
                variables,
                &available,
                &mut BTreeSet::new(),
            )]),
        }
    }

    pub(crate) fn render(&self) -> String {
        let empty = if matches!(self.value, Expr::Object(_)) {
            "{}"
        } else {
            "[]"
        };
        let mut source = format!("let {} = {empty};\n", self.target);
        let mut indent = String::new();
        for (binding, domain) in &self.loops {
            source.push_str(&format!(
                "{indent}for (const {binding} of {}) {{\n",
                render_domain(domain, &self.args)
            ));
            indent.push_str("  ");
        }
        source.push_str(&format!(
            "{indent}{} = {};\n",
            self.target,
            render_expr(&self.value, &self.args)
        ));
        for _ in self.loops.iter().rev() {
            indent.truncate(indent.len().saturating_sub(2));
            source.push_str(&format!("{indent}}}\n"));
        }
        source.push_str(&format!("return {};", self.target));
        source
    }
}

fn ensure_collection(value: Expr) -> Expr {
    match value {
        Expr::Array(_) | Expr::Object(_) => value,
        other => Expr::Array(vec![other]),
    }
}

fn fresh_collection_value(
    value: &Expr,
    target: &str,
    target_identity: u64,
    variables: &BTreeMap<String, OutputBound>,
    available: &BTreeSet<String>,
    visiting: &mut BTreeSet<String>,
) -> Option<Expr> {
    if let Expr::Variable(name) = value {
        if name == target {
            return None;
        }
        if available.contains(name) || !variables.contains_key(name) {
            return Some(value.clone());
        }
        if !visiting.insert(name.clone()) {
            return None;
        }
        let resolved = variables.get(name).and_then(|bound| {
            fresh_collection_value(
                &bound.value,
                target,
                target_identity,
                variables,
                available,
                visiting,
            )
        });
        visiting.remove(name);
        return resolved;
    }

    let provenance = provenance_expression_from(value, variables, |bound| &bound.provenance, 0);
    if !provenance.references(target_identity) {
        return Some(inline_expr(
            value,
            variables,
            available,
            &mut BTreeSet::new(),
        ));
    }

    match value {
        Expr::Array(values) => Some(Expr::Array(
            values
                .iter()
                .filter_map(|value| {
                    fresh_collection_value(
                        value,
                        target,
                        target_identity,
                        variables,
                        available,
                        visiting,
                    )
                })
                .collect(),
        )),
        Expr::Object(values) => Some(Expr::Object(
            values
                .iter()
                .filter_map(|(name, value)| {
                    fresh_collection_value(
                        value,
                        target,
                        target_identity,
                        variables,
                        available,
                        visiting,
                    )
                    .map(|value| (name.clone(), value))
                })
                .collect(),
        )),
        Expr::Builtin {
            builtin: Builtin::Concat,
            args,
        } => {
            let mut fresh: Vec<_> = args
                .iter()
                .filter_map(|value| {
                    fresh_collection_value(
                        value,
                        target,
                        target_identity,
                        variables,
                        available,
                        visiting,
                    )
                })
                .collect();
            match fresh.len() {
                0 => None,
                1 => fresh.pop(),
                _ => Some(Expr::Builtin {
                    builtin: Builtin::Concat,
                    args: fresh,
                }),
            }
        }
        _ => None,
    }
}

fn resolve_loops(
    loops: &[(String, LoopDomain)],
    variables: &BTreeMap<String, OutputBound>,
    initially_available: &BTreeSet<String>,
) -> Vec<(String, LoopDomain)> {
    let mut available = initially_available.clone();
    let mut resolved = Vec::new();
    for (binding, domain) in loops {
        let domain = inline_domain(domain, variables, &available);
        resolved.push((binding.clone(), domain));
        available.insert(binding.clone());
    }
    resolved
}

fn inline_domain(
    domain: &LoopDomain,
    variables: &BTreeMap<String, OutputBound>,
    available: &BTreeSet<String>,
) -> LoopDomain {
    let mut visiting = BTreeSet::new();
    match domain {
        LoopDomain::Page(scan) => {
            LoopDomain::Page(inline_scan(scan, variables, available, &mut visiting))
        }
        LoopDomain::LiteralRange {
            start,
            end_exclusive,
        } => LoopDomain::LiteralRange {
            start: *start,
            end_exclusive: *end_exclusive,
        },
        LoopDomain::ArgList { name, max } => LoopDomain::ArgList {
            name: name.clone(),
            max: *max,
        },
        LoopDomain::DerivedArray {
            value,
            max,
            bound_source,
        } => LoopDomain::DerivedArray {
            value: inline_expr(value, variables, available, &mut visiting),
            max: *max,
            bound_source: bound_source.clone(),
        },
        LoopDomain::Recurse(recurse) => LoopDomain::Recurse(Recurse {
            site: recurse.site.clone(),
            table: recurse.table.clone(),
            index: recurse.index.clone(),
            seed: Box::new(inline_expr(
                &recurse.seed,
                variables,
                available,
                &mut visiting,
            )),
            next_field: recurse.next_field.clone(),
            depth: recurse.depth,
            fanout: recurse.fanout,
            provenance: recurse.provenance,
        }),
    }
}

fn inline_expr(
    value: &Expr,
    variables: &BTreeMap<String, OutputBound>,
    available: &BTreeSet<String>,
    visiting: &mut BTreeSet<String>,
) -> Expr {
    match value {
        Expr::Variable(name) if !available.contains(name) => {
            let Some(bound) = variables.get(name) else {
                return value.clone();
            };
            if !visiting.insert(name.clone()) {
                return value.clone();
            }
            let resolved = inline_expr(&bound.value, variables, available, visiting);
            visiting.remove(name);
            resolved
        }
        Expr::Field { base, name } => Expr::Field {
            base: Box::new(inline_expr(base, variables, available, visiting)),
            name: name.clone(),
        },
        Expr::Array(values) => Expr::Array(
            values
                .iter()
                .map(|value| inline_expr(value, variables, available, visiting))
                .collect(),
        ),
        Expr::Object(values) => Expr::Object(
            values
                .iter()
                .map(|(name, value)| {
                    (
                        name.clone(),
                        inline_expr(value, variables, available, visiting),
                    )
                })
                .collect(),
        ),
        Expr::Binary { op, left, right } => Expr::Binary {
            op: *op,
            left: Box::new(inline_expr(left, variables, available, visiting)),
            right: Box::new(inline_expr(right, variables, available, visiting)),
        },
        Expr::Unary { op, value } => Expr::Unary {
            op: *op,
            value: Box::new(inline_expr(value, variables, available, visiting)),
        },
        Expr::Builtin { builtin, args } => Expr::Builtin {
            builtin: builtin.clone(),
            args: args
                .iter()
                .map(|value| inline_expr(value, variables, available, visiting))
                .collect(),
        },
        Expr::Get(read) => Expr::Get(inline_read(read, variables, available, visiting)),
        Expr::Exists(read) => Expr::Exists(inline_read(read, variables, available, visiting)),
        Expr::Scan(scan) => Expr::Scan(inline_scan(scan, variables, available, visiting)),
        Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_) => value.clone(),
    }
}

fn inline_read(
    read: &Read,
    variables: &BTreeMap<String, OutputBound>,
    available: &BTreeSet<String>,
    visiting: &mut BTreeSet<String>,
) -> Read {
    Read {
        site: read.site.clone(),
        table: read.table.clone(),
        index: read.index.clone(),
        key: read
            .key
            .iter()
            .map(|value| inline_expr(value, variables, available, visiting))
            .collect(),
        provenance: read.provenance,
    }
}

fn inline_scan(
    scan: &Scan,
    variables: &BTreeMap<String, OutputBound>,
    available: &BTreeSet<String>,
    visiting: &mut BTreeSet<String>,
) -> Scan {
    Scan {
        site: scan.site.clone(),
        table: scan.table.clone(),
        index: scan.index.clone(),
        prefix: scan
            .prefix
            .iter()
            .map(|value| inline_expr(value, variables, available, visiting))
            .collect(),
        order: scan.order,
        take: scan.take.clone(),
        after: scan
            .after
            .as_deref()
            .map(|value| Box::new(inline_expr(value, variables, available, visiting))),
        before: scan
            .before
            .as_deref()
            .map(|value| Box::new(inline_expr(value, variables, available, visiting))),
        range: scan.range.as_ref().map(|range| Range {
            gt: range
                .gt
                .as_deref()
                .map(|value| Box::new(inline_expr(value, variables, available, visiting))),
            gte: range
                .gte
                .as_deref()
                .map(|value| Box::new(inline_expr(value, variables, available, visiting))),
            lt: range
                .lt
                .as_deref()
                .map(|value| Box::new(inline_expr(value, variables, available, visiting))),
            lte: range
                .lte
                .as_deref()
                .map(|value| Box::new(inline_expr(value, variables, available, visiting))),
        }),
        optional_cursor_args: scan.optional_cursor_args.clone(),
        merge_site: scan.merge_site.clone(),
        provenance: scan.provenance,
    }
}

fn render_domain(domain: &LoopDomain, args: &BTreeSet<String>) -> String {
    match domain {
        LoopDomain::Page(scan) => render_scan(scan, args),
        LoopDomain::LiteralRange {
            start,
            end_exclusive,
        } => format!("range({start}, {end_exclusive})"),
        LoopDomain::ArgList { name, .. } => format!("args.{name}"),
        LoopDomain::DerivedArray { value, .. } => render_expr(value, args),
        LoopDomain::Recurse(recurse) => format!(
            "recurse({}, (_node) => db.get({}.{}, [_node.{}]), {{ depth: {}, fanout: {} }})",
            render_expr(&recurse.seed, args),
            recurse.table,
            recurse.index,
            recurse.next_field,
            recurse.depth,
            recurse.fanout
        ),
    }
}

fn render_scan(scan: &Scan, args: &BTreeSet<String>) -> String {
    let prefix = scan
        .prefix
        .iter()
        .map(|value| render_expr(value, args))
        .collect::<Vec<_>>()
        .join(", ");
    let take = match &scan.take {
        Bound::Literal(value) => value.to_string(),
        Bound::Arg { name, .. } => format!("args.{name}"),
    };
    let mut options = vec![format!("take: {take}")];
    if scan.order == Order::Desc {
        options.push("order: \"desc\"".to_owned());
    }
    if let Some(after) = &scan.after {
        options.push(format!("after: {}", render_expr(after, args)));
    }
    if let Some(before) = &scan.before {
        options.push(format!("before: {}", render_expr(before, args)));
    }
    if let Some(range) = &scan.range {
        let mut fields = Vec::new();
        for (name, value) in [
            ("gt", range.gt.as_deref()),
            ("gte", range.gte.as_deref()),
            ("lt", range.lt.as_deref()),
            ("lte", range.lte.as_deref()),
        ] {
            if let Some(value) = value {
                fields.push(format!("{name}: {}", render_expr(value, args)));
            }
        }
        options.push(format!("range: {{ {} }}", fields.join(", ")));
    }
    format!(
        "db.scan({}.{}, [{prefix}], {{ {} }})",
        scan.table,
        scan.index,
        options.join(", ")
    )
}

fn render_expr(value: &Expr, args: &BTreeSet<String>) -> String {
    match value {
        Expr::Literal(value) => render_value(value),
        Expr::Variable(name) if args.contains(name) => format!("args.{name}"),
        Expr::Variable(name) => name.clone(),
        Expr::Input(Input::Viewer) => "ctx.viewer".to_owned(),
        Expr::Input(Input::Now) => "ctx.now()".to_owned(),
        Expr::Input(Input::NewId) => "ctx.newId()".to_owned(),
        Expr::Input(Input::ReadTime) => "ctx.readTime".to_owned(),
        Expr::Field { base, name } => format!("{}.{}", render_expr(base, args), name),
        Expr::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(|value| render_expr(value, args))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        Expr::Object(values) => format!(
            "{{ {} }}",
            values
                .iter()
                .map(|(name, value)| format!("{name}: {}", render_expr(value, args)))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        Expr::Binary { op, left, right } => format!(
            "({} {} {})",
            render_expr(left, args),
            match op {
                BinaryOp::Eq => "===",
                BinaryOp::Ne => "!==",
                BinaryOp::SameValueZero => "===",
                BinaryOp::Lt => "<",
                BinaryOp::Lte => "<=",
                BinaryOp::Gt => ">",
                BinaryOp::Gte => ">=",
                BinaryOp::Add => "+",
                BinaryOp::Sub => "-",
                BinaryOp::Mul => "*",
                BinaryOp::And => "&&",
                BinaryOp::Or => "||",
            },
            render_expr(right, args)
        ),
        Expr::Unary { op, value } => format!(
            "{}{}",
            match op {
                UnaryOp::Not => "!",
                UnaryOp::Neg => "-",
            },
            render_expr(value, args)
        ),
        Expr::Builtin {
            builtin,
            args: values,
        } => {
            let rendered: Vec<_> = values
                .iter()
                .map(|value| render_expr(value, args))
                .collect();
            match builtin {
                Builtin::Len => format!("{}.length", rendered.first().map_or("[]", String::as_str)),
                Builtin::Slice => format!(
                    "{}.slice({})",
                    rendered.first().map_or("[]", String::as_str),
                    rendered
                        .iter()
                        .skip(1)
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                Builtin::Concat => format!(
                    "[{}]",
                    rendered
                        .iter()
                        .map(|value| format!("...{value}"))
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                Builtin::MentionTokens => format!("mentionTokens({})", rendered.join(", ")),
                Builtin::Min => format!("min({})", rendered.join(", ")),
                Builtin::Max => format!("max({})", rendered.join(", ")),
                Builtin::Divmod { .. } => format!("divmod({})", rendered.join(", ")),
                Builtin::Sort { .. } | Builtin::DedupeById { .. } => {
                    rendered.first().cloned().unwrap_or_else(|| "[]".to_owned())
                }
                Builtin::DeterministicShare => {
                    format!("deterministicShare({})", rendered.join(", "))
                }
                Builtin::Count | Builtin::CountCapped => {
                    format!("{}.count()", rendered.first().map_or("[]", String::as_str))
                }
                Builtin::Sum => format!("{}.sum()", rendered.first().map_or("[]", String::as_str)),
            }
        }
        Expr::Get(read) => format!(
            "db.get({}.{}, [{}])",
            read.table,
            read.index,
            read.key
                .iter()
                .map(|value| render_expr(value, args))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        Expr::Exists(read) => format!(
            "db.exists({}.{}, [{}])",
            read.table,
            read.index,
            read.key
                .iter()
                .map(|value| render_expr(value, args))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        Expr::Scan(scan) => render_scan(scan, args),
    }
}

fn render_value(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(value) => value.to_string(),
        Value::Int(value) => value.to_string(),
        Value::String(value) | Value::Id(value) => {
            serde_json::to_string(value).expect("string serializes")
        }
        Value::Bytes(_) => canonical_json(value),
        Value::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(render_value)
                .collect::<Vec<_>>()
                .join(", ")
        ),
        Value::Row(values) | Value::Map(values) => format!(
            "{{ {} }}",
            values
                .iter()
                .map(|(name, value)| format!(
                    "{}: {}",
                    serde_json::to_string(name).expect("key serializes"),
                    render_value(value)
                ))
                .collect::<Vec<_>>()
                .join(", ")
        ),
    }
}
