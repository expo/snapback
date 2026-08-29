#![allow(unused_imports)]
use crate::certificate::Certificate;
use crate::ir::*;
use crate::schema::*;
use crate::value::{canonical_json, digest, object, Value, ValueError, I53_MAX, I53_MIN};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Transaction};
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Execution {
    pub result: Value,
    pub trace: AuthoritativeTrace,
    pub receipt: ClosureReceipt,
}

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Value(#[from] ValueError),
    #[error("E_SCHEMA: {0}")]
    Schema(String),
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
}

pub struct Engine {
    connection: Connection,
    schema: Schema,
    verdicts: Vec<Verdict>,
}

impl Engine {
    pub fn memory(schema: Schema) -> Result<Self, RuntimeError> {
        let connection = Connection::open_in_memory()?;
        connection.execute_batch(
            "CREATE TABLE rows (
                table_name TEXT NOT NULL,
                row_id TEXT NOT NULL,
                data TEXT NOT NULL,
                PRIMARY KEY (table_name, row_id)
             );
             CREATE TABLE index_entries (
                table_name TEXT NOT NULL,
                index_name TEXT NOT NULL,
                row_id TEXT NOT NULL,
                c0 TEXT, c1 TEXT, c2 TEXT, c3 TEXT,
                c4 TEXT, c5 TEXT, c6 TEXT, c7 TEXT,
                PRIMARY KEY (table_name, index_name, row_id)
             );
             CREATE INDEX index_entries_lookup ON index_entries(
                table_name, index_name, c0, c1, c2, c3, c4, c5, c6, c7, row_id
             );",
        )?;
        Ok(Self {
            connection,
            schema,
            verdicts: Vec::new(),
        })
    }

    pub(crate) fn install_verdicts(&mut self, verdicts: &[Verdict]) {
        self.verdicts = verdicts.to_vec();
    }

    pub fn schema(&self) -> &Schema {
        &self.schema
    }

    pub fn seed(&mut self, table: &str, row: Value) -> Result<(), RuntimeError> {
        validate_row(self.schema.table(table), table, &row)?;
        let id = row.field("id")?.as_str()?.to_owned();
        self.connection.execute(
            "INSERT OR REPLACE INTO rows(table_name, row_id, data) VALUES (?1, ?2, ?3)",
            params![table, id, canonical_json(&row)],
        )?;
        reindex_row(&self.connection, &self.schema, table, &row)?;
        Ok(())
    }

    pub fn rows(&self, table: &str) -> Result<Vec<Value>, RuntimeError> {
        fetch_table_connection(&self.connection, table)
    }

    pub fn execute(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        context: Context,
    ) -> Result<Execution, RuntimeError> {
        if certificate.plan_hash != digest(program) {
            return Err(RuntimeError::TraceSubset("plan hash mismatch".to_owned()));
        }
        if certificate.schema_hash != self.schema.hash() {
            return Err(RuntimeError::TraceSubset("schema hash mismatch".to_owned()));
        }
        let transaction = self.connection.transaction()?;
        let mut runner = Runner::new(
            &transaction,
            &self.schema,
            certificate,
            context,
            &self.verdicts,
        );
        let flow = runner.statements(&program.body)?;
        let result = match flow {
            Flow::Return(value) => value,
            _ => Value::Null,
        };
        runner.assert_bounds()?;
        let execution = Execution {
            result,
            trace: runner.trace,
            receipt: runner.receipt,
        };
        transaction.commit()?;
        Ok(execution)
    }
}


mod index;
mod runner;
mod runner_ops;

#[allow(unused_imports)]
use index::*;
#[allow(unused_imports)]
use runner::{Flow, Runner};
