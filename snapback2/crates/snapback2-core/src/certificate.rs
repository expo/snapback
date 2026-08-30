use crate::ir::*;
use crate::schema::{MaintainKind, RuleExpr, Schema};
use crate::value::digest;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

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
        let max_heap_bytes = summary
            .steps
            .saturating_mul(32)
            .min(self.ceilings.heap_bytes);
        let max_output_bytes = self.ceilings.output_bytes;
        let max_closure_bytes = summary
            .examined
            .saturating_mul(1024)
            .min(self.ceilings.closure_bytes);
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
            if let Err(error) = self.check_ceiling(name, actual, ceiling, &summary) {
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
        let mut indexes_required: Vec<_> = read_sites
            .iter()
            .map(|site| format!("{}.{}", site.table, site.index))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        indexes_required.sort();
        let mut rule_hashes: BTreeMap<_, _> = read_sites
            .iter()
            .filter_map(|site| {
                self.schema
                    .table(&site.table)
                    .map(|table| (format!("{}.read", site.table), table.rules.read.hash()))
            })
            .collect();
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
                rule_hashes.insert(format!("{}.{effect}", write.table), rule.hash());
            }
        }
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
                let label = match constraint {
                    crate::schema::Constraint::Unique { index } => {
                        format!("Unique({index})")
                    }
                    crate::schema::Constraint::Cap { by, max } => {
                        format!("Cap({by:?},{max})")
                    }
                    crate::schema::Constraint::AppendOnly => "AppendOnly".to_owned(),
                    crate::schema::Constraint::Immutable { fields } => {
                        format!("Immutable({fields:?})")
                    }
                };
                constraint_checks.insert(format!("{table_name}:{label}"));
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
        ) {
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
                    visit(checker, program, base, errors)
                }
                Expr::Binary { left, right, .. } => {
                    visit(checker, program, left, errors);
                    visit(checker, program, right, errors);
                }
                Expr::Array(values) => {
                    for value in values {
                        visit(checker, program, value, errors);
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
                        visit(checker, program, value, errors);
                    }
                }
                Expr::Object(values) => {
                    for value in values.values() {
                        visit(checker, program, value, errors);
                    }
                }
                Expr::Get(read) | Expr::Exists(read) => {
                    if let Some(error) = read_error(checker, &read.table, &read.index) {
                        errors.push(error);
                    }
                    for value in &read.key {
                        visit(checker, program, value, errors);
                    }
                }
                Expr::Scan(scan) => {
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
                        visit(checker, program, value, errors);
                    }
                    for value in [scan.after.as_deref(), scan.before.as_deref()]
                        .into_iter()
                        .flatten()
                    {
                        visit(checker, program, value, errors);
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
                            visit(checker, program, value, errors);
                        }
                    }
                }
                Expr::Literal(_) | Expr::Variable(_) => {}
            }
        }

        let mut errors = Vec::new();
        statement_errors(self, &program.body, program.kind, &mut errors);
        walk_statement_exprs(&program.body, &mut |expr| {
            visit(self, program, expr, &mut errors)
        });
        errors
    }

    fn check_ceiling(
        &self,
        name: &str,
        actual: u64,
        ceiling: u64,
        summary: &Summary,
    ) -> Result<(), CheckError> {
        if actual <= ceiling {
            return Ok(());
        }
        Err(CheckError {
            code: if name == "steps" { "E_STEPS" } else { "E_BOUND" }.to_owned(),
            message: format!(
                "{name} {actual} exceeds ceiling {ceiling}; product: {}",
                summary.product.clone().unwrap_or_else(|| "sequential sites".to_owned())
            ),
            rewrite: "replace the nested population scan with maintain.count/sum (or reduce a declared bound)".to_owned(),
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
            Expr::Get(read) | Expr::Exists(read) => {
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
        if self.rule_has_probe(&read.table) {
            summary.rule_probes = calls;
        }
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
        let rule_probes = if self.rule_has_probe(&scan.table) {
            if hoist {
                calls
            } else {
                calls.saturating_mul(reserve)
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

    fn rule_has_probe(&self, table: &str) -> bool {
        fn has(rule: &RuleExpr) -> bool {
            match rule {
                RuleExpr::Exists { .. } => true,
                RuleExpr::And(rules) | RuleExpr::Or(rules) => rules.iter().any(has),
                RuleExpr::Not(rule) => has(rule),
                _ => false,
            }
        }
        self.schema
            .table(table)
            .is_some_and(|table| has(&table.rules.read))
    }

    fn write(
        &self,
        table: &str,
        kind: WriteKind,
        calls: u64,
        factors: &[(String, u64)],
    ) -> Summary {
        let mut summary = write_summary(table, kind, calls, factors);
        let probe_multiplier = self.schema.table(table).map_or(0, |table| {
            fn has(rule: &RuleExpr) -> bool {
                match rule {
                    RuleExpr::Exists { .. } => true,
                    RuleExpr::And(rules) | RuleExpr::Or(rules) => rules.iter().any(has),
                    RuleExpr::Not(rule) => has(rule),
                    _ => false,
                }
            }
            match kind {
                WriteKind::Insert => u64::from(has(&table.rules.insert)),
                WriteKind::Update => 2 * u64::from(has(&table.rules.update)),
                WriteKind::Delete => u64::from(has(&table.rules.delete)),
                WriteKind::Upsert => {
                    u64::from(has(&table.rules.insert)).max(2 * u64::from(has(&table.rules.update)))
                }
                WriteKind::Emit => 0,
            }
        });
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
