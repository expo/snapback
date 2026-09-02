#![allow(unused_imports)]
use crate::certificate::{Certificate, RuleCertificate};
use crate::identity::{Actor, CURRENT_VALUE_MODEL_VERSION, SYSTEM_PRINCIPAL_ID};
use crate::ir::*;
use crate::principal::PrincipalId;
use crate::schema::*;
use crate::store::{CommitRecord, Store, TouchedKey, unix_millis};
use crate::value::{I53_MAX, I53_MIN, Value, ValueError, canonical_json, digest, object};
use rusqlite::{Connection, OptionalExtension, Transaction, params, params_from_iter};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Context {
    viewer: PrincipalId,
    principal_kind: String,
    pub auth_epoch: u64,
    pub args: BTreeMap<String, Value>,
    pub now: Option<i64>,
    pub new_ids: VecDeque<String>,
    pub read_time: Option<i64>,
    #[serde(default)]
    pub(crate) seed_write: bool,
}

impl Context {
    pub fn query(actor: Actor, args: BTreeMap<String, Value>) -> Self {
        Self {
            viewer: PrincipalId::new(actor.id()),
            principal_kind: actor.kind().to_owned(),
            auth_epoch: 1,
            args,
            now: None,
            new_ids: VecDeque::new(),
            read_time: None,
            seed_write: false,
        }
    }

    pub fn mutation(actor: Actor, args: BTreeMap<String, Value>) -> Self {
        let mut context = Self::query(actor, args);
        context.now = Some(0);
        context
    }

    pub fn viewer(&self) -> &str {
        self.viewer.as_str()
    }

    pub fn principal_kind(&self) -> &str {
        &self.principal_kind
    }

    fn system() -> Self {
        Self {
            viewer: PrincipalId::new(SYSTEM_PRINCIPAL_ID.as_str()),
            principal_kind: SYSTEM_PRINCIPAL_ID.to_string(),
            // @ref LLP 1001#6-identity-identityrs — zero is reserved for
            // trusted system and development-alias contexts; persisted
            // sessions always carry a positive durable epoch.
            auth_epoch: 0,
            args: BTreeMap::new(),
            now: Some(0),
            new_ids: VecDeque::new(),
            read_time: None,
            seed_write: false,
        }
    }
}

#[cfg(test)]
mod context_tests {
    use super::{Context, SYSTEM_PRINCIPAL_ID};

