pub use crate::bounds::{declared_serialized_row_max, max_certified_page_rows};
use crate::collection_rewrite::OutputEstimator;
use crate::growth::geometric_sum;
use crate::identity::CURRENT_VALUE_MODEL_VERSION;
use crate::ir::*;
use crate::retention::RetentionEstimator;
use crate::schema::{Constraint, MaintainKind, RuleExpr, Schema};
use crate::value::digest;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

mod output;

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
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub maintained_writes: BTreeMap<String, u64>,
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
    pub rule_probes_per_candidate: u64,
    /// True only when the read rule is certified uniform over the scan prefix.
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

impl WriteKind {
    /// Number of maintained-target applications caused by one source-row write.
    /// An update/upsert can remove the old aggregate contribution and add the new one.
    pub(crate) const fn maintained_applications(self) -> u64 {
        match self {
            Self::Insert | Self::Delete => 1,
            Self::Update | Self::Upsert => 2,
            Self::Emit => 0,
        }
    }
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
    pub(crate) schema: &'a Schema,
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
        // @ref LLP 1001#2-what-a-commit-records — certification accounts for
        // both old and new maintained-target applications of update/upsert,
        // and preserves the bound per physical target table.
        let mut maintained_writes = BTreeMap::<String, u64>::new();
        for write in &summary.writes {
            for maintain in self
                .schema
                .maintains
                .iter()
                .filter(|maintain| maintain.source == write.table)
            {
                let writes = write
                    .max_rows
                    .saturating_mul(write.kind.maintained_applications());
                let total = maintained_writes
                    .entry(maintain.target.clone())
                    .or_default();
                *total = total.saturating_add(writes);
            }
        }
        let maintained_amplification = maintained_writes
            .values()
            .copied()
            .fold(0_u64, u64::saturating_add);
        let max_writes = summary
            .writes
            .iter()
            .map(|site| site.max_rows)
            .fold(maintained_amplification, u64::saturating_add);
        // @ref LLP 1001#3-read-and-write-states-no-silent-states — visibility-filtered
        // scans spend the certified examined/rule-probe ceilings, never `take`.
        let max_examined =
            if summary.visibility_filtered_range && summary.examined <= self.ceilings.examined {
                self.ceilings.examined
            } else {
                summary.examined
            };
        let max_index_entries = if summary.visibility_filtered_range
            && summary.index_entries <= self.ceilings.index_entries
        {
            self.ceilings.index_entries
        } else {
            summary.index_entries
        };
        let max_rule_probes =
            if summary.nonuniform_range && summary.rule_probes <= self.ceilings.rule_probes {
                self.ceilings.rule_probes
            } else {
                summary.rule_probes
            };
        let max_steps =
            if summary.visibility_filtered_range && summary.examined <= self.ceilings.examined {
                summary.steps.saturating_add(
                    max_examined
                        .saturating_sub(summary.examined)
                        .saturating_mul(5),
                )
            } else {
                summary.steps
            };
        let max_heap_bytes = max_steps.saturating_mul(HEAP_BYTES_PER_STEP);
        let output = OutputEstimator::estimate(self.schema, program);
        let max_output_bytes = output.bytes;
        let max_closure_bytes = RetentionEstimator::estimate(self.schema, program);
        let collection_rewrite = output
            .rewrite
            .as_ref()
            .map(|(bytes, rewrite)| (*bytes, rewrite.render()));
        let mut bound_errors = Vec::new();
        for (name, actual, ceiling) in [
            ("examined entries", max_examined, self.ceilings.examined),
            (
                "index entries",
                max_index_entries,
                self.ceilings.index_entries,
            ),
            ("rule probes", max_rule_probes, self.ceilings.rule_probes),
            ("steps", max_steps, self.ceilings.steps),
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
            value_model_version: CURRENT_VALUE_MODEL_VERSION.to_string(),
            read_sites,
            write_sites: summary.writes,
            maintained_amplification,
            maintained_writes,
            constraint_checks,
            max_examined,
            max_index_entries,
            max_rule_probes,
            max_steps,
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
    visibility_filtered_range: bool,
    nonuniform_range: bool,
}

impl Summary {
    fn add(mut self, other: Self) -> Self {
        for (name, site) in other.reads {
            self.reads
                .entry(name)
                .and_modify(|existing| {
                    existing.max_calls += site.max_calls;
                    // Structural admission requires the full access shapes to
                    // agree. Keep this merge fail-closed as defense in depth:
                    // a future missed path must never let the first hoist or
                    // smaller meter silently govern a later access.
                    existing.take = existing.take.max(site.take);
                    existing.rule_probes_per_candidate = existing
                        .rule_probes_per_candidate
                        .max(site.rule_probes_per_candidate);
                    existing.hoist &= site.hoist;
                })
                .or_insert(site);
        }
        self.writes.extend(other.writes);
        self.examined = self.examined.saturating_add(other.examined);
        self.index_entries = self.index_entries.saturating_add(other.index_entries);
        self.rule_probes = self.rule_probes.saturating_add(other.rule_probes);
        self.steps = self.steps.saturating_add(other.steps);
        self.visibility_filtered_range |= other.visibility_filtered_range;
        self.nonuniform_range |= other.nonuniform_range;
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
                .and_modify(|existing| {
                    existing.max_calls = existing.max_calls.max(site.max_calls);
                    existing.take = existing.take.max(site.take);
                    existing.rule_probes_per_candidate = existing
                        .rule_probes_per_candidate
                        .max(site.rule_probes_per_candidate);
                    existing.hoist &= site.hoist;
                })
                .or_insert(site);
        }
        // @ref LLP 1001#2-what-a-commit-records — sequential writes add
        // within one arm; only the completed arm totals are branch-maxed.
        self.writes = sum_write_sites(std::mem::take(&mut self.writes));
        for write in sum_write_sites(other.writes) {
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
        self.visibility_filtered_range |= other.visibility_filtered_range;
        self.nonuniform_range |= other.nonuniform_range;
        if other.product_value > self.product_value {
            self.product_value = other.product_value;
            self.product = other.product;
        }
        self
    }
}

fn sum_write_sites(writes: Vec<WriteSite>) -> Vec<WriteSite> {
    let mut totals = Vec::<WriteSite>::new();
    for write in writes {
        if let Some(existing) = totals
            .iter_mut()
            .find(|existing| existing.table == write.table && existing.kind == write.kind)
        {
            existing.max_rows = existing.max_rows.saturating_add(write.max_rows);
        } else {
            totals.push(write);
        }
    }
    totals
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
                let nodes = geometric_sum(u64::from(recurse.fanout), recurse.depth);
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
                rule_probes_per_candidate: self.table_read_rule_probe_bound(&read.table),
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
        &mut self,
        scan: &Scan,
        calls: u64,
        factors: &[(String, u64)],
    ) -> Result<Summary, CheckError> {
        let take = scan.take.maximum();
        let reserve = take.saturating_add(2);
        let hoist = crate::certificate_policy::uniform_visibility(self.schema, scan);
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
                rule_probes_per_candidate: probe_bound,
                hoist,
            },
        );
        summary.examined = calls.saturating_mul(reserve);
        summary.index_entries = summary.examined;
        summary.rule_probes = rule_probes;
        summary.steps = summary.examined.saturating_mul(5);
        summary.visibility_filtered_range = self.schema.table(&scan.table).is_some_and(|table| {
            !matches!(table.rules.read, RuleExpr::Public { .. } | RuleExpr::Allow)
        });
        summary.nonuniform_range = !hoist;
        if !hoist {
            self.completeness = Completeness::Capped;
        }
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
        let probe_multiplier = probe_multiplier
            .saturating_add(maintained_final_probes.saturating_mul(kind.maintained_applications()));
        summary.rule_probes = calls.saturating_mul(probe_multiplier);
        summary
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
