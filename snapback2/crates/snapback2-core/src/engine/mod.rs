#![allow(unused_imports)]
use crate::certificate::Certificate;
use crate::ir::*;
use crate::schema::*;
use crate::store::{CommitRecord, Store, TouchedKey, unix_millis};
use crate::value::{I53_MAX, I53_MIN, Value, ValueError, canonical_json, digest, object};
use rusqlite::{Connection, OptionalExtension, Transaction, params, params_from_iter};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Context {
    pub viewer: String,
    pub principal_kind: String,
    pub auth_epoch: u64,
    pub args: BTreeMap<String, Value>,
    pub now: Option<i64>,
    pub new_ids: VecDeque<String>,
    pub read_time: Option<i64>,
}

impl Context {
    pub fn query(viewer: impl Into<String>, args: BTreeMap<String, Value>) -> Self {
        Self {
            viewer: viewer.into(),
            principal_kind: "user".to_owned(),
            auth_epoch: 1,
            args,
            now: None,
            new_ids: VecDeque::new(),
            read_time: None,
        }
    }

    pub fn mutation(viewer: impl Into<String>, args: BTreeMap<String, Value>) -> Self {
        let mut context = Self::query(viewer, args);
        context.now = Some(0);
        context
    }

    pub fn system() -> Self {
        Self {
            viewer: "system".to_owned(),
            principal_kind: "system".to_owned(),
            auth_epoch: 1,
            args: BTreeMap::new(),
            now: Some(0),
            new_ids: VecDeque::new(),
            read_time: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RowRecord {
    pub table: String,
    pub id: String,
    pub row: Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum StopReason {
    Limit,
    Exhausted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TraceRange {
    pub site: String,
    pub table: String,
    pub index: String,
    pub prefix: Vec<Value>,
    pub examined_ids: Vec<String>,
    pub visible_ids: Vec<String>,
    pub stop: StopReason,
    pub absence: bool,
    pub halo: Option<RowRecord>,
    pub n2_key: Option<Vec<Value>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuleInputTrace {
    pub rule_hash: String,
    pub table: String,
    pub index: String,
    pub key: Vec<Value>,
    pub result: bool,
    pub hidden: bool,
    pub pinned_inputs_digest: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PointTrace {
    pub site: String,
    pub table: String,
    pub index: String,
    pub key: Vec<Value>,
    pub examined: bool,
    pub visible: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConstraintTrace {
    pub table: String,
    pub check: String,
    pub examined_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmitRecord {
    pub id: String,
    pub effect: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthoritativeTrace {
    pub rows: Vec<RowRecord>,
    pub points: Vec<PointTrace>,
    pub constraint_inputs: Vec<ConstraintTrace>,
    pub ranges: Vec<TraceRange>,
    pub absences: Vec<(String, String, Vec<Value>)>,
    pub rule_inputs: Vec<RuleInputTrace>,
    pub examined: u64,
    pub rule_probes: u64,
    pub steps: u64,
    pub writes: BTreeMap<String, u64>,
    // @ref LLP 1001#2-what-a-commit-records — invalidation uses physical before/after keys.
    #[serde(default)]
    pub touched: Vec<TouchedKey>,
    #[serde(default)]
    pub emits: Vec<EmitRecord>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceiptRange {
    pub site: String,
    pub table: String,
    pub index: String,
    pub prefix: Vec<Value>,
    pub row_ids: Vec<String>,
    pub stop: StopReason,
    pub absence: bool,
    pub halo: Option<RowRecord>,
    pub n2_key: Option<Vec<Value>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Verdict {
    pub rule_hash: String,
    pub pinned_inputs_digest: String,
    pub principal: String,
    pub auth_epoch: u64,
    pub result: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClosureReceipt {
    pub rows: Vec<RowRecord>,
    pub ranges: Vec<ReceiptRange>,
    pub absences: Vec<(String, String, Vec<Value>)>,
    pub verdicts: Vec<Verdict>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Execution {
    pub result: Value,
    pub trace: AuthoritativeTrace,
    pub receipt: ClosureReceipt,
    pub state: ExecutionState,
    pub seq: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ExecutionState {
    Complete,
    Capped { site: String, take: u64 },
    Partial { reason: String },
    Denied { rule: String },
    Committed { seq: u64 },
    Rejected { code: String, message: String },
}

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Value(#[from] ValueError),
    #[error("E_SCHEMA: {0}")]
    Schema(String),
    #[error("E_SCHEMA_RESERVED: schema or program names reserved table {0}")]
    SchemaReserved(String),
    #[error("E_SCHEMA_INDEX_COLUMN: index {table}.{index} cannot use list column {column}")]
    SchemaIndexColumn {
        table: String,
        index: String,
        column: String,
    },
    #[error("E_SERIALIZATION: {0}")]
    Serialization(String),
    #[error("E_REQUIRE:{code}: program requirement failed")]
    Require { code: String },
    #[error("E_RULE: {effect:?} denied on {table}")]
    Rule { table: String, effect: Effect },
    #[error("E_CONSTRAINT: {0}")]
    Constraint(String),
    #[error("E_FANOUT: runtime loop exceeded its admitted bound")]
    Fanout,
    #[error("E_STEPS: runtime steps exceeded certificate {0}")]
    Steps(u64),
    #[error("E_INPUT: {0}")]
    Input(String),
    #[error("E_TRACE_SUBSET: {0}")]
    TraceSubset(String),
    #[error("E_OP_UNKNOWN: {0}")]
    OpUnknown(String),
    #[error("E_MIGRATION_PLAN: {0}")]
    MigrationPlan(String),
}

pub struct Engine {
    store: Store,
    schema: Schema,
    verdicts: Vec<Verdict>,
}

impl Engine {
    pub fn new(store: Store, schema: Schema) -> Result<Self, RuntimeError> {
        validate_schema(&schema)?;
        Ok(Self {
            store,
            schema,
            verdicts: Vec::new(),
        })
    }

    pub fn memory(schema: Schema) -> Result<Self, RuntimeError> {
        Self::new(Store::memory()?, schema)
    }

    pub(crate) fn install_verdicts(&mut self, verdicts: &[Verdict]) {
        self.verdicts = verdicts.to_vec();
    }

    pub fn schema(&self) -> &Schema {
        &self.schema
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    pub(crate) fn store_mut(&mut self) -> &mut Store {
        &mut self.store
    }

    pub(crate) fn set_schema(&mut self, schema: Schema) -> Result<(), RuntimeError> {
        validate_schema(&schema)?;
        self.schema = schema;
        Ok(())
    }

    pub fn seed(&mut self, table: &str, row: Value) -> Result<(), RuntimeError> {
        validate_row(self.schema.table(table), table, &row)?;
        let id = row.field("id")?.as_str()?.to_owned();
        self.store.conn.execute(
            "INSERT OR REPLACE INTO rows(table_name, row_id, data) VALUES (?1, ?2, ?3)",
            params![table, id, canonical_json(&row)],
        )?;
        reindex_row(&self.store.conn, &self.schema, table, &row)?;
        Ok(())
    }

    pub fn rows(&self, table: &str) -> Result<Vec<Value>, RuntimeError> {
        fetch_table_connection(&self.store.conn, table)
    }

    pub fn execute(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        context: Context,
    ) -> Result<Execution, RuntimeError> {
        match self.execute_with_kind(program, certificate, context, None) {
            Ok(execution) => Ok(execution),
            Err(error) if program.kind == ProgramKind::Query => {
                let rule = match &error {
                    RuntimeError::Rule { table, effect } => format!("{table}.{effect:?}"),
                    RuntimeError::Require { code } => code.clone(),
                    _ => return Err(error),
                };
                Ok(self.empty_execution(ExecutionState::Denied { rule })?)
            }
            Err(error) if program.kind == ProgramKind::Mutation && is_sqlite_constraint(&error) => {
                Ok(self.empty_execution(ExecutionState::Rejected {
                    code: "E_CONSTRAINT".to_owned(),
                    message: error.to_string(),
                })?)
            }
            // Only SQLite constraint failures are program refusals. I/O,
            // corruption, and other database failures remain RuntimeError::Sql.
            Err(error) => Err(error),
        }
    }

    fn empty_execution(&self, state: ExecutionState) -> Result<Execution, RuntimeError> {
        Ok(Execution {
            result: Value::Null,
            trace: AuthoritativeTrace::default(),
            receipt: ClosureReceipt::default(),
            state,
            seq: self.store.commit_seq()?,
        })
    }

    pub(crate) fn execute_with_kind(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        context: Context,
        commit_kind: Option<&str>,
    ) -> Result<Execution, RuntimeError> {
        if certificate.plan_hash != digest(program) {
            return Err(RuntimeError::TraceSubset("plan hash mismatch".to_owned()));
        }
        if certificate.schema_hash != self.schema.hash() {
            return Err(RuntimeError::TraceSubset("schema hash mismatch".to_owned()));
        }
        if program.kind == ProgramKind::Query && !certificate.write_sites.is_empty() {
            return Err(RuntimeError::TraceSubset(
                "query certificate contains write sites".to_owned(),
            ));
        }
        let principal = context.viewer.clone();
        let principal_kind = context.principal_kind.clone();
        let commit_at = context.now.unwrap_or_else(unix_millis);
        let current_seq = self.store.commit_seq()?;
        let seq = if program.kind == ProgramKind::Mutation {
            current_seq.saturating_add(1)
        } else {
            current_seq
        };
        let transaction = self.store.conn.transaction()?;
        let mut runner = Runner::new(
            &transaction,
            &self.schema,
            certificate,
            context,
            &self.verdicts,
            seq,
        );
        let flow = runner.statements(&program.body)?;
        let result = match flow {
            Flow::Return(value) => value,
            _ => Value::Null,
        };
        runner.assert_bounds()?;
        let state = match program.kind {
            ProgramKind::Mutation => ExecutionState::Committed { seq },
            ProgramKind::Query => query_state(&runner.receipt, certificate),
        };
        let execution = Execution {
            result,
            trace: runner.trace,
            receipt: runner.receipt,
            state,
            seq,
        };
        if program.kind == ProgramKind::Mutation {
            // @ref LLP 1001#2-what-a-commit-records — data, outbox, and commit record are atomic.
            let kind = commit_kind.unwrap_or(if principal_kind == "system" {
                "system"
            } else {
                "mutation"
            });
            let record = CommitRecord {
                seq,
                at: commit_at,
                program: program.name.clone(),
                principal,
                kind: kind.to_owned(),
                touched: execution.trace.touched.clone(),
                writes: execution.trace.writes.clone(),
                emits: execution.trace.emits.len() as u64,
            };
            append_commit(&transaction, &record)?;
        }
        transaction.commit()?;
        Ok(execution)
    }

    pub(crate) fn probe_rule(
        &mut self,
        rule: &RuleExpr,
        row: &Value,
        context: Context,
    ) -> Result<(bool, AuthoritativeTrace), RuntimeError> {
        let seq = self.store.commit_seq()?;
        let transaction = self.store.conn.transaction()?;
        let mut runner = Runner::probe(&transaction, &self.schema, context, &self.verdicts, seq);
        let result = runner.eval_rule(rule, &rule.hash(), row)?;
        let trace = runner.trace;
        transaction.commit()?;
        Ok((result, trace))
    }
}

fn query_state(receipt: &ClosureReceipt, certificate: &Certificate) -> ExecutionState {
    // @ref LLP 0329.014.004#5-policy — invisible rows never become a cardinality oracle.
    // Exhausting a range of hidden rows is an honest complete empty page;
    // Denied is reserved for an explicit Rule or query Require error. Capped
    // likewise comes only from a disclosure-safe closure extent, never the
    // authoritative hidden-row trace.
    if let Some(range) = receipt
        .ranges
        .iter()
        .find(|range| range.stop == StopReason::Limit)
    {
        let take = certificate
            .read_sites
            .iter()
            .find(|site| site.site == range.site)
            .map_or(0, |site| site.take);
        return ExecutionState::Capped {
            site: range.site.clone(),
            take,
        };
    }
    ExecutionState::Complete
}

pub(crate) fn is_sqlite_constraint(error: &RuntimeError) -> bool {
    matches!(
        error,
        RuntimeError::Sql(rusqlite::Error::SqliteFailure(sqlite, _))
            if sqlite.code == rusqlite::ErrorCode::ConstraintViolation
    )
}

pub(crate) fn append_commit(
    transaction: &Transaction<'_>,
    record: &CommitRecord,
) -> Result<(), RuntimeError> {
    transaction.execute(
        "INSERT INTO _commits(seq, at, program, principal, kind, touched, writes, emits)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            record.seq as i64,
            record.at,
            record.program,
            record.principal,
            record.kind,
            serde_json::to_string(&record.touched)
                .map_err(|error| RuntimeError::Serialization(error.to_string()))?,
            serde_json::to_string(&record.writes)
                .map_err(|error| RuntimeError::Serialization(error.to_string()))?,
            record.emits as i64,
        ],
    )?;
    transaction.execute(
        "DELETE FROM _commits
         WHERE seq <= (SELECT COALESCE(MAX(seq), 0) - 10000 FROM _commits)",
        [],
    )?;
    Ok(())
}

pub(crate) fn validate_schema(schema: &Schema) -> Result<(), RuntimeError> {
    if let Some(name) = schema.tables.keys().find(|name| name.starts_with('_')) {
        return Err(RuntimeError::SchemaReserved(name.clone()));
    }
    for (table_name, table) in &schema.tables {
        for (index_name, index) in &table.indexes {
            for column in &index.columns {
                if table
                    .columns
                    .get(column)
                    .is_some_and(ColumnType::contains_list)
                {
                    return Err(RuntimeError::SchemaIndexColumn {
                        table: table_name.clone(),
                        index: index_name.clone(),
                        column: column.clone(),
                    });
                }
            }
        }
    }
    Ok(())
}

mod index;
mod runner;
mod runner_ops;

#[allow(unused_imports)]
use index::{EvaluatedRange, delete_index_row, lookup_indexed, row_ids, scan_indexed};
#[allow(unused_imports)]
pub(crate) use index::{fetch_table_connection, index_values, reindex_row, validate_row};
#[allow(unused_imports)]
use runner::{Flow, Runner};
