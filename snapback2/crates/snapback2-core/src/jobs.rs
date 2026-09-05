//! Certified administrative sweeps. Nothing here is a client operation.
// @ref LLP 1016#d2--a-job-is-a-sequence-of-sweeps — certify each bounded chunk, never the size of the whole task.
use crate::{
    ArgType, Bound, Ceilings, Certificate, CheckError, Checker, Constraint, Expr, LoopDomain,
    Order, Program, ProgramKind, Scan, Schema, Stmt, Value, WriteKind, WriteSite,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobCertificate {
    pub kind: String,
    pub sweeps: Vec<Sweep>,
    pub chunks: String,
    pub engine_writes: Vec<String>,
    pub per_chunk: Vec<Certificate>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sweep {
    pub table: String,
    pub index: String,
    pub prefix_template: Vec<Expr>,
    pub take: u32,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRecord {
    pub id: String,
    pub name: String,
    pub source: Option<String>,
    pub program_hash: String,
    pub generation: String,
    pub args: BTreeMap<String, Value>,
    pub state: String,
    pub sweep: usize,
    pub upper_key: Option<Vec<Value>>,
    pub cursor: Option<Vec<Value>>,
    pub chunks: u64,
    pub rows_written: BTreeMap<String, u64>,
    pub enqueued_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub finished_at: Option<i64>,
    pub last_error: Option<JobRefusal>,
}
/// A job-family refusal, or a chunk's underlying rejection kept whole with the job context added.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[error("{code}: {message}; rewrite: {rewrite}")]
#[serde(rename_all = "camelCase")]
pub struct JobRefusal {
    pub code: String,
    pub family: String,
    pub message: String,
    pub site: String,
    pub rewrite: String,
    pub guide: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub job: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sweep: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chunk: Option<u64>,
}
impl JobRefusal {
    pub fn new(
        code: &str,
        message: impl Into<String>,
        site: &str,
        rewrite: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            family: "job".into(),
            message: message.into(),
            site: site.into(),
            rewrite: rewrite.into(),
            guide: "job".into(),
            job: None,
            sweep: None,
            chunk: None,
        }
    }
    pub fn with_job(mut self, id: &str, sweep: usize, chunk: u64) -> Self {
        self.job = Some(id.into());
        self.sweep = Some(sweep);
        self.chunk = Some(chunk);
        self
    }
    pub(crate) fn generation(name: &str) -> Self {
        Self::new(
            "E_JOB_GENERATION",
            "the bound job or its sweep index changed",
            name,
            "run --cancel <job-id> --as system and start again, or restore the declaration",
        )
    }
    pub(crate) fn args(
        name: &str,
        signature: &BTreeMap<String, ArgType>,
        message: impl Into<String>,
    ) -> Self {
        Self::new("E_JOB_ARGS", message, name, quarry_signature(name, signature))
    }
    /// Nothing is silent: a control verb on a job in the wrong state names the state.
    pub(crate) fn state(id: &str, state: &str, verb: &str, accepted: &str) -> Self {
        Self::new(
            "E_JOB_STATE",
            format!("{id} is {state}; {verb} applies to a {accepted} job"),
            id,
            if verb == "resume" {
                "run <job> --as system to start again; only a parked job resumes"
            } else {
                "trace <job-id> shows the state; a done or cancelled job needs no cancel"
            },
        )
    }
    // @ref LLP 1016#d2--a-job-is-a-sequence-of-sweeps — a parked chunk keeps the rejection's own envelope, the same one /api/mutation would carry, plus the job context.
    pub(crate) fn rejected(error: &crate::RuntimeError, site: &str) -> Self {
        if let crate::RuntimeError::Job(refusal) = error {
            return (**refusal).clone();
        }
        let code = error.code();
        let family = rejection_family(code);
        let mut refusal = Self::new(
            code,
            error.to_string(),
            site,
            "fix the refused data or constraint, then run --resume <job-id> --as system",
        );
        refusal.family = family.into();
        refusal.guide = format!("{family}/runtime");
        refusal
    }
}
/// The family a rejected mutation carries on the wire; a parked chunk uses the same one.
pub fn rejection_family(code: &str) -> &'static str {
    if code.starts_with("E_RULE") {
        "rule"
    } else if code.starts_with("E_BOUND")
        || matches!(code, "E_FANOUT" | "E_STEPS" | "E_TRACE_SUBSET")
    {
        "bound"
    } else if code.starts_with("E_CONSTRAINT") {
        "schema"
    } else if code.starts_with("E_JOB") {
        "job"
    } else {
        "input"
    }
}
/// The declaration as an author writes it: `job name(arg: type, ...)`, module prefix dropped.
pub fn quarry_signature(name: &str, args: &BTreeMap<String, ArgType>) -> String {
    let short = name.rsplit('.').next().unwrap_or(name);
    if args.is_empty() {
        return format!("job {short}:");
    }
    let args = args
        .iter()
        .map(|(arg, ty)| format!("{arg}: {}", quarry_arg_type(ty)))
        .collect::<Vec<_>>()
        .join(", ");
    format!("job {short}({args}):")
}
pub fn quarry_arg_type(ty: &ArgType) -> String {
    match ty {
        ArgType::Cursor => "cursor".into(),
        ArgType::Id => "id".into(),
        ArgType::Principal => "principal".into(),
        ArgType::Ref { table } => table.clone(),
        ArgType::Text { max } => format!("text <={max}"),
        ArgType::Bytes { max } => format!("bytes <={max}"),
        ArgType::Image { max } => format!("image <={max}"),
        ArgType::Video { max } => format!("video <={max}"),
        ArgType::Int => "int".into(),
        ArgType::Bool => "bool".into(),
        ArgType::Time => "time".into(),
        ArgType::Json { max_bytes } => format!("json <={max_bytes}"),
        ArgType::Optional(inner) => format!("{} ?", quarry_arg_type(inner)),
        ArgType::Scalar => "scalar".into(),
        ArgType::List { of, max } => format!(
            "[{}] <={max}",
            of.as_deref().map(quarry_arg_type).unwrap_or_else(|| "scalar".into())
        ),
        ArgType::Enum { variants } => quarry_enum(variants),
        ArgType::Decimal { scale } => format!("decimal {scale}"),
        ArgType::Money { currency, scale } => format!("money {currency} {scale}"),
    }
}
/// Variants are spelled as Quarry strings: single quotes, backslash escapes.
pub fn quarry_enum(variants: &[String]) -> String {
    format!(
        "enum({})",
        variants
            .iter()
            .map(|v| format!("'{}'", v.replace('\\', "\\\\").replace('\'', "\\'")))
            .collect::<Vec<_>>()
            .join(", ")
    )
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkOutcome {
    pub job: JobRecord,
    pub execution: Option<crate::Execution>,
}

pub(crate) fn certify(
    schema: &Schema,
    program: &Program,
    ceilings: &Ceilings,
) -> Result<Certificate, Vec<CheckError>> {
    if ceilings.write_rows == 0 {
        return Err(vec![CheckError {
            code: "E_BOUND".into(),
            message: "a job chunk needs one engine progress write".into(),
            rewrite: "allow at least one write for _jobs progress".into(),
        }]);
    }
    // @ref LLP 1016#d1--the-system-principal-is-the-stores-owner — certify owner reads under total visibility; constraints and all write accounting stay intact.
    let mut owner_schema = schema.clone();
    for table in owner_schema.tables.values_mut() {
        table.rules.read = crate::RuleExpr::Allow;
        table.rules.insert = crate::RuleExpr::Allow;
        table.rules.update = crate::RuleExpr::Allow;
        table.rules.delete = crate::RuleExpr::Allow;
    }
    let mut sweeps = Vec::new();
    let mut per_chunk = Vec::new();
    let mut errors = Vec::new();
    if program.body.is_empty() {
        errors.push(shape_error(&program.name, "the body is empty"));
    }
    for (position, statement) in program.body.iter().enumerate() {
        let site = format!("{}:statement:{}", program.name, position + 1);
        let Stmt::For {
            domain: LoopDomain::Page(scan),
            ..
        } = statement
        else {
            errors.push(shape_error(&site, "it is a plain statement, not a chunk"));
            continue;
        };
        let Bound::Literal(take) = scan.take else {
            errors.push(shape_error(&site, "its `first N` is not a literal"));
            continue;
        };
        if take == 0
            || scan.order != Order::Asc
            || scan.after.is_some()
            || scan.before.is_some()
            || scan.range.is_some()
            || scan.merge_site.is_some()
        {
            errors.push(shape_error(
                &site,
                "a chunk is `first N by index` in ascending order, without cursors, ranges, or merges",
            ));
            continue;
        }
        if scan.prefix.iter().any(|p| !prefix_expr(p, &program.args)) {
            errors.push(shape_error(
                &site,
                "its prefix is neither a literal nor a job argument",
            ));
            continue;
        }
        let Some(index) = schema
            .table(&scan.table)
            .and_then(|t| t.indexes.get(&scan.index))
        else {
            errors.push(CheckError {
                code: "E_JOB_CURSOR_INDEX".into(),
                message: format!("unknown sweep index {}.{}", scan.table, scan.index),
                rewrite: "by byId".into(),
            });
            continue;
        };
        let table = schema.table(&scan.table).unwrap();
        let unstable: Vec<_> = index.columns.iter().filter(|c| c.as_str() != "id" && !table.constraints.iter().any(|constraint| matches!(constraint, Constraint::Immutable { fields } if fields.contains(c)))).cloned().collect();
        // Three distinct failures, each with the rewrite that repairs it (LLP 1016 §7).
        let cursor_index = if !unstable.is_empty() {
            Some((
                format!(
                    "{}.{} orders the sweep by a key a write can move: {}",
                    scan.table,
                    scan.index,
                    unstable.join(", ")
                ),
                format!("declare `immutable {}` on {}, or sweep by byId", unstable.join(", "), scan.table),
            ))
        } else if !index.unique && index.columns.last().map(String::as_str) != Some("id") {
            Some((
                format!("{}.{} is not a total order: two rows can share a key", scan.table, scan.index),
                format!("end {} in `id` (or declare it unique), or sweep by byId", scan.index),
            ))
        } else if scan.prefix.len() > index.columns.len() {
            Some((
                format!("the prefix names {} columns but {}.{} has {}", scan.prefix.len(), scan.table, scan.index, index.columns.len()),
                format!("shorten the prefix to at most {} columns", index.columns.len()),
            ))
        } else {
            None
        };
        if let Some((message, rewrite)) = cursor_index {
            errors.push(CheckError {
                code: "E_JOB_CURSOR_INDEX".into(),
                message,
                rewrite,
            });
            continue;
        }
        let chunk = chunk_program(program, statement, scan);
        // Reserve the progress write before checking the mutation's physical writes.
        let mut chunk_ceilings = ceilings.clone();
        chunk_ceilings.write_rows = chunk_ceilings.write_rows.saturating_sub(1);
        match Checker::new(&owner_schema, chunk_ceilings).check_all(&chunk) {
            Ok(mut certificate) => {
                certificate.schema_hash = schema.hash();
                certificate.write_sites.push(WriteSite {
                    table: "_jobs".into(),
                    kind: WriteKind::Update,
                    max_rows: 1,
                });
                sweeps.push(Sweep {
                    table: scan.table.clone(),
                    index: scan.index.clone(),
                    prefix_template: scan.prefix.clone(),
                    take,
                });
                per_chunk.push(certificate);
            }
            Err(mut refused) => errors.append(&mut refused),
        }
    }
    if !errors.is_empty() {
        return Err(errors);
    }
    let mut certificate = per_chunk[0].clone();
    certificate.plan_hash = crate::digest(program);
    certificate.job = Some(Box::new(JobCertificate {
        kind: "job".into(),
        sweeps,
        chunks: "unbounded".into(),
        engine_writes: vec!["_jobs".into()],
        per_chunk,
    }));
    certificate.plan_hash = crate::store_jobs::bound_hash(program, &certificate, schema);
    Ok(certificate)
}
pub(crate) fn upper_scan(scan: &Scan) -> Scan {
    Scan {
        site: format!("{}.__upper", scan.site),
        order: Order::Desc,
        take: Bound::Literal(1),
        ..scan.clone()
    }
}
fn chunk_program(program: &Program, statement: &Stmt, scan: &Scan) -> Program {
    Program {
        kind: ProgramKind::Mutation,
        result_page_site: None,
        body: vec![
            Stmt::Const {
                name: "__job_upper".into(),
                value: Expr::Scan(upper_scan(scan)),
            },
            statement.clone(),
        ],
        ..program.clone()
    }
}
fn prefix_expr(expr: &Expr, args: &BTreeMap<String, ArgType>) -> bool {
    match expr {
        Expr::Literal(_) => true,
        Expr::Variable(name) => args.contains_key(name),
        _ => false,
    }
}
// @ref LLP 1016#d2--a-job-is-a-sequence-of-sweeps — a job is chunk blocks and nothing else; misuse reports in the job family, not as an unbounded loop.
fn shape_error(site: &str, detail: &str) -> CheckError {
    CheckError {
        code: "E_JOB_SHAPE".into(),
        message: format!("{site} is not a chunk: {detail}"),
        rewrite: "a job is one or more `chunk` blocks and nothing else:\njob fill:\n  chunk row in table first 100 by byId:\n    update table[row.id] { column: value }".into(),
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkRecord {
    pub sweep: usize,
    pub chunk: u64,
    pub cursor: Option<Vec<Value>>,
    pub rows_visited: usize,
}
