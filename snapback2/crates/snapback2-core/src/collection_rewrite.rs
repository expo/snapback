//! Byte-bound explanations follow the estimator's value flow; they never invent a replacement result.
use crate::bounds::{declared_serialized_column_max, declared_serialized_row_max};
use crate::growth::ProvenanceBinding;
use crate::ir::*;
use crate::schema::Schema;
use crate::value::Value;
use std::collections::BTreeMap;

pub(crate) struct OutputEstimator<'a> {
    pub(crate) schema: &'a Schema,
    pub(crate) max_result: u64,
    pub(crate) retained_bytes: u64,
    pub(crate) next_identity: u64,
    pub(crate) shape: ByteShape,
}
#[derive(Clone)]
pub(crate) struct OutputBound {
    pub(crate) whole_element: bool,
    pub(crate) bytes: u64,
    pub(crate) instances: u64,
    pub(crate) collection: bool,
    pub(crate) text: bool,
    pub(crate) table: Option<String>,
    pub(crate) provenance: ProvenanceBinding,
    pub(crate) shape: ByteShape,
    pub(crate) value: Expr,
}
pub(crate) struct OutputEstimate {
    pub bytes: u64,
    pub retained_bytes: u64,
    pub shape: ByteShape,
}
pub(crate) struct OutputAssignmentPrice {
    pub(crate) bytes: u64,
    pub(crate) collection: bool,
    pub(crate) text: bool,
    pub(crate) table: Option<String>,
    pub(crate) shape: ByteShape,
}

