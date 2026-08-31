pub use crate::bounds::{declared_serialized_row_max, max_certified_page_rows};
use crate::collection_rewrite::{
    CollectionRewrite, OutputAssignmentPrice, OutputBound, OutputEstimate, OutputEstimator,
};
use crate::growth::{
    ProvenanceBinding, assignment_growth, collection_price_from,
    expression_from as provenance_expression_from, saturating_power, take_identity,
};
use crate::ir::*;
use crate::retention::{RetentionEstimator, argument_max, collection_bytes};
use crate::schema::{Constraint, MaintainKind, RuleExpr, Schema};
use crate::value::{Value, canonical_json, digest};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

// Heap is calibrated; output/closure use declared maxima. These are admission bounds, not allocator/serializer proofs.
const HEAP_BYTES_PER_STEP: u64 = 32;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ceilings {
    pub examined: u64,
    pub index_entries: u64,
    pub rule_probes: u64,
    pub steps: u64,
    pub heap_bytes: u64,
    pub output_bytes: u64,
    pub closure_bytes: u64,
    pub write_rows: u64,
}

impl Default for Ceilings {
    fn default() -> Self {
        Self {
            examined: 10_240,
            index_entries: 10_240,
            rule_probes: 10_240,
            steps: 1_000_000,
            heap_bytes: 8 * 1024 * 1024,
            output_bytes: 1024 * 1024,
            closure_bytes: 4 * 1024 * 1024,
            write_rows: 2_048,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Certificate {
    pub program: String,
    pub plan_hash: String,
    pub schema_hash: String,
    pub rule_hashes: BTreeMap<String, String>,
    pub evaluator_version: String,
    pub value_model_version: String,
    pub read_sites: Vec<ReadSite>,
    pub write_sites: Vec<WriteSite>,
    pub maintained_amplification: u64,
    pub constraint_checks: Vec<String>,
    pub max_examined: u64,
    pub max_index_entries: u64,
    pub max_rule_probes: u64,
    pub max_steps: u64,
    pub max_heap_bytes: u64,
    pub max_output_bytes: u64,
    pub max_closure_bytes: u64,
    pub completeness: Completeness,
    pub prediction_sites: Vec<PredictionSite>,
    pub read_time_granularity_ms: Option<u64>,
    pub halo_rows: u32,
    pub indexes_required: Vec<String>,
    pub disclosures: Vec<String>,
    pub bound_product: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuleCertificate {
    pub schema_hash: String,
    pub rule_hash: String,
    pub max_rule_probes: u64,
    pub max_steps: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReadSite {
    pub site: String,
    pub table: String,
    pub index: String,
    pub prefix_template: KeyProvenance,
    pub take: u64,
    pub max_calls: u64,
    pub hoist: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WriteSite {
    pub table: String,
    pub kind: WriteKind,
    pub max_rows: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum WriteKind {
    Insert,
    Update,
    Upsert,
    Delete,
    Emit,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PredictionSite {
    pub transition: String,
    pub reads: Vec<String>,
    pub mode: PredictionMode,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PredictionMode {
    Closed,
    Partial,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Completeness {
    Page,
    Capped,
    Maintained,
    All,
}

#[derive(Clone, Debug, Error, PartialEq, Eq)]
#[error("{code}: {message}; rewrite: {rewrite}")]
pub struct CheckError {
    pub code: String,
    pub message: String,
    pub rewrite: String,
}

pub struct Checker<'a> {
    schema: &'a Schema,
    ceilings: Ceilings,
}

impl<'a> Checker<'a> {
    pub fn new(schema: &'a Schema, ceilings: Ceilings) -> Self {
        Self { schema, ceilings }
    }

    pub fn check(&self, program: &Program) -> Result<Certificate, CheckError> {
        self.check_all(program).map_err(|errors| {
            errors
                .into_iter()
                .next()
                .expect("checker returned no errors")
        })
    }

    pub fn check_all(&self, program: &Program) -> Result<Certificate, Vec<CheckError>> {
        let mut errors = self.structural_errors(program);
        match self.analyze(program) {
            Ok(certificate) if errors.is_empty() => Ok(certificate),
            Ok(_) => Err(errors),
            Err(mut analysis_errors) => {
                errors.append(&mut analysis_errors);
                Err(errors)
            }
        }
    }

    // @ref LLP 1001#7-channels-schemachannels — channel admission is a
    // certified rule site with transitive visibility-probe and step bounds.
    pub fn check_rule(&self, rule: &RuleExpr) -> Result<RuleCertificate, Vec<CheckError>> {
        let analyzer = Analyzer::new(self.schema);
        let max_rule_probes = analyzer.rule_probe_bound(rule);
        let max_steps = analyzer.rule_step_bound(rule);
        let summary = Summary {
            rule_probes: max_rule_probes,
            steps: max_steps,
            ..Summary::default()
        };
        let mut errors = Vec::new();
        for (name, actual, ceiling) in [
            ("rule probes", max_rule_probes, self.ceilings.rule_probes),
            ("steps", max_steps, self.ceilings.steps),
        ] {
            // Rules have no collection-growth rewrite; Generation::certify attaches the
            // responsible channel.<name>.<side> site to each returned refusal.
            if let Err(error) = self.check_ceiling(name, actual, ceiling, &summary, None) {
                errors.push(error);
            }
        }
        if errors.is_empty() {
            Ok(RuleCertificate {
                schema_hash: self.schema.hash(),
                rule_hash: self.schema.rule_hash(rule),
                max_rule_probes,
                max_steps,
            })
        } else {
            Err(errors)
        }
    }

    fn analyze(&self, program: &Program) -> Result<Certificate, Vec<CheckError>> {
        let mut analyzer = Analyzer::new(self.schema);
        let summary = analyzer
            .statements(&program.body, 1, &[])
            .map_err(|error| vec![error])?;
        let maintained_amplification = summary
            .writes
            .iter()
            .map(|write| {
                self.schema
                    .maintains
                    .iter()
                    .filter(|maintain| maintain.source == write.table)
                    .count() as u64
                    * write.max_rows
            })
            .sum();
        let max_writes =
            summary.writes.iter().map(|site| site.max_rows).sum::<u64>() + maintained_amplification;
        let max_heap_bytes = summary.steps.saturating_mul(HEAP_BYTES_PER_STEP);
        let output = OutputEstimator::estimate(self.schema, program);
        let max_output_bytes = output.bytes;
        let max_closure_bytes = RetentionEstimator::estimate(self.schema, program);
        let collection_rewrite = output
            .rewrite
            .as_ref()
            .map(|(bytes, rewrite)| (*bytes, rewrite.render()));
        let mut bound_errors = Vec::new();
        for (name, actual, ceiling) in [
            ("examined entries", summary.examined, self.ceilings.examined),
            (
                "index entries",
                summary.index_entries,
                self.ceilings.index_entries,
            ),
            (
                "rule probes",
                summary.rule_probes,
                self.ceilings.rule_probes,
            ),
            ("steps", summary.steps, self.ceilings.steps),
            ("heap bytes", max_heap_bytes, self.ceilings.heap_bytes),
            ("output bytes", max_output_bytes, self.ceilings.output_bytes),
            (
                "closure bytes",
                max_closure_bytes,
                self.ceilings.closure_bytes,
            ),
        ] {
            if let Err(error) =
                self.check_ceiling(name, actual, ceiling, &summary, collection_rewrite.as_ref())
            {
                bound_errors.push(error);
            }
        }
        if max_writes > self.ceilings.write_rows {
            bound_errors.push(CheckError {
                code: "E_BOUND".to_owned(),
                message: format!(
                    "write amplification {} exceeds ceiling {} ({})",
                    max_writes,
                    self.ceilings.write_rows,
                    summary
                        .product
                        .clone()
                        .unwrap_or_else(|| "sequential writes".to_owned())
                ),
                rewrite: "reduce the bounded fan-out or use an explicit maintained projection"
                    .to_owned(),
            });
        }
        if !bound_errors.is_empty() {
            return Err(bound_errors);
        }

        let mut read_sites: Vec<_> = summary.reads.into_values().collect();
        read_sites.sort_by(|a, b| a.site.cmp(&b.site));
        let mut indexes_required: BTreeSet<_> = read_sites
            .iter()
            .map(|site| format!("{}.{}", site.table, site.index))
            .collect();
        let mut rule_hashes: BTreeMap<_, _> = read_sites
            .iter()
            .filter_map(|site| {
                self.schema.table(&site.table).map(|table| {
                    (
                        format!("{}.read", site.table),
                        self.schema.rule_hash(&table.rules.read),
                    )
                })
            })
            .collect();
        for site in &read_sites {
            if let Some(table) = self.schema.table(&site.table) {
                collect_rule_indexes(
                    self.schema,
                    &table.rules.read,
                    &mut indexes_required,
                    &mut BTreeSet::new(),
                );
            }
        }
        for write in &summary.writes {
            let Some(table) = self.schema.table(&write.table) else {
                continue;
            };
            let effects: Vec<(&str, &RuleExpr)> = match write.kind {
                WriteKind::Insert => vec![("insert", &table.rules.insert)],
                WriteKind::Update => vec![("update", &table.rules.update)],
                WriteKind::Delete => vec![("delete", &table.rules.delete)],
                WriteKind::Upsert => vec![
                    ("insert", &table.rules.insert),
                    ("update", &table.rules.update),
                ],
                WriteKind::Emit => Vec::new(),
            };
            for (effect, rule) in effects {
                rule_hashes.insert(
                    format!("{}.{effect}", write.table),
                    self.schema.rule_hash(rule),
                );
                collect_rule_indexes(
                    self.schema,
                    rule,
                    &mut indexes_required,
                    &mut BTreeSet::new(),
                );
            }
            if matches!(write.kind, WriteKind::Insert | WriteKind::Upsert) {
                for constraint in &table.constraints {
                    if let Constraint::FinalExistsOnInsert { table, index, .. } = constraint {
                        indexes_required.insert(format!("{table}.{index}"));
                    }
                }
            }
            for maintain in self
                .schema
                .maintains
                .iter()
                .filter(|maintain| maintain.source == write.table)
            {
                let Some(target) = self.schema.table(&maintain.target) else {
                    continue;
                };
                for constraint in &target.constraints {
                    if let Constraint::FinalExistsOnInsert { table, index, .. } = constraint {
                        indexes_required.insert(format!("{table}.{index}"));
                    }
                }
            }
        }
        let indexes_required = indexes_required.into_iter().collect();
        let mut checked_tables: BTreeSet<String> = summary
            .writes
            .iter()
            .map(|write| write.table.clone())
            .collect();
        for write in &summary.writes {
            for maintain in self
                .schema
                .maintains
                .iter()
                .filter(|maintain| maintain.source == write.table)
            {
                checked_tables.insert(maintain.target.clone());
            }
        }
        let mut constraint_checks = BTreeSet::new();
        for table_name in checked_tables {
            let Some(table) = self.schema.table(&table_name) else {
                continue;
            };
            for constraint in &table.constraints {
                let (trace_table, label) = match constraint {
                    crate::schema::Constraint::Unique { index } => {
                        (table_name.as_str(), format!("Unique({index})"))
                    }
                    crate::schema::Constraint::Cap { by, max } => {
                        (table_name.as_str(), format!("Cap({by:?},{max})"))
                    }
                    crate::schema::Constraint::AppendOnly => {
                        (table_name.as_str(), "AppendOnly".to_owned())
                    }
                    crate::schema::Constraint::Immutable { fields } => {
                        (table_name.as_str(), format!("Immutable({fields:?})"))
                    }
                    crate::schema::Constraint::Text { field, min, format } => (
                        table_name.as_str(),
                        format!("Text({field},min={min},format={format:?})"),
                    ),
                    crate::schema::Constraint::FinalExistsOnInsert { table, index, key } => (
                        table.as_str(),
                        format!("FinalExistsOnInsert({table_name}->{table}.{index},{key:?})"),
                    ),
                };
                constraint_checks.insert(format!("{trace_table}:{label}"));
            }
            for (index_name, index) in &table.indexes {
                if index.unique {
                    constraint_checks.insert(format!("{table_name}:Unique({index_name})"));
                }
            }
        }
        let constraint_checks = constraint_checks.into_iter().collect();
        let disclosures = self
            .schema
            .maintains
            .iter()
            .filter(|maintain| maintain.readable.is_some())
            .map(|maintain| {
                let kind = match maintain.kind {
                    MaintainKind::Count => "count",
                    MaintainKind::Sum { .. } => "sum",
                };
                format!(
                    "E_DISCLOSURE: {kind} {} summarized into {}",
                    maintain.source, maintain.target
                )
            })
            .collect();

        Ok(Certificate {
            program: program.name.clone(),
            plan_hash: digest(program),
            schema_hash: self.schema.hash(),
            rule_hashes,
            evaluator_version: "bounded-spike-rust-1".to_owned(),
            value_model_version: "i53-codepoint-v1".to_owned(),
            read_sites,
            write_sites: summary.writes,
            maintained_amplification,
            constraint_checks,
            max_examined: summary.examined,
            max_index_entries: summary.index_entries,
            max_rule_probes: summary.rule_probes,
            max_steps: summary.steps,
            max_heap_bytes,
            max_output_bytes,
            max_closure_bytes,
            completeness: analyzer.completeness,
            prediction_sites: Vec::new(),
            read_time_granularity_ms: program.read_time_granularity_ms,
            halo_rows: 1,
            indexes_required,
            disclosures,
            bound_product: summary.product,
        })
    }

    pub fn check_pair(
        &self,
        query: &Program,
        mutation: &Program,
    ) -> Result<Certificate, CheckError> {
        let mut certificate = self.check(query)?;
        let computed: Vec<_> = certificate
            .read_sites
            .iter()
            .filter(|site| site.prefix_template == KeyProvenance::Computed)
            .map(|site| site.site.clone())
            .collect();
        let closed: Vec<_> = certificate
            .read_sites
            .iter()
            .filter(|site| site.prefix_template != KeyProvenance::Computed)
            .map(|site| site.site.clone())
            .collect();
        if !closed.is_empty() {
            certificate.prediction_sites.push(PredictionSite {
                transition: mutation.name.clone(),
                reads: closed,
                mode: PredictionMode::Closed,
            });
        }
        if !computed.is_empty() {
            certificate.prediction_sites.push(PredictionSite {
                transition: mutation.name.clone(),
                reads: computed,
                mode: PredictionMode::Partial,
            });
        }
        Ok(certificate)
    }

    fn structural_errors(&self, program: &Program) -> Vec<CheckError> {
        fn statement_errors(
            checker: &Checker<'_>,
            statements: &[Stmt],
            kind: ProgramKind,
            errors: &mut Vec<CheckError>,
        ) {
            for statement in statements {
                match statement {
                    Stmt::Insert { table, .. }
                    | Stmt::Update { table, .. }
                    | Stmt::Upsert { table, .. }
                    | Stmt::Delete { table, .. }
                        if table.starts_with('_') =>
                    {
                        errors.push(CheckError {
                            code: "E_SCHEMA_RESERVED".to_owned(),
                            message: format!("program names reserved table {table}"),
                            rewrite: "use an application table name that does not begin with '_'"
                                .to_owned(),
                        });
                    }
                    Stmt::Insert { .. }
                    | Stmt::Update { .. }
                    | Stmt::Upsert { .. }
                    | Stmt::Delete { .. }
                        if kind == ProgramKind::Query =>
                    {
                        errors.push(CheckError {
                            code: "E_WRITE_IN_QUERY".to_owned(),
                            message: "a query cannot write durable data".to_owned(),
                            rewrite: "move the write into a mutation".to_owned(),
                        });
                    }
                    Stmt::Emit { .. } if kind == ProgramKind::Query => {
                        errors.push(CheckError {
                            code: "E_EMIT_IN_QUERY".to_owned(),
                            message: "a query cannot emit an effect".to_owned(),
                            rewrite: "move emit into a mutation".to_owned(),
                        });
                    }
                    Stmt::If {
                        then_body,
                        else_body,
                        ..
                    } => {
                        statement_errors(checker, then_body, kind, errors);
                        statement_errors(checker, else_body, kind, errors);
                    }
                    Stmt::For { body, .. } => statement_errors(checker, body, kind, errors),
                    _ => {}
                }
                let table = match statement {
                    Stmt::Insert { table, .. }
                    | Stmt::Update { table, .. }
                    | Stmt::Upsert { table, .. }
                    | Stmt::Delete { table, .. } => Some(table),
                    _ => None,
                };
                if let Some(table) = table {
                    if table.starts_with('_') && kind == ProgramKind::Query {
                        errors.push(CheckError {
                            code: "E_WRITE_IN_QUERY".to_owned(),
                            message: "a query cannot write durable data".to_owned(),
                            rewrite: "move the write into a mutation".to_owned(),
                        });
                    }
                    if !table.starts_with('_') && checker.schema.table(table).is_none() {
                        errors.push(CheckError {
                            code: "E_UNBOUND_SCAN".to_owned(),
                            message: format!("write requires missing table {table}"),
                            rewrite: "declare the table in the schema".to_owned(),
                        });
                    }
                }
            }
        }

        fn read_error(checker: &Checker<'_>, table: &str, index: &str) -> Option<CheckError> {
            if table.starts_with('_') {
                return Some(CheckError {
                    code: "E_SCHEMA_RESERVED".to_owned(),
                    message: format!("program reads reserved table {table}"),
                    rewrite: "use the dedicated runtime verb for engine-owned data".to_owned(),
                });
            }
            if checker
                .schema
                .table(table)
                .and_then(|table| table.index(index))
                .is_none()
            {
                return Some(CheckError {
                    code: "E_UNBOUND_SCAN".to_owned(),
                    message: format!("read requires missing index {table}.{index}"),
                    rewrite: "declare the composite index in the schema".to_owned(),
                });
            }
            None
        }

        fn visit(
            checker: &Checker<'_>,
            program: &Program,
            expr: &Expr,
            errors: &mut Vec<CheckError>,
            sites: &mut BTreeMap<String, String>,
        ) {
            fn register_site(
                sites: &mut BTreeMap<String, String>,
                errors: &mut Vec<CheckError>,
                site: &str,
                shape: String,
            ) {
                if let Some(existing) = sites.get(site) {
                    if existing != &shape {
                        errors.push(CheckError {
                            code: "E_TRACE_SUBSET".to_owned(),
                            message: format!(
                                "read site {site} is reused for incompatible shapes {existing} and {shape}"
                            ),
                            rewrite: "give every distinct read a unique site label".to_owned(),
                        });
                    }
                } else {
                    sites.insert(site.to_owned(), shape);
                }
            }
            match expr {
                Expr::Input(input) => {
                    let invalid = match input {
                        Input::Viewer => false,
                        Input::Now | Input::NewId => program.kind != ProgramKind::Mutation,
                        Input::ReadTime => {
                            program.kind != ProgramKind::Query
                                || program.read_time_granularity_ms.is_none()
                        }
                    };
                    if invalid {
                        errors.push(CheckError {
                            code: "E_AMBIENT_TIME".to_owned(),
                            message: format!(
                                "modeled input {input:?} is not declared for this program kind"
                            ),
                            rewrite: "bind now/newId in a mutation intent or declare query readTime granularity".to_owned(),
                        });
                    }
                }
                Expr::Field { base, .. } | Expr::Unary { value: base, .. } => {
                    visit(checker, program, base, errors, sites)
                }
                Expr::Binary { left, right, .. } => {
                    visit(checker, program, left, errors, sites);
                    visit(checker, program, right, errors, sites);
                }
                Expr::Array(values) => {
                    for value in values {
                        visit(checker, program, value, errors, sites);
                    }
                }
                Expr::Builtin { builtin, args } => {
                    if matches!(
                        builtin,
                        Builtin::Count | Builtin::Sum | Builtin::CountCapped
                    ) && let Some(Expr::Scan(scan)) = args.first()
                        && checker
                            .schema
                            .table(&scan.table)
                            .and_then(|table| table.index(&scan.index))
                            .is_some()
                        && !Analyzer::new(checker.schema).uniform_visibility(scan)
                    {
                        errors.push(CheckError {
                            code: "E_STRUCTURAL_COUNT".to_owned(),
                            message: format!(
                                "{} counts rows whose read rule is not uniform over the scan prefix",
                                scan.site
                            ),
                            rewrite: format!(
                                "declare maintain.count({}, {{ by: [...], as: ..., readable: ... }})",
                                scan.table
                            ),
                        });
                    }
                    for value in args {
                        visit(checker, program, value, errors, sites);
                    }
                }
                Expr::Object(values) => {
                    for value in values.values() {
                        visit(checker, program, value, errors, sites);
                    }
                }
                Expr::Get(read) | Expr::Exists(read) => {
                    register_site(
                        sites,
                        errors,
                        &read.site,
                        format!("point {}.{} {:?}", read.table, read.index, read.provenance),
                    );
                    if let Some(error) = read_error(checker, &read.table, &read.index) {
                        errors.push(error);
                    }
                    for value in &read.key {
                        visit(checker, program, value, errors, sites);
                    }
                }
                Expr::Scan(scan) => {
                    register_site(
                        sites,
                        errors,
                        &scan.site,
                        format!(
                            "range {}.{} take={} {:?}",
                            scan.table,
                            scan.index,
                            scan.take.maximum(),
                            scan.provenance
                        ),
                    );
                    if let Some(error) = read_error(checker, &scan.table, &scan.index) {
                        errors.push(error);
                    }
                    if let Bound::Arg { name, .. } = &scan.take
                        && !program.args.contains_key(name)
                    {
                        errors.push(CheckError {
                            code: "E_UNBOUND_SCAN".to_owned(),
                            message: format!("scan {} take arg {name} is not declared", scan.site),
                            rewrite: "declare the bounded take argument on the program".to_owned(),
                        });
                    }
                    for value in &scan.prefix {
                        visit(checker, program, value, errors, sites);
                    }
                    for value in [scan.after.as_deref(), scan.before.as_deref()]
                        .into_iter()
                        .flatten()
                    {
                        visit(checker, program, value, errors, sites);
                    }
                    if let Some(range) = &scan.range {
                        for value in [
                            range.gt.as_deref(),
                            range.gte.as_deref(),
                            range.lt.as_deref(),
                            range.lte.as_deref(),
                        ]
                        .into_iter()
                        .flatten()
                        {
                            visit(checker, program, value, errors, sites);
                        }
                    }
                }
                Expr::Literal(_) | Expr::Variable(_) => {}
            }
        }

        let mut errors = Vec::new();
        let mut sites = BTreeMap::new();
        statement_errors(self, &program.body, program.kind, &mut errors);
        walk_statement_exprs(&program.body, &mut |expr| {
            visit(self, program, expr, &mut errors, &mut sites)
        });
        errors
    }

    fn check_ceiling(
        &self,
        name: &str,
        actual: u64,
        ceiling: u64,
        summary: &Summary,
        collection_rewrite: Option<&(u64, String)>,
    ) -> Result<(), CheckError> {
        if actual <= ceiling {
            return Ok(());
        }
        let code = if name == "steps" {
            "E_STEPS"
        } else {
            "E_BOUND"
        };
        let product = summary.product.as_deref().unwrap_or("sequential sites");
        let rewrite = if matches!(name, "output bytes" | "closure bytes") {
            collection_rewrite
                .filter(|(bytes, _)| *bytes > ceiling)
                .map(|(_, rewrite)| rewrite.clone())
                .unwrap_or_else(|| "return null;".to_owned())
        } else {
            "replace the nested population scan with maintain.count/sum (or reduce a declared bound)".to_owned()
        };
        Err(CheckError {
            code: code.to_owned(),
            message: format!("{name} {actual} exceeds ceiling {ceiling}; product: {product}"),
            rewrite,
        })
    }
}

#[derive(Clone, Default)]
struct Summary {
    reads: BTreeMap<String, ReadSite>,
    writes: Vec<WriteSite>,
    examined: u64,
    index_entries: u64,
    rule_probes: u64,
    steps: u64,
    product_value: u64,
    product: Option<String>,
}

impl Summary {
    fn add(mut self, other: Self) -> Self {
        for (name, site) in other.reads {
            self.reads
                .entry(name)
                .and_modify(|existing| existing.max_calls += site.max_calls)
                .or_insert(site);
        }
        self.writes.extend(other.writes);
        self.examined = self.examined.saturating_add(other.examined);
        self.index_entries = self.index_entries.saturating_add(other.index_entries);
        self.rule_probes = self.rule_probes.saturating_add(other.rule_probes);
        self.steps = self.steps.saturating_add(other.steps);
        if other.product_value > self.product_value {
            self.product_value = other.product_value;
            self.product = other.product;
        }
        self
    }

    fn branch(mut self, other: Self) -> Self {
        for (name, site) in other.reads {
            self.reads
                .entry(name)
                .and_modify(|existing| existing.max_calls = existing.max_calls.max(site.max_calls))
                .or_insert(site);
        }
        for write in other.writes {
            if let Some(existing) = self
                .writes
                .iter_mut()
                .find(|existing| existing.table == write.table && existing.kind == write.kind)
            {
                existing.max_rows = existing.max_rows.max(write.max_rows);
            } else {
                self.writes.push(write);
            }
        }
        self.examined = self.examined.max(other.examined);
        self.index_entries = self.index_entries.max(other.index_entries);
        self.rule_probes = self.rule_probes.max(other.rule_probes);
        self.steps = self.steps.max(other.steps);
        if other.product_value > self.product_value {
            self.product_value = other.product_value;
            self.product = other.product;
        }
        self
    }
}

impl<'a> OutputEstimator<'a> {
    fn estimate(schema: &'a Schema, program: &Program) -> OutputEstimate {
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
                let mut nodes = 0_u64;
                let mut level = 1_u64;
                for _ in 0..=recurse.depth {
                    nodes = nodes.saturating_add(level);
                    level = level.saturating_mul(u64::from(recurse.fanout));
                }
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
                Builtin::Slice | Builtin::Sort { .. } => args
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

struct Analyzer<'a> {
    schema: &'a Schema,
    completeness: Completeness,
}

impl<'a> Analyzer<'a> {
    fn new(schema: &'a Schema) -> Self {
        Self {
            schema,
            completeness: Completeness::Page,
        }
    }

    fn statements(
        &mut self,
        statements: &[Stmt],
        calls: u64,
        factors: &[(String, u64)],
    ) -> Result<Summary, CheckError> {
        let mut summary = Summary::default();
        for statement in statements {
            let next =
                match statement {
                    Stmt::Const { value, .. }
                    | Stmt::Let { value, .. }
                    | Stmt::Assign { value, .. }
                    | Stmt::Push { value, .. }
                    | Stmt::Return(value) => self.expr(value, calls, factors)?,
                    Stmt::Require { condition, .. } => self.expr(condition, calls, factors)?,
                    Stmt::If {
                        condition,
                        then_body,
                        else_body,
                    } => self.expr(condition, calls, factors)?.add(
                        self.statements(then_body, calls, factors)?
                            .branch(self.statements(else_body, calls, factors)?),
                    ),
                    Stmt::For { domain, body, .. } => {
                        let (domain_summary, bound, factor) =
                            self.domain(domain, calls, factors)?;
                        let mut nested = factors.to_vec();
                        nested.push(factor);
                        domain_summary.add(self.statements(
                            body,
                            calls.saturating_mul(bound),
                            &nested,
                        )?)
                    }
                    Stmt::Insert { table, row } => self.expr(row, calls, factors)?.add(self.write(
                        table,
                        WriteKind::Insert,
                        calls,
                        factors,
                    )),
                    Stmt::Update { table, key, patch } => self
                        .expr(key, calls, factors)?
                        .add(self.expr(patch, calls, factors)?)
                        .add(self.write(table, WriteKind::Update, calls, factors)),
                    Stmt::Upsert { table, key, row } => self
                        .expr(key, calls, factors)?
                        .add(self.expr(row, calls, factors)?)
                        .add(self.write(table, WriteKind::Upsert, calls, factors)),
                    Stmt::Delete { table, key } => self.expr(key, calls, factors)?.add(self.write(
                        table,
                        WriteKind::Delete,
                        calls,
                        factors,
                    )),
                    Stmt::Emit { payload, .. } => self
                        .expr(payload, calls, factors)?
                        .add(self.write("_outbox", WriteKind::Emit, calls, factors)),
                    Stmt::Break | Stmt::Continue => Summary::default(),
                };
            summary = summary.add(next);
            summary.steps = summary.steps.saturating_add(calls);
        }
        Ok(summary)
    }

    fn domain(
        &mut self,
        domain: &LoopDomain,
        calls: u64,
        factors: &[(String, u64)],
    ) -> Result<(Summary, u64, (String, u64)), CheckError> {
        match domain {
            LoopDomain::Page(scan) => {
                let bound = scan.take.maximum();
                Ok((
                    self.scan(scan, calls, factors)?,
                    bound,
                    (format!("{} take", scan.site), bound),
                ))
            }
            LoopDomain::LiteralRange {
                start,
                end_exclusive,
            } => {
                let bound = end_exclusive.saturating_sub(*start).max(0) as u64;
                Ok((
                    Summary::default(),
                    bound,
                    ("literal range".to_owned(), bound),
                ))
            }
            LoopDomain::ArgList { name, max } => Ok((
                Summary::default(),
                *max as u64,
                (format!("arg {name} max"), *max as u64),
            )),
            LoopDomain::DerivedArray {
                value,
                max,
                bound_source,
            } => Ok((
                self.expr(value, calls, factors)?,
                *max as u64,
                (bound_source.clone(), *max as u64),
            )),
            LoopDomain::Recurse(recurse) => {
                let mut nodes = 0_u64;
                let mut level = 1_u64;
                for _ in 0..=recurse.depth {
                    nodes = nodes.saturating_add(level);
                    level = level.saturating_mul(recurse.fanout as u64);
                }
                let read = Read {
                    site: recurse.site.clone(),
                    table: recurse.table.clone(),
                    index: recurse.index.clone(),
                    key: vec![*recurse.seed.clone()],
                    provenance: recurse.provenance,
                };
                Ok((
                    self.read(&read, calls.saturating_mul(nodes), factors)?,
                    nodes,
                    (
                        format!(
                            "{} recurse({}, {})",
                            recurse.site, recurse.depth, recurse.fanout
                        ),
                        nodes,
                    ),
                ))
            }
        }
    }

    fn expr(
        &mut self,
        expression: &Expr,
        calls: u64,
        factors: &[(String, u64)],
    ) -> Result<Summary, CheckError> {
        let mut summary = Summary::default();
        match expression {
            Expr::Field { base, .. } | Expr::Unary { value: base, .. } => {
                summary = summary.add(self.expr(base, calls, factors)?);
            }
            Expr::Binary { left, right, .. } => {
                summary = summary.add(self.expr(left, calls, factors)?);
                summary = summary.add(self.expr(right, calls, factors)?);
            }
            Expr::Array(values) => {
                for value in values {
                    summary = summary.add(self.expr(value, calls, factors)?);
                }
            }
            Expr::Object(values) => {
                for value in values.values() {
                    summary = summary.add(self.expr(value, calls, factors)?);
                }
            }
            Expr::Builtin { builtin, args } => {
                if matches!(builtin, Builtin::CountCapped) {
                    self.completeness = Completeness::Capped;
                }
                for value in args {
                    summary = summary.add(self.expr(value, calls, factors)?);
                }
            }
            Expr::Get(read) => {
                summary = summary.add(self.read(read, calls, factors)?);
            }
            Expr::Exists(read) => {
                summary = summary.add(self.read(read, calls, factors)?);
            }
            Expr::Scan(scan) => {
                summary = summary.add(self.scan(scan, calls, factors)?);
            }
            Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_) => {}
        }
        summary.steps = summary.steps.saturating_add(calls);
        Ok(summary)
    }

    fn read(
        &self,
        read: &Read,
        calls: u64,
        factors: &[(String, u64)],
    ) -> Result<Summary, CheckError> {
        let mut summary = Summary::default();
        summary.reads.insert(
            read.site.clone(),
            ReadSite {
                site: read.site.clone(),
                table: read.table.clone(),
                index: read.index.clone(),
                prefix_template: read.provenance,
                take: 1,
                max_calls: calls,
                hoist: false,
            },
        );
        summary.examined = calls;
        summary.index_entries = calls;
        summary.rule_probes = calls.saturating_mul(self.table_read_rule_probe_bound(&read.table));
        summary.steps = calls.saturating_mul(4);
        set_product(&mut summary, factors, (&read.site, 1));
        Ok(summary)
    }

    fn scan(
        &self,
        scan: &Scan,
        calls: u64,
        factors: &[(String, u64)],
    ) -> Result<Summary, CheckError> {
        let take = scan.take.maximum();
        let reserve = take.saturating_add(2);
        let hoist = self.rule_hoists(scan);
        let probe_bound = self.table_read_rule_probe_bound(&scan.table);
        let rule_probes = if probe_bound > 0 {
            if hoist {
                calls.saturating_mul(probe_bound)
            } else {
                calls.saturating_mul(reserve).saturating_mul(probe_bound)
            }
        } else {
            0
        };
        let mut summary = Summary::default();
        summary.reads.insert(
            scan.site.clone(),
            ReadSite {
                site: scan.site.clone(),
                table: scan.table.clone(),
                index: scan.index.clone(),
                prefix_template: scan.provenance,
                take,
                max_calls: calls,
                hoist,
            },
        );
        summary.examined = calls.saturating_mul(reserve);
        summary.index_entries = summary.examined;
        summary.rule_probes = rule_probes;
        summary.steps = summary.examined.saturating_mul(5);
        set_product(&mut summary, factors, (&scan.site, take));
        Ok(summary)
    }

    fn direct_visibility_probe_bound(rule: &RuleExpr) -> u64 {
        // @ref LLP 1001#7-channels-schemachannels — visibility lookups are
        // authoritative probes and therefore consume the certificate meter.
        match rule {
            RuleExpr::Exists { .. } | RuleExpr::Created { .. } => 1,
            // And/Or short-circuit at runtime, but either can be forced to
            // evaluate every child. Their certificate ceiling is therefore
            // the saturating sum, not the largest branch.
            RuleExpr::And(rules) | RuleExpr::Or(rules) => rules
                .iter()
                .map(Self::direct_visibility_probe_bound)
                .fold(0_u64, u64::saturating_add),
            RuleExpr::Not(rule) => Self::direct_visibility_probe_bound(rule),
            _ => 0,
        }
    }

    fn rule_probe_bound(&self, rule: &RuleExpr) -> u64 {
        match rule {
            RuleExpr::Exists { table, .. } => {
                let visibility = self
                    .schema
                    .table(table)
                    .map(|table| Self::direct_visibility_probe_bound(&table.rules.read))
                    .unwrap_or(0);
                1_u64.saturating_add(visibility)
            }
            RuleExpr::Created { .. } => 1,
            RuleExpr::And(rules) | RuleExpr::Or(rules) => rules
                .iter()
                .map(|rule| self.rule_probe_bound(rule))
                .fold(0_u64, u64::saturating_add),
            RuleExpr::Not(rule) => self.rule_probe_bound(rule),
            _ => 0,
        }
    }

    fn direct_rule_step_bound(rule: &RuleExpr) -> u64 {
        match rule {
            RuleExpr::And(rules) | RuleExpr::Or(rules) => rules
                .iter()
                .map(Self::direct_rule_step_bound)
                .fold(1_u64, u64::saturating_add),
            RuleExpr::Not(rule) => 1_u64.saturating_add(Self::direct_rule_step_bound(rule)),
            _ => 1,
        }
    }

    fn rule_step_bound(&self, rule: &RuleExpr) -> u64 {
        match rule {
            RuleExpr::Exists { table, .. } => 1_u64.saturating_add(
                self.schema
                    .table(table)
                    .map(|table| Self::direct_rule_step_bound(&table.rules.read))
                    .unwrap_or(0),
            ),
            RuleExpr::And(rules) | RuleExpr::Or(rules) => rules
                .iter()
                .map(|rule| self.rule_step_bound(rule))
                .fold(1_u64, u64::saturating_add),
            RuleExpr::Not(rule) => 1_u64.saturating_add(self.rule_step_bound(rule)),
            _ => 1,
        }
    }

    fn table_read_rule_probe_bound(&self, table: &str) -> u64 {
        self.schema
            .table(table)
            .map(|table| self.rule_probe_bound(&table.rules.read))
            .unwrap_or(0)
    }

    fn rule_has_probe(&self, table: &str) -> bool {
        self.table_read_rule_probe_bound(table) > 0
    }

    fn write_rule_probe_bound(&self, table: &str, kind: WriteKind) -> u64 {
        self.schema.table(table).map_or(0, |table| {
            let bound = |rule: &RuleExpr| self.rule_probe_bound(rule);
            let final_insert_probes = table
                .constraints
                .iter()
                .filter(|constraint| matches!(constraint, Constraint::FinalExistsOnInsert { .. }))
                .count() as u64;
            match kind {
                WriteKind::Insert => bound(&table.rules.insert).saturating_add(final_insert_probes),
                WriteKind::Update => 2_u64.saturating_mul(bound(&table.rules.update)),
                WriteKind::Delete => bound(&table.rules.delete),
                WriteKind::Upsert => bound(&table.rules.insert)
                    .saturating_add(final_insert_probes)
                    .max(2_u64.saturating_mul(bound(&table.rules.update))),
                WriteKind::Emit => 0,
            }
        })
    }

    fn write(
        &self,
        table: &str,
        kind: WriteKind,
        calls: u64,
        factors: &[(String, u64)],
    ) -> Summary {
        let mut summary = write_summary(table, kind, calls, factors);
        let probe_multiplier = self.write_rule_probe_bound(table, kind);
        let maintained_final_probes = self
            .schema
            .maintains
            .iter()
            .filter(|maintain| maintain.source == table)
            .map(|maintain| {
                self.schema.table(&maintain.target).map_or(0, |target| {
                    target
                        .constraints
                        .iter()
                        .filter(|constraint| {
                            matches!(constraint, Constraint::FinalExistsOnInsert { .. })
                        })
                        .count() as u64
                })
            })
            .sum::<u64>();
        let maintain_applications = match kind {
            WriteKind::Insert | WriteKind::Delete => 1,
            WriteKind::Update | WriteKind::Upsert => 2,
            WriteKind::Emit => 0,
        };
        let probe_multiplier = probe_multiplier
            .saturating_add(maintained_final_probes.saturating_mul(maintain_applications));
        summary.rule_probes = calls.saturating_mul(probe_multiplier);
        summary
    }

    fn rule_hoists(&self, scan: &Scan) -> bool {
        self.rule_has_probe(&scan.table) && self.uniform_visibility(scan)
    }

    fn uniform_visibility(&self, scan: &Scan) -> bool {
        self.schema
            .read_is_uniform_for_prefix(&scan.table, &scan.index, scan.prefix.len())
    }
}

fn write_summary(table: &str, kind: WriteKind, calls: u64, factors: &[(String, u64)]) -> Summary {
    let mut summary = Summary::default();
    summary.writes.push(WriteSite {
        table: table.to_owned(),
        kind,
        max_rows: calls,
    });
    summary.steps = calls.saturating_mul(5);
    if let Some((label, value)) = factors.last() {
        summary.product_value = calls;
        summary.product = Some(format!("{label} {value}"));
    }
    summary
}

fn collect_rule_indexes(
    schema: &Schema,
    rule: &RuleExpr,
    indexes: &mut BTreeSet<String>,
    visited_visibility_tables: &mut BTreeSet<String>,
) {
    match rule {
        RuleExpr::Exists { table, index, .. } => {
            indexes.insert(format!("{table}.{index}"));
            if visited_visibility_tables.insert(table.clone())
                && let Some(table) = schema.table(table)
            {
                collect_rule_indexes(
                    schema,
                    &table.rules.read,
                    indexes,
                    visited_visibility_tables,
                );
            }
        }
        RuleExpr::Created { table, index, .. } => {
            indexes.insert(format!("{table}.{index}"));
        }
        RuleExpr::And(rules) | RuleExpr::Or(rules) => {
            for rule in rules {
                collect_rule_indexes(schema, rule, indexes, visited_visibility_tables);
            }
        }
        RuleExpr::Not(rule) => {
            collect_rule_indexes(schema, rule, indexes, visited_visibility_tables)
        }
        RuleExpr::Public { .. }
        | RuleExpr::Allow
        | RuleExpr::Deny
        | RuleExpr::Eq(_, _)
        | RuleExpr::Ne(_, _) => {}
    }
}

fn set_product(summary: &mut Summary, factors: &[(String, u64)], current: (&str, u64)) {
    let value = factors.iter().fold(current.1, |total, (_, factor)| {
        total.saturating_mul(*factor)
    });
    let mut labels: Vec<_> = factors
        .iter()
        .map(|(label, factor)| format!("{label} {factor}"))
        .collect();
    labels.push(format!("{} take {}", current.0, current.1));
    summary.product_value = value;
    summary.product = Some(format!("{} = {value}", labels.join(" × ")));
}

fn walk_statement_exprs(statements: &[Stmt], visit: &mut impl FnMut(&Expr)) {
    for statement in statements {
        match statement {
            Stmt::Const { value, .. }
            | Stmt::Let { value, .. }
            | Stmt::Assign { value, .. }
            | Stmt::Push { value, .. }
            | Stmt::Return(value) => visit(value),
            Stmt::If {
                condition,
                then_body,
                else_body,
            } => {
                visit(condition);
                walk_statement_exprs(then_body, visit);
                walk_statement_exprs(else_body, visit);
            }
            Stmt::For { domain, body, .. } => {
                match domain {
                    LoopDomain::Page(scan) => visit(&Expr::Scan(scan.clone())),
                    LoopDomain::DerivedArray { value, .. } => visit(value),
                    LoopDomain::Recurse(recurse) => visit(&Expr::Get(Read {
                        site: recurse.site.clone(),
                        table: recurse.table.clone(),
                        index: recurse.index.clone(),
                        key: vec![*recurse.seed.clone()],
                        provenance: recurse.provenance,
                    })),
                    _ => {}
                }
                walk_statement_exprs(body, visit);
            }
            Stmt::Require { condition, .. } => visit(condition),
            Stmt::Insert { row, .. } => visit(row),
            Stmt::Update { key, patch, .. } => {
                visit(key);
                visit(patch);
            }
            Stmt::Upsert { key, row, .. } => {
                visit(key);
                visit(row);
            }
            Stmt::Delete { key, .. } => visit(key),
            Stmt::Emit { payload, .. } => visit(payload),
            Stmt::Break | Stmt::Continue => {}
        }
    }
}
