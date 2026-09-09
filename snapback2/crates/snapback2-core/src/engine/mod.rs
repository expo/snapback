#![allow(unused_imports)]
use crate::certificate::{Certificate, RuleCertificate};
use crate::cursor::{CursorPosition, decode_cursor, decode_cursor_for, encode_cursor};
use crate::identity::{Actor, CURRENT_VALUE_MODEL_VERSION, SYSTEM_PRINCIPAL_ID};
use crate::ir::*;
use crate::principal::PrincipalId;
use crate::schema::*;
use crate::store::{CommitRecord, Store, TouchedKey, unix_millis};
use crate::value::{I53_MAX, I53_MIN, Value, ValueError, canonical_json, digest, object};
use rusqlite::{Connection, OptionalExtension, Transaction, params, params_from_iter};
use serde::Serialize;
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
    #[serde(skip)]
    operator_by: Option<String>,
    #[serde(skip)]
    connected: std::sync::Arc<BTreeMap<String, u64>>,
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
            operator_by: None,
            connected: Default::default(),
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

    /// The exact executing query clock, never a projection-time sample.
    pub fn query_read_time(
        &self,
        program: &Program,
        certificate: &Certificate,
    ) -> Result<Option<i64>, RuntimeError> {
        if program.read_time_granularity_ms != certificate.read_time_granularity_ms {
            return Err(RuntimeError::TraceSubset(
                "query clock declaration mismatch".into(),
            ));
        }
        let Some(granularity) = certificate.read_time_granularity_ms else {
            return Ok(None);
        };
        if program.kind != ProgramKind::Query || granularity == 0 || granularity > I53_MAX as u64 {
            return Err(RuntimeError::TraceSubset(
                "invalid query clock declaration".into(),
            ));
        }
        let time = self
            .read_time
            .ok_or_else(|| RuntimeError::Input("readTime was not pinned".into()))?;
        if !(I53_MIN..=I53_MAX).contains(&time) {
            return Err(RuntimeError::Input(
                "readTime must be signed safe-integer milliseconds".into(),
            ));
        }
        Ok(Some(time))
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
            operator_by: None,
            connected: Default::default(),
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

pub(crate) const MISSING_AUTHORITY_LABEL: &str = "missing-authority";

// @ref LLP 1001#2-what-a-commit-records — replay may consume authority verdicts, never infer them from held rows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum RuleAuthority {
    StoreAuthoritative,
    ReceiptOnly,
}

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error("{0}")]
    Job(Box<crate::jobs::JobRefusal>),
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Value(#[from] ValueError),
    #[error("E_SCHEMA: {0}")]
    Schema(String),
    #[error("E_SCHEMA_RESERVED: schema or program names reserved table {0}")]
    SchemaReserved(String),
    #[error(
        "E_SCHEMA_INDEX_COLUMN: index {table}.{index} cannot use non-indexable column {column}"
    )]
    SchemaIndexColumn {
        table: String,
        index: String,
        column: String,
    },
    #[error("E_SCHEMA_CONSTRAINT: {message}")]
    SchemaConstraint { message: String, rewrite: String },
    #[error("E_SCHEMA_MAINTAIN: {0}")]
    SchemaMaintain(String),
    #[error("E_SERIALIZATION: {0}")]
    Serialization(String),
    #[error("E_REQUIRE:{code}: program requirement failed")]
    Require { code: String, site: Option<String> },
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
    #[error("E_ASSET_TYPE: {0}")]
    AssetType(String),
    #[error("E_ASSET_TOO_LARGE: {0}")]
    AssetTooLarge(String),
    #[error("E_ASSET_NOT_READY: {0}")]
    AssetNotReady(String),
    #[error("E_ASSET_IN_USE: {0}")]
    AssetInUse(String),
    #[error("E_ASSET_VIEWED: {0}")]
    AssetViewed(String),
    #[error("E_SCHEMA_SEED_ASSET: {table}.{column} cannot contain an asset value in seed data")]
    SchemaSeedAsset { table: String, column: String },
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
    pub fn require_code(&self) -> Option<String> {
        match self {
            Self::Require { code, .. } => Some(code.clone()),
            _ => None,
        }
    }

    pub fn require_site(&self) -> Option<String> {
        match self {
            Self::Require { site, .. } => site.clone(),
            _ => None,
        }
    }

    pub fn code(&self) -> &str {
        match self {
            Self::Job(error) => &error.code,
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
            Self::SchemaConstraint { .. } => "E_SCHEMA_CONSTRAINT",
            Self::Serialization(_) => "E_SERIALIZATION",
            Self::Require { code, .. } => code,
            Self::Rule { .. } => "E_RULE",
            Self::Constraint(_) => "E_CONSTRAINT",
            Self::Fanout => "E_FANOUT",
            Self::Steps(_) => "E_STEPS",
            Self::Input(_) => "E_INPUT",
            Self::AssetType(_) => "E_ASSET_TYPE",
            Self::AssetTooLarge(_) => "E_ASSET_TOO_LARGE",
            Self::AssetNotReady(_) => "E_ASSET_NOT_READY",
            Self::AssetInUse(_) => "E_ASSET_IN_USE",
            Self::AssetViewed(_) => "E_ASSET_VIEWED",
            Self::SchemaSeedAsset { .. } => "E_SCHEMA_SEED_ASSET",
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
    connected: std::sync::Arc<BTreeMap<String, u64>>,
    store: Store,
    schema: Schema,
    hashes: hashes::PolicyHashes,
    verdicts: Vec<Verdict>,
    authority_absences: Vec<(String, String, Vec<Value>)>,
    rule_authority: RuleAuthority,
}

enum AssetDeliveryAuthority {
    Authenticated(Context),
    Public,
}

impl Engine {
    pub fn new(store: Store, schema: Schema) -> Result<Self, RuntimeError> {
        validate_schema(&schema).map_err(first_schema_error)?;
        Ok(Self {
            connected: Default::default(),
            store,
            hashes: hashes::PolicyHashes::new(&schema),
            schema,
            verdicts: Vec::new(),
            authority_absences: Vec::new(),
            rule_authority: RuleAuthority::StoreAuthoritative,
        })
    }

    pub fn memory(schema: Schema) -> Result<Self, RuntimeError> {
        Self::new(Store::memory()?, schema)
    }

    pub fn set_connected(&mut self, counts: BTreeMap<String, u64>) {
        self.connected = std::sync::Arc::new(counts);
    }

    pub(crate) fn memory_copy(&self) -> Result<Self, RuntimeError> {
        Ok(Self {
            connected: self.connected.clone(),
            store: self.store.memory_copy()?,
            schema: self.schema.clone(),
            hashes: self.hashes.clone(),
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
        self.hashes = hashes::PolicyHashes::new(&schema);
        self.schema = schema;
        Ok(())
    }

    pub fn seed(&mut self, table: &str, row: Value) -> Result<(), RuntimeError> {
        validate_row(&self.schema, table, &row)?;
        if self.rule_authority == RuleAuthority::StoreAuthoritative {
            crate::assets::refuse_seed_assets(&self.schema, table, &row)?;
        }
        let id = row.field("id")?.as_str()?.to_owned();
        let tx = self.store.conn.transaction()?;
        tx.execute(
            "INSERT OR REPLACE INTO rows(table_name, row_id, data) VALUES (?1, ?2, ?3)",
            params![table, id, canonical_json(&row)],
        )?;
        reindex_row(&tx, &self.schema, table, &row)?;
        tx.commit()?;
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

    // @ref LLP 1006#2-authority-delivery-is-by-the-row-that-holds-it — the ledger, located row, asset cell, and certified read rule are checked in one read transaction.
    pub(crate) fn asset_delivery(
        &mut self,
        id: &str,
        context: Context,
        certificates: &BTreeMap<String, RuleCertificate>,
    ) -> Result<crate::assets_ledger::AssetDelivery, RuntimeError> {
        self.asset_delivery_inner(
            id,
            AssetDeliveryAuthority::Authenticated(context),
            certificates,
        )
    }

    /// Resolve only an explicitly `public(reason)` asset without manufacturing an
    /// authenticated viewer for a credential-free HTTP request.
    // @ref LLP 1006#2-authority-delivery-is-by-the-row-that-holds-it — public bytes use the same
    // certified table read rule while credential-free delivery stays anonymous.
    pub(crate) fn public_asset_delivery(
        &mut self,
        id: &str,
        certificates: &BTreeMap<String, RuleCertificate>,
    ) -> Result<crate::assets_ledger::AssetDelivery, RuntimeError> {
        self.asset_delivery_inner(id, AssetDeliveryAuthority::Public, certificates)
    }

    fn asset_delivery_inner(
        &mut self,
        id: &str,
        authority: AssetDeliveryAuthority,
        certificates: &BTreeMap<String, RuleCertificate>,
    ) -> Result<crate::assets_ledger::AssetDelivery, RuntimeError> {
        let transaction = self.store.conn.transaction()?;
        let ledger = crate::assets_ledger::delivery_row(&transaction, id)?;
        let locator = ledger.locator.clone().ok_or_else(asset_unavailable)?;
        let table = self
            .schema
            .table(&locator.table)
            .ok_or_else(asset_unavailable)?;
        let rule = table.rules.read.clone();
        let certificate = certificates
            .get(&locator.table)
            .ok_or_else(asset_unavailable)?;
        if certificate.schema_hash != self.hashes.schema
            || certificate.rule_hash != self.hashes.rule(&rule)
        {
            return Err(RuntimeError::TraceSubset(
                "asset delivery rule certificate mismatch".to_owned(),
            ));
        }
        let public = rule.is_public();
        // @ref LLP 1006#2a1-one-use-image-delivery-clique-f3-2026-09-05 — the owning column determines delivery, including public rows.
        let once = table
            .columns
            .get(&locator.column)
            .is_some_and(ColumnType::is_once);
        let row = match authority {
            AssetDeliveryAuthority::Authenticated(context) => {
                let seq = transaction
                    .query_row("SELECT COALESCE(MAX(seq), 0) FROM _commits", [], |row| {
                        row.get::<_, i64>(0)
                    })?
                    .max(0) as u64;
                let mut runner = Runner::probe(
                    &transaction,
                    &self.schema,
                    &self.hashes,
                    context,
                    &self.verdicts,
                    &self.authority_absences,
                    RuleAuthority::StoreAuthoritative,
                    seq,
                    Some(certificate),
                );
                let row = runner
                    .fetch_id(&locator.table, &locator.row)
                    .map_err(|error| match error {
                        RuntimeError::Schema(_) | RuntimeError::Value(_) => asset_unavailable(),
                        error => error,
                    })?
                    .ok_or_else(asset_unavailable)?;
                if !runner.check_rule(&locator.table, Effect::Read, None, &row)? {
                    return Err(asset_unavailable());
                }
                runner.assert_rule_bounds()?;
                row
            }
            AssetDeliveryAuthority::Public => {
                if !public || once {
                    return Err(asset_unavailable());
                }
                let index = table.index("byId").ok_or_else(asset_unavailable)?;
                let mut row = lookup_indexed(
                    &transaction,
                    &self.schema,
                    &locator.table,
                    "byId",
                    index,
                    &[Value::Id(locator.row.clone())],
                )?
                .ok_or_else(asset_unavailable)?;
                materialize_optional_fields(&mut row, table);
                row
            }
        };
        if !crate::assets_ledger::locator_cell_matches(&self.schema, &row, &locator, &ledger) {
            return Err(asset_unavailable());
        }
        let delivery = crate::assets_ledger::ready_delivery(ledger, public, once)?;
        transaction.commit()?;
        Ok(delivery)
    }

    pub fn execute(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        context: Context,
    ) -> Result<Execution, RuntimeError> {
        validate_inputs(&self.schema, program, &context.args)?;
        match self.execute_with_kind(program, certificate, context, None) {
            Ok(execution) => Ok(execution),
            Err(error) if program.kind == ProgramKind::Mutation && is_sqlite_constraint(&error) => {
                Ok(self.empty_execution(ExecutionState::Rejected {
                    site: error.require_site(),
                    rule: error.require_code(),
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
    // @ref LLP 1016#d1--the-system-principal-is-the-stores-owner — `then` skips viewer rules; constraints and atomic outbox settlement still bind.
    #[allow(clippy::too_many_arguments)]
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
        if let Err(error) = validate_inputs(&self.schema, program, &context.args) {
            let Some(code) = mutation_rejection_code(&error) else {
                return Err(error);
            };
            return self.settle_rejected_then(outbox_id, code, &error.to_string());
        }
        self.execute_with_kind_inner(program, certificate, context, None, Some(outbox_id), None)
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
        self.execute_with_kind(program, certificate, context, Some("seed"))
    }

    pub(crate) fn reset_and_seed(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        now: i64,
    ) -> Result<(Execution, Vec<String>), RuntimeError> {
        let mut context = Context::system();
        context.now = Some(now);
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
            result_provenance: ResultProvenance::None,
            trace: AuthoritativeTrace::default(),
            receipt: ClosureReceipt::default(),
            state: ExecutionState::Rejected {
                site: None,
                rule: None,
                code: code.to_owned(),
                message: message.to_owned(),
            },
            seq: seq.max(0) as u64,
            next: None,
        })
    }

    fn empty_execution(&self, state: ExecutionState) -> Result<Execution, RuntimeError> {
        Ok(Execution {
            result: Value::Null,
            result_provenance: ResultProvenance::None,
            trace: AuthoritativeTrace::default(),
            receipt: ClosureReceipt::default(),
            state,
            seq: self.store.commit_seq()?,
            next: None,
        })
    }

    pub(crate) fn execute_with_kind(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        context: Context,
        commit_kind: Option<&str>,
    ) -> Result<Execution, RuntimeError> {
        self.execute_with_kind_inner(program, certificate, context, commit_kind, None, None)
    }

    fn execute_with_kind_inner(
        &mut self,
        program: &Program,
        certificate: &Certificate,
        mut context: Context,
        commit_kind: Option<&str>,
        then_outbox_id: Option<&str>,
        replay: Option<&crate::offline::ReplayCommit>,
    ) -> Result<Execution, RuntimeError> {
        complete_optional_args(&program.args, &mut context.args);
        context.connected = self.connected.clone();
        if program.kind == ProgramKind::Job {
            let mut refusal = crate::jobs::JobRefusal::new(
                "E_OPERATOR_REQUIRED",
                "a job must be enqueued on the operator control route",
                &program.name,
                "run <job> --as system",
            );
            refusal.family = "operator".into();
            return Err(RuntimeError::Job(Box::new(refusal)));
        }
        if !certificate.has_current_semantics() {
            return Err(RuntimeError::TraceSubset(format!(
                "value model version {} != current {} or unsupported evaluator version",
                certificate.value_model_version,
                CURRENT_VALUE_MODEL_VERSION.as_str()
            )));
        }
        if certificate.plan_hash != digest(program) {
            return Err(RuntimeError::TraceSubset("plan hash mismatch".to_owned()));
        }
        if certificate.schema_hash != self.hashes.schema {
            return Err(RuntimeError::TraceSubset("schema hash mismatch".to_owned()));
        }
        context.query_read_time(program, certificate)?;
        if program.kind == ProgramKind::Query && !certificate.write_sites.is_empty() {
            return Err(RuntimeError::TraceSubset(
                "query certificate contains write sites".to_owned(),
            ));
        }
        let principal = context.viewer.clone();
        let is_system = context.viewer.is_system();
        let operator_by = context.operator_by.clone();
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
        if replay.is_some() {
            replay::open_savepoint(&transaction)?;
        }
        // @ref LLP 1006#6-the-write-validated-not-stamped — authoritative asset facts are checked inside the mutation transaction before its first statement.
        let entry_validation = if program.kind == ProgramKind::Mutation
            && self.rule_authority == RuleAuthority::StoreAuthoritative
        {
            validate_asset_inputs(&transaction, program, &context)
        } else {
            Ok(())
        };
        let mut runner = Runner::new(
            &transaction,
            &self.schema,
            &self.hashes,
            certificate,
            context,
            &self.verdicts,
            &self.authority_absences,
            self.rule_authority,
            seq,
        );
        runner.replay_preimages = replay.map(|_| BTreeMap::new());
        let mut attempted = entry_validation.and_then(|()| runner.statements(&program.body));
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
        if let Some(replay) = replay {
            // @ref LLP 1012#7-writes-offline — every replayed outcome settles in replay.rs.
            let kind = commit_kind.unwrap_or(if is_system { "system" } else { "mutation" });
            let run = replay::finish_run(runner, attempted, replay)?;
            return replay::settle(
                transaction,
                principal.as_str(),
                replay,
                run,
                program,
                kind,
                commit_at,
                current_seq,
                seq,
            );
        }
        if program.kind == ProgramKind::Mutation && runner.missing_authority {
            runner.assert_bounds()?;
            let trace = std::mem::take(&mut runner.trace);
            let receipt = std::mem::take(&mut runner.receipt);
            drop(runner);
            transaction.rollback()?;
            return Ok(Execution {
                result: Value::Null,
                result_provenance: ResultProvenance::None,
                trace,
                receipt,
                state: ExecutionState::Partial {
                    reason: MISSING_AUTHORITY_LABEL.to_owned(),
                },
                seq: current_seq,
                next: None,
            });
        }
        let flow = match attempted {
            Ok(flow) => flow,
            Err(error) if program.kind == ProgramKind::Query => {
                let rule = match error {
                    RuntimeError::Rule { table, effect } => format!("{table}.{effect:?}"),
                    RuntimeError::Require { code, .. } => code,
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
                    result_provenance: ResultProvenance::None,
                    trace: runner.trace,
                    receipt: if is_system {
                        ClosureReceipt::default()
                    } else {
                        runner.receipt
                    },
                    state,
                    seq,
                    next: None,
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
                    result_provenance: ResultProvenance::None,
                    trace: AuthoritativeTrace::default(),
                    receipt: ClosureReceipt::default(),
                    state: ExecutionState::Rejected {
                        site: error.require_site(),
                        rule: error.require_code(),
                        code: code.to_owned(),
                        message: error.to_string(),
                    },
                    seq: current_seq,
                    next: None,
                });
            }
            // @ref LLP 1016#d1--the-system-principal-is-the-stores-owner — rejected operator work keeps the attempted trace while every tentative write rolls back.
            Err(error) if commit_kind == Some("operator") => {
                let Some(code) = mutation_rejection_code(&error) else {
                    return Err(error);
                };
                let trace = std::mem::take(&mut runner.trace);
                drop(runner);
                transaction.rollback()?;
                return Ok(Execution {
                    result: Value::Null,
                    result_provenance: ResultProvenance::None,
                    trace,
                    receipt: ClosureReceipt::default(),
                    state: ExecutionState::Rejected {
                        site: error.require_site(),
                        rule: error.require_code(),
                        code: code.to_owned(),
                        message: error.to_string(),
                    },
                    seq: current_seq,
                    next: None,
                });
            }
            Err(error) => return Err(error),
        };
        let (result, result_provenance) = match flow {
            Flow::Return(value, provenance) if !runner.missing_authority => (value, provenance),
            _ => (Value::Null, ResultProvenance::None),
        };
        if program.kind == ProgramKind::Query {
            runner.assert_bounds()?;
        }
        let state = match (runner.missing_authority, &program.kind) {
            (true, _) => ExecutionState::Partial {
                reason: MISSING_AUTHORITY_LABEL.to_owned(),
            },
            (false, ProgramKind::Mutation | ProgramKind::Job) => ExecutionState::Committed { seq },
            (false, ProgramKind::Query) => query_state(&runner.trace, certificate, is_system),
        };
        let next = next_cursor(&self.schema, &state, &runner.trace, certificate)?;
        let execution = Execution {
            result,
            result_provenance,
            trace: runner.trace,
            receipt: if is_system {
                ClosureReceipt::default()
            } else {
                runner.receipt
            },
            state,
            seq,
            next,
        };
        if program.kind == ProgramKind::Mutation {
            // @ref LLP 1001#2-what-a-commit-records — data, outbox, and commit record are atomic.
            let kind = commit_kind.unwrap_or(if is_system { "system" } else { "mutation" });
            let record = CommitRecord {
                job: None,
                job_chunk: None,
                schedule: None,
                seq,
                at: commit_at,
                program: program.name.clone(),
                principal: principal.as_str().to_owned(),
                kind: kind.to_owned(),
                by: operator_by,
                touched: execution.trace.touched.clone(),
                scope_touches: execution.trace.scope_touches.clone(),
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
        mut context: Context,
        commit_kind: Option<&str>,
    ) -> Result<(Execution, Vec<String>), RuntimeError> {
        complete_optional_args(&program.args, &mut context.args);
        validate_inputs(&self.schema, program, &context.args)?;
        if program.kind != ProgramKind::Mutation {
            return Err(RuntimeError::Input(
                "reset seed must be a mutation".to_owned(),
            ));
        }
        if !certificate.has_current_semantics() {
            return Err(RuntimeError::TraceSubset(format!(
                "value model version {} != current {} or unsupported evaluator version",
                certificate.value_model_version,
                CURRENT_VALUE_MODEL_VERSION.as_str()
            )));
        }
        if certificate.plan_hash != digest(program) {
            return Err(RuntimeError::TraceSubset("plan hash mismatch".to_owned()));
        }
        if certificate.schema_hash != self.hashes.schema {
            return Err(RuntimeError::TraceSubset("schema hash mismatch".to_owned()));
        }
        let principal = context.viewer.clone();
        let is_system = context.viewer.is_system();
        let operator_by = context.operator_by.clone();
        let commit_at = context.now.unwrap_or_else(unix_millis);
        let transaction = self.store.conn.transaction()?;
        let asset_ids = crate::assets_ledger::clear_assets(&transaction)?;
        transaction.execute_batch(
            "DELETE FROM _asset_views;
             DELETE FROM index_entries;
             DELETE FROM _search_postings;
             DELETE FROM _search_nodes;
             DELETE FROM rows;
             DELETE FROM _commits;
             DELETE FROM _outbox;
             DELETE FROM _jobs;
             DELETE FROM _timers;
             DELETE FROM _meta WHERE key LIKE 'job_plan:%';
             DELETE FROM _grant_slices;
             DELETE FROM _client_intents;
             DELETE FROM _grants;",
        )?;
        // A reset store is a fresh install: period timers re-arm from now, row timers follow the seed's rows.
        crate::store_timers::reconcile(&transaction, &Schema::default(), &self.schema, commit_at)?;
        let seq = 1;
        let mut runner = Runner::new(
            &transaction,
            &self.schema,
            &self.hashes,
            certificate,
            context,
            &self.verdicts,
            &self.authority_absences,
            self.rule_authority,
            seq,
        );
        let flow = runner.statements(&program.body)?;
        runner.check_final_constraints()?;
        let (result, result_provenance) = match flow {
            Flow::Return(value, provenance) => (value, provenance),
            _ => (Value::Null, ResultProvenance::None),
        };
        runner.assert_bounds()?;
        let execution = Execution {
            result,
            result_provenance,
            trace: runner.trace,
            receipt: if is_system {
                ClosureReceipt::default()
            } else {
                runner.receipt
            },
            state: ExecutionState::Committed { seq },
            seq,
            next: None,
        };
        // @ref LLP 1001#2-what-a-commit-records — reset, seed rows, and the seed commit are atomic.
        let kind = commit_kind.unwrap_or(if is_system { "system" } else { "mutation" });
        append_commit(
            &transaction,
            &CommitRecord {
                job: None,
                job_chunk: None,
                schedule: None,
                seq,
                at: commit_at,
                program: program.name.clone(),
                principal: principal.into_inner(),
                kind: kind.to_owned(),
                by: operator_by,
                touched: execution.trace.touched.clone(),
                scope_touches: execution.trace.scope_touches.clone(),
                writes: execution.trace.writes.clone(),
                emits: execution.trace.emits.len() as u64,
            },
        )?;
        transaction.commit()?;
        Ok((execution, asset_ids))
    }

    pub(crate) fn probe_rule(
        &mut self,
        rule: &RuleExpr,
        row: &Value,
        context: Context,
        certificate: Option<&RuleCertificate>,
    ) -> Result<(bool, AuthoritativeTrace), RuntimeError> {
        if let Some(certificate) = certificate {
            if certificate.schema_hash != self.hashes.schema {
                return Err(RuntimeError::TraceSubset("schema hash mismatch".to_owned()));
            }
            if certificate.rule_hash != self.hashes.rule(rule) {
                return Err(RuntimeError::TraceSubset("rule hash mismatch".to_owned()));
            }
        }
        let seq = self.store.commit_seq()?;
        let transaction = self.store.conn.transaction()?;
        let mut runner = Runner::probe(
            &transaction,
            &self.schema,
            &self.hashes,
            context,
            &self.verdicts,
            &self.authority_absences,
            self.rule_authority,
            seq,
            certificate,
        );
        let result = runner.eval_rule(rule, &self.hashes.rule(rule), None, row, false)?;
        if certificate.is_some() {
            runner.assert_rule_bounds()?;
        }
        let trace = runner.trace;
        transaction.commit()?;
        Ok((result, trace))
    }
}

fn asset_unavailable() -> RuntimeError {
    RuntimeError::AssetNotReady("asset is unavailable".to_owned())
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
    let hashes = hashes::PolicyHashes::new(schema);
    let mut runner = Runner::probe(
        transaction,
        schema,
        &hashes,
        Context::system(),
        &[],
        &[],
        RuleAuthority::StoreAuthoritative,
        0,
        None,
    );
    runner.clear_aggregate_ids(target, owned_ids)?;
    for row in rows {
        if row.field("value").and_then(Value::as_int) == Ok(0) {
            continue;
        }
        runner.write_aggregate_row(target, row)?;
    }
    runner.check_final_constraints()?;
    Ok(())
}

pub(crate) fn complete_optional_args(
    types: &BTreeMap<String, ArgType>,
    args: &mut BTreeMap<String, Value>,
) {
    for (name, kind) in types {
        if matches!(kind, ArgType::Optional(_)) {
            args.entry(name.clone()).or_insert(Value::Null);
        }
    }
}

pub(crate) fn validate_inputs(
    schema: &Schema,
    program: &Program,
    inputs: &BTreeMap<String, Value>,
) -> Result<(), RuntimeError> {
    for (name, kind) in &program.args {
        let value = inputs
            .get(name)
            .or_else(|| matches!(kind, ArgType::Optional(_)).then_some(&Value::Null))
            .ok_or_else(|| RuntimeError::Input(format!("missing arg {name}")))?;
        validate_typed_arg_value(schema, kind, value, &format!("arg {name}"))?;
    }
    Ok(())
}

pub(crate) fn validate_typed_arg_value(
    schema: &Schema,
    kind: &ArgType,
    value: &Value,
    label: &str,
) -> Result<(), RuntimeError> {
    if !kind.bounds_valid() {
        return Err(RuntimeError::Input(format!(
            "{label} has text min greater than max"
        )));
    }
    // Asset validation owns whole-container uniqueness and typed refusals.
    if kind.contains_asset() {
        return validate_arg_value(kind, value, label);
    }
    crate::cap::validate_arg_identities(schema, kind, value)?;
    validate_arg_shape(Some(schema), kind, value, label)
}

pub(crate) fn validate_arg_value(
    kind: &ArgType,
    value: &Value,
    label: &str,
) -> Result<(), RuntimeError> {
    if !kind.bounds_valid() {
        return Err(RuntimeError::Input(format!(
            "{label} has text min greater than max"
        )));
    }
    crate::value::validate_identities(value)?;
    validate_arg_shape(None, kind, value, label)
}

fn validate_arg_shape(
    schema: Option<&Schema>,
    kind: &ArgType,
    value: &Value,
    label: &str,
) -> Result<(), RuntimeError> {
    let validate_nested = |kind: &ArgType, value: &Value| match schema {
        Some(schema) => validate_typed_arg_value(schema, kind, value, label),
        None => validate_arg_value(kind, value, label),
    };
    // @ref LLP 1001#6-identity-identityrs — caller arguments cannot carry
    // the reserved identity even when their declared shape is generic.
    if value_contains_reserved_principal(value) {
        return Err(RuntimeError::Input(format!(
            "{label} cannot carry the reserved system principal"
        )));
    }
    if kind.contains_asset() {
        crate::assets::arg_asset_uses(kind, value, label)?;
        return Ok(());
    }
    match kind {
        ArgType::Cursor => match value {
            Value::String(token) => decode_cursor(schema.unwrap_or(&Schema::default()), token)
                .map(|_| ())
                .map_err(|error| RuntimeError::Input(format!("{label} {error}"))),
            _ => Err(RuntimeError::Input(format!(
                "{label} must be an opaque cursor string"
            ))),
        },
        ArgType::Optional(_) if *value == Value::Null => Ok(()),
        ArgType::Optional(inner) => validate_nested(inner, value),
        ArgType::Id | ArgType::Principal | ArgType::Ref { .. } => match value {
            Value::Id(_) => Ok(()),
            _ => Err(RuntimeError::Input(format!("{label} must be an id"))),
        },
        ArgType::Text { max, min, format } => match value {
            Value::String(value) => {
                if let Some(code_point) = disallowed_text_control_code_point(value) {
                    return Err(RuntimeError::Input(format!(
                        "{label} contains disallowed control character U+{code_point:04X}"
                    )));
                }
                let length = value.chars().count();
                if length < *min as usize {
                    return Err(RuntimeError::Input(format!(
                        "{label} is below text min {min}"
                    )));
                }
                if format.is_some_and(|format| !format.matches(value)) {
                    return Err(RuntimeError::Input(format!(
                        "{label} violates text format {format:?}"
                    )));
                }
                if length <= *max as usize {
                    Ok(())
                } else {
                    Err(RuntimeError::Input(format!(
                        "{label} exceeds text max {max}"
                    )))
                }
            }
            _ => Err(RuntimeError::Input(format!("{label} must be text"))),
        },
        ArgType::Bytes { max } => match value {
            Value::Bytes(value) if value.len() <= *max as usize => Ok(()),
            Value::Bytes(_) => Err(RuntimeError::Input(format!(
                "{label} exceeds bytes max {max}"
            ))),
            _ => Err(RuntimeError::Input(format!("{label} must be bytes"))),
        },
        ArgType::Image { .. } | ArgType::Video { .. } => {
            unreachable!("asset-bearing arguments return above")
        }
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
                        validate_nested(of, value)?;
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

pub(super) fn disallowed_text_control_code_point(text: &str) -> Option<u32> {
    text.chars()
        .find(|character| *character <= '\u{001f}' && !matches!(*character, '\t' | '\n' | '\r'))
        .map(u32::from)
}

fn validate_asset_inputs(
    transaction: &Transaction<'_>,
    program: &Program,
    context: &Context,
) -> Result<(), RuntimeError> {
    for (name, kind) in &program.args {
        if !kind.contains_asset() {
            continue;
        }
        let value = context
            .args
            .get(name)
            .ok_or_else(|| RuntimeError::Input(format!("missing arg {name}")))?;
        for asset in crate::assets::arg_asset_uses(kind, value, &format!("arg {name}"))? {
            crate::assets_ledger::validate_asset_use(transaction, &asset, context.viewer(), true)?;
        }
    }
    Ok(())
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

pub(crate) fn is_sqlite_constraint(error: &RuntimeError) -> bool {
    matches!(
        error,
        RuntimeError::Sql(rusqlite::Error::SqliteFailure(sqlite, _))
            if sqlite.code == rusqlite::ErrorCode::ConstraintViolation
    )
}

pub(crate) fn mutation_rejection_code(error: &RuntimeError) -> Option<&str> {
    match error {
        RuntimeError::Require { code, .. } => Some(code),
        // @ref LLP 1001#3-read-and-write-states-no-silent-states — a table-rule
        // rejection keeps the same stable code in engine state and on the wire.
        RuntimeError::Rule { .. } => Some("E_RULE"),
        RuntimeError::Constraint(_) => Some("E_CONSTRAINT"),
        error if is_sqlite_constraint(error) => Some("E_CONSTRAINT"),
        RuntimeError::Input(_) => Some("E_INPUT"),
        RuntimeError::AssetType(_)
        | RuntimeError::AssetTooLarge(_)
        | RuntimeError::AssetNotReady(_)
        | RuntimeError::AssetInUse(_) => Some(error.code()),
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

pub fn validate_schema(schema: &Schema) -> Result<(), Vec<RuntimeError>> {
    let mut errors: Vec<_> = crate::cap::schema_errors(schema)
        .into_iter()
        .map(|(_, error)| RuntimeError::SchemaConstraint {
            message: error.message,
            rewrite: error.rewrite,
        })
        .collect();
    for (name, channel) in &schema.channels {
        errors.extend(crate::registry::channels::schema_errors(
            schema, name, channel,
        ));
        if channel.args.values().any(|arg| !arg.bounds_valid()) {
            errors.push(RuntimeError::Schema(format!(
                "channel {name} text min exceeds max"
            )));
        }
    }
    for name in schema
        .tables
        .keys()
        .filter(|name| name.starts_with('_') || name.as_str() == "connected")
    {
        errors.push(RuntimeError::SchemaReserved(name.clone()));
    }
    for (table_name, table) in &schema.tables {
        if table.columns.get("id") != Some(&ColumnType::Id) {
            errors.push(RuntimeError::Schema(format!(
                "table {table_name} must declare the implicit id column as Id"
            )));
        }
        errors.extend(crate::schema::index_errors(table_name, table));
    }

    errors.extend(
        crate::schema::tombstone_issues(schema)
            .into_iter()
            .map(|issue| {
                RuntimeError::Schema(format!(
                    "schema.tables.{}.tombstones[{}]: {}",
                    issue.table, issue.position, issue.message
                ))
            }),
    );
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

#[cfg(test)]
mod cap_count_tests;
#[cfg(test)]
mod cap_tests;
#[cfg(test)]
mod delivery_tests;
mod hashes;
mod index;
mod merge;
mod provenance;
mod receipt;
mod replay;
mod row_membership;
mod runner;
mod runner_ops;
mod scan;
mod search;
pub(crate) mod search_index;

pub use provenance::ResultProvenance;
pub use receipt::{
    AuthoritativeTrace, ClosureReceipt, ConstraintTrace, EmitRecord, Execution, ExecutionState,
    MergeTrace, PointTrace, ReceiptRange, RowRecord, RowRef, RuleInputTrace, StopReason,
    TraceRange, Verdict,
};

#[allow(unused_imports)]
use index::{EvaluatedRange, delete_index_row, lookup_indexed, row_ids, scan_indexed};
#[allow(unused_imports)]
pub(crate) use index::{
    fetch_table_connection, index_values, materialize_optional_fields, reindex_row,
    validate_column_value, validate_row, validate_typed_column_value,
};
#[allow(unused_imports)]
use runner::{Flow, Runner};

mod execution_record;
mod operator;
pub(crate) use execution_record::append_commit;
use execution_record::{next_cursor, query_state};

mod jobs;
pub(crate) use jobs::encode_job_key;

mod timers;

#[cfg(test)]
mod search_tests;

#[cfg(test)]
mod input_tests;