    #[test]
    fn private_system_context_uses_the_reserved_zero_epoch() {
        let context = Context::system();
        assert_eq!(context.viewer(), SYSTEM_PRINCIPAL_ID.as_str());
        assert_eq!(context.principal_kind(), SYSTEM_PRINCIPAL_ID.as_str());
        assert_eq!(context.auth_epoch, 0);
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
    pub order: Order,
    pub take: u32,
    pub after: Option<Value>,
    pub before: Option<Value>,
    pub gt: Option<Value>,
    pub gte: Option<Value>,
    pub lt: Option<Value>,
    pub lte: Option<Value>,
    pub rule_hash: String,
    pub examined_ids: Vec<String>,
    /// Every examined row admitted by the read rule, including page-cut rows.
    pub visible_ids: Vec<String>,
    /// The admitted rows that the scan returned after applying `take`.
    pub returned_ids: Vec<String>,
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
    pub index: String,
    pub prefix: Vec<Value>,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub missing_preimages: Vec<(String, String)>,
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
    pub order: Order,
    pub take: u32,
    pub after: Option<Value>,
    pub before: Option<Value>,
    pub gt: Option<Value>,
    pub gte: Option<Value>,
    pub lt: Option<Value>,
    pub lte: Option<Value>,
    pub rule_hash: String,
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
    Capped,
    Partial { reason: String },
    Denied { rule: String },
    Committed { seq: u64 },
    Rejected { code: String, message: String },
}

pub(crate) const MISSING_AUTHORITY_LABEL: &str = "missing-authority";

// @ref LLP 1001#2-what-a-commit-records — replay may consume authority verdicts, never infer them from held rows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum RuleAuthority {
    StoreAuthoritative,
    ReceiptOnly,
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
    #[error("E_SCHEMA_MAINTAIN: {0}")]
    SchemaMaintain(String),
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
    #[error("E_STORE_OWNED: {holder}")]
    StoreOwned { holder: String },
    #[error("E_STORE_VERSION: {detail}; reset the development store")]
    StoreVersion { detail: String },
    #[error("E_TRACE_SUBSET: {0}")]
    TraceSubset(String),
    #[error("E_OP_UNKNOWN: {0}")]
    OpUnknown(String),
    #[error("E_MIGRATION_PLAN: {0}")]
    MigrationPlan(String),
    #[error(transparent)]
    Successor(#[from] Box<crate::successor::SuccessorRefusal>),
}

impl RuntimeError {
    pub fn code(&self) -> &str {
        match self {
            Self::Sql(_) if is_sqlite_constraint(self) => "E_CONSTRAINT",
            Self::Sql(_) => "E_SQL",
            Self::Value(error) => match error {
                ValueError::Overflow(_) => "E_OVERFLOW",
                ValueError::Type { .. } => "E_TYPE",
                ValueError::MissingField(_) => "E_FIELD",
                ValueError::DivideByZero => "E_DIV_ZERO",
            },
            Self::Schema(_) => "E_SCHEMA",
            Self::SchemaReserved(_) => "E_SCHEMA_RESERVED",
            Self::SchemaIndexColumn { .. } => "E_SCHEMA_INDEX_COLUMN",
            Self::SchemaMaintain(_) => "E_SCHEMA_MAINTAIN",
            Self::Serialization(_) => "E_SERIALIZATION",
            Self::Require { code } => code,
            Self::Rule { .. } => "E_RULE",
            Self::Constraint(_) => "E_CONSTRAINT",
            Self::Fanout => "E_FANOUT",
            Self::Steps(_) => "E_STEPS",
            Self::Input(_) => "E_INPUT",
            Self::StoreOwned { .. } => "E_STORE_OWNED",
            Self::StoreVersion { .. } => "E_STORE_VERSION",
            Self::TraceSubset(_) => "E_TRACE_SUBSET",
            Self::OpUnknown(_) => "E_OP_UNKNOWN",
            Self::MigrationPlan(_) => "E_MIGRATION_PLAN",
            Self::Successor(refusal) => &refusal.code,
        }
    }
}

impl Serialize for RuntimeError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;

        let mut error = serializer.serialize_struct("RuntimeError", 2)?;
        error.serialize_field("code", self.code())?;
        error.serialize_field("message", &self.to_string())?;
        error.end()
    }
}

pub struct Engine {
    store: Store,
    schema: Schema,
    verdicts: Vec<Verdict>,
    authority_absences: Vec<(String, String, Vec<Value>)>,
    rule_authority: RuleAuthority,
}

impl Engine {
    pub fn new(store: Store, schema: Schema) -> Result<Self, RuntimeError> {
        validate_schema(&schema).map_err(first_schema_error)?;
        Ok(Self {
            store,
            schema,
            verdicts: Vec::new(),
            authority_absences: Vec::new(),
            rule_authority: RuleAuthority::StoreAuthoritative,
        })
    }

    pub fn memory(schema: Schema) -> Result<Self, RuntimeError> {
        Self::new(Store::memory()?, schema)
    }

    pub(crate) fn memory_copy(&self) -> Result<Self, RuntimeError> {
        Ok(Self {
            store: self.store.memory_copy()?,
            schema: self.schema.clone(),
            verdicts: self.verdicts.clone(),
            authority_absences: self.authority_absences.clone(),
            rule_authority: self.rule_authority,
        })
    }

    pub(crate) fn install_receipt_authority(&mut self, receipt: &ClosureReceipt) {
        self.verdicts = receipt.verdicts.clone();
        self.authority_absences = receipt.absences.clone();
        self.rule_authority = RuleAuthority::ReceiptOnly;
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
        validate_schema(&schema).map_err(first_schema_error)?;
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
        let table_schema = self
            .schema
            .table(table)
            .ok_or_else(|| RuntimeError::Schema(format!("missing table {table}")))?;
        let mut rows = fetch_table_connection(&self.store.conn, table)?;
        for row in &mut rows {
            materialize_optional_fields(row, table_schema);
        }
        Ok(rows)
    }