#[derive(Clone, Default)]
pub(crate) struct ByteShape {
    pub bytes: u64,
    pub label: String,
    pub children: Vec<ByteShape>,
    pub repeat: Option<u64>,
}
impl ByteShape {
    pub fn leaf(bytes: u64, label: impl Into<String>) -> Self {
        Self {
            bytes,
            label: label.into(),
            ..Self::default()
        }
    }
    pub fn group(bytes: u64, label: impl Into<String>, children: Vec<Self>) -> Self {
        Self {
            bytes,
            label: label.into(),
            children,
            repeat: None,
        }
    }
    pub fn repeated(bytes: u64, label: impl Into<String>, n: u64, element: Self) -> Self {
        Self {
            bytes,
            label: label.into(),
            children: vec![element],
            repeat: Some(n),
        }
    }
    pub fn render(&self) -> String {
        if self.children.is_empty() {
            return format!("{} = {} bytes", self.label, self.bytes);
        }
        if let Some(n) = self.repeat {
            let subtotal = n.saturating_mul(self.children[0].bytes);
            let adjustment = if subtotal < self.bytes {
                format!(
                    " + collection framing/growth reserve = {} bytes",
                    self.bytes - subtotal
                )
            } else if subtotal > self.bytes {
                format!(
                    " - shared collection encoding adjustment = {} bytes",
                    subtotal - self.bytes
                )
            } else {
                String::new()
            };
            return format!(
                "{} × ({}){} = {} bytes",
                self.label,
                self.children[0].render(),
                adjustment,
                self.bytes
            );
        }
        let mut children: Vec<_> = self.children.iter().collect();
        children.sort_by(|a, b| b.bytes.cmp(&a.bytes).then(a.label.cmp(&b.label)));
        let sum = children
            .iter()
            .fold(0_u64, |n, c| n.saturating_add(c.bytes));
        let adjustment = if sum < self.bytes {
            format!(" + framing/value overhead = {} bytes", self.bytes - sum)
        } else if sum > self.bytes {
            format!(
                " - shared row encoding adjustment = {} bytes",
                sum - self.bytes
            )
        } else {
            String::new()
        };
        format!(
            "{} [{}{}] = {} bytes",
            self.label,
            children
                .iter()
                .map(|c| c.render())
                .collect::<Vec<_>>()
                .join(" + "),
            adjustment,
            self.bytes
        )
    }
    pub fn collection_label(&self) -> String {
        if self.repeat.is_some() {
            return self.label.clone();
        }
        self.children
            .iter()
            .max_by_key(|c| c.bytes)
            .map(|c| c.collection_label())
            .unwrap_or_else(|| self.label.clone())
    }
    fn merge_label(&self) -> Option<&str> {
        if self.label.starts_with("merge ") {
            // A final slice keeps the source site, not the collector's pre-slice repetitions.
            self.label.split_once(": ").map(|(site, _)| site)
        } else {
            self.children.iter().find_map(Self::merge_label)
        }
    }
    fn fields(&self, out: &mut Vec<String>) {
        if self.children.is_empty() {
            if self.bytes > 0 {
                out.push(format!("{} ({} bytes)", self.label, self.bytes));
            }
        } else {
            for child in &self.children {
                child.fields(out);
            }
        }
    }
    // Choose an innermost collection by its contribution after outer repetitions.
    // A page's total width must not hide its two large sub-lists.
    fn widest<'a>(
        &'a self,
        scale: u64,
        path: String,
        best: &mut Option<(u64, String, &'a Self)>,
    ) -> bool {
        let nested_path = if self.repeat.is_some() {
            if path.is_empty() {
                self.label.clone()
            } else {
                format!("{path} × {}", self.label)
            }
        } else {
            path.clone()
        };
        let mut has_repeat = false;
        for child in &self.children {
            has_repeat |= child.widest(
                scale.saturating_mul(self.repeat.unwrap_or(1)),
                nested_path.clone(),
                best,
            );
        }
        if self.repeat.is_some() && !has_repeat {
            let bytes = self.bytes.saturating_mul(scale);
            if best.as_ref().is_none_or(|(old, _, _)| bytes > *old) {
                *best = Some((bytes, nested_path, self));
            }
        }
        has_repeat || self.repeat.is_some()
    }
    pub fn rewrite(&self) -> String {
        let mut best = None;
        self.widest(1, String::new(), &mut best);
        let (name, shape) = best
            .map(|(_, name, shape)| (name, shape))
            .unwrap_or((self.label.clone(), self));
        let mut fields = Vec::new();
        shape.fields(&mut fields);
        fields.sort();
        fields.dedup();
        let repair = format!(
            "reduce the widest nested collection {name}, or narrow the fields carrying its bytes: {}; split detail reads if necessary (separate reads are two snapshots)",
            fields.join(", ")
        );
        if name.contains("merge ") {
            format!(
                "structural repair: use a smaller lane bound, a smaller page, two reads (they are two snapshots), or a maintained feed; {repair}"
            )
        } else {
            repair
        }
    }
}

