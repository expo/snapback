pub use crate::bounds::{declared_serialized_row_max, max_certified_page_rows};
use crate::collection_rewrite::{ByteShape, OutputEstimator};
use crate::cursor::CursorColumn;
use crate::growth::geometric_sum;
use crate::identity::CURRENT_VALUE_MODEL_VERSION;
use crate::ir::*;
use crate::retention::RetentionEstimator;
use crate::schema::{Constraint, MaintainKind, RetentionPolicy, RuleExpr, Schema};
use crate::value::digest;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

mod diagnostic;
mod inspection;
pub use inspection::{CheckAnalysis, CostTerm};
mod merge;
mod output;
mod recurrence;
mod page;
pub(crate) mod search;
mod summary;
mod targets;
use diagnostic::Cost;
use page::result_pages;
pub use page::{result_cursor, resumable_log_cursor};
use summary::Summary;
pub use targets::{MutationTarget, MutationTargets, TargetKind, TargetSource, UnresolvedTarget};

// Heap is calibrated; output/closure use declared maxima. These are admission bounds, not allocator/serializer proofs.
const HEAP_BYTES_PER_STEP: u64 = 32;
pub const CURRENT_EVALUATOR_VERSION: &str = "bounded-spike-rust-search-text-refinements-5";
impl Certificate {
    pub(crate) fn has_current_semantics(&self) -> bool {
        self.value_model_version == CURRENT_VALUE_MODEL_VERSION.as_str()
            && self.evaluator_version == CURRENT_EVALUATOR_VERSION
    }
}

