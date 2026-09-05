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
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[error("{code}: {message}; rewrite: {rewrite}")]
pub struct JobRefusal {
    pub code: String,
    pub family: String,
    pub message: String,
    pub site: String,
    pub rewrite: String,
    pub guide: String,
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
        }
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
        Self::new(
            "E_JOB_ARGS",
            message,
            name,
            format!("{name}({signature:?})"),
        )
    }
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
        errors.push(shape_error());
    }
    for statement in &program.body {
        let Stmt::For {
            domain: LoopDomain::Page(scan),
            ..
        } = statement
        else {
            errors.push(shape_error());
            continue;
        };
        let Bound::Literal(take) = scan.take else {
            errors.push(shape_error());
            continue;
        };
        if take == 0
            || scan.order != Order::Asc
            || scan.after.is_some()
            || scan.before.is_some()
            || scan.range.is_some()
            || scan.merge_site.is_some()
            || scan.prefix.iter().any(|p| !prefix_expr(p, &program.args))
        {
            errors.push(shape_error());
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
        if !unstable.is_empty()
            || (!index.unique && index.columns.last().map(String::as_str) != Some("id"))
            || scan.prefix.len() > index.columns.len()
        {
            errors.push(CheckError {
                code: "E_JOB_CURSOR_INDEX".into(),
                message: format!(
                    "{}.{} needs immutable, total keys and a prefix no longer than its index",
                    scan.table, scan.index
                ),
                rewrite: format!(
                    "immutable {} on {}; use an index ending in id, or by byId",
                    unstable.join(", "),
                    scan.table
                ),
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
fn shape_error() -> CheckError {
    CheckError { code: "E_UNBOUND_LOOP".into(), message: "a job contains only chunk sweeps with literal bounds and argument/literal prefixes".into(), rewrite: "job fill:\n  chunk row in table first 100 by byId:\n    update table[row.id] { column: value }".into() }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkRecord {
    pub sweep: usize,
    pub chunk: u64,
    pub cursor: Option<Vec<Value>>,
    pub rows_visited: usize,
}