impl OutputEstimator<'_> {
    pub(crate) fn row(&self, table: &str) -> u64 {
        declared_serialized_row_max(self.schema, table)
    }
    pub(crate) fn row_shape(&self, table: &str) -> ByteShape {
        row_shape(self.schema, table)
    }
    pub(crate) fn merge_variables(
        variables: &mut BTreeMap<String, OutputBound>,
        branch: BTreeMap<String, OutputBound>,
    ) {
        for (name, bound) in branch {
            variables
                .entry(name)
                .and_modify(|current| {
                    let table = match (&current.table, &bound.table) {
                        (Some(a), Some(b)) if a == b => Some(a.clone()),
                        (Some(a), None) if matches!(bound.value, Expr::Literal(Value::Null)) => {
                            Some(a.clone())
                        }
                        (None, Some(b)) if matches!(current.value, Expr::Literal(Value::Null)) => {
                            Some(b.clone())
                        }
                        _ => None,
                    };
                    current.whole_element |= bound.whole_element;
                    if bound.bytes > current.bytes {
                        current.bytes = bound.bytes;
                        current.shape = bound.shape.clone();
                        current.value = bound.value.clone();
                    }
                    current.instances = current.instances.min(bound.instances);
                    current.collection |= bound.collection;
                    current.text &= bound.text;
                    current.table = table;
                    current.provenance.merge(&bound.provenance);
                })
                .or_insert(bound);
        }
    }
    pub(crate) fn expression_shape(
        &self,
        expr: &Expr,
        vars: &BTreeMap<String, OutputBound>,
    ) -> ByteShape {
        let bytes = self.expression(expr, vars);
        let mut shape = match expr {
            Expr::Variable(name) => vars
                .get(name)
                .map(|b| b.shape.clone())
                .unwrap_or_else(|| ByteShape::leaf(bytes, name)),
            Expr::Field { base, name } => ByteShape::leaf(
                bytes,
                format!(
                    "{}.{}",
                    self.expression_table(base, vars)
                        .unwrap_or_else(|| "shape".into()),
                    name
                ),
            ),
            Expr::Get(read) => self.row_shape(&read.table),
            Expr::Merge(merge) => ByteShape::repeated(
                self.expression(expr, vars),
                format!("merge {}: emitted page", merge.site),
                merge.take(),
                row_shape(self.schema, merge.table()),
            ),
            Expr::Scan(scan) => ByteShape::repeated(
                bytes,
                scan_label(scan),
                scan.take.maximum(),
                self.row_shape(&scan.table),
            ),
            Expr::Object(fields) => ByteShape::group(
                bytes,
                "shape",
                fields
                    .iter()
                    .map(|(name, expr)| {
                        let child = self.expression_shape(expr, vars);
                        ByteShape::group(child.bytes, name, vec![child])
                    })
                    .collect(),
            ),
            Expr::Array(values) => ByteShape::group(
                bytes,
                "array",
                values
                    .iter()
                    .map(|value| self.expression_shape(value, vars))
                    .collect(),
            ),
            Expr::Builtin {
                builtin: Builtin::Slice | Builtin::Sort { .. },
                args,
            } => {
                let source = args
                    .first()
                    .map(|v| self.expression_shape(v, vars))
                    .unwrap_or_default();
                if source.bytes == bytes {
                    source
                } else if let (Some(table), Some(Expr::Literal(Value::Int(n)))) =
                    (self.expression_table(expr, vars), args.get(2))
                {
                    ByteShape::repeated(
                        bytes,
                        source.merge_label().map_or_else(
                            || format!("{table} first {n}"),
                            |merge| format!("{merge}: {table} first {n} after merge"),
                        ),
                        (*n).max(0) as u64,
                        self.row_shape(&table),
                    )
                } else {
                    ByteShape::leaf(bytes, "bounded result slice")
                }
            }
            Expr::Builtin {
                builtin: Builtin::Concat,
                args,
            } => ByteShape::group(
                bytes,
                "concatenated collections",
                args.iter()
                    .map(|v| self.expression_shape(v, vars))
                    .collect(),
            ),
            Expr::Builtin { builtin, .. } => ByteShape::leaf(bytes, format!("{builtin:?} result")),
            Expr::Input(input) => ByteShape::leaf(bytes, format!("{input:?}")),
            Expr::Literal(_) => ByteShape::leaf(bytes, "literal value"),
            _ => ByteShape::leaf(bytes, "scalar expression"),
        };
        shape.bytes = bytes;
        shape
    }
}

pub(crate) fn scan_label(scan: &Scan) -> String {
    let range = format!(
        "{} {} {} at {}",
        scan.table,
        if scan.order == Order::Asc {
            "first"
        } else {
            "last"
        },
        scan.take.maximum(),
        scan.site
    );
    scan.merge_site
        .as_ref()
        .map_or(range.clone(), |site| format!("merge {site}: {range}"))
}
pub(crate) fn row_shape(schema: &Schema, table: &str) -> ByteShape {
    ByteShape::group(
        declared_serialized_row_max(schema, table),
        format!("{table} row width"),
        schema
            .table(table)
            .into_iter()
            .flat_map(|t| &t.columns)
            .filter_map(|(name, _)| {
                declared_serialized_column_max(schema, table, name)
                    .map(|bytes| ByteShape::leaf(bytes, format!("{table}.{name}")))
            })
            .collect(),
    )
}