    pub fn execute(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        context: Context,
    ) -> Result<Execution, RuntimeError> {
        validate_inputs(program, &context.args)?;
        match self.execute_with_kind(program, certificate, context, None) {
            Ok(execution) => Ok(execution),
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

    /// Run an effect bookkeeping mutation and settle its durable outbox row
    /// in the same outer transaction. A program rejection rolls its writes
    /// back to the savepoint, then commits only the `sent` settlement.
    // @ref LLP 1003#2-the-outbox-lifecycle — attempted `then` writes and every settlement share one transaction.
    pub(crate) fn execute_then(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        args: BTreeMap<String, Value>,
        now: i64,
        read_time: Option<i64>,
        new_ids: VecDeque<String>,
        outbox_id: &str,
    ) -> Result<Execution, RuntimeError> {
        let mut context = Context::system();
        context.args = args;
        context.now = Some(now);
        context.read_time = read_time;
        context.new_ids = new_ids;
        if let Err(error) = validate_inputs(program, &context.args) {
            let Some(code) = mutation_rejection_code(&error) else {
                return Err(error);
            };
            return self.settle_rejected_then(outbox_id, code, &error.to_string());
        }
        self.execute_with_kind_inner(program, certificate, context, None, Some(outbox_id))
    }

    /// Execute author-declared seed data with engine authority. Keeping this
    /// constructor in the engine module prevents any caller that can build an
    /// ordinary Context from obtaining the reserved viewer.
    pub(crate) fn execute_seed(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        now: i64,
    ) -> Result<Execution, RuntimeError> {
        let mut context = Context::system();
        context.now = Some(now);
        context.seed_write = true;
        self.execute_with_kind(program, certificate, context, Some("seed"))
    }

    pub(crate) fn reset_and_seed(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        now: i64,
    ) -> Result<Execution, RuntimeError> {
        let mut context = Context::system();
        context.now = Some(now);
        context.seed_write = true;
        self.reset_and_execute(program, certificate, context, Some("seed"))
    }

    pub(crate) fn settle_rejected_then(
        &mut self,
        outbox_id: &str,
        code: &str,
        message: &str,
    ) -> Result<Execution, RuntimeError> {
        let transaction = self.store.conn.transaction()?;
        Store::settle_then_transaction(
            &transaction,
            outbox_id,
            Some(&format!("{code}: {message}")),
            unix_millis(),
        )?;
        let seq =
            transaction.query_row("SELECT COALESCE(MAX(seq), 0) FROM _commits", [], |row| {
                row.get::<_, i64>(0)
            })?;
        transaction.commit()?;
        Ok(Execution {
            result: Value::Null,
            trace: AuthoritativeTrace::default(),
            receipt: ClosureReceipt::default(),
            state: ExecutionState::Rejected {
                code: code.to_owned(),
                message: message.to_owned(),
            },
            seq: seq.max(0) as u64,
        })
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
        self.execute_with_kind_inner(program, certificate, context, commit_kind, None)
    }

    fn execute_with_kind_inner(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        context: Context,
        commit_kind: Option<&str>,
        then_outbox_id: Option<&str>,
    ) -> Result<Execution, RuntimeError> {
        if certificate.value_model_version != CURRENT_VALUE_MODEL_VERSION.as_str() {
            return Err(RuntimeError::TraceSubset(format!(
                "value model version {} != current {}",
                certificate.value_model_version,
                CURRENT_VALUE_MODEL_VERSION.as_str()
            )));
        }
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
        let is_system = context.viewer.is_system();
        let commit_at = context.now.unwrap_or_else(unix_millis);
        let current_seq = self.store.commit_seq()?;
        let seq = if program.kind == ProgramKind::Mutation {
            current_seq.saturating_add(1)
        } else {
            current_seq
        };
        let transaction = self.store.conn.transaction()?;
        if then_outbox_id.is_some() {
            transaction.execute_batch("SAVEPOINT snapback2_effect_then")?;
        }
        let mut runner = Runner::new(
            &transaction,
            &self.schema,
            certificate,
            context,
            &self.verdicts,
            &self.authority_absences,
            self.rule_authority,
            seq,
        );
        let mut attempted = runner.statements(&program.body);
        if attempted.is_ok()
            && program.kind == ProgramKind::Mutation
            && let Err(error) = runner.check_final_constraints()
        {
            attempted = Err(error);
        }
        if attempted.is_ok()
            && program.kind == ProgramKind::Mutation
            && let Err(error) = runner.assert_bounds()
        {
            attempted = Err(error);
        }
        if program.kind == ProgramKind::Mutation && runner.missing_authority {
            runner.assert_bounds()?;
            let trace = std::mem::take(&mut runner.trace);
            let receipt = std::mem::take(&mut runner.receipt);
            drop(runner);
            transaction.rollback()?;
            return Ok(Execution {
                result: Value::Null,
                trace,
                receipt,
                state: ExecutionState::Partial {
                    reason: MISSING_AUTHORITY_LABEL.to_owned(),
                },
                seq: current_seq,
            });
        }
        let flow = match attempted {
            Ok(flow) => flow,
            Err(error) if program.kind == ProgramKind::Query => {
                let rule = match error {
                    RuntimeError::Rule { table, effect } => format!("{table}.{effect:?}"),
                    RuntimeError::Require { code } => code,
                    error => return Err(error),
                };
                runner.assert_bounds()?;
                let state = if runner.missing_authority {
                    ExecutionState::Partial {
                        reason: MISSING_AUTHORITY_LABEL.to_owned(),
                    }
                } else {
                    ExecutionState::Denied { rule }
                };
                let execution = Execution {
                    result: Value::Null,
                    trace: runner.trace,
                    receipt: runner.receipt,
                    state,
                    seq,
                };
                transaction.commit()?;
                return Ok(execution);
            }
            Err(error) if program.kind == ProgramKind::Mutation && then_outbox_id.is_some() => {
                let Some(code) = mutation_rejection_code(&error) else {
                    return Err(error);
                };
                drop(runner);
                transaction.execute_batch(
                    "ROLLBACK TO snapback2_effect_then; RELEASE snapback2_effect_then",
                )?;
                Store::settle_then_transaction(
                    &transaction,
                    then_outbox_id.expect("checked above"),
                    Some(&format!("{code}: {error}")),
                    commit_at,
                )?;
                transaction.commit()?;
                return Ok(Execution {
                    result: Value::Null,
                    trace: AuthoritativeTrace::default(),
                    receipt: ClosureReceipt::default(),
                    state: ExecutionState::Rejected {
                        code: code.to_owned(),
                        message: error.to_string(),
                    },
                    seq: current_seq,
                });
            }
            Err(error) => return Err(error),
        };
        let result = match flow {
            Flow::Return(value) => value,
            _ => Value::Null,
        };
        if program.kind == ProgramKind::Query {
            runner.assert_bounds()?;
        }
        let state = match (runner.missing_authority, &program.kind) {
            (true, _) => ExecutionState::Partial {
                reason: MISSING_AUTHORITY_LABEL.to_owned(),
            },
            (false, ProgramKind::Mutation) => ExecutionState::Committed { seq },
            (false, ProgramKind::Query) => query_state(&runner.trace, certificate),
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
            let kind = commit_kind.unwrap_or(if is_system { "system" } else { "mutation" });
            let record = CommitRecord {
                seq,
                at: commit_at,
                program: program.name.clone(),
                principal: principal.into_inner(),
                kind: kind.to_owned(),
                touched: execution.trace.touched.clone(),
                writes: execution.trace.writes.clone(),
                emits: execution.trace.emits.len() as u64,
            };
            append_commit(&transaction, &record)?;
        }
        if let Some(outbox_id) = then_outbox_id {
            transaction.execute_batch("RELEASE snapback2_effect_then")?;
            Store::settle_then_transaction(&transaction, outbox_id, None, commit_at)?;
        }
        transaction.commit()?;
        Ok(execution)
    }

    pub(crate) fn reset_and_execute(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        context: Context,
        commit_kind: Option<&str>,
    ) -> Result<Execution, RuntimeError> {
        if program.kind != ProgramKind::Mutation {
            return Err(RuntimeError::Input(
                "reset seed must be a mutation".to_owned(),
            ));
        }
        if certificate.value_model_version != CURRENT_VALUE_MODEL_VERSION.as_str() {
            return Err(RuntimeError::TraceSubset(format!(
                "value model version {} != current {}",
                certificate.value_model_version,
                CURRENT_VALUE_MODEL_VERSION.as_str()
            )));
        }
        if certificate.plan_hash != digest(program) {
            return Err(RuntimeError::TraceSubset("plan hash mismatch".to_owned()));
        }
        if certificate.schema_hash != self.schema.hash() {
            return Err(RuntimeError::TraceSubset("schema hash mismatch".to_owned()));
        }
        let principal = context.viewer.clone();
        let is_system = context.viewer.is_system();
        let commit_at = context.now.unwrap_or_else(unix_millis);
        let transaction = self.store.conn.transaction()?;
        transaction.execute_batch(
            "DELETE FROM index_entries;
             DELETE FROM rows;
             DELETE FROM _commits;
             DELETE FROM _outbox;",
        )?;
        let seq = 1;
        let mut runner = Runner::new(
            &transaction,
            &self.schema,
            certificate,
            context,
            &self.verdicts,
            &self.authority_absences,
            self.rule_authority,
            seq,
        );
        let flow = runner.statements(&program.body)?;
        runner.check_final_constraints()?;
        let result = match flow {
            Flow::Return(value) => value,
            _ => Value::Null,
        };
        runner.assert_bounds()?;
        let execution = Execution {
            result,
            trace: runner.trace,
            receipt: runner.receipt,
            state: ExecutionState::Committed { seq },
            seq,
        };
        // @ref LLP 1001#2-what-a-commit-records — reset, seed rows, and the seed commit are atomic.
        let kind = commit_kind.unwrap_or(if is_system { "system" } else { "mutation" });
        append_commit(
            &transaction,
            &CommitRecord {
                seq,
                at: commit_at,
                program: program.name.clone(),
                principal: principal.into_inner(),
                kind: kind.to_owned(),
                touched: execution.trace.touched.clone(),
                writes: execution.trace.writes.clone(),
                emits: execution.trace.emits.len() as u64,
            },
        )?;
        transaction.commit()?;
        Ok(execution)
    }

    pub(crate) fn probe_rule(
        &mut self,
        rule: &RuleExpr,
        row: &Value,
        context: Context,
        certificate: Option<&RuleCertificate>,
    ) -> Result<(bool, AuthoritativeTrace), RuntimeError> {
        if let Some(certificate) = certificate {
            if certificate.schema_hash != self.schema.hash() {
                return Err(RuntimeError::TraceSubset("schema hash mismatch".to_owned()));
            }
            if certificate.rule_hash != self.schema.rule_hash(rule) {
                return Err(RuntimeError::TraceSubset("rule hash mismatch".to_owned()));
            }
        }
        let seq = self.store.commit_seq()?;
        let transaction = self.store.conn.transaction()?;
        let mut runner = Runner::probe(
            &transaction,
            &self.schema,
            context,
            &self.verdicts,
            &self.authority_absences,
            self.rule_authority,
            seq,
            certificate,
        );
        let result = runner.eval_rule(rule, &self.schema.rule_hash(rule), None, row, false)?;
        if certificate.is_some() {
            runner.assert_rule_bounds()?;
        }
        let trace = runner.trace;
        transaction.commit()?;
        Ok((result, trace))
    }
}

// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — successor
// rebuilds clear only predecessor/successor projection-owned ids, preserve
// other target rows, and bind every delete/write constraint atomically.
pub(crate) fn rebuild_owned_aggregate_target<'a>(
    transaction: &'a Transaction<'a>,
    schema: &'a Schema,
    target: &str,
    owned_ids: &BTreeSet<String>,
    rows: Vec<Value>,
) -> Result<(), RuntimeError> {
    let mut runner = Runner::probe(
        transaction,
        schema,
        Context::system(),
        &[],
        &[],
        RuleAuthority::StoreAuthoritative,
        0,
        None,
    );
    runner.clear_aggregate_ids(target, owned_ids)?;
    for row in rows {
        runner.write_aggregate_row(target, row)?;
    }
    runner.check_final_constraints()?;
    Ok(())
}

fn validate_inputs(
    program: &Program,
    inputs: &BTreeMap<String, Value>,
) -> Result<(), RuntimeError> {
    for (name, kind) in &program.args {
        let value = inputs
            .get(name)
            .ok_or_else(|| RuntimeError::Input(format!("missing arg {name}")))?;
        validate_arg_value(kind, value, &format!("arg {name}"))?;
    }
    Ok(())
}

pub(crate) fn validate_arg_value(
    kind: &ArgType,
    value: &Value,
    label: &str,
) -> Result<(), RuntimeError> {
    // @ref LLP 1001#6-identity-identityrs — caller arguments cannot carry
    // the reserved identity even when their declared shape is generic.
    if value_contains_reserved_principal(value) {
        return Err(RuntimeError::Input(format!(
            "{label} cannot carry the reserved system principal"
        )));
    }
    match kind {
        ArgType::Optional(_) if *value == Value::Null => Ok(()),
        ArgType::Optional(inner) => validate_arg_value(inner, value, label),
        ArgType::Id | ArgType::Principal | ArgType::Ref { .. } => match value {
            Value::Id(_) => Ok(()),
            _ => Err(RuntimeError::Input(format!("{label} must be an id"))),
        },
        ArgType::Text { max } => match value {
            Value::String(value) if value.chars().count() <= *max as usize => Ok(()),
            Value::String(_) => Err(RuntimeError::Input(format!(
                "{label} exceeds text max {max}"
            ))),
            _ => Err(RuntimeError::Input(format!("{label} must be text"))),
        },
        ArgType::Bytes { max } => match value {
            Value::Bytes(value) if value.len() <= *max as usize => Ok(()),
            Value::Bytes(_) => Err(RuntimeError::Input(format!(
                "{label} exceeds bytes max {max}"
            ))),
            _ => Err(RuntimeError::Input(format!("{label} must be bytes"))),
        },
        ArgType::Int | ArgType::Time | ArgType::Decimal { .. } | ArgType::Money { .. } => {
            match value {
                Value::Int(value) if (I53_MIN..=I53_MAX).contains(value) => Ok(()),
                _ => Err(RuntimeError::Input(format!(
                    "{label} must be an i53 integer"
                ))),
            }
        }
        ArgType::Bool => match value {
            Value::Bool(_) => Ok(()),
            _ => Err(RuntimeError::Input(format!("{label} must be a boolean"))),
        },
        ArgType::Json { max_bytes } => {
            if canonical_json(value).len() <= *max_bytes as usize {
                Ok(())
            } else {
                Err(RuntimeError::Input(format!(
                    "{label} exceeds JSON max {max_bytes} bytes"
                )))
            }
        }
        ArgType::List { of, max } => match value {
            Value::Array(values) if values.len() <= *max as usize => {
                if let Some(of) = of {
                    for value in values {
                        validate_arg_value(of, value, label)?;
                    }
                }
                Ok(())
            }
            Value::Array(_) => Err(RuntimeError::Fanout),
            _ => Err(RuntimeError::Input(format!("{label} must be a list"))),
        },
        ArgType::Enum { variants } => match value {
            Value::String(value) if variants.contains(value) => Ok(()),
            Value::String(value) => Err(RuntimeError::Input(format!(
                "{label} value {value:?} is not in {variants:?}"
            ))),
            _ => Err(RuntimeError::Input(format!(
                "{label} must be an enum string"
            ))),
        },
        ArgType::Scalar => Ok(()),
    }
}

pub(crate) fn value_contains_reserved_principal(value: &Value) -> bool {
    match value {
        Value::Id(value) => value == SYSTEM_PRINCIPAL_ID.as_str(),
        Value::Row(values) | Value::Map(values) => {
            values.values().any(value_contains_reserved_principal)
        }
        Value::Array(values) => values.iter().any(value_contains_reserved_principal),
        _ => false,
    }
}

fn query_state(trace: &AuthoritativeTrace, certificate: &Certificate) -> ExecutionState {
    // @ref LLP 1001#3-read-and-write-states-no-silent-states — completeness is
    // trace-derived, but only a certificate with uniform range rules may claim it.
    if certificate.completeness == crate::certificate::Completeness::Capped
        || trace.ranges.iter().any(|range| {
            range.stop == StopReason::Limit
                || certificate
                    .read_sites
                    .iter()
                    .find(|site| site.site == range.site)
                    .is_none_or(|site| !site.hoist)
        })
    {
        return ExecutionState::Capped;
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

pub(crate) fn mutation_rejection_code(error: &RuntimeError) -> Option<&str> {
    match error {
        RuntimeError::Require { code } => Some(code),
        // @ref LLP 1001#3-read-and-write-states-no-silent-states — a table-rule
        // rejection keeps the same stable code in engine state and on the wire.
        RuntimeError::Rule { .. } => Some("E_RULE"),
        RuntimeError::Constraint(_) => Some("E_CONSTRAINT"),
        error if is_sqlite_constraint(error) => Some("E_CONSTRAINT"),
        RuntimeError::Input(_) => Some("E_INPUT"),
        RuntimeError::Value(error) => Some(match error {
            ValueError::DivideByZero => "E_DIV_ZERO",
            ValueError::Overflow(_) => "E_OVERFLOW",
            ValueError::Type { .. } => "E_TYPE",
            ValueError::MissingField(_) => "E_FIELD",
        }),
        RuntimeError::Steps(_) | RuntimeError::Fanout | RuntimeError::TraceSubset(_) => {
            Some("bound")
        }
        _ => None,
    }
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

pub fn validate_schema(schema: &Schema) -> Result<(), Vec<RuntimeError>> {
    let mut errors = Vec::new();
    for name in schema.tables.keys().filter(|name| name.starts_with('_')) {
        errors.push(RuntimeError::SchemaReserved(name.clone()));
    }
    for (table_name, table) in &schema.tables {
        if table.columns.get("id") != Some(&ColumnType::Id) {
            errors.push(RuntimeError::Schema(format!(
                "table {table_name} must declare the implicit id column as Id"
            )));
        }
        for (index_name, index) in &table.indexes {
            if index.columns.is_empty() || index.columns.len() > 8 {
                errors.push(RuntimeError::Schema(format!(
                    "index {table_name}.{index_name} must declare between 1 and 8 columns"
                )));
            }
            for column in &index.columns {
                if !table.columns.contains_key(column) {
                    errors.push(RuntimeError::Schema(format!(
                        "index {table_name}.{index_name} names undeclared column {column}"
                    )));
                }
                if table
                    .columns
                    .get(column)
                    .is_some_and(ColumnType::contains_list)
                {
                    errors.push(RuntimeError::SchemaIndexColumn {
                        table: table_name.clone(),
                        index: index_name.clone(),
                        column: column.clone(),
                    });
                }
            }
        }
    }
    errors.extend(
        crate::schema::maintain_issues(schema)
            .into_iter()
            .map(|issue| {
                RuntimeError::SchemaMaintain(format!(
                    "schema.maintains[{}]: {}",
                    issue.position, issue.message
                ))
            }),
    );
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

fn first_schema_error(errors: Vec<RuntimeError>) -> RuntimeError {
    errors
        .into_iter()
        .next()
        .expect("schema validation refusal contains at least one diagnostic")
}

mod index;
mod runner;
mod runner_ops;

#[allow(unused_imports)]
use index::{EvaluatedRange, delete_index_row, lookup_indexed, row_ids, scan_indexed};
#[allow(unused_imports)]
pub(crate) use index::{
    fetch_table_connection, index_values, materialize_optional_fields, reindex_row,
    validate_column_value, validate_row,
};
#[allow(unused_imports)]
use runner::{Flow, Runner};