// @ref LLP 1010#a5-the-merged-feed — one of the four fixed work units in
// certificate/merge.rs's (L + N + 2) * (3 * height + 4) term accommodates
// the shared initial SQL template. This is part of, not added to, the existing
// calibrated heap reserve. It is independent of actual heads, including zero.
pub(crate) fn initial_seek_reserve(merge: &Merge) -> u64 {
    merge
        .max_lanes()
        .saturating_add(merge.take().saturating_add(2))
        .saturating_mul(HEAP_BYTES_PER_STEP)
}

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
    #[serde(
        default,
        rename = "engineWrites",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub engine_writes: Vec<String>,
    #[serde(flatten, default, skip_serializing_if = "Option::is_none")]
    pub job: Option<Box<crate::jobs::JobCertificate>>,
    pub program: String,
    pub plan_hash: String,
    pub schema_hash: String,
    /// Client-side hidden-row policy, recorded once per table in the
    /// certified program custody rather than repeated in delivery receipts.
    #[serde(default)]
    pub tables: BTreeMap<String, CertificateTable>,
    pub rule_hashes: BTreeMap<String, String>,
    pub evaluator_version: String,
    pub value_model_version: String,
    pub read_sites: Vec<ReadSite>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub merge_sites: Vec<MergeSite>,
    /// Certified page for each structural return path; never declared by the compiler.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub result_pages: BTreeMap<String, ResultPageSite>,
    pub write_sites: Vec<WriteSite>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mutation_targets: Option<MutationTargets>,
    pub maintained_amplification: u64,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub maintained_writes: BTreeMap<String, u64>,
    pub constraint_checks: Vec<String>,
    pub max_examined: u64,
    pub max_index_entries: u64,
    pub max_rule_probes: u64,
    pub max_steps: u64,
    pub derived_steps: u64,
    pub derived_scratch_bytes: u64,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cost_terms: Vec<CostTerm>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CertificateTable {
    pub retain: RetentionPolicy,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MergeSite {
    pub site: String,
    pub lane_sites: Vec<String>,
    pub take: u64,
    #[serde(default)]
    pub max_lanes: u64,
    #[serde(default)]
    pub uniform: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResultPageSite {
    pub site: String,
    pub table: String,
    pub index: String,
    pub order: Order,
    pub suffix: Vec<CursorColumn>,
    pub merge: bool,
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
    /// The scan prefix proves the entire read rule true without a rule probe.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub decided_true: bool,
    #[serde(default)]
    pub complete: bool,
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
    pub site: Option<String>,
    pub code: String,
    pub message: String,
    pub rewrite: String,
}

pub struct Checker<'a> {
    pub(crate) schema: &'a Schema,
    ceilings: Ceilings,
    /// The program is one chunk of a job (LLP 1016 D1): its page loop is a
    /// continuation the driver carries across commits, so the mutation
    /// fan-out rule does not apply to it.
    pub(crate) job_chunk: bool,
}

impl<'a> Checker<'a> {
    pub fn new(schema: &'a Schema, ceilings: Ceilings) -> Self {
        Self {
            schema,
            ceilings,
            job_chunk: false,
        }
    }

    // @ref LLP 1017#35-what-has-no-spelling-after-this-and-where-it-goes — a job's chunk loop is the represented continuation the fan-out rule defers to.
    pub fn job_chunk(mut self) -> Self {
        self.job_chunk = true;
        self
    }

    pub fn check(&self, program: &Program) -> Result<Certificate, CheckError> {
        self.check_all(program).map_err(|errors| {
            errors
                .into_iter()
                .next()
                .expect("checker returned no errors")
        })
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

    fn analyze(&self, program: &Program) -> Result<(Certificate, Vec<CheckError>), Vec<CheckError>> {
        let mut analyzer = Analyzer::new(self.schema);
        analyzer.site = program.name.clone();
        let mut summary = analyzer
            .statements(&program.body, 1, &[])
            .map_err(|error| vec![error])?;
        // @ref LLP 1016#d5--schedules-row-timers-and-periods-on-the-owners-clock — one timer index update per schedule per affected row, inside the write ceiling.
        let mut timer_writes = crate::timers::write_bound(self.schema, &summary.writes);
        if timer_writes > 0 {
            summary.writes.push(WriteSite {
                table: "_timers".into(),
                kind: WriteKind::Update,
                max_rows: timer_writes,
            });
        }
        let result_pages = result_pages(self.schema, program)?;
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
        let maintained_timer_writes = crate::timers::write_bound(
            self.schema,
            &maintained_writes
                .iter()
                .map(|(table, max_rows)| WriteSite {
                    table: table.clone(),
                    kind: WriteKind::Update,
                    max_rows: *max_rows,
                })
                .collect::<Vec<_>>(),
        );
        if maintained_timer_writes > 0 {
            timer_writes = timer_writes.saturating_add(maintained_timer_writes);
            if let Some(timers) = summary
                .writes
                .iter_mut()
                .find(|write| write.table == "_timers")
            {
                timers.max_rows = timers.max_rows.saturating_add(maintained_timer_writes);
            } else {
                summary.writes.push(WriteSite {
                    table: "_timers".into(),
                    kind: WriteKind::Update,
                    max_rows: maintained_timer_writes,
                });
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
        // @ref LLP 1001#3-read-and-write-states-no-silent-states — non-uniform scans spend
        // the certified examined/rule-probe ceilings; hoisted scans certify their reserve.
        let max_examined = if summary.nonuniform_range && summary.examined <= self.ceilings.examined
        {
            self.ceilings.examined
        } else {
            summary.examined
        };
        let max_index_entries =
            if summary.nonuniform_range && summary.index_entries <= self.ceilings.index_entries {
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
        let max_steps = if summary.nonuniform_range && summary.examined <= self.ceilings.examined {
            summary.steps.saturating_add(
                max_examined
                    .saturating_sub(summary.examined)
                    .saturating_mul(5),
            )
        } else {
            summary.steps
        };
        let (mut derived, mut derived_terms) = search::derivation_bound(
            self.schema,
            program,
            &summary.writes,
            &maintained_writes,
            &summary.reads,
            &summary.write_origins,
        );
        let search_closure =
            search::closure::estimate(self.schema, program, &summary.reads, &analyzer.merge_sites);
        if let Some(closure) = &search_closure {
            derived.scratch = derived.scratch.saturating_add(closure.bytes);
            derived_terms.push(search::DerivedTerm {
                site: analyzer.merge_sites.keys().next().cloned(),
                source: "search closure scratch".into(),
                steps: 0,
                scratch: closure.bytes,
            });
        }
        summary.derived_steps = derived.steps;
        summary.derived_scratch = derived.scratch;
        summary.derived_terms = derived_terms;
        let max_heap_bytes = max_steps
            .saturating_mul(HEAP_BYTES_PER_STEP)
            .saturating_add(derived.scratch);
        let max_steps = max_steps.saturating_add(derived.steps);
        let output = OutputEstimator::estimate(self.schema, program);
        let max_output_bytes = output.bytes;
        let mut closure = RetentionEstimator::estimate(self.schema, program);
        for child in &mut closure.children {
            if let Some(merge) = analyzer
                .merge_sites
                .values()
                .find(|merge| child.label.contains(&format!(" at {}:", merge.site)))
            {
                child.label = format!(
                    "merge {}: emitted page + heads + lookahead; {}",
                    merge.site, child.label
                );
            }
            for read in summary.reads.values() {
                if child.label.contains(&format!(" at {}:", read.site)) {
                    let source = format!(
                        "{} take {} × {} calls",
                        read.site, read.take, read.max_calls
                    );
                    child.label = format!("{source}; {}", child.label);
                    break;
                }
            }
        }
        if let Some(search) = search_closure {
            if search.bytes > closure.bytes {
                closure = search;
            }
        }
        if program.kind == ProgramKind::Query && program.read_time_granularity_ms.is_some() {
            // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — a signed i53 readTime member fits in 32 envelope bytes.
            closure.bytes = closure.bytes.saturating_add(32);
        }
        if summary.count_absence_bytes > 0 {
            closure.bytes = closure.bytes.saturating_add(summary.count_absence_bytes);
            closure.children.push(ByteShape::leaf(
                summary.count_absence_bytes,
                "public count absence evidence",
            ));
        }
        if output.retained_bytes > closure.bytes {
            closure = ByteShape::leaf(output.retained_bytes, "coupled loop-carried values at peak retention");
        }
        let max_closure_bytes = closure.bytes;
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
            if let Err(error) = self.check_ceiling(
                name,
                actual,
                ceiling,
                &summary,
                match name {
                    "output bytes" => Some(&output.shape),
                    "closure bytes" => Some(&closure),
                    _ => None,
                },
            ) {
                bound_errors.push(error);
            }
        }
        if max_writes > self.ceilings.write_rows {
            bound_errors.push(CheckError {
                site: None,
                code: "E_BOUND".to_owned(),
                message: format!(
                    "write amplification {} exceeds ceiling {} ({})",
                    max_writes,
                    self.ceilings.write_rows,
                    summary
                        .writes
                        .iter()
                        .map(|w| format!("{} {:?} × {}", w.table, w.kind, w.max_rows))
                        .chain(
                            maintained_writes
                                .iter()
                                .map(|(table, n)| format!("{table} maintained applications × {n}"))
                        )
                        .collect::<Vec<_>>()
                        .join(" + ")
                ),
                rewrite: "reduce the bounded fan-out or use an explicit maintained projection"
                    .to_owned(),
            });
        }
        let cost_terms = diagnostic::priced_terms(&summary, &[
            ("examined entries", max_examined), ("index entries", max_index_entries),
            ("rule probes", max_rule_probes), ("steps", max_steps), ("heap bytes", max_heap_bytes),
        ], &output.shape, &closure, &maintained_writes);


        let mut read_sites: Vec<_> = summary.reads.into_values().collect();
        read_sites.sort_by(|a, b| a.site.cmp(&b.site));
        let mut indexes_required: BTreeSet<_> = read_sites
            .iter()
            .map(|site| format!("{}.{}", site.table, site.index))
            .collect();
        indexes_required.extend(
            summary
                .count_probe_tables
                .iter()
                .map(|table| format!("{table}.byId")),
        );
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
            for constraint in &table.constraints {
                if let Constraint::Cap { by, .. } = constraint
                    && let Some((index, _)) = crate::cap::enforcement_index(table, by)
                {
                    indexes_required.insert(format!("{}.{index}", write.table));
                    if let Some(maintain) =
                        crate::cap::count_maintain(self.schema, &write.table, by)
                    {
                        indexes_required.insert(format!("{}.byId", maintain.target));
                    }
                }
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
        let mut constraint_checks: BTreeSet<_> = summary
            .count_probe_tables
            .iter()
            .map(|table| format!("{table}:public-count-absence"))
            .collect();
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
                if let crate::schema::Constraint::Cap { by, .. } = constraint
                    && let Some(maintain) = crate::cap::count_maintain(self.schema, &table_name, by)
                {
                    constraint_checks.insert(format!("{}:{label}", maintain.target));
                }
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

        Ok((Certificate {
            job: None,
            program: program.name.clone(),
            plan_hash: digest(program),
            schema_hash: self.schema.hash(),
            tables: self
                .schema
                .tables
                .iter()
                .map(|(name, table)| {
                    (
                        name.clone(),
                        CertificateTable {
                            retain: table.retain,
                        },
                    )
                })
                .collect(),
            rule_hashes,
            evaluator_version: CURRENT_EVALUATOR_VERSION.to_owned(),
            value_model_version: CURRENT_VALUE_MODEL_VERSION.to_string(),
            read_sites,
            merge_sites: analyzer.merge_sites.into_values().collect(),
            result_pages,
            write_sites: summary.writes,
            mutation_targets: targets::derive(self.schema, program),
            maintained_amplification,
            maintained_writes,
            engine_writes: if timer_writes > 0 {
                vec!["_timers".into()]
            } else {
                vec![]
            },
            constraint_checks,
            max_examined,
            max_index_entries,
            max_rule_probes,
            max_steps,
            derived_steps: derived.steps,
            derived_scratch_bytes: derived.scratch,
            max_heap_bytes,
            max_output_bytes,
            max_closure_bytes,
            completeness: analyzer.completeness,
            prediction_sites: Vec::new(),
            read_time_granularity_ms: program.read_time_granularity_ms,
            halo_rows: 1,
            indexes_required,
            disclosures,
            bound_product: summary.costs.product(),
            cost_terms,
        }, bound_errors))
    }

    pub fn check_pair(
        &self,
        query: &Program,
        mutation: &Program,
    ) -> Result<Certificate, CheckError> {
        let mut certificate = self.check(query)?;
        // @ref LLP 1001#51-connected — Partial describes incomplete closure, not
        // permission to predict; the twin refuses every program with a _connected read site.
        let computed: Vec<_> = certificate
            .read_sites
            .iter()
            .filter(|site| {
                site.prefix_template == KeyProvenance::Computed
                    || site.table == crate::CONNECTED_TABLE
            })
            .map(|site| site.site.clone())
            .collect();
        let closed: Vec<_> = certificate
            .read_sites
            .iter()
            .filter(|site| {
                site.prefix_template != KeyProvenance::Computed
                    && site.table != crate::CONNECTED_TABLE
            })
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
}

struct Analyzer<'a> {
    site: String,
    schema: &'a Schema,
    completeness: Completeness,
    merge_sites: BTreeMap<String, MergeSite>,
}

impl<'a> Analyzer<'a> {
    fn new(schema: &'a Schema) -> Self {
        Self {
            schema,
            completeness: Completeness::Page,
            site: String::new(),
            merge_sites: BTreeMap::new(),
        }
    }

    fn statements(
        &mut self,
        statements: &[Stmt],
        calls: u64,
        factors: &[(String, u64)],
    ) -> Result<Summary, CheckError> {
        let mut summary = Summary::default();
        let parent = self.site.clone();
        for (position, statement) in statements.iter().enumerate() {
            self.site = format!("{parent}:statement:{}", position + 1);
            let mut next =
                match statement {
                    Stmt::Const { value, .. }
                    | Stmt::Let { value, .. }
                    | Stmt::Assign { value, .. }
                    | Stmt::Push { value, .. }
                    | Stmt::Return(value) => self.expr(value, calls, factors)?,
                    Stmt::Require { condition, .. } => self.expr(condition, calls, factors)?,
                    Stmt::Check { condition, current } => self.expr(condition, calls, factors)?
                        .add(self.expr(&Expr::Get(current.clone()), calls, factors)?),
                    Stmt::If {
                        condition,
                        then_body,
                        else_body,
                    } => self.expr(condition, calls, factors)?.add(
                        self.arm(then_body, calls, factors, "then")?
                            .branch(self.arm(else_body, calls, factors, "else")?),
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
                    Stmt::Insert { table, row } | Stmt::InsertIfAbsent { table, row, .. } => self.expr(row, calls, factors)?.add(self.write(
                        table,
                        WriteKind::Insert,
                        None,
                        calls,
                        factors,
                    )),
                    Stmt::Update { table, key, patch } => self
                        .expr(key, calls, factors)?
                        .add(self.expr(patch, calls, factors)?)
                        .add(self.write(table, WriteKind::Update, Some(patch), calls, factors)),
                    Stmt::Upsert { table, key, row } => self
                        .expr(key, calls, factors)?
                        .add(self.expr(row, calls, factors)?)
                        .add(self.write(table, WriteKind::Upsert, None, calls, factors)),
                    Stmt::Delete { table, key } => self.expr(key, calls, factors)?.add(self.write(
                        table,
                        WriteKind::Delete,
                        None,
                        calls,
                        factors,
                    )),
                    Stmt::Emit { payload, .. } => self
                        .expr(payload, calls, factors)?
                        .add(self.write("_outbox", WriteKind::Emit, None, calls, factors)),
                    Stmt::Break | Stmt::Continue => Summary::default(),
                };
            next.costs.step(calls, "statements", factors);
            next.costs.locate(&self.site);
            for write in &next.writes {
                next.write_origins
                    .entry(format!("{} {:?}", write.table, write.kind))
                    .or_insert_with(|| self.site.clone());
            }
            summary = summary.add(next);
            summary.steps = summary.steps.saturating_add(calls);
        }
        self.site = parent;
        Ok(summary)
    }

    fn arm(&mut self, body: &[Stmt], calls: u64, factors: &[(String, u64)], arm: &str) -> Result<Summary, CheckError> {
        let parent = self.site.clone();
        self.site = format!("{parent}:{arm}");
        let result = self.statements(body, calls, factors);
        self.site = parent;
        result
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
            Expr::Merge(merge) => {
                summary = summary.add(self.merge(merge, calls, factors)?);
            }
            Expr::Scan(scan) => {
                summary = summary.add(self.scan(scan, calls, factors)?);
            }
            Expr::Literal(_) | Expr::Variable(_) | Expr::Input(_) => {}
        }
        summary.steps = summary.steps.saturating_add(calls);
        summary.costs.step(calls, "expressions", factors);
        Ok(summary)
    }

    fn read(
        &mut self,
        read: &Read,
        calls: u64,
        factors: &[(String, u64)],
    ) -> Result<Summary, CheckError> {
        let mut summary = Summary::default();
        // @ref LLP 1001#2-what-a-commit-records — point-read keys compose
        // their expression work and nested read sites with the outer read.
        for value in &read.key {
            summary = summary.add(self.expr(value, calls, factors)?);
        }
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
                decided_true: false,
                complete: false,
            },
        );
        if read.table != crate::CONNECTED_TABLE {
            summary.examined = summary.examined.saturating_add(calls);
            summary.index_entries = summary.index_entries.saturating_add(calls);
            summary.costs.read(read, calls, factors);
        }
        summary.rule_probes = summary
            .rule_probes
            .saturating_add(calls.saturating_mul(self.table_read_rule_probe_bound(&read.table)));
        summary.steps = summary.steps.saturating_add(calls.saturating_mul(4));
        // @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — only
        // a missing public count group takes the extra primary-ID evidence probe.
        // The group read and fallback can examine at most one row together.
        if crate::cap::public_count_probe(self.schema, &read.table, &read.index, read.key.len()) {
            summary.steps = summary.steps.saturating_add(calls.saturating_mul(4));
            summary.costs.step(
                calls.saturating_mul(4),
                "public count absence evidence",
                factors,
            );
            summary.count_probe_tables.insert(read.table.clone());
            let bytes = crate::cap::count_absence_reserve(
                self.schema,
                &read.table,
                &read.index,
                &read.site,
            );
            summary.count_absence_bytes = summary
                .count_absence_bytes
                .saturating_add(calls.saturating_mul(bytes));
        }
        summary.costs.probes(
            &read.site,
            calls,
            self.table_read_rule_probe_bound(&read.table),
            factors,
        );
        Ok(summary)
    }

    fn scan(
        &mut self,
        scan: &Scan,
        calls: u64,
        factors: &[(String, u64)],
    ) -> Result<Summary, CheckError> {
        self.scan_reserve(scan, calls, factors, scan.take.maximum().saturating_add(2))
    }

    fn scan_reserve(
        &mut self,
        scan: &Scan,
        calls: u64,
        factors: &[(String, u64)],
        reserve: u64,
    ) -> Result<Summary, CheckError> {
        // @ref LLP 1001#2-what-a-commit-records — a read nested in a scan's
        // key or bounds is still a certified read site with its own budget.
        let mut summary = Summary::default();
        for value in scan.prefix.iter().map(IndexKeyExpr::expression) {
            summary = summary.add(self.expr(value, calls, factors)?);
        }
        for value in [scan.after.as_deref(), scan.before.as_deref()]
            .into_iter()
            .flatten()
        {
            summary = summary.add(self.expr(value, calls, factors)?);
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
                summary = summary.add(self.expr(value, calls, factors)?);
            }
        }
        let take = scan.take.maximum();
        let visibility = crate::certificate_policy::scan_visibility(self.schema, scan);
        let hoist = visibility.uniform;
        let probe_bound = if visibility.decided_true {
            0
        } else {
            self.table_read_rule_probe_bound(&scan.table)
        };
        let rule_probes = if probe_bound > 0 {
            if hoist {
                calls.saturating_mul(probe_bound)
            } else {
                calls.saturating_mul(reserve).saturating_mul(probe_bound)
            }
        } else {
            0
        };
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
                decided_true: visibility.decided_true,
                complete: false,
            },
        );
        if let Some(merge_site) = &scan.merge_site {
            let site = self
                .merge_sites
                .entry(merge_site.clone())
                .or_insert_with(|| MergeSite {
                    site: merge_site.clone(),
                    lane_sites: Vec::new(),
                    take,
                    max_lanes: 0,
                    uniform: false,
                });
            if !site.lane_sites.contains(&scan.site) {
                site.lane_sites.push(scan.site.clone());
                site.lane_sites.sort();
            }
            site.take = site.take.max(take);
        }
        let scan_examined = calls.saturating_mul(reserve);
        summary.examined = summary.examined.saturating_add(scan_examined);
        summary.index_entries = summary.index_entries.saturating_add(scan_examined);
        summary.rule_probes = summary.rule_probes.saturating_add(rule_probes);
        summary.steps = summary
            .steps
            .saturating_add(scan_examined.saturating_mul(5));
        summary.nonuniform_range |= !hoist;
        if !hoist {
            self.completeness = Completeness::Capped;
        }
        if reserve != 1 || scan.merge_site.is_none() {
            summary
                .costs
                .scan(Cost::range(scan, calls, factors, reserve));
        }
        summary.costs.probes(
            &scan.site,
            if hoist { calls } else { scan_examined },
            probe_bound,
            factors,
        );
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
        if table == crate::CONNECTED_TABLE {
            return 1;
        }
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
        patch: Option<&Expr>,
        calls: u64,
        factors: &[(String, u64)],
    ) -> Summary {
        let mut summary = write_summary(table, kind, calls, factors);
        // @ref LLP 1017#24-metering — reserve only probes a writer may perform.
        for (by, max) in crate::cap::write_caps(self.schema, table, kind, patch) {
            let maintained = crate::cap::count_maintain(self.schema, table, by);
            let rows = if maintained.is_some() {
                1
            } else {
                u64::from(max)
            }
            .saturating_mul(calls);
            summary.examined = summary.examined.saturating_add(rows);
            summary.index_entries = summary.index_entries.saturating_add(rows);
            summary.steps = summary.steps.saturating_add(rows.saturating_mul(5));
            summary.costs.scan(Cost::cap(
                table,
                by,
                max,
                maintained.map(|maintain| maintain.target.as_str()),
                calls,
                factors,
            ));
        }
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
        summary.costs.probes(
            &format!("{table} {kind:?} rules/final constraints"),
            calls,
            probe_multiplier,
            factors,
        );
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
    summary
        .costs
        .step(summary.steps, &format!("{table} {kind:?} writes"), factors);
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

#[cfg(test)]
mod tests;
